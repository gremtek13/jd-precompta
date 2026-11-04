-- LA SUPPRESSION D'UN BROUILLON DE DEVIS (espace client, étape P5) — À COLLER dans l'éditeur SQL de Supabase, dans une
-- transaction, avec sa ligne d'historique (CLAUDE.md, « Quand `apply_migration` attend une confirmation ») : le corps de
-- sa fonction supprime un brouillon, ce que le détecteur de l'outil retient. Réécrite le 05/11/2026 avec la première, contre
-- le schéma de la production à 171 migrations. Elle suppose la première (`devis_du_client`), que son premier bloc vérifie.
--
-- `supprimer_brouillon_devis` : trois refus, dans l'ordre que src/lib/devis.ts (`REFUS_SUPPRESSION_DEVIS`) redit — l'accès
-- au dossier annoncé, le cabinet ou le client « Ventes », avant de rien lire (42501) ; le devis, dans ce dossier,
-- verrouillé (P0002) ; un devis émis ne se supprime plus (22023). Rend l'identifiant supprimé. Un devis émis, la garde
-- `devis_figes` le refuse aussi à tout autre chemin.
--
-- SON RETOUR : celui de la première (supabase/preparees/retour/20261105100200_retour_devis_du_client.sql), qui retire
-- aussi cette fonction.
--
-- Ni barre oblique inverse, ni retour chariot.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regclass('public.devis') is null
     or to_regprocedure('public.enregistrer_devis(uuid, uuid, jsonb, jsonb, boolean)') is null then
    raise exception 'La migration devis_du_client n''est pas en base : cette migration la suppose.';
  end if;
  if to_regprocedure('public.supprimer_brouillon_devis(uuid, uuid)') is not null then
    raise exception 'La fonction supprimer_brouillon_devis est déjà en base : cette migration est déjà appliquée.';
  end if;
end
$garde$;

-- ══ 1. Supprimer un brouillon ══════════
create function public.supprimer_brouillon_devis(p_dossier_id uuid, p_devis_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_devis public.devis;
begin
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select d.* into v_devis
    from public.devis d
   where d.id = p_devis_id and d.dossier_id = p_dossier_id
     for update;
  if not found then
    raise exception 'Devis introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_devis.statut = 'emis' then
    raise exception 'Le devis % est émis : il ne se supprime plus.', v_devis.numero using errcode = '22023';
  end if;
  delete from public.devis d where d.id = p_devis_id;
  return p_devis_id;
end;
$$;

revoke execute on function public.supprimer_brouillon_devis(uuid, uuid) from public, anon;
grant execute on function public.supprimer_brouillon_devis(uuid, uuid) to authenticated;

comment on function public.supprimer_brouillon_devis(uuid, uuid) is
  'Supprime un brouillon de devis. Réservée au cabinet du dossier ou à un accès portant le droit « Ventes » (42501) ; un devis introuvable dans ce dossier (P0002) ou émis (22023) ne se supprime pas. Rend l''identifiant supprimé.';
