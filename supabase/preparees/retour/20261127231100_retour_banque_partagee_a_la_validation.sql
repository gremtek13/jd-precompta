-- LE RETOUR de la migration `banque_partagee_a_la_validation` (supabase/preparees/20261127231000_…, préparée le 27/11/2026 ;
-- ligne 26.6, MCBR2-Q2).
-- Il retire le déclencheur de contrainte de `exercices_valides` et sa fonction : la validation d'un exercice dont un second compte
-- s'écrit au 512 du principal redevient celle d'hier — retenue par la base seulement l'année où l'ouverture suivante s'éclate
-- (le filet de MCBR-Q2, 261), ailleurs par le seul préalable `banque-partagee-retenue` de l'application. DESTRUCTIF par sa forme
-- (des `drop`), il ne perd aucune donnée : la migration n'en pose aucune. À coller par le cabinet, AVANT le retour de
-- `ouverture_eclatee_par_compte`, qui retire `soldes_des_comptes_au_trente_et_un`, que ce filet lit.

do $garde$
begin
  if to_regprocedure('public.garder_banque_partagee_a_la_validation()') is null then
    raise exception 'La migration banque_partagee_a_la_validation n''est pas en base : rien à retirer.';
  end if;
end
$garde$;

drop trigger exercices_valides_releves_de_la_banque_partagee on public.exercices_valides;
drop function public.garder_banque_partagee_a_la_validation();

do $fin$
begin
  if to_regprocedure('public.garder_banque_partagee_a_la_validation()') is not null
     or exists (select 1 from pg_trigger where tgrelid = 'public.exercices_valides'::regclass
                 and tgname = 'exercices_valides_releves_de_la_banque_partagee') then
    raise exception 'Garde de fin : le filet de la banque partagée est encore en base.';
  end if;
end
$fin$;
