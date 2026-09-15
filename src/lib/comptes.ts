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
