import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChecklistTab from './ChecklistTab'
import type { LigneBancaire, Piece } from '../../lib/types'

// L'ÉCRAN QUI PRÉTEND DIRE CE QUI MANQUE — donc celui dont le SILENCE est le plus dangereux, parce
// qu'il est exactement ce qu'on attend de lui quand tout va bien. Un contrôle branché sur le mauvais
// sous-ensemble y est invisible : le module appelé derrière est juste, l'écran est calme, et il n'y a
// rien à regarder.
//
// Ce test garde ce câblage-là, et pas le calcul. Le projet connaissait déjà le piège — il est écrit
// en tête du composant, sur moisEnDoubleSurAbonnement — et il s'est reproduit quand même sur
// piecesADateImpossible : la SEULE pièce de la base à porter une date impossible est « à valider »,
// donc le contrôle était aveugle sur le cas même que son commentaire cite comme origine.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  // Tables dont la lecture est REFUSÉE. Sans ce levier, « la liste des clôtures est inconnue »
  // et « aucun exercice n'est clos » rendent exactement le même écran — or c'est précisément ce
  // que la réserve existe pour distinguer.
  refusees: new Set<string>(),
  // Tables dont le serveur ANNONCE plus de lignes qu'il n'en rend : c'est la forme exacte du plafond
  // de PostgREST (voir lib/lectureComplete.ts), et le seul levier qui produise une lecture
  // INCOMPLÈTE plutôt qu'une lecture refusée. Les deux ne disent pas la même chose à l'écran.
  tronquees: new Set<string>(),
}))

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
        then: (suite: (r: { data: unknown[] | null; error: { message: string } | null; count: number }) => unknown) => {
          const cle = table === 'pieces' && statut ? `pieces:${statut}` : table
          if (faux.refusees.has(table)) {
            return Promise.resolve({ data: null, error: { message: 'permission denied' }, count: 0 }).then(suite)
          }
          const toutes = faux.parTable[cle] ?? []
          return Promise.resolve({
            data: toutes.slice(debut, debut + (fin - debut + 1)),
            error: null,
            count: faux.tronquees.has(table) ? toutes.length + 5 : toutes.length,
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

// TYPÉ sans `as`, pour la même raison que `piece()` ci-dessus : c'est le compilateur qui confronte
// le jeu d'essai à la table.
function ligne(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'dossier-de-test', date: '2026-03-10', libelle: 'PRLV SEPA FOURNISSEUR',
    montant: -120, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null,
    prelevement_personnel: false, source_fichier: null, libelle_brut: null,
    created_at: '2026-03-10T00:00:00Z', ...o,
  }
}

function poser(pieces: {
  validees?: unknown[]
  aValider?: unknown[]
  lignes?: unknown[]
  clotures?: { annee: number }[]
  clotureRefusee?: boolean
  tronquees?: string[]
}) {
  faux.parTable = {
    'pieces:validee': pieces.validees ?? [],
    'pieces:a_valider': pieces.aValider ?? [],
    pieces: [...(pieces.validees ?? []), ...(pieces.aValider ?? [])],
    cotisations_declarees: [], lignes_bancaires: pieces.lignes ?? [], immobilisations: [],
    natures_immobilisation: [], categories: [], ecritures_brouillon: [],
    declarations_tva: [], documents_divers: [], informations_dossier: [],
    exercices_clotures: pieces.clotures ?? [],
  }
  faux.refusees = new Set(pieces.clotureRefusee ? ['exercices_clotures'] : [])
  faux.tronquees = new Set(pieces.tronquees ?? [])
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
    expect(await screen.findByText(/1 pièce\(s\) datée\(s\) de cet exercice/)).toBeTruthy()
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
    expect(await screen.findByText(/1 pièce\(s\) datée\(s\) de cet exercice/)).toBeTruthy()
    expect(screen.queryAllByText(/2 pièce\(s\) datée\(s\)/)).toHaveLength(0)
  })

  it('SE TAIT sur les pièces sans date quand il n’y en a aucune', async () => {
    // Garde symétrique : sans lui, « l'écran le signale » serait satisfait par un écran qui le
    // signale TOUJOURS — et une mise en garde permanente cesse d'être lue.
    poser({ validees: [piece({ id: 'c', statut: 'validee', date_piece: `${ANNEE}-05-05` })] })
    monter()
    await screen.findByText(/1 pièce\(s\) datée\(s\) de cet exercice/)
    expect(screen.queryAllByText(/sans date, rattachée/)).toHaveLength(0)
  })
})

describe('ChecklistTab — le 1er janvier, l’exercice révolu reste réclamé jusqu’à sa clôture', () => {
  // AUCUN TEST DE `src/lib` NE PEUT VOIR CECI : `exercicesAReclamer` est juste et couvert par ses
  // propres mutations. Ce qui se joue ici est le CÂBLAGE — que l'écran lise vraiment
  // `exercices_clotures` et en tienne compte, là où il ne connaissait qu'une seule année.
  //
  // L'HORLOGE EST FIXÉE, et c'est ce qui décide de ce que ce test garde : lu sur l'heure courante,
  // il dirait autre chose chaque jour, et serait vert par hasard onze mois sur douze — le défaut
  // d'origine ne se voit qu'au passage d'une année (même raison que le test des ratios bancaires).
  const PREMIER_JANVIER = new Date('2027-01-05T09:00:00Z')

  // SEUL `Date` est feint : geler les minuteurs figerait aussi ceux dont `findByText` dépend pour
  // attendre le rendu, et chaque test partirait en expiration — une panne qui ne ressemble pas au
  // défaut gardé.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(PREMIER_JANVIER) })
  afterEach(() => { vi.useRealTimers() })

  it('RÉCLAME L’EXERCICE RÉVOLU alors qu’aucun mois de la nouvelle année n’est écoulé', async () => {
    // Le défaut : au 1er janvier, `moisEcoules` vaut 0 et l'écran ne regardait que l'année en cours.
    // Il n'avait donc plus rien à réclamer — ni pour 2027 (aucun mois révolu), ni pour 2026 (qu'il ne
    // regardait pas) — au moment précis où le cabinet court après les pièces qu'il clôture.
    poser({ validees: [piece({ id: 'v1', statut: 'validee', date_piece: '2026-03-10' })] })
    monter()

    expect(await screen.findByText('Relevés bancaires 2026')).toBeTruthy()
    expect(screen.getByText('Relevés bancaires 2027')).toBeTruthy()
    // Douze mois dus sur l'exercice révolu, aucune ligne bancaire posée.
    expect(screen.getByText(/Mois manquants : janvier, février, mars/)).toBeTruthy()
  })

  it('CESSE de le réclamer une fois la clôture cochée', async () => {
    poser({
      validees: [piece({ id: 'v1', statut: 'validee', date_piece: '2026-03-10' })],
      clotures: [{ annee: 2026 }],
    })
    monter()

    // Garde SYMÉTRIQUE : sans cette seconde attente, « 2026 a disparu » serait satisfait par un
    // écran qui n'affiche plus rien du tout.
    expect(await screen.findByText('Relevés bancaires 2027')).toBeTruthy()
    expect(screen.queryAllByText('Relevés bancaires 2026')).toHaveLength(0)
  })

  it('NE RÉCLAME PAS un exercice révolu qui n’a rien à envoyer', async () => {
    // Un point satisfait d'un exercice révolu n'apprend rien : sans ce filtre, un dossier à jour
    // afficherait six points pour dire qu'il ne reste rien, et une liste qui ne dit jamais rien
    // cesse d'être lue. L'exercice EN COURS, lui, garde ses points — ils disent où on en est.
    poser({ validees: [piece({ id: 'v1', statut: 'validee', date_piece: '2026-03-10' })] })
    faux.parTable.lignes_bancaires = Array.from({ length: 12 }, (_, i) => ({
      id: `l${i}`, date: `2026-${String(i + 1).padStart(2, '0')}-15`,
    }))
    faux.parTable.cotisations_declarees = [{ id: 'c1', echeance: '2026-05-05' }]
    monter()

    expect(await screen.findByText('Relevés bancaires 2027')).toBeTruthy()
    expect(screen.queryAllByText('Relevés bancaires 2026')).toHaveLength(0)
    expect(screen.queryAllByText('Appels de cotisation 2026')).toHaveLength(0)
    expect(screen.queryAllByText('Factures / pièces 2026')).toHaveLength(0)
  })

  it('UNE LISTE DE CLÔTURES ILLISIBLE RÉCLAME, ET LE DIT', async () => {
    // L'échec tombe du côté qui demande un document de trop, jamais du côté qui se tait : une
    // lecture refusée qui ferait cesser la réclamation serait indiscernable d'un dossier à jour,
    // c'est-à-dire la bonne nouvelle fabriquée que tout ce module existe pour empêcher.
    poser({
      validees: [piece({ id: 'v1', statut: 'validee', date_piece: '2026-03-10' })],
      clotureRefusee: true,
    })
    monter()

    expect(await screen.findByText('Relevés bancaires 2026')).toBeTruthy()
    // Et il ne l'avale pas : sans la phrase, ces points-là sont incompréhensibles pour un cabinet
    // qui vient justement de cocher la clôture.
    expect(screen.getByText(/Impossible de vérifier si l'exercice 2026 est clôturé/)).toBeTruthy()
  })

  it('SE TAIT sur les clôtures quand la lecture a réussi', async () => {
    // Garde symétrique de la précédente : une mise en garde permanente cesse d'être lue, puis
    // emporte ses voisines dans son discrédit.
    poser({ validees: [piece({ id: 'v1', statut: 'validee', date_piece: '2026-03-10' })] })
    monter()

    await screen.findByText('Relevés bancaires 2026')
    expect(screen.queryAllByText(/Impossible de vérifier si l'exercice/)).toHaveLength(0)
  })

  it('UNE LECTURE TRONQUÉE DES CATÉGORIES ALLUME LE BANDEAU', async () => {
    // `categoriesSansCompte` et `categoriesSansPoste` partent des CATÉGORIES, `ecrituresSansObjet`
    // des immobilisations, le contrôle de TVA des déclarations : tronquée, aucune de ces listes ne
    // raccourcit un affichage — elle fait TAIRE un point de cette liste, et se taire est exactement
    // ce que cet écran fait quand tout va bien. Le drapeau `lectureIncomplete` ne couvrait que
    // quatre des neuf lectures, dont aucune de celles-là.
    poser({
      validees: [piece({ id: 'v1', statut: 'validee', date_piece: '2026-03-10' })],
      tronquees: ['categories'],
    })
    monter()

    expect(await screen.findByText(/n'ont pas pu être lues en entier/)).toBeTruthy()
  })

  it('SE TAIT quand toutes ses lectures sont complètes', async () => {
    // Garde symétrique : sans elle, « l'écran signale une lecture partielle » serait satisfait par
    // un écran qui l'annonce TOUJOURS — et une mise en garde permanente cesse d'être lue.
    poser({ validees: [piece({ id: 'v1', statut: 'validee', date_piece: '2026-03-10' })] })
    monter()

    await screen.findByText('Relevés bancaires 2026')
    expect(screen.queryAllByText(/n'ont pas pu être lues en entier/)).toHaveLength(0)
  })
})

// LE POINT QUI MANQUAIT À CET ÉCRAN — et le pire silence possible pour lui. La Checklist comptait
// les mouvements `non_rapprochee` et rien d'autre : un mouvement que le dossier DIT rapproché et qui
// ne désigne plus rien lui était donc invisible, sur l'écran dont le métier est de dire ce qui
// manque. Les deux clés du côté banque sont en `ON DELETE SET NULL` : supprimer la pièce ou
// l'échéance de cotisation défait le lien sans un mot et laisse `statut` à `'rapprochee'`.
//
// Une cotisation n'engendre aucune écriture — la piste d'audit et les contrôles d'Écritures partent
// tous de l'écriture ou de la pièce, jamais du mouvement. Personne d'autre n'en parlerait.
describe('ChecklistTab — un mouvement rapproché qui ne désigne plus rien', () => {
  const POINT = /rapproché\(s\) sans justificatif/

  it('le compte', async () => {
    poser({ lignes: [ligne({ id: 'orphelin', piece_id: null, cotisation_id: null })] })
    monter()

    const trouve = await screen.findByText(POINT)
    expect(trouve.textContent).toMatch(/^1 /)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la Checklist compte les orphelins » serait satisfait par un
  // point qui compte TOUS les mouvements rapprochés — et un point qui crie sur un dossier en ordre
  // finit par ne plus être lu, en emportant ses voisins.
  it('se tait sur un rapprochement qui désigne bien une pièce, et sur un mouvement à traiter', async () => {
    poser({
      lignes: [
        ligne({ id: 'sur-piece', piece_id: 'p1' }),
        ligne({ id: 'sur-cotisation', piece_id: null, cotisation_id: 'c1' }),
        // Celui-ci a son propre point, « ligne(s) bancaire(s) non rapprochée(s) » : le compter ici
        // aussi ferait dire deux fois la même chose, sous deux gravités différentes.
        ligne({ id: 'a-traiter', statut: 'non_rapprochee', piece_id: null, cotisation_id: null }),
      ],
    })
    monter()

    // Ancré sur un point que ce jeu d'essai déclenche forcément : vérifier une ABSENCE sur un écran
    // encore en chargement rendrait le test vert pour une raison fausse.
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(POINT)).toHaveLength(0)
  })
})
