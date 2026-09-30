-- LA CONNEXION BANCAIRE ET L'IDENTIFIANT EXTERNE D'UN MOUVEMENT, ÉPROUVÉS EN BASE — à rejouer par
-- `execute_sql` après toute migration qui touche `connexions_bancaires` ou la contrainte
-- `lignes_bancaires_id_externe_unique` (ligne 24 de la feuille de route, la connexion bancaire).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUE PERSONNE N'ATTEINT LA TABLE DEPUIS LE NAVIGATEUR : un anonyme, un compte rattaché à rien, un
--     client sur son propre dossier ET LE CHEF DU CABINET ne voient AUCUNE connexion — alors qu'il en
--     existe une —, n'en modifient ni n'en suppriment aucune, et se font refuser l'écriture. La table
--     porte l'identifiant de session qui, avec la clé privée de l'application, ouvre les mouvements du
--     compte : seule l'Edge Function `banque-connexion` doit l'atteindre ;
--   - que CETTE fonction l'atteint : le rôle `service_role`, celui de sa clé, écrit, relit, modifie et
--     supprime (le contrôle POSITIF, sans lequel les refus seraient satisfaits par une table que
--     personne ne peut utiliser) ;
--   - ce que la table refuse SEULE : une session sur une connexion en attente, une connexion active
--     sans échéance, un environnement, un pays, un fournisseur inconnus, un compte choisi sans son
--     empreinte, des comptes qui ne sont pas une liste, une session ou un jeton de retour en double ;
--   - que l'identifiant externe DÉDOUBLONNE : le chef importe un mouvement qui en porte un, le même
--     identifiant est refusé dans le même dossier, `on conflict do nothing` le laisse passer sans rien
--     écrire, deux mouvements d'un relevé (identifiant nul) s'empilent comme avant, et le même
--     identifiant vit dans deux dossiers ;
--   - que la suppression d'un dossier emporte sa connexion ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Le mécanisme est celui de rls.sql et d'affectation.sql : chaque écriture d'essai est annulée par
-- sous-transaction (`raise exception 'ANNULATION_ESSAI'`), le verdict posé dans une VARIABLE avant le
-- `raise`, et un refus se juge à son code ET à son message — un P0001 sans rapport ressemblerait sinon
-- à un refus.
--
-- ÉPROUVÉ LE 30/09/2026 : 20 contrôles sur 20, le texte transmis comparé au fichier dans le journal de
-- session (identique). Et l'essai sait échouer : sans les `set local role`, les contrôles 1 à 4 virent
-- au rouge — sous `postgres`, qui ne subit pas la RLS, chaque profil voit, modifie et supprime la
-- connexion, et l'écrit.
drop table if exists essai_connexion;
create temp table essai_connexion (controle text, observe text, ok boolean);

do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  accepte boolean; code_recu text; message text; obs text; ok boolean;
  vus int; n_maj int; n_supp int; n int;
  connexion uuid; dossier_jetable uuid; cabinet uuid;
  nb_connexions_avant int; nb_connexions_apres int; nb_lignes_avant int; nb_lignes_apres int; nb_dossiers_avant int; nb_dossiers_apres int;
begin
  select count(*) into nb_connexions_avant from connexions_bancaires;
  select count(*) into nb_lignes_avant from lignes_bancaires;
  select count(*) into nb_dossiers_avant from dossiers;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if cabinet is null then raise exception 'ESSAI_IMPOSSIBLE : dossier de test introuvable'; end if;

  -- ══ 1 à 4. Une connexion EXISTE, et personne ne l'atteint depuis le navigateur — pas même le chef ══
  for obs in select unnest(array['1. anonyme', '2. rattaché à rien', '3. client, son propre dossier', '4. chef du cabinet']) loop
    accepte := false; code_recu := null; message := null; vus := null; n_maj := null; n_supp := null;
    begin
      insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement, etat, session_id, valide_jusqu_au)
        values (case when obs like '4.%' then dossier_test else dossier_du_client end,
                'Mock ASPSP', 'FR', 'SANDBOX', 'active', 'essai-session-visible', now() + interval '90 days');
      if obs like '1.%' then
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub',
          case when obs like '2.%' then inconnu when obs like '3.%' then client else chef end, 'role','authenticated')::text, true);
      end if;
      select count(*) into vus from connexions_bancaires;
      update connexions_bancaires set banque_nom = 'Essai modifié' where session_id = 'essai-session-visible';
      get diagnostics n_maj = row_count;
      delete from connexions_bancaires where session_id = 'essai-session-visible';
      get diagnostics n_supp = row_count;
      insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement)
        values (case when obs like '4.%' then dossier_test else dossier_du_client end, 'Essai écrit', 'FR', 'SANDBOX');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_connexion values (obs || ' : ne voit, ne modifie, ne supprime ni n''écrit rien',
      'vues : ' || coalesce(vus::text, '?') || ', modifiées : ' || coalesce(n_maj::text, '?') || ', supprimées : '
        || coalesce(n_supp::text, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and vus = 0 and n_maj = 0 and n_supp = 0 and code_recu = '42501'
      and message like 'new row violates row-level security policy%');
  end loop;

  -- ══ 5. Le rôle de l'Edge Function écrit, relit, modifie et supprime ═══════════════════════════════
  accepte := false; code_recu := null; message := null; ok := false; obs := null; n_maj := null; n_supp := null;
  begin
    set local role service_role;
    insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement, created_by)
      values (dossier_test, 'Mock ASPSP', 'FR', 'SANDBOX', chef) returning id into connexion;
    update connexions_bancaires
       set etat = 'active', session_id = 'essai-session-service', valide_jusqu_au = now() + interval '90 days',
           comptes = jsonb_build_array(jsonb_build_object('uid', 'essai-compte', 'empreinte', 'essai-empreinte')),
           compte_uid = 'essai-compte', compte_empreinte = 'essai-empreinte'
     where id = connexion;
    get diagnostics n_maj = row_count;
    select etat || ':' || jsonb_array_length(comptes)::text || ':' || compte_empreinte into obs
      from connexions_bancaires where id = connexion;
    delete from connexions_bancaires where id = connexion;
    get diagnostics n_supp = row_count;
    ok := n_maj = 1 and obs = 'active:1:essai-empreinte' and n_supp = 1;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_connexion values ('5. la fonction (service_role) écrit, relit, modifie et supprime',
    'relue : ' || coalesce(obs, '?') || ', modifiées : ' || coalesce(n_maj::text, '?') || ', supprimées : ' || coalesce(n_supp::text, '?'),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 6 à 14. Ce que la table refuse seule ══════════════════════════════════════════════════════════
  for obs, message in
    select * from (values
      ('6. session sur une connexion en attente', 'connexions_bancaires_etat_coherent'),
      ('7. connexion active sans échéance', 'connexions_bancaires_etat_coherent'),
      ('8. environnement inconnu', 'connexions_bancaires_environnement'),
      ('9. pays en minuscules', 'connexions_bancaires_banque_pays'),
      ('10. fournisseur inconnu', 'connexions_bancaires_fournisseur'),
      ('11. compte choisi sans empreinte', 'connexions_bancaires_compte_choisi'),
      ('12. comptes qui ne sont pas une liste', 'connexions_bancaires_comptes'),
      ('13. session en double', 'connexions_bancaires_session_unique'),
      ('14. jeton de retour en double', 'connexions_bancaires_jeton_etat_unique')
    ) as cas(nom, contrainte)
  loop
    accepte := false; code_recu := null;
    declare contrainte text := message; recu text; jeton uuid := gen_random_uuid();
    begin
      begin
        set local role service_role;
        if obs like '6.%' then
          insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement, etat, session_id)
            values (dossier_test, 'Mock ASPSP', 'FR', 'SANDBOX', 'en_attente', 'essai-session');
        elsif obs like '7.%' then
          insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement, etat, session_id)
            values (dossier_test, 'Mock ASPSP', 'FR', 'SANDBOX', 'active', 'essai-session');
        elsif obs like '8.%' then
          insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement)
            values (dossier_test, 'Mock ASPSP', 'FR', 'TEST');
        elsif obs like '9.%' then
          insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement)
            values (dossier_test, 'Mock ASPSP', 'fr', 'SANDBOX');
        elsif obs like '10.%' then
          insert into connexions_bancaires (dossier_id, fournisseur, banque_nom, banque_pays, environnement)
            values (dossier_test, 'autre', 'Mock ASPSP', 'FR', 'SANDBOX');
        elsif obs like '11.%' then
          insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement, compte_uid)
            values (dossier_test, 'Mock ASPSP', 'FR', 'SANDBOX', 'essai-compte');
        elsif obs like '12.%' then
          insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement, comptes)
            values (dossier_test, 'Mock ASPSP', 'FR', 'SANDBOX', '{}'::jsonb);
        elsif obs like '13.%' then
          insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement, etat, session_id, valide_jusqu_au)
            values (dossier_test, 'Mock ASPSP', 'FR', 'SANDBOX', 'active', 'essai-session-double', now() + interval '1 day'),
                   (dossier_test, 'Mock ASPSP', 'FR', 'SANDBOX', 'active', 'essai-session-double', now() + interval '1 day');
        else
          insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement, jeton_etat)
            values (dossier_test, 'Mock ASPSP', 'FR', 'SANDBOX', jeton), (dossier_test, 'Mock ASPSP', 'FR', 'SANDBOX', jeton);
        end if;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_connexion values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = case when obs like '13.%' or obs like '14.%' then '23505' else '23514' end
        and recu like '%' || contrainte || '%');
    end;
  end loop;

  -- ══ 15. Le chef importe un mouvement identifié ; le même identifiant est refusé dans le dossier ═══
  accepte := false; code_recu := null; message := null; n := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into lignes_bancaires (dossier_id, date, libelle, montant, id_externe)
      values (dossier_test, '2025-06-02', 'ESSAI CONNEXION', -12.34, 'eb:essai-empreinte:ref-1');
    get diagnostics n = row_count;
    insert into lignes_bancaires (dossier_id, date, libelle, montant, id_externe)
      values (dossier_test, '2025-06-02', 'ESSAI CONNEXION', -12.34, 'eb:essai-empreinte:ref-1');
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_connexion values ('15. le chef importe, et le même identifiant est refusé',
    'premier : ' || coalesce(n::text, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and n = 1 and code_recu = '23505' and message like '%lignes_bancaires_id_externe_unique%');

  -- ══ 16. `on conflict do nothing` laisse passer le doublon sans rien écrire ══════════════════════════
  -- C'est la forme de l'upsert `ignoreDuplicates` du client : deux imports qui se croisent ne doivent ni
  -- doubler un mouvement ni échouer.
  accepte := false; code_recu := null; message := null; n := null; vus := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into lignes_bancaires (dossier_id, date, libelle, montant, id_externe)
      values (dossier_test, '2025-06-02', 'ESSAI CONNEXION', -12.34, 'eb:essai-empreinte:ref-2');
    insert into lignes_bancaires (dossier_id, date, libelle, montant, id_externe)
      values (dossier_test, '2025-06-02', 'ESSAI CONNEXION', -12.34, 'eb:essai-empreinte:ref-2')
      on conflict (dossier_id, id_externe) do nothing;
    get diagnostics n = row_count;
    select count(*) into vus from lignes_bancaires where dossier_id = dossier_test and id_externe = 'eb:essai-empreinte:ref-2';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_connexion values ('16. on conflict do nothing : rien d''écrit, rien de levé',
    'écrites : ' || coalesce(n::text, '?') || ', présentes : ' || coalesce(vus::text, '?'),
    accepte and code_recu = 'P0001' and n = 0 and vus = 1);

  -- ══ 17. Deux mouvements d'un relevé (identifiant nul) s'empilent comme avant ═══════════════════════
  accepte := false; code_recu := null; message := null; vus := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into lignes_bancaires (dossier_id, date, libelle, montant)
      values (dossier_test, '2025-06-03', 'ESSAI RELEVE', -5), (dossier_test, '2025-06-03', 'ESSAI RELEVE', -5);
    get diagnostics vus = row_count;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_connexion values ('17. deux mouvements sans identifiant s''empilent',
    'écrits : ' || coalesce(vus::text, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    accepte and code_recu = 'P0001' and vus = 2);

  -- ══ 18. Le même identifiant vit dans deux dossiers ══════════════════════════════════════════════════
  accepte := false; code_recu := null; message := null; vus := null;
  begin
    insert into lignes_bancaires (dossier_id, date, libelle, montant, id_externe)
      values (dossier_test, '2025-06-04', 'ESSAI', -1, 'eb:essai-empreinte:ref-3'),
             (dossier_du_client, '2025-06-04', 'ESSAI', -1, 'eb:essai-empreinte:ref-3');
    get diagnostics vus = row_count;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  insert into essai_connexion values ('18. le même identifiant dans deux dossiers',
    'écrits : ' || coalesce(vus::text, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    accepte and code_recu = 'P0001' and vus = 2);

  -- ══ 19. La suppression d'un dossier emporte sa connexion ════════════════════════════════════════════
  accepte := false; code_recu := null; message := null; vus := null;
  begin
    insert into dossiers (cabinet_id, nom) values (cabinet, 'Essai connexion jetable') returning id into dossier_jetable;
    insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement)
      values (dossier_jetable, 'Mock ASPSP', 'FR', 'SANDBOX');
    delete from dossiers where id = dossier_jetable;
    select count(*) into vus from connexions_bancaires where dossier_id = dossier_jetable;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  insert into essai_connexion values ('19. la suppression d''un dossier emporte sa connexion',
    'restantes : ' || coalesce(vus::text, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    accepte and code_recu = 'P0001' and vus = 0);

  -- ══ 20. Rien n'est resté ════════════════════════════════════════════════════════════════════════════
  select count(*) into nb_connexions_apres from connexions_bancaires;
  select count(*) into nb_lignes_apres from lignes_bancaires;
  select count(*) into nb_dossiers_apres from dossiers;
  insert into essai_connexion values ('20. rien n''est resté en base',
    'connexions ' || nb_connexions_avant || ' -> ' || nb_connexions_apres || ', mouvements ' || nb_lignes_avant || ' -> '
      || nb_lignes_apres || ', dossiers ' || nb_dossiers_avant || ' -> ' || nb_dossiers_apres,
    nb_connexions_avant = nb_connexions_apres and nb_lignes_avant = nb_lignes_apres and nb_dossiers_avant = nb_dossiers_apres);
end $$;

select controle, ok, observe from essai_connexion order by
  (regexp_match(controle, '^(\d+)'))[1]::int, controle;
