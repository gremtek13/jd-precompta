import { libelleDeLOnglet, ongletsValides, type DossierTab } from './ongletsDossier'

// LE BOUTON « RETOUR » DE LA COQUE (demande du cabinet du 16/11/2026) : ramener à l'onglet ou à l'écran d'avant, DANS
// l'application. L'application installée (PWA) n'a pas de bouton retour du navigateur, d'où ce bouton.
//
// Pourquoi tenir un historique à soi plutôt que lire `history.length` : le navigateur compte aussi ce qui PRÉCÈDE
// l'application (la page d'où l'on vient, la banque, l'e-mail du mot de passe oublié). Un retour fondé sur lui ferait
// sortir de l'application, ou ramènerait à une adresse de retour déjà servie. On ne retient donc que les emplacements
// VISITÉS depuis que la coque est montée, chacun sous la clé que le routeur donne à son entrée d'historique : le
// bouton ne recule que vers une entrée qu'on y a vue, par le même `navigate(-n)` que le navigateur, et un retour par le
// navigateur se lit comme le nôtre (un POP vers une clé connue).
//
// Pur : la coque (components/Layout.tsx) lui passe ce que `useLocation` et `useNavigationType` disent à chaque rendu.

/** Le type de navigation, tel que `useNavigationType` le rend. */
export type TypeDeNavigation = 'POP' | 'PUSH' | 'REPLACE'

/** Une entrée de l'historique du navigateur vue par la coque : la clé du routeur, et le chemin (avec sa requête). */
export interface Emplacement {
  readonly cle: string
  readonly chemin: string
}

/**
 * Les entrées vues, dans l'ordre du navigateur, et celle où l'on se trouve. Les entrées APRÈS la position sont celles
 * qu'un retour a laissées derrière lui : un « suivant » du navigateur y revient sans perdre ce qui précède.
 */
export interface HistoriqueNavigation {
  readonly entrees: readonly Emplacement[]
  readonly position: number
}

export const HISTORIQUE_VIDE: HistoriqueNavigation = { entrees: [], position: -1 }

/**
 * Note la navigation qui a mené à `emplacement`. Le même emplacement revu (un second rendu, la même clé) ne change
 * rien. Le premier vu ouvre l'historique, quel que soit son type : rien avant lui n'est connu.
 */
export function noterNavigation(
  historique: HistoriqueNavigation,
  type: TypeDeNavigation,
  emplacement: Emplacement,
): HistoriqueNavigation {
  const { entrees, position } = historique
  if (position < 0) return { entrees: [emplacement], position: 0 }
  if (memeEmplacement(entrees[position], emplacement)) return historique
  if (type === 'PUSH') return { entrees: [...entrees.slice(0, position + 1), emplacement], position: position + 1 }
  // Une redirection (`<Navigate replace>`, le retour de la banque, l'onglet par défaut d'un dossier) remplace l'entrée
  // où l'on était, comme dans le navigateur : elle n'empile rien, et ce qui la suivait reste.
  if (type === 'REPLACE') {
    return { entrees: entrees.map((e, i) => (i === position ? emplacement : e)), position }
  }
  // POP : le navigateur a reculé ou avancé. Vers une entrée vue, on s'y place. Vers une entrée inconnue — d'avant le
  // montage de la coque, par exemple après un rechargement de la page —, rien de ce qui l'entoure n'est connu : on
  // repart d'elle seule, et le bouton disparaît plutôt que de mener là où l'on ne sait pas.
  // Une adresse tapée à la main n'a pas d'état : le routeur lui donne la clé « default », celle de la toute première
  // entrée. Retrouvée sous cette clé, l'entrée prend le chemin qu'on voit — c'est lui que le navigateur y a posé.
  const vue = entrees.findIndex((e) => e.cle === emplacement.cle)
  if (vue >= 0) return { entrees: entrees.map((e, i) => (i === vue ? emplacement : e)), position: vue }
  return { entrees: [emplacement], position: 0 }
}

/** La même entrée, au même chemin : rien n'a changé depuis le dernier rendu. */
export function memeEmplacement(a: Emplacement | undefined, b: Emplacement): boolean {
  return a !== undefined && a.cle === b.cle && a.chemin === b.chemin
}

// Les chemins vers lesquels on ne revient jamais : le retour de la banque rejouerait un code d'accord déjà servi. Un
// fragment qui ne commence pas par « / » n'est pas une route mais le retour d'un lien d'authentification (lib/
// recuperationMotDePasse.ts, `lireRetourDuLien`).
const CHEMINS_SANS_RETOUR = new Set(['/retour-banque'])

function cheminSansRequete(chemin: string): string {
  const coupure = chemin.indexOf('?')
  return coupure < 0 ? chemin : chemin.slice(0, coupure)
}

export function cheminRevenable(chemin: string): boolean {
  return chemin.startsWith('/') && !CHEMINS_SANS_RETOUR.has(cheminSansRequete(chemin))
}

/** Où mène « Retour » : le chemin, et de combien d'entrées reculer (`navigate(-pas)`). */
export interface Retour {
  readonly chemin: string
  readonly pas: number
}

/**
 * L'emplacement d'avant : la plus proche entrée vue AVANT la position dont le chemin diffère de l'emplacement affiché
 * — rouvrir le même écran ne fait pas un retour de plus. `null` quand il n'y en a pas, ou que cette entrée est un
 * chemin sans retour : le bouton ne s'affiche pas.
 */
export function retourPossible(historique: HistoriqueNavigation): Retour | null {
  const { entrees, position } = historique
  if (position < 1) return null
  const ici = entrees[position].chemin
  for (let i = position - 1; i >= 0; i--) {
    if (entrees[i].chemin === ici) continue
    return cheminRevenable(entrees[i].chemin) ? { chemin: entrees[i].chemin, pas: position - i } : null
  }
  return null
}

// Les écrans hors d'un dossier, sous le nom que leur donne la navigation (Layout.tsx, son menu du compte).
const NOMS_DES_ECRANS: Readonly<Record<string, string>> = {
  '/dossiers': 'Tableau de bord',
  '/equipe': 'Équipe',
  '/comptes-master': 'Comptes master',
  '/apparence': 'Apparence',
  '/securite': 'Sécurité du compte',
  '/accueil': 'Accueil',
  '/mes-pieces': 'Mes pièces',
  '/mes-ventes': 'Mes ventes',
  '/ma-banque': 'Ma banque',
  '/ma-caisse': 'Ma caisse',
  '/mes-comptes': 'Mes comptes',
  '/mes-documents': 'Mes documents',
  '/mes-lettres-de-mission': 'Mes lettres de mission',
  '/mes-achats': 'Mes achats',
  '/mes-notes-de-frais': 'Mes notes de frais',
  '/mes-demandes': 'Mes demandes',
  '/mon-analyse': 'Mon analyse',
  '/ma-tresorerie': 'Ma trésorerie',
  '/mon-echeancier': 'Mon échéancier',
  '/mes-informations': 'Mes informations',
  '/ma-simulation': 'Ma simulation',
}

const ONGLET_D_UN_DOSSIER = /^\/dossiers\/([^/?]+)\/([^/?]+)$/

/**
 * Le nom accessible du bouton : « Retour à Banque » quand c'est simple à dire, « Retour » sinon. Un onglet ne se nomme
 * que dans le MÊME dossier — « Retour à Banque » vers la banque d'un autre dossier tromperait ; un chemin qui porte une
 * requête (« Nouveau dossier » ouvert) n'est pas l'écran nu dont il porte le nom.
 */
export function libelleDuRetour(cheminAffiche: string, retour: Retour): string {
  const cible = retour.chemin
  if (cible.includes('?')) return 'Retour'
  const ecran = NOMS_DES_ECRANS[cible]
  if (ecran) return `Retour à ${ecran}`
  const onglet = ONGLET_D_UN_DOSSIER.exec(cible)
  const ici = ONGLET_D_UN_DOSSIER.exec(cheminSansRequete(cheminAffiche))
  if (onglet && ici && onglet[1] === ici[1] && ongletsValides(true, true).includes(onglet[2] as DossierTab)) {
    return `Retour à ${libelleDeLOnglet(onglet[2] as DossierTab)}`
  }
  return 'Retour'
}
