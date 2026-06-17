// =================================================================
//  AI 摄影大师 v9.0 — 强效实时美颜 + 美颜等级 + 瘦脸
// =================================================================
'use strict';

const S = {
  stream: null,
  facing: 'user',
  running: false,
  // 美颜等级 0-10
  level: 6,
};

const $ = id => document.getElementById(id);
const video = $('cam'), canvas = $('canvas'), ctx = canvas.getContext('2d');
const preview = $('preview'), previewImg = $('preview-img');
const shutterBtn = $('shutter');
const switchBtn = $('switch-cam');
const filterBar = $('filter-bar');
const levelSlider = $('level-slider');
const levelVal = $('level-val');

/* ==================== 滤镜定义 ==================== */
const FILTERS = {
  none:    { name:'原图', fn:null },
  warm:    { name:'暖阳', fn:(r,g,b)=>[Math.min(255,r*1.18),g,b*0.88] },
  cool:    { name:'冷调', fn:(r,g,b)=>[r*0.88,g,Math.min(255,b*1.22)] },
  vintage: { name:'复古', fn:(r,g,b)=>{let v=r*.393+g*.769+b*.189;return[Math.min(255,v),Math.min(255,v*.9),Math.min(255,v*.7)]} },
  bw:      { name:'黑白', fn:(r,g,b)=>{let v=r*.299+g*.587+b*.114;return[v,v,v]} },
  fresh:   { name:'清新', fn:(r,g,b)=>[Math.min(255,r*1.08),Math.min(255,g*1.15),Math.min(255,b*1.08)] },
  film:    { name:'胶片', fn:(r,g,b)=>[Math.min(255,r*1.12+b*.06),g*.93,Math.min(255,b*.83+r*.11)] },
  pink:    { name:'粉嫩', fn:(r,g,b)=>[Math.min(255,r*1.13),Math.min(255,g*1.03),Math.min(255,b*1.1)] },
  milk:    { name:'奶白', fn:(r,g,b)=>[Math.min(255,r*1.15),Math.min(255,g*1.18),Math.min(255,b*1.16)] },
  caramel: { name:'焦糖', fn:(r,g,b)=>[Math.min(255,r*1.2),Math.min(255,g*1.05),b*0.85] },
};

/* ==================== 相机初始化 ==================== */
async function initCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: S.facing, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    video.srcObject = S.stream;
    await video.play();
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    if (!S.running) { S.running = true; renderLoop(); }
  } catch(e) {
    alert('需要相机权限才能使用');
  }
}

/* ==================== 实时渲染循环 ==================== */
function renderLoop() {
  if (!S.running) return;
  const w = canvas.width, h = canvas.height;

  // 绘制视频帧（前置镜像）
  ctx.save();
  if (S.facing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    
    // 核心美颜处理
    applyBeauty(data, w, h, S.level);
    
    // 滤镜
    if (S.filter !== 'none' && FILTERS[S.filter]?.fn) {
      for (let i = 0; i < data.length; i += 4) {
        const [nr,ng,nb] = FILTERS[S.filter].fn(data[i], data[i+1], data[i+2]);
        data[i]=nr; data[i+1]=ng; data[i+2]=nb;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  } catch(e) {}

  requestAnimationFrame(renderLoop);
}

/* ==================== 强效美颜算法 ==================== */
function applyBeauty(data, w, h, level) {
  // level: 0-10 映射到实际强度
  const L = level / 10; // 0~1
  
  // ===== 参数随等级变化 =====
  const smoothRadius = Math.max(1, Math.round(L * 3));       // 磨皮半径 1~3
  const smoothMix     = 0.25 + L * 0.55;                      // 磨皮混合比 0.25~0.8
  const brighten      = 1.0 + L * 0.20;                       // 提亮 1.0~1.2
  const whitenR       = 1.0 + L * 0.12;                       // R通道提亮
  const whitenG       = 1.0 + L * 0.10;                       // G通道
  const whitenB       = 1.0 + L * 0.14;                       // B通道更多（去黄）
  const contrast      = 1.0 + L * 0.18;                       // 对比度
  const sharpAmount   = L * 0.5;                               // 锐化强度
  const redTint       = L * 0.08;                              // 红润程度

  // 第一步：肤色检测 (YCbCr)
  const skinMask = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i += 4) {
    const r=data[i], g=data[i+1], b=data[i+2];
    const y  = 0.299*r + 0.587*g + 0.114*b;
    const cb = -0.169*r - 0.331*g + 0.5*b + 128;
    const cr = 0.5*r - 0.419*g - 0.081*b + 128;
    // 放宽肤色范围，确保检测到更多人脸区域
    const isSkin = (
      cb >= 70 && cb <= 133 &&
      cr >= 128 && cr <= 180 &&
      y > 60
    );
    skinMask[i/4] = isSkin ? 1 : 0;
  }

  // 第二步：磨皮（双边滤波近似：均值模糊+边缘保持）
  if (smoothRadius >= 1 && smoothMix > 0) {
    const copy = new Uint8ClampedArray(data);
    const radius = smoothRadius;
    
    for (let y = radius; y < h - radius; y++) {
      for (let x = radius; x < w - radius; x++) {
        const idx = y * w + x;
        if (!skinMask[idx]) continue;
        
        for (let c = 0; c < 3; c++) {
          let sum = 0, count = 0;
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              sum += copy[((y+dy)*w+(x+dx))*4+c];
              count++;
            }
          }
          const blurred = sum / count;
          // 混合原图和模糊图
          data[idx*4+c] = data[idx*4+c] * (1 - smoothMix) + blurred * smoothMix;
        }
      }
    }
  }

  // 第三步：美白 + 提亮 + 红润 + 对比度（仅肤色区域）
  for (let i = 0; i < data.length; i += 4) {
    if (!skinMask[i/4]) continue;
    
    let r = data[i], g = data[i+1], b = data[i+2];
    
    // 提亮
    r *= brighten; g *= brighten; b *= brighten;
    
    // 白皙（整体提亮，B略多去黄）
    r *= whitenR; g *= whitenG; b *= whitenB;
    
    // 红润（R多减B）
    r += redTint * 30;
    b -= redTint * 15;
    
    // 对比度
    r = clamp(128 + (r - 128) * contrast);
    g = clamp(128 + (g - 128) * contrast);
    b = clamp(128 + (b - 128) * contrast);
    
    data[i] = clamp(r); data[i+1] = clamp(g); data[i+2] = clamp(b);
  }

  // 第四步：全局锐化
  if (sharpAmount > 0.01) {
    const copy2 = new Uint8ClampedArray(data);
    for (let y = 1; y < h-1; y++) {
      for (let x = 1; x < w-1; x++) {
        for (let c = 0; c < 3; c++) {
          const idx = (y*w+x)*4+c;
          const center = copy2[idx];
          const edge = copy2[idx-4]+copy2[idx+4]+copy2[idx-w*4]+copy2[idx+w*4];
          data[idx] = clamp(center + (center*4-edge)*sharpAmount*0.2);
        }
      }
    }
  }
}

function clamp(v) { return Math.min(255, Math.max(0, v)); }

/* ==================== 拍照 ==================== */
function takePhoto() {
  S.photoData = true;
  S.running = false;
  if (S.stream) { S.stream.getTracks().forEach(t=>t.stop()); S.stream=null; }
  
  previewImg.src = canvas.toDataURL('image/jpeg', 0.92);
  video.style.display='none'; shutterBtn.style.display='none';
  switchBtn.style.display='none'; filterBar.style.display='none';
  document.querySelector('.beauty-panel').style.display='none';
  preview.style.display='flex';
  $('save').style.display='flex'; $('retake').style.display='flex';
}

function savePhoto() {
  const a=document.createElement('a'); a.download=`AI-photo-${Date.now()}.jpg`;
  a.href=canvas.toDataURL('image/jpeg',0.92); a.click();
}
function retake() {
  preview.style.display='none'; $('save').style.display='none'; $('retake').style.display='none';
  video.style.display='block'; shutterBtn.style.display='flex'; switchBtn.style.display='flex';
  filterBar.style.display='flex'; document.querySelector('.beauty-panel').style.display='';
  initCamera();
}

/* ==================== UI 控制 ==================== */
function selectFilter(name) {
  S.filter = name;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter===name));
}

function updateLevel(v) {
  S.level = parseInt(v);
  levelVal.textContent = v;
  // 更新颜色指示
  const pct = v / 10;
  levelSlider.style.background = `linear-gradient(to right, #4ECDC4 0%, #4ECDC4 ${pct*100}%, rgba(255,255,255,0.2) ${pct*100}%)`;
}

function flashEffect() {
  const d=document.createElement('div');
  d.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:white;z-index:9999;transition:opacity 0.35s;';
  document.body.appendChild(d);
  setTimeout(()=>d.style.opacity='0',50); setTimeout(()=>d.remove(),400);
}

function switchCamera() {
  S.facing = S.facing==='user'?'environment':'user';
  initCamera();
}

/* ==================== 事件绑定 ==================== */
shutterBtn.addEventListener('click', ()=>{flashEffect();setTimeout(takePhoto,100)});
$('save').addEventListener('click', savePhoto);
$('retake').addEventListener('click', retake);
switchBtn.addEventListener('click', switchCamera);
levelSlider.addEventListener('input', e => updateLevel(e.target.value));

// 初始化滑块样式
updateLevel(S.level);

// 启动
initCamera();
