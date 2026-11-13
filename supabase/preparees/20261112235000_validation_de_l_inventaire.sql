-- INV3 : LA VALIDATION CONNAÎT L'INVENTAIRE (ligne 35) — PRÉPARÉE le 12/11/2026, PAS APPLIQUÉE. PAR L'OUTIL
-- (`apply_migration`) : aucune instruction ne retire une table, une colonne, une contrainte, une fonction ni une ligne ; le
-- mot du retrait n'y paraît que dans `on delete cascade`, l'évènement d'un déclencheur et `tg_op = 'DELETE'`, les formes que
-- `categories_du_dossier` et `modele_de_plan_du_cabinet` ont passées par l'outil. Aucune barre oblique inverse, aucun retour
-- chariot. Une table, deux déclencheurs et neuf fonctions s'ajoutent ; trois fonctions se remplacent par `create or replace`
-- (leur OID, leur propriétaire et leurs droits gardés) : `valider_exercice`, `empreinte_exercice_forme_2` et `fichier_fige`.
--
-- ELLE DÉPEND D'INV2 (`operations_d_inventaire`), qui doit être en base avant elle : sa garde de tête l'exige, aux empreintes
-- des fonctions d'INV2 sur lesquelles la validation compte. Elle s'accommode d'INV4 (`provisions`), de LIA2, d'AFF2, d'EXD2 et
-- de MCB5g, présentes ou non, avant ou après elle : elle n'ajoute aucune colonne au brouillon, et ne lit les provisions que
-- lorsque leur table est en base. `valider_exercice` reste `security definer` (le filet de l'ouverture éclatée de MCB5g
-- l'exige) et pose son réglage après son verrou exclusif (les gardes allégées du 12/11/2026 l'exigent).
--
-- La conception : docs/conceptions/35-inventaire.md, § 3.5, § 4.5, § 5.3 et § 6 (le lot INV3), INV-Q1, Q7, Q9 et Q11 à leur
-- recommandation (A) — Q1, Q7 et Q9 tranchées par le cabinet le 12/11/2026, Q11 à la recommandation —, puis INV3-Q1 (A) et
-- INV3-Q2 (A), tranchées le 13/11/2026. Le module que la base redit : src/lib/inventaireDeLaValidation.ts, ses mots, ses codes
-- et leur ordre ; src/lib/inventaireDeLaValidation.test.ts les confronte au texte de cette migration. Le récit : HISTORIQUE.md,
-- « 12/11/2026 — INV3 : LA VALIDATION CONNAÎT L'INVENTAIRE (PRÉPARÉE, PAS APPLIQUÉE) » et « 13/11/2026 — INV3-Q1 ET INV3-Q2 :
-- L'EMPREINTE SCELLE L'INVENTAIRE, LA RÉGULARISATION REPRISE (PRÉPARÉES, PAS APPLIQUÉES) ». Son retour :
-- supabase/preparees/retour/20261112235100_retour_validation_de_l_inventaire.sql.
-- Son essai : supabase/essais/validationDeLInventaire.sql (une réplique seulement, une transaction) ; puis rls.sql (le bloc
-- ID) et validationExercice.sql, qui la reconnaît.
--
-- SOURCES. Code de commerce, art. L123-12 (« Toute personne physique ou morale ayant la qualité de commerçant doit procéder
-- à l'enregistrement comptable des mouvements affectant le patrimoine de son entreprise […] Elle doit contrôler par inventaire,
-- au moins une fois tous les douze mois, l'existence et la valeur des éléments actifs et passifs du patrimoine de
-- l'entreprise »). PCG (règlement ANC n° 2014-03 modifié, numérotation du 1er janvier 2026) : art. 1214-40, 1214-41 et
-- 1214-48 (les factures non parvenues et à établir, les charges et produits constatés d'avance, contre-passés à l'ouverture
-- de l'exercice suivant) ; art. 1211-15 (le réajustement des provisions) ; art. 1032-2 (une pièce justificative datée) ;
-- art. 1031-3 (la procédure de validation qui interdit toute modification). Légifrance et l'ANC.
--
-- CE QU'ELLE POSE :
--   1. `inventaires_declares` (INV-Q9 (A)) : la déclaration, par le cabinet du dossier (`admin_du_dossier`), que l'inventaire
--      d'un exercice est fait, même sans régularisation ; une déclaration EN VIGUEUR par dossier et par exercice (un index
--      unique partiel, qu'aucun upsert ne vise : la restauration réinsère par la clé primaire). Elle se RETIRE tant que son
--      exercice n'est pas validé — sa ligne garde alors qui l'a retirée et quand, jamais effacée : la trace de ce que la
--      validation a lu. Écrite par `declarer_inventaire` et `retirer_declaration_inventaire` seules ; lue par le cabinet du
--      dossier, jamais par un client ; la porte de la restauration au super-administrateur, en insertion.
--   2. Deux juges, privés, que la validation appelle : `inventaire_a_jour` (les lignes d'une régularisation sont celles
--      qu'elle commande) et `inventaire_extourne_entiere` (l'extourne au 1er janvier est la constatation validée, en sens
--      inverse).
--   3. `valider_exercice`, au caractère près celle de la production (`empreinte_des_exercices_forme_2`, md5 923cfa1b…),
--      plus trois variables et un bloc, placé après TOUS les refus d'hier et avant le réglage de la validation : la
--      numérotation des écritures d'inventaire (le journal OD, la pièce « Inventaire AAAA » du 31 décembre, une écriture par
--      régularisation et par date : la sorte `inventaire` de src/lib/fec.ts), l'inventaire déclaré, les régularisations de
--      l'exercice à jour, l'extourne entière de celles de l'exercice précédent, la ventilation des provisions reprises.
--      Un dossier en trésorerie valide comme hier, au caractère près ; un dossier en engagement aussi, sa déclaration faite.
--   4. Si la double authentification exigée (`deux_facteurs_exiges`) est déjà en base, la policy restrictive `deux_facteurs`
--      sur la table neuve.
--   5. LES RÉGULARISATIONS REPRISES D'UNE BALANCE (INV3-Q2 (A), tranchée par le cabinet le 13/11/2026 ; leur saisie est
--      celle d'INV2, `reprise`) : la validation du premier exercice — celui que la balance reprise ouvre au 1er janvier —
--      exige chacune à jour (son extourne seule, recomposée), à sa place (la balance ouvre toujours cet exercice au 1er
--      janvier), puis la CONFRONTE au solde repris : au 1er janvier, les extournes des régularisations reprises soldent
--      exactement chaque compte de régularisation de la balance — 486, 487, 408 (hors du 4084, que l'inventaire ne range pas :
--      INV1-Q1), 418, et la TVA d'attente 44586 et 44587 qui suit les factures non parvenues et à établir.
--   6. L'EMPREINTE EN FORME 2 ÉTENDUE (INV3-Q1 (A), tranchée par le cabinet le 13/11/2026), sans forme nouvelle : elle scelle
--      AUSSI les régularisations de l'exercice — celles qu'il constate au 31 décembre, ses évaluations de provision (la
--      provision évaluée avec elles, INV4), et les régularisations reprises dont il porte l'extourne — et les pièces qu'elles
--      citent, directement ou par leur provision (`regularisations_scellees`, `pieces_scellees_par_l_inventaire`). Un exercice
--      sans régularisation garde son texte d'hier OCTET POUR OCTET (un bloc de plus, présent seulement quand il y en a ; un
--      ensemble de pièces inchangé) : tout exercice validé avant elle — un BNC en trésorerie n'en a jamais — se vérifie comme
--      hier, ce que sa garde de fin rejoue sur toute la base.
--   7. Le fichier d'une pièce que l'inventaire d'un exercice validé scelle ne change plus : ni son chemin, ni son empreinte de
--      dépôt, ni sa version lisible (`garder_fichier_scelle_par_l_inventaire`), et le stockage ne le retire plus
--      (`fichier_fige`, comme INAL1 le fait pour une pièce qu'une écriture validée cite). Le reste de la pièce se traite comme
--      toute pièce : la facture de janvier qu'une facture non parvenue cite se valide et s'écrit dans l'exercice suivant.
--
-- CE QU'ELLE NE FAIT PAS : la déclaration de l'inventaire n'entre pas dans l'empreinte (elle est figée avec l'exercice, par sa
-- garde) ; les charges à payer et les produits à recevoir d'une balance reprise (4282, 4286, 4382, 4386, 44812, 1688, 518,
-- 4482, 439) n'ont pas de régularisation reprise (INV3Q2-Q1, posée au cabinet). L'écran (INV5) non plus : aucun dossier
-- n'est en engagement en production (12/11/2026), rien ne s'y déclare avant lui.

do $garde$
declare
  v_f text;
begin
  if to_regclass('public.inventaires_declares') is not null
     or to_regprocedure('public.declarer_inventaire(uuid, integer)') is not null
     or to_regprocedure('public.inventaire_a_jour(uuid)') is not null
     or to_regprocedure('public.regularisations_scellees(uuid, integer)') is not null
     or to_regprocedure('public.pieces_scellees_par_l_inventaire(uuid, integer)') is not null
     or to_regprocedure('public.exercice_scellant_la_piece_citee(uuid)') is not null
     or to_regprocedure('public.garder_fichier_scelle_par_l_inventaire()') is not null
     or exists (select 1 from pg_trigger t where t.tgrelid = 'public.pieces'::regclass and t.tgname = 'pieces_fichier_scelle_par_l_inventaire') then
    raise exception 'La migration validation_de_l_inventaire est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.operations_inventaire') is null
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
                      and a.attname = 'operation_inventaire_id' and not a.attisdropped)
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.operations_inventaire'::regclass
                      and a.attname = 'reprise' and not a.attisdropped) then
    raise exception 'La migration validation_de_l_inventaire dépend de operations_d_inventaire (INV2), qui n''est pas en base : coller INV2 d''abord.';
  end if;
  if to_regclass('public.a_nouveaux') is null or to_regclass('public.exercices_valides') is null then
    raise exception 'validation_de_l_inventaire : une table dont elle dépend manque : relire la base.';
  end if;
  -- Les fonctions qu'elle remplace, telles que la production les porte : `valider_exercice` et `empreinte_exercice_forme_2`
  -- depuis `empreinte_des_exercices_forme_2`, `fichier_fige` depuis `piece_figee_dans_le_stockage` ; celles qu'elle appelle ;
  -- celles d'INV2, telles que sa migration préparée les pose, dont la validation suppose la conduite (une ligne d'inventaire
  -- n'est écrite que par sa régularisation, au 31 décembre ou au 1er janvier suivant, au 1er janvier seul pour une reprise ;
  -- une régularisation d'un exercice figé ne change plus). À l'empreinte de leur corps, les retours chariot d'un collage écartés.
  for v_f in select x.f from (values
      ('valider_exercice(uuid, integer, jsonb, jsonb, jsonb)', '923cfa1b57037146070ca1430f163495'),
      ('empreinte_exercice_forme_2(uuid, integer, text, timestamp with time zone, uuid, text, integer, integer, numeric, numeric, jsonb)',
       'a62b0761a132e53c218bdc5b3820299e'),
      ('verifier_exercice_valide(uuid, integer)', '1478bda759c33e3912da7e0089ca9994'),
      ('fichier_fige(text)', '5372f8d248432f0932598a6efca24ca2'),
      ('exercice_figeant_la_piece(uuid)', '78624664a1794b06816acb2e70436802'),
      ('admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('cle_validation(uuid)', 'bcbb03363036aa6aa037c0b829e3382f'),
      ('frontiere_validation(uuid)', '24a04846471ec5e8cdbae6f3b9f4a2e8'),
      ('retour_declencheur(text, anyelement, anyelement)', 'bc80cac6efe46d15f86d1820eb56c47e'),
      ('garder_operations_inventaire()', '7c27098f1e1d57539aed192ec28bcb31'),
      ('garder_ecriture_d_inventaire()', 'c7791b98f0840428f26bafb31efd4590'),
      ('enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer)', '13dd1361e5470e35f9e7bc06dacd83af'),
      ('retirer_operation_inventaire(uuid, integer)', '9588e1104ce918565702d6db5ec137db')) as x(f, empreinte)
    where (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p where p.oid = to_regprocedure('public.' || x.f))
          is distinct from x.empreinte
  loop
    raise exception 'La fonction % n''est plus celle que cette migration suppose : relire la migration contre la base avant de l''appliquer.', v_f;
  end loop;
  -- INV4, si elle est déjà en base : la provision précédente, que la recomposition d'une évaluation relit.
  if to_regclass('public.provisions') is not null
     and (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p
           where p.oid = to_regprocedure('public.provision_cible_precedente(uuid, integer)')) is distinct from '8f8196584f78828900f31fa1e72355de' then
    raise exception 'La fonction provision_cible_precedente(uuid, integer) n''est plus celle que cette migration suppose : relire la migration contre la base avant de l''appliquer.';
  end if;
  -- Une seule `valider_exercice`, `security definer` ; son réglage posé nulle part ailleurs ; le réglage de la déclaration
  -- libre.
  if (select count(*) from pg_proc p where p.proname = 'valider_exercice') <> 1
     or not (select p.prosecdef from pg_proc p where p.oid = 'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure) then
    raise exception 'valider_exercice n''est plus celle que cette migration suppose (une seule, security definer) : relire la migration.';
  end if;
  if exists (select 1 from pg_proc p where strpos(p.prosrc, 'set_config(''jd.validation_exercice''') > 0 and p.proname <> 'valider_exercice')
     or exists (select 1 from pg_proc p where strpos(p.prosrc, 'jd.inventaire_declare') > 0) then
    raise exception 'validation_de_l_inventaire : un réglage qu''elle suppose réservé est posé ailleurs : relire la migration.';
  end if;
  -- INV3-Q1 (A) : rien ne change pour l'existant. Les exercices validés qui se vérifient avant elle, relevés ici sous
  -- l'empreinte d'hier ; sa garde de fin exige les mêmes, sous l'empreinte étendue (transaction locale).
  perform set_config('jd.inventaire_exercices_verifies', (
    select coalesce(string_agg(ev.dossier_id::text || ':' || ev.annee, ',' order by ev.dossier_id, ev.annee), '')
      from public.exercices_valides ev where public.verifier_exercice_valide(ev.dossier_id, ev.annee)), true);
end
$garde$;

-- ══ 1. L'inventaire déclaré (INV-Q9 (A)) ══
create table public.inventaires_declares (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  exercice integer not null,
  declare_par uuid not null,
  declare_le timestamptz not null default now(),
  retire_par uuid,
  retire_le timestamptz,
  constraint inventaires_declares_exercice check (exercice >= 2000 and exercice <= 2100),
  constraint inventaires_declares_retrait check (
    (retire_le is null) = (retire_par is null) and (retire_le is null or retire_le >= declare_le))
);
-- Une déclaration en vigueur par dossier et par exercice : la fonction l'assure sous son verrou, cet index le garantit pour
-- tout chemin (la restauration comprise). Aucun upsert ne le vise : la restauration réinsère par la clé primaire.
create unique index inventaires_declares_une_en_vigueur on public.inventaires_declares (dossier_id, exercice)
  where retire_le is null;
alter table public.inventaires_declares enable row level security;
comment on table public.inventaires_declares is
  'INV3 (ligne 35, INV-Q9 (A)) : la déclaration, par le cabinet du dossier, que l''inventaire d''un exercice d''un dossier en engagement est fait, même sans régularisation ; la validation de l''exercice l''attend. Une en vigueur par exercice ; retirée tant que l''exercice n''est pas validé, sa ligne garde qui l''a retirée et quand. Écrite par declarer_inventaire et retirer_declaration_inventaire seules.';

-- Le cabinet du dossier lit ; aucun client, aucun droit d'accès (l'inventaire est un travail du cabinet). Aucune policy
-- d'écriture : les deux fonctions seules. La restauration réinsère par la porte du super-administrateur, que la garde ouvre.
create policy inventaires_declares_lecture on public.inventaires_declares
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy inventaires_declares_restauration on public.inventaires_declares
  for insert to authenticated with check (public.is_super_admin());

-- La garde : écrite par ses deux fonctions seules (le réglage local `jd.inventaire_declare`, qu'elles posent sur leur
-- dossier) ou réinsérée par le super-administrateur (la restauration, qui réinsère les exercices validés en dernier) ; une
-- ligne ne change que pour être retirée, une fois ; elle ne s'efface qu'avec son dossier ; celle d'un exercice figé ne
-- s'écrit ni ne se retire plus.
create function public.garder_inventaires_declares() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_derniere integer;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return old;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Une déclaration d’inventaire ne s’efface pas : elle se retire, et sa trace reste.' using errcode = '42501';
  end if;
  if coalesce(current_setting('jd.inventaire_declare', true), '') is distinct from new.dossier_id::text
     and not (tg_op = 'INSERT' and public.is_super_admin()) then
    raise exception 'Une déclaration d’inventaire ne s’écrit que par declarer_inventaire et retirer_declaration_inventaire.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (old.retire_le is not null or new.retire_le is null
       or (to_jsonb(new) - array['retire_le', 'retire_par']) is distinct from (to_jsonb(old) - array['retire_le', 'retire_par'])) then
    raise exception 'Une déclaration d’inventaire ne change pas : elle se retire, une fois.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_derniere := extract(year from public.frontiere_validation(new.dossier_id))::integer;
  if new.exercice <= v_derniere then
    raise exception 'Cet exercice est validé : son inventaire ne change plus.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger inventaires_declares_garde before insert or update or delete on public.inventaires_declares
  for each row execute function public.garder_inventaires_declares();
revoke execute on function public.garder_inventaires_declares() from public, anon, authenticated;

-- ══ 2. Déclarer l'inventaire d'un exercice, retirer une déclaration ══
-- Les refus, dans cet ordre (src/lib/inventaireDeLaValidation.ts, `MOTS_DE_LA_DECLARATION`) : l'accès, avant toute lecture ;
-- le mode du dossier ; l'exercice, lisible, pas figé, clos (l'année lue à Paris : l'inventaire se fait à la clôture, et
-- l'exercice se valide une fois clos), pas avant l'ouverture du dossier ; une déclaration déjà en vigueur. Rend son
-- identifiant.
create function public.declarer_inventaire(p_dossier_id uuid, p_exercice integer)
 returns uuid
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_mode text;
  v_frontiere date;
  v_premier integer;
  v_id uuid;
begin
  if p_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  select d.mode_comptable into v_mode from public.dossiers d where d.id = p_dossier_id;
  if not found then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if v_mode is distinct from 'engagement' then
    raise exception '%', 'L’inventaire ne s’écrit qu’en comptabilité d’engagement : un dossier en trésorerie (BNC, 2035) n’en reçoit aucun.'
      using errcode = '22023';
  end if;
  if p_exercice is null or p_exercice < 2000 or p_exercice > 2100 then
    raise exception '%', 'L’exercice de l’inventaire est illisible : une année entre 2000 et 2100.' using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and p_exercice <= extract(year from v_frontiere) then
    raise exception '%', 'Cet exercice est validé : son inventaire ne change plus.' using errcode = '23514';
  end if;
  if p_exercice >= extract(year from (now() at time zone 'Europe/Paris')) then
    raise exception '%', 'Cet exercice n’est pas clos : son inventaire se déclare après son 31 décembre.' using errcode = '22023';
  end if;
  select extract(year from min(a.date))::integer into v_premier from public.a_nouveaux a where a.dossier_id = p_dossier_id;
  if v_premier is not null and p_exercice < v_premier then
    raise exception '%', 'Cet exercice précède l’ouverture du dossier dans l’application : son inventaire n’y a pas de place.'
      using errcode = '22023';
  end if;
  -- Les déclarations du dossier, l'une après l'autre : la seconde lit la première.
  perform pg_advisory_xact_lock(hashtextextended('inventaires_declares|' || p_dossier_id::text, 0));
  if exists (select 1 from public.inventaires_declares d
              where d.dossier_id = p_dossier_id and d.exercice = p_exercice and d.retire_le is null) then
    raise exception '%', 'L’inventaire de cet exercice est déjà déclaré : relire l’inventaire.' using errcode = '40001';
  end if;
  perform set_config('jd.inventaire_declare', p_dossier_id::text, true);
  insert into public.inventaires_declares (dossier_id, exercice, declare_par)
  values (p_dossier_id, p_exercice, auth.uid())
  returning id into v_id;
  perform set_config('jd.inventaire_declare', '', true);
  return v_id;
end
$fonction$;
revoke execute on function public.declarer_inventaire(uuid, integer) from public, anon;
grant execute on function public.declarer_inventaire(uuid, integer) to authenticated;
comment on function public.declarer_inventaire(uuid, integer) is
  'INV3 (ligne 35, INV-Q9 (A)) : déclare fait l''inventaire d''un exercice clos d''un dossier en engagement, même sans régularisation ; la validation de l''exercice l''attend. Le cabinet du dossier.';

-- Les refus : l'accès, avant toute lecture du reste ; la déclaration déjà retirée (lue par une autre saisie) ; le gel. Le mode
-- du dossier ne se juge pas : retirer ne fait que rendre la validation plus exigeante.
create function public.retirer_declaration_inventaire(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_dossier_id uuid;
  v_declaration public.inventaires_declares%rowtype;
  v_frontiere date;
begin
  select d.dossier_id into v_dossier_id from public.inventaires_declares d where d.id = p_id;
  if p_id is null or v_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(v_dossier_id), false) then
    raise exception 'Accès refusé à cette déclaration.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('inventaires_declares|' || v_dossier_id::text, 0));
  select * into v_declaration from public.inventaires_declares d where d.id = p_id for update;
  if v_declaration.retire_le is not null then
    raise exception '%', 'Cette déclaration a changé depuis sa lecture : relire l’inventaire.' using errcode = '40001';
  end if;
  v_frontiere := public.frontiere_validation(v_dossier_id);
  if v_frontiere is not null and v_declaration.exercice <= extract(year from v_frontiere) then
    raise exception '%', 'Cet exercice est validé : son inventaire ne change plus.' using errcode = '23514';
  end if;
  perform set_config('jd.inventaire_declare', v_dossier_id::text, true);
  update public.inventaires_declares d set retire_le = now(), retire_par = auth.uid() where d.id = p_id;
  perform set_config('jd.inventaire_declare', '', true);
end
$fonction$;
revoke execute on function public.retirer_declaration_inventaire(uuid) from public, anon;
grant execute on function public.retirer_declaration_inventaire(uuid) to authenticated;
comment on function public.retirer_declaration_inventaire(uuid) is
  'INV3 (ligne 35) : retire la déclaration d''inventaire en vigueur d''un exercice qui n''est pas validé ; sa ligne garde qui l''a retirée et quand. Le cabinet du dossier.';

-- ══ 3. Deux juges, privés, que la validation appelle ══
-- Une régularisation À JOUR : ses lignes sont celles qu'elle commande, en MULTIENSEMBLE (date, compte, sens, centimes) — au
-- 31 décembre de son exercice, ses comptes et son montant, la TVA d'attente d'une facture non parvenue ou à établir sous sa
-- racine (44586, 44587 : le compte du rôle à l'écriture, que le plan a pu déplacer depuis sans que la régularisation mente) ;
-- au 1er janvier suivant, les mêmes en sens inverse ; une évaluation de provision (INV4), l'écart entre sa cible et la
-- provision précédente lue en base (`provision_cible_precedente`), au 31 décembre seulement, aucune ligne sans écart ; une
-- régularisation reprise d'une balance (INV3-Q2 (A)), son extourne seule, au 1er janvier : sa constatation est dans la
-- balance. La recomposition d'INV2 et d'INV4, en entiers, sur les colonnes que la régularisation garde. Un `record` : la
-- colonne `provision_id` d'INV4 ne se lit que sur une évaluation, qui n'existe qu'avec elle.
create function public.inventaire_a_jour(p_id uuid) returns boolean
language plpgsql stable set search_path = public as $$
declare
  o record;
  v_ecart bigint;
  v_racine text;
  v_lignes jsonb;
  v_conforme boolean;
begin
  select * into o from public.operations_inventaire where id = p_id;
  if not found then
    return false;
  end if;
  if o.nature = 'provision' then
    v_ecart := o.montant_centimes - public.provision_cible_precedente(o.provision_id, o.exercice);
    v_lignes := case when v_ecart > 0 then jsonb_build_array(jsonb_build_array(o.compte_resultat, 'debit', v_ecart),
                                                            jsonb_build_array(o.compte_regularisation, 'credit', v_ecart))
                     when v_ecart < 0 then jsonb_build_array(jsonb_build_array(o.compte_regularisation, 'debit', -v_ecart),
                                                            jsonb_build_array(o.compte_resultat, 'credit', -v_ecart))
                     else '[]'::jsonb end;
  else
    v_racine := case o.nature when 'fnp' then '44586' when 'fae' then '44587' end;
    v_lignes := case o.nature
      when 'cca' then jsonb_build_array(jsonb_build_array(o.compte_regularisation, 'debit', o.montant_centimes),
                                        jsonb_build_array(o.compte_resultat, 'credit', o.montant_centimes))
      when 'pca' then jsonb_build_array(jsonb_build_array(o.compte_resultat, 'debit', o.montant_centimes),
                                        jsonb_build_array(o.compte_regularisation, 'credit', o.montant_centimes))
      when 'charge_a_payer' then jsonb_build_array(jsonb_build_array(o.compte_resultat, 'debit', o.montant_centimes),
                                                   jsonb_build_array(o.compte_regularisation, 'credit', o.montant_centimes))
      when 'produit_a_recevoir' then jsonb_build_array(jsonb_build_array(o.compte_regularisation, 'debit', o.montant_centimes),
                                                       jsonb_build_array(o.compte_resultat, 'credit', o.montant_centimes))
      when 'fnp' then jsonb_build_array(jsonb_build_array(o.compte_resultat, 'debit', o.montant_centimes),
                                        jsonb_build_array(v_racine, 'debit', o.tva_centimes),
                                        jsonb_build_array(o.compte_regularisation, 'credit', o.montant_centimes + o.tva_centimes))
      when 'fae' then jsonb_build_array(jsonb_build_array(o.compte_regularisation, 'debit', o.montant_centimes + o.tva_centimes),
                                        jsonb_build_array(o.compte_resultat, 'credit', o.montant_centimes),
                                        jsonb_build_array(v_racine, 'credit', o.tva_centimes))
      else null end;
    if v_lignes is null then
      return false;
    end if;
  end if;
  with attendues as (
    select to_char(make_date(o.exercice, 12, 31), 'YYYY-MM-DD') as jour, a.v ->> 0 as compte, a.v ->> 1 as sens,
           (a.v ->> 2)::bigint as centimes
      from jsonb_array_elements(v_lignes) a(v) where (a.v ->> 2)::bigint > 0 and not o.reprise
    union all
    select to_char(make_date(o.exercice + 1, 1, 1), 'YYYY-MM-DD'), a.v ->> 0,
           case a.v ->> 1 when 'debit' then 'credit' else 'debit' end, (a.v ->> 2)::bigint
      from jsonb_array_elements(v_lignes) a(v) where (a.v ->> 2)::bigint > 0 and o.nature <> 'provision'
  ), recues as (
    select to_char(e.date, 'YYYY-MM-DD') as jour,
           case when v_racine is not null and starts_with(e.compte, v_racine) then v_racine else e.compte end as compte,
           e.sens, round(e.montant * 100)::bigint as centimes
      from public.ecritures_brouillon e where e.operation_inventaire_id = p_id
  )
  select (select count(*) from attendues) = (select count(*) from recues)
     and not exists (select jour, compte, sens, centimes from attendues except all select jour, compte, sens, centimes from recues)
    into v_conforme;
  return coalesce(v_conforme, false);
end;
$$;

-- L'EXTOURNE ENTIÈRE d'une régularisation : ses lignes du 1er janvier suivant son exercice sont celles de sa constatation au
-- 31 décembre, ligne pour ligne, en sens inverse (compte, sens, centimes, en multiensemble) ; une évaluation de provision n'en
-- a aucune. La constatation est celle que la validation de son exercice a figée : la règle ne relit ni le plan ni la
-- régularisation, que rien ne réécrit plus.
create function public.inventaire_extourne_entiere(p_id uuid) returns boolean
language plpgsql stable set search_path = public as $$
declare
  o record;
  v_conforme boolean;
begin
  select * into o from public.operations_inventaire where id = p_id;
  if not found then
    return false;
  end if;
  with attendues as (
    select e.compte, case e.sens when 'debit' then 'credit' else 'debit' end as sens, round(e.montant * 100)::bigint as centimes
      from public.ecritures_brouillon e
     where e.operation_inventaire_id = p_id and e.date = make_date(o.exercice, 12, 31) and o.nature <> 'provision'
  ), recues as (
    select e.compte, e.sens, round(e.montant * 100)::bigint as centimes
      from public.ecritures_brouillon e
     where e.operation_inventaire_id = p_id and e.date = make_date(o.exercice + 1, 1, 1)
  )
  select (select count(*) from attendues) = (select count(*) from recues)
     and not exists (select compte, sens, centimes from attendues except all select compte, sens, centimes from recues)
    into v_conforme;
  return coalesce(v_conforme, false);
end;
$$;
revoke execute on function public.inventaire_a_jour(uuid) from public, anon, authenticated;
revoke execute on function public.inventaire_extourne_entiere(uuid) from public, anon, authenticated;

-- ══ 4. La validation, qui connaît l'inventaire ══
-- La définition de la production (`empreinte_des_exercices_forme_2`), au caractère près hors de trois variables déclarées
-- (après `v_auteur`) et du bloc de l'inventaire (avant le réglage de la validation).
create or replace function public.valider_exercice(
  p_dossier_id uuid,
  p_annee integer,
  p_lignes jsonb,
  p_a_nouveaux jsonb,
  p_declaration jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet uuid;
  v_mode text;
  v_debut date;
  v_fin date;
  v_ouverture date;
  v_anterieur integer;
  v_attendues integer;
  v_recues integer;
  v_distinctes integer;
  v_jointes integer;
  v_an_attendus integer;
  v_an_recus integer;
  v_an_distincts integer;
  v_an_joints integer;
  v_a_traiter integer;
  v_derniere integer;
  v_defaut text;
  v_maintenant timestamptz := now();
  v_precedente text;
  v_empreinte text;
  v_debit numeric;
  v_credit numeric;
  v_ecritures integer;
  v_lignes integer;
  v_hors text;
  v_ecart numeric;
  v_reportes integer;
  v_bascule boolean;
  v_mouvement record;
  v_numero text;
  v_encaissement record;
  v_vente record;
  v_champs text;
  v_paiement record;
  v_auteur uuid;
  v_inventaire_mal_numerote boolean;
  v_regularisation record;
  v_compte_repris text;
begin
  select cabinet_id, mode_comptable into v_cabinet, v_mode from public.dossiers where id = p_dossier_id;
  if not found or not public.est_chef_du_cabinet(v_cabinet) then
    raise exception 'Seul le chef du cabinet valide un exercice.' using errcode = '42501';
  end if;
  if p_annee is null or p_annee < 2000 or p_annee > 2100 then
    raise exception 'Exercice invalide.' using errcode = '22023';
  end if;
  -- Exclusif : aucune écriture ni aucune source ne change pendant la validation (voir `cle_validation`).
  perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));
  v_debut := make_date(p_annee, 1, 1);
  v_fin := make_date(p_annee, 12, 31);
  -- L'année se lit à Paris, comme dans l'application : la nuit du 1er janvier ne doit pas les faire diverger.
  if p_annee >= extract(year from (now() at time zone 'Europe/Paris'))::integer then
    raise exception 'L''exercice % n''est pas terminé : il se valide une fois clos.', p_annee using errcode = '22023';
  end if;
  if exists (select 1 from public.exercices_valides where dossier_id = p_dossier_id and annee >= p_annee) then
    raise exception 'L''exercice % est déjà validé, ou un exercice postérieur l''est.', p_annee using errcode = '23514';
  end if;
  -- Après le premier, chaque exercice suit le précédent : un exercice sauté serait figé par la frontière sans
  -- qu'aucune validation ne l'ait regardé.
  select max(annee) into v_derniere from public.exercices_valides where dossier_id = p_dossier_id;
  if v_derniere is not null and p_annee <> v_derniere + 1 then
    raise exception 'L''exercice % n''est pas validé : les exercices se valident dans l''ordre.', v_derniere + 1
      using errcode = '23514';
  end if;
  select min(date) into v_ouverture from public.a_nouveaux where dossier_id = p_dossier_id;
  if v_ouverture is not null and v_fin < v_ouverture then
    raise exception 'L''exercice % précède l''ouverture du dossier : il est dans les comptes repris.', p_annee
      using errcode = '22023';
  end if;
  -- Les à-nouveaux ouvrent le premier exercice du dossier, qui se valide avant tout autre : sans quoi la frontière
  -- les figerait sans qu'aucun exercice validé ne les porte.
  if v_ouverture is not null and v_ouverture < v_debut and not exists (
    select 1 from public.exercices_valides
     where dossier_id = p_dossier_id and annee = extract(year from v_ouverture)::integer
  ) then
    raise exception 'L''exercice % porte les à-nouveaux du dossier : il se valide d''abord.',
      extract(year from v_ouverture)::integer using errcode = '23514';
  end if;
  select min(extract(year from date))::integer into v_anterieur
    from public.ecritures_brouillon where dossier_id = p_dossier_id and date < v_debut and statut = 'proposee';
  if v_anterieur is not null then
    -- Leur exercice ne se validera jamais : il précède l'ouverture, et les comptes repris portent cette période.
    if v_ouverture is not null and v_anterieur < extract(year from v_ouverture)::integer then
      raise exception 'Des écritures antérieures à l''ouverture du dossier ne sont pas validées : cette période est dans les comptes repris, les retirer ou les redater avant la validation.'
        using errcode = '23514';
    end if;
    raise exception 'L''exercice % porte des écritures qui ne sont pas validées : les exercices se valident dans l''ordre.',
      v_anterieur using errcode = '23514';
  end if;
  -- LES VENTES FACTURÉES D'UN DOSSIER BASCULÉ (étape VF7b ; conception de VF7, § 3 c) : trois manques de G5 retiennent la
  -- validation, sous leur nom, avant la numérotation — un mouvement réservé, un virement ou un prélèvement sans son
  -- mouvement, une vente facturée qui n'est pas écrite à jour. Un dossier qui n'a pas basculé n'en porte aucun.
  v_bascule := coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = p_dossier_id), false);
  -- Un mouvement RÉSERVÉ (G2), daté jusqu'au 31 décembre : libre, et justifié par l'encaissement vivant d'une facture
  -- source. Il est à traiter : dit avant les mouvements à traiter, il l'est sous son nom, car il ne se classe que par ses
  -- encaissements — un débit, par ses contre-passations. La facture est celle que la garde des mouvements nomme.
  if v_bascule then
    select l.id, l.date, l.montant into v_mouvement
      from public.lignes_bancaires l
     where l.dossier_id = p_dossier_id and l.date <= v_fin and public.mouvement_libre(l)
       and exists (select 1 from public.encaissements_factures e
                     join public.factures_emises f on f.id = e.facture_id
                    where e.ligne_bancaire_id = l.id and e.retire_le is null and f.source_de_la_vente
                      and public.encaissement_justifie_son_mouvement(e.id))
     order by l.date, l.id
     limit 1;
    if found then
      select f.numero into v_numero
        from public.encaissements_factures e
        join public.factures_emises f on f.id = e.facture_id
       where e.ligne_bancaire_id = v_mouvement.id and e.retire_le is null and f.source_de_la_vente
         and public.encaissement_justifie_son_mouvement(e.id)
       order by e.cree_le, e.id
       limit 1;
      if v_mouvement.montant >= 0 then
        raise exception 'L''exercice % porte un mouvement du % réservé à l''encaissement de la facture % : le classer par ses encaissements avant la validation.',
          extract(year from v_mouvement.date)::integer, to_char(v_mouvement.date, 'DD/MM/YYYY'), v_numero using errcode = '23514';
      end if;
      raise exception 'L''exercice % porte un mouvement du % réservé à la contre-passation d''un encaissement de la facture % : le classer par ses contre-passations avant la validation.',
        extract(year from v_mouvement.date)::integer, to_char(v_mouvement.date, 'DD/MM/YYYY'), v_numero using errcode = '23514';
    end if;
  end if;
  -- Un mouvement daté d'un exercice validé ne change plus (migration `sources_figees_par_la_validation`) : encore
  -- à traiter, il le resterait.
  select min(extract(year from date))::integer into v_a_traiter
    from public.lignes_bancaires where dossier_id = p_dossier_id and date <= v_fin and statut = 'non_rapprochee';
  if v_a_traiter is not null then
    if v_ouverture is not null and v_a_traiter < extract(year from v_ouverture)::integer then
      raise exception 'Des mouvements bancaires antérieurs à l''ouverture du dossier restent à traiter : les ignorer avant la validation.'
        using errcode = '23514';
    end if;
    raise exception 'L''exercice % porte des mouvements bancaires à traiter : ils se traitent avant la validation.', v_a_traiter
      using errcode = '23514';
  end if;
  if v_bascule then
    -- Un encaissement vivant d'une facture source — ni retiré, ni contre-passation, ni défait par une contre-passation
    -- sans mouvement —, par virement ou par prélèvement, daté jusqu'au 31 décembre, qui ne cite aucun mouvement : encaissé
    -- à l'inscription au crédit, son mouvement est de son exercice ; il manque au relevé, ou n'y est pas rattaché. Un
    -- chèque, une carte ou un effet sans mouvement au 31 décembre est un en-cours (le 511, EC3-Q7) : il ne retient pas.
    select e.date_encaissement, e.moyen, f.numero into v_encaissement
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
     where e.dossier_id = p_dossier_id and f.source_de_la_vente and e.retire_le is null and e.annule_id is null
       and e.ligne_bancaire_id is null and e.moyen in ('virement', 'prelevement') and e.date_encaissement <= v_fin
       and public.encaissement_justifie_son_mouvement(e.id)
     order by e.date_encaissement, e.cree_le, e.id
     limit 1;
    if found then
      raise exception 'L''exercice % porte un encaissement de la facture % par % du %, sans son mouvement : il manque au relevé, ou n''y est pas rattaché — le rattacher avant la validation.',
        extract(year from v_encaissement.date_encaissement)::integer, v_encaissement.numero,
        case v_encaissement.moyen when 'virement' then 'virement' else 'prélèvement' end,
        to_char(v_encaissement.date_encaissement, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    -- Une source dont ce qui s'écrit entre la frontière et le 31 décembre n'est pas EXACTEMENT ce que le brouillon
    -- propose, ou qui ne s'écrit pas quand sa date tombe dans cette période : la première, dans l'ordre de
    -- `ventes_facturees_de_l_exercice` — la période part de la frontière, et un premier exercice validé ne fige pas un
    -- manque d'avant lui.
    select v.* into v_vente from public.ventes_facturees_de_l_exercice(p_dossier_id, p_annee) v limit 1;
    if found then
      if v_vente.etat = 'a_ecrire' then
        raise exception 'L''exercice % porte une vente facturée qui n''est pas écrite : % — l''écrire avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      if v_vente.etat = 'a_reecrire' then
        raise exception 'L''exercice % porte une vente facturée dont l''écriture proposée n''est plus celle que sa source commande : % — la réécrire avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      if v_vente.etat = 'a_retirer' then
        raise exception 'L''exercice % porte l''écriture proposée d''une vente facturée qui n''a plus rien à écrire : % — la retirer avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      raise exception 'L''exercice % porte une vente facturée qui ne s''écrit pas : % — lever ce qui la retient avant la validation.',
        extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
    end if;
  end if;
  if (v_mode = 'tresorerie') <> (jsonb_typeof(p_declaration) is not distinct from 'object') then
    raise exception '%', case when v_mode = 'tresorerie' then 'La 2035 à valider manque.'
      else 'Un dossier tenu en engagement n''a pas de 2035.' end using errcode = '22023';
  end if;
  if jsonb_typeof(p_lignes) is distinct from 'array' then
    raise exception 'La numérotation proposée est illisible.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_a_nouveaux) is distinct from 'array' then
    raise exception 'Les libellés proposés des à-nouveaux sont illisibles.' using errcode = '22023';
  end if;

  with l as (
    select * from jsonb_to_recordset(p_lignes) as x(id uuid, journal text, numero integer, piece_ref text,
      piece_date date, compte_lib text, comp_aux_num text, comp_aux_lib text)
  ), e as (
    select id, date, compte, montant, sens from public.ecritures_brouillon
    where dossier_id = p_dossier_id and date between v_debut and v_fin
  ), j as (
    select l.*, e.date, e.compte, e.montant, e.sens from l join e on e.id = l.id
  ), groupes as (
    select journal, numero, min(date) as premiere,
      sum(case when sens = 'debit' then montant else -montant end) as solde,
      count(distinct piece_ref) as refs, count(distinct piece_date) as dates, count(distinct date) as jours
    from j group by journal, numero
  ), journaux as (
    select journal, min(numero) as premier, max(numero) as dernier, count(*) as nb from groupes group by journal
  ), an_l as (
    select * from jsonb_to_recordset(p_a_nouveaux) as x(id uuid, compte_lib text, ecriture_lib text)
  ), an_e as (
    -- L'ouverture de l'exercice : la balance reprise, ou les soldes reportés de l'exercice validé qui le précède.
    select id, compte from public.a_nouveaux where dossier_id = p_dossier_id and date between v_debut and v_fin
    union all
    select id, compte from public.soldes_reportes where dossier_id = p_dossier_id and date = v_debut
  ), an_j as (
    select an_l.*, an_e.compte from an_l join an_e on an_e.id = an_l.id
  )
  select
    (select count(*) from e), (select count(*) from l), (select count(distinct id) from l), (select count(*) from j),
    (select count(*) from an_e), (select count(*) from an_l), (select count(distinct id) from an_l),
    (select count(*) from an_j),
    case
      when exists (select 1 from l where journal is null or journal not in ('AC', 'VE', 'BQ', 'OD')
          or numero is null or numero < 1 or coalesce(btrim(piece_ref), '') = '' or piece_date is null
          or coalesce(btrim(compte_lib), '') = '' or (comp_aux_num is null) <> (comp_aux_lib is null)
          or (comp_aux_num is not null and (btrim(comp_aux_num) = '' or btrim(comp_aux_lib) = '')))
        then 'Une ligne de la numérotation proposée est incomplète.'
      when exists (select 1 from an_l where coalesce(btrim(compte_lib), '') = '' or coalesce(btrim(ecriture_lib), '') = '')
        then 'Un à-nouveau proposé est incomplet.'
      when exists (select 1 from journaux where premier <> 1 or dernier <> nb)
        then 'Les numéros d''un journal ne se suivent pas.'
      when exists (select 1 from (
          select premiere, lag(premiere) over (partition by journal order by numero) as avant from groupes) z
          where avant > premiere)
        then 'Les numéros d''un journal ne suivent pas l''ordre des dates.'
      when exists (select 1 from groupes where solde <> 0)
        then 'Une écriture n''est pas équilibrée au centime.'
      when exists (select 1 from groupes where refs <> 1 or dates <> 1)
        then 'Les lignes d''une même écriture ne portent pas la même pièce.'
      when exists (select 1 from groupes where jours <> 1)
        then 'Les lignes d''une même écriture ne portent pas la même date.'
      when exists (select 1 from (select compte, compte_lib from j union all select compte, compte_lib from an_j) c
          group by compte having count(distinct compte_lib) > 1)
        then 'Un même compte porte deux libellés.'
      when exists (select 1 from j where comp_aux_num is not null group by comp_aux_num having count(distinct comp_aux_lib) > 1)
        then 'Un même compte auxiliaire porte deux libellés.'
    end
  into v_attendues, v_recues, v_distinctes, v_jointes, v_an_attendus, v_an_recus, v_an_distincts, v_an_joints, v_defaut;

  if v_recues <> v_distinctes or v_recues <> v_attendues or v_jointes <> v_recues then
    raise exception 'La numérotation proposée ne couvre pas exactement les % écritures de l''exercice %.', v_attendues, p_annee
      using errcode = '22023';
  end if;
  if v_an_recus <> v_an_distincts or v_an_recus <> v_an_attendus or v_an_joints <> v_an_recus then
    raise exception 'Les libellés proposés ne couvrent pas exactement les % à-nouveaux de l''exercice %.', v_an_attendus, p_annee
      using errcode = '22023';
  end if;
  if v_defaut is not null then
    raise exception '%', v_defaut using errcode = '22023';
  end if;

  -- LES QUATRE CHAMPS DU FEC D'UN BNC EN TRÉSORERIE (ligne 26.6, étape e ; lot FEC22b ; MVP-D5 ; LPF, art. A47 A-1,
  -- VIII, 7°) : la date de règlement, le mode de règlement, la nature de l'opération et l'identification du client,
  -- figés avec chaque ligne comme sa pièce et son numéro, et le poste de la 2035 d'une ligne de charge ou de produit,
  -- avec lequel NatOp se recompose (FEC22-Q3, (C)). L'application les tire de la source de chaque écriture
  -- (src/lib/champsBncDuFec.ts) ; la base vérifie ce qu'elle peut vérifier sans les refaire. Une demande qui ne les
  -- porte pas valide comme hier : ils restent nuls. Dans l'ordre, après les refus d'hier :
  --   - chaque valeur dans sa forme : une date du calendrier, au plus aujourd'hui à Paris ; un mode et une nature de
  --     leur liste fermée ; un poste de la sienne (`POSTES_RATTACHES`, src/lib/cases2035.ts), avec une nature, sur une
  --     ligne de produit (classe 7) pour un poste que la 2035 range sous une recette, de charge (classe 6) pour un
  --     poste qu'elle range sous une dépense, les débours et les honoraires rétrocédés compris — ce que `posteRattache`
  --     rend (`cadreCompatible`) ;
  --   - la date, le mode, la nature et le client les mêmes sur toutes les lignes d'une écriture ; le poste suit la
  --     ligne ;
  --   - LA GARDE DU SECRET (BOI-BNC-DECLA-10-20, § 280 ; CGI, art. 99 ; FEC22-Q4, (D)) : un client ne s'identifie que
  --     par le numéro d'une facture ou d'un avoir VALIDÉ du dossier, ou par le SIREN que porte son client figé — les
  --     neuf premiers chiffres de son `tiers_siret` quand il n'est fait que de neuf ou de quatorze chiffres et passe
  --     ses clés, comme `identificationDuClient` le lit. Aucun chemin n'y fait entrer un nom.
  -- « Sans règlement » est un mode de la liste : la base ne choisit pas entre lui et des champs vides (FEC22-Q1, (C) ;
  -- FEC22-E2). src/lib/champsBncFiges.ts redit ces refus, dans cet ordre.
  with l as (
    select x.*, e.compte,
           -- La date d'un texte AAAA-MM-JJ, sans lever : un jour hors de son mois en rend une autre, que la relecture
           -- voit.
           case when x.date_reglement !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then null
                else make_date(substr(x.date_reglement, 1, 4)::integer, substr(x.date_reglement, 6, 2)::integer, 1)
                     + (substr(x.date_reglement, 9, 2)::integer - 1) end as jour
      from jsonb_to_recordset(p_lignes) as x(id uuid, journal text, numero integer, date_reglement text,
             mode_reglement text, nature_operation text, poste_rattache text, identification_client text)
      join public.ecritures_brouillon e on e.id = x.id and e.dossier_id = p_dossier_id
  ), ecritures as (
    -- Une valeur est la même sur toutes les lignes d'une écriture quand elle y est partout, une seule, ou nulle
    -- partout.
    select count(distinct date_reglement) > 1 or count(date_reglement) not in (0, count(*)) as dates,
           count(distinct mode_reglement) > 1 or count(mode_reglement) not in (0, count(*)) as modes,
           count(distinct nature_operation) > 1 or count(nature_operation) not in (0, count(*)) as natures,
           count(distinct identification_client) > 1 or count(identification_client) not in (0, count(*)) as clients
      from l group by journal, numero
  ), modes(mode) as (
    -- Les modes de règlement (`MODES_REGLEMENT`, src/lib/champsBncDuFec.ts).
    values
      ('Banque'), ('Espèces'), ('Compte personnel'), ('Virement'), ('Chèque'), ('Carte bancaire'), ('Prélèvement'),
      ('Effet'), ('Compensation'), ('Autre'), ('Sans règlement')
  ), natures(nature) as (
    -- Les natures de l'opération (`NATURES_OPERATION`, src/lib/champsBncDuFec.ts).
    values
      ('Recette'), ('Dépense'), ('Recette et dépense'), ('Acquisition d''immobilisation'), ('Apport de l''exploitant'),
      ('Prélèvement de l''exploitant'), ('Échéance d''emprunt'), ('Déblocage d''emprunt'), ('Cotisation sociale'),
      ('Opération de bilan'), ('Versement d''espèces'), ('Retrait d''espèces pour la caisse'), ('Paiement de TVA'),
      ('Remboursement de TVA'), ('Liquidation de TVA'), ('Dotation aux amortissements'), ('Frais de véhicule (barème)'),
      ('À-nouveaux'), ('TVA due sur facture'), ('Annulation de recette'), ('Remise en banque')
  ), postes(poste, classe) as (
    -- Les postes que la 2035 range (`POSTES_RATTACHES`, src/lib/cases2035.ts), chacun avec la classe des comptes qui le
    -- portent : 7, un produit, pour un poste qu'elle range sous une recette ; 6, une charge, pour un poste qu'elle
    -- range sous une dépense — ceux des dépenses, et ceux des deux cases qui se retranchent des recettes, les débours
    -- (AB) et les honoraires rétrocédés (AC) : la rétrocession payée à un remplaçant est une charge
    -- (`cadreCompatible`).
    values
      ('Recettes', '7'), ('Recettes encaissées y compris les remboursements de frais', '7'),
      ('Débours payés pour le compte des clients', '6'), ('Débours', '6'), ('Honoraires rétrocédés', '6'),
      ('Rétrocessions', '6'), ('Produits financiers', '7'), ('Gains divers', '7'),
      ('Indemnités journalières', '7'), ('Achats', '6'),
      ('Salaires nets et avantages en nature', '6'), ('Salaires', '6'), ('Charges sociales sur salaires', '6'),
      ('Taxe sur la valeur ajoutée', '6'), ('TVA', '6'), ('Contribution économique territoriale', '6'), ('CET', '6'),
      ('Autres impôts', '6'), ('Impôts et taxes', '6'), ('Contribution sociale généralisée déductible', '6'),
      ('CSG déductible', '6'), ('Loyer et charges locatives', '6'), ('Loyers et charges locatives', '6'),
      ('Location de matériel et de mobilier', '6'), ('Redevances de collaboration', '6'),
      ('Entretien et réparations', '6'), ('Personnel intérimaire', '6'),
      ('Petit outillage', '6'), ('Chauffage, eau, gaz, électricité', '6'),
      ('Honoraires ne constituant pas des rétrocessions', '6'), ('Primes d''assurance', '6'),
      ('Primes d''assurances', '6'), ('Assurance', '6'), ('Frais de véhicules', '6'),
      ('Autres frais de déplacements', '6'), ('Frais de déplacement', '6'), ('Frais de déplacements', '6'),
      ('Indemnités kilométriques', '6'), ('Cotisations sociales personnelles', '6'),
      ('Charges sociales personnelles', '6'), ('Cotisations facultatives Madelin', '6'),
      ('Plan d''épargne retraite', '6'), ('Frais de réception, de représentation et de congrès', '6'),
      ('Frais de réception, de représentation', '6'),
      ('Fournitures de bureau, frais de documentation, de correspondance et de téléphone', '6'),
      ('Fournitures de bureau', '6'), ('Frais d''actes et de contentieux', '6'),
      ('Cotisations syndicales et professionnelles', '6'), ('Autres frais divers de gestion', '6'),
      ('Frais divers de gestion', '6'), ('Divers', '6'), ('Frais financiers', '6'), ('Pertes diverses', '6'),
      ('Amortissements', '6'), ('Dotation aux amortissements', '6')
  ), documents as (
    -- Les factures et les avoirs validés du dossier : leur numéro, et le SIRET ou le SIREN que leur client figé porte.
    select f.numero, f.tiers_siret as siret from public.factures_emises f
     where f.dossier_id = p_dossier_id and f.statut = 'validee' and coalesce(f.numero, '') <> ''
  ), cles as (
    -- La clé de Luhn de l'INSEE, en entiers : en partant de la droite, un chiffre sur deux doublé (moins neuf au-delà
    -- de neuf) ; la somme d'un numéro juste est un multiple de dix. Les établissements de La Poste (SIREN 356000000),
    -- trop nombreux pour elle, ont un SIRET dont la somme des chiffres est un multiple de cinq ; son siège
    -- (35600000000048) garde la clé de Luhn (INSEE ; `sirenValide`, `siretValide`, src/lib/factureCii.ts).
    select left(d.siret, 9) as siren,
           (select sum(case when (9 - k) % 2 = 1 then case when z.c * 2 > 9 then z.c * 2 - 9 else z.c * 2 end else z.c end)
              from generate_series(1, 9) k cross join lateral (select substr(d.siret, k, 1)::integer as c) z) % 10 = 0
             as siren_juste,
           case when length(d.siret) = 9 then true
                when left(d.siret, 9) = '356000000' and d.siret <> '35600000000048'
                  then (select sum(substr(d.siret, k, 1)::integer) from generate_series(1, 14) k) % 5 = 0
                else (select sum(case when (14 - k) % 2 = 1 then case when z.c * 2 > 9 then z.c * 2 - 9 else z.c * 2 end
                                      else z.c end)
                        from generate_series(1, 14) k cross join lateral (select substr(d.siret, k, 1)::integer as c) z)
                     % 10 = 0
           end as siret_juste
      from documents d
     where d.siret ~ '^[0-9]{9}$' or d.siret ~ '^[0-9]{14}$'
  ), admis(valeur) as (
    -- Ce qui identifie un client : le numéro d'un document validé, ou le SIREN juste de son client figé.
    select numero from documents
    union
    select siren from cles where siren_juste and siret_juste
  )
  select case
      when exists (select 1 from l where date_reglement is not null
                    and (jour is null or to_char(jour, 'YYYY-MM-DD') <> date_reglement)) then 'date_illisible'
      when exists (select 1 from l where jour > (v_maintenant at time zone 'Europe/Paris')::date) then 'date_future'
      when exists (select 1 from l where mode_reglement is not null
                    and not exists (select 1 from modes m where m.mode = l.mode_reglement)) then 'mode_hors_liste'
      when exists (select 1 from l where nature_operation is not null
                    and not exists (select 1 from natures n where n.nature = l.nature_operation)) then 'nature_hors_liste'
      when exists (select 1 from l where poste_rattache is not null
                    and not exists (select 1 from postes p where p.poste = l.poste_rattache)) then 'poste_hors_liste'
      when exists (select 1 from l where poste_rattache is not null and nature_operation is null) then 'poste_sans_nature'
      when exists (select 1 from l where poste_rattache is not null and compte !~ '^[67][0-9]{2}') then 'poste_hors_resultat'
      when exists (select 1 from l where poste_rattache is not null
                    and not exists (select 1 from postes p
                                     where p.poste = l.poste_rattache and p.classe = left(l.compte, 1))) then 'poste_hors_cadre'
      when exists (select 1 from ecritures where dates) then 'date_differe'
      when exists (select 1 from ecritures where modes) then 'mode_differe'
      when exists (select 1 from ecritures where natures) then 'nature_differe'
      when exists (select 1 from ecritures where clients) then 'client_differe'
      when exists (select 1 from l where identification_client is not null
                    and not exists (select 1 from admis a where a.valeur = l.identification_client)) then 'client_inconnu'
    end
  into v_champs;
  if v_champs = 'date_illisible' then
    raise exception 'Une ligne de la numérotation proposée porte une date de règlement illisible.'
      using errcode = '22023';
  end if;
  if v_champs = 'date_future' then
    raise exception 'Une ligne de la numérotation proposée porte une date de règlement postérieure à aujourd''hui.'
      using errcode = '22023';
  end if;
  if v_champs = 'mode_hors_liste' then
    raise exception 'Une ligne de la numérotation proposée porte un mode de règlement hors de sa liste.'
      using errcode = '22023';
  end if;
  if v_champs = 'nature_hors_liste' then
    raise exception 'Une ligne de la numérotation proposée porte une nature d''opération hors de sa liste.'
      using errcode = '22023';
  end if;
  if v_champs = 'poste_hors_liste' then
    raise exception 'Une ligne de la numérotation proposée porte un poste de la 2035 hors de sa liste.'
      using errcode = '22023';
  end if;
  if v_champs = 'poste_sans_nature' then
    raise exception 'Une ligne de la numérotation proposée porte un poste de la 2035 sans nature d''opération.'
      using errcode = '22023';
  end if;
  if v_champs = 'poste_hors_resultat' then
    raise exception 'Une ligne de la numérotation proposée porte un poste de la 2035 sur un compte qui n''est ni de charge ni de produit.'
      using errcode = '22023';
  end if;
  if v_champs = 'poste_hors_cadre' then
    raise exception 'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.'
      using errcode = '22023';
  end if;
  if v_champs = 'date_differe' then
    raise exception 'Les lignes d''une même écriture ne portent pas la même date de règlement.'
      using errcode = '22023';
  end if;
  if v_champs = 'mode_differe' then
    raise exception 'Les lignes d''une même écriture ne portent pas le même mode de règlement.'
      using errcode = '22023';
  end if;
  if v_champs = 'nature_differe' then
    raise exception 'Les lignes d''une même écriture ne portent pas la même nature d''opération.'
      using errcode = '22023';
  end if;
  if v_champs = 'client_differe' then
    raise exception 'Les lignes d''une même écriture ne portent pas la même identification du client.'
      using errcode = '22023';
  end if;
  if v_champs = 'client_inconnu' then
    raise exception 'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'
      using errcode = '22023';
  end if;

  -- LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE SANS SA CONTREPARTIE (relecture de C8 et C9, le 01/11/2026 ; le défaut 1 ; un filet,
  -- que l'application dit avant le clic) : un paiement vivant de l'exercice — de genre `paiement`, non retiré, qui cite sa
  -- pièce — dont les lignes du brouillon qui le citent avec sa pièce, à sa date, au compte de la caisse du plan, dans le sens
  -- de ses espèces, ne font pas son montant. Validé, l'exercice reporterait une caisse fausse, et plus rien ne la rattraperait :
  -- la pièce s'écrirait à la date de son paiement, figée, et le paiement ne se retire plus. Le premier, par sa date.
  select o.date, o.montant into v_paiement
    from public.operations_caisse o
   where o.dossier_id = p_dossier_id and o.genre = 'paiement' and o.retire_le is null and o.piece_id is not null
     and o.date between v_debut and v_fin
     and abs(o.montant) <> coalesce((
       select sum(b.montant) from public.ecritures_brouillon b
        where b.operation_caisse_id = o.id and b.dossier_id = p_dossier_id and b.piece_id = o.piece_id and b.date = o.date
          and b.compte = public.compte_du_role(p_dossier_id, 'caisse')
          and b.sens = case when o.montant > 0 then 'debit' else 'credit' end), 0)
   order by o.date, o.id
   limit 1;
  if found then
    raise exception 'L''exercice % porte le paiement en espèces du % d''une pièce (% €) sans sa contrepartie entière au compte de la caisse : valider sa pièce et générer ses écritures, ou les régénérer, avant la validation — ou retirer ce paiement.',
      p_annee, to_char(v_paiement.date, 'DD/MM/YYYY'), replace(to_char(abs(v_paiement.montant), 'FM999999999990.00'), '.', ',')
      using errcode = '23514';
  end if;

  -- L'INVENTAIRE (ligne 35, INV3 ; docs/conceptions/35-inventaire.md, § 3.5, § 4.5 et § 5.3). Après TOUS les refus d'hier :
  -- un exercice qu'ils refusaient l'est encore, sous les mêmes mots. Dans cet ordre, que src/lib/inventaireDeLaValidation.ts
  -- redit sous les mêmes mots : la numérotation des écritures d'une régularisation, l'inventaire déclaré (INV-Q9 (A)), les
  -- régularisations de l'exercice à jour, l'extourne entière de celles de l'exercice précédent, la ventilation des
  -- provisions reprises (INV-Q11 (A), dès que la migration `provisions` est en base), les régularisations reprises d'une
  -- balance (INV3-Q2 (A)). Un dossier en trésorerie n'a ni régularisation ni provision (leurs fonctions le refusent) et ne
  -- déclare rien : rien de ceci ne le retient.
  --   a. Une ligne qui cite une régularisation se numérote au journal des opérations diverses, sous la pièce « Inventaire
  --      AAAA » datée du 31 décembre de l'exercice de sa régularisation (l'état d'inventaire, INV-Q7 (A) ; son extourne
  --      aussi), dans l'écriture de sa régularisation à sa date, qu'elle ne partage avec aucune autre ligne.
  if exists (select 1 from public.ecritures_brouillon e
              where e.dossier_id = p_dossier_id and e.operation_inventaire_id is not null and e.date between v_debut and v_fin) then
    with l as (
      select x.journal, x.numero, x.piece_ref, x.piece_date, e.operation_inventaire_id as operation, e.date, o.exercice
        from jsonb_to_recordset(p_lignes) as x(id uuid, journal text, numero integer, piece_ref text, piece_date date)
        join public.ecritures_brouillon e on e.id = x.id and e.dossier_id = p_dossier_id
        left join public.operations_inventaire o on o.id = e.operation_inventaire_id
    ), ecritures as (
      select l.journal, l.numero, count(distinct (l.operation, l.date)) as sources, bool_or(l.operation is null) as autres
        from l group by l.journal, l.numero
      having bool_or(l.operation is not null)
    )
    select exists (select 1 from l where l.operation is not null
                     and (l.journal is distinct from 'OD' or l.piece_ref is distinct from 'Inventaire ' || l.exercice
                          or l.piece_date is distinct from make_date(l.exercice, 12, 31)))
        or exists (select 1 from ecritures w where w.sources <> 1 or w.autres)
        or exists (select 1 from l where l.operation is not null group by l.operation, l.date
                    having count(distinct (l.journal, l.numero)) <> 1)
      into v_inventaire_mal_numerote;
    if v_inventaire_mal_numerote then
      raise exception 'Une écriture d''inventaire n''est pas numérotée sous sa pièce : au journal des opérations diverses, une écriture par régularisation et par date, sous la pièce « Inventaire AAAA » du 31 décembre de son exercice.'
        using errcode = '22023';
    end if;
  end if;
  --   b. L'inventaire déclaré (INV-Q9 (A)) : en engagement, l'exercice ne se valide pas tant que le cabinet n'a pas déclaré
  --      son inventaire fait, même sans aucune régularisation — sans quoi rien ne distingue « rien à régulariser » de « pas
  --      regardé » (code de commerce, art. L123-12 : l'inventaire au moins une fois tous les douze mois).
  if v_mode = 'engagement' and not exists (
      select 1 from public.inventaires_declares d
       where d.dossier_id = p_dossier_id and d.exercice = p_annee and d.retire_le is null) then
    raise exception 'L''inventaire de l''exercice % n''est pas déclaré : le déclarer fait, même sans régularisation, avant la validation.',
      p_annee using errcode = '23514';
  end if;
  --   c. Les régularisations de l'exercice, à jour : leurs lignes sont celles qu'elles commandent, aux deux dates
  --      (`inventaire_a_jour`). La première, par son identifiant.
  select o.objet into v_regularisation
    from public.operations_inventaire o
   where o.dossier_id = p_dossier_id and o.exercice = p_annee and not public.inventaire_a_jour(o.id)
   order by o.id
   limit 1;
  if found then
    raise exception 'L''exercice % porte une régularisation d''inventaire dont les écritures ne sont plus celles qu''elle commande : % — l''enregistrer de nouveau avant la validation.',
      p_annee, v_regularisation.objet using errcode = '23514';
  end if;
  --   d. L'extourne entière des régularisations de l'exercice précédent, figées avec lui : au 1er janvier, les lignes de
  --      leur constatation validée, ligne pour ligne, en sens inverse ; aucune pour une provision, qui ne s'extourne pas
  --      (`inventaire_extourne_entiere`). La première, par son identifiant. Une régularisation reprise n'a pas de
  --      constatation validée : le point f la juge.
  select o.objet into v_regularisation
    from public.operations_inventaire o
   where o.dossier_id = p_dossier_id and o.exercice = p_annee - 1 and not o.reprise and not public.inventaire_extourne_entiere(o.id)
   order by o.id
   limit 1;
  if found then
    raise exception 'L''exercice % ne porte pas l''extourne entière d''une régularisation d''inventaire de l''exercice % : % — figée avec son exercice, elle ne se réécrit plus, et l''exercice ne se valide pas sans elle.',
      p_annee, p_annee - 1, v_regularisation.objet using errcode = '23514';
  end if;
  --   e. Les provisions reprises (INV-Q11 (A) ; migration `provisions`, INV4) : au premier exercice d'un dossier en
  --      engagement, celui de sa balance reprise, le solde repris de chaque compte de provision (151, 491) se ventile
  --      exactement en provisions nommées — la somme de leurs parts reprises fait son solde au crédit, au centime ; un
  --      compte repris sans aucune provision ne l'est pas. Le premier compte en écart, par son numéro.
  if v_mode = 'engagement' and v_ouverture is not null and extract(year from v_ouverture)::integer = p_annee
     and to_regclass('public.provisions') is not null then
    select c.compte into v_compte_repris
      from (select a.compte from public.a_nouveaux a
             where a.dossier_id = p_dossier_id and (starts_with(a.compte, '151') or starts_with(a.compte, '491'))
            union
            select p.compte_provision from public.provisions p
             where p.dossier_id = p_dossier_id and p.reprise_centimes is not null) c
     where coalesce((select sum(round(case a.sens when 'credit' then a.montant else -a.montant end * 100))::bigint
                       from public.a_nouveaux a where a.dossier_id = p_dossier_id and a.compte = c.compte), 0)
           <> coalesce((select sum(p.reprise_centimes)::bigint from public.provisions p
                         where p.dossier_id = p_dossier_id and p.compte_provision = c.compte and p.reprise_centimes is not null), 0)
     order by c.compte collate "C"
     limit 1;
    if found then
      raise exception 'L''exercice % ouvre le solde repris du compte % sans le ventiler exactement en provisions : les provisions ventilées doivent faire exactement le solde repris du compte — les ventiler avant la validation.',
        p_annee, v_compte_repris using errcode = '23514';
    end if;
  end if;
  --   f. Les régularisations reprises d'une balance (INV3-Q2 (A) ; leur saisie, `operations_d_inventaire`) : celles de
  --      l'exercice précédent, que la balance clôt, dont l'extourne tombe le 1er janvier de celui-ci. Chacune à jour — son
  --      extourne seule, recomposée (`inventaire_a_jour`) ; à sa place — la balance reprise ouvre cet exercice au 1er janvier
  --      (retirée, ou reprise à une autre date, elle n'aurait plus de solde à extourner) ; puis, au premier exercice d'un
  --      dossier en engagement ouvert au 1er janvier, la confrontation au solde repris : les extournes des régularisations
  --      reprises soldent EXACTEMENT, au 1er janvier, chaque compte de régularisation de la balance et chaque compte qu'elles
  --      touchent, sous le 486, le 487, le 408 (hors du 4084, que l'inventaire ne range pas : INV1-Q1), le 418, le 44586 et le
  --      44587 — un compte repris sans régularisation reprise ne l'est pas. La première, par son identifiant ; le premier
  --      compte en écart, par son numéro.
  select o.objet into v_regularisation
    from public.operations_inventaire o
   where o.dossier_id = p_dossier_id and o.exercice = p_annee - 1 and o.reprise and not public.inventaire_a_jour(o.id)
   order by o.id
   limit 1;
  if found then
    raise exception 'L''exercice % porte une régularisation reprise de la balance dont l''extourne n''est plus celle qu''elle commande : % — l''enregistrer de nouveau avant la validation.',
      p_annee, v_regularisation.objet using errcode = '23514';
  end if;
  select o.objet into v_regularisation
    from public.operations_inventaire o
   where o.dossier_id = p_dossier_id and o.exercice = p_annee - 1 and o.reprise and v_ouverture is distinct from v_debut
   order by o.id
   limit 1;
  if found then
    raise exception 'L''exercice % porte une régularisation reprise que la balance reprise n''ouvre plus au 1er janvier : % — la retirer, ou reprendre la balance au 1er janvier de l''exercice, avant la validation.',
      p_annee, v_regularisation.objet using errcode = '23514';
  end if;
  if v_mode = 'engagement' and v_ouverture = v_debut then
    with soldes as (
      select a.compte, round(case a.sens when 'debit' then a.montant else -a.montant end * 100)::bigint as centimes
        from public.a_nouveaux a where a.dossier_id = p_dossier_id
      union all
      select e.compte, round(case e.sens when 'debit' then e.montant else -e.montant end * 100)::bigint
        from public.ecritures_brouillon e join public.operations_inventaire o on o.id = e.operation_inventaire_id
       where e.dossier_id = p_dossier_id and o.reprise and o.exercice = p_annee - 1 and e.date = v_debut
    )
    select s.compte into v_compte_repris
      from soldes s
     where (starts_with(s.compte, '486') or starts_with(s.compte, '487') or starts_with(s.compte, '408')
            or starts_with(s.compte, '418') or starts_with(s.compte, '44586') or starts_with(s.compte, '44587'))
       and not starts_with(s.compte, '4084')
     group by s.compte
    having sum(s.centimes) <> 0
     order by s.compte collate "C"
     limit 1;
    if found then
      raise exception 'L''exercice % ouvre le solde repris du compte % sans que ses régularisations reprises l''extournent exactement : leurs extournes au 1er janvier doivent solder le compte repris — les saisir avant la validation.',
        p_annee, v_compte_repris using errcode = '23514';
    end if;
  end if;

  -- Les déclencheurs d'intangibilité ne laissent passer « validée » — et les libellés des soldes reportés — qu'à cette
  -- fonction, pour ce dossier.
  perform set_config('jd.validation_exercice', p_dossier_id::text, true);
  -- Les quatre champs du FEC d'un BNC partent avec la numérotation (lot FEC22b) : nuls quand la demande ne les porte
  -- pas.
  update public.ecritures_brouillon e
     set statut = 'validee', valide_le = v_maintenant, journal_code = l.journal, numero_ecriture = l.numero,
         piece_ref = l.piece_ref, piece_date = l.piece_date, compte_lib = l.compte_lib,
         comp_aux_num = l.comp_aux_num, comp_aux_lib = l.comp_aux_lib,
         date_reglement = l.date_reglement::date, mode_reglement = l.mode_reglement,
         nature_operation = l.nature_operation, poste_rattache = l.poste_rattache,
         identification_client = l.identification_client
    from jsonb_to_recordset(p_lignes) as l(id uuid, journal text, numero integer, piece_ref text, piece_date date,
      compte_lib text, comp_aux_num text, comp_aux_lib text, date_reglement text, mode_reglement text,
      nature_operation text, poste_rattache text, identification_client text)
   where e.id = l.id and e.dossier_id = p_dossier_id;
  update public.soldes_reportes s set compte_lib = l.compte_lib, ecriture_lib = l.ecriture_lib
    from jsonb_to_recordset(p_a_nouveaux) as l(id uuid, compte_lib text, ecriture_lib text)
   where s.id = l.id and s.dossier_id = p_dossier_id;
  perform set_config('jd.validation_exercice', '', true);
  update public.a_nouveaux a set compte_lib = l.compte_lib, ecriture_lib = l.ecriture_lib
    from jsonb_to_recordset(p_a_nouveaux) as l(id uuid, compte_lib text, ecriture_lib text)
   where a.id = l.id and a.dossier_id = p_dossier_id;

  if exists (select 1 from public.ecritures_brouillon where dossier_id = p_dossier_id and date <= v_fin and statut = 'proposee') then
    raise exception 'Une écriture de l''exercice % n''a pas été validée.', p_annee using errcode = '23514';
  end if;

  -- Les soldes de fin de l'exercice, qui ouvriront le suivant : aucun compte hors des classes 1 à 7 ne doit porter de
  -- solde — il ne se reporterait pas —, et ils s'équilibrent, à-nouveaux compris.
  select string_agg(compte, ', ' order by compte) filter (where compte !~ '^[1-5][0-9]{2,}$'),
         coalesce(sum(case when sens = 'debit' then montant else -montant end), 0)
    into v_hors, v_ecart
    from public.soldes_a_reporter(p_dossier_id, p_annee);
  if v_hors is not null then
    raise exception 'L''exercice % se clôt sur le solde de comptes qui ne sont ni de bilan ni de résultat (%) : il ne se reporte pas, corriger leurs écritures avant la validation.',
      p_annee, v_hors using errcode = '23514';
  end if;
  if v_ecart <> 0 then
    raise exception 'Les soldes de l''exercice % ne s''équilibrent pas, à-nouveaux compris : l''ouverture de l''exercice suivant ne peut pas s''écrire.',
      p_annee using errcode = '23514';
  end if;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0), coalesce(sum(montant) filter (where sens = 'credit'), 0),
         count(distinct (journal_code, numero_ecriture)), count(*)
    into v_debit, v_credit, v_ecritures, v_lignes
    from public.ecritures_brouillon
   where dossier_id = p_dossier_id and statut = 'validee' and date between v_debut and v_fin;
  select empreinte into v_precedente from public.exercices_valides
   where dossier_id = p_dossier_id and annee < p_annee order by annee desc limit 1;
  -- L'empreinte en forme 2 (INAL2, ligne 44) : celle d'hier — les écritures validées, les à-nouveaux et les soldes
  -- reportés, chaînés à l'exercice précédent — enveloppée de l'en-tête que la ligne de l'exercice garde, des fichiers des
  -- pièces que ses écritures citent et de la 2035 validée, chacun tel que la ligne l'enregistre.
  v_auteur := auth.uid();
  v_empreinte := public.empreinte_exercice_forme_2(p_dossier_id, p_annee, v_precedente, v_maintenant, v_auteur, v_mode,
    v_lignes, v_ecritures, v_debit, v_credit, case when v_mode = 'tresorerie' then p_declaration end);

  insert into public.exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures,
    total_debit, total_credit, empreinte_precedente, empreinte, declaration, forme_empreinte)
  values (p_dossier_id, p_annee, v_maintenant, v_auteur, v_mode, v_lignes, v_ecritures, v_debit, v_credit,
    v_precedente, v_empreinte, case when v_mode = 'tresorerie' then p_declaration end, 2);

  -- L'ouverture de l'exercice suivant, dans le même clic : ses soldes de fin, datés du 1er janvier suivant, chacun
  -- portant l'empreinte de l'exercice dont il vient.
  perform set_config('jd.validation_exercice', p_dossier_id::text, true);
  insert into public.soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
  select p_dossier_id, make_date(p_annee + 1, 1, 1), r.compte, r.libelle, r.sens, r.montant,
         format('Exercice %s validé', p_annee), v_empreinte
    from public.soldes_a_reporter(p_dossier_id, p_annee) r;
  get diagnostics v_reportes = row_count;
  perform set_config('jd.validation_exercice', '', true);

  return jsonb_build_object('annee', p_annee, 'lignes', v_lignes, 'ecritures', v_ecritures, 'a_nouveaux', v_an_attendus,
    'reportes', v_reportes, 'empreinte', v_empreinte, 'valide_le', v_maintenant);
end;
$$;

comment on function public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb) is
  'Valide un exercice terminé : vérifie la numérotation proposée par l''application, fige ses écritures — et les quatre champs du FEC d''un BNC que la numérotation porte (date, mode, nature et poste, identification du client), chacun dans sa forme, les mêmes sur les lignes d''une écriture, le client identifié par une facture validée du dossier seulement —, enregistre l''exercice sous son empreinte en forme 2 (l''en-tête, les écritures, les à-nouveaux et les soldes reportés chaînés, les fichiers des pièces citées, la 2035 validée : INAL2) et écrit l''ouverture du suivant (soldes_reportes) ; pour un dossier basculé, refuse aussi un mouvement réservé à des encaissements de factures, un virement ou un prélèvement sans son mouvement, et une vente facturée qui n''est pas écrite à jour. Refuse aussi un paiement d''une pièce par la caisse de l''exercice dont la contrepartie entière au compte de la caisse n''est pas au brouillon (relecture du 01/11/2026). L''inventaire (INV3, ligne 35) : refuse une écriture d''inventaire numérotée hors de sa pièce, un exercice en engagement dont l''inventaire n''est pas déclaré (INV-Q9), une régularisation de l''exercice qui n''est pas à jour, l''extourne incomplète d''une régularisation de l''exercice précédent, et au premier exercice un compte de provision repris qui n''est pas ventilé exactement (INV-Q11), une régularisation reprise d''une balance qui n''est pas à jour ou que la balance n''ouvre plus au 1er janvier, et un compte de régularisation repris que ses régularisations reprises n''extournent pas exactement (INV3-Q2) ; l''empreinte en forme 2 scelle aussi les régularisations de l''exercice et les pièces qu''elles citent (INV3-Q1). Chef du cabinet seul.';

-- ══ 4 bis. L'empreinte scelle l'inventaire (INV3-Q1 (A)) ══
-- Les régularisations qu'un exercice SCELLE : celles qu'il constate au 31 décembre (une évaluation de provision comprise,
-- même sans écart), et les régularisations reprises d'une balance dont il porte l'extourne au 1er janvier — chacune scellée
-- une fois, par l'exercice qui la porte. Une régularisation, son exercice validé, ne change plus (sa garde, INV2) ; une
-- provision évaluée non plus (la sienne, INV4).
--
-- Leur texte : une régularisation par ligne (séparées par le caractère 30, dans l'ordre de leurs identifiants), chacune un
-- tableau jsonb sous sa forme canonique — aucun séparateur ne s'y glisse depuis un objet saisi, aucun champ nul ne s'y perd,
-- une date s'y écrit AAAA-MM-JJ quel que soit le réglage de la session : l'identifiant, l'exercice, la nature, la reprise,
-- les deux comptes, le montant et la TVA en centimes, la période, l'objet et la pièce citée ; une évaluation, en plus, sa
-- provision (son identifiant, son genre, son compte, son objet, sa facture, sa pièce, son exercice d'ouverture, sa part
-- reprise). Nul quand l'exercice n'en scelle aucune. En PL/pgSQL : la provision ne se lit que quand sa table est en base
-- (INV4, avant ou après cette migration), et le texte d'une régularisation est le même dans les deux cas. Sous la RLS de
-- l'appelant, comme l'empreinte qui l'appelle.
create function public.regularisations_scellees(p_dossier_id uuid, p_annee integer) returns text
language plpgsql stable set search_path = public as $$
declare
  v text;
begin
  if to_regclass('public.provisions') is null then
    select string_agg(jsonb_build_array(o.id, o.exercice, o.nature, o.reprise, o.compte_resultat, o.compte_regularisation,
                        o.montant_centimes, o.tva_centimes, o.periode_debut, o.periode_fin, o.objet, o.piece_citee_id)::text,
                      chr(30) order by o.id)
      into v
      from public.operations_inventaire o
     where o.dossier_id = p_dossier_id and (case when o.reprise then o.exercice + 1 else o.exercice end) = p_annee;
  else
    select string_agg((jsonb_build_array(o.id, o.exercice, o.nature, o.reprise, o.compte_resultat, o.compte_regularisation,
                         o.montant_centimes, o.tva_centimes, o.periode_debut, o.periode_fin, o.objet, o.piece_citee_id)
                       || case when o.provision_id is null then '[]'::jsonb
                               else jsonb_build_array(p.id, p.genre, p.compte_provision, p.objet, p.facture_id, p.piece_citee_id,
                                                      p.ouverte_en, p.reprise_centimes) end)::text,
                      chr(30) order by o.id)
      into v
      from public.operations_inventaire o left join public.provisions p on p.id = o.provision_id
     where o.dossier_id = p_dossier_id and (case when o.reprise then o.exercice + 1 else o.exercice end) = p_annee;
  end if;
  return v;
end
$$;

-- Les pièces qu'elles citent : la pièce citée d'une régularisation, celle de la provision qu'une évaluation évalue.
create function public.pieces_scellees_par_l_inventaire(p_dossier_id uuid, p_annee integer) returns setof uuid
language plpgsql stable set search_path = public as $$
begin
  return query
    select o.piece_citee_id from public.operations_inventaire o
     where o.dossier_id = p_dossier_id and (case when o.reprise then o.exercice + 1 else o.exercice end) = p_annee
       and o.piece_citee_id is not null;
  if to_regclass('public.provisions') is not null then
    return query
      select p.piece_citee_id from public.operations_inventaire o join public.provisions p on p.id = o.provision_id
       where o.dossier_id = p_dossier_id and o.exercice = p_annee and p.piece_citee_id is not null;
  end if;
end
$$;
revoke execute on function public.regularisations_scellees(uuid, integer) from public, anon;
grant execute on function public.regularisations_scellees(uuid, integer) to authenticated;
revoke execute on function public.pieces_scellees_par_l_inventaire(uuid, integer) from public, anon;
grant execute on function public.pieces_scellees_par_l_inventaire(uuid, integer) to authenticated;
comment on function public.regularisations_scellees(uuid, integer) is
  'INV3-Q1 (A) : le texte des régularisations d''inventaire qu''un exercice scelle (celles qu''il constate, ses évaluations de provision avec leur provision, les régularisations reprises dont il porte l''extourne), pour l''empreinte en forme 2 ; nul quand il n''en scelle aucune. Lue sous la RLS de l''appelant.';
comment on function public.pieces_scellees_par_l_inventaire(uuid, integer) is
  'INV3-Q1 (A) : les pièces que citent les régularisations d''inventaire qu''un exercice scelle, directement ou par leur provision, pour l''empreinte en forme 2. Lue sous la RLS de l''appelant.';

-- Le premier exercice VALIDÉ qui scelle une pièce par l'inventaire : celui d'une régularisation qui la cite (l'exercice
-- suivant pour une reprise), ou d'une évaluation de la provision qui la cite ; nul sinon. Privée : la garde des pièces et
-- `fichier_fige` l'appellent sous leurs droits.
create function public.exercice_scellant_la_piece_citee(p_piece_id uuid) returns integer
language plpgsql stable set search_path = public as $$
declare
  v integer;
  v_provision integer;
begin
  select min(case when o.reprise then o.exercice + 1 else o.exercice end) into v
    from public.operations_inventaire o
   where o.piece_citee_id = p_piece_id
     and (case when o.reprise then o.exercice + 1 else o.exercice end) <= extract(year from public.frontiere_validation(o.dossier_id));
  if to_regclass('public.provisions') is not null then
    select min(o.exercice) into v_provision
      from public.provisions p join public.operations_inventaire o on o.provision_id = p.id
     where p.piece_citee_id = p_piece_id and o.exercice <= extract(year from public.frontiere_validation(o.dossier_id));
    v := least(v, v_provision);
  end if;
  return v;
end
$$;
revoke execute on function public.exercice_scellant_la_piece_citee(uuid) from public, anon, authenticated;

-- La garde du fichier d'une pièce que l'inventaire d'un exercice validé scelle : ni son chemin, ni son empreinte de dépôt,
-- ni sa version lisible, ni son dossier ne changent, et elle ne se supprime plus — l'empreinte de l'exercice les a
-- scellés. Le reste de la pièce se traite comme toute pièce (sa catégorie, ses montants, sa validation dans l'exercice
-- suivant : la facture de janvier qu'une facture non parvenue cite) ; le départ du dossier l'emporte ; la restauration
-- réinsère.
create function public.garder_fichier_scelle_par_l_inventaire() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_annee integer;
begin
  if not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_op = 'UPDATE' and new.storage_path is not distinct from old.storage_path
     and new.storage_hash is not distinct from old.storage_hash and new.lisible_path is not distinct from old.lisible_path
     and new.dossier_id is not distinct from old.dossier_id then
    return new;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
  v_annee := public.exercice_scellant_la_piece_citee(old.id);
  if v_annee is null then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Cette pièce fonde une régularisation d''inventaire de l''exercice % : elle ne se supprime plus.', v_annee
      using errcode = '23514';
  end if;
  raise exception 'Cette pièce fonde une régularisation d''inventaire de l''exercice % : son fichier ne change plus.', v_annee
    using errcode = '23514';
end;
$$;
create trigger pieces_fichier_scelle_par_l_inventaire
  before update of storage_path, storage_hash, lisible_path, dossier_id or delete
  on public.pieces for each row execute function public.garder_fichier_scelle_par_l_inventaire();
revoke execute on function public.garder_fichier_scelle_par_l_inventaire() from public, anon, authenticated;

-- `fichier_fige` (INAL1), au caractère près celle de la production, plus la pièce que l'inventaire d'un exercice validé
-- scelle : son fichier et sa version lisible ne se retirent plus du stockage (la policy `pieces_storage_delete`).
create or replace function public.fichier_fige(p_chemin text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Le dossier que le chemin nomme se tire après la forme du chemin, dans cet ordre (`case` n'évalue une branche qu'à son
  -- tour) : un chemin mal formé ne fait rien lever.
  select case
    when p_chemin is null then null
    when p_chemin !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then null
    when not public.admin_du_dossier(split_part(p_chemin, '/', 1)::uuid) then null
    else exists (
        select 1 from public.pieces p
         where (p.storage_path = p_chemin or p.lisible_path = p_chemin)
           and (public.exercice_figeant_la_piece(p.id) is not null
                or exists (select 1 from public.revision_preuves r where r.piece_id = p.id)
                or exists (select 1 from public.dossier_permanent d where d.piece_id = p.id)
                or public.exercice_scellant_la_piece_citee(p.id) is not null))
      or exists (
        select 1 from public.documents_divers dd
         where dd.storage_path = p_chemin
           and (exists (select 1 from public.revision_preuves r where r.document_id = dd.id)
                or exists (select 1 from public.dossier_permanent d where d.document_id = dd.id)))
  end
$$;

comment on function public.fichier_fige(text) is
  'Vrai quand le chemin est le fichier (ou la version lisible) d''une pièce que la base fige — une écriture validée la cite, directement ou par son bien immobilisé, ou la révision la cite, ou l''inventaire d''un exercice validé la scelle (INV3-Q1) — ou le fichier d''un document divers que la révision cite ; nul pour qui n''administre pas le dossier du chemin, et pour un chemin qui ne commence pas par un dossier. La policy pieces_storage_delete refuse la suppression d''un tel fichier (INAL1, ligne 44).';

-- `empreinte_exercice_forme_2` (INAL2), au caractère près celle de la production hors de deux ajouts : les pièces que
-- scelle l'inventaire rejoignent celles des écritures validées, et un SIXIÈME bloc porte les régularisations scellées,
-- présent seulement quand il y en a. Un exercice sans régularisation garde son texte d'hier, octet pour octet.
create or replace function public.empreinte_exercice_forme_2(
  p_dossier_id uuid,
  p_annee integer,
  p_precedente text,
  p_valide_le timestamp with time zone,
  p_valide_par uuid,
  p_mode text,
  p_nb_lignes integer,
  p_nb_ecritures integer,
  p_total_debit numeric,
  p_total_credit numeric,
  p_declaration jsonb
) returns text
language sql
stable
set search_path = public
as $$
  select encode(sha256(convert_to(
    'jd-precompta/exercice-valide/forme-2'
    -- L'en-tête, tel que la ligne de l'exercice le garde : les totaux à deux décimales, comme la colonne les arrondit,
    -- puis sans zéro de fin.
    || chr(29) || concat_ws(chr(31),
         p_dossier_id::text, p_annee::text,
         to_char(make_date(p_annee, 1, 1), 'YYYY-MM-DD'), to_char(make_date(p_annee, 12, 31), 'YYYY-MM-DD'),
         to_char(p_valide_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(p_valide_par::text, ''),
         p_mode, p_nb_lignes::text, p_nb_ecritures::text,
         trim_scale(p_total_debit::numeric(16,2))::text, trim_scale(p_total_credit::numeric(16,2))::text)
    -- L'empreinte de forme 1, chaînée à la précédente.
    || chr(29) || public.empreinte_exercice(p_dossier_id, p_annee, p_precedente)
    -- Les fichiers des pièces que les écritures validées de l'exercice citent, directement ou par leur bien, et de celles
    -- que ses régularisations d'inventaire citent (INV3-Q1).
    || chr(29) || coalesce((
      select string_agg(concat_ws(chr(31), p.id::text, p.storage_path, coalesce(p.storage_hash, ''),
                                  coalesce(p.lisible_path, '')), chr(30) order by p.id)
        from public.pieces p
       where p.id in (
         select e.piece_id from public.ecritures_brouillon e
          where e.dossier_id = p_dossier_id and e.statut = 'validee' and e.piece_id is not null
            and e.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
         union
         select i.piece_id from public.ecritures_brouillon e join public.immobilisations i on i.id = e.immobilisation_id
          where e.dossier_id = p_dossier_id and e.statut = 'validee' and i.piece_id is not null
            and e.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
         union
         select s.piece_id from public.pieces_scellees_par_l_inventaire(p_dossier_id, p_annee) as s(piece_id))), '')
    -- La 2035 validée.
    || chr(29) || coalesce(p_declaration::text, '')
    -- Les régularisations d'inventaire que l'exercice scelle (INV3-Q1) : un bloc présent seulement quand il y en a.
    || coalesce(chr(29) || public.regularisations_scellees(p_dossier_id, p_annee), ''),
    'UTF8')), 'hex')
$$;

comment on function public.empreinte_exercice_forme_2(uuid, integer, text, timestamp with time zone, uuid, text, integer, integer, numeric, numeric, jsonb) is
  'L''empreinte SHA-256 d''un exercice validé en forme 2 (INAL2, ligne 44) : une étiquette, l''en-tête de sa ligne, son empreinte de forme 1 (empreinte_exercice, chaînée), les fichiers des pièces que ses écritures validées citent (identifiant, chemin, SHA-256 au dépôt, version lisible) et celles que ses régularisations d''inventaire citent, la 2035 validée, et — quand il en porte — ses régularisations d''inventaire (INV3-Q1, regularisations_scellees). Lue sous la RLS de l''appelant.';

-- ══ 5. La double authentification exigée, si elle est déjà en base ══
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.inventaires_declares as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;

-- ══ 5 bis. La porte d'accès devant les gardes (acces_avant_les_gardes, ligne 43), si elle est déjà en base ══
-- La garde `security definer` de cette migration sur sa table neuve : `garder_inventaires_declares` (celle des pièces,
-- `garder_fichier_scelle_par_l_inventaire`, est derrière la porte de `pieces`).
-- Une garde `security definer` tire avant l'expression WITH CHECK de la policy : sans la porte, elle répondrait à un
-- appelant que la policy refuse. Si la porte est en base, elle se pose ici, la première des déclencheurs BEFORE de la
-- table ; sinon, la porte la posera d'elle-même en s'appliquant (elle couvre toute table de cette liste qui porte déjà sa
-- garde). Les deux migrations se collent ainsi dans les deux ordres. L'essai : supabase/essais/accesAvantLesGardes.sql
-- (étape 32).
do $porte$
declare
  v_table text;
begin
  if to_regprocedure('public.acces_avant_les_gardes()') is not null then
    foreach v_table in array array['inventaires_declares'] loop
      if exists (select 1 from pg_catalog.pg_class c where c.oid = ('public.' || v_table)::regclass and not (c.relrowsecurity and not c.relforcerowsecurity))
         or exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = ('public.' || v_table)::regclass and not t.tgisinternal
                     and (t.tgname collate "C") < ('_acces_avant_les_gardes' collate "C")) then
        raise exception 'La porte d''accès ne se pose pas sur public.% : sa RLS n''est pas active (ou forcée), ou un déclencheur tirerait avant elle.', v_table;
      end if;
      if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = ('public.' || v_table)::regclass and t.tgname = '_acces_avant_les_gardes') then
        execute format('create trigger _acces_avant_les_gardes before insert or update on public.%I for each row execute function public.acces_avant_les_gardes()', v_table);
      end if;
    end loop;
  end if;
end
$porte$;

-- ══ 6. La garde de fin : ce qui est posé, à l'empreinte de son corps, sous ses droits ══
do $fin$
declare
  v record;
begin
  for v in select * from (values
      ('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)', '03732b43c1897163eaae83e23058e354', true),
      ('public.declarer_inventaire(uuid, integer)', '4c4b03b22feeb1eb2e49532c8adc3761', true),
      ('public.retirer_declaration_inventaire(uuid)', '3ea40ecdcc812f8a87695ce8b11f164c', true),
      ('public.inventaire_a_jour(uuid)', 'c38104a194f1f0ef1f71598a2ae4ee4e', false),
      ('public.inventaire_extourne_entiere(uuid)', '4f4cf944a48200df2744bfca4b28578e', false),
      ('public.garder_inventaires_declares()', '0f0cd2ae01048b134a7ff4329e3d0b84', false),
      ('public.regularisations_scellees(uuid, integer)', 'e19638d58d1e2f42e6496b7711882ede', true),
      ('public.pieces_scellees_par_l_inventaire(uuid, integer)', '243a354273994d727f7e51405825e601', true),
      ('public.exercice_scellant_la_piece_citee(uuid)', '33e20f9b621a76693354d9004b2ebc35', false),
      ('public.garder_fichier_scelle_par_l_inventaire()', 'c647bc6100b23faf3364b93eae996f26', false),
      ('public.fichier_fige(text)', 'c0c78141ddb7ba3b6912fdb68ec87da1', true),
      ('public.empreinte_exercice_forme_2(uuid, integer, text, timestamp with time zone, uuid, text, integer, integer, numeric, numeric, jsonb)',
       'cb18f6063974972974a1aa92eb5b3e92', true)) x(fonction, empreinte, connecte) loop
    if md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), ''))
         is distinct from v.empreinte
       or has_function_privilege('anon', v.fonction, 'execute')
       or has_function_privilege('authenticated', v.fonction, 'execute') is distinct from v.connecte then
      raise exception 'Garde de fin : la fonction % n''a pas le corps ou les droits attendus.', v.fonction;
    end if;
  end loop;
  -- `fichier_fige` reste celle que la policy de suppression du seau des pièces appelle (security definer, stable, son
  -- chemin de recherche, le même objet) ; l'empreinte reste sans droits propres (aux droits de l'appelant).
  if not (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public']
            from pg_proc p where p.oid = 'public.fichier_fige(text)'::regprocedure)
     or not exists (select 1 from pg_depend d join pg_policy p on p.oid = d.objid
                     where d.classid = 'pg_policy'::regclass and p.polname = 'pieces_storage_delete'
                       and p.polrelid = 'storage.objects'::regclass and d.refclassid = 'pg_proc'::regclass
                       and d.refobjid = 'public.fichier_fige(text)'::regprocedure)
     or (select p.prosecdef from pg_proc p
          where p.oid = 'public.empreinte_exercice_forme_2(uuid, integer, text, timestamp with time zone, uuid, text, integer, integer, numeric, numeric, jsonb)'::regprocedure)
     or (select count(*) from pg_proc p where p.proname in ('regularisations_scellees', 'pieces_scellees_par_l_inventaire') and p.prosecdef) > 0 then
    raise exception 'Garde de fin : fichier_fige ou l''empreinte n''ont plus la forme que la production leur donne.';
  end if;
  -- La garde du fichier d'une pièce scellée : avant la mise à jour de ses quatre colonnes, ou sa suppression, ligne par ligne.
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.pieces'::regclass and t.tgname = 'pieces_fichier_scelle_par_l_inventaire'
                   and not t.tgisinternal and t.tgenabled = 'O'
                   and pg_get_triggerdef(t.oid) = 'CREATE TRIGGER pieces_fichier_scelle_par_l_inventaire BEFORE DELETE OR UPDATE OF storage_path, storage_hash, lisible_path, dossier_id ON public.pieces FOR EACH ROW EXECUTE FUNCTION garder_fichier_scelle_par_l_inventaire()') then
    raise exception 'Garde de fin : la garde du fichier d''une pièce scellée par l''inventaire n''est pas celle que la migration pose.';
  end if;
  -- INV3-Q1 (A), rien ne change pour l'existant : les exercices validés que la garde de tête a vus se vérifier sous
  -- l'empreinte d'hier se vérifient sous l'empreinte étendue, tous, et aucun autre.
  if current_setting('jd.inventaire_exercices_verifies', true) is null
     or current_setting('jd.inventaire_exercices_verifies', true) is distinct from (
       select coalesce(string_agg(ev.dossier_id::text || ':' || ev.annee, ',' order by ev.dossier_id, ev.annee), '')
         from public.exercices_valides ev where public.verifier_exercice_valide(ev.dossier_id, ev.annee)) then
    raise exception 'Garde de fin : un exercice validé ne se vérifie plus comme avant la migration (ou la garde de tête ne les a pas relevés) : rien ne s''applique.';
  end if;
  perform set_config('jd.inventaire_exercices_verifies', '', true);
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure)
     or (select strpos(p.prosrc, 'perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));') from pg_proc p
          where p.oid = 'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure) not between 1
        and (select strpos(p.prosrc, 'set_config(''jd.validation_exercice''') from pg_proc p
              where p.oid = 'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure) then
    raise exception 'Garde de fin : valider_exercice n''est plus security definer, ou ne prend plus son verrou exclusif avant son réglage.';
  end if;
end
$fin$;
