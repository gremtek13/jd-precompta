import { COMPTE_BANQUE } from './comptes'
import type { EcritureBrouillon } from './types'

// Piste d'audit fiable — les ruptures de la chaîne « écriture → justificatif → opération réelle ».
//
// POURQUOI CE MODULE EXISTE, alors que `analyserEcritures` contrôle déjà le brouillon. Ses trois
// contrôles partent tous de la PIÈCE : ils regroupent les écritures par `piece_id`, et la toute
// première ligne de la boucle est `if (!e.piece_id) continue`. Une écriture sans pièce n'a donc pas
// de groupe, et devient invisible aux trois à la fois. C'est mot pour mot le défaut de
// `categoriesSansCompte` face à une pièce dont la catégorie est nulle (voir controles.ts) : un
// contrôle qui part d'un côté de la relation ne peut pas voir ce qui manque de l'autre.
//
// CE QUE ÇA COÛTE, mesuré en production le 19/09/2026. Une écriture de 199,99 € (compte 606100,
// « BOULANGER MARSEILLE ») n'a plus de `piece_id` : deux pièces du même fournisseur existaient, une
// a été supprimée, et Postgres a mis le lien à NULL — les deux clés étrangères d'`ecritures_brouillon`
// sont en `ON DELETE SET NULL`. Résultat, cette charge de 199,99 € :
//   - est comptée dans la Balance des comptes (`calculerBalance` regroupe par COMPTE, pas par pièce) ;
//   - est ABSENTE du FEC (`genererFec` fait le même `if (!e.piece_id) continue`, et c'est le bon
//     choix : inventer une référence de pièce serait pire) ;
//   - n'est signalée par AUCUN des trois contrôles d'intégrité.
// La balance et le fichier fiscal ne disent donc pas le même résultat, et rien ne l'annonce. C'est
// précisément ce qu'un contrôleur cherche en premier : montrez-moi la pièce de cette charge.
//
// Pur, sans accès à la base : ne prend que des lignes déjà chargées (voir l'en-tête de comptes.ts
// sur la raison pour laquelle les constantes PCG vivent à part).

export type MotifRupture =
  // L'écriture ne désigne aucun justificatif. Elle reste dans la balance et sort du FEC.
  | 'sans_justificatif'
  // L'écriture de contrepartie annonce un mouvement bancaire mais n'en nomme aucun. Elle ne peut
  // venir que d'une ligne bancaire supprimée (un relevé réimporté, par exemple) : l'insertion, elle,
  // pose toujours `ligne_bancaire_id` (voir contrepartieBanque.ts).
  | 'sans_mouvement'

export interface RuptureAudit {
  ecriture: EcritureBrouillon
  motif: MotifRupture
}

// Une écriture peut porter les deux ruptures à la fois (contrepartie banque dont la pièce ET la
// ligne ont disparu) : elle est alors rendue deux fois, une par motif. Les fusionner obligerait
// l'écran à traiter un cas composite pour n'économiser qu'une ligne.
export function rupturesPisteAudit(ecritures: EcritureBrouillon[]): RuptureAudit[] {
  const ruptures: RuptureAudit[] = []
  for (const ecriture of ecritures) {
    if (!ecriture.piece_id) ruptures.push({ ecriture, motif: 'sans_justificatif' })
    if (ecriture.compte === COMPTE_BANQUE && !ecriture.ligne_bancaire_id) {
      ruptures.push({ ecriture, motif: 'sans_mouvement' })
    }
  }
  return ruptures
}

// DÉLIBÉRÉMENT ABSENT : « l'écriture désigne une pièce qui n'est pas dans le jeu fourni ».
// L'appelant le plus naturel (EcrituresTab) ne charge que les pièces VALIDÉES ; une pièce repassée
// « à valider » ferait donc crier au loup sur un artefact de filtrage, pas sur une rupture. Un
// avertissement qui se trompe souvent finit par ne plus être lu — et c'est celui-là qu'on ne peut
// pas se permettre de ne plus lire. Le seul signal retenu ici est `piece_id` nul, qui ne dépend
// d'aucun jeu de données à côté.

export interface AbsenceFec {
  nb: number
  debit: number
  credit: number
}

// Ce que la Balance des comptes affiche et que le FEC ne contiendra pas — à dire AVANT de
// télécharger le fichier, pas après. Le format FEC est rigide : impossible d'y écrire une feuille
// « lignes manquantes » comme le pack Excel le fait pour ses pièces. Le seul endroit où ce livrable
// incomplet peut se déclarer est donc l'écran qui l'engendre.
export function absenceFec(ecritures: EcritureBrouillon[]): AbsenceFec {
  const horsFec = ecritures.filter((e) => !e.piece_id)
  return {
    nb: horsFec.length,
    debit: horsFec.filter((e) => e.sens === 'debit').reduce((somme, e) => somme + e.montant, 0),
    credit: horsFec.filter((e) => e.sens === 'credit').reduce((somme, e) => somme + e.montant, 0),
  }
}
