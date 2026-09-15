import { describe, expect, it } from 'vitest'

// Garde-fou du harnais lui-même, pas du code métier.
//
// Le fuseau a été épinglé un temps dans `vitest.config.ts` via `env: { TZ: ... }`, ce qui écrasait
// la variable posée par le shell : `test:fuseaux` rejouait quatre fois la même suite sous
// Europe/Paris tout en affichant les étiquettes des quatre fuseaux, et la CI passait au vert sans
// rien vérifier de plus qu'un seul fuseau. Comme toute la suite de dates repose sur l'idée qu'on
// l'exécute réellement ailleurs qu'en France, cette confusion ne doit pas pouvoir revenir sans
// être signalée.
describe('harnais de test', () => {
  it('applique bien le fuseau demandé par le script', () => {
    const demande = process.env.TZ
    if (!demande) return // exécution sans consigne : rien à vérifier
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(demande)
  })
})
