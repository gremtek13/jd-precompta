import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactureApercu from './FactureApercu'
import { facture as factureCii, ligne } from '../../test/facturesCii'
import { poserLesTables, tablesDuDossier } from '../../test/acomptesFactures'
import type { DossierCii } from '../../lib/factureCii'
import type { FactureEmise } from '../../lib/types'

// L'APERÇU EST LE DOCUMENT QU'ON IMPRIME (relecture adverse du 27/11/2026) : tant que ses lignes ne sont pas revenues, ou
// qu'elles n'ont pas pu être lues, le tableau dit « Chargement… » ou l'erreur sous des totaux bien présents ; et l'avoir dont
// la facture corrigée n'est pas lue dit « En référence à la facture … » ou « — non lu ». L'impression s'offrait pourtant : un
// PDF enregistré ainsi part chez le client, une facture qui se contredit ou un avoir sans la facture qu'il corrige. Elle
// attend désormais ce qu'elle imprime, comme elle attendait déjà l'acompte. Le faux client APPLIQUE les filtres
// (src/test/acomptesFactures.ts). Données FICTIVES.
vi.mock('../../lib/devis', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/devis')>()), ACOMPTES_PREVUS: false }))
vi.mock('../../lib/supabase', async () => ({ supabase: (await import('../../test/acomptesFactures')).fauxClient }))

const EXONERE: DossierCii = { statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1', numero_tva_attribue: false }
const passee = (o: Partial<FactureEmise>) => factureCii([ligne()], { dossier_id: 'd1', ...o })
const FACTURE = passee({ id: 'fin', numero: 'F2026-0007', date_emission: '2026-11-02' })
const AVOIR = passee({ id: 'av1', numero: 'A2026-0001', date_emission: '2026-10-20', type: 'avoir', facture_origine_id: 'a1' })

const monter = (f: FactureEmise) => render(<FactureApercu facture={f} dossier={EXONERE} onClose={() => {}} />)
const imprimer = () => screen.getByRole('button', { name: 'Imprimer / Enregistrer en PDF' }) as HTMLButtonElement

beforeEach(() => { poserLesTables(tablesDuDossier()) })
afterEach(cleanup)

describe('FactureApercu — l’impression attend ce qu’elle imprime', () => {
  it('les lignes pas encore revenues : l’impression ne s’offre pas ; revenues, elle s’offre', async () => {
    monter(FACTURE)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(imprimer().disabled).toBe(true)
    await screen.findByText('Mission d’aménagement')
    await waitFor(() => expect(imprimer().disabled).toBe(false))
  })

  it('les lignes illisibles : l’écran le dit, et l’impression ne s’offre pas', async () => {
    poserLesTables(tablesDuDossier(), { facture_lignes: 'permission refusée' })
    monter(FACTURE)
    expect(await screen.findByText('permission refusée')).toBeTruthy()
    expect(imprimer().disabled).toBe(true)
  })

  it('un avoir dont la facture corrigée n’est pas lue : l’impression ne s’offre pas', async () => {
    poserLesTables(tablesDuDossier(), { factures_emises: 'permission refusée' })
    monter(AVOIR)
    expect(await screen.findByText(/En référence à la facture — non lu/)).toBeTruthy()
    await screen.findByText('Acompte de 30 % sur le devis D2026-0002')
    expect(imprimer().disabled).toBe(true)
  })

  it('un avoir dont la facture corrigée est lue : sa référence, et l’impression s’offre', async () => {
    monter(AVOIR)
    expect(await screen.findByText('En référence à la facture F2026-0003')).toBeTruthy()
    await waitFor(() => expect(imprimer().disabled).toBe(false))
  })
})
