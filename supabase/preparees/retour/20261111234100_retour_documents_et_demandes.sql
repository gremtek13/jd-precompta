-- RETOUR ARRIÈRE de `documents_et_demandes` (B2, ligne 51.5 ; préparée, version provisoire 20261111234000 :
-- supabase/preparees/20261111234000_documents_et_demandes.sql) — À COLLER dans l'éditeur SQL, dans une transaction, avec la
-- ligne d'historique `retour_documents_et_demandes`, sur l'accord EXPLICITE du cabinet : il est DESTRUCTIF.
--
-- CE QU'IL DÉTRUIT : les cinq tables et TOUTES leurs lignes — les documents mis à disposition et la preuve de leur lecture,
-- les demandes, les réponses des clients (leurs textes) et les relances —, leurs gardes et leurs fonctions, les trois
-- policies du seau `documents-cabinet` et le seau lui-même. Les pièces et les documents divers que des réponses citaient
-- restent (ce sont des dépôts du chemin d'aujourd'hui) ; les e-mails d'`emails_envoyes` aussi.
--
-- IL REFUSE tant qu'un fichier vit dans le seau : le seau ne se retire pas plein, et retirer la ligne d'un fichier en SQL
-- laisserait le fichier lui-même chez le stockage, rattaché à rien. Les retirer d'abord par l'API du stockage (le chef du
-- cabinet du dossier, ou le tableau de bord), puis coller ce retour. Après lui, `DOCUMENTS_ET_DEMANDES_PREVUS`
-- (src/lib/documentsEtDemandes.ts) se rebaisse, et le plan de sauvegarde oublie les cinq tables.

do $garde$
begin
  if to_regclass('public.documents_cabinet') is null then
    raise exception 'La migration documents_et_demandes n''est pas en base : rien à défaire.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'documents-cabinet') then
    raise exception 'Le seau documents-cabinet porte des fichiers : les retirer d''abord par l''API du stockage (le retour laisserait sinon des fichiers rattachés à rien).';
  end if;
end
$garde$;

drop policy documents_cabinet_storage_lecture on storage.objects;
drop policy documents_cabinet_storage_depot on storage.objects;
drop policy documents_cabinet_storage_suppression on storage.objects;

-- Le seau vide : la plateforme refuse une suppression SQL hors du réglage que l'API pose elle-même.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.buckets where id = 'documents-cabinet';

-- Les fonctions qui rendent une ligne d'une table d'abord (elles dépendent de son type), puis les tables, qui emportent leurs
-- déclencheurs, leurs index et leurs policies, puis les gardes.
drop function public.publier_document_du_cabinet(uuid, uuid, text, text, integer, text, text);
drop function public.retirer_document_du_cabinet(uuid);
drop function public.marquer_document_lu(uuid);
drop function public.ouvrir_demande(uuid, text, text, date, text);
drop function public.clore_demande(uuid, text);
drop function public.relancer_demande(uuid);
drop function public.repondre_a_la_demande(uuid, text, uuid, uuid);
drop function public.document_du_cabinet_publie(text);

drop table public.relances_demandes;
drop table public.demandes_reponses;
drop table public.lectures_documents;
drop table public.demandes_cabinet;
drop table public.documents_cabinet;

drop function public.garder_document_du_cabinet();
drop function public.garder_lecture_document();
drop function public.garder_demande_du_cabinet();
drop function public.garder_reponse_a_une_demande();
drop function public.garder_relance_demande();
