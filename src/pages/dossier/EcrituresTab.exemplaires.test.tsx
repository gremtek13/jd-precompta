import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import type { Predicat } from '../../test/filtresPostgrest'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import EcrituresTab from './EcrituresTab'

// L'EXEMPLAIRE D'UNE FACTURE SOURCE DANS L'ONGLET ÉCRITURES (ligne 28.65, chantier EC-Q3, étape VF6a). Le calcul est éprouvé
// à part (lib/ecritures.test.ts, lib/facturesSources.test.ts) ; ce qui se joue ici est le CÂBLAGE : l'onglet tire les
// factures sources de la lecture des ventes facturées d'un dossier basculé et les passe à la génération et aux contrôles ;
// « Générer » n'écrit pas l'exemplaire ; l'écriture déjà passée sur lui est « sans objet », et son retrait, sur un clic
// confirmé qui nomme la pièce et la facture, emporte toutes ses lignes ; l'exemplaire d'une facture qui n'est pas source
// s'écrit comme hier ; et des factures sources lues en partie retiennent la génération et la régénération. Le faux client
// APPLIQUE les filtres, et l'insertion et la suppression MORDENT sur ses tables. Données FICTIVES.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  muet: {} as Record<string, number>,
  insertions: [] as { table: string; lignes: Record<string, unknown>[] }[],
  suppressions: [] as { table: string; lignes: Record<string, unknown>[] }[],
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: true }) }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    const predicats: Predicat[] = []
    let colonnes: string[] | null = null
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    let insertion: Record<string, unknown>[] | null = null
    let suppression = false
    const c: Record<string, unknown> = {}
    const lecture = () => {
      const toutes = filtrer(faux.parTable[table] ?? [], predicats)
      const borne = faux.muet[table] == null ? toutes.length : Math.min(toutes.length, faux.muet[table])
      const rendu = toutes.slice(debut, Math.min(fin + 1, borne)).map((l) => (colonnes == null ? l : Object.fromEntries(colonnes.map((k) => [k, l[k]]))))
      return { data: rendu, error: null, count: toutes.length }
    }
    const reponse = () => {
      if (insertion) {
        const lignes = insertion.map((l, i) => ({ id: `ins-${faux.insertions.length}-${i}`, created_at: '2026-10-23T09:00:00Z', ...l }))
        faux.insertions.push({ table, lignes })
        faux.parTable[table] = [...(faux.parTable[table] ?? []), ...lignes]
        return { data: null, error: null, count: 0 }
      }
      if (suppression) {
        const visees = filtrer(faux.parTable[table] ?? [], predicats)
        faux.suppressions.push({ table, lignes: visees })
        faux.parTable[table] = (faux.parTable[table] ?? []).filter((l) => !visees.includes(l))
        return { data: null, error: null, count: 0 }
      }
      return lecture()
    }
    Object.assign(c, {
      select: (liste: string) => {
        if (liste !== '*') colonnes = liste.replace(/[a-z_]+!inner\([^)]*\)/g, '').split(',').map((x) => x.trim()).filter(Boolean)
        return c
      },
      insert: (lignes: Record<string, unknown> | Record<string, unknown>[]) => { insertion = Array.isArray(lignes) ? lignes : [lignes]; return c },
      delete: () => { suppression = true; return c },
      order: () => c,
      eq: (colonne: string, valeur: unknown) => {
        if (colonne.startsWith('factures_emises.')) {
          const champ = colonne.slice('factures_emises.'.length)
          predicats.push((l) => (faux.parTable.factures_emises ?? []).some((f) => f.id === l.facture_id && f[champ] === valeur))
        } else predicats.push(predicatEq(colonne, valeur))
        return c
      },
      gt: (colonne: string, valeur: unknown) => { predicats.push((l) => String(l[colonne]) > String(valeur)); return c },
      or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
      not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      then: (suite: (r: unknown) => unknown) => Promise.resolve().then(reponse).then(suite),
    })
    return c
  }
  return { supabase: { from: (table: string) => chaine(table), rpc: () => Promise.resolve({ data: null, error: null }) } }
})

const D = 'd1'
const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

const HONORAIRES = {
  id: 'c-vente', dossier_id: null, code: 'honoraires', libelle: 'Honoraires', ordre: 1, compte_comptable: '706200', poste_2035: 'Recettes',
}
const facture = (o: Record<string, unknown> = {}) => ({
  id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2025-0001', date_emission: '2025-11-10',
  tiers_nom: 'Client fictif', facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services',
  option_debits: false, date_prestation: null, montant_ttc: 120, ...o,
})
const ligneFacture = { id: 'l1', facture_id: 'f1', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }
// La pièce de vente désignée exemplaire de la facture F2025-0001 (`pieces.facture_id`, étape VF1).
const piece = (o: Record<string, unknown> = {}) => ({
  id: 'v1', dossier_id: D, nom_fichier: 'F2025-0001.pdf', statut: 'validee', type_piece: 'vente', date_piece: '2025-11-10',
  montant_ht: 100, montant_tva: 20, montant_ttc: 120, tiers: 'Client fictif', categorie_id: 'c-vente', confiance: 'haute',
  storage_path: `${D}/F2025-0001.pdf`, storage_hash: null, facture_id: 'f1', devise: 'EUR', taux_change: null,
  created_at: '2025-11-10T09:00:00Z', ...o,
})
// Une vente ordinaire, sans facture de l'application : elle s'écrit, partout.
const AUTRE = piece({ id: 'v2', nom_fichier: 'recu.pdf', tiers: 'Client comptoir', montant_ht: 50, montant_tva: 10, montant_ttc: 60, facture_id: null })
// L'écriture que la génération a passée sur l'exemplaire avant sa désignation, en trésorerie, sans paiement.
const ecriture = (o: Record<string, unknown> = {}) => ({
  id: 'x1', dossier_id: D, piece_id: 'v1', ligne_bancaire_id: null, date: '2025-11-10', compte: '706200', libelle: 'Client fictif',
  montant: 100, sens: 'credit', statut: 'proposee', created_at: '2025-11-11T09:00:00Z', immobilisation_id: null, vehicule_id: null,
  declaration_tva_id: null, cotisation_id: null, facture_id: null, encaissement_id: null, ...o,
})
const ECRITURE_DE_L_EXEMPLAIRE = [ecriture(), ecriture({ id: 'x2', compte: '445710', montant: 20 })]

function poser(tables: Partial<Record<string, Record<string, unknown>[]>> = {}) {
  faux.muet = {}
  faux.insertions = []
  faux.suppressions = []
  faux.parTable = {
    categories: [HONORAIRES], pieces: [piece(), AUTRE], ecritures_brouillon: [], immobilisations: [], natures_immobilisation: [],
    a_nouveaux: [], ventilations_bancaires: [], reglements_groupes: [], lettrages_manuels: [], declarations_tva: [], soldes_reportes: [],
    factures_emises: [facture()], facture_lignes: [ligneFacture], encaissements_factures: [], encaissements_factures_taux: [],
    lignes_bancaires: [],
    ...tables,
  }
}

function monter(o: { modele?: ModeleComptable; bascule?: boolean } = {}) {
  return render(
    <ContexteDossier annee="toutes" valides={[]}>
      <EcrituresTab
        dossierId={D} dossierNom="Dossier fictif" dossierSiret={null} assujettiTva modele={o.modele ?? TRESORERIE}
        ventesParLesFactures={o.bascule ?? true} onModeleUpdated={() => {}}
      />
    </ContexteDossier>,
  )
}

const generer = () => screen.findByRole('button', { name: /^Générer les écritures manquantes/ })
const carteSansObjet = (): HTMLElement | null =>
  (screen.queryByRole('heading', { name: /Écritures que la pièce ne justifie plus/ })?.closest('.card') as HTMLElement | undefined) ?? null
const piecesInserees = () => [...new Set(faux.insertions.flatMap((i) => i.lignes.map((l) => l.piece_id)))]

let confirmation: ReturnType<typeof vi.spyOn>
let messages: string[]
beforeEach(() => {
  poser()
  messages = []
  confirmation = vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { messages.push(m ?? ''); return true })
})
afterEach(() => { confirmation.mockRestore() })

describe('« Générer » n’écrit pas l’exemplaire d’une facture source', () => {
  for (const modele of [TRESORERIE, ENGAGEMENT]) {
    it(`en ${modele.mode} : seule la vente ordinaire s’écrit`, async () => {
      monter({ modele })
      const bouton = await generer()
      await waitFor(() => expect(bouton.textContent).toBe('Générer les écritures manquantes (1)'))
      await act(async () => { fireEvent.click(bouton) })
      await waitFor(() => expect(faux.insertions).toHaveLength(1))
      expect(piecesInserees()).toEqual(['v2'])
    })
  }

  it('l’exemplaire d’une facture qui n’est pas source s’écrit comme hier', async () => {
    poser({ factures_emises: [facture({ source_de_la_vente: false })] })
    monter()
    const bouton = await generer()
    await waitFor(() => expect(bouton.textContent).toBe('Générer les écritures manquantes (2)'))
    await act(async () => { fireEvent.click(bouton) })
    await waitFor(() => expect(faux.insertions).toHaveLength(1))
    expect(piecesInserees().sort()).toEqual(['v1', 'v2'])
  })

  // Un dossier qui n'a pas basculé n'a aucune facture source — la base l'impose — : il ne lit pas les ventes facturées, et
  // une pièce désignée y compte comme hier.
  it('un dossier qui n’a pas basculé : l’exemplaire d’une facture s’écrit comme hier', async () => {
    poser({ factures_emises: [] })
    monter({ bascule: false })
    const bouton = await generer()
    await waitFor(() => expect(bouton.textContent).toBe('Générer les écritures manquantes (2)'))
  })
})

// LA CARTE « COMPTES MANQUANTS » (étape VF6e) : l'exemplaire d'une facture source ne s'écrit pas — sa catégorie n'a pas à
// recevoir un compte. Celui d'une facture qui n'est pas source s'écrit comme hier, et la réclame.
describe('« Comptes manquants » ne réclame pas le compte de la catégorie de l’exemplaire d’une facture source', () => {
  const NUE = { ...HONORAIRES, id: 'c-nue', code: 'autre', libelle: 'Catégorie fictive sans compte', compte_comptable: null }
  const carte = () => screen.queryByRole('heading', { name: 'Comptes manquants' })

  it('basculé, la facture source : la carte se tait ; sa facture d’avant : la carte réclame le compte', async () => {
    poser({ categories: [HONORAIRES, NUE], pieces: [piece({ categorie_id: 'c-nue' }), AUTRE] })
    monter()
    await generer()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Générer les écritures manquantes/ }).textContent)
      .toBe('Générer les écritures manquantes (1)'))
    expect(carte()).toBeNull()
    cleanup()
    poser({ categories: [HONORAIRES, NUE], pieces: [piece({ categorie_id: 'c-nue' }), AUTRE], factures_emises: [facture({ source_de_la_vente: false })] })
    monter()
    expect(await screen.findByRole('heading', { name: 'Comptes manquants' })).toBeTruthy()
    expect(screen.getByText('Catégorie fictive sans compte')).toBeTruthy()
  })
})

describe('l’écriture déjà passée sur l’exemplaire est sans objet, et se retire', () => {
  it('se dit sous son motif, se retire sur un clic confirmé qui nomme la pièce et la facture, et la carte se tait', async () => {
    poser({ ecritures_brouillon: ECRITURE_DE_L_EXEMPLAIRE })
    monter()
    await screen.findByText(/2 écritures proposées/)
    const carte = await waitFor(() => { const c = carteSansObjet(); expect(c).not.toBeNull(); return c! })
    within(carte).getByText(/Désignée exemplaire d’une facture source de sa vente : la facture compte la vente/)
    within(carte).getByText(/« Régénérer » n'y réécrirait rien/)
    // Ni « à régénérer », ni « en attente de rapprochement » : elle n'attend aucun paiement.
    expect(screen.queryByText(/à régénérer$/)).toBeNull()
    expect(screen.queryByText(/en attente de rapprochement bancaire/)).toBeNull()
    await act(async () => { fireEvent.click(within(carte).getByRole('button', { name: "Retirer l'écriture" })) })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/^Retirer du brouillon l'écriture de « Client fictif » \? Cette pièce est l'exemplaire de la facture F2025-0001, source de sa vente/)
    expect(messages[0]).toContain('Son produit, sa TVA et sa contrepartie banque partent ensemble.')
    expect(messages[0]).toContain('La pièce et sa désignation ne bougent pas : la vente reste comptée par sa facture.')
    await waitFor(() => expect(carteSansObjet()).toBeNull())
    expect(faux.suppressions).toHaveLength(1)
    expect(faux.suppressions[0].lignes.map((l) => l.id).sort()).toEqual(['x1', 'x2'])
    // Et rien ne la réécrit : la génération n'offre toujours que la vente ordinaire.
    expect((await generer()).textContent).toBe('Générer les écritures manquantes (1)')
  })

  it('rapprochée, la confirmation dit que son rapprochement reste et ce qu’il faut faire du mouvement', async () => {
    poser({
      ecritures_brouillon: [...ECRITURE_DE_L_EXEMPLAIRE, ecriture({ id: 'x3', compte: '512000', sens: 'debit', montant: 120, ligne_bancaire_id: 'm1', date: '2025-11-20' })],
      lignes_bancaires: [{
        id: 'm1', dossier_id: D, date: '2025-11-20', montant: 120, libelle: 'VIR CLIENT FICTIF', statut: 'rapprochee', piece_id: 'v1',
        cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, emprunt_id: null, ventilee: false,
        reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, encaissements_de_factures: false, source_fichier: 'releve.csv',
        created_at: '2025-11-21T09:00:00Z',
      }],
    })
    monter()
    const carte = await waitFor(() => { const c = carteSansObjet(); expect(c).not.toBeNull(); return c! })
    await act(async () => { fireEvent.click(within(carte).getByRole('button', { name: "Retirer l'écriture" })) })
    expect(messages[0]).toContain('son rapprochement bancaire non plus : le mouvement n’aura plus d’écriture')
    await waitFor(() => expect(faux.suppressions).toHaveLength(1))
    // Toutes ses lignes ouvertes partent, sa banque comprise.
    expect(faux.suppressions[0].lignes.map((l) => l.id).sort()).toEqual(['x1', 'x2', 'x3'])
  })

  it('refusée la confirmation, rien ne part', async () => {
    poser({ ecritures_brouillon: ECRITURE_DE_L_EXEMPLAIRE })
    confirmation.mockImplementation(() => false)
    monter()
    const carte = await waitFor(() => { const c = carteSansObjet(); expect(c).not.toBeNull(); return c! })
    await act(async () => { fireEvent.click(within(carte).getByRole('button', { name: "Retirer l'écriture" })) })
    expect(faux.suppressions).toHaveLength(0)
  })

  it('l’écriture de l’exemplaire d’une facture qui n’est pas source n’est pas sans objet', async () => {
    poser({ ecritures_brouillon: ECRITURE_DE_L_EXEMPLAIRE, factures_emises: [facture({ source_de_la_vente: false })] })
    monter()
    await screen.findByText(/2 écritures proposées/)
    expect(carteSansObjet()).toBeNull()
  })
})

describe('des factures sources lues en partie retiennent la génération et la régénération', () => {
  it('« Générer » attend, et dit pourquoi', async () => {
    faux.muet = { factures_emises: 0 }
    monter()
    const bouton = await generer() as HTMLButtonElement
    // La vente ordinaire attend sa génération : seule la lecture des factures sources la retient.
    await waitFor(() => expect(bouton.title).toMatch(/^Factures sources de leurs ventes non lues \(les factures du dossier/))
    expect(bouton.disabled).toBe(true)
    await act(async () => { fireEvent.click(bouton) })
    expect(faux.insertions).toHaveLength(0)
  })

  it('« Régénérer » attend aussi', async () => {
    // La vente ordinaire, écrite à 50 € quand elle en vaut 60 : à régénérer.
    poser({ ecritures_brouillon: [ecriture({ id: 'o1', piece_id: 'v2', montant: 50, libelle: 'Client comptoir' })] })
    faux.muet = { factures_emises: 0 }
    monter()
    const bouton = await screen.findByRole('button', { name: 'Régénérer' }) as HTMLButtonElement
    expect(bouton.disabled).toBe(true)
    expect(bouton.title).toMatch(/^Factures sources de leurs ventes non lues/)
    await act(async () => { fireEvent.click(bouton) })
    expect(faux.suppressions).toHaveLength(0)
    expect(faux.insertions).toHaveLength(0)
  })

  it('les mêmes, lues en entier : la régénération part', async () => {
    poser({ ecritures_brouillon: [ecriture({ id: 'o1', piece_id: 'v2', montant: 50, libelle: 'Client comptoir' })] })
    monter()
    const bouton = await screen.findByRole('button', { name: 'Régénérer' }) as HTMLButtonElement
    expect(bouton.disabled).toBe(false)
    await act(async () => { fireEvent.click(bouton) })
    await waitFor(() => expect(faux.insertions).toHaveLength(1))
    expect(piecesInserees()).toEqual(['v2'])
  })
})
