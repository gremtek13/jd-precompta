-- LA TRACE DES DROITS D'UN ACCÈS CLIENT (espace client, étape P1-trace ; décision du cabinet du 18/10/2026 : « oui », garder
-- qui a coché ou décoché les droits d'un accès, et quand). Le récit : HISTORIQUE.md, « 05/11/2026 — LA TRACE DES DROITS D'UN
-- ACCÈS, EN BASE (P1-TRACE) (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai : supabase/essais/traceDesDroits.sql, et, sur une réplique
-- seulement, supabase/essais/traceDesDroitsSuppression.sql ; le bloc TD de supabase/essais/rls.sql.
--
-- CE QU'ELLE POSE :
--   1. `trace_des_droits`, une ligne par case qui change : le dossier, l'accès (`memberships.id`) et son compte, le droit
--      (« ventes », « banque », « caisse »), la case après le geste (`coche`), le geste — « changement » (une case cochée
--      ou décochée sur un accès qui reste), « creation » (un accès qui arrive dans le dossier en portant la case),
--      « retrait » (un accès qui en part en la portant) —, l'auteur (`auth.uid()`, nul sans session : une Edge Function
--      sous la clé secrète, l'éditeur SQL) et l'instant. Ni l'accès ni les comptes n'ont de clé étrangère : la trace
--      survit au retrait de l'accès qu'elle raconte ; elle ne part qu'avec son dossier (la cascade).
--   2. `tracer_les_droits`, le déclencheur APRÈS l'insertion, la mise à jour des trois cases, du dossier, du compte ou de
--      l'identifiant, et la suppression d'un accès — tout chemin est pris : `changer_droits_acces` (l'onglet Accès),
--      l'insertion du cabinet qui porte une case, le retrait de l'accès (l'onglet Accès, ou la cascade d'un compte), le
--      propriétaire et le rôle des Edge Functions. Une case qui ne change pas n'écrit rien ; un accès emporté vers un autre
--      dossier (ou un autre compte) part de l'un en « retrait » et arrive dans l'autre en « creation ». Deux portes
--      n'écrivent RIEN : l'insertion du super-administrateur (la restauration réinsère l'accès tel qu'il a été, puis la
--      trace elle-même — la tracer fabriquerait une case cochée à l'instant de la restauration), et le retrait d'un accès
--      par la suppression de son dossier (la trace part avec lui).
--   3. `garder_trace_des_droits`, AVANT toute écriture de la trace : elle ne s'écrit que par le déclencheur, pour l'accès
--      qu'il trace (le réglage `jd.trace_des_droits`), ou par la restauration du super-administrateur (42501) ; elle ne se
--      réécrit jamais, et ne part qu'avec son dossier (23514) — pour tout auteur, le propriétaire et le rôle des Edge
--      Functions compris.
--   4. La RLS : la lecture du cabinet du dossier (`admin_du_dossier`, `to authenticated`) ; l'insertion du super-
--      administrateur (la restauration). Aucune autre policy : le client n'en lit rien, pas même de son dossier ; personne
--      ne l'écrit en direct, ne la modifie ni ne la retire.
--
-- CE QU'ELLE NE CHANGE PAS : `memberships`, ses policies, ses deux gardes (`garder_droit_ventes`, `garder_droit_caisse`) et
-- `changer_droits_acces` — aucune fonction n'est remplacée. Le déclencheur vient APRÈS les deux gardes (l'ordre des noms) :
-- une case refusée n'écrit rien, l'écriture entière se refusant. Aucune ligne écrite d'avance : les cases d'avant la
-- migration ne s'attribuent à personne (relevé en production le 05/11/2026 : trois accès, des données fictives).
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni droit d'un
-- objet qui reste ; ses `revoke` ne retirent que les droits que Postgres donne d'office aux deux fonctions qu'elle crée. Le
-- mot n'y paraît que dans la clé (`on delete cascade`), les événements des déclencheurs et `tg_op = 'DELETE'`, que les
-- migrations d'hier ont passés sans confirmation. Ni barre oblique inverse, ni retour chariot. Elle s'applique PAR L'OUTIL.
-- Son retour arrière, donné à part (`supabase/preparees/retour/`), retire la table et ce qu'elle porte : destructif, il se
-- refuse tant que la trace porte une ligne, à accorder, et à coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `TRACE_DES_DROITS_PREVUE` (src/lib/traceDesDroits.ts) se lève
-- alors, et la table entre au plan de sauvegarde. L'écran qui la montre viendra dans un lot à part.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une fonction appelée qui ne serait plus celle que cette migration suppose — à
-- l'empreinte de son corps, les retours chariot d'un collage écartés ; et une base où manquerait une colonne qu'elle lit.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.trace_des_droits') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('tracer_les_droits', 'garder_trace_des_droits'))
     or exists (select 1 from pg_trigger t where not t.tgisinternal
                 and t.tgname in ('memberships_trace_des_droits', 'trace_des_droits_garde')) then
    raise exception 'La migration trace_des_droits est déjà en base : elle ne s''applique pas deux fois.';
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
  select count(*) into v_nombre from pg_attribute a
   where a.attrelid = 'public.memberships'::regclass and not a.attisdropped
     and a.attname in ('id', 'user_id', 'dossier_id', 'droit_ventes', 'droit_banque', 'droit_caisse');
  if v_nombre <> 6 then
    raise exception 'Une colonne que cette migration lit manque à memberships (% sur 6) : appliquer d''abord caisse_du_client.', v_nombre;
  end if;
end
$garde$;

-- ══ 1. La table ══════════
create table public.trace_des_droits (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  acces_id uuid not null,
  client_id uuid not null,
  droit text not null
    constraint trace_des_droits_droit check (droit in ('ventes', 'banque', 'caisse')),
  coche boolean not null,
  geste text not null
    constraint trace_des_droits_geste check (geste in ('changement', 'creation', 'retrait')),
  auteur_id uuid,
  fait_le timestamptz not null default now(),
  -- Un accès arrive en portant la case, et part en la portant : la case d'une création est cochée, celle d'un retrait non.
  constraint trace_des_droits_coche check ((geste <> 'creation' or coche) and (geste <> 'retrait' or not coche))
);

create index trace_des_droits_dossier on public.trace_des_droits (dossier_id, fait_le);
create index trace_des_droits_acces on public.trace_des_droits (acces_id);

comment on table public.trace_des_droits is
  'La trace des droits « Ventes », « Banque » et « Caisse » des accès client d''un dossier : qui a coché ou décoché quelle case, et quand (étape P1-trace). Écrite par le déclencheur tracer_les_droits seul, réinsérée par la restauration du super-administrateur ; ne se modifie ni ne se supprime hors de la cascade de son dossier. Lue par le cabinet du dossier ; le client n''en voit rien.';
comment on column public.trace_des_droits.acces_id is
  'L''accès (memberships.id) dont une case a changé ; sans clé étrangère : la trace survit au retrait de l''accès.';
comment on column public.trace_des_droits.client_id is
  'Le compte de l''accès (memberships.user_id) au moment du geste ; sans clé étrangère.';
comment on column public.trace_des_droits.coche is
  'La case après le geste : vrai, cochée ; faux, décochée.';
comment on column public.trace_des_droits.geste is
  '« changement » : une case cochée ou décochée sur un accès qui reste ; « creation » : un accès qui arrive dans le dossier en portant la case ; « retrait » : un accès qui en part en la portant.';
comment on column public.trace_des_droits.auteur_id is
  'Le compte connecté qui a fait le geste (auth.uid()) ; nul sans session (une Edge Function sous la clé secrète, l''éditeur SQL).';

-- ══ 2. La garde de la trace ══════════
-- Aux droits de l'appelant (le patron du journal des désignations) : le déclencheur écrit en propriétaire, sous son réglage ;
-- le super-administrateur restaure. Une ligne ne part qu'avec son dossier : la cascade la retire après lui.
create function public.garder_trace_des_droits() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'La trace des droits ne se réécrit pas : une ligne ne part qu''avec son dossier.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'La trace des droits ne se réécrit pas : une ligne ne part qu''avec son dossier.' using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.trace_des_droits', true), '') is distinct from new.acces_id::text
     and not public.is_super_admin() then
    raise exception 'La trace des droits ne s''écrit que par l''écriture des droits d''un accès.' using errcode = '42501';
  end if;
  return new;
end
$$;

comment on function public.garder_trace_des_droits() is
  'Garde de la trace des droits (étape P1-trace) : écrite par le déclencheur tracer_les_droits, sous le réglage de l''accès qu''il trace, ou par la restauration du super-administrateur (42501 sinon) ; ne se réécrit pas, ne part qu''avec son dossier (23514). Pour tout auteur ; aucun rôle de l''API ne l''exécute.';

create trigger trace_des_droits_garde
  before insert or update or delete on public.trace_des_droits
  for each row execute function public.garder_trace_des_droits();

-- ══ 3. Le déclencheur des accès ══════════
-- APRÈS l'écriture, aux droits du propriétaire : les policies et les deux gardes de `memberships` ont déjà jugé l'auteur et
-- la case ; une écriture refusée n'arrive jamais ici. Le réglage `jd.trace_des_droits` dit à la garde de la trace que la
-- ligne vient d'ici, pour CET accès ; il est remis à vide avant de rendre la main.
create function public.tracer_les_droits() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auteur uuid := auth.uid();
  v_droits constant text[] := array['ventes', 'banque', 'caisse'];
  v_avant boolean[];
  v_apres boolean[];
  i integer;
begin
  -- La restauration : le super-administrateur réinsère un accès tel qu'il a été, puis sa trace. Sa mise à jour et son
  -- retrait d'un accès, si.
  if tg_op = 'INSERT' and public.is_super_admin() then
    return null;
  end if;
  -- Le retrait d'un accès par la suppression de son dossier : le dossier n'est déjà plus là, sa trace part avec lui.
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return null;
  end if;
  if tg_op <> 'INSERT' then
    v_avant := array[old.droit_ventes, old.droit_banque, old.droit_caisse];
  end if;
  if tg_op <> 'DELETE' then
    v_apres := array[new.droit_ventes, new.droit_banque, new.droit_caisse];
  end if;
  if tg_op = 'UPDATE' and new.id = old.id and new.dossier_id = old.dossier_id and new.user_id = old.user_id then
    -- Le même accès : une ligne par case qui change.
    perform set_config('jd.trace_des_droits', new.id::text, true);
    for i in 1 .. 3 loop
      if v_avant[i] is distinct from v_apres[i] then
        insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
        values (new.dossier_id, new.id, new.user_id, v_droits[i], v_apres[i], 'changement', v_auteur);
      end if;
    end loop;
  else
    -- Un accès qui part (retiré, ou emporté vers un autre dossier ou un autre compte) : ses cases cochées, en « retrait ».
    if tg_op <> 'INSERT' then
      perform set_config('jd.trace_des_droits', old.id::text, true);
      for i in 1 .. 3 loop
        if v_avant[i] then
          insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
          values (old.dossier_id, old.id, old.user_id, v_droits[i], false, 'retrait', v_auteur);
        end if;
      end loop;
    end if;
    -- Un accès qui arrive (inséré, ou emporté depuis un autre dossier ou un autre compte) : ses cases cochées, en « creation ».
    if tg_op <> 'DELETE' then
      perform set_config('jd.trace_des_droits', new.id::text, true);
      for i in 1 .. 3 loop
        if v_apres[i] then
          insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
          values (new.dossier_id, new.id, new.user_id, v_droits[i], true, 'creation', v_auteur);
        end if;
      end loop;
    end if;
  end if;
  perform set_config('jd.trace_des_droits', '', true);
  return null;
end
$$;

comment on function public.tracer_les_droits() is
  'Écrit la trace des droits d''un accès client (étape P1-trace) : une ligne par case qui change, avec l''auteur (auth.uid(), nul sans session) et l''instant ; un accès qui arrive ou qui part, ses cases cochées. Ni l''insertion du super-administrateur (la restauration), ni le retrait d''un accès par la suppression de son dossier. Après les gardes de memberships, aux droits du propriétaire ; aucun rôle de l''API ne l''exécute.';

create trigger memberships_trace_des_droits
  after insert or update of droit_ventes, droit_banque, droit_caisse, dossier_id, user_id, id or delete on public.memberships
  for each row execute function public.tracer_les_droits();

-- ══ 4. La RLS ══════════
-- Le cabinet du dossier lit ; le super-administrateur restaure. Aucune autre policy : ni le client, ni une écriture du
-- cabinet, ni une mise à jour, ni un retrait.
alter table public.trace_des_droits enable row level security;

create policy trace_des_droits_lecture on public.trace_des_droits
  for select to authenticated using (public.admin_du_dossier(dossier_id));

create policy trace_des_droits_restauration on public.trace_des_droits
  for insert to authenticated with check (public.is_super_admin());

-- ══ 5. Les droits d'exécution ══════════
-- Les deux fonctions ne s'exécutent que par leurs déclencheurs : aucun rôle de l'API.
revoke execute on function public.garder_trace_des_droits() from public, anon, authenticated;
revoke execute on function public.tracer_les_droits() from public, anon, authenticated;
