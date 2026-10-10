// LES DROITS D'UN ACCÈS CLIENT (espace client, étape P1 ; décision du cabinet du 09/10/2026 d'ouvrir l'espace client aux
// ventes et à la banque ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA
// CONCEPTION », §3 et §7 ; EC-Q1, d'abord prise comme hypothèse, décidée par le cabinet le 10/10/2026).
//
// Deux cases par accès, « Ventes » et « Banque », posées par le cabinet et tenues en BASE : `memberships.droit_ventes` et
// `droit_banque`, fausses par défaut, que seule `changer_droits_acces` change — réservée au cabinet du dossier de l'accès,
// `memberships` n'ayant aucune policy de mise à jour (migration `droits_des_acces_clients`, essai
// `supabase/essais/droitsAcces.sql`). Ce module dit ce que chaque droit ouvrira, lit les droits d'une ligne sans jamais en
// accorder un par défaut, et compose l'appel d'une case cliquée.
//
// UN SEUL ÉCRAN DU CLIENT S'EN SERT, ET SEULEMENT DERRIÈRE UN DRAPEAU : « Ma simulation » suit la case « Banque » dès que la
// couverture du relevé est en base (étape P7, `COUVERTURE_EXPORTEE`). Le reste — ses écrans « Ventes » et « Banque » —
// arrivera avec les étapes P3 à P9 (P2 n'a ouvert que la base), chacune présentée au cabinet avant d'ouvrir quoi que ce
// soit. Les phrases de l'onglet Accès le disent tel quel : une mise en garde se vérifie contre ce que le code FAIT.
//
// LA BASE, ELLE, N'ATTEND PAS LES ÉCRANS : une policy ou une fonction ouverte à un droit vaut dès sa migration, pour la
// session du client, qu'un écran la montre ou non (étapes P2 et P7). Ce qu'une case change se dit donc de ce que la base
// ouvre (`ceQueDisentLesCases`), et ce que le cabinet écrit dans une table que la case « Ventes » ouvre le dit au-dessus
// de son champ (les libellés en fin de module).
import { COUVERTURE_EXPORTEE } from './couvertureReleve'
import { VENTES_DU_CLIENT_EXPORTEES } from './encaissementsFactures'

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
//
// LA PREMIÈRE ARRIVE AVEC L'ÉTAPE P7 : « Ma simulation » se calcule sur la banque, et suit la case « Banque » dès que la
// couverture du relevé est en base (`COUVERTURE_EXPORTEE`, lib/couvertureReleve.ts ; EC-Q1, décidée). Les deux phrases
// se disent donc dans les deux états, et chaque constante est celle de l'état du drapeau : le jour où il passe à vrai,
// l'onglet dit que « Banque » ouvre la simulation, sans qu'on ait à y penser.

export function ceQueDonneUnAcces(simulationSousBanque: boolean): string {
  return simulationSousBanque
    ? 'Avec son accès, le client dépose ses pièces et ses documents, répond à tes précisions et tient à jour ses '
      + 'informations ; avec la case « Banque », il voit aussi sa simulation (chiffre d’affaires et cotisations '
      + 'estimés), qui se calcule sur sa banque. Les écritures, les catégories et les packs ne lui sont pas montrés.'
    : 'Avec son accès, le client dépose ses pièces et ses documents, répond à tes précisions, tient à jour ses '
      + 'informations et voit sa simulation (chiffre d’affaires et cotisations estimés). Les écritures, les catégories '
      + 'et les packs ne lui sont pas montrés.'
}

// LA SECONDE DIT CE QU'UNE CASE CHANGE, ET CE N'EST PAS UNE AFFAIRE D'ÉCRANS (contrôle croisé P2 × P7, 10/10/2026 : elle
// ne lisait que le drapeau de P7, et aurait dit qu'une case ne change rien une fois les ventes du client en base). Deux
// étapes ouvrent un droit à la SESSION du client avant tout écran :
//   - `banque_du_client` (P7, `COUVERTURE_EXPORTEE`) : avec « Banque », la simulation, et par la base le contrôle de solde
//     des relevés, les justificatifs proposés pour un mouvement et les précisions d'un mouvement (trois fonctions) ;
//   - `ventes_du_client`, puis `ventes_du_client_facturation` (P2, `VENTES_DU_CLIENT_EXPORTEES`) : avec « Ventes », la
//     lecture des neuf tables de ses ventes, colonnes comprises, et leurs gestes par les fonctions du cabinet ; désigner
//     le mouvement qui prouve un encaissement y demande AUSSI « Banque » — seul effet de cette case sans P7.
// Avec les ventes ouvertes, la phrase dit aussi ce que « Ventes » ouvre dans les quatre fonctions de la vente (P3, qui
// suit P2 et n'a pas de sens sans elle) : chaque action que leur table « qui peut quoi » ouvre à la case, et elle seule
// (droitsAcces.test.ts la confronte à `src/test/quiPeutQuoi.ts`, que droitsDeLAppelantCopie.test.ts confronte aux sources).
// Quatre états, une phrase chacun. Les deux migrations des ventes s'exportent ENSEMBLE, et la phrase les dit ensemble ;
// droitsAcces.test.ts l'exige, et confronte chaque geste et chaque table nommés à l'export dès qu'il porte leur migration.
export function ceQueDisentLesCases(simulationSousBanque: boolean, ventesOuvertes: boolean): string {
  const cases = `« ${DOMAINES[0].libelle} » (${DOMAINES[0].ouvrira}) et « ${DOMAINES[1].libelle} » (${DOMAINES[1].ouvrira}) : `
  if (!simulationSousBanque && !ventesOuvertes) {
    return cases + 'une case cochée enregistre dès aujourd’hui un droit que l’espace du client honorera quand ses écrans '
      + '« Ventes » et « Banque » arriveront. D’ici là, cocher une case ne change pas ce que le client voit ou fait.'
  }
  const ventes = ventesOuvertes
    ? ' « Ventes » permet déjà au client, par la base et sans écran encore, de lire ses ventes — ses factures et avoirs, '
      + 'leurs transmissions et leur suivi, les statuts lus sur sa plateforme, ses encaissements et leurs déclarations, '
      + 'les e-mails qui les ont envoyés, avec ce que le cabinet y a écrit (notes et motifs) — et d’en faire les gestes : '
      + 'créer, modifier, valider ou supprimer un brouillon, créer un avoir, enregistrer, retirer, déclarer ou '
      + 'contre-passer un encaissement, abandonner une transmission restée sans issue connue. Par les fonctions du '
      + 'serveur, il peut aussi relier lui-même sa plateforme agréée et Super PDP et voir leur état, y transmettre une '
      + 'facture et en suivre la transmission, relever les statuts de sa plateforme, et envoyer une facture par e-mail, '
      + 'trente par dossier et par jour au plus.'
    : ''
  const banque = simulationSousBanque
    ? ' « Banque » permet déjà au client de voir sa simulation et, par la base et sans écran encore, de lire le contrôle '
      + 'de solde de ses relevés, de proposer ou de retirer une pièce comme justificatif d’un mouvement'
      + (ventesOuvertes
        ? ', d’écrire des précisions sur un mouvement et, avec « Ventes », de désigner celui qui prouve un encaissement.'
        : ' et d’écrire des précisions sur un mouvement.')
    : ' « Banque » ne change encore qu’une chose, et seulement avec « Ventes » : le client peut désigner le mouvement du '
      + 'relevé qui prouve un encaissement.'
  const ventesFermees = ventesOuvertes ? '' : ' Cocher « Ventes » ne change pas encore ce que le client voit ou fait.'
  return cases + 'une case cochée enregistre dès aujourd’hui un droit.' + ventes + banque + ventesFermees
    + ' Les écrans « Ventes » et « Banque » de son espace viendront ensuite.'
}

export const CE_QUE_DONNE_UN_ACCES = ceQueDonneUnAcces(COUVERTURE_EXPORTEE)

// L'état des ventes est celui de leur première migration : la seconde est dans le même export, ou aucune n'y est.
export const CE_QUE_DISENT_LES_CASES = ceQueDisentLesCases(COUVERTURE_EXPORTEE, VENTES_DU_CLIENT_EXPORTEES)

/** Le nom accessible d'une case : le droit, et la personne dont c'est l'accès. */
export function libelleDeLaCase(domaine: Domaine, personne: string): string {
  return `Droit « ${definitionDe(domaine).libelle} » de ${personne}`
}

/** Le refus d'une case, dit avec la personne et le droit visés. */
export function messageDuRefus(domaine: Domaine, personne: string, raison: string): string {
  return `Le droit « ${definitionDe(domaine).libelle} » de ${personne} n’a pas été enregistré : ${raison}`
}

// ── Ce que le client « Ventes » lit de la main du cabinet ──────────────────────────────────────────────────────────────
// La migration `ventes_du_client` ouvre au client qui porte « Ventes » la lecture des lignes de ses ventes, TOUTES leurs
// colonnes : ce que le cabinet y écrit pour lui-même devient PARTAGÉ (conception de l'espace client, §3.6 : un texte du
// cabinet seul ne se range jamais dans une table que le client lit). Quatre textes libres s'y saisissent au cabinet — les
// notes d'une facture, le motif d'un avoir (rangé dans ses notes, `creerAvoir`), le motif d'une contre-passation et la
// note d'une déclaration — et chacun le dit DANS SON LIBELLÉ, au-dessus du champ : la condition que le cabinet a mise à
// son accord du 10/10/2026, à remplir avant l'application. Le libellé ne suit pas le drapeau : un texte saisi aujourd'hui
// reste, et le client qui porte la case le lira dès la migration appliquée.
const LE_CLIENT_VENTES = `le client qui porte la case « ${definitionDe('ventes').libelle} »`

export const LIBELLE_NOTES_FACTURE = `Notes (elles ne figurent pas sur la facture, mais ${LE_CLIENT_VENTES} les lit)`

export const LIBELLE_MOTIF_AVOIR = `Motif (il ne figure pas sur l’avoir, mais ${LE_CLIENT_VENTES} le lit)`

export const LIBELLE_MOTIF_CONTRE_PASSATION = `Motif d’annulation, que la plateforme portera et que lit ${LE_CLIENT_VENTES}`

export const LIBELLE_NOTE_DECLARATION =
  `Note (facultative) : qui l’a saisi, quand, sous quelle référence — ${LE_CLIENT_VENTES} la lit`
