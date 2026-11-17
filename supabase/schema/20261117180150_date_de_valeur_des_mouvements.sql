-- EXP58-Q4 — LA DATE DE VALEUR DES MOUVEMENTS DU RELEVÉ, GARDÉE À L'IMPORT (ligne 26.6 ; décision du cabinet du 17/11/2026,
-- « ok pour la date de valeur fait la migration », la réponse (A)). PRÉPARÉE le 17/11/2026, PAS APPLIQUÉE. Le récit :
-- HISTORIQUE.md, « 17/11/2026 — EXP58-Q4 : LA DATE DE VALEUR GARDÉE À L'IMPORT (PRÉPARÉE, PAS APPLIQUÉE) » ; l'analyse :
-- docs/conceptions/58-reponses-de-l-expert-comptable.md, § 2.2 ; l'essai : supabase/essais/dateDeValeurDesMouvements.sql
-- (EN ATTENTE sans elle) ; le retour : supabase/preparees/retour/20261117170100_retour_date_de_valeur_des_mouvements.sql ; le
-- module qui redit sa borne : src/lib/dateDeValeur.ts (`DATE_DE_VALEUR_PREVUE`, baissé jusqu'à l'application).
--
-- LE CAS. L'expert-comptable fait foi de la date de VALEUR d'un mouvement quand on l'a, sinon de la date d'opération, celle
-- que l'application emploie (EL-E2, NOE-E2). Les fichiers des banques la portent souvent (« Date;Date de valeur;… » du Crédit
-- Mutuel et du CIC, la « Date de valeur » des exports des Caisses d'Épargne, l'élément DTAVAIL d'une opération OFX, « Date
-- funds are available (value date) » dans la spécification OFX) ; l'import la reconnaît mais la jette. Et un relevé importé
-- sans elle ne se réimporte pas (le dédoublonnage le refuse) : la capture doit précéder l'import des données réelles du
-- 20/11/2026. Son EMPLOI — rattacher à l'année de sa date de valeur un mouvement dont les deux dates sont de part et d'autre
-- du 31 décembre — vient plus tard (le lot L4) : aucun moteur, aucune fonction, aucun écran de calcul ne la lit.
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. `lignes_bancaires.date_valeur`, une colonne `date` NULLABLE, sans valeur par défaut : nulle sur tout mouvement d'hier,
--      sur un fichier qui ne la porte pas, et sur une date que le fichier dit mais qui ne se lit pas (l'écran l'écarte et la
--      compte, jamais devinée). Une colonne nullable sans défaut s'ajoute au catalogue seul, sans réécrire la table.
--   2. `lignes_bancaires_date_valeur_proche` : la date de valeur est à 92 jours au plus de la date d'opération, AVANT OU
--      APRÈS (une banque date la valeur d'un crédit après l'opération, d'un débit avant, et une carte à débit différé porte
--      la date du débit, en fin de mois, sous celle de l'achat). L'écart réglementaire d'un paiement est d'un jour ouvré
--      (Code monétaire et financier, art. L. 133-14 pour les opérations de paiement ; L. 131-1-1 pour un chèque), un débit
--      différé d'un mois et quelques jours : un trimestre laisse un large jeu. Ce qu'elle ferme : une colonne mal choisie,
--      une année mal lue, un jour et un mois intervertis loin de la date d'opération — une valeur que l'emploi de demain
--      lirait comme un rattachement. Elle garantit aussi à cet emploi qu'une date de valeur n'est jamais qu'à une année
--      civile de sa date d'opération. L'écran juge la même borne avant le clic (`ECART_MAXIMAL_DE_LA_DATE_DE_VALEUR`) :
--      une date au-delà s'écarte et se compte, le mouvement s'importe sans elle, et la base n'a rien à refuser.
--
-- CE QU'ELLE NE CHANGE PAS : aucune fonction, aucun déclencheur, aucune policy, aucune donnée. Le dédoublonnage de l'import
-- reste la date d'opération, le libellé et le montant : la date de valeur n'y entre pas (deux exports du même relevé, l'un
-- avec elle et l'autre sans, se reconnaissent encore). Le figement : `garder_mouvement_valide` compare la LIGNE ENTIÈRE
-- (`to_jsonb(new) is distinct from to_jsonb(old)`) d'un mouvement daté d'un exercice validé — la date de valeur s'y fige avec
-- le mouvement, sans un mot de plus ; la garde de tête vérifie que ce corps est encore celui-là, la garde de fin que son
-- déclencheur couvre toujours toute mise à jour. L'empreinte d'un exercice validé (`empreinte_exercice`,
-- `empreinte_exercice_forme_2`) ne lit pas `lignes_bancaires` : elle ne change pas. La sauvegarde lit la table par
-- `select('*')` et la restauration réinsère ce qu'elle a lu : une sauvegarde d'avant se restaure (la colonne nulle), une
-- d'après porte la date. La lecture du client « Banque » est une policy de ligne : elle rend la colonne avec la ligne ; aucun
-- client n'écrit `lignes_bancaires`.
--
-- LE SOCLE, LE JOUR DE L'APPLICATION. `lignes_bancaires` est une table du socle (créée hors migration) :
-- supabase/schema/socle/1_tables_sans_migration.sql se régénère du catalogue (supabase/essais/socle.sql) et change de deux
-- lignes, dans le `create table public.lignes_bancaires` — après `  compte_bancaire_id uuid not null,`, la ligne
--   `  date_valeur date,`
-- et, entre `  constraint lignes_bancaires_cotisation_rapprochee CHECK (…),` et
-- `  constraint lignes_bancaires_declaration_tva_rapprochee CHECK (…),`, la ligne
--   `  constraint lignes_bancaires_date_valeur_proche CHECK (((date_valeur IS NULL) OR ((date_valeur >= (date - 92)) AND (date_valeur <= (date + 92))))),`
-- (le nombre d'instructions ne change pas) ; l'inventaire compte deux objets de plus (la colonne et la contrainte). Rien
-- d'autre du socle ne bouge : ni index, ni policy, ni déclencheur.
--
-- COMMENT ELLE S'APPLIQUE : aucune instruction de retrait ni de vidage, aucune barre oblique inverse, aucune fonction
-- remplacée — PAR L'OUTIL. Indépendante des autres migrations préparées : aucune ne pose cette colonne ni cette contrainte,
-- et celles qui touchent `lignes_bancaires` (MCB5g, `ouverture_eclatee` ; `compte_propre_hors_des_exercices_valides`) n'en
-- lisent ni n'en remplacent rien. Le jour de son application, `DATE_DE_VALEUR_PREVUE` se lève, le fichier entre dans
-- supabase/schema/ sous la version que porte sa ligne d'historique, texte inchangé, et le socle se régénère (ci-dessus).

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'date_valeur' and not a.attisdropped)
     or exists (select 1 from pg_catalog.pg_constraint c where c.conname = 'lignes_bancaires_date_valeur_proche') then
    raise exception 'EXP58-Q4 : la date de valeur est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if (select format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text from pg_catalog.pg_attribute a
       where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'date' and not a.attisdropped)
     is distinct from 'date true' then
    raise exception 'EXP58-Q4 : la date d''opération de lignes_bancaires n''est plus une date non nulle : la borne ne se juge pas.';
  end if;
  -- Le figement d'un mouvement daté d'un exercice validé compare la ligne entière : la colonne neuve s'y fige d'elle-même.
  -- Un corps remplacé depuis se relit avant d'appliquer (une comparaison colonne par colonne la laisserait changer).
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_mouvement_valide()')) is distinct from 'f10207e741e52cd7684e2b9e5ccd5328' then
    raise exception 'EXP58-Q4 : garder_mouvement_valide n''a plus le corps qui fige la ligne entière : relire le figement avant d''appliquer.';
  end if;
end
$garde$;

-- ══ 1. La colonne ══════════
alter table public.lignes_bancaires add column date_valeur date;

comment on column public.lignes_bancaires.date_valeur is
  'La date de valeur du mouvement, telle que le relevé de la banque la porte (EXP58-Q4) : nulle quand le fichier ne la dit pas ou qu''elle ne se lit pas. Gardée à l''import, lue par aucun moteur avant son emploi autour du 31 décembre ; figée avec le mouvement par la validation de son exercice.';

-- ══ 2. La borne ══════════
alter table public.lignes_bancaires add constraint lignes_bancaires_date_valeur_proche
  check (date_valeur is null or (date_valeur >= date - 92 and date_valeur <= date + 92));

-- ══ 3. La garde de fin : la colonne, sa borne, et le figement qui la couvre ══════════
do $fin$
begin
  if (select format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text
        from pg_catalog.pg_attribute a
       where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'date_valeur' and not a.attisdropped)
     is distinct from 'date false false' then
    raise exception 'EXP58-Q4 : la colonne date_valeur n''est pas une date nullable sans défaut : rien n''est appliqué.';
  end if;
  if (select string_agg(pg_get_constraintdef(c.oid), ' ; ') from pg_catalog.pg_constraint c
       where c.conrelid = 'public.lignes_bancaires'::regclass and c.conname = 'lignes_bancaires_date_valeur_proche')
     is distinct from 'CHECK (((date_valeur IS NULL) OR ((date_valeur >= (date - 92)) AND (date_valeur <= (date + 92)))))' then
    raise exception 'EXP58-Q4 : la borne de la date de valeur n''est pas celle de cette migration : rien n''est appliqué.';
  end if;
  -- Le déclencheur du figement tire sur toute mise à jour (aucune liste de colonnes), avec le corps relu en tête.
  if (select count(*) from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.lignes_bancaires'::regclass and t.tgname = 'lignes_bancaires_figees_par_la_validation'
         and t.tgfoid = to_regprocedure('public.garder_mouvement_valide()') and t.tgtype = 31 and t.tgattr = ''::int2vector
         and t.tgenabled = 'O' and not t.tgisinternal) <> 1
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
          where p.oid = to_regprocedure('public.garder_mouvement_valide()')) is distinct from 'f10207e741e52cd7684e2b9e5ccd5328' then
    raise exception 'EXP58-Q4 : le figement d''un mouvement validé ne couvre plus toute la ligne : rien n''est appliqué.';
  end if;
end
$fin$;
