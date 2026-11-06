-- LA RELANCE D'UNE FACTURE EN RETARD, JOURNALISÉE, ÉPROUVÉE EN BASE (espace client, étape C5 de la ligne 51.5) — à
-- rejouer par `execute_sql` après toute migration qui touche `emails_envoyes`, la migration `relances_des_factures`,
-- `memberships`, `client_du_dossier` ou `admin_du_dossier`. La migration : supabase/preparees/
-- 20261106140000_relances_des_factures.sql (puis supabase/schema/, le jour de son application) ; le récit : HISTORIQUE.md,
-- « 06/11/2026 — RELANCER SES CLIENTS (C5) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- Ce qui se prouve ici :
--   - LE CATALOGUE : la contrainte du type admet « facture », « relance_pieces », « devis » et « relance_facture », sous
--     son nom d'hier ; les deux policies de la table : celle du cabinet inchangée, la lecture du client « Ventes » étendue
--     aux seules relances de factures ;
--   - CE QUI S'ÉCRIT, par le propriétaire (la clé de service de `send-email`, qui écrit le journal après l'envoi) et par le
--     chef du cabinet : une ligne « relance_facture » ; refusé, sous son mot : un type inconnu ;
--   - CE QUE LE CLIENT LIT : avec « Ventes », la relance de SON dossier ; sans droit ou avec « Banque » seul, rien ;
--     jamais celle d'un dossier où il n'a pas d'accès, ni une relance de pièces ; aucune écriture directe ;
--   - et que RIEN ne reste en base.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du chef (A, basculé, où le client de l'essai a un accès d'essai, et
-- B, où il n'en a pas), au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`), chaque contrôle
-- dans sa sous-transaction annulée (`ANNULATION_ESSAI`) — le moteur de envoiDesDevis.sql, à l'identique. Les verdicts
-- voyagent dans un réglage LOCAL à la transaction (`essai.relances_des_factures`) : le fichier se joue d'un seul appel, ne
-- crée aucune table et ne porte AUCUNE instruction de retrait de ligne. Hors de l'outil d'exécution, il se joue en UNE
-- transaction (`psql -1`). Sans la migration, il se joue et le dit : la ligne 0 « EN ATTENTE », et chaque contrôle qui la
-- demande, en faute sous le refus de la base.
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une cible délibérément faux : chacune
-- doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
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
  en_base := exists (select 1 from pg_constraint where conrelid = 'public.emails_envoyes'::regclass
                      and conname = 'emails_envoyes_type_check' and pg_get_constraintdef(oid) like '%''relance_facture''%');
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from memberships where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'e55e0000-0000-4000-8000-0000000005a1', 'DB', 'e55e0000-0000-4000-8000-0000000005b1',
    'ACCES', 'e55e0000-0000-4000-8000-0000000005c1');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from emails_envoyes))
  ) as t(n);

  verdicts := verdicts || jsonb_build_object('controle', '0. la migration relances_des_factures est en base (son témoin : la contrainte du type)',
    'genre', case when en_base then 'controle' else 'attente' end,
    'observe', case when en_base then 'présente' else 'absente : les contrôles qui la demandent sont en faute' end, 'ok', en_base);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre, code attendu ou OK, message ou valeur attendus, clé)

      -- ══ Le jeu : deux dossiers jetables, un accès d'essai sans droit ══════════
      -- A naît basculé : « Ventes » ne se porte que sur un accès d'un dossier dont les factures sont la source de leurs
      -- ventes (garder_droit_ventes, étape VF8f).
      ('j1', 'jeu', 'dossiers jetables A et B', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, ventes_par_les_factures) values
          ('{DA}', 'ESSAI RELANCE A', '{CAB}', 'redevable', true, true),
          ('{DB}', 'ESSAI RELANCE B', '{CAB}', 'redevable', true, false)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-relance@exemple.invalid')$q$, 'OK', null, null),

      -- ══ 1 et 2. Le catalogue ══════════
      ('1', 'valeur', 'la contrainte du type admet aussi « relance_facture », sous son nom d''hier', 'proprietaire', null,
        $q$select coalesce(string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname), 'aucune') from pg_constraint
            where conrelid = 'public.emails_envoyes'::regclass and contype = 'c' and conname = 'emails_envoyes_type_check'$q$,
        'OK', 'emails_envoyes_type_check CHECK ((type = ANY (ARRAY[''facture''::text, ''relance_pieces''::text, ''devis''::text, ''relance_facture''::text])))', null),
      ('2', 'valeur', 'les deux policies : celle du cabinet inchangée, la lecture du client « Ventes » étendue aux seules relances de factures', 'proprietaire', null,
        $q$select string_agg(p.polname || '/' || p.polcmd::text || '/' || p.polpermissive || '/' || array_to_string(p.polroles::regrole[]::text[], ',')
               || '/' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '/' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), ' | ' order by p.polname)
             from pg_policy p where p.polrelid = 'public.emails_envoyes'::regclass$q$,
        'OK', 'emails_envoyes_all/*/true/-/admin_du_dossier(dossier_id)/admin_du_dossier(dossier_id) | emails_envoyes_lecture_ventes/r/true/authenticated/(client_du_dossier(dossier_id, ''ventes''::text) AND (type = ANY (ARRAY[''facture''::text, ''devis''::text, ''relance_facture''::text])))/', null),

      -- ══ 3 à 7. Ce qui s'écrit ══════════
      ('3', 'fait', '`send-email` (la clé de service) journalise une relance de facture dans A', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DA}', 'relance_facture', 'essai-relance@exemple.invalid', 'Relance ESSAI') returning id::text$q$,
        'OK', null, 'RA'),
      ('4', 'fait', 'et une dans B', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DB}', 'relance_facture', 'essai-relance@exemple.invalid', 'Relance ESSAI B') returning id::text$q$,
        'OK', null, 'RB'),
      ('5', 'fait', 'une relance de pièces dans A', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DA}', 'relance_pieces', 'essai-relance@exemple.invalid', 'Relance pièces ESSAI') returning id::text$q$,
        'OK', null, 'RP'),
      ('6', 'controle', 'le chef journalise une relance de facture de son dossier (la policy du cabinet)', 'chef', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DA}', 'relance_facture', 'essai-relance@exemple.invalid', 'Relance ESSAI') returning type$q$,
        'OK', 'relance_facture', null),
      ('7', 'controle', 'un type inconnu : refusé', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DA}', 'relance', 'essai-relance@exemple.invalid', 'ESSAI')$q$,
        '23514', 'new row for relation "emails_envoyes" violates check constraint "emails_envoyes_type_check"%', null),
      ('M1', 'mutation', 'le contrôle 7 rejoué avec « relance_facture » : il passe — la contrainte juge le type', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DA}', 'relance_facture', 'essai-relance@exemple.invalid', 'ESSAI') returning type$q$,
        'OK', 'relance_facture', null),

      -- ══ 10 à 14. Ce que le client lit ══════════
      ('10', 'controle', 'avec « Ventes », le client lit la relance de facture de son dossier A', 'client', 'ventes',
        $q$select string_agg(type || '/' || (id = '{RA}')::text, ',') from emails_envoyes where dossier_id in ('{DA}', '{DB}') and type = 'relance_facture'$q$,
        'OK', 'relance_facture/true', null),
      ('11', 'controle', 'sans droit, aucune ligne de A ni de B', 'client', 'aucun',
        $q$select count(*)::text from emails_envoyes where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '0', null),
      ('12', 'controle', 'avec « Banque » seul, aucune', 'client', 'banque',
        $q$select count(*)::text from emails_envoyes where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '0', null),
      ('13', 'controle', 'avec « Ventes », ni la relance de B, où il n''a pas d''accès, ni la relance de pièces', 'client', 'ventes',
        $q$select count(*)::text from emails_envoyes where id in ('{RB}', '{RP}')$q$, 'OK', '0', null),
      ('14', 'controle', 'avec « Ventes », il ne journalise pas une relance lui-même : la RLS', 'client', 'ventes',
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DA}', 'relance_facture', 'essai-relance@exemple.invalid', 'ESSAI')$q$,
        '42501', 'new row violates row-level security policy%emails_envoyes%', null),
      ('M2', 'mutation', 'le contrôle 11 rejoué avec « Ventes » : il lit', 'client', 'ventes',
        $q$select count(*)::text from emails_envoyes where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '1', null),
      ('M3', 'mutation', 'le contrôle 13 rejoué sur la relance de A : il la lit', 'client', 'ventes',
        $q$select count(*)::text from emails_envoyes where id = '{RA}'$q$, 'OK', '1', null),
      ('M4', 'mutation', 'le contrôle 14 rejoué par le chef : la policy du cabinet le laisse passer', 'chef', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DA}', 'relance_facture', 'essai-relance@exemple.invalid', 'ESSAI')$q$,
        'OK', null, null)
    ) as x(num, genre, controle, qui, droits, ordre, code, attendu, cle)
    loop
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
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from emails_envoyes))
  ) as t(n);
  -- L'écart seul, non les comptes de toute la base, qui diraient le volume d'un dossier réel.
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)), 'ok', erreur is null and avant = apres);
  perform set_config('essai.relances_des_factures', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'attente' then '*** EN ATTENTE ***'
                                 when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.relances_des_factures')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, (regexp_match(v.controle, '^M?(\d+)'))[1]::int, v.controle;
