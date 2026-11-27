import { beforeAll, describe, expect, it } from 'vitest'
import { candidatsCotisations, candidatsPieces } from './appariementBanque'
import { AUCUNE_PIECE_CITEE } from './facturesSources'
import { anneeDe, jourDe, moisDe } from './format'
import { horsDesNotesDeLExploitant } from './noteDeFraisEnTresorerie'
import { paiementsParLaCaisseDuDossier } from './paiementParLaCaisse'
import { propositionsDuReleve, recurrencesDuReleve, type Recurrence } from './propositionsDuReleve'
import { paiementsDesPieces, piecesPayees } from './rattachement'
import type { LigneBancaire } from './types'
import { SANS_ACOMPTE, ventesFacturees } from './ventesFacturees'
import { ANNEE, D, genererAnnee, MODELE, type AnneeDeCharge } from '../test/anneeDeCharge'

// LA TABLE DES PROPOSITIONS DU RELEVÉ REND, MOUVEMENT PAR MOUVEMENT, CE QUE LA LISTE DE L'ONGLET BANQUE CALCULAIT LIGNE À LIGNE
// (le banc de charge, 27/11/2026). L'oracle est le code de l'écran d'avant, recopié tel quel : `suggestion`,
// `suggestionCotisation` et `suggestionRecurrente` (pages/dossier/BanqueTab.tsx, au commit 5cc22692).

function suggestionRecurrenteDAvant(ligne: LigneBancaire, lignes: readonly LigneBancaire[]): Recurrence | null {
  if (ligne.statut !== 'non_rapprochee') return null
  const jourLigne = jourDe(ligne.date)
  const moisLigne = anneeDe(ligne.date) * 12 + (moisDe(ligne.date) - 1)
  const correspondances = lignes.filter((l) => {
    if (l.id === ligne.id) return false
    if (Math.abs(l.montant - ligne.montant) > 0.01) return false
    const moisL = anneeDe(l.date) * 12 + (moisDe(l.date) - 1)
    if (moisL === moisLigne) return false
    if (Math.abs(jourDe(l.date) - jourLigne) > 3) return false
    return l.prelevement_personnel || l.statut === 'ignoree'
  })
  if (correspondances.length < 2) return null
  if (correspondances.every((l) => l.prelevement_personnel)) return { action: 'virement_personnel', occurrences: correspondances.length }
  if (correspondances.every((l) => l.statut === 'ignoree' && !l.prelevement_personnel)) return { action: 'ignorer', occurrences: correspondances.length }
  return null
}

let a: AnneeDeCharge
beforeAll(() => { a = genererAnnee(1, false) })

// Le relevé de l'année du banc, où une part des mouvements est résolue (ignorée, ou virement personnel), et des séries
// mensuelles du même montant à quelques centimes près, au même jour à quelques jours près — de quoi faire parler la récurrence
// aux bornes de ses deux tolérances (0,01 € et trois jours).
function releveAvecDesResolutions(): LigneBancaire[] {
  const resolues = a.lignes.map((l, i): LigneBancaire => (i % 9 === 0 ? { ...l, statut: 'ignoree' }
    : i % 13 === 0 ? { ...l, statut: 'ignoree', prelevement_personnel: true } : l))
  const ECARTS = [0, 0.004, 0.01, 0.0101, -0.01, -0.011, 0.02, 0.1 + 0.2 - 0.3]
  const JOURS = [10, 12, 13, 14, 7, 6, 10, 11]
  const series: LigneBancaire[] = []
  for (let s = 0; s < 6; s++) {
    for (let mois = 1; mois <= 12; mois++) {
      const rang = (s * 12 + mois) % ECARTS.length
      const base = { ...a.lignes[s * 12 + mois] }
      series.push({
        ...base, id: `serie-${s}-${mois}`, date: `${ANNEE}-${String(mois).padStart(2, '0')}-${String(JOURS[rang]).padStart(2, '0')}`,
        montant: -(45 + s * 7) + ECARTS[rang],
        statut: mois % 4 === 0 ? 'non_rapprochee' : 'ignoree', prelevement_personnel: s % 3 === 1 && mois % 4 !== 0,
        piece_id: null, cotisation_id: null, categorie_id: null,
      })
    }
  }
  return [...resolues, ...series]
}

describe('les propositions de chaque mouvement du relevé', () => {
  it('la récurrence de chaque mouvement est celle du calcul ligne à ligne d’avant', () => {
    const lignes = releveAvecDesResolutions()
    const table = recurrencesDuReleve(lignes)
    const attendues = lignes.map((l) => suggestionRecurrenteDAvant(l, lignes))
    expect(lignes.map((l) => table.get(l.id) ?? null)).toEqual(attendues)
    // Le plancher : les séries font parler la récurrence, des deux sortes ; sans lui, une table vide serait « égale ».
    expect(attendues.filter((r) => r?.action === 'ignorer').length).toBeGreaterThan(5)
    expect(attendues.filter((r) => r?.action === 'virement_personnel').length).toBeGreaterThan(2)
  })

  it('la pièce, l’échéance et la récurrence de chaque mouvement à traiter sont celles des trois questions d’avant', () => {
    const lignes = releveAvecDesResolutions()
    const paiements = paiementsDesPieces(lignes, [], [], paiementsParLaCaisseDuDossier(a.caisseLue, D)!)
    const deja = piecesPayees(paiements)
    const ventes = ventesFacturees({ dossierId: D, factures: a.factures, lignes: a.lignesDeFacture, encaissements: a.encaissements, parts: a.parts, acomptes: SANS_ACOMPTE, piecesCitees: AUCUNE_PIECE_CITEE })
    const justificatifs = horsDesNotesDeLExploitant(a.pieces.filter((p) => p.statut === 'validee'), MODELE.mode)
    const cotisationsRapprochees = new Set(lignes.map((l) => l.cotisation_id).filter((id): id is string => id != null))
    // Des échéances que rien ne paie encore, chacune du montant d'un débit à traiter, à sa date : l'année du banc les a toutes
    // rapprochées.
    const debits = lignes.filter((l) => l.statut === 'non_rapprochee' && l.montant < 0).slice(0, 5)
    const cotisations = [...a.cotisations, ...debits.map((l, i) => ({
      ...a.cotisations[0], id: `cot-libre-${i}`, echeance: l.date, montant_appele: -l.montant, montant_verse: i % 2 === 0 ? -l.montant : null,
      paiement_personnel_le: null,
    }))]
    const table = propositionsDuReleve({
      lignes, justificatifs, piecesHorsRapprochement: deja, facturesSources: ventes.sources, cotisations, cotisationsRapprochees,
    })
    const rendu = lignes.map((l) => {
      const p = table.get(l.id)
      return p ? { piece: p.piece?.id ?? null, cotisation: p.cotisation?.id ?? null, recurrence: p.recurrence } : null
    })
    const attendu = lignes.map((l) => (l.statut !== 'non_rapprochee' ? null : {
      piece: candidatsPieces(l, justificatifs, deja, ventes.sources)[0]?.id ?? null,
      cotisation: candidatsCotisations(l, cotisations, cotisationsRapprochees)[0]?.id ?? null,
      recurrence: suggestionRecurrenteDAvant(l, lignes),
    }))
    expect(rendu).toEqual(attendu)
    // Le plancher : des pièces et des échéances proposées, sinon l'égalité ne prouverait rien.
    expect(attendu.filter((x) => x?.piece).length).toBeGreaterThan(50)
    expect(attendu.filter((x) => x?.cotisation).length).toBeGreaterThan(0)
  })
})
