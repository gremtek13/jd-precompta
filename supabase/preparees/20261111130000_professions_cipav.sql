-- LES PROFESSIONS RELEVANT DE LA CIPAV DANS LE VOLET SOCIAL (ligne 27.1, RET-Q1 tranchée le 11/11/2026 : la CIPAV
-- maintenant). Récit : HISTORIQUE.md, « 11/11/2026 — LA CIPAV DANS L'ESTIMATION DES COTISATIONS (LIGNE 27.1, RET-Q1)
-- (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- La profession d'un dossier vit dans `volet_social_pamc.profession`, une ligne par exercice, sous une liste fermée de
-- cinq valeurs : les praticiens et auxiliaires médicaux conventionnés. Une sixième s'y ajoute, `liberal_cipav` : une
-- profession libérale réglementée rattachée à la CIPAV, telle que le moteur public de l'Urssaf la range (modele-ti
-- 0.1.0, « profession libérale . réglementée . métier . rattaché Cipav » : architecte, architecte d'intérieur,
-- économiste de la construction, maître d'œuvre, géomètre-expert ; moniteur de ski, guide de haute montagne,
-- accompagnateur de moyenne montagne ; ostéopathe, psychologue, psychothérapeute, psychomotricien, ergothérapeute,
-- diététicien, chiropracteur ; ingénieur-conseil ; guide-conférencier ; artiste autre qu'artiste-auteur ; expert devant
-- les tribunaux ; expert en automobile ; mandataire judiciaire à la protection des majeurs). Le moteur les calcule toutes
-- de même : une seule valeur suffit, comme `auxiliaire_medical` porte cinq professions.
--
-- CE QU'ELLE CHANGE : la contrainte de la colonne, ÉLARGIE (les cinq valeurs d'hier restent, une s'ajoute) ; le
-- commentaire de la table. Aucune ligne n'est lue, réécrite ni retirée ; aucune policy, fonction ni droit ne change.
-- Le texte porte `drop constraint` (on ne remplace pas un CHECK autrement) : l'outil d'application attend une
-- confirmation, et le cabinet la colle dans l'éditeur SQL avec sa ligne d'historique.
--
-- La garde de tête refuse une base où la contrainte n'est plus celle d'hier : elle aurait été changée hors de cette
-- migration, et la remplacer effacerait ce changement.

do $garde$
begin
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = 'public.volet_social_pamc'::regclass and c.conname = 'volet_social_pamc_profession_check')
     is distinct from
     'CHECK ((profession = ANY (ARRAY[''auxiliaire_medical''::text, ''sage_femme''::text, ''medecin_secteur_1''::text, ''medecin_secteur_2''::text, ''chirurgien_dentiste''::text])))'
  then
    raise exception 'professions_cipav : la contrainte des professions n''est plus celle du 11/11/2026, rien n''est changé';
  end if;
end
$garde$;

alter table public.volet_social_pamc
  drop constraint volet_social_pamc_profession_check,
  add constraint volet_social_pamc_profession_check check (profession in (
    'auxiliaire_medical', 'sage_femme', 'medecin_secteur_1', 'medecin_secteur_2', 'chirurgien_dentiste', 'liberal_cipav'));

comment on table public.volet_social_pamc is
  'Chiffres du volet social d''un praticien ou auxiliaire médical conventionné (déclaration de '
  'revenus, rubriques DSCS, DSAV, DSAW et DSAT), une ligne par exercice à partir des revenus 2025 '
  '(ligne 27 de la feuille de route, décision du cabinet du 28/09/2026). Recettes brutes nulles : '
  'l''application reprend la ligne 4 de la 2035-A. Sert aussi à estimer les cotisations Urssaf. '
  'Depuis le 11/11/2026 (ligne 27.1, RET-Q1), la profession peut être liberal_cipav : une profession libérale '
  'réglementée rattachée à la CIPAV, qui ne déclare aucune de ces rubriques (l''application les écrit nulles).';

comment on column public.volet_social_pamc.profession is
  'La profession de l''exercice, qui désigne la caisse de retraite : auxiliaire_medical (CARPIMKO), sage_femme et '
  'chirurgien_dentiste (CARCDSF), medecin_secteur_1 et medecin_secteur_2 (CARMF), liberal_cipav (CIPAV, recouvrée par '
  'l''Urssaf ; la liste des métiers est celle du moteur public de l''Urssaf, « métier . rattaché Cipav »). Nulle tant '
  'que le cabinet ne l''a pas choisie.';
