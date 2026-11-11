-- LM8 : LA FACTURE D'HONORAIRES VALIDÉE DÉPOSÉE CHEZ LE CLIENT (ligne 47, le cabinet et ses clients) — PRÉPARÉE, PAS
-- APPLIQUÉE. Après `dossier_du_cabinet` (LM1), `lettres_de_mission` (LM4) et `honoraires_factures` (LM7), dont elle lit la
-- désignation, les lettres et les liens d'une facture à ses honoraires.
--
-- La conception : HISTORIQUE.md, « 10/11/2026 — LA LETTRE DE MISSION ET LES HONORAIRES DU CABINET : LA CONCEPTION
-- (LIGNE 47) », point 4 : « La facture d'honoraires validée se dépose, sur un clic, comme pièce « à valider » du dossier du
-- client (une dépense au 622600 chez lui) » ; LM-Q8, tranchée à la recommandation : le dépôt sur un clic, ni d'office ni
-- jamais. Le récit : HISTORIQUE.md, « 11/11/2026 — LM8 ».
--
-- SOURCES. Aucune règle légale n'impose ce dépôt : c'est un service du cabinet à son client. La facture reste celle que le
-- dossier du cabinet a émise et figée (CGI, art. 289 ; A7) ; l'exemplaire déposé n'en est qu'une COPIE, tirée de ses seules
-- valeurs figées — ni la remise de la facture, ni sa transmission électronique, qui restent celles de toute facture du
-- dossier du cabinet. Chez le client, c'est une pièce d'achat comme une autre, que le cabinet, son comptable, valide ou non
-- (« rien n'est jamais validé automatiquement », CLAUDE.md). Aucune norme AFNOR.
--
-- CE QU'ELLE FAIT.
--   1. `honoraires_deposes`, dans le dossier du cabinet : le DÉPÔT d'une facture d'honoraires validée — ou de l'avoir qui la
--      corrige — dans le dossier de son client : la facture, le dossier du client et la pièce qui l'y porte (deux
--      références SANS clé : un autre dossier, qu'une restauration ne sacrifie pas, comme le client d'une lettre, LM4),
--      l'empreinte SHA-256 du PDF déposé, l'auteur et l'instant. Le numéro du dépôt (`depot`) : 1, puis 2 si la pièce du
--      premier a été retirée du dossier du client (rien ne s'écrit à ce retrait : le dépôt se DÉDUIT de la pièce présente).
--   2. UNE FACTURE NE SE DÉPOSE QU'UNE FOIS : jamais deux pièces présentes pour une même facture — la garde, pour tout
--      auteur, et une contrainte TOTALE (`honoraires_deposes_une_fois`) qui numérote les dépôts successifs.
--   3. `deposer_honoraires_chez_le_client(dossier du cabinet, facture, chemin, empreinte)` : le clic. Le navigateur a tiré
--      le PDF des valeurs figées de la facture et l'a déposé dans le seau des pièces, sous le dossier du client ; la
--      fonction juge, puis écrit la PIÈCE « à valider » d'achat (date, émetteur et montants LUS de la facture, jamais
--      donnés par l'appelant ; le nom du fichier composé par la base ; ni catégorie ni lecture) et le dépôt. Tout ou rien.
--   4. Deux lectures, sans rien d'autre : `depots_des_honoraires` (le dossier du cabinet : le dernier dépôt de chacune de
--      ses factures, et si sa pièce est encore chez le client) et `honoraires_deposes_au_dossier` (un dossier client : ses
--      pièces qui sont des honoraires de son cabinet, leur nature et leur jour — rien du dossier du cabinet, de sa facture
--      ni d'un autre client), que le client lit aussi, pour dire « déposée par ton cabinet » dans « Mes pièces ».
-- Les refus de la fonction, dans leur ordre et à leurs mots, sont redits par src/lib/depotDesHonoraires.ts, derrière
-- `DEPOT_DES_HONORAIRES_PREVU`, baissé.
--
-- CE QUI A ÉTÉ CHOISI, ET POURQUOI :
--   - le dépôt dans le dossier du CABINET, la pièce et le dossier du client en références sans clé : la facture, ses
--     honoraires et ses lettres y vivent déjà (LM4, LM7), le chef et les membres qui y sont assignés le lisent (LM-Q2), le
--     client n'y a aucun accès (LM1) ; une clé vers un autre dossier serait sacrifiée à chaque restauration (LM4) ;
--   - écarté : une colonne de `pieces` (une table centrale, que l'empreinte d'un exercice validé scelle, INAL2, et que le
--     client lit en entier) ; `pieces.facture_id` (l'exemplaire d'une facture VENTE du MÊME dossier, VF2) ;
--   - la pièce retirée rend la facture à déposer, sans rien écrire (la contrainte totale numérote les dépôts, comme LM7
--     ses facturations), plutôt qu'une garde sur `pieces` qui refuserait son retrait : aucun déclencheur de plus sur une
--     table que tous les écrans du cabinet écrivent (LM8-Q1) ;
--   - les valeurs de la pièce LUES de la facture figée — date d'émission, nom légal de l'émetteur, montants (négatifs pour
--     un avoir, comme un avoir reçu d'une plateforme), nom du fichier — : « des VALEURS lues en base, jamais un texte de
--     l'appelant » (A7) ; seuls le chemin et l'empreinte viennent du navigateur, qui a tiré et déposé le fichier ; la base
--     vérifie que le fichier est dans le seau des pièces, sous le dossier du client, en PDF, et qu'aucune pièce du dossier
--     ne le porte déjà (fichier ou empreinte) ;
--   - qui dépose : un compte qui ouvre LES DEUX dossiers (`admin_du_dossier`) — il lit la facture, et il écrit déjà dans
--     le dossier du client (la policy du seau des pièces le demande pour le fichier) ; un membre assigné au seul dossier du
--     cabinet ne dépose rien chez un client qu'il ne tient pas ;
--   - un avoir ne se dépose qu'après la facture qu'il corrige, encore chez le client (sinon le client porterait un avoir
--     sans sa facture) ; une facture reprise de l'ancien logiciel ne se dépose pas d'ici (son original vit dans le seau des
--     ventes, A8d2a) ; une facture qui n'a pas figé ses mentions non plus (son PDF ne se tirerait pas de ses seules valeurs
--     figées).
--
-- CE QU'ELLE NE FAIT PAS : le PDF (le navigateur le tire, src/lib) ; « Mes honoraires » sous la case « Documents » (B1, puis
-- la suite de LM8) ; l'écriture de la dépense chez le client (la validation de la pièce, comme toute pièce d'achat).
--
-- À COLLER : les clés étrangères (en cascade) et la garde nomment l'action de suppression. Rien ne se détruit : une table,
-- quatre fonctions, un déclencheur et deux policies s'ajoutent, rien ne se remplace. Son retour :
-- supabase/preparees/retour/20261111230100_retour_depot_des_honoraires.sql (à coller AVANT celui de LM7). Son essai :
-- supabase/essais/depotDesHonoraires.sql (sur une réplique : il désigne le dossier du cabinet et retire une pièce) ; puis
-- rls.sql (le bloc HD).

do $garde$
begin
  if to_regclass('public.dossiers') is null or to_regclass('public.factures_emises') is null
     or to_regclass('public.pieces') is null or to_regclass('public.cabinets') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null or to_regprocedure('public.is_super_admin()') is null
     or to_regprocedure('public.client_du_dossier(uuid, text)') is null then
    raise exception 'Les tables ou les fonctions que la migration suppose manquent : relire la base.';
  end if;
  if to_regprocedure('public.est_dossier_du_cabinet(uuid)') is null or to_regclass('public.lettres_de_mission') is null
     or to_regclass('public.honoraires_factures') is null then
    raise exception 'Le dossier du cabinet (LM1), les lettres de mission (LM4) et les factures d''honoraires (LM7) ne sont pas en base : les coller d''abord.';
  end if;
  if to_regclass('public.honoraires_deposes') is not null then
    raise exception 'Le dépôt des honoraires est déjà en base : la migration a déjà été appliquée.';
  end if;
end
$garde$;

-- ══ 1. Le dépôt d'une facture d'honoraires chez son client ══════════
create table public.honoraires_deposes (
  id uuid primary key default gen_random_uuid(),
  -- Le dossier du cabinet, celui de la facture.
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  -- La facture ou l'avoir déposé : une facture validée ne part qu'avec son dossier (la clé ne cède pas).
  facture_id uuid not null references public.factures_emises (id),
  -- Le dépôt de cette facture : 1, puis 2 si la pièce du premier a été retirée du dossier du client, et ainsi de suite.
  depot smallint not null default 1
    constraint honoraires_deposes_depot check (depot between 1 and 1000),
  -- Le dossier du client et la pièce qui y porte la facture : des références SANS clé (un autre dossier).
  dossier_client_id uuid not null,
  piece_id uuid not null,
  -- L'empreinte SHA-256 du PDF déposé, celle que porte la pièce.
  empreinte text not null
    constraint honoraires_deposes_empreinte check (empreinte ~ '^[0-9a-f]{64}$'),
  auteur uuid not null,
  depose_le timestamptz not null default now(),
  constraint honoraires_deposes_une_fois unique (facture_id, depot),
  constraint honoraires_deposes_piece unique (piece_id)
);
create index honoraires_deposes_dossier on public.honoraires_deposes (dossier_id);
create index honoraires_deposes_dossier_client on public.honoraires_deposes (dossier_client_id);
comment on table public.honoraires_deposes is
  'Le dépôt d''une facture d''honoraires validée du dossier du cabinet (ou de son avoir) dans le dossier de son client, comme pièce d''achat « à valider » (LM8, ligne 47) : une facture n''a jamais deux pièces présentes chez le client.';

-- Le client d'une facture d'honoraires : celui de la lettre que ses liens citent (LM7 n'en admet qu'un par facture) ;
-- d'un avoir, celui de la facture qu'il corrige. Nul pour toute autre facture. Aux droits de l'appelant : la garde et la
-- fonction l'appellent (la fonction, sous les droits de son propriétaire).
create function public.client_de_la_facture_d_honoraires(p_facture uuid) returns uuid
language sql stable set search_path = public
as $$ select (select l.dossier_client_id
                from public.honoraires_factures h join public.lettres_de_mission l on l.id = h.lettre_id
               where h.facture_id = case when f.type = 'avoir' then f.facture_origine_id else f.id end
               order by h.cree_le, h.id limit 1)
        from public.factures_emises f where f.id = p_facture $$;

-- LA GARDE, pour tout auteur — la fonction, la restauration du super-administrateur, le propriétaire. Un dépôt ne se
-- modifie pas ; il ne se supprime qu'avec son dossier. À l'insertion : le dossier du cabinet ; une facture de ce dossier,
-- validée, facture ou avoir ; son client, celui que ses honoraires désignent ; et, quand sa pièce est présente, une pièce
-- d'achat du dossier du client, la seule pièce présente de cette facture. Ce que la fonction juge de plus — le fichier,
-- l'auteur, l'avoir après sa facture — tient au clic : une restauration réinsère l'histoire telle qu'elle a été écrite.
create function public.garder_honoraires_deposes() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_facture public.factures_emises;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Le dépôt d''une facture d''honoraires ne se retire pas : retirer sa pièce du dossier du client la rend à déposer.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Le dépôt d''une facture d''honoraires ne se modifie pas.' using errcode = '23514';
  end if;

  if not exists (select 1 from public.cabinets c where c.dossier_du_cabinet = new.dossier_id) then
    raise exception 'Une facture d''honoraires se dépose depuis le dossier du cabinet.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.honoraires_deposes:' || new.dossier_id::text, 0));
  select f.* into v_facture from public.factures_emises f where f.id = new.facture_id;
  if not found or v_facture.dossier_id <> new.dossier_id or v_facture.statut <> 'validee'
     or v_facture.type not in ('facture', 'avoir') then
    raise exception 'Seule une facture ou un avoir validé du dossier du cabinet se dépose chez le client.' using errcode = '23514';
  end if;
  if public.client_de_la_facture_d_honoraires(new.facture_id) is distinct from new.dossier_client_id then
    raise exception 'Une facture d''honoraires se dépose chez le client que ses honoraires désignent.' using errcode = '23514';
  end if;
  if exists (select 1 from public.pieces p where p.id = new.piece_id) then
    if not exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_client_id
                    and p.type_piece = 'achat') then
      raise exception 'La pièce d''un dépôt est une pièce d''achat du dossier du client.' using errcode = '23514';
    end if;
    if exists (select 1 from public.honoraires_deposes h join public.pieces p on p.id = h.piece_id
                where h.facture_id = new.facture_id and h.id is distinct from new.id) then
      raise exception 'Cette facture est déjà déposée chez le client.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
create trigger honoraires_deposes_gardes
  before insert or update or delete on public.honoraires_deposes
  for each row execute function public.garder_honoraires_deposes();

-- ══ 2. Qui lit ══════════
-- Le chef et les membres assignés au dossier du cabinet (LM-Q2) LISENT ; le super-administrateur insère pour restaurer.
-- Aucune policy d'écriture ordinaire : la fonction écrit. Le client n'y voit rien (le dossier du cabinet n'a aucun accès
-- client, LM1) : il lit ses pièces, et `honoraires_deposes_au_dossier` lui dit lesquelles sont des honoraires.
alter table public.honoraires_deposes enable row level security;
create policy honoraires_deposes_lecture on public.honoraires_deposes
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy honoraires_deposes_restauration on public.honoraires_deposes
  for insert to authenticated with check (public.is_super_admin());

-- ══ 3. Le clic : « Déposer chez le client » ══════════
-- Les refus, dans cet ordre (src/lib/depotDesHonoraires.ts les redit, à leurs mots) : l'accès au dossier du cabinet
-- (42501) ; le dossier du cabinet (23514) ; l'empreinte, puis le chemin, de forme (22023) ; puis, sous un verrou par
-- dossier du cabinet : la facture introuvable dans ce dossier (P0002) ; pas validée ; reprise ou sans mentions figées ;
-- sans honoraires d'une lettre (22023) ; l'avoir dont la facture n'est pas chez le client (22023) ; le dossier du client
-- disparu ou d'un autre cabinet (22023) ; le dossier du client fermé à ce compte (42501) ; la facture déjà déposée
-- (23514) ; le fichier hors du dossier du client, absent du seau des pièces ou pas un PDF (22023) ; un fichier ou une
-- empreinte qu'une pièce du dossier du client porte déjà (23505). Rend la pièce créée, « à valider ».
create function public.deposer_honoraires_chez_le_client(p_dossier_id uuid, p_facture_id uuid, p_chemin text, p_empreinte text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_facture public.factures_emises;
  v_client uuid;
  v_cabinet uuid;
  v_type text;
  v_piece uuid;
  v_nom text;
begin
  if not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if not public.est_dossier_du_cabinet(p_dossier_id) then
    raise exception 'Les factures d''honoraires se déposent depuis le dossier du cabinet.' using errcode = '23514';
  end if;
  if p_empreinte is null or p_empreinte !~ '^[0-9a-f]{64}$' then
    raise exception 'L''empreinte du fichier est son SHA-256, en soixante-quatre caractères hexadécimaux minuscules.' using errcode = '22023';
  end if;
  if p_chemin is null or length(p_chemin) > 500 or p_chemin !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+[.]pdf$'
     or position('..' in p_chemin) > 0 then
    raise exception 'Le fichier se dépose dans le dossier du client, en PDF, sous un nom sans dossier.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('jd.honoraires_deposes:' || p_dossier_id::text, 0));
  select f.* into v_facture from public.factures_emises f
   where f.id = p_facture_id and f.dossier_id = p_dossier_id for share;
  if not found then
    raise exception 'Facture introuvable dans le dossier du cabinet.' using errcode = 'P0002';
  end if;
  if v_facture.statut not in ('validee', 'importee') then
    raise exception 'Seule une facture validée se dépose chez le client.' using errcode = '22023';
  end if;
  if v_facture.statut = 'importee' or not v_facture.mentions_figees then
    raise exception 'Une facture reprise de l''ancien logiciel, ou qui n''a pas figé ses mentions, ne se dépose pas d''ici : son PDF ne se tirerait pas de ses seules valeurs figées.'
      using errcode = '22023';
  end if;
  v_client := public.client_de_la_facture_d_honoraires(p_facture_id);
  if v_client is null then
    raise exception 'Cette facture ne facture les honoraires d''aucune lettre de mission : elle ne se dépose chez aucun client.'
      using errcode = '22023';
  end if;
  if v_facture.type = 'avoir' and not exists (
       select 1 from public.honoraires_deposes h join public.pieces p on p.id = h.piece_id
        where h.facture_id = v_facture.facture_origine_id and p.dossier_id = v_client) then
    raise exception 'Un avoir se dépose après la facture qu''il corrige, et tant qu''elle est chez le client.' using errcode = '22023';
  end if;
  select d.cabinet_id into v_cabinet from public.dossiers d where d.id = v_client;
  if not found or v_cabinet is distinct from (select d.cabinet_id from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Le dossier du client n''existe plus dans ce cabinet.' using errcode = '22023';
  end if;
  if not public.admin_du_dossier(v_client) then
    raise exception 'Le dossier du client n''est pas ouvert à ce compte : le chef du cabinet, ou un membre qui y est assigné, y dépose la facture.'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.honoraires_deposes h join public.pieces p on p.id = h.piece_id
              where h.facture_id = p_facture_id) then
    raise exception 'Cette facture est déjà déposée chez le client.' using errcode = '23514';
  end if;
  if split_part(p_chemin, '/', 1) <> v_client::text
     or not exists (select 1 from storage.objects o
                     where o.bucket_id = 'pieces' and o.name = p_chemin
                       and lower(btrim(split_part(o.metadata ->> 'mimetype', ';', 1))) = 'application/pdf') then
    raise exception 'Le PDF n''est pas déposé dans le seau des pièces, sous le dossier du client : le déposer d''abord.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.pieces p
              where p.dossier_id = v_client
                and (p.storage_path = p_chemin or p.lisible_path = p_chemin or p.storage_hash = p_empreinte)) then
    raise exception 'Ce fichier est déjà une pièce du dossier du client.' using errcode = '23505';
  end if;

  v_type := v_facture.type;
  v_nom := case when v_type = 'avoir' then 'Avoir ' else 'Facture ' end || coalesce(v_facture.numero, '') || '.pdf';
  insert into public.pieces (dossier_id, uploaded_by, source, storage_path, storage_hash, nom_fichier, date_piece, tiers,
                             montant_ht, montant_tva, montant_ttc, devise, type_piece, statut, confiance)
  values (v_client, auth.uid(), 'upload', p_chemin, p_empreinte, v_nom, v_facture.date_emission,
          coalesce(nullif(btrim(v_facture.denomination_imprimee), ''), nullif(btrim(v_facture.emetteur_nom), '')),
          v_facture.montant_ht, v_facture.montant_tva, v_facture.montant_ttc, 'EUR', 'achat', 'a_valider', 'haute')
  returning id into v_piece;
  insert into public.honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur)
  values (p_dossier_id, p_facture_id,
          1 + (select count(*) from public.honoraires_deposes h where h.facture_id = p_facture_id),
          v_client, v_piece, p_empreinte, auth.uid());
  return v_piece;
end
$$;

-- ══ 4. Les deux lectures ══════════
-- Le dossier du cabinet : le DERNIER dépôt de chacune de ses factures, et si sa pièce est encore chez le client (une
-- pièce que le compte ne lit peut-être pas : la fonction la voit pour lui, sans rien en rendre que sa présence).
create function public.depots_des_honoraires(p_dossier_id uuid)
returns table (facture_id uuid, depot smallint, dossier_client_id uuid, piece_id uuid, depose_le timestamptz, presente boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  return query
    select distinct on (h.facture_id) h.facture_id, h.depot, h.dossier_client_id, h.piece_id, h.depose_le,
           exists (select 1 from public.pieces p where p.id = h.piece_id)
      from public.honoraires_deposes h
     where h.dossier_id = p_dossier_id
     order by h.facture_id, h.depot desc;
end
$$;

-- Un dossier client : ses pièces PRÉSENTES qui sont des honoraires de son cabinet — la pièce, sa nature (facture ou avoir)
-- et le jour du dépôt, rien d'autre : ni la facture, ni le dossier du cabinet, ni un autre client. Au cabinet du dossier
-- et à tout accès client de ce dossier (« Mes pièces » dit « déposée par ton cabinet »).
create function public.honoraires_deposes_au_dossier(p_dossier_id uuid)
returns table (piece_id uuid, nature text, depose_le timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'membre')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  return query
    select h.piece_id, f.type, h.depose_le
      from public.honoraires_deposes h
      join public.factures_emises f on f.id = h.facture_id
      join public.pieces p on p.id = h.piece_id and p.dossier_id = p_dossier_id
     where h.dossier_client_id = p_dossier_id
     order by h.depose_le, h.piece_id;
end
$$;

-- Les fonctions vérifient l'accès elles-mêmes ; le contrôle, aux droits de l'appelant, sert la garde (que la restauration
-- du super-administrateur traverse sous `authenticated`) ; la garde ne sert qu'à la base.
revoke execute on function public.deposer_honoraires_chez_le_client(uuid, uuid, text, text) from public, anon;
grant execute on function public.deposer_honoraires_chez_le_client(uuid, uuid, text, text) to authenticated;
revoke execute on function public.depots_des_honoraires(uuid) from public, anon;
grant execute on function public.depots_des_honoraires(uuid) to authenticated;
revoke execute on function public.honoraires_deposes_au_dossier(uuid) from public, anon;
grant execute on function public.honoraires_deposes_au_dossier(uuid) to authenticated;
revoke execute on function public.client_de_la_facture_d_honoraires(uuid) from public, anon;
grant execute on function public.client_de_la_facture_d_honoraires(uuid) to authenticated;
revoke execute on function public.garder_honoraires_deposes() from public, anon, authenticated;
