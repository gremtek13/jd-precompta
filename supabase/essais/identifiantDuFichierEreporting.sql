-- L'IDENTIFIANT DU FICHIER D'UNE DÉCLARATION D'E-REPORTING, ÉPROUVÉ EN BASE — à rejouer après toute migration qui touche
-- `declarer_ereporting_hors_application`, `garder_declaration_ereporting` ou la table `declarations_ereporting` (ligne 28.5,
-- étape e6b ; E6-Q8 ; migration `identifiant_du_fichier_ereporting`, PRÉPARÉE). Sans la migration, chaque contrôle se dit
-- EN ATTENTE et rien d'autre ne se joue.
--
-- Ce qui se prouve ici :
--   - LE CATALOGUE : la colonne, un UUID nullable ; sa clé unique sur (dossier, identifiant) ; la fonction à dix
--     paramètres, le dixième nul par défaut ; celle d'hier, à neuf, retirée ; l'exécution au seul rôle `authenticated` ;
--   - LES REFUS, par impersonation du chef du cabinet du dossier `test` : un identifiant déjà porté par une déclaration du
--     dossier se refuse au rang 20, avec sa raison ; un identifiant neuf, celui d'un AUTRE dossier, et l'appel d'hier — à
--     neuf paramètres, positionnels ou nommés — passent le rang 20 et s'arrêtent au contenu (rang 21) ;
--   - L'ÉCRITURE : la fonction relue du CATALOGUE (`pg_get_functiondef`), sa seule condition de date neutralisée — aucune
--     période ne se déclare avant le 2 septembre 2027 —, garde l'identifiant sur la déclaration acceptée ; une rectificative
--     qui reprend le même identifiant se refuse, une rectificative à identifiant neuf passe et chacune garde le sien ;
--   - LES GARDES SANS LA FONCTION : l'identifiant ne se modifie pas (23514) ; deux déclarations du dossier ne le partagent
--     pas, même par la porte de la restauration (23505).
-- Les dossiers, le régime et l'encaissement sont JETABLES, semés sans leurs déclencheurs (`session_replication_role`), le
-- temps du semis seulement. Tout se joue dans un bloc qui s'annule entièrement (`ANNULATION_ESSAI_GLOBALE`) : rien ne reste,
-- pas même la fonction neutralisée. Les verdicts voyagent dans un réglage LOCAL (`essai.identifiant_du_fichier`) : le fichier
-- se joue en UNE transaction (`psql -1`). Aucune instruction de suppression. Contrôles numérotés ; `fautes = 0` attendu.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  d1 uuid := 'e6b00000-0000-4000-8000-000000000001';
  d2 uuid := 'e6b00000-0000-4000-8000-000000000002';
  r1 uuid := 'e6b00000-0000-4000-8000-000000000011';
  r2 uuid := 'e6b00000-0000-4000-8000-000000000012';
  enc uuid := 'e6b00000-0000-4000-8000-000000000021';
  x uuid := 'e6b00000-0000-4000-8000-0000000000a1';
  y uuid := 'e6b00000-0000-4000-8000-0000000000a2';
  z uuid := 'e6b00000-0000-4000-8000-0000000000a3';
  w uuid := 'e6b00000-0000-4000-8000-0000000000a4';
  sig10 text := 'public.declarer_ereporting_hors_application(uuid,text,date,date,uuid,uuid,text,jsonb,text,uuid)';
  sig9 text := 'public.declarer_ereporting_hors_application(uuid,text,date,date,uuid,uuid,text,jsonb,text)';
  contenu jsonb := '{"version": 1, "objet": "paiements", "debut": "2050-10-01", "fin": "2050-10-31", "role": "SE", "paiements": [{"date": "2050-10-05", "encaissements": ["e6b00000-0000-4000-8000-000000000021"]}], "nombreOperations": 1}';
  verdicts text[] := '{}';
  etat text; msg text; def text; ligne record; premiere uuid;
  procedure_existe boolean := to_regprocedure('public.declarer_ereporting_hors_application(uuid,text,date,date,uuid,uuid,text,jsonb,text,uuid)') is not null;
begin
  if not procedure_existe then
    perform set_config('essai.identifiant_du_fichier', 'EN ATTENTE : la migration identifiant_du_fichier_ereporting n''est pas appliquée.', true);
    return;
  end if;
  begin
    -- 1 à 6. Le catalogue.
    verdicts := verdicts || format('1 colonne uuid nullable : %s', (select data_type = 'uuid' and is_nullable = 'YES' from information_schema.columns
      where table_schema = 'public' and table_name = 'declarations_ereporting' and column_name = 'identifiant_fichier'));
    verdicts := verdicts || format('2 clé unique (dossier, identifiant) : %s', (select pg_get_constraintdef(oid) = 'UNIQUE (dossier_id, identifiant_fichier)'
      from pg_constraint where conname = 'declarations_ereporting_un_fichier'));
    verdicts := verdicts || format('3 dix paramètres, le dernier nul par défaut : %s', (select pronargs = 10 and pronargdefaults = 1
      and pg_get_expr(proargdefaults, 0) = 'NULL::uuid' from pg_proc where oid = to_regprocedure(sig10)));
    verdicts := verdicts || format('4 la fonction d''hier retirée : %s', to_regprocedure(sig9) is null
      and (select count(*) = 1 from pg_proc where proname = 'declarer_ereporting_hors_application'));
    verdicts := verdicts || format('5 exécution : authenticated oui, anon et public non : %s', has_function_privilege('authenticated', sig10, 'execute')
      and not has_function_privilege('anon', sig10, 'execute')
      and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = to_regprocedure(sig10) and a.grantee = 0));
    verdicts := verdicts || format('6 security definer, search_path public : %s', (select prosecdef and proconfig = '{search_path=public}' from pg_proc where oid = to_regprocedure(sig10)));

    -- Le semis : deux dossiers jetables du cabinet de `test`, un régime chacun (paiements chaque mois), un encaissement.
    perform set_config('session_replication_role', 'replica', true);
    insert into public.dossiers (id, nom, cabinet_id, code_email) select d, 'essai e6b', cabinet_id, 'essai-e6b-' || right(d::text, 2) from public.dossiers, unnest(array[d1, d2]) d where id = dossier_test;
    insert into public.regimes_ereporting (id, dossier_id, depuis, statut_tva, tva_periodicite, tva_sur_debits, frequence_transactions, frequence_paiements)
      values (r1, d1, '2027-09-01', 'redevable', 'mensuelle', false, 'decade', 'mois'), (r2, d2, '2027-09-01', 'redevable', 'mensuelle', false, 'decade', 'mois');
    insert into public.encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen)
      values (enc, d1, gen_random_uuid(), '2050-10-05', 10, 'especes');
    perform set_config('session_replication_role', 'origin', true);
    -- X porté par une déclaration de d1 (les ventes d'une décade), Y par une de d2 : la porte de la restauration, gardes comprises.
    insert into public.declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme,
      contenu, empreinte, nb_operations, etat, identifiant_fichier)
    values (d1, 'ventes', '2050-10-01', '2050-10-10', r1, 'IN', 'manuel', 'P', '{"essai": 1}', encode(sha256(convert_to('{"essai": 1}'::jsonb::text, 'UTF8')), 'hex'), 1, 'declaree', x),
           (d2, 'ventes', '2050-10-01', '2050-10-10', r2, 'IN', 'manuel', 'P', '{"essai": 1}', encode(sha256(convert_to('{"essai": 1}'::jsonb::text, 'UTF8')), 'hex'), 1, 'declaree', y);

    -- 10 à 14. Les refus, en chef du cabinet ; chaque appel dans sa sous-transaction.
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    for ligne in select * from (values
        (10, 'X, déjà porté dans le dossier', x, 'Ce fichier est déjà celui d''une autre déclaration du dossier%'),
        (11, 'un identifiant neuf', gen_random_uuid(), 'Le contenu déclaré est à joindre%'),
        (12, 'Y, porté dans un AUTRE dossier', y, 'Le contenu déclaré est à joindre%')) v(n, quoi, ident, attendu) loop
      begin
        execute 'set local role authenticated';
        perform public.declarer_ereporting_hors_application(d1, 'paiements', '2050-10-01', '2050-10-31', r1, null, 'P', null, null, ligne.ident);
        etat := 'accepté'; msg := '';
        execute 'reset role';
      exception when others then
        get stacked diagnostics etat = returned_sqlstate, msg = message_text;
        execute 'reset role';
      end;
      verdicts := verdicts || format('%s %s : %s', ligne.n, ligne.quoi, etat = '22023' and msg like ligne.attendu);
    end loop;
    begin
      execute 'set local role authenticated';
      perform public.declarer_ereporting_hors_application(d1, 'paiements', '2050-10-01', '2050-10-31', r1, null, 'P', null, null);
      etat := 'accepté'; msg := '';
      execute 'reset role';
    exception when others then
      get stacked diagnostics etat = returned_sqlstate, msg = message_text;
      execute 'reset role';
    end;
    verdicts := verdicts || format('13 l''appel d''hier, neuf paramètres positionnels : %s', etat = '22023' and msg like 'Le contenu déclaré est à joindre%');
    begin
      execute 'set local role authenticated';
      perform public.declarer_ereporting_hors_application(p_dossier_id => d1, p_objet => 'paiements', p_debut => '2050-10-01', p_fin => '2050-10-31',
        p_regime_id => r1, p_remplace_id => null, p_plateforme => 'P', p_contenu => null, p_note => null);
      etat := 'accepté'; msg := '';
      execute 'reset role';
    exception when others then
      get stacked diagnostics etat = returned_sqlstate, msg = message_text;
      execute 'reset role';
    end;
    verdicts := verdicts || format('14 l''appel d''hier, neuf paramètres nommés : %s', etat = '22023' and msg like 'Le contenu déclaré est à joindre%');

    -- 20 à 24. L'écriture : la fonction du catalogue, sa seule condition de date neutralisée.
    def := pg_get_functiondef(to_regprocedure(sig10));
    verdicts := verdicts || format('20 une seule condition de date à neutraliser : %s', (length(def) - length(replace(def, 'if p_fin >= v_aujourd_hui then', ''))) = length('if p_fin >= v_aujourd_hui then'));
    execute replace(def, 'if p_fin >= v_aujourd_hui then', 'if false then');
    execute 'set local role authenticated';
    select id into premiere from public.declarer_ereporting_hors_application(d1, 'paiements', '2050-10-01', '2050-10-31', r1, null, 'P', contenu, null, z);
    execute 'reset role';
    verdicts := verdicts || format('21 l''initiale garde son identifiant : %s', (select d.identifiant_fichier = z and d.type_transmission = 'IN' from public.declarations_ereporting d where d.id = premiere));
    begin
      execute 'set local role authenticated';
      perform public.declarer_ereporting_hors_application(d1, 'paiements', '2050-10-01', '2050-10-31', r1, premiere, 'P', contenu, null, z);
      etat := 'accepté'; msg := '';
      execute 'reset role';
    exception when others then
      get stacked diagnostics etat = returned_sqlstate, msg = message_text;
      execute 'reset role';
    end;
    verdicts := verdicts || format('22 une rectificative qui reprend son identifiant se refuse : %s', etat = '22023' and msg like 'Ce fichier est déjà celui%');
    execute 'set local role authenticated';
    perform public.declarer_ereporting_hors_application(d1, 'paiements', '2050-10-01', '2050-10-31', r1, premiere, 'P', contenu, null, w);
    execute 'reset role';
    verdicts := verdicts || format('23 la rectificative à identifiant neuf passe, chacune garde le sien : %s', (select
      bool_and(case when d.id = premiere then d.identifiant_fichier = z and d.etat = 'remplacee'
                    else d.identifiant_fichier = w and d.etat = 'declaree' and d.type_transmission = 'RE' end)
      and count(*) = 2 from public.declarations_ereporting d where d.dossier_id = d1 and d.objet = 'paiements'));
    execute 'set local role authenticated';
    perform public.declarer_ereporting_hors_application(d2, 'ventes', '2050-10-11', '2050-10-20', r2, null, 'P', null, null);
    execute 'reset role';
    verdicts := verdicts || '24 (non joué : sans contenu, la neutralisation ne fait passer aucun appel)';
  exception when others then
    get stacked diagnostics etat = returned_sqlstate, msg = message_text;
    if msg <> 'ANNULATION_ESSAI_GLOBALE' then
      verdicts := verdicts || (format('24 l''appel sans identifiant s''arrête au contenu : %s', etat = '22023' and msg like 'Le contenu déclaré est à joindre%')
        || case when etat = '22023' and msg like 'Le contenu déclaré est à joindre%' then '' else format(' (interrompu : %s %s)', etat, msg) end);
    end if;
  end;
  -- 30 et 31. Les gardes sans la fonction, dans un second bloc annulé.
  begin
    perform set_config('session_replication_role', 'replica', true);
    insert into public.dossiers (id, nom, cabinet_id, code_email) select d1, 'essai e6b', cabinet_id, 'essai-e6b-01' from public.dossiers where id = dossier_test;
    insert into public.regimes_ereporting (id, dossier_id, depuis, statut_tva, tva_periodicite, tva_sur_debits, frequence_transactions, frequence_paiements)
      values (r1, d1, '2027-09-01', 'redevable', 'mensuelle', false, 'decade', 'mois');
    perform set_config('session_replication_role', 'origin', true);
    insert into public.declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme,
      contenu, empreinte, nb_operations, etat, identifiant_fichier)
    values (d1, 'ventes', '2050-10-01', '2050-10-10', r1, 'IN', 'manuel', 'P', '{"essai": 1}', encode(sha256(convert_to('{"essai": 1}'::jsonb::text, 'UTF8')), 'hex'), 1, 'declaree', x);
    begin
      update public.declarations_ereporting set identifiant_fichier = w where dossier_id = d1;
      etat := 'accepté';
    exception when others then
      get stacked diagnostics etat = returned_sqlstate;
    end;
    verdicts := verdicts || format('30 l''identifiant ne se modifie pas : %s', etat = '23514');
    begin
      insert into public.declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme,
        contenu, empreinte, nb_operations, etat, identifiant_fichier)
      values (d1, 'achats', '2050-11-01', '2050-11-10', r1, 'IN', 'manuel', 'P', '{"essai": 1}', encode(sha256(convert_to('{"essai": 1}'::jsonb::text, 'UTF8')), 'hex'), 1, 'declaree', x);
      etat := 'accepté';
    exception when others then
      get stacked diagnostics etat = returned_sqlstate;
    end;
    verdicts := verdicts || format('31 deux déclarations du dossier ne partagent pas un identifiant : %s', etat = '23505');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg <> 'ANNULATION_ESSAI_GLOBALE' then verdicts := verdicts || format('31 bloc des gardes interrompu : %s', msg); end if;
  end;
  perform set_config('essai.identifiant_du_fichier', array_to_string(verdicts, E'\n'), true);
end
$essai$;

select coalesce(nullif(current_setting('essai.identifiant_du_fichier', true), ''), 'AUCUN VERDICT') as verdicts;
-- Un verdict qui n'est pas exactement vrai — faux, nul (une ligne du catalogue absente), interrompu — est une faute.
select count(*) filter (where v !~ ': t$') as fautes, count(*) as controles
  from unnest(string_to_array(current_setting('essai.identifiant_du_fichier', true), E'\n')) v
 where v not like 'EN ATTENTE%';
select count(*) as reste_en_base from public.declarations_ereporting where dossier_id::text like 'e6b00000%';
