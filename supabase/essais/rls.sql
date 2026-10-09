-- Essai des policies RLS — à rejouer, pas à lire.
--
-- Les policies de ce schéma sont vérifiées par impersonation réelle à leur création, une par une.
-- Rien ne les rejouait ensuite : une migration pouvait en défaire une sans que quoi que ce soit le
-- signale. C'est ce que ce script corrige, et il l'a prouvé à sa PREMIÈRE exécution en trouvant une
-- fuite que personne n'avait vue (voir la migration `categories_et_natures_reservees_aux_connectes`).
--
-- Ce qu'il vérifie n'est pas une liste de comptes figés — elle pourrirait au premier dépôt de pièce —
-- mais des INVARIANTS qui restent vrais quelles que soient les données :
--
--   1. Un visiteur anonyme ne voit AUCUNE ligne, dans aucune des tables du schéma. La boucle passe
--      sur `pg_class`, donc une table ajoutée demain sans policy est attrapée sans que personne ait
--      à penser à l'ajouter ici. C'est le contrôle qui a trouvé la fuite.
--   2. Un utilisateur authentifié rattaché à rien — ni cabinet, ni dossier, ni super-admin — ne voit
--      rien non plus, hors exceptions nommées ci-dessous.
--   3. Un client ne voit, dans chaque table portant un `dossier_id`, que des lignes de SES dossiers.
--   4. Un client ne peut pas écrire ce qui appartient au cabinet.
--   5. `prochain_numero_facture` ne s'appelle pas. Malgré son nom elle CONSOMME un numéro : un appel
--      réussi creuserait un trou dans une suite annuelle qui n'en admet pas.
--   5bis. `attribuer_numero_facture`, qui l'enveloppe, non plus. Depuis la migration
--      factures_validees_figees (07/10/2026), PERSONNE ne les appelle — ni l'anonyme, ni le client, ni
--      le chef du cabinet : seule `enregistrer_facture` prend un numéro, dans la transaction qui
--      valide la facture qu'il désigne. Le refus doit donc être celui du DROIT D'EXÉCUTION (42501,
--      « permission denied »), et non le contrôle d'accès de la fonction, qu'un client atteignait
--      jusque-là.
--   6. Et les mêmes questions sur le STOCKAGE (section S), qui est l'endroit où vivent réellement
--      les données identifiantes de ce projet — plus un contrôle POSITIF (S3bis : le client voit
--      bien ses propres fichiers), sans lequel un bucket devenu illisible à tous passerait pour un
--      succès sur toute la section.
--
-- Les écritures d'essai sont annulées par le mécanisme de sous-transaction de PL/pgSQL : un bloc
-- `BEGIN ... EXCEPTION` est un point de reprise implicite, donc lever volontairement une exception à
-- la fin du bloc annule ce qu'il a écrit. Les VARIABLES, elles, gardent leur valeur — c'est ce qui
-- permet de savoir si l'écriture avait été acceptée, sans en laisser la trace.
--
-- ══ Pourquoi la seconde moitié de ce fichier existe ═══════════════════════════════════════════
--
-- Une suite verte ne prouve rien tant qu'on ne l'a pas vue échouer. Un harnais d'impersonation est
-- particulièrement exposé : si `set local role` ne prenait pas, si le `sub` du jeton n'était pas lu,
-- si une table était refusée en bloc pour une raison sans rapport, TOUS les comptes rendraient zéro
-- et le fichier afficherait « 0 en faute » sur une base grande ouverte. C'est la panne dont on ne se
-- relève pas, parce qu'elle ressemble exactement au succès.
--
-- La seconde moitié rejoue donc chaque contrôle avec un profil ou un réglage délibérément faux et
-- exige qu'il vire au rouge. Elle se lance avec le reste, et son verdict est le second tableau.
-- Un contrôle qui « ne mord pas » est un contrôle à reprendre, même si le premier tableau est vert.
--
-- À lancer par l'outil MCP Supabase (`execute_sql`). Les identifiants ci-dessous sont ceux du projet
-- réel ; sur un autre jeu de données, les remplacer par un client et un chef existants.
--
-- Passage COMPLET du 19/09/2026 — 16 lignes de verdict (40 tables du schéma + 3 buckets,
-- 3 profils), 0 en faute, et 12 mutations sur 12 qui mordent.
--
-- 21/09/2026 — les contrôles 5bis et les mutations M5ter/M5quater ont été AJOUTÉS puis rejoués
-- SEULS (4 invariants ok, 2 mutations qui mordent) : `attribuer_numero_facture` refuse l'anonyme en
-- 42501 et le client en « Accès refusé à ce dossier. », sur son dossier comme sur celui d'un autre,
-- compteur inchangé (6 -> 6) ; le chef, lui, obtient bien un numéro. Le reste du fichier n'a pas été
-- relancé à cette occasion — il n'avait pas changé, et aucune migration n'est intervenue depuis.
-- Dit comme tel plutôt que laissé croire à un passage complet.
--
-- 04/10/2026 — après les migrations de la validation d'un exercice, qui créent `exercices_valides` et
-- ses deux policies : les invariants 1 à 3 seuls, rejoués sur les 48 tables du schéma (40 portant un
-- `dossier_id`), nouvelle table comprise — 0 en faute. Et ils savent échouer : sans le changement de
-- rôle, 29, 26 et 13 tables virent au rouge (les autres sont vides, où « refusé » et « rien à voir » se
-- ressemblent par construction — `exercices_valides` en fait partie, aucun exercice n'étant validé).
-- Les sections 4 à 6 et les mutations n'ont pas été relancées : ces migrations n'ajoutent que des
-- policies de LECTURE et de restauration sur une table nouvelle, et la table des verdicts a été créée
-- `on commit drop`, sans le `drop table` qui suit.
--
-- 07/10/2026 — après `reception_par_plateforme_agreee`, qui crée `connexions_plateformes` (RLS sans
-- aucune policy) et RESTREINT la policy d'insertion des pièces pour un client : les invariants 1 à 3
-- seuls, rejoués de la même façon sur les 51 tables du schéma (43 portant un `dossier_id`), nouvelle
-- table comprise — 0 en faute ; sans le changement de rôle, 29, 26 et 13 tables virent au rouge. Ce que
-- la migration change à l'écriture — un client ne dépose plus qu'une pièce « à valider », sans catégorie,
-- à son nom, sans provenance de plateforme — est éprouvé par `receptionPlateforme.sql` (40 contrôles), et
-- non par les sections 4 à 6, qui ne testent aucune insertion de pièce.
--
-- 07/10/2026 — après `factures_validees_figees`, qui retire le droit d'exécuter les deux fonctions de
-- numérotation à tout compte connecté : les contrôles 5 et 5bis ont été RÉÉCRITS (le chef y entre, et le
-- refus doit être celui du droit d'exécution) et rejoués seuls avec leurs mutations M5 à M5quater, M5
-- rendant ce droit le temps d'une sous-transaction annulée et M5ter numérotant par `enregistrer_facture`.
-- En production : 8 contrôles sur 8, les quatre mutations mordent, compteur inchangé (6 -> 6) — les deux
-- tables de résultats créées `on commit drop`, sans le `drop table` qui les précède ici. Le reste du
-- fichier n'a pas été relancé : la migration ne touche aucune policy. Ce qu'elle fige d'une facture
-- validée est éprouvé par factures.sql.
--
-- 08/10/2026 — PASSAGE COMPLET, le premier depuis le 19/09/2026, après `encaissements_des_factures`,
-- qui crée deux tables et leurs policies : 22 lignes de verdict (54 tables du schéma, dont 46 portant
-- un `dossier_id`, + 3 buckets, 3 profils), 0 en faute, et 14 mutations sur 14 qui mordent (M2 :
-- exactement 3). La transcription, qui faisait renoncer au fichier entier, est vérifiée : le texte
-- transmis — ce fichier sans son en-tête de commentaires ni ses deux `drop table`, les tables de
-- résultats `on commit drop`, et une ligne TEXTE ajoutée au verdict, qui rend la longueur et
-- l'empreinte du texte reçu — est celui de la copie adaptée, caractère pour caractère (HISTORIQUE.md,
-- entrée de l'étape d1). Les deux tables nouvelles sont vides en production : ce que leurs policies
-- refusent sur une ligne qui EXISTE est éprouvé par `encaissementsFactures.sql`.
--
-- 08/10/2026 — PASSAGE COMPLET après `transmissions_des_encaissements`, qui crée
-- `transmissions_encaissements` et ses deux policies (lecture sous `admin_du_dossier`, insertion de
-- restauration réservée au super-admin) : 22 lignes de verdict (55 tables du schéma, dont 47 portant un
-- `dossier_id`, + 3 buckets, 3 profils), 0 en faute, et 14 mutations sur 14 qui mordent (M2 : exactement
-- 3). Le texte reçu est celui du passage précédent, caractère pour caractère (32 144 caractères,
-- empreinte 95048df511611d0bd486747149697640) : seul cet en-tête a changé depuis. La table nouvelle est
-- vide en production : ce que ses policies et son déclencheur refusent sur une ligne qui EXISTE est
-- éprouvé par `transmissionsEncaissements.sql`.
--
-- 09/10/2026 — PASSAGE COMPLET après `cycle_de_vie_des_factures_emises`, qui crée `statuts_factures_recus`
-- et ses deux policies (lecture sous `admin_du_dossier`, insertion de restauration réservée au
-- super-admin) : 22 lignes de verdict (56 tables du schéma, dont 48 portant un `dossier_id`, + 3 buckets,
-- 3 profils), 0 en faute, et 14 mutations sur 14 qui mordent. Le texte reçu est celui des deux passages
-- précédents, caractère pour caractère (32 144 caractères, empreinte 95048df511611d0bd486747149697640) :
-- seul cet en-tête a changé depuis. La table nouvelle est vide en production : ce que ses policies et sa
-- garde refusent sur une ligne qui EXISTE est éprouvé par `statutsFacturesRecus.sql`.
--
-- 09/10/2026 — PASSAGE COMPLET après `identite_des_factures_recues`, qui ajoute à `pieces` quatre colonnes,
-- cinq contraintes et une garde, sans toucher à aucune policy : 22 lignes de verdict (56 tables du
-- schéma, dont 48 portant un `dossier_id`, + 3 buckets, 3 profils), 0 en faute, et 14 mutations sur 14
-- qui mordent (M2 : exactement 3). Le texte reçu est celui des trois passages précédents, caractère pour
-- caractère (32 144 caractères, empreinte 95048df511611d0bd486747149697640). Ce que la garde et les
-- contraintes refusent, et que le client ne peut pas écrire d'identité, est éprouvé par
-- `identiteFacturesRecues.sql`.

-- `drop if exists` parce qu'une connexion réutilisée garde ses tables temporaires : sans lui, le
-- second passage échoue sur « relation déjà existante » et on croit à une régression du schéma.
drop table if exists rls_verdict;
create temp table rls_verdict (controle text, cible text, observe text, ok boolean);

do $$
declare
  -- Un `sub` qui n'est dans aucune table : ni cabinet_admins, ni memberships, ni super_admins.
  inconnu    uuid := gen_random_uuid();
  client     uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef       uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  autre_dossier     uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  -- Tables qu'un utilisateur CONNECTÉ peut légitimement lire en entier. Ce sont des référentiels
  -- sans donnée de dossier ni donnée personnelle, partagés par construction :
  --   - taux_change_bce : cours publiés par la BCE, publics par nature ;
  --   - categories / natures_immobilisation : libellés comptables partagés par le cabinet
  --     (`dossier_id` nul). Réservés aux connectés depuis la migration du 19/09/2026 — avant, ils
  --     étaient lisibles par un ANONYME, ce que ce script a découvert.
  -- Toute AUTRE table visible d'un inconnu serait une fuite. Cette liste est l'endroit où « on a
  -- décidé que c'était acceptable » est écrit ; elle doit rester courte et justifiée.
  tolerees text[] := array['taux_change_bce', 'categories', 'natures_immobilisation'];

  t record; n bigint; hors bigint; accepte boolean; touchees int;
  numero_avant int; numero_apres int;
  -- Le code d'erreur du refus, et non un simple « ça a échoué ». Sans lui, une colonne mal
  -- orthographiée dans l'écriture d'essai produirait `42703` (colonne inconnue) et le test
  -- conclurait « RLS a refusé » — il passerait pour la mauvaise raison, ce qui est pire qu'un échec.
  -- On exige donc 42501, le refus de policy, nommément.
  motif text;
  -- Et le MESSAGE, pour les refus qui viennent d'une fonction plpgsql : ceux-là arrivent en P0001,
  -- le même code que l'annulation volontaire de ce harnais. Le code seul ne les distingue donc pas
  -- d'un incident sans rapport (voir 5bis).
  raison text;
begin
  -- ══ 1 et 2. Anonyme, puis authentifié rattaché à rien ══════════════════════════════════════
  for t in
    select c.relname as nom from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r' order by c.relname
  loop
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    -- Un refus franc (erreur) vaut mieux que zéro ligne, et compte comme un succès : -1 le note.
    begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := -1; end;
    reset role;
    insert into rls_verdict values ('1. anonyme ne voit rien', t.nom, n::text, n <= 0);

    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
    begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := -1; end;
    reset role;
    insert into rls_verdict values ('2. inconnu authentifié ne voit rien', t.nom, n::text,
      (n <= 0) or (t.nom = any(tolerees)));
  end loop;

  -- ══ 3. Le client ne voit que ses dossiers ═══════════════════════════════════════════════════
  for t in
    select c.relname as nom from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'dossier_id' and a.attnum > 0 and not a.attisdropped
    where ns.nspname = 'public' and c.relkind = 'r' order by c.relname
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    begin
      -- Un `dossier_id` nul est une ligne partagée, légitimement visible : exclue du compte.
      execute format(
        'select count(*) from public.%I x where x.dossier_id is not null and x.dossier_id not in (select m.dossier_id from memberships m where m.user_id = %L)',
        t.nom, client) into hors;
    exception when others then hors := 0;  -- table refusée en bloc : aucune fuite possible
    end;
    reset role;
    insert into rls_verdict values ('3. client ne voit que ses dossiers', t.nom, hors::text, hors = 0);
  end loop;

  -- ══ 4. Le client ne peut pas écrire ce qui est au cabinet ══════════════════════════════════
  -- Modifier une pièce de SON dossier : le dépôt lui appartient, l'arbitrage non.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  touchees := 0;
  begin
    update pieces set statut = 'validee' where dossier_id = dossier_du_client;
    get diagnostics touchees = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then null;   -- notre annulation : l'update est défait, `touchees` survit
    when others then touchees := 0;    -- refus franc
  end;
  reset role;
  insert into rls_verdict values ('4. client ne valide pas une pièce', 'pieces (update)', touchees::text, touchees = 0);

  -- Écrire une écriture comptable : réservé au cabinet, sans exception.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false;
  begin
    insert into ecritures_brouillon (dossier_id, compte, libelle, sens, montant, date)
    values (dossier_du_client, '606100', 'essai rls', 'debit', 1, current_date);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then null;
    when others then accepte := false; motif := sqlstate;
  end;
  reset role;
  insert into rls_verdict values ('4. client n''écrit pas une écriture', 'ecritures_brouillon (insert)',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end,
    (not accepte) and motif = '42501');

  -- Lire le dossier d'un AUTRE : la fuite la plus coûteuse s'il y en avait une.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  select count(*) into n from pieces where dossier_id = autre_dossier;
  reset role;
  insert into rls_verdict values ('4. client ne lit pas un autre dossier', 'pieces (autre dossier)', n::text, n = 0);

  -- ══ 5 et 5bis. La numérotation ne s'appelle pas ═══════════════════════════════════════════
  -- Les deux fonctions CONSOMMENT un numéro : on relève le compteur avant et après pour prouver qu'aucun
  -- trou n'a été creusé, même si un appel avait réussi. Le chef y entre, et c'est le point : jusqu'au
  -- 07/10/2026 il avait le droit de les appeler, donc de consommer un numéro sans la facture qu'il
  -- désigne. Le refus attendu est celui du DROIT D'EXÉCUTION, nommément : « pas accepté » ne prouve rien
  -- (un échec sans rapport passerait — voir M5quater), et un refus du contrôle d'accès de la fonction
  -- dirait que le droit existe encore.
  select coalesce(max(dernier_numero), -1) into numero_avant from facture_numerotation;
  for t in
    select '5' as num, 'prochain_numero_facture' as fonction, 'anonyme' as profil, null::uuid as sub, autre_dossier as cible
    union all select '5', 'prochain_numero_facture', 'client, son propre dossier', client, dossier_du_client
    union all select '5', 'prochain_numero_facture', 'chef, un dossier de son cabinet', chef, dossier_du_client
    union all select '5bis', 'attribuer_numero_facture', 'anonyme', null::uuid, autre_dossier
    union all select '5bis', 'attribuer_numero_facture', 'client, dossier d''un autre', client, autre_dossier
    union all select '5bis', 'attribuer_numero_facture', 'client, son propre dossier', client, dossier_du_client
    union all select '5bis', 'attribuer_numero_facture', 'chef, un dossier de son cabinet', chef, dossier_du_client
  loop
    if t.sub is null then
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', t.sub, 'role','authenticated')::text, true);
    end if;
    accepte := false; motif := null; raison := null;
    begin
      execute format('select %I($1, 2026, %L)', t.fonction, 'facture') using t.cible;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception
      -- `accepte` est posé AVANT le `raise`, donc ce handler n'a rien à corriger : l'annulation et un
      -- refus levé par la fonction arrivent tous deux en P0001, c'est la RAISON qui les sépare.
      when sqlstate 'P0001' then get stacked diagnostics raison = message_text;
      when others then accepte := false; motif := sqlstate;
                       get stacked diagnostics raison = message_text;
    end;
    reset role;
    insert into rls_verdict values (t.num || '. ' || t.profil || ' n''appelle pas la numérotation', t.fonction,
      case when accepte then 'ACCEPTÉ' else 'refusé : ' || coalesce(motif, '') || ' ' || coalesce(raison, '?') end,
      (not accepte) and motif = '42501' and raison like 'permission denied for function%');
  end loop;
  select coalesce(max(dernier_numero), -1) into numero_apres from facture_numerotation;
  insert into rls_verdict values ('5bis. le compteur n''a pas bougé', 'facture_numerotation',
    numero_avant::text || ' -> ' || numero_apres::text, numero_avant = numero_apres);
end $$;


-- ═══ Le stockage ═══════════════════════════════════════════════════════════════════════════════
--
-- C'est ici que vivent les données identifiantes. RGPD.md §4 le mesure : les noms de patients sont
-- dans les FICHIERS, pas dans les tables — une ligne de pièce ne porte qu'un chemin, un montant et
-- une date. Les policies de `storage.objects` sont donc les plus importantes du projet, et étaient
-- les dernières à n'être vérifiées que par relecture.
--
-- Leur mécanique tient en une ligne : le premier segment du chemin EST le dossier
-- (`storage.foldername(name)[1]`, casté en uuid), et c'est lui qui est passé à `admin_du_dossier`
-- ou comparé aux `memberships`. D'où le contrôle S6, qui n'a l'air de rien : un chemin dont le
-- premier segment n'est pas un UUID ne masque pas une ligne, il fait LEVER le cast — donc casse
-- la lecture du bucket pour tout le monde, d'un coup.
--
-- Comme les policies de tables, toutes portent `roles = public`. Ici les prédicats sauvent la mise
-- (`auth.uid()` est nul sans session, donc aucune branche n'est vraie), mais c'est la même forme
-- que la fuite trouvée sur `categories` : ce qui protège est le prédicat, pas le rôle.

do $$
declare
  inconnu uuid := gen_random_uuid();
  client  uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  autre_dossier uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  n bigint; hors bigint; sien bigint; total_sien bigint;
  accepte boolean; motif text; mauvais bigint;
begin
  -- S1. L'anonyme ne voit aucun fichier des buckets privés.
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  select count(*) into n from storage.objects where bucket_id in ('pieces','packs');
  reset role;
  insert into rls_verdict values ('S1. anonyme ne voit aucun fichier privé', 'pieces + packs', n::text, n = 0);

  -- S1bis. Les logos SONT publics, et c'est voulu : ils s'affichent sur l'écran de connexion,
  -- avant toute session. Écrit ici pour que ce soit une décision constatée et non un oubli — et
  -- le contrôle exige qu'ils soient VISIBLES, donc il tombe aussi si on les ferme par mégarde.
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  select count(*) into n from storage.objects where bucket_id = 'cabinet-logos';
  reset role;
  insert into rls_verdict values ('S1bis. les logos restent publics, volontairement', 'cabinet-logos',
    n::text || ' visibles', n > 0);

  -- S2. Un authentifié rattaché à rien ne voit aucun fichier privé.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id in ('pieces','packs');
  reset role;
  insert into rls_verdict values ('S2. inconnu authentifié ne voit aucun fichier privé', 'pieces + packs', n::text, n = 0);

  -- S3. Le client ne voit aucun fichier hors de SES dossiers.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  select count(*) into hors from storage.objects o
   where o.bucket_id in ('pieces','packs')
     and ((storage.foldername(o.name))[1])::uuid not in (select m.dossier_id from memberships m where m.user_id = client);
  select count(*) into sien from storage.objects o
   where o.bucket_id = 'pieces'
     and ((storage.foldername(o.name))[1])::uuid in (select m.dossier_id from memberships m where m.user_id = client);
  reset role;
  insert into rls_verdict values ('S3. client ne voit aucun fichier d''un autre dossier', 'storage.objects', hors::text, hors = 0);

  -- S3bis. Contrôle POSITIF, et il est indispensable : sans lui, un bucket devenu illisible à tous
  -- passerait pour un succès sur toute la section ci-dessus. Le total de référence porte sur TOUS
  -- les dossiers du client — il en a plusieurs (voir le sélecteur multi-sociétés) — et non sur un
  -- seul : comparé à un dossier unique, ce contrôle annonçait « 61 vus sur 2 existants » et
  -- accusait à tort une policy qui faisait exactement son travail.
  select count(*) into total_sien from storage.objects o
   where o.bucket_id = 'pieces'
     and ((storage.foldername(o.name))[1])::uuid in (select m.dossier_id from memberships m where m.user_id = client);
  insert into rls_verdict values ('S3bis. le client voit BIEN ses propres fichiers', 'pieces (ses dossiers)',
    sien::text || ' vus sur ' || total_sien::text, sien = total_sien and total_sien > 0);

  -- S4. Le client ne dépose pas dans le dossier d'un autre.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; motif := null;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('pieces', autre_dossier::text || '/essai-rls.pdf', client::text);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  insert into rls_verdict values ('S4. client ne dépose pas chez un autre', 'pieces (insert)',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end,
    (not accepte) and motif = '42501');

  -- S5. La suppression ne se teste PAS en SQL, et c'est une limite à connaître, pas un oubli.
  --
  -- Un trigger de la plateforme, `protect_objects_delete` (BEFORE DELETE → `storage.protect_delete`),
  -- refuse toute suppression SQL directe : « Direct deletion from storage tables is not allowed.
  -- Use the Storage API instead. » Il refuse pour TOUT LE MONDE, et il refuse avec le SQLSTATE
  -- **42501** — exactement celui d'un refus de policy.
  --
  -- Un essai de suppression est donc indiscernable d'un refus RLS : il passerait au vert avec une
  -- policy grande ouverte. C'est la version « stockage » du piège 42501/42703 du haut de ce fichier,
  -- et c'est le test de MUTATION qui l'a révélée — le contrôle avait d'abord été écrit comme les
  -- autres, il était vert, et sa mutation (le même essai sous le super-admin, à qui la suppression
  -- est permise) refusait de mordre. Un contrôle vert dont la mutation ne mord pas ne prouve rien.
  --
  -- Ce qui reste démontrable est plus faible, et dit comme tel : la policy porte-t-elle encore son
  -- prédicat ? C'est une lecture du catalogue, pas une exécution — ça n'atteste pas que Postgres
  -- l'applique, seulement qu'une migration ne l'a ni supprimée ni élargie. Le vrai chemin passe par
  -- l'API Storage, qu'un script SQL ne peut pas appeler : c'est un essai manuel (cf. RGPD.md §8.6).
  select count(*) into n from pg_policy
   where polrelid = 'storage.objects'::regclass
     and polname = 'pieces_storage_delete'
     and polcmd = 'd'
     and pg_get_expr(polqual, polrelid) like '%admin\_du\_dossier%';
  insert into rls_verdict values ('S5. la policy de suppression garde son prédicat (lecture du catalogue)',
    'pieces_storage_delete', case when n = 1 then 'présente, admin_du_dossier' else 'ABSENTE OU ÉLARGIE' end, n = 1);

  -- S6. Tout chemin commence par un UUID (voir l'en-tête de section : un chemin mal formé ne
  -- masque pas une ligne, il casse la lecture du bucket pour tout le monde).
  select count(*) into mauvais from storage.objects
   where (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  insert into rls_verdict values ('S6. tout chemin de fichier commence par un UUID', 'storage.objects',
    mauvais::text || ' mal formé(s)', mauvais = 0);
end $$;


-- ═══ Test de mutation du harnais ═══════════════════════════════════════════════════════════════
--
-- Chaque contrôle est rejoué sous le CHEF (super-admin, à qui tout est permis) ou sans sa liste
-- d'exceptions. Tout doit virer au rouge : un contrôle qui resterait vert ne regarde rien.
--
-- M5 appelle la numérotation sur une année FICTIVE (2099) et non sur l'année courante. L'annulation
-- par sous-transaction est justement ce que cette mutation met à l'épreuve : la supposer acquise
-- pour la tester serait circulaire. Sur une année fictive, même une annulation défaillante ne
-- toucherait aucune suite réelle — et M5bis vérifie qu'il ne reste rien.

drop table if exists rls_mutation;
create temp table rls_mutation (mutation text, attendu text, observe text, mord boolean);

do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  t record; n bigint; hors bigint; accepte boolean; touchees int; motif text;
  raison text;
  en_faute int; numero_avant int; numero_apres int; restes int;
begin
  -- M1 : le contrôle « anonyme ne voit rien » exécuté sous le chef.
  en_faute := 0;
  for t in select c.relname as nom from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
           where ns.nspname = 'public' and c.relkind = 'r'
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := -1; end;
    reset role;
    if not (n <= 0) then en_faute := en_faute + 1; end if;
  end loop;
  insert into rls_mutation values ('M1 — contrôle 1 joué sous le chef', 'des tables en faute', en_faute || ' tables', en_faute > 0);

  -- M2 : le contrôle 2 sans sa liste d'exceptions. Les 3 référentiels tolérés doivent ressortir —
  -- preuve que la boucle lit de vrais comptes, et non zéro parce que l'impersonation a échoué.
  en_faute := 0;
  for t in select c.relname as nom from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
           where ns.nspname = 'public' and c.relkind = 'r'
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role','authenticated')::text, true);
    begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := -1; end;
    reset role;
    if not (n <= 0) then en_faute := en_faute + 1; end if;
  end loop;
  insert into rls_mutation values ('M2 — contrôle 2 sans sa liste tolerees', 'exactement 3 en faute', en_faute || ' tables', en_faute = 3);

  -- M3 : le contrôle 3 joué sous le chef, qui voit tout le cabinet.
  en_faute := 0;
  for t in select c.relname as nom from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
           join pg_attribute a on a.attrelid = c.oid and a.attname = 'dossier_id' and a.attnum > 0 and not a.attisdropped
           where ns.nspname = 'public' and c.relkind = 'r'
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    begin
      execute format('select count(*) from public.%I x where x.dossier_id is not null and x.dossier_id not in (select m.dossier_id from memberships m where m.user_id = %L)', t.nom, client) into hors;
    exception when others then hors := 0; end;
    reset role;
    if hors <> 0 then en_faute := en_faute + 1; end if;
  end loop;
  insert into rls_mutation values ('M3 — contrôle 3 joué sous le chef', 'des tables en faute', en_faute || ' tables', en_faute > 0);

  -- M4a : la validation de pièce tentée par le chef, à qui elle est permise.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  touchees := 0;
  begin
    update pieces set statut = 'validee' where dossier_id = dossier_du_client;
    get diagnostics touchees = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then touchees := 0; end;
  reset role;
  insert into rls_mutation values ('M4a — update pieces sous le chef', 'des lignes touchées', touchees || ' lignes', touchees > 0);

  -- M4b : l'écriture comptable tentée par le chef.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; motif := null;
  begin
    insert into ecritures_brouillon (dossier_id, compte, libelle, sens, montant, date)
    values (dossier_du_client, '606100', 'essai mutation', 'debit', 1, current_date);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  insert into rls_mutation values ('M4b — insert écriture sous le chef', 'ACCEPTÉ',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end, accepte);

  -- M5 : le droit d'exécution RENDU aux comptes connectés, le temps d'une sous-transaction annulée — la
  -- migration défaite. Le contrôle du chef doit alors virer au rouge : le chef consomme un numéro, sur
  -- l'année fictive 2099 (voir l'en-tête de section).
  select coalesce(max(dernier_numero), -1) into numero_avant from facture_numerotation;
  accepte := false; motif := null;
  begin
    grant execute on function prochain_numero_facture(uuid, integer, text) to authenticated;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform prochain_numero_facture(dossier_du_client, 2099, 'facture');
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  select coalesce(max(dernier_numero), -1) into numero_apres from facture_numerotation;
  insert into rls_mutation values ('M5 — le droit d''exécution rendu, le chef appelle', 'ACCEPTÉ',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end, accepte);

  -- M5bis : et l'annulation a bien effacé la consommation ET le droit rendu, jusque sur une fonction
  -- SECURITY DEFINER. C'est la preuve que tout le reste du fichier peut écrire sans laisser de trace.
  select count(*) into restes from facture_numerotation where annee = 2099;
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name in ('prochain_numero_facture', 'attribuer_numero_facture')
     and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role');
  insert into rls_mutation values ('M5bis — l''annulation efface la consommation et le droit', '0 ligne 2099, compteur inchangé, 0 droit',
    restes || ' ligne(s) 2099, ' || numero_avant || ' -> ' || numero_apres || ', ' || n || ' droit(s)',
    restes = 0 and numero_avant = numero_apres and n = 0);

  -- M5ter : le contrôle POSITIF. Sans lui, les refus de 5 et 5bis seraient satisfaits par une
  -- numérotation que plus personne n'atteint — la facturation à l'arrêt. Le chef numérote par le seul
  -- chemin qui reste, `enregistrer_facture`, une facture de l'année fictive 2099, annulée aussitôt.
  select coalesce(max(dernier_numero), -1) into numero_avant from facture_numerotation;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; motif := null; raison := null;
  begin
    select f.numero into raison from enregistrer_facture(dossier_du_client, null,
      '{"tiers_nom":"ESSAI RLS","date_emission":"2099-01-15","montant_ht":1,"montant_tva":0,"montant_ttc":1}'::jsonb,
      '[{"designation":"essai","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, true) as f;
    accepte := raison like 'F2099-%';
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  select coalesce(max(dernier_numero), -1) into numero_apres from facture_numerotation;
  select count(*) into restes from facture_numerotation where annee = 2099;
  insert into rls_mutation values ('M5ter — le chef numérote par enregistrer_facture', 'ACCEPTÉ',
    case when accepte then 'ACCEPTÉ ' || raison else 'refusé par ' || coalesce(motif,'?') end
    || ', ' || restes || ' ligne(s) 2099, ' || numero_avant || ' -> ' || numero_apres,
    accepte and restes = 0 and numero_avant = numero_apres);

  -- M5quater : l'exigence de RAISON de 5 et 5bis n'est pas décorative. On fait échouer l'essai pour un
  -- motif SANS RAPPORT — une fonction qui n'existe pas, donc 42883 — et le contrôle doit virer au
  -- rouge. Mesuré : sans cette exigence, « pas accepté » suffirait et l'essai passerait au VERT
  -- alors qu'il n'a jamais atteint la fonction. C'est le piège du 42703 que l'en-tête nomme déjà,
  -- ramené sur un appel de fonction.
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; motif := null; raison := null;
  begin
    perform attribuer_numero_facture_qui_n_existe_pas('00000000-0000-0000-0000-000000000000'::uuid, 2026, 'facture');
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then get stacked diagnostics raison = message_text;
    when others then accepte := false; motif := sqlstate;
                     get stacked diagnostics raison = message_text;
  end;
  reset role;
  insert into rls_mutation values ('M5quater — 5 et 5bis sur un échec sans rapport', 'EN FAUTE',
    'sqlstate ' || coalesce(motif,'?'),
    not ((not accepte) and motif = '42501' and raison like 'permission denied for function%'));
end $$;

-- Mutations de la section stockage. MS2 mérite un mot : le contrôle positif S3bis est le seul du
-- fichier qui exige de VOIR quelque chose, donc sa mutation est l'inverse des autres — on le rejoue
-- sous un inconnu, qui ne doit rien voir, et S3bis doit alors tomber.
do $$
declare
  client  uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef    uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  autre_dossier uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  n bigint; hors bigint; accepte boolean; motif text;
begin
  -- MS1 : S1 joué sous le chef, qui voit les fichiers de ses dossiers.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id in ('pieces','packs');
  reset role;
  insert into rls_mutation values ('MS1 — S1 joué sous le chef', 'des fichiers visibles', n || ' fichiers', n > 0);

  -- MS2 : S3bis joué sous un inconnu. Le contrôle positif doit tomber.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role','authenticated')::text, true);
  select count(*) into n from storage.objects o
   where o.bucket_id = 'pieces'
     and ((storage.foldername(o.name))[1])::uuid in (select m.dossier_id from memberships m where m.user_id = client);
  reset role;
  insert into rls_mutation values ('MS2 — S3bis joué sous un inconnu', '0 fichier vu', n || ' fichiers', n = 0);

  -- MS3 : S3 joué sous le chef.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  select count(*) into hors from storage.objects o
   where o.bucket_id in ('pieces','packs')
     and ((storage.foldername(o.name))[1])::uuid not in (select m.dossier_id from memberships m where m.user_id = client);
  reset role;
  insert into rls_mutation values ('MS3 — S3 joué sous le chef', 'des fichiers hors de ses dossiers', hors || ' fichiers', hors > 0);

  -- MS4 : le dépôt chez un autre, tenté par le chef.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; motif := null;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('pieces', autre_dossier::text || '/essai-mutation.pdf', chef::text);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  insert into rls_mutation values ('MS4 — dépôt chez un autre sous le chef', 'ACCEPTÉ',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end, accepte);

  -- MS5 : la mutation de S5, qui est un contrôle d'une autre nature (lecture du catalogue). Le
  -- risque qu'il couvre est qu'une migration supprime ou élargisse la policy : on vérifie donc que
  -- le contrôle sait dire « absente » en le posant sur un nom de policy qui n'existe pas.
  select count(*) into n from pg_policy
   where polrelid = 'storage.objects'::regclass
     and polname = 'policy_qui_n_existe_pas'
     and polcmd = 'd'
     and pg_get_expr(polqual, polrelid) like '%admin\_du\_dossier%';
  insert into rls_mutation values ('MS5 — S5 posé sur une policy inexistante', '0 trouvée', n || ' trouvée(s)', n = 0);
end $$;

-- Le verdict, les deux moitiés dans UN seul tableau. Ce n'est pas une coquetterie de présentation :
-- `execute_sql` ne rend que le résultat de la DERNIÈRE requête, donc en deux `select` le verdict des
-- invariants — le principal — ne s'afficherait jamais. Un harnais dont on ne voit pas la réponse est
-- un harnais absent.
--
-- Se lit ainsi : toute ligne INVARIANTS à « en faute » non nul est une policy à reprendre, pas un
-- réglage du test. Toute ligne MUTATIONS qui « NE MORD PAS » est un contrôle qui ne prouve plus rien,
-- même si les invariants au-dessus sont tous verts.
select 'INVARIANTS' as tableau, controle as ligne,
       count(*) filter (where not ok)::text || ' en faute / ' || count(*) || ' vérifications' as resultat,
       coalesce(string_agg(cible || ' (' || observe || ')', ', ') filter (where not ok), 'aucune') as detail
from rls_verdict group by controle
union all
select 'MUTATIONS', mutation,
       case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end,
       'attendu ' || attendu || ', observé ' || observe
from rls_mutation
order by 1 desc, 2;
