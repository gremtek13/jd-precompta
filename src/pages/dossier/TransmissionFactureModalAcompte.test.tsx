import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TransmissionFactureModal from './TransmissionFactureModal'
import { facture as factureCii, ligne } from '../../test/facturesCii'
import { factureEnBase, fauxTables, ligneEnBase, poserLesTables } from '../../test/acomptesFactures'
import { ACCES_EN_COURS } from '../../lib/auteursVentes'
import type { Ligne } from '../../test/filtresPostgrest'

// LA FENÊTRE DE TRANSMISSION DEVANT L'ACOMPTE D'UN DEVIS (étape P5b4b, derrière `ACOMPTES_PREVUS`) : elle lit la marque et
// les reprises de la facture, les passe à `refusEmission`, et dit ses refus avant le clic, aux mots du générateur ; une
// lecture refusée n'offre aucun geste et le dit ; drapeau baissé, rien n'est lu et la fenêtre est celle d'hier. Le faux
// client APPLIQUE les filtres (src/test/acomptesFactures.ts). Données FICTIVES.
const drapeau = vi.hoisted(() => ({ acomptes: false }))
vi.mock('../../lib/devis', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('../../lib/devis')>()
  return { ...vrai, get ACOMPTES_PREVUS() { return drapeau.acomptes } }
})
vi.mock('../../lib/supabase', async () => ({ supabase: (await import('../../test/acomptesFactures')).fauxClient }))

const CONNEXION = {
  nom: 'Plateforme Démo', url_flux: 'https://flux.plateforme-demo.fr', url_jeton: 'https://flux.plateforme-demo.fr/jeton',
  hote: 'flux.plateforme-demo.fr', client_id: 'cabinet', organisation_id: null, portee: null, recherche_depuis: null,
  derniere_recuperation: null, cycle_vie_depuis: null, cycle_vie_lu_le: null, created_at: '2026-10-01T08:00:00+00:00',
  version: 'v1',
}

// La finale d'un acompte de 300 € HT, telle que l'onglet la passe (le CII des exemples officiels), et ses lignes en base.
const PRESTATION = ligne({ ordre: 1, designation: 'Mission d’aménagement', prix_unitaire_ht: 1000 })
const REPRISE = ligne({ ordre: 2, designation: 'Reprise de l’acompte F2026-0003 du 01/09/2026', quantite: -1, prix_unitaire_ht: 300 })
const FINALE = factureCii([PRESTATION, REPRISE], { id: 'fin', numero: 'F2026-0007' })

// La marque de l'acompte repris : vraie, fausse, ou absente de la réponse (une colonne que la base ne rend pas).
function tables(acompteMarque: boolean | 'absente' = true): Record<string, Ligne[]> {
  const acompte = factureEnBase({ id: 'a1', numero: 'F2026-0003', date_emission: '2026-09-01' })
  if (acompteMarque === 'absente') delete acompte.acompte
  else acompte.acompte = acompteMarque
  return {
    factures_emises: [factureEnBase({ id: 'fin', numero: 'F2026-0007', date_emission: '2026-09-15' }), acompte],
    facture_lignes: [
      ligneEnBase({ id: 'l1', facture_id: 'fin', ...PRESTATION }),
      ligneEnBase({ id: 'l2', facture_id: 'fin', ...REPRISE, reprise_facture_id: 'a1' }),
    ],
    devis_factures: [],
    devis: [],
    transmissions_factures: [],
    statuts_factures_recus: [],
    facture_superpdp_events: [],
  }
}

function monter() {
  render(
    <TransmissionFactureModal espace="cabinet" acces={ACCES_EN_COURS} dossierId="d1" facture={FINALE} statutTva="redevable"
      articleExoneration={null} numeroTvaAttribue={false} onClose={() => {}} onUpdated={() => {}} />,
  )
}

beforeEach(() => {
  drapeau.acomptes = true
  fauxTables.invoke = (nom) => Promise.resolve(nom === 'plateforme-agreee'
    ? { data: { connexion: CONNEXION }, error: null }
    : { data: { configured: false }, error: null })
})
afterEach(cleanup)

const deposer = () => screen.queryByRole('button', { name: 'Déposer sur Plateforme Démo' })

describe('TransmissionFactureModal — l’acompte d’un devis, drapeau levé', () => {
  it('une finale qui reprend un vrai acompte part', async () => {
    poserLesTables(tables())
    monter()
    expect(await screen.findByRole('button', { name: 'Déposer sur Plateforme Démo' })).toBeTruthy()
    expect(screen.queryByText(/ne peut pas partir telle quelle/)).toBeNull()
  })

  it('la reprise d’une facture qui n’est pas un acompte : le refus du générateur, avant le clic, et aucun geste', async () => {
    poserLesTables(tables(false))
    monter()
    expect(await screen.findByText('Ligne 2 : la facture qu’elle reprend (F2026-0003) n’est pas une facture d’acompte.')).toBeTruthy()
    expect(screen.getByText(/Elle ne peut pas partir telle quelle/)).toBeTruthy()
    expect(deposer()).toBeNull()
  })

  it('une lecture refusée : la fenêtre le dit, et rien n’est proposé', async () => {
    poserLesTables(tables(), { devis_factures: 'permission refusée' })
    monter()
    expect(await screen.findByText(/Le devis dont la facture est tirée n’a pas pu être lu \(permission refusée\)\. On ne sait donc pas si c’est une facture d’acompte/)).toBeTruthy()
    expect(deposer()).toBeNull()
  })

  it('l’acompte repris rendu sans sa marque : illisible, jamais « pas un acompte », et le générateur le dit', async () => {
    poserLesTables(tables('absente'))
    monter()
    expect(await screen.findByText('Ligne 2 : la facture qu’elle reprend (F2026-0003) n’est pas une facture d’acompte.')).toBeTruthy()
    expect(deposer()).toBeNull()
  })
})

describe('TransmissionFactureModal — drapeau baissé : la fenêtre d’hier', () => {
  it('rien de l’acompte n’est lu, aucun refus d’acompte, et la facture part comme hier', async () => {
    drapeau.acomptes = false
    poserLesTables(tables(false))
    monter()
    expect(await screen.findByRole('button', { name: 'Déposer sur Plateforme Démo' })).toBeTruthy()
    expect(fauxTables.demandes.some((d) => /acompte|reprise|devis/.test(d))).toBe(false)
    expect(screen.queryByText(/acompte/)).toBeNull()
  })
})
