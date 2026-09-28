import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { calculerBalance } from './ecritures'
import { anneeDe } from './format'
import type { ANouveau, EcritureBrouillon, SensEcriture } from './types'

// L'ASSISTANT ANNONCE LA MÊME BALANCE QUE L'ÉCRAN, À-NOUVEAUX COMPRIS (26/09/2026).
//
// `agent-comptable` ne lisait que le brouillon : sur un dossier repris d'un autre logiciel, il aurait
// donné pour la banque le seul solde de ses mouvements pendant que la Balance des comptes, sur le même
// dossier, part des soldes repris. Deux livrables, deux réponses, et celui-ci parle en français à un
// comptable qui n'ira pas vérifier — la panne déjà payée par `analyserEcritures`.
//
// La fonction est auto-portée (une Edge Function n'importe rien de `src/`), donc elle est gardée comme
// les autres copies : on EXTRAIT le bloc de la vraie source, on le transpile, et on l'EXÉCUTE contre
// `calculerBalance` de src/lib — une référence extérieure à la copie, jamais la copie contre elle-même.
// La règle de période est celle de l'écran (StatistiquesTab) : un à-nouveau appartient à l'exercice
// qu'il ouvre, comme une écriture à celui de sa date.

const SOURCE = new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url).pathname

interface Mouvement { date: string; compte: string; sens: SensEcriture; montant: number }
interface CompteRendu {
  compte: string
  total_debit: number
  total_credit: number
  dont_a_nouveaux?: { debit: number; credit: number }
}
interface BalanceRendue {
  comptes: CompteRendu[]
  a_nouveaux: { date: string; compris_dans_les_totaux: boolean } | null
  avertissement?: string
}
type BalanceDesComptes = (
  ecritures: readonly Mouvement[],
  aNouveaux: readonly Mouvement[],
  periode: { date_debut?: string; date_fin?: string },
) => BalanceRendue

// VOLONTAIREMENT FRAGILE, comme les autres gardes de fonctions auto-portées : renommer la fonction ou
// retirer les bornes casse ce test bruyamment, ce qui vaut mieux qu'une copie qui dérive en silence.
function extraire(source: string): BalanceDesComptes {
  const debut = source.indexOf('// ── DÉBUT BALANCE')
  const fin = source.indexOf('// ── FIN BALANCE')
  expect(debut, 'bornes `── DÉBUT/FIN BALANCE` introuvables dans agent-comptable').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  const bloc = source.slice(debut, fin)
  expect(bloc, '`balanceDesComptes` absente du bloc gardé').toContain('function balanceDesComptes(')
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}; return balanceDesComptes`)() as BalanceDesComptes
}

const balanceDesComptes = extraire(readFileSync(SOURCE, 'utf8'))

const ecriture = (date: string, compte: string, sens: SensEcriture, montant: number): EcritureBrouillon => ({
  id: `${date}-${compte}-${sens}-${montant}`, dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null,
  date, compte, libelle: 'x', montant, sens, statut: 'proposee', created_at: `${date}T09:00:00Z`,
})
const aNouveau = (compte: string, sens: SensEcriture, montant: number, date = '2026-01-01'): ANouveau => ({
  id: `an-${compte}-${sens}-${montant}`, dossier_id: 'd1', date, compte, compte_origine: compte, libelle: `Compte ${compte}`,
  sens, montant, source_nom: 'balance.csv', source_empreinte: 'e'.repeat(64), created_at: '2026-01-05T09:00:00Z',
})
const bornes = (annee?: number) => (annee ? { date_debut: `${annee}-01-01`, date_fin: `${annee}-12-31` } : {})

// Un dossier repris au 1er janvier 2026 : banque sur deux comptes de la balance réunis au 512000,
// une immobilisation, un emprunt, le compte de l'exploitant. Une écriture de 2025 le précède.
const OUVERTURE: ANouveau[] = [
  aNouveau('512000', 'debit', 8000),
  aNouveau('512000', 'debit', 400),
  aNouveau('215400', 'debit', 3200),
  aNouveau('164000', 'credit', 2400),
  aNouveau('108000', 'credit', 9200),
]
const BROUILLON: EcritureBrouillon[] = [
  ecriture('2025-11-12', '606100', 'debit', 120),
  ecriture('2025-11-12', '512000', 'credit', 120),
  ecriture('2026-02-10', '625100', 'debit', 300),
  ecriture('2026-02-10', '512000', 'credit', 300),
  ecriture('2026-03-04', '706000', 'credit', 1500.5),
  ecriture('2026-03-04', '512000', 'debit', 1500.5),
]

// Ce que montre l'onglet Balance des comptes pour la même période : son filtre, puis `calculerBalance`.
function balanceDeLEcran(annee?: number) {
  const ecrituresVues = annee ? BROUILLON.filter((e) => anneeDe(e.date) === annee) : BROUILLON
  const aNouveauxVus = annee ? OUVERTURE.filter((a) => anneeDe(a.date) === annee) : OUVERTURE
  return calculerBalance(ecrituresVues, [], aNouveauxVus)
    .map((l) => ({ compte: l.compte, total_debit: l.totalDebit, total_credit: l.totalCredit }))
}

describe('agent-comptable — la balance annoncée est celle de l’écran', () => {
  for (const annee of [undefined, 2025, 2026, 2027]) {
    it(`mêmes totaux, compte par compte, que l’onglet Balance des comptes (${annee ?? 'toutes années'})`, () => {
      const rendue = balanceDesComptes(BROUILLON, OUVERTURE, bornes(annee))
      const sansPart = rendue.comptes.map(({ compte, total_debit, total_credit }) => ({ compte, total_debit, total_credit }))
      expect(sansPart).toEqual(balanceDeLEcran(annee))
    })
  }

  it('compte l’ouverture dans l’exercice qu’elle ouvre, et dit la part qui en vient', () => {
    const rendue = balanceDesComptes(BROUILLON, OUVERTURE, bornes(2026))
    const banque = rendue.comptes.find((c) => c.compte === '512000')
    // 8 000 + 400 repris, puis −300 et +1 500,50 de l'exercice : la banque porte 9 600,50 € au débit
    // net. Sans l'ouverture, l'assistant annonçait +1 200,50 € — l'écran, lui, 9 600,50 €.
    expect(banque).toEqual({ compte: '512000', total_debit: 9900.5, total_credit: 300, dont_a_nouveaux: { debit: 8400, credit: 0 } })
    expect(rendue.a_nouveaux).toEqual({ date: '2026-01-01', compris_dans_les_totaux: true })
    // Un compte sans à-nouveau ne porte pas de part : le modèle ne doit pas lire un zéro d'ouverture
    // là où il n'y en a aucune.
    expect(rendue.comptes.find((c) => c.compte === '625100')).not.toHaveProperty('dont_a_nouveaux')
  })

  it('ne la compte pas dans un autre exercice, mais dit qu’elle existe', () => {
    // 2027 n'a que ses propres mouvements (pas de report d'un exercice sur l'autre, ligne 34), et 2025
    // précède la reprise : dans les deux cas l'ouverture est HORS des totaux — et le modèle doit le
    // savoir, sans quoi il prendrait la banque de 2027 pour son solde.
    for (const annee of [2025, 2027]) {
      const rendue = balanceDesComptes(BROUILLON, OUVERTURE, bornes(annee))
      expect(rendue.a_nouveaux).toEqual({ date: '2026-01-01', compris_dans_les_totaux: false })
      expect(rendue.comptes.some((c) => c.dont_a_nouveaux)).toBe(false)
    }
  })

  it('toutes années confondues, AVERTIT quand une écriture précède l’ouverture', () => {
    const rendue = balanceDesComptes(BROUILLON, OUVERTURE, bornes())
    expect(rendue.a_nouveaux).toEqual({ date: '2026-01-01', compris_dans_les_totaux: true })
    expect(rendue.avertissement).toContain('2 écriture(s) du brouillon précèdent l\'ouverture du 2026-01-01')
    expect(rendue.avertissement).toContain('une seconde fois sur les comptes de bilan')
  })

  it('se TAIT quand rien ne précède l’ouverture, et sur un exercice choisi', () => {
    // Garde symétrique : sans lui, « avertit quand il faut » serait satisfait par un résultat qui
    // avertit toujours — et une mise en garde permanente cesse d'être lue.
    const apres = BROUILLON.filter((e) => e.date >= '2026-01-01')
    expect(balanceDesComptes(apres, OUVERTURE, bornes())).not.toHaveProperty('avertissement')
    for (const annee of [2025, 2026, 2027]) {
      expect(balanceDesComptes(BROUILLON, OUVERTURE, bornes(annee))).not.toHaveProperty('avertissement')
    }
  })

  it('un dossier sans reprise rend la balance du seul brouillon, sans ouverture ni avertissement', () => {
    const rendue = balanceDesComptes(BROUILLON, [], bornes())
    expect(rendue.a_nouveaux).toBeNull()
    expect(rendue).not.toHaveProperty('avertissement')
    expect(rendue.comptes.some((c) => c.dont_a_nouveaux)).toBe(false)
    expect(rendue.comptes.map(({ compte, total_debit, total_credit }) => ({ compte, total_debit, total_credit })))
      .toEqual(calculerBalance(BROUILLON, [], []).map((l) => ({ compte: l.compte, total_debit: l.totalDebit, total_credit: l.totalCredit })))
  })

  it('additionne au centime, sans la dérive des flottants', () => {
    // Deux dérives distinctes : additionner les montants (0,1 + 0,2 = 0,30000000000000004), et
    // additionner des centimes non arrondis — 0,07 × 100 vaut 7,000000000000001, et la somme avec
    // 0,14 ressort à 0,21000000000000005. Chaque ligne est donc ramenée à un nombre ENTIER de centimes.
    const rendue = balanceDesComptes([
      { date: '2026-01-10', compte: '606100', sens: 'debit', montant: 0.1 },
      { date: '2026-01-11', compte: '606100', sens: 'debit', montant: 0.2 },
      { date: '2026-01-12', compte: '606400', sens: 'debit', montant: 0.07 },
      { date: '2026-01-13', compte: '606400', sens: 'debit', montant: 0.14 },
    ], [], bornes())
    expect(rendue.comptes).toEqual([
      { compte: '606100', total_debit: 0.3, total_credit: 0 },
      { compte: '606400', total_debit: 0.21, total_credit: 0 },
    ])
  })
})

// ── LE CÂBLAGE, QUI EST UNE AUTRE QUESTION ───────────────────────────────────────────────────────
// Le bloc ci-dessus peut rester juste pendant que l'outil cesse de l'appeler, ou lui passe des
// à-nouveaux déjà filtrés sur la période — ce qui ferait disparaître l'ouverture d'un autre exercice
// au lieu de dire qu'elle existe. Pas d'écran ici : c'est la source qui répond.
describe('agent-comptable — les outils lisent les à-nouveaux', () => {
  const source = readFileSync(SOURCE, 'utf8')
  const brancheDe = (outil: string) => {
    const debut = source.indexOf(`if (nom === "${outil}")`)
    expect(debut, `branche de l’outil ${outil} introuvable`).toBeGreaterThan(-1)
    const fin = source.indexOf('if (nom === "', debut + 1)
    return source.slice(debut, fin)
  }

  it('lister_comptes rend `balanceDesComptes` sur le brouillon ET les à-nouveaux', () => {
    const branche = brancheDe('lister_comptes')
    expect(branche).toContain('return balanceDesComptes(lu.lignes, luANouveaux.lignes, periode)')
    expect(branche).toMatch(/if \(!luANouveaux\.complete\) return \{ erreur:/)
  })

  it('lister_comptes lit les à-nouveaux SANS filtre de période', () => {
    const branche = brancheDe('lister_comptes')
    const lecture = branche.slice(branche.indexOf('.from("a_nouveaux")'))
    const chaine = lecture.slice(0, lecture.indexOf('.range('))
    expect(chaine).toContain('.eq("dossier_id", dossierId)')
    expect(chaine).not.toMatch(/\.(gte|lte|gt|lt)\(/)
  })

  it('resume_dossier dit si le dossier a été repris, et refuse sur une ouverture illisible', () => {
    const branche = brancheDe('resume_dossier')
    expect(branche).toContain('.from("a_nouveaux")')
    expect(branche).toMatch(/if \(!r5\.complete\) \{\s*return \{ erreur:/)
    expect(branche).toContain('a_nouveaux: r5.lignes.length > 0 ? { date: r5.lignes[0].date, nombre_de_lignes: r5.lignes.length } : null')
  })
})
