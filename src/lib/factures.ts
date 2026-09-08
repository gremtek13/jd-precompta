import { supabase } from './supabase'
import type { FactureLigne } from './types'

// Mentions légales par défaut, proposées à la création d'une facture puis librement modifiables avant
// validation — un point de départ raisonnable, pas une garantie de conformité exhaustive : la
// réglementation dépend du statut exact du client (professionnel/particulier, régime de TVA...), à
// ajuster au cas par cas par le cabinet, comme le reste de ce que l'appli propose sans jamais figer.
export function mentionsLegalesParDefaut(assujettiTva: boolean): string {
  const lignes: string[] = []
  if (!assujettiTva) {
    lignes.push('TVA non applicable, art. 293 B du CGI.')
  }
  lignes.push(
    "En cas de retard de paiement, une pénalité égale à trois fois le taux d'intérêt légal sera exigible, " +
    'ainsi qu\'une indemnité forfaitaire pour frais de recouvrement de 40 €.',
  )
  return lignes.join('\n')
}

export interface LigneCalculee {
  montant_ht: number
  montant_tva: number
  montant_ttc: number
}

// Arrondi à 2 décimales systématique — chaque ligne est arrondie avant d'être sommée (comme le ferait
// n'importe quel logiciel de facturation), plutôt que de sommer des valeurs flottantes brutes puis
// arrondir le total : les deux méthodes peuvent différer d'un centime sur certains taux de TVA.
export function calculerLigne(quantite: number, prixUnitaireHt: number, tauxTva: number): LigneCalculee {
  const ht = Math.round(quantite * prixUnitaireHt * 100) / 100
  const tva = Math.round(ht * (tauxTva / 100) * 100) / 100
  return { montant_ht: ht, montant_tva: tva, montant_ttc: Math.round((ht + tva) * 100) / 100 }
}

export function calculerTotaux(lignes: { quantite: number; prix_unitaire_ht: number; taux_tva: number }[]): LigneCalculee {
  return lignes.reduce(
    (acc, l) => {
      const c = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva)
      return { montant_ht: acc.montant_ht + c.montant_ht, montant_tva: acc.montant_tva + c.montant_tva, montant_ttc: acc.montant_ttc + c.montant_ttc }
    },
    { montant_ht: 0, montant_tva: 0, montant_ttc: 0 },
  )
}

// Numéro définitif au format F<année>-<numéro sur 4 chiffres> (ex. F2026-0007) — l'année vient de la
// date d'émission, pas de la date du jour, pour qu'une facture antidatée en janvier pour décembre
// dernier reste dans la bonne suite annuelle.
export async function attribuerNumeroFacture(dossierId: string, dateEmission: string): Promise<string> {
  const annee = new Date(dateEmission).getFullYear()
  const { data, error } = await supabase.rpc('prochain_numero_facture', { p_dossier_id: dossierId, p_annee: annee })
  if (error || data == null) throw new Error(error?.message ?? "Échec de l'attribution du numéro.")
  return `F${annee}-${String(data).padStart(4, '0')}`
}

// Représentation triée par ordre d'affichage — les lignes arrivent de Supabase déjà triées par la
// requête (order('ordre')), mais toute fonction qui les reçoit d'ailleurs (ex. un futur export) ne
// doit pas supposer cet ordre déjà garanti.
export function trierLignes<T extends Pick<FactureLigne, 'ordre'>>(lignes: T[]): T[] {
  return [...lignes].sort((a, b) => a.ordre - b.ordre)
}
