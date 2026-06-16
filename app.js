// =================================================================
//  AI 摄影大师 v7.0 — 极简版
//  核心：拍照 → 自动美颜 → 保存/重拍
// =================================================================
'use strict';

/* ==================== 全局状态 ==================== */
const S = {
  stream: null,
  facing: 'user',
  photoData: null,
  beautyApplied: false,
};

/* ==================== DOM ==================== */
const $ = id => document.getElementById(id);
const video = $('cam'), canvas = $('canvas'), ctx = canvas.getContext('2d');
const preview = $('preview'), previewImg = $('preview-img');
const shutterBtn = $('shutter'), saveBtn = $('save'), retakeBtn = $('retake');
const switchBtn = $('switch-cam'), flashBtn = $('flash');
const beautyIndicator = $('beauty-indicator');

/* ==================== 相机初始化 ==================== */
async function initCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: S.facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    video.srcObject = S.stream;
    await video.play();
  } catch (e) {
    alert('需要相机权限才能使用');
  }
}

/* ==================== 拍照 ==================== */
function takePhoto() {
  // 设置画布尺寸匹配视频
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  
  // 绘制当前帧
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  // 获取图像数据
  S.photoData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  // 停止相机流
  if (S.stream) {
    S.stream.getTracks().forEach(t => t.stop());
    S.stream = null;
  }
  
  // 显示预览界面
  video.style.display = 'none';
  shutterBtn.style.display = 'none';
  switchBtn.style.display = 'none';
  
  preview.style.display = 'flex';
  beautyIndicator.style.display = 'block';
  beautyIndicator.textContent = '✨ 正在美颜...';
  
  // 自动美颜（异步）
  setTimeout(() => {
    applyBeauty();
  }, 100);
}

/* ==================== 美颜算法 ==================== */
function applyBeauty() {
  const w = canvas.width, h = canvas.height;
  const imgData = S.photoData;
  const data = imgData.data;
  
  // 1. 磨皮（轻微高斯模糊）
  const smoothed = gaussianBlur(data, w, h, 2);
  
  // 2. 肤色提亮
  for (let i = 0; i < data.length; i += 4) {
    const r = smoothed[i], g = smoothed[i+1], b = smoothed[i+2];
    
    // 肤色检测（简单版）
    const isSkin = r > 60 && g > 40 && b > 20 && 
                   r > g && r > b && 
                   Math.abs(r - g) > 15;
    
    if (isSkin) {
      // 提亮 + 轻微红润
      data[i] = Math.min(255, r * 1.08);     // R
      data[i+1] = Math.min(255, g * 1.05);   // G
      data[i+2] = Math.min(255, b * 0.95);   // B 减一点，显红润
    } else {
      data[i] = r;
      data[i+1] = g;
      data[i+2] = b;
    }
  }
  
  // 3. 对比度增强（S曲线）
  enhanceContrast(data, 1.15);
  
  // 4. 锐化
  sharpen(data, w, h, 0.3);
  
  // 写回画布
  ctx.putImageData(imgData, 0, 0);
  
  // 显示结果
  previewImg.src = canvas.toDataURL('image/jpeg', 0.95);
  
  beautyIndicator.textContent = '✨ 美颜完成';
  beautyIndicator.style.background = 'rgba(78, 205, 196, 0.9)';
  
  saveBtn.style.display = 'flex';
  retakeBtn.style.display = 'flex';
  S.beautyApplied = true;
}

/* 高斯模糊 */
function gaussianBlur(src, w, h, radius) {
  const dst = new Uint8ClampedArray(src);
  const kernel = makeGaussKernel(radius);
  const tmp = new Uint8ClampedArray(src.length);
  
  // 水平
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0, weight = 0;
        for (let k = -radius; k <= radius; k++) {
          const px = Math.min(w-1, Math.max(0, x + k));
          const wgt = kernel[k + radius];
          sum += src[(y * w + px) * 4 + c] * wgt;
          weight += wgt;
        }
        tmp[(y * w + x) * 4 + c] = sum / weight;
      }
    }
  }
  
  // 垂直
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0, weight = 0;
        for (let k = -radius; k <= radius; k++) {
          const py = Math.min(h-1, Math.max(0, y + k));
          const wgt = kernel[k + radius];
          sum += tmp[(py * w + x) * 4 + c] * wgt;
          weight += wgt;
        }
        dst[(y * w + x) * 4 + c] = sum / weight;
      }
    }
  }
  
  return dst;
}

function makeGaussKernel(r) {
  const size = r * 2 + 1;
  const kernel = new Float32Array(size);
  const sigma = r / 2;
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - r;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return kernel;
}

/* 对比度增强 */
function enhanceContrast(data, factor) {
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = data[i + c];
      data[i + c] = Math.min(255, Math.max(0, 128 + (v - 128) * factor));
    }
  }
}

/* 锐化 */
function sharpen(data, w, h, amount) {
  const orig = new Uint8ClampedArray(data);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        const idx = (y * w + x) * 4 + c;
        const center = orig[idx];
        const edge = orig[idx - 4] + orig[idx + 4] + orig[idx - w*4] + orig[idx + w*4];
        data[idx] = Math.min(255, Math.max(0, center + (center * 4 - edge) * amount));
      }
    }
  }
}

/* ==================== 保存/重拍 ==================== */
function savePhoto() {
  const link = document.createElement('a');
  link.download = `AI-photo-${Date.now()}.jpg`;
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
  toast('✅ 照片已保存');
}

function retake() {
  preview.style.display = 'none';
  saveBtn.style.display = 'none';
  retakeBtn.style.display = 'none';
  beautyIndicator.style.display = 'none';
  video.style.display = 'block';
  shutterBtn.style.display = 'flex';
  switchBtn.style.display = 'flex';
  
  S.photoData = null;
  S.beautyApplied = false;
  initCamera();
}

/* ==================== 工具 ==================== */
function toggleFlash() {
  // 前端闪光灯效果（屏幕变白）
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:white;z-index:9999;transition:opacity 0.3s;';
  document.body.appendChild(flash);
  setTimeout(() => flash.style.opacity = '0', 50);
  setTimeout(() => flash.remove(), 350);
}

function switchCamera() {
  S.facing = S.facing === 'user' ? 'environment' : 'user';
  initCamera();
}

function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:white;padding:12px 24px;border-radius:24px;font-size:14px;z-index:10000;';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

/* ==================== 事件绑定 ==================== */
shutterBtn.addEventListener('click', () => { toggleFlash(); setTimeout(takePhoto, 100); });
saveBtn.addEventListener('click', savePhoto);
retakeBtn.addEventListener('click', retake);
switchBtn.addEventListener('click', switchCamera);
flashBtn.addEventListener('click', toggleFlash);

// 启动
initCamera();
