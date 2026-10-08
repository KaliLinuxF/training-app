/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';

/** Paper colour of the light theme (`--paper`); also the splash background on iOS/Android. */
const PAPER = '#F3F5F8';
/** Source files of the `@legko/shared` workspace package. */
const SHARED_SRC = /[\\/]packages[\\/]shared[\\/]src[\\/]/;

const manifest: Partial<ManifestOptions> = {
  id: '/',
  name: 'Легко — трекер схуднення',
  short_name: 'Легко',
  description: 'Персональний трекер схуднення: харчування, тренування, вага й заміри',
  lang: 'uk',
  dir: 'ltr',
  display: 'standalone',
  orientation: 'portrait',
  start_url: '/',
  scope: '/',
  background_color: PAPER,
  theme_color: PAPER,
  categories: ['health', 'fitness', 'lifestyle'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // Registered by src/pwa/register.ts.
      injectRegister: false,
      manifest,
      // Public files are copied into dist before the SW build, so the globs below already cover them.
      includeManifestIcons: false,
      injectManifest: {
        // Classic (non-module) worker: widest support; registered without `type: 'module'`.
        rollupFormat: 'iife',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        rollupOptions: {
          // @legko/shared is side-effect free; without this hint the SW would bundle zod and the
          // whole shared package just for the API path constants it imports.
          treeshake: { moduleSideEffects: (id: string) => !SHARED_SRC.test(id) },
        },
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  build: {
    target: 'es2022',
    // No public source maps: they would expose the sources and bloat the precache.
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
