-- RETOUR DE `gardes_de_la_validation_allegees` (ligne 28.66 ; PRÉPARÉ le 12/11/2026 ; la migration en production depuis le 12/11/2026,
-- version 20261112134639 : supabase/schema/20261112134639_gardes_de_la_validation_allegees.sql). Rend les deux gardes du brouillon
-- d'hier — chacune sur l'insertion, la suppression ET la modification, sans condition — et retire leurs deux jumeaux de la
-- modification. Aucune donnée ne se perd, aucune fonction ne change : la validation reprend son coût d'hier. Deux `drop
-- trigger` : JAMAIS SANS L'ACCORD DU CABINET ; le texte se colle s'il le faut. Il se refuse si la migration n'est pas là
-- telle qu'elle s'est posée.

do $garde$
begin
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.ecritures_brouillon'::regclass and not t.tgisinternal and t.tgenabled = 'O'
         and ((t.tgname = 'ecritures_brouillon_intangibles' and t.tgtype = 15 and t.tgqual is null
               and t.tgfoid = 'public.garder_ecritures_validees()'::regprocedure)
           or (t.tgname = 'ecritures_brouillon_intangibles_modification' and t.tgtype = 19 and t.tgqual is not null
               and t.tgfoid = 'public.garder_ecritures_validees()'::regprocedure)
           or (t.tgname = 'ecritures_brouillon_vente_facturee_lignes' and t.tgtype = 15 and t.tgqual is null
               and t.tgfoid = 'public.garder_lignes_de_la_vente_facturee()'::regprocedure)
           or (t.tgname = 'ecritures_brouillon_vente_facturee_lignes_modification' and t.tgtype = 19 and t.tgqual is not null
               and t.tgfoid = 'public.garder_lignes_de_la_vente_facturee()'::regprocedure))) <> 4 then
    raise exception 'retour_gardes_de_la_validation_allegees : les quatre déclencheurs de la migration ne sont pas là tels qu''elle les a posés.';
  end if;
end
$garde$;

create or replace trigger ecritures_brouillon_intangibles
  before insert or delete or update on public.ecritures_brouillon
  for each row execute function public.garder_ecritures_validees();
drop trigger ecritures_brouillon_intangibles_modification on public.ecritures_brouillon;

create or replace trigger ecritures_brouillon_vente_facturee_lignes
  before insert or delete or update on public.ecritures_brouillon
  for each row execute function public.garder_lignes_de_la_vente_facturee();
drop trigger ecritures_brouillon_vente_facturee_lignes_modification on public.ecritures_brouillon;
