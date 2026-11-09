-- RESTAU-Q1 ET RESTAU-Q4 : LES COMMENTAIRES D'UN DOSSIER SE RESTAURENT, ET UNE RÈGLE DU CABINET NE BLOQUE PLUS LA
-- SUPPRESSION D'UN DOSSIER (MVP-D3, la sauvegarde et la restauration ; PRÉPARÉE, PAS APPLIQUÉE). Les deux défauts ont été
-- établis le 09/11/2026 par une restauration complète d'un dossier sur la réplique, par le code même de l'application
-- (`exporterDossier`, puis la suppression du dossier, puis `restaurerSauvegarde`). Le récit : HISTORIQUE.md, « 09/11/2026 —
-- RESTAU-Q1 ET RESTAU-Q4 : LES COMMENTAIRES SE RESTAURENT, UNE RÈGLE DU CABINET NE BLOQUE PLUS LA SUPPRESSION D'UN
-- DOSSIER (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai : supabase/essais/restaurationEtSuppressionDUnDossier.sql (jouable en
-- production) et le bloc PR de supabase/essais/rls.sql ; le retour : supabase/preparees/retour/
-- 20261109100100_retour_restauration_et_suppression_d_un_dossier.sql.
--
-- SOURCES. PostgreSQL 17, « CREATE POLICY » : les policies PERMISSIVES d'une même commande se combinent par OU — une
-- policy d'insertion de plus n'ouvre que ce que son prédicat ouvre, et ne retire rien aux autres. « ALTER TABLE », forme
-- `ALTER CONSTRAINT` : seuls la DIFFÉRABILITÉ et le moment du contrôle d'une clé étrangère se changent en place ; son
-- action à la suppression ne change qu'en retirant la clé et en la reposant. « CREATE TABLE », `REFERENCES … ON DELETE
-- CASCADE` : « when a referenced row is deleted, row(s) referencing it should be automatically deleted as well » ; sans
-- clause (NO ACTION), la suppression du parent est refusée, à la fin de l'instruction, si une ligne le désigne encore.
-- « Row Security Policies » : les contrôles d'intégrité référentielle contournent la RLS.
--
-- RESTAU-Q1 — `piece_commentaires` n'a qu'une policy d'insertion (`piece_commentaires_insert`, 20260916185713) : l'auteur
-- est celui qui écrit (`auteur_id = auth.uid()`), et `origine` dit son droit sur le dossier. Restaurer un dossier, c'est
-- réinsérer, par le super-administrateur, des commentaires que d'autres ont écrits — le cabinet, le client, un compte
-- supprimé depuis (`auteur_id` nul, `on delete set null`) : chacun se refusait en 42501, et la restauration s'arrêtait
-- sur la table. La policy neuve suit le motif des autres tables qu'une restauration réinsère (`encaissements_factures`,
-- `pieces_jointes_ecartees`, `trace_des_droits`, `situations_publiees`…) : une insertion réservée au super-administrateur,
-- `to authenticated`, et rien d'autre. Aucune mise à jour : une parole datée ne se réécrit pas, pas même par lui. Le
-- cabinet et le client gardent exactement leurs droits d'hier (les trois policies d'hier ne sont pas touchées : la garde
-- ci-dessous les vérifie à leur empreinte). Les contraintes de la table (une seule cible, une origine connue, un texte non
-- vide) et ses clés étrangères valent pour la restauration comme pour tout autre auteur.
--
-- RESTAU-Q4 — `tiers_categories_cabinet` (la règle d'un cabinet : un tiers, une catégorie, pour tous ses dossiers) cite
-- `categories` sans action (`tiers_categories_cabinet_categorie_id_fkey`, 20260904171600). Une catégorie PROPRE à un
-- dossier part avec lui (`categories_dossier_id_fkey`, en cascade) ; une règle du cabinet qui la vise ne part pas — elle
-- est du cabinet, pas du dossier — et refusait donc la suppression du dossier entier (23503). La clé est reposée, sous
-- le même nom, en `on delete cascade` : la règle part avec la catégorie disparue, qu'elle ne pouvait plus appliquer.
-- L'application n'écrit une règle du cabinet que sur une catégorie COMMUNE (`dossier_id` nul : `CategoriserTiersModal`,
-- `FichePiece`), et la production n'en porte aucune autre (relevé du 09/11/2026 : sept règles, toutes sur une catégorie
-- commune) ; mais la policy de la table ne regarde pas la catégorie : une règle sur une catégorie propre s'écrit par
-- l'API, ou d'un autre cabinet. Les six autres tables qui citent `categories` (`pieces`, `lignes_bancaires`,
-- `ventilations_bancaires`, `operations_caisse`, `regles_affectation_bancaire`, `tiers_categories`) portent un
-- `dossier_id` en cascade : leurs lignes du dossier partent dans la même instruction, et leur clé, NO ACTION, ne juge
-- qu'à sa fin — elles restent telles quelles. Qui supprime une catégorie propre, ou le dossier (le chef du cabinet, le
-- super-administrateur), peut déjà retirer les règles de son cabinet : la cascade, qui contourne la RLS, n'ouvre rien de
-- plus ; aucun écran ne supprime une catégorie.
--
-- CE QU'ELLE NE CHANGE PAS : aucune donnée, aucune autre policy, aucune fonction. Le texte contient `drop constraint` :
-- l'outil d'application attend une confirmation, elle SE COLLE dans l'éditeur SQL, dans une transaction, avec sa ligne
-- d'historique, sur l'accord du cabinet. Au collage : le fichier passe dans l'export sous sa version, et la relation
-- `tiers_categories_cabinet.categorie_id > categories` de `RELATIONS` (src/lib/sauvegarde.ts) passe de « bloque » à
-- « cascade » dans le même commit (sauvegardeRelations.test.ts confronte l'une à l'autre).

-- ── La garde : l'état d'hier, entier, ou rien ──
do $garde$
begin
  if exists (select 1 from pg_policy p
              where p.polrelid = 'public.piece_commentaires'::regclass and p.polname = 'piece_commentaires_restauration') then
    raise exception 'La policy de restauration des commentaires est déjà en base : cette migration ne se rejoue pas.';
  end if;
  -- Les trois policies d'hier (20260916185713), à l'empreinte de leur nom, de leur commande, de leurs rôles et de leurs
  -- prédicats ; la policy restrictive `deux_facteurs`, si sa migration est passée avant celle-ci, n'y entre pas.
  if (select md5(string_agg(p.polname::text || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' || p.polroles::text
               || ':' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
               '|' order by p.polname collate "C"))
        from pg_policy p
       where p.polrelid = 'public.piece_commentaires'::regclass and not (p.polname = 'deux_facteurs' and not p.polpermissive))
     is distinct from '610103bdc75f7204a7ef3232e23b863d'
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.piece_commentaires'::regclass) then
    raise exception 'Les policies de piece_commentaires ne sont plus celles d''hier : relire la migration contre la base avant de l''appliquer.';
  end if;
  -- La clé reposée : celle d'hier, à l'empreinte de sa définition, NO ACTION, ni différable ni à valider.
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.tiers_categories_cabinet'::regclass and c.contype = 'f'
                    and c.conname = 'tiers_categories_cabinet_categorie_id_fkey'
                    and c.confrelid = 'public.categories'::regclass
                    and c.confdeltype = 'a' and c.confupdtype = 'a' and not c.condeferrable and c.convalidated
                    and md5(pg_get_constraintdef(c.oid)) = '9199e55c06b70ea5c042079e7f50866a')
     or (select count(*) from pg_constraint c
          where c.conrelid = 'public.tiers_categories_cabinet'::regclass and c.contype = 'f'
            and c.confrelid = 'public.categories'::regclass) <> 1 then
    raise exception 'La clé de tiers_categories_cabinet vers categories n''est plus celle que cette migration repose : relire la migration contre la base avant de l''appliquer.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.is_super_admin()'))
     is distinct from 'a9159138778422a43ba8d8c21240c9bb' then
    raise exception 'is_super_admin n''est plus celle que la policy de restauration appelle : relire la migration contre la base avant de l''appliquer.';
  end if;
end
$garde$;

-- ── RESTAU-Q1 : l'insertion de la restauration, au super-administrateur seul ──
create policy piece_commentaires_restauration on public.piece_commentaires
  for insert to authenticated with check (is_super_admin());

-- ── RESTAU-Q4 : la règle du cabinet part avec la catégorie qu'elle vise ──
alter table public.tiers_categories_cabinet drop constraint tiers_categories_cabinet_categorie_id_fkey;
alter table public.tiers_categories_cabinet add constraint tiers_categories_cabinet_categorie_id_fkey
  foreign key (categorie_id) references public.categories(id) on delete cascade;
