import type { PlanComptable } from '../lib/planComptable'

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
