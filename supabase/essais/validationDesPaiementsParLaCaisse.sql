-- LA VALIDATION D'UN EXERCICE DEVANT LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE (ligne 26.6 ; la migration
-- `validation_des_paiements_par_la_caisse`, PRÉPARÉE le 01/11/2026, à appliquer après `paiement_par_la_caisse` et
-- `champs_bnc_du_fec`). Le récit : HISTORIQUE.md, « LA CAISSE : LA RELECTURE DE C8 ET C9, ET SES CORRECTIONS » (le défaut 1).
-- À rejouer par `execute_sql` après toute migration qui touche `valider_exercice`, `regler_piece_par_la_caisse`,
-- `retirer_operation_caisse` ou la garde de l'écriture de caisse. Rejoué SÛR par le banc du leurre le 01/11/2026
-- (outils/leurre/banc.py, famille « apres » de `regles.json` tant que ses migrations sont préparées) → HISTORIQUE.md,
-- « LE BANC DU LEURRE SUR LES ESSAIS DU 01/11/2026 (C8, FEC22B, LE FILET) ».
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
-- Des dossiers jetables du cabinet du dossier `test` (préfixe `ca155e00-0000-4000-800c`), sous le profil de son chef, au sein
-- d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : rien ne reste. Chaque étape se joue dans sa
-- propre sous-transaction ; celle qui passe garde ce qu'elle écrit jusqu'à l'annulation finale (la suite en a besoin), celle
-- qui se refuse n'écrit rien. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.filet`), que la requête
-- finale lit : le fichier se joue d'un seul appel, ne crée ni table ni fonction et ne contient aucune instruction de
-- suppression ; toute mise à jour porte son `where`. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
-- Sans la migration (ou sans celle de C8), une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
--
-- ÉPROUVÉ LE 01/11/2026 sur la réplique de FEC22b (base `f_m` : la production de 164 migrations et `champs_bnc_du_fec`), C8
-- puis la migration appliquées comme l'outil, dans une transaction annulée ; et sur la réplique de C8 (`c8_s165`), sans elle :
-- EN ATTENTE, rien d'écrit. RÉÉCRIT LE MÊME JOUR dans la forme des essais joués en production (un bloc annulé, les verdicts
-- dans un réglage) — il était fait d'un `\set` de psql, d'une table et de deux fonctions temporaires, et d'un `rollback`
-- final, que l'outil d'exécution ne joue pas ou valide : les mêmes étapes, dans le même ordre, sous les mêmes profils, chacune
-- jugée au même code et au même motif ; ses 13 verdicts rendus à l'identique (le banc du leurre, même entrée d'HISTORIQUE.md).
do $essai$
declare
  -- La numérotation de l'application, celle que la validation reçoit : par pièce au journal AC, les opérations de caisse en OD.
  valider constant text := $v$select (public.valider_exercice('%s', 2025,
    coalesce((select jsonb_agg(jsonb_build_object('id', e.id,
        'journal', case when e.piece_id is null then 'OD' else 'AC' end, 'numero', e.numero,
        'piece_ref', coalesce(e.piece_id::text, 'Caisse du ' || to_char(e.date, 'DD/MM/YYYY')),
        'piece_date', e.date,
        'compte_lib', case e.compte when '530000' then 'Caisse' when '531000' then 'Caisse' when '108000' then 'Compte de l''exploitant' else 'Achats' end,
        'comp_aux_num', null, 'comp_aux_lib', null))
       from (select b.*, dense_rank() over (partition by b.piece_id is null
                                             order by b.date, coalesce(b.piece_id::text, b.operation_caisse_id::text))::integer as numero
               from public.ecritures_brouillon b
              where b.dossier_id = '%s' and b.date between '2025-01-01' and '2025-12-31') e), '[]'::jsonb),
    '[]'::jsonb, '{}'::jsonb) ->> 'lignes')$v$;
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  requete text;
  v_obs text;
  v_code text;
  v_msg text;
begin
  if not (exists (select 1 from pg_proc where proname = 'regler_piece_par_la_caisse' and pronamespace = 'public'::regnamespace)
          and coalesce((select prosrc like '%sans sa contrepartie entière au compte de la caisse%' from pg_proc
                         where oid = to_regprocedure('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)')), false)) then
    perform set_config('essai.filet', jsonb_build_array(jsonb_build_object('rang', 1,
      'etape', '0. EN ATTENTE des migrations paiement_par_la_caisse et validation_des_paiements_par_la_caisse', 'ok', true,
      'observe', 'paiement_par_la_caisse '
        || case when exists (select 1 from pg_proc where proname = 'regler_piece_par_la_caisse' and pronamespace = 'public'::regnamespace)
                then 'appliquée' else 'absente' end
        || ', validation_des_paiements_par_la_caisse absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  begin
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

    -- Une étape : {rang, sous le chef du cabinet du dossier `test` (sinon le propriétaire), étape, requête (ou le dossier dont
    -- la validation de 2025 se joue, par la numérotation ci-dessus), code attendu (`OK` : acceptée, et sa valeur rendue si l'on
    -- en attend une), motif LIKE}.
    for e in select * from (values
      -- L'apport de chaque dossier (100 € le 02/01/2025), écrit par la fonction de la caisse, et les paiements.
      (1, true, '1. les apports', $q$select count(*)::text from (select enregistrer_operation_caisse(d::uuid, 'apport', '2025-01-02', 100, null, null, null,
  '[{"compte":"530000","sens":"debit","montant":100},{"compte":"108000","sens":"credit","montant":100}]') from unnest(array[
  'ca155e00-0000-4000-800c-000000000001', 'ca155e00-0000-4000-800c-000000000002', 'ca155e00-0000-4000-800c-000000000003',
  'ca155e00-0000-4000-800c-000000000005', 'ca155e00-0000-4000-800c-000000000006']) d) x$q$, null::uuid, 'OK', '5'),
      (2, true, '2. les paiements par la caisse : Z 80 € le 05/01/2025, N, P et X 40 € le 12/03/2025, D 80 € le 05/01/2025, X 15 € (retiré ensuite) et 5 € le 10/01/2026', $q$select count(*)::text from (
  select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000001', 'ca155e00-0000-4000-800c-000000000011', '2025-01-05', -80)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000002', 'ca155e00-0000-4000-800c-000000000012', '2025-03-12', -40)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000003', 'ca155e00-0000-4000-800c-000000000013', '2025-03-12', -40)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000005', 'ca155e00-0000-4000-800c-000000000015', '2025-01-05', -80)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000006', 'ca155e00-0000-4000-800c-000000000016', '2025-03-12', -40)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000006', 'ca155e00-0000-4000-800c-000000000017', '2025-03-13', -15)
  union all select regler_piece_par_la_caisse('ca155e00-0000-4000-800c-000000000006', 'ca155e00-0000-4000-800c-000000000018', '2026-01-10', -5)) x$q$, null, 'OK', '7'),
      -- Les écritures des pièces, telles que l'application les génère, sous la RLS du cabinet : P en partie (30 € sur 40,
      -- équilibrée), X entière ; et, pour D, une écriture déséquilibrée de plus (une pièce validée dont la banque manque).
      (3, true, '3. les écritures des pièces, sous la RLS du cabinet', $q$
  with o as (select id, dossier_id, piece_id, date from operations_caisse where dossier_id::text like 'ca155e00-0000-4000-800c-%' and genre = 'paiement'),
  i as (insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens, statut, operation_caisse_id)
    select o.dossier_id, o.piece_id, o.date, x.compte, 'essai', x.montant, x.sens, 'proposee', case when x.caisse then o.id end
      from o join (values
        ('ca155e00-0000-4000-800c-000000000013'::uuid, '606100', 30::numeric, 'debit', false), ('ca155e00-0000-4000-800c-000000000013'::uuid, '530000', 30::numeric, 'credit', true),
        ('ca155e00-0000-4000-800c-000000000016'::uuid, '606100', 40::numeric, 'debit', false), ('ca155e00-0000-4000-800c-000000000016'::uuid, '530000', 40::numeric, 'credit', true)
      ) as x(piece, compte, montant, sens, caisse) on x.piece = o.piece_id
    returning 1)
  select count(*)::text from i$q$, null, 'OK', '4'),
      (4, true, '3b. … et l''écriture déséquilibrée de D : une charge de 12 € sans contrepartie, sur une pièce validée de son exercice', $q$
  insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, montant_ttc, date_piece) values
    ('ca155e00-0000-4000-800c-000000000019', 'ca155e00-0000-4000-800c-000000000005', 'ca155e00-0000-4000-800c-000000000005/e.pdf', 'e.pdf', 'achat', 'validee', 12, '2025-04-01');
  insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens, statut)
    values ('ca155e00-0000-4000-800c-000000000005', 'ca155e00-0000-4000-800c-000000000019', '2025-04-01', '606100', 'essai', 12, 'debit', 'proposee');
  select 'ok'$q$, null, 'OK', 'ok'),
      (5, true, '3d. le paiement de 15 € de X, retiré : sa pièce n''a jamais été écrite', $q$select (retirer_operation_caisse('ca155e00-0000-4000-800c-000000000006',
  (select id from operations_caisse where piece_id = 'ca155e00-0000-4000-800c-000000000017'))).id is not null$q$, null, 'OK', 'true'),
      (6, true, '4. Z — la pièce à valider de décembre 2024, payée par la caisse le 05/01/2025 : la validation de 2025 se refuse', null, 'ca155e00-0000-4000-800c-000000000001',
        '23514', 'L''exercice 2025 porte le paiement en espèces du 05/01/2025 d''une pièce (80,00 €) sans sa contrepartie entière au compte de la caisse : valider sa pièce et générer ses écritures, ou les régénérer, avant la validation — ou retirer ce paiement.'),
      (7, true, '4b. N — la pièce validée et payée, ses écritures pas générées : refusé', null, 'ca155e00-0000-4000-800c-000000000002',
        '23514', 'L''exercice 2025 porte le paiement en espèces du 12/03/2025 d''une pièce (40,00 €) sans sa contrepartie entière%'),
      (8, true, '4c. P — 30 € de contrepartie pour un paiement de 40 €, l''écriture équilibrée : refusé', null, 'ca155e00-0000-4000-800c-000000000003',
        '23514', 'L''exercice 2025 porte le paiement en espèces du 12/03/2025 d''une pièce (40,00 €) sans sa contrepartie entière%'),
      (9, true, '4e. D — ordre : l''écriture déséquilibrée se dit d''abord, par les mots d''hier de la numérotation', null, 'ca155e00-0000-4000-800c-000000000005',
        '22023', 'Une écriture n''est pas équilibrée au centime.'),
      (10, true, '5. X — la contrepartie entière ; un paiement retiré, un paiement de 2026 : la validation de 2025 passe (quatre lignes)', null, 'ca155e00-0000-4000-800c-000000000006',
        'OK', '4'),
      (11, false, '5b. … et la caisse reportée au 01/01/2026 est celle de ses opérations de 2025 : 60 €', $q$select string_agg(sens || ' ' || montant, ' ; ') from soldes_reportes
  where dossier_id = 'ca155e00-0000-4000-800c-000000000006' and compte = '530000'$q$, null, 'OK', 'debit 60.00'),
      (12, false, '6. le catalogue : la validation, aux droits du propriétaire, chemin fixé, exécutable par un compte connecté, ni par l''anonyme', $q$select prosecdef || ':' || coalesce(array_to_string(proconfig, ','), '-') || ':' || has_function_privilege('anon', oid, 'execute') || ':' || has_function_privilege('authenticated', oid, 'execute')
  from pg_proc where oid = to_regprocedure('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)')$q$, null, 'OK', 'true:search_path=public:false:true'),
      (13, false, '6b. … son corps dit le refus une fois, et ne l''écrit pour aucune autre fonction', $q$select string_agg(proname, ',' order by proname) from pg_proc
  where pronamespace = 'public'::regnamespace and prosrc like '%sans sa contrepartie entière au compte de la caisse%'$q$, null, 'OK', 'valider_exercice')
    ) as t(rang, sous_le_chef, etape, requete, dossier, code, attendu) order by rang loop
      requete := coalesce(e.requete, format(valider, e.dossier, e.dossier));
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      begin
        if e.sous_le_chef then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        end if;
        execute requete into v_obs;
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
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and (e.attendu = '' or v_msg like e.attendu), 'observe', v_code || ' ' || v_msg);
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;
  perform set_config('essai.filet', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.filet')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
