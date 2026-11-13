import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LA PORTE D'ACCÈS DEVANT LES GARDES (ligne 43, `acces_avant_les_gardes`), RÈGLE DES MIGRATIONS PRÉPARÉES.
//
// Un déclencheur BEFORE tire avant l'expression WITH CHECK de la policy : une garde `security definer` qui lit la base et
// lève répondrait à un appelant que la policy refuse. La porte, `_acces_avant_les_gardes`, première des déclencheurs BEFORE
// INSERT OR UPDATE d'une table, juge l'appelant par les policies d'abord. La règle : toute migration préparée qui pose une
// garde `security definer` (BEFORE, sur l'insertion ou la mise à jour) sur une table que la porte ne couvre pas d'office
// (ses 32 tables, et `dossiers`, écartée pour sa raison) y pose AUSSI la porte, sous la condition que sa fonction soit en
// base — pour s'appliquer avant ou après elle ; et tant que la porte est elle-même préparée, sa liste des tables qu'elle
// couvre si leur garde est déjà là (`c_preparees`, le bloc `$preparees$`, et son retour) nomme cette table. La base, elle, se juge
// par l'étape 32 de supabase/essais/accesAvantLesGardes.sql, sur une réplique.
//
// Le relevé part de TOUT (l'export et les préparées), lit chaque fonction de déclencheur et chaque déclencheur ; une
// garde de l'export sur une table hors de la porte est une faute aussi. Le plancher : il retrouve dans l'export les 32
// tables de la porte et `dossiers`.

type Fichier = { chemin: string; texte: string }

const sansCommentaires = (sql: string) => sql.replace(/--[^\n]*/g, '')
const espaces = (s: string) => s.replace(/\s+/g, ' ').trim()

const CONDITION = "to_regprocedure('public.acces_avant_les_gardes()') is not null"
const POSE = 'create trigger _acces_avant_les_gardes before insert or update on public.%I for each row execute function public.acces_avant_les_gardes()'

/** Les fonctions de déclencheur et leur `security definer`, la dernière définition l'emportant (l'ordre des fichiers). */
export function gardesSecurityDefiner(fichiers: Fichier[]): Map<string, boolean> {
  const sd = new Map<string, boolean>()
  const motif = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(\s*\)\s*returns\s+trigger([\s\S]*?)\bas\s+\$\w*\$/gi
  for (const f of fichiers) {
    for (const m of sansCommentaires(f.texte).matchAll(motif)) sd.set(m[1].toLowerCase(), /security\s+definer/i.test(m[2]))
  }
  return sd
}

/** Les tables où un fichier pose une garde `security definer` BEFORE sur l'insertion ou la mise à jour. */
export function tablesGardees(texte: string, sd: Map<string, boolean>): string[] {
  const motif = /create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(\w+)\s+(before|after|instead\s+of)\s+([^;]*?)\s+on\s+(?:public\.)?(\w+)\s[^;]*?execute\s+(?:function|procedure)\s+(?:public\.)?(\w+)\s*\(/gi
  const tables = new Set<string>()
  for (const m of sansCommentaires(texte).matchAll(motif)) {
    const [, nom, quand, evenements, table, fonction] = m
    if (nom === '_acces_avant_les_gardes' || quand.toLowerCase() !== 'before') continue
    if (!/\b(insert|update)\b/i.test(evenements)) continue
    if (sd.get(fonction.toLowerCase()) === undefined) throw new Error(`${table} : la fonction ${fonction} n'est définie nulle part — le relevé ne la lit pas.`)
    if (sd.get(fonction.toLowerCase())) tables.add(table.toLowerCase())
  }
  return [...tables].sort()
}

/** Les tables qu'un fichier couvre de la porte sous condition : un bloc `do` qui teste la fonction, pose, et les nomme. */
export function tablesCouvertesSousCondition(texte: string): Set<string> {
  const couvertes = new Set<string>()
  for (const m of sansCommentaires(texte).matchAll(/\bdo\s+\$(\w*)\$([\s\S]*?)\$\1\$/gi)) {
    const bloc = espaces(m[2])
    if (!bloc.includes(CONDITION) || !bloc.includes(POSE)) continue
    for (const t of bloc.matchAll(/array\[([^\]]*)\]/g)) for (const l of t[1].matchAll(/'(\w+)'/g)) couvertes.add(l[1])
  }
  return couvertes
}

/** Les listes de la porte : ses 32 tables (`c_tables`), et les tables couvertes si leur garde est là (`c_preparees`, `$preparees$`). */
export function listesDeLaPorte(porte: string): { tables: string[]; preparees: string[]; blocPreparees: string[] } {
  const liste = (re: RegExp) => [...(porte.match(re)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((l) => l[1]).sort()
  return {
    tables: liste(/c_tables\s+constant\s+text\[\]\s*:=\s*array\[([^\]]*)\]/),
    preparees: liste(/c_preparees\s+constant\s+text\[\]\s*:=\s*array\[([^\]]*)\]/),
    blocPreparees: liste(/do\s+\$preparees\$[\s\S]*?array\[([^\]]*)\][\s\S]*?\$preparees\$/),
  }
}

/** Les fautes : une garde hors de la porte sans la porte posée sous condition, ou absente des listes de la porte préparée. */
export function fautesDeLaPorte(fichiers: Fichier[], porte: { texte: string; preparee: boolean }): string[] {
  const sd = gardesSecurityDefiner(fichiers)
  const { tables, preparees } = listesDeLaPorte(porte.texte)
  const fautes: string[] = []
  for (const f of fichiers) {
    if (/_acces_avant_les_gardes\.sql$/.test(f.chemin)) continue
    const couvertes = tablesCouvertesSousCondition(f.texte)
    for (const t of tablesGardees(f.texte, sd)) {
      if (t === 'dossiers' || tables.includes(t)) continue
      if (!couvertes.has(t)) fautes.push(`${f.chemin} : la garde security definer de ${t} sans la porte posée sous condition`)
      if (porte.preparee && !preparees.includes(t)) fautes.push(`${f.chemin} : ${t} absente des tables que la porte préparée couvre (c_preparees)`)
    }
  }
  return fautes
}

const SCHEMA = fichiersDuSchema()
const PREPAREES = fichiersPrepares()
const TOUS = [...SCHEMA, ...PREPAREES]
const PORTE = TOUS.find((f) => /\d{14}_acces_avant_les_gardes\.sql$/.test(f.chemin))
const RETOUR_DE_LA_PORTE = readFileSync(new URL('../../supabase/preparees/retour/20261113120100_retour_acces_avant_les_gardes.sql', import.meta.url), 'utf8')

describe('la porte d’accès devant les gardes — la règle des migrations préparées (ligne 43)', () => {
  it('la porte se trouve, préparée ou exportée, avec ses 32 tables', () => {
    expect(PORTE, 'la migration acces_avant_les_gardes').toBeDefined()
    expect(listesDeLaPorte(PORTE!.texte).tables).toHaveLength(32)
  })

  it('le plancher : dans l’export, le relevé retrouve exactement les 32 tables de la porte et `dossiers`', () => {
    const sd = gardesSecurityDefiner(TOUS)
    const export_ = new Set(SCHEMA.flatMap((f) => tablesGardees(f.texte, sd)))
    expect([...export_].sort()).toEqual([...listesDeLaPorte(PORTE!.texte).tables, 'dossiers'].sort())
  })

  it('aucune migration, exportée ou préparée, ne pose une garde security definer hors de la porte sans la poser sous condition', () => {
    expect(fautesDeLaPorte(TOUS, { texte: PORTE!.texte, preparee: PORTE!.chemin.startsWith('supabase/preparees/') })).toEqual([])
  })

  it('les trois listes de la porte préparée disent les mêmes tables : la garde de tête, la pose, et le retour', () => {
    const { preparees, blocPreparees } = listesDeLaPorte(PORTE!.texte)
    expect(preparees.length).toBeGreaterThanOrEqual(10)
    expect(blocPreparees).toEqual(preparees)
    const retour = [...(sansCommentaires(RETOUR_DE_LA_PORTE).match(/do\s+\$preparees\$[\s\S]*?array\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((l) => l[1]).sort()
    expect(retour).toEqual(preparees)
  })

  describe('le relevé, éprouvé par des défauts plantés', () => {
    const PORTE_PLANTEE = `create function public.acces_avant_les_gardes() returns trigger language plpgsql security invoker as $f$ begin return new; end $f$;
do $garde$ declare c_tables constant text[] := array['pieces']; c_preparees constant text[] := array['neuve']; begin null; end $garde$;
do $preparees$ begin foreach v in array array['neuve'] loop null; end loop; end $preparees$;`
    const GARDE = `create function public.garder_neuve()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $fonction$ begin return new; end $fonction$;
create trigger neuve_garde before insert or update or delete on public.neuve for each row execute function public.garder_neuve();`
    const BLOC = (tables: string, condition = CONDITION) => `do $porte$
declare v_table text;
begin
  if ${condition} then
    foreach v_table in array array[${tables}] loop
      execute format('create trigger _acces_avant_les_gardes before insert or update on public.%I for each row execute function public.acces_avant_les_gardes()', v_table);
    end loop;
  end if;
end
$porte$;`
    const juger = (preparee: string, porte = PORTE_PLANTEE) =>
      fautesDeLaPorte([{ chemin: 'supabase/preparees/x.sql', texte: preparee }], { texte: porte, preparee: true })

    it('la garde et la porte sous condition : aucune faute (le contrôle positif)', () => {
      expect(juger(GARDE + '\n' + BLOC("'neuve'"))).toEqual([])
    })
    it('la garde sans la porte : une faute', () => {
      expect(juger(GARDE)).toEqual(['supabase/preparees/x.sql : la garde security definer de neuve sans la porte posée sous condition'])
    })
    it('la porte posée sur une autre table seulement : une faute', () => {
      expect(juger(GARDE + '\n' + BLOC("'autre'"))).toHaveLength(1)
    })
    it('la porte posée sans la condition : une faute', () => {
      expect(juger(GARDE + '\n' + BLOC("'neuve'", 'true'))).toHaveLength(1)
    })
    it('une garde écrite sur une ligne, le langage avant `security definer` : vue de même', () => {
      const uneLigne = `create function public.garder_neuve() returns trigger
language plpgsql security definer set search_path = public as $$ begin return new; end $$;
create trigger neuve_garde before update of montant on public.neuve for each row execute function public.garder_neuve();`
      expect(juger(uneLigne)).toHaveLength(1)
    })
    it('la porte préparée qui ne nomme pas la table dans c_preparees : une faute', () => {
      expect(juger(GARDE + '\n' + BLOC("'neuve'"), PORTE_PLANTEE.replace(/'neuve'/g, "'autre'"))).toEqual([
        'supabase/preparees/x.sql : neuve absente des tables que la porte préparée couvre (c_preparees)',
      ])
    })
    it('ce qui ne parle pas avant la RLS n’est pas une faute : une garde security invoker, un déclencheur AFTER, la seule suppression, une table de la porte, `dossiers`', () => {
      expect(juger(GARDE.replace('security definer', 'security invoker'))).toEqual([])
      expect(juger(GARDE.replace('before insert or update or delete', 'after insert or update'))).toEqual([])
      expect(juger(GARDE.replace('before insert or update or delete', 'before delete'))).toEqual([])
      expect(juger(GARDE.replace('on public.neuve', 'on public.pieces'))).toEqual([])
      expect(juger(GARDE.replace('on public.neuve', 'on public.dossiers'))).toEqual([])
    })
    it('une garde dont la fonction n’est définie nulle part se refuse : le relevé ne la lirait pas', () => {
      expect(() => juger('create trigger x before insert on public.neuve for each row execute function public.inconnue();')).toThrow(/définie nulle part/)
    })
  })
})
