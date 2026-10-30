import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FactureFormModal from './FactureFormModal'
import { NON_BASCULE } from '../../test/factures'
import { ANNEES_ILLISIBLES, FRONTIERE_JUGEE_PAR_LA_BASE } from '../../lib/encaissementsFactures'
import { motsDuCabinet, pourLEspace } from '../../lib/espaceVentes'
import {
  REFUS_VALIDATION_SOURCE, confirmationDeLaSource, phraseDuReglageIllisible, reglageDesVentes, type ReglageDesVentes,
} from '../../lib/sourceDeLaVente'
import type { EspaceVentes } from '../../lib/espaceVentes'

// L'ÉTAT D'AVANT L'ÉTAPE A7B, éprouvé tant que son code existe (CLAUDE.md, « Tests ») : le drapeau `MENTIONS_FIGEES_EXPORTEES`
// baissé, le formulaire n'envoie ni ne lit rien de neuf. Ce que le drapeau levé change se joue dans
// FactureFormModalMentionsFigees.test.tsx.
vi.mock('../../lib/mentionsFigees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mentionsFigees')>()), MENTIONS_FIGEES_EXPORTEES: false,
}))


// LA FACTURE D'UN DOSSIER BASCULÉ, À L'ÉCRAN (chantier EC-Q3, étape VF8c ; HISTORIQUE.md, « VF8, LA BASCULE : LA
// CONCEPTION », § 3 (c)). Dans les deux espaces, le formulaire dit AVANT le clic ce que la validation d'une facture source
// refuserait — la nature absente, la facture mixte, la frontière d'un exercice validé au cabinet —, sur la saisie telle
// qu'elle part : « Valider la facture » se grise, le brouillon reste offert. Chez le client, les refus sont réécrits, et la
// frontière, qu'il ne lit pas, se dit jugée par la base. La validation d'une facture source se confirme, sous la phrase du
// module. Un dossier qui n'a pas basculé ne change pas ; un réglage illisible n'offre pas la validation.

const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; args: Record<string, unknown> }[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    // La promesse reste en attente : ce test compte ce qui PART, pas ce qui revient.
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise(() => {})
    },
    // Volontairement bruyant : le formulaire ne lit, ici, que le catalogue et le fichier des clients (vides). Le réglage lui
    // vient de l'écran qui l'ouvre, lu avec le dossier.
    from: (table: string) => {
      if (table === 'articles' || table === 'contacts') {
        const lecture = { select: () => lecture, eq: () => lecture, order: () => lecture, range: () => Promise.resolve({ data: [], error: null, count: 0 }) }
        return lecture
      }
      throw new Error(`Table non attendue dans ce test : ${table}`)
    },
  },
}))

const BASCULE = reglageDesVentes({ ventes_par_les_factures: true, mode_comptable: 'tresorerie' }, [2025])
const BASCULE_CLIENT = reglageDesVentes({ ventes_par_les_factures: true, mode_comptable: 'tresorerie' }, ANNEES_ILLISIBLES)
const ILLISIBLE = reglageDesVentes({ ventes_par_les_factures: undefined }, [2025])
const modele = (cle: string) => (REFUS_VALIDATION_SOURCE.find((r) => r.cle === cle) as { modele: string }).modele

afterEach(() => { vi.restoreAllMocks() })

// Une facture saisie : un client, une ligne, la nature et la date voulues — la saisie TELLE QU'ELLE PART.
function monter(espace: EspaceVentes, reglage: ReglageDesVentes, saisie: { nature?: string; date?: string } = {}) {
  faux.appels = []
  const commun = {
    dossierId: 'd1', dossierNom: 'Dossier fictif', dossierSiret: null, dossierAdresse: null, statutTva: 'franchise' as const,
    articleExoneration: null, numeroTvaAttribue: false, tvaSurDebits: false, facture: null, reglageDesVentes: reglage,
    onClose: () => {}, onSaved: () => {},
  }
  render(espace === 'client'
    ? <FactureFormModal espace="client" {...commun} />
    : <FactureFormModal espace="cabinet" onAdresseUpdated={() => {}} {...commun} />)
  fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Client fictif' } })
  fireEvent.change(document.querySelectorAll('tbody input')[0]!, { target: { value: 'Prestation' } })
  fireEvent.change(document.querySelector('#nature-operation')!, { target: { value: saisie.nature ?? '' } })
  fireEvent.change(document.querySelector('#date-emission')!, { target: { value: saisie.date ?? '2026-03-02' } })
}

const valider = () => screen.getByRole('button', { name: 'Valider la facture' }) as HTMLButtonElement
const brouillon = () => screen.getByRole('button', { name: 'Enregistrer le brouillon' }) as HTMLButtonElement

describe('FactureFormModal — un dossier qui n’a pas basculé ne change pas', () => {
  for (const espace of ['cabinet', 'client'] as const) {
    it(`${espace} : sans nature, mixte ou dans un exercice validé, la facture se valide comme hier, sans confirmation`, async () => {
      const confirmer = vi.spyOn(window, 'confirm')
      monter(espace, { etat: 'non_bascule', anneesValidees: espace === 'client' ? ANNEES_ILLISIBLES : [2025] }, { date: '2025-06-01' })
      fireEvent.change(document.querySelector('#nature-operation')!, { target: { value: 'mixte' } })
      expect(screen.queryByText(/source de (leurs|tes) ventes/)).toBeNull()
      expect(valider().disabled).toBe(false)
      await act(async () => { valider().click() })
      expect(confirmer).not.toHaveBeenCalled()
      expect(faux.appels.map((a) => a.args.p_valider)).toEqual([true])
    })
  }
})

describe('FactureFormModal — un dossier basculé, au cabinet', () => {
  it('la nature absente : le refus de la base, avant le clic ; la validation grisée, le brouillon offert', async () => {
    monter('cabinet', BASCULE)
    screen.getByText(modele('nature_absente'))
    expect(valider().disabled).toBe(true)
    expect(brouillon().disabled).toBe(false)
    await act(async () => { brouillon().click() })
    expect(faux.appels.map((a) => a.args.p_valider)).toEqual([false])
    // La nature choisie, le refus s'éteint.
    fireEvent.change(document.querySelector('#nature-operation')!, { target: { value: 'services' } })
    expect(screen.queryByText(modele('nature_absente'))).toBeNull()
  })

  it('une facture mixte : « des biens et des services » reste offert, et se dit refusé à la validation', () => {
    monter('cabinet', BASCULE, { nature: 'mixte' })
    screen.getByText(modele('mixte'))
    expect(valider().disabled).toBe(true)
    fireEvent.change(document.querySelector('#nature-operation')!, { target: { value: 'biens' } })
    expect(screen.queryByText(modele('mixte'))).toBeNull()
    expect(valider().disabled).toBe(false)
  })

  it('la frontière d’un exercice validé : le 31 décembre refusé sous la phrase de la base, le 1er janvier offert', () => {
    monter('cabinet', BASCULE, { nature: 'services', date: '2025-12-31' })
    screen.getByText("L'exercice 2025 est validé : une facture source de sa vente, ou son avoir, ne s'y valide plus.")
    expect(valider().disabled).toBe(true)
    fireEvent.change(document.querySelector('#date-emission')!, { target: { value: '2026-01-01' } })
    expect(screen.queryByText(/ne s'y valide plus/)).toBeNull()
    expect(valider().disabled).toBe(false)
  })

  it('la validation se confirme sous la phrase du module : refusée, rien ne part ; acceptée, la validation part', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    monter('cabinet', BASCULE, { nature: 'services' })
    await act(async () => { valider().click() })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toBe(`${confirmationDeLaSource('cabinet', 'facture', 'tresorerie')}\n\nLa valider ?`)
    expect(faux.appels).toEqual([])
    confirmer.mockReturnValue(true)
    await act(async () => { valider().click() })
    expect(faux.appels.map((a) => [a.nom, a.args.p_valider])).toEqual([['enregistrer_facture', true]])
  })

  it('le réglage illisible : la phrase et son motif, aucune validation ; le brouillon s’enregistre', async () => {
    monter('cabinet', ILLISIBLE, { nature: 'services' })
    screen.getByText(phraseDuReglageIllisible('cabinet', 'le réglage n’est pas lisible'))
    expect(valider().disabled).toBe(true)
    await act(async () => { brouillon().click() })
    expect(faux.appels.map((a) => a.args.p_valider)).toEqual([false])
  })
})

describe('FactureFormModal — un dossier basculé, chez le client « Ventes »', () => {
  it('la nature absente et la facture mixte, réécrites pour lui ; la validation grisée', () => {
    monter('client', BASCULE_CLIENT)
    const nature = pourLEspace('client', modele('nature_absente'))
    screen.getByText(nature)
    expect(motsDuCabinet(nature)).toEqual([])
    expect(screen.queryByText(modele('nature_absente'))).toBeNull()
    expect(valider().disabled).toBe(true)
    fireEvent.change(document.querySelector('#nature-operation')!, { target: { value: 'mixte' } })
    screen.getByText(pourLEspace('client', modele('mixte')))
    expect(valider().disabled).toBe(true)
  })

  it('la frontière, qu’il ne lit pas : rien de refusé, la réserve dite ; la confirmation tutoyée', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter('client', BASCULE_CLIENT, { nature: 'services', date: '2020-01-02' })
    screen.getByText(FRONTIERE_JUGEE_PAR_LA_BASE)
    expect(valider().disabled).toBe(false)
    await act(async () => { valider().click() })
    const phrase = confirmer.mock.calls[0][0] as string
    expect(phrase).toBe(`${confirmationDeLaSource('client', 'facture', 'tresorerie')}\n\nLa valider ?`)
    expect(motsDuCabinet(phrase)).toEqual([])
    expect(faux.appels.map((a) => a.args.p_valider)).toEqual([true])
  })

  it('le réglage illisible : sa phrase à lui, aucune validation', () => {
    monter('client', ILLISIBLE, { nature: 'services' })
    const phrase = phraseDuReglageIllisible('client', 'le réglage n’est pas lisible')
    screen.getByText(phrase)
    expect(motsDuCabinet(phrase)).toEqual([])
    expect(valider().disabled).toBe(true)
  })
})

// Le témoin de la frontière : la même saisie qui se refuse au cabinet d'un dossier basculé passe, sans nature, dans un dossier
// qui n'a pas basculé (le fixture partagé des autres tests du formulaire).
describe('FactureFormModal — le témoin', () => {
  it('la même saisie, non basculé : aucun refus de source dit', () => {
    monter('cabinet', NON_BASCULE, { date: '2025-12-31' })
    expect(screen.queryByText(modele('nature_absente'))).toBeNull()
    expect(valider().disabled).toBe(false)
  })
})
