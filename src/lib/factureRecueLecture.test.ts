import { afterEach, describe, expect, it, vi } from 'vitest'
import { lireLOriginalRecu } from './factureRecueLecture'
import { MOTIF_CHEMIN_HORS_DU_DOSSIER } from './cheminDuDossier'

// Ce que « Lire la facture électronique » lit (B4R-Q1) : le chemin vérifié AVANT tout téléchargement aux droits du cabinet
// (CFCS-Q1), l'original et le SIRET du dossier ; rien ne rejette, un refus ou une erreur tombent du côté refusé.

const faux = vi.hoisted(() => ({
  telechargements: [] as string[],
  fichier: { data: new Blob(['<facture/>']) as Blob | null, error: null as unknown },
  dossier: { data: { id: 'd1', siret: '98765432100017' } as unknown, error: null as unknown },
  leve: false,
}))

vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: (seau: string) => ({
        download: (chemin: string) => {
          faux.telechargements.push(`${seau}:${chemin}`)
          if (faux.leve) throw new Error('réseau coupé')
          return Promise.resolve(faux.fichier)
        },
      }),
    },
    from: (table: string) => {
      if (table !== 'dossiers') throw new Error(`Table non attendue : ${table}`)
      const r = { select: () => r, eq: () => r, maybeSingle: () => Promise.resolve(faux.dossier) }
      return r
    },
  },
}))

afterEach(() => {
  faux.telechargements = []; faux.leve = false
  faux.fichier = { data: new Blob(['<facture/>']), error: null }
  faux.dossier = { data: { id: 'd1', siret: '98765432100017' }, error: null }
})

describe('lireLOriginalRecu', () => {
  it('rend l’original et le SIREN du dossier', async () => {
    const lu = await lireLOriginalRecu('d1', 'd1/1-facture.xml')
    expect('octets' in lu && [new TextDecoder().decode(lu.octets), lu.sirenDossier]).toEqual(['<facture/>', '987654321'])
    expect(faux.telechargements).toEqual(['pieces:d1/1-facture.xml'])
  })

  it('un chemin hors du dossier ne se télécharge pas', async () => {
    for (const chemin of ['d2/1-facture.xml', 'd1/../d2/facture.xml', 'facture.xml']) {
      expect(await lireLOriginalRecu('d1', chemin)).toEqual({ refus: `Facture non lue : ${MOTIF_CHEMIN_HORS_DU_DOSSIER}.` })
    }
    expect(faux.telechargements).toEqual([])
  })

  it('un téléchargement refusé, un SIRET illisible, un autre dossier rendu, une coupure : refusés, sans rejeter', async () => {
    faux.fichier = { data: null, error: { message: 'Object not found' } }
    expect(await lireLOriginalRecu('d1', 'd1/f.xml')).toEqual({ refus: 'L’original de la facture n’a pas pu être téléchargé (Object not found).' })
    faux.fichier = { data: new Blob(['x']), error: null }
    faux.dossier = { data: null, error: { message: 'permission denied' } }
    const siret = await lireLOriginalRecu('d1', 'd1/f.xml')
    expect('refus' in siret && siret.refus).toContain('Le SIRET du dossier n’a pas pu être lu (permission denied)')
    faux.dossier = { data: { id: 'd2', siret: null }, error: null }
    expect('refus' in await lireLOriginalRecu('d1', 'd1/f.xml')).toBe(true)
    faux.leve = true
    const coupe = await lireLOriginalRecu('d1', 'd1/f.xml')
    expect('refus' in coupe && coupe.refus).toContain('réseau coupé')
  })
})
