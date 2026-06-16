// =============================================================
//  AI 摄影大师 — app.js v4.0
//  基于摄影基础理论 + 计算机视觉的智能相机系统
// =============================================================

'use strict';

// ===== 全局状态 =====
const S = {
  stream: null, facingMode: 'user', flashMode: 'off',
  // 拍摄模式
  shootMode: 'auto',   // auto | portrait | landscape | pro | video
  // 专业参数
  iso: 'auto', wb: 'auto', gridMode: 'off',
  auxMode: 'none',      // none | histogram | level | zebra | peaking
  evComp: 0,
  // 视频
  mediaRecorder: null, recordedChunks: [], isRecording: false, recordingStart: 0,
  // AI
  aiReady: false, analyzing: false, lastAnalysis: 0,
  // 美颜/滤镜
  beauty: { smooth: 50, whiten: 35, eyes: 20, slim: 15 },
  filter: 'none',
  // AI 分析结果
  scene: { type: null, light: null, quality: null, comp: null, ev: 0, tint: null },
  models: { blazeface: null, mobilenet: null },
};

// ===== DOM =====
const video      = document.getElementById('camera-preview');
const overlayCV  = document.getElementById('overlay-canvas');
const overlayCtx = overlayCV.getContext('2d');
const histCV     = document.getElementById('histogram-canvas');
const histCtx    = histCV.getContext('2d');
const levelEl    = document.getElementById('level-indicator');
const levelBubble = document.getElementById('level-bubble');
const focusRing  = document.getElementById('focus-ring');
const aiTip      = document.getElementById('ai-tip');

// ===== 滤镜配置 =====
const FILTERS = {
  none:      { label: '原图',     css: 'none' },
  warm:      { label: '暖调',     css: 'sepia(0.2) saturate(1.3) brightness(1.03)' },
  cool:      { label: '冷调',     css: 'saturate(0.9) hue-rotate(15deg) brightness(1.05)' },
  vintage:   { label: '复古',     css: 'sepia(0.4) contrast(1.1) brightness(0.9) saturate(0.9)' },
  cinematic: { label: '电影',    css: 'contrast(1.15) saturate(1.2) brightness(0.9)' },
  小清新:    { label: '小清新',  css: 'saturate(1.05) brightness(1.08) contrast(0.95)' },
};

// ===== 场景-参数映射（摄影基础理论）=====
// 基于光圈/快门/ISO 联动原理 + 分区曝光法（Zone System）
const SCENE_PARAMS = {
  portrait: {
    ev: 0, wb: 'auto', iso: 'auto', tint: '暖调偏柔',
    advice: '使用大光圈虚化背景，让主体更突出',
    grid: 'thirds',  // 主体放三分线交点
    lightAdvice: '寻找柔和侧光，避免正午强光直照',
  },
  landscape: {
    ev: 0, wb: 'auto', iso: 'auto', tint: '自然饱和',
    advice: '收小光圈获得更大景深，让前景和背景都清晰',
    grid: 'golden',   // 黄金分割
    lightAdvice: '黄金时段（日出/日落）光线最佳',
  },
  night: {
    ev: -1, wb: 'auto', iso: '800', tint: '冷蓝氛围',
    advice: '稳定手机或使用支架，长曝光获得更多细节',
    grid: 'center',
    lightAdvice: '寻找人造光源点缀，避免纯黑场景',
  },
  backlit: {
    ev: +1.5, wb: 'auto', iso: 'auto', tint: '高光优先',
    advice: '增加曝光补偿或开启 HDR，避免主体过暗',
    grid: 'thirds',
    lightAdvice: '对主体脸部测光，或使用反光板补光',
  },
  macro: {
    ev: 0, wb: 'auto', iso: 'auto', tint: '高饱和',
    advice: '使用手动对焦，轻微调整获得锐利细节',
    grid: 'center',
    lightAdvice: '环形闪光灯或自然侧光，避免阴影覆盖主体',
  },
  indoor: {
    ev: 0, wb: 'auto', iso: '400', tint: '暖调',
    advice: '适当提高 ISO，避免快门过慢导致模糊',
    grid: 'thirds',
    lightAdvice: '靠近窗户，利用自然光拍摄效果更佳',
  },
  sports: {
    ev: 0, wb: 'auto', iso: '800', tint: '高对比',
    advice: '使用连拍模式，提高快门速度凝固瞬间',
    grid: 'thirds',
    lightAdvice: '连拍时保持稳定，跟随主体移动',
  },
  fireworks: {
    ev: -2, wb: 'tungsten', iso: '200', tint: '冷蓝',
    advice: '使用三脚架，长曝光（2-4秒）捕捉光轨',
    grid: 'off',
    lightAdvice: '烟花绽放瞬间按下快门',
  },
  cloud: {
    ev: -0.5, wb: 'cloudy', iso: 'auto', tint: '低饱和灰调',
    advice: '光线柔和均匀，适合人像和风景',
    grid: 'thirds',
    lightAdvice: '阴天光线适合人像，避免大平光',
  },
  sunny: {
    ev: 0, wb: 'sunny', iso: '100', tint: '高饱和',
    advice: '经典日光参数，阴影处有丰富的细节层次',
    grid: 'golden',
    lightAdvice: '注意强光下的人脸测光，可适当加曝光补偿',
  },
};

// ===== 相机初始化 =====
async function initCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  try {
    const constraints = {
      video: {
        facingMode: S.facingMode,
        width:  { ideal: 1920 }, height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      }, audio: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = S.stream = stream;
    await video.play();
    resizeOverlay();
  } catch (e) { alert('相机启动失败，请检查权限设置。'); }
}

function resizeOverlay() {
  const w = video.videoWidth || video.clientWidth;
  const h = video.videoHeight || video.clientHeight;
  overlayCV.width = w; overlayCV.height = h;
}

// ===== AI 模型加载 =====
async function loadModels() {
  showTip('⏳ 加载 AI 模型中...');
  try {
    const [bf, mn] = await Promise.all([
      blazeface.load(),
      mobilenet.load({ version: 2, alpha: 1.0 }),
    ]);
    S.models.blazeface = bf; S.models.mobilenet = mn;
    S.aiReady = true;
    hideTip(); showTip('✅ AI 就绪', 1500);
  } catch (e) {
    S.aiReady = false;
    hideTip(); showTip('⚠️ AI 离线模式', 2500);
    console.warn('模型加载失败:', e);
  }
}

// ===== AI 场景分析（核心算法）=====
// 基于摄影分区曝光法 + 环境光检测
async function analyzeScene() {
  if (!S.aiReady || !video.readyState >= 2 || S.analyzing) return;
  const now = Date.now();
  if (now - S.lastAnalysis < 1200) return;
  S.lastAnalysis = now;
  S.analyzing = true;

  try {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { S.analyzing = false; return; }

    // 1. 采样帧数据做亮度分析（摄影分区曝光法）
    const lumSamples = sampleLuminance(video, 20);

    // 2. 人脸检测
    const faces = await S.models.blazeface.estimateFaces(video, false);

    if (faces.length > 0) {
      // === 检测到人像 ===
      const face = faces[0];
      const faceArea = ((face.bottomRight[0]-face.topLeft[0])/w)*((face.bottomRight[1]-face.topLeft[1])/h);
      const faceRatio = (face.bottomRight[0]-face.topLeft[0])/(face.bottomRight[1]-face.topLeft[1]);

      // 基于亮度判断逆光
      const backlit = lumSamples.contrast > 0.5 && faceArea < 0.04;
      // 场景判断
      const sceneType = backlit ? 'backlit' : 'portrait';
      const gender = faceRatio > 0.76 ? '女性' : '男性';

      S.scene = {
        type: '👤 人像',
        subject: `${gender}人像`,
        light: analyzeLightCondition(lumSamples),
        quality: analyzeExposureQuality(lumSamples),
        comp: 'thirds',
        ev: backlit ? 1.5 : 0,
        tint: '暖调偏柔',
        advice: backlit ? '逆光人像，建议开启补光或增加曝光补偿' : '标准人像，光线均匀表现佳',
        lightAdvice: backlit ? '对主体脸部点测光，开启 HDR' : '寻找柔和侧光，避免正午强光',
      };

      // 绘制人脸检测框
      drawFaceBox(face, w, h);

      // 自动应用人像模式参数
      applySceneParams(SCENE_PARAMS.portrait);

    } else {
      // === 风景/场景检测 ===
      const preds = await S.models.mobilenet.classify(video, 3);
      const sceneType = detectSceneType(preds, lumSamples);
      const params = SCENE_PARAMS[sceneType] || SCENE_PARAMS.sunny;
      const sceneLabel = getSceneLabel(sceneType);

      S.scene = {
        type: sceneLabel,
        subject: '—',
        light: analyzeLightCondition(lumSamples),
        quality: analyzeExposureQuality(lumSamples),
        comp: params.grid,
        ev: params.ev,
        tint: params.tint,
        advice: params.advice,
        lightAdvice: params.lightAdvice,
      };

      // 自动应用场景参数
      applySceneParams(params);

      // 绘制构图辅助线
      drawGrid(params.grid);
    }

    // 更新 AI 面板
    updateAIPanel();

    // 更新直方图
    if (S.auxMode === 'histogram') {
      document.getElementById('histogram-container').classList.add('visible');
      updateHistogram();
    }

  } catch (e) { console.warn('AI分析失败:', e); }
  S.analyzing = false;
}

// 基于亮度样本分析光照条件
function analyzeLightCondition(samples) {
  const { avgL, contrast, stdDev } = samples;
  if (avgL > 180) return '☀️ 强烈日光';
  if (avgL > 140) return '🌤️ 明亮户外';
  if (avgL > 90)  return '⛅ 均匀阴天';
  if (avgL > 50)  return '💡 室内人工光';
  if (avgL > 20)  return '🌙 弱光环境';
  return '🌑 极暗环境';
}

// 基于直方图分析曝光质量
function analyzeExposureQuality(samples) {
  const { avgL, stdDev, shadowRatio, highlightRatio } = samples;
  if (highlightRatio > 0.25) return '⚠️ 过曝，注意高光溢出';
  if (shadowRatio > 0.6)     return '⚠️ 欠曝，主体可能过暗';
  if (stdDev > 80)           return '✓ 高对比场景';
  if (stdDev > 30)           return '✓ 层次丰富';
  return '✓ 曝光均匀';
}

// 检测场景类型（综合 mobilenet 标签 + 亮度）
function detectSceneType(preds, lumSamples) {
  const topLabel = preds?.[0]?.className?.toLowerCase() || '';
  const avgL = lumSamples.avgL;

  if (/night|fireworks|spotlight|candle/.test(topLabel) || avgL < 30) return 'night';
  if (/beach|shore|seashore/.test(topLabel)) return 'sunny'; // 海边强光
  if (/forest|wood|woodland|tree|jungle/.test(topLabel)) return 'landscape';
  if (/mountain|peak|cliff|valley/.test(topLabel)) return 'landscape';
  if (/street|road|alley/.test(topLabel) && avgL > 60) return 'indoor';
  if (/sky|cloud|atmosphere/.test(topLabel)) return avgL > 140 ? 'sunny' : 'cloud';
  if (/indoor|room|home|house|office/.test(topLabel)) return 'indoor';
  if (/city|building|skyscraper/.test(topLabel)) return avgL > 100 ? 'landscape' : 'night';
  if (avgL < 50) return 'night';
  return 'landscape';
}

function getSceneLabel(type) {
  const map = {
    night: '🌙 夜景', landscape: '🏔️ 风景', portrait: '👤 人像',
    backlit: '🌗 逆光', macro: '🌸 微距', indoor: '🏠 室内',
    sports: '⚡ 运动', fireworks: '🎆 烟花', cloud: '⛅ 阴天', sunny: '☀️ 晴天',
  };
  return map[type] || '🏔️ 通用';
}

// 采样视频帧计算亮度（摄影分区曝光法）
function sampleLuminance(videoEl, gridN = 20) {
  const tmp = document.createElement('canvas');
  tmp.width = 80; tmp.height = 60;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, 80, 60);
  const data = ctx.getImageData(0, 0, 80, 60).data;

  let totalL = 0, totalL2 = 0, shadowCount = 0, highlightCount = 0;
  const pixels = [];
  for (let i = 0; i < data.length; i += 16) { // 每4像素取1个
    const l = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
    pixels.push(l);
    totalL += l;
    totalL2 += l * l;
    if (l < 30) shadowCount++;
    if (l > 220) highlightCount++;
  }
  const n = pixels.length;
  const avgL = totalL / n;
  const variance = totalL2/n - avgL*avgL;
  const stdDev = Math.sqrt(variance);

  return {
    avgL,
    stdDev,
    contrast: stdDev / 128,
    shadowRatio: shadowCount / n,
    highlightRatio: highlightCount / n,
    // 计算 EV 值（简化的摄影 EV 公式）
    ev: Math.log2((avgL / 255) * 4 + 0.1),
  };
}

// 自动应用场景参数
function applySceneParams(params) {
  if (S.shootMode === 'auto' && params) {
    S.evComp = params.ev || 0;
    document.getElementById('ev-slider').value = S.evComp;
    updateEVDisplay();
    // 切换构图辅助线
    if (params.grid && S.gridMode === 'off') {
      S.gridMode = params.grid;
    }
  }
}

// 更新 AI 分析面板
function updateAIPanel() {
  const s = S.scene;
  document.getElementById('ai-subject').textContent = s.subject || '—';
  document.getElementById('ai-scene').textContent = s.type || '—';
  document.getElementById('ai-light').textContent = s.light || '—';
  document.getElementById('ai-comp').textContent = s.comp ? `📐 ${s.comp.toUpperCase()}` : '—';
  document.getElementById('ai-ev').textContent = s.ev ? `EV ${s.ev > 0 ? '+' : ''}${s.ev}` : 'EV 0';
  document.getElementById('ai-tint').textContent = s.tint || '—';
  document.getElementById('ai-suggestion').textContent = s.advice || '';

  const badge = document.getElementById('scene-badge');
  badge.textContent = s.type || '';
  badge.classList.remove('hidden');
}

// ===== 绘制辅助线 =====
// 三分法（Rule of Thirds）- 最经典构图法则
function drawGrid(mode) {
  overlayCtx.clearRect(0, 0, overlayCV.width, overlayCV.height);
  const w = overlayCV.width, h = overlayCV.height;
  overlayCtx.strokeStyle = 'rgba(255,255,255,0.4)';
  overlayCtx.lineWidth = 1;
  overlayCtx.setLineDash([6, 5]);

  switch (mode) {
    case 'thirds':
      for (let i = 1; i <= 2; i++) {
        overlayCtx.beginPath(); overlayCtx.moveTo(w*i/3,0); overlayCtx.lineTo(w*i/3,h); overlayCtx.stroke();
        overlayCtx.beginPath(); overlayCtx.moveTo(0,h*i/3); overlayCtx.lineTo(w,h*i/3); overlayCtx.stroke();
      }
      // 高亮四个黄金交叉点
      const pts = [[w/3,h/3],[w*2/3,h/3],[w/3,h*2/3],[w*2/3,h*2/3]];
      pts.forEach(p => {
        overlayCtx.beginPath(); overlayCtx.arc(p[0],p[1],6,0,Math.PI*2);
        overlayCtx.fillStyle='rgba(255,179,71,0.6)'; overlayCtx.fill();
      });
      break;
    case 'golden':
      const phi = 0.618;
      for (let i = 1; i <= 2; i++) {
        overlayCtx.beginPath(); overlayCtx.moveTo(w*Math.pow(phi,i),0); overlayCtx.lineTo(w*Math.pow(phi,i),h); overlayCtx.stroke();
        overlayCtx.beginPath(); overlayCtx.moveTo(0,h*Math.pow(phi,i)); overlayCtx.lineTo(w,h*Math.pow(phi,i)); overlayCtx.stroke();
      }
      break;
    case 'center':
      overlayCtx.beginPath(); overlayCtx.arc(w/2,h/2,Math.min(w,h)*0.18,0,Math.PI*2); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.moveTo(w/2,0); overlayCtx.lineTo(w/2,h); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.moveTo(0,h/2); overlayCtx.lineTo(w,h/2); overlayCtx.stroke();
      break;
    case 'diag':
      overlayCtx.beginPath(); overlayCtx.moveTo(0,0); overlayCtx.lineTo(w,h); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.moveTo(w,0); overlayCtx.lineTo(0,h); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.arc(w/2,h/2,Math.min(w,h)*0.26,0,Math.PI*2); overlayCtx.stroke();
      break;
  }
  overlayCtx.setLineDash([]);
  S.gridMode = mode;
}

// 绘制人脸检测框
function drawFaceBox(face, w, h) {
  overlayCtx.clearRect(0, 0, w, h);
  const vw = video.clientWidth, vh = video.clientHeight;
  const sx = vw/w, sy = vh/h;
  // 镜像翻转
  const fx = (w - face.topLeft[0]) * sx;
  const fy = face.topLeft[1] * sy;
  const fw = (face.bottomRight[0] - face.topLeft[0]) * sx;
  const fh = (face.bottomRight[1] - face.topLeft[1]) * sy;

  overlayCtx.strokeStyle = '#4ECDC4'; overlayCtx.lineWidth = 2;
  overlayCtx.setLineDash([5,4]);
  overlayCtx.strokeRect(fx - fw, fy, fw, fh);
  overlayCtx.setLineDash([]);

  // 人脸区域提示
  const faceRatio = fw / fh;
  const gender = faceRatio > 0.76 ? '👩 女性' : '👨 男性';
  const area = (fw*fh)/(vw*vh);
  const age = area > 0.12 ? '成人' : area > 0.04 ? '近景' : '全身';
  overlayCtx.font = 'bold 12px sans-serif';
  overlayCtx.fillStyle = 'rgba(0,0,0,0.6)';
  const label = `${gender} · ${age}`;
  overlayCtx.fillRect(fx - fw + 4, fy + 4, overlayCtx.measureText(label).width + 8, 20);
  overlayCtx.fillStyle = '#4ECDC4';
  overlayCtx.fillText(label, fx - fw + 8, fy + 18);
}

// ===== 实时直方图 =====
function updateHistogram() {
  const tmp = document.createElement('canvas');
  tmp.width = 80; tmp.height = 40;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(video, 0, 0, 80, 40);
  const imgData = ctx.getImageData(0, 0, 80, 40).data;

  // 统计 RGB 三通道 + 亮度直方图
  const bins = new Array(64).fill(0);
  for (let i = 0; i < imgData.length; i += 16) {
    const l = Math.floor((imgData[i]*0.299 + imgData[i+1]*0.587 + imgData[i+2]*0.114) / 4);
    bins[Math.min(63, l)]++;
  }
  const maxBin = Math.max(...bins);

  histCtx.clearRect(0, 0, 80, 40);

  // 亮度直方图
  bins.forEach((count, i) => {
    const barH = (count / maxBin) * 35;
    const hue = i * 2; // 黑色到白色
    histCtx.fillStyle = `hsl(${hue},60%,55%)`;
    histCtx.fillRect(i, 40 - barH, 1, barH);
  });

  // 绘制分区线（阴影/中间调/高光）
  histCtx.strokeStyle = 'rgba(255,255,255,0.3)';
  histCtx.lineWidth = 0.5;
  [16, 48].forEach(x => {
    histCtx.beginPath(); histCtx.moveTo(x, 0); histCtx.lineTo(x, 40); histCtx.stroke();
  });
}

// ===== 斑马纹（Zebra Pattern）=====
// 模拟专业摄像机的斑马纹功能：标记超过设定阈值的高光区域
function drawZebraPattern(threshold = 220) {
  const tmp = document.createElement('canvas');
  tmp.width = Math.min(320, video.videoWidth); tmp.height = Math.min(240, video.videoHeight);
  const ctx = tmp.getContext('2d');
  ctx.drawImage(video, 0, 0, tmp.width, tmp.height);
  const imgData = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
  const w = tmp.width, h = tmp.height;

  // 缩小回 overlay
  const scaleX = overlayCV.width / w, scaleY = overlayCV.height / h;
  overlayCtx.clearRect(0, 0, overlayCV.width, overlayCV.height);

  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * 4;
      const luma = imgData[i]*0.299 + imgData[i+1]*0.587 + imgData[i+2]*0.114;
      if (luma > threshold) {
        overlayCtx.fillStyle = `rgba(255,0,0,${(luma - threshold) / 35 * 0.35})`;
        overlayCtx.fillRect(x * scaleX, y * scaleY, 3 * scaleX + 1, 3 * scaleY + 1);
      }
    }
  }
}

// ===== 对焦峰值（Focus Peaking）=====
// 使用 Sobel 边缘检测突出显示合焦区域
function drawFocusPeaking(threshold = 30) {
  const tmp = document.createElement('canvas');
  tmp.width = Math.min(240, video.videoWidth);
  tmp.height = Math.min(180, video.videoHeight);
  const ctx = tmp.getContext('2d');
  ctx.drawImage(video, 0, 0, tmp.width, tmp.height);
  const imgData = ctx.getImageData(0, 0, tmp.width, tmp.height);
  const w = tmp.width, h = tmp.height;

  const sx = overlayCV.width / w, sy = overlayCV.height / h;
  overlayCtx.clearRect(0, 0, overlayCV.width, overlayCV.height);

  const sobel = computeSobelEdges(imgData, w, h);
  const maxEdge = Math.max(...sobel);

  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const v = sobel[y * w + x];
      if (v > threshold) {
        const intensity = v / maxEdge;
        overlayCtx.fillStyle = `rgba(255,50,50,${intensity * 0.7})`;
        overlayCtx.fillRect(x * sx, y * sy, sx * 3, sy * 3);
      }
    }
  }
}

// Sobel 边缘检测算子
function computeSobelEdges(imgData, w, h) {
  const data = imgData.data;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const toL = (dy, dx) => {
        const ni = ((y+dy)*w+(x+dx))*4;
        return data[ni]*0.299 + data[ni+1]*0.587 + data[ni+2]*0.114;
      };
      const gx = -toL(-1,-1) - 2*toL(0,-1) - toL(1,-1) + toL(-1,1) + 2*toL(0,1) + toL(1,1);
      const gy = -toL(-1,-1) - 2*toL(-1,0) - toL(-1,1) + toL(1,-1) + 2*toL(1,0) + toL(1,1);
      out[i] = Math.sqrt(gx*gx + gy*gy);
    }
  }
  return out;
}

// ===== 水平仪（DeviceOrientation）=====
let lastGamma = 0;
function startLevel() {
  if (!window.DeviceOrientationEvent) return;
  window.addEventListener('deviceorientation', e => {
    const gamma = e.gamma || 0; // 左右倾斜 -90~90
    const clamped = Math.max(-30, Math.min(30, gamma));
    const pct = (clamped / 30) * 100;
    levelBubble.style.left = `calc(50% - 6px + ${pct * 0.48}px)`;
    levelBubble.style.background = Math.abs(gamma) < 2 ? '#4ECDC4' : '#FFB347';
  }, true);
}

// ===== 触摸对焦 =====
document.getElementById('camera-container').addEventListener('click', e => {
  if (S.shootMode === 'video' || S.shootMode === 'pro') {
    const rect = video.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    showFocusRing(x, y);
    // 尝试触发对焦（Web API 限制，只能视觉反馈）
    triggerFocus(x, y);
  }
});

function showFocusRing(x, y) {
  focusRing.style.left = x + 'px';
  focusRing.style.top = y + 'px';
  focusRing.classList.remove('hidden');
  // 重新触发动画
  focusRing.style.animation = 'none';
  requestAnimationFrame(() => {
    focusRing.style.animation = '';
  });
  setTimeout(() => focusRing.classList.add('hidden'), 1200);
}

function triggerFocus(x, y) {
  // 尝试使用 ImageCapture API 触发对焦
  const track = S.stream?.getVideoTracks()[0];
  if (!track) return;
  try {
    if ('getCapabilities' in track) {
      const cap = track.getCapabilities();
      if (cap.focusMode?.includes('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
    }
  } catch (e) {}
}

// ===== 曝光补偿 =====
function updateEVDisplay() {
  const ev = S.evComp;
  document.getElementById('ev-display').textContent = `EV ${ev > 0 ? '+' : ''}${ev}`;
  // 调整视频亮度（CSS filter 模拟）
  const brightness = 1 + ev * 0.2;
  video.style.filter = `brightness(${brightness}) ${FILTERS[S.filter]?.css || 'none'}`;
}
document.getElementById('ev-slider').addEventListener('input', e => {
  S.evComp = parseFloat(e.target.value);
  updateEVDisplay();
  // 更新 AI 面板
  document.getElementById('ai-ev').textContent = `EV ${S.evComp > 0 ? '+' : ''}${S.evComp}`;
});

// ===== AI 提示 =====
function showTip(text, duration = 0) {
  aiTip.textContent = text;
  aiTip.classList.remove('hidden');
  aiTip.classList.add('visible');
  if (duration > 0) setTimeout(hideTip, duration);
}
function hideTip() {
  aiTip.classList.remove('visible');
  aiTip.classList.add('hidden');
}

// ===== 专业辅助线渲染器 =====
function renderAuxMode() {
  if (S.auxMode === 'zebra') {
    drawZebraPattern(210);
  } else if (S.auxMode === 'peaking') {
    drawFocusPeaking(25);
  } else if (S.gridMode !== 'off') {
    drawGrid(S.gridMode);
  } else {
    overlayCtx.clearRect(0, 0, overlayCV.width, overlayCV.height);
  }
}

// ===== 拍照 =====
async function capture() {
  const btn = document.getElementById('btn-capture');
  btn.classList.add('shooting');
  setTimeout(() => btn.classList.remove('shooting'), 700);

  const cv = document.createElement('canvas');
  cv.width = video.videoWidth; cv.height = video.videoHeight;
  const ctx = cv.getContext('2d');
  ctx.save();
  ctx.translate(cv.width, 0); ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0);
  ctx.restore();

  // 应用滤镜
  cv.style.filter = FILTERS[S.filter]?.css || 'none';

  const origURL = cv.toDataURL('image/jpeg', 0.95);
  showResult(origURL, true);
}

function showResult(origURL, autoBeautify = true) {
  const modal = document.getElementById('result-modal');
  const origImg = document.getElementById('result-original');
  const enhancedCV = document.getElementById('result-enhanced');
  origImg.src = origURL;
  document.getElementById('result-tag').textContent = autoBeautify ? '✨ AI 美化中...' : '📷 照片已保存';
  document.getElementById('result-actions').classList.add('hidden');
  modal.classList.remove('hidden');

  if (autoBeautify) {
    setTimeout(() => {
      enhancedCV.width = cv.width; enhancedCV.height = cv.height;
      enhancedCV.getContext('2d').drawImage(cv, 0, 0);
      const url = applyBeauty(enhancedCV);
      document.getElementById('result-tag').textContent = '✅ 美化完成 · ' + (FILTERS[S.filter]?.label || '原图');
      document.getElementById('result-actions').classList.remove('hidden');
      enhancedCV.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;z-index:-1;';
      enhancedCV.dataset.url = url;
    }, 600);
  }
}

// ===== AI 美颜（双边滤波 + 美白）=====
function bilateralSmooth(data, w, h, r) {
  const src = new Uint8ClampedArray(data);
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const idx = (y*w+x)*4;
      let rn=0,gn=0,bn=0,sum=0;
      for (let dy=-r; dy<=r; dy++) {
        for (let dx=-r; dx<=r; dx++) {
          const ni = ((y+dy)*w+(x+dx))*4;
          const cd = Math.sqrt((src[idx]-src[ni])**2+(src[idx+1]-src[ni+1])**2+(src[idx+2]-src[ni+2])**2);
          const sd = Math.sqrt(dx*dx+dy*dy)/r;
          const w2 = Math.exp(-sd*1.5 - cd*0.04);
          rn+=src[ni]*w2; gn+=src[ni+1]*w2; bn+=src[ni+2]*w2; sum+=w2;
        }
      }
      data[idx]=rn/sum; data[idx+1]=gn/sum; data[idx+2]=bn/sum;
    }
  }
}

function applyBeauty(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  if (S.beauty.whiten > 0) {
    const b = S.beauty.whiten * 0.85;
    for (let i = 0; i < d.length; i += 4) {
      d[i]=Math.min(255,d[i]+b); d[i+1]=Math.min(255,d[i+1]+b); d[i+2]=Math.min(255,d[i+2]+b);
    }
  }
  if (S.beauty.smooth > 20) bilateralSmooth(d, w, h, Math.round(S.beauty.smooth/20));
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.95);
}

// ===== 视频录制 =====
function startRecording() {
  if (!S.stream) return;
  const options = { mimeType: 'video/webm;codecs=vp9' };
  try { S.mediaRecorder = new MediaRecorder(S.stream, options); }
  catch (e) { S.mediaRecorder = new MediaRecorder(S.stream); }

  S.recordedChunks = [];
  S.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) S.recordedChunks.push(e.data); };
  S.mediaRecorder.onstop = () => {
    const blob = new Blob(S.recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `video_${Date.now()}.webm`; a.click();
    URL.revokeObjectURL(url);
  };
  S.mediaRecorder.start(100);
  S.isRecording = true; S.recordingStart = Date.now();
  document.getElementById('recording-indicator').classList.remove('hidden');
  updateRecTime();
}

function stopRecording() {
  if (S.mediaRecorder && S.isRecording) {
    S.mediaRecorder.stop();
    S.isRecording = false;
    document.getElementById('recording-indicator').classList.add('hidden');
  }
}

function updateRecTime() {
  if (!S.isRecording) return;
  const elapsed = Math.floor((Date.now() - S.recordingStart) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  document.getElementById('rec-time').textContent = `${m}:${s}`;
  setTimeout(updateRecTime, 1000);
}

// ===== 事件绑定 =====

// 拍摄模式切换
document.querySelectorAll('.shoot-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.shoot-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.shootMode = btn.dataset.mode;

    const proPanel = document.getElementById('pro-panel');
    const modeInfo = document.getElementById('btn-mode-info');
    const captureBtn = document.getElementById('btn-capture');
    const histContainer = document.getElementById('histogram-container');

    // 重置辅助模式
    proPanel.classList.add('hidden');
    histContainer.classList.remove('visible');
    S.auxMode = 'none';
    document.getElementById('level-indicator').classList.remove('visible');

    switch (S.shootMode) {
      case 'auto':
        modeInfo.textContent = 'AI智能';
        captureBtn.classList.remove('video-mode');
        captureBtn.textContent = '●';
        S.gridMode = 'off';
        overlayCtx.clearRect(0, 0, overlayCV.width, overlayCV.height);
        break;
      case 'portrait':
        modeInfo.textContent = '人像模式';
        captureBtn.classList.remove('video-mode');
        captureBtn.textContent = '●';
        S.gridMode = 'thirds';
        drawGrid('thirds');
        break;
      case 'landscape':
        modeInfo.textContent = '风景模式';
        captureBtn.classList.remove('video-mode');
        captureBtn.textContent = '●';
        S.gridMode = 'golden';
        drawGrid('golden');
        break;
      case 'pro':
        modeInfo.textContent = '专业模式';
        captureBtn.classList.remove('video-mode');
        captureBtn.textContent = '●';
        proPanel.classList.remove('hidden');
        S.gridMode = 'off';
        overlayCtx.clearRect(0, 0, overlayCV.width, overlayCV.height);
        break;
      case 'video':
        modeInfo.textContent = '视频模式';
        captureBtn.classList.add('video-mode');
        captureBtn.textContent = '●';
        S.gridMode = 'off';
        overlayCtx.clearRect(0, 0, overlayCV.width, overlayCV.height);
        break;
    }
    document.getElementById('mode-badge').textContent =
      { auto: '📷 AI智能', portrait: '👤 人像', landscape: '🏔️ 风景', pro: '⚙️ 专业', video: '🎬 视频' }[S.shootMode] || '📷';
  });
});

// 专业参数按钮
document.querySelectorAll('[data-grid]').forEach(btn => {
  btn.addEventListener('click', () => {
    const parent = btn.parentElement;
    parent.querySelectorAll('.pro-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const grid = btn.dataset.grid;
    S.gridMode = grid === 'off' ? 'off' : grid;
    if (grid === 'off') overlayCtx.clearRect(0, 0, overlayCV.width, overlayCV.height);
    else drawGrid(grid);
  });
});

document.querySelectorAll('[data-aux]').forEach(btn => {
  btn.addEventListener('click', () => {
    const parent = btn.parentElement;
    parent.querySelectorAll('.pro-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.auxMode = btn.dataset.aux;
    document.getElementById('level-indicator').classList.toggle('visible', S.auxMode === 'level');
    document.getElementById('histogram-container').classList.toggle('visible', S.auxMode === 'histogram');
    if (!['level','histogram'].includes(S.auxMode)) renderAuxMode();
  });
});

document.querySelectorAll('#wb-values .pro-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.parentElement.querySelectorAll('.pro-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.wb = btn.dataset.value;
  });
});

document.querySelectorAll('#iso-values .pro-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.parentElement.querySelectorAll('.pro-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.iso = btn.dataset.value;
  });
});

// 底部操作
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
  S.flashMode = modes[(idx+1) % modes.length];
  document.getElementById('btn-flash').textContent = S.flashMode === 'on' ? '💡' : '⚡';
  S.stream?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: S.flashMode === 'on' }] }).catch(()=>{});
});

document.getElementById('btn-gallery').addEventListener('click', () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,video/*';
  inp.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.type.startsWith('video/')) {
      const url = URL.createObjectURL(f);
      const a = document.createElement('a'); a.href = url; a.download = f.name; a.click();
    } else {
      const reader = new FileReader();
      reader.onload = ev => showResult(ev.target.result, false);
      reader.readAsDataURL(f);
    }
  };
  inp.click();
});

// 结果弹窗
document.getElementById('btn-save').addEventListener('click', () => {
  const url = document.getElementById('result-original').src;
  downloadFile(url, `photo_${Date.now()}.jpg`);
});
document.getElementById('btn-save-pro').addEventListener('click', () => {
  const url = document.getElementById('result-enhanced').dataset.url;
  if (url) downloadFile(url, `photo_beauty_${Date.now()}.jpg`);
});
document.getElementById('btn-share').addEventListener('click', () => {
  const url = document.getElementById('result-enhanced').dataset.url || document.getElementById('result-original').src;
  if (navigator.share) {
    fetch(url).then(r => r.blob()).then(blob => {
      const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
      navigator.share({ files: [file], title: 'AI 摄影作品' });
    });
  } else {
    downloadFile(url, `photo_${Date.now()}.jpg`);
  }
});
document.getElementById('btn-retake').addEventListener('click', () => {
  document.getElementById('result-modal').classList.add('hidden');
});

function downloadFile(url, name) {
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
}

// 美颜滑块（通过 AI 面板）
['smooth','whiten','eyes','slim'].forEach(k => {
  const el = document.getElementById(k);
  if (el) el.addEventListener('input', () => {
    S.beauty[k] = parseInt(el.value);
    const v = document.getElementById('v-'+k);
    if (v) v.textContent = el.value;
  });
});

// 窗口尺寸
window.addEventListener('resize', resizeOverlay);

// ===== AI 主循环 =====
function aiLoop() {
  if (S.shootMode === 'auto' || S.shootMode === 'portrait' || S.shootMode === 'landscape') {
    analyzeScene();
  }
  if (S.auxMode === 'zebra' || S.auxMode === 'peaking') {
    renderAuxMode();
  }
  if (S.auxMode === 'histogram') {
    updateHistogram();
  }
  // 更新相机信息栏
  document.getElementById('iso-display').textContent = `ISO ${S.iso === 'auto' ? '—' : S.iso}`;

  setTimeout(aiLoop, S.shootMode === 'auto' ? 400 : 1500);
}

// ===== 启动 =====
(async () => {
  await initCamera();
  startLevel();
  await loadModels();
  aiLoop();
  // 隐藏 AI 提示
  aiTip.classList.add('hidden');
  document.getElementById('btn-mode-info').textContent = 'AI智能';
})();
