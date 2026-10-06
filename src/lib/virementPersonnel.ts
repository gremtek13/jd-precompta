import {
  ecritureConforme, ecritureDuMouvement, ecrituresSansPieceParMouvement, type LigneEcritureMouvement, type MouvementBancaire,
} from './affectationBanque'
import { refusEcritSurUnCompteDeBilan } from './classementsDuMouvement'
import { COMPTE_EXPLOITANT } from './comptes'
import type { ModeleComptable } from './engagement'
import { REFUS_REGLE_EN_GROUPE } from './reglementGroupe'
import type { EcritureBrouillon } from './types'
import { estFigee } from './validationExercice'

// UN VIREMENT PERSONNEL S'ÉCRIT SUR LE COMPTE DU DIRIGEANT (ligne 26.6 de la feuille de route, étape a).
//
// Le bouton « Virement personnel » de l'onglet Banque classait le mouvement sans rien écrire : un
// prélèvement de l'exploitant — ou un apport de sa poche — ne figurait ni dans le brouillon ni dans le
// FEC, dont le compte 512 ne retrouvait donc pas le relevé. C'est la condition posée par la ligne 26.6 :
// chaque mouvement du relevé sur un compte, pour que le FEC de l'application soit celui du dossier.
//
// CE QUI S'ÉCRIT : le compte du dirigeant face à la banque, au montant, à la date et dans le sens du
// mouvement — un prélèvement débite le compte du dirigeant, un apport le crédite. C'est l'écriture d'un
// mouvement affecté (`ecritureDuMouvement`), sur un autre compte : la règle du sens est la même, et elle
// n'est écrite qu'une fois. La fonction SQL `classer_virement_personnel` la vérifie contre le mouvement
// et le compte du dossier, puis l'écrit AVEC le classement, dans une seule transaction (voir
// `supabase/essais/virementPersonnel.sql`).
//
// CE N'EST PAS UNE CHARGE, et rien ici ne touche au résultat : le compte du dirigeant est un compte de
// bilan. La 2035, la situation intermédiaire et l'estimation ne le voient pas ; la trésorerie, la
// balance et le FEC, si.

// LE COMPTE DU DIRIGEANT SE LIT DANS LE MODÈLE DU DOSSIER. En trésorerie — une entreprise individuelle
// aux bénéfices non commerciaux —, c'est le compte de l'exploitant, 108, qui retrace ses apports et ses
// prélèvements personnels. En engagement, c'est le compte que le cabinet a choisi pour le dirigeant, le
// même que celui de ses notes de frais (455 pour un associé de société, 108 pour un exploitant, 467 sinon) :
// deux comptes pour la même personne partageraient ce qu'on lui doit en deux moitiés. La base fait le
// même choix, et refuse une écriture sur un autre compte.
export function compteDuDirigeant(modele: ModeleComptable): string {
  return modele.mode === 'engagement' ? modele.compteNotesDeFrais : COMPTE_EXPLOITANT
}

// Pourquoi ce mouvement ne peut pas être classé en virement personnel, dit AVANT d'écrire. La base
// refait les mêmes refus : l'écran les dit pour qu'on ne clique pas pour rien, la base pour qu'aucun
// chemin ne les contourne.
export function refusVirementPersonnel(ligne: MouvementBancaire): string | null {
  if (ligne.reglement_groupe) return REFUS_REGLE_EN_GROUPE
  const surUnCompteDeBilan = refusEcritSurUnCompteDeBilan(ligne)
  if (surUnCompteDeBilan) return surUnCompteDeBilan
  if (ligne.piece_id || ligne.cotisation_id || ligne.categorie_id || ligne.emprunt_id || ligne.ventilee) {
    return 'Ce mouvement est rapproché d’une pièce, d’une cotisation ou d’un emprunt, affecté à une catégorie ou ventilé sur plusieurs comptes : annule d’abord ce classement.'
  }
  if (ligne.montant === 0) return 'Un mouvement de zéro euro n’a rien à écrire.'
  return null
}

// Sans TVA : un virement personnel n'est ni une recette ni une dépense, il ne collecte ni ne déduit rien.
export function ecritureDuVirementPersonnel(ligne: MouvementBancaire, modele: ModeleComptable): LigneEcritureMouvement[] {
  return ecritureDuMouvement(ligne, compteDuDirigeant(modele), null)
}

// LES VIREMENTS PERSONNELS À ÉCRIRE : ceux dont l'écriture n'est pas celle que le classement produirait
// aujourd'hui. Le cas réel est l'écriture ABSENTE — un virement classé avant le 29/09/2026, quand le
// bouton n'écrivait rien : il manque au FEC et à la trésorerie, et rien ne le dit. Le reste — un autre
// compte, un autre montant, un autre sens, une autre date — est défensif : la transaction de la base
// écrit le classement et l'écriture ensemble, et le compte du dirigeant ne change plus dès qu'une
// écriture existe (déclencheur `dossiers_verrouiller_modele_comptable`).
//
// Un mouvement qui ne PEUT pas s'écrire n'est pas rendu : de zéro euro, il n'a rien à écrire ; rapproché
// ou affecté, il n'est pas un virement personnel qu'on puisse écrire. « Écrire » ne réussirait sur aucun.
// Ni un virement d'un exercice VALIDÉ (lib/validationExercice.ts) : la base refuse d'y écrire. Il ne peut en
// manquer un que d'avant l'ouverture d'un dossier repris, classé avant le 29/09/2026 — la validation refuse un
// exercice dont un virement n'est pas écrit —, et la réclamer laisserait un point que rien ne lève. Sans valeur
// par défaut : un appelant qui oublie la frontière réclamerait une écriture que la base refuse.
export function virementsPersonnelsAEcrire<L extends MouvementBancaire>(
  ecritures: readonly EcritureBrouillon[],
  lignes: readonly L[],
  modele: ModeleComptable,
  frontiere: string | null,
): L[] {
  const parLigne = ecrituresSansPieceParMouvement(ecritures)
  return lignes.filter((l) =>
    l.prelevement_personnel
    && !refusVirementPersonnel(l)
    && !estFigee(l.date, frontiere)
    && !ecritureConforme(parLigne.get(l.id) ?? [], ecritureDuVirementPersonnel(l, modele), l.date))
}
