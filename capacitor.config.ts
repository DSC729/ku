import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aicamera.app',
  appName: 'AI摄影大师',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    backgroundColor: '#000000',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
