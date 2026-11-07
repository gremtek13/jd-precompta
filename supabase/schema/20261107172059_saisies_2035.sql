-- La 2035 : LES CASES QUE LA COMPTABILITÉ NE DONNE PAS, SAISIES PAR LE CABINET (étapes 2035S3 à S5 ; PRÉPARÉE le 07/11/2026,
-- pas appliquée). Le récit : HISTORIQUE.md, « 07/11/2026 — LA 2035 : LES SAISIES DU CABINET (2035S3 À S5) (PRÉPARÉE, PAS
-- APPLIQUÉE) », et la conception : « LES TROIS POINTS PLAUSIBLES DE LA RELECTURE DE LA 2035 : ÉTABLIS, ET LA CONCEPTION DE
-- LEUR CORRECTION ».
--
-- SOURCES. La notice 2035-NOT-SD 2026 (https://www.impots.gouv.fr/sites/default/files/formulaires/2035-sd/2026/
-- 2035-sd_5385.pdf), renvois (17) — « Divers à réintégrer » (CC), « détails à préciser dans une note annexe » —, (21) —
-- « Divers à déduire » (CL), « détails à préciser le cas échéant, dans une note annexe » —, (24) DE et (25) DB, les sommes
-- à réintégrer et à déduire « pour la détermination du revenu brut social », (26) sa formule. Le formulaire 2035-B-SD 2026
-- (cerfa 15945*08, public/formulaires/2035-sd-2026.pdf), ligne 43 : les douze cases « dont » de CL — CS, CT, AW, CO, CU,
-- CQ, DF, DG, CI, CJ, AX, DH —, relevées sur le PDF.
--
-- CE QUE LA MIGRATION POSE, rien d'autre (aucune destruction) :
--   1. `saisies_2035` : une ligne par dossier, exercice et case (`saisies_2035_une_par_case`, une contrainte TOTALE, que
--      l'upsert vise) ; le montant en centimes entiers, positifs ou nuls (nul : la case vidée, sans suppression) ; la note
--      annexe des seules CC et CL, que leurs renvois demandent ; DE et DB à partir de l'exercice 2025, le premier dont la
--      2035 porte le cadre 8.
--   2. La RLS : une policy `for all to authenticated` sur `admin_du_dossier(dossier_id)`, AUCUNE branche client — un
--      arbitrage du cabinet, que le client ne lit pas.
--   3. Le gel : `garder_saisie_2035_validee`, sur le patron de `garder_vehicule_valide` (la frontière de la validation,
--      sous le verrou partagé de `cle_validation`) — une saisie d'un exercice validé, ou que sa validation fige, ne s'écrit,
--      ne se modifie ni ne se retire plus (23514). Pas de porte du super-administrateur : la restauration réinsère les
--      exercices validés en dernier (« LA RESTAURATION D'UNE SAUVEGARDE N'OUVRE PLUS UN EXERCICE VALIDÉ »).
--   4. `enregistrer_saisies_2035`, aux droits de l'appelant (la RLS et le gel jugent) : les cases changées d'un exercice,
--      tout ou rien, chacune contre la valeur LUE qu'elle remplace (40001 si elle a changé depuis).
--   5. Si la migration de la double authentification (`deux_facteurs_exiges`) est déjà en base, la policy restrictive
--      `deux_facteurs` sur la table neuve, que le bloc DF de rls.sql exige d'une table créée après elle.

do $garde$
begin
  if to_regclass('public.saisies_2035') is not null then
    raise exception 'La migration saisies_2035 est déjà en base : la table existe.';
  end if;
  if to_regprocedure('public.frontiere_validation(uuid)') is null or to_regprocedure('public.cle_validation(uuid)') is null
     or to_regprocedure('public.exercice_fige(uuid, integer)') is null
     or to_regprocedure('public.retour_declencheur(text, anyelement, anyelement)') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null then
    raise exception 'Le gel de la validation n''est pas celui que suppose cette migration : la relire avant de l''appliquer.';
  end if;
end
$garde$;

create table public.saisies_2035 (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null,
  code text not null,
  centimes bigint not null,
  note_annexe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saisies_2035_annee check (annee between 2000 and 2100),
  constraint saisies_2035_code check (code in (
    'CC', 'CL', 'CS', 'CT', 'AW', 'CO', 'CU', 'CQ', 'DF', 'DG', 'CI', 'CJ', 'AX', 'DH', 'DE', 'DB')),
  constraint saisies_2035_cadre_8_depuis_2025 check (code not in ('DE', 'DB') or annee >= 2025),
  constraint saisies_2035_centimes check (centimes >= 0 and centimes <= 999999999999),
  constraint saisies_2035_note_annexe check (note_annexe is null or (
    code in ('CC', 'CL') and centimes > 0 and char_length(note_annexe) between 1 and 2000 and note_annexe = btrim(note_annexe))),
  constraint saisies_2035_une_par_case unique (dossier_id, annee, code)
);

comment on table public.saisies_2035 is
  'Les cases de la 2035 que la comptabilité ne donne pas, saisies par le cabinet (2035S3 à S5) : CC, CL et ses douze « dont », DE, et le reste de DB. Une ligne par dossier, exercice et case ; le client n''y lit rien.';
comment on column public.saisies_2035.centimes is
  'Le montant de la case, en centimes entiers ; zéro : la case vidée. DB : ce qui s''ajoute aux indemnités journalières de leur poste.';
comment on column public.saisies_2035.note_annexe is
  'Le détail que la notice demande en note annexe (renvois 17 et 21), pour CC et CL seulement. Un texte du cabinet seul.';

alter table public.saisies_2035 enable row level security;

create policy saisies_2035_cabinet on public.saisies_2035
  for all to authenticated
  using (public.admin_du_dossier(dossier_id))
  with check (public.admin_du_dossier(dossier_id));

create function public.garder_saisie_2035_validee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_derniere integer;
begin
  if tg_op <> 'INSERT' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return public.retour_declencheur(tg_op, old, new);
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_derniere := extract(year from public.frontiere_validation(old.dossier_id))::integer;
    if old.annee <= v_derniere then
      if tg_op = 'DELETE'
         or (to_jsonb(new) - array['updated_at']) is distinct from (to_jsonb(old) - array['updated_at']) then
        raise exception '% : ses saisies de la 2035 ne changent plus.', public.exercice_fige(old.dossier_id, old.annee)
          using errcode = '23514';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_derniere := extract(year from public.frontiere_validation(new.dossier_id))::integer;
  if new.annee <= v_derniere then
    raise exception '% : ses saisies de la 2035 ne changent plus.', public.exercice_fige(new.dossier_id, new.annee)
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger saisies_2035_figees_par_la_validation
  before insert or update or delete on public.saisies_2035
  for each row execute function public.garder_saisie_2035_validee();

revoke execute on function public.garder_saisie_2035_validee() from public, anon, authenticated;

-- Les cases changées d'un exercice, d'un seul tenant. `p_saisies` : { "CC": { "centimes": 120000, "note_annexe": "…" },
-- "DE": { "centimes": 0, "note_annexe": null }, … } ; `p_lues` : pour CHACUNE de ces cases, la valeur que l'écran a lue
-- (une case sans ligne se lit { "centimes": 0, "note_annexe": null }). Aux droits de l'appelant : la policy et le gel
-- jugent chaque ligne ; le verrou de l'exercice sérialise deux enregistrements, et une valeur changée depuis sa lecture
-- refuse le tout. Le contrôle d'accès vient d'abord, pour que le refus se dise sous ses mots.
create function public.enregistrer_saisies_2035(p_dossier_id uuid, p_annee integer, p_lues jsonb, p_saisies jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_code text;
  v_lue jsonb;
  v_saisie jsonb;
  v_centimes bigint;
  v_note text;
  v_n integer := 0;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Les saisies de la 2035 ne s''écrivent que par le cabinet du dossier.' using errcode = '42501';
  end if;
  if p_annee is null or jsonb_typeof(p_lues) is distinct from 'object' or jsonb_typeof(p_saisies) is distinct from 'object'
     or p_saisies = '{}'::jsonb then
    raise exception 'Les saisies de la 2035 partent mal formées : un exercice, les cases changées et leurs valeurs lues.'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('saisies_2035:' || p_dossier_id::text || ':' || p_annee::text, 0));
  for v_code in select k from jsonb_object_keys(p_saisies) k order by k collate "C" loop
    v_saisie := p_saisies -> v_code;
    v_lue := p_lues -> v_code;
    if jsonb_typeof(v_saisie) is distinct from 'object' or jsonb_typeof(v_lue) is distinct from 'object'
       or jsonb_typeof(v_saisie -> 'centimes') is distinct from 'number' or jsonb_typeof(v_lue -> 'centimes') is distinct from 'number'
       or coalesce(jsonb_typeof(v_saisie -> 'note_annexe'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_lue -> 'note_annexe'), 'null') not in ('string', 'null')
       or (v_saisie ->> 'centimes') !~ '^[0-9]+$' or (v_lue ->> 'centimes') !~ '^[0-9]+$' then
      raise exception 'La case % part mal formée : des centimes entiers et une note annexe, et la valeur lue qu''elle remplace.', v_code
        using errcode = '22023';
    end if;
    select s.centimes, s.note_annexe into v_centimes, v_note
      from public.saisies_2035 s where s.dossier_id = p_dossier_id and s.annee = p_annee and s.code = v_code;
    if coalesce(v_centimes, 0) <> (v_lue ->> 'centimes')::bigint or v_note is distinct from (v_lue ->> 'note_annexe') then
      raise exception 'La case % de l''exercice % a changé depuis sa lecture : relis les saisies avant de les enregistrer.', v_code, p_annee
        using errcode = '40001';
    end if;
    insert into public.saisies_2035 (dossier_id, annee, code, centimes, note_annexe)
      values (p_dossier_id, p_annee, v_code, (v_saisie ->> 'centimes')::bigint, v_saisie ->> 'note_annexe')
      on conflict on constraint saisies_2035_une_par_case do update
        set centimes = excluded.centimes, note_annexe = excluded.note_annexe, updated_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.enregistrer_saisies_2035(uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.enregistrer_saisies_2035(uuid, integer, jsonb, jsonb) to authenticated;

comment on function public.enregistrer_saisies_2035(uuid, integer, jsonb, jsonb) is
  'Les cases changées des saisies de la 2035 d''un exercice, tout ou rien, chacune contre la valeur lue qu''elle remplace (2035S3 à S5). Aux droits de l''appelant.';

do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.saisies_2035 as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;
