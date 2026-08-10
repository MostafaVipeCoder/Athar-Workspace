import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 8080,
    strictPort: false,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('lucide-react')) {
            return 'lucide-icons';
          }
          if (id.includes('@supabase') || id.includes('supabase')) {
            return 'supabase-lib';
          }
          if (id.includes('xlsx')) {
            return 'xlsx-lib';
          }
          // Removing manual splitting for react core to ensure stable references
        },
      },
    },
  },
})
