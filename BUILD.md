# AI 摄影大师 APK 打包流程

## 环境状态
- Node.js: ✅ v22.16.0
- npm: ✅ 10.9.8
- Git: ✅ 已安装
- Java JDK: ⏳ 待安装
- Android SDK: ⏳ 下载中 (C:\Users\Administrator\android-cmdline.zip)

## 第一步：等待 Android SDK 下载完成
```bash
# 检查下载是否完成
dir C:\Users\Administrator\android-cmdline.zip
```

## 第二步：安装 Java JDK（便携版，无需管理员）
1. 下载 JDK 17 便携版：
   https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_windows_hotspot_17.0.13_11.zip

2. 解压到：C:\Users\Administrator\jdk17\

3. 设置环境变量（PowerShell 临时）：
```powershell
$env:JAVA_HOME = "C:\Users\Administrator\jdk17"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
java -version
```

## 第三步：安装 Android SDK
1. 创建 SDK 目录：
```powershell
mkdir C:\Users\Administrator\android-sdk
```

2. 解压 commandlinetools：
- 解压 C:\Users\Administrator\android-cmdline.zip 到 C:\Users\Administrator\android-sdk\cmdline-tools\

3. 安装 SDK 组件：
```powershell
$env:JAVA_HOME = "C:\Users\Administrator\jdk17"
$env:ANDROID_HOME = "C:\Users\Administrator\android-sdk"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

# 接受协议
yes | sdkmanager --licenses 2>nul

# 安装必要组件
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

## 第四步：安装 npm 依赖
```powershell
cd C:\Users\Administrator\.qclaw\workspace\ku
npm install
```

## 第五步：构建 Web 应用
```powershell
npm run build
```

## 第六步：添加 Android 平台
```powershell
npx cap add android
npx cap sync android
```

## 第七步：构建 APK
```powershell
cd android
.\gradlew assembleDebug
```

APK 输出位置：
`C:\Users\Administrator\.qclaw\workspace\ku\android\app\build\outputs\apk\debug\app-debug.apk`
