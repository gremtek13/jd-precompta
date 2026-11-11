-- RETOUR ARRIÈRE de la migration `couverture_du_releve_par_compte` (ligne 26.6, MCB4) : `couverture_du_releve` reprend le
-- corps de la migration `banque_du_client` (10/10/2026) — les mois où le relevé du dossier porte un mouvement, tous comptes
-- confondus. Rien ne se perd (aucune donnée, aucune colonne) ; il s'applique par l'outil, et AVANT le retour de
-- `comptes_bancaires` s'il faut retirer les deux (sinon il reste ce qu'il est : la fonction ne nomme plus la table). Après lui,
-- le mois d'un compte couvre de nouveau le trou d'un autre, côté client.
create or replace function public.couverture_du_releve(p_dossier_id uuid) returns date[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'membre')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  return coalesce((
    select array_agg(m.mois order by m.mois)
      from (select distinct date_trunc('month', l.date::timestamp)::date as mois
              from public.lignes_bancaires l where l.dossier_id = p_dossier_id) m
  ), '{}'::date[]);
end;
$$;

revoke execute on function public.couverture_du_releve(uuid) from public, anon;
grant execute on function public.couverture_du_releve(uuid) to authenticated;
