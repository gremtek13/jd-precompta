import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ChecklistTab from './ChecklistTab'
import type { Piece } from '../../lib/types'

// L'ÉCRAN QUI PRÉTEND DIRE CE QUI MANQUE — donc celui dont le SILENCE est le plus dangereux, parce
// qu'il est exactement ce qu'on attend de lui quand tout va bien. Un contrôle branché sur le mauvais
// sous-ensemble y est invisible : le module appelé derrière est juste, l'écran est calme, et il n'y a
// rien à regarder.
//
// Ce test garde ce câblage-là, et pas le calcul. Le projet connaissait déjà le piège — il est écrit
// en tête du composant, sur moisEnDoubleSurAbonnement — et il s'est reproduit quand même sur
// piecesADateImpossible : la SEULE pièce de la base à porter une date impossible est « à valider »,
// donc le contrôle était aveugle sur le cas même que son commentaire cite comme origine.
const faux = vi.hoisted(() => ({ parTable: {} as Record<string, unknown[]> }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      // Le statut demandé décide de ce que rend la table `pieces` : c'est tout l'objet du test, les
      // deux piles devant être distinguables.
      let statut: string | null = null
      Object.assign(chaine, {
        select: () => chaine,
        eq: (colonne: string, valeur: string) => { if (colonne === 'statut') statut = valeur; return chaine },
        is: () => chaine,
        not: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          const cle = table === 'pieces' && statut ? `pieces:${statut}` : table
          const toutes = faux.parTable[cle] ?? []
          return Promise.resolve({
            data: toutes.slice(debut, debut + (fin - debut + 1)),
            error: null,
            count: toutes.length,
          }).then(suite)
        },
      })
      return chaine
    },
  },
}))

// Deux lectures best-effort que le composant fait hors du client Supabase.
vi.mock('../../lib/controlesReleves', () => ({ chargerRelevesIncoherents: async () => [] }))
vi.mock('../../lib/doublonsTexte', () => ({ chargerDoublonsDeTexte: async () => [] }))

// Le jeu d'essai est TYPÉ, et sans `as` : c'est le compilateur qui vérifie alors chaque champ
// contre `Piece`, donc contre la table — exhaustivement, à chaque build. Un `as Piece` ou un objet
// nu rendrait la vérification muette, et c'est ce qui avait laissé passer `devise: null` alors que
// la colonne est NOT NULL DEFAULT 'EUR' : chaque pièce du jeu d'essai comptait en « devise non
// convertie » (`piecesDeviseNonConvertie` teste `devise !== 'EUR'`, vrai pour null) sans qu'aucun
// test n'échoue. Un piège que le compilateur supprime vaut mieux qu'un piège gardé par un contrôle.
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier-de-test/justificatif.pdf', nom_fichier: 'justificatif.pdf',
    storage_hash: null, date_piece: null, tiers: null, montant_ht: null, montant_tva: null,
    montant_ttc: null, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'a_valider', notes: null, confiance: 'haute', superpdp_invoice_id: null,
    created_at: '2026-09-16T09:00:00Z', updated_at: '2026-09-16T09:00:00Z', ...o,
  }
}

function poser(pieces: { validees?: unknown[]; aValider?: unknown[] }) {
  faux.parTable = {
    'pieces:validee': pieces.validees ?? [],
    'pieces:a_valider': pieces.aValider ?? [],
    pieces: [...(pieces.validees ?? []), ...(pieces.aValider ?? [])],
    cotisations_declarees: [], lignes_bancaires: [], immobilisations: [],
    natures_immobilisation: [], categories: [], ecritures_brouillon: [],
    declarations_tva: [], documents_divers: [], informations_dossier: [],
  }
}

function monter() {
  return render(<ChecklistTab dossierId="dossier-de-test" assujettiTva={false} onNavigate={() => {}} />)
}

const LIBELLE = /datée\(s\) après leur dépôt/

describe('ChecklistTab — une date impossible se voit AVANT la validation', () => {
  it('signale une pièce « à valider » datée après son dépôt', async () => {
    // Le cas réel, reconstruit : datée de 2028, déposée en 2026, sans tiers ni montant. Branché sur
    // les seules pièces validées, ce point reste à zéro et l'écran n'a rien à montrer.
    poser({ aValider: [piece({ id: 'futur', date_piece: '2028-09-27' })] })
    monter()

    const ligne = await screen.findByText(LIBELLE)
    expect(ligne.textContent).toMatch(/^1 /)

    // ET IL DIT COMMENT LA TROUVER. Le bouton ne suffit pas : la pièce est par définition dans un
    // exercice futur, donc écartée par le sélecteur d'exercice de l'en-tête, qui s'ouvre toujours
    // sur une année précise. Sans cette ligne, « Corrigez ces dates » menait vers une liste où la
    // pièce n'apparaît même pas. (Ce point s'annonçait « le seul » dans ce cas — il ne l'était que
    // parmi les pièces DATÉES, voir le bloc suivant.)
    expect(screen.getByText(/toutes les années/)).toBeDefined()
  })

  it('signale aussi une pièce VALIDÉE datée après son dépôt', async () => {
    // L'autre moitié : élargir aux deux piles ne doit pas faire perdre celle qui marchait déjà.
    poser({ validees: [piece({ id: 'futur', statut: 'validee', date_piece: '2028-09-27' })] })
    monter()

    const ligne = await screen.findByText(LIBELLE)
    expect(ligne.textContent).toMatch(/^1 /)
  })

  it('se tait quand toutes les dates sont antérieures au dépôt', async () => {
    poser({
      validees: [piece({ id: 'ok1', statut: 'validee', date_piece: '2026-03-10' })],
      aValider: [piece({ id: 'ok2', date_piece: '2026-01-05' })],
    })
    monter()

    // Le point d'ancrage est un AUTRE point de la même liste, que ce jeu de données déclenche
    // forcément (la pièce validée n'a pas de catégorie) : il prouve que le rendu a eu lieu et que la
    // liste est peuplée. Sans lui, un écran encore en chargement rendrait ce test vert pour une
    // raison fausse — c'est le piège d'un test qui vérifie une ABSENCE.
    await screen.findByText(/sans catégorie/)
    expect(screen.queryByText(LIBELLE)).toBeNull()
  })
})

describe('ChecklistTab — une pièce SANS date n’est sous aucun exercice, et le point le dit', () => {
  // LE CAS QUE LA RÈGLE AVAIT MANQUÉ. `PiecesTab` écarte toute pièce dont `date_piece` est nul dès
  // qu'un exercice précis est choisi — et il l'est toujours, `calculerAnneeParDefaut` ne rendant
  // « toutes » que sur un dossier vide. C'est PIRE que la date impossible traitée au-dessus :
  // celle-là se retrouve en changeant d'année, celle-ci ne se retrouve sous AUCUNE année.
  //
  // Aucun test de `src/lib` ne peut voir ça : `detailPiecesSansDate` est juste, c'est son CÂBLAGE
  // point par point qui décide — exactement le piège qui s'est déjà refermé deux fois sur cet écran.
  const SANS_CATEGORIE = /sans catégorie/

  it('accroche le détail au point « sans catégorie » quand la pièce comptée n’a pas de date', async () => {
    poser({ validees: [piece({ id: 'orpheline', statut: 'validee', date_piece: null })] })
    monter()

    await screen.findByText(SANS_CATEGORIE)
    expect(screen.getByText(/Elle est sans date/)).toBeDefined()
    // Les deux sorties, nommées : sans elles le détail dit qu'un problème existe sans dire quoi faire.
    expect(screen.getByText(/toutes les années/)).toBeDefined()
    expect(screen.getByText(/Sans date/)).toBeDefined()
  })

  it('ne l’accroche PAS quand la pièce comptée porte une date — sinon il ne prouverait rien', async () => {
    // Le garde symétrique. Un détail affiché en permanence satisferait le test ci-dessus tout en
    // cessant d'être lu, et emporterait ses voisins dans son discrédit.
    poser({ validees: [piece({ id: 'datee', statut: 'validee', date_piece: '2026-03-10' })] })
    monter()

    await screen.findByText(SANS_CATEGORIE)
    expect(screen.queryAllByText(/sans date/i)).toHaveLength(0)
  })

  it('l’accroche aussi au point « confiance basse », qui porte sur l’autre pile', async () => {
    // Un seul point câblé ne prouve pas le câblage : c'est en s'arrêtant à mi-chemin que les deux
    // badges manquants de `date-impossible` et `devise-non-convertie` avaient survécu.
    poser({ aValider: [piece({ id: 'floue', confiance: 'basse', date_piece: null })] })
    monter()

    await screen.findByText(/faible confiance d'extraction/)
    expect(screen.getByText(/Elle est sans date/)).toBeDefined()
  })
})

// LE POINT « FACTURES / PIÈCES » NE COMPTE PAS CE QUE LE CLIENT CROIT AVOIR ENVOYÉ.
//
// Il filtre sur `date_piece` (la date du DOCUMENT) ; `ClientHome` et `ClientUpload` comptent les
// DÉPÔTS. Mesuré sur le dossier vivant : 43 pièces déposées en 2026, UNE SEULE datée de 2026 — le
// dépôt suit la date de pièce de 549 jours en médiane. Les deux questions sont légitimes, elles ne
// doivent simplement plus se dire dans les mêmes mots ; et le commentaire du composant affirmait
// « toutes les pièces REÇUES cette année », soit exactement l'autre.
describe('ChecklistTab — le point « factures » dit ce qu’il compte', () => {
  const ANNEE = new Date().getFullYear()

  it('annonce des pièces DATÉES de l’année, jamais « déposées »', async () => {
    poser({ validees: [piece({ id: 'a', statut: 'validee', date_piece: `${ANNEE}-03-04` })] })
    monter()
    expect(await screen.findByText(/1 pièce\(s\) datée\(s\) de cette année/)).toBeTruthy()
  })

  it('NE DIT PLUS « aucune pièce déposée » quand le client a envoyé des pièces sans date', async () => {
    // Le cas qui envoie le cabinet relancer un client qui a déjà envoyé : l'écran du client compte
    // ces dépôts, celui du cabinet les ignorait en silence.
    poser({ aValider: [piece({ id: 'b', statut: 'a_valider', date_piece: null })] })
    monter()
    expect(await screen.findByText(/1 pièce\(s\) sans date, rattachée\(s\) à aucun exercice/)).toBeTruthy()
    expect(screen.queryAllByText(/Aucune pièce déposée/)).toHaveLength(0)
  })

  it('NE COMPTE PAS une pièce d’un autre exercice', async () => {
    // Sans ce cas, retirer le filtre d'année laissait les trois tests précédents VERTS : ils ne
    // posaient que des pièces de l'année en cours, donc l'assiette n'était gardée par rien. Une
    // mutation qui ne mord pas accuse d'abord le jeu d'essai.
    poser({
      validees: [
        piece({ id: 'ici', statut: 'validee', date_piece: `${ANNEE}-02-02` }),
        piece({ id: 'ailleurs', statut: 'validee', date_piece: `${ANNEE - 3}-02-02` }),
      ],
    })
    monter()
    expect(await screen.findByText(/1 pièce\(s\) datée\(s\) de cette année/)).toBeTruthy()
    expect(screen.queryAllByText(/2 pièce\(s\) datée\(s\)/)).toHaveLength(0)
  })

  it('SE TAIT sur les pièces sans date quand il n’y en a aucune', async () => {
    // Garde symétrique : sans lui, « l'écran le signale » serait satisfait par un écran qui le
    // signale TOUJOURS — et une mise en garde permanente cesse d'être lue.
    poser({ validees: [piece({ id: 'c', statut: 'validee', date_piece: `${ANNEE}-05-05` })] })
    monter()
    await screen.findByText(/1 pièce\(s\) datée\(s\) de cette année/)
    expect(screen.queryAllByText(/sans date, rattachée/)).toHaveLength(0)
  })
})
