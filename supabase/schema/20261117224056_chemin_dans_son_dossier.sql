-- CFCS-Q1 (A) : LE CHEMIN D'UN FICHIER DANS SON DOSSIER, EN BASE (ligne 44) — PRÉPARÉE, PAS APPLIQUÉE.
-- Rien ne se détruit : trois contraintes CHECK s'ajoutent, aucune ligne ni aucun objet ne se retire, et le texte ne porte
-- aucun mot de suppression : elle passe par l'outil (`apply_migration`).
--
-- La décision : CFCS-Q1, réponse (A) — « une contrainte en base, en plus des écrans », posée puis validée après une
-- lecture qui confirme zéro ligne fautive. Le récit : HISTORIQUE.md, « 12/11/2026 — CFCS-Q1 : LE CHEMIN D'UN FICHIER DANS
-- SON DOSSIER, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; la défense des écrans : src/lib/cheminDuDossier.ts. L'essai :
-- supabase/essais/cheminsDansLeurDossier.sql (sur une réplique seulement : il insère des lignes). Le retour :
-- supabase/preparees/retour/20261112220100_retour_chemin_dans_son_dossier.sql (à coller : il retire les contraintes).
--
-- LE DÉFAUT (relecture de sécurité de LM6 et INAL6, 12/11/2026, sondé). Le premier segment de `pieces.storage_path`, de
-- `pieces.lisible_path` et de `documents_divers.storage_path` n'était lié au dossier de la ligne par rien, et le client d'un
-- dossier insère des pièces (`pieces_insert`) et des documents (« membres peuvent deposer des documents ») : une pièce de
-- son dossier pouvait nommer le fichier d'un AUTRE dossier du cabinet, que la policy du seau lui refuse, mais qu'un lecteur
-- du cabinet — le pack, le paquet d'archive, la relecture OCR, la copie des fichiers — téléchargeait avec SES droits, pour
-- le compte du mauvais dossier ; et un retrait aux droits du cabinet l'aurait supprimé.
--
-- LA RÈGLE, une par colonne, sur la ligne telle qu'elle s'écrit (insertion, mise à jour, restauration comprises) :
--   1. le premier segment EST le dossier de la ligne, au caractère près (`dossier_id::text`, en minuscules : un dossier
--      en majuscules passerait la policy du seau, qui convertit en uuid, et sortirait du préfixe que la suppression
--      d'un dossier retire) ;
--   2. au moins un segment après lui, et aucun segment vide (ni « // », ni une barre au début ou à la fin) ;
--   3. aucun segment « . » ni « .. » ;
--   4. aucun des caractères que l'adresse d'un fichier réécrit : la barre oblique inverse, « % », « ? », « # » et les
--      caractères de contrôle. Le client du stockage (`@supabase/storage-js` 2.112.4, `StorageFileApi`) place le chemin
--      TEL QUEL dans l'adresse du téléchargement et de la signature (`${this.url}/object/${bucket}/${chemin}`), et
--      l'analyseur d'adresses du navigateur (WHATWG URL Standard, « path state » : la barre oblique inverse sépare les
--      segments d'une adresse http(s) ; « .%2e », « %2e. » et « %2e%2e » sont des segments « .. » ; les tabulations et
--      sauts de ligne sont retirés avant l'analyse ; « ? » et « # » ferment le chemin) les résoudrait : sans la règle 4,
--      « <dossier>/..<barre inverse><autre dossier>/f.pdf » ou « <dossier>/%2e%2e/<autre dossier>/f.pdf » passerait les
--      règles 1 à 3 et désignerait le fichier d'un autre dossier.
-- Un chemin NUL reste permis là où la colonne l'admet (`lisible_path`). Aucun chemin que l'application compose ne tombe
-- sous la règle : `<dossier>/<horodatage>-<nom réduit à [A-Za-z0-9._]>` (lib/depot.ts, lib/importFichiers.ts,
-- FichePiece, lib/receptionPlateforme.ts, receive-email, plateforme-agreee), `<dossier>/documents/…` (Cotisations),
-- `<dossier>/superpdp-<numéro>.txt` (superpdp-sync), `<dossier>/<nom>.pdf` (la facture d'honoraires déposée, LM8,
-- préparée) ; la restauration réinsère une sauvegarde sous l'identifiant d'origine du dossier.
--
-- CE QU'ELLE NE COUVRE PAS, et pourquoi : les chemins qu'aucun client n'écrit — les originaux des factures reprises
-- (`imports_factures.fichier_chemin`, `factures_importees.fichier_chemin` : le dossier et le lot déjà gardés par
-- `*_chemin_du_lot`, écrits par la fonction de l'import, au cabinet seul ; leur dernier segment admet encore la barre
-- oblique inverse, CFCS2-Q1), les packs (`packs`, au cabinet seul), le logo du cabinet (`cabinets.logo_storage_path`,
-- seau public, préfixe du cabinet), le logo des factures (`parametres_facturation_logo_chemin_forme` : la forme exacte ;
-- `factures_emises.logo_chemin` en est la copie posée par la base) ; et, préparés, `documents_cabinet.chemin` (forme
-- exacte) et `originaux_liberes.chemin` (aucune policy, écrit par un déclencheur).
--
-- LA POSE : chaque contrainte NOT VALID (elle juge aussitôt toute écriture nouvelle), puis une lecture qui rejoue son
-- propre texte (`pg_get_expr`) sur les lignes en base et lève, avec la raison et les comptes, si une seule est fautive ;
-- puis la validation. Relevé en production le 12/11/2026, en lecture agrégée : 77 pièces, 0 version lisible, 68
-- documents, aucune ligne fautive.

do $garde$
begin
  if to_regclass('public.pieces') is null or to_regclass('public.documents_divers') is null then
    raise exception 'chemin_dans_son_dossier : une table dont elle dépend manque (pieces, documents_divers).';
  end if;
  if exists (select 1 from pg_constraint c
              where c.conname in ('pieces_storage_path_dans_son_dossier', 'pieces_lisible_path_dans_son_dossier',
                                  'documents_divers_storage_path_dans_son_dossier')) then
    raise exception 'La migration chemin_dans_son_dossier est déjà en base : elle ne s''applique pas deux fois.';
  end if;
end
$garde$;

-- La barre oblique inverse s'écrit chr(92) : aucune barre oblique inverse dans ce texte, que les outils de migration
-- recopient sans la réinterpréter ; et le point d'une expression régulière, « [.] ».
alter table public.pieces
  add constraint pieces_storage_path_dans_son_dossier check (
    split_part(storage_path, '/', 1) = dossier_id::text
    and storage_path ~ '^[^/]+(/[^/]+)+$'
    and storage_path !~ '(^|/)[.][.]?(/|$)'
    and storage_path !~ '[%?#[:cntrl:]]'
    and strpos(storage_path, chr(92)) = 0
  ) not valid,
  add constraint pieces_lisible_path_dans_son_dossier check (
    lisible_path is null
    or (split_part(lisible_path, '/', 1) = dossier_id::text
        and lisible_path ~ '^[^/]+(/[^/]+)+$'
        and lisible_path !~ '(^|/)[.][.]?(/|$)'
        and lisible_path !~ '[%?#[:cntrl:]]'
        and strpos(lisible_path, chr(92)) = 0)
  ) not valid;

alter table public.documents_divers
  add constraint documents_divers_storage_path_dans_son_dossier check (
    split_part(storage_path, '/', 1) = dossier_id::text
    and storage_path ~ '^[^/]+(/[^/]+)+$'
    and storage_path !~ '(^|/)[.][.]?(/|$)'
    and storage_path !~ '[%?#[:cntrl:]]'
    and strpos(storage_path, chr(92)) = 0
  ) not valid;

comment on constraint pieces_storage_path_dans_son_dossier on public.pieces is
  'Le fichier d''une pièce est dans son dossier (CFCS-Q1, ligne 44) : le premier segment du chemin est le dossier de la ligne, au moins un segment après lui, aucun segment vide, « . » ni « .. », ni barre oblique inverse, « % », « ? », « # » ou caractère de contrôle (ce que l''adresse d''un fichier réécrirait).';
comment on constraint pieces_lisible_path_dans_son_dossier on public.pieces is
  'La version lisible d''une pièce est dans son dossier, ou nulle (CFCS-Q1, ligne 44) : la règle de pieces_storage_path_dans_son_dossier.';
comment on constraint documents_divers_storage_path_dans_son_dossier on public.documents_divers is
  'Le fichier d''un document est dans son dossier (CFCS-Q1, ligne 44) : la règle de pieces_storage_path_dans_son_dossier.';

-- La lecture préalable : chaque contrainte rejouée, par son propre texte, sur les lignes déjà en base. Une ligne fautive
-- arrête la migration, qui ne valide rien et dit quelle contrainte, combien de lignes, jamais un chemin.
do $lecture$
declare
  r record;
  v_n bigint;
  v_fautes text := '';
begin
  for r in select c.conname, c.conrelid::regclass as relation, pg_get_expr(c.conbin, c.conrelid) as expression
             from pg_constraint c
            where c.conname in ('pieces_storage_path_dans_son_dossier', 'pieces_lisible_path_dans_son_dossier',
                                'documents_divers_storage_path_dans_son_dossier')
            order by c.conname loop
    execute format('select count(*) from %s where (%s) is false', r.relation, r.expression) into v_n;
    if v_n > 0 then
      v_fautes := v_fautes || format(' %s : %s ligne(s) ;', r.conname, v_n);
    end if;
  end loop;
  if v_fautes <> '' then
    raise exception 'chemin_dans_son_dossier : des lignes nomment un fichier hors de leur dossier, rien n''est validé —%', v_fautes
      using errcode = '23514';
  end if;
end
$lecture$;

alter table public.pieces validate constraint pieces_storage_path_dans_son_dossier;
alter table public.pieces validate constraint pieces_lisible_path_dans_son_dossier;
alter table public.documents_divers validate constraint documents_divers_storage_path_dans_son_dossier;
