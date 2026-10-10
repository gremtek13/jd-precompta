import type { CauseARevoir, EtatDuSolde } from './revision'
import type { VerdictDePreuve } from './revisionPreuves'
import type { CauseDuCycle, EtatDuCycle } from './revisionRevue'
import type { AvisRevueRevision, EtatConclusionRevision, EtatDecisionRevision } from './types'

// LES MOTS DE L'ÉCRAN DE LA RÉVISION (ligne 41, étape R3) : l'état d'un solde, le verdict d'une preuve, la décision, et
// pourquoi un solde est à revoir. Le texte garde sa couleur ; le statut se lit à la pastille (CLAUDE.md, tableaux de
// bord). Écrits une fois : l'onglet et le panneau « justifier » disent la même chose du même solde.

export interface Pastille { mot: string; classe: string }

export const ETAT_DU_SOLDE: Readonly<Record<EtatDuSolde, Pastille>> = {
  'en-attente': { mot: 'en attente', classe: 'badge-neutral' },
  'solde-nul': { mot: 'solde nul', classe: 'badge-neutral' },
  'a-justifier': { mot: 'à justifier', classe: 'badge-warning' },
  justifie: { mot: 'justifié', classe: 'badge-ok' },
  accepte: { mot: 'accepté sur motif', classe: 'badge-ok' },
  anomalie: { mot: 'anomalie', classe: 'badge-danger' },
  'a-revoir': { mot: 'à revoir', classe: 'badge-warning' },
}

export const PASTILLE_DU_VERDICT: Readonly<Record<VerdictDePreuve, Pastille>> = {
  concorde: { mot: 'concorde', classe: 'badge-ok' },
  ecart: { mot: 'écart', classe: 'badge-danger' },
  incomplete: { mot: 'ne conclut pas', classe: 'badge-warning' },
  decrit: { mot: 'décrit le solde', classe: 'badge-neutral' },
  'sans-preuve': { mot: 'aucune preuve', classe: 'badge-neutral' },
}

export const PASTILLE_DE_LA_DECISION: Readonly<Record<EtatDecisionRevision, Pastille>> = {
  justifie: { mot: 'justifié', classe: 'badge-ok' },
  accepte: { mot: 'accepté sur motif', classe: 'badge-ok' },
  anomalie: { mot: 'anomalie', classe: 'badge-danger' },
}

// La décision au milieu d'une phrase.
export const LIBELLES_DES_DECISIONS: Readonly<Record<EtatDecisionRevision, string>> = {
  justifie: 'solde justifié',
  accepte: 'solde accepté sur motif',
  anomalie: 'anomalie',
}

export const CAUSES_A_REVOIR: Readonly<Record<CauseARevoir, string>> = {
  'solde-change': 'le solde n’est plus celui de la décision — une écriture a changé depuis',
  'empreinte-changee': 'une source citée a changé d’empreinte depuis sa citation',
  'empreinte-disparue': 'une source citée n’a plus d’empreinte',
  'source-introuvable': 'une source citée est introuvable dans ce qui a été lu',
  'chaine-illisible': 'la chaîne des décisions du compte ne se lit pas',
}

// LES MOTS DES CYCLES (ligne 41, étape R4, phase C) : l'état d'un cycle tel que `cyclesDeLExercice` le déduit, et ce qui
// le retient. La carte du cycle et son panneau disent la même chose du même cycle.
export const ETAT_DU_CYCLE: Readonly<Record<EtatDuCycle, Pastille>> = {
  'en-attente': { mot: 'en attente', classe: 'badge-neutral' },
  'non-commence': { mot: 'non commencé', classe: 'badge-neutral' },
  'en-cours': { mot: 'en cours', classe: 'badge-warning' },
  revise: { mot: 'révisé, à revoir par le chef', classe: 'badge-ok' },
  anomalie: { mot: 'anomalie', classe: 'badge-danger' },
  'a-reprendre': { mot: 'à reprendre', classe: 'badge-warning' },
  revu: { mot: 'revu', classe: 'badge-ok' },
  'revue-perimee': { mot: 'revue périmée', classe: 'badge-warning' },
  'a-revoir': { mot: 'à revoir', classe: 'badge-warning' },
}

export const CAUSES_DU_CYCLE: Readonly<Record<CauseDuCycle, string>> = {
  'soldes-a-justifier': 'un solde de bilan du cycle reste à justifier',
  'soldes-a-revoir': 'la décision d’un solde du cycle est à revoir',
  'soldes-en-anomalie': 'un solde du cycle est signalé en anomalie',
  'soldes-en-attente': 'les soldes du cycle attendent la validation de l’exercice précédent',
  'cycles-ouverts': 'un autre cycle n’est encore ni révisé, ni en anomalie, ni revu',
  'activite-posterieure': 'une décision, une conclusion ou une note a suivi la revue',
  'chaine-illisible': 'la chaîne des conclusions du cycle ne se lit pas',
}

export const PASTILLE_DE_LA_CONCLUSION: Readonly<Record<EtatConclusionRevision, Pastille>> = {
  revise: { mot: 'révisé', classe: 'badge-ok' },
  anomalie: { mot: 'anomalie', classe: 'badge-danger' },
}

export const PASTILLE_DE_LA_REVUE: Readonly<Record<AvisRevueRevision, Pastille>> = {
  approuve: { mot: 'approuvé', classe: 'badge-ok' },
  a_reprendre: { mot: 'à reprendre', classe: 'badge-warning' },
}
