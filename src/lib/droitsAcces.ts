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
//
// UNE TROISIÈME CASE, « CAISSE » (ligne 26.6, étape C11 ; MVP-D2 ; CAISSE-Q1, (B) ; CAISSE2-Q1 à Q4). La migration
// `caisse_du_client` (C10, en base et dans l'export depuis le 02/11/2026) pose `memberships.droit_caisse`, fausse par
// défaut, que `changer_droits_acces` à QUATRE paramètres écrit seule, et que `garder_droit_caisse` refuse (23514) quand elle
// ARRIVE sur un accès d'un dossier ni exonéré de TVA ni en franchise en base — à préciser compris —, hors de l'insertion du
// super-administrateur (la restauration). La conception : HISTORIQUE.md, « LA CAISSE : LA SAISIE DU PRATICIEN ET LA PIÈCE
// RÉGLÉE PAR LA CAISSE — LA CONCEPTION REPRISE (CAISSE-Q1 ET Q4) », § 3 à 6 et § 10 ; l'écran : « LA CAISSE : LE DROIT
// « CAISSE » À L'ÉCRAN DU CABINET (C11, LIGNE 26.6) ». Le module dit la case (`DOMAINES`), ses gestes selon le statut de TVA
// du dossier (`gesteDeLaCase`, `etatCaisseDuDossier`), ses refus aux mots de la base, ce qu'elle ouvre à la SESSION du client
// (`ceQueDitLaCaseCaisse`) et la confirmation qui la coche (`confirmationDeLaCaseCaisse`). Ce qu'elle ouvre ne porte aucun
// texte libre du cabinet : aucun libellé neuf (en fin de module, la raison). Depuis C11-Q2 (le 04/11/2026), les gestes lisent
// aussi le mode comptable du dossier : la case ne se coche pas sur un dossier tenu en engagement — l'écran, ici, plus strict
// que la base (`etatCaisseDuDossier`).
import { ADRESSES_RECEPTION_EXPORTEES } from './adressesReception'
import { ARTICLES_EXPORTES } from './articles'
import { BASCULE_OFFERTE } from './basculeDesVentes'
import { CHANGEMENT_DE_RIB_EXPORTE } from './changementDeRib'
import { CONTACTS_EXPORTES } from './contacts'
import { DEVIS_EXPORTES } from './devis'
import { IMPORT_CONTACTS_EXPORTE } from './contactsImport'
import { COUVERTURE_EXPORTEE } from './couvertureReleve'
import { VENTES_DU_CLIENT_EXPORTEES } from './encaissementsFactures'
import { LOGO_DES_FACTURES_EXPORTE } from './logoDesFactures'
import { PARAMETRES_FACTURATION_EXPORTES } from './parametresFacturation'
import { RELANCES_EXPORTEES } from './relances'
import { SIMULATION_VENTES_FACTUREES_EXPORTEE } from './simulationVentesFacturees'
import { refus as refusDeLaCaisse, STATUTS_DE_LA_SAISIE_DU_CLIENT } from './caisse'
import { CORRECTION_DU_PAIEMENT_EXPORTEE } from './correctionDuPaiement'
import { SITUATIONS_PUBLIEES_EXPORTEES } from './situationsPubliees'
import { TROIS_CASES_EXPORTEES } from './troisCasesDeLAcces'
import type { StatutTva } from './types'

export type Domaine = 'ventes' | 'banque' | 'caisse' | 'comptes' | 'achats' | 'frais' | 'documents'

export interface DroitsAcces {
  ventes: boolean
  banque: boolean
  caisse: boolean
  /** « Comptes » (étape C4b) : faux tant que la colonne n'est pas en base — aucune lecture ne la demande avant. */
  comptes: boolean
  /** « Achats », « Notes de frais », « Documents » (étape B1) : faux tant que leurs colonnes ne sont pas en base. */
  achats: boolean
  frais: boolean
  documents: boolean
}

export const AUCUN_DROIT: Readonly<DroitsAcces> = Object.freeze({
  ventes: false, banque: false, caisse: false, comptes: false, achats: false, frais: false, documents: false,
})

export interface DefinitionDomaine {
  domaine: Domaine
  colonne: 'droit_ventes' | 'droit_banque' | 'droit_caisse' | 'droit_comptes' | 'droit_achats' | 'droit_frais' | 'droit_documents'
  libelle: string
  ouvrira: string
}

// L'ordre est celui des colonnes de l'onglet Accès. Ce que chaque droit ouvrira se dit avec les mots du commentaire de sa
// colonne en base (la migration) : l'écran et le catalogue décrivent le même droit. « Comptes » (étape C4b) n'y entre
// qu'avec sa migration (`SITUATIONS_PUBLIEES_EXPORTEES`) : avant, sa colonne n'existe pas, et l'onglet reste celui d'hier.
const TOUS_LES_DOMAINES: readonly DefinitionDomaine[] = [
  { domaine: 'ventes', colonne: 'droit_ventes', libelle: 'Ventes', ouvrira: 'devis, factures, facture électronique' },
  { domaine: 'banque', colonne: 'droit_banque', libelle: 'Banque', ouvrira: 'comptes, mouvements, connexion bancaire' },
  // Étape C11 : les mots du commentaire de la colonne que la migration `caisse_du_client` pose.
  {
    domaine: 'caisse', colonne: 'droit_caisse', libelle: 'Caisse',
    ouvrira: 'recettes en espèces, apports, prélèvements, pièces payées en espèces',
  },
  // Étape C4b : les mots du commentaire de la colonne que la migration `situations_publiees` pose.
  {
    domaine: 'comptes', colonne: 'droit_comptes', libelle: 'Comptes',
    ouvrira: 'situations publiées : recettes, dépenses par poste de la 2035, résultat, TVA due, comparaison à N−1',
  },
  // Étape B1 : les mots des commentaires des colonnes que la migration `trois_cases_de_l_acces` pose (la conception, B.0).
  { domaine: 'achats', colonne: 'droit_achats', libelle: 'Achats', ouvrira: 'factures d’achat, échéances, règlements, fournisseurs' },
  { domaine: 'frais', colonne: 'droit_frais', libelle: 'Notes de frais', ouvrira: 'saisie et suivi de ses notes de frais' },
  {
    domaine: 'documents', colonne: 'droit_documents', libelle: 'Documents',
    ouvrira: 'documents mis à disposition par le cabinet : 2035, liasse, comptes, attestations, lettre de mission',
  },
]

/** Les trois cases de B1, qui n'ouvrent encore rien. */
export const CASES_SANS_EFFET = ['achats', 'frais', 'documents'] as const
export type CaseSansEffet = typeof CASES_SANS_EFFET[number]
const estSansEffet = (d: Domaine): d is CaseSansEffet => (CASES_SANS_EFFET as readonly string[]).includes(d)

/** Les cases de l'onglet, selon que les migrations des situations publiées (C4a) et des trois cases (B1) sont en base. */
export function domainesSelonLesMigrations(comptesEnBase: boolean, troisCasesEnBase: boolean): readonly DefinitionDomaine[] {
  return TOUS_LES_DOMAINES.filter((d) => (d.domaine !== 'comptes' || comptesEnBase) && (!estSansEffet(d.domaine) || troisCasesEnBase))
}

/** Les cases de l'onglet, selon que la migration des situations publiées est en base (sans les trois cases de B1). */
export function domainesSelon(comptesEnBase: boolean): readonly DefinitionDomaine[] {
  return domainesSelonLesMigrations(comptesEnBase, false)
}

export const DOMAINES: readonly DefinitionDomaine[] = domainesSelonLesMigrations(SITUATIONS_PUBLIEES_EXPORTEES, TROIS_CASES_EXPORTEES)

/** Une énumération française : « a », « a et b », « a, b et c ». */
export function enumeration(termes: readonly string[]): string {
  if (termes.length <= 1) return termes.join('')
  return `${termes.slice(0, -1).join(', ')} et ${termes[termes.length - 1]}`
}

/** Les libellés des cases, chacun entre guillemets, dans l'ordre des colonnes : « « Ventes », « Banque » et « Caisse » ». */
export function libellesDesCases(domaines: readonly DefinitionDomaine[] = DOMAINES): string {
  return enumeration(domaines.map((d) => `« ${d.libelle} »`))
}

export function definitionDe(domaine: Domaine): DefinitionDomaine {
  const definition = TOUS_LES_DOMAINES.find((d) => d.domaine === domaine)
  if (!definition) throw new Error(`Domaine inconnu : ${domaine}`)
  return definition
}

/** Une ligne de `memberships` telle qu'un écran la lit : les colonnes peuvent manquer (une lecture qui ne les a pas
 *  demandées, une ligne d'une sauvegarde d'avant la migration). */
export interface LigneDroits {
  droit_ventes?: unknown
  droit_banque?: unknown
  droit_caisse?: unknown
  droit_comptes?: unknown
  droit_achats?: unknown
  droit_frais?: unknown
  droit_documents?: unknown
}

/**
 * Les droits d'une ligne. Seul `true` accorde : une colonne absente, nulle, ou d'un autre type (`'true'`, `1`) ne donne
 * RIEN — l'échec tombe du côté fermé, comme en base, où la colonne est non nulle et fausse par défaut.
 */
export function droitsDeLaLigne(ligne: LigneDroits | null | undefined): DroitsAcces {
  return {
    ventes: ligne?.droit_ventes === true, banque: ligne?.droit_banque === true, caisse: ligne?.droit_caisse === true,
    comptes: ligne?.droit_comptes === true, achats: ligne?.droit_achats === true, frais: ligne?.droit_frais === true,
    documents: ligne?.droit_documents === true,
  }
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
      ? {
        ventes: deja.ventes && droits.ventes, banque: deja.banque && droits.banque, caisse: deja.caisse && droits.caisse,
        comptes: deja.comptes && droits.comptes, achats: deja.achats && droits.achats, frais: deja.frais && droits.frais,
        documents: deja.documents && droits.documents,
      }
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
  p_caisse: boolean | null
  /** La forme à cinq (étape C4b) : seulement quand la migration des situations publiées est en base. */
  p_comptes?: boolean | null
  /** La forme à huit (étape B1) : seulement quand la migration des trois cases est en base. */
  p_achats?: boolean | null
  p_frais?: boolean | null
  p_documents?: boolean | null
}

/**
 * Les paramètres de `changer_droits_acces` pour UNE case cliquée. Les autres droits partent NULS, donc inchangés en base :
 * deux personnes du cabinet qui cochent chacune une case du même accès, dans deux onglets, ne défont pas l'une l'autre — ce
 * que ferait l'envoi des valeurs lues à l'écran, dont l'une serait périmée.
 *
 * LA FORME À QUATRE (étape C11) : `p_caisse` part TOUJOURS, nul ou non — PostgREST choisit la fonction par les noms des
 * paramètres, et la forme à trois, que la migration `caisse_du_client` garde comme un appel de celle à quatre, n'écrirait pas
 * « Caisse ». Le droit cliqué part seul non nul : jamais trois nuls, que la base refuse (22023, « Aucun droit à changer »).
 */
export function demandeDeChangement(membershipId: string, domaine: Domaine, valeur: boolean): DemandeDeChangement {
  return demandeDeChangementSelonLaForme(
    formeDeChangerDroitsAcces(SITUATIONS_PUBLIEES_EXPORTEES, TROIS_CASES_EXPORTEES), membershipId, domaine, valeur)
}

/**
 * LA FORME À CINQ (étape C4b) : la migration `situations_publiees` en base, `p_comptes` part TOUJOURS, nul ou non — la forme
 * à quatre, qu'elle garde comme un appel de celle à cinq, n'écrirait pas « Comptes ». Avant elle, la forme à quatre seule, au
 * paramètre près : la fonction à cinq n'existe pas, et PostgREST refuserait un paramètre qu'aucune forme ne nomme.
 */
export function demandeDeChangementSelon(
  cinqParametres: boolean, membershipId: string, domaine: Domaine, valeur: boolean,
): DemandeDeChangement {
  return demandeDeChangementSelonLaForme(cinqParametres ? 5 : 4, membershipId, domaine, valeur)
}

/** La forme de `changer_droits_acces` que l'onglet appelle : à huit (B1), à cinq (C4a), sinon à quatre (C10). */
export type FormeDesDroits = 4 | 5 | 8
export function formeDeChangerDroitsAcces(comptesEnBase: boolean, troisCasesEnBase: boolean): FormeDesDroits {
  return troisCasesEnBase ? 8 : comptesEnBase ? 5 : 4
}

/**
 * LA FORME À HUIT (étape B1) : la migration `trois_cases_de_l_acces` en base, `p_comptes`, `p_achats`, `p_frais` et
 * `p_documents` partent TOUJOURS, nuls ou non — les formes plus courtes, qu'elle garde comme des appels de la sienne,
 * n'écriraient pas ses cases. Avant elle, la forme du jour, au paramètre près : PostgREST refuserait un paramètre qu'aucune
 * forme ne nomme.
 */
export function demandeDeChangementSelonLaForme(
  forme: FormeDesDroits, membershipId: string, domaine: Domaine, valeur: boolean,
): DemandeDeChangement {
  const demande: DemandeDeChangement = {
    p_membership_id: membershipId,
    p_ventes: domaine === 'ventes' ? valeur : null,
    p_banque: domaine === 'banque' ? valeur : null,
    p_caisse: domaine === 'caisse' ? valeur : null,
  }
  if (forme >= 5) demande.p_comptes = domaine === 'comptes' ? valeur : null
  if (forme === 8) {
    demande.p_achats = domaine === 'achats' ? valeur : null
    demande.p_frais = domaine === 'frais' ? valeur : null
    demande.p_documents = domaine === 'documents' ? valeur : null
  }
  return demande
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

// Ce que la case « Banque » ouvre de plus à la simulation du client quand ses ventes facturées sont en base (étape VF8e,
// `SIMULATION_VENTES_FACTUREES_EXPORTEE`) : elle prend la place de « La case lui ouvre aussi sa simulation. ».
export const PHRASE_DES_VENTES_DE_LA_SIMULATION = ' La case lui ouvre aussi sa simulation, qui compte ses ventes facturées : '
  + 'd’un dossier dont les factures sont la source de leurs ventes, la base lui rend le total hors taxe de chaque mois et la '
  + 'liste de ses factures et avoirs qui comptent eux-mêmes leur vente — leurs identifiants, sans leur contenu.'

/**
 * La phrase de la relance d'une facture en retard (étape C5), sous son drapeau (`RELANCES_EXPORTEES`, levé le 08/11/2026) :
 * le drapeau est un PARAMÈTRE, pour que les deux états se jouent sans simuler le module ; baissé, rien n'est dit.
 */
export function phraseDesRelancesSelon(relances: boolean): string {
  return relances ? ' Il peut aussi relancer par e-mail une facture en retard, dans le même plafond.' : ''
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
// DEPUIS L'ÉTAPE VF8e (chantier EC-Q3), un onzième paramètre : la migration `simulation_des_ventes_facturees`
// (`SIMULATION_VENTES_FACTUREES_EXPORTEE`, lib/simulationVentesFacturees.ts) — préparée, présentée au cabinet avant d'être
// appliquée (VF8-Q2) — ouvre à la case « Banque », par une fonction de lecture de la base, d'un dossier dont les factures
// sont la source de leurs ventes, le total hors taxe de chaque mois de ses ventes facturées et la liste de ses factures et
// avoirs sources — des identifiants, rien de leur contenu ; « Ma simulation » les compte. La phrase le dit à la place de
// « La case lui ouvre aussi sa simulation. », dans ce que « Banque » ouvre, donc avec la banque du client (P7) : sans elle,
// ce drapeau ne change rien à la phrase. « Ventes » n'y gagne rien : elle lit déjà ses factures.
// DEPUIS L'ÉTAPE P5, un douzième paramètre, OBLIGATOIRE : les migrations `devis_du_client` et `devis_du_client_suppression`
// (`DEVIS_EXPORTES`, lib/devis.ts), en production depuis le 05/11/2026, ouvrent au client « Ventes », par la base, la
// lecture de ses devis et du lien de chacun à la facture qui en est tirée (`devis_lecture_ventes`,
// `devis_factures_lecture_ventes`), et quatre gestes par des fonctions sous `gere_les_ventes` : `enregistrer_devis`,
// `decider_devis`, `facturer_devis`, `supprimer_brouillon_devis` ; avec elles, la migration `envoi_des_devis` et
// `send-email` (étape P6c, `ENVOI_DES_DEVIS_PREVU`, levé le même jour) ouvrent l'envoi d'un devis émis par e-mail, dans
// le plafond du dossier, que les factures partagent. La phrase les dit ouverts « par la base » et « par les fonctions du
// serveur ». Elles exigent celles des ventes : sans elles, ce drapeau ne change rien à la phrase ; baissé, la phrase reste
// celle d'avant, au caractère près.
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
  simulationVentesOuverte: boolean,
  devisOuverts: boolean,
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
      + phraseDesRelancesSelon(RELANCES_EXPORTEES)
    : ''
  // Les devis (étape P5) : la lecture des deux tables que leur migration ouvre à « Ventes », les quatre gestes de leurs
  // fonctions, puis leur envoi par e-mail (`send-email`, étape P6c), qui compte dans le même plafond que les factures.
  // Juste après les ventes : les devis viennent avant les factures, comme dans ce que la case ouvrira.
  const devis = ventesOuvertes && devisOuverts
    ? ' Par la base, il lit aussi ses devis et le lien de chacun à la facture qui en est tirée, et peut créer, modifier ou '
      + 'émettre un devis, l’accepter ou le refuser, en tirer un brouillon de facture une fois accepté, ou supprimer un '
      + 'brouillon de devis ; par les fonctions du serveur, envoyer un devis émis par e-mail, dans le même plafond que ses '
      + 'factures.'
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
      + (simulationVentesOuverte ? PHRASE_DES_VENTES_DE_LA_SIMULATION : ' La case lui ouvre aussi sa simulation.')
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
  return cases + 'une case cochée enregistre dès aujourd’hui un droit.' + ventes + devis + articles + adresses + contacts
    + importContacts + parametres + logo + banque + ventesFermees + dossier + aVenir
}

export const CE_QUE_DONNE_UN_ACCES = ceQueDonneUnAcces(COUVERTURE_EXPORTEE)

// L'état des ventes est celui de leur première migration : la seconde est dans le même export, ou aucune n'y est. Celui
// des articles, celui de leur migration (étape A1) ; celui des adresses de réception, de la leur (étape A6a) ; celui des
// contacts, de la leur (étape A4a) ; celui de l'import des contacts, de la sienne (étape A4b3a) ; celui des paramètres de
// facturation, de la leur (étape A5a) ; celui du dernier changement du RIB, de la sienne (étape A5b3a) ; celui du logo des
// factures, de la sienne (étape A5c1). Le réglage du dossier, l'onglet le lit (étape VF8d) : la phrase n'est plus une
// constante, mais celle des drapeaux et de ce réglage ; celui des ventes facturées de la simulation, de la sienne (étape
// VF8e), levé depuis son application, le 27/10/2026 ; celui des devis, de leurs deux migrations (étape P5).
export function ceQueDisentLesCasesDuDossier(reglage: ReglageDuDossier): string {
  return ceQueDisentLesCases(
    COUVERTURE_EXPORTEE, VENTES_DU_CLIENT_EXPORTEES, ARTICLES_EXPORTES, ADRESSES_RECEPTION_EXPORTEES, CONTACTS_EXPORTES,
    IMPORT_CONTACTS_EXPORTE, PARAMETRES_FACTURATION_EXPORTES, CHANGEMENT_DE_RIB_EXPORTE, LOGO_DES_FACTURES_EXPORTE, reglage,
    SIMULATION_VENTES_FACTUREES_EXPORTEE, DEVIS_EXPORTES,
  )
}

// ── La case « Ventes » et la source des ventes du dossier (chantier EC-Q3, étape VF8d) ─────────────────────────────────
// HISTORIQUE.md, « VF8, LA BASCULE : LA CONCEPTION », § 3 (d), et « LA CASE « VENTES » SUIT LA SOURCE DES VENTES, À
// L'ÉCRAN ». La case « Ventes » ne s'ouvre qu'à un dossier dont les factures sont la source de leurs ventes
// (`dossiers.ventes_par_les_factures`, EC3-Q2) : l'onglet Accès la refuse AVANT le clic depuis cette étape. La base la
// refuse aussi avec la migration de l'étape VF8f, le resserrement (`ventes_sur_dossier_bascule` : la garde
// `garder_droit_ventes`, après la RLS, pour tout auteur, hors de l'insertion du super-administrateur, la restauration) ; avant
// elle, `changer_droits_acces` posait « Ventes » sans regarder le réglage, et l'écran était plus strict que la base, jamais
// moins. Le module REDIT son refus, à la lettre (`REFUS_VENTES_DOSSIER_NON_BASCULE`) : cocher « Ventes » sur un dossier qui
// n'a pas basculé se refuse avant le clic aux mots que la base opposerait après — une case cochée dans un onglet resté
// ouvert pendant qu'un autre baissait le réglage —, sans recopier sa règle (qui écrit, l'exception de la restauration, la
// ligne emportée vers un autre dossier) : l'écran juge sur le réglage qu'il a lu, la base sur celui qu'elle verrouille.
// DÉCOCHER reste offert sur un dossier qui n'a pas basculé — un accès rendu par une restauration se défait, et la base ne
// juge que ce qui arrive. Sur un réglage illisible, aucun geste sur « Ventes », ni cocher ni décocher : la case ne se juge
// pas, et la base n'a pas de refus pour cela. « Banque » ne regarde pas le réglage.

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

// LA PHRASE SUIT LE GESTE OFFERT, PAS L'EXISTENCE DE LA CARTE (étape VF8b) : la carte « Source des ventes » de l'onglet
// Informations existe, mais tant que `BASCULE_OFFERTE` (lib/basculeDesVentes.ts) est faux elle ne bascule rien — la phrase
// ne renvoie donc pas le cabinet vers un geste qui ne s'offre pas, et dit que le réglage « ne s'offre pas encore ».
// droitsAcces.test.ts éprouve ses deux états.

/** Ce qui ouvre la case « Ventes », et où se pose le réglage — selon que la bascule s'offre dans l'onglet Informations. */
export function ouvertureDeLaCaseVentes(basculeOfferte: boolean): string {
  return 'La case « Ventes » s’ouvre quand les factures de ce dossier sont la source de leurs ventes'
    + (basculeOfferte
      ? ' (onglet Informations)'
      : ' — un réglage que le chef du cabinet posera dans l’onglet Informations, où il ne s’offre pas encore')
}

/** Pourquoi la case « Ventes » ne se coche pas sur un dossier qui n'a pas basculé. */
export function raisonDuDossierNonBascule(basculeOfferte: boolean): string {
  return `${ouvertureDeLaCaseVentes(basculeOfferte)} : d’ici là, elle ne se coche pas, et un accès qui la porte déjà se décoche.`
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
  if (reglage.etat === 'non_bascule') return raisonDuDossierNonBascule(BASCULE_OFFERTE)
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
 * basculé, décocher seulement ; sur un réglage illisible, aucun. « Caisse » (étape C11) suit le statut de TVA du dossier
 * de la même façon : exonéré ou en franchise, les deux gestes ; redevable ou à préciser, décocher seulement ; un statut
 * illisible, aucun. Et son mode comptable (C11-Q2) : en engagement, décocher seulement ; un mode illisible, aucun geste.
 * Chaque case lit SON état, et lui seul : aucune n'a les deux gestes par défaut.
 */
export function gesteDeLaCase(domaine: Domaine, reglage: ReglageDuDossier, caisse: EtatCaisseDuDossier): GesteDeLaCase {
  switch (domaine) {
    case 'banque':
      return LES_DEUX_GESTES
    // « Comptes » (étape C4b) : la base ne la garde par aucun état du dossier — elle ouvre la lecture des seules situations
    // que le cabinet publie, et n'importe quel dossier en a.
    case 'comptes':
      return LES_DEUX_GESTES
    // « Achats », « Notes de frais », « Documents » (étape B1) : aucune garde, et elles n'ouvrent encore rien.
    case 'achats':
    case 'frais':
    case 'documents':
      return LES_DEUX_GESTES
    case 'ventes':
      if (reglage.etat === 'bascule') return LES_DEUX_GESTES
      if (reglage.etat === 'non_bascule') {
        return { cocher: false, decocher: true, raison: raisonDuDossierNonBascule(BASCULE_OFFERTE) }
      }
      return { cocher: false, decocher: false, raison: raisonDuReglageIllisible(reglage.motif) }
    case 'caisse':
      if (caisse.etat === 'exclu') return LES_DEUX_GESTES
      if (caisse.etat === 'tenue_par_le_cabinet') {
        return { cocher: false, decocher: true, raison: raisonDuDossierNonExclu(caisse.statut) }
      }
      if (caisse.etat === 'en_engagement') return { cocher: false, decocher: true, raison: RAISON_DU_DOSSIER_EN_ENGAGEMENT }
      if (caisse.etat === 'mode_illisible') return { cocher: false, decocher: false, raison: raisonDuModeIllisible(caisse.motif) }
      return { cocher: false, decocher: false, raison: raisonDuStatutIllisible(caisse.motif) }
  }
}

/**
 * Le refus de la base quand « Ventes » ARRIVE sur un accès d'un dossier dont les factures ne sont pas la source de leurs
 * ventes (étape VF8f : `garder_droit_ventes`, migration `ventes_sur_dossier_bascule`), à la lettre, apostrophes droites
 * comprises — ventesSurDossierBascule.test.ts le confronte au texte de la migration et à ses essais.
 */
export const REFUS_VENTES_DOSSIER_NON_BASCULE = {
  code: '23514',
  message: "Le droit « Ventes » suppose que les factures de ce dossier soient la source de leurs ventes, ce qu'elles ne sont pas : changer d'abord la source des ventes du dossier.",
} as const

/**
 * Le refus d'une case cliquée vers `valeur`, dit avant tout appel ; nul quand le geste est offert. Sur un dossier qui n'a
 * pas basculé, le seul geste qui manque — cocher « Ventes » — se refuse aux mots de la base (étape VF8f) : avant le clic ou
 * après, le cabinet lit la même phrase. Un réglage illisible dit sa raison : ce n'est pas un refus de la base.
 */
export function refusDeLaCase(
  domaine: Domaine, valeur: boolean, reglage: ReglageDuDossier, caisse: EtatCaisseDuDossier,
): string | null {
  const geste = gesteDeLaCase(domaine, reglage, caisse)
  if (valeur ? geste.cocher : geste.decocher) return null
  if (domaine === 'ventes' && reglage.etat === 'non_bascule') return REFUS_VENTES_DOSSIER_NON_BASCULE.message
  // « Caisse » cochée sur un dossier ni exonéré ni en franchise : les mots de `garder_droit_caisse` (étape C11).
  if (domaine === 'caisse' && caisse.etat === 'tenue_par_le_cabinet') return REFUS_CAISSE_DOSSIER_NON_EXCLU.message
  return geste.raison
}

// ── La case « Caisse » et le statut de TVA du dossier (ligne 26.6, étape C11) ──────────────────────────────────────────
// La conception reprise, § 2 (le système de caisse, vérifié au BOFiP) et § 3 (le droit) ; CAISSE2-Q3, (B) : la franchise en
// base comme l'exonération. Une saisie des espèces au fil des jours, écrite avec son écriture et corrigeable jusqu'à la
// validation, est une fonctionnalité de caisse (BOI-TVA-DECLA-30-10-30, § 30) ; l'obligation d'un logiciel de caisse
// certifié ou attesté (CGI, art. 286, I, 3° bis) n'atteint ni l'assujetti en franchise en base ni celui qui n'effectue que
// des opérations exonérées (art. 286, II, 2, cité au § 25). La base tient la règle : « Caisse » qui ARRIVE sur un accès d'un
// autre dossier se refuse (`garder_droit_caisse`), et un dossier dont un accès porte la case ne quitte pas ces deux statuts
// (`garder_statut_tva_de_la_caisse`). L'écran la redit avant le clic, aux mots de la base ; il juge sur le statut qu'il a
// lu, la base sur celui qu'elle verrouille (`for share`) : une case cochée dans un onglet resté ouvert pendant qu'un autre
// changeait le statut se refuse après le clic, sous les mêmes mots.

/**
 * Le statut de TVA et le mode comptable du dossier, tels que l'onglet Accès les a lus, jugés pour la case « Caisse » :
 *   - `exclu` : exonéré ou en franchise en base — hors du système de caisse —, tenu en trésorerie ; la case se coche ;
 *   - `tenue_par_le_cabinet` : redevable, ou à préciser (nul) — la case ne se coche pas, quel que soit le mode : c'est le
 *     refus de la base (`garder_droit_caisse`) ;
 *   - `en_engagement` (C11-Q2) : exonéré ou en franchise, mais tenu en comptabilité d'engagement — la case ne se coche pas.
 *     La base l'accepterait : la garde ne lit que le statut ; mais elle refuse ensuite toute opération de caisse hors de la
 *     trésorerie (22023, `enregistrer_operation_caisse` : « l'engagement attend sa conception »), et le praticien
 *     n'y pourrait rien saisir. L'écran est ici PLUS STRICT que la base, sans migration (décision du cabinet du 04/11/2026) ;
 *   - `illisible` : une ligne absente, la colonne du statut absente ou d'une autre valeur — jamais « redevable » ;
 *   - `mode_illisible` : le statut lu, mais la colonne du mode absente ou d'une autre valeur — jamais « trésorerie ».
 */
export type EtatCaisseDuDossier =
  | { etat: 'exclu'; statut: 'exonere' | 'franchise' }
  | { etat: 'tenue_par_le_cabinet'; statut: 'redevable' | null }
  | { etat: 'en_engagement'; statut: 'exonere' | 'franchise' }
  | { etat: 'illisible'; motif: string }
  | { etat: 'mode_illisible'; motif: string }

/**
 * Le statut et le mode d'une ligne du dossier (`null` : aucune ligne rendue). Nul est un statut — « à préciser », que la base
 * admet —, absent n'en est pas un : une colonne qu'on n'a pas lue n'est pas une colonne nulle. Les deux statuts exclus sont
 * ceux que les trois corps de la base nomment (lib/caisse.ts, `STATUTS_DE_LA_SAISIE_DU_CLIENT`) ; les deux modes, ceux de la
 * contrainte de `dossiers.mode_comptable`. Le statut se juge d'abord : sur un dossier redevable ou à préciser, la case se
 * refuse aux mots de la base, quel que soit le mode — mais un mode illisible n'offre aucun geste, même là.
 */
export function etatCaisseDuDossier(ligne: { readonly statut_tva?: unknown; readonly mode_comptable?: unknown } | null): EtatCaisseDuDossier {
  if (ligne == null) return { etat: 'illisible', motif: 'le dossier n’a pas été trouvé' }
  if (!('statut_tva' in ligne)) return { etat: 'illisible', motif: 'le statut de TVA n’a pas été lu' }
  const statut = ligne.statut_tva
  const exclu = (statut === 'exonere' || statut === 'franchise') && STATUTS_DE_LA_SAISIE_DU_CLIENT.includes(statut)
  if (!exclu && statut !== 'redevable' && statut !== null) return { etat: 'illisible', motif: 'le statut de TVA n’est pas lisible' }
  if (!('mode_comptable' in ligne)) return { etat: 'mode_illisible', motif: 'le mode comptable n’a pas été lu' }
  const mode = ligne.mode_comptable
  if (mode !== 'tresorerie' && mode !== 'engagement') return { etat: 'mode_illisible', motif: 'le mode comptable n’est pas lisible' }
  if (statut === 'redevable' || statut === null) return { etat: 'tenue_par_le_cabinet', statut }
  const lequel = statut as 'exonere' | 'franchise'
  return mode === 'engagement' ? { etat: 'en_engagement', statut: lequel } : { etat: 'exclu', statut: lequel }
}

/**
 * Le refus de la base quand « Caisse » ARRIVE sur un accès d'un dossier ni exonéré ni en franchise en base (étape C10 :
 * `garder_droit_caisse`, migration `caisse_du_client`), à la lettre, apostrophes droites comprises — droitsAcces.test.ts le
 * confronte au texte exporté.
 */
export const REFUS_CAISSE_DOSSIER_NON_EXCLU = {
  code: '23514',
  message: 'Le droit « Caisse » suppose un dossier exonéré de TVA ou en franchise en base, ce que le statut de ce dossier ne dit pas : sa caisse reste tenue par le cabinet.',
} as const

/**
 * Le refus de la base quand le statut de TVA d'un dossier dont un accès porte « Caisse » quitte l'exonération et la
 * franchise (`garder_statut_tva_de_la_caisse`), à la lettre : l'onglet Accès dit avant que la case soit cochée ce qu'elle
 * retient (`CE_QUE_LA_CASE_RETIENT`), et l'onglet TVA rend ces mots-là après le clic.
 */
export const REFUS_STATUT_SOUS_LA_CASE_CAISSE = {
  code: '23514',
  message: "Un accès de ce dossier porte la case « Caisse », qui suppose un dossier exonéré de TVA ou en franchise en base : décoche-la d'abord.",
} as const

// ── Le statut de TVA sous la case « Caisse », dit dans l'onglet TVA (C11-Q1, le 04/11/2026, « Oui, avec C12 ») ─────────────
// La carte du statut (pages/dossier/StatutTvaCard.tsx) lit les accès du dossier EN ENTIER
// (lib/accesCaisseDuDossierLecture.ts) et dit AVANT le clic ce que `garder_statut_tva_de_la_caisse` refuserait : quitter
// l'exonération et la franchise — vers « redevable », ou « à préciser » — tant qu'un accès porte la case, sous les mots de la
// garde (`REFUS_STATUT_SOUS_LA_CASE_CAISSE`). Passer de l'un à l'autre passe, et un dossier qui n'était ni l'un ni l'autre
// n'a rien à garder : la garde ne juge que ce qui QUITTE l'ensemble. Des accès lus en partie, refusés ou pas encore revenus
// ne promettent rien : l'écran le dit, et la base reste juge après le clic.

/** Les accès du dossier, tels que la carte du statut les a lus : combien portent la case, ou pourquoi on ne le sait pas. */
export type AccesDuDossierLus = { etat: 'lus'; avecLaCase: number } | { etat: 'illisibles'; motif: string }

/** Ce que la carte du statut dit d'un changement, avant le clic : le refus de la base, ou ce qu'elle ne sait pas promettre. */
export type AvisDuStatutSousLaCase = { etat: 'refuse'; message: string } | { etat: 'incertain'; message: string }

const exclu = (statut: StatutTva | null) => statut != null && STATUTS_DE_LA_SAISIE_DU_CLIENT.includes(statut)

/**
 * L'avis de la carte du statut sur un changement de `actuel` vers `choix`, les accès lus (`null` : pas encore revenus) ; nul
 * quand la garde n'aurait rien à dire. Refusé — les mots de la base — quand un accès lu en entier porte la case ; incertain
 * quand les accès ne sont pas lus en entier (aucune promesse : la base juge après le clic).
 */
export function avisDuStatutSousLaCase(
  actuel: StatutTva | null, choix: StatutTva | null, acces: AccesDuDossierLus | null,
): AvisDuStatutSousLaCase | null {
  if (!exclu(actuel) || exclu(choix)) return null
  const siUnAcces = 'si l’un d’eux porte la case « Caisse », la base refusera ce changement de statut, et il faudra la '
    + 'décocher d’abord, dans l’onglet Accès.'
  if (acces === null) return { etat: 'incertain', message: `Les accès du dossier ne sont pas encore lus : ${siUnAcces}` }
  if (acces.etat === 'illisibles') {
    return { etat: 'incertain', message: `Les accès du dossier n’ont pas pu être lus en entier (${acces.motif}) : ${siUnAcces}` }
  }
  return acces.avecLaCase > 0 ? { etat: 'refuse', message: REFUS_STATUT_SOUS_LA_CASE_CAISSE.message } : null
}

const NOM_DU_STATUT: Readonly<Record<'exonere' | 'franchise' | 'redevable', string>> = {
  exonere: 'exonéré de TVA',
  franchise: 'en franchise en base de TVA',
  redevable: 'redevable de la TVA',
}

/** Pourquoi la case « Caisse » ne se coche pas sur un dossier redevable ou dont le statut est à préciser. */
export function raisonDuDossierNonExclu(statut: 'redevable' | null): string {
  const lequel = statut === null ? 'dont le statut de TVA est à préciser' : NOM_DU_STATUT[statut]
  return 'La case « Caisse » ne s’ouvre qu’à un dossier exonéré de TVA ou en franchise en base (son statut, dans l’onglet '
    + `TVA) : sur ce dossier ${lequel}, la saisie des espèces par le praticien devrait passer par un logiciel de caisse `
    + 'certifié ou attesté (CGI, art. 286, I, 3° bis), et sa caisse reste tenue par toi. D’ici là, elle ne se coche pas, '
    + 'et un accès qui la porte se décoche.'
}

/**
 * Pourquoi la case « Caisse » ne se coche pas sur un dossier tenu en engagement (C11-Q2), en une phrase : la raison est le
 * refus que la base oppose à toute opération de caisse hors de la trésorerie, cité sous ses mots (lib/caisse.ts, jamais
 * recopiés ici). La base, elle, accepterait la case : l'écran le dit comme une règle de l'écran, pas comme un refus de la base.
 */
export const RAISON_DU_DOSSIER_EN_ENGAGEMENT = 'Ce dossier est tenu en comptabilité d’engagement, où la base refuse toute '
  + `opération de caisse (« ${refusDeLaCaisse('tresorerie').message} ») : la case « Caisse » ne s’y coche pas, puisque le `
  + 'praticien n’y pourrait rien saisir, et un accès qui la porte se décoche.'

/** Pourquoi la case « Caisse » ne se change pas sur un mode comptable illisible. */
export function raisonDuModeIllisible(motif: string): string {
  return `Le mode comptable de ce dossier ne se lit pas (${motif}) : la case « Caisse » ne se coche ni ne se décoche d’ici. `
    + 'Recharge la page pour le relire.'
}

/** Pourquoi la case « Caisse » ne se change pas sur un statut de TVA illisible. */
export function raisonDuStatutIllisible(motif: string): string {
  return `Le statut de TVA de ce dossier ne se lit pas (${motif}) : la case « Caisse » ne se coche ni ne se décoche d’ici. `
    + 'Recharge la page pour le relire.'
}

/** Ce que la case retient du statut de TVA tant qu'un accès la porte (`garder_statut_tva_de_la_caisse`), dit avant. */
export const CE_QUE_LA_CASE_RETIENT = 'Tant qu’un accès la porte, le statut de TVA du dossier ne quitte pas l’exonération ni '
  + 'la franchise en base (passer de l’une à l’autre reste possible) : l’onglet TVA le refuserait, et il faut décocher la '
  + 'case d’abord.'

// CE QUE LA CASE OUVRE À LA SESSION DU CLIENT, PAR LA BASE, DÈS QU'ELLE EST COCHÉE — qu'un écran le montre ou non (« Ma
// caisse », étape C12a, en montre la caisse, ses saisies, ses corrections et ses retraits ; « Mes pièces », étape C12b, le
// paiement d'une pièce et son retrait) : la policy `operations_caisse_lecture_caisse` (toute la caisse de son dossier,
// chaque colonne), la fonction `caisse_du_client` (la caisse jour par jour, en totaux, et « le prix d'un solde juste » que son
// commentaire veut voir dit ici : les versements et retraits du relevé sans « Banque », les espèces de ses factures sans
// « Ventes ») et les cinq fonctions d'écriture que `qui_ecrit_la_caisse` lui ouvre (une opération, un mois, le retrait, le
// remplacement, le paiement d'une pièce). droitsAcces.test.ts confronte chacun de ces termes à l'export.
export const CE_QUE_LA_CASE_CAISSE_OUVRE = 'il y lit toute la caisse de son dossier — chaque opération, celles que tu '
  + 'saisis et les retirées comprises, avec son genre, son jour, son montant, sa nature, son origine, ses auteurs (sans '
  + 'adresse) et ses heures —, et sa caisse jour par jour : le report des années d’avant, l’ouverture, ce que le relevé a '
  + 'versé depuis la caisse ou retiré pour elle et les espèces de ses factures, en totaux du jour et sans libellé (même sans '
  + '« Banque » ni « Ventes »), et le solde. Il y saisit ses recettes en espèces, sous la nature que tu fixes, ses apports, '
  + 'ses prélèvements et le paiement en espèces d’une pièce, et ne retire ou ne remplace que ce qu’il a saisi ; ce qu’il '
  + 'saisit compte aussitôt, marqué « saisie par le client » dans l’onglet Caisse, où tu le retires ou le remplaces au besoin.'

/**
 * Ce que l'espace du client en montre (« Ma caisse », étape C12a) : sa caisse, et ce qu'il y saisit, corrige et retire ; et,
 * depuis l'étape C12b, le paiement en espèces d'une pièce, depuis « Mes pièces », à son jour et à son montant, qu'il retire
 * tant que l'exercice n'est pas validé — sans que l'écran lui montre le montant de la pièce.
 */
export const CE_QUE_MONTRE_MA_CAISSE = 'Son espace la lui montre dans « Ma caisse », où il saisit ses recettes, ses apports et '
  + 'ses prélèvements, et corrige ou retire ce qu’il a saisi ; dans « Mes pièces », il dit qu’une pièce est payée en espèces '
  + 'de sa caisse, à son jour et à son montant, et retire ce paiement — l’écran ne lui montre pas le montant de la pièce.'

/**
 * La même, la migration `correction_du_paiement_par_la_caisse` en base (C12B-Q1) : dans « Mes pièces », il corrige aussi ce
 * paiement, d'un seul geste (`remplacer_paiement_par_la_caisse`, ses propres paiements seulement).
 */
export const CE_QUE_MONTRE_MA_CAISSE_AVEC_LA_CORRECTION = CE_QUE_MONTRE_MA_CAISSE
  .replace('et retire ce paiement —', 'et corrige ou retire ce paiement —')

/** Ce que l'onglet dit de l'espace du client, selon que la correction d'un paiement est en base. */
export function ceQueMontreMaCaisseSelon(enBase: boolean): string {
  return enBase ? CE_QUE_MONTRE_MA_CAISSE_AVEC_LA_CORRECTION : CE_QUE_MONTRE_MA_CAISSE
}

/** Ce que la phrase de l'onglet dit de la case « Caisse » sur CE dossier, selon son statut de TVA. */
export function phraseDuStatutDeLaCaisse(caisse: EtatCaisseDuDossier): string {
  if (caisse.etat === 'exclu') {
    return `Ce dossier est ${NOM_DU_STATUT[caisse.statut]} : la case se coche, sur ta déclaration que `
      + (caisse.statut === 'exonere' ? 'toutes ses opérations le sont. ' : 'il relève bien de la franchise en base. ')
      + CE_QUE_LA_CASE_RETIENT
  }
  if (caisse.etat === 'tenue_par_le_cabinet') return raisonDuDossierNonExclu(caisse.statut)
  if (caisse.etat === 'en_engagement') return RAISON_DU_DOSSIER_EN_ENGAGEMENT
  if (caisse.etat === 'mode_illisible') return raisonDuModeIllisible(caisse.motif)
  return raisonDuStatutIllisible(caisse.motif)
}

/**
 * Ce que dit la case « Caisse », sous la phrase des deux autres (`ceQueDisentLesCasesDuDossier`) : ce que la base ouvre à
 * la session du client qui la porte, puis ce qu'elle devient sur CE dossier. Elle se dit en entier sur tout statut : un accès
 * d'un dossier redevable qui la porterait encore (une restauration) ouvre ce qu'elle dit.
 */
export function ceQueDitLaCaseCaisse(caisse: EtatCaisseDuDossier): string {
  const { libelle, ouvrira } = definitionDe('caisse')
  return `« ${libelle} » (${ouvrira}) : une case cochée ouvre au client, par la base, la caisse de son dossier — `
    + `${CE_QUE_LA_CASE_CAISSE_OUVRE} ${ceQueMontreMaCaisseSelon(CORRECTION_DU_PAIEMENT_EXPORTEE)} `
    + phraseDuStatutDeLaCaisse(caisse)
}

// ── La case « Comptes » (espace client, ligne 51.5, étape C4b) ─────────────────────────────────────────────────────────
// CE QU'ELLE OUVRE À LA SESSION DU CLIENT, PAR LA BASE, DÈS QU'ELLE EST COCHÉE (migration `situations_publiees`) : la policy
// `situations_publiees_lecture_comptes`, et elle seule — les publications EN COURS de son dossier, chacune avec sa date
// d'arrêté, son statut et son contenu ; ni un retrait, ni une version remplacée (`situation_publiee_en_cours`). Aucun geste :
// `publier_situation` et `retirer_situation` sont au cabinet seul. Le contenu ne porte que des centimes et les noms des postes
// de la 2035, que tout accès du dossier lit déjà dans ses catégories (`categories_select`) : aucun texte libre neuf, aucun
// libellé à écrire. droitsAcces.test.ts confronte ces termes à la migration.
export const CE_QUE_LA_CASE_COMPTES_OUVRE = 'il y lit les situations que tu lui publies, celles en cours seulement — chacune '
  + 'arrêtée à sa date, « provisoire » ou « validée », avec ses recettes, ses dépenses par poste de la 2035, son résultat, sa '
  + 'TVA due et, si tu la publies avec, la même période de l’exercice précédent —, jamais une situation retirée ni celle '
  + 'qu’une autre a remplacée.'

/** Ce que l'espace du client en montre (« Mes comptes », étape C4b), et d'où le cabinet publie. */
export const CE_QUE_MONTRE_MES_COMPTES = 'Son espace la lui montre dans « Mes comptes », où il ne fait aucun geste ; tu publies, '
  + 'remplaces ou retires une situation depuis la situation intermédiaire de l’onglet Financement.'

/** Ce que dit la case « Comptes », sous celle de « Caisse » : ce que la base ouvre au client qui la porte. */
export function ceQueDitLaCaseComptes(): string {
  const { libelle, ouvrira } = definitionDe('comptes')
  return `« ${libelle} » (${ouvrira}) : une case cochée ouvre au client, par la base, les chiffres de son dossier que tu `
    + `publies — ${CE_QUE_LA_CASE_COMPTES_OUVRE} ${CE_QUE_MONTRE_MES_COMPTES}`
}

export const TABLES_LUES_AVEC_COMPTES = ['situations_publiees'] as const

// ── Les trois cases de B1 (espace client, ligne 51.5, étape B1) ──────────────────────────────────────────────────────────
// CE QU'ELLES OUVRENT À LA SESSION DU CLIENT, PAR LA BASE : RIEN. Aucune policy ni aucune autre fonction ne les lit
// (supabase/essais/troisCasesDeLAcces.sql, rangs 12 et 13 ; le bloc TC de rls.sql) ; chacune se coche, se lit sur la ligne
// de l'accès et se trace. L'étape qui s'en servira changera sa phrase : B2 les documents, B4 les achats, B7 les notes de frais.
const ETAPE_QUI_S_EN_SERVIRA: Readonly<Record<CaseSansEffet, string>> = {
  achats: 'à ses achats (étape B4)',
  frais: 'à ses notes de frais (étape B7)',
  documents: 'aux documents que tu mets à sa disposition (étape B2)',
}

/** Ce que dit une des trois cases de B1, sous celles d'hier : elle ne change encore rien. */
export function ceQueDitLaCaseSansEffet(domaine: CaseSansEffet): string {
  const { libelle, ouvrira } = definitionDe(domaine)
  return `« ${libelle} » (${ouvrira}) : la case se coche et se garde, mais ne change encore rien — aucun écran du client ne `
    + `la lit, et la base ne lui ouvre rien de plus. Elle servira ${ETAPE_QUI_S_EN_SERVIRA[domaine]}.`
}

/** La nature des recettes du client, telle que l'onglet l'a lue et résolue parmi les catégories (lib/natureDesRecettes.ts). */
export type NatureDesRecettesDite =
  | { etat: 'fixee'; libelle: string }
  | { etat: 'absente' }
  | { etat: 'hors_produit' }
  | { etat: 'illisible' }

export interface ConfirmationDeLaCaseCaisse {
  titre: string
  /** La phrase qui nomme la personne, en trois morceaux : l'écran met une adresse dans `.courriel`, qui ne la coupe pas. */
  personne: { avant: string; personne: string; apres: string }
  paragraphes: readonly string[]
  bouton: string
}

/**
 * Ce que dit la fenêtre qui coche « Caisse » (la conception reprise, § 3) : la personne, ce que la case ouvre, la condition
 * que le cabinet déclare — selon le statut lu —, ce que la case retient, et la nature des recettes. Elle ne s'ouvre que sur
 * un dossier exclu : ailleurs la case ne se coche pas, et il n'y a pas de condition à déclarer.
 */
export function confirmationDeLaCaseCaisse(
  personne: string, statut: 'exonere' | 'franchise', nature: NatureDesRecettesDite,
): ConfirmationDeLaCaseCaisse {
  const condition = statut === 'exonere'
    ? 'Tu déclares que toutes les opérations de ce dossier sont exonérées de TVA : sinon, sa saisie des espèces devrait '
      + 'passer par un logiciel de caisse certifié ou attesté (CGI, art. 286, I, 3° bis), ce que l’application n’est pas.'
    : 'Tu déclares que ce dossier relève de la franchise en base de TVA (CGI, art. 293 B) : le jour où il la perd, décoche la '
      + 'case avant de changer son statut — au-delà, sa saisie des espèces devrait passer par un logiciel de caisse certifié '
      + 'ou attesté (CGI, art. 286, I, 3° bis), ce que l’application n’est pas.'
  const laNature = nature.etat === 'fixee'
    ? `Ses recettes en espèces se rangeront sous « ${nature.libelle} », la nature que tu as fixée pour ce dossier.`
    : nature.etat === 'absente'
      ? 'Tu n’as pas fixé la nature de ses recettes en espèces : tant qu’elle manque, la base refuse ses recettes (ses '
        + 'apports, ses prélèvements et ses paiements passent). Tu la fixes sous la liste des accès.'
      : nature.etat === 'hors_produit'
        ? 'La nature fixée pour ses recettes en espèces n’est plus une catégorie de produit du dossier : la base refuse ses '
          + 'recettes tant que tu ne l’as pas corrigée, sous la liste des accès.'
        : 'La nature de ses recettes en espèces ne se lit pas : vérifie-la sous la liste des accès, une fois la page rechargée.'
  return {
    titre: 'Ouvrir sa caisse à ce client ?',
    personne: { avant: 'Cocher « Caisse » pour ', personne, apres: ' lui ouvre aussitôt, par la base, la caisse du dossier.' },
    paragraphes: [
      `Avec la case, ${CE_QUE_LA_CASE_CAISSE_OUVRE}`,
      condition,
      CE_QUE_LA_CASE_RETIENT,
      laNature,
      ceQueMontreMaCaisseSelon(CORRECTION_DU_PAIEMENT_EXPORTEE),
    ],
    bouton: 'Cocher « Caisse »',
  }
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

// Les notes d'un DEVIS (espace client, étape P6a1) : partagées et non imprimées, comme celles d'une facture.
export const LIBELLE_NOTES_DEVIS = `Notes (elles ne figurent pas sur le devis, mais ${LE_CLIENT_VENTES} les lit)`

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

export const LIBELLE_NOTES_DEVIS_CLIENT = `Notes (elles ne figurent pas sur le devis, mais ${TON_CABINET} les lit aussi)`

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

// Le libellé d'un compte bancaire (ligne 26.6, MCB6 ; migration `comptes_bancaires`) : un texte libre que le cabinet saisit
// dans la table que `comptes_bancaires_lecture_banque` ouvre au client « Banque » (MCB-Q8) — la même condition, le même mot.
export const LIBELLE_NOM_COMPTE_BANCAIRE = `Nom du compte (${LE_CLIENT_BANQUE} le lit)`

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

// ── Ce que le client « Caisse » lit de la main du cabinet (ligne 26.6, étape C11) : AUCUN TEXTE LIBRE ───────────────────
// La règle des libellés (CLAUDE.md : un texte libre que le cabinet saisit dans une table qu'un droit du client ouvre le dit
// dans son libellé) n'a ici rien à nommer. La case ouvre une table, `operations_caisse` (la policy
// `operations_caisse_lecture_caisse`), dont les colonnes de texte sont deux listes fermées que la base vérifie — le genre
// et l'origine — et dont le reste est des dates, des montants, des taux et des identifiants ; et une fonction,
// `caisse_du_client`, qui ne rend que des jours, des montants, des identifiants et un booléen, jamais un libellé. La nature
// d'une recette est l'identifiant d'une catégorie : son libellé, le client du dossier le lit déjà, comme toute catégorie de
// son dossier (`categories_select`, ouverte à tout accès du dossier), avec ou sans la case. droitsAcces.test.ts garde les
// deux affirmations contre l'export : le jour où une colonne de texte libre y entre, le test tombe, et un libellé s'écrit.
export const TABLES_LUES_AVEC_CAISSE = ['operations_caisse'] as const
