import { soldeAuReleve, type SoldeLu } from './banqueClient'
import type { CompteBancaire } from './comptesBancaires'
import type { LectureComplete } from './lectureComplete'
import { compteAttenduLeMois } from './releveParCompte'
import type { ControleReleveBancaire, LigneBancaire } from './types'

// « MA BANQUE » QUAND LE DOSSIER TIENT PLUSIEURS COMPTES BANCAIRES (ligne 26.6, lot MCB7 ; MCB-Q8 : « Banque » ouvre tous les
// comptes). Le récit : HISTORIQUE.md, « 11/11/2026 — « MA BANQUE » ET « MA SIMULATION » POUR PLUSIEURS COMPTES BANCAIRES
// (MCB7) ». Un module PUR : il partage ce que le client « Banque » lit — ses mouvements et les contrôles de ses relevés — entre
// les comptes que la base lui ouvre, et dit de chacun ce que l'écran d'hier disait du seul compte : le solde LU au dernier
// relevé contrôlé de CE compte (`soldeAuReleve`, jamais calculé), et les mois où ce compte attend un relevé sans en porter.
//
// Ce que le client lit d'un compte, et rien de plus : son nom (le libellé, texte libre que le cabinet saisit en le sachant
// lu, `LIBELLE_NOM_COMPTE_BANCAIRE`), s'il est le principal, la fin de l'identifiant de son relevé OFX (les quatre derniers
// caractères, que la base lui ouvre avec la ligne), ses dates d'ouverture et de clôture. JAMAIS son compte du plan (le 512)
// ni la date depuis laquelle il le tient : la policy les lui ouvrirait, l'écran ne les demande pas (aucun compte, aucune
// écriture côté client).
//
// LES MOIS MANQUANTS SE NOMMENT SANS NOUVELLE FONCTION. `couverture_du_releve` (MCB4) ne rend que des dates, à tout accès
// client ; mais le client « Banque » lit lui-même tout ce que la fonction regarde — les mouvements et leur compte, l'ouverture,
// la clôture et le rang de chaque compte. La règle se rejoue donc ici par `compteAttenduLeMois` (lib/releveParCompte.ts),
// que releveParCompte.test.ts confronte au texte de la migration : un compte attend un relevé de chaque mois du relevé du
// dossier, de son ouverture (le principal toujours, un autre depuis son premier mouvement s'il ne la dit pas) à sa clôture.
//
// Derrière `COMPTES_BANCAIRES_PREVUS` (lib/comptesBancaires.ts), baissé : l'écran passe `sans_objet`, et le module rend `un`
// — l'écran d'hier, au caractère près. Un dossier qui ne tient qu'un compte aussi : son nom ne se dit pas.

/** Les colonnes d'un compte bancaire que « Ma banque » demande : ni `compte` ni `compte_propre_depuis`. Une seule chaîne
 *  littérale : supabase-js lit son type. */
export const COLONNES_DES_COMPTES_DU_CLIENT = 'id, libelle, principal, fin_d_identifiant, ouvert_le, clos_le'

export type CompteDuClient = Pick<CompteBancaire, 'id' | 'libelle' | 'principal' | 'fin_d_identifiant' | 'ouvert_le' | 'clos_le'>

/** La lecture des comptes, telle que l'écran du client la tient. `sans_objet` : le drapeau est baissé, rien n'est lu. */
export type ComptesDuClient =
  | { etat: 'sans_objet' }
  | { etat: 'illisible'; motif: string }
  | { etat: 'lus'; comptes: readonly CompteDuClient[] }

type AvecCompte = { compte_bancaire_id?: string | null }
type MouvementLu = Pick<LigneBancaire, 'id' | 'date'> & AvecCompte
type ControleLu = Pick<ControleReleveBancaire, 'id' | 'solde_final' | 'coherent' | 'periode_fin' | 'created_at'> & AvecCompte

/** Les mois d'un compte : son premier et son dernier mouvement (nuls s'il n'en porte aucun), et les mois (AAAA-MM) du relevé
 *  du dossier où il attend un relevé sans y porter de mouvement. Muette sur des mouvements lus en partie. */
export type CouvertureDUnCompte =
  | { etat: 'muet' }
  | { etat: 'lue'; premierMouvement: string | null; dernierMouvement: string | null; moisSansMouvement: string[] }

/** Ce que l'écran dit d'un compte. */
export interface EtatDUnCompte {
  compte: CompteDuClient
  solde: SoldeLu
  couverture: CouvertureDUnCompte
}

/**
 * Ce que « Ma banque » montre des comptes. `un` : l'écran d'hier (le drapeau baissé, ou un seul compte). `comptes` : chaque
 * compte nommé, dans l'ordre de la lecture (le principal d'abord). `retenue` : les comptes ne sont pas lus en entier, ou un
 * mouvement ou un relevé est d'un compte que la lecture n'a pas rendu — aucun solde, aucun mois manquant ne se dit (celui
 * d'un compte passerait pour celui du dossier), et aucun geste ne s'offre.
 */
export type BanqueParCompte =
  | { etat: 'un' }
  | { etat: 'comptes'; comptes: EtatDUnCompte[] }
  | { etat: 'retenue'; raison: string }

/** Les comptes du dossier dans l'ordre où l'écran les nomme : le principal d'abord, puis par libellé. */
export function ordreDesComptes(comptes: readonly CompteDuClient[]): CompteDuClient[] {
  return [...comptes].sort((a, b) => Number(b.principal) - Number(a.principal) || a.libelle.localeCompare(b.libelle, 'fr') || (a.id < b.id ? -1 : 1))
}

/** La fin d'identifiant d'un compte, dite au client : « numéro se terminant par 1234 », ou rien. */
export function finDuNumero(compte: Pick<CompteDuClient, 'fin_d_identifiant'>): string | null {
  return compte.fin_d_identifiant ? `numéro se terminant par ${compte.fin_d_identifiant}` : null
}

const moisDe = (date: string) => date.slice(0, 7)

function moisSuivant(mois: string): string {
  const annee = Number(mois.slice(0, 4))
  const m = Number(mois.slice(5, 7))
  return m === 12 ? `${annee + 1}-01` : `${annee}-${String(m + 1).padStart(2, '0')}`
}

/**
 * Les mois d'un compte. Les mois regardés sont ceux du relevé du dossier, de son premier à son dernier mouvement, tous
 * comptes confondus (ce que regarde `couverture_du_releve`) ; un mois y manque pour ce compte quand il l'attend
 * (`compteAttenduLeMois`) sans y porter de mouvement : un relevé de ce compte qui manque, ou un mois sans opération — le
 * client le sait, pas l'application.
 */
export function couvertureDUnCompte(
  compte: CompteDuClient,
  lignesDuCompte: readonly Pick<LigneBancaire, 'date'>[],
  lignesDuDossier: readonly Pick<LigneBancaire, 'date'>[],
): CouvertureDUnCompte & { etat: 'lue' } {
  const dates = lignesDuCompte.map((l) => l.date).sort()
  const premierMouvement = dates[0] ?? null
  const dernierMouvement = dates[dates.length - 1] ?? null
  const duDossier = lignesDuDossier.map((l) => moisDe(l.date)).sort()
  const moisSansMouvement: string[] = []
  if (duDossier.length > 0) {
    const couverts = new Set(dates.map(moisDe))
    const part = { compte, lignes: lignesDuCompte }
    const dernier = duDossier[duDossier.length - 1]
    for (let m = duDossier[0]; m <= dernier; m = moisSuivant(m)) {
      if (!couverts.has(m) && compteAttenduLeMois(part, m)) moisSansMouvement.push(m)
    }
  }
  return { etat: 'lue', premierMouvement, dernierMouvement, moisSansMouvement }
}

/**
 * La banque du client, compte par compte. Les mouvements et les contrôles sont ceux que l'écran a lus, avec leur drapeau
 * d'entièreté : lus en partie, le solde (`soldeAuReleve`) et les mois se taisent comme hier, compte par compte.
 */
export function banqueParCompte(
  lecture: ComptesDuClient,
  mouvements: LectureComplete<MouvementLu>,
  controles: LectureComplete<ControleLu>,
): BanqueParCompte {
  if (lecture.etat === 'sans_objet') return { etat: 'un' }
  if (lecture.etat === 'illisible') return { etat: 'retenue', raison: `tes comptes bancaires n’ont pas pu être lus en entier (${lecture.motif})` }
  const comptes = ordreDesComptes(lecture.comptes)
  const connus = new Set(comptes.map((c) => c.id))
  // Une ligne sans compte (la base n'en accepte plus dès la migration) ou d'un compte que la lecture n'a pas rendu : la RLS
  // a pu changer entre deux lectures de la même vague. Rien ne se partage alors.
  const etrangere = [...mouvements.lignes, ...controles.lignes].find((l) => l.compte_bancaire_id == null || !connus.has(l.compte_bancaire_id))
  if (etrangere !== undefined) {
    return { etat: 'retenue', raison: 'un mouvement ou un relevé est d’un compte bancaire que la lecture de tes comptes n’a pas rendu' }
  }
  if (comptes.length <= 1) return { etat: 'un' }
  return {
    etat: 'comptes',
    comptes: comptes.map((compte) => {
      const lignes = mouvements.lignes.filter((l) => l.compte_bancaire_id === compte.id)
      return {
        compte,
        solde: soldeAuReleve({
          complete: controles.complete, motif: controles.motif,
          lignes: controles.lignes.filter((k) => k.compte_bancaire_id === compte.id),
        }),
        couverture: mouvements.complete ? couvertureDUnCompte(compte, lignes, mouvements.lignes) : { etat: 'muet' },
      }
    }),
  }
}

/** Le filtre des mouvements par compte : tous, ou un compte. Un compte que la lecture ne rend plus revient à « tous ». */
export type FiltreDeCompte = 'tous' | string

export function filtreDeCompteValide(filtre: FiltreDeCompte, banque: BanqueParCompte): FiltreDeCompte {
  if (filtre === 'tous' || banque.etat !== 'comptes') return 'tous'
  return banque.comptes.some((e) => e.compte.id === filtre) ? filtre : 'tous'
}

export function correspondAuCompte(m: AvecCompte, filtre: FiltreDeCompte): boolean {
  return filtre === 'tous' || m.compte_bancaire_id === filtre
}
