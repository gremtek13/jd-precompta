import { describe, expect, it } from 'vitest'
import { formatMoney } from './format'
import {
  controleDuFichier, controlesAvecLeFichier, jonctionsDesReleves, phraseDeLaRupture, phraseDeLaSuiteDuFichier, PHRASE_FICHIER_SANS_SOLDES,
  PHRASE_SUITE_NON_VERIFIEE, rupturesDesReleves, type MouvementDuReleve, type ReleveControle,
} from './suiteDesReleves'

// Des relevés fictifs : leurs soldes et leurs mouvements, en euros.
function releve(id: string, debut: string, fin: string, initial: number, final: number, o: Partial<ReleveControle> = {}): ReleveControle {
  return {
    id, source_fichier: `${id}.csv`, solde_initial: initial, solde_final: final, somme_mouvements: Math.round((final - initial) * 100) / 100,
    coherent: true, periode_debut: debut, periode_fin: fin, ...o,
  }
}
const mvt = (date: string, montant: number, source_fichier: string | null): MouvementDuReleve => ({ date, montant, source_fichier })

const JUILLET = releve('juillet', '2025-07-01', '2025-07-31', 1000, 1200)
const AOUT = releve('aout', '2025-08-01', '2025-08-31', 1200, 900)
const LIGNES = [mvt('2025-07-10', 200, 'juillet.csv'), mvt('2025-08-12', -300, 'aout.csv')]

describe('jonctionsDesReleves : deux relevés qui se suivent', () => {
  it('le solde final de l’un est le solde initial du suivant : ils se suivent', () => {
    expect(jonctionsDesReleves([AOUT, JUILLET], LIGNES).map((j) => [j.precedent.id, j.suivant.id, j.etat])).toEqual([['juillet', 'aout', 'se suivent']])
  })

  it('un centime d’écart est une rupture : au centime, signée lu − attendu', () => {
    const aout = { ...AOUT, solde_initial: 1200.01 }
    expect(jonctionsDesReleves([JUILLET, aout], LIGNES)).toEqual([
      { precedent: JUILLET, suivant: aout, etat: 'rupture', attendu: 120000, lu: 120001, ecart: 1, recouvrement: false },
    ])
  })

  it('août exporté jusqu’au 15, puis septembre : la seconde quinzaine manque, la rupture se dit', () => {
    const aout = releve('aout', '2025-08-01', '2025-08-15', 1200, 1000)
    const septembre = releve('septembre', '2025-09-01', '2025-09-30', 750, 800)
    const r = rupturesDesReleves(jonctionsDesReleves([JUILLET, aout, septembre], LIGNES))
    expect(r.map((j) => [j.precedent.id, j.suivant.id, j.ecart])).toEqual([['aout', 'septembre', -25000]])
    expect(phraseDeLaRupture(r[0])).toBe(
      `Le relevé du 01/08/2025 au 15/08/2025 (« aout.csv ») finit à ${formatMoney(1000)} ; le relevé du 01/09/2025 au 30/09/2025 `
      + `(« septembre.csv ») s'ouvre à ${formatMoney(750)} : un écart de ${formatMoney(250)}. Des opérations manquent probablement `
      + 'entre les deux (un relevé exporté en partie, ou une période non importée) ; rien n’est bloqué, mais les totaux bancaires en dépendent.',
    )
  })

  it('un mois entier sans relevé, sans mouvement en base : la rupture se dit aussi (le solde ne se retrouve pas)', () => {
    const septembre = releve('septembre', '2025-09-01', '2025-09-30', 900, 950)
    expect(jonctionsDesReleves([JUILLET, septembre], LIGNES.slice(0, 1)).map((j) => j.etat)).toEqual(['rupture'])
  })

  it('un fichier sans ses deux soldes entre les deux (un OFX) : ses mouvements sont entre eux, ils ne se comparent pas', () => {
    const septembre = releve('septembre', '2025-09-01', '2025-09-30', 900, 950)
    const lignes = [...LIGNES.slice(0, 1), mvt('2025-08-12', -300, 'aout.ofx')]
    expect(jonctionsDesReleves([JUILLET, septembre], lignes)).toMatchObject([{ etat: 'ne se compare pas', raison: 'mouvements entre les deux' }])
    // Une saisie sans fichier aussi.
    expect(jonctionsDesReleves([JUILLET, septembre], [...LIGNES.slice(0, 1), mvt('2025-08-12', -300, null)])).toMatchObject([{ etat: 'ne se compare pas' }])
  })

  it('un mouvement daté du premier jour du suivant ou du dernier du précédent n’est pas « entre les deux »', () => {
    const lignes = [mvt('2025-07-31', 5, 'autre.csv'), mvt('2025-08-01', 5, 'autre.csv')]
    expect(jonctionsDesReleves([JUILLET, AOUT], lignes).map((j) => j.etat)).toEqual(['se suivent'])
  })

  it('un contrôle sans ses deux dates n’entre dans aucune comparaison', () => {
    expect(jonctionsDesReleves([JUILLET, { ...AOUT, periode_debut: null }], LIGNES)).toEqual([])
  })

  it('un seul relevé, ou aucun : aucune jonction', () => {
    expect(jonctionsDesReleves([JUILLET], LIGNES)).toEqual([])
    expect(jonctionsDesReleves([], [])).toEqual([])
  })
})

describe('jonctionsDesReleves : deux relevés qui se recouvrent', () => {
  // Mars exporté jusqu'au 05/04 (un mouvement de −100 le 03/04), puis avril entier.
  const MARS = releve('mars', '2025-03-01', '2025-04-05', 500, 300)
  const MARS_LIGNES = [mvt('2025-03-15', -100, 'mars.csv'), mvt('2025-04-03', -100, 'mars.csv')]
  const AVRIL = releve('avril', '2025-04-01', '2025-04-30', 400, 350)

  it('le précédent porte le solde du début du suivant : son final, moins ses mouvements datés de ce jour ou après', () => {
    expect(jonctionsDesReleves([MARS, AVRIL], MARS_LIGNES).map((j) => j.etat)).toEqual(['se suivent'])
    const faux = { ...AVRIL, solde_initial: 410 }
    expect(jonctionsDesReleves([MARS, faux], MARS_LIGNES)).toEqual([
      { precedent: MARS, suivant: faux, etat: 'rupture', attendu: 40000, lu: 41000, ecart: 1000, recouvrement: true },
    ])
    expect(phraseDeLaRupture(rupturesDesReleves(jonctionsDesReleves([MARS, faux], MARS_LIGNES))[0]))
      .toContain(`porte ${formatMoney(400)} au matin du 01/04/2025 ; le relevé du 01/04/2025 au 30/04/2025 (« avril.csv ») s'ouvre à ${formatMoney(410)}`)
  })

  it('une ouverture datée de la veille au soir (le dernier jour du précédent) se retrouve au soir de ce jour', () => {
    // Juillet finit le 31/07 avec un mouvement ce jour-là ; août s'ouvre « au 31/07 », au soir.
    const juillet = releve('juillet', '2025-07-01', '2025-07-31', 1000, 1200)
    const lignes = [mvt('2025-07-10', 150, 'juillet.csv'), mvt('2025-07-31', 50, 'juillet.csv')]
    const aout = releve('aout', '2025-07-31', '2025-08-31', 1200, 900)
    expect(jonctionsDesReleves([juillet, aout], lignes).map((j) => j.etat)).toEqual(['se suivent'])
    // Et au matin aussi (la convention de l'application : le solde d'avant les mouvements du jour).
    expect(jonctionsDesReleves([juillet, { ...aout, solde_initial: 1150 }], lignes).map((j) => j.etat)).toEqual(['se suivent'])
    expect(jonctionsDesReleves([juillet, { ...aout, solde_initial: 1100 }], lignes).map((j) => j.etat)).toEqual(['rupture'])
  })

  it('un relevé contenu dans un autre : il se compare à lui, puis ne devient le précédent de personne', () => {
    const annee = releve('annee', '2025-01-01', '2025-12-31', 0, 300)
    const lignes = [mvt('2025-03-10', 100, 'annee.csv'), mvt('2025-06-10', 200, 'annee.csv')]
    const avril = releve('avril', '2025-04-01', '2025-04-30', 100, 100)
    const janvier2026 = releve('janvier', '2026-01-01', '2026-01-31', 300, 300)
    const j = jonctionsDesReleves([annee, avril, janvier2026], lignes)
    expect(j.map((x) => [x.precedent.id, x.suivant.id, x.etat])).toEqual([['annee', 'avril', 'se suivent'], ['annee', 'janvier', 'se suivent']])
  })

  it('un précédent qui ne boucle pas, ou dont les mouvements ne se retrouvent pas : ils ne se comparent pas', () => {
    expect(jonctionsDesReleves([{ ...MARS, coherent: false }, AVRIL], MARS_LIGNES)).toMatchObject([{ etat: 'ne se compare pas', raison: 'le précédent ne boucle pas' }])
    expect(jonctionsDesReleves([MARS, AVRIL], MARS_LIGNES.slice(1))).toMatchObject([{ etat: 'ne se compare pas', raison: 'mouvements du précédent introuvables' }])
    expect(jonctionsDesReleves([{ ...MARS, source_fichier: null }, AVRIL], MARS_LIGNES)).toMatchObject([{ etat: 'ne se compare pas', raison: 'mouvements du précédent introuvables' }])
  })

  it('deux relevés qui ne se suivent pas en cohérence le disent même si l’un ne boucle pas, quand ils ne se recouvrent pas', () => {
    expect(jonctionsDesReleves([{ ...JUILLET, coherent: false }, { ...AOUT, solde_initial: 1 }], LIGNES).map((j) => j.etat)).toEqual(['rupture'])
  })
})

describe('phraseDeLaSuiteDuFichier : ce que l’import dit', () => {
  const k = { soldeInitial: 750, soldeFinal: 800, sommeMouvements: 50, coherent: true, dateInitiale: '2025-09-01', dateFinale: '2025-09-30' }

  it('le fichier qui suit une quinzaine manquante : la rupture avec son précédent, signalée', () => {
    const aout = releve('aout', '2025-08-01', '2025-08-15', 1200, 1000)
    const phrase = phraseDeLaSuiteDuFichier([JUILLET, aout], LIGNES, controleDuFichier('septembre.csv', k))
    expect(phrase).toMatch(/^⚠ Le relevé du 01\/08\/2025 au 15\/08\/2025 \(« aout\.csv »\) finit à/)
    expect(phrase).toContain(`un écart de ${formatMoney(250)}`)
  })

  it('le fichier importé avant son précédent : la rupture avec le suivant se dit aussi', () => {
    const aout = controleDuFichier('aout.csv', { soldeInitial: 1200, soldeFinal: 1000, sommeMouvements: -200, coherent: true, dateInitiale: '2025-08-01', dateFinale: '2025-08-15' })
    expect(phraseDeLaSuiteDuFichier([JUILLET, releve('septembre', '2025-09-01', '2025-09-30', 750, 800)], LIGNES, aout)).toContain('« aout.csv »')
  })

  it('sans écart, rien à dire ; le même nom remplace son contrôle, comme l’upsert', () => {
    expect(phraseDeLaSuiteDuFichier([JUILLET], LIGNES, controleDuFichier('aout.csv', { ...k, soldeInitial: 1200, dateInitiale: '2025-08-01', dateFinale: '2025-08-31' }))).toBeNull()
    const ancien = { ...AOUT, solde_initial: 5 }
    const nouveau = controleDuFichier('aout.csv', { ...k, dateInitiale: '2025-08-01', dateFinale: '2025-08-31' })
    expect(controlesAvecLeFichier([JUILLET, ancien], nouveau)).toEqual([JUILLET, nouveau])
    expect(controlesAvecLeFichier([JUILLET], controleDuFichier(null, k))).toHaveLength(2)
  })

  it('un fichier sans ses deux soldes, ou des relevés en base illisibles : le dire, sans rupture', () => {
    expect(phraseDeLaSuiteDuFichier([JUILLET], LIGNES, null)).toBe(PHRASE_FICHIER_SANS_SOLDES)
    expect(phraseDeLaSuiteDuFichier(null, LIGNES, controleDuFichier('x.csv', k))).toBe(PHRASE_SUITE_NON_VERIFIEE)
  })

  it('ce qui ne se compare pas se dit, sans ⚠', () => {
    const phrase = phraseDeLaSuiteDuFichier([JUILLET], [...LIGNES, mvt('2025-08-12', -300, 'aout.ofx')], controleDuFichier('septembre.csv', k))
    expect(phrase).toMatch(/^Le relevé du 01\/07\/2025 au 31\/07\/2025 \(« juillet\.csv »\) et le relevé du 01\/09\/2025 au 30\/09\/2025 \(« septembre\.csv »\) ne se comparent pas : des mouvements/)
  })
})
