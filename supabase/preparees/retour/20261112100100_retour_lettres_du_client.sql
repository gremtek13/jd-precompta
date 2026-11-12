-- RETOUR DE LM6 (`lettres_du_client`, 20261112100000) — À COLLER (il porte un `drop`). Il retire la seule fonction que la
-- migration crée ; rien d'autre n'a changé, rien ne se perd : la fonction ne fait que lire. Avant lui, baisser
-- `LETTRES_DU_CLIENT_PREVUES` (src/lib/lettresDuClient.ts) et déployer : un écran levé lirait une fonction absente, et le
-- dirait (« illisible »), sans rien croire.
do $garde$
begin
  if to_regprocedure('public.lettres_de_mission_du_client(uuid)') is null then
    raise exception 'Les lettres de mission du client ne sont pas en base : rien à retirer.';
  end if;
end
$garde$;

drop function public.lettres_de_mission_du_client(uuid);
