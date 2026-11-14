import type { ContactNomme } from '../lib/fichesLiees'
import type { Contact } from '../lib/types'

// Un contact FICTIF, typé sans `as` : le compilateur confronte chaque champ à la table (CLAUDE.md, « Tests »). Ses
// identifiants sont ceux des essais du dépôt (123456782, son établissement 12345678200010) ; aucune donnée réelle.
export function contact(o: Partial<ContactNomme> = {}): ContactNomme {
  return {
    id: 'c1', dossier_id: 'd1', genre: 'client', type_client: 'assujetti', nom: 'Société Essai', adresse: 'Adresse fictive',
    siren: '123456782', siret: '12345678200010', adresse_electronique: null, code_service: null, email: null,
    delai_paiement_jours: 30, observations: null, retire_le: null, retire_par: null, efface_le: null, efface_par: null,
    cree_par: 'u-cabinet', cree_le: '2027-10-01T09:00:00Z', modifie_par: null, modifie_le: null,
    // Les trois colonnes de LM3, à la fin de la table comme la migration les ajoute.
    dossier_client_id: null, delie_le: null, delie_par: null,
    ...o,
  }
}

// Une fiche LIÉE au dossier d'un client (LM3), telle que la base la rend : ni nom ni identité (`contacts_fiche_liee_sans_identite`),
// le dossier qu'elle désigne en `dossier_client_id`. Typée `Contact` sans `as` : le nom nul n'y est permis que parce que la table
// le permet.
export function ficheLiee(o: Partial<Contact> = {}): Contact {
  return {
    ...contact(), id: 'f1', nom: null, type_client: null, adresse: null, siren: null, siret: null, code_service: null,
    dossier_client_id: 'dossier-client-fictif', ...o,
  }
}
