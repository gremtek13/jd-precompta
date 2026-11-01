-- LA VALIDATION D'UN EXERCICE DEVANT LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE (ligne 26.6 ; la migration
-- `validation_des_paiements_par_la_caisse`, PRÉPARÉE le 01/11/2026, à appliquer après `paiement_par_la_caisse` et
-- `champs_bnc_du_fec`). Le récit : HISTORIQUE.md, « LA CAISSE : LA RELECTURE DE C8 ET C9, ET SES CORRECTIONS » (le défaut 1).
-- Joué SUR UNE RÉPLIQUE SEULEMENT tant que le banc du leurre (outils/leurre/banc.py) ne l'a pas rejoué : ses deux migrations
-- sont préparées, et le banc, qui monte ses propres copies de la base, n'a pas tourné pour la relecture — rejoué SÛR, il se
-- jouera en production comme les autres, cette phrase retirée (et `regles.json` lui donnera la famille « apres »).
--
-- Ce qui se prouve ici, et ne se relit pas : `valider_exercice` refuse un paiement vivant de l'exercice dont la contrepartie
-- entière n'est pas au brouillon, et seulement lui —
--   - la pièce à valider, datée de l'exercice d'avant, payée dans celui-ci (le dossier Z de la relecture) : refusé, sous ses
--     mots, sa date et son montant ;
--   - la pièce validée et payée, ses écritures pas générées : refusé ;
--   - une contrepartie en partie seulement (30 € d'un paiement de 40 €, l'écriture équilibrée) : refusé ;
--   - ordre : une écriture déséquilibrée se dit d'abord (la numérotation, refus d'hier) ;
--   - la contrepartie entière : la validation passe, et la caisse reportée est la bonne ;
--   - un paiement retiré, et un paiement d'un autre exercice, ne retiennent rien ;
--   - le catalogue : le corps de la migration, aux droits d'hier.
--
-- Ce qui ne se joue pas : la contrepartie entière sur un compte qui n'est plus la caisse du plan. Le plan d'un dossier ne
-- s'écrit que dans un dossier sans écriture (`garder_plan_comptable_dossier`), et la garde du brouillon refuse une
-- contrepartie hors de la caisse du plan : la condition est défensive, pour le jour où la fonction qui réglera le plan (PC4)
-- le changera sous des écritures.
--
-- Joué en UNE transaction (`psql -1`), annulée à la fin (`rollback`) : rien ne reste. Des dossiers jetables du cabinet du
-- dossier `test` (préfixe `ca155e00-0000-4000-800c`), sous le profil de son chef. Aucune instruction de suppression ; toute
-- mise à jour porte son `where`. Sans la migration (ou sans celle de C8), une ligne dit qu'il attend (EN ATTENTE) et rien ne
-- s'écrit.
--
-- ÉPROUVÉ LE 01/11/2026 sur la réplique de FEC22b (base `f_m` : la production de 164 migrations et `champs_bnc_du_fec`), C8
-- puis la migration appliquées comme l'outil, dans une transaction annulée ; et sur la réplique de C8 (`c8_s165`), sans elle :
-- EN ATTENTE, rien d'écrit.
\set ON_ERROR_STOP off
begin;
create temporary table verdicts (rang serial, etape text, ok boolean, observe text) on commit drop;

create or replace function pg_temp.en_base() returns boolean language sql as $f$
  select exists (select 1 from pg_proc where proname = 'regler_piece_par_la_caisse' and pronamespace = 'public'::regnamespace)
     and coalesce((select prosrc like '%sans sa contrepartie entière au compte de la caisse%' from pg_proc
                    where oid = to_regprocedure('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)')), false)
$f$;

-- Une étape jouée sous le profil du chef du cabinet du dossier `test` (ou du propriétaire), son issue comparée à l'attendue :
-- `OK` (acceptée, et sa valeur rendue si l'on en attend une), ou un code et un motif LIKE.
create or replace function pg_temp.jouer(p_etape text, p_sql text, p_code text, p_attendu text, p_chef boolean default true)
returns void language plpgsql as $f$
declare
  v_obs text;
  v_code text := 'OK';
  v_msg text := '';
begin
  begin
    if p_chef then
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', 'role', 'authenticated')::text, true);
    end if;
    execute p_sql into v_obs;
    set constraints all immediate;
    set constraints all deferred;
    reset role;
    v_msg := coalesce(v_obs, '');
  exception when others then
    reset role;
    v_code := sqlstate;
    v_msg := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into verdicts (etape, ok, observe) values (p_etape,
    v_code = p_code and (p_attendu = '' or v_msg like p_attendu),
    v_code || ' ' || v_msg);
end
$f$;

do $jeu$
declare
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  d text;
begin
  if not pg_temp.en_base() then
    insert into verdicts (etape, ok, observe) values ('0. EN ATTENTE des migrations paiement_par_la_caisse et validation_des_paiements_par_la_caisse', true,
      'paiement_par_la_caisse '
      || case when exists (select 1 from pg_proc where proname = 'regler_piece_par_la_caisse' and pronamespace = 'public'::regnamespace)
              then 'appliquée' else 'absente' end
      || ', validation_des_paiements_par_la_caisse absente : rien ne s''écrit');
    return;
  end if;
  -- Cinq dossiers jetables, en trésorerie : Z (la pièce à valider), N (la pièce validée, pas écrite), P (la contrepartie en
  -- partie), D (l'ordre : une écriture déséquilibrée), X (le chemin juste, un paiement retiré, un paiement de 2026).
  insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva, ventes_par_les_factures) values
    ('ca155e00-0000-4000-800c-000000000001', 'ESSAI FILET Z', cabinet, 'tresorerie', '455000', 'exonere', false),
    ('ca155e00-0000-4000-800c-000000000002', 'ESSAI FILET N', cabinet, 'tresorerie', '455000', 'exonere', false),
    ('ca155e00-0000-4000-800c-000000000003', 'ESSAI FILET P', cabinet, 'tresorerie', '455000', 'exonere', false),
    ('ca155e00-0000-4000-800c-000000000005', 'ESSAI FILET D', cabinet, 'tresorerie', '455000', 'exonere', false),
    ('ca155e00-0000-4000-800c-000000000006', 'ESSAI FILET X', cabinet, 'tresorerie', '455000', 'exonere', false);
  insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, montant_ttc, date_piece) values
    ('ca155e00-0000-4000-800c-000000000011', 'ca155e00-0000-4000-800c-000000000001', 'ca155e00-0000-4000-800c-000000000001/z.pdf', 'z.pdf', 'achat', 'a_valider', 80, '2024-12-20'),
    ('ca155e00-0000-4000-800c-000000000012', 'ca155e00-0000-4000-800c-000000000002', 'ca155e00-0000-4000-800c-000000000002/n.pdf', 'n.pdf', 'achat', 'validee', 40, '2025-03-10'),
    ('ca155e00-0000-4000-800c-000000000013', 'ca155e00-0000-4000-800c-000000000003', 'ca155e00-0000-4000-800c-000000000003/p.pdf', 'p.pdf', 'achat', 'validee', 40, '2025-03-10'),
    ('ca155e00-0000-4000-800c-000000000015', 'ca155e00-0000-4000-800c-000000000005', 'ca155e00-0000-4000-800c-000000000005/d.pdf', 'd.pdf', 'achat', 'a_valider', 80, '2024-12-20'),
    ('ca155e00-0000-4000-800c-000000000016', 'ca155e00-0000-4000-800c-000000000006', 'ca155e00-0000-4000-800c-000000000006/x.pdf', 'x.pdf', 'achat', 'validee', 40, '2025-03-10'),
    ('ca155e00-0000-4000-800c-000000000017', 'ca155e00-0000-4000-800c-000000000006', 'ca155e00-0000-4000-800c-000000000006/r.pdf', 'r.pdf', 'achat', 'validee', 15, '2025-03-10'),
    ('ca155e00-0000-4000-800c-000000000018', 'ca155e00-0000-4000-800c-000000000006', 'ca155e00-0000-4000-800c-000000000006/f.pdf', 'f.pdf', 'achat', 'a_valider', 5, '2026-01-10');
end
$jeu$;

-- L'apport de chaque dossier (100 € le 02/01/2025), écrit par la fonction de la caisse, et les paiements.
select pg_temp.jouer('1. les apports', $q$select count(*)::text from (select enregistrer_operation_caisse(d::uuid, 'apport', '2025-01-02', 100, null, null, null,
  '[{"compte":"530000","sens":"debit","montant":100},{"compte":"108000","sens":"credit","montant":100}]') from unnest(array[
  'ca155e00-0000-4000-800c-000000000001', 'ca155e00-0000-4000-800c-000000000002', 'ca155e00-0000-4000-800c-000000000003',
  'ca155e00-0000-4000-800c-000000000005', 'ca155e00-0000-4000-800c-000000000006']) d) x$q$, 'OK', '5')
  where pg_temp.en_base();
select pg_temp.jouer('2. les paiements par la caisse : Z 80 € le 05/01/2025, N, P et X 40 € le 12/03/2025, D 80 € le 05/01/2025, X 15 € (retiré ensuite) et 5 € le 10/01/2026', $q$select count(*)::text from (
  select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000001', 'ca155e00-0000-4000-800c-000000000011', '2025-01-05', -80)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000002', 'ca155e00-0000-4000-800c-000000000012', '2025-03-12', -40)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000003', 'ca155e00-0000-4000-800c-000000000013', '2025-03-12', -40)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000005', 'ca155e00-0000-4000-800c-000000000015', '2025-01-05', -80)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000006', 'ca155e00-0000-4000-800c-000000000016', '2025-03-12', -40)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000006', 'ca155e00-0000-4000-800c-000000000017', '2025-03-13', -15)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000006', 'ca155e00-0000-4000-800c-000000000018', '2026-01-10', -5)) x$q$, 'OK', '7')
  where pg_temp.en_base();
-- Les écritures des pièces, telles que l'application les génère, sous la RLS du cabinet : P en partie (30 € sur 40, équilibrée),
-- X entière ; et, pour D, une écriture déséquilibrée de plus (une pièce validée dont la banque manque).
select pg_temp.jouer('3. les écritures des pièces, sous la RLS du cabinet', $q$
  with o as (select id, dossier_id, piece_id, date from operations_caisse where dossier_id::text like 'ca155e00-0000-4000-800c-%' and genre = 'paiement'),
  i as (insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens, statut, operation_caisse_id)
    select o.dossier_id, o.piece_id, o.date, x.compte, 'essai', x.montant, x.sens, 'proposee', case when x.caisse then o.id end
      from o join (values
        ('ca155e00-0000-4000-800c-000000000013'::uuid, '606100', 30::numeric, 'debit', false), ('ca155e00-0000-4000-800c-000000000013'::uuid, '530000', 30::numeric, 'credit', true),
        ('ca155e00-0000-4000-800c-000000000016'::uuid, '606100', 40::numeric, 'debit', false), ('ca155e00-0000-4000-800c-000000000016'::uuid, '530000', 40::numeric, 'credit', true)
      ) as x(piece, compte, montant, sens, caisse) on x.piece = o.piece_id
    returning 1)
  select count(*)::text from i$q$, 'OK', '4')
  where pg_temp.en_base();
select pg_temp.jouer('3b. … et l''écriture déséquilibrée de D : une charge de 12 € sans contrepartie, sur une pièce validée de son exercice', $q$
  insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, montant_ttc, date_piece) values
    ('ca155e00-0000-4000-800c-000000000019', 'ca155e00-0000-4000-800c-000000000005', 'ca155e00-0000-4000-800c-000000000005/e.pdf', 'e.pdf', 'achat', 'validee', 12, '2025-04-01');
  insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens, statut)
    values ('ca155e00-0000-4000-800c-000000000005', 'ca155e00-0000-4000-800c-000000000019', '2025-04-01', '606100', 'essai', 12, 'debit', 'proposee');
  select 'ok'$q$, 'OK', 'ok')
  where pg_temp.en_base();
select pg_temp.jouer('3d. le paiement de 15 € de X, retiré : sa pièce n''a jamais été écrite', $q$select (retirer_operation_caisse('ca155e00-0000-4000-800c-000000000006',
  (select id from operations_caisse where piece_id = 'ca155e00-0000-4000-800c-000000000017'))).id is not null$q$, 'OK', 'true')
  where pg_temp.en_base();

-- La numérotation de l'application, celle que la validation reçoit : par pièce au journal AC, les opérations de caisse en OD.
create or replace function pg_temp.valider(p_dossier uuid) returns text language sql as $f$
  select (public.valider_exercice(p_dossier, 2025,
    coalesce((select jsonb_agg(jsonb_build_object('id', e.id,
        'journal', case when e.piece_id is null then 'OD' else 'AC' end, 'numero', e.numero,
        'piece_ref', coalesce(e.piece_id::text, 'Caisse du ' || to_char(e.date, 'DD/MM/YYYY')),
        'piece_date', e.date,
        'compte_lib', case e.compte when '530000' then 'Caisse' when '531000' then 'Caisse' when '108000' then 'Compte de l''exploitant' else 'Achats' end,
        'comp_aux_num', null, 'comp_aux_lib', null))
       from (select b.*, dense_rank() over (partition by b.piece_id is null
                                             order by b.date, coalesce(b.piece_id::text, b.operation_caisse_id::text))::integer as numero
               from public.ecritures_brouillon b
              where b.dossier_id = p_dossier and b.date between '2025-01-01' and '2025-12-31') e), '[]'::jsonb),
    '[]'::jsonb, '{}'::jsonb) ->> 'lignes')
$f$;

select pg_temp.jouer('4. Z — la pièce à valider de décembre 2024, payée par la caisse le 05/01/2025 : la validation de 2025 se refuse', $q$select pg_temp.valider('ca155e00-0000-4000-800c-000000000001')$q$,
  '23514', 'L''exercice 2025 porte le paiement en espèces du 05/01/2025 d''une pièce (80,00 €) sans sa contrepartie entière au compte de la caisse : valider sa pièce et générer ses écritures, ou les régénérer, avant la validation — ou retirer ce paiement.')
  where pg_temp.en_base();
select pg_temp.jouer('4b. N — la pièce validée et payée, ses écritures pas générées : refusé', $q$select pg_temp.valider('ca155e00-0000-4000-800c-000000000002')$q$,
  '23514', 'L''exercice 2025 porte le paiement en espèces du 12/03/2025 d''une pièce (40,00 €) sans sa contrepartie entière%')
  where pg_temp.en_base();
select pg_temp.jouer('4c. P — 30 € de contrepartie pour un paiement de 40 €, l''écriture équilibrée : refusé', $q$select pg_temp.valider('ca155e00-0000-4000-800c-000000000003')$q$,
  '23514', 'L''exercice 2025 porte le paiement en espèces du 12/03/2025 d''une pièce (40,00 €) sans sa contrepartie entière%')
  where pg_temp.en_base();
select pg_temp.jouer('4e. D — ordre : l''écriture déséquilibrée se dit d''abord, par les mots d''hier de la numérotation', $q$select pg_temp.valider('ca155e00-0000-4000-800c-000000000005')$q$,
  '22023', 'Une écriture n''est pas équilibrée au centime.')
  where pg_temp.en_base();
select pg_temp.jouer('5. X — la contrepartie entière ; un paiement retiré, un paiement de 2026 : la validation de 2025 passe (quatre lignes)', $q$select pg_temp.valider('ca155e00-0000-4000-800c-000000000006')$q$,
  'OK', '4')
  where pg_temp.en_base();
select pg_temp.jouer('5b. … et la caisse reportée au 01/01/2026 est celle de ses opérations de 2025 : 60 €', $q$select string_agg(sens || ' ' || montant, ' ; ') from soldes_reportes
  where dossier_id = 'ca155e00-0000-4000-800c-000000000006' and compte = '530000'$q$, 'OK', 'debit 60.00', false)
  where pg_temp.en_base();
select pg_temp.jouer('6. le catalogue : la validation, aux droits du propriétaire, chemin fixé, exécutable par un compte connecté, ni par l''anonyme', $q$select prosecdef || ':' || coalesce(array_to_string(proconfig, ','), '-') || ':' || has_function_privilege('anon', oid, 'execute') || ':' || has_function_privilege('authenticated', oid, 'execute')
  from pg_proc where oid = to_regprocedure('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)')$q$, 'OK', 'true:search_path=public:false:true', false)
  where pg_temp.en_base();
select pg_temp.jouer('6b. … son corps dit le refus une fois, et ne l''écrit pour aucune autre fonction', $q$select string_agg(proname, ',' order by proname) from pg_proc
  where pronamespace = 'public'::regnamespace and prosrc like '%sans sa contrepartie entière au compte de la caisse%'$q$, 'OK', 'valider_exercice', false)
  where pg_temp.en_base();

select rang, etape, ok, observe from verdicts order by rang;
rollback;
