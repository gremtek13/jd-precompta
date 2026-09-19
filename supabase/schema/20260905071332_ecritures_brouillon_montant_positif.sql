-- Le sens (débit/crédit) porte déjà la direction — montant doit toujours être une grandeur positive,
-- jamais un nombre signé, sinon le contrôle débit = crédit (analyserEcritures) se fausse silencieusement.
-- Trouvé en auditant : une pièce existante a un montant_ttc négatif (avoir/remboursement), et
-- lignesChargeProduitPourPiece() propageait ce signe tel quel dans l'écriture avant ce correctif.
-- Aucune ligne existante à corriger (vérifié : 0 montant <= 0 dans ecritures_brouillon).
alter table ecritures_brouillon add constraint ecritures_brouillon_montant_positif check (montant > 0);
