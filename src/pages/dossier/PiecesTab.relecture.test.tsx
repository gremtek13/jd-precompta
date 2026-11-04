import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import PiecesTab from './PiecesTab'
import type { Piece } from '../../lib/types'
import { RAISON_SANS_MONTANT } from '../../lib/validationDeLaSelection'

// LA RELECTURE DU 04/11/2026 DANS JUSTIFICATIFS — les scénarios d'écran (`outils/relecture-pieces/validationEnLot.scenarios.test.tsx`),
// changés en gardes du comportement corrigé, sur un dossier qui n'a pas basculé (le praticien du MVP) :
//   - D7 : « Valider la sélection » annonçait 4 et en envoyait 3 ; la pièce sans montant sortait de la sélection sans un mot,
//     et la pièce sans date et celle de confiance basse partaient sans un regard. Désormais le bouton dit ce qui part, la pièce
//     écartée se nomme avant le clic avec sa raison, et la confirmation nomme ce qui part et mérite un regard ;
//   - D1 : le même achat entré deux fois se marque « Doublon probable » sur ses deux lignes, un filtre les montre, et la fiche
//     de chacune nomme l'autre.
// Le harnais de PiecesTab.validationEnLot.test.tsx, réduit. Données FICTIVES.

const D = 'dossier-de-test'
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
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
      eq: (colonne: string, v: unknown) => { if (colonne === 'id') ids.push(v); predicats.push(predicatEq(colonne, v)); return c },
      in: (colonne: string, valeurs: unknown[]) => { if (colonne === 'id') ids.push(...valeurs); predicats.push(predicatIn(colonne, valeurs)); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => { unique = true; return c },
      single: () => { unique = true; return c },
      update: (v: unknown) => { operation = 'update'; valeur = v; return c },
      insert: (v: unknown) => { operation = 'insert'; valeur = v; return c },
      delete: () => { operation = 'delete'; return c },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
        if (operation === 'update') {
          faux.majs.push({ table, valeur, ids: [...ids] })
          faux.parTable[table] = (faux.parTable[table] ?? []).map((l) => (ids.includes(l.id) ? { ...l, ...(valeur as object) } : l))
          return Promise.resolve({ data: null, error: null }).then(suite, echec)
        }
        if (operation !== 'select' || unique) return Promise.resolve({ data: null, error: null }).then(suite, echec)
        const toutes = filtrer(faux.parTable[table] ?? [], predicats)
        return Promise.resolve({ data: toutes.slice(debut, fin + 1), error: null, count: toutes.length }).then(suite, echec)
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
    date_piece: '2025-06-02', tiers: 'Fournisseur fictif', montant_ht: null, montant_tva: null, montant_ttc: 42, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'a_valider', notes: null, confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    vente_hors_des_factures: false, created_at: '2026-11-20T09:00:00Z', updated_at: '2026-11-20T09:00:00Z', ...o,
  }
}

function rendre(defaut: 'toutes' | number = 'toutes') {
  return render(
    <FournisseurPanneauDroit>
      <AnneeProvider defaut={defaut}>
        <PiecesTab dossierId={D} ventesParLesFactures={false} />
      </AnneeProvider>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const espaces = (s: string) => s.replace(/\s/g, ' ')
const validees = () => faux.majs.filter((m) => m.table === 'pieces').map((m) => m.ids)
async function toutSelectionner() {
  const bouton = await screen.findByRole('button', { name: 'Tout sélectionner' })
  await act(async () => { bouton.click() })
}

let confirmations: string[] = []
let reponse = true
beforeEach(() => {
  faux.majs = []
  confirmations = []
  reponse = true
  vi.spyOn(window, 'confirm').mockImplementation((m) => { confirmations.push(String(m)); return reponse })
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('D7 — « Valider la sélection » dit ce qui part, et ce qui ne part pas', () => {
  // Quatre pièces déposées pour la répétition : une lue entière ; une dont la lecture n'a rendu aucune date ; une de confiance
  // basse ; une dont la lecture a échoué (aucun montant). Quatre fournisseurs distincts.
  const QUATRE = [
    piece({ id: 'lue', tiers: 'ALPHA' }),
    piece({ id: 'sans-date', date_piece: null, tiers: 'BRAVO' }),
    piece({ id: 'basse', confiance: 'basse', montant_ttc: 4120, tiers: 'CHARLIE' }),
    piece({ id: 'sans-montant', montant_ttc: null, confiance: null, tiers: 'DELTA' }),
  ]
  beforeEach(() => { faux.parTable = { pieces: QUATRE.map((p) => ({ ...p })) as unknown as Record<string, unknown>[] } })

  it('le bouton compte ce qui part ; la pièce sans montant se nomme avant le clic ; la confirmation nomme la date et la confiance', async () => {
    rendre()
    await toutSelectionner()
    const bouton = screen.getByRole('button', { name: 'Valider la sélection (3 sur 4)' })
    const resume = screen.getByText((_, e) => e?.tagName === 'SUMMARY' && /ne se valide pas en lot/.test(e.textContent ?? ''))
    expect(espaces(resume.textContent ?? '')).toBe('1 pièce de la sélection ne se valide pas en lot : elle reste à valider.')
    const lignes = [...(resume.closest('details') as HTMLElement).querySelectorAll('li')].map((li) => espaces(li.textContent ?? ''))
    expect(lignes).toEqual([`sans-montant.pdf — ${RAISON_SANS_MONTANT}`])
    expect(faux.majs).toEqual([])

    // Deux clics du même rendu : une confirmation, un envoi.
    await act(async () => { bouton.click(); bouton.click() })
    expect(confirmations).toHaveLength(1)
    const texte = espaces(confirmations[0])
    expect(texte).toMatch(/^Valider 3 pièces \?/)
    expect(texte).toContain('2 d’entre elles méritent un regard avant :')
    expect(texte).toContain('• sans-date.pdf — sans date')
    expect(texte).toMatch(/• basse\.pdf — confiance basse de la lecture \(4 120,00 €\)/)
    expect(texte).not.toContain('lue.pdf')
    await waitFor(() => expect(validees()).toEqual([['lue', 'sans-date', 'basse']]))

    // La pièce sans montant reste sélectionnée, à valider : le bouton n'a plus rien à envoyer, et le dit.
    const reste = await screen.findByRole('button', { name: 'Valider la sélection (0 sur 1)' }) as HTMLButtonElement
    expect(reste.disabled).toBe(true)
    expect(faux.parTable.pieces.find((p) => p.id === 'sans-montant')?.statut).toBe('a_valider')
  })

  it('Annuler n’envoie rien, et relâche le verrou : un clic suivant redemande', async () => {
    reponse = false
    rendre()
    await toutSelectionner()
    const bouton = screen.getByRole('button', { name: 'Valider la sélection (3 sur 4)' })
    await act(async () => { bouton.click() })
    expect(confirmations).toHaveLength(1)
    expect(faux.majs).toEqual([])
    reponse = true
    await act(async () => { bouton.click() })
    expect(confirmations).toHaveLength(2)
    await waitFor(() => expect(validees()).toEqual([['lue', 'sans-date', 'basse']]))
  })

  it('une sélection sans rien à regarder part comme hier, sans confirmation', async () => {
    faux.parTable.pieces = faux.parTable.pieces.filter((p) => p.id === 'lue')
    rendre()
    await toutSelectionner()
    await act(async () => { screen.getByRole('button', { name: 'Valider la sélection (1)' }).click() })
    await waitFor(() => expect(validees()).toEqual([['lue']]))
    expect(confirmations).toEqual([])
  })
})

describe('D1 — le même achat entré deux fois se dit dans Justificatifs, et dans la fiche de chacune', () => {
  // Le PDF déposé par le cabinet, validé, et la photo du praticien, à valider, lue sans son fournisseur ; un achat sans
  // rapport, et une paire dont chaque pièce a son débit — deux achats identiques, qui se taisent.
  const PIECES = [
    piece({ id: 'pdf', nom_fichier: 'facture-2025-031.pdf', tiers: 'MEDICAL PLUS', montant_ttc: 86.4, date_piece: '2025-12-30', statut: 'validee' }),
    piece({ id: 'photo', nom_fichier: 'IMG_3001.jpg', tiers: null, montant_ttc: 86.4, date_piece: '2026-01-02' }),
    piece({ id: 'autre', tiers: 'PHARMACIE DU PORT', montant_ttc: 12.5 }),
    piece({ id: 'boite-1', tiers: 'ORANGE', montant_ttc: 19.99, statut: 'validee' }),
    piece({ id: 'boite-2', tiers: 'ORANGE', montant_ttc: 19.99, date_piece: '2025-06-03', statut: 'validee' }),
  ]
  const debit = (id: string, pieceId: string) => ({
    id, dossier_id: D, piece_id: pieceId, date: '2025-06-04', montant: -19.99, statut: 'rapprochee', reglement_groupe: false,
    encaissements_de_factures: false,
  })
  beforeEach(() => {
    faux.parTable = {
      pieces: PIECES.map((p) => ({ ...p })) as unknown as Record<string, unknown>[],
      lignes_bancaires: [debit('m1', 'boite-1'), debit('m2', 'boite-2')],
    }
  })

  it('la marque sur les deux lignes, le filtre qui les montre par-dessus l’exercice, et la fiche qui nomme l’autre', async () => {
    rendre(2025)
    // L'exercice 2025 ne montre que le PDF : sa ligne porte la marque, qui nomme la photo de 2026.
    await waitFor(() => expect(screen.getAllByText('Doublon probable')).toHaveLength(1))
    expect(screen.getByText('Doublon probable').getAttribute('title')).toMatch(/^Doublon probable de « IMG_3001\.jpg » \(fournisseur non lu, 02\/01\/2026, 86,40\s€\)/)
    const filtre = screen.getByRole('button', { name: 'Doublons probables (2)' })
    await act(async () => { filtre.click() })
    const lignes = [...document.querySelectorAll('tbody tr')]
    expect(lignes).toHaveLength(2)
    expect(lignes.map((tr) => within(tr as HTMLElement).queryByText('Doublon probable') !== null)).toEqual([true, true])
    // La fiche de la photo nomme le PDF.
    await act(async () => { (within(lignes[1] as HTMLElement).getAllByRole('cell')[1] as HTMLElement).click() })
    const note = await screen.findByRole('note')
    expect(espaces(note.textContent ?? '')).toContain('Doublon probable de « facture-2025-031.pdf » (MEDICAL PLUS, 30/12/2025, 86,40 €)')
  })
})

describe('D5 — sous « À valider », la pièce que rien n’a lue passe en tête, et le dit', () => {
  // L'ordre que la relecture a vu à l'écran : basse, haute, haute, NULLE — la pièce sans montant, en dernier.
  beforeEach(() => {
    faux.parTable = {
      pieces: [
        piece({ id: 'basse', confiance: 'basse', montant_ttc: 4120, tiers: 'CHARLIE', date_piece: '2025-06-05' }),
        piece({ id: 'haute-1', tiers: 'ALPHA', date_piece: '2025-06-04' }),
        piece({ id: 'haute-2', tiers: 'BRAVO', date_piece: '2025-06-03' }),
        piece({ id: 'non-lue', montant_ttc: null, confiance: null, tiers: 'DELTA', date_piece: '2025-06-02' }),
      ] as unknown as Record<string, unknown>[],
    }
  })

  // Une ligne se reconnaît à son tiers : la liste ne montre pas le nom du fichier.
  const tiersDesLignes = () => [...document.querySelectorAll('tbody tr td[data-libelle="Tiers"]')].map((td) => td.textContent?.trim())

  it('« Non lue » sur sa ligne, et en tête sous « À valider »', async () => {
    rendre()
    await screen.findByText('CHARLIE')
    const marque = screen.getByText('Non lue')
    expect(within(marque.closest('tr') as HTMLElement).getByText('DELTA')).toBeDefined()
    expect(screen.getAllByText(/^(Non lue|Montant non lu)$/)).toHaveLength(1)
    await act(async () => { screen.getByRole('button', { name: 'À valider' }).click() })
    expect(tiersDesLignes()).toEqual(['DELTA', 'CHARLIE', 'ALPHA', 'BRAVO'])
  })
})
