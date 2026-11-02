import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleDesOperationsVues, lireLesOperationsVues, phraseDesSaisiesDuClient, retenirLesOperationsVues, saisiesDuClientNonVues,
} from './caisseDuClientAuCabinet'

// CE QUE LE CLIENT A SAISI DANS SA CAISSE, DIT AU CABINET (ligne 26.6, étape C11). Ce qui se garde : seule l'origine que la
// base a posée dit « par le client » ; la mémoire du navigateur ne retient que les opérations du client, et une mémoire
// manquante, illisible ou un stockage indisponible fait compter TOUT, jamais moins. Projet « logique » : un faux stockage.
const memoire = new Map<string, string>()
const stockage = {
  getItem: (cle: string) => memoire.get(cle) ?? null,
  setItem: (cle: string, valeur: string) => { memoire.set(cle, valeur) },
}
vi.stubGlobal('localStorage', stockage)
afterEach(() => { memoire.clear(); vi.stubGlobal('localStorage', stockage) })

const op = (id: string, origine: 'cabinet' | 'client') => ({ id, origine })

describe('les saisies du client dans sa caisse', () => {
  it('seule l’origine « client » compte ; sans mémoire, toutes', () => {
    const ops = [op('a', 'client'), op('b', 'cabinet'), op('c', 'client')]
    expect(saisiesDuClientNonVues(ops, { etat: 'aucune' }).map((o) => o.id)).toEqual(['a', 'c'])
    expect(saisiesDuClientNonVues(ops, { etat: 'retenues', ids: new Set(['a']) }).map((o) => o.id)).toEqual(['c'])
    expect(saisiesDuClientNonVues(ops, { etat: 'retenues', ids: new Set(['a', 'c']) })).toEqual([])
  })

  it('la mémoire retient les opérations du client, triées, sous la clé du dossier — et se relit', () => {
    retenirLesOperationsVues('d1', [op('c', 'client'), op('b', 'cabinet'), op('a', 'client')])
    expect(memoire.get(cleDesOperationsVues('d1'))).toBe('["a","c"]')
    expect(lireLesOperationsVues('d1')).toEqual({ etat: 'retenues', ids: new Set(['a', 'c']) })
    expect(lireLesOperationsVues('d2')).toEqual({ etat: 'aucune' })
  })

  it('une mémoire illisible, ou un stockage qui lève, vaut « aucune » ; retenir ne lève jamais', () => {
    for (const brute of ['pas du JSON', '{"a":1}', '[1,2]', '["a b"]', `["${'x'.repeat(65)}"]`]) {
      memoire.set(cleDesOperationsVues('d1'), brute)
      expect(lireLesOperationsVues('d1'), brute).toEqual({ etat: 'aucune' })
    }
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceededError') },
    })
    expect(lireLesOperationsVues('d1')).toEqual({ etat: 'aucune' })
    expect(() => retenirLesOperationsVues('d1', [op('a', 'client')])).not.toThrow()
  })

  it('la phrase dit le nombre, d’où vient la mémoire, et que la saisie compte déjà ; rien quand il n’y a rien', () => {
    expect(phraseDesSaisiesDuClient(0, { etat: 'aucune' })).toBeNull()
    expect(phraseDesSaisiesDuClient(1, { etat: 'retenues', ids: new Set() }))
      .toBe('1 opération de caisse saisie par le client depuis ta dernière visite de l’onglet Caisse sur ce navigateur : elle compte déjà, marquée « par le client ».')
    expect(phraseDesSaisiesDuClient(3, { etat: 'aucune' }))
      .toBe('3 opérations de caisse saisies par le client, que ce navigateur ne t’a pas encore montrées dans l’onglet Caisse : elles comptent déjà, marquées « par le client ».')
  })
})
