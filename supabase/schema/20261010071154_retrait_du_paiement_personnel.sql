-- LE RETRAIT D'UN PAIEMENT DEPUIS LE COMPTE PERSONNEL (ligne 26.6 de la feuille de route), avant la validation de son
-- exercice : l'échéance redevient sans paiement, et son écriture quitte le brouillon, d'un seul tenant.
--
-- Une migration à part de `paiement_personnel_des_cotisations`, et pour une seule raison : elle supprime des lignes du
-- brouillon, et un texte qui contient une suppression — même dans le corps d'une fonction — se colle par le cabinet dans
-- l'éditeur SQL de Supabase, avec sa ligne d'historique (CLAUDE.md), `apply_migration` attendant une confirmation qui
-- ne lui parvient pas.
--
-- CE QU'ELLE DÉTRUIT, en s'appliquant : rien — elle crée une fonction. Appelée, la fonction supprime les lignes
-- d'écriture d'UN paiement personnel, toujours proposées : un paiement qui tombe dans un exercice validé ne se retire
-- plus (refus 4), et l'écriture validée ne se supprime pas (`garder_ecritures_validees`).
--
-- Cinq refus, dans l'ordre que lib/cotisationPersonnelle.ts (`refusRetraitPaiementPersonnel`) reprend sous les mêmes
-- mots : l'accès au dossier annoncé, avant de rien lire ; l'échéance dans ce dossier, sous verrou ; un paiement à
-- retirer ; pas dans un exercice figé par la validation ; et pas une échéance qui, sans lui, compterait dans un exercice
-- figé — la 2035 validée la compte à la date de son paiement, et ne le saurait pas. Les déclencheurs de la migration
-- précédente ne laissent retirer l'écriture et effacer la date qu'à cette fonction (le réglage `jd.paiement_personnel`
-- de la transaction, sur cette échéance), dans cet ordre : l'écriture d'abord, puis la date.
create function public.retirer_paiement_personnel_cotisation(p_dossier_id uuid, p_cotisation_id uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cotisation public.cotisations_declarees%rowtype;
  v_frontiere date;
  v_nb integer;
begin
  if not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_cotisation from public.cotisations_declarees c
   where c.id = p_cotisation_id and c.dossier_id = p_dossier_id
   for update;
  if not found then
    raise exception 'Échéance introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_cotisation.paiement_personnel_le is null then
    raise exception 'Cette échéance n''est pas payée depuis le compte personnel.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_cotisation.paiement_personnel_le <= v_frontiere then
    raise exception '% : ce paiement ne se retire plus.',
      public.exercice_fige(p_dossier_id, extract(year from v_cotisation.paiement_personnel_le)::integer) using errcode = '23514';
  end if;
  if v_frontiere is not null and v_cotisation.echeance <= v_frontiere then
    raise exception '% : sans ce paiement, l''échéance du % y compterait ; il ne se retire plus.',
      public.exercice_fige(p_dossier_id, extract(year from v_cotisation.echeance)::integer),
      to_char(v_cotisation.echeance, 'DD/MM/YYYY') using errcode = '23514';
  end if;

  perform set_config('jd.paiement_personnel', p_cotisation_id::text, true);
  delete from public.ecritures_brouillon where cotisation_id = p_cotisation_id;
  get diagnostics v_nb = row_count;
  update public.cotisations_declarees set paiement_personnel_le = null where id = p_cotisation_id;
  perform set_config('jd.paiement_personnel', '', true);
  return v_nb;
end;
$$;

comment on function public.retirer_paiement_personnel_cotisation(uuid, uuid) is
  'Retire le paiement d''une échéance de cotisation depuis le compte personnel ET son écriture, dans une transaction : '
  'l''échéance compte de nouveau à son échéance. Refusé dans un exercice figé par la validation.';

revoke execute on function public.retirer_paiement_personnel_cotisation(uuid, uuid) from public, anon;
grant execute on function public.retirer_paiement_personnel_cotisation(uuid, uuid) to authenticated;
