-- UN DOSSIER QUI PORTE DES FACTURES REPRISES NE PASSE PAS EN COMPTABILITÉ D'ENGAGEMENT (ligne 51.5, A8B-Q3 ; la migration
-- `reprises_retiennent_la_tresorerie`, en production depuis le 15/11/2026,
-- supabase/schema/20261115074926_reprises_retiennent_la_tresorerie.sql). Le
-- récit : HISTORIQUE.md, « 13/11/2026 — PC4Q2-Q1, A8B-Q3 ET A8Q5Q3-Q2 : TROIS MIGRATIONS PRÉPARÉES ». À rejouer après
-- toute migration qui touche `verrouiller_modele_comptable`, `importer_factures`, `retirer_import` ou le modèle comptable
-- d'un dossier.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE REFUS, pour tout auteur : le chef du cabinet (super-administrateur dans le semis), un comptable assigné au dossier
--      (qui n'est pas super-administrateur), et le propriétaire, hors de la RLS — la garde ne dépend pas du rôle ;
--   2. LE TÉMOIN : un dossier basculé sans facture reprise passe en engagement, et le même dossier dont l'import est retiré
--      (`retirer_import`) aussi — le refus tient aux factures reprises, à rien d'autre ;
--   3. L'ORDRE : un brouillon qui n'est pas vide se dit d'abord, sous les mots d'hier, comme l'écran le dit ;
--   4. CE QUI NE SE JUGE PAS : le compte du dirigeant, changé seul dans un dossier qui porte des factures reprises.
-- SANS LA MIGRATION (sa dernière ligne d'historique, pas son retour), les étapes 1 à 3 rendent le DÉFAUT qu'elle ferme : le
-- passage accepté, sous l'intitulé « EN ATTENTE » — l'essai est vrai quand la base est celle qu'il décrit.
--
-- Un dossier jetable du cabinet du dossier `test` (préfixe `a8b30000-0000-4000-8000`) : DQ, basculé, en trésorerie,
-- redevable, son brouillon vide ; une facture de l'ancien logiciel importée (le chef pose la date de reprise, le premier jour
-- du mois de Paris, puis importe). Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce
-- que le propriétaire pose d'abord (une assignation, une écriture), ce que le chef pose ensuite (la reprise, l'import), puis
-- la requête ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent
-- dans un réglage LOCAL à la transaction (`essai.reprise_et_modele_comptable`) : le fichier se joue d'un seul appel, ne crée
-- ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de son
-- dossier. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  comptable constant text := '3e3b0000-0000-4000-8000-000000000001';
  dq constant text := 'a8b30000-0000-4000-8000-0000000000d1';
  e1 constant text := 'a8b30000-0000-4000-8000-0000000000c1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  date_f constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date - 20;
  -- La migration en base : sa dernière ligne d'historique est la sienne, pas celle de son retour.
  applique constant boolean := coalesce((select m.name = 'reprises_retiennent_la_tresorerie' from supabase_migrations.schema_migrations m
    where m.name in ('reprises_retiennent_la_tresorerie', 'retour_reprises_retiennent_la_tresorerie') order by m.version desc limit 1), false);
  refus constant text := 'Ce dossier porte des factures reprises d''un ancien logiciel : il ne passe pas en comptabilité d''engagement, où la créance d''une facture d''avant serait au compte client de la reprise, que l''application n''écrit pas encore.';
  brouillon_plein constant text := 'Le modèle comptable d''un dossier ne se change que tant que son brouillon d''écritures est vide.';
  -- La facture de l'ancien logiciel : 100 € HT à 20 %, rien d'encaissé avant la reprise.
  lot constant text := '[{"numero": "R-B3-1", "type": "facture", "date_emission": "{DF}", "tiers_nom": "Client B3",
    "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false, "montant_ht": 100,
    "montant_tva": 20, "montant_ttc": 120, "encaisse_avant_reprise": 0, "encaisse_par_taux": [{"taux": 20, "encaisse": 0}],
    "lignes": [{"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}], "transmise_par": "pdf"}]';
  importer constant text := $q$select fixer_reprise_des_factures('{DQ}', '{R}'); select importer_factures('{DQ}', '{"format": "csv"}'::jsonb, '{L}'::jsonb);$q$;
  vers_engagement constant text := $q$update dossiers set mode_comptable = 'engagement' where id = '{DQ}' returning mode_comptable$q$;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_super text; v_obs text; v_texte text; v_f record;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.importer_factures(uuid, jsonb, jsonb)') is null then
    perform set_config('essai.reprise_et_modele_comptable', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE des factures reprises (factures_importees)', 'ok', true,
      'observe', 'absentes : l''essai se joue dès qu''elles y sont'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret,
                          adresse, forme_juridique, denomination_imprimee) values
      (dq::uuid, 'ESSAI A8BQ3 DQ', cabinet, 'tresorerie', '455000', true, 'redevable', '12345678200010',
       'ESSAI A8BQ3 ADRESSE', '5710', 'ESSAI A8BQ3 SOCIÉTÉ');

    -- Une étape : {rang, étape, ce que le propriétaire pose d'abord, ce que le chef pose ensuite, la requête, qui la joue —
    -- `chef`, `comptable` ou `postgres` (le propriétaire, hors de la RLS) —, le code attendu (`OK` : acceptée) et ce
    -- qu'elle rend, ou les mots du refus}.
    for e in select * from (values
      (1, case when applique then '1. le chef du cabinet, dossier qui porte une facture reprise : le passage en engagement se refuse'
               else '1. EN ATTENTE (la migration reprises_retiennent_la_tresorerie n''est pas en base) : le chef passe en engagement un dossier qui porte une facture reprise — le défaut' end,
        null, importer, vers_engagement, 'chef',
        case when applique then '23514' else 'OK' end, case when applique then refus else 'engagement' end),
      (2, case when applique then '2. un comptable assigné au dossier (pas super-administrateur) : le même refus'
               else '2. EN ATTENTE : le comptable assigné passe en engagement — le défaut' end,
        $q$insert into dossier_assignations (dossier_id, user_id) values ('{DQ}', '{COMPTABLE}');$q$, importer, vers_engagement, 'comptable',
        case when applique then '23514' else 'OK' end, case when applique then refus else 'engagement' end),
      (3, case when applique then '3. le propriétaire, hors de la RLS : le même refus (la garde ne dépend pas du rôle)'
               else '3. EN ATTENTE : le propriétaire passe en engagement — le défaut' end,
        null, importer, vers_engagement, 'postgres',
        case when applique then '23514' else 'OK' end, case when applique then refus else 'engagement' end),
      (4, '4. témoin : le même dossier basculé, sans facture reprise, passe en engagement',
        null, null, vers_engagement, 'chef', 'OK', 'engagement'),
      (5, '5. témoin : son import retiré (retirer_import), il passe en engagement',
        null, importer || $q$select retirer_import('{DQ}', (select l.id from imports_factures l where l.dossier_id = '{DQ}'));$q$,
        vers_engagement, 'chef', 'OK', 'engagement'),
      (6, '6. l''ordre : un brouillon qui n''est pas vide se dit d''abord, sous les mots d''hier',
        $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values ('{E1}', '{DQ}', '{R}', '471000', 'ESSAI A8BQ3', 1, 'debit');$q$,
        importer, vers_engagement, 'chef', '23514', brouillon_plein),
      (7, '7. ce qui ne se juge pas : le compte du dirigeant, changé seul, dans un dossier qui porte une facture reprise',
        null, importer, $q$update dossiers set compte_notes_de_frais = '467000' where id = '{DQ}' returning compte_notes_de_frais$q$, 'chef',
        'OK', '467000')
    ) as t(rang, etape, pose_super, pose, requete, profil, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null; v_pose := null; v_req := null; v_super := null;
      begin
        for v_f in select x.rang, x.texte from (values (0, e.pose_super), (1, e.pose), (2, e.requete)) as x(rang, texte) where x.texte is not null loop
          v_texte := replace(replace(replace(replace(v_f.texte, '{DQ}', dq), '{R}', reprise::text), '{E1}', e1), '{COMPTABLE}', comptable);
          v_texte := replace(replace(v_texte, '{L}', lot), '{DF}', date_f::text);
          if v_f.rang = 0 then v_super := v_texte; elsif v_f.rang = 1 then v_pose := v_texte; else v_req := v_texte; end if;
        end loop;
        if v_super is not null then
          execute v_super;
        end if;
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        if v_pose is not null then
          execute v_pose;
        end if;
        if e.profil = 'postgres' then
          reset role;
          perform set_config('request.jwt.claims', '', true);
        elsif e.profil = 'comptable' then
          perform set_config('request.jwt.claims', json_build_object('sub', comptable, 'role', 'authenticated')::text, true);
        end if;
        begin
          execute v_req into v_obs;
          v_msg := coalesce(v_obs, '');
        exception when others then
          v_code := sqlstate;
          v_msg := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'ESSAI';
          v_msg := sqlstate || ' ' || sqlerrm;
        end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and v_msg = e.attendu, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le dossier jetable, ni ses factures, son import, son écriture, son assignation',
    'ok', not exists (select 1 from dossiers where id = dq::uuid)
      and not exists (select 1 from factures_emises where dossier_id = dq::uuid)
      and not exists (select 1 from imports_factures where dossier_id = dq::uuid)
      and not exists (select 1 from ecritures_brouillon where id = e1::uuid)
      and not exists (select 1 from dossier_assignations where dossier_id = dq::uuid),
    'observe', 'relu');
  perform set_config('essai.reprise_et_modele_comptable', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.reprise_et_modele_comptable')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
