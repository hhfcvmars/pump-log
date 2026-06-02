import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { usbPdaLogPlugin } from './vite/usbPdaLogServer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    usbPdaLogPlugin(),
  ],
  server: {
    proxy: {
      '/api/download': {
        target: 'https://d3ci4jgewizada.cloudfront.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/download/, ''),
      },
      '/api/pancares-download': {
        target: 'https://static.pancares.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pancares-download/, ''),
      },
    },
  },
})
