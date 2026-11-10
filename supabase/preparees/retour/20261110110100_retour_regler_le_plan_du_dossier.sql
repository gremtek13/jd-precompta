-- LE RETOUR DE `regler_le_plan_du_dossier` (supabase/preparees/20261110110000, ligne 43, étape PC4 ; PRÉPARÉ, comme
-- elle) : la base d'avant, au caractère près des corps, des contraintes et des commentaires qu'elle avait. DESTRUCTIF (une
-- fonction, quatre déclencheurs et leurs fonctions, une policy retirés) : il se COLLE dans l'éditeur SQL, dans une
-- transaction, sur l'accord explicite du cabinet. Il se refuse dès qu'un dossier règle un rôle de son plan : les deux
-- contraintes en dur reviendraient sur des comptes qu'elles ignorent, et un plan réglé, puis écrit, ne se défait plus
-- (conception, § 5.4, « RETOUR ARRIÈRE ») — on masque alors l'écran, les plans restent. Rien d'autre : aucune donnée.
do $garde$
begin
  if to_regprocedure('public.regler_plan_du_dossier(uuid, jsonb)') is null then
    raise exception 'La migration regler_le_plan_du_dossier n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if exists (select 1 from public.plan_comptable_dossier) then
    raise exception 'Un dossier règle un rôle de son plan : le retour arrière ne se fait plus, on corrige en avant. Rien n''est défait.';
  end if;
  -- La garde du plan est celle que la migration a posée (son corps, fins de ligne ramenées à \n).
  if (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure('public.garder_plan_comptable_dossier()'))
     is distinct from '96b4b19689cc163b797e53c31293f13b' then
    raise exception 'La garde du plan n''est pas celle que la migration a posée : rien à défaire sans la relire.';
  end if;
end
$garde$;

drop trigger ecritures_brouillon_comptes_des_pieces on public.ecritures_brouillon;
drop trigger lettrages_manuels_un_compte_qui_se_lettre on public.lettrages_manuels;
drop trigger plan_comptable_dossier_dirigeant on public.plan_comptable_dossier;
drop trigger dossiers_compte_du_dirigeant on public.dossiers;
drop function public.garder_comptes_des_pieces();
drop function public.garder_compte_lettrable();
drop function public.garder_dirigeant_du_plan();
drop function public.garder_compte_du_dirigeant();
drop function public.regler_plan_du_dossier(uuid, jsonb);
drop policy plan_comptable_dossier_restauration on public.plan_comptable_dossier;

-- La garde du plan de l'étape PC1 (migration plan_comptable_des_dossiers), au caractère près.
create or replace function public.garder_plan_comptable_dossier() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_racines text[];
  v_prefixe_defaut text;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une ligne du plan comptable d''un dossier ne se retire pas directement : elle part avec son dossier.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une ligne du plan comptable d''un dossier ne se modifie pas directement.' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Le plan comptable d''un dossier ne s''écrit pas directement : seule la restauration d''une sauvegarde, par l''administrateur de l''application, y insère une ligne.'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(public.cle_validation(new.dossier_id));
  if exists (select 1 from public.ecritures_brouillon e where e.dossier_id = new.dossier_id)
     or exists (select 1 from public.a_nouveaux a where a.dossier_id = new.dossier_id)
     or exists (select 1 from public.soldes_reportes s where s.dossier_id = new.dossier_id) then
    raise exception 'Ce dossier porte déjà des écritures : son plan comptable ne se restaure que dans un dossier qui n''en a encore aucune.'
      using errcode = '23514';
  end if;
  select r.racines, r.prefixe_auxiliaire_defaut into v_racines, v_prefixe_defaut
    from public.roles_comptables r where r.role = new.role;
  if not found then
    return new;
  end if;
  if new.compte !~ '^[0-9]{6}$' then
    raise exception 'Le compte du rôle « % » s''écrit en six chiffres : « % » n''en est pas un.', new.role, new.compte
      using errcode = '23514';
  end if;
  if new.compte is not null
     and not exists (select 1 from unnest(v_racines) as x(racine) where left(new.compte, length(x.racine)) = x.racine) then
    raise exception 'Le compte du rôle « % » commence par sa racine du plan comptable (%) : « % » n''en est pas un.',
      new.role, array_to_string(v_racines, ' ou '), new.compte using errcode = '23514';
  end if;
  if new.prefixe_auxiliaire is not null and v_prefixe_defaut is null then
    raise exception 'Seuls les comptes de tiers (fournisseurs, fournisseurs d''immobilisations, clients) portent un préfixe de comptes auxiliaires : pas le rôle « % ».',
      new.role using errcode = '23514';
  end if;
  if new.prefixe_auxiliaire !~ '^[A-Z0-9]{1,5}$' then
    raise exception 'Le préfixe des comptes auxiliaires du rôle « % » s''écrit d''une à cinq lettres majuscules ou chiffres : « % » n''en est pas un.',
      new.role, new.prefixe_auxiliaire using errcode = '23514';
  end if;
  return new;
end
$$;

-- Les deux contraintes, aux textes de leurs migrations (modele_comptable_du_dossier, lettrages_manuels) : sous le plan
-- vide, chaque ligne les satisfait, les déclencheurs retirés l'ayant exigé.
alter table public.dossiers add constraint dossiers_compte_notes_de_frais_check check (compte_notes_de_frais in ('455000', '108000', '467000'));
alter table public.lettrages_manuels add constraint lettrages_manuels_compte check (compte in ('401000', '404000', '411000', '455000', '467000'));

comment on table public.plan_comptable_dossier is
  'Les rôles qu''un dossier règle (ligne 43) : un rôle sans ligne prend le défaut de roles_comptables. Lu par le cabinet du dossier (admin_du_dossier), jamais par le client ; aucune policy d''écriture, et la garde (garder_plan_comptable_dossier) n''admet que la restauration d''une sauvegarde par le super-administrateur dans un dossier sans écriture. Vide jusqu''à l''étape PC4.';
comment on column public.dossiers.compte_notes_de_frais is
  'En engagement, le compte crédité par une note de frais payée par le dirigeant : 455 compte courant d''associé (dirigeant associé d''une société), 108 compte de l''exploitant (entreprise individuelle), 467 divers comptes débiteurs et produits à recevoir (personne non associée, ou aucun compte plus spécifique).';

do $fin$
begin
  -- Fins de ligne ramenées à \n : collé dans l'éditeur, le corps peut arriver en \r\n.
  if (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure('public.garder_plan_comptable_dossier()'))
     is distinct from '11935e7eb713ef1a82f3f26f928d34a1' then
    raise exception 'La garde du plan rendue n''est pas celle de l''étape PC1 : rien n''est défait.';
  end if;
end
$fin$;
