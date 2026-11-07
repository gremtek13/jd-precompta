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
import { TITRE_CLASSER, TITRE_ENREGISTRER, TITRE_RAPPROCHEMENT_PROPOSE, TITRE_RATTACHER, TITRE_RETIRER } from '../../lib/mouvementsDesVentes'
import { piece } from '../../test/compositionsAuPlan'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'

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
  // Étape C6 : les mises à jour de `lignes_bancaires` (le rapprochement d'une pièce), appliquées et rendues seulement quand
  // le test les accepte — sinon, comme avant, aucune ligne rendue.
  accepterMisesAJour: false,
  misesAJour: [] as { table: string; valeurs: Record<string, unknown> }[],
}))

vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))
vi.mock('../../lib/depot', () => ({ ouvrirJustificatif: async () => {} }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    let operation = 'select'
    let valeurs: Record<string, unknown> = {}
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
      update: (v: Record<string, unknown>) => { operation = 'update'; valeurs = v; return c },
      insert: () => { operation = 'insert'; return c },
      upsert: () => { operation = 'upsert'; return c },
      delete: () => { operation = 'delete'; return c },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
        if (operation === 'update' && table === 'lignes_bancaires' && faux.accepterMisesAJour) {
          faux.misesAJour.push({ table, valeurs })
          const visees = filtrer(faux.parTable[table] ?? [], predicats)
          faux.parTable[table] = (faux.parTable[table] ?? []).map((l) => (visees.includes(l) ? { ...l, ...valeurs } : l))
          return Promise.resolve({ data: visees.length > 0 ? { id: visees[0].id } : null, error: null }).then(suite, echec)
        }
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
  faux.accepterMisesAJour = false
  faux.misesAJour = []
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

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }

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

// LA CAISSE (ligne 26.6, étape C6) : un encaissement en espèces ne cite aucun crédit — la garde des encaissements le refuse
// (migration especes_sans_mouvement). La fiche d'un crédit ne le propose pas (VF5e), ne l'offre pas à rattacher (VF5c), et
// la fenêtre qu'elle ouvre, le crédit imposé, n'offre pas les espèces. Les espèces de F2026-0019, 120 €, reçues le jour même
// du crédit libre de 120 € : le candidat parfait d'hier.
describe('la caisse (étape C6) : des espèces sans mouvement ne se proposent ni ne se rattachent à un crédit', () => {
  function avecDesEspeces() {
    const f6 = facture('f6', 'F2026-0019', 'Cabinet Comptant', 100)
    faux.parTable.factures_emises = [...faux.parTable.factures_emises, f6 as unknown as Record<string, unknown>]
    faux.parTable.facture_lignes = [...faux.parTable.facture_lignes, {
      id: 'fl6', facture_id: 'f6', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20,
    }]
    const e7 = encaissement({ id: 'e7', facture_id: 'f6', montant: 120, moyen: 'especes', date_encaissement: '2026-06-06' })
    faux.parTable.encaissements_factures = [...faux.parTable.encaissements_factures, e7]
    faux.parTable.encaissements_factures_taux = [
      ...faux.parTable.encaissements_factures_taux, { encaissement_id: 'e7', dossier_id: D, taux: 20, montant: 120 },
    ]
  }

  it.each([
    ['le crédit libre de son montant, du même jour', 'REMISE CHEQUE 120', ['', 'e3', 'e5']],
    ['la remise de chèques qu’il reste à faire', 'REMISE CHEQUES 2 FACTURES', ['', 'e5', 'e3']],
  ] as const)('%s : ni proposées, ni à rattacher — les autres encaissements, comme hier', async (_nom, libelle, attendues) => {
    avecDesEspeces()
    rendre()
    await ouvrir(libelle)
    expect(options('Encaissement à rattacher')).toEqual(attendues)
    // Ni en tête de la fiche (ses candidats), ni nulle part ailleurs : la facture des espèces n'y est jamais nommée.
    expect(texteDe(volet())).not.toContain('F2026-0019')
    expect(faux.rpcs).toEqual([])
  })

  it('la fenêtre ouverte sur un crédit n’offre pas les espèces ; les autres moyens, si', async () => {
    avecDesEspeces()
    rendre()
    await ouvrir('REMISE CHEQUE 120')
    choisir('Facture à encaisser', 'f4')
    await cliquer(boutonDe(TITRE_ENREGISTRER, 'Enregistrer…'))
    await screen.findByRole('heading', { name: 'Encaissements de la facture F2026-0017' })
    const moyens = [...(screen.getByLabelText('Moyen de paiement') as HTMLSelectElement).options].map((o) => o.value)
    expect(moyens).toEqual(['', 'virement', 'cheque', 'carte', 'prelevement', 'effet', 'compensation', 'autre'])
    expect(screen.getByText(/hors les espèces, qui ne citent aucun crédit/)).toBeTruthy()
    expect(faux.rpcs).toEqual([])
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

// LE RAPPROCHEMENT PROPOSÉ PAR L'ENCAISSEMENT (étape C6 de la ligne 51.5 ; lib/rapprochementPropose.test.ts pour la règle).
// Le client a enregistré, avec son crédit, l'encaissement d'une facture d'avant la bascule : la fiche propose en tête
// l'exemplaire de la facture, sous « Proposé par le client le … » ; « Associer cette pièce » est le rapprochement d'hier,
// une seule fois sous le verrou ; sur des ventes facturées lues en partie, rien ne s'offre.
describe('un crédit que l’encaissement d’une facture d’avant la bascule cite (C6)', () => {
  const AVANT = mouvement({ id: 'm-avant', date: '2026-06-07', montant: 240, libelle: 'VIR ANCIEN CLIENT F2025-0099' })
  beforeEach(() => {
    const f0 = factureCii([{ ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 200, taux_tva: 20 }], {
      id: 'f0', dossier_id: D, numero: 'F2025-0099', tiers_nom: 'Ancien Client', date_emission: '2025-12-15', source_de_la_vente: false,
    })
    const e0 = encaissement({
      id: 'e0', facture_id: 'f0', montant: 240, ligne_bancaire_id: 'm-avant', date_encaissement: '2026-06-07',
      cree_le: '2026-06-07T09:00:00Z', cree_par: 'client-1',
    })
    faux.parTable.lignes_bancaires.push(AVANT as unknown as Record<string, unknown>)
    faux.parTable.factures_emises.push(f0 as unknown as Record<string, unknown>)
    faux.parTable.facture_lignes.push({
      id: 'fl0', facture_id: 'f0', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 200, taux_tva: 20,
    })
    faux.parTable.encaissements_factures.push(e0)
    faux.parTable.encaissements_factures_taux.push({ encaissement_id: 'e0', dossier_id: D, taux: 20, montant: 240 })
    faux.parTable.pieces = [piece({
      id: 'p0', dossier_id: D, storage_path: `${D}/exemplaire.pdf`, type_piece: 'vente', facture_id: 'f0', statut: 'validee', montant_ht: 200, montant_tva: 40, montant_ttc: 240,
      date_piece: '2025-12-15', nom_fichier: 'exemplaire-F2025-0099.pdf', categorie_id: null,
    })] as unknown as Record<string, unknown>[]
    faux.parTable.memberships = [{ id: 'ms1', dossier_id: D, user_id: 'client-1', droit_banque: true, created_at: '2026-01-02T09:00:00Z' }]
  })

  it('en tête, l’exemplaire sous « Proposé par le client le … » ; « Associer » rapproche une seule fois, puis relit', async () => {
    faux.accepterMisesAJour = true
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await tous()
    await ouvrir('VIR ANCIEN CLIENT F2025-0099')
    const propose = await waitFor(() => {
      const r = section(TITRE_RAPPROCHEMENT_PROPOSE)
      expect(r).not.toBeNull()
      return r as HTMLElement
    })
    expect(texteDe(propose)).toContain('Proposé par le client le 07/06/2026 : Facture F2025-0099 — virement du 07/06/2026, 240,00 €.')
    // La première section de la fiche après son en-tête : avant les pièces que le rapprochement propose de lui-même.
    const sections = [...volet().querySelectorAll('section.fiche-mouvement-section')]
    expect(sections[0]).toBe(propose)
    // L'exemplaire ne se redit pas parmi les candidates.
    expect(within(volet()).queryByRole('heading', { name: 'Pièce proposée' })).toBeNull()
    const associer = within(propose).getByRole('button', { name: 'Associer cette pièce' })
    const avant = relevesLus()
    await cliquer(associer, 2)
    expect(faux.misesAJour).toEqual([{ table: 'lignes_bancaires', valeurs: { statut: 'rapprochee', piece_id: 'p0' } }])
    await waitFor(() => expect(relevesLus()).toBeGreaterThan(avant))
    await waitFor(() => expect(texteDe(section(TITRE_RAPPROCHEMENT_PROPOSE))).toContain('Retenue : ce mouvement est rapproché de cette pièce.'))
    expect(within(section(TITRE_RAPPROCHEMENT_PROPOSE) as HTMLElement).queryByRole('button', { name: 'Associer cette pièce' })).toBeNull()
  })

  it('un compte que les accès ne reconnaissent pas : « Enregistré avec ce mouvement le … », jamais « par le cabinet »', async () => {
    faux.parTable.memberships = []
    rendre()
    await tous()
    await ouvrir('VIR ANCIEN CLIENT F2025-0099')
    await waitFor(() => expect(texteDe(section(TITRE_RAPPROCHEMENT_PROPOSE))).toContain('Enregistré avec ce mouvement le 07/06/2026'))
    expect(texteDe(volet())).not.toContain('par le cabinet')
  })

  // L'EXEMPLAIRE CANDIDAT DU RELEVÉ : `candidatsPieces` n'écarte que celui d'une facture SOURCE ; daté à deux jours du crédit,
  // celui d'une facture d'avant la bascule convient au rapprochement. Le retirer des candidates promouvait une autre pièce à
  // égalité en « Pièce proposée » sous le bouton principal (cas 1), ou laissait « Ignorer, comme les N précédents » (cas 2).
  const exemplaireCandidat = () => {
    const p0 = faux.parTable.pieces[0] as Record<string, unknown>
    p0.date_piece = '2026-06-05'
  }
  const piedDeLaFiche = () => volet().querySelector('.fiche-mouvement-pied')

  it('l’exemplaire à égalité avec une autre pièce : aucune promue, aucun bouton principal hors de la section C6', async () => {
    exemplaireCandidat()
    faux.parTable.pieces.push(piece({
      id: 'p2', dossier_id: D, storage_path: `${D}/autre.pdf`, type_piece: 'vente', statut: 'validee', montant_ht: 200, montant_tva: 40,
      montant_ttc: 240, date_piece: '2026-06-06', nom_fichier: 'autre-recette.pdf', categorie_id: null,
    }) as unknown as Record<string, unknown>)
    rendre()
    await tous()
    await ouvrir('VIR ANCIEN CLIENT F2025-0099')
    await waitFor(() => expect(section(TITRE_RAPPROCHEMENT_PROPOSE)).not.toBeNull())
    await waitFor(() => expect(within(volet()).queryAllByRole('button', { name: /^Associer/ }).length).toBeGreaterThan(1))
    expect(within(volet()).queryByRole('heading', { name: 'Pièce proposée' })).toBeNull()
    expect(within(volet()).queryByRole('heading', { name: 'Une autre pièce convient au relevé' })).not.toBeNull()
    expect(piedDeLaFiche()).toBeNull()
    // Un seul « Associer cette pièce » : celui de l'exemplaire, dans sa section.
    const associer = within(volet()).getAllByRole('button', { name: 'Associer cette pièce' })
    expect(associer).toHaveLength(1)
    expect(section(TITRE_RAPPROCHEMENT_PROPOSE)?.contains(associer[0])).toBe(true)
    expect(within(volet()).getAllByRole('button', { name: 'Associer celle-ci' })).toHaveLength(1)
  })

  it.each([
    ['seul candidat du relevé', true],
    ['hors de la fenêtre du relevé', false],
  ])('l’exemplaire %s, des crédits pareils ignorés : jamais « Ignorer, comme les N précédents »', async (_cas, candidat) => {
    if (candidat) exemplaireCandidat()
    faux.parTable.lignes_bancaires.push(
      mouvement({ id: 'm-ign1', date: '2026-04-07', montant: 240, libelle: 'VIR PAREIL AVRIL', statut: 'ignoree' }) as unknown as Record<string, unknown>,
      mouvement({ id: 'm-ign2', date: '2026-05-07', montant: 240, libelle: 'VIR PAREIL MAI', statut: 'ignoree' }) as unknown as Record<string, unknown>,
    )
    rendre()
    await tous()
    await ouvrir('VIR ANCIEN CLIENT F2025-0099')
    await waitFor(() => expect(section(TITRE_RAPPROCHEMENT_PROPOSE)).not.toBeNull())
    await waitFor(() => expect(within(section(TITRE_RAPPROCHEMENT_PROPOSE) as HTMLElement).queryByRole('button', { name: 'Associer cette pièce' })).not.toBeNull())
    expect(within(volet()).queryByRole('button', { name: /comme les 2 précédents/ })).toBeNull()
    expect(texteDe(volet())).not.toContain('mouvements déjà ignorés')
    expect(piedDeLaFiche()).toBeNull()
    expect(within(volet()).queryByRole('heading', { name: 'Pièce proposée' })).toBeNull()
  })

  it('des ventes facturées lues en partie : aucune proposition, aucun « Associer »', async () => {
    faux.muet = { [`encaissements_factures|${COLONNES_ENCAISSEMENTS_ECRITURES}`]: 1 }
    rendre()
    await tous()
    await ouvrir('VIR ANCIEN CLIENT F2025-0099')
    await waitFor(() => expect(texteDe(volet())).toContain('n’ont pas pu être lues en entier'))
    expect(section(TITRE_RAPPROCHEMENT_PROPOSE)).toBeNull()
    expect(within(volet()).queryByRole('button', { name: 'Associer cette pièce' })).toBeNull()
  })
})
