import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { calculerBalance } from './ecritures'
import { anneeDe } from './format'
import { etatDeLOuverture, exploitantIndividuel, ouvertureDeLExercice, type EtatDeLOuverture } from './reportDesSoldes'
import type { ANouveau, EcritureBrouillon, SensEcriture, SoldeReporte } from './types'
import { NON_VALIDEE, A_NOUVEAU_NON_VALIDE } from '../test/ecritures'

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
//
// ET LES SOLDES REPORTÉS (07/10/2026, ligne 34) : la validation d'un exercice écrit l'ouverture du suivant. L'écran
// ouvre un exercice choisi par la reprise ou par ces soldes (`ouvertureDeLExercice`), jamais toutes années confondues,
// et dit l'état de cette ouverture (`etatDeLOuverture`) — dont l'exercice qui attend la validation du précédent, dont
// les comptes de bilan partent de zéro. La copie de l'assistant est comparée aux deux fonctions de src/lib, et des
// dérives plantées dans la vraie source prouvent que ce garde sait encore échouer.

const SOURCE = new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url).pathname

interface Mouvement { date: string; compte: string; sens: SensEcriture; montant: number }
interface ANouveauLu extends Mouvement { source_nom: string }
interface CompteRendu {
  compte: string
  total_debit: number
  total_credit: number
  dont_a_nouveaux?: { debit: number; credit: number }
}
interface BalanceRendue {
  comptes: CompteRendu[]
  a_nouveaux: { date: string; compris_dans_les_totaux: boolean } | null
  ouverture_de_l_exercice: EtatDeLOuverture | null
  avertissement?: string
}
interface Copie {
  balanceDesComptes: (
    ecritures: readonly Mouvement[],
    aNouveaux: readonly ANouveauLu[],
    reportes: readonly Mouvement[],
    anneesValidees: readonly number[],
    periode: { date_debut?: string; date_fin?: string },
  ) => BalanceRendue
  etatDeLOuverture: (
    exercice: number,
    d: {
      reprise: readonly ANouveauLu[]
      reportes: readonly { date: string }[]
      anneesValidees: readonly number[]
      ecritures: readonly { date: string }[]
    },
  ) => EtatDeLOuverture
}

// VOLONTAIREMENT FRAGILE, comme les autres gardes de fonctions auto-portées : renommer une fonction ou
// retirer les bornes casse ce test bruyamment, ce qui vaut mieux qu'une copie qui dérive en silence.
function extraire(source: string): Copie {
  const debut = source.indexOf('// ── DÉBUT BALANCE')
  const fin = source.indexOf('// ── FIN BALANCE')
  expect(debut, 'bornes `── DÉBUT/FIN BALANCE` introuvables dans agent-comptable').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  const bloc = source.slice(debut, fin)
  expect(bloc, '`balanceDesComptes` absente du bloc gardé').toContain('function balanceDesComptes(')
  expect(bloc, '`etatDeLOuverture` absente du bloc gardé').toContain('function etatDeLOuverture(')
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}; return { balanceDesComptes, etatDeLOuverture }`)() as Copie
}

const sourceDeployee = () => readFileSync(SOURCE, 'utf8')
const deployee = extraire(sourceDeployee())
const balanceDesComptes = deployee.balanceDesComptes

const ecriture = (date: string, compte: string, sens: SensEcriture, montant: number): EcritureBrouillon => ({
  id: `${date}-${compte}-${sens}-${montant}`, dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null,
  date, compte, libelle: 'x', montant, sens, statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, ...NON_VALIDEE, created_at: `${date}T09:00:00Z`,
})
const aNouveau = (compte: string, sens: SensEcriture, montant: number, date = '2026-01-01'): ANouveau => ({
  id: `an-${compte}-${sens}-${montant}`, dossier_id: 'd1', date, compte, compte_origine: compte, libelle: `Compte ${compte}`,
  sens, montant, source_nom: 'balance.csv', source_empreinte: 'e'.repeat(64), ...A_NOUVEAU_NON_VALIDE, created_at: '2026-01-05T09:00:00Z',
})
const reporte = (compte: string, sens: SensEcriture, montant: number, date = '2027-01-01'): SoldeReporte => ({
  id: `sr-${date}-${compte}`, dossier_id: 'd1', date, compte, libelle: `Compte ${compte}`, sens, montant,
  source_nom: `Exercice ${anneeDe(date) - 1} validé`, source_empreinte: 'c'.repeat(64), created_at: `${date.slice(0, 4)}-02-01T09:00:00Z`,
  compte_lib: null, ecriture_lib: null,
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
  ecriture('2027-01-15', '606100', 'debit', 80),
  ecriture('2027-01-15', '512000', 'credit', 80),
]
// Ce que la validation de 2026 reporte sur 2027, pour une entreprise individuelle : la banque (8 400 repris, −300,
// +1 500,50), le matériel et l'emprunt tels quels, et le compte de l'exploitant (9 200) avec le bénéfice de 2026
// (1 200,50) au capital individuel. Puis celle de 2027 sur 2028 : la perte de 80 € en moins.
const REPORT_2026: SoldeReporte[] = [
  reporte('512000', 'debit', 9600.5),
  reporte('215400', 'debit', 3200),
  reporte('164000', 'credit', 2400),
  reporte('101000', 'credit', 10400.5),
]
const REPORT_2027: SoldeReporte[] = [
  reporte('512000', 'debit', 9520.5, '2028-01-01'),
  reporte('215400', 'debit', 3200, '2028-01-01'),
  reporte('164000', 'credit', 2400, '2028-01-01'),
  reporte('101000', 'credit', 10320.5, '2028-01-01'),
]

// Ce que montre l'onglet Balance des comptes pour la même période : son filtre, puis `calculerBalance` — et, compte par
// compte, la part de son ouverture, que l'assistant rend dans `dont_a_nouveaux` (en centimes, puis en euros).
function balanceDeLEcran(annee: number | undefined, reprise: readonly ANouveau[], reportes: readonly SoldeReporte[]): CompteRendu[] {
  const ecrituresVues = annee ? BROUILLON.filter((e) => anneeDe(e.date) === annee) : BROUILLON
  const ouverture = annee ? ouvertureDeLExercice(reprise, reportes, annee) : [...reprise]
  const parts = new Map<string, { debit: number; credit: number }>()
  for (const a of ouverture) {
    const p = parts.get(a.compte) ?? { debit: 0, credit: 0 }
    p[a.sens] += Math.round(a.montant * 100)
    parts.set(a.compte, p)
  }
  return calculerBalance(ecrituresVues, [], ouverture).map((l) => {
    const part = parts.get(l.compte)
    return {
      compte: l.compte, total_debit: l.totalDebit, total_credit: l.totalCredit,
      ...(part ? { dont_a_nouveaux: { debit: part.debit / 100, credit: part.credit / 100 } } : {}),
    }
  })
}

// Les situations comparées à l'écran : avant toute validation, 2026 validé, puis 2026 et 2027 ; avec et sans reprise.
const SITUATIONS = [
  { nom: 'rien de validé', reprise: OUVERTURE, valides: [], reportes: [] },
  { nom: '2026 validé', reprise: OUVERTURE, valides: [2026], reportes: REPORT_2026 },
  { nom: '2026 et 2027 validés', reprise: OUVERTURE, valides: [2026, 2027], reportes: [...REPORT_2026, ...REPORT_2027] },
  { nom: 'sans reprise, rien de validé', reprise: [], valides: [], reportes: [] },
  { nom: 'sans reprise, 2025 validé sans rien à reporter', reprise: [], valides: [2025], reportes: [] },
] as const satisfies readonly { nom: string; reprise: readonly ANouveau[]; valides: readonly number[]; reportes: readonly SoldeReporte[] }[]
const ANNEES = [undefined, 2025, 2026, 2027, 2028] as const

// La copie rend-elle ce que rend l'écran, compte par compte, avec l'état de l'ouverture et son avertissement ?
function memesBalances(copie: Copie) {
  for (const s of SITUATIONS) {
    for (const annee of ANNEES) {
      const quoi = `${s.nom}, ${annee ?? 'toutes années'}`
      const rendue = copie.balanceDesComptes(BROUILLON, s.reprise, s.reportes, s.valides, bornes(annee))
      expect(rendue.comptes, quoi).toEqual(balanceDeLEcran(annee, s.reprise, s.reportes))
      const etat = annee ? etatDeLOuverture(annee, { reprise: s.reprise, reportes: s.reportes, anneesValidees: s.valides, ecritures: BROUILLON }) : null
      expect(rendue.ouverture_de_l_exercice, quoi).toEqual(etat)
      // Un avertissement : toutes années, une écriture qui précède la reprise ; sur un exercice, l'ouverture qu'il attend.
      const averti = annee ? etat!.type === 'en-attente' : s.reprise.length > 0
      expect(rendue.avertissement !== undefined, quoi).toBe(averti)
    }
  }
}

// La grille de l'état de l'ouverture : chaque combinaison de reprise, d'exercices validés, de soldes reportés et de
// brouillon, sur sept exercices. Elle rend chacun des quatre états, `report` avec et sans lignes — la garde de la grille.
const GRILLE = {
  reprises: [[], OUVERTURE, [aNouveau('512000', 'debit', 100, '2025-01-01')]] as ANouveau[][],
  valides: [[], [2025], [2026], [2025, 2026], [2027], [2024, 2025, 2026, 2027]] as number[][],
  reportes: [[], REPORT_2026, [...REPORT_2026, ...REPORT_2027]] as SoldeReporte[][],
  ecritures: [[], BROUILLON, BROUILLON.filter((e) => e.date >= '2027-01-01')] as EcritureBrouillon[][],
}
function memesEtats(copie: Copie): Set<string> {
  const vus = new Set<string>()
  for (const reprise of GRILLE.reprises) for (const anneesValidees of GRILLE.valides) {
    for (const reportes of GRILLE.reportes) for (const ecritures of GRILLE.ecritures) {
      for (let exercice = 2023; exercice <= 2029; exercice += 1) {
        const d = { reprise, reportes, anneesValidees, ecritures }
        const attendu = etatDeLOuverture(exercice, d)
        expect(copie.etatDeLOuverture(exercice, d), JSON.stringify({ exercice, reprise: reprise[0]?.date ?? null, anneesValidees, reportes: reportes.length, ecritures: ecritures.length })).toEqual(attendu)
        vus.add(attendu.type === 'report' ? `report-${attendu.lignes > 0 ? 'lignes' : 'vide'}` : attendu.type)
      }
    }
  }
  return vus
}

describe('agent-comptable — la balance annoncée est celle de l’écran', () => {
  for (const s of SITUATIONS) {
    for (const annee of ANNEES) {
      it(`mêmes totaux et même part d’ouverture, compte par compte, que l’onglet Balance des comptes (${s.nom}, ${annee ?? 'toutes années'})`, () => {
        const rendue = balanceDesComptes(BROUILLON, s.reprise, s.reportes, s.valides, bornes(annee))
        expect(rendue.comptes).toEqual(balanceDeLEcran(annee, s.reprise, s.reportes))
      })
    }
  }

  it('compte l’ouverture dans l’exercice qu’elle ouvre, et dit la part qui en vient', () => {
    const rendue = balanceDesComptes(BROUILLON, OUVERTURE, [], [], bornes(2026))
    const banque = rendue.comptes.find((c) => c.compte === '512000')
    // 8 000 + 400 repris, puis −300 et +1 500,50 de l'exercice : la banque porte 9 600,50 € au débit
    // net. Sans l'ouverture, l'assistant annonçait +1 200,50 € — l'écran, lui, 9 600,50 €.
    expect(banque).toEqual({ compte: '512000', total_debit: 9900.5, total_credit: 300, dont_a_nouveaux: { debit: 8400, credit: 0 } })
    expect(rendue.a_nouveaux).toEqual({ date: '2026-01-01', compris_dans_les_totaux: true })
    expect(rendue.ouverture_de_l_exercice).toEqual({ type: 'reprise', date: '2026-01-01', source: 'balance.csv' })
    // Un compte sans à-nouveau ne porte pas de part : le modèle ne doit pas lire un zéro d'ouverture
    // là où il n'y en a aucune.
    expect(rendue.comptes.find((c) => c.compte === '625100')).not.toHaveProperty('dont_a_nouveaux')
  })

  it('compte les soldes reportés dans l’exercice qu’ils ouvrent, et dit la part qui en vient', () => {
    const rendue = balanceDesComptes(BROUILLON, OUVERTURE, REPORT_2026, [2026], bornes(2027))
    // La banque de 2027 part des 9 600,50 € reportés, puis −80 : sans eux, l'assistant annonçait −80 €.
    expect(rendue.comptes.find((c) => c.compte === '512000'))
      .toEqual({ compte: '512000', total_debit: 9600.5, total_credit: 80, dont_a_nouveaux: { debit: 9600.5, credit: 0 } })
    expect(rendue.comptes.find((c) => c.compte === '101000'))
      .toEqual({ compte: '101000', total_debit: 0, total_credit: 10400.5, dont_a_nouveaux: { debit: 0, credit: 10400.5 } })
    // Le compte de l'exploitant est passé au capital individuel : 2027 repart d'un 108 vide.
    expect(rendue.comptes.some((c) => c.compte === '108000')).toBe(false)
    expect(rendue.comptes.find((c) => c.compte === '606100')).not.toHaveProperty('dont_a_nouveaux')
    expect(rendue.ouverture_de_l_exercice).toEqual({ type: 'report', depuis: 2026, lignes: 4 })
    // La reprise, elle, n'est pas dans ces totaux, et le résultat le dit.
    expect(rendue.a_nouveaux).toEqual({ date: '2026-01-01', compris_dans_les_totaux: false })
    expect(rendue).not.toHaveProperty('avertissement')
  })

  it('ne compte JAMAIS les soldes reportés toutes années confondues : les écritures de l’exercice validé y sont déjà', () => {
    const rendue = balanceDesComptes(BROUILLON, OUVERTURE, [...REPORT_2026, ...REPORT_2027], [2026, 2027], bornes())
    expect(rendue.comptes.find((c) => c.compte === '101000')).toBeUndefined()
    expect(rendue.comptes.find((c) => c.compte === '512000'))
      .toEqual({ compte: '512000', total_debit: 9900.5, total_credit: 500, dont_a_nouveaux: { debit: 8400, credit: 0 } })
    expect(rendue.ouverture_de_l_exercice).toBeNull()
  })

  it('un solde reporté n’ouvre que l’exercice de sa date', () => {
    const reportes = [...REPORT_2026, ...REPORT_2027]
    const banque = (annee: number) =>
      balanceDesComptes(BROUILLON, OUVERTURE, reportes, [2026, 2027], bornes(annee)).comptes.find((c) => c.compte === '512000')
    expect(banque(2026)?.dont_a_nouveaux).toEqual({ debit: 8400, credit: 0 })
    expect(banque(2027)?.dont_a_nouveaux).toEqual({ debit: 9600.5, credit: 0 })
    expect(banque(2028)?.dont_a_nouveaux).toEqual({ debit: 9520.5, credit: 0 })
    expect(balanceDesComptes(BROUILLON, OUVERTURE, reportes, [2026, 2027], bornes(2028)).ouverture_de_l_exercice)
      .toEqual({ type: 'report', depuis: 2027, lignes: 4 })
  })

  it('AVERTIT quand l’exercice demandé attend la validation du précédent : ses comptes de bilan partent de zéro', () => {
    const rendue = balanceDesComptes(BROUILLON, OUVERTURE, [], [], bornes(2027))
    expect(rendue.ouverture_de_l_exercice).toEqual({ type: 'en-attente', exercice: 2026 })
    expect(rendue.avertissement).toContain('L\'exercice 2027 n\'a pas encore d\'ouverture : elle s\'écrira à la validation de l\'exercice 2026')
    expect(rendue.avertissement).toContain('la banque n\'y porte que les mouvements de 2027')
    expect(rendue.avertissement).toContain('redemande la balance toutes années confondues (sans annee)')
    // Sans reprise aussi : le brouillon de 2025 précède 2026, qui attend la validation de 2025.
    const sansReprise = balanceDesComptes(BROUILLON, [], [], [], bornes(2026))
    expect(sansReprise.ouverture_de_l_exercice).toEqual({ type: 'en-attente', exercice: 2025 })
    expect(sansReprise.avertissement).toContain('L\'exercice 2026 n\'a pas encore d\'ouverture : elle s\'écrira à la validation de l\'exercice 2025')
  })

  it('ne la compte pas dans un autre exercice, mais dit qu’elle existe', () => {
    // 2027, dont l'exercice précédent n'est pas validé, n'a que ses propres mouvements, et 2025 précède la reprise :
    // dans les deux cas la reprise est HORS des totaux — et le modèle doit le savoir, sans quoi il prendrait la banque de
    // 2027 pour son solde.
    for (const annee of [2025, 2027]) {
      const rendue = balanceDesComptes(BROUILLON, OUVERTURE, [], [], bornes(annee))
      expect(rendue.a_nouveaux).toEqual({ date: '2026-01-01', compris_dans_les_totaux: false })
      expect(rendue.comptes.some((c) => c.dont_a_nouveaux)).toBe(false)
    }
    expect(balanceDesComptes(BROUILLON, OUVERTURE, [], [], bornes(2025)).ouverture_de_l_exercice).toEqual({ type: 'sans-objet' })
  })

  it('toutes années confondues, AVERTIT quand une écriture précède l’ouverture', () => {
    const rendue = balanceDesComptes(BROUILLON, OUVERTURE, [], [], bornes())
    expect(rendue.a_nouveaux).toEqual({ date: '2026-01-01', compris_dans_les_totaux: true })
    expect(rendue.avertissement).toContain('2 écriture(s) du brouillon précèdent l\'ouverture du 2026-01-01')
    expect(rendue.avertissement).toContain('une seconde fois sur les comptes de bilan')
  })

  it('se TAIT quand rien ne précède l’ouverture, et sur un exercice qui a la sienne', () => {
    // Garde symétrique : sans lui, « avertit quand il faut » serait satisfait par un résultat qui
    // avertit toujours — et une mise en garde permanente cesse d'être lue.
    const apres = BROUILLON.filter((e) => e.date >= '2026-01-01')
    expect(balanceDesComptes(apres, OUVERTURE, [], [], bornes())).not.toHaveProperty('avertissement')
    // Avant la reprise, l'exercice de la reprise, un exercice ouvert par un report — même vide.
    for (const [annee, reportes, valides] of [
      [2025, [], []], [2026, [], []], [2027, REPORT_2026, [2026]], [2027, [], [2026]],
    ] as const) {
      expect(balanceDesComptes(BROUILLON, OUVERTURE, reportes, valides, bornes(annee))).not.toHaveProperty('avertissement')
    }
    expect(balanceDesComptes(BROUILLON, OUVERTURE, [], [2026], bornes(2027)).ouverture_de_l_exercice)
      .toEqual({ type: 'report', depuis: 2026, lignes: 0 })
    // Le premier exercice d'une activité nouvelle n'attend aucune ouverture.
    expect(balanceDesComptes(apres, [], [], [], bornes(2026))).not.toHaveProperty('avertissement')
    expect(balanceDesComptes(apres, [], [], [], bornes(2026)).ouverture_de_l_exercice).toEqual({ type: 'sans-objet' })
  })

  it('un dossier sans reprise rend la balance du seul brouillon, sans ouverture ni avertissement', () => {
    const rendue = balanceDesComptes(BROUILLON, [], [], [], bornes())
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
    ], [], [], [], bornes())
    expect(rendue.comptes).toEqual([
      { compte: '606100', total_debit: 0.3, total_credit: 0 },
      { compte: '606400', total_debit: 0.21, total_credit: 0 },
    ])
  })

  it('compare toute la batterie à l’écran, état de l’ouverture et avertissement compris', () => {
    memesBalances(deployee)
  })
})

describe('agent-comptable — l’état de l’ouverture est celui de l’écran', () => {
  it('rend, sur toute la grille, ce que rend `etatDeLOuverture` de src/lib — et la grille rend chacun des états', () => {
    expect([...memesEtats(deployee)].sort()).toEqual(['en-attente', 'report-lignes', 'report-vide', 'reprise', 'sans-objet'])
  })
})

// ── LE CÂBLAGE, QUI EST UNE AUTRE QUESTION ───────────────────────────────────────────────────────
// Le bloc ci-dessus peut rester juste pendant que l'outil cesse de l'appeler, ou lui passe des
// à-nouveaux déjà filtrés sur la période — ce qui ferait disparaître l'ouverture d'un autre exercice
// au lieu de dire qu'elle existe. Pas d'écran ici : c'est la source qui répond.
describe('agent-comptable — les outils lisent les à-nouveaux et les soldes reportés', () => {
  const source = sourceDeployee()
  const brancheDe = (outil: string) => {
    const debut = source.indexOf(`if (nom === "${outil}")`)
    expect(debut, `branche de l’outil ${outil} introuvable`).toBeGreaterThan(-1)
    const fin = source.indexOf('if (nom === "', debut + 1)
    return source.slice(debut, fin)
  }

  it('lister_comptes rend `balanceDesComptes` sur le brouillon, les à-nouveaux, les soldes reportés et les exercices validés', () => {
    const branche = brancheDe('lister_comptes')
    expect(branche).toContain('return balanceDesComptes(lu.lignes, luANouveaux.lignes, luReportes.lignes, luValides.lignes.map((v) => v.annee), periode)')
    // Chacune de ces lectures, incomplète, fait refuser : une ouverture amputée fausse les soldes de bilan, et des
    // exercices validés lus en partie diraient en attente une ouverture écrite.
    for (const lecture of ['lu', 'luANouveaux', 'luReportes', 'luValides']) {
      expect(branche).toMatch(new RegExp(`if \\(!${lecture}\\.complete\\) return \\{ erreur:`))
    }
  })

  it('lister_comptes lit le brouillon, les à-nouveaux et les soldes reportés SANS filtre de période', () => {
    // Le brouillon entier : une écriture d'un exercice antérieur dit qu'une activité précède l'exercice demandé.
    const branche = brancheDe('lister_comptes')
    for (const table of ['ecritures_brouillon', 'a_nouveaux', 'soldes_reportes', 'exercices_valides']) {
      const debut = branche.indexOf(`.from("${table}")`)
      expect(debut, `lecture de ${table} introuvable dans lister_comptes`).toBeGreaterThan(-1)
      const lecture = branche.slice(debut)
      const chaine = lecture.slice(0, lecture.indexOf('.range('))
      expect(chaine).toContain('.eq("dossier_id", dossierId)')
      expect(chaine, table).not.toMatch(/\.(gte|lte|gt|lt)\(/)
    }
  })

  it('lister_comptes lit le fichier dont vient la reprise, que l’état de son ouverture nomme', () => {
    expect(brancheDe('lister_comptes')).toContain('admin.from("a_nouveaux").select("date, compte, sens, montant, source_nom"')
  })

  it('resume_dossier dit si le dossier a été repris, et refuse sur une ouverture illisible', () => {
    const branche = brancheDe('resume_dossier')
    expect(branche).toContain('.from("a_nouveaux")')
    expect(branche).toMatch(/if \(!r5\.complete\) \{\s*return \{ erreur:/)
    expect(branche).toContain('a_nouveaux: r5.lignes.length > 0 ? { date: r5.lignes[0].date, nombre_de_lignes: r5.lignes.length } : null')
  })

  // LE PROMPT DIT CE QUE DEVIENNENT LE COMPTE DE L'EXPLOITANT ET LE RÉSULTAT, selon que le dossier est une entreprise
  // individuelle ou une société : la règle de `exploitantIndividuel` (src/lib/reportDesSoldes.ts), celle de la base. Sa
  // condition est EXÉCUTÉE ici sur chaque modèle, et comparée à la règle — une condition inversée ferait annoncer au
  // modèle un 120000 là où la validation écrit un 101000.
  it('le prompt dit la règle du report qui vaut pour le dossier, celle de src/lib', () => {
    const trouve = /\$\{(dossierRow\.[^?]+?) \? "le résultat y attend son affectation, au 120000 pour un bénéfice et au 129000 pour une perte" : "le compte de l'exploitant et le résultat passent au 101000 Capital individuel, et l'exercice repart d'un compte de l'exploitant vide"\}/.exec(source)
    expect(trouve, 'la phrase du report introuvable dans le prompt').not.toBeNull()
    const societe = new Function('dossierRow', `return (${trouve![1]})`) as (d: { mode_comptable: string; compte_notes_de_frais: string }) => boolean
    for (const mode of ['tresorerie', 'engagement'] as const) {
      for (const compteNotesDeFrais of ['455000', '108000', '467000'] as const) {
        expect(societe({ mode_comptable: mode, compte_notes_de_frais: compteNotesDeFrais }), `${mode}, ${compteNotesDeFrais}`)
          .toBe(!exploitantIndividuel({ mode, compteNotesDeFrais }))
      }
    }
  })

  it('la description de l’outil et le prompt disent ce qu’est une ouverture reportée', () => {
    expect(source).toMatch(/La VALIDATION d'un exercice écrit l'ouverture du suivant \(ses SOLDES REPORTÉS, journal AN\)/)
    expect(source).toMatch(/ouverture_de_l_exercice \(pour un exercice demandé : \{ type: reprise \| report/)
    expect(source).toMatch(/- La VALIDATION d'un exercice écrit l'OUVERTURE de l'exercice suivant — ses SOLDES REPORTÉS/)
    expect(source).not.toMatch(/Les soldes ne sont pas encore reportés d'un exercice sur l'autre/)
  })
})

describe('le garde-fou du bloc BALANCE sait encore échouer', () => {
  const planter = (...remplacements: [string, string][]) => {
    let source = sourceDeployee()
    for (const [avant, apres] of remplacements) {
      expect(source.split(avant).length - 1, `motif à planter introuvable ou ambigu : ${avant}`).toBe(1)
      source = source.replace(avant, apres)
    }
    return extraire(source)
  }
  // Une dérive doit faire échouer une ASSERTION, pas lever pour une autre raison.
  const echoue = (f: () => void) => {
    let erreur: unknown = null
    try { f() } catch (e) { erreur = e }
    expect((erreur as Error | null)?.name, `la dérive n'a pas fait échouer une assertion : ${String(erreur)}`).toBe('AssertionError')
  }

  it('l’exercice précédent pris pour l’exercice lui-même', () => {
    echoue(() => memesEtats(planter(['if (d.anneesValidees.includes(exercice - 1)) {', 'if (d.anneesValidees.includes(exercice)) {'])))
  })
  it('la reprise d’un exercice antérieur prise pour celle de l’exercice', () => {
    echoue(() => memesEtats(planter(['d.reprise.filter((a) => Number(a.date.slice(0, 4)) === exercice)', 'd.reprise.filter((a) => Number(a.date.slice(0, 4)) <= exercice)'])))
  })
  it('un exercice antérieur à la reprise qui attendrait une ouverture', () => {
    echoue(() => memesEtats(planter(['  if (dateReprise !== null && debut < dateReprise) return { type: "sans-objet" }\n', ''])))
  })
  it('les soldes reportés comptés sans regarder leur date', () => {
    echoue(() => memesEtats(planter(['lignes: d.reportes.filter((s) => s.date === debut).length', 'lignes: d.reportes.length'])))
  })
  it('le brouillon oublié : un exercice précédé d’écritures n’attendrait rien', () => {
    echoue(() => memesEtats(planter([' || d.ecritures.some((e) => e.date < debut)', ''])))
  })
  it('les exercices validés oubliés : un exercice qui suit un exercice validé n’attendrait rien', () => {
    echoue(() => memesEtats(planter([' || d.anneesValidees.some((a) => a < exercice)', ''])))
  })
  it('les soldes reportés comptés toutes années confondues', () => {
    echoue(() => memesBalances(planter(['const reportesRetenus = exercice === null ? [] :', 'const reportesRetenus = exercice === null ? reportes :'])))
  })
  it('les soldes reportés d’un autre exercice comptés dans celui-ci', () => {
    echoue(() => memesBalances(planter(['reportes.filter((r) => r.date === `${exercice}-01-01`)', 'reportes'])))
  })
  it('les soldes reportés comptés sans leur part d’ouverture', () => {
    echoue(() => memesBalances(planter(['for (const r of reportesRetenus) cumuler(r, true)', 'for (const r of reportesRetenus) cumuler(r, false)'])))
  })
  it('l’état de l’ouverture tiré d’un brouillon vide', () => {
    echoue(() => memesBalances(planter(['etatDeLOuverture(exercice, { reprise: aNouveaux, reportes, anneesValidees, ecritures })', 'etatDeLOuverture(exercice, { reprise: aNouveaux, reportes, anneesValidees, ecritures: [] })'])))
  })
  it('l’exercice en attente tu', () => {
    echoue(() => memesBalances(planter([': etat?.type === "en-attente"', ': etat?.type === "jamais"'])))
  })
  it('l’état de l’ouverture jamais rendu', () => {
    echoue(() => memesBalances(planter(['    ouverture_de_l_exercice: etat,\n', '    ouverture_de_l_exercice: null,\n'])))
  })
})
