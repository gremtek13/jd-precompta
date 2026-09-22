import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLES_PRIMAIRES, RELATIONS } from './sauvegarde'

// UNE PROMESSE ÉCRITE DANS UN COMMENTAIRE, ET RIEN DERRIÈRE — trouvée le 22/09/2026 en balayant les
// commentaires qui AFFIRMENT qu'un test garde quelque chose. Six affirmations de ce genre dans les
// sources de production ; cinq tiennent, celle-ci ne trouvait aucun test.
//
// `liensPerdus` (sauvegarde.ts) compare sur `id`, et son en-tête explique pourquoi c'est correct :
// « une clé étrangère d'une seule colonne ne peut viser qu'une clé primaire d'une seule colonne :
// toutes les tables PARENTES du graphe ont donc `id`. **Un test le vérifie**, pour que le jour où ce
// ne serait plus vrai se voie ici. » Il n'existait pas.
//
// CE QUE SA RUPTURE COÛTERAIT, dit exactement plutôt que dramatisé : elle est BRUYANTE, pas
// silencieuse. Un parent sans colonne `id` ferait rendre `Set {"undefined"}` à `identifiants`, donc
// CHAQUE ligne fille serait déclarée « lien perdu » — et `restaurerSauvegarde` REFUSE sur un lien
// perdu. Le dégât n'est donc pas une restauration fausse mais une restauration IMPOSSIBLE, bloquée
// par des centaines de liens qui ne sont pas cassés, au moment précis où l'on restaure. C'est le
// terrain que PLAN_DE_REPRISE.md décrit comme celui dont on découvre les défauts trop tard.
//
// L'INVARIANT TIENT AUJOURD'HUI — 11 parents, aucun à clé composite. Ce test ne corrige donc rien :
// il rend vraie une phrase qui était fausse, et attrape la relation qu'on ajoutera demain vers l'une
// des six tables à clé non-`id`.

// ────────────────────────────────────────────────────────────────────────────────────────────────
// LA SOURCE EST LE SCHÉMA EXPORTÉ, JAMAIS UNE LISTE TENUE À LA MAIN — comme `sauvegardeTables` et
// comme `rls.sql` part de `pg_class`. Une table créée demain avec une clé composite est vue sans que
// personne ait à l'inscrire quelque part, et c'est tout l'enjeu : `CLES_PRIMAIRES` est justement une
// liste d'inclusion, et ce dépôt connaît sous cinq noms la panne qu'elles produisent.
//
// LES `ALTER` SE REJOUENT, et ce n'est pas du zèle — mesuré, sans eux la dérivation est FAUSSE sur
// deux tables : `piece_textes_ocr` (créée avec `primary key` sur `piece_id`, passée à un `id` de
// substitution par `alter table … add column id … primary key`) et `facture_numerotation` (passée de
// deux à trois colonnes par `drop constraint` + `add primary key`). Quatre instructions dans tout le
// schéma, deux formes, toutes rejouées ici dans l'ordre des fichiers puis des instructions.
//
// **CE QUE CE TEST NE PEUT PAS GARDER, annoncé plutôt que laissé croire** : que le schéma exporté
// décrive la base RÉELLE. C'est le couple habituel de ce dépôt — une moitié gardée par le code,
// l'autre par une vérification. Cette vérification a été faite le 22/09/2026 par une requête sur
// `pg_constraint` : **41 tables, six à clé non-`id`, et la dérivation ci-dessous les rend EXACTEMENT,
// colonne par colonne**. La dérive du fichier exporté, elle, est gardée par `supabase/schema/README.md`
// et par `sauvegardeTables.test.ts`.
// ────────────────────────────────────────────────────────────────────────────────────────────────

const RACINES = ['supabase/schema', 'supabase/schema/socle']

function fichiersDuSchema(): { chemin: string; texte: string }[] {
  const racine = new URL('../../', import.meta.url).pathname
  return RACINES
    .flatMap((d) =>
      readdirSync(racine + d)
        .filter((n) => n.endsWith('.sql'))
        .map((n) => ({ chemin: `${d}/${n}`, texte: readFileSync(`${racine}${d}/${n}`, 'utf8') })),
    )
    // Les migrations se rejouent dans l'ordre de leur nom, et le socle vient après : il n'ajoute que
    // les douze tables créées hors `apply_migration`, qui n'ont donc aucun `alter` avant elles.
    .sort((a, b) => (a.chemin < b.chemin ? -1 : 1))
}

/** Le contenu d'un groupe de parenthèses ouvert en `i`, accolades appariées. */
function groupe(texte: string, i: number): { corps: string; fin: number } {
  let profondeur = 0
  for (let k = i; k < texte.length; k++) {
    if (texte[k] === '(') profondeur++
    else if (texte[k] === ')') {
      profondeur--
      if (profondeur === 0) return { corps: texte.slice(i + 1, k), fin: k }
    }
  }
  return { corps: '', fin: i }
}

/** Découpe sur les virgules de PREMIER niveau : `numeric(10, 2)` ne doit pas couper une colonne. */
function entrees(corps: string): string[] {
  const out: string[] = []
  let profondeur = 0
  let courant = ''
  for (const c of corps) {
    if (c === '(') profondeur++
    if (c === ')') profondeur--
    if (c === ',' && profondeur === 0) { out.push(courant); courant = '' } else courant += c
  }
  out.push(courant)
  return out
}

const colonnesDe = (s: string): string[] =>
  s.split(',').map((c) => c.trim().replace(/"/g, '')).filter(Boolean)

/** La clé primaire de chaque table du schéma exporté, `alter` rejoués. */
export function clesPrimairesDuSchema(fichiers: { chemin: string; texte: string }[]): Map<string, string[]> {
  const cles = new Map<string, string[]>()
  for (const { texte } of fichiers) {
    // On ne coupe QUE les lignes entièrement en commentaire, jamais un `--` de fin de ligne : même
    // règle que `sauvegardeTables.test.ts`, dont l'en-tête explique pourquoi (un commentaire peut
    // CITER une instruction, et couper au `--` risquerait d'avaler une chaîne qui en contient).
    const sql = texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

    type Evt = { i: number; genre: string; table: string; pos?: number; cols?: string[] }
    const evts: Evt[] = []
    const pousser = (r: RegExp, genre: string, f: (m: RegExpMatchArray) => Partial<Evt>) => {
      for (const m of sql.matchAll(r)) evts.push({ i: m.index!, genre, table: m[1], ...f(m) })
    }
    pousser(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi, 'create',
      (m) => ({ pos: m.index! + m[0].length - 1 }))
    pousser(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi, 'drop_table', () => ({}))
    pousser(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?(\w+)"?\s+drop\s+constraint\s+"?\w+_pkey"?/gi,
      'drop_pk', () => ({}))
    pousser(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?(\w+)"?\s+add\s+(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/gi,
      'add_pk', (m) => ({ cols: colonnesDe(m[2]) }))
    pousser(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?(\w+)"?\s+add\s+column\s+"?(\w+)"?[^;]*?\bprimary\s+key\b/gi,
      'add_col_pk', (m) => ({ cols: [m[2]] }))

    // L'ORDRE DÉCIDE : un `alter` qui suit son `create` dans le même fichier doit gagner. Sans ce
    // tri, la clé retenue serait celle de la dernière expression régulière exécutée, pas celle de la
    // dernière instruction écrite.
    evts.sort((a, b) => a.i - b.i)

    for (const e of evts) {
      if (e.genre === 'drop_table') { cles.delete(e.table); continue }
      if (e.genre === 'drop_pk') { cles.set(e.table, []); continue }
      if (e.cols) { cles.set(e.table, e.cols); continue }
      const cols: string[] = []
      for (const entree of entrees(groupe(sql, e.pos!).corps)) {
        const t = entree.trim()
        const niveauTable = /^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/i.exec(t)
        if (niveauTable) { cols.push(...colonnesDe(niveauTable[1])); continue }
        if (/\bprimary\s+key\b/i.test(t)) cols.push(t.split(/\s+/)[0].replace(/"/g, ''))
      }
      cles.set(e.table, cols)
    }
  }
  return cles
}

const estId = (cols: string[]) => cols.length === 1 && cols[0] === 'id'

describe('clés primaires — ce que la sauvegarde suppose du schéma', () => {
  const cles = clesPrimairesDuSchema(fichiersDuSchema())
  const parents = [...new Set(RELATIONS.map((r) => r.parent))].sort()
  const tablesDuGraphe = new Set([...RELATIONS.map((r) => r.parent), ...RELATIONS.map((r) => r.enfant)])

  it('lit bien tout le schéma, et toutes les tables du graphe', () => {
    // La borne sans laquelle « aucun parent en faute » voudrait aussi dire « je ne lis plus rien ».
    // Le compte de tables ne fait que croître ; ce qui se met à jour tout seul, en revanche, c'est
    // que CHAQUE table du graphe de sauvegarde ait une clé primaire dérivée — si le lecteur devenait
    // aveugle sur une forme de `create table`, c'est ici que ça se verrait.
    expect(cles.size).toBeGreaterThanOrEqual(41)
    expect(parents.length).toBeGreaterThanOrEqual(11)
    for (const t of tablesDuGraphe) {
      expect(cles.get(t), `aucune clé primaire dérivée pour ${t}`).toBeDefined()
      expect(cles.get(t)!.length, `clé primaire vide pour ${t}`).toBeGreaterThan(0)
    }
    // `pack_pieces` a été SUPPRIMÉE (migration `drop_table_morte_pack_pieces`) : la rejouer prouve
    // que les `drop table` sont pris en compte, sans quoi la liste porterait une table fantôme.
    expect(cles.has('pack_pieces')).toBe(false)
  })

  it('TOUTE table PARENTE du graphe a `id` pour clé primaire', () => {
    // LA PHRASE QUE `liensPerdus` ÉCRIT DEPUIS TOUJOURS, enfin vérifiée. Une relation ajoutée demain
    // vers `superpdp_credentials`, `previsionnels_bancaires` ou l'une des quatre autres rendrait
    // toute restauration impossible — voir l'en-tête.
    const fautifs = parents.filter((p) => !estId(cles.get(p) ?? []))
    expect(
      fautifs,
      'un parent dont la clé primaire n’est pas `id` : `liensPerdus` compare sur `id` et déclarerait ' +
        'perdue chaque ligne fille, donc `restaurerSauvegarde` refuserait tout.',
    ).toEqual([])
  })

  it('rejoue les instructions dans l’ORDRE ÉCRIT, pas dans l’ordre des motifs', () => {
    // CE CAS EST SYNTHÉTIQUE, ET C'EST ASSUMÉ : sans lui le tri par position ne servait à rien, car
    // l'ordre des expressions régulières (create, drop table, drop pk, add pk, add colonne) coïncide
    // par ACCIDENT avec l'ordre textuel de tous les fichiers réels. Une mutation qui ne mord pas
    // accuse d'abord le jeu d'essai — le tri tient par CONSTRUCTION, il lui fallait un cas qui le
    // distingue.
    //
    // La séquence ci-dessous est celle d'une table qui reçoit un `id` de substitution PUIS qu'on
    // re-clé ensuite : l'ordre des motifs rendrait `{id}`, l'ordre écrit rend `{a, b}`.
    const synthetique = [{
      chemin: 'synthetique.sql',
      texte: [
        'create table t_synth (a uuid, b uuid, primary key (a));',
        'alter table t_synth add column id uuid primary key default gen_random_uuid();',
        'alter table t_synth drop constraint t_synth_pkey;',
        'alter table t_synth add primary key (a, b);',
      ].join('\n'),
    }]
    expect(clesPrimairesDuSchema(synthetique).get('t_synth')).toEqual(['a', 'b'])
  })

  it('`CLES_PRIMAIRES` dit EXACTEMENT ce que le schéma dit, dans les deux sens', () => {
    // Cette liste décide du TRI des lectures paginées (`sauvegardeDonnees`) : un tri sur une clé qui
    // n'en est pas une rend des doublons et des trous sans erreur, Postgres n'étant pas tenu de
    // garder le même ordre d'une tranche à l'autre. Elle est tenue à la main ; le schéma, non.
    //
    // Aucune exception, et c'est possible parce que les deux tombent juste : une de moins serait une
    // table qu'on paginerait sur un `id` inexistant, une de plus une raison morte.
    const duSchema = Object.fromEntries([...cles].filter(([, c]) => !estId(c)).sort())
    const deLaListe = Object.fromEntries(
      Object.entries(CLES_PRIMAIRES).map(([t, c]) => [t, [...c]]).sort(),
    )
    expect(duSchema).toEqual(deLaListe)
  })
})
