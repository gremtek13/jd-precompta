import { describe, expect, it } from 'vitest'
import { ajouterMois, anneeDe, aujourdHuiSql, dernierJourDuMois, jourDe, moisDe, premierJourDuMoisCourant } from './format'

// Ces primitives existent pour une raison précise : trois calculs de dates de l'application
// passaient par `new Date(...)` puis `toISOString()`, ce qui rendait la veille du bon jour dès que
// le fuseau local est à l'est de Greenwich (minuit à Paris = 22 h UTC la veille en été). Les cas
// ci-dessous sont ceux qui échouaient réellement avant le correctif — d'où leur précision.
describe('ajouterMois', () => {
  it("ramène un quantième absent au dernier jour du mois d'arrivée", () => {
    // Convention des échéanciers de prêt. `setMonth()` rendait le 3 mars.
    expect(ajouterMois('2026-01-31', 1)).toBe('2026-02-28')
    expect(ajouterMois('2026-03-31', 1)).toBe('2026-04-30')
  })

  it('tient compte des années bissextiles', () => {
    expect(ajouterMois('2024-01-31', 1)).toBe('2024-02-29')
  })

  it("garde le même quantième à travers le passage à l'heure d'été", () => {
    // Paris passe de UTC+1 à UTC+2 fin mars : l'ancien calcul rendait le 14 juillet.
    expect(ajouterMois('2026-01-15', 6)).toBe('2026-07-15')
  })

  it('franchit les fins d’année dans les deux sens', () => {
    expect(ajouterMois('2026-11-15', 3)).toBe('2027-02-15')
    expect(ajouterMois('2026-01-15', -1)).toBe('2025-12-15')
    expect(ajouterMois('2026-02-10', -6)).toBe('2025-08-10')
  })

  it('accepte un décalage nul et un recul de douze mois', () => {
    expect(ajouterMois('2026-07-04', 0)).toBe('2026-07-04')
    expect(ajouterMois('2026-05-31', -12)).toBe('2025-05-31')
  })

  it('ignore une éventuelle partie horaire', () => {
    expect(ajouterMois('2026-01-15T23:30:00Z', 1)).toBe('2026-02-15')
  })
})

describe('anneeDe, moisDe, jourDe', () => {
  it('lit le 1er janvier dans la bonne année', () => {
    // Le cas qui décide : `new Date('2026-01-01').getFullYear()` rend 2025 à New York, parce que
    // minuit UTC y est encore le 31 décembre. C'est l'année qui choisit la suite de numérotation
    // d'une facture — une suite annuelle légalement sans trou.
    expect(anneeDe('2026-01-01')).toBe(2026)
    expect(anneeDe('2026-12-31')).toBe(2026)
  })

  it('lit le mois en 1-12 et le jour sans décalage', () => {
    expect(moisDe('2026-01-01')).toBe(1)
    expect(moisDe('2026-12-31')).toBe(12)
    expect(jourDe('2026-03-10')).toBe(10)
    expect(jourDe('2026-03-01')).toBe(1)
  })

  it('accepte aussi un horodatage complet', () => {
    expect(anneeDe('2026-07-04T22:30:00Z')).toBe(2026)
    expect(moisDe('2026-07-04T22:30:00Z')).toBe(7)
    expect(jourDe('2026-07-04T22:30:00Z')).toBe(4)
  })
})

describe('dernierJourDuMois', () => {
  it('rend le dernier jour, février et bissextile compris', () => {
    expect(dernierJourDuMois('2026-02-01')).toBe('2026-02-28')
    expect(dernierJourDuMois('2024-02-15')).toBe('2024-02-29')
    expect(dernierJourDuMois('2026-12-03')).toBe('2026-12-31')
    expect(dernierJourDuMois('2026-04-10')).toBe('2026-04-30')
  })
})

// Ces deux-là dépendent de l'instant d'exécution. L'attendu est donc calculé avant ET après
// l'appel, et on accepte l'un ou l'autre : sans cela, un test lancé à la seconde où l'on change de
// jour échouerait sans qu'aucun code ne soit en cause — et cette suite garde le déploiement.
describe('dates du jour', () => {
  const jourLocal = (d: Date) =>
    [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')

  it('nomme le mois en cours tel que le voit l’utilisateur, pas UTC', () => {
    const avant = jourLocal(new Date()).slice(0, 7)
    const obtenu = premierJourDuMoisCourant()
    const apres = jourLocal(new Date()).slice(0, 7)
    expect([`${avant}-01`, `${apres}-01`]).toContain(obtenu)
  })

  it('date aujourd’hui en heure locale', () => {
    // Entre minuit et 2 h du matin à Paris, `toISOString()` datait de la veille — une facture
    // saisie tard le soir portait donc la mauvaise date d'émission.
    const avant = jourLocal(new Date())
    const obtenu = aujourdHuiSql()
    const apres = jourLocal(new Date())
    expect([avant, apres]).toContain(obtenu)
  })
})
