import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { LigneBancaire, Piece } from '../../lib/types'

// « Tout rapprocher automatiquement » n'avait AUCUN verrou en `useRef`, contrairement à son voisin
// `validerEtRapprocherLot` juste au-dessus dans le fichier : il ne se désactivait que via
// `rapprochementAuto`, un ÉTAT React qui ne prend effet qu'au rendu suivant. Un double clic partait
// donc deux fois dans le même lot — même défaut que VehiculesCard, ImportDossierModal et « C'est une
// facture » (DocumentsTab), retrouvé ici en écrivant le test plutôt qu'en relisant le code.
const faux = vi.hoisted(() => ({
  lignes: [] as LigneBancaire[],
  pieces: [] as unknown[],
  updatesLignes: [] as Record<string, unknown>[],
  // La promesse de la première mise à jour de ligne bancaire est gardée en attente : c'est la
  // fenêtre réelle pendant laquelle un second clic arrive. La résoudre tout de suite supprimerait
  // la fenêtre même que le verrou est censé fermer.
  resoudreUpdateLigne: null as null | (() => void),
  // La lecture des relevés déjà classés dans Documents, refusée à la demande.
  erreurReleves: null as string | null,
  // Mises à jour de ligne appliquées tout de suite, pour les tests qui ne regardent pas la fenêtre
  // d'attente — ou refusées, pour ceux qui regardent ce que l'écran fait d'un échec.
  majImmediate: false,
  erreurMajLigne: null as string | null,
  // La RELECTURE du relevé retenue à la demande : c'est la fenêtre pendant laquelle le panneau montre
  // encore l'état d'avant, et que le verrou doit couvrir.
  retenirLectureLignes: false,
  resoudreLectureLignes: null as null | (() => void),
  updatesPieces: [] as Record<string, unknown>[],
  insertions: [] as { table: string; valeur: Record<string, unknown> }[],
  // Le serveur qui cesse de rendre au-delà de N lignes d'une table tout en annonçant le vrai total :
  // la panne qui produit une lecture INCOMPLÈTE (voir lib/lectureComplete.ts). Par table, parce que
  // chaque lot ne regarde pas les mêmes lectures.
  muet: {} as Record<string, number>,
  // Ce que « lit » le faux pdf.js : des lignes de texte avec l'abscisse de leur montant.
  lignesPdf: [] as { texte: string; xFin: number }[],
}))

// BanqueTab importe aussi lib/pdfText (import de relevé PDF), qui charge pdf.js — celui-ci touche au
// DOM dès l'import (voir CLAUDE.md, « Même règle pour les dépendances navigateur ») et lève sous
// jsdom faute de `DOMMatrix`. Aucune fonctionnalité PDF n'est exercée par ce test : le module est
// donc remplacé, exactement comme `lib/supabase` l'est ci-dessous pour ce qui parle à la base.
vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => faux.lignesPdf }))

vi.mock('../../lib/supabase', () => {
  function chaine(table: string) {
    let operation = 'select'
    let idFiltre: unknown = null
    let valeurMaj: Record<string, unknown> = {}
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select: () => c,
      eq: (colonne: string, valeur: unknown) => {
        if (colonne === 'id') idFiltre = valeur
        return c
      },
      order: () => c,
      in: () => c,
      update: (valeur: Record<string, unknown>) => {
        operation = 'update'
        valeurMaj = valeur
        if (table === 'lignes_bancaires') faux.updatesLignes.push(valeur)
        if (table === 'pieces') faux.updatesPieces.push(valeur)
        return c
      },
      insert: (valeur: Record<string, unknown>) => {
        operation = 'insert'
        faux.insertions.push({ table, valeur })
        return c
      },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      then: (suite: (r: unknown) => unknown) => {
        const muet = faux.muet[table]
        if (operation === 'select' && muet != null) {
          const toutes = table === 'lignes_bancaires' ? faux.lignes : table === 'pieces' ? faux.pieces : []
          const rendu = toutes.slice(debut, Math.min(fin + 1, muet))
          return Promise.resolve({ data: rendu, error: null, count: toutes.length }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'update' && faux.erreurMajLigne) {
          return Promise.resolve({ data: null, error: { message: faux.erreurMajLigne } }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'update' && faux.majImmediate) {
          faux.lignes = faux.lignes.map((l) => (l.id === idFiltre ? { ...l, ...valeurMaj } as LigneBancaire : l))
          return Promise.resolve({ data: null, error: null }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'update') {
          // La mise à jour reste en attente jusqu'à `resoudreUpdateLigne` : c'est la fenêtre
          // réseau réelle pendant laquelle un second clic arriverait. Une fois « résolue », elle
          // applique réellement la valeur — sinon le rechargement suivant verrait une ligne encore
          // "non_rapprochee" et le bouton réapparaîtrait à tort.
          return new Promise((resoudre) => {
            faux.resoudreUpdateLigne = () => {
              // `as` ici seulement : on simule le serveur qui applique un `update` partiel. La FABRIQUE,
              // elle, reste typée sans `as` — c'est là que le compilateur doit mordre.
              faux.lignes = faux.lignes.map((l) => (l.id === idFiltre ? { ...l, ...valeurMaj } as LigneBancaire : l))
              resoudre({ data: null, error: null })
            }
          }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'select' && faux.retenirLectureLignes) {
          faux.retenirLectureLignes = false
          return new Promise((resoudre) => {
            faux.resoudreLectureLignes = () => resoudre({ data: faux.lignes, error: null, count: faux.lignes.length })
          }).then(suite)
        }
        if (table === 'lignes_bancaires') {
          return Promise.resolve({ data: faux.lignes, error: null, count: faux.lignes.length }).then(suite)
        }
        if (table === 'documents_divers' && faux.erreurReleves) {
          return Promise.resolve({ data: null, error: { message: faux.erreurReleves }, count: null }).then(suite)
        }
        if (table === 'pieces') {
          // Le `count` est OBLIGATOIRE ici : sans total annoncé, `lireTout` déclare la lecture
          // INCOMPLÈTE (voir lib/lectureComplete.ts) et l'écran bascule sur son bandeau de lecture
          // partielle. Les tests d'avant passaient dans cet état dégradé — donc pour une raison qui
          // n'était pas celle qu'ils annonçaient. C'est le coût récurrent de `lireTout`, et il se
          // paie une fois par faux client.
          return Promise.resolve({ data: faux.pieces, error: null, count: faux.pieces.length }).then(suite)
        }
        // cotisations_declarees, regles_bancaires_ignorees, controles_releves_bancaires,
        // ecritures_brouillon (lu avant contrepartie — vide fait renoncer à l'insertion, ce qui
        // évite d'avoir à modéliser aussi cette écriture ici) : rien de tout ça n'intervient dans
        // ce que ce test vérifie.
        return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
      },
    })
    return c
  }
  return { supabase: { from: (table: string) => chaine(table) } }
})

// TYPÉ, et sans `as`, comme `pieceDeTest` juste en dessous : le compilateur confronte alors chaque
// champ à `LigneBancaire`, donc à la table. Il a sorti `created_at`, absent depuis toujours de ce
// jeu d'essai — même remède que les cinq colonnes manquantes du `piece()` de PiecesTab.
function ligneDeTest(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'ligne-1', dossier_id: 'dossier-de-test', date: '2025-06-02', montant: -100,
    libelle: 'PRLV SEPA FOURNISSEUR', libelle_brut: null, statut: 'non_rapprochee',
    piece_id: null, cotisation_id: null, prelevement_personnel: false, source_fichier: null,
    created_at: '2025-06-02T09:00:00Z', ...o,
  }
}

// TYPÉ, et sans `as` : le compilateur vérifie alors chaque champ contre `Piece`, donc contre la
// table. Le jeu d'essai portait `devise: null`, impossible en base (NOT NULL DEFAULT 'EUR') — et ce
// n'était pas inerte ici : `reglerPieceSurBanque` sort sur `!piece.devise` AVANT son test
// `=== 'EUR'`, donc le test exerçait la branche du champ absent au lieu de celle d'une pièce en
// euros. Un jeu d'essai infidèle ne fait pas qu'affaiblir un test : il lui fait prouver autre chose.
function pieceDeTest(o: Partial<Piece> = {}): Piece {
  return {
    id: 'piece-1', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier/facture.pdf', nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2025-06-01', tiers: 'Fournisseur', montant_ht: null, montant_tva: null,
    montant_ttc: 100, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2025-06-01T09:00:00Z', updated_at: '2025-06-01T09:00:00Z', ...o,
  }
}

function reinitialiser() {
  faux.lignes = [ligneDeTest()]
  faux.pieces = [pieceDeTest()]
  faux.updatesLignes = []
  faux.resoudreUpdateLigne = null
  faux.erreurReleves = null
  faux.majImmediate = false
  faux.erreurMajLigne = null
  faux.retenirLectureLignes = false
  faux.resoudreLectureLignes = null
  faux.updatesPieces = []
  faux.insertions = []
  faux.muet = {}
  faux.lignesPdf = []
}

// L'onglet dans la coque du panneau de droite, comme dans l'application : sans elle,
// `usePanneauDroit` lève (voir lib/panneauDroit.ts) — un bouton qui n'ouvrirait rien ne doit pas
// passer pour un bouton qui marche.
function rendre() {
  return render(
    <FournisseurPanneauDroit>
      <AnneeProvider defaut="toutes">
        <BanqueTab dossierId="dossier-de-test" />
      </AnneeProvider>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })

afterEach(() => { vi.restoreAllMocks() })

describe('BanqueTab — Tout rapprocher automatiquement', () => {
  it('ne rapproche le lot qu\'une fois quand le bouton est cliqué deux fois de suite', async () => {
    reinitialiser()
    rendre()
    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })

    // Les deux clics partent dans le MÊME `act` : deux `fireEvent.click` de suite ne reproduisent
    // PAS un double clic, chacun ouvre son propre `act` qui re-rend le composant avant le suivant.
    await act(async () => {
      bouton.click()
      bouton.click()
    })

    expect(faux.updatesLignes).toHaveLength(1)
    expect(faux.updatesLignes[0]).toMatchObject({ statut: 'rapprochee', piece_id: 'piece-1' })

    await act(async () => { faux.resoudreUpdateLigne?.() })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Tout rapprocher automatiquement/ })).toBeNull())
  })

  // DEUX PIÈCES QUI CONVIENNENT AUSSI BIEN L'UNE QUE L'AUTRE — le cas réel de ce dossier, deux
  // dépôts du même document au même montant et à la même date. L'écran faisait
  // `piecesValidees.find(...)` : la PREMIÈRE DE LA LISTE gagnait, en masse et sur un seul clic, sans
  // que rien ne le dise. `planRapprochementAutomatique` refuse désormais, et l'écran DIT ce qu'il
  // laisse — un bouton qui annonce N en en traitant moins ne dit pas où sont passées les autres.
  //
  // Aucun test de `src/lib` ne peut voir ceci : le plan est juste, c'est son CÂBLAGE à l'écran qui
  // décide de ce qui s'écrit en base et de ce que l'opérateur lit.
  it('ne rapproche rien et le dit quand deux pièces se disputent le mouvement', async () => {
    reinitialiser()
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf' }),
    ]
    rendre()

    await screen.findByText(/plusieurs pièces ou échéances possibles/)
    expect(screen.queryByRole('button', { name: /Tout rapprocher automatiquement/ })).toBeNull()
    expect(faux.updatesLignes).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE, et elle porte tout : sans elle, « l'écran refuse l'ambiguïté » serait satisfait
  // par un écran qui n'affiche JAMAIS le bouton et crie à l'ambiguïté sur un relevé ordinaire.
  it('ne crie pas à l’ambiguïté quand une seule pièce convient', async () => {
    reinitialiser()
    rendre()

    await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    expect(screen.queryByText(/plusieurs pièces ou échéances possibles/)).toBeNull()
  })
})

// UNE PASTILLE VERTE QUI SURVIT À CE QU'ELLE AFFIRMAIT. Les deux clés du côté banque
// (`piece_id`, `cotisation_id`) sont en `ON DELETE SET NULL` : supprimer la pièce ou l'échéance ne
// bloque pas, elle défait le lien en silence et `statut` reste `'rapprochee'`. L'écran affichait
// alors « Rapproché » en vert, indiscernable d'un vrai rapprochement — une pièce sans tiers rend
// exactement le même libellé nu — pendant que la Checklist, qui ne compte que les
// `non_rapprochee`, se taisait.
//
// Aucun test de `src/lib` ne peut le voir : `mouvementRapprocheSansObjet` est juste, c'est son
// CÂBLAGE à la pastille qui décide de ce que l'opérateur lit.
describe('BanqueTab — un mouvement rapproché qui ne désigne plus rien', () => {
  it("le dit au lieu d'afficher la pastille verte", async () => {
    reinitialiser()
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: null, cotisation_id: null })]
    rendre()

    // L'écran s'ouvre sur « Non rapprochés » : c'est justement ce filtre qui fait disparaître le
    // mouvement orphelin de la vue par défaut, une raison de plus pour que sa pastille dise vrai.
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })

    await screen.findByText('Rapproché sans justificatif')
    expect(screen.queryAllByText(/^Rapproché$/)).toHaveLength(0)

    // LE PANNEAU EST UNE SECONDE COPIE DE LA MÊME PASTILLE, et il faut l'OUVRIR pour la voir : une
    // assertion qui reste sur la liste laisserait le panneau mentir tout seul, et la mutation qui
    // ne corrige qu'un des deux sites passerait au vert.
    await act(async () => { screen.getByText('PRLV SEPA FOURNISSEUR').click() })
    expect(screen.queryAllByText('Rapproché sans justificatif')).toHaveLength(2)
    expect(screen.queryAllByText(/^Rapproché$/)).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la pastille ne ment plus » serait satisfait par un écran qui
  // crierait au justificatif manquant sur TOUS les rapprochements, y compris les vrais.
  it('laisse la pastille verte à un rapprochement qui désigne bien une pièce', async () => {
    reinitialiser()
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1' })]
    rendre()

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })

    await screen.findByText(/Rapproché — Fournisseur/)
    expect(screen.queryAllByText('Rapproché sans justificatif')).toHaveLength(0)

    // Le panneau dit le rapprochement par sa pastille ET par la pièce qu'il désigne.
    await act(async () => { screen.getByText('PRLV SEPA FOURNISSEUR').click() })
    expect(within(volet()).getByText('Rapproché')).toBeTruthy()
    expect(within(volet()).getByText('Rapproché avec')).toBeTruthy()
    expect(within(volet()).getByText('Fournisseur')).toBeTruthy()
    expect(screen.queryAllByText('Rapproché sans justificatif')).toHaveLength(0)
  })
})

// LA BANQUE FAIT FOI, MAIS SOUS UN SEUIL (décision du cabinet, 23/09/2026). Sous le seuil la pièce
// est ALIGNÉE au rapprochement, donc il ne reste aucun écart à montrer ; au-dessus on ne touche à
// rien — un écart large est presque toujours un paiement partiel ou groupé — et c'est cette pastille
// qui le dit.
//
// Aucun test de `src/lib` ne peut le voir : `ecartAvecBanque` est juste, c'est son CÂBLAGE qui
// décide de ce que l'opérateur lit. Et rien d'autre ne le dirait tant que les écritures ne sont pas
// générées : `synchroniserContrepartieBanque` sort avant d'écrire quoi que ce soit tant que la pièce
// n'a pas sa ligne de charge, donc `groupesDesequilibres` reste muet.
describe('BanqueTab — un rapprochement dont le montant ne correspond pas', () => {
  it("affiche l'écart, dans la liste ET dans le panneau", async () => {
    reinitialiser()
    faux.pieces = [pieceDeTest({ montant_ttc: 1000 })]
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1', montant: -500 })]
    rendre()

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await screen.findByText(/Écart de .*500,00.*avec la pièce/)

    // LE PANNEAU EST UNE SECONDE COPIE, et il faut l'OUVRIR : une assertion restée sur la liste
    // laisserait le panneau mentir tout seul, et la mutation qui ne corrige qu'un des deux sites
    // passerait au vert.
    await act(async () => { screen.getByText('PRLV SEPA FOURNISSEUR').click() })
    expect(screen.queryAllByText(/Écart de .*500,00.*avec la pièce/)).toHaveLength(2)
  })

  // GARDE SYMÉTRIQUE — sans elle, « l'écran signale l'écart » serait satisfait par un écran qui
  // crie sur TOUS les rapprochements, y compris les exacts et ceux que le seuil absorbe.
  it('se tait sur un rapprochement exact et sur un écart sous le seuil', async () => {
    reinitialiser()
    faux.pieces = [pieceDeTest({ montant_ttc: 100 })]
    faux.lignes = [
      ligneDeTest({ id: 'ligne-1', statut: 'rapprochee', piece_id: 'piece-1', montant: -100 }),
      ligneDeTest({ id: 'ligne-2', statut: 'rapprochee', piece_id: 'piece-1', montant: -100.03, libelle: 'PRLV AVEC FRAIS' }),
    ]
    rendre()

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await screen.findByText('PRLV AVEC FRAIS')
    expect(screen.queryAllByText(/Écart de/)).toHaveLength(0)
  })
})

// LES RELEVÉS DÉJÀ CLASSÉS, LUS EN PARTIE, LE DISENT DANS L'IMPORT. Leur lecture s'écrivait
// `lireTout(…).then((lecture) => …)` — une forme que le scanner ne voyait pas — et jetait son
// drapeau : tronquée, la liste cache un relevé déjà classé, qu'on croit alors devoir redemander.
describe('BanqueTab — les relevés déjà classés dans Documents', () => {
  it('lus en partie, ils le disent', async () => {
    reinitialiser()
    faux.erreurReleves = 'refus simulé'
    rendre()
    expect(await screen.findByText(/Les relevés déjà classés dans Documents n'ont pas pu être lus en entier \(lecture interrompue après 0 ligne\(s\) : refus simulé\)/)).toBeTruthy()
  })

  it('lus en entier, ils se taisent', async () => {
    reinitialiser()
    rendre()
    expect(await screen.findByText('Importer un relevé bancaire')).toBeTruthy()
    expect(screen.queryAllByText(/Les relevés déjà classés dans Documents n'ont pas pu/)).toHaveLength(0)
  })
})

// LE RAPPROCHEMENT D'UN MOUVEMENT DANS LE PANNEAU DE DROITE (étape 2 de l'interface d'ordinateur).
// Il remplace une fenêtre qui recouvrait l'écran — et c'est ce qui change le plus : la liste reste
// cliquable à côté, donc « Tout rapprocher » et une action du panneau peuvent désormais se croiser sur
// le même mouvement. Ce qui ferait mentir le panneau sans que rien ne casse visiblement : une pièce
// « proposée » quand deux conviennent aussi bien (l'ordre de tri trancherait à la place de
// l'opérateur), trois coches sous une pièce que la banque ne confirme pas, un choix dans la liste
// déroulante qui rapproche dès qu'on y touche, une action qui part deux fois, et un panneau qui
// retombe sur l'état d'avant l'action.
// Par la ligne du RELEVÉ : le même libellé apparaît aussi dans les tableaux « Sans doute possible »
// et « À trancher par l'opérateur », qui ne s'ouvrent pas. Cherchée HORS de l'`act` : dedans, React
// retient les mises à jour du chargement jusqu'à la sortie, et la ligne n'apparaîtrait jamais.
async function ouvrir(libelle = 'PRLV SEPA FOURNISSEUR') {
  const cellules = await screen.findAllByText(libelle)
  const cellule = cellules.find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  await act(async () => { cellule.click() })
}

describe('BanqueTab — le mouvement dans le panneau de droite', () => {
  it('associe la pièce proposée et RESTE sur le mouvement, dans son nouvel état', async () => {
    reinitialiser()
    faux.majImmediate = true
    rendre()
    await ouvrir()

    expect(within(volet()).getByText('Mouvement 1 sur 1')).toBeTruthy()
    expect(within(volet()).getByText('Pièce proposée')).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })

    // Comme dans la maquette : on voit ce qu'on vient de faire, et l'annulation est à portée de main.
    // Le mouvement a quitté la liste « Non rapprochés », et le panneau le dit plutôt que de mentir
    // sur sa place.
    await waitFor(() => expect(within(volet()).getByText('Rapproché avec')).toBeTruthy())
    expect(faux.updatesLignes).toEqual([expect.objectContaining({ statut: 'rapprochee', piece_id: 'piece-1' })])
    expect(within(volet()).getByText('Mouvement hors de la liste affichée')).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Annuler le rapprochement' })).toBeTruthy()
  })

  it('la ligne ouverte est surlignée dans la liste, et ne l’est plus panneau fermé', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const ligne = screen.getAllByText('PRLV SEPA FOURNISSEUR').map((e) => e.closest('tr')).find((tr) => tr != null)!
    expect(ligne.className).toContain('ligne-ouverte')
    await act(async () => { within(volet()).getByRole('button', { name: 'Fermer le panneau' }).click() })
    expect(ligne.className).not.toContain('ligne-ouverte')
    expect(volet().childElementCount).toBe(0)
  })

  it('justifie la pièce proposée par ses signaux', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const panneau = within(volet())
    expect(panneau.getByText('Même montant, au centime près')).toBeTruthy()
    expect(panneau.getByText('1 jour d’écart avec la pièce')).toBeTruthy()
    expect(panneau.getByText('Fournisseur retrouvé dans le libellé bancaire')).toBeTruthy()
    expect(panneau.queryAllByText(/Sens contraire/)).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE du précédent : sans elle, « le panneau justifie » serait satisfait par un
  // panneau qui coche TOUT — or c'est précisément le fournisseur et le sens qui séparent une
  // concordance d'une coïncidence (voir lib/appariementBanque.ts).
  it('dit ce que la banque ne confirme pas, au lieu de le cocher', async () => {
    reinitialiser()
    faux.pieces = [pieceDeTest({ tiers: 'Transmedical' })]
    faux.lignes = [ligneDeTest({ montant: 100, libelle: 'VIR SEPA REMBOURSEMENT' })]
    rendre()
    await ouvrir('VIR SEPA REMBOURSEMENT')
    const panneau = within(volet())
    expect(panneau.getByText('Fournisseur non retrouvé dans le libellé bancaire')).toBeTruthy()
    expect(panneau.getByText('Sens contraire : la pièce attend un paiement, le relevé montre un crédit')).toBeTruthy()
    expect(panneau.queryAllByText('Fournisseur retrouvé dans le libellé bancaire')).toHaveLength(0)
  })

  // DEUX PIÈCES QUI CONVIENNENT AUSSI BIEN : le cas que « Tout rapprocher » refuse de trancher. En
  // mettre une en avant sous « Pièce proposée », avec le bouton principal, le trancherait à la place
  // de l'opérateur — par l'ordre de tri.
  it('ne propose aucune des deux pièces qui conviennent aussi bien : il les montre toutes', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf' }),
    ]
    rendre()
    await ouvrir()
    const panneau = within(volet())
    expect(panneau.getByText('2 pièces conviennent aussi bien')).toBeTruthy()
    expect(panneau.queryAllByText('Pièce proposée')).toHaveLength(0)
    expect(panneau.queryAllByRole('button', { name: 'Associer cette pièce' })).toHaveLength(0)

    const boutons = panneau.getAllByRole('button', { name: 'Associer celle-ci' })
    expect(boutons).toHaveLength(2)
    await act(async () => { boutons[1].click() })
    await waitFor(() => expect(faux.updatesLignes).toEqual([expect.objectContaining({ piece_id: 'piece-2' })]))
  })

  // Dans la fenêtre d'avant, choisir dans la liste déroulante RAPPROCHAIT : sur une liste qui a le
  // focus, les flèches du clavier changent la valeur, donc la première pièce venue partait sans avoir
  // été choisie. Le choix ne s'applique plus qu'au clic sur « Associer ».
  it('le choix à la main ne rapproche qu’au clic sur « Associer »', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [pieceDeTest({ montant_ttc: 250 })]
    rendre()
    await ouvrir()
    const panneau = within(volet())
    expect(panneau.getByText('Aucune pièce proposée pour ce mouvement.')).toBeTruthy()

    await act(async () => { fireEvent.change(panneau.getByLabelText('Pièce'), { target: { value: 'piece-1' } }) })
    expect(faux.updatesLignes).toHaveLength(0)

    await act(async () => { panneau.getByRole('button', { name: 'Associer' }).click() })
    await waitFor(() => expect(faux.updatesLignes).toEqual([expect.objectContaining({ piece_id: 'piece-1' })]))
  })

  // Trois clics dans le MÊME rendu, et pas deux : un verrou posé DANS le `try` laisse le refus du
  // deuxième sortir par le `finally`, qui relâche le verrou du premier — le troisième passe alors
  // (voir CLAUDE.md, « Le verrou se pose AVANT le `try` »).
  it('n’associe qu’une fois, même sur trois clics rapprochés', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const bouton = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.updatesLignes).toHaveLength(1)
  })

  // LE VERROU EST PARTAGÉ. Tant que le rapprochement vivait dans une fenêtre qui recouvrait l'écran,
  // on ne pouvait pas lancer « Tout rapprocher » en arbitrant une ligne ; le panneau laisse la liste
  // cliquable, donc les deux peuvent se croiser — et deux écritures qui se croisent laissent une
  // contrepartie banque pour une pièce que le mouvement ne désigne plus.
  it('une action du panneau en cours retient « Tout rapprocher », et inversement', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const associer = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    const toutRapprocher = screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { associer.click(); toutRapprocher.click() })
    expect(faux.updatesLignes).toHaveLength(1)
    expect(toutRapprocher.hasAttribute('disabled')).toBe(true)
  })

  it('« Tout rapprocher » en cours retient le panneau', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const associer = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    const toutRapprocher = screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { toutRapprocher.click(); associer.click() })
    expect(faux.updatesLignes).toHaveLength(1)
    expect(associer.hasAttribute('disabled')).toBe(true)
  })

  // Relâché avant la relecture du relevé, le verrou laisserait le panneau montrer « Associer cette
  // pièce » sur un mouvement DÉJÀ rapproché, le temps que la relecture revienne — et un second clic
  // referait le rapprochement.
  it('reste verrouillé tant que la relecture du relevé n’est pas revenue', async () => {
    reinitialiser()
    faux.majImmediate = true
    rendre()
    await ouvrir()
    faux.retenirLectureLignes = true
    const associer = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    await act(async () => { associer.click() })
    await waitFor(() => expect(faux.resoudreLectureLignes).not.toBeNull())
    expect(associer.hasAttribute('disabled')).toBe(true)

    await act(async () => { faux.resoudreLectureLignes?.() })
    await waitFor(() => expect(within(volet()).getByText('Rapproché avec')).toBeTruthy())
  })

  // L'échec se DIT, et l'écran ne reste pas figé : c'était la moitié silencieuse de l'ancien
  // `ignorer`, dont le résultat n'était pas lu — sans conséquence tant que la fenêtre se fermait sur
  // l'action, trompeur maintenant que le panneau reste sur le mouvement.
  it('un refus est dit, et le panneau redevient utilisable', async () => {
    reinitialiser()
    faux.erreurMajLigne = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Ignorer' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/n'a pas pu être ignoré : refus simulé/)))
    expect(within(volet()).getByRole('button', { name: 'Ignorer' }).hasAttribute('disabled')).toBe(false)
    expect(within(volet()).getByText('Non rapproché')).toBeTruthy()
  })

  // Rapproché sous le filtre « Non rapprochés », le mouvement quitte la liste : « Suivant » mène au
  // mouvement qui a pris sa place, et on enchaîne sans revenir à la liste.
  it('« Suivant » mène, après une association, au mouvement qui a pris sa place', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.lignes = [
      ligneDeTest({ id: 'ligne-1' }),
      ligneDeTest({ id: 'ligne-2', montant: -42, libelle: 'PRLV SEPA AUTRE CHOSE' }),
    ]
    rendre()
    await ouvrir()
    expect(within(volet()).getByText('Mouvement 1 sur 2')).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Mouvement hors de la liste affichée')).toBeTruthy())

    expect(within(volet()).getByRole('button', { name: 'Mouvement précédent' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { within(volet()).getByRole('button', { name: 'Mouvement suivant' }).click() })
    expect(within(volet()).getByText('Mouvement 1 sur 1')).toBeTruthy()
    expect(within(volet()).getAllByText('PRLV SEPA AUTRE CHOSE').length).toBeGreaterThan(0)
  })

  it('un mouvement ignoré se remet à traiter', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.lignes = [ligneDeTest({ statut: 'ignoree' })]
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Ignorés' })).click() })
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Remettre à traiter' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())
    expect(faux.updatesLignes).toEqual([expect.objectContaining({ statut: 'non_rapprochee', piece_id: null, cotisation_id: null })])
  })
})

// LE TROISIÈME CHEMIN DE RAPPROCHEMENT N'APPELAIT PAS LE RÈGLEMENT SUR LA BANQUE. Le rapprochement à
// la main et le lot « sans doute possible » règlent la pièce sur le montant réellement débité avant
// d'écrire la contrepartie (voir lib/reglementBanque.ts) ; « Tout rapprocher » ne le faisait pas, donc
// une pièce en devise rapprochée par lui restait « provisoire » au cours BCE alors que la banque
// venait de donner son montant réel.
describe('BanqueTab — Tout rapprocher règle la pièce sur la banque', () => {
  it('une pièce en devise passe au montant réellement débité', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [pieceDeTest({ devise: 'USD', montant_devise: 120, montant_ttc: 100, taux_change: 1.2, conversion_source: 'bce' })]
    rendre()
    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { bouton.click() })
    await waitFor(() => expect(faux.updatesPieces).toEqual([expect.objectContaining({ conversion_source: 'banque' })]))
  })
})

// UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE. Les bandeaux disaient déjà que les mouvements, les
// pièces ou les règles n'avaient été lus qu'en partie ; les boutons qui ÉCRIVENT à partir de ces
// listes restaient ouverts. L'import dédoublonne contre les mouvements LUS — et aucun écran ne permet
// de retirer un mouvement bancaire ; les deux lots n'écrivent que ce qui n'a qu'UN candidat, et une
// unicité ne se juge que sur tout ce qui existe.
describe('BanqueTab — import d’un relevé', () => {
  // Un import qui écarte des doublons le DIT par une alerte : c'est elle qui prouve, dans le cas
  // passant, que le dédoublonnage a bien tourné contre les mouvements lus.
  const alertes: string[] = []
  beforeEach(() => {
    alertes.length = 0
    vi.spyOn(window, 'alert').mockImplementation((m?: unknown) => { alertes.push(String(m)) })
  })

  const CSV = 'Date;Libellé;Montant\n02/06/2025;PRLV SEPA FOURNISSEUR;-100,00\n05/06/2025;VIR CLIENT DUPONT;250,00\n'

  async function deposer() {
    const fichier = new File([CSV], 'releve-juin.csv', { type: 'text/csv' })
    const champ = document.querySelector('input[type=file][accept=".csv,text/csv"]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    return screen.findByRole('button', { name: /Importer 2 ligne\(s\)/ })
  }

  // La garde posée DANS les gestionnaires (`if (lectureIncomplete) return`) n'est atteinte par aucun
  // clic, le bouton étant déjà grisé : la retirer laisse ces tests verts, et c'est attendu. C'est une
  // seconde ceinture, comme le refus côté gestionnaire de ClotureTab — la dire gardée serait faux.
  it('se suspend sur un relevé lu à moitié, plutôt que de réimporter ce qu’il n’a pas lu', async () => {
    reinitialiser()
    // Le mouvement du 02/06 est en base, mais la lecture n'en rend rien : le dédoublonnage le
    // croirait absent, et l'importerait une seconde fois.
    faux.muet = { lignes_bancaires: 0 }
    rendre()

    const bouton = await deposer()
    expect(screen.getByText(/Import suspendu/)).toBeTruthy()
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.insertions.filter((i) => i.table === 'lignes_bancaires')).toHaveLength(0)
  })

  it('importe, sur une lecture complète, la seule ligne qui manque', async () => {
    // Le garde symétrique : sans lui, « l'import se suspend » serait satisfait par un import qui ne
    // part JAMAIS.
    reinitialiser()
    rendre()

    const bouton = await deposer()
    expect(screen.queryByText(/Import suspendu/)).toBeNull()
    await act(async () => { bouton.click() })

    const lot = faux.insertions.filter((i) => i.table === 'lignes_bancaires')
    expect(lot).toHaveLength(1)
    expect(lot[0].valeur).toEqual([expect.objectContaining({ libelle: 'VIR CLIENT DUPONT', montant: 250 })])
    expect(alertes).toEqual([expect.stringContaining('1 déjà présente(s), ignorée(s)')])
  })

  // Le chemin PDF porte la même garde et le même verrou que le CSV — un chemin qu'on ne teste pas
  // est celui où une mutation passe inaperçue.
  async function deposerPdf() {
    faux.lignesPdf = [
      { texte: '02/06/2025 PRLV SEPA FOURNISSEUR -100,00', xFin: 0 },
      { texte: '05/06/2025 VIR CLIENT DUPONT 250,00', xFin: 0 },
    ]
    await act(async () => { (await screen.findByRole('button', { name: 'PDF' })).click() })
    const fichier = new File(['%PDF'], 'releve-juin.pdf', { type: 'application/pdf' })
    const champ = document.querySelector('input[type=file][accept=".pdf,application/pdf"]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    return screen.findByRole('button', { name: /Importer 2 ligne\(s\)/ })
  }

  it('se suspend aussi par le chemin PDF', async () => {
    reinitialiser()
    faux.muet = { lignes_bancaires: 0 }
    rendre()

    const bouton = await deposerPdf()
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.insertions.filter((i) => i.table === 'lignes_bancaires')).toHaveLength(0)
  })

  it("n'importe qu'une fois un relevé PDF cliqué trois fois", async () => {
    reinitialiser()
    rendre()

    const bouton = await deposerPdf()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    const lot = faux.insertions.filter((i) => i.table === 'lignes_bancaires')
    expect(lot).toHaveLength(1)
    expect(lot[0].valeur).toEqual([expect.objectContaining({ libelle: 'VIR CLIENT DUPONT', montant: 250 })])
  })

  it("trois clics rapprochés n'importent le relevé qu'une fois", async () => {
    // Chaque clic dédoublonnait contre la MÊME liste d'avant : deux imports partis dans le même rendu
    // inséraient tous deux le relevé entier. Trois et non deux : un verrou posé dans le `try` serait
    // relâché par le deuxième clic et laisserait passer le troisième.
    reinitialiser()
    rendre()

    const bouton = await deposer()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.insertions.filter((i) => i.table === 'lignes_bancaires')).toHaveLength(1)
  })
})

describe('BanqueTab — les lots de rapprochement sur une lecture partielle', () => {
  it('suspend « Tout rapprocher » quand la jumelle d’une pièce peut ne pas avoir été lue', async () => {
    // Deux dépôts du même document : lus ensemble, le plan refuse de trancher (test plus haut). Lus
    // à moitié, la seconde disparaît et la première paraît seule candidate.
    reinitialiser()
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf' }),
    ]
    faux.muet = { pieces: 1 }
    rendre()

    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Rapprochement automatique suspendu/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.updatesLignes).toHaveLength(0)
  })

  it('suspend la validation en lot, qui validerait la pièce sur cette fausse certitude', async () => {
    reinitialiser()
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf', statut: 'a_valider' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf', statut: 'a_valider' }),
    ]
    faux.muet = { pieces: 1 }
    rendre()

    const bouton = await screen.findByRole('button', { name: /Valider et rapprocher les 1/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Validation en lot suspendue/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.updatesPieces).toHaveLength(0)
    expect(faux.updatesLignes).toHaveLength(0)
  })

  it('valide en lot, sur une lecture complète, la pièce qui n’a qu’un mouvement possible', async () => {
    // Le garde symétrique du précédent.
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [pieceDeTest({ id: 'piece-1', statut: 'a_valider' })]
    rendre()

    const bouton = await screen.findByRole('button', { name: /Valider et rapprocher les 1/ })
    expect(screen.queryByText(/Validation en lot suspendue/)).toBeNull()
    await act(async () => { bouton.click() })
    await waitFor(() => expect(faux.updatesPieces).toEqual([expect.objectContaining({ statut: 'validee' })]))
  })
})
