import { tauxCommeLaBase } from './encaissementsFactures'
import { TAUX_ADMIS } from './factureCii'
import { formaterPrixUnitaire } from './format'
import { ligneDepuisArticle, nomDansUnRefus, sansBlancsAuxBords } from './articles'
import {
  articlesAffiches, champsDeRechercheArticle, lirePrix, refusDeLaSaisie, saisieInitiale, type SaisieArticle,
} from './articlesVue'
import { correspondALaRecherche } from './recherche'
import type { ArticleExoneration, Article, StatutTva } from './types'

// UN ARTICLE DANS LE FORMULAIRE D'UNE FACTURE (espace client, étape A2b ; conception : HISTORIQUE.md, « L'ESPACE CLIENT,
// LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.1, « L'usage (étape A2) »). Un module PUR —
// rien lu, rien écrit, pas d'horloge — que `FactureFormModal` appelle : ce que le choix d'un article met sur une ligne et ce
// qu'il y remplace, la provenance d'une ligne, ce que « Mettre l'article à ce prix » et « Enregistrer comme article »
// enverraient.
//
// AUCUNE RÈGLE N'EST RECOPIÉE ICI. La ligne qu'un article pré-remplit est celle de `ligneDepuisArticle` (lib/articles.ts : le
// statut de TVA du jour, la mention, l'avertissement) ; les refus des deux gestes sont ceux de `refusDeLaSaisie` (le module
// des articles, dans l'ordre de la base, sous ses mots). Ce fichier ne dit que ce qu'un FORMULAIRE de texte ajoute : la ligne
// est faite de TEXTES de champ, et la provenance une mémoire d'écran que la ligne envoie depuis l'étape A7b (`article_id`).

/** Une ligne du formulaire, telle que ses champs la portent : des textes. */
export interface LigneEnSaisie {
  designation: string
  quantite: string
  prix_unitaire_ht: string
  taux_tva: string
}

// ── Ce que le choix d'un article met sur la ligne ────────────────────────────────────────────────────────────────────
export interface ChoixDArticle {
  /** Les quatre champs de la ligne, en texte : la désignation (description comprise), la quantité 1, le prix, le taux du jour. */
  ligne: LigneEnSaisie
  /** La mention de TVA que cette ligne demande à la facture — le formulaire la propose déjà (`mentionAbsente`), il ne l'écrit pas. */
  mention: string | null
  /** Ce qui empêche de proposer le bon taux ou la bonne mention, dit sur la ligne. */
  avertissement: string | null
}

/**
 * La ligne qu'un article pré-remplit, en texte de champ. Le prix s'écrit en notation décimale, sans exposant et sans
 * arrondi (`tauxCommeLaBase`, avec un point : un champ numérique n'a pas de virgule) : six décimales restent six décimales.
 */
export function choixDArticle(
  article: Pick<Article, 'designation' | 'description' | 'prix_unitaire_ht' | 'taux_tva'>,
  statut: StatutTva | null,
  articleExoneration: ArticleExoneration | null,
): ChoixDArticle {
  const { ligne, mention, avertissement } = ligneDepuisArticle(article, statut, articleExoneration)
  return {
    ligne: {
      designation: ligne.designation,
      quantite: tauxCommeLaBase(ligne.quantite).replace(',', '.'),
      prix_unitaire_ht: tauxCommeLaBase(ligne.prix_unitaire_ht).replace(',', '.'),
      taux_tva: tauxCommeLaBase(ligne.taux_tva).replace(',', '.'),
    },
    mention,
    avertissement,
  }
}

// Deux textes de champ numérique disent-ils le même nombre ? « 1 » et « 1.0 » oui ; un texte qui n'est pas un nombre, non.
const memeNombre = (a: string, b: string) => {
  const x = Number(a.trim())
  const y = Number(b.trim())
  return a.trim() !== '' && b.trim() !== '' && Number.isFinite(x) && Number.isFinite(y) && x === y
}

const dit = (texte: string) => `« ${nomDansUnRefus(texte.trim())} »`

/**
 * Ce que le choix REMPLACERAIT sur une ligne déjà saisie, en groupes nominaux (« la désignation « X » », « le prix 12,50 € »…),
 * dans l'ordre de la ligne. Une liste VIDE veut dire que le choix remplit directement : la ligne est vide (ni désignation, ni
 * prix, ni quantité que quelqu'un a tapée — le taux d'une ligne neuve est celui du statut, jamais une saisie), ou elle dit déjà
 * exactement ce que l'article apporte. Le taux n'est nommé que sur une ligne déjà saisie, et seulement s'il change.
 * Hypothèse A2B-Q1 (la consigne dit « une désignation ou un prix » ; la quantité tapée en fait partie, pour qu'une quantité
 * ne soit pas remplacée par 1 sans le dire).
 */
export function ceQueLeChoixRemplace(actuelle: LigneEnSaisie, apportee: LigneEnSaisie): string[] {
  const designationSaisie = sansBlancsAuxBords(actuelle.designation) !== ''
  const prixSaisi = actuelle.prix_unitaire_ht.trim() !== ''
  const quantiteSaisie = actuelle.quantite.trim() !== '' && !memeNombre(actuelle.quantite, '1')
  if (!designationSaisie && !prixSaisi && !quantiteSaisie) return []
  const remplace: string[] = []
  if (designationSaisie && sansBlancsAuxBords(actuelle.designation) !== sansBlancsAuxBords(apportee.designation)) {
    remplace.push(`la désignation ${dit(actuelle.designation)}`)
  }
  if (actuelle.quantite.trim() !== '' && !memeNombre(actuelle.quantite, apportee.quantite)) {
    remplace.push(`la quantité ${actuelle.quantite.trim()}`)
  }
  if (prixSaisi && !memeNombre(actuelle.prix_unitaire_ht, apportee.prix_unitaire_ht)) {
    const prix = lirePrix(actuelle.prix_unitaire_ht)
    remplace.push(`le prix ${typeof prix === 'number' ? formaterPrixUnitaire(prix) : dit(actuelle.prix_unitaire_ht)}`)
  }
  if (actuelle.taux_tva.trim() !== '' && !memeNombre(actuelle.taux_tva, apportee.taux_tva)) {
    remplace.push(`le taux ${actuelle.taux_tva.trim()} %`)
  }
  return remplace
}

/** « a », « a et b », « a, b et c » : ce que la confirmation nomme, en une phrase. */
export function enumeration(elements: readonly string[]): string {
  if (elements.length <= 1) return elements.join('')
  return `${elements.slice(0, -1).join(', ')} et ${elements[elements.length - 1]}`
}

/** Les articles qu'on peut choisir : jamais un retiré, dans l'ordre de la liste, filtrés par la recherche commune (référence, désignation). */
export function articlesAChoisir(articles: readonly Article[], recherche: string): Article[] {
  // Liée à un nom : le scanner des recherches (`recherchesEtTotaux.test.ts`) ne lit qu'un `const … = X.filter(…)`.
  const trouves = articlesAffiches(articles, false).filter((a) => correspondALaRecherche(champsDeRechercheArticle(a), recherche))
  return trouves
}

// ── La provenance : l'article qui a rempli la ligne ─────────────────────────────────────────────────────────────────────
// Depuis l'étape A7b (`MENTIONS_FIGEES_EXPORTEES`), elle part avec la ligne (`facture_lignes.article_id`), et une facture rouverte
// retrouve celle de ses lignes ; drapeau baissé, elle n'est qu'en mémoire. La clé est celle de la ligne DANS LE FORMULAIRE
// (stable tant qu'elle existe), la valeur l'identifiant de l'article.
export type Provenance = Readonly<Record<string, string>>

/** La ligne `cle` vient de l'article `articleId` : elle remplace une provenance qu'elle avait. */
export function avecProvenance(provenance: Provenance, cle: string, articleId: string): Provenance {
  return { ...provenance, [cle]: articleId }
}

/**
 * Ne garde que la provenance des lignes qui existent encore : une ligne retirée perd la sienne, et sa clé ne revient jamais.
 * Rend la MÊME valeur quand il n'y a rien à retirer (un état React inchangé ne rend pas).
 */
export function garderProvenance(provenance: Provenance, cles: readonly string[]): Provenance {
  const gardees = Object.keys(provenance).filter((cle) => cles.includes(cle))
  return gardees.length === Object.keys(provenance).length ? provenance : Object.fromEntries(gardees.map((cle) => [cle, provenance[cle]]))
}

// ── « Mettre l'article à ce prix » ────────────────────────────────────────────────────────────────────────────────────
export type GestePrixDeLArticle =
  // Rien à offrir : le prix de la ligne est celui de l'article tel qu'il a été lu.
  | { etat: 'sans_objet' }
  // Le geste s'offre ; `refus` est ce que la base refuserait, dit avant le clic (le premier, dans son ordre) ; `saisie` ce qui part :
  // TOUS les champs de l'article tel qu'il a été lu, le prix de la ligne seul changé.
  | { etat: 'offert'; refus: string | null; saisie: SaisieArticle; ancien: number | null; nouveau: number | null }

/**
 * `article` : l'article de la provenance TEL QUE LA LISTE LUE EN ENTIER LE PORTE — nul quand la liste ne l'a pas (le module dit
 * alors « introuvable »). `prixDeLaLigne` : le texte du champ. Un prix que le champ ne dit pas (vide, illisible) diffère de celui
 * de l'article : le geste s'offre et se grise sous le refus du module. Ni la désignation ni le taux de la ligne ne partent.
 */
export function gestePrixDeLArticle(
  dossierId: string, article: Article | null, prixDeLaLigne: string, articles: readonly Article[],
): GestePrixDeLArticle {
  const prix = lirePrix(prixDeLaLigne)
  if (article != null && typeof prix === 'number' && prix === article.prix_unitaire_ht) return { etat: 'sans_objet' }
  const saisie: SaisieArticle = { ...saisieInitiale(article), prix: prixDeLaLigne }
  const refus = refusDeLaSaisie(dossierId, { nouveau: false, article }, saisie, articles)
  return {
    etat: 'offert', refus: refus?.message ?? null, saisie,
    ancien: article?.prix_unitaire_ht ?? null, nouveau: typeof prix === 'number' ? prix : null,
  }
}

// ── « Enregistrer comme article » ─────────────────────────────────────────────────────────────────────────────────────
/** Une ligne saisie à la main qui porte une désignation peut devenir un article. */
export function peutEnregistrerCommeArticle(ligne: LigneEnSaisie): boolean {
  return sansBlancsAuxBords(ligne.designation) !== ''
}

/**
 * La saisie de départ d'un article neuf tiré d'une ligne : la désignation de la ligne ; son prix, lu par `lirePrix` et jamais
 * arrondi (un texte que l'écran ne lit pas fidèlement reste tel quel, et le module le dit « illisible ») ; son taux SEULEMENT
 * quand le dossier est redevable — le taux d'un article est celui de l'opération d'un dossier redevable, alors que la ligne
 * d'une franchise ou d'un exonéré est à 0 % du seul fait du statut, et en ferait un article à 0 % que le dossier, redevenu
 * redevable, ne devrait pas facturer ainsi (hypothèse A2B-Q3) ; l'unité générique ; la nature à choisir ; aucune référence.
 */
export function saisieDeLaLigne(ligne: LigneEnSaisie, statut: StatutTva | null): SaisieArticle {
  const prix = lirePrix(ligne.prix_unitaire_ht)
  const taux = Number(ligne.taux_tva.trim())
  return {
    // L'unité générique, la référence et la description vides, la nature à choisir : la saisie d'un article neuf.
    ...saisieInitiale(null),
    designation: ligne.designation,
    prix: prix === 'illisible' ? ligne.prix_unitaire_ht.trim() : prix === null ? '' : tauxCommeLaBase(prix),
    taux: statut === 'redevable' && ligne.taux_tva.trim() !== '' && TAUX_ADMIS.includes(taux) ? String(taux) : '',
  }
}
