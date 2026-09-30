import { piecesDeviseNonConvertie, piecesTvaImpossible, LIBELLE_MOTIF_TVA } from './controles'
import { ajouterJours, ajouterMois, dernierJourDuMois } from './format'
import { partsDesPaiements, type PaiementDePiece, type PaiementsDesPieces } from './rattachement'
import type { DeclarationTva, PeriodiciteTva, Piece } from './types'

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
//     mouvement la rattache au relevé.
//   - une pièce payée en plusieurs fois compte pour la part de chaque paiement (`partsDesPaiements`,
//     lib/rattachement.ts, la même règle que la 2035) : une pièce réglée à l'écart d'alignement près
//     compte en entier, des frais bancaires ne la font pas compter plus d'une fois, et un paiement
//     partiel ne rend exigible que ce qui a été payé.
// Une pièce qu'aucun paiement ne date ne compte dans AUCUNE déclaration, et elle est rendue à part
// (`nonPlacees`) : se taire sur elle ferait passer une recette oubliée pour une recette inexistante.
//
// CE QUE CE CALCUL NE FAIT PAS, et l'écran le dit : l'autoliquidation (services achetés à un
// fournisseur étranger, lignes A3 et B4), le coefficient de déduction d'une activité en partie
// exonérée, les exclusions du droit à déduction (véhicule de tourisme, carburant en partie, cadeaux),
// les taux particuliers (Corse, 2,1 %), le remboursement d'un crédit (ligne 26), les taxes
// assimilées (ligne 29) et la régularisation d'une période déjà déposée (lignes 5B et 2C).

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

interface Fraction {
  date: string
  part: number
}

function fractionsDe(piece: Piece, mouvements: readonly PaiementDePiece[], surDebits: boolean): Fraction[] | MotifNonPlacee {
  const recette = piece.type_piece === 'vente'
  if (recette && surDebits) return piece.date_piece ? [{ date: piece.date_piece, part: 1 }] : 'sans_date'
  // La part de chaque paiement vient de `partsDesPaiements` (lib/rattachement.ts), qui la rend aussi
  // à la 2035 : c'est la même question, et une règle écrite deux fois n'attend que de diverger. Le
  // reste d'un paiement partiel n'est exigible nulle part — un acompte ne rend exigible que ce qu'il
  // paie —, donc seules les parts payées sont prises ici.
  const { parts } = partsDesPaiements(piece, mouvements)
  if (parts.length > 0) return parts
  if (piece.type_piece === 'note_frais') return piece.date_piece ? [{ date: piece.date_piece, part: 1 }] : 'sans_date'
  return 'non_rapprochee'
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
  l27: number // crédit à reporter (8003)
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
  { ligne: '27', libelle: 'Crédit de TVA à reporter sur la prochaine déclaration', code: '8003', cadre: 'solde', montant: 'l27' },
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

export interface PieceNonPlacee {
  piece: Piece
  motif: MotifNonPlacee
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

export function calculerCa3(
  donnees: DonneesTva,
  periode: { debut: string; fin: string },
  surDebits: boolean,
  creditAnterieur: number,
): DeclarationCa3 {
  const impossibles = new Map(piecesTvaImpossible(donnees.pieces).map((a) => [a.piece.id, a.motif]))
  const nonConverties = new Set(piecesDeviseNonConvertie(donnees.pieces).map((p) => p.id))

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

  for (const piece of donnees.pieces) {
    const recette = piece.type_piece === 'vente'
    const fractions = fractionsDe(piece, donnees.paiements.get(piece.id) ?? [], surDebits)
    if (typeof fractions === 'string') {
      const concernee = recette || (piece.montant_tva ?? 0) !== 0
      const dansLeTemps = piece.date_piece == null || piece.date_piece <= periode.fin
      if (piece.statut === 'validee' && concernee && dansLeTemps) nonPlacees.push({ piece, motif: fractions })
      continue
    }
    const part = fractions
      .filter((f) => f.date >= periode.debut && f.date <= periode.fin)
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
    const ajouter = (cle: keyof typeof cumul, montant: number) => {
      cumul[cle] += centimes(Math.abs(montant) * part)
    }

    if (!recette) {
      if (tva === 0) {
        if (tvaLue == null && htLu != null && ttc != null && Math.abs(ttc - htLu) > 0.01) {
          ecarter('tva_non_lue', LIBELLE_MOTIF_ECART.tva_non_lue)
        } else if (piece.devise !== 'EUR') {
          achatsEnDeviseSansTva.push(piece)
        }
        continue
      }
      if (tva < 0) {
        ajouter('l15', tva)
        retenues.push({ piece, part, ligne: '15' })
      } else if (donnees.pieceIdsImmobilisees.has(piece.id)) {
        ajouter('l19', tva)
        retenues.push({ piece, part, ligne: '19' })
      } else {
        ajouter('l20', tva)
        retenues.push({ piece, part, ligne: '20' })
      }
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
      if (base < 0) {
        ajouter('F8', base)
        retenues.push({ piece, part, ligne: 'F8' })
      } else {
        ajouter('E2', base)
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
    if (tva < 0) {
      // Un avoir consenti à un client : sa base est une régularisation du chiffre d'affaires (B5), sa
      // taxe se récupère ligne 21. Retrancher l'un ou l'autre d'une ligne de taux inscrirait une somme
      // négative, ce que la notice interdit.
      ajouter('B5', ht)
      ajouter('l21', tva)
      retenues.push({ piece, part, ligne: 'B5' })
      continue
    }
    ajouter('A1', ht)
    ajouter(`base${ligne}`, ht)
    ajouter(`taxe${ligne}`, tva)
    retenues.push({ piece, part, ligne })
  }

  const arrondis = Object.fromEntries(Object.entries(cumul).map(([cle, total]) => [cle, arrondiFiscal(total)])) as typeof cumul
  const l22 = Math.max(0, Math.round(creditAnterieur))
  const l16 = arrondis.taxe08 + arrondis.taxe09 + arrondis.taxe9B + arrondis.taxe10 + arrondis.l15
  const l23 = arrondis.l19 + arrondis.l20 + arrondis.l21 + l22
  const l25 = Math.max(0, l23 - l16)
  const lTD = Math.max(0, l16 - l23)
  const cases: CasesCa3 = { ...arrondis, l16, l22, l23, l25, lTD, l27: l25, l28: lTD, l32: lTD }

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
  }
}

// ── Les déclarations déposées ───────────────────────────────────────────────────────────────────

// Le crédit qu'une déclaration déposée a reporté sur la suivante : sa ligne 27, qui vaut le total
// déductible moins la TVA brute quand il est positif — autrement dit le crédit reçu moins la TVA
// nette de la période. Aucun remboursement (ligne 26) n'est modélisé : tout le crédit est reporté.
export function creditReporte(declaration: Pick<DeclarationTva, 'tva_declaree' | 'credit_anterieur'>): number {
  return Math.max(0, declaration.credit_anterieur - declaration.tva_declaree)
}

// La déclaration déposée pour la période qui précède immédiatement `debut`, la plus récente si la
// période en a plusieurs (une déclaration rectificative). Null quand elle n'est pas enregistrée :
// l'écran demande alors le crédit à reporter plutôt que de supposer qu'il n'y en a pas.
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
export function comparerDeclarations(declarations: DeclarationTva[], donnees: DonneesTva, surDebits: boolean): DeclarationComparee[] {
  return declarations.map((declaration) => {
    const recalcul = calculerCa3(
      donnees,
      { debut: declaration.periode_debut, fin: declaration.periode_fin },
      surDebits,
      declaration.credit_anterieur,
    ).netPeriode
    const ecart = Math.round((declaration.tva_declaree - recalcul) * 100) / 100
    return { declaration, recalcul, ecart, enEcart: Math.abs(ecart) >= 1 }
  })
}
