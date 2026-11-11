-- LES DOCUMENTS ET LES DEMANDES DU CABINET (espace client, ligne 51.5, étape B2 ; la migration `documents_et_demandes`,
-- PRÉPARÉE : supabase/preparees/20261111234000_documents_et_demandes.sql). Le récit : HISTORIQUE.md, « 11/11/2026 — B2 :
-- LES DOCUMENTS ET LES DEMANDES DU CABINET, EN BASE (LIGNE 51.5) (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer après toute
-- migration qui touche ses tables, ses fonctions, `client_du_dossier`, `memberships`, `pieces`, `documents_divers` ou les
-- policies du stockage. Ce qu'une SUPPRESSION rencontre — le lien d'une réponse vers un dépôt que le cabinet supprime, la
-- suppression d'un fichier du seau — ne se joue pas ici (l'outil d'exécution de la production retient une suppression) :
-- supabase/essais/documentsCabinetSuppression.sql, sur une réplique.
--
-- Ce qui se prouve ici, et ne se relit pas : le cabinet publie, retire, ouvre, relance et clôt ; chaque refus sous ses mots,
-- dans son ordre ; l'accès « Documents » lit les documents publiés et non retirés de son dossier, et leurs fichiers, rien
-- d'autre du seau ; un accès sans la case n'en lit rien ; l'accusé de lecture, une fois par compte, au client « Documents »
-- seul ; tout accès lit les demandes, leurs réponses et leurs relances, et répond par un dépôt à lui ; personne n'écrit ni
-- ne réécrit les tables en direct, pas même le rôle des Edge Functions ; `document_du_cabinet_publie` ne répond vrai qu'au
-- cabinet et à l'accès « Documents » ; le catalogue. Et huit MUTATIONS, qui doivent mordre : chacune affaiblit un contrôle
-- le temps d'une sous-transaction et rejoue l'étape qui le garde.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `b2000000-0000-4000-8000`) : DD, où l'accès du client d'essai
-- porte « Documents », et DS, où il ne la porte pas. Chaque étape se joue dans sa sous-transaction et s'y ANNULE
-- (`ANNULATION_ETAPE`) : ce que le chef pose d'abord (super-administrateur, sous sa session), ce que le client pose ensuite
-- (un dépôt), puis la requête du profil ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le
-- relit. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.documents_cabinet`) : le fichier se joue d'un
-- seul appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une
-- ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration, une
-- ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
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
    '{DEM}', $q$(select d.id from demandes_cabinet d where d.dossier_id = '{DD}')$q$);
  valeurs constant jsonb := jsonb_build_object(
    '{CHS}', ds || '/' || doc_s || '/' || h || '.pdf', '{CH}', dd || '/' || doc || '/' || h || '.pdf',
    '{DOCS}', doc_s, '{DOC}', doc, '{DD}', dd, '{DS}', ds, '{PIECES}', piece_s, '{PIECEC}', piece_c, '{PIECE}', piece,
    '{CHEF}', chef, '{CLIENT}', client, '{INCONNU}', inconnu, '{H}', h);
  verdicts jsonb := '[]'::jsonb;
  mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.documents_cabinet') is null then
    perform set_config('essai.documents_cabinet', jsonb_build_array(jsonb_build_object('rang', 0,
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

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord, ce que le CLIENT pose ensuite, le profil — `chef`
    -- (super-administrateur), `chef_simple` (le compte client rattaché au cabinet, le temps de l'étape), `client`, `inconnu`
    -- (un compte connecté sans aucun accès), `service` (le rôle des Edge Functions) ou `anon` —, sa requête, le code attendu
    -- (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}. Une mutation rejoue une étape après son instruction.
    for e in
      with etapes (rang, etape, pose, pose_client, profil, requete, code, attendu) as (values
        (1, '1. le chef publie la 2035 de DD : sa nature, son poids et son type lus du stockage, à lui', '{DEP}', null, 'chef',
          $q$select d.nature || ' ' || d.taille || ' ' || d.type_mime || ' ' || d.sha256 || ' ' || (d.publie_par::text = '{CHEF}') from publier_document_du_cabinet('{DD}', '{DOC}', '2035 de 2025', '2035', 2025, 'la 2035.pdf', '{CH}') d$q$,
          'OK', '2035 1000 application/pdf {H} true'),
        (2, '2. le client « Documents » lit le document de son dossier, et son fichier (le contrôle positif)', '{DEP}; {PUB}', null, 'client',
          $q$select (select count(*) from documents_cabinet where dossier_id = '{DD}') || ' ' || (select count(*) from storage.objects where bucket_id = 'documents-cabinet' and name = '{CH}')$q$, 'OK', '1 1'),
        (3, '3. le client sans la case ne lit ni le document de DS ni son fichier', '{DEPS}; {PUBS}', null, 'client',
          $q$select (select count(*) from documents_cabinet where dossier_id = '{DS}') || ' ' || (select count(*) from storage.objects where bucket_id = 'documents-cabinet' and name = '{CHS}')$q$, 'OK', '0 0'),
        (4, '4. un fichier déposé et pas publié : le client « Documents » ne le lit pas', '{DEP}', null, 'client',
          $q$select count(*)::text from storage.objects where bucket_id = 'documents-cabinet' and name = '{CH}'$q$, 'OK', '0'),
        (5, '5. retiré : le client ne lit plus ni le document ni son fichier', '{DEP}; {PUB}; select 1 from retirer_document_du_cabinet(''{DOC}'')', null, 'client',
          $q$select (select count(*) from documents_cabinet where dossier_id = '{DD}') || ' ' || (select count(*) from storage.objects where bucket_id = 'documents-cabinet' and name = '{CH}')$q$, 'OK', '0 0'),
        (6, '6. le cabinet lit le document retiré et son fichier ; le retrait est à lui', '{DEP}; {PUB}', null, 'chef_simple',
          $q$select (r.retire_par::text = '{CLIENT}') || ' ' || (select count(*) from storage.objects where bucket_id = 'documents-cabinet' and name = '{CH}') || ' ' || (select count(*) from documents_cabinet where dossier_id = '{DD}') from retirer_document_du_cabinet('{DOC}') r$q$, 'OK', 'true 1 1'),
        (7, '7. le client accuse la lecture deux fois : une ligne, la première, à lui', '{DEP}; {PUB}', 'select 1 from marquer_document_lu(''{DOC}''); select 1 from marquer_document_lu(''{DOC}'')', 'client',
          $q$select count(*) || ' ' || bool_and(l.lecteur::text = '{CLIENT}') from lectures_documents l where l.document_id = '{DOC}'$q$, 'OK', '1 true'),
        (8, '8. le cabinet lit qui a lu, et quand', '{DEP}; {PUB}', 'select 1 from marquer_document_lu(''{DOC}'')', 'chef_simple',
          $q$select count(*)::text from lectures_documents l where l.dossier_id = '{DD}' and l.lecteur::text = '{CLIENT}'$q$, 'OK', '1'),
        (9, '9. le client ne lit que ses lectures : celle d''un autre compte, réinsérée par la restauration, lui reste cachée', '{DEP}; {PUB}; insert into lectures_documents (dossier_id, document_id, lecteur) values (''{DD}'', ''{DOC}'', ''{INCONNU}'')', null, 'client',
          $q$select count(*)::text from lectures_documents l where l.document_id = '{DOC}'$q$, 'OK', '0'),
        (10, '10. le client sans la case n''accuse pas un document de DS (42501)', '{DEPS}; {PUBS}', null, 'client',
          $q$select 1 from marquer_document_lu('{DOCS}')$q$, '42501', 'Accès refusé à ce document.'),
        (11, '11. le client n''accuse pas un document retiré (42501, les mêmes mots)', '{DEP}; {PUB}; select 1 from retirer_document_du_cabinet(''{DOC}'')', null, 'client',
          $q$select 1 from marquer_document_lu('{DOC}')$q$, '42501', 'Accès refusé à ce document.'),
        (12, '12. le cabinet n''accuse pas : la preuve est celle du client (42501)', '{DEP}; {PUB}', null, 'chef',
          $q$select 1 from marquer_document_lu('{DOC}')$q$, '42501', 'Accès refusé à ce document.'),
        (13, '13. le client ne publie pas, même « Documents » (42501)', '{DEP}', null, 'client',
          $q$select 1 from publier_document_du_cabinet('{DD}', '{DOC}', '2035 de 2025', '2035', 2025, 'la 2035.pdf', '{CH}')$q$, '42501', 'Accès refusé à ce dossier.'),
        (14, '14. le client ne retire pas (42501)', '{DEP}; {PUB}', null, 'client',
          $q$select 1 from retirer_document_du_cabinet('{DOC}')$q$, '42501', 'Accès refusé à ce document.'),
        (15, '15. le client n''écrit pas un document en direct (la garde, avant la RLS)', '{DEP}', null, 'client',
          $q$insert into documents_cabinet (id, dossier_id, titre, nature, chemin, nom_fichier, sha256, taille, type_mime, publie_par) values ('{DOC}', '{DD}', 't', '2035', '{CH}', 'n', '{H}', 1, 'application/pdf', '{CLIENT}') returning 1$q$,
          '42501', 'Un document ne se met à disposition que par sa publication.'),
        (16, '16. un chef qui n''est pas super-administrateur n''écrit pas en direct non plus', '{DEP}', null, 'chef_simple',
          $q$insert into documents_cabinet (id, dossier_id, titre, nature, chemin, nom_fichier, sha256, taille, type_mime, publie_par) values ('{DOC}', '{DD}', 't', '2035', '{CH}', 'n', '{H}', 1, 'application/pdf', '{CLIENT}') returning 1$q$,
          '42501', 'Un document ne se met à disposition que par sa publication.'),
        (17, '17. le rôle des Edge Functions, qui passe la RLS, ne réécrit pas un document (la garde)', '{DEP}; {PUB}', null, 'service',
          $q$update documents_cabinet set titre = 'autre' where dossier_id = '{DD}' returning 1$q$, '23514', 'Un document mis à disposition ne se modifie pas : il se retire, une fois, et l''historique reste.'),
        (18, '18. un titre vide (22023)', '{DEP}', null, 'chef',
          $q$select 1 from publier_document_du_cabinet('{DD}', '{DOC}', '  ', '2035', 2025, 'la 2035.pdf', '{CH}')$q$, '22023', 'Le titre d''un document est un texte de deux cents caractères au plus, qui ne soit pas vide.'),
        (19, '19. une nature inconnue (22023)', '{DEP}', null, 'chef',
          $q$select 1 from publier_document_du_cabinet('{DD}', '{DOC}', '2035 de 2025', 'bilan', 2025, 'la 2035.pdf', '{CH}')$q$, '22023', 'La nature d''un document est la 2035, la liasse, les comptes annuels, une attestation, la lettre de mission, un courrier, ou autre chose.'),
        (20, '20. un exercice hors des années admises (22023)', '{DEP}', null, 'chef',
          $q$select 1 from publier_document_du_cabinet('{DD}', '{DOC}', '2035 de 2025', '2035', 1999, 'la 2035.pdf', '{CH}')$q$, '22023', 'L''exercice d''un document est une année entre 2000 et 2100, ou rien.'),
        (21, '21. un nom de fichier vide (22023)', '{DEP}', null, 'chef',
          $q$select 1 from publier_document_du_cabinet('{DD}', '{DOC}', '2035 de 2025', '2035', 2025, '', '{CH}')$q$, '22023', 'Le nom d''un fichier est un texte de deux cents caractères au plus, qui ne soit pas vide.'),
        (22, '22. un chemin qui porte le nom du fichier (22023)', '{DEP}', null, 'chef',
          $q$select 1 from publier_document_du_cabinet('{DD}', '{DOC}', '2035 de 2025', '2035', 2025, 'la 2035.pdf', '{DD}/{DOC}/la-2035.pdf')$q$, '22023', 'CHEMIN'),
        (23, '23. le chemin d''un autre dossier (22023)', '{DEPS}', null, 'chef',
          $q$select 1 from publier_document_du_cabinet('{DD}', '{DOCS}', '2035 de 2025', '2035', 2025, 'la 2035.pdf', '{CHS}')$q$, '22023', 'CHEMIN'),
        (24, '24. un document déjà publié sous cet identifiant (22023)', '{DEP}; {PUB}', null, 'chef',
          $q$select 1 from publier_document_du_cabinet('{DD}', '{DOC}', '2035 de 2025', '2035', 2025, 'la 2035.pdf', '{CH}')$q$, '22023', 'Ce document est déjà publié.'),
        (25, '25. le fichier absent du seau (22023)', null, null, 'chef',
          $q$select 1 from publier_document_du_cabinet('{DD}', '{DOC}', '2035 de 2025', '2035', 2025, 'la 2035.pdf', '{CH}')$q$, '22023', 'Le fichier de ce document n''est pas dans le stockage : le déposer d''abord.'),
        (26, '26. un fichier d''un autre type que son extension (22023)', $q$insert into storage.objects (bucket_id, name, metadata) values ('documents-cabinet', '{CH}', '{"size": 1000, "mimetype": "image/png"}'::jsonb)$q$, null, 'chef',
          $q$select 1 from publier_document_du_cabinet('{DD}', '{DOC}', '2035 de 2025', '2035', 2025, 'la 2035.pdf', '{CH}')$q$, '22023', 'Le fichier déposé n''est pas du type que dit son extension, ou dépasse la borne du seau.'),
        (27, '27. un fichier au-delà de la borne du seau, d''un octet (22023)', $q$insert into storage.objects (bucket_id, name, metadata) values ('documents-cabinet', '{CH}', '{"size": 20971521, "mimetype": "application/pdf"}'::jsonb)$q$, null, 'chef',
          $q$select 1 from publier_document_du_cabinet('{DD}', '{DOC}', '2035 de 2025', '2035', 2025, 'la 2035.pdf', '{CH}')$q$, '22023', 'Le fichier déposé n''est pas du type que dit son extension, ou dépasse la borne du seau.'),
        (28, '28. retirer un document déjà retiré (22023)', '{DEP}; {PUB}; select 1 from retirer_document_du_cabinet(''{DOC}'')', null, 'chef',
          $q$select 1 from retirer_document_du_cabinet('{DOC}')$q$, '22023', 'Ce document est déjà retiré.'),
        (29, '29. le client « Documents » ne dépose pas dans le seau (la policy de dépôt)', null, null, 'client',
          $q$insert into storage.objects (bucket_id, name, metadata) values ('documents-cabinet', '{CH}', '{"size": 1000, "mimetype": "application/pdf"}'::jsonb) returning 1$q$,
          '42501', 'new row violates row-level security policy for table "objects"'),
        (30, '30. le cabinet ne dépose pas sous un chemin qui porte un nom de fichier', null, null, 'chef_simple',
          $q$insert into storage.objects (bucket_id, name, metadata) values ('documents-cabinet', '{DD}/{DOC}/la-2035.pdf', '{"size": 1000, "mimetype": "application/pdf"}'::jsonb) returning 1$q$,
          '42501', 'new row violates row-level security policy for table "objects"'),
        (31, '31. le cabinet dépose sous la forme exacte du chemin', null, null, 'chef_simple',
          $q$insert into storage.objects (bucket_id, name, metadata) values ('documents-cabinet', '{CH}', '{"size": 1000, "mimetype": "application/pdf"}'::jsonb) returning 1$q$, 'OK', '1'),
        (32, '32. document_du_cabinet_publie : vrai au client « Documents », faux une fois retiré, faux au client sans la case, vrai au cabinet', '{DEP}; {PUB}; {DEPS}; {PUBS}', null, 'client',
          $q$select document_du_cabinet_publie('{CH}') || ' ' || document_du_cabinet_publie('{CHS}')$q$, 'OK', 'true false'),
        (33, '33. … faux à un compte connecté sans accès au dossier', '{DEP}; {PUB}', null, 'inconnu',
          $q$select document_du_cabinet_publie('{CH}')::text$q$, 'OK', 'false'),
        (34, '34. … vrai au cabinet, faux une fois le document retiré', '{DEP}; {PUB}; {DEPS}; {PUBS}; select 1 from retirer_document_du_cabinet(''{DOCS}'')', null, 'chef_simple',
          $q$select document_du_cabinet_publie('{CH}') || ' ' || document_du_cabinet_publie('{CHS}')$q$, 'OK', 'true false'),
        (40, '40. le chef ouvre une demande : à lui, ce qu''elle attend', null, null, 'chef_simple',
          $q$select d.attendu || ' ' || (d.auteur::text = '{CLIENT}') || ' ' || coalesce(d.echeance::text, '-') from ouvrir_demande('{DD}', 'Le relevé de décembre', 'Le relevé de décembre 2025, en PDF.', (now() at time zone 'Europe/Paris')::date, 'fichier') d$q$,
          'OK', 'fichier true ' || (now() at time zone 'Europe/Paris')::date),
        (41, '41. tout accès lit les demandes de son dossier, même sans « Documents » (DS)', 'select 1 from ouvrir_demande(''{DS}'', ''Les statuts'', null, null, ''fichier'')', null, 'client',
          $q$select count(*)::text from demandes_cabinet where dossier_id = '{DS}'$q$, 'OK', '1'),
        (42, '42. le client n''ouvre pas de demande (42501)', null, null, 'client',
          $q$select 1 from ouvrir_demande('{DD}', 'x', null, null, 'fichier')$q$, '42501', 'Accès refusé à ce dossier.'),
        (43, '43. un objet vide (22023)', null, null, 'chef',
          $q$select 1 from ouvrir_demande('{DD}', '', null, null, 'fichier')$q$, '22023', 'L''objet d''une demande est un texte de deux cents caractères au plus, qui ne soit pas vide.'),
        (44, '44. un détail vide (22023)', null, null, 'chef',
          $q$select 1 from ouvrir_demande('{DD}', 'Le relevé', ' ', null, 'fichier')$q$, '22023', 'Le détail d''une demande est un texte de quatre mille caractères au plus, qui ne soit pas vide, ou rien.'),
        (45, '45. ce qui est attendu, inconnu (22023)', null, null, 'chef',
          $q$select 1 from ouvrir_demande('{DD}', 'Le relevé', null, null, 'rien')$q$, '22023', 'Une demande attend un fichier, une réponse, ou les deux.'),
        (46, '46. une échéance passée, au jour de Paris (22023)', null, null, 'chef',
          $q$select 1 from ouvrir_demande('{DD}', 'Le relevé', null, (now() at time zone 'Europe/Paris')::date - 1, 'fichier')$q$, '22023', 'L''échéance d''une demande ne se fixe pas dans le passé.'),
        (47, '47. le client répond par un texte : à lui, sans fichier', '{OUV}', null, 'client',
          $q$select coalesce(r.fichier, '-') || ' ' || (r.auteur::text = '{CLIENT}') from repondre_a_la_demande({DEM}, 'Je le cherche.', null, null) r$q$, 'OK', '- true'),
        (48, '48. le client répond par la pièce qu''il vient de déposer : sa nature et son empreinte recopiées', '{OUV}', '{DEPC}', 'client',
          $q$select r.fichier || ' ' || r.fichier_sha256 || ' ' || (r.piece_id::text = '{PIECE}') from repondre_a_la_demande({DEM}, null, '{PIECE}', null) r$q$, 'OK', 'piece {H} true'),
        (49, '49. le cabinet lit la réponse ; tout accès du dossier aussi', '{OUV}', 'select 1 from repondre_a_la_demande({DEM}, ''Voilà.'', null, null)', 'chef_simple',
          $q$select count(*)::text from demandes_reponses where dossier_id = '{DD}'$q$, 'OK', '1'),
        (50, '50. rien à répondre (22023)', '{OUV}', null, 'client',
          $q$select 1 from repondre_a_la_demande({DEM}, null, null, null)$q$, '22023', 'Une réponse porte un texte, un fichier, ou les deux.'),
        (51, '51. un texte vide (22023)', '{OUV}', null, 'client',
          $q$select 1 from repondre_a_la_demande({DEM}, '   ', null, null)$q$, '22023', 'Le texte d''une réponse est un texte de quatre mille caractères au plus, qui ne soit pas vide.'),
        (52, '52. une pièce et un document (22023)', '{OUV}', '{DEPC}', 'client',
          $q$select 1 from repondre_a_la_demande({DEM}, null, '{PIECE}', gen_random_uuid())$q$, '22023', 'Une réponse joint une pièce ou un document, pas les deux.'),
        (53, '53. une demande close (22023)', '{OUV}; select 1 from clore_demande({DEM}, ''sans_objet'')', null, 'client',
          $q$select 1 from repondre_a_la_demande({DEM}, 'Trop tard ?', null, null)$q$, '22023', 'Cette demande est close : ton cabinet n''attend plus de réponse.'),
        (54, '54. la pièce d''un autre, déposée par le cabinet (22023)', '{OUV}; {DEPCAB}', null, 'client',
          $q$select 1 from repondre_a_la_demande({DEM}, null, '{PIECEC}', null)$q$, '22023', 'Ce fichier n''est pas un dépôt que tu as fait pour cette demande.'),
        (55, '55. la pièce qu''une réponse cite déjà (22023)', '{OUV}', '{DEPC}; select 1 from repondre_a_la_demande({DEM}, null, ''{PIECE}'', null)', 'client',
          $q$select 1 from repondre_a_la_demande({DEM}, 'Encore', '{PIECE}', null)$q$, '22023', 'Ce fichier n''est pas un dépôt que tu as fait pour cette demande.'),
        (56, '56. la pièce d''un autre dossier (DS) (22023)', '{OUV}', '{DEPCS}', 'client',
          $q$select 1 from repondre_a_la_demande({DEM}, null, '{PIECES}', null)$q$, '22023', 'Ce fichier n''est pas un dépôt que tu as fait pour cette demande.'),
        (57, '57. un compte connecté sans accès ne répond pas (42501)', '{OUV}', null, 'inconnu',
          $q$select 1 from repondre_a_la_demande({DEM}, 'Bonjour', null, null)$q$, '42501', 'Accès refusé à cette demande.'),
        (58, '58. le rôle des Edge Functions ne réécrit pas une réponse (la garde)', '{OUV}', 'select 1 from repondre_a_la_demande({DEM}, ''Voilà.'', null, null)', 'service',
          $q$update demandes_reponses set texte = 'autre' where dossier_id = '{DD}' returning 1$q$, '23514', 'Une réponse ne se réécrit pas : seul le lien vers un dépôt retiré du dossier se défait, et ce qu''elle a joint reste dit.'),
        (59, '59. le client n''écrit pas une réponse en direct (la garde)', '{OUV}', null, 'client',
          $q$insert into demandes_reponses (dossier_id, demande_id, auteur, texte) values ('{DD}', {DEM}, '{CLIENT}', 'x') returning 1$q$, '42501', 'Une réponse ne s''écrit que par sa fonction.'),
        (60, '60. le chef relance à l''écran ; le client lit la relance', '{OUV}; select 1 from relancer_demande({DEM})', null, 'client',
          $q$select string_agg(r.canal, ',') from relances_demandes r where r.dossier_id = '{DD}'$q$, 'OK', 'ecran'),
        (61, '61. le client ne relance pas (42501)', '{OUV}', null, 'client',
          $q$select 1 from relancer_demande({DEM})$q$, '42501', 'Accès refusé à cette demande.'),
        (62, '62. une demande close ne se relance plus (22023)', '{OUV}; select 1 from clore_demande({DEM}, ''satisfaite'')', null, 'chef',
          $q$select 1 from relancer_demande({DEM})$q$, '22023', 'Cette demande est close : elle ne se relance plus.'),
        (63, '63. le client n''écrit pas une relance en direct (la garde)', '{OUV}', null, 'client',
          $q$insert into relances_demandes (dossier_id, demande_id, canal, relancee_par) values ('{DD}', {DEM}, 'ecran', '{CLIENT}') returning 1$q$, '42501', 'Une relance ne s''écrit que par sa fonction.'),
        (64, '64. le chef clôt la demande, satisfaite ; le client lit la clôture', '{OUV}; select 1 from clore_demande({DEM}, ''satisfaite'')', null, 'client',
          $q$select d.motif_de_cloture || ' ' || (d.close_par::text = '{CHEF}') from demandes_cabinet d where d.dossier_id = '{DD}'$q$, 'OK', 'satisfaite true'),
        (65, '65. un motif de clôture inconnu (22023)', '{OUV}', null, 'chef',
          $q$select 1 from clore_demande({DEM}, 'parce que')$q$, '22023', 'Une demande se clôt satisfaite, sans objet, ou remplacée par une autre.'),
        (66, '66. une demande déjà close (22023)', '{OUV}; select 1 from clore_demande({DEM}, ''sans_objet'')', null, 'chef',
          $q$select 1 from clore_demande({DEM}, 'satisfaite')$q$, '22023', 'Cette demande est déjà close.'),
        (67, '67. le client ne clôt pas (42501)', '{OUV}', null, 'client',
          $q$select 1 from clore_demande({DEM}, 'satisfaite')$q$, '42501', 'Accès refusé à cette demande.'),
        (68, '68. le rôle des Edge Functions ne réécrit pas une demande (la garde)', '{OUV}', null, 'service',
          $q$update demandes_cabinet set objet = 'autre' where dossier_id = '{DD}' returning 1$q$, '23514', 'Une demande ne se modifie pas : elle se clôt, une fois, et l''historique reste.'),
        (69, '69. le client n''écrit pas une demande en direct (la garde)', null, null, 'client',
          $q$insert into demandes_cabinet (dossier_id, objet, attendu, auteur) values ('{DD}', 'x', 'fichier', '{CLIENT}') returning 1$q$, '42501', 'Une demande ne s''écrit que par son ouverture.'),
        (70, '70. le client n''écrit pas une lecture en direct (la garde)', '{DEP}; {PUB}', null, 'client',
          $q$insert into lectures_documents (dossier_id, document_id, lecteur) values ('{DD}', '{DOC}', '{CLIENT}') returning 1$q$, '42501', 'La lecture d''un document ne s''écrit que par son accusé, à l''ouverture.'),
        (71, '71. le super-administrateur ne réécrit rien : aucune policy de mise à jour, aucune ligne touchée', '{DEP}; {PUB}; {OUV}', null, 'chef',
          $q$with t as (update documents_cabinet set titre = 'autre' where dossier_id = '{DD}' returning 1), u as (update demandes_cabinet set objet = 'autre' where dossier_id = '{DD}' returning 1) select (select count(*) from t) || ' ' || (select count(*) from u)$q$, 'OK', '0 0'),
        (72, '72. l''anonyme ne lit rien et n''exécute aucune fonction', '{DEP}; {PUB}; {OUV}', null, 'anon',
          $q$select (select count(*) from documents_cabinet) + (select count(*) from demandes_cabinet) + (select count(*) from storage.objects where bucket_id = 'documents-cabinet') || ' ' || has_function_privilege('anon', 'public.publier_document_du_cabinet(uuid, uuid, text, text, integer, text, text)', 'execute') || ' ' || has_function_privilege('anon', 'public.repondre_a_la_demande(uuid, text, uuid, uuid)', 'execute')$q$, 'OK', '0 false false'),
        (73, '73. un compte connecté sans accès ne lit rien', '{DEP}; {PUB}; {OUV}; select 1 from relancer_demande({DEM})', null, 'inconnu',
          $q$select (select count(*) from documents_cabinet) + (select count(*) from demandes_cabinet) + (select count(*) from relances_demandes) + (select count(*) from storage.objects where bucket_id = 'documents-cabinet')$q$, 'OK', '0')
      ),
      mutations (m, libelle, ddl, rang) as (values
        ('M1', 'M1 — la lecture du client ne regarde plus le retrait', $m$alter policy documents_cabinet_lecture_documents on public.documents_cabinet using (client_du_dossier(dossier_id, 'documents'))$m$, 5),
        ('M2', 'M2 — la lecture du seau ouverte à tout fichier du dossier pour l''accès « Documents »', $m$alter policy documents_cabinet_storage_lecture on storage.objects using (bucket_id = 'documents-cabinet' and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then public.admin_du_dossier(((storage.foldername(name))[1])::uuid) or public.client_du_dossier(((storage.foldername(name))[1])::uuid, 'documents') else false end)$m$, 4),
        ('M3', 'M3 — la lecture des documents passée à « membre »', $m$alter policy documents_cabinet_lecture_documents on public.documents_cabinet using (client_du_dossier(dossier_id, 'membre') and retire_le is null)$m$, 3),
        ('M4', 'M4 — l''accusé sans la case « Documents »', $m$FONCTION:marquer_document_lu(uuid):or not public.client_du_dossier(v_document.dossier_id, 'documents'):or not public.client_du_dossier(v_document.dossier_id, 'membre')$m$, 10),
        ('M5', 'M5 — la réponse sans l''auteur du dépôt', $m$FONCTION:repondre_a_la_demande(uuid,text,uuid,uuid):and p.uploaded_by = auth.uid():$m$, 54),
        ('M6', 'M6 — le dépôt dans le seau ouvert à tout accès du dossier', $m$alter policy documents_cabinet_storage_depot on storage.objects with check (bucket_id = 'documents-cabinet' and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then public.admin_du_dossier(((storage.foldername(name))[1])::uuid) or public.client_du_dossier(((storage.foldername(name))[1])::uuid, 'membre') else false end)$m$, 29),
        ('M7', 'M7 — la clôture sans le cabinet du dossier', $m$FONCTION:clore_demande(uuid,text):or not public.admin_du_dossier(v_demande.dossier_id):$m$, 67),
        ('M8', 'M8 — la garde des demandes laisse tout réécrire', $m$FONCTION:garder_demande_du_cabinet():if tg_op = 'UPDATE' then:if tg_op = 'UPDATE' then return new; end if; if false then$m$, 68)
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

    -- Le catalogue : la RLS des cinq tables, trois policies chacune à authenticated (hors la restrictive `deux_facteurs`),
    -- les gardes, les fonctions, le seau privé et ses bornes, ses trois policies — la suppression au chef du cabinet du
    -- dossier (une suppression SQL du stockage est refusée par la plateforme : elle se lit au catalogue, RGPD.md §8.6).
    verdicts := verdicts || jsonb_build_object('rang', 90, 'etape', '90. le catalogue : la RLS des cinq tables, quinze policies à authenticated, aucune de mise à jour ni de suppression',
      'ok', (select count(*) from pg_class c where c.oid in ('public.documents_cabinet'::regclass, 'public.lectures_documents'::regclass,
               'public.demandes_cabinet'::regclass, 'public.demandes_reponses'::regclass, 'public.relances_demandes'::regclass) and c.relrowsecurity) = 5
        and (select count(*) from pg_policies p where p.schemaname = 'public'
               and p.tablename in ('documents_cabinet', 'lectures_documents', 'demandes_cabinet', 'demandes_reponses', 'relances_demandes')
               and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 15
        and (select count(*) from pg_policies p where p.schemaname = 'public'
               and p.tablename in ('documents_cabinet', 'lectures_documents', 'demandes_cabinet', 'demandes_reponses', 'relances_demandes')
               and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')
               and (p.roles <> array['authenticated']::name[] or p.cmd not in ('SELECT', 'INSERT')
                    or (p.cmd = 'INSERT' and p.with_check <> 'is_super_admin()'))) = 0,
      'observe', 'relu au catalogue');
    verdicts := verdicts || jsonb_build_object('rang', 91, 'etape', '91. les lectures du client : « Documents » pour les documents publiés et ses lectures, « membre » pour les demandes, leurs réponses et leurs relances',
      'ok', (select count(*) from pg_policies p where p.schemaname = 'public' and (
               (p.policyname = 'documents_cabinet_lecture_documents' and p.qual = '(client_du_dossier(dossier_id, ''documents''::text) AND (retire_le IS NULL))')
            or (p.policyname = 'lectures_documents_lecture_du_lecteur' and p.qual = '((lecteur = ( SELECT auth.uid() AS uid)) AND client_du_dossier(dossier_id, ''documents''::text))')
            or (p.policyname in ('demandes_cabinet_lecture_membre', 'demandes_reponses_lecture_membre', 'relances_demandes_lecture_membre')
                and p.qual = 'client_du_dossier(dossier_id, ''membre''::text)'))) = 5,
      'observe', 'relu au catalogue');
    verdicts := verdicts || jsonb_build_object('rang', 92, 'etape', '92. le seau : privé, 20 Mio, PDF, JPEG et PNG ; trois policies à authenticated ; la suppression au chef du cabinet du dossier ; aucune mise à jour',
      'ok', exists (select 1 from storage.buckets b where b.id = 'documents-cabinet' and not b.public and b.file_size_limit = 20971520
                     and b.allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'])
        and (select count(*) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
               and p.policyname like 'documents\_cabinet\_storage\_%' and p.roles = array['authenticated']::name[]) = 3
        and exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname = 'documents_cabinet_storage_suppression'
                     and p.polcmd = 'd' and pg_get_expr(p.polqual, p.polrelid) like '%est_chef_du_cabinet(d.cabinet_id)%'
                     and pg_get_expr(p.polqual, p.polrelid) like '%''documents-cabinet''%')
        and not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polpermissive
                         and p.polcmd in ('w', '*') and coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%documents-cabinet%'),
      'observe', 'relu au catalogue');
    verdicts := verdicts || jsonb_build_object('rang', 93, 'etape', '93. les huit fonctions à authenticated, ni à l''anonyme ; les cinq gardes à personne',
      'ok', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
               and p.proname in ('publier_document_du_cabinet', 'retirer_document_du_cabinet', 'marquer_document_lu', 'ouvrir_demande',
                                 'clore_demande', 'relancer_demande', 'repondre_a_la_demande', 'document_du_cabinet_publie')
               and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) = 8
        and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('garder_document_du_cabinet', 'garder_lecture_document', 'garder_demande_du_cabinet',
                                 'garder_reponse_a_une_demande', 'garder_relance_demande')
               and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) = 5,
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leurs documents, demandes et fichiers, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (dd::uuid, ds::uuid))
      and not exists (select 1 from memberships where id in (acces_d::uuid, acces_s::uuid))
      and not exists (select 1 from documents_cabinet where dossier_id in (dd::uuid, ds::uuid))
      and not exists (select 1 from demandes_cabinet where dossier_id in (dd::uuid, ds::uuid))
      and not exists (select 1 from storage.objects where bucket_id = 'documents-cabinet' and split_part(name, '/', 1) in (dd, ds))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.documents_cabinet', (verdicts || mutations)::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.documents_cabinet')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
