-- RETOUR ARRIÈRE de numerotation_continue (supabase/schema/20261110143033_numerotation_continue.sql, en production depuis
-- le 10/11/2026 ; ligne 51.5, étape A9a : la numérotation qui continue, la série
-- du mandataire). PRÉPARÉ le 10/11/2026, à ne coller que sur décision du cabinet : il DÉTRUIT — les deux tables
-- (`modeles_numerotation`, `continuite_des_series` : les modèles posés, les fins confirmées et les trous levés se
-- perdent ; les relever d'abord, `select * from modeles_numerotation` et `select * from continuite_des_series`), les
-- compteurs des séries que la numérotation d'hier ne connaît pas (`facture_numerotation`, les lignes `modele:…` : la
-- numérotation d'hier reprend du plus haut numéro émis, rien ne s'y perd), les fonctions et la garde de la migration — et
-- rend `attribuer_numero_facture`, `prochain_numero_facture` (l'export, 20260916022230 et 20261010123950, et son
-- commentaire de 20261007193006), `garder_factures_reprises` (A8a, son cinquième refus étendu compris) et les deux
-- contraintes remplacées à leur texte d'avant, vérifiés à leurs empreintes. Il se refuse tant qu'une facture validée
-- porte un numéro hors de la forme d'hier (la série du mandataire, ou un modèle posé) : la contrainte d'hier la refuserait,
-- et une facture validée ne se corrige que par un avoir — ce retour n'a plus lieu d'être une fois qu'une telle facture
-- existe. Il précède le retour d'A8a (20261107210100), qui suppose cette migration retirée.
-- À COLLER (des `drop`, une suppression) : dans l'éditeur SQL de Supabase, en UNE transaction, avec sa ligne d'historique.

do $garde$
begin
  if to_regclass('public.modeles_numerotation') is null or to_regclass('public.continuite_des_series') is null then
    raise exception 'La numérotation qui continue n''est pas en base : rien à retirer.';
  end if;
  if exists (select 1 from public.factures_emises f
              where f.statut = 'validee'
                and not (f.numero ~ '^[FA][0-9]{4}-[0-9]{4,}$'
                         and left(f.numero, 1) = case when f.type = 'avoir' then 'A' else 'F' end
                         and substr(f.numero, 2, 4) = extract(year from f.date_emission)::integer::text)) then
    raise exception 'Une facture validée porte un numéro hors de la forme d''hier (la série du mandataire, ou un modèle posé) : la contrainte d''hier la refuserait. Ce retour ne se colle plus.';
  end if;
end
$garde$;

drop trigger factures_emises_numerotation on public.factures_emises;
drop table public.continuite_des_series;
drop table public.modeles_numerotation;

-- Les compteurs des séries que la numérotation d'hier ne connaît pas : aucune facture validée n'y a de numéro (la garde
-- de tête), la numérotation d'hier reprend du plus haut numéro émis.
delete from public.facture_numerotation n where n.type not in ('facture', 'avoir');

alter table public.facture_numerotation
  drop constraint facture_numerotation_annee_du_compteur,
  drop constraint facture_numerotation_type_check,
  add constraint facture_numerotation_type_check check (type in ('facture', 'avoir'));

alter table public.factures_emises
  drop constraint factures_emises_numero_de_sa_serie,
  add constraint factures_emises_numero_de_sa_serie check (
    case when statut = 'importee'
      then char_length(numero) <= 35 and numero ~ '^[-+_/A-Za-z0-9]( ?[-+_/A-Za-z0-9])*$'
      else numero ~ '^[FA][0-9]{4}-[0-9]{4,}$'
           and left(numero, 1) = case when type = 'avoir' then 'A' else 'F' end
           and substr(numero, 2, 4) = extract(year from date_emission)::integer::text
    end);

-- `attribuer_numero_facture` et `prochain_numero_facture`, au texte de l'export (20260916022230, 20261010123950) ;
-- `create or replace` garde leurs droits (personne ne les exécute).
create or replace function public.attribuer_numero_facture(p_dossier_id uuid, p_annee integer, p_type text default 'facture')
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sequence integer;
begin
  -- Le contrôle d'accès et la validation du type vivent dans prochain_numero_facture, appelée ici.
  v_sequence := prochain_numero_facture(p_dossier_id, p_annee, p_type);
  return numero_facture_formate(p_annee, p_type, v_sequence);
end;
$$;

create or replace function public.prochain_numero_facture(p_dossier_id uuid, p_annee integer, p_type text default 'facture')
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_prefixe text;
  v_compteur integer;
  v_emis integer;
  v_numero integer;
begin
  if p_type not in ('facture', 'avoir') then
    raise exception 'Type de numérotation invalide : %', p_type using errcode = '22023';
  end if;
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  insert into facture_numerotation (dossier_id, annee, type, dernier_numero)
  values (p_dossier_id, p_annee, p_type, 0)
  on conflict (dossier_id, annee, type) do nothing;
  select n.dernier_numero into v_compteur
  from facture_numerotation n
  where n.dossier_id = p_dossier_id and n.annee = p_annee and n.type = p_type
  for update;

  v_prefixe := (case when p_type = 'avoir' then 'A' else 'F' end) || p_annee::text || '-';
  select coalesce(max(substr(f.numero, length(v_prefixe) + 1)::integer), 0) into v_emis
  from factures_emises f
  where f.dossier_id = p_dossier_id and f.numero ~ ('^' || v_prefixe || '[0-9]+$');

  v_numero := greatest(v_compteur, v_emis) + 1;
  update facture_numerotation set dernier_numero = v_numero
  where dossier_id = p_dossier_id and annee = p_annee and type = p_type;
  return v_numero;
end;
$$;

comment on function public.prochain_numero_facture(uuid, integer, text) is
  'Le numéro suivant d''une série, repris du plus haut numéro déjà émis quand le compteur manque ou retarde. Appelée par enregistrer_facture seule.';

-- La garde des factures reprises, au texte d'A8a (20261107210000) : son cinquième refus étendu, la série lue
-- `^[FA][0-9]{4}-[0-9]+$`.
create or replace function public.garder_factures_reprises() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot uuid;
  v_numero_suivi text;
  v_date_suivie date;
begin
  if tg_op = 'DELETE' then
    if old.statut = 'importee' then
      if not exists (select 1 from public.dossiers where id = old.dossier_id) then
        return old;
      end if;
      select fi.import_id into v_lot from public.factures_importees fi where fi.facture_id = old.id;
      if v_lot is null or coalesce(current_setting('jd.retrait_import', true), '') is distinct from v_lot::text then
        raise exception 'La facture % est reprise de l''ancien logiciel : elle ne se supprime que par le retrait de son import, en entier (retirer_import).',
          old.numero using errcode = '23514';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.statut = 'importee'
       and coalesce(current_setting('jd.import_facture', true), '') is distinct from new.id::text
       and not public.restauration_des_factures(new.dossier_id) then
      raise exception 'Une facture reprise ne naît que par importer_factures, qui la juge.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.statut = 'importee' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'La facture % est reprise de l''ancien logiciel : elle ne se modifie pas. Une reprise fausse se retire en entier (retirer_import), tant que rien ne s''y rattache.',
        old.numero using errcode = '23514';
    end if;
    return new;
  end if;
  if new.statut = 'importee' then
    raise exception 'Une facture ne devient pas une facture reprise : celle-ci naît par importer_factures.' using errcode = '42501';
  end if;
  -- Le cinquième refus de la validation, étendu aux importées de la même série (CGI, ann. II, art. 242 nonies A, I, 7°) :
  -- même dossier, même lettre, même année, la série jugée par le motif de l'application jusqu'à A9. La garde d'hier a jugé
  -- les validées ; le verrou de la série est tenu (`prochain_numero_facture`, et `importer_factures` le prend de même).
  if new.statut = 'validee' and old.statut = 'brouillon' then
    select f.numero, f.date_emission into v_numero_suivi, v_date_suivie
      from public.factures_emises f
     where f.dossier_id = new.dossier_id and f.statut = 'importee'
       and f.numero ~ '^[FA][0-9]{4}-[0-9]+$'
       and split_part(f.numero, '-', 1) = split_part(new.numero, '-', 1)
     order by f.date_emission desc, split_part(f.numero, '-', 2)::numeric desc
     limit 1;
    if new.date_emission < v_date_suivie then
      raise exception 'La date d''émission, le %, précède celle de % (le %), la plus récente des factures reprises de la même série : les numéros suivent l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°). Une date du % ou d''après se valide.',
        to_char(new.date_emission, 'DD/MM/YYYY'), v_numero_suivi, to_char(v_date_suivie, 'DD/MM/YYYY'),
        to_char(v_date_suivie, 'DD/MM/YYYY') using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

drop function public.etat_de_la_numerotation(uuid, integer);
drop function public.lever_trous_de_numerotation(uuid, text, text, integer, integer, integer, text);
drop function public.confirmer_fin_de_serie(uuid, text, text, integer, integer, text);
drop function public.fixer_modele_numerotation(uuid, text, text, text, boolean, integer, integer);
drop function public.garder_la_numerotation();
drop function public.numerotation_suivante(uuid, integer, text);
drop function public.jugement_de_la_serie(uuid, text, boolean, integer, integer, integer);
drop function public.serie_d_un_numero(uuid, text, integer);
drop function public.modele_en_vigueur(uuid, text, text, integer);
drop function public.garder_tables_de_numerotation();
drop function public.libelle_d_emplacement(text, text);
drop function public.libelle_de_serie(text, boolean, integer);
drop function public.cle_de_serie(text, boolean);
drop function public.modele_par_defaut(text, text);
drop function public.modeles_se_recouvrent(text, text);
drop function public.motif_du_modele(text, boolean, integer);
drop function public.numero_du_modele(text, integer, integer);
drop function public.refus_du_modele(text, boolean);

do $fin$
begin
  if (select string_agg(p.proname || '=' || md5(p.prosrc), ',' order by p.proname collate "C")
        from pg_proc p
       where p.oid in (to_regprocedure('public.attribuer_numero_facture(uuid, integer, text)'),
                       to_regprocedure('public.prochain_numero_facture(uuid, integer, text)'),
                       to_regprocedure('public.garder_factures_reprises()')))
     is distinct from 'attribuer_numero_facture=27b86edc3f6046f8f7145c6395483aac,'
                   || 'garder_factures_reprises=b9b7127e1d6aa92b565dcd6940960d1c,'
                   || 'prochain_numero_facture=44e6b35cf10d88dbe10dad1eb03a80a8' then
    raise exception 'Les fonctions rendues ne sont pas à leur texte d''avant.';
  end if;
  if (select string_agg(c.conname || '=' || md5(pg_get_constraintdef(c.oid)), ',' order by c.conname collate "C")
        from pg_constraint c
       where (c.conrelid = 'public.factures_emises'::regclass and c.conname = 'factures_emises_numero_de_sa_serie')
          or (c.conrelid = 'public.facture_numerotation'::regclass and c.conname like 'facture_numerotation_%' and c.contype = 'c'))
     is distinct from 'facture_numerotation_type_check=7b4c77d1327203aac5938a1162c89f4e,'
                   || 'factures_emises_numero_de_sa_serie=bcc820091010e5c9db6066ce63a766ba' then
    raise exception 'Les contraintes rendues ne sont pas à leur texte d''avant.';
  end if;
  if exists (select 1 from pg_trigger t where t.tgrelid = 'public.factures_emises'::regclass and t.tgname = 'factures_emises_numerotation') then
    raise exception 'Le déclencheur de la numérotation est encore en place.';
  end if;
end
$fin$;

-- Fin du retour de numerotation_continue.
