-- RETOUR ARRIÈRE DE `droits_hors_rls` (relecture de sécurité du 06/11/2026) — UN ÉLARGISSEMENT, À ACCORDER PAR LE CABINET,
-- À COLLER dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique (`retour_droits_hors_rls`) : le
-- texte rend des droits, dont le mot `truncate`, et `apply_migration` attendrait une confirmation qui n'arrive pas. La
-- migration : supabase/preparees/20261106180000_droits_hors_rls.sql.
--
-- CE QU'IL REND : à `anon` et à `authenticated`, TRUNCATE, TRIGGER, REFERENCES et MAINTAIN sur toutes les relations de
-- public, donnés par le propriétaire, non transmissibles, et dans les droits par défaut du propriétaire pour les tables de
-- public — l'état relevé le 06/11/2026. Une table créée APRÈS la migration les reçoit aussi : le défaut d'avant les lui
-- aurait donnés. Rien d'autre : la garde de fin compare l'empreinte de tout le reste (le DML, `service_role`, le
-- propriétaire, les colonnes, les autres entrées des droits par défaut) avant et après.
--
-- CE QU'IL NE REND PAS : un REFERENCES par colonne — la migration a refusé de passer s'il en existait un.
--
-- Comme la migration, il se joue sous le PROPRIÉTAIRE des relations (`postgres` en production, `proprietaire` sur une
-- réplique) : `grant … on all tables` mené par un autre rôle donnerait sous son nom, et le défaut rendu serait le sien. Ni
-- barre oblique inverse, ni retour chariot. Après lui : le bloc HR de `rls.sql` EN ATTENTE (sa ligne d'historique, plus
-- récente que celle de la migration, et l'état d'avant), `droitsHorsRls.sql` EN FAUTE sur une réplique (chaque geste
-- passe), et les trois contrôles de l'export, le fichier de la migration sorti de l'export.

-- ══ 0. La garde de tête : le propriétaire, aucun autre chemin, l'état d'après la migration ══════════

do $garde$
declare
  v_moi oid := (select r.oid from pg_roles r where r.rolname = current_user);
  v_relations bigint;
  v_liste text;
  v_manque bigint;
  v_reste text;
begin
  if to_regrole('anon') is null or to_regrole('authenticated') is null then
    raise exception 'Les rôles anon et authenticated n''existent pas tous deux : ce retour ne s''applique pas.';
  end if;

  -- (a) Toute relation de public appartient au rôle courant.
  select count(*),
         string_agg(c.relname || ' (' || pg_get_userbyid(c.relowner) || ')', ', ' order by c.relname)
           filter (where c.relowner <> v_moi)
    into v_relations, v_liste
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f');
  if v_relations = 0 then
    raise exception 'Le schéma public ne porte aucune relation : rien à rendre, ce retour ne s''applique pas.';
  end if;
  if v_liste is not null then
    raise exception 'Ces relations de public n''appartiennent pas au rôle courant (%) : %. Les droits rendus le seraient sous un autre nom, et le défaut rendu serait le sien : rien n''est appliqué. Le retour se joue sous le propriétaire.',
      current_user, left(v_liste, 400);
  end if;

  -- (b) Aucun autre chemin : anon et authenticated ne sont membres d'aucun rôle, PUBLIC ne porte rien sur public.
  select string_agg(pg_get_userbyid(m.member) || ' membre de ' || pg_get_userbyid(m.roleid), ', '
                    order by pg_get_userbyid(m.member), pg_get_userbyid(m.roleid))
    into v_liste
    from pg_auth_members m
   where m.member in (to_regrole('anon'), to_regrole('authenticated'));
  if v_liste is not null then
    raise exception 'Un rôle de l''API est membre d''un autre rôle (%) : ses droits ne sont plus ceux que la migration a laissés ; relire la base avant ce retour.', v_liste;
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
    raise exception 'PUBLIC porte un droit sur ces relations de public, ou sur une de leurs colonnes : % ; relire la base avant ce retour.', left(v_liste, 400);
  end if;

  -- (c) L'état d'après la migration : aucune relation ne donne à anon, à authenticated ni à PUBLIC un droit hors du DML,
  -- par aucun chemin, ni REFERENCES sur une colonne. Sinon la migration n'est pas en base (ou ce retour est déjà fait), ou
  -- ces droits ont changé depuis.
  select string_agg(c.relname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                    || ' ' || a.privilege_type, ', ' order by c.relname, a.privilege_type)
    into v_liste
    from pg_class c
   cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (a.grantee = 0 or a.grantee in (to_regrole('anon'), to_regrole('authenticated')))
     and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  if v_liste is null then
    select string_agg(c.relname || ' ' || r.n, ', ' order by c.relname, r.n)
      into v_liste
      from pg_class c
     cross join (values ('anon'), ('authenticated')) r(n)
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and (has_table_privilege(r.n, c.oid, 'TRUNCATE') or has_table_privilege(r.n, c.oid, 'REFERENCES')
            or has_table_privilege(r.n, c.oid, 'TRIGGER') or has_table_privilege(r.n, c.oid, 'MAINTAIN')
            or has_any_column_privilege(r.n, c.oid, 'REFERENCES'));
  end if;
  if v_liste is not null then
    raise exception 'Un rôle de l''API porte déjà un droit hors du DML sur une relation de public (%) : la migration droits_hors_rls n''est pas en base, ou ce retour est déjà fait, ou ces droits ont changé depuis ; rien n''est appliqué.', left(v_liste, 400);
  end if;

  -- (d) Le défaut du rôle courant (public et global, tables) ne leur donne que le DML, et leur donne les quatre droits du
  -- DML dans public.
  if exists (select 1
               from pg_default_acl d
              cross join lateral aclexplode(d.defaclacl) a
              where d.defaclrole = v_moi and d.defaclnamespace in (0, 'public'::regnamespace) and d.defaclobjtype = 'r'
                and (a.grantee = 0 or a.grantee in (to_regrole('anon'), to_regrole('authenticated')))
                and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) then
    raise exception 'Les droits par défaut du rôle courant donnent déjà un droit hors du DML à anon, à authenticated ou à PUBLIC : la migration n''est pas en base, ou ce retour est déjà fait ; rien n''est appliqué.';
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
    raise exception 'Les droits par défaut du rôle courant (%) dans public ne donnent plus le DML à anon et à authenticated (% manquent) : ils ont changé depuis la migration ; relire la base avant ce retour.', current_user, v_manque;
  end if;

  -- (e) L'empreinte de tout le reste, la même lecture que la migration ; la garde de fin l'exige inchangée.
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
  perform set_config('retour_droits_hors_rls.reste', v_reste, true);
end
$garde$;

-- ══ 1. Les quatre droits rendus, sur toutes les relations de public, puis dans le défaut du propriétaire ══════════

grant truncate, trigger, references, maintain on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant truncate, trigger, references, maintain on tables to anon, authenticated;

-- ══ 2. La garde de fin : l'état relevé le 06/11/2026, uniforme, et le reste intact ══════════

do $garde$
declare
  v_moi oid := (select r.oid from pg_roles r where r.rolname = current_user);
  v_manque bigint;
  v_liste text;
  v_reste text;
begin
  -- Chaque relation donne à anon et à authenticated chacun des quatre droits, de la main du propriétaire, non transmissible.
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
    raise exception 'Après le retour, % droit(s) manquent encore (%) : rien n''est appliqué.', v_manque, left(v_liste, 400);
  end if;

  -- Le défaut du rôle courant, dans public, leur donne de nouveau les quatre.
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
    raise exception 'Après le retour, les droits par défaut du rôle courant ne leur donnent pas les quatre droits (% manquent) : rien n''est appliqué.', v_manque;
  end if;

  -- Le reste, inchangé : la même lecture, la même empreinte.
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
  if v_reste is distinct from current_setting('retour_droits_hors_rls.reste', true) then
    raise exception 'Après le retour, un droit autre que les quatre d''anon et d''authenticated a changé : rien n''est appliqué.';
  end if;
end
$garde$;
