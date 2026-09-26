create table public.a_nouveaux (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  date date not null,
  compte text not null check (compte ~ '^[1-5][0-9]{2,}$'),
  compte_origine text,
  libelle text not null default '',
  sens text not null check (sens in ('debit', 'credit')),
  montant numeric(14,2) not null check (montant > 0),
  source_nom text not null,
  source_empreinte text not null check (source_empreinte ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index a_nouveaux_dossier_id_idx on public.a_nouveaux (dossier_id);

comment on table public.a_nouveaux is
  'Soldes d''ouverture d''un dossier repris d''un autre logiciel, tirés de sa balance (ligne 29 de la '
  'feuille de route, décision du cabinet du 26/09/2026). Comptes de bilan seulement (classes 1 à 5), '
  'le résultat de l''exercice précédent en 120 ou 129. Une seule ouverture par dossier : même date et '
  'même balance source pour toutes les lignes (trigger a_nouveaux_une_seule_ouverture), écrite en une '
  'transaction par enregistrer_a_nouveaux, qui refuse un jeu déséquilibré.';

alter table public.a_nouveaux enable row level security;

create policy "a_nouveaux_cabinet" on public.a_nouveaux
  for all
  to authenticated
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create function public.a_nouveaux_une_seule_ouverture() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.a_nouveaux a
    where a.dossier_id = new.dossier_id
      and a.id <> new.id
      and (a.date <> new.date or a.source_empreinte <> new.source_empreinte)
  ) then
    raise exception 'Ce dossier porte déjà les à-nouveaux d''une autre reprise : les retirer avant d''en enregistrer d''autres.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger a_nouveaux_une_seule_ouverture
  before insert or update on public.a_nouveaux
  for each row execute function public.a_nouveaux_une_seule_ouverture();

create function public.enregistrer_a_nouveaux(
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
