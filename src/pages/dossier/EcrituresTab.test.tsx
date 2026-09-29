import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import type { ValeurAnnee } from '../../components/AnneeTabs'
import type { ModeleComptable } from '../../lib/engagement'
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
  // Les mises à jour envoyées, dans l'ordre — celle du modèle comptable sur `dossiers` comprise.
  misesAJour: [] as { table: string; valeurs: Record<string, unknown> }[],
  // Une mise à jour refusée par la base : le déclencheur qui verrouille le modèle, par exemple.
  refusMiseAJour: null as string | null,
  // Les suppressions envoyées, avec leurs filtres : c'est ce qui dit QUELLES lignes une régénération
  // retire.
  suppressions: [] as { table: string; filtres: [string, unknown][] }[],
  // Les appels à la fonction SQL de l'affectation (ligne 26.6) — que le faux serveur APPLIQUE : il
  // remplace l'écriture du mouvement, comme la vraie, pour que la relecture la voie.
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.rpcs.push({ nom, args })
      const id = args.p_ligne_bancaire_id
      const ligne = (faux.parTable.lignes_bancaires ?? []).find((l) => (l as { id: string }).id === id) as { date: string } | undefined
      const ecrites = (args.p_ecritures as Record<string, unknown>[]).map((e, i) => ({
        id: `rpc-${faux.rpcs.length}-${i}`, dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: id,
        date: ligne?.date, statut: 'proposee', created_at: '2025-04-02T09:00:00Z', ...e,
      }))
      faux.parTable.ecritures_brouillon = [
        ...(faux.parTable.ecritures_brouillon ?? []).filter((e) => {
          const ecr = e as { piece_id: string | null; ligne_bancaire_id: string | null }
          return !(ecr.piece_id == null && ecr.ligne_bancaire_id === id)
        }),
        ...ecrites,
      ]
      return Promise.resolve({ data: ecrites.length, error: null })
    },
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
      let miseAJour: Record<string, unknown> | null = null
      const filtres: [string, unknown][] = []
      Object.assign(chaine, {
        select: () => chaine,
        delete: () => { suppression = true; return chaine },
        // La mise à jour MORD aussi, comme la suppression : c'est la date que la contrepartie banque
        // réécrit sur les lignes d'une pièce rapprochée (voir lib/contrepartieBanque.ts).
        update: (valeurs: Record<string, unknown>) => { miseAJour = valeurs; return chaine },
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
          if (miseAJour) {
            faux.misesAJour.push({ table, valeurs: miseAJour })
            if (faux.refusMiseAJour) {
              return Promise.resolve({ data: null, error: { message: faux.refusMiseAJour }, count: 0 }).then(suite)
            }
            const vise = (ligne: Record<string, unknown>) => filtres.every(([colonne, valeur]) =>
              colonne.startsWith('!') ? ligne[colonne.slice(1)] !== valeur : ligne[colonne] === valeur)
            faux.parTable[table] = (faux.parTable[table] ?? []).map((l) =>
              vise(l as Record<string, unknown>) ? { ...(l as Record<string, unknown>), ...miseAJour } : l)
            return Promise.resolve({ data: null, error: null, count: 0 }).then(suite)
          }
          if (suppression) {
            faux.suppressions.push({ table, filtres: [...filtres] })
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
  faux.misesAJour = []
  faux.refusMiseAJour = null
  faux.suppressions = []
  faux.rpcs = []
  faux.parTable = {
    categories: [CATEGORIE_ACHATS], pieces: [], ecritures_brouillon: [],
    immobilisations: [], lignes_bancaires: [], declarations_tva: [], a_nouveaux: [],
    ...tables,
  } as Record<string, unknown[]>
}

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

// Le modèle vit dans la page du dossier, qui le remet à l'onglet après l'enregistrement : ce porteur
// joue ce rôle, sans quoi un changement de modèle ne se verrait jamais à l'écran.
function Onglet({ assujettiTva, modeleInitial, annee }: { assujettiTva: boolean; modeleInitial: ModeleComptable; annee: ValeurAnnee }) {
  const [modele, setModele] = useState(modeleInitial)
  return (
    <AnneeProvider defaut={annee}>
      <EcrituresTab
        dossierId="dossier-de-test" dossierNom="Dossier de test" dossierSiret="12345678901234" assujettiTva={assujettiTva}
        modele={modele}
        onModeleUpdated={(m) => setModele((avant) => ({
          mode: m.mode_comptable ?? avant.mode, compteNotesDeFrais: m.compte_notes_de_frais ?? avant.compteNotesDeFrais,
        }))}
      />
    </AnneeProvider>
  )
}

function monter(assujettiTva = false, modele: ModeleComptable = TRESORERIE, annee: ValeurAnnee = 2025) {
  return render(<Onglet assujettiTva={assujettiTva} modeleInitial={modele} annee={annee} />)
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

  it("date au PAIEMENT l'écriture d'une pièce déjà rapprochée, contrepartie comprise", async () => {
    // Une facture de décembre 2024 réglée en janvier 2025 : la 2035 la compte en 2025, et son
    // écriture doit tomber dans le même exercice — charge ET banque, une seule date, une écriture
    // équilibrée dans un seul FEC (lib/rattachement.ts).
    poser({
      pieces: [piece({ id: 'p1', date_piece: '2024-12-20' })],
      ecritures_brouillon: [],
      lignes_bancaires: [{
        id: 'l1', dossier_id: 'dossier-de-test', date: '2025-01-06', libelle: 'PRLV FOURNISSEUR',
        montant: -120, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, prelevement_personnel: false,
        source_fichier: null, libelle_brut: null, created_at: '2025-01-07T09:00:00Z',
      }],
    })
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })

    const dates = (faux.parTable.ecritures_brouillon as { compte: string; date: string }[]).map((e) => [e.compte, e.date])
    expect(dates).toEqual([['606100', '2025-01-06'], ['512000', '2025-01-06']])
  })

  it("répartit l'écriture d'une pièce réglée en partie entre la facture et le paiement", async () => {
    // 120 € dont 48 € rapprochés : la part payée au paiement, le reste à la date de facture. Le
    // rapprochement ne redate pas un paiement partiel, c'est donc la génération qui doit le faire.
    poser({
      pieces: [piece({ id: 'p1', date_piece: '2024-12-20' })],
      ecritures_brouillon: [],
      lignes_bancaires: [{
        id: 'l1', dossier_id: 'dossier-de-test', date: '2025-01-06', libelle: 'PRLV FOURNISSEUR',
        montant: -48, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, prelevement_personnel: false,
        source_fichier: null, libelle_brut: null, created_at: '2025-01-07T09:00:00Z',
      }],
    })
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })

    const charges = (faux.parTable.ecritures_brouillon as { compte: string; date: string; montant: number }[])
      .filter((e) => e.compte === '606100').map((e) => [e.date, e.montant])
    expect(charges).toEqual([['2024-12-20', 72], ['2025-01-06', 48]])
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

// L'OUVERTURE D'UN DOSSIER REPRIS (ligne 29, décision du cabinet du 26/09/2026). Les à-nouveaux ne
// sont pas des écritures du brouillon ; ils ouvrent pourtant le FEC et la piste d'audit de l'exercice
// qu'ils ouvrent. Le format est testé dans `lib/fec.ts` ; ce qui se joue ici est le CÂBLAGE — la
// lecture, le filtre d'exercice, et les deux refus sur une lecture partielle.
describe('EcrituresTab — les à-nouveaux ouvrent les exports de leur exercice', () => {
  function aNouveau(o: Record<string, unknown> = {}) {
    return {
      id: 'an-1', dossier_id: 'dossier-de-test', date: '2025-01-01', compte: '512000', compte_origine: '51210000',
      libelle: 'Banque Populaire', sens: 'debit', montant: 4000, source_nom: 'balance-2024.csv',
      source_empreinte: 'b'.repeat(64), created_at: '2026-09-26T10:00:00Z', ...o,
    }
  }
  const OUVERTURE = [
    aNouveau(),
    aNouveau({ id: 'an-2', compte: '108', compte_origine: '108', libelle: 'Compte de l’exploitant', sens: 'credit' }),
  ]

  it('ouvre le FEC de l’exercice par le journal AN, et le dit à l’écran', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()], a_nouveaux: OUVERTURE })
    monter()

    await screen.findByText(/Exercice ouvert par 2 à-nouveaux au 01\/01\/2025, repris de balance-2024\.csv/)
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t'))
    expect(lignes.slice(1).map((l) => [l[0], l[4]])).toEqual([['AN', '108'], ['AN', '512000'], ['AC', '606100']])
  })

  it('s’exporte même quand l’exercice n’a encore que son ouverture', async () => {
    poser({ a_nouveaux: OUVERTURE })
    monter()

    await screen.findByText(/Exercice ouvert par 2 à-nouveaux/)
    const bouton = screen.getByRole('button', { name: /Exporter FEC/ })
    expect(bouton.hasAttribute('disabled')).toBe(false)
    await act(async () => { bouton.click() })
    expect(telecharge.fichiers[0].contenu.split('\r\n')).toHaveLength(3)
  })

  // GARDE SYMÉTRIQUE : sans elle, « le FEC s'ouvre par ses à-nouveaux » serait satisfait par un
  // écran qui les colle en tête de TOUS les exercices.
  it('ne les met pas dans le FEC d’un autre exercice', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()], a_nouveaux: OUVERTURE.map((a) => ({ ...a, date: '2026-01-01' })) })
    monter()

    await screen.findByText('606100')
    expect(screen.queryAllByText(/Exercice ouvert par/)).toHaveLength(0)
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    expect(telecharge.fichiers[0].contenu).not.toContain('\nAN\t')
  })

  it('les porte dans la piste d’audit, justifiés par la balance et son empreinte', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()], a_nouveaux: OUVERTURE })
    monter()

    await screen.findByText(/Exercice ouvert par 2 à-nouveaux/)
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit/ }).click() })
    const csv = telecharge.fichiers.find((f) => f.nom.startsWith('piste-audit'))!.contenu
    expect(csv).toContain(`2025-01-01;512000;À-nouveau 51210000 Banque Populaire;4000,00;0,00;;;;balance-2024.csv;${'b'.repeat(64)}`)
  })

  it('refuse les deux exports quand l’ouverture n’a été lue qu’à moitié, sans suspendre la génération', async () => {
    // Une pièce validée attend son écriture : la génération n'a aucune raison de s'arrêter pour une
    // ouverture illisible, qu'elle ne lit pas.
    poser({ pieces: [piece()], a_nouveaux: OUVERTURE })
    faux.muetParTable = { a_nouveaux: 1 }
    monter()

    await screen.findByText(/Les à-nouveaux du dossier n'ont pas pu être lus en entier/)
    expect(screen.queryAllByText(/Le brouillon n'a pas pu être lu en entier/)).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Exporter FEC/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Exporter la piste d'audit/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Générer les écritures manquantes/ }).hasAttribute('disabled')).toBe(false)
  })
})

// UN DOSSIER EXONÉRÉ NE VENTILE PAS LA TVA (voir lib/montantRetenu.ts) : sa charge est le TTC, sur
// une seule ligne. Ce que ce test garde, et qu'aucun test de `src/lib` ne peut garder : que l'onglet
// passe SON statut à la génération, à la régénération ET au contrôle des écritures à régénérer.
describe('EcrituresTab — le statut TVA du dossier décide de la ventilation', () => {
  const pieceAvecTva = () => piece({ id: 'p1', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })

  it('un dossier exonéré génère la charge TTC sur une seule ligne, sans 445660', async () => {
    poser({ pieces: [pieceAvecTva()], ecritures_brouillon: [] })
    monter(false)
    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })
    expect(faux.insertions[0].lignes.map((l) => [l.compte, l.montant])).toEqual([['606100', 120]])
  })

  it('un dossier assujetti ventile la TVA en 445660', async () => {
    poser({ pieces: [pieceAvecTva()], ecritures_brouillon: [] })
    monter(true)
    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })
    expect(faux.insertions[0].lignes.map((l) => [l.compte, l.montant])).toEqual([['606100', 100], ['445660', 20]])
  })

  it('sur un dossier exonéré, une TVA encore ventilée est « à régénérer », et la régénération la retire', async () => {
    poser({
      pieces: [pieceAvecTva()],
      ecritures_brouillon: [
        ecriture({ id: 'e1', montant: 100 }),
        ecriture({ id: 'e2', compte: '445660', montant: 20 }),
      ],
    })
    monter(false)
    await screen.findByText('Écritures à régénérer')
    await act(async () => { screen.getByRole('button', { name: 'Régénérer' }).click() })
    expect(faux.insertions.at(-1)!.lignes.map((l) => [l.compte, l.montant])).toEqual([['606100', 120]])
  })

  it('sur un dossier exonéré, la charge TTC sur une seule ligne n’est pas « à régénérer »', async () => {
    // Le garde symétrique : sans lui, le test ci-dessus serait satisfait par un contrôle qui signale
    // toute pièce portant de la TVA.
    poser({ pieces: [pieceAvecTva()], ecritures_brouillon: [ecriture({ id: 'e1', montant: 120 })] })
    monter(false)
    await screen.findByText(/1 écriture proposée/)
    expect(screen.queryByText('Écritures à régénérer')).toBeNull()
  })
})

// L'ÉCRITURE D'UNE PIÈCE PAYÉE EST DATÉE À SON PAIEMENT (lib/rattachement.ts). Le calcul est testé à
// part ; ici c'est le CÂBLAGE — que le contrôle, la régénération et la piste d'audit reçoivent les
// paiements que l'écran a lus.
describe('EcrituresTab — la date du paiement', () => {
  const PAYEE_EN_JANVIER = {
    id: 'l1', dossier_id: 'dossier-de-test', date: '2025-01-06', libelle: 'PRLV FOURNISSEUR',
    montant: -120, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, prelevement_personnel: false,
    source_fichier: null, libelle_brut: null, created_at: '2025-01-07T09:00:00Z',
  }
  const FACTURE_DE_DECEMBRE = piece({ id: 'p1', date_piece: '2024-12-20' })

  it('ne dit pas « à régénérer » une écriture datée à son paiement', async () => {
    poser({
      pieces: [FACTURE_DE_DECEMBRE],
      ecritures_brouillon: [
        ecriture({ id: 'e1', date: '2025-01-06' }),
        ecriture({ id: 'e2', date: '2025-01-06', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }),
      ],
      lignes_bancaires: [PAYEE_EN_JANVIER],
    })
    monter()

    // Ancré sur ce que ce jeu produit forcément une fois chargé : les deux lignes de l'écriture.
    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryAllByText(/à régénérer/)).toHaveLength(0)
  })

  it('régénère au paiement une écriture restée à la date de facture', async () => {
    poser({
      pieces: [FACTURE_DE_DECEMBRE],
      ecritures_brouillon: [
        ecriture({ id: 'e1', date: '2024-12-20' }),
        ecriture({ id: 'e2', date: '2025-01-06', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }),
      ],
      lignes_bancaires: [PAYEE_EN_JANVIER],
    })
    monter(false, TRESORERIE, 'toutes')

    const regenerer = await screen.findByRole('button', { name: /Régénérer/ })
    await act(async () => { regenerer.click() })

    const charges = (faux.parTable.ecritures_brouillon as { compte: string; date: string }[])
      .filter((e) => e.compte === '606100').map((e) => e.date)
    expect(charges).toEqual(['2025-01-06'])
  })

  it("porte la pièce dans la piste d'audit de l'exercice de son paiement", async () => {
    // Sans quoi l'écriture de janvier désignerait un justificatif « hors du jeu chargé », et la
    // piste de décembre le compterait comme un justificatif que rien ne comptabilise.
    poser({
      pieces: [FACTURE_DE_DECEMBRE],
      ecritures_brouillon: [
        ecriture({ id: 'e1', date: '2025-01-06' }),
        ecriture({ id: 'e2', date: '2025-01-06', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }),
      ],
      lignes_bancaires: [PAYEE_EN_JANVIER],
    })
    monter()

    await screen.findByText(/2 écritures proposées/)
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit/ }).click() })
    const csv = telecharge.fichiers.find((f) => f.nom.startsWith('piste-audit'))!.contenu
    expect(csv).not.toMatch(/hors du jeu chargé/)
    expect(csv).toMatch(/facture\.pdf/)
  })
})

// LE MODÈLE COMPTABLE (lib/engagement.ts) se règle dans cet onglet, tant que le brouillon est vide.
describe('EcrituresTab — le modèle comptable', () => {
  it('offre le choix sur un brouillon vide, l’enregistre sur le dossier, et montre alors les comptes de note de frais', async () => {
    poser({})
    monter()

    const engagement = await screen.findByRole('button', { name: 'Engagement (BIC, IS)' })
    expect(screen.getByRole('button', { name: 'Trésorerie (BNC, 2035)' }).getAttribute('aria-pressed')).toBe('true')
    // En trésorerie, rien sur les notes de frais : elles passent face à la banque comme toute pièce.
    expect(screen.queryByText(/Note de frais payée personnellement/)).toBeNull()

    await act(async () => { engagement.click() })
    expect(faux.misesAJour).toEqual([{ table: 'dossiers', valeurs: { mode_comptable: 'engagement' } }])
    expect(engagement.getAttribute('aria-pressed')).toBe('true')

    // Les mots du cabinet, à l'écran.
    await screen.findByText(/Note de frais payée personnellement par le dirigeant/)
    expect(screen.getByText(/Quand la société rembourse le dirigeant, depuis son compte bancaire : débit 455, crédit 512 Banque/)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: /^108 – Compte de l’exploitant/ }).click() })
    expect(faux.misesAJour.at(-1)).toEqual({ table: 'dossiers', valeurs: { compte_notes_de_frais: '108000' } })
  })

  it('n’enregistre rien sur un clic du modèle déjà en place', async () => {
    poser({})
    monter()
    const bouton1 = await screen.findByRole('button', { name: 'Trésorerie (BNC, 2035)' })
    await act(async () => { bouton1.click() })
    expect(faux.misesAJour).toEqual([])
  })

  it('ne l’offre plus quand le brouillon porte des écritures, et dit pourquoi', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()] })
    monter()

    await screen.findByText(/Il ne se change plus : le brouillon porte 1 écriture/)
    expect(screen.queryByRole('button', { name: 'Engagement (BIC, IS)' })).toBeNull()
  })

  it('ne l’offre pas sur une lecture partielle du brouillon — il pourrait porter des écritures qu’on ne voit pas', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()] })
    faux.muetParTable = { ecritures_brouillon: 0 }
    monter()

    await screen.findByText(/Il ne se change pas sur une lecture partielle du brouillon/)
    expect(screen.queryByRole('button', { name: 'Engagement (BIC, IS)' })).toBeNull()
  })

  it("trois clics rapprochés n'enregistrent le modèle qu'une fois", async () => {
    // Trois et non deux : un verrou posé DANS le `try` serait relâché par le `finally` du deuxième.
    poser({})
    monter()
    const engagement = await screen.findByRole('button', { name: 'Engagement (BIC, IS)' })
    await act(async () => { engagement.click(); engagement.click(); engagement.click() })
    expect(faux.misesAJour).toEqual([{ table: 'dossiers', valeurs: { mode_comptable: 'engagement' } }])
  })

  it('le changement de modèle suspend la génération', async () => {
    // Générer pendant que le modèle change écrirait des écritures d'un modèle sous l'étiquette de
    // l'autre — celles que le déclencheur de la base refuse justement de laisser se mélanger.
    poser({ pieces: [piece()], ecritures_brouillon: [] })
    monter()
    const engagement = await screen.findByRole('button', { name: 'Engagement (BIC, IS)' })
    const generer = screen.getByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { engagement.click(); generer.click() })
    expect(faux.misesAJour).toHaveLength(1)
    expect(faux.insertions).toHaveLength(0)
  })

  it('la génération suspend le changement de modèle', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [] })
    monter()
    const engagement = await screen.findByRole('button', { name: 'Engagement (BIC, IS)' })
    const generer = screen.getByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { generer.click(); engagement.click() })
    expect(faux.insertions).toHaveLength(1)
    expect(faux.misesAJour).toEqual([])
  })

  it('dit le refus de la base, et garde le modèle en place', async () => {
    poser({})
    faux.refusMiseAJour = 'Le modèle comptable d’un dossier ne se change que tant que son brouillon d’écritures est vide.'
    monter()

    const bouton2 = await screen.findByRole('button', { name: 'Engagement (BIC, IS)' })

    await act(async () => { bouton2.click() })
    expect(screen.getByText(/ne se change que tant que son brouillon d’écritures est vide/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Trésorerie (BNC, 2035)' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('EcrituresTab — en engagement', () => {
  const REGLEE_EN_JANVIER = {
    id: 'l1', dossier_id: 'dossier-de-test', date: '2025-01-06', libelle: 'PRLV FOURNISSEUR',
    montant: -120, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, prelevement_personnel: false,
    source_fichier: null, libelle_brut: null, created_at: '2025-01-07T09:00:00Z',
  }

  it('génère la facture à SA date et le règlement au mouvement, en une seule écriture de la base', async () => {
    poser({ pieces: [piece({ id: 'p1', date_piece: '2024-12-20' })], ecritures_brouillon: [], lignes_bancaires: [REGLEE_EN_JANVIER] })
    monter(false, ENGAGEMENT)

    const bouton3 = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })

    await act(async () => { bouton3.click() })

    // Une seule insertion : la contrepartie de la trésorerie n'est pas appelée en plus — elle
    // doublerait la banque.
    expect(faux.insertions).toHaveLength(1)
    const lignes = (faux.parTable.ecritures_brouillon as { compte: string; sens: string; date: string; ligne_bancaire_id?: string }[])
      .map((e) => [e.compte, e.sens, e.date, e.ligne_bancaire_id ?? null])
    expect(lignes).toEqual([
      ['606100', 'debit', '2024-12-20', null],
      ['401000', 'credit', '2024-12-20', null],
      ['401000', 'debit', '2025-01-06', 'l1'],
      ['512000', 'credit', '2025-01-06', 'l1'],
    ])
  })

  it('ne dit pas « à régénérer » les écritures qu’il vient de générer, et compte une facture sans règlement', async () => {
    poser({ pieces: [piece({ id: 'p1', date_piece: '2024-12-20' })], ecritures_brouillon: [], lignes_bancaires: [] })
    monter(false, ENGAGEMENT, 'toutes')

    const bouton4 = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })

    await act(async () => { bouton4.click() })
    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryAllByText(/à régénérer/)).toHaveLength(0)
    expect(screen.getByText('1 facture sans règlement rapproché')).toBeTruthy()
  })

  it('régénère TOUT — la facture et ses règlements — quand une pièce devient note de frais', async () => {
    // Le règlement passé au 401 doit suivre la dette au 455 : sinon le 401 garderait un débit sans
    // facture, et le 455 un crédit que rien ne solde.
    poser({
      pieces: [piece({ id: 'p1', date_piece: '2024-12-20', type_piece: 'note_frais' })],
      ecritures_brouillon: [
        ecriture({ id: 'e1', date: '2024-12-20' }),
        ecriture({ id: 'e2', date: '2024-12-20', compte: '401000', sens: 'credit' }),
        ecriture({ id: 'e3', date: '2025-01-06', compte: '401000', sens: 'debit', ligne_bancaire_id: 'l1' }),
        ecriture({ id: 'e4', date: '2025-01-06', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }),
      ],
      lignes_bancaires: [REGLEE_EN_JANVIER],
    })
    monter(false, ENGAGEMENT, 'toutes')

    const bouton5 = await screen.findByRole('button', { name: /Régénérer/ })

    await act(async () => { bouton5.click() })

    // Toutes les lignes de la pièce, sans le filtre de la trésorerie qui épargne la banque.
    expect(faux.suppressions).toEqual([{ table: 'ecritures_brouillon', filtres: [['piece_id', 'p1']] }])
    const lignes = (faux.parTable.ecritures_brouillon as { compte: string; sens: string }[]).map((e) => [e.compte, e.sens])
    expect(lignes).toEqual([['606100', 'debit'], ['455000', 'credit'], ['455000', 'debit'], ['512000', 'credit']])
  })

  it('exporte un FEC où le règlement a son journal de banque et le fournisseur son compte auxiliaire', async () => {
    poser({
      pieces: [piece({ id: 'p1', date_piece: '2025-03-10' })],
      ecritures_brouillon: [
        ecriture({ id: 'e1' }),
        ecriture({ id: 'e2', compte: '401000', sens: 'credit' }),
        ecriture({ id: 'e3', date: '2025-04-02', compte: '401000', sens: 'debit', ligne_bancaire_id: 'l1' }),
        ecriture({ id: 'e4', date: '2025-04-02', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }),
      ],
      lignes_bancaires: [{ ...REGLEE_EN_JANVIER, date: '2025-04-02' }],
    })
    monter(false, ENGAGEMENT)

    await screen.findByText(/4 écritures proposées/)
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const fec = telecharge.fichiers.find((f) => f.nom.includes('FEC'))!.contenu
    expect(fec).toMatch(/^BQ\tBanque\tBQ00001\t20250402\t401000\tFournisseurs\tFFOURNISSEUR\tFOURNISSEUR MARSEILLE\t/m)
    expect(fec).toMatch(/^AC\tAchats\tAC00001\t20250310\t606100\t/m)
  })

  it('nomme la dette et les règlements dans la confirmation de retrait d’une facture immobilisée', async () => {
    const messages: string[] = []
    vi.stubGlobal('confirm', (m: string) => { messages.push(m); return false })
    poser({
      pieces: [piece()],
      ecritures_brouillon: [ecriture({ id: 'e1' }), ecriture({ id: 'e2', compte: '401000', sens: 'credit' })],
      immobilisations: [{ id: 'i1', dossier_id: 'dossier-de-test', piece_id: 'p1' }],
    })
    monter(false, ENGAGEMENT)

    const bouton6 = await screen.findByRole('button', { name: /Retirer l'écriture/ })

    await act(async () => { bouton6.click() })
    expect(messages[0]).toMatch(/sa dette envers le fournisseur et ses règlements partent ensemble/)
    expect(messages[0]).not.toMatch(/contrepartie banque/)
  })
})

describe('EcrituresTab — la régénération', () => {
  it('se suspend sur une lecture partielle : elle daterait mal, ou retirerait des règlements', async () => {
    poser({
      pieces: [piece({ montant_ttc: 150 })],
      ecritures_brouillon: [ecriture()],
      lignes_bancaires: [{
        id: 'l1', dossier_id: 'dossier-de-test', date: '2025-03-12', libelle: 'PRLV', montant: -150, statut: 'rapprochee',
        piece_id: 'p1', cotisation_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
        created_at: '2025-03-12T09:00:00Z',
      }],
    })
    faux.muetParTable = { lignes_bancaires: 0 }
    monter()

    const bouton = await screen.findByRole('button', { name: /Régénérer/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.suppressions).toEqual([])
    expect(faux.insertions).toEqual([])
  })

  it('régénère sur une lecture complète — le garde symétrique', async () => {
    poser({ pieces: [piece({ montant_ttc: 150 })], ecritures_brouillon: [ecriture()] })
    monter()

    const bouton7 = await screen.findByRole('button', { name: /Régénérer/ })

    await act(async () => { bouton7.click() })
    expect(faux.insertions).toHaveLength(1)
  })

  it("deux clics rapprochés ne régénèrent qu'une fois", async () => {
    poser({ pieces: [piece({ montant_ttc: 150 })], ecritures_brouillon: [ecriture()] })
    monter()

    const bouton = await screen.findByRole('button', { name: /Régénérer/ })
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.suppressions).toHaveLength(1)
    expect(faux.insertions).toHaveLength(1)
  })
})

// Le compte d'une catégorie est le seul compte que l'application laisse taper à la main, et il part
// tel quel dans chaque écriture puis dans le FEC. L'outil de contrôle de la DGFiP refuse un CompteNum
// dont les trois premiers caractères ne sont pas des chiffres.
describe('EcrituresTab — un compte saisi commence par trois chiffres', () => {
  const CATEGORIE_LIBRE = {
    id: 'cat-libre', dossier_id: null, code: 'sans_suggestion', libelle: 'Catégorie libre',
    ordre: 2, compte_comptable: null, poste_2035: 'Achats',
  }

  async function saisir(valeur: string) {
    const champ = await screen.findByPlaceholderText('ex. 606100')
    await act(async () => { fireEvent.change(champ, { target: { value: valeur } }) })
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
  }

  it('refuse un compte qui ne commence pas par trois chiffres, et le dit', async () => {
    poser({ categories: [CATEGORIE_LIBRE], pieces: [piece({ categorie_id: 'cat-libre' })] })
    monter()

    await saisir('Honoraires')
    expect(screen.getByText(/« Honoraires » n'est pas un numéro de compte/)).toBeTruthy()
    expect(faux.misesAJour).toEqual([])
  })

  // GARDE SYMÉTRIQUE : sans lui, « refuse un compte mal formé » serait satisfait par un champ qui
  // refuse tout. Les espaces tapées disparaissent, et le refus précédent ne reste pas affiché.
  it('enregistre un compte bien formé, sans ses espaces, et efface le refus précédent', async () => {
    poser({ categories: [CATEGORIE_LIBRE], pieces: [piece({ categorie_id: 'cat-libre' })] })
    monter()

    // Des chiffres, mais pas en tête : c'est le début du numéro que la DGFiP contrôle.
    await saisir('C606')
    expect(screen.getByText(/« C606 » n'est pas un numéro de compte/)).toBeTruthy()
    await saisir(' 622 600 ')
    expect(faux.misesAJour).toEqual([{ table: 'categories', valeurs: { compte_comptable: '622600' } }])
    expect(screen.queryAllByText(/n'est pas un numéro de compte/)).toHaveLength(0)
  })
})

// LIGNE 26.6 : un mouvement du relevé affecté à une catégorie porte une écriture SANS pièce. Ce que ce
// bloc garde et qu'aucun test de `src/lib` ne peut voir : que l'onglet lise les mouvements affectés
// (et pas seulement ceux d'une pièce), donc qu'il ne crie pas à la rupture sur ces écritures, qu'il
// les porte au FEC et à la piste d'audit, et qu'il sache les réécrire quand leur catégorie change.
describe('EcrituresTab — les mouvements affectés sans justificatif', () => {
  const FRAIS = {
    id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 70,
    compte_comptable: '627000', poste_2035: 'Frais financiers',
  }
  function mouvement(o: Record<string, unknown> = {}) {
    return {
      id: 'l-frais', dossier_id: 'dossier-de-test', date: '2025-03-31', libelle: 'FRAIS TENUE DE COMPTE', montant: -8.5,
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: 'cat-frais', prelevement_personnel: false,
      source_fichier: 'releve-mars-2025.pdf', libelle_brut: null, created_at: '2025-04-02T09:00:00Z', ...o,
    }
  }
  const ECRITURE_FRAIS = [
    ecriture({ id: 'm1', piece_id: null, ligne_bancaire_id: 'l-frais', date: '2025-03-31', compte: '627000', sens: 'debit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' }),
    ecriture({ id: 'm2', piece_id: null, ligne_bancaire_id: 'l-frais', date: '2025-03-31', compte: '512000', sens: 'credit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' }),
  ]

  it('ne crie pas à la rupture, et porte l’écriture au FEC, au journal de banque, le relevé pour pièce', async () => {
    poser({ categories: [CATEGORIE_ACHATS, FRAIS], lignes_bancaires: [mouvement()], ecritures_brouillon: ECRITURE_FRAIS })
    monter()
    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryByText("Piste d'audit rompue")).toBeNull()
    expect(screen.queryByText(/pas dans ce FEC/)).toBeNull()
    expect(screen.queryByText('Mouvements affectés à réaffecter')).toBeNull()

    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t')).slice(1)
    expect(lignes.map((l) => [l[0], l[2], l[8], l[9]])).toEqual([
      ['BQ', 'BQ00001', 'releve-mars-2025.pdf', '20250331'],
      ['BQ', 'BQ00001', 'releve-mars-2025.pdf', '20250331'],
    ])
    expect(lignes.map((l) => l[4]).sort()).toEqual(['512000', '627000'])
  })

  it('le garde symétrique : sans affectation, les mêmes écritures sont une rupture et sortent du FEC', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, FRAIS],
      lignes_bancaires: [mouvement({ categorie_id: null, statut: 'non_rapprochee' })],
      ecritures_brouillon: ECRITURE_FRAIS,
    })
    monter()
    expect(await screen.findByText("Piste d'audit rompue")).toBeTruthy()
    expect(screen.getByText(/2 écritures ne seront pas dans ce FEC/)).toBeTruthy()
  })

  it('donne le relevé pour justificatif dans la piste d’audit', async () => {
    poser({ categories: [CATEGORIE_ACHATS, FRAIS], lignes_bancaires: [mouvement()], ecritures_brouillon: ECRITURE_FRAIS })
    monter()
    await screen.findByText(/2 écritures proposées/)
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit/ }).click() })
    const csv = telecharge.fichiers.find((f) => f.nom.startsWith('piste-audit'))!.contenu
    expect(csv).toMatch(/Relevé bancaire : releve-mars-2025\.pdf/)
    expect(csv).not.toMatch(/;justificatif(\r\n|$)/)
  })

  it('propose de réaffecter un mouvement dont la catégorie a changé de compte, et le réécrit par la base', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...FRAIS, compte_comptable: '627100' }],
      lignes_bancaires: [mouvement()],
      ecritures_brouillon: ECRITURE_FRAIS,
    })
    monter()
    expect(await screen.findByText('Mouvements affectés à réaffecter')).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Réaffecter' }).click() })
    expect(faux.rpcs).toEqual([{
      nom: 'affecter_mouvement_bancaire',
      args: {
        p_ligne_bancaire_id: 'l-frais',
        p_categorie_id: 'cat-frais',
        p_ecritures: [
          { compte: '627100', sens: 'debit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
          { compte: '512000', sens: 'credit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
        ],
      },
    }])
    // Relue, l'écriture suit la catégorie : le panneau disparaît.
    await waitFor(() => expect(screen.queryByText('Mouvements affectés à réaffecter')).toBeNull())
  })

  it("deux clics rapprochés ne réaffectent qu'une fois", async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...FRAIS, compte_comptable: '627100' }],
      lignes_bancaires: [mouvement()],
      ecritures_brouillon: ECRITURE_FRAIS,
    })
    monter()
    const bouton = await screen.findByRole('button', { name: 'Réaffecter' })
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
  })

  it('ne propose pas de réaffecter sur une catégorie sortie des comptes de résultat, et dit où aller', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...FRAIS, compte_comptable: '108000' }],
      lignes_bancaires: [mouvement()],
      ecritures_brouillon: ECRITURE_FRAIS,
    })
    monter()
    const bouton = await screen.findByRole('button', { name: 'Réaffecter' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toMatch(/choisis une autre catégorie dans Banque/)
  })
})

describe('EcrituresTab — ce que le FEC ne contiendra pas, bien accordé', () => {
  // L'alerte s'écrivait « ne seraont pas dans ce FEC » au pluriel : une faute dans le message qui
  // dit ce que le fichier fiscal ne contiendra pas le fait passer pour une négligence.
  it('au singulier comme au pluriel', async () => {
    poser({ ecritures_brouillon: [ecriture({ id: 'o1', piece_id: null })] })
    const { unmount } = monter()
    expect(await screen.findByText(/^1 écriture ne sera pas dans ce FEC/)).toBeTruthy()
    unmount()
    poser({ ecritures_brouillon: [ecriture({ id: 'o1', piece_id: null }), ecriture({ id: 'o2', piece_id: null })] })
    monter()
    expect(await screen.findByText(/^2 écritures ne seront pas dans ce FEC/)).toBeTruthy()
  })
})
