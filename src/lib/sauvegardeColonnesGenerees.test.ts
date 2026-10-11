import { describe, expect, it } from 'vitest'
import { FormeInconnue, colonnesGenereesDuSchema, fichiersDuSchema, type ColonneGeneree } from '../test/schema'
import {
  clePrimaire,
  COLONNES_GENEREES,
  ORDRE_RESTAURATION,
  TABLES_AUTO_REFERENCEES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TOUS_LES_LIENS,
} from './sauvegarde'

// UNE COLONNE QUE LA BASE CALCULE NE SE RESTAURE PAS, ELLE SE RECALCULE — défaut relevé à l'étape e5b1, corrigé le
// 11/10/2026. `piece_textes_ocr.texte_md5` est GÉNÉRÉE ; la sauvegarde lit les lignes entières et la restauration les
// réinsérait telles quelles : Postgres refuse d'écrire dans une colonne générée (428C9), même NULL, même la valeur qu'il
// aurait calculée. Toute restauration d'un dossier qui avait un texte lu s'arrêtait donc au milieu. Le plan de
// réinsertion retire désormais les colonnes de `COLONNES_GENEREES` de chaque ligne envoyée.
//
// LA SOURCE EST LE SCHÉMA EXPORTÉ, jamais une autre liste tenue à la main — comme `sauvegardeTables`,
// `sauvegardeClesPrimaires` et `sauvegardeRelations`. Une colonne générée ajoutée demain par une migration est vue ici
// sans que personne ait à y penser ; la dérivation (`colonnesGenereesDuSchema`, src/test/schema.ts) part du MOT
// `generated`, et lève sur toute forme qu'elle ne sait pas lire au lieu de la sauter.
//
// **Ce que ce test ne garde pas**, le couple habituel : que l'export décrive la base réelle. Vérifié le 11/10/2026 sur le
// catalogue de la production (`pg_attribute`) : dans `public`, une seule colonne générée, `piece_textes_ocr.texte_md5`,
// et aucune colonne d'identité — exactement ce que la dérivation rend. Les colonnes générées de Supabase lui-même
// (`auth.users.confirmed_at`, `storage.objects.path_tokens`…) vivent hors de toute sauvegarde d'un dossier.

const nom = (g: ColonneGeneree) => `${g.table}.${g.colonne}`

/** Chaque écart entre la liste du plan et l'export, dit en une phrase. */
function ecarts(
  declarees: Readonly<Record<string, readonly string[]>>,
  duSchema: readonly ColonneGeneree[],
  plan: readonly string[],
): string[] {
  const declare = new Set(Object.entries(declarees).flatMap(([table, colonnes]) => colonnes.map((colonne) => nom({ table, colonne }))))
  const schema = new Set(duSchema.map(nom))
  return [
    ...[...schema].sort().filter((c) => !declare.has(c)).map((c) =>
      `${c} est générée dans le schéma et absente de COLONNES_GENEREES : la restauration l'écrirait, et la base refuserait le lot (428C9)`),
    ...[...declare].sort().filter((c) => !schema.has(c)).map((c) =>
      `${c} est déclarée, et n'est générée nulle part dans le schéma : la restauration la retirerait d'une ligne qui la porte`),
    ...Object.keys(declarees).sort().filter((t) => !plan.includes(t)).map((t) => `${t} n'est pas au plan de restauration`),
  ]
}

describe('colonnes générées — ce que la restauration n’écrit jamais', () => {
  const fichiers = fichiersDuSchema()
  const duSchema = colonnesGenereesDuSchema(fichiers)

  it('lit bien tout le schéma : la colonne connue y est', () => {
    // Le plancher sans lequel « aucun écart » voudrait aussi dire « le lecteur ne voit plus rien ».
    expect(fichiers.length).toBeGreaterThanOrEqual(121)
    expect(duSchema).toContainEqual({ table: 'piece_textes_ocr', colonne: 'texte_md5' })
  })

  it('`COLONNES_GENEREES` dit EXACTEMENT ce que le schéma dit, dans les deux sens, et ses tables sont au plan', () => {
    expect(ecarts(COLONNES_GENEREES, duSchema, ORDRE_RESTAURATION)).toEqual([])
  })

  it('aucune colonne générée n’est une clé ni un lien que le plan lit avant de la retirer', () => {
    // Le plan calcule les vagues, la seconde passe et l'identité d'une ligne partagée sur les lignes ENTIÈRES, puis
    // retire les colonnes générées : une colonne générée qui serait une clé ou un lien rendrait cet ordre décisif.
    const lues = (table: string) => new Set([
      'id',
      'dossier_id',
      ...clePrimaire(table),
      ...TOUS_LES_LIENS.filter((r) => r.enfant === table).map((r) => r.colonne),
      ...TABLES_AUTO_REFERENCEES.filter((a) => a.table === table).map((a) => a.colonne),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.filter((a) => a.table === table).map((a) => a.colonne),
    ])
    const fautives = Object.entries(COLONNES_GENEREES).flatMap(([table, colonnes]) =>
      colonnes.filter((c) => lues(table).has(c)).map((colonne) => nom({ table, colonne })))
    expect(fautives).toEqual([])
  })

  describe('un défaut planté se voit', () => {
    it('une colonne retirée de la liste', () => {
      expect(ecarts({}, duSchema, ORDRE_RESTAURATION)).toEqual([
        'piece_textes_ocr.texte_md5 est générée dans le schéma et absente de COLONNES_GENEREES : la restauration l\'écrirait, '
          + 'et la base refuserait le lot (428C9)',
      ])
    })

    it('une colonne inventée, une table hors du plan', () => {
      expect(ecarts({ ...COLONNES_GENEREES, pieces: ['empreinte_inventee'] }, duSchema, ORDRE_RESTAURATION)).toEqual([
        'pieces.empreinte_inventee est déclarée, et n\'est générée nulle part dans le schéma : la restauration la retirerait '
          + 'd\'une ligne qui la porte',
      ])
      expect(ecarts({ ...COLONNES_GENEREES, table_inconnue: ['x'] }, [...duSchema, { table: 'table_inconnue', colonne: 'x' }],
        ORDRE_RESTAURATION)).toEqual(['table_inconnue n\'est pas au plan de restauration'])
    })

    it('une colonne générée qu’une migration ajouterait demain, sans l’inscrire', () => {
      const demain = [...fichiers, {
        chemin: 'supabase/schema/29991231000000_plantee.sql',
        texte: 'alter table public.pieces\n  add column nom_normalise text generated always as (lower(nom_fichier)) stored;\n',
      }]
      expect(ecarts(COLONNES_GENEREES, colonnesGenereesDuSchema(demain), ORDRE_RESTAURATION).join('\n'))
        .toContain('pieces.nom_normalise est générée dans le schéma et absente de COLONNES_GENEREES')
    })
  })

  describe('la dérivation lit les formes réelles, et lève sur les autres', () => {
    const lire = (...textes: string[]) => colonnesGenereesDuSchema(textes.map((texte, i) => ({ chemin: `${i}.sql`, texte })))

    it('déclarée à la création ou ajoutée, majuscules et guillemets compris', () => {
      expect(lire(
        'CREATE TABLE public."t_a" (\n  id uuid PRIMARY KEY,\n  x text,\n  "x_md5" text GENERATED ALWAYS AS (md5(x)) STORED\n);',
        'alter table only public.t_b add column if not exists y_bas text generated always as (lower(y)) stored, add column z int;',
        'alter table t_b add y_haut text generated always as (upper(y)) stored;',
      )).toEqual([
        { table: 't_a', colonne: 'x_md5' }, { table: 't_b', colonne: 'y_bas' }, { table: 't_b', colonne: 'y_haut' },
      ])
    })

    it('rejoue l’ordre écrit : rendue ordinaire, ou emportée avec sa table, elle ne l’est plus', () => {
      expect(lire(
        'create table t_a (x text, g text generated always as (md5(x)) stored);',
        'alter table t_a alter column g drop expression;',
        'create table t_b (x text, g text generated always as (md5(x)) stored);\ncreate table t_c (x text, g text generated always as (md5(x)) stored);',
        'drop table if exists public.t_b, t_c cascade;',
        'create table t_d (x text, g text generated always as (md5(x)) stored);',
        // Dans un même fichier, l'ordre ÉCRIT : supprimée puis recréée, la table porte la colonne de sa nouvelle création.
        'drop table if exists t_e;\ncreate table t_e (x text, g text generated always as (md5(x)) stored);',
      )).toEqual([{ table: 't_d', colonne: 'g' }, { table: 't_e', colonne: 'g' }])
    })

    it('une ligne de commentaire qui cite la forme n’est pas une colonne ; un `drop` sur une autre table ne la touche pas', () => {
      expect(lire(
        '-- alter table t_a add column g text generated always as (md5(x)) stored;\ncreate table t_a (x text);',
        'create table t_b (x text, g text generated always as (md5(x)) stored);\nalter table t_a drop column x;',
      )).toEqual([{ table: 't_b', colonne: 'g' }])
    })

    it('lève sur une forme qu’elle ne sait pas lire, au lieu de la sauter', () => {
      const leve = (texte: string, motif: RegExp) => expect(() => lire(texte)).toThrow(motif)
      // Une colonne d'identité : la restauration ne saurait ni l'écrire (GENERATED ALWAYS) ni avancer sa séquence.
      leve('create table t (id bigint generated always as identity primary key, x text);', /t : « id bigint generated always as identity/)
      leve('create table t (id bigint generated by default as identity, x text);', /forme jamais rencontrée/)
      leve('alter table t alter column id add generated always as identity;', /t : « alter column id add generated/)
      // Le mot hors de toute colonne : dans un corps de bloc, dans une chaîne, deux fois dans une même colonne.
      leve('do $$ begin execute \'alter table t add column g text generated always as (md5(x)) stored\'; end $$;', /corps/)
      leve('comment on table t is \'des colonnes generated\';', /1 occurrence\(s\) de « generated » hors de toute colonne générée/)
      leve('create table t (x text, g text generated always as (md5(x)) stored check (g <> \'generated\'));', /t : « g text/)
      // Une contrainte qui cite la forme n'est pas une colonne nommée « constraint ».
      leve('create table t (x text, constraint c check (x <> \'generated always as (y)\'));', /t : « constraint c check/)
      leve('alter table t add constraint c check (x <> \'generated always as (y)\');', /t : « add constraint c check/)
      // Une table qui hérite, ou copiée par `like` : ses colonnes générées viendraient sans le mot.
      leve('create table t (like u including all);', /t créée par « like u including all »/)
      leve('create table t (x text) inherits (u);', /héritage/)
      leve('create table t partition of u for values in (1);', /héritage/)
      // Un renommage ou un `drop` de colonne sur une table qui en porte une.
      leve('create table t (x text, g text generated always as (md5(x)) stored);\nalter table t drop column x cascade;', /qui porte une colonne générée/)
      leve('create table t (x text, g text generated always as (md5(x)) stored);\nalter table t rename column g to h;', /qui porte une colonne générée/)
      expect(() => lire('create table t (x text);')).not.toThrow()
      expect(() => lire('create table t (id bigint generated always as identity);')).toThrow(FormeInconnue)
    })
  })
})
