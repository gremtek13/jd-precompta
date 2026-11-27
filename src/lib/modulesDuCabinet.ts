import type { DossierTab } from './ongletsDossier'
import type { DroitsAcces, Domaine } from './droitsAcces'

// LES OPTIONS PAR CABINET : LES MODULES ET CE QUI LEUR APPARTIENT (conception 56, lot OPT2 ; la demande du cabinet du
// 17/11/2026, « que je puisse choisir quelle option a chaque cabinet », et sa recherche du 19/11/2026 : où régler
// « précomptabilité seule » ou « comptabilité complète »). Module PUR : ni base, ni écran, ni horloge.
//
// L'application se découpe en un SOCLE toujours ouvert — le cabinet, ses dossiers, les pièces, la banque, la caisse, le
// brouillon et son FEC : la précomptabilité (OPT-Q4 (A)) — et HUIT MODULES que le super-administrateur ouvre ou ferme,
// cabinet par cabinet (`options_des_cabinets`, migration préparée d'OPT1). Ce fichier porte :
//   - la liste fermée des modules, celle de la base (`options_des_cabinets_module`), et leurs libellés ;
//   - leurs dépendances (§ 1.4) : ouvrir un module ouvre ce qu'il suppose, fermer un module se refuse tant qu'un module
//     ouvert le suppose — les mots du refus sont ceux de `regler_option_du_cabinet`, que modulesDuCabinet.test.ts confronte
//     au texte de la migration ;
//   - l'extinction gardée (OPT-Q2 (A)), liste fermée par module, et ses mots, ceux de la base ;
//   - les tables d'appartenance que les écrans (OPT3) et les Edge Functions (OPT5) liront : l'onglet d'un dossier
//     (`MODULE_DE_L_ONGLET`, un `Record<DossierTab, Module>` que le compilateur ferme), la route d'un espace
//     (`MODULE_DE_LA_ROUTE`, `MODULE_DE_LA_ROUTE_DU_CABINET`), la case d'un accès client (`MODULE_DE_LA_CASE`, fermé sur
//     `Domaine`), l'Edge Function — et, pour `send-email`, l'usage (`MODULE_DE_LA_FONCTION`) ;
//   - les mots du refus à l'écran et dans les fonctions (OPT-Q1 (A) : l'écran et les Edge Functions toujours ; en base, la
//     seule frontière de la tenue, OPT6).
// modulesDeclares.test.ts part de TOUT — les `DossierTab` de lib/ongletsDossier.ts, les `<Route>` des deux espaces lues
// dans App.tsx, les colonnes `droit_*` de l'export et des préparées, les sous-dossiers de supabase/functions/ et les usages
// de `send-email` — et met en faute ce qui n'a pas de module, ou un module pour ce qui n'existe plus.
//
// CE QU'UNE OPTION N'EST PAS (§ 3.1) : une frontière de confidentialité. Elle ne change pas qui lit quelles données ; une
// option fermée cache au cabinet des fonctions qu'il n'a pas souscrites, sur ses propres données. Elle ne change jamais un
// chiffre : un moteur ne lit pas les options (OPT-Q2 (A) : les données d'une option éteinte restent comptées et exportées).
// OPT3 le branche dans les écrans, derrière `OPTIONS_DES_CABINETS_PREVUES`, levé le 19/11/2026.

/** Le drapeau des ÉCRANS de la migration `options_des_cabinets` (OPT1), levé le 19/11/2026 : la migration est en production
 *  (244, par l'outil). Levé, la coque lit les options du cabinet du compte, un dossier celles du cabinet du dossier, le client
 *  celles de sa société affichée (OPT3), et la page du super-administrateur offre l'écran des modules (OPT4). Baissé — un
 *  retour —, aucun écran ne lit la table ni n'appelle ses deux fonctions : tout est ouvert, comme avant OPT3. */
export const OPTIONS_DES_CABINETS_PREVUES = true

// Le drapeau de la BASE, à part de celui des écrans (le patron de `COMPTES_BANCAIRES_EN_BASE`) : la migration
// `options_des_cabinets` est en production depuis le 19/11/2026 (244), la table est donc au plan de sauvegarde ; les
// écrans suivent `OPTIONS_DES_CABINETS_PREVUES`, levé le même jour.
export const OPTIONS_DES_CABINETS_EN_BASE = true

/** La table que la migration pose : une table du CABINET, hors de l'export d'un dossier (conception 56, § 7). */
export const TABLES_DES_OPTIONS_DES_CABINETS = ['options_des_cabinets'] as const

/** Les huit modules optionnels, dans l'ordre de la conception (§ 1.3) : la liste fermée de la base. Le socle n'y figure
 *  pas : il est toujours ouvert. */
export const MODULES_OPTIONNELS = [
  'tenue', 'facturation', 'facture_electronique', 'assurance_maladie', 'espace_client', 'assistant', 'honoraires',
  'connexion_bancaire',
] as const
export type ModuleOptionnel = typeof MODULES_OPTIONNELS[number]
/** Un module, le socle compris : ce à quoi un onglet, une route, une case ou une fonction appartient. */
export type Module = 'socle' | ModuleOptionnel

/** Les libellés, ceux de la base (`regler_option_du_cabinet`, ses refus) et de l'écran du super-administrateur (OPT4). */
export const LIBELLES_DES_MODULES: Readonly<Record<Module, string>> = {
  socle: 'Précomptabilité',
  tenue: 'Tenue et déclarations',
  facturation: 'Facturation',
  facture_electronique: 'Facture électronique',
  assurance_maladie: 'Paiements de l\'assurance maladie',
  espace_client: 'Espace client de gestion',
  assistant: 'Assistant IA',
  honoraires: 'Honoraires du cabinet',
  connexion_bancaire: 'Connexion bancaire',
}

/** Ce que chaque module ouvre, en une phrase (§ 1.2 et § 1.3), pour la case de l'écran du super-administrateur. */
export const CE_QU_OUVRE_LE_MODULE: Readonly<Record<Module, string>> = {
  socle: 'Les dossiers, les pièces, la banque, la caisse, les écritures du brouillon et leur FEC, l’accès client et le dépôt de pièces.',
  tenue: 'La validation de l’exercice, le bilan, la révision, l’inventaire, les immobilisations, la 2035 et ses annexes, la CA3, l’estimation des cotisations, l’écriture libre, et « Mes comptes » au client.',
  facturation: 'Les factures, les avoirs, les devis, les clients et les articles, les encaissements, la bascule des ventes, et « Mes ventes » au client.',
  facture_electronique: 'La plateforme agréée : le dépôt et le cycle de vie des factures, les statuts d’encaissement, l’e-reporting, la réception des factures.',
  assurance_maladie: 'L’import des paiements de l’assurance maladie et leur association aux crédits du relevé.',
  espace_client: 'Au client : « Ma banque », « Mon analyse », « Ma trésorerie », « Mes achats », « Mes notes de frais », « Mes documents » et « Mes demandes ».',
  assistant: 'L’assistant du dossier et la proposition de catégorie.',
  honoraires: 'Le dossier du cabinet, les lettres de mission, les honoraires à facturer et leur dépôt chez le client.',
  connexion_bancaire: 'La connexion bancaire, qui importe le relevé depuis la banque.',
}

// ── Les dépendances (§ 1.4) ─────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que chaque module suppose : les honoraires du cabinet sont des factures du dossier du cabinet (H suppose F). La
 *  facture électronique ne suppose PAS la facturation : sa réception et l'e-reporting des achats s'en passent ; son
 *  émission ne s'offre qu'avec elle, puisque l'écran des factures ne se monte qu'avec F. */
export const DEPENDANCES: Readonly<Record<ModuleOptionnel, readonly ModuleOptionnel[]>> = {
  tenue: [],
  facturation: [],
  facture_electronique: [],
  assurance_maladie: [],
  espace_client: [],
  assistant: [],
  honoraires: ['facturation'],
  connexion_bancaire: [],
}

const rang = (m: ModuleOptionnel) => MODULES_OPTIONNELS.indexOf(m)
const dansLOrdre = (modules: Iterable<ModuleOptionnel>): ModuleOptionnel[] => [...new Set(modules)].sort((a, b) => rang(a) - rang(b))

/** Vrai si le module est ouvert : le socle toujours, un module optionnel s'il est dans la liste des ouverts. */
export function estOuvert(module: Module, ouverts: readonly ModuleOptionnel[]): boolean {
  return module === 'socle' || ouverts.includes(module)
}

/** Ce qu'ouvrir un module ouvre : lui et ce qu'il suppose, de proche en proche, dans l'ordre de la liste fermée. */
export function modulesAOuvrir(module: ModuleOptionnel): ModuleOptionnel[] {
  const vus = new Set<ModuleOptionnel>()
  const pile: ModuleOptionnel[] = [module]
  while (pile.length > 0) {
    const m = pile.pop()!
    if (vus.has(m)) continue
    vus.add(m)
    pile.push(...DEPENDANCES[m])
  }
  return dansLOrdre(vus)
}

/** Les modules ouverts qui supposent celui-ci, dans l'ordre de la liste fermée : tant qu'il y en a, il ne se ferme pas. */
export function quiRetientLaFermeture(module: ModuleOptionnel, ouverts: readonly ModuleOptionnel[]): ModuleOptionnel[] {
  return dansLOrdre(ouverts.filter((o) => o !== module && modulesAOuvrir(o).includes(module)))
}

/** Un libellé entre guillemets français, comme la base l'écrit. */
const cite = (m: Module) => `« ${LIBELLES_DES_MODULES[m]} »`

/** Le refus de fermer un module qu'un module ouvert suppose, aux mots de `regler_option_du_cabinet` (P0001), ou nul. */
export function refusDeFermeture(module: ModuleOptionnel, ouverts: readonly ModuleOptionnel[]): string | null {
  const retenants = quiRetientLaFermeture(module, ouverts)
  if (retenants.length === 0) return null
  return `Le module ${cite(module)} ne se ferme pas tant qu'un module qui le suppose est ouvert : ${retenants.map(cite).join(', ')}.`
}

// ── L'extinction gardée (OPT-Q2 (A), § 4) ──────────────────────────────────────────────────────────────────────────────

/**
 * Les modules dont la base refuse la fermeture quand un dossier du cabinet en dépend pour ses chiffres ou ses obligations,
 * et pourquoi — la liste fermée de `regler_option_du_cabinet`, aux mêmes mots :
 *   - la facturation, quand un dossier a basculé ses ventes sur ses factures (`dossiers.ventes_par_les_factures`) : la
 *     bascule est irréversible, et sans l'écran plus d'avoir ni d'encaissement ;
 *   - la facture électronique, quand une facture ou la déclaration d'un encaissement est partie vers une plateforme SANS
 *     ISSUE CONNUE (`etat = 'envoi'` de `transmissions_factures` ou de `transmissions_encaissements`) : fermer l'écran
 *     perdrait de vue un envoi en vol. Un encaissement « à déclarer » se calcule en TypeScript (`pastilleDeclaration`,
 *     lib/encaissementsAffichage.ts : l'obligation due, la plateforme qui a accepté la facture) : l'écran du
 *     super-administrateur le dira avant le clic (OPT4), la base ne le refuse pas (la fiche OPT1-Q1) ;
 *   - les paiements de l'assurance maladie, quand un paiement est associé à un crédit du relevé
 *     (la table de l'association, NOE5, en production depuis le 20/11/2026 ; ce module ne la lit pas : la base la juge, et
 *     l'écran du super-administrateur le dit avant le clic, lib/optionsDesCabinetsLecture.ts).
 * Les autres modules se ferment toujours : leurs données restent en base, comptées et exportées, et rien n'y est en cours.
 */
export const EXTINCTIONS_GARDEES: Readonly<Partial<Record<ModuleOptionnel, string>>> = {
  facturation: 'les ventes de ces dossiers passent par leurs factures, irréversiblement',
  facture_electronique: 'une facture ou une déclaration d\'encaissement de ces dossiers est partie vers une plateforme sans issue connue',
  assurance_maladie: 'un paiement de l\'assurance maladie de ces dossiers est associé à un crédit du relevé',
}

/** Combien de dossiers la phrase nomme au plus ; les autres se comptent. */
export const DOSSIERS_NOMMES_AU_PLUS = 5

/**
 * Le refus d'une extinction gardée, aux mots de `regler_option_du_cabinet` (P0001) : les dossiers nommés dans l'ordre que
 * la base leur donne (leur nom, puis leur identifiant), cinq au plus, les autres comptés. Nul pour un module hors de la
 * liste, ou sans dossier.
 */
export function refusDExtinction(module: ModuleOptionnel, dossiers: readonly string[]): string | null {
  const raison = EXTINCTIONS_GARDEES[module]
  if (raison === undefined || dossiers.length === 0) return null
  const nommes = dossiers.slice(0, DOSSIERS_NOMMES_AU_PLUS).map((n) => `« ${n} »`).join(', ')
  const autres = dossiers.length - DOSSIERS_NOMMES_AU_PLUS
  return `Le module ${cite(module)} ne se ferme pas : ${raison} : ${nommes}${autres > 0 ? ` et ${autres} autre(s)` : ''}.`
}

// ── Les mots du refus, à l'écran et dans les fonctions (OPT-Q1 (A), § 3.2) ─────────────────────────────────────────────

export const MOTS_DU_REFUS = {
  /** Une adresse directe vers un écran d'un module fermé mène au socle et le dit (étage 1). */
  ecranDuCabinet: 'Ce module n’est pas ouvert à votre cabinet.',
  /** Dans un dossier, les modules sont ceux du cabinet DU DOSSIER (OPT3-Q1 (A)) : le super-administrateur qui ouvre le dossier
   *  d'un autre cabinet n'a pas de « votre cabinet » ici. */
  ecranDuDossier: 'Ce module n’est pas ouvert au cabinet de ce dossier.',
  ecranDuClient: 'Cette partie de ton espace n’est pas ouverte par ton cabinet.',
  /** Les options illisibles : seul le socle se monte, un bandeau le dit, rien ne s'écrit de ce qui n'a pas été lu. */
  optionsIllisibles: 'Les options du cabinet n’ont pas pu être lues : seul le socle s’affiche.',
  optionsDuDossierIllisibles: 'Les options du cabinet de ce dossier n’ont pas pu être lues : seul le socle s’affiche dans ce dossier.',
  /** Une Edge Function d'un module fermé refuse en 403 AVANT toute dépense (étage 2). */
  fonctionFermee: 'Ce module n’est pas ouvert au cabinet de ce dossier.',
  /** Les options illisibles par une Edge Function : 503, avant toute dépense. */
  fonctionSansOptions: 'Les options du cabinet de ce dossier n’ont pas pu être lues.',
} as const

/** Les refus de `regler_option_du_cabinet` qui précèdent les dépendances et l'extinction, aux mots de la base. */
export const REFUS_DU_REGLAGE = {
  pasSuperAdministrateur: 'Seul le super-administrateur règle les options d\'un cabinet.',
  moduleInconnu: `Ce module n'existe pas : les modules sont ${MODULES_OPTIONNELS.slice(0, -1).join(', ')} et ${MODULES_OPTIONNELS[MODULES_OPTIONNELS.length - 1]}.`,
  sensInconnu: 'Dire si le module s\'ouvre ou se ferme.',
  cabinetInconnu: 'Ce cabinet n\'existe pas.',
} as const

/** Le refus de `modules_ouverts_du_dossier` à qui n'est ni du cabinet du dossier ni l'un de ses accès client (42501). */
export const REFUS_DE_LA_LECTURE = 'Accès refusé à ce dossier.'

// ── La frontière de la tenue, en base (OPT6 ; OPT-Q1 (A), OPT-Q4 (A)) ─────────────────────────────────────────────────────

/** Le drapeau de la migration `frontiere_de_la_tenue` (OPT6, supabase/schema/20261127053521_frontiere_de_la_tenue.sql), LEVÉ :
 *  en production depuis le 27/11/2026 (255, par l'outil). Levé, la confirmation de fermer la tenue dit que la base refusera aussi la
 *  validation, la publication et l'écriture libre (`TENUE_REFUSEE_EN_BASE`). Aucun écran ne lit la table autrement : la base
 *  refuse seule, sous les mots de `REFUS_DE_LA_TENUE`, et les écrans de la tenue ne se montent déjà plus (OPT3). */
export const FRONTIERE_DE_LA_TENUE_PREVUE = true

/** Le refus de `garder_frontiere_de_la_tenue` (P0001), aux mots de la base : frontiereDeLaTenue.test.ts le confronte au texte
 *  de la migration et de son essai. */
export const REFUS_DE_LA_TENUE =
  'Le module « Tenue et déclarations » n\'est pas ouvert au cabinet de ce dossier : ni validation d\'exercice, ni situation publiée, ni écriture libre.'

/** Ce que la base refuse aux dossiers d'un cabinet sans la tenue, dit avant de la fermer (OPT6). */
export const TENUE_REFUSEE_EN_BASE =
  'La base refusera aussi aux dossiers de ce cabinet la validation d’un exercice, la publication d’une situation et l’enregistrement '
  + 'd’une écriture libre ; ce qui est déjà validé, publié ou écrit reste tel quel, et une situation publiée se retire toujours.'

/** Les phrases propres à la fermeture de la tenue, selon que la frontière est en base ou non (le drapeau, passé en paramètre
 *  pour que ses deux états s'éprouvent). */
export function phrasesDeLaFermetureDeLaTenue(frontiereEnBase: boolean): string[] {
  return frontiereEnBase ? [TENUE_REFUSEE_EN_BASE] : []
}

// ── Les sections d'un écran du socle qui appartiennent à un module (OPT3) ───────────────────────────────────────────────

/**
 * Les composants qu'un écran du socle monte comme SECTION d'un module : chacun ne se monte que sous `estOuvert(<son module>, …)`,
 * à chaque point de montage (modulesDeclares.test.ts le lit dans l'expression JSX qui le monte). Un composant du socle n'y
 * figure pas. Liste FERMÉE tenue à la main — une section ne se reconnaît pas à sa forme — : le scanner la confronte aussi aux
 * fichiers de components/ et pages/ dont le nom désigne un module (`NOMS_DES_SECTIONS`), pour qu'une section neuve d'un module
 * connu n'y échappe pas.
 */
export const MODULE_DE_LA_SECTION: Readonly<Record<string, ModuleOptionnel>> = {
  PaiementsAssuranceMaladie: 'assurance_maladie',
  FactureAssuranceMaladie: 'assurance_maladie',
  DuContrePaye: 'assurance_maladie',
  AssociationDansLaSection: 'assurance_maladie',
  EcrituresLibresSection: 'tenue',
  ConnexionBancaireCard: 'connexion_bancaire',
}

/** Les noms de fichier qui désignent un module : tout composant ainsi nommé, monté hors de son propre fichier, est une section
 *  de ce module et doit figurer dans `MODULE_DE_LA_SECTION`. */
export const NOMS_DES_SECTIONS: readonly (readonly [RegExp, ModuleOptionnel])[] = [
  [/AssuranceMaladie|DuContrePaye/, 'assurance_maladie'],
  [/EcrituresLibres|EcritureLibre/, 'tenue'],
  [/ConnexionBancaire/, 'connexion_bancaire'],
]

// ── La lecture (le côté fermé) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Les modules ouverts tels que `modules_ouverts_du_dossier` les rend (un tableau de textes de la liste fermée, chacun une
 * fois), ou nul pour toute autre forme : une valeur inconnue fait tomber la lecture du côté FERMÉ (le socle seul), jamais
 * ouvrir un module qu'on n'a pas su lire. Rendus dans l'ordre de la liste fermée.
 */
export function modulesLus(valeur: unknown): ModuleOptionnel[] | null {
  if (!Array.isArray(valeur)) return null
  const connus = MODULES_OPTIONNELS as readonly string[]
  if (!valeur.every((v): v is ModuleOptionnel => typeof v === 'string' && connus.includes(v))) return null
  if (new Set(valeur).size !== valeur.length) return null
  return dansLOrdre(valeur)
}

// ── Les tables d'appartenance ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Le module de chaque onglet d'un dossier (§ 1.3 et § 1.5). Écritures, la balance, Banque, Caisse, Cotisations,
 * Financement et Virements sont la précomptabilité (OPT-Q4 (A) : le brouillon et son FEC) ; Clôture, Bilan, Révision,
 * Inventaire, Immobilisations, Estimation et Suppléments, la tenue. TVA se monte toujours : le statut de TVA du dossier
 * est du socle (le montant retenu, la case « Caisse ») ; sa section CA3 suit la tenue (OPT3).
 */
export const MODULE_DE_L_ONGLET: Readonly<Record<DossierTab, Module>> = {
  checklist: 'socle',
  documents: 'socle',
  pieces: 'socle',
  factures: 'facturation',
  banque: 'socle',
  caisse: 'socle',
  ecritures: 'socle',
  statistiques: 'socle',
  bilan: 'tenue',
  revision: 'tenue',
  tva: 'socle',
  immobilisations: 'tenue',
  cotisations: 'socle',
  inventaire: 'tenue',
  cloture: 'tenue',
  estimation: 'tenue',
  financement: 'socle',
  supplements: 'tenue',
  packs: 'socle',
  informations: 'socle',
  virements: 'socle',
  acces: 'socle',
}

/** Les routes de l'espace client (App.tsx, le bloc `role === 'client'`), hors de la redirection `*`. */
export const ROUTES_DE_L_ESPACE_CLIENT = [
  '/accueil', '/mes-pieces', '/mes-informations', '/ma-simulation', '/mon-echeancier', '/mes-ventes', '/ma-banque',
  '/ma-caisse', '/mes-comptes', '/mes-documents', '/mes-lettres-de-mission', '/mes-demandes', '/mes-achats',
  '/mes-notes-de-frais', '/mon-analyse', '/ma-tresorerie', '/securite',
] as const
export type RouteDeLEspaceClient = typeof ROUTES_DE_L_ESPACE_CLIENT[number]

/**
 * Le module de chaque route de l'espace client. Une route s'ouvre quand son module est ouvert ET que son prédicat d'hier
 * (`mesVentesOuvertes`, `maBanqueOuverte`…) l'ouvre sur des droits dont chaque case est masquée par SON module
 * (`MODULE_DE_LA_CASE`) — ce qui dit les écrans à deux modules sans liste de plus : « Mes lettres de mission » (H) sous la
 * case « Documents » (C), « Mon analyse » (C) ouverte par la case « Ventes » (F) ou « Banque » (C). « Ma simulation »
 * appelle l'estimation des cotisations, de la tenue (§ 1.5).
 */
export const MODULE_DE_LA_ROUTE: Readonly<Record<RouteDeLEspaceClient, Module>> = {
  '/accueil': 'socle',
  '/mes-pieces': 'socle',
  '/mes-informations': 'socle',
  '/ma-simulation': 'tenue',
  '/mon-echeancier': 'socle',
  '/mes-ventes': 'facturation',
  '/ma-banque': 'espace_client',
  '/ma-caisse': 'socle',
  '/mes-comptes': 'tenue',
  '/mes-documents': 'espace_client',
  '/mes-lettres-de-mission': 'honoraires',
  '/mes-demandes': 'espace_client',
  '/mes-achats': 'espace_client',
  '/mes-notes-de-frais': 'espace_client',
  '/mon-analyse': 'espace_client',
  '/ma-tresorerie': 'espace_client',
  '/securite': 'socle',
}

/** Les routes du cabinet (App.tsx, le bloc `role === 'cabinet'`), hors de la redirection `*`. */
export const ROUTES_DU_CABINET = [
  '/dossiers', '/dossiers/:id', '/dossiers/:id/:tab', '/comptes-master', '/equipe', '/apparence', '/retour-banque',
  '/securite',
] as const
export type RouteDuCabinet = typeof ROUTES_DU_CABINET[number]

/** Le module de chaque route du cabinet : le socle, sauf le retour de la banque après son accord (la connexion bancaire).
 *  Un onglet d'un dossier se juge par `MODULE_DE_L_ONGLET`. */
export const MODULE_DE_LA_ROUTE_DU_CABINET: Readonly<Record<RouteDuCabinet, Module>> = {
  '/dossiers': 'socle',
  '/dossiers/:id': 'socle',
  '/dossiers/:id/:tab': 'socle',
  '/comptes-master': 'socle',
  '/equipe': 'socle',
  '/apparence': 'socle',
  '/retour-banque': 'connexion_bancaire',
  '/securite': 'socle',
}

/** Ce qui, dans les routes, n'est l'écran d'aucun module, avec sa raison. */
export const ROUTES_HORS_DES_MODULES: Readonly<Record<string, string>> = {
  '*': 'la redirection d’une adresse inconnue vers l’accueil de l’espace : aucun écran',
}

/**
 * Le module de chaque case d'un accès client (§ 1.3) : une case ne s'offre que si son module est ouvert ; cochée, elle
 * reste en base quand il se ferme (`memberships` intacte : le rouvrir rend l'accès tel qu'il était, § 3.3).
 */
export const MODULE_DE_LA_CASE: Readonly<Record<Domaine, Module>> = {
  ventes: 'facturation',
  banque: 'espace_client',
  caisse: 'socle',
  comptes: 'tenue',
  achats: 'espace_client',
  frais: 'espace_client',
  documents: 'espace_client',
}

/** Les Edge Functions (les sous-dossiers de supabase/functions/). */
export const FONCTIONS_EDGE = [
  'agent-comptable', 'banque-connexion', 'create-cabinet', 'create-client-access', 'create-team-member', 'delete-cabinet',
  'evaluer-extraction', 'extract-piece', 'plateforme-agreee', 'proposer-categorie', 'receive-email', 'send-email',
  'superpdp-credentials', 'superpdp-emit', 'superpdp-sync', 'taux-change-bce',
] as const
export type FonctionEdge = typeof FONCTIONS_EDGE[number]

/** Les usages de `send-email` : les clés de son `QUI_PEUT_QUOI`. */
export const USAGES_DE_SEND_EMAIL = ['facture', 'devis', 'relance_pieces', 'relance_facture', 'relance_demande'] as const
export type UsageDeSendEmail = typeof USAGES_DE_SEND_EMAIL[number]

/** Ce qu'une Edge Function exige : un module, un module par usage (`send-email`), ou rien (hors des modules, sa raison). */
export type ExigenceDUneFonction =
  | { readonly module: Module }
  | { readonly parUsage: Readonly<Record<UsageDeSendEmail, Module>> }
  | { readonly horsDesModules: string }

/**
 * Le module de chaque Edge Function (§ 1.3). Les sept fonctions de modules refusent en 403 avant toute dépense (OPT5, le
 * bloc OPTION DU CABINET, optionDuCabinetCopie.test.ts) ;
 * `send-email` juge l'usage : la relance de pièces est du socle, la facture, le devis et la relance d'une facture de la
 * facturation, la relance d'une demande de l'espace client de gestion (« Mes demandes »).
 */
export const MODULE_DE_LA_FONCTION: Readonly<Record<FonctionEdge, ExigenceDUneFonction>> = {
  'agent-comptable': { module: 'assistant' },
  'banque-connexion': { module: 'connexion_bancaire' },
  'create-cabinet': { module: 'socle' },
  'create-client-access': { module: 'socle' },
  'create-team-member': { module: 'socle' },
  'delete-cabinet': { module: 'socle' },
  'evaluer-extraction': { horsDesModules: 'un harnais de mesure, que sa fenêtre datée ferme (ESSAI_OUVERT_JUSQU_A)' },
  'extract-piece': { module: 'socle' },
  'plateforme-agreee': { module: 'facture_electronique' },
  'proposer-categorie': { module: 'assistant' },
  'receive-email': { module: 'socle' },
  'send-email': {
    parUsage: {
      facture: 'facturation',
      devis: 'facturation',
      relance_pieces: 'socle',
      relance_facture: 'facturation',
      relance_demande: 'espace_client',
    },
  },
  'superpdp-credentials': { module: 'facture_electronique' },
  'superpdp-emit': { module: 'facture_electronique' },
  'superpdp-sync': { module: 'facture_electronique' },
  'taux-change-bce': { module: 'socle' },
}

/** Le module qu'un appel d'une Edge Function exige — l'usage pour `send-email` —, ou nul hors des modules. Un usage
 *  inconnu de `send-email` rend nul aussi : la fonction le refuse elle-même (400) avant toute lecture. */
export function moduleDeLAppel(fonction: FonctionEdge, usage?: string): Module | null {
  const exigence = MODULE_DE_LA_FONCTION[fonction]
  if ('module' in exigence) return exigence.module
  if ('parUsage' in exigence) {
    return (USAGES_DE_SEND_EMAIL as readonly string[]).includes(usage ?? '') ? exigence.parUsage[usage as UsageDeSendEmail] : null
  }
  return null
}

/** Les modules optionnels qu'au moins un onglet, une route, une case ou une fonction emploie : chacun a un écran. */
export function modulesEmployes(): ModuleOptionnel[] {
  const employes: Module[] = [
    ...Object.values(MODULE_DE_L_ONGLET), ...Object.values(MODULE_DE_LA_ROUTE), ...Object.values(MODULE_DE_LA_ROUTE_DU_CABINET),
    ...Object.values(MODULE_DE_LA_CASE),
    ...Object.values(MODULE_DE_LA_FONCTION).flatMap((e) => ('module' in e ? [e.module] : 'parUsage' in e ? Object.values(e.parUsage) : [])),
  ]
  return dansLOrdre(employes.filter((m): m is ModuleOptionnel => m !== 'socle'))
}


// ── Les modules affichés (OPT3) ────────────────────────────────────────────────────────────────────────────────────────

/** Tous les modules optionnels ouverts : l'état d'un cabinet existant le jour de la migration, et celui de l'application
 *  tant que le drapeau est baissé (aucune lecture : tout s'affiche comme hier). */
export const TOUS_LES_MODULES: readonly ModuleOptionnel[] = MODULES_OPTIONNELS

/** Vrai si l'onglet d'un dossier appartient à un module ouvert. */
export function ongletOuvert(tab: DossierTab, ouverts: readonly ModuleOptionnel[]): boolean {
  return estOuvert(MODULE_DE_L_ONGLET[tab], ouverts)
}

/** Vrai si la route de l'espace client appartient à un module ouvert — son prédicat d'hier (la case, le drapeau) s'y
 *  ajoute, jamais ne s'y substitue. */
export function routeDuClientOuverte(route: RouteDeLEspaceClient, ouverts: readonly ModuleOptionnel[]): boolean {
  return estOuvert(MODULE_DE_LA_ROUTE[route], ouverts)
}

/** Vrai si la route du cabinet appartient à un module ouvert. */
export function routeDuCabinetOuverte(route: RouteDuCabinet, ouverts: readonly ModuleOptionnel[]): boolean {
  return estOuvert(MODULE_DE_LA_ROUTE_DU_CABINET[route], ouverts)
}

/**
 * Les droits d'un accès tels que l'écran les lit : chaque case masquée par SON module (`MODULE_DE_LA_CASE`). La case reste
 * en base (§ 3.3) ; elle n'ouvre plus rien à l'écran tant que son module est fermé. Tous les modules ouverts, les droits
 * reviennent identiques, champ par champ.
 */
export function droitsMasques(droits: DroitsAcces, ouverts: readonly ModuleOptionnel[]): DroitsAcces {
  const masque = (d: Domaine) => droits[d] && estOuvert(MODULE_DE_LA_CASE[d], ouverts)
  return {
    ventes: masque('ventes'), banque: masque('banque'), caisse: masque('caisse'), comptes: masque('comptes'),
    achats: masque('achats'), frais: masque('frais'), documents: masque('documents'),
  }
}
