-- Ligne 26.6 de la feuille de route, étape (b) : le BARÈME KILOMÉTRIQUE en base, première moitié de l'écriture
-- du forfait (la seconde, `forfait_kilometrique_ecrit`, écrit le forfait et le vérifie contre ce barème).
--
-- `indemnite_kilometrique_centimes` refait le calcul de src/lib/baremeKilometrique.ts en entiers : le
-- kilométrage × le coefficient en millièmes d'euro, plus le forfait de la tranche, arrondi au centime, le
-- demi-centime vers le haut. baremeKilometrique.test.ts lit les valeurs ci-dessous et les compare aux siennes,
-- et une empreinte relevée ici confronte les deux calculs sur toutes les tranches. Une année absente ne calcule
-- rien : appliquer le barème d'une autre année produirait une déduction plausible et fausse.

-- Le barème : une ligne par type de véhicule, plage de puissance fiscale et motorisation (les 100 %
-- électriques ont leur table), avec ses trois tranches — de 0 à `borne_1` km, jusqu'à `borne_2`, au-delà.
-- Chaque tranche est « km × coefficient + forfait », le coefficient en millièmes d'euro par kilomètre, le
-- forfait en euros. Le kilométrage TOTAL choisit la tranche, et sa formule s'applique à ce même total — ce
-- n'est pas un barème progressif par tranches cumulées. Les années qui partagent une table la partagent ici
-- aussi (`annees`) : le barème des revenus 2026 est celui de 2025, non revalorisé.
create function public.bareme_kilometrique()
returns table (
  annees integer[], type text, puissance_min integer, puissance_max integer, electrique boolean,
  borne_1 integer, coefficient_1 integer, forfait_1 integer,
  borne_2 integer, coefficient_2 integer, forfait_2 integer,
  coefficient_3 integer, forfait_3 integer
)
language sql
immutable
set search_path = public
as $$
  select * from (values
    -- ── DÉBUT BARÈME ──
    (array[2025, 2026], 'voiture', 0, 3, false, 5000, 529, 0, 20000, 316, 1065, 370, 0),
    (array[2025, 2026], 'voiture', 4, 4, false, 5000, 606, 0, 20000, 340, 1330, 407, 0),
    (array[2025, 2026], 'voiture', 5, 5, false, 5000, 636, 0, 20000, 357, 1395, 427, 0),
    (array[2025, 2026], 'voiture', 6, 6, false, 5000, 665, 0, 20000, 374, 1457, 447, 0),
    (array[2025, 2026], 'voiture', 7, 99, false, 5000, 697, 0, 20000, 394, 1515, 470, 0),
    (array[2025, 2026], 'voiture', 0, 3, true, 5000, 635, 0, 20000, 379, 1278, 444, 0),
    (array[2025, 2026], 'voiture', 4, 4, true, 5000, 727, 0, 20000, 408, 1596, 488, 0),
    (array[2025, 2026], 'voiture', 5, 5, true, 5000, 763, 0, 20000, 428, 1674, 512, 0),
    (array[2025, 2026], 'voiture', 6, 6, true, 5000, 798, 0, 20000, 449, 1748, 536, 0),
    (array[2025, 2026], 'voiture', 7, 99, true, 5000, 836, 0, 20000, 473, 1818, 564, 0),
    (array[2025, 2026], 'moto', 1, 2, false, 3000, 395, 0, 6000, 99, 891, 248, 0),
    (array[2025, 2026], 'moto', 3, 5, false, 3000, 468, 0, 6000, 82, 1158, 275, 0),
    (array[2025, 2026], 'moto', 6, 99, false, 3000, 606, 0, 6000, 79, 1583, 343, 0),
    (array[2025, 2026], 'moto', 1, 2, true, 3000, 474, 0, 6000, 119, 1069, 298, 0),
    (array[2025, 2026], 'moto', 3, 5, true, 3000, 562, 0, 6000, 98, 1390, 330, 0),
    (array[2025, 2026], 'moto', 6, 99, true, 3000, 727, 0, 6000, 95, 1900, 412, 0),
    (array[2025, 2026], 'cyclomoteur', 0, 0, false, 3000, 315, 0, 6000, 79, 711, 198, 0),
    (array[2025, 2026], 'cyclomoteur', 0, 0, true, 3000, 378, 0, 6000, 95, 853, 238, 0)
    -- ── FIN BARÈME ──
  ) as b (annees, type, puissance_min, puissance_max, electrique, borne_1, coefficient_1, forfait_1,
          borne_2, coefficient_2, forfait_2, coefficient_3, forfait_3)
$$;

-- L'indemnité d'un véhicule pour un exercice, en centimes : nulle (null) quand le barème de l'année n'est pas
-- renseigné ou que le véhicule n'entre dans aucune de ses lignes. Même calcul que
-- indemniteKilometriqueCentimes (src/lib/baremeKilometrique.ts).
create function public.indemnite_kilometrique_centimes(
  p_annee integer, p_type text, p_puissance integer, p_electrique boolean, p_km integer
) returns bigint
language sql
immutable
strict
set search_path = public
as $$
  select case
           when p_km <= b.borne_1 then (p_km::bigint * b.coefficient_1 + b.forfait_1::bigint * 1000 + 5) / 10
           when p_km <= b.borne_2 then (p_km::bigint * b.coefficient_2 + b.forfait_2::bigint * 1000 + 5) / 10
           else (p_km::bigint * b.coefficient_3 + b.forfait_3::bigint * 1000 + 5) / 10
         end
  from public.bareme_kilometrique() b
  where p_annee = any (b.annees) and b.type = p_type and b.electrique = p_electrique
    and p_puissance between b.puissance_min and b.puissance_max and p_km >= 0
$$;

revoke execute on function public.bareme_kilometrique() from public, anon;
grant execute on function public.bareme_kilometrique() to authenticated;
revoke execute on function public.indemnite_kilometrique_centimes(integer, text, integer, boolean, integer) from public, anon;
grant execute on function public.indemnite_kilometrique_centimes(integer, text, integer, boolean, integer) to authenticated;
