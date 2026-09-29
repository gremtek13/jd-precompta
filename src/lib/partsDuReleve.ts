import { mouvementsAffectes, type MouvementBancaire, type NatureCompte } from './affectationBanque'
import { partsDesEcheances } from './echeanceEmprunt'
import type { Categorie } from './types'

// CE QUE LE RELEVÉ, SANS PIÈCE, AJOUTE À LA 2035 ET AUX ÉTATS QUI LA DÉCLINENT (ligne 26.6 de la feuille
// de route) : la situation intermédiaire, l'estimation, la simulation du client.
//
// Deux sources aujourd'hui, et une forme pour les deux :
//   - un mouvement AFFECTÉ à une catégorie (lib/affectationBanque.ts) : une part, dans le poste de la
//     catégorie, de la nature de son compte ;
//   - une ÉCHÉANCE D'EMPRUNT (lib/echeanceEmprunt.ts) : jusqu'à deux parts, les intérêts en frais
//     financiers et l'assurance en primes d'assurance — un même mouvement dans deux postes, ce que la
//     forme « un mouvement, une catégorie » de l'affectation ne savait pas dire.
//
// LES MOTEURS NE LISENT QUE CETTE FORME. Ils recevaient la liste des mouvements affectés ; leur ajouter
// un paramètre par source aurait fait de chaque nouvelle source — la ventilation d'un mouvement sur
// plusieurs comptes est la suivante — un paramètre de plus à passer à quatre moteurs et sept écrans, et
// un appelant qui l'oublie rendrait une 2035 sans ses intérêts, sans que rien ne le dise. Une source
// s'ajoute ICI, et tous les moteurs la comptent.
export interface PartDuReleve {
  ligne: MouvementBancaire
  origine: 'affectation' | 'emprunt'
  // Ce qu'est la part, pour les listes : le libellé de la catégorie, ou « Intérêts d'emprunt ».
  libelle: string
  // Le poste de la 2035 ; nul quand la catégorie n'en porte pas (le trou que Clôture liste).
  poste: string | null
  // Nulle quand le compte d'une catégorie n'est plus un compte de résultat (voir `MouvementAffecte`).
  nature: NatureCompte | null
  // Ce que la part ajoute à son poste, positif quand elle l'augmente (voir `MouvementAffecte`).
  montantPoste: number
}

export function partsDuReleve(lignes: readonly MouvementBancaire[], categories: readonly Categorie[]): PartDuReleve[] {
  const affectations: PartDuReleve[] = mouvementsAffectes(lignes, categories).map((m) => ({
    ligne: m.ligne,
    origine: 'affectation',
    libelle: m.categorie.libelle,
    poste: m.categorie.poste_2035,
    nature: m.nature,
    montantPoste: m.montantPoste,
  }))
  const echeances: PartDuReleve[] = partsDesEcheances(lignes).map((p) => ({
    ligne: p.ligne,
    origine: 'emprunt',
    libelle: p.libelle,
    poste: p.poste,
    nature: 'depense',
    montantPoste: p.montantPoste,
  }))
  return [...affectations, ...echeances]
}
