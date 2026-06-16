// =================================================================
//  AI 摄影大师 v6.0 — 完整版
//  1. 智能场景识别  2. 动态AR指导  3. 自动参数引擎  4. 后期编辑
// =================================================================
'use strict';

/* ==================== 全局状态 ==================== */
const S = {
  stream: null, facing: 'user', flash: 'off',
  mode: 'auto', // auto|portrait|landscape|food|pet|night|pro
  // AI 模型
  models: { blazeface: null, mobilenet: null }, aiReady: false,
  // 分析结果
  scene: { type:'—', sub:'—', light:'—', comp:'—' },
  // 自动参数
  p: { iso:100, ape:'2.8', ss:'1/60', ev:0, wb:5500, sat:100, shp:0, dof:'中' },
  // 渲染状态
  rParams: { brightness:0, contrast:0, saturation:0, temp:0, sharp:0, vignette:0, bokeh:0, fade:0 },
  // 拍照
  photoData: null, // ImageData of captured photo
  photoImg: null,  // Image element
  // 抠图
  cutout: { mask:null, brushSize:20, mode:'keep', history:[] },
};

/* ==================== DOM ==================== */
const $ = id => document.getElementById(id);
const video = $('cam'), renderCV = $('render-cv'), renderCtx = renderCV.getContext('2d');
const guideCV = $('guide-cv'), guideCtx = guideCV.getContext('2d');
const histCV = $('hist-cv'), histCtx = histCV.getContext('2d');

/* ==================== 相机初始化 ==================== */
async function initCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: S.facing, width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30} }, audio: false
    });
    video.srcObject = S.stream;
    await video.play();
    resizeCanvases();
    renderLoop();
    aiLoop();
  } catch(e) { toast('⚠️ 相机权限被拒绝'); }
}

function resizeCanvases() {
  const w = video.videoWidth||640, h = video.videoHeight||480;
  [renderCV, guideCV].forEach(c => { c.width=w; c.height=h; });
}

/* ==================== 第一部分：智能场景识别 ==================== */

// 低分辨率帧采样
const SW=160, SH=120;
function sampleFrame() {
  const c = document.createElement('canvas'); c.width=SW; c.height=SH;
  const ctx = c.getContext('2d');
  ctx.drawImage(video, 0, 0, SW, SH);
  return ctx.getImageData(0, 0, SW, SH);
}

// 帧分析
function analyzeFrame(imgData) {
  const d = imgData.data, n = d.length/4;
  let sumR=0,sumG=0,sumB=0,sumL=0,sumL2=0,minL=255,maxL=0,shadow=0,highlight=0;
  let totalSat=0, oversat=0;

  for (let i=0; i<d.length; i+=4) {
    const r=d[i],g=d[i+1],b=d[i+2];
    const L = .2126*r + .7152*g + .0722*b;
    sumR+=r; sumG+=g; sumB+=b; sumL+=L; sumL2+=L*L;
    if(L<minL) minL=L; if(L>maxL) maxL=L;
    if(L<30) shadow++; else if(L>220) highlight++;
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
    totalSat += mx===0 ? 0 : (mx-mn)/mx;
    if(Math.abs(r-g)>80||Math.abs(g-b)>80||Math.abs(r-b)>80) oversat++;
  }

  const avgL=sumL/n, std=Math.sqrt(Math.max(0,sumL2/n-avgL*avgL));
  const dynamicRange=maxL-minL;
  const rmsContrast=std/128;
  const avgSat=totalSat/n;

  return { avgL, std, rmsContrast, dynamicRange, minL, maxL,
    shadowR:shadow/n, highlightR:highlight/n,
    avgR:sumR/n, avgG:sumG/n, avgB:sumB/n,
    avgSat, oversatR:oversat/n,
    wb: Math.round(6500*(avgG/((avgR+avgB)/2+.1)))
  };
}

// 综合场景识别
async function detectScene(imgData, frame) {
  const result = { type:'通用', sub:'其他', light:'正常光', comp:'三分法', faces:[] };

  // 人脸检测
  try {
    if (S.models.blazeface) {
      const faces = await S.models.blazeface.estimateFaces(video, false);
      result.faces = faces;
      if (faces.length > 0) {
        const f = faces[0];
        const fw = f.bottomRight[0]-f.topLeft[0], fh = f.bottomRight[1]-f.topLeft[1];
        const area = fw*fh/(video.videoWidth*video.videoHeight);
        result.type = '人像';
        if (area > .08) result.sub = '特写';
        else if (area > .03) result.sub = '半身';
        else result.sub = '全身';
      }
    }
  } catch(e) {}

  // MobileNet 场景分类
  try {
    if (S.models.mobilenet) {
      const preds = await S.models.mobilenet.classify(video, 3);
      if (preds?.[0]) {
        const label = preds[0].className.toLowerCase();
        const conf = preds[0].probability;
        if (conf > .3) {
          if (/person|portrait|face/.test(label) && result.type !== '人像') {
            result.type='人像'; result.sub='人物';
          } else if (/mountain|valley|cliff|peak/.test(label)) {
            result.type='风景'; result.sub='山峰';
          } else if (/seashore|coast|ocean|beach|lake/.test(label)) {
            result.type='风景'; result.sub='海景';
          } else if (/city|building|bridge|tower|skyscraper|street/.test(label)) {
            result.type='风景'; result.sub='城市';
          } else if (/food|meal|dish|pizza|burger|sushi|cake/.test(label)) {
            result.type='美食'; result.sub='料理';
          } else if (/dog|cat|bird|fish|hamster|rabbit|pet/.test(label)) {
            result.type='宠物'; result.sub='动物';
          } else if (/flower|rose|daisy|sunflower|garden/.test(label)) {
            result.type='风景'; result.sub='花卉';
          } else if (/car|truck|bus|vehicle/.test(label)) {
            result.type='其他'; result.sub='车辆';
          } else if (/night|dark|sunset|dawn|twilight/.test(label) || frame.avgL < 40) {
            result.type='夜景'; result.sub='夜间';
          }
        }
      }
    }
  } catch(e) {}

  // 亮度兜底
  if (frame.avgL < 35 && result.type==='通用') { result.type='夜景'; result.sub='暗光'; }

  // 光线条件
  if (result.type === '人像') {
    result.comp = '三分法·黄金交叉';
  } else if (result.type === '风景') {
    result.comp = result.sub === '海景' ? '水平线·三分法' : result.sub === '城市' ? '引导线·透视' : '三分法·层次';
  } else if (result.type === '美食') {
    result.comp = '45°俯拍·居中';
  } else if (result.type === '宠物') {
    result.comp = '视平线·三分法';
  }

  // 光线分析
  if (frame.highlightR > .12 && frame.shadowR > .25) result.light = '🌤️ 逆光';
  else if (frame.avgL > 180) result.light = '☀️ 强光';
  else if (frame.avgL > 130) result.light = '🌤️ 明亮';
  else if (frame.avgL > 80) result.light = '⛅ 均匀';
  else if (frame.avgL > 40) result.light = '💡 暗光';
  else result.light = '🌑 弱光';

  if (frame.rmsContrast < .25) result.light += '·低对比';
  if (frame.dynamicRange < 80) result.light += '·雾霾';

  return result;
}

/* ==================== 第二部分：自动参数引擎 ==================== */

function calcParams(scene, frame) {
  const p = { iso:100, ape:'2.8', ss:'1/60', ev:0, wb:5500, sat:100, shp:0, dof:'中' };

  // --- EV 曝光补偿 ---
  const targetL = scene.type==='人像' ? 145 : scene.type==='夜景' ? 75 : 118;
  const deltaL = targetL - frame.avgL;
  p.ev = Math.round(deltaL / 18 * 3) / 3;
  p.ev = Math.max(-3, Math.min(3, p.ev));

  // 高光/阴影保护
  if (frame.highlightR > .15) p.ev -= .5;
  if (scene.light.includes('逆光')) p.ev += 1;
  if (frame.shadowR > .5 && frame.avgL < 60) p.ev += .5;

  // --- ISO + 快门 ---
  const L = frame.avgL;
  if (L < 25) { p.iso=3200; p.ss='1/15'; }
  else if (L < 45) { p.iso=1600; p.ss='1/30'; }
  else if (L < 70) { p.iso=800; p.ss='1/60'; }
  else if (L < 110) { p.iso=400; p.ss='1/125'; }
  else if (L < 160) { p.iso=200; p.ss='1/250'; }
  else { p.iso=100; p.ss='1/500'; }

  // 场景调整
  if (scene.type==='人像') {
    p.ape = scene.sub==='特写' ? '1.8' : '2.2';
    p.dof = scene.sub==='特写' ? '浅' : '中';
    p.sat = 108; p.shp = 10;
  } else if (scene.type==='风景') {
    p.ape = '8.0'; p.dof = '深'; p.sat = 120; p.shp = 20;
    p.iso = Math.max(100, Math.floor(p.iso * .7));
  } else if (scene.type==='美食') {
    p.ape = '2.0'; p.dof = '浅'; p.sat = 125; p.shp = 15;
  } else if (scene.type==='宠物') {
    p.ape = '2.8'; p.dof = '中'; p.sat = 105; p.shp = 10;
    p.ss = '1/200'; // 更快快门防抖
  } else if (scene.type==='夜景') {
    p.iso = Math.min(3200, p.iso * 2);
    p.sat = 90; p.shp = 0;
    p.ape = '1.8'; p.dof = '浅';
  }

  // 白平衡
  p.wb = Math.max(3000, Math.min(9000, frame.wb));
  if (scene.light.includes('强光')) p.wb = Math.min(p.wb, 5200);
  if (scene.light.includes('暗光')) p.wb = Math.max(p.wb, 5800);

  // 光线调整
  if (frame.rmsContrast < .25) { p.contrastBoost = 1.25; p.shp = Math.max(p.shp, 20); }
  else p.contrastBoost = 1.0;

  // 低饱和度场景增强
  if (frame.avgSat < .2 && frame.std < 15) { p.sat = Math.max(p.sat, 120); }

  return p;
}

/* ==================== 第三部分：实时渲染引擎 ==================== */

let lastRender = 0;
function renderLoop() {
  const now = performance.now();
  if (now - lastRender < 33) { requestAnimationFrame(renderLoop); return; }
  lastRender = now;
  if (video.readyState < 2) { requestAnimationFrame(renderLoop); return; }

  const w = renderCV.width, h = renderCV.height;
  if (!w) { requestAnimationFrame(renderLoop); return; }

  renderCtx.clearRect(0, 0, w, h);
  renderCtx.save(); renderCtx.translate(w,0); renderCtx.scale(-1,1);
  renderCtx.drawImage(video, 0, 0); renderCtx.restore();

  // 获取图像
  const imgData = renderCtx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // 白平衡
  const wbOff = (S.p.wb - 5500) / 1000;
  for (let i=0;i<d.length;i+=4) {
    d[i] = Math.min(255,Math.max(0, d[i] + wbOff*12));
    d[i+2] = Math.min(255,Math.max(0, d[i+2] - wbOff*12));
  }

  // 曝光
  if (Math.abs(S.p.ev) > .01) {
    const f = Math.pow(2, S.p.ev);
    for (let i=0;i<d.length;i+=4) {
      d[i]=Math.min(255,d[i]*f|0); d[i+1]=Math.min(255,d[i+1]*f|0); d[i+2]=Math.min(255,d[i+2]*f|0);
    }
  }

  // 对比度
  if (S.p.contrastBoost && S.p.contrastBoost !== 1) {
    const cf = S.p.contrastBoost;
    for (let i=0;i<d.length;i+=4) {
      for (let c=0;c<3;c++) {
        const v = d[i+c]/255 - .5;
        const s = 1/(1+Math.exp(-(cf-1)*2*6*v));
        d[i+c] = Math.min(255, Math.max(0, s*255|0));
      }
    }
  }

  // 饱和度
  const satMul = S.p.sat / 100;
  if (Math.abs(satMul - 1) > .01) {
    for (let i=0;i<d.length;i+=4) {
      const r=d[i],g=d[i+1],b=d[i+2];
      const mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2;
      if (mx===mn) continue;
      const delta=mx-mn, s=delta/(255-Math.abs(2*l-255)+1);
      const ns=Math.min(1,s*satMul);
      const a=ns===0?0:delta/ns, nmx=l+ns*128, nmn=2*l-nmx;
      let nr,ng,nb;
      if(r===mx){nr=nmx;ng=l+(g-mn)/delta*(nmx-nmn);nb=nmn;}
      else if(g===mx){ng=nmx;nr=l+(r-mn)/delta*(nmx-nmn);nb=nmn;}
      else{nb=nmx;nr=l+(r-mn)/delta*(nmx-nmn);ng=nmn;}
      d[i]=Math.max(0,Math.min(255,nr|0)); d[i+1]=Math.max(0,Math.min(255,ng|0)); d[i+2]=Math.max(0,Math.min(255,nb|0));
    }
  }

  renderCtx.putImageData(imgData, 0, 0);

  requestAnimationFrame(renderLoop);
}

/* ==================== 第四部分：AR 指导层 ==================== */

function drawGuides() {
  const w = guideCV.width, h = guideCV.height;
  if (!w) return;
  guideCtx.clearRect(0,0,w,h);
  guideCtx.strokeStyle = 'rgba(255,255,255,.3)';
  guideCtx.lineWidth = 1;
  guideCtx.setLineDash([8,6]);

  const scene = S.scene;

  // 三分法（所有模式通用）
  if (scene.type !== '美食') {
    for (let i=1;i<=2;i++) {
      guideCtx.beginPath(); guideCtx.moveTo(w*i/3,0); guideCtx.lineTo(w*i/3,h); guideCtx.stroke();
      guideCtx.beginPath(); guideCtx.moveTo(0,h*i/3); guideCtx.lineTo(w,h*i/3); guideCtx.stroke();
    }
    // 交叉点
    [[w/3,h/3],[w*2/3,h/3],[w/3,h*2/3],[w*2/3,h*2/3]].forEach(([x,y])=>{
      guideCtx.beginPath(); guideCtx.arc(x,y,4,0,Math.PI*2);
      guideCtx.fillStyle='rgba(255,179,71,.5)'; guideCtx.fill();
    });
  }

  // 风景模式：引导线 + 地平线
  if (scene.type === '风景') {
    // 地平线参考（画面1/3处）
    guideCtx.strokeStyle = 'rgba(78,205,196,.4)';
    guideCtx.setLineDash([12,8]);
    guideCtx.beginPath(); guideCtx.moveTo(0,h/3); guideCtx.lineTo(w,h/3); guideCtx.stroke();
    // 对角引导线
    guideCtx.strokeStyle = 'rgba(255,179,71,.2)';
    guideCtx.beginPath(); guideCtx.moveTo(0,0); guideCtx.lineTo(w,h); guideCtx.stroke();
    guideCtx.beginPath(); guideCtx.moveTo(w,0); guideCtx.lineTo(0,h); guideCtx.stroke();
  }

  // 美食模式：中心圆
  if (scene.type === '美食') {
    guideCtx.strokeStyle = 'rgba(255,179,71,.35)';
    guideCtx.setLineDash([]);
    guideCtx.beginPath(); guideCtx.arc(w/2,h/2,Math.min(w,h)*.25,0,Math.PI*2); guideCtx.stroke();
    // 十字
    guideCtx.beginPath(); guideCtx.moveTo(w/2-20,h/2); guideCtx.lineTo(w/2+20,h/2); guideCtx.stroke();
    guideCtx.beginPath(); guideCtx.moveTo(w/2,h/2-20); guideCtx.lineTo(w/2,h/2+20); guideCtx.stroke();
  }

  // 人像模式：人脸框 + 眼神线
  if (scene.type === '人像' && S.scene._faces?.length > 0) {
    const f = S.scene._faces[0];
    guideCtx.setLineDash([]);
    guideCtx.strokeStyle = 'rgba(78,205,196,.6)';
    guideCtx.lineWidth = 2;
    // 面部框
    const [x1,y1] = f.topLeft, [x2,y2] = f.bottomRight;
    const pad = 20;
    guideCtx.strokeRect(x1-pad, y1-pad, x2-x1+pad*2, y2-y1+pad*2);
    // 眼神方向（水平参考线）
    const eyeY = y1 + (y2-y1)*.3;
    guideCtx.strokeStyle = 'rgba(255,179,71,.3)';
    guideCtx.lineWidth = 1;
    guideCtx.setLineDash([4,4]);
    guideCtx.beginPath(); guideCtx.moveTo(x1-pad-30, eyeY); guideCtx.lineTo(x1-pad, eyeY); guideCtx.stroke();
    guideCtx.beginPath(); guideCtx.moveTo(x2+pad, eyeY); guideCtx.lineTo(x2+pad+30, eyeY); guideCtx.stroke();
    // Pose参考（半透明人形轮廓）
    drawPoseGuide(f, w, h);
  }

  // 光影方向指示
  if (scene.light.includes('逆光')) {
    guideCtx.strokeStyle = 'rgba(255,100,100,.25)';
    guideCtx.setLineDash([]);
    guideCtx.lineWidth = 2;
    // 太阳方向指示
    guideCtx.beginPath(); guideCtx.arc(w*.85, h*.15, 20, 0, Math.PI*2); guideCtx.stroke();
    guideCtx.beginPath(); guideCtx.moveTo(w*.85, h*.15+20); guideCtx.lineTo(w*.5, h*.5); guideCtx.stroke();
    toast('⚠️ 逆光 · 建议开启闪光或调整角度');
  }

  guideCtx.setLineDash([]);
}

// 人像Pose参考线（半透明人体轮廓）
function drawPoseGuide(face, w, h) {
  guideCtx.save();
  guideCtx.globalAlpha = .15;
  guideCtx.strokeStyle = '#FFB347';
  guideCtx.lineWidth = 2;
  guideCtx.setLineDash([6,4]);

  const cx = (face.topLeft[0]+face.bottomRight[0])/2;
  const fy = (face.topLeft[1]+face.bottomRight[1])/2;
  const fh = face.bottomRight[1]-face.topLeft[1];
  const bodyH = fh * 4;

  // 头部（已由框标出）
  // 肩膀
  const shoulderY = fy + fh*.7;
  const shoulderW = fh * .8;
  guideCtx.beginPath();
  guideCtx.moveTo(cx-shoulderW, shoulderY);
  guideCtx.lineTo(cx+shoulderW, shoulderY);
  guideCtx.stroke();

  // 身体中线
  guideCtx.beginPath();
  guideCtx.moveTo(cx, shoulderY);
  guideCtx.lineTo(cx, shoulderY + bodyH*.6);
  guideCtx.stroke();

  // 穿搭色卡提示（顶部小色块）
  guideCtx.globalAlpha = .3;
  const colors = ['#FFB347','#4ECDC4','#FF6B6B','#A78BFA'];
  const cardY = shoulderY + bodyH*.2;
  const cardW = 16, cardH = 24, gap = 8;
  const startX = cx - (colors.length*(cardW+gap)-gap)/2;
  colors.forEach((c, i) => {
    guideCtx.fillStyle = c;
    guideCtx.fillRect(startX + i*(cardW+gap), cardY, cardW, cardH);
    guideCtx.strokeStyle = 'rgba(255,255,255,.5)';
    guideCtx.lineWidth = 1;
    guideCtx.strokeRect(startX + i*(cardW+gap), cardY, cardW, cardH);
  });

  guideCtx.restore();
}

/* ==================== 第五部分：AI 分析主循环 ==================== */

let lastAI = 0;
async function aiLoop() {
  if (video.readyState < 2) { setTimeout(aiLoop, 500); return; }
  if (Date.now() - lastAI < 600) { setTimeout(aiLoop, 100); return; }
  lastAI = Date.now();

  const imgData = sampleFrame();
  const frame = analyzeFrame(imgData);

  // 场景识别
  const scene = await detectScene(imgData, frame);
  scene._faces = scene.faces; // 保存用于渲染
  S.scene = scene;

  // 参数计算
  S.p = calcParams(scene, frame);

  // 更新UI
  updateHUD();
  updatePanel();
  drawGuides();
  drawHistogram(frame);
  updateLightIndicator();

  setTimeout(aiLoop, 200);
}

function updateHUD() {
  $('hud-iso').textContent = `ISO ${S.p.iso}`;
  $('hud-ape').textContent = `f/${S.p.ape}`;
  $('hud-ss').textContent = S.p.ss;
  const ev = S.p.ev;
  $('hud-ev').textContent = `EV ${ev>0?'+':''}${ev.toFixed(1)}`;
  $('hud-wb').textContent = `${S.p.wb}K`;
}

function updatePanel() {
  $('p-scene').textContent = S.scene.type;
  $('p-sub').textContent = S.scene.sub;
  $('p-light').textContent = S.scene.light;
  $('p-comp').textContent = S.scene.comp;
  $('p-iso').textContent = S.p.iso;
  $('p-ape').textContent = `f/${S.p.ape}`;
  $('p-ss').textContent = S.p.ss;
  $('p-wb').textContent = `${S.p.wb}K`;
  $('p-sat').textContent = `${S.p.sat}%`;
  $('p-shp').textContent = S.p.shp;
  $('p-dof').textContent = S.p.dof;

  const tips = [];
  if (S.scene.light.includes('逆光')) tips.push('逆光场景，建议补光');
  if (S.scene.type==='人像' && S.scene.sub==='特写') tips.push('特写模式，建议大光圈');
  if (S.scene.type==='风景') tips.push('建议使用三脚架，小光圈');
  if (S.scene.type==='美食') tips.push('45°俯拍效果最佳');
  $('p-tip').textContent = tips.length ? tips.join(' | ') : '✅ 画面参数已自动优化';

  $('scene-badge').textContent = `${S.scene.type} · ${S.scene.sub}`;
  $('scene-badge').style.display = 'block';
}

function drawHistogram(frame) {
  const tmp = document.createElement('canvas'); tmp.width=80; tmp.height=40;
  tmp.getContext('2d').drawImage(video,0,0,80,40);
  const id = tmp.getContext('2d').getImageData(0,0,80,40).data;
  const bins = new Array(64).fill(0);
  for (let i=0;i<id.length;i+=16) { bins[Math.min(63,(id[i]*.299+id[i+1]*.587+id[i+2]*.114)/4|0)]++; }
  const mx = Math.max(...bins);
  histCtx.clearRect(0,0,80,40);
  bins.forEach((c,i)=>{ histCtx.fillStyle=`hsl(${i*2.8},65%,50%)`; histCtx.fillRect(i,40-c/mx*38,1,c/mx*38); });
  $('hist-box').classList.add('visible');
}

function updateLightIndicator() {
  const el = $('light-indicator');
  el.textContent = S.scene.light;
  el.classList.add('visible');
}

/* ==================== 第六部分：拍照 ==================== */

function capture() {
  $('btn-shutter').classList.add('flash');
  setTimeout(()=>$('btn-shutter').classList.remove('flash'), 300);

  const cv = document.createElement('canvas');
  cv.width = renderCV.width; cv.height = renderCV.height;
  cv.getContext('2d').drawImage(renderCV, 0, 0);

  // 保存原始照片数据
  S.photoData = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
  S.photoImg = new Image();
  S.photoImg.src = cv.toDataURL('image/jpeg', .95);

  showResult();
}

function showResult() {
  const rCV = $('result-cv');
  rCV.width = renderCV.width; rCV.height = renderCV.height;
  const ctx = rCV.getContext('2d');
  ctx.putImageData(S.photoData, 0, 0);
  $('result-modal').classList.remove('hidden');
}

/* ==================== 第七部分：一键美颜 ==================== */

function applyBeauty() {
  if (!S.photoData) return;
  const cv = $('result-cv');
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;

  // 复制原始数据
  const src = new ImageData(new Uint8ClampedArray(S.photoData.data), w, h);
  const d = src.data;

  // 1. 磨皮（均值滤波，保留边缘）
  const r = 2;
  for (let y=r; y<h-r; y++) {
    for (let x=r; x<w-r; x++) {
      const idx = (y*w+x)*4;
      for (let c=0; c<3; c++) {
        let sum=0, cnt=0;
        for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) {
          sum += d[((y+dy)*w+(x+dx))*4+c]; cnt++;
        }
        // 原值与模糊值的加权混合
        const orig = d[idx+c];
        const blur = sum/cnt;
        // 边缘不模糊
        const diff = Math.abs(d[idx+c] - d[((y-1)*w+x)*4+c]) + Math.abs(d[idx+c] - d[((y+1)*w+x)*4+c]);
        const blend = diff < 20 ? .7 : .15;
        d[idx+c] = Math.min(255, Math.max(0, orig*(1-blend) + blur*blend));
      }
    }
  }

  // 2. 提亮肤色
  for (let i=0;i<d.length;i+=4) {
    const r2=d[i],g2=d[i+1],b2=d[i+2];
    // 识别肤色
    if (r2>60 && g2>40 && b2>20 && r2>g2 && r2>b2 && (r2-g2)>15 && (r2-b2)>15) {
      d[i] = Math.min(255, r2 + 12);  // 略微提亮
      d[i+1] = Math.min(255, g2 + 8);
      d[i+2] = Math.min(255, b2 + 5);
    }
  }

  // 3. 增强对比
  for (let i=0;i<d.length;i+=4) {
    for (let c=0;c<3;c++) {
      const v = d[i+c]/255 - .5;
      const s = 1/(1+Math.exp(-1.2*v));
      d[i+c] = Math.min(255, Math.max(0, s*255));
    }
  }

  // 4. 轻微锐化
  applySharpenToData(d, w, h, 8);

  ctx.putImageData(src, 0, 0);
  toast('✨ 美颜完成');
}

function applySharpenToData(d, w, h, amount) {
  const tmp = new Uint8ClampedArray(d);
  const str = amount/100;
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    const i=(y*w+x)*4;
    for (let c=0;c<3;c++) {
      const center=tmp[i+c];
      const blur=(tmp[((y-1)*w+x)*4+c]+2*tmp[(y*w+x-1)*4+c]-8*tmp[i+c]+2*tmp[(y*w+x+1)*4+c]+tmp[((y+1)*w+x)*4+c])/16;
      d[i+c]=Math.max(0,Math.min(255,center+str*blur));
    }
  }
}

/* ==================== 第八部分：参数微调 ==================== */

let editImgData = null;

function initEditPanel() {
  if (!S.photoData) return;
  editImgData = new ImageData(new Uint8ClampedArray(S.photoData.data), S.photoData.width, S.photoData.height);
  // 重置所有滑块
  ['bright','contrast','saturation','temp','sharp','vignette','bokeh','fade'].forEach(k => {
    $(`e-${k}`).value = k==='sharp'||k==='vignette'||k==='bokeh'||k==='fade' ? 0 : 0;
    $(`e-${k}-v`).textContent = '0';
  });
  applyEdits();
}

function applyEdits() {
  if (!editImgData) return;
  const w = editImgData.width, h = editImgData.height;
  const src = new Uint8ClampedArray(S.photoData.data); // 始终从原始开始
  const d = src;

  const bright = parseInt($('e-bright').value);
  const contrast = parseInt($('e-contrast').value);
  const saturation = parseInt($('e-saturation').value);
  const temp = parseInt($('e-temp').value);
  const sharp = parseInt($('e-sharp').value);
  const vignette = parseInt($('e-vignette').value);
  const fade = parseInt($('e-fade').value);

  // 亮度
  if (bright !== 0) {
    for (let i=0;i<d.length;i+=4) {
      d[i]=Math.max(0,Math.min(255,d[i]+bright));
      d[i+1]=Math.max(0,Math.min(255,d[i+1]+bright));
      d[i+2]=Math.max(0,Math.min(255,d[i+2]+bright));
    }
  }

  // 对比度
  if (contrast !== 0) {
    const cf = 1 + contrast/100;
    for (let i=0;i<d.length;i+=4) {
      for (let c=0;c<3;c++) {
        const v = d[i+c]/255 - .5;
        const s = 1/(1+Math.exp(-cf*2.5*v));
        d[i+c]=Math.min(255,Math.max(0,s*255));
      }
    }
  }

  // 饱和度
  if (saturation !== 0) {
    const mul = 1 + saturation/100;
    for (let i=0;i<d.length;i+=4) {
      const r=d[i],g=d[i+1],b=d[i+2];
      const mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2;
      if(mx===mn) continue;
      const delta=mx-mn,s=delta/(255-Math.abs(2*l-255)+1);
      const ns=Math.min(1,s*mul),a=ns===0?0:delta/ns,nmx=l+ns*128,nmn=2*l-nmx;
      let nr,ng,nb;
      if(r===mx){nr=nmx;ng=l+(g-mn)/delta*(nmx-nmn);nb=nmn;}
      else if(g===mx){ng=nmx;nr=l+(r-mn)/delta*(nmx-nmn);nb=nmn;}
      else{nb=nmx;nr=l+(r-mn)/delta*(nmx-nmn);ng=nmn;}
      d[i]=Math.max(0,Math.min(255,nr|0));d[i+1]=Math.max(0,Math.min(255,ng|0));d[i+2]=Math.max(0,Math.min(255,nb|0));
    }
  }

  // 色温
  if (temp !== 0) {
    const t = temp/100;
    for (let i=0;i<d.length;i+=4) {
      d[i]=Math.min(255,Math.max(0,d[i]+t*18));
      d[i+2]=Math.min(255,Math.max(0,d[i+2]-t*18));
    }
  }

  // 褪色
  if (fade > 0) {
    const f = fade/100;
    for (let i=0;i<d.length;i+=4) {
      d[i] = Math.min(255, d[i] + (255-d[i])*.3*f);
      d[i+1] = Math.min(255, d[i+1] + (255-d[i+1])*.3*f);
      d[i+2] = Math.min(255, d[i+2] + (255-d[i+2])*.3*f);
    }
  }

  // 锐化
  if (sharp > 5) applySharpenToData(d, w, h, sharp);

  // 暗角
  if (vignette > 0) {
    const cx=w/2,cy=h/2,maxR=Math.sqrt(cx*cx+cy*cy);
    const str = vignette/100;
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const dx=x-cx,dy=y-cy;
      const dist=Math.sqrt(dx*dx+dy*dy)/maxR;
      const dark = 1 - dist*dist*str*.8;
      const i=(y*w+x)*4;
      d[i]*=dark; d[i+1]*=dark; d[i+2]*=dark;
    }
  }

  const ctx = $('result-cv').getContext('2d');
  const imgData = new ImageData(d, w, h);
  ctx.putImageData(imgData, 0, 0);
}

/* ==================== 第九部分：AI 抠图 ==================== */

let cutoutMode = 'keep', cutoutBrushSize = 20;
let cutoutMask = null, cutoutHistory = [];

function initCutout() {
  if (!S.photoData) return;
  const cv = $('cutout-cv');
  cv.width = S.photoData.width; cv.height = S.photoData.height;
  const ctx = cv.getContext('2d');
  ctx.putImageData(S.photoData, 0, 0);

  cutoutMask = new Uint8Array(cv.width * cv.height); // 0=未处理, 1=保留, 2=擦除
  cutoutHistory = [];
  cutoutMode = 'keep';
  $('cut-keep').classList.add('active');
  $('cut-erase').classList.remove('active');
}

function cutoutPaint(e) {
  if (!cutoutMask) return;
  const cv = $('cutout-cv');
  const ctx = cv.getContext('2d');
  const rect = cv.getBoundingClientRect();
  const scaleX = cv.width / rect.width;
  const scaleY = cv.height / rect.height;
  const x = Math.floor((e.clientX - rect.left) * scaleX);
  const y = Math.floor((e.clientY - rect.top) * scaleY);
  const r = cutoutBrushSize * scaleX;

  // 保存历史
  cutoutHistory.push(new Uint8Array(cutoutMask));
  if (cutoutHistory.length > 20) cutoutHistory.shift();

  ctx.fillStyle = cutoutMode === 'keep' ? 'rgba(255,0,0,0.35)' : 'rgba(0,255,0,0.35)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();

  // 更新mask
  for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) {
    if (dx*dx+dy*dy > r*r) continue;
    const px=x+dx, py=y+dy;
    if (px>=0 && px<cv.width && py>=0 && py<cv.height) {
      cutoutMask[py*cv.width+px] = cutoutMode === 'keep' ? 1 : 2;
    }
  }
}

function cutoutUndo() {
  if (cutoutHistory.length === 0) return;
  cutoutMask = cutoutHistory.pop();
  redrawCutout();
}

function cutoutClear() {
  if (!cutoutMask) return;
  cutoutMask.fill(0);
  cutoutHistory = [];
  const cv = $('cutout-cv');
  const ctx = cv.getContext('2d');
  if (S.photoData) ctx.putImageData(S.photoData, 0, 0);
}

function redrawCutout() {
  if (!S.photoData || !cutoutMask) return;
  const cv = $('cutout-cv');
  const ctx = cv.getContext('2d');
  ctx.putImageData(S.photoData, 0, 0);
  const w = cv.width, h = cv.height;
  const overlay = ctx.getImageData(0, 0, w, h);
  const d = overlay.data;
  for (let i=0;i<cutoutMask.length;i++) {
    if (cutoutMask[i] === 1) { // 保留 = 红色半透明
      d[i*4]=255; d[i*4+1]=d[i*4+1]*.7; d[i*4+2]=d[i*4+2]*.7; d[i*4+3]=220;
    } else if (cutoutMask[i] === 2) { // 擦除 = 绿色半透明
      d[i*4]=d[i*4]*.7; d[i*4+1]=255; d[i*4+2]=d[i*4+2]*.7; d[i*4+3]=220;
    }
  }
  ctx.putImageData(overlay, 0, 0);
}

function cutoutFinish() {
  if (!S.photoData || !cutoutMask) return;
  const w = S.photoData.width, h = S.photoData.height;
  const src = new Uint8ClampedArray(S.photoData.data);
  const d = src;

  // 擦除区域：用周围像素填充（简单版：模糊替换）
  // 先标记擦除区域
  const eraseSet = new Set();
  for (let i=0;i<cutoutMask.length;i++) {
    if (cutoutMask[i] === 2) eraseSet.add(i);
  }

  // 对擦除区域做高斯模糊填充
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    const idx = y*w+x;
    if (!eraseSet.has(idx)) continue;
    let r=0,g=0,b=0,cnt=0;
    for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++) {
      const ni=(y+dy)*w+(x+dx);
      if (!eraseSet.has(ni)) {
        r+=d[ni*4]; g+=d[ni*4+1]; b+=d[ni*4+2]; cnt++;
      }
    }
    if (cnt>0) {
      d[idx*4]=r/cnt; d[idx*4+1]=g/cnt; d[idx*4+2]=b/cnt;
    }
  }

  // 第二次平滑
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    const idx = y*w+x;
    if (!eraseSet.has(idx)) continue;
    let r=0,g=0,b=0,cnt=0;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
      const ni=(y+dy)*w+(x+dx);
      r+=d[ni*4]; g+=d[ni*4+1]; b+=d[ni*4+2]; cnt++;
    }
    d[idx*4]=r/cnt; d[idx*4+1]=g/cnt; d[idx*4+2]=b/cnt;
  }

  const imgData = new ImageData(d, w, h);
  S.photoData = imgData;
  const ctx = $('result-cv').getContext('2d');
  ctx.putImageData(imgData, 0, 0);
  $('cutout-panel').classList.add('hidden');
  $('result-modal').classList.remove('hidden');
  toast('✅ 抠图完成');
}

/* ==================== 第十部分：保存 ==================== */

function savePhoto() {
  const cv = $('result-cv');
  const url = cv.toDataURL('image/jpeg', .95);
  const a = document.createElement('a');
  a.href = url; a.download = `photo_${Date.now()}.jpg`;
  a.click();
  toast('💾 已保存');
}

/* ==================== 第十一部分：事件绑定 ==================== */

function setupEvents() {
  // 拍摄模式
  document.querySelectorAll('.mbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mbtn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      S.mode = btn.dataset.m;
      const labels = {auto:'🤖 AI智能',portrait:'👤 人像',landscape:'🏔️ 风景',food:'🍽️ 美食',pet:'🐾 宠物',night:'🌙 夜景',pro:'⚙️ 专业'};
      $('mode-label').textContent = labels[S.mode] || '🤖';
    });
  });

  // 底部按钮
  $('btn-shutter').addEventListener('click', () => { capture(); });
  $('btn-switch').addEventListener('click', () => {
    S.facing = S.facing==='user'?'environment':'user'; initCamera();
  });
  $('btn-flash').addEventListener('click', () => {
    S.flash = S.flash==='off'?'on':'off';
    $('btn-flash').textContent = S.flash==='on'?'💡':'⚡';
    S.stream?.getVideoTracks()[0]?.applyConstraints({advanced:[{torch:S.flash==='on'}]}).catch(()=>{});
  });
  $('btn-gallery').addEventListener('click', () => {
    const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
    inp.onchange=e=>{
      const f=e.target.files[0];if(!f)return;
      const reader=new FileReader();
      reader.onload=ev=>{
        const img=new Image();img.src=ev.target.result;
        img.onload=()=>{
          const cv=$('result-cv');cv.width=img.width;cv.height=img.height;
          const ctx=cv.getContext('2d');ctx.drawImage(img,0,0);
          S.photoData=ctx.getImageData(0,0,img.width,img.height);
          $('result-modal').classList.remove('hidden');
        };
      };reader.readAsDataURL(f);
    };inp.click();
  });

  // 结果工具栏
  $('r-beauty').addEventListener('click', () => {
    $('result-modal').classList.add('hidden');
    applyBeauty();
    setTimeout(()=>$('result-modal').classList.remove('hidden'), 50);
  });
  $('r-edit').addEventListener('click', () => {
    $('result-modal').classList.add('hidden');
    $('edit-panel').classList.remove('hidden');
    initEditPanel();
  });
  $('r-cutout').addEventListener('click', () => {
    $('result-modal').classList.add('hidden');
    $('cutout-panel').classList.remove('hidden');
    initCutout();
  });
  $('r-save').addEventListener('click', savePhoto);
  $('r-retake').addEventListener('click', () => {
    $('result-modal').classList.add('hidden');
    $('edit-panel').classList.add('hidden');
    $('cutout-panel').classList.add('hidden');
  });

  // 参数微调滑块
  ['bright','contrast','saturation','temp','sharp','vignette','bokeh','fade'].forEach(k => {
    $(`e-${k}`).addEventListener('input', () => {
      $(`e-${k}-v`).textContent = $(`e-${k}`).value;
      applyEdits();
    });
  });

  // 返回按钮（编辑/抠图面板返回结果）
  document.addEventListener('click', e => {
    if (e.target.id === 'edit-panel' || e.target.id === 'cutout-panel') {
      e.target.classList.add('hidden');
      $('result-modal').classList.remove('hidden');
    }
  });

  // 抠图工具
  $('cut-keep').addEventListener('click', () => {
    cutoutMode='keep';
    $('cut-keep').classList.add('active');$('cut-erase').classList.remove('active');
  });
  $('cut-erase').addEventListener('click', () => {
    cutoutMode='erase';
    $('cut-erase').classList.add('active');$('cut-keep').classList.remove('active');
  });
  $('cut-undo').addEventListener('click', cutoutUndo);
  $('cut-clear').addEventListener('click', cutoutClear);
  $('cut-finish').addEventListener('click', cutoutFinish);
  $('cut-brush').addEventListener('input', e => {
    cutoutBrushSize = parseInt(e.target.value);
    $('cut-brush-v').textContent = cutoutBrushSize;
  });

  // 抠图画布事件（触摸+鼠标）
  const cutCV = $('cutout-cv');
  let isDrawing = false;
  cutCV.addEventListener('mousedown', e => { isDrawing=true; cutoutPaint(e); });
  cutCV.addEventListener('mousemove', e => { if(isDrawing) cutoutPaint(e); });
  cutCV.addEventListener('mouseup', () => { isDrawing=false; });
  cutCV.addEventListener('touchstart', e => { e.preventDefault(); isDrawing=true; cutoutPaint(e.touches[0]); }, {passive:false});
  cutCV.addEventListener('touchmove', e => { e.preventDefault(); if(isDrawing) cutoutPaint(e.touches[0]); }, {passive:false});
  cutCV.addEventListener('touchend', () => { isDrawing=false; });
}

/* ==================== 第十二部分：工具函数 ==================== */

function toast(text) {
  const el = $('ai-toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 2500);
}

/* ==================== 启动 ==================== */

(async () => {
  $('ai-status-dot').className = 'loading';
  toast('⏳ 加载 AI 模型...');
  await initCamera();
  try {
    const [bf, mn] = await Promise.all([blazeface.load(), mobilenet.load({version:2,alpha:1})]);
    S.models.blazeface = bf; S.models.mobilenet = mn;
    S.aiReady = true;
    $('ai-status-dot').className = 'ready';
    toast('✅ AI 摄影大师就绪', 2000);
  } catch(e) {
    $('ai-status-dot').className = 'error';
    toast('⚠️ AI 离线 · 手动模式', 3000);
  }
  setupEvents();
})();
