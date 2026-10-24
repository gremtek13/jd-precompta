import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import PiecesTab from './PiecesTab'
import type { Piece } from '../../lib/types'
import { REFUS_VALIDATION_D_UNE_VENTE } from '../../lib/exemplairesDesFactures'

// « VALIDER LA SÉLECTION » DEVANT LA GARDE G3 (ligne 28.65, chantier EC-Q3, étape VF6d ; lib/lotsDeLaJumelleInversee.ts). La
// sélection part en UNE mise à jour : dans un dossier basculé, une seule pièce de vente que G3 refuserait — ni désignée ni
// déclarée, ou que le pont rattache à une facture qu'elle ne désigne pas — faisait échouer la sélection entière. L'écran
// l'écarte AVANT le clic, dit combien et pourquoi sous les mots de la base, et n'envoie que le reste. Le plan est éprouvé à
// part ; ici, le CÂBLAGE : ce que le faux client voit partir, deux clics dans le même `act`, une lecture partielle, et un
// dossier qui n'a pas basculé, où rien ne change. Données FICTIVES.

const D = 'dossier-de-test'

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  // `table` → N : le serveur ne rend que N lignes en annonçant le vrai total (une lecture INCOMPLÈTE).
  muet: {} as Record<string, number>,
  // Chaque mise à jour qui part : la table, la valeur, les identifiants visés.
  majs: [] as { table: string; valeur: unknown; ids: unknown[] }[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    let operation = 'select'
    let unique = false
    let valeur: unknown = null
    const ids: unknown[] = []
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    const soi = () => c
    Object.assign(c, {
      select: soi, order: soi, neq: soi, gte: soi, lte: soi, lt: soi, gt: soi, is: soi, not: soi, or: soi, limit: soi,
      eq: (colonne: string, v: unknown) => {
        if (colonne === 'id') ids.push(v)
        if (colonne.startsWith('factures_emises.')) {
          const champ = colonne.slice('factures_emises.'.length)
          predicats.push((l) => (faux.parTable.factures_emises ?? []).some((f) => f.id === l.facture_id && f[champ] === v))
        } else predicats.push(predicatEq(colonne, v))
        return c
      },
      in: (colonne: string, valeurs: unknown[]) => {
        if (colonne === 'id') ids.push(...valeurs)
        predicats.push(predicatIn(colonne, valeurs))
        return c
      },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => { unique = true; return c },
      single: () => { unique = true; return c },
      update: (v: unknown) => { operation = 'update'; valeur = v; return c },
      insert: (v: unknown) => { operation = 'insert'; valeur = v; return c },
      delete: () => { operation = 'delete'; return c },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
        if (operation === 'update') {
          faux.majs.push({ table, valeur, ids: [...ids] })
          // Le serveur applique la mise à jour : la relecture qui suit la voit.
          faux.parTable[table] = (faux.parTable[table] ?? []).map((l) => (ids.includes(l.id) ? { ...l, ...(valeur as object) } : l))
          return Promise.resolve({ data: null, error: null }).then(suite, echec)
        }
        if (operation !== 'select' || unique) return Promise.resolve({ data: null, error: null }).then(suite, echec)
        const toutes = filtrer(faux.parTable[table] ?? [], predicats)
        const muet = faux.muet[table]
        return Promise.resolve({
          data: toutes.slice(debut, Math.min(fin + 1, muet ?? Number.MAX_SAFE_INTEGER)), error: null, count: toutes.length,
        }).then(suite, echec)
      },
    })
    return c
  }
  return {
    supabase: {
      from: (table: string) => chaine(table),
      rpc: () => Promise.resolve({ data: [], error: null }),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'non utilisé' } }) }) },
    },
  }
})
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ monCabinetId: 'cabinet-de-test' }) }))
vi.mock('../../lib/doublonsTexte', () => ({ chargerDoublonsDeTexte: async () => [] }))
vi.mock('../../lib/texteOcr', () => ({
  piecesAvecTexteOcr: async () => ({ avecTexte: new Set<string>(), erreur: null }),
  texteOcrDeLaPiece: async () => null,
  texteOcrExploitable: (texte: string | null | undefined) => texte?.trim() || null,
}))

function piece(o: Partial<Piece> & Pick<Piece, 'id'>): Piece {
  return {
    dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/${o.id}.pdf`, nom_fichier: `${o.id}.pdf`, storage_hash: null,
    date_piece: '2026-06-02', tiers: 'Client fictif', montant_ht: null, montant_tva: null, montant_ttc: 120, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'vente',
    statut: 'a_valider', notes: null, confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    vente_hors_des_factures: false, created_at: '2026-06-02T09:00:00Z', updated_at: '2026-06-02T09:00:00Z', ...o,
  }
}

// Une facture source, F2026-0021, transmise par la plateforme du client sous le flux 9.
const FACTURE = {
  id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0021', date_emission: '2026-05-20',
  emetteur_siret: '12345678900012', superpdp_invoice_id: null, tiers_nom: 'Librairie Rocher', montant_ttc: 120,
  source_de_la_vente: true, facture_origine_id: null, nature_operation: 'services', option_debits: false, date_prestation: null,
}

// Cinq pièces à valider : un achat ; une vente que rien ne marque ; l'exemplaire désigné de F2026-0021 ; la jumelle de
// F2026-0021, revenue de la plateforme et pas encore désignée ; une vente déclarée hors des factures de l'application.
const PIECES = [
  piece({ id: 'achat', type_piece: 'achat', tiers: 'Fournisseur fictif' }),
  piece({ id: 'vente-nue' }),
  piece({ id: 'exemplaire', facture_id: 'f1' }),
  piece({ id: 'jumelle', flux_hote: 'pa.exemple.fr', flux_id: 'flux-9' }),
  piece({ id: 'declaree', vente_hors_des_factures: true }),
]

function poser() {
  faux.muet = {}
  faux.majs = []
  faux.parTable = {
    pieces: PIECES.map((p) => ({ ...p })) as unknown as Record<string, unknown>[],
    factures_emises: [FACTURE],
    transmissions_factures: [{ id: 't1', dossier_id: D, facture_id: 'f1', canal: 'plateforme', hote: 'pa.exemple.fr', flux_id: 'flux-9' }],
  }
}

beforeEach(poser)
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function rendre(ventesParLesFactures: boolean) {
  return render(
    <FournisseurPanneauDroit>
      <AnneeProvider defaut="toutes">
        <PiecesTab dossierId={D} ventesParLesFactures={ventesParLesFactures} />
      </AnneeProvider>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const espaces = (s: string) => s.replace(/\s/g, ' ')
const mots = (cle: (typeof REFUS_VALIDATION_D_UNE_VENTE)[number]['cle'], ...valeurs: string[]) => {
  let modele: string = REFUS_VALIDATION_D_UNE_VENTE.find((r) => r.cle === cle)?.modele ?? ''
  for (const v of valeurs) modele = modele.replace('%', v)
  return modele
}

async function toutSelectionner() {
  const bouton = await screen.findByRole('button', { name: 'Tout sélectionner' })
  await act(async () => { bouton.click() })
}
const validees = () => faux.majs.filter((m) => m.table === 'pieces').map((m) => m.ids)
const resume = () => screen.queryAllByText((_, e) => e?.tagName === 'SUMMARY' && /ne se valid(?:e|ent) pas en lot/.test(e.textContent ?? ''))

describe('dans un dossier basculé : la sélection écarte ce que G3 refuserait, et le dit avant le clic', () => {
  it('combien, pourquoi ; seules les autres partent, en un envoi, et les écartées restent sélectionnées', async () => {
    rendre(true)
    await toutSelectionner()
    const bouton = screen.getByRole('button', { name: 'Valider la sélection (3 sur 5)' })
    const [r] = resume()
    expect(espaces(r.textContent ?? '')).toBe('2 pièces de la sélection ne se valident pas en lot : elles restent à valider.')
    const details = r.closest('details') as HTMLElement
    const lignes = [...details.querySelectorAll('li')].map((li) => espaces(li.textContent ?? ''))
    expect(lignes).toEqual([
      `vente-nue.pdf — ${mots('ni_designee_ni_declaree', 'vente-nue.pdf')}`,
      `jumelle.pdf — ${mots('pont_une_facture', 'jumelle.pdf', 'F2026-0021')}`,
    ])
    // Rien n'est parti avant le clic ; deux clics du même rendu n'envoient qu'une fois.
    expect(faux.majs).toEqual([])
    await act(async () => { bouton.click(); bouton.click() })
    await waitFor(() => expect(validees()).toEqual([['achat', 'exemplaire', 'declaree']]))
    expect(faux.majs[0].valeur).toEqual({ statut: 'validee' })
    // Les deux écartées restent sélectionnées, à valider : le bouton n'a plus rien à envoyer, et le dit.
    const reste = await screen.findByRole('button', { name: 'Valider la sélection (0 sur 2)' }) as HTMLButtonElement
    expect(reste.disabled).toBe(true)
    await act(async () => { reste.click() })
    expect(validees()).toHaveLength(1)
  })

  it('une sélection que G3 accepte entière : le bouton d’hier, aucune note', async () => {
    faux.parTable.pieces = faux.parTable.pieces.filter((p) => p.id !== 'vente-nue' && p.id !== 'jumelle')
    rendre(true)
    await toutSelectionner()
    const bouton = screen.getByRole('button', { name: 'Valider la sélection (3)' })
    expect(resume()).toEqual([])
    await act(async () => { bouton.click() })
    await waitFor(() => expect(validees()).toEqual([['achat', 'exemplaire', 'declaree']]))
  })

  it('les transmissions lues en partie : aucune pièce de vente ne part, l’achat si — la raison le dit', async () => {
    faux.muet = { transmissions_factures: 0 }
    rendre(true)
    await toutSelectionner()
    const bouton = screen.getByRole('button', { name: 'Valider la sélection (1 sur 5)' })
    expect(espaces(resume()[0].textContent ?? '')).toBe('4 pièces de la sélection ne se valident pas en lot : elles restent à valider.')
    expect(espaces((resume()[0].closest('details') as HTMLElement).textContent ?? ''))
      .toContain('Les factures émises du dossier ne sont pas lues en entier (')
    await act(async () => { bouton.click() })
    await waitFor(() => expect(validees()).toEqual([['achat']]))
  })

  it('les factures émises lues en partie : de même', async () => {
    faux.muet = { factures_emises: 0 }
    rendre(true)
    await toutSelectionner()
    screen.getByRole('button', { name: 'Valider la sélection (1 sur 5)' })
  })
})

describe('dans un dossier qui n’a pas basculé : comme hier', () => {
  it('toute la sélection part, en un envoi, sans note', async () => {
    rendre(false)
    await toutSelectionner()
    const bouton = screen.getByRole('button', { name: 'Valider la sélection (5)' })
    expect(resume()).toEqual([])
    await act(async () => { bouton.click() })
    await waitFor(() => expect(validees()).toEqual([['achat', 'vente-nue', 'exemplaire', 'jumelle', 'declaree']]))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Valider la sélection/ })).toBeNull())
  })
})
