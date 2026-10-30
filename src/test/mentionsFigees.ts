import type { IdentiteDuDossier } from '../lib/mentionsFigeesVue'
import type { FactureEmise } from '../lib/types'
import { MENTIONS_VIDES } from './factures'
import { SIRET_VENDEUR, TVA_VENDEUR } from './facturesCii'

// LA FACTURE QUI FIGE SES MENTIONS (étape A7b) : des jeux d'essai FICTIFS, typés sans `as` (CLAUDE.md, « Tests »). L'IBAN est
// celui des essais du dépôt (le code banque 99999, à clé juste) ; le SIRET celui des factures électroniques d'essai. Aucune
// donnée réelle.
export const IBAN_ESSAI = 'FR7699999000010000000000600'
export const BIC_ESSAI = 'ESSAFR10'
// Un second IBAN fictif à clé juste, celui d'un RIB changé après la validation.
export const AUTRE_IBAN_ESSAI = 'FR6099999000010000000000500'

/** L'identité d'un dossier d'entrepreneur individuel, telle que la validation la lit : réglée par le cabinet. */
export function identiteDuDossier(o: Partial<IdentiteDuDossier> = {}): IdentiteDuDossier {
  return {
    siret: SIRET_VENDEUR, adresse: '1 rue des Essais\n69000 Lyon', statut_tva: 'redevable', article_exoneration: null,
    numero_tva_attribue: false, denomination_imprimee: 'Camille Essai EI', forme_juridique: '1000', capital: null, rcs_ville: null,
    mentions_identite: null,
    ...o,
  }
}

/** Une facture validée qui a FIGÉ ses mentions — ce qu'`enregistrer_facture` écrit à sa validation. */
export function factureFigee(o: Partial<FactureEmise> = {}): FactureEmise {
  return {
    id: 'f1', dossier_id: 'd1', numero: 'F2027-0001', statut: 'validee', type: 'facture', facture_origine_id: null,
    date_emission: '2027-11-02', date_echeance: '2027-12-02', tiers_nom: 'Client Fictif SAS', tiers_adresse: '2 rue fictive',
    tiers_siret: null, montant_ht: 100, montant_tva: 20, montant_ttc: 120, mentions_legales: null, notes: null,
    emetteur_nom: 'Nom interne du dossier', emetteur_siret: SIRET_VENDEUR, emetteur_adresse: '1 rue des Essais\n69000 Lyon',
    superpdp_invoice_id: null, superpdp_dernier_statut: null, tiers_email: null, created_by: null, valide_par: 'u-moi',
    created_at: '2027-11-02T08:00:00Z', validated_at: '2027-11-02T08:05:00Z', ...MENTIONS_VIDES, type_client: 'assujetti',
    option_debits: false, source_de_la_vente: false,
    mentions_figees: true, statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false,
    numero_tva_imprime: TVA_VENDEUR, denomination_imprimee: 'Camille Essai EI', forme_juridique: '1000', capital: null,
    rcs_ville: null, mentions_identite: null, parametres_id: 'v1', moyen_prefere: 'virement',
    escompte: 'Pas d’escompte pour paiement anticipé.', penalites: 'Pénalités de retard : trois fois le taux d’intérêt légal.',
    mentions_complementaires: 'Membre d’une association agréée.', pied_de_page: 'Camille Essai EI — merci de votre confiance',
    logo_chemin: null, logo_sha256: null, iban_imprime: IBAN_ESSAI, bic_imprime: BIC_ESSAI, titulaire_imprime: 'CAMILLE ESSAI',
    rib_parametres_id: 'v1', mandataire_nom: null, contact_id: null,
    ...o,
  }
}
