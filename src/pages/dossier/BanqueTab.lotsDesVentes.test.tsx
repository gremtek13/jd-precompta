import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { LigneBancaire, Piece } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { COLONNES_ENCAISSEMENTS_ECRITURES } from '../../lib/ecrituresVentesFactureesLecture'
import { REFUS_GARDE_MOUVEMENTS } from '../../lib/encaissementsFactures'

// LES LOTS DU RELEVÉ ÉCARTENT LES MOUVEMENTS DES VENTES FACTURÉES (ligne 28.65, chantier EC-Q3, étape VF5a2). Les plans
// sont éprouvés à part (lib/lotsDuReleve.test.ts) ; ici, le CÂBLAGE : sur un dossier basculé, chaque lot — le rapprochement
// automatique, « Valider et rapprocher », l'affectation par les règles, la règle « toujours ignorer » — n'envoie JAMAIS le
// mouvement réservé à l'encaissement d'une facture, que le faux client verrait partir, et sa carte dit combien elle en
// écarte et pourquoi ; sur des ventes lues en partie, aucun ne part ; un dossier qui n'a pas basculé les envoie comme hier.
// Deux clics puis trois dans le même `act` n'envoient qu'une fois. Données FICTIVES.

const D = 'dossier-de-test'

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  // `table|colonnes` → N : le serveur ne rend que N lignes en annonçant le vrai total (une lecture INCOMPLÈTE).
  muet: {} as Record<string, number>,
  // Chaque écriture qui part : la table, l'opération, la valeur, et les mouvements qu'elle vise (`.eq('id')` ou `.in('id')`).
  ecritures: [] as { table: string; operation: string; valeur: unknown; ids: unknown[] }[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
}))

vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))
vi.mock('../../lib/depot', () => ({ ouvrirJustificatif: async () => {} }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    let operation = 'select'
    let unique = false
    let colonnes = '*'
    let valeur: unknown = null
    const ids: unknown[] = []
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    const soi = () => c
    Object.assign(c, {
      select: (lues?: string) => { if (operation === 'select') colonnes = lues ?? '*'; return c },
      order: soi, neq: soi, gte: soi, lte: soi, lt: soi, gt: soi, is: soi, not: soi, or: soi, limit: soi,
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
      upsert: (v: unknown) => { operation = 'upsert'; valeur = v; return c },
      delete: () => { operation = 'delete'; return c },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
        if (operation !== 'select') {
          faux.ecritures.push({ table, operation, valeur, ids: [...ids] })
          return Promise.resolve({ data: null, error: null }).then(suite, echec)
        }
        if (unique) return Promise.resolve({ data: null, error: null }).then(suite, echec)
        const cle = `${table}|${colonnes}`
        const toutes = filtrer(faux.parTable[table] ?? [], predicats)
        const muet = faux.muet[cle]
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
    dossier_id: D, date: '2026-06-02', montant: -100, libelle: 'PRLV SEPA FICTIF', libelle_brut: null,
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
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    created_at: '2026-06-01T09:00:00Z', updated_at: '2026-06-01T09:00:00Z', ...o,
  }
}

const facture = (id: string, numero: string, montant: number) => ({
  id, dossier_id: D, statut: 'validee', type: 'facture', numero, date_emission: '2026-05-20', tiers_nom: 'Client fictif',
  facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services', option_debits: false, date_prestation: null,
  montant_ttc: montant,
})
const encaissement = (id: string, facture_id: string, montant: number, ligne_bancaire_id: string) => ({
  id, facture_id, montant, ligne_bancaire_id, dossier_id: D, date_encaissement: '2026-06-03', moyen: 'virement', annule_id: null,
  cree_le: '2026-06-03T10:00:00Z', retire_le: null, compte_contrepartie: null, cree_par: 'cabinet-1',
})

// Trois mouvements RÉSERVÉS, chacun pris par un lot s'il ne portait pas l'encaissement d'une facture : un crédit qu'une pièce
// validée rapprocherait seule (le rapprochement automatique), un crédit qu'une pièce à valider confirme par ses trois signaux
// (« Valider et rapprocher »), un crédit qu'une règle range en recette (l'affectation, et la règle « toujours ignorer »).
// Chacun a son jumeau LIBRE, que son lot prend ; et un mouvement CLASSÉ, déjà rapproché.
const RES_AUTO = mouvement({ id: 'm-res-auto', date: '2026-06-03', montant: 600, libelle: 'VIR SARL HORIZON F2026-0014' })
const RES_CERT = mouvement({ id: 'm-res-cert', date: '2026-06-04', montant: 250, libelle: 'VIR BETA CONSEIL F2026-0016' })
const RES_REGLE = mouvement({ id: 'm-res-regle', date: '2026-06-05', montant: 120, libelle: 'VIR GAMMA SANTE F2026-0017' })
const LIBRE_AUTO = mouvement({ id: 'm-libre-auto', libelle: 'PRLV ATELIER FICTIF' })
const LIBRE_CERT = mouvement({ id: 'm-libre-cert', date: '2026-06-05', montant: -75, libelle: 'CB IMPRIMERIE FICTIVE' })
const LIBRE_REGLE = mouvement({ id: 'm-libre-regle', date: '2026-06-06', montant: 80, libelle: 'VIR GAMMA SANTE ACOMPTE' })
const CLASSE = mouvement({
  id: 'm-cls', date: '2026-06-07', montant: 478.5, libelle: 'VIR CABINET DURAND', statut: 'rapprochee', encaissements_de_factures: true,
})

const MOTS = (numero: string) => REFUS_GARDE_MOUVEMENTS[3].modele.replace('%', numero)

function poser() {
  faux.muet = {}
  faux.ecritures = []
  faux.rpcs = []
  faux.parTable = {
    lignes_bancaires: [RES_AUTO, RES_CERT, RES_REGLE, LIBRE_AUTO, LIBRE_CERT, LIBRE_REGLE, CLASSE] as unknown as Record<string, unknown>[],
    pieces: [
      piece({ id: 'p-auto' }),
      piece({ id: 'p-res-auto', type_piece: 'vente', tiers: 'Cliente Alpha', montant_ttc: 600, date_piece: '2026-06-02' }),
      piece({ id: 'p-cert', tiers: 'Imprimerie fictive', montant_ttc: 75, date_piece: '2026-06-05', statut: 'a_valider' }),
      piece({ id: 'p-res-cert', type_piece: 'vente', tiers: 'Beta Conseil', montant_ttc: 250, date_piece: '2026-06-03', statut: 'a_valider' }),
    ] as unknown as Record<string, unknown>[],
    categories: [{ id: 'c-rec', dossier_id: D, code: 'recettes', libelle: 'Recettes', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes' }],
    regles_affectation_bancaire: [{
      id: 'r-gamma', dossier_id: D, motif: 'gamma', sens: 'encaissement', categorie_id: 'c-rec', taux_tva: null,
      created_at: '2026-01-01T00:00:00Z',
    }],
    factures_emises: [
      facture('f1', 'F2026-0014', 600), facture('f2', 'F2026-0015', 480), facture('f3', 'F2026-0016', 250), facture('f4', 'F2026-0017', 120),
    ],
    facture_lignes: [['f1', 500], ['f2', 400], ['f3', 250], ['f4', 120]].map(([f, ht], i) => ({
      id: `fl${i}`, facture_id: f, ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: ht, taux_tva: 0,
    })),
    encaissements_factures: [
      encaissement('e1', 'f1', 600, 'm-res-auto'), encaissement('e2', 'f2', 480, 'm-cls'),
      encaissement('e3', 'f3', 250, 'm-res-cert'), encaissement('e4', 'f4', 120, 'm-res-regle'),
    ],
    encaissements_factures_taux: [['e1', 600], ['e2', 480], ['e3', 250], ['e4', 120]].map(([e, m]) => ({
      encaissement_id: e, dossier_id: D, taux: 0, montant: m,
    })),
    memberships: [],
  }
}

beforeEach(poser)
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

function rendre(ventesParLesFactures = true) {
  return render(
    <FournisseurPanneauDroit>
      <ContexteDossier annee="toutes" valides={[]}>
        <BanqueTab dossierId={D} modele={TRESORERIE} assujettiTva={false} ventesParLesFactures={ventesParLesFactures} statutTva="redevable" />
      </ContexteDossier>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
const espaces = (s: string) => s.replace(/\s/g, ' ')
const texteDe = (e: Element | null) => espaces(e?.textContent ?? '')

// Les mouvements qu'une écriture du relevé vise, et les écritures de pièces.
const mouvementsEcrits = () => faux.ecritures.filter((e) => e.table === 'lignes_bancaires' && e.operation === 'update').flatMap((e) => e.ids)
const piecesValidees = () => faux.ecritures.filter((e) => e.table === 'pieces' && e.operation === 'update').flatMap((e) => e.ids)
const affectes = () => faux.rpcs.filter((r) => r.nom === 'affecter_mouvements_bancaires')
  .flatMap((r) => (r.args.p_affectations as { ligne_bancaire_id: string }[]).map((a) => a.ligne_bancaire_id))

async function lot(nom: string | RegExp): Promise<HTMLButtonElement> {
  return await screen.findByRole('button', { name: nom }) as HTMLButtonElement
}
async function cliquer(bouton: HTMLElement, fois: number) {
  await act(async () => { for (let i = 0; i < fois; i++) bouton.click() })
}
// La carte d'un lot : le `details` qui dit ce qu'il écarte.
function ecartDe(lotNom: string): HTMLElement {
  const resume = screen.getAllByText((_, e) => e?.tagName === 'SUMMARY' && texteDe(e).startsWith(`${lotNom} — `))
  expect(resume).toHaveLength(1)
  return resume[0].closest('details') as HTMLElement
}
async function ligneDuReleve(libelle: string): Promise<HTMLElement> {
  const cellule = (await screen.findAllByText(libelle)).find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  return cellule.closest('tr') as HTMLElement
}
async function ouvrir(libelle: string) {
  const ligne = await ligneDuReleve(libelle)
  await act(async () => { ligne.click() })
}

describe('un dossier basculé, ses ventes facturées lues en entier : aucun lot n’envoie un mouvement réservé', () => {
  it('le rapprochement automatique : le mouvement libre part, le réservé non ; la carte dit lequel, et pourquoi', async () => {
    rendre()
    const bouton = await lot('Tout rapprocher automatiquement (1)')
    const ecart = ecartDe('Rapprochement automatique')
    expect(texteDe(ecart.querySelector('summary'))).toBe('Rapprochement automatique — 1 mouvement écarté : il porte des encaissements de factures.')
    expect(texteDe(ecart.querySelector('li'))).toBe(`03/06/2026 — VIR SARL HORIZON F2026-0014 — 600,00 € : ${MOTS('F2026-0014')}`)
    // Le réservé n'est pas compté parmi les ambigus.
    expect(screen.queryByText(/ont plusieurs pièces ou échéances possibles/)).toBeNull()
    await cliquer(bouton, 1)
    await waitFor(() => expect(mouvementsEcrits()).toEqual(['m-libre-auto']))
    expect(faux.rpcs.filter((r) => r.nom === 'rapprocher_cotisation')).toEqual([])
  })

  it('« Valider et rapprocher » : la paire du réservé ne part pas — ni la pièce validée, ni le mouvement rapproché', async () => {
    rendre()
    const bouton = await lot('Valider et rapprocher cette pièce')
    const ecart = ecartDe('Validation en lot')
    expect(texteDe(ecart.querySelector('summary'))).toBe('Validation en lot — 1 mouvement écarté : il porte des encaissements de factures.')
    expect(texteDe(ecart.querySelector('li'))).toBe(`04/06/2026 — VIR BETA CONSEIL F2026-0016 — 250,00 € : ${MOTS('F2026-0016')}`)
    await cliquer(bouton, 1)
    await waitFor(() => expect(mouvementsEcrits()).toEqual(['m-libre-cert']))
    expect(piecesValidees()).toEqual(['p-cert'])
  })

  it('une validation en lot qui n’aurait pris que le réservé : la carte dit ce qu’elle écarte, sans bouton', async () => {
    faux.parTable.pieces = faux.parTable.pieces.filter((p) => p.id !== 'p-cert')
    rendre()
    const ecart = await waitFor(() => ecartDe('Validation en lot'))
    const carte = ecart.closest('.card') as HTMLElement
    expect(texteDe(within(carte).getByRole('heading', { level: 3 }))).toBe('Sans doute possible (0)')
    expect(within(carte).queryByRole('button')).toBeNull()
    expect(within(carte).queryByRole('table')).toBeNull()
  })

  it('l’affectation par les règles : le réservé que la règle désigne ne part pas, et la carte le dit', async () => {
    rendre()
    const bouton = await lot('Affecter ce mouvement')
    const ecart = ecartDe('Affectation par les règles')
    expect(texteDe(ecart.querySelector('li'))).toBe(`05/06/2026 — VIR GAMMA SANTE F2026-0017 — 120,00 € : ${MOTS('F2026-0017')}`)
    // Ni à rapprocher, ni refusé, ni en conflit.
    expect(screen.queryByText(/à rapprocher plutôt qu'affecter/)).toBeNull()
    await cliquer(bouton, 1)
    await waitFor(() => expect(affectes()).toEqual(['m-libre-regle']))
  })

  it('la règle « toujours ignorer » : la mise à jour n’emporte pas le réservé, et l’écran dit combien elle en laisse', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('gamma')
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('VIR GAMMA SANTE ACOMPTE')
    await cliquer(within(volet()).getByRole('button', { name: 'Toujours ignorer ce type…' }), 1)
    await waitFor(() => expect(mouvementsEcrits()).toEqual(['m-libre-regle']))
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(faux.ecritures.filter((e) => e.table === 'regles_bancaires_ignorees').map((e) => e.valeur)).toEqual([{ dossier_id: D, motif: 'gamma' }])
    expect(alerte).toHaveBeenCalledTimes(1)
    expect(espaces(String(alerte.mock.calls[0][0]))).toContain('1 mouvement écarté : il porte des encaissements de factures.')
    expect(espaces(String(alerte.mock.calls[0][0]))).toContain(`05/06/2026 — VIR GAMMA SANTE F2026-0017 — 120,00 € : ${MOTS('F2026-0017')}`)
  })

  it('la règle qu’on retiendrait depuis une fiche ne compte pas le réservé parmi ceux qu’elle proposera', async () => {
    rendre()
    await ouvrir('VIR GAMMA SANTE ACOMPTE')
    await act(async () => { within(volet()).getByRole('checkbox', { name: /^Retenir : proposer aussi les autres encaissements/ }).click() })
    expect(within(volet()).getByText(/^Aucun autre mouvement à traiter ne le contient pour l’instant/)).toBeTruthy()
  })

  it('les comptes : le réservé se compte à part, avec son total ; jamais parmi les non rapprochés', async () => {
    rendre()
    const ecarts = (await screen.findByRole('heading', { name: 'Écarts à vérifier' })).closest('.card') as HTMLElement
    await waitFor(() => expect(texteDe(ecarts.querySelector('p'))).toContain(
      '3 mouvement(s) bancaire(s) non rapproché(s) (-95,00 €) · 3 mouvement(s) réservé(s) à des encaissements de factures, à '
      + 'classer par eux (970,00 €) · ',
    ))
  })
})

describe('deux clics, puis trois, dans le même act : un seul envoi par lot', () => {
  for (const fois of [2, 3]) {
    it(`${fois} clics sur chaque lot`, async () => {
      vi.spyOn(window, 'prompt').mockReturnValue('gamma')
      vi.spyOn(window, 'alert').mockImplementation(() => {})
      rendre()
      await cliquer(await lot('Tout rapprocher automatiquement (1)'), fois)
      await waitFor(() => expect(mouvementsEcrits()).toEqual(['m-libre-auto']))
      await cliquer(await lot('Valider et rapprocher cette pièce'), fois)
      await waitFor(() => expect(mouvementsEcrits()).toEqual(['m-libre-auto', 'm-libre-cert']))
      expect(piecesValidees()).toEqual(['p-cert'])
      await cliquer(await lot('Affecter ce mouvement'), fois)
      await waitFor(() => expect(affectes()).toEqual(['m-libre-regle']))
      expect(faux.rpcs.filter((r) => r.nom === 'affecter_mouvements_bancaires')).toHaveLength(1)
      await ouvrir('VIR GAMMA SANTE ACOMPTE')
      await cliquer(within(volet()).getByRole('button', { name: 'Toujours ignorer ce type…' }), fois)
      await waitFor(() => expect(faux.ecritures.filter((e) => e.table === 'regles_bancaires_ignorees')).toHaveLength(1))
      await waitFor(() => expect(mouvementsEcrits()).toEqual(['m-libre-auto', 'm-libre-cert', 'm-libre-regle']))
    })
  }
})

describe('ses ventes facturées lues en partie : aucun lot ne part', () => {
  it('ni le rapprochement automatique, ni la validation en lot, ni les règles, ni « toujours ignorer » ; les comptes le disent', async () => {
    faux.muet = { [`encaissements_factures|${COLONNES_ENCAISSEMENTS_ECRITURES}`]: 1 }
    vi.spyOn(window, 'prompt').mockReturnValue('gamma')
    rendre()
    await screen.findByText(/^Les ventes facturées du dossier n.ont pas pu être lues en entier/)
    // On ne sait pas lesquels sont réservés : les plans d'hier s'affichent, suspendus, et rien ne s'en écarte.
    for (const nom of ['Tout rapprocher automatiquement (2)', 'Valider et rapprocher les 2', 'Affecter les 2']) {
      const bouton = await lot(nom)
      expect(bouton.disabled, nom).toBe(true)
      await cliquer(bouton, 2)
    }
    expect(screen.queryByText(/ — \d+ mouvements? écartés? :/)).toBeNull()
    await ouvrir('VIR GAMMA SANTE ACOMPTE')
    expect(within(volet()).queryByRole('button', { name: 'Toujours ignorer ce type…' })).toBeNull()
    expect(faux.ecritures).toEqual([])
    expect(faux.rpcs).toEqual([])
    const ecarts = screen.getByRole('heading', { name: 'Écarts à vérifier' }).closest('.card') as HTMLElement
    expect(texteDe(ecarts.querySelector('p'))).toContain(
      '6 mouvement(s) bancaire(s) non rapproché(s) (875,00 €), dont peut-être des mouvements réservés à des encaissements de '
      + 'factures : les ventes facturées du dossier ne sont pas lues en entier',
    )
  })
})

describe('un dossier qui n’a pas basculé : les lots comme hier', () => {
  it('chaque lot prend aussi le mouvement « réservé » — il n’existe pas en base — et aucune carte n’écarte rien', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('gamma')
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre(false)
    const ecarts = (await screen.findByRole('heading', { name: 'Écarts à vérifier' })).closest('.card') as HTMLElement
    await waitFor(() => expect(texteDe(ecarts.querySelector('p'))).toContain('6 mouvement(s) bancaire(s) non rapproché(s) (875,00 €) · '))
    expect(screen.queryByText(/ — \d+ mouvements? écartés? :/)).toBeNull()
    await cliquer(await lot('Tout rapprocher automatiquement (2)'), 1)
    await waitFor(() => expect([...mouvementsEcrits()].sort()).toEqual(['m-libre-auto', 'm-res-auto']))
    faux.ecritures = []
    await cliquer(await lot('Valider et rapprocher les 2'), 1)
    await waitFor(() => expect([...mouvementsEcrits()].sort()).toEqual(['m-libre-cert', 'm-res-cert']))
    await cliquer(await lot('Affecter les 2'), 1)
    await waitFor(() => expect([...affectes()].sort()).toEqual(['m-libre-regle', 'm-res-regle']))
  })

  it('la règle « toujours ignorer » emporte tous les mouvements qu’elle reconnaît, sans rien dire de plus', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('gamma')
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre(false)
    await ouvrir('VIR GAMMA SANTE ACOMPTE')
    await cliquer(within(volet()).getByRole('button', { name: 'Toujours ignorer ce type…' }), 1)
    await waitFor(() => expect([...mouvementsEcrits()].sort()).toEqual(['m-libre-regle', 'm-res-regle']))
    expect(alerte).not.toHaveBeenCalled()
  })
})
