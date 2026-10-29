-- LE TÉMOIN DU BANC (outils/leurre/banc.py ; SUR UNE RÉPLIQUE SEULEMENT) : un essai FAUTIF planté, que le banc rejoue
-- avant tout autre et doit voir de ses trois façons — sinon il est aveugle, et ne conclut rien. Il commet les trois
-- fautes que l'audit du 29/10/2026 a trouvées dans les essais de la base :
--   1. un compte de toute la base (la sortie L n'est plus celle de P) ;
--   2. une valeur du « premier » dossier par son identifiant (un motif du leurre paraît dans la sortie) ;
--   3. une écriture dans ce dossier, annulée (le détecteur la voit quand même).
-- Il n'est pas dans supabase/essais : rien ne le rejoue en production.
select 'témoin : dossiers', count(*) from dossiers;
select 'témoin : le premier dossier', nom from dossiers order by id limit 1;
do $temoin$
begin
  update dossiers set nom = nom where id = (select id from dossiers order by id limit 1);
  raise exception 'ANNULATION_TEMOIN';
exception when raise_exception then
  null;
end
$temoin$;
