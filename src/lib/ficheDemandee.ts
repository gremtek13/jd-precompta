// LA FICHE QU'UN AUTRE ONGLET DEMANDE D'OUVRIR (BOR6T-Q2 (A), 27/11/2026) : la Vue d'ensemble nomme une pièce ou un document
// par sa date de dépôt et renvoie à SA fiche, dans Justificatifs ou Documents administratifs. La page du dossier garde la
// demande (elle reste montée d'un onglet à l'autre) ; l'onglet visé l'ouvre une fois sa liste lue, puis la rend — une seule
// fois. Elle porte le dossier : un onglet d'un autre dossier ne l'ouvre jamais.

export interface FicheDemandee {
  readonly dossierId: string
  readonly type: 'piece' | 'document'
  readonly id: string
}

/** La demande, si elle vise cet onglet et ce dossier ; nulle sinon. */
export function demandePour(demande: FicheDemandee | null | undefined, dossierId: string, type: FicheDemandee['type']): FicheDemandee | null {
  return demande && demande.dossierId === dossierId && demande.type === type ? demande : null
}

/** Ce que l'onglet dit d'une fiche demandée qu'il ne trouve pas dans sa liste lue (partie depuis, ou liste lue en partie). */
export const FICHE_DEMANDEE_INTROUVABLE = {
  piece: 'La pièce signalée par la Vue d’ensemble n’est pas dans la liste lue : elle a peut-être déjà été supprimée.',
  document: 'Le document signalé par la Vue d’ensemble n’est pas dans la liste lue : il a peut-être déjà été supprimé.',
} as const
