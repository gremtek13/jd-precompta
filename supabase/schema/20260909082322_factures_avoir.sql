-- Facture d'avoir : corrige une facture déjà validée (numéro attribué, immuable) sans jamais la
-- rouvrir — obligation légale française, déjà documentée dans FacturesTab avant que l'écran n'existe
-- ("corrige une erreur par une facture d'avoir... pas encore un écran dédié"). Même table
-- factures_emises (type='avoir' plutôt qu'une table séparée) : un avoir EST une facture au sens
-- légal, avec son propre numéro séquentiel sans trou — juste dans une série distincte ("A" plutôt que
-- "F", voir facture_numerotation ci-dessous) pour ne jamais mélanger les deux compteurs, convention la
-- plus répandue dans les logiciels de facturation français.
alter table factures_emises
  add column type text not null default 'facture' check (type in ('facture', 'avoir')),
  add column facture_origine_id uuid references factures_emises(id);

comment on column factures_emises.type is 'facture (par défaut) ou avoir — un avoir référence toujours sa facture d''origine via facture_origine_id.';
comment on column factures_emises.facture_origine_id is 'Facture corrigée par cet avoir (type=avoir uniquement) — jamais renseigné sur une facture normale. Montants et lignes de l''avoir stockés négatifs (voir lib/factures.ts) : sommer factures_emises.montant_ttc d''un dossier/année annule alors automatiquement l''effet d''un avoir sur le total, sans cas particulier à coder ailleurs.';

-- Deux compteurs indépendants par dossier/année (facture vs avoir) plutôt qu'un seul partagé.
alter table facture_numerotation drop constraint facture_numerotation_pkey;
alter table facture_numerotation add column type text not null default 'facture' check (type in ('facture', 'avoir'));
alter table facture_numerotation add primary key (dossier_id, annee, type);

create or replace function prochain_numero_facture(p_dossier_id uuid, p_annee integer, p_type text default 'facture')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_numero integer;
begin
  if p_type not in ('facture', 'avoir') then
    raise exception 'Type de numérotation invalide : %', p_type;
  end if;
  if not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.';
  end if;

  insert into facture_numerotation (dossier_id, annee, type, dernier_numero)
  values (p_dossier_id, p_annee, p_type, 1)
  on conflict (dossier_id, annee, type) do update set dernier_numero = facture_numerotation.dernier_numero + 1
  returning dernier_numero into v_numero;

  return v_numero;
end;
$$;
