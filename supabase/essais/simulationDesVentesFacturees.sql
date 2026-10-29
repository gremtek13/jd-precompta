-- « MA SIMULATION » REÇOIT SES VENTES FACTURÉES, ÉPROUVÉE EN BASE (chantier EC-Q3, ligne 28.65, étape VF8e ; migration
-- `simulation_des_ventes_facturees`) — à rejouer après toute migration qui touche `ventes_facturees_de_la_simulation`,
-- la règle du cumul (`calcul_vente_facturee`, `prorata_arrondi`, `montants_par_taux_facture`), le prédicat de la banque
-- du client (`gere_la_banque`, `admin_du_dossier`, `client_du_dossier`), le réglage et le modèle comptable d'un dossier
-- (`dossiers.ventes_par_les_factures`, `dossiers.mode_comptable`), les factures émises, leurs lignes, les encaissements
-- et leurs parts.
--
-- Ce qui se prouve ici :
--   - LE MÊME CALCUL QUE LE MODULE (1 à 8) : sur un jeu posé dans deux dossiers basculés — R en trésorerie, G en
--     engagement, le même jeu —, ce que la fonction rend de chacune des années 2025 à 2027 est, mot pour mot, ce que
--     `recettesFactureesParMois` (src/lib/ventesFacturees.ts) compte des mois de cette année, en centimes, et ses
--     sources l'ensemble `sources` du module : src/test/essaiSimulationVentesFacturees.ts calcule ces lectures, et
--     src/lib/simulationVentesFacturees.test.ts exige que cet essai les porte exactement. Le jeu tient la trésorerie et
--     l'engagement ; un paiement partiel en trois fois, sur trois mois (la TVA au cumul) ; un avoir entre deux
--     encaissements, un avoir du jour d'un encaissement, un avoir de l'année suivante ; une contre-passation le mois
--     suivant, une du même mois (le mois a son entrée, à zéro), une de l'année suivante ; un encaissement retiré ; six
--     factures écartées, une par motif (aucune n'est comptée, en engagement non plus) ; un bien livré après sa
--     facture ; une franchise ; deux taux ; une facture validée avant la bascule, qui n'est pas source ; les deux bords
--     d'une année ;
--   - QUI LIT (9 à 23) : le client qui porte « Banque » et un membre de l'équipe affecté au dossier lisent ce que lit
--     le cabinet (9, 10) ; un dossier qui n'a pas basculé ne rend rien, une facture validée et son encaissement y
--     compris (11), ni un dossier qui a basculé sans aucune facture (11b) ; « Ventes » seul, aucune case, l'autre
--     dossier, un membre de l'équipe hors de ses dossiers, un compte rattaché à rien, le rôle des Edge Functions, un
--     dossier qui n'existe pas : « Accès refusé à ce dossier. » (42501) ; l'anonyme n'exécute pas la fonction (42501,
--     le droit d'exécution) ; une année nulle ou hors de 2000 à 2100 : « Exercice invalide. » (22023), jugée après
--     l'accès ; les deux bornes passent ;
--   - LE CATALOGUE (24) : `security definer`, `stable`, son chemin fixé, une valeur `jsonb` ; exécutable par les
--     connectés, ni par l'anonyme ni par PUBLIC ;
--   - et que RIEN ne reste en base (99).
--
-- Quatre dossiers JETABLES du cabinet du dossier `test` : R et G ont basculé, N non, V a basculé sans facture. Le jeu
-- se pose par la porte de la restauration (le super-administrateur), depuis la macro JEU que `jeuPourLaBase` rend ; ses
-- identifiants sont FIXES (préfixe `5f8e0000`, puis cinq chiffres ; ceux de G, 1 000 de plus). Le moteur d'étapes de
-- ecrituresVentesFacturees.sql : chaque contrôle et chaque lecture dans sa sous-transaction, annulée
-- (`ANNULATION_ESSAI`, P0001) ; ses profils — « chef » (le chef du cabinet, super-administrateur), « membre » (le
-- client d'essai fait membre de l'équipe, affecté à R), « client_b », « client_v », « client_0 » (un accès du client
-- d'essai à R : « Banque » seule, « Ventes » seule, aucune case), « inconnu », « anon », « service » —, posés dans la
-- sous-transaction. Tout se joue dans un bloc qui s'annule entièrement (`ANNULATION_ESSAI_GLOBALE`) ; les verdicts
-- voyagent dans un réglage LOCAL à la transaction (`essai.simulation_ventes`) : hors de l'outil d'exécution, le fichier
-- se joue en UNE transaction (`psql -1`). Aucune instruction de suppression, aucune mise à jour. Données FICTIVES.
--
-- ÉPROUVÉ LE 26/10/2026 SUR LA RÉPLIQUE DE L'ÉTAPE (PostgreSQL 16, UTF8 ; `signature.sql` : les neuf familles, et
-- l'historique, égaux à la production à 153 migrations), migration `simulation_des_ventes_facturees` alors PRÉPARÉE,
-- pas appliquée : sans elle, ESSAI_IMPOSSIBLE, rien de joué ; avec elle, ses 29 contrôles justes (30 lignes, avec celle
-- de l'information) et rien n'est resté — sur la production comme sur la production munie de
-- `insertion_des_encaissements` (VF5H2-Q1). Des soixante-deux mutations de la migration, cinquante-trois sont tuées —
-- quarante-huit par cet essai, cinq par la garde de tête —, et les neuf autres sont équivalentes, chacune avec sa
-- raison. Le même calcul, sur 1 330 lectures d'une batterie tirée de quatre graines fixes (266 dossiers, 19 120
-- factures, 40 468 encaissements), rendu mot pour mot par le module (HISTORIQUE.md, « « MA SIMULATION » REÇOIT SES
-- VENTES FACTURÉES »).
--
-- JOUÉ EN PRODUCTION LE 27/10/2026, la migration appliquée sous la version `20261027055129`, après `index_des_avoirs`
-- (`20261027055007`) : par l'outil d'exécution, le texte sans ses lignes de commentaire en tête de ligne (21 366
-- caractères, `9ea612d5a8406e9aa7cbf02b920bb5ae` ; la base en a reçu 21 365, `bba86b5b06b998cdc85672e68c2a99d3`, le
-- même sans son dernier saut de ligne) : les 29 contrôles justes, ligne pour ligne ceux de la réplique, et rien n'est
-- resté (HISTORIQUE.md, « LES TROIS MIGRATIONS DE VF8E-Q1, VF8E ET VF5H2Q1-Q2 EN PRODUCTION »).
--
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  cabinet uuid;
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text; attendu text; n bigint;
  tables text[] := array['dossiers', 'factures_emises', 'facture_lignes', 'encaissements_factures', 'encaissements_factures_taux',
    'cabinet_admins', 'dossier_assignations', 'memberships'];
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  select cabinet_id into cabinet from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24';
  if cabinet is null
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or not exists (select 1 from auth.users where id = client)
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client)
     or to_regprocedure('public.ventes_facturees_de_la_simulation(uuid, integer)') is null then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, client déjà rattaché au cabinet, ou migration simulation_des_ventes_facturees absente';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'X', gen_random_uuid(), 'U', '5f8e0000-0000-4000-8000-0000000',
      'D1', '5f8e0000-0000-4000-8000-000000000001', 'D2', '5f8e0000-0000-4000-8000-000000000002',
      'D3', '5f8e0000-0000-4000-8000-000000000003', 'D4', '5f8e0000-0000-4000-8000-000000000004')
    || jsonb_build_object(
    'JEU', $m${"f":[[101,"F2026-0001","2026-01-15","s",0,1,100,20],[102,"F2026-0002","2026-03-05","s",0,1,83.33,16.67],[103,"F2026-0003","2026-04-10","s",0,1,200,40],[301,"A2026-0001","2026-06-20","s",0,1,-50,-10,103],[104,"F2026-0004","2026-06-01","s",0,1,50,10],[105,"F2026-0005","2026-02-01","s",0,1,10,2],[106,"F2026-0006","2026-07-01","s",0,1,10,2],[107,"F2025-0001","2025-12-20","s",0,1,40,8],[108,"F2026-0007","2026-12-31","s",0,1,30,6],[109,"F2026-0008","2026-09-01","s",0,1,40,8],[110,"F2026-0009","2026-10-01","b",0,1,300,60,null,"2026-10-10"],[111,"F2026-0010","2026-01-01","s",0,1,80,0],[112,"F2026-0011","2026-05-10","s",0,1,1100,205.5],[113,"F2026-0012","2026-11-15","s",0,1,100,20],[302,"A2027-0001","2027-01-10","s",0,1,-100,-20,113],[114,"F2026-0013","2026-09-10","s",0,1,25,5],[115,"F2026-0014","2026-03-12","s",0,0,30,6],[116,"F2026-0015","2026-12-01","s",0,1,10,2],[117,"F2026-0016","2026-08-01","s",0,1,10,2],[303,"A2026-0002","2026-08-05","s",0,1,-10,-2,117],[118,"F2026-0017","2026-02-20",null,0,1,30,6],[119,"F2026-0018","2026-03-15","s",0,1,0,0],[120,"F2026-0019","2026-04-20","s",null,1,20,4],[121,"F2026-0020","2026-04-25","s",1,1,60,12],[122,"F2026-0021","2026-07-10","s",0,1,500,100],[304,"A2026-0003","2026-07-10","s",0,1,-50,-10,122]],"l":[[101,1,1,100,20],[102,1,1,83.33,20],[103,1,1,200,20],[301,1,-1,50,20],[104,1,1,50,20],[105,1,1,10,20],[106,1,1,10,20],[107,1,1,40,20],[108,1,1,30,20],[109,1,1,40,20],[110,1,1,300,20],[111,1,1,80,0],[112,1,1,1000,20],[112,2,1,100,5.5],[113,1,1,100,20],[302,1,-1,100,20],[114,1,1,25,20],[115,1,1,30,20],[116,1,1,10,20],[117,1,1,10,20],[303,1,-1,10,20],[118,1,1,30,20],[120,1,1,20,20],[121,1,1,60,20],[122,1,1,500,20],[304,1,-1,50,20]],"e":[[501,101,"2026-02-10",120,"virement"],[502,102,"2026-03-20",33.33,"virement"],[503,102,"2026-04-15",33.33,"cheque"],[504,102,"2026-05-02",33.34,"virement"],[505,103,"2026-05-15",120,"virement"],[506,103,"2026-07-01",60,"virement"],[507,104,"2026-06-10",60,"cheque"],[508,104,"2026-07-05",-60,"cheque",null,507],[509,104,"2026-08-01",60,"virement"],[510,105,"2026-02-15",12,"virement"],[511,106,"2026-07-02",12,"cheque"],[512,106,"2026-07-01",-12,"cheque",null,511],[513,107,"2026-01-01",48,"virement"],[514,108,"2027-01-03",36,"virement"],[515,109,"2026-09-05",48,"cheque",1],[516,110,"2026-11-30",360,"virement"],[517,111,"2026-01-31",80,"especes"],[518,112,"2026-05-20",1305.5,"virement"],[519,114,"2026-09-12",30,"cheque"],[520,114,"2026-09-28",-30,"cheque",null,519],[521,115,"2026-03-20",36,"virement"],[522,116,"2026-12-31",12,"cheque"],[523,116,"2027-01-05",-12,"cheque",null,522],[524,117,"2026-08-05",12,"cheque"],[525,118,"2026-02-25",36,"virement"],[526,120,"2026-04-28",24,"virement"],[527,121,"2026-06-30",72,"virement"],[528,122,"2026-07-10",300,"virement"],[529,122,"2026-08-20",240,"virement"]],"p":[[501,20,120],[502,20,33.33],[503,20,33.33],[504,20,33.34],[505,20,120],[506,20,60],[507,20,60],[508,20,-60],[509,20,60],[510,20,10],[511,20,12],[512,20,-12],[513,20,48],[514,20,36],[515,20,48],[516,20,360],[517,0,80],[518,20,1200],[518,5.5,105.5],[519,20,30],[520,20,-30],[521,20,36],[522,20,12],[523,20,-12],[524,20,12],[525,20,36],[526,20,24],[527,20,72],[528,20,300],[529,20,240]]}$m$,
    'DK', $m$cross join (values (1, 0), (2, 1000)) d(n, k)$m$,
    'DN', $m$('5f8e0000-0000-4000-8000-0000000' || lpad(d.n::text, 5, '0'))::uuid$m$,
    'I0', $m$('5f8e0000-0000-4000-8000-0000000' || lpad(((x ->> 0)::int + d.k)::text, 5, '0'))::uuid$m$,
    'I1', $m$('5f8e0000-0000-4000-8000-0000000' || lpad(((x ->> 1)::int + d.k)::text, 5, '0'))::uuid$m$,
    'I6', $m$('5f8e0000-0000-4000-8000-0000000' || lpad(((x ->> 6)::int + d.k)::text, 5, '0'))::uuid$m$,
    'I8', $m$('5f8e0000-0000-4000-8000-0000000' || lpad(((x ->> 8)::int + d.k)::text, 5, '0'))::uuid$m$,
    'ACC', $m$Accès refusé à ce dossier.$m$,
    'EXI', $m$Exercice invalide.$m$);

  foreach cle in array tables loop
    execute format('select count(*) from %I', cle) into n;
    avant := concat_ws('/', avant, n);
  end loop;

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu ou valeur}.
  etapes := array[
  -- ══ Le jeu : quatre dossiers, le jeu de R et G par la porte de la restauration ══════════
  array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures) values
    ('{D1}', 'ESSAI VF8E R', '{CAB}', 'tresorerie', '455000', true), ('{D2}', 'ESSAI VF8E G', '{CAB}', 'engagement', '455000', true),
    ('{D3}', 'ESSAI VF8E N', '{CAB}', 'tresorerie', '455000', false), ('{D4}', 'ESSAI VF8E V', '{CAB}', 'tresorerie', '455000', true)$q$, '', ''],
  array['fait', '0. le jeu : les factures et leurs lignes', 'chef', $q$insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht, montant_tva, montant_ttc, validated_at, source_de_la_vente, nature_operation, option_debits, date_prestation, facture_origine_id)
    select {I0}, {DN}, x ->> 1, 'validee', case left(x ->> 1, 1) when 'A' then 'avoir' else 'facture' end, (x ->> 2)::date, 'ESSAI',
           '12345678900012', (x ->> 6)::numeric, (x ->> 7)::numeric, (x ->> 6)::numeric + (x ->> 7)::numeric, now(), x ->> 5 = '1',
           case x ->> 3 when 'b' then 'biens' when 's' then 'services' end, (x ->> 4)::int = 1, (x ->> 9)::date, {I8}
      from jsonb_array_elements('{JEU}'::jsonb -> 'f') x {DK} order by x ->> 8 is not null, (x ->> 0)::int desc;
    insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht, montant_tva, montant_ttc, validated_at, nature_operation, option_debits)
    values ('{U}02101', '{D3}', 'F2026-0001', 'validee', 'facture', '2026-03-02', 'ESSAI', '12345678900012', 100, 20, 120, now(), 'services', false);
    insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva)
    select {I0}, (x ->> 1)::int, 'ESSAI', (x ->> 2)::numeric, (x ->> 3)::numeric, (x ->> 4)::numeric
      from jsonb_array_elements('{JEU}'::jsonb -> 'l') x {DK}
    union all select '{U}02101', 1, 'ESSAI', 1, 100, 20$q$, 'OK', ''],
  array['fait', '0. le jeu : les encaissements et leurs parts', 'chef', $q$insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif, cree_le, retire_le)
    select {I0}, {DN}, {I1}, (x ->> 2)::date, (x ->> 3)::numeric, x ->> 4, {I6}, case when x ->> 6 is not null then 'ESSAI' end,
           ((x ->> 2)::date + time '10:00' + (x ->> 0)::int % 60 * interval '1 minute') at time zone 'UTC',
           case when x ->> 5 = '1' then ((x ->> 2)::date + time '12:00') at time zone 'UTC' end
      from jsonb_array_elements('{JEU}'::jsonb -> 'e') x {DK} order by x ->> 6 is not null;
    insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen)
    values ('{U}02501', '{D3}', '{U}02101', '2026-03-10', 120, 'virement');
    insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
    select {I0}, {DN}, (x ->> 1)::numeric, (x ->> 2)::numeric
      from jsonb_array_elements('{JEU}'::jsonb -> 'p') x {DK}
    union all select '{U}02501', '{D3}', 20, 120$q$, 'OK', ''],
  -- ══ 1 à 10. Le même calcul que le module (essaiSimulationVentesFacturees.ts, `lecturesPourLEssai`) ══════════
  array['lecture', '1. R (trésorerie), 2025 : le hors-taxe de chaque mois', 'chef', $q$select (ventes_facturees_de_la_simulation('{D1}', 2025) -> 'par_mois')::text$q$, '', '{}'],
  array['lecture', '2. R (trésorerie), 2026 : le hors-taxe de chaque mois', 'chef', $q$select (ventes_facturees_de_la_simulation('{D1}', 2026) -> 'par_mois')::text$q$, '', '{"2026-01": 12000, "2026-02": 10000, "2026-03": 2777, "2026-04": 2778, "2026-05": 122778, "2026-06": 11000, "2026-07": 25000, "2026-08": 25000, "2026-09": 0, "2026-11": 30000, "2026-12": 1000}'],
  array['lecture', '3. R (trésorerie), 2027 : le hors-taxe de chaque mois', 'chef', $q$select (ventes_facturees_de_la_simulation('{D1}', 2027) -> 'par_mois')::text$q$, '', '{"2027-01": 2000}'],
  array['lecture', '4. R : les factures et avoirs sources, de toute année', 'chef', $q$select (ventes_facturees_de_la_simulation('{D1}', 2026) -> 'sources')::text$q$, '', '["{U}00101", "{U}00102", "{U}00103", "{U}00104", "{U}00105", "{U}00106", "{U}00107", "{U}00108", "{U}00109", "{U}00110", "{U}00111", "{U}00112", "{U}00113", "{U}00114", "{U}00116", "{U}00117", "{U}00118", "{U}00119", "{U}00120", "{U}00121", "{U}00122", "{U}00301", "{U}00302", "{U}00303", "{U}00304"]'],
  array['lecture', '5. G (engagement), 2025 : le hors-taxe de chaque mois', 'chef', $q$select (ventes_facturees_de_la_simulation('{D2}', 2025) -> 'par_mois')::text$q$, '', '{"2025-12": 4000}'],
  array['lecture', '6. G (engagement), 2026 : le hors-taxe de chaque mois', 'chef', $q$select (ventes_facturees_de_la_simulation('{D2}', 2026) -> 'par_mois')::text$q$, '', '{"2026-01": 18000, "2026-03": 8333, "2026-04": 26000, "2026-05": 110000, "2026-06": 0, "2026-07": 45000, "2026-09": 6500, "2026-10": 30000, "2026-11": 10000, "2026-12": 4000}'],
  array['lecture', '7. G (engagement), 2027 : le hors-taxe de chaque mois', 'chef', $q$select (ventes_facturees_de_la_simulation('{D2}', 2027) -> 'par_mois')::text$q$, '', '{"2027-01": -10000}'],
  array['lecture', '8. G : les factures et avoirs sources, de toute année', 'chef', $q$select (ventes_facturees_de_la_simulation('{D2}', 2026) -> 'sources')::text$q$, '', '["{U}01101", "{U}01102", "{U}01103", "{U}01104", "{U}01105", "{U}01106", "{U}01107", "{U}01108", "{U}01109", "{U}01110", "{U}01111", "{U}01112", "{U}01113", "{U}01114", "{U}01116", "{U}01117", "{U}01118", "{U}01119", "{U}01120", "{U}01121", "{U}01122", "{U}01301", "{U}01302", "{U}01303", "{U}01304"]'],
  array['lecture', '9. le client qui porte « Banque » sur R lit, de R, ce que lit le cabinet', 'client_b', $q$select ventes_facturees_de_la_simulation('{D1}', 2026)::text$q$, '', '{"sources": ["{U}00101", "{U}00102", "{U}00103", "{U}00104", "{U}00105", "{U}00106", "{U}00107", "{U}00108", "{U}00109", "{U}00110", "{U}00111", "{U}00112", "{U}00113", "{U}00114", "{U}00116", "{U}00117", "{U}00118", "{U}00119", "{U}00120", "{U}00121", "{U}00122", "{U}00301", "{U}00302", "{U}00303", "{U}00304"], "par_mois": {"2026-01": 12000, "2026-02": 10000, "2026-03": 2777, "2026-04": 2778, "2026-05": 122778, "2026-06": 11000, "2026-07": 25000, "2026-08": 25000, "2026-09": 0, "2026-11": 30000, "2026-12": 1000}}'],
  array['lecture', '10. un membre de l''équipe affecté à R aussi', 'membre', $q$select ventes_facturees_de_la_simulation('{D1}', 2026)::text$q$, '', '{"sources": ["{U}00101", "{U}00102", "{U}00103", "{U}00104", "{U}00105", "{U}00106", "{U}00107", "{U}00108", "{U}00109", "{U}00110", "{U}00111", "{U}00112", "{U}00113", "{U}00114", "{U}00116", "{U}00117", "{U}00118", "{U}00119", "{U}00120", "{U}00121", "{U}00122", "{U}00301", "{U}00302", "{U}00303", "{U}00304"], "par_mois": {"2026-01": 12000, "2026-02": 10000, "2026-03": 2777, "2026-04": 2778, "2026-05": 122778, "2026-06": 11000, "2026-07": 25000, "2026-08": 25000, "2026-09": 0, "2026-11": 30000, "2026-12": 1000}}'],
  -- ══ 11 à 23. Qui lit ══════════
  array['lecture', '11. N n''a pas basculé : rien, sa facture validée et son encaissement y compris', 'chef', $q$select ventes_facturees_de_la_simulation('{D3}', 2026)::text$q$, '', '{"sources": [], "par_mois": {}}'],
  array['lecture', '11b. V a basculé sans facture : les deux clés, vides', 'chef', $q$select ventes_facturees_de_la_simulation('{D4}', 2026)::text$q$, '', '{"sources": [], "par_mois": {}}'],
  array['controle', '12. « Ventes » seul ne lit pas', 'client_v', $q$select ventes_facturees_de_la_simulation('{D1}', 2026)$q$, '42501', '{ACC}'],
  array['controle', '13. ni un accès sans case', 'client_0', $q$select ventes_facturees_de_la_simulation('{D1}', 2026)$q$, '42501', '{ACC}'],
  array['controle', '14. le client « Banque » de R ne lit pas G', 'client_b', $q$select ventes_facturees_de_la_simulation('{D2}', 2026)$q$, '42501', '{ACC}'],
  array['controle', '15. un membre de l''équipe ne lit pas un dossier qui ne lui est pas affecté', 'membre', $q$select ventes_facturees_de_la_simulation('{D2}', 2026)$q$, '42501', '{ACC}'],
  array['controle', '16. un compte rattaché à rien ne lit pas', 'inconnu', $q$select ventes_facturees_de_la_simulation('{D1}', 2026)$q$, '42501', '{ACC}'],
  array['controle', '17. l''anonyme n''exécute pas la fonction', 'anon', $q$select ventes_facturees_de_la_simulation('{D1}', 2026)$q$, '42501', 'permission denied for function ventes_facturees_de_la_simulation'],
  array['controle', '18. le rôle des Edge Functions l''exécute, sans session : refusé', 'service', $q$select ventes_facturees_de_la_simulation('{D1}', 2026)$q$, '42501', '{ACC}'],
  array['controle', '19. un dossier qui n''existe pas se refuse comme un dossier interdit, au super-administrateur aussi', 'chef', $q$select ventes_facturees_de_la_simulation('{X}', 2026)$q$, '42501', '{ACC}'],
  array['controle', '20. une année nulle', 'chef', $q$select ventes_facturees_de_la_simulation('{D1}', null)$q$, '22023', '{EXI}'],
  array['controle', '21. une année avant 2000', 'chef', $q$select ventes_facturees_de_la_simulation('{D1}', 1999)$q$, '22023', '{EXI}'],
  array['controle', '22. une année après 2100', 'client_b', $q$select ventes_facturees_de_la_simulation('{D1}', 2101)$q$, '22023', '{EXI}'],
  array['controle', '23. l''accès se juge avant l''année', 'client_v', $q$select ventes_facturees_de_la_simulation('{D1}', null)$q$, '42501', '{ACC}'],
  array['lecture', '23b. les deux bornes de l''année passent', 'chef', $q$select (ventes_facturees_de_la_simulation('{D1}', 2000) -> 'par_mois')::text || ' ' || (ventes_facturees_de_la_simulation('{D2}', 2100) -> 'par_mois')::text$q$, '', '{} {}'],
  -- ══ 24. Le catalogue ══════════
  array['valeur', '24. security definer, stable, son chemin fixé, une valeur jsonb ; les connectés l''exécutent, ni l''anonyme ni PUBLIC', 'postgres', $q$select concat_ws('|', p.prosecdef, p.provolatile, array_to_string(p.proconfig, ','), pg_get_function_result(p.oid), has_function_privilege('authenticated', p.oid, 'execute'), has_function_privilege('anon', p.oid, 'execute'), exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) from pg_proc p where p.oid = to_regprocedure('public.ventes_facturees_de_la_simulation(uuid, integer)')$q$, '', 't|s|search_path=public|jsonb|t|f|f']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      attendu := etape[6];
      for cle, valeur in select key, value from jsonb_each_text(ids) loop
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
      elsif etape[1] = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = attendu, false));
      else
        if etape[3] in ('membre', 'client_b', 'client_v', 'client_0') and etape[1] not in ('controle', 'lecture') then
          raise exception 'ESSAI_MAL_ECRIT : le profil % ne sert qu''à un contrôle ou à une lecture, qui s''annulent', etape[3];
        end if;
        begin
          if etape[3] = 'membre' then
            insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
            insert into dossier_assignations (dossier_id, user_id) values ((ids ->> 'D1')::uuid, client);
          elsif etape[3] in ('client_b', 'client_v', 'client_0') then
            insert into memberships (user_id, dossier_id, role, droit_ventes, droit_banque)
              values (client, (ids ->> 'D1')::uuid, 'client', etape[3] = 'client_v', etape[3] = 'client_b');
          end if;
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case etape[3] when 'anon' then 'anon' when 'service' then 'service_role' else 'authenticated' end);
            perform set_config('request.jwt.claims', case etape[3] when 'anon' then '{"role":"anon"}' when 'service' then '{"role":"service_role"}'
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'inconnu' then inconnu else client end, 'role', 'authenticated')::text end, true);
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
        if etape[1] = 'lecture' then
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then coalesce(obs, '∅') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', accepte and coalesce(code_recu = 'P0001', false) and coalesce(obs = attendu, false));
        else
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then 'accepté' else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', case when etape[5] = 'OK' then accepte and (etape[1] = 'fait' or coalesce(code_recu = 'P0001', false))
                       else not accepte and coalesce(code_recu = etape[5] and message = attendu, false) end);
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

  -- ══ 99. Rien n'est resté ══════════
  foreach cle in array tables loop
    execute format('select count(*) from %I', cle) into n;
    apres := concat_ws('/', apres, n);
  end loop;
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '99. rien n''est resté en base', 'observe', 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)),
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI VF8E%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.simulation_ventes', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.simulation_ventes')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
