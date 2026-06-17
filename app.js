// =================================================================
//  AI 摄影大师 v10.0 — 保边磨皮 + 强美白 + 瘦脸变形
// =================================================================
'use strict';

const S = {
  stream: null, facing: 'user', running: false, level: 6,
  // 上一帧用于帧间混合（减少闪烁）
  prevData: null,
};

const $ = id => document.getElementById(id);
const video = $('cam'), canvas = $('canvas'), ctx = canvas.getContext('2d');

/* ==================== 滤镜 ==================== */
const FILTERS = {
  none:    { name:'原图', fn:null },
  warm:    { name:'暖阳', fn:(r,g,b)=>[Math.min(255,r*1.18),g,b*0.88] },
  cool:    { name:'冷调', fn:(r,g,b)=>[r*0.88,g,Math.min(255,b*1.22)] },
  vintage: { name:'复古', fn:(r,g,b)=>{let v=r*.393+g*.769+b*.189;return[Math.min(255,v),Math.min(255,v*.88),Math.min(255,v*.68)]} },
  bw:      { name:'黑白', fn:(r,g,b)=>{let v=r*.299+g*.587+b*.114;return[v,v,v]} },
  fresh:   { name:'清新', fn:(r,g,b)=>[Math.min(255,r*1.06),Math.min(255,g*1.14),Math.min(255,b*1.1)] },
  film:    { name:'胶片', fn:(r,g,b)=>[Math.min(255,r*1.12+b*.06),g*.92,Math.min(255,b*.82+r*.12)] },
  pink:    { name:'粉嫩', fn:(r,g,b)=>[Math.min(255,r*1.14),Math.min(255,g*1.03),Math.min(255,b*1.12)] },
  milk:    { name:'奶白', fn:(r,g,b)=>[Math.min(255,r*1.16),Math.min(255,g*1.2),Math.min(255,b*1.18)] },
  caramel: { name:'焦糖', fn:(r,g,b)=>[Math.min(255,r*1.22),Math.min(255,g*1.06),b*0.84] },
};

/* ==================== 相机 ==================== */
async function initCamera() {
  if (S.stream) S.stream.getTracks().forEach(t=>t.stop());
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: S.facing, width:{ideal:640}, height:{ideal:480} }, audio:false
    });
    video.srcObject = S.stream;
    await video.play();
    canvas.width = video.videoWidth||640;
    canvas.height = video.videoHeight||480;
    S.prevData = null;
    if (!S.running) { S.running=true; renderLoop(); }
  } catch(e) { alert('需要相机权限'); }
}

/* ==================== 渲染循环 ==================== */
function renderLoop() {
  if (!S.running) return;
  const w=canvas.width, h=canvas.height;
  
  ctx.save();
  if (S.facing==='user') { ctx.translate(w,0); ctx.scale(-1,1); }
  ctx.drawImage(video,0,0,w,h);
  ctx.restore();
  
  try {
    const imgData = ctx.getImageData(0,0,w,h);
    const data = imgData.data;
    
    // 美颜
    processBeauty(data, w, h, S.level);
    
    // 滤镜
    const fn = FILTERS[S.filter]?.fn;
    if (fn) {
      for (let i=0; i<data.length; i+=4) {
        [data[i],data[i+1],data[i+2]] = fn(data[i],data[i+1],data[i+2]);
      }
    }
    
    ctx.putImageData(imgData,0,0);
  } catch(e) {}
  
  requestAnimationFrame(renderLoop);
}

/* ==================== 核心美颜 ==================== */
function processBeauty(data, w, h, level) {
  const t = level / 10; // 0~1 归一化强度
  if (t < 0.01) return; // level=0 不处理
  
  // ===== Step 1: 肤色检测 (YCbCr，宽松范围) =====
  const skin = new Uint8Array(w * h);
  for (let i=0; i<data.length; i+=4) {
    const r=data[i], g=data[i+1], b=data[i+2];
    const y  = 0.299*r + 0.587*g + 0.114*b;
    const cb = -0.169*r - 0.331*g + 0.5*b + 128;
    const cr = 0.5*r - 0.419*g - 0.081*b + 128;
    // 宽松肤色范围
    skin[i/4] = (cb>=65 && cb<=140 && cr>=123 && cr<=185 && y>50) ? 1 : 0;
  }
  
  // ===== Step 2: 保边磨皮 (Bilateral近似) =====
  // 只平滑平坦肤色区域，保留边缘
  const radius = 2; // 固定半径
  const threshold = 8 + t * 25; // 边缘阈值随等级增大（更强的磨皮跨越更多边缘）
  const mixStrength = 0.3 + t * 0.5; // 混合强度 0.3~0.8
  const copy = new Uint8ClampedArray(data);
  
  for (let y=radius; y<h-radius; y++) {
    for (let x=radius; x<w-radius; x++) {
      const idx = y*w+x;
      if (!skin[idx]) continue;
      
      for (let c=0; c<3; c++) {
        const center = copy[idx*4+c];
        let sum=center, count=1;
        
        for (let dy=-radius; dy<=radius; dy++) {
          for (let dx=-radius; dx<=radius; dx++) {
            if (dx===0&&dy===0) continue;
            const ni = (y+dy)*w+(x+dx);
            if (!skin[ni]) continue;
            const neighbor = copy[ni*4+c];
            // 只混合颜色差异小于阈值的像素（保留边缘）
            if (Math.abs(neighbor-center) < threshold) {
              sum += neighbor;
              count++;
            }
          }
        }
        
        if (count > 1) {
          const blurred = sum / count;
          data[idx*4+c] = center*(1-mixStrength) + blurred*mixStrength;
        }
      }
    }
  }
  
  // ===== Step 3: 强美白提亮（仅肤色区域）=====
  const brightenFactor = 1.0 + t * 0.35;   // 最大提亮1.35倍
  const whitenR = 1.0 + t * 0.18;           // R提亮
  const whitenG = 1.0 + t * 0.16;           // G
  const whitenB = 1.0 + t * 0.22;           // B更多→去黄显白
  const contrastFactor = 1.0 + t * 0.15;     // 对比度
  
  for (let i=0; i<data.length; i+=4) {
    if (!skin[i/4]) continue;
    
    let r=data[i], g=data[i+1], b=data[i+2];
    
    // 提亮
    r *= brightenFactor;
    g *= brightenFactor;
    b *= brightenFactor;
    
    // 白皙（去黄：B多提，减少橙色感）
    r *= whitenR;
    g *= whitenG;
    b *= whitenB;
    
    // 红润（轻微加红减蓝）
    r += t * 18;
    b -= t * 10;
    
    // 对比度
    r = 128 + (r-128) * contrastFactor;
    g = 128 + (g-128) * contrastFactor;
    b = 128 + (b-128) * contrastFactor;
    
    data[i]=clamp(r); data[i+1]=clamp(g); data[i+2]=clamp(b);
  }
  
  // ===== Step 4: 瘦脸变形 =====
  if (t > 0.2) {
    applyFaceSlim(data, w, h, skin, t * 0.7); // 瘦脸强度随等级增加
  }
}

/* ==================== 瘦脸算法 ==================== */
function applyFaceSlim(data, w, h, skin, strength) {
  // 1. 找肤色区域中心（近似人脸中心）
  let sumX=0, sumY=0, count=0;
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      if (skin[y*w+x]) { sumX+=x; sumY+=y; count++; }
    }
  }
  if (count < w*h*0.02) return; // 肤色太少，跳过
  
  const cx = sumX/count, cy = sumY/count;
  
  // 2. 估算人脸范围
  let minX=w, maxX=0, minY=h, maxY=0;
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      if (skin[y*w+x]) {
        if(x<minX) minX=x; if(x>maxX) maxX=x;
        if(y<minY) minY=y; if(y>maxY) maxY=y;
      }
    }
  }
  const faceW = maxX-minX, faceH = maxY-minY;
  if (faceW < 20 || faceH < 20) return;
  
  // 3. 创建变形映射表
  const srcX = new Float32Array(w*h);
  const srcY = new Float32Array(w*h);
  const radiusX = faceW * 0.45; // 影响水平半径
  const radiusY = faceH * 0.45; // 影响垂直半径
  const shrinkX = strength * 0.12; // 水平收缩比
  
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      const idx = y*w+x;
      // 只在人脸附近区域做变形
      const dx = (x-cx)/radiusX;
      const dy = (y-cy)/radiusY;
      const dist2 = dx*dx + dy*dy;
      
      if (dist2 < 1.0) {
        // 靠近中心越收缩越多，边缘不收缩
        const factor = 1.0 - dist2; // 0~1，中心最大
        const pull = shrinkX * factor * factor;
        srcX[idx] = x - (x-cx) * pull;
        srcY[idx] = y;
      } else {
        srcX[idx] = x;
        srcY[idx] = y;
      }
    }
  }
  
  // 4. 应用变形（双线性插值）
  const copy = new Uint8ClampedArray(data);
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      const idx = y*w+x;
      const sx = srcX[idx], sy = srcY[idx];
      
      if (sx===x && sy===y) continue; // 无变化
      
      const x0=Math.floor(sx), y0=Math.floor(sy);
      const x1=Math.min(w-1,x0+1), y1=Math.min(h-1,y0+1);
      const fx=sx-x0, fy=sy-y0;
      
      for (let c=0; c<3; c++) {
        data[idx*4+c] = clamp(
          copy[y0*w+x0+4*c]*(1-fx)*(1-fy) +
          copy[y0*w+x1+4+c]*fx*(1-fy) +
          copy[y1*w+x0+4+c]*(1-fx)*fy +
          copy[y1*w+x1+4+c]*fx*fy
        );
      }
    }
  }
}

function clamp(v) { return v<0?0:v>255?255:v; }

/* ==================== UI ==================== */
function takePhoto() {
  S.running = false;
  if (S.stream) { S.stream.getTracks().forEach(t=>t.stop()); S.stream=null; }
  $('preview-img').src = canvas.toDataURL('image/jpeg',0.92);
  $('cam').style.display='none';
  $('shutter').style.display='none';
  $('switch-cam').style.display='none';
  $('filter-bar').style.display='none';
  document.querySelector('.beauty-panel').style.display='none';
  $('preview').style.display='flex';
  $('save').style.display='flex'; $('retake').style.display='flex';
}

function savePhoto() {
  const a=document.createElement('a'); a.download=`AI-photo-${Date.now()}.jpg`;
  a.href=canvas.toDataURL('image/jpeg',0.92); a.click();
}
function retake() {
  $('preview').style.display='none'; $('save').style.display='none'; $('retake').style.display='none';
  $('shutter').style.display='flex'; $('switch-cam').style.display='flex';
  $('filter-bar').style.display='flex'; document.querySelector('.beauty-panel').style.display='';
  initCamera();
}

function selectFilter(name) {
  S.filter = name;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter===name));
}

function updateLevel(v) {
  S.level = parseInt(v);
  $('level-val').textContent = v;
  const pct = v/10;
  $('level-slider').style.background = `linear-gradient(to right,#4ECDC4 0%,#4ECDC4 ${pct*100}%,rgba(255,255,255,.2) ${pct*100}%)`;
}

function flashEffect() {
  const d=document.createElement('div');
  d.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:white;z-index:9999;transition:opacity .35s;';
  document.body.appendChild(d);
  setTimeout(()=>d.style.opacity='0',50);setTimeout(()=>d.remove(),400);
}

function switchCamera() { S.facing=S.facing==='user'?'environment':'user'; initCamera(); }

/* ==================== 事件 ==================== */
$('shutter').addEventListener('click',()=>{flashEffect();setTimeout(takePhoto,100)});
$('save').addEventListener('click',savePhoto);
$('retake').addEventListener('click',retake);
$('switch-cam').addEventListener('click',switchCamera);
$('level-slider').addEventListener('input',e=>updateLevel(e.target.value));
updateLevel(S.level);
initCamera();
