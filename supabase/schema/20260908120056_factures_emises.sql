
-- Première brique de "remplacer MEG" : émettre soi-même des factures conformes, pas seulement en
-- recevoir (voir superpdp-sync). La transmission effective via une PDP viendra dans une étape
-- suivante (schéma Super PDP à valider) — pour l'instant la facture est créée, numérotée de façon
-- séquentielle sans trou (obligation légale, indépendante de toute PDP), et imprimable.

-- Adresse de l'émetteur (le dossier lui-même) — mention obligatoire sur une facture, absente jusqu'ici
-- de l'identité du dossier (seuls nom/siret existaient).
alter table dossiers add column adresse text;

create table factures_emises (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id) on delete cascade,
  -- Nul tant que la facture est en brouillon ; attribué une seule fois à la validation (voir
  -- prochain_numero_facture), jamais réattribué même si la facture est ensuite modifiée.
  numero text,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'validee')),
  date_emission date not null default current_date,
  date_echeance date,
  tiers_nom text not null,
  tiers_adresse text,
  tiers_siret text,
  montant_ht numeric not null default 0,
  montant_tva numeric not null default 0,
  montant_ttc numeric not null default 0,
  mentions_legales text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  validated_at timestamptz
);

-- Un numéro ne peut être réutilisé deux fois pour un même dossier — la contrainte laisse passer
-- plusieurs NULL (brouillons) sans conflit, seuls les numéros réellement attribués sont uniques.
create unique index factures_emises_numero_dossier_idx on factures_emises (dossier_id, numero) where numero is not null;
create index factures_emises_dossier_idx on factures_emises (dossier_id, date_emission desc);

create table facture_lignes (
  id uuid primary key default gen_random_uuid(),
  facture_id uuid not null references factures_emises(id) on delete cascade,
  ordre integer not null default 0,
  designation text not null,
  quantite numeric not null default 1,
  prix_unitaire_ht numeric not null default 0,
  -- Taux de TVA en pourcentage (0, 5.5, 10, 20...), pas un montant.
  taux_tva numeric not null default 0
);
create index facture_lignes_facture_idx on facture_lignes (facture_id, ordre);

-- Compteur de numérotation séquentielle sans trou, par dossier ET par année (obligation légale
-- française) — une table dédiée plutôt qu'une séquence Postgres classique : chaque dossier doit avoir
-- sa propre suite, jamais partagée ni mêlée à celle d'un autre. Verrouillée (RLS activée, aucune
-- policy) : le seul accès sanctionné passe par prochain_numero_facture ci-dessous, jamais une lecture
-- ou écriture directe depuis le navigateur.
create table facture_numerotation (
  dossier_id uuid not null references dossiers(id) on delete cascade,
  annee integer not null,
  dernier_numero integer not null default 0,
  primary key (dossier_id, annee)
);
alter table facture_numerotation enable row level security;

-- security definer : nécessaire pour écrire dans facture_numerotation (verrouillée ci-dessus), donc
-- vérifie lui-même l'autorisation plutôt que de compter sur RLS — même discipline que les autres
-- fonctions security definer de ce schéma (admin_du_dossier, est_chef_du_cabinet...).
create or replace function prochain_numero_facture(p_dossier_id uuid, p_annee integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero integer;
begin
  if not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.';
  end if;

  insert into facture_numerotation (dossier_id, annee, dernier_numero)
  values (p_dossier_id, p_annee, 1)
  on conflict (dossier_id, annee) do update set dernier_numero = facture_numerotation.dernier_numero + 1
  returning dernier_numero into v_numero;

  return v_numero;
end;
$$;

alter table factures_emises enable row level security;
alter table facture_lignes enable row level security;

create policy factures_emises_all on factures_emises
  for all using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

create policy facture_lignes_all on facture_lignes
  for all using (
    exists (select 1 from factures_emises f where f.id = facture_lignes.facture_id and admin_du_dossier(f.dossier_id))
  )
  with check (
    exists (select 1 from factures_emises f where f.id = facture_lignes.facture_id and admin_du_dossier(f.dossier_id))
  );
