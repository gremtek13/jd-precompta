-- Les transmissions d'une facture (ligne 28.5, étape c) : chaque envoi d'une facture validée, par la plateforme agréée
-- du client ou par Super PDP, laisse une ligne — son canal, l'hôte qui l'a reçue, le flux que celui-ci a rendu,
-- l'empreinte du fichier transmis et son état. Une seule transmission ACTIVE par facture, tous canaux confondus : une
-- facture ne part pas deux fois, et une nouvelle tentative n'est possible qu'après un échec ou un rejet.
create table public.transmissions_factures (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  facture_id uuid not null references public.factures_emises (id) on delete cascade,
  canal text not null constraint transmissions_factures_canal check (canal in ('plateforme', 'superpdp')),
  hote text not null
    constraint transmissions_factures_hote check (hote ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  flux_id text constraint transmissions_factures_flux_id check (flux_id <> '' and length(flux_id) <= 200),
  sha256 text not null constraint transmissions_factures_sha256 check (sha256 ~ '^[0-9a-f]{64}$'),
  etat text not null default 'envoi'
    constraint transmissions_factures_etat check (etat in ('envoi', 'echec', 'depose', 'accepte', 'rejete')),
  detail text constraint transmissions_factures_detail check (length(detail) <= 2000),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  -- Déposée, acceptée ou rejetée, la facture est connue de la plateforme, qui lui a donné un flux.
  constraint transmissions_factures_flux_connu check (etat in ('envoi', 'echec') or flux_id is not null)
);

-- Partiel, et c'est voulu : les échecs et les rejets s'accumulent, une seule transmission reste active. Aucun upsert ne
-- le vise — une transmission s'insère, puis se met à jour par son identifiant.
create unique index transmissions_factures_une_active on public.transmissions_factures (facture_id)
  where etat in ('envoi', 'depose', 'accepte');
create index transmissions_factures_facture on public.transmissions_factures (facture_id);
create index transmissions_factures_dossier on public.transmissions_factures (dossier_id);

-- Une transmission désigne une facture VALIDÉE de son dossier, et ne change ensuite ni de facture, ni de canal, ni
-- d'hôte, ni de fichier ; un flux nommé ne se renomme pas, et une transmission ne revient pas en arrière : échouée,
-- acceptée ou rejetée, elle ne change plus d'état, et déposée, elle ne redevient ni un envoi ni un échec.
create function public.garder_transmission_facture() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.factures_emises f
                    where f.id = new.facture_id and f.dossier_id = new.dossier_id and f.statut = 'validee') then
      raise exception 'Seule une facture validée de son dossier se transmet.' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.dossier_id is distinct from old.dossier_id or new.facture_id is distinct from old.facture_id
     or new.canal is distinct from old.canal or new.hote is distinct from old.hote
     or new.sha256 is distinct from old.sha256 or new.cree_le is distinct from old.cree_le then
    raise exception 'Une transmission ne change ni de facture, ni de canal, ni d''hôte, ni de fichier.' using errcode = '23514';
  end if;
  if old.flux_id is not null and new.flux_id is distinct from old.flux_id then
    raise exception 'Le flux d''une transmission ne se renomme pas.' using errcode = '23514';
  end if;
  if old.etat in ('echec', 'accepte', 'rejete') and new.etat <> old.etat
     or old.etat = 'depose' and new.etat in ('envoi', 'echec') then
    raise exception 'Une transmission ne revient pas en arrière : % ne devient pas %.', old.etat, new.etat
      using errcode = '23514';
  end if;
  new.maj_le := now();
  return new;
end
$$;
revoke execute on function public.garder_transmission_facture() from public, anon, authenticated;

create trigger transmissions_factures_gardees before insert or update on public.transmissions_factures
  for each row execute function public.garder_transmission_facture();

-- Le cabinet LIT les transmissions de ses dossiers ; seules les Edge Functions qui transmettent les écrivent, avec la
-- clé secrète, hors RLS. Le super-administrateur en insère pour restaurer une sauvegarde : sans elles, une facture
-- déjà transmise pourrait repartir. Rien ne s'y modifie ni ne s'y supprime depuis le navigateur, et le client n'y
-- voit rien.
alter table public.transmissions_factures enable row level security;
create policy transmissions_factures_lecture on public.transmissions_factures
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy transmissions_factures_restauration on public.transmissions_factures
  for insert to authenticated with check (is_super_admin());

comment on table public.transmissions_factures is
  'Chaque envoi d''une facture validée (plateforme agréée du client ou Super PDP) : canal, hôte, flux rendu, empreinte du fichier transmis et état. Une seule transmission active par facture (transmissions_factures_une_active).';
