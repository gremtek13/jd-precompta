import { remplirModele, type RefusEncaissement } from './encaissementsFactures'
import { anneeDe } from './format'
import type { FactureEmise, Membership } from './types'
import { exerciceQuiFige, frontiereDeValidation } from './validationExercice'

// LA FACTURE VALIDÉE, SOURCE DE SA VENTE (ligne 28.6, chantier EC-Q3, étape VF2 ; décision du cabinet du 18/10/2026 ;
// conception : HISTORIQUE.md, « LA FACTURE VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », § 5, 9, 11, 12 et 14). Un module
// PUR — il ne lit rien en base, n'appelle personne — que les écrans liront aux étapes VF5 et VF8 : ce que la VALIDATION
// d'une facture refuse de plus dans un dossier dont les factures sont la source de leurs ventes, la source qu'elle prendra,
// et ce que le réglage du dossier refuse — dit AVANT le clic, dans l'ordre de la base et sous ses mots. Les refus neufs
// des encaissements, eux, sont dans lib/encaissementsFactures.ts, à leur rang dans les listes d'hier.
//
// CE QUE LA BASE TIENT (migration `source_de_la_vente`, en base et dans l'export depuis le 18/10/2026) : le réglage
// `dossiers.ventes_par_les_factures`, faux par défaut, posé par le cabinet, irréversible dès qu'une facture source
// existe ; la source `factures_emises.source_de_la_vente`, FIXÉE à la validation par `fixer_source_de_la_vente` — le
// réglage du dossier pour une facture, la source de sa facture pour un avoir —, puis figée avec la facture ; les refus de
// la validation d'une facture source ; et les colonnes `encaissement_id` et `facture_id` des écritures, FERMÉES jusqu'à
// l'étape VF4 (`garder_ecriture_vente_facturee`).
//
// LE RÉGLAGE GARDÉ (étape VF8a ; migration `reglage_des_ventes`, PRÉPARÉE, pas appliquée ; HISTORIQUE.md, « LE RÉGLAGE DES
// VENTES, GARDÉ ») : la garde du réglage, remplacée, refuse de plus, dans son ordre, après la facture source d'hier, un
// réglage posé ou baissé par une session qui n'est pas le chef du cabinet (VF8-Q1, sur sa recommandation), puis un réglage
// baissé quand un accès client porte « Ventes » ; et elle date la bascule (`dossiers.ventes_par_les_factures_depuis`).
// `refusDuReglage` les redit, pour que l'écran de la bascule (étape VF8b) les dise avant le clic.
//
// LA RÉFÉRENCE : le texte des trois fonctions dans l'export — la dernière définition de chacune —, auquel
// sourceDeLaVente.test.ts confronte chaque liste — messages, ordre, codes et valeurs —, et l'essai
// supabase/essais/ventesFacturees.sql, qui exige de la base chaque refus, code ET mots, et que le même test confronte à ces
// listes.

// ── Les refus ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les refus de la validation d'une facture SOURCE (`fixer_source_de_la_vente`), dans son ordre ; ils remontent
 * d'`enregistrer_facture`, qui valide, après ses propres refus. « % » : une valeur. */
export const REFUS_VALIDATION_SOURCE = [
  {
    cle: 'nature_absente',
    modele: 'Dans un dossier dont les factures sont la source de leurs ventes, une facture dit si elle porte sur des biens ou sur des services : la nature de ses opérations est à renseigner avant sa validation.',
    code: '23514',
  },
  {
    cle: 'mixte',
    modele: "Dans un dossier dont les factures sont la source de leurs ventes, une facture qui mêle biens et services ne se valide pas encore : elle se scinde en deux factures, l'une de biens, l'autre de services, tant que ses lignes ne disent pas leur nature.",
    code: '23514',
  },
  { cle: 'frontiere', modele: "% : une facture source de sa vente, ou son avoir, ne s'y valide plus.", code: '23514' },
] as const

export type CleRefusValidationSource = (typeof REFUS_VALIDATION_SOURCE)[number]['cle']

/** Les autres refus, dans l'ordre du texte de leurs fonctions : les trois du réglage — celui d'hier (migration
 * `source_de_la_vente`), puis les deux de l'étape VF8a (migration `reglage_des_ventes`) —, qu'un écran dira avant le clic
 * (étape VF8b), puis ceux qu'on ne rencontre qu'en écrivant hors des fonctions — une restauration dans un dossier qui n'a
 * pas basculé, la source posée à la main, une écriture qui porterait une facture ou un encaissement. */
export const REFUS_SOURCE_DE_LA_VENTE = [
  {
    cle: 'reglage_irreversible',
    modele: 'Les factures de ce dossier sont la source de leurs ventes depuis la facture % : ce réglage ne se défait pas.',
    code: '23514',
  },
  { cle: 'reglage_reserve_au_chef', modele: "Seul le chef du cabinet change la source des ventes d'un dossier.", code: '42501' },
  {
    cle: 'reglage_retenu_par_ventes',
    modele: "Un accès client de ce dossier porte le droit « Ventes », qui suppose que ses factures soient la source de leurs ventes : retirer d'abord ce droit.",
    code: '23514',
  },
  {
    cle: 'restauration_hors_bascule',
    modele: "Une facture n'est la source de sa vente que dans un dossier dont les factures sont la source de leurs ventes.",
    code: '23514',
  },
  { cle: 'source_posee', modele: 'La source de la vente se fixe à la validation de la facture : elle ne se pose pas.', code: '42501' },
  {
    cle: 'ecriture_hors_fonction',
    modele: 'Une écriture ne porte une facture ou un encaissement que par la fonction qui écrit la vente facturée.',
    code: '42501',
  },
] as const

export type CleRefusSourceDeLaVente = (typeof REFUS_SOURCE_DE_LA_VENTE)[number]['cle']

type Liste = readonly { readonly cle: string; readonly modele: string }[]

function refusDe<C extends string>(liste: Liste, cle: C, ...valeurs: string[]): RefusEncaissement<C> {
  const { modele } = liste.find((r) => r.cle === cle) as Liste[number]
  return { cle, message: remplirModele(modele, valeurs) }
}

// ── La source, à la validation ────────────────────────────────────────────────────────────────────────────────────────

/** Une facture telle que sa validation la lit : sa nature, sa date, et, pour un avoir, la facture qu'il corrige. */
export type FacturePourSource = Pick<FactureEmise, 'type' | 'nature_operation' | 'date_emission' | 'facture_origine_id'>

/**
 * La source qu'une facture prendra à sa validation : le réglage de son dossier — pour un avoir, la source de la facture
 * qu'il corrige, quel que soit le réglage (un avoir d'une facture d'avant la bascule n'est pas source). `origine` : la
 * facture corrigée, que l'appelant a lue ; absente, un avoir n'est pas source, comme la base qui ne la trouverait pas.
 */
export function sourceALaValidation(
  facture: Pick<FacturePourSource, 'type'>,
  ventesParLesFactures: boolean,
  origine: Pick<FactureEmise, 'source_de_la_vente'> | null,
): boolean {
  if (facture.type === 'avoir') return origine?.source_de_la_vente === true
  return ventesParLesFactures
}

/**
 * Ce que la validation d'une facture refuserait DE PLUS parce qu'elle est source de sa vente (`source` : ce que dit
 * `sourceALaValidation`), dans l'ordre de la base : la nature de ses opérations absente, une facture mixte (EC3-Q8 :
 * elle se scinde en deux tant que ses lignes ne disent pas leur nature), une date que la frontière d'un exercice validé
 * fige. Null : rien de plus — une facture qui n'est pas source se valide comme hier. Un avoir porte la nature de sa
 * facture, recopiée par `enregistrer_facture` : seule la frontière peut le refuser.
 */
export function refusValidationSource(
  facture: Pick<FacturePourSource, 'nature_operation' | 'date_emission'>,
  source: boolean,
  anneesValidees: readonly number[],
): RefusEncaissement<CleRefusValidationSource> | null {
  if (!source) return null
  if (facture.nature_operation == null) return refusDe(REFUS_VALIDATION_SOURCE, 'nature_absente')
  if (facture.nature_operation === 'mixte') return refusDe(REFUS_VALIDATION_SOURCE, 'mixte')
  const frontiere = frontiereDeValidation(anneesValidees)
  if (frontiere != null && facture.date_emission <= frontiere) {
    // Au plus tard à la frontière, l'exercice est validé ou figé par un exercice validé qui le suit : jamais nul ici.
    return refusDe(REFUS_VALIDATION_SOURCE, 'frontiere', exerciceQuiFige(anneeDe(facture.date_emission), anneesValidees) as string)
  }
  return null
}

// ── Le réglage du dossier ─────────────────────────────────────────────────────────────────────────────────────────────

/** Une facture du dossier telle que la garde du réglage la lit. */
export type FacturePourReglage = Pick<FactureEmise, 'id' | 'numero' | 'type' | 'validated_at' | 'source_de_la_vente'>

// Un texte comparé comme la base le compare sous `collate "C"`, ou comme elle compare un identifiant ou un instant écrit
// en ISO dans un même fuseau : octet par octet, jamais `localeCompare` ; un nul se range en dernier (`nulls last`, le
// défaut d'un ordre croissant).
function ordreC(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a < b ? -1 : 1
}

/** Ce que la garde du réglage lit, en plus des factures : qui écrit, et les accès clients du dossier (étape VF8a). */
export interface ContexteDuReglage {
  /**
   * La session est-elle celle du chef du cabinet du dossier, ou du super-administrateur (`est_chef_du_cabinet`) ? LA
   * CONDITION QUI PORTE VF8-Q1, écrite sur sa recommandation : sous « tout membre assigné au dossier », l'appelant y
   * passerait ce que dit `admin_du_dossier`, et ce nom changerait avec elle. Un écran parle toujours depuis une session : le
   * propriétaire et le rôle des Edge Functions, que la garde ne juge pas sur ce point, n'ont pas de place ici.
   */
  chefDuCabinet: boolean
  /** Les accès clients du dossier, lus EN ENTIER : un seul qui porte « Ventes » retient la baisse du réglage. */
  acces: readonly Pick<Membership, 'droit_ventes'>[]
}

/**
 * Ce que la garde du réglage (`garder_ventes_par_les_factures`) refuserait d'un réglage qui change, dans son ordre — du plus
 * définitif au plus réparable :
 *   1. le baisser quand une facture source existe déjà dans le dossier (EC3-Q1, irréversible) — pour tout auteur ;
 *   2. le poser ou le baisser sans être le chef du cabinet (VF8-Q1) ;
 *   3. le baisser quand un accès client du dossier porte « Ventes » (sinon la case survivrait à son dossier).
 * `factures` : celles du dossier, lues EN ENTIER. La facture nommée est la première source validée — par l'instant de sa
 * validation, une facture avant son avoir qu'une même transaction validerait au même instant, puis par son numéro, octet
 * par octet —, comme la base la nomme. La base départage encore par l'identifiant ; le message n'en dit rien, un numéro
 * étant unique dans son dossier (`factures_emises_numero_dossier_idx`). Un réglage qui ne change pas ne se juge pas ;
 * le chef le pose, et le baisse avant toute facture source quand aucun accès ne porte « Ventes ».
 */
export function refusDuReglage(
  avant: boolean,
  apres: boolean,
  factures: readonly FacturePourReglage[],
  contexte: ContexteDuReglage,
): RefusEncaissement<CleRefusSourceDeLaVente> | null {
  if (avant === apres) return null
  if (avant) {
    const premiere = factures.filter((f) => f.source_de_la_vente).sort((a, b) =>
      ordreC(a.validated_at, b.validated_at)
      || Number(a.type === 'avoir') - Number(b.type === 'avoir')
      || ordreC(a.numero, b.numero))[0]
    // Une facture validée porte toujours son numéro (`factures_emises_figees`) ; un `%` nul, `raise` l'écrirait `<NULL>`.
    if (premiere) return refusDe(REFUS_SOURCE_DE_LA_VENTE, 'reglage_irreversible', premiere.numero ?? '<NULL>')
  }
  if (!contexte.chefDuCabinet) return refusDe(REFUS_SOURCE_DE_LA_VENTE, 'reglage_reserve_au_chef')
  if (avant && contexte.acces.some((a) => a.droit_ventes)) return refusDe(REFUS_SOURCE_DE_LA_VENTE, 'reglage_retenu_par_ventes')
  return null
}
