-- RETOUR ARRIÈRE DE `auteur_de_chaque_seuil` (CA2-Q1, l'auteur et l'instant de chaque seuil de l'alerte du chiffre
-- d'affaires) — DESTRUCTIF, À ACCORDER PAR LE CABINET, À COLLER dans l'éditeur SQL de Supabase, dans une transaction, avec sa
-- ligne d'historique (le texte retire deux contraintes et quatre colonnes). La migration :
-- supabase/preparees/20261116190000_auteur_de_chaque_seuil.sql ; le récit : HISTORIQUE.md, « 16/11/2026 — CA2-Q1 : L'AUTEUR DE
-- CHAQUE SEUIL ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`AUTEUR_DE_CHAQUE_SEUIL_PREVU`, le fichier de la migration sorti de
-- l'export) et remise en ligne — levé, la carte des seuils lirait les quatre colonnes —, PUIS ce texte.
--
-- CE QU'IL REND : la base d'avant la migration (la signature de `signature.sql`) : `garder_seuil_du_chiffre_d_affaires` et
-- `regler_seuil_du_chiffre_d_affaires` au corps de `hausse_du_chiffre_d_affaires` (empreintes e3c2126c… et d379a82e…, au
-- caractère près), leurs commentaires et celui de `regle_par`.
--
-- CE QU'IL DÉTRUIT : les colonnes `seuil_de_hausse_regle_par`, `seuil_de_hausse_regle_le`, `seuil_de_baisse_regle_par` et
-- `seuil_de_baisse_regle_le` de `seuils_du_chiffre_d_affaires` — qui a réglé chaque seuil, et quand —, et leurs deux contraintes.
-- Les seuils eux-mêmes restent, avec le dernier réglage de la ligne (`regle_par`, `regle_le`), que la migration n'a jamais
-- cessé de poser. Une sauvegarde prise pendant que la migration était en base porte les quatre colonnes : elle ne se restaure
-- plus sur la base d'après ce retour sans les en retirer. Il ne retire que ce que la migration a posé : sa garde exige les deux
-- corps de la migration, à leur empreinte, et ses quatre colonnes.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration, l'essai
-- `auteurDeChaqueSeuil.sql` EN ATTENTE, `hausseDuChiffreDAffaires.sql` juste, et les trois contrôles de l'export.

-- ══ 0. La garde ══════════
do $garde$
begin
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.garder_seuil_du_chiffre_d_affaires()'),
                       to_regprocedure('public.regler_seuil_du_chiffre_d_affaires(uuid, text, integer, integer)')))
     is distinct from 'garder_seuil_du_chiffre_d_affaires=ffb47618f80cf360512c5a1b0293e746,'
                   || 'regler_seuil_du_chiffre_d_affaires=5bfc28d3c313f121f7c4d1c2432e6fd2' then
    raise exception 'retour_auteur_de_chaque_seuil : les fonctions en base ne sont pas celles que la migration pose (ou la migration n''est pas en base) ; relire avant de retirer.';
  end if;
  if (select count(*) from pg_catalog.pg_attribute a
       where a.attrelid = 'public.seuils_du_chiffre_d_affaires'::regclass and not a.attisdropped
         and a.attname in ('seuil_de_hausse_regle_par', 'seuil_de_hausse_regle_le', 'seuil_de_baisse_regle_par',
                           'seuil_de_baisse_regle_le')) <> 4 then
    raise exception 'retour_auteur_de_chaque_seuil : les quatre colonnes de la migration ne sont pas en base ; relire avant de retirer.';
  end if;
end
$garde$;

-- ══ 1. Les deux corps de hausse_du_chiffre_d_affaires (supabase/schema/20261116151848_hausse_du_chiffre_d_affaires.sql), au
-- caractère près, avant de retirer les colonnes qu'ils ne lisent plus ══════════
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
  end if;
  return new;
end
$$;

comment on function public.garder_seuil_du_chiffre_d_affaires() is
  'La garde de seuils_du_chiffre_d_affaires : regle_par et regle_le sont ceux de l''écriture (le super-administrateur, qui restaure, excepté) ; les seuils ne passent pas à un autre dossier (23514).';

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
    insert into public.seuils_du_chiffre_d_affaires (dossier_id, seuil_de_hausse, regle_par, regle_le)
      values (p_dossier_id, p_seuil, auth.uid(), now())
      on conflict on constraint seuils_du_chiffre_d_affaires_un_par_dossier do update
        set seuil_de_hausse = excluded.seuil_de_hausse, regle_par = excluded.regle_par, regle_le = excluded.regle_le
      returning seuil_de_hausse into v_actuel;
  else
    select s.seuil_de_baisse into v_actuel from public.seuils_du_chiffre_d_affaires s where s.dossier_id = p_dossier_id;
    if v_actuel is distinct from p_seuil_lu then
      raise exception 'Le seuil de baisse a changé depuis sa lecture : relis-le avant de l''enregistrer.' using errcode = '40001';
    end if;
    insert into public.seuils_du_chiffre_d_affaires (dossier_id, seuil_de_baisse, regle_par, regle_le)
      values (p_dossier_id, p_seuil, auth.uid(), now())
      on conflict on constraint seuils_du_chiffre_d_affaires_un_par_dossier do update
        set seuil_de_baisse = excluded.seuil_de_baisse, regle_par = excluded.regle_par, regle_le = excluded.regle_le
      returning seuil_de_baisse into v_actuel;
  end if;
  return v_actuel;
end
$$;

comment on function public.regler_seuil_du_chiffre_d_affaires(uuid, text, integer, integer) is
  'Le seuil de hausse ou de baisse de l''alerte du chiffre d''affaires d''un dossier (p_sens), contre la valeur lue qu''il remplace, l''autre seuil intact ; nul : pas d''alerte dans ce sens. Aux droits de l''appelant, le cabinet du dossier seul.';

comment on column public.seuils_du_chiffre_d_affaires.regle_par is
  'Le compte du dernier réglage de la ligne, l''un ou l''autre seuil (auth.uid(), posé par la garde), sans clé étrangère : il survit au retrait du compte.';

-- ══ 2. Les contraintes et les colonnes ══════════
alter table public.seuils_du_chiffre_d_affaires
  drop constraint seuils_du_chiffre_d_affaires_reglage_de_hausse,
  drop constraint seuils_du_chiffre_d_affaires_reglage_de_baisse;
alter table public.seuils_du_chiffre_d_affaires
  drop column seuil_de_hausse_regle_par,
  drop column seuil_de_hausse_regle_le,
  drop column seuil_de_baisse_regle_par,
  drop column seuil_de_baisse_regle_le;

-- ══ 3. La garde de fin ══════════
do $fin$
begin
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.garder_seuil_du_chiffre_d_affaires()'),
                       to_regprocedure('public.regler_seuil_du_chiffre_d_affaires(uuid, text, integer, integer)')))
     is distinct from 'garder_seuil_du_chiffre_d_affaires=e3c2126c9a7df6971d7017215d5d2527,'
                   || 'regler_seuil_du_chiffre_d_affaires=d379a82e5c895d9fb6669faa74290582'
     or exists (select 1 from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.seuils_du_chiffre_d_affaires'::regclass and not a.attisdropped
                   and a.attname like 'seuil_de_%_regle_%')
     or (select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname collate "C")
           from pg_catalog.pg_trigger t
          where t.tgfoid = to_regprocedure('public.garder_seuil_du_chiffre_d_affaires()') and not t.tgisinternal)
        is distinct from 'CREATE TRIGGER seuils_du_chiffre_d_affaires_garde BEFORE INSERT OR UPDATE ON public.seuils_du_chiffre_d_affaires FOR EACH ROW EXECUTE FUNCTION garder_seuil_du_chiffre_d_affaires() O' then
    raise exception 'retour_auteur_de_chaque_seuil : une colonne de la migration est encore en base, ou les deux fonctions n''ont pas retrouvé le corps de hausse_du_chiffre_d_affaires.';
  end if;
end
$fin$;
