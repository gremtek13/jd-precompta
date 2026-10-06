import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EstimationTab from './EstimationTab'
import type { Categorie, CotisationDeclaree, ModeComptable, Piece } from '../../lib/types'
import type { Predicat } from '../../test/filtresPostgrest'

// LE CALCUL EST DANS `lib/estimation.ts`, TESTÉ — CE QUI SE JOUE ICI EST LE CÂBLAGE.
//
// Deux écrivains alimentaient `references_postes_annuels` avec deux conventions de signe : le bouton
// « Calculer le détail par poste » écrivait des montants NÉGATIFS pour une charge, le formulaire
// juste au-dessus ce que le cabinet tape. Les deux s'affichent dans le même tableau, sous un titre
// qui dit « autres charges ».
//
// Et l'écran porte DEUX jeux de pièces — `piecesValidees` et `recettesValidees` — dont CLAUDE.md
// raconte qu'un nom y a déjà menti. Se tromper d'argument ne se verrait pas au type, les deux étant
// des `Piece[]` : c'est ce qu'aucun test de `src/lib` ne peut voir.
const faux = vi.hoisted(() => ({
  pieces: [] as unknown[],
  categories: [] as unknown[],
  immobilisations: [] as unknown[],
  upserts: [] as Record<string, unknown>[],
  upsertsAnnuels: [] as Record<string, unknown>[],
  // Le serveur qui cesse de rendre les pièces au-delà de N tout en annonçant le vrai total : la
  // panne qui produit une lecture INCOMPLÈTE (voir lib/lectureComplete.ts).
  muetPieces: null as number | null,
  cotisations: [] as unknown[],
  // Les mouvements rapprochés, qui datent chaque pièce comme dans la 2035 (lib/rattachement.ts).
  paiements: [] as unknown[],
  // Les parts des mouvements ventilés sur plusieurs comptes (lib/ventilationBanque.ts).
  ventilations: [] as unknown[],
  // Les parts des virements qui règlent plusieurs pièces (lib/reglementGroupe.ts).
  reglements: [] as unknown[],
  // Les tables dont la lecture est REFUSÉE : `lireTout` les rend incomplètes, sans aucune ligne.
  refusees: new Set<string>(),
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    let venteSeulement = false
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    // `.not` et `.or` sont APPLIQUÉS (voir src/test/filtresPostgrest.ts) : acceptés sans effet, ils
    // laissaient ce test vert avec la lecture des mouvements rapprochés restreinte à ceux qui portent
    // une pièce — l'estimation perdait alors les recettes affectées sans qu'un test tombe.
    const predicats: Predicat[] = []
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select: () => c,
      eq: (colonne: string, valeur: unknown) => {
        if (colonne === 'type_piece' && valeur === 'vente') venteSeulement = true
        return c
      },
      or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
      not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
      order: () => c, in: () => c, delete: () => c,
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      upsert: (valeur: Record<string, unknown>) => {
        if (table === 'references_postes_annuels') faux.upserts.push(valeur)
        if (table === 'references_annuelles') faux.upsertsAnnuels.push(valeur)
        return c
      },
      then: (suite: (r: unknown) => unknown) => {
        // `pieces` est lu DEUX fois par cet écran : une fois restreint aux ventes
        // (`recettesValidees`), une fois pour toutes les validées (`piecesValidees`). Le faux
        // respecte la distinction, sans quoi le test ne pourrait pas voir l'écran se tromper de jeu.
        if (faux.refusees.has(table)) {
          return Promise.resolve({ data: null, error: { message: 'permission denied' }, count: null }).then(suite)
        }
        const donnees = filtrer(table === 'pieces'
          ? (venteSeulement ? faux.pieces.filter((p) => (p as Piece).type_piece === 'vente') : faux.pieces)
          : table === 'categories' ? faux.categories
          : table === 'immobilisations' ? faux.immobilisations
          : table === 'cotisations_declarees' ? faux.cotisations
          : table === 'lignes_bancaires' ? faux.paiements
          : table === 'ventilations_bancaires' ? faux.ventilations
          : table === 'reglements_groupes' ? faux.reglements : [], predicats)
        if (table === 'pieces' && faux.muetPieces != null) {
          const rendu = donnees.slice(debut, Math.min(fin + 1, faux.muetPieces))
          return Promise.resolve({ data: rendu, error: null, count: donnees.length }).then(suite)
        }
        return Promise.resolve({ data: donnees, error: null, count: donnees.length }).then(suite)
      },
    })
    return c
  }
  return { supabase: { from: (table: string) => chaine(table) } }
})

// TYPÉ SANS `as` : le compilateur vérifie alors chaque champ contre la table — le remède appliqué à
// `ChecklistTab`, `BanqueTab` puis `PiecesTab` après qu'un `devise: null` impossible en base eut fait
// prouver autre chose à un test.
function pieceDeTest(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier/f.pdf', nom_fichier: 'f.pdf', storage_hash: null,
    date_piece: '2025-03-01', tiers: 'Bailleur', montant_ht: 1000, montant_tva: null,
    montant_ttc: 1200, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: 'cat-loyer', sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2025-03-01T09:00:00Z', updated_at: '2025-03-01T09:00:00Z', ...o,
  }
}

// Sans `as`, là encore : la première version de ce jeu d'essai portait un champ `nom` et un `type`
// que `Categorie` n'a pas (elle porte `code` et `libelle`), et c'est le compilateur qui l'a dit.
function categorieDeTest(o: Partial<Categorie> = {}): Categorie {
  return {
    id: 'cat-loyer', dossier_id: null, code: '613200', libelle: 'Loyer', ordre: 1,
    compte_comptable: '613200', poste_2035: 'Loyer', ...o,
  }
}

function cotisationDeTest(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
  return {
    id: 'e1', dossier_id: 'dossier-de-test', echeance: '2026-01-05', montant_appele: 100,
    montant_verse: null, montant_csg_crds: null, previsionnel: false,
    created_at: '2026-01-02T09:00:00Z', ...o,
  }
}

// Le montant affiché sous un libellé, espaces normalisés (`Intl` sépare les milliers par une espace
// fine insécable).
function valeur(libelle: string): string {
  const bloc = screen.getByText(libelle).parentElement as HTMLElement
  return (bloc.querySelector('strong')?.textContent ?? '').replace(/\s/g, ' ')
}

async function rendre(assujettiTva = true, modeComptable: ModeComptable = 'tresorerie') {
  render(<EstimationTab dossierId="dossier-de-test" assujettiTva={assujettiTva} modeComptable={modeComptable} />)
  return screen.findByRole('button', { name: 'Calculer le détail par poste' })
}

describe('EstimationTab — détail par poste', () => {
  it('enregistre des montants POSITIFS pour une charge', async () => {
    faux.pieces = [pieceDeTest()]
    faux.categories = [categorieDeTest()]
    faux.immobilisations = []
    faux.upserts = []

    const bouton = await rendre()
    await act(async () => { bouton.click() })

    expect(faux.upserts).toHaveLength(1)
    expect(faux.upserts[0]).toMatchObject({ annee: 2025, poste: 'Loyer', montant: 1000 })
  })

  it('n’écrit aucune recette dans une carte intitulée « autres charges »', async () => {
    // Et le test le prouve sur un jeu qui contient les DEUX : sans la charge à côté, « n'écrit pas
    // la recette » serait satisfait par un écran qui n'écrit jamais rien.
    faux.pieces = [
      pieceDeTest({ id: 'charge' }),
      pieceDeTest({ id: 'recette', type_piece: 'vente', categorie_id: 'cat-hono', montant_ht: 4500 }),
    ]
    faux.categories = [categorieDeTest(), categorieDeTest({ id: 'cat-hono', code: '706000', libelle: 'Honoraires', poste_2035: 'Honoraires' })]
    faux.immobilisations = []
    faux.upserts = []

    const bouton = await rendre()
    await act(async () => { bouton.click() })

    expect(faux.upserts.map((u) => u.poste)).toEqual(['Loyer'])
  })

  it('n’écrit pas une dépense capitalisée, qui serait comptée deux fois', async () => {
    // Une pièce immobilisée est déjà couverte par son amortissement : la porter aussi en charge
    // courante la compterait deux fois. Trouvé par mutation — l'écran peut très bien appeler le bon
    // calcul en lui passant un ensemble vide, et aucun test de `src/lib` ne le verrait.
    faux.pieces = [pieceDeTest({ id: 'immo' }), pieceDeTest({ id: 'charge', montant_ht: 300 })]
    faux.categories = [categorieDeTest()]
    faux.immobilisations = [{ piece_id: 'immo', id: 'i1' }]
    faux.upserts = []

    const bouton = await rendre()
    await act(async () => { bouton.click() })

    expect(faux.upserts).toHaveLength(1)
    expect(faux.upserts[0]).toMatchObject({ poste: 'Loyer', montant: 300 })
  })

  it('le dit plutôt que d’écrire quand aucune pièce ne porte de poste', async () => {
    // GARDE SYMÉTRIQUE de l'écran : sans elle, « n'écrit pas les recettes » serait satisfait par un
    // bouton muet, et l'opérateur cliquerait sans jamais rien obtenir ni comprendre pourquoi.
    faux.pieces = [pieceDeTest({ categorie_id: null })]
    faux.categories = [categorieDeTest()]
    faux.immobilisations = []
    faux.upserts = []

    const bouton = await rendre()
    await act(async () => { bouton.click() })

    expect(faux.upserts).toHaveLength(0)
    await screen.findByText(/Aucune pièce ni aucun mouvement affecté avec un poste 2035 renseigné/)
  })
})

// UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE. Les deux calculs ENREGISTRENT leur résultat comme
// repère annuel : faits sur une partie des pièces, ils gravaient un chiffre trop bas, qui survivait au
// rechargement de la page alors que le bandeau, lui, disparaissait avec la panne.
describe('EstimationTab — les repères ne se calculent pas sur une lecture partielle', () => {
  function poser() {
    faux.pieces = [pieceDeTest({ id: 'p1' }), pieceDeTest({ id: 'p2', montant_ht: 300 })]
    faux.categories = [categorieDeTest()]
    faux.immobilisations = []
    faux.upserts = []
    faux.upsertsAnnuels = []
    faux.muetPieces = null
  }

  it('grise les deux calculs et n’enregistre rien', async () => {
    poser()
    faux.muetPieces = 1
    await rendre()

    await screen.findByText(/Calcul suspendu/)
    const postes = screen.getByRole('button', { name: 'Calculer le détail par poste' })
    const annuel = screen.getByRole('button', { name: 'Calculer CA + cotisations' })
    expect(postes.hasAttribute('disabled')).toBe(true)
    expect(annuel.hasAttribute('disabled')).toBe(true)
    await act(async () => { postes.click(); annuel.click() })
    expect(faux.upserts).toHaveLength(0)
    expect(faux.upsertsAnnuels).toHaveLength(0)
  })

  it('calcule le repère annuel sur une lecture complète', async () => {
    // Garde symétrique pour le second bouton — le premier a les siens plus haut.
    poser()
    await rendre()
    expect(screen.queryByText(/Calcul suspendu/)).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Calculer CA + cotisations' }).click() })
    // L'année proposée est celle d'avant l'année en cours : lue ici comme l'écran la lit, pour que ce
    // test ne dépende pas du jour où il tourne.
    expect(faux.upsertsAnnuels).toEqual([expect.objectContaining({ annee: new Date().getFullYear() - 1, source: 'calculee' })])
  })
})

// LA PROJECTION DE L'ANNÉE, jumelle de celle de la Simulation client. Le calcul est
// `projectionAnnuelle` (lib/estimation.ts), testé à l'unité ; ce qui se joue ici est que CET écran
// l'appelle avec l'horloge du rendu — il divisait l'échéancier ENTIER par le numéro du mois.
describe('EstimationTab — la projection de l’année', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    faux.pieces = [
      pieceDeTest({ id: 'r1', type_piece: 'vente', categorie_id: null, date_piece: '2026-03-02', montant_ht: 600 }),
      pieceDeTest({ id: 'r2', type_piece: 'vente', categorie_id: null, date_piece: '2026-11-30', montant_ht: 9000 }),
    ]
    faux.categories = []
    faux.immobilisations = []
    faux.muetPieces = null
    // Un échéancier créé d'avance pour toute l'année : douze échéances de 100 €, le 5 de chaque mois.
    faux.cotisations = Array.from({ length: 12 }, (_, i) =>
      cotisationDeTest({ id: `e${i}`, echeance: `2026-${String(i + 1).padStart(2, '0')}-05` }))
  })
  afterEach(() => {
    vi.useRealTimers()
    faux.cotisations = []
    faux.paiements = []
  })

  it('une échéance compte au jour et pour le montant de son prélèvement (lib/cotisationRapprochee.ts)', async () => {
    // Janvier prélevé 98 € au lieu de 100, mars prélevé le 25 — après le 20 : « à date », 98 + 100 (février).
    const prelevement = (cotisationId: string, date: string, montant: number) => ({
      id: `l-${cotisationId}`, dossier_id: 'dossier-de-test', date, libelle: 'PRLV URSSAF', montant, statut: 'rapprochee',
      piece_id: null, cotisation_id: cotisationId, categorie_id: null, emprunt_id: null, ventilee: false, reglement_groupe: false, compte_bilan: null,
      prelevement_personnel: false, source_fichier: null, libelle_brut: null, created_at: `${date}T09:00:00Z`,
    })
    faux.paiements = [prelevement('e0', '2026-01-06', -98), prelevement('e2', '2026-03-25', -100)]
    await rendre()
    expect(valeur('Cotisations appelées à date')).toBe('198,00 €')
  })

  it('ne ramène à douze mois que ce qui est échu, sur les mois réellement écoulés', async () => {
    await rendre()

    screen.getByRole('heading', { name: 'Projection 2026' })
    screen.getByText(/D'après les 2,7 mois écoulés cette année/)
    expect(valeur('Cotisations appelées à date')).toBe('300,00 €')
    expect(valeur('CA encaissé à date')).toBe('600,00 €')
    expect(valeur("Cotisations projetées sur l'année")).toBe('1 350,00 €')
  })
})

// « AUCUN » NE SE DIT QUE D'UNE LISTE LUE EN ENTIER. Sur une lecture refusée, l'affirmer invite à
// ressaisir un repère qui existe déjà — et le bandeau en tête dit déjà que la lecture a échoué.
describe('EstimationTab — des repères qui n’ont pas pu être lus', () => {
  beforeEach(() => {
    faux.pieces = []
    faux.categories = []
    faux.immobilisations = []
    faux.muetPieces = null
  })
  afterEach(() => { faux.refusees = new Set() })

  it('ne dit pas « aucun repère » quand les repères annuels n’ont pas pu être lus', async () => {
    faux.refusees = new Set(['references_annuelles'])
    await rendre()

    screen.getByText("Les repères annuels n'ont pas pu être lus.")
    expect(screen.queryAllByText("Aucun repère annuel enregistré pour l'instant.")).toHaveLength(0)
    // Le détail par poste, lui, a été lu en entier : son « aucun » reste vrai.
    screen.getByText("Aucun détail par poste enregistré pour l'instant.")
  })

  it('ni « aucun détail par poste » quand c’est le détail qui n’a pas pu être lu', async () => {
    faux.refusees = new Set(['references_postes_annuels'])
    await rendre()

    screen.getByText("Le détail par poste n'a pas pu être lu.")
    expect(screen.queryAllByText("Aucun détail par poste enregistré pour l'instant.")).toHaveLength(0)
    screen.getByText("Aucun repère annuel enregistré pour l'instant.")
  })
})

// UN DOSSIER EXONÉRÉ COMPTE TVA COMPRISE (voir lib/montantRetenu.ts). L'onglet appelle TROIS calculs
// qui en dépendent — le détail par poste, le repère annuel et la projection — et chacun reçoit le
// statut par son propre appel : un seul oublié suffirait à les faire diverger sur le même écran.
describe('EstimationTab — un dossier exonéré compte TVA comprise', () => {
  const avecTva = { montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 }
  beforeEach(() => {
    faux.categories = [categorieDeTest()]
    faux.immobilisations = []
    faux.upserts = []
    faux.upsertsAnnuels = []
    faux.muetPieces = null
  })
  afterEach(() => {
    vi.useRealTimers()
    faux.cotisations = []
  })

  it('le détail par poste enregistre la charge TTC', async () => {
    faux.pieces = [pieceDeTest(avecTva)]
    const bouton = await rendre(false)
    await act(async () => { bouton.click() })
    expect(faux.upserts[0]).toMatchObject({ poste: 'Loyer', montant: 1200 })
  })

  it('le repère annuel enregistre le chiffre d’affaires TTC', async () => {
    const annee = new Date().getFullYear() - 1
    faux.pieces = [pieceDeTest({ ...avecTva, type_piece: 'vente', categorie_id: null, date_piece: `${annee}-06-01` })]
    await rendre(false)
    await act(async () => { screen.getByRole('button', { name: 'Calculer CA + cotisations' }).click() })
    expect(faux.upsertsAnnuels[0]).toMatchObject({ annee, chiffre_affaires: 1200 })
  })

  it('la projection compte le chiffre d’affaires TTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    faux.pieces = [pieceDeTest({ ...avecTva, type_piece: 'vente', categorie_id: null, date_piece: '2026-03-02' })]
    await rendre(false)
    expect(valeur('CA encaissé à date')).toBe('1 200,00 €')
  })
})

// L'ANNÉE D'UNE PIÈCE EST CELLE DE SON PAIEMENT, comme dans la 2035 dont ces repères sont
// l'estimation (lib/rattachement.ts). Le calcul est testé à part ; ici c'est le CÂBLAGE — que l'écran
// lise les paiements et les passe aux deux calculs qui ENREGISTRENT un repère, et à la projection.
describe('EstimationTab — une pièce compte à la date de son paiement', () => {
  const annee = new Date().getFullYear() - 1
  const paiement = (pieceId: string, date: string, montant: number) => ({
    id: `l-${pieceId}`, dossier_id: 'dossier-de-test', date, libelle: 'VIR', montant, statut: 'rapprochee',
    piece_id: pieceId, cotisation_id: null, prelevement_personnel: false, source_fichier: null,
    libelle_brut: null, created_at: `${date}T09:00:00Z`,
  })
  beforeEach(() => {
    faux.categories = [categorieDeTest()]
    faux.immobilisations = []
    faux.upserts = []
    faux.upsertsAnnuels = []
    faux.muetPieces = null
  })
  afterEach(() => { faux.paiements = []; faux.cotisations = [] })

  it('le repère annuel compte une échéance de cotisation au jour et pour le montant de son prélèvement', async () => {
    // Juin prélevé 198 € au lieu de 200 ; décembre prélevé en janvier de l'année suivante, donc hors de
    // l'année. Le repère enregistre 198 €, ce que la 2035 de l'année portera ligne 25.
    faux.pieces = []
    faux.cotisations = [
      cotisationDeTest({ id: 'juin', echeance: `${annee}-06-05`, montant_appele: 200 }),
      cotisationDeTest({ id: 'dec', echeance: `${annee}-12-05`, montant_appele: 300 }),
    ]
    faux.paiements = [
      { ...paiement('x', `${annee}-06-07`, -198), id: 'l-juin', piece_id: null, cotisation_id: 'juin' },
      { ...paiement('x', `${annee + 1}-01-06`, -300), id: 'l-dec', piece_id: null, cotisation_id: 'dec' },
    ]
    await rendre()
    await act(async () => { screen.getByRole('button', { name: 'Calculer CA + cotisations' }).click() })
    expect(faux.upsertsAnnuels[0]).toMatchObject({ annee, total_cotisations_sociales: 198 })
  })

  it('le repère annuel ne compte pas une recette encaissée l’année suivante', async () => {
    faux.pieces = [pieceDeTest({ type_piece: 'vente', categorie_id: null, date_piece: `${annee}-12-28` })]
    faux.paiements = [paiement('p1', `${annee + 1}-01-04`, 1200)]
    await rendre()
    await act(async () => { screen.getByRole('button', { name: 'Calculer CA + cotisations' }).click() })
    expect(faux.upsertsAnnuels[0]).toMatchObject({ annee, chiffre_affaires: null })
  })

  it('le détail par poste ne compte pas une charge payée l’année suivante', async () => {
    faux.pieces = [
      pieceDeTest({ id: 'payee-apres', date_piece: `${annee}-12-30` }),
      pieceDeTest({ id: 'payee-dans-l-annee', date_piece: `${annee}-03-01`, montant_ht: 300 }),
    ]
    faux.paiements = [paiement('payee-apres', `${annee + 1}-01-02`, -1200)]
    const bouton = await rendre()
    await act(async () => { bouton.click() })
    expect(faux.upserts).toEqual([expect.objectContaining({ annee, poste: 'Loyer', montant: 300 })])
  })

  it('la projection ne compte pas une recette facturée mais pas encore encaissée', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    faux.pieces = [pieceDeTest({ type_piece: 'vente', categorie_id: null, date_piece: '2026-03-02' })]
    // Le paiement RÈGLE la facture, 1 200 € TTC : un paiement de 1 000 € n'en réglerait qu'une partie,
    // et le reste compterait à la date de facture — 166,67 € « encaissés » sur ce jeu, pour une bonne
    // raison. La première version de ce test portait ce montant-là et échouait sur le code juste.
    faux.paiements = [paiement('p1', '2026-04-10', 1200)]
    await rendre()
    expect(valeur('CA encaissé à date')).toBe('0,00 €')
    vi.useRealTimers()
  })

  // EN ENGAGEMENT (lib/engagement.ts), la date de la FACTURE : l'écran doit passer le modèle du dossier
  // aux trois calculs, sans quoi une société à l'IS verrait ses repères datés à l'encaissement.
  it('en engagement, le repère annuel compte la recette de l’année de sa facture, encaissée ou non', async () => {
    faux.pieces = [pieceDeTest({ type_piece: 'vente', categorie_id: null, date_piece: `${annee}-12-28` })]
    faux.paiements = [paiement('p1', `${annee + 1}-01-04`, 1200)]
    await rendre(true, 'engagement')
    await act(async () => { screen.getByRole('button', { name: 'Calculer CA + cotisations' }).click() })
    expect(faux.upsertsAnnuels[0]).toMatchObject({ annee, chiffre_affaires: 1000 })
  })

  it('en engagement, le détail par poste compte la charge de l’année de sa facture', async () => {
    faux.pieces = [pieceDeTest({ id: 'payee-apres', date_piece: `${annee}-12-30` })]
    faux.paiements = [paiement('payee-apres', `${annee + 1}-01-02`, -1200)]
    const bouton = await rendre(true, 'engagement')
    await act(async () => { bouton.click() })
    expect(faux.upserts).toEqual([expect.objectContaining({ annee, poste: 'Loyer', montant: 1000 })])
  })

  it('en engagement, la projection compte une facture pas encore encaissée', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    faux.pieces = [pieceDeTest({ type_piece: 'vente', categorie_id: null, date_piece: '2026-03-02' })]
    faux.paiements = [paiement('p1', '2026-04-10', 1200)]
    await rendre(true, 'engagement')
    expect(valeur('CA facturé à date')).toBe('1 000,00 €')
    expect(screen.queryByText('CA encaissé à date')).toBeNull()
    vi.useRealTimers()
  })

  it('les deux calculs se suspendent quand les PAIEMENTS sont lus en partie', async () => {
    faux.pieces = [pieceDeTest()]
    faux.paiements = [paiement('p1', `${annee}-03-05`, -1200)]
    faux.refusees = new Set(['lignes_bancaires'])
    await rendre()
    await screen.findByText(/Calcul suspendu/)
    expect(screen.getByRole('button', { name: 'Calculer CA + cotisations' }).hasAttribute('disabled')).toBe(true)
    faux.refusees = new Set()
  })
})

// UN VIREMENT QUI RÈGLE PLUSIEURS PIÈCES (ligne 26) : chaque part date sa pièce comme un rapprochement simple.
// Le virement ne porte aucune pièce — elles sont dans ses parts, que l'écran doit lire : sans elles, les
// pièces retomberaient sur leur date de facture, dans l'exercice d'avant.
describe('EstimationTab — une pièce réglée par un virement groupé', () => {
  const annee = new Date().getFullYear() - 1
  const groupe = (date: string, montant: number) => ({
    id: 'g', dossier_id: 'dossier-de-test', date, libelle: 'VIR GROUPE', montant, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, reglement_groupe: true, prelevement_personnel: false, source_fichier: null,
    libelle_brut: null, created_at: `${date}T09:00:00Z`,
  })
  const part = (id: string, pieceId: string, montant: number) => ({
    id, dossier_id: 'dossier-de-test', ligne_bancaire_id: 'g', piece_id: pieceId, montant, created_at: '2026-01-01T09:00:00Z',
  })
  beforeEach(() => {
    faux.categories = [categorieDeTest()]
    faux.immobilisations = []
    faux.upserts = []
    faux.upsertsAnnuels = []
    faux.muetPieces = null
  })
  afterEach(() => { faux.paiements = []; faux.reglements = []; faux.refusees = new Set() })

  it('le repère annuel ne compte pas des recettes qu’un virement groupé encaisse l’année suivante', async () => {
    faux.pieces = [
      pieceDeTest({ id: 'va', type_piece: 'vente', categorie_id: null, date_piece: `${annee}-12-28` }),
      pieceDeTest({ id: 'vb', type_piece: 'vente', categorie_id: null, date_piece: `${annee}-12-29`, montant_ht: 500, montant_ttc: 600 }),
    ]
    faux.paiements = [groupe(`${annee + 1}-01-04`, 1800)]
    faux.reglements = [part('g1', 'va', 1200), part('g2', 'vb', 600)]
    await rendre()
    await act(async () => { screen.getByRole('button', { name: 'Calculer CA + cotisations' }).click() })
    expect(faux.upsertsAnnuels[0]).toMatchObject({ annee, chiffre_affaires: null })
  })

  it('le détail par poste ne compte pas une charge qu’un virement groupé paie l’année suivante', async () => {
    faux.pieces = [
      pieceDeTest({ id: 'payee-apres', date_piece: `${annee}-12-30` }),
      pieceDeTest({ id: 'aussi-apres', date_piece: `${annee}-12-31`, montant_ht: 200, montant_ttc: 240 }),
      pieceDeTest({ id: 'payee-dans-l-annee', date_piece: `${annee}-03-01`, montant_ht: 300 }),
    ]
    faux.paiements = [groupe(`${annee + 1}-01-02`, -1440)]
    faux.reglements = [part('g1', 'payee-apres', -1200), part('g2', 'aussi-apres', -240)]
    const bouton = await rendre()
    await act(async () => { bouton.click() })
    expect(faux.upserts).toEqual([expect.objectContaining({ annee, poste: 'Loyer', montant: 300 })])
  })

  it('les deux calculs se suspendent quand les parts sont lues en partie', async () => {
    faux.pieces = [pieceDeTest()]
    faux.refusees = new Set(['reglements_groupes'])
    await rendre()
    await screen.findByText(/Calcul suspendu/)
    expect(screen.getByRole('button', { name: 'Calculer CA + cotisations' }).hasAttribute('disabled')).toBe(true)
  })
})

// LIGNE 26.6 : un mouvement du relevé affecté à une catégorie sans justificatif compte dans les
// repères, à sa date — c'est l'essentiel du chiffre d'affaires d'un infirmier. Ce qui se joue ici est
// le CÂBLAGE : que l'écran lise les mouvements affectés (sa lecture ne prenait que ceux d'une pièce)
// et les passe aux trois calculs.
describe('EstimationTab — les mouvements affectés sans justificatif', () => {
  const annee = new Date().getFullYear() - 1
  const RECETTES = categorieDeTest({ id: 'cat-recettes', code: 'ventes_prestations', libelle: 'Ventes / prestations', compte_comptable: '706000', poste_2035: 'Recettes' })
  const FRAIS = categorieDeTest({ id: 'cat-frais', code: 'frais_bancaires', libelle: 'Frais bancaires', compte_comptable: '627000', poste_2035: 'Frais financiers' })
  const mouvement = (id: string, categorieId: string, date: string, montant: number) => ({
    id, dossier_id: 'dossier-de-test', date, libelle: 'VIR', montant, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: categorieId, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, libelle_brut: null, created_at: `${date}T09:00:00Z`,
  })
  beforeEach(() => {
    faux.categories = [categorieDeTest(), RECETTES, FRAIS]
    faux.immobilisations = []
    faux.upserts = []
    faux.upsertsAnnuels = []
    faux.muetPieces = null
    faux.pieces = []
  })
  afterEach(() => { faux.paiements = [] })

  it('le repère annuel compte un encaissement affecté dans le chiffre d’affaires', async () => {
    faux.paiements = [mouvement('cpam', 'cat-recettes', `${annee}-06-10`, 5000)]
    await rendre()
    await act(async () => { screen.getByRole('button', { name: 'Calculer CA + cotisations' }).click() })
    expect(faux.upsertsAnnuels[0]).toMatchObject({ annee, chiffre_affaires: 5000 })
  })

  it('sur un dossier assujetti, le repère compte un encaissement taxé au hors taxe', async () => {
    faux.paiements = [{ ...mouvement('cpam', 'cat-recettes', `${annee}-06-10`, 6000), taux_tva: 20 }]
    await rendre(true)
    await act(async () => { screen.getByRole('button', { name: 'Calculer CA + cotisations' }).click() })
    expect(faux.upsertsAnnuels[0]).toMatchObject({ annee, chiffre_affaires: 5000 })
  })

  it('sur un dossier qui a cessé d’être assujetti, le même encaissement compte entier', async () => {
    faux.paiements = [{ ...mouvement('cpam', 'cat-recettes', `${annee}-06-10`, 6000), taux_tva: 20 }]
    await rendre(false)
    await act(async () => { screen.getByRole('button', { name: 'Calculer CA + cotisations' }).click() })
    expect(faux.upsertsAnnuels[0]).toMatchObject({ annee, chiffre_affaires: 6000 })
  })

  it('le détail par poste compte une dépense affectée dans son poste', async () => {
    faux.paiements = [mouvement('frais', 'cat-frais', `${annee}-06-10`, -8.5)]
    const bouton = await rendre()
    await act(async () => { bouton.click() })
    expect(faux.upserts).toEqual([expect.objectContaining({ annee, poste: 'Frais financiers', montant: 8.5 })])
  })

  // UNE ÉCHÉANCE D'EMPRUNT RAPPROCHÉE (lib/echeanceEmprunt.ts) : ses intérêts en frais financiers, son
  // assurance en primes d'assurance, jamais son capital — par les parts du relevé que l'écran passe au
  // calcul. Trouvé par mutation : l'écran privé des échéances laissait ce fichier vert.
  it('le détail par poste compte les intérêts et l’assurance d’une échéance d’emprunt, pas son capital', async () => {
    faux.paiements = [{
      ...mouvement('ech', 'cat-frais', `${annee}-03-06`, -540), categorie_id: null,
      emprunt_id: 'emp-1', emprunt_echeance: 2, emprunt_interets: 34.55, emprunt_assurance: 21.03,
    }]
    const bouton = await rendre()
    await act(async () => { bouton.click() })
    expect(faux.upserts).toHaveLength(2)
    expect(faux.upserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ annee, poste: 'Frais financiers', montant: 34.55 }),
      expect.objectContaining({ annee, poste: "Primes d'assurance", montant: 21.03 }),
    ]))
  })

  it('la projection compte un encaissement affecté déjà reçu', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    faux.paiements = [mouvement('cpam', 'cat-recettes', '2026-03-10', 900)]
    await rendre()
    expect(valeur('CA encaissé à date')).toBe('900,00 €')
    vi.useRealTimers()
  })
})

// UN MOUVEMENT VENTILÉ SUR PLUSIEURS COMPTES (lib/ventilationBanque.ts) compte dans les repères par ses
// parts, chacune dans le poste de sa catégorie, la part personnelle dans aucun. Les parts vivent dans
// leur propre table : ce qui se joue ici est que l'écran la LISE, la passe aux trois calculs, et qu'une
// lecture partielle des parts suspende les repères comme celle des pièces.
describe('EstimationTab — les mouvements ventilés sur plusieurs comptes', () => {
  const annee = new Date().getFullYear() - 1
  const RECETTES = categorieDeTest({ id: 'cat-recettes', code: 'ventes_prestations', libelle: 'Ventes / prestations', compte_comptable: '706000', poste_2035: 'Recettes' })
  const FRAIS = categorieDeTest({ id: 'cat-frais', code: 'frais_bancaires', libelle: 'Frais bancaires', compte_comptable: '627000', poste_2035: 'Frais financiers' })
  const mouvement = (date: string, montant: number) => ({
    id: 'l-v', dossier_id: 'dossier-de-test', date, libelle: 'REMISE CB', montant, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, ventilee: true,
    source_fichier: null, libelle_brut: null, created_at: `${date}T09:00:00Z`,
  })
  const part = (id: string, categorieId: string | null, montant: number) => ({
    id, dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-v', categorie_id: categorieId,
    part_personnelle: categorieId === null, montant, created_at: '2025-06-11T09:00:00Z',
  })
  beforeEach(() => {
    faux.categories = [categorieDeTest(), RECETTES, FRAIS]
    faux.immobilisations = []
    faux.upserts = []
    faux.upsertsAnnuels = []
    faux.muetPieces = null
    faux.pieces = []
  })
  afterEach(() => {
    faux.paiements = []
    faux.ventilations = []
    faux.refusees = new Set()
  })

  it('le repère annuel compte la recette brute d’une remise, pas le net versé', async () => {
    faux.paiements = [mouvement(`${annee}-06-10`, 4950)]
    faux.ventilations = [part('v1', 'cat-recettes', 5000), part('v2', 'cat-frais', -50)]
    await rendre()
    await act(async () => { screen.getByRole('button', { name: 'Calculer CA + cotisations' }).click() })
    expect(faux.upsertsAnnuels[0]).toMatchObject({ annee, chiffre_affaires: 5000 })
  })

  it('le détail par poste compte la part de chaque catégorie, jamais la part personnelle', async () => {
    faux.paiements = [mouvement(`${annee}-06-10`, -120)]
    faux.ventilations = [part('v1', 'cat-frais', -84), part('v2', null, -36)]
    const bouton = await rendre()
    await act(async () => { bouton.click() })
    expect(faux.upserts).toEqual([expect.objectContaining({ annee, poste: 'Frais financiers', montant: 84 })])
  })

  it('suspend les deux calculs quand les parts n’ont pas pu être lues', async () => {
    faux.paiements = [mouvement(`${annee}-06-10`, 4950)]
    faux.refusees = new Set(['ventilations_bancaires'])
    await rendre()
    await screen.findByText(/Calcul suspendu/)
    const annuel = screen.getByRole('button', { name: 'Calculer CA + cotisations' })
    expect(annuel.hasAttribute('disabled')).toBe(true)
    await act(async () => { annuel.click() })
    expect(faux.upsertsAnnuels).toHaveLength(0)
  })

  it('la projection compte la recette ventilée déjà reçue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'))
    faux.paiements = [mouvement('2026-03-10', 870)]
    faux.ventilations = [part('v1', 'cat-recettes', 900), part('v2', 'cat-frais', -30)]
    await rendre()
    expect(valeur('CA encaissé à date')).toBe('900,00 €')
    vi.useRealTimers()
  })
})
