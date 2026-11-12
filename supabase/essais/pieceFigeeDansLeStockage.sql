-- LE FICHIER D'UNE PIÈCE FIGÉE, ET D'UNE SOURCE CITÉE PAR LA RÉVISION, NE SE SUPPRIME PLUS DU STOCKAGE (ligne 44, INAL1 ;
-- migration `piece_figee_dans_le_stockage`, PRÉPARÉE) — SUR UNE RÉPLIQUE SEULEMENT, par psql, en UNE transaction
-- (`psql -1`) : ce fichier porte des SUPPRESSIONS de lignes de `storage.objects` et des mutations du schéma, qu'on ne joue
-- pas sur la base du cabinet ; il ne laisse rien. La lecture du catalogue et le jugement du prédicat sans suppression se
-- rejouent par le bloc PF de `rls.sql`, en production aussi. Le récit : HISTORIQUE.md, « 10/11/2026 — INAL1 ET INAL2 ».
--
-- POURQUOI LE RÉGLAGE DE L'API. Le stockage refuse toute suppression SQL directe de `storage.objects`
-- (`protect_objects_delete` → `storage.protect_delete`, 42501, le code même d'un refus de policy) : un essai de suppression
-- passerait au vert avec une policy grande ouverte (RGPD.md §8.6). L'API du stockage supprime sous la session de
-- l'appelant, le réglage `storage.allow_delete_query` posé, en nommant ses lignes et en les rendant : la policy de LECTURE
-- et celle de SUPPRESSION décident alors seules, et une ligne qu'elles écartent n'est simplement pas supprimée. C'est ce
-- que cet essai rejoue : le NOMBRE de lignes supprimées dit si la policy l'admet. Ce qu'il ne prouve pas : que l'API pose
-- ce réglage comme ici (essai manuel, RGPD.md §8.6), ni rien du fichier lui-même, que seule l'API retire.
--
-- CE QUI SE PROUVE, par impersonation, dans un dossier jetable A du cabinet du chef (et B, et R) :
--   1 à 8. Le super-administrateur lui-même ne supprime plus : le fichier d'une pièce qu'une écriture validée cite, sa
--          version lisible, le fichier d'une pièce que cite le bien immobilisé qu'une dotation validée amortit, d'une pièce
--          citée par une preuve de la révision ou par le dossier permanent, d'un document cité par l'une ou par l'autre, et
--          le fichier que désigne une pièce figée d'un AUTRE dossier (B) ;
--   9 à 11. Il supprime (contrôles POSITIFS) le fichier d'une pièce libre — une écriture seulement proposée la cite —, d'un
--          document libre, et un fichier qu'aucune ligne ne désigne ;
--   12 à 17. Le chef du cabinet du dossier (non super-administrateur) et un membre affecté : ni le figé, mais le libre ; un
--          membre non affecté, le chef d'un autre cabinet, le client du dossier, un compte rattaché à rien, l'anonyme :
--          rien ;
--   18. Un lot qui vise tout le préfixe du dossier, comme l'application : seuls les trois fichiers libres partent ;
--   19. La suppression d'un dossier comme l'application la fait (src/lib/suppressionDossier.ts), par le
--       super-administrateur : un premier passage (les libres), la ligne du dossier, un second passage (les fichiers que
--       plus aucune ligne ne fige) — ne reste que le fichier qu'une pièce figée de B désigne ;
--   20. La même par le chef du cabinet non super-administrateur : après la ligne, il ne voit plus les fichiers du dossier —
--       les huit fichiers figés restent (la LIMITE, que le bilan de la suppression compte ; INAL12-Q1) ;
--   21. Sans le réglage de l'API, le stockage refuse à tous ;
--   22. Le dépôt reste ouvert ;
--   23. La restauration reste ouverte : le super-administrateur réinsère, dans un dossier sans exercice validé, un fichier,
--       sa pièce et une écriture validée qui la cite — puis ce fichier-là ne se supprime plus ;
--   24 à 26. `fichier_fige` répond vrai au chef, faux pour un fichier libre, NUL à qui n'administre pas le dossier et pour un
--          chemin qui ne commence pas par un dossier (sans rien lever).
-- MUTATIONS, chacune doit MORDRE : M1, la policy d'hier ; M2 à M6 et M9, la fonction sans le bien, sans la version lisible,
-- sans les preuves, sans les documents, bornée au dossier du chemin, sans le dossier permanent ; M7, la fonction qui répond à
-- tous ; M8, la fonction qui ne fige rien. Chacune altère la fonction réelle (sa définition lue au catalogue, un fragment
-- remplacé ; un fragment introuvable fait tomber la mutation), dans la sous-transaction de son étape.
--
-- Le moteur est celui de `logoDesFacturesSuppression.sql`, plus un PRÉLUDE par étape, joué en propriétaire avant
-- l'impersonation (une mutation). Profils : `chef` (le super-administrateur, chef du cabinet des dossiers) ;
-- `chef_du_cabinet`, `membre`, `membre_affecte`, `chef_autre` (le compte du client, rangé ainsi le temps de son étape) ;
-- `client` (son accès au dossier A) ; `inconnu` ; `anon`.
--
-- La garde de tête : une réplique seulement (le rôle `proprietaire`, absent de la production), avant toute écriture.
do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  cabinet uuid;
  ids jsonb;
  avant text; apres text;
  s record; k text; ordre text; prelude text; partie text; attendu text; rendu text; accepte boolean; code_recu text;
  message text; ok boolean;
  erreur text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des lignes et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regprocedure('public.fichier_fige(text)') is null then
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration piece_figee_dans_le_stockage n''est pas en base',
      'genre', 'controle', 'observe', 'fichier_fige absente', 'ok', true);
    perform set_config('essai.piece_figee_dans_le_stockage', verdicts::text, true);
    return;
  end if;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;

  -- Une mutation altère la fonction réelle : sa définition lue au catalogue, un fragment remplacé. Introuvable, le
  -- fragment fait lever : la mutation tombe, au lieu de passer pour un contrôle qui mord.
  create function pg_temp.muter(p_de text, p_vers text) returns text language plpgsql as $m$
  declare
    d text := pg_get_functiondef('public.fichier_fige(text)'::regprocedure);
  begin
    if position(p_de in d) = 0 then
      raise exception 'MUTATION_SANS_PRISE : %', p_de;
    end if;
    execute replace(d, p_de, p_vers);
    return 'mutée';
  end
  $m$;
  -- La pièce croisée du jeu j3 ne se pose plus sous la contrainte de CFCS-Q1 : elle est retirée le temps de l'essai, que
  -- l'annulation finale rend (une instruction qui rend une ligne, comme toute partie d'une étape).
  create function pg_temp.sans_la_contrainte_des_chemins() returns text language plpgsql as $c$
  begin
    alter table public.pieces drop constraint if exists pieces_storage_path_dans_son_dossier;
    return 'retirée';
  end
  $c$;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'f19e0000-0000-4000-8000-0000000000a1', 'DB', 'f19e0000-0000-4000-8000-0000000000b1',
    'DR', 'f19e0000-0000-4000-8000-0000000000e1', 'CC', 'f19e0000-0000-4000-8000-0000000000cc',
    'ACCES', 'f19e0000-0000-4000-8000-0000000000ac',
    'PF', 'f19e0000-0000-4000-8000-000000000f01', 'PB', 'f19e0000-0000-4000-8000-000000000f02',
    'PL', 'f19e0000-0000-4000-8000-000000000f03', 'PC', 'f19e0000-0000-4000-8000-000000000f04',
    'PP', 'f19e0000-0000-4000-8000-000000000f05', 'PX', 'f19e0000-0000-4000-8000-000000000f06',
    'PR', 'f19e0000-0000-4000-8000-000000000f07',
    'DC', 'f19e0000-0000-4000-8000-000000000d01', 'DP', 'f19e0000-0000-4000-8000-000000000d02',
    'DL', 'f19e0000-0000-4000-8000-000000000d03', 'IB', 'f19e0000-0000-4000-8000-000000000b01');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from pieces)), ((select count(*) from documents_divers)),
    ((select count(*) from ecritures_brouillon)), ((select count(*) from immobilisations)),
    ((select count(*) from revision_preuves)), ((select count(*) from dossier_permanent)),
    ((select count(*) from storage.objects)), ((select count(*) from cabinets))
  ) as t(n);

  begin
    for s in select * from (values
      ('j1', 'jeu', 'dossiers jetables A, B et R, et un cabinet jetable C', 'proprietaire', null, null,
        $q$insert into dossiers (id, nom, cabinet_id) values ('{DA}', 'ESSAI INAL1 A', '{CAB}'), ('{DB}', 'ESSAI INAL1 B', '{CAB}'), ('{DR}', 'ESSAI INAL1 R', '{CAB}')
          §§ insert into cabinets (id, nom) values ('{CC}', 'ESSAI INAL1 C')$q$, 'OK', null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A', 'proprietaire', null, null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-inal1@exemple.invalid')$q$, 'OK', null),
      -- Depuis CFCS-Q1 (la migration chemin_dans_son_dossier), une pièce ne nomme plus le fichier d'un autre dossier : la
      -- pièce croisée de B ne se pose qu'en retirant la contrainte, le temps de l'essai (annulé avec lui). Le cas garde la
      -- preuve que fichier_fige ne se borne pas au dossier du chemin (M6), pour une ligne d'avant la contrainte.
      ('j3', 'jeu', 'les pièces et les documents de A (dont une version lisible), et la pièce de B qui désigne un fichier de A', 'proprietaire', null, null,
        $q$select pg_temp.sans_la_contrainte_des_chemins() §§ insert into pieces (id, dossier_id, storage_path, nom_fichier, lisible_path, storage_hash) values
            ('{PF}', '{DA}', '{DA}/fige.pdf', 'fige.pdf', '{DA}/fige-lisible.pdf', repeat('1', 64)),
            ('{PB}', '{DA}', '{DA}/bien.pdf', 'bien.pdf', null, repeat('2', 64)),
            ('{PL}', '{DA}', '{DA}/libre.pdf', 'libre.pdf', null, repeat('3', 64)),
            ('{PC}', '{DA}', '{DA}/citee.pdf', 'citee.pdf', null, repeat('4', 64)),
            ('{PP}', '{DA}', '{DA}/permanent.pdf', 'permanent.pdf', null, repeat('5', 64)),
            ('{PX}', '{DB}', '{DA}/croise.pdf', 'croise.pdf', null, repeat('6', 64))
          §§ insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie) values
            ('{DC}', '{DA}', '{DA}/doc-cite.pdf', 'doc-cite.pdf', 'autre'),
            ('{DP}', '{DA}', '{DA}/doc-permanent.pdf', 'doc-permanent.pdf', 'autre'),
            ('{DL}', '{DA}', '{DA}/doc-libre.pdf', 'doc-libre.pdf', 'autre')$q$, 'OK', null),
      ('j4', 'jeu', 'les onze fichiers de A dans le seau, dont un qu''aucune ligne ne désigne', 'proprietaire', null, null,
        $q$insert into storage.objects (bucket_id, name, metadata) select 'pieces', '{DA}/' || f, '{"size": 1000, "mimetype": "application/pdf"}'
            from unnest(array['fige.pdf', 'fige-lisible.pdf', 'bien.pdf', 'libre.pdf', 'citee.pdf', 'permanent.pdf', 'croise.pdf',
                              'doc-cite.pdf', 'doc-permanent.pdf', 'doc-libre.pdf', 'orphelin.pdf']) f$q$, 'OK', null),
      ('j5', 'jeu', 'le bien de A, que la pièce PB justifie', 'proprietaire', null, null,
        $q$insert into immobilisations (id, dossier_id, piece_id, libelle, valeur, date_acquisition, duree_annees) values ('{IB}', '{DA}', '{PB}', 'ESSAI INAL1 bien', 1500, '2025-01-15', 3)$q$, 'OK', null),
      ('j6', 'jeu', 'les écritures validées de A (un achat qui cite PF, une dotation du bien), une proposée qui cite PL ; une validée de B qui cite PX', 'proprietaire', null, null,
        $q$select set_config('jd.validation_exercice', '{DA}', true)
          §§ insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, piece_id, immobilisation_id, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values
            ('{DA}', '2025-03-10', '606100', 'ESSAI INAL1 achat', 100, 'debit', 'validee', '{PF}', null, now(), 'AC', 1, 'F1', '2025-03-10', 'Achats'),
            ('{DA}', '2025-03-10', '512000', 'ESSAI INAL1 achat', 100, 'credit', 'validee', '{PF}', null, now(), 'AC', 1, 'F1', '2025-03-10', 'Banque'),
            ('{DA}', '2025-12-31', '681100', 'ESSAI INAL1 dotation', 500, 'debit', 'validee', null, '{IB}', now(), 'OD', 1, 'DOT', '2025-12-31', 'Dotations'),
            ('{DA}', '2025-12-31', '281830', 'ESSAI INAL1 dotation', 500, 'credit', 'validee', null, '{IB}', now(), 'OD', 1, 'DOT', '2025-12-31', 'Amortissements')
          §§ select set_config('jd.validation_exercice', '{DB}', true)
          §§ insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, piece_id, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values
            ('{DB}', '2025-04-02', '606100', 'ESSAI INAL1 achat', 30, 'debit', 'validee', '{PX}', now(), 'AC', 1, 'F2', '2025-04-02', 'Achats'),
            ('{DB}', '2025-04-02', '512000', 'ESSAI INAL1 achat', 30, 'credit', 'validee', '{PX}', now(), 'AC', 1, 'F2', '2025-04-02', 'Banque')
          §§ select set_config('jd.validation_exercice', '', true)
          §§ insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, piece_id) values
            ('{DA}', '2025-05-05', '606100', 'ESSAI INAL1 libre', 10, 'debit', 'proposee', '{PL}')$q$, 'OK', null),
      ('j7', 'jeu', 'la révision de A, par ses fonctions : une preuve (la pièce PC et le document DC), le dossier permanent (PP, DP)', 'chef', null, null,
        $q$select justifier_solde('{DA}', 2025, '471000', 0, 'justifie', null, 'exercice', '[{"piece_id": "{PC}"}, {"document_id": "{DC}"}]'::jsonb, null, null, null)::text
          §§ select consigner_au_dossier_permanent('{DA}', 'bail', 'Bail', 'Texte.', '{"piece_id": "{PP}"}'::jsonb, null, null, null)::text
          §§ select consigner_au_dossier_permanent('{DA}', 'contrat', 'Contrat', 'Texte.', '{"document_id": "{DP}"}'::jsonb, null, null, null)::text$q$, 'OK', null),

      ('1', 'controle', 'le super-administrateur ne supprime pas le fichier d''une pièce qu''une écriture validée cite', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/fige.pdf' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('2', 'controle', 'ni sa version lisible', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/fige-lisible.pdf' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('3', 'controle', 'ni le fichier de la pièce d''un bien qu''une dotation validée amortit', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/bien.pdf' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('4', 'controle', 'ni celui d''une pièce citée par une preuve de la révision', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/citee.pdf' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('5', 'controle', 'ni celui d''une pièce citée par le dossier permanent', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/permanent.pdf' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('6', 'controle', 'ni celui d''un document cité par une preuve', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/doc-cite.pdf' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('7', 'controle', 'ni celui d''un document cité par le dossier permanent', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/doc-permanent.pdf' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('8', 'controle', 'ni le fichier de A que désigne une pièce figée de B', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/croise.pdf' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('9', 'controle', 'il supprime le fichier d''une pièce libre, qu''une écriture proposée cite (contrôle positif)', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/libre.pdf' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('10', 'controle', 'et celui d''un document libre', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/doc-libre.pdf' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('11', 'controle', 'et un fichier qu''aucune ligne ne désigne', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/orphelin.pdf' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('12', 'controle', 'le chef du cabinet du dossier, non super-administrateur : ni le figé, mais le libre', 'chef_du_cabinet', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/fige.pdf' returning 1) select count(*)::text from d
          §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/libre.pdf' returning 1) select '{RENDU}/' || count(*) from d$q$, 'OK', '0/1'),
      ('13', 'controle', 'un membre affecté au dossier A : ni le figé, mais le libre', 'membre_affecte', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/fige.pdf' returning 1) select count(*)::text from d
          §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/libre.pdf' returning 1) select '{RENDU}/' || count(*) from d$q$, 'OK', '0/1'),
      ('14', 'controle', 'un membre non affecté : rien', 'membre', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name like '{DA}/%' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('15', 'controle', 'le chef d''un autre cabinet : rien', 'chef_autre', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name like '{DA}/%' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('16', 'controle', 'le client du dossier : rien, pas même le libre', 'client', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name like '{DA}/%' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('17', 'controle', 'un compte rattaché à rien, puis l''anonyme : rien', 'inconnu', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name like '{DA}/%' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('17b', 'controle', 'l''anonyme : rien', 'anon', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name like '{DA}/%' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('18', 'controle', 'un lot sur tout le préfixe de A, comme l''application : seuls les trois fichiers libres partent', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name like '{DA}/%' returning name) select string_agg(name, ',' order by name collate "C") from d$q$,
        'OK', '{DA}/doc-libre.pdf,{DA}/libre.pdf,{DA}/orphelin.pdf'),
      ('19', 'controle', 'la suppression de A comme l''application la fait, par le super-administrateur : libres / ligne / second passage / restés', 'chef', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name like '{DA}/%' returning 1) select count(*)::text from d
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select '{RENDU}/' || count(*) from d
          §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name like '{DA}/%' returning 1) select '{RENDU}/' || count(*) from d
          §§ reset role
          §§ select '{RENDU}/' || count(*) || ':' || coalesce(string_agg(name, ',' order by name collate "C"), '') from storage.objects where bucket_id = 'pieces' and name like '{DA}/%'$q$,
        'OK', '3/1/7/1:{DA}/croise.pdf'),
      ('20', 'controle', 'la même par le chef du cabinet non super-administrateur : la ligne partie, il ne voit plus le dossier — les huit fichiers figés restent (la limite, INAL12-Q1)', 'chef_du_cabinet', null, null,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name like '{DA}/%' returning 1) select count(*)::text from d
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select '{RENDU}/' || count(*) from d
          §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name like '{DA}/%' returning 1) select '{RENDU}/' || count(*) from d
          §§ reset role
          §§ select '{RENDU}/' || count(*) from storage.objects where bucket_id = 'pieces' and name like '{DA}/%'$q$,
        'OK', '3/1/0/8'),
      ('21', 'controle', 'sans le réglage de l''API, le stockage refuse à tous, au super-administrateur aussi', 'chef', null, null,
        $q$with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/libre.pdf' returning 1) select count(*)::text from d$q$,
        '42501', 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'),
      ('22', 'controle', 'le dépôt reste ouvert : le chef du cabinet dépose un fichier dans A', 'chef_du_cabinet', null, null,
        $q$insert into storage.objects (bucket_id, name, owner_id) values ('pieces', '{DA}/nouveau.pdf', '{CLIENT}') returning name$q$, 'OK', '{DA}/nouveau.pdf'),
      ('23', 'controle', 'la restauration reste ouverte : le super-administrateur réinsère dans R un fichier, sa pièce et une écriture validée qui la cite — puis ce fichier ne se supprime plus', 'chef', null, null,
        $q$insert into storage.objects (bucket_id, name, owner_id) values ('pieces', '{DR}/restaure.pdf', '{CHEF}') returning name
          §§ insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash) values ('{PR}', '{DR}', '{DR}/restaure.pdf', 'restaure.pdf', repeat('7', 64)) returning id::text
          §§ insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, piece_id, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values
               ('{DR}', '2025-06-01', '606100', 'ESSAI INAL1 restaurée', 20, 'debit', 'validee', '{PR}', now(), 'AC', 1, 'F3', '2025-06-01', 'Achats') returning statut
          §§ select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DR}/restaure.pdf' returning 1) select count(*)::text from d$q$,
        'OK', '0'),
      ('24', 'controle', 'fichier_fige, au chef : vrai pour un fichier figé, faux pour un libre', 'chef', null, null,
        $q$select fichier_fige('{DA}/fige.pdf')::text || '/' || fichier_fige('{DA}/libre.pdf')::text$q$, 'OK', 'true/false'),
      ('25', 'controle', 'fichier_fige, à qui n''administre pas le dossier (un compte rattaché à rien) : nul', 'inconnu', null, null,
        $q$select coalesce(fichier_fige('{DA}/fige.pdf')::text, 'nul')$q$, 'OK', 'nul'),
      ('26', 'controle', 'fichier_fige, un chemin qui ne commence pas par un dossier : nul, sans rien lever', 'chef', null, null,
        $q$select coalesce(fichier_fige('essai-sans-dossier/fige.pdf')::text, 'nul') || '/' || coalesce(fichier_fige(null)::text, 'nul')$q$, 'OK', 'nul/nul'),

      ('M1', 'mutation', 'la policy d''hier : le super-administrateur supprime le fichier figé', 'chef',
        $p$alter policy pieces_storage_delete on storage.objects using (bucket_id = 'pieces' and admin_du_dossier(((storage.foldername(name))[1])::uuid))$p$, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/fige.pdf' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('M2', 'mutation', 'la fonction sans le bien : le contrôle 3 tombe', 'chef',
        $p$select pg_temp.muter('public.exercice_figeant_la_piece(p.id) is not null', 'exists (select 1 from public.ecritures_brouillon e where e.statut = ''validee'' and e.piece_id = p.id)')$p$, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/bien.pdf' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('M3', 'mutation', 'la fonction sans la version lisible : le contrôle 2 tombe', 'chef',
        $p$select pg_temp.muter('(p.storage_path = p_chemin or p.lisible_path = p_chemin)', '(p.storage_path = p_chemin)')$p$, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/fige-lisible.pdf' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('M4', 'mutation', 'la fonction sans les preuves de la révision : le contrôle 4 tombe', 'chef',
        $p$select pg_temp.muter('or exists (select 1 from public.revision_preuves r where r.piece_id = p.id)', '')$p$, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/citee.pdf' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('M5', 'mutation', 'la fonction sans les documents : le contrôle 6 tombe', 'chef',
        $p$select pg_temp.muter('where dd.storage_path = p_chemin', 'where false and dd.storage_path = p_chemin')$p$, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/doc-cite.pdf' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('M6', 'mutation', 'la fonction bornée au dossier du chemin : le contrôle 8 tombe', 'chef',
        $p$select pg_temp.muter('where (p.storage_path = p_chemin or p.lisible_path = p_chemin)', 'where p.dossier_id = split_part(p_chemin, ''/'', 1)::uuid and (p.storage_path = p_chemin or p.lisible_path = p_chemin)')$p$, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/croise.pdf' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('M7', 'mutation', 'la fonction qui répond à tous : le contrôle 25 tombe', 'inconnu',
        $p$select pg_temp.muter('when not public.admin_du_dossier(split_part(p_chemin, ''/'', 1)::uuid) then null', '')$p$, null,
        $q$select coalesce(fichier_fige('{DA}/fige.pdf')::text, 'nul')$q$, 'OK', 'true'),
      ('M8', 'mutation', 'la fonction qui ne fige rien : le contrôle 1 tombe', 'chef',
        $p$select pg_temp.muter('else exists (', 'else false and exists (')$p$, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/fige.pdf' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('M9', 'mutation', 'la fonction sans le dossier permanent : le contrôle 5 tombe', 'chef',
        $p$select pg_temp.muter('or exists (select 1 from public.dossier_permanent d where d.piece_id = p.id)', '')$p$, null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'pieces' and name = '{DA}/permanent.pdf' returning 1) select count(*)::text from d$q$, 'OK', '1')
    ) as x(num, genre, controle, qui, prelude, droits, ordre, code, attendu)
    loop
      ordre := s.ordre;
      prelude := s.prelude;
      attendu := s.attendu;
      for k in select jsonb_object_keys(ids) loop
        ordre := replace(ordre, '{' || k || '}', ids ->> k);
        attendu := replace(attendu, '{' || k || '}', ids ->> k);
      end loop;
      accepte := false; code_recu := null; message := null; rendu := null;
      begin
        -- Le prélude, en propriétaire : une mutation, dans la sous-transaction de l'étape.
        if prelude ~* '^\s*select' then
          execute prelude into rendu;
        elsif prelude is not null then
          execute prelude;
        end if;
        -- Le compte du client, rangé au cabinet le temps de son étape — une sous-transaction annulée l'emporte.
        if s.qui in ('membre', 'membre_affecte') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
          if s.qui = 'membre_affecte' then
            insert into dossier_assignations (dossier_id, user_id) values ((ids ->> 'DA')::uuid, client);
          end if;
        elsif s.qui = 'chef_du_cabinet' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
        elsif s.qui = 'chef_autre' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, (ids ->> 'CC')::uuid, 'comptable_en_chef');
        end if;
        if s.qui = 'anon' then
          set local role anon;
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        elsif s.qui in ('inconnu', 'client', 'chef', 'membre', 'membre_affecte', 'chef_du_cabinet', 'chef_autre') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'inconnu' then inconnu when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        else
          perform set_config('request.jwt.claims', '', true);
        end if;
        rendu := null;
        foreach partie in array string_to_array(ordre, '§§') loop
          partie := replace(partie, '{RENDU}', coalesce(rendu, ''));
          if partie ~* '^\s*reset\s+role\s*$' then
            reset role;
          elsif partie ~* '^\s*(insert|update)' and partie !~* 'returning' then
            execute partie;
          else
            execute partie into rendu;
          end if;
        end loop;
        accepte := true;
        if s.genre in ('controle', 'mutation') then
          raise exception 'ANNULATION_ESSAI';
        end if;
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      perform set_config('storage.allow_delete_query', '', true);
      perform set_config('jd.validation_exercice', '', true);
      ok := case
        when s.code = 'OK' then accepte and (attendu is null or coalesce(rendu, '') = attendu)
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
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from pieces)), ((select count(*) from documents_divers)),
    ((select count(*) from ecritures_brouillon)), ((select count(*) from immobilisations)),
    ((select count(*) from revision_preuves)), ((select count(*) from dossier_permanent)),
    ((select count(*) from storage.objects)), ((select count(*) from cabinets))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres, 'ok', erreur is null and avant = apres);
  perform set_config('essai.piece_figee_dans_le_stockage', verdicts::text, true);
end
$essai$;

select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.piece_figee_dans_le_stockage')::jsonb) as v(controle text, genre text, ok boolean, observe text)
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
