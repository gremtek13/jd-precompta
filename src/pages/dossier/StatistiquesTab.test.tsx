import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import StatistiquesTab from './StatistiquesTab'

// « Une recherche filtre l'affichage, jamais un total » — la règle que cet écran a violée : ses
// totaux débit/crédit portaient sur les lignes TROUVÉES, si bien que taper « 606 » affichait le
// badge rouge « écart … », celui qui signale normalement un brouillon cassé. Une recherche ne doit
// jamais fabriquer une alerte.
//
// Le test vise donc le PIED du tableau autant que son corps : c'est leur divergence qui est la
// règle (moins de lignes, mêmes totaux).
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  // Plafond du serveur : nombre maximum de lignes rendues par requête, quoi qu'on demande. C'est le
  // « Max rows » de PostgREST, qui ne se signale pas (voir lib/lectureComplete.ts).
  plafond: null as number | null,
  // Les tables dont la lecture est refusée, avec le message rendu.
  erreurs: {} as Record<string, string>,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      // Le faux client honore `range` et annonce un `count` : la lecture par tranches ne prouverait
      // rien contre un serveur qui rend tout d'un coup quoi qu'on lui demande.
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: { data: unknown[] | null; error: { message: string } | null; count: number | null }) => unknown) => {
          if (faux.erreurs[table]) {
            return Promise.resolve({ data: null, error: { message: faux.erreurs[table] }, count: null }).then(suite)
          }
          const toutes = faux.parTable[table] ?? []
          const demande = fin - debut + 1
          const taille = faux.plafond == null ? demande : Math.min(demande, faux.plafond)
          return Promise.resolve({
            data: toutes.slice(debut, debut + taille),
            error: null,
            count: toutes.length,
          }).then(suite)
        },
      })
      return chaine
    },
  },
}))

function ecriture(compte: string, sens: 'debit' | 'credit', montant: number, date = '2025-03-10') {
  return {
    id: `${compte}-${sens}-${date}`, dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: null,
    date, compte, libelle: 'Écriture de test', montant, sens,
    statut: 'brouillon', created_at: '2025-03-10T00:00:00Z',
  }
}

function piedDuTableau(): HTMLTableRowElement {
  const pied = document.querySelector('tfoot tr')
  if (!pied) throw new Error('Pied de tableau introuvable — la balance ne s’est pas affichée.')
  return pied as HTMLTableRowElement
}

beforeEach(() => {
  faux.erreurs = {}
  faux.parTable.a_nouveaux = []
})

describe('StatistiquesTab — Balance des comptes', () => {
  it("recolle les tranches quand le serveur plafonne, sans fabriquer d'écart", async () => {
    // Le serveur ne rend qu'une écriture à la fois. Lue en une seule requête, la balance n'aurait
    // que le débit — donc le badge rouge « écart », celui qui signale un brouillon cassé. C'est le
    // plafond de PostgREST, qui ne se signale pas.
    faux.plafond = 1
    faux.parTable.ecritures_brouillon = [
      ecriture('606100', 'debit', 120),
      ecriture('512000', 'credit', 120),
    ]
    faux.parTable.categories = []
    faux.parTable.pieces = []

    render(
      <AnneeProvider defaut="toutes">
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} />
      </AnneeProvider>,
    )

    await screen.findByText('606100')
    expect(screen.getByText('512000')).toBeDefined()
    expect(piedDuTableau().children[3].textContent).toContain('équilibré')
    expect(screen.queryByText(/lecture partielle|n'ont pas pu être lues/)).toBeNull()
  })

  it('réduit les lignes affichées sans toucher aux totaux ni fabriquer un écart', async () => {
    faux.plafond = null
    faux.parTable.ecritures_brouillon = [
      ecriture('606100', 'debit', 120),
      ecriture('512000', 'credit', 120),
    ]
    faux.parTable.categories = []
    faux.parTable.pieces = []

    render(
      <AnneeProvider defaut="toutes">
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} />
      </AnneeProvider>,
    )

    await screen.findByText('606100')
    // `children` compte les cellules, pas les colonnes : le premier `td` du pied porte colSpan={3},
    // donc débit, crédit et badge sont en 1, 2 et 3.
    const totauxAvant = [piedDuTableau().children[1].textContent, piedDuTableau().children[2].textContent]
    expect(piedDuTableau().children[3].textContent).toContain('équilibré')

    const champ = screen.getByRole('searchbox', { name: /Rechercher un numéro/ })
    await act(async () => { fireEvent.change(champ, { target: { value: '606' } }) })

    // Le corps se réduit…
    expect(screen.getByText('606100')).toBeDefined()
    expect(screen.queryByText('512000')).toBeNull()
    expect(screen.getByText('1 sur 2')).toBeDefined()

    // …et le pied ne bouge pas d'un centime, badge compris.
    const pied = piedDuTableau()
    expect(pied.children[0].textContent).toBe('Total (tous les comptes)')
    expect([pied.children[1].textContent, pied.children[2].textContent]).toEqual(totauxAvant)
    expect(pied.children[3].textContent).toContain('équilibré')
    expect(pied.children[3].textContent).not.toContain('écart')
  })
})

// LES CATÉGORIES LUES EN PARTIE LE DISENT — à part des écritures, parce que la conséquence n'est pas
// la même. Elles ne donnent que les LIBELLÉS des comptes : aucun montant n'en dépend, et le bandeau
// des totaux doit se taire. Leur drapeau était jeté : `brouillon.motif ?? lecturePieces.motif`
// oubliait la troisième lecture du même `Promise.all([…]).then(…)`, forme que le scanner ne voyait pas.
describe('StatistiquesTab — les catégories du cabinet', () => {
  it('lues en partie, elles le disent, sans allumer le bandeau des totaux', async () => {
    faux.plafond = null
    faux.erreurs = { categories: 'refus simulé' }
    faux.parTable.ecritures_brouillon = [ecriture('606100', 'debit', 120), ecriture('512000', 'credit', 120)]
    faux.parTable.categories = []
    faux.parTable.pieces = []

    render(
      <AnneeProvider defaut="toutes">
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} />
      </AnneeProvider>,
    )

    await screen.findByText('606100')
    expect(screen.getByText(/Les catégories du cabinet n'ont pas pu être lues en entier \(lecture interrompue après 0 ligne\(s\) : refus simulé\)/)).toBeTruthy()
    expect(screen.queryAllByText(/Les écritures du brouillon n'ont pas pu être lues/)).toHaveLength(0)
    expect(piedDuTableau().children[3].textContent).toContain('équilibré')
  })
})

// L'OUVERTURE D'UN DOSSIER REPRIS (ligne 29, décision du cabinet du 26/09/2026). Les à-nouveaux
// appartiennent à l'exercice qu'ils ouvrent, comme toute écriture à celui de sa date : la balance de
// cet exercice les compte, celle d'un autre non. Le calcul est dans `lib/ecritures.ts`, testé ; ce
// qui se joue ici est le CÂBLAGE — la lecture, le filtre d'exercice, et ce que l'écran en dit.
describe('StatistiquesTab — les à-nouveaux', () => {
  function aNouveau(compte: string, libelle: string, sens: 'debit' | 'credit', montant: number) {
    return {
      id: `an-${compte}`, dossier_id: 'dossier-de-test', date: '2026-01-01', compte, compte_origine: compte,
      libelle, sens, montant, source_nom: 'balance-2025.csv', source_empreinte: 'a'.repeat(64),
      created_at: '2026-09-26T10:00:00Z',
    }
  }
  const OUVERTURE = [
    aNouveau('512000', 'Banque Populaire', 'debit', 4000),
    aNouveau('2183', 'Matériel informatique', 'debit', 2000),
    aNouveau('164', 'Emprunts', 'credit', 2000),
    aNouveau('108', 'Compte de l’exploitant', 'credit', 4000),
  ]

  function monter(annee: number | 'toutes') {
    faux.plafond = null
    faux.parTable.categories = []
    faux.parTable.pieces = []
    faux.parTable.a_nouveaux = OUVERTURE
    render(
      <AnneeProvider defaut={annee}>
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} />
      </AnneeProvider>,
    )
  }

  function ligneDuCompte(compte: string): string[] {
    const cellule = screen.getByText(compte)
    return [...cellule.closest('tr')!.children].map((c) => c.textContent ?? '')
  }

  it('les compte dans la balance de l’exercice qu’ils ouvrent, et le dit', async () => {
    faux.parTable.ecritures_brouillon = [
      ecriture('606100', 'debit', 120, '2026-03-10'),
      ecriture('512000', 'credit', 120, '2026-03-10'),
    ]
    monter(2026)

    await screen.findByText('164')
    expect(ligneDuCompte('164').slice(1, 3)).toEqual(['Emprunts', '1'])
    // La banque garde son nom d'application et additionne l'ouverture et le mouvement de mars.
    const banque = ligneDuCompte('512000')
    expect(banque[1]).toBe('Banque')
    expect(banque[2]).toBe('2')
    expect(banque[5]).toMatch(/^3\s?880,00\s€ débiteur$/)
    expect(screen.getByText(/Les à-nouveaux du 01\/01\/2026, repris de balance-2025\.csv, sont compris dans les totaux/)).toBeTruthy()
    expect(piedDuTableau().children[3].textContent).toContain('équilibré')
  })

  // GARDE SYMÉTRIQUE : sans elle, « les à-nouveaux entrent dans la balance » serait satisfait par un
  // écran qui les ajoute à tous les exercices.
  it('ne les compte pas dans la balance d’un autre exercice', async () => {
    faux.parTable.ecritures_brouillon = [
      ecriture('606100', 'debit', 120, '2025-03-10'),
      ecriture('512000', 'credit', 120, '2025-03-10'),
    ]
    monter(2025)

    await screen.findByText('606100')
    expect(screen.queryAllByText('164')).toHaveLength(0)
    expect(screen.queryAllByText(/sont compris dans les totaux/)).toHaveLength(0)
  })

  it('prévient, toutes années confondues, qu’une écriture antérieure à l’ouverture compte deux fois', async () => {
    faux.parTable.ecritures_brouillon = [
      ecriture('606100', 'debit', 120, '2025-03-10'),
      ecriture('512000', 'credit', 120, '2025-03-10'),
    ]
    monter('toutes')

    await screen.findByText('164')
    expect(screen.getByText(/2 écritures du brouillon précèdent l’ouverture du 01\/01\/2026/)).toBeTruthy()
  })

  it('se tait, toutes années confondues, quand rien ne précède l’ouverture', async () => {
    faux.parTable.ecritures_brouillon = [
      ecriture('606100', 'debit', 120, '2026-03-10'),
      ecriture('512000', 'credit', 120, '2026-03-10'),
    ]
    monter('toutes')

    await screen.findByText('164')
    expect(screen.queryAllByText(/précèden?t? l’ouverture/)).toHaveLength(0)
  })

  // Le double compte n'existe que TOUTES ANNÉES CONFONDUES : une balance d'exercice ne lit que les
  // écritures de son année, donc celles d'avant l'ouverture n'y sont pas. Le dire là crierait au loup
  // sur l'écran même où le cabinet vient lire une balance juste.
  it('se tait sur un exercice choisi, même quand une écriture précède l’ouverture', async () => {
    faux.parTable.ecritures_brouillon = [
      ecriture('606100', 'debit', 120, '2025-03-10'),
      ecriture('512000', 'credit', 120, '2025-03-10'),
    ]
    monter(2026)

    await screen.findByText('164')
    expect(screen.queryAllByText(/précèden?t? l’ouverture/)).toHaveLength(0)
  })

  it('dit, à part du brouillon, qu’une ouverture lue à moitié fausse les totaux', async () => {
    faux.parTable.ecritures_brouillon = [ecriture('606100', 'debit', 120, '2026-03-10'), ecriture('512000', 'credit', 120, '2026-03-10')]
    faux.erreurs = { a_nouveaux: 'refus simulé' }
    monter(2026)

    expect(await screen.findByText(/Les à-nouveaux du dossier n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.queryAllByText(/Les écritures du brouillon n'ont pas pu être lues/)).toHaveLength(0)
  })
})

