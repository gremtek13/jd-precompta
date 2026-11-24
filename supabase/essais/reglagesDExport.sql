-- ESSAI DES RÉGLAGES DE L'EXPORT VERS UN LOGICIEL COMPTABLE (EXP-Q4 (A) ; migration `reglages_d_export`, PRÉPARÉE le 24/11/2026).
-- SUR UNE RÉPLIQUE SEULEMENT : il crée des dossiers fictifs et écrit des réglages, puis s'annule. Joué ENTIER, en une
-- transaction qui s'annule (`begin` … `rollback`), par psql et par le super-utilisateur (il remplace des fonctions et des
-- policies dans ses mutations), sans `-1` :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/reglagesDExport.sql
-- Ce qu'il juge, par impersonation (le chef, qui est aussi super-administrateur dans le semis ; un membre de l'équipe assigné
-- au dossier ; le même membre sur un dossier qui ne lui est pas assigné ; un client qui a un accès au dossier ; l'anonyme ;
-- et le propriétaire, sans session) :
--   RX-A. l'accès (EXP-Q8 (A)) : le chef et le membre assigné enregistrent et lisent, l'auteur et l'instant posés par la base ;
--         le membre non assigné, le client et l'anonyme n'enregistrent ni ne lisent rien ; un dossier inconnu et un appel sans
--         session se refusent sous les mêmes mots ;
--   RX-B. chaque refus de `enregistrer_reglages_d_export`, sous son code et ses MOTS (ceux de src/lib/reglagesDExport.ts,
--         `REFUS_DE_LA_BASE`), dans l'ordre de la fonction ; les bornes acceptées ; un réglage nul reste « à saisir » ;
--   RX-C. la version lue : une saisie qui en remplace une autre se refuse, la ligne se réécrit entière, colonnes énumérées ;
--   RX-D. la garde et les contraintes : aucune écriture directe, sauf la réinsertion du super-administrateur, telle qu'elle a
--         été écrite ; la ligne ne change ni de dossier ni de logiciel ; une valeur hors de ses bornes écrite en direct ;
--   RX-E. le catalogue : la RLS, les deux policies, la garde aux droits de l'appelant (sans la porte), les droits d'exécution,
--         les droits de la table, la liste fermée, la clé vers le dossier en cascade.
-- Puis des MUTATIONS de la migration, chacune dans une sous-transaction annulée, qui doivent faire virer un contrôle au rouge ;
-- la dernière étend la liste fermée par un `create or replace` et montre que la contrainte et la fonction la suivent.
-- Se lit : toute ligne « en faute » est une faute de la migration ; toute mutation qui « NE MORD PAS » est un contrôle qui ne
-- prouve plus rien. Sans la migration, une ligne dit qu'il attend (EN ATTENTE).

begin;

create temp table rx_verdict (rang serial, controle text, observe text, ok boolean);
create temp table rx_mutation (rang serial, mutation text, observe text, mord boolean);

-- Tente une requête SOUS une identité (nulle : l'anonyme), et l'annule : rend « OK <résultat> » ou « <sqlstate> <message> ».
create function pg_temp.tente(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare
  v_resultat text;
  v_issue text;
begin
  begin
    if p_uid is null then
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    end if;
    execute p_sql into v_resultat;
    v_issue := 'OK ' || coalesce(v_resultat, '');
    raise exception 'ANNULATION_TENTATIVE';
  exception when others then
    if sqlerrm <> 'ANNULATION_TENTATIVE' then
      v_issue := sqlstate || ' ' || sqlerrm;
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_issue;
end
$$;

-- La même, qui GARDE ce qu'elle a écrit.
create function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare
  v_resultat text;
  v_issue text;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    execute p_sql into v_resultat;
    v_issue := 'OK ' || coalesce(v_resultat, '');
  exception when others then
    v_issue := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_issue;
end
$$;

-- Le propriétaire, sans session : la requête, annulée.
create function pg_temp.proprietaire(p_sql text) returns text language plpgsql as $$
declare
  v_resultat text;
  v_issue text;
begin
  begin
    perform set_config('request.jwt.claims', '', true);
    execute p_sql into v_resultat;
    v_issue := 'OK ' || coalesce(v_resultat, '');
    raise exception 'ANNULATION_TENTATIVE';
  exception when others then
    if sqlerrm <> 'ANNULATION_TENTATIVE' then
      v_issue := sqlstate || ' ' || sqlerrm;
    end if;
  end;
  return v_issue;
end
$$;

-- L'appel, en texte, pour `tente` et `fait` : les réglages tels que `reglagesPourLaBase` les donne.
create function pg_temp.appel(p_dossier uuid, p_logiciel text, p_reglages jsonb, p_version integer) returns text language sql as $$
  select format('select public.enregistrer_reglages_d_export(%L::uuid, %L, %L::jsonb, %s)::text',
                p_dossier, p_logiciel, p_reglages, coalesce(p_version::text, 'null'))
$$;

create function pg_temp.verdict(p_controle text, p_observe text, p_ok boolean) returns void language sql as $$
  insert into rx_verdict (controle, observe, ok) values (p_controle, p_observe, coalesce(p_ok, false))
$$;

do $essai$
declare
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  da uuid := 'e9400000-0000-4000-8000-0000000000a1';   -- assigné au membre, ouvert au client
  dn uuid := 'e9400000-0000-4000-8000-0000000000a2';   -- NON assigné au membre
  dr uuid := 'e9400000-0000-4000-8000-0000000000a3';   -- sans réglage : la restauration, les contraintes, la clé
  di uuid := 'e9400000-0000-4000-8000-0000000000ff';   -- aucun dossier
  -- Les mots du module (src/lib/reglagesDExport.ts, REFUS_DE_LA_BASE), au caractère près.
  m_acces text := 'Accès refusé à ce dossier.';
  m_logiciel text := 'Ce logiciel n’a pas de profil d’export dans l’application.';
  m_objet text := 'Les réglages d’export se donnent en un objet aux clés longueur_des_comptes, forme_des_tiers et journaux.';
  m_longueur text := 'La longueur des comptes du logiciel va de 6 à 12 caractères, ou reste à saisir.';
  m_forme text := 'La forme des comptes de tiers est l’une de celles que l’application connaît, ou reste à saisir.';
  m_journaux text := 'La correspondance des journaux va d’un journal de l’application (AC, VE, BQ, OD, AN) à son code dans le logiciel.';
  m_code text := 'Le code d’un journal dans le logiciel tient en 1 à 20 lettres ou chiffres, sans espace, ou reste à saisir.';
  m_version text := 'Les réglages d’export de ce dossier ont changé depuis leur lecture : relis-les avant de les enregistrer.';
  m_garde text := 'Les réglages d’export ne s’écrivent que par enregistrer_reglages_d_export.';
  m_cle text := 'Les réglages d’export d’un dossier ne passent ni à un autre dossier ni à un autre logiciel.';
  -- Les saisies de l'essai.
  complets jsonb := '{"longueur_des_comptes":8,"forme_des_tiers":"sans_auxiliaires","journaux":{"AC":"HA","VE":"VT","BQ":"CA1","OD":"OD","AN":"AN"}}';
  partiels jsonb := '{"longueur_des_comptes":10,"forme_des_tiers":null,"journaux":{"BQ":"BNP","AN":null}}';
  issue text;
  texte text;
  n bigint;
begin
  if to_regclass('public.reglages_d_export') is null then
    perform pg_temp.verdict('0. EN ATTENTE de la migration reglages_d_export', 'absente : l''essai se joue dès que la migration y est', true);
    return;
  end if;

  -- ── Le jeu, écrit par le propriétaire ──
  insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva) values
    (da, 'EXP-Q4 essai A', cabinet, 'tresorerie', 'franchise'), (dn, 'EXP-Q4 essai N', cabinet, 'tresorerie', 'franchise'),
    (dr, 'EXP-Q4 essai R', cabinet, 'engagement', 'redevable');
  insert into dossier_assignations (dossier_id, user_id) values (da, membre);
  insert into memberships (user_id, dossier_id, role, email) values (client, da, 'client', 'essai-expq4@example.test');

  -- ══ RX-A. L'accès (EXP-Q8 (A)) ══
  issue := pg_temp.fait(chef, pg_temp.appel(da, 'acd', complets, null));
  perform pg_temp.verdict('RX-A1. le chef enregistre les réglages d''un dossier sans réglage (la version lue nulle) : la version 1', issue, issue = 'OK 1');
  select longueur_des_comptes || '|' || forme_des_tiers || '|' || journal_ac || journal_ve || journal_bq || journal_od || journal_an
      || '|' || version || '|' || (regle_par = chef) || '|' || (regle_le = now())
    into texte from reglages_d_export where dossier_id = da and logiciel = 'acd';
  perform pg_temp.verdict('RX-A2. … la ligne porte ce qu''il a dit, à son compte et à l''instant de l''écriture', texte,
    texte = '8|sans_auxiliaires|HAVTCA1ODAN|1|true|true');
  issue := pg_temp.tente(chef, format('select count(*)::text from reglages_d_export where dossier_id = %L', da));
  perform pg_temp.verdict('RX-A3. … et la lit (le contrôle positif)', issue, issue = 'OK 1');
  issue := pg_temp.fait(membre, pg_temp.appel(da, 'acd', partiels, 1));
  perform pg_temp.verdict('RX-A4. le membre de l''équipe assigné au dossier les remplace, contre la version lue (EXP-Q8 (A), le contrôle positif)', issue, issue = 'OK 2');
  select coalesce(longueur_des_comptes::text, 'nul') || '|' || coalesce(forme_des_tiers, 'à saisir') || '|'
      || coalesce(journal_ac, '-') || coalesce(journal_ve, '-') || coalesce(journal_bq, '-') || coalesce(journal_od, '-') || coalesce(journal_an, '-')
      || '|' || version || '|' || (regle_par = membre)
    into texte from reglages_d_export where dossier_id = da and logiciel = 'acd';
  perform pg_temp.verdict('RX-A5. … la ligne entière réécrite (ce qui manque reste à saisir, jamais gardé d''avant), à son compte', texte,
    texte = '10|à saisir|--BNP--|2|true');
  issue := pg_temp.tente(membre, format('select count(*)::text from reglages_d_export where dossier_id = %L', da));
  perform pg_temp.verdict('RX-A6. … et les lit', issue, issue = 'OK 1');
  issue := pg_temp.tente(membre, pg_temp.appel(dn, 'acd', complets, null));
  perform pg_temp.verdict('RX-A7. le membre n''enregistre rien dans un dossier qui ne lui est pas assigné (42501)', issue, issue = '42501 ' || m_acces);
  perform pg_temp.fait(chef, pg_temp.appel(dn, 'acd', complets, null));
  issue := pg_temp.tente(membre, format('select count(*)::text from reglages_d_export where dossier_id = %L', dn));
  perform pg_temp.verdict('RX-A8. … ni n''y lit les réglages que le chef y a enregistrés', issue, issue = 'OK 0');
  issue := pg_temp.tente(client, pg_temp.appel(da, 'acd', complets, 2));
  perform pg_temp.verdict('RX-A9. le client qui a un accès au dossier n''enregistre rien (42501), même à la bonne version', issue, issue = '42501 ' || m_acces);
  issue := pg_temp.tente(client, 'select (count(*) = 0)::text from reglages_d_export');
  perform pg_temp.verdict('RX-A10. … et ne lit aucune ligne de la table (aucune branche client)', issue, issue = 'OK true');
  issue := pg_temp.tente(null, pg_temp.appel(da, 'acd', complets, 2));
  perform pg_temp.verdict('RX-A11. l''anonyme n''exécute pas la fonction (42501, le droit d''exécution)', issue, issue like '42501 %' and issue <> '42501 ' || m_acces);
  issue := pg_temp.tente(null, 'select (count(*) = 0)::text from reglages_d_export');
  perform pg_temp.verdict('RX-A12. … ni ne lit rien de la table', issue, issue = 'OK true');
  issue := pg_temp.tente(chef, pg_temp.appel(di, 'acd', complets, null));
  perform pg_temp.verdict('RX-A13. un dossier qui n''existe pas, même pour le super-administrateur : les mêmes mots (42501)', issue, issue = '42501 ' || m_acces);
  issue := pg_temp.proprietaire(pg_temp.appel(da, 'acd', complets, 2));
  perform pg_temp.verdict('RX-A14. un appel sans session (le propriétaire, un rôle de service) : les mêmes mots (42501)', issue, issue = '42501 ' || m_acces);
  issue := pg_temp.tente(client, pg_temp.appel(da, 'quadra', '"x"', null));
  perform pg_temp.verdict('RX-A15. l''accès se juge avant tout le reste : le client, sur un logiciel et des réglages faux (42501)', issue, issue = '42501 ' || m_acces);

  -- ══ RX-B. Les refus, dans l'ordre de la fonction ══
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'quadra', complets, 2));
  perform pg_temp.verdict('RX-B1. un logiciel hors de la liste fermée (22023)', issue, issue = '22023 ' || m_logiciel);
  issue := pg_temp.tente(membre, pg_temp.appel(da, null, complets, 2));
  perform pg_temp.verdict('RX-B2. … ou nul (22023)', issue, issue = '22023 ' || m_logiciel);
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'quadra', '{"longueur_des_comptes":99}', 2));
  perform pg_temp.verdict('RX-B3. le logiciel se juge avant les réglages', issue, issue = '22023 ' || m_logiciel);
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '[]', 2));
  perform pg_temp.verdict('RX-B4. des réglages qui ne sont pas un objet (22023)', issue, issue = '22023 ' || m_objet);
  issue := pg_temp.tente(membre, format('select public.enregistrer_reglages_d_export(%L::uuid, ''acd'', null, 2)::text', da));
  perform pg_temp.verdict('RX-B5. … nuls (22023)', issue, issue = '22023 ' || m_objet);
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{"longueur_des_comptes":8,"encodage":"utf8"}', 2));
  perform pg_temp.verdict('RX-B6. … ou à une clé que la base ne connaît pas (22023)', issue, issue = '22023 ' || m_objet);
  select string_agg(coalesce(nullif(pg_temp.tente(membre, pg_temp.appel(da, 'acd', jsonb_build_object('longueur_des_comptes', v), 2)),
                                    '22023 ' || m_longueur), 'refusé'), ',' order by r)
    into texte from (values (1, '5'::jsonb), (2, '13'), (3, '7.5'), (4, '"8"'), (5, 'true'), (6, '-8'), (7, '{"n":8}')) x(r, v);
  perform pg_temp.verdict('RX-B7. une longueur hors de 6 à 12, décimale, en texte, booléenne ou en objet (22023, chaque fois)', texte,
    texte = 'refusé,refusé,refusé,refusé,refusé,refusé,refusé');
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{"forme_des_tiers":"racines_c_et_f"}', 2));
  perform pg_temp.verdict('RX-B8. une forme des tiers hors de la liste (22023)', issue, issue = '22023 ' || m_forme);
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{"forme_des_tiers":1}', 2));
  perform pg_temp.verdict('RX-B9. … ou qui n''est pas un texte (22023)', issue, issue = '22023 ' || m_forme);
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{"journaux":["BQ"]}', 2));
  perform pg_temp.verdict('RX-B10. une correspondance des journaux qui n''est pas un objet (22023)', issue, issue = '22023 ' || m_journaux);
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{"journaux":{"BQ":"CA1","CA":"CA2"}}', 2));
  perform pg_temp.verdict('RX-B11. … ou qui nomme un journal que l''application n''écrit pas (22023)', issue, issue = '22023 ' || m_journaux);
  select string_agg(coalesce(nullif(pg_temp.tente(membre, pg_temp.appel(da, 'acd', jsonb_build_object('journaux', jsonb_build_object('BQ', v)), 2)),
                                    '22023 ' || m_code), 'refusé'), ',' order by r)
    into texte from (values (1, '""'::jsonb), (2, '"B Q"'), (3, to_jsonb(repeat('A', 21))), (4, '"BQé"'), (5, '12'), (6, '"BQ-1"'),
                            (7, to_jsonb('BQ' || chr(9)))) x(r, v);
  perform pg_temp.verdict('RX-B12. un code vide, avec une espace, de 21 caractères, accentué, en nombre, avec un tiret ou une tabulation (22023, chaque fois)', texte,
    texte = 'refusé,refusé,refusé,refusé,refusé,refusé,refusé');
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{"longueur_des_comptes":13,"forme_des_tiers":"x","journaux":{"BQ":""}}', 2));
  perform pg_temp.verdict('RX-B13. l''ordre : la longueur avant la forme et les journaux', issue, issue = '22023 ' || m_longueur);
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{"forme_des_tiers":"x","journaux":{"BQ":""}}', 2));
  perform pg_temp.verdict('RX-B14. … la forme avant les journaux', issue, issue = '22023 ' || m_forme);
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{"longueur_des_comptes":13}', 1));
  perform pg_temp.verdict('RX-B15. … et les réglages avant la version lue', issue, issue = '22023 ' || m_longueur);
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd',
    jsonb_build_object('longueur_des_comptes', 6, 'forme_des_tiers', 'nos_auxiliaires', 'journaux', jsonb_build_object('BQ', repeat('Z', 20), 'OD', 'od9')), 2));
  perform pg_temp.verdict('RX-B16. les bornes passent : 6 caractères, un code de 20, des minuscules', issue, issue = 'OK 3');
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{"longueur_des_comptes":12}', 2));
  perform pg_temp.verdict('RX-B17. … 12 caractères', issue, issue = 'OK 3');
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{}', 2));
  perform pg_temp.verdict('RX-B18. des réglages vides s''enregistrent : tout reste à saisir', issue, issue = 'OK 3');
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{"longueur_des_comptes":null,"forme_des_tiers":null,"journaux":null}', 2));
  perform pg_temp.verdict('RX-B19. … comme des réglages nuls', issue, issue = 'OK 3');

  -- ══ RX-C. La version lue ══
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', complets, 1));
  perform pg_temp.verdict('RX-C1. une saisie qui remplace une version qui n''est plus la dernière (40001)', issue, issue = '40001 ' || m_version);
  issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', complets, null));
  perform pg_temp.verdict('RX-C2. … ou qui se dit première sur un dossier qui a déjà ses réglages (40001)', issue, issue = '40001 ' || m_version);
  issue := pg_temp.tente(chef, pg_temp.appel(dn, 'acd', complets, 7));
  perform pg_temp.verdict('RX-C3. … ou qui porte une version qui n''a jamais existé (40001)', issue, issue = '40001 ' || m_version);
  issue := pg_temp.tente(chef, pg_temp.appel(dr, 'acd', complets, 1));
  perform pg_temp.verdict('RX-C3b. … ou qui porte une version lue sur un dossier sans réglage (40001)', issue, issue = '40001 ' || m_version);
  issue := pg_temp.fait(chef, pg_temp.appel(da, 'acd', complets, 2));
  select count(*) || '|' || max(version) || '|' || bool_and(regle_par = chef) into texte from reglages_d_export where dossier_id = da;
  perform pg_temp.verdict('RX-C4. la version suit d''une unité, une seule ligne par dossier et par logiciel, au compte du dernier', issue || ' ' || texte,
    issue = 'OK 3' and texte = '1|3|true');
  issue := pg_temp.proprietaire(format($q$with x as (select set_config('jd.reglages_d_export', %L, true))
    insert into reglages_d_export (dossier_id, logiciel, regle_par) select %L, 'acd', %L from x returning 1$q$, da, da, chef));
  perform pg_temp.verdict('RX-C5. une seconde ligne du même dossier et du même logiciel se refuse (la contrainte totale, 23505)', issue,
    issue like '23505 %reglages_d_export_un_par_logiciel%');

  -- ══ RX-D. La garde et les contraintes ══
  issue := pg_temp.proprietaire(format($q$insert into reglages_d_export (dossier_id, logiciel, regle_par) values (%L, 'acd', %L) returning 1$q$, dr, chef));
  perform pg_temp.verdict('RX-D1. le propriétaire n''insère pas de ligne en direct (42501)', issue, issue = '42501 ' || m_garde);
  issue := pg_temp.proprietaire(format($q$update reglages_d_export set longueur_des_comptes = 7 where dossier_id = %L returning 1$q$, da));
  perform pg_temp.verdict('RX-D2. … ni n''en réécrit une (42501)', issue, issue = '42501 ' || m_garde);
  issue := pg_temp.proprietaire(format($q$with x as (select set_config('jd.reglages_d_export', %L, true))
    update reglages_d_export set dossier_id = %L where dossier_id = %L and exists (select 1 from x) returning 1$q$, dr, dr, da));
  perform pg_temp.verdict('RX-D3. une ligne ne passe pas à un autre dossier, même sous le réglage local de celui-ci (23514)', issue, issue = '23514 ' || m_cle);
  issue := pg_temp.tente(membre, format($q$insert into reglages_d_export (dossier_id, logiciel, regle_par) values (%L, 'acd', %L) returning 1$q$, dn, membre));
  perform pg_temp.verdict('RX-D4. le membre n''insère pas de ligne en direct (42501)', issue, issue like '42501 %');
  issue := pg_temp.tente(membre, format($q$update reglages_d_export set longueur_des_comptes = 7 where dossier_id = %L returning 1$q$, da));
  perform pg_temp.verdict('RX-D5. … ni n''en réécrit une (aucune policy de mise à jour : rien ne change)', issue,
    issue = 'OK ' and (select longueur_des_comptes from reglages_d_export where dossier_id = da) = 8);
  issue := pg_temp.tente(membre, format($q$delete from reglages_d_export where dossier_id = %L returning 1$q$, da));
  perform pg_temp.verdict('RX-D6. … ni n''en retire une (aucune policy de retrait : rien ne part)', issue,
    issue = 'OK ' and exists (select 1 from reglages_d_export where dossier_id = da));
  issue := pg_temp.tente(chef, format($q$insert into reglages_d_export (dossier_id, logiciel, longueur_des_comptes, journal_bq, version, regle_par, regle_le)
    values (%L, 'acd', 9, 'RESTAURE', 7, %L, '2020-02-03T04:05:06Z')
    returning version || '|' || (regle_par = %L) || '|' || to_char(regle_le at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')$q$, dr, membre, membre));
  perform pg_temp.verdict('RX-D7. le super-administrateur réinsère une ligne telle qu''elle a été écrite (la restauration) : sa version, son auteur, son instant', issue,
    issue = 'OK 7|true|2020-02-03 04:05:06');
  issue := pg_temp.tente(chef, format($q$update reglages_d_export set longueur_des_comptes = 7 where dossier_id = %L returning 1$q$, da));
  perform pg_temp.verdict('RX-D8. … mais ne réécrit rien en direct, lui non plus', issue, issue = 'OK ');
  select string_agg(pg_temp.tente(chef, format($q$insert into reglages_d_export (dossier_id, logiciel, %s, regle_par)
      values (%L, %L, %s, %L) returning 1$q$, c, dr, l, v, chef)), ' ; ' order by r)
    into texte from (values (1, 'longueur_des_comptes', 'acd', '13'), (2, 'forme_des_tiers', 'acd', '''racines''::text'),
                            (3, 'journal_bq', 'acd', '''B Q''::text'), (4, 'version', 'acd', '0'), (5, 'journal_an', 'quadra', 'null')) x(r, c, l, v);
  perform pg_temp.verdict('RX-D9. une valeur hors de ses bornes écrite en direct par le super-administrateur : la contrainte de chacune (23514)', texte,
    texte like '23514 %reglages_d_export_longueur_des_comptes% ; 23514 %reglages_d_export_forme_des_tiers% ; 23514 %reglages_d_export_journal_bq% ; 23514 %reglages_d_export_version% ; 23514 %reglages_d_export_logiciel%');

  -- ══ RX-E. Le catalogue ══
  select (select relrowsecurity from pg_class where oid = 'public.reglages_d_export'::regclass)::text
    || ' ' || (select string_agg(polname || ':' || polcmd::text || ':' || coalesce(pg_get_expr(polqual, polrelid), '-') || ':'
                                 || coalesce(pg_get_expr(polwithcheck, polrelid), '-'), ',' order by polname)
               from pg_policy where polrelid = 'public.reglages_d_export'::regclass and not (polname = 'deux_facteurs' and not polpermissive))
    || ' ' || (select string_agg(tgname::text, ',' order by tgname collate "C") from pg_trigger
               where tgrelid = 'public.reglages_d_export'::regclass and not tgisinternal)
    into texte;
  perform pg_temp.verdict('RX-E1. la RLS, la lecture du cabinet du dossier et la réinsertion du super-administrateur ; la garde seule, sans la porte', texte,
    texte = 'true reglages_d_export_lecture:r:admin_du_dossier(dossier_id):-,reglages_d_export_restauration:a:-:is_super_admin() reglages_d_export_garde');
  select string_agg(p.proname || ':' || p.prosecdef || ':' || p.provolatile::text || ':' || has_function_privilege('anon', p.oid, 'execute')
                    || '/' || has_function_privilege('authenticated', p.oid, 'execute')
                    || '/' || exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0), ',' order by p.proname)
    into texte from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('enregistrer_reglages_d_export', 'garder_reglages_d_export', 'logiciels_d_export');
  perform pg_temp.verdict('RX-E2. l''exécution : la fonction et la liste au compte connecté seul, la garde à personne ; la fonction seule aux droits du propriétaire, la liste immuable', texte,
    texte = 'enregistrer_reglages_d_export:true:v:false/true/false,garder_reglages_d_export:false:v:false/false/false,logiciels_d_export:false:i:false/true/false');
  select string_agg(distinct a.privilege_type, ',' order by a.privilege_type) into texte
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.oid = 'public.reglages_d_export'::regclass and a.grantee in ('anon'::regrole, 'authenticated'::regrole);
  perform pg_temp.verdict('RX-E3. les droits de la table : SELECT, INSERT, UPDATE et DELETE seuls (droits_hors_rls)', texte,
    texte = 'DELETE,INSERT,SELECT,UPDATE');
  select array_to_string(public.logiciels_d_export(), ',') || ' | ' || (select confdeltype::text from pg_constraint
      where conname = 'reglages_d_export_dossier_id_fkey' and conrelid = 'public.reglages_d_export'::regclass)
    || ' | ' || (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
                 from pg_attribute a where a.attrelid = 'public.reglages_d_export'::regclass and a.attnum > 0 and not a.attisdropped)
    into texte;
  perform pg_temp.verdict('RX-E4. la liste fermée (acd), la clé vers le dossier en cascade, les colonnes et leur nullité', texte,
    texte = 'acd | c | id:uuid:true,dossier_id:uuid:true,logiciel:text:true,longueur_des_comptes:integer:false,forme_des_tiers:text:false,'
      || 'journal_ac:text:false,journal_ve:text:false,journal_bq:text:false,journal_od:text:false,journal_an:text:false,version:integer:true,'
      || 'regle_par:uuid:true,regle_le:timestamp with time zone:true');
  -- La restrictive de la double authentification ne se juge pas ici : le bloc DF de rls.sql la veut sur chaque table de public
  -- une fois `deux_facteurs_exiges` collée, et deuxFacteursDesTablesNeuves.test.ts lit sa pose sous condition dans la migration.

  -- ══ Les mutations ══
  -- M-RX1 : l'accès ouvert à tout compte connecté.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_reglages_d_export(uuid, text, jsonb, integer)'::regprocedure),
      'or not coalesce(public.admin_du_dossier(p_dossier_id), false)', '');
    issue := pg_temp.tente(client, pg_temp.appel(da, 'acd', complets, 3));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into rx_mutation (mutation, observe, mord) values ('M-RX1 — l''accès sans admin_du_dossier (RX-A9)', issue, issue like 'OK %');
  -- M-RX2 : la version lue oubliée.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_reglages_d_export(uuid, text, jsonb, integer)'::regprocedure),
      'if (v_existe and (p_version_lue is null or p_version_lue <> v_actuelle.version)) or (not v_existe and p_version_lue is not null) then',
      'if false then');
    issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', complets, 1));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into rx_mutation (mutation, observe, mord) values ('M-RX2 — la version lue oubliée (RX-C1)', issue, issue like 'OK %');
  -- M-RX3 : la garde sans le chemin de l'écriture.
  begin
    execute replace(pg_get_functiondef('public.garder_reglages_d_export()'::regprocedure),
      'is distinct from new.dossier_id::text', 'is distinct from new.dossier_id::text and false');
    issue := pg_temp.proprietaire(format($q$insert into reglages_d_export (dossier_id, logiciel, regle_par) values (%L, 'acd', %L) returning 1$q$, dr, chef));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into rx_mutation (mutation, observe, mord) values ('M-RX3 — la garde ouverte à toute écriture directe (RX-D1)', issue, issue like 'OK %');
  -- M-RX4 : la clé de la ligne non gardée.
  begin
    execute replace(pg_get_functiondef('public.garder_reglages_d_export()'::regprocedure),
      'if tg_op = ''UPDATE'' and (new.dossier_id is distinct from old.dossier_id or new.logiciel is distinct from old.logiciel) then', 'if false then');
    issue := pg_temp.proprietaire(format($q$with x as (select set_config('jd.reglages_d_export', %L, true))
      update reglages_d_export set dossier_id = %L where dossier_id = %L and exists (select 1 from x) returning 1$q$, dr, dr, da));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into rx_mutation (mutation, observe, mord) values ('M-RX4 — la ligne qui change de dossier (RX-D3)', issue, issue = 'OK 1');
  -- M-RX5 : le code d'un journal non jugé par la fonction (la contrainte le refuse encore, mais plus sous ses mots).
  begin
    execute replace(pg_get_functiondef('public.enregistrer_reglages_d_export(uuid, text, jsonb, integer)'::regprocedure),
      'and (jsonb_typeof(v_valeur) <> ''string'' or (v_valeur #>> ''{}'') !~ ''^[A-Za-z0-9]{1,20}$'') then', 'and false then');
    issue := pg_temp.tente(membre, pg_temp.appel(da, 'acd', '{"journaux":{"BQ":"B Q"}}', 3));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into rx_mutation (mutation, observe, mord) values ('M-RX5 — le code d''un journal non jugé par la fonction (RX-B12)', issue, issue is distinct from '22023 ' || m_code);
  -- M-RX6 : la lecture élargie au client du dossier.
  begin
    alter policy reglages_d_export_lecture on public.reglages_d_export
      using (admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = reglages_d_export.dossier_id and m.user_id = auth.uid()));
    issue := pg_temp.tente(client, format('select count(*)::text from reglages_d_export where dossier_id = %L', da));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into rx_mutation (mutation, observe, mord) values ('M-RX6 — la lecture élargie au client du dossier (RX-A10)', issue, issue = 'OK 1');
  -- M-RX7 : la porte de la restauration fermée.
  begin
    alter policy reglages_d_export_restauration on public.reglages_d_export with check (false);
    issue := pg_temp.tente(chef, format($q$insert into reglages_d_export (dossier_id, logiciel, regle_par) values (%L, 'acd', %L) returning 1$q$, dr, chef));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into rx_mutation (mutation, observe, mord) values ('M-RX7 — la porte de la restauration fermée (RX-D7)', issue, issue like '42501 %');
  -- M-RX8 : la liste fermée étendue par un `create or replace` (le geste d'un logiciel de plus) : la fonction et la contrainte
  -- le suivent, sans autre migration — le contrôle RX-B1 vire au rouge.
  begin
    create or replace function public.logiciels_d_export() returns text[]
      language sql immutable set search_path = public as $l$ select array['acd', 'quadra']::text[] $l$;
    issue := pg_temp.tente(membre, pg_temp.appel(da, 'quadra', complets, null));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into rx_mutation (mutation, observe, mord) values ('M-RX8 — la liste fermée étendue à un second logiciel (RX-B1)', issue, issue = 'OK 1');
end
$essai$;

select 'INVARIANTS' as tableau, controle as ligne, case when ok then 'juste' else '*** EN FAUTE ***' end as resultat, observe as detail
  from rx_verdict
union all
select 'MUTATIONS', mutation, case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end, observe
  from rx_mutation
union all
select 'BILAN', 'invariants et mutations',
  (select count(*) filter (where not ok) from rx_verdict) || ' en faute / ' || (select count(*) from rx_verdict) || ' ; '
  || (select count(*) filter (where mord) from rx_mutation) || ' mutations sur ' || (select count(*) from rx_mutation) || ' qui mordent', ''
order by 1 desc, 2;

rollback;
