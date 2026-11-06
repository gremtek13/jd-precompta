-- LES DROITS QUI NE PASSENT PAS PAR LA RLS, RETIRÉS À `anon` ET À `authenticated` (relecture de sécurité du 06/11/2026).
-- L'essai : supabase/essais/rls.sql, bloc HR (le catalogue, joué en production comme sur une réplique), et, sur une réplique
-- seulement, supabase/essais/droitsHorsRls.sql (chaque geste tenté) ; la garde : src/lib/droitsHorsRls.test.ts ; le
-- retour : supabase/preparees/retour/20261106180100_retour_droits_hors_rls.sql.
--
-- CE QUE LA BASE PORTE (relevé du 06/11/2026, au catalogue, PostgreSQL 17.6). Le schéma public compte 85 relations, toutes
-- des tables, toutes au rôle `postgres`, qui applique les migrations et n'est pas super-utilisateur. `anon` et
-- `authenticated` portent sur chacune les huit droits d'une table (`arwdDxtm`), donnés par `postgres`, non transmissibles —
-- sauf UPDATE d'`authenticated` sur `cabinet_admins`, rendu sur la seule colonne `role` (`equipe_par_son_role`). Quatre de
-- ces droits ne passent ni par la RLS ni par les déclencheurs de ligne :
--   - TRUNCATE (D) vide une table d'un coup, sans policy ni déclencheur de ligne ;
--   - REFERENCES (x) pose une clé étrangère qui la vise (depuis un schéma où l'on peut créer une table) : elle bloque ou
--     propage les suppressions du cabinet, et l'existence d'une valeur s'y devine sans la lire ;
--   - TRIGGER (t) y pose un déclencheur, qui verrait chaque ligne écrite par tout le monde ;
--   - MAINTAIN (m), PostgreSQL 17 : VACUUM, ANALYZE, CLUSTER, REINDEX, REFRESH MATERIALIZED VIEW, LOCK TABLE — un verrou
--     posé à volonté, un index reconstruit. `information_schema.role_table_grants` le TAIT : la relecture ne l'avait pas
--     vu, `aclexplode` le montre.
-- Les droits par défaut de `postgres` dans public donnent les mêmes huit à `anon`, `authenticated`, `service_role` et à
-- lui-même : toute table créée demain les recevrait. Aucune voie de l'API ne les atteint aujourd'hui — PostgREST n'émet que
-- SELECT, INSERT, UPDATE et DELETE, aucune fonction de public n'en use, `anon` et `authenticated` n'ont que USAGE sur public
-- (pas CREATE), aucun déclencheur ON TRUNCATE dans la base — : un risque latent, que ce texte ferme en profondeur.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE. Deux instructions, entre deux gardes :
--   1. `revoke … on all tables in schema public from anon, authenticated` : sur chaque relation de public, les quatre droits
--      que le propriétaire leur a donnés. ALL TABLES couvre aussi les vues, vues matérialisées, tables étrangères et
--      partitionnées (pas les séquences). Un REVOKE sur une table retire aussi le même droit de chacune de ses colonnes : la
--      garde de tête exige qu'aucun REFERENCES par colonne ne leur soit donné, que le retour ne rendrait pas.
--   2. `alter default privileges in schema public revoke … on tables from anon, authenticated` : SANS `for role`, le défaut
--      du rôle COURANT. Il doit être le propriétaire des relations (`postgres` en production, `proprietaire` sur une
--      réplique, sous `set role proprietaire`) ; joué par un autre rôle — le super-utilisateur d'une réplique, qui s'y nomme
--      `postgres` —, il changerait le défaut de ce rôle-là et le retrait n'ôterait rien de ce que le propriétaire a donné :
--      la garde de tête le refuse. Aucun nom de rôle n'est écrit en dur.
-- Ce que PostgreSQL fait du retrait : mené par le propriétaire, il n'ôte que les droits que le propriétaire a donnés. Un
-- droit venu d'ailleurs survivrait — un autre donneur, PUBLIC, une appartenance (`pg_maintain` donne MAINTAIN sur toute
-- relation) : la garde de tête exige l'état relevé, uniforme, sans aucun de ces chemins ; celle de fin juge par
-- `has_table_privilege`, quel que soit le chemin.
--
-- CE QUI NE CHANGE PAS. SELECT, INSERT, UPDATE et DELETE d'`anon` et d'`authenticated`, le droit sur `cabinet_admins.role`,
-- tout ce que portent `service_role` (les Edge Functions, sous la clé secrète) et le propriétaire, l'entrée des droits par
-- défaut de `supabase_admin`, les séquences, les fonctions, les policies, les autres schémas : la garde de fin compare
-- l'empreinte de tout ce reste avant et après. Aucun chemin de l'application n'use des quatre : la restauration
-- (src/lib/sauvegardeDonnees.ts) n'écrit que par `insert` et ne lit que par `select`, sous la session du
-- super-administrateur (le rôle `authenticated`) ; les Edge Functions passent par `service_role` ; les essais impersonent
-- `anon` et `authenticated` pour du DML, et posent leurs GRANT sous le propriétaire.
--
-- CE QUI RESTE HORS DE PORTÉE (dit, pas corrigé) : le défaut de `supabase_admin` dans public, qui donne les huit aux quatre
-- rôles à une table qu'il créerait (il n'en possède aucune ; il faudrait être membre de `supabase_admin` pour le changer ;
-- le bloc HR de rls.sql attraperait une telle table) ; le schéma `net` (pg_net, à `supabase_admin`), dont deux tables
-- donnent tout à PUBLIC.
--
-- LA DÉCISION AU CABINET : (A) ces quatre droits, la recommandation ; (B) les trois de la relecture, MAINTAIN gardé — le
-- texte perdrait le mot `maintain` de ses deux instructions et de ses gardes ; (C) ne rien appliquer.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : quatre droits, à deux rôles, et leur
-- défaut — ni objet, ni donnée. Le mot `truncate` y paraît, comme droit retiré : l'outil attendrait une confirmation qui
-- n'arrive pas. Le cabinet la colle donc dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique
-- (règle de CLAUDE.md). Ni barre oblique inverse, ni retour chariot, aucune table temporaire : les deux gardes se passent
-- l'empreinte du reste par un réglage local à la transaction.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son collage, sous la version
-- que porte sa ligne d'historique (la seconde UTC du collage), texte inchangé.

-- ══ 0. La garde de tête : le propriétaire, aucun autre chemin, l'état relevé, uniforme ══════════

do $garde$
declare
  v_moi oid := (select r.oid from pg_roles r where r.rolname = current_user);
  v_relations bigint;
  v_liste text;
  v_manque bigint;
  v_reste text;
begin
  if to_regrole('anon') is null or to_regrole('authenticated') is null then
    raise exception 'Les rôles anon et authenticated n''existent pas tous deux : cette migration ne s''applique pas.';
  end if;

  -- (a) Toute relation de public appartient au rôle courant. Sinon le retrait ne vaudrait que pour les droits qu'il a donnés,
  -- et le défaut changé serait celui d'un autre rôle que le propriétaire.
  select count(*),
         string_agg(c.relname || ' (' || pg_get_userbyid(c.relowner) || ')', ', ' order by c.relname)
           filter (where c.relowner <> v_moi)
    into v_relations, v_liste
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f');
  if v_relations = 0 then
    raise exception 'Le schéma public ne porte aucune relation : rien à retirer, cette migration ne s''applique pas.';
  end if;
  if v_liste is not null then
    raise exception 'Ces relations de public n''appartiennent pas au rôle courant (%) : %. Le retrait ne vaudrait que pour les droits qu''il a donnés, et le défaut changé serait le sien : rien n''est appliqué. La migration se joue sous le propriétaire.',
      current_user, left(v_liste, 400);
  end if;

  -- (b) Rien qui survive au retrait par un autre chemin : anon et authenticated ne sont membres d'aucun rôle, et PUBLIC ne
  -- porte rien sur une relation de public ni sur une de ses colonnes.
  select string_agg(pg_get_userbyid(m.member) || ' membre de ' || pg_get_userbyid(m.roleid), ', '
                    order by pg_get_userbyid(m.member), pg_get_userbyid(m.roleid))
    into v_liste
    from pg_auth_members m
   where m.member in (to_regrole('anon'), to_regrole('authenticated'));
  if v_liste is not null then
    raise exception 'Un rôle de l''API est membre d''un autre rôle (%) : un droit hérité survivrait au retrait ; rien n''est appliqué.', v_liste;
  end if;
  select string_agg(c.relname, ', ' order by c.relname)
    into v_liste
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0)
          or exists (select 1
                       from pg_attribute att
                      cross join lateral aclexplode(att.attacl) a
                      where att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped and a.grantee = 0));
  if v_liste is not null then
    raise exception 'PUBLIC porte un droit sur ces relations de public, ou sur une de leurs colonnes : % ; il survivrait au retrait : rien n''est appliqué sans que ces droits soient relus.', left(v_liste, 400);
  end if;

  -- (c) L'état relevé, UNIFORME : chaque relation donne à anon et à authenticated chacun des quatre droits, de la main du
  -- propriétaire, non transmissible, et aucun autre donneur ne les leur donne. Absent sur une seule, la migration a passé,
  -- ou ces droits ont changé depuis : ils ne se réécrivent pas sans être relus.
  select count(*), string_agg(c.relname || ' ' || r.n || ' ' || p.p, ', ' order by c.relname, r.n, p.p)
    into v_manque, v_liste
    from pg_class c
   cross join (values ('anon'), ('authenticated')) r(n)
   cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(p)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and not exists (select 1
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                      where a.grantee = to_regrole(r.n) and a.privilege_type = p.p
                        and a.grantor = c.relowner and not a.is_grantable);
  if v_manque > 0 then
    raise exception 'L''état relevé le 06/11/2026 n''est plus celui de la base : % droit(s) manquent (%) ; cette migration a déjà passé, ou ces droits ont changé depuis, et ils ne se réécrivent pas sans être relus.',
      v_manque, left(v_liste, 400);
  end if;
  select string_agg(c.relname || ' ' || pg_get_userbyid(a.grantee) || ' ' || a.privilege_type || ' de ' || pg_get_userbyid(a.grantor), ', '
                    order by c.relname, a.privilege_type)
    into v_liste
    from pg_class c
   cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and a.grantee in (to_regrole('anon'), to_regrole('authenticated'))
     and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
     and (a.grantor <> c.relowner or a.is_grantable);
  if v_liste is not null then
    raise exception 'Un des quatre droits est donné à anon ou à authenticated par un autre que le propriétaire, ou transmissible (%) : le retrait ne l''ôterait pas ; rien n''est appliqué.', left(v_liste, 400);
  end if;

  -- (d) Aucun REFERENCES par colonne pour eux : le retrait l'ôterait avec celui de la table, et le retour ne le rendrait pas.
  select string_agg(c.relname || '.' || att.attname || ' ' || pg_get_userbyid(a.grantee), ', ' order by c.relname, att.attname)
    into v_liste
    from pg_class c
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
   cross join lateral aclexplode(att.attacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and a.grantee in (to_regrole('anon'), to_regrole('authenticated')) and a.privilege_type = 'REFERENCES';
  if v_liste is not null then
    raise exception 'Un droit REFERENCES est donné à anon ou à authenticated sur une colonne (%) : le retrait l''ôterait, et le retour ne le rendrait pas ; rien n''est appliqué sans que ces droits soient relus.', left(v_liste, 400);
  end if;

  -- (e) L'entrée des droits par défaut du rôle courant, schéma public, tables, donne les quatre à anon et à authenticated ;
  -- et aucune entrée GLOBALE du rôle courant ne leur donne un droit hors du DML, que ce texte, qui ne vise que public,
  -- laisserait.
  select count(*)
    into v_manque
    from (values ('anon'), ('authenticated')) r(n)
   cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(p)
   where not exists (select 1
                       from pg_default_acl d
                      cross join lateral aclexplode(d.defaclacl) a
                      where d.defaclrole = v_moi and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
                        and a.grantee = to_regrole(r.n) and a.privilege_type = p.p);
  if v_manque > 0 then
    raise exception 'Les droits par défaut du rôle courant (%) dans public ne donnent pas les quatre droits à anon et à authenticated (% manquent) : cette migration a déjà passé, ou ces droits ont changé depuis ; ils ne se réécrivent pas sans être relus.',
      current_user, v_manque;
  end if;
  if exists (select 1
               from pg_default_acl d
              cross join lateral aclexplode(d.defaclacl) a
              where d.defaclrole = v_moi and d.defaclnamespace = 0 and d.defaclobjtype = 'r'
                and (a.grantee = 0 or a.grantee in (to_regrole('anon'), to_regrole('authenticated')))
                and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) then
    raise exception 'Une entrée globale des droits par défaut du rôle courant donne à anon, à authenticated ou à PUBLIC un droit hors du DML : ce texte, qui ne vise que public, la laisserait ; rien n''est appliqué sans que ces droits soient relus.';
  end if;

  -- (f) L'empreinte de TOUT LE RESTE : chaque droit des relations de public, de leurs colonnes, et des entrées des droits
  -- par défaut de public et globales, de tout rôle, hors des quatre droits d'anon et d'authenticated sur les relations et
  -- dans l'entrée du rôle courant pour les tables de public. La garde de fin l'exige inchangée.
  select md5(coalesce(string_agg(l.s, ';' order by l.s collate "C"), ''))
    into v_reste
    from (
      select 'table|' || c.relname || '|' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
             || '|' || a.privilege_type || '|' || pg_get_userbyid(a.grantor) || '|' || a.is_grantable::text as s
        from pg_class c
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and not (a.grantee in (to_regrole('anon'), to_regrole('authenticated'))
                  and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'))
      union all
      select 'colonne|' || c.relname || '.' || att.attname || '|'
             || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
             || '|' || a.privilege_type || '|' || pg_get_userbyid(a.grantor) || '|' || a.is_grantable::text
        from pg_class c
        join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
       cross join lateral aclexplode(att.attacl) a
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      union all
      select 'defaut|' || pg_get_userbyid(d.defaclrole) || '|' || d.defaclobjtype::text || '|'
             || case when d.defaclnamespace = 0 then '-' else d.defaclnamespace::regnamespace::text end || '|'
             || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
             || '|' || a.privilege_type || '|' || pg_get_userbyid(a.grantor) || '|' || a.is_grantable::text
        from pg_default_acl d
       cross join lateral aclexplode(d.defaclacl) a
       where d.defaclnamespace in (0, 'public'::regnamespace)
         and not (d.defaclrole = (select r.oid from pg_roles r where r.rolname = current_user)
                  and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
                  and a.grantee in (to_regrole('anon'), to_regrole('authenticated'))
                  and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'))
    ) l;
  perform set_config('droits_hors_rls.reste', v_reste, true);
end
$garde$;

-- ══ 1. Les quatre droits, sur toutes les relations de public, puis dans le défaut du propriétaire ══════════

revoke truncate, trigger, references, maintain on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references, maintain on tables from anon, authenticated;

-- ══ 2. La garde de fin : plus rien hors du DML, par aucun chemin, et le reste intact ══════════

do $garde$
declare
  v_moi oid := (select r.oid from pg_roles r where r.rolname = current_user);
  v_liste text;
  v_manque bigint;
  v_reste text;
begin
  -- Les privilèges qu'une relation connaît hors du DML, lus au serveur (la liste de PostgreSQL 17 : les quatre retirés) :
  -- une liste écrite ici ne verrait pas celui qu'on ne connaît pas encore. Elle doit au moins compter les quatre.
  if (select count(distinct d.privilege_type) from aclexplode(acldefault('r', to_regrole('anon'))) d
       where d.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) <> 4 then
    raise exception 'Le serveur ne connaît pas les quatre droits d''une relation que ce texte retire : rien n''est appliqué.';
  end if;

  -- 1. Les relations, liste BLANCHE lue à l'ACL, tout donneur : anon, authenticated et PUBLIC n'y portent plus que SELECT,
  -- INSERT, UPDATE et DELETE — un privilège qu'on ne connaît pas s'y dirait aussi.
  select string_agg(c.relname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                    || ' ' || a.privilege_type, ', ' order by c.relname, a.privilege_type)
    into v_liste
    from pg_class c
   cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (a.grantee = 0 or a.grantee in (to_regrole('anon'), to_regrole('authenticated')))
     and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  if v_liste is not null then
    raise exception 'Après le retrait, anon, authenticated ou PUBLIC portent encore un droit hors du DML sur une relation de public (%) : rien n''est appliqué.', left(v_liste, 400);
  end if;

  -- 2. Par TOUT chemin (un donneur, PUBLIC, une appartenance) : has_table_privilege est faux pour chaque privilège hors du
  -- DML que le serveur connaît, et has_any_column_privilege pour REFERENCES sur une colonne.
  select string_agg(c.relname || ' ' || r.n || ' ' || p.privilege_type, ', ' order by c.relname, r.n, p.privilege_type)
    into v_liste
    from pg_class c
   cross join (values ('anon'), ('authenticated')) r(n)
   cross join (select distinct d.privilege_type
                 from aclexplode(acldefault('r', to_regrole('anon'))) d
                where d.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) p
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_table_privilege(r.n, c.oid, p.privilege_type);
  if v_liste is not null then
    raise exception 'Après le retrait, un rôle de l''API garde, par un chemin ou un autre, un droit hors du DML (%) : rien n''est appliqué.', left(v_liste, 400);
  end if;
  select string_agg(c.relname || ' ' || r.n, ', ' order by c.relname, r.n)
    into v_liste
    from pg_class c
   cross join (values ('anon'), ('authenticated')) r(n)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_any_column_privilege(r.n, c.oid, 'REFERENCES');
  if v_liste is not null then
    raise exception 'Après le retrait, un rôle de l''API garde REFERENCES sur une colonne (%) : rien n''est appliqué.', left(v_liste, 400);
  end if;

  -- 3. Les colonnes : anon, authenticated et PUBLIC n'y portent que SELECT, INSERT ou UPDATE.
  select string_agg(c.relname || '.' || att.attname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                    || ' ' || a.privilege_type, ', ' order by c.relname, att.attname)
    into v_liste
    from pg_class c
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
   cross join lateral aclexplode(att.attacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (a.grantee = 0 or a.grantee in (to_regrole('anon'), to_regrole('authenticated')))
     and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE');
  if v_liste is not null then
    raise exception 'Après le retrait, une colonne de public donne à anon, à authenticated ou à PUBLIC un droit hors de SELECT, INSERT et UPDATE (%) : rien n''est appliqué.', left(v_liste, 400);
  end if;

  -- 4. Le défaut du rôle courant (public et global, tables) ne leur donne plus que le DML, et leur donne toujours les quatre
  -- droits du DML dans public : une table créée demain se lit et s'écrit sous la RLS comme celles d'aujourd'hui.
  select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type, ', '
                    order by a.grantee, a.privilege_type)
    into v_liste
    from pg_default_acl d
   cross join lateral aclexplode(d.defaclacl) a
   where d.defaclrole = v_moi and d.defaclnamespace in (0, 'public'::regnamespace) and d.defaclobjtype = 'r'
     and (a.grantee = 0 or a.grantee in (to_regrole('anon'), to_regrole('authenticated')))
     and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  if v_liste is not null then
    raise exception 'Après le retrait, les droits par défaut du rôle courant donnent encore un droit hors du DML (%) : rien n''est appliqué.', v_liste;
  end if;
  select count(*)
    into v_manque
    from (values ('anon'), ('authenticated')) r(n)
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(p)
   where not exists (select 1
                       from pg_default_acl d
                      cross join lateral aclexplode(d.defaclacl) a
                      where d.defaclrole = v_moi and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
                        and a.grantee = to_regrole(r.n) and a.privilege_type = p.p);
  if v_manque > 0 then
    raise exception 'Après le retrait, les droits par défaut du rôle courant ne donnent plus le DML à anon et à authenticated (% manquent) : rien n''est appliqué.', v_manque;
  end if;

  -- 5. Le reste, inchangé : la même lecture que la garde de tête, la même empreinte.
  select md5(coalesce(string_agg(l.s, ';' order by l.s collate "C"), ''))
    into v_reste
    from (
      select 'table|' || c.relname || '|' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
             || '|' || a.privilege_type || '|' || pg_get_userbyid(a.grantor) || '|' || a.is_grantable::text as s
        from pg_class c
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and not (a.grantee in (to_regrole('anon'), to_regrole('authenticated'))
                  and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'))
      union all
      select 'colonne|' || c.relname || '.' || att.attname || '|'
             || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
             || '|' || a.privilege_type || '|' || pg_get_userbyid(a.grantor) || '|' || a.is_grantable::text
        from pg_class c
        join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
       cross join lateral aclexplode(att.attacl) a
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      union all
      select 'defaut|' || pg_get_userbyid(d.defaclrole) || '|' || d.defaclobjtype::text || '|'
             || case when d.defaclnamespace = 0 then '-' else d.defaclnamespace::regnamespace::text end || '|'
             || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
             || '|' || a.privilege_type || '|' || pg_get_userbyid(a.grantor) || '|' || a.is_grantable::text
        from pg_default_acl d
       cross join lateral aclexplode(d.defaclacl) a
       where d.defaclnamespace in (0, 'public'::regnamespace)
         and not (d.defaclrole = (select r.oid from pg_roles r where r.rolname = current_user)
                  and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
                  and a.grantee in (to_regrole('anon'), to_regrole('authenticated'))
                  and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'))
    ) l;
  if v_reste is distinct from current_setting('droits_hors_rls.reste', true) then
    raise exception 'Après le retrait, un droit autre que les quatre d''anon et d''authenticated a changé (le DML, service_role, le propriétaire, une colonne, un défaut) : rien n''est appliqué.';
  end if;
end
$garde$;
