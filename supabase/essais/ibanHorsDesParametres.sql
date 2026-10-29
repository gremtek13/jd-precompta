-- UN IBAN HORS DES TEXTES DES PARAMÈTRES DE FACTURATION, ÉPROUVÉ EN BASE (espace client, étape A7, ligne 51.5 ; A7-Q3 ;
-- migration `iban_hors_des_parametres`, qui suppose `mentions_figees`) — à rejouer par `execute_sql` après toute migration
-- qui touche `enregistrer_parametres_facturation`, `porte_un_iban`, `confirmer_rib` ou la table des paramètres.
--
-- Ce qui se prouve ici, par impersonation — le client de l'essai avec « Ventes » ; le chef du cabinet, super-administrateur
-- de la base d'essai ; le propriétaire de la base :
--   - LE NEUVIÈME RANG d'`enregistrer_parametres_facturation` : un texte libre — les conditions d'escompte, les pénalités de
--     retard, les mentions complémentaires, le pied de page — qui porte un IBAN valide se refuse, pour le cabinet comme pour
--     le client, chacun nommé dans le refus, dans l'ordre du quatrième rang ; écrit en capitales ou en minuscules, en
--     groupes de quatre ou d'un seul tenant, au milieu d'une phrase ; un IBAN à clé fausse passe ; le titulaire du compte,
--     qui s'imprime avec le RIB confirmé, ne se juge pas ;
--   - SON RANG : les refus d'hier passent d'abord — un texte trop long (quatrième rang), le logo (huitième) ;
--   - LA RESTAURATION, seule autre porte : le super-administrateur réinsère une version telle quelle, IBAN compris ;
--     `confirmer_rib` en confirme le RIB sans toucher aux textes ; une version qui la remplace et redit le même pied de page
--     se refuse ; le client n'insère rien en direct ;
--   - et que RIEN ne reste en base.
--
-- Tout se joue dans des dossiers JETABLES du cabinet du chef, au sein d'un bloc qui s'annule entièrement à la fin
-- (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`), le
-- verdict posé dans une VARIABLE avant ; les étapes « fait » sont gardées jusqu'à l'annulation finale. Un refus se juge à
-- son code ET à son message. Le dossier P est basculé : « Ventes » ne se porte que sur un dossier basculé
-- (garder_droit_ventes). Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.iban_hors_des_parametres`) :
-- le fichier se joue d'un seul appel, ne crée aucune table et ne porte AUCUNE instruction de suppression. Hors de l'outil
-- d'exécution, il se joue en UNE transaction (`psql -1`). Avant la migration, il se dit impossible. Les IBAN d'essai
-- portent le code banque 99999 ; aucune valeur d'une ligne de la base n'est rendue, hors de celles que l'essai écrit.
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec une valeur délibérément autre : chacune doit MORDRE.
do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cabinet uuid;
  ids jsonb;
  avant text; apres text;
  s record; k text; ordre text; partie text; attendu text; rendu text; accepte boolean; code_recu text; message text; ok boolean;
  erreur text;
  verdicts jsonb := '[]'::jsonb;
begin
  -- La migration d'abord : son témoin, le neuvième rang dans la fonction.
  if strpos(coalesce((select p.prosrc from pg_proc p
                       where p.oid = to_regprocedure('public.enregistrer_parametres_facturation(uuid, uuid, jsonb)')), ''),
            'porte_un_iban(') = 0 then
    raise exception 'ESSAI_IMPOSSIBLE : la migration iban_hors_des_parametres n''est pas en base';
  end if;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DP', 'a7a00000-0000-4000-8000-0000000009a1', 'DR', 'a7a00000-0000-4000-8000-0000000009b1',
    'ACCES', 'a7a00000-0000-4000-8000-0000000009f1', 'VR', 'a7a00000-0000-4000-8000-0000000009c1',
    'SHA', repeat('a7', 32));

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from parametres_facturation)),
    ((select count(*) from cabinets))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, ordre(s), code attendu ou OK, message ou valeur attendus, clé) ; plusieurs ordres
      -- se séparent par « §§ », {RENDU} y vaut ce que le précédent a rendu.

      -- ══ Le jeu ══════════
      ('j1', 'jeu', 'deux dossiers jetables : P, basculé, et R, vide, pour la restauration', 'proprietaire',
        $q$insert into dossiers (id, nom, cabinet_id, ventes_par_les_factures) values
          ('{DP}', 'ESSAI IBAN P', '{CAB}', true), ('{DR}', 'ESSAI IBAN R', '{CAB}', false)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès « Ventes » du client au dossier P', 'proprietaire',
        $q$insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values ('{ACCES}', '{CLIENT}', '{DP}', 'client', 'essai-iban@example.test', true)$q$,
        'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'enregistrer_parametres_facturation : security definer, son chemin fixé ; les comptes connectés l''exécutent, pas l''anonyme ; elle appelle porte_un_iban', 'proprietaire',
        $q$select p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
               || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute') || ' ' || (strpos(p.prosrc, 'public.porte_un_iban(x.valeur)') > 0)
             from pg_proc p where p.oid = 'public.enregistrer_parametres_facturation(uuid,uuid,jsonb)'::regprocedure$q$,
        'OK', 'true search_path=public anon false authenticated true true', null),

      -- ══ 1. Un IBAN dans chaque texte libre, pour le cabinet puis pour le client ══════════
      ('10', 'controle', 'un IBAN dans les conditions d''escompte : le cabinet n''enregistre pas', 'chef',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"escompte":"Escompte de 2 % versé sur FR13 9999 9000 0200 0000 0001 234"}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans les conditions d''escompte : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('11', 'controle', 'un IBAN dans les pénalités de retard : le cabinet n''enregistre pas', 'chef',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"penalites":"Pénalités à régler sur FR1399999000020000000001234"}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans les pénalités de retard : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('12', 'controle', 'un IBAN dans les mentions complémentaires : le cabinet n''enregistre pas', 'chef',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"mentions_complementaires":"Coordonnées : FR13 9999 9000 0200 0000 0001 234."}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans les mentions complémentaires : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('13', 'controle', 'un IBAN dans le pied de page : le cabinet n''enregistre pas', 'chef',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"pied_de_page":"ESSAI IBAN, IBAN FR13 9999 9000 0200 0000 0001 234"}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans le pied de page : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('14', 'controle', 'un IBAN dans les conditions d''escompte : le client « Ventes » n''enregistre pas', 'client',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"escompte":"Escompte de 2 % versé sur FR13 9999 9000 0200 0000 0001 234"}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans les conditions d''escompte : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('15', 'controle', 'un IBAN dans les pénalités de retard : le client « Ventes » n''enregistre pas', 'client',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"penalites":"Pénalités à régler sur FR1399999000020000000001234"}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans les pénalités de retard : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('16', 'controle', 'un IBAN dans les mentions complémentaires : le client « Ventes » n''enregistre pas', 'client',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"mentions_complementaires":"Coordonnées : FR13 9999 9000 0200 0000 0001 234."}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans les mentions complémentaires : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('17', 'controle', 'un IBAN dans le pied de page : le client « Ventes » n''enregistre pas', 'client',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"pied_de_page":"ESSAI IBAN, IBAN FR13 9999 9000 0200 0000 0001 234"}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans le pied de page : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('18', 'controle', 'en minuscules, en groupes de quatre : refusé', 'chef',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"pied_de_page":"iban fr13 9999 9000 0200 0000 0001 234"}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans le pied de page : %', null),
      ('19', 'controle', 'un IBAN d''un autre pays, au milieu d''une phrase : refusé', 'client',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"mentions_complementaires":"Pour nos clients belges : BE60 9990 0000 1234, merci."}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans les mentions complémentaires : %', null),
      ('20', 'controle', 'un IBAN à clé fausse : il ne se lit pas, la version s''enregistre', 'chef',
        $q$select (p.pied_de_page = 'ESSAI IBAN, IBAN FR14 9999 9000 0200 0000 0001 234')::text
             from public.enregistrer_parametres_facturation('{DP}', null, '{"pied_de_page":"ESSAI IBAN, IBAN FR14 9999 9000 0200 0000 0001 234"}'::jsonb) p$q$,
        'OK', 'true', null),
      ('21', 'controle', 'l''ordre : un IBAN dans l''escompte et dans le pied de page, l''escompte d''abord', 'client',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"escompte":"FR1399999000020000000001234","pied_de_page":"FR1399999000020000000001234"}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans les conditions d''escompte : %', null),
      ('22', 'controle', 'l''ordre : les refus d''hier d''abord — un texte trop long', 'chef',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null,
             jsonb_build_object('escompte', repeat('é', 301), 'pied_de_page', 'FR1399999000020000000001234')) p$q$,
        '22023', 'Les conditions d''escompte sont un texte de trois cents caractères au plus, qui ne soit pas vide.', null),
      ('23', 'controle', 'l''ordre : les refus d''hier d''abord — le logo, au huitième rang', 'chef',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"pied_de_page":"FR1399999000020000000001234","logo_chemin":"x"}'::jsonb) p$q$,
        '22023', 'Le logo se donne par son chemin et son empreinte, ensemble.', null),
      ('24', 'controle', 'le titulaire du compte ne se juge pas : il s''imprime avec le RIB confirmé', 'chef',
        $q$select p.rib_etat from public.enregistrer_parametres_facturation('{DP}', null,
             '{"iban":"FR9399999000010000000000100","titulaire_compte":"ESSAI FR13 9999 9000 0200 0000 0001 234"}'::jsonb) p$q$,
        'OK', 'confirme', null),
      ('M1', 'mutation', 'le contrôle 13 rejoué avec un IBAN à clé fausse : la version s''enregistre', 'chef',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"pied_de_page":"ESSAI IBAN, IBAN FR14 9999 9000 0200 0000 0001 234"}'::jsonb) p$q$,
        'OK', null, null),
      ('M2', 'mutation', 'le contrôle 14 rejoué sans IBAN : la version s''enregistre', 'client',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"escompte":"Escompte de 2 % pour un paiement à huit jours."}'::jsonb) p$q$,
        'OK', null, null),
      ('M3', 'mutation', 'le contrôle 21 rejoué, l''escompte sans IBAN : c''est alors le pied de page qui refuse', 'client',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"escompte":"Sans escompte.","pied_de_page":"FR1399999000020000000001234"}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans le pied de page : %', null),
      ('25', 'fait', 'le cabinet enregistre une première version, sans IBAN', 'chef',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', null, '{"pied_de_page":"ESSAI IBAN P"}'::jsonb) p$q$, 'OK', null, 'V1'),
      ('26', 'controle', 'le client la remplace par une version qui porte un IBAN : refusée', 'client',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DP}', '{V1}', '{"pied_de_page":"ESSAI IBAN P FR13 9999 9000 0200 0000 0001 234"}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans le pied de page : %', null),

      -- ══ 2. La restauration, seule autre porte : elle réinsère tel quel ══════════
      ('30', 'controle', 'le super-administrateur réinsère une version dont les quatre textes portent un IBAN', 'chef',
        $q$with i as (insert into parametres_facturation (dossier_id, delai_paiement_jours, escompte, penalites, mentions_complementaires, pied_de_page, auteur)
             values ('{DR}', 30, 'FR1399999000020000000001234', 'FR1399999000020000000001234', 'FR13 9999 9000 0200 0000 0001 234',
                     'ESSAI IBAN R, IBAN FR13 9999 9000 0200 0000 0001 234', '{CHEF}') returning 1) select count(*)::text from i$q$,
        'OK', '1', null),
      ('31', 'controle', 'le client n''insère rien en direct', 'client',
        $q$insert into parametres_facturation (dossier_id, delai_paiement_jours, pied_de_page, auteur) values ('{DP}', 30, 'ESSAI IBAN', '{CLIENT}')$q$,
        '42501', '%row-level security%', null),
      ('32', 'fait', 'le super-administrateur réinsère une version de R, un IBAN dans son pied de page et un RIB proposé', 'chef',
        $q$insert into parametres_facturation (id, dossier_id, delai_paiement_jours, pied_de_page, iban, rib_etat, auteur)
           values ('{VR}', '{DR}', 30, 'ESSAI IBAN R, IBAN FR13 9999 9000 0200 0000 0001 234', 'FR9399999000010000000000100', 'propose', '{CLIENT}')$q$,
        'OK', null, null),
      ('33', 'controle', 'le cabinet en confirme le RIB : les textes n''y changent pas', 'chef',
        $q$select p.rib_etat || '|' || (p.pied_de_page = 'ESSAI IBAN R, IBAN FR13 9999 9000 0200 0000 0001 234')::text
             from public.confirmer_rib('{DR}', '{VR}') p$q$, 'OK', 'confirme|true', null),
      ('34', 'controle', 'une version qui la remplace et redit le même pied de page : refusée', 'chef',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DR}', '{VR}',
             '{"delai_paiement_jours":45,"pied_de_page":"ESSAI IBAN R, IBAN FR13 9999 9000 0200 0000 0001 234"}'::jsonb) p$q$,
        '22023', 'Un IBAN figure dans le pied de page : %', null),
      ('M4', 'mutation', 'le contrôle 34 rejoué, le pied de page sans IBAN : la version s''enregistre', 'chef',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DR}', '{VR}', '{"delai_paiement_jours":45,"pied_de_page":"ESSAI IBAN R"}'::jsonb) p$q$,
        'OK', null, null)
    ) as x(num, genre, controle, qui, ordre, code, attendu, cle)
    loop
      ordre := s.ordre;
      attendu := s.attendu;
      for k in select jsonb_object_keys(ids) loop
        ordre := replace(ordre, '{' || k || '}', ids ->> k);
        attendu := replace(attendu, '{' || k || '}', ids ->> k);
      end loop;
      accepte := false; code_recu := null; message := null; rendu := null;
      begin
        if s.qui in ('client', 'chef') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'client' then client else chef end, 'role', 'authenticated')::text, true);
        end if;
        foreach partie in array string_to_array(ordre, '§§') loop
          partie := replace(partie, '{RENDU}', coalesce(rendu, ''));
          if partie ~* '^\s*(insert|update)' and partie !~* 'returning' then
            execute partie;
          else
            execute partie into rendu;
          end if;
        end loop;
        accepte := true;
        if s.genre in ('controle', 'mutation', 'valeur') then
          raise exception 'ANNULATION_ESSAI';
        end if;
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      if s.cle is not null and accepte and rendu is not null then
        ids := ids || jsonb_build_object(s.cle, rendu);
      end if;
      ok := case
        when s.code = 'OK' then accepte and (attendu is null or coalesce(rendu, '') like attendu)
                                and (s.cle is null or rendu is not null)
        else not accepte and code_recu = s.code and message like attendu
      end;
      if s.genre = 'jeu' and not ok then
        raise exception 'ESSAI_IMPOSSIBLE : le jeu % n''a pas pu être posé (% %)', s.num, code_recu, message;
      end if;
      if s.genre <> 'jeu' then
        verdicts := verdicts || jsonb_build_object('controle', s.num || '. ' || s.controle, 'genre', s.genre,
          'observe', case when accepte then 'accepté : ' || coalesce(rendu, '—') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
          'ok', ok);
      end if;
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from parametres_facturation)),
    ((select count(*) from cabinets))
  ) as t(n);
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '999. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)), 'ok', erreur is null and avant = apres);
  perform set_config('essai.iban_hors_des_parametres', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.iban_hors_des_parametres')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, coalesce((regexp_match(v.controle, '^M?(\d+)'))[1]::int, 0), v.controle;
