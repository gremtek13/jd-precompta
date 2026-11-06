import { describe, expect, it, vi } from 'vitest'
// `grouperDoublonsDeTexte` vit à côté de sa lecture, qui importe le client : le module des doublons probables, lui, est pur.
vi.mock('./supabase', () => ({ supabase: {} }))
import { calculerDeclaration2035 } from './declaration2035'
import { paiementsDesPieces } from './rattachement'
import { partsDuReleve } from './partsDuReleve'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { ventesFactureesVides } from '../test/ventesFacturees'
import { grouperDoublonsDeTexte } from './doublonsTexte'
import { moisEnDoubleSurAbonnement } from './controles'
import {
  detailDesDoublonsProbables, doublonsProbables, ECART_MAXIMAL_EN_JOURS, phraseDuDoublon, piecesRegleesPourLesDoublons,
} from './doublonsProbables'
import { tirage } from '../test/encaissementsBatterie'
import type { Categorie, LigneBancaire, Piece } from './types'

// LE DOUBLON PROBABLE (relecture du 04/11/2026, D1 ; PIECES-Q2, sur la recommandation). Les scénarios de la relecture
// (`outils/relecture-pieces/doublons.scenarios.test.ts`), changés en gardes du comportement corrigé : la même dépense entrée
// deux fois — le PDF du fournisseur et la photo du praticien, deux fichiers, deux textes lus — compte toujours deux fois dans
// la 2035 tant que le cabinet n'a pas supprimé la pièce en trop, mais elle se DIT désormais, par une seule règle. Un BNC en
// trésorerie, exonéré (montant retenu : le TTC). Données FICTIVES.

const piece = (o: Partial<Piece> & Pick<Piece, 'id'>): Piece => ({
  dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: `d1/${o.id}.pdf`, nom_fichier: `${o.id}.pdf`, storage_hash: null,
  date_piece: '2025-03-14', tiers: 'MEDICAL PLUS', montant_ht: null, montant_tva: null, montant_ttc: 86.4, devise: 'EUR',
  montant_devise: null, taux_change: null, conversion_source: null, categorie_id: 'c-pm', sous_dossier_id: null, type_piece: 'achat',
  statut: 'validee', confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
  identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
  vente_hors_des_factures: false, created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z', ...o,
})
const mvt = (o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire => ({
  dossier_id: 'd1', date: '2025-03-15', libelle: 'CB MEDICAL PLUS', montant: -86.4, statut: 'rapprochee', piece_id: null,
  cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-11-18T09:00:00Z', encaissements_de_factures: false, ...o,
})
const PETIT_MATERIEL: Categorie = {
  id: 'c-pm', dossier_id: null, code: 'pm', libelle: 'Petit matériel', ordre: 1, compte_comptable: '606300', poste_2035: 'Petit outillage',
}
const reglees = (lignes: LigneBancaire[]) => piecesRegleesPourLesDoublons(paiementsDesPieces(lignes, [], [], []))
const ids = (r: ReturnType<typeof doublonsProbables>) => r.paires.map((p) => [p.a.id, p.b.id])

describe('D1 — le PDF du fournisseur et la photo du praticien : le même achat, entré deux fois', () => {
  // Le PDF reçu par e-mail (déposé par le cabinet) et la photo du même document (déposée par le praticien), un jour plus tard.
  const pdf = piece({ id: 'p-pdf', nom_fichier: 'facture-2025-031.pdf' })
  const photo = piece({ id: 'p-photo', nom_fichier: 'IMG_3001.jpg', tiers: 'Medical Plus SARL', date_piece: '2025-03-15', statut: 'a_valider' })

  it('aucun des contrôles d’hier ne les rapproche ; le doublon probable, si', () => {
    expect(grouperDoublonsDeTexte([
      { pieceId: 'p-pdf', documentId: null, empreinte: 'md5-du-pdf' },
      { pieceId: 'p-photo', documentId: null, empreinte: 'md5-de-la-photo' },
    ])).toEqual([])
    expect(moisEnDoubleSurAbonnement([pdf, photo])).toEqual([])
    const r = doublonsProbables([pdf, photo], false, reglees([]))
    expect(r.paires).toEqual([{ a: pdf, b: photo, montant: 86.4, jours: 1, fournisseurLu: true }])
    // Chacune nomme l'autre.
    expect(r.parPiece.get('p-pdf')).toEqual([photo])
    expect(r.parPiece.get('p-photo')).toEqual([pdf])
  })

  it('la photo rapprochée, le PDF compté « à sa date de facture » : la 2035 compte 172,80 €, et la paire se dit', () => {
    const lignes = [mvt({ id: 'm1', piece_id: 'p-photo' })]
    const validees = [pdf, { ...photo, statut: 'validee' as const }]
    const d = calculerDeclaration2035(2025, validees, [PETIT_MATERIEL], [], [], [], false,
      paiementsDesPieces(lignes, [], [], []), partsDuReleve(lignes, [PETIT_MATERIEL], [], false), [], PLAN_PAR_DEFAUT,
      ventesFactureesVides('d1'), { etat: 'sans_bascule' }, CAISSE_ABSENTE)
    expect(d.depenses.find((l) => l.poste === 'Petit outillage')?.montant).toBe(172.8)
    expect(d.sansPaiementConnu.map((s) => s.piece.id)).toEqual(['p-pdf'])
    // Ce que la carte de Clôture marque : la pièce sans paiement est l'une des deux.
    const r = doublonsProbables(validees, false, reglees(lignes))
    expect(r.parPiece.get('p-pdf')?.map((p) => p.id)).toEqual(['p-photo'])
  })

  it('témoin : deux achats payés chacun par son débit se taisent — la banque prouve deux sorties d’argent', () => {
    const lignes = [mvt({ id: 'm1', piece_id: 'p-pdf' }), mvt({ id: 'm2', piece_id: 'p-photo', date: '2025-03-16' })]
    expect(doublonsProbables([pdf, photo], false, reglees(lignes)).paires).toEqual([])
    // Les paiements pas lus en entier : aucune pièce ne se dit payée, le signal en dit plus.
    expect(ids(doublonsProbables([pdf, photo], false, null))).toEqual([['p-pdf', 'p-photo']])
  })

  it('un paiement défait par son rejet ne règle rien', () => {
    const lignes = [
      mvt({ id: 'm1', piece_id: 'p-pdf' }), mvt({ id: 'm2', piece_id: 'p-photo' }),
      mvt({ id: 'm3', piece_id: 'p-photo', montant: 86.4, date: '2025-03-20' }),
    ]
    expect(ids(doublonsProbables([pdf, photo], false, reglees(lignes)))).toEqual([['p-pdf', 'p-photo']])
  })
})

describe('la règle : même sens de dépense, même montant retenu au centime, sept jours, même clé de fournisseur', () => {
  const a = piece({ id: 'a', date_piece: '2025-05-02' })

  it('les bornes : sept jours oui, huit non ; un centime d’écart non', () => {
    expect(ECART_MAXIMAL_EN_JOURS).toBe(7)
    expect(ids(doublonsProbables([a, piece({ id: 'b', date_piece: '2025-05-09' })], false, null))).toEqual([['a', 'b']])
    expect(doublonsProbables([a, piece({ id: 'b', date_piece: '2025-05-10' })], false, null).paires).toEqual([])
    expect(doublonsProbables([a, piece({ id: 'b', montant_ttc: 86.41, date_piece: '2025-05-02' })], false, null).paires).toEqual([])
    // Par-dessus la fin du mois et de l'année : des jours civils, sans fuseau.
    expect(ids(doublonsProbables([piece({ id: 'x', date_piece: '2025-12-29' }), piece({ id: 'y', date_piece: '2026-01-02' })], false, null)))
      .toEqual([['x', 'y']])
  })

  it('la clé d’identité, mot à mot : deux fournisseurs lus et différents ne se rapprochent jamais, une sous-chaîne non plus', () => {
    expect(doublonsProbables([a, piece({ id: 'b', tiers: 'PHARMACIE DU PORT', date_piece: '2025-05-02' })], false, null).paires).toEqual([])
    // « MEDICALE » n'est pas « MEDICAL » : la clé est un mot entier.
    expect(doublonsProbables([a, piece({ id: 'b', tiers: 'MEDICALE SERVICES', date_piece: '2025-05-02' })], false, null).paires).toEqual([])
  })

  it('un fournisseur illisible se rapproche de tout, et la paire le dit', () => {
    const r = doublonsProbables([a, piece({ id: 'b', tiers: null, date_piece: '2025-05-02' })], false, null)
    expect(r.paires.map((p) => p.fournisseurLu)).toEqual([false])
    expect(doublonsProbables([piece({ id: 'x', tiers: 'SARL' }), piece({ id: 'y', tiers: '' })], false, null).paires).toHaveLength(1)
  })

  it('le montant retenu : le HT d’un assujetti, le TTC d’un exonéré', () => {
    const x = piece({ id: 'x', montant_ht: 72, montant_tva: 14.4, montant_ttc: 86.4 })
    const y = piece({ id: 'y', montant_ht: 72, montant_tva: 14.4, montant_ttc: null })
    expect(ids(doublonsProbables([x, y], true, null))).toEqual([['x', 'y']])
    expect(ids(doublonsProbables([x, y], false, null))).toEqual([['x', 'y']])
    expect(doublonsProbables([x, piece({ id: 'z', montant_ht: 72, montant_tva: 14.4, montant_ttc: 90 })], false, null).paires).toEqual([])
  })

  it('écarte la vente, la pièce sans date, sans montant ou à zéro ; une note de frais double un achat', () => {
    expect(doublonsProbables([piece({ id: 'v', type_piece: 'vente' }), piece({ id: 'w', type_piece: 'vente' })], false, null).paires).toEqual([])
    expect(doublonsProbables([a, piece({ id: 'b', date_piece: null })], false, null).paires).toEqual([])
    expect(doublonsProbables([piece({ id: 'x', montant_ttc: null }), piece({ id: 'y', montant_ttc: null })], false, null).paires).toEqual([])
    expect(doublonsProbables([piece({ id: 'x', montant_ttc: 0 }), piece({ id: 'y', montant_ttc: 0 })], false, null).paires).toEqual([])
    expect(ids(doublonsProbables([a, piece({ id: 'b', type_piece: 'note_frais', date_piece: '2025-05-04' })], false, null))).toEqual([['a', 'b']])
  })

  it('trois exemplaires : trois paires, chacune nommant les deux autres', () => {
    const r = doublonsProbables([a, piece({ id: 'b', date_piece: '2025-05-02' }), piece({ id: 'c', date_piece: '2025-05-03' })], false, null)
    expect(ids(r)).toEqual([['a', 'b'], ['a', 'c'], ['b', 'c']])
    expect(r.parPiece.get('b')?.map((p) => p.id)).toEqual(['a', 'c'])
  })
})

describe('ce que les écrans disent', () => {
  it('la phrase nomme l’autre pièce, son fournisseur, sa date et son montant, et le geste', () => {
    const phrase = phraseDuDoublon([piece({ id: 'b', nom_fichier: 'IMG_3001.jpg' })], false).replace(/\s/g, ' ')
    expect(phrase).toMatch(/^Doublon probable de « IMG_3001\.jpg » \(MEDICAL PLUS, 14\/03\/2025, 86,40 €\)/)
    expect(phrase).toContain('supprime la pièce en trop')
    expect(phraseDuDoublon([piece({ id: 'b', tiers: null })], false)).toContain('fournisseur non lu')
  })

  it('le détail du point nomme les cinq premières paires, et compte le reste', () => {
    const pieces = Array.from({ length: 7 }, (_, i) => [
      piece({ id: `x${i}`, montant_ttc: 10 + i }), piece({ id: `y${i}`, montant_ttc: 10 + i, tiers: null }),
    ]).flat()
    const detail = detailDesDoublonsProbables(doublonsProbables(pieces, false, null).paires) ?? ''
    expect(detail.match(/ et « /g)).toHaveLength(5)
    expect(detail).toContain('et 2 autre(s)')
    expect(detail).toContain('fournisseur non lu sur l’une')
    expect(detailDesDoublonsProbables([])).toBeUndefined()
  })
})

describe('la tenue à 500 pièces', () => {
  it('se calcule en quelques millisecondes, sans quadratique, sur un dossier fictif d’un an', () => {
    const t = tirage(20261104)
    const fournisseurs = ['PHARMACIE DU PORT', 'MEDICAL PLUS', 'ORANGE', 'TOTAL ENERGIES', 'AMAZON', 'LA POSTE', 'CARPIMKO', null]
    const pieces = Array.from({ length: 500 }, (_, i) => piece({
      id: `p${String(i).padStart(3, '0')}`,
      date_piece: `2025-${String(1 + Math.floor(t() * 12)).padStart(2, '0')}-${String(1 + Math.floor(t() * 28)).padStart(2, '0')}`,
      tiers: fournisseurs[Math.floor(t() * fournisseurs.length)],
      // Des montants qui se répètent (abonnements, petites fournitures) : le pire cas d'un rang.
      montant_ttc: t() < 0.3 ? [9.99, 19.9, 38.4][Math.floor(t() * 3)] : Math.round(t() * 50_000) / 100,
    }))
    const reglees = new Set(pieces.filter(() => t() < 0.6).map((p) => p.id))
    doublonsProbables(pieces, false, reglees)
    const debut = performance.now()
    for (let i = 0; i < 20; i++) doublonsProbables(pieces, false, reglees)
    const parCalcul = (performance.now() - debut) / 20
    console.log(`[tenue] doublonsProbables × 500 pièces : ${parCalcul.toFixed(2)} ms`)
    // Une borne large : la mesure dit l'ordre de grandeur (quelques millisecondes), la borne n'attrape qu'un quadratique.
    expect(parCalcul).toBeLessThan(50)
  })
})
