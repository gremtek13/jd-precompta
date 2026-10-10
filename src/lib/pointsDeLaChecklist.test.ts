import { describe, expect, it } from 'vitest'
import { pointsDeLaChecklist, type ContexteDeLaChecklist, type DonneesDeLaChecklist } from './pointsDeLaChecklist'
import type { DeclarationTva, InformationsDossier, LigneBancaire } from './types'

// Les points de la Vue d'ensemble, sortis de ChecklistTab (ligne 41, étape R3) : `ChecklistTab.test.tsx` garde ce que
// l'écran en affiche, mot pour mot. Ici, ce que le module seul décide : il ne lit pas l'horloge — le premier jour du mois
// et les mois écoulés viennent de l'appelant —, et il NOMME le justificatif qu'un document attendu coche, sans en faire
// le geste.

function donnees(o: Partial<DonneesDeLaChecklist>): DonneesDeLaChecklist {
  return {
    piecesValidees: [], piecesAValider: [], cotisations: [], lignes: [], relevesIncoherents: [], doublonsTexte: [], immobilisations: [],
    natures: [], categories: [], ecritures: [], emprunts: [], ventilations: [], ventilationsPartielles: false, reglements: [],
    reglementsPartiels: false, paiementsPartiels: false, lettragesManuels: [], vehicules: [], declarationsTva: [],
    declarationsPartielles: false, facturesEmises: [], transmissions: [], jumellesPartielles: false, info: null, infoInconnue: null,
    anneesCloturees: [], ouverture: null, ouvertureIncomplete: null, ...o,
  }
}

const CONTEXTE: ContexteDeLaChecklist = {
  assujettiTva: true, periodiciteTva: 'trimestrielle', statutTva: 'redevable', modele: { mode: 'tresorerie', compteNotesDeFrais: '108000' },
  frontiere: null, anneeCourante: 2026, moisEcoules: 9, premierJourDuMois: '2026-10-01',
}

function informations(o: Partial<InformationsDossier>): InformationsDossier {
  return {
    id: 'i1', dossier_id: 'd1', vehicule_type: 'aucun', vehicule_libelle: null, jours_travailles_an: null, tickets_restaurant: false,
    justificatif_tickets_restaurant_recu: false, cheques_vacances: false, justificatif_cheques_vacances_recu: false, notes: null,
    updated_at: '2026-01-01T10:00:00Z', ...o,
  }
}

function ligne(o: Partial<LigneBancaire>): LigneBancaire {
  return {
    id: 'l', dossier_id: 'd1', date: '2026-01-15', libelle: 'MOUVEMENT FICTIF', montant: 10, statut: 'ignoree', piece_id: null,
    cotisation_id: null, categorie_id: null, taux_tva: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null,
    emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
    prelevement_personnel: false, source_fichier: 'releve.pdf', libelle_brut: 'MOUVEMENT FICTIF', id_externe: null,
    created_at: '2026-01-16T10:00:00Z', ...o,
  }
}

function declaration(o: Partial<DeclarationTva>): DeclarationTva {
  return {
    id: 'dt', dossier_id: 'd1', periode_debut: '2026-01-01', periode_fin: '2026-03-31', tva_declaree: 0, credit_anterieur: 0,
    remboursement_demande: 0, date_declaration: null, notes: null, created_at: '2026-04-10T10:00:00Z', cases: null,
    tva_collectee: null, tva_deductible: null, tva_deductible_immobilisations: null, ...o,
  }
}

describe('pointsDeLaChecklist', () => {
  it('nomme le justificatif que coche un document attendu, sans en faire le geste', () => {
    const { documentsAttendus } = pointsDeLaChecklist(
      donnees({ info: informations({ tickets_restaurant: true, cheques_vacances: true, justificatif_cheques_vacances_recu: true }) }),
      CONTEXTE,
    )
    expect(documentsAttendus.find((d) => d.id === 'tickets')).toMatchObject({ ok: false, coche: 'justificatif_tickets_restaurant_recu' })
    expect(documentsAttendus.find((d) => d.id === 'vacances')).toMatchObject({ ok: true, coche: 'justificatif_cheques_vacances_recu' })
    expect(documentsAttendus.find((d) => d.id === 'banque-2026')?.coche).toBeUndefined()
  })

  it('les périodes de TVA échues se lisent au premier jour du mois que donne l’appelant, pas à l’horloge', () => {
    // Une activité en 2026, aucune déclaration : au 1er octobre, les deux premiers trimestres sont échus ; au 1er avril,
    // aucun encore.
    const d = donnees({ lignes: [ligne({ date: '2026-01-15' })] })
    const enRetard = (premierJourDuMois: string) => pointsDeLaChecklist(d, { ...CONTEXTE, premierJourDuMois })
      .tousLesPointsATraiter.find((p) => p.id === 'periodes-tva-non-declarees')?.nb
    expect(enRetard('2026-10-01')).toBeGreaterThan(0)
    expect(enRetard('2026-04-01')).toBe(0)
    // Déclarée, la période ne se réclame plus.
    const declare = pointsDeLaChecklist(donnees({ lignes: [ligne({})], declarationsTva: [declaration({})] }), { ...CONTEXTE, premierJourDuMois: '2026-07-01' })
    expect(declare.tousLesPointsATraiter.find((p) => p.id === 'periodes-tva-non-declarees')?.nb).toBe(0)
  })

  it('les mois écoulés viennent de l’appelant : ils disent quels relevés sont attendus', () => {
    const neuf = pointsDeLaChecklist(donnees({}), CONTEXTE)
    expect(neuf.exerciceCourant.moisAttendus).toHaveLength(9)
    expect(neuf.moisManquants).toHaveLength(9)
    expect(neuf.moisRecus).toBe(0)
    const zero = pointsDeLaChecklist(donnees({}), { ...CONTEXTE, moisEcoules: 0 })
    expect(zero.exerciceCourant.moisAttendus).toEqual([])
  })

  it('ne montre que les points qui comptent quelque chose, rangés en paramétrage et en travail', () => {
    const r = pointsDeLaChecklist(donnees({ lignes: [ligne({ statut: 'non_rapprochee' })] }), { ...CONTEXTE, statutTva: null })
    expect(r.pointsATraiter.map((p) => p.id)).toEqual(expect.arrayContaining(['statut-tva', 'lignes-non-rapprochees']))
    expect(r.pointsParametrage.map((p) => p.id)).toEqual(['statut-tva'])
    expect(r.pointsTravail.map((p) => p.id)).toContain('lignes-non-rapprochees')
    expect(r.pointsATraiter.every((p) => p.nb > 0)).toBe(true)
    expect(r.tousLesPointsATraiter.length).toBeGreaterThan(r.pointsATraiter.length)
  })
})
