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
}
