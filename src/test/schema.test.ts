import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { contientSql, definitionsSql, derniereDefinitionSql, dernierIndiceSql, fichiersDuSchema, finDuCorps, FormeInconnue, indiceSql, motifDeDefinition } from './schema'

// LA DERNIÈRE DÉFINITION D'UNE FONCTION, CAPITALES COMPRISES (10/11/2026).
//
// `derniereDefinitionSql` ne cherchait que `create (or replace )?function` en minuscules, et la fin du corps à `$$;`.
// La migration acomptes_des_devis écrit `CREATE OR REPLACE FUNCTION public.enregistrer_facture(` … `AS $function$` : les
// tests lisaient la définition de mentions_figees, qu'elle remplace. Ces cas plantent les deux formes, et les deux
// délimiteurs, et exigent la dernière — puis le schéma réel, fonction par fonction.

const fichier = (chemin: string, texte: string) => ({ chemin, texte })

const MINUSCULES = `create or replace function public.f(p int)
returns int language plpgsql as $$
begin
  return 1; -- ancienne
end;
$$;
`
const CAPITALES = `CREATE OR REPLACE FUNCTION public.f(p integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
begin
  return 2; -- dernière
end;
$function$;

create or replace function public.g() returns int language sql as $$ select 3 $$;
`

describe('la dernière définition d’une fonction, capitales comprises', () => {
  it('une définition en capitales après une en minuscules : la dernière, close par son propre délimiteur', () => {
    const definitions = definitionsSql('f', [fichier('a.sql', MINUSCULES), fichier('b.sql', CAPITALES)])
    expect(definitions.map((d) => d.chemin)).toEqual(['a.sql', 'b.sql'])
    const derniere = definitions[1].definition
    expect(derniere).toContain('-- dernière')
    // Close à `$function$`, jamais au `$$;` de `g`, plus loin : l'ancienne lecture s'y arrêtait.
    expect(derniere.endsWith('end;\n')).toBe(true)
    expect(derniere).not.toContain('public.g')
  })

  it('et dans l’autre ordre, la dernière en minuscules', () => {
    const definitions = definitionsSql('f', [fichier('a.sql', CAPITALES), fichier('b.sql', MINUSCULES)])
    expect(definitions.at(-1)).toEqual({ chemin: 'b.sql', definition: MINUSCULES.slice(0, MINUSCULES.lastIndexOf('$$;')) })
  })

  it('deux définitions dans le même fichier : la plus basse dans le texte', () => {
    const definitions = definitionsSql('f', [fichier('a.sql', MINUSCULES + CAPITALES)])
    expect(definitions).toHaveLength(2)
    expect(definitions[1].definition).toContain('-- dernière')
  })

  it('le motif ne prend pas un nom qui commence comme un autre, et accepte les retours à la ligne', () => {
    expect(motifDeDefinition('f').test('create function public.f_bis(')).toBe(false)
    expect(motifDeDefinition('f').test('Create Or Replace\n  Function public.f(')).toBe(true)
  })

  it('un corps sans délimiteur `$…$` avant la fin de l’instruction lève, plutôt que de rendre un texte faux', () => {
    const texte = "create function public.h() returns int language sql as 'select 1'; select $$x$$;"
    expect(() => finDuCorps(texte, 0, 'h')).toThrow(FormeInconnue)
    expect(() => finDuCorps('create function public.h() as $a$ select 1', 0, 'h')).toThrow(/ne se referme pas/)
  })

  it('dans le schéma exporté, enregistrer_facture est celle de dossier_du_cabinet (LM1), en entier', () => {
    const definitions = definitionsSql('enregistrer_facture', fichiersDuSchema())
    expect(definitions.at(-1)?.chemin).toMatch(/_dossier_du_cabinet\.sql$/)
    expect(definitions.at(-2)?.chemin).toMatch(/_factures_reprises_encaissements\.sql$/)
    // Celle d'avant encore, en capitales (acomptes_des_devis, recopiée de `pg_get_functiondef`) : le motif la lit aussi.
    expect(definitions.at(-3)?.chemin).toMatch(/_acomptes_des_devis\.sql$/)
    expect(definitions.at(-3)?.definition).toMatch(/^CREATE OR REPLACE FUNCTION public\.enregistrer_facture\(/)
    const derniere = derniereDefinitionSql('enregistrer_facture')
    // Le corps, de `as $$` à son délimiteur fermant : 50 190 caractères, md5 a5e2f40e… — ceux de `prosrc` en production,
    // relevés le 12/11/2026 après la séance de collage par `select md5(prosrc), length(prosrc) from pg_proc` (49 957 et
    // 38dda448… le 10/11/2026, avant LM1).
    // LM1 la recopie de `pg_get_functiondef` : son corps s'ouvre par `AS $function$`.
    const corps = derniere.slice(indiceSql(derniere, 'as $function$') + 'as $function$'.length)
    expect(corps).toHaveLength(50190)
    expect(createHash('md5').update(corps).digest('hex')).toBe('a5e2f40e4fe36453bd39aa46baa91f07')
  })

  describe('le schéma réel, fonction par fonction', () => {
    // Le schéma se lit UNE fois, dans un beforeAll (CLAUDE.md : un calcul lourd ne se paie jamais en relevant le délai d'un
    // test) : `derniereDefinitionSql` relit tous les fichiers à chaque appel, et ses 256 appels dépassaient les 5 s d'un test
    // sous la charge de la suite entière (CI du 10/11/2026). `definitionsSql` sur les fichiers lus une fois rend la même
    // dernière définition.
    let noms = new Set<string>()
    const dernieres = new Map<string, string>()
    beforeAll(() => {
      const fichiers = fichiersDuSchema()
      noms = new Set(fichiers.flatMap((f) =>
        [...f.texte.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\(/gi)].map((m) => m[1])))
      for (const nom of noms) {
        const definitions = definitionsSql(nom, fichiers)
        if (definitions.length > 0) dernieres.set(nom, definitions[definitions.length - 1].definition)
      }
    })

    it('chaque fonction du schéma exporté a un corps qui se referme, et sa dernière définition se lit', () => {
      // Un plancher : zéro faute n'est pas un scanner aveugle (256 fonctions le 10/11/2026).
      expect(noms.size).toBeGreaterThan(250)
      for (const nom of noms) {
        const derniere = dernieres.get(nom)
        expect(derniere, nom).toBeDefined()
        // Le texte rendu ne déborde jamais sur la définition suivante.
        expect([...(derniere ?? '').matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\./gi)], nom).toHaveLength(1)
      }
    })

    it('la lecture unique rend la même dernière définition que derniereDefinitionSql', () => {
      for (const nom of ['enregistrer_facture', 'valider_exercice', 'enregistrer_encaissement']) {
        expect(dernieres.get(nom), nom).toBe(derniereDefinitionSql(nom))
      }
    })
  })
})

describe('les recherches de texte fixe, capitales comprises', () => {
  const texte = 'x\nCREATE OR REPLACE FUNCTION public.f() as $$ $$;\ncreate or replace function public.f() as $$ $$;'

  it('trouvent la forme en capitales comme celle en minuscules, aux positions du texte d’origine', () => {
    expect(indiceSql(texte, 'create or replace function')).toBe(2)
    expect(indiceSql(texte, 'CREATE OR REPLACE FUNCTION', 3)).toBe(dernierIndiceSql(texte, 'create'))
    expect(dernierIndiceSql(texte, 'create or replace function')).toBe(dernierIndiceSql(texte, 'create'))
    expect(contientSql(texte, 'Create Or Replace Function public.f(')).toBe(true)
    expect(contientSql(texte, 'create function')).toBe(false)
    expect(indiceSql(texte, 'create table')).toBe(-1)
  })

  it('refusent un texte dont la mise en minuscules déplacerait les positions', () => {
    expect(() => indiceSql('İ create function', 'create function')).toThrow(FormeInconnue)
  })
})
