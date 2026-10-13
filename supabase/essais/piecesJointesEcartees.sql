-- LES PIÈCES JOINTES ÉCARTÉES À LA RÉCEPTION PAR E-MAIL, ÉPROUVÉES EN BASE (ligne 22.7, migration
-- `pieces_jointes_ecartees` ; ligne 22.8, migration `pieces_jointes_ecartees_depot` ; ligne 22.91, migration
-- `pieces_jointes_ecartees_vide`) — à rejouer par `execute_sql` après toute migration qui touche
-- `pieces_jointes_ecartees`, ses contraintes, ses policies, sa garde, `marquer_pieces_jointes_vues`, `admin_du_dossier`,
-- `is_super_admin` ou `memberships`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, client du dossier, chef du cabinet
-- (super-administrateur, le seul de la base), et deux profils d'essai : un membre du cabinet affecté à un AUTRE dossier
-- que celui du client, un chef du cabinet qui n'est pas super-administrateur :
--   - la table ne garde ni le nom du fichier, ni son extension, ni l'expéditeur, ni l'objet : huit colonnes, nommées ;
--   - la même pièce jointe ne s'écrit qu'une fois par dossier — la clé (dossier, empreinte) refuse le doublon (23505), et
--     l'écriture de receive-email (`on conflict … do nothing`) n'en ajoute pas ;
--   - personne ne lit sans session ni sans rattachement ; le client ne lit RIEN, pas même ce qui vient de son dossier ;
--     le cabinet du dossier lit (les contrôles POSITIFS : sans eux, les refus seraient satisfaits par une table que plus
--     personne n'atteint) ; un membre affecté à un autre dossier ne lit que celui-là ;
--   - personne n'écrit directement, sauf le super-administrateur par la porte de la restauration ; personne ne met à jour
--     directement, pas même lui ;
--   - `marquer_pieces_jointes_vues` refuse dans son ordre — l'accès au dossier annoncé d'abord (42501, « Accès refusé à
--     ce dossier. »), puis aucune pièce jointe désignée (22023), puis une pièce jointe qui n'est pas de ce dossier (P0002)
--     — chaque refus exigé par son CODE ET SA RAISON ; elle marque ce qu'on lui désigne, une fois : la première marque tient ;
--   - la garde n'admet à la mise à jour que le passage de « non vue » à « vue » ;
--   - le rôle des Edge Functions — receive-email, à la clé secrète — écrit comme elle (`on conflict … do nothing`), une
--     fois, et la garde le tient aussi : la clé secrète passe la RLS, pas un déclencheur ;
--   - LE DÉPÔT QUI A ÉCHOUÉ (ligne 22.8) : la raison `depot` s'admet ; son poids peut être INCONNU (null) — rien n'a été
--     lu —, et elle seule l'admet : le format et la taille sans poids se refusent, par la contrainte du poids connu ; un
--     poids de zéro se refuse quelle que soit la raison ; receive-email l'écrit une fois, et le rejeu de la même pièce
--     jointe — lue cette fois — n'écrit rien ; la garde refuse qu'un poids inconnu se pose après coup ou que la raison
--     change, et la marque « vue » s'y pose (contrôles 6, 7b, 33b, 36b, 37b, 46 et 47) ;
--   - ARRIVÉE VIDE (ligne 22.91) : la raison `vide` s'admet, au poids ZÉRO — et zéro n'est admis que pour elle : le format,
--     la taille et le dépôt échoué le refusent ; un poids positif, négatif ou inconnu se refuse pour elle, par la
--     contrainte du poids ou par celle du poids connu ; receive-email l'écrit une fois, et le rejeu de la même pièce
--     jointe — la même, ou d'une autre raison — n'écrit rien ; la garde refuse qu'un poids se pose après coup, que la
--     raison change ou que le poids devienne inconnu, et la marque « vue » s'y pose (contrôles 6, 7c, 33c, 36c, 37c, 48 et
--     49) ;
--   - CE QUE LE CLIENT LIT (ligne 22.9, migration `pieces_jointes_ecartees_au_client`) : la table lui reste fermée, et
--     `pieces_jointes_ecartees_du_client` lui rend, pour SON dossier seul, le jour à Paris, la raison et le poids des
--     pièces jointes reçues depuis 90 jours — bornes comprises —, du plus récent au plus ancien, vues par le cabinet ou
--     non, avec ou sans les cases « Ventes » et « Banque » ; ni l'identifiant, ni l'empreinte, ni la marque « vue », ni
--     son auteur. Refusée au client sur un autre dossier, à un compte rattaché à rien et à un membre du cabinet hors de
--     ses affectations (« Accès refusé à ce dossier. », 42501), et à l'anonyme par le droit d'exécution ; le cabinet du
--     dossier lit la même chose que le client ; sans ligne, un tableau vide, jamais nul (contrôles 38a à 38r, mutations
--     49a à 49f) ;
--   - et que RIEN ne reste en base.
--
-- SANS LA MIGRATION `pieces_jointes_ecartees_au_client`, une seule ligne la dit, « 38. EN ATTENTE », SANS être une
-- faute : une base d'avant son application (le 13/10/2026, sur l'accord du cabinet, S228B-Q1), ou une réplique qui ne
-- la porte pas, se rejoue aussi. Elle EN EST UNE si l'historique des migrations porte
-- `pieces_jointes_ecartees_au_client` sans que la fonction existe — sauf si une ligne
-- `retour_pieces_jointes_ecartees_au_client`, plus récente, dit son retour arrière.
--
-- SANS LA MIGRATION `pieces_jointes_ecartees_vide` (celle de 22.8 appliquée), les contrôles 6, 7c, 33c, 36c, 37c et 49 sont
-- en faute, et eux seuls : la base refuse alors la raison `vide` et tout poids de zéro. SANS NI L'UNE NI L'AUTRE, s'y
-- ajoutent les contrôles 7b, 33b, 36b, 37b, 46 et 47 : la base refuse aussi la raison `depot` et tout poids inconnu.
--
-- ÉPROUVÉ LE 13/10/2026 (ligne 22.8) sur une réplique égale à la production à 128 migrations (neuf familles de
-- signature.sql, et l'historique), vide et semée : sans la migration, 51 verdicts dont exactement ces 7 en faute ; avec
-- elle, 51 verdicts, 0 en faute. Treize mutations de la migration — le poids inconnu admis pour le format ou la taille,
-- la contrainte du poids connu retirée ou écrite `octets > 0 or …` (un null y passe), le null refusé partout, la raison
-- oubliée, mal écrite ou une de plus, zéro admis, la garde sans le poids, sans la raison ou par `<>` — : 13 vues.
--
-- ÉPROUVÉ LE 13/10/2026 (ligne 22.91) sur une réplique égale à la production à 129 migrations (neuf familles de
-- signature.sql, et l'historique), vide et semée : sans la migration, 57 verdicts dont exactement ces 6 en faute ; avec
-- elle, 57 verdicts, 0 en faute ; sans elle ni celle de 22.8, 57 verdicts dont les 12 dits plus haut. Seize mutations de
-- la migration — zéro admis pour le format, la taille ou le dépôt échoué ; un poids positif, négatif ou inconnu admis
-- pour la vide ; la règle écrite `octets > 0 or raison = 'vide'` ou `raison <> 'vide' or octets = 0` ; son remplacement
-- oublié, ou la contrainte retirée sans être reposée ; la raison oubliée, mal écrite ou une de plus ; la garde sans le
-- poids, sans la raison ou par `<>` — : 16 vues.
--
-- ÉPROUVÉ LE 13/10/2026 (ligne 22.9) sur une réplique égale à la production à 130 migrations (neuf familles de
-- signature.sql, et l'historique), vide et semée : sans la migration, 58 verdicts, 0 en faute (la ligne « 38. EN
-- ATTENTE ») ; avec elle, 81 verdicts, 0 en faute. Vingt-sept mutations de la migration — l'accès retiré, réduit au
-- cabinet, au client, aux cases « Ventes » ou « Banque » ; la fenêtre retirée, exclusive, à 30 ou à 91 jours ;
-- l'identifiant, la marque « vue » rendus ou le poids omis ; le jour universel ou l'instant ; l'ordre inversé ; les
-- lignes vues tues ; le dossier oublié ; nul au lieu de `[]` ; un autre message ou code de refus ; `SECURITY INVOKER`,
-- `volatile`, le chemin non fixé ; le droit laissé à PUBLIC ou rendu à l'anonyme ; une policy de lecture ouverte au client
-- à côté ; la migration à l'historique sans la fonction — : 27 vues. Le retour arrière joué : 58 verdicts, la ligne 38
-- en faute tant que sa ligne d'historique (`retour_pieces_jointes_ecartees_au_client`) manque, 0 avec elle.
--
-- Chaque contrôle s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), le verdict étant posé dans une VARIABLE
-- avant le `raise` — le mécanisme de rls.sql. Les lignes d'essai y sont posées par le propriétaire de la base, sous des
-- identifiants fixes qui n'existent pas. Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.pieces_jointes_ecartees`), que la requête finale lit : le fichier se joue d'un seul appel et ne crée aucune
-- table. Il ne porte AUCUNE instruction de suppression : aucune policy n'en ouvre (contrôle 2), et ce qu'une suppression
-- rencontre se joue sur une réplique.
--
-- LES MUTATIONS (contrôles 40 à 49) rejouent un contrôle avec un profil, une clé, un droit ou une raison délibérément
-- faux : chacune doit MORDRE, sans quoi le contrôle qu'elle vise ne regarde rien.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  -- Les deux lignes d'essai, sous des identifiants fixes : l'une dans le dossier du client, l'autre dans un autre dossier
  -- du même cabinet.
  ligne_client uuid := 'e5a70000-0000-4000-8000-000000000a01';
  ligne_autre uuid := 'e5a70000-0000-4000-8000-000000000a02';
  ligne_neuve uuid := 'e5a70000-0000-4000-8000-000000000a03';
  inconnue uuid := 'e5a70000-0000-4000-8000-000000000a09';
  e1 text := repeat('a', 64); e2 text := repeat('b', 64); e3 text := repeat('c', 64); e4 text := repeat('9', 64);
  e5 text := repeat('d', 64); e6 text := repeat('e', 64);
  -- Ce que la lecture du client (ligne 22.9) rend à chacun, et ce qu'elle refuse : posés dans des VARIABLES avant
  -- l'annulation de chaque sous-transaction, comme les verdicts.
  dossier_second uuid; dossier_tiers uuid; acces_avant text; avec_le_client boolean;
  rendu_client jsonb; rendu_chef jsonb; rendu_cases jsonb; rendu_second jsonb; rendu_membre jsonb; rendu_autre jsonb;
  rendu_89 jsonb; rendu_vide jsonb; code_vide text; cles_ligne text;
  code_bloc text; code_client text; code_chef text; code_cases text; code_second text; code_membre text; code_autre text;
  code_89 text; refus_autre text; refus_rien text; refus_anon text; refus_tiers text; mutation_anon text;
  lues_directement int; jour_paris date; jour_utc date;
  -- Le refus de la garde, mot pour mot : un refus de la garde se distingue ainsi de celui d'une contrainte, même code.
  refus_garde constant text := 'Une pièce jointe écartée ne change pas : seule sa marque « vue » se pose, une fois.';

  dossier_client uuid; dossier_autre uuid; cabinet uuid;
  lignes_avant int; admins_avant int; assignations_avant int;
  n int; m int; k int; rendu int; vue timestamptz; par uuid; champ text;
  code_recu text; message text; obs text; verdicts jsonb := '[]'::jsonb;
begin
  select mb.dossier_id into dossier_client from memberships mb where mb.user_id = client order by mb.dossier_id limit 1;
  select d.cabinet_id into cabinet from dossiers d where d.id = dossier_client;
  select d.id into dossier_autre from dossiers d where d.cabinet_id = cabinet and d.id <> dossier_client
    and not exists (select 1 from memberships mb where mb.user_id = client and mb.dossier_id = d.id) order by d.id limit 1;
  if dossier_client is null or cabinet is null or dossier_autre is null
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or exists (select 1 from pieces_jointes_ecartees where id in (ligne_client, ligne_autre, ligne_neuve, inconnue)) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, compte client déjà rattaché au cabinet, ou identifiant d''essai pris';
  end if;
  select count(*) into lignes_avant from pieces_jointes_ecartees;
  select count(*) into admins_avant from cabinet_admins;
  select count(*) into assignations_avant from dossier_assignations;

  -- ══ 1 à 5. Le catalogue ═══════════════════════════════════════════════════════════════════════════════════
  select string_agg(column_name, ',' order by column_name) into obs from information_schema.columns
   where table_schema = 'public' and table_name = 'pieces_jointes_ecartees';
  verdicts := verdicts || jsonb_build_object('controle', '1. huit colonnes, nommées : ni nom de fichier, ni extension, ni expéditeur, ni objet',
    'observe', coalesce(obs, 'aucune'), 'ok', coalesce(obs = 'dossier_id,empreinte,id,octets,raison,recue_le,vue_le,vue_par', false));

  select count(*) into n from pg_policy po
   where po.polrelid = 'public.pieces_jointes_ecartees'::regclass and po.polroles = array['authenticated'::regrole]::oid[] and (
     (po.polcmd = 'r' and pg_get_expr(po.polqual, po.polrelid) = 'admin_du_dossier(dossier_id)' and po.polwithcheck is null)
     or (po.polcmd = 'a' and po.polqual is null and pg_get_expr(po.polwithcheck, po.polrelid) = 'is_super_admin()'));
  select count(*) into m from pg_policy po where po.polrelid = 'public.pieces_jointes_ecartees'::regclass;
  select string_agg(po.polname, ', ' order by po.polname) into obs from pg_policy po
   where po.polrelid = 'public.pieces_jointes_ecartees'::regclass
     and (coalesce(pg_get_expr(po.polqual, po.polrelid), '') || coalesce(pg_get_expr(po.polwithcheck, po.polrelid), ''))
         ~ '(memberships|client_du_dossier|gere_les_ventes|gere_la_banque|droits_sur_le_dossier)';
  verdicts := verdicts || jsonb_build_object('controle', '2. deux policies : la lecture aux connectés sur admin_du_dossier, l''insertion de restauration au super-administrateur ; aucune branche client, ni mise à jour ni suppression ; RLS active',
    'observe', m || ' policy(s), ' || n || ' conforme(s), branche client : ' || coalesce(obs, 'aucune') || ', RLS '
      || (select relrowsecurity from pg_class where oid = 'public.pieces_jointes_ecartees'::regclass),
    'ok', coalesce(m = 2 and n = 2 and obs is null and (select relrowsecurity from pg_class where oid = 'public.pieces_jointes_ecartees'::regclass), false));

  select count(*) into n from pg_constraint k join pg_index i on i.indexrelid = k.conindid
   where k.conrelid = 'public.pieces_jointes_ecartees'::regclass and k.contype = 'u' and i.indpred is null
     and k.conkey = array[(select attnum from pg_attribute where attrelid = k.conrelid and attname = 'dossier_id'),
                          (select attnum from pg_attribute where attrelid = k.conrelid and attname = 'empreinte')]::smallint[];
  verdicts := verdicts || jsonb_build_object('controle', '3. la clé d''idempotence : une unicité TOTALE sur (dossier_id, empreinte)',
    'observe', n || ' contrainte(s)', 'ok', n = 1);

  select string_agg(p.proname || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '') || ':' || coalesce((
           select string_agg(q.g, '+' order by q.g) from (
             select case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end as g
             from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))) q), 'personne'),
         ' ; ' order by p.proname) into obs
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('marquer_pieces_jointes_vues', 'garder_piece_jointe_ecartee');
  verdicts := verdicts || jsonb_build_object('controle', '4. la fonction est SECURITY DEFINER, son chemin fixé, exécutable par les connectés seuls ; la garde, par personne',
    'observe', coalesce(obs, 'aucune'),
    'ok', coalesce(obs = 'garder_piece_jointe_ecartee:false:search_path="":personne ; marquer_pieces_jointes_vues:true:search_path=public:authenticated', false));

  select position('admin_du_dossier' in p.prosrc), position('pieces_jointes_ecartees' in p.prosrc) into n, m
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'marquer_pieces_jointes_vues';
  verdicts := verdicts || jsonb_build_object('controle', '5. la fonction vérifie l''accès avant de lire la table',
    'observe', 'accès au caractère ' || coalesce(n::text, '?') || ', première lecture au ' || coalesce(m::text, '?'),
    'ok', coalesce(n > 0 and m > n, false));

  -- ══ 6 à 12. Les contraintes et la clé ═════════════════════════════════════════════════════════════════════
  n := null; code_recu := null; message := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values
      (dossier_client, 'format', 12, e1), (dossier_client, 'taille', 20971521, e2), (dossier_client, 'depot', 12, e3),
      (dossier_client, 'vide', 0, e4);
    get diagnostics n = row_count;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'autre', 12, repeat('d', 64));
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '6. la raison est « format », « taille », « depot » (le dépôt a échoué) ou « vide » (arrivée vide), rien d''autre',
    'observe', coalesce(n::text, '?') || ' ligne(s) admise(s), puis ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(n = 4 and code_recu = '23514' and message like '%pieces_jointes_ecartees_raison%', false));

  code_recu := null; message := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 0, e1);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '7. un poids de zéro se refuse au format : seule une pièce jointe arrivée vide pèse zéro (contrôle 7c)',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(code_recu = '23514' and message like '%pieces_jointes_ecartees_octets%', false));

  -- 7b. Le poids d'un dépôt qui a échoué : inconnu (null) quand rien n'a été lu, positif sinon — elle seule admet un poids
  -- inconnu ; le format et la taille sans poids se refusent par la contrainte du poids connu, et zéro par celle du poids,
  -- quelle que soit la raison. Chaque refus est exigé par le NOM de sa contrainte.
  n := null; obs := ''; code_recu := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values
      (dossier_client, 'depot', null, e1), (dossier_client, 'depot', 4120, e2);
    get diagnostics n = row_count;
    foreach champ in array array['format', 'taille'] loop
      begin
        insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, champ, null, e3);
        obs := obs || champ || ':passe ';
      exception when others then
        obs := obs || champ || ':' || sqlstate || ':'
          || case when sqlerrm like '%pieces_jointes_ecartees_poids_connu%' then 'poids_connu' else sqlerrm end || ' ';
      end;
    end loop;
    begin
      insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'depot', 0, e3);
      obs := obs || 'depot-zero:passe';
    exception when others then
      obs := obs || 'depot-zero:' || sqlstate || ':'
        || case when sqlerrm like '%pieces_jointes_ecartees_octets%' then 'octets' else sqlerrm end;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '7b. un dépôt échoué admet un poids inconnu (null) ou positif, et lui seul : le format et la taille sans poids se refusent, zéro aussi',
    'observe', coalesce(n::text, '?') || ' ligne(s) « depot » admise(s), puis ' || coalesce(nullif(obs, ''), coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    'ok', coalesce(n = 2 and obs = 'format:23514:poids_connu taille:23514:poids_connu depot-zero:23514:octets' and code_recu = 'P0001', false));

  -- 7c. Une pièce jointe ARRIVÉE VIDE (ligne 22.91) pèse zéro, et elle seule : zéro s'admet pour elle ; un poids positif ou
  -- négatif se refuse pour elle par la contrainte du poids, un poids inconnu par celle du poids connu ; zéro se refuse à la
  -- taille et au dépôt échoué (au format : contrôle 7). Chaque refus est exigé par le NOM de sa contrainte, et chaque
  -- essai a sa propre empreinte : un essai admis à tort se lit tel, sans gêner le suivant.
  n := null; obs := ''; code_recu := null; message := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'vide', 0, e1);
    get diagnostics n = row_count;
    foreach champ in array array['vide:4120', 'vide:-1', 'vide:null', 'taille:0', 'depot:0'] loop
      begin
        insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte)
          values (dossier_client, split_part(champ, ':', 1), nullif(split_part(champ, ':', 2), 'null')::bigint, md5(champ) || md5(champ));
        obs := obs || champ || ':passe ';
      exception when others then
        obs := obs || champ || ':' || sqlstate || ':'
          || case when sqlerrm like '%pieces_jointes_ecartees_poids_connu%' then 'poids_connu'
                  when sqlerrm like '%pieces_jointes_ecartees_octets%' then 'octets' else sqlerrm end || ' ';
      end;
    end loop;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '7c. une pièce jointe arrivée vide pèse zéro, et elle seule : zéro admis pour elle ; un poids positif, négatif ou inconnu refusé pour elle ; zéro refusé à la taille et au dépôt échoué',
    'observe', coalesce(n::text, '?') || ' ligne(s) « vide » admise(s), puis '
      || coalesce(nullif(rtrim(obs), ''), coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    'ok', coalesce(n = 1 and rtrim(obs) = 'vide:4120:23514:octets vide:-1:23514:octets vide:null:23514:poids_connu taille:0:23514:octets depot:0:23514:octets'
      and code_recu = 'P0001', false));

  code_recu := null; message := null; n := null;
  begin
    begin
      insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, upper(e1));
    exception when others then n := case when sqlstate = '23514' then 1 else 0 end;
    end;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, left(e1, 63));
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '8. l''empreinte est un SHA-256 en hexadécimal minuscule, de 64 caractères',
    'observe', 'majuscules ' || coalesce(n::text, '?') || ', 63 caractères : ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(n = 1 and code_recu = '23514' and message like '%pieces_jointes_ecartees_empreinte%', false));

  code_recu := null; message := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte, vue_le) values (dossier_client, 'format', 12, e1, now());
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '9. une marque « vue » sans son auteur se refuse',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(code_recu = '23514' and message like '%pieces_jointes_ecartees_vue%', false));

  code_recu := null; message := null; n := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, e1);
    get diagnostics n = row_count;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'taille', 99999999, e1);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '10. la même pièce jointe (même dossier, même empreinte) ne s''écrit pas deux fois',
    'observe', coalesce(n::text, '?') || ' puis ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(n = 1 and code_recu = '23505' and message like '%pieces_jointes_ecartees_une_fois%', false));

  n := null; m := null; rendu := null; code_recu := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, e1)
      on conflict (dossier_id, empreinte) do nothing;
    get diagnostics n = row_count;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, e1)
      on conflict (dossier_id, empreinte) do nothing;
    get diagnostics m = row_count;
    select count(*) into rendu from pieces_jointes_ecartees where dossier_id = dossier_client and empreinte = e1;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '11. rejouée comme receive-email l''écrit (on conflict do nothing) : une seule ligne, sans erreur',
    'observe', coalesce(n::text, '?') || ' puis ' || coalesce(m::text, '?') || ' ligne(s) écrite(s), ' || coalesce(rendu::text, '?') || ' en base, ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 1 and m = 0 and rendu = 1 and code_recu = 'P0001', false));

  n := null; code_recu := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, e1), (dossier_autre, 'format', 12, e1);
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '12. la clé est celle d''un dossier : la même empreinte dans un autre dossier s''écrit',
    'observe', coalesce(n::text, '?') || ' ligne(s), ' || coalesce(code_recu, '?'), 'ok', coalesce(n = 2 and code_recu = 'P0001', false));

  -- ══ 13 à 18. Qui lit ════════════════════════════════════════════════════════════════════════════════════════
  -- Deux lignes : l'une dans le dossier du client, l'autre dans l'autre dossier du cabinet.
  n := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values
      (ligne_client, dossier_client, 'format', 4120, e1), (ligne_autre, dossier_autre, 'taille', 26214400, e2);
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    select count(*) into n from pieces_jointes_ecartees;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '13. l''anonyme ne voit aucune pièce jointe écartée',
    'observe', coalesce(n::text, '?') || ' vue(s) sur 2', 'ok', coalesce(n = 0 and code_recu = 'P0001', false));

  n := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values
      (ligne_client, dossier_client, 'format', 4120, e1), (ligne_autre, dossier_autre, 'taille', 26214400, e2);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    select count(*) into n from pieces_jointes_ecartees;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '14. un compte rattaché à rien ne voit aucune pièce jointe écartée',
    'observe', coalesce(n::text, '?') || ' vue(s) sur 2', 'ok', coalesce(n = 0 and code_recu = 'P0001', false));

  n := null; m := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values
      (ligne_client, dossier_client, 'format', 4120, e1), (ligne_autre, dossier_autre, 'taille', 26214400, e2);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from pieces_jointes_ecartees where dossier_id = dossier_client;
    select count(*) into m from pieces_jointes_ecartees;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '15. le client ne voit rien, pas même ce qui vient de son dossier',
    'observe', coalesce(n::text, '?') || ' vue(s) dans son dossier, ' || coalesce(m::text, '?') || ' en tout',
    'ok', coalesce(n = 0 and m = 0 and code_recu = 'P0001', false));

  n := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values
      (ligne_client, dossier_client, 'format', 4120, e1), (ligne_autre, dossier_autre, 'taille', 26214400, e2);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into n from pieces_jointes_ecartees where id in (ligne_client, ligne_autre);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '16. le chef du cabinet voit les deux (contrôle positif)',
    'observe', coalesce(n::text, '?') || ' vue(s) sur 2', 'ok', coalesce(n = 2 and code_recu = 'P0001', false));

  n := null; obs := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values
      (ligne_client, dossier_client, 'format', 4120, e1), (ligne_autre, dossier_autre, 'taille', 26214400, e2);
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
    insert into dossier_assignations (dossier_id, user_id) values (dossier_autre, client);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*), string_agg(case when dossier_id = dossier_autre then 'autre' else 'client' end, ',') into n, obs
      from pieces_jointes_ecartees where id in (ligne_client, ligne_autre);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '17. un membre affecté à l''autre dossier ne voit que celui-là',
    'observe', coalesce(n::text, '?') || ' vue(s) : ' || coalesce(obs, 'aucune'), 'ok', coalesce(n = 1 and obs = 'autre' and code_recu = 'P0001', false));

  n := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values
      (ligne_client, dossier_client, 'format', 4120, e1), (ligne_autre, dossier_autre, 'taille', 26214400, e2);
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from pieces_jointes_ecartees where id in (ligne_client, ligne_autre);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '18. un chef du cabinet qui n''est pas super-administrateur voit les deux',
    'observe', coalesce(n::text, '?') || ' vue(s) sur 2', 'ok', coalesce(n = 2 and code_recu = 'P0001', false));

  -- ══ 19 à 23. Qui écrit directement ══════════════════════════════════════════════════════════════════════════
  code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, e3);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '19. le client n''écrit pas, même dans son dossier',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''), 'ok', coalesce(code_recu = '42501', false));

  code_recu := null; message := null;
  begin
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, e3);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '20. un chef du cabinet n''écrit pas directement : la porte de l''écriture est la restauration, au super-administrateur',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''), 'ok', coalesce(code_recu = '42501', false));

  n := null; code_recu := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte, recue_le, vue_le, vue_par)
      values (ligne_neuve, dossier_client, 'format', 12, e3, now() - interval '3 days', now() - interval '2 days', chef);
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '21. le super-administrateur réinsère une ligne telle qu''elle était, vue comprise (la restauration)',
    'observe', coalesce(n::text, '?') || ' ligne(s), ' || coalesce(code_recu, '?'), 'ok', coalesce(n = 1 and code_recu = 'P0001', false));

  n := null; code_recu := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'format', 4120, e1);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    update pieces_jointes_ecartees set vue_le = now(), vue_par = client where id = ligne_client;
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '22. le client ne met rien à jour : aucune ligne touchée',
    'observe', coalesce(n::text, '?') || ' ligne(s), ' || coalesce(code_recu, '?'), 'ok', coalesce(n = 0 and code_recu = 'P0001', false));

  n := null; code_recu := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'format', 4120, e1);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    update pieces_jointes_ecartees set vue_le = now(), vue_par = chef where id = ligne_client;
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '23. le super-administrateur non plus : « vue » ne se pose que par la fonction',
    'observe', coalesce(n::text, '?') || ' ligne(s), ' || coalesce(code_recu, '?'), 'ok', coalesce(n = 0 and code_recu = 'P0001', false));

  -- ══ 24 à 35. Marquer vues ═══════════════════════════════════════════════════════════════════════════════════
  code_recu := null; message := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'format', 4120, e1);
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    perform marquer_pieces_jointes_vues(dossier_client, array[ligne_client]);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '24. l''anonyme n''exécute pas la fonction : refus du droit d''exécution',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(code_recu = '42501' and message like 'permission denied for function marquer_pieces_jointes_vues%', false));

  code_recu := null; message := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'format', 4120, e1);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    perform marquer_pieces_jointes_vues(dossier_client, array[ligne_client]);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '25. un compte rattaché à rien : « Accès refusé à ce dossier. »',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(code_recu = '42501' and message = 'Accès refusé à ce dossier.', false));

  code_recu := null; message := null; vue := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'format', 4120, e1);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    begin
      perform marquer_pieces_jointes_vues(dossier_client, array[ligne_client]);
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    select e.vue_le into vue from pieces_jointes_ecartees e where e.id = ligne_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then null;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '26. le client, sur son propre dossier : « Accès refusé à ce dossier. », et rien n''est marqué',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, '') || ', vue ' || coalesce(vue::text, 'non'),
    'ok', coalesce(code_recu = '42501' and message = 'Accès refusé à ce dossier.' and vue is null, false));

  code_recu := null; message := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'format', 4120, e1);
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
    insert into dossier_assignations (dossier_id, user_id) values (dossier_autre, client);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    perform marquer_pieces_jointes_vues(dossier_client, array[ligne_client]);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '27. un membre affecté à un autre dossier : « Accès refusé à ce dossier. »',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(code_recu = '42501' and message = 'Accès refusé à ce dossier.', false));

  code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform marquer_pieces_jointes_vues(gen_random_uuid(), array[ligne_client]);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '28. un dossier qui n''existe pas, même pour le super-administrateur : « Accès refusé à ce dossier. »',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(code_recu = '42501' and message = 'Accès refusé à ce dossier.', false));

  code_recu := null; message := null; obs := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    begin
      perform marquer_pieces_jointes_vues(dossier_client, null);
    exception when others then obs := sqlstate || ' ' || sqlerrm;
    end;
    perform marquer_pieces_jointes_vues(dossier_client, array[]::uuid[]);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '29. aucune pièce jointe désignée — nul ou vide : refusé, rang 2',
    'observe', coalesce(obs, '?') || ' / ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(obs = '22023 Aucune pièce jointe désignée.' and code_recu = '22023' and message = 'Aucune pièce jointe désignée.', false));

  code_recu := null; message := null; obs := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values
      (ligne_client, dossier_client, 'format', 4120, e1), (ligne_autre, dossier_autre, 'taille', 26214400, e2);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    begin
      perform marquer_pieces_jointes_vues(dossier_client, array[ligne_client, ligne_autre]);
    exception when others then obs := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    select count(*) into n from pieces_jointes_ecartees where id in (ligne_client, ligne_autre) and vue_le is not null;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '30. une pièce jointe d''un autre dossier désignée avec celle du dossier : refusé, rang 3, et rien n''est marqué',
    'observe', coalesce(obs, '?') || ', ' || coalesce(n::text, '?') || ' marquée(s)',
    'ok', coalesce(obs = 'P0002 Une pièce jointe désignée n''est pas de ce dossier : relire la liste avant de la marquer vue.' and n = 0, false));

  code_recu := null; message := null; obs := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'format', 4120, e1);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    begin
      perform marquer_pieces_jointes_vues(dossier_client, array[inconnue]);
    exception when others then obs := sqlstate;
    end;
    perform marquer_pieces_jointes_vues(dossier_client, array[ligne_client, null]);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '31. un identifiant inconnu, ou nul : refusé, rang 3',
    'observe', coalesce(obs, '?') || ' / ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(obs = 'P0002' and code_recu = 'P0002' and message like 'Une pièce jointe désignée n''est pas de ce dossier%', false));

  code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    perform marquer_pieces_jointes_vues(dossier_client, array[]::uuid[]);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '32. l''accès passe avant la désignation : rien de désigné, sans accès, c''est l''accès qui se refuse',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(code_recu = '42501' and message = 'Accès refusé à ce dossier.', false));

  rendu := null; vue := null; par := null; n := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values
      (ligne_client, dossier_client, 'format', 4120, e1), (ligne_autre, dossier_autre, 'taille', 26214400, e2);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    rendu := marquer_pieces_jointes_vues(dossier_client, array[ligne_client, ligne_client]);
    reset role;
    select e.vue_le, e.vue_par into vue, par from pieces_jointes_ecartees e where e.id = ligne_client;
    select count(*) into n from pieces_jointes_ecartees e where e.id = ligne_autre and e.vue_le is null;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '33. le chef marque vue la pièce jointe de son dossier : une ligne, son nom et l''instant ; l''autre dossier n''est pas touché',
    'observe', coalesce(rendu::text, '?') || ' marquée(s), par ' || coalesce(case when par = chef then 'le chef' else par::text end, 'personne')
      || ', l''autre non vue : ' || coalesce(n::text, '?') || ', ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(rendu = 1 and vue is not null and par = chef and n = 1 and code_recu = 'P0001', false));

  -- 33b. La même marque sur un dépôt échoué au poids inconnu : la fonction ne lit ni la raison ni le poids.
  rendu := null; vue := null; par := null; obs := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'depot', null, e1);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    rendu := marquer_pieces_jointes_vues(dossier_client, array[ligne_client]);
    reset role;
    select e.vue_le, e.vue_par, e.raison || ':' || coalesce(e.octets::text, 'inconnu') into vue, par, obs
      from pieces_jointes_ecartees e where e.id = ligne_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '33b. le chef marque vu un dépôt échoué au poids inconnu : la marque se pose, la raison et le poids restent tels que reçus',
    'observe', coalesce(rendu::text, '?') || ' marquée(s), par ' || coalesce(case when par = chef then 'le chef' else par::text end, 'personne')
      || ', ligne ' || coalesce(obs, '?') || ', ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(rendu = 1 and vue is not null and par = chef and obs = 'depot:inconnu' and code_recu = 'P0001', false));

  -- 33c. La même marque sur une pièce jointe arrivée vide (ligne 22.91) : la fonction ne lit ni la raison ni le poids.
  rendu := null; vue := null; par := null; obs := null; code_recu := null; message := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'vide', 0, e1);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    rendu := marquer_pieces_jointes_vues(dossier_client, array[ligne_client]);
    reset role;
    select e.vue_le, e.vue_par, e.raison || ':' || coalesce(e.octets::text, 'inconnu') into vue, par, obs
      from pieces_jointes_ecartees e where e.id = ligne_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '33c. le chef marque vue une pièce jointe arrivée vide : la marque se pose, la raison et le poids (zéro) restent tels que reçus',
    'observe', coalesce(rendu::text, '?') || ' marquée(s), par ' || coalesce(case when par = chef then 'le chef' else par::text end, 'personne')
      || ', ligne ' || coalesce(obs, '?') || ', ' || coalesce(code_recu, '?')
      || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
    'ok', coalesce(rendu = 1 and vue is not null and par = chef and obs = 'vide:0' and code_recu = 'P0001', false));

  rendu := null; vue := null; par := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte, vue_le, vue_par) values
      (ligne_client, dossier_client, 'format', 4120, e1, timestamptz '2026-10-01 08:00:00+00', chef);
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    rendu := marquer_pieces_jointes_vues(dossier_client, array[ligne_client]);
    reset role;
    select e.vue_le, e.vue_par into vue, par from pieces_jointes_ecartees e where e.id = ligne_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '34. une ligne déjà vue, marquée de nouveau par un autre : rien ne change, la première marque tient',
    'observe', coalesce(rendu::text, '?') || ' marquée(s), vue le ' || coalesce(vue::text, '?') || ' par ' || coalesce(case when par = chef then 'le chef' else par::text end, '?')
      || ', ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(rendu = 0 and vue = timestamptz '2026-10-01 08:00:00+00' and par = chef and code_recu = 'P0001', false));

  rendu := null; par := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_autre, dossier_autre, 'taille', 26214400, e2);
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
    insert into dossier_assignations (dossier_id, user_id) values (dossier_autre, client);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    rendu := marquer_pieces_jointes_vues(dossier_autre, array[ligne_autre]);
    reset role;
    select e.vue_par into par from pieces_jointes_ecartees e where e.id = ligne_autre;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '35. un membre affecté au dossier y marque vue (contrôle positif de l''affectation)',
    'observe', coalesce(rendu::text, '?') || ' marquée(s), par ' || coalesce(case when par = client then 'lui' else par::text end, 'personne')
      || ', ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(rendu = 1 and par = client and code_recu = 'P0001', false));

  -- ══ 36. La garde ═══════════════════════════════════════════════════════════════════════════════════════════
  -- Chaque colonne reçue, changée AVEC une marque « vue » valable : c'est la comparaison de la garde qui refuse, pas
  -- l'absence de marque. Puis un changement sans marque, une ligne vue rendue non vue, puis remarquée ; et la marque seule.
  obs := '';
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte, vue_le, vue_par) values
      (ligne_client, dossier_client, 'format', 4120, e1, null, null),
      (ligne_autre, dossier_autre, 'taille', 26214400, e2, timestamptz '2026-10-01 08:00:00+00', chef);
    foreach champ in array array[format('id = %L', ligne_neuve), format('dossier_id = %L', dossier_autre),
                                 'recue_le = recue_le - interval ''1 day''', 'raison = ''taille''', 'octets = octets + 1',
                                 'empreinte = repeat(''d'', 64)'] loop
      begin
        execute format('update pieces_jointes_ecartees set %s, vue_le = now(), vue_par = %L where id = %L', champ, chef, ligne_client);
        obs := obs || split_part(champ, ' ', 1) || ':passe ';
      exception when others then obs := obs || split_part(champ, ' ', 1) || ':' || sqlstate || ' ';
      end;
    end loop;
    begin
      update pieces_jointes_ecartees set raison = 'taille' where id = ligne_client;
      obs := obs || 'seule:passe ';
    exception when others then obs := obs || 'seule:' || sqlstate || ' ';
    end;
    begin
      update pieces_jointes_ecartees set vue_le = null, vue_par = null where id = ligne_autre;
      obs := obs || 'devue:passe ';
    exception when others then obs := obs || 'devue:' || sqlstate || ' ';
    end;
    begin
      update pieces_jointes_ecartees set vue_le = now() where id = ligne_autre;
      obs := obs || 'revue:passe ';
    exception when others then obs := obs || 'revue:' || sqlstate || ' ';
    end;
    begin
      update pieces_jointes_ecartees set vue_le = now(), vue_par = chef where id = ligne_client;
      obs := obs || 'vue:passe';
    exception when others then obs := obs || 'vue:' || sqlstate;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '36. la garde : rien de ce qui a été reçu ne change, une ligne vue ne redevient pas non vue ni ne se remarque ; seul « vue » se pose',
    'observe', obs, 'ok', coalesce(obs = 'id:23514 dossier_id:23514 recue_le:23514 raison:23514 octets:23514 empreinte:23514 '
      || 'seule:23514 devue:23514 revue:23514 vue:passe' and code_recu = 'P0001', false));

  -- 36b. La garde sur un dépôt échoué au poids INCONNU : un poids posé après coup, la raison changée — seule, ou avec un
  -- poids, ce qui ferait une ligne « format » valable —, chacun AVEC une marque valable, se refusent par la GARDE (son
  -- message, pas celui d'une contrainte) ; la marque seule passe, et ne se repose pas.
  obs := ''; code_recu := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'depot', null, e1);
    foreach champ in array array['octets = 4120', 'raison = ''format''', 'raison = ''format'', octets = 4120'] loop
      begin
        execute format('update pieces_jointes_ecartees set %s, vue_le = now(), vue_par = %L where id = %L', champ, chef, ligne_client);
        obs := obs || replace(champ, ' ', '') || ':passe ';
      exception when others then
        obs := obs || replace(champ, ' ', '') || ':' || case when sqlerrm = refus_garde then 'garde' else sqlstate || ' ' || sqlerrm end || ' ';
      end;
    end loop;
    begin
      update pieces_jointes_ecartees set vue_le = now(), vue_par = chef where id = ligne_client;
      obs := obs || 'vue:passe ';
    exception when others then obs := obs || 'vue:' || sqlstate || ' ';
    end;
    begin
      update pieces_jointes_ecartees set vue_le = now() + interval '1 hour' where id = ligne_client;
      obs := obs || 'revue:passe';
    exception when others then obs := obs || 'revue:' || case when sqlerrm = refus_garde then 'garde' else sqlstate end;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '36b. la garde sur un dépôt échoué au poids inconnu : ni poids posé après coup, ni raison changée ; seule la marque « vue » se pose, une fois',
    'observe', coalesce(nullif(obs, ''), coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    'ok', coalesce(obs = 'octets=4120:garde raison=''format'':garde raison=''format'',octets=4120:garde vue:passe revue:garde'
      and code_recu = 'P0001', false));

  -- 36c. La garde sur une pièce jointe arrivée vide (ligne 22.91) : un poids posé après coup, la raison changée — seule, ou
  -- avec un poids, ce qui ferait une ligne « format » valable —, le poids rendu inconnu, chacun AVEC une marque valable, se
  -- refusent par la GARDE (son message, pas celui d'une contrainte) ; la marque seule passe, et ne se repose pas.
  obs := ''; code_recu := null; message := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'vide', 0, e1);
    foreach champ in array array['octets = 4120', 'raison = ''depot''', 'raison = ''format'', octets = 4120', 'octets = null'] loop
      begin
        execute format('update pieces_jointes_ecartees set %s, vue_le = now(), vue_par = %L where id = %L', champ, chef, ligne_client);
        obs := obs || replace(champ, ' ', '') || ':passe ';
      exception when others then
        obs := obs || replace(champ, ' ', '') || ':' || case when sqlerrm = refus_garde then 'garde' else sqlstate || ' ' || sqlerrm end || ' ';
      end;
    end loop;
    begin
      update pieces_jointes_ecartees set vue_le = now(), vue_par = chef where id = ligne_client;
      obs := obs || 'vue:passe ';
    exception when others then obs := obs || 'vue:' || sqlstate || ' ';
    end;
    begin
      update pieces_jointes_ecartees set vue_le = now() + interval '1 hour' where id = ligne_client;
      obs := obs || 'revue:passe';
    exception when others then obs := obs || 'revue:' || case when sqlerrm = refus_garde then 'garde' else sqlstate end;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '36c. la garde sur une pièce jointe arrivée vide : ni poids posé après coup, ni raison changée, ni poids rendu inconnu ; seule la marque « vue » se pose, une fois',
    'observe', coalesce(nullif(obs, ''), coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    'ok', coalesce(obs = 'octets=4120:garde raison=''depot'':garde raison=''format'',octets=4120:garde octets=null:garde vue:passe revue:garde'
      and code_recu = 'P0001', false));

  -- ══ 37. Le rôle des Edge Functions : receive-email écrit à la clé secrète ═══════════════════════════════════
  -- Son écriture telle que PostgREST la passe (`on conflict … do nothing`), puis son rejeu — la même pièce jointe,
  -- d'autres valeurs : rien ne s'écrit, sans erreur, et la ligne reste telle qu'elle a été reçue — ; puis une mise à
  -- jour de ce qui a été reçu, que la garde refuse aussi à ce rôle.
  n := null; m := null; rendu := null; obs := null; code_recu := null;
  begin
    set local role service_role;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, e1)
      on conflict (dossier_id, empreinte) do nothing;
    get diagnostics n = row_count;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'taille', 99999999, e1)
      on conflict (dossier_id, empreinte) do nothing;
    get diagnostics m = row_count;
    select count(*) into rendu from pieces_jointes_ecartees
     where dossier_id = dossier_client and empreinte = e1 and raison = 'format' and octets = 12 and vue_le is null;
    begin
      update pieces_jointes_ecartees set octets = 13 where dossier_id = dossier_client and empreinte = e1;
      obs := 'passe';
    exception when others then obs := sqlstate;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '37. le rôle des Edge Functions (receive-email, à la clé secrète) écrit comme elle, une fois — le rejeu n''écrit rien, sans erreur — et la garde le tient aussi',
    'observe', coalesce(n::text, '?') || ' puis ' || coalesce(m::text, '?') || ' ligne(s) écrite(s), ' || coalesce(rendu::text, '?')
      || ' telle que reçue, mise à jour : ' || coalesce(obs, '?') || ', ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 1 and m = 0 and rendu = 1 and obs = '23514' and code_recu = 'P0001', false));

  -- 37b. Le dépôt échoué, tel que receive-email l'écrit à la clé secrète : au poids inconnu, une fois ; le rejeu de la même
  -- pièce jointe, lue cette fois et refusée à son format, n'écrit rien, sans erreur, et la ligne reste telle qu'elle a été
  -- reçue ; un poids posé après coup, AVEC une marque valable, se refuse par la garde, à ce rôle aussi.
  n := null; m := null; rendu := null; obs := null; code_recu := null;
  begin
    set local role service_role;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'depot', null, e1)
      on conflict (dossier_id, empreinte) do nothing;
    get diagnostics n = row_count;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 4120, e1)
      on conflict (dossier_id, empreinte) do nothing;
    get diagnostics m = row_count;
    select count(*) into rendu from pieces_jointes_ecartees
     where dossier_id = dossier_client and empreinte = e1 and raison = 'depot' and octets is null and vue_le is null;
    begin
      update pieces_jointes_ecartees set octets = 4120, vue_le = now(), vue_par = chef where dossier_id = dossier_client and empreinte = e1;
      obs := 'passe';
    exception when others then obs := case when sqlerrm = refus_garde then 'garde' else sqlstate || ' ' || sqlerrm end;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '37b. receive-email écrit un dépôt échoué au poids inconnu, une fois — le rejeu, même lu et d''une autre raison, n''écrit rien — et la garde le tient',
    'observe', coalesce(n::text, '?') || ' puis ' || coalesce(m::text, '?') || ' ligne(s) écrite(s), ' || coalesce(rendu::text, '?')
      || ' telle que reçue, poids posé après coup : ' || coalesce(obs, '?') || ', ' || coalesce(code_recu, '?')
      || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
    'ok', coalesce(n = 1 and m = 0 and rendu = 1 and obs = 'garde' and code_recu = 'P0001', false));

  -- 37c. La pièce jointe arrivée vide, telle que receive-email l'écrit à la clé secrète (ligne 22.91) : au poids zéro, une
  -- fois ; le rejeu de la même pièce jointe — vide de nouveau, ou dont le téléchargement a échoué cette fois — n'écrit
  -- rien, sans erreur, et la ligne reste telle qu'elle a été reçue ; un poids posé après coup, AVEC une marque valable,
  -- se refuse par la garde, à ce rôle aussi.
  n := null; m := null; rendu := null; obs := null; code_recu := null; message := null;
  begin
    set local role service_role;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'vide', 0, e1)
      on conflict (dossier_id, empreinte) do nothing;
    get diagnostics n = row_count;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'vide', 0, e1)
      on conflict (dossier_id, empreinte) do nothing;
    get diagnostics m = row_count;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'depot', null, e1)
      on conflict (dossier_id, empreinte) do nothing;
    get diagnostics k = row_count;
    m := m + k;
    select count(*) into rendu from pieces_jointes_ecartees
     where dossier_id = dossier_client and empreinte = e1 and raison = 'vide' and octets = 0 and vue_le is null;
    begin
      update pieces_jointes_ecartees set octets = 4120, vue_le = now(), vue_par = chef where dossier_id = dossier_client and empreinte = e1;
      obs := 'passe';
    exception when others then obs := case when sqlerrm = refus_garde then 'garde' else sqlstate || ' ' || sqlerrm end;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '37c. receive-email écrit une pièce jointe arrivée vide au poids zéro, une fois — ses deux rejeux, vide de nouveau ou au téléchargement échoué, n''écrivent rien — et la garde la tient',
    'observe', coalesce(n::text, '?') || ' puis ' || coalesce(m::text, '?') || ' ligne(s) écrite(s), ' || coalesce(rendu::text, '?')
      || ' telle que reçue, poids posé après coup : ' || coalesce(obs, '?') || ', ' || coalesce(code_recu, '?')
      || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
    'ok', coalesce(n = 1 and m = 0 and rendu = 1 and obs = 'garde' and code_recu = 'P0001', false));

  -- ══ 40 à 49. Les mutations ═════════════════════════════════════════════════════════════════════════════════
  -- 40. Le contrôle 15 joué sous le chef : il doit voir la ligne du dossier du client.
  n := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'format', 4120, e1);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into n from pieces_jointes_ecartees where dossier_id = dossier_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '40. MUTATION — le contrôle 15 joué sous le chef : il doit voir la ligne',
    'observe', coalesce(n::text, '?') || ' vue(s)', 'ok', coalesce(n >= 1, false));

  -- 41. Le contrôle 19 joué sous le super-administrateur : l'écriture passe.
  n := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, e3);
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '41. MUTATION — le contrôle 19 joué sous le super-administrateur : l''écriture doit passer',
    'observe', coalesce(n::text, 'refusée'), 'ok', coalesce(n = 1, false));

  -- 42. Le contrôle 26 joué sous le chef : la marque passe.
  rendu := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'format', 4120, e1);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    rendu := marquer_pieces_jointes_vues(dossier_client, array[ligne_client]);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '42. MUTATION — le contrôle 26 joué sous le chef : la marque doit passer',
    'observe', coalesce(rendu::text, 'refusée'), 'ok', coalesce(rendu = 1, false));

  -- 43. Le contrôle 10 avec deux empreintes différentes : les deux s'écrivent.
  n := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, e1), (dossier_client, 'taille', 99999999, e2);
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '43. MUTATION — le contrôle 10 avec deux empreintes : les deux doivent s''écrire',
    'observe', coalesce(n::text, 'refusées'), 'ok', coalesce(n = 2, false));

  -- 44. Le contrôle 24 avec le droit d'exécution rendu à l'anonyme : c'est alors la fonction qui refuse.
  message := null;
  begin
    insert into pieces_jointes_ecartees (id, dossier_id, raison, octets, empreinte) values (ligne_client, dossier_client, 'format', 4120, e1);
    grant execute on function public.marquer_pieces_jointes_vues(uuid, uuid[]) to anon;
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    begin
      perform marquer_pieces_jointes_vues(dossier_client, array[ligne_client]);
    exception when others then message := sqlerrm;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '44. MUTATION — le contrôle 24 avec le droit rendu à l''anonyme : le refus doit changer',
    'observe', coalesce(message, '?'), 'ok', coalesce(message = 'Accès refusé à ce dossier.', false));

  -- 45. Le contrôle 37 joué sous une session ordinaire — celle du client — au lieu du rôle des Edge Functions :
  -- l'écriture se refuse. (Le droit d'insertion de ce rôle se lit au contrôle 50 ; le lui retirer est une mutation de
  -- la migration, jouée sur une réplique, jamais un geste d'un essai qui se joue en production.)
  message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    begin
      insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 12, e1)
        on conflict (dossier_id, empreinte) do nothing;
      message := 'passe';
    exception when others then message := sqlstate;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '45. MUTATION — le contrôle 37 joué sous la session du client : l''écriture doit se refuser',
    'observe', coalesce(message, '?'), 'ok', coalesce(message = '42501', false));

  -- 46. Le refus du contrôle 7b — le format sans poids — rejoué avec la raison « depot » : l'écriture passe. C'est la raison
  -- qui décide si le poids peut manquer, rien d'autre.
  n := null; message := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'depot', null, e3);
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '46. MUTATION — le refus du contrôle 7b (le format sans poids) rejoué avec la raison « depot » : l''écriture doit passer',
    'observe', coalesce(n::text, coalesce(code_recu, '?') || ' ' || coalesce(message, '')), 'ok', coalesce(n = 1, false));

  -- 47. Le rejeu du contrôle 37b sous une AUTRE empreinte (une autre pièce jointe) : la seconde s'écrit. C'est la clé
  -- (dossier, empreinte) qui fait taire le rejeu, pas la raison ni le poids.
  n := null; m := null; message := null;
  begin
    set local role service_role;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'depot', null, e1)
      on conflict (dossier_id, empreinte) do nothing;
    get diagnostics n = row_count;
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 4120, e2)
      on conflict (dossier_id, empreinte) do nothing;
    get diagnostics m = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '47. MUTATION — le rejeu du contrôle 37b sous une autre empreinte : la seconde ligne doit s''écrire',
    'observe', coalesce(n::text, '?') || ' puis ' || coalesce(m::text, '?') || ' ligne(s), ' || coalesce(code_recu, '?')
      || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
    'ok', coalesce(n = 1 and m = 1 and code_recu = 'P0001', false));

  -- 48. Le premier refus du contrôle 7c — une pièce jointe vide au poids positif — rejoué avec la raison « format » :
  -- l'écriture passe. C'est la raison qui décide que le poids est zéro, rien d'autre.
  n := null; code_recu := null; message := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'format', 4120, e3);
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '48. MUTATION — le refus du contrôle 7c (une pièce jointe vide au poids positif) rejoué avec la raison « format » : l''écriture doit passer',
    'observe', coalesce(n::text, coalesce(code_recu, '?') || ' ' || coalesce(message, '')), 'ok', coalesce(n = 1, false));

  -- 49. Le refus du contrôle 7 — le format au poids zéro — rejoué avec la raison « vide » : l'écriture passe. C'est la
  -- raison qui décide si le poids peut être zéro.
  n := null; code_recu := null; message := null;
  begin
    insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte) values (dossier_client, 'vide', 0, e1);
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '49. MUTATION — le refus du contrôle 7 (le format au poids zéro) rejoué avec la raison « vide » : l''écriture doit passer',
    'observe', coalesce(n::text, coalesce(code_recu, '?') || ' ' || coalesce(message, '')), 'ok', coalesce(n = 1, false));

  -- ══ 38 et 49a à 49f. Ce que le client lit : `pieces_jointes_ecartees_du_client` (ligne 22.9) ═══════════════════════
  -- La fonction est appelée par son nom dans des branches que PL/pgSQL ne prépare qu'en les exécutant : sans elle, seule
  -- la ligne « EN ATTENTE » se joue.
  if to_regprocedure('public.pieces_jointes_ecartees_du_client(uuid)') is null then
    -- La dernière des deux lignes d'historique décide : la migration, ou son retour arrière.
    select coalesce((select s.name from supabase_migrations.schema_migrations s
                      where s.name in ('pieces_jointes_ecartees_au_client', 'retour_pieces_jointes_ecartees_au_client')
                      order by s.version desc limit 1) = 'pieces_jointes_ecartees_au_client', false) into avec_le_client;
    verdicts := verdicts || jsonb_build_object('controle', '38. EN ATTENTE : la lecture du client (pieces_jointes_ecartees_du_client, ligne 22.9) n''est pas en base',
      'observe', case when avec_le_client
                      then 'la migration pieces_jointes_ecartees_au_client est à l''historique, sans retour arrière, et la fonction manque'
                      else 'la migration pieces_jointes_ecartees_au_client n''est pas appliquée, ou son retour arrière l''a suivie' end,
      'ok', not avec_le_client);
  else
    -- Le second dossier du client, s'il en a un ; un troisième dossier du cabinet, ni le sien ni l'autre.
    select mb.dossier_id into dossier_second from memberships mb
     where mb.user_id = client and mb.dossier_id <> dossier_client order by mb.dossier_id limit 1;
    select d.id into dossier_tiers from dossiers d
     where d.cabinet_id = cabinet and d.id <> dossier_client and d.id <> dossier_autre
       and not exists (select 1 from memberships mb where mb.user_id = client and mb.dossier_id = d.id) order by d.id limit 1;
    select md5(coalesce(string_agg(mb::text, ',' order by mb.id), '')) into acces_avant from memberships mb;
    -- Le jour d'une réception à 23 h 30 en temps universel, avant-hier : à Paris, c'est déjà hier (UTC+1 ou UTC+2).
    jour_utc := (now() at time zone 'UTC')::date - 2;
    jour_paris := jour_utc + 1;

    -- ── 38a, 38b. Le catalogue ──
    select p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || '):' || p.prosecdef::text || ':'
           || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ','), '') || ':' || pg_get_function_result(p.oid)
           || ':' || coalesce((
             select string_agg(q.g, '+' order by q.g) from (
               select case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end as g
               from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))) q), 'personne')
      into obs from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'pieces_jointes_ecartees_du_client';
    verdicts := verdicts || jsonb_build_object('controle', '38a. la lecture du client est une fonction SECURITY DEFINER, stable, au chemin fixé, qui rend UNE valeur jsonb ; exécutable par les connectés seuls',
      'observe', coalesce(obs, 'aucune'),
      'ok', coalesce(obs = 'pieces_jointes_ecartees_du_client(p_dossier_id uuid):true:s:search_path=public:jsonb:authenticated', false));

    select position('admin_du_dossier(p_dossier_id)' in p.prosrc), position('client_du_dossier(p_dossier_id, ''membre'')' in p.prosrc),
           position('raise exception' in p.prosrc), position('pieces_jointes_ecartees' in p.prosrc)
      into n, m, k, rendu from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'pieces_jointes_ecartees_du_client';
    verdicts := verdicts || jsonb_build_object('controle', '38b. elle vérifie l''accès — le cabinet du dossier, ou TOUT accès client (« membre ») — avant de lire la table',
      'observe', 'cabinet au caractère ' || coalesce(n::text, '?') || ', accès client au ' || coalesce(m::text, '?')
        || ', refus au ' || coalesce(k::text, '?') || ', première lecture au ' || coalesce(rendu::text, '?'),
      'ok', coalesce(n > 0 and m > 0 and k > greatest(n, m) and rendu > k, false));

    -- ── Un seul jeu, posé par le propriétaire, et chaque appel dans sa sous-transaction ──
    -- Dans le dossier du client : hier (format), avant-hier à 23 h 30 en temps universel (un dépôt échoué, poids
    -- inconnu), il y a dix jours (une taille refusée, VUE par le cabinet), il y a 90 jours exactement (une vide), il y a
    -- 90 jours et une minute (hors de la fenêtre). Dans l'autre dossier, le second dossier du client et le troisième
    -- dossier du cabinet : une ligne chacun, hier, à un poids qui les désigne (999, 777, 555).
    code_bloc := null;
    rendu_client := null; rendu_chef := null; rendu_cases := null; rendu_second := null; rendu_membre := null;
    rendu_autre := null; rendu_89 := null; rendu_vide := null; code_vide := null; cles_ligne := null;
    code_client := null; code_chef := null; code_cases := null; code_second := null; code_membre := null; code_autre := null;
    code_89 := null; refus_autre := null; refus_rien := null; refus_anon := null; refus_tiers := null; mutation_anon := null;
    lues_directement := null;
    begin
      insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte, recue_le, vue_le, vue_par) values
        (dossier_client, 'format', 4120, e1, now() - interval '1 day', null, null),
        (dossier_client, 'depot', null, e2, (jour_utc + time '23:30') at time zone 'UTC', null, null),
        (dossier_client, 'taille', 26214400, e3, now() - interval '10 days', now() - interval '9 days', chef),
        (dossier_client, 'vide', 0, e4, now() - interval '90 days', null, null),
        (dossier_client, 'taille', 27000000, e5, now() - interval '90 days 1 minute', null, null),
        (dossier_autre, 'format', 999, e1, now() - interval '1 day', null, null);
      if dossier_second is not null then
        insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte, recue_le) values (dossier_second, 'format', 777, e1, now() - interval '1 day');
      end if;
      if dossier_tiers is not null then
        insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte, recue_le) values (dossier_tiers, 'format', 555, e1, now() - interval '1 day');
      end if;

      -- Le client, sans aucune case, sur son dossier — et ce qu'il lit encore DIRECTEMENT de la table.
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        rendu_client := pieces_jointes_ecartees_du_client(dossier_client);
        select count(*) into lues_directement from pieces_jointes_ecartees;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_client := sqlstate;
      end;
      reset role;

      -- Le chef du cabinet, sur le même dossier.
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        rendu_chef := pieces_jointes_ecartees_du_client(dossier_client);
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_chef := sqlstate;
      end;
      reset role;

      -- Le chef, sur un dossier qu'aucune ligne ne désigne (un identifiant tiré au hasard : le super-administrateur a accès
      -- à tout dossier) : un tableau vide, jamais nul.
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        rendu_vide := pieces_jointes_ecartees_du_client(gen_random_uuid());
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_vide := sqlstate;
      end;
      reset role;

      -- Le client, les deux cases de son accès cochées.
      begin
        update memberships set droit_ventes = true, droit_banque = true where user_id = client and dossier_id = dossier_client;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        rendu_cases := pieces_jointes_ecartees_du_client(dossier_client);
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_cases := sqlstate;
      end;
      reset role;

      -- Le client, sur son second dossier.
      if dossier_second is not null then
        begin
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
          rendu_second := pieces_jointes_ecartees_du_client(dossier_second);
          raise exception 'ANNULATION_ESSAI';
        exception when others then code_second := sqlstate;
        end;
        reset role;
      end if;

      -- Le client, sur l'autre dossier du cabinet ; un compte rattaché à rien ; l'anonyme.
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        perform pieces_jointes_ecartees_du_client(dossier_autre);
        raise exception 'ANNULATION_ESSAI';
      exception when others then refus_autre := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
        perform pieces_jointes_ecartees_du_client(dossier_client);
        raise exception 'ANNULATION_ESSAI';
      exception when others then refus_rien := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      begin
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        perform pieces_jointes_ecartees_du_client(dossier_client);
        raise exception 'ANNULATION_ESSAI';
      exception when others then refus_anon := sqlstate || ' ' || sqlerrm;
      end;
      reset role;

      -- Le client devenu membre du cabinet, affecté à l'autre dossier : il le lit ; le troisième lui reste refusé.
      begin
        insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
        insert into dossier_assignations (dossier_id, user_id) values (dossier_autre, client);
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        rendu_membre := pieces_jointes_ecartees_du_client(dossier_autre);
        if dossier_tiers is not null then
          begin
            perform pieces_jointes_ecartees_du_client(dossier_tiers);
            refus_tiers := 'lu';
          exception when others then refus_tiers := sqlstate || ' ' || sqlerrm;
          end;
        end if;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_membre := sqlstate;
      end;
      reset role;

      -- Mutation 49a : le refus de l'anonyme rejoué avec le droit d'exécution rendu — c'est alors la fonction qui refuse.
      begin
        grant execute on function public.pieces_jointes_ecartees_du_client(uuid) to anon;
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        begin
          perform pieces_jointes_ecartees_du_client(dossier_client);
          mutation_anon := 'lu';
        exception when others then mutation_anon := sqlerrm;
        end;
        raise exception 'ANNULATION_ESSAI';
      exception when others then null;
      end;
      reset role;

      -- Mutation 49c : le refus de l'autre dossier rejoué avec un accès du client posé sur ce dossier.
      begin
        insert into memberships (user_id, dossier_id, role) values (client, dossier_autre, 'client');
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        rendu_autre := pieces_jointes_ecartees_du_client(dossier_autre);
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_autre := sqlstate;
      end;
      reset role;

      -- Mutation 49d : la borne rejouée avec une pièce jointe reçue il y a 89 jours — elle doit être rendue.
      begin
        insert into pieces_jointes_ecartees (dossier_id, raison, octets, empreinte, recue_le) values (dossier_client, 'format', 1234, e6, now() - interval '89 days');
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        rendu_89 := pieces_jointes_ecartees_du_client(dossier_client);
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_89 := sqlstate;
      end;
      reset role;

      -- Mutation 49e : la règle des clés appliquée à une ligne de la TABLE (ce qu'une policy ouvrirait) — elle doit refuser.
      select string_agg(x, ',' order by x) into cles_ligne
        from jsonb_object_keys((select to_jsonb(e) from pieces_jointes_ecartees e where e.dossier_id = dossier_client limit 1)) x;

      raise exception 'ANNULATION_ESSAI';
    exception when others then code_bloc := sqlstate || ' ' || sqlerrm;
    end;
    reset role;

    -- ── 38c à 38q. Les verdicts ──
    -- Ce que le client a lu, élément par élément : « raison/poids@jour ».
    select string_agg((x->>'raison') || '/' || coalesce(x->>'octets', 'inconnu') || '@' || coalesce(x->>'jour', '?'), ',' order by i)
      into obs from jsonb_array_elements(case when jsonb_typeof(rendu_client) = 'array' then rendu_client else '[]'::jsonb end) with ordinality t(x, i);
    verdicts := verdicts || jsonb_build_object('controle', '38c. le client, sans aucune case, lit SON dossier : les quatre pièces jointes des 90 derniers jours, de la plus récente à la plus ancienne — ni celle d''un autre dossier, ni celle de son second, ni celle d''avant',
      'observe', coalesce(code_bloc, '?') || ' ; ' || coalesce(code_client, '?') || ' : ' || coalesce(obs, 'rien'),
      'ok', coalesce(code_bloc = 'P0001 ANNULATION_ESSAI' and code_client = 'P0001'
        and obs = 'format/4120@' || ((now() - interval '1 day') at time zone 'Europe/Paris')::date
          || ',depot/inconnu@' || jour_paris
          || ',taille/26214400@' || ((now() - interval '10 days') at time zone 'Europe/Paris')::date
          || ',vide/0@' || ((now() - interval '90 days') at time zone 'Europe/Paris')::date, false));

    select string_agg(distinct cles, ' | ') into obs from (
      select (select string_agg(c, ',' order by c) from jsonb_object_keys(x) c) as cles
      from jsonb_array_elements(case when jsonb_typeof(rendu_client) = 'array' then rendu_client else '[]'::jsonb end) x) q;
    verdicts := verdicts || jsonb_build_object('controle', '38d. chaque élément porte trois champs, le jour, la raison et le poids — ni l''identifiant, ni l''empreinte, ni la marque « vue » ni son auteur, ni le dossier',
      'observe', coalesce(obs, 'aucun élément'), 'ok', coalesce(obs = 'jour,octets,raison', false));

    select x->>'jour' into obs from jsonb_array_elements(case when jsonb_typeof(rendu_client) = 'array' then rendu_client else '[]'::jsonb end) x
     where x->>'raison' = 'depot';
    verdicts := verdicts || jsonb_build_object('controle', '38e. le jour est celui de Paris : reçue à 23 h 30 en temps universel, elle se dit du lendemain',
      'observe', 'reçue le ' || jour_utc || ' à 23 h 30 UTC, rendue au ' || coalesce(obs, '?'), 'ok', coalesce(obs = jour_paris::text, false));

    verdicts := verdicts || jsonb_build_object('controle', '38f. la marque « vue » du cabinet ne change rien pour le client : la pièce jointe vue lui est rendue, sans sa marque',
      'observe', coalesce(rendu_client::text, '?'),
      'ok', coalesce(rendu_client @> jsonb_build_array(jsonb_build_object('raison', 'taille', 'octets', 26214400))
        and position('vue' in rendu_client::text) = 0, false));

    verdicts := verdicts || jsonb_build_object('controle', '38g. la fenêtre est de 90 jours, bornes comprises : reçue il y a 90 jours exactement, rendue ; 90 jours et une minute, non',
      'observe', coalesce(rendu_client::text, '?'),
      'ok', coalesce(rendu_client @> jsonb_build_array(jsonb_build_object('raison', 'vide', 'octets', 0))
        and not rendu_client @> jsonb_build_array(jsonb_build_object('octets', 27000000)), false));

    verdicts := verdicts || jsonb_build_object('controle', '38h. le poids se rend tel que reçu : inconnu d''un dépôt échoué avant toute lecture, zéro d''une pièce jointe arrivée vide',
      'observe', coalesce(rendu_client::text, '?'),
      'ok', coalesce(rendu_client @> jsonb_build_array(jsonb_build_object('raison', 'depot', 'octets', null))
        and rendu_client @> jsonb_build_array(jsonb_build_object('raison', 'vide', 'octets', 0)), false));

    verdicts := verdicts || jsonb_build_object('controle', '38i. ses deux cases cochées (« Ventes », « Banque »), le client lit la même chose',
      'observe', coalesce(code_cases, '?') || ', ' || case when rendu_cases = rendu_client then 'la même chose' else coalesce(rendu_cases::text, 'rien') end,
      'ok', coalesce(code_cases = 'P0001' and rendu_cases = rendu_client, false));

    verdicts := verdicts || jsonb_build_object('controle', '38j. le client, sur un dossier qui n''est pas le sien : « Accès refusé à ce dossier. » (42501)',
      'observe', coalesce(refus_autre, '?'), 'ok', coalesce(refus_autre = '42501 Accès refusé à ce dossier.', false));

    verdicts := verdicts || jsonb_build_object('controle', '38k. un compte rattaché à rien : « Accès refusé à ce dossier. » (42501)',
      'observe', coalesce(refus_rien, '?'), 'ok', coalesce(refus_rien = '42501 Accès refusé à ce dossier.', false));

    verdicts := verdicts || jsonb_build_object('controle', '38l. l''anonyme n''exécute pas la fonction : refus du droit d''exécution',
      'observe', coalesce(refus_anon, '?'),
      'ok', coalesce(refus_anon like '42501 permission denied for function pieces_jointes_ecartees_du_client%', false));

    verdicts := verdicts || jsonb_build_object('controle', '38m. le chef du cabinet lit la même chose que le client (contrôle positif du cabinet)',
      'observe', coalesce(code_chef, '?') || ', ' || case when rendu_chef = rendu_client then 'la même chose' else coalesce(rendu_chef::text, 'rien') end,
      'ok', coalesce(code_chef = 'P0001' and rendu_chef = rendu_client, false));

    select string_agg((x->>'raison') || '/' || coalesce(x->>'octets', 'inconnu'), ',') into obs
      from jsonb_array_elements(case when jsonb_typeof(rendu_membre) = 'array' then rendu_membre else '[]'::jsonb end) x;
    -- Un troisième dossier du cabinet manque à un jeu de deux dossiers : sa moitié du contrôle est alors sans objet, et
    -- l'observation le dit (la production en a quatre).
    verdicts := verdicts || jsonb_build_object('controle', '38n. un membre du cabinet affecté à l''autre dossier y lit sa pièce jointe, et seulement elle ; un troisième dossier lui reste refusé',
      'observe', coalesce(code_membre, '?') || ' : ' || coalesce(obs, 'rien') || ' ; troisième dossier : '
        || case when dossier_tiers is null then 'sans objet, le cabinet n''en a pas' else coalesce(refus_tiers, '?') end,
      'ok', coalesce(code_membre = 'P0001' and obs = 'format/999'
        and (dossier_tiers is null or refus_tiers = '42501 Accès refusé à ce dossier.'), false));

    select string_agg((x->>'raison') || '/' || coalesce(x->>'octets', 'inconnu'), ',') into obs
      from jsonb_array_elements(case when jsonb_typeof(rendu_second) = 'array' then rendu_second else '[]'::jsonb end) x;
    verdicts := verdicts || jsonb_build_object('controle', '38o. sur son second dossier, le client lit la pièce jointe de ce dossier-là, et elle seule',
      'observe', case when dossier_second is null then 'sans objet : le client n''a qu''un dossier'
                      else coalesce(code_second, '?') || ' : ' || coalesce(obs, 'rien') end,
      'ok', coalesce(dossier_second is null or (code_second = 'P0001' and obs = 'format/777'), false));

    verdicts := verdicts || jsonb_build_object('controle', '38p. la table lui reste fermée : il n''en lit directement aucune ligne, cinq étant dans son dossier',
      'observe', coalesce(lues_directement::text, '?') || ' ligne(s)', 'ok', coalesce(lues_directement = 0, false));

    verdicts := verdicts || jsonb_build_object('controle', '38r. sans pièce jointe écartée dans la fenêtre, la lecture rend un tableau vide, jamais nul',
      'observe', coalesce(code_vide, '?') || ' : ' || coalesce(rendu_vide::text, 'nul'),
      'ok', coalesce(code_vide = 'P0001' and rendu_vide = '[]'::jsonb, false));

    -- ── 49a à 49f. Les mutations ──
    verdicts := verdicts || jsonb_build_object('controle', '49a. MUTATION — le contrôle 38l avec le droit rendu à l''anonyme : c''est alors la fonction qui refuse',
      'observe', coalesce(mutation_anon, '?'), 'ok', coalesce(mutation_anon = 'Accès refusé à ce dossier.', false));

    verdicts := verdicts || jsonb_build_object('controle', '49b. MUTATION — le contrôle 38k joué sous le client : la lecture doit passer',
      'observe', coalesce(jsonb_array_length(rendu_client)::text, 'refusée') || ' élément(s)',
      'ok', coalesce(code_client = 'P0001' and jsonb_array_length(rendu_client) > 0, false));

    verdicts := verdicts || jsonb_build_object('controle', '49c. MUTATION — le contrôle 38j avec un accès du client posé sur l''autre dossier : il doit en lire la pièce jointe',
      'observe', coalesce(code_autre, '?') || ' : ' || coalesce(rendu_autre::text, 'rien'),
      'ok', coalesce(code_autre = 'P0001' and rendu_autre @> jsonb_build_array(jsonb_build_object('octets', 999)), false));

    verdicts := verdicts || jsonb_build_object('controle', '49d. MUTATION — le contrôle 38g avec une pièce jointe reçue il y a 89 jours : elle doit être rendue',
      'observe', coalesce(code_89, '?') || ' : ' || coalesce(jsonb_array_length(rendu_89)::text, '?') || ' élément(s)',
      'ok', coalesce(code_89 = 'P0001' and rendu_89 @> jsonb_build_array(jsonb_build_object('octets', 1234)), false));

    verdicts := verdicts || jsonb_build_object('controle', '49e. MUTATION — la règle du contrôle 38d appliquée à une ligne de la table, telle qu''une policy l''ouvrirait : elle doit refuser',
      'observe', coalesce(cles_ligne, '?'), 'ok', coalesce(cles_ligne <> 'jour,octets,raison', false));

    verdicts := verdicts || jsonb_build_object('controle', '49f. MUTATION — le contrôle 38e jugé au jour du temps universel : il doit refuser',
      'observe', 'jour universel ' || jour_utc || ', jour de Paris ' || jour_paris, 'ok', coalesce(jour_utc <> jour_paris, false));

    verdicts := verdicts || jsonb_build_object('controle', '38q. rien de ce bloc n''est resté : les accès et leurs cases, les membres et leurs affectations, le droit de l''anonyme',
      'observe', case when acces_avant = (select md5(coalesce(string_agg(mb::text, ',' order by mb.id), '')) from memberships mb)
                      then 'accès inchangés' else 'accès CHANGÉS' end
        || ', chefs et membres ' || admins_avant || ' -> ' || (select count(*) from cabinet_admins)
        || ', affectations ' || assignations_avant || ' -> ' || (select count(*) from dossier_assignations),
      'ok', coalesce(acces_avant = (select md5(coalesce(string_agg(mb::text, ',' order by mb.id), '')) from memberships mb)
        and admins_avant = (select count(*) from cabinet_admins) and assignations_avant = (select count(*) from dossier_assignations)
        and not has_function_privilege('anon', 'public.pieces_jointes_ecartees_du_client(uuid)', 'execute'), false));
  end if;

  -- ══ 50. Rien n'est resté ════════════════════════════════════════════════════════════════════════════════════
  verdicts := verdicts || jsonb_build_object('controle', '50. rien n''est resté en base',
    'observe', 'pièces jointes écartées ' || lignes_avant || ' -> ' || (select count(*) from pieces_jointes_ecartees)
      || ', chefs et membres ' || admins_avant || ' -> ' || (select count(*) from cabinet_admins)
      || ', affectations ' || assignations_avant || ' -> ' || (select count(*) from dossier_assignations),
    'ok', coalesce(lignes_avant = (select count(*) from pieces_jointes_ecartees)
      and admins_avant = (select count(*) from cabinet_admins)
      and assignations_avant = (select count(*) from dossier_assignations)
      and not exists (select 1 from cabinet_admins where user_id = client)
      and not exists (select 1 from pieces_jointes_ecartees where id in (ligne_client, ligne_autre, ligne_neuve))
      and not has_function_privilege('anon', 'public.marquer_pieces_jointes_vues(uuid, uuid[])', 'execute')
      and has_table_privilege('service_role', 'public.pieces_jointes_ecartees', 'insert'), false));

  perform set_config('essai.pieces_jointes_ecartees', verdicts::text, true);
end $$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier sans ses lignes de commentaire
-- (`grep -v '^\s*--'`) par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.pieces_jointes_ecartees')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
