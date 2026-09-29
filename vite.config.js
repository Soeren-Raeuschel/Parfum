import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// https://vitejs.dev/config/#compiler-options
export default defineConfig({
  plugins: [react()],
  build: { target: 'esnext', sourcemap: true },
  resolve: { alias: { '@': './src' } }
})
