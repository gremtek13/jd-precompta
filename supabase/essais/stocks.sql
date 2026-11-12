-- ESSAI DES STOCKS DE CLÔTURE (ligne 36, LIA2 ; migration `stocks_de_cloture`, PRÉPARÉE) — SUR UNE RÉPLIQUE SEULEMENT :
-- il change le modèle comptable d'un dossier, écrit des à-nouveaux, mute des fonctions et des déclencheurs, et ne laisse
-- rien (ROLLBACK final). Se joue par psql, SANS -1 (le fichier porte sa transaction) :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/stocks.sql
-- Les profils : un membre du cabinet du dossier du client qui n'est PAS super-administrateur (le contrôle positif ; le
-- chef du semis l'est, et la porte de la restauration lui ouvrirait les écritures directes), le super-administrateur (la
-- restauration), le client de ce dossier, l'anonyme, et le propriétaire (pour poser le jeu et les sources). Chaque refus est attendu avec sa RAISON (le code et les mots) ; chaque
-- mutation doit faire virer un cas au rouge. Le dernier tableau compte : « 0 en faute » et « toutes mordent ».
begin;

create temp table essai_stocks (cas text, attendu text, observe text, ok boolean);
create temp table essai_mutations (mutation text, observe text, mord boolean);

-- Un appel sous un profil, dans une sous-transaction : annulé, sauf `p_garder`. Rend « ACCEPTÉ [valeur] » ou
-- « SQLSTATE message ».
create function pg_temp.essayer(p_qui text, p_sql text, p_garder boolean default false) returns text
language plpgsql as $f$
declare
  r text;
begin
  begin
    if p_qui = 'anon' then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      execute 'set local role anon';
    elsif p_qui is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', p_qui, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
    if p_sql ~* '^\s*select' and p_sql !~ ';' then
      execute p_sql into r;
    else
      execute p_sql;
    end if;
    r := 'ACCEPTÉ' || coalesce(' ' || nullif(r, ''), '');
    if not p_garder then
      raise exception 'ANNULATION_ESSAI';
    end if;
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then r := sqlstate || ' ' || sqlerrm; end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return r;
end
$f$;

do $essai$
declare
  chef text := '3e3b0000-0000-4000-8000-000000000001';
  client text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dossier text := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  autre_piece text;
  super_admin text;
  stock text;
  o text;
  appel text;
  bon text := '[{"compte":"603700","sens":"debit","centimes":1000000,"libelle":"Annulation du stock initial 2026 (370000)"},'
    || '{"compte":"370000","sens":"credit","centimes":1000000,"libelle":"Annulation du stock initial 2026 (370000)"},'
    || '{"compte":"370000","sens":"debit","centimes":1234500,"libelle":"Stock final au 31/12/2026 (370000)"},'
    || '{"compte":"603700","sens":"credit","centimes":1234500,"libelle":"Stock final au 31/12/2026 (370000)"}]';
  saisie text := '{"exercice":2026,"compte_stock":"370000","montant_centimes":1234500,"methode":"cmup","objet":"Inventaire physique du 31/12","piece_citee_id":null}';
  def text;
begin
  select p.id::text into autre_piece from pieces p where p.dossier_id <> dossier::uuid order by p.id limit 1;
  -- Le membre du cabinet, assigné au dossier : `admin_du_dossier` lui ouvre le dossier sans qu'il soit chef.
  insert into dossier_assignations (dossier_id, user_id) values (dossier::uuid, chef::uuid) on conflict do nothing;
  select s.user_id::text into super_admin from super_admins s order by s.user_id limit 1;

  -- E0. Le BNC en trésorerie : le dossier l'est encore — la fonction le refuse, sous sa raison.
  o := pg_temp.essayer(chef, format('select enregistrer_stock_de_cloture(%L, %L, %L, null)', dossier, saisie, bon));
  insert into essai_stocks values ('E0. un dossier en trésorerie se refuse (P0001, la raison)',
    'P0001 Un dossier en trésorerie ne tient pas de stock de clôture : la 2035 n''en connaît pas.', o,
    o = 'P0001 Un dossier en trésorerie ne tient pas de stock de clôture : la 2035 n''en connaît pas.');

  -- Le jeu : le dossier passe en engagement (son brouillon est vide) ; ses à-nouveaux portent 10 000,00 au 370000 et un
  -- 310000 créditeur de 1,00.
  update dossiers set mode_comptable = 'engagement' where id = dossier::uuid;
  insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
  values (dossier::uuid, '2026-01-01', '370000', 'Stock de marchandises', 'debit', 10000.00, 'essai', repeat('a', 64)),
         (dossier::uuid, '2026-01-01', '310000', 'Matières', 'credit', 1.00, 'essai', repeat('a', 64)),
         (dossier::uuid, '2026-01-01', '512000', 'Banque', 'debit', 1.00, 'essai', repeat('a', 64));

  -- E1. Le chef enregistre le stock : l'annulation du stock initial, la constatation du final, au 31/12, sans autre source.
  o := pg_temp.essayer(chef, format('select enregistrer_stock_de_cloture(%L, %L, %L, null)', dossier, saisie, bon), true);
  stock := substr(o, 9);
  insert into essai_stocks
  select 'E1. le chef enregistre le stock : quatre lignes au 31/12, le 370000 au stock final, le 603700 à initial − final',
    'ACCEPTÉ, 4 lignes, 12345,00 et -2345,00, version 1', o || ' | ' || count(*) || ' lignes, '
      || coalesce(sum(case when b.compte = '370000' then case b.sens when 'debit' then b.montant else -b.montant end end), 0) || ' et '
      || coalesce(sum(case when b.compte = '603700' then case b.sens when 'debit' then -b.montant else b.montant end end), 0)
      || ', version ' || (select s.version from stocks_de_cloture s where s.id::text = stock),
    o like 'ACCEPTÉ %' and count(*) = 4 and bool_and(b.date = '2026-12-31' and b.statut = 'proposee' and b.piece_id is null)
      and sum(case when b.compte = '370000' then case b.sens when 'debit' then b.montant else -b.montant end end) = 2345.00
      and sum(case when b.compte = '603700' then case b.sens when 'debit' then b.montant else -b.montant end end) = -2345.00
      and (select s.version from stocks_de_cloture s where s.id::text = stock) = 1
  from ecritures_brouillon b where b.stock_de_cloture_id::text = stock;

  -- E2. « Néant » contre la version 1 : l'annulation seule ; version 2.
  o := pg_temp.essayer(chef, format('select enregistrer_stock_de_cloture(%L, %L, %L, 1)', dossier,
    replace(saisie, '1234500', '0'), '[{"compte":"603700","sens":"debit","centimes":1000000,"libelle":"Annulation"},{"compte":"370000","sens":"credit","centimes":1000000,"libelle":"Annulation"}]'), true);
  insert into essai_stocks select 'E2. « néant » remplace le stock (version lue 1) : l''annulation seule, version 2',
    'ACCEPTÉ, 2 lignes, version 2', o || ' | ' || (select count(*) from ecritures_brouillon b where b.stock_de_cloture_id::text = stock)
      || ' lignes, version ' || (select s.version from stocks_de_cloture s where s.id::text = stock),
    o = 'ACCEPTÉ ' || stock and (select count(*) from ecritures_brouillon b where b.stock_de_cloture_id::text = stock) = 2
      and (select s.version from stocks_de_cloture s where s.id::text = stock) = 2;

  -- Les refus de la fonction, chacun sous sa raison.
  appel := 'select enregistrer_stock_de_cloture(%L, %L, %L, %s)';
  o := pg_temp.essayer(chef, format(appel, dossier, saisie, bon, '1'));
  insert into essai_stocks values ('E3. une version périmée (1, la base en est à 2)', '40001 …a changé depuis sa lecture…', o,
    o = '40001 Ce stock de clôture a changé depuis sa lecture : le relire avant de l''enregistrer.');
  o := pg_temp.essayer(chef, format(appel, dossier, replace(saisie, '370000', '320000'), '[]', '1'));
  insert into essai_stocks values ('E4. un stock nouveau, lu à une version', '40001', o,
    o = '40001 Ce stock de clôture a changé depuis sa lecture : le relire avant de l''enregistrer.');
  o := pg_temp.essayer(chef, format(appel, dossier, saisie, replace(bon, '1234500,"libelle":"Stock final au 31/12/2026 (370000)"},{"compte":"603700"', '1234499,"libelle":"Stock final au 31/12/2026 (370000)"},{"compte":"603700"'), '2'));
  insert into essai_stocks values ('E5. un centime de moins sur une ligne', '23514 Les écritures proposées ne sont pas celles…', o,
    o like '23514 Les écritures proposées ne sont pas celles que ce stock commande : l''annulation du stock initial (1000000 centimes) et la constatation du stock final (1234500 centimes), entre le compte 370000 et le compte 603700.');
  o := pg_temp.essayer(chef, format(appel, dossier, saisie,
    '[{"compte":"370000","sens":"debit","centimes":1234500,"libelle":"Stock final"},{"compte":"603700","sens":"credit","centimes":1234500,"libelle":"Stock final"}]', '2'));
  insert into essai_stocks values ('E6. le stock d''ouverture ignoré (la constatation seule)', '23514', o,
    o like '23514 Les écritures proposées ne sont pas celles que ce stock commande%');
  o := pg_temp.essayer(chef, format(appel, dossier, replace(saisie, '370000', '371000'), '[]', 'null'));
  insert into essai_stocks values ('E7. un compte de stock hors du plan du dossier', '23514 Le compte 371000 n''est pas…', o,
    o = '23514 Le compte 371000 n''est pas le compte de ce stock au plan du dossier (370000).');
  o := pg_temp.essayer(chef, format(appel, dossier, replace(saisie, '370000', '390000'), '[]', 'null'));
  insert into essai_stocks values ('E8. un compte hors de la liste (39, la dépréciation)', '22023', o,
    o = '22023 Un stock de clôture se tient sur un compte de stock à six chiffres, sous 31, 32, 33, 34, 35 ou 37.');
  o := pg_temp.essayer(chef, format(appel, dossier, replace(saisie, '2026', '2027'), '[]', 'null'));
  insert into essai_stocks values ('E9. un exercice à venir', '22023', o,
    o = '22023 L''exercice 2027 n''est pas commencé : son stock de clôture ne se saisit pas encore.');
  o := pg_temp.essayer(chef, format(appel, dossier, replace(replace(saisie, '370000', '310000'), '1234500', '0'),
    '[{"compte":"310000","sens":"debit","centimes":100,"libelle":"x"},{"compte":"603100","sens":"credit","centimes":100,"libelle":"x"}]', 'null'));
  insert into essai_stocks values ('E10. un stock qui s''ouvre au crédit', '23514', o,
    o = '23514 Le compte 310000 s''ouvre au crédit (100 centimes) : un stock ne s''ouvre pas au crédit — relire la balance reprise ou les soldes reportés.');
  o := pg_temp.essayer(chef, format(appel, dossier, replace(saisie, 'null}', format('%I}', autre_piece)), bon, '2'));
  insert into essai_stocks values ('E11. la feuille citée est la pièce d''un autre dossier', '23514', o,
    autre_piece is not null and o = '23514 La feuille d''inventaire citée n''est pas une pièce de ce dossier.');
  o := pg_temp.essayer(chef, format(appel, dossier, replace(saisie, '"cmup"', '"lifo"'), bon, '2'));
  insert into essai_stocks values ('E12. une méthode hors de la liste', '22023', o,
    o = '22023 La méthode d''évaluation du stock est hors de sa liste : coût moyen pondéré, premier entré premier sorti, ou coût spécifique.');
  o := pg_temp.essayer(chef, format(appel, dossier, replace(saisie, 'Inventaire physique du 31/12', ' '), bon, '2'));
  insert into essai_stocks values ('E13. un objet blanc', '22023', o,
    o = '22023 L''objet du stock de clôture tient en 1 à 200 caractères, sans espace au début ni à la fin.');
  o := pg_temp.essayer(client, format(appel, dossier, saisie, bon, '2'));
  insert into essai_stocks values ('E14. le client du dossier', '42501 Seul le cabinet du dossier…', o,
    o = '42501 Seul le cabinet du dossier enregistre un stock de clôture.');
  o := pg_temp.essayer('anon', format(appel, dossier, saisie, bon, '2'));
  insert into essai_stocks values ('E15. l''anonyme', '42501 (aucun droit d''exécuter)', o, o like '42501 permission denied for function%');

  -- Les gardes : rien en direct, même par le chef que la policy laisse passer.
  o := pg_temp.essayer(chef, format('insert into stocks_de_cloture (dossier_id, exercice, compte_stock, montant_centimes, methode, objet, cree_par, modifie_par) values (%L, 2026, %L, 1, %L, %L, %L, %L)',
    dossier, '320000', 'cmup', 'x', chef, chef));
  insert into essai_stocks values ('E16. le chef insère un stock en direct', '42501 …ne s''écrit que par…', o,
    o = '42501 Un stock de clôture ne s''écrit que par enregistrer_stock_de_cloture.');
  o := pg_temp.essayer(chef, format('update stocks_de_cloture set montant_centimes = 1 where id = %L', stock));
  insert into essai_stocks values ('E17. le chef modifie un stock en direct', '42501', o,
    o = '42501 Un stock de clôture ne se modifie que par enregistrer_stock_de_cloture, et ne se retire que par retirer_stock_de_cloture.');
  o := pg_temp.essayer(chef, format('delete from stocks_de_cloture where id = %L', stock));
  insert into essai_stocks values ('E18. le chef supprime un stock en direct', '42501', o,
    o = '42501 Un stock de clôture ne se modifie que par enregistrer_stock_de_cloture, et ne se retire que par retirer_stock_de_cloture.');
  o := pg_temp.essayer(chef, format('insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, stock_de_cloture_id) values (%L, %L, %L, %L, 1, %L, %L, %L)',
    dossier, '2026-12-31', '370000', 'x', 'debit', 'proposee', stock));
  insert into essai_stocks values ('E19. le chef écrit une ligne de stock en direct', '42501', o,
    o = '42501 L''écriture d''un stock de clôture ne s''écrit qu''avec ce stock, par enregistrer_stock_de_cloture.');
  o := pg_temp.essayer(chef, format('delete from ecritures_brouillon where stock_de_cloture_id = %L', stock));
  insert into essai_stocks values ('E20. le chef supprime une ligne de stock en direct', '42501', o,
    o = '42501 L''écriture d''un stock de clôture se retire avec ce stock (retirer_stock_de_cloture).');
  o := pg_temp.essayer(chef, format('update ecritures_brouillon set montant = montant + 1 where stock_de_cloture_id = %L', stock));
  insert into essai_stocks values ('E21. le chef modifie une ligne de stock en direct', '42501', o,
    o = '42501 L''écriture d''un stock de clôture ne se modifie pas : enregistrer de nouveau le stock.');
  o := pg_temp.essayer(null, format('select set_config(%L, %L, true); insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, stock_de_cloture_id, piece_id) values (%L, %L, %L, %L, 1, %L, %L, %L, (select id from pieces where dossier_id = %L limit 1))',
    'jd.stock', stock, dossier, '2026-12-31', '370000', 'x', 'debit', 'proposee', stock, dossier));
  insert into essai_stocks values ('E22. une ligne de stock qui cite aussi une pièce (sous le réglage du stock)', '23514 (la contrainte)', o,
    o like '23514 new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_stock_sans_autre_source"%'
    or (o like '23502%' or o like 'ACCEPTÉ%') is false and (select count(*) from pieces where dossier_id = dossier::uuid) = 0);
  o := pg_temp.essayer(null, format('select set_config(%L, %L, true); insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, stock_de_cloture_id) values (%L, %L, %L, %L, 1, %L, %L, %L)',
    'jd.stock', stock, dossier, '2026-12-30', '370000', 'x', 'debit', 'proposee', stock));
  insert into essai_stocks values ('E23. une ligne de stock datée du 30/12', '23514', o,
    o = '23514 Cette écriture ne suit pas son stock de clôture : son dossier, ou sa date (le 31 décembre de son exercice).');

  -- Le gel : le semis n'a aucun exercice validé ; la frontière de la validation est simulée au 31/12/2026 (la fonction
  -- remplacée dans la sous-transaction, puis annulée) — la fonction, puis la garde, refusent sous les mots du gel.
  o := pg_temp.essayer(null, 'create or replace function public.frontiere_validation(p_dossier_id uuid) returns date language sql stable '
    || 'set search_path = public as $m$ select date ''2026-12-31'' $m$; '
    || format('set local role authenticated; select set_config(%L, %L, true); select enregistrer_stock_de_cloture(%L, %L, %L, 2)',
       'request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, dossier, saisie, bon));
  insert into essai_stocks values ('E24. un stock d''un exercice figé (la fonction)', '23514 L''exercice 2026 est figé… : son stock de clôture ne change plus.', o,
    o like '23514 L''exercice 2026 est figé par la validation de l''exercice % : son stock de clôture ne change plus.');
  o := pg_temp.essayer(null, 'create or replace function public.frontiere_validation(p_dossier_id uuid) returns date language sql stable '
    || 'set search_path = public as $m$ select date ''2026-12-31'' $m$; '
    || format('select set_config(%L, %L, true); update stocks_de_cloture set objet = %L where id = %L', 'jd.stock', stock, 'y', stock));
  insert into essai_stocks values ('E24b. un stock d''un exercice figé, sous le réglage du stock (la garde)', '23514', o,
    o like '23514 L''exercice 2026 est figé par la validation de l''exercice % : son stock de clôture ne change plus.');

  -- La restauration du super-administrateur : un stock inséré en direct, sur un dossier sans exercice validé.
  if super_admin is not null then
    o := pg_temp.essayer(super_admin, format('insert into stocks_de_cloture (dossier_id, exercice, compte_stock, montant_centimes, methode, objet, cree_par, modifie_par) values (%L, 2026, %L, 1, %L, %L, %L, %L)',
      dossier, '320000', 'cmup', 'x', chef, chef));
  else
    o := 'NON JOUÉ : aucun super-administrateur au semis';
  end if;
  insert into essai_stocks values ('E25. la restauration du super-administrateur passe', 'ACCEPTÉ', o, o = 'ACCEPTÉ');

  -- Le retrait.
  o := pg_temp.essayer(client, format('select retirer_stock_de_cloture(%L, %L, 2)', dossier, stock));
  insert into essai_stocks values ('E26. le client retire le stock', '42501', o, o = '42501 Seul le cabinet du dossier retire un stock de clôture.');
  o := pg_temp.essayer(chef, format('select retirer_stock_de_cloture(%L, %L, 1)', dossier, stock));
  insert into essai_stocks values ('E27. un retrait contre une version périmée', '40001', o,
    o = '40001 Ce stock de clôture a changé depuis sa lecture : le relire avant de le retirer.');
  o := pg_temp.essayer(chef, format('select retirer_stock_de_cloture(%L, %L, 2)', 'e5f0c2a7-3b1d-4c8e-9f60-7a2d4b6c8e10', stock));
  insert into essai_stocks values ('E28. un retrait sous un autre dossier', '42501', o, o = '42501 Seul le cabinet du dossier retire un stock de clôture.');
  o := pg_temp.essayer(chef, format('select retirer_stock_de_cloture(%L, %L, 2)', dossier, stock), true);
  insert into essai_stocks values ('E29. le chef retire le stock : la ligne et ses écritures partent', 'ACCEPTÉ, 0 et 0',
    o || ' | ' || (select count(*) from stocks_de_cloture where id::text = stock) || ' et '
      || (select count(*) from ecritures_brouillon where stock_de_cloture_id::text = stock),
    o = 'ACCEPTÉ' and not exists (select 1 from stocks_de_cloture where id::text = stock)
      and not exists (select 1 from ecritures_brouillon where stock_de_cloture_id::text = stock));

  -- LES MUTATIONS, chacune annulée.
  -- M1 : la garde du brouillon débranchée — la ligne de stock écrite en direct passe.
  o := pg_temp.essayer(null, 'alter table ecritures_brouillon disable trigger ecritures_brouillon_stock; '
    || format('select set_config(%L, %L, true); insert into stocks_de_cloture (id, dossier_id, exercice, compte_stock, montant_centimes, methode, objet, cree_par, modifie_par) values (%L, %L, 2026, %L, 0, %L, %L, %L, %L); select set_config(%L, %L, true); ',
       'jd.stock', '0b7c4c55-0000-4000-8000-000000000002', '0b7c4c55-0000-4000-8000-000000000002', dossier, '370000', 'cmup', 'x', chef, chef, 'jd.stock', '')
    || format('set local role authenticated; select set_config(%L, %L, true); insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, stock_de_cloture_id) values (%L, %L, %L, %L, 1, %L, %L, %L)',
       'request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, dossier, '2026-12-31', '370000', 'x', 'debit', 'proposee', '0b7c4c55-0000-4000-8000-000000000002'));
  insert into essai_mutations values ('M1 — la garde des lignes de stock débranchée : la ligne écrite en direct passe', o, o = 'ACCEPTÉ');
  -- M2 : la garde de la table débranchée — le stock inséré en direct passe (E16 virerait au rouge).
  o := pg_temp.essayer(null, 'alter table stocks_de_cloture disable trigger stocks_de_cloture_par_ses_fonctions; '
    || format('set local role authenticated; select set_config(%L, %L, true); insert into stocks_de_cloture (dossier_id, exercice, compte_stock, montant_centimes, methode, objet, cree_par, modifie_par) values (%L, 2026, %L, 1, %L, %L, %L, %L)',
       'request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, dossier, '320000', 'cmup', 'x', chef, chef));
  insert into essai_mutations values ('M2 — la garde des stocks débranchée : le stock inséré en direct passe', o, o = 'ACCEPTÉ');
  -- M3 : la recomposition qui ignore le stock d'ouverture — la constatation seule passe (E6 virerait au rouge).
  def := pg_get_functiondef('public.enregistrer_stock_de_cloture(uuid, jsonb, jsonb, integer)'::regprocedure);
  o := pg_temp.essayer(null, replace(def, 'if v_ouverture > 0 then', 'if false then') || '; '
    || format('set local role authenticated; select set_config(%L, %L, true); select enregistrer_stock_de_cloture(%L, %L, %L, null)',
       'request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, dossier, saisie,
       '[{"compte":"370000","sens":"debit","centimes":1234500,"libelle":"Stock final"},{"compte":"603700","sens":"credit","centimes":1234500,"libelle":"Stock final"}]'));
  insert into essai_mutations values ('M3 — la recomposition sans le stock d''ouverture : la constatation seule passe', o, o like 'ACCEPTÉ%');
  -- M4 : le contrôle d'accès retiré — le client n'est plus refusé sous sa raison (E14 virerait au rouge).
  o := pg_temp.essayer(null, replace(def, 'not coalesce(public.admin_du_dossier(p_dossier_id), false)', 'false') || '; '
    || format('set local role authenticated; select set_config(%L, %L, true); select enregistrer_stock_de_cloture(%L, %L, %L, null)',
       'request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, dossier, saisie, bon));
  insert into essai_mutations values ('M4 — le contrôle d''accès retiré : le client écrit un stock', o, o like 'ACCEPTÉ%');
  -- M5 : la contrainte « sans autre source » retirée — la ligne qui cite un stock et une pièce passe (E22 virerait au rouge).
  o := pg_temp.essayer(null, 'alter table ecritures_brouillon drop constraint ecritures_brouillon_stock_sans_autre_source; '
    || 'alter table ecritures_brouillon disable trigger ecritures_brouillon_comptes_des_pieces; '
    || format('select set_config(%L, %L, true); insert into stocks_de_cloture (id, dossier_id, exercice, compte_stock, montant_centimes, methode, objet, cree_par, modifie_par) values (%L, %L, 2026, %L, 0, %L, %L, %L, %L); ',
       'jd.stock', '0b7c4c55-0000-4000-8000-000000000003', '0b7c4c55-0000-4000-8000-000000000003', dossier, '370000', 'cmup', 'x', chef, chef)
    || format('insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, stock_de_cloture_id, piece_id) values (%L, %L, %L, %L, 1, %L, %L, %L, (select id from pieces where dossier_id = %L limit 1))',
       dossier, '2026-12-31', '370000', 'x', 'debit', 'proposee', '0b7c4c55-0000-4000-8000-000000000003', dossier));
  insert into essai_mutations values ('M5 — la contrainte « sans autre source » retirée : une ligne cite un stock et une pièce', o,
    o = 'ACCEPTÉ' and exists (select 1 from pieces where dossier_id = dossier::uuid));
end
$essai$;

select 'CAS' as tableau, cas as ligne, case when ok then 'juste' else '*** EN FAUTE ***' end as verdict,
       'attendu ' || attendu || ' | observé ' || coalesce(observe, '?') as detail
  from essai_stocks
union all
select 'MUTATIONS', mutation, case when mord then 'mord' else '*** NE MORD PAS ***' end, observe from essai_mutations
union all
select 'BILAN', 'en faute / cas ; mutations qui mordent / mutations',
       (select count(*) filter (where not ok) || ' / ' || count(*) from essai_stocks) || ' ; '
         || (select count(*) filter (where mord) || ' / ' || count(*) from essai_mutations), ''
order by 1, 2;

rollback;
