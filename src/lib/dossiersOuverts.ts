// LA LISTE DES DOSSIERS D'UN MEMBRE DE L'ÉQUIPE : CEUX QUE LE CABINET LUI OUVRE, ET EUX SEULS (23Q2Q2Q1-Q1, décision du
// cabinet du 26/10/2026, sur la recommandation (B)).
//
// La base rend à un compte d'équipe deux sortes de dossiers (`dossiers_select`, migration `hierarchie_comptables`) : ceux que
// `admin_du_dossier` lui ouvre — tous ceux de son cabinet pour un chef, ses dossiers assignés pour un comptable, tous pour le
// super-administrateur —, et ceux où il a un accès client (`memberships`). Un client entré dans l'équipe garde ses accès
// (23Q2Q2-Q1) : la liste du cabinet lui montrait les dossiers dont il est client, et leurs onglets s'ouvraient sur ses seuls
// droits de client — ses pièces et les catégories, rien des écritures ni de la TVA, que les écrans disaient vides.
//
// La règle ne recopie pas celle de la base. Un dossier rendu où le compte n'a AUCUN accès client lui est ouvert par
// `admin_du_dossier` : c'est la seule autre branche de `dossiers_select` (`dossiersOuverts.test.ts` confronte la policy à
// l'export). Un dossier où il en a un ne l'est que si la base le dit, par `admin_du_dossier`, demandée pour lui seul — la
// fonction qui ouvre les onglets, jamais une règle recopiée. Un échec tombe du côté FERMÉ : des accès lus en partie, aucun
// dossier ; l'ouverture d'un dossier illisible, pas ce dossier ; et la liste dit ce qui manque (`motif`), jamais un vide.
// La base ne change pas : `dossiers_select` lit toujours les accès client, et une adresse directe y mène encore — la page du
// dossier le dit alors (`DOSSIER_FERME_PAR_LE_CABINET`).

/** Ce que la base dit de l'ouverture d'un dossier au compte connecté (`admin_du_dossier`), ou pourquoi elle ne l'a pas dit. */
export type OuvertureLue = { ouvert: boolean } | { illisible: string }

/** Les accès client du compte connecté : les dossiers qu'ils désignent, lus EN ENTIER, ou ce qui a manqué. */
export type AccesDuCompte = { dossiers: ReadonlySet<string> } | { illisibles: string }

export interface DossiersOuverts<T> {
  dossiers: T[]
  /** Ce qui n'a pas pu être vérifié — la liste est alors incomplète, et l'écran le dit. Null sinon. */
  motif: string | null
}

/** Les dossiers dont l'ouverture se demande à la base : ceux rendus où le compte a un accès client, chacun une fois. */
export function dossiersAVerifier(dossiers: readonly { id: string }[], acces: AccesDuCompte): string[] {
  if (!('dossiers' in acces)) return []
  return [...new Set(dossiers.map((d) => d.id).filter((id) => acces.dossiers.has(id)))]
}

/**
 * Les dossiers que le cabinet ouvre au compte connecté, dans l'ordre reçu. Sans accès client sur un dossier, il est ouvert ;
 * avec, il ne l'est que si son ouverture lue vaut `true`. Des accès illisibles : aucun dossier, et le motif le dit.
 */
export function dossiersOuverts<T extends { id: string }>(
  dossiers: readonly T[], acces: AccesDuCompte, ouvertures: ReadonlyMap<string, OuvertureLue>,
): DossiersOuverts<T> {
  if (!('dossiers' in acces)) {
    return {
      dossiers: [],
      motif: `les accès client de ce compte n’ont pas pu être lus en entier (${acces.illisibles}) : aucun dossier ne s’affiche, `
        + 'faute de savoir lesquels le cabinet lui ouvre',
    }
  }
  const gardes: T[] = []
  const illisibles: string[] = []
  for (const dossier of dossiers) {
    if (!acces.dossiers.has(dossier.id)) {
      gardes.push(dossier)
      continue
    }
    const ouverture = ouvertures.get(dossier.id)
    if (ouverture && 'ouvert' in ouverture) {
      if (ouverture.ouvert) gardes.push(dossier)
      continue
    }
    illisibles.push(ouverture ? ouverture.illisible : 'son ouverture n’a pas été demandée')
  }
  if (illisibles.length === 0) return { dossiers: gardes, motif: null }
  const combien = illisibles.length === 1 ? 'd’un dossier' : `de ${illisibles.length} dossiers`
  return {
    dossiers: gardes,
    motif: `l’ouverture ${combien} à ce compte n’a pas pu être vérifiée (${illisibles[0]}) : `
      + `${illisibles.length === 1 ? 'il ne s’affiche' : 'ils ne s’affichent'} pas`,
  }
}

/** La page d'un dossier que la base rend au compte, sans le lui ouvrir : il ne la lit que par un accès client. */
export const DOSSIER_FERME_PAR_LE_CABINET = 'Ce dossier ne t’est pas ouvert dans l’espace du cabinet : tu ne le vois que par '
  + 'l’accès client de ton compte, que cet espace n’ouvre pas. Ses écrans ne s’affichent pas ici — ils n’en montreraient que ce '
  + 'qu’un client lit, et le reste paraîtrait vide.'

/** Ce qui l'ouvrirait, sans rien affirmer du cabinet du dossier, que la page ne compare pas. */
export const POUR_OUVRIR_LE_DOSSIER = 'S’il appartient à ton cabinet, le chef du cabinet peut te l’assigner depuis la page Équipe.'

/** L'ouverture du dossier illisible : la page ne monte aucun écran, et le dit. */
export function ouvertureIllisible(motif: string): string {
  return `L’ouverture de ce dossier à ton compte n’a pas pu être vérifiée (${motif}). Ses écrans ne s’affichent pas : ils `
    + 'pourraient n’en montrer que ce qu’un client lit.'
}
