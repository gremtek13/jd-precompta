import { CABINET_DU_DOSSIER } from '../../test/mentionsFigees'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SANS_ACOMPTE } from '../../lib/acomptesDesFactures'
import { motsDuCabinet } from '../../lib/espaceVentes'
import type { FactureDeLaSerie, ModeleDeLaSerie } from '../../lib/validationDeLaFacture'
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
const reprise = (numero: string, date_emission: string): FactureDeLaSerie => ({ statut: 'importee', numero, date_emission })

type Espace = 'cabinet' | 'client'

// LA SÉRIE DE QUI VALIDE (A9a, jour J du 10/11/2026) : le cabinet numérote dans celle de son mandataire (M…), un accès
// « Ventes » dans celle du client (F…). L'onglet du cabinet lit les modèles posés — aucun ici : le modèle par défaut —, le
// client ne les lit pas (la table ne s'ouvre qu'au cabinet du dossier).
const LETTRE: Record<Espace, string> = { cabinet: 'M', client: 'F' }
const MODELES: Record<Espace, readonly ModeleDeLaSerie[] | null> = { cabinet: [], client: null }
// La plus récente des factures validées de la série de l'espace, en 2026 : le 10 octobre.
const serie = (espace: Espace): FactureDeLaSerie[] => [
  validee(`${LETTRE[espace]}2026-0001`, '2026-09-01'),
  validee(`${LETTRE[espace]}2026-0002`, '2026-10-10'),
]

function monter(espace: Espace, facturesDeLaSerie: readonly FactureDeLaSerie[] | null, dateEmission: string,
  modelesDeNumerotation: readonly ModeleDeLaSerie[] | null) {
  const commun = {
    dossierId: 'd1', dossierNom: 'Dossier fictif', dossierSiret: null, dossierAdresse: null, statutTva: 'franchise' as const,
    articleExoneration: null, numeroTvaAttribue: false, tvaSurDebits: false, facture: null, reglageDesVentes: NON_BASCULE,
    acompte: SANS_ACOMPTE, facturesDeLaSerie, modelesDeNumerotation, onClose: () => {}, onSaved: () => {},
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
const AVANT_LA_DERNIERE = "La date d'émission, le 05/10/2026, précède celle de M2026-0002 (le 10/10/2026), la plus récente de la même série"
const AVANT_LA_REPRISE = "La date d'émission, le 15/10/2026, précède celle de M2026-0007 (le 20/10/2026), la plus récente des factures reprises de la même série"

describe.each(['cabinet', 'client'] as const)('FactureFormModal — la date d’émission, dans l’espace « %s »', (espace) => {
  it('une date à venir : le rang 17 se dit avant le clic, la validation est retenue, le brouillon reste enregistrable', async () => {
    monter(espace, serie(espace), '2026-11-07', MODELES[espace])
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

  it('la date de la plus récente, ou d’après, ou celle d’aujourd’hui : rien ne retient la validation', () => {
    for (const date of ['2026-10-10', '2026-10-11', AUJOURDHUI]) {
      monter(espace, serie(espace), date, MODELES[espace])
      expect(refusDeLaDate(), date).toEqual([])
      expect(valider().disabled, date).toBe(false)
      cleanup()
    }
  })

  it('une liste lue en partie (null) : aucun rang 18, mais le rang 17 se dit encore', () => {
    monter(espace, null, '2026-10-05', MODELES[espace])
    expect(refusDeLaDate()).toEqual([])
    expect(valider().disabled).toBe(false)
    cleanup()
    monter(espace, null, '2026-11-07', MODELES[espace])
    const dits = refusDeLaDate()
    expect(dits).toHaveLength(1)
    expect(dits[0]).toContain(A_VENIR)
    expect(valider().disabled).toBe(true)
  })

  it('un dossier sans facture validée ne retient rien', () => {
    monter(espace, [], '2026-01-02', MODELES[espace])
    expect(refusDeLaDate()).toEqual([])
    expect(valider().disabled).toBe(false)
  })
})

describe('FactureFormModal — le cabinet juge la date dans la série de son mandataire (A9a)', () => {
  it('une date antérieure à la plus récente facture validée de la série M : le rang 18 nomme cette facture', () => {
    monter('cabinet', serie('cabinet'), '2026-10-05', [])
    const dits = refusDeLaDate()
    expect(dits).toHaveLength(1)
    expect(dits[0]).toContain(AVANT_LA_DERNIERE)
    expect(valider().disabled).toBe(true)
    expect(brouillon().disabled).toBe(false)
  })

  it('ne comptent pas : la série du client (F), une autre année, un avoir du mandataire (MA), un brouillon', () => {
    const quiNeCompteraient: FactureDeLaSerie[] = [
      validee('F2026-0009', '2026-10-30'),
      validee('M2025-0009', '2025-12-30'),
      validee('MA2026-0001', '2026-10-30'),
      { statut: 'brouillon', numero: null, date_emission: '2026-10-30' },
      { statut: 'brouillon', numero: 'M2026-0009', date_emission: '2026-10-30' },
    ]
    monter('cabinet', [...quiNeCompteraient, validee('M2026-0001', '2026-09-01')], '2026-09-15', [])
    expect(refusDeLaDate()).toEqual([])
    expect(valider().disabled).toBe(false)
  })

  it('une facture reprise de la série, plus récente que les validées : la garde de la numérotation la nomme, sous ses mots', () => {
    monter('cabinet', [...serie('cabinet'), reprise('M2026-0007', '2026-10-20')], '2026-10-15', [])
    const dits = refusDeLaDate()
    expect(dits).toHaveLength(1)
    expect(dits[0]).toContain(AVANT_LA_REPRISE)
    expect(valider().disabled).toBe(true)
  })

  const pose = (o: Partial<ModeleDeLaSerie>): ModeleDeLaSerie => ({ id: 'm1', nature: 'facture', emetteur: 'mandataire',
    modele: 'F{AAAA}-{N:4}', annuel: true, depuis: 2026, pose_le: '2026-11-10T10:00:00+00:00', ...o })

  it('un modèle posé pour sa série : la date se juge dans la série de ce modèle', () => {
    // La série d'hier (F) posée au mandataire : c'est elle qui compte, et plus la série M.
    monter('cabinet', [...serie('cabinet'), ...serie('client')], '2026-10-05', [pose({})])
    expect(refusDeLaDate()[0]).toContain("précède celle de F2026-0002 (le 10/10/2026), la plus récente de la même série")
    cleanup()
    // Un modèle posé pour une autre série (les avoirs, le client, une année à venir) ne change rien : la série M se juge.
    monter('cabinet', serie('cabinet'), '2026-10-05', [pose({ nature: 'avoir' }), pose({ id: 'm2', emetteur: 'client' }),
      pose({ id: 'm3', depuis: 2027 })])
    expect(refusDeLaDate()[0]).toContain(AVANT_LA_DERNIERE)
  })

  it('un modèle dont le préfixe dépend du compteur, ou des modèles non lus : le rang 18 se tait, et la base juge au clic', async () => {
    for (const modeles of [[pose({ modele: '{N:4}-M{AAAA}' })], null]) {
      monter('cabinet', serie('cabinet'), '2026-10-05', modeles)
      expect(refusDeLaDate()).toEqual([])
      expect(valider().disabled).toBe(false)
      cleanup()
    }
    monter('cabinet', serie('cabinet'), '2026-10-05', null)
    await act(async () => { fireEvent.click(valider()) })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].args.p_valider).toBe(true)
  })
})

describe('FactureFormModal — le client ne lit pas sa série : le rang 18 se tait, la base juge au clic', () => {
  it('même devant une facture F plus récente, la validation part ; la base répondra, sous ses mots', async () => {
    monter('client', serie('client'), '2026-10-05', null)
    expect(refusDeLaDate()).toEqual([])
    expect(valider().disabled).toBe(false)
    await act(async () => { fireEvent.click(valider()) })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].args.p_valider).toBe(true)
  })

  it('« Mes ventes » dit le refus de la date à venir sans un mot du cabinet', () => {
    monter('client', serie('client'), '2026-11-07', null)
    const dits = refusDeLaDate()
    expect(dits).toHaveLength(1)
    expect(motsDuCabinet(dits[0])).toEqual([])
  })
})
