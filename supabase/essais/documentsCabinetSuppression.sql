-- LA SUPPRESSION, POUR LES DOCUMENTS ET LES DEMANDES DU CABINET (espace client, ligne 51.5, étape B2 ; la migration
-- `documents_et_demandes`, PRÉPARÉE) — SUR UNE RÉPLIQUE SEULEMENT, par psql, en UNE transaction (`psql -1`) : ce fichier
-- porte des SUPPRESSIONS, que l'outil d'exécution de la production soumet à une confirmation qui n'arrive pas ; il ne laisse
-- rien. Le reste — publier, retirer, lire, accuser, demander, répondre, relancer, clore, le catalogue — se rejoue par
-- `documentsCabinet.sql`, dont ce fichier reprend le moteur et le jeu (deux dossiers jetables, préfixe `b2000000`).
--
-- CE QUI SE PROUVE : le fichier d'un document ne se supprime du seau que par le chef du cabinet du dossier, sous le réglage
-- que l'API du stockage pose (`storage.allow_delete_query`), jamais par l'accès « Documents » qui le lit, ni par un compte
-- sans accès ; sans le réglage, la plateforme refuse à tous (RGPD.md §8.6) ; la pièce ou le document divers qu'une réponse
-- cite se supprime, et la réponse reste — son lien défait par la clé (`on delete set null`), la garde l'admettant, ce
-- qu'elle a joint et son empreinte toujours dits (B2-Q3) ; aucune ligne des cinq tables ne part en direct, pas même par le
-- rôle des Edge Functions ; la suppression du dossier emporte tout sans un refus. Trois mutations, qui doivent mordre.
--
-- Une garde de tête refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE) : le rôle `proprietaire`, qui y tient la
-- place du propriétaire des tables, manque à la production. Le stockage de la réplique se joue sous l'appartenance à
-- `supabase_storage_admin` que supautils donne à `postgres` en production (la mutation d'une policy du seau la demande).
-- Fichier TIRÉ du moteur de documentsCabinet.sql : le corriger là, puis le tirer de nouveau.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dd constant text := 'b2000000-0000-4000-8000-0000000000d1';
  ds constant text := 'b2000000-0000-4000-8000-0000000000d2';
  acces_d constant text := 'b2000000-0000-4000-8000-0000000000a1';
  acces_s constant text := 'b2000000-0000-4000-8000-0000000000a2';
  inconnu constant text := 'b2000000-0000-4000-8000-0000000000f1';
  doc constant text := 'b2000000-0000-4000-8000-0000000000c1';
  doc_s constant text := 'b2000000-0000-4000-8000-0000000000c2';
  piece constant text := 'b2000000-0000-4000-8000-0000000000e1';
  piece_c constant text := 'b2000000-0000-4000-8000-0000000000e2';
  piece_s constant text := 'b2000000-0000-4000-8000-0000000000e3';
  h constant text := repeat('ab', 32);
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  e record; k record; v_code text; v_msg text; v_req text; v_pose text; v_pose_client text; v_obs text; v_ok boolean; v_ddl text; v_avant text;
  -- Les gabarits d'une pose ou d'une requête : déposer un fichier (le chef, sous la forme exacte du chemin), publier, ouvrir
  -- une demande, déposer une pièce (le client, ou le cabinet), désigner la demande de DD.
  gabarits constant jsonb := jsonb_build_object(
    '{DEP}', $q$insert into storage.objects (bucket_id, name, metadata) values ('documents-cabinet', '{CH}', '{"size": 1000, "mimetype": "application/pdf"}'::jsonb)$q$,
    '{DEPS}', $q$insert into storage.objects (bucket_id, name, metadata) values ('documents-cabinet', '{CHS}', '{"size": 1000, "mimetype": "application/pdf"}'::jsonb)$q$,
    '{PUB}', $q$select 1 from publier_document_du_cabinet('{DD}', '{DOC}', '2035 de 2025', '2035', 2025, 'la 2035.pdf', '{CH}')$q$,
    '{PUBS}', $q$select 1 from publier_document_du_cabinet('{DS}', '{DOCS}', 'Attestation', 'attestation', null, 'attestation.pdf', '{CHS}')$q$,
    '{OUV}', $q$select 1 from ouvrir_demande('{DD}', 'Le relevé de décembre', 'Le relevé de décembre 2025, en PDF.', null, 'fichier')$q$,
    '{DEPC}', $q$insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, storage_hash) values ('{PIECE}', '{DD}', '{CLIENT}', '{DD}/essai-b2-client.pdf', 'releve.pdf', '{H}')$q$,
    '{DEPCS}', $q$insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, storage_hash) values ('{PIECES}', '{DS}', '{CLIENT}', '{DS}/essai-b2-client.pdf', 'releve.pdf', '{H}')$q$,
    '{DEPCAB}', $q$insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, storage_hash) values ('{PIECEC}', '{DD}', '{CHEF}', '{DD}/essai-b2-cabinet.pdf', 'cabinet.pdf', '{H}')$q$,
    '{DEM}', $q$(select d.id from demandes_cabinet d where d.dossier_id = '{DD}')$q$,
    '{SUP}', $q$select set_config('storage.allow_delete_query', 'true', true); with d as (delete from storage.objects where bucket_id = 'documents-cabinet' and name = '{CH}' returning 1) select count(*)::text from d$q$,
    '{DOCDIV}', $q$insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values ('{PIECES}', '{DD}', '{DD}/essai-b2-releve.pdf', 'releve.pdf', 'releve_bancaire', '{H}')$q$);
  valeurs constant jsonb := jsonb_build_object(
    '{CHS}', ds || '/' || doc_s || '/' || h || '.pdf', '{CH}', dd || '/' || doc || '/' || h || '.pdf',
    '{DOCS}', doc_s, '{DOC}', doc, '{DD}', dd, '{DS}', ds, '{PIECES}', piece_s, '{PIECEC}', piece_c, '{PIECE}', piece,
    '{CHEF}', chef, '{CLIENT}', client, '{INCONNU}', inconnu, '{H}', h);
  verdicts jsonb := '[]'::jsonb;
  mutations jsonb := '[]'::jsonb;
begin
  if to_regrole('proprietaire') is null then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai porte des suppressions, il ne se joue que sur une réplique.';
  end if;
  if to_regclass('public.documents_cabinet') is null then
    perform set_config('essai.documents_cabinet_suppression', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration documents_et_demandes', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- Le jeu : deux dossiers jetables et un accès du client d'essai à chacun, inséré par le propriétaire comme
    -- `create-client-access` l'insère — « Documents » posée à l'insertion sur DD (une insertion du cabinet pose les cases).
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (dd::uuid, 'ESSAI DOCUMENTS DD', cabinet, 'tresorerie', '455000', 'exonere'),
      (ds::uuid, 'ESSAI DOCUMENTS DS', cabinet, 'tresorerie', '455000', 'exonere');
    insert into memberships (id, user_id, dossier_id, role, email, droit_documents) values
      (acces_d::uuid, client::uuid, dd::uuid, 'client', 'essai-documents-d@example.test', true),
      (acces_s::uuid, client::uuid, ds::uuid, 'client', 'essai-documents-s@example.test', false);

    for e in
      with etapes (rang, etape, pose, pose_client, profil, requete, code, attendu) as (values
        (1, '1. le chef du cabinet du dossier (non super-administrateur) supprime le fichier d''un document, par l''API', '{DEP}; {PUB}', null, 'chef_simple',
          '{SUP}', 'OK', '1'),
        (2, '2. le client « Documents », qui lit le fichier, ne le supprime pas', '{DEP}; {PUB}', null, 'client', '{SUP}', 'OK', '0'),
        (3, '3. un compte connecté sans accès ne le supprime pas', '{DEP}; {PUB}', null, 'inconnu', '{SUP}', 'OK', '0'),
        (4, '4. sans le réglage de l''API, le stockage refuse à tous, au chef aussi', '{DEP}; {PUB}', null, 'chef',
          $q$with d as (delete from storage.objects where bucket_id = 'documents-cabinet' and name = '{CH}' returning 1) select count(*)::text from d$q$,
          '42501', 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'),
        (5, '5. le cabinet supprime la pièce qu''une réponse cite : la réponse reste', '{OUV}', '{DEPC}; select 1 from repondre_a_la_demande({DEM}, null, ''{PIECE}'', null)', 'chef',
          $q$with p as (delete from pieces where id = '{PIECE}' returning 1) select (select count(*) from p) || ' ' || (select count(*) from demandes_reponses r where r.dossier_id = '{DD}')$q$, 'OK', '1 1'),
        (6, '6. … relue après : « piece », son empreinte, plus de lien', '{OUV}', '{DEPC}; select 1 from repondre_a_la_demande({DEM}, null, ''{PIECE}'', null)', 'chef',
          $q$delete from pieces where id = '{PIECE}'; select (select count(*) from pieces where id = '{PIECE}') || ' ' || r.fichier || ' ' || r.fichier_sha256 || ' ' || coalesce(r.piece_id::text, 'sans lien') from demandes_reponses r where r.dossier_id = '{DD}'$q$, 'OK', '0 piece {H} sans lien'),
        (7, '7. le cabinet supprime le document divers qu''une réponse cite : la réponse reste, « document »', '{OUV}; {DOCDIV}', 'select 1 from repondre_a_la_demande({DEM}, ''Le relevé.'', null, ''{PIECES}'')', 'chef',
          $q$with p as (delete from documents_divers where id = '{PIECES}' returning 1) select (select count(*) from p) || ' ' || (select count(*) from demandes_reponses r where r.dossier_id = '{DD}' and r.fichier = 'document')$q$, 'OK', '1 1'),
        (8, '8. le rôle des Edge Functions ne retire pas un document en direct (la garde)', '{DEP}; {PUB}', null, 'service',
          $q$with d as (delete from documents_cabinet where dossier_id = '{DD}' returning 1) select count(*)::text from d$q$, '23514', 'Un document mis à disposition ne part qu''avec son dossier : il se retire, et la preuve de sa lecture reste.'),
        (9, '9. … ni une lecture', '{DEP}; {PUB}', 'select 1 from marquer_document_lu(''{DOC}'')', 'service',
          $q$with d as (delete from lectures_documents where dossier_id = '{DD}' returning 1) select count(*)::text from d$q$, '23514', 'La lecture d''un document ne part qu''avec son dossier : c''est la preuve de sa mise à disposition.'),
        (10, '10. … ni une demande', '{OUV}', null, 'service',
          $q$with d as (delete from demandes_cabinet where dossier_id = '{DD}' returning 1) select count(*)::text from d$q$, '23514', 'Une demande ne part qu''avec son dossier : elle se clôt, et l''historique reste.'),
        (11, '11. … ni une réponse', '{OUV}', 'select 1 from repondre_a_la_demande({DEM}, ''Voilà.'', null, null)', 'service',
          $q$with d as (delete from demandes_reponses where dossier_id = '{DD}' returning 1) select count(*)::text from d$q$, '23514', 'Une réponse ne part qu''avec son dossier : une parole datée reste.'),
        (12, '12. … ni une relance', '{OUV}; select 1 from relancer_demande({DEM})', null, 'service',
          $q$with d as (delete from relances_demandes where dossier_id = '{DD}' returning 1) select count(*)::text from d$q$, '23514', 'Une relance ne part qu''avec son dossier.'),
        (13, '13. la suppression du dossier emporte tout, la pièce citée comprise, sans un refus', '{DEP}; {PUB}; {OUV}; select 1 from relancer_demande({DEM})', 'select 1 from marquer_document_lu(''{DOC}''); {DEPC}; select 1 from repondre_a_la_demande({DEM}, ''Voilà.'', ''{PIECE}'', null)', 'service',
          $q$with d as (delete from dossiers where id = '{DD}' returning 1) select (select count(*) from d)::text$q$, 'OK', '1')
      ),
      mutations (m, libelle, ddl, rang) as (values
        ('M1', 'M1 — la garde des réponses refuse que le lien se défasse', $m$FONCTION:garder_reponse_a_une_demande():or (new.piece_id is null and not exists (select 1 from public.pieces p where p.id = old.piece_id)):$m$, 5),
        ('M2', 'M2 — la suppression du seau ouverte à l''accès « Documents »', $m$alter policy documents_cabinet_storage_suppression on storage.objects using (bucket_id = 'documents-cabinet' and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then public.client_du_dossier(((storage.foldername(name))[1])::uuid, 'documents') else false end)$m$, 2),
        ('M3', 'M3 — la suppression du seau fermée à tous : le chef ne retire plus le fichier', $m$alter policy documents_cabinet_storage_suppression on storage.objects using (false)$m$, 1)
      )
      select null::text as m, null::text as libelle, null::text as ddl, t.* from etapes t
      union all
      select mu.m, mu.libelle, mu.ddl, t.* from mutations mu join etapes t on t.rang = mu.rang
      order by 1 nulls first, rang
    loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        -- Une mutation : l'instruction, ou le remplacement d'un fragment dans le corps d'une fonction (`FONCTION:signature:
        -- fragment:remplacement`) ; un fragment introuvable ne s'applique pas, et la mutation le dit au lieu de mordre.
        if e.ddl is not null then
          if left(e.ddl, 9) = 'FONCTION:' then
            v_avant := pg_get_functiondef(('public.' || split_part(e.ddl, ':', 2))::regprocedure);
            v_ddl := replace(v_avant, split_part(e.ddl, ':', 3), split_part(e.ddl, ':', 4));
            if v_ddl = v_avant then
              raise exception 'MUTATION_SANS_EFFET';
            end if;
            execute v_ddl;
          else
            execute e.ddl;
          end if;
        end if;
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        -- Les gabarits d'abord (un dépôt, une publication, une demande), puis les valeurs : aucun gabarit n'en porte un autre.
        v_pose := e.pose; v_pose_client := e.pose_client; v_req := e.requete;
        for k in select g.key, g.value from jsonb_each_text(gabarits) g loop
          v_pose := replace(v_pose, k.key, k.value); v_pose_client := replace(v_pose_client, k.key, k.value); v_req := replace(v_req, k.key, k.value);
        end loop;
        for k in select g.key, g.value from jsonb_each_text(valeurs) g loop
          v_pose := replace(v_pose, k.key, k.value); v_pose_client := replace(v_pose_client, k.key, k.value); v_req := replace(v_req, k.key, k.value);
        end loop;
        if v_pose is not null then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        if v_pose_client is not null then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
          execute v_pose_client;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        begin
          if e.profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          elsif e.profil = 'service' then
            execute 'set local role service_role';
            perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
          else
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims',
              json_build_object('sub', case e.profil when 'chef' then chef when 'inconnu' then inconnu else client end, 'role', 'authenticated')::text, true);
          end if;
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
      v_ok := v_code = e.code and v_msg = case e.attendu
        when 'CHEMIN' then 'Le fichier d''un document se dépose sous <dossier>/<document>/<empreinte>.<pdf|jpg|png>, dans ce dossier et pour ce document : ce chemin n''a pas cette forme.'
        else replace(e.attendu, '{H}', h) end;
      if e.m is null then
        verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape, 'ok', v_ok, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
      else
        mutations := mutations || jsonb_build_object('rang', 100 + substr(e.m, 2)::int, 'etape', e.libelle || ' (l''étape ' || e.rang || ')',
          'ok', not v_ok and v_code <> 'ESSAI', 'observe', case when v_ok then '*** NE MORD PAS *** ' else 'le contrôle mord : ' end || v_code || ' ' || coalesce(v_msg, '-'));
      end if;
    end loop;

    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs lignes, ni leurs fichiers, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (dd::uuid, ds::uuid))
      and not exists (select 1 from documents_cabinet where dossier_id in (dd::uuid, ds::uuid))
      and not exists (select 1 from storage.objects where bucket_id = 'documents-cabinet' and split_part(name, '/', 1) in (dd, ds))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.documents_cabinet_suppression', (verdicts || mutations)::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.documents_cabinet_suppression')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
