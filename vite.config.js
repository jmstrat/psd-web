import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/psd-web/',
  plugins: [
    tailwindcss()
  ],
  worker: {
    format: 'es'
  }
})
