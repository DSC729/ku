# 📸 AI 拍照助手

多功能 Android 拍照应用 —— 支持构图辅助 + AI 美颜实时预览

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 📷 实时相机预览 | 支持前后摄像头切换 |
| 📐 构图辅助线 | 三分法 / 黄金比例 / 居中 / 对角线 |
| ✨ AI 美颜滤镜 | 磨皮、美白、瘦脸、大眼 |
| ⚡ 闪光灯控制 | 开 / 关 / 自动 |
| 🖼️ 相册导入 | 支持从相册选择照片进行美颜处理 |
| 💾 一键保存 | 拍照后直接保存到设备 |

## 🚀 快速开始

### 方式一：浏览器直接体验（推荐先试）

```bash
# 克隆仓库
git clone https://github.com/DSC729/ku.git
cd ku

# 用任意 HTTP 服务器打开（需 HTTPS 环境才能调用相机）
npx serve .
# 或用 Python
python -m http.server 8080
```

> ⚠️ 相机功能需要 **HTTPS** 或 `localhost` 环境，直接用 `file://` 打开无法调用摄像头。

### 方式二：打包为 Android APP（Capacitor）

```bash
# 安装依赖
npm install -g @capacitor/core @capacitor/cli
npm install @capacitor/android

# 初始化 Capacitor
npx cap init ai-camera com.example.aicamera

# 添加 Android 平台
npx cap add android

# 构建并打开 Android Studio
npx cap sync
npx cap open android
```

然后在 Android Studio 中运行到真机或模拟器。

## 🛠️ 技术栈

| 技术 | 用途 |
|------|------|
| HTML5 Camera API | 相机调用 |
| Canvas API | 构图辅助线绘制 + 美颜滤镜处理 |
| CSS3 | UI 样式 + 毛玻璃效果 |
| JavaScript (ES6+) | 核心逻辑 |
| Capacitor | 打包为原生 Android APP |

## 📁 项目结构

```
ku/
├── index.html      # 主界面
├── style.css       # 样式
├── app.js          # 核心逻辑（相机 + 构图 + 美颜）
└── README.md       # 项目说明
```

## 🔮 后续计划

- [ ] 接入 TensorFlow.js 实现人脸关键点检测
- [ ] 更精确的瘦脸 / 大眼变形算法
- [ ] 滤镜商城（多种风格滤镜）
- [ ] 照片编辑（裁剪、旋转、调整）
- [ ] 云端 AI 美颜（调用服务端模型）

## 📄 License

MIT © 2026 DSC729
