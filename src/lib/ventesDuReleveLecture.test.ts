import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LectureSourcesDesEcrituresDeVente } from './ecrituresVentesFactureesLecture'
import {
  COLONNES_DECLARATIONS_DU_RELEVE, NOM_DES_DECLARATIONS_DU_RELEVE, lireLesVentesDuReleve, type DeclarationDuReleve,
} from './ventesDuReleveLecture'

// CE QUE L'ONGLET BANQUE LIT DES VENTES FACTURÉES D'UN DOSSIER BASCULÉ (lib/ventesDuReleveLecture.ts, chantier EC-Q3,
// étape VF5d) : la lecture de l'onglet Écritures, éprouvée à part (ecrituresVentesFactureesLecture.test.ts), et les
// déclarations des encaissements, ensemble et tout ou rien. Le faux client APPLIQUE le filtre du dossier, annonce son
// compte et peut se taire après N lignes, refuser, ou rendre une ligne d'un autre dossier. Données FICTIVES.

const faux = vi.hoisted(() => ({
  ventes: null as unknown as LectureSourcesDesEcrituresDeVente,
  declarations: [] as Record<string, unknown>[],
  muetApres: Infinity,
  refus: null as string | null,
  fuite: false,
  leve: false,
  demandes: [] as string[],
}))

vi.mock('./ecrituresVentesFactureesLecture', () => ({
  lireLesSourcesDesEcrituresDeVente: async () => faux.ventes,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        if (faux.leve) throw new Error('client indisponible')
        if (table !== 'transmissions_encaissements') throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const q: Record<string, unknown> = {
          select: (colonnes: string, options: { count?: string }) => {
            if (options?.count !== 'exact') throw new Error('une lecture de collection annonce son compte')
            faux.demandes.push(colonnes)
            return q
          },
          eq: (c: string, v: unknown) => { if (!faux.fuite) predicats.push(predicatEq(c, v)); return q },
          order: () => q,
          range: async (debut: number, fin: number) => {
            if (faux.refus) return { data: null, error: { message: faux.refus }, count: null }
            const toutes = filtrer(faux.declarations, predicats)
            return { data: toutes.slice(debut, Math.min(fin + 1, faux.muetApres)), error: null, count: toutes.length }
          },
        }
        return q
      },
    },
  }
})

const declaration = (o: Partial<DeclarationDuReleve> = {}): DeclarationDuReleve => ({
  id: 't1', dossier_id: 'd1', encaissement_id: 'e1', etat: 'accepte', ...o,
})
const SOURCES = { dossierId: 'd1', factures: [], lignes: [], encaissements: [], parts: [], mouvements: [] }

beforeEach(() => {
  faux.ventes = { dossierId: 'd1', etat: 'lue', sources: SOURCES }
  faux.declarations = [declaration(), declaration({ id: 't2', encaissement_id: 'e2', etat: 'echec' }), declaration({ id: 't9', dossier_id: 'd2' })]
  faux.muetApres = Infinity
  faux.refus = null
  faux.fuite = false
  faux.leve = false
  faux.demandes = []
})

describe('lireLesVentesDuReleve', () => {
  it('les ventes facturées et les déclarations du dossier, échouées comprises, réduites à leurs colonnes', async () => {
    const l = await lireLesVentesDuReleve('d1')
    expect(l).toEqual({ dossierId: 'd1', etat: 'lue', sources: { ...SOURCES, declarations: faux.declarations.slice(0, 2) } })
    expect(faux.demandes).toEqual([COLONNES_DECLARATIONS_DU_RELEVE])
  })

  it('des ventes lues en partie : la lecture est incomplète, sous leur motif', async () => {
    faux.ventes = { dossierId: 'd1', etat: 'incomplete', motif: 'les encaissements : lecture incomplète' }
    expect(await lireLesVentesDuReleve('d1')).toEqual(faux.ventes)
  })

  it('des déclarations lues en partie, refusées, ou d’un autre dossier : incomplète, et le motif les nomme', async () => {
    faux.muetApres = 1
    const tronquee = await lireLesVentesDuReleve('d1')
    expect(tronquee.etat).toBe('incomplete')
    expect(tronquee.etat === 'incomplete' && tronquee.motif.startsWith(`${NOM_DES_DECLARATIONS_DU_RELEVE} : `)).toBe(true)
    faux.muetApres = Infinity
    faux.refus = 'permission denied'
    const refusee = await lireLesVentesDuReleve('d1')
    expect(refusee.etat === 'incomplete' && refusee.motif).toContain(NOM_DES_DECLARATIONS_DU_RELEVE)
    faux.refus = null
    faux.fuite = true
    expect(await lireLesVentesDuReleve('d1')).toEqual({
      dossierId: 'd1', etat: 'incomplete', motif: `${NOM_DES_DECLARATIONS_DU_RELEVE} : une ligne rendue n'est pas de ce dossier`,
    })
  })

  it('un client qui lève : incomplète, jamais rejetée', async () => {
    faux.leve = true
    const l = await lireLesVentesDuReleve('d1')
    expect(l.etat).toBe('incomplete')
  })
})
