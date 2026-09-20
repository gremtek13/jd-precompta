import { describe, expect, it } from 'vitest'
import { lireTout } from './lectureComplete'

// Faux serveur paginé. `plafond` est le nombre maximum de lignes qu'il accepte de rendre en une
// requête, quoi qu'on lui demande — c'est le « Max rows » de PostgREST, et c'est lui qui rend ce
// module nécessaire.
function serveur(total: number, plafond: number, options: { annonce?: boolean; echecA?: number } = {}) {
  const lignes = Array.from({ length: total }, (_, i) => ({ id: i }))
  const appels: [number, number][] = []
  return {
    appels,
    tranche(debut: number, fin: number) {
      appels.push([debut, fin])
      if (options.echecA != null && appels.length > options.echecA) {
        return Promise.resolve({ data: null, error: { message: 'connexion perdue' }, count: null })
      }
      const taille = Math.min(fin - debut + 1, plafond)
      return Promise.resolve({
        data: lignes.slice(debut, debut + taille),
        error: null,
        count: options.annonce === false ? null : total,
      })
    },
  }
}

describe('lireTout — une collection entière, et la preuve qu’elle l’est', () => {
  it('rend tout en une tranche quand la table tient dedans', async () => {
    const s = serveur(120, 500)
    const { lignes, complete, motif } = await lireTout(s.tranche, 500)
    expect(lignes).toHaveLength(120)
    expect(complete).toBe(true)
    expect(motif).toBeNull()
  })

  it('recolle les tranches successives', async () => {
    const s = serveur(1200, 500)
    const { lignes, complete } = await lireTout(s.tranche, 500)
    expect(lignes).toHaveLength(1200)
    expect(lignes[1199]).toEqual({ id: 1199 })
    expect(complete).toBe(true)
  })

  it('continue quand le PLAFOND du serveur est plus petit que la tranche demandée', async () => {
    // Le cas que le socle de sauvegarde ne sait pas traiter : il s'arrête sur une tranche courte,
    // puis refuse. Ici il faut continuer — une tranche courte ne prouve pas la fin de la table.
    const s = serveur(900, 300)
    const { lignes, complete } = await lireTout(s.tranche, 500)
    expect(lignes).toHaveLength(900)
    expect(complete).toBe(true)
    // On avance de ce qui a été RENDU : 0, 300, 600 — et pas une requête de plus, le compte
    // annoncé disant que le compte y est. Une tranche vide de confirmation serait un aller-retour
    // payé pour rien.
    expect(s.appels.map(([debut]) => debut)).toEqual([0, 300, 600])
  })

  it('dit incomplet quand le serveur s’arrête avant le total annoncé', async () => {
    // Le serveur annonce 900 et n'en rend que 300, puis plus rien. La liste n'est pas fausse, elle
    // est PARTIELLE — et c'est la seule chose qu'un appelant doive savoir.
    const lignes900 = Array.from({ length: 300 }, (_, i) => ({ id: i }))
    let appel = 0
    const { lignes, complete, motif } = await lireTout<{ id: number }>(() => {
      appel++
      return Promise.resolve({ data: appel === 1 ? lignes900 : [], error: null, count: 900 })
    }, 500)
    expect(lignes).toHaveLength(300)
    expect(complete).toBe(false)
    expect(motif).toContain('300 ligne(s) lue(s) sur 900')
  })

  it('dit incomplet quand la base n’annonce aucun total', async () => {
    // Sans compte annoncé, « il n'y a rien de plus » et « le serveur ne rend plus rien » sont
    // indiscernables : on ne peut donc pas se dire complet.
    const s = serveur(120, 500, { annonce: false })
    const { lignes, complete, motif } = await lireTout(s.tranche, 500)
    expect(lignes).toHaveLength(120)
    expect(complete).toBe(false)
    expect(motif).toContain("n'a pas annoncé de total")
  })

  it('rend ce qui a été lu, et le motif, quand une tranche échoue', async () => {
    const s = serveur(1200, 500, { echecA: 1 })
    const { lignes, complete, motif } = await lireTout(s.tranche, 500)
    expect(lignes).toHaveLength(500)
    expect(complete).toBe(false)
    expect(motif).toContain('connexion perdue')
    expect(motif).toContain('500 ligne(s)')
  })

  it('ne boucle pas indéfiniment sur un total annoncé trop grand', async () => {
    // Un compte annoncé plus grand que ce que le serveur rendra jamais : sans l'arrêt sur tranche
    // vide, la boucle ne se terminerait pas. Le test vaut autant par son verdict que par le fait
    // qu'il rende la main.
    const s = serveur(10, 500)
    const { lignes, complete } = await lireTout(
      (debut, fin) => s.tranche(debut, fin).then((r) => ({ ...r, count: 10_000 })),
      500,
    )
    expect(lignes).toHaveLength(10)
    expect(complete).toBe(false)
  })
})
