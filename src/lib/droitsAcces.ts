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
import { CHANGEMENT_DE_RIB_EXPORTE } from './changementDeRib'
import { CONTACTS_EXPORTES } from './contacts'
import { IMPORT_CONTACTS_EXPORTE } from './contactsImport'
import { COUVERTURE_EXPORTEE } from './couvertureReleve'
import { VENTES_DU_CLIENT_EXPORTEES } from './encaissementsFactures'
import { LOGO_DES_FACTURES_EXPORTE } from './logoDesFactures'
import { PARAMETRES_FACTURATION_EXPORTES } from './parametresFacturation'

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
// DEPUIS L'ÉTAPE A4a, un cinquième : la migration `contacts` (`CONTACTS_EXPORTES`, lib/contacts.ts) ouvre au client
// « Ventes », par la base, le fichier de ses clients — la lecture de toute la table de son dossier, effacés et retirés
// compris, et ses quatre gestes, l'effacement compris. L'écran qui le montre (étape A4b1, « Mes ventes › Clients ») existe
// depuis : la phrase le nomme, comme celle des articles nomme le sien, et ne le dit plus à venir. Elle exige aussi celles
// des ventes. Le tenir « avec toi » suit le patron des articles (MEG1-Q1) ; que le client du cabinet réponde des données de
// ses clients, et que le cabinet agisse pour lui, est l'hypothèse MEG1-Q11 (lib/contacts.ts, `HYPOTHESES_DES_CONTACTS`).
// DEPUIS L'ÉTAPE A4b3a, un sixième : la migration `importer_contacts` (`IMPORT_CONTACTS_EXPORTE`, lib/contactsImport.ts)
// ouvre au client « Ventes », par la base, un geste de plus sur le fichier de ses clients — importer d'un coup les lignes
// d'un fichier, d'un seul tenant, sans jamais modifier un contact rangé. Elle exige celle des contacts : sans elle, ce
// drapeau ne change rien à la phrase. L'écran de l'import (étape A4b3b) vient après : la phrase le dit à venir.
// DEPUIS L'ÉTAPE A5a, un septième : la migration `parametres_facturation` (`PARAMETRES_FACTURATION_EXPORTES`,
// lib/parametresFacturation.ts) — présentée au cabinet et appliquée sur son accord — ouvre au client « Ventes », par la base, les
// paramètres de facturation du dossier, toutes leurs versions et leurs auteurs, et la fonction qui en enregistre une ; un
// RIB qu'il pose ou change n'y est que PROPOSÉ, et seul le cabinet le confirme (MEG1-Q12, hypothèse). Elle exige celles des
// ventes : sans elles, ce drapeau ne change rien à la phrase. Son écran, la vue « Paramètres » de « Mes ventes » (étape
// A5b1), existe : la phrase le nomme, et ne le dit plus à venir.
// DEPUIS L'ÉTAPE A5b3a, un huitième : la migration `dernier_changement_de_rib` (`CHANGEMENT_DE_RIB_EXPORTE`,
// lib/changementDeRib.ts) — présentée au cabinet, appliquée sur son accord — ouvre à la case « Banque », par une fonction de la
// base, le jour, l'auteur (le cabinet ou un accès client, jamais la personne) et l'état du dernier changement du RIB des
// factures, jamais le RIB lui-même (A5-Q2). La case « Ventes » n'y gagne rien : elle lit déjà toutes les versions. Elle exige
// celle des paramètres, donc celles des ventes, et la phrase la dit dans ce que « Banque » ouvre, donc avec la banque du
// client (P7) : sans l'une d'elles, ce drapeau ne change rien à la phrase. L'avis est sur l'accueil depuis l'étape A5b3b (17/10/2026,
// A5B3-Q4 : trente jours depuis le jour du changement, aucune marque « vu ») : la phrase le dit, et ne le dit plus à venir. Elle
// ne promet rien d'autre — ni lien, ni écran des paramètres pour « Banque » seul. La phrase de « Ventes » ne nomme pas l'avis :
// cette case lit déjà les paramètres, toutes leurs versions, dans « Mes ventes › Paramètres » (question A5B3B-Q6).
// DEPUIS L'ÉTAPE A5c1, un neuvième : la migration `logo_des_factures` (`LOGO_DES_FACTURES_EXPORTE`, lib/logoDesFactures.ts)
// — présentée au cabinet, appliquée sur son accord — ouvre au client « Ventes », par le stockage et par la base, la
// lecture du seau des ventes de son dossier, le dépôt d'un logo (une image PNG ou JPEG de 500 Kio au plus, sous la forme du
// chemin d'un logo), et sa désignation dans une version des paramètres. Aucun fichier ne s'y met à jour, pour personne ; seul
// le chef du cabinet en supprime, avec le dossier. Elle exige celle des paramètres, donc celles des ventes : sans elles, ce
// drapeau ne change rien à la phrase. L'écran du logo est dans « Mes ventes › Paramètres » depuis l'étape A5c2a : la phrase
// l'y situe, et ne le dit plus à venir.
// DEPUIS L'ÉTAPE VF8d (chantier EC-Q3), un dixième paramètre, OBLIGATOIRE : le réglage du dossier affiché
// (`reglageDuDossier`), lu par l'onglet. Avec les ventes ouvertes, la phrase dit, AVANT « ensuite », ce que la case
// « Ventes » devient sur CE dossier (`phraseDuReglage`) : basculé, ce que comptent les factures que le client valide ; non
// basculé, pourquoi la case ne se coche pas ; illisible, pourquoi elle ne se change pas. Sans les ventes, la case ne change
// encore rien au client, et la phrase n'en dit rien de plus.
export function ceQueDisentLesCases(
  simulationSousBanque: boolean,
  ventesOuvertes: boolean,
  articlesOuverts: boolean,
  adressesOuvertes: boolean,
  contactsOuverts: boolean,
  importOuvert: boolean,
  parametresOuverts: boolean,
  changementDeRibOuvert: boolean,
  logoOuvert: boolean,
  reglage: ReglageDuDossier,
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
  // Les contacts (étape A4a) : tout ce que la base ouvre — les colonnes, les auteurs, les quatre gestes — et ce que
  // l'effacement fait et ne fait pas : la ligne reste, ses données partent, une facture garde la copie qu'elle a prise.
  const avecLesContacts = ventesOuvertes && contactsOuverts
  const contacts = avecLesContacts
    ? ' Il tient aussi avec toi, dans « Mes ventes › Clients » et par les fonctions de la base, le fichier de ses clients : il le lit en entier — nom, '
      + 'type, adresse, SIREN et SIRET, adresse de facturation électronique et code service, e-mail, délai de paiement, '
      + 'observations, et qui a créé, changé, retiré ou effacé chaque contact — et peut créer, modifier, retirer, reprendre '
      + 'ou effacer un contact ; effacer en vide les données, et une facture garde la copie qu’elle en a prise.'
    : ''
  // L'import (étape A4b3a) : ce que la fonction fait — mille lignes au plus, d'un seul tenant, rien de rangé qui change —,
  // et son écran, « Importer des clients » (étape A4b3b), qui lit le fichier dans le navigateur sans le garder.
  const importContacts = avecLesContacts && importOuvert
    ? ' Dans « Mes ventes › Clients » (« Importer des clients ») comme par la base, il peut aussi importer d’un coup la liste '
      + 'de clients de son ancien logiciel, mille lignes au plus, d’un seul tenant : si une ligne est refusée, l’import entier '
      + 'l’est, et un contact déjà rangé n’est jamais modifié ; le fichier est lu dans son navigateur et n’est pas gardé.'
    : ''
  // Les paramètres de facturation (étape A5a) : la lecture de toutes les versions — le RIB, son état et les auteurs
  // compris —, l'enregistrement d'une version, et la règle du RIB (MEG1-Q12, hypothèse) ; son écran, « Mes ventes ›
  // Paramètres » (étape A5b1).
  const parametres = ventesOuvertes && parametresOuverts
    ? ' Dans « Mes ventes › Paramètres » comme par la base, il lit aussi les paramètres de facturation du dossier, version '
      + 'après version — délai de paiement, moyen de paiement proposé, conditions d’escompte, pénalités de retard, mentions '
      + 'complémentaires, pied de page, et le RIB imprimé (IBAN, BIC, titulaire) avec son état, qui a enregistré chaque '
      + 'version et qui a confirmé chaque RIB — et peut en enregistrer une avec toi : un RIB qu’il pose ou change n’est que '
      + 'proposé, jusqu’à ce que tu le confirmes.'
    : ''
  // Le logo des factures (étape A5c1) : la base ouvre au client « Ventes » la lecture du stockage des ventes de son dossier
  // et le dépôt d'un logo sous sa forme ; il le désigne dans une version des paramètres. Aucune mise à jour d'un fichier,
  // pour personne ; la suppression, au chef du cabinet seul. Sa migration exige celle des paramètres. Son écran est le bloc
  // « Logo des factures » de « Mes ventes › Paramètres » (étape A5c2a).
  const logo = ventesOuvertes && parametresOuverts && logoOuvert
    ? ' Dans « Mes ventes › Paramètres » comme par la base, il peut aussi déposer le logo de ses factures — une image PNG ou '
      + 'JPEG de 500 Ko au plus — dans le stockage des ventes du dossier, où il lit ce qui y est déposé, et le désigner dans '
      + 'une version des paramètres ; un fichier déposé ne se remplace pas, et lui ne peut pas l’effacer.'
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
      + (ventesOuvertes && parametresOuverts && changementDeRibOuvert
        ? ' Par la base, elle lui dit aussi le jour, l’auteur — toi, ou un accès client, jamais la personne — et l’état du '
          + 'dernier changement du RIB de ses factures, sans jamais lui montrer ce RIB ; son accueil le lui dit '
          + 'pendant trente jours.'
        : '')
    : ' « Banque » ne change encore qu’une chose, et seulement avec « Ventes » : le client peut désigner le mouvement du '
      + 'relevé qui prouve un encaissement.'
  const ventesFermees = ventesOuvertes ? '' : ' Cocher « Ventes » ne change pas encore ce que le client voit ou fait.'
  // La connexion de sa banque par le client (étape P8) reste à venir dans tous les états. L'écran de ses articles existe
  // depuis l'étape A2a (la vue « Articles » de « Mes ventes ») : la phrase ne le dit plus à venir — ce qui reste d'A2, le
  // choix d'un article dans la facture, n'est pas un écran de plus.
  // L'encart de sa facture électronique est sur son accueil depuis l'étape A6b2 : la phrase ne le dit plus à venir, et ne garde
  // « ensuite » que pour ce qui l'est encore — la connexion de sa banque, l'écran « Banque », ou les écrans « Ventes » et « Banque ».
  // L'écran de ses clients existe depuis l'étape A4b1 (la vue « Clients » de « Mes ventes »), comme celui de ses articles :
  // la phrase le nomme plus haut et ne le dit plus à venir.
  const aVenir = simulationSousBanque
    ? (ventesOuvertes
      ? ' La connexion de sa banque depuis son espace viendra ensuite.'
      : ' L’écran « Ventes » de son espace et la connexion de sa banque viendront ensuite.')
    : (ventesOuvertes
      ? ' L’écran « Banque » de son espace viendra ensuite.'
      : ' Les écrans « Ventes » et « Banque » de son espace viendront ensuite.')
  // Le réglage du dossier (étape VF8d) se dit après la banque et avant ce qui vient ensuite : ce qu'il change tient à CE
  // dossier, quand ce qui précède tient à la case.
  const dossier = ventesOuvertes ? ' ' + phraseDuReglage(reglage) : ''
  return cases + 'une case cochée enregistre dès aujourd’hui un droit.' + ventes + articles + adresses + contacts
    + importContacts + parametres + logo + banque + ventesFermees + dossier + aVenir
}

export const CE_QUE_DONNE_UN_ACCES = ceQueDonneUnAcces(COUVERTURE_EXPORTEE)

// L'état des ventes est celui de leur première migration : la seconde est dans le même export, ou aucune n'y est. Celui
// des articles, celui de leur migration (étape A1) ; celui des adresses de réception, de la leur (étape A6a) ; celui des
// contacts, de la leur (étape A4a) ; celui de l'import des contacts, de la sienne (étape A4b3a) ; celui des paramètres de
// facturation, de la leur (étape A5a) ; celui du dernier changement du RIB, de la sienne (étape A5b3a) ; celui du logo des
// factures, de la sienne (étape A5c1). Le réglage du dossier, l'onglet le lit (étape VF8d) : la phrase n'est plus une
// constante, mais celle des neuf drapeaux et de ce réglage.
export function ceQueDisentLesCasesDuDossier(reglage: ReglageDuDossier): string {
  return ceQueDisentLesCases(
    COUVERTURE_EXPORTEE, VENTES_DU_CLIENT_EXPORTEES, ARTICLES_EXPORTES, ADRESSES_RECEPTION_EXPORTEES, CONTACTS_EXPORTES,
    IMPORT_CONTACTS_EXPORTE, PARAMETRES_FACTURATION_EXPORTES, CHANGEMENT_DE_RIB_EXPORTE, LOGO_DES_FACTURES_EXPORTE, reglage,
  )
}

// ── La case « Ventes » et la source des ventes du dossier (chantier EC-Q3, étape VF8d) ─────────────────────────────────
// HISTORIQUE.md, « VF8, LA BASCULE : LA CONCEPTION », § 3 (d), et « LA CASE « VENTES » SUIT LA SOURCE DES VENTES, À
// L'ÉCRAN ». La case « Ventes » ne s'ouvre qu'à un dossier dont les factures sont la source de leurs ventes
// (`dossiers.ventes_par_les_factures`, EC3-Q2) : l'onglet Accès la refuse AVANT le clic dès cette étape ; la base la refusera
// à l'étape VF8f (`garder_droit_ventes`), la dernière — ce qui s'ajoute, la bascule de l'application, puis le resserrement.
// Jusque-là, `changer_droits_acces` pose « Ventes » sans regarder le réglage (droitsAcces.test.ts le confronte à l'export) :
// l'écran est plus strict que la base, jamais moins. DÉCOCHER reste offert sur un dossier qui n'a pas basculé — un accès
// coché avant cette étape, ou rendu par une restauration, se défait. Sur un réglage illisible, aucun geste sur « Ventes », ni
// cocher ni décocher : la case ne se juge pas. « Banque » ne regarde pas le réglage.

/** Le réglage du dossier tel que l'onglet Accès l'a lu (lib/reglageDuDossierLecture.ts). */
export type ReglageDuDossier =
  | { etat: 'bascule' }
  | { etat: 'non_bascule' }
  | { etat: 'illisible'; motif: string }

/**
 * Le réglage d'une ligne du dossier (`null` : aucune ligne rendue). Seuls `true` et `false` se lisent : une colonne absente,
 * nulle ou d'un autre type est ILLISIBLE, jamais « pas basculé » — en base la colonne est non nulle, fausse par défaut.
 */
export function reglageDuDossier(ligne: { readonly ventes_par_les_factures?: unknown } | null): ReglageDuDossier {
  if (ligne == null) return { etat: 'illisible', motif: 'le dossier n’a pas été trouvé' }
  if (ligne.ventes_par_les_factures === true) return { etat: 'bascule' }
  if (ligne.ventes_par_les_factures === false) return { etat: 'non_bascule' }
  return { etat: 'illisible', motif: 'le réglage n’est pas lisible' }
}

// LA CARTE QUI BASCULE UN DOSSIER (étape VF8b, onglet Informations) N'EXISTE PAS ENCORE : la phrase ne renvoie pas le cabinet
// vers un onglet où rien ne s'offre. droitsAcces.test.ts confronte cette constante à InformationsTab.tsx — le jour où la carte
// y lit le réglage, le test tombe, et la constante passe à vrai avec elle.
export const CARTE_DE_LA_BASCULE_OUVERTE: boolean = false

/** Ce qui ouvre la case « Ventes », et où se pose le réglage — selon que la carte de la bascule existe. */
export function ouvertureDeLaCaseVentes(carteOuverte: boolean): string {
  return 'La case « Ventes » s’ouvre quand les factures de ce dossier sont la source de leurs ventes'
    + (carteOuverte
      ? ' (onglet Informations)'
      : ' — un réglage que le chef du cabinet posera dans l’onglet Informations, où il ne s’offre pas encore')
}

/** Pourquoi la case « Ventes » ne se coche pas sur un dossier qui n'a pas basculé. */
export function raisonDuDossierNonBascule(carteOuverte: boolean): string {
  return `${ouvertureDeLaCaseVentes(carteOuverte)} : d’ici là, elle ne se coche pas, et un accès qui la porte déjà se décoche.`
}

/** Pourquoi la case « Ventes » ne se change pas sur un réglage illisible. */
export function raisonDuReglageIllisible(motif: string): string {
  return `La source des ventes de ce dossier ne se lit pas (${motif}) : la case « Ventes » ne se coche ni ne se décoche `
    + 'd’ici. Recharge la page pour la relire.'
}

/** Ce que comptent les factures d'un dossier basculé, et qui écrit leurs écritures (EC3-Q5 : sans visa). */
export const CE_QUE_COMPTENT_SES_FACTURES = 'Les factures de ce dossier sont la source de leurs ventes : celles que le '
  + 'client valide comptent dans la 2035, la CA3 et les états du dossier dès leur encaissement (à leur date, dans un dossier '
  + 'tenu en engagement), sans que tu les vises, et leurs écritures s’écrivent sur ton clic, dans l’onglet Écritures.'

/** Ce que la phrase de l'onglet dit de la case « Ventes » sur CE dossier, selon son réglage. */
export function phraseDuReglage(reglage: ReglageDuDossier): string {
  if (reglage.etat === 'bascule') return CE_QUE_COMPTENT_SES_FACTURES
  if (reglage.etat === 'non_bascule') return raisonDuDossierNonBascule(CARTE_DE_LA_BASCULE_OUVERTE)
  return raisonDuReglageIllisible(reglage.motif)
}

/** Ce qu'une case offre, selon le réglage du dossier : cocher, décocher, et pourquoi l'un des deux manque. */
export interface GesteDeLaCase {
  cocher: boolean
  decocher: boolean
  /** Pourquoi un geste manque ; nul quand les deux sont offerts. */
  raison: string | null
}

const LES_DEUX_GESTES: GesteDeLaCase = { cocher: true, decocher: true, raison: null }

/**
 * Les gestes d'une case : « Banque » les a toujours ; « Ventes » sur un dossier basculé aussi ; sur un dossier qui n'a pas
 * basculé, décocher seulement ; sur un réglage illisible, aucun.
 */
export function gesteDeLaCase(domaine: Domaine, reglage: ReglageDuDossier): GesteDeLaCase {
  if (domaine !== 'ventes' || reglage.etat === 'bascule') return LES_DEUX_GESTES
  if (reglage.etat === 'non_bascule') {
    return { cocher: false, decocher: true, raison: raisonDuDossierNonBascule(CARTE_DE_LA_BASCULE_OUVERTE) }
  }
  return { cocher: false, decocher: false, raison: raisonDuReglageIllisible(reglage.motif) }
}

/** Le refus d'une case cliquée vers `valeur`, dit avant tout appel ; nul quand le geste est offert. */
export function refusDeLaCase(domaine: Domaine, valeur: boolean, reglage: ReglageDuDossier): string | null {
  const geste = gesteDeLaCase(domaine, reglage)
  return (valeur ? geste.cocher : geste.decocher) ? null : geste.raison
}

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

// Les trois textes libres d'un CONTACT (étape A4b1) : le nom, l'adresse et les observations, que le cabinet saisit dans le
// fichier des clients que `contacts_lecture_ventes` ouvre au client « Ventes » — la même condition, le même mot. Les
// identifiants (SIREN, SIRET, adresse de facturation électronique, code service) et l'e-mail n'en portent pas : ce ne sont pas
// des textes libres, mais des formes que la base vérifie (le nom `notes` est réservé : les observations s'appellent ainsi).
export const LIBELLE_NOM_CONTACT = `Nom ou raison sociale (${LE_CLIENT_VENTES} le lit)`

export const LIBELLE_ADRESSE_CONTACT = `Adresse (${LE_CLIENT_VENTES} la lit)`

export const LIBELLE_OBSERVATIONS_CONTACT = `Observations (facultatives ; ${LE_CLIENT_VENTES} les lit)`

export const LIBELLE_NOM_CONTACT_CLIENT = `Nom ou raison sociale (${TON_CABINET} le lit aussi)`

export const LIBELLE_ADRESSE_CONTACT_CLIENT = `Adresse (${TON_CABINET} la lit aussi)`

export const LIBELLE_OBSERVATIONS_CONTACT_CLIENT = `Observations (facultatives ; ${TON_CABINET} les lit aussi)`

// ── Ce que le client « Banque » lit de la main du cabinet (espace client, étape P9b) ──────────────────────────────────
// La migration `banque_du_client` ouvre le fil d'un mouvement (`precisions_mouvements`) au cabinet et au client qui porte
// « Banque » : la question que le cabinet y écrit est LUE par ce client, et le libellé du champ le dit, comme ceux des
// ventes.
const LE_CLIENT_BANQUE = `le client qui porte la case « ${definitionDe('banque').libelle} »`

export const LIBELLE_QUESTION_MOUVEMENT =
  `Ta question sur ce mouvement (${LE_CLIENT_BANQUE} la lit et y répond ; envoyée, elle reste telle quelle)`

// Les cinq textes libres des PARAMÈTRES DE FACTURATION (étape A5b1) : les conditions d'escompte, les pénalités de retard, les
// mentions complémentaires, le pied de page et le titulaire du compte, que le cabinet saisit dans la table que
// `parametres_facturation_lecture_ventes` ouvre au client « Ventes » — la même condition, le même mot. Le délai, le moyen,
// l'IBAN et le BIC n'en portent pas : ce sont un nombre, un choix et des formes que la base vérifie.
export const LIBELLE_ESCOMPTE_PARAMETRES = `Conditions d’escompte (${LE_CLIENT_VENTES} les lit)`

export const LIBELLE_PENALITES_PARAMETRES = `Pénalités de retard (${LE_CLIENT_VENTES} les lit)`

export const LIBELLE_MENTIONS_PARAMETRES = `Mentions complémentaires (facultatives ; ${LE_CLIENT_VENTES} les lit)`

export const LIBELLE_PIED_DE_PAGE_PARAMETRES = `Pied de page (facultatif ; ${LE_CLIENT_VENTES} le lit)`

export const LIBELLE_TITULAIRE_PARAMETRES = `Titulaire du compte (${LE_CLIENT_VENTES} le lit)`

export const LIBELLE_ESCOMPTE_PARAMETRES_CLIENT = `Conditions d’escompte (${TON_CABINET} les lit aussi)`

export const LIBELLE_PENALITES_PARAMETRES_CLIENT = `Pénalités de retard (${TON_CABINET} les lit aussi)`

export const LIBELLE_MENTIONS_PARAMETRES_CLIENT = `Mentions complémentaires (facultatives ; ${TON_CABINET} les lit aussi)`

export const LIBELLE_PIED_DE_PAGE_PARAMETRES_CLIENT = `Pied de page (facultatif ; ${TON_CABINET} le lit aussi)`

export const LIBELLE_TITULAIRE_PARAMETRES_CLIENT = `Titulaire du compte (${TON_CABINET} le lit aussi)`

// Les trois textes libres de l'IDENTITÉ du dossier (étape A5b2) : l'adresse, la dénomination imprimée et la ville du greffe,
// que le cabinet saisit dans l'onglet Informations. Ils vivent sur `dossiers`, que `dossiers_select` ouvre à TOUT compte qui
// porte un accès du dossier — et non au seul client « Ventes » : le libellé nomme donc « le client du dossier », sans case. Le
// SIRET, la forme juridique et le capital n'en portent pas : ce sont des formes et des choix que la base vérifie.
const LE_CLIENT_DU_DOSSIER = 'le client du dossier'

export const LIBELLE_ADRESSE_IDENTITE = `Adresse (${LE_CLIENT_DU_DOSSIER} la lit)`

export const LIBELLE_DENOMINATION_IDENTITE = `Dénomination imprimée (facultative ; ${LE_CLIENT_DU_DOSSIER} la lit)`

export const LIBELLE_RCS_VILLE_IDENTITE = `Ville du greffe (RCS ; facultative ; ${LE_CLIENT_DU_DOSSIER} la lit)`
