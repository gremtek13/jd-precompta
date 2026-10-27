-- LES DOSSIERS DONT UN RIB PROPOSÉ ATTEND LA CONFIRMATION DU CABINET, ÉPROUVÉS EN BASE (espace client, étape A5b3c) — à
-- rejouer par `execute_sql` après toute migration qui touche `dossiers_au_rib_a_confirmer`, `dernier_changement_de_rib`,
-- la table `parametres_facturation` ou ses deux fonctions, `dossiers`, `cabinet_admins`, `dossier_assignations`,
-- `memberships`, `admin_du_dossier` ou `is_super_admin`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, le client de l'essai sans aucune case, avec
-- « Ventes », avec « Banque » seul, avec les deux ; le même compte rangé, le temps d'un contrôle, chef d'un cabinet
-- jetable, chef d'un AUTRE cabinet jetable, membre de l'équipe affecté à une partie des dossiers, à aucun,
-- super-administrateur rattaché à aucun cabinet ; le chef du cabinet de l'essai, super-administrateur ; et le
-- propriétaire de la base :
--   - LE CATALOGUE : la fonction `SECURITY DEFINER`, `stable`, au chemin fixé, sans argument, qui rend une valeur `jsonb` ;
--     fermée à l'anonyme et à PUBLIC ; qui vérifie que l'appelant est du cabinet AVANT toute autre chose ; qui n'écrit
--     rien, ne lit pas la table des paramètres et appelle `dernier_changement_de_rib` pour chaque dossier que
--     `admin_du_dossier` lui ouvre — une seule règle ;
--   - QUI LA LIT : le cabinet seul — un accès client, quelles que soient ses cases, un compte rattaché à rien, la RAISON
--     (« Seul le cabinet lit les RIB à confirmer. », 42501) ; l'anonyme, le droit d'exécution ; et le même compte, rangé à
--     l'équipe, lit ;
--   - CE QU'ELLE REND, profil par profil, au caractère près : les dossiers de son cabinet pour le chef, ceux qui lui sont
--     affectés pour un membre (la liste VIDE pour un membre affecté à aucun : une affirmation), ceux de l'autre cabinet
--     pour l'autre chef, tous pour le super-administrateur ; jamais un dossier dont le même compte n'est qu'un accès
--     client ; dans onze dossiers jetables — un RIB proposé posé, proposé changé, confirmé ensuite, confirmé d'emblée par
--     le cabinet, proposé puis retiré, proposé puis une version qui ne touche pas au RIB, sans paramètres, archivé et
--     proposé, proposé deux fois, écarté par le cabinet, et un dossier d'un autre cabinet — ; un RIB qui entre dans la
--     liste quand il est proposé, et qui en sort quand il est confirmé ; l'ordre, le plus ancien d'abord puis la clé ;
--   - LA CONFRONTATION, profil par profil et dossier par dossier, avec `dernier_changement_de_rib` : les dossiers que
--     l'appelant administre et dont elle dit un RIB proposé, son objet `changement` tel quel, ni plus ni moins, dans
--     l'ordre ; et la valeur de `dernier_changement_de_rib` exigée pour chacun des onze dossiers ;
--   - CE QU'ELLE NE REND JAMAIS : des IBAN, BIC et titulaires FICTIFS (le code banque 99999) sont PLANTÉS dans les
--     versions, et cherchés dans CHAQUE réponse — la valeur, l'IBAN par groupes de quatre ; ni un identifiant qui ne soit
--     celui d'un dossier (un compte, une version) ; deux contrôles y cherchent aussi leur md5 et leur SHA-256, les
--     identifiants des comptes, un nombre, une clé de trop ou de moins ;
--   - et que RIEN ne reste en base.
--
-- SANS LA MIGRATION `dossiers_au_rib_a_confirmer`, une seule ligne la dit, « EN ATTENTE », SANS être une faute : la
-- migration est présentée au cabinet avant d'être appliquée, et une base qui ne la porte pas se rejoue aussi. Elle EN EST
-- UNE si l'historique des migrations porte `dossiers_au_rib_a_confirmer` sans que la fonction existe — sauf si une ligne
-- `retour_dossiers_au_rib_a_confirmer`, plus récente, dit son retour arrière. SANS LA MIGRATION DE L'ÉTAPE A5b3a
-- (`dernier_changement_de_rib`), l'essai se dit impossible : la fonction l'appelle.
--
-- Tout se joue dans deux cabinets JETABLES (K1, K2) et onze dossiers jetables (D1 à DB), au sein d'un bloc qui s'annule
-- entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle dans sa sous-transaction, annulée elle aussi
-- (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE avant ; les étapes « fait » sont gardées jusqu'à
-- l'annulation finale. Les versions s'écrivent par les fonctions de l'étape A5a — le cabinet (le chef de l'essai,
-- super-administrateur, dont un RIB est confirmé d'emblée) ou le client « Ventes » (le sien n'est que proposé) —, et
-- quatre sont RESTAURÉES par le propriétaire, à des jours choisis, pour juger l'ordre. Un refus se juge à son code ET à
-- son message (`like`) ; une valeur, au texte exact que la base rend ({AUJ} : le jour à Paris de la transaction). Les
-- droits des accès d'essai se posent avant chaque étape qui les nomme ; un profil du cabinet est le compte du client,
-- rangé à `cabinet_admins` (et affecté par `dossier_assignations`) le temps de son contrôle, toujours annulé — LES PROFILS
-- DU CABINET sont décrits une fois, plus bas. Les IBAN sont FICTIFS, à clé juste (le code banque 99999), les BIC et les
-- titulaires aussi. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.dossiers_au_rib_a_confirmer`) :
-- le fichier se joue d'un seul appel, ne crée aucune table et ne porte AUCUNE instruction qui retire une ligne. Hors de
-- l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil ou une cible délibérément faux : chacune doit
-- MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
--
-- src/lib/dossiersAuRibAConfirmer.test.ts lit les étapes ici : chaque liste que la base rend doit se LIRE dans le module,
-- et le module, rejouant les étapes dans leur ordre — les dossiers de chaque profil, la valeur exigée de
-- `dernier_changement_de_rib` pour chacun —, doit y retrouver chaque liste, au mot près.
do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  ids jsonb;
  avant text; apres text;
  s record; p record; k text; ordre text; partie text; attendu text; rendu text; accepte boolean; code_recu text; message text; ok boolean;
  fuite text; etrangers text;
  erreur text;
  applique text; retour text;
  -- Ce qui ne doit JAMAIS paraître dans une réponse : les IBAN plantés, et par groupes de quatre, les BIC, les titulaires,
  -- et les morceaux qui les trahiraient — cherchés tels quels (les noms des dossiers jetables n'en portent aucun).
  ibans text[] := array['FR5199999002480000RIBUN0100', 'FR7199999002480000RIBDEUX00', 'FR8299999002480000RIBTROI00',
                        'FR8099999002480000RIBQUAT00', 'FR5899999002480000RIBCINQ00'];
  plantes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  -- La migration d'abord : sans elle, une ligne le dit, en faute seulement si l'historique la porte sans retour arrière.
  if to_regclass('public.parametres_facturation') is null or to_regprocedure('public.dernier_changement_de_rib(uuid)') is null then
    raise exception 'ESSAI_IMPOSSIBLE : la migration de l''étape A5b3a (dernier_changement_de_rib) n''est pas en base';
  end if;
  if to_regprocedure('public.dossiers_au_rib_a_confirmer()') is null then
    select max(version) filter (where name = 'dossiers_au_rib_a_confirmer'), max(version) filter (where name = 'retour_dossiers_au_rib_a_confirmer')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration dossiers_au_rib_a_confirmer (étape A5b3c) n''est pas en base',
      'genre', 'controle',
      'observe', 'historique : ' || coalesce('dossiers_au_rib_a_confirmer ' || applique, 'sans dossiers_au_rib_a_confirmer')
                 || coalesce(', retour_dossiers_au_rib_a_confirmer ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique));
    perform set_config('essai.dossiers_au_rib_a_confirmer', verdicts::text, true);
    return;
  end if;
  if exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef) or not exists (select 1 from auth.users where id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : comptes de l''essai introuvables, ou rattachés autrement qu''attendu';
  end if;
  plantes := ibans || (select array_agg(rtrim(regexp_replace(i, '(.{4})', '\1 ', 'g'))) from unnest(ibans) i)
    || array['ESSBFR22', 'ESSCFR33XXX', 'ESSDFR44', 'TITULAIRE ESSAI UN', 'TITULAIRE ESSAI DEUX', 'TITULAIRE ESSAI TROIS',
             '99999', 'RIBUN', 'RIBDEUX', 'TITULAIRE', 'ESS'];

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef,
    'K1', 'a5b3c000-0000-4000-8000-0000000000a1', 'K2', 'a5b3c000-0000-4000-8000-0000000000a2',
    'D1', 'a5b3c000-0000-4000-8000-0000000000d1', 'D2', 'a5b3c000-0000-4000-8000-0000000000d2',
    'D3', 'a5b3c000-0000-4000-8000-0000000000d3', 'D4', 'a5b3c000-0000-4000-8000-0000000000d4',
    'D5', 'a5b3c000-0000-4000-8000-0000000000d5', 'D6', 'a5b3c000-0000-4000-8000-0000000000d6',
    'D7', 'a5b3c000-0000-4000-8000-0000000000d7', 'D8', 'a5b3c000-0000-4000-8000-0000000000d8',
    'D9', 'a5b3c000-0000-4000-8000-0000000000d9', 'DA', 'a5b3c000-0000-4000-8000-0000000000da',
    'DB', 'a5b3c000-0000-4000-8000-0000000000db',
    'ACCES1', 'a5b3c000-0000-4000-8000-00000000ac01', 'ACCES2', 'a5b3c000-0000-4000-8000-00000000ac02',
    'ACCES3', 'a5b3c000-0000-4000-8000-00000000ac03', 'ACCES4', 'a5b3c000-0000-4000-8000-00000000ac04',
    'ACCES5', 'a5b3c000-0000-4000-8000-00000000ac05', 'ACCES6', 'a5b3c000-0000-4000-8000-00000000ac06',
    'ACCESA', 'a5b3c000-0000-4000-8000-00000000ac0a',
    'V8', 'a5b3c000-0000-4000-8000-0000000000e1', 'V9A', 'a5b3c000-0000-4000-8000-0000000000e2',
    'V9B', 'a5b3c000-0000-4000-8000-0000000000e3', 'VB', 'a5b3c000-0000-4000-8000-0000000000e4',
    'AUJ', ((now() at time zone 'Europe/Paris')::date)::text);

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from cabinets)), ((select count(*) from dossiers)), ((select count(*) from memberships)),
    ((select count(*) from cabinet_admins)), ((select count(*) from dossier_assignations)), ((select count(*) from parametres_facturation))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits des accès d'essai, ordre(s), code attendu ou OK, message ou valeur attendus)
      -- genre : « jeu » (posé par le propriétaire, gardé), « controle » (annulé), « fait » (gardé), « valeur » (une
      -- lecture), « mutation » (un contrôle rejoué à faux, qui doit rendre l'inverse). Plusieurs ordres se séparent par
      -- « §§ » ; le dernier rend la valeur jugée.
      -- qui : anon, inconnu, client, super (le chef de l'essai, super-administrateur et chef de son cabinet), super_seul (le
      -- compte du client, rangé aux super-administrateurs le temps de l'étape), proprietaire, ou l'un des profils du cabinet
      -- ci-dessous (le compte du client, rangé le temps de l'étape).
      -- La version courante d'un dossier : celle qu'aucune ne remplace (« courante » ci-dessous, écrite en entier).

      -- ══ Le jeu : deux cabinets, onze dossiers, sept accès d'essai sans droit (quatre versions restaurées après le contrôle 4) ══════════
      ('j1', 'jeu', 'deux cabinets jetables, K1 et K2', 'proprietaire', null,
        $q$insert into cabinets (id, nom) values ('{K1}', 'Cabinet jetable A5b3c un'), ('{K2}', 'Cabinet jetable A5b3c deux')$q$, 'OK', null),
      -- Insérés à rebours de leurs identifiants : l'ordre où la base les range n'est jamais celui que la fonction doit rendre.
      -- Les sept dossiers où le client a un accès naissent basculés : « Ventes » ne se porte que sur un accès d'un dossier
      -- dont les factures sont la source de leurs ventes (garder_droit_ventes, étape VF8f) ; la liste n'en dépend pas.
      ('j2', 'jeu', 'onze dossiers jetables : dix dans K1 (D8 archivé), un dans K2', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, archive, ventes_par_les_factures) values
          ('{DB}', 'Jetable A5b3c 11', '{K2}', 'redevable', true, false, false), ('{DA}', 'Jetable A5b3c 10', '{K1}', 'redevable', true, false, true),
          ('{D9}', 'Jetable A5b3c 09', '{K1}', 'redevable', true, false, false), ('{D8}', 'Jetable A5b3c 08', '{K1}', 'redevable', true, true, false),
          ('{D7}', 'Jetable A5b3c 07', '{K1}', 'redevable', true, false, false), ('{D6}', 'Jetable A5b3c 06', '{K1}', 'redevable', true, false, true),
          ('{D5}', 'Jetable A5b3c 05', '{K1}', 'redevable', true, false, true), ('{D4}', 'Jetable A5b3c 04', '{K1}', 'redevable', true, false, true),
          ('{D3}', 'Jetable A5b3c 03', '{K1}', 'redevable', true, false, true), ('{D2}', 'Jetable A5b3c 02', '{K1}', 'redevable', true, false, true),
          ('{D1}', 'Jetable A5b3c 01', '{K1}', 'redevable', true, false, true)$q$, 'OK', null),
      ('j3', 'jeu', 'les accès d''essai du client à D1, D2, D3, D4, D5, D6 et DA, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values
          ('{ACCES1}', '{CLIENT}', '{D1}', 'client', 'acces-a5b3c@exemple.invalid'), ('{ACCES2}', '{CLIENT}', '{D2}', 'client', 'acces-a5b3c@exemple.invalid'),
          ('{ACCES3}', '{CLIENT}', '{D3}', 'client', 'acces-a5b3c@exemple.invalid'), ('{ACCES4}', '{CLIENT}', '{D4}', 'client', 'acces-a5b3c@exemple.invalid'),
          ('{ACCES5}', '{CLIENT}', '{D5}', 'client', 'acces-a5b3c@exemple.invalid'), ('{ACCES6}', '{CLIENT}', '{D6}', 'client', 'acces-a5b3c@exemple.invalid'),
          ('{ACCESA}', '{CLIENT}', '{DA}', 'client', 'acces-a5b3c@exemple.invalid')$q$, 'OK', null),
      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'la fonction : security definer, stable, search_path fixé, une valeur jsonb, aucun argument', 'proprietaire', null,
        $q$select p.prosecdef || '|' || p.provolatile::text || '|' || array_to_string(p.proconfig, ',') || '|' || pg_get_function_result(p.oid)
               || '|' || l.lanname || '|' || pg_get_function_identity_arguments(p.oid)
             from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = 'public.dossiers_au_rib_a_confirmer()'::regprocedure$q$,
        'OK', 'true|s|search_path=public|jsonb|plpgsql|'),
      ('0b', 'valeur', 'ni l''anonyme ni PUBLIC ne l''exécutent ; les connectés, oui', 'proprietaire', null,
        $q$select 'anon ' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
               || ' public ' || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
             from pg_proc p where p.oid = 'public.dossiers_au_rib_a_confirmer()'::regprocedure$q$,
        'OK', 'anon false authenticated true public false'),
      ('0c', 'valeur', 'elle vérifie que l''appelant est du cabinet — le super-administrateur, ou un compte de cabinet_admins — AVANT toute autre chose', 'proprietaire', null,
        $q$select regexp_replace(split_part(split_part(replace(p.prosrc, E'\r\n', E'\n'), E'\nbegin\n', 2), ';', 1), '\s+', ' ', 'g')
             from pg_proc p where p.oid = 'public.dossiers_au_rib_a_confirmer()'::regprocedure$q$,
        'OK', ' if not (public.is_super_admin() or exists (select 1 from public.cabinet_admins ca where ca.user_id = auth.uid())) then raise exception ''Seul le cabinet lit les RIB à confirmer.'' using errcode = ''42501'''),
      ('0d', 'valeur', 'elle n''écrit rien, et ne lit pas la table des paramètres : aucune insertion, mise à jour ni parametres_facturation dans son texte', 'proprietaire', null,
        $q$select (replace(p.prosrc, E'\r\n', E'\n') ~* '\m(insert|update)\M')::text || ' ' || (p.prosrc ~* 'parametres_facturation')::text
             from pg_proc p where p.oid = 'public.dossiers_au_rib_a_confirmer()'::regprocedure$q$,
        'OK', 'false false'),
      ('0e', 'valeur', 'une seule règle : la boucle ne parcourt que ce qu''admin_du_dossier ouvre, et appelle dernier_changement_de_rib une fois par dossier', 'proprietaire', null,
        $q$select regexp_count(p.prosrc, 'dernier_changement_de_rib\(')::text || ' ' || (regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')
               like '%for d in select x.id, x.nom, x.archive from public.dossiers x where public.admin_du_dossier(x.id) loop v_changement := public.dernier_changement_de_rib(d.id) -> ''changement'';%')::text
             from pg_proc p where p.oid = 'public.dossiers_au_rib_a_confirmer()'::regprocedure$q$,
        'OK', '1 true'),

      -- ══ 1 à 3. Qui la lit : les refus ══════════
      ('1', 'controle', 'l''anonyme ne l''exécute pas : le droit d''exécution', 'anon', null,
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, '42501', 'permission denied for function dossiers_au_rib_a_confirmer'),
      ('2', 'controle', 'un compte rattaché à rien : la raison, jamais une liste vide', 'inconnu', null,
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, '42501', 'Seul le cabinet lit les RIB à confirmer.'),
      ('3', 'controle', 'le client sans aucune case', 'client', 'aucun',
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, '42501', 'Seul le cabinet lit les RIB à confirmer.'),
      ('3b', 'controle', 'le client « Ventes »', 'client', 'ventes',
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, '42501', 'Seul le cabinet lit les RIB à confirmer.'),
      ('3c', 'controle', 'le client « Banque » seul', 'client', 'banque',
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, '42501', 'Seul le cabinet lit les RIB à confirmer.'),
      ('3d', 'controle', 'le client aux deux cases', 'client', 'deux',
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, '42501', 'Seul le cabinet lit les RIB à confirmer.'),
      ('M1', 'mutation', 'le contrôle 3b rejoué par le même compte, rangé à l''équipe de K1 et affecté à aucun dossier : il lit, la liste vide', 'membre_aucun', 'ventes',
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, 'OK', '{"dossiers": []}'),

      -- ══ 4. Avant toute version : aucun dossier n'attend, et la base l'AFFIRME ══════════
      ('4', 'controle', 'le chef de K1, avant toute version : la liste vide', 'chef_k1', null,
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, 'OK', '{"dossiers": []}'),
      ('4b', 'controle', 'le super-administrateur, les dossiers jetables, avant toute version : aucun', 'super', null,
        $q$select jsonb_build_object('dossiers', coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(public.dossiers_au_rib_a_confirmer() -> 'dossiers') with ordinality as t(e, o) where e ->> 'dossier_id' like 'a5b3c000-%'), '[]'::jsonb))::text$q$,
        'OK', '{"dossiers": []}'),
      ('j4', 'jeu', 'puis des versions RESTAURÉES : D8 proposé le 01/09/2026, D9 proposé le 01/10 puis le 02/10/2026, DB proposé le 15/09/2026', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, iban, bic, titulaire_compte, rib_etat, remplace_id, auteur, cree_le) values
          ('{V8}', '{D8}', 'FR8299999002480000RIBTROI00', null, null, 'propose', null, '{CLIENT}', '2026-09-01 10:00:00+00'),
          ('{V9A}', '{D9}', 'FR8099999002480000RIBQUAT00', 'ESSDFR44', 'TITULAIRE ESSAI TROIS', 'propose', null, '{CLIENT}', '2026-10-01 10:00:00+00'),
          ('{V9B}', '{D9}', 'FR5899999002480000RIBCINQ00', null, null, 'propose', '{V9A}', '{CLIENT}', '2026-10-02 10:00:00+00'),
          ('{VB}', '{DB}', 'FR7199999002480000RIBDEUX00', 'ESSCFR33XXX', 'TITULAIRE ESSAI DEUX', 'propose', null, '{CLIENT}', '2026-09-15 10:00:00+00')$q$, 'OK', null),

      -- ══ 5 à 11. Les versions, par les fonctions de l'étape A5a ══════════
      ('5', 'fait', 'D1 : le cabinet pose un RIB, confirmé d''emblée', 'super', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{D1}', null,
             '{"iban": "FR5199999002480000RIBUN0100", "bic": "ESSBFR22", "titulaire_compte": "TITULAIRE ESSAI UN"}'::jsonb) p$q$,
        'OK', 'confirme'),
      ('5b', 'fait', 'D1 : le client « Ventes » le change — proposé', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{D1}',
             (select x.id from parametres_facturation x where x.dossier_id = '{D1}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR7199999002480000RIBDEUX00", "bic": "ESSCFR33XXX", "titulaire_compte": "TITULAIRE ESSAI DEUX"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('6', 'fait', 'D2 : le client propose un RIB', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{D2}', null,
             '{"iban": "FR8299999002480000RIBTROI00"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('6b', 'fait', 'D2 : le cabinet enregistre une version qui ne touche pas au RIB proposé (le délai seul) : il ne le confirme pas', 'super', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{D2}',
             (select x.id from parametres_facturation x where x.dossier_id = '{D2}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"delai_paiement_jours": 45, "iban": "FR8299999002480000RIBTROI00"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('7', 'fait', 'D3 : le client propose un RIB', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{D3}', null,
             '{"iban": "FR8099999002480000RIBQUAT00", "bic": "ESSDFR44", "titulaire_compte": "TITULAIRE ESSAI TROIS"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('8', 'fait', 'D4 : le client propose un RIB', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{D4}', null,
             '{"iban": "FR5899999002480000RIBCINQ00"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('8b', 'fait', 'D4 : le cabinet le confirme', 'super', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.confirmer_rib('{D4}',
             (select x.id from parametres_facturation x where x.dossier_id = '{D4}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id))) p$q$,
        'OK', 'confirme'),
      ('9', 'fait', 'D5 : le cabinet pose un RIB, confirmé d''emblée', 'super', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{D5}', null,
             '{"iban": "FR5199999002480000RIBUN0100"}'::jsonb) p$q$,
        'OK', 'confirme'),
      ('10', 'fait', 'D6 : le client propose un RIB', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{D6}', null,
             '{"iban": "FR7199999002480000RIBDEUX00"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('10b', 'fait', 'D6 : le client le retire', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{D6}',
             (select x.id from parametres_facturation x where x.dossier_id = '{D6}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{}'::jsonb) p$q$,
        'OK', 'nul'),
      ('11', 'fait', 'DA : le cabinet pose un RIB, confirmé d''emblée', 'super', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}', null,
             '{"iban": "FR5199999002480000RIBUN0100", "bic": "ESSBFR22", "titulaire_compte": "TITULAIRE ESSAI UN"}'::jsonb) p$q$,
        'OK', 'confirme'),
      ('11b', 'fait', 'DA : le client en propose un autre', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR7199999002480000RIBDEUX00", "bic": "ESSCFR33XXX", "titulaire_compte": "TITULAIRE ESSAI DEUX"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('11c', 'fait', 'DA : le cabinet remet par-dessus le RIB qui était en vigueur : la proposition est écartée', 'super', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR5199999002480000RIBUN0100", "bic": "ESSBFR22", "titulaire_compte": "TITULAIRE ESSAI UN"}'::jsonb) p$q$,
        'OK', 'confirme'),

      -- ══ 12. Ce que dernier_changement_de_rib dit de chacun des onze dossiers (la règle, et elle seule) ══════════
      ('12a', 'controle', 'D1 : changé par un accès client, proposé, le RIB en vigueur inchangé', 'super', null,
        $q$select public.dernier_changement_de_rib('{D1}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}}'),
      ('12b', 'controle', 'D2 : la version qui ne touche pas au RIB n''est pas un changement — le dernier reste la proposition', 'super', null,
        $q$select public.dernier_changement_de_rib('{D2}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}}'),
      ('12c', 'controle', 'D3 : posé par un accès client, proposé', 'super', null,
        $q$select public.dernier_changement_de_rib('{D3}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}}'),
      ('12d', 'controle', 'D4 : la confirmation, par le cabinet', 'super', null,
        $q$select public.dernier_changement_de_rib('{D4}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "confirme", "auteur": "cabinet", "rib_en_vigueur": "pose"}}'),
      ('12e', 'controle', 'D5 : posé par le cabinet, confirmé d''emblée', 'super', null,
        $q$select public.dernier_changement_de_rib('{D5}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "pose", "auteur": "cabinet", "rib_en_vigueur": "pose"}}'),
      ('12f', 'controle', 'D6 : retiré', 'super', null,
        $q$select public.dernier_changement_de_rib('{D6}')::text$q$, 'OK', '{"changement": {"etat": "retire", "jour": "{AUJ}", "geste": "retire", "auteur": "inconnu", "rib_en_vigueur": "aucun"}}'),
      ('12g', 'controle', 'D7 : aucun paramètre, aucun changement', 'super', null,
        $q$select public.dernier_changement_de_rib('{D7}')::text$q$, 'OK', '{"changement": null}'),
      ('12h', 'controle', 'D8 (archivé) : proposé le 01/09/2026', 'super', null,
        $q$select public.dernier_changement_de_rib('{D8}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "2026-09-01", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}}'),
      ('12i', 'controle', 'D9 : proposé de nouveau le 02/10/2026, aucun RIB en vigueur', 'super', null,
        $q$select public.dernier_changement_de_rib('{D9}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "2026-10-02", "geste": "change", "auteur": "client", "rib_en_vigueur": "aucun"}}'),
      ('12j', 'controle', 'DA : la proposition écartée par le cabinet, le RIB en vigueur inchangé', 'super', null,
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "change", "auteur": "cabinet", "rib_en_vigueur": "inchange"}}'),
      ('12k', 'controle', 'DB (cabinet K2) : proposé le 15/09/2026', 'super', null,
        $q$select public.dernier_changement_de_rib('{DB}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "2026-09-15", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}}'),

      -- ══ 13. Le client « Ventes » lit le dernier changement de SON dossier, jamais la liste ══════════
      ('13', 'controle', 'le client « Ventes » lit le dernier changement du RIB de D3, où il a son accès', 'client', 'ventes',
        $q$select public.dernier_changement_de_rib('{D3}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}}'),
      ('13b', 'controle', 'mais pas la liste du cabinet, même quand un RIB attend dans ses dossiers', 'client', 'deux',
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, '42501', 'Seul le cabinet lit les RIB à confirmer.'),

      -- ══ 14 à 18. Ce qu'elle rend, profil par profil, et la confrontation ══════════
      ('14', 'controle', 'le chef de K1 : les cinq dossiers de K1 qui attendent, l''archivé compris — le plus ancien d''abord, puis la clé', 'chef_k1', null,
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, 'OK',
        '{"dossiers": [{"nom": "Jetable A5b3c 08", "archive": true, "changement": {"etat": "propose", "jour": "2026-09-01", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D8}"}, {"nom": "Jetable A5b3c 09", "archive": false, "changement": {"etat": "propose", "jour": "2026-10-02", "geste": "change", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D9}"}, {"nom": "Jetable A5b3c 01", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}, "dossier_id": "{D1}"}, {"nom": "Jetable A5b3c 02", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D2}"}, {"nom": "Jetable A5b3c 03", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D3}"}]}'),
      ('14b', 'controle', 'le chef de K1 : la confrontation avec dernier_changement_de_rib, dossier par dossier', 'chef_k1', null,
        $q$with mes as materialized (select d.id, d.nom, d.archive from public.dossiers d where public.admin_du_dossier(d.id)),
                lus as materialized (select m.id, m.nom, m.archive, public.dernier_changement_de_rib(m.id) -> 'changement' as c from mes m),
                attendus as (select l.* from lus l where l.c ->> 'etat' = 'propose'),
                rendus as (select (t.e ->> 'dossier_id')::uuid as id, t.e, t.o from jsonb_array_elements(public.dossiers_au_rib_a_confirmer() -> 'dossiers') with ordinality as t(e, o))
           select coalesce(string_agg(x, ', ' order by x), 'égale') from (
             select 'absent ' || a.id as x from attendus a where not exists (select 1 from rendus r where r.id = a.id)
             union all select 'de trop ' || r.id from rendus r where not exists (select 1 from attendus a where a.id = r.id)
             union all select 'autre ' || r.id from rendus r join attendus a on a.id = r.id
               where r.e <> jsonb_build_object('dossier_id', a.id, 'nom', a.nom, 'archive', a.archive, 'changement', a.c)
             union all select 'deux fois ' || r.id from rendus r group by r.id having count(*) > 1
             union all select 'l''ordre' where (select array_agg(r.id order by r.o) from rendus r)
               is distinct from (select array_agg(a.id order by (a.c ->> 'jour')::date, a.id) from attendus a)) z$q$,
        'OK', 'égale'),
      ('15', 'controle', 'un membre de l''équipe de K1 affecté à D1, D4, D7 et D8 : ceux qui attendent parmi eux — jamais D3, où le même compte n''est qu''un accès client', 'membre', 'deux',
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, 'OK',
        '{"dossiers": [{"nom": "Jetable A5b3c 08", "archive": true, "changement": {"etat": "propose", "jour": "2026-09-01", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D8}"}, {"nom": "Jetable A5b3c 01", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}, "dossier_id": "{D1}"}]}'),
      ('15b', 'controle', 'le membre : la confrontation', 'membre', null,
        $q$with mes as materialized (select d.id, d.nom, d.archive from public.dossiers d where public.admin_du_dossier(d.id)),
                lus as materialized (select m.id, m.nom, m.archive, public.dernier_changement_de_rib(m.id) -> 'changement' as c from mes m),
                attendus as (select l.* from lus l where l.c ->> 'etat' = 'propose'),
                rendus as (select (t.e ->> 'dossier_id')::uuid as id, t.e, t.o from jsonb_array_elements(public.dossiers_au_rib_a_confirmer() -> 'dossiers') with ordinality as t(e, o))
           select coalesce(string_agg(x, ', ' order by x), 'égale') from (
             select 'absent ' || a.id as x from attendus a where not exists (select 1 from rendus r where r.id = a.id)
             union all select 'de trop ' || r.id from rendus r where not exists (select 1 from attendus a where a.id = r.id)
             union all select 'autre ' || r.id from rendus r join attendus a on a.id = r.id
               where r.e <> jsonb_build_object('dossier_id', a.id, 'nom', a.nom, 'archive', a.archive, 'changement', a.c)
             union all select 'deux fois ' || r.id from rendus r group by r.id having count(*) > 1
             union all select 'l''ordre' where (select array_agg(r.id order by r.o) from rendus r)
               is distinct from (select array_agg(a.id order by (a.c ->> 'jour')::date, a.id) from attendus a)) z$q$,
        'OK', 'égale'),
      ('M2', 'mutation', 'le contrôle 15 rejoué par le même membre, affecté aussi à D3 : D3 entre', 'membre_plus', null,
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, 'OK',
        '{"dossiers": [{"nom": "Jetable A5b3c 08", "archive": true, "changement": {"etat": "propose", "jour": "2026-09-01", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D8}"}, {"nom": "Jetable A5b3c 01", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}, "dossier_id": "{D1}"}, {"nom": "Jetable A5b3c 03", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D3}"}]}'),
      ('16', 'controle', 'un membre de l''équipe de K1 affecté à aucun dossier : la liste vide — pour lui, une réponse', 'membre_aucun', null,
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, 'OK', '{"dossiers": []}'),
      ('16b', 'controle', 'le membre affecté à aucun dossier : la confrontation', 'membre_aucun', null,
        $q$with mes as materialized (select d.id, d.nom, d.archive from public.dossiers d where public.admin_du_dossier(d.id)),
                lus as materialized (select m.id, m.nom, m.archive, public.dernier_changement_de_rib(m.id) -> 'changement' as c from mes m),
                attendus as (select l.* from lus l where l.c ->> 'etat' = 'propose'),
                rendus as (select (t.e ->> 'dossier_id')::uuid as id, t.e, t.o from jsonb_array_elements(public.dossiers_au_rib_a_confirmer() -> 'dossiers') with ordinality as t(e, o))
           select coalesce(string_agg(x, ', ' order by x), 'égale') from (
             select 'absent ' || a.id as x from attendus a where not exists (select 1 from rendus r where r.id = a.id)
             union all select 'de trop ' || r.id from rendus r where not exists (select 1 from attendus a where a.id = r.id)
             union all select 'autre ' || r.id from rendus r join attendus a on a.id = r.id
               where r.e <> jsonb_build_object('dossier_id', a.id, 'nom', a.nom, 'archive', a.archive, 'changement', a.c)
             union all select 'deux fois ' || r.id from rendus r group by r.id having count(*) > 1
             union all select 'l''ordre' where (select array_agg(r.id order by r.o) from rendus r)
               is distinct from (select array_agg(a.id order by (a.c ->> 'jour')::date, a.id) from attendus a)) z$q$,
        'OK', 'égale'),
      ('17', 'controle', 'le chef d''un AUTRE cabinet (K2) : son seul dossier qui attend — jamais ceux de K1, même là où le même compte a un accès client', 'chef_k2', 'deux',
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, 'OK',
        '{"dossiers": [{"nom": "Jetable A5b3c 11", "archive": false, "changement": {"etat": "propose", "jour": "2026-09-15", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{DB}"}]}'),
      ('17b', 'controle', 'le chef de K2 : la confrontation', 'chef_k2', null,
        $q$with mes as materialized (select d.id, d.nom, d.archive from public.dossiers d where public.admin_du_dossier(d.id)),
                lus as materialized (select m.id, m.nom, m.archive, public.dernier_changement_de_rib(m.id) -> 'changement' as c from mes m),
                attendus as (select l.* from lus l where l.c ->> 'etat' = 'propose'),
                rendus as (select (t.e ->> 'dossier_id')::uuid as id, t.e, t.o from jsonb_array_elements(public.dossiers_au_rib_a_confirmer() -> 'dossiers') with ordinality as t(e, o))
           select coalesce(string_agg(x, ', ' order by x), 'égale') from (
             select 'absent ' || a.id as x from attendus a where not exists (select 1 from rendus r where r.id = a.id)
             union all select 'de trop ' || r.id from rendus r where not exists (select 1 from attendus a where a.id = r.id)
             union all select 'autre ' || r.id from rendus r join attendus a on a.id = r.id
               where r.e <> jsonb_build_object('dossier_id', a.id, 'nom', a.nom, 'archive', a.archive, 'changement', a.c)
             union all select 'deux fois ' || r.id from rendus r group by r.id having count(*) > 1
             union all select 'l''ordre' where (select array_agg(r.id order by r.o) from rendus r)
               is distinct from (select array_agg(a.id order by (a.c ->> 'jour')::date, a.id) from attendus a)) z$q$,
        'OK', 'égale'),
      ('18', 'controle', 'le super-administrateur : les dossiers des deux cabinets jetables qui attendent, dans l''ordre (ceux des autres cabinets, par la confrontation)', 'super', null,
        $q$select jsonb_build_object('dossiers', coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(public.dossiers_au_rib_a_confirmer() -> 'dossiers') with ordinality as t(e, o) where e ->> 'dossier_id' like 'a5b3c000-%'), '[]'::jsonb))::text$q$,
        'OK',
        '{"dossiers": [{"nom": "Jetable A5b3c 08", "archive": true, "changement": {"etat": "propose", "jour": "2026-09-01", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D8}"}, {"nom": "Jetable A5b3c 11", "archive": false, "changement": {"etat": "propose", "jour": "2026-09-15", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{DB}"}, {"nom": "Jetable A5b3c 09", "archive": false, "changement": {"etat": "propose", "jour": "2026-10-02", "geste": "change", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D9}"}, {"nom": "Jetable A5b3c 01", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}, "dossier_id": "{D1}"}, {"nom": "Jetable A5b3c 02", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D2}"}, {"nom": "Jetable A5b3c 03", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D3}"}]}'),
      ('18b', 'controle', 'le super-administrateur : la confrontation, sur TOUS les dossiers', 'super', null,
        $q$with mes as materialized (select d.id, d.nom, d.archive from public.dossiers d where public.admin_du_dossier(d.id)),
                lus as materialized (select m.id, m.nom, m.archive, public.dernier_changement_de_rib(m.id) -> 'changement' as c from mes m),
                attendus as (select l.* from lus l where l.c ->> 'etat' = 'propose'),
                rendus as (select (t.e ->> 'dossier_id')::uuid as id, t.e, t.o from jsonb_array_elements(public.dossiers_au_rib_a_confirmer() -> 'dossiers') with ordinality as t(e, o))
           select coalesce(string_agg(x, ', ' order by x), 'égale') from (
             select 'absent ' || a.id as x from attendus a where not exists (select 1 from rendus r where r.id = a.id)
             union all select 'de trop ' || r.id from rendus r where not exists (select 1 from attendus a where a.id = r.id)
             union all select 'autre ' || r.id from rendus r join attendus a on a.id = r.id
               where r.e <> jsonb_build_object('dossier_id', a.id, 'nom', a.nom, 'archive', a.archive, 'changement', a.c)
             union all select 'deux fois ' || r.id from rendus r group by r.id having count(*) > 1
             union all select 'l''ordre' where (select array_agg(r.id order by r.o) from rendus r)
               is distinct from (select array_agg(a.id order by (a.c ->> 'jour')::date, a.id) from attendus a)) z$q$,
        'OK', 'égale'),
      ('18c', 'controle', 'un super-administrateur rattaché à AUCUN cabinet (le compte du client, rangé le temps du contrôle) : les mêmes', 'super_seul', 'deux',
        $q$select jsonb_build_object('dossiers', coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(public.dossiers_au_rib_a_confirmer() -> 'dossiers') with ordinality as t(e, o) where e ->> 'dossier_id' like 'a5b3c000-%'), '[]'::jsonb))::text$q$,
        'OK',
        '{"dossiers": [{"nom": "Jetable A5b3c 08", "archive": true, "changement": {"etat": "propose", "jour": "2026-09-01", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D8}"}, {"nom": "Jetable A5b3c 11", "archive": false, "changement": {"etat": "propose", "jour": "2026-09-15", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{DB}"}, {"nom": "Jetable A5b3c 09", "archive": false, "changement": {"etat": "propose", "jour": "2026-10-02", "geste": "change", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D9}"}, {"nom": "Jetable A5b3c 01", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}, "dossier_id": "{D1}"}, {"nom": "Jetable A5b3c 02", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D2}"}, {"nom": "Jetable A5b3c 03", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D3}"}]}'),
      ('18d', 'controle', 'le super-administrateur sans cabinet : la confrontation, sur TOUS les dossiers', 'super_seul', null,
        $q$with mes as materialized (select d.id, d.nom, d.archive from public.dossiers d where public.admin_du_dossier(d.id)),
                lus as materialized (select m.id, m.nom, m.archive, public.dernier_changement_de_rib(m.id) -> 'changement' as c from mes m),
                attendus as (select l.* from lus l where l.c ->> 'etat' = 'propose'),
                rendus as (select (t.e ->> 'dossier_id')::uuid as id, t.e, t.o from jsonb_array_elements(public.dossiers_au_rib_a_confirmer() -> 'dossiers') with ordinality as t(e, o))
           select coalesce(string_agg(x, ', ' order by x), 'égale') from (
             select 'absent ' || a.id as x from attendus a where not exists (select 1 from rendus r where r.id = a.id)
             union all select 'de trop ' || r.id from rendus r where not exists (select 1 from attendus a where a.id = r.id)
             union all select 'autre ' || r.id from rendus r join attendus a on a.id = r.id
               where r.e <> jsonb_build_object('dossier_id', a.id, 'nom', a.nom, 'archive', a.archive, 'changement', a.c)
             union all select 'deux fois ' || r.id from rendus r group by r.id having count(*) > 1
             union all select 'l''ordre' where (select array_agg(r.id order by r.o) from rendus r)
               is distinct from (select array_agg(a.id order by (a.c ->> 'jour')::date, a.id) from attendus a)) z$q$,
        'OK', 'égale'),
      ('M3', 'mutation', 'le contrôle 14 rejoué par le chef de K2 : K1 n''y est pas', 'chef_k2', null,
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, 'OK',
        '{"dossiers": [{"nom": "Jetable A5b3c 11", "archive": false, "changement": {"etat": "propose", "jour": "2026-09-15", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{DB}"}]}'),
      ('M4', 'mutation', 'le contrôle 15 rejoué après que le membre a désarchivé D8 : la marque suit le dossier', 'membre', null,
        $q$update dossiers set archive = false where id = '{D8}'§§select public.dossiers_au_rib_a_confirmer()::text$q$, 'OK',
        '{"dossiers": [{"nom": "Jetable A5b3c 08", "archive": false, "changement": {"etat": "propose", "jour": "2026-09-01", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D8}"}, {"nom": "Jetable A5b3c 01", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}, "dossier_id": "{D1}"}]}'),

      -- ══ 19. Ce qu'elle ne rend jamais ══════════
      ('19', 'valeur', 'ce qu''elle ne rend JAMAIS, cherché dans le texte rendu au super-administrateur : aucun IBAN, BIC ni titulaire planté — ni par groupes de quatre, ni leur md5 ou SHA-256 —, aucun identifiant de compte ou de version, aucun nombre, aucune clé de trop ou de moins', 'super', null,
        $q$with t as (select public.dossiers_au_rib_a_confirmer() as j),
                x as (select j, j::text as s from t),
                plantees(v, n) as (values ('FR5199999002480000RIBUN0100', 1), ('FR7199999002480000RIBDEUX00', 2), ('FR8299999002480000RIBTROI00', 3),
                  ('FR8099999002480000RIBQUAT00', 4), ('FR5899999002480000RIBCINQ00', 5), ('ESSBFR22', 6), ('ESSCFR33XXX', 7), ('ESSDFR44', 8),
                  ('TITULAIRE ESSAI UN', 9), ('TITULAIRE ESSAI DEUX', 10), ('TITULAIRE ESSAI TROIS', 11))
           select coalesce(string_agg(trouve, ', ' order by trouve), 'aucun') from (
             select 'la valeur ' || n as trouve from plantees, x where position(lower(v) in lower(x.s)) > 0
             union all select 'par groupes de quatre ' || n from plantees, x
               where v like 'FR%' and position(lower(rtrim(regexp_replace(v, '(.{4})', '\1 ', 'g'))) in lower(x.s)) > 0
             union all select 'le md5 ' || n from plantees, x where position(md5(v) in x.s) > 0
             union all select 'le sha256 ' || n from plantees, x where position(encode(sha256(convert_to(v, 'UTF8')), 'hex') in x.s) > 0
             union all select 'le motif ' || w.n from (values ('99999', 1), ('titulaire', 2), ('{CLIENT}', 3), ('{CHEF}', 4)) as w(m, n), x
               where position(w.m in lower(x.s)) > 0
             union all select 'un identifiant qui n''est pas celui d''un dossier' from x, regexp_matches(x.s, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') u
               where not exists (select 1 from public.dossiers d where d.id::text = u[1])
             union all select 'un nombre' from x where jsonb_path_exists(x.j, '$.** ? (@.type() == "number")')
             union all select 'la racine' from x where (select array_agg(k collate "C" order by k collate "C") from jsonb_object_keys(x.j) k) <> array['dossiers']
             union all select 'un élément' from x, jsonb_array_elements(x.j -> 'dossiers') e
               where (select array_agg(k collate "C" order by k collate "C") from jsonb_object_keys(e) k) <> array['archive', 'changement', 'dossier_id', 'nom']
             union all select 'un changement' from x, jsonb_array_elements(x.j -> 'dossiers') e
               where (select array_agg(k collate "C" order by k collate "C") from jsonb_object_keys(e -> 'changement') k) <> array['auteur', 'etat', 'geste', 'jour', 'rib_en_vigueur']) z$q$,
        'OK', 'aucun'),
      ('19b', 'valeur', 'la même recherche, dans le texte rendu au chef de K1', 'chef_k1', null,
        $q$with t as (select public.dossiers_au_rib_a_confirmer() as j),
                x as (select j, j::text as s from t),
                plantees(v, n) as (values ('FR5199999002480000RIBUN0100', 1), ('FR7199999002480000RIBDEUX00', 2), ('FR8299999002480000RIBTROI00', 3),
                  ('FR8099999002480000RIBQUAT00', 4), ('FR5899999002480000RIBCINQ00', 5), ('ESSBFR22', 6), ('ESSCFR33XXX', 7), ('ESSDFR44', 8),
                  ('TITULAIRE ESSAI UN', 9), ('TITULAIRE ESSAI DEUX', 10), ('TITULAIRE ESSAI TROIS', 11))
           select coalesce(string_agg(trouve, ', ' order by trouve), 'aucun') from (
             select 'la valeur ' || n as trouve from plantees, x where position(lower(v) in lower(x.s)) > 0
             union all select 'par groupes de quatre ' || n from plantees, x
               where v like 'FR%' and position(lower(rtrim(regexp_replace(v, '(.{4})', '\1 ', 'g'))) in lower(x.s)) > 0
             union all select 'le md5 ' || n from plantees, x where position(md5(v) in x.s) > 0
             union all select 'le sha256 ' || n from plantees, x where position(encode(sha256(convert_to(v, 'UTF8')), 'hex') in x.s) > 0
             union all select 'le motif ' || w.n from (values ('99999', 1), ('titulaire', 2), ('{CLIENT}', 3), ('{CHEF}', 4)) as w(m, n), x
               where position(w.m in lower(x.s)) > 0
             union all select 'un identifiant qui n''est pas celui d''un dossier' from x, regexp_matches(x.s, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') u
               where not exists (select 1 from public.dossiers d where d.id::text = u[1])
             union all select 'un nombre' from x where jsonb_path_exists(x.j, '$.** ? (@.type() == "number")')
             union all select 'la racine' from x where (select array_agg(k collate "C" order by k collate "C") from jsonb_object_keys(x.j) k) <> array['dossiers']
             union all select 'un élément' from x, jsonb_array_elements(x.j -> 'dossiers') e
               where (select array_agg(k collate "C" order by k collate "C") from jsonb_object_keys(e) k) <> array['archive', 'changement', 'dossier_id', 'nom']
             union all select 'un changement' from x, jsonb_array_elements(x.j -> 'dossiers') e
               where (select array_agg(k collate "C" order by k collate "C") from jsonb_object_keys(e -> 'changement') k) <> array['auteur', 'etat', 'geste', 'jour', 'rib_en_vigueur']) z$q$,
        'OK', 'aucun'),
      ('M5', 'mutation', 'la recherche du contrôle 19 rejouée sur un texte où l''IBAN de D1 est glissé : elle le trouve', 'super', null,
        $q$with t as (select public.dossiers_au_rib_a_confirmer() as j),
                x as (select j, j::text || ' ' || lower('FR7199999002480000RIBDEUX00') as s from t),
                plantees(v, n) as (values ('FR7199999002480000RIBDEUX00', 2))
           select coalesce(string_agg(trouve, ', ' order by trouve), 'aucun') from (
             select 'la valeur ' || n as trouve from plantees, x where position(lower(v) in lower(x.s)) > 0) z$q$,
        'OK', 'la valeur 2'),

      -- ══ 20 à 23. Un RIB entre dans la liste quand il est proposé, et en sort quand il est confirmé ══════════
      ('20', 'fait', 'D5 : le client propose un autre RIB par-dessus celui que le cabinet a posé', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{D5}',
             (select x.id from parametres_facturation x where x.dossier_id = '{D5}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR8099999002480000RIBQUAT00"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('20b', 'controle', 'D5 : changé par un accès client, proposé, le RIB en vigueur inchangé', 'super', null,
        $q$select public.dernier_changement_de_rib('{D5}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}}'),
      ('20c', 'controle', 'le chef de K1 : D5 entre dans la liste, à sa place', 'chef_k1', null,
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, 'OK',
        '{"dossiers": [{"nom": "Jetable A5b3c 08", "archive": true, "changement": {"etat": "propose", "jour": "2026-09-01", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D8}"}, {"nom": "Jetable A5b3c 09", "archive": false, "changement": {"etat": "propose", "jour": "2026-10-02", "geste": "change", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D9}"}, {"nom": "Jetable A5b3c 01", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}, "dossier_id": "{D1}"}, {"nom": "Jetable A5b3c 02", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D2}"}, {"nom": "Jetable A5b3c 03", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D3}"}, {"nom": "Jetable A5b3c 05", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}, "dossier_id": "{D5}"}]}'),
      ('21', 'fait', 'D5 : le cabinet confirme le RIB proposé', 'super', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.confirmer_rib('{D5}',
             (select x.id from parametres_facturation x where x.dossier_id = '{D5}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id))) p$q$,
        'OK', 'confirme'),
      ('21b', 'controle', 'D5 : la confirmation, par le cabinet, et le RIB en vigueur changé', 'super', null,
        $q$select public.dernier_changement_de_rib('{D5}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "confirme", "auteur": "cabinet", "rib_en_vigueur": "change"}}'),
      ('21c', 'controle', 'le chef de K1 : D5 sort de la liste', 'chef_k1', null,
        $q$select public.dossiers_au_rib_a_confirmer()::text$q$, 'OK',
        '{"dossiers": [{"nom": "Jetable A5b3c 08", "archive": true, "changement": {"etat": "propose", "jour": "2026-09-01", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D8}"}, {"nom": "Jetable A5b3c 09", "archive": false, "changement": {"etat": "propose", "jour": "2026-10-02", "geste": "change", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D9}"}, {"nom": "Jetable A5b3c 01", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}, "dossier_id": "{D1}"}, {"nom": "Jetable A5b3c 02", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D2}"}, {"nom": "Jetable A5b3c 03", "archive": false, "changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}, "dossier_id": "{D3}"}]}')
    ) as x(num, genre, controle, qui, droits, ordre, code, attendu)
    loop
      -- Les droits des accès d'essai, posés par le propriétaire avant l'étape qui les nomme.
      if s.droits is not null then
        update memberships set droit_ventes = s.droits in ('ventes', 'deux'), droit_banque = s.droits in ('banque', 'deux')
         where id in (select (ids ->> c)::uuid from jsonb_object_keys(ids) c where c like 'ACCES%');
      end if;
      ordre := s.ordre;
      attendu := s.attendu;
      for k in select jsonb_object_keys(ids) loop
        ordre := replace(ordre, '{' || k || '}', ids ->> k);
        attendu := replace(attendu, '{' || k || '}', ids ->> k);
      end loop;
      accepte := false; code_recu := null; message := null; rendu := null; fuite := null; etrangers := null;
      begin
        -- LES PROFILS DU CABINET : le compte du client, rangé à cabinet_admins (cabinet, rôle) et affecté aux dossiers
        -- nommés, le temps de son étape — une sous-transaction annulée l'emporte. Leurs étapes sont toutes des contrôles.
        select v.* into p from (values
          ('chef_k1', 'K1', 'comptable_en_chef', ''),
          ('chef_k2', 'K2', 'comptable_en_chef', ''),
          ('membre', 'K1', 'comptable', 'D1,D4,D7,D8'),
          ('membre_plus', 'K1', 'comptable', 'D1,D3,D4,D7,D8'),
          ('membre_aucun', 'K1', 'comptable', '')
        ) as v(qui, cabinet, role, affectes) where v.qui = s.qui;
        if found then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, (ids ->> p.cabinet)::uuid, p.role);
          insert into dossier_assignations (dossier_id, user_id)
            select (ids ->> a)::uuid, client from unnest(string_to_array(p.affectes, ',')) a where a <> '';
        end if;
        -- Le super-administrateur SANS cabinet : le compte du client, rangé aux super-administrateurs le temps de son
        -- contrôle (le chef de l'essai, lui, est aussi le chef d'un cabinet).
        if s.qui = 'super_seul' then
          insert into super_admins (user_id) values (client);
        end if;
        if s.qui = 'anon' then
          set local role anon;
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        elsif s.qui = 'proprietaire' then
          -- Le propriétaire : sans session, `auth.uid()` est nul — il n'hérite pas du compte de l'étape précédente.
          perform set_config('request.jwt.claims', '', true);
        else
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'inconnu' then inconnu when 'super' then chef else client end, 'role', 'authenticated')::text, true);
        end if;
        -- Plusieurs ordres : chacun dans sa propre instruction, pour voir ce que le précédent a écrit.
        foreach partie in array string_to_array(ordre, '§§') loop
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
      perform set_config('request.jwt.claims', '', true);
      -- Ce que la fonction rend ne porte JAMAIS un IBAN, un BIC ou un titulaire plantés, ni un identifiant qui ne soit
      -- celui d'un dossier : cherché dans chaque réponse qui l'a lue, quel que soit le profil.
      if accepte and s.ordre like '%dossiers_au_rib_a_confirmer(%' then
        select string_agg(x, ', ' order by x) into fuite from unnest(plantes) x where position(x in coalesce(rendu, '')) > 0;
        select string_agg(u[1], ', ' order by u[1]) into etrangers
          from regexp_matches(coalesce(rendu, ''), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') u
         where not exists (select 1 from dossiers d where d.id::text = u[1]);
        if etrangers is not null then
          fuite := coalesce(fuite || ', ', '') || 'un identifiant qui n''est pas celui d''un dossier';
        end if;
      end if;
      ok := case
        when s.code = 'OK' then accepte and (attendu is null or coalesce(rendu, '') like attendu)
        else not accepte and code_recu = s.code and message like attendu
      end and fuite is null;
      if s.genre = 'jeu' and not ok then
        raise exception 'ESSAI_IMPOSSIBLE : le jeu % n''a pas pu être posé (% %)', s.num, code_recu, message;
      end if;
      if s.genre <> 'jeu' then
        verdicts := verdicts || jsonb_build_object('controle', s.num || '. ' || s.controle, 'genre', s.genre,
          'observe', case when accepte then 'accepté : ' || coalesce(rendu, '—') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end
                     || coalesce(' — FUITE : ' || fuite, ''),
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
    ((select count(*) from cabinets)), ((select count(*) from dossiers)), ((select count(*) from memberships)),
    ((select count(*) from cabinet_admins)), ((select count(*) from dossier_assignations)), ((select count(*) from parametres_facturation))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres, 'ok', erreur is null and avant = apres);
  perform set_config('essai.dossiers_au_rib_a_confirmer', verdicts::text, true);
end
$essai$;

-- Les verdicts, et une ligne d'INFORMATION : le texte que la base a reçu, sa longueur et son empreinte — sans le
-- commentaire que l'outil d'exécution ajoute à la fin —, à confronter à la copie transmise (sous psql, qui envoie les
-- instructions une à une, elle ne voit que cette requête-ci).
select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.dossiers_au_rib_a_confirmer')::jsonb) as v(controle text, genre text, ok boolean, observe text)
  union all
  select 'information', '0. le texte reçu par la base', 'information', length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
