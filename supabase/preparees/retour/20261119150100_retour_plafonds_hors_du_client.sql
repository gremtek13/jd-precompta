-- LE RETOUR DE `plafonds_hors_du_client` (OPT1-Q3, préparée le 19/11/2026 : supabase/preparees/20261119150000_plafonds_hors_du_client.sql).
-- Il rend aux deux rôles de l'API la lecture de la table entière, plafonds compris, et retire la fonction de lecture des
-- plafonds. À COLLER (il retire une fonction : l'outil d'application attendrait une confirmation), dans une transaction, avec
-- sa ligne d'historique ; `PLAFONDS_HORS_DU_CLIENT_PREVUS` rebaissé dans le même commit que le retrait du fichier de l'export.
-- Éprouvé le 19/11/2026 sur une copie de la réplique : la signature d'avant rendue sur ses neuf familles, aucun droit par
-- colonne laissé (`attacl` revenu nul).

-- La garde : la migration est en base, et aucun droit de lecture par colonne d'un rôle de l'API n'a été posé depuis sur une
-- colonne qu'elle ne connaît pas (le retour ne le retirerait pas, et la table se relirait autrement qu'avant).
do $garde$
begin
  if to_regprocedure('public.plafonds_de_l_assistant()') is null
     or has_table_privilege('authenticated', 'public.cabinets', 'SELECT') then
    raise exception 'La migration plafonds_hors_du_client n''est pas en base : rien à retourner.';
  end if;
  if exists (select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) d
              where a.attrelid = 'public.cabinets'::regclass and a.attnum > 0 and d.privilege_type = 'SELECT'
                and (d.grantee = 0 or d.grantee in (to_regrole('anon'), to_regrole('authenticated')))
                and a.attname not in ('id', 'nom', 'couleur_primaire', 'couleur_primaire_claire', 'police_google_font',
                                      'logo_storage_path', 'created_at', 'dossier_du_cabinet')) then
    raise exception 'Une colonne de cabinets que la migration ne connaît pas porte un droit de lecture d''un rôle de l''API : la relire avant le retour.';
  end if;
end
$garde$;

drop function public.plafonds_de_l_assistant();
revoke select (id, nom, couleur_primaire, couleur_primaire_claire, police_google_font, logo_storage_path, created_at, dossier_du_cabinet)
  on public.cabinets from anon, authenticated;
grant select on public.cabinets to anon, authenticated;

do $fin$
begin
  if not has_table_privilege('anon', 'public.cabinets', 'SELECT')
     or not has_table_privilege('authenticated', 'public.cabinets', 'SELECT')
     or exists (select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) d
                 where a.attrelid = 'public.cabinets'::regclass and a.attnum > 0
                   and (d.grantee = 0 or d.grantee in (to_regrole('anon'), to_regrole('authenticated'))))
     or to_regprocedure('public.plafonds_de_l_assistant()') is not null then
    raise exception 'Le retour de plafonds_hors_du_client n''a pas rendu l''état d''avant.';
  end if;
end
$fin$;
