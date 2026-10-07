-- LA RÉCEPTION PAR LA PLATEFORME AGRÉÉE DU CLIENT, ÉPROUVÉE EN BASE — à rejouer par `execute_sql` après toute
-- migration qui touche `connexions_plateformes`, le flux d'une pièce (`flux_hote`, `flux_id`), sa version lisible
-- (`lisible_path`), sa provenance (`pieces_source_check`) ou la policy d'insertion des pièces (ligne 28.5 de la
-- feuille de route, étape b).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUE PERSONNE N'ATTEINT LA CONNEXION DEPUIS LE NAVIGATEUR : un anonyme, un compte rattaché à rien, un client sur
--     son propre dossier ET LE CHEF DU CABINET ne voient AUCUNE connexion — alors qu'il en existe une —, n'en modifient
--     aucune et se font refuser l'écriture. Elle porte le secret qui ouvre toutes les factures de l'entreprise : seule
--     l'Edge Function `plateforme-agreee` doit l'atteindre ;
--   - que CETTE fonction l'atteint : le rôle `service_role`, celui de sa clé, écrit, relit et modifie (le contrôle
--     POSITIF, sans lequel les refus seraient satisfaits par une table que personne ne peut utiliser) ;
--   - ce que la table refuse SEULE : un nom vide, une adresse qui n'est pas en https, qui vise une adresse IP, un nom
--     sans point, un port, des identifiants, une requête ou une barre finale, un secret vide, une organisation qui
--     n'est pas une valeur d'en-tête, une portée mal formée, et une DEUXIÈME connexion pour un même dossier ;
--   - ce que le FLUX d'une pièce garantit seul : il dédoublonne une facture reçue deux fois dans un dossier, vit dans
--     deux dossiers et chez deux plateformes, n'existe qu'avec la provenance « plateforme » et réciproquement, porte un
--     hôte de la bonne forme, et la version lisible n'est jamais l'original ; une provenance inconnue est refusée ;
--   - CE QU'UN CLIENT PEUT DÉPOSER : une pièce « à valider » comme le fait son dépôt (le contrôle POSITIF), et rien
--     d'autre — ni une pièce validée, ni une pièce rangée dans une catégorie, ni une pièce qui se dirait reçue de la
--     plateforme ou de Super PDP, ni une version lisible, ni une pièce au nom d'un autre. Le chef, lui, écrit toujours
--     une pièce validée et rangée (sa branche n'a pas changé) ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer : la connexion n'a AUCUNE policy, donc rien ne la retire
--     depuis le navigateur, et la suppression d'un dossier l'emporte (`on delete cascade`). Les jouer demande une
--     instruction de suppression, que l'outil d'exécution soumet à une confirmation de l'utilisateur : ils sont joués
--     sur une réplique locale du schéma, et seulement lus ici — plus faible, et annoncé comme tel ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Chaque contrôle s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE
-- avant le `raise` — le mécanisme de rls.sql. Un refus se juge à son code ET à son message (le nom de la contrainte,
-- ou la phrase de la RLS) : un P0001 sans rapport ressemblerait sinon à un refus. Les verdicts voyagent dans un réglage
-- LOCAL à la transaction (`essai.plateforme`), que la requête finale lit : le fichier se joue d'un seul appel, et ne
-- crée aucune table, même temporaire.
--
-- ÉPROUVÉ LE 07/10/2026 : 40 contrôles sur 40 en production, le texte transmis étant ce fichier sans ses commentaires.
-- Joué d'abord sur une réplique locale du schéma (40 sur 40), avec ce que la production ne peut que lire au catalogue :
-- un anonyme, un compte rattaché à rien, le client du dossier et le chef ne retirent aucune connexion, la fonction
-- (service_role) en retire une, et la suppression du dossier l'emporte. L'essai sait échouer : sur la réplique, neuf
-- mutations le font virer au rouge, chacune sur les contrôles écrits pour elle — une policy de lecture ouverte sur la
-- connexion (2 à 4, 37), la RLS retirée (1 à 4, 37), l'ancienne policy d'insertion des pièces (29 à 35, 39), la policy
-- privée de la seule condition sur la catégorie (30) ou sur l'auteur (34), l'unicité du flux retirée (19), le lien
-- entre la provenance et le flux retiré (22, 23), la forme de l'adresse retirée (7 à 13), et le changement de rôle de
-- l'anonyme retiré (1). Une policy `for all` sur la connexion fait aussi échouer le retrait local par le chef.
do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  dossier_client uuid; cabinet uuid; categorie uuid;
  accepte boolean; code_recu text; message text; obs text; ok boolean;
  vus int; n_maj int; n int;
  connexions_avant int; pieces_avant int; categories_avant int;
  verdicts jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or cabinet is null or dossier_client = dossier_test then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;
  -- Les connexions d'essai vont dans des dossiers qui n'en portent aucune, pour que chaque refus vienne de la
  -- contrainte éprouvée et non de la règle « une connexion par dossier ».
  if exists (select 1 from connexions_plateformes where dossier_id in (dossier_test, dossier_client)) then
    raise exception 'ESSAI_IMPOSSIBLE : le dossier test ou celui du client porte déjà une connexion à une plateforme';
  end if;
  select count(*) into connexions_avant from connexions_plateformes;
  select count(*) into pieces_avant from pieces;
  select count(*) into categories_avant from categories;

  -- ══ 1 à 4. Une connexion EXISTE, et personne ne l'atteint depuis le navigateur — pas même le chef ═══════════
  for obs in select unnest(array['1. anonyme', '2. rattaché à rien', '3. client, son propre dossier', '4. chef du cabinet']) loop
    accepte := false; code_recu := null; message := null; vus := null; n_maj := null;
    begin
      insert into connexions_plateformes (dossier_id, nom, url_flux, url_jeton, client_id, client_secret)
        values (case when obs like '4.%' then dossier_test else dossier_client end, 'Plateforme visible',
                'https://pa.exemple.fr/afnor-flow', 'https://pa.exemple.fr/oauth2/token', 'essai-id', 'essai-secret');
      if obs like '1.%' then
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub',
          case when obs like '2.%' then inconnu when obs like '3.%' then client else chef end, 'role','authenticated')::text, true);
      end if;
      select count(*) into vus from connexions_plateformes;
      update connexions_plateformes set nom = 'Essai modifié' where nom = 'Plateforme visible';
      get diagnostics n_maj = row_count;
      insert into connexions_plateformes (dossier_id, nom, url_flux, url_jeton, client_id, client_secret)
        values (case when obs like '4.%' then dossier_client else dossier_test end, 'Essai écrit',
                'https://pa.exemple.fr/afnor-flow', 'https://pa.exemple.fr/oauth2/token', 'essai-id', 'essai-secret');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : ne voit, ne modifie ni n''écrit aucune connexion',
      'observe', 'vues : ' || coalesce(vus::text, '?') || ', modifiées : ' || coalesce(n_maj::text, '?') || ' — '
        || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and vus = 0 and n_maj = 0 and code_recu = '42501'
        and message like 'new row violates row-level security policy%');
  end loop;

  -- ══ 5. Le rôle de l'Edge Function écrit, relit et modifie ════════════════════════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; n_maj := null;
  begin
    set local role service_role;
    insert into connexions_plateformes (dossier_id, nom, url_flux, url_jeton, client_id, client_secret, organisation_id,
                                        portee, created_by)
      values (dossier_test, 'Super PDP', 'https://api.superpdp.tech/afnor-flow', 'https://api.superpdp.tech/oauth2/token',
              'essai-id', 'essai-secret', '12345678900011', 'flux.lecture flux.ecriture', chef);
    update connexions_plateformes set recherche_depuis = '2026-10-01T08:00:00Z', derniere_recuperation = now(),
                                      updated_at = now()
     where dossier_id = dossier_test;
    get diagnostics n_maj = row_count;
    select nom || ':' || organisation_id || ':' || portee || ':' || to_char(recherche_depuis at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI')
      into obs from connexions_plateformes where dossier_id = dossier_test;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '5. la fonction (service_role) écrit, relit et modifie',
    'observe', 'relue : ' || coalesce(obs, '?') || ', modifiées : ' || coalesce(n_maj::text, '?') || ' — ' || coalesce(code_recu, '?'),
    'ok', accepte and code_recu = 'P0001' and n_maj = 1
      and obs = 'Super PDP:12345678900011:flux.lecture flux.ecriture:2026-10-01T08:00');

  -- ══ 6 à 18. Ce que la connexion refuse seule ══════════════════════════════════════════════════════════════════
  for obs, message in
    select * from (values
      ('6. nom vide', 'connexions_plateformes_nom'),
      ('7. adresse des flux en http', 'connexions_plateformes_url_flux'),
      ('8. adresse des flux vers une adresse IP', 'connexions_plateformes_url_flux'),
      ('9. adresse des flux sans point (localhost)', 'connexions_plateformes_url_flux'),
      ('10. adresse des flux avec un port', 'connexions_plateformes_url_flux'),
      ('11. adresse des flux avec des identifiants', 'connexions_plateformes_url_flux'),
      ('12. adresse des flux avec une requête', 'connexions_plateformes_url_flux'),
      ('13. adresse des flux avec une barre finale', 'connexions_plateformes_url_flux'),
      ('14. adresse des jetons en http', 'connexions_plateformes_url_jeton'),
      ('15. secret vide', 'connexions_plateformes_client_secret'),
      ('16. organisation avec une espace', 'connexions_plateformes_organisation_id'),
      ('17. portée à deux espaces', 'connexions_plateformes_portee'),
      ('18. deux connexions pour un même dossier', 'connexions_plateformes_pkey')
    ) as cas(nom, contrainte)
  loop
    accepte := false; code_recu := null;
    declare
      contrainte text := message; recu text;
      v_nom text := 'Plateforme'; v_flux text := 'https://pa.exemple.fr/afnor-flow';
      v_jeton text := 'https://pa.exemple.fr/oauth2/token'; v_secret text := 'essai-secret';
      v_org text := null; v_portee text := null;
    begin
      begin
        set local role service_role;
        case
          when obs like '6.%' then v_nom := '   ';
          when obs like '7.%' then v_flux := 'http://pa.exemple.fr/afnor-flow';
          when obs like '8.%' then v_flux := 'https://192.168.1.10/afnor-flow';
          when obs like '9.%' then v_flux := 'https://localhost/afnor-flow';
          when obs like '10.%' then v_flux := 'https://pa.exemple.fr:8443/afnor-flow';
          when obs like '11.%' then v_flux := 'https://essai:secret@pa.exemple.fr/afnor-flow';
          when obs like '12.%' then v_flux := 'https://pa.exemple.fr/afnor-flow?tenant=1';
          when obs like '13.%' then v_flux := 'https://pa.exemple.fr/afnor-flow/';
          when obs like '14.%' then v_jeton := 'http://pa.exemple.fr/oauth2/token';
          when obs like '15.%' then v_secret := '';
          when obs like '16.%' then v_org := '123 456';
          when obs like '17.%' then v_portee := 'flux.lecture  flux.ecriture';
          else null;
        end case;
        insert into connexions_plateformes (dossier_id, nom, url_flux, url_jeton, client_id, client_secret, organisation_id, portee)
          values (dossier_test, v_nom, v_flux, v_jeton, 'essai-id', v_secret, v_org, v_portee);
        if obs like '18.%' then
          insert into connexions_plateformes (dossier_id, nom, url_flux, url_jeton, client_id, client_secret)
            values (dossier_test, 'Une autre', 'https://autre.exemple.fr/flux', 'https://autre.exemple.fr/token', 'id', 'secret');
        end if;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        'ok', not accepte and code_recu = case when obs like '18.%' then '23505' else '23514' end
          and recu like '%' || contrainte || '%');
    end;
  end loop;

  -- ══ 19. Le chef importe une facture reçue ; le même flux est refusé dans le dossier ═══════════════════════════
  accepte := false; code_recu := null; message := null; n := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into pieces (dossier_id, storage_path, nom_fichier, source, flux_hote, flux_id, lisible_path, montant_ttc)
      values (dossier_test, dossier_test || '/essai-flux.xml', 'facture.xml', 'plateforme', 'api.superpdp.tech',
              'essai-flux-1', dossier_test || '/essai-flux-lisible.pdf', 120);
    get diagnostics n = row_count;
    insert into pieces (dossier_id, storage_path, nom_fichier, source, flux_hote, flux_id, montant_ttc)
      values (dossier_test, dossier_test || '/essai-flux-bis.xml', 'facture.xml', 'plateforme', 'api.superpdp.tech',
              'essai-flux-1', 120);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '19. le chef importe une facture reçue, et le même flux est refusé',
    'observe', 'première : ' || coalesce(n::text, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', not accepte and n = 1 and code_recu = '23505' and message like '%pieces_flux_unique%');

  -- ══ 20. Le même identifiant dans un autre dossier, et chez une autre plateforme ═══════════════════════════════
  accepte := false; code_recu := null; message := null; n := null;
  begin
    insert into pieces (dossier_id, storage_path, nom_fichier, source, flux_hote, flux_id)
      values (dossier_test, dossier_test || '/essai-a.xml', 'a.xml', 'plateforme', 'api.superpdp.tech', 'essai-flux-2'),
             (dossier_client, dossier_client || '/essai-b.xml', 'b.xml', 'plateforme', 'api.superpdp.tech', 'essai-flux-2'),
             (dossier_test, dossier_test || '/essai-c.xml', 'c.xml', 'plateforme', 'flux.autre-plateforme.fr', 'essai-flux-2');
    get diagnostics n = row_count;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '20. le même flux dans deux dossiers et chez deux plateformes',
    'observe', 'écrites : ' || coalesce(n::text, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', accepte and code_recu = 'P0001' and n = 3);

  -- ══ 21 à 27. Ce que le flux d'une pièce refuse seul ═══════════════════════════════════════════════════════════
  for obs, message in
    select * from (values
      ('21. un hôte sans identifiant de flux', 'pieces_flux_coherent'),
      ('22. la provenance « plateforme » sans flux', 'pieces_flux_plateforme'),
      ('23. un flux sous une autre provenance', 'pieces_flux_plateforme'),
      ('24. un hôte en majuscules', 'pieces_flux_hote_format'),
      ('25. un hôte qui est une adresse IP', 'pieces_flux_hote_format'),
      ('26. une version lisible qui est l''original', 'pieces_lisible_distinct'),
      ('27. une provenance inconnue', 'pieces_source_check')
    ) as cas(nom, contrainte)
  loop
    accepte := false; code_recu := null;
    declare contrainte text := message; recu text;
    begin
      begin
        if obs like '21.%' then
          insert into pieces (dossier_id, storage_path, nom_fichier, flux_hote)
            values (dossier_test, dossier_test || '/essai.xml', 'essai.xml', 'api.superpdp.tech');
        elsif obs like '22.%' then
          insert into pieces (dossier_id, storage_path, nom_fichier, source)
            values (dossier_test, dossier_test || '/essai.xml', 'essai.xml', 'plateforme');
        elsif obs like '23.%' then
          insert into pieces (dossier_id, storage_path, nom_fichier, source, flux_hote, flux_id)
            values (dossier_test, dossier_test || '/essai.xml', 'essai.xml', 'upload', 'api.superpdp.tech', 'essai-flux-3');
        elsif obs like '24.%' then
          insert into pieces (dossier_id, storage_path, nom_fichier, source, flux_hote, flux_id)
            values (dossier_test, dossier_test || '/essai.xml', 'essai.xml', 'plateforme', 'API.SuperPDP.tech', 'essai-flux-4');
        elsif obs like '25.%' then
          insert into pieces (dossier_id, storage_path, nom_fichier, source, flux_hote, flux_id)
            values (dossier_test, dossier_test || '/essai.xml', 'essai.xml', 'plateforme', '10.0.0.12', 'essai-flux-5');
        elsif obs like '26.%' then
          insert into pieces (dossier_id, storage_path, nom_fichier, lisible_path)
            values (dossier_test, dossier_test || '/essai.xml', 'essai.xml', dossier_test || '/essai.xml');
        else
          insert into pieces (dossier_id, storage_path, nom_fichier, source)
            values (dossier_test, dossier_test || '/essai.xml', 'essai.xml', 'import');
        end if;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        'ok', not accepte and code_recu = '23514' and recu like '%' || contrainte || '%');
    end;
  end loop;

  -- ══ 28. Le client dépose une pièce comme le fait son dépôt (lib/depot.ts) ════════════════════════════════════
  accepte := false; code_recu := null; message := null; n := null; vus := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    insert into pieces (dossier_id, uploaded_by, storage_path, storage_hash, nom_fichier, type_piece, statut, date_piece,
                        tiers, montant_ttc, confiance)
      values (dossier_client, client, dossier_client || '/essai-depot.pdf', repeat('a', 64), 'depot.pdf', 'achat',
              'a_valider', '2026-10-01', 'Fournisseur', 42, 'haute');
    get diagnostics n = row_count;
    -- Un dépôt dont la lecture de l'utilisateur a échoué part sans auteur : `uploaded_by` nul reste admis.
    insert into pieces (dossier_id, storage_path, nom_fichier, statut)
      values (dossier_client, dossier_client || '/essai-depot-2.pdf', 'depot-2.pdf', 'a_valider');
    get diagnostics vus = row_count;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '28. le client dépose une pièce « à valider », avec ou sans auteur',
    'observe', 'écrites : ' || coalesce(n::text, '?') || ' + ' || coalesce(vus::text, '?') || ' — ' || coalesce(code_recu, '?')
      || ' ' || coalesce(message, ''),
    'ok', accepte and code_recu = 'P0001' and n = 1 and vus = 1);

  -- ══ 29 à 35. … et rien d'autre ═════════════════════════════════════════════════════════════════════════════════
  for obs in select unnest(array[
      '29. une pièce déjà validée',
      '30. une pièce rangée dans une catégorie',
      '31. une pièce qui se dit reçue de la plateforme',
      '32. une pièce qui se dit reçue de Super PDP',
      '33. une pièce avec une version lisible',
      '34. une pièce déposée au nom d''un autre',
      '35. une pièce sans la provenance d''un dépôt'])
  loop
    accepte := false; code_recu := null; message := null;
    begin
      if obs like '30.%' then
        insert into categories (dossier_id, code, libelle) values (dossier_client, 'essai_plateforme', 'Essai')
          returning id into categorie;
      end if;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
      if obs like '29.%' then
        insert into pieces (dossier_id, storage_path, nom_fichier, statut)
          values (dossier_client, dossier_client || '/essai.pdf', 'essai.pdf', 'validee');
      elsif obs like '30.%' then
        insert into pieces (dossier_id, storage_path, nom_fichier, categorie_id)
          values (dossier_client, dossier_client || '/essai.pdf', 'essai.pdf', categorie);
      elsif obs like '31.%' then
        insert into pieces (dossier_id, storage_path, nom_fichier, source, flux_hote, flux_id)
          values (dossier_client, dossier_client || '/essai.xml', 'essai.xml', 'plateforme', 'api.superpdp.tech', 'essai-flux-6');
      elsif obs like '32.%' then
        insert into pieces (dossier_id, storage_path, nom_fichier, source, superpdp_invoice_id)
          values (dossier_client, dossier_client || '/essai.txt', 'essai.txt', 'superpdp', 987654321);
      elsif obs like '33.%' then
        insert into pieces (dossier_id, storage_path, nom_fichier, lisible_path)
          values (dossier_client, dossier_client || '/essai.xml', 'essai.xml', dossier_client || '/essai-lisible.pdf');
      elsif obs like '34.%' then
        insert into pieces (dossier_id, uploaded_by, storage_path, nom_fichier)
          values (dossier_client, chef, dossier_client || '/essai.pdf', 'essai.pdf');
      else
        insert into pieces (dossier_id, storage_path, nom_fichier, source)
          values (dossier_client, dossier_client || '/essai.pdf', 'essai.pdf', 'email');
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : le client se fait refuser',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '42501' and message like 'new row violates row-level security policy%');
  end loop;

  -- ══ 36. La branche du cabinet n'a pas changé : le chef écrit une pièce validée et rangée ══════════════════════
  accepte := false; code_recu := null; message := null; n := null;
  begin
    insert into categories (dossier_id, code, libelle) values (dossier_test, 'essai_plateforme', 'Essai')
      returning id into categorie;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into pieces (dossier_id, uploaded_by, storage_path, nom_fichier, statut, categorie_id, montant_ttc)
      values (dossier_test, chef, dossier_test || '/essai-cabinet.pdf', 'cabinet.pdf', 'validee', categorie, 80);
    get diagnostics n = row_count;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '36. le chef écrit toujours une pièce validée et rangée',
    'observe', 'écrites : ' || coalesce(n::text, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', accepte and code_recu = 'P0001' and n = 1);

  -- ══ 37 à 39. Ce que le catalogue dit, faute de pouvoir le jouer ici ═══════════════════════════════════════════
  select concat_ws(', ', 'rls ' || c.relrowsecurity, 'policies ' || (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = 'connexions_plateformes'))
    into obs from pg_class c where c.oid = 'public.connexions_plateformes'::regclass;
  verdicts := verdicts || jsonb_build_object('controle', '37. catalogue : la connexion sous RLS, sans aucune policy',
    'observe', obs, 'ok', obs = 'rls true, policies 0');

  select string_agg(c.conname::text || ':' || c.confdeltype::text, ',' order by c.conname) into obs
    from pg_constraint c where c.conrelid = 'public.connexions_plateformes'::regclass and c.contype = 'f';
  verdicts := verdicts || jsonb_build_object('controle', '38. catalogue : la suppression d''un dossier emporte sa connexion',
    'observe', obs, 'ok', obs = 'connexions_plateformes_dossier_id_fkey:c');

  select p.roles::text || ' ' || p.cmd into obs from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'pieces' and p.policyname = 'pieces_insert';
  verdicts := verdicts || jsonb_build_object('controle', '39. catalogue : l''insertion d''une pièce réservée aux comptes connectés',
    'observe', obs, 'ok', obs = '{authenticated} INSERT');

  -- ══ 40. Rien n'est resté ══════════════════════════════════════════════════════════════════════════════════════
  verdicts := verdicts || jsonb_build_object('controle', '40. rien n''est resté en base',
    'observe', 'connexions ' || connexions_avant || ' -> ' || (select count(*) from connexions_plateformes)
      || ', pièces ' || pieces_avant || ' -> ' || (select count(*) from pieces)
      || ', catégories ' || categories_avant || ' -> ' || (select count(*) from categories),
    'ok', connexions_avant = (select count(*) from connexions_plateformes)
      and pieces_avant = (select count(*) from pieces)
      and categories_avant = (select count(*) from categories));

  perform set_config('essai.plateforme', verdicts::text, true);
end $$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.plateforme')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
