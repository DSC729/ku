// =============================================================
//  AI 智能摄影助手 — app.js v3.0
//  功能：AI 场景分析 + 人像姿势引导 + 自动美颜 + 滤镜
// =============================================================

// ---------- 全局状态 ----------
const S = {
  stream: null, facingMode: 'user', flashMode: 'off',
  currentMode: 'auto',
  currentPose: 'stand',
  aiReady: false, aiAnalyzing: false,
  beauty: { smooth: 50, whiten: 40, eyes: 30, slim: 20 },
  filter: 'none',   // none | warm | cool | vintage | cinematic |清新
  compMode: 'none',
  analysis: { subject: null, gender: null, age: null, scene: null, style: null },
  models: { blazeface: null, mobilenet: null, poseDetector: null },
  lastAnalysisTime: 0,
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

// ---------- 姿势引导数据（SVG 风格坐标） ----------
const POSE_GUIDES = {
  female: {
    stand: {
      label: '优雅站姿',
      tip: '身体微微侧转，重心放在一条腿上，另一条腿自然弯曲',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="30" r="18" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="48" x2="100" y2="130" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="60" y2="100" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="140" y2="100" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="75" y2="220" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="75" y1="220" x2="70" y2="320" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="130" y2="210" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="130" y1="210" x2="125" y2="320" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <circle cx="100" cy="30" r="4" fill="#FF6B6B"/>
        <circle cx="60" cy="100" r="4" fill="#4ECDC4"/><circle cx="140" cy="100" r="4" fill="#4ECDC4"/>
        <circle cx="70" cy="320" r="4" fill="#FFD93D"/><circle cx="125" cy="320" r="4" fill="#FFD93D"/>
        <text x="100" y="385" text-anchor="middle" fill="#fff" font-size="11">💡 重心在一只脚上</text>
      </svg>`
    },
    sit: {
      label: '自然坐姿',
      tip: '双腿自然交叠，一只手撑在身侧，另一只手自然放置',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="30" r="18" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="48" x2="100" y2="130" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="55" y2="110" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="145" y2="105" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="75" y2="200" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="75" y1="200" x2="140" y2="230" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="140" y1="230" x2="160" y2="280" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="200" x2="50" y2="260" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <circle cx="100" cy="30" r="4" fill="#FF6B6B"/>
        <circle cx="55" cy="110" r="4" fill="#4ECDC4"/><circle cx="145" cy="105" r="4" fill="#4ECDC4"/>
        <circle cx="160" cy="280" r="4" fill="#FFD93D"/><circle cx="50" cy="260" r="4" fill="#FFD93D"/>
        <text x="100" y="310" text-anchor="middle" fill="#fff" font-size="11">💡 双腿自然交叠</text>
      </svg>`
    },
    lean: {
      label: '倚靠休闲',
      tip: '一侧身体轻靠墙壁或物体，手臂自然垂放或搭在物体上',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <line x1="160" y1="0" x2="160" y2="400" stroke="rgba(255,255,255,0.2)" stroke-width="2" stroke-dasharray="4"/>
        <circle cx="100" cy="30" r="18" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="48" x2="100" y2="130" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="160" y2="90" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="60" y2="110" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="70" y2="210" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="70" y1="210" x2="65" y2="320" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="130" y2="200" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="130" y1="200" x2="160" y2="290" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <circle cx="100" cy="30" r="4" fill="#FF6B6B"/>
        <circle cx="160" cy="90" r="4" fill="#4ECDC4"/><circle cx="60" cy="110" r="4" fill="#4ECDC4"/>
        <text x="100" y="360" text-anchor="middle" fill="#fff" font-size="11">💡 靠墙身体微倾</text>
      </svg>`
    },
    walk: {
      label: '行走抓拍',
      tip: '迈步瞬间抓拍，身体略微前倾，手臂自然摆动，表情生动',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="30" r="18" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="48" x2="95" y2="130" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="95" y1="70" x2="60" y2="100" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="95" y1="70" x2="130" y2="95" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="95" y1="130" x2="70" y2="220" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="70" y1="220" x2="50" y2="320" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="95" y1="130" x2="135" y2="210" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="135" y1="210" x2="155" y2="280" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <circle cx="100" cy="30" r="4" fill="#FF6B6B"/>
        <circle cx="60" cy="100" r="4" fill="#4ECDC4"/><circle cx="130" cy="95" r="4" fill="#4ECDC4"/>
        <circle cx="50" cy="320" r="4" fill="#FFD93D"/><circle cx="155" cy="280" r="4" fill="#FFD93D"/>
        <text x="100" y="360" text-anchor="middle" fill="#fff" font-size="11">💡 迈步瞬间抓拍</text>
      </svg>`
    },
    profile: {
      label: '优雅侧颜',
      tip: '侧身站立或坐着，脸微微侧转露出下颌线，眼神看向远方',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="30" r="18" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <text x="70" y="25" fill="#FF6B6B" font-size="18">←</text>
        <line x1="100" y1="48" x2="100" y2="130" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="60" y2="100" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="140" y2="105" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="75" y2="220" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="75" y1="220" x2="70" y2="320" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="130" y2="210" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="130" y1="210" x2="125" y2="320" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <circle cx="100" cy="30" r="4" fill="#FF6B6B"/>
        <circle cx="60" cy="100" r="4" fill="#4ECDC4"/><circle cx="140" cy="105" r="4" fill="#4ECDC4"/>
        <circle cx="70" cy="320" r="4" fill="#FFD93D"/><circle cx="125" cy="320" r="4" fill="#FFD93D"/>
        <text x="100" y="365" text-anchor="middle" fill="#fff" font-size="11">💡 侧脸眼神看远方</text>
      </svg>`
    },
  },
  male: {
    stand: {
      label: '绅士站姿',
      tip: '双脚分开与肩同宽，双手自然插袋或自然垂放，肩背挺直',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="30" r="18" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="48" x2="100" y2="130" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="65" y2="130" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="135" y2="130" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="75" y2="220" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="75" y1="220" x2="68" y2="320" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="125" y2="220" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="125" y1="220" x2="132" y2="320" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="100" cy="30" r="4" fill="#FF6B6B"/>
        <circle cx="65" cy="130" r="4" fill="#4ECDC4"/><circle cx="135" cy="130" r="4" fill="#4ECDC4"/>
        <circle cx="68" cy="320" r="4" fill="#FFD93D"/><circle cx="132" cy="320" r="4" fill="#FFD93D"/>
        <text x="100" y="375" text-anchor="middle" fill="#fff" font-size="11">💡 双脚与肩同宽</text>
      </svg>`
    },
    sit: {
      label: '商务坐姿',
      tip: '坐椅前部，背部挺直，双腿自然分开，手放在膝盖上',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="30" r="18" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="48" x2="100" y2="130" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="60" y2="115" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="140" y2="115" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="75" y2="200" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="75" y1="200" x2="60" y2="280" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="125" y2="200" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="125" y1="200" x2="140" y2="280" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="100" cy="30" r="4" fill="#FF6B6B"/>
        <circle cx="60" cy="115" r="4" fill="#4ECDC4"/><circle cx="140" cy="115" r="4" fill="#4ECDC4"/>
        <circle cx="60" cy="280" r="4" fill="#FFD93D"/><circle cx="140" cy="280" r="4" fill="#FFD93D"/>
        <text x="100" y="315" text-anchor="middle" fill="#fff" font-size="11">💡 背部挺直</text>
      </svg>`
    },
    lean: {
      label: '放松倚靠',
      tip: '身体重心靠墙，手臂交叉或插袋，表情放松自然',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <line x1="165" y1="0" x2="165" y2="400" stroke="rgba(255,255,255,0.2)" stroke-width="2" stroke-dasharray="4"/>
        <circle cx="100" cy="30" r="18" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="48" x2="100" y2="130" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="75" x2="165" y2="90" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="75" x2="65" y2="125" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="70" y2="210" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="70" y1="210" x2="60" y2="320" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="130" y2="200" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="130" y1="200" x2="165" y2="290" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="100" cy="30" r="4" fill="#FF6B6B"/>
        <circle cx="165" cy="90" r="4" fill="#4ECDC4"/><circle cx="65" cy="125" r="4" fill="#4ECDC4"/>
        <text x="100" y="350" text-anchor="middle" fill="#fff" font-size="11">💡 靠墙手臂交叉</text>
      </svg>`
    },
    walk: {
      label: '行走姿态',
      tip: '走路中抓拍，一条腿支撑，另一条腿迈步，手臂自然摆动',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="30" r="18" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="48" x2="98" y2="130" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="98" y1="70" x2="62" y2="100" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="98" y1="70" x2="135" y2="95" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="98" y1="130" x2="68" y2="220" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="68" y1="220" x2="52" y2="320" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="98" y1="130" x2="138" y2="210" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="138" y1="210" x2="155" y2="285" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="100" cy="30" r="4" fill="#FF6B6B"/>
        <circle cx="62" cy="100" r="4" fill="#4ECDC4"/><circle cx="135" cy="95" r="4" fill="#4ECDC4"/>
        <circle cx="52" cy="320" r="4" fill="#FFD93D"/><circle cx="155" cy="285" r="4" fill="#FFD93D"/>
        <text x="100" y="360" text-anchor="middle" fill="#fff" font-size="11">💡 迈步瞬间抓拍</text>
      </svg>`
    },
    profile: {
      label: '硬朗侧颜',
      tip: '侧身站立，下巴微抬，眼神犀利看向侧面光源方向',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="30" r="18" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <text x="130" y="25" fill="#FF6B6B" font-size="18">→</text>
        <line x1="100" y1="48" x2="100" y2="130" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="65" y2="125" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="70" x2="135" y2="115" stroke="#4ECDC4" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="72" y2="220" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="72" y1="220" x2="68" y2="320" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="100" y1="130" x2="128" y2="220" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="128" y1="220" x2="132" y2="320" stroke="#FFD93D" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="100" cy="30" r="4" fill="#FF6B6B"/>
        <circle cx="65" cy="125" r="4" fill="#4ECDC4"/><circle cx="135" cy="115" r="4" fill="#4ECDC4"/>
        <circle cx="68" cy="320" r="4" fill="#FFD93D"/><circle cx="132" cy="320" r="4" fill="#FFD93D"/>
        <text x="100" y="365" text-anchor="middle" fill="#fff" font-size="11">💡 下巴微抬眼神犀利</text>
      </svg>`
    },
  },
  child: {
    stand: {
      label: '活泼站姿',
      tip: '孩子自然站立，可以踮脚、歪头、抬手比耶或双手张开',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="40" r="22" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="62" x2="100" y2="160" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="85" x2="60" y2="60" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="85" x2="145" y2="60" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <text x="55" y="55" fill="#FF6B6B" font-size="14">✌️</text>
        <text x="140" y="55" fill="#FF6B6B" font-size="14">✌️</text>
        <line x1="100" y1="160" x2="80" y2="260" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="80" y1="260" x2="72" y2="340" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="160" x2="120" y2="260" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="120" y1="260" x2="128" y2="340" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <circle cx="100" cy="40" r="4" fill="#FF6B6B"/>
        <circle cx="72" cy="340" r="4" fill="#FFD93D"/><circle cx="128" cy="340" r="4" fill="#FFD93D"/>
        <text x="100" y="380" text-anchor="middle" fill="#fff" font-size="11">💡 可以踮脚/比耶</text>
      </svg>`
    },
    sit: {
      label: '萌趣坐姿',
      tip: '盘腿坐或蹲坐，双手托腮或抱膝，表情活泼可爱',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="40" r="22" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="62" x2="100" y2="160" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="90" x2="65" y2="125" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="65" y1="125" x2="85" y2="105" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="90" x2="135" y2="125" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="135" y1="125" x2="115" y2="105" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <text x="75" y="100" fill="#FF6B6B" font-size="14">👋</text>
        <line x1="100" y1="160" x2="60" y2="240" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="60" y1="240" x2="100" y2="260" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="160" x2="140" y2="240" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="140" y1="240" x2="100" y2="260" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <circle cx="100" cy="40" r="4" fill="#FF6B6B"/>
        <circle cx="100" cy="260" r="4" fill="#FFD93D"/>
        <text x="100" y="295" text-anchor="middle" fill="#fff" font-size="11">💡 双手托腮</text>
      </svg>`
    },
    lean: {
      label: '可爱倚靠',
      tip: '孩子靠在家具/墙上，歪头看镜头，笑得露出牙齿',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <line x1="160" y1="0" x2="160" y2="400" stroke="rgba(255,255,255,0.2)" stroke-width="2" stroke-dasharray="4"/>
        <circle cx="100" cy="40" r="22" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="62" x2="95" y2="160" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="95" y1="90" x2="160" y2="100" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="95" y1="90" x2="60" y2="130" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="95" y1="160" x2="65" y2="250" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="65" y1="250" x2="55" y2="340" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="95" y1="160" x2="125" y2="250" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="125" y1="250" x2="115" y2="340" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <text x="155" y="95" fill="#FF6B6B" font-size="14">😊</text>
        <circle cx="100" cy="40" r="4" fill="#FF6B6B"/>
        <text x="100" y="375" text-anchor="middle" fill="#fff" font-size="11">💡 歪头看镜头笑</text>
      </svg>`
    },
    walk: {
      label: '活力蹦跳',
      tip: '蹦跳瞬间，双脚离地，手臂张开，表情夸张开心',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="35" r="22" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <line x1="100" y1="57" x2="98" y2="150" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="98" y1="80" x2="50" y2="55" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="98" y1="80" x2="150" y2="55" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <text x="42" y="50" fill="#FF6B6B" font-size="14">⭐</text>
        <text x="145" y="50" fill="#FF6B6B" font-size="14">⭐</text>
        <line x1="98" y1="150" x2="65" y2="230" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="65" y1="230" x2="55" y2="300" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="98" y1="150" x2="135" y2="230" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="135" y1="230" x2="145" y2="300" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <circle cx="100" cy="35" r="4" fill="#FF6B6B"/>
        <circle cx="55" cy="300" r="4" fill="#FFD93D"/><circle cx="145" cy="300" r="4" fill="#FFD93D"/>
        <text x="100" y="340" text-anchor="middle" fill="#fff" font-size="11">💡 双脚离地更活泼</text>
      </svg>`
    },
    profile: {
      label: '可爱侧颜',
      tip: '孩子侧脸，嘟嘴或微笑，看一侧的玩具或家长',
      svg: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="40" r="22" fill="none" stroke="#FF6B6B" stroke-width="3"/>
        <text x="70" y="32" fill="#FF6B6B" font-size="18">←</text>
        <line x1="100" y1="62" x2="100" y2="160" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="85" x2="65" y2="125" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="85" x2="135" y2="120" stroke="#4ECDC4" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="160" x2="75" y2="260" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="75" y1="260" x2="68" y2="340" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="160" x2="125" y2="260" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <line x1="125" y1="260" x2="132" y2="340" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>
        <circle cx="100" cy="40" r="4" fill="#FF6B6B"/>
        <circle cx="68" cy="340" r="4" fill="#FFD93D"/><circle cx="132" cy="340" r="4" fill="#FFD93D"/>
        <text x="100" y="375" text-anchor="middle" fill="#fff" font-size="11">💡 嘟嘴看一侧</text>
      </svg>`
    },
  },
};

// 滤镜配置
const FILTERS = {
  none:      { label: '原图',     css: 'none',              cssColor: '#fff' },
  warm:      { label: '暖色调',   css: 'sepia(0.25) saturate(1.3)', cssColor: '#FFB347' },
  cool:      { label: '冷色调',   css: 'saturate(0.9) hue-rotate(20deg) brightness(1.05)', cssColor: '#87CEEB' },
  vintage:   { label: '复古',     css: 'sepia(0.4) contrast(1.1) brightness(0.9)', cssColor: '#D4A574' },
  cinematic: { label: '电影感',  css: 'contrast(1.15) saturate(1.2) brightness(0.92)', cssColor: '#7B8CDE' },
  小清新:    { label: '小清新',  css: 'saturate(1.1) brightness(1.08) contrast(0.95)', cssColor: '#A8E6CF' },
};

// 场景知识库
const SCENE_MAP = {
  beach:    { label: '🌊 海边/沙滩', color: '#4ECDC4', style: '小清新、浪漫、日系', comp: 'thirds' },
  forest:   { label: '🌲 森林/树木', color: '#95D5B2', style: '森系、氧气感、自然', comp: 'thirds' },
  mountain: { label: '🏔️ 山川/自然', color: '#D8B4F8', style: '大气、风光、史诗感', comp: 'golden' },
  city:     { label: '🏙️ 城市/建筑', color: '#FFD6A5', style: '都市感、时尚、潮流', comp: 'diagonal' },
  street:   { label: '🛤️ 街道/小路', color: '#FFB3C6', style: '街拍、文艺、复古', comp: 'thirds' },
  water:    { label: '💧 湖泊/水面', color: '#00B4D8', style: '倒影、静谧、清冷', comp: 'center' },
  park:     { label: '🌿 公园/草地', color: '#B7E4C7', style: '休闲、活力、春日感', comp: 'thirds' },
  sky:      { label: '☁️ 天空/空旷', color: '#87CEEB', style: '极简、留白、高级感', comp: 'center' },
  indoor:   { label: '🏠 室内环境', color: '#E8C39E', style: '日常、生活感、温馨', comp: 'thirds' },
  default:  { label: '🏔️ 通用场景', color: '#ffffff', style: '通用百搭', comp: 'thirds' },
};

// ========== 初始化 ==========
async function initCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: S.facingMode, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    video.srcObject = stream; S.stream = stream;
    await video.play();
    resizeOverlays();
  } catch (e) { alert('相机启动失败，请检查权限。'); }
}

function resizeOverlays() {
  const w = video.videoWidth || video.clientWidth;
  const h = video.videoHeight || video.clientHeight;
  overlayCV.width = poseCV.width = w; overlayCV.height = poseCV.height = h;
}

// ========== 加载 AI 模型 ==========
async function loadModels() {
  setAIState('loading', '加载模型…');
  try {
    const [bf, mn, pd] = await Promise.all([
      blazeface.load(),
      mobilenet.load({ version: 2, alpha: 1.0 }),
      poseDetection.createDetector(poseDetection.SupportedModels.MoveNet,
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }),
    ]);
    S.models.blazeface = bf; S.models.mobilenet = mn; S.models.poseDetector = pd;
    S.aiReady = true;
    setAIState('idle', 'AI 就绪');
  } catch (e) {
    console.warn('AI模型加载失败，使用简化模式:', e);
    S.aiReady = false;
    setAIState('error', '离线模式');
  }
}

function setAIState(state, text) {
  aiBadge.className = 'ai-badge ' + (state === 'loading' ? 'analyzing' : state === 'error' ? 'error' : state === 'done' ? 'done' : 'idle');
  aiIcon.textContent = state === 'error' ? '⚠️' : state === 'loading' ? '⏳' : state === 'done' ? '✅' : '🤖';
  aiStatus.textContent = text;
}

// ========== AI 场景分析 ==========
async function analyzeScene() {
  if (!S.aiReady || !video.readyState >= 2 || S.aiAnalyzing) return;
  const now = Date.now();
  if (now - S.lastAnalysisTime < 1000) return;
  S.lastAnalysisTime = now;
  S.aiAnalyzing = true;
  setAIState('loading', 'AI 分析中…');

  try {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { S.aiAnalyzing = false; return; }

    // 人脸检测
    const faces = await S.models.blazeface.estimateFaces(video, false);

    if (faces.length > 0) {
      // === 检测到人像 ===
      const face = faces[0];
      const fw = (face.bottomRight[0] - face.topLeft[0]) / w;
      const fh = (face.bottomRight[1] - face.topLeft[1]) / h;
      const area = fw * fh;

      // 性别估算（脸宽高比）
      const ratio = fw / fh;
      const gender = ratio > 0.76 ? 'female' : 'male';
      // 年龄估算
      const age = area > 0.055 ? 'adult' : area > 0.02 ? 'young' : 'child';

      S.analysis.gender = gender; S.analysis.age = age;
      S.analysis.subject = '👤 人像';

      // 更新标签
      const genderTxt = gender === 'female' ? (age === 'child' ? '👧 女童' : '👩 女性') : (age === 'child' ? '👦 男童' : '👨 男性');
      document.getElementById('subject-tag').textContent = genderTxt;
      document.getElementById('subject-tag').classList.remove('hidden');
      document.getElementById('scene-tag').classList.add('hidden');

      // 姿势引导（实时绘制）
      if (S.currentMode === 'portrait' || S.currentMode === 'auto') {
        drawPoseGuideSVG(gender, S.currentPose);
      } else {
        drawFaceBox(face);
      }

      setAIState('done', '人像识别 ✓');
    } else {
      // === 风景场景检测 ===
      const preds = await S.models.mobilenet.classify(video, 3);
      if (preds && preds.length > 0) {
        const scene = mapSceneFromLabel(preds[0].className);
        S.analysis.scene = scene.label;
        S.analysis.style = scene.style;

        document.getElementById('scene-tag').textContent = scene.label;
        document.getElementById('scene-tag').classList.remove('hidden');
        document.getElementById('subject-tag').classList.add('hidden');

        if (S.currentMode === 'landscape') {
          S.compMode = scene.comp;
          drawComposition();
        }

        setAIState('done', '场景识别 ✓');
      }
    }

    setTimeout(() => { if (!S.aiAnalyzing) setAIState('idle', 'AI 就绪'); }, 1500);
  } catch (e) { console.warn('分析异常:', e); setAIState('error', '分析异常'); }
  S.aiAnalyzing = false;
}

function mapSceneFromLabel(l) {
  const s = l.toLowerCase();
  if (/beach|shore|seashore|coast|sandbar/.test(s)) return SCENE_MAP.beach;
  if (/forest|wood|woodland|tree|jungle|bosk/.test(s)) return SCENE_MAP.forest;
  if (/mountain|peak|cliff|valley/.test(s)) return SCENE_MAP.mountain;
  if (/street|road|alley|sidewalk|avenue/.test(s)) return SCENE_MAP.street;
  if (/lake|pond|river|stream/.test(s)) return SCENE_MAP.water;
  if (/park|grass|field|meadow/.test(s)) return SCENE_MAP.park;
  if (/sky|cloud|atmosphere/.test(s)) return SCENE_MAP.sky;
  if (/indoor|room|home|house|office|living/.test(s)) return SCENE_MAP.indoor;
  if (/city|building|skyscraper|downtown/.test(s)) return SCENE_MAP.city;
  return SCENE_MAP.default;
}

function drawFaceBox(face) {
  const w = overlayCV.width, h = overlayCV.height;
  const vw = video.clientWidth, vh = video.clientHeight;
  overlayCtx.clearRect(0, 0, w, h);
  const scaleX = vw / w, scaleY = vh / h;
  const fx = (w - face.topLeft[0]) * scaleX; // 镜像
  const fy = face.topLeft[1] * scaleY;
  const fw = (face.bottomRight[0] - face.topLeft[0]) * scaleX;
  const fh = (face.bottomRight[1] - face.topLeft[1]) * scaleY;
  overlayCtx.strokeStyle = '#4ECDC4'; overlayCtx.lineWidth = 2.5;
  overlayCtx.setLineDash([5, 4]);
  overlayCtx.strokeRect(fx - fw, fy, fw, fh);
  overlayCtx.setLineDash([]);
}

// ========== SVG 姿势引导（嵌入到 pose overlay） ==========
function drawPoseGuideSVG(gender, pose) {
  const guide = POSE_GUIDES[gender]?.[pose];
  if (!guide) return;

  poseCtx.clearRect(0, 0, poseCV.width, poseCV.height);

  // 渲染 SVG 到 canvas
  const img = new Image();
  const svgBlob = new Blob([guide.svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  img.onload = () => {
    const vw = video.clientWidth, vh = video.clientHeight;
    const scale = Math.min(vw / 200, vh / 400) * 0.75;
    const x = (vw - 200 * scale) / 2;
    const y = (vh - 400 * scale) / 2;
    poseCtx.drawImage(img, x, y, 200 * scale, 400 * scale);

    // 提示文字
    poseCtx.font = `bold 13px sans-serif`;
    poseCtx.fillStyle = 'rgba(0,0,0,0.7)';
    poseCtx.fillRect(x, y + 400 * scale - 28, 200 * scale, 30);
    poseCtx.fillStyle = '#FFD93D';
    poseCtx.textAlign = 'center';
    poseCtx.fillText(guide.tip, x + 100 * scale, y + 400 * scale - 8);

    URL.revokeObjectURL(url);
  };
  img.src = url;

  // 更新AI面板
  document.getElementById('ai-subject').textContent =
    gender === 'female' ? '👩 女性' : gender === 'male' ? '👨 男性' : '👧 儿童';
  document.getElementById('ai-style').textContent = guide.label;
}

// ========== 构图辅助线 ==========
function drawComposition() {
  overlayCtx.clearRect(0, 0, overlayCV.width, overlayCV.height);
  const w = overlayCV.width, h = overlayCV.height;
  overlayCtx.strokeStyle = 'rgba(255,255,255,0.45)';
  overlayCtx.lineWidth = 1.2;
  overlayCtx.setLineDash([6, 5]);
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
      overlayCtx.beginPath(); overlayCtx.arc(w/2,h/2,Math.min(w,h)*0.2,0,Math.PI*2); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.moveTo(w/2,0); overlayCtx.lineTo(w/2,h); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.moveTo(0,h/2); overlayCtx.lineTo(w,h/2); overlayCtx.stroke();
      break;
    case 'diagonal':
      overlayCtx.beginPath(); overlayCtx.moveTo(0,0); overlayCtx.lineTo(w,h); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.moveTo(w,0); overlayCtx.lineTo(0,h); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.arc(w/2,h/2,Math.min(w,h)*0.26,0,Math.PI*2); overlayCtx.stroke();
      break;
  }
  overlayCtx.setLineDash([]);
}

// ========== 美颜处理（双边滤波） ==========
function bilateralSmooth(data, w, h, radius) {
  const src = new Uint8ClampedArray(data);
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const idx = (y*w+x)*4;
      let r=0,g=0,b=0,sum=0;
      for (let dy=-radius; dy<=radius; dy++) {
        for (let dx=-radius; dx<=radius; dx++) {
          const ni = ((y+dy)*w+(x+dx))*4;
          const cd = Math.sqrt((src[idx]-src[ni])**2+(src[idx+1]-src[ni+1])**2+(src[idx+2]-src[ni+2])**2);
          const sd = Math.sqrt(dx*dx+dy*dy)/radius;
          const wt = Math.exp(-sd*1.5 - cd*0.04);
          r+=src[ni]*wt; g+=src[ni+1]*wt; b+=src[ni+2]*wt; sum+=wt;
        }
      }
      data[idx]=r/sum; data[idx+1]=g/sum; data[idx+2]=b/sum;
    }
  }
}

function applyBeautyAndFilter(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // 美白
  if (S.beauty.whiten > 0) {
    const b = S.beauty.whiten * 0.9;
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = Math.min(255, d[i]   + b);
      d[i+1] = Math.min(255, d[i+1] + b);
      d[i+2] = Math.min(255, d[i+2] + b);
    }
  }

  // 磨皮
  if (S.beauty.smooth > 20) {
    bilateralSmooth(d, w, h, Math.round(S.beauty.smooth / 20));
  }

  ctx.putImageData(imgData, 0, 0);

  // CSS 滤镜（应用到 canvas 显示）
  const f = FILTERS[S.filter]?.css || 'none';
  canvas.style.filter = f;
  return canvas.toDataURL('image/jpeg', 0.95);
}

// ========== 拍照 ==========
async function capture() {
  const btn = document.getElementById('btn-capture');
  btn.classList.add('shooting');
  setTimeout(() => btn.classList.remove('shooting'), 600);

  // 绘制当前滤镜效果到 canvas
  const cv = document.createElement('canvas');
  cv.width = video.videoWidth; cv.height = video.videoHeight;
  const ctx = cv.getContext('2d');
  // 应用镜像
  ctx.save();
  ctx.translate(cv.width, 0); ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0);
  ctx.restore();
  const f = FILTERS[S.filter]?.css || 'none';
  cv.style.filter = f;

  const origURL = cv.toDataURL('image/jpeg', 0.95);

  // 显示预览弹窗
  const modal = document.getElementById('result-modal');
  const origImg = document.getElementById('result-original');
  const enhancedCV = document.getElementById('result-enhanced');
  origImg.src = origURL;
  document.getElementById('result-actions').classList.add('hidden');
  document.querySelector('.result-label').textContent = '✨ AI 美化中...';
  modal.classList.remove('hidden');

  // 异步美化
  setTimeout(() => {
    enhancedCV.width = cv.width; enhancedCV.height = cv.height;
    enhancedCV.getContext('2d').drawImage(cv, 0, 0);
    const beautifiedURL = applyBeautyAndFilter(enhancedCV);
    document.querySelector('.result-label').textContent = '✅ 美化完成 · ' + (FILTERS[S.filter].label);
    document.getElementById('result-actions').classList.remove('hidden');
    enhancedCV.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;z-index:-1;';
    enhancedCV.dataset.url = beautifiedURL;
  }, 800);
}

// ========== 事件绑定 ==========

// 模式切换
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.currentMode = btn.dataset.mode;
    const posePanel = document.getElementById('pose-style-selector');
    const compPanel = document.getElementById('composition-selector');
    posePanel.classList.add('hidden'); compPanel.classList.add('hidden');
    if (S.currentMode === 'portrait') {
      posePanel.classList.remove('hidden');
      // 自动检测性别显示姿势
      if (S.analysis.gender) drawPoseGuideSVG(S.analysis.gender, S.currentPose);
    } else if (S.currentMode === 'landscape') {
      compPanel.classList.remove('hidden');
      drawComposition();
    } else if (S.currentMode === 'manual') {
      compPanel.classList.remove('hidden');
    }
  });
});

// 姿势选择
document.querySelectorAll('.pose-thumb').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pose-thumb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.currentPose = btn.dataset.pose;
    if (S.analysis.gender) drawPoseGuideSVG(S.analysis.gender, S.currentPose);
    const g = S.analysis.gender || 'female';
    document.getElementById('ai-style').textContent = POSE_GUIDES[g][S.currentPose]?.label || '姿势';
  });
});

// 构图辅助线
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

// 滤镜选择（手动模式面板中添加）
// 底部按钮
document.getElementById('btn-capture').addEventListener('click', capture);
document.getElementById('btn-switch').addEventListener('click', () => {
  S.facingMode = S.facingMode === 'user' ? 'environment' : 'user';
  initCamera();
});
document.getElementById('btn-flash').addEventListener('click', () => {
  const modes = ['off','on'];
  const idx = modes.indexOf(S.flashMode);
  S.flashMode = modes[(idx+1)%modes.length];
  document.getElementById('btn-flash').textContent = S.flashMode === 'on' ? '💡' : '⚡';
  S.stream?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: S.flashMode === 'on' }] }).catch(()=>{});
});
document.getElementById('btn-gallery').addEventListener('click', () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const modal = document.getElementById('result-modal');
      document.getElementById('result-original').src = ev.target.result;
      document.getElementById('result-actions').classList.add('hidden');
      document.querySelector('.result-label').textContent = '✨ AI 美化中...';
      modal.classList.remove('hidden');
      setTimeout(() => {
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = img.width; cv.height = img.height;
          cv.getContext('2d').drawImage(img, 0, 0);
          const enhancedCV = document.getElementById('result-enhanced');
          enhancedCV.width = cv.width; enhancedCV.height = cv.height;
          enhancedCV.getContext('2d').drawImage(cv, 0, 0);
          const url = applyBeautyAndFilter(enhancedCV);
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

// 滤镜切换（从 HTML 动态注入按钮）
function buildFilterBar() {
  const bar = document.createElement('div');
  bar.id = 'filter-bar';
  bar.style.cssText = 'position:absolute;bottom:160px;left:0;right:0;display:flex;gap:8px;justify-content:center;padding:0 12px;z-index:100;flex-wrap:wrap;';
  Object.entries(FILTERS).forEach(([key, f]) => {
    const btn = document.createElement('button');
    btn.className = 'comp-btn' + (key === 'none' ? ' active' : '');
    btn.dataset.filter = key;
    btn.textContent = f.label;
    btn.style.borderColor = key === 'none' ? '' : f.cssColor;
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.filter = key;
      video.style.filter = f.css;
    });
    bar.appendChild(btn);
  });
  document.getElementById('app').appendChild(bar);
}

// 结果弹窗
document.getElementById('btn-download').addEventListener('click', () => {
  const url = document.getElementById('result-original').src;
  downloadImage(url, `photo_${Date.now()}_原图.jpg`);
});
document.getElementById('btn-download-beautified').addEventListener('click', () => {
  const url = document.getElementById('result-enhanced').dataset.url;
  if (url) downloadImage(url, `photo_${Date.now()}_美化.jpg`);
  else alert('请等待美化完成');
});
document.getElementById('btn-retake').addEventListener('click', () => {
  document.getElementById('result-modal').classList.add('hidden');
});
document.getElementById('btn-settings').addEventListener('click', () => {
  const panel = document.getElementById('ai-info-panel');
  panel.classList.toggle('hidden');
});

function downloadImage(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
}

// AI 分析主循环
let frameCount = 0;
function aiLoop() {
  if (S.currentMode === 'auto' && S.aiReady) {
    analyzeScene();
  } else if (S.currentMode === 'portrait' && S.analysis.gender) {
    drawPoseGuideSVG(S.analysis.gender, S.currentPose);
  } else if (S.currentMode === 'landscape') {
    drawComposition();
  }
  setTimeout(aiLoop, S.currentMode === 'auto' ? 300 : 1000);
}

video.addEventListener('loadedmetadata', resizeOverlays);

// ========== 启动 ==========
(async () => {
  await initCamera();
  buildFilterBar();
  await loadModels();
  aiLoop();
  document.getElementById('ai-info-panel').classList.remove('hidden');
})();