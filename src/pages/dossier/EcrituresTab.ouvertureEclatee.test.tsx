import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import type { Predicat } from '../../test/filtresPostgrest'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import EcrituresTab from './EcrituresTab'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'

// L'OUVERTURE DE LA BANQUE ÉCLATÉE ENTRE LES COMPTES BANCAIRES, DANS L'ONGLET ÉCRITURES (ligne 26.6, MCB5, sixième partie,
// suite). L'état est éprouvé à part (lib/ouvertureEclatee.test.ts, lib/ouvertureEclateeLecteurs.test.ts) ; ce qui se joue ici
// est le CÂBLAGE, sous les deux états du drapeau `COMPTES_BANCAIRES_PREVUS` : baissé, ni carte ni lecture des comptes ; levé,
// la carte dit l'état, le clic confirmé passe `ecrire_ouverture_eclatee` seule avec la composition, deux clics du même `act`
// n'écrivent qu'une fois, le verrou ne se relâche qu'après la relecture, et une lecture partielle n'offre aucun geste. Le faux
// client APPLIQUE les filtres. Données FICTIVES.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  muet: {} as Record<string, number>,
  attente: null as Promise<void> | null,
  relacher: null as (() => void) | null,
  retenirApresRpc: false,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  tables: [] as string[],
}))
const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('../../lib/comptesBancaires', async (original) => {
  const module = await original<typeof import('../../lib/comptesBancaires')>()
  return { ...module, get COMPTES_BANCAIRES_PREVUS() { return drapeau.leve } }
})
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: false }) }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    faux.tables.push(table)
    const predicats: Predicat[] = []
    let colonnes: string[] | null = null
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    const reponse = () => {
      const toutes = filtrer(faux.parTable[table] ?? [], predicats)
      const borne = faux.muet[table] == null ? toutes.length : Math.min(toutes.length, faux.muet[table])
      const rendu = toutes.slice(debut, Math.min(fin + 1, borne)).map((l) => (colonnes == null ? l : Object.fromEntries(colonnes.map((k) => [k, l[k]]))))
      return { data: rendu, error: null, count: toutes.length }
    }
    Object.assign(c, {
      select: (liste: string) => {
        if (liste !== '*') colonnes = liste.split(',').map((x) => x.trim()).filter(Boolean)
        return c
      },
      order: () => c,
      eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
      or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
      not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      then: (suite: (r: unknown) => unknown) => (faux.attente ?? Promise.resolve()).then(reponse).then(suite),
    })
    return c
  }
  return {
    supabase: {
      from: (table: string) => chaine(table),
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.rpcs.push({ nom, args })
        if (nom === 'ecrire_ouverture_eclatee') {
          // Comme la vraie : les lignes de l'éclatement du 1er janvier remplacées par la composition reçue.
          const jour = `${args.p_annee}-01-01`
          const gardees = (faux.parTable.ecritures_brouillon ?? []).filter((l) => !(l.date === jour && l.ouverture_compte_bancaire_id != null))
          const ecrites = (args.p_ecritures as Record<string, unknown>[]).map((l, i) => ({
            ...ecriture({ id: `oe-${faux.rpcs.length}-${i}`, date: jour }), compte: l.compte, sens: l.sens, montant: l.montant, libelle: l.libelle,
            ouverture_compte_bancaire_id: l.compte_bancaire_id,
          }))
          faux.parTable.ecritures_brouillon = [...gardees, ...ecrites]
        }
        if (faux.retenirApresRpc) faux.attente = new Promise<void>((r) => { faux.relacher = r })
        return Promise.resolve({ data: null, error: null })
      },
    },
  }
})

const D = 'd1'
const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }
const COMPTES = [
  { id: 'p', dossier_id: D, libelle: 'Compte principal', principal: true, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null },
  { id: 's', dossier_id: D, libelle: 'Compte second fictif', principal: false, fin_d_identifiant: null, compte: '512200', compte_propre_depuis: '2026-01-01', ouvert_le: '2024-06-01', clos_le: null },
]
const mouvement = (id: string, compte: string, fichier: string, date: string, montant: number) => ({
  id, dossier_id: D, compte_bancaire_id: compte, source_fichier: fichier, date, montant, libelle: 'MOUVEMENT FICTIF', statut: 'non_rapprochee',
  prelevement_personnel: false, piece_id: null, cotisation_id: null, categorie_id: null, emprunt_id: null, compte_bilan: null,
  declaration_tva_id: null, ventilee: false, reglement_groupe: false, encaissements_de_factures: false,
})
const controle = (id: string, compte: string, fichier: string, initial: number, final: number) => ({
  id, dossier_id: D, compte_bancaire_id: compte, source_fichier: fichier, solde_initial: initial, solde_final: final,
  somme_mouvements: final - initial, ecart: 0, coherent: true, periode_debut: '2025-12-01', periode_fin: '2025-12-31', created_at: '2026-01-02T00:00:00Z',
})
const report = (id: string, compte: string, sens: string, montant: number) => ({
  id, dossier_id: D, date: '2026-01-01', compte, libelle: compte, sens, montant, source_nom: 'Exercice 2025 validé', source_empreinte: 'e'.repeat(64),
  created_at: '2026-01-02T00:00:00Z',
})
function ecriture(o: Record<string, unknown> = {}) {
  return {
    id: 'b1', dossier_id: D, piece_id: null, ligne_bancaire_id: null, date: '2026-01-01', compte: '512000', libelle: 'Libellé',
    montant: 0, sens: 'debit', statut: 'proposee', created_at: '2026-01-02T09:00:00Z', immobilisation_id: null, vehicule_id: null,
    declaration_tva_id: null, cotisation_id: null, facture_id: null, encaissement_id: null, ouverture_compte_bancaire_id: null, ...o,
  }
}

function poser(tables: Partial<Record<string, Record<string, unknown>[]>> = {}) {
  faux.muet = {}
  faux.attente = null
  faux.relacher = null
  faux.retenirApresRpc = false
  faux.rpcs = []
  faux.tables = []
  faux.parTable = {
    categories: [], pieces: [], ecritures_brouillon: [], immobilisations: [], natures_immobilisation: [], a_nouveaux: [],
    ventilations_bancaires: [], reglements_groupes: [], lettrages_manuels: [], declarations_tva: [],
    comptes_bancaires: COMPTES,
    lignes_bancaires: [mouvement('mp', 'p', 'p_dec.csv', '2025-12-15', 100), mouvement('ms', 's', 's_dec.csv', '2025-12-10', 50)],
    controles_releves_bancaires: [controle('cp', 'p', 'p_dec.csv', 900, 1000), controle('cs', 's', 's_dec.csv', 200, 250)],
    soldes_reportes: [report('r1', '512000', 'debit', 1250), report('r2', '101000', 'credit', 1250)],
    ...tables,
  }
}

function monter(o: { annee?: number | 'toutes'; valides?: readonly number[] } = {}) {
  return render(
    <ContexteDossier annee={o.annee ?? 2026} valides={o.valides ?? [2025]}>
      <EcrituresTab dossierId={D} dossierNom="Dossier fictif" dossierSiret={null} assujettiTva={false} modele={TRESORERIE}
        ventesParLesFactures={false} onModeleUpdated={() => {}} />
    </ContexteDossier>,
  )
}

const TITRE = /^Ouverture de la banque par compte/
const carte = () => screen.getByRole('heading', { name: TITRE }).closest('.card') as HTMLElement
const LIBELLE = 'Ouverture du 512200 au relevé du 31/12/2025'

let confirmation: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  drapeau.leve = true
  poser()
  confirmation = vi.spyOn(window, 'confirm').mockImplementation(() => true)
})
afterEach(() => { confirmation.mockRestore() })

describe('la carte de l’ouverture éclatée, sous les deux états du drapeau', () => {
  it('drapeau baissé : ni carte, ni lecture des comptes bancaires ni des contrôles', async () => {
    drapeau.leve = false
    monter()
    await screen.findByText(/Aucune écriture proposée pour l'instant/)
    expect(screen.queryByRole('heading', { name: TITRE })).toBeNull()
    expect(faux.tables).not.toContain('comptes_bancaires')
    expect(faux.tables).not.toContain('controles_releves_bancaires')
  })

  it('drapeau levé : la carte dit « à écrire » et la paire que les relevés du 31/12 commandent', async () => {
    monter()
    const c = await waitFor(() => carte())
    await waitFor(() => expect(within(c).getByText('à écrire')).toBeTruthy())
    expect(within(c).getAllByText(LIBELLE)).toHaveLength(2)
    expect(within(c).getByRole('button', { name: 'Écrire' })).toBeTruthy()
  })

  it('« toutes les années », ou un exercice sans rien à éclater : pas de carte', async () => {
    monter({ annee: 'toutes' })
    await screen.findByText(/Aucune écriture proposée pour l'instant/)
    expect(screen.queryByRole('heading', { name: TITRE })).toBeNull()
  })
})

describe('Écrire : la fonction seule, sur un clic confirmé, sous un verrou relâché après la relecture', () => {
  it('la confirmation nomme le compte et son montant ; la fonction reçoit la composition ; la carte devient « à jour »', async () => {
    monter()
    const bouton = await waitFor(() => within(carte()).getByRole('button', { name: 'Écrire' }))
    fireEvent.click(bouton)
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    const message = String(confirmation.mock.calls[0][0])
    expect(message).toContain('512200 : 250,00 €')
    expect(message).toContain('face au 512000')
    expect(faux.rpcs[0]).toEqual({ nom: 'ecrire_ouverture_eclatee', args: {
      p_dossier_id: D, p_annee: 2026, p_ecritures: [
        { compte_bancaire_id: 's', compte: '512200', sens: 'debit', montant: 250, libelle: LIBELLE },
        { compte_bancaire_id: 's', compte: '512000', sens: 'credit', montant: 250, libelle: LIBELLE },
      ] } })
    await waitFor(() => expect(within(carte()).getByText('à jour')).toBeTruthy())
    expect(within(carte()).queryByRole('button')).toBeNull()
  })

  it('un clic refusé à la confirmation n’écrit rien', async () => {
    confirmation.mockImplementation(() => false)
    monter()
    fireEvent.click(await waitFor(() => within(carte()).getByRole('button', { name: 'Écrire' })))
    expect(faux.rpcs).toEqual([])
  })

  it('deux clics du même act n’écrivent qu’une fois, et le verrou tient jusqu’à la fin de la relecture', async () => {
    monter()
    const bouton = await waitFor(() => within(carte()).getByRole('button', { name: 'Écrire' }))
    faux.retenirApresRpc = true
    await act(async () => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.rpcs).toHaveLength(1)
    // La relecture n'est pas revenue : un autre clic ne part pas.
    fireEvent.click(bouton)
    expect(faux.rpcs).toHaveLength(1)
    await act(async () => { faux.relacher?.(); faux.attente = null })
    await waitFor(() => expect(within(carte()).getByText('à jour')).toBeTruthy())
    expect(faux.rpcs).toHaveLength(1)
  })

  it('un brouillon qui porte une autre paire : « à réécrire », et le bouton le dit', async () => {
    poser({ ecritures_brouillon: [
      ecriture({ id: 'x1', compte: '512200', sens: 'debit', montant: 200, libelle: LIBELLE, ouverture_compte_bancaire_id: 's' }),
      ecriture({ id: 'x2', compte: '512000', sens: 'credit', montant: 200, libelle: LIBELLE, ouverture_compte_bancaire_id: 's' }),
    ] })
    monter()
    await waitFor(() => expect(within(carte()).getByText('à réécrire')).toBeTruthy())
    fireEvent.click(within(carte()).getByRole('button', { name: 'Réécrire' }))
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(String(confirmation.mock.calls[0][0])).toContain('Elle remplace celle qui est au brouillon.')
  })
})

describe('aucun geste sur ce qui ne se sait pas', () => {
  it('un relevé contrôlé lu en partie : la carte le dit, sans bouton', async () => {
    faux.muet = { controles_releves_bancaires: 1 }
    monter()
    await waitFor(() => expect(within(carte()).getByText(/n’ont pas pu être lus en entier/)).toBeTruthy())
    expect(within(carte()).queryByRole('button')).toBeNull()
  })

  it('un relevé qui manque au 31/12 : « retenue », avec les mots de la base, sans bouton', async () => {
    poser({ controles_releves_bancaires: [controle('cp', 'p', 'p_dec.csv', 900, 1000)], lignes_bancaires: [mouvement('mp', 'p', 'p_dec.csv', '2025-12-15', 100)] })
    monter()
    await waitFor(() => expect(within(carte()).getByText('retenue')).toBeTruthy())
    expect(within(carte()).getByText(/ne se lit sur aucun de ses relevés contrôlés/)).toBeTruthy()
    expect(within(carte()).queryByRole('button')).toBeNull()
  })

  it('l’exercice validé : l’état se lit, sans geste', async () => {
    monter({ valides: [2025, 2026] })
    await waitFor(() => expect(within(carte()).getByText(/est validé : son ouverture ne change plus/)).toBeTruthy())
    expect(within(carte()).queryByRole('button')).toBeNull()
  })
})
