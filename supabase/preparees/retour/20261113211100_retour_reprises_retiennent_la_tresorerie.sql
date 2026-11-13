-- RETOUR de la migration `reprises_retiennent_la_tresorerie` (A8B-Q3, ligne 51.5 ;
-- supabase/preparees/20261113211000_reprises_retiennent_la_tresorerie.sql). Rend à `verrouiller_modele_comptable` le corps
-- de la migration `modele_comptable_du_dossier`, à l'octet près (empreinte c5d5a1bd8c5f8213dee236fd0261d12f) : un dossier
-- qui porte des factures reprises passe de nouveau en engagement tant que son brouillon est vide. Aucune donnée n'est
-- touchée. Baisser `REPRISES_RETIENNENT_LA_TRESORERIE_PREVUES` D'ABORD (src/lib/reprisesRetiennentLaTresorerie.ts), puis
-- déployer, puis ce retour : la carte « Modèle comptable » redit le refus de la base. Rien n'y est retiré — la fonction se
-- remplace, son déclencheur et ses droits restent — : par l'outil.

-- La garde de tête : la garde est celle que la migration a posée.
do $garde$
declare
  v_empreinte text;
begin
  select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) into v_empreinte
    from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.verrouiller_modele_comptable()');
  if v_empreinte is distinct from '2a25b53f2d34b7c1ba811dd1ca4f323f' then
    raise exception 'Retour d''A8B-Q3 : verrouiller_modele_comptable n''est pas celle de reprises_retiennent_la_tresorerie (empreinte %) : rien n''est rendu.',
      coalesce(v_empreinte, 'absente');
  end if;
end
$garde$;

create or replace function public.verrouiller_modele_comptable() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if (new.mode_comptable is distinct from old.mode_comptable
      or new.compte_notes_de_frais is distinct from old.compte_notes_de_frais)
     and exists (select 1 from public.ecritures_brouillon e where e.dossier_id = new.id) then
    raise exception 'Le modèle comptable d''un dossier ne se change que tant que son brouillon d''écritures est vide.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- La garde de fin : le corps d'hier, à son empreinte.
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.verrouiller_modele_comptable()')) is distinct from 'c5d5a1bd8c5f8213dee236fd0261d12f' then
    raise exception 'Retour d''A8B-Q3 : le corps rendu n''est pas celui de modele_comptable_du_dossier : rien n''est rendu.';
  end if;
end
$fin$;
