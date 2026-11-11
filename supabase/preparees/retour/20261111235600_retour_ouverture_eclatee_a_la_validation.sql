-- LE RETOUR de la migration `ouverture_eclatee_a_la_validation` (supabase/preparees/20261111235500_…, ligne 26.6, MCB5G-Q2).
-- Il retire le déclencheur de `exercices_valides` et sa fonction : la validation redevient celle d'hier, que seul le préalable
-- `ouverture-a-eclater` de l'application retient. DESTRUCTIF par sa forme (des `drop`), il ne perd aucune donnée : la
-- migration n'en pose aucune. À coller par le cabinet, AVANT le retour de `ouverture_eclatee_par_compte`, qui se refuse tant
-- que ce filet est en base (il appelle `ouverture_eclatee_attendue`, que ce retour-là retire).

do $garde$
begin
  if to_regprocedure('public.garder_ouverture_eclatee_a_la_validation()') is null then
    raise exception 'La migration ouverture_eclatee_a_la_validation n''est pas en base : rien à retirer.';
  end if;
end
$garde$;

drop trigger exercices_valides_ouverture_eclatee on public.exercices_valides;
drop function public.garder_ouverture_eclatee_a_la_validation();
