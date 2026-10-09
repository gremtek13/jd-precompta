-- LE RETRAIT D'UN PAIEMENT DEPUIS LE COMPTE PERSONNEL, ÉPROUVÉ EN BASE — à rejouer par `execute_sql` après toute
-- migration qui touche `retirer_paiement_personnel_cotisation` (migration `retrait_du_paiement_personnel`, que le
-- cabinet colle : son texte supprime des lignes du brouillon), les déclencheurs du paiement personnel ou
-- `garder_cotisation_valide` (ligne 26.6 de la feuille de route). La déclaration du paiement a son essai,
-- `cotisationPersonnelle.sql`.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI retire : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien et un client — sur le dossier d'un
--     autre comme sur le SIEN — se font refuser l'accès au dossier ; le chef du cabinet retire (le contrôle POSITIF) ;
--   - CE QUE LE RETRAIT DÉFAIT, d'un seul tenant : l'écriture du paiement quitte le brouillon et la date quitte
--     l'échéance ; les montants de l'échéance redeviennent libres, un mouvement peut de nouveau la payer, et un
--     paiement se déclare de nouveau ;
--   - CE QUI SE REFUSE, avec sa RAISON, dans l'ordre de la fonction : l'échéance d'un autre dossier ; une échéance sans
--     paiement personnel ; un paiement qui tombe dans un exercice validé ; une échéance qui, sans lui, y compterait ;
--   - CE QUE LE CATALOGUE DIT : les droits d'exécution ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Le moteur d'étapes de validationExercice.sql et de cotisationPersonnelle.sql, ses quatre genres et ses dossiers
-- JETABLES du cabinet du dossier `test` (préfixe `e55c0701`), dans un bloc qui s'annule entièrement à la fin. Les
-- verdicts voyagent dans un réglage LOCAL à la transaction (`essai.retrait_paiement_personnel`) : hors de l'outil
-- d'exécution, le fichier se joue en UNE transaction (`psql -1`). Aucune instruction de suppression.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier_client uuid; cabinet uuid;
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text;
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or cabinet is null or dossier_client = dossier_test
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or extract(year from (now() at time zone 'Europe/Paris'))::int <> 2026 then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable (ou l''année n''est plus 2026 : les dates de l''essai sont à avancer)';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client)
    || jsonb_build_object(
      'T', 'e55c0701-0000-4000-8000-0000000000a1', 'E', 'e55c0701-0000-4000-8000-0000000000a2',
      'V', 'e55c0701-0000-4000-8000-0000000000a3')
    || jsonb_build_object(
      'C1', 'e55c0701-0000-4000-8001-000000000001', 'C3', 'e55c0701-0000-4000-8001-000000000003',
      'CN', 'e55c0701-0000-4000-8001-00000000000a', 'CC', 'e55c0701-0000-4000-8001-00000000000e',
      'CE', 'e55c0701-0000-4000-8002-000000000001', 'CV1', 'e55c0701-0000-4000-8002-000000000011',
      'CV4', 'e55c0701-0000-4000-8002-000000000014', 'CV5', 'e55c0701-0000-4000-8002-000000000015',
      'MX', 'e55c0701-0000-4000-8003-000000000002');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from cotisations_declarees)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from lignes_bancaires)), ((select count(*) from exercices_valides)), ((select count(*) from soldes_reportes)),
    ((select count(*) from cotisations_declarees where paiement_personnel_le is not null))
  ) as t(n);

  etapes := array[
    -- ══ Le jeu : trois dossiers jetables, des échéances, et leurs paiements personnels déclarés par la fonction ══════════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('{T}', 'ESSAI RETRAIT PAIEMENT T', '{CAB}', 'tresorerie', '455000'), ('{E}', 'ESSAI RETRAIT PAIEMENT E', '{CAB}', 'engagement', '467000'),
      ('{V}', 'ESSAI RETRAIT PAIEMENT V', '{CAB}', 'tresorerie', '455000')$q$, '', ''],
    array['jeu', 'échéances', 'postgres', $q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele, montant_csg_crds) values
      ('{C1}', '{T}', '2026-03-05', 1000, 300), ('{C3}', '{T}', '2026-05-05', 250, 250), ('{CN}', '{T}', '2026-08-05', 90, null),
      ('{CC}', '{DC}', '2026-03-05', 100, null), ('{CE}', '{E}', '2026-03-05', 1000, 300),
      ('{CV1}', '{V}', '2025-03-05', 800, null), ('{CV4}', '{V}', '2025-12-15', 150, null), ('{CV5}', '{V}', '2026-03-01', 50, null)$q$, '', ''],
    array['jeu', 'un prélèvement à traiter de T', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{MX}', '{T}', '2026-03-05', 'ESSAI PRLV URSSAF', -1000, 'non_rapprochee')$q$, '', ''],
    array['fait', '0. C1 payée depuis le compte personnel', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C1}', '2026-03-10', '[{"compte":"646000","sens":"debit","montant":700},{"compte":"108000","sens":"credit","montant":700}]'::jsonb)$q$, 'OK', ''],
    array['fait', '0. C3, toute de CSG-CRDS, payée sans écriture', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C3}', '2026-05-07', '[]'::jsonb)$q$, 'OK', ''],
    array['fait', '0. CE payée, en engagement', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{E}', '{CE}', '2026-03-10', '[{"compte":"646000","sens":"debit","montant":1000},{"compte":"467000","sens":"credit","montant":1000}]'::jsonb)$q$, 'OK', ''],
    array['fait', '0. CV1 payée en 2025', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{V}', '{CV1}', '2025-03-10', '[{"compte":"646000","sens":"debit","montant":800},{"compte":"108000","sens":"credit","montant":800}]'::jsonb)$q$, 'OK', ''],
    array['fait', '0. CV4, de décembre 2025, payée en janvier 2026', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{V}', '{CV4}', '2026-01-10', '[{"compte":"646000","sens":"debit","montant":150},{"compte":"108000","sens":"credit","montant":150}]'::jsonb)$q$, 'OK', ''],
    array['fait', '0. CV5, de mars 2026, payée en janvier 2026', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{V}', '{CV5}', '2026-01-02', '[{"compte":"646000","sens":"debit","montant":50},{"compte":"108000","sens":"credit","montant":50}]'::jsonb)$q$, 'OK', ''],
    array['fait', '0. la validation de 2025 dans V', 'chef', $q$select valider_exercice('{V}', 2025, (select jsonb_agg(jsonb_build_object('id', e.id, 'journal', 'OD', 'numero', 1,
        'piece_ref', 'Compte personnel du 10/03/2025', 'piece_date', e.date,
        'compte_lib', case e.compte when '646000' then 'Cotisations sociales personnelles de l''exploitant' else 'Compte de l''exploitant' end))
      from ecritures_brouillon e where e.dossier_id = '{V}' and e.date <= '2025-12-31'), '[]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],

    -- ══ 1 à 4. Qui retire ══════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select retirer_paiement_personnel_cotisation('{T}', '{C1}')$q$,
      '42501', 'permission denied for function retirer_paiement_personnel_cotisation'],
    array['controle', '2. rattaché à rien : l''accès au dossier, avant de rien lire', 'inconnu', $q$select retirer_paiement_personnel_cotisation('{T}', '{C1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3. client, le dossier d''un autre', 'client', $q$select retirer_paiement_personnel_cotisation('{T}', '{C1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4. client, son propre dossier', 'client', $q$select retirer_paiement_personnel_cotisation('{DC}', '{CC}')$q$,
      '42501', 'Accès refusé à ce dossier.'],

    -- ══ 5 à 8. Les refus, dans l'ordre de la fonction ══════════
    array['controle', '5. l''échéance d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select retirer_paiement_personnel_cotisation('{E}', '{C1}')$q$,
      'P0002', 'Échéance introuvable dans ce dossier.'],
    array['controle', '6. une échéance sans paiement personnel', 'chef', $q$select retirer_paiement_personnel_cotisation('{T}', '{CN}')$q$,
      '22023', 'Cette échéance n''est pas payée depuis le compte personnel.'],
    array['controle', '7. un paiement d''un exercice validé ne se retire plus', 'chef', $q$select retirer_paiement_personnel_cotisation('{V}', '{CV1}')$q$,
      '23514', 'L''exercice 2025 est validé : ce paiement ne se retire plus.'],
    array['controle', '8. ni celui d''une échéance qui, sans lui, compterait dans l''exercice validé', 'chef', $q$select retirer_paiement_personnel_cotisation('{V}', '{CV4}')$q$,
      '23514', 'L''exercice 2025 est validé : sans ce paiement, l''échéance du 15/12/2025 y compterait ; il ne se retire plus.'],

    -- ══ 10 à 21. Ce que le retrait défait ══════════
    array['controle', '10. après la frontière, un paiement et une échéance libres se retirent', 'chef', $q$select retirer_paiement_personnel_cotisation('{V}', '{CV5}')$q$, 'OK', ''],
    array['fait', '11. le chef retire le paiement de C1', 'chef', $q$select retirer_paiement_personnel_cotisation('{T}', '{C1}')$q$, 'OK', ''],
    array['valeur', '12. son écriture a quitté le brouillon, et sa date l''échéance', 'postgres', $q$select (select count(*) from ecritures_brouillon where cotisation_id = '{C1}') || ':' || coalesce(paiement_personnel_le::text, 'nulle') from cotisations_declarees where id = '{C1}'$q$, '', '0:nulle'],
    array['controle', '13. un second retrait : il n''y a plus de paiement', 'chef', $q$select retirer_paiement_personnel_cotisation('{T}', '{C1}')$q$,
      '22023', 'Cette échéance n''est pas payée depuis le compte personnel.'],
    array['controle', '14. les montants de l''échéance redeviennent libres', 'chef', $q$update cotisations_declarees set montant_csg_crds = 310 where id = '{C1}'$q$, 'OK', ''],
    array['controle', '15. un prélèvement peut de nouveau la payer', 'chef', $q$select rapprocher_cotisation('{MX}', '{C1}', '[{"compte":"512000","sens":"credit","montant":1000},{"compte":"646000","sens":"debit","montant":700},{"compte":"108000","sens":"debit","montant":300}]'::jsonb)$q$, 'OK', ''],
    array['fait', '16. et un paiement personnel se déclare de nouveau, à une autre date', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C1}', '2026-03-12', '[{"compte":"646000","sens":"debit","montant":700},{"compte":"108000","sens":"credit","montant":700}]'::jsonb)$q$, 'OK', ''],
    array['valeur', '17. sa nouvelle écriture, à la nouvelle date', 'postgres', $q$select string_agg(compte || ':' || sens || ':' || trim_scale(montant) || ':' || date, ',' order by compte collate "C") from ecritures_brouillon where cotisation_id = '{C1}'$q$, '',
      '108000:credit:700:2026-03-12,646000:debit:700:2026-03-12'],
    array['fait', '18. un paiement sans écriture (toute de CSG-CRDS) se retire', 'chef', $q$select retirer_paiement_personnel_cotisation('{T}', '{C3}')$q$, 'OK', ''],
    array['valeur', '19. et sa date avec lui', 'postgres', $q$select coalesce(paiement_personnel_le::text, 'nulle') from cotisations_declarees where id = '{C3}'$q$, '', 'nulle'],
    array['fait', '20. en engagement, le paiement se retire avec son écriture face au compte du dirigeant', 'chef', $q$select retirer_paiement_personnel_cotisation('{E}', '{CE}')$q$, 'OK', ''],
    array['valeur', '21. plus rien ne le porte', 'postgres', $q$select (select count(*) from ecritures_brouillon where cotisation_id = '{CE}') || ':' || coalesce(paiement_personnel_le::text, 'nulle') from cotisations_declarees where id = '{CE}'$q$, '', '0:nulle'],

    -- ══ 30 et 31. Ce que le catalogue dit ══════════
    array['valeur', '30. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select has_function_privilege('anon', 'public.retirer_paiement_personnel_cotisation(uuid, uuid)', 'execute') || ':' || has_function_privilege('authenticated', 'public.retirer_paiement_personnel_cotisation(uuid, uuid)', 'execute')$q$, '', 'false:true'],
    array['valeur', '31. elle contourne la RLS, avec son propre contrôle d''accès', 'postgres', $q$select prosecdef::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'retirer_paiement_personnel_cotisation'$q$, '', 'true']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      for cle, valeur in select key, value from jsonb_each_text(ids) loop
        s := replace(s, '{' || cle || '}', valeur);
      end loop;
      accepte := false; code_recu := null; message := null; obs := null;
      if etape[1] = 'jeu' then
        begin
          execute s;
        exception when others then
          verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
        end;
      elsif etape[1] = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = etape[6], false));
      else
        begin
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
            perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'client' then client else inconnu end,
                                     'role', 'authenticated')::text end, true);
          end if;
          execute s;
          accepte := true;
          if etape[1] = 'controle' then
            raise exception 'ANNULATION_ESSAI';
          end if;
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        -- Les étapes de mise en place (« 0. ») ne rendent un verdict que si elles échouent.
        if not (etape[2] like '0.%' and accepte) then
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then 'accepté' else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', case when etape[5] = 'OK' then accepte and (etape[1] = 'fait' or coalesce(code_recu = 'P0001', false))
                       else not accepte and coalesce(code_recu = etape[5] and message like etape[6], false) end);
        end if;
      end if;
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      verdicts := verdicts || jsonb_build_object('controle', '0. le déroulé de l''essai', 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ══ 99. Rien n'est resté ══════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from cotisations_declarees)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from lignes_bancaires)), ((select count(*) from exercices_valides)), ((select count(*) from soldes_reportes)),
    ((select count(*) from cotisations_declarees where paiement_personnel_le is not null))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI RETRAIT PAIEMENT%')
      and coalesce(current_setting('jd.paiement_personnel', true), '') = '');

  perform set_config('essai.retrait_paiement_personnel', verdicts::text, true);
end $essai$;

select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.retrait_paiement_personnel')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
