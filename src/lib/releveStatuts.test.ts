import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleveStatuts } from './receptionPlateforme'

// LE RELEVÉ TEL QUE LES ÉCRANS LE LANCENT (lib/releveStatuts.ts, ligne 28.5, étape d7) : l'appel, puis le numéro des
// factures touchées, lu dans le dossier seulement, et une lecture partielle dite. Le client Supabase et la fonction sont
// simulés ; le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts). Données FICTIVES.
const faux = vi.hoisted(() => ({
  reponse: null as unknown,
  appels: [] as Record<string, unknown>[],
  factures: [] as Record<string, unknown>[],
  // La table cesse de rendre des lignes au-delà de ce rang, en annonçant le vrai total.
  muetApres: null as number | null,
  lectures: 0,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      functions: {
        invoke: (nom: string, options: { body: Record<string, unknown> }) => {
          faux.appels.push({ nom, ...options.body })
          return Promise.resolve(faux.reponse)
        },
      },
      from: (table: string) => {
        if (table !== 'factures_emises') throw new Error(`Table non attendue : ${table}`)
        faux.lectures += 1
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const q: Record<string, unknown> = {
          select: () => q,
          eq: (c: string, v: unknown) => { predicats.push(predicatEq(c, v)); return q },
          in: (c: string, v: unknown[]) => { predicats.push(predicatIn(c, v)); return q },
          order: () => q,
          range: (debut: number, fin: number) => {
            const toutes = filtrer(faux.factures, predicats)
            const borne = Math.min(fin + 1, faux.muetApres ?? Infinity)
            return Promise.resolve({ data: toutes.slice(debut, borne), error: null, count: toutes.length })
          },
        }
        return q
      },
    },
  }
})

const { releverEtNommer } = await import('./releveStatuts')

const releve = (o: Partial<ReleveStatuts> = {}): ReleveStatuts => ({
  hote: 'pa.exemple.fr', version: 'v1', depuis: null, issues: [], en_attente: 0, en_erreur: 0, reportes: 0, complete: true,
  ecartes: { autre_flux: 0, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 }, motif: null,
  cycle_vie_depuis: null, cycle_vie_lu_le: null, erreur_reprise: null, ...o,
})

beforeEach(() => {
  faux.appels = []
  faux.factures = [
    { id: 'f1', dossier_id: 'd1', numero: 'F-1' },
    { id: 'f2', dossier_id: 'd1', numero: 'F-2' },
    { id: 'f3', dossier_id: 'autre', numero: 'F-AILLEURS' },
  ]
  faux.muetApres = null
  faux.lectures = 0
})

describe('releverEtNommer', () => {
  it('appelle la fonction, puis lit le numéro des seules factures gardées, dans le dossier', async () => {
    faux.reponse = {
      data: releve({
        issues: [
          { flux: 'a', issue: 'garde', facture_id: 'f1', code: '210', avertissements: [] },
          { flux: 'b', issue: 'garde', facture_id: 'f1', code: '205', avertissements: [] },
          { flux: 'c', issue: 'garde', facture_id: 'f3', code: '205', avertissements: [] },
          { flux: 'd', issue: 'deja_lu' },
        ],
      }),
      error: null,
    }
    const r = await releverEtNommer('d1', true)
    expect(faux.appels).toEqual([{ nom: 'plateforme-agreee', action: 'relever', dossierId: 'd1', depuisLeDebut: true }])
    expect(r.erreur).toBeNull()
    expect([...(r.resultat?.numeros ?? [])]).toEqual([['f1', 'F-1'], ['f3', null]])
    expect(r.resultat?.numerosIncomplets).toBeNull()
  })

  it('rien de gardé : aucune lecture', async () => {
    faux.reponse = { data: releve({ issues: [{ flux: 'd', issue: 'deja_lu' }] }), error: null }
    const r = await releverEtNommer('d1', false)
    expect(faux.lectures).toBe(0)
    expect(r.resultat?.numeros.size).toBe(0)
  })

  it('une lecture partielle des numéros se dit', async () => {
    faux.reponse = {
      data: releve({
        issues: [
          { flux: 'a', issue: 'garde', facture_id: 'f1', code: '210', avertissements: [] },
          { flux: 'b', issue: 'garde', facture_id: 'f2', code: '205', avertissements: [] },
        ],
      }),
      error: null,
    }
    faux.muetApres = 1
    const r = await releverEtNommer('d1', false)
    expect(r.resultat?.numerosIncomplets).not.toBeNull()
    expect([...(r.resultat?.numeros ?? [])]).toEqual([['f1', 'F-1'], ['f2', null]])
  })

  it('un refus rend la phrase de la fonction, complétée pour un accès refusé', async () => {
    const corps = JSON.stringify({ error: 'La plateforme refuse l’accès (403).', acces_refuse: true })
    faux.reponse = { data: null, error: { context: new Response(corps, { status: 502 }) } }
    const r = await releverEtNommer('d1', false)
    expect(r.resultat).toBeNull()
    expect(r.erreur).toBe('La plateforme refuse l’accès (403). Demandez au client d’ouvrir au cabinet le droit de lire les flux '
      + 'de son entreprise sur sa plateforme.')
  })
})
