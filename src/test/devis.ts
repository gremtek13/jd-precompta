import type { Devis, DevisFacture } from '../lib/types'

// Les devis des tests d'écran (étape P6a1) : un brouillon fictif d'une ligne, et le lien d'un devis à sa facture. Données
// FICTIVES.

export function devis(p: Partial<Devis> = {}): Devis {
  return {
    id: 'dv1', dossier_id: 'd1', numero: null, statut: 'brouillon',
    date_emission: '2026-10-01', date_validite: '2026-11-01', objet: null,
    tiers_nom: 'ALPHA FICTIVE SAS', tiers_adresse: '1 rue Fictive, 75000 Paris', tiers_siret: null, tiers_email: null,
    type_client: null, tiers_siren: null, tiers_adresse_electronique: null, code_service: null, numero_engagement: null,
    nature_operation: null, date_prestation: null, periode_debut: null, periode_fin: null,
    livraison_adresse: null, livraison_code_postal: null, livraison_ville: null, livraison_pays: null,
    lignes: [{ designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }],
    montant_ht: 1000, montant_tva: 200, montant_ttc: 1200,
    conditions: null, mentions_legales: null, notes: null,
    emetteur_nom: null, emetteur_siret: null, emetteur_adresse: null,
    cree_par: 'u-cabinet', cree_le: '2026-10-01T08:00:00Z', emis_par: null, emis_le: null,
    reponse: null, date_reponse: null, decide_par: null, decide_le: null,
    ...p,
  }
}

export function lienDevisFacture(p: Partial<DevisFacture> = {}): DevisFacture {
  return { id: 'df1', dossier_id: 'd1', devis_id: 'dv1', facture_id: 'f1', cree_par: 'u-cabinet', cree_le: '2026-10-20T08:00:00Z', role: 'finale', ...p }
}
