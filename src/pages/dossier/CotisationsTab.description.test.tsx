import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CotisationsTab from './CotisationsTab'
import type { ModeleComptable } from '../../lib/engagement'
import { cotisation, faux, reinitialiser } from '../../test/cotisationsGestes'
import { AvecExercicesValides } from '../../test/exercicesValides'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'

// DÉCRIRE UNE ÉCHÉANCE FIGÉE OU PAYÉE DEPUIS LE COMPTE PERSONNEL (ligne 27, TNS-Q2) : sous le drapeau, une échéance d'un
// exercice validé lue avec ses colonnes offre « Décrire », sa fenêtre ne laisse changer que la description et la mise à
// jour part sous la version lue ; une échéance payée depuis le compte personnel s'écrit en retenant CE paiement. Le
// drapeau baissé, la ligne figée d'hier. Les règles sont dans lib/gestesDesEcheances.ts : ici, le câblage.
const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('../../lib/regularisationDesCotisations', async (importer) => {
  const reel = await importer<typeof import('../../lib/regularisationDesCotisations')>()
  return { ...reel, get REGULARISATION_DES_COTISATIONS_EXPORTEE() { return drapeau.leve } }
})
vi.mock('../../lib/supabase', async () => ({ supabase: (await import('../../test/cotisationsGestes')).supabaseFaux() }))
vi.mock('../../lib/extraction', async () => (await import('../../test/cotisationsGestes')).extractionFausse())

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }
const monter = (valides: readonly number[] = []) => render(
  <AvecExercicesValides annees={valides}><CotisationsTab dossierId="dossier-de-test" modele={TRESORERIE} /></AvecExercicesValides>,
)
const decrite = (o: Parameters<typeof cotisation>[0] = {}) =>
  cotisation({ organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle', ...o })
const ligneDe = async (date: string) => (await screen.findByText(date)).closest('tr')!
const fenetre = () => screen.getByRole('dialog')

beforeEach(() => { reinitialiser(); drapeau.leve = true })
afterEach(() => { vi.restoreAllMocks() })

describe('CotisationsTab — décrire une échéance figée', () => {
  it('offre « Décrire », ne laisse changer que la description, écrit en retenant la version lue', async () => {
    faux.cotisations = [decrite()]
    monter([2026])
    const ligne = await ligneDe('20/03/2026')
    expect(within(ligne).getByText('Figée')).toBeTruthy()
    expect(within(ligne).queryByRole('button', { name: 'Modifier' })).toBeNull()
    await act(async () => { within(ligne).getByRole('button', { name: 'Décrire' }).click() })

    expect(within(fenetre()).getByRole('heading').textContent).toBe('Décrire l’échéance du 20/03/2026')
    for (const champ of ['Échéance', 'Montant appelé', 'Montant versé', 'dont CSG-CRDS']) {
      expect((within(fenetre()).getByLabelText(champ) as HTMLInputElement).disabled).toBe(true)
    }
    fireEvent.change(within(fenetre()).getByLabelText('Année payée'), { target: { value: '2025' } })
    fireEvent.change(within(fenetre()).getByLabelText('Nature'), { target: { value: 'regularisation' } })
    await act(async () => { within(fenetre()).getByRole('button', { name: 'Enregistrer' }).click() })

    expect(faux.misesAJour).toEqual([{
      valeur: {
        echeance: '2026-03-20', montant_appele: 800, montant_verse: null, montant_csg_crds: 300, previsionnel: false,
        organisme: 'urssaf', annee_payee: 2025, nature: 'regularisation',
      },
      filtres: [
        'id=eq.cot-1', 'echeance=eq.2026-03-20', 'montant_appele=eq.800', 'previsionnel=eq.false', 'paiement_personnel_le=is.null',
        'montant_verse=is.null', 'montant_csg_crds=eq.300', 'organisme=eq.urssaf', 'annee_payee=eq.2026', 'nature=eq.provisionnelle',
      ],
    }])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('le drapeau baissé : la ligne figée d’hier, sans geste', async () => {
    drapeau.leve = false
    faux.cotisations = [decrite()]
    monter([2026])
    const ligne = await ligneDe('20/03/2026')
    expect(within(ligne).getByText('Figée')).toBeTruthy()
    expect(within(ligne).queryByRole('button', { name: 'Décrire' })).toBeNull()
  })
})

describe('CotisationsTab — décrire une échéance payée depuis le compte personnel', () => {
  it('la mise à jour retient ce paiement, au lieu de n’écrire qu’une échéance sans paiement', async () => {
    faux.cotisations = [decrite({ paiement_personnel_le: '2026-04-10' })]
    monter()
    // La ligne se cherche HORS de l'`act` (elle paraît après la lecture) ; le clic, dedans.
    const ligne = await ligneDe('20/03/2026')
    await act(async () => { within(ligne).getByRole('button', { name: 'Modifier' }).click() })
    expect(within(fenetre()).getByRole('heading').textContent).toBe('Décrire l’échéance du 20/03/2026')
    fireEvent.change(within(fenetre()).getByLabelText('Organisme'), { target: { value: 'carpimko' } })
    await act(async () => { within(fenetre()).getByRole('button', { name: 'Enregistrer' }).click() })
    expect(faux.misesAJour).toHaveLength(1)
    expect(faux.misesAJour[0].valeur).toMatchObject({ montant_appele: 800, montant_csg_crds: 300, organisme: 'carpimko' })
    expect(faux.misesAJour[0].filtres).toContain('paiement_personnel_le=eq.2026-04-10')
  })
})
