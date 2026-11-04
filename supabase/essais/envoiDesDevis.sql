-- L'ENVOI D'UN DEVIS PAR E-MAIL, JOURNALISÉ, ÉPROUVÉ EN BASE (espace client, étape P6c1) — à rejouer par `execute_sql`
-- après toute migration qui touche `emails_envoyes`, la migration `envoi_des_devis`, la table `devis`, `memberships`,
-- `client_du_dossier` ou `admin_du_dossier`. La migration : supabase/preparees/20261105100300_envoi_des_devis.sql (puis
-- supabase/schema/, le jour de son application) ; le récit : HISTORIQUE.md, « LES DEVIS : L'ENVOI PAR E-MAIL, EN BASE
-- (P6C1) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- Ce qui se prouve ici :
--   - LE CATALOGUE : la contrainte du type admet « facture », « relance_pieces » et « devis », sous son nom d'hier ; la
--     clé du devis envoyé met à NUL à la suppression du devis (le journal survit à ce qu'il a envoyé) ; la contrainte qui
--     réserve un devis à l'envoi d'un devis, dans ce sens seulement ; l'index de la clé ; les deux policies de la table,
--     inchangées ;
--   - CE QUI S'ÉCRIT, par le propriétaire (la clé de service de `send-email`, qui écrit le journal après l'envoi) et par le
--     chef du cabinet (la policy du cabinet) : une ligne « devis » qui cite son devis, ou sans devis (l'état que laisse la
--     mise à nul) ; refusés, sous leurs mots : un devis cité par une ligne « facture » ou « relance_pieces », à
--     l'insertion comme à la mise à jour, un devis inconnu, un type inconnu ;
--   - CE QUE LE CLIENT LIT : avec « Ventes », la ligne « devis » de SON dossier et le devis qu'elle cite ; sans droit ou
--     avec « Banque » seul, rien ; jamais celle d'un dossier où il n'a pas d'accès, ni une relance de pièces ; aucune
--     écriture directe ;
--   - et que RIEN ne reste en base.
-- La mise à nul elle-même ne se joue qu'en supprimant un devis : sur une réplique seulement (CLAUDE.md, « Sans suppression
-- … en production ») ; ici, sa définition au catalogue.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du chef (A, basculé, où le client de l'essai a un accès d'essai, et
-- B, où il n'en a pas), au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle
-- dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001) ; les étapes « fait » sont gardées jusqu'à
-- l'annulation finale, et une étape peut rendre un identifiant que les suivantes citent (`{CLE}`). Un refus se juge à son
-- code ET à son message (`like`). Les droits de l'accès d'essai se posent avant chaque étape qui les nomme. Les verdicts
-- voyagent dans un réglage LOCAL à la transaction (`essai.envoi_des_devis`) : le fichier se joue d'un seul appel, ne crée
-- aucune table et ne porte AUCUNE instruction de retrait de ligne. Hors de l'outil d'exécution, il se joue en UNE
-- transaction (`psql -1`). Sans la migration des devis, il se dit impossible ; sans celle de l'envoi, il se joue et le dit :
-- la ligne 0 « EN ATTENTE », et chaque contrôle qui la demande, en faute sous le refus de la base.
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une cible délibérément faux : chacune
-- doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
--
-- 04/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (la migration attend l'accord du cabinet) : la production à 171
-- migrations, plus les deux des devis, la migration appliquée sous `proprietaire` — 31 verdicts, 0 en faute, 5 mutations
-- sur 5 qui mordent, rien resté ; sans elle, joué jusqu'au bout : la ligne 0 EN ATTENTE, 18 contrôles en faute, aucune
-- mutation qui morde, rien resté. Onze mutations de la migration, chacune sur une copie neuve : toutes tuées. Le banc du
-- leurre le dit SÛR (famille « apres »). La mise à nul jouée à part, sur la réplique : un brouillon envoyé puis supprimé
-- laisse sa ligne « devis » sans devis ; un dossier supprimé emporte ses devis émis et leurs envois.
do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cabinet uuid;
  ids jsonb;
  avant text; apres text;
  s record; k text; ordre text; attendu text; rendu text; accepte boolean; code_recu text; message text; ok boolean;
  erreur text;
  en_base boolean;
  verdicts jsonb := '[]'::jsonb;
begin
  -- La migration des devis d'abord : sans elle, rien à citer. Celle de l'envoi, son témoin la colonne `devis_id` : absente,
  -- l'essai se joue quand même, et le dit.
  if to_regclass('public.devis') is null then
    raise exception 'ESSAI_IMPOSSIBLE : la migration devis_du_client n''est pas en base';
  end if;
  en_base := exists (select 1 from pg_attribute where attrelid = 'public.emails_envoyes'::regclass and attname = 'devis_id'
                      and not attisdropped);
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from memberships where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'e55e0000-0000-4000-8000-0000000000a1', 'DB', 'e55e0000-0000-4000-8000-0000000000b1',
    'ACCES', 'e55e0000-0000-4000-8000-0000000000c1', 'INCONNU', gen_random_uuid(),
    'JOUR', to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-DD'));

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from emails_envoyes)),
    ((select count(*) from devis)), ((select count(*) from devis_numerotation))
  ) as t(n);

  verdicts := verdicts || jsonb_build_object('controle', '0. la migration envoi_des_devis est en base (son témoin : la colonne emails_envoyes.devis_id)',
    'genre', case when en_base then 'controle' else 'attente' end,
    'observe', case when en_base then 'présente' else 'absente : les contrôles qui la demandent sont en faute' end, 'ok', en_base);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre, code attendu ou OK, message ou valeur attendus, clé)
      -- genre : « jeu » (posé, gardé ; s'il échoue, l'essai est impossible), « controle » (annulé), « fait » (gardé),
      -- « valeur » (lecture par le propriétaire), « mutation » (un contrôle rejoué à faux, qui doit rendre l'inverse).
      -- qui : client, chef, proprietaire (sans session : la clé de service de `send-email`, qui écrit le journal).

      -- ══ Le jeu : deux dossiers jetables, un accès d'essai sans droit, un devis émis dans chacun ══════════
      -- A naît basculé : « Ventes » ne se porte que sur un accès d'un dossier dont les factures sont la source de leurs
      -- ventes (garder_droit_ventes, étape VF8f).
      ('j1', 'jeu', 'dossiers jetables A et B', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, ventes_par_les_factures, forme_juridique,
             denomination_imprimee, siret, adresse) values
          ('{DA}', 'ESSAI ENVOI A', '{CAB}', 'redevable', true, true, '5710', 'ESSAI ENVOI A SAS', '12345678200010', '1 rue de l''Essai, 75001 Paris'),
          ('{DB}', 'ESSAI ENVOI B', '{CAB}', 'redevable', true, false, null, null, null, null)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-envoi@exemple.invalid')$q$, 'OK', null, null),
      ('j3', 'jeu', 'le chef émet le devis DV1 dans A', 'chef', null,
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI ENVOI 1","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', null, 'DV1'),
      ('j4', 'jeu', 'et le devis DVB dans B', 'chef', null,
        $q$select devis_id::text from enregistrer_devis('{DB}', null, '{"tiers_nom":"ESSAI ENVOI B","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', null, 'DVB'),

      -- ══ 1 à 5. Le catalogue ══════════
      ('1', 'valeur', 'la contrainte du type admet aussi « devis », sous son nom d''hier', 'proprietaire', null,
        $q$select coalesce(string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname), 'aucune') from pg_constraint
            where conrelid = 'public.emails_envoyes'::regclass and contype = 'c' and conname = 'emails_envoyes_type_check'$q$,
        'OK', 'emails_envoyes_type_check CHECK ((type = ANY (ARRAY[''facture''::text, ''relance_pieces''::text, ''devis''::text])))', null),
      ('2', 'valeur', 'la clé du devis envoyé : à nul à la suppression du devis, jamais en cascade', 'proprietaire', null,
        $q$select coalesce(string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname), 'aucune') from pg_constraint
            where conrelid = 'public.emails_envoyes'::regclass and contype = 'f' and confrelid = 'public.devis'::regclass$q$,
        'OK', 'emails_envoyes_devis_id_fkey FOREIGN KEY (devis_id) REFERENCES devis(id) ON DELETE SET NULL', null),
      ('3', 'valeur', 'un devis cité, seulement par l''envoi d''un devis — une ligne « devis » sans devis reste admise', 'proprietaire', null,
        $q$select coalesce(string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname), 'aucune') from pg_constraint
            where conrelid = 'public.emails_envoyes'::regclass and contype = 'c' and conname <> 'emails_envoyes_type_check'$q$,
        'OK', 'emails_envoyes_un_devis_sur_un_envoi_de_devis CHECK (((devis_id IS NULL) OR (type = ''devis''::text)))', null),
      ('4', 'valeur', 'l''index de la clé', 'proprietaire', null,
        $q$select coalesce(string_agg(indexdef, ' | ' order by indexname), 'aucun') from pg_indexes
            where schemaname = 'public' and tablename = 'emails_envoyes' and indexdef like '%(devis_id)%'$q$,
        'OK', 'CREATE INDEX emails_envoyes_devis_id_idx ON public.emails_envoyes USING btree (devis_id)', null),
      ('5', 'valeur', 'les deux policies de la table, inchangées : celle du cabinet, la lecture du client « Ventes » des envois de factures et de devis', 'proprietaire', null,
        $q$select string_agg(p.polname || '/' || p.polcmd::text || '/' || p.polpermissive || '/' || array_to_string(p.polroles::regrole[]::text[], ',')
               || '/' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '/' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), ' | ' order by p.polname)
             from pg_policy p where p.polrelid = 'public.emails_envoyes'::regclass$q$,
        'OK', 'emails_envoyes_all/*/true/-/admin_du_dossier(dossier_id)/admin_du_dossier(dossier_id) | emails_envoyes_lecture_ventes/r/true/authenticated/(client_du_dossier(dossier_id, ''ventes''::text) AND (type = ANY (ARRAY[''facture''::text, ''devis''::text])))/', null),

      -- ══ 6 à 16. Ce qui s'écrit ══════════
      ('6', 'fait', '`send-email` (la clé de service) journalise l''envoi de DV1 : une ligne « devis » qui cite son devis', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet, devis_id) values ('{DA}', 'devis', 'essai-envoi@exemple.invalid', 'Devis ESSAI', '{DV1}') returning id::text$q$,
        'OK', null, 'E1'),
      ('6b', 'valeur', 'la ligne telle qu''elle est gardée : « devis », le devis DV1', 'proprietaire', null,
        $q$select type || '/' || (devis_id = '{DV1}')::text from emails_envoyes where id = '{E1}'$q$, 'OK', 'devis/true', null),
      ('7', 'fait', 'et celui de DVB, dans B', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet, devis_id) values ('{DB}', 'devis', 'essai-envoi@exemple.invalid', 'Devis ESSAI B', '{DVB}') returning id::text$q$,
        'OK', null, 'EB'),
      ('8', 'fait', 'une relance de pièces dans A, sans devis', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DA}', 'relance_pieces', 'essai-envoi@exemple.invalid', 'Relance ESSAI') returning id::text$q$,
        'OK', null, 'ER'),
      ('9', 'controle', 'le chef journalise l''envoi d''un devis de son dossier (la policy du cabinet)', 'chef', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet, devis_id) values ('{DA}', 'devis', 'essai-envoi@exemple.invalid', 'Devis ESSAI', '{DV1}') returning type$q$,
        'OK', 'devis', null),
      ('10', 'controle', 'une ligne « devis » sans devis — ce que laisse la mise à nul d''une suppression — est admise', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DA}', 'devis', 'essai-envoi@exemple.invalid', 'Devis ESSAI') returning coalesce(devis_id::text, 'nul')$q$,
        'OK', 'nul', null),
      ('11', 'controle', 'un devis cité par une ligne « facture » : refusé', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet, devis_id) values ('{DA}', 'facture', 'essai-envoi@exemple.invalid', 'Facture ESSAI', '{DV1}')$q$,
        '23514', 'new row for relation "emails_envoyes" violates check constraint "emails_envoyes_un_devis_sur_un_envoi_de_devis"%', null),
      ('12', 'controle', 'ni par une relance de pièces', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet, devis_id) values ('{DA}', 'relance_pieces', 'essai-envoi@exemple.invalid', 'Relance ESSAI', '{DV1}')$q$,
        '23514', 'new row for relation "emails_envoyes" violates check constraint "emails_envoyes_un_devis_sur_un_envoi_de_devis"%', null),
      ('13', 'controle', 'ni, à la mise à jour, par la ligne « devis » devenue « facture » (le chef)', 'chef', null,
        $q$update emails_envoyes set type = 'facture' where id = '{E1}' returning type$q$,
        '23514', 'new row for relation "emails_envoyes" violates check constraint "emails_envoyes_un_devis_sur_un_envoi_de_devis"%', null),
      ('14', 'controle', 'un devis inconnu : refusé par la clé', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet, devis_id) values ('{DA}', 'devis', 'essai-envoi@exemple.invalid', 'Devis ESSAI', '{INCONNU}')$q$,
        '23503', 'insert or update on table "emails_envoyes" violates foreign key constraint "emails_envoyes_devis_id_fkey"%', null),
      ('15', 'controle', 'un type inconnu : refusé', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DA}', 'devis_relance', 'essai-envoi@exemple.invalid', 'ESSAI')$q$,
        '23514', 'new row for relation "emails_envoyes" violates check constraint "emails_envoyes_type_check"%', null),
      ('16', 'controle', 'la mise à jour qui ôte le devis d''une ligne « devis » est admise (l''état de la mise à nul)', 'proprietaire', null,
        $q$update emails_envoyes set devis_id = null where id = '{E1}' returning type || '/' || coalesce(devis_id::text, 'nul')$q$,
        'OK', 'devis/nul', null),
      ('M1', 'mutation', 'le contrôle 11 rejoué sur une ligne « devis » : il passe — la contrainte juge le type, pas le devis', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet, devis_id) values ('{DA}', 'devis', 'essai-envoi@exemple.invalid', 'Devis ESSAI', '{DV1}') returning type$q$,
        'OK', 'devis', null),
      ('M2', 'mutation', 'le contrôle 14 rejoué avec le devis DV1 : il passe', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet, devis_id) values ('{DA}', 'devis', 'essai-envoi@exemple.invalid', 'Devis ESSAI', '{DV1}') returning (devis_id is not null)::text$q$,
        'OK', 'true', null),

      -- ══ 20 à 29. Ce que le client lit ══════════
      ('20', 'controle', 'avec « Ventes », le client lit la ligne « devis » de son dossier A, et le devis qu''elle cite', 'client', 'ventes',
        $q$select string_agg(type || '/' || (devis_id = '{DV1}')::text, ',') from emails_envoyes where dossier_id in ('{DA}', '{DB}') and type = 'devis'$q$,
        'OK', 'devis/true', null),
      ('21', 'controle', 'sans droit, aucune ligne de A ni de B', 'client', 'aucun',
        $q$select count(*)::text from emails_envoyes where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '0', null),
      ('22', 'controle', 'avec « Banque » seul, aucune', 'client', 'banque',
        $q$select count(*)::text from emails_envoyes where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '0', null),
      ('23', 'controle', 'avec « Ventes », ni la ligne de B, où il n''a pas d''accès, ni une relance de pièces', 'client', 'ventes',
        $q$select count(*)::text from emails_envoyes where dossier_id = '{DB}' or id = '{ER}'$q$, 'OK', '0', null),
      ('24', 'controle', 'avec « Ventes », il ne journalise pas un envoi lui-même : la RLS', 'client', 'ventes',
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet, devis_id) values ('{DA}', 'devis', 'essai-envoi@exemple.invalid', 'Devis ESSAI', '{DV1}')$q$,
        '42501', 'new row violates row-level security policy%emails_envoyes%', null),
      ('25', 'controle', 'ni n''ôte le devis d''une ligne : aucune ligne touchée', 'client', 'ventes',
        $q$with u as (update emails_envoyes set devis_id = null where id = '{E1}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('26', 'controle', 'le chef lit les deux envois de devis de son cabinet', 'chef', null,
        $q$select count(*)::text from emails_envoyes where dossier_id in ('{DA}', '{DB}') and type = 'devis' and devis_id is not null$q$, 'OK', '2', null),
      ('M3', 'mutation', 'le contrôle 21 rejoué avec « Ventes » : il lit', 'client', 'ventes',
        $q$select count(*)::text from emails_envoyes where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '1', null),
      ('M4', 'mutation', 'le contrôle 23 rejoué sur la ligne de A : il la lit', 'client', 'ventes',
        $q$select count(*)::text from emails_envoyes where id = '{E1}'$q$, 'OK', '1', null),
      ('M5', 'mutation', 'le contrôle 24 rejoué par le chef : la policy du cabinet le laisse passer', 'chef', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet, devis_id) values ('{DA}', 'devis', 'essai-envoi@exemple.invalid', 'Devis ESSAI', '{DV1}')$q$,
        'OK', null, null)
    ) as x(num, genre, controle, qui, droits, ordre, code, attendu, cle)
    loop
      -- Les droits de l'accès d'essai, posés par le propriétaire avant l'étape qui les nomme.
      if s.droits is not null then
        update memberships set droit_ventes = (s.droits = 'ventes'), droit_banque = (s.droits = 'banque')
         where id = (ids ->> 'ACCES')::uuid;
      end if;
      ordre := s.ordre;
      attendu := s.attendu;
      for k in select jsonb_object_keys(ids) loop
        ordre := replace(ordre, '{' || k || '}', ids ->> k);
        attendu := replace(attendu, '{' || k || '}', ids ->> k);
      end loop;
      accepte := false; code_recu := null; message := null; rendu := null;
      begin
        if s.qui in ('client', 'chef') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        else
          -- Le propriétaire : sans session, `auth.uid()` est nul — il n'hérite pas du compte de l'étape précédente.
          perform set_config('request.jwt.claims', '', true);
        end if;
        if ordre ~* '^\s*insert' and ordre !~* 'returning' then
          execute ordre;
        else
          execute ordre into rendu;
        end if;
        accepte := true;
        if s.genre in ('controle', 'mutation', 'valeur') then
          raise exception 'ANNULATION_ESSAI';
        end if;
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if s.cle is not null and accepte and rendu is not null then
        ids := ids || jsonb_build_object(s.cle, rendu);
      end if;
      ok := case
        when s.code = 'OK' then accepte and (attendu is null or coalesce(rendu, '') like attendu)
                                and (s.cle is null or rendu is not null)
        else not accepte and code_recu = s.code and message like attendu
      end;
      if s.genre = 'jeu' and not ok then
        raise exception 'ESSAI_IMPOSSIBLE : le jeu % n''a pas pu être posé (% %)', s.num, code_recu, message;
      end if;
      if s.genre <> 'jeu' then
        verdicts := verdicts || jsonb_build_object('controle', s.num || '. ' || s.controle, 'genre', s.genre,
          'observe', case when accepte then 'accepté : ' || coalesce(rendu, '—') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
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
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from emails_envoyes)),
    ((select count(*) from devis)), ((select count(*) from devis_numerotation))
  ) as t(n);
  -- L'écart seul, non les comptes de toute la base, qui diraient le volume d'un dossier réel.
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)), 'ok', erreur is null and avant = apres);
  perform set_config('essai.envoi_des_devis', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'attente' then '*** EN ATTENTE ***'
                                 when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.envoi_des_devis')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, (regexp_match(v.controle, '^M?(\d+)'))[1]::int, v.controle;
