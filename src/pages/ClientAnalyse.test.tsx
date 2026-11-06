import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientAnalyse from './ClientAnalyse'
import { MUET_ETAT, MUET_VENTES, RIEN_D_OUVERT, SOURCE_CHIFFRE_D_AFFAIRES } from '../lib/analyseClient'
import { JOURNAL_MUET_DU_CLIENT, LIMITE_DU_JOURNAL_DU_CLIENT } from '../lib/journalDeLEspaceClient'
import { formatMoney } from '../lib/format'

// « MON ANALYSE » (étape B9a) : rien avant le retour des lectures ; les cases relues à la base d'abord, et une section ne se
// lit que sous la case que la base ET l'écran ouvrent ; un indicateur dont la liste revient en partie est MUET, jamais
// « 0 » ; le CSV d'un état. Le faux client APPLIQUE les filtres d'égalité (src/test/filtresPostgrest.ts) et annonce un
// `count`, qu'un test peut gonfler pour jouer une lecture partielle.

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  // Un total annoncé plus grand que les lignes rendues : `lireTout` dit la lecture partielle.
  comptesGonfles: {} as Record<string, number>,
  demandes: [] as string[],
  droitsContexte: {} as Record<string, { ventes: boolean; banque: boolean; caisse: boolean }>,
  droitsBase: { ventes: true, banque: true, caisse: false } as Record<string, boolean>,
  porte: null as Promise<void> | null,
  telecharges: [] as { nom: string; contenu: string }[],
}))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  const repondre = async <T,>(rendre: () => T) => { await faux.porte; return rendre() }
  return {
    supabase: {
      rpc: (nom: string) => {
        faux.demandes.push(`rpc:${nom}`)
        return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => repondre(() => ({ data: faux.droitsBase, error: null })).then(suite, echec) }
      },
      from: (table: string) => {
        faux.demandes.push(table)
        // Une jointure filtrée (`factures_emises.dossier_id`) se lit sur la colonne que le jeu d'essai porte sous ce chemin.
        const predicats: ReturnType<typeof predicatEq>[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const chaine: Record<string, unknown> = {
          select: () => chaine,
          eq: (c: string, v: unknown) => { predicats.push(predicatEq(c, v)); return chaine },
          in: (c: string, v: readonly unknown[]) => { predicats.push(predicatIn(c, v)); return chaine },
          // `.gte(colonne, jour)` : une date ISO se compare en texte à un instant ISO ; une colonne nulle n'est pas retenue.
          gte: (c: string, v: string) => { predicats.push((l) => typeof l[c] === 'string' && (l[c] as string) >= v); return chaine },
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => repondre(() => {
            const lignes = filtrer(faux.parTable[table] ?? [], predicats)
            return { data: lignes.slice(debut, fin + 1), error: null, count: lignes.length + (faux.comptesGonfles[table] ?? 0) }
          }).then(suite, echec),
        }
        return chaine
      },
    },
  }
})

vi.mock('../lib/fec', async (original) => ({
  ...await original<typeof import('../lib/fec')>(),
  telechargerTexte: (nom: string, contenu: string) => { faux.telecharges.push({ nom, contenu }) },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'd1', droitsParDossier: faux.droitsContexte, session: { user: { id: MOI } } }),
}))

// Les comptes du journal (étape B9c) : jamais rendus à l'écran, quel que soit l'auteur.
const MOI = 'u-client-connecte'
const MEMBRE = 'u-membre-du-cabinet'
const AUTRE = 'u-autre-acces'

const FACTURE = {
  dossier_id: 'd1', statut: 'validee', type: 'facture', facture_origine_id: null, numero: 'F1', source_de_la_vente: false,
  acompte: false, montant_tva: 200, tiers_nom: 'Atelier Fictif',
}

function poser() {
  faux.parTable = {
    factures_emises: [
      { ...FACTURE, id: 'f1', date_emission: '2026-11-02', date_echeance: '2026-10-31', montant_ht: 1000, montant_ttc: 1200 },
      { ...FACTURE, id: 'f0', date_emission: '2025-11-03', date_echeance: null, montant_ht: 400, montant_ttc: 480, tiers_nom: 'Boutique Essai' },
      // Une autre société : jamais comptée ici.
      { ...FACTURE, id: 'fx', dossier_id: 'd2', date_emission: '2026-11-02', date_echeance: null, montant_ht: 9999, montant_ttc: 9999 },
    ],
    facture_lignes: [
      { id: 'l1', facture_id: 'f1', ordre: 1, designation: 'Séance', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20, article_id: 'art-1', reference: 'SEA', reprise_facture_id: null, 'factures_emises.dossier_id': 'd1' },
      { id: 'l0', facture_id: 'f0', ordre: 1, designation: 'Séance', quantite: 1, prix_unitaire_ht: 400, taux_tva: 20, article_id: 'art-1', reference: null, reprise_facture_id: null, 'factures_emises.dossier_id': 'd1' },
      { id: 'lx', facture_id: 'fx', ordre: 1, designation: 'Autre', quantite: 1, prix_unitaire_ht: 9999, taux_tva: 0, article_id: null, reference: null, reprise_facture_id: null, 'factures_emises.dossier_id': 'd2' },
    ],
    encaissements_factures: [
      { id: 'e0', dossier_id: 'd1', facture_id: 'f0', date_encaissement: '2025-11-10', montant: 480, moyen: 'virement', ligne_bancaire_id: null, annule_id: null, cree_par: null, cree_le: '2025-11-10T10:00:00Z', retire_le: null },
    ],
    encaissements_factures_taux: [{ dossier_id: 'd1', encaissement_id: 'e0', taux: 20, montant: 480 }],
    controles_releves_bancaires: [
      { id: 'c1', dossier_id: 'd1', solde_final: 4321.5, coherent: true, periode_fin: '2026-10-31', created_at: '2026-11-01T08:00:00Z' },
      { id: 'cx', dossier_id: 'd2', solde_final: 1, coherent: true, periode_fin: '2026-11-30', created_at: '2026-11-01T08:00:00Z' },
    ],
    // Le journal (étape B9c) : des gestes du client connecté, d'un autre accès, du cabinet, et d'une autre société.
    pieces: [
      { id: 'p1', dossier_id: 'd1', uploaded_by: MOI, created_at: '2026-11-05T09:00:00Z' },
      { id: 'p2', dossier_id: 'd1', uploaded_by: AUTRE, created_at: '2026-11-04T09:00:00Z' },
      { id: 'p-vieille', dossier_id: 'd1', uploaded_by: MOI, created_at: '2026-09-01T09:00:00Z' },
      { id: 'px', dossier_id: 'd2', uploaded_by: MOI, created_at: '2026-11-05T09:30:00Z' },
    ],
    piece_commentaires: [{ id: 'c1', dossier_id: 'd1', auteur_id: MEMBRE, origine: 'cabinet', created_at: '2026-11-03T09:00:00Z' }],
    justificatifs_proposes: [
      { id: 'j1', dossier_id: 'd1', auteur_id: MOI, origine: 'client', created_at: '2026-11-02T09:00:00Z', retire_par: null, retire_le: null },
    ],
    emails_envoyes: [
      { id: 'm1', dossier_id: 'd1', type: 'facture', envoye_par: MEMBRE, created_at: '2026-11-01T09:00:00Z' },
      { id: 'm2', dossier_id: 'd1', type: 'relance', envoye_par: MEMBRE, created_at: '2026-11-01T09:30:00Z' },
    ],
  }
  faux.comptesGonfles = {}
  faux.demandes = []
  faux.droitsContexte = { d1: { ventes: true, banque: true, caisse: false } }
  faux.droitsBase = { ventes: true, banque: true, caisse: false }
  faux.porte = null
  faux.telecharges = []
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T10:00:00Z'))
  poser()
})
afterEach(() => { vi.useRealTimers() })

const page = () => render(<MemoryRouter><ClientAnalyse /></MemoryRouter>)
const region = (nom: string) => screen.getByRole('region', { name: nom })

describe('« Mon analyse »', () => {
  it('ne dit rien avant le retour des lectures, puis ses indicateurs et ses états', async () => {
    let ouvrir = () => {}
    faux.porte = new Promise<void>((r) => { ouvrir = r })
    page()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(/€/)).toBeNull()
    expect(screen.queryByText(SOURCE_CHIFFRE_D_AFFAIRES)).toBeNull()
    await act(async () => { ouvrir() })
    await screen.findByText('Tes indicateurs')
    expect(screen.queryByText('Chargement…')).toBeNull()

    const ca = region('Chiffre d’affaires facturé').textContent ?? ''
    expect(ca).toContain(`Novembre 2026 : ${formatMoney(1000)}`)
    expect(ca).toContain(`novembre 2025 : ${formatMoney(400)}, +150 %`)
    expect(ca).toContain(SOURCE_CHIFFRE_D_AFFAIRES)
    const du = region('Ce que tes clients te doivent').textContent ?? ''
    expect(du).toContain(`En retard : ${formatMoney(1200)}`)
    expect(du).toContain(`Total : ${formatMoney(1200)} (1 facture)`)
    expect(region('Ta trésorerie').textContent).toContain(`Solde au relevé du 31/10/2026 : ${formatMoney(4321.5)}`)

    const parClient = within(region('Par client'))
    expect(parClient.getByText('Atelier Fictif')).toBeTruthy()
    expect(parClient.queryByText('Boutique Essai')).toBeNull()
    expect(region('Par article').textContent).toContain('Séance (SEA)')
    // La société d'à côté n'est comptée nulle part.
    expect(document.body.textContent).not.toContain(formatMoney(9999))
  })

  it('un indicateur muet sur une lecture partielle des factures, jamais « 0 » ; la trésorerie, d’une autre source, reste dite', async () => {
    faux.comptesGonfles = { factures_emises: 1 }
    page()
    await screen.findByText('Tes indicateurs')
    expect(within(region('Chiffre d’affaires facturé')).getByText(MUET_VENTES)).toBeTruthy()
    expect(within(region('Ce que tes clients te doivent')).getByText(MUET_VENTES)).toBeTruthy()
    expect(region('Chiffre d’affaires facturé').textContent).not.toContain(formatMoney(0))
    expect(within(region('Par client')).getByText(MUET_ETAT)).toBeTruthy()
    expect(within(region('Par mois')).getByText(MUET_ETAT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Exporter (CSV)' })).toBeNull()
    expect(region('Ta trésorerie').textContent).toContain(formatMoney(4321.5))
  })

  it('le registre lu en partie fait taire « ce que tes clients te doivent », pas le chiffre d’affaires', async () => {
    faux.comptesGonfles = { encaissements_factures: 1 }
    page()
    await screen.findByText('Tes indicateurs')
    expect(within(region('Ce que tes clients te doivent')).getByText(MUET_VENTES)).toBeTruthy()
    expect(region('Chiffre d’affaires facturé').textContent).toContain(formatMoney(1000))
  })

  it('sans la case « Ventes », aucun indicateur ni état des ventes, et aucune vente demandée', async () => {
    faux.droitsContexte = { d1: { ventes: false, banque: true, caisse: false } }
    page()
    await screen.findByText('Tes indicateurs')
    expect(screen.queryByRole('region', { name: 'Chiffre d’affaires facturé' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Ce que tes clients te doivent' })).toBeNull()
    expect(screen.queryByText('Tes ventes en détail')).toBeNull()
    expect(faux.demandes).not.toContain('factures_emises')
    expect(region('Ta trésorerie').textContent).toContain(formatMoney(4321.5))
  })

  it('la case « Ventes » retirée en base depuis la connexion : rien des ventes ne se lit ni ne se dit', async () => {
    faux.droitsBase = { ventes: false, banque: true, caisse: false }
    page()
    await screen.findByText('Tes indicateurs')
    expect(faux.demandes[0]).toBe('rpc:droits_sur_le_dossier')
    expect(faux.demandes).not.toContain('factures_emises')
    expect(faux.demandes).not.toContain('facture_lignes')
    expect(screen.queryByText('Tes ventes en détail')).toBeNull()
  })

  it('sans la case « Banque », la trésorerie ne se lit pas', async () => {
    faux.droitsContexte = { d1: { ventes: true, banque: false, caisse: false } }
    page()
    await screen.findByText('Tes indicateurs')
    expect(screen.queryByRole('region', { name: 'Ta trésorerie' })).toBeNull()
    expect(faux.demandes).not.toContain('controles_releves_bancaires')
  })

  it('« Ce qui a bougé » : rien avant les lectures, puis les évènements de la société, sans aucun nom', async () => {
    let ouvrir = () => {}
    faux.porte = new Promise<void>((r) => { ouvrir = r })
    page()
    expect(screen.queryByRole('region', { name: 'Ce qui a bougé' })).toBeNull()
    expect(screen.queryByText(/Rien n’a bougé|évènement/)).toBeNull()
    await act(async () => { ouvrir() })
    const section = await screen.findByRole('region', { name: 'Ce qui a bougé' })
    expect(within(section).getByText('Ce qui a bougé depuis le 08/10/2026')).toBeTruthy()
    const lignes = within(section).getAllByRole('listitem').map((l) => l.textContent)
    expect(lignes).toEqual([
      'Pièce déposée par toi, le 05/11/2026',
      'Pièce déposée, le 04/11/2026',
      'Précision sur une pièce par ton cabinet, le 03/11/2026',
      'Justificatif proposé pour un mouvement par toi, le 02/11/2026',
      'E-mail envoyé, le 01/11/2026',
    ])
    expect(within(section).getByText('5 évènements.')).toBeTruthy()
    expect(within(section).getByText(LIMITE_DU_JOURNAL_DU_CLIENT)).toBeTruthy()
    // Aucun compte rendu, quel que soit l'auteur ; la relance du cabinet n'est pas demandée.
    for (const compte of [MOI, MEMBRE, AUTRE]) expect(document.body.textContent).not.toContain(compte)
    expect(faux.demandes).not.toContain('memberships')
  })

  it('« Ce qui a bougé » muet sur une lecture partielle, sans rien lister ; les indicateurs restent dits', async () => {
    faux.comptesGonfles = { pieces: 1 }
    page()
    const section = await screen.findByRole('region', { name: 'Ce qui a bougé' })
    expect(within(section).getByText(JOURNAL_MUET_DU_CLIENT)).toBeTruthy()
    expect(within(section).queryByRole('list')).toBeNull()
    expect(section.textContent).not.toContain('Pièce déposée')
    expect(region('Chiffre d’affaires facturé').textContent).toContain(formatMoney(1000))
  })

  it('sans « Banque » en base, aucun évènement de la banque n’est lu ni dit, et l’écran dit ce qu’il ne montre pas', async () => {
    faux.droitsBase = { ventes: true, banque: false, caisse: false }
    page()
    const section = await screen.findByRole('region', { name: 'Ce qui a bougé' })
    await within(section).findByText('4 évènements.')
    expect(section.textContent).not.toContain('Justificatif')
    expect(faux.demandes).not.toContain('justificatifs_proposes')
    expect(faux.demandes).not.toContain('precisions_mouvements')
    expect(faux.demandes).not.toContain('operations_caisse')
    expect(within(section).getByText('Ton accès n’ouvre ni ta banque ni ta caisse : ce qui s’y fait n’y paraît pas.')).toBeTruthy()
  })

  it('sans aucune case, « Ce qui a bougé » montre encore les pièces de la société', async () => {
    faux.droitsBase = { ventes: false, banque: false, caisse: false }
    page()
    await screen.findByText(RIEN_D_OUVERT)
    const section = await screen.findByRole('region', { name: 'Ce qui a bougé' })
    expect(within(section).getAllByRole('listitem').map((l) => l.textContent))
      .toEqual(['Pièce déposée par toi, le 05/11/2026', 'Pièce déposée, le 04/11/2026', 'Précision sur une pièce par ton cabinet, le 03/11/2026'])
    expect(faux.demandes).not.toContain('emails_envoyes')
  })

  it('exporte un état en CSV : BOM UTF-8, l’année dans le nom, les lignes de l’état', async () => {
    page()
    await screen.findByText('Tes indicateurs')
    fireEvent.click(within(region('Par client')).getByRole('button', { name: 'Exporter (CSV)' }))
    expect(faux.telecharges).toHaveLength(1)
    const [{ nom, contenu }] = faux.telecharges
    expect(nom).toBe('ventes-par-client-2026.csv')
    expect(contenu.startsWith('﻿')).toBe(true)
    expect(contenu.slice(1).split('\r\n')).toEqual(['Client;Documents;Chiffre d\'affaires HT 2026', 'Atelier Fictif;1;1000,00'])
    // L'année d'avant se choisit, et l'état la suit.
    fireEvent.change(screen.getByLabelText('Année'), { target: { value: '2025' } })
    expect(within(region('Par client')).getByText('Boutique Essai')).toBeTruthy()
  })
})
