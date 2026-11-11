-- RETOUR ARRIÈRE DE `dirigeant_au_468` (PC4-Q2) — le rôle `autres_debiteurs_crediteurs` du catalogue rendu à sa seule racine
-- 467. Il ne supprime rien, mais il se REFUSE tant qu'un dossier tient ce rôle sous 468, qu'un dirigeant y est, qu'une
-- ligne d'écriture, un à-nouveau, un mouvement du relevé ou un lettrage fait à la main y porte un compte : le plan de ce
-- dossier deviendrait illisible pour l'application et refusé par sa garde. La migration :
-- supabase/schema/20261111204559_dirigeant_au_468.sql (en production depuis le 11/11/2026, version 20261111204559) ; le récit : HISTORIQUE.md, « 11/11/2026 — PC4-Q2 ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`DIRIGEANT_AU_468_PREVU`, le fichier de la migration sorti de
-- l'export) et remise en ligne, PUIS ce texte, avec la ligne d'historique de la migration retirée (sans elle, les essais
-- planComptable.sql et reglerLePlanDuDossier.sql attendraient l'état d'après).
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : `signature.sql` inchangée (une donnée du catalogue, aucun objet),
-- l'empreinte du catalogue de planComptable.sql celle d'avant, et les trois contrôles de l'export.
do $garde$
begin
  if not exists (select 1 from public.roles_comptables r
                  where r.role = 'autres_debiteurs_crediteurs' and r.racines = array['467', '468']) then
    raise exception 'La migration dirigeant_au_468 n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if exists (select 1 from public.plan_comptable_dossier p where p.role = 'autres_debiteurs_crediteurs' and left(p.compte, 3) = '468')
     or exists (select 1 from public.dossiers d where left(d.compte_notes_de_frais, 3) = '468')
     or exists (select 1 from public.ecritures_brouillon e where left(e.compte, 3) = '468')
     or exists (select 1 from public.a_nouveaux a where left(a.compte, 3) = '468')
     or exists (select 1 from public.lignes_bancaires l where left(l.compte_bilan, 3) = '468')
     or exists (select 1 from public.lettrages_manuels m where left(m.compte, 3) = '468') then
    raise exception 'Un dossier tient le 468 (son plan, son dirigeant, une écriture, un à-nouveau, un mouvement ou un lettrage) : rendre le catalogue au 467 seul le laisserait hors de sa racine. Le cabinet décide d''abord de ces dossiers.';
  end if;
end
$garde$;

update public.roles_comptables
   set racines = array['467']
 where role = 'autres_debiteurs_crediteurs' and racines = array['467', '468'];
