import { soldeAuReleve, type SoldeLu } from './banqueClient'
import { partageDesComptes, type CompteDuClient, type ComptesDuClient } from './banqueClientParCompte'
import type { LectureComplete } from './lectureComplete'
import type { ControleReleveBancaire } from './types'

// LE SOLDE DU COMPTE SUR L'ACCUEIL DU CLIENT (demande du cabinet du 16/11/2026) : le montant qu'il y a sur le compte, et une
// petite courbe. Un module PUR : l'accueil lit (lib/banqueClientLecture.ts, la lecture des relevés contrôlés de « Ma banque »,
// écrite une fois), le module juge.
//
//  1. LE MONTANT est celui que « Ma banque » affiche : le solde final du dernier relevé contrôlé, cohérent et daté
//     (`soldeAuReleve`, lib/banqueClient.ts) — jamais calculé en additionnant des mouvements, qu'un mouvement manquant
//     rendrait faux sans un mot. Le module ne le recalcule pas : il le reçoit de `soldeAuReleve` et s'y tient.
//  2. LA COURBE porte des valeurs LUES, jamais reconstituées : un point par relevé contrôlé, cohérent et daté, au solde final
//     de ce relevé ; deux relevés de même fin de période n'en font qu'un, celui que `soldeAuReleve` retiendrait (le contrôle
//     enregistré le dernier) ; sur les douze mois qui finissent au mois du dernier point, de l'ancien au récent. Le dernier
//     point est donc le montant affiché. Moins de deux points : pas de courbe — une ligne ne se tire pas d'un point.
//  3. MUET sur une lecture partielle : ni montant ni courbe (jamais « 0,00 € »), et l'écran le dit. Aucun relevé contrôlé :
//     l'écran le dit aussi — un compte sans relevé n'est pas un compte vide.
//  4. PLUSIEURS COMPTES BANCAIRES (derrière `COMPTES_BANCAIRES_PREVUS`, baissé) : le partage de « Ma banque »
//     (`partageDesComptes`, lib/banqueClientParCompte.ts). Chaque compte dit SON solde et SA courbe ; des soldes de dates
//     différentes ne s'additionnent jamais, et aucun total ne se montre.

export type ControleDeLAccueil = Pick<ControleReleveBancaire, 'id' | 'solde_final' | 'coherent' | 'periode_fin' | 'created_at'>
  & { compte_bancaire_id?: string | null }

/** Les mois que la courbe couvre au plus, le mois du dernier relevé compris. */
export const MOIS_DE_LA_COURBE = 12

export interface PointDuSolde {
  au: string
  solde: number
}

/** Ce que l'accueil dit d'un compte : le solde de « Ma banque », et, lu, la courbe (nulle sous deux points). */
export type SoldeDeLAccueil =
  | Exclude<SoldeLu, { etat: 'lu' }>
  | { etat: 'lu'; solde: number; au: string; courbe: PointDuSolde[] | null }

/** Le mois (AAAA-MM) qui commence la fenêtre de la courbe, pour un dernier relevé du mois `dernier`. */
export function premierMoisDeLaCourbe(dernier: string): string {
  const total = Number(dernier.slice(0, 4)) * 12 + Number(dernier.slice(5, 7)) - 1 - (MOIS_DE_LA_COURBE - 1)
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

// L'ordre d'enregistrement de `soldeAuReleve` : l'instant, puis l'identifiant.
function plusRecent(a: ControleDeLAccueil, b: ControleDeLAccueil): boolean {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at
  return a.id > b.id
}

/**
 * Les points de la courbe, de l'ancien au récent : les relevés cohérents et datés, un par fin de période (le dernier
 * enregistré), dans les douze mois qui finissent au mois du plus récent.
 */
export function pointsDuSolde(controles: readonly ControleDeLAccueil[]): PointDuSolde[] {
  const parFin = new Map<string, ControleDeLAccueil>()
  for (const c of controles) {
    if (!c.coherent || !c.periode_fin) continue
    const deja = parFin.get(c.periode_fin)
    if (deja === undefined || plusRecent(c, deja)) parFin.set(c.periode_fin, c)
  }
  const fins = [...parFin.keys()].sort()
  if (fins.length === 0) return []
  const debut = premierMoisDeLaCourbe(fins[fins.length - 1].slice(0, 7))
  return fins.filter((f) => f.slice(0, 7) >= debut).map((f) => ({ au: f, solde: (parFin.get(f) as ControleDeLAccueil).solde_final }))
}

/** Le solde d'un compte pour l'accueil : celui de `soldeAuReleve`, et sa courbe. */
export function soldeDeLAccueil(controles: LectureComplete<ControleDeLAccueil>): SoldeDeLAccueil {
  const solde = soldeAuReleve(controles)
  if (solde.etat !== 'lu') return solde
  const points = pointsDuSolde(controles.lignes)
  // Le dernier point EST le solde affiché (même retenue que `soldeAuReleve`) ; s'ils divergeaient, la courbe se tairait
  // plutôt que de finir ailleurs que le montant.
  const dernier = points[points.length - 1]
  const fidele = dernier !== undefined && dernier.au === solde.au && dernier.solde === solde.solde
  return { etat: 'lu', solde: solde.solde, au: solde.au, courbe: fidele && points.length >= 2 ? points : null }
}

/** L'accueil, compte par compte : `un` (l'écran d'aujourd'hui), `comptes` (chacun nommé), ou `retenue` (rien ne se dit). */
export type BanqueDeLAccueil =
  | { etat: 'un'; solde: SoldeDeLAccueil }
  | { etat: 'comptes'; comptes: { compte: CompteDuClient; solde: SoldeDeLAccueil }[] }
  | { etat: 'retenue'; raison: string }

export function banqueDeLAccueil(comptes: ComptesDuClient, controles: LectureComplete<ControleDeLAccueil>): BanqueDeLAccueil {
  const partage = partageDesComptes(comptes, controles.lignes)
  if (partage.etat === 'retenue') return partage
  if (partage.etat === 'un') return { etat: 'un', solde: soldeDeLAccueil(controles) }
  return {
    etat: 'comptes',
    comptes: partage.comptes.map((compte) => ({
      compte,
      solde: soldeDeLAccueil({ ...controles, lignes: controles.lignes.filter((c) => c.compte_bancaire_id === compte.id) }),
    })),
  }
}

// ── Les mots du client (tutoiement ; aucun nom d'onglet du cabinet) ──────────────────────────────────────────────────
export const TITRE_DU_SOLDE = 'Mon compte en banque'
export const SOUS_TITRE_DU_SOLDE = 'Le solde de ton dernier relevé contrôlé par ton cabinet'
export const SOLDE_SANS_RELEVE = 'Ton cabinet n’a pas encore contrôlé de relevé.'
export const SOLDE_MUET = 'Ton solde ne s’affiche pas : tes relevés n’ont pas pu être lus en entier. Recharge la page.'
export const SOLDE_ILLISIBLE = 'Ton solde ne s’affiche pas : ta banque n’a pas pu être lue. Recharge la page.'
export const COURBE_A_VENIR = 'La courbe paraîtra avec un second relevé.'

export function soldeSansReleveSur(releves: number): string {
  return `Pas de solde à afficher : le solde de tes relevés importés (${releves}) n’a pas pu être contrôlé, ou leur période n’est pas datée.`
}
