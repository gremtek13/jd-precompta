-- L'EXEMPLAIRE D'UNE FACTURE ÉMISE, ET LA JUMELLE INVERSÉE, ÉPROUVÉS EN BASE (ligne 28.6, chantier EC-Q3, étape VF1a ;
-- migration `exemplaires_des_factures` ; puis ligne 28.65, étape VF6b, migration `jumelle_inversee`) — à rejouer par
-- `execute_sql` après toute migration qui touche `pieces.facture_id` ou `pieces.vente_hors_des_factures`, la garde
-- `garder_exemplaire_facture`, `designer_exemplaire_facture`, `defaire_exemplaire_facture`,
-- `declarer_vente_hors_des_factures`, `retirer_declaration_hors_des_factures`, `factures_du_pont`, les gardes G3
-- (`garder_vente_d_un_dossier_bascule`) et G4 (`garder_exemplaire_d_une_source`), le journal `designations_des_pieces`,
-- les policies ou les gardes de `pieces`, `lignes_bancaires`, `reglements_groupes`, `ecritures_brouillon` et
-- `lettrages_manuels`, la garde des factures validées, `exercice_figeant_la_piece`, le classement d'un mouvement par ses
-- encaissements, `admin_du_dossier`, `memberships` ou `cabinet_admins` — et, depuis l'étape VF7e (migration
-- `gel_des_designations`), `exercice_figeant_la_designation`, `exercice_figeant_la_facture_source` ou `exercices_valides`.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI DÉSIGNE ET DÉFAIT, par impersonation : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien, le
--     client — sur un dossier qui n'est pas le sien, sur le SIEN sans case, sur le sien avec « Ventes » et « Banque » —, un
--     membre du cabinet affecté à un AUTRE dossier se font refuser l'accès au dossier, comme un dossier qui n'existe pas ;
--     le chef du cabinet (super-administrateur), un chef qui ne l'est pas et un membre affecté au dossier le font ;
--   - CE QUI SE REFUSE, avec sa RAISON, dans l'ordre des deux fonctions — que src/lib/exemplairesDesFactures.test.ts relit
--     ici et rejoue appel par appel : la pièce introuvable dans le dossier, une pièce qui n'est pas une vente, une pièce
--     figée par une écriture validée, une pièce déjà désignée à CETTE facture, la facture introuvable dans le dossier, un
--     brouillon ; pour défaire : une pièce que rien ne désigne, une pièce figée ; et l'ordre des refus quand deux tiennent
--     ensemble ;
--   - CE QUI S'ÉCRIT : la désignation, et elle seule ; plusieurs exemplaires d'une même facture ; l'exemplaire d'un avoir ;
--     défaire, puis désigner de nouveau ; une désignation à une autre facture qui REMPLACE la première (VF6-Q1) ; le réglage
--     `jd.exemplaire_facture` retiré après chaque appel ;
--   - CE QUE LA GARDE TIENT SANS LES FONCTIONS : personne — le cabinet par sa policy, le propriétaire, le rôle des Edge
--     Functions — ne pose, ne retire ni ne change la désignation directement ; le client qui dépose une pièce ne la pose
--     pas, et son dépôt ordinaire passe toujours ; il ne met à jour aucune pièce ; la restauration par le
--     super-administrateur réinsère une pièce désignée, mais jamais d'une facture d'un autre dossier, d'un brouillon, d'une
--     facture qui n'existe pas, ni sur une pièce qui n'est pas une vente ; une pièce désignée ne change ni de dossier ni de
--     nature, une pièce qui ne l'est pas, si ; tout le reste d'une pièce désignée se modifie comme avant ; le réglage d'une
--     autre pièce n'ouvre rien ; le gel de la validation tient la désignation même sous un réglage forgé ;
--   - QUI LIT la désignation : le client du dossier, comme toute la ligne de ses pièces, le membre affecté ; personne
--     d'autre ;
--   - CE QUE LE CATALOGUE DIT : la colonne, sa clé sans action à la suppression, son index, le déclencheur, la sécurité
--     et le chemin des fonctions, leurs droits d'exécution, les policies de `pieces` inchangées, la garde des pièces
--     figées qui compare toujours la ligne entière ;
--   - LES MUTATIONS (contrôles 140 à 149, et 390 à 398) : chacune rejoue un contrôle avec un profil, une cible ou un
--     réglage délibérément faux, et doit MORDRE — rendre ce que le contrôle qu'elle vise refuse ;
--   - et que RIEN ne reste en base.
--
-- LA JUMELLE INVERSÉE (étape VF6b, migration `jumelle_inversee` ; HISTORIQUE.md, « VF6, LA JUMELLE INVERSÉE : LA
-- CONCEPTION », § 3), dans un dossier J dont les factures sont la source de leurs ventes (contrôles 200 à 398) :
--   - LE JUMEAU DU PONT (contrôle 230) : entre les bornes « LE JEU DU JUMEAU », des factures de J — sources ou non, une
--     facture et son avoir, un brouillon, des SIRET aux blancs divers (une espace, une espace insécable, une espace fine
--     insécable, une tabulation), un SIRET de dix chiffres —, leurs transmissions (une qui n'est pas de Super PDP, une
--     tombée en échec) et celle d'une facture d'un AUTRE dossier, et vingt-deux pièces — dont une venue d'un autre hôte,
--     et une que Super PDP rattache quand son identité dit l'autre nature : ce que `factures_du_pont` en rend, pièce par
--     pièce, que src/lib/ventesJumellesJumeau.test.ts redemande au pont du navigateur (src/lib/ventesJumelles.ts) ;
--   - G3, LA PIÈCE DE VENTE D'UN DOSSIER BASCULÉ (200 à 229) : née validée (refusée au chef simple, au propriétaire, au rôle
--     des Edge Functions ; la restauration du super-administrateur passe) ; validée sans marque, rattachée par le pont à
--     une facture qu'elle ne désigne pas (non marquée, désignée à une autre, déclarée — une facture d'avant la bascule
--     comprise), ses preuves contraires (VF6-Q5) même désignée ; au passage seulement — une pièce validée avant la bascule
--     reste ce qu'elle est, jusqu'à ce qu'elle revienne à valider, change de nature ou de dossier ; un lot qu'une pièce
--     fait refuser en entier ;
--   - G4, L'EXEMPLAIRE D'UNE FACTURE SOURCE NE JUSTIFIE RIEN (240 à 252) : ni rapproché (le cabinet, le propriétaire, le
--     rôle des Edge Functions, la restauration elle-même), ni réglé par une part d'un virement groupé, ni écrit, ni lettré ;
--     l'exemplaire d'une facture qui n'est pas source, une pièce que rien ne désigne, une ligne que l'écriture ne relie pas
--     à une autre pièce passent ;
--   - L'AUTRE CÔTÉ (260 à 265) : la désignation à une facture source d'une pièce rapprochée, réglée par une part, écrite
--     ou lettrée, chaque lien dit, dans cet ordre ; à une facture qui n'est pas source, elle passe ;
--   - LA DÉSIGNATION DANS UN DOSSIER BASCULÉ (270 à 280) : le pont qui dit une autre facture, des preuves contraires, la
--     facture du pont ; le rang 5 resserré à la même facture ; le REMPLACEMENT d'une désignation et d'une déclaration, et
--     les deux lignes qu'il écrit au journal ; hors d'un dossier basculé, le pont ne retient rien (280) ;
--   - VF5H-Q1 (281 à 289, 295, 319) : un mouvement classé par ses encaissements qui compte un encaissement d'une facture
--     qui n'est pas source retient la désignation qui la quitte, celle qui la prend, le retrait et la déclaration ; ni la
--     facture SOURCE de ce mouvement, ni une facture d'avant dont l'encaissement cite un mouvement non classé ou est
--     contre-passé sans mouvement, ne retiennent rien ;
--   - DÉFAIRE (290 à 295) : une pièce validée d'un dossier basculé ne perd pas sa désignation (VF6-Q1) ;
--   - DÉCLARER ET RETIRER LA DÉCLARATION (300 à 327) : l'accès, puis chaque refus dans l'ordre de la fonction ; ce qui
--     s'écrit ; la désignation remplacée ;
--   - LA GARDE, QUI APPREND LA DÉCLARATION (330 à 345) : personne ne la pose directement, le client qui dépose compris
--     (VF6-Q2) ; la restauration seulement, sur une vente, jamais avec une désignation ; une pièce déclarée ne change ni
--     de dossier ni de nature ;
--   - LE JOURNAL (350 à 366) : ce que le jeu y a écrit, qui le lit (le cabinet seul : VF6-Q3), qui l'écrit (les fonctions,
--     la restauration), rien ne le réécrit ;
--   - LE CATALOGUE (370 à 379).
--
-- LE GEL DES DÉSIGNATIONS (étape VF7e, migration `gel_des_designations` ; HISTORIQUE.md, « VF7, LA VALIDATION FIGE LA
-- SOURCE : LA CONCEPTION », § 3 f ; VF7-Q1, option B, suivie sur la recommandation), dans un dossier DG qui bascule et un
-- dossier DN qui ne bascule pas, aux exercices validés posés par la porte de la restauration (contrôles 400 à 451) :
--   - CHAQUE GESTE, AVANT ET APRÈS : avant les validations, tout se défait, se remplace, se déclare (400 à 405) ; les
--     écritures de la pièce validées, pas encore l'exercice de sa facture, le gel est celui de la pièce (406 à 408) ;
--     après, la désignation d'une facture source figée ne se défait, ne se remplace ni ne se déclare plus, la facture nommée
--     — avant « déjà l'exemplaire de cette facture », après « validée dans un dossier basculé » (410 à 416) ;
--   - LE PLUS ANCIEN des deux exercices, celui de la pièce et celui de sa facture, et ses mots (417 à 420) ;
--   - LE CÔTÉ DE LA FACTURE (VF7-Q1, B) : une facture source figée — un avoir, une facture d'une année qui précède le
--     premier exercice validé — ne reçoit pas une pièce déjà marquée, désignée ou déclarée, et le dit avant le pont (421b) ;
--     l'exercice d'un autre dossier ne la fige pas (DN valide 2026, F2026-0101 de DG reste libre) ; une facture d'avant la
--     bascule, une facture que rien ne fige, si ; une pièce que rien ne marque, si — sa première désignation, aussitôt
--     figée, puis validée (421 à 438) ;
--   - DANS UN DOSSIER QUI N'A PAS BASCULÉ, rien de neuf : aucune facture n'y est source (439 à 443) ;
--   - les deux fonctions neuves, facture par facture et pièce par pièce, et le catalogue (444 à 449) ; deux mutations
--     (450, 451).
--
-- SANS LA MIGRATION `exemplaires_des_factures`, une seule ligne le dit, « EN ATTENTE », SANS être une faute. Elle EN EST
-- UNE si l'historique porte `exemplaires_des_factures` sans la colonne — sauf si une ligne
-- `retour_exemplaires_des_factures`, plus récente, dit son retour arrière. SANS LA MIGRATION `jumelle_inversee`, l'essai se
-- joue et ses contrôles de l'étape VF6b sont EN FAUTE, comme le 18 et le 26 qu'elle change : il décrit la base qui la
-- porte.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE dont signature.sql montre les neuf familles égales à la
-- production : la suppression d'une pièce désignée et celle d'un dossier dont des pièces sont désignées (la clé sans
-- action se vérifie à la fin de l'instruction de la cascade), la suppression d'une ligne du journal (refusée, sauf par la
-- cascade de sa pièce ou de son dossier), et deux désignations concurrentes de la même pièce — l'outil d'exécution soumet
-- une suppression à une confirmation qui n'arrive pas ici.
--
-- Tout se joue dans cinq dossiers JETABLES du cabinet du dossier `test` (T et A, qui n'ont pas basculé ; J, qui bascule
-- après avoir validé quatre pièces ; DG et DN, pour le gel), au sein d'un bloc qui s'annule entièrement à la fin
-- (`ANNULATION_ESSAI_GLOBALE`) ;
-- chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001) — le moteur d'étapes de
-- regimesEreporting.sql, ses six genres (`jeu`, `controle`, `fait`, `valeur`, `retenir`, `lecture`) et ses profils
-- (« membre » affecté au dossier T, « membre_ailleurs » affecté au dossier A, « chef_simple », chef du cabinet sans être
-- super-administrateur : le compte client rattaché au cabinet le temps de la sous-transaction), et trois de plus :
-- « client_t », un accès du compte client au dossier T, sans case, et « client_t_ventes », le même avec « Ventes » et
-- « Banque », posés le temps de la sous-transaction ; « service », le rôle des Edge Functions. Les factures validées du
-- jeu et les écritures validées qui figent cinq pièces entrent par la porte de la restauration, que le
-- super-administrateur seul passe, dans un dossier sans série ni exercice validé. Un refus se juge à son code ET à son
-- message (motif LIKE) ; une valeur lue, au texte exact, ses identifiants jetables remplacés. Les identifiants jetables
-- sont FIXES (préfixe `f1a00000`). Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.exemplaires_des_factures`) : hors de l'outil d'exécution, le fichier se joue en UNE transaction (`psql -1`).
-- Aucune instruction de suppression, aucune mise à jour sans `where`. Aucune barre oblique inverse dans le jeu (l'outil
-- d'exécution décode les échappements Unicode) : un blanc d'un SIRET s'écrit `chr(…)` ; les seules du fichier sont celles
-- du verdict final, d'avant VF6b.
--
-- 24/10/2026 — la migration `jumelle_inversee` APPLIQUÉE en production (`20261024052424`) : ce fichier n'y a pas été
-- rejoué entier ; la signature des neuf familles en production égale celle de la réplique où il a rendu ses 266 justes,
-- et un contrôle ciblé du journal y a été joué (HISTORIQUE.md, « LE VIREMENT MIXTE ET LA JUMELLE INVERSÉE EN PRODUCTION »).
-- 25/10/2026 — étendu au gel des désignations (étape VF7e), joué sur une réplique égale à la production munie de
-- `registre_virement_mixte`, `frontiere_des_encaissements` et `validation_des_ventes_facturees`, sans puis avec la
-- migration `gel_des_designations` (appliquée le 26/10/2026) : 323 lignes de verdict, 21 en faute sans elle, aucune
-- avec (avant l'extension, 265 lignes : les « 266 justes » ci-dessus comptaient la ligne d'en-tête de psql) ;
-- HISTORIQUE.md, « LE GEL DES DÉSIGNATIONS ».
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  cabinet uuid;
  applique text; retour text;
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text; attendu text; n bigint;
  tables text[] := array['dossiers', 'pieces', 'factures_emises', 'ecritures_brouillon', 'cabinet_admins', 'dossier_assignations',
    'memberships', 'facture_numerotation', 'transmissions_factures', 'lignes_bancaires', 'reglements_groupes', 'lettrages_manuels',
    'encaissements_factures', 'designations_des_pieces', 'exercices_valides', 'immobilisations'];
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  -- La migration d'abord : sans elle, une ligne le dit, en faute seulement si l'historique la porte sans retour arrière.
  if not exists (select 1 from pg_attribute where attrelid = 'public.pieces'::regclass and attname = 'facture_id' and not attisdropped)
     or to_regprocedure('public.designer_exemplaire_facture(uuid, uuid, uuid)') is null then
    select max(version) filter (where name = 'exemplaires_des_factures'), max(version) filter (where name = 'retour_exemplaires_des_factures')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration exemplaires_des_factures (étape VF1a) n''est pas en base',
      'observe', 'historique : ' || coalesce('exemplaires_des_factures ' || applique, 'sans exemplaires_des_factures')
                 || coalesce(', retour_exemplaires_des_factures ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique));
    perform set_config('essai.exemplaires_des_factures', verdicts::text, true);
    return;
  end if;

  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if cabinet is null
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or not exists (select 1 from auth.users where id = client)
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou client déjà rattaché au cabinet';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'AUTRE', gen_random_uuid())
    || jsonb_build_object('T', 'f1a00000-0000-4000-8000-0000000000a1', 'A', 'f1a00000-0000-4000-8000-0000000000a3',
      'J', 'f1a00000-0000-4000-8000-0000000000b1')
    || jsonb_build_object(
      'F1', 'f1a00000-0000-4000-8001-000000000001', 'F2', 'f1a00000-0000-4000-8001-000000000002',
      'AV', 'f1a00000-0000-4000-8001-000000000003', 'FB', 'f1a00000-0000-4000-8001-000000000004',
      'FA', 'f1a00000-0000-4000-8001-000000000005')
    || jsonb_build_object(
      'PV1', 'f1a00000-0000-4000-8002-000000000001', 'PV2', 'f1a00000-0000-4000-8002-000000000002',
      'PV3', 'f1a00000-0000-4000-8002-000000000003', 'PV4', 'f1a00000-0000-4000-8002-000000000004',
      'PV5', 'f1a00000-0000-4000-8002-000000000005', 'PACH', 'f1a00000-0000-4000-8002-000000000006',
      'PNDF', 'f1a00000-0000-4000-8002-000000000007', 'PAUT', 'f1a00000-0000-4000-8002-000000000008',
      'PFIG', 'f1a00000-0000-4000-8002-000000000009', 'PFIG2', 'f1a00000-0000-4000-8002-00000000000a',
      'PFIGA', 'f1a00000-0000-4000-8002-00000000000b', 'PDEP', 'f1a00000-0000-4000-8002-00000000000c',
      'PX', 'f1a00000-0000-4000-8002-00000000000d', 'PN', 'f1a00000-0000-4000-8002-0000000000f1')
    || jsonb_build_object('E1', 'f1a00000-0000-4000-8003-000000000001', 'E2', 'f1a00000-0000-4000-8003-000000000002',
      'E3', 'f1a00000-0000-4000-8003-000000000003')
    -- La jumelle inversée : les factures de J (8005), ses pièces (8006), ses mouvements (8007), le reste (8008).
    || jsonb_build_object(
      'FS1', 'f1a00000-0000-4000-8005-000000000001', 'FS2', 'f1a00000-0000-4000-8005-000000000002',
      'FS3', 'f1a00000-0000-4000-8005-000000000003', 'FSA', 'f1a00000-0000-4000-8005-000000000004',
      'FA0', 'f1a00000-0000-4000-8005-000000000005', 'FA1', 'f1a00000-0000-4000-8005-000000000006',
      'FSN', 'f1a00000-0000-4000-8005-000000000008')
    || jsonb_build_object(
      'PJ1', 'f1a00000-0000-4000-8006-000000000001', 'PJ2', 'f1a00000-0000-4000-8006-000000000002',
      'PJ3', 'f1a00000-0000-4000-8006-000000000003', 'PJ4', 'f1a00000-0000-4000-8006-000000000004',
      'PJ5', 'f1a00000-0000-4000-8006-000000000005', 'PJ6', 'f1a00000-0000-4000-8006-000000000006',
      'PJ7', 'f1a00000-0000-4000-8006-000000000007', 'PJ8', 'f1a00000-0000-4000-8006-000000000008',
      'PJ9', 'f1a00000-0000-4000-8006-000000000009', 'PJ10', 'f1a00000-0000-4000-8006-00000000000a',
      'PJ11', 'f1a00000-0000-4000-8006-00000000000b', 'PJ12', 'f1a00000-0000-4000-8006-00000000000c',
      'PJ13', 'f1a00000-0000-4000-8006-00000000000d', 'PJ14', 'f1a00000-0000-4000-8006-00000000000e',
      'PJ15', 'f1a00000-0000-4000-8006-00000000000f', 'PJ16', 'f1a00000-0000-4000-8006-000000000010',
      'PJ17', 'f1a00000-0000-4000-8006-000000000011', 'PJ18', 'f1a00000-0000-4000-8006-000000000012')
    || jsonb_build_object(
      'PVA', 'f1a00000-0000-4000-8006-000000000021', 'PVB', 'f1a00000-0000-4000-8006-000000000022',
      'PVC', 'f1a00000-0000-4000-8006-000000000023', 'PAC', 'f1a00000-0000-4000-8006-000000000024',
      'PL', 'f1a00000-0000-4000-8006-000000000031', 'PR', 'f1a00000-0000-4000-8006-000000000032',
      'PE', 'f1a00000-0000-4000-8006-000000000033', 'PLT', 'f1a00000-0000-4000-8006-000000000034',
      'PX0', 'f1a00000-0000-4000-8006-000000000041', 'PX0C', 'f1a00000-0000-4000-8006-000000000042',
      'PXS', 'f1a00000-0000-4000-8006-000000000043', 'PFD', 'f1a00000-0000-4000-8006-000000000051',
      'PFG', 'f1a00000-0000-4000-8006-000000000052', 'PDV', 'f1a00000-0000-4000-8006-000000000053',
      'PN2', 'f1a00000-0000-4000-8006-0000000000f2')
    || jsonb_build_object(
      'ML', 'f1a00000-0000-4000-8007-000000000001', 'MR', 'f1a00000-0000-4000-8007-000000000002',
      'M1', 'f1a00000-0000-4000-8007-000000000003', 'MX', 'f1a00000-0000-4000-8007-000000000004',
      'MN', 'f1a00000-0000-4000-8007-000000000005',
      'RG1', 'f1a00000-0000-4000-8008-000000000001', 'E4', 'f1a00000-0000-4000-8008-000000000002',
      'E5', 'f1a00000-0000-4000-8008-000000000003', 'E6', 'f1a00000-0000-4000-8008-000000000004',
      'LT1', 'f1a00000-0000-4000-8008-000000000005', 'G1', 'f1a00000-0000-4000-8008-0000000000a1',
      'RGN', 'f1a00000-0000-4000-8008-000000000011', 'EN', 'f1a00000-0000-4000-8008-000000000012',
      'LTN', 'f1a00000-0000-4000-8008-000000000013', 'JN', 'f1a00000-0000-4000-8008-000000000014')
    -- Ce que la première campagne de mutations a montré absent : un brouillon de J, quatre pièces du jumeau, une pièce de T
    -- que le pont rattache, un crédit libre, et les encaissements de FA1.
    || jsonb_build_object(
      'FBJ', 'f1a00000-0000-4000-8005-000000000009', 'PT1', 'f1a00000-0000-4000-8002-00000000000e',
      'PJ19', 'f1a00000-0000-4000-8006-000000000013', 'PJ20', 'f1a00000-0000-4000-8006-000000000014',
      'PJ21', 'f1a00000-0000-4000-8006-000000000015', 'PJ22', 'f1a00000-0000-4000-8006-000000000016',
      'M2', 'f1a00000-0000-4000-8007-000000000006',
      'EA1', 'f1a00000-0000-4000-8008-000000000021', 'EA2', 'f1a00000-0000-4000-8008-000000000022',
      'EA3', 'f1a00000-0000-4000-8008-000000000023')
    -- Le gel des désignations (étape VF7e) : deux dossiers, leurs factures, leurs pièces, deux biens, quatre écritures (8009).
    || jsonb_build_object(
      'DG', 'f1a00000-0000-4000-8009-0000000000d1', 'DN', 'f1a00000-0000-4000-8009-0000000000d2',
      'FG23', 'f1a00000-0000-4000-8009-000000000101', 'FG24', 'f1a00000-0000-4000-8009-000000000102',
      'FG25', 'f1a00000-0000-4000-8009-000000000103', 'FGAV', 'f1a00000-0000-4000-8009-000000000104',
      'FG26', 'f1a00000-0000-4000-8009-000000000105', 'FGP', 'f1a00000-0000-4000-8009-000000000106',
      'FN25', 'f1a00000-0000-4000-8009-000000000107', 'FN26', 'f1a00000-0000-4000-8009-000000000108')
    || jsonb_build_object(
      'PG1', 'f1a00000-0000-4000-8009-000000000201', 'PG2', 'f1a00000-0000-4000-8009-000000000202',
      'PG3', 'f1a00000-0000-4000-8009-000000000203', 'PG4', 'f1a00000-0000-4000-8009-000000000204',
      'PG5', 'f1a00000-0000-4000-8009-000000000205', 'PG6', 'f1a00000-0000-4000-8009-000000000206',
      'PG7', 'f1a00000-0000-4000-8009-000000000207', 'PG8', 'f1a00000-0000-4000-8009-000000000208',
      'PGI1', 'f1a00000-0000-4000-8009-000000000209', 'PGI2', 'f1a00000-0000-4000-8009-00000000020a',
      'PN1', 'f1a00000-0000-4000-8009-00000000020b', 'PN2', 'f1a00000-0000-4000-8009-00000000020c',
      'PG9', 'f1a00000-0000-4000-8009-00000000020d')
    || jsonb_build_object(
      'IG1', 'f1a00000-0000-4000-8009-000000000301', 'IG2', 'f1a00000-0000-4000-8009-000000000302',
      'EG7', 'f1a00000-0000-4000-8009-000000000401', 'EGI1', 'f1a00000-0000-4000-8009-000000000402',
      'EGI2', 'f1a00000-0000-4000-8009-000000000403', 'EN2', 'f1a00000-0000-4000-8009-000000000404');

  -- Le compte de chaque table que l'essai touche, avant et après ; le journal seulement s'il existe (sans la migration de
  -- l'étape VF6b, l'essai se joue, ses contrôles neufs en faute).
  foreach cle in array tables loop
    if to_regclass('public.' || cle) is null then
      n := -1;
    else
      execute format('select count(*) from public.%I', cle) into n;
    end if;
    avant := concat_ws('/', avant, n);
  end loop;

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  etapes := array[
    -- ══ Le jeu : trois dossiers jetables, leurs factures, leurs pièces, trois désignations, trois pièces figées ══════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures) values
      ('{T}', 'ESSAI EXEMPLAIRES T', '{CAB}', 'tresorerie', '455000', false), ('{A}', 'ESSAI EXEMPLAIRES A', '{CAB}', 'tresorerie', '455000', false),
      ('{J}', 'ESSAI EXEMPLAIRES J', '{CAB}', 'tresorerie', '455000', false)$q$, '', ''],
    array['fait', '0. le jeu : les factures de T et de A, validées par la porte de la restauration, et un brouillon', 'chef', $q$insert into factures_emises (id, dossier_id, numero, statut, type, facture_origine_id, date_emission, tiers_nom, montant_ht, montant_tva, montant_ttc, emetteur_siret, validated_at) values
      ('{F1}', '{T}', 'F2026-0001', 'validee', 'facture', null, '2026-03-14', 'CLIENT ESSAI', 100, 20, 120, '12345678900012', '2026-03-14 10:00:00+00'),
      ('{F2}', '{T}', 'F2026-0002', 'validee', 'facture', null, '2026-03-15', 'CLIENT ESSAI', 50, 10, 60, '12345678900012', '2026-03-14 10:00:00+00'),
      ('{AV}', '{T}', 'A2026-0001', 'validee', 'avoir', '{F1}', '2026-03-20', 'CLIENT ESSAI', -100, -20, -120, '12345678900012', '2026-03-14 10:00:00+00'),
      ('{FB}', '{T}', null, 'brouillon', 'facture', null, '2026-03-21', 'CLIENT ESSAI', 10, 2, 12, null, null),
      ('{FA}', '{A}', 'F2026-0001', 'validee', 'facture', null, '2026-03-14', 'CLIENT ESSAI', 100, 20, 120, '98765432100019', '2026-03-14 10:00:00+00')$q$, 'OK', ''],
    array['jeu', 'pièces de T et de A', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc) values
      ('{PV1}', '{T}', '{T}/essai-vf1a-pv1.pdf', 'essai-vf1a-pv1.pdf', 'vente', 'a_valider', '2026-03-14', 120),
      ('{PV2}', '{T}', '{T}/essai-vf1a-pv2.pdf', 'essai-vf1a-pv2.pdf', 'vente', 'validee', '2026-03-14', 120),
      ('{PV3}', '{T}', '{T}/essai-vf1a-pv3.pdf', 'essai-vf1a-pv3.pdf', 'vente', 'a_valider', '2026-03-20', -120),
      ('{PV4}', '{T}', '{T}/essai-vf1a-pv4.pdf', 'essai-vf1a-pv4.pdf', 'vente', 'a_valider', '2026-03-15', 60),
      ('{PV5}', '{T}', '{T}/essai-vf1a-pv5.pdf', 'essai-vf1a-pv5.pdf', 'vente', 'a_valider', '2026-03-14', 120),
      ('{PACH}', '{T}', '{T}/essai-vf1a-pach.pdf', 'essai-vf1a-pach.pdf', 'achat', 'a_valider', '2026-03-10', 30),
      ('{PNDF}', '{T}', '{T}/essai-vf1a-pndf.pdf', 'essai-vf1a-pndf.pdf', 'note_frais', 'a_valider', '2026-03-11', 20),
      ('{PAUT}', '{T}', '{T}/essai-vf1a-paut.pdf', 'essai-vf1a-paut.pdf', 'autre', 'a_valider', '2026-03-12', 10),
      ('{PFIG}', '{T}', '{T}/essai-vf1a-pfig.pdf', 'essai-vf1a-pfig.pdf', 'vente', 'validee', '2026-02-10', 50),
      ('{PFIG2}', '{T}', '{T}/essai-vf1a-pfig2.pdf', 'essai-vf1a-pfig2.pdf', 'vente', 'validee', '2026-02-11', 120),
      ('{PFIGA}', '{T}', '{T}/essai-vf1a-pfiga.pdf', 'essai-vf1a-pfiga.pdf', 'achat', 'validee', '2026-02-12', 40),
      ('{PDEP}', '{T}', '{T}/essai-vf1a-pdep.pdf', 'essai-vf1a-pdep.pdf', 'vente', 'a_valider', '2026-03-16', 70),
      ('{PX}', '{A}', '{A}/essai-vf1a-px.pdf', 'essai-vf1a-px.pdf', 'vente', 'a_valider', '2026-03-14', 120)$q$, '', ''],
    array['jeu', 'une pièce de T que le pont rattache à F1 par son identité (contrôle 280)', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, source, identite_numero, identite_siren_vendeur, identite_date, identite_nature) values
      ('{PT1}', '{T}', '{T}/essai-vf6b-pt1.pdf', 'essai-vf6b-pt1.pdf', 'vente', 'a_valider', 'superpdp', 'F2026-0001', '123456789', '2026-03-14', 'facture')$q$, '', ''],
    array['fait', '0. le jeu : PV4 exemplaire de F2, PV5 et PFIG2 de F1', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV4}', '{F2}'), designer_exemplaire_facture('{T}', '{PV5}', '{F1}'), designer_exemplaire_facture('{T}', '{PFIG2}', '{F1}')$q$, 'OK', ''],
    array['fait', '0. le jeu : les écritures validées qui figent PFIG, PFIG2 et PFIGA (exercice 2026), par la porte de la restauration', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, piece_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values
      ('{E1}', '{T}', '{PFIG}', '2026-02-10', '706000', 'ESSAI PFIG', 50, 'credit', 'validee', '2026-10-01 10:00:00+00', 'VE', 1, 'ESSAI PFIG', '2026-02-10', 'Prestations'),
      ('{E2}', '{T}', '{PFIG2}', '2026-02-11', '706000', 'ESSAI PFIG2', 120, 'credit', 'validee', '2026-10-01 10:00:00+00', 'VE', 2, 'ESSAI PFIG2', '2026-02-11', 'Prestations'),
      ('{E3}', '{T}', '{PFIGA}', '2026-02-12', '606100', 'ESSAI PFIGA', 40, 'debit', 'validee', '2026-10-01 10:00:00+00', 'AC', 3, 'ESSAI PFIGA', '2026-02-12', 'Achats')$q$, 'OK', ''],

    -- ══ Le jeu de la jumelle inversée : J valide quatre pièces, puis bascule ══════
    array['jeu', 'pièces de J validées avant la bascule', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc) values
      ('{PVA}', '{J}', '{J}/essai-vf6b-pva.pdf', 'essai-vf6b-pva.pdf', 'vente', 'validee', '2026-01-05', 30),
      ('{PVB}', '{J}', '{J}/essai-vf6b-pvb.pdf', 'essai-vf6b-pvb.pdf', 'vente', 'validee', '2026-01-06', 60),
      ('{PVC}', '{J}', '{J}/essai-vf6b-pvc.pdf', 'essai-vf6b-pvc.pdf', 'vente', 'validee', '2026-01-07', 70),
      ('{PAC}', '{J}', '{J}/essai-vf6b-pac.pdf', 'essai-vf6b-pac.pdf', 'achat', 'validee', '2026-01-08', 80)$q$, '', ''],
    array['fait', '0. le jeu : J bascule, par la policy des dossiers', 'chef', $q$update dossiers set ventes_par_les_factures = true where id = '{J}'$q$, 'OK', ''],

    -- ══ LE JEU DU JUMEAU — DÉBUT (src/lib/ventesJumellesJumeau.test.ts le lit d'ici à sa fin) ══════
    array['fait', '0. le jeu du jumeau : les factures de J, par la porte de la restauration — des SIRET aux blancs divers', 'chef', $q$insert into factures_emises (id, dossier_id, numero, statut, type, facture_origine_id, date_emission, tiers_nom, montant_ht, montant_tva, montant_ttc, emetteur_siret, superpdp_invoice_id, validated_at, source_de_la_vente) values
      ('{FS1}', '{J}', 'F2026-0001', 'validee', 'facture', null, '2026-04-01', 'CLIENT ESSAI', 100, 20, 120, '123 456 789 00012', null, '2026-04-01 10:00:00+00', true),
      ('{FS2}', '{J}', 'F2026-0002', 'validee', 'facture', null, '2026-04-02', 'CLIENT ESSAI', 50, 10, 60, '12345678900012', 7002, '2026-04-02 10:00:00+00', true),
      ('{FS3}', '{J}', 'F2026-0003', 'validee', 'facture', null, '2026-04-03', 'CLIENT ESSAI', 50, 10, 60, '123456789' || chr(8239) || '00012', null, '2026-04-03 10:00:00+00', true),
      ('{FSA}', '{J}', 'A2026-0001', 'validee', 'avoir', '{FS1}', '2026-04-04', 'CLIENT ESSAI', -100, -20, -120, '123456789', null, '2026-04-04 10:00:00+00', true),
      ('{FA0}', '{J}', 'F2026-0004', 'validee', 'facture', null, '2026-03-01', 'CLIENT ESSAI', 50, 10, 60, '123456789' || chr(9) || '00012', null, '2026-03-01 10:00:00+00', false),
      ('{FA1}', '{J}', 'F2026-0005', 'validee', 'facture', null, '2026-03-02', 'CLIENT ESSAI', 50, 10, 60, '123456789' || chr(160) || '00012', null, '2026-03-02 10:00:00+00', false),
      ('{FSN}', '{J}', 'F2026-0006', 'validee', 'facture', null, '2026-04-06', 'CLIENT ESSAI', 50, 10, 60, '1234567890', null, '2026-04-06 10:00:00+00', true),
      ('{FBJ}', '{J}', null, 'brouillon', 'facture', null, '2026-04-07', 'CLIENT ESSAI', 10, 2, 12, null, 7099, null, false)$q$, 'OK', ''],
    array['jeu', 'les transmissions du jumeau (le pont les lit toutes, quel que soit leur état : une seule active par facture) — et celle d''une facture d''un autre dossier', 'postgres', $q$insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values
      ('{J}', '{FS1}', 'plateforme', 'pa.exemple.fr', repeat('a', 64), 'accepte', 'vf6b-1'),
      ('{J}', '{FS2}', 'plateforme', 'pa.exemple.fr', repeat('a', 64), 'echec', 'vf6b-2'),
      ('{J}', '{FS2}', 'plateforme', 'pa.exemple.fr', repeat('a', 64), 'accepte', 'vf6b-2b'),
      ('{J}', '{FS3}', 'superpdp', 'api.superpdp.tech', repeat('a', 64), 'accepte', '7003'),
      ('{J}', '{FS3}', 'superpdp', 'api.superpdp.tech', repeat('a', 64), 'echec', '7013'),
      ('{J}', '{FA0}', 'plateforme', 'pa.exemple.fr', repeat('a', 64), 'accepte', 'vf6b-0'),
      ('{J}', '{FA1}', 'plateforme', 'pa.exemple.fr', repeat('a', 64), 'accepte', '7005'),
      ('{A}', '{FA}', 'plateforme', 'pa.exemple.fr', repeat('a', 64), 'accepte', 'vf6b-a')$q$, '', ''],
    array['jeu', 'les pièces du jumeau, à valider', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, source, flux_hote, flux_id, superpdp_invoice_id, identite_numero, identite_siren_vendeur, identite_date, identite_nature) values
      ('{PJ1}', '{J}', '{J}/essai-vf6b-pj01.pdf', 'essai-vf6b-pj01.pdf', 'vente', 'a_valider', 'plateforme', 'pa.exemple.fr', 'vf6b-1', null, null, null, null, null),
      ('{PJ2}', '{J}', '{J}/essai-vf6b-pj02.pdf', 'essai-vf6b-pj02.pdf', 'vente', 'a_valider', 'superpdp', null, null, 7002, null, null, null, null),
      ('{PJ3}', '{J}', '{J}/essai-vf6b-pj03.pdf', 'essai-vf6b-pj03.pdf', 'vente', 'a_valider', 'superpdp', null, null, 7003, null, null, null, null),
      ('{PJ4}', '{J}', '{J}/essai-vf6b-pj04.pdf', 'essai-vf6b-pj04.pdf', 'vente', 'a_valider', 'plateforme', 'pa.exemple.fr', 'vf6b-2', null, 'F2026-0001', '123456789', '2026-04-01', 'facture'),
      ('{PJ5}', '{J}', '{J}/essai-vf6b-pj05.pdf', 'essai-vf6b-pj05.pdf', 'vente', 'a_valider', 'superpdp', null, null, null, 'F2026-0001', '123456789', '2026-04-01', 'avoir'),
      ('{PJ6}', '{J}', '{J}/essai-vf6b-pj06.pdf', 'essai-vf6b-pj06.pdf', 'vente', 'a_valider', 'superpdp', null, null, null, 'F2026-0003', '123456789', '2026-04-03', 'facture'),
      ('{PJ7}', '{J}', '{J}/essai-vf6b-pj07.pdf', 'essai-vf6b-pj07.pdf', 'vente', 'a_valider', 'superpdp', null, null, null, 'F2026-0001', '123456789', '2025-12-31', 'facture'),
      ('{PJ8}', '{J}', '{J}/essai-vf6b-pj08.pdf', 'essai-vf6b-pj08.pdf', 'vente', 'a_valider', 'superpdp', null, null, null, 'F2026-0002', '987654321', '2026-04-02', 'facture'),
      ('{PJ9}', '{J}', '{J}/essai-vf6b-pj09.pdf', 'essai-vf6b-pj09.pdf', 'vente', 'a_valider', 'upload', null, null, null, null, null, null, null),
      ('{PJ10}', '{J}', '{J}/essai-vf6b-pj10.pdf', 'essai-vf6b-pj10.pdf', 'vente', 'a_valider', 'plateforme', 'pa.exemple.fr', 'vf6b-a', null, null, null, null, null),
      ('{PJ11}', '{J}', '{J}/essai-vf6b-pj11.pdf', 'essai-vf6b-pj11.pdf', 'vente', 'a_valider', 'superpdp', null, null, null, 'A2026-0001', '123456789', '2026-04-04', 'avoir'),
      ('{PJ12}', '{J}', '{J}/essai-vf6b-pj12.pdf', 'essai-vf6b-pj12.pdf', 'vente', 'a_valider', 'plateforme', 'pa.exemple.fr', 'vf6b-0', null, null, null, null, null),
      ('{PJ13}', '{J}', '{J}/essai-vf6b-pj13.pdf', 'essai-vf6b-pj13.pdf', 'vente', 'a_valider', 'superpdp', null, null, null, 'F2026-0006', '123456789', '2026-04-06', 'facture'),
      ('{PJ14}', '{J}', '{J}/essai-vf6b-pj14.pdf', 'essai-vf6b-pj14.pdf', 'vente', 'a_valider', 'plateforme', 'pa.exemple.fr', 'vf6b-2b', null, 'F2026-0002', '123456789', '2026-04-02', 'facture'),
      ('{PJ15}', '{J}', '{J}/essai-vf6b-pj15.pdf', 'essai-vf6b-pj15.pdf', 'vente', 'a_valider', 'superpdp', null, null, null, 'F2026-0005', '123456789', '2026-03-02', 'facture'),
      ('{PJ16}', '{J}', '{J}/essai-vf6b-pj16.pdf', 'essai-vf6b-pj16.pdf', 'vente', 'a_valider', 'superpdp', null, null, null, 'F2026-0002', '123456789', '2026-04-02', null),
      ('{PJ17}', '{J}', '{J}/essai-vf6b-pj17.pdf', 'essai-vf6b-pj17.pdf', 'vente', 'a_valider', 'superpdp', null, null, null, 'F2026-0001', '123456789', '2026-04-01', 'facture'),
      ('{PJ18}', '{J}', '{J}/essai-vf6b-pj18.pdf', 'essai-vf6b-pj18.pdf', 'vente', 'a_valider', 'superpdp', null, null, 6999, 'F2026-0004', '123456789', '2026-03-01', 'facture'),
      ('{PJ19}', '{J}', '{J}/essai-vf6b-pj19.pdf', 'essai-vf6b-pj19.pdf', 'vente', 'a_valider', 'superpdp', null, null, 7099, null, null, null, null),
      ('{PJ20}', '{J}', '{J}/essai-vf6b-pj20.pdf', 'essai-vf6b-pj20.pdf', 'vente', 'a_valider', 'plateforme', 'autre.exemple.fr', 'vf6b-1', null, null, null, null, null),
      ('{PJ21}', '{J}', '{J}/essai-vf6b-pj21.pdf', 'essai-vf6b-pj21.pdf', 'vente', 'a_valider', 'superpdp', null, null, 7005, null, null, null, null),
      ('{PJ22}', '{J}', '{J}/essai-vf6b-pj22.pdf', 'essai-vf6b-pj22.pdf', 'vente', 'a_valider', 'superpdp', null, null, 7013, 'F2026-0003', '123456789', '2026-04-03', 'avoir')$q$, '', ''],
    array['valeur', '230. le jumeau du pont, pièce par pièce : la facture qu''il prouve, ou les preuves qui se contredisent', 'postgres', $q$select string_agg(p.nom_fichier || '=' || (
        select case when count(*) = 0 then '-'
                    when bool_or(x.nature_contraire) then 'nature(' || string_agg(f.numero, '+' order by f.numero collate "C") filter (where x.nature_contraire) || ')'
                    when count(*) > 1 then 'plusieurs(' || string_agg(f.numero, '+' order by f.numero collate "C") || ')'
                    else min(f.numero) end
          from factures_du_pont(p) x join factures_emises f on f.id = x.facture_id), ' ' order by p.nom_fichier collate "C")
      from pieces p where p.dossier_id = '{J}' and p.nom_fichier like 'essai-vf6b-pj%'$q$, '',
      'essai-vf6b-pj01.pdf=F2026-0001 essai-vf6b-pj02.pdf=F2026-0002 essai-vf6b-pj03.pdf=F2026-0003 essai-vf6b-pj04.pdf=plusieurs(F2026-0001+F2026-0002) essai-vf6b-pj05.pdf=nature(F2026-0001) essai-vf6b-pj06.pdf=F2026-0003 essai-vf6b-pj07.pdf=- essai-vf6b-pj08.pdf=- essai-vf6b-pj09.pdf=- essai-vf6b-pj10.pdf=- essai-vf6b-pj11.pdf=A2026-0001 essai-vf6b-pj12.pdf=F2026-0004 essai-vf6b-pj13.pdf=- essai-vf6b-pj14.pdf=F2026-0002 essai-vf6b-pj15.pdf=F2026-0005 essai-vf6b-pj16.pdf=F2026-0002 essai-vf6b-pj17.pdf=F2026-0001 essai-vf6b-pj18.pdf=F2026-0004 essai-vf6b-pj19.pdf=- essai-vf6b-pj20.pdf=- essai-vf6b-pj21.pdf=- essai-vf6b-pj22.pdf=nature(F2026-0003)'],
    -- ══ LE JEU DU JUMEAU — FIN ══════

    array['jeu', 'les autres pièces de J, à valider', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc) values
      ('{PL}', '{J}', '{J}/essai-vf6b-pl.pdf', 'essai-vf6b-pl.pdf', 'vente', 'a_valider', '2026-04-10', 120),
      ('{PR}', '{J}', '{J}/essai-vf6b-pr.pdf', 'essai-vf6b-pr.pdf', 'vente', 'a_valider', '2026-04-10', 120),
      ('{PE}', '{J}', '{J}/essai-vf6b-pe.pdf', 'essai-vf6b-pe.pdf', 'vente', 'a_valider', '2026-04-10', 120),
      ('{PLT}', '{J}', '{J}/essai-vf6b-plt.pdf', 'essai-vf6b-plt.pdf', 'vente', 'a_valider', '2026-04-10', 120),
      ('{PX0}', '{J}', '{J}/essai-vf6b-px0.pdf', 'essai-vf6b-px0.pdf', 'vente', 'a_valider', '2026-03-01', 60),
      ('{PX0C}', '{J}', '{J}/essai-vf6b-px0c.pdf', 'essai-vf6b-px0c.pdf', 'vente', 'a_valider', '2026-03-01', 60),
      ('{PXS}', '{J}', '{J}/essai-vf6b-pxs.pdf', 'essai-vf6b-pxs.pdf', 'vente', 'a_valider', '2026-04-02', 60),
      ('{PFG}', '{J}', '{J}/essai-vf6b-pfg.pdf', 'essai-vf6b-pfg.pdf', 'vente', 'a_valider', '2026-02-10', 50),
      ('{PDV}', '{J}', '{J}/essai-vf6b-pdv.pdf', 'essai-vf6b-pdv.pdf', 'vente', 'a_valider', '2026-04-11', 40)$q$, '', ''],
    array['jeu', 'les mouvements de J : PL rapprochée, un virement groupé, un crédit libre, le virement mixte', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id, reglement_groupe) values
      ('{ML}', '{J}', '2026-04-12', 'ESSAI', 120, 'rapprochee', '{PL}', false),
      ('{MR}', '{J}', '2026-04-12', 'ESSAI', 120, 'rapprochee', null, true),
      ('{M1}', '{J}', '2026-04-13', 'ESSAI', 60, 'non_rapprochee', null, false),
      ('{MX}', '{J}', '2026-04-15', 'ESSAI', 100, 'non_rapprochee', null, false),
      ('{M2}', '{J}', '2026-04-14', 'ESSAI', 20, 'non_rapprochee', null, false)$q$, '', ''],
    array['jeu', 'PR réglée par une part, PE écrite, PLT lettrée', 'postgres', $q$insert into reglements_groupes (id, dossier_id, ligne_bancaire_id, piece_id, montant) values ('{RG1}', '{J}', '{MR}', '{PR}', 120);
      insert into ecritures_brouillon (id, dossier_id, piece_id, date, compte, libelle, montant, sens) values ('{E4}', '{J}', '{PE}', '2026-04-10', '706000', 'ESSAI PE', 120, 'credit');
      insert into lettrages_manuels (id, dossier_id, groupe, piece_id, compte) values ('{LT1}', '{J}', '{G1}', '{PLT}', '411000')$q$, '', ''],
    array['fait', '0. le jeu : PFD déclarée par la porte de la restauration ; PFG et PFD figées par une écriture validée (exercice 2026)', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc, vente_hors_des_factures) values
      ('{PFD}', '{J}', '{J}/essai-vf6b-pfd.pdf', 'essai-vf6b-pfd.pdf', 'vente', 'a_valider', '2026-02-11', 50, true);
      insert into ecritures_brouillon (id, dossier_id, piece_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values
      ('{E5}', '{J}', '{PFG}', '2026-02-10', '706000', 'ESSAI PFG', 50, 'credit', 'validee', '2026-10-01 10:00:00+00', 'VE', 11, 'ESSAI PFG', '2026-02-10', 'Prestations'),
      ('{E6}', '{J}', '{PFD}', '2026-02-11', '706000', 'ESSAI PFD', 50, 'credit', 'validee', '2026-10-01 10:00:00+00', 'VE', 12, 'ESSAI PFD', '2026-02-11', 'Prestations')$q$, 'OK', ''],
    array['fait', '0. le jeu : PX0 et PX0C exemplaires de FA0, PXS et PVB de FS2', 'chef', $q$select designer_exemplaire_facture('{J}', '{PX0}', '{FA0}'), designer_exemplaire_facture('{J}', '{PX0C}', '{FA0}'), designer_exemplaire_facture('{J}', '{PXS}', '{FS2}'), designer_exemplaire_facture('{J}', '{PVB}', '{FS2}')$q$, 'OK', ''],
    array['fait', '0. le jeu : PDV et PVC déclarées', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PDV}'), declarer_vente_hors_des_factures('{J}', '{PVC}')$q$, 'OK', ''],
    array['fait', '0. le jeu : PX0 validée, exemplaire de FA0', 'chef', $q$update pieces set statut = 'validee' where id = '{PX0}'$q$, 'OK', ''],
    array['fait', '0. le jeu : le virement mixte — MX justifie un encaissement de FS1 et un de FA0, et le cabinet le classe', 'chef', $q$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values
      ('{J}', '{FS1}', '2026-04-15', 50, 'virement', '{MX}', null, null), ('{J}', '{FA0}', '2026-04-15', 50, 'virement', '{MX}', null, null);
      insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values
      ('{EA1}', '{J}', '{FA1}', '2026-04-15', 20, 'virement', '{MX}', null, null), ('{EA3}', '{J}', '{FA1}', '2026-04-14', 20, 'virement', '{M2}', null, null);
      insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values
      ('{EA2}', '{J}', '{FA1}', '2026-04-16', -20, 'virement', null, '{EA1}', 'ESSAI : le virement n''était pas de ce client');
      select classer_mouvement_par_encaissements('{J}', '{MX}')$q$, 'OK', ''],
    -- L'état de J, tel que src/lib/exemplairesDesFactures.test.ts le rejoue : chaque pièce (sa nature, son statut, sa
    -- désignation, sa déclaration, ce que le pont prouve, ses liens — rapprochée, réglée par une part, écrite, lettrée —,
    -- l'exercice qui la fige), puis chaque facture (son statut, sa nature, son numéro, sa source, un encaissement compté
    -- par un mouvement classé).
    array['valeur', '231. l''état des pièces de J', 'postgres', $q$select string_agg(p.id || ':' || p.type_piece || ':' || p.statut || ':' || coalesce(p.facture_id::text, '-') || ':'
        || p.vente_hors_des_factures || ':'
        || (select case when count(*) = 0 then '-' when count(*) = 1 and not bool_or(x.nature_contraire) then min(x.facture_id::text) else 'contraire' end
              from factures_du_pont(p) x) || ':'
        || coalesce(nullif(concat(
             case when exists (select 1 from lignes_bancaires l where l.piece_id = p.id) then 'r' end,
             case when exists (select 1 from reglements_groupes r where r.piece_id = p.id) then 'g' end,
             case when exists (select 1 from ecritures_brouillon e where e.piece_id = p.id) then 'e' end,
             case when exists (select 1 from lettrages_manuels m where m.piece_id = p.id) then 'l' end), ''), '-') || ':'
        || coalesce(exercice_figeant_la_piece(p.id)::text, '-'), ' ' order by p.nom_fichier collate "C")
      from pieces p where p.dossier_id = '{J}'$q$, '',
      '{PAC}:achat:validee:-:false:-:-:- {PDV}:vente:a_valider:-:true:-:-:- {PE}:vente:a_valider:-:false:-:e:- {PFD}:vente:a_valider:-:true:-:e:2026 {PFG}:vente:a_valider:-:false:-:e:2026 {PJ1}:vente:a_valider:-:false:{FS1}:-:- {PJ2}:vente:a_valider:-:false:{FS2}:-:- {PJ3}:vente:a_valider:-:false:{FS3}:-:- {PJ4}:vente:a_valider:-:false:contraire:-:- {PJ5}:vente:a_valider:-:false:contraire:-:- {PJ6}:vente:a_valider:-:false:{FS3}:-:- {PJ7}:vente:a_valider:-:false:-:-:- {PJ8}:vente:a_valider:-:false:-:-:- {PJ9}:vente:a_valider:-:false:-:-:- {PJ10}:vente:a_valider:-:false:-:-:- {PJ11}:vente:a_valider:-:false:{FSA}:-:- {PJ12}:vente:a_valider:-:false:{FA0}:-:- {PJ13}:vente:a_valider:-:false:-:-:- {PJ14}:vente:a_valider:-:false:{FS2}:-:- {PJ15}:vente:a_valider:-:false:{FA1}:-:- {PJ16}:vente:a_valider:-:false:{FS2}:-:- {PJ17}:vente:a_valider:-:false:{FS1}:-:- {PJ18}:vente:a_valider:-:false:{FA0}:-:- {PJ19}:vente:a_valider:-:false:-:-:- {PJ20}:vente:a_valider:-:false:-:-:- {PJ21}:vente:a_valider:-:false:-:-:- {PJ22}:vente:a_valider:-:false:contraire:-:- {PL}:vente:a_valider:-:false:-:r:- {PLT}:vente:a_valider:-:false:-:l:- {PR}:vente:a_valider:-:false:-:g:- {PVA}:vente:validee:-:false:-:-:- {PVB}:vente:validee:{FS2}:false:-:-:- {PVC}:vente:validee:-:true:-:-:- {PX0}:vente:validee:{FA0}:false:-:-:- {PX0C}:vente:a_valider:{FA0}:false:-:-:- {PXS}:vente:a_valider:{FS2}:false:-:-:-'],
    array['valeur', '232. l''état des factures de J', 'postgres', $q$select string_agg(f.id || ':' || f.statut || ':' || f.type || ':' || coalesce(f.numero, '-') || ':' || f.source_de_la_vente || ':'
        || exists (select 1 from encaissements_factures e join lignes_bancaires l on l.id = e.ligne_bancaire_id
                    where e.facture_id = f.id and e.retire_le is null and l.encaissements_de_factures
                      and encaissement_justifie_son_mouvement(e.id)), ' ' order by f.id)
      from factures_emises f where f.dossier_id = '{J}'$q$, '',
      '{FS1}:validee:facture:F2026-0001:true:true {FS2}:validee:facture:F2026-0002:true:false {FS3}:validee:facture:F2026-0003:true:false {FSA}:validee:avoir:A2026-0001:true:false {FA0}:validee:facture:F2026-0004:false:true {FA1}:validee:facture:F2026-0005:false:false {FSN}:validee:facture:F2026-0006:true:false {FBJ}:brouillon:facture:-:false:false'],

    -- ══ 1 à 10. Qui désigne ══════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'permission denied for function designer_exemplaire_facture'],
    array['controle', '2. rattaché à rien : l''accès au dossier, avant de rien lire', 'inconnu', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3. client, un dossier qui n''est pas le sien', 'client', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4. client, son propre dossier, sans case', 'client_t', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '5. client, son propre dossier, avec « Ventes » et « Banque »', 'client_t_ventes', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '6. membre du cabinet affecté à un AUTRE dossier', 'membre_ailleurs', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '7. un dossier qui n''existe pas, même pour le super-administrateur', 'chef', $q$select designer_exemplaire_facture('{AUTRE}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '8. le membre affecté au dossier désigne', 'membre', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],
    array['controle', '9. un chef du cabinet qui n''est pas super-administrateur désigne', 'chef_simple', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],
    array['controle', '10. le chef du cabinet, super-administrateur, désigne', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],

    -- ══ 11 à 22. Les refus de la désignation, dans l'ordre de la fonction ══════════
    array['controle', '11. la pièce d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select designer_exemplaire_facture('{T}', '{PX}', '{F1}')$q$,
      'P0002', 'Pièce introuvable dans ce dossier.'],
    array['controle', '12. une pièce qui n''existe pas', 'chef', $q$select designer_exemplaire_facture('{T}', '{AUTRE}', '{F1}')$q$,
      'P0002', 'Pièce introuvable dans ce dossier.'],
    array['controle', '13. un achat n''est l''exemplaire d''aucune facture émise', 'chef', $q$select designer_exemplaire_facture('{T}', '{PACH}', '{F1}')$q$,
      '22023', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '14. une note de frais non plus', 'chef', $q$select designer_exemplaire_facture('{T}', '{PNDF}', '{F1}')$q$,
      '22023', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '15. une pièce « autre » non plus', 'chef', $q$select designer_exemplaire_facture('{T}', '{PAUT}', '{F1}')$q$,
      '22023', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '16. une pièce figée par une écriture validée ne se désigne plus', 'chef', $q$select designer_exemplaire_facture('{T}', '{PFIG}', '{F1}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2026 : sa désignation ne change plus.'],
    array['controle', '17. une pièce déjà exemplaire de cette facture', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV4}', '{F2}')$q$,
      '22023', 'Cette pièce est déjà l''exemplaire de la facture F2026-0002.'],
    array['controle', '18. une pièce déjà exemplaire d''une autre facture : la désignation se REMPLACE (VF6-Q1)', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV4}', '{F1}')$q$, 'OK', ''],
    array['controle', '19. la facture d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{FA}')$q$,
      'P0002', 'Facture introuvable dans ce dossier.'],
    array['controle', '20. une facture qui n''existe pas', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{AUTRE}')$q$,
      'P0002', 'Facture introuvable dans ce dossier.'],
    array['controle', '21. aucune facture', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', null)$q$,
      'P0002', 'Facture introuvable dans ce dossier.'],
    array['controle', '22. un brouillon n''a pas d''exemplaire', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{FB}')$q$,
      '22023', 'Seule une facture validée a un exemplaire : un brouillon n''est pas encore une facture émise.'],

    -- ══ 23 à 27. Deux refus ensemble : le premier dans l'ordre de la fonction ══════════
    array['controle', '23. un achat, avec un brouillon : la nature de la pièce d''abord', 'chef', $q$select designer_exemplaire_facture('{T}', '{PACH}', '{FB}')$q$,
      '22023', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '24. un achat figé : la nature de la pièce avant son gel', 'chef', $q$select designer_exemplaire_facture('{T}', '{PFIGA}', '{F1}')$q$,
      '22023', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '25. une pièce figée, déjà désignée : le gel avant la désignation', 'chef', $q$select designer_exemplaire_facture('{T}', '{PFIG2}', '{F2}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2026 : sa désignation ne change plus.'],
    array['controle', '26. une pièce déjà désignée, avec la facture d''un autre dossier : la facture introuvable (la désignation se remplacerait)', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV4}', '{FA}')$q$,
      'P0002', 'Facture introuvable dans ce dossier.'],
    array['controle', '27. la pièce d''un autre dossier, avec un brouillon : la pièce avant la facture', 'chef', $q$select designer_exemplaire_facture('{T}', '{PX}', '{FB}')$q$,
      'P0002', 'Pièce introuvable dans ce dossier.'],

    -- ══ 28 à 36. Ce qui s'écrit ══════════
    array['lecture', '28. la désignation s''écrit, et la fonction rend la pièce écrite', 'chef', $q$select (p).id || ' ' || (p).facture_id from (select designer_exemplaire_facture('{T}', '{PV1}', '{F1}') as p) x$q$,
      '', '{PV1} {F1}'],
    array['lecture', '29. elle seule : le reste de la pièce n''a pas bougé', 'chef', $q$select ((select to_jsonb(p) - 'facture_id' from pieces p where p.id = '{PV1}') = (select to_jsonb(d) - 'facture_id' from designer_exemplaire_facture('{T}', '{PV1}', '{F1}') d))::text$q$,
      '', 'true'],
    array['lecture', '30. plusieurs exemplaires d''une même facture : une pièce à valider, une validée, et celles du jeu', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}'); select designer_exemplaire_facture('{T}', '{PV2}', '{F1}'); select string_agg(nom_fichier, ',' order by nom_fichier collate "C") from pieces where facture_id = '{F1}'$q$,
      '', 'essai-vf1a-pfig2.pdf,essai-vf1a-pv1.pdf,essai-vf1a-pv2.pdf,essai-vf1a-pv5.pdf'],
    array['lecture', '31. un avoir a son exemplaire', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV3}', '{AV}'); select facture_id::text from pieces where id = '{PV3}'$q$,
      '', '{AV}'],
    array['lecture', '32. le réglage est retiré après l''appel : il ne laisse rien ouvert derrière lui', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}'); select '[' || coalesce(current_setting('jd.exemplaire_facture', true), 'nul') || ']'$q$,
      '', '[]'],
    array['controle', '33. après l''appel, une écriture directe de la même pièce est refusée', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}'); update pieces set facture_id = null where id = '{PV1}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['lecture', '34. défaire, puis désigner de nouveau, à une autre facture', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PV4}'); select designer_exemplaire_facture('{T}', '{PV4}', '{F1}'); select facture_id::text from pieces where id = '{PV4}'$q$,
      '', '{F1}'],
    array['lecture', '35. défaire : la désignation, et elle seule — la fonction rend la pièce écrite', 'chef', $q$select ((select to_jsonb(p) - 'facture_id' from pieces p where p.id = '{PV5}') = (select to_jsonb(d) - 'facture_id' from defaire_exemplaire_facture('{T}', '{PV5}') d) and (select facture_id from pieces p where p.id = '{PV5}') is not null)::text$q$,
      '', 'true'],
    array['lecture', '36. défaire : la pièce ne désigne plus rien', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PV5}'); select coalesce((select facture_id::text from pieces where id = '{PV5}'), 'nulle')$q$,
      '', 'nulle'],
    array['lecture', '37. remplacer (VF6-Q1) : la pièce désigne la nouvelle facture, et le journal garde les deux gestes', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV4}', '{F1}'); select (select facture_id::text from pieces where id = '{PV4}') || '|' || string_agg(geste || '=' || facture_id::text, ',' order by geste collate "C", facture_id::text collate "C") from designations_des_pieces where piece_id = '{PV4}'$q$,
      '', '{F1}|designation={F1},designation={F2},retrait_designation={F2}'],

    -- ══ 40 à 52. Qui défait, et les refus, dans l'ordre de la fonction ══════════
    array['controle', '40. anonyme : pas le droit d''appeler', 'anon', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'permission denied for function defaire_exemplaire_facture'],
    array['controle', '41. rattaché à rien', 'inconnu', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '42. client, un dossier qui n''est pas le sien', 'client', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '43. client, son propre dossier, sans case', 'client_t', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '44. client, son propre dossier, avec « Ventes » et « Banque »', 'client_t_ventes', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '45. membre du cabinet affecté à un AUTRE dossier', 'membre_ailleurs', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '46. un dossier qui n''existe pas', 'chef', $q$select defaire_exemplaire_facture('{AUTRE}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '47. la pièce d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PX}')$q$,
      'P0002', 'Pièce introuvable dans ce dossier.'],
    array['controle', '48. une pièce que rien ne désigne', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PV1}')$q$,
      '22023', 'Cette pièce n''est l''exemplaire d''aucune facture.'],
    array['controle', '49. une pièce désignée, figée ensuite par une écriture validée', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PFIG2}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2026 : sa désignation ne change plus.'],
    array['controle', '50. une pièce figée que rien ne désigne : la désignation avant le gel', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PFIG}')$q$,
      '22023', 'Cette pièce n''est l''exemplaire d''aucune facture.'],
    array['controle', '51. le membre affecté au dossier défait', 'membre', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$, 'OK', ''],
    array['controle', '52. un chef qui n''est pas super-administrateur défait', 'chef_simple', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$, 'OK', ''],

    -- ══ 60 à 82. Ce que la garde tient sans les fonctions ══════════
    array['controle', '60. le cabinet ne pose pas la désignation par sa policy', 'chef', $q$update pieces set facture_id = '{F1}' where id = '{PV1}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '61. ni ne la retire', 'chef', $q$update pieces set facture_id = null where id = '{PV4}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '62. ni ne la change d''une facture à une autre', 'chef', $q$update pieces set facture_id = '{F1}' where id = '{PV4}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '63. le membre affecté non plus', 'membre', $q$update pieces set facture_id = '{F1}' where id = '{PV1}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '64. le propriétaire non plus — ni, à plus forte raison, le rôle des Edge Functions', 'postgres', $q$update pieces set facture_id = '{F1}' where id = '{PV1}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '65. le client qui dépose une pièce dans son dossier ne la dit pas exemplaire d''une facture', 'client_t', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F1}')$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '66. son dépôt ordinaire passe toujours', 'client_t', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente')$q$, 'OK', ''],
    array['controle', '67. le client « Ventes » non plus', 'client_t_ventes', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F1}')$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['lecture', '68. le client ne met à jour aucune pièce de son dossier — la désignation pas davantage', 'client_t', $q$with m as (update pieces set facture_id = '{F1}' where id = '{PV1}' returning 1) select count(*)::text from m$q$,
      '', '0'],
    array['controle', '69. un chef qui n''est pas super-administrateur n''insère pas une pièce désignée', 'chef_simple', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F1}')$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '70. le propriétaire non plus : une Edge Function n''importe pas une pièce désignée', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F1}')$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '71. la restauration par le super-administrateur réinsère une pièce désignée', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F1}')$q$, 'OK', ''],
    array['controle', '72. jamais d''une facture d''un autre dossier', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{FA}')$q$,
      '23514', 'Une pièce n''est l''exemplaire que d''une facture de son dossier.'],
    array['controle', '73. ni d''une facture qui n''existe pas', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{AUTRE}')$q$,
      '23514', 'Une pièce n''est l''exemplaire que d''une facture de son dossier.'],
    array['controle', '74. ni d''un brouillon', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{FB}')$q$,
      '23514', 'Seule une facture validée a un exemplaire.'],
    array['controle', '75. ni sur une pièce qui n''est pas une vente', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'achat', '{F1}')$q$,
      '23514', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '76. une pièce désignée ne change pas de dossier', 'chef', $q$update pieces set dossier_id = '{A}' where id = '{PV4}'$q$,
      '23514', 'Cette pièce est l''exemplaire de la facture F2026-0002 : elle ne change plus de dossier — défaire d''abord la désignation.'],
    array['controle', '77. une pièce désignée reste une vente', 'chef', $q$update pieces set type_piece = 'achat' where id = '{PV4}'$q$,
      '23514', 'Cette pièce est l''exemplaire de la facture F2026-0002 : elle reste une pièce de vente — défaire d''abord la désignation.'],
    array['controle', '78. une pièce que rien ne désigne change de nature et de dossier', 'chef', $q$update pieces set type_piece = 'achat' where id = '{PV1}'; update pieces set dossier_id = '{A}' where id = '{PDEP}'$q$, 'OK', ''],
    array['controle', '79. le reste d''une pièce désignée se modifie comme avant, la désignation réécrite à l''identique comprise', 'chef', $q$update pieces set date_piece = '2026-03-16', montant_ttc = 61, statut = 'validee', facture_id = facture_id, type_piece = 'vente', dossier_id = dossier_id where id = '{PV4}'$q$, 'OK', ''],
    array['controle', '80. le réglage d''une autre pièce n''ouvre rien', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PV1}', true); update pieces set facture_id = null where id = '{PV4}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '81. le gel tient la désignation même sous un réglage forgé : la garde des pièces figées', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PFIG2}', true); update pieces set facture_id = null where id = '{PFIG2}'$q$,
      '23514', 'Cette pièce porte une écriture validée de l''exercice 2026 : ses montants, sa date et sa catégorie ne changent plus.'],
    array['controle', '82. une pièce figée et désignée : la garde de la désignation parle la première', 'chef', $q$update pieces set facture_id = null where id = '{PFIG2}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],

    -- ══ 90 à 95. Qui lit la désignation ══════════
    array['lecture', '90. le client du dossier la lit, comme toute la ligne de ses pièces', 'client_t', $q$select coalesce((select facture_id::text from pieces where id = '{PV4}'), 'aucune ligne')$q$,
      '', '{F2}'],
    array['lecture', '91. le client d''un autre dossier ne voit aucune pièce de celui-ci', 'client', $q$select count(*)::text from pieces where dossier_id = '{T}'$q$, '', '0'],
    array['lecture', '92. le compte rattaché à rien non plus', 'inconnu', $q$select count(*)::text from pieces where dossier_id = '{T}'$q$, '', '0'],
    array['lecture', '93. l''anonyme non plus', 'anon', $q$select count(*)::text from pieces where dossier_id = '{T}'$q$, '', '0'],
    array['lecture', '94. le membre affecté au dossier la lit', 'membre', $q$select coalesce((select facture_id::text from pieces where id = '{PV4}'), 'aucune ligne')$q$,
      '', '{F2}'],
    array['lecture', '95. le membre affecté à un autre dossier n''en voit rien', 'membre_ailleurs', $q$select count(*)::text from pieces where dossier_id = '{T}'$q$, '', '0'],

    -- ══ 140 à 149. Les mutations : chacune doit MORDRE ══════════
    array['controle', '140. MUTATION — le contrôle 4 joué sous le chef : il doit passer', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],
    array['controle', '141. MUTATION — le contrôle 6 affecté au BON dossier : il doit passer', 'membre', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],
    array['controle', '142. MUTATION — le contrôle 65 joué par le super-administrateur : l''insertion doit passer', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F2}')$q$, 'OK', ''],
    array['controle', '143. MUTATION — le contrôle 64 sous le réglage de SA pièce : il doit passer (seule la fonction le pose)', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PV1}', true); update pieces set facture_id = '{F1}' where id = '{PV1}'$q$, 'OK', ''],
    array['lecture', '144. MUTATION — le contrôle 91 joué par le client du dossier : il doit voir ses pièces', 'client_t', $q$select (count(*) > 0)::text from pieces where dossier_id = '{T}'$q$, '', 'true'],
    array['controle', '145. MUTATION — le contrôle 11 dans le dossier de la pièce : il doit passer', 'chef', $q$select designer_exemplaire_facture('{A}', '{PX}', '{FA}')$q$, 'OK', ''],
    array['controle', '146. MUTATION — le contrôle 22 sur une facture validée : il doit passer', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F2}')$q$, 'OK', ''],
    array['controle', '147. MUTATION — le contrôle 16 sur une pièce que rien ne fige : il doit passer', 'chef', $q$select designer_exemplaire_facture('{T}', '{PDEP}', '{F1}')$q$, 'OK', ''],
    array['controle', '148. MUTATION — le contrôle 48 sur une pièce désignée : il doit passer', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PV4}')$q$, 'OK', ''],
    array['controle', '149. MUTATION — le contrôle 76 sur une pièce que rien ne désigne : il doit passer', 'chef', $q$update pieces set dossier_id = '{A}' where id = '{PDEP}'$q$, 'OK', ''],

    -- ══ 150 à 158. Ce que le catalogue dit ══════════
    array['valeur', '150. la colonne : facultative, sans valeur par défaut', 'postgres', $q$select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || (not a.attnotnull)::text || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',') from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.pieces'::regclass and a.attname = 'facture_id' and not a.attisdropped$q$, '',
      'facture_id uuid true -'],
    array['valeur', '151. la clé : vers les factures émises, sans action à la suppression ni à la mise à jour, immédiate', 'postgres', $q$select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid) || ' ' || c.confdeltype::text || c.confupdtype::text || ' ' || c.condeferrable::text, ',') from pg_constraint c where c.conrelid = 'public.pieces'::regclass and c.contype = 'f' and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.pieces'::regclass and attname = 'facture_id')]::int2[]$q$, '',
      'pieces_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES factures_emises(id) aa false'],
    array['valeur', '152. l''index partiel', 'postgres', $q$select string_agg(pg_get_indexdef(i.indexrelid), ' | ') from pg_index i where i.indrelid = 'public.pieces'::regclass and pg_get_indexdef(i.indexrelid) like '%(facture_id)%'$q$, '',
      'CREATE INDEX pieces_facture_idx ON public.pieces USING btree (facture_id) WHERE (facture_id IS NOT NULL)'],
    array['valeur', '153. le déclencheur, actif : l''insertion, et la mise à jour de la désignation, de la déclaration, du dossier et de la nature', 'postgres', $q$select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' | ') from pg_trigger t where t.tgrelid = 'public.pieces'::regclass and not t.tgisinternal and t.tgfoid = 'public.garder_exemplaire_facture()'::regprocedure$q$, '',
      'CREATE TRIGGER pieces_exemplaire_de_facture BEFORE INSERT OR UPDATE OF facture_id, vente_hors_des_factures, dossier_id, type_piece ON public.pieces FOR EACH ROW EXECUTE FUNCTION garder_exemplaire_facture() O'],
    array['valeur', '154. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values
      ('designer_exemplaire_facture', '(uuid, uuid, uuid)'), ('defaire_exemplaire_facture', '(uuid, uuid)'), ('garder_exemplaire_facture', '()')) as t(f, a)$q$, '',
      'defaire_exemplaire_facture:false:true,designer_exemplaire_facture:false:true,garder_exemplaire_facture:false:false'],
    array['valeur', '155. ce qui contourne la RLS et ce qui ne la contourne pas, le chemin fixé, ce que chacune rend', 'postgres', $q$select string_agg(proname || ':' || prosecdef || ':' || coalesce(array_to_string(proconfig, ','), '-') || ':' || pg_get_function_result(oid), ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('designer_exemplaire_facture', 'defaire_exemplaire_facture', 'garder_exemplaire_facture')$q$, '',
      'defaire_exemplaire_facture:true:search_path=public:pieces,designer_exemplaire_facture:true:search_path=public:pieces,garder_exemplaire_facture:false:search_path=public:trigger'],
    array['valeur', '156. les policies de pieces sont celles d''avant la migration (l''empreinte de identiteFacturesRecues.sql)', 'postgres', $q$select count(*) || ' ' || md5(string_agg(p.policyname || ' ' || p.roles::text || ' ' || p.cmd || ' ' || coalesce(p.qual, '-') || ' ' || coalesce(p.with_check, '-'), ' | ' order by p.policyname)) from pg_policies p where p.schemaname = 'public' and p.tablename = 'pieces'$q$, '',
      '4 95217063cdf4065ac70bf19b67c62fda'],
    array['valeur', '157. le réglage n''est nommé que par les fonctions de la désignation et de la déclaration, et par les deux gardes qui le lisent', 'postgres', $q$select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%jd.exemplaire_facture%'$q$, '',
      'declarer_vente_hors_des_factures,defaire_exemplaire_facture,designer_exemplaire_facture,garder_designation_des_pieces,garder_exemplaire_facture,retirer_declaration_hors_des_factures'],
    array['valeur', '158. la garde des pièces figées compare toujours la ligne entière : la désignation et la déclaration y sont comprises', 'postgres', $q$select (prosrc like '%(to_jsonb(new) - array[''notes'', ''sous_dossier_id'', ''confiance'', ''updated_at''])%')::text from pg_proc where oid = 'public.garder_piece_validee()'::regprocedure$q$, '',
      'true'],

    -- ══ 200 à 229. G3 : la pièce de vente d'un dossier basculé ══════════
    array['controle', '200. née validée dans J : refusée au chef qui n''est pas super-administrateur', 'chef_simple', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values ('{PN2}', '{J}', '{J}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'vente', 'validee')$q$,
      '23514', 'Une pièce de vente naît à valider dans un dossier dont les factures sont la source de leurs ventes.'],
    array['controle', '201. … au propriétaire', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values ('{PN2}', '{J}', '{J}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'vente', 'validee')$q$,
      '23514', 'Une pièce de vente naît à valider dans un dossier dont les factures sont la source de leurs ventes.'],
    array['controle', '202. … au rôle des Edge Functions', 'service', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values ('{PN2}', '{J}', '{J}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'vente', 'validee')$q$,
      '23514', 'Une pièce de vente naît à valider dans un dossier dont les factures sont la source de leurs ventes.'],
    array['controle', '203. la restauration du super-administrateur la réinsère validée', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values ('{PN2}', '{J}', '{J}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'vente', 'validee')$q$, 'OK', ''],
    array['controle', '204. née à valider, elle passe', 'chef_simple', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values ('{PN2}', '{J}', '{J}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'vente', 'a_valider')$q$, 'OK', ''],
    array['controle', '205. née validée dans un dossier qui n''a pas basculé, elle passe', 'chef_simple', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values ('{PN2}', '{T}', '{T}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'vente', 'validee')$q$, 'OK', ''],
    array['controle', '206. un achat né validé dans J passe : G3 ne juge que les ventes', 'chef_simple', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values ('{PN2}', '{J}', '{J}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'achat', 'validee')$q$, 'OK', ''],
    array['controle', '210. validée sans marque, ni pont : désignez-la ou déclarez-la', 'chef', $q$update pieces set statut = 'validee' where id = '{PJ9}'$q$,
      '23514', 'Désignez la pièce « essai-vf6b-pj09.pdf » exemplaire de sa facture, ou déclarez-la vente hors des factures de l''application, avant de la valider : les factures de ce dossier sont la source de leurs ventes.'],
    array['controle', '211. validée, le pont la rattache à F2026-0001 qu''elle ne désigne pas : la facture nommée', 'chef', $q$update pieces set statut = 'validee' where id = '{PJ1}'$q$,
      '23514', 'La pièce « essai-vf6b-pj01.pdf » est la facture F2026-0001 émise dans l''application, revenue comme pièce : désignez-la exemplaire de cette facture avant de la valider.'],
    array['controle', '212. … désignée à une AUTRE facture (posée sous le réglage, la fonction le refusant) : la facture du pont nommée', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PJ1}', true); update pieces set facture_id = '{FS2}' where id = '{PJ1}'; select set_config('jd.exemplaire_facture', '', true); update pieces set statut = 'validee' where id = '{PJ1}'$q$,
      '23514', 'La pièce « essai-vf6b-pj01.pdf » est la facture F2026-0001 émise dans l''application, revenue comme pièce : désignez-la exemplaire de cette facture avant de la valider.'],
    array['controle', '213. … déclarée (posée sous le réglage) : de même', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PJ1}', true); update pieces set vente_hors_des_factures = true where id = '{PJ1}'; select set_config('jd.exemplaire_facture', '', true); update pieces set statut = 'validee' where id = '{PJ1}'$q$,
      '23514', 'La pièce « essai-vf6b-pj01.pdf » est la facture F2026-0001 émise dans l''application, revenue comme pièce : désignez-la exemplaire de cette facture avant de la valider.'],
    array['controle', '214. … désignée à la facture du pont : elle se valide', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ1}', '{FS1}'); update pieces set statut = 'validee' where id = '{PJ1}'$q$, 'OK', ''],
    array['controle', '215. validée, ses preuves se contredisent (plusieurs factures) : vérifiez-la (VF6-Q5)', 'chef', $q$update pieces set statut = 'validee' where id = '{PJ4}'$q$,
      '23514', 'Les preuves de la pièce « essai-vf6b-pj04.pdf » se contredisent — elle porte plusieurs factures émises, ou une autre nature que la facture que son numéro désigne : vérifiez-la sur la plateforme avant de la valider.'],
    array['controle', '216. … même désignée à l''une d''elles (posée sous le réglage)', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PJ4}', true); update pieces set facture_id = '{FS1}' where id = '{PJ4}'; select set_config('jd.exemplaire_facture', '', true); update pieces set statut = 'validee' where id = '{PJ4}'$q$,
      '23514', 'Les preuves de la pièce « essai-vf6b-pj04.pdf » se contredisent — elle porte plusieurs factures émises, ou une autre nature que la facture que son numéro désigne : vérifiez-la sur la plateforme avant de la valider.'],
    array['controle', '217. validée, son identité dit l''autre nature : vérifiez-la', 'chef', $q$update pieces set statut = 'validee' where id = '{PJ5}'$q$,
      '23514', 'Les preuves de la pièce « essai-vf6b-pj05.pdf » se contredisent — elle porte plusieurs factures émises, ou une autre nature que la facture que son numéro désigne : vérifiez-la sur la plateforme avant de la valider.'],
    array['controle', '218. un PDF désigné se valide', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ9}', '{FS2}'); update pieces set statut = 'validee' where id = '{PJ9}'$q$, 'OK', ''],
    array['controle', '219. un PDF déclaré se valide', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PJ9}'); update pieces set statut = 'validee' where id = '{PJ9}'$q$, 'OK', ''],
    array['controle', '220. le pont la rattache à une facture d''AVANT la bascule : elle aussi se désigne', 'chef', $q$update pieces set statut = 'validee' where id = '{PJ15}'$q$,
      '23514', 'La pièce « essai-vf6b-pj15.pdf » est la facture F2026-0005 émise dans l''application, revenue comme pièce : désignez-la exemplaire de cette facture avant de la valider.'],
    array['controle', '221. … désignée à elle, elle se valide', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ15}', '{FA1}'); update pieces set statut = 'validee' where id = '{PJ15}'$q$, 'OK', ''],
    array['controle', '222. une pièce validée avant la bascule reste ce qu''elle est : sa date et son montant changent (EC3-Q1)', 'chef', $q$update pieces set date_piece = '2026-01-15', montant_ttc = 31 where id = '{PVA}'$q$, 'OK', ''],
    array['controle', '223. … et rien n''est jugé qui ne change pas : son statut et sa nature réécrits à l''identique', 'chef', $q$update pieces set statut = 'validee', type_piece = 'vente', dossier_id = dossier_id where id = '{PVA}'$q$, 'OK', ''],
    array['controle', '224. … remise à valider puis validée de nouveau, elle passe : une marque, d''abord', 'chef', $q$update pieces set statut = 'a_valider' where id = '{PVA}'; update pieces set statut = 'validee' where id = '{PVA}'$q$,
      '23514', 'Désignez la pièce « essai-vf6b-pva.pdf » exemplaire de sa facture, ou déclarez-la vente hors des factures de l''application, avant de la valider : les factures de ce dossier sont la source de leurs ventes.'],
    array['controle', '225. un achat validé qui devient une vente : jugé', 'chef', $q$update pieces set type_piece = 'vente' where id = '{PAC}'$q$,
      '23514', 'Désignez la pièce « essai-vf6b-pac.pdf » exemplaire de sa facture, ou déclarez-la vente hors des factures de l''application, avant de la valider : les factures de ce dossier sont la source de leurs ventes.'],
    array['controle', '226. une vente validée qui arrive dans J d''un autre dossier : jugée', 'chef', $q$update pieces set dossier_id = '{J}' where id = '{PV2}'$q$,
      '23514', 'Désignez la pièce « essai-vf1a-pv2.pdf » exemplaire de sa facture, ou déclarez-la vente hors des factures de l''application, avant de la valider : les factures de ce dossier sont la source de leurs ventes.'],
    array['controle', '227. une vente validée qui quitte J pour un dossier qui n''a pas basculé : rien n''est jugé', 'chef', $q$update pieces set dossier_id = '{T}' where id = '{PVA}'$q$, 'OK', ''],
    array['controle', '228. un lot : une seule pièce sans marque fait refuser l''instruction entière', 'chef', $q$update pieces set statut = 'validee' where id in ('{PDV}', '{PJ9}')$q$,
      '23514', 'Désignez la pièce « essai-vf6b-pj09.pdf » exemplaire de sa facture, ou déclarez-la vente hors des factures de l''application, avant de la valider : les factures de ce dossier sont la source de leurs ventes.'],
    array['controle', '229. une pièce déclarée se valide', 'chef', $q$update pieces set statut = 'validee' where id = '{PDV}'$q$, 'OK', ''],

    -- ══ 240 à 252. G4 : l'exemplaire d'une facture source ne justifie rien ══════════
    array['controle', '240. rapproché par le cabinet : refusé', 'chef', $q$update lignes_bancaires set piece_id = '{PXS}', statut = 'rapprochee' where id = '{M1}'$q$,
      '23514', 'La pièce « essai-vf6b-pxs.pdf » est l''exemplaire de la facture F2026-0002, source de sa vente : la vente se règle et s''écrit par sa facture et ses encaissements.'],
    array['controle', '241. … à l''insertion par le propriétaire', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id) values ('{MN}', '{J}', '2026-04-20', 'ESSAI', 60, 'rapprochee', '{PXS}')$q$,
      '23514', 'La pièce « essai-vf6b-pxs.pdf » est l''exemplaire de la facture F2026-0002, source de sa vente : la vente se règle et s''écrit par sa facture et ses encaissements.'],
    array['controle', '242. … par le rôle des Edge Functions', 'service', $q$update lignes_bancaires set piece_id = '{PXS}', statut = 'rapprochee' where id = '{M1}'$q$,
      '23514', 'La pièce « essai-vf6b-pxs.pdf » est l''exemplaire de la facture F2026-0002, source de sa vente : la vente se règle et s''écrit par sa facture et ses encaissements.'],
    array['controle', '243. … ni par la restauration du super-administrateur : un état gardé ne la heurte jamais', 'chef', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id) values ('{MN}', '{J}', '2026-04-20', 'ESSAI', 60, 'rapprochee', '{PXS}')$q$,
      '23514', 'La pièce « essai-vf6b-pxs.pdf » est l''exemplaire de la facture F2026-0002, source de sa vente : la vente se règle et s''écrit par sa facture et ses encaissements.'],
    array['controle', '244. réglé par une part d''un virement groupé : refusé', 'chef', $q$insert into reglements_groupes (id, dossier_id, ligne_bancaire_id, piece_id, montant) values ('{RGN}', '{J}', '{MR}', '{PXS}', 60)$q$,
      '23514', 'La pièce « essai-vf6b-pxs.pdf » est l''exemplaire de la facture F2026-0002, source de sa vente : la vente se règle et s''écrit par sa facture et ses encaissements.'],
    array['controle', '245. écrit : refusé', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, piece_id, date, compte, libelle, montant, sens) values ('{EN}', '{J}', '{PXS}', '2026-04-20', '706000', 'ESSAI', 60, 'credit')$q$,
      '23514', 'La pièce « essai-vf6b-pxs.pdf » est l''exemplaire de la facture F2026-0002, source de sa vente : la vente se règle et s''écrit par sa facture et ses encaissements.'],
    array['controle', '246. lettré : refusé', 'chef', $q$insert into lettrages_manuels (id, dossier_id, groupe, piece_id, compte) values ('{LTN}', '{J}', '{G1}', '{PXS}', '411000')$q$,
      '23514', 'La pièce « essai-vf6b-pxs.pdf » est l''exemplaire de la facture F2026-0002, source de sa vente : la vente se règle et s''écrit par sa facture et ses encaissements.'],
    array['controle', '247. une écriture qui passe d''une pièce à l''exemplaire : refusée', 'chef', $q$update ecritures_brouillon set piece_id = '{PXS}' where id = '{E4}'$q$,
      '23514', 'La pièce « essai-vf6b-pxs.pdf » est l''exemplaire de la facture F2026-0002, source de sa vente : la vente se règle et s''écrit par sa facture et ses encaissements.'],
    array['controle', '248. l''exemplaire d''une facture qui n''est pas source se rapproche comme hier', 'chef', $q$update lignes_bancaires set piece_id = '{PX0C}', statut = 'rapprochee' where id = '{M1}'$q$, 'OK', ''],
    array['controle', '249. … et s''écrit (la banque que VF5h lui écrit sur un virement mixte)', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, piece_id, date, compte, libelle, montant, sens) values ('{EN}', '{J}', '{PX0}', '2026-04-15', '512000', 'ESSAI', 50, 'debit')$q$, 'OK', ''],
    array['controle', '250. une pièce que rien ne désigne se rapproche', 'chef', $q$update lignes_bancaires set piece_id = '{PJ9}', statut = 'rapprochee' where id = '{M1}'$q$, 'OK', ''],
    array['controle', '251. une mise à jour qui ne touche pas au lien passe', 'chef', $q$update lignes_bancaires set libelle = 'ESSAI 2' where id = '{ML}'$q$, 'OK', ''],
    array['controle', '252. … ni le lien réécrit à l''identique', 'chef', $q$update lignes_bancaires set piece_id = piece_id where id = '{ML}'$q$, 'OK', ''],

    -- ══ 260 à 265. L'autre côté : ce qui lie une pièce se retire avant de la désigner à une facture source ══════════
    array['controle', '260. une pièce rapprochée', 'chef', $q$select designer_exemplaire_facture('{J}', '{PL}', '{FS2}')$q$,
      '22023', 'Cette pièce est rapprochée d''un mouvement du relevé : l''exemplaire de la facture F2026-0002, source de sa vente, ne justifie aucun mouvement — annuler d''abord ce rapprochement.'],
    array['controle', '261. une pièce réglée par une part d''un virement groupé', 'chef', $q$select designer_exemplaire_facture('{J}', '{PR}', '{FS2}')$q$,
      '22023', 'Cette pièce est réglée par une part d''un virement groupé : l''exemplaire de la facture F2026-0002, source de sa vente, n''en reçoit aucune — retirer d''abord cette part.'],
    array['controle', '262. une pièce écrite', 'chef', $q$select designer_exemplaire_facture('{J}', '{PE}', '{FS2}')$q$,
      '22023', 'Cette pièce porte une écriture : l''exemplaire de la facture F2026-0002, source de sa vente, ne s''écrit pas — retirer d''abord cette écriture.'],
    array['controle', '263. une pièce lettrée', 'chef', $q$select designer_exemplaire_facture('{J}', '{PLT}', '{FS2}')$q$,
      '22023', 'Cette pièce est lettrée : l''exemplaire de la facture F2026-0002, source de sa vente, ne se lettre pas — défaire d''abord ce lettrage.'],
    array['controle', '264. à une facture qui n''est pas source, la pièce rapprochée se désigne', 'chef', $q$select designer_exemplaire_facture('{J}', '{PL}', '{FA1}')$q$, 'OK', ''],
    array['controle', '265. rapprochée ET écrite : le rapprochement d''abord', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, piece_id, date, compte, libelle, montant, sens) values ('{EN}', '{J}', '{PL}', '2026-04-12', '706000', 'ESSAI', 120, 'credit'); select designer_exemplaire_facture('{J}', '{PL}', '{FS2}')$q$,
      '22023', 'Cette pièce est rapprochée d''un mouvement du relevé : l''exemplaire de la facture F2026-0002, source de sa vente, ne justifie aucun mouvement — annuler d''abord ce rapprochement.'],

    -- ══ 270 à 279. La désignation dans un dossier basculé ══════════
    array['controle', '270. le pont la rattache à une AUTRE facture', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ1}', '{FS2}')$q$,
      '22023', 'Cette pièce est la facture F2026-0001 émise dans l''application, revenue comme pièce : elle n''est l''exemplaire que de celle-ci.'],
    array['controle', '271. à la facture du pont, elle se désigne', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ1}', '{FS1}')$q$, 'OK', ''],
    array['controle', '272. ses preuves se contredisent (plusieurs factures) : vérifiez-la', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ4}', '{FS1}')$q$,
      '22023', 'Les preuves de cette pièce se contredisent — elle porte plusieurs factures émises, ou une autre nature que la facture que son numéro désigne : vérifiez-la sur la plateforme avant de la désigner.'],
    array['controle', '273. … ou la nature', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ5}', '{FS1}')$q$,
      '22023', 'Les preuves de cette pièce se contredisent — elle porte plusieurs factures émises, ou une autre nature que la facture que son numéro désigne : vérifiez-la sur la plateforme avant de la désigner.'],
    array['controle', '274. l''avoir que le pont prouve', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ11}', '{FSA}')$q$, 'OK', ''],
    array['controle', '275. la facture d''avant la bascule que le pont prouve', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ15}', '{FA1}')$q$, 'OK', ''],
    array['controle', '276. le rang 5, resserré : déjà l''exemplaire de CETTE facture', 'chef', $q$select designer_exemplaire_facture('{J}', '{PXS}', '{FS2}')$q$,
      '22023', 'Cette pièce est déjà l''exemplaire de la facture F2026-0002.'],
    array['lecture', '277. remplacer une désignation : la pièce désigne l''autre facture', 'chef', $q$select designer_exemplaire_facture('{J}', '{PXS}', '{FS3}'); select facture_id || '|' || vente_hors_des_factures from pieces where id = '{PXS}'$q$,
      '', '{FS3}|false'],
    array['lecture', '278. remplacer une déclaration : la pièce désigne la facture, et n''est plus déclarée', 'chef', $q$select designer_exemplaire_facture('{J}', '{PDV}', '{FS2}'); select facture_id || '|' || vente_hors_des_factures from pieces where id = '{PDV}'$q$,
      '', '{FS2}|false'],
    array['lecture', '279. le journal du remplacement : le retrait de ce qu''elle était, puis la désignation', 'chef', $q$select designer_exemplaire_facture('{J}', '{PDV}', '{FS2}'); select designer_exemplaire_facture('{J}', '{PXS}', '{FS3}'); select string_agg(p.nom_fichier || ':' || d.geste || '=' || coalesce(d.facture_id::text, '-'), ',' order by p.nom_fichier collate "C", d.geste collate "C", d.facture_id::text collate "C") from designations_des_pieces d join pieces p on p.id = d.piece_id where d.piece_id in ('{PDV}', '{PXS}')$q$,
      '', 'essai-vf6b-pdv.pdf:declaration=-,essai-vf6b-pdv.pdf:designation={FS2},essai-vf6b-pdv.pdf:retrait_declaration=-,essai-vf6b-pxs.pdf:designation={FS2},essai-vf6b-pxs.pdf:designation={FS3},essai-vf6b-pxs.pdf:retrait_designation={FS2}'],

    -- ══ 285 à 289. VF5H-Q1 : le virement mixte classé retient la désignation de sa facture d'avant ══════════
    array['controle', '280. hors d''un dossier basculé, le pont ne retient pas la désignation : PT1, que son identité rattache à F1, se désigne à F2', 'chef', $q$select designer_exemplaire_facture('{T}', '{PT1}', '{F2}')$q$, 'OK', ''],
    array['controle', '281. la facture SOURCE dont un encaissement est compté par le virement mixte ne retient pas la désignation (rang 15 : une facture qui n''est pas source)', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ13}', '{FS1}')$q$, 'OK', ''],
    array['controle', '282. … ni celle qui la quitte (rang 14)', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ13}', '{FS1}'); select designer_exemplaire_facture('{J}', '{PJ13}', '{FS2}')$q$, 'OK', ''],
    array['controle', '283. une facture qui n''est pas source, dont un encaissement cite un mouvement non classé et l''autre est contre-passé sans mouvement : rien ne retient sa désignation, ni son remplacement (rangs 15 et 14)', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ13}', '{FA1}'); select designer_exemplaire_facture('{J}', '{PJ13}', '{FS2}')$q$, 'OK', ''],
    array['controle', '285. remplacer la désignation de la facture qu''il compte : refusé', 'chef', $q$select designer_exemplaire_facture('{J}', '{PX0C}', '{FA1}')$q$,
      '22023', 'Un encaissement de la facture F2026-0004 est compté par un mouvement classé par ses encaissements, qui date son exemplaire : retirer d''abord ce classement.'],
    array['controle', '286. désigner un exemplaire de plus à cette facture : refusé', 'chef', $q$select designer_exemplaire_facture('{J}', '{PL}', '{FA0}')$q$,
      '22023', 'Un encaissement de la facture F2026-0004 est compté par un mouvement classé par ses encaissements, qui date son exemplaire : retirer d''abord ce classement.'],
    array['controle', '287. défaire : refusé', 'chef', $q$select defaire_exemplaire_facture('{J}', '{PX0C}')$q$,
      '22023', 'Un encaissement de la facture F2026-0004 est compté par un mouvement classé par ses encaissements, qui date son exemplaire : retirer d''abord ce classement.'],
    array['controle', '288. déclarer la pièce qui la désigne : refusé', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PX0C}')$q$,
      '22023', 'Un encaissement de la facture F2026-0004 est compté par un mouvement classé par ses encaissements, qui date son exemplaire : retirer d''abord ce classement.'],
    array['controle', '289. le pont avant le virement mixte : la facture d''avant qu''il prouve ne se désigne pas sous le classement', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ12}', '{FA0}')$q$,
      '22023', 'Un encaissement de la facture F2026-0004 est compté par un mouvement classé par ses encaissements, qui date son exemplaire : retirer d''abord ce classement.'],

    -- ══ 290 à 294. Défaire dans un dossier basculé ══════════
    array['controle', '290. une pièce validée de J ne perd pas sa désignation (VF6-Q1)', 'chef', $q$select defaire_exemplaire_facture('{J}', '{PVB}')$q$,
      '22023', 'Cette pièce est validée dans un dossier dont les factures sont la source de leurs ventes : elle ne perd pas sa désignation — désignez l''autre facture, ou déclarez-la vente hors des factures de l''application.'],
    array['controle', '291. à valider, elle la perd', 'chef', $q$select defaire_exemplaire_facture('{J}', '{PXS}')$q$, 'OK', ''],
    array['controle', '292. validée et comptée par le virement mixte : la validation d''abord', 'chef', $q$select defaire_exemplaire_facture('{J}', '{PX0}')$q$,
      '22023', 'Cette pièce est validée dans un dossier dont les factures sont la source de leurs ventes : elle ne perd pas sa désignation — désignez l''autre facture, ou déclarez-la vente hors des factures de l''application.'],
    array['controle', '293. une pièce que rien ne désigne : la désignation d''abord', 'chef', $q$select defaire_exemplaire_facture('{J}', '{PVC}')$q$,
      '22023', 'Cette pièce n''est l''exemplaire d''aucune facture.'],
    array['lecture', '294. défaire écrit son retrait au journal', 'chef', $q$select defaire_exemplaire_facture('{J}', '{PXS}'); select string_agg(geste || '=' || facture_id::text, ',' order by geste collate "C") from designations_des_pieces where piece_id = '{PXS}'$q$,
      '', 'designation={FS2},retrait_designation={FS2}'],

    -- ══ 300 à 318. Déclarer une vente hors des factures de l'application ══════════
    array['controle', '295. défaire : ni la facture source du virement mixte, ni une facture qui n''est pas source dont aucun encaissement n''est compté par un mouvement classé, ne retiennent rien (rang 6)', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ13}', '{FS1}'); select defaire_exemplaire_facture('{J}', '{PJ13}'); select designer_exemplaire_facture('{J}', '{PJ13}', '{FA1}'); select defaire_exemplaire_facture('{J}', '{PJ13}')$q$, 'OK', ''],
    array['controle', '300. anonyme : pas le droit d''appeler', 'anon', $q$select declarer_vente_hors_des_factures('{T}', '{PV1}')$q$,
      '42501', 'permission denied for function declarer_vente_hors_des_factures'],
    array['controle', '301. rattaché à rien', 'inconnu', $q$select declarer_vente_hors_des_factures('{T}', '{PV1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '302. client, un dossier qui n''est pas le sien', 'client', $q$select declarer_vente_hors_des_factures('{T}', '{PV1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '303. client, son propre dossier, sans case', 'client_t', $q$select declarer_vente_hors_des_factures('{T}', '{PV1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '304. client, son propre dossier, avec « Ventes » et « Banque »', 'client_t_ventes', $q$select declarer_vente_hors_des_factures('{T}', '{PV1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '305. membre du cabinet affecté à un AUTRE dossier', 'membre_ailleurs', $q$select declarer_vente_hors_des_factures('{T}', '{PV1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '306. un dossier qui n''existe pas', 'chef', $q$select declarer_vente_hors_des_factures('{AUTRE}', '{PV1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '307. le membre affecté au dossier passe l''accès : T n''a pas basculé', 'membre', $q$select declarer_vente_hors_des_factures('{T}', '{PV1}')$q$,
      '22023', 'Une vente ne se déclare hors des factures de l''application que dans un dossier dont les factures sont la source de leurs ventes.'],
    array['controle', '308. un chef qui n''est pas super-administrateur aussi', 'chef_simple', $q$select declarer_vente_hors_des_factures('{T}', '{PV1}')$q$,
      '22023', 'Une vente ne se déclare hors des factures de l''application que dans un dossier dont les factures sont la source de leurs ventes.'],
    array['controle', '309. la pièce d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PV1}')$q$,
      'P0002', 'Pièce introuvable dans ce dossier.'],
    array['controle', '310. un achat ne se déclare pas', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PAC}')$q$,
      '22023', 'Seule une pièce de vente se déclare vente hors des factures de l''application.'],
    array['controle', '311. une pièce figée', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PFG}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2026 : sa déclaration ne change plus.'],
    array['controle', '312. déjà déclarée', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PDV}')$q$,
      '22023', 'Cette pièce est déjà déclarée vente hors des factures de l''application.'],
    array['controle', '313. le pont la rattache à une facture : elle s''en désigne l''exemplaire', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PJ1}')$q$,
      '22023', 'Cette pièce est la facture F2026-0001 émise dans l''application, revenue comme pièce : elle se désigne exemplaire de cette facture, et ne se déclare pas hors des factures de l''application.'],
    array['controle', '314. ses preuves se contredisent', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PJ4}')$q$,
      '22023', 'Les preuves de cette pièce se contredisent — elle porte plusieurs factures émises, ou une autre nature que la facture que son numéro désigne : vérifiez-la sur la plateforme avant de la déclarer.'],
    array['controle', '315. … ou la nature', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PJ5}')$q$,
      '22023', 'Les preuves de cette pièce se contredisent — elle porte plusieurs factures émises, ou une autre nature que la facture que son numéro désigne : vérifiez-la sur la plateforme avant de la déclarer.'],
    array['lecture', '316. elle se déclare : la déclaration, et elle seule, et une ligne au journal', 'chef', $q$select set_config('essai.seule', ((select to_jsonb(p) - 'vente_hors_des_factures' from pieces p where p.id = '{PJ9}') = (select to_jsonb(d) - 'vente_hors_des_factures' from declarer_vente_hors_des_factures('{J}', '{PJ9}') d))::text, true); select current_setting('essai.seule') || '|' || (select vente_hors_des_factures from pieces where id = '{PJ9}') || '|' || (select string_agg(geste, ',') from designations_des_pieces where piece_id = '{PJ9}')$q$,
      '', 'true|true|declaration'],
    array['lecture', '317. la désignation en cours se remplace (VF6-Q1) : deux lignes au journal', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PXS}'); select coalesce(facture_id::text, '-') || '|' || vente_hors_des_factures || '|' || (select string_agg(geste || '=' || coalesce(facture_id::text, '-'), ',' order by geste collate "C") from designations_des_pieces where piece_id = '{PXS}') from pieces where id = '{PXS}'$q$,
      '', '-|true|declaration=-,designation={FS2},retrait_designation={FS2}'],
    array['lecture', '318. le réglage est retiré après l''appel', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PJ9}'); select '[' || coalesce(current_setting('jd.exemplaire_facture', true), 'nul') || ']'$q$,
      '', '[]'],

    -- ══ 320 à 327. Retirer la déclaration ══════════
    array['controle', '319. déclarer : de même, ni la facture source du virement mixte, ni FA1 ne retiennent rien (rang 9)', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ13}', '{FS1}'); select declarer_vente_hors_des_factures('{J}', '{PJ13}'); select designer_exemplaire_facture('{J}', '{PJ13}', '{FA1}'); select declarer_vente_hors_des_factures('{J}', '{PJ13}')$q$, 'OK', ''],
    array['controle', '320. anonyme : pas le droit d''appeler', 'anon', $q$select retirer_declaration_hors_des_factures('{T}', '{PV1}')$q$,
      '42501', 'permission denied for function retirer_declaration_hors_des_factures'],
    array['controle', '321. client, son propre dossier, avec « Ventes » et « Banque »', 'client_t_ventes', $q$select retirer_declaration_hors_des_factures('{T}', '{PV1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '322. membre du cabinet affecté à un AUTRE dossier', 'membre_ailleurs', $q$select retirer_declaration_hors_des_factures('{T}', '{PV1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '323. la pièce d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select retirer_declaration_hors_des_factures('{J}', '{PV1}')$q$,
      'P0002', 'Pièce introuvable dans ce dossier.'],
    array['controle', '324. une pièce qui n''est pas déclarée', 'chef', $q$select retirer_declaration_hors_des_factures('{J}', '{PJ9}')$q$,
      '22023', 'Cette pièce n''est pas déclarée vente hors des factures de l''application.'],
    array['controle', '325. une pièce validée de J ne perd pas sa déclaration', 'chef', $q$select retirer_declaration_hors_des_factures('{J}', '{PVC}')$q$,
      '22023', 'Cette pièce est validée dans un dossier dont les factures sont la source de leurs ventes : elle ne perd pas sa déclaration — désignez-la exemplaire de sa facture, ou remettez-la d''abord à valider.'],
    array['controle', '326. une pièce déclarée, figée', 'chef', $q$select retirer_declaration_hors_des_factures('{J}', '{PFD}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2026 : sa déclaration ne change plus.'],
    array['lecture', '327. elle se retire, et le journal le garde', 'chef', $q$select retirer_declaration_hors_des_factures('{J}', '{PDV}'); select vente_hors_des_factures || '|' || (select string_agg(geste, ',' order by geste collate "C") from designations_des_pieces where piece_id = '{PDV}') from pieces where id = '{PDV}'$q$,
      '', 'false|declaration,retrait_declaration'],

    -- ══ 330 à 345. La garde, qui apprend la déclaration ══════════
    array['controle', '330. le cabinet ne pose pas la déclaration par sa policy', 'chef', $q$update pieces set vente_hors_des_factures = true where id = '{PJ9}'$q$,
      '42501', 'Une pièce ne se déclare vente hors des factures de l''application, et ne cesse de l''être, que par l''application.'],
    array['controle', '331. ni ne la retire', 'chef', $q$update pieces set vente_hors_des_factures = false where id = '{PDV}'$q$,
      '42501', 'Une pièce ne se déclare vente hors des factures de l''application, et ne cesse de l''être, que par l''application.'],
    array['controle', '332. le propriétaire non plus', 'postgres', $q$update pieces set vente_hors_des_factures = true where id = '{PJ9}'$q$,
      '42501', 'Une pièce ne se déclare vente hors des factures de l''application, et ne cesse de l''être, que par l''application.'],
    array['controle', '333. ni le rôle des Edge Functions', 'service', $q$update pieces set vente_hors_des_factures = true where id = '{PJ9}'$q$,
      '42501', 'Une pièce ne se déclare vente hors des factures de l''application, et ne cesse de l''être, que par l''application.'],
    array['controle', '334. le client qui dépose une pièce ne la déclare pas (VF6-Q2)', 'client_t', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, vente_hors_des_factures) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', true)$q$,
      '42501', 'Une pièce ne se déclare vente hors des factures de l''application, et ne cesse de l''être, que par l''application.'],
    array['controle', '335. le client « Ventes » non plus', 'client_t_ventes', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, vente_hors_des_factures) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', true)$q$,
      '42501', 'Une pièce ne se déclare vente hors des factures de l''application, et ne cesse de l''être, que par l''application.'],
    array['controle', '336. un chef qui n''est pas super-administrateur n''insère pas une pièce déclarée', 'chef_simple', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, vente_hors_des_factures) values ('{PN2}', '{J}', '{J}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'vente', true)$q$,
      '42501', 'Une pièce ne se déclare vente hors des factures de l''application, et ne cesse de l''être, que par l''application.'],
    array['controle', '337. la restauration du super-administrateur réinsère une pièce déclarée', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, vente_hors_des_factures) values ('{PN2}', '{J}', '{J}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'vente', true)$q$, 'OK', ''],
    array['controle', '338. … jamais sur une pièce qui n''est pas une vente', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, vente_hors_des_factures) values ('{PN2}', '{J}', '{J}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'achat', true)$q$,
      '23514', 'Seule une pièce de vente se déclare vente hors des factures de l''application.'],
    array['controle', '339. … ni désignée et déclarée à la fois', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id, vente_hors_des_factures) values ('{PN2}', '{J}', '{J}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'vente', '{FS2}', true)$q$,
      '23514', 'Une pièce n''est pas à la fois l''exemplaire d''une facture et une vente hors des factures de l''application.'],
    array['controle', '340. une pièce déclarée ne change pas de dossier', 'chef', $q$update pieces set dossier_id = '{T}' where id = '{PDV}'$q$,
      '23514', 'Cette pièce est déclarée vente hors des factures de l''application : elle ne change plus de dossier — retirer d''abord la déclaration.'],
    array['controle', '341. une pièce déclarée reste une vente', 'chef', $q$update pieces set type_piece = 'achat' where id = '{PDV}'$q$,
      '23514', 'Cette pièce est déclarée vente hors des factures de l''application : elle reste une pièce de vente — retirer d''abord la déclaration.'],
    array['controle', '342. le reste d''une pièce déclarée se modifie comme avant, la déclaration réécrite à l''identique comprise', 'chef', $q$update pieces set date_piece = '2026-04-21', montant_ttc = 41, vente_hors_des_factures = vente_hors_des_factures, type_piece = 'vente', dossier_id = dossier_id where id = '{PDV}'$q$, 'OK', ''],
    array['controle', '343. le réglage d''une autre pièce n''ouvre rien', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PJ1}', true); update pieces set vente_hors_des_factures = true where id = '{PJ9}'$q$,
      '42501', 'Une pièce ne se déclare vente hors des factures de l''application, et ne cesse de l''être, que par l''application.'],
    array['controle', '344. … sous le réglage de sa pièce, la garde la refuse sur un achat (la contrainte se tient derrière elle)', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PJ9}', true); update pieces set vente_hors_des_factures = true, type_piece = 'achat' where id = '{PJ9}'$q$,
      '23514', 'Seule une pièce de vente se déclare vente hors des factures de l''application.'],
    array['lecture', '345. le client ne met à jour aucune pièce de son dossier — la déclaration pas davantage', 'client_t', $q$with m as (update pieces set vente_hors_des_factures = true where id = '{PV1}' returning 1) select count(*)::text from m$q$,
      '', '0'],

    -- ══ 350 à 366. Le journal ══════════
    array['lecture', '350. le jeu l''a écrit : quatre désignations et deux déclarations dans J, par le chef, à l''instant de l''essai', 'chef', $q$select string_agg(geste || '=' || n, ',' order by geste collate "C") || '|' || (select count(*) from designations_des_pieces where dossier_id = '{J}' and (auteur_id <> '{CHEF}' or fait_le <> now())) from (select geste, count(*) as n from designations_des_pieces where dossier_id = '{J}' group by geste) x$q$,
      '', 'declaration=2,designation=4|0'],
    array['lecture', '351. … et trois désignations dans T', 'chef', $q$select string_agg(p.nom_fichier || ':' || d.geste || '=' || d.facture_id::text, ',' order by p.nom_fichier collate "C") from designations_des_pieces d join pieces p on p.id = d.piece_id where d.dossier_id = '{T}'$q$,
      '', 'essai-vf1a-pfig2.pdf:designation={F1},essai-vf1a-pv4.pdf:designation={F2},essai-vf1a-pv5.pdf:designation={F1}'],
    array['lecture', '352. le client du dossier n''en voit rien (VF6-Q3)', 'client_t', $q$select count(*)::text from designations_des_pieces$q$, '', '0'],
    array['lecture', '353. le client « Ventes » et « Banque » non plus', 'client_t_ventes', $q$select count(*)::text from designations_des_pieces$q$, '', '0'],
    array['lecture', '354. le membre affecté à T lit le journal de T, et rien de J', 'membre', $q$select (select count(*) from designations_des_pieces where dossier_id = '{T}') || '|' || (select count(*) from designations_des_pieces where dossier_id = '{J}')$q$,
      '', '3|0'],
    array['lecture', '355. le membre affecté à un autre dossier n''en voit rien', 'membre_ailleurs', $q$select count(*)::text from designations_des_pieces where dossier_id in ('{T}', '{J}')$q$, '', '0'],
    array['lecture', '356. l''anonyme non plus', 'anon', $q$select count(*)::text from designations_des_pieces$q$, '', '0'],
    array['controle', '357. un chef qui n''est pas super-administrateur n''y écrit pas : la garde d''abord', 'chef_simple', $q$insert into designations_des_pieces (id, dossier_id, piece_id, geste, facture_id, auteur_id) values ('{JN}', '{J}', '{PJ9}', 'declaration', null, '{CHEF}')$q$,
      '42501', 'Le journal des désignations ne s''écrit que par les fonctions qui désignent et déclarent une pièce.'],
    array['controle', '357b. … et, sous un réglage forgé, la policy derrière elle', 'chef_simple', $q$select set_config('jd.exemplaire_facture', '{PJ9}', true); insert into designations_des_pieces (id, dossier_id, piece_id, geste, facture_id, auteur_id) values ('{JN}', '{J}', '{PJ9}', 'declaration', null, '{CHEF}')$q$,
      '42501', 'new row violates row-level security policy for table "designations_des_pieces"'],
    array['controle', '358. le client non plus', 'client_t', $q$insert into designations_des_pieces (id, dossier_id, piece_id, geste, facture_id, auteur_id) values ('{JN}', '{T}', '{PV1}', 'declaration', null, '{CHEF}')$q$,
      '42501', 'Le journal des désignations ne s''écrit que par les fonctions qui désignent et déclarent une pièce.'],
    array['controle', '359. le propriétaire non plus, hors des fonctions', 'postgres', $q$insert into designations_des_pieces (id, dossier_id, piece_id, geste, facture_id, auteur_id) values ('{JN}', '{J}', '{PJ9}', 'declaration', null, '{CHEF}')$q$,
      '42501', 'Le journal des désignations ne s''écrit que par les fonctions qui désignent et déclarent une pièce.'],
    array['controle', '360. la restauration du super-administrateur y réinsère une ligne', 'chef', $q$insert into designations_des_pieces (id, dossier_id, piece_id, geste, facture_id, auteur_id) values ('{JN}', '{J}', '{PJ9}', 'declaration', null, '{CHEF}')$q$, 'OK', ''],
    array['controle', '361. … jamais la pièce d''un autre dossier', 'chef', $q$insert into designations_des_pieces (id, dossier_id, piece_id, geste, facture_id, auteur_id) values ('{JN}', '{J}', '{PV1}', 'declaration', null, '{CHEF}')$q$,
      '23514', 'Une ligne du journal des désignations cite une pièce et une facture de son dossier.'],
    array['controle', '362. … ni la facture d''un autre dossier', 'chef', $q$insert into designations_des_pieces (id, dossier_id, piece_id, geste, facture_id, auteur_id) values ('{JN}', '{J}', '{PJ9}', 'designation', '{F1}', '{CHEF}')$q$,
      '23514', 'Une ligne du journal des désignations cite une pièce et une facture de son dossier.'],
    array['controle', '363. … ni une désignation sans facture', 'chef', $q$insert into designations_des_pieces (id, dossier_id, piece_id, geste, facture_id, auteur_id) values ('{JN}', '{J}', '{PJ9}', 'designation', null, '{CHEF}')$q$,
      '23514', '%designations_des_pieces_facture%'],
    array['controle', '364. rien ne la réécrit, le propriétaire compris', 'postgres', $q$update designations_des_pieces set geste = geste where dossier_id = '{J}'$q$,
      '23514', 'Le journal des désignations ne se réécrit pas : une ligne ne part qu''avec sa pièce ou son dossier.'],
    array['lecture', '365. le cabinet n''en réécrit aucune ligne (aucune policy de mise à jour)', 'chef', $q$with u as (update designations_des_pieces set geste = geste where dossier_id = '{J}' returning 1) select count(*)::text from u$q$,
      '', '0'],
    array['controle', '366. le réglage de SA pièce ouvre le journal — seules les fonctions le posent', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PJ9}', true); insert into designations_des_pieces (id, dossier_id, piece_id, geste, facture_id, auteur_id) values ('{JN}', '{J}', '{PJ9}', 'declaration', null, '{CHEF}')$q$, 'OK', ''],

    -- ══ 370 à 380. Ce que le catalogue dit de la jumelle inversée ══════════
    array['valeur', '370. la déclaration : obligatoire, fausse par défaut', 'postgres', $q$select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || (not a.attnotnull)::text || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',') from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.pieces'::regclass and a.attname = 'vente_hors_des_factures' and not a.attisdropped$q$, '',
      'vente_hors_des_factures boolean false false'],
    array['valeur', '371. sa contrainte : sur une vente que rien ne désigne', 'postgres', $q$select string_agg(conname || ' ' || pg_get_constraintdef(oid), ',') from pg_constraint where conrelid = 'public.pieces'::regclass and conname = 'pieces_vente_hors_des_factures'$q$, '',
      'pieces_vente_hors_des_factures CHECK (((NOT vente_hors_des_factures) OR ((type_piece = ''vente''::text) AND (facture_id IS NULL))))'],
    array['valeur', '372. G3 et G4 : leurs déclencheurs, actifs', 'postgres', $q$select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' | ' order by t.tgname collate "C") from pg_trigger t where not t.tgisinternal and t.tgfoid in ('public.garder_vente_d_un_dossier_bascule()'::regprocedure, 'public.garder_exemplaire_d_une_source()'::regprocedure)$q$, '',
      'CREATE TRIGGER ecritures_brouillon_sans_exemplaire_d_une_source BEFORE INSERT OR UPDATE OF piece_id ON public.ecritures_brouillon FOR EACH ROW EXECUTE FUNCTION garder_exemplaire_d_une_source() O | CREATE TRIGGER lettrages_manuels_sans_exemplaire_d_une_source BEFORE INSERT OR UPDATE OF piece_id ON public.lettrages_manuels FOR EACH ROW EXECUTE FUNCTION garder_exemplaire_d_une_source() O | CREATE TRIGGER lignes_bancaires_sans_exemplaire_d_une_source BEFORE INSERT OR UPDATE OF piece_id ON public.lignes_bancaires FOR EACH ROW EXECUTE FUNCTION garder_exemplaire_d_une_source() O | CREATE TRIGGER pieces_vente_d_un_dossier_bascule BEFORE INSERT OR UPDATE OF statut, type_piece, dossier_id, facture_id, vente_hors_des_factures ON public.pieces FOR EACH ROW EXECUTE FUNCTION garder_vente_d_un_dossier_bascule() O | CREATE TRIGGER reglements_groupes_sans_exemplaire_d_une_source BEFORE INSERT OR UPDATE OF piece_id ON public.reglements_groupes FOR EACH ROW EXECUTE FUNCTION garder_exemplaire_d_une_source() O'],
    array['valeur', '373. le journal : ses colonnes', 'postgres', $q$select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || (not a.attnotnull)::text || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ', ' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.designations_des_pieces'::regclass and a.attnum > 0 and not a.attisdropped$q$, '',
      'id uuid false gen_random_uuid(), dossier_id uuid false -, piece_id uuid false -, geste text false -, facture_id uuid true -, auteur_id uuid false -, fait_le timestamp with time zone false now()'],
    array['valeur', '374. … ses contraintes : la pièce et le dossier en cascade, la facture sans action, le geste, la facture d''une désignation', 'postgres', $q$select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname collate "C") from pg_constraint where conrelid = 'public.designations_des_pieces'::regclass$q$, '',
      'designations_des_pieces_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE | designations_des_pieces_facture CHECK (((facture_id IS NOT NULL) = (geste = ANY (ARRAY[''designation''::text, ''retrait_designation''::text])))) | designations_des_pieces_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES factures_emises(id) | designations_des_pieces_geste CHECK ((geste = ANY (ARRAY[''designation''::text, ''retrait_designation''::text, ''declaration''::text, ''retrait_declaration''::text]))) | designations_des_pieces_piece_id_fkey FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE | designations_des_pieces_pkey PRIMARY KEY (id)'],
    array['valeur', '375. … sa RLS et ses deux policies : la lecture au cabinet, l''insertion de restauration', 'postgres', $q$select (select relrowsecurity::text from pg_class where oid = 'public.designations_des_pieces'::regclass) || ' | ' || string_agg(policyname || ' ' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '-') || ' ' || coalesce(with_check, '-'), ' | ' order by policyname collate "C") from pg_policies where schemaname = 'public' and tablename = 'designations_des_pieces'$q$, '',
      'true | designations_des_pieces_lecture SELECT {authenticated} admin_du_dossier(dossier_id) - | designations_des_pieces_restauration INSERT {authenticated} - is_super_admin()'],
    array['valeur', '376. les droits d''exécution (anonyme, connecté) des fonctions neuves', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values
      ('declarer_vente_hors_des_factures', '(uuid, uuid)'), ('retirer_declaration_hors_des_factures', '(uuid, uuid)'), ('factures_du_pont', '(public.pieces)'),
      ('garder_vente_d_un_dossier_bascule', '()'), ('garder_exemplaire_d_une_source', '()'), ('garder_designation_des_pieces', '()')) as t(f, a)$q$, '',
      'declarer_vente_hors_des_factures:false:true,factures_du_pont:false:false,garder_designation_des_pieces:false:false,garder_exemplaire_d_une_source:false:false,garder_vente_d_un_dossier_bascule:false:false,retirer_declaration_hors_des_factures:false:true'],
    array['valeur', '377. ce qui contourne la RLS, le chemin fixé, ce que chacune rend', 'postgres', $q$select string_agg(proname || ':' || prosecdef || ':' || coalesce(array_to_string(proconfig, ','), '-') || ':' || pg_get_function_result(oid), ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('declarer_vente_hors_des_factures', 'retirer_declaration_hors_des_factures', 'factures_du_pont', 'garder_vente_d_un_dossier_bascule', 'garder_exemplaire_d_une_source', 'garder_designation_des_pieces')$q$, '',
      'declarer_vente_hors_des_factures:true:search_path=public:pieces,factures_du_pont:false:search_path=public:TABLE(facture_id uuid, nature_contraire boolean),garder_designation_des_pieces:false:search_path=public:trigger,garder_exemplaire_d_une_source:true:search_path=public:trigger,garder_vente_d_un_dossier_bascule:true:search_path=public:trigger,retirer_declaration_hors_des_factures:true:search_path=public:pieces'],
    array['valeur', '378. le journal n''est nommé, en écriture, que par les quatre fonctions', 'postgres', $q$select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%insert into public.designations_des_pieces%'$q$, '',
      'declarer_vente_hors_des_factures,defaire_exemplaire_facture,designer_exemplaire_facture,retirer_declaration_hors_des_factures'],
    array['valeur', '379. la colonne de la déclaration n''est écrite que par les trois fonctions qui la posent ou la retirent', 'postgres', $q$select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~ 'vente_hors_des_factures = (true|false)'$q$, '',
      'declarer_vente_hors_des_factures,designer_exemplaire_facture,retirer_declaration_hors_des_factures'],

    -- ══ 390 à 398. Les mutations de la jumelle inversée : chacune doit MORDRE ══════════
    array['controle', '390. MUTATION — le contrôle 200 joué par le super-administrateur : la restauration doit passer', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values ('{PN2}', '{J}', '{J}/essai-vf6b-pn2.pdf', 'essai-vf6b-pn2.pdf', 'vente', 'validee')$q$, 'OK', ''],
    array['controle', '391. MUTATION — le contrôle 210 sur une pièce désignée : elle doit se valider', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ9}', '{FS3}'); update pieces set statut = 'validee' where id = '{PJ9}'$q$, 'OK', ''],
    array['controle', '392. MUTATION — le contrôle 240 sur l''exemplaire d''une facture qui n''est pas source : il doit passer', 'chef', $q$update lignes_bancaires set piece_id = '{PX0C}', statut = 'rapprochee' where id = '{M1}'$q$, 'OK', ''],
    array['controle', '393. MUTATION — le contrôle 270 à la facture du pont : il doit passer', 'chef', $q$select designer_exemplaire_facture('{J}', '{PJ1}', '{FS1}')$q$, 'OK', ''],
    array['controle', '394. MUTATION — le contrôle 290 sur une pièce à valider : il doit passer', 'chef', $q$select defaire_exemplaire_facture('{J}', '{PXS}')$q$, 'OK', ''],
    array['controle', '395. MUTATION — le contrôle 307 dans J : il doit passer', 'chef', $q$select declarer_vente_hors_des_factures('{J}', '{PJ9}')$q$, 'OK', ''],
    array['controle', '396. MUTATION — le contrôle 285 son classement retiré : il doit passer', 'chef', $q$select retirer_classement_par_encaissements('{J}', '{MX}'); select designer_exemplaire_facture('{J}', '{PX0C}', '{FA1}')$q$, 'OK', ''],
    array['controle', '397. MUTATION — le contrôle 330 sous le réglage de SA pièce : il doit passer (seule la fonction le pose)', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PJ9}', true); update pieces set vente_hors_des_factures = true where id = '{PJ9}'$q$, 'OK', ''],
    array['lecture', '398. MUTATION — le contrôle 352 joué par le chef : il doit voir le journal', 'chef', $q$select (count(*) > 0)::text from designations_des_pieces where dossier_id = '{J}'$q$, '', 'true'],

    -- ══ 400 à 459. LE GEL DES DÉSIGNATIONS (étape VF7e, migration gel_des_designations ; VF7-Q1, option B) ══════════
    -- Deux dossiers jetables de plus : DG, qui bascule, et DN, qui ne bascule pas. Leurs factures, et les écritures validées
    -- qui figent trois pièces de DG et une de DN, entrent par la porte de la restauration AVANT leurs exercices validés
    -- (2024 et 2025 dans DG, 2025 dans DN). Chaque geste se joue avant (400 à 405), entre les deux — les écritures de la
    -- pièce validées, pas encore l'exercice de sa facture (406 à 408) —, puis après (410 à 443).
    array['jeu', 'VF7e : deux dossiers jetables, DG et DN', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures) values
      ('{DG}', 'ESSAI EXEMPLAIRES DG', '{CAB}', 'tresorerie', '455000', false), ('{DN}', 'ESSAI EXEMPLAIRES DN', '{CAB}', 'tresorerie', '455000', false)$q$, '', ''],
    array['fait', '0. le jeu (VF7e) : DG bascule, par la policy des dossiers', 'chef', $q$update dossiers set ventes_par_les_factures = true where id = '{DG}'$q$, 'OK', ''],
    array['fait', '0. le jeu (VF7e) : les factures de DG — sources, et une d''avant la bascule — et celles de DN, par la porte de la restauration', 'chef', $q$insert into factures_emises (id, dossier_id, numero, statut, type, facture_origine_id, date_emission, tiers_nom, montant_ht, montant_tva, montant_ttc, emetteur_siret, validated_at, source_de_la_vente) values
      ('{FG23}', '{DG}', 'F2023-0101', 'validee', 'facture', null, '2023-03-01', 'CLIENT ESSAI', 100, 20, 120, '12345678900012', '2023-03-01 10:00:00+00', true),
      ('{FG24}', '{DG}', 'F2024-0101', 'validee', 'facture', null, '2024-06-01', 'CLIENT ESSAI', 100, 20, 120, '12345678900012', '2024-06-01 10:00:00+00', true),
      ('{FG25}', '{DG}', 'F2025-0101', 'validee', 'facture', null, '2025-12-15', 'CLIENT ESSAI', 100, 20, 120, '12345678900012', '2025-12-15 10:00:00+00', true),
      ('{FGAV}', '{DG}', 'A2025-0101', 'validee', 'avoir', '{FG25}', '2025-12-20', 'CLIENT ESSAI', -100, -20, -120, '12345678900012', '2025-12-20 10:00:00+00', true),
      ('{FG26}', '{DG}', 'F2026-0101', 'validee', 'facture', null, '2026-01-10', 'CLIENT ESSAI', 100, 20, 120, '12345678900012', '2026-01-10 10:00:00+00', true),
      ('{FGP}', '{DG}', 'F2025-0102', 'validee', 'facture', null, '2025-11-01', 'CLIENT ESSAI', 50, 10, 60, '12345678900012', '2025-11-01 10:00:00+00', false),
      ('{FN25}', '{DN}', 'F2025-0201', 'validee', 'facture', null, '2025-06-01', 'CLIENT ESSAI', 50, 10, 60, '98765432100019', '2025-06-01 10:00:00+00', false),
      ('{FN26}', '{DN}', 'F2026-0201', 'validee', 'facture', null, '2026-02-01', 'CLIENT ESSAI', 50, 10, 60, '98765432100019', '2026-02-01 10:00:00+00', false)$q$, 'OK', ''],
    array['jeu', 'VF7e : les pièces de vente de DG et de DN, à valider', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc) values
      ('{PG2}', '{DG}', '{DG}/essai-vf7e-pg2.pdf', 'essai-vf7e-pg2.pdf', 'vente', 'a_valider', '2024-06-01', 120),
      ('{PG3}', '{DG}', '{DG}/essai-vf7e-pg3.pdf', 'essai-vf7e-pg3.pdf', 'vente', 'a_valider', '2026-01-10', 120),
      ('{PG4}', '{DG}', '{DG}/essai-vf7e-pg4.pdf', 'essai-vf7e-pg4.pdf', 'vente', 'a_valider', '2025-12-16', 80),
      ('{PG5}', '{DG}', '{DG}/essai-vf7e-pg5.pdf', 'essai-vf7e-pg5.pdf', 'vente', 'a_valider', '2023-03-01', 120),
      ('{PG6}', '{DG}', '{DG}/essai-vf7e-pg6.pdf', 'essai-vf7e-pg6.pdf', 'vente', 'a_valider', '2025-12-15', 120),
      ('{PG7}', '{DG}', '{DG}/essai-vf7e-pg7.pdf', 'essai-vf7e-pg7.pdf', 'vente', 'a_valider', '2025-11-01', 60),
      ('{PG8}', '{DG}', '{DG}/essai-vf7e-pg8.pdf', 'essai-vf7e-pg8.pdf', 'vente', 'a_valider', '2025-12-20', -120),
      ('{PGI1}', '{DG}', '{DG}/essai-vf7e-pgi1.pdf', 'essai-vf7e-pgi1.pdf', 'vente', 'a_valider', '2025-12-15', 120),
      ('{PGI2}', '{DG}', '{DG}/essai-vf7e-pgi2.pdf', 'essai-vf7e-pgi2.pdf', 'vente', 'a_valider', '2024-06-01', 120),
      ('{PN1}', '{DN}', '{DN}/essai-vf7e-pn1.pdf', 'essai-vf7e-pn1.pdf', 'vente', 'a_valider', '2025-06-01', 60),
      ('{PN2}', '{DN}', '{DN}/essai-vf7e-pn2.pdf', 'essai-vf7e-pn2.pdf', 'vente', 'a_valider', '2025-06-01', 60)$q$, '', ''],
    array['jeu', 'VF7e : PG9, une pièce que le pont rattache à F2026-0101 par son identité', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, source, identite_numero, identite_siren_vendeur, identite_date, identite_nature) values
      ('{PG9}', '{DG}', '{DG}/essai-vf7e-pg9.pdf', 'essai-vf7e-pg9.pdf', 'vente', 'a_valider', 'superpdp', 'F2026-0101', '123456789', '2026-01-10', 'facture')$q$, '', ''],
    array['jeu', 'VF7e : les biens que PGI1 et PGI2 justifient (le gel de la pièce passe aussi par eux)', 'postgres', $q$insert into immobilisations (id, dossier_id, piece_id, libelle, valeur, date_acquisition, duree_annees) values
      ('{IG1}', '{DG}', '{PGI1}', 'ESSAI BIEN 1', 1000, '2024-01-15', 5), ('{IG2}', '{DG}', '{PGI2}', 'ESSAI BIEN 2', 1000, '2024-01-15', 5)$q$, '', ''],
    array['fait', '0. le jeu (VF7e) : PG2 et PGI2 exemplaires de F2024-0101, PG3 de F2026-0101, PG6 et PGI1 de F2025-0101, PG7 de F2025-0102 (d''avant la bascule), PN2 de F2025-0201, PG9 de F2026-0101 (celle de son identité)', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG9}', '{FG26}'), designer_exemplaire_facture('{DG}', '{PG2}', '{FG24}'), designer_exemplaire_facture('{DG}', '{PGI2}', '{FG24}'), designer_exemplaire_facture('{DG}', '{PG3}', '{FG26}'), designer_exemplaire_facture('{DG}', '{PG6}', '{FG25}'), designer_exemplaire_facture('{DG}', '{PGI1}', '{FG25}'), designer_exemplaire_facture('{DG}', '{PG7}', '{FGP}'), designer_exemplaire_facture('{DN}', '{PN2}', '{FN25}')$q$, 'OK', ''],
    array['fait', '0. le jeu (VF7e) : PG4 déclarée vente hors des factures de l''application', 'chef', $q$select declarer_vente_hors_des_factures('{DG}', '{PG4}')$q$, 'OK', ''],
    array['fait', '0. le jeu (VF7e) : PG6 validée, désignée (G3)', 'chef', $q$update pieces set statut = 'validee' where id = '{PG6}'$q$, 'OK', ''],
    array['controle', '400. avant les validations : PG2 se défait (F2024-0101, que rien ne fige encore)', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PG2}')$q$, 'OK', ''],
    array['controle', '401. … PG3 désigne F2025-0101 à la place de F2026-0101', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG3}', '{FG25}')$q$, 'OK', ''],
    array['controle', '402. … PG2 se déclare à la place de sa désignation', 'chef', $q$select declarer_vente_hors_des_factures('{DG}', '{PG2}')$q$, 'OK', ''],
    array['controle', '403. … PG4, déclarée, désigne F2025-0101 à la place de sa déclaration', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG4}', '{FG25}')$q$, 'OK', ''],
    array['controle', '404. … PGI2 se défait', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PGI2}')$q$, 'OK', ''],
    array['controle', '405. … dans DN, PN2 se défait', 'chef', $q$select defaire_exemplaire_facture('{DN}', '{PN2}')$q$, 'OK', ''],
    array['fait', '0. le jeu (VF7e) : les écritures validées de PG7 (2025), du bien de PGI1 (2024), de celui de PGI2 (2025) et de PN2 (2025), par la porte de la restauration', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, piece_id, immobilisation_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values
      ('{EG7}', '{DG}', '{PG7}', null, '2025-11-01', '706000', 'ESSAI PG7', 60, 'credit', 'validee', '2026-01-20 10:00:00+00', 'VE', 1, 'ESSAI PG7', '2025-11-01', 'Prestations'),
      ('{EGI1}', '{DG}', null, '{IG1}', '2024-12-31', '681120', 'ESSAI DOTATION 1', 200, 'debit', 'validee', '2025-01-20 10:00:00+00', 'OD', 1, 'ESSAI IG1', '2024-12-31', 'Dotations'),
      ('{EGI2}', '{DG}', null, '{IG2}', '2025-12-31', '681120', 'ESSAI DOTATION 2', 200, 'debit', 'validee', '2026-01-20 10:00:00+00', 'OD', 2, 'ESSAI IG2', '2025-12-31', 'Dotations'),
      ('{EN2}', '{DN}', '{PN2}', null, '2025-06-01', '706000', 'ESSAI PN2', 60, 'credit', 'validee', '2026-01-20 10:00:00+00', 'VE', 1, 'ESSAI PN2', '2025-06-01', 'Prestations')$q$, 'OK', ''],
    array['controle', '406. les écritures de la pièce validées, pas encore l''exercice de sa facture : PGI2 ne se défait plus, sous l''exercice de son bien', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PGI2}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2025 : sa désignation ne change plus.'],
    array['controle', '407. … PGI1 non plus', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PGI1}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2024 : sa désignation ne change plus.'],
    array['controle', '408. … PG2, qui ne porte rien, se défait encore', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PG2}')$q$, 'OK', ''],
    array['jeu', 'VF7e : les exercices 2024 et 2025 validés dans DG, 2025 et 2026 dans DN (une facture source de DG ne se fige pas par l''exercice d''un autre dossier)', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values
      ('{DG}', 2024, '2025-01-20 10:00:00+00', '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('d', 64), '{}'), ('{DG}', 2025, '2026-01-20 10:00:00+00', '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('e', 64), '{}'),
      ('{DN}', 2025, '2026-01-20 10:00:00+00', '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('f', 64), '{}'), ('{DN}', 2026, '2026-10-01 10:00:00+00', '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('a', 64), '{}')$q$, '', ''],
    array['jeu', 'VF7e : PG1, l''original de F2025-0101 revenu de la plateforme APRÈS la validation', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc) values
      ('{PG1}', '{DG}', '{DG}/essai-vf7e-pg1.pdf', 'essai-vf7e-pg1.pdf', 'vente', 'a_valider', '2025-12-15', 120)$q$, '', ''],
    array['controle', '410. après : PG2 ne se défait plus — F2024-0101 est figée par la validation de 2024', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PG2}')$q$,
      '22023', 'Cette pièce est l''exemplaire de la facture F2024-0101, figée par la validation de l''exercice 2024 : sa désignation ne change plus.'],
    array['controle', '411. … ne désigne pas à sa place F2026-0101, que rien ne fige', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG2}', '{FG26}')$q$,
      '22023', 'Cette pièce est l''exemplaire de la facture F2024-0101, figée par la validation de l''exercice 2024 : sa désignation ne change plus.'],
    array['controle', '412. … ne se déclare pas à la place de sa désignation', 'chef', $q$select declarer_vente_hors_des_factures('{DG}', '{PG2}')$q$,
      '22023', 'Cette pièce est l''exemplaire de la facture F2024-0101, figée par la validation de l''exercice 2024 : sa désignation ne change plus.'],
    array['controle', '413. … le gel avant « déjà l''exemplaire de cette facture »', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG2}', '{FG24}')$q$,
      '22023', 'Cette pièce est l''exemplaire de la facture F2024-0101, figée par la validation de l''exercice 2024 : sa désignation ne change plus.'],
    array['controle', '414. PG6, validée : « validée dans un dossier basculé » avant le gel, pour défaire', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PG6}')$q$,
      '22023', 'Cette pièce est validée dans un dossier dont les factures sont la source de leurs ventes : elle ne perd pas sa désignation — désignez l''autre facture, ou déclarez-la vente hors des factures de l''application.'],
    array['controle', '415. … le gel pour la remplacer', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG6}', '{FG26}')$q$,
      '22023', 'Cette pièce est l''exemplaire de la facture F2025-0101, figée par la validation de l''exercice 2025 : sa désignation ne change plus.'],
    array['controle', '416. … et pour la déclarer', 'chef', $q$select declarer_vente_hors_des_factures('{DG}', '{PG6}')$q$,
      '22023', 'Cette pièce est l''exemplaire de la facture F2025-0101, figée par la validation de l''exercice 2025 : sa désignation ne change plus.'],
    array['controle', '417. le plus ancien : PGI2 — son bien validé en 2025, F2024-0101 figée par 2024 — nomme la facture', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PGI2}')$q$,
      '22023', 'Cette pièce est l''exemplaire de la facture F2024-0101, figée par la validation de l''exercice 2024 : sa désignation ne change plus.'],
    array['controle', '418. le plus ancien : PGI1 — son bien validé en 2024, F2025-0101 figée par 2025 — garde les mots d''hier', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PGI1}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2024 : sa désignation ne change plus.'],
    array['controle', '419. l''exercice de la pièce seul : PG7, exemplaire de F2025-0102 (d''avant la bascule, qui n''est pas source), son écriture validée en 2025', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PG7}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2025 : sa désignation ne change plus.'],
    array['controle', '420. … la déclaration, sous ses mots d''hier', 'chef', $q$select declarer_vente_hors_des_factures('{DG}', '{PG7}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2025 : sa déclaration ne change plus.'],
    array['controle', '421. le côté de la facture : PG3, exemplaire de F2026-0101, ne désigne pas F2025-0101, figée — une pièce déjà marquée', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG3}', '{FG25}')$q$,
      '22023', 'La facture F2025-0101 est figée par la validation de l''exercice 2025 : elle ne reçoit plus qu''une première désignation, d''une pièce qui n''est encore ni l''exemplaire d''une facture ni déclarée — retirer d''abord sa désignation ou sa déclaration (validée, la pièce se remet d''abord à valider).'],
    array['controle', '421b. … le rang 7 bis avant le pont : PG9, que son identité rattache à F2026-0101, qu''elle désigne', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG9}', '{FG25}')$q$,
      '22023', 'La facture F2025-0101 est figée par la validation de l''exercice 2025 : elle ne reçoit plus qu''une première désignation, d''une pièce qui n''est encore ni l''exemplaire d''une facture ni déclarée — retirer d''abord sa désignation ou sa déclaration (validée, la pièce se remet d''abord à valider).'],
    array['controle', '422. … ni l''avoir A2025-0101, figé de même', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG3}', '{FGAV}')$q$,
      '22023', 'La facture A2025-0101 est figée par la validation de l''exercice 2025 : elle ne reçoit plus qu''une première désignation, d''une pièce qui n''est encore ni l''exemplaire d''une facture ni déclarée — retirer d''abord sa désignation ou sa déclaration (validée, la pièce se remet d''abord à valider).'],
    array['controle', '423. … ni F2023-0101, d''une année qui précède le premier exercice validé : figée par 2024', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG3}', '{FG23}')$q$,
      '22023', 'La facture F2023-0101 est figée par la validation de l''exercice 2024 : elle ne reçoit plus qu''une première désignation, d''une pièce qui n''est encore ni l''exemplaire d''une facture ni déclarée — retirer d''abord sa désignation ou sa déclaration (validée, la pièce se remet d''abord à valider).'],
    array['controle', '424. … mais elle prend F2025-0102, d''avant la bascule, qui n''est pas source', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG3}', '{FGP}')$q$, 'OK', ''],
    array['controle', '425. … sa désignation, que rien ne fige, se défait', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PG3}')$q$, 'OK', ''],
    array['controle', '426. … et se déclare', 'chef', $q$select declarer_vente_hors_des_factures('{DG}', '{PG3}')$q$, 'OK', ''],
    array['controle', '427. PG4, déclarée, ne désigne pas F2025-0101, figée : une déclaration est une marque', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG4}', '{FG25}')$q$,
      '22023', 'La facture F2025-0101 est figée par la validation de l''exercice 2025 : elle ne reçoit plus qu''une première désignation, d''une pièce qui n''est encore ni l''exemplaire d''une facture ni déclarée — retirer d''abord sa désignation ou sa déclaration (validée, la pièce se remet d''abord à valider).'],
    array['controle', '428. … mais F2026-0101, que rien ne fige, à la place de sa déclaration', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG4}', '{FG26}')$q$, 'OK', ''],
    array['controle', '429. … et sa déclaration se retire', 'chef', $q$select retirer_declaration_hors_des_factures('{DG}', '{PG4}')$q$, 'OK', ''],
    array['controle', '430. une pièce que rien ne marque : PG8 désigne l''avoir A2025-0101, figé — sa première désignation', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG8}', '{FGAV}')$q$, 'OK', ''],
    array['fait', '431. l''original revenu après la validation : PG1 désigne F2025-0101, figée — sa première désignation', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG1}', '{FG25}')$q$, 'OK', ''],
    array['controle', '432. … puis ne se défait plus', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PG1}')$q$,
      '22023', 'Cette pièce est l''exemplaire de la facture F2025-0101, figée par la validation de l''exercice 2025 : sa désignation ne change plus.'],
    array['controle', '433. … ne se remplace pas', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG1}', '{FG26}')$q$,
      '22023', 'Cette pièce est l''exemplaire de la facture F2025-0101, figée par la validation de l''exercice 2025 : sa désignation ne change plus.'],
    array['controle', '434. … ne se déclare pas', 'chef', $q$select declarer_vente_hors_des_factures('{DG}', '{PG1}')$q$,
      '22023', 'Cette pièce est l''exemplaire de la facture F2025-0101, figée par la validation de l''exercice 2025 : sa désignation ne change plus.'],
    array['controle', '435. … et se valide, désignée (G3)', 'chef', $q$update pieces set statut = 'validee' where id = '{PG1}'$q$, 'OK', ''],
    array['lecture', '436. … son journal : la première désignation', 'chef', $q$select string_agg(geste || ':' || coalesce(facture_id::text, '-'), ',' order by fait_le, id) from designations_des_pieces where piece_id = '{PG1}'$q$, '',
      'designation:{FG25}'],
    array['fait', '437. PG5, que rien ne marque, désigne F2023-0101, figée par 2024', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG5}', '{FG23}')$q$, 'OK', ''],
    array['controle', '438. … puis ne se défait plus, sous l''exercice qui la fige : 2024', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PG5}')$q$,
      '22023', 'Cette pièce est l''exemplaire de la facture F2023-0101, figée par la validation de l''exercice 2024 : sa désignation ne change plus.'],
    array['controle', '439. dans DN, qui n''a pas basculé : PN1 désigne F2025-0201, d''un exercice validé, qui n''est pas source', 'chef', $q$select designer_exemplaire_facture('{DN}', '{PN1}', '{FN25}')$q$, 'OK', ''],
    array['fait', '440. … PN1 désigne F2026-0201', 'chef', $q$select designer_exemplaire_facture('{DN}', '{PN1}', '{FN26}')$q$, 'OK', ''],
    array['controle', '441. … puis F2025-0201 à sa place : aucune facture de DN n''est source, rien ne fige ce côté', 'chef', $q$select designer_exemplaire_facture('{DN}', '{PN1}', '{FN25}')$q$, 'OK', ''],
    array['controle', '442. … sa désignation se défait', 'chef', $q$select defaire_exemplaire_facture('{DN}', '{PN1}')$q$, 'OK', ''],
    array['controle', '443. PN2, son écriture validée en 2025 : les mots d''hier, inchangés', 'chef', $q$select defaire_exemplaire_facture('{DN}', '{PN2}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2025 : sa désignation ne change plus.'],
    array['valeur', '444. l''exercice qui fige chaque facture : pour une source, le premier exercice validé qui couvre sa date d''émission ; rien pour une autre', 'postgres', $q$select string_agg(f.numero || '=' || coalesce(exercice_figeant_la_facture_source(f.id)::text, '-'), ' ' order by f.numero collate "C") from factures_emises f where f.dossier_id in ('{DG}', '{DN}')$q$, '',
      'A2025-0101=2025 F2023-0101=2024 F2024-0101=2024 F2025-0101=2025 F2025-0102=- F2025-0201=- F2026-0101=- F2026-0201=-'],
    array['valeur', '445. l''exercice qui fige chaque pièce de DG et de DN : sa désignation, puis la pièce seule', 'postgres', $q$select string_agg(p.nom_fichier || '=' || coalesce(exercice_figeant_la_designation(p.id)::text, '-') || '/' || coalesce(exercice_figeant_la_piece(p.id)::text, '-'), ' ' order by p.nom_fichier collate "C") from pieces p where p.dossier_id in ('{DG}', '{DN}')$q$, '',
      'essai-vf7e-pg1.pdf=2025/- essai-vf7e-pg2.pdf=2024/- essai-vf7e-pg3.pdf=-/- essai-vf7e-pg4.pdf=-/- essai-vf7e-pg5.pdf=2024/- essai-vf7e-pg6.pdf=2025/- essai-vf7e-pg7.pdf=2025/2025 essai-vf7e-pg8.pdf=-/- essai-vf7e-pg9.pdf=-/- essai-vf7e-pgi1.pdf=2024/2024 essai-vf7e-pgi2.pdf=2024/2025 essai-vf7e-pn1.pdf=-/- essai-vf7e-pn2.pdf=2025/2025'],
    array['valeur', '446. les deux fonctions neuves : aux droits de l''appelant, stables, le chemin fixé, un exercice', 'postgres', $q$select string_agg(p.proname || ':' || p.prosecdef || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-') || ':' || pg_get_function_result(p.oid) || ':' || l.lanname, ',' order by p.proname collate "C") from pg_proc p join pg_language l on l.oid = p.prolang where p.pronamespace = 'public'::regnamespace and p.proname in ('exercice_figeant_la_facture_source', 'exercice_figeant_la_designation')$q$, '',
      'exercice_figeant_la_designation:false:s:search_path=public:integer:sql,exercice_figeant_la_facture_source:false:s:search_path=public:integer:sql'],
    array['valeur', '447. … qu''aucun rôle de l''API n''exécute (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || '(uuid)', 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || '(uuid)', 'execute'), ',' order by f collate "C") from unnest(array['exercice_figeant_la_designation', 'exercice_figeant_la_facture_source']) f$q$, '',
      'exercice_figeant_la_designation:false:false,exercice_figeant_la_facture_source:false:false'],
    array['valeur', '448. le gel des quatre fonctions du cabinet lit la désignation ; celui de la fiche hors de France, la pièce, comme hier', 'postgres', $q$select string_agg(proname || ':' || (strpos(prosrc, 'v_annee := public.exercice_figeant_la_designation(p_piece_id);') > 0)::text || ':' || (strpos(prosrc, 'v_annee := public.exercice_figeant_la_piece(') > 0)::text, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and (strpos(prosrc, 'exercice_figeant_la_piece(') > 0 or strpos(prosrc, 'exercice_figeant_la_designation(') > 0) and proname not like 'exercice!_figeant!_la!_%' escape '!'$q$, '',
      'declarer_vente_hors_des_factures:true:false,defaire_exemplaire_facture:true:false,designer_exemplaire_facture:true:false,enregistrer_fiche_hors_de_france:false:true,garder_fiche_hors_de_france:false:true,retirer_declaration_hors_des_factures:true:false,retirer_fiche_hors_de_france:false:true'],
    array['valeur', '449. exercice_figeant_la_piece ne change pas (le corps de la migration pieces_hors_de_france)', 'postgres', $q$select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.exercice_figeant_la_piece(uuid)'::regprocedure$q$, '',
      '78624664a1794b06816acb2e70436802'],
    array['controle', '450. MUTATION — le contrôle 421 sur PG8, que rien ne marque : il doit passer', 'chef', $q$select designer_exemplaire_facture('{DG}', '{PG8}', '{FG25}')$q$, 'OK', ''],
    array['controle', '451. MUTATION — le contrôle 410 sur PG3, exemplaire de F2026-0101 que rien ne fige : il doit passer', 'chef', $q$select defaire_exemplaire_facture('{DG}', '{PG3}')$q$, 'OK', '']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      attendu := etape[6];
      for cle, valeur in select key, value from jsonb_each_text(ids || jsonb_build_object('CHEF', chef)) loop
        s := replace(s, '{' || cle || '}', valeur);
        attendu := replace(attendu, '{' || cle || '}', valeur);
      end loop;
      accepte := false; code_recu := null; message := null; obs := null;
      if etape[1] = 'jeu' then
        begin
          execute s;
        exception when others then
          verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
        end;
      elsif etape[1] = 'retenir' then
        begin
          execute s into obs;
        exception when others then obs := null;
        end;
        if obs is null then
          verdicts := verdicts || jsonb_build_object('controle', '0. retenir ' || etape[2], 'observe', 'rien à retenir', 'ok', false);
        else
          ids := ids || jsonb_build_object(etape[2], obs);
        end if;
      elsif etape[1] = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = attendu, false));
      else
        if etape[3] in ('membre', 'membre_ailleurs', 'chef_simple', 'client_t', 'client_t_ventes') and etape[1] not in ('controle', 'lecture') then
          raise exception 'ESSAI_MAL_ECRIT : le profil % ne sert qu''à un contrôle ou à une lecture, qui s''annulent', etape[3];
        end if;
        begin
          if etape[3] in ('membre', 'membre_ailleurs') then
            insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
            insert into dossier_assignations (dossier_id, user_id)
              values (case etape[3] when 'membre' then (ids ->> 'T')::uuid else (ids ->> 'A')::uuid end, client);
          elsif etape[3] = 'chef_simple' then
            insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
          elsif etape[3] in ('client_t', 'client_t_ventes') then
            -- « Ventes » sur T, qui n'a pas basculé : seule la porte de la restauration — le super-administrateur — l'y
            -- pose (garder_droit_ventes, étape VF8f) ; c'est l'état que rend la restauration d'une sauvegarde d'avant.
            perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
            insert into memberships (user_id, dossier_id, role, droit_ventes, droit_banque)
              values (client, (ids ->> 'T')::uuid, 'client', etape[3] = 'client_t_ventes', etape[3] = 'client_t_ventes');
          end if;
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case etape[3] when 'anon' then 'anon' when 'service' then 'service_role' else 'authenticated' end);
            perform set_config('request.jwt.claims', case etape[3] when 'anon' then json_build_object('role', 'anon')::text
              when 'service' then json_build_object('role', 'service_role')::text
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'inconnu' then inconnu else client end,
                                     'role', 'authenticated')::text end, true);
          end if;
          if etape[1] = 'lecture' then
            execute s into obs;
          else
            execute s;
          end if;
          accepte := true;
          if etape[1] in ('controle', 'lecture') then
            raise exception 'ANNULATION_ESSAI';
          end if;
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        perform set_config('jd.exemplaire_facture', '', true);
        perform set_config('jd.classement_encaissements', '', true);
        if etape[1] = 'lecture' then
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then coalesce(obs, '∅') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', accepte and coalesce(code_recu = 'P0001', false) and coalesce(obs = attendu, false));
        else
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then 'accepté' else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', case when etape[5] = 'OK' then accepte and (etape[1] = 'fait' or coalesce(code_recu = 'P0001', false))
                       else not accepte and coalesce(code_recu = etape[5] and message like attendu, false) end);
        end if;
      end if;
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      verdicts := verdicts || jsonb_build_object('controle', '0. le déroulé de l''essai', 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ══ 199. Rien n'est resté ══════════
  foreach cle in array tables loop
    if to_regclass('public.' || cle) is null then
      n := -1;
    else
      execute format('select count(*) from public.%I', cle) into n;
    end if;
    apres := concat_ws('/', apres, n);
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '199. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI EXEMPLAIRES%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.exemplaires_des_factures', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.exemplaires_des_factures')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
