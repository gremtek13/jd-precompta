-- LE RETOUR de la migration `ouverture_suivante_a_la_validation` (supabase/schema/20261127214813_…, en production depuis le
-- 27/11/2026, 261, par l'outil ; préparée sous 20261127190000 ; ligne 26.6, MCBR-Q2).
-- Il retire le déclencheur de contrainte de `exercices_valides` et sa fonction : la validation d'un exercice redevient celle
-- d'hier, que seul le préalable `ouverture-suivante-retenue` de l'application retient. DESTRUCTIF par sa forme (des `drop`), il
-- ne perd aucune donnée : la migration n'en pose aucune. À coller par le cabinet, AVANT le retour de
-- `ouverture_eclatee_par_compte`, qui retire `ouverture_eclatee_attendue`, que ce filet appelle.

do $garde$
begin
  if to_regprocedure('public.garder_ouverture_suivante_a_la_validation()') is null then
    raise exception 'La migration ouverture_suivante_a_la_validation n''est pas en base : rien à retirer.';
  end if;
  -- Le filet de la banque partagée (MCBR2-Q2), préparé le 27/11/2026, tire après celui-ci : retiré sous lui, la base dirait son
  -- refus là où l'application dit celui de l'éclatement (`ouverture-suivante-retenue`). Les retours se collent à rebours.
  if to_regprocedure('public.garder_banque_partagee_a_la_validation()') is not null then
    raise exception 'Le filet de la banque partagée (banque_partagee_a_la_validation, MCBR2-Q2) est en base : son retour se colle d''abord.';
  end if;
end
$garde$;

drop trigger exercices_valides_ouverture_suivante on public.exercices_valides;
drop function public.garder_ouverture_suivante_a_la_validation();

do $fin$
begin
  if to_regprocedure('public.garder_ouverture_suivante_a_la_validation()') is not null
     or exists (select 1 from pg_trigger where tgrelid = 'public.exercices_valides'::regclass
                 and tgname = 'exercices_valides_ouverture_suivante') then
    raise exception 'Garde de fin : le filet de l''ouverture suivante est encore en base.';
  end if;
end
$fin$;
