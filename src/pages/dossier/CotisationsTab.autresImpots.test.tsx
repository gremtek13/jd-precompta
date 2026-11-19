import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CotisationsTab from './CotisationsTab'
import type { ModeleComptable } from '../../lib/engagement'
import { cotisation, ecriture, faux, ligne, reinitialiser } from '../../test/cotisationsGestes'
import { AvecExercicesValides } from '../../test/exercicesValides'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { formatMoney } from '../../lib/format'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'

// LA PART « AUTRES IMPÔTS » DANS L'ONGLET COTISATIONS (EXP58-Q6, EXP58-Q7 ; lib/autresImpotsDesCotisations.ts). Le câblage, que
// le module ne voit pas : le drapeau levé, le champ de la saisie et la colonne du tableau ; « Modifier » la saisit, retient la
// version lue de sa colonne, et réécrit l'écriture d'une échéance rapprochée avec sa ligne au compte des autres impôts, dite
// avant le clic. Le drapeau baissé, rien de tout cela : ni champ, ni colonne, ni clé écrite, ni filtre.
const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('../../lib/autresImpotsDesCotisations', async (importer) => {
  const reel = await importer<typeof import('../../lib/autresImpotsDesCotisations')>()
  return {
    ...reel,
    get AUTRES_IMPOTS_DES_COTISATIONS_PREVUS() { return drapeau.leve },
    partAutresImpots: (c: { montant_autres_impots?: number | null }) => reel.partAutresImpotsSelon(drapeau.leve, c),
  }
})
vi.mock('../../lib/supabase', async () => ({ supabase: (await import('../../test/cotisationsGestes')).supabaseFaux() }))
vi.mock('../../lib/extraction', async () => (await import('../../test/cotisationsGestes')).extractionFausse())

const TRESORERIE: ModeleComptable = {
  mode: 'tresorerie', compteNotesDeFrais: '108000', plan: { ...PLAN_PAR_DEFAUT, autres_impots: '637800' }, libelles: LIBELLES_PAR_DEFAUT,
  prefixes: PREFIXES_PAR_DEFAUT,
}
const monter = () => render(
  <AvecExercicesValides annees={[]}><CotisationsTab dossierId="dossier-de-test" modele={TRESORERIE} /></AvecExercicesValides>,
)
const ligneDe = async (date: string) => (await screen.findByText(date)).closest('tr')!
const fenetre = () => screen.getByRole('dialog')
const LIBELLE = 'dont autres impôts (CFP, CURPS)'

beforeEach(() => { reinitialiser(); drapeau.leve = true })
afterEach(() => { vi.restoreAllMocks() })

describe('CotisationsTab — la part « autres impôts », drapeau levé', () => {
  it('« Modifier » une échéance rapprochée : la part saisie réécrit l’écriture avec sa ligne, dite avant le clic, sous la version lue', async () => {
    faux.cotisations = [cotisation({ montant_appele: 2000, montant_autres_impots: null })]
    faux.lignes = [ligne()]
    faux.ecritures = [
      ecriture({ id: 'e-a' }), ecriture({ id: 'e-b', compte: '646000', sens: 'debit', montant: 1700 }),
      ecriture({ id: 'e-c', compte: '108000', sens: 'debit', montant: 300 }),
    ]
    monter()
    const ligneEcheance = await ligneDe('20/03/2026')
    await act(async () => { within(ligneEcheance).getByRole('button', { name: 'Modifier' }).click() })
    fireEvent.change(within(fenetre()).getByLabelText(LIBELLE), { target: { value: '20' } })
    expect(within(fenetre()).getByText(/^Son écriture est réécrite/).textContent).toBe(
      `Son écriture est réécrite dans le même geste : ${formatMoney(1680)} au 646000, ${formatMoney(300)} de CSG-CRDS au 108000, `
      + `${formatMoney(20)} d’autres impôts au 637800, face à la banque.`,
    )
    await act(async () => { within(fenetre()).getByRole('button', { name: 'Enregistrer' }).click() })

    expect(faux.misesAJour).toHaveLength(1)
    expect(faux.misesAJour[0].valeur.montant_autres_impots).toBe(20)
    expect(faux.misesAJour[0].filtres).toContain('montant_autres_impots=is.null')
    expect(faux.rpcs).toEqual([{
      nom: 'rapprocher_cotisation',
      args: {
        p_ligne_bancaire_id: 'l-1', p_cotisation_id: 'cot-1', p_ecritures: [
          { compte: '512000', sens: 'credit', montant: 2000, libelle: 'PRLV URSSAF' },
          { compte: '646000', sens: 'debit', montant: 1680, libelle: 'PRLV URSSAF' },
          { compte: '108000', sens: 'debit', montant: 300, libelle: 'PRLV URSSAF' },
          { compte: '637800', sens: 'debit', montant: 20, libelle: 'PRLV URSSAF' },
        ],
      },
    }])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('la saisie offre le champ, le tableau la colonne, et une part au millième se dit avant le clic', async () => {
    faux.cotisations = [cotisation({ montant_autres_impots: 25 })]
    monter()
    const ligneEcheance = await ligneDe('20/03/2026')
    expect(ligneEcheance.textContent).toContain(formatMoney(25))
    expect(screen.getAllByText('dont autres impôts').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText(LIBELLE), { target: { value: '1.005' } })
    expect(screen.getByText('La part « autres impôts » n’est pas au centime.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Ajouter' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('CotisationsTab — la part « autres impôts », drapeau baissé', () => {
  it('ni champ, ni colonne ; « Modifier » n’écrit ni la clé ni son filtre', async () => {
    drapeau.leve = false
    faux.cotisations = [cotisation()]
    monter()
    const ligneEcheance = await ligneDe('20/03/2026')
    expect(screen.queryByLabelText(LIBELLE)).toBeNull()
    expect(screen.queryByText('dont autres impôts')).toBeNull()
    await act(async () => { within(ligneEcheance).getByRole('button', { name: 'Modifier' }).click() })
    expect(within(fenetre()).queryByLabelText(LIBELLE)).toBeNull()
    fireEvent.change(within(fenetre()).getByLabelText('dont CSG-CRDS'), { target: { value: '250' } })
    await act(async () => { within(fenetre()).getByRole('button', { name: 'Enregistrer' }).click() })
    expect(faux.misesAJour).toHaveLength(1)
    expect('montant_autres_impots' in faux.misesAJour[0].valeur).toBe(false)
    expect(faux.misesAJour[0].filtres.some((f) => f.startsWith('montant_autres_impots'))).toBe(false)
  })
})
