-- RETOUR ARRIÈRE de `missions_du_client` (LM5-Q2, ligne 47) — À COLLER dans l'éditeur SQL, dans une transaction, avec la
-- ligne d'historique `retour_missions_du_client` : il retire la fonction de lecture (« drop function »), que l'outil
-- retiendrait.
--
-- Il ne retire qu'elle : aucune table, aucune ligne, aucun droit d'une table ne change, et rien de ce qu'elle a rendu ne
-- s'est écrit. AVANT de le coller, baisser `MISSIONS_DU_CLIENT_PREVUES` (src/lib/missionsDuClient.ts) et attendre la mise
-- en ligne : levé, la carte « Missions confiées au cabinet » d'un dossier client l'appelle, et sans elle se dit illisible
-- — rien de faux ne s'affiche, rien ne s'écrit. Baissé, la carte lit comme avant, par la policy du dossier du cabinet.

do $garde$
begin
  if to_regprocedure('public.missions_du_client(uuid)') is null then
    raise exception 'La migration missions_du_client n''est pas en base : rien à défaire.';
  end if;
end
$garde$;

drop function public.missions_du_client(uuid);
