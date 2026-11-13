import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { blocsDo, espaces, litterauxReunis, nomsDesListes, sansCommentaires } from '../test/blocsSql'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LA RESTRICTIVE DE LA DOUBLE AUTHENTIFICATION SUR TOUTE TABLE NEUVE (C7, second temps ; ligne 51.5), RÈGLE DES
// MIGRATIONS PRÉPARÉES.
//
// La migration `deux_facteurs_exiges` (préparée) pose une policy RESTRICTIVE `deux_facteurs` sur chaque table de public
// présente quand elle s'applique (sa boucle part de pg_class), et le bloc DF de supabase/essais/rls.sql met en faute toute
// table de public qui ne la porte pas. Une table qu'une autre migration crée APRÈS elle doit donc la poser elle-même. La
// règle : toute migration préparée qui crée une table de public y pose la restrictive, à l'expression exacte, dans un bloc
// `do` sous la condition que `deux_facteurs_satisfaits()` soit en base — appliquée avant `deux_facteurs_exiges`, le bloc ne
// fait rien et la boucle de celle-ci la pose ; après, le bloc la pose : les deux se collent dans les deux ordres. La table
// active aussi sa RLS (sans elle, la restrictive ne garde rien). Le jour où `deux_facteurs_exiges` est dans l'export, une
// migration exportée APRÈS elle qui crée une table de public la pose aussi, sous condition ou non. La base se juge par le
// bloc DF de rls.sql, sur une réplique.
//
// Le relevé part de TOUT : chaque occurrence du mot (`create … table`) de l'export, des préparées et de leurs retours, hors
// commentaires ; une forme qu'il ne reconnaît pas (`create table … as`, `partition of`, `unlogged`, une table d'un autre
// schéma, un nom composé dans une chaîne) est une faute — la règle s'écrira le jour où elle apparaîtra. Une seule
// exception, avec sa raison et son nombre : `deux_facteurs_exiges` elle-même. Une table sans policy d'accès n'en est pas
// une : DF1 et la garde de fin de la migration veulent la restrictive sur CHAQUE table de public (`exigences_deux_facteurs`
// n'a aucune policy permissive, et la porte). Les planchers, relevés le 13/11/2026 : il lit dans l'export au moins 106
// créations de table, toutes reconnues, et dans au moins 77 retours, aucune ; il trouve dans l'export et les préparées
// réunis au moins 31 tables couvertes sous condition, dans 21 fichiers — chacune remise en faute quand son bloc est retiré.

type Fichier = { chemin: string; texte: string }
type Regle = 'preparee' | 'exportee'

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Le corps d'un bloc tel que le relevé le compare : les littéraux réunis, les blancs ramenés, en minuscules. */
const normaliser = (corps: string) => espaces(litterauxReunis(corps)).toLowerCase()

const CONDITION = "if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then"
const EXPRESSION = 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))'
/** La pose dans un bloc normalisé : sur `public.%I` (les tables des listes du bloc) ou sur une table nommée. Le bloc est
 * déjà en minuscules ; le drapeau « i » le redit (motifsSqlSensiblesALaCasse.test.ts). */
const POSE = new RegExp(String.raw`create policy deux_facteurs on public\.(%i|[a-z_][a-z0-9_]*) as restrictive for all to authenticated ${echapper(EXPRESSION)}`, 'gi')
/** La pose en instruction, hors de tout bloc : sans condition. */
const POSE_DIRECTE = new RegExp(
  String.raw`\bcreate\s+policy\s+deux_facteurs\s+on\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+as\s+restrictive\s+for\s+all\s+to\s+authenticated\s+`
    + echapper(EXPRESSION).replace(/ /g, '\\s+'), 'gi')
/** La boucle de `deux_facteurs_exiges` : chaque table de public, la restrictive à l'expression exacte. */
const BALAYAGE = [
  "for t in select c.oid::regclass from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')",
  `'create policy deux_facteurs on %s as restrictive for all to authenticated ${EXPRESSION}', t)`,
]

/** L'exception, avec sa raison et son nombre de tables : la migration qui crée la restrictive. */
export const EXCEPTIONS: readonly { motif: RegExp; tables: number; raison: string }[] = [{
  motif: /\d{14}_deux_facteurs_exiges\.sql$/,
  tables: 2,
  raison: 'elle crée la restrictive : sa boucle `$policies$` la pose sur chaque table de public présente, ses deux tables (créées avant elle) '
    + 'comprises, et sa garde de fin le vérifie',
}]

// La source : le mot. `create` suivi d'au plus trois mots puis de `table` — `temp`, `unlogged`, `foreign`, `global
// temporary`… —, jamais `returns table` (le nom d'une fonction porte ses parenthèses).
const MOT = /\bcreate\s+(?:\w+\s+){0,3}?table\b/gi
const DE_PUBLIC = /^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*\(/i
const DE_SESSION = /^create\s+(?:(?:global|local)\s+)?(?:temp|temporary)\s+table\b/i

/** Les tables de public qu'un texte (sans commentaires) crée, et les créations de forme non reconnue. */
export function tablesCreees(texte: string): { tables: { nom: string; debut: number }[]; inconnues: string[] } {
  const tables: { nom: string; debut: number }[] = []
  const inconnues: string[] = []
  for (const m of texte.matchAll(MOT)) {
    const suite = texte.slice(m.index)
    const publique = DE_PUBLIC.exec(suite)
    if (publique) tables.push({ nom: publique[1].toLowerCase(), debut: m.index })
    else if (!DE_SESSION.test(suite)) inconnues.push(espaces(suite.slice(0, 80)))
  }
  return { tables, inconnues }
}

/** La fin de la branche ouverte par le `if` en `debut` (un texte normalisé) : son `end if`, les `if` imbriqués comptés. */
function finDeLaBranche(bloc: string, debut: number): number {
  let profondeur = 0
  for (const m of bloc.slice(debut).matchAll(/\bend if\b|\bif\b/g)) {
    profondeur += m[0] === 'if' ? 1 : -1
    if (profondeur === 0) return debut + m.index
  }
  return bloc.length
}

/** Les tables qu'un texte couvre de la restrictive sous condition, et où commence chaque bloc qui la pose. */
export function restrictivesSousCondition(texte: string): Map<string, number[]> {
  const couvertes = new Map<string, number[]>()
  for (const { debut, corps } of blocsDo(texte)) {
    const bloc = normaliser(corps)
    const condition = bloc.indexOf(CONDITION)
    if (condition < 0) continue
    const fin = finDeLaBranche(bloc, condition)
    for (const p of bloc.matchAll(POSE)) {
      if (p.index < condition || p.index > fin) continue
      for (const nom of p[1] === '%i' ? nomsDesListes(bloc) : [p[1]]) couvertes.set(nom, [...(couvertes.get(nom) ?? []), debut])
    }
  }
  return couvertes
}

/** Les tables qu'un texte couvre de la restrictive en instruction, hors de tout bloc (sans condition), et où. */
export function restrictivesDirectes(texte: string): Map<string, number[]> {
  let hors = texte
  for (const b of blocsDo(texte)) hors = hors.slice(0, b.debut) + ' '.repeat(b.fin - b.debut) + hors.slice(b.fin)
  const directes = new Map<string, number[]>()
  for (const m of hors.matchAll(POSE_DIRECTE)) {
    const nom = m[1].toLowerCase()
    directes.set(nom, [...(directes.get(nom) ?? []), m.index])
  }
  return directes
}

const rlsActivee = (texte: string, table: string) =>
  new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"?public"?\s*\.\s*)?"?${table}"?\s+enable\s+row\s+level\s+security\b`, 'i').test(texte)

/**
 * Les fautes d'un fichier qui crée des tables de public, sous sa règle : une préparée pose la restrictive sous condition
 * seulement ; une migration exportée après `deux_facteurs_exiges`, sous condition ou non.
 */
export function fautesDUnFichier(f: Fichier, regle: Regle): string[] {
  const texte = sansCommentaires(f.texte)
  const { tables, inconnues } = tablesCreees(texte)
  const fautes = inconnues.map((i) => `${f.chemin} : une création de table de forme non reconnue (« ${i} ») : la règle ne la juge pas`)
  const exception = EXCEPTIONS.find((e) => e.motif.test(f.chemin))
  if (exception) {
    if (tables.length !== exception.tables) fautes.push(`${f.chemin} : l'exception compte ${exception.tables} table(s), le fichier en crée ${tables.length}`)
    const derniere = Math.max(-1, ...tables.map((t) => t.debut))
    if (!blocsDo(texte).some((b) => b.debut > derniere && BALAYAGE.every((s) => normaliser(b.corps).includes(s)))) {
      fautes.push(`${f.chemin} : l'exception ne tient plus — aucune boucle ne pose la restrictive sur chaque table de public après ses tables`)
    }
    return fautes
  }
  const sousCondition = restrictivesSousCondition(texte)
  const directes = restrictivesDirectes(texte)
  for (const { nom, debut } of tables) {
    if (!rlsActivee(texte, nom)) fautes.push(`${f.chemin} : ${nom} n'active pas sa RLS : la restrictive n'y garderait rien`)
    const poses = [...(sousCondition.get(nom) ?? []), ...(regle === 'exportee' ? directes.get(nom) ?? [] : [])]
    if (poses.length === 0) fautes.push(`${f.chemin} : ${nom}, table neuve, sans la policy restrictive deux_facteurs posée sous condition`)
    else if (!poses.some((p) => p > debut)) fautes.push(`${f.chemin} : ${nom} : la restrictive se pose avant que la table soit créée`)
  }
  if (regle === 'preparee') {
    for (const nom of directes.keys()) {
      fautes.push(`${f.chemin} : la restrictive deux_facteurs de ${nom} posée sans condition : la migration ne s'appliquerait pas avant deux_facteurs_exiges`)
    }
  }
  return fautes
}

const versionDe = (chemin: string) => /(?:^|\/)(\d{14})_[^/]*\.sql$/.exec(chemin)?.[1] ?? ''

/**
 * Les fautes de la règle sur tous les fichiers : chaque préparée (hors de ses retours), et, une fois `deux_facteurs_exiges`
 * dans l'export, chaque migration exportée après elle.
 */
export function fautesDeLaRestrictive(fichiers: Fichier[]): string[] {
  const deuxFacteurs = fichiers.find((f) => /\d{14}_deux_facteurs_exiges\.sql$/.test(f.chemin))
  if (!deuxFacteurs) return ['la migration deux_facteurs_exiges est introuvable, préparée ou exportée : la règle ne se juge pas']
  const v = deuxFacteurs.chemin.startsWith('supabase/schema/') ? versionDe(deuxFacteurs.chemin) : null
  return fichiers.flatMap((f) => {
    if (/^supabase\/preparees\/[^/]+\.sql$/.test(f.chemin)) return fautesDUnFichier(f, 'preparee')
    if (v !== null && /^supabase\/schema\/\d{14}_[^/]+\.sql$/.test(f.chemin) && versionDe(f.chemin) > v) return fautesDUnFichier(f, 'exportee')
    return []
  })
}

const SCHEMA = fichiersDuSchema()
const PREPAREES = fichiersPrepares()
const TOUS = [...SCHEMA, ...PREPAREES]
const RACINE_DES_RETOURS = new URL('../../supabase/preparees/retour/', import.meta.url).pathname
const RETOURS: Fichier[] = readdirSync(RACINE_DES_RETOURS).filter((n) => n.endsWith('.sql')).sort()
  .map((n) => ({ chemin: `supabase/preparees/retour/${n}`, texte: readFileSync(RACINE_DES_RETOURS + n, 'utf8') }))

/** Un texte privé de ses blocs qui posent la restrictive sous condition : la mutation d'un fichier réel. */
const sansSesBlocs = (texte: string) =>
  blocsDo(texte).reverse().reduce((t, b) => (normaliser(b.corps).includes(CONDITION) ? t.slice(0, b.debut) + t.slice(b.fin) : t), texte)

describe('la restrictive deux_facteurs sur toute table neuve — la règle des migrations préparées (C7)', () => {
  it('la migration deux_facteurs_exiges se trouve, préparée ou exportée, et son exception tient : deux tables, sa boucle après elles', () => {
    const deuxFacteurs = TOUS.filter((f) => EXCEPTIONS[0].motif.test(f.chemin))
    expect(deuxFacteurs).toHaveLength(1)
    expect(fautesDUnFichier(deuxFacteurs[0], 'preparee')).toEqual([])
    expect(tablesCreees(sansCommentaires(deuxFacteurs[0].texte)).tables.map((t) => t.nom)).toEqual(['exigences_deux_facteurs', 'retraits_deux_facteurs'])
  })

  it('le plancher : dans l’export, le relevé lit au moins 106 créations de table de public (le 13/11/2026), et les reconnaît toutes', () => {
    const lues = SCHEMA.map((f) => tablesCreees(sansCommentaires(f.texte)))
    expect(lues.flatMap((l) => l.inconnues)).toEqual([])
    expect(lues.reduce((n, l) => n + l.tables.length, 0)).toBeGreaterThanOrEqual(106)
  })

  it('aucune migration préparée — ni exportée après deux_facteurs_exiges — ne crée une table de public sans la restrictive sous condition', () => {
    expect(fautesDeLaRestrictive(TOUS)).toEqual([])
  })

  it('aucun retour ne crée de table : le jour où l’un en recrée une, elle porte la restrictive comme toute table neuve', () => {
    expect(RETOURS.length).toBeGreaterThanOrEqual(77)
    expect(RETOURS.flatMap((f) => {
      const { tables, inconnues } = tablesCreees(sansCommentaires(f.texte))
      return [...tables.map((t) => `${f.chemin} : ${t.nom}`), ...inconnues.map((i) => `${f.chemin} : ${i}`)]
    })).toEqual([])
  })

  it('le plancher, par mutation des fichiers réels : chacune des tables couvertes sous condition (au moins 31, dans 21 fichiers) tombe en faute sans son bloc', () => {
    let eprouvees = 0
    let fichiers = 0
    for (const f of TOUS) {
      const texte = sansCommentaires(f.texte)
      const couvertes = [...restrictivesSousCondition(texte).keys()]
      if (couvertes.length === 0) continue
      expect(fautesDUnFichier(f, 'preparee'), f.chemin).toEqual([])
      const fautes = fautesDUnFichier({ chemin: f.chemin, texte: sansSesBlocs(texte) }, 'preparee')
      for (const t of couvertes) expect(fautes, f.chemin).toContain(`${f.chemin} : ${t}, table neuve, sans la policy restrictive deux_facteurs posée sous condition`)
      eprouvees += couvertes.length
      fichiers += 1
    }
    // Le 13/11/2026 : onze migrations exportées (préparées, puis appliquées) et dix préparées, INAL5 comprise.
    expect(eprouvees).toBeGreaterThanOrEqual(31)
    expect(fichiers).toBeGreaterThanOrEqual(21)
  })

  describe('le relevé, éprouvé par des défauts plantés', () => {
    const TABLE = `create table public.neuve (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null
);
alter table public.neuve enable row level security;
create policy neuve_select on public.neuve for select to authenticated using (public.admin_du_dossier(dossier_id));
`
    const BOUCLE = (tables: string, condition = CONDITION) => `do $deux_facteurs$
declare
  v_table text;
begin
  ${condition}
    foreach v_table in array array[${tables}] loop
      execute format('create policy deux_facteurs on public.%I as restrictive for all to authenticated '
                     'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))', v_table);
    end loop;
  end if;
end
$deux_facteurs$;`
    const DIRECT = (table: string, joint: string) => `do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.${table} as restrictive for all to authenticated '
      ${joint}'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;`
    const SANS_CONDITION = `create policy deux_facteurs on public.neuve as restrictive for all to authenticated
  using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()));`
    const DEUX_FACTEURS = (dossier: string, nom = '20261107160000_deux_facteurs_exiges.sql', boucle = true) => ({
      chemin: `${dossier}/${nom}`,
      texte: `create table public.exigences_deux_facteurs (id uuid);
alter table public.exigences_deux_facteurs enable row level security;
create table public.retraits_deux_facteurs (id uuid);
alter table public.retraits_deux_facteurs enable row level security;
${boucle ? `do $policies$
declare
  t regclass;
begin
  for t in select c.oid::regclass
             from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
            order by c.relname collate "C" loop
    execute format(
      'create policy deux_facteurs on %s as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))', t);
  end loop;
end
$policies$;` : ''}`,
    })
    const juger = (texte: string, chemin = 'supabase/preparees/20261201000000_x.sql', deuxFacteurs = DEUX_FACTEURS('supabase/preparees')) =>
      fautesDeLaRestrictive([deuxFacteurs, { chemin, texte }])
    const FAUTE = 'supabase/preparees/20261201000000_x.sql : neuve, table neuve, sans la policy restrictive deux_facteurs posée sous condition'

    it('la table et la restrictive sous condition, sous ses trois écritures : aucune faute (le contrôle positif)', () => {
      expect(juger(TABLE + BOUCLE("'neuve'"))).toEqual([])
      expect(juger(TABLE + DIRECT('neuve', ''))).toEqual([])
      expect(juger(TABLE + DIRECT('neuve', '|| '))).toEqual([])
      expect(juger(TABLE.replace('create table public.neuve', 'CREATE TABLE IF NOT EXISTS neuve') + BOUCLE("'autre', 'neuve'"))).toEqual([])
    })
    it('la table sans la restrictive : une faute', () => {
      expect(juger(TABLE)).toEqual([FAUTE])
    })
    it('la restrictive posée sur une autre table seulement : une faute', () => {
      expect(juger(TABLE + BOUCLE("'autre'"))).toEqual([FAUTE])
    })
    it('le bloc sans la condition, ou la pose hors de sa branche : une faute', () => {
      expect(juger(TABLE + BOUCLE("'neuve'", 'if true then'))).toEqual([FAUTE])
      const horsDeLaBranche = `do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    if true then
      null;
    end if;
  end if;
  execute 'create policy deux_facteurs on public.neuve as restrictive for all to authenticated '
          'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
end
$deux_facteurs$;`
      expect(juger(TABLE + horsDeLaBranche)).toEqual([FAUTE])
      // Le contrôle positif de la même forme : la pose dans la branche, après un `if` imbriqué refermé.
      expect(juger(TABLE + horsDeLaBranche.replace("  end if;\n  execute", '  execute').replace("'))';\nend", "'))';\n  end if;\nend"))).toEqual([])
    })
    it('une autre expression que celle de la migration (`using (true)`) : une faute', () => {
      expect(juger(TABLE + BOUCLE("'neuve'").replace('using ((select public.deux_facteurs_satisfaits()))', 'using (true)'))).toEqual([FAUTE])
    })
    it('le bloc avant la création de la table : une faute', () => {
      expect(juger(BOUCLE("'neuve'") + '\n' + TABLE)).toEqual(['supabase/preparees/20261201000000_x.sql : neuve : la restrictive se pose avant que la table soit créée'])
    })
    it('la restrictive posée sans condition dans une préparée : une faute, même la table couverte', () => {
      expect(juger(TABLE + SANS_CONDITION)).toEqual([FAUTE,
        'supabase/preparees/20261201000000_x.sql : la restrictive deux_facteurs de neuve posée sans condition : la migration ne s\'appliquerait pas avant deux_facteurs_exiges'])
      expect(juger(TABLE + BOUCLE("'neuve'") + SANS_CONDITION)).toHaveLength(1)
    })
    it('la RLS non activée : une faute', () => {
      expect(juger(TABLE.replace('alter table public.neuve enable row level security;', '') + BOUCLE("'neuve'")))
        .toEqual(['supabase/preparees/20261201000000_x.sql : neuve n\'active pas sa RLS : la restrictive n\'y garderait rien'])
    })
    it('une forme de création non reconnue : une faute, qui la cite', () => {
      for (const forme of ['create unlogged table public.neuve (id uuid);', 'create table public.neuve as select 1;',
        'create table public.neuve partition of public.mere for values in (1);', 'create table storage.neuve (id uuid);',
        "execute format('create table public.%I (id uuid)', v);", 'create foreign table public.neuve (id uuid) server s;']) {
        const fautes = juger(forme)
        expect(fautes, forme).toHaveLength(1)
        expect(fautes[0], forme).toMatch(/une création de table de forme non reconnue \(« create /i)
      }
    })
    it('ce qui n’est pas une table neuve de public n’est pas une faute : une table de session, une citation en commentaire, une fonction qui rend une table', () => {
      expect(juger('create temp table essai (id int) on commit drop;\ncreate local temporary table e2 (id int);')).toEqual([])
      expect(juger('-- create table public.neuve (id uuid);\nselect 1;')).toEqual([])
      expect(juger('create function public.f(p uuid) returns table (id uuid) language sql as $$ select p $$;')).toEqual([])
    })
    it('l’exception : deux_facteurs_exiges sans sa boucle, ou avec une table de plus, est en faute', () => {
      expect(fautesDeLaRestrictive([DEUX_FACTEURS('supabase/preparees')])).toEqual([])
      expect(fautesDeLaRestrictive([DEUX_FACTEURS('supabase/preparees', undefined, false)])).toHaveLength(1)
      const unePlus = DEUX_FACTEURS('supabase/preparees')
      expect(fautesDeLaRestrictive([{ ...unePlus, texte: TABLE + unePlus.texte }])[0]).toMatch(/l'exception compte 2 table\(s\), le fichier en crée 3/)
    })
    it('deux_facteurs_exiges exportée : une migration exportée après elle est jugée (sous condition ou non), une d’avant ne l’est pas', () => {
      const exportee = DEUX_FACTEURS('supabase/schema', '20270115120000_deux_facteurs_exiges.sql')
      const apres = 'supabase/schema/20270201120000_x.sql'
      expect(juger(TABLE, apres, exportee)).toEqual([`${apres} : neuve, table neuve, sans la policy restrictive deux_facteurs posée sous condition`])
      expect(juger(TABLE + SANS_CONDITION, apres, exportee)).toEqual([])
      expect(juger(TABLE + BOUCLE("'neuve'"), apres, exportee)).toEqual([])
      expect(juger(TABLE, 'supabase/schema/20261201000000_x.sql', exportee)).toEqual([])
      expect(juger(TABLE, 'supabase/schema/socle/x.sql', exportee)).toEqual([])
      // Préparée, elle reste jugée comme une préparée.
      expect(juger(TABLE, 'supabase/preparees/20270301120000_x.sql', exportee)).toHaveLength(1)
    })
    it('sans la migration deux_facteurs_exiges, la règle ne se juge pas : une faute', () => {
      expect(fautesDeLaRestrictive([{ chemin: 'supabase/preparees/20261201000000_x.sql', texte: TABLE + BOUCLE("'neuve'") }]))
        .toEqual(['la migration deux_facteurs_exiges est introuvable, préparée ou exportée : la règle ne se juge pas'])
    })
  })
})
