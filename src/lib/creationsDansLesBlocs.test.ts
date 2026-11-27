import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
    + 'elle, et l’inventaire la compte comme la base depuis le 23/11/2026 (DF-INV-Q1 (A)) : effective seulement si la fonction est déjà là au '
    + 'point du rejeu, `deux_facteurs_exiges` rejouée avant dans l’ordre des fichiers (éprouvé plus bas, par l’inventaire lui-même)',
  paire: 'la contrainte d’une paire de sources neuves du brouillon (`ecritures_brouillon`, une table du socle), posée par la seconde de la '
    + 'paire à se coller : socle.sql rend les contraintes du brouillon du catalogue, et le socle se régénère au collage — l’inventaire les compte',
  balayage: 'la boucle `$policies$` de `deux_facteurs_exiges`, la restrictive sur chaque table de public présente : l’inventaire la compte '
    + 'depuis le 23/11/2026 (DF-INV-Q1 (A)) sur les tables que l’export a créées à ce point du rejeu — 108 sur la production du jour, 125 avec '
    + 'les préparées, comme la base —, celle des douze du socle venant du socle rendu du catalogue, `as restrictive` (socle.sql) ; éprouvé plus bas',
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
    // Le 27/11/2026 : trois préparées rangées dans l'export (255 à 257, OPT6, MCB6Q2-Q1, DOCF-Q1-B), puis les deux de MCB5g
    // (258, 259) ; le plancher des préparées descend à 17, celui de l'export monte à 259 — leur somme ne baisse pas, ni les
    // blocs réunis.
    expect(PREPAREES.length).toBeGreaterThanOrEqual(17)
    expect(SCHEMA.length).toBeGreaterThanOrEqual(259)
    // Relevé le 22/11/2026, l'export et les préparées RÉUNIS (une préparée rangée dans l'export au collage ne change rien) :
    // 220 blocs ; quarante-quatre restrictives sous condition (vingt-six dans l'export, dix-huit dans onze préparées), vingt
    // contraintes de paire (MCB5g, INV2, LIA2, AFF2, EL2 : quatre chacune), la boucle de la double authentification, le bloc
    // `$preparees$` de la porte (ses dix tables) ; vingt et un rendus du catalogue comparés (dix-sept dans l'export, quatre
    // dans INV3 et DOCF-Q1-B). Un nombre qui change est un cas à relire, puis à épingler ici avec sa raison. Le 24/11/2026,
    // quarante-six restrictives : celle de `reglages_d_export` (EXP-Q4, préparée), et celle de `codes_des_clients` (EXP58-Q2,
    // préparée) sur son compteur, chacune sous sa condition, sur la table qu'elle crée. Le 27/11/2026, vingt-quatre rendus
    // comparés : les deux déclencheurs de `piece_d_une_ecriture_libre_dans_son_dossier` (SECU4-Q1, préparée), relus par sa
    // garde de fin, et celui du déclencheur différé de MCBR-Q2 (`ouverture_suivante_a_la_validation`, préparée), sa condition
    // sur le rôle comprise.
    const tout = releve([...SCHEMA, ...PREPAREES])
    expect(tout.cas).toEqual({ restrictive: 46, paire: 20, balayage: 1, porteDesPreparees: 10 })
    expect(tout.verifications).toBe(24)
    expect(tout.blocs).toBeGreaterThanOrEqual(220)
    // 37 blocs dans les préparées le 27/11/2026, trois préparées rangées dans l'export (255 à 257) : le plancher à 35 ; puis
    // 32, les cinq blocs de MCB5g (258 : sa garde, la paire de ses sœurs, sa garde de fin ; 259 : sa garde et sa garde de fin)
    // rangés dans l'export : le plancher à 32.
    expect(releve(PREPAREES).blocs).toBeGreaterThanOrEqual(32)
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

// ─── L'INVENTAIRE COMPTE LES DEUX CAS DE LA RESTRICTIVE COMME LA BASE LES JOUERA (DF-INV-Q1, 23/11/2026) ───────────
//
// Le cabinet a tranché (A) le 23/11/2026 : corriger le contrôle avant de coller `deux_facteurs_exiges`. supabase/essais/inventaire.py
// lit désormais trois formes de bloc, et elles seules (son en-tête) : le balayage de la migration (la restrictive sur chaque table
// que l'export a créée à ce point du rejeu), la pose sous condition (effective seulement si `deux_facteurs_satisfaits()` est déjà
// là), et le retrait de son retour. Ce bloc lance l'inventaire LUI-MÊME (python3, son fichier importé, sans bytecode écrit) :
//   1. chaque fichier de l'export et des préparées : ce qu'il reconnaît égale, fichier par fichier, ce que le relevé ci-dessus range
//      sous « balayage » et « restrictive » — une pose que le relevé admet et que l'inventaire ne lirait pas le fait échouer ;
//   2. l'export d'aujourd'hui : l'inventaire avec ces règles égale celui où aucun bloc ne se lit (rien n'est encore en base) ;
//   3. la migration rejouée la dernière, une table neuve avant ou après elle, son retour : ce que la base aurait ;
//   4. des défauts plantés — la boucle, l'expression, la condition ou la branche changées — ne se lisent plus (ignorés, comme
//      tout autre bloc), et une pose sur une table que rien n'a créée arrête le rejeu.
// La preuve contre une base (réplique égale à la production, les trois ordres de collage) : HISTORIQUE.md, « DF-INV-Q1 ».

const RACINE_DU_DEPOT = new URL('../../', import.meta.url).pathname
const INVENTAIRE_PY = RACINE_DU_DEPOT + 'supabase/essais/inventaire.py'
/** Le lanceur : l'inventaire importé de son fichier ; chaque travail rend l'inventaire (neutre : aucun bloc lu), ou les formes
 *  reconnues fichier par fichier, ou l'arrêt du rejeu. */
const LANCEUR = String.raw`
import importlib.util, json, sys
sys.dont_write_bytecode = True
from pathlib import Path
spec = importlib.util.spec_from_file_location('inventaire_essaye', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
forme = m.forme_deux_facteurs
res = {}
for nom, t in json.loads(sys.stdin.read()).items():
    fichiers = [Path(p) for p in t['fichiers']]
    try:
        if t['quoi'] == 'formes':
            res[nom] = {str(f): m.formes_deux_facteurs([f]) for f in fichiers}
        else:
            m.forme_deux_facteurs = (lambda brute: None) if t['quoi'] == 'neutre' else forme
            res[nom] = sorted(m.inventaire(fichiers))
    except SystemExit as e:
        res[nom] = {'arret': str(e)}
print(json.dumps(res))
`
type Formes = { balayage: number; sous_condition: number; retrait: number }
type Travail = { quoi: 'inventaire' | 'neutre' | 'formes'; fichiers: string[] }

function lancer(travaux: Record<string, Travail>): Record<string, unknown> {
  const sortie = execFileSync('python3', ['-I', '-B', '-c', LANCEUR, INVENTAIRE_PY],
    { input: JSON.stringify(travaux), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return JSON.parse(sortie) as Record<string, unknown>
}

describe('l’inventaire de l’export compte la restrictive deux_facteurs comme la base la posera (DF-INV-Q1, 23/11/2026)', () => {
  const abs = (chemin: string) => RACINE_DU_DEPOT + chemin
  const MIGRATIONS = SCHEMA.filter((f) => !f.chemin.includes('/socle/')).map((f) => abs(f.chemin))
  const SOCLE = SCHEMA.filter((f) => f.chemin.includes('/socle/')).map((f) => abs(f.chemin))
  const RETOURS = readdirSync(abs('supabase/preparees/retour')).filter((n) => n.endsWith('.sql')).sort()
    .map((n) => ({ chemin: `supabase/preparees/retour/${n}`, texte: readFileSync(abs(`supabase/preparees/retour/${n}`), 'utf8') }))
  const DF = PREPAREES.find((f) => /\d{14}_deux_facteurs_exiges\.sql$/.test(f.chemin))
  const RETOUR_DF = RETOURS.find((f) => /\d{14}_retour_deux_facteurs_exiges\.sql$/.test(f.chemin))
  const expression = "as restrictive for all to authenticated '\n      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))'"
  const POSE = (table: string, condition = "if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then", branche = '') =>
    `do $deux_facteurs$
begin
  ${condition}
    execute 'create policy deux_facteurs on public.${table} ${expression};${branche}
  end if;
end
$deux_facteurs$;
`
  const NEUVE = (pose: string) => `create table public.neuve (
  id uuid primary key default gen_random_uuid()
);
alter table public.neuve enable row level security;
${pose}`
  /** Le texte de la migration, sa boucle `$policies$` seule transformée (le reste, gardes comprises, intact). */
  const bouclePlantee = (texte: string, de: string, en: string) => {
    const debut = texte.indexOf('do $policies$')
    const fin = texte.indexOf('$policies$;', debut + 13)
    const boucle = texte.slice(debut, fin)
    expect(boucle).toContain(de)
    return texte.slice(0, debut) + boucle.replace(de, en) + texte.slice(fin)
  }
  let dossier = ''
  let r: Record<string, unknown> = {}
  const inventaire = (nom: string) => r[nom] as string[]
  const deuxFacteurs = (inv: string[]) => inv.filter((x) => x.startsWith('policy|') && x.endsWith('.deux_facteurs')).sort()

  beforeAll(() => {
    if (!DF || !RETOUR_DF) throw new Error('deux_facteurs_exiges ou son retour introuvable')
    dossier = mkdtempSync(join(tmpdir(), 'inventaire-deux-facteurs-'))
    const planter = (nom: string, texte: string) => {
      const chemin = join(dossier, nom)
      writeFileSync(chemin, texte)
      return chemin
    }
    const df = planter('20261124100000_deux_facteurs_exiges.sql', DF.texte)
    const retour = planter('20261124100100_retour_deux_facteurs_exiges.sql', RETOUR_DF.texte)
    const neuve = planter('20261124100200_neuve.sql', NEUVE(POSE('neuve')))
    const sans = (...apres: string[]) => [...MIGRATIONS, ...apres, ...SOCLE]
    r = lancer({
      formes: { quoi: 'formes', fichiers: [...SCHEMA, ...PREPAREES, ...RETOURS].map((f) => abs(f.chemin)) },
      aujourdhui: { quoi: 'inventaire', fichiers: sans() },
      aujourdhuiNeutre: { quoi: 'neutre', fichiers: sans() },
      df: { quoi: 'inventaire', fichiers: sans(df) },
      dfPuisNeuve: { quoi: 'inventaire', fichiers: sans(df, neuve) },
      neuvePuisDf: { quoi: 'inventaire', fichiers: sans(neuve, df) },
      neuveSeule: { quoi: 'inventaire', fichiers: sans(neuve) },
      dfRetourNeuve: { quoi: 'inventaire', fichiers: sans(df, retour, neuve) },
      boucleSansP: { quoi: 'inventaire', fichiers: sans(planter('20261124100000_df_relkind.sql',
        bouclePlantee(DF.texte, "c.relkind in ('r', 'p')", "c.relkind in ('r')"))) },
      bouclePermissive: { quoi: 'inventaire', fichiers: sans(planter('20261124100000_df_permissive.sql',
        bouclePlantee(DF.texte, 'as restrictive', 'as permissive'))) },
      conditionChangee: { quoi: 'inventaire', fichiers: sans(df, planter('20261124100200_neuve_condition.sql', NEUVE(POSE('neuve', 'if true then')))) },
      brancheImpure: { quoi: 'inventaire', fichiers: sans(df, planter('20261124100200_neuve_branche.sql',
        NEUVE(POSE('neuve', undefined, "\n    execute 'create index neuve_id on public.neuve (id)';")))) },
      fantome: { quoi: 'inventaire', fichiers: sans(df, planter('20261124100200_fantome.sql', POSE('fantome'))) },
    })
  }, 120_000)

  afterAll(() => {
    if (dossier) rmSync(dossier, { recursive: true, force: true })
  })

  it('fichier par fichier, l’inventaire reconnaît ce que le relevé range sous « balayage » et « restrictive » ; le retrait, dans le seul retour de la migration', () => {
    const formes = r.formes as Record<string, Formes>
    const ecarts: string[] = []
    for (const f of [...SCHEMA, ...PREPAREES]) {
      const releveDuFichier = releveDUnFichier(f).cas
      const lu = formes[abs(f.chemin)]
      if (lu.balayage !== releveDuFichier.balayage || lu.sous_condition !== releveDuFichier.restrictive || lu.retrait !== 0) {
        ecarts.push(`${f.chemin} : l’inventaire lit ${JSON.stringify(lu)}, le relevé ${JSON.stringify(releveDuFichier)}`)
      }
    }
    expect(ecarts).toEqual([])
    const total = (fichiers: { chemin: string }[]) => fichiers.reduce((t, f) => {
      const lu = formes[abs(f.chemin)]
      return { balayage: t.balayage + lu.balayage, sous_condition: t.sous_condition + lu.sous_condition, retrait: t.retrait + lu.retrait }
    }, { balayage: 0, sous_condition: 0, retrait: 0 })
    // Les nombres du relevé épinglé plus haut : un balayage, quarante-six tables sous condition (vingt-sept dans l'export,
    // dix-sept dans les préparées depuis qu'EL2 est rangée, le 23/11/2026, et deux de plus le 24/11/2026 : `reglages_d_export`, puis
    // le compteur des codes des fiches, `codes_des_clients`).
    expect(total([...SCHEMA, ...PREPAREES])).toEqual({ balayage: 1, sous_condition: 46, retrait: 0 })
    expect(RETOURS.filter((f) => formes[abs(f.chemin)].retrait > 0).map((f) => f.chemin)).toEqual([RETOUR_DF?.chemin])
    expect(total(RETOURS)).toEqual({ balayage: 0, sous_condition: 0, retrait: 1 })
  })

  it('l’export d’aujourd’hui : aucune restrictive, et le même inventaire que si aucun bloc ne se lisait', () => {
    expect(deuxFacteurs(inventaire('aujourdhui'))).toEqual([])
    expect(inventaire('aujourdhui')).toEqual(inventaire('aujourdhuiNeutre'))
    // Le plancher : l'inventaire de l'export entier, pas un fragment (3 468 objets le 23/11/2026).
    expect(inventaire('aujourdhui').length).toBeGreaterThanOrEqual(3400)
  })

  it('la migration rejouée la dernière : la restrictive sur chaque table que l’export a créée, ses deux tables comprises, et sur storage.objects ; les douze du socle l’attendent de leur rendu', () => {
    const inv = inventaire('df')
    const tables = inv.filter((x) => x.startsWith('rls|')).map((x) => x.slice(4))
    const attendues = tables.filter((t) => !TABLES_DU_SOCLE.includes(t)).map((t) => `policy|${t}.deux_facteurs`)
    expect(deuxFacteurs(inv)).toEqual([...attendues, 'policy|objects.deux_facteurs'].sort())
    expect(attendues).toEqual(expect.arrayContaining(['policy|exigences_deux_facteurs.deux_facteurs', 'policy|retraits_deux_facteurs.deux_facteurs']))
    // Toutes les tables de l'export d'aujourd'hui moins les douze du socle, plus les deux de la migration : 108 le 23/11/2026.
    expect(attendues.length).toBe(inventaire('aujourdhui').filter((x) => x.startsWith('rls|')).length - TABLES_DU_SOCLE.length + 2)
    expect(attendues.length).toBeGreaterThanOrEqual(108)
  })

  it('une table neuve : posée par sa migration si la fonction est déjà là, par la boucle si elle vient avant ; sans la migration, ni l’une ni l’autre', () => {
    expect(inventaire('dfPuisNeuve')).toContain('policy|neuve.deux_facteurs')
    expect(inventaire('neuvePuisDf')).toContain('policy|neuve.deux_facteurs')
    // Les deux ordres de collage laissent le même inventaire, comme la base (HISTORIQUE.md, « DF-INV-Q1 »).
    expect(inventaire('neuvePuisDf')).toEqual(inventaire('dfPuisNeuve'))
    expect(inventaire('neuveSeule')).toContain('rls|neuve')
    expect(deuxFacteurs(inventaire('neuveSeule'))).toEqual([])
  })

  it('le retour retire toutes les restrictives et la fonction : une pose sous condition jouée après lui ne crée rien', () => {
    const inv = inventaire('dfRetourNeuve')
    expect(deuxFacteurs(inv)).toEqual([])
    expect(inv).not.toContain('fonction|deux_facteurs_satisfaits/0')
    expect(inv).toContain('rls|neuve')
    expect(inv).toEqual(inventaire('neuveSeule'))
  })

  it('les défauts plantés : une boucle, une expression, une condition ou une branche changées ne se lisent plus ; une table que rien n’a créée arrête le rejeu', () => {
    // La boucle qui ne balaierait plus que les tables ordinaires, ou poserait une permissive : ignorée — seule la restrictive de
    // storage.objects, posée en clair, reste.
    expect(deuxFacteurs(inventaire('boucleSansP'))).toEqual(['policy|objects.deux_facteurs'])
    expect(deuxFacteurs(inventaire('bouclePermissive'))).toEqual(['policy|objects.deux_facteurs'])
    // La pose sous une autre condition, ou d'une branche qui fait autre chose : ignorée, la table neuve sans restrictive.
    expect(inventaire('conditionChangee')).toContain('rls|neuve')
    expect(inventaire('conditionChangee')).not.toContain('policy|neuve.deux_facteurs')
    expect(inventaire('brancheImpure')).not.toContain('policy|neuve.deux_facteurs')
    expect(deuxFacteurs(inventaire('conditionChangee'))).toEqual(deuxFacteurs(inventaire('df')))
    expect(r.fantome).toEqual({ arret: expect.stringMatching(/la restrictive deux_facteurs posée sur fantome, qu'aucune instruction n'a créée/) })
  })

  it('socle.sql rend une restrictive `as restrictive`, après la table et avant `for` : la base rebâtie du socle ne la pose pas permissive', () => {
    // Le texte de la requête, ses commentaires retirés : la clause entre le nom de la table et `for`, une fois. Le rendu lui-même se
    // prouve sur une réplique (le socle rendu du catalogue porte `as restrictive` sur les douze tables, HISTORIQUE.md, « DF-INV-Q1 »).
    const socle = readFileSync(abs('supabase/essais/socle.sql'), 'utf8').replace(/--[^\n]*/g, '')
    const rendu = espaces(socle.slice(socle.search(/select 'create policy "'/i), socle.indexOf('from pg_policies p join manquantes m')))
    expect(rendu).toBe(`select 'create policy "' || p.policyname || '" on public.' || p.tablename || case when p.permissive = 'RESTRICTIVE' then ' as restrictive' else '' end || E'\\n for ' || lower(p.cmd) || ' to ' || array_to_string(p.roles, ', ') || coalesce(E'\\n using (' || p.qual || ')', '') || coalesce(E'\\n with check (' || p.with_check || ')', '') || ';'`)
  })
})
