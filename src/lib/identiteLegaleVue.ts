// CE QUE DIT LA CARTE « IDENTITÉ DU DOSSIER » DE L'ONGLET INFORMATIONS (espace client, étape A5b2 ; ligne 51.5). PUR : il
// n'importe jamais `supabase.ts`.
//
// Le cabinet écrit ici, en UNE écriture, le SIRET et l'adresse (déjà là) et les quatre colonnes d'identité légale que la
// migration `parametres_facturation` a posées sur `dossiers` : la dénomination imprimée, la ville du greffe, la forme
// juridique de l'INSEE et le capital. Aucune fonction ne les juge, ce sont les CONTRAINTES de la table qui refusent (23514,
// sous leur nom) : ce module redit chacune avant le clic par `refusIdentiteLegale`, ses mots ne se recopient nulle part
// ici — il les REND. Ce qu'il ajoute n'est que de l'écran : lire la ligne du dossier en saisie, lire le capital tel qu'on
// le tape, proposer la dénomination d'un entrepreneur individuel, dire le refus de la base.
//
// UNE COLONNE ABSENTE N'EST PAS UNE COLONNE NULLE. Une ligne lue sans les quatre colonnes (`undefined`) ne dit pas que le
// dossier n'a ni dénomination ni capital : l'écran ne les offre pas, et l'écriture ne porte alors que le SIRET et l'adresse
// — jamais nul sur une valeur qu'on ignore (CLAUDE.md : « Lecture → formulaire → écriture de tous les champs »).
import { sansBlancsAuxBords } from './articles'
import { CATEGORIES_JURIDIQUES, CATEGORIE_ENTREPRENEUR_INDIVIDUEL, categorieJuridique } from './categoriesJuridiques'
import { formatMoney } from './format'
import { messageErreur } from './messageErreur'
import {
  REFUS_IDENTITE_LEGALE, denominationProposee, refusIdentiteLegale, type CleRefusIdentiteLegale,
} from './parametresFacturation'
import type { Dossier } from './types'
import { MENTIONS_FIGEES_EXPORTEES } from './mentionsFigees'

/** Les six colonnes que l'écran écrit d'un seul tenant, et que la base rend. */
export type IdentiteRendue = Pick<Dossier, 'siret' | 'adresse' | 'denomination_imprimee' | 'rcs_ville' | 'forme_juridique' | 'capital'>

/** Les quatre colonnes d'identité légale (le SIRET et l'adresse sont plus anciens : ils ont toujours été lus). */
export const COLONNES_IDENTITE_LEGALE = ['denomination_imprimee', 'rcs_ville', 'forme_juridique', 'capital'] as const
const COLONNES_ANCIENNES = ['siret', 'adresse'] as const

/** La ligne du dossier telle que l'écran la reçoit : chaque colonne d'identité légale peut être ABSENTE (`undefined`). */
export interface IdentiteLue {
  siret: string | null
  adresse: string | null
  denomination_imprimee: string | null | undefined
  rcs_ville: string | null | undefined
  forme_juridique: string | null | undefined
  capital: number | null | undefined
}

/**
 * Les quatre colonnes ont-elles été LUES ? Toutes ou aucune : une lecture qui n'en porterait que quelques-unes n'est pas
 * une lecture que l'écran comprend, et il n'écrit pas ce qu'il n'a pas lu.
 */
export function identiteLegaleLue(l: IdentiteLue): boolean {
  return COLONNES_IDENTITE_LEGALE.every((c) => l[c] !== undefined)
}

/** Les colonnes que l'écriture porte, et que la base doit rendre (`select`). */
export function colonnesEcrites(identiteLue: boolean): string {
  return [...COLONNES_ANCIENNES, ...(identiteLue ? COLONNES_IDENTITE_LEGALE : [])].join(', ')
}

// ── La saisie ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que le formulaire tient : des textes, comme les champs. */
export interface SaisieIdentite {
  siret: string
  adresse: string
  denomination: string
  rcsVille: string
  /** Le code de l'INSEE choisi, ou « » (non renseignée). */
  forme: string
  /** Le capital tel qu'on le tape. */
  capital: string
}

/**
 * Le capital écrit pour un champ de saisie, au centime : « 150000,00 », sans séparateur de milliers qu'on retaperait.
 * `toFixed(2)` est exact ici : la base n'admet que des valeurs au centime sous dix mille milliards, soit quinze chiffres
 * significatifs au plus, que le nombre à double précision porte sans perte — l'aller-retour par `lireCapital` rend la
 * même valeur (le test l'éprouve à ses bords).
 */
export function capitalPourSaisie(capital: number | null | undefined): string {
  return capital == null ? '' : capital.toFixed(2).replace('.', ',')
}

/** La saisie de départ d'une ligne lue : une colonne nulle ou absente est un champ vide. */
export function saisieDepuisLaLigne(l: IdentiteLue): SaisieIdentite {
  return {
    siret: l.siret ?? '',
    adresse: l.adresse ?? '',
    denomination: l.denomination_imprimee ?? '',
    rcsVille: l.rcs_ville ?? '',
    forme: l.forme_juridique ?? '',
    capital: capitalPourSaisie(l.capital),
  }
}

// Le capital tapé : des chiffres, la virgule ou le point, UNE fois, et deux décimales au plus TELLES QUE TAPÉES. Un nombre
// qu'on lirait en le changeant — « 12,345 », « 0,10000000000000000001 » — n'est pas lu : arrondir sans le dire est ce que
// l'écran s'interdit. Les espaces et « € » s'ignorent, comme `formatMoney` les écrit : `\s` couvre l'espace ordinaire, l'insécable (U+00A0), la fine (U+2009) et la fine insécable (U+202F).
// Avec treize chiffres entiers au plus et deux décimales, le nombre rendu est exact ; au-delà de la borne il n'a plus à
// l'être, la contrainte le refuse sous ses mots.
const A_IGNORER = /[\s€]/g
const FORME_DU_CAPITAL = /^\d+(?:[.,]\d{1,2})?$/

/** Le capital tapé : un nombre, `null` quand le champ est vide, `'illisible'` quand ce n'est pas un montant qu'on lit sans le changer. */
export function lireCapital(texte: string): number | null | 'illisible' {
  const net = texte.replace(A_IGNORER, '')
  if (net === '') return null
  if (!FORME_DU_CAPITAL.test(net)) return 'illisible'
  return Number(net.replace(',', '.'))
}

export const CAPITAL_ILLISIBLE =
  'Le capital n’est pas un montant que l’écran sait lire sans le changer : des chiffres, la virgule ou le point, deux décimales au plus (par exemple 150 000,00).'

const texteOuNul = (t: string): string | null => {
  const net = sansBlancsAuxBords(t)
  return net === '' ? null : net
}

/** Un entrepreneur individuel (la forme `1000`) n'a pas de capital social. */
export const estEntrepreneurIndividuel = (forme: string) => forme === CATEGORIE_ENTREPRENEUR_INDIVIDUEL

/**
 * L'identité TELLE QU'ELLE PART : blancs des bords retirés, un champ vide vaut nul. Le capital d'un entrepreneur individuel
 * est REMIS À NUL dans la même écriture (« un champ devenu sans objet est remis à zéro ») et n'est même pas lu : un champ
 * caché qui porterait une saisie ratée ne doit pas retenir un enregistrement qui ne l'écrira pas. `capitalIllisible` dit
 * qu'un capital tapé n'a pas pu être lu : l'identité porte alors un capital nul, et le refus précède tout envoi.
 */
export function identiteQuiPart(s: SaisieIdentite): { identite: IdentiteRendue; capitalIllisible: boolean } {
  const ei = estEntrepreneurIndividuel(s.forme)
  const capital = ei ? null : lireCapital(s.capital)
  return {
    identite: {
      siret: texteOuNul(s.siret),
      adresse: texteOuNul(s.adresse),
      denomination_imprimee: texteOuNul(s.denomination),
      rcs_ville: texteOuNul(s.rcsVille),
      forme_juridique: texteOuNul(s.forme),
      capital: capital === 'illisible' ? null : capital,
    },
    capitalIllisible: capital === 'illisible',
  }
}

/**
 * La ligne que la base a RENDUE après l'écriture, relue comme une ligne du dossier : le formulaire repart de ce que la base
 * a gardé (blancs des bords retirés, capital au centime), pas de ce qui a été tapé. Les quatre colonnes ne reviennent que si
 * elles ont été écrites.
 */
export function identiteDepuisLaReponse(rendue: Partial<IdentiteRendue>, identiteLue: boolean): IdentiteLue {
  return {
    siret: rendue.siret ?? null,
    adresse: rendue.adresse ?? null,
    denomination_imprimee: identiteLue ? rendue.denomination_imprimee ?? null : undefined,
    rcs_ville: identiteLue ? rendue.rcs_ville ?? null : undefined,
    forme_juridique: identiteLue ? rendue.forme_juridique ?? null : undefined,
    capital: identiteLue ? rendue.capital ?? null : undefined,
  }
}

/** Ce que `update` reçoit : les deux colonnes anciennes, et les quatre seulement si elles ont été lues. */
export function ecritureQuiPart(s: SaisieIdentite, identiteLue: boolean): Partial<IdentiteRendue> {
  const { identite } = identiteQuiPart(s)
  const ecrit: Partial<IdentiteRendue> = { siret: identite.siret, adresse: identite.adresse }
  if (identiteLue) {
    ecrit.denomination_imprimee = identite.denomination_imprimee
    ecrit.rcs_ville = identite.rcs_ville
    ecrit.forme_juridique = identite.forme_juridique
    ecrit.capital = identite.capital
  }
  return ecrit
}

export interface RefusDeLIdentite {
  cle: CleRefusIdentiteLegale | 'capital_illisible'
  /** La contrainte de la base qui dirait ce refus ; nulle pour un capital que l'écran ne sait pas lire (rien n'est envoyé). */
  contrainte: string | null
  message: string
}

/**
 * Ce que l'enregistrement refuserait, dit avant le clic : le capital illisible d'abord (il ne partirait pas), puis le
 * premier refus du module sur l'identité telle qu'elle part. Rien à juger quand les quatre colonnes n'ont pas été lues :
 * le SIRET et l'adresse n'ont pas de refus ici, comme avant.
 */
export function refusDeLIdentite(s: SaisieIdentite, identiteLue: boolean): RefusDeLIdentite | null {
  if (!identiteLue) return null
  const { identite, capitalIllisible } = identiteQuiPart(s)
  if (capitalIllisible) return { cle: 'capital_illisible', contrainte: null, message: CAPITAL_ILLISIBLE }
  return refusIdentiteLegale({
    denomination_imprimee: identite.denomination_imprimee ?? null,
    rcs_ville: identite.rcs_ville ?? null,
    forme_juridique: identite.forme_juridique ?? null,
    capital: identite.capital ?? null,
  })
}

// ── La forme juridique ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ChoixDeForme {
  /** Le code, ou « » pour « Non renseignée ». */
  valeur: string
  libelle: string
}

export const FORME_NON_RENSEIGNEE = 'Non renseignée'

/**
 * Les choix du `<select>` : « Non renseignée », puis les catégories de l'INSEE dans l'ordre de la nomenclature, chacune sous
 * son code et son libellé. Un code courant que la nomenclature ne connaît pas se DIT tel quel, en tête : le remplacer en
 * silence par « Non renseignée » ferait écrire autre chose que ce qui est lu.
 */
export function choixDeForme(courante: string): ChoixDeForme[] {
  const choix: ChoixDeForme[] = [{ valeur: '', libelle: FORME_NON_RENSEIGNEE }]
  if (courante !== '' && categorieJuridique(courante) === null) {
    choix.push({ valeur: courante, libelle: `${courante} — code que la nomenclature de l’INSEE ne connaît pas` })
  }
  for (const c of CATEGORIES_JURIDIQUES) choix.push({ valeur: c.code, libelle: `${c.code} — ${c.libelle}` })
  return choix
}

// ── L'entrepreneur individuel ──────────────────────────────────────────────────────────────────────────────────────

// Les mots de l'article : la dénomination INCORPORE le nom, précédé ou suivi IMMÉDIATEMENT de la mention.
export const RAISON_DENOMINATION_EI =
  'La dénomination d’un entrepreneur individuel incorpore son nom, précédé ou suivi immédiatement des initiales « EI » ou des mots « entrepreneur individuel » (C. com., art. R526-27).'

/**
 * La dénomination que l'écran PROPOSE à un entrepreneur individuel, avec sa raison — jamais d'elle-même : un bouton la
 * reprend. Rien tant que la forme n'est pas connue (choisie parmi les catégories) ni quand elle est déjà celle de la saisie.
 */
export function propositionDeDenomination(nom: string, s: SaisieIdentite): { texte: string; raison: string } | null {
  const texte = denominationProposee(nom, s.forme === '' ? null : s.forme)
  if (texte === null || texte === sansBlancsAuxBords(s.denomination)) return null
  return { texte, raison: RAISON_DENOMINATION_EI }
}

/**
 * Le capital d'un entrepreneur individuel est remis à nul, et la carte le dit avant le clic : le capital ENREGISTRÉ
 * (`capitalLu`) sera effacé, un capital seulement TAPÉ ne sera pas écrit. Rien à dire d'une autre forme, ni quand aucun
 * capital n'est lu ni saisi.
 */
export function phraseDuCapitalRemisANul(s: SaisieIdentite, capitalLu: number | null | undefined): string | null {
  if (!estEntrepreneurIndividuel(s.forme)) return null
  if (capitalLu != null) {
    return `Un entrepreneur individuel n’a pas de capital social : le capital enregistré (${formatMoney(capitalLu)}) sera effacé à l’enregistrement.`
  }
  if (sansBlancsAuxBords(s.capital) !== '') {
    return 'Un entrepreneur individuel n’a pas de capital social : le capital saisi ne sera pas enregistré.'
  }
  return null
}

// ── Ce que la carte dit ────────────────────────────────────────────────────────────────────────────────────────────

// La phrase de la carte qui la précède dit déjà que le SIRET et l'adresse sont repris sur chaque nouvelle facture : celle-ci
// ne parle que des quatre champs d'identité légale. Depuis l'étape A7b (`MENTIONS_FIGEES_EXPORTEES`), une facture les fige à
// sa validation et les imprime ; un accès « Ventes » ne valide pas sans forme ni dénomination (A7-Q1, A7Q-Q1), et un IBAN dans
// l'un d'eux retient toute validation (A7-Q3). Drapeau baissé, la phrase d'avant.
export const PHRASE_IDENTITE_LEGALE =
  'Aucune facture ne lit ni n’imprime encore la dénomination, la ville du greffe, la forme juridique ni le capital : elles le feront avec une étape à venir.'
export const PHRASE_IDENTITE_LEGALE_FIGEE =
  'Une facture fige à sa validation la dénomination, la ville du greffe, la forme juridique et le capital, et les imprime ; une '
  + 'facture déjà validée ne change plus. Sans forme juridique, ou sans dénomination, un accès « Ventes » ne valide pas de '
  + 'facture ; un IBAN dans la dénomination ou la ville du greffe retiendrait toute validation.'

/** La phrase des quatre champs, selon que les factures figent leurs mentions. */
export function phraseIdentiteLegale(figees: boolean = MENTIONS_FIGEES_EXPORTEES): string {
  return figees ? PHRASE_IDENTITE_LEGALE_FIGEE : PHRASE_IDENTITE_LEGALE
}

export const PHRASE_IDENTITE_LEGALE_NON_LUE =
  'La dénomination imprimée, la ville du greffe, la forme juridique et le capital n’ont pas été lus avec ce dossier : ils ne sont pas offerts, car les écrire sans les connaître pourrait effacer ce que le dossier porte. Le SIRET et l’adresse s’enregistrent comme d’habitude ; recharge la page pour les retrouver.'

export const IDENTITE_NON_ENREGISTREE =
  'Rien n’a été enregistré : la base n’a modifié aucune ligne du dossier (ton accès ne le permet peut-être pas). Recharge la page, puis réessaie.'

/**
 * Le refus de la base dit sous les mots du module : une violation de contrainte (23514) qui nomme l'une des cinq de
 * `REFUS_IDENTITE_LEGALE` rend le message du module pour celle-là ; toute autre erreur passe par `messageErreur`.
 */
export function refusDeLaBase(erreur: unknown, repli: string): string {
  const message = messageErreur(erreur, '')
  const code = typeof erreur === 'object' && erreur !== null ? (erreur as { code?: unknown }).code : undefined
  if (code === '23514') {
    const refus = REFUS_IDENTITE_LEGALE.find((r) => message.includes(`"${r.contrainte}"`))
    if (refus) return refus.message
  }
  return messageErreur(erreur, repli)
}
