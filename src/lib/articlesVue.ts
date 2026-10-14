import { estLeClient, PAR_LE_CLIENT, type AccesDuDossier } from './auteursVentes'
import { tauxCommeLaBase } from './encaissementsFactures'
import {
  UNITE_PAR_DEFAUT, refusEnregistrementArticle, refusRepriseArticle, refusRetraitArticle, sansBlancsAuxBords,
  type ArticlePourReference, type CibleArticle, type CleRefusEnregistrementArticle, type CleRefusRepriseArticle, type CleRefusRetraitArticle,
  type RefusArticle,
} from './articles'
import type { Article, NatureArticle, UniteArticle } from './types'

// LA LISTE DES ARTICLES, SA SAISIE ET SES GESTES (espace client, étape A2a ; conception : HISTORIQUE.md, « L'ESPACE CLIENT,
// LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.1, « Ce que voit le client »). Un module
// PUR — rien lu, rien écrit, pas d'horloge — que l'écran `ArticlesVue` appelle : ce que la liste montre dans l'ordre où elle
// le montre, ce que la saisie envoie, qui a fait quoi, et ce que chaque geste refuserait.
//
// AUCUNE RÈGLE DE LA BASE N'EST RECOPIÉE ICI : les refus sont ceux de `lib/articles.ts`, jugés sur la saisie TELLE QU'ELLE
// PART (l'objet que `saisieEnvoyee` construit est celui que l'écran envoie et que le module juge). Ce fichier ne dit que ce
// qu'une ZONE DE SAISIE de texte ajoute : un prix tapé qui n'est pas un nombre n'est pas « absent ».

// ── La saisie : tout en texte, comme les champs ───────────────────────────────────────────────────────────────────────
export interface SaisieArticle {
  reference: string
  designation: string
  description: string
  unite: UniteArticle
  // Le prix et le taux sont des TEXTES de champ : ni l'un ni l'autre n'est choisi à la place de qui saisit (le taux d'un
  // dossier redevable n'est pas toujours le taux normal ; le prix, jamais deviné).
  prix: string
  taux: string
  nature: NatureArticle | ''
}

/** La saisie telle que la base la reçoit (`p_article`) : le module `articles.ts` la juge sous cette forme-là. */
export interface SaisieEnvoyee {
  designation: string
  description: string | null
  reference: string | null
  unite: string
  prix_unitaire_ht: number | null
  taux_tva: number | null
  nature: string | null
}

/** La saisie d'un article neuf (l'unité générique, rien d'autre) ou celle qui part de l'article LU, champ pour champ. */
export function saisieInitiale(article: Article | null): SaisieArticle {
  if (!article) return { reference: '', designation: '', description: '', unite: UNITE_PAR_DEFAUT, prix: '', taux: '', nature: '' }
  return {
    reference: article.reference ?? '',
    designation: article.designation,
    description: article.description ?? '',
    unite: article.unite,
    prix: tauxCommeLaBase(article.prix_unitaire_ht),
    taux: String(article.taux_tva),
    nature: article.nature,
  }
}

/** La saisie a-t-elle changé depuis son point de départ ? Un champ qu'on n'a pas touché ne s'accuse pas d'être vide. */
export function saisieTouchee(depart: SaisieArticle, saisie: SaisieArticle): boolean {
  return (Object.keys(depart) as (keyof SaisieArticle)[]).some((k) => depart[k] !== saisie[k])
}

// Un prix tapé : « 12,50 », « 12.5 », « 1 200,5 » (espaces ordinaires, insécables et fines ignorées). La forme canonique du
// texte doit être celle du nombre qu'il donne : « 0,10000000000000000001 » donnerait 0,1 en silence — arrondir sans le dire
// est ce que cet écran s'interdit.
const ESPACES_DU_PRIX = /[   ]/g
const FORME_DU_PRIX = /^(-?)(\d+)(?:\.(\d*))?$/

function formeCanonique(texte: string): string | null {
  const m = FORME_DU_PRIX.exec(texte)
  if (!m) return null
  const entier = m[2].replace(/^0+(?=\d)/, '')
  const fraction = (m[3] ?? '').replace(/0+$/, '')
  return `${m[1]}${entier}${fraction === '' ? '' : `.${fraction}`}`
}

/** Le prix tapé : un nombre, `null` quand le champ est vide, `'illisible'` quand ce n'est pas un nombre qu'on lit sans le changer. */
export function lirePrix(texte: string): number | null | 'illisible' {
  const nu = texte.replace(ESPACES_DU_PRIX, '').replace(',', '.')
  if (nu === '') return null
  const canonique = formeCanonique(nu)
  if (canonique == null) return 'illisible'
  const n = Number(canonique)
  if (!Number.isFinite(n)) return 'illisible'
  // `-0` s'écrit « 0 » : le même prix.
  return tauxCommeLaBase(n) === canonique.replace('.', ',') || (n === 0 && /^-?0$/.test(canonique)) ? n : 'illisible'
}

export const PRIX_ILLISIBLE = 'Le prix n’est pas un nombre que l’écran sait lire sans le changer (par exemple 12,50).'

/**
 * La saisie telle que la base la reçoit (`p_article`). Un champ facultatif VIDE n'est pas envoyé (`null`) : une référence
 * de zéro caractère est refusée par la base, et la description vide n'est pas un texte. Un prix illisible, un taux ou une
 * nature non choisis partent absents : le module dit alors « à renseigner ».
 */
export function saisieEnvoyee(s: SaisieArticle): SaisieEnvoyee {
  const prix = lirePrix(s.prix)
  return {
    designation: s.designation,
    description: sansBlancsAuxBords(s.description) === '' ? null : s.description,
    reference: sansBlancsAuxBords(s.reference) === '' ? null : s.reference,
    unite: s.unite,
    prix_unitaire_ht: prix === 'illisible' ? null : prix,
    taux_tva: s.taux === '' ? null : Number(s.taux),
    nature: s.nature === '' ? null : s.nature,
  }
}

/**
 * Ce que l'enregistrement refuserait, dit avant le clic : le PREMIER refus du module sur la saisie envoyée — celui d'un
 * prix qui n'est pas un nombre passe avant le sien, car le module le lirait « absent ». `articles` : la liste LUE EN
 * ENTIER (l'unicité d'une référence s'y juge) ; l'écran n'offre rien sur une lecture partielle.
 */
export function refusDeLaSaisie(
  dossierId: string, cible: CibleArticle, saisie: SaisieArticle, articles: readonly ArticlePourReference[],
): { cle: CleRefusEnregistrementArticle | 'prix_illisible'; message: string } | null {
  const envoyee = saisieEnvoyee(saisie)
  const refus = refusEnregistrementArticle(dossierId, cible, envoyee, articles)
  // Les refus d'AVANT le prix (l'article, la désignation, la référence, l'unité) passent d'abord : même ordre que la base.
  if (refus != null && lirePrix(saisie.prix) === 'illisible' && refus.cle === 'prix_absent') {
    return { cle: 'prix_illisible', message: PRIX_ILLISIBLE }
  }
  return refus
}

// ── Ce que la liste montre ───────────────────────────────────────────────────────────────────────────────────────────
/**
 * Un prix, JAMAIS arrondi en silence : deux décimales au moins (« 12,50 € »), jusqu'à six quand l'article les porte
 * (« 0,123456 € ») — la base en admet six (G1.16), et deux seules afficheraient 0,12 € un prix qui en vaut 0,123456.
 */
export function formaterPrixArticle(prix: number): string {
  return prix.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

/** Ce que la recherche lit d'une ligne : la référence et la désignation (la conception, §A.1). */
export function champsDeRechercheArticle(a: Pick<Article, 'reference' | 'designation'>): (string | null)[] {
  return [a.reference, a.designation]
}

const ordre = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

/**
 * Les lignes affichées : sans le filtre « Retirés », les retirés ne se montrent pas ; avec lui, ils suivent les autres.
 * Par désignation, puis référence, puis identifiant — un ordre TOTAL, que l'écran ne change pas d'un rendu à l'autre.
 */
export function articlesAffiches(articles: readonly Article[], avecLesRetires: boolean): Article[] {
  return articles
    .filter((a) => avecLesRetires || a.retire_le == null)
    .sort((a, b) =>
      Number(a.retire_le != null) - Number(b.retire_le != null)
      || ordre.compare(a.designation, b.designation)
      || ordre.compare(a.reference ?? '', b.reference ?? '')
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ── Qui a fait quoi : « par le client » (cabinet seul) ───────────────────────────────────────────────────────────────
export const TITRES_ARTICLE_PAR_LE_CLIENT = {
  cree: 'Article créé par le client',
  modifie: 'Article modifié par le client',
  retire: 'Article retiré par le client',
} as const

export interface MentionParLeClient {
  libelle: string
  titre: string
}

/**
 * La mention d'une ligne : le DERNIER geste sur l'article — sa création, sa dernière modification (la reprise en est une)
 * ou son retrait, le plus récent des trois — est-il d'un compte qui porte un accès client du dossier ? Les accès doivent
 * être lus EN ENTIER (`estLeClient` ne reconnaît personne sinon) ; un auteur nul n'est personne, un accès retiré depuis
 * n'est pas deviné, et jamais « par le cabinet ».
 */
export function mentionParLeClient(
  acces: AccesDuDossier,
  a: Pick<Article, 'cree_par' | 'cree_le' | 'modifie_par' | 'modifie_le' | 'retire_par' | 'retire_le'>,
): MentionParLeClient | null {
  const gestes: { geste: keyof typeof TITRES_ARTICLE_PAR_LE_CLIENT; par: string | null; le: string | null }[] = [
    { geste: 'cree', par: a.cree_par, le: a.cree_le },
    { geste: 'modifie', par: a.modifie_par, le: a.modifie_le },
    { geste: 'retire', par: a.retire_par, le: a.retire_le },
  ]
  let dernier: (typeof gestes)[number] | null = null
  let instant = -Infinity
  for (const g of gestes) {
    if (g.le == null) continue
    const t = Date.parse(g.le)
    // À égalité, le geste qui vient plus loin dans la vie d'un article l'emporte (retirer suit modifier suit créer).
    if (Number.isNaN(t) || t < instant) continue
    dernier = g
    instant = t
  }
  if (dernier == null || !estLeClient(acces, dernier.par)) return null
  return { libelle: PAR_LE_CLIENT, titre: TITRES_ARTICLE_PAR_LE_CLIENT[dernier.geste] }
}

// ── Ce que chaque geste refuserait, dit avant le clic ────────────────────────────────────────────────────────────────
export interface GestesDeLArticle {
  // « Modifier » : ce que le module dit de l'article tel qu'il est lu (retiré : le reprendre d'abord).
  modifier: RefusArticle<CleRefusEnregistrementArticle> | null
  // Le geste d'état offert : « Retirer » sur un article en cours, « Reprendre » sur un retiré, jamais les deux.
  basculer:
    | { geste: 'retirer'; refus: RefusArticle<CleRefusRetraitArticle> | null }
    | { geste: 'reprendre'; refus: RefusArticle<CleRefusRepriseArticle> | null }
}

export function gestesDeLArticle(dossierId: string, article: Article, articles: readonly ArticlePourReference[]): GestesDeLArticle {
  return {
    modifier: refusEnregistrementArticle(
      dossierId, { nouveau: false, article }, saisieEnvoyee(saisieInitiale(article)), articles,
    ),
    basculer: article.retire_le == null
      ? { geste: 'retirer', refus: refusRetraitArticle(dossierId, article) }
      : { geste: 'reprendre', refus: refusRepriseArticle(dossierId, article) },
  }
}
