// L'ANNÉE DU BANC DE CHARGE (outils/charge/annee.mts) — une année FICTIVE à l'échelle d'un praticien de santé en BNC, tirée
// d'une graine fixe (mulberry32), sans aucun nom réel : « Fournisseur 17 », « Client 4 ». Le banc la mesure ; les tests
// d'égalité des optimisations (chargeEmpreintes.test.ts) la rejouent, pour qu'un calcul accéléré rende, sur elle, à l'octet
// près ce que rendait le calcul d'avant.
//
// Volumes de l'année N (le 27/11/2026, au niveau de l'application d'aujourd'hui) : 1 500 pièces (85 % de dépenses), 3 000
// mouvements sur DEUX comptes bancaires (le principal au 512 du rôle, un second à son 512 propre depuis le 1er janvier ;
// `COMPTES_BANCAIRES_PREVUS` levé), dont 2 250 classés (pièces, cotisations, encaissements de factures, catégories, crédits de
// l'assurance maladie) ; 300 factures sources et leurs encaissements (dossier basculé) ; une caisse tenue 250 jours ; 100
// journées comptables de l'assurance maladie importées (une part obligatoire chaque jour, une complémentaire un jour sur
// deux), 95 associées à leur crédit ; le facturé de 100 lots ; 8 écritures libres ; 12 règles d'affectation ; un relevé
// contrôlé par mois et par compte. Le brouillon est COMPOSÉ par les moteurs de l'application, jamais inventé ligne à ligne.
// Au facteur `k`, tout ce qui croît avec l'activité est multiplié ; la caisse et les journées restent au plus d'une par jour.

import { ecritureDuMouvement } from '../lib/affectationBanque'
import { banquesDuDossier, planDuMouvement, type BanquesDuDossier } from '../lib/banqueDuMouvement'
import { ecritureDeLOperation } from '../lib/caisse'
import { ecritureDeLaCotisation } from '../lib/cotisationRapprochee'
import { ecrituresAGenerer, piecesAComptabiliser } from '../lib/ecritures'
import type { EcritureLibreDesExports, EcrituresLibresDesExports } from '../lib/ecrituresLibresDesExports'
import { ecrituresDesVentesFacturees, lignesAuBrouillon, type EcritureVenteFacturee } from '../lib/ecrituresVentesFacturees'
import type { EncaissementDesEcritures, FactureDesEcritures, SourcesDesEcrituresDeVente } from '../lib/ecrituresVentesFactureesEcran'
import type { LigneDeFacture } from '../lib/encaissementsFactures'
import { AUCUNE_PIECE_CITEE } from '../lib/facturesSources'
import type { LectureDesComptes } from '../lib/importParCompte'
import { paiementsParLaCaisseDuDossier } from '../lib/paiementParLaCaisse'
import { paiementsDesPieces } from '../lib/rattachement'
import type { CaisseLue } from '../lib/recettesDeCaisse'
import type { AssociationAssuranceMaladie } from '../lib/rapprochementAssuranceMaladie'
import type {
  Categorie, ControleReleveBancaire, CotisationDeclaree, EcritureBrouillon, FactureAssuranceMaladie, Immobilisation,
  ImportAssuranceMaladie, ImportFacturesAssuranceMaladie, LigneBancaire, OperationCaisse, PaiementAssuranceMaladie, Piece,
  RegleAffectationBancaire,
} from '../lib/types'
import { SANS_ACOMPTE, ventesFacturees, type PartVendue } from '../lib/ventesFacturees'
import { NON_VALIDEE } from './ecritures'
import { modeleDeTest } from './modeles'
import { factureVendue } from './ventesFacturees'

export const D = 'd-charge'
export const ANNEE = 2026
export const MODELE = modeleDeTest('tresorerie')
export const PLAN = MODELE.plan

// ── Les deux comptes bancaires (MCB) ─────────────────────────────────────────────────────────────────────────────────
export const COMPTE_PRINCIPAL = 'cb-principal'
export const COMPTE_SECOND = 'cb-second'
export const LECTURE_DES_COMPTES: LectureDesComptes = {
  etat: 'lus',
  comptes: [
    { id: COMPTE_PRINCIPAL, libelle: 'Compte professionnel', principal: true, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null },
    { id: COMPTE_SECOND, libelle: 'Compte des remboursements', principal: false, fin_d_identifiant: null, compte: '512200', compte_propre_depuis: `${ANNEE}-01-01`, ouvert_le: `${ANNEE}-01-01`, clos_le: null },
  ],
}
export const BANQUES: BanquesDuDossier = banquesDuDossier(LECTURE_DES_COMPTES, PLAN)

// ── Le tirage, d'une graine fixe ─────────────────────────────────────────────────────────────────────────────────────
function mulberry32(graine: number): () => number {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const deux = (n: number) => String(n).padStart(2, '0')
const centimes = (x: number) => Math.round(x * 100) / 100
const uuid = (genre: number, n: number) => `00000000-0000-4000-8${deux(genre % 100).padStart(3, '0')}-${String(n).padStart(12, '0')}`

export function jourDeLAnnee(rang: number): string {
  const d = new Date(Date.UTC(ANNEE, 0, 1 + rang))
  return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`
}
const rangDuJour = (date: string) => (Date.parse(`${date}T00:00:00Z`) - Date.UTC(ANNEE, 0, 1)) / 86_400_000

// ── Les catégories, neutres ──────────────────────────────────────────────────────────────────────────────────────────
export const CATEGORIES: Categorie[] = [
  ['achats', 'Achats', '606100', 'Achats'],
  ['fournitures', 'Fournitures de bureau', '606400', 'Fournitures de bureau'],
  ['loyers', 'Loyers', '613200', 'Loyers et charges locatives'],
  ['honoraires', 'Honoraires', '622600', 'Honoraires ne constituant pas des rétrocessions'],
  ['telecom', 'Télécommunications', '626000', 'Frais postaux et de télécommunications'],
  ['frais_fin', 'Frais bancaires', '627000', 'Frais financiers'],
  ['divers', 'Divers', '618000', 'Autres frais divers de gestion'],
  ['recettes', 'Recettes', '706000', 'Recettes'],
].map(([code, libelle, compte, poste], i): Categorie => ({
  id: `cat-${code}`, dossier_id: null, code, libelle, ordre: i, compte_comptable: compte, poste_2035: poste,
}))
const DEPENSES = CATEGORIES.filter((c) => c.code !== 'recettes')
export const RECETTES = CATEGORIES.find((c) => c.code === 'recettes')!
const FRAIS = CATEGORIES.find((c) => c.code === 'frais_fin')!

// ── L'année ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface AnneeDeCharge {
  pieces: Piece[]
  lignes: LigneBancaire[]
  controles: ControleReleveBancaire[]
  cotisations: CotisationDeclaree[]
  immobilisations: Immobilisation[]
  operations: OperationCaisse[]
  factures: FactureDesEcritures[]
  lignesDeFacture: LigneDeFacture[]
  encaissements: EncaissementDesEcritures[]
  parts: PartVendue[]
  regles: RegleAffectationBancaire[]
  importsAm: ImportAssuranceMaladie[]
  paiementsAm: PaiementAssuranceMaladie[]
  associationsAm: AssociationAssuranceMaladie[]
  importsFactureAm: ImportFacturesAssuranceMaladie[]
  facturesAm: FactureAssuranceMaladie[]
  ecrituresLibres: EcritureLibreDesExports[]
  /** Le brouillon, composé par les moteurs. */
  brouillon: EcritureBrouillon[]
  caisseLue: CaisseLue
  sourcesEcritures: SourcesDesEcrituresDeVente
  compositionDesVentes: readonly EcritureVenteFacturee[]
  libres: EcrituresLibresDesExports
}

function piece(o: Partial<Piece> & Pick<Piece, 'id'>): Piece {
  return {
    dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/${o.id}.pdf`, nom_fichier: 'piece.pdf', storage_hash: null,
    date_piece: `${ANNEE}-01-01`, tiers: null, montant_ht: 0, montant_tva: 0, montant_ttc: 0, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false, updated_at: `${ANNEE}-01-01T10:00:00Z`,
    created_at: `${ANNEE}-01-01T10:00:00Z`, ...o,
  }
}

function mouvement(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id' | 'compte_bancaire_id'>): LigneBancaire {
  return {
    dossier_id: D, date: `${ANNEE}-01-01`, libelle: 'OPERATION', montant: 0,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
    compte_bilan: null, declaration_tva_id: null, id_externe: null, source_fichier: 'releve.csv', libelle_brut: null,
    created_at: `${ANNEE}-12-31T10:00:00Z`, encaissements_de_factures: false, ...o,
  }
}

export function genererAnnee(k: number, assujetti: boolean): AnneeDeCharge {
  const hasard = mulberry32(20261127 + Math.round(k * 10))
  const entre = (a: number, b: number) => a + Math.floor(hasard() * (b - a + 1))
  const montant = (a: number, b: number) => centimes(a + hasard() * (b - a))
  const nb = (n: number) => Math.round(n * k)
  // Un mouvement sur quatre au second compte.
  const compte = () => (hasard() < 0.25 ? COMPTE_SECOND : COMPTE_PRINCIPAL)

  const pieces: Piece[] = []
  for (let i = 0; i < nb(1500); i++) {
    const vente = i % 20 < 3 // 15 %
    const ttc = vente ? montant(40, 900) : montant(5, 1500)
    const taux = assujetti ? 0.2 : 0
    const ht = centimes(ttc / (1 + taux))
    const categorie = vente ? RECETTES : DEPENSES[entre(0, DEPENSES.length - 1)]
    pieces.push(piece({
      id: uuid(1, i), date_piece: jourDeLAnnee(entre(0, 360)), tiers: vente ? `Client ${entre(1, 200 * k)}` : `Fournisseur ${entre(1, 300 * k)}`,
      montant_ttc: ttc, montant_ht: ht, montant_tva: centimes(ttc - ht), categorie_id: categorie.id, type_piece: vente ? 'vente' : 'achat',
    }))
  }

  const lignes: LigneBancaire[] = []
  let n = 0
  const depenses = pieces.filter((p) => p.type_piece === 'achat')
  const parCaisse = new Set(depenses.slice(0, nb(50)).map((p) => p.id)) // les sorties de caisse qui paient une dépense
  const payees = pieces.filter((p) => !parCaisse.has(p.id)).slice(0, nb(1350))
  for (const p of payees) {
    const signe = p.type_piece === 'vente' ? 1 : -1
    const jour = Math.min(364, entre(0, 6) + rangDuJour(p.date_piece ?? `${ANNEE}-01-01`))
    lignes.push(mouvement({
      id: uuid(2, n++), compte_bancaire_id: compte(), date: jourDeLAnnee(jour), montant: signe * (p.montant_ttc ?? 0),
      libelle: `CB ${p.tiers?.toUpperCase()}`, statut: 'rapprochee', piece_id: p.id,
    }))
  }
  const cotisations: CotisationDeclaree[] = []
  for (let i = 0; i < nb(60); i++) {
    const appele = montant(150, 900)
    const echeance = jourDeLAnnee(Math.floor((i % 60) * 6) + 2)
    cotisations.push({
      id: uuid(3, i), dossier_id: D, echeance, montant_appele: appele, montant_verse: appele, montant_csg_crds: centimes(appele * 0.3),
      previsionnel: false, created_at: `${ANNEE}-01-01T10:00:00Z`, paiement_personnel_le: null,
    })
    lignes.push(mouvement({ id: uuid(2, n++), compte_bancaire_id: COMPTE_PRINCIPAL, date: echeance, montant: -appele, libelle: 'PRLV ORGANISME SOCIAL', statut: 'rapprochee', cotisation_id: uuid(3, i) }))
  }
  // Les factures sources et leurs encaissements, chacune réglée par un virement classé par ses encaissements.
  const factures: FactureDesEcritures[] = []
  const lignesDeFacture: LigneDeFacture[] = []
  const encaissements: EncaissementDesEcritures[] = []
  const parts: PartVendue[] = []
  const nbFactures = nb(300)
  for (let i = 0; i < nbFactures; i++) {
    const id = uuid(4, i)
    const emission = jourDeLAnnee(Math.floor((i / nbFactures) * 330))
    const ht = montant(60, 1200)
    const taux = assujetti ? 20 : 0
    const ttc = centimes(ht * (1 + taux / 100))
    factures.push({
      ...factureVendue({ id, dossier_id: D, numero: `F${ANNEE}-${String(i + 1).padStart(4, '0')}`, date_emission: emission, tiers_nom: `Client ${i % 80}` }),
      montant_ttc: ttc,
    })
    lignesDeFacture.push({ facture_id: id, ordre: 1, designation: 'Prestation', quantite: 1, prix_unitaire_ht: ht, taux_tva: taux })
    const ligneId = uuid(2, n++)
    const date = jourDeLAnnee(Math.min(364, Math.floor((i / nbFactures) * 330) + entre(5, 30)))
    lignes.push(mouvement({ id: ligneId, compte_bancaire_id: compte(), date, montant: ttc, libelle: 'VIR RECU', statut: 'rapprochee', encaissements_de_factures: true }))
    const enc: EncaissementDesEcritures = {
      id: uuid(5, i), dossier_id: D, facture_id: id, date_encaissement: date, montant: ttc, moyen: 'virement', ligne_bancaire_id: ligneId,
      annule_id: null, cree_le: `${date}T10:00:00Z`, retire_le: null, cree_par: null, compte_contrepartie: null,
    }
    encaissements.push(enc)
    parts.push({ encaissement_id: enc.id, dossier_id: D, taux, montant: ttc })
  }

  // L'assurance maladie : cent journées comptables, la part obligatoire chaque jour, la complémentaire un jour sur deux ; le
  // crédit de la journée deux jours après, au second compte, classé en recette ; 95 associées, les cinq dernières libres.
  const importsAm: ImportAssuranceMaladie[] = [{
    id: uuid(9, 0), dossier_id: D, periode_du: `${ANNEE}-01-01`, periode_au: `${ANNEE}-12-31`, nombre_de_rejets: null, montant_rejete_centimes: null,
    importe_par: 'cabinet', importe_le: `${ANNEE}-12-31T10:00:00Z`,
  }]
  const paiementsAm: PaiementAssuranceMaladie[] = []
  const associationsAm: AssociationAssuranceMaladie[] = []
  const facturesAm: FactureAssuranceMaladie[] = []
  let pa = 0
  const journees = Math.min(300, nb(100))
  for (let j = 0; j < journees; j++) {
    const journee = jourDeLAnnee(Math.floor(j * 360 / journees))
    const dela: PaiementAssuranceMaladie[] = []
    const part = (genre: 'obligatoire' | 'complementaire', c: number): PaiementAssuranceMaladie => ({
      id: uuid(10, pa++), dossier_id: D, import_id: importsAm[0].id, date_journee_comptable: journee, regime: 1, caisse: 751,
      organisme_complementaire: null, part: genre, montant_centimes: c, regularisations_centimes: 0, nombre_de_factures: entre(1, 12),
    })
    dela.push(part('obligatoire', entre(5_000, 90_000)))
    if (j % 2 === 0) dela.push(part('complementaire', entre(1_000, 20_000)))
    paiementsAm.push(...dela)
    const total = dela.reduce((s, p) => s + p.montant_centimes, 0)
    const credit = mouvement({
      id: uuid(2, n++), compte_bancaire_id: COMPTE_SECOND, date: jourDeLAnnee(Math.min(364, rangDuJour(journee) + 2)), montant: total / 100,
      libelle: `VIR CPAM 751 ${journee.slice(2, 4)}${journee.slice(5, 7)}${journee.slice(8, 10)}`, statut: 'rapprochee', categorie_id: RECETTES.id,
      taux_tva: null,
    })
    lignes.push(credit)
    if (j < journees - 5) {
      for (const p of dela) {
        associationsAm.push({ id: uuid(11, associationsAm.length), dossier_id: D, paiement_id: p.id, ligne_bancaire_id: credit.id, associe_par: 'cabinet', associe_le: `${ANNEE}-12-31T10:00:00Z` })
      }
    }
    // Le facturé : un lot créé la veille de la journée, du même montant à quelques centimes près.
    for (const p of dela) {
      facturesAm.push({
        id: uuid(12, facturesAm.length), dossier_id: D, import_id: uuid(13, 0), date_creation_lot: jourDeLAnnee(Math.max(0, rangDuJour(journee) - 1)),
        part: p.part === 'complementaire' ? 'complementaire' : 'obligatoire', regime: p.part === 'complementaire' ? null : 1,
        caisse: p.part === 'complementaire' ? null : 751, organisme_complementaire: null,
        montant_centimes: p.montant_centimes + entre(0, 3) * 100, nombre_de_lots: 1, nombre_de_factures: p.nombre_de_factures,
      })
    }
  }
  const importsFactureAm: ImportFacturesAssuranceMaladie[] = [{
    id: uuid(13, 0), dossier_id: D, premier_lot_le: `${ANNEE}-01-01`, dernier_lot_le: `${ANNEE}-12-31`, nombre_de_lots: facturesAm.length,
    nombre_de_factures: facturesAm.reduce((s, f) => s + f.nombre_de_factures, 0), importe_par: 'cabinet', importe_le: `${ANNEE}-12-31T10:00:00Z`,
  }]

  // Les mouvements classés par une catégorie (frais bancaires, recettes sans pièce), puis les mouvements libres.
  while (lignes.length < nb(2250)) {
    const recette = hasard() < 0.4
    lignes.push(mouvement({
      id: uuid(2, n++), compte_bancaire_id: compte(), date: jourDeLAnnee(entre(0, 364)), montant: recette ? montant(20, 300) : -montant(1, 40),
      libelle: recette ? 'VIR ORGANISME' : 'FRAIS TENUE DE COMPTE', statut: 'rapprochee',
      categorie_id: recette ? RECETTES.id : FRAIS.id, taux_tva: assujetti && recette ? 20 : null,
    }))
  }
  // Les virements entre les deux comptes du praticien, à rapprocher : un débit sur l'un, le crédit du même montant sur l'autre.
  for (let v = 0; v < nb(12); v++) {
    const date = jourDeLAnnee(entre(0, 360))
    const m = montant(200, 3000)
    lignes.push(mouvement({ id: uuid(2, n++), compte_bancaire_id: COMPTE_PRINCIPAL, date, montant: -m, libelle: 'VIR INTERNE EMIS' }))
    lignes.push(mouvement({ id: uuid(2, n++), compte_bancaire_id: COMPTE_SECOND, date, montant: m, libelle: 'VIR INTERNE RECU' }))
  }
  // Les mouvements libres : d'abord ceux d'une pièce que rien ne paie encore (son montant, quelques jours après), comme sur
  // un vrai relevé, puis des mouvements sans pièce.
  const payeesIds = new Set([...payees.map((p) => p.id), ...parCaisse])
  for (const p of pieces.filter((x) => !payeesIds.has(x.id))) {
    const jour = Math.min(364, entre(0, 6) + rangDuJour(p.date_piece ?? `${ANNEE}-01-01`))
    lignes.push(mouvement({ id: uuid(2, n++), compte_bancaire_id: compte(), date: jourDeLAnnee(jour), montant: (p.type_piece === 'vente' ? 1 : -1) * (p.montant_ttc ?? 0), libelle: `CB ${p.tiers?.toUpperCase()}` }))
  }
  while (lignes.length < nb(3000)) {
    const credit = hasard() < 0.3
    lignes.push(mouvement({
      id: uuid(2, n++), compte_bancaire_id: compte(), date: jourDeLAnnee(entre(0, 364)), montant: credit ? montant(10, 800) : -montant(5, 1500),
      libelle: credit ? `VIR RECU ${entre(1, 500)}` : `CB MAGASIN ${entre(1, 500)}`,
    }))
  }

  // Un relevé contrôlé par mois et par compte, cohérent.
  const controles: ControleReleveBancaire[] = []
  for (const compteId of [COMPTE_PRINCIPAL, COMPTE_SECOND]) {
    let solde = 10_000
    for (let m = 1; m <= 12; m++) {
      const debut = `${ANNEE}-${deux(m)}-01`
      const fin = new Date(Date.UTC(ANNEE, m, 0)).toISOString().slice(0, 10)
      const somme = centimes(lignes.filter((l) => l.compte_bancaire_id === compteId && l.date >= debut && l.date <= fin).reduce((s, l) => s + l.montant, 0))
      controles.push({
        id: uuid(14, controles.length), dossier_id: D, source_fichier: `releve-${compteId}-${m}.csv`, solde_initial: solde, solde_final: centimes(solde + somme),
        somme_mouvements: somme, ecart: 0, coherent: true, periode_debut: debut, periode_fin: fin, compte_bancaire_id: compteId, created_at: `${fin}T20:00:00Z`,
      })
      solde = centimes(solde + somme)
    }
  }

  // La caisse : une recette par jour tenu (250 au plus), des sorties dont les paiements de pièces.
  const operations: OperationCaisse[] = []
  let o = 0
  const operation = (x: Partial<OperationCaisse> & Pick<OperationCaisse, 'genre' | 'date' | 'montant'>): OperationCaisse => ({
    id: uuid(6, o++), dossier_id: D, categorie_id: null, taux_tva: null, encaissements_du_jour: null, piece_id: null,
    origine: 'cabinet', remplace_id: null, cree_le: `${x.date}T18:00:00Z`, cree_par: null, retire_le: null, retire_par: null, ...x,
  })
  const joursDeCaisse = Math.min(300, nb(250))
  for (let r = 0; r < joursDeCaisse; r++) {
    operations.push(operation({ genre: 'recette', date: jourDeLAnnee(Math.floor(r * 364 / joursDeCaisse)), montant: montant(30, 200), categorie_id: RECETTES.id, taux_tva: assujetti ? 20 : null, encaissements_du_jour: [] }))
  }
  const pieceParId = new Map(pieces.map((p) => [p.id, p]))
  for (const id of parCaisse) {
    const p = pieceParId.get(id)!
    operations.push(operation({ genre: 'paiement', date: p.date_piece ?? `${ANNEE}-06-01`, montant: -(p.montant_ttc ?? 0), piece_id: id })) // signé, comme au relevé : une sortie
  }
  for (let s = 0; s < 20; s++) operations.push(operation({ genre: 'prelevement', date: jourDeLAnnee(10 + s * 17), montant: montant(20, 80) }))

  const immobilisations: Immobilisation[] = []
  for (let i = 0; i < nb(15); i++) {
    const p = depenses[60 + i]
    immobilisations.push({
      id: uuid(7, i), dossier_id: D, piece_id: p.id, nature_id: null, libelle: `Bien ${i + 1}`, valeur: p.montant_ttc ?? 0,
      date_acquisition: p.date_piece ?? `${ANNEE}-01-01`, date_mise_en_service: p.date_piece, duree_annees: 5, created_at: `${ANNEE}-01-01T10:00:00Z`,
    })
  }

  const regles: RegleAffectationBancaire[] = [
    ...Array.from({ length: 10 }, (_, i) => ({ motif: `MAGASIN ${i * 7 + 1}`, sens: 'decaissement' as const, categorie_id: DEPENSES[i % DEPENSES.length].id })),
    { motif: 'FRAIS', sens: 'decaissement' as const, categorie_id: FRAIS.id },
    { motif: 'VIR RECU 4', sens: 'encaissement' as const, categorie_id: RECETTES.id },
  ].map((r, i) => ({ id: uuid(15, i), dossier_id: D, taux_tva: null, created_at: `${ANNEE}-01-01T10:00:00Z`, ...r }))

  // Les écritures libres de l'expert-comptable : des reclassements de charges, sous un poste de la 2035.
  const ecrituresLibres: EcritureLibreDesExports[] = Array.from({ length: 8 }, (_, i) => {
    const c = entre(1_000, 50_000)
    return {
      id: uuid(16, i), dossier_id: D, exercice: ANNEE, numero: i + 1, date: jourDeLAnnee(30 + i * 40), libelle: `Reclassement ${i + 1}`,
      lignes: [
        { compte: '606400', sens: 'debit', centimes: c, poste_2035: 'Fournitures de bureau', compte_lib: null },
        { compte: '606100', sens: 'credit', centimes: c, poste_2035: 'Achats', compte_lib: null },
      ],
      avec_extourne: false, piece_citee_id: i < 3 ? pieces[100 + i].id : null, version: 1, cree_par: 'cabinet', cree_le: `${ANNEE}-12-01T10:00:00Z`,
      modifie_par: null, modifie_le: null, contre_passe_id: null,
    }
  })
  const libres: EcrituresLibresDesExports = { etat: 'lues', ecritures: ecrituresLibres, auteurs: new Map() }

  // ── Le brouillon, composé par les moteurs ────────────────────────────────────────────────────────────────────────
  const caisseLue: CaisseLue = { dossierId: D, enBase: true, lignes: operations, complete: true, motif: null }
  const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(caisseLue, D)
  if (paiementsDeLaCaisse === null) throw new Error('La caisse fictive ne se lit pas.')
  const paiements = paiementsDesPieces(lignes, [], [], paiementsDeLaCaisse)
  const ventes = ventesFacturees({ dossierId: D, factures, lignes: lignesDeFacture, encaissements, parts, acomptes: SANS_ACOMPTE, piecesCitees: AUCUNE_PIECE_CITEE })
  const mouvementsDesEncaissements = lignes.filter((l) => l.encaissements_de_factures)
  const sourcesEcritures: SourcesDesEcrituresDeVente = {
    dossierId: D, factures, lignes: lignesDeFacture, encaissements, parts,
    mouvements: mouvementsDesEncaissements, exemplaires: [], reprises: [], piecesCitees: AUCUNE_PIECE_CITEE,
  }
  const aComptabiliser = piecesAComptabiliser(pieces, CATEGORIES, new Map(), ventes.sources)
  const generation = ecrituresAGenerer(D, aComptabiliser, [], assujetti, paiements, MODELE, null, BANQUES)
  let e = 0
  const ecriture = (x: Pick<EcritureBrouillon, 'dossier_id' | 'date' | 'compte' | 'libelle' | 'montant' | 'sens'> & Partial<EcritureBrouillon>): EcritureBrouillon => ({
    ...NON_VALIDEE, id: uuid(8, e++), statut: 'proposee', created_at: `${ANNEE}-12-31T10:00:00Z`, piece_id: null, ligne_bancaire_id: null,
    immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null,
    operation_caisse_id: null, ...x,
  })
  const brouillon: EcritureBrouillon[] = generation.lignes.map((l) => ecriture(l))
  // Les mouvements classés par une catégorie et les cotisations rapprochées, par les compositions du relevé, au plan du mouvement.
  const categorieParId = new Map(CATEGORIES.map((c) => [c.id, c]))
  const cotisationParId = new Map(cotisations.map((c) => [c.id, c]))
  for (const l of lignes) {
    if (l.statut !== 'rapprochee' || l.piece_id || l.encaissements_de_factures) continue
    const plan = planDuMouvement(PLAN, l, BANQUES)
    if ('refus' in plan) throw new Error(plan.refus)
    const cat = l.categorie_id ? categorieParId.get(l.categorie_id) : undefined
    const cot = l.cotisation_id ? cotisationParId.get(l.cotisation_id) : undefined
    const lignesDeLEcriture = cat ? ecritureDuMouvement(l, cat.compte_comptable!, l.taux_tva, plan.plan)
      : cot ? ecritureDeLaCotisation(l, { ...cot, montant_autres_impots: 0 }, MODELE.mode, plan.plan) : []
    for (const x of lignesDeLEcriture) brouillon.push(ecriture({ dossier_id: D, date: l.date, ...x, ligne_bancaire_id: l.id, cotisation_id: cot ? cot.id : null }))
  }
  for (const op of operations) {
    if (op.genre === 'paiement') continue
    const aEcrire = { genre: op.genre, date: op.date, montant: op.montant, taux_tva: op.taux_tva, categorie: op.genre === 'recette' ? RECETTES : null }
    for (const l of ecritureDeLOperation(aEcrire, MODELE)) brouillon.push(ecriture({ dossier_id: D, date: op.date, ...l, operation_caisse_id: op.id }))
  }
  const composition = ecrituresDesVentesFacturees({
    sources: { dossierId: D, factures, lignes: lignesDeFacture, encaissements, parts },
    mouvements: mouvementsDesEncaissements, comptesDeContrepartie: new Map(), exemplaires: [], mode: MODELE.mode, plan: PLAN, banques: BANQUES,
  })
  for (const v of composition.ecritures) for (const l of lignesAuBrouillon(D, v)) brouillon.push(ecriture(l))
  for (const el of ecrituresLibres) {
    for (const l of el.lignes) {
      brouillon.push(ecriture({ dossier_id: D, date: el.date, compte: l.compte, sens: l.sens, montant: l.centimes / 100, libelle: el.libelle, ecriture_libre_id: el.id }))
    }
  }

  return {
    pieces, lignes, controles, cotisations, immobilisations, operations, factures, lignesDeFacture, encaissements, parts, regles,
    importsAm, paiementsAm, associationsAm, importsFactureAm, facturesAm, ecrituresLibres, brouillon, caisseLue, sourcesEcritures,
    compositionDesVentes: composition.ecritures, libres,
  }
}
