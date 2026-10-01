import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChecklistTab from './ChecklistTab'
import type { ModeleComptable } from '../../lib/engagement'
import type {
  ANouveau, Categorie, CotisationDeclaree, EcritureBrouillon, Immobilisation, LigneBancaire, NatureImmobilisation, Piece, ReglementGroupe,
  VentilationBancaire,
} from '../../lib/types'
import type { Emprunt } from '../../lib/emprunts'

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
    montant: -120, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
    prelevement_personnel: false, source_fichier: null, libelle_brut: null,
    created_at: '2026-03-10T00:00:00Z', ...o,
  }
}

// Typé sans `as`, comme les deux fabriques ci-dessus. Le défaut porte SON LIEN : `piece_id` nul
// n'est pas un état que la production produit, c'est celui que laisse une pièce supprimée.
function immobilisation(o: Partial<Immobilisation> = {}): Immobilisation {
  return {
    id: 'i1', dossier_id: 'dossier-de-test', piece_id: 'p1', nature_id: null,
    libelle: 'Ordinateur', valeur: 1200, date_acquisition: '2026-03-10', date_mise_en_service: null, duree_annees: 3,
    created_at: '2026-03-10T00:00:00Z', ...o,
  }
}

function poser(pieces: {
  validees?: unknown[]
  aValider?: unknown[]
  lignes?: unknown[]
  immos?: unknown[]
  clotures?: { annee: number }[]
  clotureRefusee?: boolean
  tronquees?: string[]
  ecritures?: unknown[]
  aNouveaux?: unknown[]
  refusees?: string[]
  categories?: unknown[]
  emprunts?: unknown[]
  ventilations?: unknown[]
  reglements?: unknown[]
  cotisations?: unknown[]
  natures?: unknown[]
}) {
  faux.parTable = {
    'pieces:validee': pieces.validees ?? [],
    'pieces:a_valider': pieces.aValider ?? [],
    pieces: [...(pieces.validees ?? []), ...(pieces.aValider ?? [])],
    cotisations_declarees: pieces.cotisations ?? [], lignes_bancaires: pieces.lignes ?? [], immobilisations: pieces.immos ?? [],
    natures_immobilisation: pieces.natures ?? [], categories: pieces.categories ?? [], ecritures_brouillon: pieces.ecritures ?? [],
    declarations_tva: [], documents_divers: [], informations_dossier: [],
    exercices_clotures: pieces.clotures ?? [], a_nouveaux: pieces.aNouveaux ?? [], emprunts: pieces.emprunts ?? [],
    ventilations_bancaires: pieces.ventilations ?? [], reglements_groupes: pieces.reglements ?? [],
  }
  faux.refusees = new Set([...(pieces.clotureRefusee ? ['exercices_clotures'] : []), ...(pieces.refusees ?? [])])
  faux.tronquees = new Set(pieces.tronquees ?? [])
}

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

function monter(assujettiTva = false, modele: ModeleComptable = TRESORERIE) {
  return render(<ChecklistTab dossierId="dossier-de-test" assujettiTva={assujettiTva} modele={modele} onNavigate={() => {}} />)
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
// Une échéance retirée depuis l'onglet Cotisations passe par la base, qui remet son mouvement à traiter
// (`supprimer_echeance_cotisation`, 01/10/2026) ; supprimée autrement, le lien tombe sans un mot, et ce
// point est le seul à partir du MOUVEMENT — la piste d'audit et les contrôles d'Écritures partent de
// l'écriture ou de la pièce.
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

// LA TROISIÈME CLÉ EN `ON DELETE SET NULL` DE `pieces`, vue depuis l'écran qui prétend dire ce qui
// manque. La dotation d'une immobilisation détachée part en case CH d'une 2035 signée, et la piste
// d'audit ne couvre pas les immobilisations : sans ce point, plus rien ne pourrait la nommer.
describe('ChecklistTab — une immobilisation dont le justificatif a été supprimé', () => {
  const POINT = /justificatif a été supprimé/

  it('le compte', async () => {
    poser({ immos: [immobilisation({ id: 'detachee', piece_id: null })] })
    monter()

    const trouve = await screen.findByText(POINT)
    expect(trouve.textContent).toMatch(/^1 /)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la Checklist compte les détachées » serait satisfait par un
  // point qui compte TOUTES les immobilisations du registre.
  it('se tait sur une immobilisation qui désigne bien sa pièce', async () => {
    poser({
      immos: [immobilisation({ piece_id: 'p1' })],
      lignes: [ligne({ statut: 'non_rapprochee', piece_id: null, cotisation_id: null })],
    })
    monter()

    // Ancré sur un point que ce jeu d'essai déclenche forcément : une ABSENCE vérifiée sur un écran
    // encore en chargement serait verte pour une raison fausse.
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(POINT)).toHaveLength(0)
  })
})

// LES DOTATIONS AUX AMORTISSEMENTS QUI MANQUENT AU BROUILLON (ligne 26.6, étape b). La 2035 compte la
// dotation depuis le registre, le FEC ne la porte que si elle est écrite : sans ce point, les deux livrables
// diffèrent de la case CH sans que rien le dise. `dotationsEnDefaut` est testée à part
// (amortissements.test.ts) ; ici c'est le CÂBLAGE — que l'écran passe le registre, les natures, le brouillon
// et l'ouverture, et ne réclame pas l'exercice en cours.
describe('ChecklistTab — les dotations aux amortissements', () => {
  const POINT = /dotation\(s\) aux amortissements à écrire/
  const NATURE: NatureImmobilisation = {
    id: 'n1', dossier_id: null, libelle: 'Matériel informatique', duree_annees_defaut: 3, ordre: 1, compte_immobilisation: '218300',
  }
  // Acquis le 1er juillet 2025 : 1 200 € en 2025, 2 400 € en 2026.
  const BIEN = immobilisation({ id: 'b1', nature_id: 'n1', valeur: 12000, duree_annees: 5, date_acquisition: '2025-07-01' })
  function dotation(annee: number, montant: number): EcritureBrouillon[] {
    const base = {
      dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: null, date: `${annee}-12-31`,
      libelle: `Dotation ${annee} — Ordinateur`, montant, statut: 'proposee' as const, immobilisation_id: 'b1',
      created_at: '2026-01-02T09:00:00Z',
    }
    return [
      { ...base, id: `d${annee}a`, compte: '681100', sens: 'debit' },
      { ...base, id: `d${annee}b`, compte: '281830', sens: 'credit' },
    ]
  }
  // Une ligne non rapprochée : un point que ce jeu d'essai déclenche forcément, pour qu'une ABSENCE ne soit
  // pas vérifiée sur un écran encore en chargement.
  const ANCRE = ligne({ statut: 'non_rapprochee', piece_id: null, cotisation_id: null })
  const OUVERTURE: ANouveau = {
    id: 'an1', dossier_id: 'dossier-de-test', date: '2026-01-01', compte: '512000', compte_origine: '512000',
    libelle: 'Banque', sens: 'debit', montant: 1000, source_nom: 'balance.csv', source_empreinte: 'e', created_at: '2026-01-05T09:00:00Z',
  }

  // L'HORLOGE EST FIXÉE : c'est l'exercice en cours qui décide de ce qui est réclamé. Seul `Date` est feint.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-01T10:00:00')) })
  afterEach(() => { vi.useRealTimers() })

  it('réclame la dotation d’un exercice fini qui n’est pas écrite', async () => {
    poser({ immos: [BIEN], natures: [NATURE] })
    monter()

    const trouve = await screen.findByText(POINT)
    expect(trouve.textContent).toMatch(/^1 /)
    screen.getByText('Exercice : 2025.')
  })

  it('réclame une dotation écrite qui ne suit plus le registre, même de l’exercice en cours', async () => {
    poser({ immos: [BIEN], natures: [NATURE], ecritures: [...dotation(2025, 1200), ...dotation(2026, 2000)] })
    monter()

    const trouve = await screen.findByText(POINT)
    expect(trouve.textContent).toMatch(/^1 /)
    screen.getByText('Exercice : 2026.')
  })

  // GARDE SYMÉTRIQUE : sans elle, « la Checklist réclame les dotations » serait satisfait par un point qui
  // réclamerait aussi l'exercice en cours, c'est-à-dire en permanence.
  it('ne réclame pas l’exercice en cours, ni une dotation écrite', async () => {
    poser({ immos: [BIEN], natures: [NATURE], ecritures: dotation(2025, 1200), lignes: [ANCRE] })
    monter()

    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(POINT)).toHaveLength(0)
  })

  it('ne réclame pas un exercice repris dans les à-nouveaux', async () => {
    poser({ immos: [BIEN], natures: [NATURE], aNouveaux: [OUVERTURE], lignes: [ANCRE] })
    monter()

    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(POINT)).toHaveLength(0)
  })

  it('se tait quand l’ouverture est lue à moitié, plutôt que de réclamer un exercice repris', async () => {
    poser({ immos: [BIEN], natures: [NATURE], aNouveaux: [OUVERTURE], tronquees: ['a_nouveaux'], lignes: [ANCRE] })
    monter()

    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(POINT)).toHaveLength(0)
  })
})

// L'AUTRE MOITIÉ DE « LA BANQUE FAIT FOI » (décision du cabinet, 23/09/2026), vue depuis l'écran
// qui prétend dire ce qui manque. Sous le seuil la pièce est alignée au rapprochement et il n'y a
// rien à compter ; au-dessus, un écart large est presque toujours un paiement partiel ou groupé, on
// ne touche à rien, et sans ce point plus rien ne le nommerait tant que les écritures ne sont pas
// générées.
describe('ChecklistTab — un rapprochement dont le montant ne correspond pas', () => {
  const POINT = /le montant ne correspond pas au mouvement/

  it('le compte', async () => {
    poser({
      validees: [piece({ id: 'p1', statut: 'validee', montant_ttc: 1000, date_piece: '2026-03-10' })],
      lignes: [ligne({ statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, montant: -500 })],
    })
    monter()

    const trouve = await screen.findByText(POINT)
    expect(trouve.textContent).toMatch(/^1 /)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la Checklist compte les écarts » serait satisfait par un point
  // qui compte TOUS les rapprochements — y compris les exacts et ceux que le seuil absorbe, donc un
  // écran rouge en permanence.
  it('se tait sur un rapprochement exact et sur un écart sous le seuil', async () => {
    poser({
      validees: [piece({ id: 'p1', statut: 'validee', montant_ttc: 100, date_piece: '2026-03-10' })],
      lignes: [
        ligne({ id: 'l1', statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, montant: -100 }),
        ligne({ id: 'l2', statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, montant: -100.03 }),
        ligne({ id: 'l3', statut: 'non_rapprochee', piece_id: null, cotisation_id: null }),
      ],
    })
    monter()

    // Ancré sur un point que ce jeu d'essai déclenche forcément : une ABSENCE vérifiée sur un écran
    // encore en chargement serait verte pour une raison fausse.
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(POINT)).toHaveLength(0)
  })
})

describe('ChecklistTab — la tuile de trésorerie d’un dossier ouvert par des à-nouveaux', () => {
  // Une écriture de la banque : une sortie de 300 € en février.
  const SORTIE = {
    id: 'e1', dossier_id: 'dossier-de-test', piece_id: 'p1', ligne_bancaire_id: 'l1', date: '2026-02-10',
    compte: '512000', libelle: 'Prélèvement', montant: 300, sens: 'credit', statut: 'brouillon',
    created_at: '2026-02-10T00:00:00Z',
  }
  function aNouveau(id: string, compte: string, sens: 'debit' | 'credit', montant: number) {
    return {
      id, dossier_id: 'dossier-de-test', date: '2026-01-01', compte, compte_origine: compte, libelle: compte,
      sens, montant, source_nom: 'balance-2025.csv', source_empreinte: 'a'.repeat(64),
      created_at: '2026-09-26T10:00:00Z',
    }
  }
  const OUVERTURE = [aNouveau('an1', '512000', 'debit', 8400), aNouveau('an2', '108', 'credit', 8400)]

  function tuile(): HTMLElement {
    return screen.getByText('Trésorerie (brouillon)').closest('.kpi') as HTMLElement
  }

  it('part du solde repris, et ne passe pas au rouge sur un compte qui porte de l’argent', async () => {
    poser({ ecritures: [SORTIE], aNouveaux: OUVERTURE })
    monter()

    await screen.findByText('depuis l’ouverture du 01/01/2026')
    expect(tuile().querySelector('.kpi-valeur')!.textContent).toMatch(/^8\s?100,00\s€$/)
    expect(tuile().className).toContain('kpi-ok')
  })

  // GARDE SYMÉTRIQUE : sans elle, « la tuile part de l'ouverture » serait satisfait par une tuile qui
  // en invente une. Sans à-nouveaux, elle reste le cumul du brouillon — et son rouge, qu'elle a.
  it('sans ouverture, reste le cumul du brouillon', async () => {
    poser({ ecritures: [SORTIE] })
    monter()

    await screen.findByText('1 mois d\'écritures')
    expect(tuile().querySelector('.kpi-valeur')!.textContent).toMatch(/^-300,00\s€$/)
    expect(tuile().className).toContain('kpi-danger')
  })

  // Ce test garde la TUILE masquée. L'écran refuse aussi de tirer une ouverture d'une lecture partielle
  // (`complete ?`), mais la tuile ne montre alors ni montant, ni couleur, ni tendance : cette seconde
  // ceinture n'a rien de visible à défendre aujourd'hui, et sa mutation survit à juste titre.
  it('n’affiche ni montant ni rouge quand l’ouverture n’a pas pu être lue, et le dit', async () => {
    poser({ ecritures: [SORTIE], aNouveaux: OUVERTURE, refusees: ['a_nouveaux'] })
    monter()

    await screen.findByText('ouverture illisible')
    expect(tuile().querySelector('.kpi-valeur')!.textContent).toBe('—')
    expect(tuile().className).toContain('kpi-neutral')
    expect(screen.getByText(/Les à-nouveaux du dossier n'ont pas pu être lus en entier/)).toBeTruthy()
    // Pas le bandeau des POINTS : l'ouverture n'en commande aucun, et dire que leur silence ne prouve
    // plus rien serait faux.
    expect(screen.queryAllByText(/Les données du dossier n'ont pas pu être lues/)).toHaveLength(0)
  })
})

// LE CONTRÔLE DES ÉCRITURES SUIT LE STATUT TVA DU DOSSIER (voir lib/montantRetenu.ts) : un dossier
// exonéré porte sa charge TTC sur une seule ligne. Sans le statut, la Checklist signalerait « à
// régénérer » une écriture juste, pour toujours — un point qui ne s'éteint jamais cesse d'être lu.
describe('ChecklistTab — les écritures à régénérer suivent le statut TVA', () => {
  const categorie = {
    id: 'cat-achats', dossier_id: null, code: 'achats_fournisseurs', libelle: 'Achats', ordre: 1,
    compte_comptable: '606100', poste_2035: 'Achats',
  }
  const pieceAvecTva = piece({
    statut: 'validee', date_piece: '2026-03-10', categorie_id: 'cat-achats',
    montant_ht: 100, montant_tva: 20, montant_ttc: 120,
  })
  const ecriture = (id: string, compte: string, montant: number) => ({
    id, dossier_id: 'dossier-de-test', piece_id: 'p1', ligne_bancaire_id: null, date: '2026-03-10',
    libelle: 'FOURNISSEUR', sens: 'debit', statut: 'proposee', compte, montant,
    created_at: '2026-03-10T09:00:00Z',
  })
  const LIBELLE_DESYNC = /écriture\(s\) à régénérer/

  it('sur un dossier exonéré, la charge TTC sur une seule ligne n’est pas à régénérer', async () => {
    poser({ validees: [pieceAvecTva], categories: [categorie], ecritures: [ecriture('e1', '606100', 120)] })
    monter(false)
    // L'ancre : un AUTRE point que ce jeu déclenche forcément — l'écriture n'a pas de contrepartie
    // bancaire. Vérifier une absence sur un écran encore en chargement serait vert pour rien.
    await screen.findByText(/en attente de rapprochement bancaire/)
    expect(screen.queryByText(LIBELLE_DESYNC)).toBeNull()
  })

  // LA DATE ATTENDUE EST CELLE DU PAIEMENT quand le rapprochement le connaît (lib/rattachement.ts).
  // Sans les mouvements rapprochés, la Checklist signalerait « à régénérer » toute écriture justement
  // datée à son paiement.
  it('une écriture datée à son paiement rapproché n’est pas à régénérer', async () => {
    const auPaiement = [
      { ...ecriture('e1', '606100', 120), date: '2026-04-02' },
      { ...ecriture('e2', '512000', 120), date: '2026-04-02', sens: 'credit', ligne_bancaire_id: 'l1' },
    ]
    poser({
      validees: [pieceAvecTva], categories: [categorie], ecritures: auPaiement,
      lignes: [ligne({ date: '2026-04-02', montant: -120 })],
    })
    monter(false)
    // L'ancre : ce que l'écran affiche forcément une fois chargé, quel que soit le jour — la ligne des
    // relevés bancaires de l'année en cours.
    await screen.findAllByText(/^Relevés bancaires \d{4}$/)
    expect(screen.queryByText(LIBELLE_DESYNC)).toBeNull()
  })

  it('une écriture restée à la date de facture alors que le paiement est rapproché est à régénérer', async () => {
    const aLaFacture = [
      ecriture('e1', '606100', 120),
      { ...ecriture('e2', '512000', 120), date: '2026-04-02', sens: 'credit', ligne_bancaire_id: 'l1' },
    ]
    poser({
      validees: [pieceAvecTva], categories: [categorie], ecritures: aLaFacture,
      lignes: [ligne({ date: '2026-04-02', montant: -120 })],
    })
    monter(false)
    await screen.findByText(LIBELLE_DESYNC)
  })

  it('sur un dossier exonéré, une TVA encore ventilée est à régénérer', async () => {
    poser({
      validees: [pieceAvecTva], categories: [categorie],
      ecritures: [ecriture('e1', '606100', 100), ecriture('e2', '445660', 20)],
    })
    monter(false)
    await screen.findByText(LIBELLE_DESYNC)
  })
})

// EN ENGAGEMENT (lib/engagement.ts), la Checklist lit le brouillon dans le modèle du dossier : lue en
// trésorerie, chaque facture juste paraîtrait « à régénérer ».
describe('ChecklistTab — en engagement', () => {
  const categorie = {
    id: 'cat-achats', dossier_id: null, code: 'achats_fournisseurs', libelle: 'Achats', ordre: 1,
    compte_comptable: '606100', poste_2035: 'Achats',
  }
  const facture = piece({ statut: 'validee', date_piece: '2026-03-10', categorie_id: 'cat-achats', montant_ttc: 120 })
  const ligneEcriture = (id: string, compte: string, sens: string) => ({
    id, dossier_id: 'dossier-de-test', piece_id: 'p1', ligne_bancaire_id: null, date: '2026-03-10',
    libelle: 'FOURNISSEUR', sens, statut: 'proposee', compte, montant: 120, created_at: '2026-03-10T09:00:00Z',
  })
  const ecrituresDeFacture = [ligneEcriture('e1', '606100', 'debit'), ligneEcriture('e2', '401000', 'credit')]

  it('ne dit pas « à régénérer » une facture juste, et la compte sans règlement rapproché', async () => {
    poser({ validees: [facture], categories: [categorie], ecritures: ecrituresDeFacture })
    monter(false, ENGAGEMENT)
    await screen.findByText(/facture\(s\) sans règlement rapproché/)
    expect(screen.queryByText(/écriture\(s\) à régénérer/)).toBeNull()
    expect(screen.queryByText(/en attente de rapprochement bancaire/)).toBeNull()
  })

  it('lue en trésorerie, la même facture paraîtrait périmée — le modèle doit arriver jusqu’au contrôle', async () => {
    poser({ validees: [facture], categories: [categorie], ecritures: ecrituresDeFacture })
    monter(false, TRESORERIE)
    await screen.findByText(/écriture\(s\) à régénérer/)
  })
})

// LIGNE 26.6 : un mouvement du relevé AFFECTÉ à une catégorie est rapproché sans pièce ni échéance,
// et son écriture n'a pas de pièce. Ni l'un ni l'autre n'est un défaut — le point « rapproché sans
// justificatif » et la « piste rompue » crieraient sinon sur chaque encaissement de l'Assurance
// maladie. Ce qui en est un : une écriture qui ne suit plus sa catégorie, et une recette affectée sur
// un dossier assujetti, dont la TVA collectée n'est dans aucune CA3.
describe('ChecklistTab — les mouvements affectés sans justificatif', () => {
  const RECETTES: Categorie = {
    id: 'cat-recettes', dossier_id: null, code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  }
  const cpam = (o: Partial<LigneBancaire> = {}) => ligne({ id: 'l-cpam', libelle: 'VIR CPAM', montant: 250, piece_id: null, categorie_id: 'cat-recettes', ...o })
  function ecritureDe(o: Partial<EcritureBrouillon>): EcritureBrouillon {
    return {
      id: 'e1', dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: 'l-cpam', date: '2026-03-10',
      compte: '706000', libelle: 'VIR CPAM', montant: 250, sens: 'credit', statut: 'proposee',
      immobilisation_id: null, created_at: '2026-03-10T00:00:00Z', ...o,
    }
  }
  const ECRITURE_CPAM = [ecritureDe({ id: 'e1' }), ecritureDe({ id: 'e2', compte: '512000', sens: 'debit' })]

  it('ni orphelin, ni rupture de la piste d’audit, quand son écriture suit sa catégorie', async () => {
    poser({ lignes: [cpam(), ligne({ id: 'a-traiter', statut: 'non_rapprochee', piece_id: null })], categories: [RECETTES], ecritures: ECRITURE_CPAM })
    monter()
    // Ancré sur un point que ce jeu d'essai déclenche forcément.
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/rapproché\(s\) sans justificatif/)).toHaveLength(0)
    expect(screen.queryAllByText(/piste d'audit rompue/)).toHaveLength(0)
    expect(screen.queryAllByText(/ne suit plus la catégorie/)).toHaveLength(0)
    expect(screen.queryAllByText(/sur un dossier assujetti/)).toHaveLength(0)
  })

  it('compte le mouvement dont l’écriture ne suit plus sa catégorie', async () => {
    poser({ lignes: [cpam()], categories: [{ ...RECETTES, compte_comptable: '706100' }], ecritures: ECRITURE_CPAM })
    monter()
    const point = await screen.findByText(/ne suit plus la catégorie/)
    expect(point.textContent).toMatch(/^1 /)
  })

  it('compte la recette affectée SANS TAUX d’un dossier assujetti — et se tait sur un dossier exonéré', async () => {
    poser({ lignes: [cpam()], categories: [RECETTES], ecritures: ECRITURE_CPAM })
    const { unmount } = monter(true)
    const point = await screen.findByText(/en recette sans taux de TVA, sur un dossier assujetti/)
    expect(point.textContent).toMatch(/^1 /)
    // Le point dit où les trouver : sous le filtre « Rapprochés » de Banque, qui ne s'ouvre pas dessus.
    expect(screen.getByText(/filtre « Rapprochés » : ils portent la pastille « TVA à choisir »/)).toBeTruthy()
    unmount()
    poser({ lignes: [cpam(), ligne({ id: 'a-traiter', statut: 'non_rapprochee', piece_id: null })], categories: [RECETTES], ecritures: ECRITURE_CPAM })
    monter(false)
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/sur un dossier assujetti/)).toHaveLength(0)
  })

  it('se tait sur une recette affectée AVEC son taux — et attend alors son écriture au hors taxe, TVA à côté', async () => {
    // L'écriture en place est au TTC : avec un taux, l'affectation écrirait le hors taxe et la TVA collectée,
    // donc le mouvement est « à réaffecter » — c'est l'ancre qui prouve que l'écran a fini de lire.
    poser({ lignes: [cpam({ taux_tva: 20 })], categories: [RECETTES], ecritures: ECRITURE_CPAM })
    monter(true)
    const ancre = await screen.findByText(/affecté\(s\) dont l’écriture ne suit plus la catégorie/)
    expect(ancre.textContent).toMatch(/^1 /)
    expect(screen.queryAllByText(/sans taux de TVA, sur un dossier assujetti/)).toHaveLength(0)
  })

  it('compte la catégorie sans poste 2035 d’un mouvement affecté', async () => {
    poser({ lignes: [cpam()], categories: [{ ...RECETTES, poste_2035: null }], ecritures: ECRITURE_CPAM })
    monter()
    const point = await screen.findByText(/catégorie\(s\) sans poste 2035/)
    expect(point.textContent).toMatch(/^1 /)
  })
})

// Un VIREMENT PERSONNEL s'écrit sur le compte du dirigeant depuis le 29/09/2026
// (lib/virementPersonnel.ts). Écrit, il n'est ni un point à traiter ni une rupture de la piste d'audit ;
// classé sans son écriture — tous ceux marqués avant —, il a l'air traité et manque au FEC. Le point le
// dit, et mène à l'onglet Virements, qui les montre et les écrit.
describe('ChecklistTab — les virements personnels', () => {
  const perso = () => ligne({
    id: 'l-perso', libelle: 'VIR PERSO', montant: -500, statut: 'ignoree', piece_id: null, prelevement_personnel: true,
  })
  function ecritureDe(o: Partial<EcritureBrouillon>): EcritureBrouillon {
    return {
      id: 'v1', dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: 'l-perso', date: '2026-03-10',
      compte: '108000', libelle: 'VIR PERSO', montant: 500, sens: 'debit', statut: 'proposee',
      immobilisation_id: null, created_at: '2026-03-10T00:00:00Z', ...o,
    }
  }
  const ecrit = (compte = '108000') => [ecritureDe({ id: 'v1', compte }), ecritureDe({ id: 'v2', compte: '512000', sens: 'credit' })]

  it('compte le virement classé sans son écriture, et mène à l’onglet Virements', async () => {
    const onNavigate = vi.fn()
    poser({ lignes: [perso()] })
    render(<ChecklistTab dossierId="dossier-de-test" assujettiTva={false} modele={TRESORERIE} onNavigate={onNavigate} />)

    const point = await screen.findByText(/virement\(s\) personnel\(s\) sans écriture/)
    expect(point.textContent).toMatch(/^1 /)
    screen.getByRole('button', { name: 'Écrire ces virements' }).click()
    expect(onNavigate).toHaveBeenCalledWith('virements')
  })

  it('écrit, il n’est ni un point à traiter ni une rupture de la piste d’audit', async () => {
    // Garde SYMÉTRIQUE : sans lui, « le point compte les virements sans écriture » serait satisfait par
    // un point qui compte TOUS les virements personnels.
    poser({ lignes: [perso(), ligne({ id: 'a-traiter', statut: 'non_rapprochee', piece_id: null })], ecritures: ecrit() })
    monter()

    // Ancré sur un point que ce jeu d'essai déclenche forcément.
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/personnel\(s\) sans écriture/)).toHaveLength(0)
    expect(screen.queryAllByText(/piste d'audit rompue/)).toHaveLength(0)
  })

  it('en engagement, l’écriture attendue est sur le compte choisi pour le dirigeant', async () => {
    poser({ lignes: [perso()], ecritures: ecrit('108000') })
    monter(false, ENGAGEMENT)

    const point = await screen.findByText(/personnel\(s\) sans écriture/)
    expect(point.textContent).toMatch(/^1 /)
  })
})

// LES ÉCHÉANCES DE COTISATION PAYÉES (lib/cotisationRapprochee.ts). Ce que le module ne peut pas voir : que
// l'écran LISE les échéances avec le relevé et le brouillon, passe le MODE au contrôle, et mène chaque
// point à l'onglet qui sait le traiter.
describe('ChecklistTab — les échéances de cotisation payées', () => {
  const echeance = (o: Partial<CotisationDeclaree> = {}): CotisationDeclaree => ({
    id: 'cot-1', dossier_id: 'dossier-de-test', echeance: '2026-03-05', montant_appele: 100, montant_verse: null,
    montant_csg_crds: 9.7, previsionnel: false, created_at: '2026-01-10T09:00:00Z', ...o,
  })
  const prelevement = (o: Partial<LigneBancaire> = {}) => ligne({
    id: 'l-urssaf', libelle: 'PRLV URSSAF', montant: -100, statut: 'rapprochee', piece_id: null, cotisation_id: 'cot-1', ...o,
  })
  function ecritureDe(o: Partial<EcritureBrouillon>): EcritureBrouillon {
    return {
      id: 'u1', dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: 'l-urssaf', date: '2026-03-10',
      compte: '646000', libelle: 'PRLV URSSAF', montant: 90.3, sens: 'debit', statut: 'proposee',
      immobilisation_id: null, created_at: '2026-03-10T00:00:00Z', ...o,
    }
  }
  const ecrite = [
    ecritureDe({ id: 'u1' }),
    ecritureDe({ id: 'u2', compte: '108000', montant: 9.7 }),
    ecritureDe({ id: 'u3', compte: '512000', sens: 'credit', montant: 100 }),
  ]

  it('compte l’échéance rapprochée sans son écriture, et mène à l’onglet Cotisations', async () => {
    const onNavigate = vi.fn()
    poser({ lignes: [prelevement()], cotisations: [echeance()] })
    render(<ChecklistTab dossierId="dossier-de-test" assujettiTva={false} modele={TRESORERIE} onNavigate={onNavigate} />)

    const point = await screen.findByText(/échéance\(s\) de cotisation payée\(s\) dont l’écriture manque/)
    expect(point.textContent).toMatch(/^1 /)
    screen.getByRole('button', { name: 'Écrire ces échéances' }).click()
    expect(onNavigate).toHaveBeenCalledWith('cotisations')
  })

  it('écrite, elle n’est ni un point, ni un rapprochement sans justificatif, ni une rupture', async () => {
    // Garde SYMÉTRIQUE : sans lui, « le point compte les échéances sans écriture » serait satisfait par un
    // point qui compte toutes les échéances payées.
    poser({
      lignes: [prelevement(), ligne({ id: 'a-traiter', statut: 'non_rapprochee', piece_id: null })],
      cotisations: [echeance()], ecritures: ecrite,
    })
    monter()

    // Ancré sur un point que ce jeu d'essai déclenche forcément.
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/de cotisation payée\(s\)/)).toHaveLength(0)
    expect(screen.queryAllByText(/rapproché\(s\) sans justificatif/)).toHaveLength(0)
    expect(screen.queryAllByText(/piste d'audit rompue/)).toHaveLength(0)
  })

  it('le mode arrive jusqu’au contrôle : en engagement, la CSG-CRDS reste au 646000', async () => {
    // La même écriture — tout au 646000 — est périmée en trésorerie, où la CSG-CRDS passe au 108000, et
    // juste en engagement.
    const toutAu646 = [ecritureDe({ id: 'u1', montant: 100 }), ecritureDe({ id: 'u3', compte: '512000', sens: 'credit', montant: 100 })]
    poser({
      lignes: [prelevement(), ligne({ id: 'a-traiter', statut: 'non_rapprochee', piece_id: null })],
      cotisations: [echeance()], ecritures: toutAu646,
    })
    monter(false, ENGAGEMENT)
    // Ancré sur un point que ce jeu d'essai déclenche forcément.
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/de cotisation payée\(s\)/)).toHaveLength(0)
  })

  it('le même jeu en trésorerie est compté', async () => {
    const toutAu646 = [ecritureDe({ id: 'u1', montant: 100 }), ecritureDe({ id: 'u3', compte: '512000', sens: 'credit', montant: 100 })]
    poser({ lignes: [prelevement()], cotisations: [echeance()], ecritures: toutAu646 })
    monter()
    const point = await screen.findByText(/de cotisation payée\(s\) dont l’écriture manque/)
    expect(point.textContent).toMatch(/^1 /)
  })

  it('compte le rapprochement qui ne peut pas s’écrire, et mène à Banque', async () => {
    const onNavigate = vi.fn()
    poser({ lignes: [prelevement({ montant: 100 })], cotisations: [echeance()] })
    render(<ChecklistTab dossierId="dossier-de-test" assujettiTva={false} modele={TRESORERIE} onNavigate={onNavigate} />)

    const point = await screen.findByText(/rapprochement\(s\) d’une échéance de cotisation qui ne peuvent pas s’écrire/)
    expect(point.textContent).toMatch(/^1 /)
    // Il n'est pas « à écrire » : « Écrire » échouerait.
    expect(screen.queryAllByText(/de cotisation payée\(s\)/)).toHaveLength(0)
    // Et il dit où le trouver : Banque s'ouvre sur les non rapprochés, où il n'est pas.
    expect(screen.getByText('Dans Banque, filtre « Rapprochés » : ils portent la pastille « Ne s’écrit pas ».')).toBeTruthy()
    screen.getByRole('button', { name: 'Annuler ces rapprochements' }).click()
    expect(onNavigate).toHaveBeenCalledWith('banque')
  })

  it('le mode arrive jusqu’aux refus : une CSG-CRDS au-delà du mouvement ne gêne qu’en trésorerie', async () => {
    poser({ lignes: [prelevement()], cotisations: [echeance({ montant_csg_crds: 150 })] })
    monter()
    const refuse = await screen.findByText(/rapprochement\(s\) d’une échéance de cotisation qui ne peuvent pas s’écrire/)
    expect(refuse.textContent).toMatch(/^1 /)
    cleanup()

    // En engagement elle reste au 646000 : rien n'empêche l'écriture, qui est seulement à écrire.
    poser({ lignes: [prelevement()], cotisations: [echeance({ montant_csg_crds: 150 })] })
    monter(false, ENGAGEMENT)
    await screen.findByText(/de cotisation payée\(s\) dont l’écriture manque/)
    expect(screen.queryAllByText(/qui ne peuvent pas s’écrire/)).toHaveLength(0)
  })
})

// LES ÉCHÉANCES D'EMPRUNT (lib/echeanceEmprunt.ts). Ce que le module ne peut pas voir : que l'écran LISE
// les emprunts, borne la réclamation à ce que le relevé couvre, et compte une échéance rapprochée comme un
// mouvement justifié — ni « rapproché sans justificatif », ni rupture de la piste d'audit.
describe('ChecklistTab — les échéances d’emprunt', () => {
  // Échéances le 5 de chaque mois à partir du 5 février 2025.
  const EMPRUNT: Emprunt = {
    id: 'emp-1', dossier_id: 'dossier-de-test', nom: 'Prêt matériel', organisme_preteur: null,
    capital_initial: 12000, taux_annuel: 3.6, date_debut: '2025-01-05', duree_mois: 24, created_at: '2025-01-05T10:00:00Z',
  }
  const echeance2 = (o: Partial<LigneBancaire> = {}) => ligne({
    id: 'l-ech-2', date: '2025-03-06', libelle: 'PRLV ECHEANCE PRET', montant: -540, statut: 'rapprochee', piece_id: null,
    emprunt_id: 'emp-1', emprunt_echeance: 2, emprunt_interets: 34.55, emprunt_assurance: 21.03, ...o,
  })
  // Le relevé couvre du 1er février au 30 avril 2025 : moins la marge laissée au prélèvement, jusqu'au 20.
  const bornes = (fin = '2025-04-30') => [
    ligne({ id: 'debut', date: '2025-02-01', statut: 'non_rapprochee', piece_id: null }),
    ligne({ id: 'fin', date: fin, statut: 'non_rapprochee', piece_id: null }),
  ]
  function ecritureDe(o: Partial<EcritureBrouillon>): EcritureBrouillon {
    return {
      id: 'e', dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: 'l-ech-2', date: '2025-03-06',
      compte: '512000', libelle: 'PRLV ECHEANCE PRET', montant: 540, sens: 'credit', statut: 'proposee',
      immobilisation_id: null, created_at: '2025-03-06T09:00:00Z', ...o,
    }
  }
  const ecritureDeLEcheance2 = [
    ecritureDe({ id: 'e1', compte: '164000', sens: 'debit', montant: 484.42 }),
    ecritureDe({ id: 'e2', compte: '661100', sens: 'debit', montant: 34.55 }),
    ecritureDe({ id: 'e3', compte: '616800', sens: 'debit', montant: 21.03 }),
    ecritureDe({ id: 'e4' }),
  ]

  it('compte les échéances que le relevé couvre sans qu’aucun mouvement ne les paie, et mène à Banque', async () => {
    const onNavigate = vi.fn()
    // Échéances 1 (5 février), 2 (5 mars, payée) et 3 (5 avril) dans la fenêtre : deux manquent.
    poser({ lignes: [...bornes(), echeance2()], emprunts: [EMPRUNT], ecritures: ecritureDeLEcheance2 })
    render(<ChecklistTab dossierId="dossier-de-test" assujettiTva={false} modele={TRESORERIE} onNavigate={onNavigate} />)
    const point = await screen.findByText(/échéance\(s\) d’emprunt couverte\(s\) par le relevé sans mouvement rapproché/)
    expect(point.textContent).toMatch(/^2 /)
    screen.getByRole('button', { name: 'Rapprocher ces prélèvements' }).click()
    expect(onNavigate).toHaveBeenCalledWith('banque')
  })

  it('ne réclame pas l’échéance que le relevé ne couvre pas encore — le garde symétrique', async () => {
    // Le relevé s'arrête le 12 avril : moins la marge, il couvre jusqu'au 2 avril, et l'échéance du 5
    // avril n'est pas réclamée. Seule reste la première.
    poser({ lignes: [...bornes('2025-04-12'), echeance2()], emprunts: [EMPRUNT], ecritures: ecritureDeLEcheance2 })
    monter()
    const point = await screen.findByText(/couverte\(s\) par le relevé sans mouvement rapproché/)
    expect(point.textContent).toMatch(/^1 /)
  })

  // L'autre borne de la fenêtre : avant le premier mouvement importé, rien n'a été importé, donc rien ne
  // se réclame. Le relevé couvre ici d'avril à juin 2025 : les échéances de février et de mars tombent
  // avant lui, celles d'avril, mai et juin dedans — et aucune n'est payée.
  it('ne réclame pas les échéances d’avant le premier relevé importé', async () => {
    poser({
      lignes: [
        ligne({ id: 'debut', date: '2025-04-01', statut: 'non_rapprochee', piece_id: null }),
        ligne({ id: 'fin', date: '2025-06-30', statut: 'non_rapprochee', piece_id: null }),
      ],
      emprunts: [EMPRUNT], ecritures: [],
    })
    monter()
    const point = await screen.findByText(/couverte\(s\) par le relevé sans mouvement rapproché/)
    expect(point.textContent).toMatch(/^3 /)
  })

  it('une échéance rapprochée et écrite n’est ni un point, ni un rapprochement sans justificatif, ni une rupture', async () => {
    poser({ lignes: [ligne({ id: 'a-traiter', date: '2025-03-01', statut: 'non_rapprochee', piece_id: null }), echeance2()], emprunts: [EMPRUNT], ecritures: ecritureDeLEcheance2 })
    monter()
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/d’emprunt dont l’écriture ne suit plus/)).toHaveLength(0)
    expect(screen.queryAllByText(/rapproché\(s\) sans justificatif/)).toHaveLength(0)
    expect(screen.queryAllByText(/piste d'audit rompue/)).toHaveLength(0)
  })

  it('compte l’échéance dont l’écriture ne suit plus le découpage', async () => {
    poser({ lignes: [echeance2()], emprunts: [EMPRUNT], ecritures: ecritureDeLEcheance2.map((e) => e.compte === '661100' ? { ...e, montant: 30 } : e) })
    monter()
    const point = await screen.findByText(/échéance\(s\) d’emprunt dont l’écriture ne suit plus le découpage/)
    expect(point.textContent).toMatch(/^1 /)
  })

  it('une lecture partielle des emprunts allume le bandeau : le silence du point ne prouve plus rien', async () => {
    poser({ lignes: [...bornes(), echeance2()], emprunts: [EMPRUNT], ecritures: ecritureDeLEcheance2, tronquees: ['emprunts'] })
    monter()
    expect(await screen.findByText(/n'ont pas pu être lu/)).toBeTruthy()
  })
})

// UN MOUVEMENT VENTILÉ SUR PLUSIEURS COMPTES (lib/ventilationBanque.ts). Écrit selon ses parts, il n'est ni
// un « rapproché sans justificatif » ni une rupture de la piste d'audit. Ce qui en est un point : une
// écriture qui ne suit plus ses parts (le compte d'une catégorie a changé depuis), des parts qui ne font
// plus le mouvement, et une part de recettes sur un dossier assujetti — dont la TVA n'est dans aucune CA3.
// Ce que le module ne peut pas voir : que l'écran LISE les parts, et se taise sur une lecture partielle.
describe('ChecklistTab — les mouvements ventilés sur plusieurs comptes', () => {
  const TELEPHONE: Categorie = {
    id: 'cat-tel', dossier_id: null, code: 'telephone', libelle: 'Téléphone', ordre: 40,
    compte_comptable: '626000', poste_2035: 'Frais postaux et de télécommunications',
  }
  const RECETTES: Categorie = {
    id: 'cat-recettes', dossier_id: null, code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  }
  const ventile = (o: Partial<LigneBancaire> = {}) => ligne({
    id: 'l-v', libelle: 'PRLV OPERATEUR', montant: -120, piece_id: null, ventilee: true, id_externe: null, ...o,
  })
  function part(id: string, categorieId: string | null, montant: number): VentilationBancaire {
    return {
      id, dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-v', categorie_id: categorieId,
      part_personnelle: categorieId === null, montant, taux_tva: null, created_at: '2026-03-10T00:00:00Z',
    }
  }
  const PARTS = [part('v1', 'cat-tel', -84), part('v2', null, -36)]
  function ecritureDe(o: Partial<EcritureBrouillon>): EcritureBrouillon {
    return {
      id: 'e1', dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: 'l-v', date: '2026-03-10',
      compte: '626000', libelle: 'PRLV OPERATEUR', montant: 84, sens: 'debit', statut: 'proposee',
      immobilisation_id: null, created_at: '2026-03-10T00:00:00Z', ...o,
    }
  }
  const ECRITURE = [
    ecritureDe({ id: 'e1' }),
    ecritureDe({ id: 'e2', compte: '108000', montant: 36 }),
    ecritureDe({ id: 'e3', compte: '512000', montant: 120, sens: 'credit' }),
  ]
  const aTraiter = () => ligne({ id: 'a-traiter', statut: 'non_rapprochee', piece_id: null })

  it('écrit selon ses parts, il n’est ni un point, ni un rapprochement sans justificatif, ni une rupture', async () => {
    poser({ lignes: [ventile(), aTraiter()], categories: [TELEPHONE], ecritures: ECRITURE, ventilations: PARTS })
    monter()
    // Ancré sur un point que ce jeu d'essai déclenche forcément.
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/rapproché\(s\) sans justificatif/)).toHaveLength(0)
    expect(screen.queryAllByText(/piste d'audit rompue/)).toHaveLength(0)
    expect(screen.queryAllByText(/ventilé\(s\)/)).toHaveLength(0)
  })

  it('compte le mouvement dont l’écriture ne suit plus les parts, et mène à Écritures', async () => {
    const onNavigate = vi.fn()
    poser({ lignes: [ventile()], categories: [{ ...TELEPHONE, compte_comptable: '626100' }], ecritures: ECRITURE, ventilations: PARTS })
    render(<ChecklistTab dossierId="dossier-de-test" assujettiTva={false} modele={TRESORERIE} onNavigate={onNavigate} />)
    const point = await screen.findByText(/ventilé\(s\) dont l’écriture ne suit plus les parts/)
    expect(point.textContent).toMatch(/^1 /)
    screen.getByRole('button', { name: 'Réécrire ces ventilations' }).click()
    expect(onNavigate).toHaveBeenCalledWith('ecritures')
  })

  it('compte le mouvement dont les parts ne font plus le mouvement, et mène à Banque', async () => {
    const onNavigate = vi.fn()
    poser({ lignes: [ventile()], categories: [TELEPHONE], ecritures: ECRITURE, ventilations: [part('v1', 'cat-tel', -84), part('v2', null, -30)] })
    render(<ChecklistTab dossierId="dossier-de-test" assujettiTva={false} modele={TRESORERIE} onNavigate={onNavigate} />)
    const point = await screen.findByText(/ventilé\(s\) dont les parts ne font plus le mouvement/)
    expect(point.textContent).toMatch(/^1 /)
    screen.getByRole('button', { name: 'Modifier ou annuler ces ventilations' }).click()
    expect(onNavigate).toHaveBeenCalledWith('banque')
    // Une ventilation incohérente ne se compte pas en plus comme une écriture à réécrire : on ne sait pas
    // ce qu'elle devrait porter.
    expect(screen.queryAllByText(/ne suit plus les parts/)).toHaveLength(0)
  })

  it('se tait sur des parts lues en partie, et le bandeau dit pourquoi', async () => {
    poser({ lignes: [ventile(), aTraiter()], categories: [TELEPHONE], ecritures: ECRITURE, ventilations: [PARTS[0]], tronquees: ['ventilations_bancaires'] })
    monter()
    await screen.findByText(/Les données du dossier/)
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/ne font plus le mouvement/)).toHaveLength(0)
    expect(screen.queryAllByText(/ne suit plus les parts/)).toHaveLength(0)
  })

  it('compte la part de recettes SANS TAUX d’un dossier assujetti — et se tait sur un dossier exonéré', async () => {
    const encaissement = ventile({ libelle: 'REMISE CB', montant: 4950 })
    const parts = [part('v1', 'cat-recettes', 5000), part('v2', 'cat-tel', -50)]
    poser({ lignes: [encaissement], categories: [RECETTES, TELEPHONE], ventilations: parts })
    const { unmount } = monter(true)
    const point = await screen.findByText(/en recette sans taux de TVA, sur un dossier assujetti/)
    expect(point.textContent).toMatch(/^1 /)
    unmount()
    // Le garde symétrique : la part de recette porte son taux. Sans écriture posée, le mouvement est « à
    // réécrire » — l'ancre qui prouve que l'écran a fini de lire.
    poser({ lignes: [encaissement], categories: [RECETTES, TELEPHONE], ventilations: [{ ...parts[0], taux_tva: 20 }, parts[1]] })
    const second = monter(true)
    await screen.findByText(/ventilé\(s\) dont l’écriture ne suit plus les parts/)
    expect(screen.queryAllByText(/sans taux de TVA, sur un dossier assujetti/)).toHaveLength(0)
    second.unmount()
    poser({ lignes: [encaissement, aTraiter()], categories: [RECETTES, TELEPHONE], ventilations: parts })
    monter(false)
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/sur un dossier assujetti/)).toHaveLength(0)
  })

  it('sur un dossier assujetti, la part de recette écrite avec sa TVA suit ses parts', async () => {
    // L'écriture que la base a vérifiée : la recette au hors taxe, la TVA collectée à côté. Comparée à une
    // écriture attendue sans TVA — le statut du dossier oublié —, elle serait « à réécrire » à tort.
    const encaissement = ventile({ libelle: 'REMISE CB', montant: 4950 })
    const parts = [{ ...part('v1', 'cat-recettes', 5000), taux_tva: 20 }, part('v2', 'cat-tel', -50)]
    const ecritures = [
      ecritureDe({ id: 'e1', compte: '706000', libelle: 'REMISE CB', montant: 4166.67, sens: 'credit' }),
      ecritureDe({ id: 'e2', compte: '445710', libelle: 'REMISE CB', montant: 833.33, sens: 'credit' }),
      ecritureDe({ id: 'e3', compte: '626000', libelle: 'REMISE CB', montant: 50 }),
      ecritureDe({ id: 'e4', compte: '512000', libelle: 'REMISE CB', montant: 4950 }),
    ]
    poser({ lignes: [encaissement, aTraiter()], categories: [RECETTES, TELEPHONE], ecritures, ventilations: parts })
    monter(true)
    // Ancré sur un point que ce jeu d'essai déclenche forcément.
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/ne suit plus les parts/)).toHaveLength(0)
    expect(screen.queryAllByText(/sur un dossier assujetti/)).toHaveLength(0)
  })

  it('compte la catégorie sans poste 2035 qu’une part désigne', async () => {
    poser({ lignes: [ventile()], categories: [{ ...TELEPHONE, poste_2035: null }], ecritures: ECRITURE, ventilations: PARTS })
    monter()
    const point = await screen.findByText(/catégorie\(s\) sans poste 2035/)
    expect(point.textContent).toMatch(/^1 /)
  })
})

// UN VIREMENT QUI RÈGLE PLUSIEURS PIÈCES (ligne 26). Ses parts sont des paiements de leurs pièces : le contrôle
// des écritures les attend comme des rapprochements simples, et deux points de cette liste en dépendent — une
// part qui ne justifie plus rien, une pièce payée plus que son montant.
describe('ChecklistTab — les virements qui règlent plusieurs pièces', () => {
  const ACHATS: Categorie = {
    id: 'cat-achats', dossier_id: null, code: 'achats', libelle: 'Achats', ordre: 20,
    compte_comptable: '606100', poste_2035: 'Achats',
  }
  const A = piece({ id: 'pa', statut: 'validee', tiers: 'ALPHA', montant_ttc: 300, date_piece: '2026-02-20', categorie_id: 'cat-achats' })
  const B = piece({ id: 'pb', statut: 'validee', tiers: 'BETA', montant_ttc: 200, date_piece: '2026-02-25', categorie_id: 'cat-achats' })
  const groupe = (o: Partial<LigneBancaire> = {}) => ligne({
    id: 'l-g', libelle: 'VIR FOURNISSEURS', montant: -500, piece_id: null, reglement_groupe: true, ...o,
  })
  const part = (id: string, pieceId: string | null, montant: number, ligneId = 'l-g'): ReglementGroupe => ({
    id, dossier_id: 'dossier-de-test', ligne_bancaire_id: ligneId, piece_id: pieceId, montant, created_at: '2026-03-10T00:00:00Z',
  })
  const PARTS = [part('g1', 'pa', -300), part('g2', 'pb', -200)]
  function ecritureDe(o: Partial<EcritureBrouillon>): EcritureBrouillon {
    return {
      id: 'e1', dossier_id: 'dossier-de-test', piece_id: 'pa', ligne_bancaire_id: null, date: '2026-03-10',
      compte: '606100', libelle: 'ALPHA', montant: 300, sens: 'debit', statut: 'proposee',
      immobilisation_id: null, created_at: '2026-03-10T00:00:00Z', ...o,
    }
  }
  // Chaque pièce, réglée entière par sa part, porte sa charge à la date du virement et une contrepartie de
  // banque au montant de sa part.
  const ECRITURES = [
    ecritureDe({ id: 'ea', piece_id: 'pa' }),
    ecritureDe({ id: 'ea-b', piece_id: 'pa', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l-g' }),
    ecritureDe({ id: 'eb', piece_id: 'pb', libelle: 'BETA', montant: 200 }),
    ecritureDe({ id: 'eb-b', piece_id: 'pb', libelle: 'BETA', montant: 200, compte: '512000', sens: 'credit', ligne_bancaire_id: 'l-g' }),
  ]
  const aTraiter = () => ligne({ id: 'a-traiter', statut: 'non_rapprochee', piece_id: null })

  it('réglé et écrit, il n’est ni un point, ni un rapprochement sans justificatif, ni une écriture à régénérer', async () => {
    poser({ validees: [A, B], lignes: [groupe(), aTraiter()], categories: [ACHATS], ecritures: ECRITURES, reglements: PARTS })
    monter()
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/à régénérer/)).toHaveLength(0)
    expect(screen.queryAllByText(/rapproché\(s\) sans justificatif/)).toHaveLength(0)
    expect(screen.queryAllByText(/piste d'audit rompue/)).toHaveLength(0)
    expect(screen.queryAllByText(/virement\(s\) groupé\(s\)/)).toHaveLength(0)
    expect(screen.queryAllByText(/payée\(s\) plus que leur montant/)).toHaveLength(0)
    // Réglées par leur part : leur montant n'est pas « introuvable » dans le relevé, ni la pièce sans paiement.
    expect(screen.queryAllByText(/ne correspond à aucun mouvement bancaire/)).toHaveLength(0)
  })

  it('compte le virement dont une part ne justifie plus rien, et mène à Banque', async () => {
    const onNavigate = vi.fn()
    poser({ validees: [A], lignes: [groupe()], categories: [ACHATS], reglements: [part('g1', 'pa', -300), part('g2', null, -200)] })
    render(<ChecklistTab dossierId="dossier-de-test" assujettiTva={false} modele={TRESORERIE} onNavigate={onNavigate} />)
    const point = await screen.findByText(/virement\(s\) groupé\(s\) dont une part ne justifie plus rien/)
    expect(point.textContent).toMatch(/^1 /)
    screen.getByRole('button', { name: 'Régler de nouveau ou annuler ces virements' }).click()
    expect(onNavigate).toHaveBeenCalledWith('banque')
  })

  // Une pièce supprimée ET une part dont le montant ne tombe plus juste : deux raisons, un seul virement à
  // reprendre. Compté par raison, le point annoncerait deux virements là où il n'y en a qu'un.
  it('compte par MOUVEMENT, pas par raison', async () => {
    poser({ validees: [A], lignes: [groupe()], categories: [ACHATS], reglements: [part('g1', 'pa', -300), part('g2', null, -150)] })
    monter()
    const point = await screen.findByText(/virement\(s\) groupé\(s\) dont une part ne justifie plus rien/)
    expect(point.textContent).toMatch(/^1 /)
  })

  it('se tait sur des parts lues en partie, et le bandeau dit pourquoi', async () => {
    poser({
      validees: [A], lignes: [groupe(), aTraiter()], categories: [ACHATS], reglements: [part('g1', 'pa', -300)],
      tronquees: ['reglements_groupes'],
    })
    monter()
    await screen.findByText(/Les données du dossier/)
    await screen.findByText(/non rapprochée\(s\)/)
    expect(screen.queryAllByText(/virement\(s\) groupé\(s\)/)).toHaveLength(0)
  })

  it('compte la pièce payée deux fois — un rapprochement et la part d’un virement groupé', async () => {
    poser({
      validees: [A, B],
      lignes: [groupe(), ligne({ id: 'l-a', libelle: 'PRLV ALPHA', montant: -300, piece_id: 'pa' })],
      categories: [ACHATS], reglements: PARTS,
    })
    monter()
    const point = await screen.findByText(/payée\(s\) plus que leur montant/)
    expect(point.textContent).toMatch(/^1 /)
  })
})
