import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { MENTIONS_VIDES, NON_BASCULE } from '../../test/factures'
import type { FactureEmise } from '../../lib/types'

// LA LISTE QUE LES DEUX FORMULAIRES JUGENT LA DATE CONTRE (rangs 17 et 18 de la garde des factures). L'onglet passe à la facture
// et à l'avoir `facturesDeLaSerie` : les factures et avoirs du dossier tels qu'il les a lus, ou `null` tant que la liste n'est
// pas lue en entier — le rang 18 se tait alors, la base le dit au clic. Les deux formulaires sont doublés ici : ce fichier ne
// regarde que ce que l'onglet leur donne ; ce qu'ils en font se joue dans FactureFormModalDate.test.tsx et
// FactureAvoirModalDate.test.tsx.
const faux = vi.hoisted(() => ({
  factures: [] as unknown[],
  // Le total que la base annonce : plus grand que ce qu'elle rend, la lecture est PARTIELLE.
  annonce: null as number | null,
  recus: [] as { de: 'facture' | 'avoir'; liste: unknown }[],
}))

vi.mock('./FactureFormModal', () => ({
  default: (p: { facturesDeLaSerie: unknown }) => { faux.recus.push({ de: 'facture', liste: p.facturesDeLaSerie }); return <p>Formulaire de facture</p> },
}))
vi.mock('./FactureAvoirModal', () => ({
  default: (p: { facturesDeLaSerie: unknown }) => { faux.recus.push({ de: 'avoir', liste: p.facturesDeLaSerie }); return <p>Formulaire d’avoir</p> },
}))

// Les acomptes des devis ne sont pas l'objet : le dossier n'en a aucun (`sans`), sinon « Avoir » serait retenu le temps de les lire.
vi.mock('../../lib/acomptesDesFacturesLecture', () => ({
  lireLesAcomptesDesFactures: (dossierId: string) => Promise.resolve({ dossierId, etat: 'sans' }),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: { invoke: () => Promise.resolve({ data: { connexion: null }, error: null }) },
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let plage: [number, number] | null = null
      Object.assign(chaine, {
        select: () => chaine,
        order: () => chaine,
        eq: () => chaine,
        in: () => chaine,
        range: (debut: number, fin: number) => { plage = [debut, fin]; return chaine },
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          const lignes = table === 'factures_emises' ? faux.factures : []
          const tranche = plage ? lignes.slice(plage[0], plage[1] + 1) : lignes
          return Promise.resolve({ data: tranche, error: null, count: table === 'factures_emises' ? faux.annonce ?? lignes.length : lignes.length }).then(suite)
        },
      })
      return chaine
    },
  },
}))

function validee(o: Partial<FactureEmise> = {}): FactureEmise {
  return {
    id: 'f1', dossier_id: 'dossier-de-test', numero: 'F2026-0001', statut: 'validee', type: 'facture',
    facture_origine_id: null, date_emission: '2026-03-10', date_echeance: null,
    tiers_nom: 'CABINET VOISIN', tiers_adresse: null, tiers_siret: null,
    montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, mentions_legales: null, notes: null,
    emetteur_nom: 'Cabinet de test', emetteur_siret: '12345678901234', emetteur_adresse: null,
    superpdp_invoice_id: null, superpdp_dernier_statut: null, tiers_email: null,
    created_by: null, valide_par: null, created_at: '2026-03-10T09:00:00Z', validated_at: '2026-03-10T09:00:00Z',
    ...MENTIONS_VIDES, source_de_la_vente: false, acompte: false, date_versement_acompte: null, ...o,
  }
}

function monter() {
  return render(
    <FacturesTab reglageDesVentes={NON_BASCULE} espace="cabinet" compteCaisse="530000"
      dossierId="dossier-de-test" dossierNom="Dossier de test" dossierSiret="12345678901234"
      dossierAdresse={null} statutTva="redevable" articleExoneration={null} numeroTvaAttribue={false}
      tvaSurDebits={false} onAdresseUpdated={() => {}}
    />,
  )
}

beforeEach(() => {
  faux.factures = [validee(), validee({ id: 'f2', numero: 'F2026-0002', date_emission: '2026-04-02', tiers_nom: 'AUTRE CLIENT' })]
  faux.annonce = null
  faux.recus = []
})
afterEach(() => { vi.restoreAllMocks() })

async function ouvrirFactureEtAvoir() {
  fireEvent.click(await screen.findByRole('button', { name: '+ Nouvelle facture' }))
  const ligne = (await screen.findByText('CABINET VOISIN')).closest('tr') as HTMLElement
  fireEvent.click(within(ligne).getByRole('button', { name: 'Avoir' }))
  await screen.findByText('Formulaire d’avoir')
}

describe('FacturesTab — la liste que les formulaires jugent la date contre', () => {
  it('lue en entier, la facture et l’avoir reçoivent les factures et avoirs du dossier', async () => {
    monter()
    await ouvrirFactureEtAvoir()
    const lues = faux.recus.at(-1)
    expect(lues?.de).toBe('avoir')
    for (const recu of [faux.recus.findLast((r) => r.de === 'facture'), lues]) {
      const liste = recu?.liste as FactureEmise[] | null
      expect(liste?.map((f) => f.id).sort()).toEqual(['f1', 'f2'])
    }
  })

  it('lue en partie, la facture et l’avoir reçoivent null : la base juge le rang 18 au clic', async () => {
    faux.annonce = 3
    monter()
    await ouvrirFactureEtAvoir()
    expect(faux.recus.findLast((r) => r.de === 'facture')?.liste).toBeNull()
    expect(faux.recus.findLast((r) => r.de === 'avoir')?.liste).toBeNull()
  })
})
