-- LA CAISSE D'UN DOSSIER BNC DEVANT UNE SUPPRESSION (ligne 26.6, étape C1 ; migration `caisse`, préparée dans
-- `supabase/preparees/`) — SUR UNE RÉPLIQUE SEULEMENT : l'outil d'exécution de la production soumet toute suppression à
-- une confirmation qui n'arrive pas, et l'appel expire. Le compagnon de `caisse.sql`, à rejouer avec lui, après toute
-- migration qui touche `operations_caisse`, ses gardes (`garder_operation_caisse`, `garder_ecriture_de_caisse`,
-- `garder_la_caisse`) ou les clés qui la lient aux pièces, aux catégories et aux dossiers. Avant la migration, il le
-- dit (ESSAI_IMPOSSIBLE) et n'écrit rien.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - une opération de caisse ne se supprime pas, ni par le propriétaire (sa garde) ni par le cabinet (aucune policy) ;
--   - l'écriture d'une opération ne part qu'avec elle : refusée en direct, au propriétaire comme au cabinet ; acceptée
--     sous le réglage de CETTE opération (le chemin du retrait, étape C1b) ;
--   - LA CAISSE JAMAIS NÉGATIVE devant une suppression : l'ouverture du compte de la caisse (une ligne, ou toute la
--     reprise, comme l'onglet Balance la retire), un retrait d'espèces pour la caisse dont les espèces ont servi ; un
--     versement en banque supprimé, qui ne fait que la remplir, passe ;
--   - une pièce qu'un paiement par la caisse cite ne se supprime plus (la piste d'audit), ni une catégorie qu'une
--     recette cite ;
--   - le dossier entier se supprime, sa caisse, ses écritures et la pièce qu'un paiement cite avec lui (la cascade) ;
--   - CE QUI NE PEUT PAS ÊTRE DE LA CAISSE NE LAISSE RIEN EN ATTENTE : un mouvement et un à-nouveau hors de la racine
--     53, insérés, modifiés et supprimés, puis la structure de leur table modifiée dans la même transaction (`alter
--     table`, annulé avec son contrôle), passent ; une ligne de la caisse y laisse son événement, et la modification se
--     refuse (55006). La condition des déclencheurs, et leur différé ; pour les encaissements, l'essai de la frontière
--     (`frontiereDesEncaissements.sql`) le montre, qui écrit des chèques puis désactive une garde.
--
-- Le moteur d'étapes de `caisse.sql` (`jeu`, `controle`, `fait`, `valeur` ; les dix déclencheurs de la caisse,
-- différés, joués après chaque étape qui écrit), dans des dossiers JETABLES du cabinet du dossier `test`, au sein d'un
-- bloc qui s'annule entièrement à la fin ; chaque contrôle dans sa sous-transaction, annulée elle aussi. Les
-- identifiants jetables sont FIXES (préfixe `ca155e00`, série 9), désignés par leur nom entre accolades. Le fichier se
-- joue en UNE transaction (`psql -1`).
--
-- ÉPROUVÉ LE 29/10/2026 SUR LA RÉPLIQUE DE L'ÉTAPE, la migration appliquée comme l'outil l'appliquera : 20 verdicts
-- justes, rien n'est resté ; de même après les deux migrations d'A7, dans les trois ordres ; sans elle,
-- ESSAI_IMPOSSIBLE, rien d'écrit (HISTORIQUE.md, « LA CAISSE, EN BASE : LA MIGRATION `CAISSE` (C1, LIGNE 26.6) »).
--
-- 29/10/2026, AUDIT-Q1 : une garde de tête, la première instruction du bloc, refuse de le jouer hors d'une réplique
-- (ESSAI_HORS_REPLIQUE), avant toute écriture : le rôle `proprietaire`, qui y tient la place du propriétaire des
-- tables, manque à la production (relu au catalogue le 29/10/2026). L'en-tête seul ne gardait que son lecteur
-- (HISTORIQUE.md, « CE QUE RENDENT LES ESSAIS DE LA BASE REJOUÉS EN PRODUCTION », et la fin de « A7Q-Q1 : UNE SOCIÉTÉ
-- SANS DÉNOMINATION NE SE FACTURE PAS DEPUIS L'ESPACE CLIENT, DANS LA MIGRATION »).
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  cabinet uuid;
  declencheurs text := 'operations_caisse_jamais_negative, lignes_bancaires_caisse_jamais_negative_insertion, '
    || 'lignes_bancaires_caisse_jamais_negative_modification, lignes_bancaires_caisse_jamais_negative_suppression, '
    || 'encaissements_factures_caisse_jamais_negative_insertion, encaissements_factures_caisse_jamais_negative_modification, '
    || 'encaissements_factures_caisse_jamais_negative_suppression, a_nouveaux_caisse_jamais_negative_insertion, '
    || 'a_nouveaux_caisse_jamais_negative_modification, a_nouveaux_caisse_jamais_negative_suppression';
  immediat text := 'set constraints ' || declencheurs || ' immediate';
  differe text := 'set constraints ' || declencheurs || ' deferred';
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text;
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  -- La garde de tête (AUDIT-Q1) : sur une réplique seulement, avant toute écriture.
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des lignes et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.operations_caisse') is null then
    raise exception 'ESSAI_IMPOSSIBLE : la migration caisse n''est pas en base';
  end if;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if cabinet is null or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or exists (select 1 from dossiers where id::text like 'ca155e00-0000-4000-9%')
     or extract(year from (now() at time zone 'Europe/Paris'))::int <> 2026 then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, dossier jetable déjà présent, ou l''année n''est plus 2026';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'CHEF', chef,
      'S', 'ca155e00-0000-4000-9000-000000000001', 'K', 'ca155e00-0000-4000-9000-000000000002',
      'KS', 'ca155e00-0000-4000-9001-000000000001', 'KK', 'ca155e00-0000-4000-9001-000000000002',
      'PS', 'ca155e00-0000-4000-9003-000000000001', 'PK', 'ca155e00-0000-4000-9003-000000000002',
      'MS1', 'ca155e00-0000-4000-9002-000000000001', 'MS2', 'ca155e00-0000-4000-9002-000000000002',
      'MS3', 'ca155e00-0000-4000-9002-000000000003')
    || jsonb_build_object(
      'AS1', 'ca155e00-0000-4000-9005-000000000001', 'AS2', 'ca155e00-0000-4000-9005-000000000002',
      'AS3', 'ca155e00-0000-4000-9005-000000000003',
      'XS', 'ca155e00-0000-4000-9004-000000000001', 'XK', 'ca155e00-0000-4000-9004-000000000002');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from operations_caisse)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from lignes_bancaires)), ((select count(*) from a_nouveaux)), ((select count(*) from categories)),
    ((select count(*) from pieces))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  etapes := array[
    -- ══ Le jeu : S, sa caisse ouverte de 50 € par une reprise, ses mouvements, sa catégorie, sa pièce ; K (9) ══
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('{S}', 'ESSAI CAISSE S', '{CAB}', 'tresorerie', '455000'), ('{K}', 'ESSAI CAISSE K', '{CAB}', 'tresorerie', '455000');
      insert into categories (id, dossier_id, code, libelle, compte_comptable, poste_2035) values
        ('{KS}', '{S}', 'essai_hon', 'Honoraires', '706000', 'AA'), ('{KK}', '{K}', 'essai_hon', 'Honoraires', '706000', 'AA');
      insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values
        ('{PS}', '{S}', '{S}/essai-caisse-s.pdf', 'essai-caisse-s.pdf', 'achat', 'a_valider'),
        ('{PK}', '{K}', '{K}/essai-caisse-k.pdf', 'essai-caisse-k.pdf', 'achat', 'a_valider');
      insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values
        ('{MS1}', '{S}', '2026-03-05', 'ESSAI VERSEMENT ESPECES', 100, 'non_rapprochee'), ('{MS2}', '{S}', '2026-03-06', 'ESSAI RETRAIT DAB', -200, 'non_rapprochee');
      insert into a_nouveaux (id, dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values
        ('{AS1}', '{S}', '2026-01-01', '530000', 'debit', 50, 'balance-essai-caisse-s.csv', repeat('e', 64)),
        ('{AS2}', '{S}', '2026-01-01', '101000', 'credit', 50, 'balance-essai-caisse-s.csv', repeat('e', 64))$q$, '', ''],
    -- S : 50 € d'ouverture, 100 € d'apport le 01/03, 30 € de recettes le 02/03, un versement de 100 € le 05/03, un
    -- retrait de 200 € pour la caisse le 06/03, un prélèvement de 250 € le 07/03 : 30 € à la fin.
    array['fait', '1. la caisse de S', 'chef', $q$select enregistrer_operation_caisse('{S}', 'apport', '2026-03-01', 100, null, null, null, '[{"compte":"530000","sens":"debit","montant":100},{"compte":"108000","sens":"credit","montant":100}]');
      select enregistrer_operation_caisse('{S}', 'recette', '2026-03-02', 30, '{KS}', null, '{}', '[{"compte":"530000","sens":"debit","montant":30},{"compte":"706000","sens":"credit","montant":30}]');
      update lignes_bancaires set compte_bilan = '530000', statut = 'rapprochee' where id in ('{MS1}', '{MS2}');
      select enregistrer_operation_caisse('{S}', 'prelevement', '2026-03-07', 250, null, null, null, '[{"compte":"108000","sens":"debit","montant":250},{"compte":"530000","sens":"credit","montant":250}]')$q$,
      'OK', ''],
    array['valeur', '1b. … de 30 € à la fin, jamais négative', 'postgres', $q$select coalesce((select n.jour || ' ' || n.solde from premier_jour_negatif_de_la_caisse('{S}') n), 'aucun') || '/' || (select count(*) from operations_caisse where dossier_id = '{S}')$q$, '', 'aucun/3'],

    -- ══ 2 et 3. L'opération et son écriture ══════════
    array['controle', '2. une opération ne se supprime pas, même par le propriétaire', 'postgres', $q$delete from operations_caisse where dossier_id = '{S}' and genre = 'apport'$q$,
      '42501', 'Une opération de caisse ne se supprime pas : elle se retire, avec son écriture.'],
    array['valeur', '2b. … ni par le cabinet : aucune policy de suppression', 'chef', $q$with d as (delete from operations_caisse where dossier_id = '{S}' returning 1) select count(*)::text from d$q$, '', '0'],
    array['controle', '3. l''écriture d''une opération ne part pas sans elle : le propriétaire', 'postgres', $q$delete from ecritures_brouillon where operation_caisse_id = (select id from operations_caisse where dossier_id = '{S}' and genre = 'apport')$q$,
      '42501', 'L''écriture d''une opération de caisse se retire avec cette opération.'],
    array['controle', '3b. … le cabinet, que la RLS du brouillon laisse supprimer', 'chef', $q$delete from ecritures_brouillon where operation_caisse_id = (select id from operations_caisse where dossier_id = '{S}' and genre = 'apport')$q$,
      '42501', 'L''écriture d''une opération de caisse se retire avec cette opération.'],
    array['controle', '3c. … sous le réglage de CETTE opération, elle part (le chemin du retrait, étape C1b)', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{S}' and genre = 'apport'), true);
      delete from ecritures_brouillon where operation_caisse_id = (select id from operations_caisse where dossier_id = '{S}' and genre = 'apport')$q$,
      'OK', ''],
    array['controle', '3d. … sous le réglage d''une autre, non', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{S}' and genre = 'recette'), true);
      delete from ecritures_brouillon where operation_caisse_id = (select id from operations_caisse where dossier_id = '{S}' and genre = 'apport')$q$,
      '42501', 'L''écriture d''une opération de caisse se retire avec cette opération.'],

    -- ══ 4 à 6. La caisse jamais négative devant une suppression ══════════
    array['controle', '4. supprimer l''ouverture de la caisse dont les espèces ont servi', 'postgres', $q$delete from a_nouveaux where id = '{AS1}'$q$,
      '23514', 'Retirer l''ouverture de la caisse, 50,00 €, la rendrait négative le 07/03/2026 (−20,00 €) : retire d''abord les sorties d''espèces qui la suivent.'],
    array['controle', '4b. … ni toute la reprise, comme l''onglet Balance la retire', 'chef', $q$delete from a_nouveaux where dossier_id = '{S}'$q$,
      '23514', 'Retirer l''ouverture de la caisse, 50,00 €, la rendrait négative le 07/03/2026 (−20,00 €) : retire d''abord les sorties d''espèces qui la suivent.'],
    array['controle', '4c. … la reprise retirée après le prélèvement retiré passe (le contrôle POSITIF)', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{S}' and genre = 'prelevement'), true);
      update operations_caisse set retire_le = now(), retire_par = '{CHEF}' where dossier_id = '{S}' and genre = 'prelevement';
      delete from a_nouveaux where dossier_id = '{S}'$q$,
      'OK', ''],
    array['controle', '5. supprimer le retrait d''espèces pour la caisse dont les espèces ont servi', 'chef', $q$delete from lignes_bancaires where id = '{MS2}'$q$,
      '23514', 'Retirer ce retrait d''espèces de 200,00 € pour la caisse rendrait la caisse négative le 07/03/2026 (−170,00 €) : retire d''abord les sorties d''espèces qui le suivent.'],
    array['controle', '6. supprimer le versement en banque, qui ne fait que la remplir, passe', 'chef', $q$delete from lignes_bancaires where id = '{MS1}'$q$,
      'OK', ''],

    -- ══ 7 et 8. Ce que la caisse cite ══════════
    array['controle', '7. une pièce qu''un paiement par la caisse cite ne se supprime plus', 'postgres', $q$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
      insert into operations_caisse (id, dossier_id, genre, date, montant, piece_id, origine, cree_le, cree_par) values ('{XS}', '{S}', 'paiement', '2026-03-03', -10, '{PS}', 'cabinet', '2026-01-15 10:00+01', '{CHEF}');
      select set_config('request.jwt.claims', '', true);
      delete from pieces where id = '{PS}'$q$,
      '23503', '%violates foreign key constraint "operations_caisse_piece_id_fkey" on table "operations_caisse"%'],
    array['controle', '8. une catégorie qu''une recette cite ne se supprime plus', 'postgres', $q$delete from categories where id = '{KS}'$q$,
      '23503', '%violates foreign key constraint "operations_caisse_categorie_id_fkey" on table "operations_caisse"%'],

    -- ══ 9. Le dossier entier ══════════
    array['controle', '9. le dossier se supprime, sa caisse, ses écritures et la pièce qu''un paiement cite avec lui', 'chef', $q$select enregistrer_operation_caisse('{K}', 'recette', '2026-03-02', 30, '{KK}', null, '{}', '[{"compte":"530000","sens":"debit","montant":30},{"compte":"706000","sens":"credit","montant":30}]');
      insert into operations_caisse (id, dossier_id, genre, date, montant, piece_id, origine, cree_le, cree_par) values ('{XK}', '{K}', 'paiement', '2026-03-03', -10, '{PK}', 'cabinet', '2026-01-15 10:00+01', '{CHEF}');
      delete from dossiers where id = '{K}';
      select 1 / (case when exists (select 1 from operations_caisse where dossier_id = '{K}') or exists (select 1 from ecritures_brouillon where dossier_id = '{K}')
        or exists (select 1 from pieces where dossier_id = '{K}') then 0 else 1 end)$q$,
      'OK', ''],

    -- ══ 10. Ce qui ne peut pas être de la caisse ne laisse rien en attente ══════════
    -- Le moteur joue les déclencheurs après chaque étape : rien n'est en attente quand une étape commence.
    array['controle', '10. un mouvement et un à-nouveau hors de la racine 53, insérés, modifiés et supprimés : leur table change ensuite de structure dans la même transaction', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{MS3}', '{S}', '2026-03-08', 'ESSAI VIREMENT', 10, 'non_rapprochee');
      update lignes_bancaires set compte_bilan = '455000', statut = 'rapprochee' where id = '{MS3}';
      update lignes_bancaires set libelle = 'ESSAI VIREMENT (bis)' where id = '{MS3}';
      delete from lignes_bancaires where id = '{MS3}';
      insert into a_nouveaux (id, dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values ('{AS3}', '{S}', '2026-01-01', '512000', 'debit', 5, 'balance-essai-caisse-s.csv', repeat('e', 64));
      update a_nouveaux set montant = 6 where id = '{AS3}';
      delete from a_nouveaux where id = '{AS3}';
      alter table public.lignes_bancaires set (autovacuum_enabled = true);
      alter table public.a_nouveaux set (autovacuum_enabled = true)$q$,
      'OK', ''],
    array['controle', '10b. … un mouvement classé sur la caisse y laisse son événement : sa table ne change plus de structure avant la fin de la transaction', 'postgres', $q$update lignes_bancaires set date = '2026-03-04' where id = '{MS1}';
      alter table public.lignes_bancaires set (autovacuum_enabled = true)$q$,
      '55006', 'cannot ALTER TABLE "lignes_bancaires" because it has pending trigger events'],
    array['controle', '10c. … l''ouverture de la caisse de même', 'postgres', $q$update a_nouveaux set montant = 60 where id = '{AS1}';
      alter table public.a_nouveaux set (autovacuum_enabled = true)$q$,
      '55006', 'cannot ALTER TABLE "a_nouveaux" because it has pending trigger events']
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
          execute immediat;
          execute differe;
        exception when others then
          verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
        end;
      else
        begin
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
            perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
              else json_build_object('sub', chef, 'role', 'authenticated')::text end, true);
          end if;
          if etape[1] = 'valeur' then
            execute s into obs;
          else
            execute s;
            execute immediat;
            execute differe;
            accepte := true;
            if etape[1] = 'controle' then
              raise exception 'ANNULATION_ESSAI';
            end if;
          end if;
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        perform set_config('jd.caisse', '', true);
        if etape[1] = 'valeur' then
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', coalesce(obs, case when code_recu is not null then code_recu || ' ' || coalesce(message, '') else '∅' end),
            'ok', coalesce(obs = etape[6], false));
        else
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
    ((select count(*) from dossiers)), ((select count(*) from operations_caisse)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from lignes_bancaires)), ((select count(*) from a_nouveaux)), ((select count(*) from categories)),
    ((select count(*) from pieces))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. rien n''est resté en base', 'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where id::text like 'ca155e00-0000-4000-9%'));

  perform set_config('essai.caisse_suppression', verdicts::text, true);
end $essai$;

select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.caisse_suppression')::jsonb) as v(controle text, ok boolean, observe text)
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
