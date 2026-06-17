// =================================================================
//  AI 摄影大师 v8.0 — 实时美颜 + 滤镜 + 镜像
// =================================================================
'use strict';

const S = {
  stream: null,
  facing: 'user',
  photoData: null,
  // 美颜参数
  beauty: { smooth: 0.5, brighten: 1.08, whiten: 1.05, contrast: 1.15, sharp: 0.3 },
  // 当前滤镜
  filter: 'none', // none|warm|cool|vintage|bw|fresh|film|pink
  // 渲染状态
  running: false,
};

const $ = id => document.getElementById(id);
const video = $('cam'), canvas = $('canvas'), ctx = canvas.getContext('2d');
const preview = $('preview'), previewImg = $('preview-img');
const shutterBtn = $('shutter'), saveBtn = $('save'), retakeBtn = $('retake');
const switchBtn = $('switch-cam');
const filterBar = $('filter-bar');
const beautyIndicator = $('beauty-indicator');

/* ==================== 滤镜定义 ==================== */
const FILTERS = {
  none: { name: '原图', fn: null },
  warm: { name: '暖阳', fn: (r,g,b) => [Math.min(255,r*1.15), g, b*0.9] },
  cool: { name: '冷调', fn: (r,g,b) => [r*0.9, g, Math.min(255,b*1.2)] },
  vintage: { name: '复古', fn: (r,g,b) => {
    const v = r*0.393+g*0.769+b*0.189;
    return [Math.min(255,v), Math.min(255,v*0.9), Math.min(255,v*0.7)];
  }},
  bw: { name: '黑白', fn: (r,g,b) => {
    const v = r*0.299+g*0.587+b*0.114;
    return [v,v,v];
  }},
  fresh: { name: '清新', fn: (r,g,b) => [
    Math.min(255, r*1.05),
    Math.min(255, g*1.12),
    Math.min(255, b*1.05)
  ]},
  film: { name: '胶片', fn: (r,g,b) => [
    Math.min(255, r*1.1 + b*0.05),
    g*0.95,
    Math.min(255, b*0.85 + r*0.1)
  ]},
  pink: { name: '粉嫩', fn: (r,g,b) => [
    Math.min(255, r*1.1),
    Math.min(255, g*1.02),
    Math.min(255, b*1.08)
  ]},
};

/* ==================== 相机初始化 ==================== */
async function initCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = S.stream;
    await video.play();
    
    // 设置画布尺寸
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    // 启动实时渲染循环
    if (!S.running) {
      S.running = true;
      renderLoop();
    }
  } catch(e) {
    alert('需要相机权限才能使用');
  }
}

/* ==================== 实时渲染循环（核心） ==================== */
function renderLoop() {
  if (!S.running) return;
  
  const w = canvas.width, h = canvas.height;
  
  // 绘制视频帧（前置摄像头自动镜像）
  ctx.save();
  if (S.facing === 'user') {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();
  
  // 获取像素数据做实时处理
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    
    // 1. 美颜磨皮（快速版：均值模糊混合）
    applyBeauty(data, w, h);
    
    // 2. 滤镜
    if (S.filter !== 'none' && FILTERS[S.filter].fn) {
      for (let i = 0; i < data.length; i += 4) {
        const [nr, ng, nb] = FILTERS[S.filter].fn(data[i], data[i+1], data[i+2]);
        data[i] = nr; data[i+1] = ng; data[i+2] = nb;
      }
    }
    
    ctx.putImageData(imgData, 0, 0);
  } catch(e) {}
  
  requestAnimationFrame(renderLoop);
}

/* ==================== 美颜算法 ==================== */
function applyBeauty(data, w, h) {
  const { smooth, brighten, whiten, contrast, sharp } = S.beauty;
  
  // 快速磨皮：用缩小-放大法模拟高斯模糊，再与原图混合
  const skinMask = new Uint8Array(w * h); // 肤色掩码
  
  // 第一步：检测肤色区域
  for (let i = 0; i < data.length; i += 4) {
    const idx = i / 4;
    const r = data[i], g = data[i+1], b = data[i+2];
    
    // YCbCr 肤色检测（更准确）
    const y = 0.299*r + 0.587*g + 0.114*b;
    const cb = -0.169*r - 0.331*g + 0.5*b + 128;
    const cr = 0.5*r - 0.419*g - 0.081*b + 128;
    
    // 肤色范围判断
    const isSkin = (
      cb >= 77 && cb <= 127 &&
      cr >= 133 && cr <= 173 &&
      y > 80
    );
    
    skinMask[idx] = isSkin ? 1 : 0;
  }
  
  // 第二步：对肤色区域做平滑处理（3x3 均值滤波）
  if (smooth > 0) {
    const copy = new Uint8ClampedArray(data);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        if (!skinMask[idx]) continue;
        
        for (let c = 0; c < 3; c++) {
          let sum = 0, count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              sum += copy[((y+dy)*w+(x+dx))*4+c];
              count++;
            }
          }
          const blurred = sum / count;
          // 原图与模糊图按比例混合
          data[idx*4+c] = data[idx*4+c] * (1 - smooth * 0.5) + blurred * smooth * 0.5;
        }
      }
    }
  }
  
  // 第三步：肤色提亮 + 红润
  for (let i = 0; i < data.length; i += 4) {
    const idx = i / 4;
    if (!skinMask[idx]) continue;
    
    let r = data[i], g = data[i+1], b = data[i+2];
    
    // 提亮
    r = Math.min(255, r * brighten);
    g = Math.min(255, g * brighten);
    b = Math.min(255, b * brighten);
    
    // 白皙（减少黄色）
    r = Math.min(255, r * whiten);
    g = Math.min(255, g * (whiten - 0.03));
    b = Math.min(255, b * (whiten + 0.04));
    
    // 对比度增强
    r = Math.min(255, Math.max(0, 128 + (r - 128) * contrast));
    g = Math.min(255, Math.max(0, 128 + (g - 128) * contrast));
    b = Math.min(255, Math.max(0, 128 + (b - 128) * contrast));
    
    data[i] = r; data[i+1] = g; data[i+2] = b;
  }
  
  // 第四步：全局锐化
  if (sharp > 0) {
    const copy2 = new Uint8ClampedArray(data);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        for (let c = 0; c < 3; c++) {
          const idx = (y*w+x)*4+c;
          const center = copy2[idx];
          const edge = copy2[idx-4]+copy2[idx+4]+copy2[idx-w*4]+copy2[idx+w*4];
          data[idx] = Math.min(255, Math.max(0, center + (center*4-edge)*sharp*0.25));
        }
      }
    }
  }
}

/* ==================== 拍照 ==================== */
function takePhoto() {
  // 当前画布就是已经美颜+滤镜后的画面，直接保存
  S.photoData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  // 停止渲染和相机
  S.running = false;
  if (S.stream) {
    S.stream.getTracks().forEach(t => t.stop());
    S.stream = null;
  }
  
  // 显示预览
  previewImg.src = canvas.toDataURL('image/jpeg', 0.92);
  video.style.display = 'none';
  shutterBtn.style.display = 'none';
  switchBtn.style.display = 'none';
  filterBar.style.display = 'none';
  preview.style.display = 'flex';
  saveBtn.style.display = 'flex';
  retakeBtn.style.display = 'flex';
}

/* ==================== 保存/重拍 ==================== */
function savePhoto() {
  const link = document.createElement('a');
  link.download = `AI-photo-${Date.now()}.jpg`;
  link.href = canvas.toDataURL('image/jpeg', 0.92);
  link.click();
}

function retake() {
  preview.style.display = 'none';
  saveBtn.style.display = 'none';
  retakeBtn.style.display = 'none';
  video.style.display = 'block';
  shutterBtn.style.display = 'flex';
  switchBtn.style.display = 'flex';
  filterBar.style.display = 'flex';
  
  S.photoData = null;
  initCamera();
}

/* ==================== 滤镜切换 ==================== */
function selectFilter(name) {
  S.filter = name;
  // 更新 UI 高亮
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === name);
  });
}

/* ==================== 闪光灯效果 ==================== */
function flashEffect() {
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:white;z-index:9999;transition:opacity 0.35s;';
  document.body.appendChild(flash);
  setTimeout(() => flash.style.opacity = '0', 50);
  setTimeout(() => flash.remove(), 400);
}

function switchCamera() {
  S.facing = S.facing === 'user' ? 'environment' : 'user';
  initCamera();
}

/* ==================== 事件绑定 ==================== */
shutterBtn.addEventListener('click', () => { flashEffect(); setTimeout(takePhoto, 100); });
saveBtn.addEventListener('click', savePhoto);
retakeBtn.addEventListener('click', retake);
switchBtn.addEventListener('click', switchCamera);

// 启动
initCamera();
