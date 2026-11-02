import type { ANouveau, EcritureBrouillon } from '../lib/types'

// Ce qu'une écriture ne porte qu'une fois son exercice validé (ligne 26.6, étape d) : tout est nul sur une
// écriture proposée, et la base l'exige (`ecritures_brouillon_validation_complete`). Un jeu d'essai étale ces
// champs plutôt que de les recopier : une colonne de validation ajoutée demain ne se reprend qu'ici, et le type
// refuse ce fichier tant qu'elle n'y est pas. Les quatre champs du FEC d'un BNC (lot FEC22b, en base depuis le
// 02/11/2026) en sont : nuls sur une écriture proposée (`ecritures_brouillon_champs_bnc_du_fec`).
export const NON_VALIDEE = {
  valide_le: null,
  journal_code: null,
  numero_ecriture: null,
  piece_ref: null,
  piece_date: null,
  compte_lib: null,
  comp_aux_num: null,
  comp_aux_lib: null,
  date_reglement: null,
  mode_reglement: null,
  nature_operation: null,
  poste_rattache: null,
  identification_client: null,
} satisfies Pick<
  EcritureBrouillon,
  | 'valide_le' | 'journal_code' | 'numero_ecriture' | 'piece_ref' | 'piece_date' | 'compte_lib' | 'comp_aux_num' | 'comp_aux_lib'
  | 'date_reglement' | 'mode_reglement' | 'nature_operation' | 'poste_rattache' | 'identification_client'
>

// De même pour un à-nouveau : le libellé de son compte et celui de son écriture ne sont posés qu'à la validation
// de l'exercice qu'il ouvre (`a_nouveaux_validation_complete`).
export const A_NOUVEAU_NON_VALIDE = {
  compte_lib: null,
  ecriture_lib: null,
} satisfies Pick<ANouveau, 'compte_lib' | 'ecriture_lib'>
