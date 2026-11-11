import { compteDeBanqueDuMouvement, type CompteBancaire } from './comptesBancaires'
import type { LectureDesComptes } from './importParCompte'
import type { ModeleComptable } from './engagement'
import type { PlanComptable } from './planComptable'

// LA JAMBE DE BANQUE PAR COMPTE BANCAIRE (ligne 26.6, lot MCB5, première partie ; MCB-Q1 et MCB-Q7, tranchées le
// 11/11/2026). Le récit : HISTORIQUE.md, « 11/11/2026 — LA JAMBE DE BANQUE PAR COMPTE BANCAIRE : LES DIX FONCTIONS DU
// RELEVÉ (MCB5) ». La migration `jambe_de_banque_par_compte` (supabase/preparees/20261111200000_…, préparée, pas appliquée)
// fait vérifier par les fonctions du relevé une jambe de banque au compte du MOUVEMENT (`compte_de_banque_du_mouvement`,
// MCB1) : le 512 propre de son compte bancaire quand ce compte en tient un à la date du mouvement, celui du rôle `banque`
// du plan sinon. Ce module dit, côté application, la banque où la composition d'un mouvement écrit sa jambe :
//   - drapeau `COMPTES_BANCAIRES_PREVUS` baissé (la lecture est `sans_objet`), ou un dossier dont aucun compte ne tient son
//     512 : la banque du rôle, et `planDuMouvement` rend le PLAN LUI-MÊME — l'écriture d'hier, à l'octet près ;
//   - un dossier dont un compte tient son 512 : la banque de chaque mouvement, par la règle de la base
//     (`compteDeBanqueDuMouvement`, que comptesBancaires.test.ts confronte au texte de MCB1) ;
//   - des comptes en cours de lecture, illisibles, ou un mouvement d'un compte que la lecture ne rend pas : un REFUS, et
//     aucun geste — la base refuserait l'écriture d'un autre 512, l'écran le dit avant.
// Les compositions ne changent pas (leur signature est celle que copie l'assistant) : elles reçoivent le plan DU
// MOUVEMENT, dont la banque est celle du mouvement. COMPTES_BANCAIRES_PREVUS ne se lève qu'avec cette migration en base
// (banqueDuMouvement.test.ts l'exige de l'export).

/** Ce qu'une composition sait des comptes bancaires du dossier pour la jambe de banque de ses mouvements. */
export type BanquesDuDossier =
  | { cas: 'role'; compte: string }
  | { cas: 'par_compte'; role: string; comptes: ReadonlyMap<string, Pick<CompteBancaire, 'principal' | 'compte' | 'compte_propre_depuis'>> }
  | { cas: 'retenu'; raison: string }

/** Les banques du dossier, de la lecture de ses comptes et de son plan. Sans défaut : l'appelant dit ce qu'il a lu. */
export function banquesDuDossier(lecture: LectureDesComptes, plan: PlanComptable): BanquesDuDossier {
  if (lecture.etat === 'sans_objet') return { cas: 'role', compte: plan.banque }
  if (lecture.etat === 'en_cours') {
    return { cas: 'retenu', raison: 'Les comptes bancaires du dossier sont en cours de lecture : l’écriture attend de savoir sur quel compte de banque elle s’écrit.' }
  }
  if (lecture.etat === 'illisible') {
    return { cas: 'retenu', raison: `Les comptes bancaires du dossier n’ont pas été lus en entier (${lecture.motif}) : l’écriture ne sait pas `
      + 'sur quel compte de banque elle s’écrit. Recharge la page.' }
  }
  if (lecture.comptes.every((c) => c.compte === null)) return { cas: 'role', compte: plan.banque }
  return { cas: 'par_compte', role: plan.banque, comptes: new Map(lecture.comptes.map((c) => [c.id, c])) }
}

/** Un mouvement, tel que la banque de sa jambe le lit : sa date et son compte bancaire (nul ou absent avant MCB1). */
export interface MouvementDUnCompte {
  date: string
  compte_bancaire_id?: string | null
}

export type BanqueDuMouvement = { compte: string } | { refus: string }

/** Le compte 512 où s'écrit la jambe de banque de ce mouvement, ou le refus qui retient l'écriture. */
export function banqueDuMouvement(ligne: MouvementDUnCompte, banques: BanquesDuDossier): BanqueDuMouvement {
  if (banques.cas === 'role') return { compte: banques.compte }
  if (banques.cas === 'retenu') return { refus: banques.raison }
  const compte = ligne.compte_bancaire_id ? banques.comptes.get(ligne.compte_bancaire_id) : undefined
  if (!compte) {
    return { refus: 'Le compte bancaire de ce mouvement n’est pas dans la lecture des comptes du dossier : son écriture ne sait pas sur '
      + 'quel compte de banque elle s’écrit. Recharge la page.' }
  }
  return { compte: compteDeBanqueDuMouvement(compte, ligne.date, banques.role) }
}

export type PlanDuMouvement = { plan: PlanComptable } | { refus: string }

/** Le plan sous lequel la composition d'un mouvement écrit : le plan lui-même quand la banque du mouvement est celle du
 *  rôle (le même objet : rien ne change), sinon une copie dont la banque est celle du mouvement. */
export function planDuMouvement(plan: PlanComptable, ligne: MouvementDUnCompte, banques: BanquesDuDossier): PlanDuMouvement {
  const banque = banqueDuMouvement(ligne, banques)
  if ('refus' in banque) return banque
  return { plan: banque.compte === plan.banque ? plan : Object.freeze({ ...plan, banque: banque.compte }) }
}

export type ModeleDuMouvement = { modele: ModeleComptable } | { refus: string }

/** Le modèle d'un mouvement : le modèle lui-même quand son plan ne change pas, sinon le même avec le plan du mouvement. */
export function modeleDuMouvement(modele: ModeleComptable, ligne: MouvementDUnCompte, banques: BanquesDuDossier): ModeleDuMouvement {
  const p = planDuMouvement(modele.plan, ligne, banques)
  if ('refus' in p) return p
  return { modele: p.plan === modele.plan ? modele : { ...modele, plan: p.plan } }
}
