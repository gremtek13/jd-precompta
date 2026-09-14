import { defineConfig } from 'vitest/config'

// Config séparée de vite.config.ts : ces tests ne portent que sur la logique métier de src/lib
// (calculs purs, sans JSX ni DOM), donc ni plugin React ni environnement navigateur à charger.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Le fuseau est épinglé sur celui des utilisateurs, et ce n'est pas un détail : les bugs de
    // dates que cette suite verrouille (plan de trésorerie décalé d'un mois, échéancier décalé
    // d'un jour) passaient tous en UTC. Une suite qui tournerait en UTC les laisserait revenir
    // sans rien signaler. `npm run test:fuseaux` rejoue la même suite dans plusieurs fuseaux.
    env: { TZ: 'Europe/Paris' },
  },
})
