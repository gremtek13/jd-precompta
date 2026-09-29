import { readFileSync, readdirSync } from 'node:fs'

// LE SCHÉMA EXPORTÉ, LU UNE SEULE FOIS POUR TOUT LE DÉPÔT.
//
// Deux contrôles en dépendent — `sauvegardeClesPrimaires.test.ts` (la sauvegarde suppose que toute
// table PARENTE a `id`) et `triTotal.test.ts` (une lecture paginée doit trier sur une clé unique).
// La dérivation vit donc ici plutôt qu'en deux copies : ce dépôt a déjà payé deux fois la copie qui
// dérive en silence, et une clé primaire lue de deux façons différentes est exactement ce qu'aucun
// test ne verrait.
//
// Ce que cette lecture ne peut PAS garantir, annoncé plutôt que laissé croire : que le fichier
// exporté décrive la base RÉELLE. C'est le couple habituel — une moitié gardée par le code, l'autre
// par une vérification. Elle a été faite le 22/09/2026 par une requête sur `pg_constraint` :
// 41 tables, six à clé non-`id`, et la dérivation ci-dessous les rend EXACTEMENT, colonne par
// colonne. La dérive du fichier exporté est gardée ailleurs (`supabase/schema/README.md`,
// `sauvegardeTables.test.ts`).

const RACINES = ['supabase/schema', 'supabase/schema/socle']

export function fichiersDuSchema(): { chemin: string; texte: string }[] {
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

/** Le contenu d'un groupe de parenthèses ouvert en `i`, parenthèses appariées. */
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

/** Une clé étrangère lue dans le schéma exporté. */
export interface RelationDuSchema {
  enfant: string
  colonne: string
  /** `schéma.table` quand la table visée n'est pas dans `public` (`auth.users`), sinon la table seule. */
  parent: string
  aLaSuppression: 'cascade' | 'bloque' | 'met_a_null'
  /** Le nom de la contrainte — celui que Postgres donne quand l'instruction n'en donne pas. */
  nom: string
}

/** Une forme que l'export n'a jamais portée : on s'arrête plutôt que de deviner ce qu'elle fait. */
export class FormeInconnue extends Error {}

// `ON DELETE` tel que la sauvegarde le nomme. Sans clause, Postgres fait NO ACTION : la suppression du
// parent est refusée tant qu'un enfant le désigne — « bloque », comme RESTRICT. SET DEFAULT n'a pas
// d'équivalent dans la sauvegarde, et l'export n'en porte aucun : le ranger quelque part serait un pari.
function actionDe(queue: string): RelationDuSchema['aLaSuppression'] {
  const m = /\bon\s+delete\s+(cascade|set\s+null|set\s+default|restrict|no\s+action)\b/i.exec(queue)
  if (!m) return 'bloque'
  const action = m[1].toLowerCase().replace(/\s+/g, ' ')
  if (action === 'cascade') return 'cascade'
  if (action === 'set null') return 'met_a_null'
  if (action === 'set default') throw new FormeInconnue(`ON DELETE SET DEFAULT jamais rencontré : ${queue.slice(0, 80)}`)
  return 'bloque'
}

// La table visée : `[schéma.]table`, guillemets permis. Le schéma n'est gardé que s'il n'est pas
// `public`, pour que `auth.users` ne se confonde jamais avec une table `users` de l'application.
const CIBLE = String.raw`references\s+(?:"?(\w+)"?\.)?"?(\w+)"?(?:\s*\([^)]*\))?`

function cible(schema: string | undefined, table: string): string {
  return schema && schema.toLowerCase() !== 'public' ? `${schema}.${table}` : table
}

/** Une seule colonne, ou l'on s'arrête : `Relation` n'en porte qu'une, et en garder la première
 *  ferait passer une clé composite pour une clé simple. */
function uneColonne(liste: string, texte: string): string {
  const cols = colonnesDe(liste)
  if (cols.length !== 1) throw new FormeInconnue(`clé étrangère sur ${cols.length} colonnes jamais rencontrée : ${texte.slice(0, 80)}`)
  return cols[0]
}

/** Les corps `$tag$ … $tag$` vidés : un corps de fonction qui contiendrait un `alter table … add
 *  constraint … references …` n'est pas une instruction de l'export. Défensif aujourd'hui — aucun
 *  corps n'en contient —, et gardé par un cas synthétique. */
function sansCorpsDeFonction(sql: string): string {
  return sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, (_m, balise: string) => `$${balise}$$${balise}$`)
}

/**
 * Les clés étrangères du schéma exporté, `alter` rejoués dans l'ordre des fichiers puis des
 * instructions : colonnes déclarées dans un `create table`, contraintes de niveau table,
 * `add column … references`, `add constraint … foreign key`, `drop constraint` et `drop table`. Une clé
 * déclarée sur la colonne porte le nom que Postgres lui donne (`<table>_<colonne>_fkey`) : c'est ce
 * qui permet à un `drop constraint` de la retrouver.
 *
 * Une forme que l'export n'a jamais portée — clé composite, `SET DEFAULT`, colonne renommée ou
 * retirée, table renommée — LÈVE `FormeInconnue` au lieu d'être devinée : la règle s'écrira et se
 * vérifiera le jour où elle apparaîtra, contre `pg_constraint`.
 */
export function relationsDuSchema(fichiers: { chemin: string; texte: string }[]): RelationDuSchema[] {
  const parNom = new Map<string, RelationDuSchema>()
  const ajouter = (r: Omit<RelationDuSchema, 'nom'>, nom: string | undefined) => {
    const n = nom ?? `${r.enfant}_${r.colonne}_fkey`
    parNom.set(n, { ...r, nom: n })
  }

  for (const { texte } of fichiers) {
    const sql = sansCorpsDeFonction(texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n'))
    type Evt = { i: number; genre: 'create' | 'alter' | 'drop_table'; table: string; pos: number }
    const evts: Evt[] = []
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi)) {
      evts.push({ i: m.index!, genre: 'create', table: m[1], pos: m.index! + m[0].length - 1 })
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?(\w+)"?\s+/gi)) {
      evts.push({ i: m.index!, genre: 'alter', table: m[1], pos: m.index! + m[0].length })
    }
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi)) {
      evts.push({ i: m.index!, genre: 'drop_table', table: m[1], pos: m.index! })
    }
    evts.sort((a, b) => a.i - b.i)

    for (const e of evts) {
      if (e.genre === 'drop_table') {
        for (const [n, r] of parNom) if (r.enfant === e.table) parNom.delete(n)
        continue
      }
      if (e.genre === 'create') {
        for (const entree of entrees(groupe(sql, e.pos).corps)) {
          const t = entree.trim()
          const niveauTable = new RegExp(String.raw`^(?:constraint\s+"?(\w+)"?\s+)?foreign\s+key\s*\(([^)]*)\)\s*${CIBLE}([\s\S]*)$`, 'i').exec(t)
          if (niveauTable) {
            const [, nom, cols, schema, parent, queue] = niveauTable
            ajouter({ enfant: e.table, colonne: uneColonne(cols, t), parent: cible(schema, parent), aLaSuppression: actionDe(queue) }, nom)
            continue
          }
          if (/^(constraint|primary|unique|check|exclude|like)\b/i.test(t)) continue
          const colonne = new RegExp(String.raw`^"?(\w+)"?\s[\s\S]*?\b${CIBLE}([\s\S]*)$`, 'i').exec(t)
          if (colonne) {
            const [, col, schema, parent, queue] = colonne
            ajouter({ enfant: e.table, colonne: col, parent: cible(schema, parent), aLaSuppression: actionDe(queue) }, undefined)
          }
        }
        continue
      }
      // Un `alter table` jusqu'à son point-virgule, découpé en actions sur les virgules de premier
      // niveau : `add column a …, add column b …` est une seule instruction.
      const finInstruction = sql.indexOf(';', e.pos)
      const corps = sql.slice(e.pos, finInstruction < 0 ? undefined : finInstruction)
      for (const action of entrees(corps)) {
        const a = action.trim()
        if (/^(rename|drop\s+column)\b/i.test(a)) {
          throw new FormeInconnue(`${e.table} : « ${a.slice(0, 60)} » jamais rencontré — les clés qui en dépendent ne se déduisent pas encore`)
        }
        const drop = /^drop\s+constraint\s+(?:if\s+exists\s+)?"?(\w+)"?/i.exec(a)
        if (drop) { parNom.delete(drop[1]); continue }
        const contrainte = new RegExp(String.raw`^add\s+(?:constraint\s+"?(\w+)"?\s+)?foreign\s+key\s*\(([^)]*)\)\s*${CIBLE}([\s\S]*)$`, 'i').exec(a)
        if (contrainte) {
          const [, nom, cols, schema, parent, queue] = contrainte
          ajouter({ enfant: e.table, colonne: uneColonne(cols, a), parent: cible(schema, parent), aLaSuppression: actionDe(queue) }, nom)
          continue
        }
        const colonne = new RegExp(String.raw`^add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s[\s\S]*?\b${CIBLE}([\s\S]*)$`, 'i').exec(a)
        if (colonne) {
          const [, col, schema, parent, queue] = colonne
          ajouter({ enfant: e.table, colonne: col, parent: cible(schema, parent), aLaSuppression: actionDe(queue) }, undefined)
        }
      }
    }
  }
  return [...parNom.values()].sort((a, b) =>
    a.enfant.localeCompare(b.enfant) || a.colonne.localeCompare(b.colonne) || a.parent.localeCompare(b.parent))
}
