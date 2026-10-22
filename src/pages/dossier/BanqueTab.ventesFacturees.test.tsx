import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { LigneBancaire, Piece } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import {
  COLONNES_ENCAISSEMENTS_ECRITURES, COLONNES_FACTURES_ECRITURES, COLONNES_MOUVEMENTS_ECRITURES, NOMS_DES_LECTURES_ECRITURES,
} from '../../lib/ecrituresVentesFactureesLecture'
import { COLONNES_LIGNES, COLONNES_PARTS } from '../../lib/ventesFactureesLecture'
import { REFUS_GARDE_MOUVEMENTS } from '../../lib/encaissementsFactures'

// LE RELEVÉ RECONNAÎT LES MOUVEMENTS DES VENTES FACTURÉES (ligne 28.65, chantier EC-Q3, étape VF5a1). La règle est éprouvée à
// part (mouvementsDesVentes.test.ts) ; ici, le CÂBLAGE de l'onglet Banque : un dossier basculé lit ses ventes facturées dans
// la même relecture que le relevé, dit les mouvements classés et réservés par leurs pastilles, ferme leur fiche — une carte,
// aucune section de classement, aucun geste —, et, ses ventes lues en partie ou pas encore revenues, le dit et retient la
// fiche et les lots ; un dossier qui n'a pas basculé ne lit rien de plus. Le faux client APPLIQUE les filtres et rend muette
// une seule lecture, désignée par sa table ET ses colonnes : le relevé est lu deux fois, par l'onglet et par les ventes.
// Données FICTIVES.

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
  updatesLignes: [] as Record<string, unknown>[],
  rpcs: [] as string[],
}))

vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))
vi.mock('../../lib/depot', () => ({ ouvrirJustificatif: async () => {} }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    let operation = 'select'
    let unique = false
    let colonnes = '*'
    let valeurMaj: Record<string, unknown> = {}
    let idFiltre: unknown = null
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    const soi = () => c
    Object.assign(c, {
      select: (lues?: string) => { colonnes = lues ?? '*'; return c },
      order: soi, neq: soi, gte: soi, lte: soi, lt: soi, gt: soi, is: soi, not: soi, or: soi, limit: soi,
      eq: (colonne: string, valeur: unknown) => {
        if (colonne === 'id') idFiltre = valeur
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
      update: (valeur: Record<string, unknown>) => { operation = 'update'; valeurMaj = valeur; return c },
      insert: () => { operation = 'insert'; return c },
      upsert: () => { operation = 'upsert'; return c },
      delete: () => { operation = 'delete'; return c },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
        if (table === 'lignes_bancaires' && operation === 'update') {
          faux.updatesLignes.push(valeurMaj)
          faux.parTable.lignes_bancaires = (faux.parTable.lignes_bancaires ?? []).map((l) => (l.id === idFiltre ? { ...l, ...valeurMaj } : l))
          return Promise.resolve({ data: null, error: null }).then(suite, echec)
        }
        if (operation !== 'select') return Promise.resolve({ data: null, error: null }).then(suite, echec)
        if (unique) return Promise.resolve({ data: null, error: null }).then(suite, echec)
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
  const rpc = (nom: string) => { faux.rpcs.push(nom); return Promise.resolve({ data: null, error: null }) }
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

const facture = (id: string, numero: string) => ({
  id, dossier_id: D, statut: 'validee', type: 'facture', numero, date_emission: '2026-05-20', tiers_nom: 'Client fictif',
  facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services', option_debits: false, date_prestation: null,
  montant_ttc: 600,
})
const encaissement = (o: Record<string, unknown> & { id: string; facture_id: string; montant: number }) => ({
  dossier_id: D, date_encaissement: '2026-06-03', moyen: 'virement', ligne_bancaire_id: null, annule_id: null,
  cree_le: '2026-06-03T10:00:00Z', retire_le: null, compte_contrepartie: null, cree_par: 'cabinet-1', ...o,
})

// Un mouvement RÉSERVÉ à l'encaissement de F2026-0014, que le client a enregistré ; un mouvement CLASSÉ par celui de
// F2026-0015, à 1,50 € de frais près ; un encaissement de F2026-0015 par chèque, sans mouvement ; et un prélèvement libre, qu'une
// pièce validée rapproche d'elle-même (le lot du rapprochement automatique).
const RESERVE = mouvement({ id: 'm-res', date: '2026-06-03', montant: 600, libelle: 'VIR SARL HORIZON F2026-0014' })
const CLASSE = mouvement({
  id: 'm-cls', date: '2026-06-04', montant: 478.5, libelle: 'VIR CABINET DURAND', statut: 'rapprochee', encaissements_de_factures: true,
})
const LIBRE = mouvement({ id: 'm-libre', libelle: 'PRLV ATELIER FICTIF' })
// Le lot « Sans doute possible » : une pièce à valider que la banque confirme par ses trois signaux.
const CERTAIN = mouvement({ id: 'm-certain', date: '2026-06-05', montant: -250, libelle: 'CB IMPRIMERIE FICTIVE' })
// Le lot des règles d'affectation : des frais de tenue de compte, qu'une règle range en frais bancaires.
const FRAIS = mouvement({ id: 'm-frais', date: '2026-06-30', montant: -8.5, libelle: 'FRAIS TENUE DE COMPTE' })

function poser() {
  faux.muet = {}
  faux.retenir = {}
  faux.liberer = []
  faux.demandes = []
  faux.updatesLignes = []
  faux.rpcs = []
  faux.parTable = {
    lignes_bancaires: [RESERVE, CLASSE, LIBRE, CERTAIN, FRAIS] as unknown as Record<string, unknown>[],
    pieces: [
      piece({ id: 'p1' }),
      piece({ id: 'p2', tiers: 'Imprimerie fictive', montant_ttc: 250, date_piece: '2026-06-05', statut: 'a_valider' }),
      // La pièce que le client a proposée pour le mouvement réservé : elle ne s'y associe pas.
      piece({ id: 'p3', tiers: 'Client fictif', montant_ttc: 600, date_piece: '2026-06-03', statut: 'a_valider', type_piece: 'vente' }),
    ] as unknown as Record<string, unknown>[],
    categories: [{ id: 'c-frais', dossier_id: D, code: 'frais', libelle: 'Frais bancaires', ordre: 1, compte_comptable: '627000', poste_2035: 'Frais financiers' }],
    regles_affectation_bancaire: [{
      id: 'r-frais', dossier_id: D, motif: 'frais tenue', sens: 'decaissement', categorie_id: 'c-frais', taux_tva: null,
      created_at: '2026-01-01T00:00:00Z',
    }],
    justificatifs_proposes: [{
      id: 'prop-1', dossier_id: D, ligne_bancaire_id: 'm-res', piece_id: 'p3', auteur_id: 'client-1', origine: 'client',
      created_at: '2026-06-03T12:00:00Z', retire_le: null, retire_par: null,
    }],
    factures_emises: [facture('f1', 'F2026-0014'), facture('f2', 'F2026-0015')],
    facture_lignes: [
      { id: 'fl1', facture_id: 'f1', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 500, taux_tva: 20 },
      { id: 'fl2', facture_id: 'f2', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 500, taux_tva: 20 },
    ],
    encaissements_factures: [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm-res', cree_par: 'client-1' }),
      encaissement({ id: 'e2', facture_id: 'f2', montant: 480, ligne_bancaire_id: 'm-cls' }),
      encaissement({ id: 'e3', facture_id: 'f2', montant: 120, moyen: 'cheque' }),
    ],
    encaissements_factures_taux: [
      { encaissement_id: 'e1', dossier_id: D, taux: 20, montant: 600 },
      { encaissement_id: 'e2', dossier_id: D, taux: 20, montant: 480 },
      { encaissement_id: 'e3', dossier_id: D, taux: 20, montant: 120 },
    ],
    memberships: [{ id: 'm-1', dossier_id: D, user_id: 'client-1', droit_banque: true, created_at: '2026-01-01T00:00:00Z' }],
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
const texteDe = (e: Element | null) => (e?.textContent ?? '').replace(/\s/g, ' ')

// La ligne du relevé, cherchée HORS de l'`act`.
async function ligneDuReleve(libelle: string): Promise<HTMLElement> {
  const cellule = (await screen.findAllByText(libelle)).find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  return cellule.closest('tr') as HTMLElement
}
async function ouvrir(libelle: string) {
  const ligne = await ligneDuReleve(libelle)
  await act(async () => { ligne.click() })
}
async function tous() {
  const bouton = await screen.findByRole('button', { name: 'Tous' })
  await act(async () => { bouton.click() })
}
// La pièce que le client a proposée pour le mouvement réservé (« Ma banque », étape P9b) : sa pastille, inchangée.
const PROPOSEE = ['badge-neutral', 'Pièce proposée par le client']
const pastilles = (ligne: HTMLElement) => [...ligne.querySelectorAll('.badge')].map((b) => [b.className.replace('badge ', ''), texteDe(b)])

// Les boutons de la fiche qui ne classent rien : naviguer, fermer, et le fil avec le client.
const SANS_CLASSEMENT = new Set(['Mouvement précédent', 'Mouvement suivant', 'Fermer', 'Fermer le panneau', 'Demander au client'])
const gestesDeLaFiche = () => within(volet()).queryAllByRole('button')
  .map((b) => b.getAttribute('aria-label') ?? texteDe(b).trim())
  .filter((nom) => !SANS_CLASSEMENT.has(nom))

const AUTOMATIQUE = /^Tout rapprocher automatiquement/
const CERTAINS = 'Valider et rapprocher cette pièce'
const REGLES = 'Affecter ce mouvement'
const lot = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement

describe('un dossier basculé, ses ventes facturées lues en entier', () => {
  it('lit ses ventes facturées dans la même relecture que le relevé', async () => {
    rendre()
    await ligneDuReleve('VIR SARL HORIZON F2026-0014')
    for (const cle of [
      `factures_emises|${COLONNES_FACTURES_ECRITURES}`, `facture_lignes|${COLONNES_LIGNES}`,
      `encaissements_factures|${COLONNES_ENCAISSEMENTS_ECRITURES}`, `encaissements_factures_taux|${COLONNES_PARTS}`,
      `lignes_bancaires|${COLONNES_MOUVEMENTS_ECRITURES}`,
    ]) expect(faux.demandes, cle).toContain(cle)
  })

  it('les pastilles : réservé — proposé par le client — à la place de « Non rapproché » ; classé, en vert, ses factures', async () => {
    rendre()
    const reserve = await ligneDuReleve('VIR SARL HORIZON F2026-0014')
    expect(pastilles(reserve)).toEqual([
      ['badge-warning', 'Réservé à l’encaissement de la facture F2026-0014 — proposé par le client'], PROPOSEE,
    ])
    expect(reserve.querySelector('.badge')?.getAttribute('title')).toBe('Encaissement enregistré par le client')
    // Le mouvement libre reste ce qu'il était.
    expect(pastilles(await ligneDuReleve('PRLV ATELIER FICTIF'))).toEqual([['badge-warning', 'Non rapproché · suggestion']])
    await tous()
    // Classé : ni « Rapproché sans justificatif », ni un « Rapproché » nu.
    expect(pastilles(await ligneDuReleve('VIR CABINET DURAND'))).toEqual([['badge-ok', 'Encaissements de factures — F2026-0015']])
  })

  it('la fiche d’un mouvement réservé : la carte, les mots de la garde, aucune section de classement d’hier — le seul geste, classer par ses encaissements (VF5c)', async () => {
    rendre()
    await ouvrir('VIR SARL HORIZON F2026-0014')
    const v = volet()
    const carte = within(v).getByRole('region', { name: 'Réservé à des encaissements de factures' })
    expect(texteDe(carte)).toContain('Facture F2026-0014 — virement du 03/06/2026 par le client600,00 €')
    expect(within(carte).getByText(REFUS_GARDE_MOUVEMENTS[3].modele.replace('%', 'F2026-0014'))).toBeTruthy()
    expect(within(v).queryByText('Non rapproché')).toBeNull()
    expect(within(v).queryByRole('heading', { name: 'Sans justificatif' })).toBeNull()
    expect(within(v).queryByRole('heading', { name: 'Choisir une autre pièce' })).toBeNull()
    // La pièce que le client a proposée se montre, et s'écarte ; elle ne s'associe pas (la garde la refuserait).
    expect(within(v).getByRole('heading', { name: 'Pièce proposée par le client' })).toBeTruthy()
    // Depuis l'étape VF5c, le seul geste de classement est celui de ses encaissements (BanqueTab.gestesDesVentes.test.tsx).
    expect(gestesDeLaFiche().filter((g) => g !== 'Voir le justificatif' && g !== 'Écarter cette proposition'))
      .toEqual(['Classer par ses encaissements'])
  })

  it('la fiche d’un mouvement classé : la carte, sans « Annuler le rapprochement » — seulement « Retirer ce classement » (VF5c)', async () => {
    rendre()
    await tous()
    await ouvrir('VIR CABINET DURAND')
    const v = volet()
    const carte = within(v).getByRole('region', { name: 'Classé par ses encaissements de factures' })
    expect(texteDe(carte)).toContain('Ensemble : 480,00 € ; le mouvement : 478,50 €.')
    expect(within(carte).getByText(REFUS_GARDE_MOUVEMENTS[2].modele)).toBeTruthy()
    expect(within(v).queryByText('Rapproché sans justificatif')).toBeNull()
    // Sa pastille, pas un « Rapproché » nu.
    expect([...v.querySelectorAll('.fiche-mouvement-etat .badge')].map((b) => texteDe(b))).toEqual(['Encaissements de factures — F2026-0015'])
    expect(within(v).queryByRole('heading', { name: 'Rapproché avec' })).toBeNull()
    // Depuis l'étape VF5c, le classement par ses encaissements se retire, par sa fonction seule.
    expect(gestesDeLaFiche()).toEqual(['Retirer ce classement'])
  })

  it('la fiche d’un mouvement libre reste celle d’hier, et les trois lots sont offerts', async () => {
    rendre()
    await ouvrir('PRLV ATELIER FICTIF')
    expect(gestesDeLaFiche()).toContain('Associer cette pièce')
    expect([lot(AUTOMATIQUE).disabled, lot(CERTAINS).disabled, lot(REGLES).disabled]).toEqual([false, false, false])
  })

  it('des accès lus en partie : personne n’est dit « le client », et la carte le dit', async () => {
    faux.parTable.memberships = [...faux.parTable.memberships, { id: 'm-2', dossier_id: D, user_id: 'client-2', droit_banque: false, created_at: '2026-01-02T00:00:00Z' }]
    faux.muet = { 'memberships|id, user_id, droit_banque': 1 }
    rendre()
    const reserve = await ligneDuReleve('VIR SARL HORIZON F2026-0014')
    expect(pastilles(reserve)).toEqual([['badge-warning', 'Réservé à l’encaissement de la facture F2026-0014'], PROPOSEE])
    await ouvrir('VIR SARL HORIZON F2026-0014')
    expect(within(volet()).getByText(/^Les accès du dossier n’ont pas été lus en entier \(/)).toBeTruthy()
    expect(within(volet()).queryByText('par le client')).toBeNull()
  })
})

describe('ses ventes facturées lues en partie : un bandeau, la fiche et les lots retenus', () => {
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
      const bandeau = await screen.findByText(/^Les ventes facturées du dossier n.ont pas pu être lues en entier/)
      expect(texteDe(bandeau)).toContain(`(${nom} :`)
      // Aucun mouvement ne se dit réservé ni « Non rapproché » à tort d'être réservé : on ne sait pas.
      expect(screen.queryByText(/^Réservé/)).toBeNull()
      // Les trois lots se retiennent, et disent pourquoi.
      expect([lot(AUTOMATIQUE).disabled, lot(CERTAINS).disabled, lot(REGLES).disabled]).toEqual([true, true, true])
      expect(screen.getByText(/^Rapprochement automatique suspendu : une lecture est incomplète \(les ventes facturées du dossier :/)).toBeTruthy()
      expect(screen.getByText(/^Validation en lot suspendue : une lecture est incomplète \(les ventes facturées du dossier :/)).toBeTruthy()
      expect(screen.getByText(/^Affectation en lot suspendue : une lecture est incomplète \(les ventes facturées du dossier :/)).toBeTruthy()
      // La fiche du mouvement libre : la note, aucune section de classement, aucun geste.
      await ouvrir('PRLV ATELIER FICTIF')
      expect(within(volet()).getByText(/ce mouvement porte peut-être l’encaissement d’une facture, et rien ne s’offre/)).toBeTruthy()
      expect(gestesDeLaFiche()).toEqual([])
      expect(faux.updatesLignes).toEqual([])
      expect(faux.rpcs).toEqual([])
    })
  }

  it('le mouvement classé se dit encore classé : sa ligne le porte, sans les numéros', async () => {
    faux.muet = { [`encaissements_factures|${COLONNES_ENCAISSEMENTS_ECRITURES}`]: 1 }
    rendre()
    await tous()
    expect(pastilles(await ligneDuReleve('VIR CABINET DURAND'))).toEqual([['badge-ok', 'Encaissements de factures']])
  })
})

describe('ses ventes facturées pas encore revenues : la fiche se retient', () => {
  it('pendant la relecture qui suit un geste, la fiche n’offre rien ; revenues, elle se rouvre', async () => {
    rendre()
    await ouvrir('PRLV ATELIER FICTIF')
    // La relecture qui suivra le rapprochement : les encaissements y sont retenus.
    faux.retenir = { [`encaissements_factures|${COLONNES_ENCAISSEMENTS_ECRITURES}`]: true }
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(faux.liberer).toHaveLength(1))
    expect(faux.updatesLignes).toEqual([{ statut: 'rapprochee', piece_id: 'p1' }])
    expect(within(volet()).getByText(/^Les ventes facturées du dossier sont en cours de lecture/)).toBeTruthy()
    expect(gestesDeLaFiche()).toEqual([])
    await act(async () => { faux.liberer.forEach((l) => l()) })
    await waitFor(() => expect(gestesDeLaFiche()).toContain('Annuler le rapprochement'))
    expect(faux.updatesLignes).toHaveLength(1)
  })
})

describe('un dossier qui n’a pas basculé', () => {
  it('ne lit rien de plus, ne dit rien d’un mouvement réservé, et un mouvement classé n’est pas « sans justificatif »', async () => {
    rendre(false)
    const reserve = await ligneDuReleve('VIR SARL HORIZON F2026-0014')
    expect(faux.demandes.filter((d) => /^(factures_emises|facture_lignes|encaissements_factures|encaissements_factures_taux)\|/.test(d))).toEqual([])
    expect(faux.demandes).not.toContain(`lignes_bancaires|${COLONNES_MOUVEMENTS_ECRITURES}`)
    expect(pastilles(reserve)).toEqual([['badge-warning', 'Non rapproché'], PROPOSEE])
    expect(screen.queryByText(/^Les ventes facturées du dossier/)).toBeNull()
    expect([lot(AUTOMATIQUE).disabled, lot(CERTAINS).disabled, lot(REGLES).disabled]).toEqual([false, false, false])
    await tous()
    expect(pastilles(await ligneDuReleve('VIR CABINET DURAND'))).toEqual([['badge-ok', 'Encaissements de factures']])
    await ouvrir('VIR CABINET DURAND')
    expect(within(volet()).getByText(REFUS_GARDE_MOUVEMENTS[2].modele)).toBeTruthy()
    expect(gestesDeLaFiche()).toEqual([])
    // Le mouvement « réservé » d'un dossier qui n'a pas basculé n'existe pas en base : sa fiche est celle d'hier.
    await ouvrir('VIR SARL HORIZON F2026-0014')
    expect(within(volet()).queryByText(/Réservé/)).toBeNull()
  })
})
