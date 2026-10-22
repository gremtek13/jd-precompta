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
import { COLONNES_DECLARATIONS_DU_RELEVE, NOM_DES_DECLARATIONS_DU_RELEVE } from '../../lib/ventesDuReleveLecture'
import { COLONNES_LIGNES, COLONNES_PARTS } from '../../lib/ventesFactureesLecture'
import { REFUS_CLASSEMENT, REFUS_RETRAIT_CLASSEMENT, remplirModele } from '../../lib/encaissementsFactures'
import { LIBELLE_MOTIF_CONTRE_PASSATION } from '../../lib/droitsAcces'
import {
  TITRE_CLASSER_DEBIT, TITRE_CONTRE_PASSER, TITRE_RATTACHER_CONTRE_PASSATION, TITRE_RETIRER,
} from '../../lib/mouvementsDesVentes'

// LA FICHE D'UN DÉBIT : L'IMPAYÉ ET LA SOMME RENDUE (ligne 28.65, chantier EC-Q3, étape VF5d). La règle est éprouvée à
// part (lib/gestesDuDebit.test.ts) ; ici, le CÂBLAGE de l'onglet Banque, côté cabinet, sur un dossier basculé : classer
// un débit réservé par ses contre-passations, retirer ce classement, rattacher une contre-passation enregistrée sans
// mouvement — par leur fonction de la base SEULE, avec leurs paramètres, après une confirmation qui nomme ce qu'ils
// font, puis l'onglet relit ; chaque refus de la base dit avant le clic, le bouton grisé, et celui qui revient après le
// clic dit puis suivi d'une relecture ; deux clics puis trois dans le même `act` n'envoient qu'une fois ;
// « Contre-passer l'encaissement d'une facture » ouvre la fenêtre des encaissements sur la facture, la contre-passation
// de cet encaissement préparée et ce débit IMPOSÉ — c'est elle qui écrit, par `annuler_encaissement` seule ; sur des
// ventes facturées ou des déclarations lues en partie, ou pas encore revenues, rien de cela ne s'offre. Données
// FICTIVES.

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
  // Ce que font les fonctions du cabinet (supabase/schema/20261019070229_encaissements_de_la_vente_facturee.sql) et
  // `annuler_encaissement` (20261022185455_contre_passation_banque.sql), sans leurs refus : l'écran les dit avant le
  // clic, et `erreurRpc` joue celui qui revient après.
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
    } else if (nom === 'annuler_encaissement') {
      const annule = faux.parTable.encaissements_factures.find((e) => e.id === args.p_encaissement_id) as Record<string, unknown>
      faux.parTable.encaissements_factures = [...faux.parTable.encaissements_factures, {
        ...annule, id: 'cp-neuve', montant: -(annule.montant as number), annule_id: annule.id, date_encaissement: args.p_date,
        motif: args.p_motif, ligne_bancaire_id: args.p_ligne_bancaire_id ?? null, cree_le: '2026-10-22T10:00:00Z',
      }]
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
    dossier_id: D, date: '2026-06-02', montant: -100, libelle: 'PRLV FICTIF', libelle_brut: null,
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
  dossier_id: D, date_encaissement: '2026-06-03', moyen: 'cheque', ligne_bancaire_id: null, annule_id: null, motif: null,
  cree_le: '2026-06-03T10:00:00Z', retire_le: null, retire_par: null, compte_contrepartie: null, cree_par: 'cabinet-1', ...o,
})
const declaration = (encaissementId: string, factureId: string) => ({
  id: `t-${encaissementId}`, dossier_id: D, encaissement_id: encaissementId, facture_id: factureId, canal: 'manuel',
  hote: 'pa.exemple.fr', flux_id: null, sha256: null, etat: 'accepte', detail: null, note: null, cree_par: null,
  cree_le: '2026-06-05T08:00:00Z', maj_le: '2026-06-05T08:00:00Z',
})

// LIBRE : le chèque de F2026-0014 revenu impayé, un débit de 600 € que rien ne cite. RÉSERVÉ : deux chèques revenus
// ensemble (900 €), un seul contre-passé (F2026-0015, 600 €). CLASSÉ : la somme rendue à l'Atelier Martin (300 €).
// EXACT : le retour du chèque de F2026-0018 (200 €), que sa contre-passation fait. Une contre-passation sans mouvement
// (F2026-0017, 300 €) ; un encaissement jamais déclaré (F2026-0018, 100 €), qui ne se contre-passe pas.
const CREDIT = mouvement({ id: 'm-cre', date: '2026-06-03', montant: 600, libelle: 'REMISE CHEQUE HORIZON' })
const LIBRE = mouvement({ id: 'm-lib', date: '2026-06-10', montant: -600, libelle: 'IMPAYE CHEQUE HORIZON' })
const RESERVE = mouvement({ id: 'm-res', date: '2026-06-11', montant: -900, libelle: 'IMPAYES CHEQUES' })
const CLASSE = mouvement({
  id: 'm-cls', date: '2026-06-08', montant: -300, libelle: 'REMBOURSEMENT ATELIER MARTIN', statut: 'rapprochee',
  encaissements_de_factures: true,
})
const EXACT = mouvement({ id: 'm-exa', date: '2026-06-12', montant: -200, libelle: 'RETOUR CHEQUE RIVIERE' })
const LIBELLES = ['IMPAYE CHEQUE HORIZON', 'IMPAYES CHEQUES', 'REMBOURSEMENT ATELIER MARTIN', 'RETOUR CHEQUE RIVIERE']

function poser() {
  faux.muet = {}
  faux.retenir = {}
  faux.liberer = []
  faux.demandes = []
  faux.rpcs = []
  faux.erreurRpc = null
  const factures = [
    facture('f1', 'F2026-0014', 'SARL Horizon', 500), facture('f2', 'F2026-0015', 'Cabinet Durand', 500),
    facture('f3', 'F2026-0016', 'Atelier Martin', 250), facture('f4', 'F2026-0017', 'Studio Bleu', 250),
    facture('f5', 'F2026-0018', 'Cabinet Rivière', 250),
  ]
  const encaissements = [
    encaissement({ id: 'e1', facture_id: 'f1', montant: 600, date_encaissement: '2026-06-02', ligne_bancaire_id: 'm-cre' }),
    encaissement({ id: 'e2', facture_id: 'f2', montant: 600, moyen: 'virement', date_encaissement: '2026-06-01' }),
    encaissement({ id: 'cp2', facture_id: 'f2', montant: -600, moyen: 'virement', annule_id: 'e2', ligne_bancaire_id: 'm-res', date_encaissement: '2026-06-11' }),
    encaissement({ id: 'e3', facture_id: 'f3', montant: 300, moyen: 'virement', date_encaissement: '2026-06-01' }),
    encaissement({ id: 'cp3', facture_id: 'f3', montant: -300, moyen: 'virement', annule_id: 'e3', ligne_bancaire_id: 'm-cls', date_encaissement: '2026-06-08' }),
    encaissement({ id: 'o4', facture_id: 'f4', montant: 300, date_encaissement: '2026-06-04' }),
    encaissement({ id: 'cp4', facture_id: 'f4', montant: -300, annule_id: 'o4', date_encaissement: '2026-06-09' }),
    encaissement({ id: 'e5', facture_id: 'f5', montant: 200 }),
    encaissement({ id: 'cp5', facture_id: 'f5', montant: -200, annule_id: 'e5', ligne_bancaire_id: 'm-exa', date_encaissement: '2026-06-12' }),
    encaissement({ id: 'e6', facture_id: 'f5', montant: 100, date_encaissement: '2026-06-05' }),
  ]
  faux.parTable = {
    lignes_bancaires: [CREDIT, LIBRE, RESERVE, CLASSE, EXACT] as unknown as Record<string, unknown>[],
    factures_emises: factures as unknown as Record<string, unknown>[],
    facture_lignes: factures.map((f, i) => ({
      id: `fl${i + 1}`, facture_id: f.id, ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: f.montant_ht,
      taux_tva: 20,
    })),
    encaissements_factures: encaissements,
    encaissements_factures_taux: encaissements.map((e) => ({ encaissement_id: e.id, dossier_id: D, taux: 20, montant: e.montant })),
    transmissions_encaissements: [declaration('e1', 'f1'), declaration('e2', 'f2'), declaration('e3', 'f3'), declaration('e5', 'f5')],
  }
}

beforeEach(() => {
  // Le jour à Paris, que la base lit : une contre-passation ne se date pas dans l'avenir.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-22T10:00:00Z'))
  poser()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

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
// Les gestes de l'étape VF5d que la fiche d'un débit offre.
const GESTES_VF5D = [TITRE_CLASSER_DEBIT, TITRE_RETIRER, 'Rattacher', 'Contre-passer…']
const gestesNeufs = () => within(volet()).queryAllByRole('button').map((b) => texteDe(b).trim()).filter((n) => GESTES_VF5D.includes(n))
const refus = (liste: readonly { cle: string; modele: string }[], cle: string, ...valeurs: string[]) =>
  remplirModele(liste.find((r) => r.cle === cle)?.modele ?? '', valeurs)

function confirmer(reponse = true) {
  const questions: string[] = []
  // Les espaces insécables des montants, ramenés à des espaces.
  vi.spyOn(window, 'confirm').mockImplementation((q?: string) => { questions.push((q ?? '').replace(/[\u00a0\u202f]/g, ' ')); return reponse })
  return questions
}

describe('un débit RÉSERVÉ que ses contre-passations font : classer par elles', () => {
  it('la phrase, la confirmation qui nomme la contre-passation, l’appel et ses paramètres, puis la relecture', async () => {
    const questions = confirmer()
    rendre()
    await ouvrir('RETOUR CHEQUE RIVIERE')
    expect(texteDe(section(TITRE_CLASSER_DEBIT))).toContain('Ses contre-passations font exactement le débit, 200,00 €.')
    // Rien ne reste à faire du débit : ni rattachement, ni contre-passation.
    expect(section(TITRE_RATTACHER_CONTRE_PASSATION)).toBeNull()
    expect(section(TITRE_CONTRE_PASSER)).toBeNull()
    const avant = relevesLus()
    await cliquer(boutonDe(TITRE_CLASSER_DEBIT, TITRE_CLASSER_DEBIT))
    expect(questions).toEqual([
      'Classer ce débit du 12/06/2026 de -200,00 € par ses contre-passations ?\n\n'
      + '— Contre-passation, facture F2026-0018 (Cabinet Rivière) — chèque du 12/06/2026 : -200,00 €\n\n'
      + 'Aucun frais bancaire : ses contre-passations font exactement le débit. Il sera rapproché par elles, et ne recevra '
      + 'plus aucun autre classement ; ses écritures se passent ensuite dans l’onglet Écritures, section « Ventes facturées ».',
    ])
    expect(faux.rpcs).toEqual([{ nom: 'classer_mouvement_par_encaissements', args: { p_dossier_id: D, p_ligne_bancaire_id: 'm-exa' } }])
    // Relu : le débit est classé, sa fiche offre de retirer ce classement.
    await waitFor(() => expect(section(TITRE_RETIRER)).not.toBeNull())
    expect(relevesLus()).toBeGreaterThan(avant)
  })

  it('deux chèques revenus ensemble, un seul contre-passé : le refus avant le clic, le bouton grisé, et de quoi compléter', async () => {
    confirmer()
    rendre()
    await ouvrir('IMPAYES CHEQUES')
    const classer = section(TITRE_CLASSER_DEBIT) as HTMLElement
    expect(texteDe(classer)).toContain('Ses contre-passations font 600,00 € pour un débit de 900,00 € : il reste 300,00 € à rattacher')
    expect(within(classer).getByText(refus(REFUS_CLASSEMENT, 'debit_ecart', '600,00', '900,00'))).toBeTruthy()
    expect(boutonDe(TITRE_CLASSER_DEBIT, TITRE_CLASSER_DEBIT).disabled).toBe(true)
    await cliquer(boutonDe(TITRE_CLASSER_DEBIT, TITRE_CLASSER_DEBIT))
    expect(options('Contre-passation à rattacher')).toEqual(['', 'cp4'])
    // Le chèque de F2026-0014 dépasserait ce débit : la base le refuserait, il ne s'offre pas.
    expect(section(TITRE_CONTRE_PASSER)).toBeNull()
    expect(faux.rpcs).toEqual([])
  })

  it.each([
    ['classer', 'RETOUR CHEQUE RIVIERE', TITRE_CLASSER_DEBIT, TITRE_CLASSER_DEBIT, null],
    ['retirer', 'REMBOURSEMENT ATELIER MARTIN', TITRE_RETIRER, TITRE_RETIRER, null],
    ['rattacher', 'IMPAYES CHEQUES', TITRE_RATTACHER_CONTRE_PASSATION, 'Rattacher', 'cp4'],
  ] as const)('la confirmation refusée — %s : rien ne part', async (_nom, libelle, nomSection, bouton, choix) => {
    const questions = confirmer(false)
    rendre()
    await tous()
    await ouvrir(libelle)
    if (choix) choisir('Contre-passation à rattacher', choix)
    await cliquer(boutonDe(nomSection, bouton))
    expect(questions).toHaveLength(1)
    expect(faux.rpcs).toEqual([])
  })
})

describe('un débit CLASSÉ par ses contre-passations : retirer ce classement', () => {
  it('la confirmation dit que ses écritures deviennent « à retirer » ; l’appel ; relu, il redevient réservé et classable', async () => {
    const questions = confirmer()
    rendre()
    await tous()
    await ouvrir('REMBOURSEMENT ATELIER MARTIN')
    await cliquer(boutonDe(TITRE_RETIRER, TITRE_RETIRER))
    expect(questions[0]).toContain('Retirer le classement de ce débit du 08/06/2026 de -300,00 € par ses contre-passations (facture F2026-0016) ?')
    expect(questions[0]).toContain('Il redevient à traiter, toujours réservé à ses contre-passations')
    expect(faux.rpcs).toEqual([{ nom: 'retirer_classement_par_encaissements', args: { p_dossier_id: D, p_ligne_bancaire_id: 'm-cls' } }])
    await waitFor(() => expect(section(TITRE_CLASSER_DEBIT)).not.toBeNull())
    expect(boutonDe(TITRE_CLASSER_DEBIT, TITRE_CLASSER_DEBIT).disabled).toBe(false)
  })

  it('daté d’un exercice validé : le refus de la base avant le clic, le bouton grisé, rien ne part', async () => {
    confirmer()
    rendre({ valides: [2026] })
    await tous()
    await ouvrir('REMBOURSEMENT ATELIER MARTIN')
    const retrait = section(TITRE_RETIRER) as HTMLElement
    expect(within(retrait).getByText(refus(REFUS_RETRAIT_CLASSEMENT, 'frontiere', 'L\'exercice 2026 est validé'))).toBeTruthy()
    expect(boutonDe(TITRE_RETIRER, TITRE_RETIRER).disabled).toBe(true)
    await cliquer(boutonDe(TITRE_RETIRER, TITRE_RETIRER))
    expect(faux.rpcs).toEqual([])
  })
})

describe('rattacher une contre-passation enregistrée sans mouvement', () => {
  it('sur le débit des deux chèques : la contre-passation qui le fait, la confirmation et l’état d’après ; relu, il se classe', async () => {
    const questions = confirmer()
    rendre()
    await ouvrir('IMPAYES CHEQUES')
    choisir('Contre-passation à rattacher', 'cp4')
    await cliquer(boutonDe(TITRE_RATTACHER_CONTRE_PASSATION, 'Rattacher'))
    expect(questions[0]).toContain('Rattacher à ce débit du 11/06/2026 de -900,00 € la contre-passation suivante ?')
    expect(questions[0]).toContain('— Contre-passation, facture F2026-0017 (Studio Bleu) — chèque du 09/06/2026 : -300,00 €')
    expect(questions[0]).toContain('Ses contre-passations feront alors le débit : il restera à le classer par elles.')
    expect(faux.rpcs).toEqual([{
      nom: 'rattacher_mouvement_encaissement', args: { p_dossier_id: D, p_encaissement_id: 'cp4', p_ligne_bancaire_id: 'm-res' },
    }])
    await waitFor(() => expect(boutonDe(TITRE_CLASSER_DEBIT, TITRE_CLASSER_DEBIT).disabled).toBe(false))
    expect(texteDe(section(TITRE_CLASSER_DEBIT))).toContain('Ses contre-passations font exactement le débit, 900,00 €.')
  })
})

describe('contre-passer l’encaissement d’une facture : la fenêtre, ce débit imposé', () => {
  it('sur un débit libre : les deux gestes, seul l’encaissement déclaré ; la fenêtre s’ouvre sans rien écrire, et c’est elle qui contre-passe', async () => {
    confirmer()
    rendre()
    await ouvrir('IMPAYE CHEQUE HORIZON')
    expect(section(TITRE_CLASSER_DEBIT)).toBeNull()
    expect(options('Contre-passation à rattacher')).toEqual(['', 'cp4'])
    // Le chèque de 100 € de F2026-0018, jamais déclaré, ne se contre-passe pas : il se retire.
    expect(options('Encaissement à contre-passer')).toEqual(['', 'e1'])
    const contrePasser = boutonDe(TITRE_CONTRE_PASSER, 'Contre-passer…')
    expect(contrePasser.disabled).toBe(true)
    choisir('Encaissement à contre-passer', 'e1')
    expect(texteDe(section(TITRE_CONTRE_PASSER))).toContain('Ses contre-passations feront alors le débit : il restera à le classer par elles.')
    await cliquer(boutonDe(TITRE_CONTRE_PASSER, 'Contre-passer…'))
    expect(faux.rpcs).toEqual([])
    await screen.findByRole('heading', { name: 'Encaissements de la facture F2026-0014' })
    await screen.findByRole('heading', { name: /^Contre-passer l’encaissement du 02\/06\/2026/ })
    screen.getByText(/^10\/06\/2026 · IMPAYE CHEQUE HORIZON · -600,00\s€$/)
    expect(screen.queryByLabelText('Débit qui défait l’encaissement (facultatif)')).toBeNull()
    expect((screen.getByLabelText('Date du décaissement') as HTMLInputElement).value).toBe('2026-06-10')
    fireEvent.change(screen.getByLabelText(LIBELLE_MOTIF_CONTRE_PASSATION), { target: { value: 'Chèque revenu impayé' } })
    const avant = relevesLus()
    await cliquer(screen.getByRole('button', { name: 'Enregistrer la contre-passation' }))
    expect(faux.rpcs).toEqual([{
      nom: 'annuler_encaissement',
      args: { p_dossier_id: D, p_encaissement_id: 'e1', p_date: '2026-06-10', p_motif: 'Chèque revenu impayé', p_ligne_bancaire_id: 'm-lib' },
    }])
    // La fenêtre relit, puis l'onglet.
    await waitFor(() => expect(relevesLus()).toBeGreaterThan(avant))
    await cliquer(screen.getByRole('button', { name: 'Fermer' }))
    expect(screen.queryByRole('heading', { name: 'Encaissements de la facture F2026-0014' })).toBeNull()
    // Relu : la contre-passation cite le débit, qui se classe désormais par elle.
    await waitFor(() => expect(section(TITRE_CLASSER_DEBIT)).not.toBeNull())
    expect(boutonDe(TITRE_CLASSER_DEBIT, TITRE_CLASSER_DEBIT).disabled).toBe(false)
  })

  it('deux clics, puis trois, sur « Contre-passer… » : une seule fenêtre, et rien n’est écrit', async () => {
    rendre()
    await ouvrir('IMPAYE CHEQUE HORIZON')
    choisir('Encaissement à contre-passer', 'e1')
    await cliquer(boutonDe(TITRE_CONTRE_PASSER, 'Contre-passer…'), 3)
    expect(await screen.findAllByRole('heading', { name: 'Encaissements de la facture F2026-0014' })).toHaveLength(1)
    expect(faux.rpcs).toEqual([])
  })
})

describe('le refus de la base après le clic : dit, puis relu', () => {
  it.each([
    ['classer', 'RETOUR CHEQUE RIVIERE', TITRE_CLASSER_DEBIT, TITRE_CLASSER_DEBIT, null, 'Le mouvement n’a pas été classé par ses encaissements : '],
    ['retirer', 'REMBOURSEMENT ATELIER MARTIN', TITRE_RETIRER, TITRE_RETIRER, null, 'Le classement n’a pas été retiré : '],
    ['rattacher', 'IMPAYES CHEQUES', TITRE_RATTACHER_CONTRE_PASSATION, 'Rattacher', 'cp4', 'L’encaissement n’a pas été rattaché : '],
  ] as const)('%s', async (_nom, libelle, nomSection, bouton, choix, debut) => {
    confirmer()
    const alertes: string[] = []
    vi.spyOn(window, 'alert').mockImplementation((m?: string) => { alertes.push(m ?? '') })
    faux.erreurRpc = 'Ce mouvement a changé entre-temps.'
    rendre()
    await tous()
    await ouvrir(libelle)
    if (choix) choisir('Contre-passation à rattacher', choix)
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
      await ouvrir('RETOUR CHEQUE RIVIERE')
      await cliquer(boutonDe(TITRE_CLASSER_DEBIT, TITRE_CLASSER_DEBIT), fois)
      expect(faux.rpcs.map((r) => r.nom)).toEqual(['classer_mouvement_par_encaissements'])
      await waitFor(() => expect(section(TITRE_RETIRER)).not.toBeNull())
      await cliquer(boutonDe(TITRE_RETIRER, TITRE_RETIRER), fois)
      expect(faux.rpcs.map((r) => r.nom)).toEqual(['classer_mouvement_par_encaissements', 'retirer_classement_par_encaissements'])
      await waitFor(() => expect(section(TITRE_CLASSER_DEBIT)).not.toBeNull())
      await ouvrir('IMPAYES CHEQUES')
      choisir('Contre-passation à rattacher', 'cp4')
      await cliquer(boutonDe(TITRE_RATTACHER_CONTRE_PASSATION, 'Rattacher'), fois)
      expect(faux.rpcs.map((r) => r.nom)).toEqual([
        'classer_mouvement_par_encaissements', 'retirer_classement_par_encaissements', 'rattacher_mouvement_encaissement',
      ])
      // Une question par geste : le second clic ne la repose pas pendant que l'écriture court.
      expect(questions).toHaveLength(3)
    })
  }
})

describe('des ventes facturées ou des déclarations qui ne sont pas lues en entier : aucun geste neuf', () => {
  const lectures: [string, string][] = [
    [`factures_emises|${COLONNES_FACTURES_ECRITURES}`, NOMS_DES_LECTURES_ECRITURES[0]],
    [`facture_lignes|${COLONNES_LIGNES}`, NOMS_DES_LECTURES_ECRITURES[1]],
    [`encaissements_factures|${COLONNES_ENCAISSEMENTS_ECRITURES}`, NOMS_DES_LECTURES_ECRITURES[2]],
    [`encaissements_factures_taux|${COLONNES_PARTS}`, NOMS_DES_LECTURES_ECRITURES[3]],
    [`lignes_bancaires|${COLONNES_MOUVEMENTS_ECRITURES}`, NOMS_DES_LECTURES_ECRITURES[4]],
    [`transmissions_encaissements|${COLONNES_DECLARATIONS_DU_RELEVE}`, NOM_DES_DECLARATIONS_DU_RELEVE],
  ]
  for (const [cle, nom] of lectures) {
    it(`${nom} lus en partie`, async () => {
      faux.muet = { [cle]: 1 }
      rendre()
      await tous()
      for (const libelle of LIBELLES) {
        await ouvrir(libelle)
        expect(gestesNeufs(), libelle).toEqual([])
      }
      // La fiche dit pourquoi : la lecture, et son manque.
      expect(texteDe(volet())).toContain(nom)
      expect(faux.rpcs).toEqual([])
    })
  }

  it('pas encore revenues, après un geste : la fiche n’offre rien ; revenues, les gestes reviennent', async () => {
    confirmer()
    rendre()
    await ouvrir('RETOUR CHEQUE RIVIERE')
    faux.retenir = { [`transmissions_encaissements|${COLONNES_DECLARATIONS_DU_RELEVE}`]: true }
    await cliquer(boutonDe(TITRE_CLASSER_DEBIT, TITRE_CLASSER_DEBIT))
    await waitFor(() => expect(faux.liberer).toHaveLength(1))
    expect(gestesNeufs()).toEqual([])
    await act(async () => { faux.liberer.forEach((l) => l()) })
    await waitFor(() => expect(gestesNeufs()).toEqual([TITRE_RETIRER]))
    expect(faux.rpcs).toHaveLength(1)
  })
})

describe('un dossier qui n’a pas basculé', () => {
  it('aucun geste neuf, sur aucun débit, et les déclarations ne se lisent pas', async () => {
    rendre({ ventesParLesFactures: false })
    await tous()
    for (const libelle of LIBELLES) {
      await ouvrir(libelle)
      expect(gestesNeufs(), libelle).toEqual([])
    }
    expect(faux.demandes.filter((d) => d.startsWith('transmissions_encaissements|'))).toEqual([])
  })
})
