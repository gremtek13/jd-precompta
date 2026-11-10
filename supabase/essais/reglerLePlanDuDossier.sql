-- RÉGLER LE PLAN D'UN DOSSIER (ligne 43, étape PC4 ; la migration `regler_le_plan_du_dossier`, PRÉPARÉE le 10/11/2026,
-- supabase/preparees/). Le récit : HISTORIQUE.md, « 10/11/2026 — PC4 : RÉGLER LE PLAN D'UN DOSSIER, EN BASE (PRÉPARÉE,
-- PAS APPLIQUÉE) ». À rejouer par `execute_sql` après toute migration qui touche `regler_plan_du_dossier`, la garde du
-- plan, `plan_comptable_dossier` et ses policies, `roles_comptables`, `compte_du_role`, `cle_validation`,
-- `admin_du_dossier`, `refus_compte_de_contrepartie`, les déclencheurs de `dossiers`, de `lettrages_manuels` ou
-- d'`ecritures_brouillon`, ou les tables que le verrou du plan lit (les à-nouveaux, les soldes reportés, les lettrages, le
-- relevé, la révision, les encaissements).
--
-- Ce qui se prouve ici, et ne se relit pas : qui règle le plan (le cabinet à qui le dossier est ouvert, Q3 : ni le client,
-- ni un membre à qui il ne l'est pas, ni l'anonyme) ; le verrou (un dossier qui porte déjà quelque chose sur ses comptes ne
-- change plus de plan, et la fonction tient le verrou EXCLUSIF de la validation du dossier) ; chaque refus sous ses mots, et
-- leur ordre ; ce qu'elle écrit (le plan ENTIER, son origine, son auteur ; la porte refermée) ; le dirigeant qui suit son
-- rôle (PC3-Q1) ; les deux contrôles qui remplacent `dossiers_compte_notes_de_frais_check` et `lettrages_manuels_compte`,
-- EXACTEMENT aussi stricts que leurs listes sous le plan par défaut, et jugés contre le plan réglé ; la porte de la
-- restauration (le dirigeant d'un dossier restauré, le plan restauré jugé en fin de transaction, la policy du
-- super-administrateur) ; la garde des lignes de pièce ; le catalogue (la sécurité, les droits, les déclencheurs et leur
-- ordre, les policies, les contraintes retirées).
--
-- Trois dossiers jetables du cabinet du dossier `test` (préfixe `f4c00000-0000-4000-8000`) : DT, en trésorerie, dirigeant au
-- 455000, avec un accès du client d'essai, deux catégories propres et deux pièces ; DE, en engagement, dirigeant au 108000 ;
-- DR, un dossier que des étapes restaurent. Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) :
-- ce que le propriétaire pose d'abord, sous la session du super-administrateur, puis la requête du profil ; le jeu s'annule à
-- la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la
-- transaction (`essai.regler_le_plan`), que la requête finale lit : le fichier se joue d'un seul appel, ne crée ni table ni
-- fonction, ne contient aucune instruction de suppression ni de mise à jour sans `where`, et ne rend rien qui dépende d'une
-- ligne hors de ses dossiers. Ce qu'une suppression rencontre (une ligne du plan retirée directement, la pièce supprimée
-- sous un lettrage ou une ligne) et la course de deux sessions (une écriture qui attend un changement du plan) se jouent sur
-- une réplique, hors du dépôt. Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'f4c00000-0000-4000-8000-0000000000f1';
  dt constant text := 'f4c00000-0000-4000-8000-0000000000d1';
  de constant text := 'f4c00000-0000-4000-8000-0000000000d2';
  dr constant text := 'f4c00000-0000-4000-8000-0000000000d3';
  dx constant text := 'f4c00000-0000-4000-8000-0000000000d9';
  acces constant text := 'f4c00000-0000-4000-8000-0000000000a1';
  ct constant text := 'f4c00000-0000-4000-8000-0000000000c1';
  c108 constant text := 'f4c00000-0000-4000-8000-0000000000c2';
  p1 constant text := 'f4c00000-0000-4000-8000-0000000000b1';
  p2 constant text := 'f4c00000-0000-4000-8000-0000000000b2';
  fa constant text := 'f4c00000-0000-4000-8000-0000000000e1';
  en constant text := 'f4c00000-0000-4000-8000-0000000000e2';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- Le plan fictif décalé (`PLAN_DECALE` et `PREFIXES_DECALES`, src/lib/planComptable.ts) : les 32 rôles du catalogue,
  -- chacun sur un autre compte que son défaut, les trois tiers sous un autre préfixe.
  decale constant text := '[{"role": "banque", "compte": "512100"}, {"role": "tva_deductible", "compte": "445661"},
    {"role": "tva_immobilisations", "compte": "445621"}, {"role": "tva_collectee", "compte": "445711"},
    {"role": "tva_a_decaisser", "compte": "445511"}, {"role": "credit_tva_a_reporter", "compte": "445671"},
    {"role": "remboursement_tva_demande", "compte": "445831"}, {"role": "arrondi_charge", "compte": "658100"},
    {"role": "arrondi_produit", "compte": "758100"}, {"role": "fournisseurs", "compte": "401100", "prefixe_auxiliaire": "FO"},
    {"role": "fournisseurs_immobilisations", "compte": "404100", "prefixe_auxiliaire": "IM"},
    {"role": "clients", "compte": "411100", "prefixe_auxiliaire": "CL"}, {"role": "exploitant", "compte": "108100"},
    {"role": "associe", "compte": "455100"}, {"role": "autres_debiteurs_crediteurs", "compte": "467100"},
    {"role": "emprunt", "compte": "164100"}, {"role": "interets_emprunt", "compte": "661110"},
    {"role": "assurance_emprunt", "compte": "616810"}, {"role": "cotisations_exploitant", "compte": "646100"},
    {"role": "dotations_amortissements", "compte": "681110"}, {"role": "indemnites_kilometriques", "compte": "625111"},
    {"role": "virements_internes", "compte": "580100"}, {"role": "depots_cautionnements_verses", "compte": "275100"},
    {"role": "capital_individuel", "compte": "101100"}, {"role": "resultat_benefice", "compte": "120100"},
    {"role": "resultat_perte", "compte": "129100"}, {"role": "prestations_de_services", "compte": "706100"},
    {"role": "ventes_de_biens", "compte": "707100"}, {"role": "tva_collectee_en_attente", "compte": "445801"},
    {"role": "valeurs_a_l_encaissement", "compte": "511100"}, {"role": "caisse", "compte": "531000"},
    {"role": "services_bancaires", "compte": "627100"}]';
  -- Les phrases des refus, telles que la fonction et les déclencheurs les disent.
  verrou constant text := 'Le plan comptable de ce dossier ne se change plus : il porte déjà %s, qui resteraient sur les anciens comptes.';
  illisible constant text := 'Le rôle n° %s du plan ne se lit pas : un objet qui porte « role » et « compte » en texte, et au plus « libelle » et « prefixe_auxiliaire », en texte ou nuls.';
  liste constant text := 'Le plan se règle par la liste des rôles que le dossier règle : [{"role": …, "compte": …, "libelle": …, "prefixe_auxiliaire": …}].';
  six constant text := 'Le compte du rôle « %s » s''écrit en six chiffres : « %s » n''en est pas un.';
  racine constant text := 'Le compte du rôle « %s » commence par sa racine du plan comptable (%s) : « %s » n''en est pas un.';
  categorie constant text := 'Le compte « %s » du rôle « %s » est celui d''une catégorie que ce dossier emploie (« %s »), à des zéros près : un compte de bilan que l''application écrit ne se partage pas avec une catégorie.';
  libelle constant text := 'Le libellé du rôle « %s » tient sur une ligne, d''un à deux cents caractères ; nul, c''est celui du catalogue.';
  dirigeant constant text := 'Le compte du dirigeant (« %s ») n''est, dans le plan de ce dossier, le compte d''aucun des trois rôles du dirigeant : %s (associé), %s (exploitant), %s (autres débiteurs et créditeurs).';
  ligne_piece constant text := 'Une ligne de pièce au compte « %s » : sous cette racine, le plan de ce dossier tient le rôle « %s » au compte « %s ».';
  rls_plan constant text := 'new row violates row-level security policy for table "plan_comptable_dossier"';
  -- Régler le plan de DT (ou d'un autre dossier) : la requête, avec la liste à la place de {L}.
  regler constant text := $q$select regler_plan_du_dossier('{D}', '{L}'::jsonb)::text$q$;
  -- Les poses qui reviennent : le plan décalé réglé sur DT ; une écriture d'une pièce de DT.
  pose_decale constant text := $q$select regler_plan_du_dossier('{DT}', '{PD}'::jsonb)$q$;
  ligne constant text := $q$insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens) values ('{DT}', '{P}', '2026-03-01', '{C}', 'ESSAI PC4', 1, 'debit') returning compte$q$;
  e record; c text; v_code text; v_msg text; v_req text; v_pose text; v_obs text; n int;
  plans_avant bigint;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.regler_plan_du_dossier(uuid, jsonb)') is null then
    perform set_config('essai.regler_le_plan', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration regler_le_plan_du_dossier', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  if cabinet is null or not exists (select 1 from super_admins where user_id = chef::uuid)
     or exists (select 1 from dossiers where id in (dt::uuid, de::uuid, dr::uuid, dx::uuid))
     or exists (select 1 from cabinet_admins where user_id = client::uuid) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable (le cabinet du dossier test, un super-administrateur), identifiant d''essai déjà pris, ou compte client déjà rattaché au cabinet';
  end if;
  select count(*) into plans_avant from plan_comptable_dossier;
  begin
    -- Le jeu, par le propriétaire sous la session du super-administrateur.
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (dt::uuid, 'ESSAI PC4 DT', cabinet, 'tresorerie', '455000'),
      (de::uuid, 'ESSAI PC4 DE', cabinet, 'engagement', '108000');
    insert into memberships (id, user_id, dossier_id, role, email) values
      (acces::uuid, client::uuid, dt::uuid, 'client', 'essai-pc4@example.test');
    insert into categories (id, dossier_id, code, libelle, compte_comptable, poste_2035) values
      (ct::uuid, dt::uuid, 'essai_pc4_achats', 'Essai PC4 achats', '606100', 'Achats'),
      (c108::uuid, dt::uuid, 'essai_pc4_exploitant', 'Essai PC4 exploitant', '108000', null);
    insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, categorie_id, montant_ttc, date_piece) values
      (p1::uuid, dt::uuid, dt || '/essai-pc4-1.pdf', 'essai-pc4-1.pdf', 'achat', 'validee', ct::uuid, 12, '2026-03-01'),
      (p2::uuid, dt::uuid, dt || '/essai-pc4-2.pdf', 'essai-pc4-2.pdf', 'note_frais', 'validee', c108::uuid, 12, '2026-03-01');
    perform set_config('request.jwt.claims', '', true);

    -- Une étape : {rang, étape, ce que le PROPRIÉTAIRE pose d'abord sous la session du super-administrateur, le profil —
    -- `chef` (super-administrateur), `chef_simple` (le compte client rattaché au cabinet comme chef, le temps de l'étape),
    -- `membre` (rattaché comme comptable, le dossier non affecté), `membre_affecte`, `client`, `inconnu`, `anon`,
    -- `proprio` (le propriétaire, sans session), `proprio_chef` (le propriétaire, sous la session du super-administrateur) —,
    -- sa requête, le code attendu (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}.
    for e in select * from (values
      -- ══ Qui règle le plan (Q3 : comme le modèle comptable) ══
      (1, '1. l''anonyme n''exécute pas la fonction (42501)', null, 'anon', regler, '42501', 'permission denied for function regler_plan_du_dossier'),
      (2, '2. un compte rattaché à rien : refusé (42501)', null, 'inconnu', regler, '42501', 'Accès refusé à ce dossier.'),
      (3, '3. le client du dossier : refusé (42501)', null, 'client', regler, '42501', 'Accès refusé à ce dossier.'),
      (4, '4. un membre du cabinet à qui le dossier n''est pas ouvert : refusé (42501)', null, 'membre', regler, '42501', 'Accès refusé à ce dossier.'),
      (5, '5. un dossier qui n''existe pas : refusé (42501)', null, 'chef', replace(regler, '{D}', '{DX}'), '42501', 'Accès refusé à ce dossier.'),
      (6, '6. le membre à qui le dossier est ouvert le règle', null, 'membre_affecte', regler, 'OK', ''),
      (7, '7. un chef du cabinet qui n''est pas super-administrateur le règle', null, 'chef_simple', regler, 'OK', ''),
      (8, '8. le chef le règle', null, 'chef', regler, 'OK', ''),
      -- ══ Le verrou : un dossier qui porte déjà quelque chose sur ses comptes ══
      (10, '10. une écriture au brouillon (23514)',
        $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{DT}', '2026-03-01', '606100', 'ESSAI PC4', 1, 'debit')$q$,
        'chef', regler, '23514', format(verrou, '1 écriture(s) au brouillon')),
      (11, '11. un à-nouveau (23514)',
        $q$insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{DT}', '2026-01-01', '512000', 'Banque', 'debit', 1, 'essai pc4', repeat('0', 64))$q$,
        'chef', regler, '23514', format(verrou, '1 à-nouveau(x)')),
      (12, '12. un solde reporté (23514)',
        $q$insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{DT}', '2026-01-01', '512000', 'Banque', 'debit', 1, 'essai pc4', repeat('0', 64))$q$,
        'chef', regler, '23514', format(verrou, '1 solde(s) reporté(s)')),
      (13, '13. une pièce lettrée à la main (23514)',
        $q$insert into lettrages_manuels (dossier_id, groupe, piece_id, compte) values ('{DT}', gen_random_uuid(), '{P1}', '401000')$q$,
        'chef', regler, '23514', format(verrou, '1 pièce(s) lettrée(s) à la main')),
      (14, '14. un mouvement du relevé classé sur un compte de bilan (23514)',
        $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, compte_bilan) values ('{DT}', '2026-03-01', 'ESSAI PC4', -10, 'rapprochee', '275000')$q$,
        'chef', regler, '23514', format(verrou, '1 mouvement(s) du relevé classé(s) sur un compte de bilan')),
      (15, '15. une justification de solde de la révision (23514)',
        $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, portee, auteur) values ('{DT}', 2026, '512000', 0, 'justifie', 'exercice', '{CHEF}')$q$,
        'chef', regler, '23514', format(verrou, '1 justification(s) de solde de la révision')),
      (16, '16. une écriture et un à-nouveau : les deux dits, dans cet ordre',
        $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{DT}', '2026-03-01', '606100', 'ESSAI PC4', 1, 'debit');
           insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{DT}', '2026-01-01', '512000', 'Banque', 'debit', 1, 'essai pc4', repeat('0', 64))$q$,
        'chef', regler, '23514', format(verrou, '1 écriture(s) au brouillon, 1 à-nouveau(x)')),
      (17, '17. le verrou se dit avant la demande : une écriture, et une liste illisible',
        $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{DT}', '2026-03-01', '606100', 'ESSAI PC4', 1, 'debit')$q$,
        'chef', replace(regler, '{L}', '{"role": "banque"}'), '23514', format(verrou, '1 écriture(s) au brouillon')),
      -- ══ La demande, refus par refus ══
      (20, '20. une liste nulle (22023)', null, 'chef', $q$select regler_plan_du_dossier('{DT}', null)::text$q$, '22023', liste),
      (21, '21. un objet au lieu d''une liste (22023)', null, 'chef', replace(regler, '{L}', '{"role": "banque", "compte": "512100"}'), '22023', liste),
      (22, '22. un rôle qui n''est pas un objet (22023)', null, 'chef', replace(regler, '{L}', '[1]'), '22023', format(illisible, 1)),
      (23, '23. une clé inconnue, au rôle n° 2 (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "512100"}, {"role": "fournisseurs", "compte": "401100", "prefixe": "FO"}]'), '22023', format(illisible, 2)),
      (24, '24. un compte qui n''est pas un texte (22023)', null, 'chef', replace(regler, '{L}', '[{"role": "banque", "compte": 512100}]'), '22023', format(illisible, 1)),
      (25, '25. un libellé qui n''est ni un texte ni nul (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "512100", "libelle": ["Banque"]}]'), '22023', format(illisible, 1)),
      (26, '26. un rôle inconnu (22023)', null, 'chef', replace(regler, '{L}', '[{"role": "banquee", "compte": "512100"}]'), '22023', 'Rôle comptable inconnu : « banquee ».'),
      (27, '27. un rôle deux fois (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "512100"}, {"role": "banque", "compte": "512200"}]'), '22023',
        'Le rôle « banque » paraît deux fois dans le plan : un rôle, un compte.'),
      (28, '28. un compte de cinq chiffres (22023)', null, 'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "51210"}]'), '22023', format(six, 'banque', '51210')),
      (29, '29. un compte de sept chiffres (22023, Q5)', null, 'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "5121000"}]'), '22023', format(six, 'banque', '5121000')),
      (30, '30. un compte qui n''est pas fait de chiffres (22023)', null, 'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "512ABC"}]'), '22023', format(six, 'banque', '512ABC')),
      (31, '31. la banque hors de sa racine (22023)', null, 'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "411000"}]'), '22023', format(racine, 'banque', '512', '411000')),
      (32, '32. le dirigeant non associé au 468 : hors de sa racine tant que le catalogue ne la porte pas (43-Q7, PC4-Q2)', null, 'chef',
        replace(regler, '{L}', '[{"role": "autres_debiteurs_crediteurs", "compte": "468000"}]'), '22023', format(racine, 'autres_debiteurs_crediteurs', '467', '468000')),
      (33, '33. un rôle à deux racines les dit toutes deux (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "ventes_de_biens", "compte": "706100"}]'), '22023', format(racine, 'ventes_de_biens', '701 ou 707', '706100')),
      (34, '34. deux rôles du plan effectif sur le même compte (un rôle planté au catalogue le temps de l''étape) (22023)',
        $q$insert into roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre) values ('essai_chevauche', '{5121}', '512100', 'Essai', null, 9999)$q$,
        'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "512100"}]'), '22023',
        'Les rôles « banque » et « essai_chevauche » se tiendraient sur le même compte (« 512100 »), à des zéros près : un compte ne tient qu''un rôle.'),
      (35, '35. la banque changée vers le compte d''une catégorie du dossier (22023)',
        $q$update categories set compte_comptable = '512100' where id = '{CT}'$q$,
        'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "512100"}]'), '22023', format(categorie, '512100', 'banque', '512100')),
      (36, '36. … à des zéros près (22023)',
        $q$update categories set compte_comptable = '5121' where id = '{CT}'$q$,
        'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "512100"}]'), '22023', format(categorie, '512100', 'banque', '5121')),
      (37, '37. les fournisseurs changés vers le compte d''une catégorie commune (22023)',
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values (null, 'essai_pc4_commune', 'Essai PC4 commune', '401100')$q$,
        'chef', replace(regler, '{L}', '[{"role": "fournisseurs", "compte": "401100"}]'), '22023', format(categorie, '401100', 'fournisseurs', '401100')),
      (38, '38. la catégorie d''un AUTRE dossier ne retient rien',
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DE}', 'essai_pc4_autre', 'Essai PC4 autre', '512100')$q$,
        'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "512100"}]'), 'OK', ''),
      (39, '39. le compte du catalogue, inchangé, ne se refuse pas, même sur une catégorie',
        $q$update categories set compte_comptable = '512000' where id = '{CT}'$q$,
        'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "512000"}]'), 'OK', ''),
      (40, '40. un rôle de gestion (classe 6) sur le compte d''une catégorie passe : le refus vise les rôles du bilan',
        $q$update categories set compte_comptable = '616810' where id = '{CT}'$q$,
        'chef', replace(regler, '{L}', '[{"role": "assurance_emprunt", "compte": "616810"}]'), 'OK', ''),
      (41, '41. les indemnités kilométriques changées vers le compte d''une catégorie (22023)',
        $q$update categories set compte_comptable = '625111' where id = '{CT}'$q$,
        'chef', replace(regler, '{L}', '[{"role": "indemnites_kilometriques", "compte": "625111"}]'), '22023',
        'Le compte des indemnités kilométriques (« 625111 ») est celui d''une catégorie que ce dossier emploie (« 625111 »), à des zéros près : le barème et les frais réels restent séparés.'),
      (42, '42. … à des zéros près (22023)',
        $q$update categories set compte_comptable = '62512' where id = '{CT}'$q$,
        'chef', replace(regler, '{L}', '[{"role": "indemnites_kilometriques", "compte": "625120"}]'), '22023',
        'Le compte des indemnités kilométriques (« 625120 ») est celui d''une catégorie que ce dossier emploie (« 62512 »), à des zéros près : le barème et les frais réels restent séparés.'),
      (43, '43. un libellé blanc (22023)', null, 'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "512100", "libelle": "  "}]'), '22023', format(libelle, 'banque')),
      (44, '44. un libellé de 201 caractères (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "512100", "libelle": "' || repeat('B', 201) || '"}]'), '22023', format(libelle, 'banque')),
      (45, '45. un libellé sur deux lignes (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "512100", "libelle": "Banque\nprincipale"}]'), '22023', format(libelle, 'banque')),
      (46, '46. un libellé de 200 caractères passe', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "512100", "libelle": "' || repeat('B', 200) || '"}]'), 'OK', ''),
      (47, '47. un préfixe d''auxiliaires sur la banque (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "512100", "prefixe_auxiliaire": "BQ"}]'), '22023',
        'Seuls les comptes de tiers (fournisseurs, fournisseurs d''immobilisations, clients) portent un préfixe de comptes auxiliaires : pas le rôle « banque ».'),
      (48, '48. un préfixe en minuscules (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "fournisseurs", "compte": "401100", "prefixe_auxiliaire": "fo"}]'), '22023',
        'Le préfixe des comptes auxiliaires du rôle « fournisseurs » s''écrit d''une à cinq lettres majuscules ou chiffres : « fo » n''en est pas un.'),
      (49, '49. un préfixe de six caractères (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "fournisseurs", "compte": "401100", "prefixe_auxiliaire": "FOURNI"}]'), '22023',
        'Le préfixe des comptes auxiliaires du rôle « fournisseurs » s''écrit d''une à cinq lettres majuscules ou chiffres : « FOURNI » n''en est pas un.'),
      (50, '50. le préfixe des clients du catalogue pris par les fournisseurs (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "fournisseurs", "compte": "401100", "prefixe_auxiliaire": "C"}]'), '22023',
        'Les rôles « fournisseurs » et « clients » partageraient le préfixe de comptes auxiliaires « C » : deux natures de tiers ne partagent pas un compte auxiliaire.'),
      (51, '51. deux préfixes demandés égaux (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "clients", "compte": "411100", "prefixe_auxiliaire": "X1"}, {"role": "fournisseurs_immobilisations", "compte": "404100", "prefixe_auxiliaire": "X1"}]'), '22023',
        'Les rôles « fournisseurs_immobilisations » et « clients » partageraient le préfixe de comptes auxiliaires « X1 » : deux natures de tiers ne partagent pas un compte auxiliaire.'),
      (52, '52. un compte de contrepartie d''un encaissement que le nouveau plan refuserait (23514)',
        $q$insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht, montant_tva, montant_ttc, validated_at, nature_operation, option_debits) values ('{FA}', '{DT}', 'F2026-0001', 'validee', 'facture', '2026-03-02', 'ESSAI', '12345678900012', 100, 0, 100, now(), 'services', false);
           insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva) values ('{FA}', 1, 'ESSAI', 1, 100, 0);
           insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, compte_contrepartie) values ('{EN}', '{DT}', '{FA}', '2026-03-05', 100, 'compensation', '512100');
           insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values ('{EN}', '{DT}', 0, 100)$q$,
        'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "512100"}]'), '23514',
        'Sous ce plan, le compte de contrepartie « 512100 » d''un encaissement serait refusé : Un encaissement par la banque, par chèque ou en espèces se dit par son moyen de paiement, qui choisit son compte. Choisir d''abord un autre compte pour cet encaissement.'),
      (53, '53. … un encaissement retiré ne retient rien',
        $q$insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht, montant_tva, montant_ttc, validated_at, nature_operation, option_debits) values ('{FA}', '{DT}', 'F2026-0001', 'validee', 'facture', '2026-03-02', 'ESSAI', '12345678900012', 100, 0, 100, now(), 'services', false);
           insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva) values ('{FA}', 1, 'ESSAI', 1, 100, 0);
           insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, compte_contrepartie, retire_le) values ('{EN}', '{DT}', '{FA}', '2026-03-05', 100, 'compensation', '512100', now());
           insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values ('{EN}', '{DT}', 0, 100)$q$,
        'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "512100"}]'), 'OK', ''),
      (54, '54. l''ordre : six chiffres (refus 6) au rôle n° 2 l''emportent sur la racine (refus 7) au rôle n° 1', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "411000"}, {"role": "clients", "compte": "4111"}]'), '22023', format(six, 'clients', '4111')),
      (55, '55. l''ordre : un rôle inconnu (refus 4) au rôle n° 2 l''emporte sur six chiffres (refus 6) au rôle n° 1', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "5121"}, {"role": "banquee", "compte": "512100"}]'), '22023', 'Rôle comptable inconnu : « banquee ».'),
      -- ══ Ce qu'elle écrit ══
      (60, '60. le plan décalé s''écrit tout entier : 32 lignes, d''origine « dossier », réglées par le chef', pose_decale, 'proprio',
        $q$select count(*) || ' ' || bool_and(origine = 'dossier') || ' ' || bool_and(regle_par = '{CHEF}') from plan_comptable_dossier where dossier_id = '{DT}'$q$,
        'OK', '32 true true'),
      (61, '61. plan_du_dossier le rend rôle par rôle, préfixes compris ; compte_du_role aussi', pose_decale, 'chef',
        $q$select (select count(*) from plan_du_dossier('{DT}') p join jsonb_array_elements('{PD}'::jsonb) x(e) on x.e ->> 'role' = p.role
                   where p.compte = x.e ->> 'compte' and p.origine = 'dossier'
                     and p.prefixe_auxiliaire is not distinct from coalesce(x.e ->> 'prefixe_auxiliaire', (select r.prefixe_auxiliaire_defaut from roles_comptables r where r.role = p.role)))
                || ' ' || (select count(*) from jsonb_array_elements('{PD}'::jsonb) x(e) where compte_du_role('{DT}', x.e ->> 'role') = x.e ->> 'compte')$q$,
        'OK', '32 32'),
      (62, '62. le dirigeant suit son rôle, en trésorerie : 455000, puis 455100', pose_decale, 'proprio',
        $q$select compte_notes_de_frais from dossiers where id = '{DT}'$q$, 'OK', '455100'),
      (63, '63. … en engagement : 108000, puis 108100', $q$select regler_plan_du_dossier('{DE}', '{PD}'::jsonb)$q$, 'proprio',
        $q$select compte_notes_de_frais from dossiers where id = '{DE}'$q$, 'OK', '108100'),
      (64, '64. … le dirigeant non associé : 467000, puis 467100',
        $q$update dossiers set compte_notes_de_frais = '467000' where id = '{DE}'; select regler_plan_du_dossier('{DE}', '{PD}'::jsonb)$q$, 'proprio',
        $q$select compte_notes_de_frais from dossiers where id = '{DE}'$q$, 'OK', '467100'),
      (65, '65. le plan ENTIER : un second réglage remplace le premier, le dirigeant revient au catalogue',
        $q$select regler_plan_du_dossier('{DT}', '{PD}'::jsonb); select regler_plan_du_dossier('{DT}', '[{"role": "banque", "compte": "512200"}]'::jsonb)$q$, 'proprio',
        $q$select (select count(*) from plan_comptable_dossier where dossier_id = '{DT}') || ' ' || compte_du_role('{DT}', 'banque') || ' ' || compte_du_role('{DT}', 'associe') || ' ' || (select compte_notes_de_frais from dossiers where id = '{DT}')$q$,
        'OK', '1 512200 455000 455000'),
      (66, '66. la liste vide rend le plan par défaut',
        $q$select regler_plan_du_dossier('{DT}', '{PD}'::jsonb); select regler_plan_du_dossier('{DT}', '[]'::jsonb)$q$, 'proprio',
        $q$select (select count(*) from plan_comptable_dossier where dossier_id = '{DT}') || ' ' || compte_du_role('{DT}', 'banque') || ' ' || (select compte_notes_de_frais from dossiers where id = '{DT}')$q$,
        'OK', '0 512000 455000'),
      (67, '67. le libellé et le préfixe réglés se lisent',
        $q$select regler_plan_du_dossier('{DT}', '[{"role": "fournisseurs", "compte": "401100", "libelle": "Fournisseurs divers", "prefixe_auxiliaire": "FO"}]'::jsonb)$q$, 'chef',
        $q$select p.compte || '|' || p.libelle || '|' || p.prefixe_auxiliaire || '|' || p.origine from plan_du_dossier('{DT}') p where p.role = 'fournisseurs'$q$,
        'OK', '401100|Fournisseurs divers|FO|dossier'),
      (68, '68. la porte est refermée après l''appel', pose_decale, 'proprio',
        $q$select coalesce(nullif(current_setting('jd.regler_plan_du_dossier', true), ''), 'refermée')$q$, 'OK', 'refermée'),
      -- Une liste vide sur un plan vide : ni insertion ni retrait, la garde du plan (qui prend aussi le verrou exclusif pour
      -- une ligne insérée) ne joue pas ; le verrou qui reste est celui de la fonction.
      (69, '69. la fonction prend elle-même le verrou EXCLUSIF de la validation du dossier, tenu jusqu''à la fin de la transaction',
        $q$select regler_plan_du_dossier('{DT}', '[]'::jsonb)$q$, 'proprio',
        $q$select count(*)::text from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.mode = 'ExclusiveLock' and l.granted
                 and ((l.classid::bigint << 32) | l.objid::bigint) = cle_validation('{DT}')$q$, 'OK', '1'),
      -- ══ Le compte du dirigeant, contre le plan (remplace dossiers_compte_notes_de_frais_check) ══
      (75, '75. sous le plan réglé, l''ancien compte du dirigeant se refuse (23514)', pose_decale, 'proprio',
        $q$update dossiers set compte_notes_de_frais = '455000' where id = '{DT}' returning compte_notes_de_frais$q$, '23514',
        format(dirigeant, '455000', '455100', '108100', '467100')),
      (76, '76. … le compte d''un autre rôle du dirigeant du plan passe', pose_decale, 'proprio',
        $q$update dossiers set compte_notes_de_frais = '467100' where id = '{DT}' returning compte_notes_de_frais$q$, 'OK', '467100'),
      (77, '77. … et par le chef, sous la RLS (le choix d''Écritures)', pose_decale, 'chef',
        $q$update dossiers set compte_notes_de_frais = '108100' where id = '{DT}' returning compte_notes_de_frais$q$, 'OK', '108100'),
      (78, '78. le modèle figé se dit d''abord, comme hier (le déclencheur BEFORE passe avant le contrôle)',
        $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{DT}', '2026-03-01', '606100', 'ESSAI PC4', 1, 'debit')$q$, 'proprio',
        $q$update dossiers set compte_notes_de_frais = '512000' where id = '{DT}' returning compte_notes_de_frais$q$, '23514',
        'Le modèle comptable d''un dossier ne se change que tant que son brouillon d''écritures est vide.'),
      (79, '79. la restauration : le super-administrateur insère un dossier au dirigeant réglé', null, 'proprio_chef',
        $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) select '{DR}', 'ESSAI PC4 DR', cabinet_id, 'engagement', '455100' from dossiers where id = '{DT}' returning compte_notes_de_frais$q$,
        'OK', '455100'),
      (80, '80. … pas hors des racines du dirigeant, même lui (23514)', null, 'proprio_chef',
        $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) select '{DR}', 'ESSAI PC4 DR', cabinet_id, 'engagement', '512000' from dossiers where id = '{DT}' returning compte_notes_de_frais$q$,
        '23514', format(dirigeant, '512000', '455000', '108000', '467000')),
      (81, '81. … ni sans la session du super-administrateur (23514)', null, 'proprio',
        $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) select '{DR}', 'ESSAI PC4 DR', cabinet_id, 'engagement', '455100' from dossiers where id = '{DT}' returning compte_notes_de_frais$q$,
        '23514', format(dirigeant, '455100', '455000', '108000', '467000')),
      (82, '82. une valeur inchangée ne se rejuge pas',
        $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) select '{DR}', 'ESSAI PC4 DR', cabinet_id, 'engagement', '455100' from dossiers where id = '{DT}'$q$, 'proprio',
        $q$update dossiers set compte_notes_de_frais = '455100', nom = 'ESSAI PC4 DR bis' where id = '{DR}' returning compte_notes_de_frais$q$, 'OK', '455100'),
      -- ══ Le plan restauré, jugé en fin de transaction ══
      (85, '85. un plan restauré qui laisse le dirigeant hors de ses rôles (23514, en fin de transaction)',
        $q$insert into plan_comptable_dossier (dossier_id, role, compte) values ('{DT}', 'associe', '455100')$q$, 'proprio',
        $q$set constraints plan_comptable_dossier_dirigeant immediate$q$, '23514', format(dirigeant, '455000', '455100', '108000', '467000')),
      (86, '86. un plan restauré qui garde le dirigeant à son rôle passe',
        $q$insert into plan_comptable_dossier (dossier_id, role, compte) values ('{DT}', 'banque', '512100')$q$, 'proprio',
        $q$set constraints plan_comptable_dossier_dirigeant immediate; set constraints plan_comptable_dossier_dirigeant deferred; select 'jugé'$q$, 'OK', 'jugé'),
      (87, '87. le dossier restauré au 455100, puis son plan : il passe',
        $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) select '{DR}', 'ESSAI PC4 DR', cabinet_id, 'engagement', '455100' from dossiers where id = '{DT}';
           insert into plan_comptable_dossier (dossier_id, role, compte) values ('{DR}', 'associe', '455100')$q$, 'proprio',
        $q$set constraints plan_comptable_dossier_dirigeant immediate; set constraints plan_comptable_dossier_dirigeant deferred; select 'jugé'$q$, 'OK', 'jugé'),
      (88, '88. sous la RLS, la policy de la restauration ouvre l''insertion au super-administrateur', null, 'chef',
        $q$insert into plan_comptable_dossier (dossier_id, role, compte) values ('{DT}', 'banque', '512100') returning compte$q$, 'OK', '512100'),
      (89, '89. … pas à un chef qui n''est pas super-administrateur : la garde le refuse d''abord (42501)', null, 'chef_simple',
        $q$insert into plan_comptable_dossier (dossier_id, role, compte) values ('{DT}', 'banque', '512100') returning compte$q$, '42501',
        'Le plan comptable d''un dossier ne s''écrit pas directement : il se règle par regler_plan_du_dossier, et seule la restauration d''une sauvegarde, par l''administrateur de l''application, y insère une ligne.'),
      (90, '90. … et, la garde ouverte (la porte de la fonction posée), la policy le refuse encore (42501)',
        $q$select set_config('jd.regler_plan_du_dossier', '{DT}', true)$q$, 'chef_simple',
        $q$insert into plan_comptable_dossier (dossier_id, role, compte) values ('{DT}', 'banque', '512100') returning compte$q$, '42501', rls_plan),
      (91, '91. … ni au membre à qui le dossier est ouvert (42501)',
        $q$select set_config('jd.regler_plan_du_dossier', '{DT}', true)$q$, 'membre_affecte',
        $q$insert into plan_comptable_dossier (dossier_id, role, compte) values ('{DT}', 'banque', '512100') returning compte$q$, '42501', rls_plan),
      (95, '95. … et au client (42501)',
        $q$select set_config('jd.regler_plan_du_dossier', '{DT}', true)$q$, 'client',
        $q$insert into plan_comptable_dossier (dossier_id, role, compte) values ('{DT}', 'banque', '512100') returning compte$q$, '42501', rls_plan),
      (92, '92. la porte d''un AUTRE dossier n''ouvre pas la garde (42501)',
        $q$select set_config('jd.regler_plan_du_dossier', '{DE}', true)$q$, 'proprio',
        $q$insert into plan_comptable_dossier (dossier_id, role, compte) values ('{DT}', 'banque', '512100') returning compte$q$, '42501',
        'Le plan comptable d''un dossier ne s''écrit pas directement : il se règle par regler_plan_du_dossier, et seule la restauration d''une sauvegarde, par l''administrateur de l''application, y insère une ligne.'),
      (93, '93. … celle de SON dossier, si (le chemin de la fonction)',
        $q$select set_config('jd.regler_plan_du_dossier', '{DT}', true)$q$, 'proprio',
        $q$insert into plan_comptable_dossier (dossier_id, role, compte) values ('{DT}', 'banque', '512100') returning compte$q$, 'OK', '512100'),
      (94, '94. une ligne du plan ne se modifie toujours pas, même sous la porte (42501)',
        $q$select regler_plan_du_dossier('{DT}', '{PD}'::jsonb); select set_config('jd.regler_plan_du_dossier', '{DT}', true)$q$, 'proprio',
        $q$update plan_comptable_dossier set compte = '512200' where dossier_id = '{DT}' and role = 'banque' returning compte$q$, '42501',
        'Une ligne du plan comptable d''un dossier ne se modifie pas directement.'),
      -- ══ Les lettrages faits à la main, contre le plan (remplace lettrages_manuels_compte) ══
      (100, '100. sous le plan réglé, le compte de tiers du plan se lettre', pose_decale, 'proprio',
        $q$insert into lettrages_manuels (dossier_id, groupe, compte) values ('{DT}', gen_random_uuid(), '401100') returning compte$q$, 'OK', '401100'),
      (101, '101. … celui d''hier, non (23514)', pose_decale, 'proprio',
        $q$insert into lettrages_manuels (dossier_id, groupe, compte) values ('{DT}', gen_random_uuid(), '401000') returning compte$q$, '23514',
        'Le compte « 401000 » n''est pas, dans le plan de ce dossier, un compte de tiers qui se lettre : 401100, 404100, 411100, 455100, 467100.'),
      (102, '102. un lettrage dont on change le compte se rejuge (23514)',
        $q$insert into lettrages_manuels (dossier_id, groupe, compte) values ('{DT}', '{EN}', '401000')$q$, 'proprio',
        $q$update lettrages_manuels set compte = '512000' where dossier_id = '{DT}' and groupe = '{EN}' returning compte$q$, '23514',
        'Le compte « 512000 » n''est pas, dans le plan de ce dossier, un compte de tiers qui se lettre : 401000, 404000, 411000, 455000, 467000.'),
      -- ══ Les lignes de pièce, contre le plan (garder_comptes_des_pieces) ══
      (110, '110. sous le plan réglé, une ligne de pièce au compte d''hier se refuse (23514)', pose_decale, 'proprio',
        replace(replace(ligne, '{P}', '{P1}'), '{C}', '512000'), '23514', format(ligne_piece, '512000', 'banque', '512100')),
      (111, '111. … au compte du plan, elle passe', pose_decale, 'proprio', replace(replace(ligne, '{P}', '{P1}'), '{C}', '512100'), 'OK', '512100'),
      (112, '112. … la TVA d''hier se refuse (23514)', pose_decale, 'proprio',
        replace(replace(ligne, '{P}', '{P1}'), '{C}', '445660'), '23514', format(ligne_piece, '445660', 'tva_deductible', '445661')),
      (113, '113. … la caisse d''hier se refuse (23514)', pose_decale, 'proprio',
        replace(replace(ligne, '{P}', '{P1}'), '{C}', '530000'), '23514', format(ligne_piece, '530000', 'caisse', '531000')),
      (114, '114. … l''associé d''hier se refuse (23514)', pose_decale, 'proprio',
        replace(replace(ligne, '{P}', '{P1}'), '{C}', '455000'), '23514', format(ligne_piece, '455000', 'associe', '455100')),
      (115, '115. … le client d''hier se refuse (23514)', pose_decale, 'proprio',
        replace(replace(ligne, '{P}', '{P1}'), '{C}', '411000'), '23514', format(ligne_piece, '411000', 'clients', '411100')),
      (116, '116. … la catégorie de sa pièce au compte de l''exploitant d''hier : sa charge y passe', pose_decale, 'proprio',
        replace(replace(ligne, '{P}', '{P2}'), '{C}', '108000'), 'OK', '108000'),
      (117, '117. … la même ligne sur une pièce d''une autre catégorie se refuse (23514)', pose_decale, 'proprio',
        replace(replace(ligne, '{P}', '{P1}'), '{C}', '108000'), '23514', format(ligne_piece, '108000', 'exploitant', '108100')),
      (118, '118. … une ligne sans pièce n''est pas la sienne', pose_decale, 'proprio',
        $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{DT}', '2026-03-01', '512000', 'ESSAI PC4', 1, 'debit') returning compte$q$, 'OK', '512000'),
      (119, '119. … une ligne hors des racines gardées passe', pose_decale, 'proprio', replace(replace(ligne, '{P}', '{P1}'), '{C}', '606100'), 'OK', '606100'),
      (120, '120. le compte d''une ligne changé se rejuge (23514)',
        $q$select regler_plan_du_dossier('{DT}', '{PD}'::jsonb); insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens) values ('{DT}', '{P1}', '2026-03-01', '512100', 'ESSAI PC4', 1, 'debit')$q$, 'proprio',
        $q$update ecritures_brouillon set compte = '512000' where dossier_id = '{DT}' and piece_id = '{P1}' returning compte$q$, '23514', format(ligne_piece, '512000', 'banque', '512100')),
      (121, '121. sa date changée (le rapprochement la redate) ne la rejuge pas',
        $q$update categories set compte_comptable = '108100' where id = '{C108}';
           insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens) values ('{DT}', '{P2}', '2026-03-01', '108100', 'ESSAI PC4', 1, 'debit');
           update categories set compte_comptable = '108000' where id = '{C108}'$q$, 'proprio',
        $q$update ecritures_brouillon set date = '2026-03-02' where dossier_id = '{DT}' and piece_id = '{P2}' returning compte$q$, 'OK', '108100')
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        elsif e.profil in ('membre', 'membre_affecte') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable');
          if e.profil = 'membre_affecte' then
            insert into dossier_assignations (dossier_id, user_id) values (dt::uuid, client::uuid);
          end if;
        end if;
        if e.pose is not null then
          v_pose := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(e.pose,
            '{PD}', decale), '{DT}', dt), '{DE}', de), '{DR}', dr), '{CT}', ct), '{C108}', c108), '{P1}', p1), '{P2}', p2), '{FA}', fa), '{EN}', en), '{CHEF}', chef);
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(e.requete,
          '{L}', '[]'), '{D}', '{DT}'), '{PD}', decale), '{DT}', dt), '{DE}', de), '{DR}', dr), '{DX}', dx), '{CT}', ct), '{C108}', c108),
          '{P1}', p1), '{P2}', p2), '{FA}', fa), '{EN}', en), '{CHEF}', chef);
        begin
          if e.profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          elsif e.profil = 'proprio' then
            perform set_config('request.jwt.claims', '', true);
          elsif e.profil = 'proprio_chef' then
            perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
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
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and v_msg = e.attendu, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;

    -- ══ 130 à 133. EXACTEMENT aussi strict que les listes d'hier, sous le plan par défaut ══
    -- Chaque candidat, par le propriétaire sans session (comme une contrainte, que la RLS ne voit pas), dans sa
    -- sous-transaction : ceux qui passent, dans l'ordre des candidats. Les listes d'hier : 455000, 108000, 467000 ; 401000,
    -- 404000, 411000, 455000, 467000.
    v_obs := '';
    foreach c in array array['455000', '108000', '467000', '455100', '108100', '467100', '468000', '512000', '4550000', '455'] loop
      begin
        update dossiers set compte_notes_de_frais = c where id = de::uuid;
        v_obs := v_obs || c || ' ';
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' and sqlstate <> '23514' then v_obs := v_obs || c || ':' || sqlstate || ' '; end if;
      end;
    end loop;
    verdicts := verdicts || jsonb_build_object('rang', 130, 'etape', '130. sous le plan par défaut, le dirigeant d''un dossier ne prend que les trois comptes d''hier',
      'ok', v_obs = '455000 108000 467000 ', 'observe', v_obs);
    v_obs := '';
    foreach c in array array['455000', '108000', '467000', '455100', '108100', '467100', '468000', '512000', '4550000', '455'] loop
      begin
        insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values (dr::uuid, 'ESSAI PC4 DR', cabinet, 'tresorerie', c);
        v_obs := v_obs || c || ' ';
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' and sqlstate <> '23514' then v_obs := v_obs || c || ':' || sqlstate || ' '; end if;
      end;
    end loop;
    verdicts := verdicts || jsonb_build_object('rang', 131, 'etape', '131. … et un dossier créé hors de la restauration aussi',
      'ok', v_obs = '455000 108000 467000 ', 'observe', v_obs);
    v_obs := '';
    foreach c in array array['401000', '404000', '411000', '455000', '467000', '108000', '512000', '401100', '4010000', '445660'] loop
      begin
        insert into lettrages_manuels (dossier_id, groupe, compte) values (dt::uuid, gen_random_uuid(), c);
        v_obs := v_obs || c || ' ';
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' and sqlstate <> '23514' then v_obs := v_obs || c || ':' || sqlstate || ' '; end if;
      end;
    end loop;
    verdicts := verdicts || jsonb_build_object('rang', 132, 'etape', '132. sous le plan par défaut, un lettrage fait à la main ne prend que les cinq comptes d''hier',
      'ok', v_obs = '401000 404000 411000 455000 467000 ', 'observe', v_obs);
    -- Les lignes de pièce : sous le plan par défaut, chaque compte de rôle que la génération écrit passe, et aucun autre
    -- compte sous leurs racines ; un compte hors de ces racines passe.
    v_obs := '';
    foreach c in array array['512000', '530000', '445660', '445620', '445710', '401000', '404000', '411000', '108000', '455000', '467000',
                             '606100', '512100', '531000', '445661', '445621', '445711', '401100', '404100', '411100', '108100', '455100', '467100'] loop
      begin
        insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens) values (dt::uuid, p1::uuid, '2026-03-01', c, 'ESSAI PC4', 1, 'debit');
        v_obs := v_obs || c || ' ';
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' and not (sqlstate = '23514' and sqlerrm like 'Une ligne de pièce au compte%') then
          v_obs := v_obs || c || ':' || sqlstate || ' ';
        end if;
      end;
    end loop;
    verdicts := verdicts || jsonb_build_object('rang', 133, 'etape', '133. sous le plan par défaut, une ligne de pièce passe sur chaque compte de rôle que la génération écrit, et sur aucun autre compte de leurs racines',
      'ok', v_obs = '512000 530000 445660 445620 445710 401000 404000 411000 108000 455000 467000 606100 ', 'observe', v_obs);

    -- ══ 140 à 145. Le catalogue ══
    select string_agg(p.proname || ':' || case when p.prosecdef then 'definer' else 'invoker' end || ':' || p.provolatile::text || ':' || l.lanname
             || ':' || coalesce(array_to_string(p.proconfig, ','), '') || ':anon=' || has_function_privilege('anon', p.oid, 'execute')
             || ':connecte=' || has_function_privilege('authenticated', p.oid, 'execute'), ' ; ' order by p.proname collate "C")
      into v_obs
      from pg_proc p join pg_language l on l.oid = p.prolang
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('regler_plan_du_dossier', 'garder_plan_comptable_dossier', 'garder_compte_du_dirigeant', 'garder_dirigeant_du_plan',
                         'garder_compte_lettrable', 'garder_comptes_des_pieces');
    verdicts := verdicts || jsonb_build_object('rang', 140, 'etape', '140. les fonctions : aux droits du propriétaire, search_path fixé ; la fonction exécutée par les connectés seuls, les gardes par personne',
      'ok', v_obs = 'garder_compte_du_dirigeant:definer:v:plpgsql:search_path=public:anon=false:connecte=false ; '
                 || 'garder_compte_lettrable:definer:v:plpgsql:search_path=public:anon=false:connecte=false ; '
                 || 'garder_comptes_des_pieces:definer:v:plpgsql:search_path=public:anon=false:connecte=false ; '
                 || 'garder_dirigeant_du_plan:definer:v:plpgsql:search_path=public:anon=false:connecte=false ; '
                 || 'garder_plan_comptable_dossier:definer:v:plpgsql:search_path=public:anon=false:connecte=false ; '
                 || 'regler_plan_du_dossier:definer:v:plpgsql:search_path=public:anon=false:connecte=true',
      'observe', v_obs);
    select string_agg(pg_get_triggerdef(t.oid), ' ; ' order by t.tgname collate "C") into v_obs from pg_trigger t
     where not t.tgisinternal and t.tgname in ('dossiers_compte_du_dirigeant', 'plan_comptable_dossier_dirigeant',
                                               'lettrages_manuels_un_compte_qui_se_lettre', 'ecritures_brouillon_comptes_des_pieces');
    verdicts := verdicts || jsonb_build_object('rang', 141, 'etape', '141. les quatre déclencheurs : leurs tables, leurs moments, leurs colonnes, le différé du plan',
      'ok', v_obs = 'CREATE TRIGGER dossiers_compte_du_dirigeant AFTER INSERT OR UPDATE OF compte_notes_de_frais ON public.dossiers FOR EACH ROW EXECUTE FUNCTION garder_compte_du_dirigeant() ; '
                 || 'CREATE TRIGGER ecritures_brouillon_comptes_des_pieces BEFORE INSERT OR UPDATE OF compte, piece_id, dossier_id ON public.ecritures_brouillon FOR EACH ROW WHEN ((new.piece_id IS NOT NULL)) EXECUTE FUNCTION garder_comptes_des_pieces() ; '
                 || 'CREATE TRIGGER lettrages_manuels_un_compte_qui_se_lettre BEFORE INSERT OR UPDATE OF compte, dossier_id ON public.lettrages_manuels FOR EACH ROW EXECUTE FUNCTION garder_compte_lettrable() ; '
                 || 'CREATE CONSTRAINT TRIGGER plan_comptable_dossier_dirigeant AFTER INSERT OR DELETE ON public.plan_comptable_dossier DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION garder_dirigeant_du_plan()',
      'observe', v_obs);
    -- L'ordre des déclencheurs BEFORE : la garde des lignes de pièce avant celle qui prenait seule le verrou partagé ; la
    -- garde du lettrage après celle de l'exemplaire d'une facture source. Depuis A8-Q5 (le jour J, 10/11/2026), la garde des
    -- règlements d'une pièce citée par une facture reprise (`ecritures_brouillon_piece_d_une_facture_reprise`), après elle.
    select string_agg(t.tgname, ',' order by t.tgname collate "C") into v_obs from pg_trigger t
     where not t.tgisinternal and (t.tgtype & 2) = 2 and t.tgrelid in ('public.ecritures_brouillon'::regclass, 'public.lettrages_manuels'::regclass);
    verdicts := verdicts || jsonb_build_object('rang', 142, 'etape', '142. l''ordre des déclencheurs BEFORE du brouillon et des lettrages',
      'ok', v_obs = 'ecritures_brouillon_caisse,ecritures_brouillon_comptes_des_pieces,ecritures_brouillon_intangibles,ecritures_brouillon_paiement_personnel,'
                 || 'ecritures_brouillon_piece_d_une_facture_reprise,'
                 || 'ecritures_brouillon_sans_exemplaire_d_une_source,ecritures_brouillon_vente_facturee,ecritures_brouillon_vente_facturee_lignes,'
                 || 'lettrages_manuels_sans_exemplaire_d_une_source,lettrages_manuels_un_compte_qui_se_lettre',
      'observe', v_obs);
    select string_agg(p.policyname || ':' || p.permissive || ':' || array_to_string(p.roles, ',') || ':' || p.cmd || ':' || coalesce(p.qual, '')
             || ':' || coalesce(p.with_check, ''), ' ; ' order by p.policyname collate "C") into v_obs
      from pg_policies p where p.schemaname = 'public' and p.tablename = 'plan_comptable_dossier'
       and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE');
    verdicts := verdicts || jsonb_build_object('rang', 143, 'etape', '143. les policies du plan : la lecture du cabinet, l''insertion de la restauration au super-administrateur',
      'ok', v_obs = 'plan_comptable_dossier_lecture:PERMISSIVE:authenticated:SELECT:admin_du_dossier(dossier_id): ; '
                 || 'plan_comptable_dossier_restauration:PERMISSIVE:authenticated:INSERT::is_super_admin()',
      'observe', v_obs);
    select count(*) into n from pg_constraint c where c.conname in ('dossiers_compte_notes_de_frais_check', 'lettrages_manuels_compte');
    verdicts := verdicts || jsonb_build_object('rang', 144, 'etape', '144. les deux contraintes en dur sont retirées',
      'ok', n = 0, 'observe', n || ' en base');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni l'accès, ni le compte d'essai dans le cabinet, ni une ligne du plan (l'écart
  -- seul), ni un rôle planté au catalogue.
  verdicts := verdicts || jsonb_build_object('rang', 199, 'etape', '199. rien n''est resté : ni les dossiers jetables, ni l''accès, ni le compte d''essai dans le cabinet, ni une ligne du plan, ni un rôle planté',
    'ok', not exists (select 1 from dossiers where id in (dt::uuid, de::uuid, dr::uuid, dx::uuid))
      and not exists (select 1 from memberships where id = acces::uuid)
      and not exists (select 1 from cabinet_admins where user_id = client::uuid)
      and not exists (select 1 from categories where code like 'essai\_pc4%')
      and not exists (select 1 from roles_comptables where role = 'essai_chevauche')
      and (select count(*) from plan_comptable_dossier) = plans_avant,
    'observe', 'relu');
  perform set_config('essai.regler_le_plan', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.regler_le_plan')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
