-- D'où vient le montant en euros d'une pièce libellée en devise étrangère.
--
-- 'bce'    : converti au taux de référence de la Banque centrale européenne à la date de la pièce.
--            Valeur PROVISOIRE — le taux de référence ignore le spread et les frais que la banque
--            appliquera réellement.
-- 'banque' : repris du mouvement bancaire qui règle la pièce. Montant DÉFINITIF : en BNC la dépense
--            déductible est ce qui a réellement quitté le compte, frais de change compris. Le taux
--            stocké est alors celui réellement subi, déduit du rapprochement — plus aucun cours du
--            jour n'est nécessaire.
--
-- Nulle pour une pièce en euros : pas de conversion, donc pas d'origine à en donner.
alter table pieces add column if not exists conversion_source text;

-- Le remplissage AVANT la contrainte, jamais après : une contrainte est vérifiée sur les lignes
-- existantes au moment où on l'ajoute, et les quatre factures déjà converties la violeraient.
update pieces set conversion_source = 'bce' where taux_change is not null and conversion_source is null;

alter table pieces drop constraint if exists pieces_conversion_source_connue;
alter table pieces add constraint pieces_conversion_source_connue check (
  conversion_source is null or conversion_source in ('bce', 'banque')
);

-- Une origine ne se conçoit pas sans conversion, ni une conversion sans origine : les deux vont
-- ensemble, sinon on ne sait plus si un montant est provisoire ou définitif — exactement ce que cette
-- colonne existe pour dire.
alter table pieces drop constraint if exists pieces_conversion_source_coherente;
alter table pieces add constraint pieces_conversion_source_coherente check (
  (taux_change is null and conversion_source is null)
  or (taux_change is not null and conversion_source is not null)
);

comment on column pieces.conversion_source is
  'Origine du montant en euros d''une pièce en devise : bce (provisoire) ou banque (définitif).';
