-- L'E-REPORTING DANS L'ÉTAT DE LA FACTURE ÉLECTRONIQUE, ÉPROUVÉ EN BASE (espace client, étape C3, ligne 51.5) — à rejouer
-- par `execute_sql` après toute migration qui touche `etat_facture_electronique`, `regimes_ereporting`,
-- `declarations_ereporting`, `gere_les_ventes`, `client_du_dossier`, `memberships` ou le statut de TVA des dossiers.
--
-- Ce qui se prouve ici, par impersonation : l'accès d'hier, avant toute lecture (anonyme, compte rattaché à rien, client
-- sans « Ventes », client « Ventes » d'un autre dossier : 42501 et sa raison) ; pour le client « Ventes » et pour le chef
-- du cabinet, la quatrième clé `ereporting` et ses clés exactes ; les régimes ACTIFS seuls, dans l'ordre de `depuis` ; les
-- déclarations ACTIVES seules, et seulement celles dont la période a fini il y a 92 jours au plus ; et que RIEN du cabinet
-- au-delà des phases ne sort : ni la note d'un régime ou d'une déclaration, ni la plateforme où elle a été déposée, ni son
-- contenu, son empreinte, son auteur, ses identifiants — chacun PLANTÉ, puis cherché dans le texte rendu.
--
-- SANS LA MIGRATION `apercu_facture_electronique`, une seule ligne la dit, « EN ATTENTE », sans être une faute (elle est
-- présentée au cabinet avant d'être appliquée) ; elle EN EST UNE si l'historique la porte sans retour arrière plus récent.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du chef — A (basculé, en franchise, où le client de l'essai a un accès
-- d'essai), B (sans accès du client) —, dans un bloc qui s'annule entièrement (`ANNULATION_ESSAI_GLOBALE`) : chaque
-- contrôle dans sa sous-transaction, annulée (`ANNULATION_ESSAI`). Le fichier ne crée aucune table et ne porte aucune
-- suppression ni mise à jour sans `where`. Hors de l'outil, il se joue en UNE transaction (`psql -1`). LES MUTATIONS
-- (genre « mutation ») rejouent un contrôle avec un droit, un profil ou une donnée délibérément faux : chacune doit
-- MORDRE, c'est-à-dire échouer là où le contrôle qu'elle vise réussit. src/lib/apercuEreporting.test.ts lit ici les clés
-- rendues et la borne des 92 jours.
do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cabinet uuid;
  jour date := (now() at time zone 'Europe/Paris')::date;
  ids jsonb;
  s record; k text; ordre text; partie text; rendu text; accepte boolean; code_recu text; message text; ok boolean;
  erreur text; applique text; retour text; avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  if (select position('regimes_ereporting' in p.prosrc) = 0 from pg_proc p
       where p.oid = to_regprocedure('public.etat_facture_electronique(uuid)')) then
    select max(version) filter (where name = 'apercu_facture_electronique'),
           max(version) filter (where name = 'retour_apercu_facture_electronique')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := jsonb_build_array(jsonb_build_object(
      'controle', '0. EN ATTENTE : la migration apercu_facture_electronique (étape C3) n''est pas en base', 'genre', 'controle',
      'observe', 'historique : ' || coalesce('apercu_facture_electronique ' || applique, 'sans apercu_facture_electronique')
                 || coalesce(', retour ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique)));
    perform set_config('essai.apercu_facture_electronique', verdicts::text, true);
    return;
  end if;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or not exists (select 1 from memberships where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;
  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'c3c30000-0000-4000-8000-0000000000a1', 'DB', 'c3c30000-0000-4000-8000-0000000000b1',
    'ACCES', 'c3c30000-0000-4000-8000-0000000000e1', 'CREATEUR', 'c3c30000-0000-4000-8000-00000000c3c3',
    'R0', 'c3c30000-0000-4000-8000-000000000f00', 'R1', 'c3c30000-0000-4000-8000-000000000f01',
    'X1', 'c3c30000-0000-4000-8000-000000000d01', 'X2', 'c3c30000-0000-4000-8000-000000000d02',
    'X3', 'c3c30000-0000-4000-8000-000000000d03',
    'FIN_DANS', (jour - 92)::text, 'FIN_HORS', (jour - 93)::text, 'DEBUT_BORNE', (jour - 120)::text);
  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from regimes_ereporting)),
    ((select count(*) from declarations_ereporting))) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre(s) séparés par « §§ », code attendu ou OK, valeur
      -- attendue (like) ou message attendu)
      ('j1', 'jeu', 'deux dossiers jetables : A basculé, en franchise ; B redevable', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, siret, ventes_par_les_factures) values
          ('{DA}', 'ESSAI C3 A', '{CAB}', 'franchise', false, '12345678200010', true),
          ('{DB}', 'ESSAI C3 B', '{CAB}', 'redevable', true, '987654321', false)$q$, 'OK', null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-c3@exemple.invalid')$q$, 'OK', null),
      ('j3', 'jeu', 'A : un régime RETIRÉ, puis un régime actif, chacun avec une note et un auteur PLANTÉS', 'proprietaire', null,
        $q$insert into regimes_ereporting (id, dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements,
             note, cree_par, retire_le, retire_par) values
          ('{R0}', '{DA}', '2025-01-01', 'franchise', false, 'bimestre', 'bimestre', 'ZQX-NOTE-REGIME-RETIRE', '{CREATEUR}', now(), '{CREATEUR}'),
          ('{R1}', '{DA}', '2026-01-01', 'franchise', false, 'bimestre', 'bimestre', 'ZQX-NOTE-REGIME', '{CREATEUR}', null, null)$q$, 'OK', null),
      ('j4', 'jeu', 'A : une déclaration active récente, une remplacée, une active ancienne ; plateforme, note, contenu et empreinte PLANTÉS', 'proprietaire', null,
        $q$insert into declarations_ereporting (id, dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal,
             plateforme, contenu, empreinte, nb_operations, etat, note, cree_par) values
          ('{X1}', '{DA}', 'ventes', '{DEBUT_BORNE}', '{FIN_DANS}', '{R1}', 'IN', 'manuel', 'ZQX-PLATEFORME', '{"marque": "ZQX-CONTENU"}',
             encode(sha256(convert_to('{"marque": "ZQX-CONTENU"}'::jsonb::text, 'UTF8')), 'hex'), 3, 'declaree', 'ZQX-NOTE-DECLARATION', '{CREATEUR}'),
          ('{X2}', '{DA}', 'achats', '{DEBUT_BORNE}', '{FIN_DANS}', '{R1}', 'IN', 'manuel', 'ZQX-PLATEFORME', '{"marque": "ZQX-CONTENU"}',
             encode(sha256(convert_to('{"marque": "ZQX-CONTENU"}'::jsonb::text, 'UTF8')), 'hex'), 2, 'remplacee', null, '{CREATEUR}'),
          ('{X3}', '{DA}', 'paiements', '{DEBUT_BORNE}', '{FIN_HORS}', '{R1}', 'IN', 'manuel', 'ZQX-PLATEFORME', '{"marque": "ZQX-CONTENU"}',
             encode(sha256(convert_to('{"marque": "ZQX-CONTENU"}'::jsonb::text, 'UTF8')), 'hex'), 1, 'declaree', null, '{CREATEUR}')$q$, 'OK', null),

      -- ══ L'accès d'hier, avant toute lecture ══════════
      ('1', 'controle', 'l''anonyme est refusé : la fonction ne lui est pas exécutable', 'anon', null,
        $q$select public.etat_facture_electronique('{DA}')::text$q$, '42501', 'permission denied for function etat_facture_electronique'),
      ('2', 'controle', 'un compte rattaché à rien est refusé', 'inconnu', null,
        $q$select public.etat_facture_electronique('{DA}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('3', 'controle', 'le client sans « Ventes » est refusé', 'client', 'aucun',
        $q$select public.etat_facture_electronique('{DA}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('3m', 'mutation', 'le même contrôle, l''accès portant « Ventes »', 'client', 'ventes',
        $q$select public.etat_facture_electronique('{DA}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('4', 'controle', 'le client « Ventes » est refusé sur un autre dossier', 'client', 'ventes',
        $q$select public.etat_facture_electronique('{DB}')::text$q$, '42501', 'Accès refusé à ce dossier.'),

      -- ══ Ce que rend la fonction au client « Ventes » ══════════
      ('5', 'controle', 'la racine : les trois clés d''hier et `ereporting`', 'client', 'ventes',
        $q$select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(public.etat_facture_electronique('{DA}')) k$q$,
        'OK', 'adresse,ereporting,plateforme,superpdp'),
      ('6', 'controle', '`ereporting` : ses trois clés exactes', 'client', 'ventes',
        $q$select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(public.etat_facture_electronique('{DA}') -> 'ereporting') k$q$,
        'OK', 'declarations,regimes,statut_du_dossier'),
      ('7', 'controle', 'le statut du dossier : ses quatre clés, la franchise', 'client', 'ventes',
        $q$select (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(e -> 'statut_du_dossier') k) || ' ' || (e #>> '{statut_du_dossier,statut_tva}')
           from (select public.etat_facture_electronique('{DA}') -> 'ereporting' as e) t$q$,
        'OK', 'article_exoneration,statut_tva,tva_periodicite,tva_sur_debits franchise'),
      ('8', 'controle', 'les régimes : l''actif seul, ses sept clés, le retiré absent', 'client', 'ventes',
        $q$select (public.etat_facture_electronique('{DA}') #> '{ereporting,regimes}')::text$q$,
        'OK', '[{"depuis": "2026-01-01", "statut_tva": "franchise", "tva_sur_debits": false, "tva_periodicite": null, "article_exoneration": null, "frequence_paiements": "bimestre", "frequence_transactions": "bimestre"}]'),
      ('8m', 'mutation', 'le même contrôle, un second régime actif posé dans la sous-transaction', 'client', 'ventes',
        $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements)
             values ('{DA}', '2026-06-01', 'franchise', false, 'bimestre', 'bimestre')§§select (public.etat_facture_electronique('{DA}') #> '{ereporting,regimes}')::text$q$,
        'OK', '[{"depuis": "2026-01-01", "statut_tva": "franchise", "tva_sur_debits": false, "tva_periodicite": null, "article_exoneration": null, "frequence_paiements": "bimestre", "frequence_transactions": "bimestre"}]'),
      ('9', 'controle', 'les déclarations : l''active finie il y a 92 jours seule (ni la remplacée, ni celle de 93 jours), ses quatre clés', 'client', 'ventes',
        $q$select jsonb_array_length(d) || ' ' || (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(d -> 0) k)
             || ' ' || (d -> 0 ->> 'objet') || ' ' || (d -> 0 ->> 'debut') || ' ' || (d -> 0 ->> 'fin')
             || ' ' || ((d -> 0 ->> 'declaree_le')::timestamptz is not null)
           from (select public.etat_facture_electronique('{DA}') #> '{ereporting,declarations}' as d) t$q$,
        'OK', '1 debut,declaree_le,fin,objet ventes {DEBUT_BORNE} {FIN_DANS} true'),
      ('9m', 'mutation', 'le même contrôle, une déclaration active de plus, finie il y a 92 jours, posée dans la sous-transaction', 'client', 'ventes',
        $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal,
             plateforme, contenu, empreinte, nb_operations, etat) values ('{DA}', 'paiements', '{FIN_DANS}', '{FIN_DANS}', '{R1}', 'IN',
             'manuel', 'ZQX-PLATEFORME', '{}', encode(sha256(convert_to('{}'::jsonb::text, 'UTF8')), 'hex'), 1, 'declaree')§§select jsonb_array_length(d) || ' ' || (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(d -> 0) k)
             || ' ' || (d -> 0 ->> 'objet') || ' ' || (d -> 0 ->> 'debut') || ' ' || (d -> 0 ->> 'fin')
             || ' ' || ((d -> 0 ->> 'declaree_le')::timestamptz is not null)
           from (select public.etat_facture_electronique('{DA}') #> '{ereporting,declarations}' as d) t$q$,
        'OK', '1 debut,declaree_le,fin,objet ventes {DEBUT_BORNE} {FIN_DANS} true'),
      ('10', 'controle', 'rien du cabinet au-delà des phases : ni note, ni plateforme, ni contenu, ni empreinte (celle du contenu planté, calculée comme la garde la veut), ni auteur, ni identifiant', 'client', 'ventes',
        $q$select case when t ~ 'ZQX|{CREATEUR}|{R0}|{R1}|{X1}|{X2}|{X3}|"(id|note|plateforme|contenu|empreinte|cree_par|nb_operations|identifiant_fichier|regime_id)"'
               or position(encode(sha256(convert_to('{"marque": "ZQX-CONTENU"}'::jsonb::text, 'UTF8')), 'hex') in t) > 0
             then 'TROUVÉ : ' || t else 'absents' end
           from (select (public.etat_facture_electronique('{DA}') -> 'ereporting')::text as t) x$q$,
        'OK', 'absents'),
      ('10m', 'mutation', 'le même filet, sur un texte du jeu qui y est', 'client', 'ventes',
        $q$select case when t ~ 'ZQX|franchise' then 'TROUVÉ : ' || t else 'absents' end
           from (select (public.etat_facture_electronique('{DA}') -> 'ereporting')::text as t) x$q$,
        'OK', 'absents'),

      -- ══ Le cabinet lit la même chose ══════════
      ('11', 'controle', 'le chef du cabinet : la même quatrième clé, au caractère près', 'chef', null,
        $q$select (public.etat_facture_electronique('{DA}') -> 'ereporting')::text = (
             select jsonb_build_object('statut_du_dossier', jsonb_build_object('statut_tva', 'franchise', 'article_exoneration', null,
                      'tva_periodicite', d.tva_periodicite, 'tva_sur_debits', d.tva_sur_debits),
                    'regimes', jsonb_build_array(jsonb_build_object('depuis', '2026-01-01', 'statut_tva', 'franchise', 'article_exoneration', null,
                      'tva_periodicite', null, 'tva_sur_debits', false, 'frequence_transactions', 'bimestre', 'frequence_paiements', 'bimestre')),
                    'declarations', jsonb_build_array(jsonb_build_object('objet', 'ventes', 'debut', '{DEBUT_BORNE}', 'fin', '{FIN_DANS}',
                      'declaree_le', x.cree_le)))::text
               from dossiers d, declarations_ereporting x where d.id = '{DA}' and x.id = '{X1}')$q$,
        'OK', 'true'),
      ('12', 'controle', 'B, sans régime ni déclaration : deux listes vides, jamais nulles', 'chef', null,
        $q$select (public.etat_facture_electronique('{DB}') #> '{ereporting,regimes}')::text || ' ' || (public.etat_facture_electronique('{DB}') #> '{ereporting,declarations}')::text$q$,
        'OK', '[] []')
    ) as t(num, genre, controle, qui, droits, ordre, code, attendu) loop
      ordre := s.ordre;
      for k in select jsonb_object_keys(ids) loop
        ordre := replace(ordre, '{' || k || '}', ids ->> k);
        s.attendu := replace(s.attendu, '{' || k || '}', ids ->> k);
      end loop;
      if s.droits is not null then
        update memberships set droit_ventes = s.droits = 'ventes' where id = (ids ->> 'ACCES')::uuid;
      end if;
      accepte := false; code_recu := null; message := null; rendu := null;
      begin
        if s.qui = 'anon' then
          set local role anon;
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        elsif s.qui in ('inconnu', 'client', 'chef') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'inconnu' then gen_random_uuid() when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        else
          perform set_config('request.jwt.claims', '', true);
        end if;
        foreach partie in array string_to_array(ordre, '§§') loop
          -- Une insertion glissée dans l'étape d'un compte (une mutation) se fait en propriétaire, puis l'étape reprend
          -- son profil.
          if partie ~* '^\s*insert' and s.qui in ('client', 'chef') then
            reset role;
            perform set_config('request.jwt.claims', '', true);
          end if;
          if partie ~* '^\s*insert' then
            execute partie;
          else
            execute partie into rendu;
          end if;
          if partie ~* '^\s*insert' and s.qui in ('client', 'chef') then
            set local role authenticated;
            perform set_config('request.jwt.claims', json_build_object('sub', case s.qui when 'chef' then chef else client end,
              'role', 'authenticated')::text, true);
          end if;
        end loop;
        accepte := true;
        if s.genre <> 'jeu' then
          raise exception 'ANNULATION_ESSAI';
        end if;
      exception when others then
        if sqlerrm <> 'ANNULATION_ESSAI' then code_recu := sqlstate; message := sqlerrm; accepte := false; end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      ok := case when s.code = 'OK' then accepte and coalesce(rendu, '') = coalesce(s.attendu, rendu, '')
                 else not accepte and code_recu = s.code and message like s.attendu end;
      if s.genre = 'jeu' and not ok then
        raise exception 'ESSAI_IMPOSSIBLE : le jeu % n''a pas pu être posé (% %)', s.num, code_recu, message;
      end if;
      if s.genre <> 'jeu' then
        verdicts := verdicts || jsonb_build_object('controle', s.num || '. ' || s.controle, 'genre', s.genre,
          'observe', case when accepte then 'accepté : ' || left(coalesce(rendu, '—'), 300) else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
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
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from regimes_ereporting)),
    ((select count(*) from declarations_ereporting))) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '999. l''essai s''est joué jusqu''au bout, et rien n''est resté en base',
    'genre', 'controle', 'observe', coalesce(erreur || ' — ', '') || case when avant = apres then 'aucun écart' else 'ÉCART' end,
    'ok', erreur is null and avant = apres);
  perform set_config('essai.apercu_facture_electronique', verdicts::text, true);
end
$essai$;

-- Les verdicts : un contrôle juste dit « ok » ; une mutation dit « mord » quand elle s'exécute ET rend autre chose que ce
-- que son contrôle exige — une mutation qui lève pour une autre raison ne mord pas.
select v.genre, v.controle,
       case when v.genre = 'mutation' then case when not v.ok and v.observe like 'accepté%' then 'mord' else '*** NE MORD PAS ***' end
            else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict,
       v.observe
  from jsonb_to_recordset(current_setting('essai.apercu_facture_electronique')::jsonb)
       as v(controle text, genre text, observe text, ok boolean);
