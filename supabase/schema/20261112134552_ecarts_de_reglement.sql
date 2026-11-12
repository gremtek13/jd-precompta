-- LE CHANGE ET LES FRAIS BANCAIRES À PART, EN ENGAGEMENT (ligne 31 de la feuille de route, 31-changeFrais ; PRÉPARÉE le
-- 12/11/2026, PAS APPLIQUÉE). Le récit : HISTORIQUE.md, « 12/11/2026 — LE CHANGE ET LES FRAIS BANCAIRES À PART, EN
-- ENGAGEMENT (LIGNE 31) » ; l'essai : supabase/essais/ecartsDeReglement.sql ; le retour :
-- supabase/preparees/retour/20261112170100_retour_ecarts_de_reglement.sql ; l'application : src/lib/rolesDuChange.ts
-- (`ECARTS_DE_REGLEMENT_PREVUS`, baissé) et src/lib/ecartsDeReglement.ts.
--
-- CE QU'ELLE AJOUTE, ET RIEN D'AUTRE : deux rôles au catalogue (`roles_comptables`), sur lesquels le règlement d'une facture
-- en engagement écrit sa perte ou son gain de change, à part ; le frais bancaire a déjà le sien (`services_bancaires`,
-- 627000, migration `source_de_la_vente`). Aucune fonction ne change : `plan_du_dossier` rend une ligne par rôle du
-- catalogue, `compte_du_role` le défaut d'un rôle qu'un dossier ne règle pas, `garder_plan_comptable_dossier` et
-- `regler_plan_du_dossier` jugent un compte sous les racines du catalogue ; `garder_comptes_des_pieces` ne nomme ni l'un
-- ni l'autre (une ligne de pièce à leur compte passe, comme au 627). Les écritures d'un règlement s'écrivent par
-- l'application, comme hier : aucune fonction du relevé ne les compose ni ne les vérifie.
--
-- LEUR COMPTE PAR DÉFAUT (CHG-Q1) : le règlement ANC n° 2015-05 (exercices ouverts depuis le 1er janvier 2017) range les
-- écarts de change sur créances et dettes COMMERCIALES au 656 et au 756 (PCG, art. 946-65 complété), le 666 et le 766
-- restant aux opérations financières ; un règlement de facture est commercial. Le 666 et le 766 sont parmi leurs racines :
-- un dossier les choisit dans son plan, si le cabinet maintient sa réponse du 18/10/2026.
--
-- L'ORDRE : après la dernière migration préparée qui la précède (rangs 340 et 350 : le 330 est au `personnel` de B7) ; puis
-- lever `ECARTS_DE_REGLEMENT_PREVUS` et déployer — levé avant, chaque plan lu serait incomplet et aucun onglet ne se
-- monterait ; appliquée sans lui, la lecture du plan ignore les deux rôles, et rien ne change.

do $$
begin
  if exists (select 1 from public.roles_comptables r where r.role in ('pertes_de_change', 'gains_de_change')) then
    raise exception 'Les rôles du change sont déjà au catalogue : relire la migration avant de l''appliquer.';
  end if;
  -- Aucune racine du catalogue n'en commence une des leurs, ni l'inverse (art. 1131-2 : un compte, un rôle).
  if exists (select 1 from public.roles_comptables r cross join unnest(r.racines) as u(racine)
              cross join unnest(array['656', '666', '756', '766']) as n(neuve)
             where left(u.racine, length(n.neuve)) = n.neuve or left(n.neuve, length(u.racine)) = u.racine) then
    raise exception 'Une racine du catalogue recouvre celles du change : relire la migration avant de l''appliquer.';
  end if;
end
$$;

insert into public.roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre) values
  ('pertes_de_change', array['656', '666'], '656000', 'Pertes de change sur créances et dettes commerciales', null, 340),
  ('gains_de_change', array['756', '766'], '756000', 'Gains de change sur créances et dettes commerciales', null, 350);
