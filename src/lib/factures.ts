import { supabase } from './supabase'
import { anneeDe } from './format'
import type { FactureLigne, TypeFacture } from './types'

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

// Numéro définitif au format F<année>-<numéro sur 4 chiffres> (ex. F2026-0007) pour une facture, ou
// A<année>-<numéro> pour un avoir — deux séries indépendantes (voir la migration factures_avoir), chacune
// gapless séparément, convention la plus répandue dans les logiciels de facturation français plutôt
// qu'un compteur unique partagé. L'année vient de la date d'émission, pas de la date du jour, pour
// qu'un document antidaté en janvier pour décembre dernier reste dans la bonne suite annuelle.
//
// Le format lui-même vit côté base (`numero_facture_formate`) et non ici : `enregistrer_facture`
// doit poser ce même numéro sur la facture à l'intérieur de sa transaction, et deux écritures du
// même format auraient fini par diverger en silence. Cette fonction n'en est plus que l'appel.
export async function attribuerNumeroFacture(dossierId: string, dateEmission: string, type: TypeFacture = 'facture'): Promise<string> {
  const { data, error } = await supabase.rpc('attribuer_numero_facture', {
    p_dossier_id: dossierId, p_annee: anneeDe(dateEmission), p_type: type,
  })
  if (error || data == null) throw new Error(error?.message ?? "Échec de l'attribution du numéro.")
  return data as string
}

export interface LigneAEnregistrer {
  designation: string
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
}

// Enregistre l'en-tête, remplace les lignes et, si demandé, attribue le numéro et valide — le tout
// dans une seule transaction côté base (`enregistrer_facture`). Ces opérations étaient auparavant
// trois à cinq allers-retours indépendants : un échec au milieu laissait la facture à mi-chemin,
// lignes doublées ou numéro consommé sans être posé.
export async function enregistrerFacture(
  dossierId: string,
  factureId: string | null,
  entete: Record<string, unknown>,
  lignes: LigneAEnregistrer[],
  valider: boolean,
): Promise<{ id: string; numero: string | null }> {
  const { data, error } = await supabase.rpc('enregistrer_facture', {
    p_dossier_id: dossierId, p_facture_id: factureId, p_facture: entete, p_lignes: lignes, p_valider: valider,
  })
  if (error) throw new Error(error.message)
  const ligne = (data as { facture_id: string; numero: string | null }[] | null)?.[0]
  if (!ligne) throw new Error("L'enregistrement de la facture n'a rien renvoyé.")
  return { id: ligne.facture_id, numero: ligne.numero }
}

// Représentation triée par ordre d'affichage — les lignes arrivent de Supabase déjà triées par la
// requête (order('ordre')), mais toute fonction qui les reçoit d'ailleurs (ex. un futur export) ne
// doit pas supposer cet ordre déjà garanti.
export function trierLignes<T extends Pick<FactureLigne, 'ordre'>>(lignes: T[]): T[] {
  return [...lignes].sort((a, b) => a.ordre - b.ordre)
}
