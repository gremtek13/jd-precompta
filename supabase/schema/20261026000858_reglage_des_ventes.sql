-- LE RÉGLAGE DE LA SOURCE DES VENTES, GARDÉ (chantier EC-Q3, ligne 28.65, étape VF8a). La conception : HISTORIQUE.md,
-- « VF8, LA BASCULE : LA CONCEPTION », § 3 (a), § 5 (la puce VF8a), § 6 (VF8-Q1) et § 7 ; le récit : « LE RÉGLAGE DES
-- VENTES, GARDÉ ».
--
-- POURQUOI. Le réglage `dossiers.ventes_par_les_factures` (étape VF2) dit que les factures validées d'un dossier sont la
-- source de leurs ventes ; il ne se défait plus dès la première facture source (EC3-Q1). Jusqu'ici, tout membre de
-- l'équipe assigné au dossier pouvait le poser par une écriture directe (la policy `dossiers_update`, `admin_du_dossier`),
-- rien ne datait la bascule, et rien ne le retenait quand un accès client porte « Ventes » : la case aurait survécu à son
-- dossier. Or la bascule engage la tenue du dossier, comme la validation d'un exercice, que seul le chef du cabinet fait
-- (décision du cabinet du 04/10/2026, `valider_exercice`).
--
-- LA DÉCISION SUIVIE. VF8-Q1, pas encore tranchée par le cabinet, écrite sur sa recommandation : quand l'écriture vient
-- d'une session, le chef du cabinet seul pose ou baisse le réglage — et le super-administrateur, que
-- `est_chef_du_cabinet` inclut — ; un membre de l'équipe assigné au dossier ne le peut plus. LA CONDITION QUI PORTE
-- VF8-Q1 est `public.est_chef_du_cabinet(old.cabinet_id)`, au rang 2 de la garde : « tout membre assigné au dossier » la
-- remplace par `public.admin_du_dossier(old.id)`, et rien d'autre ne change.
--
-- CE QU'ELLE POSE :
--   (a) LA COLONNE `dossiers.ventes_par_les_factures_depuis` (un instant, nul par défaut) : depuis quand les factures du
--       dossier sont la source de leurs ventes. La garde la pose quand le réglage monte, l'efface quand il descend, la
--       garde telle qu'elle est quand il ne change pas : aucune écriture ne la pose à sa place, hors de la restauration
--       (l'insertion du super-administrateur), qui la réinsère telle qu'elle a été. L'auteur de la bascule n'est pas
--       gardé : le client lit la ligne de son dossier, et qui a fait quoi relève d'un journal du cabinet (P1-trace).
--   (b) LA GARDE DU RÉGLAGE, `garder_ventes_par_les_factures`, REMPLACÉE — celle de la migration `source_de_la_vente`,
--       dont les lignes sont une sous-suite de la nouvelle. Pour une mise à jour, dans cet ordre :
--         1. le réglage baissé quand une facture source existe : le refus d'hier, au caractère près, le premier — pour
--            tout auteur, le propriétaire compris (23514) ;
--         2. le réglage posé ou baissé par une session (`auth.uid()` connu) qui n'est ni le chef du cabinet du dossier ni
--            le super-administrateur (42501) ; sans session — le propriétaire, le rôle des Edge Functions, qui écrivent
--            hors de la RLS —, rien ne se juge ici, comme sous une policy ;
--         3. le réglage baissé quand un accès client du dossier porte « Ventes » — pour tout auteur (23514) ;
--       puis la date. Du plus définitif au plus réparable : ce qui ne se défait pas, qui le change, ce qui se retire
--       d'abord. À l'insertion, rien ne se refuse — la policy `dossiers_write` réserve déjà la création d'un dossier au
--       chef du cabinet — : la date suit le réglage, sauf pour le super-administrateur, qui la réinsère telle quelle.
--   (c) SON DÉCLENCHEUR, ÉTENDU (`create or replace trigger`, sous son nom) : à l'insertion, et à la mise à jour de la
--       colonne neuve, pour qu'aucune écriture ne la pose sans passer la garde. Sur `dossiers`, il suit
--       `dossiers_set_cabinet_id` (l'ordre des noms) : à l'insertion, le cabinet est déjà posé.
--   Et les commentaires du réglage, de la colonne et de la garde.
--
-- CE QUI NE CHANGE PAS : la policy `dossiers_update` (un membre assigné écrit toujours le reste du dossier) ; la
-- validation d'une facture, qui lit le réglage `for share` (`fixer_source_de_la_vente`) ; `changer_droits_acces`, qui
-- pose « Ventes » sans regarder le réglage (le resserrement est l'étape VF8f). Aucune policy, aucune contrainte, aucune
-- donnée : un dossier qui aurait basculé avant cette migration garde une date nulle — inconnue.
--
-- NEUTRE EN PRODUCTION (relevé le 25/10/2026, des comptes) : quatre dossiers, aucun basculé, aucune facture source, aucun
-- accès « Ventes » ; aucun écran ne pose le réglage. La colonne y naît nulle partout ; la garde n'y refuse rien qu'un écran
-- fasse.
--
-- CE QUI CONTOURNE LA RLS : la garde, comme hier (`security definer`, chemin fixé) : elle lit les factures, le cabinet et
-- les accès du dossier quoi qu'en voie l'appelant ; aucun rôle de l'API ne l'exécute, et personne ne l'appelle en RPC.
--
-- CONCURRENCE : une facture qui se valide lit le réglage `for share` — un réglage baissé pendant ce temps attend, puis voit
-- la facture source et se refuse (hier). Un accès qui reçoit « Ventes » pendant qu'on baisse le réglage n'est pas vu de la
-- garde avant son engagement : la garde des accès de l'étape VF8f, qui lira le réglage `for share`, fermera cette course.
--
-- CE QUE LE TEXTE RETIRE : rien. `create or replace` garde l'OID et les droits de la garde, et le déclencheur garde son
-- nom. Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose : la garde et le déclencheur de la source de la vente, tels qu'elle les reprend ══════════

do $$
begin
  -- Le corps que cette migration remplace, au caractère près (les retours chariot d'un collage écartés) : une garde changée
  -- depuis — par une autre migration, ou par une première application de celle-ci — ne se remplace pas sans être relue.
  if to_regprocedure('public.garder_ventes_par_les_factures()') is null
     or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.garder_ventes_par_les_factures()')),
                    chr(13), '')) <> '6d9776e437d00c6d0d68bbfa1f1dda50' then
    raise exception 'La fonction public.garder_ventes_par_les_factures() en base n''est plus celle de la migration source_de_la_vente : cette migration ne la remplace pas sans être relue.';
  end if;
  -- Le déclencheur que cette migration étend : celui de `source_de_la_vente`, avant la mise à jour du seul réglage, ligne
  -- par ligne (19 : ligne, avant, mise à jour ; sa colonne, le numéro du réglage).
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.dossiers'::regclass and t.tgname = 'dossiers_ventes_par_les_factures'
         and t.tgfoid = 'public.garder_ventes_par_les_factures()'::regprocedure and t.tgtype = 19 and t.tgenabled = 'O'
         and t.tgattr::text = (select a.attnum::text from pg_attribute a
                                where a.attrelid = 'public.dossiers'::regclass and a.attname = 'ventes_par_les_factures')) <> 1 then
    raise exception 'Le déclencheur dossiers_ventes_par_les_factures en base n''est plus celui de la migration source_de_la_vente : cette migration ne l''étend pas sans être relue.';
  end if;
end
$$;

-- ══ (a) La date de la bascule ══════════

alter table public.dossiers add column ventes_par_les_factures_depuis timestamptz;

comment on column public.dossiers.ventes_par_les_factures_depuis is
  'Depuis quand les factures validées de ce dossier sont la source de leurs ventes (chantier EC-Q3, étape VF8a) : posé par la garde du réglage (garder_ventes_par_les_factures) quand il monte, effacé quand il descend ; aucune écriture ne le pose à sa place, hors de la restauration du super-administrateur, qui le réinsère tel qu''il a été. Nul tant que le réglage est faux, et pour un dossier qui aurait basculé avant l''étape VF8a.';

comment on column public.dossiers.ventes_par_les_factures is
  'Les factures validées de ce dossier sont-elles la source de leurs ventes (chantier EC-Q3) ? Faux par défaut ; posé ou baissé, depuis une session, par le chef du cabinet seul (VF8-Q1) ; irréversible dès qu''une facture source existe, et retenu tant qu''un accès client du dossier porte « Ventes » (garder_ventes_par_les_factures) ; daté par ventes_par_les_factures_depuis. Chaque facture fige à sa validation ce qu''il valait (factures_emises.source_de_la_vente).';

-- ══ (b) La garde du réglage ══════════

create or replace function public.garder_ventes_par_les_factures() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
begin
  -- À l'insertion, la date suit le réglage, sauf pour la restauration : le super-administrateur réinsère un dossier tel
  -- qu'il a été, sa date comprise. Rien ne s'y refuse : la policy des dossiers réserve leur création au chef du cabinet.
  if tg_op = 'INSERT' then
    if not public.is_super_admin() then
      new.ventes_par_les_factures_depuis := case when new.ventes_par_les_factures then now() end;
    end if;
    return new;
  end if;
  -- 1. Le refus d'hier, le premier : une facture source existe, le réglage ne se défait pas.
  if old.ventes_par_les_factures and not new.ventes_par_les_factures then
    -- La première facture source validée : une facture avant son avoir, qu'une même transaction validerait au même
    -- instant.
    select f.numero into v_numero from public.factures_emises f
     where f.dossier_id = old.id and f.source_de_la_vente
     order by f.validated_at, f.type = 'avoir', f.numero collate "C", f.id
     limit 1;
    if found then
      raise exception 'Les factures de ce dossier sont la source de leurs ventes depuis la facture % : ce réglage ne se défait pas.', v_numero
        using errcode = '23514';
    end if;
  end if;
  if new.ventes_par_les_factures is distinct from old.ventes_par_les_factures then
    -- 2. Qui le change : depuis une session, le chef du cabinet du dossier ou le super-administrateur. LA CONDITION QUI
    -- PORTE VF8-Q1 : sous « tout membre assigné au dossier », public.admin_du_dossier(old.id) la remplace, elle seule. Sans
    -- session — le propriétaire, le rôle des Edge Functions, qui écrivent hors de la RLS —, rien ne se juge ici.
    if auth.uid() is not null and not public.est_chef_du_cabinet(old.cabinet_id) then
      raise exception 'Seul le chef du cabinet change la source des ventes d''un dossier.' using errcode = '42501';
    end if;
    -- 3. Le droit « Ventes » d'un accès client suppose le réglage : il le retient, sinon la case survivrait à son dossier.
    if old.ventes_par_les_factures
       and exists (select 1 from public.memberships m where m.dossier_id = old.id and m.droit_ventes) then
      raise exception 'Un accès client de ce dossier porte le droit « Ventes », qui suppose que ses factures soient la source de leurs ventes : retirer d''abord ce droit.'
        using errcode = '23514';
    end if;
    -- La date : posée quand le réglage monte, effacée quand il descend.
    new.ventes_par_les_factures_depuis := case when new.ventes_par_les_factures then now() end;
  else
    -- Le réglage ne change pas : sa date non plus, quoi que l'écriture y mette.
    new.ventes_par_les_factures_depuis := old.ventes_par_les_factures_depuis;
  end if;
  return new;
end
$$;

comment on function public.garder_ventes_par_les_factures() is
  'Le réglage ventes_par_les_factures ne se baisse plus dès qu''une facture source de sa vente existe dans le dossier (EC3-Q1), ni tant qu''un accès client du dossier porte « Ventes » ; depuis une session, seul le chef du cabinet ou le super-administrateur le pose ou le baisse (VF8-Q1). La garde date la bascule (ventes_par_les_factures_depuis) ; seule la restauration du super-administrateur réinsère cette date telle qu''elle a été.';

-- ══ (c) Son déclencheur, étendu à l'insertion et à la colonne neuve ══════════

create or replace trigger dossiers_ventes_par_les_factures
  before insert or update of ventes_par_les_factures, ventes_par_les_factures_depuis on public.dossiers
  for each row execute function public.garder_ventes_par_les_factures();
