-- UNE PIÈCE JOINTE ÉCARTÉE À LA RÉCEPTION PAR E-MAIL SE DIT AU CABINET (ligne 22.7 de la feuille de route, préparée le
-- 13/10/2026 ; décision du cabinet du 13/10/2026, S226-Q3 : « une pièce jointe écartée à la réception par e-mail se dit
-- au cabinet, sans nom de fichier »).
--
-- LE DÉFAUT. Depuis la ligne 22.6, receive-email écarte une pièce jointe dont l'application refuse le format (ni PDF,
-- ni JPEG, ni PNG, ni CSV) ou qui pèse plus de 20 Mio, et n'en laisse qu'une ligne de journal. Le client croit l'avoir
-- envoyée ; le cabinet n'en sait rien — le journal de la fonction ne se garde qu'un temps et ne s'ouvre pas depuis
-- l'application — et « ce qu'il reste à envoyer » continue de la réclamer.
--
-- CE QUE CETTE MIGRATION POSE. Une table du dossier qui garde chaque pièce jointe écartée : le dossier, l'instant où la
-- fonction l'a reçue et écartée (celui de la base), la raison — le format ou la taille, et rien d'autre : une autre
-- cause est une question au cabinet —, le poids en octets. JAMAIS le nom du fichier, ni son extension, ni l'expéditeur,
-- ni l'objet de l'e-mail : la trace dit qu'une pièce manque, pas laquelle. receive-email l'écrit à la clé secrète.
--
-- LA CLÉ QUI REND L'ÉCRITURE IDEMPOTENTE. Resend rejoue le webhook quand la fonction échoue en cours de route : la même
-- pièce jointe ne doit pas s'écrire deux fois. La clé est l'EMPREINTE SHA-256 des deux identifiants que Resend donne à la
-- pièce jointe — celui de l'e-mail et le sien —, unique dans le dossier (contrainte TOTALE : la fonction écrit par
-- `on conflict … do nothing`, qu'un index partiel ne servirait pas). Écartés : les identifiants gardés tels quels, qui
-- désigneraient un e-mail qu'on peut relire chez Resend ; l'empreinte du CONTENU, qui ferait taire le même fichier
-- renvoyé dans un autre e-mail — un second envoi est un second écart — et reconnaîtrait un document connu. Les deux
-- identifiants sont aléatoires : leur empreinte ne se retrouve qu'en les connaissant, donc depuis Resend même.
--
-- QUI LIT, QUI ÉCRIT. Le cabinet du dossier LIT (`admin_du_dossier`, aux connectés) ; AUCUNE branche pour le client — les
-- accès clients sont restreints, et les lui ouvrir est une question au cabinet. Aucune policy de mise à jour ni de
-- suppression. Une seule policy d'insertion, la porte de la RESTAURATION, au super-administrateur : la sauvegarde d'un
-- dossier lit cette table et la restauration la réécrit avec la session du super-administrateur — sans cette porte,
-- elle s'arrêterait sur la première ligne (le patron de `statuts_factures_recus`, que plateforme-agreee écrit à la clé
-- secrète). receive-email n'en a pas besoin : la clé secrète passe outre la RLS.
--
-- « VUE ». Une alerte qui ne s'éteint jamais cesse d'être lue — un fichier de signature électronique ou une invitation
-- jointe à chaque e-mail transféré en ferait une par mois. Le cabinet la marque VUE par
-- `marquer_pieces_jointes_vues(dossier, identifiants)` seule (SECURITY DEFINER : l'accès au dossier annoncé d'abord,
-- puis les identifiants que l'écran a montrés, tous de ce dossier) ; elle reste en base, marquée, avec qui et quand. Une
-- ligne vue le reste : la première marque tient. La garde `garder_piece_jointe_ecartee` n'admet, à la mise à jour, que ce
-- passage, une fois — ce que la fonction a reçu ne change pas.
--
-- Données mesurées le 13/10/2026 : aucune — la table naît vide, et rien n'y entre avant le déploiement de receive-email
-- qui l'écrit. Le retour arrière est donné à part (il retire la table et ce qu'elle porte) : rien, dans ce texte, ne
-- retire quoi que ce soit.

-- ══ La table ══════════
create table public.pieces_jointes_ecartees (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  recue_le timestamptz not null default now(),
  raison text not null
    constraint pieces_jointes_ecartees_raison check (raison in ('format', 'taille')),
  octets bigint not null
    constraint pieces_jointes_ecartees_octets check (octets > 0),
  empreinte text not null
    constraint pieces_jointes_ecartees_empreinte check (empreinte ~ '^[0-9a-f]{64}$'),
  vue_le timestamptz,
  vue_par uuid,
  constraint pieces_jointes_ecartees_vue check ((vue_le is null) = (vue_par is null)),
  constraint pieces_jointes_ecartees_une_fois unique (dossier_id, empreinte)
);

-- ══ La garde ══════════
-- À la mise à jour, seul le passage de « non vue » à « vue » : rien de ce que la fonction a reçu ne change, une ligne vue
-- ne redevient pas « non vue » et sa première marque tient. Elle ne garde ni l'insertion (la restauration réinsère une
-- ligne déjà vue telle qu'elle a été vue) ni la suppression (aucune policy ne l'ouvre ; la cascade du dossier l'emporte).
create function public.garder_piece_jointe_ecartee() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.vue_le is not null or new.vue_le is null
     or (new.id, new.dossier_id, new.recue_le, new.raison, new.octets, new.empreinte)
        is distinct from (old.id, old.dossier_id, old.recue_le, old.raison, old.octets, old.empreinte) then
    raise exception 'Une pièce jointe écartée ne change pas : seule sa marque « vue » se pose, une fois.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pieces_jointes_ecartees_garde
  before update on public.pieces_jointes_ecartees
  for each row execute function public.garder_piece_jointe_ecartee();

-- ══ Qui lit, qui écrit ══════════
alter table public.pieces_jointes_ecartees enable row level security;

create policy pieces_jointes_ecartees_lecture on public.pieces_jointes_ecartees
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy pieces_jointes_ecartees_restauration on public.pieces_jointes_ecartees
  for insert to authenticated with check (is_super_admin());

-- ══ Marquer vues ══════════
-- Trois refus, dans cet ordre, que src/lib/piecesJointesEcartees.ts redit avant le clic :
--   1. l'accès au dossier ANNONCÉ, avant toute lecture de la table ;
--   2. aucune pièce jointe désignée ;
--   3. une pièce jointe désignée qui n'est pas de ce dossier (ou un identifiant nul) — la liste montrée a changé.
-- Celles qu'un autre membre a déjà marquées vues gardent leur marque. Rend le nombre de lignes marquées par cet appel.
create function public.marquer_pieces_jointes_vues(p_dossier_id uuid, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marquees integer;
begin
  -- 1.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2.
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Aucune pièce jointe désignée.' using errcode = '22023';
  end if;
  -- 3.
  if array_position(p_ids, null) is not null
     or (select count(distinct x) from unnest(p_ids) as x)
        <> (select count(*) from public.pieces_jointes_ecartees e where e.dossier_id = p_dossier_id and e.id = any (p_ids)) then
    raise exception 'Une pièce jointe désignée n''est pas de ce dossier : relire la liste avant de la marquer vue.'
      using errcode = 'P0002';
  end if;
  update public.pieces_jointes_ecartees e
     set vue_le = now(), vue_par = auth.uid()
   where e.dossier_id = p_dossier_id and e.id = any (p_ids) and e.vue_le is null;
  get diagnostics v_marquees = row_count;
  return v_marquees;
end
$$;

-- ══ Les droits d'exécution ══════════
-- La fonction qui écrit vérifie l'accès elle-même, et un anonyme n'a rien à y faire. La garde ne sert qu'au déclencheur :
-- personne ne l'appelle.
revoke execute on function public.marquer_pieces_jointes_vues(uuid, uuid[]) from public, anon;
grant execute on function public.marquer_pieces_jointes_vues(uuid, uuid[]) to authenticated;
revoke execute on function public.garder_piece_jointe_ecartee() from public, anon, authenticated;

comment on table public.pieces_jointes_ecartees is
  'Les pièces jointes que la réception par e-mail (receive-email) a écartées, par format ou par taille (ligne 22.7) : le dossier, l''instant, la raison, le poids, l''empreinte des identifiants Resend qui rend l''écriture idempotente, et la marque « vue » du cabinet — jamais le nom du fichier, son extension, l''expéditeur ni l''objet. Le cabinet la lit ; le client n''en voit rien.';
comment on column public.pieces_jointes_ecartees.empreinte is
  'SHA-256 (hexadécimal) du tableau JSON [identifiant de l''e-mail, identifiant de la pièce jointe] que Resend leur donne : la même pièce jointe rejouée ne s''écrit qu''une fois.';
comment on column public.pieces_jointes_ecartees.recue_le is
  'L''instant où receive-email a reçu et écarté la pièce jointe, posé par la base.';
comment on function public.marquer_pieces_jointes_vues(uuid, uuid[]) is
  'Marque vues, pour le cabinet du dossier, les pièces jointes écartées que l''écran a montrées : l''accès d''abord, puis les identifiants, tous de ce dossier ; une ligne déjà vue garde sa première marque.';
comment on function public.garder_piece_jointe_ecartee() is
  'Une pièce jointe écartée ne change pas, sauf sa marque « vue », posée une fois.';
