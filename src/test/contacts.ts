import type { Contact } from '../lib/types'

// Un contact FICTIF, typé sans `as` : le compilateur confronte chaque champ à la table (CLAUDE.md, « Tests »). Ses
// identifiants sont ceux des essais du dépôt (123456782, son établissement 12345678200010) ; aucune donnée réelle.
export function contact(o: Partial<Contact> = {}): Contact {
  return {
    id: 'c1', dossier_id: 'd1', genre: 'client', type_client: 'assujetti', nom: 'Société Essai', adresse: 'Adresse fictive',
    siren: '123456782', siret: '12345678200010', adresse_electronique: null, code_service: null, email: null,
    delai_paiement_jours: 30, observations: null, retire_le: null, retire_par: null, efface_le: null, efface_par: null,
    cree_par: 'u-cabinet', cree_le: '2027-10-01T09:00:00Z', modifie_par: null, modifie_le: null,
    ...o,
  }
}
