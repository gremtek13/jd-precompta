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
--   5. `prochain_numero_facture` refuse l'anonyme. Malgré son nom elle CONSOMME un numéro : un appel
--      anonyme réussi creuserait un trou dans une suite annuelle qui n'en admet pas.
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
-- Dernier passage : 19/09/2026 — 16 lignes de verdict (40 tables du schéma + 3 buckets, 3 profils),
-- 0 en faute, et 12 mutations sur 12 qui mordent.

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

  -- ══ 5. La numérotation de facture refuse l'anonyme ═════════════════════════════════════════
  -- Elle CONSOMME un numéro malgré son nom : on relève le compteur avant et après pour prouver
  -- qu'aucun trou n'a été creusé, même si l'appel avait réussi.
  select coalesce(max(dernier_numero), -1) into numero_avant from facture_numerotation;
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false;
  begin
    perform prochain_numero_facture(autre_dossier, 2026, 'facture');
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then null;
    -- Ici le refus vient de la fonction elle-même (`raise exception 'Accès refusé'`, donc P0001
    -- aussi) et non d'une policy : on ne peut pas exiger un code précis, seulement qu'elle refuse
    -- ET que le compteur n'ait pas bougé — c'est ce second contrôle qui fait la preuve.
    when others then accepte := false; motif := sqlstate;
  end;
  reset role;
  select coalesce(max(dernier_numero), -1) into numero_apres from facture_numerotation;
  insert into rls_verdict values ('5. anonyme ne consomme pas de numéro', 'prochain_numero_facture',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end, not accepte);
  insert into rls_verdict values ('5. le compteur n''a pas bougé', 'facture_numerotation',
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

  -- M5 : la numérotation appelée par le chef, sur l'année fictive 2099 (voir l'en-tête de section).
  select coalesce(max(dernier_numero), -1) into numero_avant from facture_numerotation;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; motif := null;
  begin
    perform prochain_numero_facture(dossier_du_client, 2099, 'facture');
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  select coalesce(max(dernier_numero), -1) into numero_apres from facture_numerotation;
  insert into rls_mutation values ('M5 — numérotation appelée par le chef', 'ACCEPTÉ',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end, accepte);

  -- M5bis : et l'annulation a bien effacé la consommation, jusque sur une fonction SECURITY DEFINER.
  -- C'est la preuve que tout le reste du fichier peut écrire sans laisser de trace.
  select count(*) into restes from facture_numerotation where annee = 2099;
  insert into rls_mutation values ('M5bis — l''annulation efface la consommation', '0 ligne 2099, compteur inchangé',
    restes || ' ligne(s) 2099, ' || numero_avant || ' -> ' || numero_apres, restes = 0 and numero_avant = numero_apres);
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
