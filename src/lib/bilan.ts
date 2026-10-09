import { COMPTE_CLIENTS, COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS } from './comptes'
import { calculerBalance } from './ecritures'
import { auxiliaireDuTiers, type ModeleComptable } from './engagement'
import { anneeDe, formatDate, formatMoney } from './format'
import { etatDeLOuverture, exploitantIndividuel, ouvertureDeLExercice, type EtatDeLOuverture } from './reportDesSoldes'
import { refusDeLOuverture, soldeDuCompteCentimes } from './revisionSoldes'
import type { ANouveau, Categorie, EcritureBrouillon, Piece, SensEcriture, SoldeReporte } from './types'

// LE BILAN D'UN EXERCICE À SA CLÔTURE — ligne 33 de la feuille de route, première brique (09/10/2026).
//
// Le bilan « décrit séparément les éléments actifs et passifs de l'entité et fait apparaître de façon distincte les
// capitaux propres » ; « aucune compensation ne peut être opérée entre les postes d'actif et de passif » (PCG, art. 112-2,
// version consolidée au 1er janvier 2026 ; code de commerce, art. L123-13 et L123-19). Il se lit ici depuis les SOLDES :
// l'ouverture de l'exercice — la balance reprise ou les soldes reportés de l'exercice validé qui le précède
// (`ouvertureDeLExercice`) — et ses écritures, les mêmes que la Balance des comptes de l'exercice ; le solde de chaque
// compte est celui que la révision justifie (`soldeDuCompteCentimes`, lib/revisionSoldes.ts). Rien n'est écrit.
//
// LE FORMAT EST CELUI DU 2033-A-SD (millésime 2026, cerfa n° 15948*08), le bilan simplifié du régime réel simplifié, qui
// suit le modèle abrégé du PCG (art. 822-1) : ses rubriques et leurs cases, pour que le même calcul serve un jour la
// liasse (ligne 37). La colonne « net » de l'actif n'a pas de case : elle se calcule (brut moins amortissements).
//
// LE PASSAGE DES COMPTES AUX RUBRIQUES (`regleDuCompte`) se lit au numéro du compte et, quand il le faut, au SENS de son
// solde :
//   - un compte de banque créditeur est un concours bancaire : « Emprunts et dettes assimilées » ; deux comptes de banque
//     ne se compensent pas (PCG, art. 1215-51) ;
//   - un fournisseur débiteur est une créance (« les soldes débiteurs des comptes fournisseurs […] sont virés au débit du
//     compte 4097 », art. 1214-40) : « Autres créances » ; un client créditeur, une dette : « Autres dettes » (4197) ;
//     et c'est tiers par tiers que le sens se juge, le détail de chaque fournisseur et de chaque client vivant dans le
//     compte AUXILIAIRE du FEC (`auxiliaireDuTiers`, lib/engagement.ts) : un client qui a trop payé ne se compense pas
//     avec un client qui doit ;
//   - les amortissements et les dépréciations (28, 29, 39, 49, 59) vont dans la colonne 2 de la rubrique de leur compte ;
//   - le résultat de l'exercice est celui de ses classes 6 et 7 ;
//   - les capitaux propres suivent la forme de l'entreprise, que l'application DÉDUIT du compte du dirigeant comme le
//     report des soldes le fait (`exploitantIndividuel`) : pour une entreprise individuelle, « le compte de l'exploitant
//     tient lieu de compte capital » (notice 2033-NOT-SD, case 120), et les résultats antérieurs y sont versés (PCG,
//     art. 1211-10 et 1211-12) ; une société garde le résultat d'un exercice précédent en 120 ou en 129 tant que son
//     affectation n'est pas écrite, et ce bilan le présente à part plutôt que de deviner l'affectation.
// Un compte qu'aucune rubrique du formulaire ne nomme (des primes d'émission, un écart de conversion, des frais
// d'établissement…) n'est rangé nulle part au jugé : il est présenté à part, « à classer », du côté de son solde, et le
// bilan le dit. Les totaux restent justes ; c'est la case qui attend le cabinet.
//
// L'ÉQUILIBRE SE JUGE AU CENTIME, en centimes entiers : actif net = passif. Un écart a deux causes possibles, et le
// bilan dit laquelle — des écritures (ou une ouverture) qui ne s'équilibrent pas, ou un compte hors des classes 1 à 7
// qui porte un solde, que ni le bilan ni le résultat ne comptent.
//
// CE QUE L'APPLICATION N'ÉCRIT PAS ENCORE ne se devine pas : les écritures d'inventaire (stocks, charges et produits
// constatés d'avance, factures non parvenues et à établir, provisions, dépréciations — lignes 35 et 36) et
// l'affectation du résultat d'une société. Un compte de ces familles que l'exercice ne mouvemente pas — il garde à la
// clôture le solde de l'ouverture — se signale ; le reste est dit par l'écran.
//
// UN BILAN QUI SERAIT FAUX NE S'ÉTABLIT PAS. Un exercice dont l'ouverture attend la validation du précédent
// (`etatDeLOuverture`, décision du cabinet du 06/10/2026) aurait ses comptes de bilan partis de zéro : son bilan
// s'équilibrerait — toute écriture est en partie double — et chaque ligne serait fausse. Il n'est pas calculé, et le
// motif le dit. De même d'un exercice antérieur à la reprise d'un dossier, dont les comptes sont dans l'ancien logiciel.
//
// Entrées en paramètres OBLIGATOIRES, montants en centimes, aucun accès à la base : `bilan.test.ts` le confronte à des
// bilans calculés à la main.

// ── Les rubriques du 2033-A-SD ─────────────────────────────────────────────────────────────────────────────────

export type IdRubriqueActif =
  | 'fonds-commercial' | 'autres-incorporelles' | 'corporelles' | 'financieres'
  | 'matieres' | 'marchandises' | 'avances-versees' | 'clients' | 'autres-creances'
  | 'charges-constatees-avance' | 'vmp' | 'disponibilites'
  | 'a-classer-actif'

export type IdRubriquePassif =
  | 'capital' | 'ecarts-reevaluation' | 'reserve-legale' | 'reserves-reglementees' | 'autres-reserves'
  | 'report-a-nouveau' | 'resultat' | 'resultats-en-attente' | 'subventions' | 'provisions-reglementees'
  | 'provisions'
  | 'emprunts' | 'avances-recues' | 'fournisseurs' | 'dettes-fiscales-sociales' | 'comptes-courants'
  | 'autres-dettes' | 'produits-constates-avance'
  | 'a-classer-passif'

export type MasseActif = 'immobilise' | 'circulant' | 'a-classer'
export type MassePassif = 'capitaux-propres' | 'provisions' | 'dettes' | 'a-classer'

export interface DefinitionRubriqueActif {
  id: IdRubriqueActif
  libelle: string
  masse: MasseActif
  /** Les cases du 2033-A-SD : le brut (colonne 1) et les amortissements ou dépréciations (colonne 2). Nulles hors du formulaire. */
  cases: { brut: string; amortissements: string } | null
}

export interface DefinitionRubriquePassif {
  id: IdRubriquePassif
  libelle: string
  masse: MassePassif
  /** La case du 2033-A-SD ; nulle pour ce que le formulaire ne nomme pas. */
  case: string | null
}

// Dans l'ordre du formulaire, ligne par ligne : les charges constatées d'avance y précèdent les valeurs mobilières de
// placement et les disponibilités, et leurs cases ne suivent pas cet ordre.
export const RUBRIQUES_ACTIF: readonly DefinitionRubriqueActif[] = [
  { id: 'fonds-commercial', libelle: 'Fonds commercial', masse: 'immobilise', cases: { brut: '010', amortissements: '012' } },
  { id: 'autres-incorporelles', libelle: 'Autres immobilisations incorporelles', masse: 'immobilise', cases: { brut: '014', amortissements: '016' } },
  { id: 'corporelles', libelle: 'Immobilisations corporelles', masse: 'immobilise', cases: { brut: '028', amortissements: '030' } },
  { id: 'financieres', libelle: 'Immobilisations financières', masse: 'immobilise', cases: { brut: '040', amortissements: '042' } },
  {
    id: 'matieres', libelle: 'Matières premières, approvisionnements, en cours de production', masse: 'circulant',
    cases: { brut: '050', amortissements: '052' },
  },
  { id: 'marchandises', libelle: 'Marchandises', masse: 'circulant', cases: { brut: '060', amortissements: '062' } },
  { id: 'avances-versees', libelle: 'Avances et acomptes versés sur commandes', masse: 'circulant', cases: { brut: '064', amortissements: '066' } },
  { id: 'clients', libelle: 'Clients et comptes rattachés', masse: 'circulant', cases: { brut: '068', amortissements: '070' } },
  { id: 'autres-creances', libelle: 'Autres créances', masse: 'circulant', cases: { brut: '072', amortissements: '074' } },
  { id: 'charges-constatees-avance', libelle: 'Charges constatées d’avance', masse: 'circulant', cases: { brut: '092', amortissements: '094' } },
  { id: 'vmp', libelle: 'Valeurs mobilières de placement', masse: 'circulant', cases: { brut: '080', amortissements: '082' } },
  { id: 'disponibilites', libelle: 'Disponibilités', masse: 'circulant', cases: { brut: '084', amortissements: '086' } },
  { id: 'a-classer-actif', libelle: 'Comptes à classer', masse: 'a-classer', cases: null },
]

export const RUBRIQUES_PASSIF: readonly DefinitionRubriquePassif[] = [
  { id: 'capital', libelle: 'Capital social ou individuel', masse: 'capitaux-propres', case: '120' },
  { id: 'ecarts-reevaluation', libelle: 'Écarts de réévaluation', masse: 'capitaux-propres', case: '124' },
  { id: 'reserve-legale', libelle: 'Réserve légale', masse: 'capitaux-propres', case: '126' },
  { id: 'reserves-reglementees', libelle: 'Réserves réglementées', masse: 'capitaux-propres', case: '130' },
  { id: 'autres-reserves', libelle: 'Autres réserves', masse: 'capitaux-propres', case: '132' },
  { id: 'report-a-nouveau', libelle: 'Report à nouveau', masse: 'capitaux-propres', case: '134' },
  { id: 'resultat', libelle: 'Résultat de l’exercice', masse: 'capitaux-propres', case: '136' },
  // Hors du formulaire : le résultat d'un exercice précédent qu'une société n'a pas encore affecté. Le 2033-A le
  // suppose réparti entre réserves, report à nouveau et dividendes ; l'application n'écrit pas encore cette décision.
  { id: 'resultats-en-attente', libelle: 'Résultats antérieurs en attente d’affectation', masse: 'capitaux-propres', case: null },
  { id: 'subventions', libelle: 'Subventions d’investissement', masse: 'capitaux-propres', case: '137' },
  { id: 'provisions-reglementees', libelle: 'Provisions réglementées', masse: 'capitaux-propres', case: '140' },
  { id: 'provisions', libelle: 'Provisions pour risques et charges', masse: 'provisions', case: '154' },
  { id: 'emprunts', libelle: 'Emprunts et dettes assimilées', masse: 'dettes', case: '156' },
  { id: 'avances-recues', libelle: 'Avances et acomptes reçus sur commandes en cours', masse: 'dettes', case: '164' },
  { id: 'fournisseurs', libelle: 'Fournisseurs et comptes rattachés', masse: 'dettes', case: '166' },
  { id: 'dettes-fiscales-sociales', libelle: 'Dettes fiscales et sociales', masse: 'dettes', case: '172' },
  { id: 'comptes-courants', libelle: 'Comptes courants d’associés', masse: 'dettes', case: '173' },
  { id: 'autres-dettes', libelle: 'Autres dettes', masse: 'dettes', case: '175' },
  { id: 'produits-constates-avance', libelle: 'Produits constatés d’avance', masse: 'dettes', case: '174' },
  { id: 'a-classer-passif', libelle: 'Comptes à classer', masse: 'a-classer', case: null },
]

/** Les cases des totaux du 2033-A-SD. */
export const CASES_DES_TOTAUX = {
  actifImmobilise: { brut: '044', amortissements: '048' },
  actifCirculant: { brut: '096', amortissements: '098' },
  totalActif: { brut: '110', amortissements: '112' },
  capitauxPropres: '142',
  provisions: '154',
  dettes: '176',
  totalPassif: '180',
  // Les renvois que ce bilan sait calculer : la TVA comprise dans les dettes fiscales et sociales, et les comptes
  // courants d'associés débiteurs compris dans les autres créances.
  dontTva: '169',
  dontComptesCourantsDebiteurs: '199',
} as const

// ── Le passage des comptes aux rubriques ───────────────────────────────────────────────────────────────────────

/** Où va un solde : une rubrique de l'actif (et sa colonne), une rubrique du passif, ou « à classer », avec sa raison. */
export type Destination =
  | { cote: 'actif'; rubrique: IdRubriqueActif; colonne: 'brut' | 'amortissements' }
  | { cote: 'passif'; rubrique: IdRubriquePassif }
  | { cote: 'a-classer'; raison: string }

export interface RegleDuCompte {
  debiteur: Destination
  crediteur: Destination
  /**
   * Le sens d'un solde ordinaire. L'autre sens reste dans la même rubrique, en négatif, et se dit inhabituel : une
   * caisse créditrice ou un amortissement débiteur sont des erreurs à corriger, pas des postes à déplacer. Nul quand les
   * deux sens sont ordinaires — un compte de tiers, une banque, le compte de l'exploitant, le report à nouveau.
   */
  sensOrdinaire: SensEcriture | null
}

const brut = (rubrique: IdRubriqueActif): Destination => ({ cote: 'actif', rubrique, colonne: 'brut' })
const passif = (rubrique: IdRubriquePassif): Destination => ({ cote: 'passif', rubrique })
const aClasser = (raison: string): Destination => ({ cote: 'a-classer', raison })
const ordinaire = (vers: Destination, sens: SensEcriture): RegleDuCompte => ({ debiteur: vers, crediteur: vers, sensOrdinaire: sens })
const deuxSens = (vers: Destination): RegleDuCompte => ({ debiteur: vers, crediteur: vers, sensOrdinaire: null })
const selonLeSens = (debiteur: Destination, crediteur: Destination): RegleDuCompte => ({ debiteur, crediteur, sensOrdinaire: null })
const nonNomme = (raison: string): RegleDuCompte => deuxSens(aClasser(raison))

/** La raison d'un compte de bilan que la table ne connaît pas. */
export const RAISON_COMPTE_INCONNU = 'Aucune rubrique du 2033-A ne nomme ce compte : à classer par le cabinet.'
const RAISON_ATTENTE = 'Compte transitoire ou d’attente : ses opérations se reclassent en fin d’exercice parmi les comptes '
  + 'du bilan (PCG, art. 1214-47).'
const RAISON_VIREMENTS_INTERNES_CREDITEURS = 'Virements internes au crédit : plus de fonds reviennent de l’autre compte du '
  + 'professionnel qu’il n’y en est parti, et son solde n’est pas tenu dans l’application.'

// La table, par préfixe : le plus long l'emporte (4091 avant 409, 409 avant 40). Sources : les libellés du 2033-A-SD et
// de sa notice (2033-NOT-SD 2026), le modèle abrégé du PCG (art. 822-1) et le fonctionnement des comptes (art. 1211-10
// et suivants). Quatre entrées dépendent de la forme de l'entreprise.
type Entree = RegleDuCompte | ((individuel: boolean) => RegleDuCompte)

const TABLE: ReadonlyMap<string, Entree> = new Map<string, Entree>([
  // Classe 1 — capitaux.
  // Le capital individuel suit les apports et les prélèvements : il peut être débiteur sans erreur.
  ['101', (individuel) => (individuel ? deuxSens(passif('capital')) : ordinaire(passif('capital'), 'credit'))],
  ['104', nonNomme('Primes liées au capital : aucune rubrique du 2033-A ne les nomme.')],
  ['105', ordinaire(passif('ecarts-reevaluation'), 'credit')],
  ['106', nonNomme('Réserves non subdivisées : le compte ne dit pas laquelle — légale, réglementée ou autre.')],
  ['1061', ordinaire(passif('reserve-legale'), 'credit')],
  ['1062', ordinaire(passif('autres-reserves'), 'credit')],
  ['1063', ordinaire(passif('autres-reserves'), 'credit')],
  ['1064', ordinaire(passif('reserves-reglementees'), 'credit')],
  ['1068', ordinaire(passif('autres-reserves'), 'credit')],
  ['107', nonNomme('Écart d’équivalence : aucune rubrique du 2033-A ne le nomme.')],
  // « Dans les entreprises individuelles, le "compte de l'exploitant" tient lieu de compte "capital" » (notice, case 120).
  ['108', (individuel) => (individuel ? deuxSens(passif('capital'))
    : nonNomme('Compte de l’exploitant dans une société : il n’existe que dans une entreprise individuelle.'))],
  ['109', nonNomme('Capital souscrit non appelé : aucune rubrique du 2033-A ne le nomme.')],
  ['11', deuxSens(passif('report-a-nouveau'))],
  // Le résultat d'un exercice précédent : versé au capital d'une entreprise individuelle (PCG, art. 1211-12), en
  // attente d'affectation dans une société.
  ['12', (individuel) => deuxSens(passif(individuel ? 'capital' : 'resultats-en-attente'))],
  ['1209', nonNomme('Acomptes sur dividendes : ils se soldent à l’affectation du résultat.')],
  // 131 au crédit, 139 au débit : les deux sens sont ordinaires.
  ['13', deuxSens(passif('subventions'))],
  ['14', ordinaire(passif('provisions-reglementees'), 'credit')],
  ['15', ordinaire(passif('provisions'), 'credit')],
  ['16', ordinaire(passif('emprunts'), 'credit')],
  ['167', nonNomme('Fonds non remboursables et avances conditionnées : autres fonds propres, qu’aucune rubrique du 2033-A ne nomme.')],
  ['169', nonNomme('Primes de remboursement des emprunts : un compte de régularisation de l’actif, qu’aucune rubrique du 2033-A ne nomme.')],
  ['17', ordinaire(passif('emprunts'), 'credit')],
  ['18', nonNomme('Compte de liaison : il se solde entre établissements, hors du bilan de l’entreprise.')],
  // Classe 2 — immobilisations. Le droit au bail est dans le fonds commercial (notice, case 010).
  ['20', ordinaire(brut('autres-incorporelles'), 'debit')],
  ['201', nonNomme('Frais d’établissement : aucune rubrique du 2033-A ne les nomme.')],
  ['206', ordinaire(brut('fonds-commercial'), 'debit')],
  ['207', ordinaire(brut('fonds-commercial'), 'debit')],
  ['21', ordinaire(brut('corporelles'), 'debit')],
  ['22', ordinaire(brut('corporelles'), 'debit')],
  ['229', nonNomme('Droits du concédant : autres fonds propres, qu’aucune rubrique du 2033-A ne nomme.')],
  ['23', ordinaire(brut('corporelles'), 'debit')],
  ['232', ordinaire(brut('autres-incorporelles'), 'debit')],
  ['237', ordinaire(brut('autres-incorporelles'), 'debit')],
  ['26', ordinaire(brut('financieres'), 'debit')],
  ['269', nonNomme('Versements restant à effectuer sur des titres non libérés : aucune rubrique du 2033-A ne les nomme.')],
  ['27', ordinaire(brut('financieres'), 'debit')],
  ['279', nonNomme('Versements restant à effectuer sur des titres non libérés : aucune rubrique du 2033-A ne les nomme.')],
  // Classe 3 — stocks : le formulaire n'a que deux lignes.
  ['31', ordinaire(brut('matieres'), 'debit')],
  ['32', ordinaire(brut('matieres'), 'debit')],
  ['33', ordinaire(brut('matieres'), 'debit')],
  ['34', ordinaire(brut('matieres'), 'debit')],
  ['35', nonNomme('Stock de produits : les deux lignes de stocks du 2033-A nomment les matières et les marchandises.')],
  ['36', nonNomme('Stock provenant d’immobilisations : aucune rubrique du 2033-A ne le nomme.')],
  ['37', ordinaire(brut('marchandises'), 'debit')],
  ['38', nonNomme('Stock en voie d’acheminement : il se reclasse dans le stock qu’il deviendra.')],
  // Classe 4 — tiers. Le compte 40 est celui que porte la case 166 : le fournisseur d'immobilisations (404) y va, faute
  // de la ligne « dettes sur immobilisations » que le modèle de base du PCG (art. 821-1) a et que le 2033-A n'a pas.
  ['40', selonLeSens(brut('autres-creances'), passif('fournisseurs'))],
  ['409', ordinaire(brut('autres-creances'), 'debit')],
  ['4091', ordinaire(brut('avances-versees'), 'debit')],
  ['41', selonLeSens(brut('clients'), passif('autres-dettes'))],
  ['419', ordinaire(passif('autres-dettes'), 'credit')],
  ['4191', ordinaire(passif('avances-recues'), 'credit')],
  ['42', selonLeSens(brut('autres-creances'), passif('dettes-fiscales-sociales'))],
  ['43', selonLeSens(brut('autres-creances'), passif('dettes-fiscales-sociales'))],
  ['44', selonLeSens(brut('autres-creances'), passif('dettes-fiscales-sociales'))],
  ['45', selonLeSens(brut('autres-creances'), passif('autres-dettes'))],
  ['455', selonLeSens(brut('autres-creances'), passif('comptes-courants'))],
  ['457', ordinaire(passif('autres-dettes'), 'credit')],
  ['46', selonLeSens(brut('autres-creances'), passif('autres-dettes'))],
  ['47', nonNomme(RAISON_ATTENTE)],
  ['474', nonNomme('Différences d’évaluation : aucune rubrique du 2033-A ne les nomme.')],
  ['475', nonNomme('Différences d’évaluation : aucune rubrique du 2033-A ne les nomme.')],
  ['476', nonNomme('Écarts de conversion : un compte de régularisation qu’aucune rubrique du 2033-A ne nomme.')],
  ['477', nonNomme('Écarts de conversion : un compte de régularisation qu’aucune rubrique du 2033-A ne nomme.')],
  ['48', nonNomme('Compte de régularisation qu’aucune rubrique du 2033-A ne nomme.')],
  ['486', ordinaire(brut('charges-constatees-avance'), 'debit')],
  ['487', ordinaire(passif('produits-constates-avance'), 'credit')],
  // Classe 5 — financiers. Une banque créditrice est un concours bancaire ; une caisse ne l'est jamais.
  ['50', ordinaire(brut('vmp'), 'debit')],
  ['509', nonNomme('Versements restant à effectuer sur des valeurs mobilières non libérées : aucune rubrique du 2033-A ne les nomme.')],
  ['51', selonLeSens(brut('disponibilites'), passif('emprunts'))],
  ['519', ordinaire(passif('emprunts'), 'credit')],
  ['52', nonNomme('Instruments financiers à terme et jetons : aucune rubrique du 2033-A ne les nomme.')],
  ['53', ordinaire(brut('disponibilites'), 'debit')],
  ['54', ordinaire(brut('disponibilites'), 'debit')],
  // Les virements internes : l'application garde au 580000 ce qui part vers un compte du professionnel qu'elle ne tient
  // pas (décision du cabinet du 06/10/2026, lib/compteDeBilan.ts). Au débit, ce sont ses fonds : des disponibilités.
  ['58', selonLeSens(brut('disponibilites'), aClasser(RAISON_VIREMENTS_INTERNES_CREDITEURS))],
])

// Les amortissements et dépréciations suivent le compte qu'ils corrigent, dont ils prennent la colonne 2 : 281830 corrige
// 21830, 391 le stock 31, 491 les clients, 590 les valeurs mobilières (PCG, art. 1121-1).
const CORRECTIF = /^(28|29|39|49|59)/

/** Le passage d'un compte de bilan (classes 1 à 5) à sa rubrique du 2033-A-SD, selon le sens de son solde. */
export function regleDuCompte(compte: string, individuel: boolean): RegleDuCompte {
  if (CORRECTIF.test(compte)) {
    const corrige = compte[0] + compte.slice(2)
    const vers = regleDuCompte(corrige, individuel).debiteur
    return vers.cote === 'actif'
      ? ordinaire({ cote: 'actif', rubrique: vers.rubrique, colonne: 'amortissements' }, 'credit')
      : nonNomme('Amortissement ou dépréciation d’un compte qu’aucune rubrique du 2033-A ne nomme : il suit ce compte.')
  }
  for (let longueur = Math.min(compte.length, 4); longueur >= 1; longueur--) {
    const entree = TABLE.get(compte.slice(0, longueur))
    if (entree) return typeof entree === 'function' ? entree(individuel) : entree
  }
  return nonNomme(RAISON_COMPTE_INCONNU)
}

// ── Le bilan ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface EntreesDuBilan {
  exercice: number
  /** Tout le brouillon du dossier, tous exercices : l'exercice s'y lit, et le détail par tiers depuis la reprise. */
  ecritures: readonly EcritureBrouillon[]
  /** Le libellé d'un compte, comme la Balance des comptes le donne. */
  categories: readonly Categorie[]
  /** La reprise d'une balance (`a_nouveaux`) et les soldes reportés d'un exercice validé (`soldes_reportes`). */
  reprise: readonly ANouveau[]
  reportes: readonly SoldeReporte[]
  anneesValidees: readonly number[]
  /** Les pièces du dossier : le tiers d'une écriture de 401, 404 ou 411, donc son compte auxiliaire. */
  pieces: readonly Pick<Piece, 'id' | 'tiers'>[]
  modele: ModeleComptable
  /** Aujourd'hui à Paris (AAAA-MM-JJ) : un exercice qui n'est pas clos donne un bilan provisoire. */
  aujourdHui: string
}

/** La part d'un compte auxiliaire dans une rubrique, ou celle des lignes sans détail par tiers (`auxiliaire` nul). */
export interface PartDeTiers {
  auxiliaire: string | null
  libelle: string
  centimes: number
}

export interface Contribution {
  compte: string
  libelle: string
  colonne: 'brut' | 'amortissements' | 'montant'
  /**
   * Dans le sens de la rubrique, en centimes : à l'actif, débit − crédit pour le brut et crédit − débit pour les
   * amortissements ; au passif, crédit − débit. Négatif pour un solde inhabituel.
   */
  centimes: number
  /** Les comptes auxiliaires de ce côté-ci du bilan, quand un compte de tiers se partage entre l'actif et le passif. */
  tiers: PartDeTiers[] | null
  inhabituel: boolean
  /** Pour un compte à classer : pourquoi aucune rubrique ne le prend. */
  raison: string | null
}

export interface RubriqueActif extends DefinitionRubriqueActif {
  brut: number
  amortissements: number
  net: number
  contributions: Contribution[]
}

export interface RubriquePassif extends DefinitionRubriquePassif {
  montant: number
  contributions: Contribution[]
}

export type CodePointDuBilan =
  | 'desequilibre' | 'hors-classes' | 'a-classer' | 'compte-d-attente' | 'virements-internes'
  | 'affectation-non-ecrite' | 'report-a-nouveau-exploitant' | 'soldes-inhabituels' | 'detail-des-tiers'
  | 'inventaire-non-revu' | 'exercice-en-cours' | 'premier-exercice'

export interface PointDuBilan {
  code: CodePointDuBilan
  gravite: 'erreur' | 'attention' | 'information'
  texte: string
  /** Les comptes en cause, dans l'ordre des numéros. */
  comptes: string[]
}

export interface MotifSansBilan {
  code: 'ouverture-en-attente' | 'avant-la-reprise'
  texte: string
}

export interface TotauxActif {
  immobilise: { brut: number; amortissements: number; net: number }
  circulant: { brut: number; amortissements: number; net: number }
  aClasser: number
  /** Total général : brut, amortissements et net, à classer compris. */
  brut: number
  amortissements: number
  net: number
}

export interface TotauxPassif {
  capitauxPropres: number
  provisions: number
  dettes: number
  aClasser: number
  total: number
}

export type BilanDeLExercice =
  | {
    etat: 'non-etabli'
    exercice: number
    dateCloture: string
    motif: MotifSansBilan
  }
  | {
    etat: 'etabli'
    exercice: number
    dateCloture: string
    /** Entreprise individuelle (le compte du dirigeant est le 108) ou société. */
    individuel: boolean
    ouverture: EtatDeLOuverture
    /** L'exercice n'est pas clos : le bilan est arrêté aux écritures passées à ce jour. */
    provisoire: boolean
    actif: RubriqueActif[]
    passif: RubriquePassif[]
    totauxActif: TotauxActif
    totauxPassif: TotauxPassif
    /** Le résultat de l'exercice en centimes : positif un bénéfice, négatif une perte. */
    resultat: number
    /** Actif net − passif, en centimes. Nul : le bilan s'équilibre. */
    ecart: number
    /** Les renvois du formulaire que le bilan sait calculer, en centimes. */
    renvois: { dontTva: number; dontComptesCourantsDebiteurs: number }
    points: PointDuBilan[]
  }

const centimesDe = (l: { sens: SensEcriture; montant: number }) => (l.sens === 'debit' ? 1 : -1) * Math.round(l.montant * 100)
const euros = (centimes: number) => formatMoney(centimes / 100)
const pluriel = (n: number, singulier: string, plurielForme: string) => (n > 1 ? plurielForme : singulier)
const parNumero = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const sensLu = (centimes: number) => (centimes > 0 ? 'au débit' : 'au crédit')

// Les comptes collectifs que l'application détaille par tiers : le compte auxiliaire de chaque pièce les partage
// (lib/engagement.ts). Un autre compte de tiers — 455, 467, un sous-compte d'une balance reprise — se juge en entier.
const COMPTES_DETAILLES_PAR_TIERS: readonly string[] = [COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS, COMPTE_CLIENTS]

// Les comptes que l'inventaire revoit à chaque clôture et que l'application n'écrit pas encore : stocks, factures à
// recevoir et à établir, charges à payer et produits à recevoir, charges et produits constatés d'avance, provisions et
// dépréciations (PCG, art. 1214-40, 1214-41 et 1214-48). Repris de l'ouverture et laissés tels quels, ils sont faux.
const COMPTE_D_INVENTAIRE = /^(3|15|29|408|418|4286|4287|4386|4387|4486|4487|4686|4687|486|487|49|59)/

const LIBELLE_SANS_DETAIL = 'Sans détail par tiers'

interface PartBrute {
  auxiliaire: string | null
  libelle: string
  centimes: number
}

// Le solde de chaque compte auxiliaire d'un compte de tiers, au soir de la clôture, depuis la reprise : le sens se juge
// tiers par tiers, et un tiers se lit sur toute sa vie, pas sur le seul exercice — une facture de l'an dernier réglée
// cette année laisserait sinon le client créditeur de son règlement, sa facture étant dans l'ouverture, sans détail.
// Les lignes sans pièce et l'ouverture reprise n'ont pas de tiers : elles forment une part « sans détail ».
function partsDesTiers(
  compte: string,
  ecritures: readonly EcritureBrouillon[],
  reprise: readonly ANouveau[],
  dateReprise: string | null,
  dateCloture: string,
  pieceParId: ReadonlyMap<string, Pick<Piece, 'id' | 'tiers'>>,
): PartBrute[] {
  const parts = new Map<string, PartBrute>()
  const part = (auxiliaire: string | null, libelle: string) => {
    const cle = auxiliaire ?? ''
    let p = parts.get(cle)
    if (!p) {
      p = { auxiliaire, libelle, centimes: 0 }
      parts.set(cle, p)
    }
    return p
  }
  for (const a of reprise) {
    if (a.compte === compte && a.date <= dateCloture) part(null, LIBELLE_SANS_DETAIL).centimes += centimesDe(a)
  }
  // Dans l'ordre des dates, pour que le libellé d'un auxiliaire soit celui de sa première pièce, quel que soit l'ordre
  // de lecture.
  const lignes = ecritures
    .filter((e) => e.compte === compte && e.date <= dateCloture && (dateReprise === null || e.date >= dateReprise))
    .sort((a, b) => parNumero(a.date, b.date) || parNumero(a.id, b.id))
  for (const e of lignes) {
    const piece = e.piece_id ? pieceParId.get(e.piece_id) : undefined
    const auxiliaire = piece ? auxiliaireDuTiers(piece, compte) : null
    part(auxiliaire?.num ?? null, auxiliaire?.lib ?? LIBELLE_SANS_DETAIL).centimes += centimesDe(e)
  }
  return [...parts.values()]
}

export function bilanDeLExercice(d: EntreesDuBilan): BilanDeLExercice {
  const exercice = d.exercice
  const dateCloture = `${exercice}-12-31`
  const dateReprise = d.reprise.length > 0 ? d.reprise.map((a) => a.date).sort(parNumero)[0] : null
  const entreesDeLOuverture = { reprise: d.reprise, reportes: d.reportes, anneesValidees: d.anneesValidees, ecritures: d.ecritures }

  // Un exercice qui FINIT avant la reprise est dans les comptes repris : la règle est lue là où la révision et la base
  // la tiennent (`refusDeLOuverture`, comme `justifier_solde` et `valider_exercice` : « 31 décembre < reprise »), pour
  // qu'un exercice sans bilan soit aussi un exercice sans révision.
  if (dateReprise !== null && refusDeLOuverture(exercice, entreesDeLOuverture) === 'anterieur-a-la-reprise') {
    return {
      etat: 'non-etabli', exercice, dateCloture,
      motif: {
        code: 'avant-la-reprise',
        texte: `L’exercice ${exercice} précède la reprise du dossier, ouvert le ${formatDate(dateReprise)} : ses comptes `
          + 'sont ceux du logiciel précédent, et son bilan aussi.',
      },
    }
  }
  const ouverture = etatDeLOuverture(exercice, entreesDeLOuverture)
  if (ouverture.type === 'en-attente') {
    return {
      etat: 'non-etabli', exercice, dateCloture,
      motif: {
        code: 'ouverture-en-attente',
        texte: `L’exercice ${exercice} n’a pas encore d’ouverture : elle s’écrira à la validation de l’exercice `
          + `${ouverture.exercice} (Clôture). Jusque-là, ses comptes de bilan partiraient de zéro, et son bilan serait faux.`,
      },
    }
  }

  const individuel = exploitantIndividuel(d.modele)
  const lignesOuverture = ouvertureDeLExercice(d.reprise, d.reportes, exercice)
  const lignesExercice = d.ecritures.filter((e) => anneeDe(e.date) === exercice)

  // Le solde de chaque compte à la clôture, en centimes, débit positif — son ouverture, puis l'exercice : CELUI QUE LA
  // RÉVISION JUSTIFIE, que `solde_du_compte` refait en base (lib/revisionSoldes.ts). La révision montrera une décision
  // là où le bilan montre une rubrique, et deux écritures du même calcul finiraient par diverger sans que rien le dise.
  // Chaque compte ne reçoit que ses propres lignes, tous exercices : la fonction filtre l'exercice elle-même, et chaque
  // ligne n'est lue qu'une fois.
  const lignesParCompte = new Map<string, EcritureBrouillon[]>()
  for (const e of d.ecritures) {
    const lignes = lignesParCompte.get(e.compte)
    if (lignes) lignes.push(e)
    else lignesParCompte.set(e.compte, [e])
  }
  const mouvementes = new Set(lignesExercice.map((e) => e.compte))
  const soldes = new Map<string, number>()
  for (const compte of new Set([...lignesOuverture.map((a) => a.compte), ...mouvementes])) {
    soldes.set(compte, soldeDuCompteCentimes(compte, exercice, {
      ecritures: lignesParCompte.get(compte) ?? [], reprise: d.reprise, reportes: d.reportes,
    }))
  }
  // Toute écriture est en partie double : la somme des soldes de tous les comptes, classes 6 et 7 comprises, est nulle,
  // sauf des lignes qui ne s'équilibrent pas.
  let desequilibreDesLignes = 0
  for (const solde of soldes.values()) desequilibreDesLignes += solde
  // Le libellé d'un compte : celui de la Balance des comptes de l'exercice, au caractère près.
  const libelles = new Map(calculerBalance([...lignesExercice], [...d.categories], lignesOuverture).map((l) => [l.compte, l.libelle]))
  const libelleDe = (compte: string) => libelles.get(compte) ?? compte

  const actif = new Map(RUBRIQUES_ACTIF.map((r) => [r.id, { ...r, brut: 0, amortissements: 0, net: 0, contributions: [] as Contribution[] }]))
  const passifs = new Map(RUBRIQUES_PASSIF.map((r) => [r.id, { ...r, montant: 0, contributions: [] as Contribution[] }]))
  const inhabituels: string[] = []
  const horsClasses: { compte: string; centimes: number }[] = []
  const aClasserDetail: { compte: string; raison: string }[] = []
  const tiersIncoherents: string[] = []
  const pieceParId = new Map(d.pieces.map((p) => [p.id, p]))

  // Pose un solde (débit − crédit, en centimes) à sa destination, et le compte dans la rubrique.
  function poser(compte: string, solde: number, regle: RegleDuCompte, tiers: PartDeTiers[] | null) {
    const vers = solde > 0 ? regle.debiteur : regle.crediteur
    const inhabituel = regle.sensOrdinaire !== null && regle.sensOrdinaire !== (solde > 0 ? 'debit' : 'credit')
    if (inhabituel && !inhabituels.includes(compte)) inhabituels.push(compte)
    const base = { compte, libelle: libelleDe(compte), tiers, inhabituel }
    if (vers.cote === 'actif') {
      const r = actif.get(vers.rubrique)!
      const centimes = vers.colonne === 'brut' ? solde : -solde
      if (vers.colonne === 'brut') r.brut += centimes
      else r.amortissements += centimes
      r.contributions.push({ ...base, colonne: vers.colonne, centimes, raison: null })
      return
    }
    if (vers.cote === 'passif') {
      const r = passifs.get(vers.rubrique)!
      r.montant -= solde
      r.contributions.push({ ...base, colonne: 'montant', centimes: -solde, raison: null })
      return
    }
    // À classer : du côté de son solde, pour que les totaux restent justes.
    if (!aClasserDetail.some((a) => a.compte === compte)) aClasserDetail.push({ compte, raison: vers.raison })
    if (solde > 0) {
      const r = actif.get('a-classer-actif')!
      r.brut += solde
      r.contributions.push({ ...base, colonne: 'brut', centimes: solde, raison: vers.raison })
    } else {
      const r = passifs.get('a-classer-passif')!
      r.montant -= solde
      r.contributions.push({ ...base, colonne: 'montant', centimes: -solde, raison: vers.raison })
    }
  }

  let resultat = 0
  for (const compte of [...soldes.keys()].sort(parNumero)) {
    const solde = soldes.get(compte)!
    if (/^[67]/.test(compte)) {
      resultat -= solde
      continue
    }
    if (!/^[1-5]/.test(compte)) {
      if (solde !== 0) horsClasses.push({ compte, centimes: solde })
      continue
    }
    const regle = regleDuCompte(compte, individuel)
    if (COMPTES_DETAILLES_PAR_TIERS.includes(compte)) {
      // Une part nulle n'est d'aucun côté : le signe la range, sans filtre.
      const parts = partsDesTiers(compte, d.ecritures, d.reprise, dateReprise, dateCloture, pieceParId)
      const total = parts.reduce((s, p) => s + p.centimes, 0)
      if (total !== solde) {
        // Défensif : le détail depuis la reprise doit retrouver le solde de l'exercice quand chaque exercice
        // précédent est validé — c'est ce que l'ouverture attend. Sinon, rien ne se partage au jugé.
        tiersIncoherents.push(compte)
        if (solde !== 0) poser(compte, solde, regle, null)
        continue
      }
      for (const cote of [1, -1]) {
        const deCeCote = parts.filter((p) => Math.sign(p.centimes) === cote)
        if (deCeCote.length === 0) continue
        const somme = deCeCote.reduce((s, p) => s + p.centimes, 0)
        const vers = cote > 0 ? regle.debiteur : regle.crediteur
        // Dans le sens de la rubrique qui reçoit, comme la contribution.
        const signe = vers.cote === 'actif' && vers.colonne === 'brut' ? 1 : -1
        const tiers = deCeCote
          .map((p) => ({ auxiliaire: p.auxiliaire, libelle: p.libelle, centimes: signe * p.centimes }))
          .sort((a, b) => (a.auxiliaire === null ? 1 : 0) - (b.auxiliaire === null ? 1 : 0)
            || a.libelle.localeCompare(b.libelle, 'fr') || parNumero(a.auxiliaire ?? '', b.auxiliaire ?? ''))
        poser(compte, somme, regle, tiers)
      }
      continue
    }
    if (solde !== 0) poser(compte, solde, regle, null)
  }

  const rubriqueResultat = passifs.get('resultat')!
  rubriqueResultat.montant = resultat

  for (const r of actif.values()) r.net = r.brut - r.amortissements
  const rubriquesActif = RUBRIQUES_ACTIF.map((r) => actif.get(r.id)!)
  const rubriquesPassif = RUBRIQUES_PASSIF.map((r) => passifs.get(r.id)!)
  for (const r of [...rubriquesActif, ...rubriquesPassif]) {
    r.contributions.sort((a, b) => parNumero(a.compte, b.compte) || a.centimes - b.centimes)
  }

  const masse = (m: MasseActif) => {
    const rs = rubriquesActif.filter((r) => r.masse === m)
    const b = rs.reduce((s, r) => s + r.brut, 0)
    const a = rs.reduce((s, r) => s + r.amortissements, 0)
    return { brut: b, amortissements: a, net: b - a }
  }
  const immobilise = masse('immobilise')
  const circulant = masse('circulant')
  const aClasserActif = actif.get('a-classer-actif')!.brut
  const totauxActif: TotauxActif = {
    immobilise, circulant, aClasser: aClasserActif,
    brut: immobilise.brut + circulant.brut + aClasserActif,
    amortissements: immobilise.amortissements + circulant.amortissements,
    net: immobilise.net + circulant.net + aClasserActif,
  }
  const sommePassif = (m: MassePassif) => rubriquesPassif.filter((r) => r.masse === m).reduce((s, r) => s + r.montant, 0)
  const totauxPassif: TotauxPassif = {
    capitauxPropres: sommePassif('capitaux-propres'),
    provisions: sommePassif('provisions'),
    dettes: sommePassif('dettes'),
    aClasser: sommePassif('a-classer'),
    total: rubriquesPassif.reduce((s, r) => s + r.montant, 0),
  }
  const ecart = totauxActif.net - totauxPassif.total

  const renvois = {
    dontTva: passifs.get('dettes-fiscales-sociales')!.contributions
      .filter((c) => /^445/.test(c.compte)).reduce((s, c) => s + c.centimes, 0),
    dontComptesCourantsDebiteurs: actif.get('autres-creances')!.contributions
      .filter((c) => /^455/.test(c.compte)).reduce((s, c) => s + c.centimes, 0),
  }

  // ── Ce que le bilan dit de lui-même ──
  const points: PointDuBilan[] = []
  const totalHorsClasses = horsClasses.reduce((s, h) => s + h.centimes, 0)
  if (ecart !== 0) {
    const causes: string[] = []
    if (desequilibreDesLignes !== 0) {
      causes.push(`Les écritures de l’exercice et son ouverture ne s’équilibrent pas : ${euros(Math.abs(desequilibreDesLignes))} `
        + `de plus ${desequilibreDesLignes > 0 ? 'au débit' : 'au crédit'} — l’onglet Écritures dit lesquelles.`)
    }
    if (totalHorsClasses !== 0) {
      causes.push(`Des comptes hors des classes 1 à 7 portent ${euros(Math.abs(totalHorsClasses))} ${sensLu(totalHorsClasses)}, `
        + 'que ni le bilan ni le résultat ne comptent.')
    }
    points.push({
      code: 'desequilibre', gravite: 'erreur',
      texte: `Le bilan ne s’équilibre pas : l’actif ${ecart > 0 ? 'dépasse' : 'est inférieur au'} passif de `
        + `${euros(Math.abs(ecart))}. ${causes.join(' ')}`.trim(),
      comptes: horsClasses.map((h) => h.compte),
    })
  }
  if (horsClasses.length > 0) {
    points.push({
      code: 'hors-classes', gravite: 'erreur',
      texte: `${horsClasses.length} ${pluriel(horsClasses.length, 'compte hors des classes 1 à 7 porte', 'comptes hors des classes 1 à 7 portent')} `
        + `un solde : ${horsClasses.map((h) => `${h.compte} (${euros(Math.abs(h.centimes))} ${sensLu(h.centimes)})`).join(', ')}. `
        + 'Ni le bilan ni le résultat ne les comptent : un compte de l’application est de classe 1 à 7.',
      comptes: horsClasses.map((h) => h.compte),
    })
  }
  const attente = aClasserDetail.filter((a) => a.raison === RAISON_ATTENTE).map((a) => a.compte).sort(parNumero)
  const autresAClasser = aClasserDetail.filter((a) => a.raison !== RAISON_ATTENTE).sort((a, b) => parNumero(a.compte, b.compte))
  if (attente.length > 0) {
    points.push({
      code: 'compte-d-attente', gravite: 'attention',
      texte: `Un compte d’attente porte un solde à la clôture (${attente.join(', ')}) : ses opérations se reclassent en fin `
        + 'd’exercice parmi les comptes du bilan (PCG, art. 1214-47). Il est présenté à part, à classer.',
      comptes: attente,
    })
  }
  if (autresAClasser.length > 0) {
    points.push({
      code: 'a-classer', gravite: 'attention',
      texte: `${autresAClasser.length} ${pluriel(autresAClasser.length, 'compte qu’aucune rubrique du 2033-A ne nomme est présenté',
        'comptes qu’aucune rubrique du 2033-A ne nomme sont présentés')} à part, du côté de son solde, pour que les totaux `
        + `restent justes : ${autresAClasser.map((a) => `${a.compte} — ${a.raison}`).join(' ')}`,
      comptes: autresAClasser.map((a) => a.compte),
    })
  }
  const virementsInternes = [...soldes.entries()].filter(([c, s]) => /^58/.test(c) && s !== 0).map(([c]) => c).sort(parNumero)
  if (virementsInternes.length > 0) {
    const total = virementsInternes.reduce((s, c) => s + soldes.get(c)!, 0)
    points.push({
      code: 'virements-internes', gravite: 'attention',
      texte: `Les virements internes portent ${euros(Math.abs(total))} ${sensLu(total)} (${virementsInternes.join(', ')}) : `
        + 'ce compte se solde quand l’autre compte du professionnel est tenu dans l’application. Ici il garde ce qui a été '
        + 'versé sur un compte qu’elle ne tient pas — au débit, des disponibilités, que le relevé de cet autre compte justifie.',
      comptes: virementsInternes,
    })
  }
  const enAttente = passifs.get('resultats-en-attente')!
  if (enAttente.montant !== 0 || enAttente.contributions.length > 0) {
    points.push({
      code: 'affectation-non-ecrite', gravite: 'attention',
      texte: `Le résultat d’un exercice précédent attend son affectation (${euros(enAttente.montant)}, `
        + `${enAttente.contributions.map((c) => c.compte).join(', ')}) : l’application n’écrit pas encore l’affectation que `
        + 'décident les associés. Il est présenté à part dans les capitaux propres, sans case du 2033-A.',
      comptes: enAttente.contributions.map((c) => c.compte),
    })
  }
  const reportANouveau = passifs.get('report-a-nouveau')!
  if (individuel && reportANouveau.contributions.length > 0) {
    points.push({
      code: 'report-a-nouveau-exploitant', gravite: 'attention',
      texte: `Un report à nouveau (${euros(reportANouveau.montant)}) dans une entreprise individuelle : il ne se sert pas pour un `
        + 'exploitant individuel (BOI-ANNX-000411), dont les résultats passent au capital (PCG, art. 1211-12).',
      comptes: reportANouveau.contributions.map((c) => c.compte),
    })
  }
  if (inhabituels.length > 0) {
    const comptes = [...inhabituels].sort(parNumero)
    points.push({
      code: 'soldes-inhabituels', gravite: 'attention',
      texte: `${pluriel(comptes.length, 'Un compte porte un solde', 'Des comptes portent un solde')} de l’autre sens que le leur : `
        + `${comptes.map((c) => `${c} (${euros(Math.abs(soldes.get(c)!))} ${sensLu(soldes.get(c)!)})`).join(', ')}. `
        + `${pluriel(comptes.length, 'Il est présenté', 'Ils sont présentés')} dans ${pluriel(comptes.length, 'sa', 'leur')} `
        + 'rubrique, en négatif, plutôt que de passer de l’autre côté du bilan : c’est une écriture à revoir.',
      comptes,
    })
  }
  if (tiersIncoherents.length > 0) {
    points.push({
      code: 'detail-des-tiers', gravite: 'attention',
      texte: `Le détail par tiers de ${tiersIncoherents.join(', ')} ne retrouve pas le solde de l’exercice : ce compte est présenté `
        + 'en entier, du côté de son solde, sans partager ses clients ou ses fournisseurs entre l’actif et le passif.',
      comptes: tiersIncoherents,
    })
  }
  const nonRevus = [...soldes.entries()]
    .filter(([c, s]) => COMPTE_D_INVENTAIRE.test(c) && s !== 0 && !mouvementes.has(c))
    .map(([c]) => c).sort(parNumero)
  if (nonRevus.length > 0) {
    points.push({
      code: 'inventaire-non-revu', gravite: 'attention',
      texte: `${pluriel(nonRevus.length, 'Un compte d’inventaire garde', 'Des comptes d’inventaire gardent')} à la clôture le solde `
        + `de l’ouverture, sans mouvement dans l’exercice : ${nonRevus.join(', ')}. Stocks, charges et produits constatés `
        + 'd’avance, factures à recevoir ou à établir, provisions et dépréciations se revoient à chaque clôture, et cette '
        + 'écriture ne se passe pas encore dans l’application.',
      comptes: nonRevus,
    })
  }
  const provisoire = d.aujourdHui <= dateCloture
  if (provisoire) {
    points.push({
      code: 'exercice-en-cours', gravite: 'information',
      texte: `L’exercice ${exercice} n’est pas clos : ce bilan est provisoire, arrêté aux écritures passées à ce jour.`,
      comptes: [],
    })
  }
  if (ouverture.type === 'sans-objet') {
    points.push({
      code: 'premier-exercice', gravite: 'information',
      texte: 'Premier exercice du dossier : il s’ouvre sans solde. Si l’activité est plus ancienne, sa balance se reprend dans '
        + 'Informations du dossier (« Balance d’un autre logiciel »), et ce bilan en tiendra compte.',
      comptes: [],
    })
  }
  const ordre = { erreur: 0, attention: 1, information: 2 } as const
  points.sort((a, b) => ordre[a.gravite] - ordre[b.gravite])

  return {
    etat: 'etabli', exercice, dateCloture, individuel, ouverture, provisoire,
    actif: rubriquesActif, passif: rubriquesPassif, totauxActif, totauxPassif,
    resultat, ecart, renvois, points,
  }
}
