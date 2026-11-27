import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { LigneBancaire } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'
import { A_EGALITE_DIT, RESTE_CLASSABLE } from '../../lib/associationsAssuranceMaladieVue'
import { MUET } from '../../lib/rapprochementAssuranceMaladie'

// L'ASSOCIATION DES PAIEMENTS DE L'ASSURANCE MALADIE AUX CRÉDITS DU RELEVÉ, DANS L'ONGLET BANQUE (conception 53, NOE5b). Les
// deux drapeaux — NOE3 et NOE5 — joués par des accesseurs : baissés, rien n'est lu ni monté ; levés, la fiche d'un crédit
// propose le paiement justifié et « Associer » part une fois pour deux clics, tel qu'il part ; à égalité, rien n'est proposé ;
// des associations lues en partie, aucun geste ; la section NOEMIE offre le lot, dont la confirmation nomme ce qui part ; un
// crédit associé se défait sur une confirmation et reste classable. Des jeux FICTIFS : des dates, des montants, un code de caisse.

const D = 'dossier-de-test'

const drapeaux = vi.hoisted(() => ({ paiements: false, associations: false, facture: false }))
vi.mock('../../lib/paiementsAssuranceMaladie', async (original) => ({
  ...await original<typeof import('../../lib/paiementsAssuranceMaladie')>(),
  get PAIEMENTS_ASSURANCE_MALADIE_PREVUS() { return drapeaux.paiements },
}))
vi.mock('../../lib/rapprochementAssuranceMaladie', async (original) => ({
  ...await original<typeof import('../../lib/rapprochementAssuranceMaladie')>(),
  get ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES() { return drapeaux.associations },
}))
// L'écran du facturé (BOR4) a son test à lui : ici son drapeau reste baissé, pour que ce fichier ne juge que l'association.
vi.mock('../../lib/importDuFactureAssuranceMaladie', async (original) => ({
  ...await original<typeof import('../../lib/importDuFactureAssuranceMaladie')>(),
  get FACTURES_ASSURANCE_MALADIE_PREVUES() { return drapeaux.facture },
}))

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  muet: {} as Record<string, number>,
  tables: [] as string[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
}))

vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))
vi.mock('../../lib/depot', () => ({ ouvrirJustificatif: async () => {} }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    faux.tables.push(table)
    let operation = 'select'
    let unique = false
    let colonnes = '*'
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    const soi = () => c
    Object.assign(c, {
      select: (lues?: string) => { if (operation === 'select') colonnes = lues ?? '*'; return c },
      order: soi, neq: soi, gte: soi, lte: soi, lt: soi, gt: soi, is: soi, not: soi, or: soi, limit: soi,
      eq: (colonne: string, v: unknown) => {
        if (colonne.startsWith('factures_emises.')) {
          const champ = colonne.slice('factures_emises.'.length)
          predicats.push((l) => (faux.parTable.factures_emises ?? []).some((f) => f.id === l.facture_id && f[champ] === v))
        } else predicats.push(predicatEq(colonne, v))
        return c
      },
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
        const muet = faux.muet[`${table}|${colonnes}`]
        return Promise.resolve({
          data: toutes.slice(debut, Math.min(fin + 1, muet ?? Number.MAX_SAFE_INTEGER)), error: null, count: toutes.length,
        }).then(suite, echec)
      },
    })
    return c
  }
  const rpc = (nom: string, args: Record<string, unknown> = {}) => {
    faux.rpcs.push({ nom, args })
    return Promise.resolve({ data: null, error: null })
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
    dossier_id: D, compte_bancaire_id: 'cb-essai', date: '2026-03-05', montant: 123.45, libelle: 'VIR CPAM 0012345678260303', libelle_brut: null,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
    reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-03-05T09:00:00Z',
    encaissements_de_factures: false, ...o,
  }
}
const paiement = (o: Record<string, unknown>) => ({
  dossier_id: D, import_id: 'i1', date_journee_comptable: '2026-03-03', regime: 1, caisse: 691, organisme_complementaire: null, part: 'obligatoire',
  montant_centimes: 12345, regularisations_centimes: 0, nombre_de_factures: 3, ...o,
})
const IMPORT = {
  id: 'i1', dossier_id: D, periode_du: '2026-03-03', periode_au: '2026-03-03', nombre_de_rejets: 0,
  montant_rejete_centimes: 0, importe_par: 'u', importe_le: '2026-03-06T09:00:00Z',
}
const COLONNES_ASSOCIATION = 'id, dossier_id, paiement_id, ligne_bancaire_id, associe_par, associe_le'
const CREDIT = mouvement({ id: 'm1' })
const association = (o: Record<string, unknown>) =>
  ({ dossier_id: D, associe_par: 'u', associe_le: '2026-03-06T09:00:00Z', ...o })

function poser(o: {
  releve?: LigneBancaire[]; imports?: Record<string, unknown>[]; paiements?: Record<string, unknown>[]; associations?: Record<string, unknown>[]
} = {}) {
  faux.muet = {}
  faux.tables = []
  faux.rpcs = []
  faux.parTable = {
    lignes_bancaires: (o.releve ?? [CREDIT]) as unknown as Record<string, unknown>[],
    pieces: [],
    categories: [{ id: 'c-hon', dossier_id: D, code: 'honoraires', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes' }],
    imports_assurance_maladie: o.imports ?? [IMPORT],
    paiements_assurance_maladie: o.paiements ?? [paiement({ id: 'p1' })],
    paiements_assurance_maladie_mouvements: o.associations ?? [],
  }
}

beforeEach(() => { drapeaux.paiements = true; drapeaux.associations = true; poser() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); drapeaux.paiements = false; drapeaux.associations = false })

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }

// Le code NAF lu par la page, dans une boîte : `undefined` (pas lu) ne doit pas prendre la valeur par défaut.
function rendre(naf: { lu: string | null | undefined } = { lu: '86.90D' }) {
  return render(
    <FournisseurPanneauDroit>
      <ContexteDossier annee="toutes" valides={[]}>
        <BanqueTab dossierId={D} modele={TRESORERIE} assujettiTva={false} ventesParLesFactures={false} statutTva="exonere" codeNaf={naf.lu} />
      </ContexteDossier>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
const sans = (s: string | null) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ')
async function ouvrir(libelle: string) {
  const cellule = (await screen.findAllByText(libelle)).find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  await act(async () => { (cellule.closest('tr') as HTMLElement).click() })
  await within(volet()).findByRole('heading', { name: /Sur un compte de bilan|Écrit sur un compte de bilan/ })
}
const appels = (nom: string) => faux.rpcs.filter((r) => r.nom === nom)

describe('l’association des paiements de l’assurance maladie, dans l’onglet Banque', () => {
  it('drapeaux baissés : aucune des trois tables n’est lue, et ni la fiche ni la section n’en disent rien', async () => {
    drapeaux.paiements = false
    drapeaux.associations = false
    rendre()
    await ouvrir('VIR CPAM 0012345678260303')
    expect(faux.tables.filter((t) => /assurance_maladie/.test(t))).toEqual([])
    expect(screen.queryByRole('heading', { name: /Paiements? de l’assurance maladie/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Le rapprochement avec le relevé' })).toBeNull()
  })

  it('hors d’un code NAF de santé et sans import (NOE4-Q1 (C)) : ni la section ni la fiche n’offrent rien ; la lecture continue', async () => {
    poser({ imports: [] })
    for (const codeNaf of ['69.20Z', null, undefined, 'santé']) {
      const vue = rendre({ lu: codeNaf })
      await ouvrir('VIR CPAM 0012345678260303')
      // La lecture continue : un crédit déjà associé resterait hors des candidats d'une vente.
      await waitFor(() => expect(faux.tables).toContain('paiements_assurance_maladie_mouvements'))
      expect(screen.queryAllByRole('heading').map((h) => `${String(codeNaf)} : ${h.textContent}`).filter((t) => /assurance maladie/.test(t))).toEqual([])
      expect(screen.queryByRole('heading', { name: 'Le rapprochement avec le relevé' })).toBeNull()
      expect(within(volet()).queryByRole('button', { name: /^Associer/ })).toBeNull()
      expect(sans(volet().textContent)).not.toContain('assurance maladie')
      vue.unmount()
      poser({ imports: [] })
    }
  })

  it('dès qu’un import existe (NOE4Q1-Q2 (A)) : la section et la fiche restent offertes, quel que soit le code NAF', async () => {
    for (const codeNaf of ['69.20Z', null, 'santé']) {
      const vue = rendre({ lu: codeNaf })
      await ouvrir('VIR CPAM 0012345678260303')
      expect(await within(volet()).findByRole('button', { name: 'Associer' }), String(codeNaf)).toBeTruthy()
      vue.unmount()
      poser()
    }
  })

  it('NOE5 baissé : les paiements se lisent, pas les associations, et la fiche ne propose rien', async () => {
    drapeaux.associations = false
    rendre()
    await ouvrir('VIR CPAM 0012345678260303')
    await waitFor(() => expect(faux.tables).toContain('paiements_assurance_maladie'))
    expect(faux.tables).not.toContain('paiements_assurance_maladie_mouvements')
    expect(within(volet()).queryByRole('heading', { name: 'Paiement de l’assurance maladie' })).toBeNull()
  })

  it('la fiche propose le paiement, justifié ; deux clics sur « Associer » dans le même act : un seul appel, tel qu’il part', async () => {
    rendre()
    await ouvrir('VIR CPAM 0012345678260303')
    const bouton = await within(volet()).findByRole('button', { name: 'Associer' })
    const texte = sans(volet().textContent)
    expect(texte).toContain('journée comptable du 03/03/2026, organisme régime 1, caisse 691, part obligatoire, 3 factures : même montant au centime ; crédité 2 jours après la journée comptable ; la référence du virement porte la journée comptable.')
    expect(texte).toContain(RESTE_CLASSABLE)
    act(() => { bouton.click(); bouton.click() })
    await waitFor(() => expect(appels('associer_paiements_assurance_maladie')).toHaveLength(1))
    expect(appels('associer_paiements_assurance_maladie')[0].args).toEqual({ p_dossier_id: D, p_paiements: ['p1'], p_lignes: ['m1'] })
  })

  it('à égalité : rien n’est proposé, l’écran le dit, et seul le choix à la main s’offre', async () => {
    poser({
      releve: [mouvement({ id: 'm1', libelle: 'VIR CPAM SANS REFERENCE' })],
      paiements: [paiement({ id: 'p1' }), paiement({ id: 'p2', caisse: 692 })],
    })
    rendre()
    await ouvrir('VIR CPAM SANS REFERENCE')
    expect(await within(volet()).findByText(A_EGALITE_DIT)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Associer' })).toBeNull()
    expect(within(volet()).getAllByRole('button', { name: 'Associer celui-ci' })).toHaveLength(2)
  })

  it('des associations lues en partie : la fiche le dit, la section porte son bandeau, et aucun geste ne s’offre', async () => {
    poser({ associations: [association({ id: 'a9', paiement_id: 'p-autre', ligne_bancaire_id: 'm-autre' })] })
    faux.muet[`paiements_assurance_maladie_mouvements|${COLONNES_ASSOCIATION}`] = 0
    rendre()
    await ouvrir('VIR CPAM 0012345678260303')
    await waitFor(() => expect(within(volet()).getByText(MUET.associations)).toBeTruthy())
    expect(screen.getByText(/Les associations des paiements au relevé n.ont pas pu être/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Le rapprochement avec le relevé' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Associer/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull()
  })

  it('la section : les contrôles, puis le lot, dont la confirmation compte et nomme ce qui part', async () => {
    poser({ releve: [CREDIT, mouvement({ id: 'm2', date: '2026-03-20', montant: 50, libelle: 'VIR CPAM 0012345678260319' })] })
    rendre()
    const lot = await screen.findByRole('button', { name: 'Associer les concordances (1)' })
    expect(sans(screen.getByRole('list', { name: 'Contrôles des paiements de l’assurance maladie' }).textContent))
      .toContain('Crédit de l’assurance maladie du 20/03/2026 (50,00 €) : aucun paiement importé ne le justifie')
    await act(async () => { lot.click() })
    const confirmation = sans(screen.getByText(/^Associer 1 crédit du relevé/).closest('[role="alert"]')?.textContent ?? '')
    expect(confirmation).toContain('Crédit du 05/03/2026 (123,45 €) ← journée comptable du 03/03/2026, organisme régime 1, caisse 691, part obligatoire, 3 factures')
    expect(confirmation).not.toContain('VIR CPAM')
    const confirmer = screen.getByRole('button', { name: 'Associer ce crédit' })
    act(() => { confirmer.click(); confirmer.click() })
    await waitFor(() => expect(appels('associer_paiements_assurance_maladie')).toHaveLength(1))
    expect(appels('associer_paiements_assurance_maladie')[0].args).toEqual({ p_dossier_id: D, p_paiements: ['p1'], p_lignes: ['m1'] })
  })

  it('un crédit associé : ce qu’il justifie, qu’il reste classable, et « Défaire » sur une confirmation qui nomme ce qui part', async () => {
    poser({ associations: [association({ id: 'a1', paiement_id: 'p1', ligne_bancaire_id: 'm1' })] })
    rendre()
    await ouvrir('VIR CPAM 0012345678260303')
    await waitFor(() => expect(sans(volet().textContent)).toContain('Associé au paiement de l’assurance maladie — journée comptable du 03/03/2026'))
    expect(sans(volet().textContent)).toContain(RESTE_CLASSABLE)
    await act(async () => { within(volet()).getByRole('button', { name: 'Défaire l’association…' }).click() })
    expect(sans(volet().textContent)).toContain('Défaire l’association du crédit du 05/03/2026 (123,45 €) : le paiement — journée comptable du 03/03/2026')
    expect(appels('defaire_association_assurance_maladie')).toEqual([])
    await act(async () => { within(volet()).getByRole('button', { name: 'Défaire l’association' }).click() })
    expect(appels('defaire_association_assurance_maladie')).toEqual([{
      nom: 'defaire_association_assurance_maladie', args: { p_dossier_id: D, p_ligne_bancaire_id: 'm1' },
    }])
  })

  it('NOE5B-Q1 (B) : un crédit associé propose la catégorie habituelle des autres ; la choisir n’écrit rien, « Affecter » écrit', async () => {
    const classe = (id: string, date: string) => mouvement({
      id, date, libelle: `VIR CPAM 00123456782602${id.slice(-1)}0`, statut: 'rapprochee', categorie_id: 'c-hon',
    })
    poser({
      releve: [CREDIT, classe('m2', '2026-02-05'), classe('m3', '2026-02-12')],
      paiements: [paiement({ id: 'p1' }), paiement({ id: 'p2', date_journee_comptable: '2026-02-03' }), paiement({ id: 'p3', date_journee_comptable: '2026-02-10' })],
      associations: [
        association({ id: 'a1', paiement_id: 'p1', ligne_bancaire_id: 'm1' }), association({ id: 'a2', paiement_id: 'p2', ligne_bancaire_id: 'm2' }),
        association({ id: 'a3', paiement_id: 'p3', ligne_bancaire_id: 'm3' }),
      ],
    })
    rendre()
    await ouvrir('VIR CPAM 0012345678260303')
    await waitFor(() => expect(sans(volet().textContent)).toContain('le plus souvent classés « Honoraires » (2 sur 2 classés)'))
    const choix = within(volet()).getByLabelText('Catégorie') as HTMLSelectElement
    expect(choix.value).toBe('')
    await act(async () => { within(volet()).getByRole('button', { name: 'Choisir cette catégorie' }).click() })
    expect(choix.value).toBe('c-hon')
    expect(appels('affecter_mouvement_bancaire')).toEqual([])
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    await waitFor(() => expect(appels('affecter_mouvement_bancaire')).toHaveLength(1))
    expect(appels('affecter_mouvement_bancaire')[0].args).toMatchObject({ p_ligne_bancaire_id: 'm1', p_categorie_id: 'c-hon' })
  })

  it('NOE5B-Q1 : rien de proposé sans autre crédit associé classé', async () => {
    poser({ associations: [association({ id: 'a1', paiement_id: 'p1', ligne_bancaire_id: 'm1' })] })
    rendre()
    await ouvrir('VIR CPAM 0012345678260303')
    await waitFor(() => expect(sans(volet().textContent)).toContain('Associé au paiement de l’assurance maladie'))
    expect(within(volet()).queryByRole('button', { name: 'Choisir cette catégorie' })).toBeNull()
  })
})
