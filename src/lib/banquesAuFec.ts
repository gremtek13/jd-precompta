import { banqueDesLecteurs, type BanquesDuDossier } from './banqueDuMouvement'
import { libelleCompteTenu } from './comptes'
import type { NumerotationFec } from './fec'
import type { PlanComptable } from './planComptable'

// LES DEUX RENDUS DE LA BANQUE AU FEC (ligne 26.6, MCB5, quatrième partie ; MCB-Q4, tranchée le 11/11/2026 à la
// recommandation : « un 512 par compte au FEC, demandé à l'expert-comptable avec FEC22-E »). Le récit : HISTORIQUE.md,
// « LA JAMBE DE BANQUE PAR COMPTE BANCAIRE : LES LECTEURS (MCB5, QUATRIÈME PARTIE) ».
//
// Le brouillon porte la banque de chaque mouvement au 512 de SON compte (MCB-Q1) ; la numérotation (`numeroterFec`) et ce
// que la validation fige (`numerotationValidee`) en gardent le numéro. Le FEC se rend de deux façons, choisies au RENDU,
// jamais à la numérotation : un exercice validé se relit de ses colonnes figées, et les deux rendus en sortent.
//   - `un_512_par_compte` (le rendu retenu) : chaque compte bancaire à son 512 — la numérotation telle quelle, le même
//     objet. Drapeau baissé, ou aucun compte qui tienne son 512 : le seul 512 du rôle, le fichier d'hier à l'octet près.
//   - `un_seul_512` (si l'expert-comptable le demande, FEC22-E) : chaque ligne et chaque à-nouveau d'un 512 propre passent
//     au compte du rôle `banque`, sous SON CompteLib (un même CompteNum ne porte qu'un libellé dans le fichier) ; le libellé
//     de l'écriture, les montants, les numéros et le lettrage ne bougent pas. Des comptes qui ne se savent pas : un refus,
//     le fichier ne sort pas (il garderait un 512 propre que le rendu promet d'effacer).
// Le compte du dossier, dans les deux rendus, se lit à la banque du dossier (`banqueDesLecteurs`, lib/banqueDuMouvement.ts).

export type RenduDesBanquesAuFec = 'un_512_par_compte' | 'un_seul_512'

/** Le rendu de la banque au FEC (MCB-Q4) : un 512 par compte bancaire. Il ne change que sur la réponse de l'expert-comptable
 *  (FEC22-E), et ne change rien tant qu'aucun compte ne tient son 512. */
export const RENDU_DES_BANQUES_AU_FEC: RenduDesBanquesAuFec = 'un_512_par_compte'

/** La numérotation sous le rendu demandé : la même (le même objet) pour un 512 par compte, ou pour un dossier dont la banque
 *  n'est qu'au rôle ; sinon une copie où chaque 512 propre passe au rôle. Sans défaut : l'appelant dit le rendu. */
export function rendreLesBanquesAuFec(
  numerotation: NumerotationFec, rendu: RenduDesBanquesAuFec, plan: PlanComptable, banques: BanquesDuDossier,
): NumerotationFec | { refus: string } {
  if (rendu === 'un_512_par_compte') return numerotation
  const banque = banqueDesLecteurs(plan, banques)
  if (banque === null) {
    return { refus: banques.cas === 'retenu' ? banques.raison : 'Les comptes bancaires du dossier ne se savent pas.' }
  }
  const propres = new Set([...banque].filter((c) => c !== plan.banque))
  const aReunir = numerotation.lignes.some((l) => propres.has(l.ecriture.compte))
    || numerotation.aNouveaux.some((a) => propres.has(a.aNouveau.compte))
  if (!aReunir) return numerotation
  // Le CompteLib du rôle : celui qu'il porte déjà dans le fichier (à-nouveaux d'abord, comme le fichier s'écrit), sinon
  // celui que l'application lui donne.
  const compteLib = numerotation.aNouveaux.find((a) => a.aNouveau.compte === plan.banque)?.compteLib
    ?? numerotation.lignes.find((l) => l.ecriture.compte === plan.banque)?.compteLib
    ?? libelleCompteTenu(plan.banque) ?? 'Banque'
  return {
    ...numerotation,
    aNouveaux: numerotation.aNouveaux.map((a) => propres.has(a.aNouveau.compte)
      ? { ...a, aNouveau: { ...a.aNouveau, compte: plan.banque }, compteLib } : a),
    lignes: numerotation.lignes.map((l) => propres.has(l.ecriture.compte)
      ? { ...l, ecriture: { ...l.ecriture, compte: plan.banque }, compteLib } : l),
  }
}
