import { beforeEach, describe, expect, it, vi } from 'vitest'

// Client Supabase simulé (même motif que controlesReleves.test.ts) : ce module couple une écriture
// de marque (exercices_clotures) à une lecture paginée de `pieces` puis une suppression en masse sur
// `piece_textes_ocr` — trois tables, donc un faux client par table plutôt qu'un faux générique.
const etat = {
  appels: [] as { methode: string; table: string; args?: unknown[] }[],
  clotureExistante: false,
  erreurSelectCloture: null as { message: string } | null,
  erreurInsert: null as { message: string } | null,
  piecesSensibles: [] as { id: string }[],
  // undefined : le compte annoncé vaut la longueur réelle (lecture complète).
  // null : aucun compte annoncé — force une lecture INCOMPLÈTE (tranche courte, pas de count).
  compteAnnonce: undefined as number | null | undefined,
  erreurDelete: null as { message: string } | null,
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'exercices_clotures') {
        return {
          select: () => {
            const chaine: Record<string, unknown> = {}
            Object.assign(chaine, {
              eq: () => chaine,
              maybeSingle: () => Promise.resolve(
                etat.erreurSelectCloture
                  ? { data: null, error: etat.erreurSelectCloture }
                  : { data: etat.clotureExistante ? { id: 'existing' } : null, error: null },
              ),
            })
            return chaine
          },
          insert: (ligne: Record<string, unknown>) => {
            etat.appels.push({ methode: 'insert', table, args: [ligne] })
            return Promise.resolve({ error: etat.erreurInsert })
          },
        }
      }
      if (table === 'pieces') {
        return {
          select: () => {
            const chaine: Record<string, unknown> = {}
            Object.assign(chaine, {
              eq: () => chaine,
              not: () => chaine,
              gte: () => chaine,
              lte: () => chaine,
              order: () => chaine,
              range: () => chaine,
              then: (suite: (r: unknown) => unknown) => Promise.resolve(
                etat.compteAnnonce === null
                  ? { data: etat.piecesSensibles, error: null, count: null }
                  : { data: etat.piecesSensibles, error: null, count: etat.compteAnnonce ?? etat.piecesSensibles.length },
              ).then(suite),
            })
            return chaine
          },
        }
      }
      if (table === 'piece_textes_ocr') {
        return {
          delete: () => ({
            in: (colonne: string, valeurs: string[]) => {
              etat.appels.push({ methode: 'delete', table, args: [colonne, valeurs] })
              return Promise.resolve({ error: etat.erreurDelete })
            },
          }),
        }
      }
      throw new Error(`table non simulée dans ce test : ${table}`)
    },
  },
}))

const { cloturerExercice, estExerciceCloture } = await import('./clotureExercice')

beforeEach(() => {
  etat.appels = []
  etat.clotureExistante = false
  etat.erreurSelectCloture = null
  etat.erreurInsert = null
  etat.piecesSensibles = []
  etat.compteAnnonce = undefined
  etat.erreurDelete = null
})

describe('estExerciceCloture', () => {
  it('rend faux quand rien n\'a été clôturé', async () => {
    expect(await estExerciceCloture('d1', 2025)).toBe(false)
  })

  it('rend vrai quand une clôture existe déjà', async () => {
    etat.clotureExistante = true
    expect(await estExerciceCloture('d1', 2025)).toBe(true)
  })

  it('lève plutôt que de confondre un refus et une absence', async () => {
    etat.erreurSelectCloture = { message: 'permission denied' }
    await expect(estExerciceCloture('d1', 2025)).rejects.toThrow('permission denied')
  })
})

describe('cloturerExercice', () => {
  it('enregistre la clôture puis purge les pièces sensibles de l\'exercice', async () => {
    etat.piecesSensibles = [{ id: 'p1' }, { id: 'p2' }]
    const resultat = await cloturerExercice('d1', 2025)
    expect(resultat).toEqual({ dejaCloture: false, piecesPurgees: 2 })
    expect(etat.appels[0]).toMatchObject({ methode: 'insert', table: 'exercices_clotures', args: [{ dossier_id: 'd1', annee: 2025 }] })
    expect(etat.appels[1]).toMatchObject({ methode: 'delete', table: 'piece_textes_ocr' })
    expect(etat.appels[1].args?.[1]).toEqual(['p1', 'p2'])
  })

  it('n\'insère pas une seconde clôture, mais purge quand même les pièces validées depuis', async () => {
    etat.clotureExistante = true
    etat.piecesSensibles = [{ id: 'p3' }]
    const resultat = await cloturerExercice('d1', 2025)
    expect(resultat).toEqual({ dejaCloture: true, piecesPurgees: 1 })
    expect(etat.appels.some((a) => a.methode === 'insert')).toBe(false)
  })

  it('ne supprime rien quand aucune pièce sensible n\'existe pour cet exercice', async () => {
    const resultat = await cloturerExercice('d1', 2025)
    expect(resultat.piecesPurgees).toBe(0)
    expect(etat.appels.some((a) => a.methode === 'delete')).toBe(false)
  })

  it('refuse de purger sur une lecture incomplète des pièces, plutôt que d\'en oublier', async () => {
    etat.piecesSensibles = [{ id: 'p1' }]
    etat.compteAnnonce = null
    await expect(cloturerExercice('d1', 2025)).rejects.toThrow('incomplète')
    expect(etat.appels.some((a) => a.methode === 'delete')).toBe(false)
  })

  it('propage l\'erreur d\'insertion de la clôture, sans purger', async () => {
    etat.erreurInsert = { message: 'permission denied' }
    await expect(cloturerExercice('d1', 2025)).rejects.toThrow('permission denied')
    expect(etat.appels.some((a) => a.methode === 'delete')).toBe(false)
  })

  it('signale un échec de la purge même si la clôture, elle, a réussi', async () => {
    etat.piecesSensibles = [{ id: 'p1' }]
    etat.erreurDelete = { message: 'permission denied' }
    await expect(cloturerExercice('d1', 2025)).rejects.toThrow('permission denied')
    expect(etat.appels.some((a) => a.methode === 'insert')).toBe(true)
  })
})
