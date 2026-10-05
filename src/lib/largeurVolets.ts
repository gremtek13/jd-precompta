// LA LARGEUR DES DEUX VOLETS DE LA COQUE, choisie par l'opérateur (demande du cabinet, 05/10/2026) : la barre
// latérale et le panneau de droite se redimensionnent en glissant leur bord (voir PoigneeRedimensionnement). Une
// préférence d'affichage de ce navigateur, pas un champ en base — même statut que le thème et la barre réduite.
//
// UNE CONTRAINTE DÉCIDE DE TOUTES LES BORNES : le panneau central garde au moins `LARGEUR_MIN_CENTRE`, la plus étroite
// que les écrans aient été vérifiés à tenir sans rien faire déborder (`outils/captures/debordements.mjs`) ; élargir un
// volet au-delà rognerait le travail en dessous de ce qui a été éprouvé. Elle vaut tant que le volet de droite est À
// CÔTÉ du panneau central, c'est-à-dire à 1 280 pixels et plus ; en dessous il se pose PAR-DESSUS (voir index.css), et
// ne retire rien au panneau central.
//
// Tout se calcule ici, dans les deux sens : la largeur affichée est celle que l'opérateur a choisie, ramenée aux bornes
// de la fenêtre d'AUJOURD'HUI. Rétrécir la fenêtre rétrécit les volets ; l'agrandir leur rend la largeur choisie, qui
// reste retenue. L'écran ne mesure rien : une largeur tirée du rendu ne se testerait pas, et ferait dépendre la borne
// de l'instant où on la lit.

export const LARGEUR_BARRE = { defaut: 264, min: 200, max: 420 } as const
// La barre réduite à ses icônes (index.css, `.barre-reduite`) : elle ne se redimensionne pas.
export const LARGEUR_BARRE_REDUITE = 68
// Le volet de droite ne descend pas sous sa plus petite largeur d'origine (340 pixels, le bas du `clamp` d'index.css) :
// les contenus qui l'occupent — l'assistant, la fiche d'une pièce, le rapprochement d'un mouvement — n'ont pas été
// vérifiés plus étroits.
export const LARGEUR_PANNEAU = { min: 340, max: 760 } as const
// 560 PIXELS, ET NON PLUS 640 (05/10/2026). La borne était la largeur du panneau central sur un écran de 1 280 pixels aux
// largeurs d'origine (1 280 − 264 − 8 − 358 − 8 = 642) : elle y laissait au volet de droite 2 pixels à gagner et à la
// barre 20, si bien qu'à cette largeur — un portable de 1 920 pixels affiché à 150 % — les poignées ne servaient
// presque à rien. Les écrans ont été revérifiés à 560 (débordements, cartes et texte compris) : une fois la grille des
// tableaux de bord adaptée à sa place, rien n'y déborde. À 480, la liste des pièces ne montrait plus le statut, la
// colonne qui compte quand on valide à la chaîne. À 1 280 pixels, le volet va désormais jusqu'à 440 et la barre
// jusqu'à 364.
export const LARGEUR_MIN_CENTRE = 560
// Les marges de la coque : 8 pixels à droite du panneau central, 8 à droite du volet.
const MARGES_EN_LIGNE = 16
// Au-dessous de ce seuil, la coque est celle du téléphone ; à partir du second, le volet de droite est en ligne.
export const SEUIL_ORDINATEUR = 721
export const SEUIL_VOLET_EN_LIGNE = 1280
// Ce que le volet superposé, à sa largeur d'origine, laisse voir de la fenêtre à sa gauche (index.css,
// `calc(100vw - 96px)`).
const MARGE_VOLET_SUPERPOSE = 96
// Élargi, le volet superposé laisse voir au moins cette largeur du panneau central : de quoi garder sous les yeux la
// liste dont il ouvre une ligne — la fiche d'une pièce se parcourt en cliquant la suivante.
export const LARGEUR_VISIBLE_SOUS_VOLET = 320

export interface Bornes { min: number; max: number }

function borner(valeur: number, { min, max }: Bornes): number {
  return Math.min(max, Math.max(min, Math.round(valeur)))
}

// La barre latérale déployée. En ligne, elle laisse au panneau central sa largeur minimale même volet de droite ouvert
// à sa plus petite largeur — sans quoi élargir la barre ferait déborder un écran qu'aucun clic sur le volet ne
// réparerait. Superposé, le volet ne compte pas. Jamais moins que la largeur d'origine : sur une fenêtre trop étroite
// pour tout tenir, la barre garde la largeur qu'elle avait avant qu'on puisse la choisir.
export function bornesBarre(fenetre: number): Bornes {
  const place = fenetre >= SEUIL_VOLET_EN_LIGNE
    ? fenetre - MARGES_EN_LIGNE - LARGEUR_MIN_CENTRE - LARGEUR_PANNEAU.min
    : fenetre - MARGES_EN_LIGNE / 2 - LARGEUR_MIN_CENTRE
  return { min: LARGEUR_BARRE.min, max: Math.min(LARGEUR_BARRE.max, Math.max(LARGEUR_BARRE.defaut, place)) }
}

// La largeur de la barre déployée : celle que l'opérateur a choisie, sinon celle d'origine, dans les bornes de la fenêtre.
export function largeurBarre(voulue: number | null, fenetre: number): number {
  return borner(voulue ?? LARGEUR_BARRE.defaut, bornesBarre(fenetre))
}

// La largeur d'origine du volet de droite — la même qu'index.css : `clamp(340px, 28vw, 440px)` en ligne,
// `min(420px, 100vw - 96px)` superposé.
export function largeurPanneauParDefaut(fenetre: number): number {
  return fenetre >= SEUIL_VOLET_EN_LIGNE
    ? Math.min(440, Math.max(340, Math.round(fenetre * 0.28)))
    : Math.min(420, fenetre - MARGE_VOLET_SUPERPOSE)
}

// Le volet de droite, compte tenu de la barre telle qu'elle est affichée (réduite comprise). En ligne, il s'arrête où le
// panneau central atteindrait sa largeur minimale. Superposé, il ne retire rien au panneau central mais le recouvre :
// il en laisse voir `LARGEUR_VISIBLE_SOUS_VOLET` pixels — sans jamais interdire sa largeur d'origine, qui sur une
// fenêtre étroite en laisse moins, et que les écrans ont toujours eue.
export function bornesPanneau(fenetre: number, barre: number): Bornes {
  if (fenetre >= SEUIL_VOLET_EN_LIGNE) {
    const place = fenetre - barre - MARGES_EN_LIGNE - LARGEUR_MIN_CENTRE
    return { min: LARGEUR_PANNEAU.min, max: Math.max(LARGEUR_PANNEAU.min, Math.min(LARGEUR_PANNEAU.max, place)) }
  }
  const place = fenetre - barre - MARGES_EN_LIGNE / 2 - LARGEUR_VISIBLE_SOUS_VOLET
  return { min: LARGEUR_PANNEAU.min, max: Math.max(largeurPanneauParDefaut(fenetre), Math.min(LARGEUR_PANNEAU.max, place)) }
}

export function largeurPanneau(voulue: number | null, fenetre: number, barre: number): number {
  return borner(voulue ?? largeurPanneauParDefaut(fenetre), bornesPanneau(fenetre, barre))
}

// ── La préférence retenue par ce navigateur ─────────────────────────────────────────────────────────────────────
export const CLE_LARGEUR_BARRE = 'jd-precompta-largeur-barre'
export const CLE_LARGEUR_PANNEAU = 'jd-precompta-largeur-panneau'

// Une valeur qu'on ne reconnaît pas — modifiée à la main, écrite par une version qui avait d'autres bornes — est
// ignorée : la largeur d'origine vaut mieux qu'un volet de 3 pixels qu'on ne peut plus attraper.
export function lireLargeur(cle: string, bornes: Bornes): number | null {
  try {
    const brute = localStorage.getItem(cle)
    if (brute === null || !/^\d+$/.test(brute)) return null
    const valeur = Number(brute)
    return valeur >= bornes.min && valeur <= bornes.max ? valeur : null
  } catch {
    // Stockage indisponible (navigation privée, réglages du navigateur) : la largeur d'origine.
    return null
  }
}

export function retenirLargeur(cle: string, largeur: number | null): void {
  try {
    if (largeur === null) localStorage.removeItem(cle)
    else localStorage.setItem(cle, String(Math.round(largeur)))
  } catch {
    // Préférence non retenue : elle vaut pour cette visite, rien de plus.
  }
}
