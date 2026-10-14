import type { AdresseReception } from '../lib/types'

// Une adresse de réception FICTIVE, typée sans `as` : le compilateur confronte chaque champ à la table (CLAUDE.md, « Tests »).
// Les tests de la lecture, de l'écriture et de la fenêtre de l'adresse (étape A6b1) l'utilisent tous ; aucune donnée réelle.
// Le SIREN fictif est celui du SIRET fictif `SIRET_FICTIF`.
export const SIREN_FICTIF = '123456782'
export const SIRET_FICTIF = '12345678200010'

export function adresse(o: Partial<AdresseReception> = {}): AdresseReception {
  return {
    id: 'a1', dossier_id: 'd1', forme: 'siren', identifiant: SIREN_FICTIF, plateforme: 'Plateforme fictive', prise_effet: '2026-09-01',
    verification: 'declaration', verifiee_le: null, remplace_id: null, auteur: 'u-cabinet', cree_le: '2026-10-14T08:00:00Z',
    ...o,
  }
}
