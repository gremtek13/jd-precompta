import { CABINET_DU_DOSSIER } from '../../test/mentionsFigees'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SANS_ACOMPTE } from '../../lib/acomptesDesFactures'
import { motsDuCabinet } from '../../lib/espaceVentes'
import type { FactureDeLaSerie } from '../../lib/validationDeLaFacture'
import { NON_BASCULE } from '../../test/factures'
import FactureFormModal from './FactureFormModal'

// LA DATE D'ÉMISSION, DITE AVANT LE CLIC (rangs 17 et 18 de la garde des factures ; lib/validationDeLaFacture.ts, que
// validationDeLaFacture.test.ts confronte au texte de la garde). Le formulaire juge la date TELLE QU'ELLE PART, dans les deux
// espaces : une date à venir, ou antérieure à la plus récente facture VALIDÉE de la série F de son année, retient « Valider la
// facture » sans empêcher le brouillon. L'état d'avant l'étape A7b (drapeau baissé), comme les autres tests du formulaire : ce
// que le drapeau levé ajoute ne change rien à la date.
vi.mock('../../lib/mentionsFigees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mentionsFigees')>()), MENTIONS_FIGEES_EXPORTEES: false,
}))

const faux = vi.hoisted(() => ({ appels: [] as { nom: string; args: Record<string, unknown> }[] }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise(() => {})
    },
    from: (table: string) => {
      if (table === 'articles' || table === 'contacts') {
        const lecture = { select: () => lecture, eq: () => lecture, order: () => lecture, range: () => Promise.resolve({ data: [], error: null, count: 0 }) }
        return lecture
      }
      throw new Error(`Table non attendue dans ce test : ${table}`)
    },
  },
}))

// « Maintenant » : le 6 novembre 2026 à 10 h UTC, soit le même jour civil à Paris, à UTC, à New York et à Auckland — le test
// ne dépend donc pas du fuseau que les scripts npm lui donnent (`test:fuseaux`). Seule `Date` est figée.
const AUJOURDHUI = '2026-11-06'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${AUJOURDHUI}T10:00:00Z`))
  faux.appels = []
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const validee = (numero: string, date_emission: string): FactureDeLaSerie => ({ statut: 'validee', numero, date_emission })
// La plus récente des factures validées de la série F de 2026 : le 10 octobre.
const SERIE: FactureDeLaSerie[] = [
  validee('F2026-0001', '2026-09-01'),
  validee('F2026-0002', '2026-10-10'),
]

type Espace = 'cabinet' | 'client'

function monter(espace: Espace, facturesDeLaSerie: readonly FactureDeLaSerie[] | null, dateEmission: string) {
  const commun = {
    dossierId: 'd1', dossierNom: 'Dossier fictif', dossierSiret: null, dossierAdresse: null, statutTva: 'franchise' as const,
    articleExoneration: null, numeroTvaAttribue: false, tvaSurDebits: false, facture: null, reglageDesVentes: NON_BASCULE,
    acompte: SANS_ACOMPTE, facturesDeLaSerie, onClose: () => {}, onSaved: () => {},
  }
  render(espace === 'client'
    ? <FactureFormModal espace="client" {...commun} />
    : <FactureFormModal espace="cabinet" onAdresseUpdated={() => {}} mandataire={CABINET_DU_DOSSIER} {...commun} />)
  fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Client SARL' } })
  fireEvent.change(document.querySelectorAll('tbody input')[0]!, { target: { value: 'Prestation' } })
  fireEvent.change(document.querySelector('#date-emission')!, { target: { value: dateEmission } })
}

const valider = () => screen.getByRole('button', { name: 'Valider la facture' }) as HTMLButtonElement
const brouillon = () => screen.getByRole('button', { name: 'Enregistrer le brouillon' }) as HTMLButtonElement
const alertes = () => screen.queryAllByRole('alert').map((a) => a.textContent ?? '')
const refusDeLaDate = () => alertes().filter((t) => /La date d'émission/.test(t))

const A_VENIR = "La date d'émission, le 07/11/2026, est à venir : nous sommes le 06/11/2026 à Paris."
const AVANT_LA_DERNIERE = "La date d'émission, le 05/10/2026, précède celle de F2026-0002 (le 10/10/2026), la plus récente de la même série"

describe.each(['cabinet', 'client'] as const)('FactureFormModal — la date d’émission, dans l’espace « %s »', (espace) => {
  it('une date à venir : le rang 17 se dit avant le clic, la validation est retenue, le brouillon reste enregistrable', async () => {
    monter(espace, SERIE, '2026-11-07')
    const dits = refusDeLaDate()
    expect(dits).toHaveLength(1)
    expect(dits[0]).toContain(A_VENIR)
    expect(valider().disabled).toBe(true)
    expect(brouillon().disabled).toBe(false)
    // Un clic sur la validation grisée n'envoie rien ; le brouillon part, lui.
    await act(async () => { fireEvent.click(valider()) })
    expect(faux.appels).toHaveLength(0)
    await act(async () => { fireEvent.click(brouillon()) })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].args.p_valider).toBe(false)
  })

  it('une date antérieure à la plus récente facture validée de la série : le rang 18 nomme cette facture', () => {
    monter(espace, SERIE, '2026-10-05')
    const dits = refusDeLaDate()
    expect(dits).toHaveLength(1)
    expect(dits[0]).toContain(AVANT_LA_DERNIERE)
    expect(valider().disabled).toBe(true)
    expect(brouillon().disabled).toBe(false)
  })

  it('la date de cette facture, ou d’après, ou celle d’aujourd’hui : rien ne retient la validation', () => {
    for (const date of ['2026-10-10', '2026-10-11', AUJOURDHUI]) {
      monter(espace, SERIE, date)
      expect(refusDeLaDate(), date).toEqual([])
      expect(valider().disabled, date).toBe(false)
      cleanup()
    }
  })

  it('ne comptent pas : une facture validée d’une autre année, un avoir (série A), un brouillon', () => {
    const quiNeCompteraient: FactureDeLaSerie[] = [
      validee('F2025-0009', '2025-12-30'),
      validee('A2026-0001', '2026-10-30'),
      { statut: 'brouillon', numero: null, date_emission: '2026-10-30' },
      { statut: 'brouillon', numero: 'F2026-0009', date_emission: '2026-10-30' },
    ]
    monter(espace, [...quiNeCompteraient, validee('F2026-0001', '2026-09-01')], '2026-09-15')
    expect(refusDeLaDate()).toEqual([])
    expect(valider().disabled).toBe(false)
  })

  it('une liste lue en partie (null) : aucun rang 18, mais le rang 17 se dit encore', () => {
    monter(espace, null, '2026-10-05')
    expect(refusDeLaDate()).toEqual([])
    expect(valider().disabled).toBe(false)
    cleanup()
    monter(espace, null, '2026-11-07')
    const dits = refusDeLaDate()
    expect(dits).toHaveLength(1)
    expect(dits[0]).toContain(A_VENIR)
    expect(valider().disabled).toBe(true)
  })

  it('un dossier sans facture validée ne retient rien', () => {
    monter(espace, [], '2026-01-02')
    expect(refusDeLaDate()).toEqual([])
    expect(valider().disabled).toBe(false)
  })
})

describe('FactureFormModal — la date d’émission, les mots du client', () => {
  it('« Mes ventes » dit les deux refus sans un mot du cabinet', () => {
    for (const date of ['2026-11-07', '2026-10-05']) {
      monter('client', SERIE, date)
      const dits = refusDeLaDate()
      expect(dits, date).toHaveLength(1)
      expect(motsDuCabinet(dits[0]), date).toEqual([])
      cleanup()
    }
  })
})
