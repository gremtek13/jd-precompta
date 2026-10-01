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

// Les comptes de tiers d'un dossier tenu en ENGAGEMENT (voir lib/engagement.ts) : la facture y crée
// une dette ou une créance à sa date, et le paiement la solde. Un compte collectif par nature de
// tiers, le détail par fournisseur ou par client vivant dans le compte AUXILIAIRE du FEC.
export const COMPTE_FOURNISSEURS = '401000'
export const COMPTE_CLIENTS = '411000'
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

// Le libellé des comptes que l'application tient elle-même, et qu'aucune catégorie ne porte : sans
// lui, la balance les afficherait « — » et le FEC les nommerait par leur numéro. UN SEUL endroit : il
// vivait en deux copies, dans `ecritures.ts` et dans `fec.ts`, et un compte ajouté à l'une seulement
// aurait porté deux noms selon l'écran — un même CompteNum ne doit avoir qu'un CompteLib.
export const LIBELLES_COMPTES: Readonly<Record<string, string>> = {
  [COMPTE_BANQUE]: 'Banque',
  [COMPTE_TVA_DEDUCTIBLE]: 'TVA déductible',
  [COMPTE_TVA_COLLECTEE]: 'TVA collectée',
  [COMPTE_FOURNISSEURS]: 'Fournisseurs',
  [COMPTE_CLIENTS]: 'Clients',
  [COMPTE_COURANT_ASSOCIE]: 'Associés — comptes courants',
  [COMPTE_EXPLOITANT]: "Compte de l'exploitant",
  [COMPTE_AUTRES_DEBITEURS_CREDITEURS]: 'Autres comptes débiteurs ou créditeurs',
  [COMPTE_EMPRUNT]: 'Emprunts auprès des établissements de crédit',
  [COMPTE_INTERETS_EMPRUNT]: 'Intérêts des emprunts et dettes',
  [COMPTE_ASSURANCE_EMPRUNT]: 'Assurance des emprunts',
  [COMPTE_COTISATIONS_EXPLOITANT]: "Cotisations sociales personnelles de l'exploitant",
  [COMPTE_DOTATIONS_AMORTISSEMENTS]: 'Dotations aux amortissements des immobilisations',
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

// Le libellé d'un compte que l'application tient elle-même — un compte fixe, ou un compte d'amortissement
// —, nul pour un compte qu'une catégorie porte. UN SEUL ENDROIT pour la balance des comptes, le FEC et
// ses à-nouveaux : un même CompteNum ne porte qu'un CompteLib dans tout le fichier, et un compte 28
// ouvert par la balance reprise doit s'appeler comme celui que la dotation crédite.
export function libelleCompteTenu(compte: string): string | null {
  if (LIBELLES_COMPTES[compte]) return LIBELLES_COMPTES[compte]
  if (/^28\d{4}$/.test(compte)) {
    return LIBELLES_AMORTISSEMENTS[compte]
      ?? (compte.startsWith('280') ? 'Amortissements des immobilisations incorporelles' : 'Amortissements des immobilisations corporelles')
  }
  return null
}
