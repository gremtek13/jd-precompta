-- PC4-Q2 — LE 468 DU DIRIGEANT NON ASSOCIÉ (ligne 43 ; décisions du cabinet : 43-Q7, « oui » le 17/10/2026 — garder le 467
-- par défaut et permettre le 468 — ; PC4-Q2, le 11/11/2026, à la recommandation — dans une migration à part, sans
-- suppression, après PC4 et avant l'écran du plan). PRÉPARÉE, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 11/11/2026 — PC4-Q2 :
-- LE 468 DU DIRIGEANT NON ASSOCIÉ, AU CATALOGUE (PRÉPARÉE, PAS APPLIQUÉE) » ; les essais : supabase/essais/planComptable.sql
-- (l'empreinte du catalogue, l'étape 26b) et reglerLePlanDuDossier.sql (l'étape 32) ; le retour :
-- supabase/preparees/retour/20261111174100_retour_dirigeant_au_468.sql.
--
-- SOURCE. Le plan comptable général (règlement ANC n° 2014-03 consolidé au 1er janvier 2026), art. 1214-46 : « Les opérations
-- dont le solde peut être indifféremment soit débiteur, soit créditeur sont comptabilisées à des subdivisions ouvertes sous le
-- compte 467 « Divers comptes débiteurs et produits à recevoir » ou le compte 468 « Divers comptes créditeurs et charges à
-- payer » » — la version de 2019 ne nommait que le 467 ; art. 1131-1 (un compte divisionnaire commence par le numéro du compte
-- qu'il subdivise).
--
-- CE QU'ELLE FAIT : le rôle `autres_debiteurs_crediteurs` du catalogue (`roles_comptables`) — le compte du dirigeant non
-- associé en engagement — admet la racine 468 à côté de la 467. Son compte par défaut reste 467000, son libellé par défaut
-- celui du 467 : rien ne change pour un dossier qui ne règle pas ce rôle, c'est-à-dire pour tous aujourd'hui.
--
-- CE QUI LIT LE CATALOGUE, et ce que la racine de plus y change (sans qu'aucune fonction soit remplacée) :
--   - `regler_plan_du_dossier` et `garder_plan_comptable_dossier` : un dossier peut tenir ce rôle sous 468, et leurs refus
--     disent « (467 ou 468) » ;
--   - le contrôle du dirigeant (PC4) : le dirigeant d'un dossier peut être au 468 dès que son plan y tient ce rôle, et
--     `regler_plan_du_dossier` l'y déplace avec lui (PC3-Q1) ;
--   - `garder_comptes_des_pieces` : une ligne de pièce sous 468 porte désormais le compte du plan pour ce rôle, ou celui de
--     la catégorie de sa pièce. Relevé en production le 11/11/2026 : aucune ligne d'écriture, aucune catégorie, aucun
--     mouvement du relevé, aucun à-nouveau ni aucun dirigeant sous 468, et aucun plan réglé ;
--   - `plan_du_dossier` : inchangé — le libellé d'un compte de rôle est celui que le plan lui donne, sinon celui du catalogue
--     (conception, § 3.9). Un 468 réglé sans libellé s'y lirait sous l'intitulé du 467 : l'écran du plan lui donnera le sien,
--     « Divers comptes créditeurs et charges à payer ». Le FEC, la balance et la révision nomment déjà un 468 par la
--     nomenclature (`libelleDuPlanComptable`, src/lib/comptes.ts).
--
-- CE QU'ELLE NE CHANGE PAS : `refus_compte_de_bilan` — un mouvement du relevé sur un 468 qui n'est pas le compte du dirigeant
-- reste refusé comme « compte de régularisation » : traiter le 468 comme le 467 sur le relevé est la correction à part que
-- 43-Q12 a acceptée le 17/10/2026, une autre migration. Le compte du dirigeant, lui, se juge avant cette branche : un
-- dirigeant au 468 garde la phrase de « Virement personnel ».
--
-- CE QUE LE TEXTE RETIRE : rien — une mise à jour d'une ligne du catalogue, qu'aucune table ne référence par sa racine. Ni
-- barre oblique inverse, ni retour chariot. Elle s'applique PAR L'OUTIL.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la version
-- que porte sa ligne d'historique, texte inchangé ; `DIRIGEANT_AU_468_PREVU` (src/lib/dirigeantAu468.ts) se lève alors, et la
-- copie du catalogue dans l'application (`ROLES_COMPTABLES`, src/lib/planComptable.ts) porte la racine de plus.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une base sans PC4 (la migration `regler_le_plan_du_dossier`) ; un catalogue dont ce
-- rôle n'est plus celui que cette migration suppose ; et une racine 468 déjà prise par un autre rôle, ou qui en commencerait
-- une autre (deux rôles ne partagent jamais un compte).
do $garde$
begin
  if exists (select 1 from public.roles_comptables r where r.role = 'autres_debiteurs_crediteurs' and '468' = any (r.racines)) then
    raise exception 'La migration dirigeant_au_468 est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regprocedure('public.regler_plan_du_dossier(uuid, jsonb)') is null then
    raise exception 'PC4 (la migration regler_le_plan_du_dossier) manque : cette migration vient après elle.';
  end if;
  if not exists (select 1 from public.roles_comptables r
                  where r.role = 'autres_debiteurs_crediteurs' and r.racines = array['467'] and r.compte_defaut = '467000'
                    and r.libelle_defaut = 'Divers comptes débiteurs et produits à recevoir' and r.prefixe_auxiliaire_defaut is null) then
    raise exception 'Le rôle autres_debiteurs_crediteurs du catalogue n''est plus celui que cette migration suppose (racine 467, défaut 467000) : relire la migration contre la base avant de l''appliquer.';
  end if;
  if exists (select 1 from public.roles_comptables r cross join unnest(r.racines) as u(racine)
              where r.role <> 'autres_debiteurs_crediteurs' and (left(u.racine, 3) = '468' or left('468', length(u.racine)) = u.racine)) then
    raise exception 'Une racine d''un autre rôle du catalogue commence par 468, ou 468 commence par elle : deux rôles partageraient un compte.';
  end if;
end
$garde$;

-- ══ 1. La racine de plus ══════════
update public.roles_comptables
   set racines = array['467', '468']
 where role = 'autres_debiteurs_crediteurs' and racines = array['467'];

-- ══ 2. La garde de fin : ce que le catalogue porte désormais ══════════
do $fin$
begin
  if not exists (select 1 from public.roles_comptables r
                  where r.role = 'autres_debiteurs_crediteurs' and r.racines = array['467', '468'] and r.compte_defaut = '467000') then
    raise exception 'Le rôle autres_debiteurs_crediteurs ne porte pas les racines 467 et 468 après la migration : rien n''est appliqué.';
  end if;
end
$fin$;
