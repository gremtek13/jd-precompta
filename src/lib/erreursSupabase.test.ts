import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// LE MOTIF NE SE CHERCHE PAS À LA MAIN, IL EST INTERDIT PAR UN TEST.
//
// `catch (err) { err instanceof Error ? err.message : repli }` est faux dès que l'erreur vient de
// la base : sur le chemin non levant, supabase-js rend `JSON.parse(body)`, un objet NU (voir
// lib/messageErreur.ts pour la citation de la source). Le test échoue, le repli s'affiche, et la
// raison est jetée — sans que rien ne casse, puisque le repli est plausible. Quarante-cinq sites le
// faisaient ; c'est exactement le défaut que `extraireErreurFonction` avait déjà corrigé pour les
// Edge Functions, revenu par l'autre porte.
//
// Une règle écrite dans CLAUDE.md et confiée à la vigilance revient toujours : le dépôt en tient
// déjà trois exemples (la lecture paginée, trois fois de suite). D'où ce contrôle, qui part de
// TOUTE source de production et n'admet aucune exception — il n'existe aucun cas où cette forme
// soit correcte, puisque `messageErreur` traite les deux formes par la même branche.
function sources(racine: string): string[] {
  return readdirSync(racine).flatMap((nom) => {
    const chemin = join(racine, nom)
    if (statSync(chemin).isDirectory()) return sources(chemin)
    if (!/\.tsx?$/.test(nom) || nom.includes('.test.')) return []
    return [chemin]
  })
}

// Le ternaire fautif, et LUI SEUL. `if (err instanceof Error)` reste légitime — journaliser une
// pile, par exemple. Ce qui est interdit est de faire dépendre le MESSAGE AFFICHÉ de l'héritage.
const TERNAIRE_FAUTIF = /(\w+(?:\.\w+)*)\s+instanceof\s+Error\s*\?\s*\1\.message\s*:/g

function fautifs(texte: string): string[] {
  // Les lignes de commentaire sont écartées : `messageErreur.ts` et ce fichier CITENT le motif pour
  // l'expliquer, et une citation n'est pas un défaut.
  return texte.split('\n')
    .filter((ligne) => !/^\s*(\/\/|\*|\/\*)/.test(ligne))
    .filter((ligne) => { TERNAIRE_FAUTIF.lastIndex = 0; return TERNAIRE_FAUTIF.test(ligne) })
}

describe('aucune erreur Supabase ne repasse par `instanceof Error`', () => {
  it('le dépôt entier est propre', () => {
    const enFaute = sources('src').flatMap((f) =>
      fautifs(readFileSync(f, 'utf8')).map((ligne) => `${f} :: ${ligne.trim()}`),
    )
    expect(enFaute).toEqual([])
  })

  it('et le scanner voit encore quelque chose — défaut PLANTÉ, pas simple présence', () => {
    // « Le contrôle rend zéro » et « le contrôle est aveugle » se ressemblent trop : c'est la panne
    // qui a laissé passer trois versions successives du scanner de lectures paginées. On lui donne
    // donc une source SYNTHÉTIQUE portant la forme exacte à attraper, plus deux cas voisins qu'il ne
    // doit PAS attraper — sans quoi un scanner qui crie au loup partout passerait aussi ce test.
    const synthetique = [
      "    setError(err instanceof Error ? err.message : 'Une erreur est survenue.')",
      '    if (err instanceof Error) console.error(err.stack)',
      "    setError(messageErreur(err, 'Une erreur est survenue.'))",
      '    // setError(err instanceof Error ? err.message : repli)',
    ].join('\n')
    expect(fautifs(synthetique)).toHaveLength(1)
    expect(fautifs(synthetique)[0]).toContain('setError(err instanceof Error')
  })

  it("et il n'attrape pas non plus une variable différente de part et d'autre", () => {
    // `a instanceof Error ? b.message : …` n'est pas ce motif-ci : le `\1` du gabarit l'exige
    // identique. Une forme trop large signalerait du code correct et finirait désactivée.
    expect(fautifs("setError(a instanceof Error ? b.message : 'repli')")).toEqual([])
  })
})
