import type {
  ANouveau, Categorie, CotisationDeclaree, EcritureBrouillon, JournalCode, ModeComptable, Piece, VentilationBancaire,
} from './types'
import { idsMouvementsJustifiesParLeReleve, referenceDuReleve, type MouvementBancaire } from './affectationBanque'
import { libelleEcritureANouveau } from './aNouveaux'
import { libelleCompteTenu, libelleDuPlanComptable } from './comptes'
import { auxiliaireDuTiers } from './engagement'
import { auxiliaireDeLaLigne, type EcritureVenteFacturee } from './ecrituresVentesFacturees'
import { dateAParis } from './format'
import type { LettrageDeLigne } from './lettrage'
import { porteUneSourceDeVente, rattachementDesVentes } from './ventesFactureesDesExports'
import { journalDeLOperation, operationsDe, referenceDeLaCaisse, type OperationsDeCaisse } from './controlesDeLaCaisse'
import type { AcquisitionDuBien } from './amortissements'
import {
  champsDeLaTvaDUneFacture, champsDesANouveaux, champsDUneDotation, champsDUneLiquidation, champsDUneOperationDeCaisse,
  champsDUnEncaissement, champsDUnePiece, champsDUneSourceNonLue, champsDUnForfait, champsDUnMouvementDesEncaissements,
  champsDUnMouvementDuReleve, champsDUnPaiementPersonnel, partsDesReglementsALaDate, type ChampsBnc, type ChoixChampsBnc,
  type EncaissementDuRegistre, type FactureDuClient, type LigneACaracteriser, type ModeRglt, type NatureOperation,
  type PartDUnReglement, type PosteLu, type REGLES_DES_SORTES, type ReglementDUnePiece,
} from './champsBncDuFec'
import {
  categorieDesFraisBancaires, POSTE_AMORTISSEMENTS, POSTE_ARRONDIS_TVA_CHARGE, POSTE_ARRONDIS_TVA_PRODUIT, POSTE_COTISATIONS,
  POSTE_INDEMNITES_KM, POSTE_VENTES_FACTUREES,
} from './declaration2035'
import { POSTE_ASSURANCE_EMPRUNT, POSTE_INTERETS_EMPRUNT } from './echeanceEmprunt'
import { estContrepartieDirigeant, piecesAComptabiliser } from './ecritures'
import { AUCUNE_FACTURE_SOURCE } from './facturesSources'
import type { PlanComptable } from './planComptable'
import type { PaiementsDesPieces } from './rattachement'

// Génération du FEC (Fichier des Écritures Comptables) — format officiel imposé par l'article
// A47 A-1 du Livre des procédures fiscales, que tout logiciel de comptabilité sait importer sans
// ressaisie. Construit uniquement à partir des écritures brouillon déjà proposées/validées dans
// l'appli : si une pièce n'a pas encore de compte, ou n'est pas encore rapprochée en banque, elle
// n'apparaît simplement pas (ou apparaît déséquilibrée) — jamais devinée pour compléter le fichier.
//
// DEUX TEMPS, UNE SEULE LOGIQUE (ligne 26.6, étape d). La NUMÉROTATION décide de tout ce qu'une ligne
// porte hors de l'écriture elle-même — son journal, son numéro, sa pièce, le libellé de son compte, son
// compte auxiliaire —, puis la MISE EN FORME l'écrit. La validation d'un exercice envoie cette numérotation à
// `valider_exercice`, qui la fige sur les écritures ; le FEC d'un exercice validé se relit ensuite depuis ce
// qui a été figé (`numerotationValidee`), et non plus depuis les pièces et les catégories d'aujourd'hui. Les
// deux passent par la même mise en forme : le fichier d'avant la validation et celui d'après ne diffèrent que
// par ValidDate, qui devient la date de la validation — et par le LETTRAGE (EcritureLet, DateLet), qui ne se fige
// pas : il dit l'état des comptes de tiers au jour de l'export (lib/lettrage.ts). Une facture d'un exercice validé
// réglée l'exercice suivant se lettre ce jour-là, et le lettrage ne modifie rien de l'écriture : ni son compte, ni
// son montant, ni sa date.

// Les dix-huit champs du VII de l'article A47 A-1, ceux d'une comptabilité tenue selon le droit
// commercial (VIII, 3°) : le fichier d'un dossier en ENGAGEMENT, et — le drapeau `CHAMPS_BNC_EXPORTES` baissé
// (lib/champsBncDuFec.ts) — celui d'aujourd'hui pour tout dossier.
const ENTETES_FEC = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
  'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
]

// UN BNC EN COMPTABILITÉ DE TRÉSORERIE en doit VINGT-DEUX (LPF, art. A47 A-1, VIII, 7° : « les vingt-deux premières
// informations devant obligatoirement correspondre, dans l'ordre » au tableau) : les dix-huit, puis « 19. La date de
// règlement », « 20. Le mode de règlement », « 21. La nature de l'opération (à blanc si non utilisé) », « 22.
// L'identification du client (à blanc si non utilisé) » (ligne 26.6, étape e ; lot FEC22c ; MVP-D5). Leurs valeurs sont
// celles du module FEC22a (lib/champsBncDuFec.ts), écriture par écriture ; la conception : HISTORIQUE.md, « LE FEC D'UN BNC
// EN TRÉSORERIE : LES VINGT-DEUX CHAMPS, LA CONCEPTION », et les réponses du cabinet qui l'emportent sur elle.
export const ENTETES_FEC_BNC = [...ENTETES_FEC, 'DateRglt', 'ModeRglt', 'NatOp', 'IdClient'] as const

export const LIBELLES_JOURNAUX: Readonly<Record<JournalCode, string>> = {
  AC: 'Achats',
  VE: 'Ventes',
  BQ: 'Banque',
  OD: 'Opérations diverses',
}

function yyyymmdd(iso: string): string {
  return iso.slice(0, 10).replaceAll('-', '')
}

// LA VIRGULE SÉPARE LA PARTIE ENTIÈRE DE LA PARTIE DÉCIMALE, et c'est l'article A47 A-1 qui le dit :
// « La virgule sépare la fraction entière de la partie décimale. Aucun séparateur de millier n'est
// accepté. » Le signe se place en tête. `toFixed` écrit un point : un outil d'import qui suit la norme
// rejette alors le fichier, ou ne lit pas les montants. Jusqu'au 28/09/2026, le FEC sortait ainsi.
function montant(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

// Le FEC est un fichier en colonnes séparées par des tabulations : une tabulation ou un saut de
// ligne dans un champ texte ne décale pas seulement une colonne, il coupe la ligne en deux et rend
// le fichier structurellement invalide pour l'outil d'import d'un contrôleur.
//
// Ce n'est pas théorique : les libellés viennent du tiers extrait par OCR (voir extract-piece), et
// un en-tête de facture sur plusieurs lignes ressort tel quel — "CAISSE\nD'EPARGNE\nCEPAC" est un
// cas réellement présent en base. Tout séparateur est donc remplacé par une espace, et les espaces
// multiples réduites, ce qui garde le libellé lisible sans casser le format.
function champFec(valeur: string): string {
  return valeur.replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

// La pièce d'une liquidation de TVA : la CA3 arrêtée au dernier jour de sa période, qui est la date de l'écriture.
// La piste d'audit la nomme de même (lib/pisteAudit.ts).
export function referenceDeLaLiquidation(date: string): string {
  return `CA3 au ${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
}

// La pièce du paiement d'une échéance de cotisation DEPUIS LE COMPTE PERSONNEL de l'exploitant (lib/cotisationPersonnelle.ts) :
// le relevé de ce compte au jour du paiement, que le cabinet a vu et qui n'est pas dans l'application — c'est ce qu'un
// vérificateur demandera. La date de l'écriture est celle du paiement. La piste d'audit la nomme de même.
export function referenceDuPaiementPersonnel(date: string): string {
  return `Compte personnel du ${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
}

// Libellé du compte pour la colonne CompteLib — les comptes que l'application tient elle-même (TVA,
// banque, tiers, dotations et amortissements) d'abord, sinon celui de la catégorie qui porte ce
// compte_comptable, sinon celui du plan comptable pour un compte de bilan choisi par le cabinet (ligne 26.7,
// `libelleDuPlanComptable`), sinon le numéro de compte lui-même à défaut de mieux.
export function libelleCompte(compte: string, categories: Categorie[]): string {
  return libelleCompteTenu(compte)
    ?? (categories.find((c) => c.compte_comptable === compte)?.libelle || libelleDuPlanComptable(compte) || compte)
}

// Une ligne du FEC avant sa mise en forme : l'écriture, et ce que la numérotation décide pour elle. C'est
// exactement ce que `valider_exercice` reçoit et fige (`demandeDeValidation`, lib/validationExercice.ts).
export interface LigneFec {
  ecriture: EcritureBrouillon
  journal: JournalCode
  numero: number
  // La pièce de l'écriture : le justificatif, le relevé, le tableau d'amortissement ou le barème.
  pieceRef: string
  // AAAA-MM-JJ, comme les dates de la base.
  pieceDate: string
  compteLib: string
  compAuxNum: string | null
  compAuxLib: string | null
  // AAAA-MM-JJ : la date de l'écriture tant qu'elle est au brouillon, celle de sa validation ensuite.
  validDate: string
  // Les quatre champs d'un BNC en trésorerie, ou nuls quand la numérotation ne les calcule pas (`champsBnc` ci-dessous).
  champsBnc: ChampsBncDeLaLigne | null
}

/**
 * Les quatre champs de plus d'une ligne (FEC22c). DateRglt, ModeRglt et IdClient sont ceux de son ÉCRITURE ; la nature
 * aussi, une par écriture — ce que la migration (FEC22b) figera à part du poste —, et NatOp la nature suivie, sur une ligne
 * de charge ou de produit, du poste de la 2035 (FEC22-Q3, (C)) : deux lignes d'une même écriture ventilée peuvent porter
 * deux NatOp.
 */
export interface ChampsBncDeLaLigne {
  // AAAA-MM-JJ, comme les dates de la base ; '' sans règlement. Le fichier l'écrit AAAAMMJJ.
  dateRglt: string
  modeRglt: ModeRglt | ''
  nature: NatureOperation
  natOp: string
  idClient: string
}

export interface ANouveauFec {
  aNouveau: ANouveau
  compteLib: string
  ecritureLib: string
  validDate: string
  champsBnc: ChampsBncDeLaLigne | null
}

export interface NumerotationFec {
  aNouveaux: ANouveauFec[]
  // Dans l'ordre du fichier — voir `ordonnerLignes`.
  lignes: LigneFec[]
  // `calcules` : chaque ligne et chaque à-nouveau porte ses quatre champs — un dossier en trésorerie, le drapeau levé ;
  // `non_calcules` : aucune — un dossier en engagement, le drapeau baissé, ou un exercice relu de ce que la validation a
  // figé avant la migration FEC22b (`numerotationValidee`). C'est ce que `formaterFec` lit pour écrire 22 colonnes.
  champsBnc: 'calcules' | 'non_calcules'
  // Les écritures que rien ne rattache : ni une pièce, ni un mouvement justifié par le relevé, ni un bien, ni
  // un véhicule, ni une déclaration de TVA, ni une échéance payée depuis le compte personnel, ni une opération de caisse
  // lue — le reste d'une pièce
  // supprimée, que `absenceFec` chiffre —, et les lignes d'une vente facturée que la composition ne rend plus telles
  // quelles (« à réécrire » ou « à retirer », lib/ventesFactureesDesExports.ts). Hors du fichier, et une écriture
  // qu'on ne peut pas numéroter empêche de valider son exercice.
  horsFec: EcritureBrouillon[]
}

// L'ORDRE DU FICHIER, le même avant et après la validation. Les écritures par date de leur plus ancienne
// ligne, puis date de pièce, journal et numéro ; les lignes d'une écriture par date, débit avant crédit, puis
// compte et identifiant. L'ordre des lignes ne dépend donc plus de celui de la lecture : deux exports du même
// brouillon rendent le même fichier, et le FEC relu depuis un exercice validé celui qu'on aurait exporté la
// veille de la validation.
function ordonnerLignes(lignes: LigneFec[]): LigneFec[] {
  const premiere = new Map<string, string>()
  for (const l of lignes) {
    const cle = `${l.journal}|${l.numero}`
    const actuelle = premiere.get(cle)
    if (actuelle === undefined || l.ecriture.date < actuelle) premiere.set(cle, l.ecriture.date)
  }
  return [...lignes].sort((a, b) => {
    const pa = premiere.get(`${a.journal}|${a.numero}`)!
    const pb = premiere.get(`${b.journal}|${b.numero}`)!
    return pa.localeCompare(pb) || a.pieceDate.localeCompare(b.pieceDate) || a.journal.localeCompare(b.journal)
      || a.numero - b.numero || a.ecriture.date.localeCompare(b.ecriture.date)
      || (a.ecriture.sens === b.ecriture.sens ? 0 : a.ecriture.sens === 'debit' ? -1 : 1)
      || a.ecriture.compte.localeCompare(b.ecriture.compte) || a.ecriture.id.localeCompare(b.ecriture.id)
  })
}

// LES À-NOUVEAUX OUVRENT LE FICHIER. Un FEC commence par les écritures d'ouverture : sans elles, le
// premier solde de chaque compte de bilan y paraît sortir de nulle part, et un contrôleur qui
// recalcule la banque depuis le fichier ne retrouve pas le relevé. `aNouveaux` porte ceux de
// l'exercice exporté — l'appelant filtre, comme pour les écritures. Une seule écriture, journal AN,
// numérotée à part des autres journaux ; sa pièce est la balance reprise — ou, pour un exercice qui suit
// un exercice validé, l'exercice validé dont viennent ses soldes reportés (« Exercice AAAA validé »,
// lib/reportDesSoldes.ts) : `ouvertureDeLExercice` rend l'une ou les autres sous la même forme.
//
// CompteLib reste celui de l'application pour un compte qu'elle tient (la banque, la TVA) : UN MÊME
// CompteNum NE PORTE QU'UN LIBELLÉ DANS TOUT LE FICHIER — à-nouveaux et écritures compris, et la validation
// le refuse autrement —, et les mouvements de la banque l'appellent « Banque ». Le numéro et le libellé de la
// balance d'origine passent dans EcritureLib.
function libellesDesComptes(categories: Categorie[], aNouveaux: readonly ANouveau[]): (compte: string) => string {
  const repris = new Map<string, string>()
  for (const a of [...aNouveaux].sort((x, y) => x.compte.localeCompare(y.compte) || x.id.localeCompare(y.id))) {
    const libelle = champFec(a.libelle)
    if (libelle && !repris.has(a.compte)) repris.set(a.compte, libelle)
  }
  return (compte) => champFec(libelleCompteTenu(compte) ?? repris.get(compte) ?? libelleCompte(compte, categories))
}

// ── CE QUE LA NUMÉROTATION LIT POUR LES QUATRE CHAMPS D'UN BNC EN TRÉSORERIE (FEC22c) ──────────────────────────────────

/**
 * Les entrées neuves des quatre champs. Chacune OBLIGATOIRE et LUE EN ENTIER par l'appelant : une lecture partielle refuse
 * l'export, comme pour la caisse (l'onglet Écritures, `champsBncIndisponibles`) — un FEC où une valeur manquerait parce
 * qu'une ligne n'a pas été lue aurait l'air complet.
 */
export interface EntreesDesChampsBnc {
  // FEC22-Q1 : DateRglt et ModeRglt d'une écriture qui n'est pas un règlement. Sans valeur par défaut : le drapeau levé le
  // porte (`CHAMPS_BNC_EXPORTES`), selon la réponse de l'expert-comptable à FEC22-E2.
  choix: ChoixChampsBnc
  // Les paiements de chaque pièce (`paiementsDesPieces`, lib/rattachement.ts), les mêmes que ceux qui ont daté et réglé
  // son écriture : le règlement d'une pièce, et sa scission par mode.
  paiements: PaiementsDesPieces
  // Le registre ENTIER des encaissements du dossier, retirés et contre-passations compris : le moyen d'un encaissement, d'un
  // virement mixte, d'une remise. Vide pour un dossier qui n'a pas basculé, où aucune écriture n'en vient.
  registre: readonly EncaissementDuRegistre[]
  // Les factures et avoirs du dossier, TOUS : le numéro et le SIRET figé du client (IdClient, FEC22-Q4), la source de la
  // vente — jamais le nom du client.
  factures: readonly FactureDuClient[]
  // Les échéances de cotisation du dossier : la date d'un paiement depuis le compte personnel (`paiement_personnel_le`).
  cotisations: readonly Pick<CotisationDeclaree, 'id' | 'paiement_personnel_le'>[]
  // Les parts des mouvements ventilés : le poste de chaque ligne, par la catégorie de sa part.
  ventilations: readonly Pick<VentilationBancaire, 'ligne_bancaire_id' | 'categorie_id'>[]
  // La pièce de chaque bien du registre (`acquisitionsDesBiens`, lib/amortissements.ts) : l'acquisition d'immobilisation.
  acquisitions: ReadonlyMap<string, AcquisitionDuBien>
  // Le plan du dossier : le compte de la caisse, de l'exploitant, et de chaque rôle dont la 2035 donne le poste.
  plan: PlanComptable
}

/**
 * Ce que `numeroterFec` reçoit pour les quatre champs, SANS VALEUR PAR DÉFAUT : `non_exportes` — le drapeau baissé, la
 * numérotation d'aujourd'hui au caractère près, sans scission ni champ de plus — ou `exportes`, avec les entrées lues. En
 * engagement, rien ne se calcule, quoi qu'on passe : le fichier y reste à dix-huit colonnes (VIII, 3°).
 */
export type ChampsBncDuFec = { etat: 'non_exportes' } | { etat: 'exportes'; entrees: EntreesDesChampsBnc }

export const CHAMPS_BNC_NON_EXPORTES: ChampsBncDuFec = { etat: 'non_exportes' }

// Les sortes d'écriture que la numérotation distingue, celles dont le module dit les quatre champs (`REGLES_DES_SORTES`) ;
// les à-nouveaux à part.
type SorteDuFec = Exclude<keyof typeof REGLES_DES_SORTES, 'a-nouveaux'>

// Une écriture du fichier avant son numéro : sa clé, sa sorte, ses lignes, et ce que la numérotation décide pour elle.
interface EcritureANumeroter {
  cle: string
  sorte: SorteDuFec
  pieceId: string | null
  rows: EcritureBrouillon[]
  ordre: string
  journal: JournalCode
  pieceDate: string
  pieceRef: string
  // Le règlement d'une écriture de pièce, quand la numérotation calcule les quatre champs ; nul ailleurs.
  reglement: ReglementDUnePiece | null
}

// Un montant réparti au centime selon des poids, le dernier morceau prenant l'arrondi pour que la somme reste le total —
// la règle de `centimesParDate` (lib/rattachement.ts), qui a fait le total de la date.
function repartir(total: number, poids: readonly number[]): number[] {
  const somme = poids.reduce((s, p) => s + p, 0)
  const morceaux = poids.map((p) => Math.round(total * (p / somme)))
  morceaux[morceaux.length - 1] = total - morceaux.slice(0, -1).reduce((s, m) => s + m, 0)
  return morceaux
}

const centimesSignes = (e: Pick<EcritureBrouillon, 'sens' | 'montant'>) => (e.sens === 'debit' ? 1 : -1) * Math.round(e.montant * 100)

/**
 * UNE PIÈCE PAYÉE LE MÊME JOUR PAR DEUX MODES FAIT DEUX ÉCRITURES (conception, « CE QUI EST DÉCIDÉ », 3°). Les quatre
 * champs sont les mêmes sur toutes les lignes d'une écriture — elle enregistre UNE opération, et l'outil de la DGFiP la
 * juge comme telle —, or la charge d'une date réunit la part de chacun de ses règlements (`centimesParDate`) : la banque et
 * la poche de l'exploitant le même jour, la banque et un virement mixte. L'écriture de la date se scinde en une par mode,
 * dans l'ordre de `partsDesReglementsALaDate` :
 *   - la ligne de banque d'un paiement va au règlement de son mouvement ; la ligne de caisse d'un paiement par la caisse
 *     (étape C9a) au règlement de son opération ; la contrepartie d'une note de frais au compte de l'exploitant
 *     (`estContrepartieDirigeant`, la règle de la génération) à la poche de l'exploitant ;
 *   - les lignes que la date partage — la charge ou le produit, sa TVA — se sous-répartissent au centime selon la part de
 *     chaque règlement : la pièce entière d'abord (charge et TVA ensemble), puis chaque ligne, la TVA en dernier, prenant ce
 *     qui reste du total de son règlement — la TVA d'un règlement complète sa charge, comme `lignesChargeProduitPourPiece` le
 *     fait d'une date. Le total de chaque ligne, donc de la date et de la pièce, est intact : la 2035, qui se calcule des
 *     sources, ne change pas, ni la balance.
 * Chaque écriture scindée s'équilibre : ce qu'un paiement règle de la pièce est le montant de son mouvement quand elle est
 * payée en partie, sa part du total payé quand elle l'est en entier. Une ligne de part nulle ne s'écrit pas. Rien de
 * scindé ne se valide encore : la numérotation que la validation fige est celle du drapeau baissé (FEC22c2).
 */
function scinderParMode(
  e: EcritureANumeroter, parts: readonly PartDUnReglement[], contrepartieDirigeant: (ligne: EcritureBrouillon) => boolean,
  // Une ligne de TVA de la pièce (les comptes de TVA du plan) : elle complète la charge de chaque règlement.
  estUneTva: (ligne: EcritureBrouillon) => boolean,
): EcritureANumeroter[] {
  const somme = parts.reduce((s, p) => s + p.part, 0)
  if (parts.length < 2 || !(somme > 0)) return [{ ...e, reglement: parts[0]?.reglement ?? { par: 'aucun' } }]
  // Une ligne de banque dont le mouvement n'est plus un paiement de la pièce (une écriture désynchronisée) reste au relevé.
  const auReleve = Math.max(0, parts.findIndex((p) => p.reglement.par === 'releve'))
  const aLaPoche = parts.findIndex((p) => p.reglement.par === 'note_de_frais')
  // Une ligne de caisse dont l'opération n'est plus un paiement de la pièce reste à la caisse, s'il en est une ce jour-là.
  const aLaCaisse = parts.findIndex((p) => p.reglement.par === 'caisse')
  const propres: EcritureBrouillon[][] = parts.map(() => [])
  const partagees: EcritureBrouillon[] = []
  for (const l of e.rows) {
    if (l.ligne_bancaire_id) {
      const i = parts.findIndex((p) => p.mouvements.includes(l.ligne_bancaire_id!))
      propres[i >= 0 ? i : auReleve].push(l)
    } else if (l.operation_caisse_id) {
      const i = parts.findIndex((p) => p.mouvements.includes(`caisse:${l.operation_caisse_id}`))
      propres[i >= 0 ? i : aLaCaisse >= 0 ? aLaCaisse : auReleve].push(l)
    } else if (aLaPoche >= 0 && contrepartieDirigeant(l)) propres[aLaPoche].push(l)
    else partagees.push(l)
  }
  partagees.sort((a, b) => Number(estUneTva(a)) - Number(estUneTva(b)) || a.compte.localeCompare(b.compte) || a.id.localeCompare(b.id))
  const poids = parts.map((p) => p.part)
  const totaux = repartir(partagees.reduce((s, l) => s + centimesSignes(l), 0), poids)
  const parLigne = partagees.map((l) => repartir(centimesSignes(l), poids))
  if (parLigne.length > 0) {
    parLigne[parLigne.length - 1] = totaux.map((t, i) => t - parLigne.slice(0, -1).reduce((s, m) => s + m[i], 0))
  }
  return parts.flatMap((p, i) => {
    const derivees = partagees.flatMap((l, j): EcritureBrouillon[] => {
      const c = parLigne[j][i]
      return c === 0 ? [] : [{ ...l, montant: Math.abs(c) / 100, sens: c > 0 ? 'debit' : 'credit' }]
    })
    const rows = [...propres[i], ...derivees]
    // Le rang du règlement dans la clé : à date et pièce égales, le tri du fichier suit l'ordre de `partsDesReglementsALaDate`
    // — le relevé d'abord —, jamais l'alphabet des modes.
    return rows.length === 0 ? [] : [{ ...e, cle: `${e.cle}|${i}|${p.cle}`, rows, reglement: p.reglement }]
  })
}

// Ce que le calcul des quatre champs lit, une fois par numérotation.
interface ContexteDesChamps {
  entrees: EntreesDesChampsBnc
  categories: readonly Categorie[]
  pieceById: ReadonlyMap<string, Piece>
  operationById: ReadonlyMap<string, ReturnType<typeof operationsDe>[number]>
  mouvementById: ReadonlyMap<string, MouvementBancaire>
  ventes: ReturnType<typeof rattachementDesVentes>
}

const AUCUN_POSTE: PosteLu = { de: 'aucun' }
const posteDuMoteur = (poste: Extract<PosteLu, { de: 'moteur' }>['poste']): PosteLu => ({ de: 'moteur', poste })

/**
 * D'où vient le poste de la 2035 d'une ligne (FEC22-Q3, (C)), selon la sorte de son écriture : la catégorie que la 2035 lit
 * pour sa source (celle de la pièce, de l'opération de caisse, du mouvement affecté, de la part ventilée sur le compte de la
 * ligne, la « Frais bancaires » des frais d'un mouvement d'encaissements), ou le poste que le moteur de la 2035 donne lui-même
 * à un rôle du plan (les dotations, les cotisations, le forfait, les intérêts et l'assurance d'un emprunt, les arrondis de la
 * liquidation, les ventes facturées). Jamais le libellé d'une catégorie, jamais deviné d'un compte qui n'est pas celui d'un
 * rôle. `natOpDeLaLigne` (lib/champsBncDuFec.ts) n'écrit le poste que sur une ligne de charge ou de produit, et seulement
 * de son cadre : une ligne de banque, de TVA ou de bilan porte la nature seule, quoi qu'on lui donne ici.
 */
function posteDeLaLigne(
  sorte: SorteDuFec, l: EcritureBrouillon, rows: readonly EcritureBrouillon[], x: ContexteDesChamps,
): PosteLu {
  const plan = x.entrees.plan
  const categorie = (id: string | null | undefined): PosteLu => ({ de: 'categorie', categorie: id ? x.categories.find((c) => c.id === id) ?? null : null })
  switch (sorte) {
    case 'piece': return categorie(x.pieceById.get(rows[0].piece_id ?? '')?.categorie_id)
    case 'caisse': return categorie(x.operationById.get(rows[0].operation_caisse_id ?? '')?.categorie_id)
    case 'releve': {
      const m = x.mouvementById.get(rows[0].ligne_bancaire_id ?? '')
      if (!m) return AUCUN_POSTE
      if (m.emprunt_id) {
        return l.compte === plan.interets_emprunt ? posteDuMoteur(POSTE_INTERETS_EMPRUNT)
          : l.compte === plan.assurance_emprunt ? posteDuMoteur(POSTE_ASSURANCE_EMPRUNT) : AUCUN_POSTE
      }
      if (m.cotisation_id) return l.compte === plan.cotisations_exploitant ? posteDuMoteur(POSTE_COTISATIONS) : AUCUN_POSTE
      if (m.ventilee) {
        // La part dont la catégorie porte le compte de la ligne ; deux parts de deux postes sur le même compte n'en disent
        // aucun — la ligne n'en porte qu'un, et on ne choisit pas.
        const candidates = x.entrees.ventilations.filter((v) => v.ligne_bancaire_id === m.id)
          .map((v) => x.categories.find((c) => c.id === v.categorie_id) ?? null)
          .filter((c): c is Categorie => c !== null && c.compte_comptable === l.compte)
        const postes = new Set(candidates.map((c) => c.poste_2035))
        return { de: 'categorie', categorie: postes.size === 1 ? candidates[0] : null }
      }
      return categorie(m.categorie_id)
    }
    case 'dotation': return l.compte === plan.dotations_amortissements ? posteDuMoteur(POSTE_AMORTISSEMENTS) : AUCUN_POSTE
    case 'forfait': return l.compte === plan.indemnites_kilometriques ? posteDuMoteur(POSTE_INDEMNITES_KM) : AUCUN_POSTE
    case 'liquidation':
      return l.compte === plan.arrondi_charge ? posteDuMoteur(POSTE_ARRONDIS_TVA_CHARGE)
        : l.compte === plan.arrondi_produit ? posteDuMoteur(POSTE_ARRONDIS_TVA_PRODUIT) : AUCUN_POSTE
    case 'paiement-personnel': return l.compte === plan.cotisations_exploitant ? posteDuMoteur(POSTE_COTISATIONS) : AUCUN_POSTE
    case 'facture': return AUCUN_POSTE
    case 'encaissement':
      return l.compte === plan.prestations_de_services || l.compte === plan.ventes_de_biens ? posteDuMoteur(POSTE_VENTES_FACTUREES) : AUCUN_POSTE
    case 'mouvement-encaissements':
      return l.compte === plan.services_bancaires
        ? { de: 'categorie', categorie: categorieDesFraisBancaires(x.categories, l.dossier_id) } : AUCUN_POSTE
  }
}

// Une facture que les factures lues ne rendent pas : elle n'identifie personne (`identificationDuClient` rend '' d'une
// facture qui n'est pas validée). Défensif : les factures sont lues en entier, et la composition ne cite que les leurs.
const factureNonLue = (id: string): FactureDuClient => ({ id, numero: null, statut: 'brouillon', tiers_siret: null, source_de_la_vente: true })

/**
 * Les quatre champs d'une écriture, par la règle de SA sorte (lib/champsBncDuFec.ts, `REGLES_DES_SORTES`) : ce fichier n'en
 * recopie aucune. Il ne fait que lui passer ce qu'il a lu — la source de l'écriture, telle que la clé l'a désignée — et le
 * poste de chaque ligne. Une source que la lecture ne rend pas (défensif) : `champsDUneSourceNonLue`.
 */
function champsDeLEcriture(e: EcritureANumeroter, x: ContexteDesChamps): ChampsBnc {
  const { choix, registre, factures, cotisations, acquisitions } = x.entrees
  const lignes: LigneACaracteriser[] = e.rows.map((l) => ({ id: l.id, compte: l.compte, libelle: l.libelle, poste: posteDeLaLigne(e.sorte, l, e.rows, x) }))
  const date = e.ordre
  const premiere = e.rows[0]
  const nonLue = () => champsDUneSourceNonLue(date, lignes, choix)
  const facture = (id: string) => factures.find((f) => f.id === id) ?? factureNonLue(id)
  switch (e.sorte) {
    case 'piece': {
      const piece = e.pieceId ? x.pieceById.get(e.pieceId) : undefined
      if (!piece) return nonLue()
      // La cible de la pièce par la règle de la génération (`piecesAComptabiliser`) : son bien, s'il en est un.
      const cible = piecesAComptabiliser([piece], [...x.categories], acquisitions, AUCUNE_FACTURE_SOURCE)[0]
      return champsDUnePiece({
        piece, reglement: e.reglement ?? { par: 'aucun' }, dateDeLEcriture: date,
        cible: { immobilisation: cible?.immobilisation ?? false },
        exemplaireDe: piece.facture_id === null ? null : factures.find((f) => f.id === piece.facture_id) ?? null,
        lignes, choix,
      })
    }
    case 'caisse': {
      const operation = x.operationById.get(premiere.operation_caisse_id ?? '')
      return (operation ? champsDUneOperationDeCaisse(operation, lignes) : null) ?? nonLue()
    }
    case 'releve': {
      const mouvement = x.mouvementById.get(premiere.ligne_bancaire_id ?? '')
      return (mouvement ? champsDUnMouvementDuReleve(mouvement, lignes, x.entrees.plan) : null) ?? nonLue()
    }
    case 'dotation': return champsDUneDotation(date, lignes, choix)
    case 'forfait': return champsDUnForfait(date, lignes, choix)
    case 'liquidation': return champsDUneLiquidation(date, lignes, choix)
    case 'paiement-personnel': {
      const id = premiere.cotisation_id ?? ''
      return champsDUnPaiementPersonnel(cotisations.find((c) => c.id === id) ?? { id, paiement_personnel_le: null }, lignes)
    }
    case 'facture':
    case 'encaissement':
    case 'mouvement-encaissements': {
      const vente = x.ventes.get(premiere.id)
      if (!vente) return nonLue()
      const s = vente.source
      switch (s.genre) {
        case 'facture':
        case 'avoir': return champsDeLaTvaDUneFacture(facture(s.factureId), date, lignes, choix)
        case 'encaissement': {
          const encaissement = registre.find((r) => r.id === s.encaissementId)
          return encaissement ? champsDUnEncaissement(encaissement, facture(s.factureId), lignes) : nonLue()
        }
        case 'mouvement': {
          const mouvement = x.mouvementById.get(s.ligneBancaireId)
          return mouvement ? champsDUnMouvementDesEncaissements(mouvement, registre, lignes) : nonLue()
        }
      }
    }
  }
}

const champsDeLaLigne = (c: ChampsBnc, id: string): ChampsBncDeLaLigne => ({
  dateRglt: c.dateRglt, modeRglt: c.modeRglt, nature: c.nature, natOp: c.natOp.get(id) ?? c.nature, idClient: c.idClient,
})

// Regroupe les écritures par pièce (une pièce = une écriture FEC, EcritureNum commun à toutes ses
// lignes), numérotées dans l'ordre chronologique à l'intérieur de leur journal — une vraie exigence
// du format, pas un détail cosmétique : un contrôleur qui importe un FEC aux EcritureNum non
// croissants dans un même journal le rejette.
//
// EN ENGAGEMENT (lib/engagement.ts), UNE PIÈCE FAIT PLUSIEURS ÉCRITURES : sa facture, au journal des
// achats ou des ventes, et chacun de ses règlements, au journal de BANQUE (BQ) — ce sont les lignes
// qui désignent leur mouvement. Les fondre en une seule écriture numéroterait sous un même
// EcritureNum des lignes datées de la facture et d'autres datées du paiement, dans le journal des
// achats, et la banque n'aurait pas de journal. Les lignes de 401 et de 411 y portent en plus le compte
// AUXILIAIRE du tiers (CompAuxNum, CompAuxLib), un seul libellé par numéro dans tout le fichier.
//
// UN MOUVEMENT JUSTIFIÉ PAR LE RELEVÉ (ligne 26.6, `mouvementJustifieParLeReleve`) — affecté à une
// catégorie, rapproché d'un emprunt ou d'une échéance de cotisation, ventilé sur plusieurs comptes, écrit
// sur un compte de bilan (ligne 26.7), rapproché d'une déclaration de TVA qu'il paie ou rembourse (ligne 26.8) ou
// classé en virement personnel — fait une écriture au journal de BANQUE, dans les deux modèles : sa pièce est le RELEVÉ qui le porte
// (PieceRef), à la date du mouvement (PieceDate). C'est ce qui manquait pour que le FEC porte chaque euro
// du relevé : un encaissement de l'Assurance maladie ou un prélèvement de l'exploitant n'y était nulle
// part.
//
// UNE DOTATION AUX AMORTISSEMENTS (lib/amortissements.ts) fait une écriture par bien et par exercice au
// journal des OPÉRATIONS DIVERSES (OD), au 31 décembre : sa pièce est le TABLEAU D'AMORTISSEMENT de
// l'exercice, qui la justifie (PieceRef). Sans elle, le 681100 de la 2035 n'était nulle part dans le
// fichier. LE FORFAIT KILOMÉTRIQUE (lib/forfaitKilometrique.ts) de même, une écriture par ligne du cadre 7,
// au même journal et à la même date : sa pièce est le BARÈME KILOMÉTRIQUE de l'exercice, appliqué au
// kilométrage déclaré. LA LIQUIDATION D'UNE DÉCLARATION DE TVA (ligne 26.8, lib/liquidationTva.ts) de même, une
// écriture par déclaration, au dernier jour de sa période : sa pièce est la CA3 arrêtée à cette date. UNE ÉCHÉANCE DE
// COTISATION PAYÉE DEPUIS LE COMPTE PERSONNEL (ligne 26.6, lib/cotisationPersonnelle.ts) de même, une écriture par
// échéance, au jour du paiement : sa pièce est le relevé du compte personnel de ce jour (`referenceDuPaiementPersonnel`).
// Les autres écritures sans pièce — le reste d'une pièce supprimée — restent dehors, et `absenceFec` les chiffre.
//
// UNE OPÉRATION DE LA CAISSE (ligne 26.6, étape C3b ; lib/controlesDeLaCaisse.ts) fait UNE écriture : les lignes qui la
// citent (`operation_caisse_id`), que la base a écrites d'un tenant avec elle, à sa date — la clé `caisse|opération|date`. Son
// journal suit son GENRE (CAISSE-Q3, (A), `journalDeLOperation`) : une recette, et des espèces rendues, au journal des
// VENTES ; un apport ou un prélèvement de l'exploitant aux OPÉRATIONS DIVERSES. Sa pièce est le récapitulatif de son jour,
// que le praticien garde (PCG, art. 1032-2) : PieceRef « Caisse du JJ/MM/AAAA », PieceDate sa date. EcritureLib reste le
// libellé que la base a composé, sans nom (« Recettes en espèces du … — Honoraires »). Le versement d'espèces en banque
// n'en est pas une : c'est un mouvement du relevé, au journal de BANQUE comme hier. Une ligne qui cite une opération que
// la lecture ne rend pas — une caisse absente, ou un appelant qui ne l'a pas lue — reste dehors, jamais devinée : les
// opérations sont un paramètre sans valeur par défaut. LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE (le genre `paiement`, étape
// C9) n'est pas d'ici : ses lignes portent leur pièce, et vont à l'écriture de la pièce, à son journal — C9 l'y conduira.
//
// UNE VENTE FACTURÉE (ligne 28.6, chantier EC-Q3, étape VF4c2 ; conception, § 5) fait les écritures que sa COMPOSITION rend
// (lib/ecrituresVentesFacturees.ts) : la facture, l'avoir et l'encaissement de trésorerie au journal des VENTES, le
// règlement d'engagement et le mouvement que ses encaissements classent au journal de BANQUE ; PieceRef, le numéro de la
// facture (de l'avoir), le relevé pour un mouvement ; PieceDate, la date d'émission du document, celle du mouvement ; le
// compte auxiliaire du 411, celui d'une pièce de vente du même client (« C » et la clé du nom) ; la clé, sa source et sa
// date. Chaque ligne du brouillon retrouve son écriture composée par sa SOURCE et sa DATE, jamais par un montant ni un
// libellé, et seulement si les lignes de la source à cette date SONT cette écriture (`rattachementDesVentes`, lib/
// ventesFactureesDesExports.ts) ; sinon — une source « à réécrire » ou « à retirer » — elles restent HORS du fichier, avec
// le reste d'une pièce supprimée, et l'onglet le dit. EcritureLib reste le libellé de la ligne, celui que la composition
// lui a donné en l'écrivant : le FEC d'un exercice validé le relira de la ligne seule (`numerotationValidee`), et les deux
// fichiers ne doivent différer que par ValidDate et le lettrage.
//
// LES QUATRE CHAMPS D'UN BNC EN TRÉSORERIE (lot FEC22c ; `champsBnc`). Reçus `exportes`, dans un dossier en trésorerie, la
// numérotation donne à chaque ligne et à chaque à-nouveau DateRglt, ModeRglt, NatOp et IdClient, par la règle de la sorte de
// son écriture (`champsDeLEcriture`), et scinde l'écriture d'une pièce payée le même jour par deux modes
// (`scinderParMode`). Reçus `non_exportes` — le drapeau baissé —, ou dans un dossier en engagement, elle est celle d'hier au
// caractère près : ni scission, ni champ de plus.
export function numeroterFec(
  ecritures: readonly EcritureBrouillon[], pieces: readonly Piece[], categories: Categorie[], aNouveaux: readonly ANouveau[],
  // Sans valeur par défaut : numéroté en trésorerie, le brouillon d'un dossier en engagement mettrait
  // ses règlements au journal des achats, sous le numéro de la facture.
  mode: ModeComptable,
  // Les lignes du relevé qui portent les mouvements affectés et les virements personnels — n'importe
  // quelles lignes, seules celles-là comptent. Sans valeur par défaut : les oublier sortirait du fichier
  // tous les encaissements sans bordereau, c'est-à-dire, pour un infirmier, presque toutes ses recettes.
  mouvements: readonly MouvementBancaire[],
  // Les écritures que la composition des ventes facturées du dossier rend (`ecrituresDesVentesFacturees`, sur des lectures
  // faites en entier). Sans valeur par défaut : oubliées, toutes les écritures d'un dossier qui a basculé sortiraient du
  // fichier — ses ventes. Un dossier qui n'a pas basculé n'en a aucune : la base refuse d'en écrire.
  ventesFacturees: readonly EcritureVenteFacturee[],
  // Les opérations de la caisse du dossier, lues en entier (lib/controlesDeLaCaisse.ts) — ou la caisse absente, le drapeau
  // baissé. Sans valeur par défaut : oubliées, toutes les recettes en espèces d'un praticien sortiraient du fichier.
  caisse: OperationsDeCaisse,
  // Les entrées des quatre champs d'un BNC en trésorerie, ou leur absence (le drapeau baissé). Sans valeur par défaut :
  // oubliées, le FEC d'un praticien sortirait à dix-huit colonnes sans que rien ne le dise.
  champsBnc: ChampsBncDuFec,
): NumerotationFec {
  const calcul = mode === 'tresorerie' && champsBnc.etat === 'exportes' ? champsBnc.entrees : null
  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const operationById = new Map(operationsDe(caisse).map((o) => [o.id, o]))
  const ventes = rattachementDesVentes(ecritures, ventesFacturees)
  const idsJustifies = idsMouvementsJustifiesParLeReleve(mouvements)
  const mouvementById = new Map(mouvements.map((m) => [m.id, m]))
  const libelleDu = libellesDesComptes(categories, aNouveaux)

  // La clé d'une écriture FEC : la pièce en trésorerie ; en engagement, la pièce et le mouvement d'un
  // règlement, la facture gardant la pièce seule ; le mouvement, pour un mouvement justifié par le relevé.
  //
  // ET, POUR UNE PIÈCE, SA DATE : UNE ÉCRITURE NE PORTE QU'UNE DATE (05/10/2026). EcritureDate est « la date de
  // comptabilisation de l'écriture comptable », une seule, et l'outil de la DGFiP le contrôle : une écriture dont les
  // lignes n'ont pas toutes la même date ressort parmi ses anomalies, « Différentes dates comptables » (Test Compta
  // Demat, SQL/ECRITURE.sql et SQL/VUES.sql — l'écran qu'il reproduit est celui des vérificateurs). En trésorerie, une
  // pièce payée en plusieurs fois porte une part par paiement, chacune à sa date (lib/rattachement.ts) : sous un seul
  // numéro, elle faisait une écriture à plusieurs dates. Elle en fait désormais une par date, équilibrée quand la pièce
  // est payée — la charge d'une date face à la banque de ce paiement, sa TVA complétant sa charge
  // (`lignesChargeProduitPourPiece`) ; une note de frais remboursée en partie, la part du virement à sa date et le
  // reste face au 108000 à la date de la note. En engagement, chaque écriture n'a déjà qu'une date ; la clé la porte
  // quand même, pour que l'invariant tienne par construction. `valider_exercice` refuse une écriture à deux dates.
  const groupes = new Map<string, EcritureBrouillon[]>()
  const horsFec: EcritureBrouillon[] = []
  for (const e of ecritures) {
    let cle: string
    const vente = ventes.get(e.id)
    if (vente) {
      cle = vente.cle
    } else if (porteUneSourceDeVente(e)) {
      // Une ligne d'une facture ou d'un encaissement que la composition ne rend plus telle quelle : à réécrire ou à retirer.
      horsFec.push(e)
      continue
    } else if (e.piece_id) {
      const source = mode === 'engagement' && e.ligne_bancaire_id ? `${e.piece_id}|${e.ligne_bancaire_id}` : e.piece_id
      cle = `${source}|${e.date}`
    } else if (e.operation_caisse_id) {
      // Une opération de caisse que la lecture rend, d'un genre qui a son journal ; sinon dehors, jamais devinée.
      const operation = operationById.get(e.operation_caisse_id)
      if (!operation || journalDeLOperation(operation.genre) === null) {
        horsFec.push(e)
        continue
      }
      cle = `caisse|${operation.id}|${e.date}`
    } else if (e.ligne_bancaire_id && idsJustifies.has(e.ligne_bancaire_id)) {
      cle = `releve|${e.ligne_bancaire_id}`
    } else if (e.immobilisation_id) {
      cle = `dotation|${e.immobilisation_id}|${e.date}`
    } else if (e.vehicule_id) {
      cle = `forfait|${e.vehicule_id}|${e.date}`
    } else if (e.declaration_tva_id) {
      cle = `liquidation|${e.declaration_tva_id}|${e.date}`
    } else if (e.cotisation_id) {
      cle = `paiement-personnel|${e.cotisation_id}|${e.date}`
    } else {
      horsFec.push(e)
      continue
    }
    groupes.set(cle, [...(groupes.get(cle) ?? []), e])
  }

  // La plus ancienne des lignes d'une écriture — jamais `rows[0].date`, qui dépend de l'ordre de
  // retour de la requête.
  const plusAncienne = (rows: EcritureBrouillon[]) =>
    rows.reduce((date, e) => (e.date < date ? e.date : date), rows[0].date)

  // L'ORDRE DES EcritureNum SUIT LA DATE DE L'ÉCRITURE, PAS CELLE DE LA FACTURE. Un EcritureNum non
  // croissant dans un même journal fait rejeter le fichier ; or depuis que l'écriture d'une pièce
  // payée est datée à son PAIEMENT (lib/rattachement.ts), deux factures peuvent se régler dans
  // l'ordre inverse de leurs dates, et trier sur PieceDate numéroterait un paiement de mars avant un
  // paiement de février. C'est aussi ce que `valider_exercice` vérifie : dans un journal, la plus
  // ancienne ligne d'une écriture ne précède jamais celle de l'écriture d'avant.
  const entrees = [...groupes.entries()]
    .map(([cle, rows]): EcritureANumeroter => {
      const pieceId = rows[0].piece_id
      const ordre = plusAncienne(rows)
      const vente = ventes.get(rows[0].id)
      if (vente) {
        const sorte = vente.source.genre === 'encaissement' ? 'encaissement' as const
          : vente.source.genre === 'mouvement' ? 'mouvement-encaissements' as const : 'facture' as const
        return { cle, sorte, pieceId: null, rows, ordre, journal: vente.journal, pieceDate: vente.pieceDate, pieceRef: vente.pieceRef,
          reglement: null }
      }
      if (!pieceId && rows[0].operation_caisse_id) {
        const operation = operationById.get(rows[0].operation_caisse_id)!
        return { cle, sorte: 'caisse', pieceId: null, rows, ordre, journal: journalDeLOperation(operation.genre)!, pieceDate: operation.date,
          pieceRef: referenceDeLaCaisse(operation.date), reglement: null }
      }
      if (!pieceId && rows[0].immobilisation_id && !rows[0].ligne_bancaire_id) {
        return { cle, sorte: 'dotation', pieceId: null, rows, ordre, journal: 'OD' as const, pieceDate: rows[0].date,
          pieceRef: `Tableau d'amortissement ${rows[0].date.slice(0, 4)}`, reglement: null }
      }
      if (!pieceId && rows[0].vehicule_id && !rows[0].ligne_bancaire_id) {
        return { cle, sorte: 'forfait', pieceId: null, rows, ordre, journal: 'OD' as const, pieceDate: rows[0].date,
          pieceRef: `Barème kilométrique ${rows[0].date.slice(0, 4)}`, reglement: null }
      }
      if (!pieceId && rows[0].declaration_tva_id && !rows[0].ligne_bancaire_id) {
        return { cle, sorte: 'liquidation', pieceId: null, rows, ordre, journal: 'OD' as const, pieceDate: rows[0].date,
          pieceRef: referenceDeLaLiquidation(rows[0].date), reglement: null }
      }
      if (!pieceId && rows[0].cotisation_id && !rows[0].ligne_bancaire_id) {
        return { cle, sorte: 'paiement-personnel', pieceId: null, rows, ordre, journal: 'OD' as const, pieceDate: rows[0].date,
          pieceRef: referenceDuPaiementPersonnel(rows[0].date), reglement: null }
      }
      if (!pieceId) {
        const mouvement = mouvementById.get(rows[0].ligne_bancaire_id!)!
        return { cle, sorte: 'releve', pieceId: null, rows, ordre, journal: 'BQ' as const, pieceDate: mouvement.date,
          pieceRef: referenceDuReleve(mouvement), reglement: null }
      }
      const piece = pieceById.get(pieceId)
      // Un règlement d'engagement : ses lignes désignent leur mouvement, celles de la facture aucun — la clé les sépare.
      const reglement = mode === 'engagement' && Boolean(rows[0].ligne_bancaire_id)
      // Date de la pièce (PieceDate) : celle du justificatif lui-même, avec pour repli la plus ancienne de
      // ses lignes. Sa référence : le nom du fichier, sinon le début de son identifiant — jamais vide, la
      // validation refuse une ligne sans pièce.
      return {
        cle, sorte: 'piece', pieceId, rows, ordre,
        journal: reglement ? 'BQ' as const : piece?.type_piece === 'vente' ? 'VE' as const : 'AC' as const,
        pieceDate: piece?.date_piece ?? ordre,
        pieceRef: champFec(piece?.nom_fichier ?? '') || pieceId.slice(0, 8),
        reglement: null,
      }
    })
    // Les quatre champs calculés (FEC22c), l'écriture d'une pièce prend le règlement de sa date — ou se scinde, une par
    // mode, quand deux règlements la paient ce jour-là. Une pièce que la lecture ne rend pas ne se scinde pas.
    .flatMap((e): EcritureANumeroter[] => {
      if (calcul === null || e.sorte !== 'piece' || e.pieceId === null) return [e]
      const piece = pieceById.get(e.pieceId)
      if (!piece) return [e]
      const cible = piecesAComptabiliser([piece], categories, calcul.acquisitions, AUCUNE_FACTURE_SOURCE)[0]
      const parts = partsDesReglementsALaDate(piece, calcul.paiements.get(piece.id) ?? [], e.ordre, calcul.registre)
      const tva = new Set([calcul.plan.tva_deductible, calcul.plan.tva_immobilisations, calcul.plan.tva_collectee])
      return scinderParMode(
        e, parts, (l) => estContrepartieDirigeant(piece, { compte: cible?.compte ?? '' }, l, calcul.plan), (l) => tva.has(l.compte),
      )
    })
    // À date égale, on départage sur la facture puis sur la clé, pour que deux exports successifs du
    // même brouillon produisent exactement le même fichier.
    .sort((a, b) => a.ordre.localeCompare(b.ordre) || a.pieceDate.localeCompare(b.pieceDate) || a.cle.localeCompare(b.cle))

  const contexte: ContexteDesChamps | null = calcul === null ? null
    : { entrees: calcul, categories, pieceById, operationById, mouvementById, ventes }
  const compteurs: Partial<Record<JournalCode, number>> = {}
  const lignes: LigneFec[] = []
  for (const ecriture of entrees) {
    const { pieceId, rows, journal, pieceDate, pieceRef } = ecriture
    const numero = (compteurs[journal] ?? 0) + 1
    compteurs[journal] = numero
    const piece = pieceId ? pieceById.get(pieceId) : undefined
    const vente = ventes.get(rows[0].id)
    const champs = contexte === null ? null : champsDeLEcriture(ecriture, contexte)
    for (const e of rows) {
      // Une pièce absente du jeu fourni n'a pas de tiers qu'on puisse lire : son auxiliaire est le
      // compte « divers », plutôt qu'une clé tirée d'un libellé qui peut n'être qu'un nom de fichier.
      // Un mouvement justifié par le relevé n'a pas de compte AUXILIAIRE : son écriture va de la catégorie,
      // ou du compte du dirigeant, à la banque — l'auxiliaire ne sert qu'aux 401 et 411 d'une pièce. Celui du 411 d'une
      // vente facturée est celui que la composition donne à son client (`auxiliaireDeLaLigne`).
      const auxiliaire = vente ? auxiliaireDeLaLigne(vente, e)
        : pieceId ? auxiliaireDuTiers(piece ?? { tiers: null }, e.compte) : null
      lignes.push({
        ecriture: e, journal, numero, pieceRef: champFec(pieceRef), pieceDate,
        compteLib: libelleDu(e.compte),
        compAuxNum: auxiliaire ? champFec(auxiliaire.num) : null,
        compAuxLib: auxiliaire ? champFec(auxiliaire.lib) : null,
        validDate: e.date,
        champsBnc: champs === null ? null : champsDeLaLigne(champs, e.id),
      })
    }
  }

  // Le libellé de chaque compte auxiliaire : le premier rencontré dans l'ordre du fichier, pour qu'un
  // même CompAuxNum ne porte qu'un CompAuxLib — l'OCR n'écrit pas deux fois le nom d'un fournisseur
  // de la même façon. La validation refuse un auxiliaire qui en porte deux.
  const ordonnees = ordonnerLignes(lignes)
  const libellesAuxiliaires = new Map<string, string>()
  for (const l of ordonnees) {
    if (l.compAuxNum === null) continue
    const premier = libellesAuxiliaires.get(l.compAuxNum)
    if (premier === undefined) libellesAuxiliaires.set(l.compAuxNum, l.compAuxLib!)
    else l.compAuxLib = premier
  }

  // Les quatre champs des à-nouveaux : une écriture, sans règlement (FEC22-Q1), NatOp « À-nouveaux » sur chaque ligne. Par
  // date, défensif — la base n'admet qu'une ouverture par dossier, mais l'exercice qui suit un exercice validé reçoit les
  // soldes reportés, sous la même forme.
  const champsDesAN = new Map<string, ChampsBnc>()
  if (calcul !== null) {
    for (const date of new Set(aNouveaux.map((a) => a.date))) {
      champsDesAN.set(date, champsDesANouveaux(aNouveaux.filter((a) => a.date === date), date, calcul.choix))
    }
  }
  return {
    aNouveaux: [...aNouveaux]
      .sort((a, b) => a.compte.localeCompare(b.compte) || a.id.localeCompare(b.id))
      .map((a) => {
        const champs = champsDesAN.get(a.date)
        return {
          aNouveau: a, compteLib: libelleDu(a.compte), ecritureLib: champFec(libelleEcritureANouveau(a)), validDate: a.date,
          champsBnc: champs === undefined ? null : champsDeLaLigne(champs, a.id),
        }
      }),
    lignes: ordonnees,
    horsFec,
    champsBnc: calcul === null ? 'non_calcules' : 'calcules',
  }
}

// LE FEC D'UN EXERCICE VALIDÉ SE RELIT DEPUIS CE QUI A ÉTÉ FIGÉ. Chaque écriture validée porte son journal, son
// numéro, sa pièce, le libellé de son compte et son compte auxiliaire, tels que `numeroterFec` les avait
// décidés le jour de la validation ; les à-nouveaux de l'exercice portent les libellés de leur compte et de leur
// écriture. Rien n'est relu des pièces ni des catégories d'aujourd'hui : une catégorie renommée ou un tiers
// corrigé ne changent plus le fichier. ValidDate est la date de la validation, à Paris — la base la date ainsi,
// et deux exports doivent rendre le même fichier où que soit le poste.
//
// Une écriture qui ne porte pas ce qu'une écriture validée porte n'est pas numérotée : elle part dans
// `horsFec`, au lieu d'être imprimée avec des champs vides. Elle ne peut pas exister — la base refuse la
// validation tant qu'une écriture de l'exercice reste proposée —, et c'est pourquoi elle se voit plutôt que
// de se cacher.
export function numerotationValidee(
  ecritures: readonly EcritureBrouillon[], aNouveaux: readonly ANouveau[],
  // L'instant de la validation de l'exercice (`exercices_valides.valide_le`), ValidDate des à-nouveaux.
  valideLe: string,
): NumerotationFec {
  const lignes: LigneFec[] = []
  const horsFec: EcritureBrouillon[] = []
  for (const e of ecritures) {
    if (e.statut !== 'validee' || !e.valide_le || !e.journal_code || !e.numero_ecriture || !e.piece_ref
      || !e.piece_date || !e.compte_lib) {
      horsFec.push(e)
      continue
    }
    // Les quatre champs ne sont pas encore figés (la migration FEC22b, puis FEC22c2) : le FEC validé reste à dix-huit.
    lignes.push({
      ecriture: e, journal: e.journal_code, numero: e.numero_ecriture, pieceRef: e.piece_ref, pieceDate: e.piece_date,
      compteLib: e.compte_lib, compAuxNum: e.comp_aux_num, compAuxLib: e.comp_aux_lib, validDate: dateAParis(e.valide_le),
      champsBnc: null,
    })
  }
  const validDate = dateAParis(valideLe)
  return {
    aNouveaux: [...aNouveaux]
      .sort((a, b) => a.compte.localeCompare(b.compte) || a.id.localeCompare(b.id))
      .map((a) => ({
        aNouveau: a,
        compteLib: a.compte_lib ?? champFec(libelleCompteTenu(a.compte) ?? (a.libelle || libelleDuPlanComptable(a.compte) || a.compte)),
        ecritureLib: a.ecriture_lib ?? champFec(libelleEcritureANouveau(a)),
        validDate,
        champsBnc: null,
      })),
    lignes: ordonnerLignes(lignes),
    horsFec,
    champsBnc: 'non_calcules',
  }
}

// La mise en forme, commune aux deux : en-tête, à-nouveaux, puis les écritures dans l'ordre de la
// numérotation, en tabulations et fins de ligne CRLF.
//
// LE LETTRAGE (EcritureLet, DateLet) vient de `lettrages` (lib/lettrage.ts), calculé sur TOUT le brouillon du dossier
// et non sur l'exercice exporté : une facture de décembre réglée en janvier porte le même code dans les deux fichiers.
// Une ligne que rien ne lettre laisse les deux champs à blanc, ce que la norme prévoit (« à blanc si non utilisé »).
//
// VINGT-DEUX COLONNES EN TRÉSORERIE, DIX-HUIT EN ENGAGEMENT (FEC22c ; conception, « CE QUI EST DÉCIDÉ », 1°). Un dossier en
// trésorerie dont la numérotation porte les quatre champs (`champsBnc: 'calcules'`, le drapeau levé) s'écrit au tableau du
// VIII, 7° : l'en-tête des dix-huit, puis DateRglt, ModeRglt, NatOp et IdClient, dans cet ordre, chaque ligne à vingt-deux
// champs, vides de fin compris (Test Compta Demat compte les champs de chaque ligne contre l'en-tête). DateRglt s'écrit
// AAAAMMJJ comme les autres dates, vide sans règlement ; les trois autres en toutes lettres, sans tabulation ni saut de
// ligne. Sans les quatre champs — le drapeau baissé, ou un exercice relu de ce qui a été figé avant FEC22b —, le fichier
// d'hier. En ENGAGEMENT, le fichier ne change pas d'un octet (VIII, 3°) : les ajouter ouvrirait, chez l'outil de la DGFiP,
// la correspondance à la main des champs inconnus.
export function formaterFec(
  numerotation: NumerotationFec,
  // Sans valeur par défaut : oublié, le FEC d'un dossier en engagement sortirait sans aucun lettrage, et rien ne le
  // dirait. Un dossier en trésorerie passe une table vide — rien ne s'y lettre.
  lettrage: ReadonlyMap<string, LettrageDeLigne>,
  // Le modèle comptable du dossier. Sans valeur par défaut : c'est lui qui dit le tableau du fichier — dix-huit
  // informations en engagement, vingt-deux en trésorerie.
  mode: ModeComptable,
): string {
  if (mode === 'engagement' && numerotation.champsBnc === 'calcules') {
    throw new Error('Le FEC d’un dossier en engagement n’a pas les quatre champs d’un BNC en trésorerie : sa numérotation ne les calcule pas.')
  }
  const vingtDeux = mode === 'tresorerie' && numerotation.champsBnc === 'calcules'
  // Les quatre champs d'une ligne, ou rien pour le fichier à dix-huit colonnes. Une ligne qui n'en porte pas dans un fichier
  // qui les écrit ne peut pas exister (`numeroterFec` les donne à chacune) : elle se voit plutôt que de s'écrire à blanc.
  const quatreChamps = (c: ChampsBncDeLaLigne | null): string[] => {
    if (!vingtDeux) return []
    if (c === null) throw new Error('Une ligne du FEC d’un BNC en trésorerie n’a pas ses quatre champs.')
    return [c.dateRglt === '' ? '' : yyyymmdd(c.dateRglt), champFec(c.modeRglt), champFec(c.natOp), champFec(c.idClient)]
  }
  const lignes: string[] = [(vingtDeux ? ENTETES_FEC_BNC : ENTETES_FEC).join('\t')]
  for (const { aNouveau: a, compteLib, ecritureLib, validDate, champsBnc } of numerotation.aNouveaux) {
    lignes.push([
      'AN',
      'À-nouveaux',
      'AN00001',
      yyyymmdd(a.date),
      champFec(a.compte),
      champFec(compteLib),
      '', '',
      champFec(a.source_nom),
      yyyymmdd(a.date),
      champFec(ecritureLib),
      a.sens === 'debit' ? montant(a.montant) : montant(0),
      a.sens === 'credit' ? montant(a.montant) : montant(0),
      '', '',
      yyyymmdd(validDate),
      '', '',
      ...quatreChamps(champsBnc),
    ].join('\t'))
  }
  for (const l of numerotation.lignes) {
    const e = l.ecriture
    lignes.push([
      l.journal,
      LIBELLES_JOURNAUX[l.journal],
      `${l.journal}${String(l.numero).padStart(5, '0')}`,
      yyyymmdd(e.date),
      champFec(e.compte),
      champFec(l.compteLib),
      l.compAuxNum ? champFec(l.compAuxNum) : '',
      l.compAuxLib ? champFec(l.compAuxLib) : '',
      champFec(l.pieceRef),
      yyyymmdd(l.pieceDate),
      champFec(e.libelle),
      e.sens === 'debit' ? montant(e.montant) : montant(0),
      e.sens === 'credit' ? montant(e.montant) : montant(0),
      lettrage.get(e.id)?.code ?? '',
      lettrage.has(e.id) ? yyyymmdd(lettrage.get(e.id)!.date) : '',
      yyyymmdd(l.validDate),
      '', '',
      ...quatreChamps(l.champsBnc),
    ].join('\t'))
  }
  return lignes.join('\r\n')
}

export function genererFec(
  ecritures: EcritureBrouillon[], pieces: Piece[], categories: Categorie[], aNouveaux: readonly ANouveau[],
  mode: ModeComptable, mouvements: readonly MouvementBancaire[], lettrage: ReadonlyMap<string, LettrageDeLigne>,
  ventesFacturees: readonly EcritureVenteFacturee[], caisse: OperationsDeCaisse, champsBnc: ChampsBncDuFec,
): string {
  return formaterFec(
    numeroterFec(ecritures, pieces, categories, aNouveaux, mode, mouvements, ventesFacturees, caisse, champsBnc), lettrage, mode,
  )
}

// SirenFECAAAAMMJJ.txt — nom de fichier imposé par le format (AAAAMMJJ = date de clôture de
// l'exercice couvert). Le SIRET saisi sur le dossier commence par le SIREN (9 premiers chiffres) ;
// à défaut de SIRET renseigné, un repère à corriger avant transmission plutôt qu'un fichier qui a
// l'air valide sans l'être.
export function nomFichierFec(siret: string | null, anneeCloture: number): string {
  const siren = siret ? siret.replace(/\D/g, '').slice(0, 9) : 'A_COMPLETER'
  return `${siren}FEC${anneeCloture}1231.txt`
}

export function telechargerTexte(nomFichier: string, contenu: string) {
  const blob = new Blob([contenu], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
