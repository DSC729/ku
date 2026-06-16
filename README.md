# 📷 AI摄影大师 — v6.0

**AI智能摄影助手** · 场景识别 · AR指导 · 自动参数 · AI修图

---

## 🎯 四大核心功能

### 1️⃣ AI智能场景识别
| 识别能力 | 技术实现 |
|---------|---------|
| 人像/风景/美食/宠物/夜景/通用 | Blazeface + MobileNet 双模型融合 |
| 特写/半身/全身/山峰/海景/城市/花卉/料理 | 检测框比例 + 置信度阈值分析 |
| 逆光/强光/亮光/均匀/暗光/弱光/低对比/雾霾 | 直方图 + RMS对比度 + 动态范围 |

### 2️⃣ 动态AR指导层
| 模式 | 叠加内容 |
|------|---------|
| 🌄 风景 | 三分法交叉点 · 地平线参考 · 对角引导线 · 光影方向 |
| 👤 人像 | 面部框 · 眼神引导线 · 半透明Pose骨架 · 穿搭色卡 |
| 🍽️ 美食 | 中心圆构图 · 十字准心（45°俯拍） |

### 3️⃣ 自动参数引擎（摄影大脑）
- 场景+光线双因子自动计算 ISO / 光圈 / 快门 / EV / 白平衡
- S曲线对比度增强 · Gray World 色温估算
- 高光/阴影溢出保护 · 逆光自动补EV · 低饱和度补偿
- 场景专属调优：人像→大光圈·肤色优化 / 风景→小光圈·高饱和 / 夜景→高ISO·降噪
- 实时HUD显示 + 全彩直方图

### 4️⃣ 后期处理
| 功能 | 说明 |
|------|------|
| ✨ **一键美颜** | 均值滤波磨皮 + 肤色识别提亮 + S曲线对比增强 + USM锐化 |
| 🔧 **参数微调** | 亮度/对比度/饱和度/色温/锐度/暗角/褪色/景深（8项调节） |
| ✂️ **AI抠图** | 🔴红笔=保留 🟢绿笔=擦除 · 可撤销 · 智能像素填充 |

---

## 🔧 技术栈

| 模块 | 技术 |
|------|------|
| 前端框架 | 原生HTML5 + CSS3 + ES6+ |
| 相机 | MediaDevices API + MediaRecorder |
| AI推理 | TensorFlow.js v4.17 (CDN) |
| 人脸检测 | @tensorflow-models/blazeface |
| 场景分类 | @tensorflow-models/mobilenet v2.1 |
| 图像引擎 | Canvas 2D (60fps实时渲染) |
| 构建工具 | Vite + Capacitor (APK打包) |

---

## 🚀 快速开始

### Web版（推荐）
直接用浏览器打开 `index.html` 即可，或部署到静态服务器。

### 构建APK（需Java 17+）
```bash
npm install
npx cap add android
npx cap sync android
cd android && gradlew assembleDebug
```

---

## 📂 项目结构
```
ku/
├── index.html        # 主页面
├── style.css         # 样式文件
├── app.js            # 核心引擎（32KB）
├── manifest.json     # PWA清单
├── package.json      # npm配置
├── vite.config.js    # Vite配置
├── capacitor.config.ts # Capacitor配置
├── BUILD.md          # APK构建指南
└── README.md         # 本文件
```

---

## 📜 更新历史
- **v6.0** — 四大功能完整版：场景识别/AR指导/参数引擎/后期编辑
- **v5.0** — 自动参数引擎（ISO/快门/EV实时运算）
- **v4.0** — AI摄影大师（Sobel边缘检测/斑马纹/直方图）
- **v3.0-1.0** — 基础AI摄影助手原型
