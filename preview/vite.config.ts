// Builds a browser-only preview of the app UI (mocked main process).
// npm run preview:web  ->  preview/dist/preview.js + preview.css
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname),
  resolve: { alias: { '@shared': resolve(__dirname, '../src/shared') } },
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: resolve(__dirname, 'main.tsx'), formats: ['es'], fileName: () => 'preview.js' },
    rollupOptions: { output: { assetFileNames: 'preview.[ext]' } }
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') }
})
