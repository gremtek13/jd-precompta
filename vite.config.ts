import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Servi depuis la racine de compta.jdarnis.fr (domaine personnalisé, voir public/CNAME) —
  // plus depuis un sous-chemin GitHub Pages, d'où base '/' et non '/jd-precompta/'.
  base: '/',
  plugins: [react()],
})
