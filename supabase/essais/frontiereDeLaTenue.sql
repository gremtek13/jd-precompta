-- LA FRONTIÈRE DE LA TENUE, EN BASE (OPT6 ; la migration préparée `frontiere_de_la_tenue`,
-- supabase/preparees/20261126120000_frontiere_de_la_tenue.sql). Le récit : HISTORIQUE.md, « 26/11/2026 — OPT6 : LA
-- FRONTIÈRE DE LA TENUE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer après toute migration qui touche
-- `garder_frontiere_de_la_tenue`, `options_des_cabinets`, `regler_option_du_cabinet`, les déclencheurs ou les policies
-- d'`exercices_valides`, `situations_publiees` ou `ecritures_libres`. SANS LA MIGRATION (la garde absente du catalogue), il se
-- dit EN ATTENTE.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : la garde aux droits de son propriétaire, au chemin vide, exécutable par aucun rôle de session ; ses
--      quatre déclencheurs AFTER ROW (l'insertion des trois tables, la modification d'une écriture libre sous sa clause) ;
--   2. LA VALIDATION : un exercice validé s'insère hors de la RLS (le chemin de `valider_exercice`) quand la tenue est ouverte,
--      se refuse quand elle est fermée ou absente ; le super-administrateur (la restauration) passe ; un compte que la policy
--      refuse reçoit le refus de la RLS (42501), jamais celui de la tenue ;
--   3. LA SITUATION : publiée, refusée tenue fermée ; retirée, acceptée tenue fermée ;
--   4. L'ÉCRITURE LIBRE : insérée ou modifiée (une nouvelle version), refusée tenue fermée ; une mise à jour sans nouvelle
--      version, acceptée.
--
-- Un dossier jetable du cabinet du dossier `test` (préfixe `0b760000-0000-4000-8000`), en trésorerie, et un cabinet jetable
-- sans aucune option, avec son dossier. L'option « tenue » du
-- cabinet se pose, se ferme ou s'ôte DANS chaque étape, qui s'y ANNULE (`ANNULATION_ETAPE`) ; le jeu s'annule à la fin
-- (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit, l'option du cabinet comprise. Les verdicts voyagent dans un
-- réglage LOCAL à la transaction (`essai.frontiere_de_la_tenue`) : le fichier se joue d'un seul appel, ne crée ni table ni
-- fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de son dossier (l'option
-- du cabinet se compare à elle-même). Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  super_admin constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  da constant text := '0b760000-0000-4000-8000-0000000000d1';
  cb constant text := '0b760000-0000-4000-8000-0000000000c2';
  db constant text := '0b760000-0000-4000-8000-0000000000d2';
  sp constant text := '0b760000-0000-4000-8000-0000000000a1';
  sr constant text := '0b760000-0000-4000-8000-0000000000a2';
  el constant text := '0b760000-0000-4000-8000-0000000000e1';
  el2 constant text := '0b760000-0000-4000-8000-0000000000e2';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  option_avant text := (select coalesce(string_agg(ouverte::text || ':' || coalesce(changee_par::text, '-') || ':' || changee_le::text, ','), 'absente')
                          from options_des_cabinets where cabinet_id = (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24') and module = 'tenue');
  appliquee constant boolean := to_regprocedure('public.garder_frontiere_de_la_tenue()') is not null;
  refus constant text := 'Le module « Tenue et déclarations » n''est pas ouvert au cabinet de ce dossier : ni validation d''exercice, ni situation publiée, ni écriture libre.';
  ouvrir constant text := $q$insert into options_des_cabinets (cabinet_id, module, ouverte) values ('{CAB}', 'tenue', true) on conflict (cabinet_id, module) do update set ouverte = true;$q$;
  fermer constant text := $q$insert into options_des_cabinets (cabinet_id, module, ouverte) values ('{CAB}', 'tenue', false) on conflict (cabinet_id, module) do update set ouverte = false;$q$;
  exercice constant text := $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{DA}', 2019, now(), '{SA}', 'tresorerie', 0, 0, 0, 0, repeat('e', 64), '{}'::jsonb);$q$;
  publication constant text := $q$select set_config('jd.situations_publiees', '{SP}', true); insert into situations_publiees (id, dossier_id, annee, geste, arretee_au, statut, contenu, auteur) values ('{SP}', '{DA}', 2025, 'publication', date '2025-06-30', 'provisoire', '{}'::jsonb, '{SA}');$q$;
  retrait constant text := $q$select set_config('jd.situations_publiees', '{SR}', true); insert into situations_publiees (id, dossier_id, annee, geste, arretee_au, remplace_id, auteur) values ('{SR}', '{DA}', 2025, 'retrait', date '2025-06-30', '{SP}', '{SA}');$q$;
  libre constant text := $q$select set_config('jd.ecriture_libre', '{DA}', true); insert into ecritures_libres (id, dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par) values ('{EL}', '{DA}', 2025, 1, date '2025-03-31', 'Essai OPT6', 'Essai', '[{"compte":"606000","sens":"debit","montant":1},{"compte":"512000","sens":"credit","montant":1}]'::jsonb, '{SA}');$q$;
  libre2 constant text := $q$select set_config('jd.ecriture_libre', '{DA}', true); insert into ecritures_libres (id, dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par) values ('{EL2}', '{DA}', 2025, 2, date '2025-04-30', 'Essai OPT6 bis', 'Essai', '[{"compte":"606000","sens":"debit","montant":1},{"compte":"512000","sens":"credit","montant":1}]'::jsonb, '{SA}');$q$;
  e record; v_code text; v_msg text; v_obs text; v_sql text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.frontiere_de_la_tenue', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration frontiere_de_la_tenue (OPT6)', 'ok', true,
      'observe', 'absente : un cabinet sans la tenue valide encore, publie et écrit des écritures libres par l''API ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (da::uuid, 'ESSAI OPT6 DA', cabinet, 'tresorerie', '455000');
    -- Un cabinet jetable sans aucune option (un cabinet neuf : le socle seul, OPT-Q3 (B)), et son dossier.
    insert into cabinets (id, nom) values (cb::uuid, 'ESSAI OPT6 CB');
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (db::uuid, 'ESSAI OPT6 DB', cb::uuid, 'tresorerie', '455000');

    -- Une étape : {rang, étape, ce que le propriétaire pose d'abord, qui fait le geste (`proprio` hors de la RLS, comme une
    -- fonction `security definer` ; `super` ou `client` sous la RLS), le geste, ce qu'on relit, le code attendu et ce qu'on
    -- relit, ou les mots du refus}.
    for e in select * from (values
      (1, '1. le catalogue : la garde aux droits de son propriétaire, au chemin vide, exécutable par aucun rôle de session ; ses quatre déclencheurs AFTER ROW',
        null, 'proprio', null,
        $q$(select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.garder_frontiere_de_la_tenue()'::regprocedure)
           || ' ' || has_function_privilege('authenticated', 'public.garder_frontiere_de_la_tenue()', 'execute')
           || ' ' || has_function_privilege('anon', 'public.garder_frontiere_de_la_tenue()', 'execute')
           || ' ' || has_function_privilege('service_role', 'public.garder_frontiere_de_la_tenue()', 'execute')
           || ' ' || (select string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgtype || ':' || t.tgenabled::text, ',' order by t.tgrelid::regclass::text collate "C", t.tgname collate "C")
                        from pg_trigger t where t.tgfoid = 'public.garder_frontiere_de_la_tenue()'::regprocedure and not t.tgisinternal)$q$,
        'OK', 'true search_path="" false false false ecritures_libres:frontiere_de_la_tenue:5:O,ecritures_libres:frontiere_de_la_tenue_a_la_modification:17:O,exercices_valides:frontiere_de_la_tenue:5:O,situations_publiees:frontiere_de_la_tenue:5:O'),
      (2, '2. tenue ouverte : l''exercice validé s''insère hors de la RLS (le chemin de valider_exercice)',
        ouvrir, 'proprio', exercice, $q$(select count(*)::text from exercices_valides where dossier_id = '{DA}')$q$, 'OK', '1'),
      (3, '2b. tenue fermée : refusé', fermer, 'proprio', exercice, null, 'P0001', refus),
      (4, '2c. un cabinet sans aucune option (aucune ligne : un module fermé) : refusé', ouvrir, 'proprio', replace(exercice, '{DA}', '{DB}'), null, 'P0001', refus),
      (5, '2d. tenue fermée, le super-administrateur sous la RLS (la restauration) : accepté',
        fermer, 'super', exercice, $q$(select count(*)::text from exercices_valides where dossier_id = '{DA}')$q$, 'OK', '1'),
      (6, '2e. tenue fermée, un compte que la policy refuse : le refus de la RLS (42501), jamais celui de la tenue',
        fermer, 'client', exercice, null, '42501', 'new row violates row-level security policy for table "exercices_valides"'),
      (7, '3. tenue ouverte : la situation se publie', ouvrir, 'proprio', publication,
        $q$(select count(*)::text from situations_publiees where dossier_id = '{DA}')$q$, 'OK', '1'),
      (8, '3b. tenue fermée : la publication est refusée', fermer, 'proprio', publication, null, 'P0001', refus),
      (9, '3c. tenue fermée : la situation publiée tenue ouverte se retire',
        ouvrir || ' ' || publication || ' ' || fermer, 'proprio', retrait,
        $q$(select string_agg(geste, ',' order by geste) from situations_publiees where dossier_id = '{DA}')$q$, 'OK', 'publication,retrait'),
      (10, '4. tenue ouverte : l''écriture libre s''insère', ouvrir, 'proprio', libre,
        $q$(select count(*)::text from ecritures_libres where dossier_id = '{DA}')$q$, 'OK', '1'),
      (11, '4b. tenue fermée : l''écriture libre est refusée', fermer, 'proprio', libre, null, 'P0001', refus),
      (12, '4c. tenue fermée : une écriture libre posée tenue ouverte ne se modifie plus (une nouvelle version)',
        ouvrir || ' ' || libre || ' ' || fermer, 'proprio',
        $q$select set_config('jd.ecriture_libre', '{DA}', true); update ecritures_libres set libelle = 'Essai OPT6 modifiée', version = version + 1 where id = '{EL}';$q$,
        null, 'P0001', refus),
      (13, '4d. tenue fermée : une mise à jour sans nouvelle version passe (la clause du déclencheur)',
        ouvrir || ' ' || libre || ' ' || fermer, 'proprio',
        $q$select set_config('jd.ecriture_libre', '{DA}', true); update ecritures_libres set piece_citee_id = null where id = '{EL}';$q$,
        $q$(select version::text from ecritures_libres where id = '{EL}')$q$, 'OK', '1'),
      (14, '4e. tenue ouverte : la modification passe, et une seconde écriture aussi',
        ouvrir || ' ' || libre, 'proprio',
        $q$select set_config('jd.ecriture_libre', '{DA}', true); update ecritures_libres set version = version + 1 where id = '{EL}';$q$ || ' ' || libre2,
        $q$(select string_agg(version::text, ',' order by numero) from ecritures_libres where dossier_id = '{DA}')$q$, 'OK', '2,1')
    ) as x(rang, etape, pose, qui, geste, relecture, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        if e.pose is not null then
          execute replace(replace(replace(replace(replace(replace(replace(e.pose, '{CAB}', cabinet::text), '{DA}', da), '{SA}', super_admin), '{SP}', sp), '{SR}', sr), '{EL2}', el2), '{EL}', el);
        end if;
        v_sql := replace(replace(replace(replace(replace(replace(replace(coalesce(e.geste, 'select 1'), '{DB}', db), '{DA}', da), '{SA}', super_admin), '{SP}', sp), '{SR}', sr), '{EL2}', el2), '{EL}', el);
        begin
          if e.qui = 'super' or e.qui = 'client' then
            perform set_config('request.jwt.claims', jsonb_build_object('sub', case when e.qui = 'super' then super_admin else client end, 'role', 'authenticated')::text, true);
            execute 'set local role authenticated';
          end if;
          execute v_sql;
          reset role;
          perform set_config('request.jwt.claims', '', true);
          if e.relecture is not null then
            execute 'select ' || replace(replace(e.relecture, '{DA}', da), '{EL}', el) into v_obs;
          end if;
        exception when others then
          reset role;
          perform set_config('request.jwt.claims', '', true);
          v_code := sqlstate; v_msg := sqlerrm;
        end;
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'POSE ' || sqlstate; v_msg := sqlerrm;
        end if;
      end;
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and (case when e.code = 'OK' then v_obs is not distinct from e.attendu else v_msg = e.attendu end),
        'observe', v_code || ' ' || coalesce(v_msg, v_obs, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers et le cabinet jetables, ni leurs lignes, et l''option « tenue » du cabinet telle qu''avant',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, db::uuid))
      and not exists (select 1 from cabinets where id = cb::uuid)
      and not exists (select 1 from exercices_valides where dossier_id = da::uuid)
      and not exists (select 1 from situations_publiees where id in (sp::uuid, sr::uuid))
      and not exists (select 1 from ecritures_libres where id in (el::uuid, el2::uuid))
      and option_avant = (select coalesce(string_agg(ouverte::text || ':' || coalesce(changee_par::text, '-') || ':' || changee_le::text, ','), 'absente')
                            from options_des_cabinets where cabinet_id = cabinet and module = 'tenue'),
    'observe', 'relu');
  perform set_config('essai.frontiere_de_la_tenue', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.frontiere_de_la_tenue')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
