import { createHash } from 'node:crypto'
import { candidatsPieces, planRapprochementAutomatique } from './appariementBanque'
import { beforeAll, describe, expect, it } from 'vitest'
import { recettesDeCaisseDuDossier, recettesPourLesMoteurs } from './recettesDeCaisse'
import { concordance2035 } from './concordance2035'
import { operationsDeCaisseDuDossier, operationsPourLesControles } from './controlesDeLaCaisse'
import type { LectureDesControles } from './controlesAssuranceMaladie'
import { cotisationsComptees } from './cotisationRapprochee'
import { calculerDeclaration2035 } from './declaration2035'
import { analyserEcritures, ecrituresSansObjet, piecesAComptabiliser } from './ecritures'
import { ecrituresDesVentesPourLa2035, etatsDesVentesFacturees, mouvementsClassesParEncaissements } from './ecrituresVentesFactureesEcran'
import { AUCUNE_PIECE_CITEE } from './facturesSources'
import { CHAMPS_BNC_NON_EXPORTES } from './fec'
import { dateAParis, formatMoney } from './format'
import { INVENTAIRE_SANS_OBJET } from './inventaireDeLaValidation'
import { paiementsParLaCaisseDuDossier } from './paiementParLaCaisse'
import { partsDuReleve } from './partsDuReleve'
import { pisteAudit } from './pisteAudit'
import { pointsDeLaChecklist } from './pointsDeLaChecklist'
import { prealablesDeValidation } from './prealablesValidation'
import { paiementsDesPieces, piecesPayees } from './rattachement'
import { AUCUNE_SAISIE_2035 } from './saisies2035'
import type { EcritureBrouillon, Piece } from './types'
import { ventesDeLaChecklist } from './ventesDeLaChecklist'
import { SANS_ACOMPTE, ventesFacturees } from './ventesFacturees'
import { ANNEE, BANQUES, CATEGORIES, D, genererAnnee, LECTURE_DES_COMPTES, MODELE, PLAN, type AnneeDeCharge } from '../test/anneeDeCharge'

// LES OPTIMISATIONS DU BANC DE CHARGE RENDENT CE QUE RENDAIT LE CODE D'AVANT, À L'OCTET (27/11/2026 ; outils/charge/annee.mts,
// HISTORIQUE.md « LE BANC DE CHARGE D'UNE ANNÉE, AU NIVEAU D'AUJOURD'HUI »). Chaque calcul accéléré — `dateAParis` et
// `formatMoney` (un formateur construit une fois), `ecrituresSansObjet` et `analyserEcritures` (des index au lieu d'un
// parcours par groupe), `etatsDesVentesFacturees` (la composition indexée par source) — et les écrans qui les composent (la
// piste d'audit, la Vue d'ensemble, les préalables de la validation) sont rejoués sur l'année du banc, et leur rendu,
// sérialisé (une `Map` et un `Set` dans l'ordre de leurs entrées), comparé à l'empreinte SHA-256 relevée sur le code
// d'AVANT l'optimisation, au commit 0236b386 : l'ancien code est retiré, son rendu reste. Une empreinte qui change dit qu'un
// résultat a changé — jamais « à mettre à jour » sans comprendre lequel.

function serialiser(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) => {
    if (v instanceof Map) return { '§Map': [...v.entries()] }
    if (v instanceof Set) return { '§Set': [...v.values()] }
    if (typeof v === 'number' && !Number.isFinite(v)) return `§${String(v)}`
    if (typeof v === 'function') return '§fonction'
    return v
  })
}
const empreinte = (x: unknown) => createHash('sha256').update(serialiser(x), 'utf8').digest('hex')

// Les empreintes relevées sur le code d'avant (0236b386), l'année du banc au facteur 1.
const ATTENDUES = {
  dateAParis: '670813af5b36685258ad7e00464bf4fbc5970f6b8a7ae38be4d384413393e0c4',
  formatMoney: '808625741997319fb9c80107b597cc294edc3a03e33cf37804c7696dff8fd8a1',
  ecrituresSansObjet: 'c74014ebff6543ae13a9b3aa5fe82da18325dc8b57a97fc6f6d7c7013697663e',
  analyserEcritures: '98d30e2c7eac84a24d5c328e762d399958203915b692d63198cc4d1ba44f83fc',
  etatsDesVentes: '07fc39503233f4f5dcb9603c3fb1f5b2adf7a409ae94cd35d5f82a615efaa937',
  etatsDesVentesAEcrire: 'a4a35fab5ea391d739d7d48aeb9f7d25b82e3419f9fb19e97bb435f92f8766d2',
  etatsDesVentesAReecrire: '7b9840c13e4e5ca4bfd04feb893a9438d5a7b6754cacf411e0d424aa3168fc5b',
  pisteAudit: '629321b5415bedec0a78effe734048514430fe6b6fe347deddc433ed6fc197a5',
  checklist: '393a216b30f6989e4652bbb91d5eef7b605a0dc263007fc1dad68926fa7f2ff5',
  prealables: '75e5e77afe295b80eb4fac969d6d4efe07bce7ae5b0112bc1cedc48250984c16',
  candidatsPieces: 'd17f190725fcb77be61dafac808fca9fc272f2b5194e1b20c1a401603b3de081',
  planAutomatique: '7848021bda2a831f466150029dd79a722cf5a34507448199ffbdf3de56bd0227',
  planAutomatiqueAuxBornes: '3be50ab0b345db476dcaf0a25522607f4548c28050f2582f96d0be1b9a5a04d0',
}

let a: AnneeDeCharge
beforeAll(() => { a = genererAnnee(1, false) })

const VALEURS = [0, -0, 0.005, 0.015, 1, -1, 12.34, -12.345, 999.995, 1234.5, -98765.43, 1e9 + 0.01, 0.1 + 0.2, Number.NaN, null]
// Des instants autour des changements d'heure de Paris, du Nouvel An et de minuit UTC.
const INSTANTS = [
  '2026-01-01T00:00:00Z', '2025-12-31T22:59:59Z', '2025-12-31T23:00:00Z', '2026-03-29T00:59:59Z', '2026-03-29T01:00:00Z',
  '2026-10-25T00:59:59Z', '2026-10-25T01:00:00Z', '2026-06-30T21:59:59.999Z', '2026-06-30T22:00:00Z', '2026-12-31T23:30:00+00:00',
  '2026-07-14T12:00:00+02:00', '2024-02-29T23:00:00Z', '2026-05-01',
]

describe('les optimisations du banc de charge rendent le rendu d\'avant', () => {
  it('relève les empreintes', () => {
    // Comparées une à une : l'écart nomme le calcul qui a changé.
    expect(releve()).toEqual(ATTENDUES)
  })
})

function releve(): Record<keyof typeof ATTENDUES, string> {
  const brouillon = a.brouillon
  const libres = a.lignes.filter((l) => l.statut === 'non_rapprochee')
  // Aux bornes de la tolérance du montant : pour chaque mouvement, des pièces à quelques centimes près, dans les deux sens,
  // et une sans montant — ce que l'index du lot doit trouver, ou écarter, comme le parcours d'hier.
  const ECARTS = [-0.03, -0.021, -0.02, -0.011, -0.01, -0.005, 0, 0.004, 0.01, 0.0101, 0.015, 0.02, 0.025]
  const piecesAuxBornes: Piece[] = libres.slice(0, 200).flatMap((l, i) => ECARTS.map((d, j) => ({
    ...a.pieces[(i * 13 + j) % a.pieces.length], id: `borne-${i}-${j}`, date_piece: l.date, facture_id: null,
    montant_ttc: j === 6 && i % 7 === 0 ? null : (j % 2 === 0 ? 1 : -1) * Math.round((Math.abs(l.montant) + d) * 1000) / 1000,
  })))
  const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(a.caisseLue, D)!
  const paiements = paiementsDesPieces(a.lignes, [], [], paiementsDeLaCaisse)
  const ventes = ventesFacturees({ dossierId: D, factures: a.factures, lignes: a.lignesDeFacture, encaissements: a.encaissements, parts: a.parts, acomptes: SANS_ACOMPTE, piecesCitees: AUCUNE_PIECE_CITEE })
  const aComptabiliser = piecesAComptabiliser(a.pieces, CATEGORIES, new Map(), ventes.sources)
  const operationsDeCaisse = operationsPourLesControles(operationsDeCaisseDuDossier(a.caisseLue, D))!
  const etats = (b: readonly EcritureBrouillon[], anneesValidees: number[]) => etatsDesVentesFacturees({
    sources: a.sourcesEcritures, brouillon: b, mode: MODELE.mode, plan: PLAN, banques: BANQUES, anneesValidees, ventesParLesFactures: true,
  })
  // Sans les écritures des ventes : chaque source « à écrire », ses refus jugés.
  const sansLesVentes = brouillon.filter((b) => b.facture_id == null && b.encaissement_id == null && !(b.ligne_bancaire_id && a.lignes.find((l) => l.id === b.ligne_bancaire_id)?.encaissements_de_factures))
  // Une ligne sur trois des écritures d'encaissement déplacée d'un jour : « à réécrire ».
  let n = 0
  const decales = brouillon.map((b) => (b.encaissement_id != null && n++ % 3 === 0 ? { ...b, date: b.date === `${ANNEE}-12-31` ? b.date : `${b.date.slice(0, 8)}${String(Math.min(28, Number(b.date.slice(8)) + 1)).padStart(2, '0')}` } : b))

  const recettesDeCaisse = recettesPourLesMoteurs(recettesDeCaisseDuDossier(a.caisseLue, D, CATEGORIES, false))!
  const parts = partsDuReleve(a.lignes, CATEGORIES, [], false)
  const comptees = cotisationsComptees(a.cotisations, a.lignes, MODELE.mode)
  const pourLa2035 = ecrituresDesVentesPourLa2035({
    dossierId: D, ventesParLesFactures: true, facturesSources: ventes.sources, lecture: { dossierId: D, etat: 'lue', sources: a.sourcesEcritures },
    mode: MODELE.mode, plan: PLAN, banques: BANQUES,
  })
  if (pourLa2035.etat !== 'pret') throw new Error(pourLa2035.etat)
  const declaration = calculerDeclaration2035(ANNEE, a.pieces, CATEGORIES, a.immobilisations, comptees, [], false, paiements, parts, [], PLAN, ventes, pourLa2035.ecritures, recettesDeCaisse, a.libres)
  const concordance = concordance2035(declaration, brouillon, {
    piecesValidees: new Set(a.pieces.map((p) => p.id)), piecesImmobilisees: new Set(a.immobilisations.map((i) => i.piece_id ?? '')),
    mouvementsDesVentesFacturees: mouvementsClassesParEncaissements(a.lignes),
  }, null)
  const lectureDuReleve = { dossierId: D, etat: 'lue' as const, sources: a.sourcesEcritures }
  const luControles: LectureDesControles = {
    etat: 'lus', imports: { lignes: a.importsAm, complete: true, motif: null },
    paiements: { lignes: a.paiementsAm, complete: true, motif: null }, associations: { lignes: a.associationsAm, complete: true, motif: null },
  }
  const facturesEmises = a.factures.map((f) => ({ ...f, emetteur_siret: null, superpdp_invoice_id: null }))

  return {
    dateAParis: empreinte([...INSTANTS, ...a.pieces.map((p) => p.created_at), ...a.encaissements.map((e) => e.cree_le)].map((i) => dateAParis(i))),
    formatMoney: empreinte(VALEURS.map((v) => formatMoney(v))),
    ecrituresSansObjet: empreinte([
      ecrituresSansObjet(brouillon, a.pieces, CATEGORIES, new Map(), null, PLAN, ventes.sources),
      // Une catégorie sans compte, et des pièces retirées du jeu fourni : les motifs et l'artefact de filtrage.
      ecrituresSansObjet(brouillon, a.pieces.slice(200), CATEGORIES.map((c) => (c.code === 'fournitures' ? { ...c, compte_comptable: null } : c)), new Map(), `${ANNEE}-03-31`, PLAN, ventes.sources),
    ]),
    analyserEcritures: empreinte([
      analyserEcritures(brouillon, aComptabiliser, false, paiements, MODELE, null, new Set(), BANQUES),
      analyserEcritures(decales, aComptabiliser.slice(100), false, paiements, MODELE, `${ANNEE}-02-28`, new Set([a.pieces[7].id]), BANQUES),
    ]),
    etatsDesVentes: empreinte(etats(brouillon, [])),
    etatsDesVentesAEcrire: empreinte(etats(sansLesVentes, [])),
    etatsDesVentesAReecrire: empreinte([etats(decales, []), etats(decales, [ANNEE - 1])]),
    pisteAudit: empreinte(pisteAudit(brouillon, a.pieces, a.lignes, [], {
      immobilisations: a.immobilisations, factures: a.pieces, vehicules: [], caisse: operationsDeCaisse, plan: PLAN, banques: BANQUES,
      ventes: { ecritures: a.compositionDesVentes, factures: a.factures, encaissements: a.encaissements, exemplaires: [], transmissions: [], piecesCitees: AUCUNE_PIECE_CITEE },
      ecrituresLibres: a.libres,
    })),
    checklist: empreinte(pointsDeLaChecklist({
      notesDeFrais: { etat: 'sans_objet' as const },
      piecesValidees: a.pieces, piecesAValider: [], cotisations: a.cotisations, lignes: a.lignes, relevesIncoherents: [], controlesReleves: a.controles,
      comptesBancaires: LECTURE_DES_COMPTES, doublonsTexte: [],
      immobilisations: a.immobilisations, natures: [], categories: CATEGORIES, ecritures: brouillon, emprunts: [], ventilations: [],
      ventilationsPartielles: false, reglements: [], reglementsPartiels: false, paiementsPartiels: false, lettragesManuels: [], vehicules: [],
      declarationsTva: [], declarationsPartielles: false, facturesEmises, transmissions: [], jumellesPartielles: false,
      facturesSources: ventes.sources, info: null, infoInconnue: null, anneesCloturees: [], ouverture: null, ouvertureIncomplete: null,
      aNouveaux: [], soldesReportes: [], entreesDeLOuvertureIncompletes: null, ventesFacturees: lectureDuReleve, caisse: a.caisseLue,
      entreesDeLaCaisseIncompletes: null, entreesDeLaRepriseDesBiensIncompletes: null, inventaire: { etat: 'sans_objet' },
      assuranceMaladie: { lu: luControles, releveComplet: true },
    }, {
      assujettiTva: false, periodiciteTva: 'mensuelle', statutTva: null, modele: MODELE, frontiere: null, anneesValidees: [],
      aujourdHui: `${ANNEE}-12-31`, anneeCourante: ANNEE, moisEcoules: 11, premierJourDuMois: `${ANNEE}-12-01`,
      offreAssuranceMaladie: { codeNaf: '86.22C', moduleOuvert: true },
    })),
    candidatsPieces: empreinte(libres.map((l) => candidatsPieces(l, a.pieces, piecesPayees(paiements), ventes.sources).map((p) => p.id))),
    planAutomatique: empreinte(planRapprochementAutomatique(libres, a.pieces, a.cotisations, {
      pieces: piecesPayees(paiements), cotisations: new Set(a.lignes.map((l) => l.cotisation_id).filter((id): id is string => id != null)),
    }, new Map([[libres[3].id, 'réservé']]), ventes.sources)),
    planAutomatiqueAuxBornes: empreinte([
      planRapprochementAutomatique(libres.slice(0, 200), piecesAuxBornes, [], { pieces: new Set(), cotisations: new Set() }, new Map(), new Set()),
      planRapprochementAutomatique(libres.slice(0, 200), piecesAuxBornes, [], { pieces: new Set(piecesAuxBornes.filter((_, i) => i % 5 === 0).map((p) => p.id)), cotisations: new Set() }, new Map(), new Set(), 0),
      libres.slice(0, 200).map((l) => candidatsPieces(l, piecesAuxBornes, new Set(), new Set()).map((p) => p.id)),
    ]),
    prealables: empreinte(prealablesDeValidation({
      notesDeFrais: { etat: 'sans_objet' as const },
      annee: ANNEE, anneeCourante: ANNEE + 1, aujourdHui: `${ANNEE + 1}-01-15`, modele: MODELE, assujettiTva: false, anneesValidees: [],
      lectureIncomplete: null, ecrituresLibres: a.libres, piecesValidees: a.pieces, piecesAValider: [], categories: CATEGORIES, immobilisations: a.immobilisations,
      natures: [], ecritures: brouillon, lignes: a.lignes, ventilations: [], reglements: [], encaissees: [], cotisations: a.cotisations,
      vehicules: [], emprunts: [], aNouveaux: [], soldesReportes: [], declarationsTva: [], periodiciteTva: 'mensuelle',
      controlesReleves: a.controles, comptesBancaires: LECTURE_DES_COMPTES, doublonsTexte: [], facturesEmises, transmissions: [], facturesSources: ventes.sources, piecesCitees: ventes.piecesCitees,
      etatsDesVentes: etats(brouillon, []),
      ventesDeLaChecklist: ventesDeLaChecklist(lectureDuReleve, null), operationsDeCaisse, champsBnc: CHAMPS_BNC_NON_EXPORTES,
      declaration, saisies2035: AUCUNE_SAISIE_2035, inventaire: INVENTAIRE_SANS_OBJET, concordance,
    })),
  }
}
