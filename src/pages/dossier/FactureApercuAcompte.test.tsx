import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactureApercu from './FactureApercu'
import { formatMoney } from '../../lib/format'
import { facture as factureCii, ligne } from '../../test/facturesCii'
import { fauxTables, poserLesTables, tablesDuDossier } from '../../test/acomptesFactures'
import type { DossierCii } from '../../lib/factureCii'
import type { FactureEmise } from '../../lib/types'

// L'APERÇU D'UNE FACTURE D'ACOMPTE, D'UNE FINALE ET DE L'AVOIR D'UN ACOMPTE (étape P5b4b, derrière `ACOMPTES_PREVUS`). Le
// drapeau se joue dans ses deux états : baissé, l'aperçu est celui d'hier au caractère près et rien de l'acompte n'est lu ;
// levé, le titre et les références que `ceQueLAcompteImprime` décide, et une lecture refusée retient l'impression. Le faux
// client APPLIQUE les filtres (src/test/acomptesFactures.ts). Données FICTIVES.
const drapeau = vi.hoisted(() => ({ acomptes: false }))
vi.mock('../../lib/devis', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('../../lib/devis')>()
  return { ...vrai, get ACOMPTES_PREVUS() { return drapeau.acomptes } }
})
vi.mock('../../lib/supabase', async () => ({ supabase: (await import('../../test/acomptesFactures')).fauxClient }))

const REDEVABLE: DossierCii = { statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false }
// La facture telle que l'onglet la passe : `FactureEmise` ne porte pas la marque, que l'aperçu lit lui-même.
const passee = (o: Partial<FactureEmise>) => factureCii([ligne()], { dossier_id: 'd1', ...o })
const ACOMPTE = passee({ id: 'a1', numero: 'F2026-0003', date_emission: '2026-10-01' })
const FINALE = passee({ id: 'fin', numero: 'F2026-0007', date_emission: '2026-11-02' })
const AVOIR = passee({ id: 'av1', numero: 'A2026-0001', date_emission: '2026-10-20', type: 'avoir', facture_origine_id: 'a1' })

const monter = (f: FactureEmise) => render(<FactureApercu facture={f} dossier={REDEVABLE} onClose={() => {}} />)
const titre = () => screen.getByRole('heading', { level: 2 }).textContent
const imprimer = () => screen.getByRole('button', { name: 'Imprimer / Enregistrer en PDF' }) as HTMLButtonElement
// L'acompte est lu quand l'impression ne l'attend plus.
const acompteLu = () => waitFor(() => expect(imprimer().disabled).toBe(false))

beforeEach(() => { drapeau.acomptes = true; poserLesTables(tablesDuDossier()) })
afterEach(cleanup)

describe('FactureApercu — l’acompte d’un devis, drapeau levé', () => {
  it('la facture d’acompte : son titre, le devis cité et la date du versement', async () => {
    monter(ACOMPTE)
    await screen.findByText('Acompte de 30 % sur le devis D2026-0002')
    await acompteLu()
    expect(titre()).toBe('FACTURE D’ACOMPTE F2026-0003')
    expect(screen.getByText('Acompte sur le devis D2026-0002 du 20/09/2026')).toBeTruthy()
    expect(screen.getByText('Acompte versé le 25/09/2026')).toBeTruthy()
  })

  it('la finale : « FACTURE », la phrase qui cite les deux acomptes, et ses reprises négatives', async () => {
    monter(FINALE)
    await screen.findByText('Mission d’aménagement')
    await acompteLu()
    expect(titre()).toBe('FACTURE F2026-0007')
    expect(screen.getByText('Facture définitive après les acomptes F2026-0003 du 01/10/2026 et F2026-0005 du 15/10/2026, repris en déduction')).toBeTruthy()
    const reprise = screen.getByText('Reprise de l’acompte F2026-0003 du 01/10/2026').closest('tr')!
    expect(reprise.querySelector('td[data-libelle="Qté"]')!.textContent).toBe('-1')
    expect(reprise.querySelector('td[data-libelle="Total HT"]')!.textContent).toBe(formatMoney(-300))
    expect(reprise.querySelector('td[data-libelle="Total TTC"]')!.textContent).toBe(formatMoney(-360))
  })

  it('l’avoir d’un acompte : « AVOIR » et la facture d’acompte qu’il corrige, sans la référence d’hier', async () => {
    monter(AVOIR)
    await acompteLu()
    expect(titre()).toBe('AVOIR A2026-0001')
    expect(screen.getByText('Avoir sur la facture d’acompte F2026-0003 du 01/10/2026')).toBeTruthy()
    expect(screen.queryByText(/En référence à la facture/)).toBeNull()
  })

  it('une lecture refusée : l’écran le dit, et l’impression ne s’offre pas', async () => {
    poserLesTables(tablesDuDossier(), { devis_factures: 'permission refusée' })
    monter(ACOMPTE)
    expect(await screen.findByText(/Le devis dont la facture est tirée n’a pas pu être lu \(permission refusée\)/)).toBeTruthy()
    expect(imprimer().disabled).toBe(true)
    expect(titre()).toBe('FACTURE F2026-0003')
  })

  it('les références ne s’impriment jamais avec une mise en page en ligne', async () => {
    monter(ACOMPTE)
    await acompteLu()
    expect(screen.getByText('Acompte sur le devis D2026-0002 du 20/09/2026').getAttribute('style')).toBeNull()
  })
})

describe('FactureApercu — drapeau baissé, ou sans acompte : l’aperçu d’hier au caractère près', () => {
  it('drapeau baissé : rien de l’acompte n’est lu, et la facture d’acompte s’imprime comme une facture d’hier', async () => {
    drapeau.acomptes = false
    const { container } = monter(ACOMPTE)
    await screen.findByText('Acompte de 30 % sur le devis D2026-0002')
    expect(fauxTables.demandes).toEqual(['facture_lignes: *'])
    expect(titre()).toBe('FACTURE F2026-0003')
    expect(imprimer().disabled).toBe(false)
    const baisse = container.innerHTML
    cleanup()

    // Levé, une facture qui ne porte ni ne reprend d'acompte : le même document, au caractère près.
    drapeau.acomptes = true
    const tables = tablesDuDossier()
    tables.factures_emises.find((f) => f.id === 'a1')!.acompte = false
    tables.factures_emises.find((f) => f.id === 'a1')!.date_versement_acompte = null
    tables.devis_factures = []
    poserLesTables(tables)
    const leve = monter(ACOMPTE)
    await screen.findByText('Acompte de 30 % sur le devis D2026-0002')
    await acompteLu()
    expect(leve.container.innerHTML).toBe(baisse)
  })
})
