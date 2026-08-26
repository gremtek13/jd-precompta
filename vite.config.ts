import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Le site est servi depuis https://gremtek13.github.io/jd-precompta/ (GitHub Pages, dépôt "projet")
  base: '/jd-precompta/',
  plugins: [react()],
})
