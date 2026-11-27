// LE DOSSIER DE DÉMONSTRATION (demande du cabinet du 16/11/2026) — un dossier FICTIF complet, à restaurer d'un clic depuis
// l'écran du super-administrateur (« Restaurer une sauvegarde »), pour se familiariser avec l'application. Rien ne s'écrit en
// production par SQL : ce module compose un FICHIER DE SAUVEGARDE au format que l'application relit (src/lib/sauvegardeFichier.ts)
// et réinsère (src/lib/sauvegardeDonnees.ts, `restaurerSauvegarde`) — le chemin que les gardes de la base admettent (« la
// restauration exceptée »). Le lanceur : outils/demonstration/ (README). Le test : src/lib/dossierDeDemonstration.test.ts.
//
// Le dossier : un infirmier libéral FICTIF, BNC en trésorerie, exonéré de TVA (CGI, art. 261, 4-1°), NON basculé (ses ventes
// entrent par le relevé et la caisse, pas par ses factures). L'année 2025 entière et 2026 jusqu'à la mi-novembre, sur le modèle
// de la répétition générale (src/test/repetitionDUneAnnee.ts), sans un seul nom réel : « Démo » dans chaque tiers, « Particulier »
// pour un patient, un SIRET fabriqué. Les écritures sont composées par les VRAIS moteurs, comme les gestes de l'application
// les écrivent (le même enchaînement que src/test/fecFictif.ts). Tout est déterministe : aucun tirage, des montants qui varient
// par une arithmétique fixe du mois — deux compositions rendent le même fichier, à l'octet.
//
// Ce que le dossier porte VOLONTAIREMENT, pour que la Vue d'ensemble ait quelque chose à dire en 2026 : le relevé de juillet
// 2026 manquant (ses mouvements existent à la banque, pas dans le dossier : la suite des soldes rompt), quatre mouvements à
// rapprocher, quatre pièces à valider (dont une à faible confiance et un doublon probable), une échéance d'Urssaf de novembre
// sans son relevé. 2025 est complète et cohérente : sa Checklist n'a rien à dire sur elle, sa 2035 se calcule.
//
// Ce qu'il ne porte PAS : aucun exercice validé (la validation fige), aucune connexion (banque, plateforme), aucun accès
// client, aucun compte utilisateur, aucune facture émise (voir le README : dans un dossier non basculé, une facture validée
// n'est pas la source de sa vente, et la restaurer demanderait d'imiter les mentions figées, la série et l'exemplaire), aucun
// FICHIER de pièce (une sauvegarde porte les lignes, pas les fichiers du stockage : chaque pièce dit son fichier absent).
// Ni la table `categories` : les catégories citées sont cinq communes de la production (relevées le 08/11/2026, celles de la
// répétition), et une table absente de la sauvegarde fait d'elles des RÉFÉRENCES EXTERNES, que la restauration VÉRIFIE avant
// toute écriture (`referencesExternes`) : une catégorie inconnue de la base d'arrivée refuse tout, rien n'est écrit — jamais
// une catégorie commune créée pour tous les cabinets.

import { ECRITURES_LIBRES_ABSENTES } from '../lib/ecrituresLibresDesExports'
import { AUCUNE_PIECE_CITEE } from '../lib/facturesSources'
import { acquisitionsDesBiens, ecritureDeLaDotation } from '../lib/amortissements'
import { ecritureDuMouvement } from '../lib/affectationBanque'
import { ouvertureBanque } from '../lib/aNouveaux'
import { banqueDesLecteurs, banquesDuDossier } from '../lib/banqueDuMouvement'
import { ecritureDeLOperation } from '../lib/caisse'
import { valeursDesCases } from '../lib/cases2035'
import { ecritureDuCompteDeBilan } from '../lib/compteDeBilan'
import { concordance2035, type Concordance2035 } from '../lib/concordance2035'
import { operationsDeCaisseDuDossier, operationsPourLesControles } from '../lib/controlesDeLaCaisse'
import { cotisationsComptees, ecritureDeLaCotisation } from '../lib/cotisationRapprochee'
import { calculerDeclaration2035, type Declaration2035 } from '../lib/declaration2035'
import { ecrituresAGenerer, piecesAComptabiliser } from '../lib/ecritures'
import { ecrituresDesVentesPourLa2035, mouvementsClassesParEncaissements } from '../lib/ecrituresVentesFactureesEcran'
import { CHAMPS_BNC_NON_EXPORTES } from '../lib/fec'
import { INVENTAIRE_SANS_OBJET } from '../lib/inventaireDeLaValidation'
import { prealablesDeValidation } from '../lib/prealablesValidation'
import { ventesDeLaChecklist } from '../lib/ventesDeLaChecklist'
import { facturesSourcesDe } from '../lib/facturesSources'
import { ecritureDuForfait } from '../lib/forfaitKilometrique'
import { paiementsParLaCaisseDuDossier } from '../lib/paiementParLaCaisse'
import { partsDuReleve } from '../lib/partsDuReleve'
import { pointsDeLaChecklist, type PointATraiter } from '../lib/pointsDeLaChecklist'
import { paiementsDesPieces } from '../lib/rattachement'
import { recettesDeCaisseDuDossier, recettesPourLesMoteurs, type CaisseLue } from '../lib/recettesDeCaisse'
import { AUCUNE_SAISIE_2035 } from '../lib/saisies2035'
import {
  comptesRequis, liensPerdus, referencesExternes,
} from '../lib/sauvegarde'
import type { Manifeste, SauvegardeDossier } from '../lib/sauvegardeDonnees'
import { VERSION_SAUVEGARDE } from '../lib/sauvegardeLogos'
import { relevesIncoherentsDe } from '../lib/suiteDesReleves'
import { COMPTE_BANCAIRE_D_ESSAI } from './compteBancaireDEssai'
import type {
  ANouveau, Categorie, ControleReleveBancaire, CotisationDeclaree, EcritureBrouillon, Immobilisation, LigneBancaire,
  NatureImmobilisation, OperationCaisse, Piece, ReglementGroupe, VehiculeDossier,
} from '../lib/types'
import { SANS_ACOMPTE, ventesFacturees } from '../lib/ventesFacturees'
import { ecritureDuVirementPersonnel } from '../lib/virementPersonnel'
import { NON_VALIDEE } from './ecritures'
import { modeleDeTest } from './modeles'
import { ACHATS, AUTRE, FRAIS_BANCAIRES, LOYER, RECETTES } from './repetitionDUneAnnee'

// ── L'identité du dossier ────────────────────────────────────────────────────────────────────────────────────────────
export const DOSSIER_DE_DEMONSTRATION = 'de305000-0000-4000-8000-000000000001'
// Sans tiret long ni ponctuation : la suppression du dossier fait TAPER son nom (ConfirmationSuppression), au caractère près, sur un iPhone.
export const NOM_DE_LA_DEMONSTRATION = 'Dossier fictif de démonstration'
/** Un SIRET fabriqué (la clé de Luhn juste) : celui du FEC fictif (src/test/fecFictif.ts), qu'aucun dossier réel ne porte. */
export const SIRET_DE_LA_DEMONSTRATION = '12345678200010'
/** L'instant du manifeste, figé : le fichier est déterministe. */
export const FAITE_LE = '2026-11-16T08:00:00.000Z'
/** Le jour où la démonstration s'arrête : la mi-novembre 2026. Le relevé de novembre n'est pas encore venu. */
export const AUJOURD_HUI = '2026-11-16'

/** Les cinq catégories communes de la production que le dossier cite (ids et comptes relevés le 08/11/2026). */
export const CATEGORIES_CITEES: readonly Categorie[] = [ACHATS, LOYER, FRAIS_BANCAIRES, RECETTES, AUTRE]

const D = DOSSIER_DE_DEMONSTRATION
const MODELE = modeleDeTest('tresorerie')
const PLAN = MODELE.plan
const ASSUJETTI = false
const deux = (n: number) => String(n).padStart(2, '0')
const jour = (a: number, m: number, j: number) => `${a}-${deux(m)}-${deux(j)}`
const dernierJour = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate()
/** Un identifiant fixe : le genre de la ligne (trois chiffres), puis son rang. */
const id = (genre: number, n: number) => `de305000-0000-4000-8${String(genre).padStart(3, '0')}-${String(n).padStart(12, '0')}`
/** Arrondi au centime, en entiers (aucune somme de flottants ne dérive). */
const c = (x: number) => Math.round(x * 100) / 100
/** Une variation fixe d'un mois à l'autre, entre 0 et `amplitude` (exclue) : la même à chaque composition. */
const variation = (a: number, m: number, k: number, amplitude: number) => ((a * 13 + m * 37 + k * 11) % amplitude)

/** Les mois dont le relevé est au dossier : 2025 entière, 2026 de janvier à octobre SAUF juillet (volontairement manquant). */
const MOIS_DES_RELEVES: readonly [number, number][] = [
  ...Array.from({ length: 12 }, (_, i) => [2025, i + 1] as [number, number]),
  ...[1, 2, 3, 4, 5, 6, 8, 9, 10].map((m) => [2026, m] as [number, number]),
]
/** Tous les mois de la banque, relevés reçus ou non, jusqu'à la mi-novembre 2026 : de quoi tenir les soldes justes. */
const MOIS_DE_LA_BANQUE: readonly [number, number][] = [
  ...Array.from({ length: 12 }, (_, i) => [2025, i + 1] as [number, number]),
  ...Array.from({ length: 11 }, (_, i) => [2026, i + 1] as [number, number]),
]
const releveRecu = (a: number, m: number) => MOIS_DES_RELEVES.some(([x, y]) => x === a && y === m)
const nomDuReleve = (a: number, m: number) => `releve-demo-${a}-${deux(m)}.csv`

// ── Les pièces ───────────────────────────────────────────────────────────────────────────────────────────────────────
let rangPiece = 0
/** Une empreinte de forme SHA-256 (64 chiffres hexadécimaux), fabriquée et unique : aucun fichier n'est derrière. */
const empreinteFabriquee = (n: number) => `de305000${n.toString(16).padStart(8, '0')}`.repeat(4)
function piece(o: {
  date: string; ttc: number; categorie: Categorie | null; tiers: string | null; fichier: string;
  type?: Piece['type_piece']; statut?: Piece['statut']; confiance?: Piece['confiance']
}): Piece {
  const n = rangPiece++
  const depot = `${o.date}T09:30:00Z`
  return {
    id: id(1, n), dossier_id: D, uploaded_by: null, source: 'upload',
    // Le premier segment du chemin EST le dossier (la règle du stockage) ; aucun fichier n'y sera : la fiche le dit.
    storage_path: `${D}/demonstration/${String(n).padStart(3, '0')}-${o.fichier}.pdf`, nom_fichier: `${o.fichier}.pdf`,
    storage_hash: empreinteFabriquee(n), date_piece: o.date, tiers: o.tiers, montant_ht: o.ttc, montant_tva: 0, montant_ttc: o.ttc,
    devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: o.categorie?.id ?? null,
    sous_dossier_id: null, type_piece: o.type ?? 'achat', statut: o.statut ?? 'validee', confiance: o.confiance ?? 'haute',
    superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
    identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    updated_at: depot, created_at: depot,
  }
}

// ── Le relevé, mouvement par mouvement ───────────────────────────────────────────────────────────────────────────────
type Classement =
  | { type: 'piece'; pieceId: string }
  | { type: 'groupe'; parts: { pieceId: string; montant: number }[] }
  | { type: 'categorie'; categorie: Categorie }
  | { type: 'cotisation'; cotisationId: string }
  | { type: 'caisse' }
  | { type: 'personnel' }
  | { type: 'a_rapprocher' }
interface Mouvement { date: string; libelle: string; montant: number; classement: Classement }

let rangCotisation = 0
function cotisation(echeance: string, montant: number, csg: number): CotisationDeclaree {
  return {
    id: id(3, rangCotisation++), dossier_id: D, echeance, montant_appele: montant, montant_verse: montant, montant_csg_crds: csg,
    previsionnel: false, created_at: `${echeance}T07:00:00Z`, paiement_personnel_le: null,
  }
}

let rangOperation = 0
function operation(o: Pick<OperationCaisse, 'genre' | 'date' | 'montant'> & Partial<OperationCaisse>): OperationCaisse {
  return {
    id: id(6, rangOperation++), dossier_id: D, categorie_id: null, taux_tva: null, encaissements_du_jour: null, piece_id: null,
    origine: 'cabinet', remplace_id: null, cree_le: `${o.date}T18:00:00Z`, cree_par: null, retire_le: null, retire_par: null, ...o,
  }
}

/** Le dossier composé : ses lignes de base, telles que l'export les porterait, et ce que les moteurs en tirent. */
export interface DossierDeDemonstration {
  pieces: Piece[]
  cotisations: CotisationDeclaree[]
  lignes: LigneBancaire[]
  controles: ControleReleveBancaire[]
  reglements: ReglementGroupe[]
  operations: OperationCaisse[]
  immobilisations: Immobilisation[]
  natures: NatureImmobilisation[]
  vehicules: VehiculeDossier[]
  aNouveaux: ANouveau[]
  brouillon: EcritureBrouillon[]
  /** Les mouvements de la banque que le dossier ne porte pas (juillet et novembre 2026), comptés pour les soldes seulement. */
  mouvementsHorsDuDossier: number
}

export function composerLeDossier(): DossierDeDemonstration {
  rangPiece = 0
  rangCotisation = 0
  rangOperation = 0
  const pieces: Piece[] = []
  const mouvements: Mouvement[] = []
  const cotisations: CotisationDeclaree[] = []
  const operations: OperationCaisse[] = []
  const m = (date: string, libelle: string, montant: number, classement: Classement) => mouvements.push({ date, libelle, montant: c(montant), classement })
  const ajouter = (p: Piece) => { pieces.push(p); return p }

  // Chaque mois de la banque : les recettes de l'Assurance maladie et des complémentaires, les chèques, le loyer, les frais,
  // le virement au compte personnel, l'Urssaf, un achat de fournitures payé par carte, une recette en espèces.
  for (const [a, mois] of MOIS_DE_LA_BANQUE) {
    const enNovembre2026 = a === 2026 && mois === 11
    m(jour(a, mois, 3), 'PRLV LOYER CABINET DEMO', a === 2025 ? -650 : -670, { type: 'categorie', categorie: LOYER })
    const urssaf = cotisation(jour(a, mois, 5), a === 2025 ? 690 : 720, a === 2025 ? 205 : 214)
    cotisations.push(urssaf)
    m(urssaf.echeance, 'PRLV URSSAF', -urssaf.montant_appele, { type: 'cotisation', cotisationId: urssaf.id })
    if (enNovembre2026) continue // la mi-novembre : rien d'autre n'est encore passé, et le relevé n'est pas venu
    m(jour(a, mois, 8), 'VIR CPAM TIERS PAYANT', 2800 + variation(a, mois, 1, 400) + 0.35, { type: 'categorie', categorie: RECETTES })
    m(jour(a, mois, 12), 'VIR ORGANISME COMPLEMENTAIRE', 360 + variation(a, mois, 2, 90) + 0.6, { type: 'categorie', categorie: RECETTES })
    const cpam2 = 2600 + variation(a, mois, 3, 350) + 0.8
    // Le second virement d'octobre 2026 reste à rapprocher.
    m(jour(a, mois, 22), 'VIR CPAM TIERS PAYANT', cpam2, a === 2026 && mois === 10 ? { type: 'a_rapprocher' } : { type: 'categorie', categorie: RECETTES })
    m(jour(a, mois, 24), 'REMISE CHEQUES', 140 + variation(a, mois, 4, 80), { type: 'categorie', categorie: RECETTES })
    m(jour(a, mois, 28), 'FRAIS TENUE DE COMPTE', -8.5, { type: 'categorie', categorie: FRAIS_BANCAIRES })
    m(jour(a, mois, 28), 'VIR COMPTE PERSONNEL', -3500, { type: 'personnel' })
    // Un achat de fournitures par mois, sa pièce déposée le jour même, payé par carte deux jours plus tard.
    const fournitures = ajouter(piece({
      date: jour(a, mois, 14), ttc: c(60 + variation(a, mois, 5, 90) + 0.4), categorie: ACHATS, tiers: 'Fournitures Médicales Démo',
      fichier: `${a}-${deux(mois)}-fournitures`,
    }))
    m(jour(a, mois, 16), 'CB FOURNITURES MEDICALES DEMO', -fournitures.montant_ttc!, { type: 'piece', pieceId: fournitures.id })
    // Une recette en espèces sans facture, le 27, portée par le praticien dans sa caisse.
    operations.push(operation({ genre: 'recette', date: jour(a, mois, 27), montant: 120, categorie_id: RECETTES.id, encaissements_du_jour: [] }))
  }

  // La caisse de retraite (CARPIMKO), deux fois l'an ; la régularisation de l'Urssaf de 2024, appelée en novembre 2025.
  for (const [a, montant] of [[2025, 1950], [2026, 2050]] as const) {
    for (const mois of [2, 8]) {
      const k = cotisation(jour(a, mois, 10), montant, 0)
      cotisations.push(k)
      m(k.echeance, 'PRLV CARPIMKO', -montant, { type: 'cotisation', cotisationId: k.id })
    }
  }
  const regularisation = cotisation(jour(2025, 11, 20), 420, 110)
  cotisations.push(regularisation)
  m(regularisation.echeance, 'PRLV URSSAF', -420, { type: 'cotisation', cotisationId: regularisation.id })

  // L'assurance professionnelle, une fois l'an.
  for (const [a, ttc] of [[2025, 412], [2026, 428]] as const) {
    const p = ajouter(piece({ date: jour(a, 1, 10), ttc, categorie: AUTRE, tiers: 'Assurance Professionnelle Démo', fichier: `${a}-assurance-rcp` }))
    m(jour(a, 1, 15), 'PRLV ASSURANCE PRO DEMO', -ttc, { type: 'piece', pieceId: p.id })
  }

  // 2025, comme la répétition : un appareil immobilisé, deux achats d'un seul virement, un prélèvement rejeté puis repris,
  // un achat payé en espèces par la caisse, la caisse versée en banque, un prélèvement de l'exploitant en espèces.
  const appareil = ajouter(piece({ date: jour(2025, 4, 1), ttc: 2400, categorie: null, tiers: 'Matériel Médical Démo', fichier: '2025-04-electrocardiographe' }))
  m(jour(2025, 4, 3), 'VIR MATERIEL MEDICAL DEMO', -2400, { type: 'piece', pieceId: appareil.id })
  const groupees = [
    ajouter(piece({ date: jour(2025, 6, 2), ttc: 180, categorie: ACHATS, tiers: 'Grossiste Démo', fichier: '2025-06-grossiste-1' })),
    ajouter(piece({ date: jour(2025, 6, 10), ttc: 230, categorie: ACHATS, tiers: 'Grossiste Démo', fichier: '2025-06-grossiste-2' })),
  ]
  m(jour(2025, 6, 15), 'VIR GROSSISTE DEMO', -410, { type: 'groupe', parts: groupees.map((p) => ({ pieceId: p.id, montant: -p.montant_ttc! })) })
  const abonnement = ajouter(piece({ date: jour(2025, 5, 2), ttc: 29.9, categorie: AUTRE, tiers: 'Logiciel Démo', fichier: '2025-05-abonnement-logiciel' }))
  m(jour(2025, 5, 5), 'PRLV LOGICIEL DEMO', -29.9, { type: 'piece', pieceId: abonnement.id })
  m(jour(2025, 5, 12), 'REJET PRLV LOGICIEL DEMO', 29.9, { type: 'piece', pieceId: abonnement.id })
  m(jour(2025, 5, 20), 'PRLV LOGICIEL DEMO', -29.9, { type: 'piece', pieceId: abonnement.id })
  const enEspeces = ajouter(piece({ date: jour(2025, 3, 12), ttc: 45, categorie: ACHATS, tiers: 'Pharmacie Démo', fichier: '2025-03-pharmacie' }))
  operations.push(operation({ genre: 'paiement', date: jour(2025, 3, 12), montant: -45, piece_id: enEspeces.id }))
  operations.push(operation({ genre: 'prelevement', date: jour(2025, 7, 30), montant: 100 }))
  for (const [date, montant] of [[jour(2025, 4, 30), 300], [jour(2025, 9, 30), 400], [jour(2025, 12, 29), 300], [jour(2026, 3, 31), 500], [jour(2026, 9, 30), 600]] as const) {
    m(date, 'VERSEMENT ESPECES', montant, { type: 'caisse' })
  }

  // 2026 : deux notes d'honoraires (pièces de VENTE) payées par virement ; puis ce que la mi-novembre laisse à faire.
  for (const [mois, j] of [[3, 12], [5, 20]] as const) {
    const p = ajouter(piece({ date: jour(2026, mois, j), ttc: 75, categorie: RECETTES, tiers: 'Particulier', type: 'vente', fichier: `2026-${deux(mois)}-note-d-honoraires` }))
    m(jour(2026, mois, j + 3), 'VIR PARTICULIER', 75, { type: 'piece', pieceId: p.id })
  }
  // Quatre mouvements à rapprocher (le second virement de la CPAM d'octobre en est un, plus haut).
  m(jour(2026, 9, 17), 'VIR PARTICULIER', 80, { type: 'a_rapprocher' })
  m(jour(2026, 10, 8), 'PRLV TELEPHONIE DEMO', -39.99, { type: 'a_rapprocher' })
  m(jour(2026, 10, 19), 'CB PHARMACIE DEMO', -23.4, { type: 'a_rapprocher' })
  // Quatre pièces à valider : la facture du téléphone que le prélèvement d'octobre attend ; le doublon probable de la facture
  // de fournitures d'octobre (même fournisseur, même montant, trois jours après) ; une pièce lue à faible confiance ; une
  // autre à confiance moyenne, de novembre, que le relevé ne montre pas encore.
  ajouter(piece({ date: jour(2026, 10, 6), ttc: 39.99, categorie: AUTRE, tiers: 'Téléphonie Démo', statut: 'a_valider', fichier: '2026-10-telephonie' }))
  const fournituresOctobre = pieces.find((p) => p.date_piece === jour(2026, 10, 14))!
  ajouter(piece({
    date: jour(2026, 10, 17), ttc: fournituresOctobre.montant_ttc!, categorie: ACHATS, tiers: 'Fournitures Médicales Démo', statut: 'a_valider',
    fichier: '2026-10-fournitures-copie',
  }))
  ajouter(piece({ date: jour(2026, 11, 4), ttc: 18.7, categorie: null, tiers: null, statut: 'a_valider', confiance: 'basse', fichier: 'ticket-illisible' }))
  ajouter(piece({ date: jour(2026, 11, 10), ttc: 132, categorie: ACHATS, tiers: 'Fournitures Médicales Démo', statut: 'a_valider', confiance: 'moyenne', fichier: '2026-11-fournitures' }))

  // ── Les lignes de base du relevé : un relevé par mois reçu, ses soldes tenus sur TOUS les mouvements de la banque ──────
  const ordre = [...mouvements].sort((x, y) => x.date.localeCompare(y.date))
  const cent = (x: number) => Math.round(x * 100)
  let solde = cent(6000) // le solde du premier relevé, celui de la balance reprise
  const lignes: LigneBancaire[] = []
  const controles: ControleReleveBancaire[] = []
  const reglements: ReglementGroupe[] = []
  let mouvementsHorsDuDossier = 0
  let rangLigne = 0
  for (const [a, mois] of MOIS_DE_LA_BANQUE) {
    const duMois = ordre.filter((x) => x.date.startsWith(`${a}-${deux(mois)}-`))
    const initial = solde
    const somme = duMois.reduce((s, x) => s + cent(x.montant), 0)
    solde += somme
    if (!releveRecu(a, mois)) { mouvementsHorsDuDossier += duMois.length; continue }
    const fichier = nomDuReleve(a, mois)
    const importeLe = `${mois === 12 ? a + 1 : a}-${deux(mois === 12 ? 1 : mois + 1)}-05T10:00:00Z`
    controles.push({
      id: id(12, controles.length), dossier_id: D, compte_bancaire_id: COMPTE_BANCAIRE_D_ESSAI, source_fichier: fichier, solde_initial: initial / 100, solde_final: solde / 100,
      somme_mouvements: somme / 100, ecart: 0, coherent: true, periode_debut: jour(a, mois, 1), periode_fin: jour(a, mois, dernierJour(a, mois)),
      created_at: importeLe,
    })
    for (const x of duMois) {
      const k = x.classement
      const ligne: LigneBancaire = {
        id: id(2, rangLigne++), dossier_id: D, compte_bancaire_id: COMPTE_BANCAIRE_D_ESSAI, date: x.date, libelle: x.libelle, montant: x.montant,
        statut: k.type === 'personnel' ? 'ignoree' : k.type === 'a_rapprocher' ? 'non_rapprochee' : 'rapprochee',
        piece_id: k.type === 'piece' ? k.pieceId : null, cotisation_id: k.type === 'cotisation' ? k.cotisationId : null,
        categorie_id: k.type === 'categorie' ? k.categorie.id : null, taux_tva: null, prelevement_personnel: k.type === 'personnel',
        emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
        reglement_groupe: k.type === 'groupe', compte_bilan: k.type === 'caisse' ? PLAN.caisse : null, declaration_tva_id: null,
        id_externe: null, source_fichier: fichier, libelle_brut: x.libelle, created_at: importeLe, encaissements_de_factures: false,
      }
      lignes.push(ligne)
      if (k.type === 'groupe') {
        k.parts.forEach((p, i) => reglements.push({
          id: id(13, reglements.length), dossier_id: D, ligne_bancaire_id: ligne.id, piece_id: p.pieceId, montant: p.montant,
          created_at: importeLe.replace('T10', `T1${i + 1}`),
        }))
      }
    }
  }

  // ── L'immobilisation, sa nature (propre au dossier : aucune nature commune n'est citée), le véhicule, la reprise ────────
  const natures: NatureImmobilisation[] = [{
    id: id(9, 1), dossier_id: D, libelle: 'Matériel médical', duree_annees_defaut: 5, ordre: 1, compte_immobilisation: '215400',
  }]
  const immobilisations: Immobilisation[] = [{
    id: id(7, 1), dossier_id: D, piece_id: appareil.id, nature_id: natures[0].id, libelle: 'Électrocardiographe portable',
    valeur: 2400, date_acquisition: jour(2025, 4, 1), date_mise_en_service: jour(2025, 4, 1), duree_annees: 5, created_at: '2025-04-02T10:00:00Z',
  }]
  const vehicule = (a: number, km: number): VehiculeDossier => ({
    id: id(10, a - 2024), dossier_id: D, annee: a, modele: 'Citadine fictive', type: 'voiture', puissance_fiscale: 5, bareme: 'bnc',
    motorisation: 'thermique', carburant: 'super_sans_plomb', km_professionnel: km, inscrit_immobilisations: false, amortissements_a_reintegrer: null,
    created_at: `${a}-01-20T10:00:00Z`, updated_at: `${a}-01-20T10:00:00Z`,
  })
  const vehicules = [vehicule(2025, 9200), vehicule(2026, 7800)]
  const aNouveau = (n: number, compte: string, sens: 'debit' | 'credit', libelle: string): ANouveau => ({
    id: id(11, n), dossier_id: D, date: jour(2025, 1, 1), compte, compte_origine: compte, libelle, sens, montant: 6000,
    source_nom: 'balance-demo-2024.csv', source_empreinte: empreinteFabriquee(900), created_at: '2025-01-03T09:00:00Z', compte_lib: null, ecriture_lib: null,
  })
  const aNouveaux = [aNouveau(1, PLAN.banque, 'debit', 'Banque'), aNouveau(2, PLAN.exploitant, 'credit', "Compte de l'exploitant")]

  // ── Le brouillon, comme chaque geste l'écrit (l'enchaînement de src/test/fecFictif.ts) ──────────────────────────────────
  const caisseLue: CaisseLue = { dossierId: D, enBase: true, lignes: operations, complete: true, motif: null }
  const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(caisseLue, D)
  if (paiementsDeLaCaisse === null) throw new Error('La caisse de la démonstration ne se lit pas.')
  const paiements = paiementsDesPieces(lignes, reglements, [], paiementsDeLaCaisse)
  const acquisitions = acquisitionsDesBiens(immobilisations, natures, null)
  const banques = banquesDuDossier({ etat: 'sans_objet' }, PLAN)
  let rangEcriture = 0
  const ecriture = (x: Pick<EcritureBrouillon, 'date' | 'compte' | 'libelle' | 'montant' | 'sens'> & Partial<EcritureBrouillon>): EcritureBrouillon => ({
    ...NON_VALIDEE, id: id(8, rangEcriture++), dossier_id: D, statut: 'proposee', created_at: `${x.date}T20:00:00Z`, piece_id: null,
    ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, encaissement_id: null,
    facture_id: null, operation_caisse_id: null, ...x,
  })
  const generation = ecrituresAGenerer(D, piecesAComptabiliser(pieces.filter((p) => p.statut === 'validee'), [...CATEGORIES_CITEES], acquisitions, new Set()), [], ASSUJETTI, paiements, MODELE, null, banques)
  if (generation.banquesInconnues.length > 0 || generation.dansUnExerciceValide.length > 0) throw new Error('La génération des pièces retient des pièces.')
  const brouillon: EcritureBrouillon[] = generation.lignes.map((l) => ecriture(l))
  for (const l of lignes) {
    const x = l.categorie_id ? 'categorie' : l.cotisation_id ? 'cotisation' : l.prelevement_personnel ? 'personnel' : l.compte_bilan ? 'caisse' : 'autre'
    const categorie = CATEGORIES_CITEES.find((k) => k.id === l.categorie_id)
    const composees = x === 'categorie' ? ecritureDuMouvement(l, categorie!.compte_comptable!, null, PLAN)
      : x === 'cotisation' ? ecritureDeLaCotisation(l, cotisations.find((k) => k.id === l.cotisation_id)!, MODELE.mode, PLAN)
        : x === 'personnel' ? ecritureDuVirementPersonnel(l, MODELE)
          : x === 'caisse' ? ecritureDuCompteDeBilan(l, PLAN.caisse, PLAN)
            : []
    for (const k of composees) brouillon.push(ecriture({ date: l.date, ...k, ligne_bancaire_id: l.id }))
  }
  for (const op of operations) {
    if (op.genre === 'paiement') continue
    const aEcrire = { genre: op.genre, date: op.date, montant: op.montant, taux_tva: op.taux_tva, categorie: op.genre === 'recette' ? CATEGORIES_CITEES.find((k) => k.id === op.categorie_id)! : null }
    for (const k of ecritureDeLOperation(aEcrire, MODELE)) brouillon.push(ecriture({ date: op.date, ...k, operation_caisse_id: op.id }))
  }
  // L'inventaire de 2025 seulement : la dotation et le forfait de 2026 s'écriront à la clôture de 2026.
  for (const bien of immobilisations) {
    for (const k of ecritureDeLaDotation(bien, natures[0].compte_immobilisation, 2025, null, PLAN)) brouillon.push(ecriture({ date: '2025-12-31', ...k, immobilisation_id: bien.id }))
  }
  for (const k of ecritureDuForfait(vehicules[0], MODELE, null) ?? []) brouillon.push(ecriture({ date: '2025-12-31', ...k, vehicule_id: vehicules[0].id }))

  return {
    pieces, cotisations, lignes, controles, reglements, operations, immobilisations, natures, vehicules, aNouveaux, brouillon,
    mouvementsHorsDuDossier,
  }
}

// ── La sauvegarde ────────────────────────────────────────────────────────────────────────────────────────────────────
type Ligne = Record<string, unknown>
/** Une ligne telle que la base la porte : les colonnes de la base, sans ce que le type de l'application y ajoute. */
const enLigne = (x: object): Ligne => ({ ...(x as Ligne) })

/** Le contenu de la sauvegarde, table par table, pour le cabinet `cabinetId` (la base d'arrivée doit le porter). */
export function contenuDeLaSauvegarde(dossier: DossierDeDemonstration, cabinetId: string): Record<string, Ligne[]> {
  const compte = id(14, 1)
  return {
    dossiers: [{
      id: D, nom: NOM_DE_LA_DEMONSTRATION, cabinet_id: cabinetId, siret: SIRET_DE_LA_DEMONSTRATION, contact_nom: 'Praticien fictif',
      contact_email: null, archive: false, created_at: '2025-01-03T08:00:00Z', statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1',
      numero_tva_attribue: false, tva_periodicite: 'trimestrielle', tva_sur_debits: false, mode_comptable: 'tresorerie',
      compte_notes_de_frais: MODELE.compteNotesDeFrais, code_naf: '86.90D', libelle_naf: 'Activités des infirmiers et des sages-femmes',
      adresse: '1 rue de la Démonstration, 99999 Ville fictive', ventes_par_les_factures: false,
    }],
    comptes_bancaires: [{ id: compte, dossier_id: D, libelle: 'Compte professionnel (fictif)', principal: true, created_by: null, created_at: '2025-01-03T08:05:00Z' }],
    a_nouveaux: dossier.aNouveaux.map(enLigne),
    controles_releves_bancaires: dossier.controles.map((k) => ({ ...enLigne(k), compte_bancaire_id: compte })),
    cotisations_declarees: dossier.cotisations.map(enLigne),
    debuts_d_activite: [{ id: id(15, 1), dossier_id: D, date_debut: '2019-03-01', created_at: '2025-01-03T08:10:00Z', updated_at: '2025-01-03T08:10:00Z' }],
    // L'ACRE dite pour chaque exercice (une activité ouverte en 2019 n'y a plus droit) : l'estimation des cotisations la lit.
    parametres_des_cotisations: [2025, 2026].map((annee, i) => ({
      id: id(16, i + 1), dossier_id: D, annee, acre: false, taux_dentiste: null, created_at: '2025-01-03T08:10:00Z', updated_at: '2025-01-03T08:10:00Z',
    })),
    natures_immobilisation: dossier.natures.map((n) => ({ ...enLigne(n), created_at: '2025-04-02T09:00:00Z' })),
    vehicules: dossier.vehicules.map(enLigne),
    pieces: dossier.pieces.map(enLigne),
    immobilisations: dossier.immobilisations.map(enLigne),
    lignes_bancaires: dossier.lignes.map((l) => ({ ...enLigne(l), compte_bancaire_id: compte })),
    reglements_groupes: dossier.reglements.map(enLigne),
    operations_caisse: dossier.operations.map(enLigne),
    ecritures_brouillon: dossier.brouillon.map(enLigne),
  }
}

/** La sauvegarde entière, au format que `lireSauvegarde` relit et que `restaurerSauvegarde` réinsère. */
export function sauvegardeDeDemonstration(cabinetId: string): SauvegardeDossier {
  const contenu = contenuDeLaSauvegarde(composerLeDossier(), cabinetId)
  const manifeste: Manifeste = {
    version: VERSION_SAUVEGARDE,
    dossierId: D,
    dossierNom: NOM_DE_LA_DEMONSTRATION,
    cabinetId,
    faiteLe: FAITE_LE,
    lignesParTable: Object.fromEntries(Object.entries(contenu).map(([t, l]) => [t, l.length])),
    comptes: comptesRequis(contenu),
    referencesExternes: referencesExternes(contenu),
    liensPerdus: liensPerdus(contenu),
    horsPerimetre: [
      'Dossier FICTIF de démonstration, composé par outils/demonstration (aucune donnée réelle) : il n’a jamais été lu d’une base.',
      'Aucun fichier de pièce : chaque pièce porte un chemin et une empreinte fabriqués, et sa fiche dit le fichier absent.',
      'Aucun exercice validé, aucune connexion bancaire ni de plateforme, aucun accès client, aucune facture émise.',
      'Les catégories citées sont cinq catégories communes, que la base d’arrivée doit porter (`referencesExternes`).',
    ],
    // Format 2 : aucun logo désigné, aucun fichier porté.
    logos: { inclus: [], manquants: [] },
  }
  return { manifeste, contenu, fichiers: [] }
}

// ── Les contrôles de l'application, sur des lignes (composées, ou relues d'une base après restauration) ──────────────────
export interface ControlesDuDossier {
  /** Les points de la Vue d'ensemble au 16/11/2026 (`pointsDeLaChecklist`, l'appel de ChecklistTab). */
  checklist: PointATraiter[]
  declaration2025: Declaration2035
  /** Les cases non nulles de la 2035 de 2025. */
  cases2025: Record<string, number>
  concordance2025: Concordance2035
  /** Le contrôle de solde de chaque relevé, refait sur ses mouvements : les relevés dont l'écart n'est pas nul. */
  relevesEnEcart: string[]
  /** Les préalables de la validation de 2025, au 16/11/2026 (`prealablesDeValidation`) : « bloquant id » ou « avertissement id ». */
  prealables2025: string[]
  validable2025: boolean
}

const comme = <T>(lignes: Ligne[] | undefined): T[] => (lignes ?? []) as unknown as T[]

/** Les contrôles que l'application fait, sur les lignes d'un dossier et les catégories que la base d'arrivée porte. */
export function controlesDuDossier(contenu: Record<string, Ligne[]>, categories: readonly Categorie[]): ControlesDuDossier {
  const piecesToutes = comme<Piece>(contenu.pieces)
  const piecesValidees = piecesToutes.filter((p) => p.statut === 'validee')
  const piecesAValider = piecesToutes.filter((p) => p.statut === 'a_valider')
  const lignes = comme<LigneBancaire>(contenu.lignes_bancaires)
  const controles = comme<ControleReleveBancaire>(contenu.controles_releves_bancaires)
  const reglements = comme<ReglementGroupe>(contenu.reglements_groupes)
  const operations = comme<OperationCaisse>(contenu.operations_caisse)
  const cotisations = comme<CotisationDeclaree>(contenu.cotisations_declarees)
  const immobilisations = comme<Immobilisation>(contenu.immobilisations)
  const natures = comme<NatureImmobilisation>(contenu.natures_immobilisation)
  const vehicules = comme<VehiculeDossier>(contenu.vehicules)
  const aNouveaux = comme<ANouveau>(contenu.a_nouveaux)
  const ecritures = comme<EcritureBrouillon>(contenu.ecritures_brouillon)
  const cats = [...categories]

  const caisse: CaisseLue = { dossierId: D, enBase: true, lignes: operations, complete: true, motif: null }
  const recettesDeCaisse = recettesPourLesMoteurs(recettesDeCaisseDuDossier(caisse, D, cats, ASSUJETTI))
  const operationsDeCaisse = operationsPourLesControles(operationsDeCaisseDuDossier(caisse, D))
  const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(caisse, D)
  if (recettesDeCaisse === null || operationsDeCaisse === null || paiementsDeLaCaisse === null) throw new Error('La caisse ne se lit pas.')
  const paiements = paiementsDesPieces(lignes, reglements, [], paiementsDeLaCaisse)
  const ventes = ventesFacturees({ piecesCitees: AUCUNE_PIECE_CITEE, dossierId: D, factures: [], lignes: [], encaissements: [], parts: [], acomptes: SANS_ACOMPTE })
  const banques = banquesDuDossier({ etat: 'sans_objet' }, PLAN)
  const pourLa2035 = ecrituresDesVentesPourLa2035({
    dossierId: D, ventesParLesFactures: false, facturesSources: ventes.sources, lecture: null, mode: MODELE.mode, plan: PLAN, banques,
  })
  if (pourLa2035.etat !== 'pret') throw new Error(`Les ventes de la 2035 ne sont pas prêtes : ${pourLa2035.etat}`)
  const comptees = cotisationsComptees(cotisations, lignes, MODELE.mode)
  const partsReleve = partsDuReleve(lignes, cats, [], ASSUJETTI)
  const declaration2025 = calculerDeclaration2035(2025, piecesValidees, cats, immobilisations, comptees, vehicules, ASSUJETTI, paiements, partsReleve, [], PLAN, ventes, pourLa2035.ecritures, recettesDeCaisse, ECRITURES_LIBRES_ABSENTES)
  const concordance2025 = concordance2035(declaration2025, ecritures.filter((e) => e.date.startsWith('2025-')), {
    piecesValidees: new Set(piecesValidees.map((x) => x.id)), piecesImmobilisees: new Set(immobilisations.map((i) => i.piece_id ?? '')),
    mouvementsDesVentesFacturees: mouvementsClassesParEncaissements(lignes),
  }, null)

  const banque = banqueDesLecteurs(PLAN, banques)
  const checklist = pointsDeLaChecklist({
      notesDeFrais: { etat: 'sans_objet' as const },
    piecesValidees, piecesAValider, cotisations, lignes, relevesIncoherents: relevesIncoherentsDe(controles), controlesReleves: controles,
    comptesBancaires: { etat: 'sans_objet' }, doublonsTexte: [], immobilisations, natures: [...natures], categories: cats, ecritures,
    emprunts: [], ventilations: [], ventilationsPartielles: false, reglements, reglementsPartiels: false, paiementsPartiels: false,
    lettragesManuels: [], vehicules, declarationsTva: [], declarationsPartielles: false, facturesEmises: [], transmissions: [],
    jumellesPartielles: false, facturesSources: facturesSourcesDe([]), info: null, infoInconnue: null, anneesCloturees: [],
    ouverture: banque === null ? null : ouvertureBanque(aNouveaux, banque), ouvertureIncomplete: null, aNouveaux, soldesReportes: [],
    entreesDeLOuvertureIncompletes: null, ventesFacturees: null, caisse, entreesDeLaCaisseIncompletes: null,
    entreesDeLaRepriseDesBiensIncompletes: null, inventaire: { etat: 'sans_objet' }, assuranceMaladie: null,
  }, {
    assujettiTva: ASSUJETTI, periodiciteTva: 'trimestrielle', statutTva: 'exonere', modele: MODELE, frontiere: null, anneesValidees: [],
    aujourdHui: AUJOURD_HUI, anneeCourante: 2026, moisEcoules: 10, premierJourDuMois: '2026-11-01', offreAssuranceMaladie: { codeNaf: null, moduleOuvert: false },
  }).tousLesPointsATraiter

  const relevesEnEcart = controles.filter((k) => {
    const somme = lignes.filter((l) => l.source_fichier === k.source_fichier).reduce((s, l) => s + Math.round(Number(l.montant) * 100), 0)
    return Math.round(Number(k.solde_initial) * 100) + somme !== Math.round(Number(k.solde_final) * 100)
  }).map((k) => String(k.source_fichier))

  // Les préalables de la validation de 2025, comme la carte de la Clôture les dit avant le clic (la répétition les appelle ainsi).
  const validation = prealablesDeValidation({
      notesDeFrais: { etat: 'sans_objet' as const },
    annee: 2025, anneeCourante: 2026, aujourdHui: AUJOURD_HUI, modele: MODELE, assujettiTva: ASSUJETTI, anneesValidees: [],
    lectureIncomplete: null, ecrituresLibres: ECRITURES_LIBRES_ABSENTES, piecesValidees, piecesAValider, categories: cats, immobilisations, natures: [...natures], ecritures, lignes,
    ventilations: [], reglements, encaissees: [], cotisations, vehicules, emprunts: [], aNouveaux, soldesReportes: [], declarationsTva: [],
    periodiciteTva: 'trimestrielle', comptesBancaires: { etat: 'sans_objet' }, controlesReleves: controles, doublonsTexte: [], facturesEmises: [],
    transmissions: [], facturesSources: ventes.sources, piecesCitees: ventes.piecesCitees,
    // Un dossier non basculé : sans objet, comme l'onglet Clôture le pose (ClotureTab, `etatsDesVentes`).
    etatsDesVentes: { etat: 'sans_objet' },
    ventesDeLaChecklist: ventesDeLaChecklist(null, null), operationsDeCaisse, champsBnc: CHAMPS_BNC_NON_EXPORTES,
    declaration: declaration2025, saisies2035: AUCUNE_SAISIE_2035, inventaire: INVENTAIRE_SANS_OBJET, concordance: concordance2025,
  })

  return {
    prealables2025: validation.prealables.map((x) => `${x.bloquant ? 'bloquant' : 'avertissement'} ${x.id}`), validable2025: validation.validable,
    checklist, declaration2025, cases2025: Object.fromEntries([...valeursDesCases(declaration2025, AUCUNE_SAISIE_2035).valeurs].filter(([, v]) => v !== 0)),
    concordance2025, relevesEnEcart,
  }
}

/** Le résumé d'un point, tel que le rapport et le test le lisent. */
export const resumeDuPoint = (p: PointATraiter) => `${p.severite} ${p.id} (${p.nb})`
