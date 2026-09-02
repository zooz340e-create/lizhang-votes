import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        star: resolve(__dirname, 'star.html'), // 繁星計畫 landing page
        plan: resolve(__dirname, 'plan.html'), // 選戰行程規劃（教練版工具）
        east: resolve(__dirname, 'east.html'), // 彰化東區 22 里限定選情站（名單轉換頁）
        shop: resolve(__dirname, 'shop.html'), // 友善商家地圖（候選人 CRM 第一版）
      },
    },
  },
});
