-- LES BORNES DES TROIS SEAUX DU STOCKAGE (ligne 22.6 de la feuille de route, préparée le 12/10/2026).
--
-- Aucun seau ne bornait ni la taille ni le type de ce qu'on y dépose, et `cabinet-logos`, PUBLIC, acceptait un SVG,
-- qui peut porter du script servi depuis le domaine du stockage. Le serveur de stockage applique lui-même ces deux
-- colonnes à chaque dépôt (413 au-delà de la taille, 415 hors des types, `type/sous-type` comparé sans ses paramètres) ;
-- il ne touche pas aux fichiers déjà là, et aucun ne les dépasse (mesuré le 12/10/2026 : 146 objets dans `pieces`, le
-- plus gros 1,4 Mo, aucun d'un autre type que ceux-ci ; un pack, un récapitulatif et un logo PNG de 26 Kio).
--
-- Les mêmes bornes vivent dans src/lib/bornesStockage.ts, où l'application les vérifie AVANT l'envoi et dit le refus en
-- français. bornesStockage.test.ts confronte les deux valeur par valeur ; depotsDansLesSeaux.test.ts exige que chaque
-- dépôt de la source envoie un type que ce fichier admet pour son seau, et que chaque type admis ici soit envoyé par un
-- dépôt — ni plus, ni moins.
--
-- À APPLIQUER APRÈS le déploiement de l'application et de receive-email qui les portent : avant, un relevé CSV qu'un
-- navigateur sous Windows étiquette application/vnd.ms-excel, ou une pièce jointe que son expéditeur déclare
-- application/octet-stream, serait refusé par le stockage, et en anglais.
--
-- Pièces : 20 Mio, HYPOTHÈSE S226-Q1 à confirmer par le cabinet (une valeur à changer ici, dans
-- src/lib/bornesStockage.ts et dans la copie de receive-email). Packs : 50 Mio, le plafond du plan gratuit. Logos :
-- 500 Kio, PNG, JPEG ou WebP, jamais de SVG.
--
-- Retour arrière, qui rend les trois seaux à l'état d'avant (sans borne) :
--   update storage.buckets set file_size_limit = null, allowed_mime_types = null
--    where id in ('pieces', 'packs', 'cabinet-logos');

do $$
begin
  if (select count(*) from storage.buckets where id in ('pieces', 'packs', 'cabinet-logos')) <> 3 then
    raise exception 'Les trois seaux du stockage ne sont pas tous là : aucune borne n''est posée';
  end if;
end
$$;

update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'text/plain']
 where id = 'pieces';

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
 where id = 'packs';

update storage.buckets
   set file_size_limit = 512000,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
 where id = 'cabinet-logos';
