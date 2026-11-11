-- P1T-E2 — L'ADRESSE D'UN ACCÈS RETIRÉ, GARDÉE AVEC LA TRACE DES DROITS (espace client, ligne 51.5 ; décision du cabinet du
-- 11/11/2026, contre la recommandation : « Garder l'adresse dans l'historique »). PRÉPARÉE, PAS APPLIQUÉE. Le récit :
-- HISTORIQUE.md, « 11/11/2026 — P1T-E2 : L'ADRESSE D'UN ACCÈS RETIRÉ, GARDÉE AVEC LA TRACE (PRÉPARÉE, PAS APPLIQUÉE) » ;
-- l'essai : supabase/essais/adresseDesAccesRetires.sql et, sur une réplique seulement,
-- supabase/essais/adresseDesAccesRetiresSuppression.sql ; le bloc AR de supabase/essais/rls.sql ; le retour :
-- supabase/preparees/retour/20261111173100_retour_adresse_des_acces_retires.sql.
--
-- LE BESOIN. La trace des droits (P1-trace, `trace_des_droits`, en production depuis le 07/11/2026) garde l'accès et son
-- compte par leurs identifiants, jamais une adresse : un accès retiré ne se nomme plus, et l'onglet Accès dit « Accès retiré
-- depuis (tracé dès le …) ». Le cabinet veut savoir QUI c'était, et garde l'adresse en connaissant le prix : une donnée
-- personnelle de plus à conserver (RGPD.md, le registre des traitements).
--
-- LE CHOIX, LE PLUS SOBRE : l'adresse que l'accès porte AU MOMENT OÙ IL PART (`memberships.email`, que la création d'un accès
-- pose), une ligne par départ, et seulement pour un accès que la trace nomme dans ce dossier — l'onglet ne montre que
-- ceux-là ; un accès jamais tracé part sans rien laisser, un accès sans adresse aussi. Tant qu'un accès vit, la liste des
-- accès dit déjà son adresse. Écartés :
--   - l'adresse à chaque changement tracé : une copie par case, jusqu'à sept par geste, d'une adresse que la liste des accès
--     dit déjà tant que l'accès vit ;
--   - une colonne de `trace_des_droits` : il faudrait remplacer `tracer_les_droits`, que `trois_cases_de_l_acces` (B1,
--     préparée) remplace aussi à l'empreinte de son corps ; l'adresse s'y répéterait sur chaque case du retrait, et un accès
--     parti sans case cochée n'y laisserait rien ;
--   - la lecture de `auth.users` à l'affichage : l'adresse d'aujourd'hui, pas celle du départ, perdue avec le compte, et une
--     porte de plus sur la table des comptes.
--
-- CE QU'ELLE POSE :
--   1. `adresses_des_acces_retires` : le dossier (la cascade), l'accès (`memberships.id`, SANS clé : il n'existe plus),
--      l'adresse et l'instant du départ. Ni le compte ni l'auteur : la trace les porte déjà.
--   2. `retenir_l_adresse_d_un_acces_retire`, le déclencheur APRÈS le retrait d'un accès, ou son départ vers un autre
--      dossier ou sous un autre identifiant (la trace l'écrit alors en « retrait ») ; son nom le range APRÈS celui de la
--      trace (`memberships_trace_des_droits`, l'ordre des noms) : la trace du départ est déjà écrite quand il la cherche. Il
--      écrit l'adresse quand le dossier est encore là (la suppression d'un dossier emporte tout, rien ne se retient), que
--      l'accès en portait une et que la trace le nomme dans ce dossier. Un accès qui reste — son compte, son adresse ou une
--      case changés — n'écrit rien.
--   3. `garder_adresses_des_acces_retires`, AVANT toute écriture de la table : elle ne s'écrit que par le déclencheur, pour
--      l'accès qu'il retient (le réglage `jd.adresse_d_un_acces_retire`), ou par la restauration du super-administrateur
--      (42501) ; elle ne se réécrit jamais et ne part qu'avec son dossier (23514) — pour tout auteur, le propriétaire et le
--      rôle des Edge Functions compris.
--   4. La RLS : la lecture du cabinet du dossier (`admin_du_dossier`, `to authenticated`), l'insertion du super-administrateur
--      (la restauration). Aucune autre policy : le client n'en lit rien, pas même de son dossier ni de son propre accès.
--
-- LA DURÉE : celle de la trace, celle du dossier — la ligne part avec lui (la cascade), et rien d'autre ne la retire.
--
-- CE QU'ELLE NE CHANGE PAS : `memberships`, ses policies, ses gardes, `changer_droits_acces`, `trace_des_droits` et ses deux
-- fonctions — aucune fonction n'est remplacée. Aucune ligne écrite d'avance : relevé en production le 11/11/2026, la trace
-- est vide, aucun accès n'en est parti.
--
-- L'ORDRE D'APPLICATION : après `trace_des_droits` (sa garde de tête l'exige) ; aucun avec les migrations préparées.
-- `trois_cases_de_l_acces` (B1) remplace `tracer_les_droits` et le déclencheur de la trace, jamais celui-ci ; la double
-- authentification exigée (20261107160000_deux_facteurs_exiges) pose sa policy restrictive sur toute table de public :
-- appliquée AVANT celle-ci, cette migration la pose elle-même sur sa table (le bloc 5) ; APRÈS, sa boucle la prend.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni droit d'un
-- objet qui reste ; ses `revoke` ne retirent que les droits que Postgres donne d'office aux deux fonctions qu'elle crée. Le
-- mot n'y paraît que dans la clé (`on delete cascade`), les événements des deux déclencheurs et `tg_op = 'DELETE'`, comme
-- dans `trace_des_droits`, passée par l'outil. Ni barre oblique inverse, ni retour chariot. Elle s'applique PAR L'OUTIL.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la version
-- que porte sa ligne d'historique, texte inchangé ; `ADRESSES_DES_ACCES_RETIRES_PREVUES` (src/lib/adressesDesAccesRetires.ts)
-- se lève alors : la table entre au plan de sauvegarde, et l'onglet Accès nomme un accès retiré par son adresse.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une base sans la trace des droits (P1-trace), sans son déclencheur ou sans l'adresse
-- des accès ; une fonction appelée qui ne serait plus celle que cette migration suppose — à l'empreinte de son corps, les
-- retours chariot d'un collage écartés.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.adresses_des_acces_retires') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('retenir_l_adresse_d_un_acces_retire', 'garder_adresses_des_acces_retires'))
     or exists (select 1 from pg_trigger t where not t.tgisinternal
                 and t.tgname in ('memberships_trace_des_droits_adresse', 'adresses_des_acces_retires_garde')) then
    raise exception 'La migration adresse_des_acces_retires est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.trace_des_droits') is null
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.memberships'::regclass and not t.tgisinternal
                     and t.tgname = 'memberships_trace_des_droits') then
    raise exception 'La trace des droits (migration trace_des_droits) et son déclencheur memberships_trace_des_droits manquent : appliquer d''abord trace_des_droits.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where a.attrelid = 'public.memberships'::regclass and not a.attisdropped
     and a.attname in ('id', 'dossier_id', 'email');
  if v_nombre <> 3 then
    raise exception 'Une colonne que cette migration lit manque à memberships (% sur 3 : id, dossier_id, email).', v_nombre;
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p
     where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.nom, left(v_attendue.empreinte, 8);
    end if;
  end loop;
end
$garde$;

-- ══ 1. La table ══════════
create table public.adresses_des_acces_retires (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  acces_id uuid not null,
  -- L'adresse telle que l'accès la portait : ni forme ni longueur jugées (un départ ne se refuse jamais pour elle) ; le
  -- déclencheur n'écrit pas une adresse vide, que cette contrainte refuserait.
  adresse text not null
    constraint adresses_des_acces_retires_adresse check (btrim(adresse) <> ''),
  retire_le timestamptz not null default now()
);

create index adresses_des_acces_retires_dossier on public.adresses_des_acces_retires (dossier_id, acces_id);

comment on table public.adresses_des_acces_retires is
  'L''adresse d''un accès client au moment où il part d''un dossier (décision du cabinet P1T-E2), pour nommer un accès retiré dans la trace des droits : une ligne par départ d''un accès que la trace nomme dans ce dossier. Écrite par le déclencheur retenir_l_adresse_d_un_acces_retire seul, réinsérée par la restauration du super-administrateur ; ne se modifie ni ne se supprime hors de la cascade de son dossier. Lue par le cabinet du dossier ; le client n''en voit rien.';
comment on column public.adresses_des_acces_retires.acces_id is
  'L''accès (memberships.id) parti du dossier ; sans clé étrangère : il n''existe plus.';
comment on column public.adresses_des_acces_retires.adresse is
  'L''adresse que l''accès portait (memberships.email) au moment de son départ.';
comment on column public.adresses_des_acces_retires.retire_le is
  'L''instant du départ : le retrait de l''accès, ou son départ vers un autre dossier.';

-- ══ 2. La garde de la table ══════════
-- Aux droits de l'appelant (le patron de la trace des droits) : le déclencheur écrit en propriétaire, sous son réglage ; le
-- super-administrateur restaure. Une ligne ne part qu'avec son dossier : la cascade la retire après lui.
create function public.garder_adresses_des_acces_retires() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'L''adresse d''un accès retiré ne se réécrit pas : elle ne part qu''avec son dossier.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'L''adresse d''un accès retiré ne se réécrit pas : elle ne part qu''avec son dossier.' using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.adresse_d_un_acces_retire', true), '') is distinct from new.acces_id::text
     and not public.is_super_admin() then
    raise exception 'L''adresse d''un accès retiré ne s''écrit que par le retrait de l''accès.' using errcode = '42501';
  end if;
  return new;
end
$$;

comment on function public.garder_adresses_des_acces_retires() is
  'Garde de l''adresse d''un accès retiré (P1T-E2) : écrite par le déclencheur retenir_l_adresse_d_un_acces_retire, sous le réglage de l''accès qu''il retient, ou par la restauration du super-administrateur (42501 sinon) ; ne se réécrit pas, ne part qu''avec son dossier (23514). Pour tout auteur ; aucun rôle de l''API ne l''exécute.';

create trigger adresses_des_acces_retires_garde
  before insert or update or delete on public.adresses_des_acces_retires
  for each row execute function public.garder_adresses_des_acces_retires();

-- ══ 3. Le déclencheur des accès ══════════
-- APRÈS l'écriture, aux droits du propriétaire, et APRÈS celui de la trace (l'ordre des noms) : les policies et les gardes de
-- `memberships` ont jugé le geste, et la trace du départ est écrite. Le réglage dit à la garde que la ligne vient d'ici, pour
-- CET accès ; il est remis à vide avant de rendre la main.
create function public.retenir_l_adresse_d_un_acces_retire() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Le retrait d'un accès par la suppression de son dossier : le dossier n'est déjà plus là, la trace part avec lui.
  if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return null;
  end if;
  -- Un accès qui reste dans ce dossier sous le même identifiant ne part pas.
  if tg_op = 'UPDATE' and new.id = old.id and new.dossier_id = old.dossier_id then
    return null;
  end if;
  -- Sans adresse, rien à retenir ; un accès que la trace ne nomme pas dans ce dossier, l'onglet ne le montre jamais.
  if old.email is null or btrim(old.email) = ''
     or not exists (select 1 from public.trace_des_droits t where t.dossier_id = old.dossier_id and t.acces_id = old.id) then
    return null;
  end if;
  perform set_config('jd.adresse_d_un_acces_retire', old.id::text, true);
  insert into public.adresses_des_acces_retires (dossier_id, acces_id, adresse)
  values (old.dossier_id, old.id, old.email);
  perform set_config('jd.adresse_d_un_acces_retire', '', true);
  return null;
end
$$;

comment on function public.retenir_l_adresse_d_un_acces_retire() is
  'Retient l''adresse d''un accès client qui part d''un dossier (P1T-E2) : retiré, ou emporté vers un autre dossier ou sous un autre identifiant, quand le dossier est encore là, que l''accès portait une adresse et que la trace des droits le nomme dans ce dossier. Après le déclencheur de la trace, aux droits du propriétaire ; aucun rôle de l''API ne l''exécute.';

create trigger memberships_trace_des_droits_adresse
  after update of dossier_id, id or delete on public.memberships
  for each row execute function public.retenir_l_adresse_d_un_acces_retire();

-- ══ 4. La RLS ══════════
-- Le cabinet du dossier lit ; le super-administrateur restaure. Aucune autre policy : ni le client, ni une écriture du
-- cabinet, ni une mise à jour, ni un retrait.
alter table public.adresses_des_acces_retires enable row level security;

create policy adresses_des_acces_retires_lecture on public.adresses_des_acces_retires
  for select to authenticated using (public.admin_du_dossier(dossier_id));

create policy adresses_des_acces_retires_restauration on public.adresses_des_acces_retires
  for insert to authenticated with check (public.is_super_admin());

-- ══ 5. La double authentification exigée (préparée, 20261107160000) ══════════
-- Appliquée avant celle-ci, sa policy restrictive se pose ici sur la table neuve ; appliquée après, sa boucle sur pg_class
-- la prend d'elle-même.
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    create policy deux_facteurs on public.adresses_des_acces_retires as restrictive for all to authenticated
      using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()));
  end if;
end
$deux_facteurs$;

-- ══ 6. Les droits d'exécution ══════════
-- Les deux fonctions ne s'exécutent que par leurs déclencheurs : aucun rôle de l'API.
revoke execute on function public.garder_adresses_des_acces_retires() from public, anon, authenticated;
revoke execute on function public.retenir_l_adresse_d_un_acces_retire() from public, anon, authenticated;
