import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { etatsDesVentesFacturees, type EtatsDesVentes } from '../../lib/ecrituresVentesFactureesEcran'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import VentesFactureesEcritures from './VentesFactureesEcritures'

// LA SECTION SEULE (étape VF4c1), sur des états que l'on fixe : le câblage de l'onglet est éprouvé par
// EcrituresTab.ventesFacturees.test.tsx ; ici, ce que l'onglet ne peut pas produire sur des lectures qui se tiennent — un
// geste que la base refuserait. Le refus se DIT avant le clic, le bouton est grisé, et rien ne part. Données FICTIVES.
const faux = vi.hoisted(() => ({ rpcs: [] as string[] }))
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (nom: string) => { faux.rpcs.push(nom); return Promise.resolve({ data: null, error: null }) } },
}))

function etats(): Extract<EtatsDesVentes, { etat: 'lus' }> {
  const r = etatsDesVentesFacturees({
    sources: {
      dossierId: 'd1',
      factures: [{
        id: 'f1', dossier_id: 'd1', statut: 'validee', type: 'facture', numero: 'F2025-0001', date_emission: '2025-11-10',
        tiers_nom: 'Client fictif', facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services',
        option_debits: false, date_prestation: null, montant_ttc: 120,
      }],
      lignes: [{ facture_id: 'f1', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
      encaissements: [], parts: [], mouvements: [], exemplaires: [],
    },
    brouillon: [], mode: 'engagement', plan: PLAN_PAR_DEFAUT, anneesValidees: [], ventesParLesFactures: true,
  })
  if (r.etat !== 'lus') throw new Error(r.motif)
  return r
}

describe('la section des ventes facturées, seule', () => {
  it('un geste que la base refuserait : le refus dit avant le clic, le bouton grisé, rien ne part', () => {
    const r = etats()
    expect(r.sources.map((s) => [s.cle, s.geste, s.refus])).toEqual([['facture|f1', 'ecrire', null]])
    const refusee = { ...r, sources: r.sources.map((s) => ({ ...s, refus: 'Refus fictif de la base.' })) }
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    render(<VentesFactureesEcritures etats={refusee} motifIncomplet={null} relecture={false} relire={async () => {}} lettrageDesFactures={new Map()} />)
    const ligne = screen.getByText(/^La facture F2025-0001/).closest('tr') as HTMLElement
    expect(within(ligne).getByText('Refus fictif de la base.')).toBeTruthy()
    const bouton = within(ligne).getByRole('button', { name: 'Écrire' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toBe('Refus fictif de la base.')
    fireEvent.click(bouton)
    expect(faux.rpcs).toEqual([])
  })

  it('« Changer le compte » ne s’ouvre pas pendant une relecture : les états affichés sont ceux d’avant', () => {
    const r = etatsDesVentesFacturees({
      sources: {
        dossierId: 'd1',
        factures: [{
          id: 'f1', dossier_id: 'd1', statut: 'validee', type: 'facture', numero: 'F2025-0001', date_emission: '2025-11-10',
          tiers_nom: 'Client fictif', facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services',
          option_debits: false, date_prestation: null, montant_ttc: 120,
        }],
        lignes: [{ facture_id: 'f1', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
        encaissements: [{
          id: 'e1', dossier_id: 'd1', facture_id: 'f1', date_encaissement: '2025-11-20', montant: 120, moyen: 'compensation',
          ligne_bancaire_id: null, annule_id: null, cree_le: '2025-11-20T10:00:00Z', retire_le: null, compte_contrepartie: '467100',
          cree_par: null,
        }],
        parts: [{ encaissement_id: 'e1', dossier_id: 'd1', taux: 20, montant: 120 }], mouvements: [], exemplaires: [],
      },
      brouillon: [], mode: 'tresorerie', plan: PLAN_PAR_DEFAUT, anneesValidees: [], ventesParLesFactures: true,
    })
    const vue = render(<VentesFactureesEcritures etats={r} motifIncomplet={null} relecture relire={async () => {}} lettrageDesFactures={new Map()} />)
    const changer = screen.getByRole('button', { name: 'Changer le compte' })
    expect(changer.hasAttribute('disabled')).toBe(true)
    fireEvent.click(changer)
    expect(screen.queryByRole('textbox')).toBeNull()
    vue.rerender(<VentesFactureesEcritures etats={r} motifIncomplet={null} relecture={false} relire={async () => {}} lettrageDesFactures={new Map()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Changer le compte' }))
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(faux.rpcs).toEqual([])
  })

  it('sans refus, le même état offre son geste', () => {
    render(<VentesFactureesEcritures etats={etats()} motifIncomplet={null} relecture={false} relire={async () => {}} lettrageDesFactures={new Map()} />)
    expect(screen.getByRole('button', { name: 'Écrire' }).hasAttribute('disabled')).toBe(false)
  })
})
