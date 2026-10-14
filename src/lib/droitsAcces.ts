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
// TROIS ÉCRANS DU CLIENT S'EN SERVENT, CHACUN DERRIÈRE LE DRAPEAU DE SA MIGRATION : « Ma simulation » suit la case « Banque »
// dès que la couverture du relevé est en base (étape P7, `COUVERTURE_EXPORTEE`) ; « Ma banque » (étape P9) n'existe qu'avec
// la case « Banque » sur la société affichée, derrière le même drapeau (lib/banqueClient.ts, `maBanqueOuverte`) ; « Mes
// ventes » (étape P4a) n'existe qu'avec la case « Ventes » sur la société affichée, dès que les ventes du client sont en
// base (`VENTES_DU_CLIENT_EXPORTEES`, lib/espaceVentes.ts). Le reste — les devis, la connexion de sa banque par le client —
// arrivera avec les étapes P5, P6 et P8, chacune présentée au cabinet avant d'ouvrir quoi que ce soit. Les phrases de l'onglet Accès le disent tel quel : une mise en garde se vérifie
// contre ce que le code FAIT.
//
// LA BASE, ELLE, N'ATTEND PAS LES ÉCRANS : une policy ou une fonction ouverte à un droit vaut dès sa migration, pour la
// session du client, qu'un écran la montre ou non (étapes P2 et P7). Ce qu'une case change se dit donc de ce que la base
// ouvre (`ceQueDisentLesCases`), et ce que le cabinet écrit dans une table que la case « Ventes » ouvre le dit au-dessus
// de son champ (les libellés en fin de module).
import { ADRESSES_RECEPTION_EXPORTEES } from './adressesReception'
import { ARTICLES_EXPORTES } from './articles'
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

// Depuis l'étape P9, la case « Banque » ouvre aussi « Ma banque », derrière le même drapeau que la simulation.
export function ceQueDonneUnAcces(simulationSousBanque: boolean): string {
  return simulationSousBanque
    ? 'Avec son accès, le client dépose ses pièces et ses documents, répond à tes précisions et tient à jour ses '
      + 'informations ; avec la case « Banque », il voit aussi sa banque — les mouvements du relevé que tu as importé, '
      + 'le solde de ses relevés contrôlés — et sa simulation (chiffre d’affaires et cotisations estimés), qui se calcule '
      + 'sur sa banque. Les écritures, les catégories et les packs ne lui sont pas montrés.'
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
// Et, depuis l'étape P4a, l'écran qui les montre : « Mes ventes », derrière le même drapeau ; depuis P4b (sous EC-Q4),
// relier la plateforme s'y fait aussi, dans « Tes plateformes » : plus aucun geste des ventes n'est « sans écran ».
// Quatre états, une phrase chacun. Les deux migrations des ventes s'exportent ENSEMBLE, et la phrase les dit ensemble ;
// droitsAcces.test.ts l'exige, et confronte chaque geste et chaque table nommés à l'export dès qu'il porte leur migration.
// DEPUIS L'ÉTAPE A1, un troisième drapeau : la migration `articles` (`ARTICLES_EXPORTES`, lib/articles.ts) ouvre au client
// « Ventes », par la base, le catalogue des articles et ses trois gestes ; l'écran qui les montre (étape A2a, « Mes ventes ›
// Articles ») suit, et la phrase ne le dit plus à venir. Elle
// exige celles des ventes : sans elles, ce drapeau ne change rien à la phrase. Le tenir « avec toi » est la décision
// MEG1-Q1 du cabinet (lib/articles.ts, `QUI_TIENT_LE_CATALOGUE`).
// DEPUIS L'ÉTAPE A6a, un quatrième : la migration `adresses_reception` (`ADRESSES_RECEPTION_EXPORTEES`,
// lib/adressesReception.ts) ouvre au client « Ventes », par la base, l'adresse de réception déclarée pour le dossier et son
// histoire, sa déclaration, et l'état de sa facture électronique — sans rien de secret —, avant l'encart qui les montrera
// (étape A6b). Elle exige aussi celles des ventes. La déclarer « avec toi » est la décision MEG1-Q16 du cabinet.
// L'adresse se lit et se déclare à l'écran depuis l'étape A6b1 (« Tes plateformes »), et l'encart de l'état est sur l'accueil
// depuis l'étape A6b2 : la phrase dit l'un et l'autre, et ne garde « ensuite » que pour ce qui reste à venir.
export function ceQueDisentLesCases(
  simulationSousBanque: boolean,
  ventesOuvertes: boolean,
  articlesOuverts: boolean,
  adressesOuvertes: boolean,
): string {
  const cases = `« ${DOMAINES[0].libelle} » (${DOMAINES[0].ouvrira}) et « ${DOMAINES[1].libelle} » (${DOMAINES[1].ouvrira}) : `
  if (!simulationSousBanque && !ventesOuvertes) {
    return cases + 'une case cochée enregistre dès aujourd’hui un droit que l’espace du client honorera quand ses écrans '
      + '« Ventes » et « Banque » arriveront. D’ici là, cocher une case ne change pas ce que le client voit ou fait.'
  }
  const ventes = ventesOuvertes
    ? ' « Ventes » ouvre au client « Mes ventes », où il lit ses ventes — ses factures et avoirs, leurs transmissions et '
      + 'leur suivi, les statuts lus sur sa plateforme, ses encaissements et leurs déclarations, les e-mails qui les ont '
      + 'envoyés, avec ce que le cabinet y a écrit (notes et motifs) — et en fait les gestes : créer, modifier, valider ou '
      + 'supprimer un brouillon, créer un avoir, enregistrer, retirer, déclarer ou contre-passer un encaissement, '
      + 'abandonner une transmission restée sans issue connue. Par les fonctions du serveur, il peut aussi y relier '
      + 'lui-même sa plateforme agréée et Super PDP et en voir l’état, y transmettre une facture et en suivre la '
      + 'transmission, relever les statuts de sa plateforme, et envoyer une facture par e-mail, trente par dossier et par '
      + 'jour au plus.'
    : ''
  const avecLesArticles = ventesOuvertes && articlesOuverts
  const articles = avecLesArticles
    ? ' Il tient aussi avec toi, dans « Mes ventes › Articles » et par les fonctions de la base, le catalogue des articles du dossier : il le lit en entier — '
      + 'référence, désignation, description, unité, prix, taux de TVA, nature, et qui a créé, changé ou retiré chaque '
      + 'article — et peut créer, modifier, retirer ou reprendre un article.'
    : ''
  const avecLesAdresses = ventesOuvertes && adressesOuvertes
  const adresses = avecLesAdresses
    ? ' Il lit aussi, avec son histoire, l’adresse de réception de ses factures électroniques déclarée pour le dossier — '
      + 'sa maille, son identifiant, sa plateforme, sa date de prise d’effet, où et quand elle a été vérifiée, et qui l’a '
      + 'déclarée — et peut la déclarer ou la remplacer avec toi ; elle se lit et se déclare dans « Tes plateformes », au-dessus '
      + 'de ses factures. Par la base, l’état de sa facture électronique lui dit si sa plateforme agréée et Super PDP sont '
      + 'reliés, leur nom et leurs dates, jamais leurs secrets. L’encart « Facture électronique » de son accueil le dit, avec '
      + 'l’adresse et ce qui attend — les encaissements à déclarer et les factures refusées sur sa plateforme —, et mène à '
      + '« Mes ventes ».'
    : ''
  // Depuis l'étape P9, « Ma banque » montre ce que la base ouvre à la case : plus rien de la banque n'est « sans écran ».
  const banque = simulationSousBanque
    ? ' « Banque » ouvre au client « Ma banque », où il voit les mouvements du relevé que le cabinet a importé — date, '
      + 'libellé, montant et ce qui les justifie — et le solde de ses relevés contrôlés ; il peut y proposer ou y retirer '
      + 'une pièce comme justificatif d’un mouvement'
      + (ventesOuvertes
        ? ', y écrire des précisions sur un mouvement et, avec « Ventes », désigner celui qui prouve un encaissement.'
        : ' et y écrire des précisions sur un mouvement.')
      + ' La case lui ouvre aussi sa simulation.'
    : ' « Banque » ne change encore qu’une chose, et seulement avec « Ventes » : le client peut désigner le mouvement du '
      + 'relevé qui prouve un encaissement.'
  const ventesFermees = ventesOuvertes ? '' : ' Cocher « Ventes » ne change pas encore ce que le client voit ou fait.'
  // La connexion de sa banque par le client (étape P8) reste à venir dans tous les états. L'écran de ses articles existe
  // depuis l'étape A2a (la vue « Articles » de « Mes ventes ») : la phrase ne le dit plus à venir — ce qui reste d'A2, le
  // choix d'un article dans la facture, n'est pas un écran de plus.
  // L'encart de sa facture électronique est sur son accueil depuis l'étape A6b2 : la phrase ne le dit plus à venir, et ne garde
  // « ensuite » que pour ce qui l'est encore — la connexion de sa banque, l'écran « Banque », ou les écrans « Ventes » et « Banque ».
  const aVenir = simulationSousBanque
    ? (ventesOuvertes
      ? ' La connexion de sa banque depuis son espace viendra ensuite.'
      : ' L’écran « Ventes » de son espace et la connexion de sa banque viendront ensuite.')
    : (ventesOuvertes
      ? ' L’écran « Banque » de son espace viendra ensuite.'
      : ' Les écrans « Ventes » et « Banque » de son espace viendront ensuite.')
  return cases + 'une case cochée enregistre dès aujourd’hui un droit.' + ventes + articles + adresses + banque + ventesFermees + aVenir
}

export const CE_QUE_DONNE_UN_ACCES = ceQueDonneUnAcces(COUVERTURE_EXPORTEE)

// L'état des ventes est celui de leur première migration : la seconde est dans le même export, ou aucune n'y est. Celui
// des articles, celui de leur migration (étape A1) ; celui des adresses de réception, de la leur (étape A6a).
export const CE_QUE_DISENT_LES_CASES = ceQueDisentLesCases(
  COUVERTURE_EXPORTEE, VENTES_DU_CLIENT_EXPORTEES, ARTICLES_EXPORTES, ADRESSES_RECEPTION_EXPORTEES,
)

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

// Les deux textes libres d'un ARTICLE (étape A2a) : la désignation et la description, que le cabinet saisit dans le
// catalogue que `articles_lecture_ventes` ouvre au client « Ventes » — la même condition, le même mot. La désignation figure
// sur la ligne de facture, la description la suit : le libellé dit où le texte va, puis qui le lit.
export const LIBELLE_DESIGNATION_ARTICLE = `Désignation (le nom de l’article ; ${LE_CLIENT_VENTES} la lit)`

export const LIBELLE_DESCRIPTION_ARTICLE = `Description (facultative ; ${LE_CLIENT_VENTES} la lit)`

// ET CE QUE LE MÊME CLIENT LIT AU-DESSUS DU CHAMP, quand c'est LUI qui écrit (« Mes ventes », espace client, étape P4a) : ces
// textes ne figurent pas sur la facture, et ton cabinet les lit aussi. On tutoie le client (lib/resteAEnvoyer.ts).
const TON_CABINET = 'ton cabinet'

export const LIBELLE_NOTES_FACTURE_CLIENT = `Notes (elles ne figurent pas sur la facture, mais ${TON_CABINET} les lit aussi)`

export const LIBELLE_MOTIF_AVOIR_CLIENT = `Motif (il ne figure pas sur l’avoir, mais ${TON_CABINET} le lit aussi)`

export const LIBELLE_MOTIF_CONTRE_PASSATION_CLIENT = `Motif d’annulation, que la plateforme portera et que ${TON_CABINET} lit aussi`

export const LIBELLE_NOTE_DECLARATION_CLIENT =
  `Note (facultative) : qui l’a saisi, quand, sous quelle référence — ${TON_CABINET} la lit aussi`

export const LIBELLE_DESIGNATION_ARTICLE_CLIENT = `Désignation (le nom de l’article ; ${TON_CABINET} la lit aussi)`

export const LIBELLE_DESCRIPTION_ARTICLE_CLIENT = `Description (facultative ; ${TON_CABINET} la lit aussi)`

// Le nom de la PLATEFORME de réception d'une adresse (étape A6b1), que `adresses_reception_lecture_ventes` ouvre au client
// « Ventes » comme au cabinet : le libellé dit qui le lit, des deux côtés — la même condition que pour un article.
export const LIBELLE_PLATEFORME_ADRESSE = `Plateforme de réception (son nom ; ${LE_CLIENT_VENTES} le lit)`

export const LIBELLE_PLATEFORME_ADRESSE_CLIENT = `Plateforme de réception (son nom ; ${TON_CABINET} le lit aussi)`

// ── Ce que le client « Banque » lit de la main du cabinet (espace client, étape P9b) ──────────────────────────────────
// La migration `banque_du_client` ouvre le fil d'un mouvement (`precisions_mouvements`) au cabinet et au client qui porte
// « Banque » : la question que le cabinet y écrit est LUE par ce client, et le libellé du champ le dit, comme ceux des
// ventes.
const LE_CLIENT_BANQUE = `le client qui porte la case « ${definitionDe('banque').libelle} »`

export const LIBELLE_QUESTION_MOUVEMENT =
  `Ta question sur ce mouvement (${LE_CLIENT_BANQUE} la lit et y répond ; envoyée, elle reste telle quelle)`
