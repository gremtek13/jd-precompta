-- LA BANQUE DU CLIENT, ÉPROUVÉE EN BASE (espace client, étape P7) — à rejouer par `execute_sql` après toute migration qui
-- touche `justificatifs_proposes`, `precisions_mouvements`, leurs gardes ou leurs fonctions (`proposer_justificatif`,
-- `retirer_proposition`, `ecrire_precision_mouvement`), `couverture_du_releve`, les policies de lecture de
-- `lignes_bancaires`, `ventilations_bancaires`, `reglements_groupes` ou `controles_releves_bancaires`, `memberships` ou
-- les fonctions des droits (`client_du_dossier`, `gere_la_banque`, `admin_du_dossier`).
--
-- IL SUPPOSE LES DEUX MIGRATIONS DE P7 EN BASE : `banque_du_client` (ce qui s'ajoute) et
-- `lectures_bancaires_au_droit_banque` (le resserrement). Sans la première, il s'arrête (ESSAI_IMPOSSIBLE) ; après la
-- première seule, les contrôles du resserrement (3, 15 et 16) sont en faute — et seulement eux : ils disent ce que la
-- seconde change.
--
-- Ce qui se prouve ici, par impersonation de six profils — anonyme, compte rattaché à rien, client sans droit, client à
-- la case « Ventes » seule, client à la case « Banque », chef du cabinet (super-administrateur) — et d'un septième, le
-- compte client rattaché au cabinet comme membre affecté au dossier, le temps de la fin de l'essai :
--   - le catalogue : les deux tables, leurs policies et leurs gardes ; la lecture du contrôle de solde au droit
--     « Banque » ; les trois lectures resserrées ; les quatre fonctions et leurs droits d'exécution ;
--   - qui LIT : sans la case « Banque » — avec la case « Ventes » seule aussi —, le client ne voit AUCUNE ligne des six
--     tables de la banque, pas même de son dossier ; avec elle, toutes celles de ses dossiers et aucune d'un autre ;
--   - la couverture du relevé : des mois, rendus à tout accès du dossier comme au cabinet, refusés à qui n'y a pas accès ;
--   - qui ÉCRIT : le client à la case « Banque » propose, retire et précise par les SEULES fonctions, l'origine déduite ;
--     chaque refus exigé par son code ET sa RAISON, dans l'ordre des fonctions ; aucune écriture directe ;
--   - les gardes : une proposition ne se modifie que pour être retirée, une fois ; une précision jamais ; une ligne
--     restaurée vise un mouvement et une pièce de son dossier ;
--   - et que RIEN ne reste en base.
--
-- LE JEU : des mouvements, des pièces, une ventilation, un règlement groupé et un contrôle de solde d'essai, dans un
-- dossier du client et dans un autre dossier du cabinet ; les droits du client changés à mesure. Tout se joue dans UNE
-- sous-transaction globale, annulée à la fin (`ANNULATION_ESSAI_GLOBALE`), chaque contrôle dans la sienne. Les verdicts
-- voyagent dans un réglage LOCAL à la transaction (`essai.banque_client`), que la requête finale lit : le fichier se joue
-- d'un seul appel et ne crée aucune table. Il ne porte AUCUNE instruction de suppression : ce qu'une suppression
-- rencontre (la cascade d'une pièce ou d'un mouvement, la garde d'une suppression directe) se joue sur une réplique.
--
-- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
--   « jeu »      posé par le propriétaire, gardé jusqu'à la fin de l'essai ;
--   « fait »     joué sous « qui » et gardé ; « OK » attend qu'il passe ;
--   « controle » joué sous « qui » puis annulé ; « OK » attend qu'il passe, sinon le code ET la raison ;
--   « valeur »   une lecture par le propriétaire, qui doit rendre exactement la valeur attendue ;
--   « lecture »  la même, jouée sous « qui » ;
--   « egal »     une lecture jouée sous « qui », qui doit rendre ce que la requête de la colonne 6 rend au propriétaire ;
--   « tout »     sous « qui », le compte de la table nommée en colonne 4 doit être celui de TOUTES ses lignes des dossiers
--                du client — au moins une.
-- LES MUTATIONS (50 et suivants) rejouent un contrôle avec un profil, un droit ou une raison délibérément faux : chacune
-- doit MORDRE, sans quoi le contrôle qu'elle vise ne regarde rien.
--
-- Passage du 10/10/2026, AVANT toute application, sur la réplique de l'étape (neuf familles égales à la production à 109
-- puis à 110 migrations, en UTF8 ; dossiers semés de données fictives) : après les deux migrations, 86 verdicts, 0 en
-- faute ; après la première seule, exactement 3 en faute (3, 15 et 16) ; sans elles, ESSAI_IMPOSSIBLE. Les migrations elles-mêmes ont été mutées
-- (47 mutants : policies, contrôles d'accès, ordre des refus, gardes, unicité, contraintes, volatilité, droits) : chacun
-- fait virer au rouge ce fichier ou `rls.sql`. En production, il se joue après la seconde migration.
--
-- EN PRODUCTION, le 10/10/2026, par `execute_sql` — le fichier sans ses lignes de commentaire, 41 761 caractères,
-- empreinte 108b4cd1daa150d3fae26fb8105c81fb, que la ligne 0 rend telle que la base l'a reçue : après
-- `banque_du_client`, 86 lignes, exactement 3 en faute (3, 15 et 16) ; après `lectures_bancaires_au_droit_banque`,
-- 86 lignes, 0 en faute.
-- Les deux fois, rien n'est resté en base, accès et droits compris.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();

  cabinet uuid; dossier_client uuid; autre_dossier uuid;
  instantane jsonb; avant text; apres text;
  ids jsonb; etapes text[]; etape text[]; s text; attendu text; cle text; valeur text;
  accepte boolean; code_recu text; message text; obs text; n bigint; m bigint;
  verdicts jsonb := '[]'::jsonb;
begin
  -- Le dossier du client qui porte le MOINS de mouvements (la couverture s'y lit mieux), et un dossier du même cabinet où
  -- il n'a pas d'accès.
  select mb.dossier_id into dossier_client from memberships mb where mb.user_id = client
   order by (select count(*) from lignes_bancaires l where l.dossier_id = mb.dossier_id), mb.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_client;
  select d.id into autre_dossier from dossiers d where d.cabinet_id = cabinet
     and not exists (select 1 from memberships mb where mb.dossier_id = d.id and mb.user_id = client) order by d.id limit 1;
  if dossier_client is null or cabinet is null or autre_dossier is null
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or not exists (select 1 from super_admins where user_id = chef)
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client)
     or exists (select 1 from memberships where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes déjà rattachés autrement qu''attendu';
  end if;
  if to_regclass('public.justificatifs_proposes') is null or to_regclass('public.precisions_mouvements') is null then
    raise exception 'ESSAI_IMPOSSIBLE : la migration banque_du_client n''est pas en base';
  end if;

  select coalesce(jsonb_agg(to_jsonb(mb) order by mb.id), '[]'::jsonb) into instantane from memberships mb;
  select string_agg(x::text, '/') into avant from (values
    ((select count(*) from lignes_bancaires)), ((select count(*) from pieces)), ((select count(*) from ventilations_bancaires)),
    ((select count(*) from reglements_groupes)), ((select count(*) from controles_releves_bancaires)),
    ((select count(*) from justificatifs_proposes)), ((select count(*) from precisions_mouvements)),
    ((select count(*) from exercices_valides)), ((select count(*) from cabinet_admins)), ((select count(*) from dossier_assignations)),
    ((select count(*) from dossiers))) as t(x);

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'INCONNU', inconnu, 'CABINET', cabinet,
    'D', dossier_client, 'A', autre_dossier, 'E', 'e57b1000-0000-4000-8007-0000000000e0',
    'M', 'e57b1000-0000-4000-8007-000000000001', 'M2', 'e57b1000-0000-4000-8007-000000000002',
    'MA', 'e57b1000-0000-4000-8007-000000000003',
    'P', 'e57b1000-0000-4000-8007-000000000011', 'P2', 'e57b1000-0000-4000-8007-000000000012',
    'PA', 'e57b1000-0000-4000-8007-000000000013',
    'X', 'e57b1000-0000-4000-8007-0000000000ff');

  etapes := array[
    -- ══ 1 à 6. Le catalogue ═════════════════════════════════════════════════════════════════════════════════════
    array['valeur', '1. les deux tables : RLS, et leurs seules policies — lecture au droit « Banque », restauration par le super-administrateur, suppression d''une précision par le cabinet', 'postgres',
      $q$select (select string_agg(c.relname || ' ' || c.relrowsecurity, ', ' order by c.relname) from pg_class c
                  where c.relnamespace = 'public'::regnamespace and c.relname in ('justificatifs_proposes', 'precisions_mouvements'))
         || ' | ' || (select string_agg(p.tablename || '.' || p.policyname || ' ' || left(p.cmd, 3) || ' ' || array_to_string(p.roles, ',')
                       || ' ' || coalesce(p.qual, '-') || ' ' || coalesce(p.with_check, '-'), ' ; ' order by p.tablename, p.policyname)
                       from pg_policies p where p.schemaname = 'public' and p.tablename in ('justificatifs_proposes', 'precisions_mouvements'))$q$,
      -- La commande de chaque policy par ses trois premières lettres : ce fichier se joue en production par l'outil
      -- d'exécution, qui soumet le mot d'une suppression à une confirmation — même dans un texte attendu.
      '', 'justificatifs_proposes true, precisions_mouvements true | justificatifs_proposes.justificatifs_proposes_lecture SEL authenticated gere_la_banque(dossier_id) - ; justificatifs_proposes.justificatifs_proposes_restauration INS authenticated - is_super_admin() ; precisions_mouvements.precisions_mouvements_lecture SEL authenticated gere_la_banque(dossier_id) - ; precisions_mouvements.precisions_mouvements_restauration INS authenticated - is_super_admin() ; precisions_mouvements.precisions_mouvements_suppression_cabinet DEL authenticated admin_du_dossier(dossier_id) -'],
    array['valeur', '2. le contrôle de solde d''un relevé se lit au droit « Banque », et ne s''écrit qu''au cabinet', 'postgres',
      $q$select string_agg(p.policyname || ' ' || p.cmd || ' ' || array_to_string(p.roles, ',') || ' ' || coalesce(p.qual, '-')
                || ' ' || coalesce(p.with_check, '-'), ' ; ' order by p.policyname)
           from pg_policies p where p.schemaname = 'public' and p.tablename = 'controles_releves_bancaires'$q$,
      '', 'controles_releves_bancaires_all ALL public admin_du_dossier(dossier_id) admin_du_dossier(dossier_id) ; controles_releves_bancaires_lecture_banque SELECT authenticated client_du_dossier(dossier_id, ''banque''::text) -'],
    array['valeur', '3. le resserrement : les lectures client des mouvements, des parts et des règlements groupés passent au droit « Banque », pour les seuls comptes connectés', 'postgres',
      $q$select string_agg(p.tablename || '.' || p.policyname || ' ' || p.cmd || ' ' || array_to_string(p.roles, ',') || ' ' || coalesce(p.qual, '-'), ' ; '
                order by p.tablename, p.policyname)
           from pg_policies p where p.schemaname = 'public' and p.tablename in ('lignes_bancaires', 'ventilations_bancaires', 'reglements_groupes')
            and p.policyname in ('membres peuvent lire leurs lignes bancaires', 'ventilations_bancaires_lecture_client', 'reglements_groupes_lecture_client')$q$,
      '', 'lignes_bancaires.membres peuvent lire leurs lignes bancaires SELECT authenticated client_du_dossier(dossier_id, ''banque''::text) ; reglements_groupes.reglements_groupes_lecture_client SELECT authenticated client_du_dossier(dossier_id, ''banque''::text) ; ventilations_bancaires.ventilations_bancaires_lecture_client SELECT authenticated client_du_dossier(dossier_id, ''banque''::text)'],
    array['valeur', '4. les quatre fonctions : SECURITY DEFINER, search_path fixé ; la couverture stable, les trois écritures volatiles ; les deux gardes sans DEFINER', 'postgres',
      $q$select string_agg(p.proname || ' ' || p.prosecdef || ' ' || p.provolatile::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '-'), ' ; ' order by p.proname)
           from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('proposer_justificatif', 'retirer_proposition', 'ecrire_precision_mouvement', 'couverture_du_releve',
                              'garder_justificatif_propose', 'garder_precision_mouvement')$q$,
      '', 'couverture_du_releve true s search_path=public ; ecrire_precision_mouvement true v search_path=public ; garder_justificatif_propose false v search_path=public ; garder_precision_mouvement false v search_path=public ; proposer_justificatif true v search_path=public ; retirer_proposition true v search_path=public'],
    array['valeur', '5. aucune des quatre ne s''exécute par anon ni PUBLIC, authenticated les exécute ; les gardes ne s''exécutent ni par anon ni par authenticated', 'postgres',
      $q$select string_agg(p.proname || ' ' || has_function_privilege('anon', p.oid, 'execute') || '/'
                || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE') || '/'
                || has_function_privilege('authenticated', p.oid, 'execute'), ' ; ' order by p.proname)
           from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('proposer_justificatif', 'retirer_proposition', 'ecrire_precision_mouvement', 'couverture_du_releve',
                              'garder_justificatif_propose', 'garder_precision_mouvement')$q$,
      '', 'couverture_du_releve false/false/true ; ecrire_precision_mouvement false/false/true ; garder_justificatif_propose false/false/false ; garder_precision_mouvement false/false/false ; proposer_justificatif false/false/true ; retirer_proposition false/false/true'],
    array['valeur', '6. les gardes sont posées : avant insertion, mise à jour et suppression d''une proposition ; avant insertion et mise à jour d''une précision', 'postgres',
      $q$select string_agg(t.tgname || ' ' || t.tgrelid::regclass::text, ' ; ' order by t.tgname) from pg_trigger t
           where t.tgrelid in ('public.justificatifs_proposes'::regclass, 'public.precisions_mouvements'::regclass) and not t.tgisinternal$q$,
      '', 'justificatifs_proposes_gardes justificatifs_proposes ; precisions_mouvements_gardes precisions_mouvements'],

    -- ══ Le jeu ═══════════════════════════════════════════════════════════════════════════════════════════════════
    array['jeu', 'trois mouvements : deux dans le dossier du client, un dans l''autre', 'postgres',
      $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant) values
           ('{M}', '{D}', '2026-03-10', 'ESSAI BANQUE CLIENT', -42.5), ('{M2}', '{D}', '2026-05-20', 'ESSAI BANQUE CLIENT 2', 100),
           ('{MA}', '{A}', '2026-03-10', 'ESSAI BANQUE CLIENT', -42.5)$q$, '', ''],
    array['jeu', 'trois pièces', 'postgres',
      $q$insert into pieces (id, dossier_id, storage_path, nom_fichier) values
           ('{P}', '{D}', '{D}/essai-banque-client-1.pdf', 'essai-banque-client-1.pdf'),
           ('{P2}', '{D}', '{D}/essai-banque-client-2.pdf', 'essai-banque-client-2.pdf'),
           ('{PA}', '{A}', '{A}/essai-banque-client.pdf', 'essai-banque-client.pdf')$q$, '', ''],
    array['jeu', 'une part de ventilation et un règlement groupé dans chacun des deux dossiers', 'postgres',
      $q$insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, part_personnelle, montant) values
           ('{D}', '{M}', true, -42.5), ('{A}', '{MA}', true, -42.5)$q$, '', ''],
    array['jeu', '', 'postgres',
      $q$insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values
           ('{D}', '{M2}', '{P2}', 100), ('{A}', '{MA}', '{PA}', -42.5)$q$, '', ''],
    array['jeu', 'un contrôle de solde dans chacun des deux dossiers', 'postgres',
      $q$insert into controles_releves_bancaires (dossier_id, source_fichier, solde_initial, solde_final, somme_mouvements, ecart, coherent)
         values ('{D}', 'essai-banque-client.csv', 0, 57.5, 57.5, 0, true), ('{A}', 'essai-banque-client.csv', 0, -42.5, -42.5, 0, true)$q$, '', ''],
    array['jeu', 'un dossier du client sans aucun mouvement', 'postgres',
      $q$insert into dossiers (id, nom, cabinet_id, code_email) values ('{E}', 'ESSAI BANQUE CLIENT VIDE', '{CABINET}', 'essai-banque-client-vide')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into memberships (user_id, dossier_id, role) values ('{CLIENT}', '{E}', 'client')$q$, '', ''],
    array['jeu', 'le client, sans droit', 'postgres', $q$update memberships set droit_ventes = false, droit_banque = false where user_id = '{CLIENT}'$q$, '', ''],

    -- ══ 10 à 13. Le cabinet propose et précise ══════════════════════════════════════════════════════════════════
    array['fait', '10. le chef propose une pièce pour un mouvement du dossier du client', 'chef', $q$select proposer_justificatif('{D}', '{M}', '{P}')$q$, 'OK', ''],
    array['fait', '11. et dans l''autre dossier', 'chef', $q$select proposer_justificatif('{A}', '{MA}', '{PA}')$q$, 'OK', ''],
    array['fait', '12. le chef pose une question sur un mouvement du dossier du client', 'chef', $q$select ecrire_precision_mouvement('{D}', '{M}', 'Quel est ce paiement ?')$q$, 'OK', ''],
    array['fait', '13. et dans l''autre dossier', 'chef', $q$select ecrire_precision_mouvement('{A}', '{MA}', 'Quel est ce paiement ?')$q$, 'OK', ''],
    array['valeur', '14. l''origine du cabinet est déduite, et l''auteur est le chef', 'postgres',
      $q$select (select origine || ' ' || (auteur_id = '{CHEF}') || ' ' || (retire_le is null) from justificatifs_proposes where ligne_bancaire_id = '{M}' and piece_id = '{P}')
         || ' | ' || (select origine || ' ' || (auteur_id = '{CHEF}') || ' ' || texte from precisions_mouvements where ligne_bancaire_id = '{M}')$q$,
      '', 'cabinet true true | cabinet true Quel est ce paiement ?'],

    -- ══ 15 à 22. Qui lit ════════════════════════════════════════════════════════════════════════════════════════
    -- Les six tables, dans cet ordre : mouvements, parts ventilées, règlements groupés, contrôles de solde, propositions,
    -- précisions — « vues dans son dossier / vues dans l'autre ».
    array['lecture', '15. le client SANS droit ne voit aucune ligne des six tables, pas même de son dossier', 'client',
      $q$select concat_ws(' ', (select count(*) from lignes_bancaires), (select count(*) from ventilations_bancaires),
           (select count(*) from reglements_groupes), (select count(*) from controles_releves_bancaires),
           (select count(*) from justificatifs_proposes), (select count(*) from precisions_mouvements))$q$, '', '0 0 0 0 0 0'],
    array['jeu', 'le client, case « Ventes » seule', 'postgres', $q$update memberships set droit_ventes = true, droit_banque = false where user_id = '{CLIENT}'$q$, '', ''],
    array['lecture', '16. la case « Ventes » seule n''ouvre rien de la banque', 'client',
      $q$select concat_ws(' ', (select count(*) from lignes_bancaires), (select count(*) from ventilations_bancaires),
           (select count(*) from reglements_groupes), (select count(*) from controles_releves_bancaires),
           (select count(*) from justificatifs_proposes), (select count(*) from precisions_mouvements))$q$, '', '0 0 0 0 0 0'],
    array['jeu', 'le client, case « Banque » seule', 'postgres', $q$update memberships set droit_ventes = false, droit_banque = true where user_id = '{CLIENT}'$q$, '', ''],
    array['lecture', '17. avec la case « Banque », il voit les lignes d''essai de son dossier, et aucune de l''autre', 'client',
      $q$select concat_ws(' ',
           (select count(*) from lignes_bancaires where id in ('{M}', '{M2}')) || '/' || (select count(*) from lignes_bancaires where dossier_id = '{A}'),
           (select count(*) from ventilations_bancaires where ligne_bancaire_id = '{M}') || '/' || (select count(*) from ventilations_bancaires where dossier_id = '{A}'),
           (select count(*) from reglements_groupes where ligne_bancaire_id = '{M2}') || '/' || (select count(*) from reglements_groupes where dossier_id = '{A}'),
           (select count(*) from controles_releves_bancaires where dossier_id = '{D}' and source_fichier = 'essai-banque-client.csv') || '/' || (select count(*) from controles_releves_bancaires where dossier_id = '{A}'),
           (select count(*) from justificatifs_proposes where ligne_bancaire_id = '{M}') || '/' || (select count(*) from justificatifs_proposes where dossier_id = '{A}'),
           (select count(*) from precisions_mouvements where ligne_bancaire_id = '{M}') || '/' || (select count(*) from precisions_mouvements where dossier_id = '{A}'))$q$,
      '', '2/0 1/0 1/0 1/0 1/0 1/0'],
    array['tout', '18. avec la case « Banque », il voit TOUTES les lignes de ses dossiers : les mouvements', 'client', 'lignes_bancaires', '', ''],
    array['tout', '18. … les parts ventilées', 'client', 'ventilations_bancaires', '', ''],
    array['tout', '18. … les règlements groupés', 'client', 'reglements_groupes', '', ''],
    array['tout', '18. … les contrôles de solde', 'client', 'controles_releves_bancaires', '', ''],
    array['tout', '18. … les propositions', 'client', 'justificatifs_proposes', '', ''],
    array['tout', '18. … les précisions', 'client', 'precisions_mouvements', '', ''],
    array['lecture', '19. le chef voit les lignes d''essai de l''autre dossier', 'chef',
      $q$select concat_ws(' ', (select count(*) from lignes_bancaires where id = '{MA}'),
           (select count(*) from ventilations_bancaires where ligne_bancaire_id = '{MA}'), (select count(*) from reglements_groupes where ligne_bancaire_id = '{MA}'),
           (select count(*) from controles_releves_bancaires where dossier_id = '{A}' and source_fichier = 'essai-banque-client.csv'),
           (select count(*) from justificatifs_proposes where ligne_bancaire_id = '{MA}'), (select count(*) from precisions_mouvements where ligne_bancaire_id = '{MA}'))$q$,
      '', '1 1 1 1 1 1'],
    array['lecture', '20. un compte rattaché à rien ne voit rien', 'inconnu',
      $q$select concat_ws(' ', (select count(*) from lignes_bancaires), (select count(*) from ventilations_bancaires),
           (select count(*) from reglements_groupes), (select count(*) from controles_releves_bancaires),
           (select count(*) from justificatifs_proposes), (select count(*) from precisions_mouvements))$q$, '', '0 0 0 0 0 0'],
    array['lecture', '21. l''anonyme non plus', 'anon',
      $q$select concat_ws(' ', (select count(*) from lignes_bancaires), (select count(*) from ventilations_bancaires),
           (select count(*) from reglements_groupes), (select count(*) from controles_releves_bancaires),
           (select count(*) from justificatifs_proposes), (select count(*) from precisions_mouvements))$q$, '', '0 0 0 0 0 0'],

    -- ══ 22 à 28. La couverture du relevé ════════════════════════════════════════════════════════════════════════
    array['jeu', 'le client, sans droit', 'postgres', $q$update memberships set droit_ventes = false, droit_banque = false where user_id = '{CLIENT}'$q$, '', ''],
    array['egal', '22. le client SANS droit lit la couverture de son dossier : ses mois, et rien d''autre', 'client',
      $q$select couverture_du_releve('{D}')::text$q$, '',
      $q$select coalesce(array_agg(m order by m), '{}')::text from (select distinct date_trunc('month', date::timestamp)::date as m from lignes_bancaires where dossier_id = '{D}') x$q$],
    array['lecture', '23. elle porte les mois des mouvements d''essai, au premier jour, et c''est un tableau de dates', 'chef',
      $q$select pg_typeof(couverture_du_releve('{D}'))::text || ' ' || ('2026-03-01'::date = any (couverture_du_releve('{D}')))
         || ' ' || ('2026-05-01'::date = any (couverture_du_releve('{D}'))) || ' ' || ('2026-03-10'::date = any (couverture_du_releve('{D}')))$q$,
      '', 'date[] true true false'],
    array['lecture', '24. un dossier du client sans mouvement : une couverture vide, pas une erreur', 'client', $q$select couverture_du_releve('{E}')::text$q$, '', '{}'],
    array['egal', '25. le chef lit la couverture de l''autre dossier', 'chef', $q$select couverture_du_releve('{A}')::text$q$, '',
      $q$select coalesce(array_agg(m order by m), '{}')::text from (select distinct date_trunc('month', date::timestamp)::date as m from lignes_bancaires where dossier_id = '{A}') x$q$],
    array['controle', '26. le client ne lit pas la couverture d''un dossier où il n''a pas d''accès', 'client', $q$select couverture_du_releve('{A}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '27. un compte rattaché à rien non plus', 'inconnu', $q$select couverture_du_releve('{D}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '28. l''anonyme n''exécute pas la fonction', 'anon', $q$select couverture_du_releve('{D}')$q$, '42501', 'permission denied for function couverture_du_releve'],

    -- ══ 30 à 41. Proposer ═══════════════════════════════════════════════════════════════════════════════════════
    array['controle', '30. refus 1 — le client sans droit, sur son dossier', 'client', $q$select proposer_justificatif('{D}', '{M}', '{P2}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['jeu', 'le client, case « Ventes » seule', 'postgres', $q$update memberships set droit_ventes = true, droit_banque = false where user_id = '{CLIENT}'$q$, '', ''],
    array['controle', '31. refus 1 — la case « Ventes » seule', 'client', $q$select proposer_justificatif('{D}', '{M}', '{P2}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['jeu', 'le client, case « Banque »', 'postgres', $q$update memberships set droit_ventes = false, droit_banque = true where user_id = '{CLIENT}'$q$, '', ''],
    array['controle', '32. refus 1 — sur un dossier où il n''a pas d''accès, avec la case sur les siens', 'client', $q$select proposer_justificatif('{A}', '{MA}', '{PA}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '33. refus 1 — un compte rattaché à rien', 'inconnu', $q$select proposer_justificatif('{D}', '{M}', '{P2}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '34. refus 1 — un dossier qui n''existe pas, même pour le super-administrateur', 'chef', $q$select proposer_justificatif('{X}', '{M}', '{P2}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '35. l''anonyme n''exécute pas la fonction', 'anon', $q$select proposer_justificatif('{D}', '{M}', '{P2}')$q$, '42501', 'permission denied for function proposer_justificatif'],
    array['controle', '36. refus 2 — un mouvement d''un autre dossier, et il passe avant la pièce', 'client', $q$select proposer_justificatif('{D}', '{MA}', '{PA}')$q$, '22023', 'Ce mouvement n''est pas un mouvement de ce dossier.'],
    array['controle', '37. refus 3 — une pièce d''un autre dossier', 'client', $q$select proposer_justificatif('{D}', '{M}', '{PA}')$q$, '22023', 'Cette pièce n''est pas une pièce de ce dossier.'],
    array['controle', '38. refus 4 — un mouvement d''un exercice validé', 'postgres',
      $q$do $x$ begin
           insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures,
                                          total_debit, total_credit, empreinte, declaration)
           values ('{D}', 2026, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('0', 64), '{}'::jsonb);
           set local role authenticated;
           perform set_config('request.jwt.claims', '{"sub":"{CLIENT}","role":"authenticated"}', true);
           perform proposer_justificatif('{D}', '{M2}', '{P}');
         end $x$ $q$, '22023', 'L''exercice 2026 est validé : un justificatif ne s''y propose plus.'],
    array['fait', '39. le client propose une pièce de son dossier pour un mouvement de son dossier', 'client', $q$select proposer_justificatif('{D}', '{M}', '{P2}')$q$, 'OK', ''],
    array['valeur', '40. l''origine du client est déduite ; la proposition est à lui, active, et rien n''a changé au mouvement', 'postgres',
      $q$select (select origine || ' ' || (auteur_id = '{CLIENT}') || ' ' || (retire_le is null) || ' ' || (retire_par is null)
                 from justificatifs_proposes where ligne_bancaire_id = '{M}' and piece_id = '{P2}')
         || ' | ' || (select statut || ' ' || coalesce(piece_id::text, 'sans pièce') from lignes_bancaires where id = '{M}')$q$,
      '', 'client true true true | non_rapprochee sans pièce'],
    array['controle', '41. refus 5 — la même pièce, déjà proposée pour ce mouvement', 'client', $q$select proposer_justificatif('{D}', '{M}', '{P2}')$q$, '22023', 'Cette pièce est déjà proposée pour ce mouvement.'],

    -- ══ 42 à 49. Retirer ════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '42. refus 3 — le client ne retire pas la proposition du cabinet', 'client',
      $q$select retirer_proposition('{D}', (select j.id from justificatifs_proposes j where j.ligne_bancaire_id = '{M}' and j.piece_id = '{P}'))$q$,
      '42501', 'Seuls son auteur et le cabinet retirent cette proposition.'],
    array['controle', '43. refus 2 — une proposition d''un autre dossier, annoncée sur le sien (par le chef, qui la voit)', 'chef',
      $q$select retirer_proposition('{D}', (select j.id from justificatifs_proposes j where j.ligne_bancaire_id = '{MA}'))$q$,
      '22023', 'Cette proposition n''est pas une proposition de ce dossier.'],
    array['fait', '44. le client retire SA proposition', 'client',
      $q$select retirer_proposition('{D}', (select j.id from justificatifs_proposes j where j.ligne_bancaire_id = '{M}' and j.piece_id = '{P2}' and j.retire_le is null))$q$, 'OK', ''],
    array['valeur', '45. elle reste, datée, retirée par lui', 'postgres',
      $q$select count(*) || ' ' || bool_and(retire_le is not null) || ' ' || bool_and(retire_par = '{CLIENT}')
           from justificatifs_proposes where ligne_bancaire_id = '{M}' and piece_id = '{P2}'$q$, '', '1 true true'],
    array['controle', '46. refus 4 — une proposition déjà retirée', 'client',
      $q$select retirer_proposition('{D}', (select j.id from justificatifs_proposes j where j.ligne_bancaire_id = '{M}' and j.piece_id = '{P2}'))$q$,
      '22023', 'Cette proposition est déjà retirée, depuis le __/__/____.'],
    array['fait', '47. retirée, la même pièce se propose de nouveau', 'client', $q$select proposer_justificatif('{D}', '{M}', '{P2}')$q$, 'OK', ''],
    array['fait', '48. le chef retire la proposition du client', 'chef',
      $q$select retirer_proposition('{D}', (select j.id from justificatifs_proposes j where j.ligne_bancaire_id = '{M}' and j.piece_id = '{P2}' and j.retire_le is null))$q$, 'OK', ''],
    array['valeur', '49. deux propositions de la même pièce, retirées l''une par le client, l''autre par le chef', 'postgres',
      $q$select string_agg(x.qui, ' ' order by x.qui) from (select case when retire_par = '{CLIENT}' then 'client' when retire_par = '{CHEF}' then 'chef' else 'active' end as qui
           from justificatifs_proposes where ligne_bancaire_id = '{M}' and piece_id = '{P2}') x$q$, '', 'chef client'],

    -- ══ 60 à 69. Préciser ═══════════════════════════════════════════════════════════════════════════════════════
    array['fait', '60. le client à la case « Banque » répond sur un mouvement de son dossier', 'client', $q$select ecrire_precision_mouvement('{D}', '{M}', E'  Le loyer du cabinet,\nmars.  ')$q$, 'OK', ''],
    array['valeur', '61. l''origine du client est déduite, le texte gardé tel qu''écrit', 'postgres',
      $q$select origine || ' ' || (auteur_id = '{CLIENT}') || ' [' || texte || ']' from precisions_mouvements where ligne_bancaire_id = '{M}' and origine = 'client'$q$,
      '', E'client true [  Le loyer du cabinet,\nmars.  ]'],
    array['controle', '62. refus 2 — un mouvement d''un autre dossier', 'client', $q$select ecrire_precision_mouvement('{D}', '{MA}', 'Une réponse')$q$, '22023', 'Ce mouvement n''est pas un mouvement de ce dossier.'],
    array['controle', '63. refus 3 — une précision vide', 'client', $q$select ecrire_precision_mouvement('{D}', '{M}', '')$q$, '22023', 'Une précision vide ne s''écrit pas.'],
    array['controle', '64. refus 3 — faite de blancs', 'client', $q$select ecrire_precision_mouvement('{D}', '{M}', E' \t\n\r ')$q$, '22023', 'Une précision vide ne s''écrit pas.'],
    array['controle', '65. refus 3 — nulle', 'client', $q$select ecrire_precision_mouvement('{D}', '{M}', null)$q$, '22023', 'Une précision vide ne s''écrit pas.'],
    array['controle', '66. refus 4 — deux mille et un caractères', 'client', $q$select ecrire_precision_mouvement('{D}', '{M}', repeat('é', 2001))$q$, '22023', 'Une précision tient en 2 000 caractères au plus.'],
    array['controle', '67. deux mille caractères passent', 'client', $q$select ecrire_precision_mouvement('{D}', '{M}', repeat('é', 2000))$q$, 'OK', ''],
    array['controle', '68. refus 1 — un dossier où il n''a pas d''accès', 'client', $q$select ecrire_precision_mouvement('{A}', '{MA}', 'Une réponse')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '69. l''anonyme n''exécute pas la fonction', 'anon', $q$select ecrire_precision_mouvement('{D}', '{M}', 'Une réponse')$q$, '42501', 'permission denied for function ecrire_precision_mouvement'],
    array['jeu', 'le client, case « Ventes » seule', 'postgres', $q$update memberships set droit_ventes = true, droit_banque = false where user_id = '{CLIENT}'$q$, '', ''],
    array['controle', '70. refus 1 — la case « Ventes » seule', 'client', $q$select ecrire_precision_mouvement('{D}', '{M}', 'Une réponse')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '71. refus 1 — le retrait d''une proposition par la case « Ventes » seule', 'client',
      $q$select retirer_proposition('{D}', (select j.id from justificatifs_proposes j where j.ligne_bancaire_id = '{M}' and j.piece_id = '{P}'))$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '72. refus 1 — un compte rattaché à rien', 'inconnu', $q$select ecrire_precision_mouvement('{D}', '{M}', 'Une réponse')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['jeu', 'le client, case « Banque »', 'postgres', $q$update memberships set droit_ventes = false, droit_banque = true where user_id = '{CLIENT}'$q$, '', ''],

    -- ══ 80 à 86. Aucune écriture directe ════════════════════════════════════════════════════════════════════════
    array['controle', '80. le client à la case « Banque » n''écrit pas une proposition directement', 'client',
      $q$insert into justificatifs_proposes (dossier_id, ligne_bancaire_id, piece_id, auteur_id, origine) values ('{D}', '{M2}', '{P}', '{CLIENT}', 'client')$q$,
      '42501', 'new row violates row-level security policy for table "justificatifs_proposes"'],
    array['controle', '81. ni une précision', 'client',
      $q$insert into precisions_mouvements (dossier_id, ligne_bancaire_id, auteur_id, origine, texte) values ('{D}', '{M2}', '{CLIENT}', 'client', 'directe')$q$,
      '42501', 'new row violates row-level security policy for table "precisions_mouvements"'],
    array['controle', '82. ni un contrôle de solde', 'client',
      $q$insert into controles_releves_bancaires (dossier_id, source_fichier, solde_initial, solde_final, somme_mouvements, ecart, coherent) values ('{D}', 'essai-direct.csv', 0, 1, 1, 0, true)$q$,
      '42501', 'new row violates row-level security policy for table "controles_releves_bancaires"'],
    array['lecture', '83. une mise à jour ne touche aucune proposition ni aucune précision (un `update` sans policy ne lève pas)', 'client',
      $q$with a as (update justificatifs_proposes set retire_le = now(), retire_par = '{CLIENT}' where dossier_id = '{D}' and retire_le is null returning 1),
              b as (update precisions_mouvements set texte = 'réécrit' where dossier_id = '{D}' returning 1)
         select (select count(*) from a) || ' ' || (select count(*) from b)$q$, '', '0 0'],
    array['valeur', '84. relues : la proposition du cabinet est toujours active, la question du chef intacte', 'postgres',
      $q$select (select (retire_le is null)::text from justificatifs_proposes where ligne_bancaire_id = '{M}' and piece_id = '{P}')
         || ' ' || (select texte from precisions_mouvements where ligne_bancaire_id = '{M}' and origine = 'cabinet')$q$, '', 'true Quel est ce paiement ?'],

    -- ══ 85 à 92. Les gardes et la restauration ══════════════════════════════════════════════════════════════════
    array['controle', '85. le super-administrateur restaure une proposition : un mouvement d''un autre dossier est refusé', 'chef',
      $q$insert into justificatifs_proposes (dossier_id, ligne_bancaire_id, piece_id, auteur_id, origine) values ('{D}', '{MA}', '{P}', '{CLIENT}', 'client')$q$,
      '23514', 'Une proposition rapproche un mouvement et une pièce de son dossier.'],
    array['controle', '86. une pièce d''un autre dossier aussi', 'chef',
      $q$insert into justificatifs_proposes (dossier_id, ligne_bancaire_id, piece_id, auteur_id, origine) values ('{D}', '{M2}', '{PA}', '{CLIENT}', 'client')$q$,
      '23514', 'Une proposition rapproche un mouvement et une pièce de son dossier.'],
    array['controle', '87. une proposition restaurée de son dossier passe, retirée comprise', 'chef',
      $q$insert into justificatifs_proposes (dossier_id, ligne_bancaire_id, piece_id, auteur_id, origine, created_at, retire_le, retire_par)
         values ('{D}', '{M2}', '{P}', '{CLIENT}', 'client', '2026-06-01 10:00+00', '2026-06-02 10:00+00', '{CLIENT}')$q$, 'OK', ''],
    array['controle', '88. une précision restaurée sur le mouvement d''un autre dossier est refusée', 'chef',
      $q$insert into precisions_mouvements (dossier_id, ligne_bancaire_id, auteur_id, origine, texte) values ('{D}', '{MA}', '{CLIENT}', 'client', 'restaurée')$q$,
      '23514', 'Une précision porte sur un mouvement de son dossier.'],
    array['controle', '89. une proposition ne se modifie pas — ni sa pièce…', 'postgres',
      $q$update justificatifs_proposes set piece_id = '{P2}' where ligne_bancaire_id = '{M}' and piece_id = '{P}'$q$,
      '23514', 'Une proposition de justificatif ne se modifie pas : elle se retire, une fois.'],
    array['controle', '90. … ni son retrait, une seconde fois', 'postgres',
      $q$update justificatifs_proposes set retire_le = now() where ligne_bancaire_id = '{M}' and piece_id = '{P2}' and retire_par = '{CLIENT}'$q$,
      '23514', 'Une proposition de justificatif ne se modifie pas : elle se retire, une fois.'],
    array['controle', '91. une précision ne se modifie pas', 'postgres',
      $q$update precisions_mouvements set texte = 'réécrit' where ligne_bancaire_id = '{M}' and origine = 'cabinet'$q$,
      '23514', 'Une précision ne se modifie pas : on se corrige en ajoutant, pas en effaçant.'],
    array['controle', '92. une seule proposition ACTIVE d''une pièce pour un mouvement, même écrite directement', 'postgres',
      $q$insert into justificatifs_proposes (dossier_id, ligne_bancaire_id, piece_id, auteur_id, origine) values ('{D}', '{M}', '{P}', '{CHEF}', 'cabinet')$q$,
      '23505', 'duplicate key value violates unique constraint "justificatifs_proposes_une_active"'],
    array['controle', '93. un retrait sans son auteur ne s''écrit pas', 'postgres',
      $q$insert into justificatifs_proposes (dossier_id, ligne_bancaire_id, piece_id, auteur_id, origine, retire_le) values ('{D}', '{M2}', '{P2}', '{CHEF}', 'cabinet', now())$q$,
      '23514', 'new row for relation "justificatifs_proposes" violates check constraint "justificatifs_proposes_retrait"%'],
    array['controle', '94. une origine qui n''est ni le client ni le cabinet ne s''écrit pas', 'postgres',
      $q$insert into precisions_mouvements (dossier_id, ligne_bancaire_id, auteur_id, origine, texte) values ('{D}', '{M}', '{CHEF}', 'banque', 'directe')$q$,
      '23514', 'new row for relation "precisions_mouvements" violates check constraint "precisions_mouvements_origine"%'],

    -- ══ 50 à 52. Les mutations ══════════════════════════════════════════════════════════════════════════════════
    -- 50 : le contrôle 15 joué AVEC la case « Banque » : il doit voir des lignes, sinon 15 ne regarde rien.
    array['lecture', '50. MUTATION — le contrôle 15 joué avec la case « Banque » : il doit voir des lignes (attendu « 0 0 0 0 0 0 » NON)', 'client',
      $q$select case when concat_ws(' ', (select count(*) from lignes_bancaires), (select count(*) from ventilations_bancaires),
           (select count(*) from reglements_groupes), (select count(*) from controles_releves_bancaires),
           (select count(*) from justificatifs_proposes), (select count(*) from precisions_mouvements)) = '0 0 0 0 0 0' then 'ne mord pas' else 'mord' end$q$, '', 'mord'],
    -- 51 : le refus 1 du contrôle 30 joué avec la case « Banque » : il doit passer, sinon 30 ne dit rien du droit.
    array['controle', '51. MUTATION — le contrôle 30 joué avec la case « Banque » : il doit passer', 'client', $q$select proposer_justificatif('{D}', '{M2}', '{P2}')$q$, 'OK', ''],
    -- 52 : l'exigence de RAISON n'est pas décorative — le refus 2 attendu sous le message du refus 3 doit tomber.
    array['controle', '52. MUTATION — le contrôle 36 sous une autre raison : il doit être EN FAUTE (ce verdict est vert quand il l''est)', 'client',
      $q$do $x$ declare c text; m text; begin
           begin perform proposer_justificatif('{D}', '{MA}', '{PA}'); exception when others then c := sqlstate; m := sqlerrm; end;
           if c = '22023' and m like 'Cette pièce n''est pas une pièce de ce dossier.' then raise exception 'NE MORD PAS'; end if;
         end $x$ $q$, 'OK', ''],

    -- ══ 95 à 97. Un membre du cabinet, qui n'est pas super-administrateur ══════════════════════════════════════
    -- Le compte client, rattaché au cabinet comme membre affecté au dossier, jusqu'à la fin de l'essai (la base n'a qu'un
    -- chef, super-administrateur) : EN DERNIER, puisqu'il voit alors tout le dossier par le cabinet.
    array['jeu', 'le compte client devient membre du cabinet, affecté au dossier', 'postgres',
      $q$insert into cabinet_admins (user_id, cabinet_id, role) values ('{CLIENT}', '{CABINET}', 'comptable')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into dossier_assignations (dossier_id, user_id) values ('{D}', '{CLIENT}')$q$, '', ''],
    array['fait', '95. le membre affecté écrit une précision : son origine est celle du cabinet', 'client', $q$select ecrire_precision_mouvement('{D}', '{M2}', 'Question du membre')$q$, 'OK', ''],
    array['valeur', '96. relue', 'postgres', $q$select origine from precisions_mouvements where ligne_bancaire_id = '{M2}' and texte = 'Question du membre'$q$, '', 'cabinet'],
    array['controle', '97. le membre affecté ne restaure pas : la restauration est au super-administrateur', 'client',
      $q$insert into justificatifs_proposes (dossier_id, ligne_bancaire_id, piece_id, auteur_id, origine) values ('{D}', '{M2}', '{P}', '{CLIENT}', 'cabinet')$q$,
      '42501', 'new row violates row-level security policy for table "justificatifs_proposes"']
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
      elsif etape[1] in ('lecture', 'egal', 'tout') then
        if etape[1] = 'egal' then
          execute attendu into valeur;
        elsif etape[1] = 'tout' then
          execute format('select count(*) from public.%I x where x.dossier_id in (select mb.dossier_id from memberships mb where mb.user_id = %L)',
            s, client) into n;
          s := format('select count(*)::text from public.%I', s);
          valeur := n::text;
        else
          valeur := attendu;
        end if;
        begin
          execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
          perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
            else json_build_object('sub', case etape[3] when 'chef' then chef when 'client' then client else inconnu end,
                                   'role', 'authenticated')::text end, true);
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        verdicts := verdicts || jsonb_build_object('controle', etape[2],
          'observe', coalesce(obs, '∅') || case when etape[1] = 'lecture' then '' else ' (attendu ' || coalesce(valeur, '∅') || ')' end,
          'ok', coalesce(obs = valeur, false) and (etape[1] <> 'tout' or n > 0));
      else
        begin
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
            perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'client' then client else inconnu end,
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
          'ok', case when etape[5] = 'OK' then accepte and (etape[1] = 'fait' or coalesce(code_recu = 'P0001' and message = 'ANNULATION_ESSAI', false))
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

  -- ══ 99. Rien n'est resté ══════════════════════════════════════════════════════════════════════════════════════
  select string_agg(x::text, '/') into apres from (values
    ((select count(*) from lignes_bancaires)), ((select count(*) from pieces)), ((select count(*) from ventilations_bancaires)),
    ((select count(*) from reglements_groupes)), ((select count(*) from controles_releves_bancaires)),
    ((select count(*) from justificatifs_proposes)), ((select count(*) from precisions_mouvements)),
    ((select count(*) from exercices_valides)), ((select count(*) from cabinet_admins)), ((select count(*) from dossier_assignations)),
    ((select count(*) from dossiers))) as t(x);
  verdicts := verdicts || jsonb_build_object('controle', '99. rien n''est resté en base',
    'observe', 'mouvements, pièces, parts, règlements, contrôles, propositions, précisions, exercices validés, membres, affectations, dossiers : '
      || avant || ' -> ' || apres || ', accès '
      || case when (select coalesce(jsonb_agg(to_jsonb(mb) order by mb.id), '[]'::jsonb) from memberships mb) = instantane then 'identiques, droits compris' else 'CHANGÉS' end,
    'ok', coalesce(avant = apres and (select coalesce(jsonb_agg(to_jsonb(mb) order by mb.id), '[]'::jsonb) from memberships mb) = instantane
      and not exists (select 1 from cabinet_admins where user_id = client), false));

  perform set_config('essai.banque_client', verdicts::text, true);
end $$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier sans ses lignes de commentaire
-- (`grep -v '^\s*--'`) par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.banque_client')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
