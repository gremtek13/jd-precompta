-- LA REVUE ANALYTIQUE, ÉPROUVÉE EN BASE — à rejouer par `execute_sql` après toute migration qui touche `revision_seuils`,
-- `revision_explications`, leurs gardes ou leurs policies, `fixer_seuil_de_signification`, `expliquer_variation`, ce
-- qu'elles lisent pour décider — la source de l'exercice précédent (`source_du_precedent`, `exercices_valides`, les repères
-- annuels), les montants (`solde_du_compte`, `centimes_de_la_2035_validee`, `centimes_du_repere_annuel`,
-- `centimes_du_navigateur`) — ou l'accès (`admin_du_dossier`) et les verrous de la validation et de la révision (ligne 41,
-- étape R5 ; migration `revue_analytique`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI LIT ET QUI ÉCRIT, sous six profils : un seuil et une explication EXISTENT dans le dossier du client, et
--     l'anonyme, un compte rattaché à rien et le client ne les voient pas, ne les modifient pas, n'en écrivent pas, et
--     n'appellent pas les fonctions ; le chef du cabinet les voit et, super-administrateur, en insère (la restauration) ;
--     un membre du cabinet AFFECTÉ à un dossier y fixe le seuil et y explique (hypothèse Q2), n'atteint rien du dossier qui
--     ne lui est pas confié, n'insère pas en direct ; un chef de cabinet qui n'est pas super-administrateur agit dans tout
--     son cabinet, et dans lui seul ;
--   - LES REFUS DES DEUX FONCTIONS — `fixer_seuil_de_signification` (sept), `expliquer_variation` (dix) —, chacun jugé à
--     son code ET à son message, et leur ORDRE, par paires de refus voisins qu'une même demande déclenche ensemble ;
--   - LA SOURCE DE L'EXERCICE PRÉCÉDENT, ligne par ligne : la 2035 validée (A, E), l'exercice validé pour un compte (A, C,
--     D), le repère annuel quand l'exercice précédent n'a pas de 2035 validée — non validé (B) ou validé en engagement (C)
--     —, rien sinon ; jamais un recalcul. Les MONTANTS que la base sait lire : le solde d'un compte (A), une 2035 validée de
--     l'exercice (E, F) ou du précédent (A, D, E), un repère (B, C) ; le montant d'une ligne de la 2035 d'un exercice NON
--     validé se garde tel que l'écran l'a montré (A) ;
--   - CE QUI S'ÉCRIT : l'auteur — le membre affecté compris —, les montants, la source, et la ligne que chaque fonction
--     rend ; la chaîne des seuils d'un exercice et celle des explications d'une ligne — de sa nature —, qui ne vise que la
--     courante, jamais un seuil ou une explication d'un autre dossier, d'une autre ligne ou d'une autre nature ;
--   - L'IMMUABILITÉ ET LA RESTAURATION : rien ne se modifie, même pour le propriétaire ; le super-administrateur réinsère,
--     jamais un seuil ou une explication qui en remplace un d'un autre exercice, d'une autre ligne ou d'un autre dossier ;
--     chaque contrainte par son nom ;
--   - LES FONCTIONS INTERNES, sur des valeurs relevées que src/lib/revueAnalytique.ts doit rendre à l'identique : les
--     centimes d'un montant, une ligne d'une 2035 validée, une ligne d'un repère, la source ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer ici : les déclencheurs, les policies et la RLS, les clés et leur
--     action à la suppression, la sécurité et les droits des fonctions, les index, les colonnes (type, obligation,
--     défaut), ce que les fonctions prennent et rendent ;
--   - et que RIEN ne reste en base après l'essai.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE DU SCHÉMA (HISTORIQUE.md, entrée de l'étape R5) : une
-- suppression — d'un seuil ou d'une explication, refusée en direct ; la cascade d'un dossier qui les emporte — et deux
-- sessions concurrentes.
--
-- Le harnais est celui de `revisionCycles.sql` : des dossiers JETABLES (préfixe `e55b4500`), dans le cabinet du dossier
-- `test` et dans un cabinet jetable, au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) ;
-- chaque contrôle dans sa propre sous-transaction, annulée (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE
-- avant ; les étapes « fait » gardées jusqu'à l'annulation finale. Un exercice VALIDÉ du jeu est posé en direct par le
-- propriétaire : seuls son existence, son modèle et sa 2035 comptent ici. Un refus se juge à son code ET à son message.
-- L'exercice en cours se lit à Paris (`{AN}`). Aucune instruction de suppression ; un caractère hors de l'ASCII se
-- fabrique en base (`chr`). Hors de l'outil d'exécution, le fichier se joue en UNE transaction (`psql -1`).
-- `src/lib/revueAnalytiqueEssai.test.ts` rejoue chacun de ses appels sur le module, qui doit dire avant le clic le refus
-- que la base a dit, et chacune de ses lectures des fonctions internes.
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
      'E4000', repeat('e', 4000), 'E4001', repeat('e', 4001), 'M4000', repeat('m', 4000), 'M4001', repeat('m', 4001),
      'P500', repeat('p', 500), 'P501', repeat('p', 501))
    || jsonb_build_object(
      'A', 'e55b4500-0000-4000-8000-0000000000a1', 'B', 'e55b4500-0000-4000-8000-0000000000b1',
      'C', 'e55b4500-0000-4000-8000-0000000000c1', 'D', 'e55b4500-0000-4000-8000-0000000000d1',
      'E', 'e55b4500-0000-4000-8000-0000000000e1', 'F', 'e55b4500-0000-4000-8000-0000000000f1',
      'CJ', 'e55b4500-0000-4000-8000-0000000000c9', 'J1', 'e55b4500-0000-4000-8000-0000000000ca',
      'J2', 'e55b4500-0000-4000-8000-0000000000cb', 'ABSENT', 'e55b4500-0000-4000-8000-0000000000ff',
      'SDC', 'e55b4500-0000-4000-8004-000000000001', 'XDC', 'e55b4500-0000-4000-8004-000000000002');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from revision_seuils)), ((select count(*) from revision_explications)), ((select count(*) from dossiers)),
    ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)), ((select count(*) from dossier_assignations)),
    ((select count(*) from exercices_valides)), ((select count(*) from references_annuelles)),
    ((select count(*) from references_postes_annuels)), ((select count(*) from ecritures_brouillon))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue} — les
  -- genres de `revisionCycles.sql` : « jeu » (posé par le propriétaire, gardé), « controle » (joué sous « qui » puis
  -- annulé ; « OK » attend qu'il passe), « fait » (joué sous « qui » et gardé), « valeur » (une lecture qui doit rendre
  -- exactement la valeur attendue). « qui » : postgres, chef, client, collaborateur (le même compte que le client, une
  -- fois devenu membre du cabinet jetable, affecté à J1 et non à J2), chefj (le même compte, devenu le chef de ce cabinet,
  -- sans être super-administrateur), inconnu, anon.
  etapes := array[
    -- ══ Le jeu ══════════
    -- A : 2024 validé, sa 2035 lisible ; 2025 ouvert. B : 2024 ni validé ni déclaré, des repères. C : 2024 validé en
    -- engagement, sans 2035, un repère. D : 2024 validé, sa 2035 illisible. E : 2024 et 2025 validés, leurs 2035 lisibles
    -- (celle de 2025 porte deux fois le même poste). F : 2025 validé, sa 2035 illisible. J1 et J2 : un cabinet jetable,
    -- dont J1 seul sera confié au collaborateur, avant qu'il en devienne le chef.
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values
      ('{A}', 'ESSAI REVUE A', '{CAB}'), ('{B}', 'ESSAI REVUE B', '{CAB}'), ('{C}', 'ESSAI REVUE C', '{CAB}'),
      ('{D}', 'ESSAI REVUE D', '{CAB}'), ('{E}', 'ESSAI REVUE E', '{CAB}'), ('{F}', 'ESSAI REVUE F', '{CAB}')$q$, '', ''],
    array['jeu', 'un cabinet jetable et ses deux dossiers', 'postgres', $q$insert into cabinets (id, nom) values ('{CJ}', 'ESSAI REVUE CABINET J')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values ('{J1}', 'ESSAI REVUE J1', '{CJ}'), ('{J2}', 'ESSAI REVUE J2', '{CJ}')$q$, '', ''],
    -- A, 2024 : la banque à 10 000 − 1 200,50 − 3 000 = 5 799,50 au débit, les honoraires à 10 000 au crédit. 2025 : la
    -- banque à 12 500 + 0,10 − 1 000 − 9 000 = 2 500,10 au débit, les honoraires à 12 500,10 au crédit.
    array['jeu', 'écritures', 'postgres', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values
      ('{A}', '2024-03-15', '512000', 'ESSAI', 10000, 'debit'), ('{A}', '2024-03-15', '706000', 'ESSAI', 10000, 'credit'),
      ('{A}', '2024-05-10', '606100', 'ESSAI', 1200.50, 'debit'), ('{A}', '2024-05-10', '512000', 'ESSAI', 1200.50, 'credit'),
      ('{A}', '2024-06-01', '613200', 'ESSAI', 3000, 'debit'), ('{A}', '2024-06-01', '512000', 'ESSAI', 3000, 'credit'),
      ('{A}', '2025-03-15', '512000', 'ESSAI', 12500, 'debit'), ('{A}', '2025-03-15', '706000', 'ESSAI', 12500, 'credit'),
      ('{A}', '2025-03-16', '512000', 'ESSAI', 0.10, 'debit'), ('{A}', '2025-03-16', '706000', 'ESSAI', 0.10, 'credit'),
      ('{A}', '2025-05-10', '606100', 'ESSAI', 1000, 'debit'), ('{A}', '2025-05-10', '512000', 'ESSAI', 1000, 'credit'),
      ('{A}', '2025-06-01', '613200', 'ESSAI', 9000, 'debit'), ('{A}', '2025-06-01', '512000', 'ESSAI', 9000, 'credit'),
      ('{B}', '2024-02-01', '512000', 'ESSAI', 300, 'debit'), ('{B}', '2024-02-01', '706000', 'ESSAI', 300, 'credit'),
      ('{B}', '2025-02-01', '512000', 'ESSAI', 500, 'debit'), ('{B}', '2025-02-01', '706000', 'ESSAI', 500, 'credit'),
      ('{C}', '2024-04-01', '512000', 'ESSAI', 700, 'debit'), ('{C}', '2024-04-01', '706000', 'ESSAI', 700, 'credit'),
      ('{C}', '2025-04-01', '512000', 'ESSAI', 800, 'debit'), ('{C}', '2025-04-01', '706000', 'ESSAI', 800, 'credit')$q$, '', ''],
    array['jeu', 'exercices validés, posés en direct', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values
      ('{A}', 2024, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('a', 64), '{"version":1,"annee":2024,"postes":[{"poste":"Honoraires","nature":"recette","montant":10000},{"poste":"Achats","nature":"depense","montant":1200.5},{"poste":"Loyers et charges locatives","nature":"depense","montant":3000}],"totalRecettes":10000,"totalDepenses":4200.5,"resultat":5799.5}'::jsonb),
      ('{C}', 2024, now(), '{CHEF}', 'engagement', 0, 0, 0, 0, repeat('c', 64), null),
      ('{D}', 2024, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('d', 64), '{"essai":"D"}'::jsonb),
      ('{E}', 2024, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('e', 64), '{"postes":[{"poste":"Loyers et charges locatives","nature":"depense","montant":1000}],"totalRecettes":0,"totalDepenses":1000,"resultat":-1000}'::jsonb),
      ('{E}', 2025, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('f', 64), '{"postes":[{"poste":"Loyers et charges locatives","nature":"depense","montant":1500.25},{"poste":"Loyers et charges locatives","nature":"depense","montant":0.25}],"totalRecettes":0,"totalDepenses":1500.5,"resultat":-1500.5}'::jsonb),
      ('{F}', 2025, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('0', 64), '{"postes":"illisible","totalRecettes":0,"totalDepenses":0,"resultat":0}'::jsonb)$q$, '', ''],
    -- B : un chiffre d'affaires au millième (900 000,4 centimes : 9 000,00 €), un résultat à la demi-centime négative
    -- (Math.round : −1 234,56 €), un poste lisible, un poste hors des bornes, un poste NaN. C : un chiffre d'affaires, aucun
    -- résultat, et un poste au nom d'un poste de B, qu'aucune lecture de B ne doit voir.
    array['jeu', 'repères annuels', 'postgres', $q$insert into references_annuelles (dossier_id, annee, chiffre_affaires, resultat_net, source) values
      ('{B}', 2024, 9000.004, -1234.565, 'saisie_manuelle'), ('{C}', 2024, 7000, null, 'saisie_manuelle')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into references_postes_annuels (dossier_id, annee, poste, montant) values
      ('{B}', 2024, 'Loyers et charges locatives', 2400), ('{B}', 2024, 'Énorme', 100000000000000000000), ('{B}', 2024, 'Achats', 'NaN'),
      ('{C}', 2024, 'Loyers et charges locatives', 1234)$q$, '', ''],
    array['jeu', 'un seuil et une explication dans le dossier du client, posés par le propriétaire', 'postgres', $q$insert into revision_seuils (id, dossier_id, annee, seuil, motif, auteur) values ('{SDC}', '{DC}', 2001, 100, 'ESSAI DC', '{CHEF}')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into revision_explications (id, dossier_id, annee, objet_type, objet, nature, montant, montant_precedent, source_precedent, explication, auteur) values ('{XDC}', '{DC}', 2001, 'total_2035', 'resultat', null, 0, null, 'aucune', 'ESSAI DC', '{CHEF}')$q$, '', ''],

    -- ══ Qui lit, qui écrit ══════════
    array['controle', '1. l''anonyme ne lit ni seuil ni explication', 'anon', $q$do $x$ begin if exists (select 1 from revision_seuils) or exists (select 1 from revision_explications) then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '2. ni un compte rattaché à rien', 'inconnu', $q$do $x$ begin if exists (select 1 from revision_seuils) or exists (select 1 from revision_explications) then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '3. ni le client, sur son propre dossier', 'client', $q$do $x$ begin if exists (select 1 from revision_seuils where dossier_id = '{DC}') or exists (select 1 from revision_explications where dossier_id = '{DC}') then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '4. le chef du cabinet les lit', 'chef', $q$do $x$ begin if (select count(*) from revision_seuils where dossier_id = '{DC}') <> 1 or (select count(*) from revision_explications where dossier_id = '{DC}') <> 1 then raise exception 'PAS VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '5. l''anonyme n''appelle pas fixer_seuil_de_signification', 'anon', $q$select fixer_seuil_de_signification('{A}', 2025, 1000, 'ESSAI', null)$q$, '42501', 'permission denied for function fixer_seuil_de_signification'],
    array['controle', '6. ni expliquer_variation', 'anon', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, 'validee', 'ESSAI', null)$q$, '42501', 'permission denied for function expliquer_variation'],
    array['controle', '7. seuil, refus 1 : un compte rattaché à rien', 'inconnu', $q$select fixer_seuil_de_signification('{A}', 2025, 1000, 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '8. seuil, refus 1 : le client, sur son propre dossier', 'client', $q$select fixer_seuil_de_signification('{DC}', 2025, 1000, 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '9. seuil, refus 1 : un dossier qui n''existe pas se refuse comme un dossier interdit, même au super-administrateur', 'chef', $q$select fixer_seuil_de_signification('{ABSENT}', 2025, 1000, 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '10. seuil, refus 1 avant 2 : l''accès d''abord', 'inconnu', $q$select fixer_seuil_de_signification('{A}', 1999, 1000, 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '11. expliquer, refus 1 : un compte rattaché à rien', 'inconnu', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, 'validee', 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '12. expliquer, refus 1 : le client, sur son propre dossier', 'client', $q$select expliquer_variation('{DC}', 2025, 'compte', '512000', null, 0, null, 'aucune', 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '13. expliquer, refus 1 : un dossier qui n''existe pas, même au super-administrateur', 'chef', $q$select expliquer_variation('{ABSENT}', 2025, 'compte', '512000', null, 0, null, 'aucune', 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '14. expliquer, refus 1 avant 2', 'inconnu', $q$select expliquer_variation('{A}', 1999, 'compte', '512000', null, 0, null, 'aucune', 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '15. le client n''écrit pas un seuil en direct', 'client', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, auteur) values ('{DC}', 2002, 100, 'ESSAI', '{CLIENT}')$q$, '42501', 'new row violates row-level security policy for table "revision_seuils"'],
    array['controle', '16. ni une explication', 'client', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, auteur) values ('{DC}', 2002, 'compte', '512000', 0, 'aucune', 'ESSAI', '{CLIENT}')$q$, '42501', 'new row violates row-level security policy for table "revision_explications"'],
    array['controle', '17. le client ne modifie rien', 'client', $q$do $x$ declare n integer; begin
      update revision_seuils set motif = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count; if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
      update revision_explications set explication = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count; if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
    end $x$$q$, 'OK', ''],
    array['controle', '18. le chef non plus, qui n''a aucune policy de mise à jour', 'chef', $q$do $x$ declare n integer; begin
      update revision_seuils set motif = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count; if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
      update revision_explications set explication = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count; if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
    end $x$$q$, 'OK', ''],
    array['controle', '19. et le propriétaire, qui passe la RLS, bute sur la garde : un seuil ne se modifie pas', 'postgres', $q$update revision_seuils set motif = 'ESSAI MODIFIÉ' where id = '{SDC}'$q$, '23514', 'Un seuil de signification ne se modifie pas : il se remplace par un autre, et l''historique reste.'],
    array['controle', '20. ni une explication', 'postgres', $q$update revision_explications set explication = 'ESSAI MODIFIÉ' where id = '{XDC}'$q$, '23514', 'Une explication de la revue analytique ne se modifie pas : elle se remplace par une autre, et l''historique reste.'],

    -- ══ Le seuil : ses refus, dans leur ordre ══════════
    array['controle', '21. seuil, refus 2 : un exercice avant 2000', 'chef', $q$select fixer_seuil_de_signification('{A}', 1999, 1000, 'ESSAI', null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '22. un exercice après 2100', 'chef', $q$select fixer_seuil_de_signification('{A}', 2101, 1000, 'ESSAI', null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '23. aucun exercice', 'chef', $q$select fixer_seuil_de_signification('{A}', null, 1000, 'ESSAI', null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '24. seuil, refus 3 : l''exercice en cours, lu à Paris (hypothèse Q11)', 'chef', $q$select fixer_seuil_de_signification('{A}', {AN}, 1000, 'ESSAI', null)$q$, '22023', 'L''exercice {AN} n''est pas terminé : sa révision s''ouvre une fois clos.'],
    array['controle', '25. un exercice futur, dans les bornes', 'chef', $q$select fixer_seuil_de_signification('{A}', 2100, 1000, 'ESSAI', null)$q$, '22023', 'L''exercice 2100 n''est pas terminé : sa révision s''ouvre une fois clos.'],
    array['controle', '26. refus 2 avant 5 : l''exercice d''abord', 'chef', $q$select fixer_seuil_de_signification('{A}', 1999, 0, null, null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '27. refus 3 avant 5', 'chef', $q$select fixer_seuil_de_signification('{A}', {AN}, 0, null, null)$q$, '22023', 'L''exercice {AN} n''est pas terminé : sa révision s''ouvre une fois clos.'],
    array['controle', '28. seuil, refus 5 : aucun seuil', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, null, 'ESSAI', null)$q$, '22023', 'Le seuil de signification est un montant positif, au centime.'],
    array['controle', '29. un seuil nul', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 0, 'ESSAI', null)$q$, '22023', 'Le seuil de signification est un montant positif, au centime.'],
    array['controle', '30. un seuil négatif', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, -1, 'ESSAI', null)$q$, '22023', 'Le seuil de signification est un montant positif, au centime.'],
    array['controle', '31. un seuil au millième', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 0.001, 'ESSAI', null)$q$, '22023', 'Le seuil de signification est un montant positif, au centime.'],
    array['controle', '32. un seuil à cent mille milliards', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 100000000000000, 'ESSAI', null)$q$, '22023', 'Le seuil de signification est un montant positif, au centime.'],
    array['controle', '33. NaN', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 'NaN'::numeric, 'ESSAI', null)$q$, '22023', 'Le seuil de signification est un montant positif, au centime.'],
    array['controle', '34. un centime suffit', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 0.01, 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '35. et la borne, au centime près', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 99999999999999.99, 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '36. refus 5 avant 6 : le seuil avant le motif', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 0, null, null)$q$, '22023', 'Le seuil de signification est un montant positif, au centime.'],
    array['controle', '37. seuil, refus 6 : sans motif (hypothèse Q4)', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 1000, null, null)$q$, '22023', 'Un seuil de signification se motive.'],
    array['controle', '38. des blancs ne sont pas un motif', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 1000, '{BLANCS}', null)$q$, '22023', 'Un seuil de signification se motive.'],
    array['controle', '39. une espace insécable si', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 1000, '{NBSP}', null)$q$, 'OK', ''],
    array['controle', '40. 4 000 caractères passent', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 1000, '{M4000}', null)$q$, 'OK', ''],
    array['controle', '41. 4 001 non', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 1000, '{M4001}', null)$q$, '22023', 'Un motif tient en 4 000 caractères au plus.'],
    array['controle', '42. refus 6 avant 7 : le motif avant le remplacement', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 1000, null, '{ABSENT}')$q$, '22023', 'Un seuil de signification se motive.'],
    array['fait', '43. le premier seuil de A pour 2025', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 1500.50, 'ESSAI S1', null)$q$, 'OK', ''],
    array['valeur', '44. ce qui s''écrit : le montant, le motif, l''auteur, aucun remplacement', 'postgres', $q$select seuil::text || '/' || motif || '/' || (auteur = '{CHEF}')::text || '/' || coalesce(remplace_id::text, 'nul') from revision_seuils where dossier_id = '{A}' and annee = 2025$q$, '', '1500.50/ESSAI S1/true/nul'],
    array['controle', '45. seuil, refus 7 : un second premier seuil', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 2000, 'ESSAI', null)$q$, '22023', 'Un autre seuil a été fixé pour cet exercice depuis : relire avant de le changer.'],
    array['fait', '46. le second remplace le courant', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 2000, 'ESSAI S2', (select id from revision_seuils where motif = 'ESSAI S1'))$q$, 'OK', ''],
    array['controle', '47. remplacer le premier, qui n''est plus le courant', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 2500, 'ESSAI', (select id from revision_seuils where motif = 'ESSAI S1'))$q$, '22023', 'Un autre seuil a été fixé pour cet exercice depuis : relire avant de le changer.'],
    array['fait', '48. un seuil de 2024', 'chef', $q$select fixer_seuil_de_signification('{A}', 2024, 800, 'ESSAI S2024', null)$q$, 'OK', ''],
    array['controle', '49. remplacer un seuil d''un autre exercice', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 2500, 'ESSAI', (select id from revision_seuils where motif = 'ESSAI S2024'))$q$, '22023', 'Le seuil à remplacer n''est pas un seuil de l''exercice 2025 dans ce dossier.'],
    array['controle', '50. ou d''un autre dossier', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 2500, 'ESSAI', '{SDC}')$q$, '22023', 'Le seuil à remplacer n''est pas un seuil de l''exercice 2025 dans ce dossier.'],
    array['fait', '50bis. un seuil de B pour 2025', 'chef', $q$select fixer_seuil_de_signification('{B}', 2025, 700, 'ESSAI SB', null)$q$, 'OK', ''],
    array['controle', '50ter. ni d''un autre dossier, du même exercice', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 2500, 'ESSAI', (select id from revision_seuils where motif = 'ESSAI SB'))$q$, '22023', 'Le seuil à remplacer n''est pas un seuil de l''exercice 2025 dans ce dossier.'],
    array['controle', '51. ou un seuil qui n''existe pas', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 2500, 'ESSAI', '{ABSENT}')$q$, '22023', 'Le seuil à remplacer n''est pas un seuil de l''exercice 2025 dans ce dossier.'],
    array['controle', '52. remplacer le courant passe', 'chef', $q$select fixer_seuil_de_signification('{A}', 2025, 2500, 'ESSAI', (select id from revision_seuils where motif = 'ESSAI S2'))$q$, 'OK', ''],
    array['controle', '52bis. la fonction rend le seuil écrit', 'chef', $q$do $x$ declare r public.revision_seuils; begin
      r := fixer_seuil_de_signification('{A}', 2023, 600, 'ESSAI RENDU', null);
      if r.id is null or r.dossier_id <> '{A}' or r.annee <> 2023 or r.seuil <> 600 or r.motif <> 'ESSAI RENDU' or r.auteur <> '{CHEF}'
         or r.remplace_id is not null or r.cree_le is null then raise exception 'RENDU %', r; end if;
    end $x$$q$, 'OK', ''],
    array['valeur', '53. la chaîne : deux seuils, le courant remplace le premier', 'postgres', $q$select count(*)::text || '/' || (select s.seuil::text from revision_seuils s where s.dossier_id = '{A}' and s.annee = 2025 and not exists (select 1 from revision_seuils r where r.remplace_id = s.id)) from revision_seuils where dossier_id = '{A}' and annee = 2025$q$, '', '2/2000.00'],

    -- ══ Expliquer : refus 2 à 7, dans leur ordre ══════════
    array['controle', '54. expliquer, refus 2 : un exercice avant 2000', 'chef', $q$select expliquer_variation('{A}', 1999, 'compte', '512000', null, 0, null, 'aucune', 'ESSAI', null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '55. après 2100', 'chef', $q$select expliquer_variation('{A}', 2101, 'compte', '512000', null, 0, null, 'aucune', 'ESSAI', null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '56. aucun exercice', 'chef', $q$select expliquer_variation('{A}', null, 'compte', '512000', null, 0, null, 'aucune', 'ESSAI', null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '57. refus 3 : l''exercice en cours', 'chef', $q$select expliquer_variation('{A}', {AN}, 'compte', '512000', null, 0, null, 'aucune', 'ESSAI', null)$q$, '22023', 'L''exercice {AN} n''est pas terminé : sa révision s''ouvre une fois clos.'],
    array['controle', '58. refus 2 avant 5', 'chef', $q$select expliquer_variation('{A}', 1999, 'ligne', null, null, null, null, null, null, null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '59. refus 3 avant 5', 'chef', $q$select expliquer_variation('{A}', {AN}, 'ligne', null, null, null, null, null, null, null)$q$, '22023', 'L''exercice {AN} n''est pas terminé : sa révision s''ouvre une fois clos.'],
    array['controle', '60. refus 5 : un type d''objet inconnu', 'chef', $q$select expliquer_variation('{A}', 2025, 'ligne', '512000', null, 0, null, 'aucune', 'ESSAI', null)$q$, '22023', 'Une explication porte sur un poste de la 2035, un total de la 2035 ou un compte.'],
    array['controle', '61. aucun type', 'chef', $q$select expliquer_variation('{A}', 2025, null, '512000', null, 0, null, 'aucune', 'ESSAI', null)$q$, '22023', 'Une explication porte sur un poste de la 2035, un total de la 2035 ou un compte.'],
    array['controle', '62. un poste sans nom', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', null, 'depense', 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Un poste de la 2035 se nomme : son nom ne peut pas être vide.'],
    array['controle', '63. un nom de blancs', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', '{BLANCS}', 'depense', 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Un poste de la 2035 se nomme : son nom ne peut pas être vide.'],
    array['controle', '64. une espace insécable est un nom', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', '{NBSP}', 'depense', 0, 0, 'validee', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '65. 500 caractères passent', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', '{P500}', 'depense', 0, 0, 'validee', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '66. 501 non', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', '{P501}', 'depense', 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Le nom d''un poste de la 2035 tient en 500 caractères au plus.'],
    array['controle', '67. un poste sans nature', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', 'Achats', null, 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Un poste de la 2035 est une recette ou une dépense.'],
    array['controle', '68. une nature qui n''en est pas une', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', 'Achats', 'Depense', 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Un poste de la 2035 est une recette ou une dépense.'],
    array['controle', '69. un total inconnu', 'chef', $q$select expliquer_variation('{A}', 2025, 'total_2035', 'benefice', null, 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Un total de la 2035 est celui des recettes, celui des dépenses, ou le résultat.'],
    array['controle', '70. aucun total', 'chef', $q$select expliquer_variation('{A}', 2025, 'total_2035', null, null, 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Un total de la 2035 est celui des recettes, celui des dépenses, ou le résultat.'],
    array['controle', '71. un compte de classe 8', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '801000', null, 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Seul un compte des classes 1 à 7 se compare d''un exercice à l''autre.'],
    array['controle', '72. un compte de deux chiffres', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '51', null, 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Seul un compte des classes 1 à 7 se compare d''un exercice à l''autre.'],
    array['controle', '73. un compte suivi d''une espace', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000 ', null, 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Seul un compte des classes 1 à 7 se compare d''un exercice à l''autre.'],
    array['controle', '74. aucun compte', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', null, null, 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Seul un compte des classes 1 à 7 se compare d''un exercice à l''autre.'],
    array['controle', '75. une nature sur un total', 'chef', $q$select expliquer_variation('{A}', 2025, 'total_2035', 'resultat', 'recette', 2500.10, 5799.50, 'validee', 'ESSAI', null)$q$, '22023', 'Seul un poste de la 2035 porte une nature.'],
    array['controle', '76. ou sur un compte', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', 'depense', 2500.10, 5799.50, 'validee', 'ESSAI', null)$q$, '22023', 'Seul un poste de la 2035 porte une nature.'],
    array['controle', '77. refus 5 avant 6 : la ligne avant le montant', 'chef', $q$select expliquer_variation('{A}', 2025, 'ligne', '512000', null, null, null, null, 'ESSAI', null)$q$, '22023', 'Une explication porte sur un poste de la 2035, un total de la 2035 ou un compte.'],
    array['controle', '78. la nature hors d''un poste avant le montant', 'chef', $q$select expliquer_variation('{A}', 2025, 'total_2035', 'resultat', 'depense', null, null, null, 'ESSAI', null)$q$, '22023', 'Seul un poste de la 2035 porte une nature.'],
    array['controle', '79. refus 6 : aucun montant', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, null, 5799.50, 'validee', 'ESSAI', null)$q$, '22023', 'Le montant annoncé n''est pas un montant au centime.'],
    array['controle', '80. un montant au millième', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.105, 5799.50, 'validee', 'ESSAI', null)$q$, '22023', 'Le montant annoncé n''est pas un montant au centime.'],
    array['controle', '81. cent mille milliards', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, -100000000000000, 5799.50, 'validee', 'ESSAI', null)$q$, '22023', 'Le montant annoncé n''est pas un montant au centime.'],
    array['controle', '82. NaN', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 'NaN'::numeric, 5799.50, 'validee', 'ESSAI', null)$q$, '22023', 'Le montant annoncé n''est pas un montant au centime.'],
    array['controle', '83. une source inconnue', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, 'validée', 'ESSAI', null)$q$, '22023', 'La source de l''exercice précédent est l''exercice validé, un repère annuel, ou aucune.'],
    array['controle', '84. aucune source', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, null, 'ESSAI', null)$q$, '22023', 'La source de l''exercice précédent est l''exercice validé, un repère annuel, ou aucune.'],
    array['controle', '85. un montant précédent sans source', 'chef', $q$select expliquer_variation('{B}', 2025, 'compte', '512000', null, 500, 0, 'aucune', 'ESSAI', null)$q$, '22023', 'Sans source pour l''exercice précédent, une explication ne porte pas de montant précédent.'],
    array['controle', '86. une source sans montant précédent', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, null, 'validee', 'ESSAI', null)$q$, '22023', 'Le montant précédent annoncé n''est pas un montant au centime.'],
    array['controle', '87. un montant précédent au millième', 'chef', $q$select expliquer_variation('{B}', 2025, 'total_2035', 'recettes', null, 500, 9000.004, 'reference', 'ESSAI', null)$q$, '22023', 'Le montant précédent annoncé n''est pas un montant au centime.'],
    array['controle', '88. un montant précédent NaN', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 'NaN'::numeric, 'validee', 'ESSAI', null)$q$, '22023', 'Le montant précédent annoncé n''est pas un montant au centime.'],
    array['controle', '88bis. un montant précédent de cent mille milliards', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 100000000000000, 'validee', 'ESSAI', null)$q$, '22023', 'Le montant précédent annoncé n''est pas un montant au centime.'],
    array['controle', '89. le montant avant la source', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, null, null, 'x', 'ESSAI', null)$q$, '22023', 'Le montant annoncé n''est pas un montant au centime.'],
    array['controle', '90. la source avant l''explication', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, 'x', null, null)$q$, '22023', 'La source de l''exercice précédent est l''exercice validé, un repère annuel, ou aucune.'],
    array['controle', '91. refus 7 : aucune explication', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, 'validee', null, null)$q$, '22023', 'Une explication se rédige : elle ne peut pas être vide.'],
    array['controle', '92. des blancs', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, 'validee', '{BLANCS}', null)$q$, '22023', 'Une explication se rédige : elle ne peut pas être vide.'],
    array['controle', '93. une espace insécable est une explication', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, 'validee', '{NBSP}', null)$q$, 'OK', ''],
    array['controle', '94. 4 000 caractères passent', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, 'validee', '{E4000}', null)$q$, 'OK', ''],
    array['controle', '95. 4 001 non', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, 'validee', '{E4001}', null)$q$, '22023', 'Une explication tient en 4 000 caractères au plus.'],
    array['controle', '96. refus 7 avant 8 : l''explication avant la source', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, null, 'aucune', null, null)$q$, '22023', 'Une explication se rédige : elle ne peut pas être vide.'],

    -- ══ Expliquer : la source de l'exercice précédent (refus 8) ══════════
    array['controle', '97. A, un compte : l''exercice validé, pas rien', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, null, 'aucune', 'ESSAI', null)$q$, '22023', 'L''exercice 2024 est validé : la comparaison se fait à ce qu''il a validé.'],
    array['controle', '98. ni un repère, jamais pour un compte', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, -10000, 'reference', 'ESSAI', null)$q$, '22023', 'L''exercice 2024 est validé : la comparaison se fait à ce qu''il a validé.'],
    array['controle', '99. A, un poste : la 2035 validée, pas un repère', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', 'Achats', 'depense', 1000, 1200.50, 'reference', 'ESSAI', null)$q$, '22023', 'L''exercice 2024 est validé : la comparaison se fait à ce qu''il a validé.'],
    array['controle', '100. B, un total porté par un repère : le repère, pas rien', 'chef', $q$select expliquer_variation('{B}', 2025, 'total_2035', 'recettes', null, 500, null, 'aucune', 'ESSAI', null)$q$, '22023', 'Un repère annuel de 2024 porte cette ligne : la comparaison se fait à lui.'],
    array['controle', '101. ni l''exercice, qui n''est pas validé', 'chef', $q$select expliquer_variation('{B}', 2025, 'total_2035', 'recettes', null, 500, 9000, 'validee', 'ESSAI', null)$q$, '22023', 'Un repère annuel de 2024 porte cette ligne : la comparaison se fait à lui.'],
    array['controle', '102. B, le total des dépenses : aucun repère ne le porte', 'chef', $q$select expliquer_variation('{B}', 2025, 'total_2035', 'depenses', null, 0, 0, 'reference', 'ESSAI', null)$q$, '22023', 'L''exercice 2024 n''offre rien à comparer à cette ligne.'],
    array['controle', '103. un poste de recettes non plus', 'chef', $q$select expliquer_variation('{B}', 2025, 'poste_2035', 'Loyers et charges locatives', 'recette', 0, 2400, 'reference', 'ESSAI', null)$q$, '22023', 'L''exercice 2024 n''offre rien à comparer à cette ligne.'],
    array['controle', '104. un repère hors des bornes n''en est pas un', 'chef', $q$select expliquer_variation('{B}', 2025, 'poste_2035', 'Énorme', 'depense', 0, 0, 'reference', 'ESSAI', null)$q$, '22023', 'L''exercice 2024 n''offre rien à comparer à cette ligne.'],
    array['controle', '105. et sans source, il s''explique', 'chef', $q$select expliquer_variation('{B}', 2025, 'poste_2035', 'Énorme', 'depense', 0, null, 'aucune', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '106. un repère NaN n''en est pas un', 'chef', $q$select expliquer_variation('{B}', 2025, 'poste_2035', 'Achats', 'depense', 0, null, 'aucune', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '107. B, un compte : l''exercice précédent n''est pas validé, jamais recalculé', 'chef', $q$select expliquer_variation('{B}', 2025, 'compte', '706000', null, -500, -300, 'validee', 'ESSAI', null)$q$, '22023', 'L''exercice 2024 n''offre rien à comparer à cette ligne.'],
    array['controle', '108. C, validé en engagement : un total passe au repère', 'chef', $q$select expliquer_variation('{C}', 2025, 'total_2035', 'recettes', null, 800, 7000, 'validee', 'ESSAI', null)$q$, '22023', 'Un repère annuel de 2024 porte cette ligne : la comparaison se fait à lui.'],
    array['controle', '109. le repère du chiffre d''affaires', 'chef', $q$select expliquer_variation('{C}', 2025, 'total_2035', 'recettes', null, 800, 7000, 'reference', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '110. aucun résultat au repère : rien à comparer', 'chef', $q$select expliquer_variation('{C}', 2025, 'total_2035', 'resultat', null, 800, 7000, 'reference', 'ESSAI', null)$q$, '22023', 'L''exercice 2024 n''offre rien à comparer à cette ligne.'],
    array['controle', '111. C, un compte : l''exercice validé, quel que soit son modèle', 'chef', $q$select expliquer_variation('{C}', 2025, 'compte', '706000', null, -800, null, 'aucune', 'ESSAI', null)$q$, '22023', 'L''exercice 2024 est validé : la comparaison se fait à ce qu''il a validé.'],
    array['controle', '112. et il s''y compare', 'chef', $q$select expliquer_variation('{C}', 2025, 'compte', '706000', null, -800, -700, 'validee', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '113. D, une 2035 validée illisible reste la source', 'chef', $q$select expliquer_variation('{D}', 2025, 'total_2035', 'resultat', null, 0, 0, 'reference', 'ESSAI', null)$q$, '22023', 'L''exercice 2024 est validé : la comparaison se fait à ce qu''il a validé.'],
    array['controle', '114. refus 8 avant 9 : la source avant le montant', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, 1, null, 'aucune', 'ESSAI', null)$q$, '22023', 'L''exercice 2024 est validé : la comparaison se fait à ce qu''il a validé.'],

    -- ══ Expliquer : les montants que la base sait lire (refus 9) ══════════
    array['controle', '115. A, le solde d''un compte a changé', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500, -10000, 'validee', 'ESSAI', null)$q$, '22023', 'Le solde du compte 706000 a changé : au 31/12/2025, il est de 12500,10 € au crédit.'],
    array['controle', '116. au débit', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500, 5799.50, 'validee', 'ESSAI', null)$q$, '22023', 'Le solde du compte 512000 a changé : au 31/12/2025, il est de 2500,10 € au débit.'],
    array['controle', '117. nul', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '101000', null, 1, 0, 'validee', 'ESSAI', null)$q$, '22023', 'Le solde du compte 101000 a changé : au 31/12/2025, il est nul.'],
    array['controle', '118. le solde de l''exercice validé', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.49, 'validee', 'ESSAI', null)$q$, '22023', 'Le solde du compte 512000 au 31/12/2024 n''est pas celui de l''exercice validé : il est de 5799,50 € au débit.'],
    array['controle', '119. au crédit', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, -10000.01, 'validee', 'ESSAI', null)$q$, '22023', 'Le solde du compte 706000 au 31/12/2024 n''est pas celui de l''exercice validé : il est de 10000,00 € au crédit.'],
    array['controle', '120. un compte sans écriture, nul des deux côtés', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '101000', null, 0, 0, 'validee', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '121. A, une ligne de la 2035 validée de 2024', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', 'Loyers et charges locatives', 'depense', 9000, 3000.01, 'validee', 'ESSAI', null)$q$, '22023', 'La 2035 validée de 2024 porte un autre montant sur cette ligne : 3000,00 €.'],
    array['controle', '122. un poste qu''elle ne porte pas vaut zéro', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', 'Frais de déplacement', 'depense', 450, 5, 'validee', 'ESSAI', null)$q$, '22023', 'La 2035 validée de 2024 porte un autre montant sur cette ligne : 0,00 €.'],
    array['controle', '123. et s''y compare', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', 'Frais de déplacement', 'depense', 450, 0, 'validee', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '124. la nature compte : les honoraires ne sont pas une dépense', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', 'Honoraires', 'depense', 12500.10, 10000, 'validee', 'ESSAI', null)$q$, '22023', 'La 2035 validée de 2024 porte un autre montant sur cette ligne : 0,00 €.'],
    array['controle', '125. le total des recettes', 'chef', $q$select expliquer_variation('{A}', 2025, 'total_2035', 'recettes', null, 12500.10, 10000.01, 'validee', 'ESSAI', null)$q$, '22023', 'La 2035 validée de 2024 porte un autre montant sur cette ligne : 10000,00 €.'],
    array['controle', '126. celui des dépenses', 'chef', $q$select expliquer_variation('{A}', 2025, 'total_2035', 'depenses', null, 10000, 4200.50, 'validee', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '127. le montant d''une ligne de la 2035 d''un exercice NON validé se garde tel que l''écran l''a montré', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', 'Achats', 'depense', 123.45, 1200.50, 'validee', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '128. B, le repère du chiffre d''affaires, au centime de Math.round', 'chef', $q$select expliquer_variation('{B}', 2025, 'total_2035', 'recettes', null, 500, 9000.01, 'reference', 'ESSAI', null)$q$, '22023', 'Le repère annuel de 2024 porte un autre montant sur cette ligne : 9000,00 €.'],
    array['controle', '129. le résultat du repère, négatif', 'chef', $q$select expliquer_variation('{B}', 2025, 'total_2035', 'resultat', null, 200, -1234.57, 'reference', 'ESSAI', null)$q$, '22023', 'Le repère annuel de 2024 porte un autre montant sur cette ligne : -1234,56 €.'],
    array['controle', '130. et juste', 'chef', $q$select expliquer_variation('{B}', 2025, 'total_2035', 'resultat', null, 200, -1234.56, 'reference', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '131. un poste de dépenses du repère', 'chef', $q$select expliquer_variation('{B}', 2025, 'poste_2035', 'Loyers et charges locatives', 'depense', 3000, 2399.99, 'reference', 'ESSAI', null)$q$, '22023', 'Le repère annuel de 2024 porte un autre montant sur cette ligne : 2400,00 €.'],
    array['controle', '132. D, la 2035 validée de 2024 ne se relit pas', 'chef', $q$select expliquer_variation('{D}', 2025, 'total_2035', 'resultat', null, 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'La 2035 validée de 2024 ne se relit pas.'],
    array['controle', '133. pour un poste non plus', 'chef', $q$select expliquer_variation('{D}', 2025, 'poste_2035', 'Achats', 'depense', 0, 0, 'validee', 'ESSAI', null)$q$, '22023', 'La 2035 validée de 2024 ne se relit pas.'],
    array['controle', '134. un compte de D se compare à l''exercice validé', 'chef', $q$select expliquer_variation('{D}', 2025, 'compte', '512000', null, 0, 0, 'validee', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '135. E, 2025 validé : sa 2035 fait foi, deux entrées d''un même poste additionnées', 'chef', $q$select expliquer_variation('{E}', 2025, 'poste_2035', 'Loyers et charges locatives', 'depense', 1500.25, 1000, 'validee', 'ESSAI', null)$q$, '22023', 'La 2035 validée de 2025 porte un autre montant sur cette ligne : 1500,50 €.'],
    array['controle', '136. l''exercice avant le précédent', 'chef', $q$select expliquer_variation('{E}', 2025, 'poste_2035', 'Loyers et charges locatives', 'depense', 1500.25, 999, 'validee', 'ESSAI', null)$q$, '22023', 'La 2035 validée de 2025 porte un autre montant sur cette ligne : 1500,50 €.'],
    array['controle', '137. puis le précédent', 'chef', $q$select expliquer_variation('{E}', 2025, 'poste_2035', 'Loyers et charges locatives', 'depense', 1500.50, 999, 'validee', 'ESSAI', null)$q$, '22023', 'La 2035 validée de 2024 porte un autre montant sur cette ligne : 1000,00 €.'],
    array['controle', '138. un résultat négatif', 'chef', $q$select expliquer_variation('{E}', 2025, 'total_2035', 'resultat', null, -1500.49, -1000, 'validee', 'ESSAI', null)$q$, '22023', 'La 2035 validée de 2025 porte un autre montant sur cette ligne : -1500,50 €.'],
    array['controle', '139. tout juste', 'chef', $q$select expliquer_variation('{E}', 2025, 'total_2035', 'resultat', null, -1500.50, -1000, 'validee', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '140. F, la 2035 validée de l''exercice ne se relit pas', 'chef', $q$select expliquer_variation('{F}', 2025, 'poste_2035', 'Achats', 'depense', 1, null, 'aucune', 'ESSAI', null)$q$, '22023', 'La 2035 validée de 2025 ne se relit pas.'],
    array['controle', '141. un compte de F, si', 'chef', $q$select expliquer_variation('{F}', 2025, 'compte', '512000', null, 0, null, 'aucune', 'ESSAI', null)$q$, 'OK', ''],

    -- ══ Expliquer : ce qui s'écrit, et la chaîne d'une ligne (refus 10) ══════════
    array['fait', '142. la première explication du 706000 de A', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, -10000, 'validee', 'ESSAI X1', null)$q$, 'OK', ''],
    array['valeur', '143. ce qui s''écrit : la ligne, les montants, la source, l''auteur', 'postgres', $q$select objet_type || '/' || objet || '/' || coalesce(nature, 'nul') || '/' || montant::text || '/' || montant_precedent::text || '/' || source_precedent || '/' || (auteur = '{CHEF}')::text || '/' || coalesce(remplace_id::text, 'nul') from revision_explications where explication = 'ESSAI X1'$q$, '', 'compte/706000/nul/-12500.10/-10000.00/validee/true/nul'],
    array['controle', '144. refus 10 : une seconde première explication de la ligne', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, -10000, 'validee', 'ESSAI', null)$q$, '22023', 'Une autre explication a été donnée sur cette ligne depuis : relire avant d''expliquer.'],
    array['fait', '145. la seconde remplace la courante', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, -10000, 'validee', 'ESSAI X2', (select id from revision_explications where explication = 'ESSAI X1'))$q$, 'OK', ''],
    array['controle', '146. remplacer la première, qui n''est plus la courante', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, -10000, 'validee', 'ESSAI', (select id from revision_explications where explication = 'ESSAI X1'))$q$, '22023', 'Une autre explication a été donnée sur cette ligne depuis : relire avant d''expliquer.'],
    array['fait', '147. une explication du résultat de A', 'chef', $q$select expliquer_variation('{A}', 2025, 'total_2035', 'resultat', null, 2500.10, 5799.50, 'validee', 'ESSAI X3', null)$q$, 'OK', ''],
    array['controle', '148. une seconde première explication d''un total : deux natures nulles se heurtent', 'chef', $q$select expliquer_variation('{A}', 2025, 'total_2035', 'resultat', null, 2500.10, 5799.50, 'validee', 'ESSAI', null)$q$, '22023', 'Une autre explication a été donnée sur cette ligne depuis : relire avant d''expliquer.'],
    array['controle', '149. remplacer l''explication d''une autre ligne', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, -10000, 'validee', 'ESSAI', (select id from revision_explications where explication = 'ESSAI X3'))$q$, '22023', 'L''explication à remplacer n''est pas une explication de cette ligne pour l''exercice 2025.'],
    array['controle', '149bis. ni celle d''un autre compte', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, 'validee', 'ESSAI', (select id from revision_explications where explication = 'ESSAI X1'))$q$, '22023', 'L''explication à remplacer n''est pas une explication de cette ligne pour l''exercice 2025.'],
    array['fait', '150. une explication de 2024, sans source', 'chef', $q$select expliquer_variation('{A}', 2024, 'compte', '706000', null, -10000, null, 'aucune', 'ESSAI X2024', null)$q$, 'OK', ''],
    array['controle', '151. remplacer l''explication d''un autre exercice', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, -10000, 'validee', 'ESSAI', (select id from revision_explications where explication = 'ESSAI X2024'))$q$, '22023', 'L''explication à remplacer n''est pas une explication de cette ligne pour l''exercice 2025.'],
    array['controle', '152. d''un autre dossier', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, -10000, 'validee', 'ESSAI', '{XDC}')$q$, '22023', 'L''explication à remplacer n''est pas une explication de cette ligne pour l''exercice 2025.'],
    array['fait', '152bis. une explication du résultat de B pour 2025', 'chef', $q$select expliquer_variation('{B}', 2025, 'total_2035', 'resultat', null, 200, -1234.56, 'reference', 'ESSAI XB', null)$q$, 'OK', ''],
    array['controle', '152ter. ni d''un autre dossier, sur la même ligne du même exercice', 'chef', $q$select expliquer_variation('{A}', 2025, 'total_2035', 'resultat', null, 2500.10, 5799.50, 'validee', 'ESSAI', (select id from revision_explications where explication = 'ESSAI XB'))$q$, '22023', 'L''explication à remplacer n''est pas une explication de cette ligne pour l''exercice 2025.'],
    array['controle', '153. une explication qui n''existe pas', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, -10000, 'validee', 'ESSAI', '{ABSENT}')$q$, '22023', 'L''explication à remplacer n''est pas une explication de cette ligne pour l''exercice 2025.'],
    array['controle', '154. remplacer la courante passe', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -12500.10, -10000, 'validee', 'ESSAI', (select id from revision_explications where explication = 'ESSAI X2'))$q$, 'OK', ''],
    array['controle', '155. refus 9 avant 10 : le montant avant le remplacement', 'chef', $q$select expliquer_variation('{A}', 2025, 'compte', '706000', null, -1, -10000, 'validee', 'ESSAI', '{ABSENT}')$q$, '22023', 'Le solde du compte 706000 a changé : au 31/12/2025, il est de 12500,10 € au crédit.'],
    array['controle', '155bis. la fonction rend l''explication écrite', 'chef', $q$do $x$ declare r public.revision_explications; begin
      r := expliquer_variation('{A}', 2024, 'compte', '512000', null, 5799.50, null, 'aucune', 'ESSAI RENDU', null);
      if r.id is null or r.dossier_id <> '{A}' or r.annee <> 2024 or r.objet_type <> 'compte' or r.objet <> '512000' or r.nature is not null
         or r.montant <> 5799.50 or r.montant_precedent is not null or r.source_precedent <> 'aucune' or r.explication <> 'ESSAI RENDU'
         or r.auteur <> '{CHEF}' or r.remplace_id is not null or r.cree_le is null then raise exception 'RENDU %', r; end if;
    end $x$$q$, 'OK', ''],
    array['valeur', '156. la chaîne de la ligne : deux explications, la courante remplace la première', 'postgres', $q$select count(*)::text || '/' || (select e.explication from revision_explications e where e.dossier_id = '{A}' and e.annee = 2025 and e.objet = '706000' and not exists (select 1 from revision_explications r where r.remplace_id = e.id)) from revision_explications where dossier_id = '{A}' and annee = 2025 and objet = '706000'$q$, '', '2/ESSAI X2'],
    array['fait', '157. l''explication d''un poste de recettes', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', 'Honoraires', 'recette', 12500.10, 10000, 'validee', 'ESSAI X4', null)$q$, 'OK', ''],
    array['controle', '157ter. elle ne se remplace pas depuis la même ligne d''une autre nature', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', 'Honoraires', 'depense', 12500.10, 0, 'validee', 'ESSAI', (select id from revision_explications where explication = 'ESSAI X4'))$q$, '22023', 'L''explication à remplacer n''est pas une explication de cette ligne pour l''exercice 2025.'],
    array['controle', '157quater. et la même ligne d''une autre nature a sa propre chaîne : sa première ne remplace rien', 'chef', $q$select expliquer_variation('{A}', 2025, 'poste_2035', 'Honoraires', 'depense', 12500.10, 0, 'validee', 'ESSAI', null)$q$, 'OK', ''],
    array['valeur', '157bis. elle porte sa nature', 'postgres', $q$select objet_type || '/' || objet || '/' || nature || '/' || montant::text || '/' || montant_precedent::text || '/' || source_precedent from revision_explications where explication = 'ESSAI X4'$q$, '', 'poste_2035/Honoraires/recette/12500.10/10000.00/validee'],

    -- ══ Un membre affecté, puis le chef d'un autre cabinet ══════════
    array['jeu', 'le client devient membre du cabinet J, affecté à J1 seulement, sans être super-administrateur', 'postgres', $q$insert into cabinet_admins (user_id, cabinet_id, role) values ('{CLIENT}', '{CJ}', 'comptable')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into dossier_assignations (dossier_id, user_id) values ('{J1}', '{CLIENT}')$q$, '', ''],
    array['fait', '158. le collaborateur affecté fixe le seuil de J1 (hypothèse Q2)', 'collaborateur', $q$select fixer_seuil_de_signification('{J1}', 2025, 300, 'ESSAI J1', null)$q$, 'OK', ''],
    array['fait', '159. et y explique une variation', 'collaborateur', $q$select expliquer_variation('{J1}', 2025, 'compte', '512000', null, 0, null, 'aucune', 'ESSAI J1', null)$q$, 'OK', ''],
    array['valeur', '159bis. ce qu''il écrit porte son nom', 'postgres', $q$select (select (auteur = '{CLIENT}')::text from revision_seuils where motif = 'ESSAI J1') || '/' || (select (auteur = '{CLIENT}')::text from revision_explications where explication = 'ESSAI J1')$q$, '', 'true/true'],
    array['controle', '160. pas dans J2, qui ne lui est pas confié : le seuil', 'collaborateur', $q$select fixer_seuil_de_signification('{J2}', 2025, 300, 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '161. ni une explication', 'collaborateur', $q$select expliquer_variation('{J2}', 2025, 'compte', '512000', null, 0, null, 'aucune', 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '162. ni dans A', 'collaborateur', $q$select fixer_seuil_de_signification('{A}', 2025, 300, 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '163. il n''écrit pas en direct, même dans J1', 'collaborateur', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, auteur) values ('{J1}', 2024, 300, 'ESSAI', '{CLIENT}')$q$, '42501', 'new row violates row-level security policy for table "revision_seuils"'],
    array['controle', '164. il lit la revue de J1, rien ailleurs', 'collaborateur', $q$do $x$ begin
      if (select count(*) from revision_seuils where dossier_id = '{J1}') <> 1 or (select count(*) from revision_explications where dossier_id = '{J1}') <> 1 then raise exception 'PAS VU'; end if;
      if exists (select 1 from revision_seuils where dossier_id <> '{J1}') or exists (select 1 from revision_explications where dossier_id <> '{J1}') then raise exception 'VU AILLEURS'; end if;
    end $x$$q$, 'OK', ''],
    array['jeu', 'le même compte devient le chef du cabinet jetable, sans être super-administrateur', 'postgres', $q$update cabinet_admins set role = 'comptable_en_chef' where user_id = '{CLIENT}' and cabinet_id = '{CJ}'$q$, '', ''],
    array['fait', '165. le chef du cabinet fixe le seuil de J2, qui ne lui est pas affecté : un chef voit tout son cabinet', 'chefj', $q$select fixer_seuil_de_signification('{J2}', 2025, 400, 'ESSAI J2', null)$q$, 'OK', ''],
    array['controle', '166. et y explique', 'chefj', $q$select expliquer_variation('{J2}', 2025, 'total_2035', 'resultat', null, 0, null, 'aucune', 'ESSAI', null)$q$, 'OK', ''],
    array['controle', '167. mais rien dans A, d''un autre cabinet', 'chefj', $q$select expliquer_variation('{A}', 2025, 'compte', '512000', null, 2500.10, 5799.50, 'validee', 'ESSAI', null)$q$, '42501', 'Accès refusé à ce dossier.'],

    -- ══ La restauration, et ce que les gardes et les contraintes refusent ══════════
    array['controle', '168. le super-administrateur réinsère un seuil', 'chef', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, auteur) values ('{A}', 2023, 100, 'ESSAI', '{CHEF}')$q$, 'OK', ''],
    array['controle', '169. et une explication', 'chef', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, nature, montant, montant_precedent, source_precedent, explication, auteur) values ('{A}', 2023, 'poste_2035', 'Achats', 'depense', 10, null, 'aucune', 'ESSAI', '{CHEF}')$q$, 'OK', ''],
    array['controle', '170. jamais un seuil qui en remplace un d''un autre exercice', 'chef', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, remplace_id, auteur) values ('{A}', 2025, 100, 'ESSAI', (select id from revision_seuils where motif = 'ESSAI S2024'), '{CHEF}')$q$, '23514', 'Un seuil en remplace un du même exercice, dans le même dossier.'],
    array['controle', '171. ni d''un autre dossier', 'chef', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, remplace_id, auteur) values ('{A}', 2001, 100, 'ESSAI', '{SDC}', '{CHEF}')$q$, '23514', 'Un seuil en remplace un du même exercice, dans le même dossier.'],
    array['controle', '172. jamais une explication qui en remplace une d''une autre ligne', 'chef', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, montant_precedent, source_precedent, explication, remplace_id, auteur) values ('{A}', 2025, 'compte', '512000', 0, 0, 'validee', 'ESSAI', (select id from revision_explications where explication = 'ESSAI X1'), '{CHEF}')$q$, '23514', 'Une explication en remplace une de la même ligne, pour le même exercice.'],
    array['controle', '173. d''une autre nature', 'chef', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, nature, montant, montant_precedent, source_precedent, explication, remplace_id, auteur) values ('{A}', 2025, 'poste_2035', 'Honoraires', 'depense', 0, 0, 'validee', 'ESSAI', (select id from revision_explications where explication = 'ESSAI X4'), '{CHEF}')$q$, '23514', 'Une explication en remplace une de la même ligne, pour le même exercice.'],
    array['controle', '174. d''un autre exercice', 'chef', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, remplace_id, auteur) values ('{A}', 2024, 'compte', '706000', 0, 'aucune', 'ESSAI', (select id from revision_explications where explication = 'ESSAI X1'), '{CHEF}')$q$, '23514', 'Une explication en remplace une de la même ligne, pour le même exercice.'],
    array['controle', '175. ou d''un autre dossier', 'chef', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, remplace_id, auteur) values ('{A}', 2001, 'total_2035', 'resultat', 0, 'aucune', 'ESSAI', '{XDC}', '{CHEF}')$q$, '23514', 'Une explication en remplace une de la même ligne, pour le même exercice.'],
    array['controle', '176. un second premier seuil', 'postgres', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, auteur) values ('{A}', 2025, 100, 'ESSAI', '{CHEF}')$q$, '23505', 'duplicate key value violates unique constraint "revision_seuils_un_premier"'],
    array['controle', '177. deux suites d''un même seuil', 'postgres', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, remplace_id, auteur) values ('{A}', 2025, 100, 'ESSAI', (select id from revision_seuils where motif = 'ESSAI S1'), '{CHEF}')$q$, '23505', 'duplicate key value violates unique constraint "revision_seuils_une_suite"'],
    array['controle', '178. une seconde première explication d''un total', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, montant_precedent, source_precedent, explication, auteur) values ('{A}', 2025, 'total_2035', 'resultat', 0, 0, 'validee', 'ESSAI', '{CHEF}')$q$, '23505', 'duplicate key value violates unique constraint "revision_explications_une_premiere"'],
    array['controle', '179. deux suites d''une même explication', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, montant_precedent, source_precedent, explication, remplace_id, auteur) values ('{A}', 2025, 'compte', '706000', 0, 0, 'validee', 'ESSAI', (select id from revision_explications where explication = 'ESSAI X1'), '{CHEF}')$q$, '23505', 'duplicate key value violates unique constraint "revision_explications_une_suite"'],
    array['controle', '180. un seuil : un exercice avant 2000', 'postgres', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, auteur) values ('{A}', 1999, 100, 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_seuils_annee"'],
    array['controle', '181. un seuil nul', 'postgres', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, auteur) values ('{A}', 2022, 0, 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_seuils_seuil"'],
    array['controle', '182. un seuil NaN', 'postgres', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, auteur) values ('{A}', 2022, 'NaN', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_seuils_seuil"'],
    array['controle', '183. un motif de blancs', 'postgres', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, auteur) values ('{A}', 2022, 100, '{BLANCS}', '{CHEF}')$q$, '23514', '%"revision_seuils_motif"'],
    array['controle', '184. un motif de 4 001 caractères', 'postgres', $q$insert into revision_seuils (dossier_id, annee, seuil, motif, auteur) values ('{A}', 2022, 100, '{M4001}', '{CHEF}')$q$, '23514', '%"revision_seuils_motif"'],
    array['controle', '185. une explication : un exercice après 2100', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, auteur) values ('{A}', 2101, 'compte', '512000', 0, 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_annee"'],
    array['controle', '186. un type d''objet inconnu', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'ligne', '512000', 0, 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_objet_type"'],
    array['controle', '187. une nature inconnue', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, nature, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'poste_2035', 'Achats', 'charge', 0, 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_nature"'],
    array['controle', '188. un montant NaN', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'compte', '512000', 'NaN', 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_montant"'],
    array['controle', '189. un montant précédent NaN', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, montant_precedent, source_precedent, explication, auteur) values ('{A}', 2022, 'compte', '512000', 0, 'NaN', 'validee', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_montant_precedent"'],
    array['controle', '190. une source inconnue', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, montant_precedent, source_precedent, explication, auteur) values ('{A}', 2022, 'compte', '512000', 0, 0, 'calculee', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_source_precedent"'],
    array['controle', '191. une explication de blancs', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'compte', '512000', 0, 'aucune', '{BLANCS}', '{CHEF}')$q$, '23514', '%"revision_explications_explication"'],
    array['controle', '192. une explication de 4 001 caractères', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'compte', '512000', 0, 'aucune', '{E4001}', '{CHEF}')$q$, '23514', '%"revision_explications_explication"'],
    array['controle', '193. un poste de blancs', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, nature, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'poste_2035', '{BLANCS}', 'depense', 0, 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_objet"'],
    array['controle', '194. un poste de 501 caractères', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, nature, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'poste_2035', '{P501}', 'depense', 0, 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_objet"'],
    array['controle', '195. un poste sans nature', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'poste_2035', 'Achats', 0, 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_objet"'],
    array['controle', '196. un total inconnu', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'total_2035', 'benefice', 0, 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_objet"'],
    array['controle', '197. un total avec une nature', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, nature, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'total_2035', 'resultat', 'recette', 0, 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_objet"'],
    array['controle', '198. un compte de classe 8', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'compte', '801000', 0, 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_objet"'],
    array['controle', '199. un compte avec une nature', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, nature, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'compte', '512000', 'depense', 0, 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_objet"'],
    array['controle', '200. sans source, un montant précédent', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, montant_precedent, source_precedent, explication, auteur) values ('{A}', 2022, 'compte', '512000', 0, 0, 'aucune', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_precedent"'],
    array['controle', '201. une source sans montant précédent', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, source_precedent, explication, auteur) values ('{A}', 2022, 'compte', '512000', 0, 'validee', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_precedent"'],
    array['controle', '202. un compte comparé à un repère', 'postgres', $q$insert into revision_explications (dossier_id, annee, objet_type, objet, montant, montant_precedent, source_precedent, explication, auteur) values ('{A}', 2022, 'compte', '512000', 0, 0, 'reference', 'ESSAI', '{CHEF}')$q$, '23514', '%"revision_explications_compte_sans_repere"'],

    -- ══ Les fonctions internes, sur des valeurs relevées ══════════
    -- Le module les refait (`centimesDuNavigateur`, `centimesDeLa2035Validee`, `centimesDuRepereAnnuel`, `sourceDuPrecedent`) :
    -- `revueAnalytiqueEssai.test.ts` lit ces listes et exige du module la même valeur, octet pour octet.
    array['valeur', '203. les centimes d''un montant, comme Math.round', 'postgres', $q$select string_agg(coalesce(centimes_du_navigateur(v.x)::text, 'nul'), '/' order by v.i) from unnest(array['1.005', '0.125', '2.675', '-2.675', '-0.005', '-0.004', '99999999999999.99', '99999999999999.999', '100000000000000', 'NaN', '1e400', '1234.565', '-1234.565', '0', '12.5', '9000.004', '-0.5', '0.015', '1e-7']::numeric[]) with ordinality as v(x, i)$q$, '',
      '100/13/268/-267/0/0/9999999999999998/nul/nul/nul/nul/123457/-123456/0/1250/900000/-50/2/0'],
    array['valeur', '204. une ligne d''une 2035 validée : un poste, sa nature, un total ; zéro pour un poste absent ; nul quand elle ne se relit pas', 'postgres', $q$select string_agg(coalesce(centimes_de_la_2035_validee(v.j::jsonb, v.t, v.o, v.n)::text, 'nul'), '/' order by v.i) from (values
      (1, '{"postes":[{"poste":"A","nature":"depense","montant":1.5},{"poste":"A","nature":"depense","montant":0.25},{"poste":"A","nature":"recette","montant":9}],"totalRecettes":9,"totalDepenses":1.75,"resultat":7.25}', 'poste_2035', 'A', 'depense'),
      (2, '{"postes":[{"poste":"A","nature":"depense","montant":1.5}],"totalRecettes":9,"totalDepenses":1.75,"resultat":7.25}', 'poste_2035', 'A', 'recette'),
      (3, '{"postes":[],"totalRecettes":9,"totalDepenses":1.75,"resultat":-7.255}', 'total_2035', 'resultat', null),
      (4, '{"postes":[],"totalRecettes":9.999,"totalDepenses":1.75,"resultat":7.25}', 'total_2035', 'recettes', null),
      (5, '{"postes":[],"totalRecettes":9,"totalDepenses":1.75,"resultat":7.25}', 'total_2035', 'depenses', null),
      (6, '{"postes":[],"totalRecettes":"9","totalDepenses":1.75,"resultat":7.25}', 'total_2035', 'depenses', null),
      (7, '{"postes":[],"totalRecettes":9,"resultat":7.25}', 'total_2035', 'recettes', null),
      (8, '{"postes":{},"totalRecettes":9,"totalDepenses":1.75,"resultat":7.25}', 'total_2035', 'recettes', null),
      (9, '{"postes":[{"poste":"A","nature":"charge","montant":1}],"totalRecettes":9,"totalDepenses":1.75,"resultat":7.25}', 'total_2035', 'recettes', null),
      (10, '{"postes":[{"poste":1,"nature":"depense","montant":1}],"totalRecettes":9,"totalDepenses":1.75,"resultat":7.25}', 'total_2035', 'recettes', null),
      (11, '{"postes":[{"poste":"A","nature":"depense","montant":"1"}],"totalRecettes":9,"totalDepenses":1.75,"resultat":7.25}', 'total_2035', 'recettes', null),
      (12, '{"postes":[{"poste":"A","nature":"depense","montant":1e14}],"totalRecettes":9,"totalDepenses":1.75,"resultat":7.25}', 'total_2035', 'recettes', null),
      (13, '{"postes":[{"poste":"A","nature":"depense"}],"totalRecettes":9,"totalDepenses":1.75,"resultat":7.25}', 'total_2035', 'recettes', null),
      (14, '{"postes":["A"],"totalRecettes":9,"totalDepenses":1.75,"resultat":7.25}', 'total_2035', 'recettes', null),
      (15, '["postes"]', 'total_2035', 'recettes', null),
      (16, '{"postes":[],"totalRecettes":9,"totalDepenses":1.75,"resultat":7.25,"autre":"x"}', 'poste_2035', 'Inconnu', 'depense'),
      (17, '{"postes":[{"poste":"A","nature":"depense","montant":-2.5}],"totalRecettes":0,"totalDepenses":-2.5,"resultat":2.5}', 'poste_2035', 'A', 'depense'),
      (18, '{"postes":[{"poste":"A","montant":1}],"totalRecettes":0,"totalDepenses":1,"resultat":-1}', 'total_2035', 'recettes', null),
      (19, '{"postes":[{"poste":"a","nature":"depense","montant":2},{"poste":"A","nature":"depense","montant":1.5}],"totalRecettes":0,"totalDepenses":3.5,"resultat":-3.5}', 'poste_2035', 'A', 'depense')
    ) as v(i, j, t, o, n)$q$, '',
      '175/0/-725/1000/175/nul/nul/nul/nul/nul/nul/nul/nul/nul/nul/0/-250/nul/150'],
    array['valeur', '205. une ligne d''un repère : un poste de dépenses, le chiffre d''affaires, le résultat — rien d''autre', 'postgres', $q$select string_agg(coalesce(centimes_du_repere_annuel(v.d::uuid, v.a, v.t, v.o, v.n)::text, 'nul'), '/' order by v.i) from (values
      (1, '{B}', 2024, 'poste_2035', 'Loyers et charges locatives', 'depense'), (2, '{B}', 2024, 'poste_2035', 'Loyers et charges locatives', 'recette'),
      (3, '{B}', 2024, 'poste_2035', 'Énorme', 'depense'), (4, '{B}', 2024, 'poste_2035', 'Achats', 'depense'),
      (5, '{B}', 2024, 'poste_2035', 'loyers et charges locatives', 'depense'), (6, '{B}', 2024, 'total_2035', 'recettes', null),
      (7, '{B}', 2024, 'total_2035', 'resultat', null), (8, '{B}', 2024, 'total_2035', 'depenses', null),
      (9, '{B}', 2023, 'total_2035', 'recettes', null), (10, '{C}', 2024, 'total_2035', 'recettes', null),
      (11, '{C}', 2024, 'total_2035', 'resultat', null), (12, '{B}', 2024, 'compte', '706000', null)
    ) as v(i, d, a, t, o, n)$q$, '',
      '240000/nul/nul/nul/nul/900000/-123456/nul/nul/700000/nul/nul'],
    array['valeur', '206. la source de l''exercice précédent, ligne par ligne', 'postgres', $q$select string_agg(source_du_precedent(v.d::uuid, v.a, v.t, v.o, v.n), '/' order by v.i) from (values
      (1, '{A}', 2025, 'compte', '512000', null), (2, '{A}', 2025, 'poste_2035', 'Inconnu', 'depense'), (3, '{A}', 2025, 'total_2035', 'resultat', null),
      (4, '{A}', 2024, 'compte', '512000', null), (5, '{B}', 2025, 'compte', '512000', null), (6, '{B}', 2025, 'total_2035', 'recettes', null),
      (7, '{B}', 2025, 'total_2035', 'depenses', null), (8, '{B}', 2025, 'poste_2035', 'Loyers et charges locatives', 'depense'),
      (9, '{B}', 2025, 'poste_2035', 'Achats', 'depense'), (10, '{C}', 2025, 'total_2035', 'recettes', null), (11, '{C}', 2025, 'total_2035', 'resultat', null),
      (12, '{C}', 2025, 'compte', '706000', null), (13, '{D}', 2025, 'poste_2035', 'Achats', 'depense'), (14, '{E}', 2026, 'total_2035', 'resultat', null),
      (15, '{F}', 2026, 'compte', '512000', null), (16, '{F}', 2026, 'poste_2035', 'Achats', 'depense')
    ) as v(i, d, a, t, o, n)$q$, '',
      'validee/validee/validee/aucune/aucune/reference/aucune/reference/aucune/reference/aucune/validee/validee/validee/validee/validee'],

    -- ══ Ce que le catalogue dit ══════════
    array['valeur', '207. les déclencheurs : avant la ligne, actifs, sur les trois gestes', 'postgres', $q$select string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || ((t.tgtype & 1) <> 0) || ':' || ((t.tgtype & 2) <> 0) || ':' || ((t.tgtype & 4) <> 0) || ':' || ((t.tgtype & 8) <> 0) || ':' || ((t.tgtype & 16) <> 0) || ':' || t.tgenabled::text || ':' || p.proname, ',' order by t.tgname collate "C") from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid in ('public.revision_seuils'::regclass, 'public.revision_explications'::regclass) and not t.tgisinternal$q$, '',
      'revision_explications:revision_explications_gardes:true:true:true:true:true:O:garder_revision_explication,revision_seuils:revision_seuils_gardes:true:true:true:true:true:O:garder_revision_seuil'],
    array['valeur', '208. lues par le cabinet, réinsérées par le super-administrateur, et rien d''autre ; RLS active', 'postgres', $q$select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename collate "C", policyname collate "C") || '/' || (select string_agg(relname || '=' || relrowsecurity || relforcerowsecurity, ',' order by relname collate "C") from pg_class where oid in ('public.revision_seuils'::regclass, 'public.revision_explications'::regclass)) from pg_policies where schemaname = 'public' and tablename in ('revision_seuils', 'revision_explications')$q$, '',
      'revision_explications:revision_explications_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):,revision_explications:revision_explications_restauration:INSERT:authenticated::is_super_admin(),revision_seuils:revision_seuils_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):,revision_seuils:revision_seuils_restauration:INSERT:authenticated::is_super_admin()/revision_explications=truefalse,revision_seuils=truefalse'],
    array['valeur', '209. les clés : le dossier en cascade, la chaîne sans action', 'postgres', $q$select string_agg(x, ',' order by x collate "C") from (select c.conrelid::regclass::text || '.' || a.attname || '>' || c.confrelid::regclass::text || ':' || c.confdeltype::text as x from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] where c.contype = 'f' and c.conrelid in ('public.revision_seuils'::regclass, 'public.revision_explications'::regclass)) k$q$, '',
      'revision_explications.dossier_id>dossiers:c,revision_explications.remplace_id>revision_explications:a,revision_seuils.dossier_id>dossiers:c,revision_seuils.remplace_id>revision_seuils:a'],
    array['valeur', '210. les fonctions : sécurité, search_path, volatilité, droits de l''anonyme et d''un compte connecté', 'postgres', $q$select string_agg(p.proname || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-') || ':' || p.provolatile::text || ':' || has_function_privilege('anon', p.oid, 'execute') || '/' || has_function_privilege('authenticated', p.oid, 'execute'), ',' order by p.proname collate "C") from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fixer_seuil_de_signification', 'expliquer_variation', 'centimes_du_navigateur', 'centimes_de_la_2035_validee', 'centimes_du_repere_annuel', 'source_du_precedent', 'garder_revision_seuil', 'garder_revision_explication')$q$, '',
      'centimes_de_la_2035_validee:false:search_path=public:s:false/false,centimes_du_navigateur:false:search_path=public:i:false/false,centimes_du_repere_annuel:false:search_path=public:s:false/false,expliquer_variation:true:search_path=public:v:false/true,fixer_seuil_de_signification:true:search_path=public:v:false/true,garder_revision_explication:false:search_path=public:v:false/false,garder_revision_seuil:false:search_path=public:v:false/false,source_du_precedent:false:search_path=public:s:false/false'],
    array['valeur', '211. les index', 'postgres', $q$select string_agg(pg_get_indexdef(i.indexrelid), ' | ' order by pg_get_indexdef(i.indexrelid) collate "C") from pg_index i where i.indrelid in ('public.revision_seuils'::regclass, 'public.revision_explications'::regclass)$q$, '',
      'CREATE INDEX revision_explications_dossier ON public.revision_explications USING btree (dossier_id, annee) | CREATE INDEX revision_seuils_dossier ON public.revision_seuils USING btree (dossier_id, annee) | CREATE UNIQUE INDEX revision_explications_pkey ON public.revision_explications USING btree (id) | CREATE UNIQUE INDEX revision_explications_une_premiere ON public.revision_explications USING btree (dossier_id, annee, objet_type, objet, nature) NULLS NOT DISTINCT WHERE (remplace_id IS NULL) | CREATE UNIQUE INDEX revision_explications_une_suite ON public.revision_explications USING btree (remplace_id) | CREATE UNIQUE INDEX revision_seuils_pkey ON public.revision_seuils USING btree (id) | CREATE UNIQUE INDEX revision_seuils_un_premier ON public.revision_seuils USING btree (dossier_id, annee) WHERE (remplace_id IS NULL) | CREATE UNIQUE INDEX revision_seuils_une_suite ON public.revision_seuils USING btree (remplace_id)'],
    -- Les contraintes de vérification des deux tables, par leur texte (son empreinte : il contient des blancs bruts).
    array['valeur', '212. les contraintes de vérification des deux tables, par leur texte', 'postgres', $q$select count(*) || '/' || string_agg(conname, ',' order by conname collate "C") || '/' || md5(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), E'\n' order by conrelid::regclass::text collate "C", conname collate "C")) from pg_constraint where contype = 'c' and conrelid in ('public.revision_seuils'::regclass, 'public.revision_explications'::regclass)$q$, '',
      '13/revision_explications_annee,revision_explications_compte_sans_repere,revision_explications_explication,revision_explications_montant,revision_explications_montant_precedent,revision_explications_nature,revision_explications_objet,revision_explications_objet_type,revision_explications_precedent,revision_explications_source_precedent,revision_seuils_annee,revision_seuils_motif,revision_seuils_seuil/146faf29a06e9dae8d890a0383553a42'],
    array['valeur', '212bis. les colonnes des deux tables : type, obligation, défaut', 'postgres', $q$select string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',' order by c.relname collate "C", a.attnum) from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid in ('public.revision_seuils'::regclass, 'public.revision_explications'::regclass) and a.attnum > 0 and not a.attisdropped$q$, '',
      'revision_explications.id:uuid:true:gen_random_uuid(),revision_explications.dossier_id:uuid:true:-,revision_explications.annee:integer:true:-,revision_explications.objet_type:text:true:-,revision_explications.objet:text:true:-,revision_explications.nature:text:false:-,revision_explications.montant:numeric(16,2):true:-,revision_explications.montant_precedent:numeric(16,2):false:-,revision_explications.source_precedent:text:true:-,revision_explications.explication:text:true:-,revision_explications.remplace_id:uuid:false:-,revision_explications.auteur:uuid:true:-,revision_explications.cree_le:timestamp with time zone:true:now(),revision_seuils.id:uuid:true:gen_random_uuid(),revision_seuils.dossier_id:uuid:true:-,revision_seuils.annee:integer:true:-,revision_seuils.seuil:numeric(16,2):true:-,revision_seuils.motif:text:true:-,revision_seuils.remplace_id:uuid:false:-,revision_seuils.auteur:uuid:true:-,revision_seuils.cree_le:timestamp with time zone:true:now()'],
    array['valeur', '213. ce que les deux fonctions prennent et rendent', 'postgres', $q$select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid), ' | ' order by p.proname collate "C") from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fixer_seuil_de_signification', 'expliquer_variation')$q$, '',
      'expliquer_variation(p_dossier_id uuid, p_annee integer, p_objet_type text, p_objet text, p_nature text, p_montant numeric, p_montant_precedent numeric, p_source_precedent text, p_explication text, p_remplace_id uuid) -> revision_explications | fixer_seuil_de_signification(p_dossier_id uuid, p_annee integer, p_seuil numeric, p_motif text, p_remplace_id uuid) -> revision_seuils']
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
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, 'nul'), 'ok', coalesce(obs = attendu, false));
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

  -- ══ 214. Rien n'est resté ══════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from revision_seuils)), ((select count(*) from revision_explications)), ((select count(*) from dossiers)),
    ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)), ((select count(*) from dossier_assignations)),
    ((select count(*) from exercices_valides)), ((select count(*) from references_annuelles)),
    ((select count(*) from references_postes_annuels)), ((select count(*) from ecritures_brouillon))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '214. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI REVUE%')
      and not exists (select 1 from cabinets where nom like 'ESSAI REVUE%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.revue', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer (une valeur nulle dans sa comparaison) est une faute, pas un silence. La ligne 0
-- dit le texte que la base a reçu — par l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier
-- par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.revue')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
