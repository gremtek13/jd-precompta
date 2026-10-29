-- LA BASE LIT LE PLAN (ligne 43, étape PC2), ÉPROUVÉE EN BASE — à rejouer par `execute_sql` après toute migration qui
-- touche l'une des quatorze fonctions que l'étape PC2 fait lire dans le plan d'un dossier (conception, § 2.3),
-- `compte_du_role`, `compte_du_dirigeant`, `cle_validation`, `plan_comptable_dossier` ou sa garde.
--
-- Ce qui se prouve ici :
--   - LA FORME, dans le catalogue : chacune des quatorze lit le plan (`compte_du_role`, et `compte_du_dirigeant` pour les
--     cinq qui lisent le compte du dirigeant) et ne nomme plus aucun compte de rôle en dur ; elle nomme exactement ses
--     rôles, tous au catalogue ; les douze qui écrivent prennent le verrou PARTAGÉ de leur dossier, à la clé de
--     `cle_validation`, AVANT leur première lecture du plan ; leur sécurité, leur volatilité, leur langage et leur
--     `search_path` n'ont pas bougé ; chaque lecture du plan porte le dossier de l'appel, jamais un autre ;
--   - LE PLAN LU, sous le plan fictif décalé (`PLAN_DECALE`, src/lib/planComptable.ts), posé par la seule porte ouverte —
--     la restauration, par le super-administrateur, dans un dossier sans écriture —, chaque fois dans un dossier JETABLE
--     créé dans la sous-transaction du contrôle, avec ses mouvements, son emprunt, ses échéances, son bien, son véhicule
--     ou ses déclarations : chaque fonction ACCEPTE l'écriture composée aux comptes du plan et l'écrit telle quelle,
--     REFUSE celle composée aux comptes d'avant, sous ses mots, et les deux lectrices rendent les comptes du plan.
--     L'essai ne dépend d'aucun dossier réel ni de ses écritures : du cabinet de `test`, des catégories et de la nature
--     communes, et d'un super-administrateur. Un compte remis en dur ou un rôle lu pour un autre y fait tomber un
--     contrôle — ce que les essais de chaque mécanisme, joués au plan par défaut, où le défaut d'un rôle EST le compte
--     d'avant, ne peuvent pas voir ;
--   - et que RIEN ne reste en base.
-- Le verrou ne se voit à l'œuvre qu'à deux sessions (une écriture attend la validation en cours, ou un changement du
-- plan) : la course se joue sur une réplique, hors du dépôt ; ici, sa forme, sa clé et sa place dans le texte.
--
-- AVANT LES MIGRATIONS `la_base_lit_le_plan_1` À `_6` (`pc2_exigee` à faux), une fonction qui ne lit pas encore le plan
-- se disait EN ATTENTE, sans être en faute — le fichier se rejouait entre-temps après d'autres migrations, et entre deux
-- collages. La production les porte et l'export aussi : `pc2_exigee` est vrai, et une fonction qui ne lit pas le plan
-- est une faute (src/lib/planComptable.test.ts exige l'un avec l'autre).
--
-- ÉPROUVÉ LE 10/10/2026 sur une réplique égale à la production (116 migrations, neuf familles de signature.sql) : avant
-- les six migrations, 54 lignes, 0 en faute dont 46 EN ATTENTE (46 fautes quand `pc2_exigee` est vrai) ; entre deux
-- collages, 0 en faute ; après, 54 lignes, 0 en faute. 212 mutations de la migration — un rôle lu pour un autre, le plan
-- d'un autre dossier, un compte remis en dur à la lecture ou à l'usage (même sous une forme que le texte ne trahit pas),
-- le case du dirigeant recopié, le verrou retiré, déplacé, à une autre clé, d'un autre dossier, exclusif ou de session,
-- la sécurité ou la volatilité changée — : 211 vues ici, la dernière ÉQUIVALENTE (les deux arrondis d'ecrire_liquidation_tva
-- échangés : ils ne servent qu'ensemble, dans un `in`) ; les essais de chaque mécanisme, joués au plan par défaut, n'en
-- voyaient que 42. Le contrôle 7 et l'étape 48 viennent de cette campagne.
--
-- JOUÉ EN PRODUCTION LE 11/10/2026, après les six migrations (125) : 54 lignes, la ligne 0 et 53 verdicts, tous vrais,
-- aucun EN ATTENTE ; le texte reçu par la base est le fichier tel qu'il était alors, saut de ligne final compris
-- (69 359 caractères, empreinte 9fe63d1f…) ; le contrôle 99 compte les mêmes lignes avant et après, les dossiers
-- inchangés, et les préalables relus ensuite (identifiants d'essai, plan des dossiers) n'ont pas bougé.
--
-- Chaque contrôle du plan décalé s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), son verdict posé dans une
-- VARIABLE avant le `raise` — le mécanisme de rls.sql. Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.la_base_lit_le_plan`), que la requête finale lit : le fichier se joue d'un seul appel et ne crée aucune table.
-- Il ne porte AUCUNE instruction de suppression, ni de mise à jour sans `where` — l'outil d'exécution retient l'une et
-- l'autre pour une confirmation qui n'arrive pas. Les objets d'essai (dossiers jetables, emprunt, échéances, bien,
-- véhicule, déclarations) portent des identifiants fixes et vivent dans la sous-transaction de leur contrôle.
--
-- ADAPTÉ LE 29/10/2026 (ligne 26.6, étape C1b : la migration `caisse_retrait_et_versement`, PRÉPARÉE, à coller) : elle
-- fait lire aussi à `ecrire_mouvement_compte_bilan` le compte de la caisse du plan (le versement d'espèces en banque).
-- La liste des quatorze dit l'EXPORT, que src/lib/planComptable.test.ts confronte au texte exporté : elle garde
-- « banque » ; le contrôle 3 attend, de la base munie de la migration, le rôle `caisse` en plus (`caisse_du_releve`).
-- Sans la migration, rien ne change. ÉTAPE C2 : la liste garde « banque » même le jour où la migration entre dans
-- l'export — le test y ajoute alors `caisse` de lui-même, comme ce contrôle selon la base —, et rien ne se retouche ici
-- ce jour-là (HISTORIQUE.md, « LA CAISSE : LE MODULE, LA LECTURE ET LA SAUVEGARDE (C2, LIGNE 26.6) »).
do $$
declare
  -- Faux jusqu'à ce que la production porte les six migrations et que l'export les ait reçues ; vrai ensuite.
  pc2_exigee constant boolean := true;
  -- La caisse du relevé (étape C1b) : sa migration en base, `ecrire_mouvement_compte_bilan` lit aussi le rôle `caisse`.
  caisse_du_releve constant boolean := to_regprocedure('public.retirer_operation_caisse(uuid, uuid)') is not null;
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  -- Le dossier `test` ne prête que son cabinet aux dossiers jetables.
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  -- Les dossiers jetables (la TVA, le report des soldes, les mouvements) et les objets d'essai.
  d_tva uuid := 'e55b4000-0000-4000-8000-000000000001';
  d_ind uuid := 'e55b4000-0000-4000-8000-000000000002';
  d_ben uuid := 'e55b4000-0000-4000-8000-000000000003';
  d_per uuid := 'e55b4000-0000-4000-8000-000000000004';
  d_108 uuid := 'e55b4000-0000-4000-8000-000000000005';
  d_mvt uuid := 'e55b4000-0000-4000-8000-000000000006';
  emp uuid := 'e55b4000-0000-4000-8001-000000000001';
  cot uuid := 'e55b4000-0000-4000-8001-000000000002';
  cot_perso uuid := 'e55b4000-0000-4000-8001-000000000003';
  bien uuid := 'e55b4000-0000-4000-8001-000000000004';
  vehicule uuid := 'e55b4000-0000-4000-8001-000000000005';
  m_paie uuid := 'e55b4000-0000-4000-8002-000000000001';
  m_remb uuid := 'e55b4000-0000-4000-8002-000000000002';
  m_debit uuid := 'e55b4000-0000-4000-8002-000000000003';
  m_credit uuid := 'e55b4000-0000-4000-8002-000000000004';
  t_q4 uuid := 'e55b4000-0000-4000-8003-000000000001';
  t_q3 uuid := 'e55b4000-0000-4000-8003-000000000002';
  t_q2 uuid := 'e55b4000-0000-4000-8003-000000000003';

  -- Le plan fictif décalé : chaque rôle sur un autre compte que son défaut, sous sa racine (`PLAN_DECALE`).
  plan_sql constant text := $q$insert into plan_comptable_dossier (dossier_id, role, compte) select %L, v.role, v.compte from (values
    ('banque', '512100'), ('tva_deductible', '445661'), ('tva_immobilisations', '445621'), ('tva_collectee', '445711'),
    ('tva_a_decaisser', '445511'), ('credit_tva_a_reporter', '445671'), ('remboursement_tva_demande', '445831'),
    ('arrondi_charge', '658100'), ('arrondi_produit', '758100'), ('fournisseurs', '401100'),
    ('fournisseurs_immobilisations', '404100'), ('clients', '411100'), ('exploitant', '108100'), ('associe', '455100'),
    ('autres_debiteurs_crediteurs', '467100'), ('emprunt', '164100'), ('interets_emprunt', '661110'),
    ('assurance_emprunt', '616810'), ('cotisations_exploitant', '646100'), ('dotations_amortissements', '681110'),
    ('indemnites_kilometriques', '625111'), ('virements_internes', '580100'), ('depots_cautionnements_verses', '275100'),
    ('capital_individuel', '101100'), ('resultat_benefice', '120100'), ('resultat_perte', '129100')) as v(role, compte)$q$;

  -- Le dossier jetable des mouvements, en trésorerie, au 455000, non assujetti (les défauts d'un dossier), et ses deux
  -- mouvements à traiter : un débit de 100 € et un crédit de 120 €, en 2025.
  mvt_sql constant text := $q$insert into dossiers (id, nom, cabinet_id, code_email)
      values (%1$L, 'ESSAI PLAN MOUVEMENTS', %2$L, 'essaiplanmvt' || substr(md5(gen_random_uuid()::text), 1, 10));
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut)
      values (%3$L, %1$L, '2025-03-10', 'ESSAI PLAN DEBIT', -100, 'non_rapprochee'),
             (%4$L, %1$L, '2025-03-12', 'ESSAI PLAN CREDIT', 120, 'non_rapprochee')$q$;

  -- Les quatorze : leur signature, les rôles qu'elles nomment, si elles lisent le dirigeant, l'expression du dossier dont
  -- elles prennent le verrou (nulle pour les deux lectrices), celles qui désignent ce dossier dans une lecture du plan
  -- (`id` et `d.id` : la ligne de `dossiers` choisie par ce dossier), et leur forme (sécurité, volatilité, langage,
  -- réglages). src/lib/planComptable.test.ts lit cette liste, la confronte au catalogue, et exige du texte exporté la
  -- même forme.
  quatorze constant jsonb := '[
    {"f": "affecter_mouvement_bancaire(uuid, uuid, jsonb, numeric)", "roles": "banque,tva_collectee", "dirigeant": false,
     "verrou": "v_ligne.dossier_id", "lus": ["v_ligne.dossier_id"], "forme": "invoker:v:plpgsql:search_path=public"},
    {"f": "classer_virement_personnel(uuid, jsonb)", "roles": "banque", "dirigeant": true,
     "verrou": "v_ligne.dossier_id", "lus": ["v_ligne.dossier_id"], "forme": "invoker:v:plpgsql:search_path=public"},
    {"f": "ecrire_mouvement_compte_bilan(uuid, text, jsonb)", "roles": "banque", "dirigeant": true,
     "verrou": "v_ligne.dossier_id", "lus": ["v_ligne.dossier_id", "id"], "forme": "invoker:v:plpgsql:search_path=public"},
    {"f": "ventiler_mouvement_bancaire(uuid, jsonb, jsonb)", "roles": "banque,tva_collectee", "dirigeant": true,
     "verrou": "v_ligne.dossier_id", "lus": ["v_ligne.dossier_id", "id"], "forme": "invoker:v:plpgsql:search_path=public"},
    {"f": "rapprocher_echeance_emprunt(uuid, uuid, integer, numeric, numeric, jsonb)",
     "roles": "assurance_emprunt,banque,emprunt,interets_emprunt", "dirigeant": false,
     "verrou": "v_ligne.dossier_id", "lus": ["v_ligne.dossier_id"], "forme": "invoker:v:plpgsql:search_path=public"},
    {"f": "rapprocher_cotisation(uuid, uuid, jsonb)", "roles": "banque,cotisations_exploitant,exploitant", "dirigeant": false,
     "verrou": "v_ligne.dossier_id", "lus": ["v_ligne.dossier_id"], "forme": "invoker:v:plpgsql:search_path=public"},
    {"f": "rapprocher_declaration_tva(uuid, uuid, jsonb)", "roles": "banque,remboursement_tva_demande,tva_a_decaisser",
     "dirigeant": false, "verrou": "v_ligne.dossier_id", "lus": ["v_ligne.dossier_id"],
     "forme": "invoker:v:plpgsql:search_path=public"},
    {"f": "ecrire_dotation_amortissement(uuid, integer, jsonb)", "roles": "dotations_amortissements", "dirigeant": false,
     "verrou": "v_immo.dossier_id", "lus": ["v_immo.dossier_id"], "forme": "invoker:v:plpgsql:search_path=public"},
    {"f": "ecrire_forfait_kilometrique(uuid, jsonb)", "roles": "indemnites_kilometriques", "dirigeant": true,
     "verrou": "v_vehicule.dossier_id", "lus": ["v_vehicule.dossier_id"], "forme": "invoker:v:plpgsql:search_path=public"},
    {"f": "ecrire_liquidation_tva(uuid, jsonb)", "roles": "arrondi_charge,arrondi_produit", "dirigeant": false,
     "verrou": "v_declaration.dossier_id", "lus": ["v_declaration.dossier_id"], "forme": "invoker:v:plpgsql:search_path=public"},
    {"f": "liquidation_attendue(uuid)",
     "roles": "arrondi_charge,arrondi_produit,credit_tva_a_reporter,remboursement_tva_demande,tva_a_decaisser,tva_collectee,tva_deductible,tva_immobilisations",
     "dirigeant": false, "verrou": null, "lus": ["dossier_id", "d.dossier_id"], "forme": "invoker:s:sql:search_path=public"},
    {"f": "lettrer_pieces(uuid, text, uuid[])",
     "roles": "associe,autres_debiteurs_crediteurs,clients,fournisseurs,fournisseurs_immobilisations", "dirigeant": false,
     "verrou": "p_dossier_id", "lus": ["p_dossier_id"], "forme": "invoker:v:plpgsql:search_path=public"},
    {"f": "soldes_a_reporter(uuid, integer)", "roles": "capital_individuel,exploitant,resultat_benefice,resultat_perte",
     "dirigeant": false, "verrou": null, "lus": ["d.id"], "forme": "invoker:s:sql:search_path=public"},
    {"f": "enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb)", "roles": "cotisations_exploitant",
     "dirigeant": true, "verrou": "cle_validation", "lus": ["p_dossier_id", "d.id"], "forme": "definer:v:plpgsql:search_path=public"}
  ]';

  cabinet uuid;
  debit record; credit record; cat_frais record; cat_recettes record; nature_info uuid;
  m_d numeric; m_c numeric; tva_c numeric; tva_v numeric; part_v numeric;
  cle_texte text; f jsonb; corps text; lu boolean; prets text[] := '{}'; attente text[] := '{}';
  n int; k int; obs text; texte text; manque text; ok boolean; observe text;
  roles_vus text; en_dur text; avant_lecture int; position_verrou int;
  e jsonb; etapes jsonb; accepte boolean; code_recu text; message text;
  avant text; apres text; config_avant text;
  verdicts jsonb := '[]'::jsonb;
begin
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  -- Les deux mouvements du dossier jetable (`mvt_sql`), tels que les contrôles les désignent.
  select m_debit as id, -100.00::numeric as montant, date '2025-03-10' as date into debit;
  select m_credit as id, 120.00::numeric as montant, date '2025-03-12' as date into credit;
  select * into cat_frais from categories where code = 'frais_bancaires' and dossier_id is null;
  select * into cat_recettes from categories where code = 'ventes_prestations' and dossier_id is null;
  select id into nature_info from natures_immobilisation
   where dossier_id is null and libelle = 'Informatique (ordinateur, imprimante...)';
  if cabinet is null or cat_frais.id is null or cat_recettes.id is null or nature_info is null
     or not exists (select 1 from super_admins where user_id = chef)
     or exists (select 1 from dossiers where id in (d_tva, d_ind, d_ben, d_per, d_108, d_mvt))
     or exists (select 1 from lignes_bancaires where id in (m_debit, m_credit, m_paie, m_remb)) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable (le cabinet du dossier test, les catégories et la nature communes, un super-administrateur) ou identifiant d''essai déjà pris';
  end if;
  m_d := abs(debit.montant);
  m_c := credit.montant;
  tva_c := public.tva_incluse(m_c, 20);
  part_v := m_c - 5;
  tva_v := public.tva_incluse(part_v, 20);
  select concat_ws('/', (select count(*) from plan_comptable_dossier), (select count(*) from ecritures_brouillon),
      (select count(*) from dossiers), (select count(*) from lignes_bancaires), (select count(*) from emprunts),
      (select count(*) from cotisations_declarees), (select count(*) from immobilisations), (select count(*) from vehicules),
      (select count(*) from declarations_tva), (select count(*) from lettrages_manuels), (select count(*) from a_nouveaux),
      (select count(*) from soldes_reportes), (select count(*) from exercices_valides), (select count(*) from ventilations_bancaires))
    into avant;
  select string_agg(id || ':' || mode_comptable || ':' || compte_notes_de_frais || ':' || assujetti_tva, ',' order by id)
    into config_avant from dossiers;

  -- ══ 1 à 7. La forme, dans le catalogue ══
  -- La clé de `cle_validation`, lue dans son corps : le verrou écrit en ligne doit être celui-là, au caractère près.
  select (regexp_match(p.prosrc, 'hashtextextended\((''[^'']*'') \|\| p_dossier_id::text, 0\)'))[1] into cle_texte
    from pg_proc p where p.oid = to_regprocedure('public.cle_validation(uuid)');
  for f in select * from jsonb_array_elements(quatorze) loop
    select p.prosrc ~ 'public\.compte_du_(role|dirigeant)\(' into lu from pg_proc p where p.oid = to_regprocedure('public.' || (f->>'f'));
    if coalesce(lu, false) then prets := prets || (f->>'f'); else attente := attente || (f->>'f'); end if;
  end loop;
  verdicts := verdicts || jsonb_build_object('controle',
      case when cardinality(attente) = 0 then '1. les quatorze lisent le plan'
           when pc2_exigee then '1. les quatorze lisent le plan'
           else '1. EN ATTENTE : ' || cardinality(prets) || ' des quatorze lisent le plan (les migrations la_base_lit_le_plan ne sont pas toutes en base)' end,
    'observe', cardinality(prets) || ' sur 14' || coalesce(' ; pas encore : ' || nullif(array_to_string(attente, ', '), ''), ''),
    'ok', cardinality(prets) = 14 or not pc2_exigee);

  -- 2. Aucun compte de rôle en dur : aucun défaut du catalogue entre apostrophes.
  select string_agg(x.f || ' (' || x.comptes || ')', ', ' order by x.f) into en_dur from (
    select q.f, string_agg(distinct m[1], ',') as comptes
      from unnest(prets) as q(f)
      join pg_proc p on p.oid = to_regprocedure('public.' || q.f)
      cross join lateral regexp_matches(p.prosrc, '''(' || (select string_agg(compte_defaut, '|') from roles_comptables) || ')''', 'g') as m
     group by q.f) x;
  verdicts := verdicts || jsonb_build_object('controle', '2. celles qui lisent le plan ne nomment plus aucun compte de rôle en dur',
    'observe', coalesce(en_dur, 'aucune') || ' (' || cardinality(prets) || ' lue(s))', 'ok', en_dur is null);

  -- 3. Chacune nomme exactement ses rôles, tous au catalogue ; les cinq du dirigeant le lisent par compte_du_dirigeant.
  n := 0; obs := null;
  for f in select * from jsonb_array_elements(quatorze) loop
    continue when not (f->>'f' = any (prets));
    select p.prosrc into corps from pg_proc p where p.oid = to_regprocedure('public.' || (f->>'f'));
    select string_agg(r.role, ',' order by r.role collate "C") into roles_vus from roles_comptables r where corps ~ ('''' || r.role || '''');
    if roles_vus is distinct from (f->>'roles') || (case when caisse_du_releve and f->>'f' = 'ecrire_mouvement_compte_bilan(uuid, text, jsonb)'
                                                          then ',caisse' else '' end)
       or (corps ~ 'public\.compte_du_dirigeant\(') is distinct from (f->>'dirigeant')::boolean
       or corps ~ 'else ''108000'' end' then
      n := n + 1;
      obs := concat_ws(' ; ', obs, (f->>'f') || ' : ' || coalesce(roles_vus, 'aucun rôle')
        || case when corps ~ 'public\.compte_du_dirigeant\(' then ' + dirigeant' else '' end);
    end if;
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '3. chacune nomme exactement ses rôles, tous au catalogue, et le dirigeant par compte_du_dirigeant',
    'observe', coalesce(obs, 'conformes'), 'ok', n = 0);

  -- 4. Les douze qui écrivent : le verrou partagé de LEUR dossier, à la clé de cle_validation, avant la première lecture.
  n := 0; obs := null; k := 0;
  for f in select * from jsonb_array_elements(quatorze) loop
    continue when not (f->>'f' = any (prets)) or f->>'verrou' is null;
    k := k + 1;
    select p.prosrc into corps from pg_proc p where p.oid = to_regprocedure('public.' || (f->>'f'));
    avant_lecture := least(nullif(strpos(corps, 'public.compte_du_role('), 0), nullif(strpos(corps, 'public.compte_du_dirigeant('), 0));
    position_verrou := nullif(strpos(corps, case when f->>'verrou' = 'cle_validation'
      then 'perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));'
      else 'perform pg_advisory_xact_lock_shared(hashtextextended(' || cle_texte || ' || ' || (f->>'verrou') || '::text, 0));' end), 0);
    if cle_texte is null or position_verrou is null or avant_lecture is null or position_verrou > avant_lecture then
      n := n + 1;
      obs := concat_ws(' ; ', obs, (f->>'f') || ' : ' || case when position_verrou is null then 'pas de verrou à la clé attendue'
        else 'verrou après la première lecture du plan' end);
    end if;
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '4. celles qui écrivent prennent le verrou partagé de leur dossier, à la clé de cle_validation, avant de lire le plan',
    'observe', coalesce(obs, k || ' conforme(s)') || ', clé ' || coalesce(cle_texte, '?'), 'ok', n = 0 and cle_texte is not null);

  -- 5. Les deux lectrices ne prennent aucun verrou : seules leurs appelantes écrivent, sous le leur.
  select string_agg(q.f, ', ') into obs from unnest(prets) as q(f) join pg_proc p on p.oid = to_regprocedure('public.' || q.f)
   where q.f in ('liquidation_attendue(uuid)', 'soldes_a_reporter(uuid, integer)') and p.prosrc ~ 'advisory';
  verdicts := verdicts || jsonb_build_object('controle', '5. les deux lectrices (liquidation_attendue, soldes_a_reporter) se lisent sous le verrou de leur appelante, sans le leur',
    'observe', coalesce(obs || ' prend un verrou', 'aucune'), 'ok', obs is null);

  -- 6. La forme de chacune n'a pas bougé : sécurité, volatilité, langage, réglages.
  select string_agg(q->>'f', ', ' order by q->>'f') into obs
    from jsonb_array_elements(quatorze) q
    join pg_proc p on p.oid = to_regprocedure('public.' || (q->>'f'))
    join pg_language l on l.oid = p.prolang
   where (case when p.prosecdef then 'definer' else 'invoker' end || ':' || p.provolatile::text || ':' || l.lanname || ':'
          || coalesce(array_to_string(p.proconfig, ','), '')) is distinct from q->>'forme';
  select count(*) into n from jsonb_array_elements(quatorze) q where to_regprocedure('public.' || (q->>'f')) is null;
  verdicts := verdicts || jsonb_build_object('controle', '6. leur sécurité, leur volatilité, leur langage et leur search_path n''ont pas bougé',
    'observe', coalesce(obs, 'inchangés') || ', ' || n || ' introuvable(s)', 'ok', obs is null and n = 0);

  -- 7. Chaque lecture du plan porte le dossier de l'appel : `compte_du_role` rend le DÉFAUT d'un rôle pour un dossier
  -- qu'il ne connaît pas, si bien qu'un autre identifiant passerait inaperçu tant qu'aucun plan n'est réglé.
  n := 0; obs := null; k := 0;
  for f in select * from jsonb_array_elements(quatorze) loop
    continue when not (f->>'f' = any (prets));
    select p.prosrc into corps from pg_proc p where p.oid = to_regprocedure('public.' || (f->>'f'));
    for texte in
      select btrim(m[1]) from regexp_matches(corps, 'public\.compte_du_role\(\s*([^,]+?)\s*,', 'g') as m
      union all
      select btrim(m[1]) from regexp_matches(corps, 'public\.compte_du_dirigeant\(\s*([^)]+?)\s*\)', 'g') as m
    loop
      k := k + 1;
      if not (f->'lus' ? texte) then
        n := n + 1;
        obs := concat_ws(' ; ', obs, (f->>'f') || ' : ' || texte);
      end if;
    end loop;
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '7. chaque lecture du plan porte le dossier de l''appel',
    'observe', coalesce(obs, k || ' lecture(s) conforme(s)'), 'ok', n = 0);

  -- ══ 10 à 63. Le plan décalé, lu par chacune ══
  -- Une étape : n, f (les fonctions qu'elle exige lectrices du plan), dossier (où le plan décalé se pose), avant (posé
  -- avant le plan, par le propriétaire), prep (posé après lui), sql (joué par le chef, en compte connecté), attendu (« fait »,
  -- ou « code|message »), verif (lu par le propriétaire après l'appel) et egal (ce qu'il doit rendre).
  etapes := jsonb_build_array(
    -- L'affectation : la banque du plan face à la catégorie ; une recette taxée, sa TVA collectée au compte du plan.
    jsonb_build_object('n', '10. affecter : la banque du plan (512100) face à la catégorie, écrite telle quelle',
      'f', jsonb_build_array('affecter_mouvement_bancaire(uuid, uuid, jsonb, numeric)'), 'dossier', d_mvt,
      'sql', format('select affecter_mouvement_bancaire(%L, %L, %L)', debit.id, cat_frais.id, jsonb_build_array(
        jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', m_d, 'libelle', 'essai'),
        jsonb_build_object('compte', '512100', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, debit.id),
      'egal', '512100:credit:' || round(m_d, 2) || ',' || cat_frais.compte_comptable || ':debit:' || round(m_d, 2)),
    jsonb_build_object('n', '11. affecter : la banque d''avant (512000) est refusée',
      'f', jsonb_build_array('affecter_mouvement_bancaire(uuid, uuid, jsonb, numeric)'), 'dossier', d_mvt,
      'sql', format('select affecter_mouvement_bancaire(%L, %L, %L)', debit.id, cat_frais.id, jsonb_build_array(
        jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', m_d, 'libelle', 'essai'),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.'),
    jsonb_build_object('n', '12. affecter une recette taxée d''un dossier assujetti : la TVA collectée du plan (445711)',
      'f', jsonb_build_array('affecter_mouvement_bancaire(uuid, uuid, jsonb, numeric)'), 'dossier', d_mvt,
      'prep', format('update dossiers set assujetti_tva = true where id = %L', d_mvt),
      'sql', format('select affecter_mouvement_bancaire(%L, %L, %L, 20)', credit.id, cat_recettes.id, jsonb_build_array(
        jsonb_build_object('compte', '512100', 'sens', 'debit', 'montant', m_c, 'libelle', 'essai'),
        jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', m_c - tva_c, 'libelle', 'essai'),
        jsonb_build_object('compte', '445711', 'sens', 'credit', 'montant', tva_c, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, credit.id),
      'egal', '445711:credit:' || round(tva_c, 2) || ',512100:debit:' || round(m_c, 2) || ',' || cat_recettes.compte_comptable
        || ':credit:' || round(m_c - tva_c, 2)),
    jsonb_build_object('n', '13. affecter une recette taxée : la TVA collectée d''avant (445710) est refusée',
      'f', jsonb_build_array('affecter_mouvement_bancaire(uuid, uuid, jsonb, numeric)'), 'dossier', d_mvt,
      'prep', format('update dossiers set assujetti_tva = true where id = %L', d_mvt),
      'sql', format('select affecter_mouvement_bancaire(%L, %L, %L, 20)', credit.id, cat_recettes.id, jsonb_build_array(
        jsonb_build_object('compte', '512100', 'sens', 'debit', 'montant', m_c, 'libelle', 'essai'),
        jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', m_c - tva_c, 'libelle', 'essai'),
        jsonb_build_object('compte', '445710', 'sens', 'credit', 'montant', tva_c, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.'),

    -- La ventilation : la banque et la part du dirigeant (108100, l'exploitant du plan en trésorerie) ; la TVA collectée.
    jsonb_build_object('n', '14. ventiler : la banque du plan et la part du dirigeant au compte de l''exploitant du plan (108100)',
      'f', jsonb_build_array('ventiler_mouvement_bancaire(uuid, jsonb, jsonb)'), 'dossier', d_mvt,
      'sql', format('select ventiler_mouvement_bancaire(%L, %L, %L)', debit.id, jsonb_build_array(
        jsonb_build_object('categorie_id', cat_frais.id, 'montant', debit.montant + 5),
        jsonb_build_object('part_personnelle', true, 'montant', -5)), jsonb_build_array(
        jsonb_build_object('compte', '512100', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'),
        jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', m_d - 5, 'libelle', 'essai'),
        jsonb_build_object('compte', '108100', 'sens', 'debit', 'montant', 5, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, debit.id),
      'egal', '108100:debit:5.00,512100:credit:' || round(m_d, 2) || ',' || cat_frais.compte_comptable || ':debit:' || round(m_d - 5, 2)),
    jsonb_build_object('n', '15. ventiler : la part du dirigeant au 108000 et la banque au 512000, refusées',
      'f', jsonb_build_array('ventiler_mouvement_bancaire(uuid, jsonb, jsonb)'), 'dossier', d_mvt,
      'sql', format('select ventiler_mouvement_bancaire(%L, %L, %L)', debit.id, jsonb_build_array(
        jsonb_build_object('categorie_id', cat_frais.id, 'montant', debit.montant + 5),
        jsonb_build_object('part_personnelle', true, 'montant', -5)), jsonb_build_array(
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'),
        jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', m_d - 5, 'libelle', 'essai'),
        jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', 5, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.'),
    jsonb_build_object('n', '16. ventiler : la seule part du dirigeant au 108000 (la banque au 512100), refusée',
      'f', jsonb_build_array('ventiler_mouvement_bancaire(uuid, jsonb, jsonb)'), 'dossier', d_mvt,
      'sql', format('select ventiler_mouvement_bancaire(%L, %L, %L)', debit.id, jsonb_build_array(
        jsonb_build_object('categorie_id', cat_frais.id, 'montant', debit.montant + 5),
        jsonb_build_object('part_personnelle', true, 'montant', -5)), jsonb_build_array(
        jsonb_build_object('compte', '512100', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'),
        jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', m_d - 5, 'libelle', 'essai'),
        jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', 5, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.'),
    jsonb_build_object('n', '17. ventiler une recette taxée d''un dossier assujetti : la TVA collectée du plan (445711)',
      'f', jsonb_build_array('ventiler_mouvement_bancaire(uuid, jsonb, jsonb)'), 'dossier', d_mvt,
      'prep', format('update dossiers set assujetti_tva = true where id = %L', d_mvt),
      'sql', format('select ventiler_mouvement_bancaire(%L, %L, %L)', credit.id, jsonb_build_array(
        jsonb_build_object('categorie_id', cat_recettes.id, 'montant', part_v, 'taux_tva', 20),
        jsonb_build_object('part_personnelle', true, 'montant', 5)), jsonb_build_array(
        jsonb_build_object('compte', '512100', 'sens', 'debit', 'montant', m_c, 'libelle', 'essai'),
        jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', part_v - tva_v, 'libelle', 'essai'),
        jsonb_build_object('compte', '445711', 'sens', 'credit', 'montant', tva_v, 'libelle', 'essai'),
        jsonb_build_object('compte', '108100', 'sens', 'credit', 'montant', 5, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, credit.id),
      'egal', '108100:credit:5.00,445711:credit:' || round(tva_v, 2) || ',512100:debit:' || round(m_c, 2) || ','
        || cat_recettes.compte_comptable || ':credit:' || round(part_v - tva_v, 2)),
    jsonb_build_object('n', '18. ventiler une recette taxée : la TVA collectée d''avant (445710), refusée',
      'f', jsonb_build_array('ventiler_mouvement_bancaire(uuid, jsonb, jsonb)'), 'dossier', d_mvt,
      'prep', format('update dossiers set assujetti_tva = true where id = %L', d_mvt),
      'sql', format('select ventiler_mouvement_bancaire(%L, %L, %L)', credit.id, jsonb_build_array(
        jsonb_build_object('categorie_id', cat_recettes.id, 'montant', part_v, 'taux_tva', 20),
        jsonb_build_object('part_personnelle', true, 'montant', 5)), jsonb_build_array(
        jsonb_build_object('compte', '512100', 'sens', 'debit', 'montant', m_c, 'libelle', 'essai'),
        jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', part_v - tva_v, 'libelle', 'essai'),
        jsonb_build_object('compte', '445710', 'sens', 'credit', 'montant', tva_v, 'libelle', 'essai'),
        jsonb_build_object('compte', '108100', 'sens', 'credit', 'montant', 5, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.'),

    -- Le virement personnel : le compte de l'exploitant du plan, que le refus NOMME.
    jsonb_build_object('n', '20. classer un virement personnel : le compte de l''exploitant du plan (108100) face à la banque du plan',
      'f', jsonb_build_array('classer_virement_personnel(uuid, jsonb)'), 'dossier', d_mvt,
      'sql', format('select classer_virement_personnel(%L, %L)', debit.id, jsonb_build_array(
        jsonb_build_object('compte', '108100', 'sens', 'debit', 'montant', m_d, 'libelle', 'essai'),
        jsonb_build_object('compte', '512100', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, debit.id),
      'egal', '108100:debit:' || round(m_d, 2) || ',512100:credit:' || round(m_d, 2)),
    jsonb_build_object('n', '21. classer un virement personnel aux comptes d''avant : refusé, le refus nomme le 108100',
      'f', jsonb_build_array('classer_virement_personnel(uuid, jsonb)'), 'dossier', d_mvt,
      'sql', format('select classer_virement_personnel(%L, %L)', debit.id, jsonb_build_array(
        jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', m_d, 'libelle', 'essai'),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et au compte du dirigeant (108100).'),
    jsonb_build_object('n', '22. classer un virement personnel, la seule banque d''avant (512000) : refusé',
      'f', jsonb_build_array('classer_virement_personnel(uuid, jsonb)'), 'dossier', d_mvt,
      'sql', format('select classer_virement_personnel(%L, %L)', debit.id, jsonb_build_array(
        jsonb_build_object('compte', '108100', 'sens', 'debit', 'montant', m_d, 'libelle', 'essai'),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et au compte du dirigeant (108100).'),

    -- Le compte de bilan : la banque du plan ; le compte du dirigeant du plan, refusé et nommé.
    jsonb_build_object('n', '23. écrire un mouvement au 580000 : face à la banque du plan (512100)',
      'f', jsonb_build_array('ecrire_mouvement_compte_bilan(uuid, text, jsonb)'), 'dossier', d_mvt,
      'sql', format('select ecrire_mouvement_compte_bilan(%L, %L, %L)', debit.id, '580000', jsonb_build_array(
        jsonb_build_object('compte', '580000', 'sens', 'debit', 'montant', m_d, 'libelle', 'essai'),
        jsonb_build_object('compte', '512100', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, debit.id),
      'egal', '512100:credit:' || round(m_d, 2) || ',580000:debit:' || round(m_d, 2)),
    jsonb_build_object('n', '24. écrire un mouvement au 580000 face à la banque d''avant (512000) : refusé',
      'f', jsonb_build_array('ecrire_mouvement_compte_bilan(uuid, text, jsonb)'), 'dossier', d_mvt,
      'sql', format('select ecrire_mouvement_compte_bilan(%L, %L, %L)', debit.id, '580000', jsonb_build_array(
        jsonb_build_object('compte', '580000', 'sens', 'debit', 'montant', m_d, 'libelle', 'essai'),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à ce compte.'),
    jsonb_build_object('n', '25. le compte de l''exploitant du plan (108100) se refuse comme compte du dirigeant, nommé',
      'f', jsonb_build_array('ecrire_mouvement_compte_bilan(uuid, text, jsonb)'), 'dossier', d_mvt,
      'sql', format('select ecrire_mouvement_compte_bilan(%L, %L, %L)', debit.id, '108100', jsonb_build_array(
        jsonb_build_object('compte', '108100', 'sens', 'debit', 'montant', m_d, 'libelle', 'essai'),
        jsonb_build_object('compte', '512100', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', '22023|Les apports et les prélèvements du dirigeant passent par « Virement personnel », qui les écrit sur son compte (108100).'),

    -- L'échéance d'emprunt : le capital, les intérêts et l'assurance aux comptes du plan ; le déblocage.
    jsonb_build_object('n', '26. rapprocher une échéance : 164100, 661110 et 616810 face à la banque du plan',
      'f', jsonb_build_array('rapprocher_echeance_emprunt(uuid, uuid, integer, numeric, numeric, jsonb)'), 'dossier', d_mvt,
      'prep', format($q$insert into emprunts (id, dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
                        values (%L, %L, 'EMPRUNT ESSAI PLAN', 20000, 3.5, '2025-01-01', 60)$q$, emp, d_mvt),
      'sql', format('select rapprocher_echeance_emprunt(%L, %L, 1, 1, 0.5, %L)', debit.id, emp, jsonb_build_array(
        jsonb_build_object('compte', '164100', 'sens', 'debit', 'montant', m_d - 1.5, 'libelle', 'essai'),
        jsonb_build_object('compte', '661110', 'sens', 'debit', 'montant', 1, 'libelle', 'essai'),
        jsonb_build_object('compte', '616810', 'sens', 'debit', 'montant', 0.5, 'libelle', 'essai'),
        jsonb_build_object('compte', '512100', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, debit.id),
      'egal', '164100:debit:' || round(m_d - 1.5, 2) || ',512100:credit:' || round(m_d, 2) || ',616810:debit:0.50,661110:debit:1.00'),
    jsonb_build_object('n', '27. rapprocher une échéance aux comptes d''avant : refusé',
      'f', jsonb_build_array('rapprocher_echeance_emprunt(uuid, uuid, integer, numeric, numeric, jsonb)'), 'dossier', d_mvt,
      'prep', format($q$insert into emprunts (id, dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
                        values (%L, %L, 'EMPRUNT ESSAI PLAN', 20000, 3.5, '2025-01-01', 60)$q$, emp, d_mvt),
      'sql', format('select rapprocher_echeance_emprunt(%L, %L, 1, 1, 0.5, %L)', debit.id, emp, jsonb_build_array(
        jsonb_build_object('compte', '164000', 'sens', 'debit', 'montant', m_d - 1.5, 'libelle', 'essai'),
        jsonb_build_object('compte', '661100', 'sens', 'debit', 'montant', 1, 'libelle', 'essai'),
        jsonb_build_object('compte', '616800', 'sens', 'debit', 'montant', 0.5, 'libelle', 'essai'),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à ce découpage.'),
    jsonb_build_object('n', '28. rapprocher un déblocage : l''emprunt du plan (164100) au crédit, face à la banque du plan',
      'f', jsonb_build_array('rapprocher_echeance_emprunt(uuid, uuid, integer, numeric, numeric, jsonb)'), 'dossier', d_mvt,
      'prep', format($q$insert into emprunts (id, dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
                        values (%L, %L, 'EMPRUNT ESSAI PLAN', 20000, 3.5, '2025-01-01', 60)$q$, emp, d_mvt),
      'sql', format('select rapprocher_echeance_emprunt(%L, %L, null, 0, 0, %L)', credit.id, emp, jsonb_build_array(
        jsonb_build_object('compte', '512100', 'sens', 'debit', 'montant', m_c, 'libelle', 'essai'),
        jsonb_build_object('compte', '164100', 'sens', 'credit', 'montant', m_c, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, credit.id),
      'egal', '164100:credit:' || round(m_c, 2) || ',512100:debit:' || round(m_c, 2)),

    -- L'échéance de cotisation : la cotisation et sa CSG-CRDS (trésorerie) aux comptes du plan.
    jsonb_build_object('n', '30. rapprocher une échéance de cotisation : 646100, et la CSG-CRDS au 108100, face à la banque du plan',
      'f', jsonb_build_array('rapprocher_cotisation(uuid, uuid, jsonb)'), 'dossier', d_mvt,
      'prep', format($q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele, montant_csg_crds)
                        values (%L, %L, %L, %s, 2.5)$q$, cot, d_mvt, debit.date, m_d),
      'sql', format('select rapprocher_cotisation(%L, %L, %L)', debit.id, cot, jsonb_build_array(
        jsonb_build_object('compte', '646100', 'sens', 'debit', 'montant', m_d - 2.5, 'libelle', 'essai'),
        jsonb_build_object('compte', '108100', 'sens', 'debit', 'montant', 2.5, 'libelle', 'essai'),
        jsonb_build_object('compte', '512100', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, debit.id),
      'egal', '108100:debit:2.50,512100:credit:' || round(m_d, 2) || ',646100:debit:' || round(m_d - 2.5, 2)),
    jsonb_build_object('n', '31. rapprocher une échéance de cotisation aux comptes d''avant : refusé',
      'f', jsonb_build_array('rapprocher_cotisation(uuid, uuid, jsonb)'), 'dossier', d_mvt,
      'prep', format($q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele, montant_csg_crds)
                        values (%L, %L, %L, %s, 2.5)$q$, cot, d_mvt, debit.date, m_d),
      'sql', format('select rapprocher_cotisation(%L, %L, %L)', debit.id, cot, jsonb_build_array(
        jsonb_build_object('compte', '646000', 'sens', 'debit', 'montant', m_d - 2.5, 'libelle', 'essai'),
        jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', 2.5, 'libelle', 'essai'),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', m_d, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette échéance.'),

    -- Le paiement d'une échéance depuis le compte personnel (DEFINER) : la cotisation du plan face à l'exploitant du plan.
    jsonb_build_object('n', '32. déclarer un paiement personnel : 646100 face au compte de l''exploitant du plan (108100)',
      'f', jsonb_build_array('enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb)'), 'dossier', d_mvt,
      'prep', format($q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele, montant_csg_crds)
                        values (%L, %L, '2026-01-05', 100, 3)$q$, cot_perso, d_mvt),
      'sql', format('select enregistrer_paiement_personnel_cotisation(%L, %L, %L, %L)', d_mvt, cot_perso, '2026-02-01',
        jsonb_build_array(jsonb_build_object('compte', '646100', 'sens', 'debit', 'montant', 97, 'libelle', 'essai'),
                          jsonb_build_object('compte', '108100', 'sens', 'credit', 'montant', 97, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where cotisation_id = %L$q$, cot_perso),
      'egal', '108100:credit:97.00,646100:debit:97.00'),
    jsonb_build_object('n', '33. déclarer un paiement personnel aux comptes d''avant : refusé, le refus nomme le 108100',
      'f', jsonb_build_array('enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb)'), 'dossier', d_mvt,
      'prep', format($q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele, montant_csg_crds)
                        values (%L, %L, '2026-01-05', 100, 3)$q$, cot_perso, d_mvt),
      'sql', format('select enregistrer_paiement_personnel_cotisation(%L, %L, %L, %L)', d_mvt, cot_perso, '2026-02-01',
        jsonb_build_array(jsonb_build_object('compte', '646000', 'sens', 'debit', 'montant', 97, 'libelle', 'essai'),
                          jsonb_build_object('compte', '108000', 'sens', 'credit', 'montant', 97, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (108100).'),

    -- La dotation aux amortissements et le forfait kilométrique.
    jsonb_build_object('n', '34. écrire une dotation : les dotations du plan (681110) au débit, le 28 de la nature au crédit',
      'f', jsonb_build_array('ecrire_dotation_amortissement(uuid, integer, jsonb)'), 'dossier', d_mvt,
      'prep', format($q$insert into immobilisations (id, dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
                        values (%L, %L, %L, 'BIEN ESSAI PLAN', 1200, '2025-07-01', 3)$q$, bien, d_mvt, nature_info),
      'sql', format('select ecrire_dotation_amortissement(%L, 2025, %L)', bien, jsonb_build_array(
        jsonb_build_object('compte', '681110', 'sens', 'debit', 'montant', 200, 'libelle', 'essai'),
        jsonb_build_object('compte', '281830', 'sens', 'credit', 'montant', 200, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where immobilisation_id = %L$q$, bien),
      'egal', '281830:credit:200.00,681110:debit:200.00'),
    jsonb_build_object('n', '35. écrire une dotation au 681100 : refusée',
      'f', jsonb_build_array('ecrire_dotation_amortissement(uuid, integer, jsonb)'), 'dossier', d_mvt,
      'prep', format($q$insert into immobilisations (id, dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
                        values (%L, %L, %L, 'BIEN ESSAI PLAN', 1200, '2025-07-01', 3)$q$, bien, d_mvt, nature_info),
      'sql', format('select ecrire_dotation_amortissement(%L, 2025, %L)', bien, jsonb_build_array(
        jsonb_build_object('compte', '681100', 'sens', 'debit', 'montant', 200, 'libelle', 'essai'),
        jsonb_build_object('compte', '281830', 'sens', 'credit', 'montant', 200, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à la dotation 2025 de ce bien.'),
    jsonb_build_object('n', '36. écrire un forfait kilométrique : 625111 face au compte de l''exploitant du plan (108100)',
      'f', jsonb_build_array('ecrire_forfait_kilometrique(uuid, jsonb)'), 'dossier', d_mvt,
      'prep', format($q$insert into vehicules (id, dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
                        values (%L, %L, 2025, 'VÉHICULE ESSAI PLAN', 'voiture', 5, 'thermique', 12000)$q$, vehicule, d_mvt),
      'sql', format('select ecrire_forfait_kilometrique(%L, %L)', vehicule, jsonb_build_array(
        jsonb_build_object('compte', '625111', 'sens', 'debit', 'montant', 5679, 'libelle', 'essai'),
        jsonb_build_object('compte', '108100', 'sens', 'credit', 'montant', 5679, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where vehicule_id = %L$q$, vehicule),
      'egal', '108100:credit:5679.00,625111:debit:5679.00'),
    jsonb_build_object('n', '37. écrire un forfait kilométrique aux comptes d''avant : refusé',
      'f', jsonb_build_array('ecrire_forfait_kilometrique(uuid, jsonb)'), 'dossier', d_mvt,
      'prep', format($q$insert into vehicules (id, dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
                        values (%L, %L, 2025, 'VÉHICULE ESSAI PLAN', 'voiture', 5, 'thermique', 12000)$q$, vehicule, d_mvt),
      'sql', format('select ecrire_forfait_kilometrique(%L, %L)', vehicule, jsonb_build_array(
        jsonb_build_object('compte', '625110', 'sens', 'debit', 'montant', 5679, 'libelle', 'essai'),
        jsonb_build_object('compte', '108000', 'sens', 'credit', 'montant', 5679, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas au forfait 2025 de ce véhicule.'),

    -- La TVA, dans un dossier jetable assujetti : la liquidation, son paiement, le remboursement d'un crédit, l'écriture
    -- attendue et l'arrondi.
    jsonb_build_object('n', '40. enregistrer une déclaration : sa liquidation s''écrit aux comptes du plan (445711, 445661, 445511, 758100)',
      'f', jsonb_build_array('ecrire_liquidation_tva(uuid, jsonb)', 'liquidation_attendue(uuid)'), 'dossier', d_tva,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, assujetti_tva, code_email)
                         values (%L, 'ESSAI PLAN TVA', %L, true, 'essaiplantva' || substr(md5(gen_random_uuid()::text), 1, 10))$q$, d_tva, cabinet),
      'sql', format($q$select enregistrer_declaration_tva(%L, '2026-01-01', '2026-03-31', 79, 0, 0, '2026-04-15', %L, 100.40, 20.60, 0, %L)$q$, d_tva,
        jsonb_build_object('l16', 100, 'l19', 0, 'l20', 21, 'l21', 0, 'l22', 0, 'l23', 21, 'l25', 0, 'l26', 0, 'l27', 0, 'l28', 79, 'l32', 79),
        jsonb_build_array(jsonb_build_object('compte', '445711', 'sens', 'debit', 'montant', 100.40, 'libelle', 'essai'),
          jsonb_build_object('compte', '445661', 'sens', 'credit', 'montant', 20.60, 'libelle', 'essai'),
          jsonb_build_object('compte', '445511', 'sens', 'credit', 'montant', 79, 'libelle', 'essai'),
          jsonb_build_object('compte', '758100', 'sens', 'credit', 'montant', 0.80, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where dossier_id = %L and declaration_tva_id is not null$q$, d_tva),
      'egal', '445511:credit:79.00,445661:credit:20.60,445711:debit:100.40,758100:credit:0.80'),
    jsonb_build_object('n', '41. enregistrer une déclaration dont la liquidation porte les comptes d''avant : refusée',
      'f', jsonb_build_array('ecrire_liquidation_tva(uuid, jsonb)', 'liquidation_attendue(uuid)'), 'dossier', d_tva,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, assujetti_tva, code_email)
                         values (%L, 'ESSAI PLAN TVA', %L, true, 'essaiplantva' || substr(md5(gen_random_uuid()::text), 1, 10))$q$, d_tva, cabinet),
      'sql', format($q$select enregistrer_declaration_tva(%L, '2026-01-01', '2026-03-31', 79, 0, 0, '2026-04-15', %L, 100.40, 20.60, 0, %L)$q$, d_tva,
        jsonb_build_object('l16', 100, 'l19', 0, 'l20', 21, 'l21', 0, 'l22', 0, 'l23', 21, 'l25', 0, 'l26', 0, 'l27', 0, 'l28', 79, 'l32', 79),
        jsonb_build_array(jsonb_build_object('compte', '445710', 'sens', 'debit', 'montant', 100.40, 'libelle', 'essai'),
          jsonb_build_object('compte', '445660', 'sens', 'credit', 'montant', 20.60, 'libelle', 'essai'),
          jsonb_build_object('compte', '445510', 'sens', 'credit', 'montant', 79, 'libelle', 'essai'),
          jsonb_build_object('compte', '758000', 'sens', 'credit', 'montant', 0.80, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à cette déclaration.'),
    jsonb_build_object('n', '42. rapprocher le paiement de la TVA : la TVA à décaisser du plan (445511) face à la banque du plan',
      'f', jsonb_build_array('rapprocher_declaration_tva(uuid, uuid, jsonb)', 'ecrire_liquidation_tva(uuid, jsonb)', 'liquidation_attendue(uuid)'),
      'dossier', d_tva,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, assujetti_tva, code_email)
                         values (%L, 'ESSAI PLAN TVA', %L, true, 'essaiplantva' || substr(md5(gen_random_uuid()::text), 1, 10))$q$, d_tva, cabinet),
      'prep', format($q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values (%L, %L, '2026-04-20', 'PRLV ESSAI TVA', -79, 'non_rapprochee');
                        select enregistrer_declaration_tva(%L, '2026-01-01', '2026-03-31', 79, 0, 0, '2026-04-15', %L, 100.40, 20.60, 0, %L)$q$,
        m_paie, d_tva, d_tva,
        jsonb_build_object('l16', 100, 'l19', 0, 'l20', 21, 'l21', 0, 'l22', 0, 'l23', 21, 'l25', 0, 'l26', 0, 'l27', 0, 'l28', 79, 'l32', 79),
        jsonb_build_array(jsonb_build_object('compte', '445711', 'sens', 'debit', 'montant', 100.40, 'libelle', 'essai'),
          jsonb_build_object('compte', '445661', 'sens', 'credit', 'montant', 20.60, 'libelle', 'essai'),
          jsonb_build_object('compte', '445511', 'sens', 'credit', 'montant', 79, 'libelle', 'essai'),
          jsonb_build_object('compte', '758100', 'sens', 'credit', 'montant', 0.80, 'libelle', 'essai'))),
      'sql', format($q$select rapprocher_declaration_tva(%L, (select id from declarations_tva where dossier_id = %L and periode_debut = '2026-01-01'), %L)$q$,
        m_paie, d_tva, jsonb_build_array(
          jsonb_build_object('compte', '445511', 'sens', 'debit', 'montant', 79, 'libelle', 'essai'),
          jsonb_build_object('compte', '512100', 'sens', 'credit', 'montant', 79, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, m_paie),
      'egal', '445511:debit:79.00,512100:credit:79.00'),
    jsonb_build_object('n', '43. rapprocher le paiement de la TVA aux comptes d''avant : refusé',
      'f', jsonb_build_array('rapprocher_declaration_tva(uuid, uuid, jsonb)', 'ecrire_liquidation_tva(uuid, jsonb)', 'liquidation_attendue(uuid)'),
      'dossier', d_tva,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, assujetti_tva, code_email)
                         values (%L, 'ESSAI PLAN TVA', %L, true, 'essaiplantva' || substr(md5(gen_random_uuid()::text), 1, 10))$q$, d_tva, cabinet),
      'prep', format($q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values (%L, %L, '2026-04-20', 'PRLV ESSAI TVA', -79, 'non_rapprochee');
                        select enregistrer_declaration_tva(%L, '2026-01-01', '2026-03-31', 79, 0, 0, '2026-04-15', %L, 100.40, 20.60, 0, %L)$q$,
        m_paie, d_tva, d_tva,
        jsonb_build_object('l16', 100, 'l19', 0, 'l20', 21, 'l21', 0, 'l22', 0, 'l23', 21, 'l25', 0, 'l26', 0, 'l27', 0, 'l28', 79, 'l32', 79),
        jsonb_build_array(jsonb_build_object('compte', '445711', 'sens', 'debit', 'montant', 100.40, 'libelle', 'essai'),
          jsonb_build_object('compte', '445661', 'sens', 'credit', 'montant', 20.60, 'libelle', 'essai'),
          jsonb_build_object('compte', '445511', 'sens', 'credit', 'montant', 79, 'libelle', 'essai'),
          jsonb_build_object('compte', '758100', 'sens', 'credit', 'montant', 0.80, 'libelle', 'essai'))),
      'sql', format($q$select rapprocher_declaration_tva(%L, (select id from declarations_tva where dossier_id = %L and periode_debut = '2026-01-01'), %L)$q$,
        m_paie, d_tva, jsonb_build_array(
          jsonb_build_object('compte', '445510', 'sens', 'debit', 'montant', 79, 'libelle', 'essai'),
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 79, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette déclaration.'),
    jsonb_build_object('n', '44. rapprocher le remboursement d''un crédit : la banque du plan face au remboursement demandé du plan (445831)',
      'f', jsonb_build_array('rapprocher_declaration_tva(uuid, uuid, jsonb)', 'ecrire_liquidation_tva(uuid, jsonb)', 'liquidation_attendue(uuid)'),
      'dossier', d_tva,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, assujetti_tva, code_email)
                         values (%L, 'ESSAI PLAN TVA', %L, true, 'essaiplantva' || substr(md5(gen_random_uuid()::text), 1, 10))$q$, d_tva, cabinet),
      'prep', format($q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values (%L, %L, '2026-08-10', 'VIR ESSAI TVA', 300, 'non_rapprochee');
                        select enregistrer_declaration_tva(%L, '2026-04-01', '2026-06-30', -350, 0, 300, null, %L, 50.20, 399.70, 0, %L)$q$,
        m_remb, d_tva, d_tva,
        jsonb_build_object('l16', 50, 'l19', 0, 'l20', 400, 'l21', 0, 'l22', 0, 'l23', 400, 'l25', 350, 'l26', 300, 'l27', 50, 'l28', 0, 'l32', 0),
        jsonb_build_array(jsonb_build_object('compte', '445711', 'sens', 'debit', 'montant', 50.20, 'libelle', 'essai'),
          jsonb_build_object('compte', '445661', 'sens', 'credit', 'montant', 399.70, 'libelle', 'essai'),
          jsonb_build_object('compte', '445671', 'sens', 'debit', 'montant', 50, 'libelle', 'essai'),
          jsonb_build_object('compte', '445831', 'sens', 'debit', 'montant', 300, 'libelle', 'essai'),
          jsonb_build_object('compte', '758100', 'sens', 'credit', 'montant', 0.50, 'libelle', 'essai'))),
      'sql', format($q$select rapprocher_declaration_tva(%L, (select id from declarations_tva where dossier_id = %L and periode_debut = '2026-04-01'), %L)$q$,
        m_remb, d_tva, jsonb_build_array(
          jsonb_build_object('compte', '512100', 'sens', 'debit', 'montant', 300, 'libelle', 'essai'),
          jsonb_build_object('compte', '445831', 'sens', 'credit', 'montant', 300, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, m_remb),
      'egal', '445831:credit:300.00,512100:debit:300.00'),
    jsonb_build_object('n', '45. rapprocher le remboursement d''un crédit aux comptes d''avant : refusé',
      'f', jsonb_build_array('rapprocher_declaration_tva(uuid, uuid, jsonb)', 'ecrire_liquidation_tva(uuid, jsonb)', 'liquidation_attendue(uuid)'),
      'dossier', d_tva,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, assujetti_tva, code_email)
                         values (%L, 'ESSAI PLAN TVA', %L, true, 'essaiplantva' || substr(md5(gen_random_uuid()::text), 1, 10))$q$, d_tva, cabinet),
      'prep', format($q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values (%L, %L, '2026-08-10', 'VIR ESSAI TVA', 300, 'non_rapprochee');
                        select enregistrer_declaration_tva(%L, '2026-04-01', '2026-06-30', -350, 0, 300, null, %L, 50.20, 399.70, 0, %L)$q$,
        m_remb, d_tva, d_tva,
        jsonb_build_object('l16', 50, 'l19', 0, 'l20', 400, 'l21', 0, 'l22', 0, 'l23', 400, 'l25', 350, 'l26', 300, 'l27', 50, 'l28', 0, 'l32', 0),
        jsonb_build_array(jsonb_build_object('compte', '445711', 'sens', 'debit', 'montant', 50.20, 'libelle', 'essai'),
          jsonb_build_object('compte', '445661', 'sens', 'credit', 'montant', 399.70, 'libelle', 'essai'),
          jsonb_build_object('compte', '445671', 'sens', 'debit', 'montant', 50, 'libelle', 'essai'),
          jsonb_build_object('compte', '445831', 'sens', 'debit', 'montant', 300, 'libelle', 'essai'),
          jsonb_build_object('compte', '758100', 'sens', 'credit', 'montant', 0.50, 'libelle', 'essai'))),
      'sql', format($q$select rapprocher_declaration_tva(%L, (select id from declarations_tva where dossier_id = %L and periode_debut = '2026-04-01'), %L)$q$,
        m_remb, d_tva, jsonb_build_array(
          jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', 300, 'libelle', 'essai'),
          jsonb_build_object('compte', '445830', 'sens', 'credit', 'montant', 300, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette déclaration.'),
    jsonb_build_object('n', '46. l''écriture attendue d''une déclaration porte les huit comptes de TVA du plan, et l''arrondi en charge au 658100',
      'f', jsonb_build_array('liquidation_attendue(uuid)'), 'dossier', d_tva,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, assujetti_tva, code_email)
                         values (%L, 'ESSAI PLAN TVA', %L, true, 'essaiplantva' || substr(md5(gen_random_uuid()::text), 1, 10))$q$, d_tva, cabinet),
      'prep', format($q$insert into declarations_tva (id, dossier_id, periode_debut, periode_fin, tva_declaree, credit_anterieur,
                          remboursement_demande, cases, tva_collectee, tva_deductible, tva_deductible_immobilisations)
                        values (%L, %L, '2025-10-01', '2025-12-31', 80, 0, 3, %L, 100.40, 20.60, 10.30)$q$, t_q4, d_tva,
        jsonb_build_object('l22', 2, 'l26', 3, 'l27', 7, 'l28', 80)),
      'sql', 'select 1',
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from liquidation_attendue(%L)$q$, t_q4),
      'egal', '445511:credit:80.00,445621:credit:10.30,445661:credit:20.60,445671:debit:5.00,445711:debit:100.40,445831:debit:3.00,658100:debit:2.50'),
    jsonb_build_object('n', '47. un écart de plus de 10 € au compte d''arrondi du plan (758100) se refuse comme un écart, pas comme un arrondi',
      'f', jsonb_build_array('ecrire_liquidation_tva(uuid, jsonb)', 'liquidation_attendue(uuid)'), 'dossier', d_tva,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, assujetti_tva, code_email)
                         values (%L, 'ESSAI PLAN TVA', %L, true, 'essaiplantva' || substr(md5(gen_random_uuid()::text), 1, 10))$q$, d_tva, cabinet),
      'prep', format($q$insert into declarations_tva (id, dossier_id, periode_debut, periode_fin, tva_declaree, credit_anterieur,
                          remboursement_demande, cases, tva_collectee, tva_deductible, tva_deductible_immobilisations)
                        values (%L, %L, '2025-07-01', '2025-09-30', 60, 0, 0, %L, 100.40, 20.60, 0)$q$, t_q3, d_tva,
        jsonb_build_object('l28', 60)),
      'sql', format('select ecrire_liquidation_tva(%L, %L)', t_q3, jsonb_build_array(
        jsonb_build_object('compte', '445711', 'sens', 'debit', 'montant', 100.40, 'libelle', 'essai'),
        jsonb_build_object('compte', '445661', 'sens', 'credit', 'montant', 20.60, 'libelle', 'essai'),
        jsonb_build_object('compte', '445511', 'sens', 'credit', 'montant', 60, 'libelle', 'essai'),
        jsonb_build_object('compte', '758100', 'sens', 'credit', 'montant', 19.80, 'libelle', 'essai'))),
      'attendu', '22023|La liquidation ne s''équilibre pas : un écart de 19.80 € entre la TVA des comptes et la TVA déclarée n''est pas un arrondi.'),
    -- Le même écart en CHARGE : la TVA déclarée dépasse celle des comptes. Sans lui, l'arrondi en charge lu pour un autre
    -- dossier (le 658000 du catalogue) ne se voyait nulle part — la mutation l'a montré.
    jsonb_build_object('n', '48. un écart de plus de 10 € au compte d''arrondi en charge du plan (658100) se refuse comme un écart, pas comme un arrondi',
      'f', jsonb_build_array('ecrire_liquidation_tva(uuid, jsonb)', 'liquidation_attendue(uuid)'), 'dossier', d_tva,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, assujetti_tva, code_email)
                         values (%L, 'ESSAI PLAN TVA', %L, true, 'essaiplantva' || substr(md5(gen_random_uuid()::text), 1, 10))$q$, d_tva, cabinet),
      'prep', format($q$insert into declarations_tva (id, dossier_id, periode_debut, periode_fin, tva_declaree, credit_anterieur,
                          remboursement_demande, cases, tva_collectee, tva_deductible, tva_deductible_immobilisations)
                        values (%L, %L, '2025-04-01', '2025-06-30', 100, 0, 0, %L, 100.40, 20.60, 0)$q$, t_q2, d_tva,
        jsonb_build_object('l28', 100)),
      'sql', format('select ecrire_liquidation_tva(%L, %L)', t_q2, jsonb_build_array(
        jsonb_build_object('compte', '445711', 'sens', 'debit', 'montant', 100.40, 'libelle', 'essai'),
        jsonb_build_object('compte', '445661', 'sens', 'credit', 'montant', 20.60, 'libelle', 'essai'),
        jsonb_build_object('compte', '445511', 'sens', 'credit', 'montant', 100, 'libelle', 'essai'),
        jsonb_build_object('compte', '658100', 'sens', 'debit', 'montant', 20.20, 'libelle', 'essai'))),
      'attendu', '22023|La liquidation ne s''équilibre pas : un écart de 20.20 € entre la TVA des comptes et la TVA déclarée n''est pas un arrondi.'),

    -- Le lettrage, dans le dossier passé en engagement : les cinq comptes de tiers du plan passent la liste, l'ancien non.
    jsonb_build_object('n', '50. lettrer sur les fournisseurs du plan (401100) : le compte passe la liste des comptes de tiers',
      'f', jsonb_build_array('lettrer_pieces(uuid, text, uuid[])'), 'dossier', d_mvt,
      'prep', format('update dossiers set mode_comptable = %L where id = %L', 'engagement', d_mvt),
      'sql', format('select lettrer_pieces(%L, %L, array[%L]::uuid[])', d_mvt, '401100', gen_random_uuid()),
      'attendu', '22023|Un lettrage fait à la main apparie au moins deux pièces.'),
    jsonb_build_object('n', '51. lettrer sur les fournisseurs d''immobilisations du plan (404100) : il passe la liste',
      'f', jsonb_build_array('lettrer_pieces(uuid, text, uuid[])'), 'dossier', d_mvt,
      'prep', format('update dossiers set mode_comptable = %L where id = %L', 'engagement', d_mvt),
      'sql', format('select lettrer_pieces(%L, %L, array[%L]::uuid[])', d_mvt, '404100', gen_random_uuid()),
      'attendu', '22023|Un lettrage fait à la main apparie au moins deux pièces.'),
    jsonb_build_object('n', '52. lettrer sur les clients du plan (411100) : il passe la liste',
      'f', jsonb_build_array('lettrer_pieces(uuid, text, uuid[])'), 'dossier', d_mvt,
      'prep', format('update dossiers set mode_comptable = %L where id = %L', 'engagement', d_mvt),
      'sql', format('select lettrer_pieces(%L, %L, array[%L]::uuid[])', d_mvt, '411100', gen_random_uuid()),
      'attendu', '22023|Un lettrage fait à la main apparie au moins deux pièces.'),
    jsonb_build_object('n', '53. lettrer sur le compte courant d''associé du plan (455100) : il passe la liste',
      'f', jsonb_build_array('lettrer_pieces(uuid, text, uuid[])'), 'dossier', d_mvt,
      'prep', format('update dossiers set mode_comptable = %L where id = %L', 'engagement', d_mvt),
      'sql', format('select lettrer_pieces(%L, %L, array[%L]::uuid[])', d_mvt, '455100', gen_random_uuid()),
      'attendu', '22023|Un lettrage fait à la main apparie au moins deux pièces.'),
    jsonb_build_object('n', '54. lettrer sur les divers débiteurs et créditeurs du plan (467100) : il passe la liste',
      'f', jsonb_build_array('lettrer_pieces(uuid, text, uuid[])'), 'dossier', d_mvt,
      'prep', format('update dossiers set mode_comptable = %L where id = %L', 'engagement', d_mvt),
      'sql', format('select lettrer_pieces(%L, %L, array[%L]::uuid[])', d_mvt, '467100', gen_random_uuid()),
      'attendu', '22023|Un lettrage fait à la main apparie au moins deux pièces.'),
    jsonb_build_object('n', '55. lettrer sur le 401000, que le plan ne porte plus : ce compte ne se lettre pas',
      'f', jsonb_build_array('lettrer_pieces(uuid, text, uuid[])'), 'dossier', d_mvt,
      'prep', format('update dossiers set mode_comptable = %L where id = %L', 'engagement', d_mvt),
      'sql', format('select lettrer_pieces(%L, %L, array[%L]::uuid[])', d_mvt, '401000', gen_random_uuid()),
      'attendu', '22023|Ce compte n''est pas un compte de tiers qui se lettre.'),

    -- Le report des soldes, lu par le propriétaire sur des écritures validées posées par la restauration.
    jsonb_build_object('n', '60. le report d''une entreprise individuelle en trésorerie : le résultat et l''exploitant au capital du plan (101100)',
      'f', jsonb_build_array('soldes_a_reporter(uuid, integer)'), 'dossier', d_ind,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais)
                         values (%L, 'ESSAI PLAN REPORT I', %L, 'tresorerie', '455000')$q$, d_ind, cabinet),
      'prep', format($q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code,
                          numero_ecriture, piece_ref, piece_date, compte_lib) values
                        (%1$L, '2025-02-01', '706000', 'ESSAI', 500, 'credit', 'validee', now(), 'BQ', 1, 'ESSAI', '2025-02-01', 'Honoraires'),
                        (%1$L, '2025-02-01', '512100', 'ESSAI', 500, 'debit', 'validee', now(), 'BQ', 1, 'ESSAI', '2025-02-01', 'Banque'),
                        (%1$L, '2025-03-01', '108100', 'ESSAI', 200, 'debit', 'validee', now(), 'BQ', 2, 'ESSAI', '2025-03-01', 'Compte de l''exploitant'),
                        (%1$L, '2025-03-01', '512100', 'ESSAI', 200, 'credit', 'validee', now(), 'BQ', 2, 'ESSAI', '2025-03-01', 'Banque')$q$, d_ind),
      'sql', 'select 1', 'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2) || ':' || coalesce(libelle, '?'), ',' order by compte collate "C")
                         from soldes_a_reporter(%L, 2025)$q$, d_ind),
      'egal', '101100:credit:300.00:Capital individuel,512100:debit:300.00:Banque'),
    jsonb_build_object('n', '61. le report d''une société en bénéfice : au résultat bénéficiaire du plan (120100), en attente d''affectation',
      'f', jsonb_build_array('soldes_a_reporter(uuid, integer)'), 'dossier', d_ben,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais)
                         values (%L, 'ESSAI PLAN REPORT B', %L, 'engagement', '455000')$q$, d_ben, cabinet),
      'prep', format($q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code,
                          numero_ecriture, piece_ref, piece_date, compte_lib) values
                        (%1$L, '2025-02-01', '411100', 'ESSAI', 1000, 'debit', 'validee', now(), 'VE', 1, 'ESSAI', '2025-02-01', 'Clients'),
                        (%1$L, '2025-02-01', '706000', 'ESSAI', 1000, 'credit', 'validee', now(), 'VE', 1, 'ESSAI', '2025-02-01', 'Prestations'),
                        (%1$L, '2025-03-01', '606100', 'ESSAI', 400, 'debit', 'validee', now(), 'BQ', 1, 'ESSAI', '2025-03-01', 'Achats'),
                        (%1$L, '2025-03-01', '512100', 'ESSAI', 400, 'credit', 'validee', now(), 'BQ', 1, 'ESSAI', '2025-03-01', 'Banque')$q$, d_ben),
      'sql', 'select 1', 'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2) || ':' || coalesce(libelle, '?'), ',' order by compte collate "C")
                         from soldes_a_reporter(%L, 2025)$q$, d_ben),
      'egal', '120100:credit:600.00:Résultat de l’exercice 2025 (bénéfice), en attente d’affectation,411100:debit:1000.00:Clients,512100:credit:400.00:Banque'),
    jsonb_build_object('n', '62. le report d''une société en perte : au résultat déficitaire du plan (129100), en attente d''affectation',
      'f', jsonb_build_array('soldes_a_reporter(uuid, integer)'), 'dossier', d_per,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais)
                         values (%L, 'ESSAI PLAN REPORT P', %L, 'engagement', '455000')$q$, d_per, cabinet),
      'prep', format($q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code,
                          numero_ecriture, piece_ref, piece_date, compte_lib) values
                        (%1$L, '2025-03-01', '606100', 'ESSAI', 300, 'debit', 'validee', now(), 'BQ', 1, 'ESSAI', '2025-03-01', 'Achats'),
                        (%1$L, '2025-03-01', '512100', 'ESSAI', 300, 'credit', 'validee', now(), 'BQ', 1, 'ESSAI', '2025-03-01', 'Banque')$q$, d_per),
      'sql', 'select 1', 'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2) || ':' || coalesce(libelle, '?'), ',' order by compte collate "C")
                         from soldes_a_reporter(%L, 2025)$q$, d_per),
      'egal', '129100:debit:300.00:Résultat de l’exercice 2025 (perte), en attente d’affectation,512100:credit:300.00:Banque'),
    jsonb_build_object('n', '63. un dirigeant au 108000 quand l''exploitant du plan est au 108100 n''est pas « individuel » (ce que l''étape PC4 refusera de régler)',
      'f', jsonb_build_array('soldes_a_reporter(uuid, integer)'), 'dossier', d_108,
      'avant', format($q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais)
                         values (%L, 'ESSAI PLAN REPORT 108', %L, 'engagement', '108000')$q$, d_108, cabinet),
      'prep', format($q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code,
                          numero_ecriture, piece_ref, piece_date, compte_lib) values
                        (%1$L, '2025-02-01', '706000', 'ESSAI', 500, 'credit', 'validee', now(), 'BQ', 1, 'ESSAI', '2025-02-01', 'Prestations'),
                        (%1$L, '2025-02-01', '512100', 'ESSAI', 500, 'debit', 'validee', now(), 'BQ', 1, 'ESSAI', '2025-02-01', 'Banque')$q$, d_108),
      'sql', 'select 1', 'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2) || ':' || coalesce(libelle, '?'), ',' order by compte collate "C")
                         from soldes_a_reporter(%L, 2025)$q$, d_108),
      'egal', '120100:credit:500.00:Résultat de l’exercice 2025 (bénéfice), en attente d’affectation,512100:debit:500.00:Banque')
  );

  for e in select * from jsonb_array_elements(etapes) loop
    select string_agg(x.f, ', ') into manque from jsonb_array_elements_text(e->'f') as x(f)
     where not coalesce((select p.prosrc ~ 'public\.compte_du_(role|dirigeant)\(' from pg_proc p
                          where p.oid = to_regprocedure('public.' || x.f)), false);
    if manque is not null then
      verdicts := verdicts || jsonb_build_object('controle', (e->>'n') || ' — EN ATTENTE : ' || manque || ' ne lit pas encore le plan',
        'observe', 'les migrations la_base_lit_le_plan ne sont pas en base pour elle', 'ok', not pc2_exigee);
      continue;
    end if;
    accepte := false; code_recu := null; message := null; obs := null;
    begin
      -- Le plan se pose par la seule porte ouverte : le propriétaire, sous la session du super-administrateur.
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      if e->>'dossier' = d_mvt::text then execute format(mvt_sql, d_mvt, cabinet, m_debit, m_credit); end if;
      if e ? 'avant' then execute e->>'avant'; end if;
      execute format(plan_sql, e->>'dossier');
      if e ? 'prep' then execute e->>'prep'; end if;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      execute e->>'sql';
      accepte := true;
      reset role;
      if e ? 'verif' then execute e->>'verif' into obs; end if;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    if e->>'attendu' = 'fait' then
      ok := accepte and code_recu = 'P0001' and obs is not distinct from e->>'egal';
      observe := coalesce(obs, '?') || case when code_recu = 'P0001' then '' else ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message, '') end;
    else
      ok := not accepte and code_recu || '|' || message = e->>'attendu';
      observe := coalesce(code_recu, 'ACCEPTÉ') || ' ' || coalesce(message, '');
    end if;
    verdicts := verdicts || jsonb_build_object('controle', e->>'n', 'observe', observe, 'ok', coalesce(ok, false));
  end loop;

  -- ══ 99. Rien n'est resté ══
  select concat_ws('/', (select count(*) from plan_comptable_dossier), (select count(*) from ecritures_brouillon),
      (select count(*) from dossiers), (select count(*) from lignes_bancaires), (select count(*) from emprunts),
      (select count(*) from cotisations_declarees), (select count(*) from immobilisations), (select count(*) from vehicules),
      (select count(*) from declarations_tva), (select count(*) from lettrages_manuels), (select count(*) from a_nouveaux),
      (select count(*) from soldes_reportes), (select count(*) from exercices_valides), (select count(*) from ventilations_bancaires))
    into apres;
  select string_agg(id || ':' || mode_comptable || ':' || compte_notes_de_frais || ':' || assujetti_tva, ',' order by id)
    into texte from dossiers;
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '99. rien n''est resté en base',
    'observe', 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)) || ', dossiers ' || case when texte = config_avant then 'inchangés' else 'CHANGÉS' end,
    'ok', avant = apres and texte = config_avant);

  perform set_config('essai.la_base_lit_le_plan', verdicts::text, true);
end $$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier sans ses lignes de commentaire
-- (`grep -v '^\s*--'`) par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.la_base_lit_le_plan')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
