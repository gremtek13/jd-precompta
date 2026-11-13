import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  deciderPourLAppel,
  jugerLaRequete,
  lireLesJetons,
  repondreAuHook,
  reponseDuHook,
} from '../../outils/gardefou/lectureSeule.mjs'

// LE GARDE-FOU DE MVP-D9 (outils/gardefou/lectureSeule.mjs) : une requête ne part seule que si elle est PROUVÉE lecture
// simple. Ce test tient trois choses :
//   1. les contrôles que la session joue tous les jours passent seuls — lus DEPUIS LEURS FICHIERS : s'ils ne passent
//      plus, c'est la liste fermée qui est trop courte (ou le contrôle qui a changé de nature), pas ce test ;
//   2. tout ce qui écrit, verrouille, change la session ou appelle une fonction inconnue fait demander, pièges compris ;
//   3. le format du hook, joué de bout en bout par le programme lui-même (entrée standard → sortie standard).
// Rien n'est branché : `.claude/settings.json` ne nomme pas ce programme tant que le cabinet ne l'a pas accordé.

const RACINE = resolve(process.cwd())
const lire = (chemin: string) => readFileSync(resolve(RACINE, chemin), 'utf8')
const PROGRAMME = resolve(RACINE, 'outils/gardefou/lectureSeule.mjs')
// Écrite par son code : un outil d'écriture de fichiers décode les échappements, et le caractère ne se verrait plus.
const ESPACE_INSECABLE = String.fromCharCode(0xa0)

describe('les contrôles de tous les jours passent seuls', () => {
  it.each(['socle.sql', 'inventaire.sql', 'signature.sql', 'bornesStockage.sql'])(
    'supabase/essais/%s, commentaires compris',
    (fichier) => {
      expect(jugerLaRequete(lire(`supabase/essais/${fichier}`))).toEqual({
        lectureSimple: true,
        raison: 'une seule instruction, qui lit',
      })
    },
  )

  it('les requêtes de la dérive, dans supabase/schema/README.md', () => {
    const blocs = [...lire('supabase/schema/README.md').matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1])
    // Le plancher : la ligne par migration, l'empreinte agrégée, la régénération d'un fichier.
    expect(blocs.length).toBeGreaterThanOrEqual(3)
    for (const bloc of blocs) {
      expect(jugerLaRequete(bloc), bloc).toMatchObject({ lectureSimple: true })
    }
  })
})

describe('les essais qui écrivent puis annulent attendent le bouton', () => {
  it.each(['rls.sql', 'caisse.sql', 'factures.sql', 'validationExercice.sql', 'liquidationTva.sql', 'devis.sql'])(
    'supabase/essais/%s',
    (fichier) => {
      expect(jugerLaRequete(lire(`supabase/essais/${fichier}`)).lectureSimple).toBe(false)
    },
  )

  it('aucun essai qui ne commence pas par une lecture ne part seul', () => {
    const essais = readdirSync(resolve(RACINE, 'supabase/essais')).filter((f) => f.endsWith('.sql'))
    const commencePar = (sql: string) => {
      const premiere = sql.split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('--')) ?? ''
      return premiere.trim().split(/[\s(]/)[0].toLowerCase()
    }
    const quiEcrivent = essais.filter((f) => !['with', 'select'].includes(commencePar(lire(`supabase/essais/${f}`))))
    expect(quiEcrivent.length).toBeGreaterThanOrEqual(100)
    const partis = quiEcrivent.filter((f) => jugerLaRequete(lire(`supabase/essais/${f}`)).lectureSimple)
    expect(partis).toEqual([])
  })
})

describe('une lecture simple', () => {
  it.each([
    'select 1',
    'select 1;',
    'select 1 ; -- fin',
    "  select count(*) from pieces where dossier_id = '00000000-0000-4000-8000-000000000001'  ",
    // Un « ; » dans un corps entre dollars, dans une chaîne, dans un commentaire n'est pas une fin.
    'select $$;$$',
    'select $corps$ drop table t; $corps$ as texte',
    "select 'insert into t values (1); drop table t' as texte",
    "select E'l\\'apostrophe ; delete from t' as texte",
    "select 'l''apostrophe ; delete from t' as texte",
    'select 1 -- ; drop table t',
    'select 1 /* ; delete from t /* imbriqué ; */ encore ; */ + 1',
    // Un mot-clé entre guillemets est un identifiant.
    'select "update", "delete from t" from "set"',
    // Une barre oblique inverse qui ne précède pas une apostrophe se lit de la même façon sous les deux réglages.
    "select nom ~* '\\mconstraint\\s+' from t",
    'with a as (select 1 as x), b(y) as materialized (select x from a) select * from b',
    'with recursive n(i) as (select 1 union all select i + 1 from n where i < 5) select max(i) from n',
    "values (1, 'a'), (2, 'b')",
    'table pg_catalog.pg_namespace',
    'show search_path',
    'show transaction isolation level',
    'show all',
    'explain select * from pieces',
    'explain (format json, costs off) select 1',
    'explain verbose select 1',
    '(select 1) union all (select 2) order by 1',
    'select * from (values (1, 2)) v(a, b)',
    'select * from (values (1, 2)) as v(a, b)',
    'select * from unnest(array[1, 2]) with ordinality u(x, n)',
    'select x::numeric(12,2), cast(y as varchar(10)) from t',
    'select pg_catalog.md5(nom) from t',
    "select current_setting('server_version'), current_setting('jd.absent', true)",
    'select count(*) filter (where x > 0) over (partition by y order by z) from t',
    'select distinct on (dossier_id) dossier_id, lower(nom) from t order by dossier_id, created_at desc',
    'select a from t where b = any (array[1, 2]) and exists (select 1 from u where u.id = t.id) limit (5)',
    "select p.proname, pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace",
    "select timestamp with time zone '2026-11-20 10:00+01'",
  ])('part seule : %s', (sql) => {
    expect(jugerLaRequete(sql)).toMatchObject({ lectureSimple: true })
  })
})

describe('tout le reste attend le bouton', () => {
  it.each([
    // Plusieurs instructions, et les littéraux ou commentaires qui n'en cachent pas la fin.
    ['select 1; drop table t', 'plusieurs instructions'],
    ["select '--'; drop table t", 'plusieurs instructions'],
    ['select $$ $$; delete from t', 'plusieurs instructions'],
    ['select 1 /* fin */ ; delete from t', 'plusieurs instructions'],
    // Un retour chariot finit un commentaire de ligne, comme un saut de ligne.
    ['select 1 -- fin\r; drop table t', 'plusieurs instructions'],
    ['select 1 -- fin\n; drop table t', 'plusieurs instructions'],
    ['with x as (select 1) select * from x; drop table t', 'plusieurs instructions'],
    ['show search_path; select 1', 'plusieurs instructions'],
    // Un WITH qui écrit, ou qui finit sur une écriture.
    ['with x as (delete from t returning *) select * from x', '« DELETE »'],
    ['with x as (insert into t values (1) returning *) select * from x', '« INSERT »'],
    ['with x as (select 1) insert into t select * from x', '« INSERT »'],
    ['with x as (select 1) update t set a = 1', '« UPDATE »'],
    ['with x as (select 1) merge into t using x on true when matched then delete', '« MERGE »'],
    // Une lecture qui crée, ou qui verrouille.
    ['select * into copie from t', '« INTO »'],
    ['select * from t for update', '« UPDATE »'],
    ['select * from t for no key update', '« UPDATE »'],
    ['select * from t for share', '« SHARE »'],
    ['select * from t for key share skip locked', '« SHARE »'],
    // EXPLAIN qui exécute, ou qui explique autre chose qu'une lecture.
    ['explain analyze delete from t', '« ANALYZE »'],
    ['explain delete from t', '« DELETE »'],
    ['explain analyze select 1', '« ANALYZE »'],
    ['explain (analyze, buffers) select 1', '« ANALYZE »'],
    ['explain (analyse) select 1', '« ANALYSE »'],
    ['explain execute p', '« EXECUTE »'],
    // Une fonction hors de la liste fermée.
    ["select set_config('role', 'x', false)", '« set_config »'],
    ["select nextval('s')", '« nextval »'],
    ["select setval('s', 1)", '« setval »'],
    ['select une_fonction()', '« une_fonction »'],
    ['select * from une_fonction(1)', '« une_fonction »'],
    ['select public.une_fonction()', 'autre schéma'],
    ["select net.http_get('https://exemple.test')", 'autre schéma'],
    ['select pg_catalog.pg_sleep(1)', '« pg_sleep »'],
    ['select pg_sleep/**/(1)', '« pg_sleep »'],
    ['select pg_sleep\n  (1)', '« pg_sleep »'],
    ['select (select pg_advisory_lock(1))', '« pg_advisory_lock »'],
    ["select query_to_xml('delete from t', true, false, '')", '« query_to_xml »'],
    ['select "md5"(nom) from t', 'entre guillemets'],
    ['select bd.pg_catalog.md5(nom) from t', 'autre schéma'],
    // Un nom suivi de colonnes n'est un nom d'emprunt que là où la syntaxe n'admet rien d'autre.
    ['select distinct on (a) pg_sleep(b) from t', '« pg_sleep »'],
    ['select * from t, lateral une_fonction(a) as (x int)', '« une_fonction »'],
    ['select by(1)', '« by »'],
    ['select over(1)', '« over »'],
    ['select * from t tablesample bernoulli (10)', '« bernoulli »'],
    // Les instructions qui ne lisent pas.
    ['insert into t values (1)', '« INSERT »'],
    ['update t set a = 1', '« UPDATE »'],
    ['delete from t', '« DELETE »'],
    ['truncate t', '« TRUNCATE »'],
    ['drop table t', '« DROP »'],
    ['create table t (a int)', '« CREATE »'],
    ['alter table t add column b int', '« ALTER »'],
    ['grant select on t to anon', '« GRANT »'],
    ['copy t to stdout', '« COPY »'],
    ["copy (select 1) to program 'x'", '« COPY »'],
    ['do $$ begin null; end $$', '« DO »'],
    ['call p()', '« CALL »'],
    ["set role 'x'", '« SET »'],
    ['reset role', '« RESET »'],
    ['lock table t', '« LOCK »'],
    ["notify canal, 'x'", '« NOTIFY »'],
    ['listen canal', '« LISTEN »'],
    ['begin', '« BEGIN »'],
    ['commit', '« COMMIT »'],
    ['rollback', '« ROLLBACK »'],
    ['vacuum t', '« VACUUM »'],
    ['analyze t', '« ANALYZE »'],
    ['reindex table t', '« REINDEX »'],
    ['refresh materialized view v', '« REFRESH »'],
    ['prepare p as select 1', '« PREPARE »'],
    ['declare c cursor for select 1', '« DECLARE »'],
    ['fetch all from c', 'ne commence pas'],
    ['start transaction', 'ne commence pas'],
    ['end', 'ne commence pas'],
    ['with x as (select 1) search depth first by a set ordre select * from x', '« SET »'],
    ['with x as (select 1), select 2', 'WITH'],
    ['with x as (select 1) with z as (select 3) select 1', 'WITH'],
    ['show (select 1)', 'SHOW'],
    // Ce qui ne s'analyse pas.
    ['', 'vide'],
    ['   \n  ', 'vide'],
    ['-- rien', 'vide'],
    [';', 'vide'],
    ["select 'pas fermée", 'chaîne n’est pas fermée'],
    ["select E'pas fermée\\'", 'pas fermée'],
    ['select $a$ pas fermé $b$', 'entre dollars'],
    ['select /* pas fermé /* */', 'commentaire'],
    ['select "pas fermé', 'guillemets'],
    ['select (1', 'parenthèses'],
    ['select 1)', 'parenthèses'],
    ["select U&'\\0041'", 'Unicode'],
    ['select U&"d\\0061t\\0061"(1)', 'Unicode'],
    // Sous l'autre réglage de la base, cette chaîne finirait plus loin : le doute fait demander.
    ["select 'a\\'; drop table t; --'", 'barre oblique inverse'],
    ['select 1 \\; drop table t', 'caractère'],
    ['select {a}', 'caractère'],
    ["select '\\u0027; drop table t; --'", '\\uXXXX'],
    // Une espace insécable n'est pas un blanc pour PostgreSQL : « select », elle et « pg_sleep » y font UN mot.
    [`select${ESPACE_INSECABLE}pg_sleep(1)`, 'ne commence pas'],
    ['select 1into t from u', 'nombre'],
    ['select 1\0', 'caractère nul'],
  ])('demande : %s', (sql, raison) => {
    const verdict = jugerLaRequete(sql)
    expect(verdict.lectureSimple).toBe(false)
    expect(verdict.raison).toContain(raison)
  })

  it.each([42, null, undefined, {}, ['select 1']])('ce qui n’est pas un texte : %j', (valeur) => {
    expect(jugerLaRequete(valeur)).toEqual({ lectureSimple: false, raison: 'la requête n’est pas un texte' })
  })

  // La liste fermée ne s'allonge pas d'un nom qui écrit, verrouille, attend, lit un fichier ou exécute un texte.
  it.each([
    'nextval', 'setval', 'currval', 'lastval', 'set_config', 'setseed', 'pg_advisory_lock', 'pg_advisory_xact_lock',
    'pg_try_advisory_lock', 'pg_advisory_unlock', 'dblink', 'dblink_exec', 'pg_read_file', 'pg_read_binary_file',
    'pg_ls_dir', 'pg_stat_file', 'lo_import', 'lo_export', 'lo_unlink', 'lo_create', 'lowrite', 'pg_sleep',
    'pg_sleep_for', 'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_notify', 'pg_switch_wal',
    'pg_stat_reset', 'pg_logical_emit_message', 'txid_current', 'pg_current_xact_id', 'query_to_xml',
    'query_to_xml_and_xmlschema', 'table_to_xml', 'cursor_to_xml', 'ts_stat', 'ts_rewrite', 'http_get', 'http_post',
    'pg_create_restore_point', 'pg_export_snapshot', 'pg_replication_origin_create', 'pg_drop_replication_slot',
  ])('%s n’est pas une fonction sans effet', (nom) => {
    expect(jugerLaRequete(`select ${nom}(1)`)).toEqual({
      lectureSimple: false,
      raison: `la fonction « ${nom} » n’est pas dans la liste fermée des fonctions sans effet`,
    })
  })
})

describe('les jetons', () => {
  it('une chaîne, un corps entre dollars, un identifiant entre guillemets font chacun un jeton', () => {
    const lecture = lireLesJetons(`select 'a;b', $x$ c;d $x$, "e;f", E'g\\';h' from t -- i;j`)
    expect(lecture.jetons?.map((j) => j.texte ?? j.type)).toEqual([
      'select', 'chaine', ',', 'chaine', ',', 'e;f', ',', 'chaine', 'from', 't',
    ])
  })

  it('un mot se lit en minuscules, un identifiant entre guillemets tel quel', () => {
    expect(lireLesJetons('SeLeCt "SeLeCt"').jetons).toEqual([
      { type: 'mot', texte: 'select' },
      { type: 'ident', texte: 'SeLeCt' },
    ])
  })

  it('une espace insécable n’est pas un blanc : elle fait partie du mot, comme PostgreSQL la lit', () => {
    expect(lireLesJetons(`a${ESPACE_INSECABLE}b`).jetons).toHaveLength(1)
    expect(lireLesJetons(`a ${ESPACE_INSECABLE} b`).jetons).toHaveLength(3)
  })

  it('un dollar dans un identifiant n’ouvre pas un corps entre dollars', () => {
    expect(lireLesJetons('select a$b$ from t').jetons?.map((j) => j.texte)).toEqual(['select', 'a$b$', 'from', 't'])
  })
})

describe('le hook PreToolUse', () => {
  const appel = (outil: string, requete: unknown, mode = 'auto') => ({
    session_id: 'essai',
    cwd: RACINE,
    permission_mode: mode,
    hook_event_name: 'PreToolUse',
    tool_name: outil,
    tool_input: { project_id: 'projet-d-essai', query: requete },
    tool_use_id: 'toolu_essai',
  })

  it('laisse partir une lecture simple, sous les deux noms du serveur', () => {
    for (const outil of ['mcp__Supabase__execute_sql', 'mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__execute_sql']) {
      expect(deciderPourLAppel(appel(outil, 'select count(*) from pieces'))).toEqual({
        decision: 'allow',
        raison: 'Garde-fou : lecture simple (une seule instruction, qui lit).',
      })
    }
  })

  it('demande pour une écriture, et dit pourquoi', () => {
    expect(deciderPourLAppel(appel('mcp__Supabase__execute_sql', 'delete from pieces'))).toEqual({
      decision: 'ask',
      raison: 'Garde-fou : cette requête attend le bouton du cabinet — le mot « DELETE » paraît hors d’un littéral.',
    })
  })

  it('demande pour un outil qu’il ne sait pas juger, quelle que soit sa requête', () => {
    for (const outil of ['mcp__Supabase__apply_migration', 'mcp__Supabase__deploy_edge_function', 'execute_sql', 'Bash']) {
      expect(deciderPourLAppel(appel(outil, 'select 1')).decision).toBe('ask')
    }
  })

  it.each([null, undefined, 'texte', 42, {}, { tool_name: 'mcp__Supabase__execute_sql' }, { tool_name: 'mcp__Supabase__execute_sql', tool_input: {} }])(
    'demande pour un appel illisible : %j',
    (valeur) => {
      expect(deciderPourLAppel(valeur).decision).toBe('ask')
    },
  )

  it('refuse, au lieu de demander, dans le mode où rien ne garantit le bouton — sans gêner les lectures', () => {
    expect(deciderPourLAppel(appel('mcp__Supabase__execute_sql', 'delete from pieces', 'bypassPermissions')).decision).toBe('deny')
    expect(deciderPourLAppel(appel('mcp__Supabase__apply_migration', 'select 1', 'bypassPermissions')).decision).toBe('deny')
    expect(deciderPourLAppel(appel('mcp__Supabase__execute_sql', 'select 1', 'bypassPermissions')).decision).toBe('allow')
  })

  it('écrit le format que Claude Code attend', () => {
    expect(reponseDuHook({ decision: 'ask', raison: 'pourquoi' })).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'pourquoi' },
    })
  })

  it('ne lève jamais : une entrée qui n’est pas du JSON fait demander', () => {
    for (const entree of ['', 'pas du json', '{"tool_name":', '[]', 'null']) {
      expect(JSON.parse(repondreAuHook(entree)).hookSpecificOutput.permissionDecision).toBe('ask')
    }
  })

  // De bout en bout : le programme lancé comme Claude Code le lance, l'appel sur son entrée standard.
  const lancer = (entree: string) => {
    const sortie = execFileSync(process.execPath, [PROGRAMME], { input: entree, encoding: 'utf8' })
    // Un seul objet JSON, rien autour que des blancs — sinon Claude Code n'y lirait pas une décision.
    return JSON.parse(sortie).hookSpecificOutput
  }

  it('lancé en ligne de commande, sort en 0 avec sa décision', () => {
    expect(lancer(JSON.stringify(appel('mcp__Supabase__execute_sql', lire('supabase/essais/inventaire.sql'))))).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Garde-fou : lecture simple (une seule instruction, qui lit).',
    })
    expect(lancer(JSON.stringify(appel('mcp__Supabase__execute_sql', lire('supabase/essais/rls.sql')))).permissionDecision).toBe('ask')
    expect(lancer(JSON.stringify(appel('mcp__Supabase__execute_sql', 'select 1; drop table t')))).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: 'Garde-fou : cette requête attend le bouton du cabinet — la requête porte plusieurs instructions.',
    })
    expect(lancer('pas du json').permissionDecision).toBe('ask')
  })
})

describe('le mode d’emploi', () => {
  const blocs = [...lire('outils/gardefou/README.md').matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]))
  const aPoser = blocs.find((b) => b.hooks)

  it('donne un bloc de réglages qui se lit, et qui lance CE programme', () => {
    expect(aPoser).toBeDefined()
    const [garde] = aPoser.hooks.PreToolUse
    // Rien que des lettres, des chiffres, « _ », « - » et « | » : Claude Code y lit une liste de noms EXACTS.
    expect(garde.matcher).toMatch(/^[A-Za-z0-9_|-]+$/)
    expect(garde.matcher.split('|')).toContain('mcp__Supabase__execute_sql')
    for (const outil of garde.matcher.split('|')) expect(outil).toMatch(/__execute_sql$/)
    expect(garde.hooks).toEqual([
      {
        type: 'command',
        command: 'node',
        args: ['${CLAUDE_PROJECT_DIR}/outils/gardefou/lectureSeule.mjs'],
        // Un garde-fou qui ne démarre pas, ou qui répond mal, arrête l'appel au lieu de le laisser passer.
        onFailure: 'block',
        timeout: 20,
      },
    ])
  })

  it('fait attendre les migrations et les déploiements, et ne fait pas attendre execute_sql par une règle', () => {
    const demander: string[] = aPoser.permissions.ask
    expect(demander).toContain('mcp__Supabase__apply_migration')
    expect(demander).toContain('mcp__Supabase__deploy_edge_function')
    // Une règle « ask » l'emporte sur le « allow » d'un hook : elle ferait attendre aussi les lectures.
    expect(demander.filter((regle) => /execute_sql|^mcp__Supabase$|^mcp__Supabase__\*$/.test(regle))).toEqual([])
  })

  it('ne retire de la liste « allow » que des lignes qui y sont', () => {
    const aujourdHui: string[] = JSON.parse(lire('.claude/settings.json')).permissions.allow
    const retirees = blocs.find((b) => Array.isArray(b.retirer_de_allow))?.retirer_de_allow as string[]
    expect(retirees.length).toBeGreaterThan(0)
    // Une fois le garde-fou branché, ces lignes n'y sont plus : ce contrôle ne vaut que tant qu'il ne l'est pas.
    const branche = JSON.parse(lire('.claude/settings.json')).hooks !== undefined
    if (!branche) expect(retirees.filter((regle) => !aujourdHui.includes(regle))).toEqual([])
    expect(retirees).toEqual(expect.arrayContaining(['mcp__Supabase', 'mcp__Supabase__execute_sql', 'mcp__Supabase__apply_migration']))
  })
})
