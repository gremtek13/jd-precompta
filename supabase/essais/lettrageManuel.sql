-- LE LETTRAGE FAIT À LA MAIN, ÉPROUVÉ EN BASE — à rejouer par `execute_sql` après toute migration qui touche
-- `lettrer_pieces`, la table `lettrages_manuels` ou les écritures du brouillon (ligne 32 de la feuille de route,
-- seconde brique : une facture compensée par un avoir ou par une autre pièce, sans mouvement bancaire).
--
-- La fonction lettre ensemble des pièces d'un dossier tenu en engagement qui se soldent sur un compte de tiers ;
-- elle n'écrit rien dans le brouillon, seulement l'appariement. Ce qui se prouve ici, et ne se relit pas :
--   - QUI peut : un anonyme n'a pas le droit d'appeler, un compte rattaché à rien et un client se font refuser — le
--     client sur le dossier d'un autre comme sur le SIEN —, et le chef du cabinet lettre bien (le contrôle
--     POSITIF, sans lequel les refus seraient satisfaits par une fonction qui refuse tout le monde) ; sur la
--     table, le client et un compte rattaché à rien ne lisent rien et n'écrivent rien ;
--   - CE QUI s'écrit : une ligne par pièce, toutes du même groupe et du même compte — une facture et son avoir, une
--     facture payée en partie et l'avoir qui solde son reste ;
--   - CE QUI est refusé, avec sa RAISON : un dossier en trésorerie, un compte qui ne se lettre pas, moins de deux
--     pièces, une pièce nulle ou choisie deux fois, une pièce d'un autre dossier ou inconnue, une pièce déjà lettrée
--     à la main, une pièce sans écriture sur le compte, une pièce déjà soldée par ses règlements, des pièces qui ne
--     se soldent pas ;
--   - CE QUE LES CONTRAINTES ET LA POLICY TIENNENT SANS LE CODE : une pièce n'entre que dans un lettrage, le compte
--     est un compte de tiers, et la pièce d'une ligne appartient au dossier annoncé ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer : la policy couvre la suppression (défaire un lettrage) ;
--     une pièce supprimée laisse sa ligne sans pièce (`on delete set null`) ; la suppression d'un dossier emporte
--     ses lettrages. Les jouer demande une instruction de suppression, que l'outil d'exécution soumet à une
--     confirmation de l'utilisateur : ils ont été joués sur une réplique locale du schéma, et sont seulement lus
--     ici — plus faible, et annoncé comme tel ;
--   - et que RIEN ne reste en base après l'essai.
--
-- LE JEU est un dossier JETABLE tenu en engagement, dans le cabinet du chef, avec ses pièces et leurs écritures :
-- aucun dossier réel n'est en engagement. Il vit dans un bloc qui s'annule en entier à la fin (`ANNULATION_JEU`), et
-- chaque contrôle s'annule à son tour dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), le verdict étant posé
-- dans une VARIABLE avant le `raise` — le mécanisme de rls.sql. Un refus se juge à son code ET à son message. Les
-- verdicts voyagent dans un réglage LOCAL à la transaction (`essai.lettrage`), que la requête finale lit : le fichier
-- se joue d'un seul appel, et ne crée aucune table, même temporaire.
--
-- ÉPROUVÉ LE 06/10/2026 : 28 contrôles sur 28 en production, le texte transmis étant ce fichier sans ses commentaires
-- (vérifié par différence dans le journal de session : 335 lignes, aucune différence). Joué d'abord sur une réplique
-- locale du schéma, avec ce que la production ne peut que lire au catalogue : le chef défait un lettrage (ses deux
-- lignes partent), le client et un compte rattaché à rien n'en retirent aucune, une pièce lettrée supprimée laisse sa
-- ligne sans pièce — même sous la policy, le `set null` de la clé n'y étant pas soumis —, deux pièces supprimées en
-- laissent deux sans se heurter, et la suppression du dossier les emporte. L'essai sait échouer : sur la réplique, sept
-- mutations le font virer au rouge, chacune sur le contrôle écrit pour elle — le `set local role anon` retiré (1), le
-- contrôle d'accès de la fonction retiré (2 à 4), le mode, le doublon, la pièce soldée et la somme non vérifiés (7, 11,
-- 16, 17), et la policy privée de sa condition sur la pièce (24).
do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  dossier_client uuid; cabinet uuid; dossier_e uuid;
  piece_f1 uuid; piece_a1 uuid; piece_f2 uuid; piece_a2 uuid; piece_s1 uuid; piece_n1 uuid; piece_v1 uuid;
  piece_p3 uuid; piece_test uuid; piece_client uuid;
  v_groupe uuid; ids jsonb; cas jsonb;
  accepte boolean; code_recu text; message text; obs text; ok boolean; n int;
  lettrages_avant int; dossiers_avant int; pieces_avant int; ecritures_avant int;
  verdicts jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or cabinet is null or dossier_client = dossier_test then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;
  select count(*) into lettrages_avant from lettrages_manuels;
  select count(*) into dossiers_avant from dossiers;
  select count(*) into pieces_avant from pieces;
  select count(*) into ecritures_avant from ecritures_brouillon;

  begin
    -- ══ Le jeu ════════════════════════════════════════════════════════════════════════════════════════════
    insert into dossiers (nom, cabinet_id, mode_comptable) values ('ESSAI LETTRAGE', cabinet, 'engagement')
      returning id into dossier_e;
    insert into pieces (dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece, tiers)
      values (dossier_e, 'essai/lettrage/f1.pdf', 'essai-f1.pdf', 'validee', 'achat', 500, '2025-03-01', 'Fournisseur Essai')
      returning id into piece_f1;
    insert into pieces (dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece, tiers)
      values (dossier_e, 'essai/lettrage/a1.pdf', 'essai-a1.pdf', 'validee', 'achat', -500, '2025-03-10', 'Fournisseur Essai')
      returning id into piece_a1;
    insert into pieces (dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece, tiers)
      values (dossier_e, 'essai/lettrage/f2.pdf', 'essai-f2.pdf', 'validee', 'achat', 1000, '2025-04-01', 'Fournisseur Essai')
      returning id into piece_f2;
    insert into pieces (dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece, tiers)
      values (dossier_e, 'essai/lettrage/a2.pdf', 'essai-a2.pdf', 'validee', 'achat', -200, '2025-04-20', 'Fournisseur Essai')
      returning id into piece_a2;
    insert into pieces (dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece, tiers)
      values (dossier_e, 'essai/lettrage/s1.pdf', 'essai-s1.pdf', 'validee', 'achat', 300, '2025-05-01', 'Fournisseur Essai')
      returning id into piece_s1;
    insert into pieces (dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece, tiers)
      values (dossier_e, 'essai/lettrage/n1.pdf', 'essai-n1.pdf', 'validee', 'achat', 100, '2025-05-10', 'Fournisseur Essai')
      returning id into piece_n1;
    insert into pieces (dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece, tiers)
      values (dossier_e, 'essai/lettrage/v1.pdf', 'essai-v1.pdf', 'validee', 'vente', 100, '2025-06-01', 'Client Essai')
      returning id into piece_v1;
    insert into pieces (dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece, tiers)
      values (dossier_e, 'essai/lettrage/p3.pdf', 'essai-p3.pdf', 'validee', 'achat', 300, '2025-06-10', 'Fournisseur Essai')
      returning id into piece_p3;
    insert into pieces (dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece)
      values (dossier_test, 'essai/lettrage/t.pdf', 'essai-t.pdf', 'a_valider', 'achat', 100, '2025-06-10')
      returning id into piece_test;
    insert into pieces (dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece)
      values (dossier_client, 'essai/lettrage/c.pdf', 'essai-c.pdf', 'a_valider', 'achat', 100, '2025-06-10')
      returning id into piece_client;
    -- F1 (facture de 500) et A1 (son avoir) se soldent ensemble ; F2 (1 000, payée 800) et A2 (avoir de 200) aussi ;
    -- S1 est soldée par son règlement ; N1 n'a rien sur le 401 ; V1 est une vente, au 411 ; P3 est une facture de 300.
    insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens) values
      (dossier_e, piece_f1, '2025-03-01', '401000', 'essai lettrage', 500, 'credit'),
      (dossier_e, piece_f1, '2025-03-01', '606100', 'essai lettrage', 500, 'debit'),
      (dossier_e, piece_a1, '2025-03-10', '401000', 'essai lettrage', 500, 'debit'),
      (dossier_e, piece_a1, '2025-03-10', '606100', 'essai lettrage', 500, 'credit'),
      (dossier_e, piece_f2, '2025-04-01', '401000', 'essai lettrage', 1000, 'credit'),
      (dossier_e, piece_f2, '2025-04-01', '606100', 'essai lettrage', 1000, 'debit'),
      (dossier_e, piece_f2, '2025-04-15', '401000', 'essai lettrage', 800, 'debit'),
      (dossier_e, piece_f2, '2025-04-15', '512000', 'essai lettrage', 800, 'credit'),
      (dossier_e, piece_a2, '2025-04-20', '401000', 'essai lettrage', 200, 'debit'),
      (dossier_e, piece_a2, '2025-04-20', '606100', 'essai lettrage', 200, 'credit'),
      (dossier_e, piece_s1, '2025-05-01', '401000', 'essai lettrage', 300, 'credit'),
      (dossier_e, piece_s1, '2025-05-01', '606100', 'essai lettrage', 300, 'debit'),
      (dossier_e, piece_s1, '2025-05-05', '401000', 'essai lettrage', 300, 'debit'),
      (dossier_e, piece_s1, '2025-05-05', '512000', 'essai lettrage', 300, 'credit'),
      (dossier_e, piece_n1, '2025-05-10', '606100', 'essai lettrage', 100, 'debit'),
      (dossier_e, piece_n1, '2025-05-10', '512000', 'essai lettrage', 100, 'credit'),
      (dossier_e, piece_v1, '2025-06-01', '411000', 'essai lettrage', 100, 'debit'),
      (dossier_e, piece_v1, '2025-06-01', '706000', 'essai lettrage', 100, 'credit'),
      (dossier_e, piece_p3, '2025-06-10', '401000', 'essai lettrage', 300, 'credit'),
      (dossier_e, piece_p3, '2025-06-10', '606100', 'essai lettrage', 300, 'debit');
    ids := jsonb_build_object('f1', piece_f1, 'a1', piece_a1, 'f2', piece_f2, 'a2', piece_a2, 's1', piece_s1,
      'n1', piece_n1, 'v1', piece_v1, 'p3', piece_p3, 'test', piece_test, 'inconnu', inconnu);

    -- ══ 1. Anonyme : pas d'EXECUTE ════════════════════════════════════════════════════════════════════════
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    accepte := false; code_recu := null; message := null;
    begin
      perform lettrer_pieces(dossier_e, '401000', array[piece_f1, piece_a1]);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '1. anonyme', 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '42501' and message like 'permission denied%');

    -- ══ 2 à 4. Un compte rattaché à rien, et le client — sur le dossier d'un autre comme sur le sien ════════
    for obs in select unnest(array['2. compte rattaché à rien', '3. client, sur le dossier d''un autre', '4. client, sur son propre dossier']) loop
      accepte := false; code_recu := null; message := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', case when obs like '2.%' then inconnu else client end,
          'role','authenticated')::text, true);
        perform lettrer_pieces(case when obs like '4.%' then dossier_client else dossier_e end, '401000',
          case when obs like '4.%' then array[piece_client, piece_test] else array[piece_f1, piece_a1] end);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
        'ok', not accepte and code_recu = '42501' and message = 'Accès refusé à ce dossier.');
    end loop;

    -- ══ 5. Le chef lettre une facture et son avoir ══════════════════════════════════════════════════════════
    accepte := false; code_recu := null; message := null; obs := null; ok := false;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      v_groupe := lettrer_pieces(dossier_e, '401000', array[piece_f1, piece_a1]);
      select count(*)::text || ' ligne(s), ' || count(distinct l.groupe) || ' groupe, ' || string_agg(distinct l.compte, ',')
             || case when bool_and(l.piece_id in (piece_f1, piece_a1)) then ', les deux pièces' else ', autres pièces' end
        into obs from lettrages_manuels l where l.groupe = v_groupe;
      ok := obs = '2 ligne(s), 1 groupe, 401000, les deux pièces';
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '5. le chef lettre une facture et son avoir',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
      'ok', accepte and code_recu = 'P0001' and coalesce(ok, false));

    -- ══ 6. Une facture payée en partie et l'avoir qui solde son reste ══════════════════════════════════════
    accepte := false; code_recu := null; message := null; obs := null; ok := false;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      v_groupe := lettrer_pieces(dossier_e, '401000', array[piece_f2, piece_a2]);
      select count(*)::text || ' ligne(s)' into obs from lettrages_manuels l where l.groupe = v_groupe;
      ok := obs = '2 ligne(s)';
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '6. une facture payée en partie et l''avoir qui solde son reste',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
      'ok', accepte and code_recu = 'P0001' and coalesce(ok, false));

    -- ══ 7 à 18. Ce qui est refusé, avec sa raison ════════════════════════════════════════════════════════════
    for cas in select * from jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('n', '7. refus : un dossier tenu en trésorerie', 'dossier', 'test', 'compte', '401000',
          'pieces', jsonb_build_array('f1', 'a1'), 'attendu', 'Le lettrage ne se fait que dans un dossier tenu en engagement.'),
        jsonb_build_object('n', '8. refus : un compte qui ne se lettre pas', 'compte', '512000',
          'pieces', jsonb_build_array('f1', 'a1'), 'attendu', 'Ce compte n''est pas un compte de tiers qui se lettre.'),
        jsonb_build_object('n', '9. refus : une seule pièce', 'compte', '401000',
          'pieces', jsonb_build_array('f1'), 'attendu', 'Un lettrage fait à la main apparie au moins deux pièces.'),
        jsonb_build_object('n', '10. refus : une pièce nulle', 'compte', '401000',
          'pieces', jsonb_build_array('f1', 'nulle'), 'attendu', 'Un lettrage fait à la main apparie au moins deux pièces.'),
        jsonb_build_object('n', '11. refus : une pièce choisie deux fois', 'compte', '401000',
          'pieces', jsonb_build_array('f1', 'f1'), 'attendu', 'Une pièce est choisie deux fois.'),
        jsonb_build_object('n', '12. refus : une pièce d''un autre dossier', 'compte', '401000',
          'pieces', jsonb_build_array('f1', 'test'), 'attendu', 'Une des pièces n''appartient pas à ce dossier.'),
        jsonb_build_object('n', '13. refus : une pièce inconnue', 'compte', '401000',
          'pieces', jsonb_build_array('f1', 'inconnu'), 'attendu', 'Une des pièces n''appartient pas à ce dossier.'),
        jsonb_build_object('n', '14. refus : une pièce déjà lettrée à la main', 'compte', '401000', 'avant', true,
          'pieces', jsonb_build_array('p3', 'f1'),
          'attendu', 'Une des pièces est déjà lettrée à la main avec d''autres : défais d''abord ce lettrage.'),
        jsonb_build_object('n', '15. refus : une pièce sans écriture sur le compte', 'compte', '401000',
          'pieces', jsonb_build_array('f1', 'n1'),
          'attendu', 'Une des pièces n''a aucune écriture sur ce compte : génère d''abord ses écritures.'),
        jsonb_build_object('n', '16. refus : une pièce déjà soldée par ses règlements', 'compte', '401000',
          'pieces', jsonb_build_array('f1', 's1'), 'attendu', 'Une des pièces est déjà soldée par ses règlements : elle se lettre seule.'),
        jsonb_build_object('n', '17. refus : des pièces qui ne se soldent pas', 'compte', '401000',
          'pieces', jsonb_build_array('a1', 'p3'), 'attendu', 'Ces pièces ne se soldent pas : il reste 200,00 € sur le compte.'),
        jsonb_build_object('n', '18. refus : une vente, sur un autre compte', 'compte', '401000',
          'pieces', jsonb_build_array('f1', 'v1'),
          'attendu', 'Une des pièces n''a aucune écriture sur ce compte : génère d''abord ses écritures.')
      )) loop
      accepte := false; code_recu := null; message := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        if coalesce((cas->>'avant')::boolean, false) then
          perform lettrer_pieces(dossier_e, '401000', array[piece_f1, piece_a1]);
        end if;
        perform lettrer_pieces(
          case cas->>'dossier' when 'test' then dossier_test else dossier_e end,
          cas->>'compte',
          array(select case k when 'nulle' then null else (ids->>k)::uuid end
                  from jsonb_array_elements_text(cas->'pieces') with ordinality as t(k, i) order by i));
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', cas->>'n', 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
        'ok', not accepte and code_recu = '22023' and message = cas->>'attendu');
    end loop;

    -- ══ 19 et 20. Ce que les contraintes tiennent seules ═════════════════════════════════════════════════════
    accepte := false; code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform lettrer_pieces(dossier_e, '401000', array[piece_f1, piece_a1]);
      reset role;
      insert into lettrages_manuels (dossier_id, groupe, piece_id, compte) values (dossier_e, gen_random_uuid(), piece_f1, '401000');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '19. contrainte : une pièce n''entre que dans un lettrage',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '23505' and message like '%lettrages_manuels_une_fois_par_piece%');

    accepte := false; code_recu := null; message := null;
    begin
      insert into lettrages_manuels (dossier_id, groupe, piece_id, compte) values (dossier_e, gen_random_uuid(), piece_p3, '512000');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', '20. contrainte : un compte de tiers qui se lettre',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '23514' and message like '%lettrages_manuels_compte%');

    -- ══ 21. Le client ne lit rien, même de son propre dossier ; le chef, si ═══════════════════════════════════
    accepte := false; code_recu := null; message := null; obs := null; ok := false;
    begin
      insert into lettrages_manuels (dossier_id, groupe, piece_id, compte)
        values (dossier_client, gen_random_uuid(), piece_client, '401000');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
      select count(*) into n from lettrages_manuels;
      obs := 'client : ' || n;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      select count(*) into n from lettrages_manuels where dossier_id = dossier_client;
      obs := obs || ', chef : ' || n;
      ok := obs = 'client : 0, chef : 1';
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '21. le client ne lit rien, même de son dossier ; le chef, si',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
      'ok', accepte and code_recu = 'P0001' and coalesce(ok, false));

    -- ══ 22. Le client n'écrit rien, même sur son propre dossier ═══════════════════════════════════════════════
    accepte := false; code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
      insert into lettrages_manuels (dossier_id, groupe, piece_id, compte)
        values (dossier_client, gen_random_uuid(), piece_client, '401000');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '22. le client n''écrit rien',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '42501' and message like 'new row violates row-level security policy%');

    -- ══ 23. Un compte rattaché à rien ne lit rien ; le chef lit le lettrage qu'il vient de faire ══════════════
    accepte := false; code_recu := null; message := null; obs := null; ok := false;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform lettrer_pieces(dossier_e, '401000', array[piece_f1, piece_a1]);
      select count(*) into n from lettrages_manuels where dossier_id = dossier_e;
      obs := 'chef : ' || n;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
      select count(*) into n from lettrages_manuels;
      obs := obs || ', rattaché à rien : ' || n;
      ok := obs = 'chef : 2, rattaché à rien : 0';
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '23. un compte rattaché à rien ne lit rien',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
      'ok', accepte and code_recu = 'P0001' and coalesce(ok, false));

    -- ══ 24. La policy refuse une pièce d'un autre dossier, même au chef ══════════════════════════════════════
    accepte := false; code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      insert into lettrages_manuels (dossier_id, groupe, piece_id, compte) values (dossier_e, gen_random_uuid(), piece_test, '401000');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '24. la pièce d''une ligne appartient au dossier annoncé',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '42501' and message like 'new row violates row-level security policy%');

    raise exception 'ANNULATION_JEU';
  exception when others then
    if sqlerrm <> 'ANNULATION_JEU' then
      verdicts := verdicts || jsonb_build_object('controle', '0. le jeu', 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
    end if;
  end;
  reset role;

  -- ══ 25 à 27. Ce que le catalogue dit, faute de pouvoir le jouer ══════════════════════════════════════════
  select string_agg(p.cmd || ' ' || array_to_string(p.roles, ',') || ' ' || coalesce(p.qual, ''), ' | ')
    into obs from pg_policies p where p.schemaname = 'public' and p.tablename = 'lettrages_manuels';
  verdicts := verdicts || jsonb_build_object('controle', '25. catalogue : une seule policy, qui couvre aussi la suppression',
    'observe', obs, 'ok', obs = 'ALL authenticated admin_du_dossier(dossier_id)');

  select string_agg(c.conname::text || ':' || c.confdeltype::text, ',' order by c.conname) into obs
    from pg_constraint c where c.conrelid = 'public.lettrages_manuels'::regclass and c.contype = 'f';
  verdicts := verdicts || jsonb_build_object('controle', '26. catalogue : pièce supprimée, ligne sans pièce ; dossier supprimé, lettrages emportés',
    'observe', obs, 'ok', obs = 'lettrages_manuels_dossier_id_fkey:c,lettrages_manuels_piece_id_fkey:n');

  select concat_ws(', ', case when p.prosecdef then 'security definer' else 'security invoker' end,
      'anon ' || has_function_privilege('anon', p.oid, 'execute'),
      'authenticated ' || has_function_privilege('authenticated', p.oid, 'execute'))
    into obs from pg_proc p where p.oid = 'public.lettrer_pieces(uuid, text, uuid[])'::regprocedure;
  verdicts := verdicts || jsonb_build_object('controle', '27. catalogue : la fonction, ses droits',
    'observe', obs, 'ok', obs = 'security invoker, anon false, authenticated true');

  -- ══ 28. Rien n'est resté ═══════════════════════════════════════════════════════════════════════════════
  verdicts := verdicts || jsonb_build_object('controle', '28. rien n''est resté en base',
    'observe', 'lettrages ' || lettrages_avant || ' -> ' || (select count(*) from lettrages_manuels)
      || ', dossiers ' || dossiers_avant || ' -> ' || (select count(*) from dossiers)
      || ', pièces ' || pieces_avant || ' -> ' || (select count(*) from pieces)
      || ', écritures ' || ecritures_avant || ' -> ' || (select count(*) from ecritures_brouillon),
    'ok', lettrages_avant = (select count(*) from lettrages_manuels)
      and dossiers_avant = (select count(*) from dossiers)
      and pieces_avant = (select count(*) from pieces)
      and ecritures_avant = (select count(*) from ecritures_brouillon)
      and not exists (select 1 from dossiers where nom = 'ESSAI LETTRAGE'));

  perform set_config('essai.lettrage', verdicts::text, true);
end $$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.lettrage')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
