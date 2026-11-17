-- RETOUR DE `date_de_valeur_des_mouvements` (EXP58-Q4, supabase/preparees/20261117170000_date_de_valeur_des_mouvements.sql) —
-- À COLLER par le cabinet dans l'éditeur SQL de Supabase, dans une transaction : il retire une colonne et sa contrainte, ce
-- que l'outil d'application retient. CE QU'IL DÉTRUIT : la colonne `lignes_bancaires.date_valeur`, et avec elle chaque date
-- de valeur gardée depuis l'application — une information qu'aucun réimport ne rendrait (le dédoublonnage refuse un relevé
-- déjà importé). C'est pourquoi sa garde refuse dès qu'un seul mouvement en porte une : il ne sert qu'avant le premier import
-- qui l'écrit ; au-delà, retirer ces dates est une décision du cabinet, qui se prend à part.
-- Il rend la base d'avant. Le module (`DATE_DE_VALEUR_PREVUE`, src/lib/dateDeValeur.ts) se baisse AVANT lui : levé, l'import
-- écrirait une colonne absente, et la base refuserait le lot entier. Puis le socle se régénère (supabase/essais/socle.sql) :
-- les deux lignes que la migration y a ajoutées s'en vont, et le fichier de la migration quitte supabase/schema/.
--
-- La garde : la colonne et sa borne sont celles de la migration, et aucun mouvement ne porte de date de valeur.
do $garde$
declare
  v_portees bigint;
begin
  if (select format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text
        from pg_catalog.pg_attribute a
       where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'date_valeur' and not a.attisdropped)
     is distinct from 'date false false'
     or (select string_agg(pg_get_constraintdef(c.oid), ' ; ') from pg_catalog.pg_constraint c
          where c.conrelid = 'public.lignes_bancaires'::regclass and c.conname = 'lignes_bancaires_date_valeur_proche')
     is distinct from 'CHECK (((date_valeur IS NULL) OR ((date_valeur >= (date - 92)) AND (date_valeur <= (date + 92)))))' then
    raise exception 'Retour d''EXP58-Q4 : la colonne date_valeur ou sa borne ne sont pas celles de la migration (absentes ou changées) : rien n''est retiré.';
  end if;
  select count(*) into v_portees from public.lignes_bancaires where date_valeur is not null;
  if v_portees > 0 then
    raise exception 'Retour d''EXP58-Q4 : % mouvement(s) portent une date de valeur, que ce retour effacerait sans retour possible : rien n''est retiré.',
      v_portees using errcode = '23514';
  end if;
end
$garde$;

alter table public.lignes_bancaires drop constraint lignes_bancaires_date_valeur_proche;
alter table public.lignes_bancaires drop column date_valeur;
