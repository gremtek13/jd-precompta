import { useCallback, useEffect, useRef } from 'react'

// LA DERNIÈRE LECTURE SEULE ÉCRIT (audit des courses du 28/11/2026, « UNE LECTURE PLUS LENTE ÉCRIT EN DERNIER »).
//
// Un écran qui relit sa liste par une fonction (`load`, `charger`, `relire…`) l'appelle de son effet ET après chaque geste.
// Deux lectures partent alors l'une après l'autre — celle de l'ouverture et celle d'après un geste, ou celles de deux gestes
// dont le second n'attend pas la fin de la première —, et c'est la dernière ARRIVÉE qui écrit, pas la dernière demandée : la
// liste d'avant le geste revient par-dessus celle d'après. Le drapeau `let annule` d'un effet ne le voit pas, puisque la clé
// de l'effet n'a pas changé.
//
// Le remède est un numéro de lecture : chaque lecture prend le sien au départ, et n'écrit que s'il est encore le dernier —
// vérifié APRÈS chaque attente et AVANT l'écriture qui la suit (une lecture partie ne se rappelle pas : elle continue, elle
// n'écrit plus). Le démontage périme aussi toute lecture en vol. Les compteurs recopiés à la main dans plusieurs écrans
// (`const no = ++x.current … if (no !== x.current) return`) disent la même chose ; ce module la dit une fois, et le scanner
// `coursesDeLecture.test.ts` exige l'une ou l'autre de toute fonction de lecture qu'un effet appelle.

/** Vrai tant que la lecture qui l'a reçu est la dernière partie et que l'écran est monté. */
export type LectureCourante = () => boolean

/** Le compteur seul, sans React : `commencer()` rend le témoin d'une lecture neuve, `perimer()` les périme toutes. */
export function creerDerniereLecture(): { commencer: () => LectureCourante; perimer: () => void } {
  let numero = 0
  return {
    commencer: () => {
      const sien = ++numero
      return () => sien === numero
    },
    perimer: () => { numero++ },
  }
}

/**
 * Le numéro de lecture d'un écran : `const commencer = useDerniereLecture()`, puis, dans la fonction de lecture,
 * `const courante = commencer()` avant la première attente et `if (!courante()) return` après chacune. Une fonction de lecture
 * par appel du crochet : deux groupes de lectures indépendants (la liste et un compteur à part) en prennent chacun un, sans
 * quoi le second périmerait le premier.
 */
export function useDerniereLecture(): () => LectureCourante {
  const compteur = useRef<ReturnType<typeof creerDerniereLecture> | null>(null)
  if (compteur.current === null) compteur.current = creerDerniereLecture()
  // Le démontage périme les lectures en vol. Au remontage du mode strict, l'effet suivant relance la sienne.
  useEffect(() => {
    const c = compteur.current
    return () => { c?.perimer() }
  }, [])
  return useCallback(() => (compteur.current as ReturnType<typeof creerDerniereLecture>).commencer(), [])
}
