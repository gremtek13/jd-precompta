-- EXP58-Q1 — LE MODE DE RÈGLEMENT D'UN MOUVEMENT DU RELEVÉ, POSÉ PAR LE CABINET (ligne 26.6, étape e ; MVP-D5 ; décision du
-- cabinet du 17/11/2026, (B) : « une colonne du mouvement, proposée puis corrigée par le cabinet (migration, écran) »).
-- PRÉPARÉE le 17/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 17/11/2026 — EXP58-Q1 : LE MODE DE RÈGLEMENT D'UN
-- MOUVEMENT, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; l'analyse : docs/conceptions/58-reponses-de-l-expert-comptable.md, § 1.1 et
-- 1.2 ; l'essai : supabase/essais/modeDeReglementDesMouvements.sql (EN ATTENTE sans elle) ; le retour :
-- supabase/preparees/retour/20261117193100_retour_mode_de_reglement_des_mouvements.sql ; le module qui redit sa liste et ses
-- refus, et qui PROPOSE le mode : src/lib/modeDeReglement.ts (`MODE_DE_REGLEMENT_PREVU`, baissé jusqu'à l'application).
--
-- LE CAS. Le FEC d'un BNC en trésorerie porte le mode de règlement de chaque écriture (LPF, art. A47 A-1, VIII, 7°,
-- information 20, ModeRglt ; BOI-CF-IOR-60-40-20, § 290 : « chèque, espèces, virement… », littéral ou codifié). L'application
-- écrit « Banque » pour tout mouvement du relevé (FEC22-Q2, (A)) : l'import ne garde du mouvement que sa date, son montant et
-- son libellé. L'expert-comptable veut le type de règlement (FEC22-E3), et la validation d'un exercice FIGE ModeRglt sur ses
-- écritures (`champs_bnc_du_fec`, FEC22b) : le mode doit être juste AVANT la validation de 2025 de la répétition.
--
-- LA LISTE, FERMÉE. Le mode d'un mouvement est l'un des modes de règlement que le FEC connaît déjà (`MODES_REGLEMENT`,
-- src/lib/champsBncDuFec.ts, et la contrainte `ecritures_brouillon_champs_bnc_du_fec` qui les fige), écrit TEL QUE le fichier
-- l'imprime — sans table de codes à tenir, ni de lettres d'un logiciel à deviner — et ceux-là seulement qu'un mouvement du
-- compte peut avoir : « Virement », « Prélèvement », « Carte bancaire » (Code monétaire et financier, art. L. 314-1, II, 3° :
-- les virements, les prélèvements, les opérations de paiement par carte) ; « Chèque » (même code, art. L. 131-1 et suivants) ;
-- « Espèces » (art. L. 314-1, II, 1° et 2° : le versement et le retrait d'espèces sur un compte — le signe du mouvement dit
-- lequel) ; « Effet » (la lettre de change, Code de commerce, art. L. 511-1 et suivants : une LCR domiciliée) ; « Autre » (ce
-- qui n'est rien de cela : des frais que la banque prélève elle-même, des intérêts). Ce sont aussi les moyens du registre des
-- encaissements (`encaissements_factures_moyen`) qu'un mouvement peut porter : la compensation, qui n'en fait passer aucun,
-- n'y est pas. « Banque », « Compte personnel » et « Sans règlement » ne sont pas des modes d'un mouvement : nul, le FEC
-- écrit « Banque », comme hier.
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. `lignes_bancaires.mode_reglement`, `text` NULLABLE sans valeur par défaut : nul sur tout mouvement d'hier et tant que le
--      cabinet n'a rien posé. Une colonne nullable sans défaut s'ajoute au catalogue seul, sans réécrire la table.
--   2. `lignes_bancaires_mode_reglement_liste` : nul, ou l'un des sept modes ci-dessus, au caractère près.
--   3. `poser_modes_de_reglement(dossier, mouvements, modes)`, aux droits du propriétaire, TOUT OU RIEN : deux listes de même
--      longueur, le i-ème mode posé sur le i-ème mouvement, un mode nul retirant celui qui était posé ; la fiche d'un mouvement
--      l'appelle pour un seul, un lot à venir pour plusieurs. Ses refus, dans l'ordre (que src/lib/modeDeReglement.ts redit) :
--      l'appelant qui n'est pas le cabinet qui suit le dossier, jugé AVANT TOUTE LECTURE (42501 ; `admin_du_dossier`, le
--      super-administrateur compris ; AUCUNE BRANCHE CLIENT, un accès « Banque » compris) ; la forme (22023) ; un mouvement
--      hors du dossier (22023) ; un mode hors de la liste (22023). Puis l'écriture, que le figement juge ligne par ligne. Elle
--      rend les mouvements écrits et leur mode.
--   4. `garder_mode_de_reglement`, avant l'écriture, AUX DROITS DE L'APPELANT (elle ne lit aucune table : la porte
--      `_acces_avant_les_gardes` n'a rien à précéder, et elle couvre déjà la table) : le mode ne se pose, ne se corrige et ne
--      se retire QUE par la fonction (le réglage `jd.mode_de_reglement` porte son dossier), jamais par une écriture directe —
--      ni l'import d'un relevé, ni la connexion bancaire, ni le rôle des Edge Functions, qui passe la RLS : la proposition du
--      libellé ne s'écrit jamais sans le clic du cabinet. Un mouvement ne s'insère avec un mode que par la restauration du
--      super-administrateur. Deux déclencheurs, chacun sous sa condition (une insertion qui porte un mode ; une mise à jour qui
--      le change) : l'import d'un relevé et les fonctions du relevé, qui ne le touchent pas, ne l'appellent jamais.
--
-- CE QU'ELLE NE CHANGE PAS : aucune fonction d'hier n'est remplacée, aucune policy ni aucun droit de table, aucune donnée.
-- Le figement : `garder_mouvement_valide` compare la LIGNE ENTIÈRE (`to_jsonb(new) is distinct from to_jsonb(old)`) d'un
-- mouvement daté d'un exercice validé — le mode s'y fige avec le mouvement, sans un mot de plus, aussi pour la fonction, aux
-- droits du propriétaire ; la garde de tête vérifie que ce corps est encore celui-là, la garde de fin que son déclencheur
-- couvre toujours toute mise à jour. Les autres déclencheurs de la table ne se prennent pas à une écriture du seul mode :
-- `garder_mouvement_reserve` ne juge que les colonnes d'un classement, les autres portent leurs colonnes ou leur condition.
-- L'empreinte d'un exercice validé ne lit pas `lignes_bancaires` : ModeRglt y entre par les écritures que la validation fige
-- (FEC22b). La sauvegarde lit la table par `select('*')`, la restauration réinsère ce qu'elle a lu, par le super-administrateur
-- que la garde laisse passer : une sauvegarde d'avant se restaure (le mode nul), une d'après porte le mode. La lecture du
-- client « Banque » est une policy de ligne : elle rend la colonne avec la ligne — un fait de son propre relevé, aucun texte
-- du cabinet — et aucun écran du client ne la montre ; aucun client n'écrit `lignes_bancaires`.
--
-- LE SOCLE, LE JOUR DE L'APPLICATION. `lignes_bancaires` est une table du socle (créée hors migration) :
-- supabase/schema/socle/1_tables_sans_migration.sql se régénère du catalogue (supabase/essais/socle.sql) et change de deux
-- lignes, dans le `create table public.lignes_bancaires` — après `  date_valeur date,`, la ligne
--   `  mode_reglement text,`
-- et, entre `  constraint lignes_bancaires_encaissements_rapproches CHECK (…),` et
-- `  constraint lignes_bancaires_reglement_groupe_rapproche CHECK (…),`, la ligne de la contrainte (son rendu exact, relu par
-- la garde de fin ci-dessous). La fonction, la garde et ses deux déclencheurs sont de cette migration : ils restent dans son
-- fichier. L'inventaire compte six objets de plus (la colonne, la contrainte, les deux fonctions, les deux déclencheurs).
-- Simulés sur une copie de la réplique à 237 (le 17/11/2026) : socle 83 instructions, inventaire 3 228 objets, égaux des deux
-- côtés.
--
-- COMMENT ELLE S'APPLIQUE : aucune instruction de retrait ni de vidage, aucune barre oblique inverse, aucune fonction
-- remplacée — PAR L'OUTIL. Indépendante des autres migrations préparées : aucune ne pose cette colonne, cette contrainte, ces
-- fonctions ni ce réglage, ni ne remplace une fonction que la garde de tête relit (`admin_du_dossier`, `is_super_admin`,
-- `garder_mouvement_valide`) ; celles qui lisent `lignes_bancaires` (MCB5g `ouverture_eclatee_par_compte`, INV3
-- `validation_de_l_inventaire`, NOE5 `association_paiements_assurance_maladie`) n'y écrivent rien. VERSION PROVISOIRE, HORS DE
-- L'EXPORT : le jour de son application, `MODE_DE_REGLEMENT_PREVU` se lève, le fichier entre dans supabase/schema/ sous la
-- version que porte sa ligne d'historique, texte inchangé, et le socle se régénère (ci-dessus).

-- ══ 0. La garde de tête ══════════
do $garde$
declare
  v_attendue record;
  v_empreinte text;
begin
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'mode_reglement' and not a.attisdropped)
     or exists (select 1 from pg_catalog.pg_constraint c where c.conname = 'lignes_bancaires_mode_reglement_liste')
     or exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('poser_modes_de_reglement', 'garder_mode_de_reglement')) then
    raise exception 'EXP58-Q1 : le mode de règlement des mouvements est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if (select format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text from pg_catalog.pg_attribute a
       where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'dossier_id' and not a.attisdropped)
     is distinct from 'uuid true'
     or (select format_type(a.atttypid, a.atttypmod) from pg_catalog.pg_attribute a
          where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'id' and not a.attisdropped)
     is distinct from 'uuid' then
    raise exception 'EXP58-Q1 : l''identifiant ou le dossier d''un mouvement ne sont plus des uuid : la fonction ne les lit plus ainsi.';
  end if;
  -- Les fonctions que la migration appelle, au corps près : un corps changé depuis se relit avant d'appliquer.
  for v_attendue in select * from (values
      ('public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('public.garder_mouvement_valide()', 'f10207e741e52cd7684e2b9e5ccd5328')
    ) as t(signature, empreinte) loop
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_catalog.pg_proc p where p.oid = to_regprocedure(v_attendue.signature);
    if v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'EXP58-Q1 : la fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer.',
        v_attendue.signature, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  -- Le figement d'un mouvement daté d'un exercice validé compare la ligne entière, sur toute mise à jour : le mode s'y fige.
  if (select count(*) from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.lignes_bancaires'::regclass and t.tgname = 'lignes_bancaires_figees_par_la_validation'
         and t.tgfoid = to_regprocedure('public.garder_mouvement_valide()') and t.tgtype = 31 and t.tgattr = ''::int2vector
         and t.tgenabled = 'O' and not t.tgisinternal) <> 1 then
    raise exception 'EXP58-Q1 : le figement d''un mouvement validé ne couvre plus toute mise à jour : relire le figement avant d''appliquer.';
  end if;
end
$garde$;

-- ══ 1. La colonne ══════════
alter table public.lignes_bancaires add column mode_reglement text;

comment on column public.lignes_bancaires.mode_reglement is
  'Le mode de règlement du mouvement (EXP58-Q1), que le cabinet a posé — proposé par le libellé de la banque, jamais écrit sans son clic : Virement, Prélèvement, Carte bancaire, Chèque, Espèces, Effet ou Autre ; nul tant que rien n''est posé (le FEC écrit alors « Banque »). Écrit par poser_modes_de_reglement seule (la restauration exceptée) ; figé avec le mouvement par la validation de son exercice.';

-- ══ 2. La liste fermée ══════════
alter table public.lignes_bancaires add constraint lignes_bancaires_mode_reglement_liste
  check (mode_reglement is null
         or mode_reglement in ('Virement', 'Prélèvement', 'Carte bancaire', 'Chèque', 'Espèces', 'Effet', 'Autre'));

-- ══ 3. La garde : le mode ne s'écrit que par sa fonction ══════════
-- Aux droits de l'appelant : elle ne lit que le réglage de la transaction et `is_super_admin`. Une insertion qui porte un mode
-- n'est que la restauration ; une mise à jour qui le change n'est que la fonction, pour SON dossier.
create function public.garder_mode_de_reglement() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if public.is_super_admin() then
      return new;
    end if;
    raise exception 'Un mouvement ne s''importe pas avec un mode de règlement : le cabinet le pose ensuite, sur la fiche du mouvement.'
      using errcode = '42501';
  end if;
  if coalesce(current_setting('jd.mode_de_reglement', true), '') = old.dossier_id::text then
    return new;
  end if;
  raise exception 'Le mode de règlement d''un mouvement ne se pose, ne se corrige et ne se retire que par sa fonction, sur un clic du cabinet.'
    using errcode = '42501';
end
$$;

comment on function public.garder_mode_de_reglement() is
  'La garde du mode de règlement d''un mouvement (EXP58-Q1) : une insertion qui porte un mode n''est que la restauration du super-administrateur, une mise à jour qui le change n''est que poser_modes_de_reglement pour son dossier (jd.mode_de_reglement) — sinon 42501, aussi pour le rôle des Edge Functions, qui passe la RLS.';

create trigger lignes_bancaires_mode_de_reglement_insere
  before insert on public.lignes_bancaires
  for each row when (new.mode_reglement is not null)
  execute function public.garder_mode_de_reglement();

create trigger lignes_bancaires_mode_de_reglement_change
  before update on public.lignes_bancaires
  for each row when (old.mode_reglement is distinct from new.mode_reglement)
  execute function public.garder_mode_de_reglement();

-- ══ 4. Poser, corriger, retirer ══════════
-- D'UN SEUL TENANT : un refus, ou le figement d'un seul mouvement, et rien n'est écrit. Un IF par étape, dans l'ordre que le
-- module redit. Le réglage ne vaut que pour la transaction, et se remet à vide après l'écriture.
create function public.poser_modes_de_reglement(p_dossier_id uuid, p_lignes uuid[], p_modes text[])
  returns table (ligne_bancaire_id uuid, mode_de_reglement text)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  c_forme constant text := 'Les modes de règlement à poser sont mal formés : autant de mouvements que de modes, chaque mouvement une fois, de 1 à 1 000.';
begin
  -- 0. L'accès, avant toute lecture : le cabinet qui suit le dossier, et le super-administrateur ; aucune branche client.
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  -- 1. La forme : deux listes à une dimension, de même longueur, de 1 à 1 000 mouvements, aucun vide, chacun une fois. Un
  -- mode nul retire celui qui était posé.
  if p_lignes is null or p_modes is null or array_ndims(p_lignes) is distinct from 1 or array_ndims(p_modes) is distinct from 1 then
    raise exception '%', c_forme using errcode = '22023';
  end if;
  if cardinality(p_lignes) not between 1 and 1000 or cardinality(p_modes) <> cardinality(p_lignes) then
    raise exception '%', c_forme using errcode = '22023';
  end if;
  if array_position(p_lignes, null) is not null
     or (select count(distinct x) from unnest(p_lignes) x) <> cardinality(p_lignes) then
    raise exception '%', c_forme using errcode = '22023';
  end if;

  -- 2. Les mouvements du dossier.
  if exists (select 1 from unnest(p_lignes) x
              where not exists (select 1 from public.lignes_bancaires l where l.id = x and l.dossier_id = p_dossier_id)) then
    raise exception 'Un des mouvements n''est pas un mouvement de ce dossier.' using errcode = '22023';
  end if;

  -- 3. La liste fermée, celle de la contrainte : dite ici avec ses mots, avant elle.
  if exists (select 1 from unnest(p_modes) m
              where m is not null
                and m not in ('Virement', 'Prélèvement', 'Carte bancaire', 'Chèque', 'Espèces', 'Effet', 'Autre')) then
    raise exception 'Un mode de règlement n''est pas de la liste : Virement, Prélèvement, Carte bancaire, Chèque, Espèces, Effet ou Autre.'
      using errcode = '22023';
  end if;

  -- 4. L'écriture, sous le réglage que la garde reconnaît ; le figement d'un exercice validé la juge ligne par ligne.
  perform set_config('jd.mode_de_reglement', p_dossier_id::text, true);
  return query
    update public.lignes_bancaires l set mode_reglement = x.choisi
      from unnest(p_lignes, p_modes) as x(ligne, choisi)
     where l.id = x.ligne and l.dossier_id = p_dossier_id
    returning l.id, l.mode_reglement;
  perform set_config('jd.mode_de_reglement', '', true);
end;
$$;

comment on function public.poser_modes_de_reglement(uuid, uuid[], text[]) is
  'Pose, corrige ou retire le mode de règlement de mouvements du relevé (EXP58-Q1), tout ou rien : le i-ème mode sur le i-ème mouvement, un mode nul retirant le sien ; Virement, Prélèvement, Carte bancaire, Chèque, Espèces, Effet ou Autre. Au cabinet du dossier seul, jugé avant toute lecture (42501) ; la forme, un mouvement hors du dossier, un mode hors de la liste (22023) ; un mouvement d''un exercice validé ne change plus (le figement, 23514). Rend les mouvements écrits et leur mode.';

-- ══ 5. Les droits d'exécution ══════════
revoke execute on function public.poser_modes_de_reglement(uuid, uuid[], text[]) from public, anon;
grant execute on function public.poser_modes_de_reglement(uuid, uuid[], text[]) to authenticated;
revoke execute on function public.garder_mode_de_reglement() from public, anon, authenticated;

-- ══ 6. La garde de fin : la colonne, sa liste, la garde et ses deux déclencheurs, la fonction, le figement ══════════
do $fin$
begin
  if (select format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text
        from pg_catalog.pg_attribute a
       where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'mode_reglement' and not a.attisdropped)
     is distinct from 'text false false' then
    raise exception 'EXP58-Q1 : la colonne mode_reglement n''est pas un texte nullable sans défaut : rien n''est appliqué.';
  end if;
  if (select string_agg(pg_catalog.pg_get_constraintdef(c.oid), ' ; ') from pg_catalog.pg_constraint c
       where c.conrelid = 'public.lignes_bancaires'::regclass and c.conname = 'lignes_bancaires_mode_reglement_liste')
     is distinct from 'CHECK (((mode_reglement IS NULL) OR (mode_reglement = ANY (ARRAY[''Virement''::text, ''Prélèvement''::text, ''Carte bancaire''::text, ''Chèque''::text, ''Espèces''::text, ''Effet''::text, ''Autre''::text]))))' then
    raise exception 'EXP58-Q1 : la liste des modes n''est pas celle de cette migration : rien n''est appliqué.';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
       where p.oid = 'public.poser_modes_de_reglement(uuid, uuid[], text[])'::regprocedure
         and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')
         and not has_function_privilege('anon', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) <> 1 then
    raise exception 'EXP58-Q1 : la fonction qui pose les modes n''a pas les droits que la migration pose : rien n''est appliqué.';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
       where p.oid = 'public.garder_mode_de_reglement()'::regprocedure and not p.prosecdef
         and not has_function_privilege('anon', p.oid, 'execute')
         and not has_function_privilege('authenticated', p.oid, 'execute')) <> 1 then
    raise exception 'EXP58-Q1 : la garde du mode s''exécute aux droits du propriétaire, ou un rôle de session l''exécute : rien n''est appliqué.';
  end if;
  if (select string_agg(pg_catalog.pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname) from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.lignes_bancaires'::regclass and not t.tgisinternal
         and t.tgfoid = 'public.garder_mode_de_reglement()'::regprocedure)
     is distinct from 'CREATE TRIGGER lignes_bancaires_mode_de_reglement_change BEFORE UPDATE ON public.lignes_bancaires FOR EACH ROW WHEN ((old.mode_reglement IS DISTINCT FROM new.mode_reglement)) EXECUTE FUNCTION garder_mode_de_reglement() O ; '
                      || 'CREATE TRIGGER lignes_bancaires_mode_de_reglement_insere BEFORE INSERT ON public.lignes_bancaires FOR EACH ROW WHEN ((new.mode_reglement IS NOT NULL)) EXECUTE FUNCTION garder_mode_de_reglement() O' then
    raise exception 'EXP58-Q1 : les deux déclencheurs de la garde du mode ne sont pas ceux de cette migration : rien n''est appliqué.';
  end if;
  -- Le figement tire toujours sur toute mise à jour, avec le corps relu en tête.
  if (select count(*) from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.lignes_bancaires'::regclass and t.tgname = 'lignes_bancaires_figees_par_la_validation'
         and t.tgfoid = to_regprocedure('public.garder_mouvement_valide()') and t.tgtype = 31 and t.tgattr = ''::int2vector
         and t.tgenabled = 'O' and not t.tgisinternal) <> 1
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
          where p.oid = to_regprocedure('public.garder_mouvement_valide()')) is distinct from 'f10207e741e52cd7684e2b9e5ccd5328' then
    raise exception 'EXP58-Q1 : le figement d''un mouvement validé ne couvre plus toute la ligne : rien n''est appliqué.';
  end if;
  if exists (select 1 from public.lignes_bancaires where mode_reglement is not null) then
    raise exception 'EXP58-Q1 : un mouvement porte déjà un mode : rien ne s''écrit d''avance.';
  end if;
end
$fin$;
