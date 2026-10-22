import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import { facture as factureCii } from '../../test/facturesCii'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { FactureEmise, LigneBancaire } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import {
  COLONNES_ENCAISSEMENTS_ECRITURES, COLONNES_FACTURES_ECRITURES, COLONNES_MOUVEMENTS_ECRITURES, NOMS_DES_LECTURES_ECRITURES,
} from '../../lib/ecrituresVentesFactureesLecture'
import { COLONNES_LIGNES, COLONNES_PARTS } from '../../lib/ventesFactureesLecture'
import { REFUS_CLASSEMENT, REFUS_RATTACHEMENT, REFUS_RETRAIT_CLASSEMENT, remplirModele } from '../../lib/encaissementsFactures'
import { TITRE_CLASSER, TITRE_ENREGISTRER, TITRE_RATTACHER, TITRE_RETIRER } from '../../lib/mouvementsDesVentes'

// LA FICHE D'UN CRÉDIT : « ENCAISSEMENT D'UNE FACTURE » (ligne 28.65, chantier EC-Q3, étape VF5c). La règle est éprouvée à
// part (lib/gestesDuCredit.test.ts) ; ici, le CÂBLAGE de l'onglet Banque, côté cabinet, sur un dossier basculé : les trois
// gestes — classer un mouvement réservé par ses encaissements, retirer ce classement, rattacher un encaissement enregistré
// sans mouvement — partent par leur fonction de la base SEULE, avec leurs paramètres, après une confirmation qui nomme ce
// qu'ils font, puis l'onglet relit ; chaque refus de la base est dit avant le clic, le bouton grisé, et celui qui revient
// après le clic est dit puis suivi d'une relecture ; deux clics puis trois dans le même `act` n'envoient qu'une fois ;
// « Enregistrer l'encaissement d'une facture » ouvre la fenêtre des encaissements sur la facture choisie, le mouvement
// IMPOSÉ ; sur des ventes facturées lues en partie ou pas encore revenues, rien de cela ne s'offre. Données FICTIVES.

const D = 'dossier-de-test'

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  // `table|colonnes` → N : le serveur ne rend que N lignes en annonçant le vrai total (une lecture INCOMPLÈTE).
  muet: {} as Record<string, number>,
  // `table|colonnes` → la PROCHAINE lecture retenue jusqu'à `liberer` (une relecture pas encore revenue).
  retenir: {} as Record<string, boolean>,
  liberer: [] as (() => void)[],
  // Chaque lecture partie, `table|colonnes`.
  demandes: [] as string[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  // Le refus que la base oppose au prochain appel, s'il en est un.
  erreurRpc: null as string | null,
}))

vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))
vi.mock('../../lib/depot', () => ({ ouvrirJustificatif: async () => {} }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
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
      eq: (colonne: string, valeur: unknown) => {
        // Les lignes d'une facture se filtrent par leur facture, comme en base.
        if (colonne.startsWith('factures_emises.')) {
          const champ = colonne.slice('factures_emises.'.length)
          predicats.push((l) => (faux.parTable.factures_emises ?? []).some((f) => f.id === l.facture_id && f[champ] === valeur))
        } else predicats.push(predicatEq(colonne, valeur))
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
        const cle = `${table}|${colonnes}`
        faux.demandes.push(cle)
        const toutes = filtrer(faux.parTable[table] ?? [], predicats)
        const muet = faux.muet[cle]
        const reponse = { data: toutes.slice(debut, Math.min(fin + 1, muet ?? Number.MAX_SAFE_INTEGER)), error: null, count: toutes.length }
        if (faux.retenir[cle]) {
          faux.retenir[cle] = false
          return new Promise((resoudre) => { faux.liberer.push(() => resoudre(reponse)) }).then(suite, echec)
        }
        return Promise.resolve(reponse).then(suite, echec)
      },
    })
    return c
  }
  // Ce que font les trois fonctions du cabinet (supabase/schema/20261019070229_encaissements_de_la_vente_facturee.sql), sans
  // leurs refus : l'écran les dit avant le clic, et `erreurRpc` joue celui qui revient après.
  const rpc = (nom: string, args: Record<string, unknown> = {}) => {
    faux.rpcs.push({ nom, args })
    if (faux.erreurRpc) return Promise.resolve({ data: null, error: { message: faux.erreurRpc } })
    const lignes = faux.parTable.lignes_bancaires
    if (nom === 'classer_mouvement_par_encaissements' || nom === 'retirer_classement_par_encaissements') {
      const classe = nom === 'classer_mouvement_par_encaissements'
      faux.parTable.lignes_bancaires = lignes.map((l) => (l.id === args.p_ligne_bancaire_id
        ? { ...l, encaissements_de_factures: classe, statut: classe ? 'rapprochee' : 'non_rapprochee' }
        : l))
    } else if (nom === 'rattacher_mouvement_encaissement') {
      faux.parTable.encaissements_factures = faux.parTable.encaissements_factures.map((e) => (e.id === args.p_encaissement_id
        ? { ...e, ligne_bancaire_id: args.p_ligne_bancaire_id }
        : e))
    }
    return Promise.resolve({ data: null, error: null })
  }
  const functions = {
    invoke: async (nom: string) => {
      if (nom === 'banque-connexion') return { data: { configuree: false, connexion: null }, error: null }
      // La fenêtre des encaissements lit la connexion à la plateforme du client (en base, sans l'appeler).
      if (nom === 'plateforme-agreee') return { data: { connexion: null }, error: null }
      throw new Error(`Appel de fonction non attendu : ${nom}`)
    },
  }
  return { supabase: { from: (table: string) => chaine(table), rpc, functions } }
})

function mouvement(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire {
  return {
    dossier_id: D, date: '2026-06-02', montant: 100, libelle: 'VIR FICTIF', libelle_brut: null,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
    reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-06-02T09:00:00Z',
    encaissements_de_factures: false, ...o,
  }
}

// Une facture SOURCE de sa vente, au taux de 20 %.
function facture(id: string, numero: string, tiers: string, ht: number): FactureEmise {
  return factureCii([{ ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: ht, taux_tva: 20 }], {
    id, dossier_id: D, numero, tiers_nom: tiers, date_emission: '2026-05-20', source_de_la_vente: true,
  })
}
const encaissement = (o: Record<string, unknown> & { id: string; facture_id: string; montant: number }) => ({
  dossier_id: D, date_encaissement: '2026-06-03', moyen: 'virement', ligne_bancaire_id: null, annule_id: null, motif: null,
  cree_le: '2026-06-03T10:00:00Z', retire_le: null, retire_par: null, compte_contrepartie: null, cree_par: 'cabinet-1', ...o,
})

// RÉSERVÉ : un virement que l'encaissement de F2026-0014 fait exactement. CLASSÉ : un virement classé par celui de
// F2026-0015, à 1,50 € de frais près. PARTIEL : une remise de chèques dont un seul est rattaché (300 € sur 500 €).
// LIBRE : un crédit de 120 € que rien ne cite. Deux encaissements sans mouvement : un chèque de 200 € de F2026-0018, un de
// 120 € de F2026-0015 ; et F2026-0017 (120 €), que rien n'a encaissé. (Deux chèques d'une même facture ne se rattachent pas
// au même mouvement : la base le refuse, et le module le dit.)
const RESERVE = mouvement({ id: 'm-res', date: '2026-06-03', montant: 600, libelle: 'VIR SARL HORIZON F2026-0014' })
const CLASSE = mouvement({
  id: 'm-cls', date: '2026-06-04', montant: 478.5, libelle: 'VIR CABINET DURAND', statut: 'rapprochee', encaissements_de_factures: true,
})
const PARTIEL = mouvement({ id: 'm-part', date: '2026-06-05', montant: 500, libelle: 'REMISE CHEQUES 2 FACTURES' })
const LIBRE = mouvement({ id: 'm-lib', date: '2026-06-06', montant: 120, libelle: 'REMISE CHEQUE 120' })

function poser() {
  faux.muet = {}
  faux.retenir = {}
  faux.liberer = []
  faux.demandes = []
  faux.rpcs = []
  faux.erreurRpc = null
  const factures = [
    facture('f1', 'F2026-0014', 'SARL Horizon', 500), facture('f2', 'F2026-0015', 'Cabinet Durand', 500),
    facture('f3', 'F2026-0016', 'Atelier Martin', 500), facture('f4', 'F2026-0017', 'Studio Bleu', 100),
    facture('f5', 'F2026-0018', 'Cabinet Rivière', 250),
  ]
  const encaissements = [
    encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm-res' }),
    encaissement({ id: 'e2', facture_id: 'f2', montant: 480, ligne_bancaire_id: 'm-cls' }),
    encaissement({ id: 'e6', facture_id: 'f3', montant: 300, ligne_bancaire_id: 'm-part', moyen: 'cheque' }),
    encaissement({ id: 'e5', facture_id: 'f5', montant: 200, moyen: 'cheque', date_encaissement: '2026-06-02' }),
    encaissement({ id: 'e3', facture_id: 'f2', montant: 120, moyen: 'cheque', date_encaissement: '2026-06-01' }),
  ]
  faux.parTable = {
    lignes_bancaires: [RESERVE, CLASSE, PARTIEL, LIBRE] as unknown as Record<string, unknown>[],
    factures_emises: factures as unknown as Record<string, unknown>[],
    facture_lignes: factures.map((f, i) => ({
      id: `fl${i + 1}`, facture_id: f.id, ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: f.montant_ht,
      taux_tva: 20,
    })),
    encaissements_factures: encaissements,
    encaissements_factures_taux: encaissements.map((e) => ({ encaissement_id: e.id, dossier_id: D, taux: 20, montant: e.montant })),
  }
}

beforeEach(poser)
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

function rendre(o: { ventesParLesFactures?: boolean; valides?: readonly number[] } = {}) {
  return render(
    <FournisseurPanneauDroit>
      <ContexteDossier annee="toutes" valides={o.valides ?? []}>
        <BanqueTab dossierId={D} modele={TRESORERIE} assujettiTva={false} ventesParLesFactures={o.ventesParLesFactures ?? true} statutTva="redevable" />
      </ContexteDossier>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
const texteDe = (e: Element | null) => (e?.textContent ?? '').replace(/\s/g, ' ')

// La ligne du relevé, cherchée HORS de l'`act`.
async function ouvrir(libelle: string) {
  const cellule = (await screen.findAllByText(libelle)).find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  await act(async () => { (cellule.closest('tr') as HTMLElement).click() })
}
async function tous() {
  const bouton = await screen.findByRole('button', { name: 'Tous' })
  await act(async () => { bouton.click() })
}
async function cliquer(bouton: HTMLElement, fois = 1) {
  await act(async () => { for (let i = 0; i < fois; i++) bouton.click() })
}
const section = (nom: string) => within(volet()).queryByRole('region', { name: nom })
const boutonDe = (nom: string, libelle: string) => within(section(nom) as HTMLElement).getByRole('button', { name: libelle }) as HTMLButtonElement
const choisir = (libelle: string, valeur: string) => {
  fireEvent.change(within(volet()).getByLabelText(libelle), { target: { value: valeur } })
}
const options = (libelle: string) => [...(within(volet()).getByLabelText(libelle) as HTMLSelectElement).options].map((o) => o.value)
const relevesLus = () => faux.demandes.filter((d) => d === 'lignes_bancaires|*').length
// Les gestes de l'étape VF5c que la fiche offre.
const GESTES_VF5C = [TITRE_CLASSER, TITRE_RETIRER, 'Rattacher', 'Enregistrer…']
const gestesNeufs = () => within(volet()).queryAllByRole('button').map((b) => texteDe(b).trim()).filter((n) => GESTES_VF5C.includes(n))

function confirmer(reponse = true) {
  const questions: string[] = []
  // Les espaces insécables des montants, ramenés à des espaces.
  vi.spyOn(window, 'confirm').mockImplementation((q?: string) => { questions.push((q ?? '').replace(/[\u00a0\u202f]/g, ' ')); return reponse })
  return questions
}

describe('un mouvement RÉSERVÉ : classer par ses encaissements', () => {
  it('la phrase, la confirmation qui nomme la facture et le montant, l’appel et ses paramètres, puis la relecture', async () => {
    const questions = confirmer()
    rendre()
    await ouvrir('VIR SARL HORIZON F2026-0014')
    expect(texteDe(section(TITRE_CLASSER))).toContain('Ses encaissements font exactement le crédit, 600,00 €.')
    // Rien ne reste à faire du crédit : ni rattachement, ni facture à encaisser.
    expect(section(TITRE_RATTACHER)).toBeNull()
    expect(section(TITRE_ENREGISTRER)).toBeNull()
    const avant = relevesLus()
    await cliquer(boutonDe(TITRE_CLASSER, TITRE_CLASSER))
    expect(questions).toHaveLength(1)
    expect(questions[0]).toBe(
      'Classer ce crédit du 03/06/2026 de 600,00 € par ses encaissements ?\n\n'
      + '— Facture F2026-0014 (SARL Horizon) — virement du 03/06/2026 : 600,00 €\n\n'
      + 'Aucun frais bancaire : ses encaissements font exactement le crédit. Il sera rapproché par eux, et ne recevra plus aucun '
      + 'autre classement ; ses écritures se passent ensuite dans l’onglet Écritures, section « Ventes facturées ».',
    )
    expect(faux.rpcs).toEqual([{ nom: 'classer_mouvement_par_encaissements', args: { p_dossier_id: D, p_ligne_bancaire_id: 'm-res' } }])
    // Relu : le mouvement est classé, sa fiche offre de retirer ce classement.
    await waitFor(() => expect(section(TITRE_RETIRER)).not.toBeNull())
    expect(relevesLus()).toBeGreaterThan(avant)
    expect([...volet().querySelectorAll('.fiche-mouvement-etat .badge')].map((b) => texteDe(b))).toEqual(['Encaissements de factures — F2026-0014'])
  })

  it.each([
    ['classer', 'VIR SARL HORIZON F2026-0014', TITRE_CLASSER, TITRE_CLASSER, null],
    ['retirer', 'VIR CABINET DURAND', TITRE_RETIRER, TITRE_RETIRER, null],
    ['rattacher', 'REMISE CHEQUE 120', TITRE_RATTACHER, 'Rattacher', 'e3'],
  ] as const)('la confirmation refusée — %s : rien ne part', async (_nom, libelle, nomSection, bouton, encaissementChoisi) => {
    const questions = confirmer(false)
    rendre()
    await tous()
    await ouvrir(libelle)
    if (encaissementChoisi) choisir('Encaissement à rattacher', encaissementChoisi)
    await cliquer(boutonDe(nomSection, bouton))
    expect(questions).toHaveLength(1)
    expect(faux.rpcs).toEqual([])
  })

  it('une remise pas encore faite : le refus de la base avant le clic, le bouton grisé ; ce qui reste, et de quoi le faire', async () => {
    confirmer()
    rendre()
    await ouvrir('REMISE CHEQUES 2 FACTURES')
    const classer = section(TITRE_CLASSER) as HTMLElement
    expect(texteDe(classer)).toContain('Ses encaissements font 300,00 € pour un crédit de 500,00 € : il reste 200,00 € à rattacher')
    expect(within(classer).getByText(remplirModele(REFUS_CLASSEMENT.find((r) => r.cle === 'credit_non_fait')?.modele ?? '', ['300,00', '500,00'])))
      .toBeTruthy()
    expect(boutonDe(TITRE_CLASSER, TITRE_CLASSER).disabled).toBe(true)
    await cliquer(boutonDe(TITRE_CLASSER, TITRE_CLASSER))
    // Le plus proche de ce qui reste d'abord : le chèque de 200 €, puis celui de 120 € ; les factures qui restent à encaisser
    // — 120 €, puis 300 € et 100 €, à égale distance, par leur numéro.
    expect(options('Encaissement à rattacher')).toEqual(['', 'e5', 'e3'])
    expect(options('Facture à encaisser')).toEqual(['', 'f4', 'f3', 'f5'])
    expect(faux.rpcs).toEqual([])
  })
})

describe('un mouvement CLASSÉ : retirer ce classement', () => {
  it('la confirmation dit que ses écritures deviennent « à retirer » ; l’appel et ses paramètres ; relu, il redevient réservé', async () => {
    const questions = confirmer()
    rendre()
    await tous()
    await ouvrir('VIR CABINET DURAND')
    await cliquer(boutonDe(TITRE_RETIRER, TITRE_RETIRER))
    expect(questions[0]).toContain('Retirer le classement de ce crédit du 04/06/2026 de 478,50 € par ses encaissements (facture F2026-0015) ?')
    expect(questions[0]).toContain('Ses écritures, s’il en a été passé, deviennent « à retirer » dans l’onglet Écritures, section « Ventes facturées »')
    expect(faux.rpcs).toEqual([{ nom: 'retirer_classement_par_encaissements', args: { p_dossier_id: D, p_ligne_bancaire_id: 'm-cls' } }])
    await waitFor(() => expect(section(TITRE_CLASSER)).not.toBeNull())
    expect(boutonDe(TITRE_CLASSER, TITRE_CLASSER).disabled).toBe(false)
  })

  it('daté d’un exercice validé : le refus de la base avant le clic, le bouton grisé, rien ne part', async () => {
    confirmer()
    rendre({ valides: [2026] })
    await tous()
    await ouvrir('VIR CABINET DURAND')
    const retrait = section(TITRE_RETIRER) as HTMLElement
    expect(within(retrait).getByText(remplirModele(REFUS_RETRAIT_CLASSEMENT.find((r) => r.cle === 'frontiere')?.modele ?? '', ['L\'exercice 2026 est validé'])))
      .toBeTruthy()
    expect(boutonDe(TITRE_RETIRER, TITRE_RETIRER).disabled).toBe(true)
    await cliquer(boutonDe(TITRE_RETIRER, TITRE_RETIRER))
    expect(faux.rpcs).toEqual([])
  })
})

describe('rattacher un encaissement enregistré sans mouvement', () => {
  it('sur la remise : le chèque qui la fait, la confirmation et l’état d’après, l’appel ; relue, elle se classe', async () => {
    const questions = confirmer()
    rendre()
    await ouvrir('REMISE CHEQUES 2 FACTURES')
    choisir('Encaissement à rattacher', 'e5')
    await cliquer(boutonDe(TITRE_RATTACHER, 'Rattacher'))
    expect(questions[0]).toContain('Rattacher à ce crédit du 05/06/2026 de 500,00 € l’encaissement suivant ?')
    expect(questions[0]).toContain('— Facture F2026-0018 (Cabinet Rivière) — chèque du 02/06/2026 : 200,00 €')
    expect(questions[0]).toContain('Ses encaissements feront alors le crédit : il restera à le classer par eux.')
    expect(faux.rpcs).toEqual([{
      nom: 'rattacher_mouvement_encaissement', args: { p_dossier_id: D, p_encaissement_id: 'e5', p_ligne_bancaire_id: 'm-part' },
    }])
    await waitFor(() => expect(boutonDe(TITRE_CLASSER, TITRE_CLASSER).disabled).toBe(false))
    expect(texteDe(section(TITRE_CLASSER))).toContain('Ses encaissements font exactement le crédit, 500,00 €.')
  })

  it('sur un crédit libre : le refus de la base avant le clic pour un chèque trop grand ; le bon, admis', async () => {
    confirmer()
    rendre()
    await ouvrir('REMISE CHEQUE 120')
    expect(section(TITRE_CLASSER)).toBeNull()
    expect(options('Encaissement à rattacher')).toEqual(['', 'e3', 'e5'])
    choisir('Encaissement à rattacher', 'e5')
    const refus = remplirModele(REFUS_RATTACHEMENT.find((r) => r.cle === 'mouvement_depasse')?.modele ?? '', ['120,00', '200,00'])
    expect(within(section(TITRE_RATTACHER) as HTMLElement).getByText(refus)).toBeTruthy()
    expect(boutonDe(TITRE_RATTACHER, 'Rattacher').disabled).toBe(true)
    await cliquer(boutonDe(TITRE_RATTACHER, 'Rattacher'))
    expect(faux.rpcs).toEqual([])
    choisir('Encaissement à rattacher', 'e3')
    expect(within(section(TITRE_RATTACHER) as HTMLElement).queryByText(refus)).toBeNull()
    await cliquer(boutonDe(TITRE_RATTACHER, 'Rattacher'))
    expect(faux.rpcs.map((r) => r.args.p_encaissement_id)).toEqual(['e3'])
  })
})

describe('enregistrer l’encaissement d’une facture : la fenêtre, le mouvement imposé', () => {
  it('s’ouvre sur la facture choisie et sur ce crédit, sans rien écrire ; c’est elle qui enregistre, et l’onglet relit', async () => {
    rendre()
    await ouvrir('REMISE CHEQUE 120')
    // La plus proche du crédit d'abord : F2026-0017 (120 €), puis F2026-0018 (100 € de reste), puis F2026-0016 (300 €).
    expect(options('Facture à encaisser')).toEqual(['', 'f4', 'f5', 'f3'])
    const enregistrer = boutonDe(TITRE_ENREGISTRER, 'Enregistrer…')
    expect(enregistrer.disabled).toBe(true)
    choisir('Facture à encaisser', 'f4')
    await cliquer(boutonDe(TITRE_ENREGISTRER, 'Enregistrer…'))
    expect(faux.rpcs).toEqual([])
    await screen.findByRole('heading', { name: 'Encaissements de la facture F2026-0017' })
    screen.getByText(/^06\/06\/2026 · REMISE CHEQUE 120 · 120,00\s€$/)
    expect(screen.queryByLabelText('Mouvement du relevé (facultatif)')).toBeNull()
    expect((screen.getByLabelText('Montant encaissé (€)') as HTMLInputElement).value).toBe('120,00')
    expect((screen.getByLabelText('Date de l’encaissement') as HTMLInputElement).value).toBe('2026-06-06')
    fireEvent.change(screen.getByLabelText('Moyen de paiement'), { target: { value: 'cheque' } })
    const avant = relevesLus()
    await cliquer(screen.getByRole('button', { name: 'Enregistrer l’encaissement' }))
    expect(faux.rpcs).toHaveLength(1)
    expect(faux.rpcs[0]).toMatchObject({
      nom: 'enregistrer_encaissement',
      args: { p_dossier_id: D, p_facture_id: 'f4', p_ligne_bancaire_id: 'm-lib', p_montant: 120, p_date: '2026-06-06', p_moyen: 'cheque' },
    })
    await waitFor(() => expect(relevesLus()).toBeGreaterThan(avant))
    // Fermée, la fenêtre rend la fiche.
    await cliquer(screen.getByRole('button', { name: 'Fermer' }))
    expect(screen.queryByRole('heading', { name: 'Encaissements de la facture F2026-0017' })).toBeNull()
  })
})

describe('le refus de la base après le clic : dit, puis relu', () => {
  it.each([
    ['classer', 'VIR SARL HORIZON F2026-0014', TITRE_CLASSER, TITRE_CLASSER, null, 'Le mouvement n’a pas été classé par ses encaissements : '],
    ['retirer', 'VIR CABINET DURAND', TITRE_RETIRER, TITRE_RETIRER, null, 'Le classement n’a pas été retiré : '],
    ['rattacher', 'REMISE CHEQUE 120', TITRE_RATTACHER, 'Rattacher', 'e3', 'L’encaissement n’a pas été rattaché : '],
  ] as const)('%s', async (_nom, libelle, nomSection, bouton, encaissementChoisi, debut) => {
    confirmer()
    const alertes: string[] = []
    vi.spyOn(window, 'alert').mockImplementation((m?: string) => { alertes.push(m ?? '') })
    faux.erreurRpc = 'Ce mouvement a changé entre-temps.'
    rendre()
    await tous()
    await ouvrir(libelle)
    if (encaissementChoisi) choisir('Encaissement à rattacher', encaissementChoisi)
    const avant = relevesLus()
    await cliquer(boutonDe(nomSection, bouton))
    expect(faux.rpcs).toHaveLength(1)
    expect(alertes).toEqual([`${debut}Ce mouvement a changé entre-temps.`])
    await waitFor(() => expect(relevesLus()).toBeGreaterThan(avant))
  })
})

describe('deux clics, puis trois, dans le même act : un seul envoi par geste', () => {
  for (const fois of [2, 3]) {
    it(`${fois} clics`, async () => {
      const questions = confirmer()
      rendre()
      await ouvrir('VIR SARL HORIZON F2026-0014')
      await cliquer(boutonDe(TITRE_CLASSER, TITRE_CLASSER), fois)
      expect(faux.rpcs.map((r) => r.nom)).toEqual(['classer_mouvement_par_encaissements'])
      await waitFor(() => expect(section(TITRE_RETIRER)).not.toBeNull())
      await cliquer(boutonDe(TITRE_RETIRER, TITRE_RETIRER), fois)
      expect(faux.rpcs.map((r) => r.nom)).toEqual(['classer_mouvement_par_encaissements', 'retirer_classement_par_encaissements'])
      await waitFor(() => expect(section(TITRE_CLASSER)).not.toBeNull())
      await ouvrir('REMISE CHEQUES 2 FACTURES')
      choisir('Encaissement à rattacher', 'e5')
      await cliquer(boutonDe(TITRE_RATTACHER, 'Rattacher'), fois)
      expect(faux.rpcs.map((r) => r.nom)).toEqual([
        'classer_mouvement_par_encaissements', 'retirer_classement_par_encaissements', 'rattacher_mouvement_encaissement',
      ])
      // Une question par geste : le second clic ne la repose pas pendant que l'écriture court.
      expect(questions).toHaveLength(3)
    })
  }
})

describe('des ventes facturées qui ne sont pas lues en entier : aucun geste neuf', () => {
  const lectures: [string, string][] = [
    [`factures_emises|${COLONNES_FACTURES_ECRITURES}`, NOMS_DES_LECTURES_ECRITURES[0]],
    [`facture_lignes|${COLONNES_LIGNES}`, NOMS_DES_LECTURES_ECRITURES[1]],
    [`encaissements_factures|${COLONNES_ENCAISSEMENTS_ECRITURES}`, NOMS_DES_LECTURES_ECRITURES[2]],
    [`encaissements_factures_taux|${COLONNES_PARTS}`, NOMS_DES_LECTURES_ECRITURES[3]],
    [`lignes_bancaires|${COLONNES_MOUVEMENTS_ECRITURES}`, NOMS_DES_LECTURES_ECRITURES[4]],
  ]
  for (const [cle, nom] of lectures) {
    it(`${nom} lus en partie`, async () => {
      faux.muet = { [cle]: 1 }
      rendre()
      await tous()
      for (const libelle of ['VIR SARL HORIZON F2026-0014', 'VIR CABINET DURAND', 'REMISE CHEQUES 2 FACTURES', 'REMISE CHEQUE 120']) {
        await ouvrir(libelle)
        expect(gestesNeufs(), libelle).toEqual([])
      }
      expect(faux.rpcs).toEqual([])
    })
  }

  it('pas encore revenues, après un geste : la fiche n’offre rien ; revenues, les gestes reviennent', async () => {
    confirmer()
    rendre()
    await ouvrir('VIR SARL HORIZON F2026-0014')
    faux.retenir = { [`encaissements_factures|${COLONNES_ENCAISSEMENTS_ECRITURES}`]: true }
    await cliquer(boutonDe(TITRE_CLASSER, TITRE_CLASSER))
    await waitFor(() => expect(faux.liberer).toHaveLength(1))
    expect(gestesNeufs()).toEqual([])
    await act(async () => { faux.liberer.forEach((l) => l()) })
    await waitFor(() => expect(gestesNeufs()).toEqual([TITRE_RETIRER]))
    expect(faux.rpcs).toHaveLength(1)
  })
})

describe('un dossier qui n’a pas basculé', () => {
  it('aucun geste neuf, sur aucun mouvement', async () => {
    rendre({ ventesParLesFactures: false })
    await tous()
    for (const libelle of ['VIR SARL HORIZON F2026-0014', 'VIR CABINET DURAND', 'REMISE CHEQUES 2 FACTURES', 'REMISE CHEQUE 120']) {
      await ouvrir(libelle)
      expect(gestesNeufs(), libelle).toEqual([])
    }
  })
})
