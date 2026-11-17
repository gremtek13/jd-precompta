import { TAILLE_MONTANT, formaterMontant, texteCompatiblePdf } from './gabarit2035'
import type { FragmentTexte, Inscription, PageFormulaire } from './gabarit2035'
import type { Cadre7ARemplir, MontantDuCadre7 } from './cadre7'
import { MOTS_A_SAISIR_DU_PDF } from './saisies2035E'

// OÙ S'ÉCRIT LE CADRE 7 DE LA 2035-B (17/11/2026). Comme le reste du gabarit (lib/gabarit2035.ts), rien n'est codé en dur :
// tout se lit sur la page vierge.
//   - LES COLONNES : chacune par son libellé d'en-tête (« Modèle(s) », « Type », « Puissance fiscale », « Barème BNC (2) »…),
//     bornée par les deux filets verticaux qui encadrent le DÉBUT de ce libellé à la hauteur des lignes de véhicules. Le
//     début, et non le milieu : « Barème BNC (2) » et « Barème BIC (2) » sont imprimés à la verticale, et pdf.js rend leur
//     longueur comme une largeur — leur milieu tomberait dans la colonne voisine.
//   - LES LIGNES DE VÉHICULES : entre les filets horizontaux qui courent sur toute la largeur du tableau, sous l'en-tête et
//     au-dessus de la ligne « Frais réels non couverts par les barèmes kilométriques ». Le millésime 2026 en trace deux.
//   - LES TOTAUX : la cellule qui suit la lettre « A » (puis « B ») imprimée sous la ligne des frais réels, par la règle des
//     codes de case — le premier filet à droite ferme la cellule de la lettre, le second celle du montant.
// Un seul de ces repères qui manque, ou des colonnes qui se chevauchent : rien ne s'écrit dans le cadre (`repere: false`),
// et l'écran le dit. Un montant au jugé dans la mauvaise colonne serait pire qu'un cadre vide, qui se voit.

type Colonne = 'modele' | 'type' | 'puissance' | 'bnc' | 'bic' | 'motorisation' | 'carburant' | 'kilometres' | 'indemnites'
  | 'amortissements'

const LIBELLES: readonly (readonly [Colonne, string])[] = [
  ['modele', 'Modèle(s)'],
  ['type', 'Type'],
  ['puissance', 'Puissance fiscale'],
  ['bnc', 'Barème BNC (2)'],
  ['bic', 'Barème BIC (2)'],
  ['motorisation', 'Motorisation'],
  ['carburant', 'carburant'],
  ['kilometres', 'Kilométrage'],
  ['indemnites', 'Indemnités'],
  ['amortissements', 'Amortissements'],
]

const LIBELLE_FRAIS_REELS = 'Frais réels non couverts par les barèmes kilométriques'

// L'en-tête du tableau tient dans les 100 points au-dessus de la ligne des frais réels (60 sur le millésime 2026) : un
// libellé homonyme ailleurs sur la page ne s'y confond pas.
const HAUTEUR_MAXIMALE_DU_TABLEAU = 100

// La taille des lignes de véhicules : un point de moins que les montants des cases, la plus étroite des colonnes (le type)
// faisant 25 points. Un texte trop long se réduit jusqu'à la plus petite taille lisible, puis se coupe sur « … ».
const TAILLE_LIGNE = 8
const TAILLE_MINIMALE = 5.5
const PAS_DE_TAILLE = 0.5
// Ce qui sépare un texte des filets de sa cellule, de chaque côté.
const MARGE = 3
// La hauteur des capitales d'Helvetica, en part de la taille : un texte se centre dans sa ligne sur elles.
const HAUTEUR_DES_CAPITALES = 0.718
// Le retrait d'un total dans sa case, celui des montants des cases (lib/gabarit2035.ts).
const RETRAIT_DROITE = 4
const CROIX = 'X'

export interface Bornes { gauche: number; droite: number }
export interface LigneDuTableau { haut: number; bas: number }
export interface CaseDeTotal extends Bornes { y: number }

export interface GeometrieDuCadre7 {
  colonnes: Record<Colonne, Bornes>
  // De haut en bas, dans l'ordre où le cadre se remplit.
  lignes: LigneDuTableau[]
  totalA: CaseDeTotal
  totalB: CaseDeTotal
}

function seul(page: PageFormulaire, texte: string, accepte: (f: FragmentTexte) => boolean): FragmentTexte | null {
  const trouves = page.fragments.filter((f) => f.texte.trim() === texte && accepte(f))
  return trouves.length === 1 ? trouves[0] : null
}

// La cellule qui suit une lettre de total : le second filet vertical à sa droite, à la hauteur de la lettre.
function caseDeTotal(page: PageFormulaire, lettre: FragmentTexte): CaseDeTotal | null {
  const centre = lettre.y + lettre.hauteur / 2
  const aDroite = page.filets
    .filter((f) => f.x > lettre.x + lettre.largeur + 1 && f.y0 < centre && f.y1 > centre)
    .sort((a, b) => a.x - b.x)
  if (aDroite.length < 2 || aDroite[1].x - aDroite[0].x < 10) return null
  return { gauche: aDroite[0].x, droite: aDroite[1].x, y: lettre.y }
}

export function geometrieDuCadre7(page: PageFormulaire): GeometrieDuCadre7 | null {
  const horizontaux = page.filetsHorizontaux ?? []
  const frais = page.fragments.filter((f) => f.texte.trim().startsWith(LIBELLE_FRAIS_REELS))
  if (frais.length !== 1 || horizontaux.length === 0) return null
  const ligneFrais = frais[0]
  const centreFrais = ligneFrais.y + ligneFrais.hauteur / 2
  // Les filets de la ligne des frais réels : ceux qui partent du bord gauche du cadre, juste au-dessus et juste au-dessous.
  const depuisLaGauche = horizontaux.filter((h) => h.x0 <= ligneFrais.x + 1 && h.x1 > ligneFrais.x + ligneFrais.largeur)
  const dessus = depuisLaGauche.filter((h) => h.y > centreFrais).map((h) => h.y)
  const dessous = depuisLaGauche.filter((h) => h.y < centreFrais).map((h) => h.y)
  if (dessus.length === 0 || dessous.length === 0) return null
  const hautDesFrais = Math.min(...dessus)
  const basDesFrais = Math.max(...dessous)

  // Les colonnes, à la hauteur de la dernière ligne de véhicule (3 points au-dessus de la ligne des frais réels).
  const sonde = hautDesFrais + 3
  const verticaux = page.filets.filter((f) => f.y0 < sonde && f.y1 > sonde)
  const colonnes = {} as Record<Colonne, Bornes>
  const libelles: FragmentTexte[] = []
  for (const [colonne, texte] of LIBELLES) {
    const libelle = seul(page, texte, (f) => f.y > hautDesFrais && f.y < hautDesFrais + HAUTEUR_MAXIMALE_DU_TABLEAU)
    if (!libelle) return null
    libelles.push(libelle)
    const x = libelle.x + 1
    const gauches = verticaux.filter((f) => f.x < x).map((f) => f.x)
    const droites = verticaux.filter((f) => f.x > x).map((f) => f.x)
    if (gauches.length === 0 || droites.length === 0) return null
    const bornes = { gauche: Math.max(...gauches), droite: Math.min(...droites) }
    if (bornes.droite - bornes.gauche < 10) return null
    colonnes[colonne] = bornes
  }
  // Dans l'ordre du formulaire, sans chevauchement : sinon deux libellés partagent une colonne, et le repérage a dérapé.
  for (let i = 1; i < LIBELLES.length; i++) {
    if (colonnes[LIBELLES[i][0]].gauche < colonnes[LIBELLES[i - 1][0]].droite - 0.5) return null
  }

  // Les lignes : les filets qui courent sur tout le tableau, de la ligne des frais réels jusque sous le plus bas des libellés.
  const gaucheDuTableau = colonnes.modele.gauche
  const droiteDuTableau = colonnes.amortissements.droite
  const sousLEnTete = Math.min(...libelles.map((l) => l.y))
  const traverses = [...new Set(horizontaux
    .filter((h) => h.x0 <= gaucheDuTableau + 2 && h.x1 >= droiteDuTableau - 2 && h.y > hautDesFrais - 0.5 && h.y < sousLEnTete)
    .map((h) => Math.round(h.y * 10) / 10))].sort((a, b) => b - a)
  const lignes: LigneDuTableau[] = []
  for (let i = 0; i + 1 < traverses.length; i++) lignes.push({ haut: traverses[i], bas: traverses[i + 1] })
  if (lignes.length === 0 || lignes.some((l) => l.haut - l.bas < 8 || l.haut - l.bas > 30)) return null

  const sousLesFrais = (f: FragmentTexte) => f.y < basDesFrais && f.y > basDesFrais - 30
  const lettreA = seul(page, 'A', sousLesFrais)
  const lettreB = seul(page, 'B', sousLesFrais)
  const totalA = lettreA ? caseDeTotal(page, lettreA) : null
  const totalB = lettreB ? caseDeTotal(page, lettreB) : null
  if (!totalA || !totalB) return null

  return { colonnes, lignes, totalA, totalB }
}

export interface PlanDuCadre7 {
  inscriptions: Inscription[]
  // « À saisir », dessiné en rouge par remplir2035.ts, comme sur l'annexe 2035-E.
  aSaisir: Inscription[]
  // Les véhicules qui n'ont pas trouvé de ligne : au-delà des lignes que le formulaire offre — rien ne se tasse —, ou tous
  // quand le cadre n'a pas été repéré. Dits à l'écran, comme une case sans ancrage.
  vehiculesSansLigne: string[]
  repere: boolean
}

// La largeur d'un texte à une taille, dans la police du dessin (pdf-lib, `widthOfTextAtSize`) : passée par l'appelant,
// pour que ce module reste sans bibliothèque PDF.
export type Mesure = (texte: string, taille: number) => number

// Le texte et la taille qui tiennent dans une largeur : la taille des lignes, réduite par demi-point jusqu'à la plus petite
// lisible, puis le texte coupé sur « … ». Jamais un texte qui déborde sur le filet.
export function ajuster(texte: string, largeur: number, taille: number, mesurer: Mesure): { texte: string; taille: number } {
  for (let t = taille; t >= TAILLE_MINIMALE; t -= PAS_DE_TAILLE) {
    if (mesurer(texte, t) <= largeur) return { texte, taille: t }
  }
  let coupe = texte
  while (coupe.length > 0 && mesurer(`${coupe}…`, TAILLE_MINIMALE) > largeur) coupe = coupe.slice(0, -1)
  return { texte: coupe.length > 0 ? `${coupe.trimEnd()}…` : '', taille: TAILLE_MINIMALE }
}

export function planDuCadre7(
  page: PageFormulaire,
  numeroDePage: number,
  cadre: Cadre7ARemplir,
  mesurer: Mesure,
): PlanDuCadre7 {
  const inscriptions: Inscription[] = []
  const aSaisir: Inscription[] = []
  const geometrie = geometrieDuCadre7(page)
  if (!geometrie) return { inscriptions, aSaisir, vehiculesSansLigne: cadre.lignes.map((l) => l.nom), repere: false }

  const cellule = (
    vers: Inscription[], bornes: Bornes, ligne: LigneDuTableau, texte: string, alignement: Inscription['alignement'],
  ) => {
    const ajuste = ajuster(texte, bornes.droite - bornes.gauche - 2 * MARGE, TAILLE_LIGNE, mesurer)
    if (ajuste.texte === '') return
    const x = alignement === 'gauche' ? bornes.gauche + MARGE
      : alignement === 'droite' ? bornes.droite - MARGE
      : (bornes.gauche + bornes.droite) / 2
    const y = ligne.bas + (ligne.haut - ligne.bas - HAUTEUR_DES_CAPITALES * ajuste.taille) / 2
    vers.push({ page: numeroDePage, texte: ajuste.texte, x, y, alignement, taille: ajuste.taille })
  }
  const montant = (bornes: Bornes, ligne: LigneDuTableau, valeur: MontantDuCadre7) => {
    if (valeur === null) return
    if (valeur === 'a_saisir') cellule(aSaisir, bornes, ligne, MOTS_A_SAISIR_DU_PDF, 'droite')
    else cellule(inscriptions, bornes, ligne, formaterMontant(valeur), 'droite')
  }

  const { colonnes: c } = geometrie
  const vehiculesSansLigne: string[] = []
  cadre.lignes.forEach((l, i) => {
    const ligne = geometrie.lignes[i]
    if (!ligne) {
      vehiculesSansLigne.push(l.nom)
      return
    }
    if (l.modele) cellule(inscriptions, c.modele, ligne, texteCompatiblePdf(l.modele), 'gauche')
    cellule(inscriptions, c.type, ligne, l.type, 'centre')
    if (l.puissanceFiscale !== null) cellule(inscriptions, c.puissance, ligne, `${l.puissanceFiscale} CV`, 'centre')
    cellule(inscriptions, l.bareme === 'bnc' ? c.bnc : c.bic, ligne, CROIX, 'centre')
    if (l.motorisation) cellule(inscriptions, c.motorisation, ligne, l.motorisation, 'gauche')
    if (l.carburant) cellule(inscriptions, c.carburant, ligne, l.carburant, 'gauche')
    cellule(inscriptions, c.kilometres, ligne, formaterMontant(l.kilometres), 'droite')
    montant(c.indemnites, ligne, l.indemnite)
    montant(c.amortissements, ligne, l.amortissements)
  })

  const total = (vers: Inscription[], caseDuTotal: CaseDeTotal, texte: string) => {
    vers.push({
      page: numeroDePage, texte, x: caseDuTotal.droite - RETRAIT_DROITE, y: caseDuTotal.y, alignement: 'droite',
      taille: TAILLE_MONTANT,
    })
  }
  if (typeof cadre.totalA === 'number') total(inscriptions, geometrie.totalA, formaterMontant(cadre.totalA))
  else if (cadre.totalA === 'a_saisir') total(aSaisir, geometrie.totalA, MOTS_A_SAISIR_DU_PDF)
  if (typeof cadre.totalB === 'number') total(inscriptions, geometrie.totalB, formaterMontant(cadre.totalB))
  else if (cadre.totalB === 'a_saisir') total(aSaisir, geometrie.totalB, MOTS_A_SAISIR_DU_PDF)

  return { inscriptions, aSaisir, vehiculesSansLigne, repere: true }
}

// ═══ La ligne 23 de la 2035-A (CADRE7-Q4 (A), réponse du cabinet du 17/11/2026) ═══════════════════════════════════════
//
// La notice 2035-NOT-SD 2026, renvoi (12) : l'option pour le barème « est concrétisée en cochant la case figurant en
// ligne 23 ». Le cadre 7 dit « Total A à reporter ligne 23 ». La page 1 imprime, sous « 23 Frais de véhicules (12) », le
// libellé « (cocher la case si évaluation forfaitaire) », puis à sa droite la case à cocher et la cellule du montant de la
// ligne 23 — chacune entre deux filets verticaux qui traversent ce libellé (les deux premiers : la case ; les deux suivants :
// la cellule). La case BJ, plus à droite, regroupe les lignes 23 et 24 et reste remplie par les codes de case.
//
// La croix dès qu'un cadre 7 existe (un véhicule au barème : l'option est prise, quel que soit son montant) ; le montant,
// le total A tel que le cadre le porte — un nombre, « à saisir » en rouge, ou rien (l'écart avec une 2035 validée).
// Les péages et le stationnement, frais de déplacement (CADRE7-Q1), n'y entrent pas.

const LIBELLE_DE_LA_CASE_23 = '(cocher la case si évaluation forfaitaire)'

export interface GeometrieDeLaLigne23 {
  caseACocher: Bornes
  montant: Bornes
  // La ligne de base du libellé : la croix et le montant s'y posent.
  y: number
}

export function geometrieDeLaLigne23(page: PageFormulaire): GeometrieDeLaLigne23 | null {
  const libelle = seul(page, LIBELLE_DE_LA_CASE_23, () => true)
  if (!libelle) return null
  const centre = libelle.y + libelle.hauteur / 2
  const xs = [...new Set(page.filets
    .filter((f) => f.x > libelle.x + libelle.largeur && f.y0 < centre && f.y1 > centre)
    .map((f) => Math.round(f.x * 10) / 10))].sort((a, b) => a - b)
  if (xs.length < 4) return null
  const caseACocher = { gauche: xs[0], droite: xs[1] }
  const montant = { gauche: xs[2], droite: xs[3] }
  // Une case à cocher a la largeur d'une case (une vingtaine de points), la cellule celle d'un montant : sinon le repérage a dérapé.
  const largeurCase = caseACocher.droite - caseACocher.gauche
  if (largeurCase < 8 || largeurCase > 30 || montant.droite - montant.gauche < 40) return null
  return { caseACocher, montant, y: libelle.y }
}

export interface PlanDeLaLigne23 {
  inscriptions: Inscription[]
  aSaisir: Inscription[]
  // Faux : la case ou la cellule n'ont pas été retrouvées sur la page, rien n'est écrit et l'écran le dit.
  repere: boolean
}

export function planDeLaLigne23(page: PageFormulaire, numeroDePage: number, cadre: Cadre7ARemplir): PlanDeLaLigne23 {
  const inscriptions: Inscription[] = []
  const aSaisir: Inscription[] = []
  const g = geometrieDeLaLigne23(page)
  if (!g) return { inscriptions, aSaisir, repere: false }
  inscriptions.push({
    page: numeroDePage, texte: CROIX, x: (g.caseACocher.gauche + g.caseACocher.droite) / 2, y: g.y, alignement: 'centre',
    taille: TAILLE_MONTANT,
  })
  const x = g.montant.droite - RETRAIT_DROITE
  if (typeof cadre.totalA === 'number') {
    if (cadre.totalA !== 0) {
      inscriptions.push({ page: numeroDePage, texte: formaterMontant(cadre.totalA), x, y: g.y, alignement: 'droite', taille: TAILLE_MONTANT })
    }
  } else if (cadre.totalA === 'a_saisir') {
    aSaisir.push({ page: numeroDePage, texte: MOTS_A_SAISIR_DU_PDF, x, y: g.y, alignement: 'droite', taille: TAILLE_MONTANT })
  }
  return { inscriptions, aSaisir, repere: true }
}
