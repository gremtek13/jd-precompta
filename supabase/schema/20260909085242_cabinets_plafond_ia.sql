-- Plafond de consommation de l'agent comptable (Claude/Bedrock, voir lib/coutsApi.ts) par cabinet,
-- paramétrable depuis Comptes master (réservé aux super-admins — cabinets_update couvre déjà ce cas
-- via est_chef_du_cabinet(), qui inclut is_super_admin()). Deux seuils indépendants, tous deux
-- optionnels (null = pas de plafond de ce type) :
-- - limite_ia_alerte_usd : au-delà, l'agent continue de répondre mais signale le dépassement
--   (voir agent-comptable, alerte_cout dans la réponse) — un avertissement, pas un blocage.
-- - limite_ia_blocage_usd : au-delà, l'agent refuse toute nouvelle question pour ce mois (voir
--   agent-comptable, vérifié avant tout appel Bedrock — aucun coût supplémentaire engagé une fois
--   bloqué). Recalculé chaque mois calendaire (reset naturel : la fenêtre de calcul ne regarde que
--   les messages du mois en cours, voir verifierPlafondCabinet).
alter table cabinets
  add column limite_ia_alerte_usd numeric,
  add column limite_ia_blocage_usd numeric;

comment on column cabinets.limite_ia_alerte_usd is 'Seuil (USD, coût estimé du mois calendaire en cours) au-delà duquel l''agent comptable signale un dépassement sans bloquer. Null = pas d''alerte.';
comment on column cabinets.limite_ia_blocage_usd is 'Seuil (USD, coût estimé du mois calendaire en cours) au-delà duquel l''agent comptable refuse toute nouvelle question jusqu''au mois suivant. Null = pas de plafond.';
