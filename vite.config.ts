import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const alias = mode === 'e2e'
    ? [
        { find: './core/brain', replacement: path.resolve(__dirname, 'src/e2e/mocks/brain.ts') },
        { find: '@/core/brain', replacement: path.resolve(__dirname, 'src/e2e/mocks/brain.ts') },
        { find: '@', replacement: path.resolve(__dirname, '.') },
      ]
    : {
        '@': path.resolve(__dirname, '.'),
      };

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          globIgnores: ['**/pdf.worker.min-*.mjs']
        },
        manifest: {
          name: 'AnkiGen Pro - AI MCQ Generator',
          short_name: 'AnkiGen',
          description: 'Tạo thẻ Anki & Trắc nghiệm từ tài liệu bằng AI',
          lang: 'vi',
          theme_color: '#ffffff',
          icons: [
            {
              src: 'pwa-192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      })
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            ui: ['lucide-react'],
            docx: ['docx', 'mammoth', 'jszip'],
            pdf: ['pdf-lib', 'pdfjs-dist'],
            ocr: ['tesseract.js'],
            genai: ['@google/genai']
          }
        }
      },
      chunkSizeWarningLimit: 1000,
    },
    test: {
      exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    }
  };
});
