-- RETOUR D'OPT6 — la frontière de la tenue retirée de la base (supabase/preparees/20261126120000_frontiere_de_la_tenue.sql).
-- Il retire quatre déclencheurs et une fonction, n'écrit ni ne supprime aucune donnée : la base revient à OPT1, où seul
-- l'écran et les Edge Functions tiennent la tenue fermée. À coller par le cabinet (le mot `drop` retient l'outil), dans une
-- transaction, avec sa ligne d'historique ; `FRONTIERE_DE_LA_TENUE_PREVUE` se rebaisse dans le même commit.
do $garde$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_frontiere_de_la_tenue()')) is distinct from 'bf63528146fe025c3a2207a63534352a' then
    raise exception 'Retour d''OPT6 : la garde de la frontière de la tenue n''est pas celle de la migration (absente ou remplacée) : rien n''est retiré.';
  end if;
end
$garde$;

drop trigger frontiere_de_la_tenue on public.exercices_valides;
drop trigger frontiere_de_la_tenue on public.situations_publiees;
drop trigger frontiere_de_la_tenue on public.ecritures_libres;
drop trigger frontiere_de_la_tenue_a_la_modification on public.ecritures_libres;
drop function public.garder_frontiere_de_la_tenue();
