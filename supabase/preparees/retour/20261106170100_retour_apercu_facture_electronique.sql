-- RETOUR ARRIÈRE DE `apercu_facture_electronique` (étape C3, ligne 51.5) : `etat_facture_electronique` reprend le corps
-- d'hier, au caractère près (migration `adresses_reception`, 20261014143141), et son commentaire. Rien d'autre : la
-- migration n'a créé ni table ni policy. Aucune donnée n'est retirée — il passe par `apply_migration`. Un écran levé sur
-- la clé `ereporting` revient à l'écran d'hier (une clé absente veut dire la fonction d'hier, src/lib/apercuEreporting.ts).
-- La migration : supabase/schema/20261107145209_apercu_facture_electronique.sql (en production depuis le 07/11/2026).
do $garde$
begin
  if (select position('regimes_ereporting' in p.prosrc) = 0 from pg_proc p
       where p.oid = to_regprocedure('public.etat_facture_electronique(uuid)')) then
    raise exception 'La migration apercu_facture_electronique n''est pas en base : rien à défaire.';
  end if;
end
$garde$;

create or replace function public.etat_facture_electronique(p_dossier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'plateforme', coalesce(
      (select jsonb_build_object('reliee', true, 'nom', c.nom, 'creee_le', c.created_at,
                                 'derniere_recuperation', c.derniere_recuperation, 'statuts_lus_le', c.cycle_vie_lu_le)
         from public.connexions_plateformes c where c.dossier_id = p_dossier_id),
      jsonb_build_object('reliee', false, 'nom', null, 'creee_le', null, 'derniere_recuperation', null, 'statuts_lus_le', null)),
    'superpdp', coalesce(
      (select jsonb_build_object('relie', true, 'depuis', s.created_at)
         from public.superpdp_credentials s where s.dossier_id = p_dossier_id),
      jsonb_build_object('relie', false, 'depuis', null)),
    'adresse',
      (select jsonb_build_object('id', a.id, 'forme', a.forme, 'identifiant', a.identifiant, 'plateforme', a.plateforme,
                                 'prise_effet', a.prise_effet, 'verification', a.verification, 'verifiee_le', a.verifiee_le,
                                 'auteur', a.auteur, 'cree_le', a.cree_le)
         from public.adresses_reception a
        where a.dossier_id = p_dossier_id
          and not exists (select 1 from public.adresses_reception s where s.remplace_id = a.id)));
end
$$;

comment on function public.etat_facture_electronique(uuid) is
  'L''état de la facture électronique d''un dossier, pour le cabinet ou le client qui porte la case « Ventes » : la plateforme agréée et Super PDP, reliés ou non, leur nom et leurs dates — jamais une adresse de connexion, un identifiant, un secret, une organisation ni une portée —, et l''adresse de réception courante.';
