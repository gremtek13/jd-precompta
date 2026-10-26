import { ANNEES_ILLISIBLES, FRONTIERE_JUGEE_PAR_LA_BASE, remplirModele, type RefusEncaissement } from './encaissementsFactures'
import { pourLEspace, type EspaceVentes } from './espaceVentes'
import { anneeDe } from './format'
import type { FactureEmise, Membership, ModeComptable } from './types'
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
// LE RÉGLAGE GARDÉ (étape VF8a ; migration `reglage_des_ventes`, appliquée le 26/10/2026 ; HISTORIQUE.md, « LE RÉGLAGE DES
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

// ── La facture d'un dossier basculé, à l'écran (étape VF8c) ──────────────────────────────────────────────────────────
// HISTORIQUE.md, « VF8, LA BASCULE : LA CONCEPTION », § 3 (c), et « LA FACTURE D'UN DOSSIER BASCULÉ, À L'ÉCRAN ». Le
// formulaire d'une facture et celui d'un avoir, dans les deux espaces, disent AVANT le clic ce que la validation d'une facture
// source refuserait — par `refusValidationSource` elle-même, sur la saisie telle qu'elle part, jamais par une règle recopiée —,
// ce qu'ils ne peuvent pas juger (la frontière, chez le client, qui ne lit pas les exercices validés), et la phrase de la
// confirmation. Un dossier qui n'a pas basculé n'y gagne rien : aucun refus, aucun avis, aucune confirmation de plus.

/**
 * Le réglage du dossier tel que l'écran d'une facture l'a lu, avec ce que sa validation consulte : le modèle comptable (la
 * phrase de la confirmation) et les exercices validés (la frontière) — `ANNEES_ILLISIBLES` chez le client, qui ne les lit
 * pas. Illisible, aucune validation ne s'offre : une facture source se validerait sans que ses refus se disent avant.
 */
export type ReglageDesVentes =
  | { etat: 'non_bascule'; anneesValidees: readonly number[] | typeof ANNEES_ILLISIBLES }
  | { etat: 'bascule'; modeComptable: ModeComptable; anneesValidees: readonly number[] | typeof ANNEES_ILLISIBLES }
  | { etat: 'illisible'; motif: string }

const MODES: readonly unknown[] = ['tresorerie', 'engagement'] satisfies readonly ModeComptable[]

/**
 * Le réglage, tiré de la ligne du dossier que l'écran a lue (`null` : rien n'a été lu) et de ses exercices validés (`null` :
 * pas encore lus). UNE COLONNE ABSENTE N'EST PAS NULLE : un réglage qui n'est pas un booléen est illisible, jamais « pas
 * basculé ». Un dossier qui n'a pas basculé n'exige rien d'autre — son formulaire reste celui d'hier ; basculé, son modèle
 * comptable et ses exercices validés doivent avoir été lus.
 */
export function reglageDesVentes(
  dossier: { readonly ventes_par_les_factures?: unknown; readonly mode_comptable?: unknown } | null,
  anneesValidees: readonly number[] | typeof ANNEES_ILLISIBLES | null,
): ReglageDesVentes {
  if (dossier == null) return { etat: 'illisible', motif: 'rien n’en a été lu' }
  const reglage = dossier.ventes_par_les_factures
  if (typeof reglage !== 'boolean') return { etat: 'illisible', motif: 'le réglage n’est pas lisible' }
  if (!reglage) return { etat: 'non_bascule', anneesValidees: anneesValidees ?? ANNEES_ILLISIBLES }
  if (!MODES.includes(dossier.mode_comptable)) return { etat: 'illisible', motif: 'le modèle comptable n’est pas lisible' }
  if (anneesValidees == null) return { etat: 'illisible', motif: 'les exercices validés n’ont pas été lus' }
  return { etat: 'bascule', modeComptable: dossier.mode_comptable as ModeComptable, anneesValidees }
}

/** Ce que l'écran dit de la validation d'une facture ou d'un avoir, au-delà de ses refus d'hier. */
export interface JugementDeLaValidation {
  /** La source que la validation fixera ; nul quand le réglage est illisible. */
  source: boolean | null
  /** Ce qui retient la validation avant le clic, sous les mots de l'espace ; nul : rien de plus qu'hier. */
  refus: string | null
  /** Ce que l'écran dit sans rien retenir. */
  avis: string | null
  /** La phrase de la confirmation de la validation ; nulle : la source n'en ajoute pas. */
  confirmation: string | null
}

const RIEN_DE_PLUS: JugementDeLaValidation = { source: false, refus: null, avis: null, confirmation: null }

/** Le réglage illisible : la validation ne s'offre pas, et l'écran dit pourquoi. */
export function phraseDuReglageIllisible(espace: EspaceVentes, motif: string): string {
  return espace === 'client'
    ? `La source de tes ventes ne se lit pas (${motif}) : la validation ne t’est pas offerte, ses refus ne se diraient pas `
      + 'avant le clic. Recharge la page pour la relire.'
    : `La source des ventes de ce dossier ne se lit pas (${motif}) : la validation n’est pas offerte, ses refus ne se diraient `
      + 'pas avant le clic. Rouvrez le dossier pour la relire.'
}

/**
 * La ligne de « Mes ventes » pour un client dont les factures sont la source de ses ventes (chantier EC-Q3, étape VF8d ;
 * HISTORIQUE.md, « VF8, LA BASCULE : LA CONCEPTION », § 3 (d)) : dite une fois, au-dessus de ses factures, dans les mots du
 * client (tutoiement, aucun onglet : sourceDeLaVente.test.ts la passe au garde des mots). Un dossier qui n'a pas basculé, ou
 * dont le réglage ne se lit pas, n'en a pas : l'écran d'une facture dit déjà, lui, le réglage illisible.
 */
export const SOURCE_DE_TES_VENTES = 'Tes factures validées sont la source de tes ventes dans ta comptabilité : une fois '
  + 'validée, une facture ne se corrige plus que par un avoir.'

/** Ce que l'écran du CABINET dit quand les exercices validés ne lui sont pas parvenus (le patron du client, vouvoyé). */
export const FRONTIERE_NON_LUE_AU_CABINET = 'Les exercices validés du dossier ne sont pas lus ici : une date que l’un d’eux '
  + 'fige ne se dit donc pas avant l’envoi — la base la refusera, et son refus se dira ici.'

/**
 * L'avoir d'une facture validée avant la bascule (une facture qui n'est pas source) : il ne l'est pas non plus
 * (`sourceALaValidation`), et se compte comme elle, par sa pièce. Rien ne le refuse ; l'écran le dit.
 */
export function phraseDeLAvoirDAvant(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Cette facture a été validée avant que tes factures soient la source de tes ventes : son avoir ne l’est pas non plus, '
      + 'et se compte comme elle, par sa pièce.'
    : 'Cette facture a été validée avant que les factures du dossier soient la source de leurs ventes : son avoir ne l’est pas '
      + 'non plus, et se compte comme elle, par sa pièce.'
}

/**
 * La phrase de la confirmation de la validation d'une facture SOURCE : elle comptera dans la comptabilité à ses
 * encaissements (en trésorerie) ou à sa date (en engagement), sans reprise par le cabinet ; un avoir source réduit la vente
 * de sa facture. Le geste reste celui d'hier : une facture validée ne se corrige plus que par un avoir.
 */
export function confirmationDeLaSource(espace: EspaceVentes, type: FactureEmise['type'], mode: ModeComptable | null): string {
  if (type === 'avoir') {
    return espace === 'client'
      ? 'Cet avoir corrige une facture source de ta vente : validé, il réduira cette vente dans ta comptabilité, sans que ton '
        + 'cabinet le reprenne.'
      : 'Cet avoir corrige une facture source de sa vente : validé, il réduira cette vente dans la comptabilité du dossier, '
        + 'sans reprise par le cabinet.'
  }
  const quand = mode === 'engagement' ? 'à sa date' : 'à ses encaissements'
  return espace === 'client'
    ? `Tes factures sont la source de tes ventes : validée, celle-ci comptera dans ta comptabilité ${quand}, sans que ton `
      + 'cabinet la reprenne. Une facture validée ne se corrige plus que par un avoir.'
    : `Les factures de ce dossier sont la source de leurs ventes : validée, celle-ci comptera dans sa comptabilité ${quand}, `
      + 'sans reprise par le cabinet. Une facture validée ne se corrige plus que par un avoir.'
}

/**
 * Ce que la validation d'une facture ou d'un avoir, TELS QU'ILS PARTENT, rencontre de plus dans un dossier basculé :
 *   - le réglage illisible : la validation ne s'offre pas ;
 *   - la source qu'elle fixera (`sourceALaValidation` : le réglage pour une facture, la source de sa facture pour un avoir) ;
 *   - source, les refus de `refusValidationSource` — la nature absente, la facture mixte (« des biens et des services » reste
 *     offert et se dit refusé : EC3-Q8, jusqu'à A7), la frontière d'un exercice validé — sous les mots de l'espace ; chez le
 *     client, qui ne lit pas les exercices validés, la frontière ne se juge pas ici : la base la juge, et l'écran le dit ;
 *   - source, la phrase de la confirmation ; l'avoir d'une facture d'avant la bascule, un avis.
 * Un dossier qui n'a pas basculé n'a rien de plus — sauf l'avoir d'une facture source, que seul un dossier basculé porte.
 */
export function jugementDeLaValidation(
  espace: EspaceVentes,
  facture: Pick<FacturePourSource, 'type' | 'nature_operation' | 'date_emission'>,
  reglage: ReglageDesVentes,
  origine: Pick<FactureEmise, 'source_de_la_vente'> | null,
): JugementDeLaValidation {
  if (reglage.etat === 'illisible') {
    return { source: null, refus: phraseDuReglageIllisible(espace, reglage.motif), avis: null, confirmation: null }
  }
  const bascule = reglage.etat === 'bascule'
  if (!sourceALaValidation(facture, bascule, origine)) {
    return facture.type === 'avoir' && bascule ? { ...RIEN_DE_PLUS, avis: phraseDeLAvoirDAvant(espace) } : RIEN_DE_PLUS
  }
  const illisibles = reglage.anneesValidees === ANNEES_ILLISIBLES
  // Les exercices illisibles : la frontière ne se juge pas ici (aucune année), la nature et la facture mixte, si.
  const refus = refusValidationSource(facture, true, reglage.anneesValidees === ANNEES_ILLISIBLES ? [] : reglage.anneesValidees)
  return {
    source: true,
    refus: refus == null ? null : pourLEspace(espace, refus.message),
    avis: illisibles ? (espace === 'client' ? FRONTIERE_JUGEE_PAR_LA_BASE : FRONTIERE_NON_LUE_AU_CABINET) : null,
    confirmation: confirmationDeLaSource(espace, facture.type, bascule ? reglage.modeComptable : null),
  }
}
