-- INAL5 : LE DÉPART D'UN CLIENT — LES PAQUETS TÉLÉCHARGÉS, LA CONSERVATION DIX ANS, LA SUPPRESSION GARDÉE (ligne 44)
-- PRÉPARÉE, PAS APPLIQUÉE. À COLLER : « before delete » et « on delete cascade » nomment l'action de suppression ; rien ne
-- se détruit (deux tables, cinq fonctions et six déclencheurs s'ajoutent, aucune ligne ni aucun objet ne se retire).
--
-- La conception : HISTORIQUE.md, « 10/11/2026 — L'INALTÉRABILITÉ ET L'ARCHIVAGE À VALEUR PROBANTE : LA CONCEPTION (LIGNE
-- 44) », « L'archivage des pièces » (le client qui part : l'obligation de conserver est la sienne ; le cabinet lui RESTITUE
-- les paquets, RGPD art. 28.3 g, puis supprime). La réponse du cabinet à INAL-Q6 (11/11/2026, « Avoir le choix ») : au
-- départ d'un client, le cabinet CHOISIT entre (1) remettre les archives, puis supprimer le dossier, et (2) garder le
-- dossier dix ans, à compter du 31 décembre du dernier exercice validé, sans plus y travailler. Le récit : HISTORIQUE.md,
-- « 11/11/2026 — INAL5 ».
--
-- CE QU'ELLE FAIT.
--   1. LES TÉLÉCHARGEMENTS DES PAQUETS (INAL3b, « une table de ses téléchargements ») : `paquets_d_archive_telecharges`,
--      une ligne par paquet d'archive téléchargé (lib/paquetDArchive.ts le fabrique dans le navigateur) : l'exercice,
--      l'empreinte de l'exercice que le paquet a scellée, le SHA-256 de son manifeste, ses comptes, l'instant et l'auteur.
--      Elle ne s'écrit que par `enregistrer_paquet_telecharge`, à qui administre le dossier (le client jamais), qui refuse
--      un exercice non validé, une empreinte qui n'est pas celle de l'exercice validé, et un exercice dont l'empreinte ne
--      se vérifie plus (`verifier_exercice_valide`). La base ne voit pas le fichier : la ligne est l'attestation de
--      l'application du cabinet qu'un paquet de CET exercice scellé a été fabriqué et remis au navigateur. Immuable : ni
--      mise à jour ni suppression (elle part avec son dossier) ; l'insertion directe est au super-administrateur, pour la
--      restauration.
--   2. LA CONSERVATION D'UN DOSSIER : `conservations_des_dossiers`, datée, posée par `conserver_le_dossier` et levée par
--      `lever_la_conservation`, au chef du cabinet seul (le super-administrateur compris). Elle se garde jusqu'au 31
--      décembre de la dixième année qui suit le dernier exercice validé (LPF, art. L102 B : dix ans à compter de la
--      dernière opération des livres), fixé à la pose. Une ligne levée reste : l'historique dit qui a posé, levé, et quand.
--      Elle se refuse : déjà posée ; aucun exercice validé (rien à conserver au titre des livres) ; un accès client encore
--      là (un dossier conservé n'en a aucun : les retirer d'abord, l'onglet Accès).
--   3. CE QU'UN DOSSIER CONSERVÉ INTERDIT, à TOUT auteur (le super-administrateur et la restauration compris : la
--      restauration réécrit la conservation EN DERNIER, après les tables qu'elle garde) : une nouvelle pièce, une nouvelle
--      écriture, un nouvel accès client, la validation d'un exercice (son terme est fixé à la pose) —
--      `garder_dossier_conserve`, avant l'insertion (ou le changement de dossier) d'une ligne de `pieces`,
--      `ecritures_brouillon`, `memberships` et `exercices_valides`. Le reste (modifier ou retirer ce qui n'est pas figé,
--      télécharger les paquets) reste ouvert : les écritures validées et leurs pièces sont déjà figées.
--   4. LA SUPPRESSION D'UN DOSSIER (`garder_depart_du_dossier`, avant la suppression de la ligne de `dossiers`), sauf par
--      le super-administrateur : refusée tant qu'une conservation court (son terme non échu, au jour de Paris) ; puis
--      refusée tant qu'un exercice validé dont la conservation court encore (jusqu'au 31 décembre de sa dixième année
--      suivante) n'a pas de paquet téléchargé À SON EMPREINTE. La suppression d'un dossier conservé dont le terme est échu
--      passe donc (aucun de ses exercices n'est plus à conserver).
--   La ligne du dossier se lit en partage de clé par la garde des insertions, et en mise à jour par la pose : une pièce,
--   une écriture ou un accès posés pendant la pose de la conservation se suivent, et chacun voit ce que l'autre a fait.
--
-- CE QU'ELLE NE FAIT PAS. Elle ne vérifie pas le fichier téléchargé (la base ne le voit pas) ; elle n'horodate rien
-- (INAL7) ; elle ne copie rien hors de Supabase (INAL6) ; elle ne retire aucun accès client d'elle-même ; elle ne
-- supprime rien à l'échéance (un dossier conservé échu se supprime par le chef, comme un autre).
--
-- Son retour : supabase/preparees/retour/20261111191100_retour_depart_du_client.sql. Son essai :
-- supabase/essais/departDuClient.sql (sur une réplique : il supprime des dossiers jetables) ; puis rls.sql (le bloc DP) et
-- frontiereDesEncaissements.sql (S11 supprime un dossier qui porte un exercice validé : il enregistre d'abord son paquet).
--
-- SOURCES. LPF, art. L102 B (version du 01/01/2027, Légifrance) : conservation pendant dix ans « à compter de la date de
-- la dernière opération mentionnée sur les livres ». RGPD (règlement 2016/679), art. 28.3 g : au terme de la prestation, le
-- sous-traitant supprime ou RENVOIE les données, selon le choix du responsable du traitement. PostgreSQL 17, « Explicit
-- Locking » : FOR KEY SHARE n'entre en conflit qu'avec FOR UPDATE (et la suppression) ; une instruction de PL/pgSQL prend
-- un nouvel instantané, et voit ce que la transaction attendue a validé. « CREATE TRIGGER » : un déclencheur de ligne
-- BEFORE DELETE se déclenche aussi pour une suppression en cascade ; un déclencheur qui rend NULL annule la ligne, une
-- exception annule l'instruction.

do $garde$
begin
  if to_regclass('public.dossiers') is null or to_regclass('public.exercices_valides') is null
     or to_regclass('public.memberships') is null or to_regclass('public.pieces') is null
     or to_regclass('public.ecritures_brouillon') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null
     or to_regprocedure('public.est_chef_du_cabinet(uuid)') is null
     or to_regprocedure('public.is_super_admin()') is null
     or to_regprocedure('public.verifier_exercice_valide(uuid,integer)') is null then
    raise exception 'depart_du_client : un objet dont elle dépend manque (dossiers, exercices_valides, memberships, pieces, ecritures_brouillon, admin_du_dossier, est_chef_du_cabinet, is_super_admin, verifier_exercice_valide).';
  end if;
  if to_regclass('public.paquets_d_archive_telecharges') is not null
     or to_regclass('public.conservations_des_dossiers') is not null then
    raise exception 'depart_du_client : déjà appliquée (une de ses tables existe).';
  end if;
end
$garde$;

-- 1. Les téléchargements des paquets d'archive.
create table public.paquets_d_archive_telecharges (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null,
  empreinte_exercice text not null,
  empreinte_du_manifeste text not null,
  nb_fichiers integer not null,
  nb_non_verifiees integer not null,
  telecharge_le timestamptz not null default now(),
  telecharge_par uuid not null,
  constraint paquets_d_archive_telecharges_manifeste check (empreinte_du_manifeste ~ '^[0-9a-f]{64}$'),
  constraint paquets_d_archive_telecharges_comptes check (nb_fichiers >= 1 and nb_non_verifiees >= 0 and nb_non_verifiees < nb_fichiers)
);
create index paquets_d_archive_telecharges_exercice on public.paquets_d_archive_telecharges (dossier_id, annee);
alter table public.paquets_d_archive_telecharges enable row level security;
create policy paquets_d_archive_telecharges_select on public.paquets_d_archive_telecharges
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy paquets_d_archive_telecharges_restauration on public.paquets_d_archive_telecharges
  for insert to authenticated with check (public.is_super_admin());

create function public.enregistrer_paquet_telecharge(
  p_dossier_id uuid, p_annee integer, p_empreinte_exercice text, p_empreinte_du_manifeste text,
  p_nb_fichiers integer, p_nb_non_verifiees integer)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $fonction$
declare
  v_empreinte text;
  v_id uuid;
begin
  if not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select ev.empreinte into v_empreinte from public.exercices_valides ev
   where ev.dossier_id = p_dossier_id and ev.annee = p_annee;
  if not found then
    raise exception 'L’exercice % n’est pas validé : il n’a pas de paquet d’archive.', p_annee using errcode = 'P0002';
  end if;
  if p_empreinte_exercice is distinct from v_empreinte then
    raise exception 'Ce paquet ne porte pas l’empreinte de l’exercice % tel qu’il est validé : il ne s’enregistre pas.', p_annee
      using errcode = '23514';
  end if;
  if p_empreinte_du_manifeste is null or p_empreinte_du_manifeste !~ '^[0-9a-f]{64}$' then
    raise exception 'L’empreinte du manifeste du paquet est illisible.' using errcode = '22023';
  end if;
  if p_nb_fichiers is null or p_nb_non_verifiees is null or p_nb_fichiers < 1 or p_nb_non_verifiees < 0
     or p_nb_non_verifiees >= p_nb_fichiers then
    raise exception 'Les comptes du paquet sont illisibles.' using errcode = '22023';
  end if;
  if not public.verifier_exercice_valide(p_dossier_id, p_annee) then
    raise exception 'L’empreinte de l’exercice % ne correspond plus à ce qui a été validé : à signaler sans attendre.', p_annee
      using errcode = '23514';
  end if;
  insert into public.paquets_d_archive_telecharges
    (dossier_id, annee, empreinte_exercice, empreinte_du_manifeste, nb_fichiers, nb_non_verifiees, telecharge_par)
  values (p_dossier_id, p_annee, v_empreinte, p_empreinte_du_manifeste, p_nb_fichiers, p_nb_non_verifiees, auth.uid())
  returning id into v_id;
  return v_id;
end
$fonction$;
revoke execute on function public.enregistrer_paquet_telecharge(uuid, integer, text, text, integer, integer) from public, anon;
grant execute on function public.enregistrer_paquet_telecharge(uuid, integer, text, text, integer, integer) to authenticated;

-- 2. La conservation d'un dossier.
create table public.conservations_des_dossiers (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  dernier_exercice integer not null,
  jusqu_au date not null,
  posee_le timestamptz not null default now(),
  posee_par uuid not null,
  levee_le timestamptz,
  levee_par uuid,
  constraint conservations_des_dossiers_terme check (jusqu_au = make_date(dernier_exercice + 10, 12, 31)),
  constraint conservations_des_dossiers_levee check ((levee_le is null) = (levee_par is null) and (levee_le is null or levee_le >= posee_le))
);
create unique index conservations_des_dossiers_une_en_cours on public.conservations_des_dossiers (dossier_id) where levee_le is null;
alter table public.conservations_des_dossiers enable row level security;
create policy conservations_des_dossiers_select on public.conservations_des_dossiers
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy conservations_des_dossiers_restauration on public.conservations_des_dossiers
  for insert to authenticated with check (public.is_super_admin());

-- Une conservation ne se réécrit pas : elle se lève, une fois ; une conservation en cours ne cohabite pas avec un accès
-- client (l'insertion de la restauration comprise).
create function public.garder_conservation_du_dossier()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $fonction$
begin
  if tg_op = 'INSERT' then
    if new.levee_le is null and exists (select 1 from public.memberships m where m.dossier_id = new.dossier_id) then
      raise exception 'Ce dossier a un accès client : un dossier conservé n’en a aucun. Les retirer d’abord (onglet Accès).'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if old.levee_le is not null or new.levee_le is null or new.id <> old.id or new.dossier_id <> old.dossier_id
     or new.dernier_exercice <> old.dernier_exercice or new.jusqu_au <> old.jusqu_au or new.posee_le <> old.posee_le
     or new.posee_par <> old.posee_par then
    raise exception 'Une conservation ne se réécrit pas : elle se lève, une seule fois.' using errcode = '23514';
  end if;
  return new;
end
$fonction$;
revoke execute on function public.garder_conservation_du_dossier() from public, anon, authenticated;
create trigger conservations_des_dossiers_gardes
  before insert or update on public.conservations_des_dossiers
  for each row execute function public.garder_conservation_du_dossier();

create function public.conserver_le_dossier(p_dossier_id uuid)
 returns date
 language plpgsql
 security definer
 set search_path to 'public'
as $fonction$
declare
  v_dernier integer;
  v_jusqu date;
  v_acces bigint;
begin
  if not coalesce(public.est_chef_du_cabinet((select d.cabinet_id from public.dossiers d where d.id = p_dossier_id)), false) then
    raise exception 'Seul le chef du cabinet conserve un dossier ou lève sa conservation.' using errcode = '42501';
  end if;
  -- La ligne du dossier en mise à jour : une insertion gardée (pièce, écriture, accès, validation) qui court attend, ou
  -- se fait attendre, et chacune voit ce que l'autre a fait.
  perform 1 from public.dossiers d where d.id = p_dossier_id for update;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = 'P0002';
  end if;
  select c.jusqu_au into v_jusqu from public.conservations_des_dossiers c
   where c.dossier_id = p_dossier_id and c.levee_le is null;
  if found then
    raise exception 'Ce dossier est déjà conservé jusqu’au %.', to_char(v_jusqu, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  select max(ev.annee) into v_dernier from public.exercices_valides ev where ev.dossier_id = p_dossier_id;
  if v_dernier is null then
    raise exception 'Aucun exercice n’est validé : il n’y a pas de livres à conserver dix ans. Valider d’abord le dernier exercice, ou supprimer le dossier.'
      using errcode = '23514';
  end if;
  select count(*) into v_acces from public.memberships m where m.dossier_id = p_dossier_id;
  if v_acces > 0 then
    raise exception 'Ce dossier a encore % accès client : un dossier conservé n’en a aucun. Les retirer d’abord (onglet Accès).', v_acces
      using errcode = '23514';
  end if;
  v_jusqu := make_date(v_dernier + 10, 12, 31);
  insert into public.conservations_des_dossiers (dossier_id, dernier_exercice, jusqu_au, posee_par)
  values (p_dossier_id, v_dernier, v_jusqu, auth.uid());
  return v_jusqu;
end
$fonction$;
revoke execute on function public.conserver_le_dossier(uuid) from public, anon;
grant execute on function public.conserver_le_dossier(uuid) to authenticated;

create function public.lever_la_conservation(p_dossier_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $fonction$
begin
  if not coalesce(public.est_chef_du_cabinet((select d.cabinet_id from public.dossiers d where d.id = p_dossier_id)), false) then
    raise exception 'Seul le chef du cabinet conserve un dossier ou lève sa conservation.' using errcode = '42501';
  end if;
  update public.conservations_des_dossiers c set levee_le = now(), levee_par = auth.uid()
   where c.dossier_id = p_dossier_id and c.levee_le is null;
  if not found then
    raise exception 'Ce dossier n’est pas conservé : rien à lever.' using errcode = 'P0002';
  end if;
end
$fonction$;
revoke execute on function public.lever_la_conservation(uuid) from public, anon;
grant execute on function public.lever_la_conservation(uuid) to authenticated;

-- 3. Ce qu'un dossier conservé interdit : l'argument du déclencheur dit quoi.
create function public.garder_dossier_conserve()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $fonction$
declare
  v_jusqu date;
begin
  -- La ligne du dossier en partage de clé : une pose de conservation en cours se fait attendre, puis se voit.
  perform 1 from public.dossiers d where d.id = new.dossier_id for key share;
  select c.jusqu_au into v_jusqu from public.conservations_des_dossiers c
   where c.dossier_id = new.dossier_id and c.levee_le is null;
  if found then
    raise exception 'Ce dossier est conservé jusqu’au % : %. La conservation se lève dans l’onglet Informations.',
      to_char(v_jusqu, 'DD/MM/YYYY'), tg_argv[0] using errcode = '23514';
  end if;
  return new;
end
$fonction$;
revoke execute on function public.garder_dossier_conserve() from public, anon, authenticated;
create trigger pieces_dossier_conserve
  before insert or update of dossier_id on public.pieces
  for each row execute function public.garder_dossier_conserve('aucune pièce ne s’y dépose plus');
create trigger ecritures_brouillon_dossier_conserve
  before insert or update of dossier_id on public.ecritures_brouillon
  for each row execute function public.garder_dossier_conserve('aucune écriture ne s’y passe plus');
create trigger memberships_dossier_conserve
  before insert or update of dossier_id on public.memberships
  for each row execute function public.garder_dossier_conserve('aucun accès client ne s’y pose plus');
create trigger exercices_valides_dossier_conserve
  before insert on public.exercices_valides
  for each row execute function public.garder_dossier_conserve('aucun exercice ne s’y valide plus');

-- 4. La suppression d'un dossier : la conservation qui court, puis les paquets, sauf par le super-administrateur.
create function public.garder_depart_du_dossier()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $fonction$
declare
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_jusqu date;
  v_manquants text;
begin
  if public.is_super_admin() then
    return old;
  end if;
  select c.jusqu_au into v_jusqu from public.conservations_des_dossiers c
   where c.dossier_id = old.id and c.levee_le is null;
  if found and v_jusqu >= v_jour then
    raise exception 'Ce dossier est conservé jusqu’au % : il ne se supprime pas avant. Seul le super-administrateur le retire plus tôt.',
      to_char(v_jusqu, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  select string_agg(ev.annee::text, ', ' order by ev.annee) into v_manquants
    from public.exercices_valides ev
   where ev.dossier_id = old.id and make_date(ev.annee + 10, 12, 31) >= v_jour
     and not exists (select 1 from public.paquets_d_archive_telecharges p
                      where p.dossier_id = ev.dossier_id and p.annee = ev.annee and p.empreinte_exercice = ev.empreinte);
  if v_manquants is not null then
    raise exception 'Le paquet d’archive n’a pas été téléchargé pour l’exercice validé %. Un dossier qui porte un exercice validé ne se supprime qu’après la remise de chaque paquet au client (onglet Écritures, « Paquet d’archive »), ou se conserve dix ans.',
      v_manquants using errcode = '23514';
  end if;
  return old;
end
$fonction$;
revoke execute on function public.garder_depart_du_dossier() from public, anon, authenticated;
create trigger dossiers_depart_du_client
  before delete on public.dossiers
  for each row execute function public.garder_depart_du_dossier();

-- 5. La porte d'accès devant les gardes (acces_avant_les_gardes, ligne 43), si elle est déjà en base.
-- Les gardes `security definer` de cette migration : `garder_conservation_du_dossier` sur `conservations_des_dossiers`, et
-- `garder_dossier_conserve` sur `memberships` et `exercices_valides` (sur `pieces` et `ecritures_brouillon`, la porte y est).
-- Une garde `security definer` tire avant l'expression WITH CHECK de la policy : sans la porte, elle répondrait à un
-- appelant que la policy refuse. Si la porte est en base, elle se pose ici, la première des déclencheurs BEFORE de la
-- table ; sinon, la porte la posera d'elle-même en s'appliquant (elle couvre toute table de cette liste qui porte déjà sa
-- garde). Les deux migrations se collent ainsi dans les deux ordres. L'essai : supabase/essais/accesAvantLesGardes.sql
-- (étape 32).
do $porte$
declare
  v_table text;
begin
  if to_regprocedure('public.acces_avant_les_gardes()') is not null then
    foreach v_table in array array['conservations_des_dossiers', 'memberships', 'exercices_valides'] loop
      if exists (select 1 from pg_catalog.pg_class c where c.oid = ('public.' || v_table)::regclass and not (c.relrowsecurity and not c.relforcerowsecurity))
         or exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = ('public.' || v_table)::regclass and not t.tgisinternal
                     and (t.tgname collate "C") < ('_acces_avant_les_gardes' collate "C")) then
        raise exception 'La porte d''accès ne se pose pas sur public.% : sa RLS n''est pas active (ou forcée), ou un déclencheur tirerait avant elle.', v_table;
      end if;
      if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = ('public.' || v_table)::regclass and t.tgname = '_acces_avant_les_gardes') then
        execute format('create trigger _acces_avant_les_gardes before insert or update on public.%I for each row execute function public.acces_avant_les_gardes()', v_table);
      end if;
    end loop;
  end if;
end
$porte$;
