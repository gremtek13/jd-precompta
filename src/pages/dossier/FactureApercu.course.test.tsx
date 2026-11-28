import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactureApercu from './FactureApercu'
import { facture as factureCii, ligne } from '../../test/facturesCii'
import { poserLesTables, tablesDuDossier } from '../../test/acomptesFactures'
import type { DossierCii } from '../../lib/factureCii'
import type { FactureEmise } from '../../lib/types'

// UNE LECTURE PLUS LENTE N'ÉCRIT PLUS EN DERNIER — L'EFFET SANS DRAPEAU (audit des courses du 28/11/2026). Les lignes de
// l'aperçu se lisaient sans drapeau d'annulation : l'aperçu passé d'une facture à une autre sans se démonter, la réponse de
// la première, revenue après celle de la seconde, imprimait ses lignes sous l'en-tête et les totaux de la seconde — le
// document qu'on envoie au client. Le faux client est celui de FactureApercuLecture.test.tsx ; les lignes de chaque facture
// y attendent la porte que le test leur pose. Rouge sur le code d'avant. Données FICTIVES.
const portes = vi.hoisted(() => ({ parFacture: {} as Record<string, Promise<void>> }))
vi.mock('../../lib/devis', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/devis')>()), ACOMPTES_PREVUS: false }))
vi.mock('../../lib/supabase', async () => {
  const { fauxClient } = await import('../../test/acomptesFactures')
  return {
    supabase: {
      ...fauxClient,
      from(table: string) {
        const q = fauxClient.from(table)
        if (table !== 'facture_lignes') return q
        let factureId = ''
        const eq = q.eq.bind(q)
        const then = q.then.bind(q)
        return Object.assign(q, {
          eq(c: string, v: unknown) { if (c === 'facture_id') factureId = String(v); eq(c, v); return q },
          then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
            return (portes.parFacture[factureId] ?? Promise.resolve()).then(() => then(ok as never, ko))
          },
        })
      },
    },
  }
})

const EXONERE: DossierCii = { statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1', numero_tva_attribue: false }
const passee = (o: Partial<FactureEmise>) => factureCii([ligne()], { dossier_id: 'd1', ...o })
const FINALE = passee({ id: 'fin', numero: 'F2026-0007', date_emission: '2026-11-02' })
const ACOMPTE = passee({ id: 'a2', numero: 'F2026-0005', date_emission: '2026-10-15' })
const apercu = (f: FactureEmise) => <FactureApercu facture={f} dossier={EXONERE} onClose={() => {}} />

beforeEach(() => { poserLesTables(tablesDuDossier()); portes.parFacture = {} })
afterEach(cleanup)

describe('FactureApercu — l’aperçu passé à une autre facture', () => {
  it('les lignes de la facture quittée, revenues après celles de la nouvelle, ne s’impriment pas', async () => {
    let ouvrirLaFinale = () => {}
    let ouvrirLAcompte = () => {}
    portes.parFacture = {
      fin: new Promise((r) => { ouvrirLaFinale = r }),
      a2: new Promise((r) => { ouvrirLAcompte = r }),
    }
    const { rerender } = render(apercu(FINALE))
    rerender(apercu(ACOMPTE))
    await act(async () => { ouvrirLAcompte() })
    expect(await screen.findByText('Acompte de 20 % sur le devis D2026-0002')).toBeTruthy()
    await act(async () => { ouvrirLaFinale() })
    expect(screen.queryByText('Mission d’aménagement')).toBeNull()
    expect(screen.getByText('Acompte de 20 % sur le devis D2026-0002')).toBeTruthy()
  })
})
