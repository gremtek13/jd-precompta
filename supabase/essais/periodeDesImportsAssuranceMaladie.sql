-- LA PÉRIODE D'UN IMPORT DES PAIEMENTS DE L'ASSURANCE MALADIE, SUR SES SEULS PAIEMENTS INSÉRÉS (conception 53, § 14.1 ;
-- NOE4R-Q1 (A) ; la migration `periode_des_imports_assurance_maladie`, préparée le 27/11/2026, PAS APPLIQUÉE :
-- supabase/preparees/20261127215000_periode_des_imports_assurance_maladie.sql). Le récit : HISTORIQUE.md, « 27/11/2026 —
-- NOE4R-Q1 ET NOE4R-Q2 ». À rejouer par `execute_sql` après toute migration qui touche `importer_paiements_assurance_maladie`
-- ou les deux tables des paiements ; le reste de la fonction (ses refus, ses droits, la lecture du client) :
-- paiementsAssuranceMaladie.sql, dont les étapes 24 et 72 suivent la même règle.
--
-- Ce qui se prouve ici : un import neuf porte la période de tous ses paiements ; un fichier qui en recouvre un autre ne porte
-- que celle des paiements qu'il insère — une journée neuve au milieu de journées passées, ou deux extrêmes neufs autour d'une
-- journée passée —, et ses seuls paiements neufs ; ses rejets restent ceux du fichier ; un fichier dont chaque paiement est
-- déjà en base se refuse toujours (« rien de neuf »), même quand il dit d'autres rejets, au lieu de s'écrire sans période ;
-- le client « Banque » suit la même règle ; le catalogue.
--
-- Un dossier jetable du cabinet du dossier `test` (préfixe `e5310000-0000-4000-8000`), où l'accès du client d'essai porte
-- « Banque ». Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose d'abord
-- (sous sa session), puis la requête du profil ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté »
-- le relit. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.periode_des_imports`), que la requête finale
-- lit : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne
-- rend rien qui dépende d'une ligne hors de son dossier. Hors de l'outil d'exécution, il se joue en UNE transaction
-- (`psql -1`). Sans la migration (le marqueur `NOE4R-Q1` absent du corps de la fonction d'import), une ligne dit qu'il attend
-- (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  db constant text := 'e5310000-0000-4000-8000-0000000000d1';
  acces_b constant text := 'e5310000-0000-4000-8000-0000000000a1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  jour constant date := (now() at time zone 'Europe/Paris')::date;
  -- Les paiements d'essai, chacun sous sa clé : la part obligatoire de J-5, la complémentaire de J-3, la part obligatoire de
  -- J-3 et celle de J-1 ; des centimes.
  p5 jsonb; p3c jsonb; p3o jsonb; p1 jsonb;
  imp_base text; imp_milieu text; imp_extremes text; imp_seul text; imp_autres_rejets text;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text; v_attendu text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and p.proname = 'importer_paiements_assurance_maladie' and p.prosrc like '%NOE4R-Q1%') then
    perform set_config('essai.periode_des_imports', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration periode_des_imports_assurance_maladie (NOE4R-Q1)', 'ok', true,
      'observe', 'la fonction d''import date encore un import par tout son fichier : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  p5 := jsonb_build_object('date_journee_comptable', to_char(jour - 5, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'organisme_complementaire', null,
    'part', 'obligatoire', 'montant_centimes', 12345, 'regularisations_centimes', 0, 'nombre_de_factures', 7);
  p3c := jsonb_build_object('date_journee_comptable', to_char(jour - 3, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'organisme_complementaire', null,
    'part', 'complementaire', 'montant_centimes', 2345, 'regularisations_centimes', 0, 'nombre_de_factures', 3);
  p3o := jsonb_build_object('date_journee_comptable', to_char(jour - 3, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'organisme_complementaire', null,
    'part', 'obligatoire', 'montant_centimes', 4000, 'regularisations_centimes', 0, 'nombre_de_factures', 2);
  p1 := jsonb_build_object('date_journee_comptable', to_char(jour - 1, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'organisme_complementaire', null,
    'part', 'obligatoire', 'montant_centimes', 900, 'regularisations_centimes', -100, 'nombre_de_factures', 1);
  -- Le premier fichier : J-5, J-3 (complémentaire), J-1, deux rejets.
  imp_base := jsonb_build_object('version', 1, 'paiements', jsonb_build_array(p5, p3c, p1),
    'rejets', jsonb_build_object('nombre', 2, 'montant_centimes', 4500))::text;
  -- Le même, la part obligatoire de J-3 en plus, trois autres rejets : une journée neuve au milieu de journées passées.
  imp_milieu := jsonb_build_object('version', 1, 'paiements', jsonb_build_array(p5, p3c, p3o, p1),
    'rejets', jsonb_build_object('nombre', 3, 'montant_centimes', 700))::text;
  -- La complémentaire de J-3 seule, sans rejets dits.
  imp_seul := jsonb_build_object('version', 1, 'paiements', jsonb_build_array(p3c), 'rejets', null)::text;
  -- J-5 et J-1 autour de la complémentaire de J-3 : deux extrêmes neufs autour d'une journée passée.
  imp_extremes := jsonb_build_object('version', 1, 'paiements', jsonb_build_array(p5, p3c, p1), 'rejets', null)::text;
  -- Le premier fichier, d'autres rejets dits.
  imp_autres_rejets := jsonb_build_object('version', 1, 'paiements', jsonb_build_array(p5, p3c, p1),
    'rejets', jsonb_build_object('nombre', 5, 'montant_centimes', 999))::text;
  begin
    -- Le jeu : un dossier jetable, et un accès « Banque » du client d'essai, insérés par le propriétaire comme
    -- `create-client-access` les insère — la case posée à l'insertion.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (db::uuid, 'ESSAI PERIODE DES IMPORTS DB', cabinet, 'tresorerie', '455000', 'exonere');
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque) values
      (acces_b::uuid, client::uuid, db::uuid, 'client', 'essai-periode-des-imports@example.test', true);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (super-administrateur, sous sa session), le profil — `chef` ou
    -- `client` —, sa requête, le code attendu (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}. `{Jn}` : le jour de
    -- Paris décalé de n jours. La requête qui appelle la fonction d'écriture lit ce qu'elle rend (l'import écrit), jamais ce
    -- qu'elle a écrit ailleurs : ce que l'import a écrit se lit à l'étape suivante, posé par le chef.
    for e in select * from (values
      (1, '1. un import neuf : sa période est celle de tous ses paiements, tous insérés ; ses rejets, ceux du fichier', null, 'chef',
        $q$select i.periode_du || ' ' || i.periode_au || ' ' || i.nombre_de_rejets || ' ' || i.montant_rejete_centimes from importer_paiements_assurance_maladie('{DB}', '{BASE}'::jsonb) i$q$,
        'OK', '{J5} {J1} 2 4500'),
      (2, '2. une journée neuve au milieu de journées déjà en base : la période est celle de la seule neuve (le client « Banque »)',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{BASE}'::jsonb)$q$, 'client',
        $q$select i.periode_du || ' ' || i.periode_au from importer_paiements_assurance_maladie('{DB}', '{MILIEU}'::jsonb) i$q$,
        'OK', '{J3} {J3}'),
      (3, '3. … ses rejets restent ceux du fichier, journées passées comprises',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{BASE}'::jsonb)$q$, 'chef',
        $q$select i.nombre_de_rejets || ' ' || i.montant_rejete_centimes from importer_paiements_assurance_maladie('{DB}', '{MILIEU}'::jsonb) i$q$,
        'OK', '3 700'),
      (4, '4. … et seul le paiement neuf entre : l''import d''avant garde les siens, et sa période',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{BASE}'::jsonb); select 1 from importer_paiements_assurance_maladie('{DB}', '{MILIEU}'::jsonb)$q$, 'client',
        $q$select string_agg(c.n || ':' || c.du || '..' || c.au, ',' order by c.n desc) from (select count(p.id) as n, i.periode_du as du, i.periode_au as au from imports_assurance_maladie i left join paiements_assurance_maladie p on p.import_id = i.id where i.dossier_id = '{DB}' group by i.id, i.periode_du, i.periode_au) c$q$,
        'OK', '3:{J5}..{J1},1:{J3}..{J3}'),
      (5, '5. deux extrêmes neufs autour d''une journée déjà en base : la période va de l''un à l''autre',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{SEUL}'::jsonb)$q$, 'chef',
        $q$select i.periode_du || ' ' || i.periode_au from importer_paiements_assurance_maladie('{DB}', '{EXTREMES}'::jsonb) i$q$,
        'OK', '{J5} {J1}'),
      (6, '6. … et la journée passée reste à l''import qui l''a apportée',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{SEUL}'::jsonb); select 1 from importer_paiements_assurance_maladie('{DB}', '{EXTREMES}'::jsonb)$q$, 'chef',
        $q$select string_agg(c.n::text, ',' order by c.n) from (select count(*) as n from paiements_assurance_maladie p where p.dossier_id = '{DB}' group by p.import_id) c$q$,
        'OK', '1,2'),
      (7, '7. un fichier dont chaque paiement est déjà en base se refuse toujours, au lieu de s''écrire sans période (22023)',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{BASE}'::jsonb)$q$, 'client',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{BASE}'::jsonb)$q$, '22023', 'Ces paiements sont déjà tous importés : rien de neuf.'),
      (8, '8. … même quand il dit d''autres rejets : ils ne s''écrivent pas une seconde fois (22023)',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{BASE}'::jsonb)$q$, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{AUTRES_REJETS}'::jsonb)$q$, '22023', 'Ces paiements sont déjà tous importés : rien de neuf.'),
      (9, '9. … et rien n''en est resté : un seul import, le premier, ses rejets',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{BASE}'::jsonb)$q$, 'chef',
        $q$select count(*) || ' ' || min(i.nombre_de_rejets) || ' ' || min(i.montant_rejete_centimes) from imports_assurance_maladie i where i.dossier_id = '{DB}'$q$,
        'OK', '1 2 4500')
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      v_attendu := replace(replace(replace(e.attendu,
        '{J5}', to_char(jour - 5, 'YYYY-MM-DD')), '{J3}', to_char(jour - 3, 'YYYY-MM-DD')), '{J1}', to_char(jour - 1, 'YYYY-MM-DD'));
      begin
        if e.pose is not null then
          v_pose := replace(replace(replace(replace(replace(replace(e.pose, '{BASE}', imp_base), '{MILIEU}', imp_milieu), '{SEUL}', imp_seul),
            '{EXTREMES}', imp_extremes), '{AUTRES_REJETS}', imp_autres_rejets), '{DB}', db);
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := replace(replace(replace(replace(replace(replace(e.requete, '{BASE}', imp_base), '{MILIEU}', imp_milieu), '{SEUL}', imp_seul),
          '{EXTREMES}', imp_extremes), '{AUTRES_REJETS}', imp_autres_rejets), '{DB}', db);
        begin
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims',
            json_build_object('sub', case e.profil when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
          execute v_req into v_obs;
          reset role;
          v_msg := coalesce(v_obs, '');
        exception when others then
          reset role;
          v_code := sqlstate;
          v_msg := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'ESSAI';
          v_msg := sqlstate || ' ' || sqlerrm;
        end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and v_msg = v_attendu, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;

    -- Le catalogue : le corps à son marqueur ; la fonction aux droits du propriétaire, son chemin fixé ; authenticated
    -- l'exécute, ni l'anonyme ni PUBLIC ; le commentaire de la colonne dit la règle.
    verdicts := verdicts || jsonb_build_object('rang', 10, 'etape', '10. le catalogue : la fonction d''import à son marqueur, aux droits du propriétaire, son chemin fixé ; authenticated l''exécute, ni l''anonyme ni PUBLIC ; la colonne dit la règle',
      'ok', (select count(*) from pg_proc p
              where p.oid = 'public.importer_paiements_assurance_maladie(uuid, jsonb)'::regprocedure
                and p.prosrc like '%NOE4R-Q1%' and p.prosecdef
                and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
                and not has_function_privilege('anon', p.oid, 'execute')
                and has_function_privilege('authenticated', p.oid, 'execute')
                and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) = 1
        and col_description('public.imports_assurance_maladie'::regclass,
              (select a.attnum from pg_attribute a where a.attrelid = 'public.imports_assurance_maladie'::regclass and a.attname = 'periode_du'))
            like '%NOE4R-Q1%',
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni le dossier jetable, ni son accès, ni ses imports et paiements.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le dossier jetable, ni son accès, ni ses imports et paiements',
    'ok', not exists (select 1 from dossiers where id = db::uuid)
      and not exists (select 1 from memberships where id = acces_b::uuid)
      and not exists (select 1 from imports_assurance_maladie where dossier_id = db::uuid)
      and not exists (select 1 from paiements_assurance_maladie where dossier_id = db::uuid),
    'observe', 'relu');
  perform set_config('essai.periode_des_imports', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.periode_des_imports')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
