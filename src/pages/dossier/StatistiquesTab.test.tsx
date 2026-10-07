import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import StatistiquesTab from './StatistiquesTab'
import type { ANouveau, EcritureBrouillon, ModeComptable, Piece } from '../../lib/types'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../../test/ecritures'

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
  // Les appels de fonction reçus, et ce que la fonction répond : par défaut, `lettrer_pieces` écrit ses lignes comme
  // la base, pour que la relecture qui suit voie le lettrage.
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  rpc: null as null | ((nom: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }),
  // Les suppressions reçues, avec leurs filtres ; `retraitRefuse` simule une suppression que la RLS ne laisse toucher à rien.
  retraits: [] as { table: string; filtres: Record<string, unknown> }[],
  retraitRefuse: false,
  // Une relecture retenue : tant que `attente` n'est pas résolue, les lectures attendent, et `lecturesRetenues` dit
  // qu'elles sont parties — c'est ce qui laisse voir l'écran PENDANT la relecture qui suit un lettrage.
  attente: null as Promise<void> | null,
  lecturesRetenues: 0,
  // Les exercices validés que la page du dossier fournit à ses onglets (DossierDetail).
  valides: [] as number[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      if (faux.rpc) return Promise.resolve(faux.rpc(nom, args))
      if (nom === 'lettrer_pieces') {
        const groupe = `g-${faux.appels.length}`
        faux.parTable.lettrages_manuels = [
          ...(faux.parTable.lettrages_manuels ?? []),
          ...(args.p_pieces as string[]).map((id) => ({
            id: `${groupe}-${id}`, dossier_id: args.p_dossier_id, groupe, piece_id: id, compte: args.p_compte,
            created_at: '2026-04-15T10:00:00Z',
          })),
        ]
        return Promise.resolve({ data: groupe, error: null })
      }
      return Promise.resolve({ data: null, error: { message: `fonction inconnue : ${nom}` } })
    },
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      // Le faux client honore `range` et annonce un `count` : la lecture par tranches ne prouverait
      // rien contre un serveur qui rend tout d'un coup quoi qu'on lui demande.
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      let suppression = false
      const filtres: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        delete: () => { suppression = true; return chaine },
        eq: (colonne: string, valeur: unknown) => { filtres[colonne] = valeur; return chaine },
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: { data: unknown[] | null; error: { message: string } | null; count: number | null }) => unknown) => {
          if (suppression) {
            faux.retraits.push({ table, filtres })
            const toutes = (faux.parTable[table] ?? []) as Record<string, unknown>[]
            const visees = faux.retraitRefuse ? [] : toutes.filter((r) => Object.entries(filtres).every(([c, v]) => r[c] === v))
            faux.parTable[table] = toutes.filter((r) => !visees.includes(r))
            return Promise.resolve({ data: null, error: null, count: visees.length }).then(suite)
          }
          if (faux.erreurs[table]) {
            return Promise.resolve({ data: null, error: { message: faux.erreurs[table] }, count: null }).then(suite)
          }
          if (faux.attente) faux.lecturesRetenues += 1
          return (faux.attente ?? Promise.resolve()).then(() => {
            const toutes = faux.parTable[table] ?? []
            const demande = fin - debut + 1
            const taille = faux.plafond == null ? demande : Math.min(demande, faux.plafond)
            return { data: toutes.slice(debut, debut + taille), error: null, count: toutes.length }
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
  faux.parTable.lettrages_manuels = []
  faux.appels = []
  faux.rpc = null
  faux.retraits = []
  faux.retraitRefuse = false
  faux.attente = null
  faux.lecturesRetenues = 0
  faux.valides = []
  faux.parTable.soldes_reportes = []
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
      <ContexteDossier valides={faux.valides} annee="toutes">
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} modeComptable="tresorerie" />
      </ContexteDossier>,
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
      <ContexteDossier valides={faux.valides} annee="toutes">
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} modeComptable="tresorerie" />
      </ContexteDossier>,
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
      <ContexteDossier valides={faux.valides} annee="toutes">
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} modeComptable="tresorerie" />
      </ContexteDossier>,
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
      <ContexteDossier valides={faux.valides} annee={annee}>
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} modeComptable="tresorerie" />
      </ContexteDossier>,
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

  // Toutes années confondues, la reprise est comprise aussi — et le dire ne dépend d'aucun exercice choisi.
  it('dit, toutes années confondues, que la reprise est comprise dans les totaux', async () => {
    faux.parTable.ecritures_brouillon = [ecriture('606100', 'debit', 120, '2026-03-10'), ecriture('512000', 'credit', 120, '2026-03-10')]
    monter('toutes')

    await screen.findByText('164')
    expect(screen.getByText(/Les à-nouveaux du 01\/01\/2026, repris de balance-2025\.csv, sont compris dans les totaux/)).toBeTruthy()
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


// LE REPORT DES SOLDES (ligne 34, décision du cabinet du 06/10/2026). La validation d'un exercice écrit l'ouverture du
// suivant : sa balance compte ces soldes reportés comme celle de l'exercice repris compte la reprise. Tant qu'un exercice
// n'est pas validé, le suivant n'a pas d'ouverture, et l'écran le dit. Le calcul est dans lib/reportDesSoldes.ts ; ce qui
// se joue ici est le CÂBLAGE — la lecture, l'exercice qu'ils ouvrent, ce que l'écran en dit.
describe('StatistiquesTab — les soldes reportés', () => {
  function reporte(compte: string, libelle: string, sens: 'debit' | 'credit', montant: number) {
    return {
      id: `sr-${compte}`, dossier_id: 'dossier-de-test', date: '2026-01-01', compte, libelle, sens, montant,
      source_nom: 'Exercice 2025 validé', source_empreinte: 'c'.repeat(64), created_at: '2026-03-01T10:00:00Z',
      compte_lib: null, ecriture_lib: null,
    }
  }
  const REPORT = [reporte('512000', 'Banque', 'debit', 2800), reporte('101000', 'Capital individuel', 'credit', 2800)]
  const ECRITURES_2025 = [ecriture('706000', 'credit', 3000, '2025-05-10'), ecriture('512000', 'debit', 3000, '2025-05-10')]
  const ECRITURES_2026 = [ecriture('606100', 'debit', 120, '2026-03-10'), ecriture('512000', 'credit', 120, '2026-03-10')]

  function monter(annee: number | 'toutes', valides: number[] = [2025], reportes: unknown[] = REPORT) {
    faux.plafond = null
    faux.parTable.categories = []
    faux.parTable.pieces = []
    faux.parTable.soldes_reportes = reportes
    faux.valides = valides
    render(
      <ContexteDossier valides={faux.valides} annee={annee}>
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} modeComptable="tresorerie" />
      </ContexteDossier>,
    )
  }

  function ligneDuCompte(compte: string): string[] {
    const cellule = screen.getByText(compte)
    return [...cellule.closest('tr')!.children].map((c) => c.textContent ?? '')
  }

  it('les compte dans la balance de l’exercice qu’ils ouvrent, et le dit', async () => {
    faux.parTable.ecritures_brouillon = [...ECRITURES_2025, ...ECRITURES_2026]
    monter(2026)

    await screen.findByText('101000')
    expect(ligneDuCompte('101000').slice(1, 3)).toEqual(['Capital individuel', '1'])
    // La banque additionne l'ouverture reportée et le mouvement de mars.
    expect(ligneDuCompte('512000')[5]).toMatch(/^2\s?680,00\s€ débiteur$/)
    expect(screen.getByText('Les soldes reportés de l’exercice 2025 validé sont compris dans les totaux : ils ouvrent l’exercice 2026 au 01/01/2026.')).toBeTruthy()
    expect(piedDuTableau().children[3].textContent).toContain('équilibré')
  })

  // GARDE SYMÉTRIQUE : toutes années confondues, les écritures de l'exercice validé sont déjà dans les totaux ; ses soldes
  // reportés les compteraient une seconde fois.
  it('ne les compte pas toutes années confondues', async () => {
    faux.parTable.ecritures_brouillon = [...ECRITURES_2025, ...ECRITURES_2026]
    monter('toutes')

    await screen.findByText('706000')
    expect(screen.queryAllByText('101000')).toHaveLength(0)
    expect(ligneDuCompte('512000')[5]).toMatch(/^2\s?880,00\s€ débiteur$/)
    expect(screen.queryAllByText(/soldes reportés/)).toHaveLength(0)
  })

  it('ne les compte pas dans la balance de l’exercice validé qui les a écrits', async () => {
    faux.parTable.ecritures_brouillon = [...ECRITURES_2025, ...ECRITURES_2026]
    monter(2025)

    await screen.findByText('706000')
    expect(screen.queryAllByText('101000')).toHaveLength(0)
    expect(screen.queryAllByText(/soldes reportés|n’a pas encore d’ouverture/)).toHaveLength(0)
  })

  it('dit qu’un exercice n’a pas encore d’ouverture tant que le précédent n’est pas validé', async () => {
    faux.parTable.ecritures_brouillon = [...ECRITURES_2025, ...ECRITURES_2026]
    monter(2026, [], [])

    expect(await screen.findByText('L’exercice 2026 n’a pas encore d’ouverture : elle s’écrira à la validation de l’exercice 2025 (Clôture). Jusque-là, ses comptes de bilan partent de zéro dans cette balance.')).toBeTruthy()
  })

  it('dit qu’un exercice validé dont tous les comptes étaient soldés n’a rien reporté', async () => {
    faux.parTable.ecritures_brouillon = ECRITURES_2026
    monter(2026, [2025], [])

    expect(await screen.findByText('L’exercice 2025 validé n’a rien reporté : tous ses comptes de bilan étaient soldés.')).toBeTruthy()
  })

  it('dit, à part de l’ouverture reprise, que des soldes reportés lus en partie faussent la balance', async () => {
    faux.parTable.ecritures_brouillon = [...ECRITURES_2025, ...ECRITURES_2026]
    faux.erreurs = { soldes_reportes: 'refus simulé' }
    monter(2026)

    expect(await screen.findByText(/Les soldes reportés des exercices validés n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.queryAllByText(/Les à-nouveaux du dossier n'ont pas pu être lus/)).toHaveLength(0)
    // Un état tiré d'une lecture partielle pourrait être faux : la phrase se tait, le bandeau parle.
    expect(screen.queryAllByText(/sont compris dans les totaux|n’a rien reporté|n’a pas encore d’ouverture/)).toHaveLength(0)
  })
})

// LES COMPTES DE TIERS EN ENGAGEMENT (ligne 32, lib/lettrage.ts). Le calcul est testé dans `lettrage.test.ts` ; ce qui
// se joue ici est ce que l'écran en fait — l'arrêté qu'il choisit, ce qu'il dit d'une liste vide, d'une lecture
// partielle et d'une écriture antérieure à l'ouverture, et qu'il ne montre rien en trésorerie.
// Typées SANS `as` : le compilateur vérifie chaque colonne contre la table.
const ligne = (o: Partial<EcritureBrouillon> & Pick<EcritureBrouillon, 'id' | 'compte' | 'sens' | 'montant' | 'date'>): EcritureBrouillon => ({
  dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: null, libelle: 'Écriture de test',
  statut: 'proposee', created_at: '2026-03-01T09:00:00Z', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, ...NON_VALIDEE, ...o,
})
const piece = (o: Partial<Piece> & Pick<Piece, 'id' | 'tiers'>): Piece => ({
  dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload', storage_path: `${o.id}.pdf`, nom_fichier: `${o.id}.pdf`,
  storage_hash: null, date_piece: '2026-02-01', montant_ht: null, montant_tva: null, montant_ttc: 100, devise: 'EUR',
  montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
  type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
  created_at: '2026-02-01T09:00:00Z', updated_at: '2026-02-01T09:00:00Z', ...o,
})

describe('StatistiquesTab — les comptes de tiers, en engagement', () => {
  const PIECES = [
    piece({ id: 'p-trans', tiers: 'Transmedical', date_piece: '2025-12-10', montant_ttc: 120 }),
    piece({ id: 'p-bureau', tiers: 'Bureau Vallée', date_piece: '2026-02-01', montant_ttc: 200 }),
    piece({ id: 'p-clinique', tiers: 'Clinique du Parc', date_piece: '2026-03-01', montant_ttc: 500, type_piece: 'vente' }),
  ]
  // Transmedical : facturée le 10 décembre, réglée le 8 janvier. Bureau Vallée : réglée en partie le 20 février.
  // Clinique du Parc : une vente que rien n'encaisse.
  const BROUILLON = [
    ligne({ id: 't1', piece_id: 'p-trans', date: '2025-12-10', compte: '606100', sens: 'debit', montant: 120 }),
    ligne({ id: 't2', piece_id: 'p-trans', date: '2025-12-10', compte: '401000', sens: 'credit', montant: 120 }),
    ligne({ id: 't3', piece_id: 'p-trans', ligne_bancaire_id: 'm1', date: '2026-01-08', compte: '401000', sens: 'debit', montant: 120 }),
    ligne({ id: 't4', piece_id: 'p-trans', ligne_bancaire_id: 'm1', date: '2026-01-08', compte: '512000', sens: 'credit', montant: 120 }),
    ligne({ id: 'b1', piece_id: 'p-bureau', date: '2026-02-01', compte: '606400', sens: 'debit', montant: 200 }),
    ligne({ id: 'b2', piece_id: 'p-bureau', date: '2026-02-01', compte: '401000', sens: 'credit', montant: 200 }),
    ligne({ id: 'b3', piece_id: 'p-bureau', ligne_bancaire_id: 'm2', date: '2026-02-20', compte: '401000', sens: 'debit', montant: 150 }),
    ligne({ id: 'b4', piece_id: 'p-bureau', ligne_bancaire_id: 'm2', date: '2026-02-20', compte: '512000', sens: 'credit', montant: 150 }),
    ligne({ id: 'c1', piece_id: 'p-clinique', date: '2026-03-01', compte: '411000', sens: 'debit', montant: 500 }),
    ligne({ id: 'c2', piece_id: 'p-clinique', date: '2026-03-01', compte: '706000', sens: 'credit', montant: 500 }),
  ]
  const OUVERTURE: ANouveau[] = [
    {
      id: 'an-401', dossier_id: 'dossier-de-test', date: '2026-01-01', compte: '401000', compte_origine: '401', libelle: 'Fournisseurs',
      sens: 'credit', montant: 80, source_nom: 'balance-2025.csv', source_empreinte: 'a'.repeat(64), created_at: '2026-01-02T09:00:00Z',
      ...A_NOUVEAU_NON_VALIDE,
    },
    {
      id: 'an-512', dossier_id: 'dossier-de-test', date: '2026-01-01', compte: '512000', compte_origine: '512', libelle: 'Banque',
      sens: 'debit', montant: 80, source_nom: 'balance-2025.csv', source_empreinte: 'a'.repeat(64), created_at: '2026-01-02T09:00:00Z',
      ...A_NOUVEAU_NON_VALIDE,
    },
  ]

  beforeEach(() => {
    // « Aujourd'hui », à Paris, est le 15 avril 2026 : l'arrêté d'un exercice en cours. Seul `Date` est feint — les
    // minuteurs dont `findByText` dépend restent réels.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-04-15T10:00:00Z'))
    faux.plafond = null
    faux.parTable.categories = []
    faux.parTable.pieces = PIECES
    faux.parTable.ecritures_brouillon = BROUILLON
  })
  afterEach(() => { vi.useRealTimers() })

  function monter(annee: number | 'toutes', mode: ModeComptable = 'engagement') {
    render(
      <ContexteDossier valides={faux.valides} annee={annee}>
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} modeComptable={mode} />
      </ContexteDossier>,
    )
  }

  // Les cellules de la ligne d'un tiers, par son nom.
  function ligneDuTiers(nom: string): string[] {
    const cellule = screen.getAllByText(nom).find((n) => n.closest('tbody') && n.closest('table')!.querySelector('th')?.textContent === 'Tiers')!
    return [...cellule.closest('tr')!.children].map((c) => (c.textContent ?? '').replace(/\s/g, ' '))
  }

  it('arrête aujourd’hui un dossier vu toutes années confondues, et dit ce qui reste ouvert et depuis quand', async () => {
    monter('toutes')

    expect(await screen.findByText('Comptes de tiers au 15/04/2026')).toBeTruthy()
    expect(screen.getByText(/arrêté à aujourd’hui/)).toBeTruthy()
    // Bureau Vallée : 50 € de reste sur une facture du 1er février, 73 jours — la tranche de 61 à 90 jours.
    expect(ligneDuTiers('Bureau Vallée')).toEqual(['Bureau ValléeFBUREAU', '50,00 €', '—', '—', '50,00 €', '—'])
    // La vente : 500 € à encaisser depuis 45 jours.
    expect(ligneDuTiers('Clinique du Parc')).toEqual(['Clinique du ParcCCLINIQUE', '500,00 €', '—', '500,00 €', '—', '—'])
    // Transmedical, réglée le 8 janvier, est lettrée : elle n'y est plus.
    expect(screen.queryAllByText('Transmedical')).toHaveLength(0)
    expect(screen.getByText('Réglée en partie')).toBeTruthy()
    expect(screen.getByText('Sans règlement')).toBeTruthy()
    // Un seul tiers au 401 : un total le répéterait.
    const section = screen.getByText((_, n) => n?.tagName === 'H4' && (n.textContent ?? '').startsWith('401000'))
    expect(section.parentElement!.querySelector('tfoot')).toBeNull()
  })

  it('arrête au 31 décembre un exercice fini : une facture réglée l’année suivante y est ouverte', async () => {
    monter(2025)

    expect(await screen.findByText('Comptes de tiers au 31/12/2025')).toBeTruthy()
    expect(screen.getByText(/arrêté au 31 décembre de l’exercice choisi/)).toBeTruthy()
    expect(ligneDuTiers('Transmedical')).toEqual(['TransmedicalFTRANSMEDICAL', '120,00 €', '120,00 €', '—', '—', '—'])
    // Ni la facture de février, ni la vente de mars n'existent encore au 31 décembre.
    expect(screen.queryAllByText('Bureau Vallée')).toHaveLength(0)
    expect(screen.queryAllByText('Clinique du Parc')).toHaveLength(0)
  })

  // Un exercice EN COURS se lit au jour où on le regarde, pas au 31 décembre à venir : les âges compteraient sinon
  // des jours qui n'ont pas eu lieu.
  it('arrête aujourd’hui l’exercice en cours', async () => {
    monter(2026)

    expect(await screen.findByText('Comptes de tiers au 15/04/2026')).toBeTruthy()
    expect(ligneDuTiers('Bureau Vallée')[4]).toBe('50,00 €')
    // Sur TOUT le brouillon, pas sur l'exercice : lue sur les seules écritures de 2026, la facture de décembre
    // disparaîtrait et son règlement de janvier ressortirait comme un règlement sans facture.
    expect(screen.queryAllByText('Transmedical')).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la carte se montre en engagement » serait satisfait par un écran qui la montre
  // toujours — en trésorerie, la charge est face à la banque et il n'y a pas de compte de tiers à suivre.
  it('ne montre rien en trésorerie', async () => {
    monter('toutes', 'tresorerie')

    await screen.findByText('401000')
    expect(screen.queryAllByText(/Comptes de tiers au/)).toHaveLength(0)
  })

  it('dit que tout est soldé quand chaque facture l’est', async () => {
    faux.parTable.ecritures_brouillon = BROUILLON.filter((e) => e.piece_id === 'p-trans')
    monter('toutes')

    expect(await screen.findByText('Tous les comptes de tiers sont soldés au 15/04/2026 : chaque facture écrite l’est par ses règlements ou par un lettrage.')).toBeTruthy()
    expect(screen.queryAllByText(/Aucune facture ni aucun règlement/)).toHaveLength(0)
  })

  // « Tout est soldé » sur un brouillon où rien n'est écrit serait une bonne nouvelle fabriquée.
  it('ne dit pas « soldé » quand rien n’est écrit sur un compte de tiers', async () => {
    faux.parTable.ecritures_brouillon = BROUILLON.filter((e) => e.compte === '606100' || e.compte === '512000')
    monter('toutes')

    expect(await screen.findByText(/Aucune facture ni aucun règlement n’est écrit sur un compte de tiers au 15\/04\/2026/)).toBeTruthy()
    expect(screen.queryAllByText(/Tous les comptes de tiers sont soldés/)).toHaveLength(0)
  })

  it('ne conclut pas sur un brouillon lu en partie', async () => {
    faux.erreurs = { ecritures_brouillon: 'refus simulé' }
    monter('toutes')

    expect(await screen.findByText(/Les comptes de tiers ne peuvent pas être dits/)).toBeTruthy()
    expect(screen.queryAllByText(/Aucune facture ni aucun règlement|Tous les comptes de tiers sont soldés/)).toHaveLength(0)
  })

  it('ne conclut pas sur des à-nouveaux lus en partie', async () => {
    faux.erreurs = { a_nouveaux: 'refus simulé' }
    monter('toutes')

    expect(await screen.findByText(/Les comptes de tiers ne peuvent pas être dits/)).toBeTruthy()
    expect(screen.queryAllByText('Bureau Vallée')).toHaveLength(0)
  })

  // Les pièces ne donnent que les NOMS : lues en partie, la carte garde ses montants, et le bandeau le dit — à part de
  // celui du brouillon, qui disait jusqu'ici que les écritures n'avaient pas pu être lues.
  it('dit, à part du brouillon, que des pièces lues en partie privent un tiers de son nom', async () => {
    faux.erreurs = { pieces: 'refus simulé' }
    monter('toutes')

    expect(await screen.findByText(/Les pièces du dossier n'ont pas pu être lues en entier/)).toBeTruthy()
    expect(screen.getByText(/peut s’afficher sous « divers »/)).toBeTruthy()
    expect(screen.queryAllByText(/Les écritures du brouillon n'ont pas pu être lues/)).toHaveLength(0)
    expect(ligneDuTiers('Fournisseurs divers')).toEqual(['Fournisseurs diversFDIVERS', '50,00 €', '—', '—', '50,00 €', '—'])
  })

  it('ne parle pas des comptes de tiers dans le bandeau des pièces, en trésorerie', async () => {
    faux.erreurs = { pieces: 'refus simulé' }
    monter('toutes', 'tresorerie')

    expect(await screen.findByText(/Les pièces du dossier n'ont pas pu être lues en entier/)).toBeTruthy()
    expect(screen.queryAllByText(/« divers »/)).toHaveLength(0)
  })

  it('montre l’ouverture d’un dossier repris à part, et prévient d’une écriture de tiers qui la précède', async () => {
    faux.parTable.a_nouveaux = OUVERTURE
    monter(2026)

    expect(await screen.findByText('Repris à l’ouverture, sans détail par tiers')).toBeTruthy()
    expect(screen.getByText(/1 écriture sur un compte de tiers précède l’ouverture du 01\/01\/2026/)).toBeTruthy()
    // L'ouverture n'a pas d'ancienneté : la ligne le dit au lieu d'aligner des tranches vides.
    const ouverture = screen.getByText('Repris à l’ouverture, sans détail par tiers').closest('tr')!
    expect([...ouverture.children].map((c) => (c.textContent ?? '').replace(/\s/g, ' '))).toEqual([
      'Repris à l’ouverture, sans détail par tiers', '80,00 €',
      'Ancienneté inconnue : la balance reprise ne détaille pas ce solde par tiers.',
    ])
    // Le total du compte comprend l'ouverture ; l'ancienneté, elle, ne porte que sur les pièces.
    const section = screen.getByText((_, n) => n?.tagName === 'H4' && (n.textContent ?? '').startsWith('401000'))
    expect(section.textContent!.replace(/\s/g, ' ')).toBe('401000 — Fournisseurs · reste à payer 130,00 €')
    const pied = section.parentElement!.querySelector('tfoot tr')!
    expect([...pied.children].map((c) => (c.textContent ?? '').replace(/\s/g, ' '))).toEqual(['Total', '130,00 €', '—', '—', '50,00 €', '—'])
  })

  // L'ouverture est le point de départ des comptes, pas une écriture de son seul exercice : l'année d'après, elle
  // compte encore — c'est ce qui distingue la vue à une date de la balance d'un exercice.
  it('garde l’ouverture d’un dossier repris dans la vue de l’exercice suivant', async () => {
    vi.setSystemTime(new Date('2027-02-15T10:00:00Z'))
    faux.parTable.a_nouveaux = OUVERTURE
    monter(2027)

    expect(await screen.findByText('Comptes de tiers au 15/02/2027')).toBeTruthy()
    expect(screen.getByText('Repris à l’ouverture, sans détail par tiers')).toBeTruthy()
  })

  // LES SOLDES REPORTÉS N'Y ENTRENT PAS (ligne 34) : la vue lit tout le brouillon, et les écritures de l'exercice validé
  // y sont déjà — les compter avec ses soldes reportés doublerait chaque dette qui court. La balance de l'exercice, elle,
  // les compte : c'est ce qui les met d'accord.
  it('ne compte pas les soldes reportés d’un exercice validé, que le brouillon porte déjà', async () => {
    faux.valides = [2025]
    faux.parTable.soldes_reportes = [
      {
        id: 'sr-401', dossier_id: 'dossier-de-test', date: '2026-01-01', compte: '401000', libelle: 'Fournisseurs', sens: 'credit',
        montant: 120, source_nom: 'Exercice 2025 validé', source_empreinte: 'c'.repeat(64), created_at: '2026-03-01T10:00:00Z',
        compte_lib: null, ecriture_lib: null,
      },
    ]
    monter(2026)

    expect(await screen.findByText('Comptes de tiers au 15/04/2026')).toBeTruthy()
    expect(screen.queryAllByText('Repris à l’ouverture, sans détail par tiers')).toHaveLength(0)
    const section = screen.getByText((_, n) => n?.tagName === 'H4' && (n.textContent ?? '').startsWith('401000'))
    expect(section.textContent!.replace(/\s/g, ' ')).toBe('401000 — Fournisseurs · reste à payer 50,00 €')
    // Et la balance de l'exercice, au-dessus, dit la même dette : 120 reportés, réglés en janvier, plus 50 de février.
    const balance = screen.getAllByText('401000').find((n) => n.tagName === 'TD')!
    expect([...balance.closest('tr')!.children].map((c) => (c.textContent ?? '').replace(/\s/g, ' '))[5]).toBe('50,00 € créditeur')
  })

  // Un arrêté AVANT l'ouverture ne compte pas les à-nouveaux : il n'y a rien à compter deux fois, et le dire crierait au
  // loup.
  it('ne prévient de rien quand l’arrêté précède l’ouverture', async () => {
    faux.parTable.a_nouveaux = OUVERTURE
    monter(2025)

    expect(await screen.findByText('Comptes de tiers au 31/12/2025')).toBeTruthy()
    expect(screen.queryAllByText(/précèden?t? l’ouverture du 01\/01\/2026/)).toHaveLength(0)
    expect(screen.queryAllByText('Repris à l’ouverture, sans détail par tiers')).toHaveLength(0)
  })
})

// LE LETTRAGE FAIT À LA MAIN (ligne 32, seconde brique). Le calcul est testé dans `lettrage.test.ts` ; ici, ce que
// l'écran en fait — proposer sans écrire, cocher, dire avant le clic ce que la base refuserait, lettrer sous un verrou,
// défaire après une confirmation qui nomme ce qu'on perd, et ne rien offrir sur une vue qui n'est pas celle d'aujourd'hui.
describe('StatistiquesTab — le lettrage fait à la main', () => {
  const PIECES = [
    piece({ id: 'p-fact', tiers: 'Garage Martin', date_piece: '2026-03-02', montant_ttc: 300 }),
    piece({ id: 'p-avoir', tiers: 'Garage Martin', date_piece: '2026-03-09', montant_ttc: -300 }),
    piece({ id: 'p-bureau', tiers: 'Bureau Vallée', date_piece: '2026-02-01', montant_ttc: 200 }),
  ]
  const BROUILLON = [
    ligne({ id: 'f1', piece_id: 'p-fact', date: '2026-03-02', compte: '606100', sens: 'debit', montant: 300 }),
    ligne({ id: 'f2', piece_id: 'p-fact', date: '2026-03-02', compte: '401000', sens: 'credit', montant: 300 }),
    ligne({ id: 'a1', piece_id: 'p-avoir', date: '2026-03-09', compte: '606100', sens: 'credit', montant: 300 }),
    ligne({ id: 'a2', piece_id: 'p-avoir', date: '2026-03-09', compte: '401000', sens: 'debit', montant: 300 }),
    ligne({ id: 'b1', piece_id: 'p-bureau', date: '2026-02-01', compte: '606400', sens: 'debit', montant: 200 }),
    ligne({ id: 'b2', piece_id: 'p-bureau', date: '2026-02-01', compte: '401000', sens: 'credit', montant: 200 }),
  ]
  const lettrees = (avoir = 'p-avoir') => [
    { id: 'l1', dossier_id: 'dossier-de-test', groupe: 'g-ancien', piece_id: 'p-fact', compte: '401000', created_at: '2026-04-01T09:00:00Z' },
    { id: 'l2', dossier_id: 'dossier-de-test', groupe: 'g-ancien', piece_id: avoir, compte: '401000', created_at: '2026-04-01T09:00:00Z' },
  ]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-04-15T10:00:00Z'))
    faux.plafond = null
    faux.parTable.categories = []
    faux.parTable.pieces = PIECES
    faux.parTable.ecritures_brouillon = BROUILLON
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  function monter(annee: number | 'toutes' = 'toutes') {
    render(
      <ContexteDossier valides={faux.valides} annee={annee}>
        <StatistiquesTab dossierId="dossier-de-test" onNavigate={() => {}} modeComptable="engagement" />
      </ContexteDossier>,
    )
  }
  const caseDe = (nom: string) => screen.getByRole('checkbox', { name: `Cocher ${nom}` }) as HTMLInputElement

  it('propose la facture et l’avoir qui la solde, et ne lettre qu’au clic', async () => {
    monter()

    expect(await screen.findByText('Lettrages proposés')).toBeTruthy()
    expect(screen.getByText(/Garage Martin \(401000\) : p-avoir\.pdf et p-fact\.pdf se soldent/)).toBeTruthy()
    expect(faux.appels).toHaveLength(0)

    await act(async () => { screen.getByRole('button', { name: 'Lettrer' }).click() })

    expect(faux.appels).toEqual([{
      nom: 'lettrer_pieces', args: { p_dossier_id: 'dossier-de-test', p_compte: '401000', p_pieces: ['p-avoir', 'p-fact'] },
    }])
    // Relue, la vue ne montre plus ni la facture ni l'avoir, et la liste des lettrages faits à la main les porte.
    expect(await screen.findByText(/Lettrages faits à la main \(1\)/)).toBeTruthy()
    expect(screen.queryAllByRole('checkbox', { name: 'Cocher p-fact.pdf' })).toHaveLength(0)
    expect(screen.getByText('se soldent')).toBeTruthy()
    expect(screen.queryAllByText('Lettrages proposés')).toHaveLength(0)
  })

  it('dit, sur les pièces cochées, ce qui reste et ce que la base refuserait — sans crier sur la première', async () => {
    monter()

    await screen.findByText('Lettrages proposés')
    await act(async () => { caseDe('p-fact.pdf').click() })
    expect(screen.getByText(/1 pièce cochée — reste 300,00/)).toBeTruthy()
    expect(screen.getByText('Coche au moins une autre pièce du même tiers.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Lettrer ensemble' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { caseDe('p-bureau.pdf').click() })
    expect(screen.getByText('Ces pièces ne sont pas du même tiers.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Lettrer ensemble' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { caseDe('p-bureau.pdf').click() })
    await act(async () => { caseDe('p-avoir.pdf').click() })
    expect(screen.getByText(/2 pièces cochées — reste 0,00/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Lettrer ensemble' }) as HTMLButtonElement).disabled).toBe(false)
  })

  // Trois clics du même rendu : sans verrou, deux lettrages partiraient, et le second reviendrait en erreur sur un
  // lettrage bien enregistré. Posé dans le `try`, le verrou laisserait passer le troisième.
  it('ne lettre qu’une fois sur trois clics rapprochés', async () => {
    monter()

    await screen.findByText('Lettrages proposés')
    await act(async () => { caseDe('p-fact.pdf').click(); caseDe('p-avoir.pdf').click() })
    const bouton = screen.getByRole('button', { name: 'Lettrer ensemble' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.appels.filter((a) => a.nom === 'lettrer_pieces')).toHaveLength(1)
    expect(await screen.findByText(/Lettrages faits à la main \(1\)/)).toBeTruthy()
  })

  // Relâché avant la relecture, le verrou rendrait la proposition qu'on vient de lettrer à nouveau cliquable le temps
  // que la vue revienne : un second clic la relettrerait, et la base le refuserait sur un lettrage bien enregistré.
  it('garde le verrou pendant la relecture qui suit un lettrage', async () => {
    monter()

    await screen.findByText('Lettrages proposés')
    let liberer = () => {}
    faux.attente = new Promise<void>((r) => { liberer = r })
    await act(async () => { screen.getByRole('button', { name: 'Lettrer' }).click() })
    await waitFor(() => expect(faux.lecturesRetenues).toBeGreaterThan(0))

    // La relecture est retenue : la vue montre encore la proposition, et son bouton reste grisé.
    const bouton = screen.getByRole('button', { name: 'Lettrer' }) as HTMLButtonElement
    expect(bouton.disabled).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.appels.filter((a) => a.nom === 'lettrer_pieces')).toHaveLength(1)

    await act(async () => { liberer() })
    expect(await screen.findByText(/Lettrages faits à la main \(1\)/)).toBeTruthy()
    expect(screen.queryAllByText('Lettrages proposés')).toHaveLength(0)
  })

  // Un lettrage se fait sur UN compte : cocher une pièce d'un autre compte repart d'elle, au lieu de mêler deux comptes
  // dans une sélection que la base refuserait.
  it('repart de la pièce cochée sur un autre compte', async () => {
    faux.parTable.pieces = [
      ...PIECES, piece({ id: 'p-client', tiers: 'Atelier Corsaire', date_piece: '2026-03-20', montant_ttc: 90, type_piece: 'vente' }),
    ]
    faux.parTable.ecritures_brouillon = [
      ...BROUILLON,
      ligne({ id: 'v1', piece_id: 'p-client', date: '2026-03-20', compte: '411000', sens: 'debit', montant: 90 }),
      ligne({ id: 'v2', piece_id: 'p-client', date: '2026-03-20', compte: '706000', sens: 'credit', montant: 90 }),
    ]
    monter()

    await screen.findByText('Lettrages proposés')
    await act(async () => { caseDe('p-fact.pdf').click() })
    await act(async () => { caseDe('p-client.pdf').click() })
    expect(screen.getByText(/1 pièce cochée — reste 90,00/)).toBeTruthy()
    expect(caseDe('p-fact.pdf').checked).toBe(false)
    expect(caseDe('p-client.pdf').checked).toBe(true)
  })

  // Lettrées, les pièces quittent la vue : la sélection repart de zéro, sans quoi elles resteraient cochées en silence et
  // rejoindraient la prochaine sélection.
  it('ne garde rien de coché après un lettrage', async () => {
    monter()

    await screen.findByText('Lettrages proposés')
    await act(async () => { caseDe('p-fact.pdf').click(); caseDe('p-avoir.pdf').click() })
    await act(async () => { screen.getByRole('button', { name: 'Lettrer ensemble' }).click() })
    await screen.findByText(/Lettrages faits à la main \(1\)/)
    expect(screen.queryAllByText(/cochées? — reste/)).toHaveLength(0)

    await act(async () => { caseDe('p-bureau.pdf').click() })
    expect(screen.getByText(/1 pièce cochée — reste 200,00/)).toBeTruthy()
  })

  it('dit le refus de la base, et garde les pièces cochées', async () => {
    faux.rpc = () => ({ data: null, error: { message: 'Ces pièces ne se soldent pas : il reste 1,00 € sur le compte.' } })
    monter()

    await screen.findByText('Lettrages proposés')
    await act(async () => { caseDe('p-fact.pdf').click(); caseDe('p-avoir.pdf').click() })
    await act(async () => { screen.getByRole('button', { name: 'Lettrer ensemble' }).click() })

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Ces pièces ne se soldent pas : il reste 1,00 € sur le compte.')
    expect(caseDe('p-fact.pdf').checked).toBe(true)
    expect((screen.getByRole('button', { name: 'Lettrer ensemble' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('défait un lettrage après une confirmation qui nomme ce qu’on perd, et les pièces redeviennent ouvertes', async () => {
    faux.parTable.lettrages_manuels = lettrees()
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()

    expect(await screen.findByText(/Lettrages faits à la main \(1\)/)).toBeTruthy()
    expect(screen.queryAllByRole('checkbox', { name: 'Cocher p-fact.pdf' })).toHaveLength(0)
    await act(async () => { screen.getByRole('button', { name: 'Défaire' }).click() })

    expect(confirmation).toHaveBeenCalledWith(
      'Défaire ce lettrage fait à la main ? Les 2 pièces de Garage Martin redeviennent ouvertes dans les comptes de tiers, '
        + 'et le FEC ne les lettrera plus. Aucune écriture n’est modifiée.',
    )
    expect(faux.retraits).toEqual([{ table: 'lettrages_manuels', filtres: { dossier_id: 'dossier-de-test', groupe: 'g-ancien' } }])
    expect(await screen.findByRole('checkbox', { name: 'Cocher p-fact.pdf' })).toBeTruthy()
    expect(screen.queryAllByText(/Lettrages faits à la main/)).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la confirmation nomme ce qu'on perd » serait satisfait par un bouton qui ne demande rien.
  it('ne défait rien quand la confirmation est refusée', async () => {
    faux.parTable.lettrages_manuels = lettrees()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    monter()

    await screen.findByText(/Lettrages faits à la main \(1\)/)
    await act(async () => { screen.getByRole('button', { name: 'Défaire' }).click() })
    expect(faux.retraits).toEqual([])
  })

  // Une suppression qui ne touche aucune ligne ne lève rien : sans le compte, un refus de la RLS passerait pour un succès.
  it('dit qu’un retrait qui ne touche rien n’a rien défait', async () => {
    faux.parTable.lettrages_manuels = lettrees()
    faux.retraitRefuse = true
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()

    await screen.findByText(/Lettrages faits à la main \(1\)/)
    await act(async () => { screen.getByRole('button', { name: 'Défaire' }).click() })
    expect(await screen.findByText(/Rien n’a été défait/)).toBeTruthy()
  })

  it('dit pourquoi un lettrage ne tient plus, et ne laisse pas cocher ses pièces', async () => {
    faux.parTable.pieces = [...PIECES, piece({ id: 'p-avoir2', tiers: 'Garage Martin', date_piece: '2026-03-12', montant_ttc: -200 })]
    faux.parTable.ecritures_brouillon = [
      ...BROUILLON,
      ligne({ id: 'c1', piece_id: 'p-avoir2', date: '2026-03-12', compte: '606100', sens: 'credit', montant: 200 }),
      ligne({ id: 'c2', piece_id: 'p-avoir2', date: '2026-03-12', compte: '401000', sens: 'debit', montant: 200 }),
    ]
    faux.parTable.lettrages_manuels = lettrees('p-avoir2')
    monter()

    expect(await screen.findByText(/1 ne tient plus/)).toBeTruthy()
    expect(screen.getByText(/Ses pièces ne se soldent plus\. Il reste 100,00\s€ sur le compte\./)).toBeTruthy()
    expect(caseDe('p-fact.pdf').disabled).toBe(true)
    expect(caseDe('p-avoir2.pdf').disabled).toBe(true)
    expect(screen.getAllByText('dans un lettrage fait à la main')).toHaveLength(2)
  })

  it('n’offre ni case ni proposition sur un exercice fini, et dit pourquoi', async () => {
    faux.parTable.pieces = [...PIECES, piece({ id: 'p-ancien', tiers: 'Imprimerie', date_piece: '2025-11-02', montant_ttc: 80 })]
    faux.parTable.ecritures_brouillon = [
      ...BROUILLON,
      ligne({ id: 'i1', piece_id: 'p-ancien', date: '2025-11-02', compte: '606400', sens: 'debit', montant: 80 }),
      ligne({ id: 'i2', piece_id: 'p-ancien', date: '2025-11-02', compte: '401000', sens: 'credit', montant: 80 }),
    ]
    monter(2025)

    expect(await screen.findByText('Comptes de tiers au 31/12/2025')).toBeTruthy()
    expect(screen.getByText(/Le lettrage à la main se fait sur la vue arrêtée à aujourd’hui/)).toBeTruthy()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByText('Lettrages proposés')).toHaveLength(0)
  })

  it('ne conclut pas quand les lettrages faits à la main sont lus en partie', async () => {
    faux.erreurs = { lettrages_manuels: 'refus simulé' }
    monter()

    expect(await screen.findByText(/Les comptes de tiers ne peuvent pas être dits/)).toBeTruthy()
    expect(screen.getByText(/les lettrages faits à la main n’ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('suspend le lettrage quand les pièces sont lues en partie : leur tiers n’est pas connu', async () => {
    faux.erreurs = { pieces: 'refus simulé' }
    monter()

    expect(await screen.findByText(/le lettrage à la main attend une lecture complète/)).toBeTruthy()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByText('Lettrages proposés')).toHaveLength(0)
  })
})
