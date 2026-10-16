import type { ParametresFacturation } from '../lib/types'

// Une version des paramètres de facturation FICTIVE, typée sans `as` : le compilateur confronte chaque champ à la table
// (CLAUDE.md, « Tests »), et parametresFacturation.test.ts confronte l'ordre de ses clés aux colonnes que l'essai attend.
// Ses IBAN sont ceux des essais du dépôt (le code banque 99999, à clé juste) ; aucune donnée réelle.
export function versionParametres(o: Partial<ParametresFacturation> = {}): ParametresFacturation {
  return {
    id: 'v1', dossier_id: 'd1', delai_paiement_jours: 30, moyen_prefere: 'virement', escompte: null, penalites: null,
    mentions_complementaires: null, pied_de_page: null, iban: null, bic: null, titulaire_compte: null, rib_etat: null,
    rib_confirme_par: null, rib_confirme_le: null, remplace_id: null, auteur: 'u-cabinet', cree_le: '2027-10-01T09:00:00Z',
    ...o,
  }
}
