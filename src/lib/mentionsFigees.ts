import { NATURES_ARTICLE, REFERENCE_MAX, UNITES_ARTICLE, sansBlancsAuxBords } from './articles'
import { CATEGORIE_ENTREPRENEUR_INDIVIDUEL } from './categoriesJuridiques'
import { commeLaBaseLaRecoit } from './contacts'
import { remplirModele } from './encaissementsFactures'
import { numeroTvaImprime } from './factureCii'
import { ribEnVigueur, versionCourante, type VersionDuRib } from './parametresFacturation'
import type { ArticleExoneration, Dossier, FactureEmise, ParametresFacturation, StatutTva } from './types'

// LA FACTURE FIGE SES MENTIONS (espace client, étape A7a, ligne 51.5 ; migration `mentions_figees` ; HISTORIQUE.md,
// « LA FACTURE FIGE SES MENTIONS, EN BASE »). Un module PUR — il ne lit rien en base, n'appelle personne, ne lit pas
// l'horloge — qui redit `enregistrer_facture` telle que la migration la recrée :
//   - ses REFUS NEUFS, dans son ordre et sous ses mots, avant le clic : la provenance des lignes (l'unité, la référence, la
//     nature, ligne par ligne), le contact d'où vient le client, l'article d'où vient chaque ligne (`refusDeLaProvenance`) ;
//     à la validation, le contact que garde le brouillon, la forme juridique pour un accès « Ventes » et la dénomination
//     d'un entrepreneur individuel (`refusDeLaValidationFigee`, `porteLaMentionEI`). Les refus d'hier passent d'abord, sous
//     leurs propres modules
//     (`refusAvoir`, lib/factures.ts ; lib/sourceDeLaVente.ts) ;
//   - CE QUE LA VALIDATION FIGE (`mentionsAFiger`) : le statut et le numéro de TVA (`numeroTvaImprime`, le calcul que la
//     base refait dans `numero_tva_du_vendeur`), l'identité légale, les paramètres de la version courante, le RIB CONFIRMÉ
//     en vigueur (`ribEnVigueur`) — jamais un RIB seulement proposé —, le logo, le mandataire. L'étape A7b le lira pour
//     dire, avant le clic, ce que la facture imprimera.
// src/lib/mentionsFigees.test.ts confronte chaque refus au texte de la fonction dans l'export et à l'essai
// supabase/essais/mentionsFigees.sql, le numéro de TVA et la mention de l'entrepreneur individuel aux cas de l'essai.

// LA MIGRATION N'EST PAS ENCORE EN BASE. Elle est PRÉPARÉE et se COLLE (le corps d'`enregistrer_facture` supprime les
// lignes qu'il remplace) ; d'ici là, la fonction en production ignore les clés neuves que l'écran enverrait, et aucune
// colonne figée ne se lit. Tant que ce drapeau est faux, aucun écran n'envoie ni ne lit rien de neuf (l'étape A7b s'y
// range). La session le lèvera elle-même, la migration collée. Chaque fonction de ce module se juge sans lui.
export const MENTIONS_FIGEES_EXPORTEES: boolean = false

// ── Les listes de la base, celles des articles (supabase/schema, migration `articles`) ──────────────────────────────
// Une ligne de facture prend l'unité, la référence et la nature d'un article : leurs formes sont les siennes, et le test le
// vérifie dans les deux migrations.
export const UNITES_DE_LIGNE: readonly string[] = UNITES_ARTICLE.map((u) => u.code)
export const NATURES_DE_LIGNE: readonly string[] = NATURES_ARTICLE
export const REFERENCE_DE_LIGNE_MAX = REFERENCE_MAX

// ── Les refus neufs, dans l'ordre du texte de la fonction ───────────────────────────────────────────────────────────
// Avant toute écriture : ce qui ne lit que la saisie d'abord — chaque ligne, dans l'ordre des lignes, son unité, sa
// référence, sa nature —, puis ce qui lit la base — le contact, puis l'article de chaque ligne. « % » : le rang de la ligne.
export const REFUS_DE_LA_PROVENANCE = [
  { cle: 'unite', rang: 1, code: '22023', modele: "Ligne % : l'unité n'est pas de la liste des unités admises." },
  { cle: 'reference', rang: 1, code: '22023', modele: 'Ligne % : la référence tient en un à cent caractères, sans blanc au début ni à la fin.' },
  { cle: 'nature', rang: 1, code: '22023', modele: "Ligne % : la nature d'une ligne est « biens » ou « services »." },
  { cle: 'contact', rang: 2, code: 'P0002', modele: "Le contact d'où vient le client de la facture est introuvable dans ce dossier." },
  { cle: 'article', rang: 3, code: 'P0002', modele: "Ligne % : l'article d'où elle vient est introuvable dans ce dossier." },
] as const

// À la validation, avant la numérotation et avant les refus de la source de la vente (lib/sourceDeLaVente.ts) : le
// contact que la facture garde — un brouillon écrit en direct a pu le poser —, puis, pour un accès « Ventes », une identité
// sans forme juridique (le cabinet la règle, elle en est le préalable : MEG1-Q14), puis l'entrepreneur individuel.
export const REFUS_DE_LA_VALIDATION_FIGEE = [
  { cle: 'contact_garde', rang: 4, code: 'P0002', modele: "Le contact d'où vient le client de la facture est introuvable dans ce dossier." },
  {
    cle: 'forme_a_regler', rang: 5, code: '22023',
    modele: "La forme juridique du dossier n'est pas renseignée : l'identité légale qu'une facture imprime est à régler par le "
      + "cabinet avant qu'une facture se valide depuis l'espace client.",
  },
  {
    cle: 'entrepreneur_individuel', rang: 6, code: '22023',
    modele: "La forme juridique du dossier est celle d'un entrepreneur individuel : sa dénomination imprimée, son nom précédé "
      + 'ou suivi des initiales « EI » ou des mots « entrepreneur individuel » (C. com., art. R526-27), est à renseigner par '
      + 'le cabinet avant de valider une facture.',
  },
] as const

export type CleRefusMentionsFigees =
  | (typeof REFUS_DE_LA_PROVENANCE)[number]['cle']
  | (typeof REFUS_DE_LA_VALIDATION_FIGEE)[number]['cle']

export interface RefusMentionsFigees {
  cle: CleRefusMentionsFigees
  code: string
  message: string
}

const TOUS_LES_REFUS = [...REFUS_DE_LA_PROVENANCE, ...REFUS_DE_LA_VALIDATION_FIGEE]

function refus(cle: CleRefusMentionsFigees, ...valeurs: string[]): RefusMentionsFigees {
  const r = TOUS_LES_REFUS.find((x) => x.cle === cle) as (typeof TOUS_LES_REFUS)[number]
  return { cle, code: r.code, message: remplirModele(r.modele, valeurs) }
}

// La saisie se juge telle que la base la reçoit, après l'aller-retour JSON : une clé `undefined` disparaît, NaN devient
// `null`. Une clé nulle ou absente ne dit rien (`jsonb_typeof` nul) ; une valeur d'un autre type que celui attendu se
// refuse, comme la base la refuse.
const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const champ = (objet: unknown, cle: string): unknown => (estObjet(objet) ? objet[cle] : undefined)
const absent = (v: unknown) => v === undefined || v === null
const caracteres = (texte: string) => Array.from(texte).length

/** Ce qu'`enregistrer_facture` juge de la provenance, avant d'écrire. */
export interface ProvenanceAJuger {
  // L'appel crée un avoir (aucune facture désignée, le type « avoir ») : la base prend le contact de sa facture, et ne
  // juge pas celui de la saisie.
  avoir: boolean
  // `p_facture` et `p_lignes`, tels que l'écran les enverrait.
  facture: unknown
  lignes: unknown
  // Les identifiants des contacts et des articles du dossier, LUS EN ENTIER — retirés et effacés compris : la base les
  // accepte, la facture garde sa copie. Sur une lecture partielle, l'appelant ne demande rien à ce module.
  contactsDuDossier: readonly string[]
  articlesDuDossier: readonly string[]
}

/**
 * Le PREMIER refus neuf qu'`enregistrer_facture` opposerait à la provenance, dans son ordre et sous ses mots ; null
 * quand elle l'accepterait. Les refus d'hier (l'accès, les lignes, le type, l'avoir, la facture validée) passent avant
 * lui, sous leurs propres modules.
 */
export function refusDeLaProvenance(p: ProvenanceAJuger): RefusMentionsFigees | null {
  const facture = commeLaBaseLaRecoit(p.facture)
  const recues = commeLaBaseLaRecoit(p.lignes)
  const lignes = Array.isArray(recues) ? recues : []
  for (const [i, ligne] of lignes.entries()) {
    const rang = String(i + 1)
    const unite = champ(ligne, 'unite')
    if (!absent(unite) && (typeof unite !== 'string' || !UNITES_DE_LIGNE.includes(unite))) return refus('unite', rang)
    const reference = champ(ligne, 'reference')
    if (!absent(reference) && (typeof reference !== 'string' || caracteres(reference) < 1 || caracteres(reference) > REFERENCE_DE_LIGNE_MAX
      || sansBlancsAuxBords(reference) !== reference)) return refus('reference', rang)
    const nature = champ(ligne, 'nature')
    if (!absent(nature) && (typeof nature !== 'string' || !NATURES_DE_LIGNE.includes(nature))) return refus('nature', rang)
  }
  const contact = champ(facture, 'contact_id')
  if (!p.avoir && !absent(contact) && (typeof contact !== 'string' || !p.contactsDuDossier.includes(contact))) return refus('contact')
  for (const [i, ligne] of lignes.entries()) {
    const article = champ(ligne, 'article_id')
    if (!absent(article) && (typeof article !== 'string' || !p.articlesDuDossier.includes(article))) return refus('article', String(i + 1))
  }
  return null
}

// ── L'entrepreneur individuel ───────────────────────────────────────────────────────────────────────────────────────
// Sa dénomination incorpore son nom, « précédé ou suivi immédiatement des mots « entrepreneur individuel » ou des initiales
// « EI » » (C. com., art. R526-27). La base ne connaît pas son nom d'état civil : elle exige la mention — les initiales en
// capitales, points admis, ou les mots, au masculin ou au féminin, la casse indifférente —, détachée des LETTRES voisines
// (`porte_la_mention_ei`, dont `[[:alpha:]]` est, sous la collation ICU de la base, la catégorie Unicode des lettres).
const INITIALES_EI = /(^|[^\p{L}])E\.?I\.?($|[^\p{L}])/u
const MOTS_EI = /(^|[^\p{L}])entrepreneure?\s+individuel(le)?($|[^\p{L}])/iu

/** Vrai quand la dénomination porte la mention d'un entrepreneur individuel ; faux pour une dénomination absente. */
export function porteLaMentionEI(denomination: string | null | undefined): boolean {
  return denomination != null && (INITIALES_EI.test(denomination) || MOTS_EI.test(denomination))
}

/** Ce que la validation juge de plus, quand la facture se valide. */
export interface ValidationAJuger {
  // Le contact que la facture garde après l'enregistrement : celui de la saisie quand elle le porte, sinon celui du
  // brouillon (une facture), celui de sa facture (un avoir).
  contactGarde: string | null
  contactsDuDossier: readonly string[]
  // L'identité que la facture figera (celle du dossier, ou pour un avoir celle que sa facture a figée).
  formeJuridique: string | null | undefined
  denomination: string | null | undefined
  // Qui valide : le cabinet du dossier (`admin_du_dossier`), ou un accès « Ventes ».
  cabinet: boolean
  // Un avoir qui reprend l'identité que sa facture a figée : la forme n'en est pas rejugée.
  reprise: boolean
}

/** Le premier refus neuf de la validation, dans l'ordre de la base ; null quand elle validerait. */
export function refusDeLaValidationFigee(v: ValidationAJuger): RefusMentionsFigees | null {
  if (v.contactGarde !== null && !v.contactsDuDossier.includes(v.contactGarde)) return refus('contact_garde')
  if (v.formeJuridique == null && !v.cabinet && !v.reprise) return refus('forme_a_regler')
  if (v.formeJuridique === CATEGORIE_ENTREPRENEUR_INDIVIDUEL && !porteLaMentionEI(v.denomination)) return refus('entrepreneur_individuel')
  return null
}

// ── Ce que la validation fige ───────────────────────────────────────────────────────────────────────────────────────
/** Les colonnes qu'`enregistrer_facture` écrit à la validation, telles qu'elle les écrirait. */
export interface MentionsFigees {
  mentions_figees: true
  statut_tva: StatutTva | null
  article_exoneration: ArticleExoneration | null
  numero_tva_attribue: boolean
  numero_tva_imprime: string | null
  denomination_imprimee: string | null
  forme_juridique: string | null
  capital: number | null
  rcs_ville: string | null
  mentions_identite: string | null
  parametres_id: string | null
  moyen_prefere: ParametresFacturation['moyen_prefere']
  escompte: string | null
  penalites: string | null
  mentions_complementaires: string | null
  pied_de_page: string | null
  logo_chemin: string | null
  logo_sha256: string | null
  iban_imprime: string | null
  bic_imprime: string | null
  titulaire_imprime: string | null
  rib_parametres_id: string | null
  mandataire_nom: string | null
}

/** Ce qu'une facture qui a figé ses mentions en a figé : ce qu'un avoir en reprend. */
export type MentionsDeLOrigine = Pick<FactureEmise, 'mentions_figees' | 'statut_tva' | 'article_exoneration' | 'numero_tva_attribue'
  | 'numero_tva_imprime' | 'denomination_imprimee' | 'forme_juridique' | 'capital' | 'rcs_ville' | 'mentions_identite'>

/** Une version des paramètres, telle que la validation la lit. */
export type VersionAFiger = VersionDuRib & Pick<ParametresFacturation, 'moyen_prefere' | 'escompte' | 'penalites'
  | 'mentions_complementaires' | 'pied_de_page'>

export interface EntreeDesMentions {
  dossierId: string
  // Le SIRET que la facture porte (pour un avoir, celui de sa facture) : le numéro de TVA se calcule sur lui.
  emetteurSiret: string | null
  // Pour un avoir, la facture qu'il corrige ; null pour une facture.
  origine: MentionsDeLOrigine | null
  dossier: Pick<Dossier, 'statut_tva' | 'article_exoneration' | 'numero_tva_attribue' | 'denomination_imprimee' | 'forme_juridique'
    | 'capital' | 'rcs_ville' | 'mentions_identite'>
  // Les versions des paramètres du dossier, LUES EN ENTIER.
  versions: readonly VersionAFiger[]
  // Le nom du cabinet quand c'est lui qui valide ; null quand c'est un accès « Ventes ».
  mandataire: string | null
}

/**
 * Ce que la validation figera, comme `enregistrer_facture` le lit ; `rompue` quand les versions lues ne font pas une
 * chaîne (l'appelant ne dit alors rien). Pour un avoir dont la facture a figé ses mentions, son statut et son numéro de
 * TVA et son identité ; sinon ceux du dossier, le numéro calculé sur le SIRET de la facture. Les paramètres : la version
 * COURANTE ; le RIB : le CONFIRMÉ en vigueur.
 */
export function mentionsAFiger(e: EntreeDesMentions): MentionsFigees | 'rompue' {
  const courante = versionCourante(e.versions, e.dossierId)
  const rib = ribEnVigueur(e.versions, e.dossierId)
  if (courante === 'rompue' || rib === 'rompue') return 'rompue'
  const o = e.origine
  const reprise = o !== null && o.mentions_figees === true
  const d = e.dossier
  const statut = reprise ? o.statut_tva ?? null : d.statut_tva
  const attribue = reprise ? o.numero_tva_attribue ?? false : d.numero_tva_attribue
  return {
    mentions_figees: true,
    statut_tva: statut,
    article_exoneration: reprise ? o.article_exoneration ?? null : d.article_exoneration,
    numero_tva_attribue: attribue,
    numero_tva_imprime: reprise
      ? o.numero_tva_imprime ?? null
      : numeroTvaImprime({ emetteur_siret: e.emetteurSiret }, { statut_tva: statut, article_exoneration: d.article_exoneration, numero_tva_attribue: attribue }),
    denomination_imprimee: (reprise ? o.denomination_imprimee : d.denomination_imprimee) ?? null,
    forme_juridique: (reprise ? o.forme_juridique : d.forme_juridique) ?? null,
    capital: (reprise ? o.capital : d.capital) ?? null,
    rcs_ville: (reprise ? o.rcs_ville : d.rcs_ville) ?? null,
    mentions_identite: (reprise ? o.mentions_identite : d.mentions_identite) ?? null,
    parametres_id: courante?.id ?? null,
    moyen_prefere: courante?.moyen_prefere ?? null,
    escompte: courante?.escompte ?? null,
    penalites: courante?.penalites ?? null,
    mentions_complementaires: courante?.mentions_complementaires ?? null,
    pied_de_page: courante?.pied_de_page ?? null,
    logo_chemin: courante?.logo_chemin ?? null,
    logo_sha256: courante?.logo_sha256 ?? null,
    iban_imprime: rib?.iban ?? null,
    bic_imprime: rib?.bic ?? null,
    titulaire_imprime: rib?.titulaire_compte ?? null,
    rib_parametres_id: rib?.version ?? null,
    mandataire_nom: e.mandataire,
  }
}
