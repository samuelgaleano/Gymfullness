/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Gymfullness — tu asistente de gym',
        short_name: 'Gymfullness',
        description: 'Entrena sin pensar: rutina guiada, descansos, registro por voz y progreso.',
        lang: 'es',
        id: '/',
        theme_color: '#07080c',
        background_color: '#07080c',
        categories: ['health', 'fitness', 'sports'],
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // The optional Firebase SDK (~270 KB, only used after "Continuar con Google") is not worth
        // forcing on every install: it is cached on first use instead (runtimeCaching below).
        globIgnores: ['**/firebase-sdk-*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/firebase-sdk-[^/]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'firebase-sdk', expiration: { maxEntries: 8 } },
          },
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // take control on first install so lazy screens work offline without a second visit
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Stable, recognizable name for the lazy Firebase SDK so the service worker can treat it specially.
        manualChunks(id: string) {
          if (/node_modules\/(@firebase|firebase)\//.test(id)) return 'firebase-sdk'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
  },
})
