-- LES DOCUMENTS ET LES DEMANDES DU CABINET, EN BASE (espace client, ligne 51.5, partie B, étape B2 ; MEG2-Q9, « oui » :
-- les documents mis à disposition réservés à la case « Documents », avec l'accusé de lecture ; les demandes du cabinet
-- visibles de tout accès) — PRÉPARÉE, PAS APPLIQUÉE. La conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION
-- DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », B.4 (« Les documents du cabinet et ses demandes ») et B.7 (l'étape
-- B2) ; le récit : « 11/11/2026 — B2 : LES DOCUMENTS ET LES DEMANDES DU CABINET, EN BASE (LIGNE 51.5) (PRÉPARÉE, PAS
-- APPLIQUÉE) » ; l'essai : supabase/essais/documentsCabinet.sql ; le bloc DM de supabase/essais/rls.sql.
--
-- SOURCES. Aucune règle légale n'impose cet échange : c'est le service du cabinet à son client (la ligne 52 de la feuille
-- de route, « documents définitifs mis à disposition, demandes du cabinet suivies, relances tracées »). Ce que la base en
-- garde se tient au règlement (UE) 2016/679 : par défaut rien n'est ouvert (art. 25, § 2 — la case « Documents » est
-- fausse tant que le cabinet ne la coche pas, le seau est privé) ; on ne garde que ce qui sert (art. 5, § 1, c — ni nom de
-- fichier dans le stockage, ni texte libre du cabinet seul dans une table que le client lit) ; la preuve de la mise à
-- disposition est l'accusé de lecture daté. Aucune norme AFNOR.
--
-- CE QU'ELLE POSE.
--   1. `documents_cabinet` : ce que le cabinet met à disposition d'un dossier (la 2035, la liasse, les comptes annuels, une
--      attestation, la lettre de mission, un courrier, autre chose) — un titre, une nature, un exercice, le fichier, publié
--      par et le, retiré par et le. JAMAIS dans `documents_divers` ni dans le seau `pieces`, que tout accès lit. Le fichier
--      vit dans un seau NEUF, `documents-cabinet`, PRIVÉ, sous `<dossier>/<document>/<empreinte>.<pdf|jpg|png>` : le premier
--      segment est le dossier, le nom l'empreinte SHA-256 du fichier — le nom d'origine, qui peut nommer le client, reste
--      dans la table (`nom_fichier`), jamais dans le stockage. Retirer un document ne le supprime pas : le client ne le lit
--      plus, le fichier et la preuve de sa lecture restent.
--   2. `lectures_documents` : la PREUVE de la mise à disposition — le document, le compte qui l'a ouvert la première fois,
--      l'instant ; une ligne par compte et par document, écrite par `marquer_document_lu`, à l'ouverture, par le client
--      « Documents » seul (le cabinet qui ouvre un document ne l'accuse pas).
--   3. `demandes_cabinet` : ce que le cabinet demande au dossier (« envoie-moi… ») — un objet, un détail, une échéance, ce
--      qui est attendu (un fichier, une réponse, les deux), l'auteur et l'instant, la clôture (par, le, motif). L'ÉTAT SE
--      DÉDUIT (ouverte, répondue, en retard, close : src/lib/documentsEtDemandes.ts), il ne se stocke pas. Une demande ne se
--      modifie pas : elle se clôt, une fois — satisfaite, sans objet, ou remplacée par une autre (B2-Q1, B2-Q4).
--   4. `demandes_reponses` : une réponse — l'auteur, un texte, la pièce ou le document déposé par le chemin d'aujourd'hui
--      (`pieces` ou `documents_divers`, « à valider » comme tout dépôt) ; une parole datée ne se réécrit pas. Le lien vers
--      le fichier se défait seul si le cabinet supprime la pièce ou le document (`on delete set null`) : la réponse reste,
--      et ce qu'elle a joint (`fichier`, `fichier_sha256`) le dit toujours (B2-Q3).
--   5. `relances_demandes` : une relance — le canal (l'écran ; l'e-mail, à l'étape B3), qui, quand, l'e-mail envoyé
--      (`emails_envoyes`). Celle-ci ne pose que la relance À L'ÉCRAN ; la relance par e-mail, son type d'e-mail et
--      `send-email` sont l'étape B3, qui écrira le canal « email ».
--   6. Les gardes, une par table, avant la RLS : une ligne ne s'écrit que par sa fonction (un réglage `jd.<table>` porte
--      l'identifiant de la ligne écrite, le temps de la transaction) ou par la restauration (le super-administrateur) ;
--      rien ne se réécrit, sauf le retrait d'un document et la clôture d'une demande, une fois, par leur fonction, et le lien
--      d'une réponse vers un fichier qui n'est plus au dossier ; rien ne part qu'avec son dossier.
--   7. Huit fonctions `security definer`, chacune contrôlant l'accès AVANT toute autre lecture : au cabinet du dossier
--      (`admin_du_dossier`), `publier_document_du_cabinet`, `retirer_document_du_cabinet`, `ouvrir_demande`,
--      `clore_demande`, `relancer_demande` ; au client « Documents », `marquer_document_lu` ; à tout accès du dossier,
--      `repondre_a_la_demande` ; et `document_du_cabinet_publie`, le booléen que lit la policy du seau.
--   8. Les policies, toutes à `authenticated` : le cabinet du dossier lit tout ; l'accès « Documents » lit les documents
--      publiés et non retirés de son dossier, et ses propres lectures ; TOUT accès du dossier lit ses demandes, leurs
--      réponses et leurs relances (MEG2-Q9) ; le super-administrateur insère (la restauration). Aucune policy de mise à jour
--      ni de suppression, pour personne. CES LECTURES DU CLIENT SE PRÉSENTENT AU CABINET AVANT D'ÊTRE APPLIQUÉES (CLAUDE.md,
--      « une policy qui lui ouvre une lecture se présente au cabinet »).
--   9. Le seau `documents-cabinet` : 20 Mio au plus, PDF, JPEG ou PNG (B2-Q2) ; lu par le cabinet du dossier et, d'un
--      document publié et non retiré, par l'accès « Documents » ; déposé par le cabinet du dossier seul, sous la forme
--      exacte du chemin ; supprimé par le chef du cabinet du dossier seul (la suppression du dossier) ; aucune mise à jour.
--      Chaque policy juge la forme du chemin dans un `case` AVANT d'en tirer le dossier : un chemin mal formé ne fait rien
--      lever.
--
-- LES REFUS, DANS L'ORDRE (que src/lib/documentsEtDemandes.ts redit sous les mêmes mots) :
--   - `publier_document_du_cabinet` : l'appelant qui n'est pas le cabinet du dossier (42501) ; le titre, la nature,
--     l'exercice, le nom du fichier (22023) ; le chemin qui n'a pas sa forme, ou pas ce dossier et ce document (22023) ; un
--     document déjà publié sous cet identifiant (22023) ; le fichier absent du seau (22023) ; un fichier d'un autre type que
--     son extension, ou au-delà de la borne du seau (22023) ;
--   - `retirer_document_du_cabinet` : le document inconnu, ou d'un dossier dont l'appelant n'est pas le cabinet (42501, les
--     mêmes mots : rien n'apprend qu'il existe) ; un document déjà retiré (22023) ;
--   - `marquer_document_lu` : le document inconnu, retiré, ou d'un dossier dont l'appelant n'est pas un accès « Documents »
--     (42501, les mêmes mots) ;
--   - `ouvrir_demande` : l'appelant qui n'est pas le cabinet du dossier (42501) ; l'objet, le détail, ce qui est attendu,
--     l'échéance passée au jour de Paris (22023) ;
--   - `clore_demande` : la demande inconnue ou d'un dossier dont l'appelant n'est pas le cabinet (42501) ; le motif (22023) ;
--     une demande déjà close (22023) ;
--   - `repondre_a_la_demande` : la demande inconnue ou d'un dossier dont l'appelant n'a aucun accès (42501) ; rien à
--     répondre, le texte, une pièce ET un document (22023) ; une demande close (22023) ; un fichier qui n'est pas un dépôt
--     de l'appelant fait depuis l'ouverture de la demande, dans son dossier, et qu'aucune réponse ne cite déjà (22023) ;
--   - `relancer_demande` : la demande inconnue ou d'un dossier dont l'appelant n'est pas le cabinet (42501) ; une demande
--     close (22023) ;
--   - les gardes : une écriture hors des fonctions et de la restauration (42501) ; une réécriture, un retrait hors de celui
--     du dossier, une ligne qui cite un document ou une demande d'un autre dossier (23514).
--
-- CE QU'ELLE NE CHANGE PAS : `memberships`, ses cases et leur trace (B1) ; `client_du_dossier` et `droits_sur_le_dossier`,
-- qu'elle APPELLE ; les tables, les policies et les seaux d'hier ; `emails_envoyes` et sa contrainte du type ; les Edge
-- Functions. Aucune ligne écrite d'avance, aucun fichier déposé. Rien ne se purge seul : combien de temps garder les
-- documents et les demandes reste à fixer par le cabinet (MEG2-Q10, ouverte) — une durée viendra par une migration à part.
--
-- CE QU'ELLE SUPPOSE, que sa garde de tête vérifie : B1 (`trois_cases_de_l_acces` : la case « Documents » et le mot
-- « documents » de `client_du_dossier`) ; le stockage de Supabase et ses quatre seaux ; aucun objet de cette migration.
-- La double authentification exigée (`deux_facteurs_exiges`, préparée) pose sa policy restrictive sur chaque table de
-- public : appliquée avant celle-ci, chaque table neuve la reçoit ici, à l'identique ; appliquée après, sa boucle les prend.
--
-- CE QUE LE TEXTE RETIRE : rien — ni objet, ni donnée. Hors des commentaires, le mot n'y paraît que dans les clés
-- (`on delete cascade`, `on delete set null`), la policy de suppression du seau (`for delete`) et les gardes (`tg_op`). Ni
-- barre oblique inverse hors des expressions régulières, ni retour chariot. Elle s'applique PAR L'OUTIL. Son retour
-- (`supabase/preparees/retour/20261111234100`) retire les tables, leurs lignes et le seau : destructif, à accorder et à
-- coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `DOCUMENTS_ET_DEMANDES_PREVUS` (src/lib/documentsEtDemandes.ts)
-- se lève alors, et ses tables entrent au plan de sauvegarde. Les écrans (« Documents » du client, les sections du cabinet)
-- et la relance par e-mail sont l'étape B3.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regclass('public.documents_cabinet') is not null or to_regclass('public.demandes_cabinet') is not null
     or exists (select 1 from storage.buckets where id = 'documents-cabinet') then
    raise exception 'La migration documents_et_demandes est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and a.attname = 'droit_documents'
                  and not a.attisdropped)
     or strpos(coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.client_du_dossier(uuid,text)')), ''),
               'when ''documents'' then m.droit_documents') = 0 then
    raise exception 'La case « Documents » (migration trois_cases_de_l_acces, B1) manque : l''appliquer d''abord ; celle-ci lit la case par client_du_dossier.';
  end if;
  if to_regprocedure('public.admin_du_dossier(uuid)') is null or to_regprocedure('public.est_chef_du_cabinet(uuid)') is null
     or to_regprocedure('public.is_super_admin()') is null or to_regclass('public.pieces') is null
     or to_regclass('public.documents_divers') is null or to_regclass('public.emails_envoyes') is null then
    raise exception 'Une fonction ou une table que la migration suppose manque (admin_du_dossier, est_chef_du_cabinet, is_super_admin, pieces, documents_divers, emails_envoyes) : relire la base.';
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null
     or to_regprocedure('storage.foldername(text)') is null
     or (select count(*) from storage.buckets where id in ('pieces', 'packs', 'cabinet-logos', 'ventes')) <> 4 then
    raise exception 'Le stockage et ses quatre seaux ne sont pas tous là : aucun seau n''est ajouté.';
  end if;
end
$garde$;

-- ══ 1. Les documents mis à disposition ══════════
-- Sans clé vers le compte de l'auteur : retirer le compte d'un membre parti ne doit pas effacer qui a publié (le patron de
-- `situations_publiees.auteur`). Le chemin se compose de la ligne elle-même : le dossier, l'identifiant, l'empreinte et
-- l'extension du type — une restauration ne peut pas réinsérer un chemin qui mentirait.
create table public.documents_cabinet (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  titre text not null
    constraint documents_cabinet_titre check (btrim(titre) <> '' and char_length(titre) <= 200),
  nature text not null
    constraint documents_cabinet_nature
      check (nature in ('2035', 'liasse', 'comptes_annuels', 'attestation', 'lettre_de_mission', 'courrier', 'autre')),
  exercice integer
    constraint documents_cabinet_exercice check (exercice between 2000 and 2100),
  chemin text not null
    constraint documents_cabinet_chemin_unique unique,
  nom_fichier text not null
    constraint documents_cabinet_nom_fichier check (btrim(nom_fichier) <> '' and char_length(nom_fichier) <= 200),
  sha256 text not null
    constraint documents_cabinet_sha256 check (sha256 ~ '^[0-9a-f]{64}$'),
  taille bigint not null
    constraint documents_cabinet_taille check (taille > 0),
  type_mime text not null
    constraint documents_cabinet_type_mime check (type_mime in ('application/pdf', 'image/jpeg', 'image/png')),
  publie_par uuid not null,
  publie_le timestamptz not null default now(),
  retire_par uuid,
  retire_le timestamptz,
  constraint documents_cabinet_chemin check (
    chemin = dossier_id::text || '/' || id::text || '/' || sha256
             || case type_mime when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' else '.png' end),
  constraint documents_cabinet_retrait check ((retire_par is null) = (retire_le is null))
);

create index documents_cabinet_dossier on public.documents_cabinet (dossier_id, publie_le);

comment on table public.documents_cabinet is
  'Les documents que le cabinet met à disposition d''un dossier (espace client, étape B2 ; MEG2-Q9) : la 2035, la liasse, les comptes annuels, une attestation, la lettre de mission, un courrier, autre chose. Le fichier vit dans le seau privé documents-cabinet ; lu par le cabinet du dossier et, publié et non retiré, par l''accès « Documents ». Écrit par publier_document_du_cabinet et retirer_document_du_cabinet seules ; un document retiré reste, avec la preuve de sa lecture.';
comment on column public.documents_cabinet.titre is
  'Le titre que le cabinet donne au document : l''accès « Documents » du dossier le lit.';
comment on column public.documents_cabinet.nature is
  '2035, liasse, comptes_annuels, attestation, lettre_de_mission, courrier ou autre.';
comment on column public.documents_cabinet.exercice is
  'L''exercice que le document concerne (une année), ou nul (un courrier, une lettre de mission).';
comment on column public.documents_cabinet.chemin is
  'Le fichier, dans le seau documents-cabinet : <dossier>/<document>/<empreinte>.<pdf|jpg|png> — jamais le nom d''origine.';
comment on column public.documents_cabinet.nom_fichier is
  'Le nom du fichier tel que le cabinet l''a déposé, pour l''écran et le téléchargement ; il ne va pas au stockage.';
comment on column public.documents_cabinet.sha256 is
  'L''empreinte SHA-256 du fichier, en minuscules : le nom du fichier dans le seau, calculée par l''application avant le dépôt.';
comment on column public.documents_cabinet.taille is
  'Le poids du fichier en octets, lu dans le stockage à la publication, jamais donné par l''appelant.';
comment on column public.documents_cabinet.type_mime is
  'Le type du fichier, lu dans le stockage à la publication : application/pdf, image/jpeg ou image/png.';
comment on column public.documents_cabinet.publie_par is
  'Le compte qui a publié (auth.uid()), sans clé étrangère : il survit au retrait du compte.';
comment on column public.documents_cabinet.retire_le is
  'L''instant où le cabinet a retiré le document : le client ne le lit plus ; le fichier et la preuve de sa lecture restent.';

-- ══ 2. La preuve de la mise à disposition ══════════
-- La première ouverture de chaque compte, et elle seule : `marquer_document_lu` ne réécrit pas une lecture déjà accusée.
create table public.lectures_documents (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  document_id uuid not null references public.documents_cabinet (id) on delete cascade,
  lecteur uuid not null,
  lu_le timestamptz not null default now(),
  constraint lectures_documents_une_par_lecteur unique (document_id, lecteur)
);

create index lectures_documents_dossier on public.lectures_documents (dossier_id);

comment on table public.lectures_documents is
  'La preuve de la mise à disposition d''un document du cabinet (espace client, étape B2) : la première ouverture de chaque accès « Documents », écrite par marquer_document_lu seule. Lue par le cabinet du dossier ; chaque compte lit les siennes.';
comment on column public.lectures_documents.lecteur is
  'Le compte qui a ouvert le document (auth.uid()), sans clé étrangère : la preuve survit au retrait du compte.';

-- ══ 3. Les demandes du cabinet ══════════
-- L'état se DÉDUIT : close si elle porte sa clôture ; sinon répondue, en retard ou ouverte (src/lib/documentsEtDemandes.ts).
create table public.demandes_cabinet (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  objet text not null
    constraint demandes_cabinet_objet check (btrim(objet) <> '' and char_length(objet) <= 200),
  detail text
    constraint demandes_cabinet_detail check (btrim(detail) <> '' and char_length(detail) <= 4000),
  echeance date
    constraint demandes_cabinet_echeance check (echeance between date '2000-01-01' and date '2100-12-31'),
  attendu text not null
    constraint demandes_cabinet_attendu check (attendu in ('fichier', 'reponse', 'les_deux')),
  auteur uuid not null,
  ouverte_le timestamptz not null default now(),
  close_par uuid,
  close_le timestamptz,
  motif_de_cloture text
    constraint demandes_cabinet_motif check (motif_de_cloture in ('satisfaite', 'sans_objet', 'remplacee')),
  constraint demandes_cabinet_cloture check (
    (close_par is null and close_le is null and motif_de_cloture is null)
    or (close_par is not null and close_le is not null and motif_de_cloture is not null))
);

create index demandes_cabinet_dossier on public.demandes_cabinet (dossier_id, ouverte_le);

comment on table public.demandes_cabinet is
  'Les demandes du cabinet à un dossier (espace client, étape B2 ; MEG2-Q9) : un objet, un détail, une échéance, ce qui est attendu ; lues par TOUT accès du dossier. Écrites par ouvrir_demande et clore_demande seules ; une demande ne se modifie pas, elle se clôt une fois. Son état se déduit.';
comment on column public.demandes_cabinet.objet is
  'L''objet de la demande : tous les accès du dossier le lisent.';
comment on column public.demandes_cabinet.detail is
  'Le détail de la demande, facultatif : tous les accès du dossier le lisent.';
comment on column public.demandes_cabinet.attendu is
  'Ce que le cabinet attend : fichier, reponse, ou les_deux.';
comment on column public.demandes_cabinet.motif_de_cloture is
  'Pourquoi la demande est close : satisfaite, sans_objet, ou remplacee (par une autre demande) — une liste fermée, aucun texte libre.';

-- ══ 4. Les réponses ══════════
-- Une réponse cite au plus un dépôt du chemin d'aujourd'hui. Si le cabinet supprime ce dépôt, le lien se défait seul et la
-- réponse reste : ce qu'elle a joint (`fichier`) et l'empreinte du fichier le disent toujours.
create table public.demandes_reponses (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  demande_id uuid not null references public.demandes_cabinet (id) on delete cascade,
  auteur uuid not null,
  texte text
    constraint demandes_reponses_texte check (btrim(texte) <> '' and char_length(texte) <= 4000),
  fichier text
    constraint demandes_reponses_fichier check (fichier in ('piece', 'document')),
  piece_id uuid references public.pieces (id) on delete set null,
  document_id uuid references public.documents_divers (id) on delete set null,
  fichier_sha256 text,
  ecrite_le timestamptz not null default now(),
  constraint demandes_reponses_une_piece unique (piece_id),
  constraint demandes_reponses_un_document unique (document_id),
  constraint demandes_reponses_quelque_chose check (texte is not null or fichier is not null),
  constraint demandes_reponses_piece check (piece_id is null or fichier = 'piece'),
  constraint demandes_reponses_document check (document_id is null or fichier = 'document'),
  constraint demandes_reponses_empreinte check (fichier_sha256 is null or fichier is not null)
);

create index demandes_reponses_demande on public.demandes_reponses (demande_id, ecrite_le);
create index demandes_reponses_dossier on public.demandes_reponses (dossier_id);

comment on table public.demandes_reponses is
  'Les réponses aux demandes du cabinet (espace client, étape B2) : l''auteur, un texte, le dépôt joint ; lues par tout accès du dossier ; écrites par repondre_a_la_demande seule. Une réponse ne se réécrit pas ; seul le lien vers un dépôt que le cabinet supprime se défait, et ce qu''elle a joint reste dit.';
comment on column public.demandes_reponses.texte is
  'Ce que le client écrit : le cabinet et tous les accès du dossier le lisent.';
comment on column public.demandes_reponses.fichier is
  'Ce que la réponse a joint à son écriture : piece, document, ou nul — il reste dit quand le lien se défait.';
comment on column public.demandes_reponses.fichier_sha256 is
  'L''empreinte du dépôt joint, recopiée à la réponse (pieces.storage_hash ou documents_divers.storage_hash) : elle survit au dépôt.';

-- ══ 5. Les relances ══════════
-- L'écran à cette étape ; l'e-mail à l'étape B3, qui citera la ligne d'`emails_envoyes` de l'envoi (sans action à la
-- suppression : un e-mail qu'une relance cite ne part qu'avec son dossier).
create table public.relances_demandes (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  demande_id uuid not null references public.demandes_cabinet (id) on delete cascade,
  canal text not null
    constraint relances_demandes_canal check (canal in ('ecran', 'email')),
  email_id uuid references public.emails_envoyes (id),
  relancee_par uuid not null,
  relancee_le timestamptz not null default now(),
  constraint relances_demandes_email check ((canal = 'email') = (email_id is not null))
);

create index relances_demandes_demande on public.relances_demandes (demande_id, relancee_le);
create index relances_demandes_dossier on public.relances_demandes (dossier_id);

comment on table public.relances_demandes is
  'Les relances d''une demande du cabinet (espace client, étape B2) : le canal, qui, quand, et l''e-mail envoyé pour le canal email (étape B3). Lues par tout accès du dossier ; écrites par relancer_demande seule (l''écran).';

-- ══ 6. Les gardes ══════════
-- Avant la RLS, aux droits de l'appelant. Le retrait d'une ligne n'est admis qu'avec son dossier (la cascade : le dossier
-- n'est déjà plus là).
create function public.garder_document_du_cabinet() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Un document mis à disposition ne part qu''avec son dossier : il se retire, et la preuve de sa lecture reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('jd.documents_cabinet', true), '') <> old.id::text or old.retire_le is not null
       or new.retire_le is null or new.retire_par is null
       or (to_jsonb(new) - 'retire_par' - 'retire_le') <> (to_jsonb(old) - 'retire_par' - 'retire_le') then
      raise exception 'Un document mis à disposition ne se modifie pas : il se retire, une fois, et l''historique reste.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if coalesce(current_setting('jd.documents_cabinet', true), '') <> new.id::text and not public.is_super_admin() then
    raise exception 'Un document ne se met à disposition que par sa publication.' using errcode = '42501';
  end if;
  return new;
end
$$;

create function public.garder_lecture_document() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'La lecture d''un document ne part qu''avec son dossier : c''est la preuve de sa mise à disposition.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'La lecture d''un document ne se réécrit pas.' using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.lectures_documents', true), '') <> new.id::text and not public.is_super_admin() then
    raise exception 'La lecture d''un document ne s''écrit que par son accusé, à l''ouverture.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.documents_cabinet d where d.id = new.document_id and d.dossier_id = new.dossier_id) then
    raise exception 'Une lecture cite un document de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create function public.garder_demande_du_cabinet() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une demande ne part qu''avec son dossier : elle se clôt, et l''historique reste.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('jd.demandes_cabinet', true), '') <> old.id::text or old.close_le is not null
       or new.close_le is null
       or (to_jsonb(new) - 'close_par' - 'close_le' - 'motif_de_cloture')
          <> (to_jsonb(old) - 'close_par' - 'close_le' - 'motif_de_cloture') then
      raise exception 'Une demande ne se modifie pas : elle se clôt, une fois, et l''historique reste.' using errcode = '23514';
    end if;
    return new;
  end if;
  if coalesce(current_setting('jd.demandes_cabinet', true), '') <> new.id::text and not public.is_super_admin() then
    raise exception 'Une demande ne s''écrit que par son ouverture.' using errcode = '42501';
  end if;
  return new;
end
$$;

create function public.garder_reponse_a_une_demande() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une réponse ne part qu''avec son dossier : une parole datée reste.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    -- Le seul changement admis : la clé `on delete set null` qui défait le lien vers un dépôt que le cabinet vient de
    -- supprimer. Tout le reste de la ligne est inchangé, et le dépôt cité n'existe plus.
    if (to_jsonb(new) - 'piece_id' - 'document_id') = (to_jsonb(old) - 'piece_id' - 'document_id')
       and (new.piece_id is not distinct from old.piece_id
            or (new.piece_id is null and not exists (select 1 from public.pieces p where p.id = old.piece_id)))
       and (new.document_id is not distinct from old.document_id
            or (new.document_id is null and not exists (select 1 from public.documents_divers d where d.id = old.document_id))) then
      return new;
    end if;
    raise exception 'Une réponse ne se réécrit pas : seul le lien vers un dépôt retiré du dossier se défait, et ce qu''elle a joint reste dit.'
      using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.demandes_reponses', true), '') <> new.id::text and not public.is_super_admin() then
    raise exception 'Une réponse ne s''écrit que par sa fonction.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.demandes_cabinet d where d.id = new.demande_id and d.dossier_id = new.dossier_id)
     or (new.piece_id is not null
         and not exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id))
     or (new.document_id is not null
         and not exists (select 1 from public.documents_divers d where d.id = new.document_id and d.dossier_id = new.dossier_id)) then
    raise exception 'Une réponse cite une demande et un dépôt de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create function public.garder_relance_demande() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une relance ne part qu''avec son dossier.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une relance ne se réécrit pas.' using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.relances_demandes', true), '') <> new.id::text and not public.is_super_admin() then
    raise exception 'Une relance ne s''écrit que par sa fonction.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.demandes_cabinet d where d.id = new.demande_id and d.dossier_id = new.dossier_id)
     or (new.email_id is not null
         and not exists (select 1 from public.emails_envoyes e where e.id = new.email_id and e.dossier_id = new.dossier_id)) then
    raise exception 'Une relance cite une demande et un e-mail de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function public.garder_document_du_cabinet() is
  'La garde de documents_cabinet (étape B2) : une ligne ne s''écrit que par publier_document_du_cabinet (jd.documents_cabinet) ou par la restauration du super-administrateur (42501) ; elle ne se modifie que par son retrait, une fois (23514) ; elle ne part qu''avec son dossier (23514).';
comment on function public.garder_lecture_document() is
  'La garde de lectures_documents (étape B2) : une ligne ne s''écrit que par marquer_document_lu ou par la restauration (42501), cite un document de son dossier, ne se réécrit pas et ne part qu''avec son dossier (23514).';
comment on function public.garder_demande_du_cabinet() is
  'La garde de demandes_cabinet (étape B2) : une ligne ne s''écrit que par ouvrir_demande ou par la restauration (42501) ; elle ne se modifie que par sa clôture, une fois (23514) ; elle ne part qu''avec son dossier (23514).';
comment on function public.garder_reponse_a_une_demande() is
  'La garde de demandes_reponses (étape B2) : une ligne ne s''écrit que par repondre_a_la_demande ou par la restauration (42501), cite une demande et un dépôt de son dossier ; elle ne se réécrit pas, sauf le lien vers un dépôt que la suppression de celui-ci défait ; elle ne part qu''avec son dossier (23514).';
comment on function public.garder_relance_demande() is
  'La garde de relances_demandes (étape B2) : une ligne ne s''écrit que par relancer_demande ou par la restauration (42501), cite une demande et un e-mail de son dossier, ne se réécrit pas et ne part qu''avec son dossier (23514).';

create trigger documents_cabinet_garde
  before insert or update or delete on public.documents_cabinet
  for each row execute function public.garder_document_du_cabinet();
create trigger lectures_documents_garde
  before insert or update or delete on public.lectures_documents
  for each row execute function public.garder_lecture_document();
create trigger demandes_cabinet_garde
  before insert or update or delete on public.demandes_cabinet
  for each row execute function public.garder_demande_du_cabinet();
create trigger demandes_reponses_garde
  before insert or update or delete on public.demandes_reponses
  for each row execute function public.garder_reponse_a_une_demande();
create trigger relances_demandes_garde
  before insert or update or delete on public.relances_demandes
  for each row execute function public.garder_relance_demande();

-- ══ 7. Qui lit ══════════
-- Le document publié et non retiré, dit par sa fonction au cabinet du dossier et à l'accès « Documents » seulement : la
-- policy du seau l'appelle, sur une table qu'elle ne garde pas ; à tout autre compte connecté, faux — sans quoi il
-- apprendrait, pour un chemin connu, qu'un document y est publié.
create function public.document_du_cabinet_publie(p_chemin text) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.documents_cabinet d
                  where d.chemin = p_chemin and d.retire_le is null
                    and (public.admin_du_dossier(d.dossier_id) or public.client_du_dossier(d.dossier_id, 'documents')))
$$;

comment on function public.document_du_cabinet_publie(text) is
  'Vrai si ce chemin du seau documents-cabinet est le fichier d''un document publié et non retiré, pour le cabinet du dossier ou un accès « Documents » de ce dossier ; faux pour tout autre compte (étape B2).';

alter table public.documents_cabinet enable row level security;
alter table public.lectures_documents enable row level security;
alter table public.demandes_cabinet enable row level security;
alter table public.demandes_reponses enable row level security;
alter table public.relances_demandes enable row level security;

create policy documents_cabinet_lecture on public.documents_cabinet
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy documents_cabinet_lecture_documents on public.documents_cabinet
  for select to authenticated using (client_du_dossier(dossier_id, 'documents') and retire_le is null);
create policy documents_cabinet_restauration on public.documents_cabinet
  for insert to authenticated with check (is_super_admin());

create policy lectures_documents_lecture on public.lectures_documents
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy lectures_documents_lecture_du_lecteur on public.lectures_documents
  for select to authenticated using (lecteur = (select auth.uid()) and client_du_dossier(dossier_id, 'documents'));
create policy lectures_documents_restauration on public.lectures_documents
  for insert to authenticated with check (is_super_admin());

create policy demandes_cabinet_lecture on public.demandes_cabinet
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy demandes_cabinet_lecture_membre on public.demandes_cabinet
  for select to authenticated using (client_du_dossier(dossier_id, 'membre'));
create policy demandes_cabinet_restauration on public.demandes_cabinet
  for insert to authenticated with check (is_super_admin());

create policy demandes_reponses_lecture on public.demandes_reponses
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy demandes_reponses_lecture_membre on public.demandes_reponses
  for select to authenticated using (client_du_dossier(dossier_id, 'membre'));
create policy demandes_reponses_restauration on public.demandes_reponses
  for insert to authenticated with check (is_super_admin());

create policy relances_demandes_lecture on public.relances_demandes
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy relances_demandes_lecture_membre on public.relances_demandes
  for select to authenticated using (client_du_dossier(dossier_id, 'membre'));
create policy relances_demandes_restauration on public.relances_demandes
  for insert to authenticated with check (is_super_admin());

-- La double authentification exigée (migration `deux_facteurs_exiges`, préparée) pose sa policy restrictive sur chaque
-- table de public : appliquée avant celle-ci, chaque table neuve la reçoit ici, à l'identique.
do $deux_facteurs$
declare
  v_table text;
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    foreach v_table in array array['documents_cabinet', 'lectures_documents', 'demandes_cabinet', 'demandes_reponses',
                                   'relances_demandes'] loop
      execute format('create policy deux_facteurs on public.%I as restrictive for all to authenticated '
                     'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))', v_table);
    end loop;
  end if;
end
$deux_facteurs$;

-- ══ 8. Le seau ══════════
-- Privé : un fichier ne se lit que par une session que les policies admettent. Le stockage applique lui-même la taille et
-- les types à chaque dépôt ; les mêmes bornes vivent dans src/lib/bornesStockage.ts, où l'application les juge AVANT
-- l'envoi, et bornesStockage.test.ts les confronte à ce texte et à supabase/essais/bornesStockage.sql.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents-cabinet', 'documents-cabinet', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png']);

-- Trois policies, chacune pour ce seau seul. La forme du chemin d'abord, dans un `case` dont l'ordre est garanti.
create policy documents_cabinet_storage_lecture on storage.objects
  for select to authenticated
  using (bucket_id = 'documents-cabinet'
         and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                  then public.admin_du_dossier(((storage.foldername(name))[1])::uuid) or public.document_du_cabinet_publie(name)
                  else false end);
create policy documents_cabinet_storage_depot on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents-cabinet'
              and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}[.](pdf|jpg|png)$'
                       then public.admin_du_dossier(((storage.foldername(name))[1])::uuid)
                       else false end);
create policy documents_cabinet_storage_suppression on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents-cabinet'
         and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                  then exists (select 1 from public.dossiers d
                                where d.id = ((storage.foldername(name))[1])::uuid
                                  and public.est_chef_du_cabinet(d.cabinet_id))
                  else false end);

-- ══ 9. Publier et retirer un document ══════════
-- Le navigateur a calculé l'empreinte et déposé le fichier sous `<dossier>/<document>/<empreinte>.<extension>` ; la
-- fonction juge la saisie, puis le chemin, puis le fichier tel que le stockage le dit (son type, son poids, la borne du
-- seau) — des valeurs lues en base, jamais données par l'appelant.
create function public.publier_document_du_cabinet(p_dossier_id uuid, p_document_id uuid, p_titre text, p_nature text,
    p_exercice integer, p_nom_fichier text, p_chemin text)
  returns public.documents_cabinet
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_extension text;
  v_objet jsonb;
  v_type text;
  v_taille bigint;
  v_borne bigint;
  v_types text[];
  v_ligne public.documents_cabinet;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id)
     or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_titre is null or btrim(p_titre) = '' or char_length(p_titre) > 200 then
    raise exception 'Le titre d''un document est un texte de deux cents caractères au plus, qui ne soit pas vide.' using errcode = '22023';
  end if;
  if p_nature is null or p_nature not in ('2035', 'liasse', 'comptes_annuels', 'attestation', 'lettre_de_mission', 'courrier', 'autre') then
    raise exception 'La nature d''un document est la 2035, la liasse, les comptes annuels, une attestation, la lettre de mission, un courrier, ou autre chose.' using errcode = '22023';
  end if;
  if p_exercice is not null and p_exercice not between 2000 and 2100 then
    raise exception 'L''exercice d''un document est une année entre 2000 et 2100, ou rien.' using errcode = '22023';
  end if;
  if p_nom_fichier is null or btrim(p_nom_fichier) = '' or char_length(p_nom_fichier) > 200 then
    raise exception 'Le nom d''un fichier est un texte de deux cents caractères au plus, qui ne soit pas vide.' using errcode = '22023';
  end if;
  if p_document_id is null or p_chemin is null
     or p_chemin !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}[.](pdf|jpg|png)$'
     or split_part(p_chemin, '/', 1) <> p_dossier_id::text or split_part(p_chemin, '/', 2) <> p_document_id::text then
    raise exception 'Le fichier d''un document se dépose sous <dossier>/<document>/<empreinte>.<pdf|jpg|png>, dans ce dossier et pour ce document : ce chemin n''a pas cette forme.' using errcode = '22023';
  end if;
  if exists (select 1 from public.documents_cabinet d where d.id = p_document_id or d.chemin = p_chemin) then
    raise exception 'Ce document est déjà publié.' using errcode = '22023';
  end if;
  select o.metadata into v_objet from storage.objects o where o.bucket_id = 'documents-cabinet' and o.name = p_chemin;
  if not found then
    raise exception 'Le fichier de ce document n''est pas dans le stockage : le déposer d''abord.' using errcode = '22023';
  end if;
  v_extension := substring(p_chemin from '[.](pdf|jpg|png)$');
  v_type := lower(btrim(split_part(coalesce(v_objet ->> 'mimetype', ''), ';', 1)));
  v_taille := case when coalesce(v_objet ->> 'size', '') ~ '^[0-9]{1,18}$' then (v_objet ->> 'size')::bigint end;
  select b.file_size_limit, b.allowed_mime_types into v_borne, v_types from storage.buckets b where b.id = 'documents-cabinet';
  if v_taille is null or v_taille <= 0 or v_taille > coalesce(v_borne, 0) or not (v_type = any (coalesce(v_types, array[]::text[])))
     or v_type <> (case v_extension when 'pdf' then 'application/pdf' when 'jpg' then 'image/jpeg' else 'image/png' end) then
    raise exception 'Le fichier déposé n''est pas du type que dit son extension, ou dépasse la borne du seau.' using errcode = '22023';
  end if;
  perform set_config('jd.documents_cabinet', p_document_id::text, true);
  insert into public.documents_cabinet (id, dossier_id, titre, nature, exercice, chemin, nom_fichier, sha256, taille, type_mime, publie_par)
  values (p_document_id, p_dossier_id, p_titre, p_nature, p_exercice, p_chemin, p_nom_fichier, split_part(split_part(p_chemin, '/', 3), '.', 1),
          v_taille, v_type, auth.uid())
  returning * into v_ligne;
  perform set_config('jd.documents_cabinet', '', true);
  return v_ligne;
end;
$$;

comment on function public.publier_document_du_cabinet(uuid, uuid, text, text, integer, text, text) is
  'Met un document à disposition d''un dossier (étape B2) : le fichier déjà déposé dans le seau documents-cabinet sous <dossier>/<document>/<empreinte>.<pdf|jpg|png> ; son type et son poids lus dans le stockage. Réservée au cabinet du dossier (42501) ; ses refus en 22023, dans l''ordre de src/lib/documentsEtDemandes.ts. Rend la ligne écrite.';

create function public.retirer_document_du_cabinet(p_document_id uuid) returns public.documents_cabinet
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_document public.documents_cabinet;
  v_ligne public.documents_cabinet;
begin
  select d.* into v_document from public.documents_cabinet d where d.id = p_document_id;
  if v_document.id is null or not public.admin_du_dossier(v_document.dossier_id) then
    raise exception 'Accès refusé à ce document.' using errcode = '42501';
  end if;
  if v_document.retire_le is not null then
    raise exception 'Ce document est déjà retiré.' using errcode = '22023';
  end if;
  perform set_config('jd.documents_cabinet', p_document_id::text, true);
  update public.documents_cabinet set retire_par = auth.uid(), retire_le = now() where id = p_document_id
  returning * into v_ligne;
  perform set_config('jd.documents_cabinet', '', true);
  return v_ligne;
end;
$$;

comment on function public.retirer_document_du_cabinet(uuid) is
  'Retire un document mis à disposition (étape B2) : le client ne le lit plus ; le fichier, la ligne et la preuve de sa lecture restent. Réservée au cabinet du dossier (42501, aussi pour un document inconnu) ; rend la ligne.';

-- ══ 10. L'accusé de lecture ══════════
create function public.marquer_document_lu(p_document_id uuid) returns public.lectures_documents
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_document public.documents_cabinet;
  v_id uuid := gen_random_uuid();
  v_ligne public.lectures_documents;
begin
  select d.* into v_document from public.documents_cabinet d where d.id = p_document_id;
  if v_document.id is null or v_document.retire_le is not null
     or not public.client_du_dossier(v_document.dossier_id, 'documents') then
    raise exception 'Accès refusé à ce document.' using errcode = '42501';
  end if;
  perform set_config('jd.lectures_documents', v_id::text, true);
  insert into public.lectures_documents (id, dossier_id, document_id, lecteur)
  values (v_id, v_document.dossier_id, p_document_id, auth.uid())
  on conflict (document_id, lecteur) do nothing;
  perform set_config('jd.lectures_documents', '', true);
  select l.* into v_ligne from public.lectures_documents l where l.document_id = p_document_id and l.lecteur = auth.uid();
  return v_ligne;
end;
$$;

comment on function public.marquer_document_lu(uuid) is
  'Accuse la lecture d''un document du cabinet par l''appelant, à l''ouverture (étape B2) : la première seule, une par compte. Réservée à l''accès « Documents » du dossier, sur un document publié et non retiré (42501 sinon, les mêmes mots) ; rend la lecture, nouvelle ou déjà accusée.';

-- ══ 11. Ouvrir, clore et relancer une demande ══════════
create function public.ouvrir_demande(p_dossier_id uuid, p_objet text, p_detail text, p_echeance date, p_attendu text)
  returns public.demandes_cabinet
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_ligne public.demandes_cabinet;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id)
     or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_objet is null or btrim(p_objet) = '' or char_length(p_objet) > 200 then
    raise exception 'L''objet d''une demande est un texte de deux cents caractères au plus, qui ne soit pas vide.' using errcode = '22023';
  end if;
  if p_detail is not null and (btrim(p_detail) = '' or char_length(p_detail) > 4000) then
    raise exception 'Le détail d''une demande est un texte de quatre mille caractères au plus, qui ne soit pas vide, ou rien.' using errcode = '22023';
  end if;
  if p_attendu is null or p_attendu not in ('fichier', 'reponse', 'les_deux') then
    raise exception 'Une demande attend un fichier, une réponse, ou les deux.' using errcode = '22023';
  end if;
  if p_echeance is not null
     and (p_echeance < (now() at time zone 'Europe/Paris')::date or p_echeance > date '2100-12-31') then
    raise exception 'L''échéance d''une demande ne se fixe pas dans le passé.' using errcode = '22023';
  end if;
  perform set_config('jd.demandes_cabinet', v_id::text, true);
  insert into public.demandes_cabinet (id, dossier_id, objet, detail, echeance, attendu, auteur)
  values (v_id, p_dossier_id, p_objet, p_detail, p_echeance, p_attendu, auth.uid())
  returning * into v_ligne;
  perform set_config('jd.demandes_cabinet', '', true);
  return v_ligne;
end;
$$;

comment on function public.ouvrir_demande(uuid, text, text, date, text) is
  'Ouvre une demande du cabinet à un dossier (étape B2) : tous les accès du dossier la lisent. Réservée au cabinet du dossier (42501) ; ses refus en 22023 ; rend la ligne écrite.';

create function public.clore_demande(p_demande_id uuid, p_motif text) returns public.demandes_cabinet
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_demande public.demandes_cabinet;
  v_ligne public.demandes_cabinet;
begin
  select d.* into v_demande from public.demandes_cabinet d where d.id = p_demande_id;
  if v_demande.id is null or not public.admin_du_dossier(v_demande.dossier_id) then
    raise exception 'Accès refusé à cette demande.' using errcode = '42501';
  end if;
  if p_motif is null or p_motif not in ('satisfaite', 'sans_objet', 'remplacee') then
    raise exception 'Une demande se clôt satisfaite, sans objet, ou remplacée par une autre.' using errcode = '22023';
  end if;
  if v_demande.close_le is not null then
    raise exception 'Cette demande est déjà close.' using errcode = '22023';
  end if;
  perform set_config('jd.demandes_cabinet', p_demande_id::text, true);
  update public.demandes_cabinet set close_par = auth.uid(), close_le = now(), motif_de_cloture = p_motif where id = p_demande_id
  returning * into v_ligne;
  perform set_config('jd.demandes_cabinet', '', true);
  return v_ligne;
end;
$$;

comment on function public.clore_demande(uuid, text) is
  'Clôt une demande du cabinet (étape B2), une fois : satisfaite, sans_objet ou remplacee. Réservée au cabinet du dossier (42501, aussi pour une demande inconnue) ; rend la ligne.';

create function public.relancer_demande(p_demande_id uuid) returns public.relances_demandes
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_demande public.demandes_cabinet;
  v_id uuid := gen_random_uuid();
  v_ligne public.relances_demandes;
begin
  select d.* into v_demande from public.demandes_cabinet d where d.id = p_demande_id;
  if v_demande.id is null or not public.admin_du_dossier(v_demande.dossier_id) then
    raise exception 'Accès refusé à cette demande.' using errcode = '42501';
  end if;
  if v_demande.close_le is not null then
    raise exception 'Cette demande est close : elle ne se relance plus.' using errcode = '22023';
  end if;
  perform set_config('jd.relances_demandes', v_id::text, true);
  insert into public.relances_demandes (id, dossier_id, demande_id, canal, relancee_par)
  values (v_id, v_demande.dossier_id, p_demande_id, 'ecran', auth.uid())
  returning * into v_ligne;
  perform set_config('jd.relances_demandes', '', true);
  return v_ligne;
end;
$$;

comment on function public.relancer_demande(uuid) is
  'Relance une demande ouverte, à l''écran du client (étape B2 ; l''e-mail viendra à l''étape B3). Réservée au cabinet du dossier (42501, aussi pour une demande inconnue) ; une demande close ne se relance plus (22023) ; rend la relance.';

-- ══ 12. Répondre à une demande ══════════
-- Tout accès du dossier répond (MEG2-Q9 : tout accès dépose). Le fichier joint est un dépôt du chemin d'aujourd'hui, fait
-- depuis l'ouverture de la demande dans ce dossier — une pièce par l'appelant lui-même —, et qu'aucune réponse ne cite.
create function public.repondre_a_la_demande(p_demande_id uuid, p_texte text, p_piece_id uuid, p_document_id uuid)
  returns public.demandes_reponses
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_demande public.demandes_cabinet;
  v_id uuid := gen_random_uuid();
  v_empreinte text;
  v_trouve boolean := false;
  v_ligne public.demandes_reponses;
begin
  select d.* into v_demande from public.demandes_cabinet d where d.id = p_demande_id;
  if v_demande.id is null or not public.client_du_dossier(v_demande.dossier_id, 'membre') then
    raise exception 'Accès refusé à cette demande.' using errcode = '42501';
  end if;
  if p_texte is null and p_piece_id is null and p_document_id is null then
    raise exception 'Une réponse porte un texte, un fichier, ou les deux.' using errcode = '22023';
  end if;
  if p_texte is not null and (btrim(p_texte) = '' or char_length(p_texte) > 4000) then
    raise exception 'Le texte d''une réponse est un texte de quatre mille caractères au plus, qui ne soit pas vide.' using errcode = '22023';
  end if;
  if p_piece_id is not null and p_document_id is not null then
    raise exception 'Une réponse joint une pièce ou un document, pas les deux.' using errcode = '22023';
  end if;
  if v_demande.close_le is not null then
    raise exception 'Cette demande est close : ton cabinet n''attend plus de réponse.' using errcode = '22023';
  end if;
  if p_piece_id is not null then
    select true, p.storage_hash into v_trouve, v_empreinte from public.pieces p
     where p.id = p_piece_id and p.dossier_id = v_demande.dossier_id and p.uploaded_by = auth.uid()
       and p.created_at >= v_demande.ouverte_le
       and not exists (select 1 from public.demandes_reponses r where r.piece_id = p_piece_id);
  elsif p_document_id is not null then
    select true, d.storage_hash into v_trouve, v_empreinte from public.documents_divers d
     where d.id = p_document_id and d.dossier_id = v_demande.dossier_id and d.created_at >= v_demande.ouverte_le
       and not exists (select 1 from public.demandes_reponses r where r.document_id = p_document_id);
  end if;
  if (p_piece_id is not null or p_document_id is not null) and not coalesce(v_trouve, false) then
    raise exception 'Ce fichier n''est pas un dépôt que tu as fait pour cette demande.' using errcode = '22023';
  end if;
  perform set_config('jd.demandes_reponses', v_id::text, true);
  insert into public.demandes_reponses (id, dossier_id, demande_id, auteur, texte, fichier, piece_id, document_id, fichier_sha256)
  values (v_id, v_demande.dossier_id, p_demande_id, auth.uid(), p_texte,
          case when p_piece_id is not null then 'piece' when p_document_id is not null then 'document' end,
          p_piece_id, p_document_id, v_empreinte)
  returning * into v_ligne;
  perform set_config('jd.demandes_reponses', '', true);
  return v_ligne;
end;
$$;

comment on function public.repondre_a_la_demande(uuid, text, uuid, uuid) is
  'Répond à une demande ouverte du cabinet (étape B2) : un texte, un dépôt fait depuis l''ouverture de la demande (une pièce de l''appelant, ou un document du dossier), ou les deux. Réservée aux accès du dossier (42501, aussi pour une demande inconnue) ; ses refus en 22023 ; rend la réponse.';

-- ══ 13. Les droits d'exécution ══════════
revoke execute on function public.publier_document_du_cabinet(uuid, uuid, text, text, integer, text, text) from public, anon;
grant execute on function public.publier_document_du_cabinet(uuid, uuid, text, text, integer, text, text) to authenticated;
revoke execute on function public.retirer_document_du_cabinet(uuid) from public, anon;
grant execute on function public.retirer_document_du_cabinet(uuid) to authenticated;
revoke execute on function public.marquer_document_lu(uuid) from public, anon;
grant execute on function public.marquer_document_lu(uuid) to authenticated;
revoke execute on function public.ouvrir_demande(uuid, text, text, date, text) from public, anon;
grant execute on function public.ouvrir_demande(uuid, text, text, date, text) to authenticated;
revoke execute on function public.clore_demande(uuid, text) from public, anon;
grant execute on function public.clore_demande(uuid, text) to authenticated;
revoke execute on function public.relancer_demande(uuid) from public, anon;
grant execute on function public.relancer_demande(uuid) to authenticated;
revoke execute on function public.repondre_a_la_demande(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.repondre_a_la_demande(uuid, text, uuid, uuid) to authenticated;
revoke execute on function public.document_du_cabinet_publie(text) from public, anon;
grant execute on function public.document_du_cabinet_publie(text) to authenticated;
revoke execute on function public.garder_document_du_cabinet() from public, anon, authenticated;
revoke execute on function public.garder_lecture_document() from public, anon, authenticated;
revoke execute on function public.garder_demande_du_cabinet() from public, anon, authenticated;
revoke execute on function public.garder_reponse_a_une_demande() from public, anon, authenticated;
revoke execute on function public.garder_relance_demande() from public, anon, authenticated;
