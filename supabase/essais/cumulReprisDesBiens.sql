-- LE CUMUL REPRIS D'UN BIEN, LE PLAN CONTINUÉ (EXP58-Q5 ; la migration préparée `cumul_repris_des_biens`,
-- supabase/schema/20261119080000_cumul_repris_des_biens.sql). Le récit : HISTORIQUE.md, « 17/11/2026 — EXP58-Q5 : LE CUMUL
-- REPRIS D'UN BIEN, LE PLAN CONTINUÉ (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer après toute migration qui touche
-- `ecrire_dotation_amortissement`, le calcul (`amortissement_cumule_continue_centimes`, `dotation_amortissement_continue`,
-- `amortissement_cumule_centimes`, `rang_360`), `garder_cumul_repris`, `garder_bien_valide`, leurs déclencheurs, ou les
-- contraintes de `immobilisations`. SANS LA MIGRATION (les colonnes absentes du catalogue), il se dit EN ATTENTE.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : deux colonnes nullables sans défaut ; les trois contraintes, telles que src/lib/cumulRepris.ts les redit ;
--      la garde du cumul aux droits du propriétaire, qu'aucun rôle de session n'exécute, sur toute insertion et toute mise à
--      jour ; le figement d'hier (`garder_bien_valide`, la ligne entière) intact ; les corps des quatre fonctions ;
--   2. LE CALCUL : sans cumul repris, celui d'hier au centime (`dotation_amortissement`) ; avec lui, des dotations de la table
--      relevée par src/lib/amortissements.test.ts (`TABLE_CONTINUEE`), le cumul repris exact à son jour, la valeur nette
--      restante soldée ;
--   3. LES CONTRAINTES : le chef inscrit un bien repris avec son cumul ; un cumul sans date, une date qui n'est pas un 31
--      décembre ou précède l'acquisition, un cumul négatif, au millième ou plus grand que la valeur, un cumul positif d'un bien
--      pas encore en service, un cumul plus petit que la valeur d'un plan fini à sa date, une valeur ramenée sous le cumul : la
--      base refuse, sous le nom de la contrainte ; un cumul égal à la valeur d'un plan fini, un cumul nul d'un bien mis en
--      service après lui passent ;
--   4. LES DOTATIONS : le chef écrit celle du plan continué, et non plus le recalcul ; avant l'ouverture, rien ; un cumul daté
--      d'un autre jour que le 31 décembre qui précède l'année de l'ouverture, ou dans un dossier sans ouverture, n'en porte
--      aucune (deux refus, à leurs mots), une dotation déjà écrite s'y retire encore ; sans cumul, le calcul d'hier ; le client
--      se fait refuser ;
--   5. LE FIGEMENT : un exercice validé qui suit la date du cumul le fige — ni changé, ni retiré, ni posé sur un bien qui n'en
--      avait pas, ni emporté dans un autre dossier, au chef comme au propriétaire hors de la RLS, sous les mots
--      d'`exercice_fige` ; le reste du bien se modifie encore ; un exercice validé à la date même du cumul ne le fige pas ; sans
--      exercice validé, il change.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `c0e50000-0000-4000-8000`) : DA, ouvert au 1er janvier 2025 par
-- une balance reprise, et DS, sans ouverture ; une nature de chacun (218300) ; dans DA les biens BA (4 800 € sur cinq ans, mis
-- en service le 15 mars 2022, 2 000 € repris au 31 décembre 2024 : le cas A de la table), BP (le même, son cumul daté du 31
-- décembre 2023) et BR (le même, sans cumul) ; dans DS, BS (le même que BA). Chaque étape se joue dans sa sous-transaction et
-- s'y ANNULE (`ANNULATION_ETAPE`) : ce que le propriétaire pose d'abord (un exercice validé posé à la main, comme dans
-- dateDeValeurDesMouvements.sql : c'est le figement qu'on éprouve, pas la validation), puis le geste (du chef ou du client sous
-- la RLS, ou du propriétaire), puis la fin de la transaction simulée, puis ce qu'on relit ; le jeu s'annule à la fin
-- (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.cumul_repris_des_biens`) : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune
-- instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, il se
-- joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  da constant text := 'c0e50000-0000-4000-8000-0000000000d1';
  ds constant text := 'c0e50000-0000-4000-8000-0000000000d2';
  na constant text := 'c0e50000-0000-4000-8000-0000000000e1';
  ns constant text := 'c0e50000-0000-4000-8000-0000000000e2';
  ba constant text := 'c0e50000-0000-4000-8000-0000000000b1';
  bp constant text := 'c0e50000-0000-4000-8000-0000000000b2';
  br constant text := 'c0e50000-0000-4000-8000-0000000000b3';
  bs constant text := 'c0e50000-0000-4000-8000-0000000000b4';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  appliquee constant boolean := exists (select 1 from pg_attribute a where a.attrelid = 'public.immobilisations'::regclass
                                          and a.attname = 'cumul_repris' and not a.attisdropped);
  contrainte constant text := 'new row for relation "immobilisations" violates check constraint "immobilisations_cumul_repris_';
  fige constant text := 'L''exercice 2025 est validé : le cumul repris d''un bien ne change plus.';
  pas_conforme constant text := 'L''écriture proposée ne correspond pas à la dotation 2025 de ce bien.';
  valide_2025 constant text := $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes,
    nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{DA}', 2025, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0,
    repeat('0', 64), '{}'::jsonb);$q$;
  valide_2024 constant text := $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes,
    nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{DA}', 2024, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0,
    repeat('0', 64), '{}'::jsonb);$q$;
  -- La dotation d'un exercice composée comme l'application la compose (`ecritureDeLaDotation`) : le 681100 au débit, le 281830
  -- au crédit (la nature des dossiers jetables porte le 218300).
  dotation constant text := $q$jsonb_build_array(jsonb_build_object('compte', '681100', 'sens', 'debit', 'montant', {M}, 'libelle', 'ESSAI EXP58Q5'),
    jsonb_build_object('compte', '281830', 'sens', 'credit', 'montant', {M}, 'libelle', 'ESSAI EXP58Q5'))$q$;
  lignes constant text := $q$(select coalesce(string_agg(e.compte || ':' || e.sens || ':' || e.montant::text, ',' order by e.compte), 'aucune')
    from ecritures_brouillon e where e.immobilisation_id = '{BIEN}')$q$;
  e record; v_code text; v_msg text; v_obs text; v_textes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.cumul_repris_des_biens', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration cumul_repris_des_biens (EXP58-Q5)', 'ok', true,
      'observe', 'absente : le cumul repris d''un bien ne se saisit pas encore ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (da::uuid, 'ESSAI EXP58Q5 DA', cabinet, 'tresorerie', '455000'),
      (ds::uuid, 'ESSAI EXP58Q5 DS', cabinet, 'tresorerie', '455000');
    insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      (da::uuid, '2025-01-01', '218300', 'ESSAI EXP58Q5', 'debit', 4800, 'balance-essai.csv', repeat('c', 64)),
      (da::uuid, '2025-01-01', '281830', 'ESSAI EXP58Q5', 'credit', 2000, 'balance-essai.csv', repeat('c', 64)),
      (da::uuid, '2025-01-01', '101000', 'ESSAI EXP58Q5', 'credit', 2800, 'balance-essai.csv', repeat('c', 64));
    insert into natures_immobilisation (id, dossier_id, libelle, duree_annees_defaut, compte_immobilisation) values
      (na::uuid, da::uuid, 'ESSAI EXP58Q5 NATURE', 5, '218300'),
      (ns::uuid, ds::uuid, 'ESSAI EXP58Q5 NATURE', 5, '218300');
    insert into immobilisations (id, dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees, cumul_repris, cumul_repris_au) values
      (ba::uuid, da::uuid, na::uuid, 'ESSAI EXP58Q5 BA', 4800, '2022-03-15', 5, 2000, '2024-12-31'),
      (bp::uuid, da::uuid, na::uuid, 'ESSAI EXP58Q5 BP', 4800, '2022-03-15', 5, 2000, '2023-12-31'),
      (br::uuid, da::uuid, na::uuid, 'ESSAI EXP58Q5 BR', 4800, '2022-03-15', 5, null, null),
      (bs::uuid, ds::uuid, ns::uuid, 'ESSAI EXP58Q5 BS', 4800, '2022-03-15', 5, 2000, '2024-12-31');

    -- Une étape : {rang, étape, ce que le PROPRIÉTAIRE pose d'abord, qui fait le geste (`chef` ou `client` sous la RLS,
    -- `proprio` hors d'elle), le geste, ce qu'on relit, le code attendu (`OK` : accepté) et ce qu'on relit, ou les mots du refus
    -- (un `%` s'y lit comme dans LIKE)}.
    for e in select * from (values
      (1, '1. le catalogue : deux colonnes nullables sans défaut ; les trois contraintes ; la garde du cumul, security definer, sur toute insertion et toute mise à jour, qu''aucun rôle de session n''exécute ; le figement de la ligne entière intact ; les corps des quatre fonctions',
        null, 'proprio', null,
        $q$(select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text, ', ' order by a.attname)
             from pg_attribute a where a.attrelid = 'public.immobilisations'::regclass and a.attname in ('cumul_repris', 'cumul_repris_au') and not a.attisdropped)
           || ' | ' || (select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname) from pg_constraint c
                         where c.conrelid = 'public.immobilisations'::regclass and c.conname like 'immobilisations_cumul_repris%')
           || ' | ' || (select string_agg(t.tgname || ' ' || t.tgtype::text || ' ' || coalesce(nullif(t.tgattr::text, ''), 'toute') || ' ' || t.tgenabled::text
                                          || ' ' || p.proname || ' ' || p.prosecdef::text, ' ; ' order by t.tgname)
                         from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                        where t.tgrelid = 'public.immobilisations'::regclass and not t.tgisinternal and t.tgname <> '_acces_avant_les_gardes')
           || ' | ' || (has_function_privilege('authenticated', 'public.garder_cumul_repris()', 'execute')
                        or has_function_privilege('anon', 'public.garder_cumul_repris()', 'execute'))::text
           || ' | ' || (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname) from pg_proc p
                         where p.oid in ('public.ecrire_dotation_amortissement(uuid, integer, jsonb)'::regprocedure,
                                         'public.amortissement_cumule_continue_centimes(numeric, integer, date, numeric, date, integer)'::regprocedure,
                                         'public.dotation_amortissement_continue(numeric, integer, date, numeric, date, integer)'::regprocedure,
                                         'public.garder_cumul_repris()'::regprocedure, 'public.garder_bien_valide()'::regprocedure))$q$,
        'OK', 'cumul_repris numeric false false, cumul_repris_au date false false'
          || ' | immobilisations_cumul_repris_borne CHECK (((cumul_repris IS NULL) OR ((cumul_repris = round(cumul_repris, 2)) AND (cumul_repris >= (0)::numeric) AND (cumul_repris <= valeur))))'
          || ' ; immobilisations_cumul_repris_date CHECK ((((cumul_repris IS NULL) = (cumul_repris_au IS NULL)) AND ((cumul_repris_au IS NULL) OR ((EXTRACT(month FROM cumul_repris_au) = (12)::numeric) AND (EXTRACT(day FROM cumul_repris_au) = (31)::numeric) AND (cumul_repris_au >= date_acquisition)))))'
          || ' ; immobilisations_cumul_repris_plan CHECK (((cumul_repris IS NULL) OR (cumul_repris_au IS NULL) OR (((cumul_repris = (0)::numeric) OR (cumul_repris_au >= COALESCE(date_mise_en_service, date_acquisition))) AND ((cumul_repris = valeur) OR ((((((EXTRACT(year FROM COALESCE(date_mise_en_service, date_acquisition)) * (360)::numeric) + ((EXTRACT(month FROM COALESCE(date_mise_en_service, date_acquisition)) - (1)::numeric) * (30)::numeric)) + LEAST(EXTRACT(day FROM COALESCE(date_mise_en_service, date_acquisition)), (30)::numeric)) - (1)::numeric) + ((360 * duree_annees))::numeric) >= ((EXTRACT(year FROM cumul_repris_au) * (360)::numeric) + (361)::numeric))))))'
          || ' | immobilisations_figees_par_la_validation 31 toute O garder_bien_valide true ; immobilisations_garde_du_cumul_repris 23 toute O garder_cumul_repris true'
          || ' | false'
          || ' | amortissement_cumule_continue_centimes=e9a17d10854f9bd927c6277fc2ddf4dd,dotation_amortissement_continue=b01f45c02836f707b27bf0dd9d149ff2,ecrire_dotation_amortissement=003224434bcfa6fe945b16da31eecc0f,garder_bien_valide=2b46434ab930b9f8d5a504acc983e714,garder_cumul_repris=328132bb814c5fb7d0efaf606a114b50'),
      (2, '2. le calcul : sans cumul repris, celui d''hier au centime, de 2018 à 2034 sur six biens (aucun écart)',
        null, 'proprio', null,
        $q$(select count(*)::text from generate_series(2018, 2034) as a(annee), (values
             (1233::numeric, 3, date '2023-11-30'), (1000, 4, date '2024-02-29'), (679.84, 2, date '2024-12-20'), (12000, 5, date '2026-07-01'),
             (999999.99, 10, date '2025-05-17'), (1.01, 1, date '2025-07-01')) as b(valeur, duree, service)
            where public.dotation_amortissement_continue(b.valeur, b.duree, b.service, null, null, a.annee)
                  is distinct from public.dotation_amortissement(b.valeur, b.duree, b.service, a.annee))$q$,
        'OK', '0'),
      (3, '2b. … avec lui, la table relevée (A, E, G, H, J, K, N), le cumul repris exact à son jour, la valeur nette restante soldée',
        null, 'proprio', null,
        $q$(select string_agg(x, ',') from (values
             (public.dotation_amortissement_continue(4800, 5, date '2022-03-15', 2000, date '2024-12-31', 2025)::text),
             (public.dotation_amortissement_continue(4800, 5, date '2022-03-15', 2000, date '2024-12-31', 2026)::text),
             (public.dotation_amortissement_continue(4800, 5, date '2022-03-15', 2000, date '2024-12-31', 2027)::text),
             (public.dotation_amortissement_continue(999999.99, 10, date '2020-05-17', 432109.87, date '2024-12-31', 2027)::text),
             (public.dotation_amortissement_continue(600, 1, date '2023-01-01', 600, date '2024-12-31', 2025)::text),
             (public.dotation_amortissement_continue(1.01, 3, date '2024-07-01', 0.17, date '2024-12-31', 2026)::text),
             (public.dotation_amortissement_continue(3333.33, 7, date '2019-10-15', 1234.56, date '2024-12-31', 2025)::text),
             (public.dotation_amortissement_continue(1000, 3, date '2024-12-31', 0.28, date '2024-12-31', 2027)::text),
             (public.dotation_amortissement_continue(1234.56, 7, date '2018-03-15', 1100, date '2024-12-31', 2025)::text),
             (public.amortissement_cumule_continue_centimes(4800, 5, date '2022-03-15', 2000, date '2024-12-31', public.rang_360(date '2024-12-31'))::text),
             ((select sum(public.dotation_amortissement_continue(4800, 5, date '2022-03-15', 2000, date '2024-12-31', a)) from generate_series(2025, 2040) as a)::text)
           ) as t(x))$q$,
        'OK', '1269.52,1269.52,260.96,105599.41,0.00,0.33,1173.23,332.62,134.56,200000,2800.00'),
      (4, '3. le chef inscrit un bien repris avec son cumul au 31 décembre de la reprise : accepté',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees, cumul_repris, cumul_repris_au) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 1200, '2023-06-01', 4, 450.25, '2024-12-31');$q$,
        $q$(select string_agg(cumul_repris::text || ' ' || cumul_repris_au::text, ',') from immobilisations where dossier_id = '{DA}' and libelle = 'ESSAI EXP58Q5 INSERE')$q$, 'OK', '450.25 2024-12-31'),
      (5, '3b. un cumul sans sa date : refusé',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees, cumul_repris) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 1200, '2023-06-01', 4, 450);$q$,
        null, '23514', contrainte || 'date"'),
      (6, '3c. une date qui n''est pas un 31 décembre : refusé',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees, cumul_repris, cumul_repris_au) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 1200, '2023-06-01', 4, 450, '2024-12-30');$q$,
        null, '23514', contrainte || 'date"'),
      (7, '3d. une date qui précède l''acquisition : refusé',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees, cumul_repris, cumul_repris_au) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 1200, '2023-06-01', 4, 0, '2022-12-31');$q$,
        null, '23514', contrainte || 'date"'),
      (8, '3e. un cumul plus grand que la valeur, la base amortissable : refusé',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees, cumul_repris, cumul_repris_au) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 1200, '2023-06-01', 4, 1200.01, '2024-12-31');$q$,
        null, '23514', contrainte || 'borne"'),
      (9, '3f. un cumul négatif : refusé',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees, cumul_repris, cumul_repris_au) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 1200, '2023-06-01', 4, -0.01, '2024-12-31');$q$,
        null, '23514', contrainte || 'borne"'),
      (10, '3g. un cumul au millième : refusé',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees, cumul_repris, cumul_repris_au) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 1200, '2023-06-01', 4, 450.005, '2024-12-31');$q$,
        null, '23514', contrainte || 'borne"'),
      (11, '3h. un cumul positif d''un bien mis en service après sa date : refusé',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, date_mise_en_service, duree_annees, cumul_repris, cumul_repris_au) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 1200, '2024-11-02', '2025-01-01', 4, 10, '2024-12-31');$q$,
        null, '23514', contrainte || 'plan"'),
      (12, '3i. un cumul plus petit que la valeur d''un plan fini à sa date : refusé',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees, cumul_repris, cumul_repris_au) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 600, '2023-01-01', 2, 599.99, '2024-12-31');$q$,
        null, '23514', contrainte || 'plan"'),
      (13, '3j. le même, entièrement amorti à sa date : accepté',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees, cumul_repris, cumul_repris_au) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 600, '2023-01-01', 2, 600, '2024-12-31');$q$,
        $q$(select string_agg(cumul_repris::text, ',') from immobilisations where dossier_id = '{DA}' and libelle = 'ESSAI EXP58Q5 INSERE')$q$, 'OK', '600'),
      (14, '3k. un plan qui court encore un jour après la date (mis en service un 1er janvier, fini le 1er) : un cumul plus petit passe',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees, cumul_repris, cumul_repris_au) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 600, '2023-01-02', 2, 599.99, '2024-12-31');$q$,
        $q$(select string_agg(cumul_repris::text, ',') from immobilisations where dossier_id = '{DA}' and libelle = 'ESSAI EXP58Q5 INSERE')$q$, 'OK', '599.99'),
      (15, '3l. un cumul nul d''un bien mis en service après sa date : accepté',
        null, 'chef', $q$insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, date_mise_en_service, duree_annees, cumul_repris, cumul_repris_au) values ('{DA}', '{NA}', 'ESSAI EXP58Q5 INSERE', 1200, '2024-11-02', '2025-01-01', 4, 0, '2024-12-31');$q$,
        $q$(select string_agg(cumul_repris::text, ',') from immobilisations where dossier_id = '{DA}' and libelle = 'ESSAI EXP58Q5 INSERE')$q$, 'OK', '0'),
      (16, '3m. la valeur d''un bien ramenée sous son cumul repris : refusé',
        null, 'chef', $q$update immobilisations set valeur = 1999.99 where id = '{BA}';$q$,
        null, '23514', contrainte || 'borne"'),
      (17, '4. le chef écrit la dotation 2025 du plan continué (1 269,52 €) : deux lignes',
        null, 'chef', $q$select ecrire_dotation_amortissement('{BA}', 2025, $q$ || replace(dotation, '{M}', '1269.52') || $q$);$q$,
        replace(lignes, '{BIEN}', '{BA}'), 'OK', '281830:credit:1269.52,681100:debit:1269.52'),
      (18, '4b. … et non plus le recalcul depuis la mise en service (960 €) : refusé',
        null, 'chef', $q$select ecrire_dotation_amortissement('{BA}', 2025, $q$ || replace(dotation, '{M}', '960') || $q$);$q$,
        null, '22023', pas_conforme),
      (19, '4c. la dotation 2026 du plan continué : 1 269,52 € encore',
        null, 'chef', $q$select ecrire_dotation_amortissement('{BA}', 2026, $q$ || replace(dotation, '{M}', '1269.52') || $q$);$q$,
        replace(lignes, '{BIEN}', '{BA}'), 'OK', '281830:credit:1269.52,681100:debit:1269.52'),
      (20, '4d. l''exercice 2024, avant l''ouverture : refusé, comme hier',
        null, 'chef', $q$select ecrire_dotation_amortissement('{BA}', 2024, $q$ || replace(dotation, '{M}', '715.71') || $q$);$q$,
        null, '22023', 'L''exercice 2024 précède l''ouverture du dossier : sa dotation est déjà dans les à-nouveaux.'),
      (21, '4e. un cumul daté du 31 décembre 2023, quand l''ouverture du 1er janvier 2025 en demande un au 31 décembre 2024 : refusé',
        null, 'chef', $q$select ecrire_dotation_amortissement('{BP}', 2025, $q$ || replace(dotation, '{M}', '1269.52') || $q$);$q$,
        null, '22023', 'Le cumul repris de ce bien est daté du 31/12/2023 : l''ouverture du dossier, le 01/01/2025, en demande un au 31/12/2024.'),
      (22, '4f. … une dotation écrite avant sur lui se retire encore (l''appel vide)',
        $q$insert into ecritures_brouillon (dossier_id, immobilisation_id, date, compte, libelle, montant, sens, statut) values
           ('{DA}', '{BP}', '2025-12-31', '681100', 'ESSAI EXP58Q5', 1269.52, 'debit', 'proposee'),
           ('{DA}', '{BP}', '2025-12-31', '281830', 'ESSAI EXP58Q5', 1269.52, 'credit', 'proposee');$q$,
        'chef', $q$select ecrire_dotation_amortissement('{BP}', 2025, '[]'::jsonb);$q$,
        replace(lignes, '{BIEN}', '{BP}'), 'OK', 'aucune'),
      (23, '4g. un cumul dans un dossier sans ouverture : refusé',
        null, 'chef', $q$select ecrire_dotation_amortissement('{BS}', 2025, $q$ || replace(dotation, '{M}', '1269.52') || $q$);$q$,
        null, '22023', 'Le cumul repris de ce bien, au 31/12/2024, suppose un dossier ouvert par une balance reprise : ce dossier n''en a pas.'),
      (24, '4h. sans cumul repris, le calcul d''hier (960 €) : accepté',
        null, 'chef', $q$select ecrire_dotation_amortissement('{BR}', 2025, $q$ || replace(dotation, '{M}', '960') || $q$);$q$,
        replace(lignes, '{BIEN}', '{BR}'), 'OK', '281830:credit:960,681100:debit:960'),
      (25, '4i. le client se fait refuser',
        null, 'client', $q$select ecrire_dotation_amortissement('{BA}', 2025, $q$ || replace(dotation, '{M}', '1269.52') || $q$);$q$,
        null, '42501', 'Accès refusé à ce bien.'),
      (26, '5. un exercice 2025 validé : le cumul repris d''un bien ne change plus',
        valide_2025, 'chef', $q$update immobilisations set cumul_repris = 2100 where id = '{BA}';$q$,
        null, '23514', fige),
      (27, '5b. … ne se retire plus',
        valide_2025, 'chef', $q$update immobilisations set cumul_repris = null, cumul_repris_au = null where id = '{BA}';$q$,
        null, '23514', fige),
      (28, '5c. … ne se pose plus sur un bien qui n''en avait pas',
        valide_2025, 'chef', $q$update immobilisations set cumul_repris = 2000, cumul_repris_au = '2024-12-31' where id = '{BR}';$q$,
        null, '23514', fige),
      (29, '5d. … ne quitte plus son dossier avec le bien',
        valide_2025, 'chef', $q$update immobilisations set dossier_id = '{DS}', nature_id = '{NS}' where id = '{BA}';$q$,
        null, '23514', fige),
      (30, '5e. … ni pour le propriétaire, hors de la RLS',
        valide_2025, 'proprio', $q$update immobilisations set cumul_repris = 2100 where id = '{BA}';$q$,
        null, '23514', fige),
      (31, '5f. le reste du bien se modifie encore : son libellé',
        valide_2025, 'chef', $q$update immobilisations set libelle = 'ESSAI EXP58Q5 BA RENOMME' where id = '{BA}';$q$,
        $q$(select libelle from immobilisations where id = '{BA}')$q$, 'OK', 'ESSAI EXP58Q5 BA RENOMME'),
      (32, '5g. un exercice validé à la date même du cumul (2024) ne le fige pas : il change',
        valide_2024, 'chef', $q$update immobilisations set cumul_repris = 2100 where id = '{BA}';$q$,
        $q$(select cumul_repris::text from immobilisations where id = '{BA}')$q$, 'OK', '2100'),
      (33, '5h. le contrôle positif : sans exercice validé, le cumul repris change',
        null, 'chef', $q$update immobilisations set cumul_repris = 2100 where id = '{BA}';$q$,
        $q$(select cumul_repris::text from immobilisations where id = '{BA}')$q$, 'OK', '2100')
    ) as v(rang, etape, pose, qui, geste, relu, code, attendu) order by rang
    loop
      v_code := 'OK';
      v_msg := null;
      v_obs := null;
      begin
        v_textes := array[e.pose, e.geste, e.relu, e.attendu];
        for i in 1 .. 4 loop
          if v_textes[i] is null then continue; end if;
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{DA}', da), '{DS}', ds), '{NA}', na), '{NS}', ns);
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{BA}', ba), '{BP}', bp), '{BR}', br), '{BS}', bs);
          v_textes[i] := replace(v_textes[i], '{CHEF}', chef);
        end loop;
        if v_textes[1] is not null then
          execute v_textes[1];
        end if;
        begin
          if v_textes[2] is not null then
            if e.qui in ('chef', 'client') then
              execute 'set local role authenticated';
              perform set_config('request.jwt.claims', json_build_object('sub', case e.qui when 'chef' then chef else client end,
                'role', 'authenticated')::text, true);
            end if;
            execute v_textes[2];
            reset role;
            perform set_config('request.jwt.claims', '', true);
          end if;
          -- La fin de la transaction, simulée : les déclencheurs différés jugent ce que le geste a laissé.
          set constraints all immediate;
          set constraints all deferred;
          if v_textes[3] is not null then
            execute 'select (' || v_textes[3] || ')::text' into v_obs;
          end if;
          v_msg := coalesce(v_obs, '');
        exception when others then
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
        'ok', v_code = e.code and v_msg like v_textes[4], 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leur ouverture, leurs natures, leurs biens, leurs écritures ou leurs exercices validés',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, ds::uuid))
      and not exists (select 1 from a_nouveaux where dossier_id in (da::uuid, ds::uuid))
      and not exists (select 1 from natures_immobilisation where id in (na::uuid, ns::uuid) or libelle like 'ESSAI EXP58Q5%')
      and not exists (select 1 from immobilisations where id in (ba::uuid, bp::uuid, br::uuid, bs::uuid) or libelle like 'ESSAI EXP58Q5%')
      and not exists (select 1 from ecritures_brouillon where dossier_id in (da::uuid, ds::uuid) or libelle = 'ESSAI EXP58Q5')
      and not exists (select 1 from exercices_valides where dossier_id in (da::uuid, ds::uuid)),
    'observe', 'relu');
  perform set_config('essai.cumul_repris_des_biens', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.cumul_repris_des_biens')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
