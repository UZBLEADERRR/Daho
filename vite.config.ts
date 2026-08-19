import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Nisbiy yoʻl — ilova ham ildizda, ham papka ichida (GitHub Pages) ishlaydi.
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Kamdan-kam oʻzgaradigan kutubxonalar alohida — kesh uzoq yashaydi.
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
