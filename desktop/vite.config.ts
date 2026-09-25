import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // 2MB tree.json stays a static JSON asset, not inlined into JS.
  assetsInlineLimit: 0,
  build: {
    chunkSizeWarningLimit: 5000,
  },
})
