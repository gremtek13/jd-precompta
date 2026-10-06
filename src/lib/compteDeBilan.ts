import {
  ecritureConforme, ecritureDuMouvement, ecrituresSansPieceParMouvement, type LigneEcritureMouvement, type MouvementBancaire,
} from './affectationBanque'
import {
  COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES, COMPTE_VIREMENTS_INTERNES, libelleCompteTenu, libelleDuPlanComptable,
} from './comptes'
import { refusPaieUneDeclarationTva } from './classementsDuMouvement'
import type { ModeleComptable } from './engagement'
import { REFUS_REGLE_EN_GROUPE } from './reglementGroupe'
import type { EcritureBrouillon, LigneBancaire, ModeComptable } from './types'
import { estFigee } from './validationExercice'
import { compteDuDirigeant } from './virementPersonnel'

// UN MOUVEMENT VERS UN COMPTE DE BILAN S'ÉCRIT (ligne 26.7 de la feuille de route).
//
// L'affectation range un mouvement dans une catégorie de charge ou de produit, et seuls quelques comptes de bilan
// avaient un chemin à eux : le compte du dirigeant (« Virement personnel »), le 164 (l'emprunt), le 646 et le 108
// d'une cotisation, le compte d'un bien (son acquisition). Un virement vers le compte d'épargne du professionnel, un
// dépôt de garantie versé pour le bail du cabinet ou rendu à sa sortie ne pouvaient qu'être IGNORÉS : ils manquaient
// au FEC, et le 512 du brouillon s'écartait du relevé.
//
// Décision du cabinet du 06/10/2026 : le virement entre comptes au 580000, le dépôt de garantie au 275000, et un
// compte de bilan au choix, sous les contrôles de l'application. Le paiement de la TVA et le remboursement d'un crédit
// (445510, 445830) se rapprochent de leur déclaration (ligne 26.8, lib/liquidationTva.ts), qui les écrit.
//
// CE QUI S'ÉCRIT : le compte choisi face à la banque, au montant, à la date et dans le sens du mouvement — la règle
// d'une affectation (`ecritureDuMouvement`), sur un compte de bilan, sans TVA. Ni charge ni recette : la 2035, la
// situation intermédiaire et l'estimation ne le voient pas ; la balance, le FEC et le solde de la banque, si. Le
// compte se garde sur le mouvement (`lignes_bancaires.compte_bilan`), et la fonction SQL
// `ecrire_mouvement_compte_bilan` refait les refus d'ici dans le même ordre, vérifie l'écriture et l'écrit AVEC le
// compte, dans une transaction ; `retirer_mouvement_compte_bilan` remet le mouvement à traiter et retire son
// écriture (voir `supabase/essais/compteBilan.sql`).

export interface CompteDeBilanPropose {
  compte: string
  // Ce que le cabinet lit sur le bouton.
  libelle: string
  // Ce que le compte dit — et ce qu'il ne dit pas —, sous le bouton.
  aide: string
}

// LES DEUX COMPTES PROPOSÉS. Le 580000 se solde, dans un plan tenu en entier, quand l'autre compte enregistre le même
// virement en sens inverse ; l'application ne tient qu'un relevé, donc il garde ici le solde de ce qui a été versé
// sur l'autre compte, que le relevé de cet autre compte justifie.
export const COMPTES_DE_BILAN_PROPOSES: readonly CompteDeBilanPropose[] = [
  {
    compte: COMPTE_VIREMENTS_INTERNES,
    libelle: 'Virement entre comptes',
    aide: 'Vers un autre compte du professionnel — un compte d’épargne, un second compte bancaire — ou depuis lui. '
      + 'L’autre compte n’est pas tenu dans l’application : le 580000 garde le solde de ce qui y a été versé, '
      + 'que son propre relevé justifie.',
  },
  {
    compte: COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES,
    libelle: 'Dépôt de garantie',
    aide: 'Versé pour le bail du cabinet ou un matériel loué, ou rendu à la sortie : une créance du professionnel, '
      + 'ni charge ni recette.',
  },
]

// Le libellé d'un compte de bilan pour l'écran : celui que l'application lui donne quand elle le tient, sinon celui du
// plan comptable — le même que la balance et le FEC, à la balance reprise près, qui peut le nommer plus précisément.
export function libelleDuCompteDeBilan(compte: string): string | null {
  return libelleCompteTenu(compte) ?? libelleDuPlanComptable(compte)
}

// LA SAISIE D'UN COMPTE, rendue sous la forme des comptes de l'application. Les espaces et les points qu'on tape pour se
// relire (« 275 000 », « 27.41 ») sont retirés ; trois chiffres au moins — un compte du plan se désigne ainsi : 275,
// les dépôts et cautionnements versés —, dix au plus, la limite de la base.
//
// LES ZÉROS DE FIN NE SONT PAS SIGNIFICATIFS : un plan de comptes complète ses numéros par des zéros à droite, donc
// 275, 2750 et 2750000 désignent le même compte, et l'application l'écrit 275000, comme tous les siens. Sans cela, deux
// saisies du même compte en feraient deux dans la balance et dans le FEC, chacun avec une part du solde.
//
// Rien de tapé n'est pas un refus : l'écran grise le bouton sans rien reprocher.
export interface SaisieDeCompte {
  compte: string | null
  refus: string | null
}

export function lireCompteSaisi(saisie: string): SaisieDeCompte {
  const chiffres = saisie.replace(/[\s.  ]/g, '')
  if (!chiffres) return { compte: null, refus: null }
  if (!/^\d+$/.test(chiffres)) return { compte: null, refus: 'Un numéro de compte ne s’écrit qu’avec des chiffres.' }
  if (chiffres.length < 3) {
    return { compte: null, refus: 'Un compte se désigne par trois chiffres au moins : 275 pour les dépôts et cautionnements versés.' }
  }
  if (chiffres.length > 10) return { compte: null, refus: 'Un numéro de compte a dix chiffres au plus.' }
  return { compte: chiffres.replace(/0+$/, '').padEnd(6, '0'), refus: null }
}

// POURQUOI CE COMPTE NE PEUT PAS RECEVOIR UN MOUVEMENT DU RELEVÉ, nul quand il le peut. LE MÊME ORDRE ET LES MÊMES
// RAISONS QUE `refus_compte_de_bilan` en base, que la fonction d'écriture appelle : l'écran les dit pour qu'on ne
// clique pas pour rien, la base pour qu'aucun chemin ne les contourne. `compteDeBilan.test.ts` exécute la fonction SQL
// exportée sur les mêmes comptes et compare.
//
// Chaque refus dit où va le mouvement : un compte qui a son chemin dans l'application (le dirigeant, l'emprunt, la
// facture, le registre des biens, une catégorie) le garde, parce que ce chemin écrit ce que ce compte demande — le
// découpage d'une échéance, la dette d'une facture, l'amortissement d'un bien. Les autres ne reçoivent pas un mouvement
// de banque : ils naissent d'une écriture d'inventaire ou de l'affectation du résultat. Un compte d'attente non plus —
// un mouvement qu'on ne sait pas encore classer reste à traiter, sans quoi il échapperait à la validation.
export function refusCompteDeBilan(compte: string | null, mode: ModeComptable, dirigeant: string): string | null {
  if (compte == null || !/^[0-9]{6,10}$/.test(compte)) {
    return 'Ce numéro de compte n’a pas la forme d’un compte de l’application : six à dix chiffres.'
  }
  if (/^[67]/.test(compte)) return 'Un compte de charge ou de produit (classe 6 ou 7) s’affecte par une catégorie.'
  if (!/^[1-5]/.test(compte)) return 'Un compte de bilan est de classe 1 à 5.'
  if (/^512/.test(compte)) {
    return 'Le 512 est le compte du relevé lui-même. Un virement vers un autre compte du professionnel (épargne, second '
      + 'compte bancaire) s’écrit au 580000, virements internes.'
  }
  if (/^5[1-4]/.test(compte)) {
    return 'Un virement vers un autre compte de trésorerie du professionnel (autre banque, caisse, chèques postaux, régie '
      + 'd’avances) s’écrit au 580000, virements internes.'
  }
  if (compte === dirigeant || /^108/.test(compte)) {
    return `Les apports et les prélèvements du dirigeant passent par « Virement personnel », qui les écrit sur son compte (${dirigeant}).`
  }
  if (/^164/.test(compte)) {
    return 'Une échéance ou un déblocage d’emprunt se rapproche de son emprunt, qui sépare le capital, les intérêts et '
      + 'l’assurance : « Rapprocher d’un emprunt ».'
  }
  if (/^4[01]/.test(compte)) return 'Un compte de fournisseur ou de client se solde en rapprochant la facture du mouvement.'
  if (/^445/.test(compte)) {
    return 'Un compte de TVA ne se choisit pas ici : la TVA se solde par sa déclaration, enregistrée dans l’onglet TVA, et '
      + 'son paiement ou le remboursement d’un crédit se rapproche ensuite d’elle, depuis cette fiche.'
  }
  if (/^2[012]/.test(compte)) {
    return 'Un bien s’inscrit au registre des immobilisations depuis sa facture : son acquisition s’écrit sur le compte '
      + 'de sa nature, et il s’amortit.'
  }
  if (/^(2[89]|39|49|59)/.test(compte)) return 'Un compte d’amortissement ou de dépréciation ne reçoit pas un mouvement de banque.'
  if (/^3/.test(compte)) return 'Un compte de stock ne reçoit pas un mouvement de banque : le stock se constate à l’inventaire.'
  if (/^(10[5-7]|1[12])/.test(compte)) {
    return 'Les réserves, les écarts de réévaluation ou d’équivalence, le report à nouveau et le résultat ne reçoivent pas '
      + 'un mouvement de banque : ils naissent de l’affectation du résultat ou d’une écriture d’inventaire.'
  }
  if (/^1[45]/.test(compte)) return 'Une provision ne reçoit pas un mouvement de banque : elle se constate à l’inventaire.'
  if (/^47/.test(compte)) {
    return 'Un compte transitoire ou d’attente ne garde pas un mouvement : un mouvement qu’on ne sait pas encore classer '
      + 'reste à traiter, et l’exercice ne se valide qu’une fois tout classé.'
  }
  if (/^(468|48)/.test(compte)) {
    return 'Un compte de régularisation (charges à payer, produits à recevoir, charges ou produits constatés d’avance) ne '
      + 'reçoit pas un mouvement de banque : il se passe à l’inventaire.'
  }
  if (mode === 'tresorerie' && /^4[234]/.test(compte)) {
    return 'En comptabilité de trésorerie, un salaire, une cotisation ou un impôt payés sont des charges : range le '
      + 'paiement dans une catégorie. L’impôt sur le revenu de l’exploitant est un virement personnel.'
  }
  if (mode === 'engagement' && /^4[234]/.test(compte) && !/^444/.test(compte)) {
    return 'L’application ne passe pas l’écriture qui solderait ce compte (paie, impôts et taxes) : range le paiement '
      + 'dans une catégorie de charge.'
  }
  return null
}

// Le classement que la fonction d'écriture refuse AVANT de regarder le compte, dans son ordre : un règlement groupé,
// tout autre lien du mouvement, un mouvement de zéro euro. Un mouvement déjà écrit sur un compte de bilan, lui, se
// réécrit — la fonction remplace le compte et l'écriture. Un mouvement qui paie une déclaration de TVA, la fonction
// ne le refuse pas nommément : c'est la contrainte d'un seul rapprochement qui l'arrête, sous son nom. L'écran le dit
// donc ici, avec les refus du mouvement (lib/classementsDuMouvement.ts).
export const REFUS_COMPTE_DE_BILAN_CLASSE =
  'Ce mouvement est rapproché d’une pièce, d’une cotisation ou d’un emprunt, affecté à une catégorie, ventilé sur '
  + 'plusieurs comptes ou classé en virement personnel : annule d’abord ce classement.'

export function refusMouvementCompteDeBilan(ligne: MouvementBancaire): string | null {
  if (ligne.reglement_groupe) return REFUS_REGLE_EN_GROUPE
  const paieUneDeclaration = refusPaieUneDeclarationTva(ligne)
  if (paieUneDeclaration) return paieUneDeclaration
  if (ligne.piece_id || ligne.cotisation_id || ligne.categorie_id || ligne.emprunt_id || ligne.ventilee || ligne.prelevement_personnel) {
    return REFUS_COMPTE_DE_BILAN_CLASSE
  }
  if (ligne.montant === 0) return 'Un mouvement de zéro euro n’a rien à écrire.'
  return null
}

// Tout ce qui refuserait d'écrire CE mouvement sur CE compte, dans l'ordre de la base : le mouvement, puis le compte,
// jugé avec le compte du dirigeant du dossier (`compteDuDirigeant` : le 108000 en trésorerie, le compte choisi pour
// lui en engagement), que la base lit de même. Un exercice validé n'est pas jugé ici : l'écran ne propose pas un
// mouvement figé (lib/validationExercice.ts), et la base le refuserait.
export function refusCompteDeBilanDuMouvement(
  ligne: MouvementBancaire,
  compte: string | null,
  modele: ModeleComptable,
): string | null {
  return refusMouvementCompteDeBilan(ligne) ?? refusCompteDeBilan(compte, modele.mode, compteDuDirigeant(modele))
}

// L'écriture d'un mouvement sur un compte de bilan : ce compte face à la banque, dans le sens du mouvement, sans TVA.
export function ecritureDuCompteDeBilan(ligne: MouvementBancaire, compte: string): LigneEcritureMouvement[] {
  return ecritureDuMouvement(ligne, compte, null)
}

// LES MOUVEMENTS ÉCRITS SUR UN COMPTE DE BILAN DONT L'ÉCRITURE N'EST PLUS CELLE QUE LEUR COMPTE PRODUIRAIT : absente,
// sur un autre compte, d'un autre montant, dans un autre sens ou à une autre date. DÉFENSIF : la base écrit le compte et
// l'écriture dans la même transaction, et aucun geste de l'application ne retire l'une sans l'autre. Un contrôle qui
// parle trop se corrige ; celui qui se tait ne se voit pas. « Réécrire » rejoue la fonction avec le même compte.
//
// Un mouvement d'un exercice VALIDÉ ne se juge plus : la base refuse de réécrire son écriture. Sans valeur par défaut.
export function mouvementsSurUnCompteDeBilanDesynchronises<L extends MouvementBancaire>(
  ecritures: readonly EcritureBrouillon[],
  lignes: readonly L[],
  frontiere: string | null,
): L[] {
  const parLigne = ecrituresSansPieceParMouvement(ecritures)
  return lignes.filter((l) =>
    !!l.compte_bilan
    && l.statut === 'rapprochee'
    && !estFigee(l.date, frontiere)
    && !ecritureConforme(parLigne.get(l.id) ?? [], ecritureDuCompteDeBilan(l, l.compte_bilan), l.date))
}

// LES MOUVEMENTS ÉCRITS SUR UN COMPTE DE BILAN NE SONT PAS UN RYTHME D'ACTIVITÉ. Un virement vers le compte d'épargne,
// un dépôt de garantie versé ou rendu, un prêt : écrits au 512, ils entreraient dans les moyennes d'encaissements et de
// décaissements du plan de trésorerie — un virement rapatrié de l'épargne flatterait le taux d'endettement, sur le
// document qu'on montre à une banque —, comme le déblocage d'un emprunt ou l'achat d'un bien, que le plan écarte déjà.
// Le SOLDE, lui, les compte : l'argent est bien parti ou arrivé. Les identifiants des mouvements, pour que l'écran
// écarte leurs écritures de la seule moyenne.
export function idsMouvementsSurUnCompteDeBilan(
  lignes: readonly Pick<LigneBancaire, 'id' | 'statut' | 'compte_bilan'>[],
): ReadonlySet<string> {
  return new Set(lignes.filter((l) => l.statut === 'rapprochee' && !!l.compte_bilan).map((l) => l.id))
}
