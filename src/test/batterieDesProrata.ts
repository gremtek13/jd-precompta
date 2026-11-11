import { entierTire, tirage } from './encaissementsBatterie'

// LA BATTERIE DU PRORATA DES HONORAIRES (ligne 47, LM7-Q4 (C), 11/11/2026 ; la migration `honoraires_factures`,
// PRÉPARÉE). La part d'un forfait pour une partie de sa période civile se calcule deux fois : dans l'application
// (`centimesAuProrata`, src/lib/honorairesAFacturer.ts), qui la dit avant le clic (« 17 jours sur 31 »), et dans la base
// (`honoraires_au_prorata`), qui compose la ligne du brouillon. Les deux doivent rendre le MÊME centime. Cette batterie
// tire, d'une graine fixe, des parts de toutes les formes : chaque périodicité, des mois de 28 à 31 jours, des trimestres
// de 90 à 92, des années de 365 et 366 (2000 et 2028 bissextiles, 2100 non) ; la période entière, son début, sa fin, un
// seul jour, une part au milieu ; des prix d'un centime à 999 999 999,99 €, dont des prix impairs qui tombent au
// demi-centime. honorairesAuProrataBatterie.test.ts en fige l'empreinte et celle que la base a rendue sur les mêmes
// parts ; supabase/essais/batterieDesProrata.mjs la fait juger par une base. Données FICTIVES.

/** La graine du tirage, et le nombre de parts. */
export const GRAINE_DES_PRORATA = 20261111
export const NOMBRE_DE_PRORATA = 6000

export type PeriodiciteTiree = 'mois' | 'trimestre' | 'annee'

export interface PartTiree {
  /** Le prix de la période entière, en euros, au centime (l'écriture décimale que JSON envoie à la base). */
  montant_ht: number
  periodicite: PeriodiciteTiree
  debut: string
  fin: string
}

/** Les parts que l'essai et le module écrivent en toutes lettres, en tête : janvier du 15, les deux moitiés d'avril à
 *  100,01 €, le 29 février d'une année bissextile, le dernier jour d'un trimestre. */
export const PARTS_NOMMEES: readonly PartTiree[] = [
  { montant_ht: 100.01, periodicite: 'mois', debut: '2026-01-15', fin: '2026-01-31' },
  { montant_ht: 100.01, periodicite: 'mois', debut: '2026-04-01', fin: '2026-04-15' },
  { montant_ht: 100.01, periodicite: 'mois', debut: '2026-04-16', fin: '2026-04-30' },
  { montant_ht: 1200, periodicite: 'annee', debut: '2028-02-29', fin: '2028-02-29' },
  { montant_ht: 300, periodicite: 'trimestre', debut: '2026-03-31', fin: '2026-03-31' },
]

const deux = (n: number) => String(n).padStart(2, '0')
const iso = (a: number, m: number, j: number) => `${a}-${deux(m)}-${deux(j)}`
const joursDuMois = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate()
const MOIS_PAR = { mois: 1, trimestre: 3, annee: 12 } as const

/** Le jour d'indice `k` (0 pour le premier) d'une période de `n` mois commençant le premier du mois (a, m). */
function jourDe(a: number, m: number, k: number): string {
  let [aa, mm, reste] = [a, m, k]
  for (;;) {
    const n = joursDuMois(aa, mm)
    if (reste < n) return iso(aa, mm, reste + 1)
    reste -= n
    mm += 1
    if (mm === 13) [aa, mm] = [aa + 1, 1]
  }
}

function joursDeLaPeriode(a: number, m: number, mois: number): number {
  let n = 0
  for (let i = 0; i < mois; i += 1) {
    const total = a * 12 + (m - 1) + i
    n += joursDuMois(Math.floor(total / 12), (total % 12) + 1)
  }
  return n
}

/** Les parts de la batterie : les parts nommées, puis des parts tirées, toutes distinctes. */
export function partsTirees(graine = GRAINE_DES_PRORATA, nombre = NOMBRE_DE_PRORATA): PartTiree[] {
  const suivant = tirage(graine)
  const entier = (n: number) => entierTire(suivant, n)
  const vues = new Set<string>()
  const parts: PartTiree[] = []
  const ajouter = (p: PartTiree) => {
    const cle = `${p.montant_ht}|${p.periodicite}|${p.debut}|${p.fin}`
    if (vues.has(cle)) return
    vues.add(cle)
    parts.push(p)
  }
  PARTS_NOMMEES.forEach(ajouter)
  const annees = [2000, 2025, 2026, 2027, 2028, 2100]
  while (parts.length < nombre) {
    const periodicite = (['mois', 'trimestre', 'annee'] as const)[entier(3)]
    const a = entier(4) === 0 ? 2000 + entier(101) : annees[entier(annees.length)]
    const m = periodicite === 'annee' ? 1 : periodicite === 'trimestre' ? 1 + 3 * entier(4) : 1 + entier(12)
    const n = joursDeLaPeriode(a, m, MOIS_PAR[periodicite])
    let premier: number
    let dernier: number
    switch (entier(5)) {
      case 0: [premier, dernier] = [0, n - 1]; break
      case 1: [premier, dernier] = [0, entier(n)]; break
      case 2: [premier, dernier] = [entier(n), n - 1]; break
      case 3: premier = entier(n); dernier = premier; break
      default: { const x = entier(n); const y = entier(n); [premier, dernier] = x <= y ? [x, y] : [y, x] }
    }
    // Le prix : petit, impair (le demi-centime), rond, ou très grand ; toujours au centime, d'un centime au plafond.
    let centimes: number
    switch (entier(4)) {
      case 0: centimes = 1 + entier(1000); break
      case 1: centimes = 2 * entier(5_000_000) + 1; break
      case 2: centimes = 100 * (1 + entier(100_000)); break
      default: centimes = 1 + entier(99_999_999_999)
    }
    ajouter({ montant_ht: centimes / 100, periodicite, debut: jourDe(a, m, premier), fin: jourDe(a, m, dernier) })
  }
  return parts
}

/** L'écriture d'une part, telle que la base la reçoit et que les empreintes la comptent. */
export function partEcrite(p: PartTiree): string {
  return `${p.montant_ht}|${p.periodicite}|${p.debut}|${p.fin}`
}
