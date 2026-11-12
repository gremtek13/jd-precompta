-- ESSAI DES DEUX GARDES PAR LIGNE DU BROUILLON, À LEURS FRONTIÈRES (ligne 28.66 ; migration en production depuis le
-- 12/11/2026, supabase/schema/20261112134639_gardes_de_la_validation_allegees.sql). La garde des écritures validées
-- (`garder_ecritures_validees`) et G5 (`garder_lignes_de_la_vente_facturee`), sur l'insertion, la suppression et la
-- modification, là où la migration écarte leur fonction (la ligne que la validation numérote ; une ligne qui ne change que
-- dans les quatorze colonnes que la validation pose) et tout autour. L'essai rend LA MÊME SORTIE avec et sans la migration :
-- c'est sa preuve (aucun refus ne change, ni son code, ni son message, ni son rang). À rejouer après toute migration qui
-- touche ces deux fonctions, leurs déclencheurs, `cle_validation`, `exercice_fige`, `frontiere_validation` ou
-- `valider_exercice`.
--
-- Joué par le super-utilisateur de la réplique, en une transaction : la fenêtre de la validation s'y imite — le verrou
-- exclusif du dossier, puis le réglage `jd.validation_exercice`, comme `valider_exercice` les prend — et chaque étape se
-- joue dans un bloc annulé. Rien ne reste : deux dossiers jetables, une facture, un exercice 2024 validé, quatre lignes,
-- tout part avec le bloc global.
--
-- Mutations qui doivent virer au rouge (jouées sur la réplique, le 12/11/2026, sur le texte de la migration) : retirer de
-- la condition de la garde des écritures validées l'ancienne ligne validée (3, 16), la ligne qui ne se valide pas (4), le
-- changement de dossier (6 : le verrou partagé de l'ancien dossier), le réglage (1, 5) ; ajouter `libelle` aux quatorze
-- colonnes de G5 (8, 14) ; G5 jamais sur la modification (8, 10, 14) ; G5 sur le seul statut changé (8, 10) ; le jumeau
-- de la garde des écritures validées nommé pour passer après G5 (16).

do $essai$
declare
  da constant text := '28660000-0000-4000-8000-0000000000d1';
  db constant text := '28660000-0000-4000-8000-0000000000d2';
  fa constant text := '28660000-0000-4000-8000-0000000000f1';
  l1 constant text := '28660000-0000-4000-8000-0000000000e1';
  l2 constant text := '28660000-0000-4000-8000-0000000000e2';
  l3 constant text := '28660000-0000-4000-8000-0000000000e3';
  l4 constant text := '28660000-0000-4000-8000-0000000000e4';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- [rang, étape, fenêtre (aucune, ou le dossier dont la validation s'imite), réglage de la vente facturée, instruction,
  --  ce qui est attendu, verrou partagé à relire (un dossier, ou rien)]
  etapes constant text[][] := array[
    array['1', '1. hors de la validation, une ligne ne se valide pas', '', '', $q$update ecritures_brouillon set statut = 'validee' where id = '{L1}'$q$, '42501 Une écriture ne se valide que par la validation de son exercice.', ''],
    array['2', '2. la ligne que la validation numérote, dans sa fenêtre', '{DA}', '', $q$update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'BQ', numero_ecriture = 1, piece_ref = 'E1', piece_date = '2025-03-01', compte_lib = 'Banque' where id = '{L1}'$q$, 'aucun refus', ''],
    array['3', '3. dans la fenêtre, une ligne déjà validée ne se modifie plus', '{DA}', '', $q$update ecritures_brouillon set statut = 'validee', piece_ref = 'E2' where id = '{L2}'$q$, '23514 Cette écriture est validée (exercice 2024) : elle ne se modifie plus.', ''],
    array['4', '4. dans la fenêtre, une ligne qui ne se valide pas passe la frontière', '{DA}', '', $q$update ecritures_brouillon set date = '2024-07-01' where id = '{L1}'$q$, '23514 {FIGE} : aucune écriture ne s''y passe plus.', ''],
    array['5', '5. dans la fenêtre d''un autre dossier, une ligne ne se valide pas', '{DB}', '', $q$update ecritures_brouillon set statut = 'validee' where id = '{L1}'$q$, '42501 Une écriture ne se valide que par la validation de son exercice.', ''],
    array['6', '6. dans la fenêtre d''un autre dossier, la ligne qui y part et s''y valide, sous le verrou partagé de son dossier d''hier', '{DB}', '', $q$update ecritures_brouillon set dossier_id = '{DB}', statut = 'validee', valide_le = now(), journal_code = 'BQ', numero_ecriture = 1, piece_ref = 'E1', piece_date = '2025-03-01', compte_lib = 'Banque' where id = '{L1}'$q$, 'aucun refus ; verrou partagé', '{DA}'],
    array['7', '7. une ligne de vente facturée qui ne change que dans une colonne de la validation, réécrite telle quelle', '', '', $q$update ecritures_brouillon set statut = statut where id = '{L3}'$q$, 'aucun refus', ''],
    array['8', '8. une ligne de vente facturée dont le libellé change', '', '', $q$update ecritures_brouillon set libelle = 'Essai 28.66 autre' where id = '{L3}'$q$, '42501 Une écriture de vente facturée ne se modifie que par la fonction qui l''écrit.', ''],
    array['9', '9. une ligne de vente facturée réécrite à l''identique', '', '', $q$update ecritures_brouillon set libelle = libelle, montant = montant where id = '{L3}'$q$, 'aucun refus', ''],
    array['10', '10. une colonne de la validation et un montant changés ensemble', '', '', $q$update ecritures_brouillon set compte_lib = 'Essai', montant = montant + 1 where id = '{L3}'$q$, '42501 Une écriture de vente facturée ne se modifie que par la fonction qui l''écrit.', ''],
    array['11', '11. la fonction qui écrit la vente facturée modifie sa ligne', '', '{FA}', $q$update ecritures_brouillon set libelle = 'Essai 28.66 autre' where id = '{L3}'$q$, 'aucun refus', ''],
    array['12', '12. la ligne de vente facturée que la validation numérote, dans sa fenêtre', '{DA}', '', $q$update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'VE', numero_ecriture = 2, piece_ref = 'F2025-2866', piece_date = '2025-04-01', compte_lib = 'Prestations', comp_aux_num = '411000', comp_aux_lib = 'Clients' where id = '{L3}'$q$, 'aucun refus', ''],
    array['13', '13. dans la fenêtre, une validation qui toucherait aussi le compte', '{DA}', '', $q$update ecritures_brouillon set statut = 'validee', compte = '706100' where id = '{L3}'$q$, '42501 Une écriture de vente facturée ne se modifie que par la fonction qui l''écrit.', ''],
    array['14', '14. dans la fenêtre, une validation qui toucherait aussi le libellé', '{DA}', '', $q$update ecritures_brouillon set statut = 'validee', libelle = 'Essai 28.66 autre' where id = '{L3}'$q$, '42501 Une écriture de vente facturée ne se modifie que par la fonction qui l''écrit.', ''],
    array['15', '15. une ligne de vente facturée validée ne se modifie plus', '', '', $q$update ecritures_brouillon set compte_lib = 'Essai' where id = '{L4}'$q$, '23514 Cette écriture est validée (exercice 2024) : elle ne se modifie plus.', ''],
    array['16', '16. deux refus ensemble : la garde des écritures validées avant G5', '{DA}', '', $q$update ecritures_brouillon set libelle = 'Essai 28.66 autre' where id = '{L4}'$q$, '23514 Cette écriture est validée (exercice 2024) : elle ne se modifie plus.', ''],
    array['17', '17. la suppression d''une ligne validée', '', '', $q$delete from ecritures_brouillon where id = '{L2}'$q$, '23514 Cette écriture est validée (exercice 2024) : elle ne se supprime plus.', ''],
    array['18', '18. la suppression d''une ligne de vente facturée', '', '', $q$delete from ecritures_brouillon where id = '{L3}'$q$, '42501 Une écriture de vente facturée ne se retire que par la fonction qui l''écrit.', ''],
    array['19', '19. l''insertion d''une ligne validée hors de la validation', '', '', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut) values ('{DA}', '2025-05-01', '512000', 'Essai 28.66', 10, 'debit', 'validee')$q$, '42501 Une écriture ne se valide que par la validation de son exercice.', ''],
    array['20', '20. l''insertion d''une ligne dans l''exercice validé', '', '', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut) values ('{DA}', '2024-05-01', '512000', 'Essai 28.66', 10, 'debit', 'proposee')$q$, '23514 {FIGE} : aucune écriture ne s''y passe plus.', '']
  ];
  e text[];
  v_requete text; v_attendu text; v_obs text; v_cle bigint;
  verdicts jsonb := '[]'::jsonb;
begin
  begin
    -- Tout le jeu sans ses déclencheurs, cohérent par construction : aucun verrou de validation n'est pris avant les étapes
    -- (l'étape 6 relit celui que la modification prend).
    perform set_config('session_replication_role', 'replica', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, code_email)
    values (da::uuid, 'ESSAI 28.66 A', cabinet, 'tresorerie', '455000', true, 'essai-28-66-a'),
           (db::uuid, 'ESSAI 28.66 B', cabinet, 'tresorerie', '455000', true, 'essai-28-66-b');
    insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht,
                                 montant_tva, montant_ttc, validated_at, source_de_la_vente, nature_operation, option_debits)
    values (fa::uuid, da::uuid, 'F2025-2866', 'validee', 'facture', '2025-04-01', 'ESSAI', '12345678900012', 100, 0, 100, now(),
            true, 'services', false);
    insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures,
                                   total_debit, total_credit, empreinte, declaration)
    values (da::uuid, 2024, now(), 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', 'tresorerie', 0, 0, 0, 0, repeat('0', 64), '{}'::jsonb);
    insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens, statut, facture_id, valide_le, journal_code,
                                     numero_ecriture, piece_ref, piece_date, compte_lib) values
      (l1::uuid, da::uuid, '2025-03-01', '512000', 'Essai 28.66 L1', 100, 'debit', 'proposee', null, null, null, null, null, null, null),
      (l2::uuid, da::uuid, '2024-06-01', '512000', 'Essai 28.66 L2', 100, 'debit', 'validee', null, now(), 'BQ', 1, 'E2', '2024-06-01', 'Banque'),
      (l3::uuid, da::uuid, '2025-04-01', '706000', 'Essai 28.66 L3', 100, 'credit', 'proposee', fa::uuid, null, null, null, null, null, null),
      (l4::uuid, da::uuid, '2024-05-01', '706000', 'Essai 28.66 L4', 100, 'credit', 'validee', fa::uuid, now(), 'VE', 2, 'F2024', '2024-05-01', 'Prestations');
    perform set_config('session_replication_role', 'origin', true);

    foreach e slice 1 in array etapes loop
      v_requete := replace(replace(replace(replace(replace(replace(replace(e[5], '{L1}', l1), '{L2}', l2), '{L3}', l3), '{L4}', l4),
                     '{DA}', da), '{DB}', db), '{FA}', fa);
      v_attendu := replace(e[6], '{FIGE}', public.exercice_fige(da::uuid, 2024));
      begin
        if e[3] <> '' then
          perform pg_advisory_xact_lock(public.cle_validation(replace(replace(e[3], '{DA}', da), '{DB}', db)::uuid));
          perform set_config('jd.validation_exercice', replace(replace(e[3], '{DA}', da), '{DB}', db), true);
        end if;
        if e[4] <> '' then
          perform set_config('jd.ecriture_vente_facturee', replace(e[4], '{FA}', fa), true);
        end if;
        begin
          execute v_requete;
          v_obs := 'aucun refus';
        exception when others then
          v_obs := sqlstate || ' ' || sqlerrm;
        end;
        if e[7] <> '' then
          v_cle := public.cle_validation(replace(e[7], '{DA}', da)::uuid);
          v_obs := v_obs || case when exists (select 1 from pg_locks k
                                               where k.locktype = 'advisory' and k.pid = pg_backend_pid() and k.granted
                                                 and k.mode = 'ShareLock' and k.objsubid = 1
                                                 and k.classid = ((v_cle >> 32) & 4294967295)::oid
                                                 and k.objid = (v_cle & 4294967295)::oid)
                                 then ' ; verrou partagé' else ' ; sans verrou partagé' end;
        end if;
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' then
          raise;
        end if;
      end;
      verdicts := verdicts || jsonb_build_object('rang', e[1]::int, 'etape', e[2], 'ok', v_obs = v_attendu,
        'observe', case when v_obs = v_attendu then v_obs else v_obs || ' (attendu : ' || v_attendu || ')' end);
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni la facture, ni l''exercice, ni les lignes',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, db::uuid))
      and not exists (select 1 from factures_emises where id = fa::uuid)
      and not exists (select 1 from exercices_valides where dossier_id = da::uuid)
      and not exists (select 1 from ecritures_brouillon where id in (l1::uuid, l2::uuid, l3::uuid, l4::uuid)),
    'observe', 'relu');
  perform set_config('essai.gardes_de_la_validation', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.gardes_de_la_validation')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
