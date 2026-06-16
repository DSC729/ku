// =============================================================
//  AI 摄影大师 — app.js v5.0
//  实时自动摄影参数调整引擎
//  基于 Zone System + Gray World + RMS Contrast + 摄影理论
// =============================================================

'use strict';

// ===== 全局状态 =====
const S = {
  stream: null, facingMode: 'user', flashMode: 'off',
  shootMode: 'auto',   // auto | portrait | landscape | night | pro | video
  // 自动调整开关
  auto: {
    exposure: true,    // 自动曝光
    saturation: true,  // 自动饱和度
    sharpness: true,   // 自动锐化
    contrast: true,     // 自动对比度
  },
  // 当前实际参数
  params: {
    ev: 0,              // 曝光补偿 (-3 ~ +3)
    iso: 100,           // 模拟 ISO
    shutter: '1/60',    // 模拟快门
    sat: 1.0,           // 饱和度倍数
    sharp: 0,           // 锐化强度
    contrast: 1.0,      // 对比度
    temp: 5500,         // 色温 K
  },
  // AI 分析结果
  scene: null,
  // 历史帧数据（平滑用）
  frameHistory: [],
  // 渲染
  models: { blazeface: null, mobilenet: null },
  aiReady: false, analyzing: false, lastAnalysis: 0,
};

// ===== DOM =====
const video    = document.getElementById('camera-preview');
const overlayCV = document.getElementById('overlay-canvas');
const overlayCtx = overlayCV.getContext('2d');

// ================================================================
//  第一部分：视频帧采样与分析
// ================================================================

// 低分辨率采样（用于快速分析，60fps 无卡顿）
const SAMPLE_W = 160, SAMPLE_H = 120;

function sampleFrame() {
  const tmp = document.createElement('canvas');
  tmp.width = SAMPLE_W; tmp.height = SAMPLE_H;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
  return ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
}

// 从采样帧计算摄影参数（Zone System）
function analyzePhotoParams(imgData) {
  const d = imgData.data;
  const n = d.length / 4;
  const pixels = [];

  let sumR = 0, sumG = 0, sumB = 0;
  let sumL = 0, sumL2 = 0;
  let shadowCount = 0, midCount = 0, highlightCount = 0;
  let minL = 255, maxL = 0;
  let oversatCount = 0; // 过饱和像素

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    // 亮度（Luma，ITU-R BT.709）
    const L = 0.2126*r + 0.7152*g + 0.0722*b;
    pixels.push({ r, g, b, L });

    sumR += r; sumG += g; sumB += b;
    sumL += L; sumL2 += L*L;
    if (L < minL) minL = L;
    if (L > maxL) maxL = L;

    // Zone System 分区
    if (L < 25) shadowCount++;
    else if (L > 220) highlightCount++;
    else midCount++;

    // 过饱和检测
    if (Math.abs(r-g) > 80 || Math.abs(g-b) > 80 || Math.abs(r-b) > 80) oversatCount++;
  }

  const avgL = sumL / n;
  const avgR = sumR / n, avgG = sumG / n, avgB = sumB / n;
  const variance = sumL2/n - avgL*avgL;
  const stdDev = Math.sqrt(Math.max(0, variance));

  // RMS 对比度
  const rmsContrast = stdDev / 128;

  // 动态范围
  const dynamicRange = maxL - minL;

  // Gray World 估算色温
  const temp = Math.round(6500 * (avgG / ((avgR + avgB) / 2)));

  // 平均饱和度
  let totalSat = 0;
  for (const p of pixels) {
    const maxC = Math.max(p.r, p.g, p.b);
    const minC = Math.min(p.r, p.g, p.b);
    const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
    totalSat += sat;
  }
  const avgSat = totalSat / n;

  // 曝光判断
  const zone = avgL / 255; // 0~1

  return {
    avgL, stdDev, rmsContrast, dynamicRange,
    shadowRatio: shadowCount / n,
    highlightRatio: highlightCount / n,
    midRatio: midCount / n,
    avgR, avgG, avgB, temp,
    avgSat,
    oversatRatio: oversatCount / n,
    zone, // 曝光区域
    minL, maxL,
  };
}

// ================================================================
//  第二部分：自动曝光引擎（Auto Exposure, AE）
//  基于摄影测光理论：评价测光 / 点测光
// ================================================================

function calcAutoExposure(params) {
  const { avgL, shadowRatio, highlightRatio, dynamicRange, rmsContrast } = params;

  let ev = 0;
  let iso = 100;
  let shutter = '1/60';
  let aeState = '✅ 曝光正常';

  // Zone System: 正常曝光时 avgL ≈ 118 (46.3% gray，反射率18%的灰板)
  // 人像模式希望 avgL ≈ 140（亮一些）
  // 风景模式希望 avgL ≈ 100（保留更多高光细节）

  const targetL = S.shootMode === 'portrait' ? 145 :
                  S.shootMode === 'night' ? 80 : 118;

  const deltaL = targetL - avgL;

  // EV 计算：每 6 个灰度值 = 1 EV
  ev = Math.round((deltaL / 20) * 6) / 6;
  ev = Math.max(-3, Math.min(3, ev));

  // 高光溢出保护
  if (highlightRatio > 0.15) {
    ev -= 0.5;
    aeState = '⚠️ 高光溢出，降 EV';
  }
  // 阴影保护
  if (shadowRatio > 0.5 && avgL < 60) {
    ev += 0.5;
    aeState = '⚠️ 阴影过深，提 EV';
  }
  // 逆光检测
  if (shadowRatio > 0.4 && highlightRatio > 0.1) {
    ev += 1.0;
    aeState = '🌗 逆光场景，大幅提亮主体';
  }

  // 模拟 ISO 选择（基于亮度）
  if (avgL < 30) { iso = 3200; shutter = '1/15'; }
  else if (avgL < 50) { iso = 1600; shutter = '1/30'; }
  else if (avgL < 80) { iso = 800; shutter = '1/60'; }
  else if (avgL < 120) { iso = 400; shutter = '1/125'; }
  else if (avgL < 180) { iso = 200; shutter = '1/250'; }
  else { iso = 100; shutter = '1/500'; }

  // 夜景模式强化
  if (S.shootMode === 'night') {
    iso = Math.min(3200, iso * 2);
    aeState = '🌙 夜景模式：高感光度';
  }

  return { ev, iso, shutter, aeState };
}

// ================================================================
//  第三部分：自动饱和度引擎
//  基于 Gray World 假说 + 色彩心理学
// ================================================================

function calcAutoSaturation(params) {
  const { avgSat, avgR, avgG, avgB, oversatRatio } = params;

  let sat = 1.0;
  let satState = '✅ 饱和度正常';
  let saturationAdvice = '';

  const targetSat = S.shootMode === 'portrait' ? 1.15 :
                    S.shootMode === 'landscape' ? 1.25 :
                    S.shootMode === 'night' ? 0.9 : 1.1;

  // Gray World 检测：R≈G≈B 时为灰度，大幅偏离时为高饱和
  const balance = avgG / ((avgR + avgB) / 2 + 0.1);

  if (avgSat < 0.2 && std(avgR, avgG, avgB) < 15) {
    // 几乎灰度场景，增强饱和度
    sat = targetSat;
    satState = '🎨 已自动增强饱和度';
    saturationAdvice = '灰度场景已增强色彩表现';
  } else if (avgSat > 0.6) {
    // 已经很饱和，减少避免过饱和
    sat = 0.9;
    satState = '⚠️ 已降低饱和度';
    saturationAdvice = '色彩浓郁，降低饱和避免溢出';
  } else if (oversatRatio > 0.1) {
    sat = 0.85;
    satState = '⚠️ 检测到色彩溢出';
    saturationAdvice = '部分颜色已饱和，降低饱和';
  } else {
    sat = targetSat;
  }

  // 场景推荐
  if (S.shootMode === 'landscape') {
    saturationAdvice = saturationAdvice || '风景模式增强色彩饱和度';
  } else if (S.shootMode === 'portrait') {
    saturationAdvice = saturationAdvice || '人像模式柔和增强肤色';
  }

  return { sat, satState, saturationAdvice };
}

// 辅助函数
function std(...vals) {
  const n = vals.length;
  const m = vals.reduce((a,b) => a+b, 0) / n;
  return Math.sqrt(vals.reduce((s,x) => s + (x-m)**2, 0) / n);
}

// ================================================================
//  第四部分：自动对比度 + 锐化
//  基于局部对比度增强（模拟 S形色调曲线）
// ================================================================

function calcAutoContrast(params) {
  const { rmsContrast, dynamicRange, shadowRatio, highlightRatio } = params;
  let contrast = 1.0;
  let sharp = 0;
  let state = '✅ 对比度正常';

  // 低对比度场景增强
  if (rmsContrast < 0.3) {
    contrast = 1.2;
    sharp = 15;
    state = '💡 低对比场景，已增强';
  } else if (rmsContrast > 0.7) {
    contrast = 0.95;
    sharp = 0;
    state = '✅ 高对比场景，保留层次';
  }

  // 雾霾/低动态范围场景
  if (dynamicRange < 100) {
    contrast = 1.3;
    sharp = 20;
    state = '🌫️ 低动态范围，已提升对比';
  }

  return { contrast, sharp, state };
}

// ================================================================
//  第五部分：综合场景检测
// ================================================================

async function detectScene(imgData, photoParams) {
  // 人脸检测（快速）
  let subject = '—';
  let genderAge = null;
  try {
    if (S.models.blazeface) {
      const faces = await S.models.blazeface.estimateFaces(video, false);
      if (faces.length > 0) {
        const face = faces[0];
        const fw = face.bottomRight[0] - face.topLeft[0];
        const fh = face.bottomRight[1] - face.topLeft[1];
        const area = fw * fh / (video.videoWidth * video.videoHeight);
        const ratio = fw / fh;
        subject = ratio > 0.76 ? '👩 女性' : '👨 男性';
        subject += area > 0.06 ? ' 近景' : area > 0.02 ? ' 中景' : ' 全身';
      }
    }
  } catch (e) {}

  // 场景分类（基于亮度 + mobilenet）
  let sceneLabel = '🏔️ 通用';
  try {
    if (S.models.mobilenet) {
      const preds = await S.models.mobilenet.classify(video, 2);
      if (preds?.[0]) {
        const label = preds[0].className.toLowerCase();
        if (/night|firework|spotlight|candle|neon/.test(label) || photoParams.avgL < 35) {
          sceneLabel = '🌙 夜景';
        } else if (/beach|shore|seashore|sky|sun/.test(label) && photoParams.avgL > 150) {
          sceneLabel = '☀️ 晴天户外';
        } else if (/forest|wood|mountain|valley|cliff/.test(label)) {
          sceneLabel = '🏔️ 自然风光';
        } else if (/indoor|room|home|office|living/.test(label)) {
          sceneLabel = '🏠 室内';
        } else if (/city|building|street/.test(label)) {
          sceneLabel = '🏙️ 城市建筑';
        } else if (/food|meal|table/.test(label)) {
          sceneLabel = '🍽️ 美食';
        } else if (/flower|rose|floral/.test(label)) {
          sceneLabel = '🌸 花卉';
        } else {
          sceneLabel = photoParams.avgL > 120 ? '🌤️ 明亮场景' : photoParams.avgL > 70 ? '⛅ 普通场景' : '🌑 暗光场景';
        }
      }
    }
  } catch (e) {}

  // 光照判断
  let lightLabel = '💡 正常光';
  if (photoParams.avgL > 180) lightLabel = '☀️ 强光';
  else if (photoParams.avgL > 130) lightLabel = '🌤️ 明亮';
  else if (photoParams.avgL > 80) lightLabel = '⛅ 均匀';
  else if (photoParams.avgL > 40) lightLabel = '💡 暗光';
  else lightLabel = '🌑 弱光';

  return { subject, sceneLabel, lightLabel };
}

// ================================================================
//  第六部分：应用参数到画面
//  使用 Canvas 2D 实时渲染（~30fps）
// ================================================================

let renderCanvas, renderCtx;
let photoParams = {};
let currentAE = {}, currentSat = {}, currentContrast = {};

function initRenderCanvas() {
  renderCanvas = document.createElement('canvas');
  renderCtx = renderCanvas.getContext('2d');
  // 替换 video 位置，用 canvas 显示处理后的画面
  video.style.display = 'none';
}

let lastRenderTime = 0;
const TARGET_FPS = 30;

function renderFrame() {
  const now = performance.now();
  if (now - lastRenderTime < 1000 / TARGET_FPS) {
    requestAnimationFrame(renderFrame);
    return;
  }
  lastRenderTime = now;

  if (!video.readyState >= 2) {
    requestAnimationFrame(renderFrame);
    return;
  }

  const w = video.videoWidth || video.clientWidth;
  const h = video.videoHeight || video.clientHeight;

  if (renderCanvas.width !== w) {
    renderCanvas.width = w; renderCanvas.height = h;
  }

  renderCtx.clearRect(0, 0, w, h);
  renderCtx.save();
  renderCtx.translate(w, 0); renderCtx.scale(-1, 1);
  renderCtx.drawImage(video, 0, 0);
  renderCtx.restore();

  // 获取图像数据
  const imgData = renderCtx.getImageData(0, 0, w, h);

  // 1. 应用白平衡（色温调整）
  if (S.auto.exposure) {
    applyWhiteBalance(imgData, currentAE.temp || 5500);
  }

  // 2. 应用曝光补偿（亮度 + 对比度）
  if (S.auto.exposure) {
    applyExposure(imgData, currentAE.ev || 0);
  }

  // 3. 应用饱和度
  if (S.auto.saturation) {
    applySaturation(imgData, currentSat.sat || 1.0);
  }

  // 4. 应用对比度（S形曲线）
  if (S.auto.contrast) {
    applyContrastCurve(imgData, currentContrast.contrast || 1.0);
  }

  renderCtx.putImageData(imgData, 0, 0);

  // 5. 锐化
  if (S.auto.sharpness && (currentContrast.sharp || 0) > 5) {
    applySharpen(renderCtx, w, h, currentContrast.sharp);
  }

  requestAnimationFrame(renderFrame);
}

// 色温调整（简化版）
function applyWhiteBalance(imgData, temp) {
  const d = imgData.data;
  const t = (temp - 5500) / 1000; // 偏移量
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, Math.max(0, d[i]     + t * 15)); // R: 暖
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] - t * 15)); // B: 冷
  }
}

// 曝光补偿（亮度平移 + 对比度保持）
function applyExposure(imgData, ev) {
  if (Math.abs(ev) < 0.01) return;
  const d = imgData.data;
  const factor = Math.pow(2, ev); // EV → 曝光因子
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, Math.round(d[i]     * factor));
    d[i + 1] = Math.min(255, Math.round(d[i + 1] * factor));
    d[i + 2] = Math.min(255, Math.round(d[i + 2] * factor));
  }
}

// 饱和度调整（HSL 空间）
function applySaturation(imgData, sat) {
  if (Math.abs(sat - 1.0) < 0.01) return;
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const l = (maxC + minC) / 2;
    if (maxC === minC) continue;
    const delta = maxC - minC;
    const s = delta / (255 - Math.abs(2*l - 255) + 1);
    const newS = Math.min(1, Math.max(0, s * sat));
    const alpha = newS === 0 ? 0 : delta / newS;
    const newMax = l + newS * 128;
    const newMin = 2 * l - newMax;
    // 重建 RGB
    let nr, ng, nb;
    if (r === maxC) {
      nr = newMax; ng = l + (g - minC) / delta * (newMax - newMin); nb = newMin;
    } else if (g === maxC) {
      ng = newMax; nr = l + (r - minC) / delta * (newMax - newMin); nb = newMin;
    } else {
      nb = newMax; nr = l + (r - minC) / delta * (newMax - newMin); ng = newMin;
    }
    d[i] = Math.round(Math.max(0, Math.min(255, nr)));
    d[i+1] = Math.round(Math.max(0, Math.min(255, ng)));
    d[i+2] = Math.round(Math.max(0, Math.min(255, nb)));
  }
}

// 对比度 S 形曲线
function applyContrastCurve(imgData, contrast) {
  if (Math.abs(contrast - 1.0) < 0.01) return;
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = d[i+c] / 255;
      // S 形曲线：y = 1/(1+e^(-k*(x-0.5)))
      const centered = v - 0.5;
      const factor = (contrast - 1) * 2;
      const s = 1 / (1 + Math.exp(-factor * centered * 6));
      d[i+c] = Math.round(Math.max(0, Math.min(255, s * 255)));
    }
  }
}

// 锐化（USM Unsharp Mask 简化版）
function applySharpen(ctx, w, h, amount) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const strength = amount / 100;
  const tmp = new Uint8ClampedArray(d);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = tmp[i+c];
        const blur = (
          tmp[(y-1)*w*4+(x-1)*4+c] + 2*tmp[(y-1)*w*4+x*4+c] + tmp[(y-1)*w*4+(x+1)*4+c] +
          2*tmp[y*w*4+(x-1)*4+c] - 12*tmp[i+c] + 2*tmp[y*w*4+(x+1)*4+c] +
          tmp[(y+1)*w*4+(x-1)*4+c] + 2*tmp[(y+1)*w*4+x*4+c] + tmp[(y+1)*w*4+(x+1)*4+c]
        ) / 16;
        const sharpened = Math.round(center + strength * blur);
        d[i+c] = Math.max(0, Math.min(255, sharpened));
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// ================================================================
//  第七部分：主 AI 分析循环（慢速 ~2fps，用于决策）
// ================================================================

async function aiAnalysisLoop() {
  if (!video.readyState >= 2) {
    setTimeout(aiAnalysisLoop, 500); return;
  }

  // 每 500ms 分析一次（轻量）
  const imgData = sampleFrame();
  photoParams = analyzePhotoParams(imgData);

  // 自动曝光
  if (S.auto.exposure) {
    currentAE = calcAutoExposure(photoParams);
    S.params.ev = currentAE.ev;
    S.params.iso = currentAE.iso;
    S.params.shutter = currentAE.shutter;
  }

  // 自动饱和度
  if (S.auto.saturation) {
    currentSat = calcAutoSaturation(photoParams);
    S.params.sat = currentSat.sat;
  }

  // 自动对比度
  if (S.auto.contrast) {
    currentContrast = calcAutoContrast(photoParams);
    S.params.contrast = currentContrast.contrast;
    S.params.sharp = currentContrast.sharp;
  }

  // 场景检测
  const sceneInfo = await detectScene(imgData, photoParams);
  S.scene = { ...photoParams, ...sceneInfo, aeState: currentAE.aeState, satState: currentSat.satState };

  // 更新 UI
  updateDashboard();
  updateCameraInfoBar();

  setTimeout(aiAnalysisLoop, 500);
}

// ================================================================
//  第八部分：UI 更新
// ================================================================

function updateDashboard() {
  const s = S.scene;
  if (!s) return;

  document.getElementById('ai-subject').textContent = s.subject || '—';
  document.getElementById('ai-scene').textContent = s.sceneLabel || '—';
  document.getElementById('ai-light').textContent = s.lightLabel || '—';

  // 构图推荐
  const compMap = { portrait: '📐 三分法', landscape: '🌀 黄金分割', night: '⭕ 居中构图', default: '📐 三分法' };
  document.getElementById('ai-comp').textContent = compMap[S.shootMode] || '📐 三分法';

  // EV 状态
  const ev = currentAE.ev || 0;
  document.getElementById('ai-ev').textContent = `EV ${ev > 0 ? '+' : ''}${ev.toFixed(1)}`;

  // 色温
  const temp = s.temp || 5500;
  const tempLabel = temp > 6000 ? '🔵 偏冷' : temp < 5000 ? '🟠 偏暖' : '⚪ 中性';
  document.getElementById('ai-tint').textContent = tempLabel;

  // 综合建议
  const suggestions = [];
  if (currentAE.aeState && currentAE.aeState !== '✅ 曝光正常') suggestions.push(currentAE.aeState);
  if (currentSat.satState && currentSat.satState !== '✅ 饱和度正常') suggestions.push(currentSat.satState);
  if (currentContrast.state && currentContrast.state !== '✅ 对比度正常') suggestions.push(currentContrast.state);
  if (suggestions.length === 0) suggestions.push('✅ 画面参数自动优化中...');
  document.getElementById('ai-suggestion').textContent = suggestions.join(' · ');

  // 场景标签
  document.getElementById('scene-badge').textContent = s.sceneLabel || '';
  document.getElementById('scene-badge').classList.remove('hidden');
}

function updateCameraInfoBar() {
  const ae = currentAE;
  document.getElementById('ev-display').textContent = `EV ${(ae.ev||0) > 0 ? '+' : ''}${(ae.ev||0).toFixed(1)}`;
  document.getElementById('iso-display').textContent = `ISO ${ae.iso || '—'}`;
  document.getElementById('shutter-display').textContent = `快门 ${ae.shutter || '—'}`;
}

// ================================================================
//  第九部分：相机初始化
// ================================================================

async function initCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: S.facingMode,
        width: { ideal: 1920 }, height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      }, audio: false,
    });
    video.srcObject = S.stream = stream;
    await video.play();
    initRenderCanvas();
    renderFrame(); // 启动渲染循环
  } catch (e) {
    alert('相机启动失败，请检查权限。');
  }
}

// ================================================================
//  第十部分：AI 模型加载
// ================================================================

async function loadModels() {
  showTip('⏳ 加载 AI 模型...');
  try {
    const [bf, mn] = await Promise.all([
      blazeface.load(),
      mobilenet.load({ version: 2, alpha: 1.0 }),
    ]);
    S.models.blazeface = bf; S.models.mobilenet = mn;
    S.aiReady = true;
    showTip('✅ AI 摄影大师已就绪', 2000);
  } catch (e) {
    S.aiReady = false;
    showTip('⚠️ AI 离线，参数手动调节', 3000);
  }
}

// ================================================================
//  第十一部分：拍照
// ================================================================

async function capture() {
  const btn = document.getElementById('btn-capture');
  btn.classList.add('shooting');
  setTimeout(() => btn.classList.remove('shooting'), 700);

  const cv = document.createElement('canvas');
  cv.width = renderCanvas.width; cv.height = renderCanvas.height;
  cv.getContext('2d').drawImage(renderCanvas, 0, 0);
  const url = cv.toDataURL('image/jpeg', 0.95);
  showResult(url);
}

// ================================================================
//  第十二部分：专业辅助
// ================================================================

// 绘制网格辅助线
function drawGrid(mode) {
  overlayCtx.clearRect(0, 0, overlayCV.width, overlayCV.height);
  const w = overlayCV.width, h = overlayCV.height;
  overlayCtx.strokeStyle = 'rgba(255,255,255,0.38)';
  overlayCtx.lineWidth = 1;
  overlayCtx.setLineDash([6, 5]);

  if (mode === 'thirds') {
    for (let i = 1; i <= 2; i++) {
      overlayCtx.beginPath(); overlayCtx.moveTo(w*i/3,0); overlayCtx.lineTo(w*i/3,h); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.moveTo(0,h*i/3); overlayCtx.lineTo(w,h*i/3); overlayCtx.stroke();
    }
    // 黄金交叉点
    [[w/3,h/3],[w*2/3,h/3],[w/3,h*2/3],[w*2/3,h*2/3]].forEach(([x,y]) => {
      overlayCtx.beginPath(); overlayCtx.arc(x,y,5,0,Math.PI*2);
      overlayCtx.fillStyle='rgba(255,179,71,0.7)'; overlayCtx.fill();
    });
  } else if (mode === 'golden') {
    const phi = 0.618;
    for (let i = 1; i <= 2; i++) {
      overlayCtx.beginPath(); overlayCtx.moveTo(w*Math.pow(phi,i),0); overlayCtx.lineTo(w*Math.pow(phi,i),h); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.moveTo(0,h*Math.pow(phi,i)); overlayCtx.lineTo(w,h*Math.pow(phi,i)); overlayCtx.stroke();
    }
  } else if (mode === 'center') {
    overlayCtx.beginPath(); overlayCtx.arc(w/2,h/2,Math.min(w,h)*0.18,0,Math.PI*2); overlayCtx.stroke();
    overlayCtx.beginPath(); overlayCtx.moveTo(w/2,0); overlayCtx.lineTo(w/2,h); overlayCtx.stroke();
    overlayCtx.beginPath(); overlayCtx.moveTo(0,h/2); overlayCtx.lineTo(w,h/2); overlayCtx.stroke();
  } else if (mode === 'diag') {
    overlayCtx.beginPath(); overlayCtx.moveTo(0,0); overlayCtx.lineTo(w,h); overlayCtx.stroke();
    overlayCtx.beginPath(); overlayCtx.moveTo(w,0); overlayCtx.lineTo(0,h); overlayCtx.stroke();
    overlayCtx.beginPath(); overlayCtx.arc(w/2,h/2,Math.min(w,h)*0.25,0,Math.PI*2); overlayCtx.stroke();
  }
  overlayCtx.setLineDash([]);
}

// 直方图
function drawHistogram() {
  const histCV = document.getElementById('histogram-canvas');
  if (!histCV) return;
  const ctx = histCV.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = 80; tmp.height = 40;
  tmp.getContext('2d').drawImage(video, 0, 0, 80, 40);
  const imgData = tmp.getContext('2d').getImageData(0,0,80,40).data;
  const bins = new Array(64).fill(0);
  for (let i = 0; i < imgData.length; i += 16) {
    const l = Math.floor((imgData[i]*0.299+imgData[i+1]*0.587+imgData[i+2]*0.114)/4);
    bins[Math.min(63,l)]++;
  }
  const maxB = Math.max(...bins);
  ctx.clearRect(0,0,80,40);
  bins.forEach((c,i) => {
    const bh = (c/maxB)*38;
    ctx.fillStyle=`hsl(${i*2.8},65%,50%)`;
    ctx.fillRect(i,40-bh,1,bh);
  });
  [16,48].forEach(x => {
    ctx.strokeStyle='rgba(255,255,255,0.3)';
    ctx.lineWidth=0.5;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,40); ctx.stroke();
  });
}

// ================================================================
//  第十三部分：事件绑定
// ================================================================

function setupEventListeners() {
  // 拍摄模式
  document.querySelectorAll('.shoot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shoot-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.shootMode = btn.dataset.mode;
      const proPanel = document.getElementById('pro-panel');
      const captureBtn = document.getElementById('btn-capture');

      proPanel?.classList.add('hidden');
      captureBtn.classList.remove('video-mode');
      captureBtn.textContent = '●';

      document.getElementById('mode-badge').textContent =
        { auto:'🤖 AI智能', portrait:'👤 人像', landscape:'🏔️ 风景', night:'🌙 夜景', pro:'⚙️ 专业', video:'🎬 视频' }[S.shootMode] || '🤖';

      if (S.shootMode === 'pro') {
        proPanel?.classList.remove('hidden');
      } else if (S.shootMode === 'auto') {
        Object.keys(S.auto).forEach(k => S.auto[k] = true);
      } else if (S.shootMode === 'portrait') {
        S.auto.exposure = true; S.auto.saturation = true;
        drawGrid('thirds');
      } else if (S.shootMode === 'landscape') {
        S.auto.exposure = true; S.auto.saturation = true;
        drawGrid('golden');
      } else if (S.shootMode === 'night') {
        S.auto.exposure = true;
      }
    });
  });

  // 专业模式参数
  document.querySelectorAll('[data-grid]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.parentElement.querySelectorAll('.pro-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      drawGrid(btn.dataset.grid === 'off' ? 'none' : btn.dataset.grid);
    });
  });

  document.querySelectorAll('[data-aux]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.parentElement.querySelectorAll('.pro-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.aux;
      document.getElementById('histogram-container').classList.toggle('visible', mode === 'histogram');
      document.getElementById('level-indicator').classList.toggle('visible', mode === 'level');
      if (mode === 'histogram') drawHistogram();
    });
  });

  // EV 曝光补偿滑块
  document.getElementById('ev-slider')?.addEventListener('input', e => {
    S.auto.exposure = false;
    S.params.ev = parseFloat(e.target.value);
    currentAE.ev = S.params.ev;
    updateCameraInfoBar();
    document.getElementById('ai-ev').textContent = `EV ${S.params.ev > 0 ? '+' : ''}${S.params.ev}`;
  });

  // 底部按钮
  document.getElementById('btn-capture').addEventListener('click', () => {
    if (S.shootMode === 'video') {
      if (S.isRecording) stopRecording(); else startRecording();
    } else {
      capture();
    }
  });

  document.getElementById('btn-switch').addEventListener('click', () => {
    S.facingMode = S.facingMode === 'user' ? 'environment' : 'user';
    initCamera();
  });

  document.getElementById('btn-flash').addEventListener('click', () => {
    const modes = ['off', 'on'];
    const idx = modes.indexOf(S.flashMode);
    S.flashMode = modes[(idx+1)%2];
    document.getElementById('btn-flash').textContent = S.flashMode === 'on' ? '💡' : '⚡';
    S.stream?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: S.flashMode === 'on' }] }).catch(()=>{});
  });

  document.getElementById('btn-gallery').addEventListener('click', () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = ev => showResult(ev.target.result);
      reader.readAsDataURL(f);
    };
    inp.click();
  });

  // 结果弹窗
  document.getElementById('btn-save')?.addEventListener('click', () => {
    const url = document.getElementById('result-original')?.src;
    if (url) downloadFile(url, `photo_${Date.now()}.jpg`);
  });
  document.getElementById('btn-retake')?.addEventListener('click', () => {
    document.getElementById('result-modal')?.classList.add('hidden');
  });

  // 直方图定时刷新
  setInterval(() => {
    if (document.getElementById('histogram-container')?.classList.contains('visible')) {
      drawHistogram();
    }
  }, 200);
}

function showResult(url) {
  const modal = document.getElementById('result-modal');
  const origImg = document.getElementById('result-original');
  origImg.src = url;
  origImg.style.display = 'block';
  document.getElementById('result-tag').textContent = '📷 拍摄成功';
  document.getElementById('result-actions')?.classList.remove('hidden');
  modal.classList.remove('hidden');
}

function downloadFile(url, name) {
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
}

// 视频录制
let mediaRecorder, recordedChunks = [], isRecording = false;
function startRecording() {
  if (!S.stream) return;
  mediaRecorder = new MediaRecorder(S.stream, { mimeType: 'video/webm' });
  recordedChunks = [];
  mediaRecorder.ondataavailable = e => { if (e.data.size) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    downloadFile(URL.createObjectURL(blob), `video_${Date.now()}.webm`);
  };
  mediaRecorder.start(100); isRecording = true;
  document.getElementById('recording-indicator').classList.remove('hidden');
  document.getElementById('btn-capture').textContent = '⬛';
}
function stopRecording() {
  if (mediaRecorder && isRecording) { mediaRecorder.stop(); isRecording = false; }
  document.getElementById('recording-indicator').classList.add('hidden');
  document.getElementById('btn-capture').textContent = '●';
}

// 水平仪
function startLevel() {
  if (!window.DeviceOrientationEvent) return;
  window.addEventListener('deviceorientation', e => {
    const g = e.gamma || 0;
    const clamped = Math.max(-30, Math.min(30, g));
    const pct = (clamped / 30) * 100;
    const bubble = document.getElementById('level-bubble');
    if (bubble) {
      bubble.style.left = `calc(50% - 6px + ${pct * 0.48}px)`;
      bubble.style.background = Math.abs(g) < 2 ? '#4ECDC4' : '#FFB347';
    }
  }, true);
}

// 提示
function showTip(text, dur = 0) {
  const el = document.getElementById('ai-tip');
  if (!el) return;
  el.textContent = text; el.classList.remove('hidden'); el.classList.add('visible');
  if (dur > 0) setTimeout(() => { el.classList.remove('visible'); el.classList.add('hidden'); }, dur);
}

// ================================================================
//  启动
// ================================================================

(async () => {
  await initCamera();
  startLevel();
  await loadModels();
  setupEventListeners();
  aiAnalysisLoop();
  document.getElementById('mode-badge').textContent = '🤖 AI智能';
  document.getElementById('btn-mode-info').textContent = 'AI智能';
  showTip('🤖 AI 摄影大师已启动', 2000);
})();
