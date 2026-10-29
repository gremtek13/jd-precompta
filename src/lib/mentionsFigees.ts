import { NATURES_ARTICLE, REFERENCE_MAX, UNITES_ARTICLE, sansBlancsAuxBords } from './articles'
import { CATEGORIE_ENTREPRENEUR_INDIVIDUEL } from './categoriesJuridiques'
import { commeLaBaseLaRecoit } from './contacts'
import { remplirModele } from './encaissementsFactures'
import { numeroTvaImprime } from './factureCii'
import { MODELE_IBAN_DANS_UN_TEXTE, porteUnIban, ribEnVigueur, versionCourante, type VersionDuRib } from './parametresFacturation'
import type { ArticleExoneration, Dossier, FactureEmise, ParametresFacturation, StatutTva } from './types'

// LA FACTURE FIGE SES MENTIONS (espace client, étape A7a, ligne 51.5 ; migration `mentions_figees` ; HISTORIQUE.md,
// « LA FACTURE FIGE SES MENTIONS, EN BASE », reprise sur A7-Q1 à A7-Q3 : « LA FACTURE FIGE SES MENTIONS : L'ÉMETTEUR DU
// DOSSIER ET L'IBAN HORS DES TEXTES LIBRES », et sur A7Q-Q1 : « A7Q-Q1 : UNE SOCIÉTÉ SANS DÉNOMINATION NE SE FACTURE
// PAS DEPUIS L'ESPACE CLIENT, DANS LA MIGRATION »). Un module PUR — il ne lit rien en base, n'appelle personne, ne lit
// pas l'horloge — qui redit `enregistrer_facture` telle que la migration la recrée :
//   - ses REFUS NEUFS, dans son ordre et sous ses mots, avant le clic : la provenance des lignes (l'unité, la référence, la
//     nature, ligne par ligne), le contact d'où vient le client, l'article d'où vient chaque ligne (`refusDeLaProvenance`) ;
//     puis un texte libre que la facture imprime et qui porte un IBAN (`refusDesTextesDeLaFacture`, A7-Q3) ; à la
//     validation, le contact que garde le brouillon, la forme juridique pour un accès « Ventes », la dénomination d'un
//     entrepreneur individuel, la dénomination du dossier pour un accès « Ventes » (A7Q-Q1), le SIRET et l'adresse du
//     dossier pour un accès « Ventes » (A7-Q2), l'identité et les paramètres en vigueur qui portent un IBAN
//     (`refusDeLaValidationFigee`, `porteLaMentionEI`). Les refus d'hier passent d'abord, sous leurs propres modules
//     (`refusAvoir`, lib/factures.ts ; lib/sourceDeLaVente.ts) ;
//   - CE QUE LA VALIDATION FIGE (`mentionsAFiger`) : le statut et le numéro de TVA (`numeroTvaImprime`, le calcul que la
//     base refait dans `numero_tva_du_vendeur`), l'identité légale, les paramètres de la version courante, le RIB CONFIRMÉ
//     en vigueur (`ribEnVigueur`) — jamais un RIB seulement proposé —, le logo, le mandataire. L'étape A7b le lira pour
//     dire, avant le clic, ce que la facture imprimera.
// src/lib/mentionsFigees.test.ts confronte chaque refus au texte de la fonction dans l'export et à l'essai
// supabase/essais/mentionsFigees.sql, le numéro de TVA et la mention de l'entrepreneur individuel aux cas de l'essai.

// LA MIGRATION EST EN BASE depuis le 29/10/2026 : `mentions_figees`, collée par le cabinet (version 20261029214359),
// puis `iban_hors_des_parametres`, par l'outil (version 20261029214732). Le drapeau est levé ; aucun écran n'envoie ni
// ne lit encore rien de neuf : l'étape A7b, qui s'y range, le fera. Chaque fonction de ce module se juge sans lui.
export const MENTIONS_FIGEES_EXPORTEES: boolean = true

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

// Après l'écriture de la facture et de ses lignes, à chaque enregistrement et pour tout auteur (A7-Q3) : un texte libre
// qu'elle imprime et qui porte un IBAN, le premier dans l'ordre de l'impression (`TEXTES_DE_L_EN_TETE`, chaque ligne, la
// mention légale). « % » le nomme.
export const REFUS_DES_TEXTES = [
  { cle: 'iban_dans_un_texte', rang: 4, code: '22023', modele: MODELE_IBAN_DANS_UN_TEXTE },
] as const

// À la validation, avant la numérotation et avant les refus de la source de la vente (lib/sourceDeLaVente.ts) : le
// contact que la facture garde — un brouillon écrit en direct a pu le poser —, puis, pour un accès « Ventes », une identité
// sans forme juridique (le cabinet la règle, elle en est le préalable : MEG1-Q14, A7-Q1), puis l'entrepreneur individuel ;
// puis, pour un accès « Ventes », une dénomination absente ou de blancs, quelle que soit la forme (A7Q-Q1 : après
// l'entrepreneur individuel, dont le refus dit aussi ce qu'elle doit porter ; un avoir qui reprend l'identité de sa
// facture n'en juge rien) ; puis, pour un accès « Ventes » et une facture (A7-Q2), le SIRET et l'adresse du dossier ;
// puis, pour tout auteur, un IBAN dans ce que la validation figerait (A7-Q3).
export const REFUS_DE_LA_VALIDATION_FIGEE = [
  { cle: 'contact_garde', rang: 5, code: 'P0002', modele: "Le contact d'où vient le client de la facture est introuvable dans ce dossier." },
  {
    cle: 'forme_a_regler', rang: 6, code: '22023',
    modele: "La forme juridique du dossier n'est pas renseignée : l'identité légale qu'une facture imprime est à régler par le "
      + "cabinet avant qu'une facture se valide depuis l'espace client.",
  },
  {
    cle: 'entrepreneur_individuel', rang: 7, code: '22023',
    modele: "La forme juridique du dossier est celle d'un entrepreneur individuel : sa dénomination imprimée, son nom précédé "
      + 'ou suivi des initiales « EI » ou des mots « entrepreneur individuel » (C. com., art. R526-27), est à renseigner par '
      + 'le cabinet avant de valider une facture.',
  },
  {
    cle: 'denomination_a_poser', rang: 8, code: '22023',
    modele: "La dénomination du dossier n'est pas renseignée : le cabinet la renseigne avant qu'une facture se valide depuis "
      + "l'espace client.",
  },
  {
    cle: 'siret_a_poser', rang: 9, code: '22023',
    modele: "Le SIRET du dossier n'est pas renseigné : le cabinet le renseigne avant qu'une facture se valide depuis l'espace client.",
  },
  {
    cle: 'siret_du_dossier', rang: 10, code: '22023',
    modele: "Le SIRET de l'émetteur n'est pas celui du dossier : une facture validée depuis l'espace client porte le SIRET que le "
      + 'cabinet a renseigné.',
  },
  {
    cle: 'adresse_a_poser', rang: 11, code: '22023',
    modele: "L'adresse du dossier n'est pas renseignée : le cabinet la renseigne avant qu'une facture se valide depuis l'espace "
      + 'client.',
  },
  {
    cle: 'adresse_du_dossier', rang: 12, code: '22023',
    modele: "L'adresse de l'émetteur n'est pas celle du dossier : une facture validée depuis l'espace client porte l'adresse que "
      + 'le cabinet a renseignée.',
  },
  { cle: 'iban_a_la_validation', rang: 13, code: '22023', modele: MODELE_IBAN_DANS_UN_TEXTE },
] as const

export type CleRefusMentionsFigees =
  | (typeof REFUS_DE_LA_PROVENANCE)[number]['cle']
  | (typeof REFUS_DES_TEXTES)[number]['cle']
  | (typeof REFUS_DE_LA_VALIDATION_FIGEE)[number]['cle']

export interface RefusMentionsFigees {
  cle: CleRefusMentionsFigees
  code: string
  message: string
}

const TOUS_LES_REFUS = [...REFUS_DE_LA_PROVENANCE, ...REFUS_DES_TEXTES, ...REFUS_DE_LA_VALIDATION_FIGEE]

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

// ── Un IBAN dans un texte libre de la facture (A7-Q3) ───────────────────────────────────────────────────────────────
// Les textes que la facture imprime, dans l'ordre où `enregistrer_facture` les juge — celui de l'impression : l'en-tête
// (1 à 11), chaque ligne (12 : sa désignation, puis sa référence), la mention légale (13). `garde` : la base GARDE le
// texte du brouillon quand la saisie ne nomme pas sa clé (`p_facture ? …`) ; les autres s'écrivent de la saisie, nuls
// quand elle ne les porte pas. Les notes et l'adresse électronique du client ne s'impriment pas : rien ne les juge.
export const TEXTES_DE_L_EN_TETE = [
  { rang: 1, cle: 'emetteur_nom', libelle: "le nom de l'émetteur", garde: false },
  { rang: 2, cle: 'emetteur_adresse', libelle: "l'adresse de l'émetteur", garde: false },
  { rang: 3, cle: 'emetteur_siret', libelle: "le SIRET de l'émetteur", garde: false },
  { rang: 4, cle: 'tiers_nom', libelle: 'le nom du client', garde: false },
  { rang: 5, cle: 'tiers_adresse', libelle: "l'adresse du client", garde: false },
  { rang: 6, cle: 'tiers_siret', libelle: 'le SIRET du client', garde: false },
  { rang: 7, cle: 'livraison_adresse', libelle: "l'adresse de livraison", garde: true },
  { rang: 8, cle: 'livraison_code_postal', libelle: 'le code postal de livraison', garde: true },
  { rang: 9, cle: 'livraison_ville', libelle: 'la ville de livraison', garde: true },
  { rang: 10, cle: 'code_service', libelle: 'le code service', garde: true },
  { rang: 11, cle: 'numero_engagement', libelle: "le numéro d'engagement", garde: true },
  { rang: 13, cle: 'mentions_legales', libelle: 'la mention légale', garde: false },
] as const
export const TEXTES_DE_LA_LIGNE = [
  { cle: 'designation', libelle: 'la désignation' },
  { cle: 'reference', libelle: 'la référence' },
] as const

type CleDUnTexteGarde = Extract<(typeof TEXTES_DE_L_EN_TETE)[number], { garde: true }>['cle']

/** Ce qu'`enregistrer_facture` juge des textes, après les avoir écrits. */
export interface TextesAJuger {
  // L'appel crée un avoir : ses lignes et sa mention légale seules se jugent, le reste est la copie de sa facture.
  avoir: boolean
  // `p_facture` et `p_lignes`, tels que l'écran les enverrait.
  facture: unknown
  lignes: unknown
  // Le brouillon que l'appel modifie, tel qu'il est en base : ce qu'il garde quand la saisie ne nomme pas la clé ; null
  // pour une création (une facture neuve, un avoir).
  brouillon: Partial<Pick<FactureEmise, CleDUnTexteGarde>> | null
}

// Un champ JSON tel que `->>` le rend en texte : un texte, lui-même ; un nombre ou un booléen, son écriture JSON ; un objet
// ou un tableau, son JSON ; nul ou absent, rien.
function texteDuJson(v: unknown): string | null {
  if (absent(v)) return null
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/** Le premier texte que la facture imprimerait et qui porte un IBAN, dans l'ordre de la base ; null quand aucun n'en porte. */
export function refusDesTextesDeLaFacture(t: TextesAJuger): RefusMentionsFigees | null {
  const facture = commeLaBaseLaRecoit(t.facture)
  const recues = commeLaBaseLaRecoit(t.lignes)
  const lignes = Array.isArray(recues) ? recues : []
  const ecrit = (cle: string, garde: boolean): string | null => {
    if (!garde) return texteDuJson(champ(facture, cle))
    // `nullif(p_facture->>'…', '')` ; dans un brouillon modifié, la valeur en place quand la clé manque.
    if (t.brouillon !== null && !(estObjet(facture) && cle in facture)) return t.brouillon[cle as CleDUnTexteGarde] ?? null
    const texte = texteDuJson(champ(facture, cle))
    return texte === '' ? null : texte
  }
  const jugeTexte = (texte: string | null, libelle: string) => (porteUnIban(texte) ? refus('iban_dans_un_texte', libelle) : null)
  for (const { rang, cle, libelle, garde } of TEXTES_DE_L_EN_TETE) {
    if (rang === 13) break
    if (t.avoir) continue
    const r = jugeTexte(ecrit(cle, garde), libelle)
    if (r) return r
  }
  for (const [i, ligne] of lignes.entries()) {
    for (const { cle, libelle } of TEXTES_DE_LA_LIGNE) {
      const r = jugeTexte(texteDuJson(champ(ligne, cle)), `${libelle} de la ligne ${i + 1}`)
      if (r) return r
    }
  }
  return jugeTexte(texteDuJson(champ(facture, 'mentions_legales')), 'la mention légale')
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
  rcsVille: string | null | undefined
  mentionsIdentite: string | null | undefined
  // Qui valide : le cabinet du dossier (`admin_du_dossier`), ou un accès « Ventes ».
  cabinet: boolean
  // Un avoir (il reprend l'émetteur de sa facture), et un avoir qui reprend l'identité que sa facture a figée : ni la
  // forme ni l'identité n'en sont rejugées.
  avoir: boolean
  reprise: boolean
  // L'émetteur que la facture porte après l'enregistrement (`emetteur_siret`, `emetteur_adresse`), et le SIRET et
  // l'adresse du dossier, tels que la base les lit dans la transaction qui valide (A7-Q2).
  emetteurSiret: string | null
  emetteurAdresse: string | null
  dossierSiret: string | null
  dossierAdresse: string | null
  // Les textes de la version COURANTE des paramètres (celle que la validation fige), null quand le dossier n'en a pas.
  parametres: Pick<ParametresFacturation, 'escompte' | 'penalites' | 'mentions_complementaires' | 'pied_de_page'> | null
}

// « Les mêmes » (A7-Q2), comme la base les juge : le SIRET, ses caractères, les blancs (`\s`) retirés où qu'ils soient ;
// l'adresse, son texte, ses fins de ligne ramenées à `\n`, les blancs de ses bords retirés — `trim` retire ceux que `\s`
// désigne, ceux de la base.
export const siretSansBlancs = (siret: string | null): string => (siret ?? '').replace(/\s/g, '')
export const adresseNette = (adresse: string | null): string => (adresse ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
// La dénomination que la facture figera (A7Q-Q1), comme la base la juge (`btrim(…, v_blancs) = ''`) : absente, ou faite
// des seuls blancs que `\s` désigne — ceux que `trim` retire, ceux de la base.
export const denominationAbsente = (denomination: string | null | undefined): boolean => (denomination ?? '').trim() === ''

// Ce que la validation figerait et que la facture imprime sans confirmation, dans l'ordre de la base (A7-Q3).
export const TEXTES_FIGES_A_LA_VALIDATION = [
  { rang: 1, libelle: 'la dénomination du dossier' },
  { rang: 2, libelle: 'la ville du greffe du dossier' },
  { rang: 3, libelle: "les autres mentions de l'identité du dossier" },
  { rang: 4, libelle: "les conditions d'escompte des paramètres de facturation" },
  { rang: 5, libelle: 'les pénalités de retard des paramètres de facturation' },
  { rang: 6, libelle: 'les mentions complémentaires des paramètres de facturation' },
  { rang: 7, libelle: 'le pied de page des paramètres de facturation' },
] as const

/** Le premier refus neuf de la validation, dans l'ordre de la base ; null quand elle validerait. */
export function refusDeLaValidationFigee(v: ValidationAJuger): RefusMentionsFigees | null {
  if (v.contactGarde !== null && !v.contactsDuDossier.includes(v.contactGarde)) return refus('contact_garde')
  if (v.formeJuridique == null && !v.cabinet && !v.reprise) return refus('forme_a_regler')
  if (v.formeJuridique === CATEGORIE_ENTREPRENEUR_INDIVIDUEL && !porteLaMentionEI(v.denomination)) return refus('entrepreneur_individuel')
  if (denominationAbsente(v.denomination) && !v.cabinet && !v.reprise) return refus('denomination_a_poser')
  if (!v.cabinet && !v.avoir) {
    if (siretSansBlancs(v.dossierSiret) === '') return refus('siret_a_poser')
    if (siretSansBlancs(v.emetteurSiret) !== siretSansBlancs(v.dossierSiret)) return refus('siret_du_dossier')
    if (adresseNette(v.dossierAdresse) === '') return refus('adresse_a_poser')
    if (adresseNette(v.emetteurAdresse) !== adresseNette(v.dossierAdresse)) return refus('adresse_du_dossier')
  }
  const valeurs = [v.denomination, v.rcsVille, v.mentionsIdentite, v.parametres?.escompte, v.parametres?.penalites,
    v.parametres?.mentions_complementaires, v.parametres?.pied_de_page]
  for (const [i, { rang, libelle }] of TEXTES_FIGES_A_LA_VALIDATION.entries()) {
    if (rang <= 3 && v.reprise) continue
    if (porteUnIban(valeurs[i])) return refus('iban_a_la_validation', libelle)
  }
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
