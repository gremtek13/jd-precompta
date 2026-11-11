import type { ModeleComptable } from '../lib/engagement'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, type CleRoleComptable, type PlanComptable } from '../lib/planComptable'
import type { ModeComptable } from '../lib/types'
import { modeleDecale, modeleDeTest } from './modeles'

// LE PLAN DONNÉ AUX COPIES DE L'ASSISTANT (ligne 43, étape PC3b). Les blocs gardés de `agent-comptable` prennent le plan du
// dossier comme leurs originaux de src/lib : un paramètre `plan`, à la place que src/lib lui donne. Une garde extrait un
// bloc, le transpile et l'exécute ; cette fabrique lie le plan qu'ELLE choisit au paramètre `plan` de chaque fonction qui
// le déclare, lu dans le texte transpilé — jamais deviné, jamais par défaut : une fonction qui ne le déclare pas reste
// telle quelle, et une garde qui passe déjà le plan le voit remplacé par le sien, à la même place.

/** Les noms des paramètres d'une fonction transpilée, dans l'ordre, lus dans son texte. */
export function parametresDe(f: (...args: never[]) => unknown): string[] {
  const texte = f.toString()
  const ouvrante = texte.indexOf('(')
  let profondeur = 0
  let fermante = ouvrante
  for (let i = ouvrante; i < texte.length; i += 1) {
    if ('([{'.includes(texte[i])) profondeur += 1
    else if (')]}'.includes(texte[i])) profondeur -= 1
    if (profondeur === 0) { fermante = i; break }
  }
  const noms: string[] = []
  let courant = ''
  profondeur = 0
  for (const c of texte.slice(ouvrante + 1, fermante)) {
    if ('([{'.includes(c)) profondeur += 1
    else if (')]}'.includes(c)) profondeur -= 1
    if (c === ',' && profondeur === 0) { noms.push(courant); courant = '' } else courant += c
  }
  noms.push(courant)
  return noms.map((n) => n.split('=')[0].trim()).filter((n) => n !== '')
}

/** Le bloc BANQUES DU DOSSIER de l'assistant (MCB5, cinquième partie), que les copies des détecteurs et de la contrepartie
 *  d'une pièce lisent : chaque garde l'extrait avec le sien, de la MÊME source, pour qu'une dérive de l'un morde ici aussi. */
export function blocDesBanques(source: string): string {
  const debut = source.indexOf('// ── DÉBUT BANQUES DU DOSSIER')
  const fin = source.indexOf('// ── FIN BANQUES DU DOSSIER')
  if (debut < 0 || fin < debut) throw new Error('bornes du bloc BANQUES DU DOSSIER introuvables — garde-fou à remettre à jour')
  return source.slice(debut, fin)
}

/**
 * La copie, chaque fonction liée au plan donné (`avecLePlan`) et, quand elle déclare `banques` et que l'appel ne le passe
 * pas, à la banque du RÔLE — celle de son `modele` s'il en a un, du plan sinon : ce que src/lib reçoit de
 * `banquesDuDossier({ etat: 'sans_objet' }, plan)`, le drapeau baissé. Les gardes d'avant MCB5 comparent ainsi la copie à
 * src/lib sans réécrire leurs appels ; les cas par compte passent `banques` eux-mêmes (`avecLePlan`).
 */
export function avecLePlanEtLaBanqueDuRole<T extends object>(copie: T, plan: PlanComptable): T {
  const liee: Record<string, unknown> = {}
  for (const [nom, valeur] of Object.entries(copie)) {
    if (typeof valeur !== 'function') { liee[nom] = valeur; continue }
    const f = valeur as (...args: unknown[]) => unknown
    const noms = parametresDe(f)
    const rangPlan = noms.indexOf('plan')
    const rangBanques = noms.indexOf('banques')
    const rangModele = noms.indexOf('modele')
    liee[nom] = (...args: unknown[]) => {
      const complets = [...args]
      if (rangPlan >= 0) {
        while (complets.length < rangPlan) complets.push(undefined)
        complets.splice(rangPlan, 0, plan)
      }
      if (rangBanques >= 0 && complets[rangBanques] === undefined) {
        while (complets.length <= rangBanques) complets.push(undefined)
        const modele = rangModele >= 0 ? (complets[rangModele] as { plan?: PlanComptable } | undefined) : undefined
        complets[rangBanques] = { cas: 'role', compte: (modele?.plan ?? plan).banque }
      }
      return f(...complets)
    }
  }
  return liee as T
}

/** La copie, chaque fonction qui déclare `plan` liée au plan donné, à sa place. */
export function avecLePlan<T extends object>(copie: T, plan: PlanComptable): T {
  const liee: Record<string, unknown> = {}
  for (const [nom, valeur] of Object.entries(copie)) {
    if (typeof valeur !== 'function') { liee[nom] = valeur; continue }
    const f = valeur as (...args: unknown[]) => unknown
    const rang = parametresDe(f).indexOf('plan')
    liee[nom] = rang < 0 ? f : (...args: unknown[]) => {
      const debut = args.slice(0, rang)
      while (debut.length < rang) debut.push(undefined)
      return f(...debut, plan, ...args.slice(rang + 1))
    }
  }
  return liee as T
}

/** Les deux plans que chaque garde joue : le plan par défaut, celui de tout dossier aujourd'hui, et le plan décalé, où une
 *  constante oubliée écrirait un compte du catalogue que la comparaison refuserait. */
export const PLANS_DES_GARDES: readonly (readonly [string, PlanComptable])[] = [
  ['plan par défaut', PLAN_PAR_DEFAUT], ['plan décalé', PLAN_DECALE],
]

const ROLE_DU_DEFAUT: ReadonlyMap<string, CleRoleComptable> = new Map(
  (Object.entries(PLAN_PAR_DEFAUT) as [CleRoleComptable, string][]).map(([role, compte]) => [compte, role]),
)

/**
 * Un jeu d'essai écrit sous le plan par défaut, porté sous `plan` : toute chaîne qui EST un compte de rôle du catalogue
 * devient le compte du même rôle dans `plan`, à toute profondeur (lignes, ensembles, tableaux, tables) ; le reste est
 * recopié tel quel. Sous le plan par défaut, le jeu revient identique. Les gardes comparent ainsi la copie et src/lib sur
 * le même jeu, sous chaque plan, sans en réécrire les données.
 */
export function traduire<T>(valeur: T, plan: PlanComptable): T {
  const t = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const role = ROLE_DU_DEFAUT.get(v)
      return role === undefined ? v : plan[role]
    }
    if (Array.isArray(v)) return v.map(t)
    if (v instanceof Set) return new Set([...v].map(t))
    if (v instanceof Map) return new Map([...v].map(([k, x]) => [t(k), t(x)]))
    if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, t(x)]))
    }
    return v
  }
  return t(valeur) as T
}

/**
 * Des fonctions dont chaque argument est porté sous `plan` (`traduire`) avant l'appel : une garde y passe la copie et les
 * fonctions de src/lib, et ses jeux d'essai, écrits sous le plan par défaut, se jouent sous chaque plan. Le plan passé en
 * argument n'y change pas (ses comptes ne sont ceux du catalogue que sous le plan par défaut, où la traduction est nulle).
 */
export function entreesSous<T extends object>(fonctions: T, plan: PlanComptable): T {
  // Sous le plan par défaut, la traduction est l'identité : les fonctions passent telles quelles, sans copier leurs
  // entrées à chaque appel (les batteries du générateur en font des dizaines de milliers).
  if (plan === PLAN_PAR_DEFAUT) return fonctions
  const portee = (f: (...args: unknown[]) => unknown) => (...args: unknown[]) => f(...args.map((a) => traduire(a, plan)))
  if (typeof fonctions === 'function') return portee(fonctions as (...args: unknown[]) => unknown) as T
  return Object.fromEntries(Object.entries(fonctions).map(([nom, v]) => [
    nom, typeof v === 'function' ? portee(v as (...args: unknown[]) => unknown) : v,
  ])) as T
}

/** Le modèle d'un dossier sous `plan` : celui de modeleDeTest sous le plan par défaut, celui de modeleDecale sous le plan
 *  décalé — le dirigeant au compte de son rôle dans chacun. */
export function modeleSous(plan: PlanComptable, mode: ModeComptable): ModeleComptable {
  if (plan === PLAN_PAR_DEFAUT) return modeleDeTest(mode)
  if (plan === PLAN_DECALE) return modeleDecale(mode)
  throw new Error('modeleSous : un plan que les gardes ne jouent pas')
}
