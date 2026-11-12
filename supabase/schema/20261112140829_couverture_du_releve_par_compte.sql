-- LA COUVERTURE DU RELEVÉ, COMPTE PAR COMPTE (ligne 26.6, lot MCB4 : la suite des soldes, le 31 décembre, la couverture et la
-- validation par compte bancaire). PRÉPARÉE le 11/11/2026, pas appliquée ; elle suit `comptes_bancaires` (MCB1) et
-- `fin_d_identifiant_des_comptes_bancaires` (MCB2), préparées elles aussi, et s'applique avec elles, juste après, par l'outil
-- (aucune suppression : la fonction se remplace à sa signature). Le récit : HISTORIQUE.md, « 11/11/2026 — LA SUITE DES SOLDES,
-- LE 31 DÉCEMBRE, LA COUVERTURE ET LA VALIDATION PAR COMPTE BANCAIRE (MCB4) ». Son essai :
-- supabase/essais/couvertureDuReleveParCompte.sql ; son retour :
-- supabase/preparees/retour/20261111181100_retour_couverture_du_releve_par_compte.sql ; la même règle, côté cabinet :
-- `compteAttenduLeMois` et `moisManquantsParCompte` (src/lib/releveParCompte.ts), que releveParCompte.test.ts confronte à ce
-- texte.
--
-- `couverture_du_releve` (migration `banque_du_client`, 10/10/2026) rend au client les MOIS où le relevé du dossier porte un
-- mouvement : l'Accueil et « Mes pièces » en tirent les relevés qui manquent (`moisManquantsDe`). Un dossier qui tient deux
-- comptes y perdrait un trou : le mois de mars de l'un couvrirait le mars manquant de l'autre (la conception de MCB, « LA
-- COUVERTURE D'UN MOIS CACHERAIT LE TROU DE L'AUTRE »). Désormais, un mois est couvert quand le relevé y porte un mouvement
-- ET que chaque compte qui attend un relevé de ce mois y porte le sien :
--   - le principal l'attend depuis son ouverture (toujours, sans date : il est le compte du dossier depuis le début de la
--     tenue) jusqu'à sa clôture ;
--   - un autre compte, depuis son ouverture — ou, sans date, depuis son premier mouvement (on ne réclame pas un relevé d'un
--     compte qu'on ne sait pas encore ouvert) — jusqu'à sa clôture ; un compte sans date ni mouvement n'attend rien.
-- Un dossier qui ne tient qu'un compte, ou aucun, rend exactement ce qu'il rendait : les mois de ses mouvements. Ce qui ne
-- change pas : la signature et le rendu (un tableau de dates au premier du mois, ni montant, ni libellé, ni compte), le
-- contrôle d'accès (le cabinet du dossier et tout accès client, 42501 sinon), `SECURITY DEFINER` à `search_path` fixé,
-- l'exécution retirée à `anon` et à PUBLIC. Le client ne lit rien de plus : ni quel compte manque, ni combien le dossier en
-- tient (le libellé d'un compte ne s'ouvre qu'à « Banque », MCB-Q8) — dire quel compte manque au client est l'affaire de
-- « Ma banque » (MCB7).

do $garde$
begin
  if to_regclass('public.comptes_bancaires') is null then
    raise exception 'La migration comptes_bancaires (MCB1) n''est pas en base : celle-ci la suit.';
  end if;
  if to_regprocedure('public.couverture_du_releve(uuid)') is null then
    raise exception 'La fonction couverture_du_releve (migration banque_du_client) n''est pas en base : celle-ci la remplace.';
  end if;
end
$garde$;

create or replace function public.couverture_du_releve(p_dossier_id uuid) returns date[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'membre')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  return coalesce((
    select array_agg(m.mois order by m.mois)
      from (select distinct date_trunc('month', l.date::timestamp)::date as mois
              from public.lignes_bancaires l where l.dossier_id = p_dossier_id) m
     where not exists (
       select 1
         from public.comptes_bancaires c
        where c.dossier_id = p_dossier_id
          -- le compte attend un relevé de ce mois : jusqu'à sa clôture,
          and (c.clos_le is null or date_trunc('month', c.clos_le::timestamp)::date >= m.mois)
          -- depuis son ouverture ; sans date, le principal toujours, un autre compte depuis son premier mouvement,
          and (case when c.ouvert_le is not null then date_trunc('month', c.ouvert_le::timestamp)::date <= m.mois
                    when c.principal then true
                    else (select date_trunc('month', min(p.date)::timestamp)::date
                            from public.lignes_bancaires p where p.compte_bancaire_id = c.id) <= m.mois end)
          -- et n'y porte aucun mouvement.
          and not exists (select 1 from public.lignes_bancaires a
                           where a.compte_bancaire_id = c.id
                             and a.date >= m.mois and a.date < (m.mois + interval '1 month')::date)
     )
  ), '{}'::date[]);
end;
$$;

revoke execute on function public.couverture_du_releve(uuid) from public, anon;
grant execute on function public.couverture_du_releve(uuid) to authenticated;
