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
// déjà trois exemples (la lecture paginée, trois fois de suite). D'où ce contrôle, qui n'admet
// aucune exception sur `src/` — il n'y existe aucun cas où cette forme soit correcte, puisque
// `messageErreur` traite les deux formes par la même branche.
//
// ET « TOUTE SOURCE DE PRODUCTION » ÉTAIT FAUX : IL S'ARRÊTAIT À `src/` (corrigé le 22/09/2026).
// C'est la troisième fois de la journée qu'un contrôle de ce dépôt promet un périmètre qu'il n'a
// pas, et la famille est nommée ailleurs : une mise en garde écrite au-dessus d'un code qui ne la
// tient pas. Le ternaire interdit vit HUIT fois dans les Edge Functions.
//
// MAIS LE PORTER TEL QUEL Y SERAIT FAUX, et c'est la mesure qui le dit plutôt qu'une intuition.
// Ce qui rend ce ternaire dangereux n'est pas sa forme, c'est qu'une valeur NUE puisse l'atteindre —
// et une valeur nue n'arrive dans un `catch` que si quelqu'un l'a LEVÉE. Compté :
//
//   • `src/`            — 52 `throw new …` contre **41 `throw <erreur Supabase>` NUS**
//                         (`throw error`, `throw insertError`, `throw uploadError`…). Le ternaire y
//                         était donc réellement faux, quarante-cinq fois.
//   • Edge Functions    — 12 `throw`, **toutes `new Error`, zéro nue**, et aucun `Promise.reject`.
//                         Les huit ternaires y sont inoffensifs — par cette propriété-là, et par
//                         aucune autre.
//
// LE CONTRÔLE PORTE DONC SUR LA PRÉCONDITION plutôt que sur le symptôme : côté Edge Functions, rien
// ne doit être levé qui ne soit un `new …`. C'est ce qui rend les huit ternaires sûrs, et c'était
// jusqu'ici VRAI sans être GARDÉ — donc indiscernable d'un dépôt où le premier
// `if (error) throw error` écrit demain transformerait « new row violates row-level security
// policy » en « [object Object] », sur le côté où rien ne recharge et où le diagnostic passe par
// les logs de production. Le remède y est le même qu'ailleurs : `throw new Error(error.message)`.
//
// POURQUOI LES HUIT NE SONT PAS RÉÉCRITS, écrit plutôt que laissé deviner : le code déployé est
// CORRECT aujourd'hui, et le corriger demanderait sept redéploiements — chacun avec son `verify_jwt`
// à relire, sa comparaison avant écrasement et son aller-retour. Ce dépôt a déjà payé un drapeau
// `verify_jwt` retourné en silence. On ne court pas ce risque pour un défaut qui ne peut pas
// survenir ; on interdit ce qui le ferait survenir.
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

/**
 * Une valeur LEVÉE qui n'est pas construite sur place — `throw error`, `throw insertError`…
 *
 * C'est la seule façon dont un objet Postgrest NU atteint un `catch`, donc la précondition qui
 * décide. `throw new …` et `throw json(…)` (un appel, qui construit sa valeur) sont écartés ; tout
 * le reste est signalé, parce qu'une forme non prévue doit tomber du côté SIGNALÉ.
 */
const THROW_NU = /\bthrow\s+(?!new\b)([A-Za-z_$][\w$]*)\s*(?![\w$(])/g

function levesNues(texte: string): string[] {
  return texte.split('\n')
    .filter((ligne) => !/^\s*(\/\/|\*|\/\*)/.test(ligne))
    .filter((ligne) => { THROW_NU.lastIndex = 0; return THROW_NU.test(ligne) })
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

describe('et rien de NU n’est levé dans une Edge Function', () => {
  const fonctions = sources('supabase/functions')

  it('le balayage atteint bien les fonctions — sinon « zéro » ne voudrait rien dire', () => {
    // Avec zéro faute réelle, « le scanner rend zéro » et « le scanner lit le mauvais dossier » sont
    // rigoureusement indiscernables. Cette borne-ci est donc la seule chose qui distingue les deux.
    expect(fonctions.length).toBeGreaterThanOrEqual(12)
    const leves = fonctions.reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/\bthrow\s+new\b/g)?.length ?? 0), 0,
    )
    expect(leves).toBeGreaterThanOrEqual(10)
  })

  it('aucune valeur nue levée', () => {
    const enFaute = fonctions.flatMap((f) =>
      levesNues(readFileSync(f, 'utf8')).map((ligne) => `${f} :: ${ligne.trim()}`),
    )
    expect(
      enFaute,
      'une valeur nue levée est la seule façon dont un objet Postgrest atteint un `catch` — ' +
        'et les huit `instanceof Error ?` de ces fonctions n’y survivraient pas',
    ).toEqual([])
  })

  it('le scanner de levées voit ce qu’il doit voir, et rien d’autre — défaut PLANTÉ', () => {
    const synthetique = [
      '    if (insertError) throw insertError',
      '    throw new Error(`Liste des factures échouée (${resp.status}).`)',
      '    if (error) throw new Error(error.message)',
      '    // if (error) throw error',
      '    throw json({ error: "raté" }, 500)',
    ].join('\n')
    expect(levesNues(synthetique)).toHaveLength(1)
    expect(levesNues(synthetique)[0]).toContain('throw insertError')
  })

  it('et il attrape aussi la forme RÉELLE de `src/`, qui est celle qu’on interdit ici', () => {
    // Les 41 levées nues de `src/` sont la preuve que cette forme n'a rien de théorique : elle est
    // le formatage NORMAL de ce dépôt, simplement légitime là-bas puisque `messageErreur` la
    // rattrape. Ce cas garde que le scanner reconnaît bien cette forme-là.
    expect(levesNues('  if (uploadError) throw uploadError\n')).toHaveLength(1)
    expect(levesNues('  throw erreurDeja\n')).toHaveLength(1)
  })
})
