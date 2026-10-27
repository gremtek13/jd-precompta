-- « VENTES » NE SE PORTE QUE SUR UN DOSSIER BASCULÉ (chantier EC-Q3, ligne 28.65, étape VF8f, le resserrement). La
-- conception : HISTORIQUE.md, « VF8, LA BASCULE : LA CONCEPTION », § 3 (f), § 5 (la puce VF8f), § 7 et § 8 ; le récit :
-- « « VENTES » NE SE PORTE QUE SUR UN DOSSIER BASCULÉ ».
--
-- POURQUOI. Le droit « Ventes » d'un accès client (`memberships.droit_ventes`) ouvre au client ses ventes et leurs gestes ;
-- dans un dossier dont les factures sont la source de leurs ventes (`dossiers.ventes_par_les_factures`), celles qu'il valide
-- comptent elles-mêmes dans la comptabilité, sans visa (EC3-Q5). La décision EC3-Q2 réserve ce droit aux dossiers qui ont
-- basculé. Rien ne le tenait en base : `changer_droits_acces` posait « Ventes » sans regarder le réglage, et la policy
-- d'insertion de `memberships` (`admin_du_dossier`) laisse le cabinet insérer un accès qui le porte ; seul l'onglet Accès
-- le refusait, avant le clic (étape VF8d). Et la garde du réglage (étape VF8a), qui refuse de le baisser tant qu'un accès
-- porte « Ventes », ne voyait pas l'accès qui reçoit « Ventes » pendant qu'on le baisse.
--
-- CE QU'ELLE POSE :
--   (a) UNE GARDE, `garder_droit_ventes` : « Ventes » qui ARRIVE sur un accès — porté à son insertion, coché sur un accès
--       qui ne le portait pas, ou emporté vers un autre dossier — se refuse, en 23514, quand les factures de ce dossier ne
--       sont pas la source de leurs ventes ; pour tout auteur : le cabinet par la fonction ou par une insertion directe, le
--       super-administrateur par la fonction, le propriétaire, le rôle des Edge Functions. Seule passe l'INSERTION du
--       super-administrateur : la restauration rend ce qui a été — un accès « Ventes » d'une sauvegarde d'avant ce
--       resserrement, sur un dossier qui n'a pas basculé, que l'onglet Accès dira décochable ; sa mise à jour, non.
--       Décocher « Ventes », ou changer « Banque » d'un accès qui porte déjà « Ventes » sur son dossier, ne se juge pas.
--   (b) SON DÉCLENCHEUR, `memberships_droit_ventes`, APRÈS l'insertion et la mise à jour de `droit_ventes` ou de
--       `dossier_id`, ligne par ligne.
--   Et les commentaires de la colonne et de la garde.
--
-- APRÈS LA RLS, AUX DROITS DU PROPRIÉTAIRE. Une garde AVANT l'insertion passerait avant la policy d'insertion : aux droits
-- du propriétaire, elle dirait à n'importe quel compte, l'anonyme compris, si le dossier qu'il nomme a basculé ; à ceux de
-- l'appelant, elle ne verrait pas le dossier qu'il n'a pas le droit de verrouiller, et son refus prendrait la place de
-- celui de la policy (42501). Après l'écriture, la policy a déjà jugé : la garde ne voit que ce que le cabinet du dossier,
-- le super-administrateur, le propriétaire ou le rôle des Edge Functions écrivent, et lit le réglage quel que soit
-- l'appelant (`security definer`, chemin fixé) ; aucun rôle de l'API ne l'exécute. Une mise à jour ne voit que les lignes
-- que la RLS laisse voir, et `memberships` n'a aucune policy de mise à jour : seuls `changer_droits_acces`, le propriétaire
-- et le rôle des Edge Functions en mettent à jour. La clé étrangère du dossier passe avant elle (l'ordre des noms des
-- déclencheurs) : un dossier qui n'existe pas se dit 23503, comme hier.
--
-- LA CONCURRENCE. Le réglage se lit `for share` : une baisse du réglage déjà engagée se termine d'abord, et l'accès se
-- refuse ; une baisse qui suit attend la fin de l'écriture de l'accès, puis la garde du réglage — qui juge après avoir
-- verrouillé la ligne du dossier — le voit et refuse. La course que VF8a laissait ouverte se ferme ainsi.
--
-- CE QUI NE CHANGE PAS : `changer_droits_acces` (son contrôle d'accès, ses refus et leur ordre ; la garde parle après
-- elle) ; les trois policies de `memberships` ; la garde du réglage et son déclencheur ; `create-client-access`, dont
-- l'insertion ne nomme aucun droit. Aucune table, colonne, contrainte, policy ni droit d'une table ; aucune donnée.
--
-- NEUTRE EN PRODUCTION (relevé le 27/10/2026, des comptes) : trois accès, aucun ne porte « Ventes » ; quatre dossiers,
-- aucun n'a basculé. La garde de tête refuse de s'appliquer sur une base où un accès porterait « Ventes » sur un dossier qui
-- n'a pas basculé : le choix — basculer ce dossier, ou décocher cet accès — revient au cabinet, jamais une case retirée en
-- silence.
--
-- CE QUI CONTOURNE LA RLS : la garde, qui lit le réglage du dossier de l'accès et le verrouille en partage. Elle ne rend
-- rien que son refus, à qui la policy a déjà laissé écrire.
--
-- CE QUE LE TEXTE RETIRE : rien. Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose ══════════

do $$
declare
  v_n bigint;
begin
  -- Une seconde application se refuse : la garde ou son déclencheur existent déjà.
  if to_regprocedure('public.garder_droit_ventes()') is not null
     or exists (select 1 from pg_trigger t
                 where t.tgrelid = 'public.memberships'::regclass and t.tgname = 'memberships_droit_ventes') then
    raise exception 'La garde du droit « Ventes » (garder_droit_ventes) est déjà en base : cette migration ne s''applique pas deux fois.';
  end if;
  -- Les fonctions qu'elle suppose, au caractère près (les retours chariot d'un collage écartés) : la garde du réglage, son
  -- pendant, qui lit les accès « Ventes » après avoir verrouillé la ligne du dossier (migration `reglage_des_ventes`) ;
  -- `is_super_admin`, qui porte l'exception de la restauration ; `changer_droits_acces`, la seule écriture des droits, dont
  -- elle change ce qu'elle accepte et que l'onglet Accès redit. Une fonction changée depuis ne se suppose pas sans être
  -- relue.
  if to_regprocedure('public.garder_ventes_par_les_factures()') is null
     or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.garder_ventes_par_les_factures()')),
                    chr(13), '')) <> '2d532a70450d43a85c8ab1fedf8a6c14' then
    raise exception 'La fonction public.garder_ventes_par_les_factures() en base n''est plus celle de la migration reglage_des_ventes : cette migration ne s''applique pas sans être relue.';
  end if;
  if to_regprocedure('public.is_super_admin()') is null
     or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.is_super_admin()')),
                    chr(13), '')) <> 'a9159138778422a43ba8d8c21240c9bb' then
    raise exception 'La fonction public.is_super_admin() en base n''est plus celle que cette migration suppose : elle ne s''applique pas sans être relue.';
  end if;
  if to_regprocedure('public.changer_droits_acces(uuid, boolean, boolean)') is null
     or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.changer_droits_acces(uuid, boolean, boolean)')),
                    chr(13), '')) <> '7ce3d5f0e99a7531cd19940d8fc14831' then
    raise exception 'La fonction public.changer_droits_acces(uuid, boolean, boolean) en base n''est plus celle de la migration droits_des_acces_clients : cette migration ne s''applique pas sans être relue.';
  end if;
  -- Le déclencheur de la garde du réglage, tel que `reglage_des_ventes` l'a posé : avant l'insertion et la mise à jour du
  -- réglage ou de sa date, ligne par ligne (23 : ligne, avant, insertion, mise à jour).
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.dossiers'::regclass and t.tgname = 'dossiers_ventes_par_les_factures'
         and t.tgfoid = 'public.garder_ventes_par_les_factures()'::regprocedure and t.tgtype = 23 and t.tgenabled = 'O'
         and (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
               where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[]))
             = 'ventes_par_les_factures,ventes_par_les_factures_depuis') <> 1 then
    raise exception 'Le déclencheur dossiers_ventes_par_les_factures en base n''est plus celui de la migration reglage_des_ventes : cette migration ne s''applique pas sans être relue.';
  end if;
  -- Aucun accès ne porte déjà « Ventes » sur un dossier dont les factures ne sont pas la source de leurs ventes.
  select count(*) into v_n
    from public.memberships m join public.dossiers d on d.id = m.dossier_id
   where m.droit_ventes and not d.ventes_par_les_factures;
  if v_n > 0 then
    raise exception '% accès client porte(nt) le droit « Ventes » sur un dossier dont les factures ne sont pas la source de leurs ventes : basculer ce dossier ou décocher cet accès, sur la décision du cabinet, avant cette migration.', v_n;
  end if;
end
$$;

-- ══ (a) La garde ══════════

create function public.garder_droit_ventes() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bascule boolean;
begin
  -- Seul « Ventes » qui ARRIVE sur un accès se juge : porté à son insertion, coché sur un accès qui ne le portait pas, ou
  -- emporté vers un autre dossier. Décocher, ou changer « Banque » d'un accès qui le porte déjà sur son dossier, passe.
  if not new.droit_ventes then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.droit_ventes and new.dossier_id = old.dossier_id then
    return null;
  end if;
  -- La restauration : le super-administrateur réinsère un accès tel qu'il a été, sa case comprise. Sa mise à jour, non.
  if tg_op = 'INSERT' and public.is_super_admin() then
    return null;
  end if;
  -- Le réglage du dossier, verrouillé en partage jusqu'à la fin de cette écriture : une baisse déjà engagée se lit ici, une
  -- baisse qui suit attend, puis voit cet accès (garder_ventes_par_les_factures). Un dossier introuvable ne vaut pas un
  -- dossier basculé.
  select d.ventes_par_les_factures into v_bascule from public.dossiers d where d.id = new.dossier_id for share;
  if v_bascule is not true then
    raise exception 'Le droit « Ventes » suppose que les factures de ce dossier soient la source de leurs ventes, ce qu''elles ne sont pas : changer d''abord la source des ventes du dossier.'
      using errcode = '23514';
  end if;
  return null;
end
$$;

comment on function public.garder_droit_ventes() is
  'Le droit « Ventes » ne se porte que sur un accès d''un dossier dont les factures sont la source de leurs ventes (EC3-Q2, étape VF8f) : porté à l''insertion, coché ou emporté vers un autre dossier, il se refuse ailleurs (23514), pour tout auteur ; seule l''insertion du super-administrateur passe (la restauration). Le réglage du dossier se lit for share. Après la RLS, aux droits du propriétaire ; aucun rôle de l''API ne l''exécute.';

revoke execute on function public.garder_droit_ventes() from public, anon, authenticated;

comment on column public.memberships.droit_ventes is
  'Le droit « Ventes » de cet accès (devis, factures, facture électronique), posé par le cabinet par changer_droits_acces, faux par défaut (espace client, étape P1, 09/10/2026) ; il ne se porte que sur un accès d''un dossier dont les factures sont la source de leurs ventes (garder_droit_ventes, étape VF8f), hors de la restauration du super-administrateur.';

-- ══ (b) Son déclencheur ══════════

create trigger memberships_droit_ventes
  after insert or update of droit_ventes, dossier_id on public.memberships
  for each row execute function public.garder_droit_ventes();
