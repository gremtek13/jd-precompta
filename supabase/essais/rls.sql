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
-- Dernier passage : 19/09/2026 — 40 tables, 3 profils, 0 en faute, 7 mutations sur 7 détectées.

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
