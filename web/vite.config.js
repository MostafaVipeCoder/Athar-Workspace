import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    resolve: {
      alias: command === 'build' ? [{ find: /^\.\/devManifests\.js$/, replacement: fileURLToPath(new URL('./src/nodes/devManifests.prod.js', import.meta.url)) }] : [],
    },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 250,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return 'vendor-react'
            if (id.includes('@supabase')) return 'vendor-supabase'
            if (id.includes('@tanstack')) return 'vendor-query'
            return undefined
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.js'],
      css: false,
      include: ['src/**/*.test.{js,jsx}'],
      testTimeout: 15000,
    },
  }
})
