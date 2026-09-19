-- Enregistrement transactionnel d'une facture et de ses lignes.
--
-- Le client faisait jusqu'ici trois à cinq allers-retours (update en-tête, delete des lignes, insert
-- des nouvelles, puis consommation du numéro et update de validation). Chacun pouvait échouer seul,
-- laissant la facture à mi-chemin : lignes doublées si le delete échouait, ou numéro consommé sans
-- être posé sur la facture — un trou dans une suite qui doit être sans trou.

-- 1. Format du numéro, en un seul endroit. Le TypeScript le construisait de son côté
-- (`attribuerNumeroFacture`) ; le refaire ici aurait créé deux écritures du même format, libres de
-- diverger en silence. C'est désormais le SQL qui fait foi, et le TypeScript qui appelle.
create or replace function public.numero_facture_formate(p_annee integer, p_type text, p_sequence integer)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select (case when p_type = 'avoir' then 'A' else 'F' end) || p_annee::text || '-' || lpad(p_sequence::text, 4, '0')
$$;

-- 2. Consomme le prochain numéro et le rend déjà formaté. `prochain_numero_facture` reste le
-- compteur atomique ; cette fonction n'en est que l'habillage, pour que personne n'ait à reformater.
create or replace function public.attribuer_numero_facture(p_dossier_id uuid, p_annee integer, p_type text default 'facture')
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sequence integer;
begin
  -- Le contrôle d'accès et la validation du type vivent dans prochain_numero_facture, appelée ici.
  v_sequence := prochain_numero_facture(p_dossier_id, p_annee, p_type);
  return numero_facture_formate(p_annee, p_type, v_sequence);
end;
$$;

-- 3. Enregistrement complet, en une transaction.
--
-- SECURITY DEFINER comme prochain_numero_facture, avec le même contrat : la fonction vérifie
-- elle-même l'accès (admin_du_dossier) au lieu de s'en remettre à la RLS, que ce mode contourne.
--
-- Les colonnes de l'en-tête sont énumérées une par une, délibérément. Un `jsonb_populate_record` sur
-- la table entière serait plus court mais laisserait l'appelant écrire n'importe quelle colonne —
-- dont `numero`, `statut`, `validated_at` ou `type`. En SECURITY DEFINER, ce serait lui donner le
-- droit de forger un numéro de facture.
--
-- Les montants de l'en-tête sont pris tels que le client les a calculés, jamais recalculés ici : la
-- règle d'arrondi vit dans `calculerLigne` (src/lib/factures.ts), qui est testée. La réécrire en SQL
-- recréerait exactement le genre de divergence silencieuse que cette fonction existe pour empêcher.
-- L'atomicité suffit à garantir que l'en-tête décrit bien le jeu de lignes sur lequel il a été
-- calculé — ce qui était précisément ce qui pouvait cesser d'être vrai.
create or replace function public.enregistrer_facture(
  p_dossier_id uuid,
  p_facture_id uuid,
  p_facture jsonb,
  p_lignes jsonb,
  p_valider boolean default false
)
returns table (facture_id uuid, numero text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_numero text;
  v_type text;
  v_statut text;
  v_date_emission date;
begin
  if not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_lignes) is distinct from 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Une facture doit porter au moins une ligne.' using errcode = '22023';
  end if;

  v_date_emission := coalesce(nullif(p_facture->>'date_emission', '')::date, current_date);

  if p_facture_id is null then
    insert into factures_emises (
      dossier_id, tiers_nom, tiers_adresse, tiers_siret, tiers_email,
      date_emission, date_echeance, notes, mentions_legales,
      emetteur_nom, emetteur_siret, emetteur_adresse,
      montant_ht, montant_tva, montant_ttc, created_by
    ) values (
      p_dossier_id,
      p_facture->>'tiers_nom',
      p_facture->>'tiers_adresse',
      p_facture->>'tiers_siret',
      p_facture->>'tiers_email',
      v_date_emission,
      nullif(p_facture->>'date_echeance', '')::date,
      p_facture->>'notes',
      p_facture->>'mentions_legales',
      p_facture->>'emetteur_nom',
      p_facture->>'emetteur_siret',
      p_facture->>'emetteur_adresse',
      coalesce((p_facture->>'montant_ht')::numeric, 0),
      coalesce((p_facture->>'montant_tva')::numeric, 0),
      coalesce((p_facture->>'montant_ttc')::numeric, 0),
      -- Jamais fourni par l'appelant : c'est l'utilisateur authentifié qui crée, par définition.
      auth.uid()
    )
    returning id, type, statut into v_id, v_type, v_statut;
  else
    -- La facture doit exister *dans ce dossier* : sans ce contrôle, un dossier dont on est admin
    -- suffirait à modifier la facture d'un autre en passant son id.
    select f.type, f.statut into v_type, v_statut
    from factures_emises f
    where f.id = p_facture_id and f.dossier_id = p_dossier_id
    for update;
    if not found then
      raise exception 'Facture introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    -- Une facture validée est figée (voir CLAUDE.md) : la corriger passe par un avoir. L'écran ne
    -- propose déjà que l'aperçu, ce contrôle est la même règle dite là où elle ne peut pas être
    -- contournée.
    if v_statut = 'validee' then
      raise exception 'Une facture validée ne peut plus être modifiée — passer par un avoir.' using errcode = '22023';
    end if;

    update factures_emises set
      tiers_nom = p_facture->>'tiers_nom',
      tiers_adresse = p_facture->>'tiers_adresse',
      tiers_siret = p_facture->>'tiers_siret',
      tiers_email = p_facture->>'tiers_email',
      date_emission = v_date_emission,
      date_echeance = nullif(p_facture->>'date_echeance', '')::date,
      notes = p_facture->>'notes',
      mentions_legales = p_facture->>'mentions_legales',
      emetteur_nom = p_facture->>'emetteur_nom',
      emetteur_siret = p_facture->>'emetteur_siret',
      emetteur_adresse = p_facture->>'emetteur_adresse',
      montant_ht = coalesce((p_facture->>'montant_ht')::numeric, 0),
      montant_tva = coalesce((p_facture->>'montant_tva')::numeric, 0),
      montant_ttc = coalesce((p_facture->>'montant_ttc')::numeric, 0)
    where id = p_facture_id;
    v_id := p_facture_id;
  end if;

  -- Remplacement complet des lignes. Le delete et l'insert sont maintenant dans la même transaction
  -- que tout le reste : un échec de l'un annule l'autre, plus de lignes doublées.
  delete from facture_lignes fl where fl.facture_id = v_id;

  insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva)
  select v_id,
         (l.ord - 1)::integer,
         l.valeur->>'designation',
         coalesce((l.valeur->>'quantite')::numeric, 0),
         coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0),
         coalesce((l.valeur->>'taux_tva')::numeric, 0)
  from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord);

  if p_valider then
    -- Le numéro est consommé ici, dans la même transaction que la validation qu'il accompagne. S'il
    -- était pris à part et que la suite échouait, il était perdu : un trou dans une suite annuelle
    -- qui, en facturation française, ne doit pas en avoir.
    v_numero := attribuer_numero_facture(p_dossier_id, extract(year from v_date_emission)::integer, v_type);
    update factures_emises set statut = 'validee', numero = v_numero, validated_at = now() where id = v_id;
  end if;

  return query select v_id, v_numero;
end;
$$;

-- Ces fonctions vérifient elles-mêmes l'accès, mais un appelant anonyme n'a rien à y faire :
-- auth.uid() y serait nul et le contrôle échouerait de toute façon — autant le dire explicitement.
revoke execute on function public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean) from public, anon;
revoke execute on function public.attribuer_numero_facture(uuid, integer, text) from public, anon;
grant execute on function public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.attribuer_numero_facture(uuid, integer, text) to authenticated;
