import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ensure-worklet-deps',
      closeBundle() {
        const distAssets = path.resolve('dist/assets');
        const source = path.resolve('public/libopenmpt.worklet.js');
        if (!fs.existsSync(distAssets) || !fs.existsSync(source)) return;

        for (const file of fs.readdirSync(distAssets)) {
          if (file.startsWith('chiptune3.worklet-') && file.endsWith('.js')) {
            fs.copyFileSync(source, path.join(distAssets, 'libopenmpt.worklet.js'));
            break;
          }
        }
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
