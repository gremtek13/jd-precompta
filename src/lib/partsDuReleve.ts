import { mouvementsAffectes, type MouvementBancaire, type NatureCompte } from './affectationBanque'
import { partsDesEcheances } from './echeanceEmprunt'
import type { Categorie, VentilationBancaire } from './types'
import { partsDesVentilations } from './ventilationBanque'

// CE QUE LE RELEVÉ, SANS PIÈCE, AJOUTE À LA 2035 ET AUX ÉTATS QUI LA DÉCLINENT (ligne 26.6 de la feuille
// de route) : la situation intermédiaire, l'estimation, la simulation du client.
//
// Trois sources, et une forme pour les trois :
//   - un mouvement AFFECTÉ à une catégorie (lib/affectationBanque.ts) : une part, dans le poste de la
//     catégorie, de la nature de son compte ;
//   - une ÉCHÉANCE D'EMPRUNT (lib/echeanceEmprunt.ts) : jusqu'à deux parts, les intérêts en frais
//     financiers et l'assurance en primes d'assurance — un même mouvement dans deux postes, ce que la
//     forme « un mouvement, une catégorie » de l'affectation ne savait pas dire ;
//   - un mouvement VENTILÉ sur plusieurs comptes (lib/ventilationBanque.ts) : une part par catégorie, la
//     part personnelle n'en étant pas — elle va au compte du dirigeant, ni charge ni recette.
//
// LES MOTEURS NE LISENT QUE CETTE FORME. Ils recevaient la liste des mouvements affectés ; leur ajouter
// un paramètre par source aurait fait de chaque nouvelle source un paramètre de plus à passer à quatre
// moteurs et sept écrans, et un appelant qui l'oublie rendrait une 2035 sans ses intérêts, sans que rien
// ne le dise. Une source s'ajoute ICI, et tous les moteurs la comptent.
//
// LES PARTS VENTILÉES ARRIVENT EN PARAMÈTRE OBLIGATOIRE, sans valeur par défaut : elles vivent dans une
// table à part (`ventilations_bancaires`), que l'écran lit à côté des mouvements. Une liste vide par
// défaut ferait disparaître de la 2035, en silence, tout ce qu'un mouvement ventilé y met — c'est au
// compilateur de dire à un écran qu'il ne les a pas lues.
//
// L'ASSUJETTISSEMENT AUSSI : sur un dossier assujetti, une recette du relevé compte au HORS TAXE, à son
// taux (lib/tvaDuReleve.ts) ; ailleurs, au TTC. Une valeur par défaut compterait la TVA collectée dans les
// recettes de la 2035, ou la retirerait d'un dossier qui ne la collecte pas.
export interface PartDuReleve {
  ligne: MouvementBancaire
  origine: 'affectation' | 'emprunt' | 'ventilation'
  // Ce qu'est la part, pour les listes : le libellé de la catégorie, ou « Intérêts d'emprunt ».
  libelle: string
  // Le poste de la 2035 ; nul quand la catégorie n'en porte pas (le trou que Clôture liste).
  poste: string | null
  // Nulle quand le compte d'une catégorie n'est plus un compte de résultat (voir `MouvementAffecte`).
  nature: NatureCompte | null
  // Le taux de TVA qui s'applique à la part (voir `MouvementAffecte.taux`) : nul pour une dépense, une
  // échéance d'emprunt, et sur un dossier non assujetti. La CA3 le lit ici (lib/declarationTva.ts).
  taux: number | null
  // Ce que la part ajoute à son poste, positif quand elle l'augmente (voir `MouvementAffecte`) — au hors
  // taxe pour une recette taxée.
  montantPoste: number
  // Ce que la part pèse sur le relevé, signé comme lui : le mouvement entier pour une affectation, la
  // part pour une échéance ou une ventilation. C'est ce qu'une liste montre — le montant du mouvement
  // entier y ferait croire qu'une part de 36 € en retire 120 de la déclaration.
  montantReleve: number
}

export function partsDuReleve(
  lignes: readonly MouvementBancaire[],
  categories: readonly Categorie[],
  ventilations: readonly VentilationBancaire[],
  assujettiTva: boolean,
): PartDuReleve[] {
  const affectations: PartDuReleve[] = mouvementsAffectes(lignes, categories, assujettiTva).map((m) => ({
    ligne: m.ligne,
    origine: 'affectation',
    libelle: m.categorie.libelle,
    poste: m.categorie.poste_2035,
    nature: m.nature,
    taux: m.taux,
    montantPoste: m.montantPoste,
    montantReleve: m.ligne.montant,
  }))
  const echeances: PartDuReleve[] = partsDesEcheances(lignes).map((p) => ({
    ligne: p.ligne,
    origine: 'emprunt',
    libelle: p.libelle,
    poste: p.poste,
    nature: 'depense',
    taux: null,
    montantPoste: p.montantPoste,
    // Une dépense payée : une sortie du relevé.
    montantReleve: -p.montantPoste,
  }))
  const ventilees: PartDuReleve[] = partsDesVentilations(lignes, ventilations, categories, assujettiTva).map((p) => ({
    ligne: p.ligne,
    origine: 'ventilation',
    libelle: p.categorie.libelle,
    poste: p.categorie.poste_2035,
    nature: p.nature,
    taux: p.taux,
    montantPoste: p.montantPoste,
    montantReleve: p.montant,
  }))
  return [...affectations, ...echeances, ...ventilees]
}
