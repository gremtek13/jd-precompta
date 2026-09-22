import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// CE TEST REMPLACE UN GREP, ET C'EST TOUT SON INTÉRÊT.
//
// Le plafond « Max rows » de PostgREST tronque toute lecture sans le dire (voir CLAUDE.md et
// lib/lectureComplete.ts). Le portage de 2026 s'est appuyé sur un grep décrit dans CLAUDE.md —
// `from('<table>')` + `select(` sans `count: 'exact'` — annoncé comme rendant zéro.
//
// **Ce grep était faux, et il rendait zéro pour une raison fausse** : il travaille ligne à ligne,
// alors que le formatage normal du dépôt coupe la chaîne Supabase sur plusieurs lignes. Rejoué le
// 20/09/2026 en tenant compte des retours à la ligne, il a rendu TROIS lectures non paginées, dont
// l'aperçu d'un pack et la liste des pièces à rapprocher.
//
// Une vérification qui doit être « rejouée à la main » et dont personne ne peut voir qu'elle est
// fausse ne vaut rien. Elle tourne donc ici, à chaque `npm test` et à chaque CI.

// CE TEST NE TIENT PLUS DE LISTE DE TABLES À SURVEILLER — IL LES SURVEILLE TOUTES.
//
// Il a commencé avec six tables, « les grosses ». Le 20/09/2026 cinq l'ont rejointe parce qu'un
// garde-fou de la 2035 en dépendait, toutes minuscules (43, 10, 2, 1, 8 lignes) : c'est précisément
// leur petitesse qui rendait leur absence confortable. Le balayage suivant a montré qu'il restait
// vingt-trois tables dehors, dont `dossiers` — que CLAUDE.md désignait NOMMÉMENT comme « la première
// qui touchera le plafond », et dont la lecture n'avait jamais été portée alors que les lectures
// satellites du même écran l'avaient été.
//
// Une liste d'INCLUSION tenue à la main reproduit à chaque fois la même panne : elle ne contient que
// ce à quoi quelqu'un a pensé, et son silence est indiscernable d'un dépôt sain. C'est la leçon de
// `supabase/essais/rls.sql`, dont la boucle part de `pg_class` et non d'une liste — une table
// ajoutée demain y est attrapée sans que personne ait à y penser.
//
// Le test part donc de TOUTE lecture de collection, et n'admet que des EXCEPTIONS écrites, chacune
// portant la raison qui BORNE sa taille. Ajouter une exception reste un acte délibéré ; ne rien
// faire ne l'est pas.

// Clé : `chemin [table]`. La valeur n'est pas un commentaire décoratif — c'est la raison pour
// laquelle cette collection ne peut PAS grandir, et elle doit tenir devant la question : « et si ce
// cabinet en avait mille ? »
const EXCEPTIONS: Record<string, string> = {
  "src/lib/contrepartieBanque.ts [ecritures_brouillon]":
    "les écritures d'UNE pièce — la partie double en produit deux ou trois, jamais mille",
  "src/pages/dossier/FactureApercu.tsx [facture_lignes]":
    "les lignes d'UNE facture, saisies une par une par qui la rédige",
  "src/pages/dossier/FactureAvoirModal.tsx [facture_lignes]":
    "les lignes d'UNE facture d'origine, même borne",
  "src/pages/dossier/FactureFormModal.tsx [facture_lignes]":
    "les lignes d'UNE facture en cours de modification, même borne",
  "src/pages/dossier/SuperPdpFactureModal.tsx [facture_superpdp_events]":
    "les événements de transmission d'UNE facture — soumission, validation, accusé",
  "src/lib/tauxChange.ts [taux_change_bce]":
    "le cours d'UNE devise sur une fenêtre de quelques jours : la requête fixe les deux bornes",
  "src/context/AuthContext.tsx [memberships]":
    "les sociétés d'UN utilisateur — un client en a une, exceptionnellement quelques-unes",
  "src/context/AuthContext.tsx [dossiers]":
    "les dossiers de CES memberships-là (`.in('id', ids)`), donc la même borne",
  "src/pages/dossier/AccesTab.tsx [memberships]":
    "les accès client d'UN dossier : une poignée de personnes, pas une base d'utilisateurs",
  "src/pages/dossier/ClotureTab.tsx [exercices_clotures]":
    "les exercices déjà clôturés d'UN dossier — au plus une ligne par année civile, jamais mille",
}

function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return fichiersSource(chemin)
    if (!/\.tsx?$/.test(nom) || nom.includes('.test.')) return []
    return [chemin]
  })
}

interface LectureTrouvee { fichier: string; table: string; extrait: string }

// CE DÉCOUPAGE A ÉTÉ FAUX UNE PREMIÈRE FOIS, ET IL RENDAIT ZÉRO POUR UNE RAISON FAUSSE — la
// deuxième fois pour cette même vérification, après le grep ligne à ligne que ce test remplaçait.
//
// La version d'origine délimitait le corps par `[^;]*?` suivi d'un `lookahead`. Or le dépôt n'écrit
// pas de point-virgule, et les lectures vivent presque toutes dans un `Promise.all([...])` dont les
// entrées se terminent par une VIRGULE : le corps grossissait donc jusqu'au commentaire suivant, en
// AVALANT au passage les `.from(...)` voisins. Le moteur reprenait après eux, et ces lectures-là
// n'étaient jamais examinées. Mesuré : une lecture non paginée remise au milieu d'un Promise.all
// restait invisible, et le test vert.
//
// La borne qui répare est simple et vérifiable : **un corps s'arrête au `.from(` SUIVANT**, quelle
// que soit sa table. Un `.from(` ne peut pas appartenir à la chaîne en cours, donc on ne peut plus
// en sauter un. Les autres bornes (point-virgule, ligne qui recommence autre chose) ne font que
// RACCOURCIR le corps, ce qui est le sens sûr : un corps trop court se signale, un corps trop long
// se tait.
export function lecturesNonPagineesDe(fichier: string, source: string): LectureTrouvee[] {
  const departs = [...source.matchAll(/\.from\('([a-z_]+)'\)/g)]
  const trouves: LectureTrouvee[] = []
  for (const [i, depart] of departs.entries()) {
    const debut = depart.index + depart[0].length
    const prochainFrom = departs[i + 1]?.index ?? source.length
    const reste = source.slice(debut, prochainFrom)
    // Le commentaire n'est PAS une borne : une chaîne peut en porter un entre deux maillons, et
    // couper là ferait passer la lecture pour une écriture faute d'y voir son `.select(`.
    const coupure = reste.search(/;|\n\s*(?:const|let|return|if|await|\})/)
    const corps = coupure === -1 ? reste : reste.slice(0, coupure)
    if (!corps.includes('.select(')) continue                       // écriture, pas lecture
    if (corps.includes('count:')) continue                          // paginée et déclarée
    if (corps.includes('.single()') || corps.includes('.maybeSingle()')) continue  // une ligne
    if (/\.limit\(\s*\d+\s*\)/.test(corps)) continue                // plafond VOULU et écrit
    trouves.push({ fichier, table: depart[1], extrait: corps.split(/\s+/).join(' ').slice(0, 90) })
  }
  return trouves
}

/** Les lectures de COLLECTION qui n'annoncent pas de compte — donc indiscernables d'une troncature. */
export function lecturesNonPaginees(): LectureTrouvee[] {
  return fichiersSource('src').flatMap((f) => lecturesNonPagineesDe(f, readFileSync(f, 'utf8')))
}

describe('plafond PostgREST — aucune collection lue sans compte annoncé', () => {
  it('ne laisse passer que les exceptions déclarées, avec leur raison', () => {
    const restants = lecturesNonPaginees().filter((l) => !(`${l.fichier} [${l.table}]` in EXCEPTIONS))
    expect(
      restants.map((l) => `${l.fichier} [${l.table}] ${l.extrait}`),
      'Lecture de collection sans `count: \'exact\'` : passe par `lireTout` (lib/lectureComplete.ts), ' +
      'ou inscris-la dans EXCEPTIONS avec la raison qui borne sa taille.',
    ).toEqual([])
  })

  // UN CONTRÔLE QUI NE TROUVE JAMAIS RIEN PEUT ÊTRE UN CONTRÔLE CASSÉ. Celui-ci ne se contente
  // donc pas de vérifier qu'il voit « quelque chose » : on lui PLANTE le défaut, dans la forme
  // exacte qui l'avait aveuglé — une lecture nue au milieu d'un `Promise.all`, entre deux lectures
  // correctement paginées, sans un seul point-virgule dans le fichier.
  it('voit une lecture nue coincée entre deux lectures paginées', () => {
    const source = [
      "const [a, b, c] = await Promise.all([",
      "  lireTout<Piece>((debut, fin) =>",
      "    supabase.from('pieces').select('*', { count: 'exact' })",
      "      .eq('dossier_id', d).order('id').range(debut, fin),",
      "  ),",
      "  supabase.from('cotisations_declarees').select('*').eq('dossier_id', d),",
      "  // Tous exercices : c'est le moteur qui filtre.",
      "  lireTout<Vehicule>((debut, fin) =>",
      "    supabase.from('vehicules').select('*', { count: 'exact' })",
      "      .eq('dossier_id', d).order('id').range(debut, fin),",
      "  ),",
      "])",
    ].join('\n')
    expect(lecturesNonPagineesDe('synthetique.ts', source).map((l) => l.table))
      .toEqual(['cotisations_declarees'])
  })

  // Et le symétrique : il ne doit pas crier au loup sur une lecture correcte, sinon on ajouterait
  // des exceptions pour le faire taire et la liste perdrait son sens.
  it('se tait sur une lecture paginée dont le commentaire coupe la chaîne', () => {
    const source = [
      "supabase.from('pieces')",
      "  // un commentaire au milieu de la chaîne",
      "  .select('*', { count: 'exact' })",
      "  .eq('dossier_id', d).order('id').range(debut, fin)",
    ].join('\n')
    expect(lecturesNonPagineesDe('synthetique.ts', source)).toEqual([])
  })

  it('ignore une ÉCRITURE, qui n’a pas de collection à tronquer', () => {
    const source = "supabase.from('categories').update({ poste_2035: v }).eq('id', id)"
    expect(lecturesNonPagineesDe('synthetique.ts', source)).toEqual([])
  })

  it('garde ses exceptions alignées sur des lectures réelles', () => {
    const reelles = new Set(lecturesNonPaginees().map((l) => `${l.fichier} [${l.table}]`))
    expect(Object.keys(EXCEPTIONS).filter((cle) => !reelles.has(cle)),
      'exception déclarée ne correspondant à aucune lecture réelle — à retirer').toEqual([])
  })
})
