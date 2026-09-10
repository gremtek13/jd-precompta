export type TypeSupplement = 'creation_societe' | 'fermeture_societe' | 'situation_intermediaire' | 'autre'
export type StatutSupplement = 'a_facturer' | 'facturee'

export interface Supplement {
  id: string
  dossier_id: string
  type: TypeSupplement
  libelle: string
  montant_ht: number | null
  statut: StatutSupplement
  date_demande: string
  facture_id: string | null
  notes: string | null
  created_at: string
}

export const LABEL_TYPE_SUPPLEMENT: Record<TypeSupplement, string> = {
  creation_societe: 'Création de société',
  fermeture_societe: 'Fermeture de société',
  situation_intermediaire: 'Situation comptable intermédiaire',
  autre: 'Autre prestation',
}

export const LABEL_STATUT_SUPPLEMENT: Record<StatutSupplement, string> = {
  a_facturer: 'À facturer',
  facturee: 'Facturée',
}
