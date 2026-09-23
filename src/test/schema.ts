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
