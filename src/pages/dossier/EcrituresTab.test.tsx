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
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        is: () => chaine,
        not: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          const toutes = faux.parTable[table] ?? []
          const demande = fin - debut + 1
          const taille = faux.plafond == null ? demande : Math.min(demande, faux.plafond)
          const rendu = faux.muetApres == null
            ? toutes.slice(debut, debut + taille)
            : toutes.slice(debut, Math.min(debut + taille, faux.muetApres))
          return Promise.resolve({ data: rendu, error: null, count: toutes.length }).then(suite)
        },
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
    expect(screen.getByText(/La charge est comptée deux fois/)).toBeDefined()
    // Et les trois contrôles qui partent de la pièce ne disent rien : c'est bien lui, et lui seul
    // qui voit cette charge. Les badges du pied de page sont le signal le plus court de leur
    // silence — `queryByText` lit le TEXTE rendu, jamais le balisage.
    expect(screen.queryByText('Écritures à régénérer')).toBeNull()
    expect(screen.queryByText(/à régénérer$/)).toBeNull()
    expect(screen.queryByText(/déséquilibrée/)).toBeNull()
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
