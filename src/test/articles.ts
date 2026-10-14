import type { Article } from '../lib/types'

// Un article FICTIF, typé sans `as` : le compilateur confronte chaque champ à la table (CLAUDE.md, « Tests »). Les tests de
// la liste des articles (étape A2a) l'utilisent tous ; aucune donnée réelle.
export function article(o: Partial<Article> = {}): Article {
  return {
    id: 'a1', dossier_id: 'd1', reference: 'CONS-01', designation: 'Consultation de conseil', description: null,
    unite: 'HUR', prix_unitaire_ht: 60, taux_tva: 20, nature: 'services',
    retire_le: null, retire_par: null, cree_par: 'u-cabinet', cree_le: '2027-10-01T09:00:00Z', modifie_par: null, modifie_le: null,
    ...o,
  }
}
