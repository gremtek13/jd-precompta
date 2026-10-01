import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientSimulation from './ClientSimulation'
import type {
  Categorie, CotisationDeclaree, LigneBancaire, Piece, ReferenceAnnuelle, ReglementGroupe, VentilationBancaire,
} from '../lib/types'
import type { Predicat } from '../test/filtresPostgrest'

// LA SIMULATION DU CLIENT, dernier écran client sans test de rendu — et celui dont la projection
// portait trois défauts à la fois (voir `projectionAnnuelle`, lib/estimation.ts, qui les garde à
// l'unité). Ce que ce test garde et qu'aucun test de `src/lib` ne peut voir : que CET écran appelle
// bien le calcul partagé, avec l'horloge du RENDU, et qu'il ne dise pas « aucun repère » sur une
// lecture refusée.
//
// LA DATE DE CHARGEMENT DU MODULE EST POSÉE AVANT LES IMPORTS, et c'est ce qui rend le défaut
// d'appariement reproductible : l'écran figeait son année au chargement et relisait le mois au rendu.
// Sans cette précaution, le module se chargerait à la date réelle, et le test ne distinguerait le
// défaut que les années où la date réelle diffère de celle du rendu — vert par hasard le reste du temps.
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-12-20T10:00:00Z'))
})

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  refusees: new Set<string>(),
  // Le serveur qui cesse de rendre une table au-delà de N lignes tout en annonçant le vrai total :
  // la panne qui produit une lecture INCOMPLÈTE (voir lib/lectureComplete.ts).
  muet: {} as Record<string, number>,
}))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const chaine: Record<string, unknown> = {}
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        // Les filtres sont APPLIQUÉS (voir src/test/filtresPostgrest.ts). Acceptés sans effet, ils
        // laissaient ce test vert sur deux lectures qui cachent tout ce que la ligne 26.6 ajoute : les
        // mouvements rapprochés restreints à ceux qui portent une pièce, et les catégories lues sur le
        // seul dossier — celles du cabinet, les seules qui existent en production, n'y sont pas.
        const predicats: Predicat[] = []
        Object.assign(chaine, {
          select: () => chaine,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return chaine },
          not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return chaine },
          // Les catégories se lisent sur le dossier ET le cabinet (`dossier_id` nul).
          or: (expression: string) => { predicats.push(predicatOr(expression)); return chaine },
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          // La lecture du statut TVA du dossier, une seule ligne.
          maybeSingle: () => Promise.resolve(
            faux.refusees.has(table)
              ? { data: null, error: { message: 'permission denied' } }
              : { data: (faux.parTable[table] ?? [])[0] ?? null, error: null },
          ),
          then: (suite: (r: { data: unknown[] | null; error: { message: string } | null; count: number | null }) => unknown) => {
            if (faux.refusees.has(table)) {
              return Promise.resolve({ data: null, error: { message: 'permission denied' }, count: null }).then(suite)
            }
            const toutes = filtrer(faux.parTable[table] ?? [], predicats)
            const plafond = faux.muet[table] ?? Number.MAX_SAFE_INTEGER
            return Promise.resolve({
              data: toutes.slice(debut, Math.min(fin + 1, plafond)),
              error: null,
              count: toutes.length,
            }).then(suite)
          },
        })
        return chaine
      },
    },
  }
})

// Même doublure que les autres écrans client : un `AuthProvider` complet ferait dépendre le test
// d'une session Supabase.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'dossier-de-test' }),
}))

// Typés sans `as` : le compilateur confronte chaque champ à la table.
function recette(o: Partial<Piece> = {}): Piece {
  return {
    id: 'r1', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier-de-test/r.pdf', nom_fichier: 'r.pdf', storage_hash: null,
    date_piece: '2026-03-02', tiers: 'CPAM', montant_ht: null, montant_tva: null,
    montant_ttc: 600, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'vente',
    statut: 'validee', notes: null, confiance: 'haute', superpdp_invoice_id: null,
    created_at: '2026-03-02T09:00:00Z', updated_at: '2026-03-02T09:00:00Z', ...o,
  }
}

function echeance(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
  return {
    id: 'e1', dossier_id: 'dossier-de-test', echeance: '2026-01-05', montant_appele: 100,
    montant_verse: null, montant_csg_crds: null, previsionnel: false,
    created_at: '2026-01-02T09:00:00Z', ...o,
  }
}

function repere(o: Partial<ReferenceAnnuelle> = {}): ReferenceAnnuelle {
  return {
    id: 'ref-2025', dossier_id: 'dossier-de-test', annee: 2025, chiffre_affaires: 3000,
    total_cotisations_sociales: 1500, resultat_net: null, source: 'saisie_manuelle', notes: null,
    created_at: '2026-02-01T09:00:00Z', ...o,
  }
}

// Un échéancier créé d'avance pour toute l'année, comme le fait « Créer l'échéancier » depuis un
// appel de cotisation : douze échéances de 100 €, le 5 de chaque mois.
const ECHEANCIER_2026 = Array.from({ length: 12 }, (_, i) =>
  echeance({ id: `e${i}`, echeance: `2026-${String(i + 1).padStart(2, '0')}-05` }))

function poser(o: {
  recettes?: Piece[]; cotisations?: CotisationDeclaree[]; reperes?: ReferenceAnnuelle[]; assujetti?: boolean
  paiements?: LigneBancaire[]; modeComptable?: 'tresorerie' | 'engagement'; categories?: Categorie[]
  ventilations?: VentilationBancaire[]; reglements?: ReglementGroupe[]
} = {}) {
  faux.parTable = {
    dossiers: [{ assujetti_tva: o.assujetti ?? false, mode_comptable: o.modeComptable ?? 'tresorerie' }],
    pieces: o.recettes ?? [],
    cotisations_declarees: o.cotisations ?? [],
    references_annuelles: o.reperes ?? [],
    references_postes_annuels: [],
    lignes_bancaires: o.paiements ?? [],
    categories: o.categories ?? [],
    ventilations_bancaires: o.ventilations ?? [],
    reglements_groupes: o.reglements ?? [],
  }
  faux.refusees = new Set()
  faux.muet = {}
}

// Le montant affiché sous un libellé, espaces normalisés : `Intl` sépare les milliers par une espace
// fine insécable et précède « € » d'une insécable.
function valeur(libelle: string): string {
  const bloc = screen.getByText(libelle).parentElement as HTMLElement
  return (bloc.querySelector('strong')?.textContent ?? '').replace(/\s/g, ' ')
}

async function monter() {
  render(<ClientSimulation />)
  await screen.findByRole('heading', { name: /^Projection / })
}

afterEach(() => { vi.useRealTimers() })

describe('ClientSimulation — la projection de l’année', () => {
  it('ne ramène à douze mois que ce qui est échu, sur les mois réellement écoulés', async () => {
    // Le 20 mars : trois échéances échues sur les douze créées, une recette à venir déjà saisie.
    // L'écran affichait les douze échéances comme « appelées à date » et les multipliait par 12/3,
    // soit 4 800 € projetés pour un échéancier de 1 200 €.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({
      recettes: [recette(), recette({ id: 'r2', date_piece: '2026-11-30', montant_ttc: 9000 })],
      cotisations: ECHEANCIER_2026,
      reperes: [repere()],
    })
    await monter()

    screen.getByRole('heading', { name: 'Projection 2026' })
    // 80 jours en 30/360, soit 2,7 mois — et non « 3 mois entamés ».
    screen.getByText(/D'après les 2,7 mois écoulés cette année/)
    expect(valeur('CA encaissé à date')).toBe('600,00 €')
    expect(valeur('Cotisations appelées à date')).toBe('300,00 €')
    expect(valeur("CA projeté sur l'année")).toBe('2 700,00 €')
    expect(valeur("Cotisations projetées sur l'année")).toBe('1 350,00 €')
    // L'écart se compare à l'année d'AVANT celle de la projection.
    expect(screen.getAllByText('(-10 % vs 2025)')).toHaveLength(2)
  })

  it('au 5 janvier, ne ramène pas l’année qui vient de finir à douze fois sa valeur', async () => {
    // Le module a été chargé le 20 décembre (voir en tête) : l'année figée à ce moment-là, face au
    // mois relu au rendu, faisait afficher « Projection 2026 » à 600 000 € — l'année 2026 entière
    // multipliée par douze.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-01-05T10:00:00Z'))
    poser({
      recettes: [recette({ date_piece: '2026-12-10', montant_ttc: 50000 })],
      cotisations: ECHEANCIER_2026,
      reperes: [repere({ id: 'ref-2026', annee: 2026, chiffre_affaires: 48000 })],
    })
    await monter()

    screen.getByRole('heading', { name: 'Projection 2027' })
    expect(valeur('CA encaissé à date')).toBe('0,00 €')
    expect(valeur("CA projeté sur l'année")).toBe('—')
    expect(valeur("Cotisations projetées sur l'année")).toBe('—')
    screen.getByText(/Moins d'un mois s'est écoulé depuis le 1er janvier/)
    expect(screen.queryAllByText(/vs 2026\)/)).toHaveLength(0)
  })
})

// « CA ENCAISSÉ À DATE » DIT ENFIN VRAI : une recette compte à la date de son encaissement quand le
// rapprochement la connaît (lib/rattachement.ts), comme dans l'Estimation du cabinet.
describe('ClientSimulation — le chiffre d’affaires encaissé', () => {
  const encaissement = (date: string): LigneBancaire => ({
    id: 'l1', dossier_id: 'dossier-de-test', date, libelle: 'VIR CPAM', montant: 600, statut: 'rapprochee',
    piece_id: 'r1', cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
    libelle_brut: null, created_at: `${date}T09:00:00Z`,
  })

  it('ne compte pas une recette facturée en mars et encaissée en avril', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({ recettes: [recette()], paiements: [encaissement('2026-04-10')] })
    await monter()
    expect(valeur('CA encaissé à date')).toBe('0,00 €')
  })

  it('compte une recette de décembre encaissée en janvier dans l’année qui commence', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({ recettes: [recette({ date_piece: '2025-12-29' })], paiements: [encaissement('2026-01-06')] })
    await monter()
    expect(valeur('CA encaissé à date')).toBe('600,00 €')
  })

  // EN ENGAGEMENT (lib/engagement.ts), la facture fait le chiffre d'affaires, encaissée ou non : la
  // simulation lit le modèle sur la ligne du dossier, comme le statut TVA.
  it('compte, pour un dossier en engagement, la recette facturée en mars et encaissée en avril', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({ recettes: [recette()], paiements: [encaissement('2026-04-10')], modeComptable: 'engagement' })
    await monter()
    // Et l'écran dit « facturé » : « encaissé » y serait faux.
    expect(valeur('CA facturé à date')).toBe('600,00 €')
    expect(screen.queryByText('CA encaissé à date')).toBeNull()
  })

  it('dit la lecture partielle quand les encaissements n’ont pas pu être lus', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({ recettes: [recette()], paiements: [encaissement('2026-04-10')] })
    faux.refusees = new Set(['lignes_bancaires'])
    await monter()
    screen.getByText(/Tes données n'ont pas pu être affichées en entier/)
  })
})

// UNE RECETTE RÉGLÉE AVEC D'AUTRES PAR UN SEUL VIREMENT (ligne 26) : encaissée à la date de ce virement, pour
// sa part. Le virement ne porte aucune pièce — elles sont dans ses parts, que l'écran du client lit aussi.
describe('ClientSimulation — des recettes encaissées par un virement groupé', () => {
  const virement = (date: string): LigneBancaire => ({
    id: 'g', dossier_id: 'dossier-de-test', date, libelle: 'VIR CPAM', montant: 900, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: true,
    id_externe: null, libelle_brut: null, created_at: `${date}T09:00:00Z`,
  })
  const part = (id: string, pieceId: string, montant: number): ReglementGroupe => ({
    id, dossier_id: 'dossier-de-test', ligne_bancaire_id: 'g', piece_id: pieceId, montant, created_at: '2026-01-06T09:00:00Z',
  })
  const RECETTES = [recette({ date_piece: '2025-12-29' }), recette({ id: 'r2', date_piece: '2025-12-30', montant_ttc: 300 })]

  it('compte des recettes de décembre encaissées en janvier par un seul virement dans l’année qui commence', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({ recettes: RECETTES, paiements: [virement('2026-01-06')], reglements: [part('g1', 'r1', 600), part('g2', 'r2', 300)] })
    await monter()
    expect(valeur('CA encaissé à date')).toBe('900,00 €')
  })

  it('ne compte pas des recettes qu’un virement groupé encaissera plus tard', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({
      recettes: [recette(), recette({ id: 'r2', montant_ttc: 300 })],
      paiements: [virement('2026-04-10')], reglements: [part('g1', 'r1', 600), part('g2', 'r2', 300)],
    })
    await monter()
    expect(valeur('CA encaissé à date')).toBe('0,00 €')
  })

  it('prévient quand les parts ne sont lues qu’en partie', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({ recettes: RECETTES, paiements: [virement('2026-01-06')], reglements: [part('g1', 'r1', 600), part('g2', 'r2', 300)] })
    faux.muet = { reglements_groupes: 1 }
    await monter()
    screen.getByText(/Tes données n'ont pas pu être affichées en entier/)
  })
})

describe('ClientSimulation — une lecture qui échoue', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
  })

  it('ne dit pas « aucun repère » quand les repères n’ont pas pu être lus', async () => {
    poser({ reperes: [repere()] })
    faux.refusees = new Set(['references_annuelles'])
    await monter()

    screen.getByText(/Tes données n'ont pas pu être affichées en entier/)
    screen.getByText("Tes repères n'ont pas pu être affichés.")
    expect(screen.queryAllByText("Aucun repère annuel enregistré pour l'instant.")).toHaveLength(0)
  })

  it('dit en revanche « aucun repère » quand la liste, lue en entier, est vide', async () => {
    // Le garde symétrique : sans lui, « ne dit pas aucun repère sur une panne » serait satisfait par
    // un écran qui crie à la panne sur tout dossier neuf.
    poser()
    await monter()

    screen.getByText("Aucun repère annuel enregistré pour l'instant.")
    expect(screen.queryAllByText(/n'ont pas pu être affiché/)).toHaveLength(0)
  })

  it('prévient quand les recettes ne sont lues qu’en partie', async () => {
    // Tronquées, elles font une projection plausible et BASSE — la bonne nouvelle qu'on ne vérifie pas.
    poser({ recettes: [recette(), recette({ id: 'r2', date_piece: '2026-02-10' })] })
    faux.muet = { pieces: 1 }
    await monter()

    screen.getByText(/Tes données n'ont pas pu être affichées en entier/)
  })
})

describe('ClientSimulation — le montant d’une recette suit le statut TVA du dossier', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
  })

  // Les mêmes chiffres que l'Estimation du cabinet (lib/montantRetenu.ts) : hors taxes pour un
  // dossier assujetti, TVA comprise pour un dossier exonéré. Sans le statut, l'écran retombait sur le
  // HT pour tout le monde.
  const recetteAvecTva = () => recette({ montant_ht: 500, montant_tva: 100, montant_ttc: 600 })

  it('compte le hors taxes pour un dossier assujetti', async () => {
    poser({ recettes: [recetteAvecTva()], assujetti: true })
    await monter()
    expect(valeur('CA encaissé à date')).toBe('500,00 €')
  })

  it('compte la TVA comprise pour un dossier exonéré', async () => {
    poser({ recettes: [recetteAvecTva()], assujetti: false })
    await monter()
    expect(valeur('CA encaissé à date')).toBe('600,00 €')
    expect(screen.queryAllByText(/n'ont pas pu être affichées en entier/)).toHaveLength(0)
  })

  it('prévient quand le statut TVA du dossier n’a pas pu être lu', async () => {
    poser({ recettes: [recetteAvecTva()] })
    faux.refusees = new Set(['dossiers'])
    await monter()
    screen.getByText(/Tes données n'ont pas pu être affichées en entier/)
  })
})

// LIGNE 26.6 : la simulation du client compte, comme l'Estimation du cabinet, les encaissements du
// relevé affectés à une catégorie de recettes — pour un infirmier, presque tout son chiffre
// d'affaires, qui n'a pas de bordereau. Elle lit pour cela les catégories, et n'en montre rien.
describe('ClientSimulation — les encaissements affectés sans justificatif', () => {
  const RECETTES: Categorie = {
    id: 'cat-recettes', dossier_id: null, code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  }
  const affecte = (date: string, o: Partial<LigneBancaire> = {}): LigneBancaire => ({
    id: 'l-cpam', dossier_id: 'dossier-de-test', date, libelle: 'VIR CPAM', montant: 900, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: 'cat-recettes', taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
    source_fichier: null, libelle_brut: null, created_at: `${date}T09:00:00Z`, ...o,
  })

  it('compte un encaissement affecté déjà reçu dans le chiffre d’affaires à date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({ paiements: [affecte('2026-03-10')], categories: [RECETTES] })
    await monter()
    expect(valeur('CA encaissé à date')).toBe('900,00 €')
  })

  it('sur un dossier assujetti, compte un encaissement taxé au hors taxe — entier quand il ne l’est plus', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({ paiements: [affecte('2026-03-10', { montant: 1080, taux_tva: 20 })], categories: [RECETTES], assujetti: true })
    await monter()
    expect(valeur('CA encaissé à date')).toBe('900,00 €')
    cleanup()
    poser({ paiements: [affecte('2026-03-10', { montant: 1080, taux_tva: 20 })], categories: [RECETTES], assujetti: false })
    await monter()
    expect(valeur('CA encaissé à date')).toBe('1 080,00 €')
  })

  it('ne compte pas un encaissement à venir, ni un mouvement dont la catégorie n’a pas été lue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({ paiements: [affecte('2026-04-10'), affecte('2026-03-10', { id: 'l-2', categorie_id: 'cat-inconnue' })], categories: [RECETTES] })
    await monter()
    expect(valeur('CA encaissé à date')).toBe('0,00 €')
  })

  // Une catégorie qui manque à la lecture retire son mouvement du chiffre d'affaires, en silence : la
  // projection baisse, et c'est la bonne nouvelle qu'on ne vérifie pas. La lecture partielle se dit.
  it('prévient quand les catégories ne sont lues qu’en partie', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    const FRAIS: Categorie = { ...RECETTES, id: 'cat-frais', code: 'frais_bancaires', libelle: 'Frais bancaires', compte_comptable: '627000', poste_2035: 'Frais financiers' }
    poser({ paiements: [affecte('2026-03-10')], categories: [RECETTES, FRAIS] })
    faux.muet = { categories: 1 }
    await monter()
    screen.getByText(/Tes données n'ont pas pu être affichées en entier/)
  })
})

// UN ENCAISSEMENT VENTILÉ SUR PLUSIEURS COMPTES (lib/ventilationBanque.ts) — une remise de carte dont
// la banque a retenu sa commission — compte dans le chiffre d'affaires du client par sa part de
// recettes, BRUTE : c'est ce qu'il a facturé, la commission étant une charge. Les parts vivent dans leur
// propre table, que l'écran doit lire.
describe('ClientSimulation — les encaissements ventilés sur plusieurs comptes', () => {
  const RECETTES: Categorie = {
    id: 'cat-recettes', dossier_id: null, code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  }
  const FRAIS: Categorie = { ...RECETTES, id: 'cat-frais', code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 70, compte_comptable: '627000', poste_2035: 'Frais financiers' }
  const remise = (date: string): LigneBancaire => ({
    id: 'l-v', dossier_id: 'dossier-de-test', date, libelle: 'REMISE CB', montant: 870, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: true, reglement_groupe: false, id_externe: null,
    source_fichier: null, libelle_brut: null, created_at: `${date}T09:00:00Z`,
  })
  const part = (id: string, categorieId: string | null, montant: number): VentilationBancaire => ({
    id, dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-v', categorie_id: categorieId,
    part_personnelle: categorieId === null, montant, taux_tva: null, created_at: '2026-03-10T09:00:00Z',
  })

  it('compte la recette brute d’une remise, pas le net versé ni la part personnelle', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    // 870 € versés : 900 € d'honoraires, 50 € d'apport personnel, moins 80 € de commission.
    poser({
      paiements: [remise('2026-03-10')], categories: [RECETTES, FRAIS],
      ventilations: [part('v1', 'cat-recettes', 900), part('v2', null, 50), part('v3', 'cat-frais', -80)],
    })
    await monter()
    expect(valeur('CA encaissé à date')).toBe('900,00 €')
  })

  it('prévient quand les parts ne sont lues qu’en partie', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({
      paiements: [remise('2026-03-10')], categories: [RECETTES, FRAIS],
      ventilations: [part('v1', 'cat-recettes', 950), part('v2', 'cat-frais', -80)],
    })
    faux.muet = { ventilations_bancaires: 1 }
    await monter()
    screen.getByText(/Tes données n'ont pas pu être affichées en entier/)
  })
})

// UNE ÉCHÉANCE DE COTISATION COMPTE À LA DATE ET AU MONTANT DU PRÉLÈVEMENT QUI LA PAIE
// (lib/cotisationRapprochee.ts), comme dans l'Estimation du cabinet et dans la 2035 : « appelées à date »
// ne doit pas dire au client autre chose que ce que son cabinet déclare.
describe('ClientSimulation — les cotisations prélevées', () => {
  const prelevement = (o: Partial<LigneBancaire>): LigneBancaire => ({
    id: 'l-urssaf', dossier_id: 'dossier-de-test', date: '2026-03-06', libelle: 'PRLV URSSAF', montant: -130, statut: 'rapprochee',
    piece_id: null, cotisation_id: 'e2', categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
    libelle_brut: null, created_at: '2026-03-07T09:00:00Z', ...o,
  })

  it('compte une échéance à la date et au montant de son prélèvement', async () => {
    // Le 20 mars : l'échéance du 5 mars prélevée 130 € le 6, celle du 5 avril prélevée d'avance le 18 mars.
    // « À date » : 100 + 100 + 130 + 100 = 430 €, et non les 300 € des trois échéances échues — le test de
    // la projection, plus haut, garde ce second chiffre quand rien ne les paie.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    poser({
      cotisations: ECHEANCIER_2026,
      paiements: [prelevement({}), prelevement({ id: 'l-avance', date: '2026-03-18', montant: -100, cotisation_id: 'e3' })],
    })
    await monter()
    expect(valeur('Cotisations appelées à date')).toBe('430,00 €')
    // 430 € sur 2,7 mois, ramenés à douze.
    expect(valeur("Cotisations projetées sur l'année")).toBe('1 935,00 €')
  })
})
