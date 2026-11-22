import { describe, expect, it } from 'vitest'
import { espaces, litterauxReunis, nomsDesListes } from '../test/blocsSql'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LES OBJETS CRÉÉS DANS UN BLOC `do`, QUE L'INVENTAIRE DE L'EXPORT NE VOIT PAS (22/11/2026, la relecture d'EL8).
//
// supabase/essais/inventaire.py, le troisième contrôle de l'export (supabase/schema/README.md), tire des FICHIERS les objets
// que chaque instruction crée ou retire, et les compare à ceux de la base. Le corps d'un bloc `do $…$ … $…$` est une seule
// instruction, qu'il ne lit pas : un déclencheur, une policy, un index ou une contrainte qu'une migration pose dans un bloc
// (par un `execute`, ou par une instruction du bloc) existe en base sans exister dans l'export, et le contrôle diverge après
// le collage. Relevé le 22/11/2026 sur une réplique égale à la production (249), chaque préparée appliquée puis les deux
// moitiés de l'inventaire comparées : la porte d'accès (`_acces_avant_les_gardes`), posée « si sa fonction est en base »
// alors qu'elle y est depuis le 15/11/2026, échappait à l'inventaire dans sept préparées — onze déclencheurs (INAL5 trois,
// INV2, LIA2, EXD2, INV4, AFF2 deux, INV3, et EL2 avant EL8). Elles la posent désormais en clair (HISTORIQUE.md, « LES
// PORTES POSÉES EN CLAIR DANS LES PRÉPARÉES »).
//
// LA RÈGLE, sur l'export et les préparées (hors de leurs retours) : aucun objet ne se crée dans un bloc `do` — create
// [constraint] trigger, create policy, create [unique] index, add constraint ; et create table, add column, create
// function, create view, la RLS activée, que le relevé ne sait même pas lire dans un bloc —, sauf les cas NOMMÉS ci-dessous,
// chacun sa raison et son nombre. Un mot de création dans le corps d'une fonction (que la migration n'exécute pas, mais qu'un
// appel exécuterait hors de l'inventaire) est une forme non reconnue : une faute. Ce qui n'est pas une création : le rendu
// du catalogue comparé dans une garde (`CREATE TRIGGER …` en capitales, dans un bloc qui lit `pg_get_triggerdef`,
// `pg_get_indexdef` ou `pg_get_constraintdef`), compté à part.
//
// Il part de TOUT : chaque instruction de chaque fichier, découpée hors des littéraux, des identifiants et des corps ; un bloc
// `do` d'une autre forme que `do $balise$ … $balise$` est une faute ; une table qu'il ne sait pas nommer (`%s`, `%I` sans
// liste) aussi. Les planchers : le nombre de fichiers, de blocs, de créations de chaque cas nommé, relevés le 22/11/2026.

type Fichier = { chemin: string; texte: string }
type Morceau = { genre: 'code' | 'litteral' | 'corps'; texte: string }

/**
 * Le texte en morceaux : du code (les identifiants entre guillemets compris), un littéral `'…'` (son contenu, `''` gardé), un
 * corps `$balise$ … $balise$` (son contenu). Les commentaires (`--` jusqu'à la fin de la ligne, `/* … *\/`) se retirent hors
 * des littéraux et des corps — un corps se relit à part, ses commentaires avec lui.
 */
export function morceaux(sql: string): Morceau[] {
  const res: Morceau[] = []
  let code = ''
  const pousser = () => {
    if (code) res.push({ genre: 'code', texte: code })
    code = ''
  }
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') {
      const fin = sql.indexOf('\n', i)
      i = fin < 0 ? sql.length : fin
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      const fin = sql.indexOf('*/', i + 2)
      if (fin < 0) throw new Error('commentaire /* jamais refermé')
      code += ' '
      i = fin + 2
      continue
    }
    if (c === '"') {
      const fin = sql.indexOf('"', i + 1)
      if (fin < 0) throw new Error('identifiant " jamais refermé')
      code += sql.slice(i, fin + 1)
      i = fin + 1
      continue
    }
    if (c === "'") {
      // Une chaîne E'…' (E seul devant la quote) lit ses barres obliques inverses.
      const echappee = /(^|[^\w])[eE]$/.test(code)
      let j = i + 1
      for (;;) {
        if (j >= sql.length) throw new Error('littéral jamais refermé')
        if (echappee && sql[j] === '\\') { j += 2; continue }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue }
          break
        }
        j++
      }
      pousser()
      res.push({ genre: 'litteral', texte: sql.slice(i + 1, j) })
      i = j + 1
      continue
    }
    if (c === '$') {
      const balise = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i))
      if (balise) {
        const fin = sql.indexOf(balise[0], i + balise[0].length)
        if (fin < 0) throw new Error(`corps ${balise[0]} jamais refermé`)
        pousser()
        res.push({ genre: 'corps', texte: sql.slice(i + balise[0].length, fin) })
        i = fin + balise[0].length
        continue
      }
    }
    code += c
    i++
  }
  pousser()
  return res
}

/** Les instructions de premier niveau : leurs morceaux, découpés sur les `;` du code. */
export function instructions(sql: string): Morceau[][] {
  const res: Morceau[][] = []
  let courante: Morceau[] = []
  for (const m of morceaux(sql)) {
    if (m.genre !== 'code') { courante.push(m); continue }
    const parts = m.texte.split(';')
    parts.forEach((p, k) => {
      if (p) courante.push({ genre: 'code', texte: p })
      if (k < parts.length - 1) { res.push(courante); courante = [] }
    })
  }
  res.push(courante)
  return res.filter((ins) => ins.some((m) => m.genre !== 'code' || m.texte.trim() !== ''))
}

/** Un texte relu sans commentaires, ses littéraux remis entre quotes : ce qu'un bloc exécute, tel que les motifs le lisent. */
const recompose = (ms: Morceau[]) => ms.map((m) => (m.genre === 'code' ? m.texte : m.genre === 'litteral' ? `'${m.texte}'` : `$x$${m.texte}$x$`)).join('')

/** Les mots de création : tous ceux que le relevé juge, ceux qu'il sait lire et les autres. */
const MOT = /\b(create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger|create\s+policy|create\s+(?:unique\s+)?index|add\s+constraint|create\s+(?:or\s+replace\s+)?function|create\s+(?:or\s+replace\s+)?view|create\s+(?:\w+\s+){0,2}?table|add\s+column|enable\s+row\s+level\s+security)\b/gi
const CIBLE = String.raw`(?:only\s+)?(?:"?(\w+)"?\.)?"?([\w%]+)"?`
const LECTURES = [
  { genre: 'declencheur', motif: new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+"?(\w+)"?\s+(?:before|after|instead\s+of)\s[^;']*?\bon\s+${CIBLE}`, 'i') },
  { genre: 'policy', motif: new RegExp(String.raw`^create\s+policy\s+"?(\w+)"?\s+on\s+${CIBLE}`, 'i') },
  { genre: 'index', motif: new RegExp(String.raw`^create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+on\s+${CIBLE}`, 'i') },
] as const
/** La table d'une contrainte : l'`alter table` qui la précède dans le même littéral ou la même instruction du bloc. */
const ALTER = new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?${CIBLE}\s[^;']*$`, 'i')

const CONDITION_DF = "if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then"
const EXPRESSION_DF = 'as restrictive for all to authenticated using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))'
const BALAYAGE_DF = "for t in select c.oid::regclass from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')"
const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** La pose de la boucle de `deux_facteurs_exiges` : sur `%s`, à l'expression exacte (les blancs ramenés, toute casse). */
const BOUCLE_DF = new RegExp(String.raw`^create\s+policy\s+deux_facteurs\s+on\s+%s\s+` + echapper(EXPRESSION_DF).replace(/ /g, String.raw`\s+`), 'i')
const CONDITION_PAIRE = /if exists \(select 1 from pg_attribute a where a\.attrelid = 'public\.ecritures_brouillon'::regclass and a\.attname = '(\w+)' and not a\.attisdropped\) then/g
const GARDE_DES_PREPAREES = "where t.tgrelid = to_regclass('public.' || v_table) and not t.tgisinternal and t.tgtype & 3 = 3 and t.tgtype & 20 <> 0 and p.prosecdef) then"
const RENDU_DU_CATALOGUE = /\bpg_get_(?:trigger|index|constraint)def\s*\(/i

/** Les douze tables du socle (supabase/schema/socle/1_tables_sans_migration.sql) : socle.sql rend leurs contraintes, index
 *  et policies du catalogue — jamais leurs déclencheurs —, et le socle se régénère après toute migration qui les touche. */
const TABLES_DU_SOCLE = ['cotisations_declarees', 'documents_divers', 'ecritures_brouillon', 'immobilisations', 'informations_dossier',
  'lignes_bancaires', 'natures_immobilisation', 'references_annuelles', 'references_postes_annuels', 'regles_bancaires_ignorees',
  'sous_dossiers', 'tiers_categories']

/** Les cas nommés : des créations dans un bloc que la règle admet, chacune sa raison ; leur nombre est épinglé plus bas. */
export const CAS_NOMMES = {
  restrictive: 'la restrictive `deux_facteurs` sous la condition que `deux_facteurs_satisfaits()` soit en base, sur une table que le fichier '
    + 'crée : `deux_facteurs_exiges` est préparée (deuxFacteursDesTablesNeuves.test.ts exige la pose sous condition) ; rien ne se crée avant '
    + 'elle, et l’inventaire ne la compte pas plus que la boucle de celle-ci (le cas « balayage »)',
  paire: 'la contrainte d’une paire de sources neuves du brouillon (`ecritures_brouillon`, une table du socle), posée par la seconde de la '
    + 'paire à se coller : socle.sql rend les contraintes du brouillon du catalogue, et le socle se régénère au collage — l’inventaire les compte',
  balayage: 'la boucle `$policies$` de `deux_facteurs_exiges`, la restrictive sur chaque table de public présente : l’inventaire NE LES COMPTE '
    + 'PAS (mesuré le 22/11/2026 : 107 policies sur la production, 125 avec les préparées ; les douze du socle rendues sans `as restrictive`) — '
    + 'à décider avant son collage',
  porteDesPreparees: 'le bloc `$preparees$` de la porte (en production depuis le 15/11/2026) : la porte sur la table d’une préparée qui portait '
    + 'déjà sa garde ; aucune ne l’était, rien ne s’est créé, et toute préparée exige désormais la porte en tête',
} as const
type CasNomme = keyof typeof CAS_NOMMES

export type Releve = {
  fautes: string[]
  blocs: number
  cas: Record<CasNomme, number>
  verifications: number
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
const dansLaBranche = (bloc: string, condition: number, position: number) =>
  condition >= 0 && position > condition && position < finDeLaBranche(bloc, condition)

/** Les tables de public qu'un fichier crée, en instruction de premier niveau. */
function tablesCreees(ins: Morceau[][]): Set<string> {
  const tables = new Set<string>()
  for (const i of ins) {
    const tete = espaces(i.filter((m) => m.genre === 'code').map((m) => m.texte).join(' ')).toLowerCase()
    const t = /^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(\w+)"?/i.exec(tete)
    if (t) tables.add(t[1])
  }
  return tables
}

/** Le relevé d'un fichier : ses fautes, ses blocs, ses cas nommés et ses vérifications du catalogue. */
export function releveDUnFichier(f: Fichier): Releve {
  const r: Releve = { fautes: [], blocs: 0, cas: { restrictive: 0, paire: 0, balayage: 0, porteDesPreparees: 0 }, verifications: 0 }
  const ins = instructions(f.texte)
  const creees = tablesCreees(ins)
  for (const i of ins) {
    const code = i.filter((m) => m.genre === 'code').map((m) => m.texte).join(' ')
    const corps = i.filter((m) => m.genre === 'corps')
    if (/^\s*do\b/i.test(code)) {
      // `do $balise$ … $balise$`, rien d'autre : ni `language`, ni un second corps.
      if (!(corps.length === 1 && i.length === 2 && i[0].genre === 'code' && /^\s*do\s*$/i.test(i[0].texte))) {
        r.fautes.push(`${f.chemin} : un bloc do de forme non reconnue (« ${espaces(recompose(i)).slice(0, 60)} ») : le relevé ne le lit pas`)
        continue
      }
      r.blocs++
      releveDUnBloc(f, corps[0].texte, creees, r)
      continue
    }
    // Hors d'un bloc : un mot de création dans le corps d'une fonction s'exécuterait à son appel, hors de l'inventaire.
    for (const c of corps) {
      for (const m of recompose(morceaux(c.texte)).matchAll(MOT)) {
        r.fautes.push(`${f.chemin} : « ${espaces(m[0]).toLowerCase()} » dans le corps d'une fonction : une forme non reconnue (son appel créerait hors de l'inventaire)`)
      }
    }
  }
  return r
}

function releveDUnBloc(f: Fichier, corpsDuBloc: string, creees: Set<string>, r: Releve): void {
  // Le bloc relu sans ses commentaires, ses littéraux consécutifs réunis (`'a' || 'b'`, `'a'` puis `'b'` à la ligne).
  const bloc = espaces(litterauxReunis(recompose(morceaux(corpsDuBloc))))
  const minuscule = bloc.toLowerCase()
  const listes = nomsDesListes(bloc).map((n) => n.toLowerCase())
  const conditionDF = minuscule.indexOf(CONDITION_DF)
  const conditionsPaire = [...minuscule.matchAll(CONDITION_PAIRE)].map((m) => ({ debut: m.index, colonne: m[1] }))
  for (const m of bloc.matchAll(MOT)) {
    const suite = bloc.slice(m.index)
    // Le rendu du catalogue, comparé : en capitales, dans un bloc qui lit la définition du catalogue.
    if (m[0] === m[0].toUpperCase() && /^CREATE /.test(m[0]) && RENDU_DU_CATALOGUE.test(bloc)) {
      r.verifications++
      continue
    }
    let genre: string | undefined
    let nom = ''
    let schema: string | undefined
    let table = ''
    for (const l of LECTURES) {
      const x = l.motif.exec(suite)
      if (x) {
        genre = l.genre
        ;[, nom, schema, table] = x
        break
      }
    }
    if (!genre && /^add\s+constraint/i.test(m[0])) {
      const avant = bloc.slice(Math.max(bloc.lastIndexOf("'", m.index - 1), bloc.lastIndexOf(';', m.index - 1)) + 1, m.index)
      const alter = ALTER.exec(avant)
      const n = /^add\s+constraint\s+"?(\w+)"?/i.exec(suite)
      if (alter && n) {
        genre = 'contrainte'
        nom = n[1]
        ;[, schema, table] = alter
      }
    }
    if (!genre) {
      r.fautes.push(`${f.chemin} : « ${espaces(m[0]).toLowerCase()} » dans un bloc do : une forme que le relevé ne lit pas (« ${suite.slice(0, 70)} »)`)
      continue
    }
    nom = nom.toLowerCase()
    table = table.toLowerCase()
    const position = m.index
    // Les cas nommés.
    if (genre === 'policy' && nom === 'deux_facteurs' && table === '%s' && minuscule.includes(BALAYAGE_DF)
      && BOUCLE_DF.test(bloc.slice(position))) {
      r.cas.balayage++
      continue
    }
    const cibles = table === '%i' ? listes : [table]
    if (table === '%s' || cibles.length === 0 || (schema !== undefined && schema.toLowerCase() !== 'public')) {
      r.fautes.push(`${f.chemin} : ${genre} ${nom} sur une table que le relevé ne sait pas nommer (« ${schema ? schema + '.' : ''}${table} ») dans un bloc do`)
      continue
    }
    for (const t of cibles) {
      if (genre === 'policy' && nom === 'deux_facteurs' && creees.has(t) && dansLaBranche(minuscule, conditionDF, position)
        && minuscule.slice(position).includes(EXPRESSION_DF)) {
        r.cas.restrictive++
        continue
      }
      if (genre === 'contrainte' && t === 'ecritures_brouillon' && /^ecritures_brouillon_\w+_hors_\w+$/.test(nom)
        && conditionsPaire.some((c) => dansLaBranche(minuscule, c.debut, position) && minuscule.slice(position, position + 400).includes(c.colonne))) {
        r.cas.paire++
        continue
      }
      if (genre === 'declencheur' && nom === '_acces_avant_les_gardes' && table === '%i' && /\d{14}_acces_avant_les_gardes\.sql$/.test(f.chemin)
        && minuscule.includes(GARDE_DES_PREPAREES)) {
        r.cas.porteDesPreparees++
        continue
      }
      const ou = creees.has(t) ? 'une table que le fichier crée'
        : TABLES_DU_SOCLE.includes(t) ? `une table du socle${genre === 'declencheur' ? ', dont le socle ne rend pas les déclencheurs' : ''}`
          : 'une table d’hier'
      r.fautes.push(`${f.chemin} : ${genre} ${nom} sur ${t} (${ou}), créé dans un bloc do : l’inventaire de l’export ne le compterait pas — le poser en clair`)
    }
  }
}

/** Le relevé de tous les fichiers. */
export function releve(fichiers: Fichier[]): Releve {
  const total: Releve = { fautes: [], blocs: 0, cas: { restrictive: 0, paire: 0, balayage: 0, porteDesPreparees: 0 }, verifications: 0 }
  for (const f of fichiers) {
    const r = releveDUnFichier(f)
    total.fautes.push(...r.fautes)
    total.blocs += r.blocs
    total.verifications += r.verifications
    for (const k of Object.keys(r.cas) as CasNomme[]) total.cas[k] += r.cas[k]
  }
  return total
}

const SCHEMA = fichiersDuSchema()
const PREPAREES = fichiersPrepares()

describe('aucun objet ne se crée dans un bloc do, que l’inventaire de l’export ne verrait pas (22/11/2026)', () => {
  it('le plancher : l’export et les préparées se lisent entiers, et chaque cas nommé compte ses créations', () => {
    expect(PREPAREES.length).toBeGreaterThanOrEqual(22)
    expect(SCHEMA.length).toBeGreaterThanOrEqual(251)
    // Relevé le 22/11/2026, l'export et les préparées RÉUNIS (une préparée rangée dans l'export au collage ne change rien) :
    // 220 blocs ; quarante-quatre restrictives sous condition (vingt-six dans l'export, dix-huit dans onze préparées), vingt
    // contraintes de paire (MCB5g, INV2, LIA2, AFF2, EL2 : quatre chacune), la boucle de la double authentification, le bloc
    // `$preparees$` de la porte (ses dix tables) ; vingt et un rendus du catalogue comparés (dix-sept dans l'export, quatre
    // dans INV3 et DOCF-Q1-B). Un nombre qui change est un cas à relire, puis à épingler ici avec sa raison.
    const tout = releve([...SCHEMA, ...PREPAREES])
    expect(tout.cas).toEqual({ restrictive: 44, paire: 20, balayage: 1, porteDesPreparees: 10 })
    expect(tout.verifications).toBe(21)
    expect(tout.blocs).toBeGreaterThanOrEqual(220)
    expect(releve(PREPAREES).blocs).toBeGreaterThanOrEqual(43)
  })

  it('aucune préparée ne crée dans un bloc un objet hors des cas nommés', () => {
    expect(releve(PREPAREES).fautes).toEqual([])
  })

  it('aucune migration de l’export non plus', () => {
    expect(releve(SCHEMA).fautes).toEqual([])
  })

  describe('le relevé, éprouvé par des défauts plantés', () => {
    const TABLE = 'create table public.neuve (id uuid primary key);\nalter table public.neuve enable row level security;\n'
    const juger = (texte: string) => releveDUnFichier({ chemin: 'supabase/preparees/x.sql', texte })
    // La forme des sept préparées d'avant le 22/11/2026 : la porte sous condition, dans un bloc.
    const PORTE_SOUS_CONDITION = `do $porte$
declare
  v_table text;
begin
  if to_regprocedure('public.acces_avant_les_gardes()') is not null then
    foreach v_table in array array['neuve'] loop
      if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = ('public.' || v_table)::regclass and t.tgname = '_acces_avant_les_gardes') then
        execute format('create trigger _acces_avant_les_gardes before insert or update on public.%I for each row execute function public.acces_avant_les_gardes()', v_table);
      end if;
    end loop;
  end if;
end
$porte$;`
    const RESTRICTIVE = (condition = CONDITION_DF) => `do $deux_facteurs$
begin
  ${condition}
    execute 'create policy deux_facteurs on public.neuve as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;`
    const PAIRE = (table = 'ecritures_brouillon') => `do $autres_sources$
begin
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'stock_de_cloture_id' and not a.attisdropped) then
    execute 'alter table public.${table} add constraint ecritures_brouillon_neuve_hors_des_stocks '
      || 'check (neuve_id is null or stock_de_cloture_id is null)';
  end if;
end
$autres_sources$;`

    it('la porte sous condition dans un bloc, sur la table que le fichier crée : la faute du 22/11/2026', () => {
      expect(juger(TABLE + PORTE_SOUS_CONDITION).fautes).toEqual([
        'supabase/preparees/x.sql : declencheur _acces_avant_les_gardes sur neuve (une table que le fichier crée), créé dans un bloc do : l’inventaire de l’export ne le compterait pas — le poser en clair',
      ])
      // Posée en clair : aucune faute.
      expect(juger(TABLE + 'create trigger _acces_avant_les_gardes before insert or update on public.neuve for each row execute function public.acces_avant_les_gardes();').fautes).toEqual([])
    })

    it('sur une table d’hier ou du socle, la même faute : un déclencheur que le socle ne rend pas', () => {
      expect(juger(PORTE_SOUS_CONDITION.replace("'neuve'", "'memberships'")).fautes).toEqual([
        'supabase/preparees/x.sql : declencheur _acces_avant_les_gardes sur memberships (une table d’hier), créé dans un bloc do : l’inventaire de l’export ne le compterait pas — le poser en clair',
      ])
      expect(juger(PORTE_SOUS_CONDITION.replace("'neuve'", "'ecritures_brouillon'")).fautes[0]).toMatch(/une table du socle, dont le socle ne rend pas les déclencheurs/)
    })

    it('une instruction du bloc, sans execute, une policy, un index ou une contrainte : vus de même', () => {
      expect(juger(TABLE + 'do $$ begin create index neuve_x on public.neuve (id); end $$;').fautes).toHaveLength(1)
      expect(juger(TABLE + "do $$ begin execute 'create unique index if not exists neuve_x on public.neuve (id)'; end $$;").fautes).toHaveLength(1)
      expect(juger(TABLE + "do $$ begin execute 'create policy neuve_lecture on public.neuve for select to authenticated using (true)'; end $$;").fautes).toHaveLength(1)
      expect(juger(TABLE + "do $$ begin execute 'alter table public.neuve add constraint neuve_c check (true)'; end $$;").fautes).toHaveLength(1)
      expect(juger(TABLE + "do $$ begin execute 'create constraint trigger neuve_t after insert on public.neuve deferrable initially deferred for each row execute function f()'; end $$;").fautes).toHaveLength(1)
    })

    it('ce que le relevé ne sait pas lire est une faute : une table qu’il ne nomme pas, une forme de bloc, un mot sans sa lecture', () => {
      expect(juger(TABLE + "do $$ declare t regclass; begin execute format('create index neuve_x on %s (id)', t); end $$;").fautes[0]).toMatch(/ne sait pas nommer/)
      expect(juger(TABLE + "do $$ declare t text; begin execute format('create index neuve_x on public.%I (id)', t); end $$;").fautes[0]).toMatch(/ne sait pas nommer/)
      expect(juger(TABLE + 'do language plpgsql $$ begin null; end $$;').fautes[0]).toMatch(/bloc do de forme non reconnue/)
      expect(juger("do $$ begin execute 'create table public.cachee (id int)'; end $$;").fautes[0]).toMatch(/une forme que le relevé ne lit pas/)
      expect(juger(TABLE + "do $$ begin execute 'alter table public.neuve add column x int'; end $$;").fautes[0]).toMatch(/une forme que le relevé ne lit pas/)
      expect(juger(TABLE + "do $$ begin execute 'add constraint neuve_c check (true)'; end $$;").fautes[0]).toMatch(/une forme que le relevé ne lit pas/)
      expect(juger("create function public.f() returns void language plpgsql as $f$ begin execute 'create index x on public.neuve (id)'; end $f$;").fautes[0])
        .toMatch(/dans le corps d'une fonction/)
    })

    it('la restrictive sous sa condition, sur la table que le fichier crée : un cas nommé ; sans la condition, ou sur une autre table, une faute', () => {
      expect(juger(TABLE + RESTRICTIVE())).toMatchObject({ fautes: [], cas: { restrictive: 1 } })
      expect(juger(TABLE + RESTRICTIVE('if true then')).fautes).toHaveLength(1)
      expect(juger(RESTRICTIVE()).fautes[0]).toMatch(/sur neuve \(une table d’hier\)/)
      // Une autre expression que l'exacte : une faute.
      expect(juger(TABLE + RESTRICTIVE().replace('as restrictive', 'as permissive')).fautes).toHaveLength(1)
    })

    it('la contrainte de paire sur le brouillon, sous la condition de la colonne sœur : un cas nommé ; sur une autre table, une faute', () => {
      expect(juger(PAIRE())).toMatchObject({ fautes: [], cas: { paire: 1 } })
      expect(juger(PAIRE('lignes_bancaires')).fautes).toHaveLength(1)
      expect(juger(PAIRE().replace("a.attname = 'stock_de_cloture_id'", "a.attname = 'autre_id'")).fautes).toHaveLength(1)
    })

    it('le rendu du catalogue comparé dans une garde n’est pas une création ; en capitales sans la lecture du catalogue, une faute', () => {
      const comparaison = (lecture: string) => `do $fin$ begin
  if not exists (select 1 from pg_trigger t where t.tgname = 'neuve_garde'
                   and ${lecture} = 'CREATE TRIGGER neuve_garde BEFORE INSERT ON public.neuve FOR EACH ROW EXECUTE FUNCTION f()') then
    raise exception 'non';
  end if;
end $fin$;`
      expect(juger(comparaison('pg_get_triggerdef(t.oid)'))).toMatchObject({ fautes: [], verifications: 1 })
      expect(juger(comparaison('t.tgname')).fautes).toHaveLength(1)
    })

    it('les commentaires ne comptent pas, ni hors du bloc ni dedans', () => {
      expect(juger(TABLE + PORTE_SOUS_CONDITION.replace(/^/gm, '-- ')).fautes).toEqual([])
      expect(juger(TABLE + "do $$ begin\n  -- execute 'create index neuve_x on public.neuve (id)';\n  null;\nend $$;").fautes).toEqual([])
      expect(juger(TABLE + "do $$ begin /* create index neuve_x on public.neuve (id) */ null; end $$;").fautes).toEqual([])
    })
  })
})
