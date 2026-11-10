import { CABINET_DU_DOSSIER } from '../../test/mentionsFigees'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SANS_ACOMPTE } from '../../lib/acomptesDesFactures'
import { REFUS_ADRESSE_DU_CLIENT, REFUS_LIGNE_A_ZERO } from '../../lib/validationDeLaFacture'
import { NON_BASCULE } from '../../test/factures'
import FactureFormModal from './FactureFormModal'

// L'ADRESSE DU CLIENT, DITE AVANT LE CLIC (JJ-Q4 ; le rang 19, le déclencheur qui suit la garde des factures ;
// lib/validationDeLaFacture.ts, que validationDeLaFacture.test.ts confronte à la migration `adresse_du_client_exigee`, en
// production depuis le 08/11/2026). Le formulaire juge l'en-tête TEL QU'IL PART, dans les deux espaces : une facture à une
// entreprise ou à un organisme public sans l'adresse de son client retient « Valider la facture » sans empêcher le
// brouillon, sous les mots de la base. Le drapeau `ADRESSE_DU_CLIENT_EXIGEE` joue ses deux états par un accesseur : levé
// (la migration en base, l'état depuis le 08/11/2026), et baissé — l'état d'avant, où la base validait encore et l'écran
// ne retenait rien, qui revient si le drapeau se baisse avant un retour de la migration.
// L'état d'avant l'étape A7b (MENTIONS_FIGEES_EXPORTEES baissé), comme les autres tests du formulaire.
const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('../../lib/validationDeLaFacture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/validationDeLaFacture')>()),
  get ADRESSE_DU_CLIENT_EXIGEE() { return drapeau.leve },
}))
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

// « Maintenant » : le 6 novembre 2026 à 10 h UTC, le même jour civil sous les quatre fuseaux de `test:fuseaux`.
const AUJOURDHUI = '2026-11-06'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${AUJOURDHUI}T10:00:00Z`))
  faux.appels = []
  drapeau.leve = true
})
afterEach(() => { cleanup(); vi.useRealTimers() })

type Espace = 'cabinet' | 'client'
type Type = '' | 'assujetti' | 'organisme_public' | 'non_assujetti' | 'etranger'

// Un dossier redevable ; la facture d'une prestation à 20 %, datée du jour, aux mentions qui disent les pénalités de
// retard (une facture à une entreprise les dit : lib/mentionsFigeesVue.ts) ; le client de ce type, à cette adresse.
function monter(espace: Espace, type: Type, adresse: string, ligne?: { taux: string; article: 'cgi_261_4_4_a' | null }) {
  const commun = {
    dossierId: 'd1', dossierNom: 'Dossier fictif', dossierSiret: null, dossierAdresse: null, statutTva: 'redevable' as const,
    articleExoneration: ligne?.article ?? null, numeroTvaAttribue: false, tvaSurDebits: false, facture: null,
    reglageDesVentes: NON_BASCULE, acompte: SANS_ACOMPTE, facturesDeLaSerie: [], modelesDeNumerotation: null, onClose: () => {}, onSaved: () => {},
  }
  render(espace === 'client'
    ? <FactureFormModal espace="client" {...commun} />
    : <FactureFormModal espace="cabinet" onAdresseUpdated={() => {}} mandataire={CABINET_DU_DOSSIER} {...commun} />)
  fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Client fictif SARL' } })
  fireEvent.change(document.querySelector('#type-client')!, { target: { value: type } })
  fireEvent.change(document.querySelector('#tiers-adresse')!, { target: { value: adresse } })
  fireEvent.change(document.querySelectorAll('tbody input')[0]!, { target: { value: 'Prestation' } })
  // L'article choisi, la ligne à 0 % porte sa mention (le formulaire l'exige : lib/statutTva.ts).
  const mention = ligne?.article ? 'Exonération de TVA, art. 261, 4, 4° a du CGI. ' : ''
  fireEvent.change(document.querySelector('#mentions')!, { target: { value: `${mention}Pénalités de retard : 10 % par an.` } })
  if (ligne) fireEvent.change(document.querySelector('td[data-libelle="TVA %"] input')!, { target: { value: ligne.taux } })
}

const valider = () => screen.getByRole('button', { name: 'Valider la facture' }) as HTMLButtonElement
const brouillon = () => screen.getByRole('button', { name: 'Enregistrer le brouillon' }) as HTMLButtonElement
const refusDeLAdresse = () => screen.queryAllByRole('alert').map((a) => a.textContent ?? '').filter((t) => /L'adresse du client manque/.test(t))

describe.each(['cabinet', 'client'] as const)('FactureFormModal — l’adresse du client, dans l’espace « %s »', (espace) => {
  it('une entreprise sans adresse : le refus de la base se dit avant le clic, la validation est retenue, le brouillon part', async () => {
    monter(espace, 'assujetti', '')
    expect(refusDeLAdresse()).toEqual([REFUS_ADRESSE_DU_CLIENT.modele])
    expect(valider().disabled).toBe(true)
    expect(brouillon().disabled).toBe(false)
    // Un clic sur la validation grisée n'envoie rien ; le brouillon part, sans adresse, comme la saisie.
    await act(async () => { fireEvent.click(valider()) })
    expect(faux.appels).toHaveLength(0)
    await act(async () => { fireEvent.click(brouillon()) })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].args.p_valider).toBe(false)
    expect((faux.appels[0].args.p_facture as Record<string, unknown>).tiers_adresse).toBeNull()
  })

  it('un organisme public sans adresse, ou une adresse faite de blancs : retenue de même', () => {
    monter(espace, 'organisme_public', '')
    expect(refusDeLAdresse()).toEqual([REFUS_ADRESSE_DU_CLIENT.modele])
    expect(valider().disabled).toBe(true)
    cleanup()
    monter(espace, 'assujetti', ' \n  ')
    expect(refusDeLAdresse()).toEqual([REFUS_ADRESSE_DU_CLIENT.modele])
    expect(valider().disabled).toBe(true)
  })

  it('l’adresse saisie : rien ne retient la validation, et l’adresse part avec la facture', async () => {
    monter(espace, 'assujetti', '5 avenue de l’Essai\n69001 Lyon')
    expect(refusDeLAdresse()).toEqual([])
    expect(valider().disabled).toBe(false)
    // L'en-tête qui part est celui que le refus a jugé : la même adresse, telle quelle.
    await act(async () => { fireEvent.click(brouillon()) })
    expect(faux.appels).toHaveLength(1)
    expect((faux.appels[0].args.p_facture as Record<string, unknown>).tiers_adresse).toBe('5 avenue de l’Essai\n69001 Lyon')
    expect((faux.appels[0].args.p_facture as Record<string, unknown>).type_client).toBe('assujetti')
  })

  it('un particulier, un client établi hors de France, un type à préciser : sans adresse, rien ne se retient', () => {
    for (const type of ['non_assujetti', 'etranger', ''] as const) {
      monter(espace, type, '')
      expect(refusDeLAdresse(), type).toEqual([])
      expect(valider().disabled, type).toBe(false)
      cleanup()
    }
  })

  it('le drapeau baissé (la migration pas encore en base) : l’écran ne retient pas ce que la base valide', () => {
    drapeau.leve = false
    monter(espace, 'assujetti', '')
    expect(refusDeLAdresse()).toEqual([])
    expect(valider().disabled).toBe(false)
  })
})

// LA LIGNE À 0 % D'UN REDEVABLE SANS ARTICLE (A7C-Q1 ; le rang 20, le même déclencheur et le même drapeau) : le refus de la
// base se dit avant le clic et retient la validation ; levé, il remplace l'alerte d'hier, qui reste tant qu'il est baissé.
const refusDeLaLigne = () => screen.queryAllByRole('alert').map((a) => a.textContent ?? '').filter((t) => /Une ligne est au taux 0/.test(t))
const alerteDHier = () => [...document.querySelectorAll('.alerte-tva')].map((a) => a.textContent ?? '').filter((t) => /Une ligne à 0 %/.test(t))

describe.each(['cabinet', 'client'] as const)('FactureFormModal — la ligne à 0 % d’un redevable, dans l’espace « %s »', (espace) => {
  it('sans article : le refus de la base, la validation retenue, le brouillon libre, l’alerte d’hier tue', () => {
    monter(espace, 'assujetti', '5 avenue de l’Essai, 69001 Lyon', { taux: '0', article: null })
    expect(refusDeLaLigne()).toEqual([REFUS_LIGNE_A_ZERO.modele])
    expect(alerteDHier()).toEqual([])
    expect(valider().disabled).toBe(true)
    expect(brouillon().disabled).toBe(false)
  })

  it('l’article du dossier choisi, ou la ligne à 20 % : rien ne retient la validation', () => {
    monter(espace, 'assujetti', '5 avenue de l’Essai, 69001 Lyon', { taux: '0', article: 'cgi_261_4_4_a' })
    expect(refusDeLaLigne()).toEqual([])
    expect(valider().disabled).toBe(false)
    cleanup()
    monter(espace, 'assujetti', '5 avenue de l’Essai, 69001 Lyon', { taux: '20', article: null })
    expect(refusDeLaLigne()).toEqual([])
    expect(valider().disabled).toBe(false)
  })

  it('le drapeau baissé : l’alerte d’hier, et la validation offerte comme la base l’accepte', () => {
    drapeau.leve = false
    monter(espace, 'assujetti', '5 avenue de l’Essai, 69001 Lyon', { taux: '0', article: null })
    expect(refusDeLaLigne()).toEqual([])
    expect(alerteDHier()).toHaveLength(1)
    expect(valider().disabled).toBe(false)
  })
})
