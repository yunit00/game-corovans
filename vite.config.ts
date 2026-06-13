import { defineConfig } from 'vite';

export default defineConfig({
  // База сборки. На корне домена — «/». Для GitHub Pages сайт живёт в подкаталоге
  // /<repo>/, поэтому деплой-воркфлоу передаёт VITE_BASE=/game-corovans/.
  // import.meta.env.BASE_URL подхватывает это значение; ассеты грузятся через assetUrl().
  base: process.env.VITE_BASE || '/',
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2048 },
});
