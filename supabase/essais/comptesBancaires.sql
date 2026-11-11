-- PLUSIEURS COMPTES BANCAIRES D'UN DOSSIER, LA BASE (ligne 26.6, lot MCB1 ; la migration `comptes_bancaires`, PRÉPARÉE le
-- 11/11/2026, supabase/preparees/). Le récit : HISTORIQUE.md, « 11/11/2026 — PLUSIEURS COMPTES BANCAIRES D'UN DOSSIER :
-- D'EMBLÉE, LES LOTS, ET LA BASE (MCB1) ». À rejouer après toute migration qui touche `comptes_bancaires`, ses quatre
-- déclencheurs et leurs fonctions, `compte_de_banque_du_mouvement`, `compte_du_role`, `regler_plan_du_dossier`, ou les
-- colonnes, contraintes et déclencheurs de `lignes_bancaires` et `controles_releves_bancaires`.
--
-- Ce qui se prouve ici, et ne se relit pas : le premier mouvement d'un dossier sans compte crée son principal, et le
-- mouvement, le second et le contrôle d'un relevé s'y rattachent sans rien dire ; dès deux comptes, un mouvement ou un
-- contrôle sans le sien se refuse ; la jambe de banque d'un mouvement (le 512 du principal, celui du rôle réglé au plan ;
-- celui d'un autre compte depuis son 1er janvier, et le principal avant, MCB-Q7) ; les refus d'un compte (le compte d'un
-- rôle du plan, d'un autre compte, une forme ou une date fausses, un second principal, un premier compte qui n'est pas
-- le principal, jugé à la fin de la transaction) ; le compte et la date figés au premier mouvement, le libellé toujours
-- modifiable, le rang jamais ; un mouvement qui ne change pas de compte, ni ne prend celui d'un autre dossier ; la période
-- d'un compte qui encadre ses mouvements, dans les deux sens ; le fichier d'un relevé et ses mouvements d'un seul compte,
-- dans les deux sens ; le plan qui ne prend pas le compte d'un compte bancaire, et l'inverse ; ce que le client « Banque »
-- lit (MCB-Q8), sans la case rien, et qu'il n'écrit pas ; un compte sans accès qui ne crée ni n'apprend rien ; un chef qui
-- n'est pas super-administrateur ; le catalogue. Ce qu'une suppression rencontre (un compte qui porte un mouvement, le
-- principal d'un dossier qui tient un autre compte, le dossier qui part avec ses comptes) se joue sur une réplique, hors de
-- ce fichier : supabase/essais/comptesBancairesSuppression.sql.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `cb110000-0000-4000-8000`) : DA, dont l'accès du client
-- d'essai porte « Banque », et DB, dont l'accès ne la porte pas. Chaque étape se joue dans sa sous-transaction et s'y
-- ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose d'abord (`{M1}` : le premier mouvement de DA ; `{SEC}` : son second
-- compte), puis la requête du profil ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le
-- relit. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.comptes_bancaires`), que la requête finale
-- lit : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression,
-- et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction
-- (`psql -1`). Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  da constant text := 'cb110000-0000-4000-8000-0000000000d1';
  db constant text := 'cb110000-0000-4000-8000-0000000000d2';
  acces_a constant text := 'cb110000-0000-4000-8000-0000000000a1';
  acces_b constant text := 'cb110000-0000-4000-8000-0000000000a2';
  sec_id constant text := 'cb110000-0000-4000-8000-0000000000e1';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'cb110000-0000-4000-8000-0000000000f1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  m1 constant text := $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{DA}', '2025-06-10', 'ESSAI MCB1 FRAIS', -12);$q$;
  sec constant text := $q$insert into comptes_bancaires (id, dossier_id, libelle, compte, compte_propre_depuis) values ('{S}', '{DA}', 'ESSAI MCB1 SECOND', '512100', '2026-01-01');$q$;
  principal_de_da constant text := $q$(select c.id from comptes_bancaires c where c.dossier_id = '{DA}' and c.principal)$q$;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text; v_texte text; v_f record;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.comptes_bancaires') is null then
    perform set_config('essai.comptes_bancaires', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration comptes_bancaires', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- Le jeu : les deux dossiers jetables et les accès du client d'essai, insérés par le propriétaire comme
    -- `create-client-access` les insère.
    insert into dossiers (id, nom, cabinet_id) values
      (da::uuid, 'ESSAI MCB1 DA', cabinet), (db::uuid, 'ESSAI MCB1 DB', cabinet);
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque) values
      (acces_a::uuid, client::uuid, da::uuid, 'client', 'essai-mcb1-a@example.test', true),
      (acces_b::uuid, client::uuid, db::uuid, 'client', 'essai-mcb1-b@example.test', false);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (sous sa session), le profil — `chef`, `chef_simple` (un chef du
    -- cabinet qui n'est pas super-administrateur : le compte client rattaché au cabinet le temps de la sous-transaction),
    -- `client`, `inconnu`, `proprietaire` (le propriétaire sans session) —, sa requête, le code attendu (`OK` : acceptée)
    -- et ce qu'elle rend, ou les mots du refus}.
    for e in select * from (values
      -- Le compte d'un mouvement arrivé sans le sien.
      (1, '1. le premier mouvement d''un dossier sans compte crée son compte principal, et s''y rattache', '{M1}', 'chef',
        $q$select string_agg(c.libelle || ':' || c.principal || ':' || coalesce(c.compte, '-') || ':'
                 || (select count(*) from lignes_bancaires l where l.compte_bancaire_id = c.id), ' ')
             from comptes_bancaires c where c.dossier_id = '{DA}'$q$,
        'OK', 'Compte principal:true:-:1'),
      (2, '2. le second s''y rattache aussi : un seul compte, rien à choisir', '{M1} {M1}', 'chef',
        $q$select (select count(*) from comptes_bancaires where dossier_id = '{DA}') || ':'
                  || (select count(*) from lignes_bancaires where compte_bancaire_id = {PDA})$q$,
        'OK', '1:2'),
      (3, '3. le contrôle d''un relevé sans compte aussi', '{M1}', 'chef',
        $q$insert into controles_releves_bancaires (dossier_id, source_fichier, solde_initial, solde_final, somme_mouvements, ecart, coherent)
             values ('{DA}', 'essai-mcb1.csv', 0, -12, -12, 0, true) returning (compte_bancaire_id = {PDA})::text$q$,
        'OK', 'true'),
      (4, '4. le chef ouvre un second compte, à son propre 512 depuis le 1er janvier 2026', '{M1}', 'chef',
        $q$insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values ('{DA}', 'ESSAI MCB1 SECOND', '512100', '2026-01-01')
             returning compte || ':' || compte_propre_depuis$q$,
        'OK', '512100:2026-01-01'),
      (5, '5. dès deux comptes, un mouvement sans le sien se refuse (23502)', '{M1} {SEC}', 'chef',
        $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{DA}', '2026-02-01', 'ESSAI MCB1', -1) returning id::text$q$,
        '23502', 'Ce dossier tient plusieurs comptes bancaires : un mouvement ou un relevé dit le sien.'),
      (6, '6. un contrôle sans le sien aussi (23502)', '{M1} {SEC}', 'chef',
        $q$insert into controles_releves_bancaires (dossier_id, source_fichier, solde_initial, solde_final, somme_mouvements, ecart, coherent)
             values ('{DA}', 'essai-mcb1-b.csv', 0, 0, 0, 0, true) returning id::text$q$,
        '23502', 'Ce dossier tient plusieurs comptes bancaires : un mouvement ou un relevé dit le sien.'),
      (7, '7. avec le sien, il passe ; la jambe de banque : le 512 du principal, et celui du second depuis son 1er janvier (MCB-Q7)',
        $p${M1} {SEC} insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant) values
           ('{DA}', '{S}', '2025-12-31', 'ESSAI MCB1 VEILLE', -2), ('{DA}', '{S}', '2026-01-02', 'ESSAI MCB1 JANVIER', -3);$p$, 'chef',
        $q$select string_agg(l.date || ':' || compte_de_banque_du_mouvement(l.id), ' ' order by l.date)
             from lignes_bancaires l where l.dossier_id = '{DA}'$q$,
        'OK', '2025-06-10:512000 2025-12-31:512000 2026-01-02:512100'),
      -- Les refus d'un compte.
      (8, '8. le compte d''un rôle du plan ne se prend pas (23514)', '{M1}', 'chef',
        $q$insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values ('{DA}', 'ESSAI', '512000', '2026-01-01') returning id::text$q$,
        '23514', 'Le compte 512000 est celui du rôle « banque » du plan comptable du dossier : un compte bancaire tient un compte qui n''est qu''à lui.'),
      (9, '9. ni celui d''un autre compte du dossier (23505)', '{M1} {SEC}', 'chef',
        $q$insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values ('{DA}', 'ESSAI', '512100', '2026-01-01') returning id::text$q$,
        '23505', 'Le compte 512100 tient déjà un autre compte bancaire du dossier.'),
      (10, '10. un compte qui n''est pas un 512 à six chiffres (23514)', '{M1}', 'chef',
        $q$insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values ('{DA}', 'ESSAI', '5121', '2026-01-01') returning id::text$q$,
        '23514', 'Un compte bancaire autre que le principal tient son propre compte du plan, six chiffres qui commencent par 512 : « 5121 » n''en est pas un.'),
      (11, '11. une date qui n''est pas un 1er janvier (23514)', '{M1}', 'chef',
        $q$insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values ('{DA}', 'ESSAI', '512100', '2026-03-01') returning id::text$q$,
        '23514', 'Un compte bancaire tient son propre compte depuis le premier jour d''un exercice, un 1er janvier : « 01/03/2026 » n''en est pas un.'),
      (12, '12. un second principal (23505)', '{M1}', 'chef',
        $q$insert into comptes_bancaires (dossier_id, libelle, principal) values ('{DA}', 'ESSAI', true) returning id::text$q$,
        '23505', 'Ce dossier a déjà son compte principal : un autre compte bancaire tient son propre compte 512.'),
      (13, '13. un premier compte qui n''est pas le principal se refuse, à la fin de la transaction (23514)',
        $p$insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values ('{DB}', 'ESSAI MCB1 SEUL', '512300', '2026-01-01');$p$, 'chef',
        $q$set constraints comptes_bancaires_principal_present immediate$q$,
        '23514', 'Un dossier qui tient un compte bancaire tient son compte principal : le premier créé, qui suit le compte de banque du plan.'),
      (14, '14. un libellé vide se refuse (23514)', '{M1}', 'chef',
        $q$update comptes_bancaires set libelle = '  ' where id = {PDA} returning libelle$q$,
        '23514', 'Un compte bancaire se nomme d''un libellé d''un à quatre-vingts caractères, que le client « Banque » lit.'),
      -- Ce qui se fige au premier mouvement, et ce qui ne change jamais.
      (15, '15. le compte d''un compte qui porte un mouvement ne change plus (23514)',
        $p${M1} {SEC} insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant) values ('{DA}', '{S}', '2026-01-02', 'ESSAI MCB1', -3);$p$, 'chef',
        $q$update comptes_bancaires set compte = '512200' where id = '{S}' returning compte$q$,
        '23514', 'Le compte bancaire « ESSAI MCB1 SECOND » porte déjà des mouvements ou des relevés : son compte du plan et la date depuis laquelle il le tient ne changent plus.'),
      (16, '16. sans mouvement ni relevé, il change, et sa date aussi', '{M1} {SEC}', 'chef',
        $q$update comptes_bancaires set compte = '512200', compte_propre_depuis = '2025-01-01' where id = '{S}' returning compte || ':' || compte_propre_depuis$q$,
        'OK', '512200:2025-01-01'),
      (17, '17. son libellé change toujours', $p${M1} {SEC} insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant) values ('{DA}', '{S}', '2026-01-02', 'ESSAI MCB1', -3);$p$, 'chef',
        $q$update comptes_bancaires set libelle = 'ESSAI MCB1 RENOMMÉ' where id = '{S}' returning libelle$q$,
        'OK', 'ESSAI MCB1 RENOMMÉ'),
      (18, '18. le principal ne devient pas un autre compte (23514)', '{M1}', 'chef',
        $q$update comptes_bancaires set principal = false, compte = '512100', compte_propre_depuis = '2026-01-01' where id = {PDA} returning id::text$q$,
        '23514', 'Un compte bancaire ne change ni de dossier ni de rang : le principal le reste, un autre compte aussi.'),
      (19, '19. un mouvement ne change pas de compte (23514)', '{M1} {SEC}', 'chef',
        $q$update lignes_bancaires set compte_bancaire_id = '{S}' where dossier_id = '{DA}' returning id::text$q$,
        '23514', 'Un mouvement ou un relevé ne change pas de compte bancaire : il se retire, et s''importe sous le sien.'),
      (20, '20. ni ne prend le compte d''un autre dossier (23503)',
        $p${M1} insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{DB}', '2025-06-10', 'ESSAI MCB1 DB', -1);$p$, 'chef',
        $q$insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant)
             values ('{DA}', (select c.id from comptes_bancaires c where c.dossier_id = '{DB}'), '2025-06-11', 'ESSAI MCB1', -1) returning id::text$q$,
        '23503', 'Le compte bancaire d''un mouvement ou d''un relevé est un compte de son dossier.'),
      -- La période d'un compte, le fichier d'un relevé.
      (21, '21. un mouvement hors de la période de son compte se refuse (23514)',
        $p${M1} {SEC} update comptes_bancaires set ouvert_le = '2026-01-01' where id = '{S}';$p$, 'chef',
        $q$insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant) values ('{DA}', '{S}', '2025-12-30', 'ESSAI MCB1', -1) returning id::text$q$,
        '23514', 'Le mouvement du 30/12/2025 tombe hors de la période du compte bancaire « ESSAI MCB1 SECOND » : ses dates d''ouverture et de clôture l''encadrent.'),
      (22, '22. une clôture avant un mouvement du compte se refuse (23514)', '{M1}', 'chef',
        $q$update comptes_bancaires set clos_le = '2025-05-31' where id = {PDA} returning id::text$q$,
        '23514', 'Le compte bancaire « Compte principal » porte des mouvements hors de la période qu''on lui donne : ses dates d''ouverture et de clôture les encadrent.'),
      (23, '23. le mouvement d''un relevé dont le contrôle est d''un autre compte se refuse (23514)',
        $p${M1} {SEC} insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final, somme_mouvements, ecart, coherent)
           values ('{DA}', '{S}', 'essai-mcb1.csv', 0, -1, -1, 0, true);$p$, 'chef',
        $q$insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant, source_fichier)
             values ('{DA}', {PDA}, '2026-01-05', 'ESSAI MCB1', -1, 'essai-mcb1.csv') returning id::text$q$,
        '23514', 'Le relevé « essai-mcb1.csv » est d''un autre compte bancaire : ses mouvements sont du compte de son contrôle.'),
      (24, '24. … et le contrôle d''un relevé dont les mouvements sont d''un autre compte (23514)',
        $p${M1} {SEC} insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant, source_fichier)
           values ('{DA}', '{S}', '2026-01-05', 'ESSAI MCB1', -1, 'essai-mcb1.csv');$p$, 'chef',
        $q$insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final, somme_mouvements, ecart, coherent)
             values ('{DA}', {PDA}, 'essai-mcb1.csv', 0, -1, -1, 0, true) returning id::text$q$,
        '23514', 'Le relevé « essai-mcb1.csv » est d''un autre compte bancaire : ses mouvements sont du compte de son contrôle.'),
      -- Le plan.
      (25, '25. le rôle banque du plan ne prend pas le compte d''un compte bancaire (23514)', '{M1} {SEC}', 'chef',
        $q$select regler_plan_du_dossier('{DA}', '[{"role": "banque", "compte": "512100"}]'::jsonb)::text$q$,
        '23514', 'Le compte 512100 tient le compte bancaire « ESSAI MCB1 SECOND » du dossier : le rôle « banque » du plan ne le prend pas.'),
      (26, '26. le plan réglé d''abord, un compte bancaire ne prend pas le compte du rôle (23514)',
        $p$select regler_plan_du_dossier('{DA}', '[{"role": "banque", "compte": "512200"}]'::jsonb); {M1}$p$, 'chef',
        $q$insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values ('{DA}', 'ESSAI', '512200', '2026-01-01') returning id::text$q$,
        '23514', 'Le compte 512200 est celui du rôle « banque » du plan comptable du dossier : un compte bancaire tient un compte qui n''est qu''à lui.'),
      (27, '27. le principal suit le rôle : sa jambe de banque au compte que le plan règle',
        $p$select regler_plan_du_dossier('{DA}', '[{"role": "banque", "compte": "512200"}]'::jsonb); {M1}$p$, 'chef',
        $q$select string_agg(compte_de_banque_du_mouvement(l.id), ' ') from lignes_bancaires l where l.dossier_id = '{DA}'$q$,
        'OK', '512200'),
      -- Qui lit, qui écrit.
      (28, '28. le client « Banque » lit les comptes de son dossier (MCB-Q8)', '{M1} {SEC}', 'client',
        $q$select count(*)::text from comptes_bancaires where dossier_id = '{DA}'$q$,
        'OK', '2'),
      (29, '29. sans la case « Banque », il n''en lit aucun',
        $p$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{DB}', '2025-06-10', 'ESSAI MCB1 DB', -1);$p$, 'client',
        $q$select count(*)::text from comptes_bancaires where dossier_id = '{DB}'$q$,
        'OK', '0'),
      (30, '30. le client « Banque » n''écrit pas un compte (42501)', '{M1}', 'client',
        $q$insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values ('{DA}', 'ESSAI', '512100', '2026-01-01') returning id::text$q$,
        '42501', 'new row violates row-level security policy for table "comptes_bancaires"'),
      (31, '31. ni ne le renomme : aucune ligne touchée', '{M1}', 'client',
        $q$with m as (update comptes_bancaires set libelle = 'ESSAI' where dossier_id = '{DA}' returning 1) select count(*)::text from m$q$,
        'OK', '0'),
      (32, '32. un compte sans accès ne crée pas le principal d''un dossier qu''il ne voit pas, et n''apprend rien de ses comptes (42501)',
        '{M1} {SEC}', 'inconnu',
        $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{DA}', '2026-02-01', 'ESSAI MCB1', -1) returning id::text$q$,
        '42501', 'new row violates row-level security policy for table "comptes_bancaires"'),
      (33, '33. un chef du cabinet qui n''est pas super-administrateur ouvre un compte aussi', '{M1}', 'chef_simple',
        $q$insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values ('{DA}', 'ESSAI MCB1 SECOND', '512100', '2026-01-01')
             returning compte$q$,
        'OK', '512100'),
      (34, '34. le propriétaire sans session (l''import d''un essai, la restauration d''un format 1 ou 2) : le principal aussi', null, 'proprietaire',
        $q$with m as (insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{DB}', '2025-06-10', 'ESSAI MCB1 DB', -1) returning compte_bancaire_id)
             select (m.compte_bancaire_id is not null)::text from m$q$,
        'OK', 'true'),
      (35, '35. un compte ne se clôt pas avant son ouverture (23514)', '{M1} {SEC}', 'chef',
        $q$update comptes_bancaires set ouvert_le = '2026-01-01', clos_le = '2025-12-31' where id = '{S}' returning id::text$q$,
        '23514', 'Un compte bancaire se clôt le jour de son ouverture ou après.'),
      (36, '36. le principal ne porte ni compte ni date à lui (23514)', null, 'chef',
        $q$insert into comptes_bancaires (dossier_id, libelle, principal, compte, compte_propre_depuis) values ('{DB}', 'ESSAI', true, '512100', '2026-01-01') returning id::text$q$,
        '23514', 'Le compte principal suit le compte de banque du plan du dossier : il ne porte ni compte ni date à lui.')
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null; v_pose := null; v_req := null;
      begin
        for v_f in select x.rang, x.texte from (values (1, e.pose), (2, e.requete)) as x(rang, texte) where x.texte is not null loop
          v_texte := replace(replace(replace(v_f.texte, '{M1}', m1), '{SEC}', sec), '{PDA}', principal_de_da);
          v_texte := replace(replace(replace(v_texte, '{DA}', da), '{DB}', db), '{S}', sec_id);
          if v_f.rang = 1 then
            v_pose := v_texte;
          else
            v_req := v_texte;
          end if;
        end loop;
        if v_pose is not null then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        begin
          if e.profil <> 'proprietaire' then
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims',
              json_build_object('sub', case when e.profil = 'inconnu' then inconnu
                                            when e.profil in ('client', 'chef_simple') then client else chef end,
                                'role', 'authenticated')::text, true);
          end if;
          execute v_req into v_obs;
          reset role;
          v_msg := coalesce(v_obs, '');
        exception when others then
          reset role;
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

    -- Le catalogue : la table, sa RLS et ses deux policies (le cabinet ; la lecture du client « Banque »), toutes deux aux
    -- connectés ; les deux colonnes NOT NULL et leurs clés ; les quatre fonctions de garde aux droits de
    -- l'appelant, leur chemin fixé, à personne ; la lecture de la jambe de banque aux connectés seuls ; les cinq
    -- déclencheurs sur leurs tables.
    verdicts := verdicts || jsonb_build_object('rang', 90, 'etape', '90. le catalogue : la table, ses policies, les colonnes et leurs clés, les fonctions et leurs déclencheurs',
      'ok', (select c.relrowsecurity from pg_class c where c.oid = 'public.comptes_bancaires'::regclass)
        and (select string_agg(p.polname::text || ':' || p.polcmd::text || ':' || array_to_string(p.polroles::regrole[], ',') || ':'
                               || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                               ' ' order by p.polname collate "C")
               from pg_policy p where p.polrelid = 'public.comptes_bancaires'::regclass and p.polname <> 'deux_facteurs')
            = 'comptes_bancaires_cabinet:*:authenticated:admin_du_dossier(dossier_id):admin_du_dossier(dossier_id) '
              || 'comptes_bancaires_lecture_banque:r:authenticated:client_du_dossier(dossier_id, ''banque''::text):'
        and (select string_agg(a.attrelid::regclass::text || ':' || a.attnotnull::text, ' ' order by a.attrelid::regclass::text collate "C")
               from pg_attribute a where a.attname = 'compte_bancaire_id' and not a.attisdropped
                and a.attrelid in ('public.lignes_bancaires'::regclass, 'public.controles_releves_bancaires'::regclass))
            = 'controles_releves_bancaires:true lignes_bancaires:true'
        and (select string_agg(c.conname::text || ':' || pg_get_constraintdef(c.oid), ' ' order by c.conname collate "C")
               from pg_constraint c where c.conname in ('lignes_bancaires_compte_bancaire', 'controles_releves_bancaires_compte_bancaire'))
            = 'controles_releves_bancaires_compte_bancaire:FOREIGN KEY (compte_bancaire_id) REFERENCES comptes_bancaires(id) '
              || 'lignes_bancaires_compte_bancaire:FOREIGN KEY (compte_bancaire_id) REFERENCES comptes_bancaires(id)'
        and (select string_agg(p.proname::text || ':' || p.prosecdef::int || ':' || array_to_string(p.proconfig, ',') || ':'
                               || has_function_privilege('anon', p.oid, 'execute')::int
                               || has_function_privilege('authenticated', p.oid, 'execute')::int, ' ' order by p.proname collate "C")
               from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('garder_comptes_bancaires', 'garder_compte_principal_present', 'poser_compte_bancaire',
                                  'garder_plan_hors_des_comptes_bancaires', 'compte_de_banque_du_mouvement'))
            = 'compte_de_banque_du_mouvement:0:search_path=public:01 garder_compte_principal_present:0:search_path=public:00 '
              || 'garder_comptes_bancaires:0:search_path=public:00 garder_plan_hors_des_comptes_bancaires:0:search_path=public:00 '
              || 'poser_compte_bancaire:0:search_path=public:00'
        and (select string_agg(t.tgrelid::regclass::text || ':' || t.tgname::text || ':' || t.tgfoid::regproc::text, ' ' order by t.tgname collate "C")
               from pg_trigger t
              where t.tgfoid in ('public.garder_comptes_bancaires()'::regprocedure, 'public.garder_compte_principal_present()'::regprocedure,
                                 'public.poser_compte_bancaire()'::regprocedure, 'public.garder_plan_hors_des_comptes_bancaires()'::regprocedure))
            = 'comptes_bancaires:comptes_bancaires_garde:garder_comptes_bancaires '
              || 'comptes_bancaires:comptes_bancaires_principal_present:garder_compte_principal_present '
              || 'controles_releves_bancaires:controles_releves_bancaires_compte_bancaire:poser_compte_bancaire '
              || 'lignes_bancaires:lignes_bancaires_compte_bancaire:poser_compte_bancaire '
              || 'plan_comptable_dossier:plan_comptable_dossier_hors_des_comptes_bancaires:garder_plan_hors_des_comptes_bancaires',
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni les accès, ni les comptes, ni les mouvements, ni les contrôles.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni les accès, ni les comptes, les mouvements, les contrôles',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, db::uuid))
      and not exists (select 1 from memberships where id in (acces_a::uuid, acces_b::uuid))
      and not exists (select 1 from comptes_bancaires where dossier_id in (da::uuid, db::uuid) or id = sec_id::uuid)
      and not exists (select 1 from lignes_bancaires where dossier_id in (da::uuid, db::uuid))
      and not exists (select 1 from controles_releves_bancaires where dossier_id in (da::uuid, db::uuid))
      and not exists (select 1 from cabinet_admins where user_id = client::uuid),
    'observe', 'relu');
  perform set_config('essai.comptes_bancaires', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.comptes_bancaires')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
