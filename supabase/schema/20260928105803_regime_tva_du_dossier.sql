-- Le régime de TVA d'un dossier assujetti, lu par l'onglet TVA qui prépare la CA3 case par case.
alter table public.dossiers
  add column tva_periodicite text not null default 'trimestrielle',
  add column tva_sur_debits boolean not null default false,
  add constraint dossiers_tva_periodicite_check check (tva_periodicite in ('mensuelle', 'trimestrielle'));

comment on column public.dossiers.tva_periodicite is
  'Périodicité de la CA3. Trimestrielle par défaut : à partir du 1er janvier 2027 le régime simplifié disparaît (loi de finances 2025, art. 38) et la CA3 devient trimestrielle sous 1 000 000 € de chiffre d''affaires, mensuelle sur demande ou au-delà.';
comment on column public.dossiers.tva_sur_debits is
  'Option pour le paiement de la TVA d''après les débits : la TVA des recettes est due à la date de la facture et non à l''encaissement, qui est la règle des prestations de services.';

-- Le crédit de la déclaration précédente reporté sur celle-ci (ligne 22 de la CA3). C'est de lui
-- qu'on déduit le crédit que cette déclaration reporte à son tour (ligne 27).
alter table public.declarations_tva
  add column credit_anterieur numeric not null default 0,
  add constraint declarations_tva_credit_anterieur_check check (credit_anterieur >= 0);

comment on column public.declarations_tva.credit_anterieur is
  'Crédit de TVA reporté de la déclaration précédente (ligne 22 de la CA3), tel qu''il a été porté sur cette déclaration.';
