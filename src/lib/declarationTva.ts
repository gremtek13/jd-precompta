import { piecesDeviseNonConvertie, piecesTvaImpossible, LIBELLE_MOTIF_TVA } from './controles'
import { ajouterJours, ajouterMois, dateLocaleDe, dernierJourDuMois } from './format'
import { montantRetenu } from './montantRetenu'
import type { PartDuReleve } from './partsDuReleve'
import type { RecetteDeCaisse, RecettesDeCaisse } from './recettesDeCaisse'
import {
  centimesParDate, rattachementsTresorerie, type PaiementDePiece, type PaiementsDesPieces, type Rattachement,
} from './rattachement'
import { horsTaxeEtTva } from './tvaDuReleve'
import type { DeclarationTva, PeriodiciteTva, Piece } from './types'
import {
  exemplaireDUneFactureSource, type ExigibiliteVenteFacturee, type VenteEcartee, type VentesFacturees,
} from './ventesFacturees'

// LA CA3 CASE PAR CASE — le formulaire 3310-CA3-SD (millésime 2026), préparé depuis les pièces
// validées et les paiements qui les rattachent au relevé bancaire.
//
// C'est le socle de la télédéclaration (ligne 28 de la feuille de route) : quel que soit le
// partenaire EDI retenu, il faut lui remettre une valeur par case, et le cabinet peut la reporter à
// la main dans l'espace professionnel en attendant. Il n'y a qu'une déclaration à préparer à partir de
// 2027 : le régime simplifié (CA12 annuelle) est supprimé au 1er janvier 2027 (loi de finances 2025,
// art. 38), la CA3 devient trimestrielle sous 1 000 000 € de chiffre d'affaires, mensuelle sur
// demande. La dernière CA12, celle de 2026, n'est pas préparée ici.
//
// QUELLE PÉRIODE UNE PIÈCE REJOINT — l'exigibilité, décidée ici et nulle part ailleurs :
//   - une RECETTE est une prestation de services : sa TVA est due à l'ENCAISSEMENT, donc à la date du
//     mouvement bancaire qui la paie. Sur option pour les débits, elle est due à la date de la facture.
//   - une DÉPENSE déduit sa TVA au PAIEMENT. Pour un service c'est la règle ; pour un bien acheté puis
//     payé plus tard, la déduction arrive après le mois où elle était possible, ce que la loi admet
//     (une déduction omise se rattrape jusqu'au 31 décembre de la deuxième année suivante). Elle
//     n'arrive jamais trop tôt, sauf pour un bien payé avant d'être livré.
//   - une NOTE DE FRAIS se paie hors du compte professionnel : elle compte à sa date, sauf si un
//     mouvement la rattache au relevé — et la part qu'un remboursement partiel laisse au dirigeant compte
//     encore à sa date : c'est lui qui l'a payée.
//   - une pièce payée en plusieurs fois compte pour la part de chaque paiement (`rattachementsTresorerie`,
//     lib/rattachement.ts, la même règle que la 2035 et que les écritures) : une pièce réglée à l'écart
//     d'alignement près compte en entier, des frais bancaires ne la font pas compter plus d'une fois, et
//     un paiement partiel ne rend exigible que ce qui a été payé.
// Une pièce qu'aucun paiement ne date ne compte dans AUCUNE déclaration, et elle est rendue à part
// (`nonPlacees`) : se taire sur elle ferait passer une recette oubliée pour une recette inexistante.
//
// LES MONTANTS SONT CEUX DU BROUILLON, AU CENTIME (ligne 26.8) : la déclaration enregistrée se LIQUIDE —
// une écriture retire des comptes 445710, 445660 et 445620 la TVA de la période (lib/liquidationTva.ts) —,
// et ce qu'elle retire doit être ce que les écritures des pièces y ont porté, sans quoi un centime resterait
// sur ces comptes à chaque période, que rien ne solderait. Chaque pièce y entre donc par la répartition de
// son écriture (`centimesParDate`, lib/rattachement.ts : la charge et la TVA réparties ENSEMBLE, date par
// date), et la CA3 tire ses lignes des mêmes centimes. Seul l'arrondi à l'euro de chaque ligne sépare ce
// qui se déclare de ce que les comptes portent : la liquidation le passe au 658000 ou au 758000.
//
// LES RECETTES DU RELEVÉ — affectées ou ventilées sans facture (lib/tvaDuReleve.ts) — comptent à la date
// de leur ENCAISSEMENT, la seule qu'elles ont, à leur taux : le hors taxe sur la ligne du taux, la TVA à
// côté, et une recette exonérée en E2. Deux cas les écartent, et l'écran les montre : une recette sans
// taux (affectée avant que le dossier devienne assujetti), et toute recette du relevé sur option pour les
// débits — la TVA y est due à la date de la facture, que le relevé ne donne pas.
//
// LES VENTES FACTURÉES (ligne 28.6, chantier EC-Q3, étape VF3b2 ; conception : HISTORIQUE.md, « LA FACTURE VALIDÉE, SOURCE
// DE SA VENTE : LA CONCEPTION », § 6 et 8). Une facture validée SOURCE de sa vente compte par ses EXIGIBILITÉS
// (lib/ventesFacturees.ts) : des services à chaque encaissement ; un bien à sa livraison, un acompte d'avant à sa
// perception ; sur l'option pour les débits à la date de la facture, un acompte d'avant à sa perception ; un avoir d'après
// à sa date. Chacune compte dans la période de sa date, à son taux, pour la base et la TVA que le module porte — la règle
// du cumul, qu'aucun recalcul ici ne doit défaire (un taux soldé porte exactement la TVA facturée). Le RÉGIME est celui
// que la facture a figé à sa validation (`nature_operation`, `option_debits`), jamais l'option d'aujourd'hui du dossier :
// `surDebits` ne s'applique pas à elles. Le taux à sa ligne ; 2,1 % se place à la main, comme pour une pièce ; 0 %, une
// opération non imposable (E2) ; une exigibilité négative, une régularisation (B5 et 21 ; F8 à 0 %), jamais une somme
// négative sur la ligne d'un taux. La pièce désignée comme l'EXEMPLAIRE d'une facture source ne compte plus, ni comme
// opération, ni comme pièce à valider : sa facture compte la vente. Elle se dit, dans la période où elle aurait compté.
// LEURS ÉCRITURES (étape VF4c3) portent au compte de la TVA collectée EXACTEMENT la TVA de ces exigibilités, à leur date
// (lib/ecrituresVentesFacturees.ts, qui la lit du même module sans la recalculer) : elles entrent dans `tvaDesComptes`, et
// la liquidation les solde. Une période ne s'enregistre que quand les écritures de ses ventes facturées sont à jour
// (`refusEnregistrement`, lib/liquidationTva.ts) — sinon le compte ne porterait pas ce que la liquidation retire. La TVA
// en attente d'un dossier en engagement (445800) n'y entre pas : elle ne passe au 445710 qu'à son exigibilité.
//
// LE REMBOURSEMENT D'UN CRÉDIT (ligne 26, formulaire 3519) se demande : c'est le cabinet qui le choisit, dans
// la limite du crédit de la période (ligne 25), et le reste se reporte (ligne 27). Sa liquidation le porte au
// 445830, que le virement du Trésor solde (lib/liquidationTva.ts).
//
// CE QUE CE CALCUL NE FAIT PAS, et l'écran le dit : l'autoliquidation (services achetés à un
// fournisseur étranger, lignes A3 et B4), le coefficient de déduction d'une activité en partie
// exonérée, les exclusions du droit à déduction (véhicule de tourisme, carburant en partie, cadeaux),
// les taux particuliers (Corse, 2,1 %), les taxes assimilées (ligne 29) et la régularisation d'une
// période déjà déposée (lignes 5B et 2C).

export type LigneTaux = '08' | '09' | '9B' | '10'

// Les taux reconnus, et la ligne où leur base et leur taxe se déclarent. 8,5 % n'existe que dans les
// DOM, donc sa ligne ne fait pas de doute. 2,1 % en fait trois (T6 en France continentale, 11 dans les
// DOM, T4 en Corse) : il n'est jamais placé d'office.
export const TAUX_RECONNUS: { taux: number; ligne: LigneTaux }[] = [
  { taux: 20, ligne: '08' },
  { taux: 10, ligne: '9B' },
  { taux: 5.5, ligne: '09' },
  { taux: 8.5, ligne: '10' },
]
const TAUX_A_PLACER = 2.1

// Une facture arrondit sa TVA ligne à ligne, parfois sur des dizaines de lignes : quelques centimes
// d'écart avec le taux exact sont normaux. Au-delà de 0,05 % du hors taxe, la facture porte sans doute
// plusieurs taux, et la ranger sous un seul fausserait la base de chacun.
function tauxCorrespond(ht: number, tva: number, taux: number): boolean {
  return Math.abs(tva - (ht * taux) / 100) <= Math.max(0.02, Math.abs(ht) * 0.0005)
}

export function ligneDuTaux(ht: number, tva: number): LigneTaux | 'taux_a_placer' | null {
  const a = Math.abs(ht)
  const t = Math.abs(tva)
  const reconnu = TAUX_RECONNUS.find((r) => tauxCorrespond(a, t, r.taux))
  if (reconnu) return reconnu.ligne
  return tauxCorrespond(a, t, TAUX_A_PLACER) ? 'taux_a_placer' : null
}

// ── Périodes ────────────────────────────────────────────────────────────────────────────────────

export interface PeriodeTva {
  debut: string
  fin: string
  libelle: string
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

function periodeDuMois(annee: number, mois: number): PeriodeTva {
  const debut = `${annee}-${String(mois).padStart(2, '0')}-01`
  return { debut, fin: dernierJourDuMois(debut), libelle: `${MOIS[mois - 1]} ${annee}` }
}

function periodeDuTrimestre(annee: number, trimestre: number): PeriodeTva {
  const debut = `${annee}-${String(trimestre * 3 - 2).padStart(2, '0')}-01`
  return {
    debut,
    fin: dernierJourDuMois(ajouterMois(debut, 2)),
    libelle: `${trimestre === 1 ? '1er' : `${trimestre}e`} trimestre ${annee}`,
  }
}

export function periodesDeLAnnee(annee: number, periodicite: PeriodiciteTva): PeriodeTva[] {
  return periodicite === 'mensuelle'
    ? Array.from({ length: 12 }, (_, i) => periodeDuMois(annee, i + 1))
    : Array.from({ length: 4 }, (_, i) => periodeDuTrimestre(annee, i + 1))
}

// Le nom d'une période déposée : « 1er trimestre 2027 », « mars 2027 », ou ses deux dates quand elle
// n'est ni un mois ni un trimestre (une déclaration saisie à la main avant ce calcul).
export function libellePeriode(debut: string, fin: string): string {
  const annee = Number(debut.slice(0, 4))
  const connue = [...periodesDeLAnnee(annee, 'mensuelle'), ...periodesDeLAnnee(annee, 'trimestrielle')]
    .find((p) => p.debut === debut && p.fin === fin)
  return connue?.libelle ?? `du ${debut.split('-').reverse().join('/')} au ${fin.split('-').reverse().join('/')}`
}

// Le nom d'une période précédé de sa préposition : « la déclaration du 3e trimestre 2026 », « d’octobre 2025 »,
// « de mars 2026 ». Un trimestre prend l'article, un mois non, et une période hors calendrier se dit déjà « du … au … ».
// Écrire « du » partout donnait « la déclaration du octobre 2025 ».
export function dePeriode(libelle: string): string {
  if (libelle.startsWith('du ')) return libelle
  if (libelle.includes('trimestre')) return `du ${libelle}`
  return /^[aeiouyàâéèêîïôû]/i.test(libelle) ? `d’${libelle}` : `de ${libelle}`
}

// La période qu'on déclare à une date donnée : la dernière qui est TERMINÉE. Le 28 septembre, c'est
// le deuxième trimestre, pas le troisième, qui court encore.
export function dernierePeriodeClose(aujourdHui: string, periodicite: PeriodiciteTva): PeriodeTva {
  const debutPeriodeEnCours = periodicite === 'mensuelle'
    ? `${aujourdHui.slice(0, 7)}-01`
    : `${aujourdHui.slice(0, 4)}-${String(Math.floor((Number(aujourdHui.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
  const veille = ajouterJours(debutPeriodeEnCours, -1)
  const annee = Number(veille.slice(0, 4))
  const mois = Number(veille.slice(5, 7))
  return periodicite === 'mensuelle' ? periodeDuMois(annee, mois) : periodeDuTrimestre(annee, Math.ceil(mois / 3))
}

// ── Exigibilité ─────────────────────────────────────────────────────────────────────────────────

export type MotifNonPlacee = 'non_rapprochee' | 'sans_date'

// Une part de la pièce que la CA3 compte : un PAIEMENT, ou la part d'une note de frais que le dirigeant a payée —
// jamais le reste d'un paiement partiel (`sans_paiement`), que la 2035 suppose payé à la date de facture mais qui
// n'est exigible nulle part : un acompte ne rend exigible que ce qu'il paie. Et jamais une part sans date.
function compteeParLaCa3(r: Rattachement): boolean {
  return r.date !== null && (r.source === 'paiement' || r.source === 'note_de_frais')
}

// Les parts d'une pièce que la CA3 date, ou pourquoi aucune. Elles viennent de `rattachementsTresorerie`
// (lib/rattachement.ts), qui les rend aussi à la 2035 et aux écritures : c'est la même question, et une règle
// écrite deux fois n'attend que de diverger.
function partsExigibles(piece: Piece, paiements: readonly PaiementDePiece[], surDebits: boolean): Rattachement[] | MotifNonPlacee {
  if (piece.type_piece === 'vente' && surDebits) {
    return piece.date_piece ? [{ date: piece.date_piece, part: 1, source: 'facture' }] : 'sans_date'
  }
  const rattachements = rattachementsTresorerie(piece, paiements)
  if (!rattachements.some((r) => r.source === 'paiement' || r.source === 'note_de_frais')) return 'non_rapprochee'
  const comptees = rattachements.filter(compteeParLaCa3)
  return comptees.length > 0 ? comptees : 'sans_date'
}

interface CentimesDeLaPeriode {
  // La base (la charge ou le produit) et la TVA que la période compte, en centimes, signées comme la pièce.
  base: number
  tva: number
}

// CE QU'UNE PIÈCE PORTE DANS LA PÉRIODE, AU CENTIME DE SON ÉCRITURE. L'écriture d'une pièce répartit sa charge et
// sa TVA ENSEMBLE, date par date (`centimesParDate`, lib/ecritures.ts) : la TVA d'une date est ce qui complète la
// charge de cette date. La période en prend les dates qu'elle couvre, pour la part que la CA3 compte — toute la
// date d'un paiement ; d'une date que partagent un paiement et le reste d'un paiement partiel, la part payée
// seulement, arrondie au centime. Sur option pour les débits, une recette compte en entier à la date de sa facture.
function centimesDeLaPeriode(
  piece: Piece, charge: number, tva: number, paiements: readonly PaiementDePiece[], surDebits: boolean,
  periode: { debut: string; fin: string },
): CentimesDeLaPeriode {
  if (piece.type_piece === 'vente' && surDebits) {
    if (!piece.date_piece || piece.date_piece < periode.debut || piece.date_piece > periode.fin) return { base: 0, tva: 0 }
    const base = Math.round(charge * 100)
    return { base, tva: Math.round((charge + tva) * 100) - base }
  }
  const rattachements = rattachementsTresorerie(piece, paiements)
  const repli = dateLocaleDe(piece.created_at)
  const charges = centimesParDate(piece, charge, paiements)
  const toutCompris = centimesParDate(piece, charge + tva, paiements)
  let base = 0
  let taxe = 0
  charges.forEach((m, i) => {
    if (m.date < periode.debut || m.date > periode.fin) return
    const aLaDate = rattachements.filter((r) => (r.date ?? repli) === m.date)
    const tout = aLaDate.reduce((s, r) => s + r.part, 0)
    const comptee = aLaDate.filter(compteeParLaCa3).reduce((s, r) => s + r.part, 0)
    if (comptee === 0) return
    const tvaDeLaDate = toutCompris[i].centimes - m.centimes
    if (comptee >= tout - 1e-12) {
      base += m.centimes
      taxe += tvaDeLaDate
    } else {
      base += Math.round((m.centimes * comptee) / tout)
      taxe += Math.round((tvaDeLaDate * comptee) / tout)
    }
  })
  return { base, tva: taxe }
}

// ── La déclaration ──────────────────────────────────────────────────────────────────────────────

// Les montants de la déclaration, en EUROS ENTIERS : « la base imposable et le montant de l'impôt
// sont arrondis à l'euro le plus proche » (notice 3310-CA3), ligne par ligne. Jamais négatifs non
// plus : un avoir ne se retranche pas d'une ligne, il a la sienne (B5 et 21 pour un avoir consenti à
// un client, 15 pour un avoir reçu d'un fournisseur).
export interface CasesCa3 {
  A1: number // ventes, prestations de services (0979)
  B5: number // régularisations du chiffre d'affaires taxé : avoirs consentis (0036)
  E2: number // autres opérations non imposables (0033)
  F8: number // régularisations des opérations non imposables (0039)
  base08: number
  taxe08: number // taux normal 20 % (0207)
  base09: number
  taxe09: number // taux réduit 5,5 % (0105)
  base9B: number
  taxe9B: number // taux réduit 10 % (0151)
  base10: number
  taxe10: number // DOM, taux normal 8,5 % (0201)
  l15: number // TVA antérieurement déduite à reverser : avoirs reçus (0600)
  l16: number // total de la TVA brute due
  l19: number // TVA déductible, biens constituant des immobilisations (0703)
  l20: number // TVA déductible, autres biens et services (0702)
  l21: number // autre TVA à déduire : avoirs consentis (0059)
  l22: number // report du crédit de la déclaration précédente (8001)
  l23: number // total TVA déductible
  l25: number // crédit de TVA (0705)
  lTD: number // TVA due (8900)
  l26: number // remboursement de crédit demandé, formulaire 3519 (8002)
  l27: number // crédit à reporter, ligne 25 moins ligne 26 (8003)
  l28: number // TVA nette due (8901)
  l32: number // total à payer (9992)
}

// Une ligne telle que l'écran la montre : le numéro imprimé sur le formulaire, son libellé, et le code
// de la case, celui qu'un partenaire EDI attend (dans la forme qu'il se donne).
export interface LigneAffichee {
  ligne: string
  libelle: string
  code: string
  cadre: 'operations' | 'brute' | 'deductible' | 'solde'
  montant: keyof CasesCa3
  base?: keyof CasesCa3
}

export const LIGNES_CA3: LigneAffichee[] = [
  { ligne: 'A1', libelle: 'Ventes, prestations de services', code: '0979', cadre: 'operations', montant: 'A1' },
  { ligne: 'B5', libelle: "Régularisations (avoirs consentis sur des opérations taxées)", code: '0036', cadre: 'operations', montant: 'B5' },
  { ligne: 'E2', libelle: 'Autres opérations non imposables', code: '0033', cadre: 'operations', montant: 'E2' },
  { ligne: 'F8', libelle: 'Régularisations (avoirs sur des opérations non imposables)', code: '0039', cadre: 'operations', montant: 'F8' },
  { ligne: '08', libelle: 'Taux normal 20 %', code: '0207', cadre: 'brute', base: 'base08', montant: 'taxe08' },
  { ligne: '09', libelle: 'Taux réduit 5,5 %', code: '0105', cadre: 'brute', base: 'base09', montant: 'taxe09' },
  { ligne: '9B', libelle: 'Taux réduit 10 %', code: '0151', cadre: 'brute', base: 'base9B', montant: 'taxe9B' },
  { ligne: '10', libelle: 'DOM, taux normal 8,5 %', code: '0201', cadre: 'brute', base: 'base10', montant: 'taxe10' },
  { ligne: '15', libelle: 'TVA antérieurement déduite à reverser (avoirs reçus)', code: '0600', cadre: 'brute', montant: 'l15' },
  { ligne: '16', libelle: 'Total de la TVA brute due', code: '', cadre: 'brute', montant: 'l16' },
  { ligne: '19', libelle: 'Biens constituant des immobilisations', code: '0703', cadre: 'deductible', montant: 'l19' },
  { ligne: '20', libelle: 'Autres biens et services', code: '0702', cadre: 'deductible', montant: 'l20' },
  { ligne: '21', libelle: 'Autre TVA à déduire (dont régularisation de TVA collectée)', code: '0059', cadre: 'deductible', montant: 'l21' },
  { ligne: '22', libelle: 'Report du crédit de la déclaration précédente (ligne 27)', code: '8001', cadre: 'deductible', montant: 'l22' },
  { ligne: '23', libelle: 'Total TVA déductible', code: '', cadre: 'deductible', montant: 'l23' },
  { ligne: '25', libelle: 'Crédit de TVA (ligne 23 − ligne 16)', code: '0705', cadre: 'solde', montant: 'l25' },
  { ligne: 'TD', libelle: 'TVA due (ligne 16 − ligne 23)', code: '8900', cadre: 'solde', montant: 'lTD' },
  { ligne: '26', libelle: 'Remboursement de crédit demandé (formulaire 3519)', code: '8002', cadre: 'solde', montant: 'l26' },
  { ligne: '27', libelle: 'Crédit de TVA à reporter (ligne 25 − ligne 26)', code: '8003', cadre: 'solde', montant: 'l27' },
  { ligne: '28', libelle: 'TVA nette due', code: '8901', cadre: 'solde', montant: 'l28' },
  { ligne: '32', libelle: 'Total à payer', code: '9992', cadre: 'solde', montant: 'l32' },
]

export type MotifEcart = 'tva_impossible' | 'devise_non_convertie' | 'tva_non_lue' | 'taux_non_reconnu' | 'taux_a_placer' | 'montants_incomplets'

// Une pièce que la période concerne, mais qu'on ne sait pas mettre dans une case sans deviner : elle
// est rendue avec sa part et ses montants, pour que le cabinet la reporte lui-même s'il la retient.
export interface PieceEcartee {
  piece: Piece
  motif: MotifEcart
  detail: string
  part: number
}

// Une pièce retenue, et la ligne où elle est allée : c'est ce qui permet de refaire le chemin d'une
// case jusqu'aux justificatifs.
export interface PieceRetenue {
  piece: Piece
  part: number
  ligne: LigneTaux | 'E2' | 'F8' | 'B5' | '15' | '19' | '20'
}

// Une recette du relevé retenue — un mouvement affecté ou une part ventilée —, et sa ligne. Un
// remboursement versé à un client (une sortie sur une catégorie de recettes) se déclare comme un avoir
// consenti : sa base en B5, sa taxe en 21.
export interface RecetteDuReleveRetenue {
  part: PartDuReleve
  ligne: LigneTaux | 'E2' | 'F8' | 'B5'
}

export type MotifReleveEcarte = 'sans_taux' | 'sur_debits'

export interface RecetteDuReleveEcartee {
  part: PartDuReleve
  motif: MotifReleveEcarte
  detail: string
}

export const LIBELLE_MOTIF_RELEVE: Record<MotifReleveEcarte, string> = {
  sans_taux: "recette du relevé sans taux de TVA, affectée avant que le dossier devienne assujetti : réaffecte-la en choisissant son taux",
  sur_debits: "sur option pour les débits, la TVA est due à la date de la facture, que le relevé ne donne pas",
}

// UNE RECETTE DE CAISSE retenue (étape C3a ; lib/recettesDeCaisse.ts), et sa ligne — comme une recette du relevé : des
// espèces rendues se déclarent comme un avoir consenti, leur base en B5 et leur taxe en 21 ; à 0 %, en F8.
export interface RecetteDeCaisseRetenue {
  recette: RecetteDeCaisse
  ligne: LigneTaux | 'E2' | 'F8' | 'B5'
}

export interface RecetteDeCaisseEcartee {
  recette: RecetteDeCaisse
  motif: MotifReleveEcarte
  detail: string
}

// Les motifs d'une recette du relevé, dits pour la caisse : son taux manque (saisie avant que le dossier devienne
// assujetti — la base ne lui en a pas demandé), ou l'option pour les débits, que la CA3 du relevé écarte de même.
export const LIBELLE_MOTIF_CAISSE: Record<MotifReleveEcarte, string> = {
  sans_taux: 'recette de caisse sans taux de TVA, saisie avant que le dossier devienne assujetti : retire-la et saisis-la de nouveau avec son taux',
  sur_debits: 'sur option pour les débits, la CA3 de l’application n’exige pas une recette sans facture à sa date d’encaissement : à reporter à la main',
}

export interface PieceNonPlacee {
  piece: Piece
  motif: MotifNonPlacee
}

// L'exigibilité d'une vente facturée retenue, et la ligne où elle est allée : de la case jusqu'à la facture et à son
// encaissement, sa livraison, sa date ou son avoir. Une régularisation se déclare comme un avoir consenti : sa base en B5,
// sa taxe en 21 ; à 0 %, en F8.
export interface ExigibiliteRetenue {
  exigibilite: ExigibiliteVenteFacturee
  ligne: LigneTaux | 'E2' | 'F8' | 'B5'
}

export type MotifExigibiliteEcartee = 'taux_a_placer' | 'taux_non_reconnu'

// L'exigibilité d'une vente facturée qu'on ne sait pas mettre dans une case sans deviner : un taux que la facture porte, que
// la DGFiP admet (G1.24), mais qui n'a pas de ligne certaine sur la CA3 de l'application — 2,1 % en a trois, et les taux de
// la Corse ou d'outre-mer n'y sont pas. Rendue avec sa base et sa taxe, pour que le cabinet la reporte lui-même.
export interface ExigibiliteEcartee {
  exigibilite: ExigibiliteVenteFacturee
  motif: MotifExigibiliteEcartee
  detail: string
}

export const LIBELLE_MOTIF_EXIGIBILITE: Record<MotifExigibiliteEcartee, string> = {
  taux_a_placer: '2,1 % : ligne T6 en France continentale, 11 dans les DOM, T4 en Corse',
  taux_non_reconnu: 'un taux que la CA3 de l’application ne range sur aucune ligne (Corse, outre-mer, taux anciens) : à reporter à la main',
}

export interface DeclarationCa3 {
  periode: { debut: string; fin: string }
  cases: CasesCa3
  // La TVA nette DE LA PÉRIODE — ligne 16 moins lignes 19 à 21, sans le crédit reporté : c'est ce
  // qu'on enregistre comme « déclaré », et ce à quoi un recalcul se compare.
  netPeriode: number
  // Aucune case remplie : la déclaration se dépose « néant » (case 0010).
  neant: boolean
  retenues: PieceRetenue[]
  ecartees: PieceEcartee[]
  // Pièces encore à valider qui ont un paiement (ou une date, selon la règle) dans la période.
  aValider: Piece[]
  // Pièces validées qu'aucun paiement ne date, datées au plus tard de la fin de la période.
  nonPlacees: PieceNonPlacee[]
  // Achats en devise, sans TVA, payés dans la période : si ce sont des services achetés à un
  // fournisseur étranger, la TVA est à autoliquider (ligne A3), ce que ce calcul ne fait pas.
  achatsEnDeviseSansTva: Piece[]
  // Les recettes du relevé encaissées dans la période : retenues à leur taux, ou écartées avec leur motif.
  releveRetenues: RecetteDuReleveRetenue[]
  releveEcartees: RecetteDuReleveEcartee[]
  // LES VENTES FACTURÉES DE LA PÉRIODE (lib/ventesFacturees.ts) : leurs exigibilités datées dans la période, retenues à leur
  // ligne ou écartées avec leur motif. Leur TVA est au 445710 dès que leurs écritures sont passées (étape VF4c3).
  exigibilitesRetenues: ExigibiliteRetenue[]
  exigibilitesEcartees: ExigibiliteEcartee[]
  // LES RECETTES DE CAISSE DE LA PÉRIODE (étape C3a) : retenues à leur ligne, ou écartées avec leur motif — vides quand la
  // caisse est absente. Leur TVA est au 445710 de leur écriture, que la base compose avec l'opération.
  caisseRetenues: RecetteDeCaisseRetenue[]
  caisseEcartees: RecetteDeCaisseEcartee[]
  // Les factures sources que le module ne sait pas compter sans deviner : rien d'elles n'entre, un vrai trou dans les
  // opérations. DU DOSSIER, TOUTES PÉRIODES : le module ne date pas une facture qu'il écarte — un acompte peut précéder la
  // facture —, et la dire dans une seule période la ferait taire dans les autres.
  ventesFactureesEcartees: VenteEcartee[]
  // Les pièces désignées comme l'exemplaire d'une facture source, que la CA3 ne compte plus et qu'elle DIT, dans la période
  // où elles auraient compté — par leur paiement, ou par leur date quand aucun paiement ne les date.
  exemplairesDeFacturesSources: Piece[]
  // CE QUE LA LIQUIDATION RETIRE DES COMPTES DE TVA, au centime, en euros (lib/liquidationTva.ts) : la TVA
  // collectée nette (445710), déductible (445660) et déductible sur immobilisations (445620) que portent les
  // écritures des pièces et des recettes du relevé retenues — signées comme ces écritures, un avoir en moins.
  // Ce qui sépare ces montants des lignes de la CA3 est l'arrondi à l'euro de chaque ligne, et lui seul. LA TVA DES
  // VENTES FACTURÉES Y EST (étape VF4c3) : celle de chaque exigibilité de la période, retenue ou écartée — leurs écritures
  // la portent toute au 445710, à sa date ; une exigibilité écartée, qu'aucune ligne ne déclare, retient l'enregistrement
  // (`refusEnregistrement`), qui attend aussi que ces écritures soient à jour.
  tvaDesComptes: TvaDesComptes
}

export interface TvaDesComptes {
  collectee: number
  deductible: number
  immobilisations: number
}

export interface DonneesTva {
  // Toutes les pièces du dossier, validées et à valider : les secondes ne comptent pas, mais celles
  // que la période concerne sont rendues pour qu'on les valide avant de déposer.
  pieces: Piece[]
  // Les paiements de chaque pièce, parts de virements groupés comprises (`paiementsDesPieces`) : une
  // facture réglée avec d'autres par un seul virement devient exigible ou déductible à la date de ce
  // virement, pour la part qui la règle.
  paiements: PaiementsDesPieces
  pieceIdsImmobilisees: ReadonlySet<string>
  // Les parts du relevé (`partsDuReleve`, assujettissement compris) : seules les RECETTES y comptent, les
  // dépenses sans facture n'ouvrant aucun droit à déduction. Sans valeur par défaut, comme partout : une
  // liste oubliée ferait disparaître de la CA3, en silence, la TVA collectée sur les encaissements.
  releve: readonly PartDuReleve[]
  // LES VENTES FACTURÉES du dossier (lib/ventesFacturees.ts, lues entières par lib/ventesFactureesLecture.ts) : une facture
  // validée SOURCE de sa vente compte par ses exigibilités, à leur date et sous le régime qu'elle a figé, et la pièce
  // désignée comme son exemplaire ne compte plus. Sans valeur par défaut, comme le reste : un appelant qui les oublierait
  // rendrait la CA3 d'un dossier qui facture dans l'application sans la TVA de ses ventes — plausible, sous-évaluée, et
  // déposée ; et des ventes vides par commodité compteraient l'exemplaire à la place de sa facture, c'est-à-dire la même
  // vente à la date du paiement de la pièce au lieu de celle de son exigibilité, et sous l'option d'aujourd'hui du dossier.
  ventesFacturees: VentesFacturees
  // LES RECETTES DE CAISSE du dossier (étape C3a ; lib/recettesDeCaisse.ts) : une recette en espèces sans facture, à sa date
  // et à son taux, comme une recette du relevé. Sans valeur par défaut : un appelant qui l'oublierait rendrait la CA3 d'un
  // praticien assujetti sans la TVA de ses espèces. Absente (le drapeau baissé), elle ne change rien.
  caisse: RecettesDeCaisse
}

const centimes = (euros: number) => Math.round(euros * 100)
// L'arrondi fiscal : moins de 0,50 € est négligé, 0,50 € et plus compte pour un euro. Les totaux sont
// tenus en centimes entiers jusqu'ici, pour que ce soit le SEUL arrondi à l'euro de la chaîne.
const arrondiFiscal = (totalCentimes: number) => Math.floor((totalCentimes + 50) / 100)

const LIBELLE_MOTIF_ECART: Record<Exclude<MotifEcart, 'tva_impossible'>, string> = {
  devise_non_convertie: "montant en devise jamais converti en euros",
  tva_non_lue: "la TVA n'a pas été lue : le hors taxe et le TTC diffèrent",
  taux_non_reconnu: 'aucun taux de TVA ne correspond : la facture porte peut-être plusieurs taux',
  taux_a_placer: '2,1 % : ligne T6 en France continentale, 11 dans les DOM, T4 en Corse',
  montants_incomplets: 'montants incomplets',
}

// `remboursement` : le remboursement de crédit que le cabinet demande (ligne 26), en euros. Sans valeur par défaut :
// la déclaration enregistrée le porte, et une liquidation sans lui laisserait au 445670 un crédit que le Trésor a
// remboursé. Ramené aux euros entiers de la déclaration et borné au crédit de la période (ligne 25) : au-delà, il
// ne se demande pas, et l'écran le dit (`refusEnregistrement`, lib/liquidationTva.ts).
export function calculerCa3(
  donnees: DonneesTva,
  periode: { debut: string; fin: string },
  surDebits: boolean,
  creditAnterieur: number,
  remboursement: number,
): DeclarationCa3 {
  const impossibles = new Map(piecesTvaImpossible(donnees.pieces).map((a) => [a.piece.id, a.motif]))
  // L'exemplaire d'une facture source sort plus bas, avant d'être jugé : le dire non converti ne changerait rien.
  const nonConverties = new Set(piecesDeviseNonConvertie(donnees.pieces, donnees.ventesFacturees.sources).map((p) => p.id))

  const cumul = {
    A1: 0, B5: 0, E2: 0, F8: 0,
    base08: 0, taxe08: 0, base09: 0, taxe09: 0, base9B: 0, taxe9B: 0, base10: 0, taxe10: 0,
    l15: 0, l19: 0, l20: 0, l21: 0,
  }
  const retenues: PieceRetenue[] = []
  const ecartees: PieceEcartee[] = []
  const aValider: Piece[] = []
  const nonPlacees: PieceNonPlacee[] = []
  const achatsEnDeviseSansTva: Piece[] = []
  const releveRetenues: RecetteDuReleveRetenue[] = []
  const releveEcartees: RecetteDuReleveEcartee[] = []
  const exigibilitesRetenues: ExigibiliteRetenue[] = []
  const exigibilitesEcartees: ExigibiliteEcartee[] = []
  const exemplairesDeFacturesSources: Piece[] = []
  // La TVA des comptes, en centimes signés comme les écritures (voir `tvaDesComptes`).
  const comptes = { collectee: 0, deductible: 0, immobilisations: 0 }
  const dansLaPeriode = (date: string) => date >= periode.debut && date <= periode.fin

  for (const piece of donnees.pieces) {
    const recette = piece.type_piece === 'vente'
    const paiements = donnees.paiements.get(piece.id) ?? []
    const parts = partsExigibles(piece, paiements, surDebits)
    // L'EXEMPLAIRE D'UNE FACTURE SOURCE NE COMPTE PLUS (§ 8) : sa facture compte la vente, par ses exigibilités, plus bas.
    // Il sort AVANT tout le reste — ni opération, ni pièce à valider, ni pièce sans paiement : rien n'y manque. Il se dit
    // dans la période où il aurait compté, par la même règle de date qu'une autre pièce ; quand aucun paiement ne le date, à
    // sa date de pièce, la première période où il se serait dit « rattaché à aucun paiement ».
    if (exemplaireDUneFactureSource(piece, donnees.ventesFacturees)) {
      const auraitCompte = typeof parts === 'string'
        ? piece.date_piece != null && dansLaPeriode(piece.date_piece)
        : parts.filter((f) => dansLaPeriode(f.date!)).reduce((s, f) => s + f.part, 0) !== 0
      if (auraitCompte) exemplairesDeFacturesSources.push(piece)
      continue
    }
    if (typeof parts === 'string') {
      const concernee = recette || (piece.montant_tva ?? 0) !== 0
      const dansLeTemps = piece.date_piece == null || piece.date_piece <= periode.fin
      if (piece.statut === 'validee' && concernee && dansLeTemps) nonPlacees.push({ piece, motif: parts })
      continue
    }
    const part = parts
      .filter((f) => f.date! >= periode.debut && f.date! <= periode.fin)
      .reduce((s, f) => s + f.part, 0)
    if (part === 0) continue
    if (piece.statut !== 'validee') {
      aValider.push(piece)
      continue
    }

    const ecarter = (motif: MotifEcart, detail: string) => ecartees.push({ piece, motif, detail, part })
    const motifImpossible = impossibles.get(piece.id)
    if (motifImpossible) {
      ecarter('tva_impossible', `TVA impossible : ${LIBELLE_MOTIF_TVA[motifImpossible]}`)
      continue
    }
    if (nonConverties.has(piece.id)) {
      ecarter('devise_non_convertie', LIBELLE_MOTIF_ECART.devise_non_convertie)
      continue
    }

    const { montant_ht: htLu, montant_tva: tvaLue, montant_ttc: ttc } = piece
    const tva = tvaLue ?? 0
    // Les centimes de la période, ceux de l'écriture de la pièce (`centimesDeLaPeriode`). Une ligne de la CA3 ne
    // porte jamais une somme négative : un avoir y entre pour sa valeur absolue, sur sa propre ligne — d'où le signe
    // de la pièce, qui ramène ses centimes au sens de la ligne qui les reçoit.
    const centimesDe = (charge: number, taxe: number) => centimesDeLaPeriode(piece, charge, taxe, paiements, surDebits, periode)
    const signe = tva < 0 ? -1 : 1

    if (!recette) {
      if (tva === 0) {
        if (tvaLue == null && htLu != null && ttc != null && Math.abs(ttc - htLu) > 0.01) {
          ecarter('tva_non_lue', LIBELLE_MOTIF_ECART.tva_non_lue)
        } else if (piece.devise !== 'EUR') {
          achatsEnDeviseSansTva.push(piece)
        }
        continue
      }
      // La charge de l'écriture, que la TVA complète date par date : le hors taxe lu, sinon le TTC moins la TVA.
      const { tva: c } = centimesDe(montantRetenu(piece, true) ?? 0, tva)
      const immobilisee = donnees.pieceIdsImmobilisees.has(piece.id)
      if (immobilisee) comptes.immobilisations += c
      else comptes.deductible += c
      const ligne = tva < 0 ? '15' : immobilisee ? '19' : '20'
      cumul[`l${ligne}`] += signe * c
      retenues.push({ piece, part, ligne })
      continue
    }

    // Une recette sans TVA est une opération non imposable (E2) — sauf si rien ne permet de le
    // dire : un hors taxe différent du TTC sans TVA lue est une taxe qu'on n'a pas su lire.
    if (tva === 0) {
      const base = ttc ?? htLu
      const exoneree = tvaLue === 0 || (htLu != null && ttc != null && Math.abs(ttc - htLu) <= 0.01)
      if (base == null || !exoneree) {
        ecarter('tva_non_lue', LIBELLE_MOTIF_ECART.tva_non_lue)
        continue
      }
      const { base: b } = centimesDe(base, 0)
      if (base < 0) {
        cumul.F8 -= b
        retenues.push({ piece, part, ligne: 'F8' })
      } else {
        cumul.E2 += b
        retenues.push({ piece, part, ligne: 'E2' })
      }
      continue
    }

    const ht = htLu ?? (ttc != null ? ttc - tva : null)
    if (ht == null) {
      ecarter('montants_incomplets', LIBELLE_MOTIF_ECART.montants_incomplets)
      continue
    }
    const ligne = ligneDuTaux(ht, tva)
    if (ligne === null) {
      ecarter('taux_non_reconnu', LIBELLE_MOTIF_ECART.taux_non_reconnu)
      continue
    }
    if (ligne === 'taux_a_placer') {
      ecarter('taux_a_placer', LIBELLE_MOTIF_ECART.taux_a_placer)
      continue
    }
    const { base: b, tva: c } = centimesDe(montantRetenu(piece, true)!, tva)
    comptes.collectee += c
    if (tva < 0) {
      // Un avoir consenti à un client : sa base est une régularisation du chiffre d'affaires (B5), sa
      // taxe se récupère ligne 21. Retrancher l'un ou l'autre d'une ligne de taux inscrirait une somme
      // négative, ce que la notice interdit.
      cumul.B5 -= b
      cumul.l21 -= c
      retenues.push({ piece, part, ligne: 'B5' })
      continue
    }
    cumul.A1 += b
    cumul[`base${ligne}`] += b
    cumul[`taxe${ligne}`] += c
    retenues.push({ piece, part, ligne })
  }

  for (const part of donnees.releve) {
    if (part.nature !== 'recette') continue
    if (part.ligne.date < periode.debut || part.ligne.date > periode.fin) continue
    if (surDebits) {
      releveEcartees.push({ part, motif: 'sur_debits', detail: LIBELLE_MOTIF_RELEVE.sur_debits })
      continue
    }
    const ligneDuTauxReleve = TAUX_RECONNUS.find((r) => r.taux === part.taux)?.ligne
    if (part.taux == null || (part.taux !== 0 && !ligneDuTauxReleve)) {
      releveEcartees.push({ part, motif: 'sans_taux', detail: LIBELLE_MOTIF_RELEVE.sans_taux })
      continue
    }
    releveRetenues.push({ part, ligne: placerUneRecetteSansFacture(part.montantReleve, part.taux, ligneDuTauxReleve) })
  }

  // UNE RECETTE SANS FACTURE — du relevé ou de la caisse — À SA LIGNE. Le hors taxe et la TVA, au centime, du calcul même qui
  // a écrit l'écriture : la CA3 et le brouillon disent le même montant. Une seule règle pour les deux : la caisse est une
  // recette du relevé sans mouvement (conception de la caisse, § 5).
  function placerUneRecetteSansFacture(
    montant: number, taux: number, ligneDuTaux: LigneTaux | undefined,
  ): LigneTaux | 'E2' | 'F8' | 'B5' {
    const { ht, tva } = horsTaxeEtTva(montant, taux)
    const sortie = montant < 0
    // Zéro : exonérée ou non imposable, aucune ligne de taux.
    if (!ligneDuTaux) {
      cumul[sortie ? 'F8' : 'E2'] += centimes(ht)
      return sortie ? 'F8' : 'E2'
    }
    comptes.collectee += sortie ? -centimes(tva) : centimes(tva)
    if (sortie) {
      cumul.B5 += centimes(ht)
      cumul.l21 += centimes(tva)
      return 'B5'
    }
    cumul.A1 += centimes(ht)
    cumul[`base${ligneDuTaux}`] += centimes(ht)
    cumul[`taxe${ligneDuTaux}`] += centimes(tva)
    return ligneDuTaux
  }

  // LES RECETTES DE CAISSE, APRÈS CELLES DU RELEVÉ, ET COMME ELLES (étape C3a ; conception de la caisse, § 5) : à leur date —
  // le jour où les espèces ont été reçues, l'exigibilité d'une prestation de services encaissée (CGI, art. 269, 2, c) —, à
  // leur taux ; exonérée (0 %), en E2 ; des espèces rendues, comme un avoir consenti. Une catégorie qui n'est plus un produit
  // n'y entre pas, comme dans la 2035. Sur option pour les débits, et sans taux, écartées sous les mêmes motifs que le relevé.
  const caisseRetenues: RecetteDeCaisseRetenue[] = []
  const caisseEcartees: RecetteDeCaisseEcartee[] = []
  if (donnees.caisse.etat === 'lue') {
    for (const recette of donnees.caisse.recettes) {
      if (recette.nature !== 'recette' || !dansLaPeriode(recette.date)) continue
      if (surDebits) {
        caisseEcartees.push({ recette, motif: 'sur_debits', detail: LIBELLE_MOTIF_CAISSE.sur_debits })
        continue
      }
      const ligneDuTauxCaisse = TAUX_RECONNUS.find((r) => r.taux === recette.taux)?.ligne
      if (recette.taux == null || (recette.taux !== 0 && !ligneDuTauxCaisse)) {
        caisseEcartees.push({ recette, motif: 'sans_taux', detail: LIBELLE_MOTIF_CAISSE.sans_taux })
        continue
      }
      caisseRetenues.push({ recette, ligne: placerUneRecetteSansFacture(recette.centimes / 100, recette.taux, ligneDuTauxCaisse) })
    }
  }

  // LES VENTES FACTURÉES, APRÈS LE RELEVÉ (étape VF3b2). Chaque exigibilité datée dans la période, à son taux, pour la base et
  // la TVA que le module porte, au centime et SANS RECALCUL : la règle du cumul (§ 6) fait porter à un taux soldé exactement
  // la TVA facturée, et refaire la TVA d'une part depuis son montant et son taux la ferait s'écarter d'un centime à chaque
  // paiement partiel. Le régime est celui de la facture, déjà appliqué par le module : `surDebits` n'a rien à faire ici —
  // une facture source de services sur le régime de l'encaissement compte à ses encaissements, même si le dossier a opté
  // depuis pour les débits, et inversement. Leur TVA entre dans `comptes`, celle d'une exigibilité écartée comprise : leurs
  // écritures la portent au 445710 à cette date, sans recalcul (lib/ecrituresVentesFacturees.ts).
  for (const e of donnees.ventesFacturees.exigibilites) {
    if (!dansLaPeriode(e.date)) continue
    const { baseCentimes: base, tvaCentimes: tva } = e
    comptes.collectee += tva
    // Zéro : une franchise, une exonération ou une opération que la facture ne taxe pas, aucune ligne de taux. Négative,
    // c'est la régularisation d'une opération non imposable.
    if (e.taux === 0) {
      if (base < 0) {
        cumul.F8 -= base
        exigibilitesRetenues.push({ exigibilite: e, ligne: 'F8' })
      } else {
        cumul.E2 += base
        exigibilitesRetenues.push({ exigibilite: e, ligne: 'E2' })
      }
      continue
    }
    const ligne = TAUX_RECONNUS.find((r) => r.taux === e.taux)?.ligne
    if (!ligne) {
      const motif: MotifExigibiliteEcartee = e.taux === TAUX_A_PLACER ? 'taux_a_placer' : 'taux_non_reconnu'
      exigibilitesEcartees.push({ exigibilite: e, motif, detail: LIBELLE_MOTIF_EXIGIBILITE[motif] })
      continue
    }
    // Négative — un avoir daté après le fait générateur, une contre-passation, ou ce qui reste d'une facture que ses avoirs
    // ont réduite sous ses acomptes —, c'est une régularisation, comme un avoir consenti : sa base en B5, sa taxe en 21. Le
    // signe se juge à la TAXE, comme pour une pièce ; une taxe nulle, à la base.
    if (tva < 0 || (tva === 0 && base < 0)) {
      cumul.B5 -= base
      cumul.l21 -= tva
      exigibilitesRetenues.push({ exigibilite: e, ligne: 'B5' })
      continue
    }
    cumul.A1 += base
    cumul[`base${ligne}`] += base
    cumul[`taxe${ligne}`] += tva
    exigibilitesRetenues.push({ exigibilite: e, ligne })
  }

  const arrondis = Object.fromEntries(Object.entries(cumul).map(([cle, total]) => [cle, arrondiFiscal(total)])) as typeof cumul
  const l22 = Math.max(0, Math.round(creditAnterieur))
  const l16 = arrondis.taxe08 + arrondis.taxe09 + arrondis.taxe9B + arrondis.taxe10 + arrondis.l15
  const l23 = arrondis.l19 + arrondis.l20 + arrondis.l21 + l22
  const l25 = Math.max(0, l23 - l16)
  const lTD = Math.max(0, l16 - l23)
  const l26 = Math.min(l25, Math.max(0, Math.round(remboursement)))
  const cases: CasesCa3 = { ...arrondis, l16, l22, l23, l25, lTD, l26, l27: l25 - l26, l28: lTD, l32: lTD }

  return {
    periode: { debut: periode.debut, fin: periode.fin },
    cases,
    netPeriode: l16 - (arrondis.l19 + arrondis.l20 + arrondis.l21),
    neant: Object.values(cases).every((v) => v === 0),
    retenues,
    ecartees,
    aValider,
    nonPlacees: nonPlacees.sort((a, b) => (b.piece.date_piece ?? '9999').localeCompare(a.piece.date_piece ?? '9999')),
    achatsEnDeviseSansTva,
    releveRetenues,
    releveEcartees,
    exigibilitesRetenues,
    exigibilitesEcartees,
    caisseRetenues,
    caisseEcartees,
    ventesFactureesEcartees: [...donnees.ventesFacturees.ecartees],
    exemplairesDeFacturesSources,
    tvaDesComptes: {
      collectee: comptes.collectee / 100,
      deductible: comptes.deductible / 100,
      immobilisations: comptes.immobilisations / 100,
    },
  }
}

// ── Les déclarations déposées ───────────────────────────────────────────────────────────────────

// Le crédit qu'une déclaration déposée a reporté sur la suivante : sa ligne 27, le crédit de la période
// (ligne 25 : le crédit reçu moins la TVA nette de la période, quand il est positif) moins le remboursement
// demandé (ligne 26), qui ne se reporte pas — le Trésor le rembourse. Le même calcul pour une déclaration
// saisie à la main, qui n'a pas de cases : la base en vérifie l'égalité pour les autres
// (`enregistrer_declaration_tva`).
export function creditReporte(
  declaration: Pick<DeclarationTva, 'tva_declaree' | 'credit_anterieur' | 'remboursement_demande'>,
): number {
  return Math.max(0, Math.max(0, declaration.credit_anterieur - declaration.tva_declaree) - declaration.remboursement_demande)
}

// La déclaration déposée pour la période qui précède immédiatement `debut`. Null quand elle n'est pas
// enregistrée : l'écran demande alors le crédit à reporter plutôt que de supposer qu'il n'y en a pas.
// Deux déclarations ne se chevauchent plus en base depuis le 06/10/2026
// (`garder_declarations_sans_chevauchement`) : une rectificative REMPLACE celle qu'elle corrige, retirée
// d'abord. La plus récente l'emporte encore, défensivement, si un autre chemin en laissait deux.
export function declarationPrecedente(declarations: DeclarationTva[], debut: string): DeclarationTva | null {
  const veille = ajouterJours(debut, -1)
  const candidates = declarations.filter((d) => d.periode_fin === veille)
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
}

export interface DeclarationComparee {
  declaration: DeclarationTva
  recalcul: number
  ecart: number
  enEcart: boolean
}

// Ce qui a été déposé, face à ce que le même calcul donne AUJOURD'HUI pour la même période. Un écart
// dit qu'une pièce de la période a été ajoutée, modifiée ou rapprochée depuis le dépôt : la
// différence est à régulariser sur une déclaration suivante (ligne 5B si le calcul a augmenté, 2C
// s'il a baissé). Moins d'un euro n'est pas un écart : les deux côtés sont en euros entiers, et une
// déclaration saisie à la main avant ce calcul pouvait porter des centimes.
//
// LE RECALCUL LIT LES VENTES FACTURÉES (`donnees.ventesFacturees`, étape VF3b2), comme la CA3 qu'il refait : une déclaration
// d'une période où aucune exigibilité de vente facturée ne tombe, et dont aucune pièce n'est devenue l'exemplaire d'une
// facture source, se recalcule à l'identique ; une période qu'une facture source touche après coup — un acompte daté
// d'avant, un exemplaire désigné depuis — montre l'écart, qui est à régulariser comme un autre.
export function comparerDeclarations(declarations: DeclarationTva[], donnees: DonneesTva, surDebits: boolean): DeclarationComparee[] {
  return declarations.map((declaration) => {
    const recalcul = calculerCa3(
      donnees,
      { debut: declaration.periode_debut, fin: declaration.periode_fin },
      surDebits,
      declaration.credit_anterieur,
      declaration.remboursement_demande,
    ).netPeriode
    const ecart = Math.round((declaration.tva_declaree - recalcul) * 100) / 100
    return { declaration, recalcul, ecart, enEcart: Math.abs(ecart) >= 1 }
  })
}
