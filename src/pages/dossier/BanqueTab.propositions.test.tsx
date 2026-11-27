import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import { COMPTE_BANCAIRE_D_ESSAI, compteBancaireDEssai } from '../../test/compteBancaireDEssai'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { LigneBancaire, Piece } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'

// LES PROPOSITIONS DE LA LISTE SUIVENT LEURS DONNÉES, ET SEULEMENT ELLES (le banc de charge, 27/11/2026 ;
// lib/propositionsDuReleve.ts). La pièce proposée, l'échéance et la récurrence de chaque mouvement se calculent une fois, dans
// un `useMemo` de l'onglet Banque : une frappe dans la recherche ne les relance plus — elle ne filtre que l'affichage —, et une
// relecture qui change une donnée les relance : la pastille « suggestion » et la fiche la suivent, jamais une valeur d'avant.
// La table est comptée. La règle est éprouvée à part (lib/propositionsDuReleve.test.ts). Données FICTIVES.

const D = 'dossier-de-test'

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  // Chaque table des propositions bâtie par l'onglet.
  tables: 0,
}))

vi.mock('../../lib/propositionsDuReleve', async (original) => {
  const vrai = await original<typeof import('../../lib/propositionsDuReleve')>()
  return {
    ...vrai,
    propositionsDuReleve: (...args: Parameters<typeof vrai.propositionsDuReleve>) => { faux.tables++; return vrai.propositionsDuReleve(...args) },
  }
})
vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))
vi.mock('../../lib/depot', () => ({ ouvrirJustificatif: async () => {} }))

// Le faux client APPLIQUE les mises à jour d'un mouvement qu'un geste vise (`.eq('id')`), comme la base : la relecture qui suit
// rend le relevé tel que le geste l'a laissé.
vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    let operation = 'select'
    let unique = false
    let valeur: Record<string, unknown> = {}
    const ids: unknown[] = []
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    const soi = () => c
    Object.assign(c, {
      select: soi, order: soi, neq: soi, gte: soi, lte: soi, lt: soi, gt: soi, is: soi, not: soi, or: soi, limit: soi,
      eq: (colonne: string, v: unknown) => { if (colonne === 'id') ids.push(v); predicats.push(predicatEq(colonne, v)); return c },
      in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => { unique = true; return c },
      single: () => { unique = true; return c },
      update: (v: Record<string, unknown>) => { operation = 'update'; valeur = v; return c },
      insert: (v: Record<string, unknown>) => { operation = 'insert'; valeur = v; return c },
      upsert: (v: Record<string, unknown>) => { operation = 'upsert'; valeur = v; return c },
      delete: () => { operation = 'delete'; return c },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
        if (operation === 'update') {
          const visees = filtrer(faux.parTable[table] ?? [], predicats)
          faux.parTable[table] = (faux.parTable[table] ?? []).map((l) => (visees.includes(l) ? { ...l, ...valeur } : l))
          const rendu = unique ? (visees[0] ? { id: visees[0].id } : null) : null
          return Promise.resolve({ data: rendu, error: null, count: visees.length }).then(suite, echec)
        }
        if (operation !== 'select') return Promise.resolve({ data: null, error: null }).then(suite, echec)
        if (unique) return Promise.resolve({ data: null, error: null }).then(suite, echec)
        const toutes = filtrer(faux.parTable[table] ?? [], predicats)
        return Promise.resolve({ data: toutes.slice(debut, fin + 1), error: null, count: toutes.length }).then(suite, echec)
      },
    })
    return c
  }
  const functions = {
    invoke: async (nom: string) => {
      if (nom === 'banque-connexion') return { data: { configuree: false, connexion: null }, error: null }
      if (nom === 'plateforme-agreee') return { data: { connexion: null }, error: null }
      throw new Error(`Appel de fonction non attendu : ${nom}`)
    },
  }
  return { supabase: { from: (table: string) => chaine(table), rpc: () => Promise.resolve({ data: null, error: null }), functions } }
})

function mouvement(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire {
  return {
    dossier_id: D, compte_bancaire_id: COMPTE_BANCAIRE_D_ESSAI, date: '2026-06-02', montant: -100, libelle: 'PRLV SEPA FICTIF', libelle_brut: null,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
    reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-06-02T09:00:00Z',
    encaissements_de_factures: false, ...o,
  }
}

function piece(o: Partial<Piece> & Pick<Piece, 'id'>): Piece {
  return {
    dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/p.pdf`, nom_fichier: 'p.pdf', storage_hash: null,
    date_piece: '2026-06-01', tiers: 'Atelier fictif', montant_ht: null, montant_tva: null, montant_ttc: 100, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    created_at: '2026-06-01T09:00:00Z', updated_at: '2026-06-01T09:00:00Z', ...o,
  }
}

// Un prélèvement de 100 € que la pièce d'Atelier fictif justifie ; un abonnement de 45 € du 10 de chaque mois, déjà ignoré en
// mars (avril reste à traiter) ; son mois de juin, à traiter ; un mouvement que rien ne propose. L'onglet s'ouvre sur les
// mouvements à traiter.
const ATELIER = mouvement({ id: 'm-atelier', libelle: 'PRLV ATELIER FICTIF' })
const ABO_MARS = mouvement({ id: 'm-abo-03', date: '2026-03-10', montant: -45, libelle: 'PRLV ABONNEMENT 03', statut: 'ignoree' })
const ABO_AVRIL = mouvement({ id: 'm-abo-04', date: '2026-04-10', montant: -45, libelle: 'PRLV ABONNEMENT 04' })
const ABO_JUIN = mouvement({ id: 'm-abo-06', date: '2026-06-10', montant: -45, libelle: 'PRLV ABONNEMENT 06' })
const SEUL = mouvement({ id: 'm-seul', date: '2026-07-20', montant: -12.5, libelle: 'CB LIBRAIRIE FICTIVE' })

function poser(o: { pieceStatut?: Piece['statut'] } = {}) {
  faux.tables = 0
  faux.parTable = {
    comptes_bancaires: [{ ...compteBancaireDEssai(D) }],
    lignes_bancaires: [ATELIER, ABO_MARS, ABO_AVRIL, ABO_JUIN, SEUL] as unknown as Record<string, unknown>[],
    pieces: [piece({ id: 'p-atelier', statut: o.pieceStatut ?? 'validee' })] as unknown as Record<string, unknown>[],
    categories: [],
    regles_affectation_bancaire: [],
    memberships: [],
  }
}

beforeEach(() => poser())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }

function rendre() {
  return render(
    <FournisseurPanneauDroit>
      <ContexteDossier annee="toutes" valides={[]}>
        <BanqueTab dossierId={D} modele={TRESORERIE} assujettiTva={false} ventesParLesFactures={false} statutTva="exonere" codeNaf="86.90D" />
      </ContexteDossier>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
async function ligneDuReleve(libelle: string): Promise<HTMLElement> {
  const cellule = (await screen.findAllByText(libelle)).find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  return cellule.closest('tr') as HTMLElement
}
const pastille = async (libelle: string) => (await ligneDuReleve(libelle)).textContent ?? ''
async function ouvrir(libelle: string) {
  const ligne = await ligneDuReleve(libelle)
  await act(async () => { ligne.click() })
}

describe('BanqueTab — les propositions de la liste suivent leurs données, et seulement elles', () => {
  it('une frappe dans la recherche ne recalcule pas les propositions, et ne filtre que l’affichage', async () => {
    rendre()
    expect(await pastille('PRLV ATELIER FICTIF')).toMatch(/Non rapproché · suggestion/)
    expect(await pastille('CB LIBRAIRIE FICTIVE')).not.toMatch(/suggestion/)
    const apresLaLecture = faux.tables
    expect(apresLaLecture).toBeGreaterThan(0)

    const champ = screen.getByLabelText('Rechercher un libellé, un montant, une date…')
    for (const valeur of ['A', 'AT', 'ATE', 'ATELIER']) fireEvent.change(champ, { target: { value: valeur } })
    expect(screen.queryByText('CB LIBRAIRIE FICTIVE')).toBeNull()
    expect(await pastille('PRLV ATELIER FICTIF')).toMatch(/Non rapproché · suggestion/)
    expect(faux.tables).toBe(apresLaLecture)

    // La recherche vidée : toutes les lignes reviennent, chacune avec la proposition d'avant, sans nouveau calcul.
    fireEvent.change(champ, { target: { value: '' } })
    expect(await pastille('CB LIBRAIRIE FICTIVE')).not.toMatch(/suggestion/)
    expect(faux.tables).toBe(apresLaLecture)
  })

  it('le mouvement ignoré, relu, fait paraître la récurrence de celui qui le suit, dans la liste et dans sa fiche', async () => {
    rendre()
    // Une seule occurrence passée résolue : trop tôt pour parler de récurrence.
    expect(await pastille('PRLV ABONNEMENT 06')).not.toMatch(/suggestion/)
    await ouvrir('PRLV ABONNEMENT 04')
    const avantLeGeste = faux.tables
    await act(async () => { within(volet()).getByRole('button', { name: 'Ignorer' }).click() })
    // Ignoré, il quitte la liste des mouvements à traiter (le filtre de l'onglet) : la relecture est revenue.
    await waitFor(() => expect(screen.queryAllByText('PRLV ABONNEMENT 04').filter((e) => e.closest('tr')?.classList.contains('clickable'))).toHaveLength(0))
    expect(faux.parTable.lignes_bancaires.find((l) => l.id === 'm-abo-04')?.statut).toBe('ignoree')
    expect(faux.tables).toBeGreaterThan(avantLeGeste)
    // Mars et avril ignorés au même jour du mois : juin le propose, et sa fiche offre le geste.
    expect(await pastille('PRLV ABONNEMENT 06')).toMatch(/Non rapproché · suggestion/)
    await ouvrir('PRLV ABONNEMENT 06')
    expect(within(volet()).getByRole('button', { name: /Ignorer, comme les 2 précédents/ })).toBeTruthy()
  })

  it('une pièce validée ailleurs, relue, devient la proposition de son mouvement', async () => {
    poser({ pieceStatut: 'a_valider' })
    rendre()
    expect(await pastille('PRLV ATELIER FICTIF')).not.toMatch(/suggestion/)
    // La pièce validée depuis Justificatifs ; la relecture qui suit un geste de l'onglet la rend validée.
    faux.parTable.pieces = faux.parTable.pieces.map((p) => ({ ...p, statut: 'validee' }))
    await ouvrir('CB LIBRAIRIE FICTIVE')
    await act(async () => { within(volet()).getByRole('button', { name: 'Ignorer' }).click() })
    await waitFor(async () => expect(await pastille('PRLV ATELIER FICTIF')).toMatch(/Non rapproché · suggestion/))
  })
})
