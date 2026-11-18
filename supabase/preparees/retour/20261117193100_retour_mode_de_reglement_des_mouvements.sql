-- RETOUR DE `mode_de_reglement_des_mouvements` (EXP58-Q1, supabase/preparees/20261117193000_mode_de_reglement_des_mouvements.sql) —
-- À COLLER par le cabinet dans l'éditeur SQL de Supabase, dans une transaction : il retire deux déclencheurs, deux fonctions,
-- une contrainte et une colonne, ce que l'outil d'application retient. CE QU'IL DÉTRUIT : la colonne
-- `lignes_bancaires.mode_reglement`, et avec elle chaque mode que le cabinet a posé, mouvement par mouvement, depuis
-- l'application — un travail de saisie qu'aucun réimport ne rendrait ; la fonction `poser_modes_de_reglement`, que l'écran
-- appelle ; la garde `garder_mode_de_reglement` et ses deux déclencheurs. C'est pourquoi sa garde refuse dès qu'un seul
-- mouvement porte un mode : il ne sert qu'avant le premier clic qui en pose un ; au-delà, retirer ces modes est une décision du
-- cabinet, qui se prend à part. Les écritures qu'une validation a figées gardent leur ModeRglt (`ecritures_brouillon`) : ce
-- retour n'y touche pas.
-- Il rend la base d'avant. Le module (`MODE_DE_REGLEMENT_PREVU`, src/lib/modeDeReglement.ts) se baisse AVANT lui : levé, la
-- fiche d'un mouvement appellerait une fonction absente, et le FEC lirait une colonne qui n'est plus lue. Puis le socle se
-- régénère (supabase/essais/socle.sql) : les deux lignes que la migration y a ajoutées s'en vont, et le fichier de la migration
-- quitte supabase/schema/.
--
-- La garde : les objets sont ceux de la migration, et aucun mouvement ne porte de mode.
do $garde$
declare
  v_portes bigint;
begin
  if (select format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text
        from pg_catalog.pg_attribute a
       where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'mode_reglement' and not a.attisdropped)
     is distinct from 'text false false'
     or (select string_agg(pg_catalog.pg_get_constraintdef(c.oid), ' ; ') from pg_catalog.pg_constraint c
          where c.conrelid = 'public.lignes_bancaires'::regclass and c.conname = 'lignes_bancaires_mode_reglement_liste')
     is distinct from 'CHECK (((mode_reglement IS NULL) OR (mode_reglement = ANY (ARRAY[''Virement''::text, ''Prélèvement''::text, ''Carte bancaire''::text, ''Chèque''::text, ''Espèces''::text, ''Effet''::text, ''Autre''::text]))))'
     or to_regprocedure('public.poser_modes_de_reglement(uuid, uuid[], text[])') is null
     or to_regprocedure('public.garder_mode_de_reglement()') is null
     or (select count(*) from pg_catalog.pg_trigger t
          where t.tgrelid = 'public.lignes_bancaires'::regclass and not t.tgisinternal
            and t.tgname in ('lignes_bancaires_mode_de_reglement_insere', 'lignes_bancaires_mode_de_reglement_change')
            and t.tgfoid = to_regprocedure('public.garder_mode_de_reglement()')) <> 2 then
    raise exception 'Retour d''EXP58-Q1 : la colonne, sa liste, la fonction ou la garde ne sont pas celles de la migration (absentes ou changées) : rien n''est retiré.';
  end if;
  select count(*) into v_portes from public.lignes_bancaires where mode_reglement is not null;
  if v_portes > 0 then
    raise exception 'Retour d''EXP58-Q1 : % mouvement(s) portent un mode de règlement que le cabinet a posé, que ce retour effacerait sans retour possible : rien n''est retiré.',
      v_portes using errcode = '23514';
  end if;
end
$garde$;

drop trigger lignes_bancaires_mode_de_reglement_change on public.lignes_bancaires;
drop trigger lignes_bancaires_mode_de_reglement_insere on public.lignes_bancaires;
drop function public.poser_modes_de_reglement(uuid, uuid[], text[]);
drop function public.garder_mode_de_reglement();
alter table public.lignes_bancaires drop constraint lignes_bancaires_mode_reglement_liste;
alter table public.lignes_bancaires drop column mode_reglement;
