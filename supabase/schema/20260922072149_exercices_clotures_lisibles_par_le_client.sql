-- Le CLIENT doit pouvoir LIRE les exercices clôturés de son dossier.
--
-- La table est née le 22/09/2026 avec une seule policy, réservée au cabinet (`admin_du_dossier`).
-- Elle suffisait à son usage d'origine (purge du texte OCR, RGPD.md §8.3), qui est un geste de
-- cabinet. Elle ne suffit plus : « ce qu'il reste à envoyer » cesse de réclamer les pièces d'un
-- exercice clôturé, et ce bloc s'affiche sur TROIS écrans dont deux sont côté client (accueil,
-- « Mes pièces »). Sans cette lecture, le client continuerait de voir réclamer ce que le cabinet
-- a cessé d'attendre — or ces trois écrans doivent dire la même chose au même moment.
--
-- LECTURE SEULE, et c'est la convention du projet pour une table que le client ne pilote pas
-- (cf. `lignes_bancaires`, `cotisations_declarees`) : clôturer un exercice reste un geste du cabinet.
create policy "membres lisent les exercices clotures de leur dossier" on public.exercices_clotures
  for select
  to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.dossier_id = exercices_clotures.dossier_id and m.user_id = auth.uid()
  ));
