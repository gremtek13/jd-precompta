-- LA VALIDATION D'UN EXERCICE REFUSE LES MANQUES DES VENTES FACTURÉES, ÉPROUVÉE EN BASE (chantier EC-Q3, ligne 28.65,
-- étape VF7b ; migration `validation_des_ventes_facturees`) — à rejouer par `execute_sql` après toute migration qui touche
-- `valider_exercice`, `ventes_facturees_de_l_exercice`, `ecritures_attendues_de_la_periode`, la composition d'une vente
-- facturée (`ecriture_attendue_vente_facturee`, `calcul_vente_facturee`, `encaissement_justifie_son_mouvement`,
-- `mouvement_libre`), `ecrire_vente_facturee`, `retirer_ecriture_vente_facturee`, les fonctions du registre et du
-- classement des encaissements, ou les gardes des écritures validées (`garder_ecritures_validees`, G5).
--
-- Ce qui se prouve ici — chaque refus jugé à son code ET à ses mots, ceux de la migration, que
-- src/lib/prealablesValidation.test.ts confronte à `REFUS_VENTES_FACTUREES_DE_LA_VALIDATION` et au texte exporté :
--   - LES TROIS MANQUES, DANS LEUR ORDRE, sur un dossier BASCULÉ en trésorerie (V), l'exercice 2025 nu, puis repris un
--     manque à la fois (1 à 31) : un mouvement RÉSERVÉ à l'encaissement d'une facture source, nommé AVANT un mouvement à
--     traiter plus ancien ; le débit réservé à une contre-passation ; puis les mouvements à traiter, sous les mots d'hier ;
--     un VIREMENT sans mouvement — ni un chèque plus ancien, ni un virement retiré, ni un virement défait par sa
--     contre-passation sans mouvement ne retiennent —, puis un PRÉLÈVEMENT ; puis chaque SOURCE en défaut, dans l'ordre
--     de `ventes_facturees_de_l_exercice` (la date de la première ligne qui diffère, le genre) : à écrire, qui ne s'écrit
--     pas (le compte à choisir ; une vente écartée), à réécrire (un chèque rattaché à un crédit de son jour), à retirer (un
--     encaissement retiré dont l'écriture proposée reste) ;
--   - LA VALIDATION, une fois tout repris (32 à 37) : elle passe, numérote et fige les lignes des ventes facturées —
--     exactement celles que la base recompose pour l'exercice ; ensuite, ni l'écriture ni le retrait d'une source de
--     l'exercice validé, ni la modification d'une de ses lignes ;
--   - EN ENGAGEMENT (W, 40 à 44) : la facture, écrite à sa date d'émission, se nomme la première ; écrite, l'exercice se
--     valide ;
--   - LA FENÊTRE PART DE LA FRONTIÈRE (P, Q et PE, 50 à 58) : une source de 2024 non écrite, d'avant la frontière de P
--     (2024 validé) — un chèque du 31 décembre, le jour même de la frontière, compris —, ne retient pas 2025 ; la même,
--     dans Q, où rien n'est validé, retient la validation de 2025 et se nomme sous son exercice — un premier exercice
--     validé ne fige pas un manque d'avant lui ; dans PE (engagement, 2024 validé), une facture de biens émise le 31
--     décembre et livrée en janvier : seule sa livraison est de la fenêtre, et la validation de 2025 la nomme sous 2025 —
--     l'émission, du jour de la frontière, n'en est pas ; écartée ensuite par un chèque illisible de 2025, elle ne se
--     nomme plus — sa date est d'un exercice validé —, le chèque qui la retient, si, sous 2025 ;
--   - UN DOSSIER QUI N'A PAS BASCULÉ (N, 60 à 63) : rien de neuf — le mouvement que cite l'encaissement d'une facture qui
--     n'est pas source se dit « à traiter », sous les mots d'hier ; un virement sans mouvement ne retient pas ; la
--     fonction neuve ne rend rien ;
--   - et que RIEN ne reste en base (199).
--
-- Six dossiers JETABLES du cabinet du dossier `test` : V (trésorerie), W et PE (engagement), P et Q (trésorerie) ont
-- basculé, N (trésorerie) non. Les factures se valident par leur fonction (`enregistrer_facture`) ; les encaissements et leurs parts
-- se posent par la porte de la restauration (le super-administrateur), aucune frontière ne la retenant ; les gestes sous
-- épreuve passent par les fonctions du cabinet (classer, rattacher, retirer, choisir le compte, écrire, retirer
-- l'écriture, valider). Les écritures envoyées sont celles que la base recompose, retenues avant (`AV`…), et la
-- numérotation celle que l'application enverrait — une écriture par source et par jour, au journal des ventes —, retenue
-- avant la validation (`NV`…). L'exercice 2024 de P et celui de PE se posent en direct par le propriétaire. Identifiants FIXES (préfixe
-- `7f7b0c00`). Tout se joue dans un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle
-- dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001) — le moteur d'étapes de ventesFacturees.sql,
-- ses genres et deux profils : « chef » (super-administrateur, chef du cabinet) et « postgres » (le propriétaire). Les
-- verdicts voyagent dans un réglage LOCAL à la transaction (`essai.validation_ventes`) : hors de l'outil d'exécution, le
-- fichier se joue en UNE transaction (`psql -1`). Aucune instruction de suppression, aucune mise à jour sans `where`.
--
-- ÉPROUVÉ LE 25/10/2026 SUR UNE RÉPLIQUE (PostgreSQL 16 : la production du jour, munie de VF5h2 et de VF7a, puis de la
-- migration ; et la production seule munie de la migration) : sans la migration, 81 verdicts, 45 en faute — la
-- validation d'hier accepte un virement et un prélèvement sans mouvement (8, 12, 31c) et chaque source qui n'est pas
-- écrite à jour (15, 18, 20, 22, 26, 29, 31d, 31f, 41, 53, 56, 58), dit « à traiter » un mouvement réservé (2, 4, 10,
-- 31b), et la fonction neuve manque au reste ; avec elle, 77 verdicts, 0 en faute, sur les deux bases. Ses mutations :
-- HISTORIQUE.md, « LA VALIDATION REFUSE LES MANQUES DES VENTES FACTURÉES ».
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cabinet uuid;
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text; attendu text; n bigint;
  tables text[] := array['dossiers', 'factures_emises', 'facture_lignes', 'facture_numerotation', 'lignes_bancaires',
    'encaissements_factures', 'encaissements_factures_taux', 'ecritures_brouillon', 'exercices_valides', 'soldes_reportes'];
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  select cabinet_id into cabinet from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24';
  if cabinet is null
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef') then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  ids := jsonb_build_object('CAB', cabinet,
      'V', '7f7b0c00-0000-4000-8000-0000000000d1', 'W', '7f7b0c00-0000-4000-8000-0000000000d2',
      'P', '7f7b0c00-0000-4000-8000-0000000000d3', 'Q', '7f7b0c00-0000-4000-8000-0000000000d4',
      'N', '7f7b0c00-0000-4000-8000-0000000000d5', 'PE', '7f7b0c00-0000-4000-8000-0000000000d6',
      'MX', '7f7b0c00-0000-4000-8000-000000000101', 'M1', '7f7b0c00-0000-4000-8000-000000000102',
      'MD', '7f7b0c00-0000-4000-8000-000000000103', 'M2', '7f7b0c00-0000-4000-8000-000000000104',
      'M3', '7f7b0c00-0000-4000-8000-000000000105', 'MW', '7f7b0c00-0000-4000-8000-000000000111',
      'MN', '7f7b0c00-0000-4000-8000-000000000121', 'MA', '7f7b0c00-0000-4000-8000-000000000106',
      'M10', '7f7b0c00-0000-4000-8000-000000000107', 'MZ', '7f7b0c00-0000-4000-8000-000000000108')
    || jsonb_build_object(
      'E1', '7f7b0c00-0000-4000-8000-000000000201', 'C1', '7f7b0c00-0000-4000-8000-000000000202',
      'E2', '7f7b0c00-0000-4000-8000-000000000203', 'E3', '7f7b0c00-0000-4000-8000-000000000204',
      'E4', '7f7b0c00-0000-4000-8000-000000000205', 'E5', '7f7b0c00-0000-4000-8000-000000000206',
      'E6', '7f7b0c00-0000-4000-8000-000000000207', 'CP6', '7f7b0c00-0000-4000-8000-000000000208',
      'E7', '7f7b0c00-0000-4000-8000-000000000209', 'E8', '7f7b0c00-0000-4000-8000-00000000020a',
      'E9', '7f7b0c00-0000-4000-8000-00000000020b', 'EW', '7f7b0c00-0000-4000-8000-000000000211',
      'EP', '7f7b0c00-0000-4000-8000-000000000221', 'EQ', '7f7b0c00-0000-4000-8000-000000000231',
      'EP2', '7f7b0c00-0000-4000-8000-000000000222', 'EPE', '7f7b0c00-0000-4000-8000-000000000251',
      'EN', '7f7b0c00-0000-4000-8000-000000000241', 'EN2', '7f7b0c00-0000-4000-8000-000000000242',
      'EA', '7f7b0c00-0000-4000-8000-00000000020c', 'EA2', '7f7b0c00-0000-4000-8000-00000000020d',
      'E10', '7f7b0c00-0000-4000-8000-00000000020e', 'CP10', '7f7b0c00-0000-4000-8000-00000000020f',
      'EZ', '7f7b0c00-0000-4000-8000-000000000210', 'EY', '7f7b0c00-0000-4000-8000-000000000212',
      'EX', '7f7b0c00-0000-4000-8000-000000000213', 'EZ2', '7f7b0c00-0000-4000-8000-000000000214',
      'EB', '7f7b0c00-0000-4000-8000-000000000215', 'MB', '7f7b0c00-0000-4000-8000-000000000109')
    || jsonb_build_object(
      'FJ', $m$'{"tiers_nom":"ESSAI","tiers_siret":"12345678900012","emetteur_nom":"ESSAI","montant_ht":100,"montant_tva":20,"montant_ttc":120,"nature_operation":"services"}'::jsonb$m$,
      'FJ2', $m$'{"tiers_nom":"ESSAI","tiers_siret":"12345678900012","emetteur_nom":"ESSAI","montant_ht":1000,"montant_tva":200,"montant_ttc":1200,"nature_operation":"services"}'::jsonb$m$,
      'L1', $m$'[{"designation":"x","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb$m$,
      'L2', $m$'[{"designation":"x","quantite":1,"prix_unitaire_ht":1000,"taux_tva":20}]'::jsonb$m$,
      'ENF', $m$select enregistrer_facture($m$,
      'ENI', $m$insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values$m$,
      'PAR', $m$insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values$m$,
      'MVT', $m$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values$m$,
      'CLA', $m$select classer_mouvement_par_encaissements($m$,
      'RAT', $m$select rattacher_mouvement_encaissement($m$,
      'RET', $m$select retirer_encaissement($m$,
      'VAL', $m$select valider_exercice($m$,
      -- Ce que la base recompose, prêt à écrire : chaque source de la période qui s'écrit, ses lignes sous la forme
      -- qu'`ecrire_vente_facturee` reçoit. Retenu par le propriétaire (la recomposition ne s'exécute pas en RPC).
      'AEC', $m$select coalesce(jsonb_agg(jsonb_build_object('genre', b.genre, 'id', b.source_id, 'lignes', (select jsonb_agg(jsonb_build_object('date', split_part(a, '|', 1), 'compte', split_part(a, '|', 2), 'sens', split_part(a, '|', 3), 'montant', round(split_part(a, '|', 4)::numeric / 100, 2), 'ligne_bancaire_id', nullif(split_part(a, '|', 5), ''), 'libelle', 'ESSAI')) from unnest(b.lignes) a))), '[]')::text from ecritures_attendues_de_la_periode($m$,
      'AFI', $m$) b where b.motif is null and cardinality(b.lignes) > 0$m$,
      'ECR', $m$select count(ecrire_vente_facturee($m$,
      'EAR', $m$, x.genre, x.id, x.lignes)) from jsonb_to_recordset($m$,
      'EFI', $m$::jsonb) x(genre text, id uuid, lignes jsonb)$m$,
      -- La numérotation que l'application enverrait : une écriture par source et par jour, au journal des ventes.
      'NUM', $m$select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'journal', 'VE', 'numero', z.n, 'piece_ref', 'Pièce essai ' || z.n, 'piece_date', z.date, 'compte_lib', 'Compte ' || z.compte) order by z.n, z.id), '[]')::text from (select b.id, b.date, b.compte, dense_rank() over (order by b.date, coalesce(b.facture_id, b.encaissement_id, b.ligne_bancaire_id)) as n from ecritures_brouillon b where b.date between '2025-01-01' and '2025-12-31' and b.dossier_id = $m$,
      'NFI', $m$) z$m$,
      -- Les sources en défaut d'un exercice, dans l'ordre où la validation nomme la première : état, motif, nom.
      'LIS', $m$select coalesce(string_agg(v.etat || ':' || coalesce(v.motif, '') || ':' || v.nom, ' | ' order by v.o), '∅') from ventes_facturees_de_l_exercice($m$,
      'LFI', $m$) with ordinality v(source, source_id, jour, etat, motif, detail, nom, o)$m$);

  foreach cle in array tables loop
    execute format('select count(*) from %I', cle) into n;
    avant := concat_ws('/', avant, n);
  end loop;

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (exact, ou motif LIKE fini par « % ») ou valeur}.
  etapes := array[
    -- ══ Le jeu ══════════
    -- V naît sans avoir basculé : sa facture FA, validée avant la bascule, n'est pas source de sa vente ; les trois suivantes
    -- le sont.
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures) values
      ('{V}', 'ESSAI VF7B V', '{CAB}', 'tresorerie', '455000', false), ('{W}', 'ESSAI VF7B W', '{CAB}', 'engagement', '455000', true),
      ('{P}', 'ESSAI VF7B P', '{CAB}', 'tresorerie', '455000', true), ('{Q}', 'ESSAI VF7B Q', '{CAB}', 'tresorerie', '455000', true),
      ('{N}', 'ESSAI VF7B N', '{CAB}', 'tresorerie', '455000', false), ('{PE}', 'ESSAI VF7B PE', '{CAB}', 'engagement', '455000', true)$q$, '', ''],
    -- Les mouvements de V : MX, à traiter, qui ne doit rien aux ventes, plus ancien que tout ; MA, le crédit d'un encaissement
    -- de FA ; M10, le crédit d'E10, que sa contre-passation sans mouvement défait ; M1, le crédit d'E1 ; MD, le débit de sa
    -- contre-passation.
    array['jeu', 'les mouvements de V', 'postgres', $q${MVT} ('{MX}', '{V}', '2025-01-15', 'ESSAI', 5, 'non_rapprochee'),
      ('{MA}', '{V}', '2025-02-10', 'ESSAI', 70, 'non_rapprochee'), ('{M10}', '{V}', '2025-02-20', 'ESSAI', 120, 'non_rapprochee'),
      ('{M1}', '{V}', '2025-03-10', 'ESSAI', 120, 'non_rapprochee'), ('{MD}', '{V}', '2025-05-10', 'ESSAI', -120, 'non_rapprochee'),
      ('{MB}', '{V}', '2025-02-25', 'ESSAI', 10, 'non_rapprochee')$q$, '', ''],
    array['fait', '0. le jeu : F2025-0001 de V, avant la bascule', 'chef', $q${ENF}'{V}', null, {FJ} || '{"date_emission":"2025-02-01"}', {L1}, true)$q$, 'OK', ''],
    array['retenir', 'FA', 'postgres', $q$select id::text from factures_emises where dossier_id = '{V}' and numero = 'F2025-0001' and not source_de_la_vente$q$, '', ''],
    array['jeu', 'V bascule', 'postgres', $q$update dossiers set ventes_par_les_factures = true where id = '{V}'$q$, '', ''],
    array['fait', '0. le jeu : F2025-0002 de V (120 € TTC)', 'chef', $q${ENF}'{V}', null, {FJ} || '{"date_emission":"2025-03-01"}', {L1}, true)$q$, 'OK', ''],
    array['retenir', 'F1', 'postgres', $q$select id::text from factures_emises where dossier_id = '{V}' and numero = 'F2025-0002' and source_de_la_vente$q$, '', ''],
    array['fait', '0. le jeu : F2025-0003 de V (1 200 € TTC)', 'chef', $q${ENF}'{V}', null, {FJ2} || '{"date_emission":"2025-04-01"}', {L2}, true)$q$, 'OK', ''],
    array['retenir', 'F2', 'postgres', $q$select id::text from factures_emises where dossier_id = '{V}' and numero = 'F2025-0003'$q$, '', ''],
    array['fait', '0. le jeu : F2025-0004 de V (120 € TTC)', 'chef', $q${ENF}'{V}', null, {FJ} || '{"date_emission":"2025-09-01"}', {L1}, true)$q$, 'OK', ''],
    array['retenir', 'F3', 'postgres', $q$select id::text from factures_emises where dossier_id = '{V}' and numero = 'F2025-0004'$q$, '', ''],
    -- EA sur MA et EA2, un virement sans mouvement : deux encaissements de FA, qui n'est pas source. E10 sur M10, du même
    -- jour, et CP10, sa contre-passation sans mouvement, qui le défait. E1 sur M1, du même jour, et C1, sa contre-passation
    -- sur MD ; E2, un virement sans mouvement ; E3, un chèque sans mouvement, plus ancien ; E4, un prélèvement sans
    -- mouvement ; E5, un virement sans mouvement, plus ancien, que le cabinet retire ; E6, un virement sans mouvement, plus
    -- ancien, défait par CP6, sa contre-passation sans mouvement ; E7, un chèque de juillet ; E8, une compensation sans
    -- compte choisi ; E9, l'encaissement illisible de F2025-0004 (ses parts ne font pas son montant), qui écarte sa vente.
    array['fait', '0. le jeu : les encaissements de V, par la porte de la restauration', 'chef', $q${ENI}
      ('{EA}', '{V}', '{FA}', '2025-02-10', 70, 'virement', '{MA}', null, null),
      ('{EA2}', '{V}', '{FA}', '2025-02-05', 50, 'virement', null, null, null),
      ('{E10}', '{V}', '{F2}', '2025-02-20', 120, 'virement', '{M10}', null, null),
      ('{EB}', '{V}', '{F2}', '2025-02-25', 10, 'virement', '{MB}', null, null),
      ('{CP10}', '{V}', '{F2}', '2025-02-21', -120, 'virement', null, '{E10}', 'ESSAI'),
      ('{E1}', '{V}', '{F1}', '2025-03-10', 120, 'virement', '{M1}', null, null),
      ('{C1}', '{V}', '{F1}', '2025-05-10', -120, 'virement', '{MD}', '{E1}', 'ESSAI'),
      ('{E2}', '{V}', '{F2}', '2025-04-15', 120, 'virement', null, null, null),
      ('{E3}', '{V}', '{F2}', '2025-04-10', 60, 'cheque', null, null, null),
      ('{E4}', '{V}', '{F2}', '2025-04-20', 120, 'prelevement', null, null, null),
      ('{E5}', '{V}', '{F2}', '2025-04-05', 120, 'virement', null, null, null),
      ('{E6}', '{V}', '{F2}', '2025-04-06', 120, 'virement', null, null, null),
      ('{CP6}', '{V}', '{F2}', '2025-04-07', -120, 'virement', null, '{E6}', 'ESSAI'),
      ('{E7}', '{V}', '{F2}', '2025-07-01', 50, 'cheque', null, null, null),
      ('{E8}', '{V}', '{F2}', '2025-08-01', 30, 'compensation', null, null, null),
      ('{E9}', '{V}', '{F3}', '2025-09-05', 120, 'cheque', null, null, null);
      {PAR} ('{EA}', '{V}', 20, 70), ('{EA2}', '{V}', 20, 50), ('{E10}', '{V}', 20, 120), ('{CP10}', '{V}', 20, -120), ('{EB}', '{V}', 20, 10),
      ('{E1}', '{V}', 20, 120), ('{C1}', '{V}', 20, -120), ('{E2}', '{V}', 20, 120), ('{E3}', '{V}', 20, 60),
      ('{E4}', '{V}', 20, 120), ('{E5}', '{V}', 20, 120), ('{E6}', '{V}', 20, 120), ('{CP6}', '{V}', 20, -120),
      ('{E7}', '{V}', 20, 50), ('{E8}', '{V}', 20, 30), ('{E9}', '{V}', 20, 119.99)$q$, 'OK', ''],
    array['fait', '0. le jeu : le cabinet retire E5 et EB', 'chef', $q${RET}'{V}', '{E5}'); {RET}'{V}', '{EB}')$q$, 'OK', ''],

    -- ══ 1 à 31. Les manques de V, dans leur ordre ══════════
    array['valeur', '1. au départ, chaque source de V en défaut, dans l''ordre de la validation : l''état, le motif et le nom', 'postgres', $q${LIS}'{V}', 2025{LFI}$q$, '',
      'a_ecrire::l''encaissement du 20/02/2025 de la facture F2025-0003 | a_ecrire::la contre-passation du 21/02/2025 de la facture F2025-0003 | a_ecrire::l''encaissement du 10/03/2025 de la facture F2025-0002 | a_ecrire::l''encaissement du 06/04/2025 de la facture F2025-0003 | a_ecrire::la contre-passation du 07/04/2025 de la facture F2025-0003 | a_ecrire::l''encaissement du 10/04/2025 de la facture F2025-0003 | a_ecrire::l''encaissement du 15/04/2025 de la facture F2025-0003 | a_ecrire::l''encaissement du 20/04/2025 de la facture F2025-0003 | a_ecrire::la contre-passation du 10/05/2025 de la facture F2025-0002 | a_ecrire::l''encaissement du 01/07/2025 de la facture F2025-0003 | ne_s_ecrit_pas:compte_a_choisir:l''encaissement du 01/08/2025 de la facture F2025-0003 | ne_s_ecrit_pas:vente_ecartee:la facture F2025-0004 | ne_s_ecrit_pas:vente_ecartee:l''encaissement du 05/09/2025 de la facture F2025-0004'],
    array['controle', '2. un mouvement réservé à l''encaissement d''une facture source : nommé avant les mouvements à traiter plus anciens — le crédit d''une facture d''avant la bascule, celui d''un encaissement défait, celui qui ne doit rien aux ventes', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte un mouvement du 10/03/2025 réservé à l''encaissement de la facture F2025-0002 : le classer par ses encaissements avant la validation.'],
    array['fait', '3. le cabinet classe M1 par ses encaissements', 'chef', $q${CLA}'{V}', '{M1}')$q$, 'OK', ''],
    array['controle', '4. un débit réservé à la contre-passation d''un encaissement : sous ses mots à lui', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte un mouvement du 10/05/2025 réservé à la contre-passation d''un encaissement de la facture F2025-0002 : le classer par ses contre-passations avant la validation.'],
    array['fait', '5. le cabinet classe MD par ses contre-passations', 'chef', $q${CLA}'{V}', '{MD}')$q$, 'OK', ''],
    array['controle', '6. puis les mouvements à traiter, sous les mots d''hier', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte des mouvements bancaires à traiter : ils se traitent avant la validation.'],
    array['fait', '7. MX, MA, M10 et MB ignorés', 'postgres', $q$update lignes_bancaires set statut = 'ignoree' where id in ('{MX}', '{MA}', '{M10}', '{MB}')$q$, 'OK', ''],
    array['controle', '8. un virement sans mouvement : ni celui d''une facture d''avant la bascule, ni le chèque plus ancien, ni le virement retiré, ni le virement défait par sa contre-passation sans mouvement, ni cette contre-passation ne retiennent', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte un encaissement de la facture F2025-0003 par virement du 15/04/2025, sans son mouvement : il manque au relevé, ou n''y est pas rattaché — le rattacher avant la validation.'],
    array['jeu', 'M2, le crédit d''E2', 'postgres', $q${MVT} ('{M2}', '{V}', '2025-04-15', 'ESSAI', 120, 'non_rapprochee')$q$, '', ''],
    array['fait', '9. le cabinet rattache E2 à M2', 'chef', $q${RAT}'{V}', '{E2}', '{M2}')$q$, 'OK', ''],
    array['controle', '10. rattaché, E2 réserve M2 : nommé avant tout encaissement', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte un mouvement du 15/04/2025 réservé à l''encaissement de la facture F2025-0003 : le classer par ses encaissements avant la validation.'],
    array['fait', '11. le cabinet classe M2', 'chef', $q${CLA}'{V}', '{M2}')$q$, 'OK', ''],
    array['controle', '12. puis le prélèvement sans mouvement', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte un encaissement de la facture F2025-0003 par prélèvement du 20/04/2025, sans son mouvement : il manque au relevé, ou n''y est pas rattaché — le rattacher avant la validation.'],
    array['fait', '13. le cabinet retire E4, jamais déclaré', 'chef', $q${RET}'{V}', '{E4}')$q$, 'OK', ''],
    array['valeur', '14. les sources en défaut : E4, retiré sans écriture, n''y est plus', 'postgres', $q${LIS}'{V}', 2025{LFI}$q$, '',
      'a_ecrire::l''encaissement du 20/02/2025 de la facture F2025-0003 | a_ecrire::la contre-passation du 21/02/2025 de la facture F2025-0003 | a_ecrire::l''encaissement du 10/03/2025 de la facture F2025-0002 | a_ecrire::l''encaissement du 06/04/2025 de la facture F2025-0003 | a_ecrire::la contre-passation du 07/04/2025 de la facture F2025-0003 | a_ecrire::l''encaissement du 10/04/2025 de la facture F2025-0003 | a_ecrire::l''encaissement du 15/04/2025 de la facture F2025-0003 | a_ecrire::la contre-passation du 10/05/2025 de la facture F2025-0002 | a_ecrire::l''encaissement du 01/07/2025 de la facture F2025-0003 | ne_s_ecrit_pas:compte_a_choisir:l''encaissement du 01/08/2025 de la facture F2025-0003 | ne_s_ecrit_pas:vente_ecartee:la facture F2025-0004 | ne_s_ecrit_pas:vente_ecartee:l''encaissement du 05/09/2025 de la facture F2025-0004'],
    array['controle', '15. puis la première source à écrire', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte une vente facturée qui n''est pas écrite : l''encaissement du 20/02/2025 de la facture F2025-0003 — l''écrire avant la validation.'],
    array['retenir', 'AV1', 'postgres', $q${AEC}'{V}', null, '2025-12-31'{AFI}$q$, '', ''],
    array['fait', '16. le cabinet écrit chaque source qui s''écrit, telle que la base la recompose', 'chef', $q${ECR}'{V}'{EAR}'{AV1}'{EFI}$q$, 'OK', ''],
    array['valeur', '17. restent les sources qui ne s''écrivent pas', 'postgres', $q${LIS}'{V}', 2025{LFI}$q$, '',
      'ne_s_ecrit_pas:compte_a_choisir:l''encaissement du 01/08/2025 de la facture F2025-0003 | ne_s_ecrit_pas:vente_ecartee:la facture F2025-0004 | ne_s_ecrit_pas:vente_ecartee:l''encaissement du 05/09/2025 de la facture F2025-0004'],
    array['controle', '18. une source qui ne s''écrit pas : le compte de contrepartie à choisir', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte une vente facturée qui ne s''écrit pas : l''encaissement du 01/08/2025 de la facture F2025-0003 — lever ce qui la retient avant la validation.'],
    array['fait', '19. le cabinet choisit le compte de contrepartie d''E8', 'chef', $q$select choisir_compte_contrepartie('{V}', '{E8}', '467000')$q$, 'OK', ''],
    array['controle', '20. son compte choisi, E8 est à écrire : nommé avant la vente écartée, plus tardive', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte une vente facturée qui n''est pas écrite : l''encaissement du 01/08/2025 de la facture F2025-0003 — l''écrire avant la validation.'],
    array['retenir', 'AV2', 'postgres', $q${AEC}'{V}', null, '2025-12-31'{AFI}$q$, '', ''],
    array['fait', '21. le cabinet écrit E8', 'chef', $q${ECR}'{V}'{EAR}'{AV2}'{EFI}$q$, 'OK', ''],
    array['controle', '22. puis la vente écartée : la facture, avant son encaissement illisible', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte une vente facturée qui ne s''écrit pas : la facture F2025-0004 — lever ce qui la retient avant la validation.'],
    array['fait', '23. le cabinet retire E9, l''encaissement illisible', 'chef', $q${RET}'{V}', '{E9}')$q$, 'OK', ''],
    array['valeur', '24. plus rien en défaut', 'postgres', $q${LIS}'{V}', 2025{LFI}$q$, '', '∅'],
    -- À réécrire : E3, le chèque sans mouvement, écrit aux valeurs à l'encaissement, se rattache au crédit de son jour —
    -- il s'écrit désormais sur la banque de ce crédit.
    array['jeu', 'M3, un crédit du jour d''E3', 'postgres', $q${MVT} ('{M3}', '{V}', '2025-04-10', 'ESSAI', 60, 'non_rapprochee')$q$, '', ''],
    array['fait', '25. le cabinet rattache E3 à M3, et classe M3', 'chef', $q${RAT}'{V}', '{E3}', '{M3}'); {CLA}'{V}', '{M3}')$q$, 'OK', ''],
    array['controle', '26. une source dont l''écriture proposée n''est plus celle qu''elle commande', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte une vente facturée dont l''écriture proposée n''est plus celle que sa source commande : l''encaissement du 10/04/2025 de la facture F2025-0003 — la réécrire avant la validation.'],
    array['retenir', 'AV3', 'postgres', $q${AEC}'{V}', null, '2025-12-31'{AFI}$q$, '', ''],
    array['fait', '27. le cabinet réécrit E3', 'chef', $q${ECR}'{V}'{EAR}'{AV3}'{EFI}$q$, 'OK', ''],
    -- À retirer : E7, écrit, se retire ; son écriture proposée reste.
    array['fait', '28. le cabinet retire E7, jamais déclaré', 'chef', $q${RET}'{V}', '{E7}')$q$, 'OK', ''],
    array['controle', '29. l''écriture proposée d''une source qui n''a plus rien à écrire', 'chef', $q${VAL}'{V}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte l''écriture proposée d''une vente facturée qui n''a plus rien à écrire : l''encaissement du 01/07/2025 de la facture F2025-0003 — la retirer avant la validation.'],
    array['fait', '30. le cabinet retire l''écriture d''E7', 'chef', $q$select retirer_ecriture_vente_facturee('{V}', 'encaissement', '{E7}')$q$, 'OK', ''],
    array['valeur', '31. plus rien en défaut', 'postgres', $q${LIS}'{V}', 2025{LFI}$q$, '', '∅'],
    -- Les bornes : le 31 décembre retient, le 1er janvier suivant ne retient pas ; et une ligne proposée en double.
    array['retenir', 'NV', 'postgres', $q${NUM}'{V}'{NFI}$q$, '', ''],
    array['controle', '31b. un mouvement réservé du 31 décembre retient, sous la facture de son premier encaissement', 'chef', $q${MVT} ('{MZ}', '{V}', '2025-12-31', 'ESSAI', 10, 'non_rapprochee'); {ENI} ('{EZ}', '{V}', '{F2}', '2025-12-31', 5, 'cheque', '{MZ}', null, null); {ENI} ('{EZ2}', '{V}', '{F1}', '2025-12-31', 5, 'cheque', '{MZ}', null, null); {PAR} ('{EZ}', '{V}', 20, 5), ('{EZ2}', '{V}', 20, 5); {VAL}'{V}', 2025, '{NV}'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte un mouvement du 31/12/2025 réservé à l''encaissement de la facture F2025-0003 : le classer par ses encaissements avant la validation.'],
    array['controle', '31c. … un virement sans mouvement du 31 décembre aussi', 'chef', $q${ENI} ('{EZ}', '{V}', '{F2}', '2025-12-31', 5, 'virement', null, null, null); {PAR} ('{EZ}', '{V}', 20, 5); {VAL}'{V}', 2025, '{NV}'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte un encaissement de la facture F2025-0003 par virement du 31/12/2025, sans son mouvement : il manque au relevé, ou n''y est pas rattaché — le rattacher avant la validation.'],
    array['controle', '31d. … et une source du 31 décembre à écrire', 'chef', $q${ENI} ('{EZ}', '{V}', '{F2}', '2025-12-31', 5, 'cheque', null, null, null); {PAR} ('{EZ}', '{V}', 20, 5); {VAL}'{V}', 2025, '{NV}'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte une vente facturée qui n''est pas écrite : l''encaissement du 31/12/2025 de la facture F2025-0003 — l''écrire avant la validation.'],
    array['controle', '31e. MUTATION de 31b à 31d : les trois du 1er janvier suivant ne retiennent pas 2025', 'chef', $q${MVT} ('{MZ}', '{V}', '2026-01-01', 'ESSAI', 5, 'non_rapprochee'); {ENI} ('{EZ}', '{V}', '{F2}', '2026-01-01', 5, 'cheque', '{MZ}', null, null), ('{EY}', '{V}', '{F2}', '2026-01-01', 5, 'virement', null, null, null), ('{EX}', '{V}', '{F2}', '2026-01-01', 5, 'cheque', null, null, null); {PAR} ('{EZ}', '{V}', 20, 5), ('{EY}', '{V}', 20, 5), ('{EX}', '{V}', 20, 5); {VAL}'{V}', 2025, '{NV}'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],
    array['controle', '31f. une ligne proposée en double, par la porte de la restauration : la source est à réécrire', 'chef', $q$insert into ecritures_brouillon (dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut, encaissement_id) select b.dossier_id, b.ligne_bancaire_id, b.date, b.compte, b.libelle, b.montant, b.sens, b.statut, b.encaissement_id from ecritures_brouillon b where b.encaissement_id = '{E1}' order by b.compte limit 1; {VAL}'{V}', 2025, '{NV}'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte une vente facturée dont l''écriture proposée n''est plus celle que sa source commande : l''encaissement du 10/03/2025 de la facture F2025-0002 — la réécrire avant la validation.'],

    -- ══ 32 à 37. La validation, puis l'exercice figé ══════════
    array['fait', '32. tout repris, l''exercice 2025 de V se valide', 'chef', $q${VAL}'{V}', 2025, '{NV}'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],
    array['valeur', '33. ses lignes, toutes validées et numérotées au journal des ventes, sont exactement celles que la base recompose pour l''exercice', 'postgres', $q$select (count(*) filter (where b.statut = 'validee' and b.journal_code = 'VE' and b.numero_ecriture is not null) = count(*))::text || ' ' || count(*) || ' ' || (count(*) = (select sum(cardinality(r.lignes)) from ecritures_attendues_de_la_periode('{V}', null, '2025-12-31') r))::text from ecritures_brouillon b where b.dossier_id = '{V}' and b.date between '2025-01-01' and '2025-12-31'$q$, '',
      'true 27 true'],
    array['controle', '34. ensuite, une source de l''exercice validé ne s''écrit plus', 'chef', $q${ECR}'{V}'{EAR}(select jsonb_agg(x)::text from jsonb_array_elements('{AV1}'::jsonb) x where x ->> 'id' = '{E1}'){EFI}$q$, '22023',
      'L''exercice 2025 est validé : aucune écriture ne s''y passe plus.'],
    array['controle', '35. … ne se retire plus', 'chef', $q$select retirer_ecriture_vente_facturee('{V}', 'encaissement', '{E1}')$q$, '22023',
      'Les écritures de cette source sont validées : elles ne se retirent plus.'],
    array['controle', '36. … et l''une de ses lignes ne se modifie plus, même par le propriétaire', 'postgres', $q$update ecritures_brouillon set libelle = 'ESSAI MODIFIÉ' where encaissement_id = '{E1}' and statut = 'validee'$q$, '23514',
      'Cette écriture est validée (exercice 2025) : elle ne se modifie plus.'],
    array['valeur', '37. la frontière posée, plus rien en défaut sur 2025', 'postgres', $q${LIS}'{V}', 2025{LFI}$q$, '', '∅'],

    -- ══ 40 à 44. En engagement : W ══════════
    array['jeu', 'MW, le crédit d''EW', 'postgres', $q${MVT} ('{MW}', '{W}', '2025-02-15', 'ESSAI', 120, 'non_rapprochee')$q$, '', ''],
    array['fait', '0. le jeu : F2025-0001 de W', 'chef', $q${ENF}'{W}', null, {FJ} || '{"date_emission":"2025-02-01"}', {L1}, true)$q$, 'OK', ''],
    array['retenir', 'FW', 'postgres', $q$select id::text from factures_emises where dossier_id = '{W}' and numero = 'F2025-0001'$q$, '', ''],
    array['fait', '0. le jeu : EW sur MW, du même jour, que le cabinet classe', 'chef', $q${ENI} ('{EW}', '{W}', '{FW}', '2025-02-15', 120, 'virement', '{MW}', null, null); {PAR} ('{EW}', '{W}', 20, 120); {CLA}'{W}', '{MW}')$q$, 'OK', ''],
    array['valeur', '40. en engagement, la facture s''écrit à son émission : elle se nomme la première', 'postgres', $q${LIS}'{W}', 2025{LFI}$q$, '',
      'a_ecrire::la facture F2025-0001 | a_ecrire::l''encaissement du 15/02/2025 de la facture F2025-0001'],
    array['controle', '41. la validation la nomme', 'chef', $q${VAL}'{W}', 2025, '[]'::jsonb, '[]'::jsonb, null)$q$, '23514',
      'L''exercice 2025 porte une vente facturée qui n''est pas écrite : la facture F2025-0001 — l''écrire avant la validation.'],
    array['retenir', 'AW', 'postgres', $q${AEC}'{W}', null, '2025-12-31'{AFI}$q$, '', ''],
    array['fait', '42. le cabinet écrit chaque source de W', 'chef', $q${ECR}'{W}'{EAR}'{AW}'{EFI}$q$, 'OK', ''],
    array['retenir', 'NW', 'postgres', $q${NUM}'{W}'{NFI}$q$, '', ''],
    array['fait', '43. l''exercice 2025 de W se valide', 'chef', $q${VAL}'{W}', 2025, '{NW}'::jsonb, '[]'::jsonb, null)$q$, 'OK', ''],
    array['valeur', '44. ses lignes, toutes validées, sont celles que la base recompose', 'postgres', $q$select (count(*) filter (where b.statut = 'validee') = count(*))::text || ' ' || count(*) || ' ' || (count(*) = (select sum(cardinality(r.lignes)) from ecritures_attendues_de_la_periode('{W}', null, '2025-12-31') r))::text from ecritures_brouillon b where b.dossier_id = '{W}' and b.date between '2025-01-01' and '2025-12-31'$q$, '',
      'true 7 true'],

    -- ══ 50 à 55. La fenêtre part de la frontière : P et Q ══════════
    array['fait', '0. le jeu : F2024-0001 de P et de Q', 'chef', $q${ENF}'{P}', null, {FJ} || '{"date_emission":"2024-06-01"}', {L1}, true); {ENF}'{Q}', null, {FJ} || '{"date_emission":"2024-06-01"}', {L1}, true)$q$, 'OK', ''],
    array['retenir', '*', 'postgres', $q$select jsonb_build_object('FP', (select id from factures_emises where dossier_id = '{P}' and numero = 'F2024-0001'), 'FQ', (select id from factures_emises where dossier_id = '{Q}' and numero = 'F2024-0001'))::text$q$, '', ''],
    array['fait', '0. le jeu : un chèque de 2024 sans mouvement pour chacune, jamais écrit ; dans P, un second, du 31 décembre', 'chef', $q${ENI} ('{EP}', '{P}', '{FP}', '2024-06-10', 100, 'cheque', null, null, null), ('{EP2}', '{P}', '{FP}', '2024-12-31', 20, 'cheque', null, null, null), ('{EQ}', '{Q}', '{FQ}', '2024-06-10', 120, 'cheque', null, null, null); {PAR} ('{EP}', '{P}', 20, 100), ('{EP2}', '{P}', 20, 20), ('{EQ}', '{Q}', 20, 120)$q$, 'OK', ''],
    array['jeu', 'l''exercice 2024 validé dans P, en direct', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{P}', 2024, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('d', 64), '{}')$q$, '', ''],
    array['valeur', '50. P : les chèques de 2024, celui du jour même de la frontière compris, sont d''avant elle ; 2025 n''a rien en défaut', 'postgres', $q${LIS}'{P}', 2025{LFI}$q$, '', '∅'],
    array['fait', '51. … et 2025 se valide', 'chef', $q${VAL}'{P}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],
    array['valeur', '52. Q, où rien n''est validé : le chèque de 2024 est dans la fenêtre de 2025', 'postgres', $q${LIS}'{Q}', 2025{LFI}$q$, '',
      'a_ecrire::l''encaissement du 10/06/2024 de la facture F2024-0001'],
    array['controle', '53. … et retient la validation de 2025, nommé sous son exercice', 'chef', $q${VAL}'{Q}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2024 porte une vente facturée qui n''est pas écrite : l''encaissement du 10/06/2024 de la facture F2024-0001 — l''écrire avant la validation.'],
    array['controle', '54. MUTATION de 53 : la frontière de P posée dans Q, il ne retient plus', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{Q}', 2024, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('d', 64), '{}'); select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true); {VAL}'{Q}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],
    array['valeur', '55. une fonction neuve qui ne s''exécute pas sans exercice', 'postgres', $q$select count(*)::text from ventes_facturees_de_l_exercice('{Q}', null)$q$, '', '0'],
    -- PE : la facture de biens émise le 31 décembre 2024, livrée le 15 janvier 2025 ; l'exercice 2024 validé ensuite.
    array['fait', '0. le jeu : F2024-0001 de PE, des biens émis le 31 décembre et livrés en janvier', 'chef', $q${ENF}'{PE}', null, {FJ} || '{"date_emission":"2024-12-31","nature_operation":"biens","date_prestation":"2025-01-15"}', {L1}, true)$q$, 'OK', ''],
    array['jeu', 'l''exercice 2024 validé dans PE, en direct', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{PE}', 2024, now(), '{CHEF}', 'engagement', 0, 0, 0, 0, repeat('e', 64), null)$q$, '', ''],
    array['controle', '56. PE : la livraison d''après la frontière est à écrire, et se nomme sous son exercice — l''émission, du jour de la frontière, n''en est pas', 'chef', $q${VAL}'{PE}', 2025, '[]'::jsonb, '[]'::jsonb, null)$q$, '23514',
      'L''exercice 2025 porte une vente facturée qui n''est pas écrite : la facture F2024-0001 — l''écrire avant la validation.'],
    array['retenir', 'FPE', 'postgres', $q$select id::text from factures_emises where dossier_id = '{PE}' and numero = 'F2024-0001'$q$, '', ''],
    array['fait', '0. le jeu : dans PE, un chèque de 2025 illisible (ses parts ne font pas son montant), qui écarte la vente', 'chef', $q${ENI} ('{EPE}', '{PE}', '{FPE}', '2025-02-01', 60, 'cheque', null, null, null); {PAR} ('{EPE}', '{PE}', 20, 59.99)$q$, 'OK', ''],
    array['valeur', '57. PE : la vente écartée, la facture ne se nomme pas — sa date est d''un exercice validé —, le chèque qui la retient, si', 'postgres', $q${LIS}'{PE}', 2025{LFI}$q$, '',
      'ne_s_ecrit_pas:vente_ecartee:l''encaissement du 01/02/2025 de la facture F2024-0001'],
    array['controle', '58. … et la validation de 2025 le nomme, sous 2025', 'chef', $q${VAL}'{PE}', 2025, '[]'::jsonb, '[]'::jsonb, null)$q$, '23514',
      'L''exercice 2025 porte une vente facturée qui ne s''écrit pas : l''encaissement du 01/02/2025 de la facture F2024-0001 — lever ce qui la retient avant la validation.'],

    -- ══ 60 à 63. Un dossier qui n'a pas basculé : N ══════════
    array['jeu', 'MN, un crédit que cite l''encaissement d''une facture qui n''est pas source', 'postgres', $q${MVT} ('{MN}', '{N}', '2025-03-06', 'ESSAI', 120, 'non_rapprochee')$q$, '', ''],
    array['fait', '0. le jeu : F2025-0001 de N, qui n''est pas source', 'chef', $q${ENF}'{N}', null, {FJ} || '{"date_emission":"2025-03-01"}', {L1}, true)$q$, 'OK', ''],
    array['retenir', 'FN', 'postgres', $q$select id::text from factures_emises where dossier_id = '{N}' and numero = 'F2025-0001' and not source_de_la_vente$q$, '', ''],
    array['fait', '0. le jeu : un virement sans mouvement, et un autre sur MN', 'chef', $q${ENI} ('{EN}', '{N}', '{FN}', '2025-03-05', 50, 'virement', null, null, null), ('{EN2}', '{N}', '{FN}', '2025-03-06', 70, 'virement', '{MN}', null, null); {PAR} ('{EN}', '{N}', 20, 50), ('{EN2}', '{N}', 20, 70)$q$, 'OK', ''],
    array['controle', '60. N : le mouvement d''un encaissement qui n''est pas source se dit à traiter, sous les mots d''hier', 'chef', $q${VAL}'{N}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514',
      'L''exercice 2025 porte des mouvements bancaires à traiter : ils se traitent avant la validation.'],
    array['fait', '61. MN ignoré', 'postgres', $q$update lignes_bancaires set statut = 'ignoree' where id = '{MN}'$q$, 'OK', ''],
    array['valeur', '62. la fonction neuve ne rend rien', 'postgres', $q$select count(*)::text from ventes_facturees_de_l_exercice('{N}', 2025)$q$, '', '0'],
    array['fait', '63. et le virement sans mouvement ne retient pas : 2025 se valide', 'chef', $q${VAL}'{N}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, 'OK', '']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      attendu := etape[6];
      for cle, valeur in select key, value from jsonb_each_text(ids || jsonb_build_object('CHEF', chef)) loop
        s := replace(s, '{' || cle || '}', valeur);
        attendu := replace(attendu, '{' || cle || '}', valeur);
      end loop;
      accepte := false; code_recu := null; message := null; obs := null;
      if etape[1] = 'jeu' then
        begin
          execute s;
        exception when others then
          verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
        end;
      elsif etape[1] = 'retenir' then
        begin
          execute s into obs;
        exception when others then obs := null;
        end;
        if obs is null then
          verdicts := verdicts || jsonb_build_object('controle', '0. retenir ' || etape[2], 'observe', 'rien à retenir', 'ok', false);
        elsif etape[2] = '*' then
          ids := ids || obs::jsonb;
        else
          ids := ids || jsonb_build_object(etape[2], obs);
        end if;
      elsif etape[1] = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = attendu, false));
      else
        begin
          if etape[3] <> 'postgres' then
            set local role authenticated;
            perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
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
        verdicts := verdicts || jsonb_build_object('controle', etape[2],
          'observe', case when accepte then 'accepté' else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
          'ok', case when etape[5] = 'OK' then accepte and (etape[1] = 'fait' or coalesce(code_recu = 'P0001', false))
                     else not accepte and coalesce(code_recu = etape[5]
                       and case when right(attendu, 1) = '%' then message like attendu else message = attendu end, false) end);
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

  -- ══ 199. Rien n'est resté ══════════
  foreach cle in array tables loop
    execute format('select count(*) from %I', cle) into n;
    apres := concat_ws('/', apres, n);
  end loop;
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '199. rien n''est resté en base', 'observe', 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)),
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI VF7B%'));

  perform set_config('essai.validation_ventes', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.validation_ventes')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
