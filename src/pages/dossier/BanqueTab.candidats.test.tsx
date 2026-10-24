import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { LigneBancaire, Piece } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { COLONNES_ENCAISSEMENTS_ECRITURES } from '../../lib/ecrituresVentesFactureesLecture'
import {
  JUSTIFICATIF_CONTRE_PASSATION, JUSTIFICATIF_ENCAISSEMENT, JUSTIFICATIF_FACTURE, SIGNAL_MONTANT_CREDIT, signalDuClient,
  TITRE_PROPOSES, TITRE_RATTACHER, TITRE_RATTACHER_CONTRE_PASSATION,
} from '../../lib/mouvementsDesVentes'

// LES CANDIDATS DU RELEVÉ (ligne 28.65, chantier EC-Q3, étape VF5e). La règle est éprouvée à part
// (lib/candidatsDuReleve.test.ts) ; ici, le CÂBLAGE de l'onglet Banque, côté cabinet, sur un dossier basculé : la fiche d'un
// crédit libre propose EN TÊTE la facture source ou l'encaissement sans mouvement qui le règle peut-être, et rien ne
// s'écrit sans le clic puis la confirmation ; le lot des règles le met « à rapprocher » sous la phrase de la conception ;
// le rapprochement automatique, « Valider et rapprocher » et la règle d'ignorance ne le prennent pas, et leur carte le
// dit ; sur des ventes lues en partie, ni proposition ni lot ; un dossier qui n'a pas basculé, comme hier. Données FICTIVES.

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
  // Le rattachement, tel que la base le fait (sans ses refus, que l'écran dit avant le clic) ; les autres, notés.
  const rpc = (nom: string, args: Record<string, unknown> = {}) => {
    faux.rpcs.push({ nom, args })
    if (nom === 'rattacher_mouvement_encaissement') {
      faux.parTable.encaissements_factures = faux.parTable.encaissements_factures.map((e) => (e.id === args.p_encaissement_id
        ? { ...e, ligne_bancaire_id: args.p_ligne_bancaire_id }
        : e))
    }
    return Promise.resolve({ data: null, error: null })
  }
  const functions = {
    invoke: async (nom: string) => {
      if (nom === 'banque-connexion') return { data: { configuree: false, connexion: null }, error: null }
      if (nom === 'plateforme-agreee') return { data: { connexion: null }, error: null }
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
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    created_at: '2026-06-01T09:00:00Z', updated_at: '2026-06-01T09:00:00Z', ...o,
  }
}

// Une facture source, sans TVA (une ligne au taux 0) : son TTC est son hors-taxe.
const facture = (id: string, numero: string, tiers: string, montant: number) => ({
  id, dossier_id: D, statut: 'validee', type: 'facture', numero, date_emission: '2026-05-20', tiers_nom: tiers,
  facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services', option_debits: false, date_prestation: null,
  montant_ht: montant, montant_tva: 0, montant_ttc: montant, emetteur_siret: null, superpdp_invoice_id: null,
})

// F2026-0021, Librairie Rocher, 600 €, que rien n'a encaissé ; F2026-0022, Studio Bleu, 300 €, encaissée par un chèque
// enregistré sans mouvement (e2). Trois crédits que ces ventes justifient peut-être — chacun pris par un lot s'il ne
// l'était pas : un virement de 600 € qu'une pièce de vente validée du même montant rapprocherait seule (son exemplaire) ;
// un virement de Librairie Rocher qu'une pièce à valider confirme par ses trois signaux ; un crédit de 300 € qu'une règle
// range en recette. Chacun a son jumeau LIBRE, que son lot prend.
const CAND_AUTO = mouvement({ id: 'm-cand-auto', date: '2026-06-03', montant: 600, libelle: 'VIR SEPA RECU 7781' })
const CAND_CERT = mouvement({ id: 'm-cand-cert', date: '2026-07-15', montant: 600, libelle: 'VIR LIBRAIRIE ROCHER' })
const CAND_REGLE = mouvement({ id: 'm-cand-regle', date: '2026-06-05', montant: 299, libelle: 'VIR GAMMA SANTE 0001' })
const LIBRE_AUTO = mouvement({ id: 'm-libre-auto', libelle: 'PRLV ATELIER FICTIF' })
const LIBRE_CERT = mouvement({ id: 'm-libre-cert', date: '2026-06-05', montant: -75, libelle: 'CB IMPRIMERIE FICTIVE' })
const LIBRE_REGLE = mouvement({ id: 'm-libre-regle', date: '2026-06-06', montant: 80, libelle: 'VIR GAMMA SANTE ACOMPTE' })

function poser() {
  faux.muet = {}
  faux.ecritures = []
  faux.rpcs = []
  const factures = [facture('f1', 'F2026-0021', 'Librairie Rocher', 600), facture('f2', 'F2026-0022', 'Studio Bleu', 300)]
  faux.parTable = {
    lignes_bancaires: [CAND_AUTO, CAND_CERT, CAND_REGLE, LIBRE_AUTO, LIBRE_CERT, LIBRE_REGLE] as unknown as Record<string, unknown>[],
    pieces: [
      piece({ id: 'p-auto' }),
      // L'exemplaire de F2026-0021, validé : du même montant que le virement, à un jour près.
      piece({ id: 'p-ex', type_piece: 'vente', tiers: 'Exemplaire F2026-0021', montant_ttc: 600, date_piece: '2026-06-02', facture_id: 'f1' }),
      piece({ id: 'p-cert', tiers: 'Imprimerie fictive', montant_ttc: 75, date_piece: '2026-06-05', statut: 'a_valider' }),
      piece({ id: 'p-cand-cert', type_piece: 'vente', tiers: 'Librairie Rocher', montant_ttc: 600, date_piece: '2026-07-14', statut: 'a_valider' }),
    ] as unknown as Record<string, unknown>[],
    categories: [{ id: 'c-rec', dossier_id: D, code: 'recettes', libelle: 'Recettes', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes' }],
    regles_affectation_bancaire: [{
      id: 'r-gamma', dossier_id: D, motif: 'gamma', sens: 'encaissement', categorie_id: 'c-rec', taux_tva: null,
      created_at: '2026-01-01T00:00:00Z',
    }],
    factures_emises: factures,
    facture_lignes: factures.map((f, i) => ({
      id: `fl${i}`, facture_id: f.id, ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: f.montant_ht, taux_tva: 0,
    })),
    encaissements_factures: [{
      id: 'e2', facture_id: 'f2', montant: 300, ligne_bancaire_id: null, dossier_id: D, date_encaissement: '2026-06-01',
      moyen: 'cheque', annule_id: null, motif: null, cree_le: '2026-06-01T10:00:00Z', retire_le: null, retire_par: null,
      compte_contrepartie: null, cree_par: 'cabinet-1',
    }],
    encaissements_factures_taux: [{ encaissement_id: 'e2', dossier_id: D, taux: 0, montant: 300 }],
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

const mouvementsEcrits = () => faux.ecritures.filter((e) => e.table === 'lignes_bancaires' && e.operation === 'update').flatMap((e) => e.ids)
const piecesValidees = () => faux.ecritures.filter((e) => e.table === 'pieces' && e.operation === 'update').flatMap((e) => e.ids)
const affectes = () => faux.rpcs.filter((r) => r.nom === 'affecter_mouvements_bancaires')
  .flatMap((r) => (r.args.p_affectations as { ligne_bancaire_id: string }[]).map((a) => a.ligne_bancaire_id))

async function lot(nom: string | RegExp): Promise<HTMLButtonElement> {
  return await screen.findByRole('button', { name: nom }) as HTMLButtonElement
}
async function cliquer(bouton: HTMLElement, fois = 1) {
  await act(async () => { for (let i = 0; i < fois; i++) bouton.click() })
}
function ecartDe(lotNom: string): HTMLElement {
  const resume = screen.getAllByText((_, e) => e?.tagName === 'SUMMARY' && texteDe(e).startsWith(`${lotNom} — `))
  expect(resume).toHaveLength(1)
  return resume[0].closest('details') as HTMLElement
}
async function ouvrir(libelle: string) {
  const cellule = (await screen.findAllByText(libelle)).find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  await act(async () => { (cellule.closest('tr') as HTMLElement).click() })
}
const proposes = () => within(volet()).queryByRole('region', { name: TITRE_PROPOSES })
function confirmer(reponse = true) {
  const questions: string[] = []
  vi.spyOn(window, 'confirm').mockImplementation((q?: string) => { questions.push(espaces(q ?? '')); return reponse })
  return questions
}

describe('la fiche d’un crédit libre : les candidats en tête, rien sans le clic', () => {
  it('l’encaissement enregistré sans mouvement : sa carte, ses signaux ; le clic, la confirmation, puis le rattachement seul', async () => {
    const questions = confirmer()
    rendre()
    await ouvrir('VIR GAMMA SANTE 0001')
    const section = proposes() as HTMLElement
    expect(section).not.toBeNull()
    expect(texteDe(section)).toContain('Encaissement enregistré sans mouvement')
    expect(texteDe(section)).toContain('Facture F2026-0022 (Studio Bleu) — chèque du 01/06/2026')
    expect(texteDe(section)).toContain(SIGNAL_MONTANT_CREDIT)
    // En tête : avant la liste du rattachement, qui le porte aussi.
    const sections = within(volet()).getAllByRole('region').map((r) => r.getAttribute('aria-label'))
    expect(sections.indexOf(TITRE_PROPOSES)).toBeLessThan(sections.indexOf(TITRE_RATTACHER))
    // Le lot des règles l'aurait affecté : la fiche dit pourquoi pas, avant toute affectation.
    expect(texteDe(volet())).toContain(JUSTIFICATIF_ENCAISSEMENT)
    // Rien n'est parti à l'ouverture.
    expect(faux.rpcs).toEqual([])
    await cliquer(within(section).getByRole('button', { name: 'Rattacher celui-ci' }), 2)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain('Rattacher à ce crédit du 05/06/2026 de 299,00 € l’encaissement suivant ?')
    expect(faux.rpcs).toEqual([{
      nom: 'rattacher_mouvement_encaissement', args: { p_dossier_id: D, p_encaissement_id: 'e2', p_ligne_bancaire_id: 'm-cand-regle' },
    }])
  })

  it('la confirmation refusée : rien ne part', async () => {
    confirmer(false)
    rendre()
    await ouvrir('VIR GAMMA SANTE 0001')
    await cliquer(within(proposes() as HTMLElement).getByRole('button', { name: 'Rattacher celui-ci' }))
    expect(faux.rpcs).toEqual([])
  })

  it('la facture source ouverte : sa carte, ses deux signaux ; le clic ouvre sa fenêtre, ce crédit imposé, sans rien écrire', async () => {
    rendre()
    await ouvrir('VIR LIBRAIRIE ROCHER')
    const section = proposes() as HTMLElement
    expect(texteDe(section)).toContain('Facture à encaisser')
    expect(texteDe(section)).toContain('F2026-0021 — Librairie Rocher, du 20/05/2026 — reste 600,00 €')
    expect(texteDe(section)).toContain(SIGNAL_MONTANT_CREDIT)
    expect(texteDe(section)).toContain(signalDuClient('Librairie Rocher'))
    // Avant une affectation, la pièce à valider du même montant se dit d'abord, comme hier ; la facture, à son rang.
    expect(texteDe(volet())).toContain('Une pièce du même montant attend un rapprochement.')
    await cliquer(within(section).getByRole('button', { name: 'Enregistrer son encaissement…' }))
    await screen.findByRole('heading', { name: 'Encaissements de la facture F2026-0021' })
    screen.getByText(/^15\/07\/2026 · VIR LIBRAIRIE ROCHER · 600,00\s€$/)
    expect(faux.rpcs).toEqual([])
    expect(faux.ecritures).toEqual([])
  })

  it('un crédit qu’aucune vente ne justifie : aucune proposition', async () => {
    rendre()
    await ouvrir('VIR GAMMA SANTE ACOMPTE')
    expect(proposes()).toBeNull()
  })
})

describe('la fiche d’un débit libre : la liste entière, le client cité, et ce que le lot des règles en apprend', () => {
  it('une contre-passation sans mouvement que le débit fait : « client cité au libellé », et le justificatif possible', async () => {
    const enc = (o: Record<string, unknown>) => ({
      dossier_id: D, facture_id: 'f1', ligne_bancaire_id: null, motif: null, moyen: 'cheque', cree_le: '2026-06-08T10:00:00Z',
      retire_le: null, retire_par: null, compte_contrepartie: null, cree_par: 'cabinet-1', annule_id: null, ...o,
    })
    faux.parTable.encaissements_factures = [
      ...faux.parTable.encaissements_factures,
      enc({ id: 'o9', montant: 300, date_encaissement: '2026-06-04' }),
      enc({ id: 'cp9', montant: -300, annule_id: 'o9', date_encaissement: '2026-06-08', motif: 'Chèque revenu impayé' }),
    ]
    faux.parTable.encaissements_factures_taux = [
      ...faux.parTable.encaissements_factures_taux, { encaissement_id: 'o9', dossier_id: D, taux: 0, montant: 300 },
      { encaissement_id: 'cp9', dossier_id: D, taux: 0, montant: -300 },
    ]
    faux.parTable.lignes_bancaires = [
      ...faux.parTable.lignes_bancaires,
      mouvement({ id: 'm-impaye', date: '2026-06-10', montant: -301.5, libelle: 'IMPAYE CHQ LIBRAIRIE ROCHER' }) as unknown as Record<string, unknown>,
    ]
    rendre()
    await ouvrir('IMPAYE CHQ LIBRAIRIE ROCHER')
    const section = within(volet()).getByRole('region', { name: TITRE_RATTACHER_CONTRE_PASSATION })
    const libelles = [...(within(section).getByRole('combobox') as HTMLSelectElement).options].map((o) => espaces(o.textContent ?? ''))
    expect(libelles).toEqual(['— Choisir —', 'Contre-passation, facture F2026-0021 (Librairie Rocher) — chèque du 08/06/2026 · -300,00 € · '
      + 'client cité au libellé'])
    expect(texteDe(volet())).toContain(JUSTIFICATIF_CONTRE_PASSATION)
    // Aucune proposition en tête sur un débit : un impayé ne se devine pas.
    expect(proposes()).toBeNull()
    expect(faux.rpcs).toEqual([])
  })
})

describe('les lots, sur un dossier basculé : aucun ne prend un crédit qu’une vente facturée justifie peut-être', () => {
  it('le lot des règles : « à rapprocher », sous la phrase ; seul le jumeau libre part', async () => {
    rendre()
    const bouton = await lot('Affecter ce mouvement')
    expect(screen.getByText((_, e) => e?.tagName === 'LI' && texteDe(e).includes('VIR GAMMA SANTE 0001')
      && texteDe(e).includes(JUSTIFICATIF_ENCAISSEMENT))).toBeTruthy()
    await cliquer(bouton, 2)
    await waitFor(() => expect(affectes()).toEqual(['m-libre-regle']))
  })

  it('le rapprochement automatique : l’exemplaire ne se rapproche pas du crédit qu’attend sa facture, et la carte le dit', async () => {
    rendre()
    const bouton = await lot('Tout rapprocher automatiquement (1)')
    const ecart = ecartDe('Rapprochement automatique')
    expect(texteDe(ecart.querySelector('summary'))).toBe('Rapprochement automatique — 1 mouvement écarté : une vente facturée le '
      + 'justifie peut-être — il reste à rapprocher depuis sa fiche.')
    expect(texteDe(ecart.querySelector('li'))).toBe(`03/06/2026 — VIR SEPA RECU 7781 — 600,00 € : ${JUSTIFICATIF_FACTURE}`)
    await cliquer(bouton)
    await waitFor(() => expect(mouvementsEcrits()).toEqual(['m-libre-auto']))
  })

  it('« Valider et rapprocher » : la pièce du crédit candidat n’est ni validée ni rapprochée', async () => {
    rendre()
    const bouton = await lot('Valider et rapprocher cette pièce')
    expect(texteDe(ecartDe('Validation en lot').querySelector('li')))
      .toBe(`15/07/2026 — VIR LIBRAIRIE ROCHER — 600,00 € : ${JUSTIFICATIF_FACTURE}`)
    await cliquer(bouton)
    await waitFor(() => expect(mouvementsEcrits()).toEqual(['m-libre-cert']))
    expect(piecesValidees()).toEqual(['p-cert'])
  })

  it('« À trancher par l’opérateur » dit, de la paire d’un crédit candidat, ce que sa vente en dit', async () => {
    rendre()
    const carte = (await screen.findByRole('heading', { name: /^À trancher par l'opérateur/ })).closest('.card') as HTMLElement
    const ligne = within(carte).getAllByRole('row').find((r) => texteDe(r).includes('VIR SEPA RECU 7781')) as HTMLElement
    expect(texteDe(within(ligne).getAllByRole('cell')[3])).toBe(`fournisseur non confirmé par le libellé bancaire — ${JUSTIFICATIF_FACTURE}`)
  })

  it('la règle « toujours ignorer » ne fait pas ignorer le candidat qu’elle reconnaît ; l’écran le dit', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('gamma')
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('VIR GAMMA SANTE ACOMPTE')
    await cliquer(within(volet()).getByRole('button', { name: 'Toujours ignorer ce type…' }))
    await waitFor(() => expect(mouvementsEcrits()).toEqual(['m-libre-regle']))
    expect(alerte).toHaveBeenCalledTimes(1)
    expect(espaces(String(alerte.mock.calls[0][0]))).toContain('1 mouvement écarté : une vente facturée le justifie peut-être')
    expect(espaces(String(alerte.mock.calls[0][0]))).toContain(`05/06/2026 — VIR GAMMA SANTE 0001 — 299,00 € : ${JUSTIFICATIF_ENCAISSEMENT}`)
  })
})

describe('des ventes facturées lues en partie : ni proposition, ni lot', () => {
  it('la fiche ne propose rien, aucun lot ne part', async () => {
    faux.muet = { [`encaissements_factures|${COLONNES_ENCAISSEMENTS_ECRITURES}`]: 0 }
    rendre()
    await screen.findByText(/^Les ventes facturées du dossier n.ont pas pu être lues en entier/)
    for (const nom of ['Tout rapprocher automatiquement (2)', 'Valider et rapprocher les 2', 'Affecter les 2']) {
      const bouton = await lot(nom)
      expect(bouton.disabled, nom).toBe(true)
      await cliquer(bouton, 2)
    }
    await ouvrir('VIR GAMMA SANTE 0001')
    expect(proposes()).toBeNull()
    expect(texteDe(volet())).not.toContain(JUSTIFICATIF_ENCAISSEMENT)
    expect(faux.ecritures).toEqual([])
    expect(faux.rpcs).toEqual([])
  })
})

describe('un dossier qui n’a pas basculé : comme hier', () => {
  it('les lots prennent les crédits « candidats » — il n’y en a pas —, et la fiche ne propose rien', async () => {
    rendre(false)
    await cliquer(await lot('Tout rapprocher automatiquement (2)'))
    await waitFor(() => expect([...mouvementsEcrits()].sort()).toEqual(['m-cand-auto', 'm-libre-auto']))
    faux.ecritures = []
    await cliquer(await lot('Valider et rapprocher les 2'))
    await waitFor(() => expect([...piecesValidees()].sort()).toEqual(['p-cand-cert', 'p-cert']))
    await cliquer(await lot('Affecter les 2'))
    await waitFor(() => expect([...affectes()].sort()).toEqual(['m-cand-regle', 'm-libre-regle']))
    await ouvrir('VIR GAMMA SANTE 0001')
    expect(proposes()).toBeNull()
  })
})
