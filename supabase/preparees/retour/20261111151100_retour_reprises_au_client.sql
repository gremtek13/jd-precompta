-- RETOUR ARRIÈRE de `reprises_au_client` (A8C-Q1 et A8Q5-Q2, ligne 51.5 ; en production depuis le 11/11/2026, version
-- 20261111204440 : supabase/schema/20261111204440_reprises_au_client.sql) — À COLLER dans l'éditeur SQL, dans une transaction,
-- avec la ligne d'historique `retour_reprises_au_client` : il retire les deux fonctions de lecture (« drop function »), que
-- l'outil retiendrait.
--
-- Il ne retire qu'elles : aucune table, aucune ligne, aucun droit d'une table ne change, rien de ce que les deux fonctions
-- ont rendu ne s'est écrit. AVANT de le coller, baisser `REPRISES_AU_CLIENT_PREVUES` (src/lib/reprisesAuClient.ts) et
-- attendre la mise en ligne : levé, l'application les appelle, et sans elles la fenêtre des encaissements d'une facture
-- reprise et « Ma simulation » d'un dossier basculé se disent incomplètes — rien de faux ne s'affiche ni ne s'écrit, mais
-- rien ne se propose.

do $garde$
begin
  if to_regprocedure('public.reprise_de_la_facture(uuid, uuid)') is null
     or to_regprocedure('public.pieces_citees_de_la_simulation(uuid)') is null then
    raise exception 'La migration reprises_au_client n''est pas en base : rien à défaire.';
  end if;
end
$garde$;

drop function public.reprise_de_la_facture(uuid, uuid);
drop function public.pieces_citees_de_la_simulation(uuid);
