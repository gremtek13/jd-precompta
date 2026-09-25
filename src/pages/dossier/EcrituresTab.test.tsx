import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import EcrituresTab from './EcrituresTab'

// L'ONGLET QUI PRODUIT LES DEUX FICHIERS OFFICIELS du projet — le FEC et la piste d'audit. Un défaut
// ici ne reste pas à l'écran : il part chez un vérificateur. Ce test vise donc les trois choses
// qu'aucun test de `src/lib` ne peut voir, parce qu'elles vivent dans le CÂBLAGE et non dans le
// calcul :
//
//  1. le contrôle branché sur le bon sous-ensemble (le piège que le projet a déjà connu une fois,
//     avec moisEnDoubleSurAbonnement câblé sur les seules pièces validées) ;
//  2. le FEC exporté sur l'exercice entier et non sur ce qu'une recherche a retenu ;
//  3. les deux exports qui se REFUSENT quand le brouillon n'a pas pu être lu en entier.

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  // Plafond « Max rows » de PostgREST : nombre maximum de lignes rendues PAR REQUÊTE, qui ne se
  // signale pas (voir lib/lectureComplete.ts). `lireTout` le recolle tranche par tranche.
  plafond: null as number | null,
  // Le serveur cesse de rendre quoi que ce soit au-delà de cette position, tout en continuant
  // d'annoncer le vrai total. C'est LE cas qui produit une lecture incomplète : la boucle s'arrête
  // sur une tranche vide, et le compte annoncé fait foi.
  muetApres: null as number | null,
  // Une suppression refusée par la base. Le faux client rend alors l'erreur SANS rien retirer, ce
  // qui est le comportement réel : `supabase.from(...).delete()` ne lève pas, l'échec se lit dans
  // `{ error }`.
  refusSuppression: null as string | null,
  // Même panne que `muetApres`, sur UNE table seulement : c'est ce qui sépare « le brouillon a
  // manqué » de « tout a manqué », et la génération ne se trompe que dans le premier cas.
  muetParTable: {} as Record<string, number>,
  // Les insertions réellement envoyées, dans l'ordre. Elles MORDENT sur la table du faux, comme la
  // suppression : la relecture qui suit voit les écritures créées.
  insertions: [] as { table: string; lignes: Record<string, unknown>[] }[],
  // Retient les LECTURES qui suivent une insertion jusqu'à ce que le test relâche : c'est la fenêtre
  // de la relecture, pendant laquelle un second clic ne doit rien renvoyer.
  retenirApresInsertion: false,
  retenue: null as Promise<void> | null,
  relacher: null as (() => void) | null,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      // La suppression MORD vraiment sur la table du faux : après elle, le `load()` de l'écran relit
      // un jeu réellement amputé. C'est ce qui rend les assertions de bout en bout — « le panneau
      // disparaît » plutôt que « la bonne méthode a été appelée » — et ce qui permet de voir qu'une
      // ligne oubliée en produit une autre, ailleurs.
      let suppression = false
      let insertion: Record<string, unknown>[] | null = null
      const filtres: [string, unknown][] = []
      Object.assign(chaine, {
        select: () => chaine,
        delete: () => { suppression = true; return chaine },
        insert: (lignes: Record<string, unknown> | Record<string, unknown>[]) => {
          insertion = Array.isArray(lignes) ? lignes : [lignes]
          return chaine
        },
        eq: (colonne: string, valeur: unknown) => { filtres.push([colonne, valeur]); return chaine },
        neq: (colonne: string, valeur: unknown) => { filtres.push([`!${colonne}`, valeur]); return chaine },
        is: () => chaine,
        not: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: { data: unknown[] | null; error: unknown; count: number }) => unknown) => {
          if (insertion) {
            faux.insertions.push({ table, lignes: insertion })
            faux.parTable[table] = [...(faux.parTable[table] ?? []), ...insertion.map((l, i) => ({ id: `ins-${faux.insertions.length}-${i}`, ...l }))]
            if (faux.retenirApresInsertion) {
              faux.retenue = new Promise<void>((r) => { faux.relacher = r })
            }
            return Promise.resolve({ data: null, error: null, count: 0 }).then(suite)
          }
          if (suppression) {
            if (faux.refusSuppression) {
              return Promise.resolve({ data: null, error: { message: faux.refusSuppression }, count: 0 }).then(suite)
            }
            const garde = (ligne: Record<string, unknown>) => !filtres.every(([colonne, valeur]) =>
              colonne.startsWith('!') ? ligne[colonne.slice(1)] !== valeur : ligne[colonne] === valeur)
            faux.parTable[table] = (faux.parTable[table] ?? []).filter((l) => garde(l as Record<string, unknown>))
            return Promise.resolve({ data: null, error: null, count: 0 }).then(suite)
          }
          const toutes = faux.parTable[table] ?? []
          const demande = fin - debut + 1
          const taille = faux.plafond == null ? demande : Math.min(demande, faux.plafond)
          const muet = faux.muetParTable[table] ?? faux.muetApres
          const rendu = muet == null
            ? toutes.slice(debut, debut + taille)
            : toutes.slice(debut, Math.min(debut + taille, muet))
          const reponse = { data: rendu, error: null, count: toutes.length }
          return (faux.retenue ?? Promise.resolve()).then(() => reponse).then(suite)
        },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      })
      return chaine
    },
  },
}))

// `genererFec` reste le VRAI : c'est son résultat qu'on veut inspecter. Seul le téléchargement est
// remplacé — jsdom n'a pas d'URL.createObjectURL, et c'est le CONTENU qui est en cause.
const telecharge = vi.hoisted(() => ({ fichiers: [] as { nom: string; contenu: string }[] }))
vi.mock('../../lib/fec', async (vrai) => ({
  ...(await vrai<typeof import('../../lib/fec')>()),
  telechargerTexte: (nom: string, contenu: string) => { telecharge.fichiers.push({ nom, contenu }) },
}))

const CATEGORIE_ACHATS = {
  id: 'cat-achats', dossier_id: null, code: 'achats_fournisseurs', libelle: 'Achats',
  ordre: 1, compte_comptable: '606100', poste_2035: 'Achats',
}

function piece(o: Record<string, unknown> = {}) {
  return {
    id: 'p1', dossier_id: 'dossier-de-test', nom_fichier: 'facture.pdf', statut: 'validee',
    type_piece: 'achat', date_piece: '2025-03-10', montant_ht: null, montant_tva: null,
    montant_ttc: 120, tiers: 'FOURNISSEUR MARSEILLE', categorie_id: 'cat-achats',
    confiance: 'haute', storage_path: 'dossier-de-test/facture.pdf', storage_hash: null,
    created_at: '2025-03-10T09:00:00Z', ...o,
  }
}

function ecriture(o: Record<string, unknown> = {}) {
  return {
    id: 'e1', dossier_id: 'dossier-de-test', piece_id: 'p1', ligne_bancaire_id: null,
    date: '2025-03-10', libelle: 'FOURNISSEUR MARSEILLE', sens: 'debit', statut: 'proposee',
    compte: '606100', montant: 120, created_at: '2025-03-10T09:00:00Z', ...o,
  }
}

function poser(tables: Partial<Record<string, unknown[]>>) {
  telecharge.fichiers = []
  faux.plafond = null
  faux.muetApres = null
  faux.refusSuppression = null
  faux.muetParTable = {}
  faux.insertions = []
  faux.retenirApresInsertion = false
  faux.retenue = null
  faux.relacher = null
  faux.parTable = {
    categories: [CATEGORIE_ACHATS], pieces: [], ecritures_brouillon: [],
    immobilisations: [], lignes_bancaires: [], declarations_tva: [],
    ...tables,
  } as Record<string, unknown[]>
}

function monter() {
  return render(
    <AnneeProvider defaut={2025}>
      <EcrituresTab dossierId="dossier-de-test" dossierNom="Dossier de test" dossierSiret="12345678901234" assujettiTva={false} />
    </AnneeProvider>,
  )
}

describe('EcrituresTab — écritures que la pièce ne justifie plus', () => {
  it("voit la charge d'une pièce devenue immobilisation, que les trois autres contrôles manquent", async () => {
    // Le geste réel : la pièce est validée, catégorisée, son écriture est générée — PUIS le cabinet
    // l'enregistre en immobilisation depuis l'autre onglet. Rien ne retire l'écriture, et la dépense
    // part alors en charge ET en amortissement.
    //
    // Ce que ce test garde et qu'aucun test de lib ne peut garder : le contrôle reçoit bien
    // `piecesValidees` (toutes) et non le sous-ensemble comptabilisable — le branchant sur ce
    // dernier, il serait MUET pour toujours, la pièce venant précisément d'en sortir. C'est mot pour
    // mot le piège de moisEnDoubleSurAbonnement câblé sur le mauvais `pieces`.
    // L'écriture est COMPLÈTE et ÉQUILIBRÉE (charge + contrepartie banque) : c'est ce qui la rend
    // invisible. Les deux autres contrôles partent bien des écritures, mais ils cherchent une
    // contrepartie manquante ou un solde non nul — ce groupe n'a ni l'un ni l'autre. Rien ne cloche
    // dans sa FORME ; c'est la pièce qui ne la justifie plus.
    poser({
      pieces: [piece()],
      ecritures_brouillon: [
        ecriture({ id: 'e1', compte: '606100', sens: 'debit', montant: 120 }),
        ecriture({ id: 'e2', compte: '512000', sens: 'credit', montant: 120 }),
      ],
      immobilisations: [{ id: 'i1', dossier_id: 'dossier-de-test', piece_id: 'p1' }],
    })
    monter()

    await screen.findByText('Écritures que la pièce ne justifie plus')
    expect(screen.getByText(/Enregistrée en immobilisation/)).toBeDefined()
    expect(screen.getByText(/Le FEC et la balance portent la charge entière/)).toBeDefined()
    // Et les trois contrôles qui partent de la pièce ne disent rien : c'est bien lui, et lui seul
    // qui voit cette charge. Les badges du pied de page sont le signal le plus court de leur
    // silence — `queryByText` lit le TEXTE rendu, jamais le balisage.
    expect(screen.queryByText('Écritures à régénérer')).toBeNull()
    expect(screen.queryByText(/à régénérer$/)).toBeNull()
    expect(screen.queryAllByText(/déséquilibrée/)).toHaveLength(0)
    expect(screen.queryByText(/en attente de rapprochement bancaire/)).toBeNull()
  })

  it('se tait quand la pièce justifie toujours son écriture', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()] })
    monter()

    await screen.findByText(/1 écriture proposée/)
    expect(screen.queryByText('Écritures que la pièce ne justifie plus')).toBeNull()
  })
})

describe('EcrituresTab — une recherche filtre l’affichage, jamais le FEC', () => {
  it("exporte l'exercice entier alors que le tableau n'en montre qu'une ligne", async () => {
    poser({
      pieces: [piece()],
      ecritures_brouillon: [
        ecriture({ id: 'e1', compte: '606100', montant: 100 }),
        ecriture({ id: 'e2', compte: '445660', montant: 20 }),
      ],
    })
    monter()

    await screen.findByText('606100')
    const champ = screen.getByRole('searchbox', { name: /Rechercher un compte/ })
    await act(async () => { fireEvent.change(champ, { target: { value: '606' } }) })

    // Le tableau se réduit…
    expect(screen.queryByText('445660')).toBeNull()
    expect(screen.getByText('1 sur 2')).toBeDefined()

    // …et le fichier fiscal, lui, porte les DEUX comptes. Un FEC amputé des lignes ne
    // correspondant pas au texte tapé est un fichier faux, et son format n'a pas de place pour
    // le dire.
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    expect(telecharge.fichiers).toHaveLength(1)
    expect(telecharge.fichiers[0].contenu).toContain('606100')
    expect(telecharge.fichiers[0].contenu).toContain('445660')
  })
})

describe('EcrituresTab — un export se refuse sur une lecture partielle', () => {
  it('grise les deux exports et dit pourquoi, plutôt que de produire un fichier amputé', async () => {
    // Le serveur annonce deux écritures et n'en rend qu'une, puis ne rend plus rien — et la réponse
    // reste une liste parfaitement valide, simplement plus courte que la réalité. C'est le plafond
    // « Max rows » de PostgREST, qui ne se signale pas.
    poser({
      pieces: [piece()],
      ecritures_brouillon: [ecriture({ id: 'e1' }), ecriture({ id: 'e2', compte: '445660', montant: 20 })],
    })
    faux.muetApres = 1
    monter()

    await screen.findByText(/Le brouillon n'a pas pu être lu en entier/)
    expect(screen.getByRole('button', { name: /Exporter FEC/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Exporter la piste d'audit/ }).hasAttribute('disabled')).toBe(true)
  })
})

describe("EcrituresTab — retrait d'une écriture sans objet", () => {
  // Le SEUL geste destructeur de cet onglet, et le seul dont l'absence rendait le panneau ci-dessus
  // purement déclaratif : il nommait l'action (« Retirer l'écriture ») sans que rien ne puisse la
  // faire. Ce que ces tests gardent est la FORME du retrait, qu'aucun test de lib ne peut voir —
  // le module ne supprime rien, c'est l'écran qui parle à la base.

  function poserImmobilisee() {
    poser({
      pieces: [piece()],
      ecritures_brouillon: [
        ecriture({ id: 'e1', compte: '606100', sens: 'debit', montant: 120 }),
        ecriture({ id: 'e2', compte: '512000', sens: 'credit', montant: 120, ligne_bancaire_id: 'l1' }),
      ],
      immobilisations: [{ id: 'i1', dossier_id: 'dossier-de-test', piece_id: 'p1' }],
      lignes_bancaires: [{
        id: 'l1', dossier_id: 'dossier-de-test', date: '2025-03-10', libelle: 'ACHAT',
        montant: -120, piece_id: 'p1', cotisation_id: null, ignoree: false,
        libelle_brut: null, created_at: '2025-03-10T09:00:00Z',
      }],
    })
  }

  it('retire TOUTES les lignes, contrepartie banque comprise — sans allumer une autre alerte', async () => {
    // LE point du test. N'ôter que la charge (comme le fait `regenererEcriture`, dont le `.neq` est
    // juste POUR LUI) laisserait la ligne banque seule dans son groupe : un groupe qui porte une
    // contrepartie et dont le solde vaut −120, c'est-à-dire exactement ce que `groupesDesequilibres`
    // signale — et qu'aucun geste ne pourrait plus éteindre. On aurait échangé une alerte vraie
    // contre une alerte fausse et définitive.
    vi.stubGlobal('confirm', () => true)
    poserImmobilisee()
    monter()

    await screen.findByText('Écritures que la pièce ne justifie plus')
    await act(async () => { screen.getByRole('button', { name: /Retirer l'écriture/ }).click() })

    expect(screen.queryByText('Écritures que la pièce ne justifie plus')).toBeNull()
    expect(faux.parTable.ecritures_brouillon).toEqual([])
    // La seconde moitié, celle qui mord sur le `.neq` : aucune alerte n'a pris la place de l'autre.
    expect(screen.queryAllByText(/déséquilibrée/)).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it("n'offre ce bouton qu'à une pièce immobilisée, jamais aux trois autres motifs", async () => {
    // Pour « catégorie retirée », « catégorie sans compte » et « montant effacé », l'écriture DOIT
    // revenir une fois la pièce corrigée en amont. Un bouton « Retirer » y ferait disparaître une
    // charge réelle d'un clic, sans trace — et personne ne la chercherait, le panneau étant vide.
    poser({
      pieces: [piece({ categorie_id: null })],
      ecritures_brouillon: [
        ecriture({ id: 'e1', compte: '606100', sens: 'debit', montant: 120 }),
        ecriture({ id: 'e2', compte: '512000', sens: 'credit', montant: 120 }),
      ],
    })
    monter()

    // L'ancre : le panneau est bien là, avec SON motif. Sans elle, un écran encore en chargement
    // rendrait ce test vert pour une raison fausse.
    await screen.findByText('Écritures que la pièce ne justifie plus')
    expect(screen.getByText(/La catégorie a été retirée/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Retirer l'écriture/ })).toBeNull()
  })

  it('un refus de la base se dit, et les lignes restent en place', async () => {
    // Le défaut de `SuperPdpModal.retirer()`, transposé : muette, une suppression refusée laisse le
    // panneau tel quel — donc indiscernable d'un bouton qui n'a rien fait, et le réflexe (recliquer)
    // rend le même silence. Ici il faut en plus que les lignes soient TOUJOURS là : un écran qui
    // afficherait l'erreur mais aurait vidé sa liste mentirait deux fois.
    vi.stubGlobal('confirm', () => true)
    poserImmobilisee()
    faux.refusSuppression = 'permission denied for table ecritures_brouillon'
    monter()

    await screen.findByText('Écritures que la pièce ne justifie plus')
    await act(async () => { screen.getByRole('button', { name: /Retirer l'écriture/ }).click() })

    expect(screen.getByText(/permission denied for table ecritures_brouillon/)).toBeDefined()
    expect(faux.parTable.ecritures_brouillon).toHaveLength(2)
    expect(screen.getByText('Écritures que la pièce ne justifie plus')).toBeDefined()
    vi.unstubAllGlobals()
  })

  it("une confirmation refusée ne supprime rien", async () => {
    vi.stubGlobal('confirm', () => false)
    poserImmobilisee()
    monter()

    await screen.findByText('Écritures que la pièce ne justifie plus')
    await act(async () => { screen.getByRole('button', { name: /Retirer l'écriture/ }).click() })

    expect(faux.parTable.ecritures_brouillon).toHaveLength(2)
    vi.unstubAllGlobals()
  })
})

describe('EcrituresTab — une lecture partielle ne commande pas la génération', () => {
  // `enAttente`, ce sont les pièces à comptabiliser MOINS celles dont on a LU l'écriture. Sur un
  // brouillon lu à moitié, il porte donc des pièces déjà comptabilisées — et « Générer » doublait
  // leur charge dans le FEC et la balance. Les exports se refusaient déjà sur cette lecture ; la
  // génération, qui ÉCRIT, restait ouverte.
  function poserDeuxPiecesComptabilisees() {
    poser({
      pieces: [piece({ id: 'p1' }), piece({ id: 'p2', tiers: 'SECOND FOURNISSEUR' })],
      ecritures_brouillon: [ecriture({ id: 'e1', piece_id: 'p1' }), ecriture({ id: 'e2', piece_id: 'p2', libelle: 'SECOND FOURNISSEUR' })],
    })
  }

  it("grise la génération sur un brouillon lu à moitié, et n'écrit rien", async () => {
    poserDeuxPiecesComptabilisees()
    // Le serveur rend l'écriture de p1 et se tait sur celle de p2 : p2 a l'air « en attente ».
    faux.muetParTable = { ecritures_brouillon: 1 }
    monter()

    await screen.findByText(/La génération est suspendue/)
    const bouton = screen.getByRole('button', { name: /Générer les écritures manquantes/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    // Le compte se tait plutôt que d'annoncer une pièce « en attente » qui ne l'est pas.
    expect(bouton.textContent).not.toMatch(/\(\d+\)/)
    expect(screen.queryByText(/en attente de génération/)).toBeNull()

    await act(async () => { bouton.click() })
    expect(faux.insertions).toHaveLength(0)
  })

  it('génère, sur une lecture complète, les écritures de la seule pièce qui en manque', async () => {
    // Le garde symétrique : sans lui, « on ne génère pas sur une lecture partielle » serait satisfait
    // par un bouton qui ne génère JAMAIS.
    poser({
      pieces: [piece({ id: 'p1' }), piece({ id: 'p2', tiers: 'SECOND FOURNISSEUR' })],
      ecritures_brouillon: [ecriture({ id: 'e1', piece_id: 'p1' })],
    })
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })

    expect(faux.insertions).toHaveLength(1)
    expect(faux.insertions[0].table).toBe('ecritures_brouillon')
    expect(faux.insertions[0].lignes.every((l) => l.piece_id === 'p2')).toBe(true)
  })

  it("trois clics rapprochés ne génèrent qu'une fois", async () => {
    // Trois et non deux : un verrou posé DANS le `try` serait relâché par le `finally` du deuxième
    // clic, refusé, et laisserait passer le troisième.
    poser({ pieces: [piece({ id: 'p1' })], ecritures_brouillon: [] })
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.insertions).toHaveLength(1)
  })

  it('reste fermée pendant la relecture qui suit une génération', async () => {
    // Relâché avant la relecture, le bouton redevenait cliquable sur un `enAttente` qui portait
    // encore la pièce qu'on venait de comptabiliser : un clic à ce moment la générait une seconde fois.
    poser({ pieces: [piece({ id: 'p1' })], ecritures_brouillon: [] })
    faux.retenirApresInsertion = true
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })
    expect(faux.insertions).toHaveLength(1)

    // La relecture est retenue : l'écran n'a pas encore vu l'écriture créée.
    await act(async () => { screen.getByRole('button', { name: /Génération…|Générer les écritures manquantes/ }).click() })
    expect(faux.insertions).toHaveLength(1)

    faux.retenirApresInsertion = false
    await act(async () => { faux.relacher?.() })
    faux.retenue = null
    expect(faux.insertions).toHaveLength(1)
  })
})
