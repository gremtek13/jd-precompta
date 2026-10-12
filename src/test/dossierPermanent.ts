import type { EntreeDossierPermanent } from '../lib/types'

// Les entrées FICTIVES du dossier permanent, pour les tests d'écran (ligne 41, étape R7, phase C). Les identifiants de pièce
// et de document ont la forme d'un uuid : la base (et `lireLaCitation`) refuse une citation d'une autre forme.
export const DOSSIER_PERMANENT = 'aaaaaaaa-0000-4000-8000-0000000000a1'
export const PIECE_BAIL = 'bbbbbbbb-0000-4000-8000-0000000000b1'
export const PIECE_LIBRE = 'bbbbbbbb-0000-4000-8000-0000000000b2'
export const DOCUMENT_STATUTS = 'cccccccc-0000-4000-8000-0000000000c1'
export const HASH_DE_LA_CITATION = 'a'.repeat(64)

export const idDEntree = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`

export function entreePermanente(o: Partial<EntreeDossierPermanent> = {}): EntreeDossierPermanent {
  return {
    id: idDEntree(1), dossier_id: DOSSIER_PERMANENT, nature: 'lettre_mission', titre: 'Lettre de mission', texte: 'Présentation des comptes.',
    piece_id: null, document_id: null, fichier_id: null, empreinte: null, valable_du: '2026-01-01', valable_jusqu_au: null,
    remplace_id: null, auteur: 'u1', cree_le: '2026-01-05T10:00:00+00:00', retire_le: null, retire_par: null, ...o,
  }
}
