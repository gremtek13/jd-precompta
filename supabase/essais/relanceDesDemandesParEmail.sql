-- LA RELANCE D'UNE DEMANDE DU CABINET PAR E-MAIL, ÉPROUVÉE EN BASE (espace client, ligne 51.5, étape B3b) — à rejouer
-- après toute migration qui touche `emails_envoyes`, `relances_demandes`, `demandes_cabinet`, leurs gardes,
-- `memberships`, `client_du_dossier` ou `admin_du_dossier`. La migration : supabase/preparees/
-- 20261111239000_relance_des_demandes_par_email.sql (PRÉPARÉE, après B1 et B2) ; le récit : HISTORIQUE.md, « 11/11/2026 —
-- B3B : LA RELANCE D'UNE DEMANDE PAR E-MAIL (LIGNE 51.5) (PRÉPARÉE) ».
--
-- Ce qui se prouve ici :
--   - LE CATALOGUE : la contrainte du type admet aussi « relance_demande », sous son nom d'hier ; la fonction
--     `journaliser_relance_de_demande`, exécutable par le rôle du service SEUL, aux droits de l'appelant, son chemin
--     fixé ; les deux policies d'`emails_envoyes` inchangées ;
--   - CE QUI S'INSCRIT, par le service (la clé secrète de `send-email`, après l'envoi) : la ligne du journal et la relance
--     au canal « email » qui la cite, d'un seul tenant, au nom de l'auteur donné ; une demande close s'inscrit encore (ce
--     qui est parti s'inscrit) ; refusés sous leur mot : une demande d'un autre dossier ou inconnue, un destinataire vide ;
--     refusés à tout compte connecté et à l'anonyme (42501) ; la garde de B2 refuse toujours l'écriture directe ;
--   - CE QUE LE CLIENT LIT : la relance de SON dossier, son canal compris, sans aucune case ; jamais la ligne du journal,
--     même avec « Ventes » ; rien d'un dossier où il n'a pas d'accès ;
--   - et que RIEN ne reste en base.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du chef (A, basculé, où le client de l'essai a un accès d'essai, et
-- B, où il n'en a pas), au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`), chaque contrôle
-- dans sa sous-transaction annulée (`ANNULATION_ESSAI`) — le moteur de relancesDesFactures.sql, à l'identique, qui sait
-- en plus jouer le service et l'anonyme. Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.relance_des_demandes_par_email`) : le fichier se joue d'un seul appel, ne crée aucune table et ne porte AUCUNE
-- instruction de retrait de ligne. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la
-- migration (que B2 précède), il se joue et le dit : sa seule ligne 0 « EN ATTENTE », rien d'autre ne se joue.
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
  en_base := to_regprocedure('public.journaliser_relance_de_demande(uuid,uuid,text,text,text,uuid)') is not null;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from memberships where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'e55e0000-0000-4000-8000-0000000006a1', 'DB', 'e55e0000-0000-4000-8000-0000000006b1',
    'ACCES', 'e55e0000-0000-4000-8000-0000000006c1', 'INCONNUE', 'e55e0000-0000-4000-8000-0000000006d1');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from emails_envoyes)),
    ((select count(*) from demandes_cabinet)), ((select count(*) from relances_demandes))
  ) as t(n);

  verdicts := verdicts || jsonb_build_object('controle', '0. la migration relance_des_demandes_par_email est en base (son témoin : la fonction)',
    'genre', case when en_base then 'controle' else 'attente' end,
    'observe', case when en_base then 'présente' else 'absente : les contrôles qui la demandent sont en faute' end, 'ok', en_base);

  begin
    -- Sans la migration (ni B2, qu'elle suppose), rien ne se joue : la seule ligne 0 « EN ATTENTE », et la 99.
    if not en_base then
      raise exception 'ANNULATION_ESSAI_GLOBALE';
    end if;
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre, code attendu ou OK, message ou valeur attendus, clé)

      -- ══ Le jeu : deux dossiers jetables, un accès d'essai sans droit, trois demandes ══════════
      ('j1', 'jeu', 'dossiers jetables A (basculé) et B', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, ventes_par_les_factures) values
          ('{DA}', 'ESSAI RELANCE DEMANDE A', '{CAB}', 'redevable', true, true),
          ('{DB}', 'ESSAI RELANCE DEMANDE B', '{CAB}', 'redevable', true, false)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-relance-demande@exemple.invalid')$q$, 'OK', null, null),
      ('j3', 'jeu', 'une demande ouverte dans A, par le chef', 'chef', null,
        $q$select (ouvrir_demande('{DA}', 'Objet ESSAI', 'Détail ESSAI qui ne part pas', null, 'fichier')).id::text$q$, 'OK', null, 'DEMA'),
      ('j4', 'jeu', 'une demande ouverte dans B', 'chef', null,
        $q$select (ouvrir_demande('{DB}', 'Objet ESSAI B', null, null, 'reponse')).id::text$q$, 'OK', null, 'DEMB'),
      ('j5', 'jeu', 'une seconde demande dans A, que le chef clôt', 'chef', null,
        $q$select (clore_demande((ouvrir_demande('{DA}', 'Objet ESSAI close', null, null, 'fichier')).id, 'sans_objet')).id::text$q$, 'OK', null, 'DEMC'),

      -- ══ 1 à 3. Le catalogue ══════════
      ('1', 'valeur', 'la contrainte du type admet aussi « relance_demande », sous son nom d''hier', 'proprietaire', null,
        $q$select coalesce(string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname), 'aucune') from pg_constraint
            where conrelid = 'public.emails_envoyes'::regclass and contype = 'c' and conname = 'emails_envoyes_type_check'$q$,
        'OK', 'emails_envoyes_type_check CHECK ((type = ANY (ARRAY[''facture''::text, ''relance_pieces''::text, ''devis''::text, ''relance_facture''::text, ''relance_demande''::text])))', null),
      ('2', 'valeur', 'la fonction : le service seul l''exécute, aux droits de l''appelant, son chemin fixé', 'proprietaire', null,
        $q$select has_function_privilege('anon', p.oid, 'execute') || '/' || has_function_privilege('authenticated', p.oid, 'execute')
               || '/' || has_function_privilege('service_role', p.oid, 'execute') || '/' || p.prosecdef || '/' || array_to_string(p.proconfig, ',')
             from pg_proc p where p.oid = to_regprocedure('public.journaliser_relance_de_demande(uuid,uuid,text,text,text,uuid)')$q$,
        'OK', 'false/false/true/false/search_path=public', null),
      ('3', 'valeur', 'les deux policies d''emails_envoyes, inchangées', 'proprietaire', null,
        $q$select string_agg(p.polname || '/' || p.polcmd::text || '/' || array_to_string(p.polroles::regrole[]::text[], ',')
               || '/' || coalesce(pg_get_expr(p.polqual, p.polrelid), ''), ' | ' order by p.polname)
             from pg_policy p where p.polrelid = 'public.emails_envoyes'::regclass$q$,
        'OK', 'emails_envoyes_all/*/-/admin_du_dossier(dossier_id) | emails_envoyes_lecture_ventes/r/authenticated/(client_du_dossier(dossier_id, ''ventes''::text) AND (type = ANY (ARRAY[''facture''::text, ''devis''::text, ''relance_facture''::text])))', null),

      -- ══ 4 à 14. Ce qui s'inscrit ══════════
      ('4', 'controle', 'le service inscrit la relance de la demande de A : la relance au canal « email »', 'service', null,
        $q$select (journaliser_relance_de_demande('{DA}', '{DEMA}', 'essai-relance-demande@exemple.invalid', 'Une demande de votre cabinet attend votre réponse', 'resend-essai', '{CHEF}')).canal$q$,
        'OK', 'email', null),
      ('6', 'controle', 'le chef, connecté, ne l''exécute pas : le droit d''exécution', 'chef', null,
        $q$select (journaliser_relance_de_demande('{DA}', '{DEMA}', 'essai-relance-demande@exemple.invalid', 'ESSAI', null, '{CHEF}')).canal$q$,
        '42501', 'permission denied for function journaliser_relance_de_demande', null),
      ('7', 'controle', 'le client non plus', 'client', 'aucun',
        $q$select (journaliser_relance_de_demande('{DA}', '{DEMA}', 'essai-relance-demande@exemple.invalid', 'ESSAI', null, '{CLIENT}')).canal$q$,
        '42501', 'permission denied for function journaliser_relance_de_demande', null),
      ('8', 'controle', 'ni l''anonyme', 'anonyme', null,
        $q$select (journaliser_relance_de_demande('{DA}', '{DEMA}', 'essai-relance-demande@exemple.invalid', 'ESSAI', null, '{CHEF}')).canal$q$,
        '42501', 'permission denied for function journaliser_relance_de_demande', null),
      ('9', 'controle', 'une demande de B sous le dossier A : refusée, rien d''inscrit', 'service', null,
        $q$select (journaliser_relance_de_demande('{DA}', '{DEMB}', 'essai-relance-demande@exemple.invalid', 'ESSAI', null, '{CHEF}')).canal$q$,
        '22023', 'Cette demande n''est pas une demande de ce dossier : la relance par e-mail ne s''inscrit pas.', null),
      ('10', 'controle', 'une demande inconnue : refusée', 'service', null,
        $q$select (journaliser_relance_de_demande('{DA}', '{INCONNUE}', 'essai-relance-demande@exemple.invalid', 'ESSAI', null, '{CHEF}')).canal$q$,
        '22023', 'Cette demande n''est pas une demande de ce dossier : la relance par e-mail ne s''inscrit pas.', null),
      ('11', 'controle', 'un destinataire vide : refusé', 'service', null,
        $q$select (journaliser_relance_de_demande('{DA}', '{DEMA}', ' ', 'ESSAI', null, '{CHEF}')).canal$q$,
        '22023', 'Une relance par e-mail s''inscrit avec son destinataire, son objet et son auteur.', null),
      ('12', 'controle', 'une demande close entre le contrôle de send-email et l''inscription : ce qui est parti s''inscrit', 'service', null,
        $q$select (journaliser_relance_de_demande('{DA}', '{DEMC}', 'essai-relance-demande@exemple.invalid', 'ESSAI', null, '{CHEF}')).canal$q$,
        'OK', 'email', null),
      ('13', 'controle', 'la garde de B2 refuse toujours la relance écrite directement, même par le propriétaire', 'proprietaire', null,
        $q$with e as (insert into emails_envoyes (dossier_id, type, destinataire, objet)
                      values ('{DA}', 'relance_pieces', 'essai-relance-demande@exemple.invalid', 'ESSAI') returning id)
           insert into relances_demandes (dossier_id, demande_id, canal, email_id, relancee_par)
           select '{DA}', '{DEMA}', 'email', e.id, '{CHEF}' from e$q$,
        '42501', 'Une relance ne s''écrit que par sa fonction.', null),
      ('14', 'controle', 'un type inconnu au journal : toujours refusé', 'proprietaire', null,
        $q$insert into emails_envoyes (dossier_id, type, destinataire, objet) values ('{DA}', 'relance', 'essai-relance-demande@exemple.invalid', 'ESSAI')$q$,
        '23514', 'new row for relation "emails_envoyes" violates check constraint "emails_envoyes_type_check"%', null),

      -- ══ Le jeu, suite : une relance inscrite dans A, une dans B ══════════
      ('j6', 'jeu', 'la relance inscrite dans A', 'service', null,
        $q$select (journaliser_relance_de_demande('{DA}', '{DEMA}', 'essai-relance-demande@exemple.invalid', 'Une demande de votre cabinet attend votre réponse', 'resend-essai', '{CHEF}')).id::text$q$, 'OK', null, 'RELA'),
      ('j7', 'jeu', 'et une dans B', 'service', null,
        $q$select (journaliser_relance_de_demande('{DB}', '{DEMB}', 'essai-relance-demande-b@exemple.invalid', 'ESSAI B', null, '{CHEF}')).id::text$q$, 'OK', null, 'RELB'),

      ('15', 'controle', 'd''un seul tenant : la relance inscrite cite la ligne du journal « relance_demande » de A, au nom de l''auteur donné', 'service', null,
        $q$select r.canal || '/' || e.type || '/' || (e.dossier_id = '{DA}' and r.dossier_id = '{DA}')::text || '/'
               || (e.envoye_par = '{CHEF}' and r.relancee_par = '{CHEF}')::text || '/' || e.destinataire || '/' || e.resend_id
             from relances_demandes r join emails_envoyes e on e.id = r.email_id where r.id = '{RELA}'$q$,
        'OK', 'email/relance_demande/true/true/essai-relance-demande@exemple.invalid/resend-essai', null),

      -- ══ 20 à 23. Ce que lisent le client et le cabinet ══════════
      ('20', 'controle', 'sans aucune case, le client lit la relance de SON dossier, son canal compris', 'client', 'aucun',
        $q$select string_agg(canal, ',') from relances_demandes where id in ('{RELA}', '{RELB}')$q$, 'OK', 'email', null),
      ('21', 'controle', 'il ne lit pas la ligne du journal qu''elle cite', 'client', 'aucun',
        $q$select count(*)::text from emails_envoyes where id = (select email_id from relances_demandes where id = '{RELA}')$q$, 'OK', '0', null),
      ('22', 'controle', 'même avec « Ventes » : la lecture du client ne s''étend pas aux relances de demandes', 'client', 'ventes',
        $q$select count(*)::text from emails_envoyes where dossier_id in ('{DA}', '{DB}') and type = 'relance_demande'$q$, 'OK', '0', null),
      ('23', 'controle', 'le chef lit la ligne du journal de la relance (la policy du cabinet)', 'chef', null,
        $q$select e.type from emails_envoyes e where e.id = (select email_id from relances_demandes where id = '{RELA}')$q$,
        'OK', 'relance_demande', null),
      ('M1', 'mutation', 'le contrôle 6 rejoué par le service : il passe — le droit d''exécution juge', 'service', null,
        $q$select (journaliser_relance_de_demande('{DA}', '{DEMA}', 'essai-relance-demande@exemple.invalid', 'ESSAI', null, '{CHEF}')).canal$q$,
        'OK', 'email', null),
      ('M2', 'mutation', 'le contrôle 9 rejoué sous le dossier B : il passe — le dossier juge', 'service', null,
        $q$select (journaliser_relance_de_demande('{DB}', '{DEMB}', 'essai-relance-demande@exemple.invalid', 'ESSAI', null, '{CHEF}')).canal$q$,
        'OK', 'email', null),
      ('M3', 'mutation', 'le contrôle 22 rejoué par le chef : il lit les lignes « relance_demande » de A et B', 'chef', null,
        $q$select count(*)::text from emails_envoyes where dossier_id in ('{DA}', '{DB}') and type = 'relance_demande'$q$, 'OK', '2', null),
      ('M4', 'mutation', 'le contrôle 20 rejoué par le chef : il lit aussi la relance de B', 'chef', null,
        $q$select string_agg(canal, ',' order by canal) from relances_demandes where id in ('{RELA}', '{RELB}')$q$, 'OK', 'email,email', null)
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
        elsif s.qui in ('service', 'anonyme') then
          -- La clé secrète de `send-email` (le rôle du service, sans session), ou l'anonyme.
          if s.qui = 'service' then set local role service_role; else set local role anon; end if;
          perform set_config('request.jwt.claims', json_build_object('role',
            case s.qui when 'service' then 'service_role' else 'anon' end)::text, true);
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
    ((select count(*) from demandes_cabinet)), ((select count(*) from relances_demandes))
  ) as t(n);
  -- L'écart seul, non les comptes de toute la base, qui diraient le volume d'un dossier réel.
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)), 'ok', erreur is null and avant = apres);
  perform set_config('essai.relance_des_demandes_par_email', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'attente' then '*** EN ATTENTE ***'
                                 when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.relance_des_demandes_par_email')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, (regexp_match(v.controle, '^M?(\d+)'))[1]::int, v.controle;
