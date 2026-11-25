-- EL7 : LA CONTRE-PASSATION D'UNE ÉCRITURE LIBRE VALIDÉE, D'UN GESTE, DANS UN EXERCICE OUVERT — PRÉPARÉE le 24/11/2026, PAS
-- APPLIQUÉE. Elle ne retire rien : une colonne, trois contraintes, un déclencheur et deux fonctions s'ajoutent à la migration
-- `ecritures_libres` (EL2, en production depuis le 23/11/2026, 250) ; aucune ligne, aucune colonne ni aucun objet ne se retire
-- ni ne change. Son texte ne porte aucune instruction de suppression (ni `delete from`, ni `drop`, ni `truncate` ; le mot d'un
-- déclencheur, `or delete on`, n'en est pas une) : l'outil (`apply_migration`) peut l'appliquer.
--
-- La conception : docs/conceptions/54-ecriture-libre-de-l-expert-comptable.md, § 3.1 (`contre_passe_id`), § 3.7, § 6 et le lot
-- EL7 du § 7. Le module que la base redit : src/lib/contrePassationDesEcrituresLibres.ts, ses refus sous les mêmes mots, aux
-- mêmes codes, dans le même ordre ; src/lib/contrePassationEnBase.test.ts les confronte au texte de cette migration. Son retour :
-- supabase/preparees/retour/20261124120100_retour_contre_passation_des_ecritures_libres.sql. Son essai :
-- supabase/essais/contrePassationDesEcrituresLibres.sql (une réplique seulement, une transaction qui s'annule) ; ce qui contourne
-- la RLS se rejoue aussi par le bloc CP de supabase/essais/rls.sql.
--
-- SOURCES. PCG (règlement ANC n° 2014-03, numérotation du 1er janvier 2026), art. 1031-3 (la validation interdit toute
-- modification ou suppression d'une écriture), 122-6 (une correction d'erreur passe au résultat de l'exercice où elle est
-- constatée) et 1031-4 (l'opération d'une période close s'enregistre au premier jour de la période non close) ;
-- BOI-BIC-DECLA-30-10-20-40 (un exercice clos ne se rouvre pas). Cités par la conception (§ 2, § 6), non relus ce jour.
--
-- « VALIDÉE », ICI : une écriture libre n'a pas de statut à elle ; elle se valide AVEC SON EXERCICE (conception, § 3.7, § 6) —
-- sa date au plus tard à la frontière de la validation (`frontiere_validation`, le 31 décembre du dernier exercice validé), ou
-- une de ses lignes au brouillon validée. C'est le gel que `enregistrer_ecriture_libre` et `retirer_ecriture_libre` lisent déjà :
-- elle ne se remplace ni ne se retire plus (23514). Après, elle se CONTRE-PASSE.
--
-- CE QU'ELLE POSE :
--   1. `ecritures_libres.contre_passe_id` : l'écriture libre qu'une écriture libre contre-passe — de son dossier, figée dans un
--      exercice validé ; une seule contre-passation par écriture (une contrainte TOTALE, les nuls distincts) ; jamais d'extourne
--      sur une contre-passation.
--   2. `contre_passer_ecriture_libre(p_id, p_version_lue, p_contre_passation, p_ecritures)` : d'un seul tenant, l'accès vérifié
--      avant toute autre lecture (`admin_du_dossier`, EL-Q1 : tout compte du cabinet qui suit le dossier), le verrou PARTAGÉ de
--      la validation, l'écriture à la version lue ; elle écrit une écriture libre NEUVE à une date d'un exercice ouvert, qui cite
--      l'écriture d'origine et porte ses lignes au sens inverse — le même compte, le même montant, le même libellé de compte ; le
--      poste de la 2035 de chaque ligne, ou nul quand elle se passe hors de la 2035 (le choix du cabinet, sans défaut) ; un
--      libellé et un MOTIF obligatoires ; son numéro dans son année, sa version 1, son auteur posé par la base. Ses lignes au
--      brouillon, recomposées en entiers, se comparent en MULTIENSEMBLE à celles que l'application propose (le patron d'EL2).
--   3. La garde de la colonne (`garder_contre_passation_des_ecritures_libres`) : une contre-passation ne s'écrit que par sa
--      fonction, la réinsertion du super-administrateur exceptée (la restauration, qui réinsère par vagues : l'écriture d'origine
--      d'abord) ; elle cite une écriture libre de son dossier ; elle ne se remplace pas (`enregistrer_ecriture_libre` la refuse
--      donc) ; et une écriture contre-passée ne change ni ne se retire plus tant que sa contre-passation la cite. Le départ du
--      dossier l'emporte.
--   4. LE RETRAIT d'une contre-passation dont l'exercice est encore ouvert : `retirer_ecriture_libre`, telle qu'elle est — une
--      contre-passation est une écriture libre ; l'écriture d'origine redevient à contre-passer. Figée, une contre-passation se
--      contre-passe à son tour.
--
-- CE QU'ELLE NE FAIT PAS : `enregistrer_ecriture_libre` et `retirer_ecriture_libre` ne sont pas remplacées (la garde de tête
-- vérifie leur corps) ; la 2035, le FEC, la piste d'audit et l'état des écritures libres lisent une contre-passation comme une
-- écriture libre ordinaire, sans changement (contrePassationDansLesMoteurs.test.ts) ; l'effet fiscal sur la 2035 d'un exercice
-- validé reste hors d'ici (l'opération découverte après coup, B9, conception § 6). Une écriture extournée au 1er janvier
-- suivant ne se contre-passe pas : son extourne la défait déjà.
--
-- LE SOCLE ET L'INVENTAIRE, LE JOUR DE L'APPLICATION (relevés le 24/11/2026 sur une copie de `replique_227` portée à la production
-- du jour, 250) : `ecritures_libres` n'est pas une table du socle, et le brouillon n'est pas touché — le socle reste 84
-- instructions, `e54200f4…`. L'inventaire compte sept objets de plus (3 468 `4a6d01f1…`, puis 3 475 `d2c8a451…`) : la
-- colonne, ses trois contraintes (la clé étrangère, l'unicité, la contre-passation sans extourne), le déclencheur et les deux
-- fonctions ; l'index de l'unicité porte sa contrainte.

do $garde$
declare
  v_f text;
begin
  if to_regclass('public.ecritures_libres') is null
     or to_regprocedure('public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer)') is null
     or to_regprocedure('public.retirer_ecriture_libre(uuid, integer)') is null then
    raise exception 'contre_passation_des_ecritures_libres : la migration ecritures_libres (EL2) manque : relire la base.';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_libres'::regclass
               and a.attname = 'contre_passe_id' and not a.attisdropped)
     or to_regprocedure('public.contre_passer_ecriture_libre(uuid, integer, jsonb, jsonb)') is not null then
    raise exception 'La migration contre_passation_des_ecritures_libres est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  -- La porte d'accès devant les gardes, posée en clair sur la table par EL2 : la garde neuve est derrière elle.
  if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.ecritures_libres'::regclass and t.tgname = '_acces_avant_les_gardes') then
    raise exception 'contre_passation_des_ecritures_libres : la porte d''accès de la table des écritures libres manque : relire la base.';
  end if;
  -- Les fonctions qu'elle appelle, et celles dont elle suit le chemin (les deux gardes d'EL2, son enregistrement et son retrait),
  -- à l'empreinte de leur corps (les retours chariot écartés), relevées le 24/11/2026 sur une copie de la réplique portée à la
  -- production du jour (250).
  for v_f in select x.f from (values
      ('admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('cle_validation(uuid)', 'bcbb03363036aa6aa037c0b829e3382f'),
      ('frontiere_validation(uuid)', '24a04846471ec5e8cdbae6f3b9f4a2e8'),
      ('retour_declencheur(text, anyelement, anyelement)', 'bc80cac6efe46d15f86d1820eb56c47e'),
      ('ecriture_libre_entier(jsonb)', '1fe9e402f3aa49b740b891d618e26998'),
      ('ecriture_libre_rogne(text)', 'd41e3956c932aa58c874f941a6c3d501'),
      ('garder_ecritures_libres()', '42b91e0d28145fde3b96e17fc91bd2b5'),
      ('garder_ecriture_libre_du_brouillon()', '05a964e3823b1764a53a905e5aef1f5f'),
      ('enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer)', 'e97ff25376c772cc6743232988eb131a'),
      ('retirer_ecriture_libre(uuid, integer)', 'c8353f14d90d648fa36144019762ac3e')) as x(f, empreinte)
    where (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p where p.oid = to_regprocedure('public.' || x.f))
          is distinct from x.empreinte
  loop
    raise exception 'La fonction % n''est plus celle que cette migration appelle : relire la migration contre la base avant de l''appliquer.', v_f;
  end loop;
end
$garde$;

-- ══ 1. La colonne ══
-- Sans action à la suppression : une écriture contre-passée ne part pas avant sa contre-passation (la garde le dit en clair) ;
-- les deux partent ensemble avec leur dossier.
alter table public.ecritures_libres add column contre_passe_id uuid
  constraint ecritures_libres_contre_passe_id_fkey references public.ecritures_libres(id);
-- Une seule contre-passation par écriture : une contrainte TOTALE (les nuls distincts), que l'index sert aussi à lire.
alter table public.ecritures_libres add constraint ecritures_libres_une_contre_passation unique (contre_passe_id);
-- Une contre-passation n'a pas d'extourne : elle défait une écriture figée, elle ne se défait pas elle-même au 1er janvier.
alter table public.ecritures_libres add constraint ecritures_libres_contre_passation_sans_extourne
  check (contre_passe_id is null or not avec_extourne);
comment on column public.ecritures_libres.contre_passe_id is
  'EL7 (conception 54, § 3.7) : l''écriture libre que celle-ci contre-passe — de son dossier, figée dans un exercice validé, ses lignes portées au sens inverse ; une seule par écriture. Posée par contre_passer_ecriture_libre seule, la réinsertion du super-administrateur exceptée.';

-- ══ 2. La garde de la colonne ══
-- Une contre-passation ne s'écrit que par sa fonction (le réglage local `jd.contre_passation`, qu'elle pose sur son dossier) ou
-- par la réinsertion du super-administrateur (la restauration) ; elle cite une écriture libre de son dossier, déjà écrite ; elle
-- ne se remplace pas ; une écriture qu'elle cite ne change ni ne se retire plus. Le départ du dossier l'emporte. Elle tire après
-- la garde de la table (`ecritures_libres_garde`, l'ordre des noms) : le chemin et le gel d'EL2 se disent d'abord.
create function public.garder_contre_passation_des_ecritures_libres() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return old;
  end if;
  if tg_op = 'INSERT' and new.contre_passe_id is not null then
    if coalesce(current_setting('jd.contre_passation', true), '') is distinct from new.dossier_id::text
       and not public.is_super_admin() then
      raise exception 'Une contre-passation ne s’écrit que par contre_passer_ecriture_libre.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.ecritures_libres e where e.id = new.contre_passe_id and e.dossier_id = new.dossier_id) then
      raise exception 'Une contre-passation cite une écriture libre de son dossier.' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and (old.contre_passe_id is not null or new.contre_passe_id is not null) then
    raise exception 'Une contre-passation ne se remplace pas : la retirer, puis contre-passer de nouveau.' using errcode = '23514';
  end if;
  if tg_op <> 'INSERT' and exists (select 1 from public.ecritures_libres c where c.contre_passe_id = old.id) then
    raise exception 'Cette écriture libre est contre-passée : elle ne change ni ne se retire plus tant que sa contre-passation la cite.'
      using errcode = '23514';
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;
create trigger ecritures_libres_garde_de_la_contre_passation before insert or update or delete on public.ecritures_libres
  for each row execute function public.garder_contre_passation_des_ecritures_libres();
revoke execute on function public.garder_contre_passation_des_ecritures_libres() from public, anon, authenticated;

-- ══ 3. Contre-passer une écriture libre ══
-- p_id : l'écriture contre-passée ; p_version_lue : sa version, telle que l'écran l'a lue ; p_contre_passation : { date, libelle,
-- motif, hors_de_la_2035 } (`contrePassationPourLaBase`) ; p_ecritures : l'écriture que l'application compose
-- (`composerLaContrePassation` : { date, journal, libelle, lignes: [{ compte, sens, centimes }] }). Les refus, dans l'ordre du
-- module : l'accès, la version lue, l'écriture (figée, sans extourne, pas encore contre-passée), la date, l'effet sur la 2035, le
-- libellé, le motif ; puis ceux que la base seule dit : l'écriture d'origine relue, l'écriture proposée. Rend l'identifiant de
-- la contre-passation.
create function public.contre_passer_ecriture_libre(p_id uuid, p_version_lue integer, p_contre_passation jsonb, p_ecritures jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_dossier_id uuid;
  v_mode text;
  v_origine public.ecritures_libres%rowtype;
  v_frontiere date;
  v_ouverture date;
  v_texte_date text;
  v_date date;
  v_hors boolean;
  v_libelle text;
  v_motif text;
  v_controle constant text := '[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']';
  v_l jsonb;
  v_compte text;
  v_sens text;
  v_centimes bigint;
  v_poste text;
  v_lignes jsonb := '[]'::jsonb;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_proposee jsonb;
  v_conforme boolean;
  v_numero integer;
  v_id uuid;
  v_desequilibre integer;
begin
  -- 0. L'accès, avant toute autre lecture : le dossier de l'écriture, puis `admin_du_dossier` (EL-Q1) ; une écriture inconnue se
  --    refuse de même (rien n'apprend qu'elle existe). Puis le verrou PARTAGÉ de la validation, avant toute lecture du gel.
  select e.dossier_id into v_dossier_id from public.ecritures_libres e where e.id = p_id;
  if p_id is null or v_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(v_dossier_id), false) then
    raise exception 'Accès refusé à cette écriture libre.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_dossier_id));
  select d.mode_comptable into v_mode from public.dossiers d where d.id = v_dossier_id;

  -- 1. L'écriture contre-passée, sous son verrou, à la version lue.
  select * into v_origine from public.ecritures_libres e where e.id = p_id for update;
  if not found or p_version_lue is null or p_version_lue <> v_origine.version then
    raise exception '%', 'Cette écriture libre a changé depuis sa lecture : relire les écritures avant de l’écrire.' using errcode = '40001';
  end if;

  -- 2. Figée dans un exercice validé — sa date au plus tard à la frontière de la validation, ou une de ses lignes validée — ;
  --    sans extourne au 1er janvier suivant ; pas encore contre-passée.
  v_frontiere := public.frontiere_validation(v_dossier_id);
  if not ((v_frontiere is not null and v_origine.date <= v_frontiere)
          or exists (select 1 from public.ecritures_brouillon b where b.ecriture_libre_id = p_id and b.statut <> 'proposee')) then
    raise exception '%', 'Seule une écriture libre d’un exercice validé se contre-passe : avant la validation, elle se modifie ou se retire.'
      using errcode = '23514';
  end if;
  if v_origine.avec_extourne then
    raise exception '%', 'Une écriture extournée au 1er janvier suivant ne se contre-passe pas : son extourne la défait déjà.'
      using errcode = '23514';
  end if;
  if exists (select 1 from public.ecritures_libres c where c.contre_passe_id = p_id) then
    raise exception '%', 'Cette écriture libre a déjà sa contre-passation : une écriture ne se contre-passe qu’une fois.'
      using errcode = '23514';
  end if;

  -- 3. La date, comme celle d'une écriture libre : lisible, dans un exercice ouvert, pas avant l'ouverture, au plus tard le 31
  --    décembre de l'année en cours (lue à Paris). L'écran propose le premier jour de l'exercice ouvert (PCG, art. 1031-4).
  v_texte_date := case when jsonb_typeof(p_contre_passation -> 'date') = 'string' then p_contre_passation ->> 'date' end;
  begin
    if coalesce(v_texte_date, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode = '22007';
    end if;
    v_date := v_texte_date::date;
  exception when others then
    v_date := null;
  end;
  if v_date is null or to_char(v_date, 'YYYY-MM-DD') <> v_texte_date or extract(year from v_date) < 2000
     or extract(year from v_date) > 2100 then
    raise exception '%', 'La date de l’écriture se lit en une date civile, entre 2000 et 2100.' using errcode = '22023';
  end if;
  if v_frontiere is not null and v_date <= v_frontiere then
    raise exception '%', 'Cette date est dans un exercice validé : une écriture libre ne s’y passe plus.' using errcode = '23514';
  end if;
  select min(a.date) into v_ouverture from public.a_nouveaux a where a.dossier_id = v_dossier_id;
  if v_ouverture is not null and v_date < v_ouverture then
    raise exception '%', 'Cette date précède l’ouverture du dossier dans l’application : l’écriture n’y a pas de place.'
      using errcode = '22023';
  end if;
  if extract(year from v_date) > extract(year from (now() at time zone 'Europe/Paris')) then
    raise exception '%', 'Une écriture libre se date au plus tard du 31 décembre de l’année en cours.' using errcode = '22023';
  end if;

  -- 4. L'effet sur la 2035 : hors de la 2035, ou les postes de l'écriture d'origine, au sens inverse — un choix, sans défaut.
  v_hors := case when jsonb_typeof(p_contre_passation -> 'hors_de_la_2035') = 'boolean'
                 then (p_contre_passation ->> 'hors_de_la_2035')::boolean end;
  if v_hors is null then
    raise exception '%', 'L’effet sur la 2035 se choisit : hors de la 2035, ou les postes de l’écriture d’origine, au sens inverse.'
      using errcode = '22023';
  end if;

  -- 5. Le libellé (une ligne, sans caractère de contrôle : il part au FEC), puis le motif (pourquoi elle est contre-passée).
  v_libelle := case when jsonb_typeof(p_contre_passation -> 'libelle') = 'string'
                    then public.ecriture_libre_rogne(p_contre_passation ->> 'libelle') end;
  if v_libelle is null or char_length(v_libelle) < 1 or char_length(v_libelle) > 200 or v_libelle ~ v_controle then
    raise exception '%', 'Le libellé de l’écriture tient en 1 à 200 caractères, sur une ligne : il part au FEC.' using errcode = '22023';
  end if;
  v_motif := case when jsonb_typeof(p_contre_passation -> 'motif') = 'string'
                  then public.ecriture_libre_rogne(p_contre_passation ->> 'motif') end;
  if v_motif is null or char_length(v_motif) < 1 or char_length(v_motif) > 2000 then
    raise exception '%', 'Le motif de l’écriture tient en 1 à 2 000 caractères : il dit pourquoi l’écriture est passée.'
      using errcode = '22023';
  end if;

  -- 6. Les lignes de l'écriture d'origine, relues comme la base les écrit, chacune au SENS INVERSE : le même compte, le même
  --    montant, le même libellé de compte ; le poste de la 2035 de la ligne, ou nul hors de la 2035. Équilibrées par construction.
  if jsonb_typeof(v_origine.lignes) is distinct from 'array' then
    raise exception '%', 'L’écriture d’origine ne se relit pas comme la base l’écrit : elle ne se contre-passe pas.' using errcode = '23514';
  end if;
  for v_l in select l.v from jsonb_array_elements(v_origine.lignes) with ordinality as l(v, r) order by l.r loop
    v_compte := case when jsonb_typeof(v_l -> 'compte') = 'string' then v_l ->> 'compte' end;
    v_sens := case when jsonb_typeof(v_l -> 'sens') = 'string' then v_l ->> 'sens' end;
    v_centimes := public.ecriture_libre_entier(v_l -> 'centimes');
    v_poste := case when jsonb_typeof(v_l -> 'poste_2035') = 'string' then v_l ->> 'poste_2035' end;
    if v_compte is null or v_compte !~ '^[1-7][0-9]{5,9}$' or v_sens is null or v_sens not in ('debit', 'credit')
       or v_centimes is null or v_centimes <= 0
       or coalesce(jsonb_typeof(v_l -> 'poste_2035'), 'null') not in ('null', 'string')
       or coalesce(jsonb_typeof(v_l -> 'compte_lib'), 'null') not in ('null', 'string')
       or (v_poste is not null and (v_mode is distinct from 'tresorerie' or left(v_compte, 1) not in ('6', '7'))) then
      raise exception '%', 'L’écriture d’origine ne se relit pas comme la base l’écrit : elle ne se contre-passe pas.' using errcode = '23514';
    end if;
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', v_compte,
      'sens', case v_sens when 'debit' then 'credit' else 'debit' end, 'centimes', v_centimes,
      'poste_2035', case when v_hors then null else v_poste end,
      'compte_lib', case when jsonb_typeof(v_l -> 'compte_lib') = 'string' then v_l ->> 'compte_lib' end));
    if v_sens = 'debit' then v_debit := v_debit + v_centimes; else v_credit := v_credit + v_centimes; end if;
  end loop;
  if jsonb_array_length(v_lignes) < 2 or v_debit = 0 or v_credit = 0 or v_debit <> v_credit then
    raise exception '%', 'L’écriture d’origine ne se relit pas comme la base l’écrit : elle ne se contre-passe pas.' using errcode = '23514';
  end if;

  -- 7. L'écriture que l'application propose : une seule, à sa date, au journal OD, sous le libellé ; ses lignes recomposées en
  --    entiers et comparées en MULTIENSEMBLE (compte, sens, centimes) à celles que la base vient de composer.
  v_proposee := case when jsonb_typeof(p_ecritures) = 'array' then p_ecritures else '[]'::jsonb end;
  v_conforme := (select count(*) from jsonb_array_elements(v_proposee)) = 1
    and jsonb_typeof(v_proposee -> 0) = 'object'
    and v_proposee -> 0 ->> 'journal' = 'OD'
    and v_proposee -> 0 ->> 'date' = to_char(v_date, 'YYYY-MM-DD')
    and v_proposee -> 0 ->> 'libelle' = v_libelle;
  if coalesce(v_conforme, false) then
    with recues as (
      select l.v ->> 'compte' as compte, l.v ->> 'sens' as sens, public.ecriture_libre_entier(l.v -> 'centimes') as centimes
        from jsonb_array_elements(case when jsonb_typeof(v_proposee -> 0 -> 'lignes') = 'array' then v_proposee -> 0 -> 'lignes'
                                       else '[]'::jsonb end) l(v)
    ), attendues as (
      select a.v ->> 'compte' as compte, a.v ->> 'sens' as sens, (a.v ->> 'centimes')::bigint as centimes
        from jsonb_array_elements(v_lignes) a(v)
    )
    select (select count(*) from recues) = (select count(*) from attendues)
       and not exists (select compte, sens, centimes from attendues except all select compte, sens, centimes from recues)
      into v_conforme;
  end if;
  if not coalesce(v_conforme, false) then
    raise exception '%', 'Les écritures proposées ne sont pas celles de l’écriture libre : les recomposer.' using errcode = '22023';
  end if;

  -- 8. Le numéro : le suivant de son dossier et de son année, sous le verrou des numéros d'`enregistrer_ecriture_libre`.
  perform pg_advisory_xact_lock(hashtextextended('ecritures_libres:' || v_dossier_id::text, 0));
  select coalesce(max(e.numero), 0) + 1 into v_numero from public.ecritures_libres e
   where e.dossier_id = v_dossier_id and e.exercice = extract(year from v_date)::integer;

  -- 9. La contre-passation, puis ses lignes au brouillon, par les portes que les gardes ouvrent à ce dossier seul.
  perform set_config('jd.ecriture_libre', v_dossier_id::text, true);
  perform set_config('jd.contre_passation', v_dossier_id::text, true);
  insert into public.ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, avec_extourne, piece_citee_id,
                                       contre_passe_id, version, cree_par)
  values (v_dossier_id, extract(year from v_date)::integer, v_numero, v_date, v_libelle, v_motif, v_lignes, false, null,
          p_id, 1, auth.uid())
  returning id into v_id;
  insert into public.ecritures_brouillon (dossier_id, ecriture_libre_id, date, compte, libelle, montant, sens, statut)
  select v_dossier_id, v_id, v_date, a.v ->> 'compte', v_libelle, round(((a.v ->> 'centimes')::numeric) / 100, 2), a.v ->> 'sens',
         'proposee'
    from jsonb_array_elements(v_lignes) with ordinality as a(v, rang) order by a.rang;
  select count(*) into v_desequilibre from (
    select b.date from public.ecritures_brouillon b where b.ecriture_libre_id = v_id
     group by b.date having sum(case when b.sens = 'debit' then b.montant else -b.montant end) <> 0) x;
  if v_desequilibre > 0 then
    raise exception 'Écriture libre déséquilibrée.' using errcode = '23514';
  end if;
  perform set_config('jd.contre_passation', '', true);
  perform set_config('jd.ecriture_libre', '', true);
  return v_id;
end
$fonction$;
revoke execute on function public.contre_passer_ecriture_libre(uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.contre_passer_ecriture_libre(uuid, integer, jsonb, jsonb) to authenticated;
comment on function public.contre_passer_ecriture_libre(uuid, integer, jsonb, jsonb) is
  'EL7 (conception 54) : contre-passe une écriture libre figée dans un exercice validé, d''un seul tenant — une écriture libre neuve, à une date d''un exercice ouvert, qui la cite et porte ses lignes au sens inverse (leurs postes de la 2035, ou hors de la 2035), un motif obligatoire. Tout compte du cabinet qui suit le dossier (EL-Q1).';
