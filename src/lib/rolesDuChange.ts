import type { DefinitionRoleComptable } from './planComptable'

// LES DEUX RÔLES DU CHANGE ET LE DRAPEAU DE LEUR MIGRATION (ligne 31, 31-changeFrais ; 12/11/2026).
//
// En ENGAGEMENT, le règlement d'une facture solde le compte de tiers au montant de la facture, et l'écart avec la banque
// s'écrit À PART (décision du cabinet du 18/10/2026, « à part (666, 766, 627) ») : le frais bancaire au 627
// (`services_bancaires`, au catalogue depuis VF2), la perte ou le gain de change sur ces deux rôles, que la migration
// `ecarts_de_reglement` (supabase/preparees/) ajoute au catalogue, aux rangs 340 et 350 (le 330 est au `personnel` de B7).
//
// LEUR COMPTE PAR DÉFAUT EST CELUI DU PCG POUR UNE CRÉANCE OU UNE DETTE COMMERCIALE, ET C'EST UNE QUESTION (CHG-Q1) : le
// règlement ANC n° 2015-05 (exercices ouverts depuis le 1er janvier 2017) a complété l'article 946-65 du PCG — « Les pertes
// de change sur créances et dettes commerciales sont enregistrées au débit du compte 656 » —, le gain au 756, et réservé le
// 666 et le 766 aux opérations financières. Un règlement de facture est commercial : 656000 et 756000 par défaut, le 666 et
// le 766 parmi leurs racines, qu'un dossier peut choisir dans son plan si le cabinet maintient sa réponse du 18/10/2026.
//
// LE DRAPEAU BAISSÉ, RIEN NE CHANGE, À L'OCTET PRÈS : la lecture du plan ignore ces deux rôles (`planDeLaReponse`, comme
// le `personnel` de B7), la composition d'un règlement est celle d'hier, et le rapprochement règle encore la pièce sur la
// banque. Il ne se lève qu'APRÈS la migration : levé avant, chaque plan lu serait incomplet et aucun onglet ne se
// monterait. La trésorerie (BNC, 2035) ne lit ni ces rôles ni ce drapeau.
export const ECARTS_DE_REGLEMENT_PREVUS = false

export const ROLES_DU_CHANGE = [
  { role: 'pertes_de_change', racines: ['656', '666'], compteDefaut: '656000', libelleDefaut: 'Pertes de change sur créances et dettes commerciales', prefixeAuxiliaireDefaut: null, ordre: 340 },
  { role: 'gains_de_change', racines: ['756', '766'], compteDefaut: '756000', libelleDefaut: 'Gains de change sur créances et dettes commerciales', prefixeAuxiliaireDefaut: null, ordre: 350 },
] as const satisfies readonly DefinitionRoleComptable[]

export type CleRoleDuChange = (typeof ROLES_DU_CHANGE)[number]['role']
