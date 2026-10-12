import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// LE PACK FACE AUX BORNES DE SON SEAU (ligne 22.6). Un pack plus lourd que la borne des packs — le plafond du plan
// gratuit, qu'aucun pack ne dépassait déjà sans échouer — est dit AVANT tout envoi, en français, et ni l'archive ni le
// récapitulatif ne partent : un récapitulatif refusé après l'archive laisserait une archive que rien ne désigne. Un pack
// ordinaire part sous ses deux types, ceux que la migration admet.

const faux = vi.hoisted(() => ({ depots: [] as { seau: string; chemin: string; type: string }[] }))

vi.mock('./supabase', () => {
  const chaine: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'lte', 'or', 'order', 'is']) chaine[m] = () => chaine
  chaine.range = () => chaine
  chaine.then = (resoudre: (v: unknown) => unknown) => Promise.resolve(resoudre({ data: [], error: null, count: 0 }))
  return {
    supabase: {
      from: () => chaine,
      storage: {
        from: (seau: string) => ({
          upload: (chemin: string, corps: Blob) => {
            faux.depots.push({ seau, chemin, type: corps.type })
            return Promise.resolve({ error: null })
          },
        }),
      },
    },
  }
})

const { generatePack } = await import('./packGenerator')

beforeEach(() => { faux.depots = [] })
afterEach(() => { vi.restoreAllMocks() })

/**
 * L'archive du pack, d'un poids annoncé : seul l'appel qui produit un `blob` (celui de generatePack) est remplacé —
 * exceljs se sert de JSZip lui aussi, pour le classeur, et doit garder le vrai.
 */
function archiveDe(taille: number) {
  const vrai = JSZip.prototype.generateAsync
  const archive = new Blob(['zip'], { type: 'application/zip' })
  Object.defineProperty(archive, 'size', { value: taille })
  vi.spyOn(JSZip.prototype, 'generateAsync').mockImplementation(function (this: JSZip, options, ...reste) {
    return options?.type === 'blob' ? Promise.resolve(archive as never) : vrai.call(this, options, ...reste)
  })
}

describe('generatePack — les bornes du seau des packs', () => {
  it('un pack ordinaire part en application/zip, son récapitulatif en classeur Excel', async () => {
    await generatePack('d1', 'Dossier fictif', '2026-01-01', '2026-03-31')
    expect(faux.depots.map((d) => [d.seau, d.type])).toEqual([
      ['packs', 'application/zip'],
      ['packs', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ])
  })

  it('un pack plus lourd que la borne : rien ne part, et le refus dit son poids et la borne', async () => {
    archiveDe(50 * 1024 * 1024 + 1)
    await expect(generatePack('d1', 'Dossier fictif', '2026-01-01', '2026-12-31')).rejects.toThrow(
      'Le pack n’est pas enregistré : il pèse 52 428 801 octets, au-delà des 52 428 800 octets qu’un pack peut peser — choisis une période plus courte.',
    )
    expect(faux.depots).toEqual([])
  })

  it('à la borne, il part', async () => {
    archiveDe(50 * 1024 * 1024)
    await generatePack('d1', 'Dossier fictif', '2026-01-01', '2026-12-31')
    expect(faux.depots).toHaveLength(2)
  })
})
