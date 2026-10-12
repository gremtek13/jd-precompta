import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BilanTab from './BilanTab'
import { useAnnee } from '../../context/AnneeContext'
import type { ModeleComptable } from '../../lib/engagement'
import type { ANouveau, Categorie, EcritureBrouillon, SoldeReporte } from '../../lib/types'
import type { DossierTab } from '../../lib/ongletsDossier'
import type { Predicat } from '../../test/filtresPostgrest'
import { ContexteDossier } from '../../test/exercicesValides'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../../test/ecritures'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'

// LE CALCUL EST DANS `lib/bilan.ts`, CONFRONTÉ À DES BILANS FAITS À LA MAIN. CE QUI SE JOUE ICI, c'est ce qu'aucun calcul
// pur ne voit : que l'écran lise TOUT le dossier et rien d'un autre (les filtres sont appliqués par le faux client), qu'il
// ne montre aucun chiffre avant d'avoir lu ni sur une lecture partielle, qu'il suive l'exercice de l'en-tête, et que ses
// tableaux portent ce que le module calcule — un client créditeur au passif, une banque créditrice en emprunts.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  // Les tables dont la lecture est refusée : `lireTout` les rend incomplètes.
  refusees: new Set<string>(),
  // Une promesse que chaque réponse attend : le temps de voir l'écran avant toute lecture.
  attente: null as Promise<void> | null,
  // Les colonnes demandées, table par table.
  colonnes: {} as Record<string, string>,
  // Les requêtes lancées : l'exercice précédent se calcule sur les lectures de l'exercice affiché, sans en relancer.
  appels: 0,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatOr } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    const predicats: Predicat[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select: (colonnes: string) => { faux.colonnes[table] = colonnes; return c },
      eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
      or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
      order: () => c,
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      then: (suite: (r: unknown) => unknown) => {
        const reponse = () => {
          if (faux.refusees.has(table)) return { data: null, error: { message: 'permission denied' }, count: null }
          const lignes = filtrer(faux.tables[table] ?? [], predicats)
          return { data: lignes.slice(debut, fin + 1), error: null, count: lignes.length }
        }
        return (faux.attente ?? Promise.resolve()).then(reponse).then(suite)
      },
    })
    return c
  }
  return { supabase: { from: (table: string) => { faux.appels += 1; return chaine(table) } } }
})

let numero = 0
function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  numero += 1
  return {
    id: `e${String(numero).padStart(4, '0')}`, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2026-03-01',
    compte: '512000', libelle: 'Écriture d’essai', montant: 0, sens: 'debit', statut: 'proposee', created_at: '2026-03-01T10:00:00Z',
    immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, ...NON_VALIDEE, ...o,
  }
}

function aNouveau(o: Partial<ANouveau>): ANouveau {
  numero += 1
  return {
    id: `a${numero}`, dossier_id: 'd1', date: '2026-01-01', compte: '512000', compte_origine: '512000', libelle: 'Banque',
    sens: 'debit', montant: 0, source_nom: 'balance-fictive.csv', source_empreinte: 'empreinte-fictive',
    created_at: '2026-02-01T10:00:00Z', ...A_NOUVEAU_NON_VALIDE, ...o,
  }
}

function categorie(o: Partial<Categorie>): Categorie {
  return { id: 'cat', dossier_id: null, code: 'achats', libelle: 'Achats', ordre: 1, compte_comptable: '606000', poste_2035: null, ...o }
}

type Ligne = [compte: string, sens: 'D' | 'C', euros: number]
function ecrire(date: string, lignes: Ligne[], o: Partial<EcritureBrouillon> = {}): EcritureBrouillon[] {
  return lignes.map(([compte, sens, montant]) => ecriture({ date, compte, montant, sens: sens === 'D' ? 'debit' : 'credit', ...o }))
}

const SOCIETE: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const EXPLOITANT: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

// Le dossier fictif d'une société : un client qui doit 2 400, un autre qui a payé 300 sans facture, un fournisseur
// débiteur de 500, une banque créditrice de 1 400 (le cas calculé à la main dans bilan.test.ts).
function societeFictive() {
  faux.tables = {
    ecritures_brouillon: [
      ...ecrire('2026-02-01', [['411000', 'D', 2_400], ['706000', 'C', 2_000], ['445710', 'C', 400]], { piece_id: 'p4' }),
      ...ecrire('2026-02-10', [['512000', 'D', 300], ['411000', 'C', 300]], { piece_id: 'p5', ligne_bancaire_id: 'm1' }),
      ...ecrire('2026-03-01', [['606000', 'D', 1_000], ['445660', 'D', 200], ['401000', 'C', 1_200]], { piece_id: 'p6' }),
      ...ecrire('2026-03-05', [['401000', 'D', 500], ['512000', 'C', 500]], { piece_id: 'p7', ligne_bancaire_id: 'm2' }),
      ...ecrire('2026-03-10', [['401000', 'D', 1_200], ['512000', 'C', 1_200]], { piece_id: 'p6', ligne_bancaire_id: 'm3' }),
      // Un autre dossier : ses écritures ne doivent rien changer au bilan de celui-ci.
      ...ecrire('2026-03-10', [['512000', 'D', 99_999], ['101000', 'C', 99_999]], { dossier_id: 'd2' }),
    ],
    pieces: [
      { id: 'p4', dossier_id: 'd1', tiers: 'Alphamed' }, { id: 'p5', dossier_id: 'd1', tiers: 'Deltasoin' },
      { id: 'p6', dossier_id: 'd1', tiers: 'Bravopapier' }, { id: 'p7', dossier_id: 'd1', tiers: 'Echoprint' },
    ],
    categories: [],
    a_nouveaux: [],
    soldes_reportes: [],
  }
}

function rendre(o: { modele?: ModeleComptable; annee?: number | 'toutes'; valides?: number[]; onNavigate?: (t: DossierTab) => void } = {}) {
  return render(
    <ContexteDossier annee={o.annee ?? 2026} valides={o.valides ?? []}>
      <BilanTab dossierId="d1" modele={o.modele ?? SOCIETE} onNavigate={o.onNavigate ?? (() => {})} />
      <ChoisirExercice />
    </ContexteDossier>,
  )
}

// L'exercice de l'en-tête, changé écran ouvert, comme le fait la page du dossier.
function ChoisirExercice() {
  const { setAnnee } = useAnnee()
  return <button type="button" onClick={() => setAnnee(2025)}>Choisir 2025</button>
}

// Le montant d'une ligne d'un tableau, espaces normalisés.
function montantsDeLaLigne(table: HTMLElement, rubrique: string): string[] {
  const ligne = within(table).getByText(rubrique).closest('tr') as HTMLElement
  return [...ligne.querySelectorAll('td')].slice(1).map((td) => (td.textContent ?? '').replace(/\s/g, ' '))
}

// Le 15 mars 2027 à Paris : l'exercice 2026 est clos, son bilan n'est plus provisoire — quel que soit le jour où la suite
// tourne. Seule l'horloge de `Date` est truquée : les autres minuteries feraient expirer les attentes de Testing Library.
beforeEach(() => {
  faux.tables = {}
  faux.refusees = new Set()
  faux.attente = null
  faux.colonnes = {}
  faux.appels = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-03-15T10:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BilanTab', () => {
  it('ne montre aucun chiffre avant d’avoir lu, puis le bilan de l’exercice de l’en-tête', async () => {
    societeFictive()
    let relacher = () => {}
    faux.attente = new Promise<void>((r) => { relacher = r })
    rendre()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    await act(async () => { relacher() })

    expect(screen.getByRole('heading', { name: 'Bilan au 31/12/2026' })).toBeTruthy()
    const [actif, passif] = screen.getAllByRole('table')
    // Actif : clients 2 400 (Alphamed seul), autres créances 500 + 200 = 700. Passif : résultat 1 000, la banque
    // créditrice de 1 400 en emprunts, la TVA collectée 400, le client créditeur 300 en autres dettes.
    expect(montantsDeLaLigne(actif, 'Clients et comptes rattachés')).toEqual(['2 400,00 €', '', '2 400,00 €'])
    expect(montantsDeLaLigne(actif, 'Autres créances')).toEqual(['700,00 €', '', '700,00 €'])
    expect(within(actif).queryByText('Disponibilités')).toBeNull()
    expect(montantsDeLaLigne(actif, 'Actif immobilisé (total I)')).toEqual(['0,00 €', '0,00 €', '0,00 €'])
    expect(montantsDeLaLigne(actif, 'Actif circulant (total II)')).toEqual(['3 100,00 €', '0,00 €', '3 100,00 €'])
    expect(montantsDeLaLigne(actif, 'Total général')).toEqual(['3 100,00 €', '0,00 €', '3 100,00 €'])
    expect(montantsDeLaLigne(passif, 'Capitaux propres (total I)')).toEqual(['1 000,00 €'])
    expect(montantsDeLaLigne(passif, 'Dettes (total III)')).toEqual(['2 100,00 €'])
    expect(montantsDeLaLigne(passif, 'Résultat de l’exercice')).toEqual(['1 000,00 €'])
    expect(montantsDeLaLigne(passif, 'Emprunts et dettes assimilées')).toEqual(['1 400,00 €'])
    expect(montantsDeLaLigne(passif, 'Dettes fiscales et sociales')).toEqual(['400,00 €'])
    expect(montantsDeLaLigne(passif, 'Autres dettes')).toEqual(['300,00 €'])
    expect(montantsDeLaLigne(passif, 'Total général')).toEqual(['3 100,00 €'])
    // Les cases du 2033-A sous chaque rubrique.
    expect(within(actif).getByText('cases 068 et 070')).toBeTruthy()
    expect(within(passif).getByText('case 175')).toBeTruthy()
    expect(screen.getByText('équilibré')).toBeTruthy()
    // Le détail nomme le client créditeur, de son côté du bilan.
    expect(screen.getByText('Deltasoin (CDELTASOIN) : 300,00 €')).toBeTruthy()
    expect(screen.getByText('Dont TVA dans les dettes fiscales et sociales (case 169) : 400,00 €.')).toBeTruthy()
  })

  it('lit les pièces pour leur seul tiers, et les catégories du dossier et du cabinet, jamais celles d’un autre dossier', async () => {
    // Deux catégories portent le 444000 : celle du cabinet, partagée, et celle d'un autre dossier, lue après elle — sans
    // filtre, c'est elle qui nommerait le compte.
    faux.tables = {
      ecritures_brouillon: ecrire('2026-02-01', [['606000', 'D', 70], ['444000', 'C', 70]]),
      categories: [
        categorie({ id: 'c1', dossier_id: null, compte_comptable: '444000', libelle: 'Impôt du cabinet' }),
        categorie({ id: 'c2', dossier_id: 'd2', compte_comptable: '444000', libelle: 'Libellé d’un autre dossier' }),
      ],
      pieces: [], a_nouveaux: [], soldes_reportes: [],
    }
    rendre()
    await act(async () => {})
    fireEvent.click(screen.getByText('Détail par compte'))
    expect(screen.queryByText(/Libellé d’un autre dossier/)).toBeNull()
    expect(screen.getByText(/Impôt du cabinet : 70,00/)).toBeTruthy()
    expect(faux.colonnes.pieces).toBe('id, tiers')
  })

  it('suit l’exercice choisi en tête du dossier, sans relire', async () => {
    societeFictive()
    faux.tables.ecritures_brouillon.push(...ecrire('2025-06-01', [['512000', 'D', 10], ['101000', 'C', 10]]))
    rendre({ valides: [2025] })
    await act(async () => {})
    expect(screen.getByRole('heading', { name: 'Bilan au 31/12/2026' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choisir 2025' })) })
    expect(screen.getByRole('heading', { name: 'Bilan au 31/12/2025' })).toBeTruthy()
    const [actif, passif] = screen.getAllByRole('table')
    expect(montantsDeLaLigne(actif, 'Disponibilités')).toEqual(['10,00 €', '', '10,00 €'])
    // Un résultat nul se montre : c'est la ligne qu'on cherche d'abord.
    expect(montantsDeLaLigne(passif, 'Résultat de l’exercice')).toEqual(['0,00 €'])
  })

  it('un exercice qui n’est pas clos donne un bilan provisoire, et le dit', async () => {
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
    societeFictive()
    rendre()
    await act(async () => {})
    expect(screen.getByRole('heading', { name: 'Bilan au 31/12/2026 provisoire' })).toBeTruthy()
    expect(screen.getByText(/L’exercice 2026 n’est pas clos : ce bilan est provisoire/)).toBeTruthy()
  })

  it('toutes années confondues, il demande un exercice', async () => {
    societeFictive()
    rendre({ annee: 'toutes' })
    await act(async () => {})
    expect(screen.getByText('Un bilan s’arrête à la clôture d’un exercice : choisis-en un en tête du dossier.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('sur une lecture partielle, il dit laquelle et ne montre aucun chiffre', async () => {
    societeFictive()
    faux.refusees.add('soldes_reportes')
    rendre()
    await act(async () => {})
    expect(screen.getByText(/Les soldes reportés des exercices validés n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.getByText(/Le bilan ne s’établit pas sur une lecture incomplète/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(/€/)).toBeNull()
  })

  it.each(['ecritures_brouillon', 'categories', 'pieces', 'a_nouveaux'])('une lecture refusée de %s suspend aussi le bilan', async (table) => {
    societeFictive()
    faux.refusees.add(table)
    rendre()
    await act(async () => {})
    expect(screen.getByText(/Le bilan ne s’établit pas sur une lecture incomplète/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('un exercice dont l’ouverture attend la validation du précédent n’a pas de bilan, et mène à Clôture', async () => {
    societeFictive()
    faux.tables.ecritures_brouillon.push(...ecrire('2025-06-01', [['512000', 'D', 10], ['101000', 'C', 10]]))
    const onNavigate = vi.fn()
    rendre({ onNavigate })
    await act(async () => {})
    expect(screen.getByText(/L’exercice 2026 n’a pas encore d’ouverture : elle s’écrira à la validation de l’exercice 2025/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Valider l’exercice 2025 dans Clôture' }))
    expect(onNavigate).toHaveBeenCalledWith('cloture')
  })

  it('en trésorerie, il dit qu’un BNC n’établit pas de bilan, et range le compte de l’exploitant au capital', async () => {
    faux.tables = {
      ecritures_brouillon: [
        ...ecrire('2026-01-31', [['512000', 'D', 5_000], ['706000', 'C', 5_000]]),
        ...ecrire('2026-03-31', [['108000', 'D', 3_000], ['512000', 'C', 3_000]]),
      ],
      a_nouveaux: [aNouveau({ compte: '512000', sens: 'debit', montant: 1_000 }), aNouveau({ compte: '101000', compte_origine: '101000', libelle: 'Capital', sens: 'credit', montant: 1_000 })],
      categories: [], pieces: [], soldes_reportes: [],
    }
    rendre({ modele: EXPLOITANT })
    await act(async () => {})
    expect(screen.getByText(/Un BNC à la déclaration contrôlée n’établit pas de bilan/)).toBeTruthy()
    expect(screen.getByText(/^Comptabilité : trésorerie \(BNC, 2035\)\. Entreprise individuelle/)).toBeTruthy()
    expect(screen.getByText(/Tenu en trésorerie, le brouillon ne porte ni créance client ni dette fournisseur/)).toBeTruthy()
    expect(screen.getByText(/Ouvert par les à-nouveaux du 01\/01\/2026, repris de balance-fictive\.csv\./)).toBeTruthy()
    const [, passif] = screen.getAllByRole('table')
    // Capital individuel : 1 000 − 3 000 = −2 000 ; résultat 5 000. Banque : 1 000 + 5 000 − 3 000 = 3 000.
    expect(montantsDeLaLigne(passif, 'Capital social ou individuel')).toEqual(['-2 000,00 €'])
    expect(montantsDeLaLigne(passif, 'Résultat de l’exercice')).toEqual(['5 000,00 €'])
    expect(montantsDeLaLigne(passif, 'Total général')).toEqual(['3 000,00 €'])
    expect(screen.queryByText(/L’impôt sur les sociétés/)).toBeNull()
  })

  it('en engagement, il ne parle pas du BNC et dit ce qu’une société n’écrit pas encore', async () => {
    societeFictive()
    rendre()
    await act(async () => {})
    expect(screen.queryByText(/Un BNC à la déclaration contrôlée/)).toBeNull()
    expect(screen.getByText(/^Comptabilité : engagement \(BIC, IS\)\. Société, déduite du compte du dirigeant \(455000\)/)).toBeTruthy()
    expect(screen.getByText(/Les écritures d’inventaire ne se passent pas encore dans l’application/)).toBeTruthy()
    expect(screen.getByText(/L’impôt sur les sociétés de l’exercice et l’affectation du résultat/)).toBeTruthy()
  })

  it('les comptes qu’aucune rubrique ne nomme se montrent à part, chacun de son côté', async () => {
    faux.tables = {
      ecritures_brouillon: ecrire('2026-01-02', [['201000', 'D', 25], ['104000', 'C', 25]]),
      categories: [], pieces: [], a_nouveaux: [], soldes_reportes: [],
    }
    rendre()
    await act(async () => {})
    const [actif, passif] = screen.getAllByRole('table')
    expect(montantsDeLaLigne(actif, 'Comptes à classer')).toEqual(['25,00 €', '', '25,00 €'])
    expect(montantsDeLaLigne(passif, 'Comptes à classer')).toEqual(['25,00 €'])
    expect(screen.getByText('équilibré')).toBeTruthy()
  })

  it('un écart se montre en rouge, avec ce qui le cause', async () => {
    faux.tables = {
      ecritures_brouillon: ecrire('2026-03-01', [['606000', 'D', 100], ['512000', 'C', 90]]),
      categories: [], pieces: [], a_nouveaux: [], soldes_reportes: [],
    }
    rendre({ modele: EXPLOITANT })
    await act(async () => {})
    expect(screen.getByText('écart de 10,00 €')).toBeTruthy()
    expect(screen.getByText(/Le bilan ne s’équilibre pas/)).toBeTruthy()
    expect(screen.getByText('à corriger')).toBeTruthy()
  })
})

// LA COLONNE DE L'EXERCICE PRÉCÉDENT. Le dossier fictif d'une société dont 2025 est validé et ouvre 2026 par son report
// (le cas calculé à la main dans bilan.test.ts), et un autre dossier dont ni les écritures de 2025, ni le report, ni la
// reprise ne doivent rien changer : sans le filtre, sa reprise de 2026 ferait de 2025 un exercice antérieur à la reprise,
// et ses écritures de 2025 grossiraient la colonne.
function societeValidee() {
  faux.tables = {
    ecritures_brouillon: [
      ...ecrire('2025-01-02', [['512000', 'D', 10_000], ['101000', 'C', 10_000]]),
      ...ecrire('2025-03-01', [['218200', 'D', 6_000], ['404000', 'C', 6_000]], { piece_id: 'q1' }),
      ...ecrire('2025-03-10', [['404000', 'D', 6_000], ['512000', 'C', 6_000]], { piece_id: 'q1', ligne_bancaire_id: 'n1' }),
      ...ecrire('2025-05-01', [['411000', 'D', 1_200], ['706000', 'C', 1_000], ['445710', 'C', 200]], { piece_id: 'q2' }),
      ...ecrire('2025-06-01', [['606000', 'D', 300], ['512000', 'C', 300]], { ligne_bancaire_id: 'n2' }),
      // Un dépôt de garantie versé en 2025, rendu en 2026 : une rubrique de l'actif que seul 2025 porte.
      ...ecrire('2025-09-01', [['275000', 'D', 500], ['512000', 'C', 500]], { ligne_bancaire_id: 'n6' }),
      ...ecrire('2025-12-31', [['681100', 'D', 1_000], ['281820', 'C', 1_000]]),
      ...ecrire('2026-01-15', [['512000', 'D', 500], ['275000', 'C', 500]], { ligne_bancaire_id: 'n7' }),
      ...ecrire('2026-02-01', [['512000', 'D', 1_200], ['411000', 'C', 1_200]], { piece_id: 'q2', ligne_bancaire_id: 'n3' }),
      ...ecrire('2026-03-01', [['445710', 'D', 200], ['512000', 'C', 200]], { ligne_bancaire_id: 'n4' }),
      ...ecrire('2026-04-01', [['411000', 'D', 600], ['706000', 'C', 600]], { piece_id: 'q3' }),
      ...ecrire('2026-06-01', [['512000', 'D', 5_000], ['164000', 'C', 5_000]], { ligne_bancaire_id: 'n5' }),
      ...ecrire('2026-12-31', [['681100', 'D', 1_000], ['281820', 'C', 1_000]]),
      ...ecrire('2025-04-01', [['512000', 'D', 77_777], ['101000', 'C', 77_777]], { dossier_id: 'd2' }),
    ],
    pieces: [
      { id: 'q1', dossier_id: 'd1', tiers: 'Kilopro' }, { id: 'q2', dossier_id: 'd1', tiers: 'Limamed' },
      { id: 'q3', dossier_id: 'd1', tiers: 'Mikemed' },
    ],
    categories: [],
    a_nouveaux: [aNouveau({ dossier_id: 'd2', date: '2026-01-01', compte: '512000', sens: 'debit', montant: 5 })],
    soldes_reportes: [
      ...([['512000', 'debit', 3_200], ['275000', 'debit', 500], ['218200', 'debit', 6_000], ['281820', 'credit', 1_000], ['411000', 'debit', 1_200],
        ['445710', 'credit', 200], ['101000', 'credit', 10_000], ['129000', 'debit', 300]] as const)
        .map(([compte, sens, montant], i) => soldeReporte({ id: `s${i}`, compte, sens, montant })),
      soldeReporte({ id: 's-autre', dossier_id: 'd2', compte: '512000', sens: 'debit', montant: 44_444 }),
    ],
  }
}

function soldeReporte(o: Partial<SoldeReporte>): SoldeReporte {
  return {
    id: 's', dossier_id: 'd1', date: '2026-01-01', compte: '512000', libelle: 'Report', sens: 'debit', montant: 0,
    source_nom: 'Exercice 2025 validé', source_empreinte: 'empreinte-2025', created_at: '2026-02-01T10:00:00Z',
    compte_lib: null, ecriture_lib: null, ...o,
  }
}

const enTetes = (table: HTMLElement) => within(table).getAllByRole('columnheader').map((th) => th.textContent)
const texteNormalise = (e: Element) => (e.textContent ?? '').replace(/\s/g, ' ')

describe('BilanTab — la colonne de l’exercice précédent', () => {
  it('lue en entier, elle porte le net de N−1 à chaque rubrique, vide là où N−1 n’a rien, et rien d’un autre dossier', async () => {
    societeValidee()
    let relacher = () => {}
    faux.attente = new Promise<void>((r) => { relacher = r })
    rendre({ valides: [2025] })
    // Pas encore lue : ni chiffre ni phrase de l'exercice précédent.
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(/Exercice précédent/)).toBeNull()
    await act(async () => { relacher() })

    const [actif, passif] = screen.getAllByRole('table')
    expect(enTetes(actif)).toEqual(['Actif', 'Brut', 'Amort. et dépréc.', 'Net 2026', 'Net 2025'])
    expect(enTetes(passif)).toEqual(['Passif', 'Montant 2026', 'Montant 2025'])
    // Actif 2025 : corporelles 5 000 net, dépôt de garantie 500, clients 1 200, disponibilités 10 000 − 6 000 − 300 − 500
    // = 3 200 → 9 900. 2026 : corporelles 4 000, clients 600, disponibilités 3 200 + 500 + 1 200 − 200 + 5 000 = 9 700
    // → 14 300 ; le dépôt rendu n'a plus rien.
    expect(montantsDeLaLigne(actif, 'Immobilisations corporelles')).toEqual(['6 000,00 €', '2 000,00 €', '4 000,00 €', '5 000,00 €'])
    expect(montantsDeLaLigne(actif, 'Immobilisations financières')).toEqual(['', '', '', '500,00 €'])
    expect(montantsDeLaLigne(actif, 'Clients et comptes rattachés')).toEqual(['600,00 €', '', '600,00 €', '1 200,00 €'])
    expect(montantsDeLaLigne(actif, 'Disponibilités')).toEqual(['9 700,00 €', '', '9 700,00 €', '3 200,00 €'])
    expect(montantsDeLaLigne(actif, 'Actif immobilisé (total I)')).toEqual(['6 000,00 €', '2 000,00 €', '4 000,00 €', '5 500,00 €'])
    expect(montantsDeLaLigne(actif, 'Actif circulant (total II)')).toEqual(['10 300,00 €', '0,00 €', '10 300,00 €', '4 400,00 €'])
    expect(montantsDeLaLigne(actif, 'Total général')).toEqual(['16 300,00 €', '2 000,00 €', '14 300,00 €', '9 900,00 €'])
    // Passif 2025 : capital 10 000, perte 300, TVA 200 → 9 900. 2026 : capital 10 000, perte 400, perte de 2025 en
    // attente 300, emprunt 5 000 → 14 300. L'emprunt et l'attente n'ont rien en 2025, la TVA rien en 2026.
    expect(montantsDeLaLigne(passif, 'Capital social ou individuel')).toEqual(['10 000,00 €', '10 000,00 €'])
    expect(montantsDeLaLigne(passif, 'Résultat de l’exercice')).toEqual(['-400,00 €', '-300,00 €'])
    expect(montantsDeLaLigne(passif, 'Résultats antérieurs en attente d’affectation')).toEqual(['-300,00 €', ''])
    expect(montantsDeLaLigne(passif, 'Emprunts et dettes assimilées')).toEqual(['5 000,00 €', ''])
    expect(montantsDeLaLigne(passif, 'Dettes fiscales et sociales')).toEqual(['', '200,00 €'])
    expect(montantsDeLaLigne(passif, 'Capitaux propres (total I)')).toEqual(['9 300,00 €', '9 700,00 €'])
    expect(montantsDeLaLigne(passif, 'Dettes (total III)')).toEqual(['5 000,00 €', '200,00 €'])
    expect(montantsDeLaLigne(passif, 'Total général')).toEqual(['14 300,00 €', '9 900,00 €'])
    // La cellule de N−1 se nomme quand le tableau se replie en fiches.
    const disponibilites = within(actif).getByText('Disponibilités').closest('tr') as HTMLElement
    expect([...disponibilites.querySelectorAll('td')].map((td) => td.dataset.libelle))
      .toEqual(['Rubrique', 'Brut', 'Amort. et dépréc.', 'Net', 'Net 2025'])

    // L'en-tête dit l'équilibre de N−1, chiffres à l'appui.
    const ligne = screen.getByText(/^Exercice précédent \(2025\)/)
    expect(texteNormalise(ligne)).toBe('Exercice précédent (2025) : équilibré Actif net 9 900,00 €, passif 9 900,00 €.')
    expect(screen.getAllByText('équilibré')).toHaveLength(2)

    // Le détail rapproche chaque compte de son montant de 2025 ; un compte d'un seul côté garde sa ligne, vide de l'autre.
    fireEvent.click(screen.getByText('Détail par compte'))
    const lignes = [...document.querySelectorAll('details li')].map(texteNormalise)
    const compte = (numero: string) => lignes.find((l) => l.startsWith(`${numero} `))
    expect(compte('164000')).toMatch(/: 5 000,00 € \(2025 : —\)$/)
    expect(compte('445710')).toMatch(/: — \(2025 : 200,00 €\)$/)
    expect(compte('281820')).toMatch(/\(amortissements et dépréciations\) : 2 000,00 € \(2025 : 1 000,00 €\)$/)
    expect(compte('411000')).toMatch(/: 600,00 € \(2025 : 1 200,00 €\)Mikemed/)
    expect(screen.getByText(/^Résultat de l’exercice : -400,00\s€ \(2025 : -300,00\s€\), la différence/)).toBeTruthy()
    expect(screen.queryByText(/77\s777|44\s444/)).toBeNull()
  })

  it('un exercice précédent déséquilibré se dit en rouge avec sa cause, sans toucher à l’équilibre de N', async () => {
    faux.tables = {
      ecritures_brouillon: [
        ...ecrire('2025-01-02', [['512000', 'D', 1_000], ['101000', 'C', 1_000]]),
        ...ecrire('2025-04-01', [['606000', 'D', 100], ['512000', 'C', 90]]),
        ...ecrire('2025-05-01', [['471000', 'D', 5], ['512000', 'C', 5]]),
      ],
      // 2025 : disponibilités 1 000 − 90 − 5 = 905, attente 5 → 910 ; capital 1 000, perte 100 → 900 : l'actif dépasse
      // de 10. Le report, lui, s'équilibre.
      soldes_reportes: [
        soldeReporte({ id: 'r1', compte: '512000', sens: 'debit', montant: 905 }),
        soldeReporte({ id: 'r2', compte: '471000', sens: 'debit', montant: 5 }),
        soldeReporte({ id: 'r3', compte: '101000', sens: 'credit', montant: 1_000 }),
        soldeReporte({ id: 'r4', compte: '129000', sens: 'debit', montant: 90 }),
      ],
      categories: [], pieces: [], a_nouveaux: [],
    }
    rendre({ valides: [2025] })
    await act(async () => {})
    expect(screen.getByText('écart de 10,00 €')).toBeTruthy()
    expect(screen.getAllByText('équilibré')).toHaveLength(1)
    expect(screen.getByText(/Le bilan ne s’équilibre pas : l’actif dépasse passif de 10,00\s€\. Les écritures de l’exercice/)).toBeTruthy()
    // Le compte d'attente de 2025 se dit à part, replié : l'en-tête parle d'abord de l'exercice affiché.
    expect(screen.getByText('Ce que le bilan de 2025 a encore à revoir (1)')).toBeTruthy()
    const [actif] = screen.getAllByRole('table')
    expect(montantsDeLaLigne(actif, 'Comptes à classer')).toEqual(['5,00 €', '', '5,00 €', '5,00 €'])
  })

  it('un exercice précédent qui n’est pas clos donne une colonne provisoire', async () => {
    vi.setSystemTime(new Date('2025-12-01T10:00:00Z'))
    societeValidee()
    rendre({ valides: [2025] })
    await act(async () => {})
    expect(texteNormalise(screen.getByText(/^Exercice précédent \(2025\)/))).toMatch(/^Exercice précédent \(2025\) : équilibré provisoire /)
  })

  it('un exercice ouvert par une reprise n’a pas de colonne N−1, et le dit ; N n’en change pas', async () => {
    faux.tables = {
      ecritures_brouillon: [
        ...ecrire('2025-06-01', [['512000', 'D', 999], ['101000', 'C', 999]]),
        ...ecrire('2026-03-01', [['606000', 'D', 100], ['512000', 'C', 100]]),
      ],
      a_nouveaux: [
        aNouveau({ compte: '512000', sens: 'debit', montant: 1_000 }),
        aNouveau({ compte: '101000', compte_origine: '101000', libelle: 'Capital', sens: 'credit', montant: 1_000 }),
      ],
      categories: [], pieces: [], soldes_reportes: [],
    }
    rendre({ valides: [2025] })
    await act(async () => {})
    expect(screen.getByText('Exercice précédent (2025) : pas de colonne. L’exercice 2025 précède la reprise du dossier, ouvert '
      + 'le 01/01/2026 : ses comptes sont ceux du logiciel précédent, et son bilan aussi.')).toBeTruthy()
    const [actif, passif] = screen.getAllByRole('table')
    expect(enTetes(actif)).toEqual(['Actif', 'Brut', 'Amort. et dépréc.', 'Net'])
    expect(enTetes(passif)).toEqual(['Passif', 'Montant'])
    expect(montantsDeLaLigne(actif, 'Disponibilités')).toEqual(['900,00 €', '', '900,00 €'])
    fireEvent.click(screen.getByText('Détail par compte'))
    // Le détail ne dit que 2026 : aucune parenthèse d'un autre exercice.
    const banque = [...document.querySelectorAll('details li')].map(texteNormalise).find((l) => l.startsWith('512000 '))
    expect(banque).toMatch(/: 900,00 €$/)
    expect(screen.queryByText(/2025 :/)).toBeNull()
    expect(screen.queryByText(/999/)).toBeNull()
  })

  it('suit l’exercice de l’en-tête sans relire : le premier exercice du dossier n’a pas de colonne N−1', async () => {
    societeValidee()
    rendre({ valides: [2025] })
    await act(async () => {})
    const lues = faux.appels
    expect(lues).toBe(5)
    expect(enTetes(screen.getAllByRole('table')[0])).toContain('Net 2025')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choisir 2025' })) })
    expect(faux.appels).toBe(lues)
    expect(screen.getByRole('heading', { name: 'Bilan au 31/12/2025' })).toBeTruthy()
    expect(screen.getByText('Exercice précédent (2024) : pas de colonne. L’exercice 2025 est le premier du dossier : aucun '
      + 'exercice précédent n’est tenu dans l’application. Si l’activité est plus ancienne, sa balance se reprend dans '
      + 'Informations du dossier (« Balance d’un autre logiciel »).')).toBeTruthy()
    const [actif] = screen.getAllByRole('table')
    expect(enTetes(actif)).toEqual(['Actif', 'Brut', 'Amort. et dépréc.', 'Net'])
    expect(montantsDeLaLigne(actif, 'Disponibilités')).toEqual(['3 200,00 €', '', '3 200,00 €'])
  })

  it.each(['ecritures_brouillon', 'categories', 'pieces', 'a_nouveaux', 'soldes_reportes'])(
    'une lecture partielle de %s ne montre aucun chiffre de N−1',
    async (table) => {
      societeValidee()
      faux.refusees.add(table)
      rendre({ valides: [2025] })
      await act(async () => {})
      expect(screen.getByText(/Le bilan ne s’établit pas sur une lecture incomplète/)).toBeTruthy()
      expect(screen.queryByText(/Exercice précédent/)).toBeNull()
      expect(screen.queryByRole('table')).toBeNull()
      expect(screen.queryByText(/€/)).toBeNull()
    },
  )

  it('un exercice dont le bilan ne s’établit pas ne dit rien de N−1', async () => {
    societeValidee()
    // 2025 n'est pas validé : 2026 attend son ouverture.
    rendre({ valides: [] })
    await act(async () => {})
    expect(screen.getByText(/L’exercice 2026 n’a pas encore d’ouverture/)).toBeTruthy()
    expect(screen.queryByText(/Exercice précédent/)).toBeNull()
  })
})

// L'OUVERTURE CONFRONTÉE À LA CLÔTURE DE N−1. Le calcul est jugé dans `ouvertureConfrontee.test.ts` ; ici, ce que
// l'écran en montre : la ligne de l'en-tête, le détail des écarts sous chaque rubrique, rien avant d'avoir lu ni sur une
// lecture partielle, et aucune lecture de plus.
describe('BilanTab — l’ouverture confrontée à la clôture de l’exercice précédent', () => {
  const ligneOuverture = () => texteNormalise(screen.getByText(/^Ouverture :/).closest('p') as HTMLElement)
  const lignesDesEcarts = () => [...document.querySelectorAll('.card li')].map(texteNormalise)

  it('concordante : la ligne le dit, avec la règle du report, sans lecture de plus', async () => {
    societeValidee()
    let relacher = () => {}
    faux.attente = new Promise<void>((r) => { relacher = r })
    rendre({ valides: [2025] })
    expect(screen.queryByText(/^Ouverture :/)).toBeNull()
    await act(async () => { relacher() })
    expect(ligneOuverture()).toBe('Ouverture : concordante L’ouverture de 2026 reprend la clôture de 2025, compte par '
      + 'compte et rubrique par rubrique, au centime (code de commerce, art. L123-19 ; PCG, art. 112-2). Le report garde '
      + 'le résultat de l’exercice 2025 avant répartition, au 120000 pour un bénéfice, au 129000 pour une perte (PCG, '
      + 'art. 112-2) : son affectation ne s’écrit pas encore dans l’application.')
    expect(faux.appels).toBe(5)
  })

  it('un écart d’un centime : la rubrique, puis le compte, chacun de ses deux côtés', async () => {
    societeValidee()
    faux.tables.soldes_reportes = (faux.tables.soldes_reportes as SoldeReporte[]).map((s) => (
      s.dossier_id === 'd1' && (s.compte === '512000' || s.compte === '101000') ? { ...s, montant: s.montant + 0.01 } : s))
    rendre({ valides: [2025] })
    await act(async () => {})
    expect(ligneOuverture()).toMatch(
      /^Ouverture : en écart L’ouverture de 2026 ne reprend pas la clôture de 2025 : 2 comptes et 2 rubriques du bilan en écart\./)
    const lignes = lignesDesEcarts()
    expect(lignes).toContain('512000 Report : ouverture 3 200,01 € au débit, clôture de 2025 3 200,00 € au débit — 0,01 € de plus '
      + 'au débit à l’ouverture ; des deux côtés, d’un montant différent.')
    expect(lignes.find((l) => l.startsWith('Disponibilités'))).toMatch(
      /^Disponibilités \(actif\) : ouverture 3 200,01 €, clôture de 2025 3 200,00 € — 0,01 € de plus à l’ouverture\.512000/)
    expect(lignes.find((l) => l.startsWith('Capital social ou individuel'))).toMatch(
      /^Capital social ou individuel \(passif\) : ouverture 10 000,01 €, clôture de 2025 10 000,00 € — 0,01 € de plus à l’ouverture\.101000/)
    // Le bilan de 2026 lui-même reste là.
    expect(screen.getAllByRole('table')).toHaveLength(2)
  })

  it('deux écarts qui se compensent dans une rubrique se disent à part, avec ce que le report réunit', async () => {
    societeValidee()
    // La perte de 2025 reportée au 120000 au lieu du 129000 : la rubrique « résultats en attente » concorde.
    faux.tables.soldes_reportes = (faux.tables.soldes_reportes as SoldeReporte[]).map((s) => (
      s.compte === '129000' ? { ...s, compte: '120000' } : s))
    rendre({ valides: [2025] })
    await act(async () => {})
    expect(ligneOuverture()).toMatch(/: 2 comptes en écart\./)
    const lignes = lignesDesEcarts()
    expect(lignes.find((l) => l.startsWith('Les rubriques concordent'))).toBeTruthy()
    expect(lignes).toContain('120000 Report : ouverture 300,00 € au débit, clôture de 2025 aucun solde — 300,00 € de plus au débit à '
      + 'l’ouverture ; à l’ouverture seulement.')
    expect(lignes.find((l) => l.startsWith('129000 '))).toMatch(/: ouverture aucun solde, clôture de 2025 300,00 € au débit — 300,00 € de plus au crédit à l’ouverture ; à la clôture seulement\. À la clôture, le report y réunit la perte de 2025 \(300,00 €\)\.$/)
  })

  it('un exploitant : le report réunit le 108 et le bénéfice au 101000, et la liste le dit jusqu’au bout', async () => {
    // 2025 : capital 10 000, une recette de 2 000, un prélèvement de 500. Clôture : banque 11 500 D ; le report verse
    // au 101000 le capital, le 108 et le bénéfice, 11 500 C. L'ouverture de 2026 porte un centime de trop au 101000.
    faux.tables = {
      ecritures_brouillon: [
        ...ecrire('2025-01-02', [['512000', 'D', 10_000], ['101000', 'C', 10_000]]),
        ...ecrire('2025-02-01', [['512000', 'D', 2_000], ['706000', 'C', 2_000]], { ligne_bancaire_id: 'x1' }),
        ...ecrire('2025-03-01', [['108000', 'D', 500], ['512000', 'C', 500]], { ligne_bancaire_id: 'x2' }),
      ],
      pieces: [], categories: [], a_nouveaux: [],
      soldes_reportes: [
        soldeReporte({ id: 'e1', compte: '512000', sens: 'debit', montant: 11_500 }),
        soldeReporte({ id: 'e2', compte: '101000', sens: 'credit', montant: 11_500.01 }),
      ],
    }
    rendre({ modele: EXPLOITANT, valides: [2025] })
    await act(async () => {})
    const ligne = lignesDesEcarts().find((l) => l.startsWith('101000 '))
    // Le montant du bénéfice porte une virgule : la liste garde son « et » avant le dernier élément.
    expect(ligne).toMatch(/ À la clôture, le report y réunit 108000 et le bénéfice de 2025 \(2 000,00 €\)\.$/)
  })

  it('rien à confronter : le premier exercice du dossier', async () => {
    societeValidee()
    rendre({ valides: [2025] })
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choisir 2025' })) })
    expect(texteNormalise(screen.getByText(/^Ouverture :/))).toBe('Ouverture : rien à confronter. L’exercice 2025 est le premier '
      + 'du dossier : il s’ouvre sans solde, et aucun exercice précédent n’est tenu dans l’application.')
  })

  it('rien à confronter : un exercice ouvert par une balance reprise', async () => {
    faux.tables = {
      ecritures_brouillon: ecrire('2026-03-01', [['606000', 'D', 100], ['512000', 'C', 100]]),
      a_nouveaux: [
        aNouveau({ compte: '512000', sens: 'debit', montant: 1_000 }),
        aNouveau({ compte: '101000', compte_origine: '101000', libelle: 'Capital', sens: 'credit', montant: 1_000 }),
      ],
      categories: [], pieces: [], soldes_reportes: [],
    }
    rendre()
    await act(async () => {})
    expect(texteNormalise(screen.getByText(/^Ouverture :/))).toMatch(
      /^Ouverture : rien à confronter\. L’exercice 2026 s’ouvre par la balance reprise le 01\/01\/2026 : l’exercice 2025 est tenu dans le logiciel précédent/)
  })

  it.each(['soldes_reportes', 'ecritures_brouillon', 'a_nouveaux'])('une lecture partielle de %s ne dit rien de l’ouverture', async (table) => {
    societeValidee()
    faux.refusees.add(table)
    rendre({ valides: [2025] })
    await act(async () => {})
    expect(screen.getByText(/Le bilan ne s’établit pas sur une lecture incomplète/)).toBeTruthy()
    expect(screen.queryByText(/^Ouverture :/)).toBeNull()
    expect(screen.queryByText(/concordante|en écart/)).toBeNull()
  })

  it('un exercice dont l’ouverture attend la validation du précédent ne dit rien de la confrontation', async () => {
    societeValidee()
    rendre({ valides: [] })
    await act(async () => {})
    expect(screen.getByText(/L’exercice 2026 n’a pas encore d’ouverture/)).toBeTruthy()
    expect(screen.queryByText(/^Ouverture :/)).toBeNull()
  })
})
