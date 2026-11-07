-- RETOUR ARRIÈRE de 20261107210000_factures_importees (ligne 51.5, étape A8a : les factures reprises de l'ancien logiciel
-- d'un client). PRÉPARÉ le 07/11/2026, à ne coller que sur décision du cabinet : il DÉTRUIT — les deux tables
-- (`imports_factures`, `factures_importees`), la colonne `dossiers.reprise_des_factures_le` (une date de reprise posée se
-- perd : la relever d'abord, `select id, reprise_des_factures_le from dossiers where reprise_des_factures_le is not null`),
-- les fonctions et les gardes de la migration — et rend les cinq contraintes de `factures_emises` et
-- `fixer_source_de_la_vente` à leur texte d'avant (l'export : 20260908120056, 20261007164932, 20261007193006,
-- 20261018201312, 20261029214359), vérifiés à leurs empreintes. Il se refuse tant qu'une facture reprise ou un lot existe :
-- les retirer d'abord (`retirer_import`), ou les relever s'ils doivent survivre. La policy `factures_emises_all` reste à
-- `authenticated` (un resserrement sans effet sur une session, qui n'appartient pas aux factures reprises) ; la rouvrir à
-- `public` serait `alter policy factures_emises_all on public.factures_emises to public;`, une policy élargie.
-- À COLLER (des `drop`) : dans l'éditeur SQL de Supabase, en UNE transaction, avec sa ligne d'historique.

do $garde$
begin
  if to_regclass('public.factures_importees') is null or to_regclass('public.imports_factures') is null then
    raise exception 'Les factures reprises ne sont pas en base : rien à retirer.';
  end if;
  if exists (select 1 from public.factures_emises f where f.statut = 'importee')
     or exists (select 1 from public.imports_factures) then
    raise exception 'Des factures reprises sont en base : ce retour les détruirait. Les retirer d''abord (retirer_import), import par import.';
  end if;
end
$garde$;

drop table public.factures_importees;
drop table public.imports_factures;
drop trigger factures_emises_figees_reprises on public.factures_emises;
drop trigger facture_lignes_figees_reprises on public.facture_lignes;
drop trigger dossiers_reprise_des_factures on public.dossiers;
drop function public.importer_factures(uuid, jsonb, jsonb);
drop function public.retirer_import(uuid, uuid);
drop function public.fixer_reprise_des_factures(uuid, date);
drop function public.garder_imports_factures();
drop function public.garder_factures_reprises();
drop function public.garder_lignes_des_factures_reprises();
drop function public.garder_reprise_des_factures();

alter table public.dossiers
  drop constraint dossiers_reprise_des_factures_premier_du_mois,
  drop column reprise_des_factures_le;

alter table public.factures_emises
  drop constraint factures_emises_reprise_entiere,
  drop constraint factures_emises_statut_check,
  add constraint factures_emises_statut_check check (statut in ('brouillon', 'validee')),
  drop constraint factures_emises_numero_de_la_validation,
  add constraint factures_emises_numero_de_la_validation check ((statut = 'validee') = (numero is not null)),
  drop constraint factures_emises_option_debits_validee,
  add constraint factures_emises_option_debits_validee check (option_debits is null or statut = 'validee'),
  drop constraint factures_emises_source_d_une_facture_validee,
  add constraint factures_emises_source_d_une_facture_validee check (not source_de_la_vente or statut = 'validee'),
  drop constraint factures_emises_numero_de_sa_serie,
  add constraint factures_emises_numero_de_sa_serie check (
    numero ~ '^[FA][0-9]{4}-[0-9]{4,}$'
    and left(numero, 1) = case when type = 'avoir' then 'A' else 'F' end
    and substr(numero, 2, 4) = extract(year from date_emission)::integer::text);

comment on column public.factures_emises.statut is null;

-- `fixer_source_de_la_vente`, au texte de l'export (20261029214359_mentions_figees).
CREATE OR REPLACE FUNCTION public.fixer_source_de_la_vente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_source boolean;
  v_frontiere date;
begin
  if tg_op = 'INSERT' and new.statut = 'validee' then
    if new.source_de_la_vente
       and not coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = new.dossier_id), false) then
      raise exception 'Une facture n''est la source de sa vente que dans un dossier dont les factures sont la source de leurs ventes.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.statut = 'validee' then
    return new;
  end if;
  if new.statut <> 'validee' then
    if new.source_de_la_vente then
      raise exception 'La source de la vente se fixe à la validation de la facture : elle ne se pose pas.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- La validation : le réglage du dossier pour une facture, la source de sa facture pour un avoir.
  if new.type = 'avoir' then
    select f.source_de_la_vente into v_source from public.factures_emises f where f.id = new.facture_origine_id;
  else
    select d.ventes_par_les_factures into v_source from public.dossiers d where d.id = new.dossier_id for share;
  end if;
  new.source_de_la_vente := coalesce(v_source, false);
  if not new.source_de_la_vente then
    return new;
  end if;
  if new.nature_operation is null then
    raise exception 'Dans un dossier dont les factures sont la source de leurs ventes, une facture dit si elle porte sur des biens ou sur des services : la nature de ses opérations est à renseigner avant sa validation.'
      using errcode = '23514';
  end if;
  if new.nature_operation = 'mixte' then
    raise exception 'Dans un dossier dont les factures sont la source de leurs ventes, une facture qui mêle biens et services ne se valide pas encore : elle se scinde en deux factures, l''une de biens, l''autre de services, tant que ses lignes ne disent pas leur nature.'
      using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_frontiere := public.frontiere_validation(new.dossier_id);
  if v_frontiere is not null and new.date_emission <= v_frontiere then
    raise exception '% : une facture source de sa vente, ou son avoir, ne s''y valide plus.',
      public.exercice_fige(new.dossier_id, extract(year from new.date_emission)::integer) using errcode = '23514';
  end if;
  return new;
end
$function$;

-- GARDE DE FIN : la base est revenue à ce que la migration a remplacé.
do $fin$
begin
  if (select string_agg(c.conname || '=' || md5(pg_get_constraintdef(c.oid)), ',' order by c.conname collate "C")
        from pg_constraint c
       where c.conrelid = 'public.factures_emises'::regclass
         and c.conname in ('factures_emises_statut_check', 'factures_emises_numero_de_la_validation',
                           'factures_emises_option_debits_validee', 'factures_emises_source_d_une_facture_validee',
                           'factures_emises_numero_de_sa_serie', 'factures_emises_reprise_entiere'))
     is distinct from 'factures_emises_numero_de_la_validation=a74198fdf684700f14d8406341cfc94f,'
                   || 'factures_emises_numero_de_sa_serie=91eca002fd98f7ac47c887240e7703b1,'
                   || 'factures_emises_option_debits_validee=5ab6bb636a13e4bbff009a4d9d784521,'
                   || 'factures_emises_source_d_une_facture_validee=71e4809079e5e165d32d9bc97761af11,'
                   || 'factures_emises_statut_check=fba8f642691e27d5c10b7a6e350b4a30' then
    raise exception 'Les contraintes de factures_emises ne sont pas revenues à leur texte d''avant.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.fixer_source_de_la_vente()'))
     is distinct from 'c7a13e4979dfbf28ffd1f2df5e748d44' then
    raise exception 'fixer_source_de_la_vente n''est pas revenue à son texte d''avant.';
  end if;
end
$fin$;
