import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  composerLaSituation, confirmationDeLaPublication, confirmationDuRetrait, contenuLu, memeDateAnneePrecedente, mesComptesOuverts,
  montantDit, postesFaceAFace, REFUS_SITUATION, SITUATIONS_PUBLIEES_EXPORTEES, situationEnCoursA, situationsEnCours,
  situationsEnCoursTriees,
  type EntreeDeLaSituation, type SituationDuMoteur, type SituationPubliee,
} from './situationsPubliees'

const RACINE = resolve(__dirname, '../..')
const MIGRATION = readFileSync(resolve(RACINE, 'supabase/schema/20261107164102_situations_publiees.sql'), 'utf8')

function moteur(debut: string, fin: string, totaux: [string, number][]): SituationDuMoteur {
  return { periodeDebut: debut, periodeFin: fin, totauxParPoste: totaux, ventesFactureesEcartees: [], fraisSansPoste: [],
    recettesDeCaisseSansPoste: [] }
}

function entree(partiel: Partial<EntreeDeLaSituation> = {}): EntreeDeLaSituation {
  return {
    arreteeAu: '2025-06-30', aujourdHui: '2026-11-06', anneesValidees: [],
    situation: moteur('2025-01-01', '2025-06-30', [['Recettes', 12500], ['Achats', -2300.5]]),
    tva: { assujetti: false },
    nMoins1: { situation: moteur('2024-01-01', '2024-06-30', [['Recettes', 11000]]), tva: { assujetti: false } },
    ...partiel,
  }
}

describe('composerLaSituation', () => {
  it('compose en centimes, les totaux tirés des postes arrondis — le contenu de l’essai de la base', () => {
    const r = composerLaSituation(entree())
    expect(r).toEqual({ ok: true, contenu: {
      version: 1, statut: 'provisoire', periode: { debut: '2025-01-01', fin: '2025-06-30' },
      postes: [{ poste: 'Recettes', montant: 1250000 }, { poste: 'Achats', montant: -230050 }],
      recettes: 1250000, depenses: 230050, resultat: 1019950, tva: { assujetti: false },
      n_moins_1: { periode: { debut: '2024-01-01', fin: '2024-06-30' }, postes: [{ poste: 'Recettes', montant: 1100000 }],
        recettes: 1100000, depenses: 0, resultat: 1100000, tva: { assujetti: false } },
    } })
  })

  it('le statut se lit de l’exercice : validé, « validee » ; un autre exercice validé n’y change rien', () => {
    const v = composerLaSituation(entree({ anneesValidees: [2025] }))
    const p = composerLaSituation(entree({ anneesValidees: [2024] }))
    expect(v.ok && v.contenu.statut).toBe('validee')
    expect(p.ok && p.contenu.statut).toBe('provisoire')
  })

  it('un flottant d’euros devient des centimes exacts, et le total est la somme des postes publiés', () => {
    const r = composerLaSituation(entree({ nMoins1: null,
      situation: moteur('2025-01-01', '2025-06-30', [['Recettes', 0.1 + 0.2], ['Achats', -0.015]]) }))
    expect(r.ok && r.contenu.postes).toEqual([{ poste: 'Recettes', montant: 30 }, { poste: 'Achats', montant: -2 }])
    expect(r.ok && [r.contenu.recettes, r.contenu.depenses, r.contenu.resultat]).toEqual([30, 2, 28])
  })

  it('la TVA d’un assujetti : la CA3 de la même période, nette en centimes (un crédit négatif)', () => {
    const ca3 = { periode: { debut: '2025-01-01', fin: '2025-06-30' }, netPeriode: -412, ecartees: [], releveEcartees: [],
      exigibilitesEcartees: [], caisseEcartees: [], ventesFactureesEcartees: [] }
    const r = composerLaSituation(entree({ nMoins1: null, tva: { assujetti: true, ca3 } }))
    expect(r.ok && r.contenu.tva).toEqual({ assujetti: true, nette: -41200 })
    const autre = composerLaSituation(entree({ nMoins1: null, tva: { assujetti: true, ca3: { ...ca3, periode: { debut: '2025-01-01', fin: '2025-03-31' } } } }))
    expect(autre).toEqual({ ok: false, refus: 'La TVA de la situation ne se calcule pas sur la même période que ses chiffres.' })
  })

  it('refuse, avant le clic et sous les mots de la base : une date à venir, une période fausse, la comparaison décalée', () => {
    expect(composerLaSituation(entree({ arreteeAu: '2026-11-07' }))).toEqual({ ok: false, refus: REFUS_SITUATION.dateAVenir })
    expect(composerLaSituation(entree({ arreteeAu: '2025-02-30' }))).toEqual({ ok: false, refus: REFUS_SITUATION.dateAbsente })
    expect(composerLaSituation(entree({ arreteeAu: '2025-06-29' }))).toEqual({ ok: false, refus: REFUS_SITUATION.periode })
    const decalee = composerLaSituation(entree({ nMoins1: { situation: moteur('2024-01-01', '2024-12-31', []), tva: { assujetti: false } } }))
    expect(decalee).toEqual({ ok: false, refus: REFUS_SITUATION.comparaison + REFUS_SITUATION.periode })
  })

  it('un montant que le moteur n’a pas su compter retient la publication', () => {
    const trou = { ...moteur('2025-01-01', '2025-06-30', []), fraisSansPoste: [{} as never] }
    expect(composerLaSituation(entree({ situation: trou })).ok).toBe(false)
  })

  it('le 29 février devient le 28, comme en base', () => {
    expect(memeDateAnneePrecedente('2028-02-29')).toBe('2027-02-28')
    expect(memeDateAnneePrecedente('2025-06-30')).toBe('2024-06-30')
  })
})

describe('situationsEnCours', () => {
  const ligne = (id: string, geste: 'publication' | 'retrait', remplace: string | null): SituationPubliee => ({
    id, dossier_id: 'd', annee: 2025, geste, arretee_au: '2025-06-30', statut: geste === 'publication' ? 'provisoire' : null,
    contenu: null, remplace_id: remplace, auteur: 'a', publiee_le: '2025-07-01T10:00:00Z' })
  it('une publication qu’aucune ligne ne cite ; ni la remplacée, ni la retirée, ni le retrait', () => {
    const lignes = [ligne('a', 'publication', null), ligne('b', 'publication', 'a'), ligne('c', 'publication', null), ligne('r', 'retrait', 'c')]
    expect(situationsEnCours(lignes).map((l) => l.id)).toEqual(['b'])
  })
})

describe('les écrans (étape C4b)', () => {
  const contenu = () => {
    const r = composerLaSituation(entree())
    if (!r.ok) throw new Error(r.refus)
    return r.contenu
  }
  const ligne = (id: string, arretee: string, publiee: string, remplace: string | null = null): SituationPubliee => ({
    id, dossier_id: 'd', annee: Number(arretee.slice(0, 4)), geste: 'publication', arretee_au: arretee, statut: 'provisoire',
    contenu: contenu(), remplace_id: remplace, auteur: 'a', publiee_le: publiee })

  it('« Mes comptes » s’ouvre avec la migration ET la case, jamais l’une sans l’autre', () => {
    expect(mesComptesOuverts(true, true)).toBe(true)
    expect(mesComptesOuverts(false, true)).toBe(false)
    expect(mesComptesOuverts(true, false)).toBe(false)
  })

  it('les situations en cours, la plus récente date d’abord ; celle d’une date, pour la remplacer', () => {
    const lignes = [ligne('a', '2025-03-31', '2025-04-01T08:00:00Z'), ligne('b', '2025-06-30', '2025-07-01T08:00:00Z'),
      ligne('c', '2025-03-31', '2025-04-02T08:00:00Z', 'a')]
    expect(situationsEnCoursTriees(lignes).map((l) => l.id)).toEqual(['b', 'c'])
    expect(situationEnCoursA(lignes, '2025-03-31')?.id).toBe('c')
    expect(situationEnCoursA(lignes, '2025-09-30')).toBeNull()
  })

  it('la confirmation nomme la date, le statut, les totaux et la comparaison — ou son absence', () => {
    const c = confirmationDeLaPublication(contenu(), false)
    const texte = c.paragraphes.join(' ')
    expect(texte).toContain('arrêtée au 30/06/2025, « provisoire »')
    expect(texte).toContain(`recettes ${montantDit(1250000)}, dépenses ${montantDit(230050)}, résultat ${montantDit(1019950)}`)
    expect(texte).toContain('du 01/01/2024 au 30/06/2024')
    expect(c.bouton).toBe('Publier')
    const sans = confirmationDeLaPublication({ ...contenu(), n_moins_1: null, statut: 'validee' }, true)
    expect(sans.paragraphes.join(' ')).toContain('« validée »')
    expect(sans.paragraphes.join(' ')).toContain('Sans la comparaison')
    expect(sans.bouton).toBe('Remplacer')
    expect(confirmationDuRetrait({ arretee_au: '2025-06-30', statut: 'provisoire' }).paragraphes[0]).toContain('30/06/2025')
  })

  it('un contenu se relit à sa forme : tout écart le rend illisible, jamais arrondi', () => {
    const bon = contenu()
    expect(contenuLu(JSON.parse(JSON.stringify(bon)))).toEqual(bon)
    expect(contenuLu(null)).toBeNull()
    expect(contenuLu({ ...bon, version: 2 })).toBeNull()
    expect(contenuLu({ ...bon, statut: 'valide' })).toBeNull()
    expect(contenuLu({ ...bon, recettes: bon.recettes + 1 })).toBeNull()
    expect(contenuLu({ ...bon, postes: [{ poste: 'Recettes', montant: 12.5 }] })).toBeNull()
    expect(contenuLu({ ...bon, n_moins_1: { ...bon.n_moins_1, resultat: 0 } })).toBeNull()
    expect(contenuLu({ ...bon, tva: { assujetti: true } })).toBeNull()
  })

  it('les postes face à face : ceux de N, puis ceux de N−1 seuls', () => {
    const c = contenu()
    expect(postesFaceAFace(c, c.n_moins_1)).toEqual([
      { poste: 'Recettes', n: 1250000, nMoins1: 1100000 },
      { poste: 'Achats', n: -230050, nMoins1: null },
    ])
    expect(postesFaceAFace({ ...c, postes: [] }, c.n_moins_1)).toEqual([{ poste: 'Recettes', n: null, nMoins1: 1100000 }])
  })
})

describe('le module et la migration', () => {
  it('chaque refus redit est écrit, au caractère près, dans la migration (SQL : apostrophes doublées)', () => {
    for (const mots of Object.values(REFUS_SITUATION)) {
      expect(MIGRATION, mots).toContain(mots.replace(/'/g, '\'\''))
    }
  })

  it('le drapeau suit l’export : levé, la migration y est', () => {
    const exportee = readdirSync(resolve(RACINE, 'supabase/schema')).some((f) => f.endsWith('_situations_publiees.sql'))
    expect(SITUATIONS_PUBLIEES_EXPORTEES).toBe(exportee)
  })
})
