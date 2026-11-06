import { quiCree } from '../../test/mentionsFigees'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SANS_ACOMPTE } from '../../lib/acomptesDesFactures'
import { motsDuCabinet, type EspaceVentes } from '../../lib/espaceVentes'
import type { FactureEmise } from '../../lib/types'
import type { FactureDeLaSerie } from '../../lib/validationDeLaFacture'
import { MENTIONS_VIDES, NON_BASCULE } from '../../test/factures'
import FactureAvoirModal from './FactureAvoirModal'

// LA DATE D'ÉMISSION D'UN AVOIR, DITE AVANT LE CLIC (rangs 17 et 18 de la garde des factures ; lib/validationDeLaFacture.ts).
// L'avoir se numérote dans la série A de l'année de sa date : une date à venir, ou antérieure au plus récent avoir VALIDÉ de
// cette série, retient « Valider l'avoir » dans les deux espaces. L'état d'avant l'étape A7b (drapeau baissé), comme
// FactureAvoirModal.test.tsx.
vi.mock('../../lib/mentionsFigees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mentionsFigees')>()), MENTIONS_FIGEES_EXPORTEES: false,
}))

const faux = vi.hoisted(() => ({ appelsRpc: [] as { nom: string; params: Record<string, unknown> }[] }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'facture_lignes') {
        const lecture = { select: () => lecture, eq: () => lecture, order: () => Promise.resolve({ data: LIGNES, error: null }) }
        return lecture
      }
      throw new Error(`Table non attendue dans ce test : ${table}`)
    },
    rpc: (nom: string, params: Record<string, unknown>) => {
      faux.appelsRpc.push({ nom, params })
      return new Promise(() => {})
    },
  },
}))

const LIGNES = vi.hoisted(() => [{ designation: 'Consultation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }])

// « Maintenant » : le 6 novembre 2026 à 10 h UTC, soit le même jour civil à Paris, à UTC, à New York et à Auckland — le test
// ne dépend donc pas du fuseau que les scripts npm lui donnent (`test:fuseaux`). Seule `Date` est figée.
const AUJOURDHUI = '2026-11-06'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${AUJOURDHUI}T10:00:00Z`))
  faux.appelsRpc = []
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const origine: FactureEmise = {
  id: 'f1', dossier_id: 'd1', numero: 'F2026-0001', statut: 'validee', type: 'facture', facture_origine_id: null,
  date_emission: '2026-09-01', date_echeance: null, tiers_nom: 'Client Test', tiers_adresse: null, tiers_siret: null,
  montant_ht: 100, montant_tva: 20, montant_ttc: 120, mentions_legales: 'Mentions de la facture', notes: null,
  emetteur_nom: 'Cabinet Test', emetteur_siret: null, emetteur_adresse: null, superpdp_invoice_id: null,
  superpdp_dernier_statut: null, tiers_email: null, created_by: null, valide_par: null,
  created_at: '2026-09-01T00:00:00Z', validated_at: '2026-09-01T00:00:00Z', source_de_la_vente: false, acompte: false,
  date_versement_acompte: null, ...MENTIONS_VIDES,
}

const validee = (numero: string, date_emission: string): FactureDeLaSerie => ({ statut: 'validee', numero, date_emission })
// Le plus récent des avoirs validés de la série A de 2026 : le 10 octobre. Les factures de la série F, plus récentes, ne comptent pas.
const SERIE: FactureDeLaSerie[] = [
  validee('F2026-0001', '2026-09-01'),
  validee('F2026-0002', '2026-10-25'),
  validee('A2026-0001', '2026-09-20'),
  validee('A2026-0002', '2026-10-10'),
]

async function monter(espace: EspaceVentes, facturesDeLaSerie: readonly FactureDeLaSerie[] | null, dateEmission: string) {
  render(
    <FactureAvoirModal
      acompte={SANS_ACOMPTE} {...quiCree(espace)} dossierId="d1" factureOrigine={origine} credite={0} reglageDesVentes={NON_BASCULE}
      facturesDeLaSerie={facturesDeLaSerie} onClose={() => {}} onCreated={() => {}}
    />,
  )
  await screen.findByDisplayValue('Consultation')
  fireEvent.change(document.querySelector('#avoir-date')!, { target: { value: dateEmission } })
}

const valider = () => screen.getByRole('button', { name: "Valider l'avoir" }) as HTMLButtonElement
const refusDeLaDate = () => screen.queryAllByText(/La date d'émission/).map((p) => p.textContent ?? '')

const A_VENIR = "La date d'émission, le 07/11/2026, est à venir : nous sommes le 06/11/2026 à Paris."
const AVANT_LE_DERNIER = "La date d'émission, le 05/10/2026, précède celle de A2026-0002 (le 10/10/2026), la plus récente de la même série"

describe.each(['cabinet', 'client'] as const)('FactureAvoirModal — la date d’émission, dans l’espace « %s »', (espace) => {
  it('une date à venir : le rang 17 se dit avant le clic, la création est retenue', async () => {
    await monter(espace, SERIE, '2026-11-07')
    const dits = refusDeLaDate()
    expect(dits).toHaveLength(1)
    expect(dits[0]).toContain(A_VENIR)
    expect(valider().disabled).toBe(true)
    await act(async () => { fireEvent.click(valider()) })
    expect(faux.appelsRpc).toHaveLength(0)
  })

  it('une date antérieure au plus récent avoir validé de la série A : le rang 18 nomme cet avoir', async () => {
    await monter(espace, SERIE, '2026-10-05')
    const dits = refusDeLaDate()
    expect(dits).toHaveLength(1)
    expect(dits[0]).toContain(AVANT_LE_DERNIER)
    expect(valider().disabled).toBe(true)
  })

  it('la date de cet avoir, ou d’après, ou celle d’aujourd’hui : rien ne retient la création', async () => {
    for (const date of ['2026-10-10', '2026-10-11', AUJOURDHUI]) {
      await monter(espace, SERIE, date)
      expect(refusDeLaDate(), date).toEqual([])
      expect(valider().disabled, date).toBe(false)
      cleanup()
    }
  })

  it('ne comptent pas : un avoir validé d’une autre année, une facture (série F), un brouillon', async () => {
    const quiNeCompteraient: FactureDeLaSerie[] = [
      validee('A2025-0009', '2025-12-30'),
      validee('F2026-0009', '2026-10-30'),
      { statut: 'brouillon', numero: null, date_emission: '2026-10-30' },
      { statut: 'brouillon', numero: 'A2026-0009', date_emission: '2026-10-30' },
    ]
    await monter(espace, [...quiNeCompteraient, validee('A2026-0001', '2026-09-20')], '2026-09-25')
    expect(refusDeLaDate()).toEqual([])
    expect(valider().disabled).toBe(false)
  })

  it('une liste lue en partie (null) : aucun rang 18, mais le rang 17 se dit encore', async () => {
    await monter(espace, null, '2026-10-05')
    expect(refusDeLaDate()).toEqual([])
    expect(valider().disabled).toBe(false)
    cleanup()
    await monter(espace, null, '2026-11-07')
    const dits = refusDeLaDate()
    expect(dits).toHaveLength(1)
    expect(dits[0]).toContain(A_VENIR)
    expect(valider().disabled).toBe(true)
  })
})

describe('FactureAvoirModal — la date d’émission, les mots du client', () => {
  it('« Mes ventes » dit les deux refus sans un mot du cabinet', async () => {
    for (const date of ['2026-11-07', '2026-10-05']) {
      await monter('client', SERIE, date)
      const dits = refusDeLaDate()
      expect(dits, date).toHaveLength(1)
      expect(motsDuCabinet(dits[0]), date).toEqual([])
      cleanup()
    }
  })
})
