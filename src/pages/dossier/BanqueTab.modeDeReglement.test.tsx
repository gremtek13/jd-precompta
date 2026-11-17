import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { LigneBancaire } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'
import { MODE_ILLISIBLE_DIT, MODE_NON_POSE_DIT } from '../../lib/modeDeReglement'

// LE MODE DE RÈGLEMENT D'UN MOUVEMENT, DANS LA FICHE DE L'ONGLET BANQUE (EXP58-Q1). Le drapeau joué par un accesseur : baissé,
// la fiche d'hier, rien d'appelé ; levé, le mode proposé par le libellé, posé d'un clic — deux clics dans le même act, un seul
// appel, tel qu'il part —, corrigé ou retiré par la liste ; le refus de la base dit dans la fiche ; figé ou lu sans sa colonne,
// aucun geste ; un dossier en engagement, rien. Des jeux FICTIFS.

const D = 'dossier-de-test'

const drapeau = vi.hoisted(() => ({ leve: false }))
vi.mock('../../lib/modeDeReglement', async (original) => ({
  ...await original<typeof import('../../lib/modeDeReglement')>(),
  get MODE_DE_REGLEMENT_PREVU() { return drapeau.leve },
}))

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreurRpc: null as { message: string; code: string } | null,
}))

vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))
vi.mock('../../lib/depot', () => ({ ouvrirJustificatif: async () => {} }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    let operation = 'select'
    let unique = false
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    const soi = () => c
    Object.assign(c, {
      select: soi, order: soi, neq: soi, gte: soi, lte: soi, lt: soi, gt: soi, is: soi, not: soi, or: soi, limit: soi,
      eq: (colonne: string, v: unknown) => { predicats.push(predicatEq(colonne, v)); return c },
      in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => { unique = true; return c },
      single: () => { unique = true; return c },
      update: () => { operation = 'update'; return c },
      insert: () => { operation = 'insert'; return c },
      upsert: () => { operation = 'upsert'; return c },
      delete: () => { operation = 'delete'; return c },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
        if (operation !== 'select' || unique) return Promise.resolve({ data: null, error: null }).then(suite, echec)
        const toutes = filtrer(faux.parTable[table] ?? [], predicats)
        return Promise.resolve({ data: toutes.slice(debut, fin + 1), error: null, count: toutes.length }).then(suite, echec)
      },
    })
    return c
  }
  const rpc = (nom: string, args: Record<string, unknown> = {}) => {
    faux.rpcs.push({ nom, args })
    return Promise.resolve({ data: null, error: nom === 'poser_modes_de_reglement' ? faux.erreurRpc : null })
  }
  const functions = {
    invoke: async (nom: string) => {
      if (nom === 'banque-connexion') return { data: { configuree: false, connexion: null }, error: null }
      throw new Error(`Appel de fonction non attendu : ${nom}`)
    },
  }
  return { supabase: { from: (table: string) => chaine(table), rpc, functions } }
})

function mouvement(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire {
  return {
    dossier_id: D, date: '2026-03-05', montant: -45.5, libelle: 'PRLV SEPA FOURNISSEUR IMAGINAIRE', libelle_brut: null,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
    reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-03-05T09:00:00Z',
    encaissements_de_factures: false, mode_reglement: null, ...o,
  }
}

function poser(releve: LigneBancaire[]) {
  faux.rpcs = []
  faux.erreurRpc = null
  faux.parTable = {
    lignes_bancaires: releve as unknown as Record<string, unknown>[],
    pieces: [],
    categories: [{ id: 'c-div', dossier_id: D, code: 'divers', libelle: 'Divers', ordre: 1, compte_comptable: '625100', poste_2035: 'Divers' }],
  }
}

beforeEach(() => { drapeau.leve = true; poser([mouvement({ id: 'm1' })]) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); drapeau.leve = false })

const modele = (mode: 'tresorerie' | 'engagement'): ModeleComptable =>
  ({ mode, compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT })

function rendre(o: { valides?: number[]; mode?: 'tresorerie' | 'engagement' } = {}) {
  return render(
    <FournisseurPanneauDroit>
      <ContexteDossier annee="toutes" valides={o.valides ?? []}>
        <BanqueTab dossierId={D} modele={modele(o.mode ?? 'tresorerie')} assujettiTva={false} ventesParLesFactures={false} statutTva="exonere" />
      </ContexteDossier>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
const section = () => within(volet()).getByRole('region', { name: 'Mode de règlement' })
const sans = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ')
async function ouvrir(libelle: string) {
  const cellule = (await screen.findAllByText(libelle)).find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  await act(async () => { (cellule.closest('tr') as HTMLElement).click() })
  await within(volet()).findAllByRole('heading', { name: /^Mode de règlement$|Sur un compte de bilan|Écrit sur un compte de bilan/ })
}
const appels = () => faux.rpcs.filter((r) => r.nom === 'poser_modes_de_reglement')

describe('le mode de règlement d’un mouvement, dans sa fiche', () => {
  it('le drapeau baissé : la fiche d’hier, aucune section, rien d’appelé', async () => {
    drapeau.leve = false
    rendre()
    await ouvrir('PRLV SEPA FOURNISSEUR IMAGINAIRE')
    expect(within(volet()).queryByRole('heading', { name: 'Mode de règlement' })).toBeNull()
    expect(appels()).toEqual([])
  })

  it('le mode proposé par le libellé, justifié ; deux clics sur « Poser » dans le même act : un seul appel, tel qu’il part', async () => {
    rendre()
    await ouvrir('PRLV SEPA FOURNISSEUR IMAGINAIRE')
    const texte = sans(section().textContent)
    expect(texte).toContain(MODE_NON_POSE_DIT)
    expect(texte).toContain('Proposé : Prélèvement — le libellé de la banque commence par « PRLV ». Rien ne s’écrit sans ton clic.')
    expect(appels()).toEqual([])
    const bouton = within(section()).getByRole('button', { name: 'Poser « Prélèvement »' })
    act(() => { bouton.click(); bouton.click() })
    await waitFor(() => expect(appels()).toHaveLength(1))
    expect(appels()[0].args).toEqual({ p_dossier_id: D, p_lignes: ['m1'], p_modes: ['Prélèvement'] })
  })

  it('corriger par la liste : « Enregistrer » part avec le mode choisi ; le mode posé, « Retirer le mode » part nul', async () => {
    rendre()
    await ouvrir('PRLV SEPA FOURNISSEUR IMAGINAIRE')
    const liste = within(section()).getByLabelText('Choisir le mode')
    // Le choix part de la proposition : rien à enregistrer tant qu'il n'a pas bougé du mode posé… sauf qu'aucun n'est posé.
    act(() => { fireEvent.change(liste, { target: { value: 'Chèque' } }) })
    await act(async () => { within(section()).getByRole('button', { name: 'Enregistrer' }).click() })
    expect(appels().map((a) => a.args.p_modes)).toEqual([['Chèque']])

    cleanup()
    poser([mouvement({ id: 'm2', libelle: 'PRLV SEPA AUTRE', mode_reglement: 'Virement' })])
    rendre()
    await ouvrir('PRLV SEPA AUTRE')
    expect(sans(section().textContent)).toContain('Posé : Virement.')
    const corriger = within(section()).getByLabelText('Corriger le mode')
    // Le mode posé : le bouton attend un changement.
    expect((within(section()).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true)
    act(() => { fireEvent.change(corriger, { target: { value: '' } }) })
    await act(async () => { within(section()).getByRole('button', { name: 'Retirer le mode' }).click() })
    expect(appels().map((a) => a.args)).toEqual([{ p_dossier_id: D, p_lignes: ['m2'], p_modes: [null] }])
  })

  it('un refus de la base se dit dans la fiche, sous ses mots', async () => {
    rendre()
    await ouvrir('PRLV SEPA FOURNISSEUR IMAGINAIRE')
    faux.erreurRpc = { message: 'L’exercice 2026 est validé : ce mouvement ne change plus.', code: '23514' }
    await act(async () => { within(section()).getByRole('button', { name: 'Poser « Prélèvement »' }).click() })
    expect(await within(volet()).findByText('Le mode n’a pas été enregistré : L’exercice 2026 est validé : ce mouvement ne change plus.')).toBeTruthy()
  })

  it('figé par un exercice validé : le mode se dit, aucun geste', async () => {
    poser([mouvement({ id: 'm3', libelle: 'CB LIBRAIRIE IMAGINAIRE', mode_reglement: 'Carte bancaire' })])
    rendre({ valides: [2026] })
    await ouvrir('CB LIBRAIRIE IMAGINAIRE')
    expect(sans(section().textContent)).toMatch(/Posé : Carte bancaire\..*il ne change plus\./)
    expect(within(section()).queryAllByRole('button')).toEqual([])
    expect(within(section()).queryByRole('combobox')).toBeNull()
  })

  it('un mouvement lu sans sa colonne : la fiche le dit, aucun geste', async () => {
    const lu = mouvement({ id: 'm4', libelle: 'VIR SEPA RECU CPAM', montant: 80 })
    delete (lu as Partial<LigneBancaire>).mode_reglement
    poser([lu])
    rendre()
    await ouvrir('VIR SEPA RECU CPAM')
    expect(within(section()).getByText(MODE_ILLISIBLE_DIT)).toBeTruthy()
    expect(within(section()).queryAllByRole('button')).toEqual([])
  })

  it('un dossier en engagement : aucune section (son FEC a dix-huit colonnes)', async () => {
    rendre({ mode: 'engagement' })
    await ouvrir('PRLV SEPA FOURNISSEUR IMAGINAIRE')
    expect(within(volet()).queryByRole('heading', { name: 'Mode de règlement' })).toBeNull()
  })
})
