import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Deux projets, et la séparation est délibérée.
//
// « logique » couvre src/lib : des calculs purs, sans JSX ni DOM. Rien à charger, donc rien qui
// ralentisse — c'est la suite qui tourne quatre fois de suite dans `test:fuseaux`.
//
// « écrans » couvre les composants (*.test.tsx) : plugin React pour le JSX, jsdom pour le DOM. Elle
// existe parce qu'un défaut d'écran ne se voit dans aucun test de src/lib — le verrou d'exécution
// qui a laissé passer deux clics rapprochés (141 lignes importées pour 78 fichiers) vivait dans un
// composant, et toute la logique appelée derrière était juste.
//
// Le fuseau est délibérément absent d'ici. Il a d'abord été épinglé via `env: { TZ: ... }`, ce qui
// écrasait silencieusement la variable passée par le shell : `test:fuseaux` rejouait quatre fois la
// même suite sous Europe/Paris en affichant les étiquettes des quatre fuseaux. Le fuseau est donc
// porté par les scripts npm, seuls maîtres de la valeur, et `fuseau.test.ts` vérifie à chaque
// exécution que celle demandée est bien celle appliquée.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'logique',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'écrans',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/ecrans.ts'],
        },
      },
    ],
  },
})
