-- LES NOTES DE FRAIS (espace client, ligne 51.5, étape B7 ; la migration `notes_de_frais`, PRÉPARÉE :
-- supabase/preparees/20261111238000_notes_de_frais.sql). Le récit : HISTORIQUE.md, « 11/11/2026 — B7 : LES NOTES DE FRAIS,
-- EN BASE (LIGNE 51.5) (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer après toute migration qui touche sa table, ses fonctions,
-- `client_du_dossier`, `memberships`, `pieces` (ses gardes, ses policies), le barème kilométrique
-- (`indemnite_kilometrique_centimes`) ou le catalogue des rôles comptables. Ce qu'une SUPPRESSION rencontre — la pièce citée
-- par une note que le cabinet supprime, le dossier qui part avec ses notes — ne se joue pas ici (l'outil d'exécution de la
-- production retient une suppression) : il s'est joué à la main sur une réplique, le 11/11/2026.
--
-- Ce qui se prouve ici, et ne se relit pas : un accès « Notes de frais » saisit ses brouillons, à la version lue, et les
-- soumet avec leur justificatif — une pièce qu'il a déposée, encore à valider, qu'une seule note cite — ou, pour des
-- kilomètres, au montant du barème de l'année que la base tient, jamais un autre ; la note d'un salarié sans accès, par
-- l'accès « Achats » seul ; un brouillon se retire et libère son justificatif ; l'accès « Achats » et le cabinet approuvent,
-- refusent sous un motif et remboursent, une note soumise ne se réécrivant plus ; chaque refus sous ses mots, dans son
-- ordre ; les lectures — l'auteur ses notes, « Achats » celles qui sont soumises, le cabinet toutes, personne d'autre ;
-- personne n'écrit la table en direct, pas même le rôle des Edge Functions ; le justificatif d'une note ne change pas de
-- dossier ; le rôle `personnel` au catalogue, réglable par dossier sous ses racines. Et onze MUTATIONS, qui doivent mordre :
-- chacune affaiblit un contrôle le temps d'une sous-transaction et rejoue l'étape qui le garde.
--
-- Trois dossiers jetables du cabinet du dossier `test` (préfixe `b7000000-0000-4000-8000`) : DN, où l'accès du client
-- d'essai porte « Notes de frais » ; DA, où il porte « Notes de frais » et « Achats » ; DS, où il ne porte ni l'une ni
-- l'autre. Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose d'abord
-- (super-administrateur, sous sa session), ce que le client pose ensuite, puis la requête du profil ; le jeu s'annule à la
-- fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la
-- transaction (`essai.notes_de_frais`) : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune
-- instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, il
-- se joue en UNE transaction (`psql -1`). Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dn constant text := 'b7000000-0000-4000-8000-0000000000d1';
  da constant text := 'b7000000-0000-4000-8000-0000000000d2';
  ds constant text := 'b7000000-0000-4000-8000-0000000000d3';
  acces_n constant text := 'b7000000-0000-4000-8000-0000000000a1';
  acces_a constant text := 'b7000000-0000-4000-8000-0000000000a2';
  acces_s constant text := 'b7000000-0000-4000-8000-0000000000a3';
  inconnu constant text := 'b7000000-0000-4000-8000-0000000000f1';
  pn constant text := 'b7000000-0000-4000-8000-0000000000e1';
  pa constant text := 'b7000000-0000-4000-8000-0000000000e2';
  pc constant text := 'b7000000-0000-4000-8000-0000000000e3';
  pv constant text := 'b7000000-0000-4000-8000-0000000000e4';
  nx constant text := 'b7000000-0000-4000-8000-0000000000c1';
  ny constant text := 'b7000000-0000-4000-8000-0000000000c2';
  nz constant text := 'b7000000-0000-4000-8000-0000000000c3';
  nw constant text := 'b7000000-0000-4000-8000-0000000000c4';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  e record; k record; v_code text; v_msg text; v_req text; v_pose text; v_pose_client text; v_obs text; v_ok boolean; v_ddl text; v_avant text;
  -- Les gabarits d'une pose : les pièces (un ticket du client dans DN et dans DA, une pièce du cabinet, une pièce déjà
  -- validée) ; un brouillon et des kilomètres saisis par le client ; une note soumise dans DA ; les notes d'un AUTRE compte,
  -- réinsérées par la restauration (le super-administrateur) : soumise, brouillon, soumise dans DN, approuvée.
  gabarits constant jsonb := jsonb_build_object(
    '{PJN}', $q$insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, type_piece) values ('{PN}', '{DN}', '{CLIENT}', '{DN}/essai-b7-ticket.pdf', 'ticket.pdf', 'note_frais')$q$,
    '{PJA}', $q$insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, type_piece) values ('{PA}', '{DA}', '{CLIENT}', '{DA}/essai-b7-ticket.pdf', 'ticket.pdf', 'note_frais')$q$,
    '{PJC}', $q$insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, type_piece) values ('{PC}', '{DN}', '{CHEF}', '{DN}/essai-b7-cabinet.pdf', 'cabinet.pdf', 'achat')$q$,
    '{PJV}', $q$insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, type_piece, statut) values ('{PV}', '{DN}', '{CLIENT}', '{DN}/essai-b7-validee.pdf', 'validee.pdf', 'note_frais', 'validee')$q$,
    '{NOTE}', $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner avec un client', 24.50, 2.23, null, '{PN}', null, null, null, null)$q$,
    '{KM}', $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-03', 'kilometres', 'Visite chez un client', 23.81, null, null, null, 45, 'voiture', 3, false)$q$,
    '{NA}', $q$select 1 from soumettre_note_de_frais((select n.id from enregistrer_note_de_frais('{DA}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, null, '{PA}', null, null, null, null) n), 1)$q$,
    '{AUTRE_SOUMISE}', $q$insert into notes_de_frais (id, dossier_id, auteur, date_depense, nature, motif, montant_ttc, etat, soumise_le) values ('{NX}', '{DA}', '{INCONNU}', '2026-11-02', 'transport', 'Train', 50, 'soumise', now())$q$,
    '{AUTRE_BROUILLON}', $q$insert into notes_de_frais (id, dossier_id, auteur, date_depense, nature, motif, montant_ttc) values ('{NY}', '{DA}', '{INCONNU}', '2026-11-02', 'transport', 'Train', 50)$q$,
    '{AUTRE_DN}', $q$insert into notes_de_frais (id, dossier_id, auteur, date_depense, nature, motif, montant_ttc, etat, soumise_le) values ('{NZ}', '{DN}', '{INCONNU}', '2026-11-02', 'transport', 'Train', 50, 'soumise', now())$q$,
    '{AUTRE_APPROUVEE}', $q$insert into notes_de_frais (id, dossier_id, auteur, date_depense, nature, motif, montant_ttc, etat, soumise_le, approuvee_par, approuvee_le) values ('{NW}', '{DA}', '{INCONNU}', '2026-11-02', 'transport', 'Train', 50, 'approuvee', now(), '{CHEF}', now())$q$,
    '{BROUILLON_CLIENT}', $q$insert into notes_de_frais (id, dossier_id, auteur, date_depense, nature, motif, montant_ttc, piece_id) values ('{NX}', '{DN}', '{CLIENT}', '2026-11-02', 'repas', 'Déjeuner', 24.50, '{PN}')$q$);
  valeurs constant jsonb := jsonb_build_object(
    '{DN}', dn, '{DA}', da, '{DS}', ds, '{PN}', pn, '{PA}', pa, '{PC}', pc, '{PV}', pv, '{NX}', nx, '{NY}', ny, '{NZ}', nz,
    '{NW}', nw, '{ACCN}', acces_n, '{ACCA}', acces_a, '{CHEF}', chef, '{CLIENT}', client, '{INCONNU}', inconnu);
  verdicts jsonb := '[]'::jsonb;
  mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.notes_de_frais') is null then
    perform set_config('essai.notes_de_frais', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration notes_de_frais', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- Le jeu : trois dossiers jetables et un accès du client d'essai à chacun, inséré par le propriétaire comme
    -- `create-client-access` l'insère — les cases posées à l'insertion (une insertion du cabinet pose les cases).
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (dn::uuid, 'ESSAI NOTES DE FRAIS DN', cabinet, 'tresorerie', '108000', 'exonere'),
      (da::uuid, 'ESSAI NOTES DE FRAIS DA', cabinet, 'tresorerie', '108000', 'exonere'),
      (ds::uuid, 'ESSAI NOTES DE FRAIS DS', cabinet, 'tresorerie', '108000', 'exonere');
    insert into memberships (id, user_id, dossier_id, role, email, droit_frais, droit_achats) values
      (acces_n::uuid, client::uuid, dn::uuid, 'client', 'essai-frais-n@example.test', true, false),
      (acces_a::uuid, client::uuid, da::uuid, 'client', 'essai-frais-a@example.test', true, true),
      (acces_s::uuid, client::uuid, ds::uuid, 'client', 'essai-frais-s@example.test', false, false);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord, ce que le CLIENT pose ensuite, le profil — `chef`
    -- (super-administrateur), `chef_simple` (le compte client rattaché au cabinet, le temps de l'étape), `client`, `inconnu`
    -- (un compte connecté sans aucun accès), `service` (le rôle des Edge Functions) ou `anon` —, sa requête, le code attendu
    -- (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}. Une mutation rejoue une étape après son instruction.
    for e in
      with etapes (rang, etape, pose, pose_client, profil, requete, code, attendu) as (values
        (1, '1. le client « Notes de frais » saisit un brouillon avec son ticket : à lui, version 1', '{PJN}', null, 'client',
          $q$select n.etat || ' ' || n.version || ' ' || (n.auteur::text = '{CLIENT}') || ' ' || n.montant_ttc || ' ' || n.montant_tva || ' ' || (n.piece_id::text = '{PN}') from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner avec un client', 24.50, 2.23, null, '{PN}', null, null, null, null) n$q$, 'OK', 'brouillon 1 true 24.50 2.23 true'),
        (2, '2. sans la case, il ne saisit pas (42501)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DS}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, null, null, null, null, null, null)$q$, '42501', 'Accès refusé à ce dossier.'),
        (3, '3. le cabinet ne saisit pas à la place du client (42501)', null, null, 'chef',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, null, null, null, null, null, null)$q$, '42501', 'Accès refusé à ce dossier.'),
        (4, '4. un compte connecté sans accès : les mêmes mots', null, null, 'inconnu',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, null, null, null, null, null, null)$q$, '42501', 'Accès refusé à ce dossier.'),
        (5, '5. des kilomètres au barème de 2026 : 45 km d''une voiture de 3 CV, 23,81 € (le demi-centime vers le haut)', null, null, 'client',
          $q$select n.etat || ' ' || n.montant_ttc || ' ' || n.montant_tva || ' ' || n.distance_km || ' ' || (n.piece_id is null) from enregistrer_note_de_frais('{DN}', null, null, '2026-11-03', 'kilometres', 'Visite chez un client', 23.81, null, null, null, 45, 'voiture', 3, false) n$q$, 'OK', 'brouillon 23.81 0.00 45 true'),
        (6, '6. un autre montant que le barème : refusé, jamais arrondi à sa place (22023)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-03', 'kilometres', 'Visite', 23.80, null, null, null, 45, 'voiture', 3, false)$q$, '22023', 'Le montant des kilomètres est celui du barème de 2026 pour cette distance et ce véhicule.'),
        (7, '7. une année sans barème en base : rien ne se calcule, ni n''emprunte une autre année (22023)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2024-06-03', 'kilometres', 'Visite', 23.81, null, null, null, 45, 'voiture', 3, false)$q$, '22023', 'Le barème kilométrique de 2024 n''est pas en base pour ce véhicule : rien ne se calcule à sa place.'),
        (8, '8. des kilomètres ne portent pas de TVA (22023)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-03', 'kilometres', 'Visite', 23.81, 1.00, null, null, 45, 'voiture', 3, false)$q$, '22023', 'Des kilomètres ne portent pas de TVA.'),
        (9, '9. ni de justificatif (22023)', '{PJN}', null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-03', 'kilometres', 'Visite', 23.81, null, null, '{PN}', 45, 'voiture', 3, false)$q$, '22023', 'Des kilomètres ne citent pas de justificatif : la date, la distance et le motif les justifient.'),
        (10, '10. un cyclomoteur de 5 CV n''a pas de ligne au barème : la base le dit (22023)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-03', 'kilometres', 'Visite', 14.18, null, null, null, 45, 'cyclomoteur', 5, false)$q$, '22023', 'Le barème kilométrique de 2026 n''est pas en base pour ce véhicule : rien ne se calcule à sa place.'),
        (11, '11. un repas ne décrit ni distance ni véhicule (22023)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, null, null, 45, null, null, null)$q$, '22023', 'Seuls des kilomètres décrivent une distance et un véhicule.'),
        (12, '12. une date à venir (22023)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2100-01-01', 'repas', 'Déjeuner', 24.50, null, null, null, null, null, null, null)$q$, '22023', 'La date de la dépense est requise, entre le 1er janvier 2000 et aujourd''hui.'),
        (13, '13. une nature hors de la liste (22023)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'cadeau', 'Déjeuner', 24.50, null, null, null, null, null, null, null)$q$, '22023', 'La nature de la dépense est repas, hébergement, transport, carburant, péage et stationnement, fournitures, kilomètres ou autre.'),
        (14, '14. un motif vide (22023)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', '   ', 24.50, null, null, null, null, null, null, null)$q$, '22023', 'Le motif tient sur une ligne, d''un à deux cents caractères.'),
        (15, '15. un TTC plus fin que le centime : refusé, jamais arrondi (22023)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.505, null, null, null, null, null, null, null)$q$, '22023', 'Le montant TTC est un nombre positif, au centime près.'),
        (16, '16. une TVA égale au TTC (22023)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.50, 24.50, null, null, null, null, null, null)$q$, '22023', 'La TVA déclarée est positive ou nulle, au centime près, et moindre que le TTC.'),
        (17, '17. le justificatif déposé par le cabinet n''est pas le sien (22023)', '{PJC}', null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, null, '{PC}', null, null, null, null)$q$, '22023', 'Le justificatif est une pièce que l''auteur de la note a déposée dans ce dossier.'),
        (18, '18. un justificatif déjà validé par le cabinet (22023)', '{PJV}', null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, null, '{PV}', null, null, null, null)$q$, '22023', 'Ce justificatif est déjà validé par le cabinet : il ne justifie plus une note de frais.'),
        (19, '19. un justificatif déjà cité par une autre note (22023)', '{PJN}', '{NOTE}', 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, null, '{PN}', null, null, null, null)$q$, '22023', 'Ce justificatif est déjà celui d''une autre note de frais.'),
        (20, '20. la note d''un salarié sans accès, sans la case « Achats » (42501)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, 'Salarié fictif A', null, null, null, null, null)$q$, '42501', 'Seul un accès « Achats » saisit la note d''un salarié sans accès.'),
        (21, '21. avec « Achats », le dirigeant la saisit', '{PJA}', null, 'client',
          $q$select n.beneficiaire_salarie || ' ' || n.etat || ' ' || (n.auteur::text = '{CLIENT}') from enregistrer_note_de_frais('{DA}', null, null, '2026-11-02', 'repas', 'Déjeuner d''équipe', 18.00, null, 'Salarié fictif A', '{PA}', null, null, null, null) n$q$, 'OK', 'Salarié fictif A brouillon true'),
        (22, '22. le nom du salarié avec un blanc en tête (22023)', null, null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DA}', null, null, '2026-11-02', 'repas', 'Déjeuner', 18.00, null, ' Salarié fictif A', null, null, null, null, null)$q$, '22023', 'Le nom du salarié tient sur une ligne, d''un à cent vingt caractères, sans blanc en tête ni en fin.'),
        (23, '23. le brouillon se modifie à la version lue', '{PJN}', '{NOTE}', 'client',
          $q$select n.version || ' ' || n.motif from enregistrer_note_de_frais('{DN}', (select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 1, '2026-11-02', 'repas', 'Déjeuner modifié', 24.50, 2.23, null, '{PN}', null, null, null, null) n$q$, 'OK', '2 Déjeuner modifié'),
        (24, '24. pas à une autre version que la sienne (22023)', '{PJN}', '{NOTE}', 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', (select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 2, '2026-11-02', 'repas', 'Déjeuner modifié', 24.50, 2.23, null, '{PN}', null, null, null, null)$q$, '22023', 'Cette note de frais a changé depuis sa lecture : la relire avant de l''écrire.'),
        (25, '25. le brouillon d''un autre compte ne se modifie pas (42501)', '{AUTRE_DN}', null, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', '{NZ}', 1, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, null, null, null, null, null, null)$q$, '42501', 'Accès refusé à cette note de frais.'),
        (30, '30. l''auteur soumet son brouillon : datée, version 2', '{PJN}', '{NOTE}', 'client',
          $q$select n.etat || ' ' || n.version || ' ' || (n.soumise_le is not null) from soumettre_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 1) n$q$, 'OK', 'soumise 2 true'),
        (31, '31. sans justificatif, un repas ne se soumet pas (22023)', null, $q$select 1 from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Sans ticket', 12.00, null, null, null, null, null, null, null)$q$, 'client',
          $q$select 1 from soumettre_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 1)$q$, '22023', 'Une note de frais se soumet avec son justificatif.'),
        (32, '32. un justificatif que le cabinet a validé depuis (22023)', $q${PJN}; {BROUILLON_CLIENT}; update pieces set statut = 'validee' where id = '{PN}'$q$, null, 'client',
          $q$select 1 from soumettre_note_de_frais('{NX}', 1)$q$, '22023', 'Ce justificatif est déjà validé par le cabinet : il ne justifie plus une note de frais.'),
        (33, '33. une note soumise ne se soumet plus (22023)', '{PJN}', $q${NOTE}; select 1 from soumettre_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 1)$q$, 'client',
          $q$select 1 from soumettre_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 2)$q$, '22023', 'Cette note de frais n''est plus un brouillon : elle ne se modifie plus.'),
        (34, '34. pas à une autre version que la sienne (22023)', '{PJN}', '{NOTE}', 'client',
          $q$select 1 from soumettre_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 7)$q$, '22023', 'Cette note de frais a changé depuis sa lecture : la relire avant de l''écrire.'),
        (35, '35. la note d''un autre compte ne se soumet pas (42501)', $q$insert into notes_de_frais (id, dossier_id, auteur, date_depense, nature, motif, montant_ttc) values ('{NX}', '{DN}', '{INCONNU}', '2026-11-02', 'transport', 'Train', 50)$q$, null, 'client',
          $q$select 1 from soumettre_note_de_frais('{NX}', 1)$q$, '42501', 'Accès refusé à cette note de frais.'),
        (36, '36. sa case « Notes de frais » décochée, l''auteur ne soumet plus (42501)', $q${PJN}; {BROUILLON_CLIENT}; select changer_droits_acces('{ACCN}', null, null, null, null, null, false, null)$q$, null, 'client',
          $q$select 1 from soumettre_note_de_frais('{NX}', 1)$q$, '42501', 'Accès refusé à cette note de frais.'),
        (37, '37. des kilomètres se soumettent au barème de leur année', null, '{KM}', 'client',
          $q$select n.etat || ' ' || n.montant_ttc from soumettre_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'kilometres'), 1) n$q$, 'OK', 'soumise 23.81'),
        (38, '38. un montant de kilomètres qui n''est plus celui du barème (une ligne restaurée) ne se soumet pas (22023)', $q$insert into notes_de_frais (id, dossier_id, auteur, date_depense, nature, motif, montant_ttc, distance_km, vehicule_type, puissance_fiscale, electrique) values ('{NX}', '{DN}', '{CLIENT}', '2026-11-03', 'kilometres', 'Visite', 23.80, 45, 'voiture', 3, false)$q$, null, 'client',
          $q$select 1 from soumettre_note_de_frais('{NX}', 1)$q$, '22023', 'Le barème kilométrique de 2026 a changé depuis l''enregistrement de la note : l''enregistrer de nouveau.'),
        (40, '40. l''auteur retire son brouillon : la ligne reste, retirée, le justificatif libéré', '{PJN}', '{NOTE}', 'client',
          $q$select n.etat || ' ' || (n.retiree_le is not null) || ' ' || (n.piece_id is null) || ' ' || (select count(*) from notes_de_frais x where x.dossier_id = '{DN}') from retirer_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 1) n$q$, 'OK', 'retiree true true 1'),
        (41, '41. une note soumise ne se retire pas (22023)', '{PJN}', $q${NOTE}; select 1 from soumettre_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 1)$q$, 'client',
          $q$select 1 from retirer_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 2)$q$, '22023', 'Seul un brouillon se retire : une note soumise reste.'),
        (42, '42. le justificatif libéré justifie une autre note', '{PJN}', $q${NOTE}; select 1 from retirer_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 1)$q$, 'client',
          $q$select n.etat || ' ' || (n.piece_id::text = '{PN}') from enregistrer_note_de_frais('{DN}', null, null, '2026-11-02', 'repas', 'Déjeuner, de nouveau', 24.50, null, null, '{PN}', null, null, null, null) n$q$, 'OK', 'brouillon true'),
        (43, '43. un brouillon retiré ne se modifie plus (22023)', '{PJN}', $q${NOTE}; select 1 from retirer_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 1)$q$, 'client',
          $q$select 1 from enregistrer_note_de_frais('{DN}', (select x.id from notes_de_frais x where x.dossier_id = '{DN}' and x.nature = 'repas'), 2, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, null, null, null, null, null, null)$q$, '22023', 'Cette note de frais n''est plus un brouillon : elle ne se modifie plus.'),
        (50, '50. l''accès « Achats » approuve la note soumise d''un autre compte : signée de lui', '{AUTRE_SOUMISE}', null, 'client',
          $q$select n.etat || ' ' || (n.approuvee_par::text = '{CLIENT}') || ' ' || (n.approuvee_le is not null) || ' ' || n.version from approuver_note_de_frais('{NX}', 1) n$q$, 'OK', 'approuvee true true 2'),
        (51, '51. le brouillon d''un autre compte lui reste caché : les mots d''une note inconnue (42501)', '{AUTRE_BROUILLON}', null, 'client',
          $q$select 1 from approuver_note_de_frais('{NY}', 1)$q$, '42501', 'Accès refusé à cette note de frais.'),
        (52, '52. un accès « Notes de frais » seul n''approuve pas (42501)', '{AUTRE_DN}', null, 'client',
          $q$select 1 from approuver_note_de_frais('{NZ}', 1)$q$, '42501', 'Accès refusé à cette note de frais.'),
        (53, '53. le cabinet approuve', '{AUTRE_SOUMISE}', null, 'chef_simple',
          $q$select n.etat from approuver_note_de_frais('{NX}', 1) n$q$, 'OK', 'approuvee'),
        (54, '54. son propre brouillon ne s''approuve pas (22023)', '{PJA}', $q$select 1 from enregistrer_note_de_frais('{DA}', null, null, '2026-11-02', 'repas', 'Déjeuner', 24.50, null, null, '{PA}', null, null, null, null)$q$, 'client',
          $q$select 1 from approuver_note_de_frais((select x.id from notes_de_frais x where x.dossier_id = '{DA}' and x.auteur = '{CLIENT}'), 1)$q$, '22023', 'Seule une note soumise s''approuve ou se refuse.'),
        (55, '55. pas à une autre version que la sienne (22023)', '{AUTRE_SOUMISE}', null, 'client',
          $q$select 1 from approuver_note_de_frais('{NX}', 3)$q$, '22023', 'Cette note de frais a changé depuis sa lecture : la relire avant de l''écrire.'),
        (56, '56. l''accès « Achats » refuse, sous un motif que l''auteur lira', '{AUTRE_SOUMISE}', null, 'client',
          $q$select n.etat || ' ' || n.motif_refus || ' ' || (n.refusee_par::text = '{CLIENT}') from refuser_note_de_frais('{NX}', 1, 'Hors de la politique de frais') n$q$, 'OK', 'refusee Hors de la politique de frais true'),
        (57, '57. pas sans motif (22023)', '{AUTRE_SOUMISE}', null, 'client',
          $q$select 1 from refuser_note_de_frais('{NX}', 1, '   ')$q$, '22023', 'Le motif du refus tient sur une ligne, d''un à deux cents caractères.'),
        (58, '58. l''accès « Achats » déclare le remboursement d''une note approuvée', '{AUTRE_APPROUVEE}', null, 'client',
          $q$select n.etat || ' ' || n.date_remboursement || ' ' || n.moyen_remboursement || ' ' || (n.remboursee_par::text = '{CLIENT}') || ' ' || (n.approuvee_par::text = '{CHEF}') from rembourser_note_de_frais('{NW}', 1, '2026-11-05', 'virement') n$q$, 'OK', 'remboursee 2026-11-05 virement true true'),
        (59, '59. une note soumise ne se rembourse pas (22023)', '{AUTRE_SOUMISE}', null, 'client',
          $q$select 1 from rembourser_note_de_frais('{NX}', 1, '2026-11-05', 'virement')$q$, '22023', 'Seule une note approuvée se rembourse.'),
        (60, '60. pas avant la dépense (22023)', '{AUTRE_APPROUVEE}', null, 'client',
          $q$select 1 from rembourser_note_de_frais('{NW}', 1, '2026-11-01', 'virement')$q$, '22023', 'La date du remboursement est requise, entre la date de la dépense et aujourd''hui.'),
        (61, '61. pas par un moyen hors de la liste (22023)', '{AUTRE_APPROUVEE}', null, 'client',
          $q$select 1 from rembourser_note_de_frais('{NW}', 1, '2026-11-05', 'bon d''achat')$q$, '22023', 'Le moyen du remboursement est virement, chèque, espèces, avec la paie ou autre.'),
        (62, '62. sa case « Achats » décochée, il ne décide plus (42501)', $q${AUTRE_SOUMISE}; select changer_droits_acces('{ACCA}', null, null, null, null, false, null, null)$q$, null, 'client',
          $q$select 1 from approuver_note_de_frais('{NX}', 1)$q$, '42501', 'Accès refusé à cette note de frais.'),
        (63, '63. le cabinet déclare un remboursement', '{AUTRE_APPROUVEE}', null, 'chef',
          $q$select n.etat || ' ' || n.moyen_remboursement from rembourser_note_de_frais('{NW}', 1, '2026-11-05', 'paie') n$q$, 'OK', 'remboursee paie'),
        (70, '70. l''auteur lit sa note', '{PJN}', '{NOTE}', 'client',
          $q$select count(*)::text from notes_de_frais where dossier_id = '{DN}'$q$, 'OK', '1'),
        (71, '71. sa case « Notes de frais » décochée, il ne la lit plus', $q${PJN}; {BROUILLON_CLIENT}; select changer_droits_acces('{ACCN}', null, null, null, null, null, false, null)$q$, null, 'client',
          $q$select count(*)::text from notes_de_frais where dossier_id = '{DN}'$q$, 'OK', '0'),
        (72, '72. l''accès « Achats » lit la note soumise d''un autre compte, pas son brouillon', '{AUTRE_SOUMISE}; {AUTRE_BROUILLON}', null, 'client',
          $q$select count(*)::text from notes_de_frais where dossier_id = '{DA}'$q$, 'OK', '1'),
        (73, '73. un accès « Notes de frais » seul ne lit pas la note d''un autre compte', '{AUTRE_DN}', null, 'client',
          $q$select count(*)::text from notes_de_frais where dossier_id = '{DN}'$q$, 'OK', '0'),
        (74, '74. le cabinet lit toutes les notes du dossier', '{AUTRE_SOUMISE}; {AUTRE_BROUILLON}', null, 'chef_simple',
          $q$select count(*)::text from notes_de_frais where dossier_id = '{DA}'$q$, 'OK', '2'),
        (75, '75. l''anonyme ne lit rien et n''exécute aucune des six fonctions', '{AUTRE_SOUMISE}', null, 'anon',
          $q$select (select count(*) from notes_de_frais) || ' ' || has_function_privilege('anon', 'public.enregistrer_note_de_frais(uuid, uuid, integer, date, text, text, numeric, numeric, text, uuid, integer, text, integer, boolean)', 'execute') || ' ' || has_function_privilege('anon', 'public.soumettre_note_de_frais(uuid, integer)', 'execute') || ' ' || has_function_privilege('anon', 'public.retirer_note_de_frais(uuid, integer)', 'execute') || ' ' || has_function_privilege('anon', 'public.approuver_note_de_frais(uuid, integer)', 'execute') || ' ' || has_function_privilege('anon', 'public.refuser_note_de_frais(uuid, integer, text)', 'execute') || ' ' || has_function_privilege('anon', 'public.rembourser_note_de_frais(uuid, integer, date, text)', 'execute')$q$, 'OK', '0 false false false false false false'),
        (76, '76. un compte connecté sans accès ne lit rien', '{AUTRE_SOUMISE}; {AUTRE_DN}', null, 'inconnu',
          $q$select count(*)::text from notes_de_frais$q$, 'OK', '0'),
        (80, '80. le client n''écrit pas une note en direct (la garde)', null, null, 'client',
          $q$insert into notes_de_frais (dossier_id, auteur, date_depense, nature, motif, montant_ttc) values ('{DN}', '{CLIENT}', '2026-11-02', 'repas', 'Déjeuner', 24.50) returning 1$q$, '42501', 'Une note de frais ne s''écrit que par ses fonctions.'),
        (81, '81. le rôle des Edge Functions ne la réécrit pas (la garde)', '{AUTRE_SOUMISE}', null, 'service',
          $q$update notes_de_frais set motif = 'Autre' where id = '{NX}' returning 1$q$, '42501', 'Une note de frais ne s''écrit que par ses fonctions.'),
        (82, '82. le super-administrateur ne réécrit rien : aucune policy de mise à jour, aucune ligne touchée', '{AUTRE_SOUMISE}', null, 'chef',
          $q$with t as (update notes_de_frais set motif = 'Autre' where id = '{NX}' returning 1) select (select count(*) from t)::text$q$, 'OK', '0'),
        (83, '83. la restauration ne cite pas un justificatif d''un autre dossier (la garde)', '{PJA}', null, 'chef',
          $q$insert into notes_de_frais (dossier_id, auteur, date_depense, nature, motif, montant_ttc, piece_id) values ('{DN}', '{CLIENT}', '2026-11-02', 'repas', 'Déjeuner', 24.50, '{PA}') returning 1$q$, '23514', 'Une note de frais cite un justificatif de son dossier.'),
        (84, '84. une note soumise ne se réécrit pas, même sous le réglage de ses fonctions : seul son passage s''y ajoute (la garde)', '{AUTRE_SOUMISE}', null, 'service',
          $q$with s as (select set_config('jd.notes_de_frais', '{NX}', true) as v) update notes_de_frais set etat = 'approuvee', approuvee_par = '{CHEF}', approuvee_le = now(), montant_ttc = 1 from s where id = '{NX}' returning 1$q$, '23514', 'Une note de frais soumise ne se réécrit pas : seul son passage suivant s''y ajoute.'),
        (85, '85. ni ne revient au brouillon (la garde)', '{AUTRE_SOUMISE}', null, 'service',
          $q$with s as (select set_config('jd.notes_de_frais', '{NX}', true) as v) update notes_de_frais set etat = 'brouillon', soumise_le = null from s where id = '{NX}' returning 1$q$, '23514', 'Une note de frais passe d''un brouillon à soumise ou retirée, de soumise à approuvée ou refusée, d''approuvée à remboursée : rien d''autre.'),
        (86, '86. le justificatif d''une note ne change pas de dossier (la garde de pieces)', $q${PJN}; {BROUILLON_CLIENT}$q$, null, 'chef_simple',
          $q$update pieces set dossier_id = '{DA}' where id = '{PN}' returning 1$q$, '23514', 'Cette pièce est le justificatif d''une note de frais : elle ne se supprime ni ne change de dossier tant que la note la cite.'),
        (87, '87. le rôle du personnel au catalogue : 421000 par défaut, lu dans le plan du dossier', null, null, 'chef',
          $q$select r.racines::text || ' ' || r.compte_defaut || ' ' || r.ordre || ' ' || (select p.compte || ' ' || p.libelle || ' ' || p.origine from plan_du_dossier('{DN}') p where p.role = 'personnel') from roles_comptables r where r.role = 'personnel'$q$, 'OK', '{421,4286} 421000 330 421000 Personnel — rémunérations dues application'),
        (88, '88. réglable par dossier sous ses racines : le 428600', $q$select regler_plan_du_dossier('{DN}', '[{"role": "personnel", "compte": "428600", "libelle": null, "prefixe_auxiliaire": null}]'::jsonb)$q$, null, 'chef',
          $q$select p.compte from plan_du_dossier('{DN}') p where p.role = 'personnel'$q$, 'OK', '428600'),
        (89, '89. pas sous le 467 du dirigeant non associé (22023)', null, null, 'chef',
          $q$select regler_plan_du_dossier('{DN}', '[{"role": "personnel", "compte": "467100", "libelle": null, "prefixe_auxiliaire": null}]'::jsonb)::text$q$, '22023', 'Le compte du rôle « personnel » commence par sa racine du plan comptable (421 ou 4286) : « 467100 » n''en est pas un.')
      ),
      mutations (m, libelle, ddl, rang) as (values
        ('M1', 'M1 — la lecture « Achats » passée à tout accès', $m$alter policy notes_de_frais_lecture_achats on public.notes_de_frais using (etat not in ('brouillon', 'retiree') and client_du_dossier(dossier_id, 'membre'))$m$, 73),
        ('M2', 'M2 — la lecture « Achats » des brouillons d''un autre', $m$alter policy notes_de_frais_lecture_achats on public.notes_de_frais using (client_du_dossier(dossier_id, 'achats'))$m$, 72),
        ('M3', 'M3 — la note d''un salarié sans la case « Achats »', $m$FONCTION:enregistrer_note_de_frais(uuid,uuid,integer,date,text,text,numeric,numeric,text,uuid,integer,text,integer,boolean):if not public.client_du_dossier(p_dossier_id, 'achats') then:if false then$m$, 20),
        ('M4', 'M4 — des kilomètres sans le barème', $m$FONCTION:enregistrer_note_de_frais(uuid,uuid,integer,date,text,text,numeric,numeric,text,uuid,integer,text,integer,boolean):if p_montant_ttc is null or p_montant_ttc * 100 <> v_centimes then:if false then$m$, 6),
        ('M5', 'M5 — le justificatif d''un autre déposant', $m$FONCTION:enregistrer_note_de_frais(uuid,uuid,integer,date,text,text,numeric,numeric,text,uuid,integer,text,integer,boolean): or v_piece.uploaded_by is distinct from auth.uid() then: then$m$, 17),
        ('M6', 'M6 — le brouillon d''un autre décidé par « Achats »', $m$FONCTION:approuver_note_de_frais(uuid,integer):and (v_note.etat not in ('brouillon', 'retiree') or v_note.auteur = auth.uid()):and true$m$, 51),
        ('M7', 'M7 — la soumission sans la version lue', $m$FONCTION:soumettre_note_de_frais(uuid,integer):if v_note.version is distinct from p_version_lue then:if false then$m$, 34),
        ('M8', 'M8 — la garde laisse réécrire une note soumise', $m$FONCTION:garder_note_de_frais():if (to_jsonb(new) - array['etat', 'version', 'modifiee_le'] - v_passage):if false and (to_jsonb(new) - array['etat', 'version', 'modifiee_le'] - v_passage)$m$, 84),
        ('M9', 'M9 — la garde laisse une note soumise revenir au brouillon', $m$FONCTION:garder_note_de_frais():or (old.etat = 'soumise' and new.etat in ('approuvee', 'refusee')):or (old.etat = 'soumise' and new.etat in ('approuvee', 'refusee', 'brouillon'))$m$, 85),
        ('M10', 'M10 — la garde de pieces laisse partir le justificatif', $m$FONCTION:garder_piece_d_une_note_de_frais():if exists (select 1 from public.notes_de_frais n where n.piece_id = old.id) then:if false then$m$, 86),
        ('M11', 'M11 — la lecture de l''auteur sans sa case', $m$alter policy notes_de_frais_lecture_auteur on public.notes_de_frais using (auteur = (select auth.uid()))$m$, 71)
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
        -- Les gabarits d'abord (une pièce, une note), puis les valeurs : aucun gabarit n'en porte un autre.
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
      v_ok := v_code = e.code and v_msg = e.attendu;
      if e.m is null then
        verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape, 'ok', v_ok, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
      else
        mutations := mutations || jsonb_build_object('rang', 100 + substr(e.m, 2)::int, 'etape', e.libelle || ' (l''étape ' || e.rang || ')',
          'ok', not v_ok and v_code <> 'ESSAI', 'observe', case when v_ok then '*** NE MORD PAS *** ' else 'le contrôle mord : ' end || v_code || ' ' || coalesce(v_msg, '-'));
      end if;
    end loop;

    -- Le catalogue : la RLS de la table, quatre policies à authenticated (hors la restrictive `deux_facteurs`), de lecture ou
    -- de restauration ; les lectures du client sous ses cases ; les fonctions et les gardes.
    verdicts := verdicts || jsonb_build_object('rang', 90, 'etape', '90. le catalogue : la RLS de la table, quatre policies à authenticated, aucune de mise à jour ni de suppression',
      'ok', (select c.relrowsecurity from pg_class c where c.oid = 'public.notes_de_frais'::regclass)
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'notes_de_frais'
               and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 4
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'notes_de_frais'
               and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')
               and (p.roles <> array['authenticated']::name[] or p.cmd not in ('SELECT', 'INSERT')
                    or (p.cmd = 'INSERT' and p.with_check <> 'is_super_admin()'))) = 0,
      'observe', 'relu au catalogue');
    verdicts := verdicts || jsonb_build_object('rang', 91, 'etape', '91. les lectures : le cabinet, l''auteur sous « Notes de frais », « Achats » hors des brouillons',
      'ok', (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'notes_de_frais' and (
               (p.policyname = 'notes_de_frais_lecture' and p.qual = 'admin_du_dossier(dossier_id)')
            or (p.policyname = 'notes_de_frais_lecture_auteur' and p.qual = '((auteur = ( SELECT auth.uid() AS uid)) AND client_du_dossier(dossier_id, ''frais''::text))')
            or (p.policyname = 'notes_de_frais_lecture_achats' and p.qual = '((etat <> ALL (ARRAY[''brouillon''::text, ''retiree''::text])) AND client_du_dossier(dossier_id, ''achats''::text))'))) = 3,
      'observe', 'relu au catalogue');
    verdicts := verdicts || jsonb_build_object('rang', 92, 'etape', '92. les six fonctions à authenticated, ni à l''anonyme ; les deux gardes à personne ; leurs déclencheurs',
      'ok', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
               and p.proname in ('enregistrer_note_de_frais', 'soumettre_note_de_frais', 'retirer_note_de_frais',
                                 'approuver_note_de_frais', 'refuser_note_de_frais', 'rembourser_note_de_frais')
               and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) = 6
        and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('garder_note_de_frais', 'garder_piece_d_une_note_de_frais')
               and not p.prosecdef and not has_function_privilege('authenticated', p.oid, 'execute')
               and not has_function_privilege('anon', p.oid, 'execute')) = 2
        and exists (select 1 from pg_trigger t where t.tgrelid = 'public.notes_de_frais'::regclass and t.tgname = 'notes_de_frais_garde'
                     and t.tgfoid = 'public.garder_note_de_frais()'::regprocedure and t.tgenabled = 'O')
        and exists (select 1 from pg_trigger t where t.tgrelid = 'public.pieces'::regclass and t.tgname = 'pieces_justificatif_d_une_note_de_frais'
                     and t.tgfoid = 'public.garder_piece_d_une_note_de_frais()'::regprocedure and t.tgenabled = 'O'),
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leurs pièces et notes, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (dn::uuid, da::uuid, ds::uuid))
      and not exists (select 1 from memberships where id in (acces_n::uuid, acces_a::uuid, acces_s::uuid))
      and not exists (select 1 from pieces where dossier_id in (dn::uuid, da::uuid, ds::uuid))
      and not exists (select 1 from notes_de_frais where dossier_id in (dn::uuid, da::uuid, ds::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.notes_de_frais', (verdicts || mutations)::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.notes_de_frais')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
