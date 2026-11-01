import { ecritureConforme, mouvementsAffectes, type MouvementBancaire } from './affectationBanque'
import {
  ecritureDeLOperation, ensembleDuJour, especesDUneFactureSource, jourDit, soldesDeLaCaisse, type EncaissementDeLaCaisse,
  type EtatDeLaCaisse,
  type FactureDeLaCaisse, type OperationAEcrire,
} from './caisse'
import type { ModeleComptable } from './engagement'
import { formatMoney } from './format'
import type { CaisseLue } from './recettesDeCaisse'
import type { ANouveau, Categorie, EcritureBrouillon, LigneBancaire, OperationCaisse, VentilationBancaire } from './types'
import { estFigee } from './validationExercice'
import { partsDesVentilations } from './ventilationBanque'

// LES CONTRÔLES DE LA CAISSE (ligne 26.6, étape C3b ; MVP-D2). La conception : HISTORIQUE.md, « LA CAISSE D'UN DOSSIER BNC :
// LA CONCEPTION — MVP-D2 (LIGNE 26.6) », § 4 (le double compte) et § 5 (le FEC, la piste d'audit, la validation) ; le
// module de la caisse, lib/caisse.ts (C2), dont ce module ne recopie aucune règle : la composition d'une écriture
// (`ecritureDeLOperation`), le solde de chaque jour (`soldesDeLaCaisse`) et l'ensemble qu'une recette reconnaît
// (`ensembleDuJour`) sont les siennes, celles que la base rejoue.
//
// CE QUE CE MODULE DIT, ET QUI LE LIT.
//   - Le FEC (lib/fec.ts) reçoit les opérations : une écriture par opération, au journal de son GENRE (CAISSE-Q3, (A)).
//   - Les préalables de la validation (lib/prealablesValidation.ts) et les points de la Vue d'ensemble
//     (lib/pointsDeLaChecklist.ts) : `caisse-a-reprendre` (une écriture qui manque ou ne suit plus sa composition, au plan et
//     au statut de TVA d'aujourd'hui), `caisse-negative` (défensif : la caisse lue négative un jour, que la base refuse
//     d'écrire mais qu'une restauration d'un état fautif laisserait), `recettes-de-caisse-a-revoir` (CAISSE-Q2, (A) : une
//     recette dont le jour a changé depuis sa saisie), `versements-especes-en-recette` (§ 4 a : un symptôme, jamais une
//     preuve).
//   - Les lots du relevé (pages/dossier/BanqueTab.tsx) : un crédit dont le libellé dit un versement d'espèces n'entre dans
//     aucun lot d'un dossier qui tient une caisse (`versementsDEspecesHorsDesLots`).
//
// PUR : aucun appel au réseau, et pas même un import de la lecture (lib/caisseLecture.ts importe le client ; le scanner des
// écrans qui lisent la base suit les imports — voir lib/recettesDeCaisse.ts). La forme lue est `CaisseLue`.
//
// LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE (le genre `paiement`, CAISSE-Q4 ; étape C9a) n'est pas jugé ici : sa contrepartie
// porte la pièce (`piece_id`), va au journal de la pièce et se juge avec elle — C9a l'a ajouté à `paiementsDesPieces` et à
// la piste d'audit ; C9b l'ajoutera aux préalables des pièces (`caisse-a-reprendre`). Ce module ne compose que les trois genres qu'`enregistrer_operation_caisse`
// saisit, et laisse un paiement de côté sans rien en dire.

// ── La forme que les contrôles reçoivent ──────────────────────────────────────────────────────────────────────────────

/**
 * Ce que le FEC et les contrôles reçoivent : la caisse ABSENTE (le drapeau `CAISSE_EXPORTEE` baissé — la table n'existe pas,
 * aucune ligne du brouillon ne cite une opération : rien à numéroter ni à dire, chaque export et chaque point rendent ce
 * qu'ils rendaient avant la caisse), ou ses opérations lues EN ENTIER, retirées et remplacées comprises. Une caisse lue en
 * partie n'entre pas ici : l'écran la tranche avant (`operationsPourLesControles`), comme `RecettesDeCaisse` (étape C3a) —
 * deux formes plutôt qu'une, parce que les moteurs ne comptent que les recettes vivantes, résolues, et que le FEC et les
 * contrôles lisent chaque opération telle qu'elle est en base.
 */
export type OperationsDeCaisse =
  | { etat: 'absente' }
  | { etat: 'lue'; dossierId: string; operations: readonly OperationCaisse[] }

/** La caisse absente : la table n'est pas en base, rien n'est numéroté ni dit. */
export const OPERATIONS_DE_CAISSE_ABSENTES: OperationsDeCaisse = { etat: 'absente' }

/** La lecture d'une caisse qui n'est pas en base (le drapeau baissé), telle que `lireLaCaisse` la rend — sans son motif. */
export const CAISSE_PAS_EN_BASE: CaisseLue = { dossierId: '', enBase: false, lignes: [], complete: false, motif: null }

/** Ce que l'écran tient : la forme des contrôles, ou ce qui l'empêche — pas encore revenue, ou lue en partie. */
export type EtatDesOperationsDeCaisse =
  | OperationsDeCaisse
  | { etat: 'en_attente' }
  | { etat: 'incomplete'; motif: string }

/**
 * Les opérations de la caisse de CE dossier, telles que l'écran les tient : pas encore revenues (ou celles d'un dossier
 * quitté — `DossierDetail` reste monté d'un dossier à l'autre), absentes, lues en partie, ou lues en entier.
 */
export function operationsDeCaisseDuDossier(lecture: CaisseLue | null, dossierId: string): EtatDesOperationsDeCaisse {
  if (lecture === null || lecture.dossierId !== dossierId) return { etat: 'en_attente' }
  if (!lecture.enBase) return OPERATIONS_DE_CAISSE_ABSENTES
  if (!lecture.complete) return { etat: 'incomplete', motif: lecture.motif ?? 'la lecture de la caisse est incomplète' }
  return { etat: 'lue', dossierId, operations: lecture.lignes }
}

/** La forme des contrôles, ou nulle quand rien ne doit s'en tirer (pas encore revenue, lue en partie). */
export function operationsPourLesControles(etat: EtatDesOperationsDeCaisse): OperationsDeCaisse | null {
  return etat.etat === 'absente' || etat.etat === 'lue' ? etat : null
}

/** Ce qui manque à une caisse qu'on ne peut pas juger, en clair ; nul pour une caisse absente ou lue. */
export function motifDesOperationsDeCaisse(etat: EtatDesOperationsDeCaisse): string | null {
  if (etat.etat === 'incomplete') return etat.motif
  if (etat.etat === 'en_attente') return 'la caisse du dossier n’est pas encore lue'
  return null
}

/** Les opérations d'une forme : aucune quand la caisse est absente. */
export function operationsDe(caisse: OperationsDeCaisse): readonly OperationCaisse[] {
  return caisse.etat === 'lue' ? caisse.operations : []
}

// ── Les journaux et les pièces du FEC (CAISSE-Q3, (A)) ────────────────────────────────────────────────────────────────

/**
 * Le journal d'une opération dans le FEC, selon son genre — les journaux d'aujourd'hui (CAISSE-Q3, (A), le 28/10/2026) : une
 * recette, et des espèces rendues, au journal des VENTES, comme l'encaissement de trésorerie d'une vente facturée, au 53
 * compris ; un apport ou un prélèvement de l'exploitant aux OPÉRATIONS DIVERSES, comme le paiement d'une échéance depuis
 * son compte personnel. Le versement d'espèces en banque n'est pas une opération : c'est un mouvement du relevé, au journal
 * de BANQUE comme hier. Nul pour le paiement d'une pièce (C9), qui ira au journal de sa pièce.
 */
export function journalDeLOperation(genre: OperationCaisse['genre']): 'VE' | 'OD' | null {
  if (genre === 'recette') return 'VE'
  if (genre === 'apport' || genre === 'prelevement') return 'OD'
  return null
}

/**
 * La pièce d'une opération de caisse dans le FEC (PieceRef) : le récapitulatif de son jour, que le praticien garde (PCG,
 * art. 1032-2 : « les opérations de même nature, réalisées en un même lieu et au cours d'une même journée, peuvent être
 * récapitulées sur une pièce justificative unique ») — rien ne se dépose dans l'application, et la référence se compose de
 * la date. Aucun nom : un total de jour ne nomme personne (BOI-BNC-DECLA-10-20, § 70 et § 280).
 */
export function referenceDeLaCaisse(date: string): string {
  return `Caisse du ${jourDit(date)}`
}

/**
 * Le justificatif d'une opération de caisse dans la piste d'audit : le brouillard du praticien, tenu hors de l'application,
 * dont rien n'a d'empreinte ici — le patron du paiement d'une échéance depuis le compte personnel (lib/pisteAudit.ts). La
 * colonne de l'empreinte reste vide plutôt que de laisser croire à une preuve.
 */
export function justificatifDeLaCaisse(date: string): string {
  return `Brouillard de caisse du ${jourDit(date)}, tenu hors de l’application`
}

// ── Ce que la caisse lit du reste du dossier ──────────────────────────────────────────────────────────────────────────

/**
 * Les espèces des factures, telles que la caisse les lit : celles d'un dossier qui n'a pas basculé n'existent pas (aucune
 * facture n'y est source : `premier_jour_negatif_de_la_caisse` n'en compte aucune) ; celles d'un dossier basculé, le
 * registre entier des encaissements et ses factures, lus EN ENTIER ; ou lues en partie — les deux contrôles qui en
 * dépendent (la caisse négative, les recettes à revoir) se taisent alors.
 */
export type EspecesDesFactures =
  | { etat: 'sans_objet' }
  | { etat: 'lues'; encaissements: readonly EncaissementDeLaCaisse[]; factures: readonly FactureDeLaCaisse[] }
  | { etat: 'incomplete'; motif: string }

/** Tout ce que la caisse rejoue d'un dossier, en plus de ses opérations. */
export interface DossierDesControlesDeLaCaisse {
  modele: ModeleComptable
  /** Le statut d'aujourd'hui : une recette s'écrit sans TVA sur un dossier qui ne l'est pas, avec son taux sinon. */
  assujettiTva: boolean
  /** Les catégories lues, du dossier et communes : le compte d'une recette, son libellé. */
  categories: readonly Categorie[]
  /** Le brouillon ENTIER : les lignes qui citent une opération. */
  ecritures: readonly EcritureBrouillon[]
  /** La reprise (`a_nouveaux`) : l'ouverture de la caisse, son 53. */
  ouvertures: readonly Pick<ANouveau, 'date' | 'compte' | 'sens' | 'montant'>[]
  /** Le relevé ENTIER : les mouvements classés sur la caisse. */
  mouvements: readonly Pick<LigneBancaire, 'id' | 'date' | 'montant' | 'compte_bilan'>[]
  especes: EspecesDesFactures
  /** La frontière de la validation : ce qui la précède est figé, et rien ne s'y reprend. */
  frontiere: string | null
}

/** La caisse jour par jour, telle que `premier_jour_negatif_de_la_caisse` la rejoue ; nulle quand les espèces des factures
 *  ne sont pas lues en entier. */
export function etatDeLaCaisseLue(operations: readonly OperationCaisse[], d: DossierDesControlesDeLaCaisse): EtatDeLaCaisse | null {
  if (d.especes.etat === 'incomplete') return null
  return {
    compteCaisse: d.modele.plan.caisse,
    ouvertures: d.ouvertures,
    operations,
    mouvements: d.mouvements,
    encaissements: d.especes.etat === 'lues' ? d.especes.encaissements : [],
    factures: d.especes.etat === 'lues' ? d.especes.factures : [],
  }
}

// ── caisse-a-reprendre ────────────────────────────────────────────────────────────────────────────────────────────────

export type RaisonDeReprendre =
  /** L'opération n'a aucune ligne au brouillon. */
  | 'ecriture_absente'
  /** Ses lignes ne sont plus celles que sa composition donne aujourd'hui : un plan changé, un statut de TVA changé. */
  | 'ecriture_perimee'
  /** Sa composition ne se fait plus : sa catégorie n'est plus lue, ou n'est plus un produit, ou un dossier devenu assujetti
   *  attend un taux que la recette ne porte pas. */
  | 'ne_s_ecrit_plus'
  /** Des lignes citent une opération retirée, ou qu'aucune lecture ne rend : la base les retire avec elle (défensif). */
  | 'ecriture_restee'

export interface OperationAReprendre {
  operationId: string
  /** Nulle pour des lignes restées d'une opération que la lecture ne rend pas. */
  operation: OperationCaisse | null
  /** Le jour qui la range dans un exercice : celui de l'opération, ou de sa première ligne restée. */
  date: string
  raison: RaisonDeReprendre
}

export const LIBELLE_RAISON_DE_REPRENDRE: Readonly<Record<RaisonDeReprendre, string>> = {
  ecriture_absente: 'écriture absente',
  ecriture_perimee: 'écriture qui ne suit plus l’opération',
  ne_s_ecrit_plus: 'ne s’écrit plus au plan ou au statut de TVA d’aujourd’hui',
  ecriture_restee: 'écriture restée d’une opération retirée',
}

/** Une opération vivante d'un genre que la saisie écrit : ni retirée (une opération remplacée l'est aussi), ni un paiement. */
function vivanteEtComposable(o: OperationCaisse): boolean {
  return o.retire_le == null && (o.genre === 'recette' || o.genre === 'apport' || o.genre === 'prelevement')
}

/**
 * L'opération telle que sa composition la voit AUJOURD'HUI, ou nulle quand elle ne se compose plus : la catégorie d'une
 * recette lue et de produit (classe 7, la règle de la base) ; le taux de la recette sur un dossier assujetti, aucun sinon —
 * `tauxApplicable` de la recette du relevé, que la 2035 et la CA3 suivent déjà (lib/recettesDeCaisse.ts).
 */
function operationAEcrire(o: OperationCaisse, d: Pick<DossierDesControlesDeLaCaisse, 'categories' | 'assujettiTva'>): OperationAEcrire | null {
  if (o.genre === 'apport' || o.genre === 'prelevement') {
    return { genre: o.genre, date: o.date, montant: o.montant, taux_tva: null, categorie: null }
  }
  const categorie = o.categorie_id == null ? undefined : d.categories.find((c) => c.id === o.categorie_id)
  if (categorie === undefined || categorie.compte_comptable == null || !/^7[0-9]{2}/.test(categorie.compte_comptable)) return null
  if (d.assujettiTva && o.taux_tva == null) return null
  return {
    genre: 'recette', date: o.date, montant: o.montant, taux_tva: d.assujettiTva ? o.taux_tva : null,
    categorie: { libelle: categorie.libelle, compte_comptable: categorie.compte_comptable },
  }
}

/**
 * LES OPÉRATIONS DONT L'ÉCRITURE MANQUE OU NE SUIT PLUS SA COMPOSITION, hors des exercices figés. La base écrit l'opération et
 * son écriture d'un tenant, et garde l'une avec l'autre (`garder_ecriture_de_caisse`) : ce contrôle est DÉFENSIF — un plan
 * du dossier changé depuis la saisie (le compte de la caisse, celui de l'exploitant, de la TVA), un statut de TVA changé, une
 * catégorie qui a changé de compte, une restauration d'un état fautif. L'écriture attendue est celle que l'application
 * composerait aujourd'hui (`ecritureDeLOperation`, au plan du dossier), comparée ligne à ligne sur le compte, le sens, le
 * montant et la date (`ecritureConforme`, la règle des écritures du relevé) — pas sur le libellé, que la base a composé avec le
 * nom de la catégorie du jour de la saisie : une catégorie renommée ne se reprend pas. Le remède est le même pour tous :
 * retirer l'opération, puis la saisir de nouveau.
 */
export function operationsDeCaisseAReprendre(
  operations: readonly OperationCaisse[], d: Pick<DossierDesControlesDeLaCaisse, 'modele' | 'assujettiTva' | 'categories' | 'ecritures' | 'frontiere'>,
): OperationAReprendre[] {
  const parOperation = new Map<string, EcritureBrouillon[]>()
  for (const e of d.ecritures) {
    if (!e.operation_caisse_id) continue
    parOperation.set(e.operation_caisse_id, [...(parOperation.get(e.operation_caisse_id) ?? []), e])
  }
  const parId = new Map(operations.map((o) => [o.id, o]))
  const aReprendre: OperationAReprendre[] = []
  for (const o of operations) {
    if (!vivanteEtComposable(o) || estFigee(o.date, d.frontiere)) continue
    const lignes = parOperation.get(o.id) ?? []
    const op = operationAEcrire(o, d)
    if (op === null) {
      aReprendre.push({ operationId: o.id, operation: o, date: o.date, raison: 'ne_s_ecrit_plus' })
    } else if (lignes.length === 0) {
      aReprendre.push({ operationId: o.id, operation: o, date: o.date, raison: 'ecriture_absente' })
    } else if (!ecritureConforme(lignes, ecritureDeLOperation(op, d.modele), o.date)) {
      aReprendre.push({ operationId: o.id, operation: o, date: o.date, raison: 'ecriture_perimee' })
    }
  }
  // Les lignes restées d'une opération retirée, ou que la lecture ne rend pas — un paiement (C9) excepté, que sa pièce juge.
  for (const [id, lignes] of parOperation) {
    const o = parId.get(id)
    if (o !== undefined && (o.retire_le == null || o.genre === 'paiement')) continue
    if (o === undefined && lignes.some((l) => l.piece_id)) continue
    const date = lignes.reduce((a, l) => (l.date < a ? l.date : a), lignes[0].date)
    if (estFigee(date, d.frontiere)) continue
    aReprendre.push({ operationId: id, operation: o ?? null, date, raison: 'ecriture_restee' })
  }
  return aReprendre.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    || (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0))
}

// ── caisse-negative ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * LE PREMIER JOUR OÙ LA CAISSE EST NÉGATIVE après la frontière (PCG, art. 1215-53 : son solde « est soit débiteur soit
 * nul »), le solde de la fin de ce jour en centimes ; nul quand elle ne l'est jamais. DÉFENSIF : la base refuse toute écriture
 * qui la rendrait négative (`premier_jour_negatif_de_la_caisse`, dix déclencheurs) ; seule une restauration d'un état fautif
 * la laisserait ainsi. Un jour figé ne se reprend plus : la caisse est jugée sur ce qui reste ouvert.
 */
export function caisseNegative(etat: EtatDeLaCaisse, frontiere: string | null): { jour: string; centimes: number } | null {
  return soldesDeLaCaisse(etat).find((s) => s.centimes < 0 && !estFigee(s.jour, frontiere)) ?? null
}

/** Les mots d'une caisse négative : le jour et le solde, comme la base les dit (`texte_caisse_negative`). */
export function caisseNegativeDite(n: { jour: string; centimes: number }): string {
  return `${jourDit(n.jour)} (${n.centimes < 0 ? '−' : ''}${formatMoney(Math.abs(n.centimes) / 100)})`
}

// ── recettes-de-caisse-a-revoir (CAISSE-Q2, (A)) ──────────────────────────────────────────────────────────────────────

export interface RecetteARevoir {
  operation: OperationCaisse
  /** Les encaissements en espèces que la saisie a reconnus. */
  reconnus: readonly string[]
  /** Ceux que la caisse compte aujourd'hui ce jour-là. */
  attendus: readonly string[]
}

/**
 * LES RECETTES DONT LE JOUR A CHANGÉ DEPUIS LEUR SAISIE (CAISSE-Q2, (A), conception § 4 b) : la saisie d'une recette reconnaît,
 * en base, l'ensemble des encaissements en espèces de factures sources de son jour (`encaissements_du_jour`) ; un encaissement
 * enregistré, retiré ou rattaché depuis — une autre session, ou un geste du registre — rend cet ensemble différent de celui que
 * la caisse compte aujourd'hui (`ensembleDuJour`, la règle même de la saisie). Le total saisi a peut-être compté les espèces
 * d'une facture que son encaissement compte aussi, ou en oublié : il se revoit, puis la recette se retire et se saisit de
 * nouveau. Hors des exercices figés ; une recette vivante seulement (une remplacée est retirée).
 */
export function recettesDeCaisseARevoir(operations: readonly OperationCaisse[], etat: EtatDeLaCaisse, frontiere: string | null): RecetteARevoir[] {
  return operations
    .filter((o) => o.genre === 'recette' && o.retire_le == null && !estFigee(o.date, frontiere))
    .flatMap((o) => {
      const reconnus = [...(o.encaissements_du_jour ?? [])].sort()
      const attendus = ensembleDuJour(etat, o.date)
      const memes = reconnus.length === attendus.length && reconnus.every((x, i) => x === attendus[i])
      return memes ? [] : [{ operation: o, reconnus, attendus }]
    })
    .sort((a, b) => (a.operation.date < b.operation.date ? -1 : a.operation.date > b.operation.date ? 1 : 0)
      || (a.operation.id < b.operation.id ? -1 : a.operation.id > b.operation.id ? 1 : 0))
}

/** Les numéros des factures dont une recette à revoir a changé de jour : celles des encaissements en plus ou en moins. */
export function facturesDeLaRecetteARevoir(r: RecetteARevoir, etat: EtatDeLaCaisse): string[] {
  const changes = [...r.reconnus.filter((x) => !r.attendus.includes(x)), ...r.attendus.filter((x) => !r.reconnus.includes(x))]
  const numeros = changes.map((id) => {
    const e = etat.encaissements.find((x) => x.id === id)
    return (e ? etat.factures.find((f) => f.id === e.facture_id)?.numero : null) ?? 'sans numéro'
  })
  return [...new Set(numeros)].sort()
}

// ── Le versement d'espèces (§ 4 a) ────────────────────────────────────────────────────────────────────────────────────

// LE LIBELLÉ D'UN VERSEMENT D'ESPÈCES, tel que les banques l'écrivent : « VERSEMENT ESPECES », « VRST ESP », « DEPOT
// D'ESPECES », « REMISE ESPECES »… — un mot du dépôt, puis les espèces, après la normalisation (sans accent, en capitales, la
// ponctuation en espace). Un SYMPTÔME, jamais une preuve : un crédit ainsi libellé peut être autre chose, et un versement
// peut porter un libellé que rien ici ne reconnaît. D'où le seul geste qui en découle : un crédit ainsi libellé n'entre dans
// aucun lot, et la Vue d'ensemble le dit en « attention » s'il est rangé en recette.
const VERSEMENT_D_ESPECES = /\b(VERSEMENTS?|VERSMT|VERST|VRST|VERS|VRS|DEPOTS?|DEP|REMISES?|REM)( (EN|D|DE|DES))? (ESPECES?|ESPCES?|ESP)\b/

function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

/** Le libellé de ce mouvement dit-il un versement d'espèces ? Le libellé lu et le libellé brut de la banque, l'un ou l'autre. */
export function libelleDitUnVersementDEspeces(ligne: Pick<LigneBancaire, 'libelle' | 'libelle_brut'>): boolean {
  return [ligne.libelle, ligne.libelle_brut].some((t) => typeof t === 'string' && VERSEMENT_D_ESPECES.test(normaliser(t)))
}

/**
 * LA CAISSE HORS DE SES OPÉRATIONS : ce que la reprise et le relevé en disent (relecture de la caisse du 31/10/2026). Le
 * compte de la caisse est celui DU PLAN du dossier (`modele.plan.caisse`), jamais un 53 deviné — la base lit
 * `compte_du_role(dossier, 'caisse')`. Chaque entrée est lue EN ENTIER, ou nulle : pas encore revenue, lue en partie, ou d'un
 * autre dossier (le vide est une affirmation, que seule une lecture entière fait).
 */
export interface RepriseEtReleveDeLaCaisse {
  compteCaisse: string
  /** La reprise ENTIÈRE (`a_nouveaux`), ou nulle quand elle n'est pas lue en entier. */
  ouvertures: readonly Pick<ANouveau, 'compte' | 'sens' | 'montant'>[] | null
  /** Le relevé ENTIER, ou nul quand il n'est pas lu en entier. */
  mouvements: readonly Pick<LigneBancaire, 'compte_bilan'>[] | null
}

/**
 * LE DOSSIER TIENT-IL UNE CAISSE ? Une opération non retirée le dit ; et, depuis C6-Q1 (réponse du cabinet du 31/10/2026), un
 * encaissement en espèces d'une facture source qui y entre (`especesDUneFactureSource`) : son dépôt en banque n'a plus d'autre
 * chemin que le versement classé sur la caisse (C6), et les deux protections du § 4 a — hors des lots, et le point de la Vue
 * d'ensemble — doivent le couvrir, même sans aucune opération saisie. Et, depuis la relecture du 31/10/2026, la caisse qui
 * n'existe encore que par la REPRISE ou le RELEVÉ : un solde repris non nul au compte de la caisse (le praticien arrive avec
 * ses espèces dans sa balance), ou un mouvement du relevé classé sur ce compte. Le cabinet importe souvent le relevé avant de
 * saisir le brouillard : sans cela, un « VERSEMENT ESPECES » entrerait dans les lots, une règle apprise le rangerait en
 * recette, et les mêmes espèces se compteraient une seconde fois avec les recettes du brouillard.
 *
 * Absente (le drapeau baissé) : non, quoi que disent les factures, la reprise ou le relevé. Aucune de ces quatre sources ne
 * dit oui, toutes lues (les espèces sans objet : un dossier qui n'a pas basculé) : non. Sinon, l'une pas encore revenue ou
 * lue en partie, et aucune autre qui dise oui : on ne sait pas — « peut-être », que les lots traitent comme oui (écarter d'un
 * lot ne perd rien : le mouvement reste à traiter depuis sa fiche) et que la Vue d'ensemble tait.
 */
export function dossierTientUneCaisse(
  etat: EtatDesOperationsDeCaisse, especes: EspecesDesFactures, horsDesOperations: RepriseEtReleveDeLaCaisse,
): 'oui' | 'non' | 'peut_etre' {
  if (etat.etat === 'absente') return 'non'
  const parLesOperations = etat.etat === 'lue' ? etat.operations.some((o) => o.retire_le == null) : null
  // L'encaissement qui ENTRE, pas sa contre-passation : un seul suffit, même défait depuis — la caisse l'a reçu.
  const parLesFactures = especes.etat === 'sans_objet' ? false
    : especes.etat === 'lues' ? especes.encaissements.some((e) => e.annule_id == null && especesDUneFactureSource(e, especes))
      : null
  const { compteCaisse, ouvertures, mouvements } = horsDesOperations
  // Le SOLDE repris au compte de la caisse, en centimes, comme `fluxDeLaCaisse` le compte à l'ouverture : nul, rien n'a été
  // repris en espèces.
  const parLaReprise = ouvertures === null ? null
    : ouvertures.filter((a) => a.compte === compteCaisse)
      .reduce((solde, a) => solde + (a.sens === 'debit' ? 1 : -1) * Math.round(a.montant * 100), 0) !== 0
  const parLeReleve = mouvements === null ? null : mouvements.some((m) => m.compte_bilan === compteCaisse)
  const reponses = [parLesOperations, parLesFactures, parLaReprise, parLeReleve]
  if (reponses.includes(true)) return 'oui'
  if (reponses.every((r) => r === false)) return 'non'
  return 'peut_etre'
}

/** Les mots que la carte d'un lot dit d'un crédit qu'elle écarte parce que son libellé dit un versement d'espèces. */
export const RAISON_VERSEMENT_D_ESPECES = 'son libellé dit un versement d’espèces, que sa fiche classe sur la caisse — '
  + 'rangé en recette, il compterait deux fois les espèces que la caisse a déjà comptées'

/**
 * LES CRÉDITS DONT LE LIBELLÉ DIT UN VERSEMENT D'ESPÈCES, dans un dossier qui tient (ou peut-être) une caisse : aucun lot du
 * relevé ne les prend (conception, § 4 a) — le rapprochement automatique, « Valider et rapprocher », les règles et la règle
 * d'ignorance. Rangés en recette par une règle, ils compteraient deux fois des espèces que la caisse compte déjà ; le versement
 * se classe sur la caisse, depuis la fiche du mouvement (C4). Les mouvements qu'un autre motif écarte déjà gardent le leur.
 * Sans caisse (le drapeau baissé, ou ni opération vivante, ni espèces d'une facture source qui y entrent — C6-Q1 —, ni solde
 * repris, ni mouvement classé sur la caisse — la relecture du 31/10/2026), la carte est rendue telle quelle.
 */
export function versementsDEspecesHorsDesLots(
  hors: ReadonlyMap<string, string>,
  caisse: EtatDesOperationsDeCaisse,
  especes: EspecesDesFactures,
  horsDesOperations: RepriseEtReleveDeLaCaisse,
  lignes: readonly Pick<LigneBancaire, 'id' | 'montant' | 'libelle' | 'libelle_brut'>[],
): ReadonlyMap<string, string> {
  if (dossierTientUneCaisse(caisse, especes, horsDesOperations) === 'non') return hors
  const versements = lignes.filter((l) => l.montant > 0 && !hors.has(l.id) && libelleDitUnVersementDEspeces(l))
  if (versements.length === 0) return hors
  const avec = new Map(hors)
  for (const l of versements) avec.set(l.id, RAISON_VERSEMENT_D_ESPECES)
  return avec
}

/**
 * LES CRÉDITS DONT LE LIBELLÉ DIT UN VERSEMENT D'ESPÈCES ET QUI SONT RANGÉS EN RECETTE — affectés à une catégorie de produit,
 * ou ventilés avec une part de produit —, hors des exercices figés, dans un dossier qui tient une caisse. Un symptôme du double
 * compte (§ 4 a) : les espèces comptées dans la caisse à leur jour, puis une seconde fois au dépôt. Dans l'ordre du relevé.
 */
export function versementsDEspecesEnRecette(
  lignes: readonly MouvementBancaire[],
  ventilations: readonly VentilationBancaire[],
  categories: readonly Categorie[],
  assujettiTva: boolean,
  frontiere: string | null,
): MouvementBancaire[] {
  const enRecette = new Set([
    ...mouvementsAffectes(lignes, categories, assujettiTva).filter((m) => m.nature === 'recette').map((m) => m.ligne.id),
    ...partsDesVentilations(lignes, ventilations, categories, assujettiTva).filter((p) => p.nature === 'recette').map((p) => p.ligne.id),
  ])
  return lignes.filter((l) => l.montant > 0 && enRecette.has(l.id) && !estFigee(l.date, frontiere) && libelleDitUnVersementDEspeces(l))
}

// ── Les mots d'un contrôle ────────────────────────────────────────────────────────────────────────────────────────────

const NOM_DU_GENRE: Readonly<Record<OperationCaisse['genre'], string>> = {
  recette: 'recette', apport: 'apport', prelevement: 'prélèvement', paiement: 'paiement',
}

/** Une opération, nommée pour un détail : son jour, son genre et son montant — jamais un nom (il n'y en a pas). */
export function operationNommee(o: Pick<OperationCaisse, 'date' | 'genre' | 'montant'>): string {
  const genre = o.genre === 'recette' && o.montant < 0 ? 'espèces rendues' : NOM_DU_GENRE[o.genre]
  return `le ${jourDit(o.date)}, ${genre} de ${formatMoney(Math.abs(o.montant))}`
}

const AU_PLUS = 6

/** Une énumération qui s'arrête à six, et dit le reste. */
export function enumerer(noms: readonly string[]): string {
  const cites = noms.slice(0, AU_PLUS)
  return `${cites.join(' ; ')}${noms.length > cites.length ? ` ; et ${noms.length - cites.length} autre(s)` : ''}`
}

/** Le détail des opérations à reprendre : chacune, et pourquoi. */
export function detailDesOperationsAReprendre(liste: readonly OperationAReprendre[]): string {
  return `${enumerer(liste.map((x) => `${x.operation ? operationNommee(x.operation) : `le ${jourDit(x.date)}`} `
    + `(${LIBELLE_RAISON_DE_REPRENDRE[x.raison]})`))}.`
}

/** Le détail des recettes à revoir : chacune, et les factures dont les espèces ont changé ce jour-là. */
export function detailDesRecettesARevoir(liste: readonly RecetteARevoir[], etat: EtatDeLaCaisse): string {
  return `${enumerer(liste.map((r) => `${operationNommee(r.operation)} (${facturesDeLaRecetteARevoir(r, etat).join(', ')})`))}.`
}

/** Le détail des versements rangés en recette : chacun, par sa date, son montant et son libellé. */
export function detailDesVersementsEnRecette(liste: readonly Pick<LigneBancaire, 'date' | 'montant' | 'libelle'>[]): string {
  return `${enumerer(liste.map((l) => `le ${jourDit(l.date)}, ${formatMoney(l.montant)} (${l.libelle})`))}.`
}
