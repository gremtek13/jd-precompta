import { describe, expect, it } from 'vitest'
import { filtrer, predicatEq, predicatNot, predicatOr } from './filtresPostgrest'

// Le module qui rend les faux clients fidèles se teste lui-même : un faux qui filtre de travers ferait
// passer un écran pour juste, ou pour faux, sans que rien ne le dise.
const LIGNES = [
  { id: 'a', dossier_id: 'd1', piece_id: 'p1', categorie_id: null },
  { id: 'b', dossier_id: 'd1', piece_id: null, categorie_id: 'c1' },
  { id: 'c', dossier_id: null, piece_id: null, categorie_id: null },
  { id: 'd', dossier_id: 'd2', piece_id: 'p2', categorie_id: null },
  { id: 'e' },
]
const ids = (lignes: { id: string }[]) => lignes.map((l) => l.id)

describe('filtres PostgREST d’un faux client', () => {
  it('.not(colonne, is, null) garde les lignes dont la colonne est renseignée — une colonne absente vaut NULL', () => {
    expect(ids(filtrer(LIGNES, [predicatNot('piece_id', 'is', null)]))).toEqual(['a', 'd'])
  })

  it('.or(dossier.eq, dossier.is.null) garde le dossier ET ce qui est partagé', () => {
    expect(ids(filtrer(LIGNES, [predicatOr('dossier_id.eq.d1,dossier_id.is.null')]))).toEqual(['a', 'b', 'c', 'e'])
  })

  it('.eq ne garde que la valeur demandée — ce qui est partagé n’en fait pas partie', () => {
    expect(ids(filtrer(LIGNES, [predicatEq('dossier_id', 'd1')]))).toEqual(['a', 'b'])
  })

  it('les prédicats s’enchaînent comme les filtres d’une requête', () => {
    expect(ids(filtrer(LIGNES, [predicatEq('dossier_id', 'd1'), predicatNot('piece_id', 'is', null)]))).toEqual(['a'])
  })

  it('une forme non modélisée LÈVE au lieu d’être ignorée', () => {
    expect(() => predicatNot('piece_id', 'eq', 'p1')).toThrow(/n'est pas modélisé/)
    expect(() => predicatNot('piece_id', 'is', 'true')).toThrow(/n'est pas modélisé/)
    expect(() => predicatOr('montant.gt.10')).toThrow(/n'est pas modélisé/)
    expect(() => predicatOr('dossier_id.is.true')).toThrow(/n'est pas modélisé/)
  })
})
