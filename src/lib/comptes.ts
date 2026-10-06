// Comptes PCG standard, fixes — partagés entre Écritures (génération de la ligne charge/produit +
// TVA), Banque (génération de la contrepartie), la balance et l'export FEC, pour n'avoir qu'un seul
// endroit à changer si un jour ces comptes deviennent configurables par dossier.
//
// Volontairement isolés dans leur propre module, sans aucune dépendance : ils vivaient dans
// `ecritures.ts`, qui importe le client Supabase, lequel lève au chargement si les variables
// d'environnement manquent. Un module purement calculatoire comme `fec.ts` traînait donc tout le
// client derrière lui pour trois chaînes de caractères — invisible au build (Vite ne fait que
// substituer `import.meta.env`), mais fatal dès qu'on veut l'exécuter sans .env, en test comme en CI.
export const COMPTE_TVA_DEDUCTIBLE = '445660'
export const COMPTE_TVA_COLLECTEE = '445710'
export const COMPTE_BANQUE = '512000'
// La TVA déductible sur IMMOBILISATIONS (voir lib/ecritures.ts, l'écriture d'acquisition) : le plan
// comptable la sépare de celle des autres biens et services, comme la CA3, qui la porte en ligne 19 et
// non en ligne 20.
export const COMPTE_TVA_IMMOBILISATIONS = '445620'

// Les comptes de tiers d'un dossier tenu en ENGAGEMENT (voir lib/engagement.ts) : la facture y crée
// une dette ou une créance à sa date, et le paiement la solde. Un compte collectif par nature de
// tiers, le détail par fournisseur ou par client vivant dans le compte AUXILIAIRE du FEC.
export const COMPTE_FOURNISSEURS = '401000'
export const COMPTE_CLIENTS = '411000'
// La dette envers le vendeur d'un BIEN IMMOBILISÉ : le plan comptable la sépare des dettes fournisseurs,
// comme le bilan (« dettes sur immobilisations »).
export const COMPTE_FOURNISSEURS_IMMOBILISATIONS = '404000'
// Le compte d'une note de frais que le dirigeant a payée de sa poche, au choix du dossier.
export const COMPTE_COURANT_ASSOCIE = '455000'
export const COMPTE_EXPLOITANT = '108000'
export const COMPTE_AUTRES_DEBITEURS_CREDITEURS = '467000'

// Les comptes d'une ÉCHÉANCE D'EMPRUNT (voir lib/echeanceEmprunt.ts) : le capital remboursé diminue la
// dette (164, un compte de bilan, ni charge ni recette), les intérêts sont une charge financière (661,
// frais financiers de la 2035) et l'assurance de l'emprunteur une prime d'assurance (616). La base
// vérifie ces trois numéros exactement (`rapprocher_echeance_emprunt`).
export const COMPTE_EMPRUNT = '164000'
export const COMPTE_INTERETS_EMPRUNT = '661100'
export const COMPTE_ASSURANCE_EMPRUNT = '616800'

// Le compte d'une ÉCHÉANCE DE COTISATION rapprochée d'un mouvement (voir lib/cotisationRapprochee.ts) :
// les cotisations sociales personnelles de l'exploitant, face à la banque. Sa CSG-CRDS passe au 108000
// en trésorerie. La base vérifie ce numéro exactement (`rapprocher_cotisation`).
export const COMPTE_COTISATIONS_EXPLOITANT = '646000'

// Le compte d'une DOTATION AUX AMORTISSEMENTS (voir lib/amortissements.ts) : la dotation y est débitée au
// 31 décembre, face au compte d'amortissement du bien (28…), que sa nature donne. La base vérifie ce
// numéro exactement (`ecrire_dotation_amortissement`).
export const COMPTE_DOTATIONS_AMORTISSEMENTS = '681100'

// Le compte du FORFAIT KILOMÉTRIQUE (voir lib/forfaitKilometrique.ts) : les indemnités du barème, débitées
// au 31 décembre face au compte du dirigeant, qui a supporté les frais du véhicule. Un sous-compte de 6251
// (voyages et déplacements) à part de celui des frais de déplacement au réel, que la catégorie
// « carburant_deplacements » porte au 625100 : la balance doit pouvoir montrer l'un sans l'autre, la notice
// interdisant de cumuler le barème et les frais réels qu'il couvre. La base vérifie ce numéro exactement
// (`ecrire_forfait_kilometrique`).
export const COMPTE_INDEMNITES_KILOMETRIQUES = '625110'

// Les deux comptes de bilan que l'application PROPOSE pour un mouvement sans justificatif (ligne 26.7, voir
// lib/compteDeBilan.ts), décision du cabinet du 06/10/2026 : un virement vers un autre compte du professionnel
// passe par les virements internes, un dépôt de garantie versé ou rendu par les dépôts et cautionnements versés.
export const COMPTE_VIREMENTS_INTERNES = '580000'
export const COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES = '275000'

// Les comptes de la LIQUIDATION DE LA TVA (ligne 26.8, voir lib/liquidationTva.ts), décision du cabinet du
// 06/10/2026 : à l'enregistrement d'une déclaration, une écriture solde la TVA de la période — collectée (445710),
// déductible (445660, 445620) — sur la TVA à décaisser (445510) ou, pour un crédit, sur le crédit de TVA à reporter
// (445670) ; le remboursement d'un crédit demandé au Trésor passe par le 445830, que son virement solde ; et l'arrondi
// à l'euro de chaque ligne de la CA3 va au 658000 (une charge) ou au 758000 (un produit). La base vérifie ces numéros
// exactement (`liquidation_attendue`, `rapprocher_declaration_tva`).
export const COMPTE_TVA_A_DECAISSER = '445510'
export const COMPTE_CREDIT_TVA_A_REPORTER = '445670'
export const COMPTE_REMBOURSEMENT_TVA_DEMANDE = '445830'
export const COMPTE_ARRONDIS_CHARGE = '658000'
export const COMPTE_ARRONDIS_PRODUIT = '758000'

// Le libellé des comptes que l'application tient elle-même, et qu'aucune catégorie ne porte : sans
// lui, la balance les afficherait « — » et le FEC les nommerait par leur numéro. UN SEUL endroit : il
// vivait en deux copies, dans `ecritures.ts` et dans `fec.ts`, et un compte ajouté à l'une seulement
// aurait porté deux noms selon l'écran — un même CompteNum ne doit avoir qu'un CompteLib.
export const LIBELLES_COMPTES: Readonly<Record<string, string>> = {
  [COMPTE_BANQUE]: 'Banque',
  [COMPTE_TVA_DEDUCTIBLE]: 'TVA déductible',
  [COMPTE_TVA_COLLECTEE]: 'TVA collectée',
  [COMPTE_TVA_IMMOBILISATIONS]: 'TVA déductible sur immobilisations',
  [COMPTE_FOURNISSEURS]: 'Fournisseurs',
  [COMPTE_FOURNISSEURS_IMMOBILISATIONS]: "Fournisseurs d'immobilisations",
  [COMPTE_CLIENTS]: 'Clients',
  [COMPTE_COURANT_ASSOCIE]: 'Associés — comptes courants',
  [COMPTE_EXPLOITANT]: "Compte de l'exploitant",
  [COMPTE_AUTRES_DEBITEURS_CREDITEURS]: 'Autres comptes débiteurs ou créditeurs',
  [COMPTE_EMPRUNT]: 'Emprunts auprès des établissements de crédit',
  [COMPTE_INTERETS_EMPRUNT]: 'Intérêts des emprunts et dettes',
  [COMPTE_ASSURANCE_EMPRUNT]: 'Assurance des emprunts',
  [COMPTE_COTISATIONS_EXPLOITANT]: "Cotisations sociales personnelles de l'exploitant",
  [COMPTE_DOTATIONS_AMORTISSEMENTS]: 'Dotations aux amortissements des immobilisations',
  [COMPTE_INDEMNITES_KILOMETRIQUES]: 'Indemnités kilométriques (barème)',
  [COMPTE_VIREMENTS_INTERNES]: 'Virements internes',
  [COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES]: 'Dépôts et cautionnements versés',
  [COMPTE_TVA_A_DECAISSER]: 'TVA à décaisser',
  [COMPTE_CREDIT_TVA_A_REPORTER]: 'Crédit de TVA à reporter',
  [COMPTE_REMBOURSEMENT_TVA_DEMANDE]: "Remboursement de taxes sur le chiffre d'affaires demandé",
  [COMPTE_ARRONDIS_CHARGE]: 'Charges diverses de gestion courante',
  [COMPTE_ARRONDIS_PRODUIT]: 'Produits divers de gestion courante',
}

// LES COMPTES D'AMORTISSEMENT que les dotations créditent : 28 suivi du compte d'immobilisation du bien
// sans son 2 (2183 → 28183), celui que porte sa nature. Ils ne sont pas fixes — une nature propre à un
// dossier peut porter n'importe quel compte de classe 20 ou 21 —, d'où une table pour ceux du plan
// comptable que les natures du cabinet désignent, et un libellé générique pour les autres. Sans lui, la
// balance les afficherait « — » et le FEC les nommerait par leur numéro.
const LIBELLES_AMORTISSEMENTS: Readonly<Record<string, string>> = {
  '280500': 'Amortissements des concessions, brevets, licences, logiciels',
  '281540': 'Amortissements du matériel industriel',
  '281800': 'Amortissements des autres immobilisations corporelles',
  '281810': 'Amortissements des installations générales, agencements, aménagements divers',
  '281820': 'Amortissements du matériel de transport',
  '281830': 'Amortissements du matériel de bureau et matériel informatique',
  '281840': 'Amortissements du mobilier',
}

// LES COMPTES D'IMMOBILISATION que l'écriture d'acquisition débite : celui que porte la nature du bien,
// classe 20 ou 21 sur six chiffres. Même raison que pour les comptes 28 : une table pour ceux que les
// natures du cabinet désignent, un libellé générique pour les autres.
const LIBELLES_IMMOBILISATIONS: Readonly<Record<string, string>> = {
  '205000': 'Concessions et droits similaires, brevets, licences, logiciels',
  '215400': 'Matériel industriel',
  '218000': 'Autres immobilisations corporelles',
  '218100': 'Installations générales, agencements, aménagements divers',
  '218200': 'Matériel de transport',
  '218300': 'Matériel de bureau et matériel informatique',
  '218400': 'Mobilier',
}

// Le libellé d'un compte que l'application tient elle-même — un compte fixe, un compte d'immobilisation ou
// un compte d'amortissement —, nul pour un compte qu'une catégorie porte. UN SEUL ENDROIT pour la balance
// des comptes, le FEC et ses à-nouveaux : un même CompteNum ne porte qu'un CompteLib dans tout le fichier,
// et un compte 2… ou 28… ouvert par la balance reprise doit s'appeler comme celui que l'acquisition débite
// ou que la dotation crédite.
export function libelleCompteTenu(compte: string): string | null {
  if (LIBELLES_COMPTES[compte]) return LIBELLES_COMPTES[compte]
  if (/^28\d{4}$/.test(compte)) {
    return LIBELLES_AMORTISSEMENTS[compte]
      ?? (compte.startsWith('280') ? 'Amortissements des immobilisations incorporelles' : 'Amortissements des immobilisations corporelles')
  }
  if (/^2[01]\d{4}$/.test(compte)) {
    return LIBELLES_IMMOBILISATIONS[compte]
      ?? (compte.startsWith('20') ? 'Immobilisations incorporelles' : 'Immobilisations corporelles')
  }
  return null
}

// LE LIBELLÉ DU PLAN COMPTABLE d'un compte de bilan que rien d'autre ne nomme : ni l'application, ni une catégorie,
// ni la balance reprise. Un mouvement s'écrit depuis le 06/10/2026 sur un compte de bilan que le cabinet CHOISIT
// (ligne 26.7, lib/compteDeBilan.ts) — un prêt au 274, un dépôt reçu au 165, des titres au 503 —, et sans libellé la
// balance l'afficherait « — » et le FEC le nommerait par son numéro. Le plus long préfixe connu l'emporte (274100 :
// « Prêts »), puis le compte à deux chiffres, puis la classe : le libellé est celui du compte du plan qui le
// contient, ce qui est juste pour un sous-compte que le cabinet ouvre. Les comptes 1 à 5 du plan comptable général
// (règlement ANC n° 2014-03) que l'application peut recevoir, et leurs voisins à deux chiffres.
//
// PASSÉ EN DERNIER, et c'est voulu : le libellé qu'une catégorie ou qu'une balance reprise donne à un compte est plus
// précis (« Prêt au cabinet Dupont ») et l'emporte. Nul hors des classes 1 à 5.
const LIBELLES_DU_PLAN: Readonly<Record<string, string>> = {
  '1': 'Comptes de capitaux',
  '10': 'Capital et réserves',
  '101': 'Capital',
  '104': 'Primes liées au capital social',
  '105': 'Écarts de réévaluation',
  '106': 'Réserves',
  '107': "Écart d'équivalence",
  '108': "Compte de l'exploitant",
  '109': 'Actionnaires — capital souscrit non appelé',
  '11': 'Report à nouveau',
  '12': "Résultat de l'exercice",
  '13': "Subventions d'investissement",
  '14': 'Provisions réglementées',
  '15': 'Provisions',
  '16': 'Emprunts et dettes assimilées',
  '161': 'Emprunts obligataires convertibles',
  '163': 'Autres emprunts obligataires',
  '164': 'Emprunts auprès des établissements de crédit',
  '165': 'Dépôts et cautionnements reçus',
  '166': 'Participation des salariés aux résultats',
  '167': 'Emprunts et dettes assortis de conditions particulières',
  '168': 'Autres emprunts et dettes assimilées',
  '17': 'Dettes rattachées à des participations',
  '18': 'Comptes de liaison des établissements et sociétés en participation',
  '2': "Comptes d'immobilisations",
  '20': 'Immobilisations incorporelles',
  '21': 'Immobilisations corporelles',
  '22': 'Immobilisations mises en concession',
  '23': 'Immobilisations en cours, avances et acomptes',
  '231': 'Immobilisations corporelles en cours',
  '232': 'Immobilisations incorporelles en cours',
  '237': 'Avances et acomptes versés sur immobilisations incorporelles',
  '238': "Avances et acomptes versés sur commandes d'immobilisations corporelles",
  '26': 'Participations et créances rattachées à des participations',
  '261': 'Titres de participation',
  '266': 'Autres formes de participation',
  '267': 'Créances rattachées à des participations',
  '268': 'Créances rattachées à des sociétés en participation',
  '269': 'Versements restant à effectuer sur titres de participation non libérés',
  '27': 'Autres immobilisations financières',
  '271': 'Titres immobilisés (droit de propriété)',
  '272': 'Titres immobilisés (droit de créance)',
  '273': "Titres immobilisés de l'activité de portefeuille",
  '274': 'Prêts',
  '275': 'Dépôts et cautionnements versés',
  '276': 'Autres créances immobilisées',
  '279': 'Versements restant à effectuer sur titres immobilisés non libérés',
  '28': 'Amortissements des immobilisations',
  '29': 'Dépréciations des immobilisations',
  '3': 'Comptes de stocks et en-cours',
  '4': 'Comptes de tiers',
  '40': 'Fournisseurs et comptes rattachés',
  '41': 'Clients et comptes rattachés',
  '42': 'Personnel et comptes rattachés',
  '43': 'Sécurité sociale et autres organismes sociaux',
  '44': 'État et autres collectivités publiques',
  '444': 'État — impôts sur les bénéfices',
  '445': "État — taxes sur le chiffre d'affaires",
  '45': 'Groupe et associés',
  '451': 'Groupe',
  '455': 'Associés — comptes courants',
  '456': 'Associés — opérations sur le capital',
  '457': 'Associés — dividendes à payer',
  '458': 'Associés — opérations faites en commun et en GIE',
  '46': 'Débiteurs divers et créditeurs divers',
  '462': "Créances sur cessions d'immobilisations",
  '464': 'Dettes sur acquisitions de valeurs mobilières de placement',
  '465': 'Créances sur cessions de valeurs mobilières de placement',
  '467': 'Autres comptes débiteurs ou créditeurs',
  '468': 'Divers — charges à payer et produits à recevoir',
  '47': "Comptes transitoires ou d'attente",
  '48': 'Comptes de régularisation',
  '49': 'Dépréciations des comptes de tiers',
  '5': 'Comptes financiers',
  '50': 'Valeurs mobilières de placement',
  '502': 'Actions propres',
  '503': 'Actions',
  '504': 'Autres titres conférant un droit de propriété',
  '505': 'Obligations et bons émis par la société et rachetés par elle',
  '506': 'Obligations',
  '507': 'Bons du Trésor et bons de caisse à court terme',
  '508': 'Autres valeurs mobilières de placement et autres créances assimilées',
  '509': 'Versements restant à effectuer sur valeurs mobilières de placement non libérées',
  '51': 'Banques, établissements financiers et assimilés',
  '52': 'Instruments de trésorerie',
  '53': 'Caisse',
  '54': "Régies d'avances et accréditifs",
  '58': 'Virements internes',
  '59': 'Dépréciations des comptes financiers',
}

export function libelleDuPlanComptable(compte: string): string | null {
  if (!/^[1-5]\d*$/.test(compte)) return null
  for (const longueur of [3, 2, 1]) {
    const libelle = LIBELLES_DU_PLAN[compte.slice(0, longueur)]
    if (libelle) return libelle
  }
  return null
}
