// =============================================================
//  AI 智能摄影助手 — app.js
//  功能：AI 场景分析 + 人像姿势引导 + 自动美颜
// =============================================================

// ---------- 全局状态 ----------
const S = {
  stream: null, facingMode: 'user', flashMode: 'off',
  currentMode: 'auto',          // auto | portrait | landscape | manual
  currentPose: 'stand',         // stand | sit | lean | walk | profile
  aiReady: false, aiAnalyzing: false,
  beauty: { smooth: 50, whiten: 40, eyes: 30, slim: 20 },
  compMode: 'none',
  // AI 分析结果
  analysis: { subject: null, gender: null, age: null, scene: null, style: null },
  models: { blazeface: null, mobilenet: null, poseDetector: null },
};

// ---------- DOM ----------
const video      = document.getElementById('camera-preview');
const overlayCV  = document.getElementById('overlay-canvas');
const overlayCtx = overlayCV.getContext('2d');
const poseCV     = document.getElementById('pose-overlay');
const poseCtx    = poseCV.getContext('2d');
const aiBadge    = document.getElementById('ai-badge');
const aiIcon     = document.getElementById('ai-icon');
const aiStatus   = document.getElementById('ai-status');
const sceneTag   = document.getElementById('scene-tag');
const subjectTag = document.getElementById('subject-tag');
const aiPanel    = document.getElementById('ai-info-panel');

// ---------- 场景 + 风格知识库 ----------
const SCENE_MAP = {
  beach:     { label: '海边/沙滩', color: '#4ECDC4', style: '小清新、浪漫、日系' },
  forest:    { label: '森林/树木', color: '#95D5B2', style: '森系、氧气感、自然' },
  mountain:  { label: '山川/自然', color: '#D8B4F8', style: '大气、风光、史诗感' },
  city:      { label: '城市/建筑', color: '#FFD6A5', style: '都市感、时尚、潮流' },
  street:    { label: '街道/小路', color: '#FFB3C6', style: '街拍、文艺、复古' },
  indoor:     { label: '室内环境', color: '#E8C39E', style: '日常、生活感、温馨' },
  sky:       { label: '天空/空旷', color: '#87CEEB', style: '极简、留白、高级感' },
  water:     { label: '湖泊/水面', color: '#00B4D8', style: '倒影、静谧、清冷' },
  park:      { label: '公园/草地', color: '#B7E4C7', style: '休闲、活力、春日感' },
  default:   { label: '通用场景', color: '#ffffff', style: '通用百搭' },
};

const GENDER_POSES = {
  female: {
    stand: { label: '站姿', thumb: '站姿', points: [[0.5,0.15],[0.3,0.35],[0.35,0.55],[0.3,0.8],[0.25,0.9],[0.5,0.5],[0.5,0.65],[0.4,0.8],[0.55,0.8],[0.7,0.35],[0.65,0.55],[0.7,0.8],[0.75,0.9]] },
    sit:   { label: '坐姿', thumb: '坐姿', points: [[0.5,0.15],[0.3,0.35],[0.35,0.55],[0.4,0.75],[0.3,0.85],[0.5,0.5],[0.5,0.65],[0.45,0.72],[0.55,0.72],[0.7,0.35],[0.65,0.55],[0.7,0.7],[0.75,0.75]] },
    lean:  { label: '倚靠', thumb: '倚靠', points: [[0.5,0.15],[0.3,0.35],[0.35,0.55],[0.25,0.8],[0.2,0.92],[0.5,0.5],[0.5,0.65],[0.35,0.8],[0.55,0.8],[0.7,0.35],[0.65,0.55],[0.8,0.7],[0.85,0.78]] },
    walk:  { label: '行走', thumb: '行走', points: [[0.5,0.12],[0.32,0.32],[0.35,0.52],[0.25,0.72],[0.3,0.88],[0.5,0.5],[0.5,0.65],[0.35,0.78],[0.65,0.78],[0.68,0.32],[0.65,0.52],[0.55,0.88],[0.7,0.9]] },
    profile:{ label: '侧颜', thumb: '侧颜', points: [[0.45,0.15],[0.25,0.35],[0.3,0.55],[0.3,0.78],[0.25,0.92],[0.5,0.5],[0.5,0.65],[0.35,0.78],[0.55,0.78],[0.7,0.3],[0.65,0.5],[0.72,0.72],[0.78,0.82]] },
  },
  male: {
    stand: { label: '站姿', thumb: '站姿', points: [[0.5,0.15],[0.3,0.35],[0.35,0.55],[0.3,0.8],[0.25,0.9],[0.5,0.5],[0.5,0.65],[0.4,0.8],[0.55,0.8],[0.7,0.35],[0.65,0.55],[0.72,0.8],[0.78,0.9]] },
    sit:   { label: '坐姿', thumb: '坐姿', points: [[0.5,0.15],[0.3,0.35],[0.35,0.55],[0.42,0.75],[0.3,0.85],[0.5,0.5],[0.5,0.65],[0.48,0.72],[0.55,0.72],[0.7,0.35],[0.65,0.55],[0.7,0.72],[0.78,0.78]] },
    lean:  { label: '倚靠', thumb: '倚靠', points: [[0.5,0.15],[0.3,0.35],[0.35,0.55],[0.25,0.8],[0.18,0.92],[0.5,0.5],[0.5,0.65],[0.35,0.8],[0.58,0.8],[0.72,0.35],[0.68,0.55],[0.82,0.7],[0.88,0.8]] },
    walk:  { label: '行走', thumb: '行走', points: [[0.5,0.12],[0.32,0.32],[0.35,0.52],[0.22,0.72],[0.28,0.88],[0.5,0.5],[0.5,0.65],[0.32,0.78],[0.62,0.78],[0.68,0.32],[0.65,0.52],[0.52,0.88],[0.72,0.9]] },
    profile:{ label: '侧颜', thumb: '侧颜', points: [[0.45,0.15],[0.25,0.35],[0.3,0.55],[0.28,0.78],[0.22,0.92],[0.5,0.5],[0.5,0.65],[0.35,0.78],[0.55,0.78],[0.72,0.28],[0.68,0.48],[0.75,0.72],[0.8,0.82]] },
  },
  child: {
    stand: { label: '站姿', thumb: '站姿', points: [[0.5,0.18],[0.35,0.38],[0.38,0.58],[0.35,0.82],[0.28,0.9],[0.5,0.52],[0.5,0.66],[0.4,0.8],[0.55,0.8],[0.65,0.38],[0.62,0.58],[0.65,0.82],[0.72,0.9]] },
    sit:   { label: '坐姿', thumb: '坐姿', points: [[0.5,0.18],[0.35,0.38],[0.38,0.58],[0.45,0.78],[0.3,0.85],[0.5,0.52],[0.5,0.66],[0.45,0.75],[0.55,0.75],[0.65,0.38],[0.62,0.58],[0.68,0.75],[0.75,0.8]] },
    lean:  { label: '倚靠', thumb: '倚靠', points: [[0.5,0.18],[0.35,0.38],[0.38,0.58],[0.28,0.82],[0.2,0.92],[0.5,0.52],[0.5,0.66],[0.38,0.8],[0.58,0.8],[0.68,0.38],[0.65,0.58],[0.8,0.72],[0.85,0.82]] },
    walk:  { label: '活泼', thumb: '活泼', points: [[0.5,0.15],[0.32,0.35],[0.35,0.55],[0.22,0.78],[0.28,0.9],[0.5,0.5],[0.5,0.65],[0.32,0.8],[0.6,0.78],[0.68,0.35],[0.65,0.55],[0.52,0.9],[0.72,0.88]] },
    profile:{ label: '侧颜', thumb: '侧颜', points: [[0.45,0.18],[0.28,0.38],[0.32,0.58],[0.3,0.8],[0.22,0.92],[0.5,0.52],[0.5,0.66],[0.38,0.78],[0.55,0.78],[0.7,0.32],[0.65,0.52],[0.75,0.72],[0.8,0.82]] },
  },
};

const LANDSCAPE_POSES = [
  { name: '三分构图', desc: '主体放在三分线交点' },
  { name: '黄金螺旋', desc: '螺旋引导视觉焦点' },
  { name: '前景虚化', desc: '利用近景遮挡增加层次' },
  { name: '引导线', desc: '利用道路/河流引导视线' },
];

// 骨架连接定义（对应 COCO 17点）
const POSE_CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[1,5],[5,6],[6,7],[1,8],[8,9],[9,10],[8,11],[11,12]];

// ---------- 初始化相机 ----------
async function initCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: S.facingMode, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    video.srcObject = stream;
    S.stream = stream;
    await video.play();
    resizeOverlays();
  } catch (e) { alert('相机启动失败，请检查权限设置。'); return; }
}

function resizeOverlays() {
  const w = video.videoWidth || video.clientWidth;
  const h = video.videoHeight || video.clientHeight;
  overlayCV.width = poseCV.width = w;
  overlayCV.height = poseCV.height = h;
  overlayCV.style.cssText = poseCV.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
}

// ---------- 加载 AI 模型 ----------
async function loadModels() {
  setAIState('loading', '加载模型…');
  try {
    S.models.blazeface    = await blazeface.load();
    S.models.mobilenet    = await mobilenet.load({ version: 2, alpha: 1.0 });
    S.models.poseDetector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet, { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
    S.aiReady = true;
    setAIState('idle', 'AI 就绪');
  } catch (e) {
    console.error('模型加载失败:', e);
    setAIState('error', '模型加载失败');
    alert('AI 模型加载失败，当前设备不支持。\n请确保网络连接正常后重试。');
  }
}

function setAIState(state, text) {
  aiBadge.className = 'ai-badge ' + (state === 'loading' ? 'analyzing' : state === 'error' ? 'error' : state === 'done' ? 'done' : 'idle');
  aiStatus.textContent = text;
  aiIcon.textContent = state === 'error' ? '⚠️' : state === 'loading' ? '⏳' : state === 'done' ? '✅' : '🤖';
}

// ---------- AI 场景分析（每帧实时分析） ----------
let frameCount = 0;
let lastAnalysisTime = 0;

async function analyzeFrame() {
  if (!S.aiReady || !video.readyState >= 2 || S.aiAnalyzing) return;
  const now = Date.now();
  if (now - lastAnalysisTime < 800) return; // 每 0.8 秒分析一次，避免卡顿
  lastAnalysisTime = now;
  S.aiAnalyzing = true;
  setAIState('loading', 'AI 分析中…');

  try {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { S.aiAnalyzing = false; return; }

    // 1. 人脸检测
    const facePred = await S.models.blazeface.estimateFaces(video, false);

    if (facePred.length > 0) {
      // 检测到人脸 → 人像模式
      const face = facePred[0]; // 取最前面的人脸
      const topLeft = face.topLeft, bottomRight = face.bottomRight;
      const faceW = bottomRight[0] - topLeft[0];
      const faceH = bottomRight[1] - topLeft[1];
      const faceArea = faceW * faceH / (w * h);

      // 估算性别（基于下巴形状 / 脸宽高比 — 简略估算）
      const ratio = faceW / faceH;
      const gender = ratio > 0.75 ? 'female' : 'male'; // 宽脸倾向女性（下巴），窄脸倾向男性

      // 估算年龄（基于人脸大小占比，越大越近→成人，越小越远或越年轻）
      const age = faceArea > 0.06 ? 'adult' : faceArea > 0.02 ? 'young' : 'child';

      S.analysis.gender = gender;
      S.analysis.age = age;
      S.analysis.subject = '👤 人像';

      // 绘制人脸框
      overlayCtx.clearRect(0, 0, w, h);
      overlayCtx.strokeStyle = '#4ECDC4';
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([4, 4]);
      const fx = (w - topLeft[0]) * (video.clientWidth / w); // 镜像翻转
      const fy = topLeft[1] * (video.clientHeight / h);
      const fw = faceW * (video.clientWidth / w);
      const fh = faceH * (video.clientHeight / h);
      overlayCtx.strokeRect(fx - fw, fy, fw, fh);
      overlayCtx.setLineDash([]);

      // 显示标签
      const tag = gender === 'female' ? (age === 'child' ? '👧 女童' : '👩 女性') : (age === 'child' ? '👦 男童' : '👨 男性');
      subjectTag.textContent = tag;
      subjectTag.classList.remove('hidden');
      sceneTag.classList.add('hidden');

      // 更新风格推荐
      const genderInfo = GENDER_POSES[age === 'child' ? 'child' : gender];
      const poseInfo = genderInfo[S.currentPose];
      document.getElementById('ai-style').textContent = `${S.currentPose === S.currentPose ? poseInfo.label : '待选择姿势'}`;
      document.getElementById('ai-subject').textContent = tag;

      // 绘制姿势引导线
      drawPoseGuide(gender, S.currentPose, w, h);

    } else {
      // 无人脸 → 场景检测
      overlayCtx.clearRect(0, 0, w, h);
      poseCtx.clearRect(0, 0, w, h);
      S.analysis.subject = '🏔️ 风景';
      subjectTag.classList.add('hidden');

      // 用 mobilenet 分类场景
      const predictions = await S.models.mobilenet.classify(video, 3);
      if (predictions && predictions.length > 0) {
        const top = predictions[0];
        const sceneInfo = mapSceneFromLabel(top.className);
        S.analysis.scene = sceneInfo.label;
        S.analysis.style = sceneInfo.style;
        sceneTag.textContent = sceneInfo.label;
        sceneTag.classList.remove('hidden');
        document.getElementById('ai-subject').textContent = '🏔️ 风景';
        document.getElementById('ai-scene').textContent = sceneInfo.label;
        document.getElementById('ai-style').textContent = sceneInfo.style;
      }
    }

    setAIState('done', '分析完成');
    setTimeout(() => setAIState('idle', 'AI 就绪'), 2000);

  } catch (e) {
    console.error('AI分析失败:', e);
    setAIState('error', '分析异常');
  }
  S.aiAnalyzing = false;
}

// 根据 mobilenet 标签映射场景
function mapSceneFromLabel(label) {
  const l = label.toLowerCase();
  if (/beach|shore|seashore|coast|sandbar|breakwater|dam/.test(l)) return SCENE_MAP.beach;
  if (/forest|wood|woodland|tree|jungle|bosk/.test(l)) return SCENE_MAP.forest;
  if (/mountain|peak|cliff|valley|promontory/.test(l)) return SCENE_MAP.mountain;
  if (/street|road|alley|sidewalk|avenue|highway/.test(l)) return SCENE_MAP.street;
  if (/lake|pond|river|stream|water/.test(l)) return SCENE_MAP.water;
  if (/park|grass|field|meadow|playground/.test(l)) return SCENE_MAP.park;
  if (/sky|cloud|atmosphere|outdoor/.test(l)) return SCENE_MAP.sky;
  if (/indoor|room|home|house|office|living/.test(l)) return SCENE_MAP.indoor;
  if (/city|building|skyscraper|downtown/.test(l)) return SCENE_MAP.city;
  return SCENE_MAP.default;
}

// ---------- 绘制姿势引导骨架 ----------
function drawPoseGuide(gender, pose, w, h) {
  poseCtx.clearRect(0, 0, w, h);
  const poseData = GENDER_POSES[gender][pose];
  if (!poseData) return;

  const pts = poseData.points;
  // 绘制骨架线
  const scaledConnections = POSE_CONNECTIONS.map(([a, b]) => ({
    from: [pts[a][0] * w, pts[a][1] * h],
    to:   [pts[b][0] * w, pts[b][1] * h],
  }));

  // 颜色渐变（头→脚）
  const gradient = ['#4ECDC4','#FF6B6B','#FFD93D','#6BCB77','#4D96FF'];
  poseCtx.lineWidth = 3;
  scaledConnections.forEach((c, i) => {
    poseCtx.beginPath();
    poseCtx.moveTo(c.from[0], c.from[1]);
    poseCtx.lineTo(c.to[0], c.to[1]);
    poseCtx.strokeStyle = gradient[i % gradient.length] || '#4ECDC4';
    poseCtx.lineCap = 'round';
    poseCtx.stroke();
  });

  // 绘制关节点
  pts.forEach((p, i) => {
    poseCtx.beginPath();
    poseCtx.arc(p[0] * w, p[1] * h, i === 0 ? 10 : 6, 0, Math.PI * 2);
    poseCtx.fillStyle = i === 0 ? '#FF6B6B' : '#4ECDC4';
    poseCtx.fill();
    poseCtx.strokeStyle = '#fff'; poseCtx.lineWidth = 1.5;
    poseCtx.stroke();
  });

  // 绘制提示文字
  poseCtx.font = 'bold 16px sans-serif';
  poseCtx.fillStyle = '#FF6B6B';
  poseCtx.textAlign = 'center';
  poseCtx.fillText(`💡 ${poseData.label}参考线`, w / 2, h * 0.06);
}

// ---------- 绘制构图辅助线 ----------
function drawComposition() {
  overlayCtx.clearRect(0, 0, overlayCV.width, overlayCV.height);
  const w = overlayCV.width, h = overlayCV.height;
  overlayCtx.strokeStyle = 'rgba(255,255,255,0.4)';
  overlayCtx.lineWidth = 1;
  overlayCtx.setLineDash([5, 4]);
  switch (S.compMode) {
    case 'thirds':
      for (let i = 1; i <= 2; i++) {
        overlayCtx.beginPath(); overlayCtx.moveTo(w*i/3,0); overlayCtx.lineTo(w*i/3,h); overlayCtx.stroke();
        overlayCtx.beginPath(); overlayCtx.moveTo(0,h*i/3); overlayCtx.lineTo(w,h*i/3); overlayCtx.stroke();
      }
      break;
    case 'golden':
      const phi = 0.618;
      for (let i = 1; i <= 2; i++) {
        overlayCtx.beginPath(); overlayCtx.moveTo(w*Math.pow(phi,i),0); overlayCtx.lineTo(w*Math.pow(phi,i),h); overlayCtx.stroke();
        overlayCtx.beginPath(); overlayCtx.moveTo(0,h*Math.pow(phi,i)); overlayCtx.lineTo(w,h*Math.pow(phi,i)); overlayCtx.stroke();
      }
      break;
    case 'center':
      overlayCtx.beginPath(); overlayCtx.arc(w/2,h/2,Math.min(w,h)*0.22,0,Math.PI*2); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.moveTo(w/2,0); overlayCtx.lineTo(w/2,h); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.moveTo(0,h/2); overlayCtx.lineTo(w,h/2); overlayCtx.stroke();
      break;
    case 'diagonal':
      overlayCtx.beginPath(); overlayCtx.moveTo(0,0); overlayCtx.lineTo(w,h); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.moveTo(w,0); overlayCtx.lineTo(0,h); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.arc(w/2,h/2,Math.min(w,h)*0.28,0,Math.PI*2); overlayCtx.stroke();
      break;
  }
  overlayCtx.setLineDash([]);
}

// ---------- AI 自动美颜（双边滤波） ----------
function bilateralSmooth(data, w, h, radius) {
  const src = new Uint8ClampedArray(data);
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const idx = (y*w+x)*4;
      let r=0,g=0,b=0,sum=0;
      for (let dy=-radius; dy<=radius; dy++) {
        for (let dx=-radius; dx<=radius; dx++) {
          const ni=((y+dy)*w+(x+dx))*4;
          const dr=src[idx]-src[ni], dg=src[idx+1]-src[ni+1], db=src[idx+2]-src[ni+2];
          const cd=Math.sqrt(dr*dr+dg*dg+db*db);
          const sd=Math.sqrt(dx*dx+dy*dy)/radius;
          const w2=Math.exp(-sd*1.5-cd*0.04);
          r+=src[ni]*w2; g+=src[ni+1]*w2; b+=src[ni+2]*w2; sum+=w2;
        }
      }
      data[idx]=r/sum; data[idx+1]=g/sum; data[idx+2]=b/sum;
    }
  }
}

function applyAutoBeauty(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // 1. 美白
  if (S.beauty.whiten > 0) {
    const boost = S.beauty.whiten * 0.9;
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = Math.min(255, d[i]   + boost);
      d[i+1] = Math.min(255, d[i+1] + boost);
      d[i+2] = Math.min(255, d[i+2] + boost);
    }
  }

  // 2. 磨皮（双边模糊）
  if (S.beauty.smooth > 20) {
    bilateralSmooth(d, w, h, Math.round(S.beauty.smooth / 20));
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.95);
}

// ---------- 拍照 ----------
async function capture() {
  const btn = document.getElementById('btn-capture');
  btn.classList.add('shooting');
  setTimeout(() => btn.classList.remove('shooting'), 500);

  const cv = document.createElement('canvas');
  cv.width = video.videoWidth; cv.height = video.videoHeight;
  cv.getContext('2d').drawImage(video, 0, 0);
  const origURL = cv.toDataURL('image/jpeg', 0.95);

  // 显示预览 + 自动美颜
  const modal = document.getElementById('result-modal');
  const origImg = document.getElementById('result-original');
  const enhancedCV = document.getElementById('result-enhanced');
  origImg.src = origURL;
  document.getElementById('result-actions').classList.add('hidden');
  document.querySelector('.result-label').textContent = '✨ AI 自动美化中...';
  modal.classList.remove('hidden');

  // AI 美化处理
  setTimeout(() => {
    enhancedCV.width = cv.width; enhancedCV.height = cv.height;
    enhancedCV.getContext('2d').drawImage(cv, 0, 0);
    const beautifiedURL = applyAutoBeauty(enhancedCV);
    document.querySelector('.result-label').textContent = '✅ 智能美化完成';
    document.getElementById('result-actions').classList.remove('hidden');
    enhancedCV.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;z-index:-1;';
    enhancedCV.dataset.url = beautifiedURL;
  }, 600);
}

// ---------- 事件绑定 ----------

// 模式切换
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.currentMode = btn.dataset.mode;

    const posePanel = document.getElementById('pose-style-selector');
    const compPanel = document.getElementById('composition-selector');

    if (S.currentMode === 'portrait') {
      posePanel.classList.remove('hidden');
      compPanel.classList.add('hidden');
      document.getElementById('pose-style-selector').style.bottom = '90px';
    } else if (S.currentMode === 'landscape') {
      posePanel.classList.add('hidden');
      compPanel.classList.remove('hidden');
      compPanel.style.bottom = '90px';
      // 风景默认显示三分法
      S.compMode = 'thirds';
      document.querySelectorAll('.comp-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.comp === 'thirds');
      });
      drawComposition();
    } else if (S.currentMode === 'auto') {
      posePanel.classList.add('hidden');
      compPanel.classList.add('hidden');
    } else {
      posePanel.classList.add('hidden');
      compPanel.classList.remove('hidden');
      compPanel.style.bottom = '90px';
    }
  });
});

// 姿势选择（人像模式）
document.querySelectorAll('.pose-thumb').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pose-thumb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.currentPose = btn.dataset.pose;
    if (S.analysis.gender) {
      const w = video.videoWidth, h = video.videoHeight;
      drawPoseGuide(S.analysis.gender, S.currentPose, w, h);
    }
    document.getElementById('ai-style').textContent = GENDER_POSES[S.analysis.gender || 'female'][S.currentPose].label;
  });
});

// 构图辅助线（手动模式）
document.querySelectorAll('.comp-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.comp-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.compMode = btn.dataset.comp;
    drawComposition();
  });
});

// 美颜滑块
['smooth','whiten','eyes','slim'].forEach(k => {
  const input = document.getElementById(k);
  const valEl = document.getElementById('v-' + k);
  input.addEventListener('input', () => {
    S.beauty[k] = parseInt(input.value);
    if (valEl) valEl.textContent = input.value;
  });
});

// 底部按钮
document.getElementById('btn-capture').addEventListener('click', capture);

document.getElementById('btn-switch').addEventListener('click', () => {
  S.facingMode = S.facingMode === 'user' ? 'environment' : 'user';
  initCamera();
});

document.getElementById('btn-flash').addEventListener('click', () => {
  const modes = ['off','on','auto'];
  const idx = modes.indexOf(S.flashMode);
  S.flashMode = modes[(idx+1)%modes.length];
  document.getElementById('btn-flash').textContent = S.flashMode === 'on' ? '💡' : S.flashMode === 'auto' ? '⚡📷' : '⚡';
  const track = S.stream?.getVideoTracks()[0];
  if (track) track.applyConstraints({ advanced: [{ torch: S.flashMode === 'on' }] }).catch(()=>{});
});

document.getElementById('btn-gallery').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const modal = document.getElementById('result-modal');
      document.getElementById('result-original').src = ev.target.result;
      document.getElementById('result-actions').classList.add('hidden');
      document.querySelector('.result-label').textContent = '✨ AI 自动美化中...';
      modal.classList.remove('hidden');
      setTimeout(() => {
        const cv = document.createElement('canvas');
        const img = new Image();
        img.onload = () => {
          cv.width = img.width; cv.height = img.height;
          cv.getContext('2d').drawImage(img, 0, 0);
          const enhancedCV = document.getElementById('result-enhanced');
          enhancedCV.width = cv.width; enhancedCV.height = cv.height;
          enhancedCV.getContext('2d').drawImage(cv, 0, 0);
          const url = applyAutoBeauty(enhancedCV);
          document.querySelector('.result-label').textContent = '✅ 美化完成';
          document.getElementById('result-actions').classList.remove('hidden');
          enhancedCV.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;z-index:-1;';
          enhancedCV.dataset.url = url;
        };
        img.src = ev.target.result;
      }, 500);
    };
    reader.readAsDataURL(file);
  };
  inp.click();
});

// 结果弹窗按钮
document.getElementById('btn-download').addEventListener('click', () => {
  const url = document.getElementById('result-original').src;
  downloadImage(url, 'photo_original.jpg');
});

document.getElementById('btn-download-beautified').addEventListener('click', () => {
  const url = document.getElementById('result-enhanced').dataset.url;
  if (url) downloadImage(url, 'photo_beautified.jpg');
  else alert('请等待美化完成');
});

document.getElementById('btn-retake').addEventListener('click', () => {
  document.getElementById('result-modal').classList.add('hidden');
});

function downloadImage(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
}

// 窗口尺寸变化
window.addEventListener('resize', () => { resizeOverlays(); if (S.currentMode === 'manual') drawComposition(); });

// 相机就绪后开始 AI 分析循环
video.addEventListener('loadedmetadata', () => {
  resizeOverlays();
});

function aiLoop() {
  if (S.currentMode === 'auto') {
    analyzeFrame();
  } else if (S.currentMode === 'portrait' && S.analysis.gender) {
    const w = video.videoWidth, h = video.videoHeight;
    if (w && h) drawPoseGuide(S.analysis.gender, S.currentPose, w, h);
  } else if (S.currentMode === 'landscape') {
    drawComposition();
  }
  setTimeout(aiLoop, S.currentMode === 'auto' ? 200 : 1000);
}

// ---------- 启动 ----------
(async () => {
  await initCamera();
  await loadModels();
  aiLoop();
  aiPanel.classList.remove('hidden');
})();
