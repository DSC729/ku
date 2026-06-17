// =================================================================
//  AI 摄影大师 v11.0 — 零画质损失美颜方案
//  核心：CSS filter保画质 + 轻量肤色提亮 + 液化瘦脸
// =================================================================
'use strict';

const S = {
  stream: null, facing: 'user', running: false, level: 6, filter: 'none',
};

const $ = id => document.getElementById(id);
const video = $('cam'), canvas = $('canvas'), ctx = canvas.getContext('2d');

/* ==================== 滤镜 ==================== */
const FILTERS = {
  none:    { name:'原图', css:'' },
  warm:    { name:'暖阳', css:'sepia(0.15) saturate(1.3) brightness(1.05)' },
  cool:    { name:'冷调', css:'hue-rotate(10deg) saturate(0.9) brightness(1.05)' },
  vintage: { name:'复古', css:'sepia(0.35) contrast(1.1) brightness(0.95)' },
  bw:      { name:'黑白', css:'grayscale(1) contrast(1.15)' },
  fresh:   { name:'清新', css:'saturate(1.35) brightness(1.08) contrast(1.05)' },
  film:    { name:'胶片', css:'sepia(0.12) contrast(1.2) brightness(0.92) saturate(1.1)' },
  pink:    { name:'粉嫩', css:'saturate(1.25) hue-rotate(330deg) brightness(1.06)' },
  milk:    { name:'奶白', css:'brightness(1.18) contrast(0.95) saturate(0.85)' },
  caramel: { name:'焦糖', css:'sepia(0.25) saturate(1.4) brightness(0.95)' },
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
    if (!S.running) { S.running=true; renderLoop(); }
  } catch(e) { alert('需要相机权限'); }
}

/* ==================== 渲染循环 ==================== */
function renderLoop() {
  if (!S.running) return;
  const w=canvas.width, h=canvas.height;
  const t = S.level / 10;

  // 用 CSS filter 画质无损处理
  let filterStr = '';
  if (t > 0) {
    // 美颜基础：微亮+高对比让脸更有质感（零画质损失）
    filterStr += `brightness(${1 + t*0.12}) contrast(${1 + t*0.1})`;
    // 微饱和让肤色好看
    filterStr += ` saturate(${1 + t*0.15})`;
  }
  
  // 叠加用户选的滤镜
  if (S.filter !== 'none' && FILTERS[S.filter]) {
    filterStr += ' ' + FILTERS[S.filter].css;
  }
  
  canvas.style.filter = filterStr || 'none';

  // 绘制视频帧（前置镜像）
  ctx.save();
  if (S.facing==='user') { ctx.translate(w,0); ctx.scale(-1,1); }
  ctx.drawImage(video,0,0,w,h);
  ctx.restore();

  // 只有 level>=5 才做轻量像素美白（避免低等级时处理）
  if (t >= 0.3) {
    try {
      const imgData = ctx.getImageData(0,0,w,h);
      skinWhiten(imgData.data, imgData.width, imgData.height, t);
      ctx.putImageData(imgData,0,0);
    } catch(e) {}
  }

  requestAnimationFrame(renderLoop);
}

/* ==================== 轻量美白（仅提亮肤色像素，不模糊）==================== */
function skinWhiten(data, w, h, t) {
  // 只做提亮，不做任何模糊操作
  const brighten = 1 + t * 0.22;  // 最大 1.22x
  const bBoost = 1 + t * 0.15;    // B额外提升去黄
  
  for (let i=0; i<data.length; i+=4) {
    const r=data[i], g=data[i+1], b=data[i+2];
    
    // 快速肤色检测（简化YCbCr）
    const y  = 0.299*r + 0.587*g + 0.114*b;
    const cb = -0.169*r - 0.331*g + 0.5*b + 128;
    const cr = 0.5*r - 0.419*g - 0.081*b + 128;
    
    if (cb>=65 && cb<=140 && cr>=123 && cr<=185 && y>50) {
      // 仅提亮肤色像素，零模糊
      data[i]   = clamp(r * brighten);         // R
      data[i+1] = clamp(g * brighten);         // G
      data[i+2] = clamp(b * brighten * bBoost); // B更多→去黄显白
    }
  }
}

function clamp(v) { return v<0?0:v>255?255:v; }

/* ==================== 拍照 ==================== */
function takePhoto() {
  S.running = false;
  if (S.stream) { S.stream.getTracks().forEach(t=>t.stop()); S.stream=null; }
  
  // 拍照时重新渲染一帧（确保带美颜）
  const t = S.level/10;
  let filterStr = '';
  if (t > 0) filterStr += `brightness(${1+t*0.12}) contrast(${1+t*0.1}) saturate(${1+t*0.15})`;
  if (S.filter!=='none' && FILTERS[S.filter]) filterStr += ' '+FILTERS[S.filter].css;
  canvas.style.filter = filterStr||'none';
  
  const w=canvas.width, h=canvas.height;
  ctx.save();
  if (S.facing==='user'){ctx.translate(w,0);ctx.scale(-1,1);}
  ctx.drawImage(video,0,0,w,h);
  ctx.restore();
  
  if (t>=0.3) {
    try {
      const imgData=ctx.getImageData(0,0,w,h);
      skinWhiten(imgData.data,w,h,t);
      ctx.putImageData(imgData,0,0);
    }catch(e){}
  }
  
  // 瘦脸（拍照时做一次即可）
  if (t >= 0.3) {
    try {
      const imgData=ctx.getImageData(0,0,w,h);
      faceSlim(imgData.data,w,h,t*0.08);
      ctx.putImageData(imgData,0,0);
    }catch(e){}
  }
  
  $('preview-img').src = canvas.toDataURL('image/jpeg',0.95);
  $('shutter').style.display='none'; $('switch-cam').style.display='none';
  $('filter-bar').style.display='none';
  document.querySelector('.beauty-panel').style.display='none';
  $('preview').style.display='flex';
  $('save').style.display='flex'; $('retake').style.display='flex';
}

/* ==================== 瘦脸（拍照时一次性做）==================== */
function faceSlim(data, w, h, strength) {
  if (strength < 0.01) return;
  
  // 找肤色中心
  let sx=0,sy=0,cnt=0,minX=w,maxX=0,minY=h,maxY=0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const i=y*w+x, r=data[i*4],g=data[i*4+1],b=data[i*4+2];
    const y_=0.299*r+0.587*g+0.114*b, cb=-0.169*r-0.331*g+0.5*b+128, cr=0.5*r-0.419*g-0.081*b+128;
    if(cb>=65&&cb<=140&&cr>=123&&cr<=185&&y_>50) {
      sx+=x;sy+=y;cnt++;
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
    }
  }
  if(cnt<w*h*0.02) return;
  const cx=sx/cnt,cy=sy/cnt;
  const fw=maxX-minX,fh=maxY-minY;
  if(fw<20||fh<20) return;
  
  const rx=fw*0.5, ry=fh*0.5;
  const copy = new Uint8ClampedArray(data);
  
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const dx=(x-cx)/rx, dy=(y-cy)/ry;
    const d2=dx*dx+dy*dy;
    if(d2>=1) continue;
    
    const factor=(1-d2); // 中心最强
    const pull=strength*factor*factor;
    const srcX=x-(x-cx)*pull;
    const srcY=y;
    
    const x0=Math.floor(srcX), y0=Math.floor(srcY);
    const x1=Math.min(w-1,x0+1), y1=Math.min(h-1,y0+1);
    const fx=srcX-x0, fy=srcY-y0;
    const idx=(y*w+x)*4;
    
    for (let c=0;c<3;c++) {
      data[idx+c]=clamp(
        copy[(y0*w+x0)*4+c]*(1-fx)*(1-fy) +
        copy[(y0*w+x1)*4+c]*fx*(1-fy) +
        copy[(y1*w+x0)*4+c]*(1-fx)*fy +
        copy[(y1*w+x1)*4+c]*fx*fy
      );
    }
  }
}

/* ==================== UI ==================== */
function savePhoto() {
  const a=document.createElement('a'); a.download=`AI-photo-${Date.now()}.jpg`;
  a.href=canvas.toDataURL('image/jpeg',0.95); a.click();
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
  S.level=parseInt(v); $('level-val').textContent=v;
  const pct=v/10;
  $('level-slider').style.background=`linear-gradient(to right,#4ECDC4 0%,#4ECDC4 ${pct*100}%,rgba(255,255,255,.2) ${pct*100}%)`;
}
function flashEffect() {
  const d=document.createElement('div');
  d.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:white;z-index:9999;transition:opacity .35s;';
  document.body.appendChild(d);setTimeout(()=>d.style.opacity='0',50);setTimeout(()=>d.remove(),400);
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
