-- PLUSIEURS COMPTES BANCAIRES D'UN DOSSIER, LA BASE (ligne 26.6, lot MCB1 ; MCB-Q1 à Q8, tranchées par le cabinet le
-- 11/11/2026). PRÉPARÉE le 11/11/2026, pas appliquée. Le récit : HISTORIQUE.md, « 09/11/2026 — PLUSIEURS COMPTES BANCAIRES
-- D'UN DOSSIER : LA CONCEPTION » et « 11/11/2026 — PLUSIEURS COMPTES BANCAIRES D'UN DOSSIER : D'EMBLÉE, LES LOTS, ET LA
-- BASE (MCB1) ». Son essai : supabase/essais/comptesBancaires.sql ; son retour (DESTRUCTIF) :
-- supabase/preparees/retour/20261111150100_retour_comptes_bancaires.sql ; son module : src/lib/comptesBancaires.ts.
--
-- Aujourd'hui tout le relevé d'un dossier est UN compte, au 512 du rôle `banque`. Ce que la migration pose :
--   1. `comptes_bancaires` : les comptes bancaires professionnels d'un dossier (un livret d'épargne reste hors de
--      l'application, MCB-Q2). Le PRINCIPAL suit le compte du rôle `banque` du plan du dossier (il ne porte ni compte ni
--      date à lui : régler le plan le déplace) ; un autre compte tient SON compte 512, en six chiffres, qui n'est à aucun
--      rôle du plan ni à aucun autre compte du dossier (MCB-Q1, un 512 par compte d'emblée), DEPUIS le 1er janvier d'un
--      exercice : avant cette date ses mouvements s'écrivent au 512 du principal (MCB-Q7 : 2025 se valide à un seul 512,
--      2026 s'ouvre avec un solde par compte). Le compte et la date se figent au premier mouvement ou relevé ; le libellé,
--      texte libre que le client « Banque » lit (MCB-Q8), reste modifiable ; l'ouverture et la clôture bornent les dates des
--      mouvements. Le premier compte d'un dossier est son principal, et un dossier qui tient un compte tient son principal
--      (une contrainte différée, que la restauration d'une sauvegarde rencontre à la fin de son lot).
--   2. `compte_bancaire_id`, NOT NULL, sur `lignes_bancaires` et `controles_releves_bancaires`, une clé vers le compte, que
--      la garde tient dans le dossier du mouvement ; remplie ici du principal de chaque dossier qui porte un relevé. Un
--      mouvement ou un relevé qui arrive SANS compte (l'import d'aujourd'hui, la connexion bancaire, la restauration d'une
--      sauvegarde des formats 1 et 2, les essais) reçoit celui du dossier quand il n'en a qu'un — le principal, créé à son
--      premier mouvement s'il n'en a aucun — et se refuse dès deux : un dossier à un seul compte ne voit rien changer. Un
--      mouvement ne change pas de compte ; un mouvement et le contrôle de son fichier sont du même compte (le nom d'un
--      fichier de relevé reste unique dans le dossier, MCB-Q6 : `controles_releves_bancaires_fichier_unique` demeure).
--   3. Le plan : un rôle du plan ne prend pas le compte d'un compte bancaire du dossier (un déclencheur de plus sur
--      `plan_comptable_dossier`, que `regler_plan_du_dossier` rencontre).
--   4. `compte_de_banque_du_mouvement` : le compte 512 où s'écrit la jambe de banque d'un mouvement — la règle que les
--      lots suivants (les fonctions du relevé, le FEC) liront ; `src/lib/comptesBancaires.ts` la redit.
-- Le dédoublonnage : la base n'en tient qu'un, celui de la connexion bancaire (`lignes_bancaires_id_externe_unique`, par
-- dossier, plus strict que par compte, gardé tant que la connexion reste une par dossier) ; celui de l'import par fichier
-- (date, libellé, montant, par multiplicité) est à l'application, par compte au lot de l'import.
-- Rien n'est retiré, aucune policy n'est élargie : la table naît avec sa policy du cabinet (`admin_du_dossier`) et la
-- lecture du client « Banque » (MCB-Q8), toutes deux `to authenticated` ; les quatre déclencheurs et la lecture sont aux
-- droits de l'appelant (aucune fonction `security definer`). Le remplissage passe les mouvements d'un exercice validé : le
-- déclencheur du gel est suspendu le temps d'une seule instruction, qui ne pose que le compte principal du dossier.

-- ══ 0. La garde de tête ══
do $garde$
begin
  if to_regclass('public.comptes_bancaires') is not null
     or exists (select 1 from information_schema.columns
                 where table_schema = 'public' and column_name = 'compte_bancaire_id') then
    raise exception 'La migration comptes_bancaires est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.lignes_bancaires'::regclass
                    and tgname = 'lignes_bancaires_figees_par_la_validation' and tgenabled = 'O') then
    raise exception 'Le déclencheur du gel des mouvements n''est plus celui que cette migration suspend : la relire avant de l''appliquer.';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.controles_releves_bancaires'::regclass
                    and conname = 'controles_releves_bancaires_fichier_unique'
                    and pg_get_constraintdef(oid) = 'UNIQUE (dossier_id, source_fichier)') then
    raise exception 'Le nom d''un fichier de relevé n''est plus unique dans son dossier comme cette migration le suppose : la relire avant de l''appliquer.';
  end if;
end
$garde$;

-- ══ 1. Les comptes bancaires d'un dossier ══
create table public.comptes_bancaires (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  libelle text not null
    constraint comptes_bancaires_libelle check (btrim(libelle, E' \t\n\r') <> '' and length(libelle) <= 80),
  principal boolean not null default false,
  compte text,
  compte_propre_depuis date,
  ouvert_le date,
  clos_le date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint comptes_bancaires_compte_unique unique (dossier_id, compte),
  constraint comptes_bancaires_principal_ou_propre check (
    (principal and compte is null and compte_propre_depuis is null)
    or (not principal and compte ~ '^512[0-9]{3}$' and compte_propre_depuis is not null
        and extract(month from compte_propre_depuis) = 1 and extract(day from compte_propre_depuis) = 1)),
  constraint comptes_bancaires_periode check (clos_le is null or ouvert_le is null or clos_le >= ouvert_le)
);
create unique index comptes_bancaires_un_principal on public.comptes_bancaires (dossier_id) where principal;

comment on table public.comptes_bancaires is
  'Les comptes bancaires professionnels d''un dossier (MCB1) : le principal suit le compte du rôle banque du plan ; un autre compte tient son propre 512 depuis le 1er janvier qu''il porte. Le libellé est lu par le client « Banque ».';
comment on column public.comptes_bancaires.compte is
  'Nul pour le principal (le compte du rôle banque) ; sinon le 512 à six chiffres de ce compte, figé à son premier mouvement ou relevé.';
comment on column public.comptes_bancaires.compte_propre_depuis is
  'Nul pour le principal ; sinon le 1er janvier depuis lequel ses mouvements s''écrivent à son propre compte (avant : au 512 du principal, MCB-Q7).';

alter table public.comptes_bancaires enable row level security;
create policy comptes_bancaires_cabinet on public.comptes_bancaires for all to authenticated
  using (public.admin_du_dossier(dossier_id)) with check (public.admin_du_dossier(dossier_id));
create policy comptes_bancaires_lecture_banque on public.comptes_bancaires for select to authenticated
  using (public.client_du_dossier(dossier_id, 'banque'::text));

-- La double authentification exigée (migration `deux_facteurs_exiges`, préparée) pose sa policy restrictive sur chaque
-- table de public : appliquée avant celle-ci, cette table la reçoit ici, à l'identique.
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    create policy deux_facteurs on public.comptes_bancaires as restrictive for all to authenticated
      using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()));
  end if;
end
$deux_facteurs$;

-- ══ 2. Le rattachement des mouvements et des relevés ══
alter table public.lignes_bancaires add column compte_bancaire_id uuid;
alter table public.controles_releves_bancaires add column compte_bancaire_id uuid;

insert into public.comptes_bancaires (dossier_id, libelle, principal, created_by)
select d.id, 'Compte principal', true, null
  from public.dossiers d
 where exists (select 1 from public.lignes_bancaires l where l.dossier_id = d.id)
    or exists (select 1 from public.controles_releves_bancaires r where r.dossier_id = d.id);

-- Le gel d'un exercice validé refuse toute mise à jour d'un de ses mouvements : il est suspendu le temps de poser le
-- compte principal, seule colonne que cette instruction écrit (aucune empreinte d'exercice ne lit `lignes_bancaires`).
alter table public.lignes_bancaires disable trigger lignes_bancaires_figees_par_la_validation;
update public.lignes_bancaires l
   set compte_bancaire_id = c.id
  from public.comptes_bancaires c
 where c.dossier_id = l.dossier_id and c.principal;
alter table public.lignes_bancaires enable trigger lignes_bancaires_figees_par_la_validation;
update public.controles_releves_bancaires r
   set compte_bancaire_id = c.id
  from public.comptes_bancaires c
 where c.dossier_id = r.dossier_id and c.principal;

alter table public.lignes_bancaires
  alter column compte_bancaire_id set not null,
  add constraint lignes_bancaires_compte_bancaire foreign key (compte_bancaire_id)
    references public.comptes_bancaires (id);
alter table public.controles_releves_bancaires
  alter column compte_bancaire_id set not null,
  add constraint controles_releves_bancaires_compte_bancaire foreign key (compte_bancaire_id)
    references public.comptes_bancaires (id);
create index lignes_bancaires_compte_bancaire_id_idx on public.lignes_bancaires (compte_bancaire_id);
create index controles_releves_bancaires_compte_bancaire_id_idx on public.controles_releves_bancaires (compte_bancaire_id);

-- ══ 3. La garde d'un compte bancaire ══
-- Aux droits de l'appelant : un compte qui n'est pas du cabinet du dossier ne voit rien, et la policy refuse ensuite son
-- écriture (42501) — la garde ne lui apprend rien de ce que le dossier tient. Une suppression qui part avec le dossier
-- (sa ligne ne le voit déjà plus) passe ; sinon un compte qui porte un mouvement ou un relevé ne se retire pas, ni le
-- principal d'un dossier qui tient un autre compte (la contrainte différée, plus bas).
create function public.garder_comptes_bancaires() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role text;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    if exists (select 1 from public.lignes_bancaires l where l.compte_bancaire_id = old.id)
       or exists (select 1 from public.controles_releves_bancaires r where r.compte_bancaire_id = old.id) then
      raise exception 'Le compte bancaire « % » porte des mouvements ou des relevés : il ne se retire pas.', old.libelle
        using errcode = '23503';
    end if;
    return old;
  end if;
  if btrim(coalesce(new.libelle, ''), E' \t\n\r') = '' or length(new.libelle) > 80 then
    raise exception 'Un compte bancaire se nomme d''un libellé d''un à quatre-vingts caractères, que le client « Banque » lit.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.dossier_id is distinct from old.dossier_id or new.principal is distinct from old.principal then
      raise exception 'Un compte bancaire ne change ni de dossier ni de rang : le principal le reste, un autre compte aussi.'
        using errcode = '23514';
    end if;
    if (new.compte, new.compte_propre_depuis) is distinct from (old.compte, old.compte_propre_depuis)
       and (exists (select 1 from public.lignes_bancaires l where l.compte_bancaire_id = old.id)
            or exists (select 1 from public.controles_releves_bancaires r where r.compte_bancaire_id = old.id)) then
      raise exception 'Le compte bancaire « % » porte déjà des mouvements ou des relevés : son compte du plan et la date depuis laquelle il le tient ne changent plus.',
        old.libelle using errcode = '23514';
    end if;
    if (new.ouvert_le, new.clos_le) is distinct from (old.ouvert_le, old.clos_le)
       and exists (select 1 from public.lignes_bancaires l
                    where l.compte_bancaire_id = old.id and (l.date < new.ouvert_le or l.date > new.clos_le)) then
      raise exception 'Le compte bancaire « % » porte des mouvements hors de la période qu''on lui donne : ses dates d''ouverture et de clôture les encadrent.',
        old.libelle using errcode = '23514';
    end if;
  end if;
  if new.ouvert_le is not null and new.clos_le is not null and new.clos_le < new.ouvert_le then
    raise exception 'Un compte bancaire se clôt le jour de son ouverture ou après.' using errcode = '23514';
  end if;
  if new.principal then
    if new.compte is not null or new.compte_propre_depuis is not null then
      raise exception 'Le compte principal suit le compte de banque du plan du dossier : il ne porte ni compte ni date à lui.'
        using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and exists (select 1 from public.comptes_bancaires c where c.dossier_id = new.dossier_id and c.principal) then
      raise exception 'Ce dossier a déjà son compte principal : un autre compte bancaire tient son propre compte 512.'
        using errcode = '23505';
    end if;
    return new;
  end if;
  if new.compte is null or new.compte !~ '^512[0-9]{3}$' then
    raise exception 'Un compte bancaire autre que le principal tient son propre compte du plan, six chiffres qui commencent par 512 : « % » n''en est pas un.',
      coalesce(new.compte, '') using errcode = '23514';
  end if;
  if new.compte_propre_depuis is null
     or extract(month from new.compte_propre_depuis) <> 1 or extract(day from new.compte_propre_depuis) <> 1 then
    raise exception 'Un compte bancaire tient son propre compte depuis le premier jour d''un exercice, un 1er janvier : « % » n''en est pas un.',
      coalesce(to_char(new.compte_propre_depuis, 'DD/MM/YYYY'), '') using errcode = '23514';
  end if;
  select r.role into v_role
    from public.roles_comptables r
   where public.compte_du_role(new.dossier_id, r.role) = new.compte
   order by r.ordre limit 1;
  if v_role is not null then
    raise exception 'Le compte % est celui du rôle « % » du plan comptable du dossier : un compte bancaire tient un compte qui n''est qu''à lui.',
      new.compte, v_role using errcode = '23514';
  end if;
  if exists (select 1 from public.comptes_bancaires c
              where c.dossier_id = new.dossier_id and c.compte = new.compte and c.id <> new.id) then
    raise exception 'Le compte % tient déjà un autre compte bancaire du dossier.', new.compte using errcode = '23505';
  end if;
  return new;
end
$$;
revoke all on function public.garder_comptes_bancaires() from public, anon, authenticated;
create trigger comptes_bancaires_garde
  before insert or update or delete on public.comptes_bancaires
  for each row execute function public.garder_comptes_bancaires();

-- Un dossier qui tient un compte bancaire tient son principal : jugé à la fin de la transaction, pour que la restauration
-- d'une sauvegarde réinsère les comptes d'un dossier dans l'ordre où elle les lit, et que le dossier qui part avec ses
-- comptes ne soit pas retenu.
create function public.garder_compte_principal_present() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_dossier uuid := coalesce(new.dossier_id, old.dossier_id);
begin
  if exists (select 1 from public.dossiers d where d.id = v_dossier)
     and exists (select 1 from public.comptes_bancaires c where c.dossier_id = v_dossier)
     and not exists (select 1 from public.comptes_bancaires c where c.dossier_id = v_dossier and c.principal) then
    raise exception 'Un dossier qui tient un compte bancaire tient son compte principal : le premier créé, qui suit le compte de banque du plan.'
      using errcode = '23514';
  end if;
  return null;
end
$$;
revoke all on function public.garder_compte_principal_present() from public, anon, authenticated;
create constraint trigger comptes_bancaires_principal_present
  after insert or update or delete on public.comptes_bancaires
  deferrable initially deferred
  for each row execute function public.garder_compte_principal_present();

-- ══ 4. Le compte d'un mouvement et d'un relevé ══
-- Arrivé sans compte, il reçoit celui du dossier quand il n'en a qu'un (le principal, créé ici au premier mouvement s'il
-- n'en a aucun, sous un verrou du dossier : deux premiers imports concurrents n'en créent qu'un), et se refuse dès deux.
-- Il ne change pas de compte ; son compte est de son dossier (la clé ne le dit pas : un compte qu'on ne lit pas, ou d'un
-- autre dossier, se refuse d'un même mot, qui n'apprend rien) ; ses dates restent dans la période du compte ; le mouvement
-- et le contrôle d'un même fichier sont du même compte. Aux droits de l'appelant : qui n'est pas du cabinet ne voit aucun
-- compte, et la création du principal se refuse alors comme son écriture (42501).
create function public.poser_compte_bancaire() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_comptes uuid[];
  v_nouveau uuid;
  v_compte record;
begin
  if tg_op = 'UPDATE' then
    if new.compte_bancaire_id is distinct from old.compte_bancaire_id then
      raise exception 'Un mouvement ou un relevé ne change pas de compte bancaire : il se retire, et s''importe sous le sien.'
        using errcode = '23514';
    end if;
  elsif new.compte_bancaire_id is null then
    perform pg_advisory_xact_lock(hashtextextended('comptes_bancaires:' || new.dossier_id::text, 0));
    select coalesce(array_agg(c.id), '{}') into v_comptes from public.comptes_bancaires c where c.dossier_id = new.dossier_id;
    if cardinality(v_comptes) = 0 then
      insert into public.comptes_bancaires (dossier_id, libelle, principal)
        values (new.dossier_id, 'Compte principal', true) returning id into v_nouveau;
      new.compte_bancaire_id := v_nouveau;
    elsif cardinality(v_comptes) = 1 then
      new.compte_bancaire_id := v_comptes[1];
    else
      raise exception 'Ce dossier tient plusieurs comptes bancaires : un mouvement ou un relevé dit le sien.'
        using errcode = '23502';
    end if;
  end if;
  select c.dossier_id, c.libelle, c.ouvert_le, c.clos_le into v_compte
    from public.comptes_bancaires c where c.id = new.compte_bancaire_id;
  if not found or v_compte.dossier_id <> new.dossier_id then
    raise exception 'Le compte bancaire d''un mouvement ou d''un relevé est un compte de son dossier.' using errcode = '23503';
  end if;
  if tg_table_name = 'lignes_bancaires' then
    if new.date < v_compte.ouvert_le or new.date > v_compte.clos_le then
      raise exception 'Le mouvement du % tombe hors de la période du compte bancaire « % » : ses dates d''ouverture et de clôture l''encadrent.',
        to_char(new.date, 'DD/MM/YYYY'), v_compte.libelle using errcode = '23514';
    end if;
    if new.source_fichier is not null
       and exists (select 1 from public.controles_releves_bancaires r
                    where r.dossier_id = new.dossier_id and r.source_fichier = new.source_fichier
                      and r.compte_bancaire_id <> new.compte_bancaire_id) then
      raise exception 'Le relevé « % » est d''un autre compte bancaire : ses mouvements sont du compte de son contrôle.',
        new.source_fichier using errcode = '23514';
    end if;
  elsif new.source_fichier is not null
     and exists (select 1 from public.lignes_bancaires l
                  where l.dossier_id = new.dossier_id and l.source_fichier = new.source_fichier
                    and l.compte_bancaire_id <> new.compte_bancaire_id) then
    raise exception 'Le relevé « % » est d''un autre compte bancaire : ses mouvements sont du compte de son contrôle.',
      new.source_fichier using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function public.poser_compte_bancaire() from public, anon, authenticated;
create trigger lignes_bancaires_compte_bancaire
  before insert or update of compte_bancaire_id, dossier_id, date, source_fichier on public.lignes_bancaires
  for each row execute function public.poser_compte_bancaire();
create trigger controles_releves_bancaires_compte_bancaire
  before insert or update of compte_bancaire_id, dossier_id, source_fichier on public.controles_releves_bancaires
  for each row execute function public.poser_compte_bancaire();

-- ══ 5. Le plan : un rôle ne prend pas le compte d'un compte bancaire ══
create function public.garder_plan_hors_des_comptes_bancaires() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_libelle text;
begin
  select c.libelle into v_libelle
    from public.comptes_bancaires c
   where c.dossier_id = new.dossier_id and c.compte = new.compte
   limit 1;
  if v_libelle is not null then
    raise exception 'Le compte % tient le compte bancaire « % » du dossier : le rôle « % » du plan ne le prend pas.',
      new.compte, v_libelle, new.role using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function public.garder_plan_hors_des_comptes_bancaires() from public, anon, authenticated;
create trigger plan_comptable_dossier_hors_des_comptes_bancaires
  before insert or update of compte on public.plan_comptable_dossier
  for each row execute function public.garder_plan_hors_des_comptes_bancaires();

-- ══ 6. Le compte 512 de la jambe de banque d'un mouvement ══
-- Le principal : le compte du rôle banque du plan ; un autre compte : le sien, depuis sa date, et celui du principal
-- avant (MCB-Q7). Nul pour un mouvement que l'appelant ne lit pas.
create function public.compte_de_banque_du_mouvement(p_ligne_bancaire_id uuid) returns text
language sql
stable
set search_path = public
as $$
  select case when c.principal or l.date < c.compte_propre_depuis
              then public.compte_du_role(l.dossier_id, 'banque')
              else c.compte end
    from public.lignes_bancaires l
    join public.comptes_bancaires c on c.id = l.compte_bancaire_id
   where l.id = p_ligne_bancaire_id
$$;
revoke all on function public.compte_de_banque_du_mouvement(uuid) from public, anon;
grant execute on function public.compte_de_banque_du_mouvement(uuid) to authenticated;
