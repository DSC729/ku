// ========== 全局状态 ==========
const state = {
  currentStream: null,
  facingMode: 'user',          // 'user' 前置 | 'environment' 后置
  flashMode: 'off',            // 'off' | 'on' | 'auto'
  compositionMode: 'none',     // 构图模式
  beauty: { smooth: 50, whiten: 30, slim: 20, eyes: 20 },
  isBeautyPanelOpen: false,
};

// ========== DOM 元素 ==========
const video       = document.getElementById('camera-preview');
const overlayCV   = document.getElementById('overlay-canvas');
const overlayCtx  = overlayCV.getContext('2d');
const filterCV    = document.getElementById('filter-canvas');
const filterCtx   = filterCV.getContext('2d');
const compBtns    = document.querySelectorAll('.comp-btn');
const beautyPanel = document.getElementById('beauty-panel');

// ========== 初始化相机 ==========
async function initCamera() {
  // 停止旧流
  if (state.currentStream) {
    state.currentStream.getTracks().forEach(t => t.stop());
  }
  try {
    const constraints = {
      video: {
        facingMode: state.facingMode,
        width:  { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    state.currentStream = stream;
    await video.play();
    onCameraReady();
  } catch (err) {
    console.error('相机启动失败:', err);
    alert('无法访问相机，请检查权限设置。');
  }
}

function onCameraReady() {
  const w = video.videoWidth  || video.clientWidth;
  const h = video.videoHeight || video.clientHeight;
  // 同步 overlay canvas 尺寸
  overlayCV.width  = w;
  overlayCV.height = h;
  overlayCV.style.width  = video.clientWidth  + 'px';
  overlayCV.style.height = video.clientHeight + 'px';
  drawComposition();
}

// ========== 构图辅助线 ==========
function drawComposition() {
  const ctx = overlayCtx;
  const w = overlayCV.width, h = overlayCV.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([6, 4]);

  switch (state.compositionMode) {
    case 'thirds':    drawThirds(w, h, ctx);    break;
    case 'golden':    drawGolden(w, h, ctx);    break;
    case 'center':    drawCenter(w, h, ctx);    break;
    case 'diagonal':  drawDiagonal(w, h, ctx);  break;
    default: break;
  }
  ctx.setLineDash([]);
}

function drawThirds(w, h, ctx) {
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(w * i / 3, 0); ctx.lineTo(w * i / 3, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, h * i / 3); ctx.lineTo(w, h * i / 3); ctx.stroke();
  }
}

function drawGolden(w, h, ctx) {
  const phi = 0.618;
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(w * Math.pow(phi, i), 0); ctx.lineTo(w * Math.pow(phi, i), h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, h * Math.pow(phi, i)); ctx.lineTo(w, h * Math.pow(phi, i)); ctx.stroke();
  }
}

function drawCenter(w, h, ctx) {
  ctx.beginPath(); ctx.arc(w/2, h/2, Math.min(w,h)*0.25, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
}

function drawDiagonal(w, h, ctx) {
  ctx.beginPath(); ctx.moveTo(0, 0);      ctx.lineTo(w, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w, 0);      ctx.lineTo(0, h); ctx.stroke();
  ctx.beginPath(); ctx.arc(w/2, h/2, Math.min(w,h)*0.3, 0, Math.PI*2); ctx.stroke();
}

// ========== 美颜滤镜（Canvas 实现） ==========
function applyBeautyFilter() {
  const w = video.videoWidth, h = video.videoHeight;
  filterCV.width  = w; filterCV.height = h;
  filterCtx.drawImage(video, 0, 0, w, h);

  const imgData = filterCtx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const { smooth, whiten } = state.beauty;

  // 美白：提升 RGB 值
  if (whiten > 0) {
    const boost = whiten * 0.8;
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = Math.min(255, d[i]     + boost); // R
      d[i + 1] = Math.min(255, d[i + 1] + boost); // G
      d[i + 2] = Math.min(255, d[i + 2] + boost); // B
    }
  }
  // 磨皮：简易双边模糊（对平滑度>30 时启用）
  if (smooth > 30) {
    bilateralSmooth(d, w, h, Math.round(smooth / 25));
  }
  filterCtx.putImageData(imgData, 0, 0);
  return filterCV.toDataURL('image/jpeg', 0.92);
}

// 简易双边滤波（磨皮效果）
function bilateralSmooth(data, w, h, radius) {
  const copy = new Uint8ClampedArray(data);
  const diag = Math.sqrt(2);
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const idx = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, wtSum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = (ny * w + nx) * 4;
          const dr = copy[idx]     - copy[ni];
          const dg = copy[idx + 1] - copy[ni + 1];
          const db = copy[idx + 2] - copy[ni + 2];
          const colorDist = Math.sqrt(dr*dr + dg*dg + db*db);
          const spatialDist = Math.sqrt(dx*dx + dy*dy) / radius;
          const weight = Math.exp(-spatialDist * 1.5 - colorDist * 0.03);
          r += copy[ni]     * weight;
          g += copy[ni + 1] * weight;
          b += copy[ni + 2] * weight;
          wtSum += weight;
        }
      }
      data[idx]     = r / wtSum;
      data[idx + 1] = g / wtSum;
      data[idx + 2] = b / wtSum;
    }
  }
}

// ========== 拍照 ==========
function capturePhoto() {
  let dataURL;
  if (state.beauty.smooth > 0 || state.beauty.whiten > 0) {
    dataURL = applyBeautyFilter();
  } else {
    const cv = document.createElement('canvas');
    cv.width  = video.videoWidth;
    cv.height = video.videoHeight;
    cv.getContext('2d').drawImage(video, 0, 0);
    dataURL = cv.toDataURL('image/jpeg', 0.92);
  }
  showPreview(dataURL);
}

function showPreview(dataURL) {
  const modal = document.getElementById('preview-modal');
  const img   = document.getElementById('captured-img');
  img.src = dataURL;
  modal.classList.remove('hidden');
  // 保存基准数据供"保存"按钮使用
  modal.dataset.dataUrl = dataURL;
}

// ========== 事件绑定 ==========
// 构图按钮
compBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    compBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.compositionMode = btn.dataset.mode;
    drawComposition();
  });
});

// 切换摄像头
document.getElementById('btn-switch').addEventListener('click', () => {
  state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
  initCamera();
});

// 闪光灯
document.getElementById('btn-flash').addEventListener('click', () => {
  const modes = ['off', 'on', 'auto'];
  const idx = modes.indexOf(state.flashMode);
  state.flashMode = modes[(idx + 1) % modes.length];
  const track = state.currentStream?.getVideoTracks()[0];
  if (track) track.applyConstraints({ advanced: [{ torch: state.flashMode === 'on' }] });
  document.getElementById('btn-flash').textContent = state.flashMode === 'on' ? '⚡' : state.flashMode === 'auto' ? '⚡📷' : '⚡';
});

// 美颜面板
document.getElementById('btn-beauty').addEventListener('click', () => {
  state.isBeautyPanelOpen = !state.isBeautyPanelOpen;
  beautyPanel.classList.toggle('hidden', !state.isBeautyPanelOpen);
});

// 美颜滑块
['smooth','whiten','slim','eyes'].forEach(key => {
  const input = document.getElementById(key);
  const valSpan = document.getElementById(key + '-val');
  input.addEventListener('input', () => {
    state.beauty[key] = parseInt(input.value);
    valSpan.textContent = input.value;
  });
});

// 拍照
document.getElementById('btn-capture').addEventListener('click', capturePhoto);

// 预览弹窗按钮
document.getElementById('btn-save').addEventListener('click', () => {
  const dataURL = document.getElementById('preview-modal').dataset.dataUrl;
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = `photo_${Date.now()}.jpg`;
  a.click();
  document.getElementById('preview-modal').classList.add('hidden');
});

document.getElementById('btn-retake').addEventListener('click', () => {
  document.getElementById('preview-modal').classList.add('hidden');
});

// 设置按钮（占位）
document.getElementById('btn-settings').addEventListener('click', () => {
  alert('设置功能开发中…');
});

// 相册按钮（占位）
document.getElementById('btn-gallery').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => showPreview(ev.target.result);
    reader.readAsDataURL(file);
  };
  input.click();
});

// 窗口尺寸变化时重绘辅助线
window.addEventListener('resize', () => { if (video.readyState >= 2) onCameraReady(); });

// ========== 启动 ==========
initCamera();
