-- LE RETOUR ARRIÈRE DE `facture_dates_centimes_mention_tva` (la correction de la facture, 31/10/2026, reprise le 02/11/2026
-- pour FACTURE-Q1). Le récit : HISTORIQUE.md, « LA FACTURE : LA DATE DANS L'ORDRE DE SA SÉRIE, LE DEMI-CENTIME ET LA
-- MENTION DE TVA, REPRISE POUR FACTURE-Q1 (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- CE QU'IL FAIT, ET RIEN D'AUTRE : les deux fonctions rendues telles que la production les porte le 02/11/2026 (celles du
-- 31/10/2026 : rien ne les a touchées depuis), au caractère près, avec leurs commentaires — `centimes_ligne_facture` celle
-- de la migration encaissements_des_factures (le calcul en virgule flottante), `garder_factures_validees` celle de la
-- migration factures_validees_figees (sans ce que la validation exige de la facture). L'application corrigée, elle,
-- compte alors les lignes autrement que la base au demi-centime : un retour arrière de la base se fait avec celui du code
-- (montantsFacture.ts et ses copies), et le formulaire de la facture retient encore, dans l'espace du client, ce que la
-- garde ne refuse plus (lib/validationDeLaFacture.ts, `refusDuStatutDeTva`).
--
-- CE QU'IL NE FAIT PAS : il ne retire ni ligne, ni objet, ni droit, ni la ligne d'historique de la migration qu'il défait —
-- appliqué par l'outil, il pose la sienne à la suite. `create or replace` garde l'OID des deux fonctions, leur
-- propriétaire, leurs droits et le déclencheur de la garde. Une facture validée sous la migration reste ce qu'elle est.
--
-- SA GARDE DE TÊTE : il se refuse si l'une des deux fonctions en base n'est pas celle que la migration a posée (une autre
-- migration l'a reprise depuis, ou ce texte a déjà été appliqué).
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'il suppose : les deux fonctions telles que la migration les a laissées ══════════
do $garde$
declare
  v_fonction record;
begin
  for v_fonction in
    select t.signature, t.empreinte from (values
      ('public.garder_factures_validees()', 'd79a5f95f74afe0077049c4b2531ebe3'),
      ('public.centimes_ligne_facture(numeric, numeric, numeric, boolean)', 'c693e49939a5732b0fef1b2ba4e6abd1')
    ) as t(signature, empreinte)
    where to_regprocedure(t.signature) is null
       or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure(t.signature)) <> t.empreinte
  loop
    raise exception 'La fonction % en base n''est plus celle de la migration facture_dates_centimes_mention_tva (empreinte attendue %) : ce texte ne la remplace pas sans être relu.',
      v_fonction.signature, v_fonction.empreinte;
  end loop;
end
$garde$;

-- ══ 1. Le calcul d'une ligne d'hier, celui de la migration encaissements_des_factures ══════════
create or replace function public.centimes_ligne_facture(
  p_quantite numeric, p_prix_unitaire_ht numeric, p_taux_tva numeric, p_avoir boolean)
returns table (ht_centimes bigint, tva_centimes bigint)
language plpgsql
immutable
set search_path = public
as $$
declare
  q double precision := p_quantite::double precision;
  p double precision := p_prix_unitaire_ht::double precision;
  x double precision;
  v double precision;
  n double precision;
  ht double precision;
  tva double precision;
begin
  -- La ligne dans le sens du document : un avoir se lit en montants positifs (type 381), une remise saisie à prix
  -- négatif se transmet en quantité négative au même produit.
  if p_avoir then
    q := q * (-1)::double precision;
  end if;
  if p < 0::double precision then
    q := -q;
    p := -p;
  end if;
  -- auCentime(quantité × prix) : Math.round(|x| × 100) / 100, de signe x.
  x := q * p;
  v := abs(x) * 100::double precision;
  n := floor(v);
  if v - n >= 0.5::double precision then n := n + 1::double precision; end if;
  ht := n / 100::double precision;
  if ht = 0::double precision then ht := 0::double precision; elsif x < 0::double precision then ht := -ht; end if;
  -- auCentime(HT × (taux / 100)).
  x := ht * (p_taux_tva::double precision / 100::double precision);
  v := abs(x) * 100::double precision;
  n := floor(v);
  if v - n >= 0.5::double precision then n := n + 1::double precision; end if;
  tva := n / 100::double precision;
  if tva = 0::double precision then tva := 0::double precision; elsif x < 0::double precision then tva := -tva; end if;
  -- centimes(montant) = Math.round(montant × 100).
  v := ht * 100::double precision;
  n := floor(v);
  if v - n >= 0.5::double precision then n := n + 1::double precision; end if;
  ht_centimes := n::bigint;
  v := tva * 100::double precision;
  n := floor(v);
  if v - n >= 0.5::double precision then n := n + 1::double precision; end if;
  tva_centimes := n::bigint;
  return next;
end
$$;

comment on function public.centimes_ligne_facture(numeric, numeric, numeric, boolean) is
  'HT et TVA d''une ligne de facture en centimes, calculés exactement comme calculerLigne et montantsDuDocument (double précision, Math.round).';

-- ══ 2. La garde des factures d'hier, celle de la migration factures_validees_figees ══════════
create or replace function public.garder_factures_validees() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Ce que l'envoi d'une facture validée écrit après coup. Une colonne qu'une étape suivante écrira sur une facture
  -- validée (le dépôt chez la plateforme du client) s'inscrit ici, dans sa migration : facturesFigees.test.ts compare
  -- cette liste à ce que les Edge Functions et l'application écrivent.
  v_modifiables constant text[] := array['tiers_email', 'superpdp_invoice_id', 'superpdp_dernier_statut'];
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return old;
    end if;
    if old.statut = 'validee' then
      raise exception 'La facture % est validée : elle ne se supprime plus — la corriger passe par un avoir.', old.numero
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.dossier_id is distinct from old.dossier_id then
      raise exception 'Une facture ne change pas de dossier.' using errcode = '23514';
    end if;
    if old.statut = 'validee' then
      -- Le second passage d'une restauration repose le lien d'un avoir vers sa facture, et rien d'autre.
      if old.type = 'avoir' and old.facture_origine_id is null and new.facture_origine_id is not null
         and to_jsonb(new) - 'facture_origine_id' = to_jsonb(old) - 'facture_origine_id'
         and public.restauration_des_factures(old.dossier_id) then
        return new;
      end if;
      if to_jsonb(new) - v_modifiables is distinct from to_jsonb(old) - v_modifiables then
        raise exception 'La facture % est validée : elle ne se modifie plus — la corriger passe par un avoir.', old.numero
          using errcode = '23514';
      end if;
      return new;
    end if;
    if new.type is distinct from old.type or new.facture_origine_id is distinct from old.facture_origine_id then
      raise exception 'Une facture ne devient pas un avoir : un avoir se crée par enregistrer_facture, qui le valide aussitôt.'
        using errcode = '42501';
    end if;
    if new.statut = 'validee'
       and coalesce(current_setting('jd.validation_facture', true), '') is distinct from new.id::text then
      raise exception 'Une facture ne se valide que par enregistrer_facture, qui lui donne son numéro.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.statut = 'validee' and not public.restauration_des_factures(new.dossier_id) then
    raise exception 'Une facture ne naît pas validée : elle se valide par enregistrer_facture, qui lui donne son numéro.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.garder_factures_validees() is
  'Une facture validée ne se modifie ni ne se supprime ; elle ne se valide que par enregistrer_facture (déclencheur factures_emises_figees).';
