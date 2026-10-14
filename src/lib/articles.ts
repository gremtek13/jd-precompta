import { remplirModele, tauxCommeLaBase } from './encaissementsFactures'
import { TAUX_ADMIS } from './factureCii'
import { exonerationDe, manqueMentionTva, MENTION_FRANCHISE, motifExoneration } from './statutTva'
import type { Article, ArticleExoneration, NatureArticle, StatutTva, UniteArticle } from './types'

// LES ARTICLES D'UN DOSSIER (espace client, étape A1 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION
// DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.1). Un module PUR — il ne lit rien en base, n'appelle
// personne, ne lit pas l'horloge — que les écrans de l'étape A2 liront : ce que les trois fonctions de la base refuseraient,
// dans LEUR ordre et sous LEURS mots, dit avant le clic ; et la ligne de facture qu'un article pré-remplit.
//
// CE QU'UN ARTICLE EST. Rien n'impose un catalogue : l'objet légal est la LIGNE d'une facture (C. com., art. L441-9, I ;
// CGI, ann. II, art. 242 nonies A, I). Un article la PRÉ-REMPLIT, et la ligne garde sa copie : la changer ensuite ne change
// pas l'article, et changer l'article ne change aucune facture. Ses champs sont ceux de la norme EN 16931 : la désignation
// (BT-153), sa description (BT-154), la référence que lui donne le vendeur (BT-155), l'unité (BT-130), le prix hors taxes
// (BT-146), le taux (BT-152) — que la DGFiP borne (G1.16, G1.24) —, et la nature, biens ou services. L'unité, la référence
// et la provenance n'entrent sur une ligne de facture qu'avec l'étape A7 ; d'ici là, la ligne garde ses quatre champs.

// ── Est-ce en base ? ──────────────────────────────────────────────────────────────────────────────────────────────────
// La migration `articles` OUVRE une lecture au client qui porte la case « Ventes » : présentée au cabinet, elle a été
// appliquée sur son accord, et l'export (supabase/schema) la porte. Le drapeau levé, le plan de sauvegarde compte leur
// table (src/lib/sauvegarde.ts) et la phrase de l'onglet Accès dit ce que la case « Ventes » ouvre de plus
// (src/lib/droitsAcces.ts) ; aucun écran ne les offre encore (étape A2). articles.test.ts confronte ce drapeau à l'export,
// et les refus ci-dessous au texte même des fonctions. Un retour arrière de la migration ne vient qu'APRÈS le drapeau
// rebaissé en ligne : sinon chaque sauvegarde lirait une table absente.
export const ARTICLES_EXPORTES: boolean = true

// ── Qui tient le catalogue (MEG1-Q1, décision du cabinet du 14/10/2026) ─────────────────────────────────────────────
// La recommandation de la conception, que le cabinet a retenue (« comme recommandé ») : le cabinet du dossier ET le
// client qui porte « Ventes », par les mêmes fonctions — dont l'accès est `gere_les_ventes` —, chaque article disant
// qui l'a créé, changé ou retiré. articles.test.ts confronte la décision au texte de la migration, dont l'en-tête, figé
// avec l'historique, la dit encore « hypothèse ». « Le cabinet seul » aurait fait vérifier `admin_du_dossier` aux trois
// fonctions, « le client seul » `client_du_dossier(…, 'ventes')` : une migration de plus si le cabinet changeait
// d'avis.
export const QUI_TIENT_LE_CATALOGUE = 'le cabinet et le client qui porte « Ventes »' as const
export const PREDICAT_DES_GESTES = 'gere_les_ventes' as const

// ── Les valeurs de la base, confrontées au texte de la migration par le test ─────────────────────────────────────────
// L'unité : une liste FERMÉE de codes des recommandations 20 et 21 de la CEE-ONU (BT-130 ; règles BR-23 et BR-CL-23) —
// un code hors de la liste que le validateur des artefacts EN 16931 applique serait refusé ; que chacun y figure se
// jugera sur des exemples fictifs à l'étape A7 (A-NV1). Les libellés sont ceux que l'écran montrera.
export const UNITES_ARTICLE: readonly { code: UniteArticle; libelle: string }[] = [
  { code: 'C62', libelle: 'unité' },
  { code: 'H87', libelle: 'pièce' },
  { code: 'HUR', libelle: 'heure' },
  { code: 'DAY', libelle: 'jour' },
  { code: 'WEE', libelle: 'semaine' },
  { code: 'MON', libelle: 'mois' },
  { code: 'ANN', libelle: 'année' },
  { code: 'KGM', libelle: 'kilogramme' },
  { code: 'MTR', libelle: 'mètre' },
  { code: 'MTK', libelle: 'mètre carré' },
  { code: 'LTR', libelle: 'litre' },
  { code: 'KMT', libelle: 'kilomètre' },
  { code: 'LS', libelle: 'forfait' },
]
// Celle de toute ligne de facture aujourd'hui (`UNITE_GENERIQUE`, factureCii.ts), et celle d'un article qui n'en dit pas.
export const UNITE_PAR_DEFAUT: UniteArticle = 'C62'
export const NATURES_ARTICLE: readonly NatureArticle[] = ['biens', 'services']
export const DESIGNATION_MAX = 1000
export const DESCRIPTION_MAX = 4000
export const REFERENCE_MAX = 100
export const DECIMALES_PRIX_ARTICLE = 6
// Une borne TECHNIQUE, reprise des devis, pas une règle de droit.
export const BORNE_PRIX_ARTICLE_EUROS = 10_000_000_000
// Un article nommé dans un refus l'est par sa désignation, coupée au-delà de ce nombre de caractères.
export const NOM_DANS_UN_REFUS_MAX = 80
// Les blancs que la base retire aux bords (`btrim(…, E' \t\n\r')`, la convention des migrations du dépôt) : l'espace, la
// tabulation, le saut de ligne et le retour chariot — ni une espace insécable, ni un autre blanc d'Unicode.
export const BLANCS = ' \t\n\r'

/** Les UNITÉS sous leur libellé : « heure », « forfait »… ; le code lui-même pour un code que la liste ne connaît pas. */
export function libelleUnite(code: string): string {
  return UNITES_ARTICLE.find((u) => u.code === code)?.libelle ?? code
}

// ── Les refus de la base, dans son ordre et sous ses mots ───────────────────────────────────────────────────────────
// Chaque liste est celle des `raise exception` d'une fonction, dans l'ordre de son texte, avec son code (articles.test.ts
// la confronte aux messages que l'essai supabase/essais/articles.sql exige de la base, et au texte exporté quand
// `ARTICLES_EXPORTES` est levé). Neuf RANGS pour `enregistrer_article`, quatorze messages : un rang peut en dire
// plusieurs (la désignation et sa description ; la forme puis l'unicité de la référence ; la présence puis la valeur du
// prix et du taux). Le refus d'accès, seule la base le juge : l'écran n'existe que pour qui lit le dossier. Une
// référence ne sert qu'une fois par dossier, retirés compris, et « R1 » n'est pas « r1 » (A1-Q2, décision du cabinet du
// 14/10/2026, « comme recommandé »).
export const REFUS_ENREGISTREMENT_ARTICLE = [
  { cle: 'acces', rang: 1, code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', rang: 2, code: 'P0002', modele: 'Article introuvable dans ce dossier.' },
  { cle: 'retire', rang: 3, code: '22023', modele: 'Cet article est retiré : le reprendre avant de le modifier.' },
  { cle: 'designation_absente', rang: 4, code: '22023', modele: "La désignation de l'article est à renseigner." },
  { cle: 'designation_longue', rang: 4, code: '22023', modele: "La désignation de l'article tient en mille caractères au plus." },
  {
    cle: 'description_invalide', rang: 4, code: '22023',
    modele: "La description de l'article est un texte de quatre mille caractères au plus.",
  },
  {
    cle: 'reference_invalide', rang: 5, code: '22023',
    modele: "La référence de l'article tient en un à cent caractères, sans blanc au début ni à la fin.",
  },
  {
    cle: 'reference_prise', rang: 5, code: '23505',
    modele: "La référence « % » est déjà celle de l'article « % »% : une référence ne sert qu'une fois par dossier.",
  },
  { cle: 'unite_inconnue', rang: 6, code: '22023', modele: "L'unité de l'article n'est pas de la liste des unités admises." },
  { cle: 'prix_absent', rang: 7, code: '22023', modele: "Le prix unitaire hors taxes de l'article est à renseigner." },
  {
    cle: 'prix_hors_bornes', rang: 7, code: '22023',
    modele: "Le prix unitaire hors taxes de l'article est positif ou nul, à six décimales au plus, sous dix milliards d'euros.",
  },
  { cle: 'taux_absent', rang: 8, code: '22023', modele: "Le taux de TVA de l'article est à renseigner." },
  { cle: 'taux_non_admis', rang: 8, code: '22023', modele: "Le taux de % %% n'est pas un taux de TVA admis." },
  { cle: 'nature_inconnue', rang: 9, code: '22023', modele: "La nature de l'article est « biens » ou « services »." },
] as const

export const REFUS_RETRAIT_ARTICLE = [
  { cle: 'acces', rang: 1, code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', rang: 2, code: 'P0002', modele: 'Article introuvable dans ce dossier.' },
  { cle: 'deja_retire', rang: 3, code: '22023', modele: 'Cet article est déjà retiré.' },
] as const

export const REFUS_REPRISE_ARTICLE = [
  { cle: 'acces', rang: 1, code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', rang: 2, code: 'P0002', modele: 'Article introuvable dans ce dossier.' },
  { cle: 'pas_retire', rang: 3, code: '22023', modele: "Cet article n'est pas retiré." },
] as const

export type CleRefusEnregistrementArticle = (typeof REFUS_ENREGISTREMENT_ARTICLE)[number]['cle']
export type CleRefusRetraitArticle = (typeof REFUS_RETRAIT_ARTICLE)[number]['cle']
export type CleRefusRepriseArticle = (typeof REFUS_REPRISE_ARTICLE)[number]['cle']

export interface RefusArticle<C extends string> {
  cle: C
  message: string
}

function refusDe<C extends string>(liste: readonly { cle: C; modele: string }[], cle: C, valeurs: string[]): RefusArticle<C> {
  const { modele } = liste.find((r) => r.cle === cle) as { cle: C; modele: string }
  return { cle, message: remplirModele(modele, valeurs) }
}

// ── Lire la saisie comme la fonction la lit ─────────────────────────────────────────────────────────────────────────
// La saisie part en JSON (`JSON.stringify`) : une clé `undefined` ou une fonction disparaît, NaN et l'infini deviennent
// `null`, un nombre s'écrit comme `String` l'écrit. Le module la juge donc APRÈS cet aller-retour, telle que la base la
// reçoit. La fonction lit chaque champ par son TYPE JSON d'abord — un nombre n'est pas un texte, un texte n'est pas un
// nombre —, compte les caractères comme `char_length` (par point de code : un emoji vaut un, comme une lettre accentuée),
// et ne retire aux bords que les quatre blancs de `BLANCS`.

/** La saisie telle que la base la reçoit : son aller-retour par JSON ; ce qui ne s'écrit pas en JSON, comme rien. */
function commeLaBaseLaRecoit(saisie: unknown): unknown {
  try {
    const texte = JSON.stringify(saisie)
    return texte === undefined ? null : JSON.parse(texte)
  } catch {
    return null
  }
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// Après l'aller-retour, un objet n'a que ses propres clés : une clé héritée n'a pas été envoyée.
const champ = (objet: unknown, cle: string): unknown => (estObjet(objet) ? objet[cle] : undefined)
// Absent, ou nul en JSON.
const absent = (v: unknown) => v === undefined || v === null
const caracteres = (texte: string) => Array.from(texte).length

const BLANCS_AUX_BORDS = new RegExp(`^[${BLANCS}]+|[${BLANCS}]+$`, 'g')

/** Le texte sans les blancs de ses bords, comme `btrim(texte, E' \t\n\r')`. */
export function sansBlancsAuxBords(texte: string): string {
  return texte.replace(BLANCS_AUX_BORDS, '')
}

// Le nombre en notation décimale, tel que la base le lit (`tauxCommeLaBase`, sans sa virgule), et ses décimales.
const decimalDe = (n: number) => tauxCommeLaBase(n).replace(',', '.')
const decimales = (n: number) => (decimalDe(n).split('.')[1] ?? '').length

/** Un article nommé dans un refus : sa désignation, coupée à soixante-dix-neuf caractères et « … » au-delà de quatre-vingts. */
export function nomDansUnRefus(designation: string): string {
  const lettres = Array.from(designation)
  return lettres.length > NOM_DANS_UN_REFUS_MAX ? `${lettres.slice(0, NOM_DANS_UN_REFUS_MAX - 1).join('')}…` : designation
}

/** L'article que l'écriture vise : un article neuf, ou celui de l'identifiant envoyé — nul quand l'écran ne l'a pas lu. */
export type CibleArticle =
  | { nouveau: true }
  | { nouveau: false; article: Pick<Article, 'id' | 'dossier_id' | 'retire_le'> | null }

/** Ce qu'il faut savoir des articles du dossier pour juger l'unicité d'une référence : la liste LUE EN ENTIER. */
export type ArticlePourReference = Pick<Article, 'id' | 'dossier_id' | 'reference' | 'designation' | 'retire_le'>

/**
 * Ce qu'`enregistrer_article` refuserait de cette saisie : le PREMIER refus, dans l'ordre de la base et sous son message,
 * ou null quand elle l'accepterait. `articlesDuDossier` : la liste des articles du dossier LUE EN ENTIER — l'unicité d'une
 * référence s'y juge ; sur une lecture partielle, l'appelant ne demande rien à ce module (il ne dirait pas « libre » une
 * référence qu'il n'a pas vue).
 */
export function refusEnregistrementArticle(
  dossierId: string,
  cible: CibleArticle,
  saisie: unknown,
  articlesDuDossier: readonly ArticlePourReference[],
): RefusArticle<CleRefusEnregistrementArticle> | null {
  const refus = (cle: CleRefusEnregistrementArticle, ...valeurs: string[]) => refusDe(REFUS_ENREGISTREMENT_ARTICLE, cle, valeurs)
  // 2 et 3. L'article, dans ce dossier ; un article retiré se reprend avant de se modifier.
  if (!cible.nouveau) {
    if (!cible.article || cible.article.dossier_id !== dossierId) return refus('introuvable')
    if (cible.article.retire_le != null) return refus('retire')
  }
  const recue = commeLaBaseLaRecoit(saisie)
  // 4. La désignation, puis sa description.
  const designation = champ(recue, 'designation')
  if (typeof designation !== 'string' || sansBlancsAuxBords(designation) === '') return refus('designation_absente')
  if (caracteres(designation) > DESIGNATION_MAX) return refus('designation_longue')
  const description = champ(recue, 'description')
  if (!absent(description) && (typeof description !== 'string' || caracteres(description) > DESCRIPTION_MAX)) {
    return refus('description_invalide')
  }
  // 5. La référence : sa forme, puis son unicité dans le dossier, retirés compris.
  const reference = champ(recue, 'reference')
  if (!absent(reference)) {
    if (typeof reference !== 'string' || caracteres(reference) < 1 || caracteres(reference) > REFERENCE_MAX
      || sansBlancsAuxBords(reference) !== reference) {
      return refus('reference_invalide')
    }
    const cibleId = cible.nouveau ? null : cible.article?.id ?? null
    const autre = articlesDuDossier.find((a) => a.dossier_id === dossierId && a.reference === reference && a.id !== cibleId)
    if (autre) return refus('reference_prise', reference, nomDansUnRefus(autre.designation), autre.retire_le != null ? ' (retiré)' : '')
  }
  // 6. L'unité, de la liste ; absente, l'unité générique.
  const unite = champ(recue, 'unite')
  if (!absent(unite) && (typeof unite !== 'string' || !UNITES_ARTICLE.some((u) => u.code === unite))) return refus('unite_inconnue')
  // 7. Le prix : un nombre, positif ou nul, à six décimales au plus, sous dix milliards d'euros.
  const prix = champ(recue, 'prix_unitaire_ht')
  if (typeof prix !== 'number') return refus('prix_absent')
  if (prix < 0 || decimales(prix) > DECIMALES_PRIX_ARTICLE || prix >= BORNE_PRIX_ARTICLE_EUROS) return refus('prix_hors_bornes')
  // 8. Le taux : un nombre, que la DGFiP admet.
  const taux = champ(recue, 'taux_tva')
  if (typeof taux !== 'number') return refus('taux_absent')
  if (!TAUX_ADMIS.includes(taux)) return refus('taux_non_admis', tauxCommeLaBase(taux))
  // 9. La nature.
  const nature = champ(recue, 'nature')
  if (typeof nature !== 'string' || !NATURES_ARTICLE.includes(nature as NatureArticle)) return refus('nature_inconnue')
  return null
}

/** Ce que `retirer_article` refuserait ; null quand elle retirerait l'article. */
export function refusRetraitArticle(
  dossierId: string,
  article: Pick<Article, 'dossier_id' | 'retire_le'> | null,
): RefusArticle<CleRefusRetraitArticle> | null {
  const refus = (cle: CleRefusRetraitArticle) => refusDe(REFUS_RETRAIT_ARTICLE, cle, [])
  if (!article || article.dossier_id !== dossierId) return refus('introuvable')
  if (article.retire_le != null) return refus('deja_retire')
  return null
}

/** Ce que `reprendre_article` refuserait ; null quand elle reprendrait l'article. */
export function refusRepriseArticle(
  dossierId: string,
  article: Pick<Article, 'dossier_id' | 'retire_le'> | null,
): RefusArticle<CleRefusRepriseArticle> | null {
  const refus = (cle: CleRefusRepriseArticle) => refusDe(REFUS_REPRISE_ARTICLE, cle, [])
  if (!article || article.dossier_id !== dossierId) return refus('introuvable')
  if (article.retire_le == null) return refus('pas_retire')
  return null
}

// ── La ligne qu'un article pré-remplit ──────────────────────────────────────────────────────────────────────────────
// Le taux de l'article est celui de l'opération QUAND le dossier est redevable : la ligne applique le statut de TVA du
// JOUR (lib/statutTva.ts), comme une ligne saisie aujourd'hui (`ligneVide`, FactureFormModal) — 0 % pour un dossier en
// franchise, exonéré, ou dont le statut est à préciser, celui-ci avec son avertissement (A1-Q3) : une ligne taxée
// rendrait la TVA due du seul fait de l'avoir facturée (CGI, art. 283, 3). La mention que la ligne demande à la
// facture, et ce qui empêche de la proposer, se disent avec elle, sous les mots du module du statut. La désignation
// porte la description à sa suite, sur UNE ligne, jusqu'à l'étape A7 (A1-Q4) : un champ de texte d'une ligne retire les
// sauts de ligne qu'on lui donne. A1-Q3 et A1-Q4 : décisions du cabinet du 14/10/2026, « comme recommandé ».

export interface LigneDepuisArticle {
  /** La ligne, telle qu'elle s'écrit dans le formulaire : quantité 1, le prix et le taux du jour. */
  ligne: { designation: string; quantite: number; prix_unitaire_ht: number; taux_tva: number }
  /** La mention de TVA que cette ligne demande à la facture ; null quand elle n'en demande aucune, ou qu'on ne la sait pas. */
  mention: string | null
  /** Ce qui empêche de proposer le bon taux ou la bonne mention, dit à qui rédige ; null sinon. */
  avertissement: string | null
}

/** La désignation d'une ligne : celle de l'article, puis sa description après un tiret, ses sauts de ligne en espaces. */
export function designationDeLaLigne(article: Pick<Article, 'designation' | 'description'>): string {
  const uneLigne = (texte: string) => sansBlancsAuxBords(texte.replace(/[\r\n]+/g, ' '))
  const designation = uneLigne(article.designation)
  const description = article.description == null ? '' : uneLigne(article.description)
  return description === '' ? designation : `${designation} — ${description}`
}

export function ligneDepuisArticle(
  article: Pick<Article, 'designation' | 'description' | 'prix_unitaire_ht' | 'taux_tva'>,
  statut: StatutTva | null,
  articleExoneration: ArticleExoneration | null,
): LigneDepuisArticle {
  const taux = statut === 'redevable' ? article.taux_tva : 0
  const ligne = { designation: designationDeLaLigne(article), quantite: 1, prix_unitaire_ht: article.prix_unitaire_ht, taux_tva: taux }
  if (statut === 'redevable') {
    if (taux > 0) return { ligne, mention: null, avertissement: null }
    // Une ligne à 0 % d'un redevable : la mention de l'article de son exonération, que `motifExoneration` exige.
    const mention = exonerationDe(articleExoneration)?.mention ?? null
    return { ligne, mention, avertissement: mention ? null : motifExoneration(statut, articleExoneration).refus }
  }
  if (statut === 'franchise') return { ligne, mention: MENTION_FRANCHISE, avertissement: null }
  if (statut === 'exonere') {
    return { ligne, mention: exonerationDe(articleExoneration)?.mention ?? null, avertissement: manqueMentionTva(statut, articleExoneration) }
  }
  return { ligne, mention: null, avertissement: manqueMentionTva(null, articleExoneration) }
}
