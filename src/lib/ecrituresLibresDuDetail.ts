import { formatMoney } from './format'
import { indexDesEcrituresLibres, referenceDeLEcritureLibre, type EcrituresLibresDesExports } from './ecrituresLibresDesExports'
import type { EcritureBrouillon } from './types'

// L'ÉCRITURE LIBRE DANS LE DÉTAIL D'UN COMPTE (EL6 ; conception docs/conceptions/54-ecriture-libre-de-l-expert-comptable.md,
// § 5.5). Pur, sans réseau et sans import de `supabase.ts`. La balance (`calculerBalance`) et le bilan (`lib/bilan.ts`) lisent
// TOUTES les lignes du brouillon : une ligne d'écriture libre y compte déjà, sans changement. Ce module dit, compte par compte,
// la PART qui en vient et sous quels numéros — « écriture libre n° EL2026-0003 » —, pour que le détail ne la montre jamais comme
// une ligne venue de nulle part : elle n'a ni pièce ni mouvement, et sa source est l'état des écritures libres (EL-Q8 (A)).
//
// Rien de ce que l'expert a saisi n'entre dans la marque : ni le libellé, ni le motif, ni le libellé d'un compte — le numéro,
// composé de l'exercice et du rang (`referenceDeLEcritureLibre`), et un montant. Une ligne dont l'écriture n'est pas dans la
// lecture (les écritures libres pas encore revenues, illisibles, ou une ligne hors du jeu lu) se marque quand même, « numéro non
// lu » : la base garantit qu'une ligne qui porte `ecriture_libre_id` vient d'une écriture libre (la clé est sans action, et
// `retirer_ecriture_libre` retire les lignes d'abord), ce que le détail dit sans deviner le numéro.

/** La part d'un compte qui vient des écritures libres : ses lignes, leur solde (débit positif) et leurs numéros. */
export interface PartLibreDuCompte {
  compte: string
  lignes: number
  // En centimes, débit positif, comme `solde_du_compte` : chaque ligne pour Math.round(montant × 100).
  soldeCentimes: number
  // Les numéros des écritures, « EL2026-0003 », dans l'ordre des écritures ; l'extourne nommée à part : « EL2025-0004 (extourne) ».
  references: string[]
  // Les lignes dont l'écriture n'est pas dans la lecture : leur numéro ne se dit pas.
  nonLues: number
}

/**
 * La part des écritures libres dans chaque compte des lignes données (l'appelant filtre l'exercice) ; aucun compte qui n'en porte
 * pas. `libres` nul : la lecture n'est pas revenue, ou n'a pas pu se faire — les lignes se comptent, sans numéro.
 */
export function partsLibresDesComptes(
  ecritures: readonly Pick<EcritureBrouillon, 'compte' | 'sens' | 'montant' | 'date' | 'ecriture_libre_id'>[],
  libres: EcrituresLibresDesExports | null,
): ReadonlyMap<string, PartLibreDuCompte> {
  const index = libres === null ? new Map() : indexDesEcrituresLibres(libres)
  const parts = new Map<string, PartLibreDuCompte & { cles: Map<string, [number, number, number]> }>()
  for (const e of ecritures) {
    if (!e.ecriture_libre_id) continue
    let p = parts.get(e.compte)
    if (!p) {
      p = { compte: e.compte, lignes: 0, soldeCentimes: 0, references: [], nonLues: 0, cles: new Map() }
      parts.set(e.compte, p)
    }
    p.lignes++
    p.soldeCentimes += (e.sens === 'debit' ? 1 : -1) * Math.round(e.montant * 100)
    const libre = index.get(e.ecriture_libre_id)
    if (!libre) { p.nonLues++; continue }
    // L'extourne d'une écriture du 31 décembre est datée du 1er janvier suivant : toute ligne à une autre date que l'écriture.
    const extourne = e.date !== libre.date
    const reference = `${referenceDeLEcritureLibre(libre)}${extourne ? ' (extourne)' : ''}`
    if (!p.cles.has(reference)) p.cles.set(reference, [libre.exercice, libre.numero, extourne ? 1 : 0])
  }
  const rendues = new Map<string, PartLibreDuCompte>()
  for (const [compte, { cles, ...part }] of parts) {
    const references = [...cles].sort(([, a], [, b]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map(([r]) => r)
    rendues.set(compte, { ...part, references })
  }
  return rendues
}

/** Un solde en mots, débit positif : « 300,00 € au débit », « 50,00 € au crédit », « soldée » à zéro. */
function soldeDeLaPart(c: number): string {
  if (c === 0) return 'soldée'
  return `${formatMoney(Math.abs(c) / 100)} au ${c > 0 ? 'débit' : 'crédit'}`
}

/**
 * La marque du détail d'un compte : « dont écriture libre n° EL2026-0003 : 300,00 € au débit » ; plusieurs, « dont écritures
 * libres n° EL2026-0003, EL2026-0004 : … » ; sans numéro lu, « dont écriture libre (numéro non lu) ». Jamais « rattachée à rien ».
 */
export function marqueDeLaPartLibre(p: PartLibreDuCompte): string {
  if (p.references.length === 0) return `dont écriture libre (numéro non lu) : ${soldeDeLaPart(p.soldeCentimes)}`
  const mots = p.references.length > 1 ? 'écritures libres' : 'écriture libre'
  const nonLues = p.nonLues > 0 ? ` et ${p.nonLues} ligne${p.nonLues > 1 ? 's' : ''} au numéro non lu` : ''
  return `dont ${mots} n° ${p.references.join(', ')}${nonLues} : ${soldeDeLaPart(p.soldeCentimes)}`
}

/** Les marques des comptes, prêtes pour l'écran : la clé est le compte. */
export function marquesDesEcrituresLibres(
  ecritures: readonly Pick<EcritureBrouillon, 'compte' | 'sens' | 'montant' | 'date' | 'ecriture_libre_id'>[],
  libres: EcrituresLibresDesExports | null,
): ReadonlyMap<string, string> {
  return new Map([...partsLibresDesComptes(ecritures, libres)].map(([compte, p]) => [compte, marqueDeLaPartLibre(p)]))
}
