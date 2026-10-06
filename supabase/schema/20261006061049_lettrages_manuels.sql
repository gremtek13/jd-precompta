-- Ligne 32 de la feuille de route, seconde brique : LE LETTRAGE FAIT À LA MAIN — une facture compensée par un
-- avoir, ou par une autre pièce, sans mouvement bancaire.
--
-- La première brique DÉDUIT le lettrage du rapprochement (src/lib/lettrage.ts) : en engagement, quand la facture
-- d'une pièce et ses règlements se soldent au centime sur son compte de tiers, ils reçoivent le même code. Ce qu'elle
-- ne peut pas voir, c'est ce qui se solde ENTRE PIÈCES : un avoir qui annule une facture sans qu'aucun argent ne
-- circule, le reste d'une facture payée en partie qu'un avoir solde, le trop-payé d'une facture qui en règle une
-- autre. Chacune reste alors ouverte dans les comptes de tiers, et le FEC ne les lettre pas.
--
-- LE GESTE EST CELUI DU CABINET : il choisit les pièces d'un même tiers qui se soldent ensemble. Rien n'est écrit
-- dans le brouillon — aucune écriture ne bouge — : la table ne garde que l'appariement, et le code et la date du
-- lettrage se calculent comme ceux de la première brique. Il ne se fige pas avec la validation d'un exercice, pour
-- la même raison : il ne modifie rien de ce que la validation garantit.
--
-- CE QUE LA BASE TIENT : un dossier tenu en engagement, un compte de tiers qui se lettre, au moins deux pièces du
-- dossier, chacune portant des écritures sur ce compte sans y être déjà soldée par ses règlements, et une somme
-- nulle au centime ; une pièce n'entre que dans un lettrage fait à la main. CE QU'ELLE NE PEUT PAS TENIR, et
-- l'application le fait avant le clic : que les pièces soient du MÊME TIERS — leur compte auxiliaire se tire du nom
-- lu (`auxiliaireDuTiers`), que la base ne sait pas recalculer. Et une somme vraie aujourd'hui peut cesser de
-- l'être (un rapprochement posé ou annulé depuis) : l'application recalcule chaque lettrage à la lecture, ne lettre
-- que ceux qui se soldent encore, et dit les autres — la règle du règlement groupé, pour la même raison.
--
-- DÉFAIRE un lettrage, c'est retirer ses lignes, sous la policy de la table : aucune écriture n'en dépend.
--
-- UNE PIÈCE SUPPRIMÉE LAISSE SA LIGNE, SANS PIÈCE (`on delete set null`) : supprimer une pièce reste possible, et
-- l'application dit quel lettrage a perdu une pièce.

create table public.lettrages_manuels (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  -- Le lettrage : les pièces lettrées ensemble portent le même.
  groupe uuid not null,
  piece_id uuid references public.pieces(id) on delete set null,
  compte text not null,
  created_at timestamptz not null default now(),
  constraint lettrages_manuels_compte check (compte in ('401000', '404000', '411000', '455000', '467000')),
  -- Une pièce n'a qu'un lettrage. NULLS DISTINCT, et c'est voulu : deux pièces d'un même lettrage supprimées
  -- laissent deux lignes sans pièce, qui ne doivent pas se heurter. Contrainte TOTALE, comme toute contrainte
  -- unique de ce schéma.
  constraint lettrages_manuels_une_fois_par_piece unique (piece_id)
);

comment on table public.lettrages_manuels is
  'Lettrages faits à la main dans les comptes de tiers d''un dossier en engagement : les pièces qui se soldent '
  'ensemble sans mouvement bancaire (une facture et son avoir). Une ligne par pièce, le groupe désigne le lettrage. '
  'Écrits par lettrer_pieces ; le code et la date du lettrage se calculent dans l''application.';
comment on column public.lettrages_manuels.groupe is
  'Le lettrage : les pièces lettrées ensemble portent le même groupe.';
comment on column public.lettrages_manuels.piece_id is
  'Nulle quand la pièce a été supprimée depuis : le lettrage ne se solde plus, et l''application le dit.';
comment on column public.lettrages_manuels.compte is
  'Le compte de tiers sur lequel les pièces se soldent ensemble (401000, 404000, 411000, 455000 ou 467000).';

create index lettrages_manuels_dossier_id_idx on public.lettrages_manuels (dossier_id);

alter table public.lettrages_manuels enable row level security;

-- La convention du projet, plus une garantie que la relecture ne donne pas : la pièce appartient au dossier annoncé.
-- Une ligne SANS pièce reste admise à l'insertion, pour qu'une sauvegarde qui en porte une se restaure. Le client
-- n'y a aucun accès : les comptes de tiers ne lui sont pas montrés.
create policy lettrages_manuels_cabinet on public.lettrages_manuels
  for all to authenticated
  using (admin_du_dossier(dossier_id))
  with check (
    admin_du_dossier(dossier_id)
    and (
      piece_id is null
      or exists (
        select 1 from public.pieces p
         where p.id = lettrages_manuels.piece_id
           and p.dossier_id = lettrages_manuels.dossier_id
      )
    )
  );

create function public.lettrer_pieces(
  p_dossier_id uuid,
  p_compte text,
  p_pieces uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mode text;
  v_groupe uuid := gen_random_uuid();
  v_piece uuid;
  v_nb integer;
  v_solde bigint;
  v_total bigint := 0;
begin
  if p_dossier_id is null or not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select mode_comptable into v_mode from public.dossiers where id = p_dossier_id;
  if v_mode is distinct from 'engagement' then
    raise exception 'Le lettrage ne se fait que dans un dossier tenu en engagement.' using errcode = '22023';
  end if;
  if p_compte is null or p_compte not in ('401000', '404000', '411000', '455000', '467000') then
    raise exception 'Ce compte n''est pas un compte de tiers qui se lettre.' using errcode = '22023';
  end if;
  if p_pieces is null or cardinality(p_pieces) < 2 or array_position(p_pieces, null) is not null then
    raise exception 'Un lettrage fait à la main apparie au moins deux pièces.' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_pieces) as x) <> cardinality(p_pieces) then
    raise exception 'Une pièce est choisie deux fois.' using errcode = '22023';
  end if;

  foreach v_piece in array p_pieces loop
    if not exists (select 1 from public.pieces where id = v_piece and dossier_id = p_dossier_id) then
      raise exception 'Une des pièces n''appartient pas à ce dossier.' using errcode = '22023';
    end if;
    if exists (select 1 from public.lettrages_manuels where piece_id = v_piece) then
      raise exception 'Une des pièces est déjà lettrée à la main avec d''autres : défais d''abord ce lettrage.'
        using errcode = '22023';
    end if;
    -- En centimes : le montant n'est pas contraint au centime en base, et une somme de numériques arrondie à la fin
    -- ne dirait pas la même chose que l'application, qui arrondit chaque ligne.
    select count(*), coalesce(sum(case when sens = 'debit' then 1 else -1 end * round(montant * 100)), 0)::bigint
      into v_nb, v_solde
      from public.ecritures_brouillon
     where dossier_id = p_dossier_id and piece_id = v_piece and compte = p_compte;
    if v_nb = 0 then
      raise exception 'Une des pièces n''a aucune écriture sur ce compte : génère d''abord ses écritures.'
        using errcode = '22023';
    end if;
    if v_solde = 0 then
      raise exception 'Une des pièces est déjà soldée par ses règlements : elle se lettre seule.' using errcode = '22023';
    end if;
    v_total := v_total + v_solde;
  end loop;

  if v_total <> 0 then
    raise exception 'Ces pièces ne se soldent pas : il reste % € sur le compte.',
      replace(to_char(abs(v_total) / 100.0, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  insert into public.lettrages_manuels (dossier_id, groupe, piece_id, compte)
  select p_dossier_id, v_groupe, x, p_compte from unnest(p_pieces) as x;
  return v_groupe;
end;
$$;

comment on function public.lettrer_pieces(uuid, text, uuid[]) is
  'Lettre ensemble, à la main, des pièces d''un dossier en engagement qui se soldent sur un compte de tiers sans '
  'mouvement bancaire. Rend le groupe du lettrage. SECURITY INVOKER : la RLS s''applique dedans.';

revoke execute on function public.lettrer_pieces(uuid, text, uuid[]) from public, anon;
grant execute on function public.lettrer_pieces(uuid, text, uuid[]) to authenticated;
