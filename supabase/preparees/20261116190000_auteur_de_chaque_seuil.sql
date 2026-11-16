-- CA2-Q1 — L'AUTEUR ET L'INSTANT DE CHAQUE SEUIL DE L'ALERTE DU CHIFFRE D'AFFAIRES (ligne 29.6 ; décision du cabinet du
-- 16/11/2026, contre la recommandation : « (B) Garder l'auteur et la date de chaque seuil » ; CA3-Q1 (A), le même jour : les
-- douze mois se jugent à la fin de chaque trimestre, comme en place — rien ne change ici). PRÉPARÉE le 16/11/2026, PAS
-- APPLIQUÉE. Le récit : HISTORIQUE.md, « 16/11/2026 — CA2-Q1 : L'AUTEUR DE CHAQUE SEUIL » ; l'essai :
-- supabase/essais/auteurDeChaqueSeuil.sql (EN ATTENTE sans elle) ; le retour :
-- supabase/preparees/retour/20261116190100_retour_auteur_de_chaque_seuil.sql ; le module et la carte qui la lisent :
-- src/lib/hausseDuChiffreDAffaires.ts (`AUTEUR_DE_CHAQUE_SEUIL_PREVU`, baissé jusqu'à l'application).
--
-- LE CAS. `hausse_du_chiffre_d_affaires` (en production depuis le 16/11/2026) garde, sur la ligne des seuils d'un dossier,
-- le compte et l'instant de son DERNIER réglage (`regle_par`, `regle_le`), l'un ou l'autre seuil : régler la baisse efface qui
-- avait réglé la hausse. Le cabinet veut savoir, seuil par seuil, qui l'a réglé et quand.
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. Quatre colonnes de `seuils_du_chiffre_d_affaires`, nulles par défaut, sans clé étrangère (le compte survit à son
--      retrait, comme `regle_par`) : `seuil_de_hausse_regle_par` et `seuil_de_hausse_regle_le`, `seuil_de_baisse_regle_par` et
--      `seuil_de_baisse_regle_le` — le compte et l'instant du dernier réglage de CE seuil, qu'il l'ait posé, changé ou retiré
--      (un seuil nul dont l'auteur est connu a été retiré par lui). Deux contraintes, une par seuil
--      (`seuils_du_chiffre_d_affaires_reglage_de_hausse`, `…_reglage_de_baisse`) : le compte et l'instant vont ensemble, et un
--      seuil qui a une valeur a son réglage.
--   2. LES LIGNES D'AUJOURD'HUI (la décision de cette migration). Une ligne d'avant ne dit pas lequel de ses seuils son dernier
--      réglage a touché, et rien d'autre en base ne le dit : ce dernier réglage connu (`regle_par`, `regle_le`) devient celui
--      de CHACUN de ses seuils non nuls — chacun a été réglé au plus tard à cet instant, et ce compte est le seul que la base
--      ait posé sur la ligne ; un seuil plus ancien réglé par un autre compte se lira donc sous le dernier. Un seuil NUL d'une
--      ligne d'avant reste sans réglage : rien ne dit qu'il ait jamais été posé. Aucun compte n'est inventé ni deviné : seul
--      celui que la base a posé est recopié, et `regle_par`, `regle_le` restent tels quels, le dernier réglage de la ligne. Le
--      temps de cette recopie, la garde de la table est suspendue (elle poserait le compte de la migration, qui n'en a pas),
--      le patron de `comptes_bancaires` (MCB1) ; seules ces quatre colonnes s'écrivent.
--   3. `garder_seuil_du_chiffre_d_affaires` (empreinte e3c2126c…, en production) : le compte et l'instant d'un seuil sont
--      ceux de l'écriture qui le CHANGE ; une écriture qui ne le change pas lui laisse ceux d'avant, et rien de ce qu'elle
--      y écrirait ne compte — ni l'appelant ni un paramètre ne les choisissent. Le super-administrateur, qui restaure, garde
--      ce qu'il écrit (la règle d'hier) ; un seuil qu'il écrit avec une valeur et sans réglage à lui (une sauvegarde d'avant
--      cette migration) prend le dernier réglage de la ligne : la règle du point 2. Inchangés : le refus d'un passage à un
--      autre dossier, et `regle_par`, `regle_le` posés à chaque écriture d'un autre compte.
--   4. `regler_seuil_du_chiffre_d_affaires` (empreinte d379a82e…, en production) : sous les mêmes refus, aux mêmes mots et
--      dans le même ordre, un réglage qui ne change pas le seuil n'écrit plus rien (il rend la valeur) — sinon le dernier
--      réglage de la ligne bougerait sans celui d'aucun seuil ; un réglage qui le change écrit aussi le compte et l'instant
--      de son seuil, ce que la garde refait pour tout autre compte et garde pour le super-administrateur.
--
-- CE QU'ELLE NE CHANGE PAS : aucune table neuve (ni restrictive `deux_facteurs`, ni porte : la policy du cabinet du dossier
-- couvre la ligne entière, et la garde reste aux droits de l'appelant), aucune policy, aucun droit ; ni la marque « vue avec le
-- client » (`hausses_vues_avec_le_client` garde déjà son auteur), ni la signature, les droits et le propriétaire des deux
-- fonctions (CREATE OR REPLACE les garde). La sauvegarde recopie des lignes entières (`select('*')`) : les quatre colonnes y
-- entrent d'elles-mêmes, et une sauvegarde d'avant se restaure sous la règle du point 2. Le client n'en lit rien.
--
-- SOURCES. PostgreSQL 17 : « CREATE FUNCTION » (CREATE OR REPLACE garde la fonction, son propriétaire et ses droits) ;
-- « ALTER TABLE » (ADD COLUMN sans défaut ne réécrit pas la table ; DISABLE TRIGGER ne vaut que dans la transaction qui le
-- suit d'un ENABLE) ; « CREATE TRIGGER » (dans un INSERT … ON CONFLICT DO UPDATE, la garde d'insertion puis celle de mise à
-- jour s'appliquent).
--
-- COMMENT ELLE S'APPLIQUE : aucune instruction de retrait ni de vidage, aucune barre oblique inverse, aucun retour chariot —
-- PAR L'OUTIL. Après `hausse_du_chiffre_d_affaires`, que sa garde de tête exige à l'empreinte des deux corps qu'elle remplace ;
-- indépendante des autres préparées. Le jour de son application, `AUTEUR_DE_CHAQUE_SEUIL_PREVU` se lève et le fichier entre
-- dans supabase/schema/ sous la version que porte sa ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
-- La migration ne se rejoue pas ; la table est celle de `hausse_du_chiffre_d_affaires`, ses sept colonnes et sa garde ; les deux
-- fonctions remplacées sont celles de la production, à l'empreinte de leur corps.
do $garde$
begin
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = to_regclass('public.seuils_du_chiffre_d_affaires') and not a.attisdropped
                and a.attname in ('seuil_de_hausse_regle_par', 'seuil_de_hausse_regle_le', 'seuil_de_baisse_regle_par',
                                  'seuil_de_baisse_regle_le')) then
    raise exception 'CA2-Q1 : l''auteur de chaque seuil est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if to_regclass('public.seuils_du_chiffre_d_affaires') is null
     or (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' order by a.attnum)
           from pg_catalog.pg_attribute a
          where a.attrelid = to_regclass('public.seuils_du_chiffre_d_affaires') and a.attnum > 0 and not a.attisdropped)
        is distinct from 'id:uuid:true,dossier_id:uuid:true,seuil_de_hausse:integer:false,seuil_de_baisse:integer:false,'
                      || 'regle_par:uuid:true,regle_le:timestamp with time zone:true' then
    raise exception 'CA2-Q1 : la table seuils_du_chiffre_d_affaires n''est pas celle de hausse_du_chiffre_d_affaires : relire la migration contre la base avant de l''appliquer.';
  end if;
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.garder_seuil_du_chiffre_d_affaires()'),
                       to_regprocedure('public.regler_seuil_du_chiffre_d_affaires(uuid, text, integer, integer)')))
     is distinct from 'garder_seuil_du_chiffre_d_affaires=e3c2126c9a7df6971d7017215d5d2527,'
                   || 'regler_seuil_du_chiffre_d_affaires=d379a82e5c895d9fb6669faa74290582' then
    raise exception 'CA2-Q1 : garder_seuil_du_chiffre_d_affaires ou regler_seuil_du_chiffre_d_affaires n''est plus celle de la production (hausse_du_chiffre_d_affaires) : relire la migration contre la base avant de l''appliquer.';
  end if;
  if (select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname collate "C")
        from pg_catalog.pg_trigger t
       where t.tgfoid = to_regprocedure('public.garder_seuil_du_chiffre_d_affaires()') and not t.tgisinternal)
     is distinct from 'CREATE TRIGGER seuils_du_chiffre_d_affaires_garde BEFORE INSERT OR UPDATE ON public.seuils_du_chiffre_d_affaires FOR EACH ROW EXECUTE FUNCTION garder_seuil_du_chiffre_d_affaires() O' then
    raise exception 'CA2-Q1 : la garde de seuils_du_chiffre_d_affaires n''est pas celle de hausse_du_chiffre_d_affaires : relire la migration contre la base avant de l''appliquer.';
  end if;
  if to_regprocedure('public.is_super_admin()') is null or to_regprocedure('public.admin_du_dossier(uuid)') is null then
    raise exception 'CA2-Q1 : is_super_admin() ou admin_du_dossier(uuid) manque : relire la migration contre la base avant de l''appliquer.';
  end if;
end
$garde$;

-- ══ 1. Les colonnes ══════════
alter table public.seuils_du_chiffre_d_affaires
  add column seuil_de_hausse_regle_par uuid,
  add column seuil_de_hausse_regle_le timestamptz,
  add column seuil_de_baisse_regle_par uuid,
  add column seuil_de_baisse_regle_le timestamptz;

comment on column public.seuils_du_chiffre_d_affaires.seuil_de_hausse_regle_par is
  'Le compte du dernier réglage du seuil de hausse — posé, changé ou retiré (auth.uid(), posé par la garde ; CA2-Q1), sans clé étrangère : il survit au retrait du compte. Nul : aucun réglage connu de ce seuil. Une ligne d''avant CA2-Q1 y a reçu son dernier réglage pour chaque seuil non nul.';
comment on column public.seuils_du_chiffre_d_affaires.seuil_de_hausse_regle_le is
  'L''instant du dernier réglage du seuil de hausse (posé par la garde ; CA2-Q1), avec son compte.';
comment on column public.seuils_du_chiffre_d_affaires.seuil_de_baisse_regle_par is
  'Le compte du dernier réglage du seuil de baisse — posé, changé ou retiré (auth.uid(), posé par la garde ; CA2-Q1), sans clé étrangère : il survit au retrait du compte. Nul : aucun réglage connu de ce seuil. Une ligne d''avant CA2-Q1 y a reçu son dernier réglage pour chaque seuil non nul.';
comment on column public.seuils_du_chiffre_d_affaires.seuil_de_baisse_regle_le is
  'L''instant du dernier réglage du seuil de baisse (posé par la garde ; CA2-Q1), avec son compte.';
comment on column public.seuils_du_chiffre_d_affaires.regle_par is
  'Le compte du dernier réglage de la ligne, l''un ou l''autre seuil (auth.uid(), posé par la garde), sans clé étrangère : il survit au retrait du compte. Celui de chaque seuil : seuil_de_hausse_regle_par, seuil_de_baisse_regle_par (CA2-Q1).';

-- ══ 2. Les lignes d'aujourd'hui ══════════
-- Le dernier réglage connu de la ligne devient celui de chacun de ses seuils non nuls (l'en-tête, point 2) ; la garde,
-- suspendue le temps de cette seule instruction, poserait sinon le compte de la migration, qui n'en a pas.
alter table public.seuils_du_chiffre_d_affaires disable trigger seuils_du_chiffre_d_affaires_garde;
update public.seuils_du_chiffre_d_affaires s
   set seuil_de_hausse_regle_par = case when s.seuil_de_hausse is not null then s.regle_par end,
       seuil_de_hausse_regle_le = case when s.seuil_de_hausse is not null then s.regle_le end,
       seuil_de_baisse_regle_par = case when s.seuil_de_baisse is not null then s.regle_par end,
       seuil_de_baisse_regle_le = case when s.seuil_de_baisse is not null then s.regle_le end
 where s.seuil_de_hausse is not null or s.seuil_de_baisse is not null;
alter table public.seuils_du_chiffre_d_affaires enable trigger seuils_du_chiffre_d_affaires_garde;

-- ══ 3. Les contraintes : le compte et l'instant ensemble ; un seuil qui a une valeur a son réglage ══════════
alter table public.seuils_du_chiffre_d_affaires
  add constraint seuils_du_chiffre_d_affaires_reglage_de_hausse
    check ((seuil_de_hausse_regle_par is null) = (seuil_de_hausse_regle_le is null)
           and (seuil_de_hausse is null or seuil_de_hausse_regle_par is not null)),
  add constraint seuils_du_chiffre_d_affaires_reglage_de_baisse
    check ((seuil_de_baisse_regle_par is null) = (seuil_de_baisse_regle_le is null)
           and (seuil_de_baisse is null or seuil_de_baisse_regle_par is not null));

-- ══ 4. La garde : le réglage de chaque seuil ══════════
create or replace function public.garder_seuil_du_chiffre_d_affaires() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.dossier_id is distinct from old.dossier_id then
    raise exception 'Les seuils d''un dossier ne passent pas à un autre dossier.' using errcode = '23514';
  end if;
  if not public.is_super_admin() then
    new.regle_par := auth.uid();
    new.regle_le := now();
    -- Chaque seuil : le compte et l'instant de l'écriture qui le change ; sinon ceux d'avant, jamais ce que l'écriture y met.
    if tg_op = 'INSERT' then
      new.seuil_de_hausse_regle_par := case when new.seuil_de_hausse is not null then auth.uid() end;
      new.seuil_de_hausse_regle_le := case when new.seuil_de_hausse is not null then now() end;
      new.seuil_de_baisse_regle_par := case when new.seuil_de_baisse is not null then auth.uid() end;
      new.seuil_de_baisse_regle_le := case when new.seuil_de_baisse is not null then now() end;
    else
      if new.seuil_de_hausse is distinct from old.seuil_de_hausse then
        new.seuil_de_hausse_regle_par := auth.uid();
        new.seuil_de_hausse_regle_le := now();
      else
        new.seuil_de_hausse_regle_par := old.seuil_de_hausse_regle_par;
        new.seuil_de_hausse_regle_le := old.seuil_de_hausse_regle_le;
      end if;
      if new.seuil_de_baisse is distinct from old.seuil_de_baisse then
        new.seuil_de_baisse_regle_par := auth.uid();
        new.seuil_de_baisse_regle_le := now();
      else
        new.seuil_de_baisse_regle_par := old.seuil_de_baisse_regle_par;
        new.seuil_de_baisse_regle_le := old.seuil_de_baisse_regle_le;
      end if;
    end if;
  else
    -- Le super-administrateur restaure une ligne telle qu'elle a été écrite ; un seuil qui y a une valeur sans réglage à lui
    -- (une sauvegarde d'avant CA2-Q1) prend le dernier réglage de la ligne, la règle de la migration.
    if new.seuil_de_hausse is not null and new.seuil_de_hausse_regle_par is null then
      new.seuil_de_hausse_regle_par := new.regle_par;
      new.seuil_de_hausse_regle_le := new.regle_le;
    end if;
    if new.seuil_de_baisse is not null and new.seuil_de_baisse_regle_par is null then
      new.seuil_de_baisse_regle_par := new.regle_par;
      new.seuil_de_baisse_regle_le := new.regle_le;
    end if;
  end if;
  return new;
end
$$;

comment on function public.garder_seuil_du_chiffre_d_affaires() is
  'La garde de seuils_du_chiffre_d_affaires : regle_par et regle_le sont ceux de l''écriture ; le compte et l''instant de chaque seuil, ceux de l''écriture qui le change, sinon ceux d''avant (CA2-Q1) — le super-administrateur, qui restaure, excepté, un seuil sans réglage prenant celui de la ligne ; les seuils ne passent pas à un autre dossier (23514).';

-- ══ 5. Le réglage d'un seuil ══════════
-- Le seuil d'un sens, contre la valeur LUE qu'il remplace (une ligne absente se lit nulle) ; l'autre seuil n'est ni jugé ni
-- touché ; un réglage qui ne le change pas n'écrit rien. Aux droits de l'appelant : la policy juge ; le verrou du dossier
-- sérialise deux réglages, et une valeur changée depuis sa lecture refuse le tout.
create or replace function public.regler_seuil_du_chiffre_d_affaires(p_dossier_id uuid, p_sens text, p_seuil_lu integer, p_seuil integer)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actuel integer;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Les seuils de l''alerte du chiffre d''affaires ne se règlent que par le cabinet du dossier.' using errcode = '42501';
  end if;
  if p_sens is null or p_sens not in ('hausse', 'baisse') then
    raise exception 'Un seuil se dit d''une hausse ou d''une baisse.' using errcode = '22023';
  end if;
  if p_sens = 'hausse' and p_seuil is not null and (p_seuil < 1 or p_seuil > 1000) then
    raise exception 'Le seuil de hausse se règle en pour cent entier, de 1 à 1 000, ou se laisse vide.' using errcode = '22023';
  end if;
  if p_sens = 'baisse' and p_seuil is not null and (p_seuil < 1 or p_seuil > 100) then
    raise exception 'Le seuil de baisse se règle en pour cent entier, de 1 à 100, ou se laisse vide.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('seuils_du_chiffre_d_affaires:' || p_dossier_id::text, 0));
  if p_sens = 'hausse' then
    select s.seuil_de_hausse into v_actuel from public.seuils_du_chiffre_d_affaires s where s.dossier_id = p_dossier_id;
    if v_actuel is distinct from p_seuil_lu then
      raise exception 'Le seuil de hausse a changé depuis sa lecture : relis-le avant de l''enregistrer.' using errcode = '40001';
    end if;
    if p_seuil is not distinct from v_actuel then
      return v_actuel;
    end if;
    insert into public.seuils_du_chiffre_d_affaires
        (dossier_id, seuil_de_hausse, seuil_de_hausse_regle_par, seuil_de_hausse_regle_le, regle_par, regle_le)
      values (p_dossier_id, p_seuil, auth.uid(), now(), auth.uid(), now())
      on conflict on constraint seuils_du_chiffre_d_affaires_un_par_dossier do update
        set seuil_de_hausse = excluded.seuil_de_hausse, seuil_de_hausse_regle_par = excluded.seuil_de_hausse_regle_par,
            seuil_de_hausse_regle_le = excluded.seuil_de_hausse_regle_le, regle_par = excluded.regle_par, regle_le = excluded.regle_le
      returning seuil_de_hausse into v_actuel;
  else
    select s.seuil_de_baisse into v_actuel from public.seuils_du_chiffre_d_affaires s where s.dossier_id = p_dossier_id;
    if v_actuel is distinct from p_seuil_lu then
      raise exception 'Le seuil de baisse a changé depuis sa lecture : relis-le avant de l''enregistrer.' using errcode = '40001';
    end if;
    if p_seuil is not distinct from v_actuel then
      return v_actuel;
    end if;
    insert into public.seuils_du_chiffre_d_affaires
        (dossier_id, seuil_de_baisse, seuil_de_baisse_regle_par, seuil_de_baisse_regle_le, regle_par, regle_le)
      values (p_dossier_id, p_seuil, auth.uid(), now(), auth.uid(), now())
      on conflict on constraint seuils_du_chiffre_d_affaires_un_par_dossier do update
        set seuil_de_baisse = excluded.seuil_de_baisse, seuil_de_baisse_regle_par = excluded.seuil_de_baisse_regle_par,
            seuil_de_baisse_regle_le = excluded.seuil_de_baisse_regle_le, regle_par = excluded.regle_par, regle_le = excluded.regle_le
      returning seuil_de_baisse into v_actuel;
  end if;
  return v_actuel;
end
$$;

comment on function public.regler_seuil_du_chiffre_d_affaires(uuid, text, integer, integer) is
  'Le seuil de hausse ou de baisse de l''alerte du chiffre d''affaires d''un dossier (p_sens), contre la valeur lue qu''il remplace, l''autre seuil intact ; nul : pas d''alerte dans ce sens ; inchangé, rien ne s''écrit. Le compte et l''instant du réglage, ceux de ce seuil, sont posés par la base (CA2-Q1). Aux droits de l''appelant, le cabinet du dossier seul.';

-- ══ 6. La garde de fin ══════════
do $fin$
begin
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.garder_seuil_du_chiffre_d_affaires()'),
                       to_regprocedure('public.regler_seuil_du_chiffre_d_affaires(uuid, text, integer, integer)')))
     is distinct from 'garder_seuil_du_chiffre_d_affaires=ffb47618f80cf360512c5a1b0293e746,'
                   || 'regler_seuil_du_chiffre_d_affaires=5bfc28d3c313f121f7c4d1c2432e6fd2' then
    raise exception 'CA2-Q1 : un corps n''est pas celui de cette migration : rien n''est appliqué.';
  end if;
  if (select p.prosecdef or p.provolatile <> 'v' or p.proconfig is distinct from array['search_path=public'] from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_seuil_du_chiffre_d_affaires()'))
     or (select p.prosecdef or p.provolatile <> 'v' or p.proconfig is distinct from array['search_path=public'] from pg_catalog.pg_proc p
           where p.oid = to_regprocedure('public.regler_seuil_du_chiffre_d_affaires(uuid, text, integer, integer)'))
     or has_function_privilege('anon', 'public.garder_seuil_du_chiffre_d_affaires()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_seuil_du_chiffre_d_affaires()', 'execute')
     or has_function_privilege('anon', 'public.regler_seuil_du_chiffre_d_affaires(uuid, text, integer, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.regler_seuil_du_chiffre_d_affaires(uuid, text, integer, integer)', 'execute') then
    raise exception 'CA2-Q1 : les propriétés ou les droits d''exécution ne sont pas ceux que cette migration attend : rien n''est appliqué.';
  end if;
  if (select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname collate "C")
        from pg_catalog.pg_trigger t
       where t.tgfoid = to_regprocedure('public.garder_seuil_du_chiffre_d_affaires()') and not t.tgisinternal)
     is distinct from 'CREATE TRIGGER seuils_du_chiffre_d_affaires_garde BEFORE INSERT OR UPDATE ON public.seuils_du_chiffre_d_affaires FOR EACH ROW EXECUTE FUNCTION garder_seuil_du_chiffre_d_affaires() O' then
    raise exception 'CA2-Q1 : la garde de seuils_du_chiffre_d_affaires n''est pas active telle que cette migration la laisse : rien n''est appliqué.';
  end if;
  if (select count(*) from pg_catalog.pg_constraint c
       where c.conrelid = 'public.seuils_du_chiffre_d_affaires'::regclass and c.convalidated
         and c.conname in ('seuils_du_chiffre_d_affaires_reglage_de_hausse', 'seuils_du_chiffre_d_affaires_reglage_de_baisse')) <> 2 then
    raise exception 'CA2-Q1 : les deux contraintes du réglage de chaque seuil ne sont pas validées : rien n''est appliqué.';
  end if;
end
$fin$;
