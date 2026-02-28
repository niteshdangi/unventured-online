import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  server: {
    proxy: {
      '/mapzen-tiles': {
        target: 'https://elevation-tiles-prod.s3.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mapzen-tiles/, ''),
      },
    },
  },
})
