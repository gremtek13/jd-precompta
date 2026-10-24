import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { LigneBancaire, Piece } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { REFUS_EXEMPLAIRE_D_UNE_SOURCE, REFUS_VALIDATION_D_UNE_VENTE } from '../../lib/exemplairesDesFactures'
import { raisonNonLue } from '../../lib/lotsDeLaJumelleInversee'

// LES LOTS ET LE RELEVÉ DEVANT LA JUMELLE INVERSÉE (ligne 28.65, chantier EC-Q3, étape VF6d ; lib/lotsDeLaJumelleInversee.ts).
// Les plans sont éprouvés à part (lib/lotsDeLaJumelleInversee.test.ts) ; ici, le CÂBLAGE de l'onglet Banque, côté cabinet,
// sur un dossier basculé dont les deux factures sources sont SOLDÉES — aucun candidat de la vente (VF5e) ne retient donc les
// crédits, et seul VF6d les protège :
//   - l'exemplaire d'une facture source (G4) n'entre ni dans le rapprochement automatique, ni dans « Valider et
//     rapprocher », ni dans les justificatifs du lot des règles, ni dans la fiche (proposé, au choix, au règlement groupé) ;
//     une proposition du client qui le cite se dit sous les mots de la garde, sans « Associer » ;
//   - « Valider et rapprocher » écarte la pièce de vente que G3 refuserait de valider, et le dit, avant le clic ;
//   - un dossier qui n'a pas basculé, comme hier.
// Données FICTIVES.

const D = 'dossier-de-test'

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  // `table|colonnes` → N : le serveur ne rend que N lignes en annonçant le vrai total (une lecture INCOMPLÈTE).
  muet: {} as Record<string, number>,
  ecritures: [] as { table: string; operation: string; valeur: unknown; ids: unknown[] }[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
}))

vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))
vi.mock('../../lib/depot', () => ({ ouvrirJustificatif: async () => {} }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn, predicatNot } = await import('../../test/filtresPostgrest')
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
      order: soi, neq: soi, gte: soi, lte: soi, lt: soi, gt: soi, is: soi, or: soi, limit: soi,
      not: (colonne: string, operateur: string, v: unknown) => { predicats.push(predicatNot(colonne, operateur, v)); return c },
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
    dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/${o.id}.pdf`, nom_fichier: `${o.id}.pdf`, storage_hash: null,
    date_piece: '2026-06-01', tiers: 'Atelier fictif', montant_ht: null, montant_tva: null, montant_ttc: 100, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    vente_hors_des_factures: false, created_at: '2026-06-01T09:00:00Z', updated_at: '2026-06-01T09:00:00Z', ...o,
  }
}

// Une facture source, sans TVA (une ligne au taux 0) : son TTC est son hors-taxe.
const facture = (id: string, numero: string, tiers: string, montant: number) => ({
  id, dossier_id: D, statut: 'validee', type: 'facture', numero, date_emission: '2026-05-20', tiers_nom: tiers,
  facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services', option_debits: false, date_prestation: null,
  montant_ht: montant, montant_tva: 0, montant_ttc: montant, emetteur_siret: null, superpdp_invoice_id: null,
})
const encaissement = (id: string, facture_id: string, montant: number, ligne_bancaire_id: string) => ({
  id, facture_id, montant, ligne_bancaire_id, dossier_id: D, date_encaissement: '2026-05-25', moyen: 'virement', annule_id: null,
  motif: null, cree_le: '2026-05-25T10:00:00Z', retire_le: null, retire_par: null, compte_contrepartie: null, cree_par: 'cabinet-1',
})

// F2026-0021 (Librairie Rocher, 600 €) et F2026-0023 (Beta Conseil, 250 €), sources de leur vente, encaissées en entier par
// deux virements classés par leurs encaissements. Leurs exemplaires : celui de F2026-0021, validé ; celui de F2026-0023, à
// valider. Chacun aurait été pris par un lot : le premier rapproché du virement de 600 €, le second validé et rapproché du
// virement de Beta Conseil, et le tiers du premier faisait passer un virement de Librairie Rocher pour justifié.
const CLASSE_1 = mouvement({ id: 'm-cls1', date: '2026-05-25', montant: 600, libelle: 'VIR CABINET DURAND', statut: 'rapprochee', encaissements_de_factures: true })
const CLASSE_3 = mouvement({ id: 'm-cls3', date: '2026-05-25', montant: 250, libelle: 'VIR CABINET MARTIN', statut: 'rapprochee', encaissements_de_factures: true })
const CREDIT_EX = mouvement({ id: 'm-credit-ex', date: '2026-06-03', montant: 600, libelle: 'VIR SEPA RECU 7781' })
const CREDIT_CERT = mouvement({ id: 'm-credit-cert', date: '2026-07-15', montant: 250, libelle: 'VIR BETA CONSEIL' })
const CREDIT_G3 = mouvement({ id: 'm-credit-g3', date: '2026-06-20', montant: 120, libelle: 'VIR GAMMA SANTE' })
const CREDIT_R = mouvement({ id: 'm-credit-r', date: '2026-06-25', montant: 333, libelle: 'VIR LIBRAIRIE ROCHER ACOMPTE' })
const LIBRE_AUTO = mouvement({ id: 'm-libre-auto', libelle: 'PRLV ATELIER FICTIF' })
const LIBRE_CERT = mouvement({ id: 'm-libre-cert', date: '2026-06-05', montant: -75, libelle: 'CB IMPRIMERIE FICTIVE' })

const P_EX = piece({ id: 'p-ex', type_piece: 'vente', tiers: 'Librairie Rocher', montant_ttc: 600, date_piece: '2026-06-02', facture_id: 'f1' })
const P_EX_A_VALIDER = piece({
  id: 'p-ex-av', type_piece: 'vente', tiers: 'Beta Conseil', montant_ttc: 250, date_piece: '2026-07-14', facture_id: 'f3', statut: 'a_valider',
})
// Une pièce de vente à valider que rien ne marque : G3 refuserait de la valider.
const P_G3 = piece({ id: 'p-g3', type_piece: 'vente', tiers: 'Gamma Sante', montant_ttc: 120, date_piece: '2026-06-19', statut: 'a_valider' })

function poser() {
  faux.muet = {}
  faux.ecritures = []
  faux.rpcs = []
  const factures = [facture('f1', 'F2026-0021', 'Librairie Rocher', 600), facture('f3', 'F2026-0023', 'Beta Conseil', 250)]
  faux.parTable = {
    lignes_bancaires: [CLASSE_1, CLASSE_3, CREDIT_EX, CREDIT_CERT, CREDIT_G3, CREDIT_R, LIBRE_AUTO, LIBRE_CERT] as unknown as Record<string, unknown>[],
    pieces: [
      piece({ id: 'p-auto' }),
      P_EX, P_EX_A_VALIDER, P_G3,
      piece({ id: 'p-cert', tiers: 'Imprimerie fictive', montant_ttc: 75, date_piece: '2026-06-05', statut: 'a_valider' }),
    ] as unknown as Record<string, unknown>[],
    categories: [{ id: 'c-rec', dossier_id: D, code: 'recettes', libelle: 'Recettes', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes' }],
    regles_affectation_bancaire: [{
      id: 'r-rocher', dossier_id: D, motif: 'rocher', sens: 'encaissement', categorie_id: 'c-rec', taux_tva: null,
      created_at: '2026-01-01T00:00:00Z',
    }],
    factures_emises: factures,
    facture_lignes: factures.map((f, i) => ({
      id: `fl${i}`, facture_id: f.id, ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: f.montant_ht, taux_tva: 0,
    })),
    encaissements_factures: [encaissement('e1', 'f1', 600, 'm-cls1'), encaissement('e3', 'f3', 250, 'm-cls3')],
    encaissements_factures_taux: [
      { encaissement_id: 'e1', dossier_id: D, taux: 0, montant: 600 }, { encaissement_id: 'e3', dossier_id: D, taux: 0, montant: 250 },
    ],
    transmissions_factures: [{ id: 't9', dossier_id: D, facture_id: 'f1', canal: 'plateforme', hote: 'pa.exemple.fr', flux_id: 'flux-9' }],
    // Le client a proposé l'exemplaire de F2026-0021 pour le virement de 600 €.
    justificatifs_proposes: [{
      id: 'prop-1', dossier_id: D, ligne_bancaire_id: 'm-credit-ex', piece_id: 'p-ex', auteur_id: 'client-1', origine: 'client',
      created_at: '2026-06-04T12:00:00Z', retire_le: null, retire_par: null,
    }],
    memberships: [{ id: 'mb1', user_id: 'client-1', dossier_id: D, droit_banque: true }],
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
async function ouvrir(libelle: string) {
  const cellule = (await screen.findAllByText(libelle)).find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  await act(async () => { (cellule.closest('tr') as HTMLElement).click() })
}
const resumes = (debut: string) => screen.queryAllByText((_, e) => e?.tagName === 'SUMMARY' && texteDe(e).startsWith(debut))

const MOTS_G4 = REFUS_EXEMPLAIRE_D_UNE_SOURCE[0].modele.replace('%', 'p-ex.pdf').replace('%', 'F2026-0021')
const MOTS_G3 = (REFUS_VALIDATION_D_UNE_VENTE.find((r) => r.cle === 'ni_designee_ni_declaree')?.modele ?? '').replace('%', 'p-g3.pdf')

describe('dans un dossier basculé, aucun lot ne prend l’exemplaire d’une facture source', () => {
  it('le rapprochement automatique : seul le jumeau libre part ; l’exemplaire n’est le candidat de rien, et rien ne s’en dit', async () => {
    rendre()
    const bouton = await lot('Tout rapprocher automatiquement (1)')
    expect(resumes('Rapprochement automatique — ')).toEqual([])
    // L'exemplaire n'attend aucun mouvement : il ne se compte pas parmi les pièces validées sans mouvement.
    const ecarts = screen.getByRole('heading', { name: 'Écarts à vérifier' }).closest('.card') as HTMLElement
    expect(texteDe(ecarts.querySelector('p'))).toContain(' · 1 pièce(s) validée(s) sans mouvement bancaire correspondant')
    await cliquer(bouton, 2)
    await waitFor(() => expect(mouvementsEcrits()).toEqual(['m-libre-auto']))
  })

  it('« Valider et rapprocher » : l’exemplaire à valider n’y entre pas ; la pièce que G3 refuserait est écartée, et la carte le dit', async () => {
    rendre()
    const bouton = await lot('Valider et rapprocher cette pièce')
    const [resume] = resumes('Validation en lot — ')
    expect(texteDe(resume)).toBe('Validation en lot — 1 pièce écartée : elle ne se valide pas en lot.')
    expect(texteDe((resume.closest('details') as HTMLElement).querySelector('li')))
      .toBe(`20/06/2026 — VIR GAMMA SANTE — 120,00 € : ${MOTS_G3}`)
    // Le tableau ne montre que la paire qui part.
    const carte = resume.closest('.card') as HTMLElement
    expect(within(carte).getAllByRole('row').slice(1).map((r) => texteDe(r.querySelector('td')))).toEqual(['Imprimerie fictive'])
    await cliquer(bouton, 2)
    await waitFor(() => expect(mouvementsEcrits()).toContain('m-libre-cert'))
    expect(piecesValidees()).toEqual(['p-cert'])
    expect(mouvementsEcrits()).not.toContain('m-credit-cert')
    expect(mouvementsEcrits()).not.toContain('m-credit-g3')
  })

  it('le lot des règles : le tiers de l’exemplaire ne fait plus passer un virement de ce client pour justifié', async () => {
    rendre()
    const bouton = await lot('Affecter ce mouvement')
    await cliquer(bouton, 2)
    await waitFor(() => expect(affectes()).toEqual(['m-credit-r']))
  })

  it('le pont lu en partie : la pièce de vente à valider ne part pas, sous la raison de la lecture ; l’achat, si', async () => {
    faux.muet = { 'transmissions_factures|id, facture_id, canal, hote, flux_id': 0 }
    rendre()
    const bouton = await lot('Valider et rapprocher cette pièce')
    const [resume] = resumes('Validation en lot — ')
    expect(texteDe((resume.closest('details') as HTMLElement).querySelector('li'))).toBe(`20/06/2026 — VIR GAMMA SANTE — 120,00 € : ${raisonNonLue('0 ligne(s) lue(s) sur 1 annoncée(s)')}`)
    await cliquer(bouton)
    await waitFor(() => expect(piecesValidees()).toEqual(['p-cert']))
  })
})

describe('la fiche d’un mouvement, dans un dossier basculé', () => {
  it('l’exemplaire ne s’y propose pas, ni au choix, ni au règlement groupé, ni comme justificatif', async () => {
    rendre()
    await ouvrir('VIR SEPA RECU 7781')
    expect(within(volet()).queryByRole('heading', { name: 'Pièce proposée' })).toBeNull()
    expect(texteDe(volet())).not.toContain('Une pièce du même montant attend un rapprochement.')
    const choix = volet().querySelector('#associer-piece') as HTMLSelectElement
    const offertes = [...choix.options].map((o) => o.value)
    expect(offertes).not.toContain('p-ex')
    expect(offertes).toContain('p-g3')
    await cliquer(within(volet()).getByRole('button', { name: 'Régler plusieurs pièces…' }))
    const parts = [...(within(volet()).getByRole('combobox', { name: 'Pièce 1' }) as HTMLSelectElement).options].map((o) => o.value)
    expect(parts).not.toContain('p-ex')
    expect(parts).toContain('p-g3')
  })

  it('la proposition du client qui le cite : les mots de la garde, sans « Associer » ; elle s’écarte', async () => {
    rendre()
    await ouvrir('VIR SEPA RECU 7781')
    const section = within(volet()).getByRole('region', { name: 'Ce que le client a proposé' })
    expect(texteDe(section)).toContain(`${MOTS_G4} Elle ne s’associe pas à ce mouvement.`)
    expect(within(section).queryByRole('button', { name: 'Associer cette pièce' })).toBeNull()
    expect(within(section).getByRole('button', { name: 'Écarter cette proposition' })).toBeTruthy()
    expect(faux.ecritures).toEqual([])
  })
})

describe('un règlement groupé d’avant la garde, qui règle l’exemplaire d’une facture source', () => {
  it('se modifie sans lui : la garde refuserait de réécrire sa part, et le formulaire le dit avant le clic', async () => {
    const GROUPE = mouvement({
      id: 'm-groupe', date: '2026-06-10', montant: 700, libelle: 'VIR GROUPE FICTIF', statut: 'rapprochee', reglement_groupe: true,
    })
    faux.parTable.lignes_bancaires = [...faux.parTable.lignes_bancaires, GROUPE as unknown as Record<string, unknown>]
    faux.parTable.pieces = [...faux.parTable.pieces,
      piece({ id: 'p-autre', type_piece: 'vente', tiers: 'Studio Bleu', montant_ttc: 100, date_piece: '2026-06-09' }) as unknown as Record<string, unknown>]
    faux.parTable.reglements_groupes = [
      { id: 'rg1', dossier_id: D, ligne_bancaire_id: 'm-groupe', piece_id: 'p-ex', montant: 600 },
      { id: 'rg2', dossier_id: D, ligne_bancaire_id: 'm-groupe', piece_id: 'p-autre', montant: 100 },
    ]
    rendre()
    await cliquer(await screen.findByRole('button', { name: 'Rapprochés' }))
    await ouvrir('VIR GROUPE FICTIF')
    await cliquer(within(volet()).getByRole('button', { name: 'Modifier le règlement…' }))
    expect(texteDe(volet())).toContain(MOTS_G4)
    const enregistrer = within(volet()).getByRole('button', { name: 'Enregistrer le règlement' }) as HTMLButtonElement
    expect(enregistrer.disabled).toBe(true)
    await cliquer(enregistrer)
    expect(faux.rpcs.filter((r) => r.nom === 'regler_pieces_par_mouvement')).toEqual([])
  })
})

describe('un dossier qui n’a pas basculé : comme hier', () => {
  it('l’exemplaire se rapproche et se valide comme une autre pièce ; G3 ne juge rien', async () => {
    rendre(false)
    await cliquer(await lot('Tout rapprocher automatiquement (2)'))
    await waitFor(() => expect([...mouvementsEcrits()].sort()).toEqual(['m-credit-ex', 'm-libre-auto']))
    faux.ecritures = []
    expect(resumes('Validation en lot — ')).toEqual([])
    await cliquer(await lot('Valider et rapprocher les 3'))
    await waitFor(() => expect([...piecesValidees()].sort()).toEqual(['p-cert', 'p-ex-av', 'p-g3']))
  })
})
