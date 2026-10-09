import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BilanTab from './BilanTab'
import { useAnnee } from '../../context/AnneeContext'
import type { ModeleComptable } from '../../lib/engagement'
import type { ANouveau, Categorie, EcritureBrouillon } from '../../lib/types'
import type { DossierTab } from '../../lib/ongletsDossier'
import type { Predicat } from '../../test/filtresPostgrest'
import { ContexteDossier } from '../../test/exercicesValides'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../../test/ecritures'

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
  return { supabase: { from: (table: string) => chaine(table) } }
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

const SOCIETE: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }
const EXPLOITANT: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }

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
