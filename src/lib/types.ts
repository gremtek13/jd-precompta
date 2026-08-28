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
  code_email: string
  assujetti_tva: boolean
}

export interface Categorie {
  id: string
  dossier_id: string | null
  code: string
  libelle: string
  ordre: number
  compte_comptable: string | null
}

export type StatutLigneBancaire = 'non_rapprochee' | 'rapprochee' | 'ignoree'

export interface RegleBancaireIgnoree {
  id: string
  dossier_id: string
  motif: string
  created_at: string
}

export interface LigneBancaire {
  id: string
  dossier_id: string
  date: string
  libelle: string
  montant: number
  statut: StatutLigneBancaire
  piece_id: string | null
  created_at: string
}

export interface TiersCategorie {
  id: string
  dossier_id: string
  tiers_normalise: string
  categorie_id: string
  updated_at: string
}

export interface SousDossier {
  id: string
  dossier_id: string
  nom: string
  ordre: number
  created_at: string
}

export interface Piece {
  id: string
  dossier_id: string
  uploaded_by: string | null
  source: Source
  storage_path: string
  nom_fichier: string
  date_piece: string | null
  tiers: string | null
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
  categorie_id: string | null
  sous_dossier_id: string | null
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

export type SensEcriture = 'debit' | 'credit'
export type StatutEcriture = 'proposee' | 'validee'

// Palier 5 — brouillon comptable : une proposition d'écriture générée à partir d'une pièce validée
// ou d'une ligne bancaire rapprochée. Reste toujours un brouillon (voir le bandeau de l'onglet
// Écritures) — jamais présenté comme une comptabilité tenue, jamais exporté comme définitif.
export interface EcritureBrouillon {
  id: string
  dossier_id: string
  piece_id: string | null
  ligne_bancaire_id: string | null
  date: string
  compte: string
  libelle: string
  montant: number
  sens: SensEcriture
  statut: StatutEcriture
  created_at: string
}

// Palier 5, brique 2 — registre des immobilisations. Une pièce validée dépassant le seuil peut être
// enregistrée ici plutôt que traitée comme une charge courante ; la durée d'amortissement n'est
// qu'une suggestion (linéaire, sans prorata temporis) — l'arbitrage réel reste à l'expert-comptable.
export interface Immobilisation {
  id: string
  dossier_id: string
  piece_id: string | null
  libelle: string
  valeur: number
  date_acquisition: string
  duree_annees: number
  created_at: string
}

export interface Membership {
  id: string
  user_id: string
  dossier_id: string
  role: 'client'
  created_at: string
}
