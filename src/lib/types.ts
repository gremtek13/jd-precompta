export type Statut = 'a_valider' | 'validee'
export type TypePiece = 'achat' | 'vente' | 'note_frais' | 'autre'
export type Source = 'upload' | 'email'

export interface Dossier {
  id: string
  nom: string
  siret: string | null
  contact_nom: string | null
  contact_email: string | null
  notes: string | null
  archive: boolean
  created_at: string
}

export interface Categorie {
  id: string
  dossier_id: string | null
  code: string
  libelle: string
  ordre: number
}

export interface Piece {
  id: string
  dossier_id: string
  uploaded_by: string
  source: Source
  storage_path: string
  nom_fichier: string
  date_piece: string | null
  tiers: string | null
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
  categorie_id: string | null
  type_piece: TypePiece
  statut: Statut
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Pack {
  id: string
  dossier_id: string
  periode_debut: string
  periode_fin: string
  generated_at: string
  generated_by: string
  storage_path_zip: string
  storage_path_excel: string
  nb_pieces: number
  total_ttc: number | null
}

export interface Membership {
  id: string
  user_id: string
  dossier_id: string
  role: 'client'
  created_at: string
}
