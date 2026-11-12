import { compteDeBanqueDuMouvement, type CompteBancaire } from './comptesBancaires'
import type { LectureDesComptes } from './importParCompte'
import type { ModeleComptable } from './engagement'
import type { PlanComptable } from './planComptable'

// LA JAMBE DE BANQUE PAR COMPTE BANCAIRE (ligne 26.6, lot MCB5, première partie ; MCB-Q1 et MCB-Q7, tranchées le
// 11/11/2026). Le récit : HISTORIQUE.md, « 11/11/2026 — LA JAMBE DE BANQUE PAR COMPTE BANCAIRE : LES DIX FONCTIONS DU
// RELEVÉ (MCB5) ». La migration `jambe_de_banque_par_compte` (supabase/schema/20261112140844_…, en production le 12/11/2026)
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

/** Le plan sous lequel un DÉTECTEUR recompose l'écriture attendue d'un mouvement (MCB5, seconde partie) : celui du
 *  mouvement, ou nul quand sa banque ne se sait pas (comptes en cours de lecture ou illisibles). Un mouvement dont la banque
 *  ne se sait pas ne se dit ni conforme ni à réécrire : il n'est pas jugé. Les appelants qui en comptent (la Checklist, les
 *  préalables de la validation) se suspendent déjà sur des comptes lus en partie (`comptesBancaires` de leurs entrées), et
 *  un écran le dit par son bandeau ; drapeau baissé, le plan lui-même, le jugement d'hier. */
export function planPourJuger(plan: PlanComptable, ligne: MouvementDUnCompte, banques: BanquesDuDossier): PlanComptable | null {
  const p = planDuMouvement(plan, ligne, banques)
  return 'refus' in p ? null : p.plan
}

/** Le modèle sous lequel un détecteur recompose (le pendant de `planPourJuger` pour une composition qui prend le modèle). */
export function modelePourJuger(modele: ModeleComptable, ligne: MouvementDUnCompte, banques: BanquesDuDossier): ModeleComptable | null {
  const m = modeleDuMouvement(modele, ligne, banques)
  return 'refus' in m ? null : m.modele
}

// LE PAIEMENT D'UNE PIÈCE AU 512 DU COMPTE DE SON MOUVEMENT (MCB5, quatrième partie ; HISTORIQUE.md, « LA JAMBE DE BANQUE PAR
// COMPTE BANCAIRE : LE PAIEMENT D'UNE PIÈCE »). Aucune fonction SQL ne vérifie la contrepartie d'une pièce : c'est
// l'application qui l'écrit au compte du mouvement, et qui la RECONNAÎT ensuite sur l'ensemble des 512 du dossier.

/** Les comptes de banque du dossier : celui du rôle et le 512 propre de chacun de ses comptes bancaires, quelle que soit sa
 *  date (une ligne écrite au 512 d'un compte est une ligne de banque, même avant `compte_propre_depuis` : c'est alors une
 *  ligne à réécrire, jamais une charge). Comptes en cours de lecture ou illisibles : le rôle seul — un détecteur ne juge
 *  pas un paiement dont la banque ne se sait pas (`banquesDesPaiementsConnues`). Drapeau baissé, le rôle : hier. */
export function comptesDeBanqueDuDossier(plan: PlanComptable, banques: BanquesDuDossier): ReadonlySet<string> {
  if (banques.cas !== 'par_compte') return new Set([plan.banque])
  const comptes = new Set([plan.banque, banques.role])
  for (const c of banques.comptes.values()) if (c.compte !== null) comptes.add(c.compte)
  return comptes
}

/** Ce qu'un paiement de pièce par le relevé porte de son mouvement : le mouvement, sa date, son compte bancaire. */
export interface PaiementDUnMouvement {
  id: string
  date: string
  compte_bancaire_id?: string | null
}

/** Le refus qui retient l'écriture d'une pièce : le premier paiement par le relevé dont la banque ne se sait pas. Nul quand
 *  chaque banque se sait — toujours, drapeau baissé. Un paiement par la caisse (`origine: 'caisse'`) n'en a pas. */
export function refusDesBanquesDesPaiements(
  paiements: readonly ({ origine: string } & Partial<PaiementDUnMouvement>)[], banques: BanquesDuDossier,
): string | null {
  for (const p of paiements) {
    if (p.origine === 'caisse' || p.id === undefined || p.date === undefined) continue
    const banque = banqueDuMouvement({ date: p.date, compte_bancaire_id: p.compte_bancaire_id }, banques)
    if ('refus' in banque) return banque.refus
  }
  return null
}

// ── LES LECTEURS DE LA BANQUE (MCB5, quatrième partie) ──────────────────────────────────────────────────────────────────
//
// Un LECTEUR des écritures (la piste d'audit, le pilotage, la trésorerie de Financement, l'ouverture de la banque) reconnaît
// la banque à son compte. Hier le seul compte du rôle `banque` ; dès qu'un compte bancaire tient son 512 (MCB-Q1, MCB-Q7),
// ses écritures s'y écrivent, et un lecteur qui ne regarderait que le rôle les tairait : une ligne de banque sans mouvement ne
// romprait plus la piste, la trésorerie oublierait le second compte. L'ensemble est celui de `comptesDeBanqueDuDossier` ;
// un lecteur distingue en plus des comptes qui ne se savent pas, où il ne compte pas (il tairait un compte).

/** Les comptes de la banque du dossier pour un lecteur qui en COMPTE (une trésorerie, un solde) : `comptesDeBanqueDuDossier`,
 *  ou nul quand les comptes ne se savent pas (en cours de lecture, illisibles). Drapeau baissé : le seul compte du rôle. */
export function banqueDesLecteurs(plan: PlanComptable, banques: BanquesDuDossier): ReadonlySet<string> | null {
  return banques.cas === 'retenu' ? null : comptesDeBanqueDuDossier(plan, banques)
}

/** Ce compte porte-t-il la banque du dossier ? Le compte du rôle toujours, quoi qu'on sache des comptes ; un autre, selon les
 *  comptes lus — nul quand ils ne se savent pas : le lecteur ne le juge pas (un écran qui en compte le dit par son bandeau,
 *  la Checklist et la validation se suspendent déjà sur des comptes lus en partie). */
export function estUneBanque(compte: string, plan: PlanComptable, banques: BanquesDuDossier): boolean | null {
  if (compte === plan.banque) return true
  const comptes = banqueDesLecteurs(plan, banques)
  return comptes === null ? null : comptes.has(compte)
}
