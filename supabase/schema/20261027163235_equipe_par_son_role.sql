-- L'ÉQUIPE NE CHANGE PLUS, DEPUIS UNE SESSION, QUE PAR SON RÔLE (23Q2Q2-Q3).
-- Le récit : HISTORIQUE.md, « L'ÉQUIPE NE CHANGE QUE PAR SON RÔLE » ; la question d'origine : « L'ÉQUIPE N'ACCUEILLE PAS
-- LE CLIENT D'UN AUTRE CABINET » (son « trouvé en passant »).
--
-- LA DÉCISION DU CABINET (page des arbitrages, 26/10/2026, à la recommandation) : la mise à jour de `cabinet_admins`
-- depuis le navigateur se restreint à la colonne `role` — le droit UPDATE retiré à `authenticated` sur la table, puis
-- rendu sur `role` seule.
--
-- CE QUE LA BASE FAISAIT. La policy de mise à jour (`cabinet_admins_update`, migration `gestion_equipe_cabinet`) ne juge
-- que `est_chef_du_cabinet(cabinet_id)`, avant et après l'écriture, et `authenticated` porte UPDATE sur la table entière,
-- donc sur ses quatre colonnes (`user_id`, `cabinet_id`, `role`, `email`), sans déclencheur. Un chef pouvait donc, depuis
-- une session, changer le COMPTE d'une ligne de son équipe pour un compte dont il connaît l'identifiant — un client de ses
-- dossiers, donc aussi le client d'un autre cabinet rattaché sur confirmation (23-Q2) —, sans passer par
-- `create-team-member` ni par ses refus (23Q2-Q2) ; ou l'adresse que la page de l'équipe affiche. Le commentaire de
-- `gestion_equipe_cabinet` promettait « changer le rôle d'un membre … ou le retirer (jamais créer) » ; l'application
-- n'écrit que `role`.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE. `authenticated` perd le droit UPDATE sur la table et le reçoit sur la seule colonne
-- `role`. Une écriture qui nomme une autre colonne se refuse avant de lire une seule ligne (42501, « permission denied for
-- table cabinet_admins ») : le droit se juge avant la policy, quelle que soit la valeur — remise à elle-même comprise.
--
-- CE QUI NE CHANGE PAS. Les trois policies de la table : le chef change le rôle d'un membre de SON cabinet et le retire
-- comme hier — la page de l'équipe n'écrit que `{ role }` (`EquipePage.changerRole`), et « Retirer » ôte la ligne par la
-- policy de suppression, que ce droit ne touche pas. Les autres droits d'`authenticated` sur la table (lecture, insertion
-- que nulle policy n'admet, suppression). Ceux d'`anon`, qu'aucune policy n'admet sans session (`est_chef_du_cabinet` y est
-- faux), comme sur toute table du schéma. Ceux de `service_role` : `create-team-member` et `create-cabinet` écrivent
-- l'équipe avec la clé secrète, et n'y font qu'insérer. Aucune fonction SQL n'écrit `cabinet_admins` (lu au catalogue le
-- 26/10/2026 : quatre la lisent), aucun déclencheur ne la vise ; la sauvegarde d'un dossier ne la porte pas (une table de
-- niveau cabinet), et sa restauration n'y écrit rien. Aucune table, colonne, contrainte, policy ni donnée.
--
-- NEUTRE EN PRODUCTION (relevé le 26/10/2026, des comptes et le catalogue) : une ligne d'équipe, celle du chef ; aucun
-- droit par colonne dans le schéma public — celui-ci est le premier, que `signature.sql` lit depuis ce jour.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : un droit, à un rôle — ni objet, ni
-- donnée. Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose : les droits d'`authenticated` sur `cabinet_admins` tels que la production les porte ══════

do $$
begin
  if to_regclass('public.cabinet_admins') is null then
    raise exception 'La table public.cabinet_admins est absente : cette migration ne s''applique pas.';
  end if;
  -- Le droit qu'elle retire : UPDATE sur la TABLE, à `authenticated`. Absent, elle a déjà passé, ou un autre texte a
  -- changé ces droits depuis : ils ne se réécrivent pas sans être relus.
  if not has_table_privilege('authenticated', 'public.cabinet_admins', 'UPDATE') then
    raise exception 'Le rôle authenticated ne porte pas le droit UPDATE sur la table public.cabinet_admins : cette migration a déjà passé, ou ces droits ont changé depuis ; ils ne se réécrivent pas sans être relus.';
  end if;
  -- Aucun droit par colonne sur la table : celui qu'elle pose n'y est pas encore, et aucun autre ne s'y mêle. (Une colonne
  -- ôtée de la table garde son entrée dans pg_attribute, son type remis à zéro : `atttypid <> 0` l'écarte, ici et plus bas.)
  if exists (select 1
               from pg_attribute a
              cross join lateral aclexplode(a.attacl) d
              where a.attrelid = 'public.cabinet_admins'::regclass and a.attnum > 0 and a.atttypid <> 0) then
    raise exception 'Une colonne de public.cabinet_admins porte déjà un droit à elle : cette migration ne s''applique pas sans que ces droits soient relus.';
  end if;
end
$$;

-- ══ 1. La mise à jour, par la seule colonne `role` ══════════════════════════════════════════════════════════════════

revoke update on table public.cabinet_admins from authenticated;
grant update (role) on table public.cabinet_admins to authenticated;

-- ══ 2. Ce qu'elle laisse, vérifié avant que sa transaction ne se ferme ════════════════════════════════════════════════

do $$
declare
  v_ouvertes text;
begin
  -- Les colonnes qu'`authenticated` met encore à jour — un droit de table les ouvrirait toutes : `role`, et elle seule. Un
  -- droit venu d'ailleurs, que le retrait n'ôte pas (accordé à PUBLIC, par un autre donneur, ou hérité d'un rôle), se
  -- dirait ici, et rien ne serait appliqué.
  select string_agg(a.attname, ', ' order by a.attname) into v_ouvertes
    from pg_attribute a
   where a.attrelid = 'public.cabinet_admins'::regclass and a.attnum > 0 and a.atttypid <> 0
     and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE');
  if v_ouvertes is distinct from 'role' then
    raise exception 'Après le retrait, le rôle authenticated met à jour % de public.cabinet_admins, au lieu de la seule colonne role : rien n''est appliqué.',
      coalesce('les colonnes ' || v_ouvertes, 'aucune colonne');
  end if;
end
$$;
