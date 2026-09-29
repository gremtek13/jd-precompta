import { describe, expect, it } from 'vitest'
import { FormeInconnue, fichiersDuSchema, relationsDuSchema, type RelationDuSchema } from '../test/schema'
import { RELATIONS } from './sauvegarde'

// « TOUT CE QUI SUIT EST LU DU SCHÉMA RÉEL (pg_constraint) LE 18/09/2026, JAMAIS SUPPOSÉ. » C'est
// l'en-tête de `sauvegarde.ts`, et rien ne le re-vérifiait : `RELATIONS` est tenue à la main, et
// l'ordre de restauration n'est éprouvé que CONTRE elle. Une clé étrangère ajoutée par une migration
// et oubliée ici passait donc toute la suite au vert — celle du 29/09/2026 (`lignes_bancaires.categorie_id`,
// l'affectation d'un mouvement à une catégorie) l'aurait fait.
//
// CE QU'UNE RELATION OUBLIÉE COÛTE, dit exactement : pas une sauvegarde fausse, une sauvegarde qu'on
// ne peut pas RESTAURER, découverte le jour où l'on restaure. `parentsHorsPlan` ne sait pas qu'il faut
// emporter les catégories PARTAGÉES du cabinet (`dossier_id` nul) que désigne un mouvement affecté,
// `liensPerdus` ne vérifie pas ce lien, et l'ordre de restauration peut réinsérer l'enfant avant son
// parent : la restauration s'arrête sur une violation de clé étrangère. Et une relation au MAUVAIS
// `aLaSuppression` déclarerait « effaçable » un lien que Postgres refuse de perdre, ou l'inverse.
//
// LA SOURCE EST LE SCHÉMA EXPORTÉ, jamais une autre liste tenue à la main — comme `sauvegardeTables`
// et `sauvegardeClesPrimaires`. **Ce que ce test ne garde pas**, le couple habituel : que l'export
// décrive la base réelle. Il le faisait à une clé près le 29/09/2026 — `pieces.sous_dossier_id`,
// ajoutée hors migration, n'existait dans aucun fichier ; c'est en écrivant ce test que les onze objets
// manquants ont été trouvés (voir `supabase/schema/socle/2_objets_sans_migration.sql`). Depuis,
// `supabase/essais/inventaire.py` compare l'export au catalogue, nom par nom.

const cle = (r: Pick<RelationDuSchema, 'enfant' | 'colonne' | 'parent' | 'aLaSuppression'>) =>
  `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`

// `auth.users` n'appartient pas à l'application : la sauvegarde ne l'emporte pas, et `RELATIONS` l'exclut
// volontairement (voir son commentaire). Toute AUTRE table hors `public` serait une surprise à regarder.
const versAuth = (r: RelationDuSchema) => r.parent.startsWith('auth.')

describe('relations — le graphe de la sauvegarde suit les clés étrangères du schéma', () => {
  const duSchema = relationsDuSchema(fichiersDuSchema())

  it('lit bien tout le schéma', () => {
    // La borne sans laquelle « aucune différence » voudrait aussi dire « le lecteur ne voit plus
    // rien ». 75 clés au 29/09/2026 (61 entre tables de l'application, 14 vers `auth.users`) ; le
    // compte ne fait que croître.
    expect(duSchema.length).toBeGreaterThanOrEqual(75)
    expect(duSchema.filter(versAuth).length).toBeGreaterThanOrEqual(14)
    // Les trois formes d'écriture d'une clé portent chacune au moins une relation réelle :
    // déclarée sur la colonne (migrations), contrainte de niveau table (le socle, tel que
    // `pg_catalog` l'écrit) et `add constraint` (le complément du socle).
    const parNom = new Map(duSchema.map((r) => [r.nom, r]))
    expect(parNom.get('lignes_bancaires_categorie_id_fkey')?.aLaSuppression).toBe('bloque')
    expect(parNom.get('pieces_sous_dossier_id_fkey')?.aLaSuppression).toBe('met_a_null')
    expect(parNom.get('informations_dossier_dossier_id_fkey')?.aLaSuppression).toBe('cascade')
  })

  it('aucune clé ne vise un autre schéma que `public` ou `auth`', () => {
    const ailleurs = duSchema.filter((r) => r.parent.includes('.') && !versAuth(r)).map(cle)
    expect(ailleurs, 'une clé vers un schéma inconnu : la sauvegarde l’ignorerait sans le dire').toEqual([])
  })

  it('`RELATIONS` dit EXACTEMENT ce que le schéma dit, dans les deux sens, action comprise', () => {
    // Aucune exception, et c'est possible parce que les deux tombent juste : une relation de moins
    // est une restauration qui s'arrête, une de plus un lien qu'on croit gardé et qui n'existe pas.
    const attendu = duSchema.filter((r) => !versAuth(r)).map(cle).sort()
    const declare = RELATIONS.map(cle).sort()
    expect(declare.filter((r) => !attendu.includes(r)), 'dans RELATIONS, absent du schéma').toEqual([])
    expect(attendu.filter((r) => !declare.includes(r)), 'dans le schéma, absent de RELATIONS').toEqual([])
    expect(declare).toEqual(attendu)
  })
})

describe('relationsDuSchema — le lecteur lui-même', () => {
  const lire = (...lignes: string[]) => relationsDuSchema([{ chemin: 'synthetique.sql', texte: lignes.join('\n') }])

  it('lit les trois formes et nomme la contrainte comme Postgres', () => {
    expect(lire(
      'create table enfant (',
      '  id uuid primary key,',
      '  a uuid references parent_a(id) on delete cascade,',
      '  b uuid not null references public.parent_b,',
      '  c uuid references auth.users(id) on delete set null,',
      '  constraint enfant_d_lien FOREIGN KEY (d) REFERENCES parent_d(id) ON DELETE SET NULL',
      ');',
      'alter table public.enfant add column e uuid references parent_e(id) on delete restrict;',
      'alter table enfant add constraint enfant_f_fkey foreign key (f) references "parent_f"(id);',
    ).map((r) => `${r.nom}: ${cle(r)}`)).toEqual([
      'enfant_a_fkey: enfant.a → parent_a (cascade)',
      'enfant_b_fkey: enfant.b → parent_b (bloque)',
      'enfant_c_fkey: enfant.c → auth.users (met_a_null)',
      'enfant_d_lien: enfant.d → parent_d (met_a_null)',
      'enfant_e_fkey: enfant.e → parent_e (bloque)',
      'enfant_f_fkey: enfant.f → parent_f (bloque)',
    ])
  })

  it('rejoue `drop constraint` par le nom que Postgres a donné, puis le re-ajout', () => {
    // La forme de la migration `informations_dossier_cascade_suppression` : une clé déclarée sur la
    // colonne, retirée par son nom par défaut, remise avec une autre action.
    expect(lire(
      'create table fiche (id uuid primary key, dossier_id uuid references dossiers(id));',
      'alter table fiche drop constraint fiche_dossier_id_fkey;',
      'alter table fiche add constraint fiche_dossier_id_fkey foreign key (dossier_id) references dossiers(id) on delete cascade;',
    ).map(cle)).toEqual(['fiche.dossier_id → dossiers (cascade)'])
    expect(lire(
      'create table fiche (id uuid primary key, dossier_id uuid references dossiers(id));',
      'alter table fiche drop constraint if exists fiche_dossier_id_fkey;',
    )).toEqual([])
  })

  it('rejoue `drop table`, et découpe un `alter` à plusieurs actions', () => {
    expect(lire(
      'create table morte (id uuid primary key, piece_id uuid references pieces(id));',
      'drop table if exists morte;',
      'alter table vivante add column a uuid references pa(id), add column b uuid references pb(id) on delete cascade;',
    ).map(cle)).toEqual(['vivante.a → pa (bloque)', 'vivante.b → pb (cascade)'])
  })

  it('ignore le corps d’une fonction, même quand il ressemble à une clé', () => {
    expect(lire(
      'create function f() returns void language plpgsql as $$',
      'begin',
      '  alter table x add constraint x_y_fkey foreign key (y) references z(id);',
      'end;',
      '$$;',
      'create function g() returns void language plpgsql as $corps$ begin alter table x add column w uuid references z(id); end; $corps$;',
    )).toEqual([])
  })

  it('refuse ce qu’il n’a jamais vu plutôt que de le deviner', () => {
    // Chaque forme ci-dessous changerait le graphe d'une façon que ce lecteur ne sait pas encore
    // rejouer ; la ranger « au plus près » ferait passer un graphe faux pour un graphe juste.
    expect(() => lire('create table t (a uuid, b uuid, foreign key (a, b) references p(x, y));')).toThrow(FormeInconnue)
    expect(() => lire('alter table t add constraint t_ab_fkey foreign key (a, b) references p(x, y);')).toThrow(FormeInconnue)
    expect(() => lire('create table t (a uuid references p(id) on delete set default);')).toThrow(FormeInconnue)
    expect(() => lire('create table t (a uuid references p(id));', 'alter table t rename column a to b;')).toThrow(FormeInconnue)
    expect(() => lire('create table t (a uuid references p(id));', 'alter table t drop column a;')).toThrow(FormeInconnue)
    expect(() => lire('create table t (a uuid references p(id));', 'alter table t rename to u;')).toThrow(FormeInconnue)
  })
})
