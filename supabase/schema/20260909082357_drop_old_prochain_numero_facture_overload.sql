-- Correctif : create or replace function avec un paramètre supplémentaire (p_type) ne remplace pas
-- l'ancienne fonction à 2 arguments, il crée une surcharge distincte à côté — les deux coexistaient,
-- rendant tout appel à 2 arguments ambigu (42725, repéré en testant juste après la migration
-- factures_avoir). On supprime explicitement l'ancienne signature, ne laissant que
-- prochain_numero_facture(uuid, integer, text default 'facture').
drop function if exists prochain_numero_facture(uuid, integer);
