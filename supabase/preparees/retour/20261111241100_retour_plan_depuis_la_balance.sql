-- RETOUR de la migration `plan_depuis_la_balance` (PC6, ligne 43 ; supabase/preparees/20261111241000_plan_depuis_la_balance.sql).
-- Remet `enregistrer_a_nouveaux` au corps de `creation_a_nouveaux` (26/09/2026), à l'octet près : les à-nouveaux ne se
-- jugent plus contre le plan du dossier (un 4455100 s'ouvre de nouveau sous ce numéro). Aucune donnée n'est touchée : des
-- à-nouveaux déjà enregistrés restent tels quels, rangés ou non. Le corps porte, comme hier, la suppression des à-nouveaux
-- qu'il remplace : il SE COLLE, comme la migration. Abaisser `PLAN_DEPUIS_LA_BALANCE_PREVU` n'est pas exigé (le rangement
-- sur le plan reste juste sans la garde de la base) ; le retour, sans plus.

-- ══ 0. La garde : le corps que pose `plan_depuis_la_balance`, ou rien ══════════════════════════════════════════════════
do $garde$
begin
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.enregistrer_a_nouveaux(uuid, date, text, text, jsonb)'))
     is distinct from '4ba4d3f5c51cbef540ab19ea3148dd66' then
    raise exception 'La fonction enregistrer_a_nouveaux n''est pas celle que pose la migration plan_depuis_la_balance : ce retour ne s''applique pas.';
  end if;
end
$garde$;

create or replace function public.enregistrer_a_nouveaux(
  p_dossier_id uuid,
  p_date date,
  p_source_nom text,
  p_source_empreinte text,
  p_lignes jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  if not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if extract(month from p_date) <> 1 or extract(day from p_date) <> 1 then
    raise exception 'Des à-nouveaux ouvrent un exercice : leur date est un 1er janvier.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lignes) is distinct from 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune ligne à enregistrer.' using errcode = '22023';
  end if;

  -- Deux enregistrements simultanés du même dossier : sans ce verrou, chacun supprime ce que l'autre
  -- n'a pas encore validé, puis les deux insèrent, et le trigger ne voit pas les lignes de l'autre
  -- transaction.
  perform pg_advisory_xact_lock(hashtextextended('a_nouveaux:' || p_dossier_id::text, 0));

  delete from public.a_nouveaux where dossier_id = p_dossier_id;

  insert into public.a_nouveaux (dossier_id, date, compte, compte_origine, libelle, sens, montant, source_nom, source_empreinte)
  select p_dossier_id, p_date, l->>'compte', nullif(l->>'compte_origine', ''), coalesce(l->>'libelle', ''),
         l->>'sens', (l->>'montant')::numeric, p_source_nom, p_source_empreinte
  from jsonb_array_elements(p_lignes) as l;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.a_nouveaux where dossier_id = p_dossier_id;
  if v_debit <> v_credit then
    raise exception 'À-nouveaux déséquilibrés : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

revoke execute on function public.enregistrer_a_nouveaux(uuid, date, text, text, jsonb) from public, anon;
grant execute on function public.enregistrer_a_nouveaux(uuid, date, text, text, jsonb) to authenticated;
