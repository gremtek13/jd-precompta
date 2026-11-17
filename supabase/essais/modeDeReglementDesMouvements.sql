-- LE MODE DE RÈGLEMENT DES MOUVEMENTS DU RELEVÉ (EXP58-Q1 ; la migration préparée `mode_de_reglement_des_mouvements`,
-- supabase/preparees/20261117190000_mode_de_reglement_des_mouvements.sql). Le récit : HISTORIQUE.md, « 17/11/2026 — EXP58-Q1 :
-- LE MODE DE RÈGLEMENT D'UN MOUVEMENT, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer après toute migration qui touche
-- `poser_modes_de_reglement`, `garder_mode_de_reglement`, `garder_mouvement_valide`, `admin_du_dossier`, les déclencheurs de
-- `lignes_bancaires` ou ses contraintes. SANS LA MIGRATION (la colonne absente du catalogue), il se dit EN ATTENTE.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : un texte nullable sans défaut ; sa liste fermée, telle que le module la redit (`MODES_D_UN_MOUVEMENT`,
--      src/lib/modeDeReglement.ts) ; la fonction aux droits du propriétaire, exécutable par `authenticated` seul ; la garde
--      aux droits de l'appelant, qu'aucun rôle de session n'exécute, sous ses deux déclencheurs ; le figement, sur toute mise à
--      jour, avec le corps qui compare la ligne entière ;
--   2. LA FONCTION : le chef pose un mode, deux d'un coup, en retire un (nul), et lit ce qu'elle rend ; ses refus, dans
--      l'ordre et sous leurs mots — la forme, un mouvement d'un autre dossier, un mode hors de la liste — ; TOUT OU RIEN : un
--      lot dont un mouvement est figé n'écrit rien, pas même sur l'autre ;
--   3. L'ACCÈS, AVANT TOUTE LECTURE : le client d'essai, sur son propre dossier, un mouvement inconnu à la main, entend
--      « Accès refusé » et non « pas un mouvement de ce dossier » ; sur le dossier jetable aussi ; l'anonyme n'exécute pas la
--      fonction ; le membre d'équipe d'essai, non assigné au dossier, est refusé, et assigné, il pose (sans lui — ESSAIS-Q1 —,
--      ces deux étapes ne se jouent pas et le disent) ;
--   4. LA GARDE : ni le chef (super-administrateur) ni le propriétaire hors de la RLS ne changent le mode par une écriture
--      directe ; le propriétaire n'insère pas un mouvement qui en porte un, le super-administrateur si (la restauration) ; une
--      écriture qui ne touche pas le mode passe sur un mouvement qui en porte un ;
--   5. LE FIGEMENT : le mode d'un mouvement daté d'un exercice validé ne se pose plus, ne se change plus et ne se retire plus,
--      même par la fonction — sous les mots du figement d'hier ; reposé à l'identique, rien ne change et rien ne se refuse.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `30de0000-0000-4000-8000`) : DM, nu, en trésorerie, ses
-- mouvements LA (un débit) et LB (un crédit), datés de l'année en cours (`date_n`), et LF (un débit), daté d'un 10 mars de
-- l'année d'avant (`date_p`) — l'année que le figement éprouvé couvre, sans couvrir LA ; DX, l'autre dossier, et son
-- mouvement LX. Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le propriétaire
-- pose d'abord (l'exercice validé est posé à la main, comme dans dateDeValeurDesMouvements.sql : c'est le figement qu'on
-- éprouve, pas la validation ; un mode d'avance se pose sous le réglage de la fonction, que le propriétaire peut prendre),
-- puis le geste (du chef, du client, de l'anonyme ou du membre sous la RLS, ou du propriétaire), puis la fin de la
-- transaction simulée (`set constraints all immediate`), puis ce qu'on relit ; le jeu s'annule à la fin
-- (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.mode_de_reglement_des_mouvements`) : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient
-- aucune instruction qui retire des lignes, et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil
-- d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dossier_du_client constant text := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  dm constant text := '30de0000-0000-4000-8000-0000000000d1';
  dx constant text := '30de0000-0000-4000-8000-0000000000d2';
  la constant text := '30de0000-0000-4000-8000-0000000000a1';
  lb constant text := '30de0000-0000-4000-8000-0000000000a2';
  lf constant text := '30de0000-0000-4000-8000-0000000000a3';
  lx constant text := '30de0000-0000-4000-8000-0000000000a4';
  inconnu constant text := '30de0000-0000-4000-8000-0000000000ff';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  date_p constant date := make_date(extract(year from now() at time zone 'Europe/Paris')::integer - 1, 3, 10);
  -- Trois cents jours plus tard : l'année qui suit, que la validation de l'année de `date_p` ne fige pas.
  date_n constant date := date_p + 300;
  appliquee constant boolean := exists (select 1 from pg_attribute a where a.attrelid = 'public.lignes_bancaires'::regclass
                                          and a.attname = 'mode_reglement' and not a.attisdropped);
  -- Le membre d'équipe d'essai (ESSAIS-Q1) : présent sur les répliques ; en production, une fois `outils/membre-d-essai/creer.sql`
  -- collé. Absent, ses étapes ne se jouent pas, et le disent.
  membre_present constant boolean := exists (select 1 from cabinet_admins ca where ca.user_id = membre::uuid and ca.cabinet_id = cabinet
                                               and ca.role = 'comptable');
  acces constant text := 'Accès refusé à ce dossier.';
  forme constant text := 'Les modes de règlement à poser sont mal formés : autant de mouvements que de modes, chaque mouvement une fois, de 1 à 1 000.';
  hors_dossier constant text := 'Un des mouvements n''est pas un mouvement de ce dossier.';
  hors_liste constant text := 'Un mode de règlement n''est pas de la liste : Virement, Prélèvement, Carte bancaire, Chèque, Espèces, Effet ou Autre.';
  garde_maj constant text := 'Le mode de règlement d''un mouvement ne se pose, ne se corrige et ne se retire que par sa fonction, sur un clic du cabinet.';
  garde_insertion constant text := 'Un mouvement ne s''importe pas avec un mode de règlement : le cabinet le pose ensuite, sur la fiche du mouvement.';
  fige constant text := '%: ce mouvement ne change plus.';
  valide constant text := $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes,
    nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{DM}', extract(year from '{DP}'::date)::int, now(),
    '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('0', 64), '{}'::jsonb);$q$;
  -- Un mode posé d'avance, par le propriétaire, sous le réglage que la garde reconnaît (celui que la fonction prend).
  d_avance constant text := $q$select set_config('jd.mode_de_reglement', '{DM}', true);
    update lignes_bancaires set mode_reglement = 'Chèque' where id in ('{LA}', '{LF}');
    select set_config('jd.mode_de_reglement', '', true);$q$;
  modes_de_dm constant text := $q$(select string_agg(coalesce(mode_reglement, 'nul'), ',' order by libelle) from lignes_bancaires where dossier_id = '{DM}')$q$;
  e record; v_code text; v_msg text; v_obs text; v_textes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.mode_de_reglement_des_mouvements', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration mode_de_reglement_des_mouvements (EXP58-Q1)', 'ok', true,
      'observe', 'absente : le mode de règlement d''un mouvement ne se pose pas encore ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (dm::uuid, 'ESSAI EXP58Q1 DM', cabinet, 'tresorerie', '455000'),
      (dx::uuid, 'ESSAI EXP58Q1 DX', cabinet, 'tresorerie', '455000');
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values
      (la::uuid, dm::uuid, date_n, 'ESSAI EXP58Q1 A CB', -45.50, 'non_rapprochee'),
      (lb::uuid, dm::uuid, date_n, 'ESSAI EXP58Q1 B VIR', 120, 'non_rapprochee'),
      (lf::uuid, dm::uuid, date_p, 'ESSAI EXP58Q1 F FIGE', -30, 'non_rapprochee'),
      (lx::uuid, dx::uuid, date_p, 'ESSAI EXP58Q1 X AUTRE DOSSIER', -12, 'non_rapprochee');

    -- Une étape : {rang, étape, ce que le PROPRIÉTAIRE pose d'abord, qui fait le geste (`chef`, `client`, `anon`, `membre`
    -- sous la RLS, `proprio` hors d'elle), le geste, ce qu'on relit, le code attendu (`OK` : accepté) et ce qu'on relit, ou
    -- les mots du refus (un `%` s'y lit comme dans LIKE)}.
    for e in select * from (values
      (1, '1. le catalogue : un texte nullable sans défaut ; sa liste fermée ; la fonction aux droits du propriétaire, à authenticated seul ; la garde aux droits de l''appelant, sous ses deux déclencheurs ; le figement sur toute mise à jour, avec le corps qui compare la ligne entière',
        null, 'proprio', null,
        $q$(select format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text from pg_attribute a
             where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'mode_reglement')
           || ' | ' || (select pg_get_constraintdef(c.oid) from pg_constraint c
                         where c.conrelid = 'public.lignes_bancaires'::regclass and c.conname = 'lignes_bancaires_mode_reglement_liste')
           || ' | ' || (select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',') || ' '
                               || has_function_privilege('authenticated', p.oid, 'execute')::text || ' '
                               || has_function_privilege('anon', p.oid, 'execute')::text
                          from pg_proc p where p.oid = 'public.poser_modes_de_reglement(uuid, uuid[], text[])'::regprocedure)
           || ' | ' || (select p.prosecdef::text || ' ' || has_function_privilege('authenticated', p.oid, 'execute')::text
                          from pg_proc p where p.oid = 'public.garder_mode_de_reglement()'::regprocedure)
           || ' | ' || (select string_agg(t.tgname || ' ' || t.tgtype::text || ' ' || t.tgenabled::text, ', ' order by t.tgname)
                          from pg_trigger t where t.tgrelid = 'public.lignes_bancaires'::regclass
                           and t.tgfoid = 'public.garder_mode_de_reglement()'::regprocedure)
           || ' | ' || (select t.tgtype::text || ' ' || coalesce(nullif(t.tgattr::text, ''), 'toute') || ' ' || t.tgenabled::text
                         from pg_trigger t where t.tgrelid = 'public.lignes_bancaires'::regclass
                          and t.tgname = 'lignes_bancaires_figees_par_la_validation')
           || ' | ' || (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = 'public.garder_mouvement_valide()'::regprocedure)$q$,
        'OK', 'text false false | CHECK (((mode_reglement IS NULL) OR (mode_reglement = ANY (ARRAY[''Virement''::text, ''Prélèvement''::text, ''Carte bancaire''::text, ''Chèque''::text, ''Espèces''::text, ''Effet''::text, ''Autre''::text])))) | true search_path=public true false | false false | lignes_bancaires_mode_de_reglement_change 19 O, lignes_bancaires_mode_de_reglement_insere 7 O | 31 toute O | f10207e741e52cd7684e2b9e5ccd5328'),
      (2, '2. le chef pose « Carte bancaire » sur LA : accepté, et la fonction rend le mouvement écrit et son mode',
        null, 'chef', $q$select set_config('essai.mode_de_reglement_rendu', (select count(*)::text || ' ' || string_agg(r.mode_de_reglement, ',')
          || ' ' || bool_and(r.ligne_bancaire_id = '{LA}')::text
          from public.poser_modes_de_reglement('{DM}', array['{LA}']::uuid[], array['Carte bancaire']) r), true);$q$,
        $q$current_setting('essai.mode_de_reglement_rendu') || ' | ' || {MODES}$q$, 'OK', '1 Carte bancaire true | Carte bancaire,nul,nul'),
      (3, '2b. deux d''un coup — « Virement » sur le crédit LB, « Prélèvement » sur LA : acceptés ensemble',
        null, 'chef', $q$select public.poser_modes_de_reglement('{DM}', array['{LB}', '{LA}']::uuid[], array['Virement', 'Prélèvement']);$q$,
        '{MODES}', 'OK', 'Prélèvement,Virement,nul'),
      (4, '2c. un mode nul retire celui qui était posé',
        '{AVANCE}', 'chef', $q$select public.poser_modes_de_reglement('{DM}', array['{LA}']::uuid[], array[null]::text[]);$q$,
        '{MODES}', 'OK', 'nul,nul,Chèque'),
      (5, '2d. la forme : deux listes de longueurs différentes',
        null, 'chef', $q$select public.poser_modes_de_reglement('{DM}', array['{LA}', '{LB}']::uuid[], array['Virement']);$q$,
        null, '22023', forme),
      (6, '2e. la forme : un mouvement deux fois',
        null, 'chef', $q$select public.poser_modes_de_reglement('{DM}', array['{LA}', '{LA}']::uuid[], array['Virement', 'Chèque']);$q$,
        null, '22023', forme),
      (7, '2f. la forme : deux listes vides',
        null, 'chef', $q$select public.poser_modes_de_reglement('{DM}', array[]::uuid[], array[]::text[]);$q$,
        null, '22023', forme),
      (8, '2g. un mouvement d''un autre dossier, au milieu d''un lot : refusé, et rien n''est écrit',
        null, 'chef', $q$select public.poser_modes_de_reglement('{DM}', array['{LA}', '{LX}']::uuid[], array['Virement', 'Virement']);$q$,
        null, '22023', hors_dossier),
      (9, '2h. un mode hors de la liste — « Banque », que le FEC écrit faute de mode, n''en est pas un',
        null, 'chef', $q$select public.poser_modes_de_reglement('{DM}', array['{LA}']::uuid[], array['Banque']);$q$,
        null, '22023', hors_liste),
      (10, '2i. … ni un mode mal écrit (« carte »), ni le vide',
        null, 'chef', $q$select public.poser_modes_de_reglement('{DM}', array['{LA}', '{LB}']::uuid[], array['Virement', 'carte']);$q$,
        null, '22023', hors_liste),
      (11, '2j. tout ou rien : un lot dont un mouvement est figé n''écrit rien, pas même sur LA',
        '{VALIDE}', 'chef', $q$do $d$ begin perform public.poser_modes_de_reglement('{DM}', array['{LA}', '{LF}']::uuid[], array['Chèque', 'Chèque']);
          exception when others then null; end $d$;$q$,
        '{MODES}', 'OK', 'nul,nul,nul'),
      (12, '3. l''accès avant toute lecture : le client d''essai, sur SON dossier, un mouvement inconnu à la main, entend « Accès refusé »',
        null, 'client', $q$select public.poser_modes_de_reglement('{DC}', array['{INCONNU}']::uuid[], array['Virement']);$q$,
        null, '42501', acces),
      (13, '3b. … et sur le dossier jetable',
        null, 'client', $q$select public.poser_modes_de_reglement('{DM}', array['{LA}']::uuid[], array['Virement']);$q$,
        null, '42501', acces),
      (14, '3c. l''anonyme n''exécute pas la fonction',
        null, 'anon', $q$select public.poser_modes_de_reglement('{DM}', array['{LA}']::uuid[], array['Virement']);$q$,
        null, '42501', 'permission denied for function poser_modes_de_reglement'),
      (15, '3d. le membre d''équipe d''essai, que le dossier jetable n''a pas assigné : refusé',
        null, 'membre', $q$select public.poser_modes_de_reglement('{DM}', array['{LA}']::uuid[], array['Virement']);$q$,
        null, '42501', acces),
      (16, '3e. … assigné au dossier jetable : il pose',
        $q$insert into dossier_assignations (dossier_id, user_id) values ('{DM}', '{MEMBRE}');$q$, 'membre',
        $q$select public.poser_modes_de_reglement('{DM}', array['{LA}']::uuid[], array['Espèces']);$q$,
        '{MODES}', 'OK', 'Espèces,nul,nul'),
      (17, '4. la garde : le chef, super-administrateur, ne change pas le mode par une écriture directe',
        null, 'chef', $q$update lignes_bancaires set mode_reglement = 'Virement' where id = '{LA}';$q$,
        null, '42501', garde_maj),
      (18, '4b. … ni ne le retire',
        '{AVANCE}', 'chef', $q$update lignes_bancaires set mode_reglement = null where id = '{LA}';$q$,
        null, '42501', garde_maj),
      (19, '4c. … ni le propriétaire, hors de la RLS, sans le réglage de la fonction',
        null, 'proprio', $q$update lignes_bancaires set mode_reglement = 'Virement' where id = '{LA}';$q$,
        null, '42501', garde_maj),
      (20, '4d. le propriétaire n''insère pas un mouvement qui porte un mode (l''import, la connexion bancaire)',
        null, 'proprio', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, mode_reglement) values ('{DM}', '{DP}', 'ESSAI EXP58Q1 INSERE', -10, 'non_rapprochee', 'Carte bancaire');$q$,
        null, '42501', garde_insertion),
      (21, '4e. le super-administrateur si : la restauration réinsère le mode',
        null, 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, mode_reglement) values ('{DM}', '{DP}', 'ESSAI EXP58Q1 INSERE', -10, 'non_rapprochee', 'Carte bancaire');$q$,
        $q$(select string_agg(mode_reglement, ',') from lignes_bancaires where dossier_id = '{DM}' and libelle = 'ESSAI EXP58Q1 INSERE')$q$, 'OK', 'Carte bancaire'),
      (22, '4f. l''insertion d''hier, sans mode : acceptée au propriétaire, le mode nul',
        null, 'proprio', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut) values ('{DM}', '{DP}', 'ESSAI EXP58Q1 INSERE', -10, 'non_rapprochee');$q$,
        $q$(select string_agg(coalesce(mode_reglement, 'nul'), ',') from lignes_bancaires where dossier_id = '{DM}' and libelle = 'ESSAI EXP58Q1 INSERE')$q$, 'OK', 'nul'),
      (23, '4g. une écriture qui ne touche pas le mode passe sur un mouvement qui en porte un',
        '{AVANCE}', 'chef', $q$update lignes_bancaires set libelle = 'ESSAI EXP58Q1 A CB RELU' where id = '{LA}';$q$,
        $q$(select libelle || ' ' || mode_reglement from lignes_bancaires where id = '{LA}')$q$, 'OK', 'ESSAI EXP58Q1 A CB RELU Chèque'),
      (24, '5. un exercice validé couvre LF : la fonction n''y pose plus de mode',
        '{VALIDE}', 'chef', $q$select public.poser_modes_de_reglement('{DM}', array['{LF}']::uuid[], array['Virement']);$q$,
        null, '23514', fige),
      (25, '5b. … ni n''en change un, ni n''en retire un',
        '{AVANCE}{VALIDE}', 'chef', $q$select public.poser_modes_de_reglement('{DM}', array['{LF}']::uuid[], array[null]::text[]);$q$,
        null, '23514', fige),
      (26, '5c. reposé à l''identique, rien ne change et rien ne se refuse',
        '{AVANCE}{VALIDE}', 'chef', $q$select public.poser_modes_de_reglement('{DM}', array['{LF}']::uuid[], array['Chèque']);$q$,
        $q$(select mode_reglement from lignes_bancaires where id = '{LF}')$q$, 'OK', 'Chèque'),
      (27, '5d. le contrôle positif : sans exercice validé, le mode de LF change',
        '{AVANCE}', 'chef', $q$select public.poser_modes_de_reglement('{DM}', array['{LF}']::uuid[], array['Virement']);$q$,
        $q$(select mode_reglement from lignes_bancaires where id = '{LF}')$q$, 'OK', 'Virement')
    ) as v(rang, etape, pose, qui, geste, relu, code, attendu) order by rang
    loop
      v_code := 'OK';
      v_msg := null;
      v_obs := null;
      if e.qui = 'membre' and not membre_present then
        verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape, 'ok', true,
          'observe', 'non joué : le membre d''équipe d''essai est absent (ESSAIS-Q1), rien d''affirmé');
        continue;
      end if;
      begin
        v_textes := array[e.pose, e.geste, e.relu, e.attendu];
        for i in 1 .. 4 loop
          if v_textes[i] is null then continue; end if;
          v_textes[i] := replace(replace(replace(v_textes[i], '{AVANCE}', d_avance), '{VALIDE}', valide), '{MODES}', modes_de_dm);
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{DM}', dm), '{DX}', dx), '{DC}', dossier_du_client), '{INCONNU}', inconnu);
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{LA}', la), '{LB}', lb), '{LF}', lf), '{LX}', lx);
          v_textes[i] := replace(replace(replace(v_textes[i], '{DP}', date_p::text), '{CHEF}', chef), '{MEMBRE}', membre);
        end loop;
        if v_textes[1] is not null then
          execute v_textes[1];
        end if;
        begin
          if v_textes[2] is not null then
            if e.qui in ('chef', 'client', 'membre') then
              execute 'set local role authenticated';
              perform set_config('request.jwt.claims', json_build_object('sub',
                case e.qui when 'chef' then chef when 'client' then client else membre end, 'role', 'authenticated')::text, true);
            elsif e.qui = 'anon' then
              execute 'set local role anon';
              perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
            end if;
            execute v_textes[2];
            reset role;
            perform set_config('request.jwt.claims', '', true);
          end if;
          -- La fin de la transaction simulée : les déclencheurs différés jugent ce que le geste a laissé.
          set constraints all immediate;
          set constraints all deferred;
          if v_textes[3] is not null then
            execute 'select (' || v_textes[3] || ')::text' into v_obs;
          end if;
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
        'ok', v_code = e.code and v_msg like v_textes[4], 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs mouvements, ni leur exercice validé, ni l''assignation du membre',
    'ok', not exists (select 1 from dossiers where id in (dm::uuid, dx::uuid))
      and not exists (select 1 from lignes_bancaires where id in (la::uuid, lb::uuid, lf::uuid, lx::uuid) or dossier_id in (dm::uuid, dx::uuid))
      and not exists (select 1 from exercices_valides where dossier_id in (dm::uuid, dx::uuid))
      and not exists (select 1 from dossier_assignations where dossier_id in (dm::uuid, dx::uuid)),
    'observe', 'relu');
  perform set_config('essai.mode_de_reglement_des_mouvements', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.mode_de_reglement_des_mouvements')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
