-- LE COMPTE D'AMORTISSEMENT GARDE LE SIXIÈME CHIFFRE DU COMPTE DU BIEN. `'28' || substr(p_compte, 2, 4)` n'en gardait
-- que les chiffres 2 à 5 : 218310 et 218311 rendaient tous deux 281831, et deux comptes de biens s'amortissaient sur
-- un seul. Le plan comptable général (règlement ANC n° 2014-03, version consolidée au 1er janvier 2026) donne au
-- compte 280 « même ventilation que celle du compte 20 » et au compte 281 « même ventilation que celle du compte
-- 21 » (art. 1121-1) ; et « le zéro terminal ou la série terminale de zéros a une signification de regroupement de
-- comptes ou de compte global » (art. 1131-2).
--
-- La règle devient : 28 suivi du compte sans son 2 et sans ses zéros de fin, complété à six chiffres. Elle rend le
-- même compte qu'avant pour tout compte dont le sixième chiffre est un zéro — les huit natures communes, et toutes
-- les natures de la base au 09/10/2026 —, et garde le sixième chiffre quand il est significatif : 218311 → 2818311.
-- `rpad` vers la plus grande des deux longueurs, jamais vers six seulement : `rpad` tronque une chaîne plus longue
-- que la longueur demandée, et le défaut reviendrait.
--
-- Le même calcul que `compteAmortissement` (src/lib/amortissements.ts) et sa copie dans l'assistant ;
-- `ecrire_dotation_amortissement`, qui vérifie la dotation composée par l'application, l'appelle sans changer.
-- Les droits d'exécution de la fonction restent ceux qu'elle avait.
create or replace function public.compte_amortissement(p_compte text) returns text
language sql
immutable
strict
set search_path = public
as $$
  select rpad(v.compte, greatest(length(v.compte), 6), '0')
  from (select rtrim('28' || substr(p_compte, 2), '0') as compte) as v
$$;
