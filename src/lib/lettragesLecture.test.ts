import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EcritureBrouillon, LettrageManuel, Piece } from './types'
import { NON_VALIDEE } from '../test/ecritures'
import { COMPTES_LETTRABLES, etatsDesLettragesManuels, piecesLettreesALaMain } from './lettrage'

// La lecture des lettrages faits à la main pour l'onglet Banque (lib/lettragesLecture.ts). Le faux client APPLIQUE les
// filtres de la requête (src/test/filtresPostgrest.ts) : un faux qui rendrait le brouillon entier ne verrait ni une liste
// de comptes amputée — un lettrage du 467 qui ne se revérifierait plus —, ni un filtre de dossier oublié.
const faux = vi.hoisted(() => ({
  lettrages: [] as unknown[],
  brouillon: [] as unknown[],
  lectures: [] as { table: string; filtres: string[] }[],
  // Le serveur qui cesse de rendre au-delà de N lignes d'une table tout en annonçant le vrai total : une lecture INCOMPLÈTE.
  muet: {} as Record<string, number>,
  erreur: {} as Record<string, string>,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        const filtres: string[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); filtres.push(`${colonne}=${String(valeur)}`); return c },
          in: (colonne: string, valeurs: unknown[]) => {
            predicats.push(predicatIn(colonne, valeurs))
            filtres.push(`${colonne} in ${[...valeurs].map(String).sort().join(',')}`)
            return c
          },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown) => {
            faux.lectures.push({ table, filtres: [...filtres] })
            if (faux.erreur[table]) return Promise.resolve({ data: null, error: { message: faux.erreur[table] }, count: null }).then(suite)
            const source = table === 'lettrages_manuels' ? faux.lettrages : table === 'ecritures_brouillon' ? faux.brouillon : []
            const toutes = filtrer(source, predicats)
            const limite = faux.muet[table] ?? Number.MAX_SAFE_INTEGER
            return Promise.resolve({ data: toutes.slice(debut, Math.min(fin + 1, limite)), error: null, count: toutes.length }).then(suite)
          },
        })
        return c
      },
    },
  }
})

const { AUCUN_LETTRAGE_MANUEL, lireLettragesManuels } = await import('./lettragesLecture')

function ligne(id: string, dossier: string, pieceId: string, compte: string, sens: 'debit' | 'credit', montant: number): EcritureBrouillon {
  return {
    id, dossier_id: dossier, piece_id: pieceId, ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
    date: '2026-09-08', compte, libelle: 'Écriture', sens, montant, statut: 'proposee', created_at: '2026-09-08T09:00:00Z',
    ...NON_VALIDEE,
  }
}

function lettrage(id: string, dossier: string, groupe: string, pieceId: string, compte: string): LettrageManuel {
  return { id, dossier_id: dossier, groupe, piece_id: pieceId, compte, created_at: '2026-09-22T09:30:00Z' }
}

// Un achat compensé par son avoir (il tient), une vente que son avoir ne solde qu'en partie (il ne tient plus), et une
// note de frais d'un dirigeant au 467 compensée par un trop-perçu rendu (il tient) — plus une ligne d'un autre dossier.
const BROUILLON: EcritureBrouillon[] = [
  ligne('e01', 'd1', 'f-achat', '606400', 'debit', 200),
  ligne('e02', 'd1', 'f-achat', '445660', 'debit', 40),
  ligne('e03', 'd1', 'f-achat', '401000', 'credit', 240),
  ligne('e04', 'd1', 'a-achat', '606400', 'credit', 200),
  ligne('e05', 'd1', 'a-achat', '445660', 'credit', 40),
  ligne('e06', 'd1', 'a-achat', '401000', 'debit', 240),
  ligne('e07', 'd1', 'f-vente', '706000', 'credit', 1000),
  ligne('e08', 'd1', 'f-vente', '411000', 'debit', 1000),
  ligne('e09', 'd1', 'a-vente', '706000', 'debit', 400),
  ligne('e10', 'd1', 'a-vente', '411000', 'credit', 400),
  ligne('e11', 'd1', 'n-frais', '625100', 'debit', 50),
  ligne('e12', 'd1', 'n-frais', '467000', 'credit', 50),
  ligne('e13', 'd1', 'n-rendu', '625100', 'credit', 50),
  ligne('e14', 'd1', 'n-rendu', '467000', 'debit', 50),
  ligne('e15', 'd2', 'f-ailleurs', '401000', 'credit', 240),
]

const LETTRAGES: LettrageManuel[] = [
  lettrage('lm1', 'd1', 'g-achat', 'f-achat', '401000'),
  lettrage('lm2', 'd1', 'g-achat', 'a-achat', '401000'),
  lettrage('lm3', 'd1', 'g-vente', 'f-vente', '411000'),
  lettrage('lm4', 'd1', 'g-vente', 'a-vente', '411000'),
  lettrage('lm5', 'd1', 'g-frais', 'n-frais', '467000'),
  lettrage('lm6', 'd1', 'g-frais', 'n-rendu', '467000'),
  lettrage('lm7', 'd2', 'g-ailleurs', 'f-ailleurs', '401000'),
]

const PIECES: Pick<Piece, 'id' | 'tiers'>[] = [
  { id: 'f-achat', tiers: 'Imprimerie Duval' }, { id: 'a-achat', tiers: 'Imprimerie Duval' },
  { id: 'f-vente', tiers: 'Atelier Corsaire' }, { id: 'a-vente', tiers: 'Atelier Corsaire' },
  { id: 'n-frais', tiers: 'Taxi Bleu' }, { id: 'n-rendu', tiers: 'Taxi Bleu' },
]

beforeEach(() => {
  faux.lettrages = LETTRAGES
  faux.brouillon = BROUILLON
  faux.lectures = []
  faux.muet = {}
  faux.erreur = {}
})

describe('lireLettragesManuels', () => {
  it('sans lettrage, ne relit pas le brouillon', async () => {
    faux.lettrages = []
    expect(await lireLettragesManuels('d1')).toEqual(AUCUN_LETTRAGE_MANUEL)
    expect(faux.lectures.map((l) => l.table)).toEqual(['lettrages_manuels'])
  })

  it('avec un lettrage, relit les seules lignes des comptes de tiers du dossier', async () => {
    const lecture = await lireLettragesManuels('d1')
    expect(lecture.motif).toBeNull()
    expect(lecture.lettrages.map((l) => l.id)).toEqual(['lm1', 'lm2', 'lm3', 'lm4', 'lm5', 'lm6'])
    expect(lecture.ecritures.map((e) => e.id)).toEqual(['e03', 'e06', 'e08', 'e10', 'e12', 'e14'])
    // Tous les comptes qui se lettrent, et eux seuls.
    const brouillon = faux.lectures.find((l) => l.table === 'ecritures_brouillon')
    expect(brouillon?.filtres).toEqual(['dossier_id=d1', `compte in ${[...COMPTES_LETTRABLES].sort().join(',')}`])
  })

  // C'est ce qui permet de ne lire que les comptes de tiers : `etatsDesLettragesManuels` ne regarde qu'eux. Comparé sur
  // un lettrage qui tient, un qui ne tient plus et un du 467 — l'égalité porte sur les états entiers, motifs compris.
  it('rend les mêmes états que le brouillon entier du dossier', async () => {
    const lecture = await lireLettragesManuels('d1')
    const surLaLecture = etatsDesLettragesManuels(lecture.ecritures, PIECES, lecture.lettrages, 'engagement')
    const surToutLeBrouillon = etatsDesLettragesManuels(
      BROUILLON.filter((e) => e.dossier_id === 'd1'), PIECES, LETTRAGES.filter((l) => l.dossier_id === 'd1'), 'engagement',
    )
    expect(surLaLecture).toEqual(surToutLeBrouillon)
    expect(surLaLecture.map((e) => [e.groupe, e.motif])).toEqual(
      expect.arrayContaining([['g-achat', null], ['g-vente', 'ne_se_solde_plus'], ['g-frais', null]]),
    )
    expect(piecesLettreesALaMain(surLaLecture)).toEqual(new Set(['f-achat', 'a-achat', 'n-frais', 'n-rendu']))
  })

  it('des lettrages lus en partie le disent, et le brouillon est relu pour ceux qui l’ont été', async () => {
    faux.muet = { lettrages_manuels: 1 }
    const lecture = await lireLettragesManuels('d1')
    expect(lecture.motif).toMatch(/1/)
    expect(lecture.lettrages).toHaveLength(1)
    expect(faux.lectures.some((l) => l.table === 'ecritures_brouillon')).toBe(true)
  })

  it('des lettrages lus en partie au point de n’en rien rendre le disent aussi', async () => {
    faux.muet = { lettrages_manuels: 0 }
    const lecture = await lireLettragesManuels('d1')
    expect(lecture.motif).not.toBeNull()
    expect(lecture.lettrages).toEqual([])
  })

  it('les lignes des comptes de tiers lues en partie le disent', async () => {
    faux.muet = { ecritures_brouillon: 2 }
    const lecture = await lireLettragesManuels('d1')
    expect(lecture.motif).not.toBeNull()
    expect(lecture.ecritures).toHaveLength(2)
  })

  it('une lecture refusée le dit, avec sa raison', async () => {
    faux.erreur = { ecritures_brouillon: 'permission denied for table ecritures_brouillon' }
    const lecture = await lireLettragesManuels('d1')
    expect(lecture.motif).toMatch(/permission denied/)
  })
})
