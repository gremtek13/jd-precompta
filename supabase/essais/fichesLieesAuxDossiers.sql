-- LA FICHE DE FACTURATION D'UN CLIENT DU CABINET, LIÉE À SON DOSSIER (ligne 47, lot LM3 ; la migration
-- `fiche_liee_au_dossier_du_client`, en production depuis le 12/11/2026, supabase/schema/20261112140920_fiche_liee_au_dossier_du_client.sql,
-- après `dossier_du_cabinet` (LM1)). Le récit : HISTORIQUE.md, « 11/11/2026 — LM3 ».
-- SUR UNE RÉPLIQUE SEULEMENT : il désigne le dossier du cabinet de la réplique, crée un cabinet et retire un dossier. À
-- rejouer, par psql (`-f`, pas `-1` : le fichier ouvre et ANNULE sa propre transaction), sous le super-utilisateur, après
-- toute migration qui touche `contacts`, ses fonctions, la désignation du dossier du cabinet ou l'identité des dossiers.
--
-- Ce qui se prouve ici : qui lie (l'accès d'abord : ni l'anonyme, ni un compte rattaché à rien, ni le client d'un autre
-- dossier) ; les refus du rang 4 bis d'`enregistrer_contact`, dans leur ordre, à leurs mots et à leurs codes (le dossier du
-- cabinet seul, l'identifiant, un autre dossier du même cabinet, une seule fiche par dossier, retirées comprises, le lien
-- fixé à la création) ; une fiche liée sans identité, l'adresse de facturation électronique jugée sur le dossier ; la
-- lecture de l'identité, composée comme `facturer_honoraires` (LM7), au cabinet du dossier du cabinet seul — le membre
-- assigné au dossier du cabinet la lit sans le dossier du client (LM-Q2, LM3-Q2) ; le dossier parti ; l'effacement qui
-- délie ; la garde pour tout auteur (le lien qui ne change pas, le cabinet, le dossier du cabinet, la restauration du
-- super-administrateur) ; les contraintes ; la désignation retenue ; une fiche à la main, l'import, comme hier ; le
-- déliement (LM3-Q1 (B)) : au cabinet seul, ses refus dans leur ordre, à leurs mots et à leurs codes (introuvable,
-- retirée, pas liée, une autre version, le dossier parti, le nom, l'adresse, l'adresse électronique, le SIRET déjà rangé),
-- l'identité du dossier recopiée et ce qui est propre à la facturation gardé, la trace posée une fois, la fiche déliée
-- réécrite comme une fiche à la main, jamais reliée, la place du dossier libérée ; le catalogue.
--
-- Le jeu, inséré par le propriétaire : au cabinet de la réplique, le dossier du cabinet K, trois dossiers clients — C (un
-- SIRET, un nom imprimé, une adresse, un accès client), C2 (sans SIRET), C3 (sans SIRET ni adresse), C4 (un SIRET, un nom
-- imprimé entre des blancs, une adresse, pour le déliement) —, et X, d'un second cabinet. Le membre de
-- l'équipe de la réplique est affecté à K. Sans la migration, une ligne dit qu'il attend (EN ATTENTE). Une garde de tête
-- refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE), avant toute écriture.
begin;
create temp table essai_fl (rang int, controle text, attendu text, observe text, ok boolean) on commit drop;

-- Joue `requete` sous le profil `qui` (un `sub`, 'anon' ou null : le propriétaire sans session) ; rend 'OK:<valeur>' ou
-- '<sqlstate>:<message>'. Temporaire : rien ne reste.
create function pg_temp.essayer(qui text, requete text) returns text language plpgsql as $f$
declare
  v text;
begin
  begin
    if qui = 'anon' then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      execute 'set local role anon';
    elsif qui is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', qui, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
    execute requete into v;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return 'OK:' || coalesce(v, '∅');
  exception when others then
    return sqlstate || ':' || sqlerrm;
  end;
end
$f$;

create function pg_temp.noter(p_rang int, p_controle text, p_attendu text, p_observe text) returns void
language sql as $f$ insert into essai_fl values (p_rang, p_controle, p_attendu, p_observe, p_observe like p_attendu || '%') $f$;

create function pg_temp.id(r text) returns uuid language sql as $f$
  select case when r ~ '^OK:[0-9a-f-]{36}$' then substr(r, 4)::uuid end $f$;

-- L'appel d'`enregistrer_contact`, en texte, pour `essayer` ; rend l'identifiant du contact écrit.
create function pg_temp.enregistrer(d uuid, contact uuid, saisie jsonb) returns text language sql as $f$
  select format('select (enregistrer_contact(%L, %L, %L::jsonb)).id::text', d, contact, saisie) $f$;

-- L'appel de `delier_fiche_liee`, en texte, à la version que la fiche porte au moment de l'appel (lue par le propriétaire).
create function pg_temp.delier(d uuid, contact uuid) returns text language sql as $f$
  select format('select (delier_fiche_liee(%L, %L, %L)).id::text', d, contact, (select c.modifie_le from contacts c where c.id = contact)) $f$;

do $essai$
declare
  cabinet constant uuid := 'cab10000-0000-4000-8000-000000000001';
  cabinet2 constant uuid := 'cab20000-0000-4000-8000-00000000000f';
  k constant uuid := '1b300000-0000-4000-8000-0000000000a1';
  c constant uuid := '1b300000-0000-4000-8000-0000000000c1';
  c2 constant uuid := '1b300000-0000-4000-8000-0000000000c2';
  c3 constant uuid := '1b300000-0000-4000-8000-0000000000c3';
  c4 constant uuid := '1b300000-0000-4000-8000-0000000000c4';
  x constant uuid := '1b300000-0000-4000-8000-0000000000e1';
  super constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  inconnu constant text := gen_random_uuid()::text;
  r text;
  n int;
  f1 uuid; f2 uuid; f2b uuid; u uuid; f3 uuid; f4 uuid; h uuid;
  v record;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai désigne le dossier du cabinet, crée un cabinet et retire un dossier ; il ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'contacts' and column_name = 'dossier_client_id') then
    insert into essai_fl values (0, 'FL. la fiche liée au dossier du client : EN ATTENTE de la migration fiche_liee_au_dossier_du_client', 'la migration', 'absente', true);
    return;
  end if;

  insert into cabinets (id, nom) values (cabinet2, 'ESSAI LM3 SECOND CABINET');
  insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse, statut_tva, denomination_imprimee) values
    (k, 'ESSAI LM3 CABINET', cabinet, 'tresorerie', '455000', '12345678200010', 'ESSAI LM3 ADRESSE DU CABINET', 'redevable', null),
    (c, 'ESSAI LM3 CLIENT', cabinet, 'tresorerie', '455000', '98765432100017', 'ESSAI LM3 ADRESSE DU CLIENT', null, 'ESSAI LM3 CLIENT SARL'),
    (c2, 'ESSAI LM3 SANS SIRET', cabinet, 'tresorerie', '455000', null, 'ESSAI LM3 AILLEURS', null, null),
    (c3, 'ESSAI LM3 TROISIÈME', cabinet, 'tresorerie', '455000', null, null, null, null),
    (c4, 'ESSAI LM3 QUATRIÈME', cabinet, 'tresorerie', '455000', '73282932000017', 'ESSAI LM3 RUE QUATRE', null, '  ESSAI LM3 QUATRE SAS  '),
    (x, 'ESSAI LM3 AUTRE CABINET', cabinet2, 'tresorerie', '455000', null, null, null, null);
  insert into memberships (user_id, dossier_id, role, email) values (client::uuid, c, 'client', 'essai-lm3@example.test');
  r := pg_temp.essayer(super, format($q$select designer_dossier_du_cabinet(%L, %L)$q$, cabinet, k));
  perform pg_temp.noter(1, 'le chef désigne le dossier du cabinet (LM1)', 'OK:' || k, r);

  -- L'accès, d'abord.
  r := pg_temp.essayer('anon', pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c)));
  perform pg_temp.noter(2, 'l''anonyme ne lie pas', '42501:', r);
  r := pg_temp.essayer(inconnu, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c)));
  perform pg_temp.noter(3, 'un compte rattaché à rien ne lie pas', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer(client, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c)));
  perform pg_temp.noter(4, 'le client de C ne lie rien dans le dossier du cabinet', '42501:Accès refusé à ce dossier.', r);

  -- Le rang 4 bis, dans son ordre.
  r := pg_temp.essayer(super, pg_temp.enregistrer(c3, null, jsonb_build_object('dossier_client_id', c)));
  perform pg_temp.noter(5, 'hors du dossier du cabinet, une fiche ne se lie pas', '22023:Une fiche ne se lie au dossier d''un client que dans le dossier du cabinet.', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, '{"dossier_client_id": "pas un identifiant"}'));
  perform pg_temp.noter(6, 'un identifiant illisible', '22023:Le dossier du client se désigne par son identifiant.', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, '{"dossier_client_id": 12}'));
  perform pg_temp.noter(7, 'un nombre n''est pas un identifiant', '22023:Le dossier du client se désigne par son identifiant.', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', k)));
  perform pg_temp.noter(8, 'le dossier du cabinet n''est pas son propre client', '22023:Le client est un dossier de ce cabinet, autre que le dossier du cabinet.', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', x)));
  perform pg_temp.noter(9, 'un dossier d''un autre cabinet ne se lie pas, sous les mêmes mots', '22023:Le client est un dossier de ce cabinet, autre que le dossier du cabinet.', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', gen_random_uuid())));
  perform pg_temp.noter(10, 'un dossier inconnu non plus, sous les mêmes mots', '22023:Le client est un dossier de ce cabinet, autre que le dossier du cabinet.', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c, 'nom', 'Recopié à la main')));
  perform pg_temp.noter(11, 'une fiche liée refuse un nom', '22023:Une fiche liée au dossier d''un client ne porte ni nom, ni adresse, ni type, ni SIREN, ni SIRET, ni code service : ils se lisent de son dossier.', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c, 'siret', '98765432100017')));
  perform pg_temp.noter(12, 'une fiche liée refuse un SIRET', '22023:Une fiche liée au dossier d''un client ne porte ni nom', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c2, 'adresse_electronique', '987654321')));
  perform pg_temp.noter(13, 'un dossier sans SIRET n''a pas d''adresse de facturation électronique', '22023:Une adresse de facturation électronique ne se donne qu''à une entreprise établie en France ou à un organisme public.', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c, 'adresse_electronique', '123456789')));
  perform pg_temp.noter(14, 'l''adresse électronique commence par le SIREN du dossier', '22023:L''adresse de facturation électronique du contact ne commence pas par son SIREN.', r);

  -- La fiche liée de C, puis celle de C2.
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c, 'adresse_electronique', '987654321',
         'email', 'compta@client.example', 'delai_paiement_jours', 30, 'observations', 'Prélèvement le 5')));
  f1 := pg_temp.id(r);
  select * into v from contacts where id = f1;
  perform pg_temp.noter(15, 'le chef lie la fiche de C : aucune identité, ce qui est propre à la facturation', 'OK',
    case when f1 is not null and v.nom is null and v.type_client is null and v.adresse is null and v.siren is null and v.siret is null
              and v.dossier_client_id = c and v.adresse_electronique = '987654321' and v.email = 'compta@client.example'
              and v.delai_paiement_jours = 30 and v.cree_par = super::uuid then 'OK' else r end);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c)));
  perform pg_temp.noter(16, 'un dossier n''a qu''une fiche', '23505:Ce dossier a déjà sa fiche de facturation.', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c2, 'delai_paiement_jours', 45)));
  f2 := pg_temp.id(r);
  perform pg_temp.noter(17, 'la fiche de C2, sans adresse électronique', 'OK:' || coalesce(f2::text, '?'), r);

  -- Le lien, posé à la création, ne change plus.
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, f1, jsonb_build_object('dossier_client_id', c, 'adresse_electronique', '987654321', 'delai_paiement_jours', 15)));
  perform pg_temp.noter(18, 'la fiche se réécrit en entier, son lien redit', 'OK:' || f1 || ' en entier', r || case when (select delai_paiement_jours from contacts where id = f1) = 15
    and (select email from contacts where id = f1) is null then ' en entier' else ' pas en entier' end);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, f1, '{"nom": "Délier", "adresse": "Ici", "type_client": "assujetti"}'));
  perform pg_temp.noter(19, 'une fiche liée ne se délie pas par enregistrer_contact (sa fonction recopie l''identité)', '22023:Le lien d''une fiche au dossier de son client se pose à sa création et ne change plus : une autre fiche se crée.', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, f1, jsonb_build_object('dossier_client_id', c3)));
  perform pg_temp.noter(20, 'une fiche liée ne change pas de dossier', '22023:Le lien d''une fiche au dossier de son client se pose à sa création', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, '{"nom": "À LA MAIN", "adresse": "Rue", "type_client": "assujetti"}'));
  u := pg_temp.id(r);
  perform pg_temp.noter(21, 'une fiche à la main, dans le dossier du cabinet, comme hier', 'OK:' || coalesce(u::text, '?'), r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, u, jsonb_build_object('dossier_client_id', c3)));
  perform pg_temp.noter(22, 'une fiche à la main ne se lie pas après coup', '22023:Le lien d''une fiche au dossier de son client se pose à sa création', r);

  -- Retirée, la fiche tient sa place ; reprise, elle revient.
  r := pg_temp.essayer(super, format('select (retirer_contact(%L, %L)).id::text', k, f1));
  perform pg_temp.noter(23, 'la fiche de C se retire', 'OK:' || f1, r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c)));
  perform pg_temp.noter(24, 'retirée, elle tient encore la place de C', '23505:Ce dossier a déjà sa fiche de facturation (retirée : la reprendre).', r);
  r := pg_temp.essayer(super, format('select (reprendre_contact(%L, %L)).id::text', k, f1));
  perform pg_temp.noter(25, 'elle se reprend', 'OK:' || f1, r);

  -- La lecture de l'identité.
  r := pg_temp.essayer(super, format($q$select string_agg(concat_ws('|', contact_id = %L, dossier_present, tiers_nom, tiers_adresse, tiers_siret, tiers_siren, type_client), ' ; ' order by contact_id = %L desc) from identites_des_fiches_liees(%L)$q$, f1, f1, k));
  perform pg_temp.noter(26, 'le chef lit l''identité que chaque dossier donne, composée comme LM7', 'OK:t|t|ESSAI LM3 CLIENT SARL|ESSAI LM3 ADRESSE DU CLIENT|98765432100017|987654321|assujetti ; f|t|ESSAI LM3 SANS SIRET|ESSAI LM3 AILLEURS|non_assujetti', r);
  r := pg_temp.essayer(client, format('select count(*)::text from identites_des_fiches_liees(%L)', k));
  perform pg_temp.noter(27, 'le client de C ne la lit pas', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer('anon', format('select count(*)::text from identites_des_fiches_liees(%L)', k));
  perform pg_temp.noter(28, 'l''anonyme ne la lit pas', '42501:', r);
  r := pg_temp.essayer(membre, format('select count(*)::text from identites_des_fiches_liees(%L)', k));
  perform pg_temp.noter(29, 'un membre que le dossier du cabinet n''a pas ne la lit pas', '42501:Accès refusé à ce dossier.', r);
  insert into dossier_assignations (dossier_id, user_id) values (k, membre::uuid);
  r := pg_temp.essayer(membre, format('select count(*)::text from identites_des_fiches_liees(%L)', k));
  perform pg_temp.noter(30, 'le membre assigné au dossier du cabinet la lit, sans le dossier du client (LM-Q2)', 'OK:2 sans C', r
    || case when (select count(*) from dossier_assignations where dossier_id = c and user_id = membre::uuid) = 0 then ' sans C' else ' assigné à C' end);
  r := pg_temp.essayer(super, format('select count(*)::text from identites_des_fiches_liees(%L)', c3));
  perform pg_temp.noter(31, 'hors du dossier du cabinet, rien ne se lit', '22023:Les fiches liées au dossier d''un client vivent dans le dossier du cabinet.', r);

  -- La garde, pour tout auteur.
  r := pg_temp.essayer(null, format('update contacts set dossier_client_id = %L where id = %L returning 1', c3, f1));
  perform pg_temp.noter(32, 'le propriétaire ne change pas un lien', '23514:Le lien d''une fiche au dossier de son client se pose à sa création', r);
  r := pg_temp.essayer(null, format('update contacts set dossier_client_id = null where id = %L returning 1', f1));
  perform pg_temp.noter(33, 'ni ne le vide hors de l''effacement et du déliement', '23514:Le lien d''une fiche au dossier de son client se pose à sa création', r);
  r := pg_temp.essayer(null, format($q$insert into contacts (dossier_id, dossier_client_id) values (%L, %L) returning 1$q$, c3, c2));
  perform pg_temp.noter(34, 'hors du dossier du cabinet, l''insertion directe est refusée', '23514:Une fiche ne se lie au dossier d''un client que dans le dossier du cabinet.', r);
  r := pg_temp.essayer(null, format($q$insert into contacts (dossier_id, dossier_client_id) values (%L, %L) returning 1$q$, k, x));
  perform pg_temp.noter(35, 'un dossier d''un autre cabinet, refusé par la garde', '23514:Le client est un dossier de ce cabinet, autre que le dossier du cabinet.', r);
  r := pg_temp.essayer(super, format($q$insert into contacts (dossier_id, dossier_client_id, cree_par) values (%L, %L, %L) returning 1$q$, c3, gen_random_uuid(), super));
  perform pg_temp.noter(36, 'la restauration du super-administrateur passe un dossier non désigné et un client parti', 'OK:1', r);
  r := pg_temp.essayer(null, format($q$insert into contacts (dossier_id, dossier_client_id, nom) values (%L, %L, 'Copie') returning 1$q$, k, c3));
  perform pg_temp.noter(37, 'une fiche liée sans identité (la contrainte)', '23514:new row for relation "contacts" violates check constraint "contacts_fiche_liee_sans_identite"', r);
  r := pg_temp.essayer(null, format($q$insert into contacts (dossier_id, type_client, adresse) values (%L, 'assujetti', 'Rue') returning 1$q$, k));
  perform pg_temp.noter(38, 'une fiche à la main a un nom (la contrainte)', '23514:new row for relation "contacts" violates check constraint "contacts_nom_present"', r);
  r := pg_temp.essayer(null, format($q$insert into contacts (dossier_id, dossier_client_id) values (%L, %L) returning 1$q$, k, c));
  perform pg_temp.noter(39, 'une seule fiche par dossier (la contrainte totale)', '23505:duplicate key value violates unique constraint "contacts_une_fiche_par_dossier_client"', r);

  -- La désignation retenue.
  r := pg_temp.essayer(super, format($q$select designer_dossier_du_cabinet(%L, %L)$q$, cabinet, c3));
  perform pg_temp.noter(40, 'le dossier du cabinet qui porte des fiches liées garde sa désignation', '23514:Le dossier du cabinet porte des fiches liées aux dossiers de ses clients : sa désignation ne change plus.', r);

  -- L'effacement délie : la place se libère.
  r := pg_temp.essayer(super, format('select (effacer_contact(%L, %L)).id::text', k, f2));
  select * into v from contacts where id = f2;
  perform pg_temp.noter(41, 'effacée, la fiche de C2 perd son lien', 'OK:' || f2 || ' délié', r || case when v.dossier_client_id is null and v.nom like 'Contact effacé le %' then ' délié' else ' lié' end);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c2)));
  f2b := pg_temp.id(r);
  perform pg_temp.noter(42, 'C2 reçoit une nouvelle fiche', 'OK:' || coalesce(f2b::text, '?'), r);

  -- Le dossier du client parti.
  r := pg_temp.essayer(null, format('delete from memberships where dossier_id = %L returning 1', c));
  r := pg_temp.essayer(null, format('delete from dossiers where id = %L returning 1', c));
  perform pg_temp.noter(43, 'le dossier C part', 'OK:1', r);
  r := pg_temp.essayer(super, format($q$select concat_ws('|', dossier_present, coalesce(tiers_nom, '∅'), coalesce(type_client, '∅')) from identites_des_fiches_liees(%L) where contact_id = %L$q$, k, f1));
  perform pg_temp.noter(44, 'la lecture dit le dossier parti, l''identité nulle', 'OK:f|∅|∅', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, f1, jsonb_build_object('dossier_client_id', c)));
  perform pg_temp.noter(45, 'sa fiche ne se modifie plus', '22023:Le client est un dossier de ce cabinet, autre que le dossier du cabinet.', r);
  r := pg_temp.essayer(super, format('select (effacer_contact(%L, %L)).id::text', k, f1));
  perform pg_temp.noter(46, 'elle s''efface', 'OK:' || f1, r);
  -- Un dossier passé à un autre cabinet ne donne plus d'identité au premier.
  update dossiers set cabinet_id = cabinet2 where id = c2;
  r := pg_temp.essayer(super, format($q$select concat_ws('|', dossier_present, coalesce(tiers_nom, '∅')) from identites_des_fiches_liees(%L) where contact_id = %L$q$, k, f2b));
  perform pg_temp.noter(52, 'un dossier passé à un autre cabinet se dit parti', 'OK:f|∅', r);

  -- Le déliement (LM3-Q1 (B)) : la fiche de C4 et celle de C3, liées.
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c4, 'adresse_electronique', '732829320',
         'email', 'compta@quatre.example', 'delai_paiement_jours', 30, 'observations', 'Virement')));
  f4 := pg_temp.id(r);
  perform pg_temp.noter(53, 'la fiche de C4, liée', 'OK:' || coalesce(f4::text, '?'), r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c3)));
  f3 := pg_temp.id(r);
  perform pg_temp.noter(53, 'la fiche de C3, liée', 'OK:' || coalesce(f3::text, '?'), r);
  r := pg_temp.essayer('anon', pg_temp.delier(k, f4));
  perform pg_temp.noter(54, 'l''anonyme ne délie pas', '42501:', r);
  r := pg_temp.essayer(inconnu, pg_temp.delier(k, f4));
  perform pg_temp.noter(55, 'un compte rattaché à rien ne délie pas', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer(super, pg_temp.delier(k, gen_random_uuid()));
  perform pg_temp.noter(56, 'une fiche introuvable dans le dossier', 'P0002:Contact introuvable dans ce dossier.', r);
  perform pg_temp.essayer(super, format('select (retirer_contact(%L, %L)).id::text', k, f4));
  r := pg_temp.essayer(super, pg_temp.delier(k, f4));
  perform pg_temp.noter(57, 'retirée, elle se reprend avant', '22023:Ce contact est retiré : le reprendre avant de le modifier.', r);
  perform pg_temp.essayer(super, format('select (reprendre_contact(%L, %L)).id::text', k, f4));
  r := pg_temp.essayer(super, pg_temp.delier(k, u));
  perform pg_temp.noter(58, 'une fiche à la main ne se délie pas', '22023:Cette fiche n''est pas liée au dossier d''un client : rien ne se délie.', r);
  r := pg_temp.essayer(super, format('select (delier_fiche_liee(%L, %L, null)).id::text', k, f4));
  perform pg_temp.noter(59, 'lue à une autre version, elle se relit', '22023:La fiche a changé depuis sa lecture : relire avant de la délier.', r);
  r := pg_temp.essayer(super, pg_temp.delier(k, f2b));
  perform pg_temp.noter(60, 'son dossier parti du cabinet, rien ne se recopie', '22023:Le dossier de ce client n''est plus dans ce cabinet : rien ne se recopie. La fiche se retire ou s''efface.', r);
  update dossiers set nom = repeat('N', 201) where id = c3;
  r := pg_temp.essayer(super, pg_temp.delier(k, f3));
  perform pg_temp.noter(61, 'un nom de plus de deux cents caractères', '22023:Le nom que donne le dossier de ce client est vide ou dépasse deux cents caractères', r);
  update dossiers set nom = 'ESSAI LM3 TROISIÈME' where id = c3;
  r := pg_temp.essayer(super, pg_temp.delier(k, f3));
  perform pg_temp.noter(62, 'un dossier sans adresse', '22023:Le dossier de ce client n''a pas d''adresse', r);
  update dossiers set siret = '44306184100013' where id = c4;
  r := pg_temp.essayer(super, pg_temp.delier(k, f4));
  perform pg_temp.noter(63, 'l''adresse électronique de la fiche, qui ne commence plus par le SIREN du dossier', '22023:L''adresse de facturation électronique de la fiche ne va plus avec l''identité du dossier', r);
  update dossiers set siret = '73282932000017' where id = c4;
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, '{"nom": "À LA MAIN QUATRE", "adresse": "Rue", "type_client": "assujetti", "siren": "732829320", "siret": "73282932000017"}'));
  h := pg_temp.id(r);
  r := pg_temp.essayer(super, pg_temp.delier(k, f4));
  perform pg_temp.noter(64, 'le SIRET du dossier, déjà rangé dans le dossier du cabinet', '23505:Le SIRET « 73282932000017 » est déjà celui du contact « À LA MAIN QUATRE » : un établissement ne se range qu''une fois par dossier.', r);
  perform pg_temp.essayer(super, format('select (effacer_contact(%L, %L)).id::text', k, h));
  r := pg_temp.essayer(membre, pg_temp.delier(k, f4));
  select * into v from contacts where id = f4;
  perform pg_temp.noter(65, 'le membre assigné au dossier du cabinet délie : l''identité du dossier recopiée, le reste gardé, la trace posée', 'OK:' || f4 || ' copie juste',
    r || case when v.dossier_client_id is null and v.nom = 'ESSAI LM3 QUATRE SAS' and v.adresse = 'ESSAI LM3 RUE QUATRE'
                   and v.type_client = 'assujetti' and v.siren = '732829320' and v.siret = '73282932000017'
                   and v.adresse_electronique = '732829320' and v.email = 'compta@quatre.example' and v.delai_paiement_jours = 30
                   and v.observations = 'Virement' and v.delie_le is not null and v.delie_par = membre::uuid
                   and v.modifie_par = membre::uuid and v.code_service is null then ' copie juste' else ' copie fausse' end);
  r := pg_temp.essayer(super, format('select count(*)::text from identites_des_fiches_liees(%L) where contact_id = %L', k, f4));
  perform pg_temp.noter(66, 'déliée, elle sort de la lecture des identités', 'OK:0', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, f4, '{"nom": "ESSAI LM3 QUATRE SAS", "adresse": "ESSAI LM3 RUE QUATRE", "type_client": "assujetti", "siren": "732829320", "siret": "73282932000017", "adresse_electronique": "732829320", "delai_paiement_jours": 15}'));
  perform pg_temp.noter(67, 'elle se réécrit comme une fiche à la main', 'OK:' || f4, r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, f4, jsonb_build_object('dossier_client_id', c4)));
  perform pg_temp.noter(68, 'elle ne se relie pas', '22023:Le lien d''une fiche au dossier de son client se pose à sa création', r);
  r := pg_temp.essayer(super, pg_temp.delier(k, f4));
  perform pg_temp.noter(69, 'ni ne se délie deux fois', '22023:Cette fiche n''est pas liée au dossier d''un client : rien ne se délie.', r);
  r := pg_temp.essayer(super, pg_temp.enregistrer(k, null, jsonb_build_object('dossier_client_id', c4)));
  perform pg_temp.noter(70, 'le dossier qu''elle a quitté reçoit une nouvelle fiche liée', 'OK:', r);
  r := pg_temp.essayer(null, format('update contacts set delie_le = null, delie_par = null where id = %L returning 1', f4));
  perform pg_temp.noter(71, 'la garde : la trace ne se réécrit pas, même par le propriétaire', '23514:La trace du déliement d''une fiche ne se réécrit pas.', r);
  r := pg_temp.essayer(null, format('update contacts set delie_le = now(), delie_par = %L where id = %L returning 1', super, u));
  perform pg_temp.noter(72, 'ni ne se pose hors du déliement', '23514:La trace du déliement d''une fiche ne se réécrit pas.', r);
  r := pg_temp.essayer(null, format($q$insert into contacts (dossier_id, nom, type_client, adresse, delie_le) values (%L, 'X', 'assujetti', 'Rue', now()) returning 1$q$, k));
  perform pg_temp.noter(73, 'une trace entière (la contrainte)', '23514:new row for relation "contacts" violates check constraint "contacts_deliement_entier"', r);
  r := pg_temp.essayer(null, format($q$insert into contacts (dossier_id, dossier_client_id, delie_le, delie_par) values (%L, %L, now(), %L) returning 1$q$, k, c3, super));
  perform pg_temp.noter(73, 'une fiche liée ne porte pas de trace (la contrainte)', '23514:new row for relation "contacts" violates check constraint "contacts_delie_sans_lien"', r);

  -- Sans la clé, comme hier ; l'import ne lie jamais.
  r := pg_temp.essayer(super, pg_temp.enregistrer(c3, null, '{"adresse": "Rue", "type_client": "assujetti"}'));
  perform pg_temp.noter(47, 'sans la clé, les refus d''hier', '22023:Le nom du contact est à renseigner.', r);
  r := pg_temp.essayer(super, format($q$select array_length(importer_contacts(%L, %L::jsonb), 1)::text$q$, k, jsonb_build_array(jsonb_build_object('dossier_client_id', c3))));
  perform pg_temp.noter(48, 'un import ne lie pas', '22023:Ligne 1 : « dossier_client_id » n''est pas un champ d''un contact.', r);

  -- Le catalogue.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname = 'identites_des_fiches_liees'
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  perform pg_temp.noter(49, 'la lecture : security definer, authenticated seul', '1', n::text);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('garder_fiche_liee', 'garder_designation_des_fiches_liees')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  perform pg_temp.noter(50, 'les deux gardes : aucun rôle de session ne les exécute', '0', n::text);
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'contacts';
  perform pg_temp.noter(51, 'les policies des contacts, inchangées (deux lectures, la restauration)', '3', n::text);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname = 'delier_fiche_liee'
     and p.proconfig = array['search_path=public']
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  perform pg_temp.noter(74, 'le déliement : security definer, search_path, authenticated seul', '1', n::text);
end
$essai$;

select case when ok then 'OK  ' else 'FAUX' end || ' ' || lpad(rang::text, 2) || '. ' || controle
       || case when ok then '' else ' — attendu « ' || attendu || ' », observé « ' || observe || ' »' end as ligne
  from essai_fl order by rang, controle;
select count(*) filter (where not ok) || ' en faute / ' || count(*) || ' étapes' as bilan from essai_fl;
rollback;
