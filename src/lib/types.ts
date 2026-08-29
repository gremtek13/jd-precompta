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
  poste_2035: string | null
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
  // Rattache le mouvement à une échéance de cotisations_declarees plutôt qu'à une pièce — un
  // prélèvement URSSAF/CARPIMKO n'a pas de facture, juste un montant appelé sur un échéancier.
  // Mutuellement exclusif avec piece_id (contrainte en base).
  cotisation_id: string | null
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
  // Empreinte SHA-256 du contenu du fichier — sert à détecter un doublon à l'import (voir
  // ImportDossierModal). Nul pour les pièces créées avant l'introduction de ce champ.
  storage_hash: string | null
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

// Nature d'un bien immobilisé (téléphone, véhicule, mobilier...) — sert uniquement à suggérer une
// durée d'amortissement usuelle à l'enregistrement d'une immobilisation ; les catégories de dépense
// (Achats fournisseurs, Autre...) ne s'y prêtent pas, un téléphone et une voiture tombant souvent dans
// la même catégorie de dépense alors qu'ils n'ont pas la même durée d'usage. dossier_id null = règle
// partagée par tous les dossiers, sinon spécifique à un dossier.
export interface NatureImmobilisation {
  id: string
  dossier_id: string | null
  libelle: string
  duree_annees_defaut: number
  ordre: number
}

// Palier 5, brique 2 — registre des immobilisations. Une pièce validée dépassant le seuil peut être
// enregistrée ici plutôt que traitée comme une charge courante ; la durée d'amortissement n'est
// qu'une suggestion (linéaire, sans prorata temporis) — l'arbitrage réel reste à l'expert-comptable.
export interface Immobilisation {
  id: string
  dossier_id: string
  piece_id: string | null
  nature_id: string | null
  libelle: string
  valeur: number
  date_acquisition: string
  duree_annees: number
  created_at: string
}

// Palier 5, brique 4 — suivi des cotisations sociales URSSAF. Le montant_csg_crds est saisi
// séparément du montant total appelé car un appel URSSAF cumule plusieurs cotisations (maladie,
// retraite, CSG-CRDS...) — seule la part CSG-CRDS visible sur le décompte peut être ventilée
// déductible/non déductible, jamais le montant appelé dans son ensemble.
export interface CotisationDeclaree {
  id: string
  dossier_id: string
  echeance: string
  montant_appele: number
  montant_verse: number | null
  montant_csg_crds: number | null
  created_at: string
}

// Détail par poste (Achats, Loyer, Assurance...) d'un repère annuel — complète le CA et les
// cotisations sociales de ReferenceAnnuelle par les "autres charges", pour comparer une année sur
// l'autre poste par poste plutôt qu'en un seul total. Indépendant de ReferenceAnnuelle (pas besoin
// que celle-ci existe pour ce faire) : calculé automatiquement en réutilisant le regroupement par
// poste_2035 déjà utilisé dans l'onglet Clôture si l'année est dans ce dossier, ou saisi à la main
// (poste libre, pas de liste imposée) sinon.
export interface ReferencePosteAnnuel {
  id: string
  dossier_id: string
  annee: number
  poste: string
  montant: number
  created_at: string
}

export type SourceReference = 'calculee' | 'saisie_manuelle'

// Repère annuel (CA + total cotisations sociales) utilisé pour l'estimation des charges de l'année en
// cours. "calculee" quand l'année est entièrement dans l'appli (sommée automatiquement depuis les
// pièces/cotisations de ce dossier) ; "saisie_manuelle" quand le cabinet transcrit les chiffres de la
// 2035 réellement déposée par le client, faute d'historique applicatif pour cette année-là.
export interface ReferenceAnnuelle {
  id: string
  dossier_id: string
  annee: number
  chiffre_affaires: number | null
  total_cotisations_sociales: number | null
  // Bénéfice/résultat net déjà officiellement déclaré sur une 2035 réelle — jamais calculé par
  // l'appli (ce serait précisément le calcul qu'on refuse de faire ailleurs), uniquement transcrit à
  // la main ou lu depuis le document. "calculee" ne le renseigne jamais.
  resultat_net: number | null
  source: SourceReference
  notes: string | null
  created_at: string
}

export type CategorieDocument = 'releve_bancaire' | 'cotisation' | 'attestation' | 'autre'

// Archive des documents qui ne sont ni des pièces d'achat/vente (pas de HT/TVA/TTC à extraire) ni des
// lignes bancaires : relevés de compte, attestations d'assurance/fiscales, appels de cotisation avant
// rattachement à une échéance. Classés automatiquement à l'import en masse (voir la classification
// côté extract-piece), reclassables à la main depuis l'onglet Documents.
export interface DocumentDivers {
  id: string
  dossier_id: string
  sous_dossier_id: string | null
  storage_path: string
  storage_hash: string | null
  nom_fichier: string
  categorie: CategorieDocument
  // Rattaché à une échéance de cotisations_declarees une fois pointé depuis l'onglet Cotisations —
  // reste dans cette table (pas déplacé) pour que le rattachement soit réversible.
  attached_to_cotisation_id: string | null
  notes: string | null
  created_at: string
}

export interface Membership {
  id: string
  user_id: string
  dossier_id: string
  role: 'client'
  created_at: string
}
