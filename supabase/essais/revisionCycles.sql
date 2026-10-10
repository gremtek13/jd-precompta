-- LES CYCLES DE LA RÉVISION, ÉPROUVÉS EN BASE — à rejouer par `execute_sql` après toute migration qui touche
-- `revision_conclusions`, `revision_notes`, `revision_revues`, leurs gardes ou leurs policies, `conclure_cycle`,
-- `noter_revision`, `revoir_cycle`, ou ce qu'elles lisent pour décider : l'accès (`admin_du_dossier`,
-- `est_chef_du_cabinet`) et les verrous de la validation et de la révision (ligne 41, étape R4 ; migration
-- `revision_des_cycles`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI LIT ET QUI ÉCRIT, sous six profils : une conclusion, une note et une revue EXISTENT dans le dossier du client,
--     et l'anonyme, un compte rattaché à rien et le client ne les voient pas, ne les modifient pas, n'en écrivent pas,
--     et n'appellent pas les fonctions ; le chef du cabinet les voit, ne les modifie pas, et, super-administrateur, en
--     insère (la restauration) ; un membre du cabinet AFFECTÉ à un dossier y conclut et y note, ne revoit pas, n'atteint
--     rien du dossier qui ne lui est pas confié (le membre NON AFFECTÉ), n'insère pas en direct ; un chef de cabinet qui
--     n'est pas super-administrateur revoit dans son cabinet, et revoit sa propre conclusion (hypothèse Q2, A30-1) ;
--   - LES REFUS DES TROIS FONCTIONS — `conclure_cycle` (dix), `noter_revision` (sept), `revoir_cycle` (neuf) —, chacun
--     jugé à son code ET à son message, et leur ORDRE, par paires de refus voisins qu'une même demande déclenche ensemble
--     : la première raison dite est celle que l'ordre fixe ;
--   - CE QUI S'ÉCRIT : l'auteur, l'état, le programme, la conclusion, les points à suivre ; la chaîne des conclusions
--     d'un cycle ; le journal ; la revue, une par conclusion, qui ne vise que la courante ;
--   - L'IMMUABILITÉ ET LA RESTAURATION : rien ne se modifie, même pour le propriétaire ; le super-administrateur
--     réinsère, jamais une conclusion qui en remplace une d'un autre cycle, d'un autre exercice ou d'un autre dossier,
--     ni une revue d'une conclusion d'un autre exercice ou d'un autre dossier ; chaque contrainte par son nom ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer ici : les déclencheurs, les policies et la RLS, les clés et
--     leur action à la suppression, la sécurité et les droits des fonctions, les index, ce que les fonctions rendent ;
--   - et que RIEN ne reste en base après l'essai.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE DU SCHÉMA (HISTORIQUE.md, entrée de l'étape R4) : une
-- suppression — d'une conclusion, d'une note ou d'une revue, refusée en direct ; la cascade d'un dossier qui les emporte
-- ensemble — et deux sessions concurrentes.
--
-- Le harnais est celui de `revisionSoldes.sql` : des dossiers JETABLES (préfixe `e55b4400`), dans le cabinet du dossier
-- `test` et dans un cabinet jetable, au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`)
-- ; chaque contrôle dans sa propre sous-transaction, annulée (`ANNULATION_ESSAI`, P0001), le verdict posé dans une
-- VARIABLE avant ; les étapes « fait » gardées jusqu'à l'annulation finale. Un refus se juge à son code ET à son message.
-- L'exercice en cours se lit à Paris (`{AN}`). Aucune instruction de suppression ; un caractère hors de l'ASCII se
-- fabrique en base (`chr`), pour ne jamais dépendre de la transcription. Hors de l'outil d'exécution, le fichier se joue
-- en UNE transaction (`psql -1`). `src/lib/revisionRevueEssai.test.ts` rejoue chacun de ses appels sur le module, qui doit
-- dire avant le clic le refus que la base a dit.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier_client uuid; cabinet uuid;
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text; attendu text;
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or cabinet is null or dossier_client = dossier_test
     or exists (select 1 from cabinet_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef)
     or extract(year from (now() at time zone 'Europe/Paris'))::integer < 2026 then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client, 'CHEF', chef, 'CLIENT', client,
      'AN', extract(year from (now() at time zone 'Europe/Paris'))::integer::text,
      'BLANCS', E' \t\n\r', 'NBSP', chr(160),
      'C8000', repeat('c', 8000), 'C8001', repeat('c', 8001), 'S4000', repeat('s', 4000), 'S4001', repeat('s', 4001),
      'N4000', repeat('n', 4000), 'N4001', repeat('n', 4001), 'O4000', repeat('o', 4000), 'O4001', repeat('o', 4001))
    || jsonb_build_object(
      'L500', repeat('l', 500), 'L501', repeat('l', 501), 'M2000', repeat('m', 2000), 'M2001', repeat('m', 2001),
      'CODE64', 'c' || repeat('x', 63), 'CODE65', 'c' || repeat('x', 64),
      'T100', (select jsonb_agg(jsonb_build_object('travail', 'T' || g, 'fait', false) order by g) from generate_series(1, 100) g)::text,
      'T101', (select jsonb_agg(jsonb_build_object('travail', 'T' || g, 'fait', false) order by g) from generate_series(1, 101) g)::text,
      'T101V', (select jsonb_agg(jsonb_build_object('travail', case when g = 1 then '' else 'T' || g end, 'fait', false) order by g)
                  from generate_series(1, 101) g)::text,
      'T101X', (select jsonb_agg(jsonb_build_object('travail', 'T' || g, 'fait', case when g = 1 then '"x"'::jsonb else 'false'::jsonb end) order by g)
                  from generate_series(1, 101) g)::text,
      'GROS', (select jsonb_agg(jsonb_build_object('travail', 'T' || g, 'fait', true, 'note', repeat('n', 2000)) order by g)
                 from generate_series(1, 40) g)::text,
      'TROPGROS', jsonb_build_array(repeat('x', 65536))::text,
      -- Trente-deux travaux, puis un trente-troisième dont la note complète le texte du programme à 65 536 octets tout
      -- juste (un élément ajouté coûte 44 octets et sa note) ; puis le même, un octet de plus.
      'P65536', (select j || jsonb_build_array(jsonb_build_object('travail', 'T', 'fait', true, 'note', repeat('n', 65536 - octet_length(j::text) - 44)))
                   from (select jsonb_agg(jsonb_build_object('travail', 'T', 'fait', true, 'note', repeat('n', 1980))) j from generate_series(1, 32)) b)::text,
      'P65537', (select j || jsonb_build_array(jsonb_build_object('travail', 'T', 'fait', true, 'note', repeat('n', 65537 - octet_length(j::text) - 44)))
                   from (select jsonb_agg(jsonb_build_object('travail', 'T', 'fait', true, 'note', repeat('n', 1980))) j from generate_series(1, 32)) b)::text)
    || jsonb_build_object(
      'A', 'e55b4400-0000-4000-8000-0000000000a1', 'ABSENT', 'e55b4400-0000-4000-8000-0000000000ff',
      'CJ', 'e55b4400-0000-4000-8000-0000000000c1', 'J1', 'e55b4400-0000-4000-8000-0000000000c3',
      'J2', 'e55b4400-0000-4000-8000-0000000000c4', 'RDC', 'e55b4400-0000-4000-8004-000000000001');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from revision_conclusions)), ((select count(*) from revision_notes)), ((select count(*) from revision_revues)),
    ((select count(*) from revision_justifications)), ((select count(*) from dossiers)), ((select count(*) from cabinets)),
    ((select count(*) from cabinet_admins)), ((select count(*) from dossier_assignations))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue} — les
  -- genres de `revisionSoldes.sql` : « jeu » (posé par le propriétaire, gardé), « controle » (joué sous « qui » puis
  -- annulé ; « OK » attend qu'il passe), « fait » (joué sous « qui » et gardé), « valeur » (une lecture qui doit rendre
  -- exactement la valeur attendue). « qui » : postgres, chef, client, collaborateur (le même compte que le client, une
  -- fois devenu membre du cabinet jetable, affecté à J1 et non à J2), chefj (le même compte, devenu le chef de ce cabinet,
  -- sans être super-administrateur : un compte n'appartient qu'à un cabinet), inconnu, anon.
  etapes := array[
    -- ══ Le jeu ══════════
    -- A : un dossier du cabinet du dossier `test`. J1 et J2 : un cabinet jetable, dont J1 seul sera confié au
    -- collaborateur, avant qu'il en devienne le chef.
    array['jeu', 'un dossier jetable', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values ('{A}', 'ESSAI CYCLES A', '{CAB}')$q$, '', ''],
    array['jeu', 'un cabinet jetable et ses deux dossiers', 'postgres', $q$insert into cabinets (id, nom) values ('{CJ}', 'ESSAI CYCLES CABINET J')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values ('{J1}', 'ESSAI CYCLES J1', '{CJ}'), ('{J2}', 'ESSAI CYCLES J2', '{CJ}')$q$, '', ''],
    array['jeu', 'une conclusion, une note et une revue dans le dossier du client, posées par le propriétaire', 'postgres', $q$insert into revision_conclusions (id, dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{RDC}', '{DC}', 2001, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI DC', '{CHEF}')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into revision_notes (dossier_id, annee, cycle, nature, texte, auteur) values ('{DC}', 2001, 'tresorerie', 'travail', 'ESSAI DC', '{CHEF}')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into revision_revues (dossier_id, annee, conclusion_id, avis, revu_par) values ('{DC}', 2001, '{RDC}', 'approuve', '{CHEF}')$q$, '', ''],

    -- ══ Qui lit, qui écrit ══════════
    array['controle', '1. l''anonyme ne lit ni conclusion, ni note, ni revue', 'anon', $q$do $x$ begin if exists (select 1 from revision_conclusions) or exists (select 1 from revision_notes) or exists (select 1 from revision_revues) then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '2. ni un compte rattaché à rien', 'inconnu', $q$do $x$ begin if exists (select 1 from revision_conclusions) or exists (select 1 from revision_notes) or exists (select 1 from revision_revues) then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '3. ni le client, sur son propre dossier', 'client', $q$do $x$ begin if exists (select 1 from revision_conclusions where dossier_id = '{DC}') or exists (select 1 from revision_notes where dossier_id = '{DC}') or exists (select 1 from revision_revues where dossier_id = '{DC}') then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '4. le chef du cabinet les lit', 'chef', $q$do $x$ begin if (select count(*) from revision_conclusions where dossier_id = '{DC}') <> 1 or (select count(*) from revision_notes where dossier_id = '{DC}') <> 1 or (select count(*) from revision_revues where dossier_id = '{DC}') <> 1 then raise exception 'PAS VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '5. l''anonyme n''appelle pas conclure_cycle', 'anon', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '42501', 'permission denied for function conclure_cycle'],
    array['controle', '6. ni noter_revision', 'anon', $q$select noter_revision('{A}', 2025, 'tresorerie', 'travail', 'ESSAI')$q$, '42501', 'permission denied for function noter_revision'],
    array['controle', '7. ni revoir_cycle', 'anon', $q$select revoir_cycle('{A}', 2025, '{ABSENT}', 'approuve', null)$q$, '42501', 'permission denied for function revoir_cycle'],
    array['controle', '8. conclure, refus 1 : un compte rattaché à rien', 'inconnu', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '9. conclure, refus 1 : le client, sur son propre dossier', 'client', $q$select conclure_cycle('{DC}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '10. conclure, refus 1 : un dossier qui n''existe pas se refuse comme un dossier interdit, même au super-administrateur', 'chef', $q$select conclure_cycle('{ABSENT}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '11. conclure, refus 1 avant 2 : l''accès d''abord', 'inconnu', $q$select conclure_cycle('{A}', 1999, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '12. noter, refus 1 : un compte rattaché à rien', 'inconnu', $q$select noter_revision('{A}', 2025, 'tresorerie', 'travail', 'ESSAI')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '13. noter, refus 1 : le client, sur son propre dossier', 'client', $q$select noter_revision('{DC}', 2025, 'tresorerie', 'travail', 'ESSAI')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '14. noter, refus 1 : un dossier qui n''existe pas, même au super-administrateur', 'chef', $q$select noter_revision('{ABSENT}', 2025, 'tresorerie', 'travail', 'ESSAI')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '14bis. noter, refus 1 avant 2', 'inconnu', $q$select noter_revision('{A}', 1999, 'tresorerie', 'travail', 'ESSAI')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '15. revoir, refus 1 : un compte rattaché à rien', 'inconnu', $q$select revoir_cycle('{A}', 2025, '{ABSENT}', 'approuve', null)$q$, '42501', 'Seul le chef du cabinet revoit un cycle.'],
    array['controle', '16. revoir, refus 1 : le client, sur son propre dossier', 'client', $q$select revoir_cycle('{DC}', 2001, '{RDC}', 'approuve', null)$q$, '42501', 'Seul le chef du cabinet revoit un cycle.'],
    array['controle', '17. revoir, refus 1 : un dossier qui n''existe pas, même au super-administrateur', 'chef', $q$select revoir_cycle('{ABSENT}', 2025, '{ABSENT}', 'approuve', null)$q$, '42501', 'Seul le chef du cabinet revoit un cycle.'],
    array['controle', '18. revoir, refus 1 avant 2', 'inconnu', $q$select revoir_cycle('{A}', 1999, '{ABSENT}', 'approuve', null)$q$, '42501', 'Seul le chef du cabinet revoit un cycle.'],
    array['controle', '19. le client n''écrit pas une conclusion en direct', 'client', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{DC}', 2002, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', '{CLIENT}')$q$, '42501', 'new row violates row-level security policy for table "revision_conclusions"'],
    array['controle', '20. ni une note', 'client', $q$insert into revision_notes (dossier_id, annee, cycle, nature, texte, auteur) values ('{DC}', 2002, 'tresorerie', 'travail', 'ESSAI', '{CLIENT}')$q$, '42501', 'new row violates row-level security policy for table "revision_notes"'],
    array['controle', '21. ni une revue : la garde ne lui montre pas la conclusion', 'client', $q$insert into revision_revues (dossier_id, annee, conclusion_id, avis, revu_par) values ('{DC}', 2001, '{RDC}', 'approuve', '{CLIENT}')$q$, '23514', 'Une revue porte sur une conclusion de son dossier, pour le même exercice.'],
    array['controle', '22. le client ne modifie rien', 'client', $q$do $x$ declare n integer; begin
      update revision_conclusions set conclusion = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count; if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
      update revision_notes set texte = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count; if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
      update revision_revues set observation = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count; if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
    end $x$$q$, 'OK', ''],
    array['controle', '23. le chef non plus : aucune policy ne le lui ouvre, aucune ligne touchée', 'chef', $q$do $x$ declare n integer; begin
      update revision_conclusions set conclusion = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count; if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
      update revision_notes set texte = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count; if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
      update revision_revues set observation = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count; if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
    end $x$$q$, 'OK', ''],
    array['controle', '24. ni le propriétaire de la base : la garde refuse de modifier une conclusion', 'postgres', $q$update revision_conclusions set conclusion = 'ESSAI MODIFIÉ' where id = '{RDC}'$q$, '23514', 'Une conclusion de la révision ne se modifie pas : elle se remplace par une autre, et l''historique reste.'],
    array['controle', '25. ni une note', 'postgres', $q$update revision_notes set texte = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'$q$, '23514', 'Une note du journal de la révision ne se modifie pas : une autre la suit, et le journal garde les deux.'],
    array['controle', '26. ni une revue', 'postgres', $q$update revision_revues set avis = 'a_reprendre', observation = 'ESSAI' where conclusion_id = '{RDC}'$q$, '23514', 'Une revue de la révision ne se modifie pas : revoir de nouveau suppose une nouvelle conclusion.'],
    array['controle', '27. ni par une écriture sans changement', 'postgres', $q$update revision_conclusions set conclusion = conclusion where id = '{RDC}'$q$, '23514', 'Une conclusion de la révision ne se modifie pas : elle se remplace par une autre, et l''historique reste.'],

    -- ══ Conclure : les refus 2 à 9, et leur ordre ══════════
    array['controle', '28. refus 2 : un exercice avant 2000', 'chef', $q$select conclure_cycle('{A}', 1999, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '29. refus 2 avant 3 : après 2100, un exercice qui n''est pas non plus terminé', 'chef', $q$select conclure_cycle('{A}', 2101, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '30. refus 2 : sans exercice', 'chef', $q$select conclure_cycle('{A}', null, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '31. refus 3 : l''exercice en cours, lu à Paris', 'chef', $q$select conclure_cycle('{A}', {AN}, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'L''exercice {AN} n''est pas terminé : sa révision s''ouvre une fois clos.'],
    array['controle', '32. refus 3 avant 5 : un cycle inconnu dans l''exercice en cours', 'chef', $q$select conclure_cycle('{A}', {AN}, 'caisse', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'L''exercice {AN} n''est pas terminé : sa révision s''ouvre une fois clos.'],
    array['controle', '33. refus 5 : un cycle inconnu', 'chef', $q$select conclure_cycle('{A}', 2025, 'caisse', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le cycle annoncé n''est pas un cycle de la révision.'],
    array['controle', '34. refus 5 : sans cycle', 'chef', $q$select conclure_cycle('{A}', 2025, null, 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le cycle annoncé n''est pas un cycle de la révision.'],
    array['controle', '35. refus 5 : la casse compte', 'chef', $q$select conclure_cycle('{A}', 2025, 'Tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le cycle annoncé n''est pas un cycle de la révision.'],
    array['controle', '36. refus 5 : un blanc aussi', 'chef', $q$select conclure_cycle('{A}', 2025, ' tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le cycle annoncé n''est pas un cycle de la révision.'],
    array['controle', '37. refus 5 avant 6 : un cycle et un état inconnus', 'chef', $q$select conclure_cycle('{A}', 2025, 'caisse', 'valide', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le cycle annoncé n''est pas un cycle de la révision.'],
    array['controle', '38. refus 6 : un état inconnu', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'valide', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Une conclusion dit un cycle révisé, ou en anomalie.'],
    array['controle', '39. refus 6 : sans état', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', null, '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Une conclusion dit un cycle révisé, ou en anomalie.'],
    array['controle', '40. refus 6 : la casse compte', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'Revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Une conclusion dit un cycle révisé, ou en anomalie.'],
    array['controle', '41. refus 6 avant 7 : sans état ni conclusion', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', null, '[]'::jsonb, null, null, null)$q$, '22023', 'Une conclusion dit un cycle révisé, ou en anomalie.'],
    array['controle', '42. refus 7 : sans conclusion', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, null, null, null)$q$, '22023', 'Une conclusion se rédige : elle ne peut pas être vide.'],
    array['controle', '43. refus 7 : une conclusion de blancs', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, '{BLANCS}', null, null)$q$, '22023', 'Une conclusion se rédige : elle ne peut pas être vide.'],
    array['controle', '44. refus 7 : 8 001 caractères', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, '{C8001}', null, null)$q$, '22023', 'Une conclusion tient en 8 000 caractères au plus.'],
    array['controle', '45. 8 000 caractères passent', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, '{C8000}', null, null)$q$, 'OK', ''],
    array['controle', '46. une espace insécable seule est un texte', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, '{NBSP}', null, null)$q$, 'OK', ''],
    array['controle', '47. refus 7 avant 8 : une conclusion vide et des points à suivre de blancs', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, '', '{BLANCS}', null)$q$, '22023', 'Une conclusion se rédige : elle ne peut pas être vide.'],
    array['controle', '48. refus 8 : des points à suivre de blancs', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', '{BLANCS}', null)$q$, '22023', 'Les points à suivre ne se composent pas que de blancs : les laisser vides.'],
    array['controle', '49. refus 8 : 4 001 caractères', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', '{S4001}', null)$q$, '22023', 'Les points à suivre tiennent en 4 000 caractères au plus.'],
    array['controle', '50. 4 000 caractères passent', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', '{S4000}', null)$q$, 'OK', ''],
    array['controle', '51. refus 8 avant 9 : des points à suivre de blancs et un programme illisible', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '{}'::jsonb, 'ESSAI', '{BLANCS}', null)$q$, '22023', 'Les points à suivre ne se composent pas que de blancs : les laisser vides.'],

    -- ══ Conclure : le programme (refus 9) ══════════
    array['controle', '52. refus 9 : un objet n''est pas une liste', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '{}'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '53. refus 9 : un texte non plus', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '"ESSAI"'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '54. refus 9 : un travail qui n''est pas un objet', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[1]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '55. refus 9 : une clé inconnue', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"T","fait":true,"autre":1}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '56. refus 9 : sans libellé', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '57. refus 9 : un libellé qui n''est pas un texte', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":1,"fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '58. refus 9 : sans « fait »', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"T"}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '59. refus 9 : « fait » en texte', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"T","fait":"true"}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '60. refus 9 : « fait » nul', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"T","fait":null}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '61. refus 9 : une note qui n''est pas un texte', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"T","fait":true,"note":1}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '62. refus 9 : un code qui n''est pas un texte', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"code":1,"travail":"T","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '62bis. refus 9 : un code booléen, que le motif seul laisserait passer', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"code":true,"travail":"T","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '63. refus 9 : un code mal formé', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"code":"Tresorerie-releve","travail":"T","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '64. refus 9 : un code vide', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"code":"","travail":"T","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '65. refus 9 : un code de 65 caractères', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"code":"{CODE65}","travail":"T","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '66. un code de 64 caractères passe', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"code":"{CODE64}","travail":"T","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, 'OK', ''],
    array['controle', '67. le JSON null vaut un programme vide', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', 'null'::jsonb, 'ESSAI', null, null)$q$, 'OK', ''],
    array['controle', '68. l''absence aussi', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', null, 'ESSAI', null, null)$q$, 'OK', ''],
    array['controle', '69. une note et un code nuls passent', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"code":null,"travail":"T","fait":false,"note":null}]'::jsonb, 'ESSAI', null, null)$q$, 'OK', ''],
    array['controle', '70. refus 9 : cent un travaux', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '{T101}'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail tient en cent travaux et 64 Kio au plus.'],
    array['controle', '71. cent passent', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '{T100}'::jsonb, 'ESSAI', null, null)$q$, 'OK', ''],
    array['valeur', '71bis. le programme se mesure comme la base le mesure : 64 Kio tout juste, puis un octet de plus', 'postgres', $q$select octet_length('{P65536}'::jsonb::text) || '/' || octet_length('{P65537}'::jsonb::text) || '/' || jsonb_array_length('{P65536}'::jsonb)$q$, '', '65536/65537/33'],
    array['controle', '71ter. 64 Kio tout juste passent', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '{P65536}'::jsonb, 'ESSAI', null, null)$q$, 'OK', ''],
    array['controle', '71quater. refus 9 : un octet de plus', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '{P65537}'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail tient en cent travaux et 64 Kio au plus.'],
    array['controle', '72. refus 9 : plus de 64 Kio', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '{GROS}'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail tient en cent travaux et 64 Kio au plus.'],
    array['controle', '73. refus 9 : un libellé vide', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Un travail du programme se décrit : son libellé ne peut pas être vide.'],
    array['controle', '74. refus 9 : un libellé de blancs', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":" \t\n\r","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Un travail du programme se décrit : son libellé ne peut pas être vide.'],
    array['controle', '75. refus 9 : un libellé de 501 caractères', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"{L501}","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Un travail du programme tient en 500 caractères au plus.'],
    array['controle', '76. 500 passent', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"{L500}","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, 'OK', ''],
    array['controle', '77. refus 9 : une note de blancs', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"T","fait":true,"note":"  "}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'La note d''un travail ne se compose pas que de blancs : la laisser vide.'],
    array['controle', '78. refus 9 : une note de 2 001 caractères', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"T","fait":true,"note":"{M2001}"}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'La note d''un travail tient en 2 000 caractères au plus.'],
    array['controle', '79. 2 000 passent', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"T","fait":true,"note":"{M2000}"}]'::jsonb, 'ESSAI', null, null)$q$, 'OK', ''],
    array['controle', '80. refus 9 : le même travail proposé cité deux fois', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"code":"tresorerie-releves","travail":"T","fait":true},{"code":"tresorerie-releves","travail":"U","fait":false}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme cite deux fois le même travail proposé.'],
    array['controle', '81. deux travaux ajoutés au même libellé passent', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"T","fait":true},{"travail":"T","fait":false}]'::jsonb, 'ESSAI', null, null)$q$, 'OK', ''],
    array['controle', '82. refus 9 : illisible avant vide — un libellé vide et « fait » en texte', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"","fait":"x"}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '83. refus 9 : le nombre avant le libellé', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '{T101V}'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail tient en cent travaux et 64 Kio au plus.'],
    array['controle', '83bis. refus 9 : illisible avant le nombre', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '{T101X}'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['controle', '84. refus 9 : le libellé vide avant le libellé trop long', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"{L501}","fait":true},{"travail":"","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Un travail du programme se décrit : son libellé ne peut pas être vide.'],
    array['controle', '85. refus 9 : le libellé trop long avant la note de blancs', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"T","fait":true,"note":" "},{"travail":"{L501}","fait":true}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Un travail du programme tient en 500 caractères au plus.'],
    array['controle', '86. refus 9 : la note de blancs avant la note trop longue', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"travail":"T","fait":true,"note":"{M2001}"},{"travail":"U","fait":true,"note":" "}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'La note d''un travail ne se compose pas que de blancs : la laisser vide.'],
    array['controle', '87. refus 9 : la note trop longue avant le doublon', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"code":"tva-soldes","travail":"T","fait":true},{"code":"tva-soldes","travail":"U","fait":true,"note":"{M2001}"}]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'La note d''un travail tient en 2 000 caractères au plus.'],

    -- ══ Conclure : la chaîne (refus 10) ══════════
    array['fait', '88. le chef conclut la trésorerie de 2025', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[{"code":"tresorerie-releves","travail":"Les relevés","fait":true,"note":"ESSAI NOTE"},{"travail":"Un travail ajouté","fait":false}]'::jsonb, 'ESSAI A1', 'ESSAI À SUIVRE', null)$q$, 'OK', ''],
    array['valeur', '89. écrite telle quelle, sous son nom', 'postgres', $q$select etat || '/' || cycle || '/' || annee || '/' || (auteur = '{CHEF}') || '/' || jsonb_array_length(travaux) || '/' || (travaux -> 0 ->> 'note') || '/' || coalesce(a_suivre, '∅') || '/' || (remplace_id is null) || '/' || (cree_le is not null) from revision_conclusions where conclusion = 'ESSAI A1'$q$, '',
      'revise/tresorerie/2025/true/2/ESSAI NOTE/ESSAI À SUIVRE/true/true'],
    array['controle', '90. refus 10 : une seconde première conclusion', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Une autre conclusion a été prise sur ce cycle depuis : relire avant de conclure.'],
    array['fait', '91. une conclusion des recettes, même exercice : un autre cycle, une autre chaîne', 'chef', $q$select conclure_cycle('{A}', 2025, 'recettes', 'revise', '[]'::jsonb, 'ESSAI A-REC', null, null)$q$, 'OK', ''],
    array['fait', '92. une conclusion de la trésorerie en 2024 : un autre exercice, une autre chaîne', 'chef', $q$select conclure_cycle('{A}', 2024, 'tresorerie', 'anomalie', '[]'::jsonb, 'ESSAI A-2024', 'ESSAI À REPRENDRE EN 2025', null)$q$, 'OK', ''],
    array['controle', '93. refus 10 : remplacer la conclusion d''un autre cycle', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, (select id from revision_conclusions where conclusion = 'ESSAI A-REC'))$q$, '22023', 'La conclusion à remplacer n''est pas une conclusion de ce cycle pour l''exercice 2025.'],
    array['controle', '94. refus 10 : d''un autre exercice', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, (select id from revision_conclusions where conclusion = 'ESSAI A-2024'))$q$, '22023', 'La conclusion à remplacer n''est pas une conclusion de ce cycle pour l''exercice 2025.'],
    array['controle', '95. refus 10 : d''un autre dossier', 'chef', $q$select conclure_cycle('{A}', 2001, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, '{RDC}')$q$, '22023', 'La conclusion à remplacer n''est pas une conclusion de ce cycle pour l''exercice 2001.'],
    array['controle', '96. refus 10 : qui n''existe pas', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, '{ABSENT}')$q$, '22023', 'La conclusion à remplacer n''est pas une conclusion de ce cycle pour l''exercice 2025.'],
    array['controle', '97. refus 10 : remplacer, dans un exercice où le cycle n''a aucune conclusion', 'chef', $q$select conclure_cycle('{A}', 2023, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, (select id from revision_conclusions where conclusion = 'ESSAI A-2024'))$q$, '22023', 'La conclusion à remplacer n''est pas une conclusion de ce cycle pour l''exercice 2023.'],
    array['fait', '98. la remplacer', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'anomalie', '[]'::jsonb, 'ESSAI A2', null, (select id from revision_conclusions where conclusion = 'ESSAI A1'))$q$, 'OK', ''],
    array['controle', '99. refus 10 : remplacer une conclusion qui n''est plus la courante', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, (select id from revision_conclusions where conclusion = 'ESSAI A1'))$q$, '22023', 'Une autre conclusion a été prise sur ce cycle depuis : relire avant de conclure.'],
    array['controle', '100. refus 10 : ne rien remplacer quand le cycle a une conclusion', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '22023', 'Une autre conclusion a été prise sur ce cycle depuis : relire avant de conclure.'],
    array['controle', '101. refus 9 avant 10 : un programme illisible et un remplacement périmé', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '{}'::jsonb, 'ESSAI', null, (select id from revision_conclusions where conclusion = 'ESSAI A1'))$q$, '22023', 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'],
    array['fait', '102. remplacer la courante encore : une chaîne de trois', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI A3', null, (select id from revision_conclusions where conclusion = 'ESSAI A2'))$q$, 'OK', ''],
    array['valeur', '103. la chaîne : chaque conclusion remplace la précédente, sous son état, une seule n''a pas de suite', 'postgres', $q$select string_agg(c.conclusion || ':' || c.etat || '>' || coalesce((select p.conclusion from revision_conclusions p where p.id = c.remplace_id), '∅'), ',' order by c.conclusion collate "C") || '/' || count(*) filter (where not exists (select 1 from revision_conclusions s where s.remplace_id = c.id)) from revision_conclusions c where c.dossier_id = '{A}' and c.annee = 2025 and c.cycle = 'tresorerie'$q$, '',
      'ESSAI A1:revise>∅,ESSAI A2:anomalie>ESSAI A1,ESSAI A3:revise>ESSAI A2/1'],
    array['controle', '104. la conclusion rendue est celle qui s''écrit', 'chef', $q$do $x$ declare r revision_conclusions; begin
      r := conclure_cycle('{A}', 2025, 'social', 'revise', '[{"code":"social-avis","travail":"Les avis","fait":true}]'::jsonb, 'ESSAI RENDUE', 'ESSAI SUIVRE', null);
      if r.id is null or r.dossier_id <> '{A}' or r.annee <> 2025 or r.cycle <> 'social' or r.etat <> 'revise' or r.conclusion <> 'ESSAI RENDUE'
         or r.a_suivre <> 'ESSAI SUIVRE' or r.travaux <> '[{"code":"social-avis","travail":"Les avis","fait":true}]'::jsonb
         or r.remplace_id is not null or r.auteur <> '{CHEF}' or r.cree_le is null
         or not exists (select 1 from revision_conclusions c where c.id = r.id and c.conclusion = 'ESSAI RENDUE') then
        raise exception 'MAUVAIS RETOUR';
      end if; end $x$$q$, 'OK', ''],

    -- ══ Noter dans le journal ══════════
    array['controle', '105. noter, refus 2 : un exercice avant 2000', 'chef', $q$select noter_revision('{A}', 1999, 'tresorerie', 'travail', 'ESSAI')$q$, '22023', 'Exercice invalide.'],
    array['controle', '106. noter, refus 2 : sans exercice', 'chef', $q$select noter_revision('{A}', null, 'tresorerie', 'travail', 'ESSAI')$q$, '22023', 'Exercice invalide.'],
    array['controle', '106bis. noter, refus 2 avant 3 : après 2100', 'chef', $q$select noter_revision('{A}', 2101, 'tresorerie', 'travail', 'ESSAI')$q$, '22023', 'Exercice invalide.'],
    array['controle', '107. noter, refus 3 : l''exercice en cours', 'chef', $q$select noter_revision('{A}', {AN}, 'tresorerie', 'travail', 'ESSAI')$q$, '22023', 'L''exercice {AN} n''est pas terminé : sa révision s''ouvre une fois clos.'],
    array['controle', '108. noter, refus 3 avant 5', 'chef', $q$select noter_revision('{A}', {AN}, 'caisse', 'travail', 'ESSAI')$q$, '22023', 'L''exercice {AN} n''est pas terminé : sa révision s''ouvre une fois clos.'],
    array['controle', '109. noter, refus 5 : un cycle inconnu', 'chef', $q$select noter_revision('{A}', 2025, 'caisse', 'travail', 'ESSAI')$q$, '22023', 'Le cycle annoncé n''est pas un cycle de la révision.'],
    array['controle', '109bis. noter, refus 5 : sans cycle', 'chef', $q$select noter_revision('{A}', 2025, null, 'travail', 'ESSAI')$q$, '22023', 'Le cycle annoncé n''est pas un cycle de la révision.'],
    array['controle', '110. noter, refus 5 avant 6 : un cycle et une nature inconnus', 'chef', $q$select noter_revision('{A}', 2025, 'caisse', 'appel', 'ESSAI')$q$, '22023', 'Le cycle annoncé n''est pas un cycle de la révision.'],
    array['controle', '111. noter, refus 6 : une nature inconnue', 'chef', $q$select noter_revision('{A}', 2025, 'tresorerie', 'appel', 'ESSAI')$q$, '22023', 'Une note du journal est un échange avec la direction, une consultation ou un travail.'],
    array['controle', '112. noter, refus 6 : sans nature', 'chef', $q$select noter_revision('{A}', 2025, 'tresorerie', null, 'ESSAI')$q$, '22023', 'Une note du journal est un échange avec la direction, une consultation ou un travail.'],
    array['controle', '113. noter, refus 6 : la casse compte', 'chef', $q$select noter_revision('{A}', 2025, 'tresorerie', 'Travail', 'ESSAI')$q$, '22023', 'Une note du journal est un échange avec la direction, une consultation ou un travail.'],
    array['controle', '114. noter, refus 6 avant 7 : sans nature ni texte', 'chef', $q$select noter_revision('{A}', 2025, 'tresorerie', null, null)$q$, '22023', 'Une note du journal est un échange avec la direction, une consultation ou un travail.'],
    array['controle', '115. noter, refus 7 : sans texte', 'chef', $q$select noter_revision('{A}', 2025, 'tresorerie', 'travail', null)$q$, '22023', 'Une note se rédige : elle ne peut pas être vide.'],
    array['controle', '116. noter, refus 7 : un texte de blancs', 'chef', $q$select noter_revision('{A}', 2025, 'tresorerie', 'travail', '{BLANCS}')$q$, '22023', 'Une note se rédige : elle ne peut pas être vide.'],
    array['controle', '117. noter, refus 7 : 4 001 caractères', 'chef', $q$select noter_revision('{A}', 2025, 'tresorerie', 'travail', '{N4001}')$q$, '22023', 'Une note tient en 4 000 caractères au plus.'],
    array['controle', '118. 4 000 passent', 'chef', $q$select noter_revision('{A}', 2025, 'tresorerie', 'travail', '{N4000}')$q$, 'OK', ''],
    array['fait', '119. un échange avec la direction', 'chef', $q$select noter_revision('{A}', 2025, 'tresorerie', 'echange_direction', 'ESSAI N1')$q$, 'OK', ''],
    array['fait', '120. une consultation', 'chef', $q$select noter_revision('{A}', 2025, 'tresorerie', 'consultation', 'ESSAI N2')$q$, 'OK', ''],
    array['fait', '121. un travail, au cycle « ensemble »', 'chef', $q$select noter_revision('{A}', 2025, 'ensemble', 'travail', 'ESSAI N3')$q$, 'OK', ''],
    array['valeur', '122. le journal, sous le nom de son auteur', 'postgres', $q$select string_agg(texte || ':' || nature || ':' || cycle || ':' || annee || ':' || (auteur = '{CHEF}'), ',' order by texte collate "C") from revision_notes where dossier_id = '{A}'$q$, '',
      'ESSAI N1:echange_direction:tresorerie:2025:true,ESSAI N2:consultation:tresorerie:2025:true,ESSAI N3:travail:ensemble:2025:true'],
    array['controle', '123. la note rendue est celle qui s''écrit', 'chef', $q$do $x$ declare r revision_notes; begin
      r := noter_revision('{A}', 2025, 'emprunts', 'consultation', 'ESSAI RENDUE');
      if r.id is null or r.dossier_id <> '{A}' or r.annee <> 2025 or r.cycle <> 'emprunts' or r.nature <> 'consultation' or r.texte <> 'ESSAI RENDUE'
         or r.auteur <> '{CHEF}' or r.cree_le is null or not exists (select 1 from revision_notes n where n.id = r.id) then
        raise exception 'MAUVAIS RETOUR';
      end if; end $x$$q$, 'OK', ''],

    -- ══ Revoir ══════════
    array['controle', '124. revoir, refus 2 : un exercice avant 2000', 'chef', $q$select revoir_cycle('{A}', 1999, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'approuve', null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '125. revoir, refus 2 : sans exercice', 'chef', $q$select revoir_cycle('{A}', null, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'approuve', null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '125bis. revoir, refus 2 avant 3 : après 2100', 'chef', $q$select revoir_cycle('{A}', 2101, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'approuve', null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '126. revoir, refus 3 : l''exercice en cours', 'chef', $q$select revoir_cycle('{A}', {AN}, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'approuve', null)$q$, '22023', 'L''exercice {AN} n''est pas terminé : sa révision s''ouvre une fois clos.'],
    array['controle', '127. revoir, refus 3 avant 5', 'chef', $q$select revoir_cycle('{A}', {AN}, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'valide', null)$q$, '22023', 'L''exercice {AN} n''est pas terminé : sa révision s''ouvre une fois clos.'],
    array['controle', '128. revoir, refus 5 : un avis inconnu', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'valide', null)$q$, '22023', 'Une revue approuve le cycle, ou le renvoie à reprendre.'],
    array['controle', '129. revoir, refus 5 : sans avis', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), null, null)$q$, '22023', 'Une revue approuve le cycle, ou le renvoie à reprendre.'],
    array['controle', '130. revoir, refus 5 : la casse compte', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'Approuve', null)$q$, '22023', 'Une revue approuve le cycle, ou le renvoie à reprendre.'],
    array['controle', '131. revoir, refus 5 avant 6 : sans avis, une observation de blancs', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), null, '{BLANCS}')$q$, '22023', 'Une revue approuve le cycle, ou le renvoie à reprendre.'],
    array['controle', '132. revoir, refus 6 : à reprendre sans observation', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'a_reprendre', null)$q$, '22023', 'Un cycle renvoyé à reprendre se motive.'],
    array['controle', '133. revoir, refus 6 : à reprendre, une observation vide', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'a_reprendre', '')$q$, '22023', 'Un cycle renvoyé à reprendre se motive.'],
    array['controle', '134. revoir, refus 6 : à reprendre, une observation de blancs', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'a_reprendre', '{BLANCS}')$q$, '22023', 'Un cycle renvoyé à reprendre se motive.'],
    array['controle', '135. revoir, refus 6 : approuvé, une observation de blancs', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'approuve', '{BLANCS}')$q$, '22023', 'Une observation ne se compose pas que de blancs : la laisser vide.'],
    array['controle', '136. revoir, refus 6 : 4 001 caractères', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'a_reprendre', '{O4001}')$q$, '22023', 'Une observation tient en 4 000 caractères au plus.'],
    array['controle', '137. 4 000 passent', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'a_reprendre', '{O4000}')$q$, 'OK', ''],
    array['controle', '138. revoir, refus 6 avant 7 : à reprendre sans observation, une conclusion qui n''existe pas', 'chef', $q$select revoir_cycle('{A}', 2025, '{ABSENT}', 'a_reprendre', null)$q$, '22023', 'Un cycle renvoyé à reprendre se motive.'],
    array['controle', '139. revoir, refus 7 : sans conclusion', 'chef', $q$select revoir_cycle('{A}', 2025, null, 'approuve', null)$q$, '22023', 'La conclusion à revoir n''est pas une conclusion de l''exercice 2025 dans ce dossier.'],
    array['controle', '140. revoir, refus 7 : une conclusion qui n''existe pas', 'chef', $q$select revoir_cycle('{A}', 2025, '{ABSENT}', 'approuve', null)$q$, '22023', 'La conclusion à revoir n''est pas une conclusion de l''exercice 2025 dans ce dossier.'],
    array['controle', '141. revoir, refus 7 : une conclusion d''un autre exercice', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A-2024'), 'approuve', null)$q$, '22023', 'La conclusion à revoir n''est pas une conclusion de l''exercice 2025 dans ce dossier.'],
    array['controle', '142. revoir, refus 7 : une conclusion d''un autre dossier', 'chef', $q$select revoir_cycle('{A}', 2001, '{RDC}', 'approuve', null)$q$, '22023', 'La conclusion à revoir n''est pas une conclusion de l''exercice 2001 dans ce dossier.'],
    array['controle', '143. revoir, refus 7 avant 8 : une conclusion remplacée, sous un autre exercice', 'chef', $q$select revoir_cycle('{A}', 2024, (select id from revision_conclusions where conclusion = 'ESSAI A1'), 'approuve', null)$q$, '22023', 'La conclusion à revoir n''est pas une conclusion de l''exercice 2024 dans ce dossier.'],
    array['controle', '144. revoir, refus 8 : une conclusion remplacée', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A1'), 'approuve', null)$q$, '22023', 'Une autre conclusion a été prise sur ce cycle depuis : relire avant de revoir.'],
    array['controle', '145. revoir, refus 8 : celle qui la remplaçait, remplacée à son tour', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A2'), 'approuve', null)$q$, '22023', 'Une autre conclusion a été prise sur ce cycle depuis : relire avant de revoir.'],
    array['fait', '146. le chef approuve la conclusion courante', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'approuve', null)$q$, 'OK', ''],
    array['controle', '147. revoir, refus 9 : une conclusion déjà revue', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'a_reprendre', 'ESSAI')$q$, '22023', 'Cette conclusion a déjà été revue : revoir de nouveau suppose une nouvelle conclusion.'],
    array['fait', '148. une nouvelle conclusion remplace la conclusion revue', 'chef', $q$select conclure_cycle('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI A4', null, (select id from revision_conclusions where conclusion = 'ESSAI A3'))$q$, 'OK', ''],
    array['controle', '149. revoir, refus 8 avant 9 : la conclusion revue, remplacée depuis', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'approuve', null)$q$, '22023', 'Une autre conclusion a été prise sur ce cycle depuis : relire avant de revoir.'],
    array['fait', '150. le chef la renvoie à reprendre, motivé', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A4'), 'a_reprendre', 'ESSAI À REPRENDRE')$q$, 'OK', ''],
    array['fait', '151. et approuve les recettes avec une observation', 'chef', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A-REC'), 'approuve', 'ESSAI OBSERVATION')$q$, 'OK', ''],
    array['valeur', '152. les revues, une par conclusion, sous le nom de qui revoit', 'postgres', $q$select string_agg(c.conclusion || ':' || r.avis || ':' || coalesce(r.observation, '∅') || ':' || r.annee || ':' || (r.revu_par = '{CHEF}') || ':' || (r.revu_le is not null), ',' order by c.conclusion collate "C") from revision_revues r join revision_conclusions c on c.id = r.conclusion_id where r.dossier_id = '{A}'$q$, '',
      'ESSAI A-REC:approuve:ESSAI OBSERVATION:2025:true:true,ESSAI A3:approuve:∅:2025:true:true,ESSAI A4:a_reprendre:ESSAI À REPRENDRE:2025:true:true'],
    array['controle', '153. la revue rendue est celle qui s''écrit', 'chef', $q$do $x$ declare r revision_revues; c uuid; begin
      select id into c from revision_conclusions where conclusion = 'ESSAI A-2024';
      r := revoir_cycle('{A}', 2024, c, 'a_reprendre', 'ESSAI RENDUE');
      if r.id is null or r.dossier_id <> '{A}' or r.annee <> 2024 or r.conclusion_id <> c or r.avis <> 'a_reprendre' or r.observation <> 'ESSAI RENDUE'
         or r.revu_par <> '{CHEF}' or r.revu_le is null or not exists (select 1 from revision_revues v where v.id = r.id) then
        raise exception 'MAUVAIS RETOUR';
      end if; end $x$$q$, 'OK', ''],

    -- ══ Un membre du cabinet, affecté ou non ══════════
    array['jeu', 'le client devient membre du cabinet J, affecté à J1 seulement, sans être super-administrateur', 'postgres', $q$insert into cabinet_admins (user_id, cabinet_id, role) values ('{CLIENT}', '{CJ}', 'comptable')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into dossier_assignations (dossier_id, user_id) values ('{J1}', '{CLIENT}')$q$, '', ''],
    array['fait', '154. le collaborateur affecté conclut un cycle de J1', 'collaborateur', $q$select conclure_cycle('{J1}', 2025, 'depenses', 'revise', '[]'::jsonb, 'ESSAI J1', null, null)$q$, 'OK', ''],
    array['fait', '155. et note dans son journal', 'collaborateur', $q$select noter_revision('{J1}', 2025, 'depenses', 'travail', 'ESSAI J1')$q$, 'OK', ''],
    array['valeur', '156. sous son nom', 'postgres', $q$select (select (auteur = '{CLIENT}')::text from revision_conclusions where dossier_id = '{J1}') || '/' || (select (auteur = '{CLIENT}')::text from revision_notes where dossier_id = '{J1}')$q$, '', 'true/true'],
    array['controle', '157. pas dans J2, qui ne lui est pas confié : conclure', 'collaborateur', $q$select conclure_cycle('{J2}', 2025, 'depenses', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '158. ni noter', 'collaborateur', $q$select noter_revision('{J2}', 2025, 'depenses', 'travail', 'ESSAI')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '159. ni dans A', 'collaborateur', $q$select conclure_cycle('{A}', 2025, 'stocks', 'revise', '[]'::jsonb, 'ESSAI', null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '160. il ne revoit pas J1, qu''il prépare', 'collaborateur', $q$select revoir_cycle('{J1}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI J1'), 'approuve', null)$q$, '42501', 'Seul le chef du cabinet revoit un cycle.'],
    array['controle', '161. ni J2', 'collaborateur', $q$select revoir_cycle('{J2}', 2025, '{ABSENT}', 'approuve', null)$q$, '42501', 'Seul le chef du cabinet revoit un cycle.'],
    array['controle', '162. il n''écrit pas en direct, même dans J1', 'collaborateur', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{J1}', 2025, 'tva', 'revise', '[]'::jsonb, 'ESSAI', '{CLIENT}')$q$, '42501', 'new row violates row-level security policy for table "revision_conclusions"'],
    array['controle', '163. il lit la révision de J1, rien ailleurs', 'collaborateur', $q$do $x$ begin
      if (select count(*) from revision_conclusions where dossier_id = '{J1}') <> 1 or (select count(*) from revision_notes where dossier_id = '{J1}') <> 1 then raise exception 'PAS VU'; end if;
      if exists (select 1 from revision_conclusions where dossier_id <> '{J1}') or exists (select 1 from revision_notes where dossier_id <> '{J1}') or exists (select 1 from revision_revues) then raise exception 'VU AILLEURS'; end if;
    end $x$$q$, 'OK', ''],
    array['jeu', 'le même compte devient le chef du cabinet jetable, sans être super-administrateur', 'postgres', $q$update cabinet_admins set role = 'comptable_en_chef' where user_id = '{CLIENT}' and cabinet_id = '{CJ}'$q$, '', ''],
    array['fait', '164. le chef du cabinet conclut dans J2, qui ne lui est pas affecté : un chef voit tout son cabinet', 'chefj', $q$select conclure_cycle('{J2}', 2025, 'ensemble', 'revise', '[]'::jsonb, 'ESSAI J2', null, null)$q$, 'OK', ''],
    array['fait', '165. et revoit sa propre conclusion de J1, préparée comme membre (hypothèse Q2, A30-1)', 'chefj', $q$select revoir_cycle('{J1}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI J1'), 'approuve', null)$q$, 'OK', ''],
    array['valeur', '166. la trace le dit : la même personne a conclu et revu', 'postgres', $q$select (c.auteur = r.revu_par)::text || '/' || (r.revu_par = '{CLIENT}')::text from revision_conclusions c join revision_revues r on r.conclusion_id = c.id where c.dossier_id = '{J1}'$q$, '', 'true/true'],
    array['controle', '167. il revoit J2 aussi', 'chefj', $q$select revoir_cycle('{J2}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI J2'), 'a_reprendre', 'ESSAI')$q$, 'OK', ''],
    array['controle', '168. mais pas A, d''un autre cabinet', 'chefj', $q$select revoir_cycle('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A4'), 'approuve', null)$q$, '42501', 'Seul le chef du cabinet revoit un cycle.'],

    -- ══ La restauration, et ce que les gardes et les contraintes refusent ══════════
    array['controle', '169. le super-administrateur réinsère une conclusion', 'chef', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{A}', 2023, 'social', 'revise', '[]'::jsonb, 'ESSAI', '{CHEF}')$q$, 'OK', ''],
    array['controle', '170. une note', 'chef', $q$insert into revision_notes (dossier_id, annee, cycle, nature, texte, auteur) values ('{A}', 2023, 'social', 'travail', 'ESSAI', '{CHEF}')$q$, 'OK', ''],
    array['controle', '171. et une revue', 'chef', $q$insert into revision_revues (dossier_id, annee, conclusion_id, avis, revu_par) values ('{A}', 2024, (select id from revision_conclusions where conclusion = 'ESSAI A-2024'), 'approuve', '{CHEF}')$q$, 'OK', ''],
    array['controle', '172. jamais une conclusion qui en remplace une d''un autre cycle', 'chef', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, remplace_id, auteur) values ('{A}', 2025, 'emprunts', 'revise', '[]'::jsonb, 'ESSAI', (select id from revision_conclusions where conclusion = 'ESSAI A-REC'), '{CHEF}')$q$, '23514', 'Une conclusion en remplace une du même cycle, pour le même exercice.'],
    array['controle', '173. ni d''un autre exercice', 'chef', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, remplace_id, auteur) values ('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', (select id from revision_conclusions where conclusion = 'ESSAI A-2024'), '{CHEF}')$q$, '23514', 'Une conclusion en remplace une du même cycle, pour le même exercice.'],
    array['controle', '174. ni d''un autre dossier', 'chef', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, remplace_id, auteur) values ('{A}', 2001, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', '{RDC}', '{CHEF}')$q$, '23514', 'Une conclusion en remplace une du même cycle, pour le même exercice.'],
    array['controle', '175. jamais une revue d''une conclusion d''un autre exercice', 'chef', $q$insert into revision_revues (dossier_id, annee, conclusion_id, avis, revu_par) values ('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A-2024'), 'approuve', '{CHEF}')$q$, '23514', 'Une revue porte sur une conclusion de son dossier, pour le même exercice.'],
    array['controle', '176. ni d''un autre dossier', 'chef', $q$insert into revision_revues (dossier_id, annee, conclusion_id, avis, revu_par) values ('{A}', 2001, '{RDC}', 'approuve', '{CHEF}')$q$, '23514', 'Une revue porte sur une conclusion de son dossier, pour le même exercice.'],
    array['controle', '177. ni d''une conclusion qui n''existe pas', 'chef', $q$insert into revision_revues (dossier_id, annee, conclusion_id, avis, revu_par) values ('{A}', 2025, '{ABSENT}', 'approuve', '{CHEF}')$q$, '23514', 'Une revue porte sur une conclusion de son dossier, pour le même exercice.'],
    array['controle', '178. une seconde revue de la même conclusion', 'postgres', $q$insert into revision_revues (dossier_id, annee, conclusion_id, avis, revu_par) values ('{A}', 2025, (select id from revision_conclusions where conclusion = 'ESSAI A3'), 'approuve', '{CHEF}')$q$, '23505', 'duplicate key value violates unique constraint "revision_revues_une_par_conclusion"'],
    array['controle', '179. une seconde première conclusion', 'postgres', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', '{CHEF}')$q$, '23505', 'duplicate key value violates unique constraint "revision_conclusions_une_premiere"'],
    array['controle', '180. deux suites d''une même conclusion', 'postgres', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, remplace_id, auteur) values ('{A}', 2025, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', (select id from revision_conclusions where conclusion = 'ESSAI A1'), '{CHEF}')$q$, '23505', 'duplicate key value violates unique constraint "revision_conclusions_une_suite"'],
    array['controle', '181. une conclusion : un exercice avant 2000', 'postgres', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{A}', 1999, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_conclusions_annee"'],
    array['controle', '182. un cycle inconnu', 'postgres', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{A}', 2022, 'caisse', 'revise', '[]'::jsonb, 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_conclusions_cycle"'],
    array['controle', '183. un état inconnu', 'postgres', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{A}', 2022, 'tresorerie', 'valide', '[]'::jsonb, 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_conclusions_etat"'],
    array['controle', '184. un programme qui n''est pas une liste', 'postgres', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{A}', 2022, 'tresorerie', 'revise', '{}'::jsonb, 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_conclusions_travaux"'],
    array['controle', '185. un programme de plus de 64 Kio', 'postgres', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{A}', 2022, 'tresorerie', 'revise', '{TROPGROS}'::jsonb, 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_conclusions_travaux"'],
    array['controle', '186. une conclusion de blancs', 'postgres', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{A}', 2022, 'tresorerie', 'revise', '[]'::jsonb, '{BLANCS}', '{CHEF}')$q$, '23514', '%"revision_conclusions_conclusion"'],
    array['controle', '187. une conclusion de 8 001 caractères', 'postgres', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, auteur) values ('{A}', 2022, 'tresorerie', 'revise', '[]'::jsonb, '{C8001}', '{CHEF}')$q$, '23514', '%"revision_conclusions_conclusion"'],
    array['controle', '188. des points à suivre de blancs', 'postgres', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, a_suivre, auteur) values ('{A}', 2022, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', '{BLANCS}', '{CHEF}')$q$, '23514', '%"revision_conclusions_a_suivre"'],
    array['controle', '189. des points à suivre de 4 001 caractères', 'postgres', $q$insert into revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, a_suivre, auteur) values ('{A}', 2022, 'tresorerie', 'revise', '[]'::jsonb, 'ESSAI', '{S4001}', '{CHEF}')$q$, '23514', '%"revision_conclusions_a_suivre"'],
    array['controle', '190. une note : un cycle inconnu', 'postgres', $q$insert into revision_notes (dossier_id, annee, cycle, nature, texte, auteur) values ('{A}', 2022, 'caisse', 'travail', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_notes_cycle"'],
    array['controle', '191. une nature inconnue', 'postgres', $q$insert into revision_notes (dossier_id, annee, cycle, nature, texte, auteur) values ('{A}', 2022, 'tresorerie', 'appel', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_notes_nature"'],
    array['controle', '192. un texte de blancs', 'postgres', $q$insert into revision_notes (dossier_id, annee, cycle, nature, texte, auteur) values ('{A}', 2022, 'tresorerie', 'travail', '{BLANCS}', '{CHEF}')$q$, '23514', '%"revision_notes_texte"'],
    array['controle', '192bis. un texte de 4 001 caractères', 'postgres', $q$insert into revision_notes (dossier_id, annee, cycle, nature, texte, auteur) values ('{A}', 2022, 'tresorerie', 'travail', '{N4001}', '{CHEF}')$q$, '23514', '%"revision_notes_texte"'],
    array['controle', '193. un exercice après 2100', 'postgres', $q$insert into revision_notes (dossier_id, annee, cycle, nature, texte, auteur) values ('{A}', 2101, 'tresorerie', 'travail', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_notes_annee"'],
    array['controle', '193bis. un exercice avant 2000', 'postgres', $q$insert into revision_notes (dossier_id, annee, cycle, nature, texte, auteur) values ('{A}', 1999, 'tresorerie', 'travail', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_notes_annee"'],
    array['controle', '194. une revue : un avis inconnu', 'postgres', $q$insert into revision_revues (dossier_id, annee, conclusion_id, avis, revu_par) values ('{A}', 2024, (select id from revision_conclusions where conclusion = 'ESSAI A-2024'), 'valide', '{CHEF}')$q$, '23514', '%"revision_revues_avis"'],
    array['controle', '195. à reprendre sans observation', 'postgres', $q$insert into revision_revues (dossier_id, annee, conclusion_id, avis, revu_par) values ('{A}', 2024, (select id from revision_conclusions where conclusion = 'ESSAI A-2024'), 'a_reprendre', '{CHEF}')$q$, '23514', '%"revision_revues_observation_requise"'],
    array['controle', '196. une observation de blancs', 'postgres', $q$insert into revision_revues (dossier_id, annee, conclusion_id, avis, observation, revu_par) values ('{A}', 2024, (select id from revision_conclusions where conclusion = 'ESSAI A-2024'), 'approuve', '{BLANCS}', '{CHEF}')$q$, '23514', '%"revision_revues_observation"'],

    array['controle', '196bis. une observation de 4 001 caractères', 'postgres', $q$insert into revision_revues (dossier_id, annee, conclusion_id, avis, observation, revu_par) values ('{A}', 2024, (select id from revision_conclusions where conclusion = 'ESSAI A-2024'), 'approuve', '{O4001}', '{CHEF}')$q$, '23514', '%"revision_revues_observation"'],
    -- ══ Ce que le catalogue dit ══════════
    array['valeur', '197. les déclencheurs : avant la ligne, actifs, sur les trois gestes', 'postgres', $q$select string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || ((t.tgtype & 1) <> 0) || ':' || ((t.tgtype & 2) <> 0) || ':' || ((t.tgtype & 4) <> 0) || ':' || ((t.tgtype & 8) <> 0) || ':' || ((t.tgtype & 16) <> 0) || ':' || t.tgenabled::text || ':' || p.proname, ',' order by t.tgname collate "C") from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid in ('public.revision_conclusions'::regclass, 'public.revision_notes'::regclass, 'public.revision_revues'::regclass) and not t.tgisinternal$q$, '',
      'revision_conclusions:revision_conclusions_gardes:true:true:true:true:true:O:garder_revision_conclusion,revision_notes:revision_notes_gardes:true:true:true:true:true:O:garder_revision_note,revision_revues:revision_revues_gardes:true:true:true:true:true:O:garder_revision_revue'],
    array['valeur', '198. lues par le cabinet, réinsérées par le super-administrateur, et rien d''autre ; RLS active', 'postgres', $q$select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename collate "C", policyname collate "C") || '/' || (select string_agg(relname || '=' || relrowsecurity || relforcerowsecurity, ',' order by relname collate "C") from pg_class where oid in ('public.revision_conclusions'::regclass, 'public.revision_notes'::regclass, 'public.revision_revues'::regclass)) from pg_policies where schemaname = 'public' and tablename in ('revision_conclusions', 'revision_notes', 'revision_revues')$q$, '',
      'revision_conclusions:revision_conclusions_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):,revision_conclusions:revision_conclusions_restauration:INSERT:authenticated::is_super_admin(),revision_notes:revision_notes_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):,revision_notes:revision_notes_restauration:INSERT:authenticated::is_super_admin(),revision_revues:revision_revues_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):,revision_revues:revision_revues_restauration:INSERT:authenticated::is_super_admin()/revision_conclusions=truefalse,revision_notes=truefalse,revision_revues=truefalse'],
    array['valeur', '199. les clés : le dossier en cascade, la chaîne et la revue sans action', 'postgres', $q$select string_agg(x, ',' order by x collate "C") from (select c.conrelid::regclass::text || '.' || a.attname || '>' || c.confrelid::regclass::text || ':' || c.confdeltype::text as x from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] where c.contype = 'f' and c.conrelid in ('public.revision_conclusions'::regclass, 'public.revision_notes'::regclass, 'public.revision_revues'::regclass)) k$q$, '',
      'revision_conclusions.dossier_id>dossiers:c,revision_conclusions.remplace_id>revision_conclusions:a,revision_notes.dossier_id>dossiers:c,revision_revues.conclusion_id>revision_conclusions:a,revision_revues.dossier_id>dossiers:c'],
    array['valeur', '200. les fonctions : sécurité, search_path, volatilité, droits de l''anonyme et d''un compte connecté', 'postgres', $q$select string_agg(p.proname || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-') || ':' || p.provolatile::text || ':' || has_function_privilege('anon', p.oid, 'execute') || '/' || has_function_privilege('authenticated', p.oid, 'execute'), ',' order by p.proname collate "C") from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('conclure_cycle', 'noter_revision', 'revoir_cycle', 'garder_revision_conclusion', 'garder_revision_note', 'garder_revision_revue')$q$, '',
      'conclure_cycle:true:search_path=public:v:false/true,garder_revision_conclusion:false:search_path=public:v:false/false,garder_revision_note:false:search_path=public:v:false/false,garder_revision_revue:false:search_path=public:v:false/false,noter_revision:true:search_path=public:v:false/true,revoir_cycle:true:search_path=public:v:false/true'],
    array['valeur', '201. les index', 'postgres', $q$select string_agg(pg_get_indexdef(i.indexrelid), ' | ' order by pg_get_indexdef(i.indexrelid) collate "C") from pg_index i where i.indrelid in ('public.revision_conclusions'::regclass, 'public.revision_notes'::regclass, 'public.revision_revues'::regclass)$q$, '',
      'CREATE INDEX revision_conclusions_dossier ON public.revision_conclusions USING btree (dossier_id, annee, cycle) | CREATE INDEX revision_notes_dossier ON public.revision_notes USING btree (dossier_id, annee, cycle) | CREATE INDEX revision_revues_dossier ON public.revision_revues USING btree (dossier_id, annee) | CREATE UNIQUE INDEX revision_conclusions_pkey ON public.revision_conclusions USING btree (id) | CREATE UNIQUE INDEX revision_conclusions_une_premiere ON public.revision_conclusions USING btree (dossier_id, annee, cycle) WHERE (remplace_id IS NULL) | CREATE UNIQUE INDEX revision_conclusions_une_suite ON public.revision_conclusions USING btree (remplace_id) | CREATE UNIQUE INDEX revision_notes_pkey ON public.revision_notes USING btree (id) | CREATE UNIQUE INDEX revision_revues_pkey ON public.revision_revues USING btree (id) | CREATE UNIQUE INDEX revision_revues_une_par_conclusion ON public.revision_revues USING btree (conclusion_id)'],
    -- La borne de l'exercice d'une revue ne se voit pas par une insertion : la garde exige une conclusion du même exercice,
    -- que la contrainte des conclusions borne déjà. Les quatorze contraintes de vérification se lisent donc ici, par leur
    -- texte (son empreinte : il contient des blancs bruts).
    array['valeur', '201bis. les contraintes de vérification des trois tables, par leur texte', 'postgres', $q$select count(*) || '/' || string_agg(conname, ',' order by conname collate "C") || '/' || md5(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), E'\n' order by conrelid::regclass::text collate "C", conname collate "C")) from pg_constraint where contype = 'c' and conrelid in ('public.revision_conclusions'::regclass, 'public.revision_notes'::regclass, 'public.revision_revues'::regclass)$q$, '',
      '14/revision_conclusions_a_suivre,revision_conclusions_annee,revision_conclusions_conclusion,revision_conclusions_cycle,revision_conclusions_etat,revision_conclusions_travaux,revision_notes_annee,revision_notes_cycle,revision_notes_nature,revision_notes_texte,revision_revues_annee,revision_revues_avis,revision_revues_observation,revision_revues_observation_requise/3fc916059d0fbd0c7aa65bba24794b58'],
    array['valeur', '202. ce que les fonctions prennent et rendent', 'postgres', $q$select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid), ' | ' order by p.proname collate "C") from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('conclure_cycle', 'noter_revision', 'revoir_cycle')$q$, '',
      'conclure_cycle(p_dossier_id uuid, p_annee integer, p_cycle text, p_etat text, p_travaux jsonb, p_conclusion text, p_a_suivre text, p_remplace_id uuid) -> revision_conclusions | noter_revision(p_dossier_id uuid, p_annee integer, p_cycle text, p_nature text, p_texte text) -> revision_notes | revoir_cycle(p_dossier_id uuid, p_annee integer, p_conclusion_id uuid, p_avis text, p_observation text) -> revision_revues']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      attendu := etape[6];
      for cle, valeur in select key, value from jsonb_each_text(ids) loop
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
      elsif etape[1] = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = attendu, false));
      else
        begin
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
            perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'client' then client
                                                         when 'collaborateur' then client when 'chefj' then client else inconnu end,
                                     'role', 'authenticated')::text end, true);
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
                     else not accepte and coalesce(code_recu = etape[5] and message like attendu, false) end);
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

  -- ══ 203. Rien n'est resté ══════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from revision_conclusions)), ((select count(*) from revision_notes)), ((select count(*) from revision_revues)),
    ((select count(*) from revision_justifications)), ((select count(*) from dossiers)), ((select count(*) from cabinets)),
    ((select count(*) from cabinet_admins)), ((select count(*) from dossier_assignations))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '203. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI CYCLES%')
      and not exists (select 1 from cabinets where nom like 'ESSAI CYCLES%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.cycles', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer (une valeur nulle dans sa comparaison) est une faute, pas un silence. La ligne 0
-- dit le texte que la base a reçu — par l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier
-- par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.cycles')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
