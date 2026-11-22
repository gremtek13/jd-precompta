import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { blocsDo, espaces, nomsDesListes, sansCommentaires } from '../test/blocsSql'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LA PORTE D'ACCÈS DEVANT LES GARDES (ligne 43, `acces_avant_les_gardes`, en production depuis le 15/11/2026, GARDES-Q1),
// RÈGLE DES MIGRATIONS.
//
// Un déclencheur BEFORE tire avant l'expression WITH CHECK de la policy : une garde `security definer` qui lit la base et
// lève répondrait à un appelant que la policy refuse. La porte, `_acces_avant_les_gardes`, première des déclencheurs BEFORE
// INSERT OR UPDATE d'une table, juge l'appelant par les policies d'abord. La règle : toute migration qui pose une garde
// `security definer` (BEFORE, sur l'insertion ou la mise à jour) sur une table que la porte ne couvre pas d'office (ses 32
// tables, et `dossiers`, écartée pour sa raison) y pose AUSSI la porte. LA PORTE EN BASE (l'état d'aujourd'hui) : posée
// directement (`create trigger _acces_avant_les_gardes …`), ou sous la condition que sa fonction soit en base — la forme des
// sept migrations préparées avant elle, qui s'appliquent ainsi avant ou après elle —, ou exigée par sa garde de tête sur une
// table qu'une migration dont elle dépend couvre en clair (INV4 sur `operations_inventaire`, qu'INV2 couvre). Depuis le
// 22/11/2026, les préparées la posent EN CLAIR (creationsDansLesBlocs.test.ts : une pose dans un bloc échappait à
// l'inventaire de l'export). LA PORTE PRÉPARÉE (l'état d'avant le
// 15/11/2026, que les défauts plantés jouent encore) : sous la condition seulement, et la liste des tables que la porte
// couvre si leur garde est déjà là (`c_preparees`, le bloc `$preparees$`, et son retour) nomme cette table. La base, elle, se
// juge par l'étape 32 de supabase/essais/accesAvantLesGardes.sql, sur une réplique.
//
// Le relevé part de TOUT (l'export et les préparées), lit chaque fonction de déclencheur et chaque déclencheur ; une
// garde de l'export sur une table hors de la porte est une faute aussi. Le plancher : il retrouve dans l'export les 32
// tables de la porte et `dossiers`.

type Fichier = { chemin: string; texte: string }

// Les lecteurs du texte (commentaires, blancs, blocs `do`, listes `array[…]`) vivent dans src/test/blocsSql.ts : la règle
// sœur, la restrictive de la double authentification sur toute table neuve (deuxFacteursDesTablesNeuves.test.ts), lit les
// mêmes blocs de la même façon.
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
  for (const { corps } of blocsDo(sansCommentaires(texte))) {
    const bloc = espaces(corps)
    if (!bloc.includes(CONDITION) || !bloc.includes(POSE)) continue
    for (const t of nomsDesListes(bloc)) couvertes.add(t)
  }
  return couvertes
}

/** Les tables qu'un fichier couvre de la porte directement : `create trigger _acces_avant_les_gardes … on public.<table>`, qui
 *  suppose sa fonction en base (la porte en base). */
export function tablesCouvertesDirectement(texte: string): Set<string> {
  const motif = /create\s+trigger\s+_acces_avant_les_gardes\s+before\s+insert\s+or\s+update\s+on\s+(?:public\.)?(\w+)\s+for\s+each\s+row\s+execute\s+function\s+public\.acces_avant_les_gardes\s*\(\s*\)/gi
  return new Set([...sansCommentaires(texte).matchAll(motif)].map((m) => m[1].toLowerCase()))
}

/** Les tables dont un fichier EXIGE la porte en tête : un bloc `do` qui lève si `_acces_avant_les_gardes` manque sur la table,
 *  où une migration dont il dépend l'a posée en clair (INV4 sur `operations_inventaire`, qu'INV2 couvre : deux poses du même
 *  déclencheur se heurteraient). Elle suppose la porte en base, comme la pose directe ; et une autre migration doit la poser. */
export function tablesDontLaPorteEstExigee(texte: string): Set<string> {
  const motif = /if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+(?:pg_catalog\.)?pg_trigger\s+t\s+where\s+t\.tgrelid\s*=\s*'public\.(\w+)'::regclass\s+and\s+t\.tgname\s*=\s*'_acces_avant_les_gardes'[^)]*\)\s*then\s+raise\s+exception\b/gi
  const exigees = new Set<string>()
  for (const { corps } of blocsDo(sansCommentaires(texte))) for (const m of corps.matchAll(motif)) exigees.add(m[1].toLowerCase())
  return exigees
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

/**
 * Les fautes : une garde hors de la porte sans la porte — sous condition, ou directement quand la porte est en base —, ou
 * absente des listes de la porte préparée.
 */
export function fautesDeLaPorte(fichiers: Fichier[], porte: { texte: string; preparee: boolean }): string[] {
  const sd = gardesSecurityDefiner(fichiers)
  const { tables, preparees } = listesDeLaPorte(porte.texte)
  const fautes: string[] = []
  for (const f of fichiers) {
    if (/_acces_avant_les_gardes\.sql$/.test(f.chemin)) continue
    const couvertes = tablesCouvertesSousCondition(f.texte)
    // La porte en base : sa pose directe vaut la pose sous condition. Préparée, elle échouerait (la fonction n'existe pas).
    if (!porte.preparee) for (const t of tablesCouvertesDirectement(f.texte)) couvertes.add(t)
    // La porte en base, exigée en tête sur une table qu'une AUTRE migration couvre en clair : couverte aussi.
    if (!porte.preparee) {
      for (const t of tablesDontLaPorteEstExigee(f.texte)) {
        if (fichiers.some((g) => g !== f && tablesCouvertesDirectement(g.texte).has(t))) couvertes.add(t)
        else fautes.push(`${f.chemin} : la porte de ${t} exigée en tête, qu'aucune autre migration ne pose en clair`)
      }
    }
    for (const t of tablesGardees(f.texte, sd)) {
      if (t === 'dossiers' || tables.includes(t)) continue
      if (!couvertes.has(t)) {
        fautes.push(`${f.chemin} : la garde security definer de ${t} sans la porte posée ${porte.preparee ? 'sous condition' : '(directement ou sous condition)'}`)
      }
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
  it('la porte se trouve, dans l’export depuis le 15/11/2026, avec ses 32 tables', () => {
    expect(PORTE, 'la migration acces_avant_les_gardes').toBeDefined()
    expect(PORTE!.chemin).toBe('supabase/schema/20261115075431_acces_avant_les_gardes.sql')
    expect(PREPAREES.some((f) => /\d{14}_acces_avant_les_gardes\.sql$/.test(f.chemin))).toBe(false)
    expect(listesDeLaPorte(PORTE!.texte).tables).toHaveLength(32)
  })

  // Une table neuve dont la migration pose elle-même la porte (EL2, `ecritures_libres`, le jour où elle est rangée dans
  // l'export) s'ajoute aux 32 sans être une faute ; le plancher exige toujours les 32 et `dossiers`, et qu'une table de plus
  // soit couverte par une migration de l'export — la règle du test suivant, qui la juge aussi.
  it('le plancher : dans l’export, le relevé retrouve les 32 tables de la porte et `dossiers`, et seulement des tables que leur migration couvre en plus', () => {
    const sd = gardesSecurityDefiner(TOUS)
    const export_ = new Set(SCHEMA.flatMap((f) => tablesGardees(f.texte, sd)))
    const attendues = [...listesDeLaPorte(PORTE!.texte).tables, 'dossiers']
    const couvertes = new Set(SCHEMA.filter((f) => !/_acces_avant_les_gardes\.sql$/.test(f.chemin))
      .flatMap((f) => [...tablesCouvertesDirectement(f.texte), ...tablesCouvertesSousCondition(f.texte)]))
    expect(attendues.filter((t) => !export_.has(t))).toEqual([])
    expect([...export_].filter((t) => !attendues.includes(t) && !couvertes.has(t))).toEqual([])
    expect(attendues).toHaveLength(33)
  })

  it('aucune migration, exportée ou préparée, ne pose une garde security definer hors de la porte sans la poser sous condition', () => {
    expect(fautesDeLaPorte(TOUS, { texte: PORTE!.texte, preparee: PORTE!.chemin.startsWith('supabase/preparees/') })).toEqual([])
  })

  it('les trois listes de la porte disent les mêmes tables que les préparées d’avant elle couvrent : la garde de tête, la pose, et le retour', () => {
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
    // La porte en base (l'état d'aujourd'hui) : sa pose directe, comme la sienne, sur la table de la garde.
    const jugerEnBase = (preparee: string, porte = PORTE_PLANTEE) =>
      fautesDeLaPorte([{ chemin: 'supabase/preparees/x.sql', texte: preparee }], { texte: porte, preparee: false })
    const DIRECTE = (table: string) =>
      `create trigger _acces_avant_les_gardes before insert or update on public.${table} for each row execute function public.acces_avant_les_gardes();`

    it('la garde et la porte sous condition : aucune faute (le contrôle positif), la porte préparée comme en base', () => {
      expect(juger(GARDE + '\n' + BLOC("'neuve'"))).toEqual([])
      expect(jugerEnBase(GARDE + '\n' + BLOC("'neuve'"))).toEqual([])
    })
    it('la porte en base : la garde et la porte posée directement, aucune faute ; sans la porte, ou sur une autre table, une faute', () => {
      expect(jugerEnBase(GARDE + '\n' + DIRECTE('neuve'))).toEqual([])
      expect(jugerEnBase(GARDE)).toEqual(['supabase/preparees/x.sql : la garde security definer de neuve sans la porte posée (directement ou sous condition)'])
      expect(jugerEnBase(GARDE + '\n' + DIRECTE('autre'))).toHaveLength(1)
      // Une pose commentée n'est pas une pose.
      expect(jugerEnBase(GARDE + '\n-- ' + DIRECTE('neuve'))).toHaveLength(1)
    })
    // La porte exigée en tête (INV4 sur `operations_inventaire`, qu'INV2 couvre en clair) : la forme de la garde de tête.
    const EXIGEE = (table: string) => `do $garde$
begin
  if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.${table}'::regclass
                   and t.tgname = '_acces_avant_les_gardes' and not t.tgisinternal) then
    raise exception 'la porte manque';
  end if;
end
$garde$;`
    it('la porte en base, exigée en tête sur une table qu’une autre migration couvre en clair : aucune faute ; que rien ne pose, une faute', () => {
      const pose = { chemin: 'supabase/preparees/w.sql', texte: DIRECTE('neuve') }
      const exige = { chemin: 'supabase/preparees/x.sql', texte: GARDE + '\n' + EXIGEE('neuve') }
      expect(fautesDeLaPorte([pose, exige], { texte: PORTE_PLANTEE, preparee: false })).toEqual([])
      expect(fautesDeLaPorte([exige], { texte: PORTE_PLANTEE, preparee: false })).toEqual([
        "supabase/preparees/x.sql : la porte de neuve exigée en tête, qu'aucune autre migration ne pose en clair",
        'supabase/preparees/x.sql : la garde security definer de neuve sans la porte posée (directement ou sous condition)',
      ])
      // Exigée sur une autre table, ou commentée : la table de la garde reste sans porte.
      expect(fautesDeLaPorte([pose, { ...exige, texte: GARDE + '\n' + EXIGEE('autre') }], { texte: PORTE_PLANTEE, preparee: false }))
        .toContain('supabase/preparees/x.sql : la garde security definer de neuve sans la porte posée (directement ou sous condition)')
      expect(fautesDeLaPorte([pose, { ...exige, texte: GARDE + '\n' + EXIGEE('neuve').replace(/^/gm, '-- ') }], { texte: PORTE_PLANTEE, preparee: false }))
        .toEqual(['supabase/preparees/x.sql : la garde security definer de neuve sans la porte posée (directement ou sous condition)'])
      // La porte préparée : l'exigence ne vaut rien (la fonction n'existe pas encore).
      expect(fautesDeLaPorte([pose, exige], { texte: PORTE_PLANTEE, preparee: true }))
        .toContain('supabase/preparees/x.sql : la garde security definer de neuve sans la porte posée sous condition')
    })
    it('la porte préparée : sa pose directe ne vaut rien (la fonction n’existe pas encore) — une faute', () => {
      expect(juger(GARDE + '\n' + DIRECTE('neuve'))).toEqual(['supabase/preparees/x.sql : la garde security definer de neuve sans la porte posée sous condition'])
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
