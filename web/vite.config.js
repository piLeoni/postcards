import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The WASM package lives in public/pkg and is imported by URL, not bundled.
    fs: { allow: ['..'] },
  },
})
