import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculerMensualite, capitalRestantDu, empruntActif, genererEcheancier, type Emprunt } from './emprunts'
import { aujourdHuiSql } from './format'

const PRET: Emprunt = {
  id: 'test', dossier_id: 'test', nom: 'Prêt matériel', organisme_preteur: null,
  capital_initial: 50000, taux_annuel: 4.2, date_debut: '2026-03-10', duree_mois: 60,
  created_at: '2026-03-01T00:00:00Z',
}

describe('calculerMensualite', () => {
  it('applique la formule à mensualité constante', () => {
    // M = P·i / (1 − (1+i)^−n), avec i = 4,2 %/12 = 0,0035 et n = 60 : 175 / 0,189119 = 925,3457.
    // Contre-vérifié en déroulant l'amortissement — 60 mensualités de ce montant soldent
    // exactement les 50 000 €.
    expect(calculerMensualite(50000, 4.2, 60)).toBeCloseTo(925.35, 2)
  })

  it('divise simplement le capital quand le taux est nul', () => {
    // Sans ce cas particulier, la formule diviserait par zéro.
    expect(calculerMensualite(1200, 0, 12)).toBe(100)
  })
})

describe('genererEcheancier', () => {
  it('place une échéance par mois, sans sauter ni doubler un mois', () => {
    // Un prêt démarré un 31 plaçait sa première échéance au 3 mars : février sauté, deux
    // échéances en mars. C'est le bug qui a motivé ces tests.
    const lignes = genererEcheancier({ capital_initial: 12000, taux_annuel: 3, duree_mois: 5, date_debut: '2026-01-31' })
    expect(lignes.map((l) => l.date)).toEqual([
      '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
    ])
    expect(new Set(lignes.map((l) => l.date.slice(0, 7))).size).toBe(5)
  })

  it("garde le même quantième malgré le passage à l'heure d'été", () => {
    const lignes = genererEcheancier({ capital_initial: 12000, taux_annuel: 3, duree_mois: 7, date_debut: '2026-01-15' })
    expect([...new Set(lignes.map((l) => l.date.slice(8)))]).toEqual(['15'])
  })

  it('solde exactement le capital au dernier mois', () => {
    // La dernière échéance absorbe l'écart d'arrondi accumulé : le capital restant doit tomber
    // pile à zéro, pas à quelques centimes près.
    const lignes = genererEcheancier(PRET)
    expect(lignes).toHaveLength(60)
    expect(lignes[lignes.length - 1].capitalRestant).toBe(0)
  })

  it('solde aussi un prêt à taux nul', () => {
    const lignes = genererEcheancier({ capital_initial: 1200, taux_annuel: 0, duree_mois: 12, date_debut: '2026-01-01' })
    expect(lignes[lignes.length - 1].capitalRestant).toBe(0)
    expect(lignes.every((l) => l.interets === 0)).toBe(true)
  })

  it('amortit un capital décroissant et des intérêts décroissants', () => {
    const lignes = genererEcheancier(PRET)
    expect(lignes[0].interets).toBeGreaterThan(lignes[59].interets)
    expect(lignes[0].capitalRestant).toBeGreaterThan(lignes[59].capitalRestant)
  })
})

describe('capitalRestantDu', () => {
  it('rend le capital initial avant le début du prêt', () => {
    expect(capitalRestantDu(PRET, '2026-01-01')).toBe(50000)
  })

  it('rend zéro une fois le prêt arrivé à terme', () => {
    expect(capitalRestantDu(PRET, '2032-01-01')).toBe(0)
  })

  it('décroît au fil des échéances', () => {
    const apresUnAn = capitalRestantDu(PRET, '2027-03-10')
    expect(apresUnAn).toBeLessThan(50000)
    expect(apresUnAn).toBeGreaterThan(0)
  })
})

describe('empruntActif', () => {
  it("n'est actif qu'entre le début et le solde du prêt", () => {
    expect(empruntActif(PRET, '2026-01-01')).toBe(false)
    expect(empruntActif(PRET, '2027-03-10')).toBe(true)
    expect(empruntActif(PRET, '2032-01-01')).toBe(false)
  })
})

describe('date de référence par défaut', () => {
  // Ces deux fonctions prennent « aujourd'hui » par défaut, et tous les tests ci-dessus passaient une
  // date explicite : ce chemin n'était donc jamais exercé. Il utilisait `toISOString()`, c'est-à-dire
  // la date UTC — à 00 h 30 le 1er janvier à Paris, celle-ci vaut encore le 31 décembre.
  const PRET_EN_COURS: Emprunt = {
    capital_initial: 50000, taux_annuel: 2, duree_mois: 72, date_debut: '2020-01-01',
  } as Emprunt

  afterEach(() => vi.useRealTimers())

  it('suit le calendrier civil, pas l’horloge UTC', () => {
    // Instant choisi pour que les deux dates divergent là où elles peuvent : 23 h 30 UTC le
    // 31 décembre, soit déjà le 1er janvier à Paris (+1) et à Auckland (+13).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-12-31T23:30:00Z'))

    const maintenant = new Date()
    const civil = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-${String(maintenant.getDate()).padStart(2, '0')}`
    const utc = maintenant.toISOString().slice(0, 10)

    expect(aujourdHuiSql()).toBe(civil)
    expect(capitalRestantDu(PRET_EN_COURS)).toBe(capitalRestantDu(PRET_EN_COURS, civil))
    expect(empruntActif(PRET_EN_COURS)).toBe(empruntActif(PRET_EN_COURS, civil))

    // L'assertion qui mord : seulement là où les deux dates diffèrent réellement (ni en UTC, ni à
    // New York à cette heure-là). Sous Europe/Paris et Pacific/Auckland, elle échoue si le défaut
    // repasse à `toISOString()`.
    if (civil !== utc) {
      expect(capitalRestantDu(PRET_EN_COURS)).not.toBe(capitalRestantDu(PRET_EN_COURS, utc))
    }
  })
})
