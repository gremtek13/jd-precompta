#!/usr/bin/env node
// LE GARDE-FOU DE MVP-D9 : NE LAISSE PARTIR SEULE QU'UNE LECTURE SIMPLE.
//
// POURQUOI. Quand la base portera les données réelles d'un premier praticien, les migrations, les déploiements et toute
// écriture attendent le bouton du cabinet ; les lectures partent seules (la recommandation de MVP-D9). Une règle de
// permission « demander » ne lit pas le contenu d'une requête : pour l'outil `execute_sql`, qui porte les lectures de
// tous les jours comme les écritures, il faut lire chaque requête avant son départ. Ce programme le fait. Il n'est
// branché nulle part tant que le cabinet ne l'a pas accordé : le mode d'emploi et le bloc à poser sont dans README.md.
//
// LA RÈGLE, DU CÔTÉ FERMÉ. Une requête n'est une lecture simple que si elle est PROUVÉE telle :
//   1. elle se lit en entier (chaînes, identifiants entre guillemets, commentaires, corps entre dollars fermés) ;
//   2. elle ne porte qu'UNE instruction ;
//   3. elle commence par SELECT, WITH … SELECT, VALUES, TABLE, SHOW ou EXPLAIN sans ANALYZE ;
//   4. aucun mot qui écrit, verrouille ou change la session n'y paraît hors d'un littéral (INSERT, UPDATE, DELETE,
//      MERGE, INTO, SHARE, SET, COPY, DO, CALL, LOCK…) ;
//   5. tout nom suivi d'une parenthèse est un mot de la syntaxe ou une fonction de la LISTE FERMÉE ci-dessous.
// Tout le reste fait DEMANDER, avec sa raison. Ce qui ne s'analyse pas fait demander aussi.
//
// CE QU'IL N'EST PAS. Il arrête une erreur de la session, pas un adversaire. Il lit un texte, pas la base : une vue
// dont la définition appelle une fonction qui écrit, un opérateur ou une conversion définis par quelqu'un, une
// fonction de `public` qui porterait le nom d'une fonction de la liste, une fonction appelée sans parenthèses sur une
// ligne (`t.ma_fonction`) lui échappent. Rien de tel n'existe par accident ; la RLS, les gardes et les droits de la
// base restent la protection des données.
//
// SOURCES. La forme des jetons : documentation de PostgreSQL 17, « 4.1. Lexical Structure »
// (https://www.postgresql.org/docs/17/sql-syntax-lexical.html) ; SELECT, WITH, EXPLAIN, SHOW : leurs pages de
// référence. Le format d'un hook PreToolUse : documentation de Claude Code, « Hooks reference »
// (https://code.claude.com/docs/en/hooks), lue le 13/11/2026 — isolé dans `reponseDuHook` et `lireLAppel`.

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── Les jetons ──────────────────────────────────────────────────────────────────────────────────────────────────────

// Les seuls blancs de PostgreSQL. Une espace insécable n'en est pas un : elle fait partie d'un identifiant, comme
// tout caractère au-delà de l'ASCII — `\s` de JavaScript verrait deux mots là où la base n'en lit qu'un.
const BLANCS = ' \t\n\r\f\v'
const PONCTUATION = '()[],;.:+-*/<>=~!@#%^&|?'

const debutDIdentifiant = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c.charCodeAt(0) >= 0x80
const suiteDIdentifiant = (c) => debutDIdentifiant(c) || (c >= '0' && c <= '9') || c === '$'
const chiffre = (c) => c >= '0' && c <= '9'

const NOMBRE = /(?:0[xX][0-9A-Fa-f_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)/y

/** La balise qui ouvre un corps entre dollars à l'indice `i` (`$$`, `$nom$`), ou `null`. */
function baliseDollar(sql, i) {
  let j = i + 1
  if (sql[j] !== '$') {
    if (j >= sql.length || !debutDIdentifiant(sql[j])) return null
    j += 1
    while (j < sql.length && sql[j] !== '$' && suiteDIdentifiant(sql[j])) j += 1
    if (sql[j] !== '$') return null
  }
  return sql.slice(i, j + 1)
}

/**
 * Découpe une requête en jetons, comme PostgreSQL la lit. Les commentaires et les blancs disparaissent ; une chaîne,
 * un corps entre dollars, un identifiant entre guillemets deviennent UN jeton, quoi qu'ils contiennent.
 * Rend `{ jetons }`, ou `{ erreur }` dès que quelque chose ne se lit pas avec certitude.
 */
export function lireLesJetons(sql) {
  const jetons = []
  const n = sql.length
  let i = 0
  while (i < n) {
    const c = sql[i]
    const suivant = sql[i + 1]
    if (BLANCS.includes(c)) {
      i += 1
      continue
    }
    // Un commentaire de ligne finit au saut de ligne OU au retour chariot (la règle de PostgreSQL).
    if (c === '-' && suivant === '-') {
      while (i < n && sql[i] !== '\n' && sql[i] !== '\r') i += 1
      continue
    }
    // Un commentaire en bloc s'imbrique.
    if (c === '/' && suivant === '*') {
      let profondeur = 1
      i += 2
      while (i < n && profondeur > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          profondeur += 1
          i += 2
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          profondeur -= 1
          i += 2
        } else i += 1
      }
      if (profondeur > 0) return { erreur: 'un commentaire /* … */ n’est pas fermé' }
      continue
    }
    // Les échappements Unicode (U&'…', U&"…") peuvent écrire un nom sans le montrer : ils font demander.
    if ((c === 'u' || c === 'U') && suivant === '&' && (sql[i + 2] === "'" || sql[i + 2] === '"')) {
      return { erreur: 'une chaîne ou un identifiant à échappements Unicode (U&) ne se lit pas ici' }
    }
    // Une chaîne à échappements : la barre oblique inverse y protège le caractère qui suit.
    if ((c === 'e' || c === 'E') && suivant === "'") {
      let j = i + 2
      let fermee = false
      while (j < n) {
        if (sql[j] === '\\') j += 2
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") {
          fermee = true
          break
        } else j += 1
      }
      if (!fermee) return { erreur: 'une chaîne E\'…\' n’est pas fermée' }
      jetons.push({ type: 'chaine' })
      i = j + 1
      continue
    }
    // Une chaîne ordinaire (ou b'…', x'…', n'…'). Une barre oblique inverse devant une apostrophe s'y lit de deux
    // façons selon un réglage de la base (`standard_conforming_strings`) : le doute fait demander.
    if (c === "'" || ('bBxXnN'.includes(c) && suivant === "'")) {
      let j = c === "'" ? i + 1 : i + 2
      let fermee = false
      while (j < n) {
        if (sql[j] === '\\' && sql[j + 1] === "'") {
          return { erreur: 'une barre oblique inverse précède une apostrophe dans une chaîne ordinaire' }
        }
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") {
          fermee = true
          break
        } else j += 1
      }
      if (!fermee) return { erreur: 'une chaîne n’est pas fermée' }
      jetons.push({ type: 'chaine' })
      i = j + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      let fermee = false
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2
        else if (sql[j] === '"') {
          fermee = true
          break
        } else j += 1
      }
      if (!fermee) return { erreur: 'un identifiant entre guillemets n’est pas fermé' }
      if (j === i + 1) return { erreur: 'un identifiant entre guillemets est vide' }
      jetons.push({ type: 'ident', texte: sql.slice(i + 1, j).replaceAll('""', '"') })
      i = j + 1
      continue
    }
    if (c === '$') {
      if (chiffre(suivant ?? '')) {
        let j = i + 1
        while (j < n && chiffre(sql[j])) j += 1
        jetons.push({ type: 'parametre' })
        i = j
        continue
      }
      const balise = baliseDollar(sql, i)
      if (balise === null) return { erreur: 'un signe dollar ne se lit pas' }
      const fin = sql.indexOf(balise, i + balise.length)
      if (fin < 0) return { erreur: 'un corps entre dollars n’est pas fermé' }
      jetons.push({ type: 'chaine' })
      i = fin + balise.length
      continue
    }
    if (debutDIdentifiant(c)) {
      let j = i + 1
      while (j < n && suiteDIdentifiant(sql[j])) j += 1
      jetons.push({ type: 'mot', texte: sql.slice(i, j).toLowerCase() })
      i = j
      continue
    }
    if (chiffre(c) || (c === '.' && chiffre(suivant ?? ''))) {
      NOMBRE.lastIndex = i
      const nombre = NOMBRE.exec(sql)
      const j = i + nombre[0].length
      // « 1into » : selon sa version, PostgreSQL y lit une erreur ou deux jetons. Le doute fait demander.
      if (j < n && debutDIdentifiant(sql[j])) return { erreur: 'un nombre est suivi de lettres' }
      jetons.push({ type: 'nombre' })
      i = j
      continue
    }
    if (c === ':' && suivant === ':') {
      jetons.push({ type: 'signe', texte: '::' })
      i += 2
      continue
    }
    if (PONCTUATION.includes(c)) {
      jetons.push({ type: 'signe', texte: c })
      i += 1
      continue
    }
    return { erreur: `un caractère ne se lit pas hors d’un littéral (code ${c.charCodeAt(0)})` }
  }
  return { jetons }
}

// ── Les listes fermées ──────────────────────────────────────────────────────────────────────────────────────────────

// Les instructions par lesquelles une lecture simple peut commencer.
const DEBUTS_DE_LECTURE = new Set(['select', 'with', 'values', 'table'])

// Les mots qui, hors d'un littéral, écrivent, verrouillent, créent ou changent la session. INTO est le SELECT … INTO
// (qui crée une table) ; UPDATE et SHARE couvrent FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE et FOR KEY SHARE ; ANALYZE
// fait EXÉCUTER ce qu'EXPLAIN ne ferait que planifier. Une colonne qui porterait l'un de ces noms fait demander :
// c'est le prix du côté fermé.
const MOTS_INTERDITS = new Set([
  'insert', 'update', 'delete', 'merge', 'into', 'share', 'analyze', 'analyse',
  'set', 'reset', 'copy', 'do', 'call', 'lock', 'notify', 'listen', 'unlisten',
  'grant', 'revoke', 'create', 'alter', 'drop', 'truncate', 'vacuum', 'reindex', 'refresh', 'cluster',
  'prepare', 'execute', 'deallocate', 'declare', 'discard', 'checkpoint', 'load',
  'begin', 'commit', 'rollback', 'savepoint', 'abort',
])

// Les mots de la syntaxe qu'une parenthèse peut suivre sans que ce soit un appel de fonction.
const MOTS_AVANT_PARENTHESE = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'in', 'as', 'on', 'using', 'join', 'lateral', 'values',
  'union', 'intersect', 'except', 'all', 'any', 'some', 'exists', 'distinct', 'case', 'when', 'then', 'else',
  'having', 'limit', 'offset', 'like', 'ilike', 'between', 'array', 'row', 'cast', 'group',
])
// Ceux-là ne sont des mots de la syntaxe qu'à leur place ; ailleurs ils pourraient nommer une fonction.
const MOTS_AVANT_PARENTHESE_A_LEUR_PLACE = {
  by: (avant) => avant?.type === 'mot' && ['order', 'group', 'partition'].includes(avant.texte),
  over: (avant) => estSigne(avant, ')'),
  filter: (avant) => estSigne(avant, ')'),
}

// LA LISTE FERMÉE des fonctions sans effet : elles calculent ou lisent le catalogue, n'écrivent rien, ne verrouillent
// rien, ne changent pas la session, n'exécutent pas un texte SQL, ne lisent ni fichier ni réseau. Une fonction absente
// d'ici fait DEMANDER — toute fonction de `public`, `nextval`, `setval`, `set_config`, `pg_advisory_*`, `dblink`,
// `pg_read_file`, `lo_*`, `pg_sleep`, `pg_terminate_backend`, `net.http_*`, `query_to_xml` (qui exécute son
// argument)… Y ajouter un nom demande de savoir ce qu'il fait ; ne jamais y mettre un nom « parce qu'un contrôle
// ne passe pas ».
const FONCTIONS_SANS_EFFET = new Set([
  // Agrégats et fenêtres.
  'count', 'sum', 'avg', 'min', 'max', 'string_agg', 'array_agg', 'bool_and', 'bool_or', 'every',
  'json_agg', 'jsonb_agg', 'json_object_agg', 'jsonb_object_agg', 'bit_and', 'bit_or',
  'stddev', 'stddev_pop', 'stddev_samp', 'variance', 'var_pop', 'var_samp',
  'percentile_cont', 'percentile_disc', 'mode',
  'row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile', 'lag', 'lead',
  'first_value', 'last_value', 'nth_value',
  // Conditions.
  'coalesce', 'nullif', 'greatest', 'least',
  // Chaînes et empreintes.
  'md5', 'sha224', 'sha256', 'sha384', 'sha512', 'length', 'char_length', 'character_length', 'octet_length',
  'bit_length', 'lower', 'upper', 'initcap', 'trim', 'btrim', 'ltrim', 'rtrim', 'lpad', 'rpad', 'left', 'right',
  'substr', 'substring', 'position', 'strpos', 'overlay', 'replace', 'translate', 'repeat', 'reverse',
  'split_part', 'concat', 'concat_ws', 'format', 'quote_ident', 'quote_literal', 'quote_nullable',
  'regexp_replace', 'regexp_match', 'regexp_matches', 'regexp_split_to_table', 'regexp_split_to_array',
  'regexp_count', 'regexp_like', 'regexp_substr', 'regexp_instr', 'string_to_array', 'string_to_table',
  'array_to_string', 'starts_with', 'encode', 'decode', 'convert_from', 'convert_to', 'ascii', 'chr', 'to_hex',
  'normalize',
  // Nombres.
  'abs', 'round', 'ceil', 'ceiling', 'floor', 'trunc', 'mod', 'div', 'power', 'sqrt', 'sign', 'exp', 'ln', 'log',
  'width_bucket',
  // Dates.
  'now', 'clock_timestamp', 'statement_timestamp', 'transaction_timestamp', 'timeofday', 'age', 'date_trunc',
  'date_part', 'extract', 'date_bin', 'to_char', 'to_date', 'to_timestamp', 'to_number', 'make_date', 'make_time',
  'make_timestamp', 'make_timestamptz', 'make_interval', 'justify_days', 'justify_hours', 'justify_interval',
  'isfinite', 'timezone',
  // Tableaux et séries.
  'array_length', 'cardinality', 'unnest', 'array_position', 'array_positions', 'array_append', 'array_prepend',
  'array_cat', 'array_remove', 'array_replace', 'array_dims', 'array_ndims', 'array_lower', 'array_upper',
  'generate_series', 'generate_subscripts',
  // JSON.
  'to_json', 'to_jsonb', 'row_to_json', 'array_to_json', 'json_build_object', 'jsonb_build_object',
  'json_build_array', 'jsonb_build_array', 'json_object', 'jsonb_object', 'json_array_elements',
  'jsonb_array_elements', 'json_array_elements_text', 'jsonb_array_elements_text', 'json_each', 'jsonb_each',
  'json_each_text', 'jsonb_each_text', 'json_object_keys', 'jsonb_object_keys', 'json_typeof', 'jsonb_typeof',
  'json_array_length', 'jsonb_array_length', 'json_extract_path', 'jsonb_extract_path', 'json_extract_path_text',
  'jsonb_extract_path_text', 'jsonb_pretty', 'json_strip_nulls', 'jsonb_strip_nulls', 'jsonb_set', 'jsonb_insert',
  'jsonb_path_exists', 'jsonb_path_query', 'jsonb_path_query_array', 'jsonb_path_query_first',
  // Types écrits avec leur précision (« numeric(12,2) », « varchar(10) ») ou appelés comme une conversion.
  'numeric', 'decimal', 'varchar', 'char', 'character', 'varying', 'bit', 'float', 'time', 'timestamp',
  'timestamptz', 'interval', 'text', 'date', 'int2', 'int4', 'int8', 'float4', 'float8', 'bool',
  // Le catalogue : des définitions et des droits LUS.
  'pg_get_expr', 'pg_get_constraintdef', 'pg_get_indexdef', 'pg_get_functiondef', 'pg_get_triggerdef',
  'pg_get_viewdef', 'pg_get_ruledef', 'pg_get_function_identity_arguments', 'pg_get_function_arguments',
  'pg_get_function_result', 'pg_get_userbyid', 'pg_get_serial_sequence', 'pg_get_partkeydef',
  'pg_get_statisticsobjdef', 'format_type', 'aclexplode', 'acldefault',
  'to_regclass', 'to_regproc', 'to_regprocedure', 'to_regtype', 'to_regnamespace', 'to_regrole', 'to_regoper',
  'to_regoperator', 'to_regcollation',
  'has_table_privilege', 'has_column_privilege', 'has_any_column_privilege', 'has_function_privilege',
  'has_schema_privilege', 'has_sequence_privilege', 'has_database_privilege', 'has_type_privilege', 'pg_has_role',
  'row_security_active', 'pg_table_is_visible', 'pg_function_is_visible', 'pg_type_is_visible',
  'obj_description', 'col_description', 'shobj_description', 'pg_describe_object', 'pg_typeof',
  'pg_column_size', 'pg_relation_size', 'pg_total_relation_size', 'pg_table_size', 'pg_indexes_size',
  'pg_database_size', 'pg_size_pretty', 'pg_encoding_to_char', 'pg_options_to_table',
  // La session, LUE. `current_setting` lit un réglage (avec ou sans son second argument) ; `set_config`, qui en
  // écrit un, n'est pas ici.
  'current_setting', 'current_database', 'current_schema', 'current_schemas', 'version', 'pg_backend_pid',
  'pg_postmaster_start_time', 'pg_is_in_recovery',
])

// ── Le jugement ─────────────────────────────────────────────────────────────────────────────────────────────────────

const estMot = (jeton, texte) => jeton?.type === 'mot' && jeton.texte === texte
const estSigne = (jeton, texte) => jeton?.type === 'signe' && jeton.texte === texte
const estUnNom = (jeton) => jeton?.type === 'mot' || jeton?.type === 'ident'
const non = (raison) => ({ lectureSimple: false, raison })

/** Pour chaque parenthèse, l'indice de celle qui lui répond ; `null` si elles ne s'équilibrent pas. */
function apparierLesParentheses(jetons) {
  const paire = new Array(jetons.length).fill(-1)
  const pile = []
  for (let i = 0; i < jetons.length; i += 1) {
    if (estSigne(jetons[i], '(')) pile.push(i)
    else if (estSigne(jetons[i], ')')) {
      if (pile.length === 0) return null
      const ouvrante = pile.pop()
      paire[ouvrante] = i
      paire[i] = ouvrante
    }
  }
  return pile.length === 0 ? paire : null
}

/** Entre deux parenthèses, rien que des noms séparés par des virgules (une liste de colonnes), et au moins un. */
function listeDeNoms(jetons, ouvrante, fermante) {
  if (fermante - ouvrante < 2) return false
  for (let i = ouvrante + 1; i < fermante; i += 1) {
    if (!estUnNom(jetons[i]) && !estSigne(jetons[i], ',')) return false
  }
  return true
}

/** L'indice du premier jeton qui n'est pas une parenthèse ouvrante, à partir de `i`. */
function apresLesParenthesesOuvrantes(jetons, i) {
  let j = i
  while (estSigne(jetons[j], '(')) j += 1
  return j
}

const commenceUneLecture = (jetons, i) => {
  const premier = jetons[apresLesParenthesesOuvrantes(jetons, i)]
  return premier?.type === 'mot' && DEBUTS_DE_LECTURE.has(premier.texte)
}

/**
 * Lit la liste qui suit un WITH : `nom [(colonnes)] as [[not] materialized] ( lecture ) [, …]`. Marque comme
 * « hors appel » les noms qu'une parenthèse suit sans que ce soit une fonction. Rend l'indice du jeton qui suit la
 * liste, ou `{ erreur }`. Un WITH qui n'ouvre pas une liste (WITH ORDINALITY, WITH TIME ZONE, WITH TIES) rend son
 * propre indice + 1.
 */
function lireLaListeDUnWith(jetons, paire, indiceDuWith, horsAppel) {
  let j = indiceDuWith + 1
  if (jetons[j]?.type === 'mot' && ['ordinality', 'time', 'ties'].includes(jetons[j].texte)) return { fin: j }
  if (estMot(jetons[j], 'recursive')) j += 1
  for (;;) {
    if (!estUnNom(jetons[j])) return { erreur: 'la liste d’un WITH ne se lit pas' }
    horsAppel.add(j)
    j += 1
    if (estSigne(jetons[j], '(')) {
      if (!listeDeNoms(jetons, j, paire[j])) return { erreur: 'la liste d’un WITH ne se lit pas' }
      j = paire[j] + 1
    }
    if (!estMot(jetons[j], 'as')) return { erreur: 'la liste d’un WITH ne se lit pas' }
    j += 1
    if (estMot(jetons[j], 'not')) {
      j += 1
      if (!estMot(jetons[j], 'materialized')) return { erreur: 'la liste d’un WITH ne se lit pas' }
    }
    if (estMot(jetons[j], 'materialized')) {
      horsAppel.add(j)
      j += 1
    }
    if (!estSigne(jetons[j], '(')) return { erreur: 'la liste d’un WITH ne se lit pas' }
    if (!commenceUneLecture(jetons, j + 1)) return { erreur: 'un WITH porte autre chose qu’une lecture' }
    j = paire[j] + 1
    if (!estSigne(jetons[j], ',')) return { fin: j }
    j += 1
  }
}

/**
 * `nom (colonnes)` est-il le nom d'emprunt d'une table, suivi de ses colonnes — et non un appel ? Seulement là où la
 * syntaxe n'admet rien d'autre : après AS, après WITH ORDINALITY, ou après la parenthèse fermante d'une sous-requête
 * ou d'une fonction de la clause FROM. `distinct on (a) f(b)` n'en est pas : f y est appelée.
 */
function nomDEmpruntAvecColonnes(jetons, paire, i) {
  if (!listeDeNoms(jetons, i + 1, paire[i + 1])) return false
  const avant = jetons[i - 1]
  if (estMot(avant, 'as') || estMot(avant, 'ordinality')) return true
  if (!estSigne(avant, ')')) return false
  const devantLeGroupe = jetons[paire[i - 1] - 1]
  if (estSigne(devantLeGroupe, ',')) return true
  if (devantLeGroupe?.type !== 'mot') return false
  if (['from', 'join', 'lateral'].includes(devantLeGroupe.texte)) return true
  // Une fonction de la clause FROM, elle-même jugée à son tour : `unnest(x) u(y)`.
  return !MOTS_AVANT_PARENTHESE.has(devantLeGroupe.texte) && !(devantLeGroupe.texte in MOTS_AVANT_PARENTHESE_A_LEUR_PLACE)
}

/**
 * Juge une requête : une LECTURE SIMPLE peut partir seule, tout le reste attend le bouton.
 * @param {unknown} sql
 * @returns {{ lectureSimple: boolean, raison: string }}
 */
export function jugerLaRequete(sql) {
  if (typeof sql !== 'string') return non('la requête n’est pas un texte')
  if (sql.includes('\0')) return non('la requête porte un caractère nul')
  // Les outils décodent les échappements \uXXXX de leurs paramètres : le texte qui partirait ne serait pas celui lu ici.
  if (/\\u[0-9a-fA-F]{4}/.test(sql)) return non('la requête porte un échappement \\uXXXX, qu’un outil peut décoder avant l’envoi')

  const lecture = lireLesJetons(sql)
  if (lecture.erreur) return non(`la requête ne s’analyse pas : ${lecture.erreur}`)
  const jetons = lecture.jetons
  while (estSigne(jetons.at(-1), ';')) jetons.pop()
  if (jetons.length === 0) return non('la requête est vide')
  if (jetons.some((j) => estSigne(j, ';'))) return non('la requête porte plusieurs instructions')

  const paire = apparierLesParentheses(jetons)
  if (!paire) return non('la requête ne s’analyse pas : ses parenthèses ne s’équilibrent pas')

  const interdit = jetons.find((j) => j.type === 'mot' && MOTS_INTERDITS.has(j.texte))
  if (interdit) return non(`le mot « ${interdit.texte.toUpperCase()} » paraît hors d’un littéral`)

  // Par quoi elle commence.
  let debut = 0
  if (estMot(jetons[0], 'show')) {
    const suite = jetons.slice(1)
    const simple = suite.length >= 1 && suite.length <= 4 && suite.every((j) => j.type === 'mot' || estSigne(j, '.'))
    return simple ? { lectureSimple: true, raison: 'SHOW lit un réglage' } : non('ce SHOW ne se lit pas')
  }
  if (estMot(jetons[0], 'explain')) {
    // ANALYZE, qui exécuterait, est déjà refusé plus haut, où qu'il soit.
    debut = 1
    if (estSigne(jetons[1], '(')) debut = paire[1] + 1
    else while (estMot(jetons[debut], 'verbose')) debut += 1
  }
  if (!commenceUneLecture(jetons, debut)) {
    return non('la requête ne commence pas par SELECT, WITH, VALUES, TABLE, SHOW ou EXPLAIN')
  }

  // Les WITH, où qu'ils soient ; celui de tête doit finir sur une lecture.
  const horsAppel = new Set()
  for (let i = debut; i < jetons.length; i += 1) {
    if (!estMot(jetons[i], 'with')) continue
    const liste = lireLaListeDUnWith(jetons, paire, i, horsAppel)
    if (liste.erreur) return non(liste.erreur)
    if (i === apresLesParenthesesOuvrantes(jetons, debut)) {
      const apres = jetons[apresLesParenthesesOuvrantes(jetons, liste.fin)]
      if (apres?.type !== 'mot' || !DEBUTS_DE_LECTURE.has(apres.texte) || apres.texte === 'with') {
        return non('le WITH de tête n’est pas suivi d’une lecture')
      }
    }
  }

  // Tout nom qu'une parenthèse suit (les options d'un EXPLAIN, devant `debut`, ne sont pas des appels).
  for (let i = debut; i < jetons.length; i += 1) {
    const jeton = jetons[i]
    if (!estUnNom(jeton) || !estSigne(jetons[i + 1], '(') || horsAppel.has(i)) continue
    const avant = jetons[i - 1]
    if (jeton.type === 'mot' && !estSigne(avant, '.')) {
      if (MOTS_AVANT_PARENTHESE.has(jeton.texte)) continue
      if (MOTS_AVANT_PARENTHESE_A_LEUR_PLACE[jeton.texte]?.(avant)) continue
    }
    if (nomDEmpruntAvecColonnes(jetons, paire, i)) continue
    if (jeton.type === 'ident') return non(`un nom entre guillemets précède une parenthèse : "${jeton.texte}"`)
    if (estSigne(avant, '.')) {
      const schema = jetons[i - 2]
      if (!estMot(schema, 'pg_catalog') || estSigne(jetons[i - 3], '.')) {
        return non(`la fonction « ${jeton.texte} » est appelée dans un autre schéma que pg_catalog`)
      }
    }
    if (!FONCTIONS_SANS_EFFET.has(jeton.texte)) {
      return non(`la fonction « ${jeton.texte} » n’est pas dans la liste fermée des fonctions sans effet`)
    }
  }

  return { lectureSimple: true, raison: 'une seule instruction, qui lit' }
}

// ── Le hook PreToolUse ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Décide pour un appel d'outil, tel que Claude Code le présente à un hook PreToolUse.
 * `allow` : une lecture simple par `execute_sql`. `ask` : tout le reste — une requête qui n'est pas prouvée lecture
 * simple, un outil que le garde-fou ne sait pas juger, un appel illisible. `deny` : la même chose quand la session
 * tourne dans un mode où rien ne garantit que le bouton paraisse.
 * @returns {{ decision: 'allow' | 'ask' | 'deny', raison: string }}
 */
export function deciderPourLAppel(appel) {
  const retenir = (raison) => {
    // La documentation ne dit pas qu'un « ask » de hook fasse paraître le bouton en mode bypassPermissions.
    if (appel?.permission_mode === 'bypassPermissions') {
      return { decision: 'deny', raison: `${raison} — et ce mode de la session ne garantit pas le bouton du cabinet` }
    }
    return { decision: 'ask', raison }
  }
  if (appel === null || typeof appel !== 'object') return retenir('Garde-fou : l’appel ne se lit pas.')
  const outil = appel.tool_name
  if (typeof outil !== 'string' || !/^mcp__.+__execute_sql$/.test(outil)) {
    return retenir('Garde-fou : cet outil n’est pas de ceux qu’il sait juger.')
  }
  const verdict = jugerLaRequete(appel.tool_input?.query)
  if (verdict.lectureSimple) return { decision: 'allow', raison: `Garde-fou : lecture simple (${verdict.raison}).` }
  return retenir(`Garde-fou : cette requête attend le bouton du cabinet — ${verdict.raison}.`)
}

/** Lit l'entrée d'un hook (le JSON de l'appel d'outil). Illisible, elle rend `null`, qui fera demander. */
export function lireLAppel(texte) {
  try {
    return JSON.parse(texte)
  } catch {
    return null
  }
}

/** LE format de sortie d'un hook PreToolUse, et lui seul : un objet JSON, imprimé seul, le programme sortant en 0. */
export function reponseDuHook({ decision, raison }) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: raison,
    },
  }
}

/** De l'entrée standard d'un hook à sa sortie standard. Ne lève jamais : ce qui échoue fait demander. */
export function repondreAuHook(entree) {
  let decision
  try {
    decision = deciderPourLAppel(lireLAppel(entree))
  } catch {
    decision = { decision: 'ask', raison: 'Garde-fou : il n’a pas su juger cet appel.' }
  }
  return JSON.stringify(reponseDuHook(decision))
}

const lanceDirectement = () => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (lanceDirectement()) {
  let entree = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (morceau) => {
    entree += morceau
  })
  process.stdin.on('end', () => {
    process.stdout.write(`${repondreAuHook(entree)}\n`)
  })
}
