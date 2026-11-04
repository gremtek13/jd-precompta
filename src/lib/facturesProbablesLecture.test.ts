import { beforeEach, describe, expect, it, vi } from 'vitest'

// LES FACTURES PROBABLES DE L'ONGLET DOCUMENTS (relecture du 04/11/2026, D4). La lecture ne rapatrie que les textes qui
// portent « factur » ou « honoraires », des seuls documents, puis juge chacun par la règle de la lecture.

const etat = {
  demandes: [] as string[],
  reponse: { data: [] as unknown[], error: null as { message: string } | null, count: 0 as number | null },
  leve: false,
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      etat.demandes.push(`from ${table}`)
      const c: Record<string, unknown> = {}
      const noter = (nom: string) => (...args: unknown[]) => { etat.demandes.push(`${nom} ${args.map(String).join(' ')}`); return c }
      Object.assign(c, {
        select: noter('select'), eq: noter('eq'), not: noter('not'), or: noter('or'), order: noter('order'),
        // La première tranche rend la réponse programmée, les suivantes rien : un total annoncé plus grand que ce qui
        // revient fait une lecture partielle.
        range: (debut: number) => {
          if (etat.leve) throw new Error('réseau coupé')
          return Promise.resolve(debut === 0 ? etat.reponse : { data: [], error: null, count: etat.reponse.count })
        },
      })
      return c
    },
  },
}))

const { facturesProbables, lireLesFacturesProbables } = await import('./facturesProbablesLecture')

beforeEach(() => {
  etat.demandes = []
  etat.reponse = { data: [], error: null, count: 0 }
  etat.leve = false
})

describe('facturesProbables', () => {
  it('retient le document dont le texte se donne pour une facture, et lui seul', () => {
    expect([...facturesProbables([
      { document_id: 'rc', texte: 'ASSUREUR\nFACTURE N° 7\nPrime TTC 412,50 €\nattestation jointe' },
      { document_id: 'releve', texte: 'BANQUE\nFACTURE CARTE DU 12/03 12,30\nSOLDE PRECEDENT 1,00' },
      { document_id: 'honoraires', texte: 'CABINET\nNote d’honoraires\nTotal 540,00' },
      { document_id: 'sans-montant', texte: 'FACTURE PROFORMA' },
      { document_id: null, texte: 'FACTURE N° 1\n10,00' },
      { document_id: 'vide', texte: null },
    ])]).toEqual(['rc', 'honoraires'])
  })
})

describe('lireLesFacturesProbables', () => {
  it('filtre en base : le dossier, les documents seuls, les textes qui en parlent', async () => {
    etat.reponse = { data: [{ document_id: 'rc', texte: 'FACTURE N° 7\n412,50' }], error: null, count: 1 }
    const lecture = await lireLesFacturesProbables('d1')
    expect([...lecture.documents]).toEqual(['rc'])
    expect(lecture.motif).toBeNull()
    expect(etat.demandes).toEqual([
      'from piece_textes_ocr', 'select document_id, texte [object Object]', 'eq dossier_id d1', 'not document_id is null',
      'or texte.ilike.*factur*,texte.ilike.*honoraires*', 'order id',
    ])
  })

  it('lue en partie, refusée ou levée : rien de marqué, et le motif', async () => {
    etat.reponse = { data: [{ document_id: 'rc', texte: 'FACTURE N° 7\n412,50' }], error: null, count: 2 }
    expect((await lireLesFacturesProbables('d1')).documents.size).toBe(0)
    etat.reponse = { data: [], error: { message: 'permission denied' }, count: null }
    const refusee = await lireLesFacturesProbables('d1')
    expect([refusee.documents.size, refusee.motif]).toEqual([0, 'lecture interrompue après 0 ligne(s) : permission denied'])
    etat.leve = true
    const levee = await lireLesFacturesProbables('d1')
    expect([levee.documents.size, levee.motif]).toEqual([0, 'réseau coupé'])
  })
})
