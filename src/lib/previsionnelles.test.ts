import { describe, expect, it } from 'vitest'
import {
  previsionnellesSansPaiement, remplaceLaPrevisionnelle, remplacementsDesPrevisionnelles, texteDeLAmbiguite, texteDuRemplacement,
  type ContexteDesRemplacements, type EcheanceProposee,
} from './previsionnelles'
import type { CotisationDeclaree, LigneBancaire } from './types'

// L'ÉCHÉANCE PRÉVISIONNELLE ET L'APPEL DÉFINITIF (étape 2035S2, 2035S-Q4 (A)). Données FICTIVES.

const echeance = (o: Partial<CotisationDeclaree>): CotisationDeclaree => ({
  id: 'cot', dossier_id: 'd1', echeance: '2026-01-20', montant_appele: 300, montant_verse: null, montant_csg_crds: null,
  created_at: '2025-12-01T09:00:00Z', previsionnel: true, paiement_personnel_le: null, ...o,
})
const mouvement = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd1', date: '2026-01-05', libelle: 'VIR', montant: -10, statut: 'non_rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
  libelle_brut: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
  reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-01-06T09:00:00Z',
  encaissements_de_factures: false, ...o,
})
const appel = (date: string, montant = 320): EcheanceProposee => ({ date, montant, previsionnel: false })
const contexte = (o: Partial<ContexteDesRemplacements> = {}): ContexteDesRemplacements => ({
  payeeParUnMouvement: () => false, paiementsLus: true, figee: () => false, ...o,
})

describe('remplaceLaPrevisionnelle — 2035S-Q4, (A) : le même mois civil', () => {
  it('le même mois oui, le mois voisin non, quel que soit l’écart en jours', () => {
    expect(remplaceLaPrevisionnelle('2026-01-20', '2026-01-05')).toBe(true)
    expect(remplaceLaPrevisionnelle('2026-01-31', '2026-01-01')).toBe(true)
    expect(remplaceLaPrevisionnelle('2026-01-31', '2026-02-01')).toBe(false)
    expect(remplaceLaPrevisionnelle('2025-02-05', '2026-02-05')).toBe(false)
  })
})

describe('remplacementsDesPrevisionnelles', () => {
  it('l’appel d’une autre date du même mois remplace la prévisionnelle qu’aucun paiement ne date', () => {
    const prev = echeance({ id: 'prev', echeance: '2026-02-20' })
    const r = remplacementsDesPrevisionnelles([appel('2026-02-05')], [prev], contexte())
    expect([...r.remplacements]).toEqual([[0, prev]])
    expect(r.ambigues.size + r.inconnues.size).toBe(0)
    expect(texteDuRemplacement(prev).replace(/\s/g, ' ')).toBe('Remplace la prévisionnelle du 20/02/2026 (300,00 €)')
  })

  it('ne remplace rien d’un autre mois, ni à la même date (la confirmation d’hier la reconnaît), ni par une prévisionnelle', () => {
    const prev = echeance({ id: 'prev', echeance: '2026-01-20' })
    expect(remplacementsDesPrevisionnelles([appel('2026-02-05')], [prev], contexte()).remplacements.size).toBe(0)
    expect(remplacementsDesPrevisionnelles([appel('2026-01-20')], [prev], contexte()).remplacements.size).toBe(0)
    expect(remplacementsDesPrevisionnelles([{ ...appel('2026-01-05'), previsionnel: true }], [prev], contexte()).remplacements.size).toBe(0)
    // Une échéance existe déjà à la date de l'appel : il ne s'insère pas, et ne remplace rien.
    const existante = echeance({ id: 'def', echeance: '2026-01-05', previsionnel: false })
    expect(remplacementsDesPrevisionnelles([appel('2026-01-05')], [prev, existante], contexte()).remplacements.size).toBe(0)
  })

  it('ne remplace pas une prévisionnelle payée, versée, figée, ni une échéance définitive', () => {
    const cas: [string, CotisationDeclaree, Partial<ContexteDesRemplacements>][] = [
      ['prélevée', echeance({ id: 'p' }), { payeeParUnMouvement: (c) => c.id === 'p' }],
      ['payée depuis le compte personnel', echeance({ id: 'p', paiement_personnel_le: '2026-01-20' }), {}],
      ['versement saisi', echeance({ id: 'p', montant_verse: 300 }), {}],
      ['figée', echeance({ id: 'p' }), { figee: (c) => c.id === 'p' }],
      ['définitive', echeance({ id: 'p', previsionnel: false }), {}],
    ]
    for (const [nom, prev, ctx] of cas) {
      expect(remplacementsDesPrevisionnelles([appel('2026-01-05')], [prev], contexte(ctx)).remplacements.size, nom).toBe(0)
    }
  })

  it('ne prend pas la prévisionnelle qu’une autre proposition confirme à sa date', () => {
    const prev = echeance({ id: 'prev', echeance: '2026-01-20' })
    const r = remplacementsDesPrevisionnelles([appel('2026-01-05'), appel('2026-01-20', 330)], [prev], contexte())
    expect(r.remplacements.size).toBe(0)
  })

  it('deux prévisionnelles remplaçables du même mois : aucune n’est choisie, l’ambiguïté se dit', () => {
    const a = echeance({ id: 'a', echeance: '2026-01-10' })
    const b = echeance({ id: 'b', echeance: '2026-01-25' })
    const r = remplacementsDesPrevisionnelles([appel('2026-01-05')], [a, b], contexte())
    expect(r.remplacements.size).toBe(0)
    expect([...r.ambigues]).toEqual([[0, [a, b]]])
    expect(texteDeLAmbiguite([a, b])).toBe('S’ajoute : 2 prévisionnelles de ce mois (10/01/2026, 25/01/2026), aucune n’est remplacée à ta place')
    // Une des deux prélevée : l'autre se remplace.
    expect([...remplacementsDesPrevisionnelles([appel('2026-01-05')], [a, b], contexte({ payeeParUnMouvement: (c) => c.id === 'a' })).remplacements])
      .toEqual([[0, b]])
  })

  it('une prévisionnelle ne se remplace qu’une fois : le premier appel du mois la prend, le suivant s’ajoute', () => {
    const prev = echeance({ id: 'prev', echeance: '2026-01-20' })
    // Données reçues dans le désordre : l'ordre des dates décide, et les indices restent ceux reçus.
    const r = remplacementsDesPrevisionnelles([appel('2026-01-28'), appel('2026-01-05')], [prev], contexte())
    expect([...r.remplacements]).toEqual([[1, prev]])
    expect(r.ambigues.size).toBe(0)
  })

  it('sur des paiements lus en partie, une prévisionnelle remplaçable rend la proposition inconnue — rien n’est remplacé', () => {
    const prev = echeance({ id: 'prev', echeance: '2026-01-20' })
    const r = remplacementsDesPrevisionnelles([appel('2026-01-05'), appel('2026-03-05')], [prev], contexte({ paiementsLus: false }))
    expect(r.remplacements.size).toBe(0)
    expect([...r.inconnues]).toEqual([0])
    // Sans prévisionnelle du mois, rien d'inconnu : la création n'a pas à attendre.
    expect(remplacementsDesPrevisionnelles([appel('2026-03-05')], [prev], contexte({ paiementsLus: false })).inconnues.size).toBe(0)
  })
})

describe('previsionnellesSansPaiement — le point d’attention', () => {
  // Un relevé du 05/01/2026 au 30/04/2026 : la fenêtre va jusqu'au 30/04 moins la marge laissée au prélèvement.
  const releve = [mouvement({ id: 'm1', date: '2026-01-05' }), mouvement({ id: 'm2', date: '2026-04-30' })]

  it('dit la prévisionnelle qu’aucun prélèvement ne paie, dans la fenêtre que le relevé couvre', () => {
    const prev = echeance({ id: 'prev', echeance: '2026-01-20' })
    expect(previsionnellesSansPaiement([prev], releve, 'tresorerie', null)).toEqual([prev])
  })

  it('se tait sur une prévisionnelle prélevée ou payée depuis le compte personnel, et sur une échéance définitive', () => {
    const prelevee = echeance({ id: 'p1' })
    const lignes = [...releve, mouvement({ id: 'prlv', date: '2026-01-20', montant: -300, statut: 'rapprochee', cotisation_id: 'p1' })]
    expect(previsionnellesSansPaiement([prelevee], lignes, 'tresorerie', null)).toEqual([])
    expect(previsionnellesSansPaiement([echeance({ id: 'p2', paiement_personnel_le: '2026-01-22' })], releve, 'tresorerie', null)).toEqual([])
    expect(previsionnellesSansPaiement([echeance({ id: 'p3', previsionnel: false })], releve, 'tresorerie', null)).toEqual([])
  })

  it('se tait hors de la fenêtre du relevé : avant lui, rien n’est importé ; après, le prélèvement n’est peut-être pas passé', () => {
    expect(previsionnellesSansPaiement([echeance({ echeance: '2025-12-20' })], releve, 'tresorerie', null)).toEqual([])
    expect(previsionnellesSansPaiement([echeance({ echeance: '2026-04-28' })], releve, 'tresorerie', null)).toEqual([])
    expect(previsionnellesSansPaiement([echeance({})], [], 'tresorerie', null)).toEqual([])
  })

  it('se tait sur un exercice validé : la fenêtre commence après la frontière', () => {
    const lignes = [mouvement({ id: 'm0', date: '2025-11-05' }), ...releve]
    expect(previsionnellesSansPaiement([echeance({ echeance: '2025-12-20' })], lignes, 'tresorerie', null)).toHaveLength(1)
    expect(previsionnellesSansPaiement([echeance({ echeance: '2025-12-20' })], lignes, 'tresorerie', '2025-12-31')).toEqual([])
  })
})
