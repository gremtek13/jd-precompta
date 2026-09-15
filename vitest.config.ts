import { defineConfig } from 'vitest/config'

// Config séparée de vite.config.ts : ces tests ne portent que sur la logique métier de src/lib
// (calculs purs, sans JSX ni DOM), donc ni plugin React ni environnement navigateur à charger.
//
// Le fuseau est délibérément absent d'ici. Il a d'abord été épinglé via `env: { TZ: ... }`, ce qui
// écrasait silencieusement la variable passée par le shell : `test:fuseaux` rejouait quatre fois la
// même suite sous Europe/Paris en affichant les étiquettes des quatre fuseaux. Le fuseau est donc
// porté par les scripts npm, seuls maîtres de la valeur, et `fuseau.test.ts` vérifie à chaque
// exécution que celle demandée est bien celle appliquée.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
