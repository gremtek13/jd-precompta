import type { DonneesHorsDeFrance } from '../pages/dossier/FicheHorsDeFrance'

// CE QUE LA FICHE D'UNE PIÈCE REÇOIT DE L'E-REPORTING (étape e5c) : les pièces écartées et les déclarations du dossier, lues
// en entier, et vides. Les tests qui montent la fiche sans regarder l'e-reporting n'ont besoin que de cela ; ceux qui le
// regardent (FicheHorsDeFrance.ecart.test.tsx, FichePiece.declaree.test.tsx) posent leurs lignes.
export const ECARTS_ET_DECLARATIONS_VIDES: Pick<DonneesHorsDeFrance, 'ecarts' | 'relireEcarts' | 'declarations'> = {
  ecarts: { lignes: [], complete: true, motif: null },
  relireEcarts: async () => {},
  declarations: {
    declarations: { lignes: [], complete: true, motif: null },
    sources: { lignes: [], complete: true, motif: null },
    motif: null,
  },
}
