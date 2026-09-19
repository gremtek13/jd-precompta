-- Taux de change de référence de la Banque centrale européenne, publiés chaque jour ouvré vers 16h
-- CET. C'est la référence admise pour convertir une facture libellée en devise étrangère : elle est
-- publique, datée, et opposable — contrairement au taux d'un convertisseur en ligne, qu'on ne peut
-- pas rejouer deux ans plus tard devant un contrôle.
--
-- Convention BCE conservée telle quelle : `taux` est le nombre d'unités de la devise pour 1 EUR
-- (USD 1,17 = 1 EUR vaut 1,17 $). Convertir vers l'euro se fait donc en DIVISANT. La stocker à
-- l'envers « pour simplifier » ferait diverger la table de sa source, et le jour où un chiffre est
-- contesté c'est la source qui tranche.
create table if not exists taux_change_bce (
  date date not null,
  devise text not null,
  taux numeric not null check (taux > 0),
  created_at timestamptz not null default now(),
  primary key (date, devise)
);

alter table taux_change_bce enable row level security;

-- Donnée de référence publique, identique pour tous les dossiers : lisible par tout utilisateur
-- connecté. Aucune policy d'écriture — seule la fonction d'alimentation, qui porte la clé de
-- service, remplit cette table. Un client n'a aucune raison de pouvoir corriger un taux officiel.
drop policy if exists taux_change_bce_select on taux_change_bce;
create policy taux_change_bce_select on taux_change_bce for select to authenticated using (true);

-- Devise d'origine de la pièce, et montant TTC tel qu'il est ÉCRIT SUR LE DOCUMENT.
--
-- Les colonnes montant_ht / montant_tva / montant_ttc restent en EUROS, sans exception : tout l'aval
-- en dépend — écritures, rapprochement bancaire, export FEC, totaux de clôture, 2035. Y laisser
-- entrer des dollars ferait une comptabilité dont les colonnes ne s'additionnent plus, et le défaut
-- serait invisible tant qu'aucune facture étrangère n'entre.
--
-- 'EUR' par défaut : la quasi-totalité des pièces, et toutes celles déjà en base, sont en euros. La
-- colonne est NOT NULL pour qu'« inconnue » ne soit jamais une valeur possible — une pièce a
-- toujours une devise, même quand personne ne s'est posé la question.
alter table pieces add column if not exists devise text not null default 'EUR';
alter table pieces add column if not exists montant_devise numeric;
alter table pieces add column if not exists taux_change numeric;

alter table pieces drop constraint if exists pieces_devise_iso;
alter table pieces add constraint pieces_devise_iso check (devise ~ '^[A-Z]{3}$');

alter table pieces drop constraint if exists pieces_taux_change_positif;
alter table pieces add constraint pieces_taux_change_positif check (taux_change is null or taux_change > 0);

-- Une pièce en euros n'a ni montant d'origine distinct ni taux : les y autoriser laisserait
-- s'installer des lignes où montant_devise et montant_ttc disent deux choses différentes pour la
-- même somme, sans qu'on sache laquelle fait foi.
alter table pieces drop constraint if exists pieces_conversion_coherente;
alter table pieces add constraint pieces_conversion_coherente check (
  (devise = 'EUR' and montant_devise is null and taux_change is null)
  or devise <> 'EUR'
);

comment on column pieces.devise is 'Devise du document (ISO 4217). Les montants ht/tva/ttc sont TOUJOURS en euros.';
comment on column pieces.montant_devise is 'Montant TTC tel qu''écrit sur le document, dans sa devise. Nul si devise = EUR.';
comment on column pieces.taux_change is 'Unités de devise pour 1 EUR (convention BCE) ayant servi à la conversion. Nul si devise = EUR.';
