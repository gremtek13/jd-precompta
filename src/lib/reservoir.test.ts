import { describe, expect, it } from 'vitest'
import { creerReservoir } from './reservoir'

// LE RÉSERVOIR DES DÉPÔTS (relecture du 04/11/2026, D6 ; PIECES-Q4).

/** Une tâche que le test libère à la main : ce qui laisse voir qui attend, et dans quel ordre on passe. */
function tacheTenue<T>(valeur: T) {
  let liberer: () => void = () => {}
  let echouer: (e: unknown) => void = () => {}
  const fin = new Promise<T>((resoudre, rejeter) => {
    liberer = () => resoudre(valeur)
    echouer = rejeter
  })
  return { tache: () => fin, liberer, echouer }
}

const tour = () => new Promise((r) => setTimeout(r, 0))

describe('creerReservoir', () => {
  it('n’en lance que trois à la fois, puis la suivante dès qu’une place se libère, dans l’ordre d’arrivée', async () => {
    const reservoir = creerReservoir(3)
    const demarrees: number[] = []
    const tenues = Array.from({ length: 5 }, (_, i) => tacheTenue(i))
    const rendus = tenues.map((t, i) => reservoir.executer(() => { demarrees.push(i); return t.tache() }))
    await tour()
    expect(demarrees).toEqual([0, 1, 2])
    expect([reservoir.enCours, reservoir.enAttente]).toEqual([3, 2])
    tenues[1].liberer()
    await tour()
    expect(demarrees).toEqual([0, 1, 2, 3])
    expect([reservoir.enCours, reservoir.enAttente]).toEqual([3, 1])
    for (const t of tenues) t.liberer()
    expect(await Promise.all(rendus)).toEqual([0, 1, 2, 3, 4])
    expect([reservoir.enCours, reservoir.enAttente]).toEqual([0, 0])
  })

  it('une tâche qui lève libère sa place, et son erreur revient à qui l’a confiée', async () => {
    const reservoir = creerReservoir(1)
    const a = tacheTenue('a')
    const premiere = reservoir.executer(a.tache)
    const seconde = reservoir.executer(async () => 'b')
    a.echouer(new Error('quota'))
    await expect(premiere).rejects.toThrow('quota')
    await expect(seconde).resolves.toBe('b')
    expect(reservoir.enCours).toBe(0)
  })

  it('une place libérée passe à la tâche qui attend, jamais à une arrivée tardive', async () => {
    const reservoir = creerReservoir(1)
    const ordre: string[] = []
    const a = tacheTenue(null)
    const pa = reservoir.executer(() => { ordre.push('a'); return a.tache() })
    const pb = reservoir.executer(async () => { ordre.push('b') })
    a.liberer()
    // Arrivée pendant que la place passe de « a » à « b » : elle attend son tour.
    const pc = reservoir.executer(async () => { ordre.push('c') })
    await Promise.all([pa, pb, pc])
    expect(ordre).toEqual(['a', 'b', 'c'])
  })

  it('refuse une capacité qui n’en est pas une', () => {
    expect(() => creerReservoir(0)).toThrow()
    expect(() => creerReservoir(1.5)).toThrow()
  })
})
