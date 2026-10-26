import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ClientVentes from './ClientVentes'
import { SOURCE_DE_TES_VENTES } from '../lib/sourceDeLaVente'

// « MES VENTES » (espace client, étape P4a) : l'écran lit la société affichée et ses cases à la base AVANT d'offrir quoi
// que ce soit. Ce que ces cas gardent : « Chargement… » d'abord ; l'onglet Factures en mode client, avec la société lue et
// le droit « Banque » tel que la BASE le voit ; une lecture ratée, une société absente, des droits illisibles ou une case
// « Ventes » retirée depuis la connexion n'offrent AUCUN geste ; sans société affichée, rien n'est demandé.
// L'onglet est doublé : ses propres tests (FacturesTabClient.test.tsx) le gardent en mode client.

const faux = vi.hoisted(() => ({
  societe: null as Record<string, unknown> | null,
  refusSociete: null as string | null,
  droits: { cabinet: false, membre: true, ventes: true, banque: false } as unknown,
  refusDroits: null as string | null,
  // Les réponses restent EN ATTENTE jusqu'à ce que le cas les libère.
  retenir: false,
  enAttente: [] as (() => void)[],
  demandes: [] as string[],
  dossierActifId: 'd1' as string | null,
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: faux.dossierActifId, droitsParDossier: { d1: { ventes: true, banque: true } } }),
}))

vi.mock('./dossier/FacturesTab', () => ({
  default: (p: Record<string, unknown>) => (
    <p>
      Onglet Factures — {String(p.espace)} — banque {String(p.banque)} — {String(p.dossierNom)} — {String(p.statutTva)} —
      {' '}{String(p.dossierAdresse)} — numéro {String(p.numeroTvaAttribue)} — débits {String(p.tvaSurDebits)}
      {'onAdresseUpdated' in p ? ' — adresse du dossier modifiable' : ''} — réglage {JSON.stringify(p.reglageDesVentes)}
    </p>
  ),
}))

vi.mock('../lib/supabase', async () => {
  const { predicatEq, filtrer } = await import('../test/filtresPostgrest')
  const attendre = () => (faux.retenir ? new Promise<void>((r) => { faux.enAttente.push(r) }) : Promise.resolve())
  return {
    supabase: {
      from: (table: string) => {
        if (table !== 'dossiers') throw new Error(`Table non attendue : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let colonnes = ''
        const c = {
          select: (liste: string) => { colonnes = liste; return c },
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          maybeSingle: async () => {
            faux.demandes.push(`dossiers ${colonnes}`)
            await attendre()
            if (faux.refusSociete) return { data: null, error: { message: faux.refusSociete } }
            const lignes = filtrer(faux.societe ? [faux.societe] : [], predicats)
            return { data: lignes[0] ?? null, error: null }
          },
        }
        return c
      },
      rpc: async (nom: string, args: { p_dossier_id: string }) => {
        faux.demandes.push(`rpc:${nom}:${args.p_dossier_id}`)
        await attendre()
        if (faux.refusDroits) return { data: null, error: { message: faux.refusDroits } }
        return { data: faux.droits, error: null }
      },
    },
  }
})

const SOCIETE = {
  id: 'd1', nom: 'Atelier fictif', siret: '12345678200010', adresse: '1 rue Fictive, 75001 Paris', statut_tva: 'redevable',
  article_exoneration: null, numero_tva_attribue: false, tva_sur_debits: true, ventes_par_les_factures: false,
  mode_comptable: 'tresorerie',
}

function monter() {
  return render(<MemoryRouter><ClientVentes /></MemoryRouter>)
}

beforeEach(() => {
  faux.societe = { ...SOCIETE }
  faux.refusSociete = null
  faux.droits = { cabinet: false, membre: true, ventes: true, banque: false }
  faux.refusDroits = null
  faux.retenir = false
  faux.enAttente = []
  faux.demandes = []
  faux.dossierActifId = 'd1'
})

describe('ClientVentes — la société lue, puis l’onglet Factures en mode client', () => {
  it('« Chargement… » avant toute réponse, sans rien offrir ; puis l’onglet, avec la société et la banque de la base', async () => {
    faux.retenir = true
    monter()
    screen.getByText('Chargement…')
    expect(screen.queryByText(/Onglet Factures/)).toBeNull()
    expect(screen.queryAllByRole('button')).toEqual([])
    // Les deux lectures partent ensemble : la société, colonnes nommées, et les cases du dossier affiché.
    expect(faux.demandes).toEqual([
      'dossiers nom, siret, adresse, statut_tva, article_exoneration, numero_tva_attribue, tva_sur_debits, ventes_par_les_factures, mode_comptable',
      'rpc:droits_sur_le_dossier:d1',
    ])
    await act(async () => { faux.retenir = false; for (const r of faux.enAttente.splice(0)) r() })
    const onglet = await screen.findByText(/Onglet Factures/)
    expect(onglet.textContent).toBe(
      'Onglet Factures — client — banque false — Atelier fictif — redevable — 1 rue Fictive, 75001 Paris — numéro false — débits true'
        + ' — réglage {"etat":"non_bascule","anneesValidees":"illisibles"}',
    )
    screen.getByRole('heading', { name: 'Mes ventes' })
    // « Factures » et « Règlements » sont nommés par le sélecteur de l'onglet (étape A3), plus par un titre de la page.
    expect(screen.queryByRole('heading', { name: 'Factures' })).toBeNull()
  })

  it('« Banque » telle que la BASE la voit : vraie, elle passe à l’onglet', async () => {
    faux.droits = { cabinet: false, membre: true, ventes: true, banque: true }
    monter()
    expect((await screen.findByText(/Onglet Factures/)).textContent).toContain('— client — banque true —')
  })

  it('un statut de TVA à préciser passe tel quel : c’est l’onglet qui le dit', async () => {
    faux.societe = { ...SOCIETE, statut_tva: null, tva_sur_debits: null }
    monter()
    expect((await screen.findByText(/Onglet Factures/)).textContent).toContain('— null — 1 rue')
  })
})

// LA SOURCE DE SES VENTES (étape VF8c), lue avec la société : basculée, l'onglet la reçoit avec les exercices validés
// illisibles — le client ne les lit pas, la base juge la frontière ; une colonne absente se dit illisible, et le formulaire
// d'une facture n'offre alors pas la validation (FactureFormModalSource.test.tsx).
describe('ClientVentes — la source des ventes de la société', () => {
  it('basculée : le réglage, le modèle comptable, et les exercices validés illisibles', async () => {
    faux.societe = { ...SOCIETE, ventes_par_les_factures: true, mode_comptable: 'engagement' }
    monter()
    expect((await screen.findByText(/Onglet Factures/)).textContent)
      .toContain('— réglage {"etat":"bascule","modeComptable":"engagement","anneesValidees":"illisibles"}')
  })

  // La ligne de la source (étape VF8d) : dite au-dessus des factures d'une société basculée, et d'elle seule.
  it('basculée : la ligne dit au client que ses factures validées sont la source de ses ventes', async () => {
    faux.societe = { ...SOCIETE, ventes_par_les_factures: true }
    monter()
    await screen.findByText(/Onglet Factures/)
    const ligne = screen.getByText(SOURCE_DE_TES_VENTES)
    expect(ligne.compareDocumentPosition(screen.getByText(/Onglet Factures/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['pas basculée', { ventes_par_les_factures: false }],
    ['au réglage illisible', { ventes_par_les_factures: null }],
    ['basculée, au modèle comptable illisible', { ventes_par_les_factures: true, mode_comptable: null }],
  ])('%s : aucune ligne de la source', async (_cas, ecart) => {
    faux.societe = { ...SOCIETE, ...ecart }
    monter()
    await screen.findByText(/Onglet Factures/)
    expect(screen.queryByText(SOURCE_DE_TES_VENTES)).toBeNull()
  })

  it('aucune ligne de la source avant la lecture de la société', () => {
    faux.retenir = true
    faux.societe = { ...SOCIETE, ventes_par_les_factures: true }
    monter()
    expect(screen.queryByText(SOURCE_DE_TES_VENTES)).toBeNull()
  })

  it('une colonne absente n’est pas « pas basculé » : le réglage illisible, avec son motif', async () => {
    const { ventes_par_les_factures: _omise, ...sansReglage } = SOCIETE
    faux.societe = sansReglage
    monter()
    expect((await screen.findByText(/Onglet Factures/)).textContent)
      .toContain('— réglage {"etat":"illisible","motif":"le réglage n’est pas lisible"}')
  })
})

describe('ClientVentes — une lecture ratée n’offre aucun geste', () => {
  it.each([
    ['la société refusée', () => { faux.refusSociete = 'permission denied for table dossiers' }, /ta société n’a pas pu être lue|permission denied/],
    ['la société absente', () => { faux.societe = null }, /ta société n’a pas été trouvée/],
    ['les droits refusés', () => { faux.refusDroits = 'fonction indisponible' }, /tes droits sur cette société n’ont pas pu être vérifiés \(fonction indisponible\)/],
    ['les droits illisibles', () => { faux.droits = [true] }, /tes droits sur cette société n’ont pas pu être vérifiés \(droits illisibles\)/],
  ])('%s : le motif dit, aucun onglet, aucun bouton', async (_cas, poser, motif) => {
    poser()
    monter()
    const message = await screen.findByText(/Tes factures ne s’affichent pas/)
    expect(message.textContent).toMatch(motif)
    expect(message.textContent).toContain('rien ne t’est proposé')
    expect(screen.queryByText(/Onglet Factures/)).toBeNull()
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryByText('Chargement…')).toBeNull()
  })

  it('la case « Ventes » retirée depuis la connexion : la base a raison, l’écran le dit et n’offre rien', async () => {
    faux.droits = { cabinet: false, membre: true, ventes: false, banque: true }
    monter()
    await screen.findByText(/Ton accès ne porte plus « Ventes » sur cette société/)
    expect(screen.queryByText(/Onglet Factures/)).toBeNull()
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})

describe('ClientVentes — sans société affichée', () => {
  it('sans société affichée, rien n’est demandé', () => {
    faux.dossierActifId = null
    monter()
    screen.getByText(/Aucune société ne t’est encore rattachée/)
    expect(faux.demandes).toEqual([])
  })
})
