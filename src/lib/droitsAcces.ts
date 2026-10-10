// LES DROITS D'UN ACCÈS CLIENT (espace client, étape P1 ; décision du cabinet du 09/10/2026 d'ouvrir l'espace client aux
// ventes et à la banque ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA
// CONCEPTION », §3 et §7 ; EC-Q1 sans réponse, sa recommandation prise comme hypothèse).
//
// Deux cases par accès, « Ventes » et « Banque », posées par le cabinet et tenues en BASE : `memberships.droit_ventes` et
// `droit_banque`, fausses par défaut, que seule `changer_droits_acces` change — réservée au cabinet du dossier de l'accès,
// `memberships` n'ayant aucune policy de mise à jour (migration `droits_des_acces_clients`, essai
// `supabase/essais/droitsAcces.sql`). Ce module dit ce que chaque droit ouvrira, lit les droits d'une ligne sans jamais en
// accorder un par défaut, et compose l'appel d'une case cliquée.
//
// AUCUN ÉCRAN DU CLIENT NE S'EN SERT ENCORE : une case cochée enregistre un droit que l'espace du client honorera quand ses
// écrans « Ventes » et « Banque » arriveront (étapes P2 à P9, chacune présentée au cabinet avant d'ouvrir quoi que ce
// soit). Les phrases de l'onglet Accès le disent tel quel : une mise en garde se vérifie contre ce que le code FAIT.

export type Domaine = 'ventes' | 'banque'

export interface DroitsAcces {
  ventes: boolean
  banque: boolean
}

export const AUCUN_DROIT: Readonly<DroitsAcces> = Object.freeze({ ventes: false, banque: false })

export interface DefinitionDomaine {
  domaine: Domaine
  colonne: 'droit_ventes' | 'droit_banque'
  libelle: string
  ouvrira: string
}

// L'ordre est celui des colonnes de l'onglet Accès. Ce que chaque droit ouvrira se dit avec les mots du commentaire de sa
// colonne en base (la migration) : l'écran et le catalogue décrivent le même droit.
export const DOMAINES: readonly DefinitionDomaine[] = [
  { domaine: 'ventes', colonne: 'droit_ventes', libelle: 'Ventes', ouvrira: 'devis, factures, facture électronique' },
  { domaine: 'banque', colonne: 'droit_banque', libelle: 'Banque', ouvrira: 'comptes, mouvements, connexion bancaire' },
]

export function definitionDe(domaine: Domaine): DefinitionDomaine {
  const definition = DOMAINES.find((d) => d.domaine === domaine)
  if (!definition) throw new Error(`Domaine inconnu : ${domaine}`)
  return definition
}

/** Une ligne de `memberships` telle qu'un écran la lit : les deux colonnes peuvent manquer (une lecture qui ne les a pas
 *  demandées, une ligne d'une sauvegarde d'avant la migration). */
export interface LigneDroits {
  droit_ventes?: unknown
  droit_banque?: unknown
}

/**
 * Les droits d'une ligne. Seul `true` accorde : une colonne absente, nulle, ou d'un autre type (`'true'`, `1`) ne donne
 * RIEN — l'échec tombe du côté fermé, comme en base, où la colonne est non nulle et fausse par défaut.
 */
export function droitsDeLaLigne(ligne: LigneDroits | null | undefined): DroitsAcces {
  return { ventes: ligne?.droit_ventes === true, banque: ligne?.droit_banque === true }
}

/**
 * Les droits d'un client par dossier, tirés des accès qu'AuthContext lit déjà. La base n'admet qu'un accès par personne et
 * par dossier (`unique (user_id, dossier_id)`) ; si deux lignes du même dossier arrivaient quand même, un droit ne vaudrait
 * que s'il est sur les DEUX — jamais l'union, qui accorderait ce qu'une ligne refuse.
 */
export function droitsParDossier(
  acces: readonly (LigneDroits & { dossier_id: string })[],
): Readonly<Record<string, DroitsAcces>> {
  const resultat: Record<string, DroitsAcces> = {}
  for (const ligne of acces) {
    const droits = droitsDeLaLigne(ligne)
    const deja = resultat[ligne.dossier_id]
    resultat[ligne.dossier_id] = deja
      ? { ventes: deja.ventes && droits.ventes, banque: deja.banque && droits.banque }
      : droits
  }
  return resultat
}

/** Les droits sur un dossier : aucun pour un dossier absent de la liste (pas d'accès, ou pas encore lu). */
export function droitsSur(droits: Readonly<Record<string, DroitsAcces>>, dossierId: string | null | undefined): DroitsAcces {
  if (!dossierId) return { ...AUCUN_DROIT }
  return droits[dossierId] ?? { ...AUCUN_DROIT }
}

export interface DemandeDeChangement {
  p_membership_id: string
  p_ventes: boolean | null
  p_banque: boolean | null
}

/**
 * Les paramètres de `changer_droits_acces` pour UNE case cliquée. L'autre droit part NUL, donc inchangé en base : deux
 * personnes du cabinet qui cochent chacune une case du même accès, dans deux onglets, ne défont pas l'une l'autre — ce que
 * ferait l'envoi des deux valeurs lues à l'écran, dont l'une serait périmée.
 */
export function demandeDeChangement(membershipId: string, domaine: Domaine, valeur: boolean): DemandeDeChangement {
  return {
    p_membership_id: membershipId,
    p_ventes: domaine === 'ventes' ? valeur : null,
    p_banque: domaine === 'banque' ? valeur : null,
  }
}

/** L'accès que la base a rendu porte-t-il le droit demandé ? Une réponse d'une autre forme n'en porte aucun. */
export function changementApplique(rendu: unknown, domaine: Domaine, valeur: boolean): boolean {
  if (rendu === null || typeof rendu !== 'object') return false
  return (rendu as Record<string, unknown>)[definitionDe(domaine).colonne] === valeur
}

// ── Les phrases de l'onglet Accès ──────────────────────────────────────────────────────────────────────────────────────
// Chacune dit ce que le code FAIT aujourd'hui, vérifié écran par écran : l'Accueil, « Mes pièces » (dépôt de pièces et de
// documents, précisions), « Mes informations » et « Ma simulation » (chiffre d'affaires et cotisations estimés). Aucun
// écran du client ne montre une écriture, une catégorie ni un pack. Le jour où un écran du client lira un droit, ces
// phrases changent avec lui.

export const CE_QUE_DONNE_UN_ACCES =
  'Avec son accès, le client dépose ses pièces et ses documents, répond à tes précisions, tient à jour ses '
  + 'informations et voit sa simulation (chiffre d’affaires et cotisations estimés). Les écritures, les catégories '
  + 'et les packs ne lui sont pas montrés.'

export const CE_QUE_DISENT_LES_CASES =
  `« ${DOMAINES[0].libelle} » (${DOMAINES[0].ouvrira}) et « ${DOMAINES[1].libelle} » (${DOMAINES[1].ouvrira}) : `
  + 'une case cochée enregistre dès aujourd’hui un droit que l’espace du client honorera quand ses écrans « Ventes » et '
  + '« Banque » arriveront. D’ici là, cocher une case ne change pas ce que le client voit ou fait.'

/** Le nom accessible d'une case : le droit, et la personne dont c'est l'accès. */
export function libelleDeLaCase(domaine: Domaine, personne: string): string {
  return `Droit « ${definitionDe(domaine).libelle} » de ${personne}`
}

/** Le refus d'une case, dit avec la personne et le droit visés. */
export function messageDuRefus(domaine: Domaine, personne: string, raison: string): string {
  return `Le droit « ${definitionDe(domaine).libelle} » de ${personne} n’a pas été enregistré : ${raison}`
}
