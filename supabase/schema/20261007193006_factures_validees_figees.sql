-- Ligne 28.5 de la feuille de route, étape (c), premier temps, seconde migration : UNE FACTURE VALIDÉE SE FIGE EN
-- BASE. Une facture émise ne se modifie ni ne se supprime : une erreur se corrige par un avoir qui la cite, et sa
-- numérotation est une séquence chronologique et continue, sans trou ni doublon (CGI, ann. II, art. 242 nonies A).
-- L'application le respectait — `enregistrer_facture` refuse de modifier une facture validée, et l'écran n'en propose
-- que l'aperçu —, la base non : les policies `factures_emises_all` et `facture_lignes_all` ouvrent les deux tables
-- entières à quiconque administre le dossier. Par un appel direct à l'API, on pouvait donc changer le montant d'une
-- facture validée, la supprimer, réécrire ses lignes, en poser une « validée » au numéro de son choix, ou glisser un
-- avoir en brouillon que `enregistrer_facture` validait ensuite par son chemin ordinaire, sans aucune des règles de
-- l'avoir (une facture d'origine validée, un crédit qui ne dépasse pas ce qu'elle porte encore). Et les deux
-- fonctions de numérotation étaient appelables par tout compte connecté : chaque appel CONSOMME un numéro sans la
-- facture qu'il désigne, donc creuse un trou dans la suite.
--
-- Mesuré le 07/10/2026 : six factures en base, toutes validées dans un bac à sable abandonné, toutes conformes à ce que
-- cette migration exige ; aucun avoir, aucun brouillon ; un seul compteur, égal au plus haut numéro émis.

-- ══ Ce que la ligne dit d'elle-même ══════════
-- Un numéro n'existe que sur une facture validée, et toute facture validée en porte un, avec sa date de validation.
-- Le numéro est celui de sa série — F pour une facture, A pour un avoir — et de l'année de son émission : c'est ce
-- qu'écrit `numero_facture_formate`, et la numérotation s'en sert pour reprendre la suite (plus bas). Les montants sont
-- au centime, et le TTC fait la somme du HT et de la TVA (la règle BR-CO-15 de la norme EN 16931) : l'application les
-- somme en centimes depuis l'étape (c), premier temps. Une facture n'a pas de facture d'origine ; un avoir en a une, que
-- la restauration d'une sauvegarde pose en second passage — d'où l'absence d'obligation de ce côté.
alter table public.factures_emises
  add constraint factures_emises_numero_de_la_validation
    check ((statut = 'validee') = (numero is not null)),
  add constraint factures_emises_date_de_la_validation
    check ((statut = 'validee') = (validated_at is not null)),
  add constraint factures_emises_numero_de_sa_serie
    check (numero ~ '^[FA][0-9]{4}-[0-9]{4,}$'
      and left(numero, 1) = case when type = 'avoir' then 'A' else 'F' end
      and substr(numero, 2, 4) = extract(year from date_emission)::integer::text),
  add constraint factures_emises_montants_au_centime
    check (montant_ht = round(montant_ht, 2) and montant_tva = round(montant_tva, 2) and montant_ttc = round(montant_ttc, 2)),
  add constraint factures_emises_ttc_du_ht_et_de_la_tva
    check (montant_ttc = montant_ht + montant_tva),
  add constraint factures_emises_origine_d_un_avoir
    check (type = 'avoir' or facture_origine_id is null);

-- ══ La numérotation ══════════
-- Le dix-millième numéro d'une année : `lpad(…, 4, '0')` TRONQUE une chaîne de plus de quatre caractères, si bien que la
-- séquence 10000 s'écrivait « 1000 », le numéro d'une facture déjà émise — l'index unique refusait alors chaque
-- validation de l'année. Le numéro garde désormais tous ses chiffres.
create or replace function public.numero_facture_formate(p_annee integer, p_type text, p_sequence integer)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $$
  select (case when p_type = 'avoir' then 'A' else 'F' end) || p_annee::text || '-'
    || lpad(p_sequence::text, greatest(4, length(p_sequence::text)), '0')
$$;

-- Le numéro suivant d'une série REPREND du plus haut numéro déjà émis quand le compteur manque ou retarde. Le compteur
-- (`facture_numerotation`) n'a aucune policy : une sauvegarde, lue avec la session du navigateur, en rend zéro ligne, et
-- un dossier restauré le perdait — sa première facture prenait le numéro 1 de l'année, déjà émis, et l'index unique
-- refusait chaque validation jusqu'à ce que quelqu'un répare le compteur à la main. Les factures font foi, le compteur
-- n'est qu'un repère ; il ne recule jamais, si bien qu'un numéro consommé sans facture reste un trou et n'est pas
-- réattribué. La série est VERROUILLÉE avant d'être lue — sa ligne posée si elle manque —, donc deux validations
-- concurrentes se suivent, et la seconde voit le numéro de la première.
create or replace function public.prochain_numero_facture(p_dossier_id uuid, p_annee integer, p_type text default 'facture')
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_prefixe text;
  v_compteur integer;
  v_emis integer;
  v_numero integer;
begin
  if p_type not in ('facture', 'avoir') then
    raise exception 'Type de numérotation invalide : %', p_type using errcode = '22023';
  end if;
  if not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  insert into facture_numerotation (dossier_id, annee, type, dernier_numero)
  values (p_dossier_id, p_annee, p_type, 0)
  on conflict (dossier_id, annee, type) do nothing;
  select n.dernier_numero into v_compteur
  from facture_numerotation n
  where n.dossier_id = p_dossier_id and n.annee = p_annee and n.type = p_type
  for update;

  v_prefixe := (case when p_type = 'avoir' then 'A' else 'F' end) || p_annee::text || '-';
  select coalesce(max(substr(f.numero, length(v_prefixe) + 1)::integer), 0) into v_emis
  from factures_emises f
  where f.dossier_id = p_dossier_id and f.numero ~ ('^' || v_prefixe || '[0-9]+$');

  v_numero := greatest(v_compteur, v_emis) + 1;
  update facture_numerotation set dernier_numero = v_numero
  where dossier_id = p_dossier_id and annee = p_annee and type = p_type;
  return v_numero;
end;
$$;

-- Personne n'appelle plus ces deux fonctions directement : chaque appel consomme un numéro, et un numéro pris sans la
-- facture qu'il désigne est un trou dans la suite. Seule `enregistrer_facture` en prend un, dans la transaction qui
-- valide ; elle appartient au propriétaire de la base, qui garde son droit d'exécution. L'application ne les appelle
-- plus depuis l'étape (c), premier temps : l'avoir passe lui aussi par `enregistrer_facture`.
revoke execute on function public.prochain_numero_facture(uuid, integer, text) from public, anon, authenticated, service_role;
revoke execute on function public.attribuer_numero_facture(uuid, integer, text) from public, anon, authenticated, service_role;

-- ══ La restauration ══════════
-- La restauration d'une sauvegarde réinsère des factures déjà validées et leurs lignes, puis repose en second passage le
-- lien d'un avoir vers sa facture (`TABLES_AUTO_REFERENCEES`, src/lib/sauvegarde.ts). Elle se fait par le
-- super-administrateur, dans un dossier qu'elle vient de recréer — donc sans compteur de numérotation, puisque la
-- sauvegarde ne l'emporte pas. C'est cette porte, et elle seule, qui reste ouverte : le super-administrateur, dans un
-- dossier qui n'a jamais validé de facture par `enregistrer_facture` ; sa première validation pose le compteur et la
-- ferme. CE QU'ELLE NE COUVRE PAS, dit plutôt que promis : sur ce projet le super-administrateur est aussi le chef du
-- cabinet, et un appel direct de sa part peut encore poser une facture validée dans un dossier qui n'en a jamais validé
-- — la limite qu'a la restauration des écritures validées (migration restauration_des_exercices_valides).
create function public.restauration_des_factures(p_dossier_id uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    and not exists (select 1 from public.facture_numerotation n where n.dossier_id = p_dossier_id)
$$;

-- ══ La garde ══════════
-- Une facture validée ne se modifie ni ne se supprime — sauf avec son dossier entier, dont la suppression emporte ses
-- factures : sa ligne ne le voit déjà plus. Elle ne garde de modifiable que ce que son envoi écrit APRÈS coup et qu'elle
-- n'imprime ni ne transmet : l'adresse à laquelle `send-email` l'a envoyée, et ce que Super PDP en dit. Elle ne devient
-- « validée » que par `enregistrer_facture`, qui lui donne son numéro et annonce CETTE facture par le réglage
-- `jd.validation_facture` (étape c, premier temps) ; ne naît validée que par la restauration ; ne change pas de dossier ;
-- et une facture ne devient pas un avoir. DEFINER pour lire le compteur et le dossier quelle que soit la RLS de
-- l'appelant ; elle ne rend rien qu'elle n'ait reçu.
create function public.garder_factures_validees() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Ce que l'envoi d'une facture validée écrit après coup. Une colonne qu'une étape suivante écrira sur une facture
  -- validée (le dépôt chez la plateforme du client) s'inscrit ici, dans sa migration : facturesFigees.test.ts compare
  -- cette liste à ce que les Edge Functions et l'application écrivent.
  v_modifiables constant text[] := array['tiers_email', 'superpdp_invoice_id', 'superpdp_dernier_statut'];
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return old;
    end if;
    if old.statut = 'validee' then
      raise exception 'La facture % est validée : elle ne se supprime plus — la corriger passe par un avoir.', old.numero
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.dossier_id is distinct from old.dossier_id then
      raise exception 'Une facture ne change pas de dossier.' using errcode = '23514';
    end if;
    if old.statut = 'validee' then
      -- Le second passage d'une restauration repose le lien d'un avoir vers sa facture, et rien d'autre.
      if old.type = 'avoir' and old.facture_origine_id is null and new.facture_origine_id is not null
         and to_jsonb(new) - 'facture_origine_id' = to_jsonb(old) - 'facture_origine_id'
         and public.restauration_des_factures(old.dossier_id) then
        return new;
      end if;
      if to_jsonb(new) - v_modifiables is distinct from to_jsonb(old) - v_modifiables then
        raise exception 'La facture % est validée : elle ne se modifie plus — la corriger passe par un avoir.', old.numero
          using errcode = '23514';
      end if;
      return new;
    end if;
    if new.type is distinct from old.type or new.facture_origine_id is distinct from old.facture_origine_id then
      raise exception 'Une facture ne devient pas un avoir : un avoir se crée par enregistrer_facture, qui le valide aussitôt.'
        using errcode = '42501';
    end if;
    if new.statut = 'validee'
       and coalesce(current_setting('jd.validation_facture', true), '') is distinct from new.id::text then
      raise exception 'Une facture ne se valide que par enregistrer_facture, qui lui donne son numéro.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.statut = 'validee' and not public.restauration_des_factures(new.dossier_id) then
    raise exception 'Une facture ne naît pas validée : elle se valide par enregistrer_facture, qui lui donne son numéro.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger factures_emises_figees
  before insert or update or delete on public.factures_emises
  for each row execute function public.garder_factures_validees();

-- UN AVOIR N'A PAS DE BROUILLON. `enregistrer_facture` le crée puis le valide dans la même transaction ; un avoir posé
-- en brouillon par un appel direct, que la fonction validerait ensuite par son chemin ordinaire, échapperait à toutes
-- les règles de l'avoir. La vérification attend la FIN de la transaction (contrainte différée) : l'avoir de la fonction
-- y est déjà validé, celui d'un appel direct ne l'est pas.
create function public.verifier_avoir_sans_brouillon() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.factures_emises f where f.id = new.id and f.type = 'avoir' and f.statut = 'brouillon') then
    raise exception 'Un avoir se crée par enregistrer_facture, qui le valide aussitôt : il n''a pas de brouillon.'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger factures_emises_avoir_sans_brouillon
  after insert on public.factures_emises
  deferrable initially deferred
  for each row when (new.type = 'avoir' and new.statut = 'brouillon')
  execute function public.verifier_avoir_sans_brouillon();

-- Les lignes d'une facture validée sont figées avec elle. Elles se posent tant qu'elle est un brouillon — c'est ce que
-- fait `enregistrer_facture` avant de la valider —, et partent avec elle quand on supprime un brouillon ou un dossier
-- entier : la facture n'est alors déjà plus visible. La restauration d'une sauvegarde les réinsère par la porte de ses
-- factures.
create function public.garder_lignes_facture_validee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
  v_statut text;
  v_dossier uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select f.numero, f.statut into v_numero, v_statut from public.factures_emises f where f.id = old.facture_id;
    if v_statut = 'validee' then
      raise exception 'La facture % est validée : ses lignes ne changent plus — la corriger passe par un avoir.', v_numero
        using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  select f.numero, f.statut, f.dossier_id into v_numero, v_statut, v_dossier
  from public.factures_emises f where f.id = new.facture_id;
  if v_statut = 'validee' and not (tg_op = 'INSERT' and public.restauration_des_factures(v_dossier)) then
    raise exception 'La facture % est validée : ses lignes ne changent plus — la corriger passe par un avoir.', v_numero
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger facture_lignes_figees
  before insert or update or delete on public.facture_lignes
  for each row execute function public.garder_lignes_facture_validee();

revoke execute on function public.restauration_des_factures(uuid) from public, anon, authenticated;
revoke execute on function public.garder_factures_validees() from public, anon, authenticated;
revoke execute on function public.verifier_avoir_sans_brouillon() from public, anon, authenticated;
revoke execute on function public.garder_lignes_facture_validee() from public, anon, authenticated;

comment on function public.prochain_numero_facture(uuid, integer, text) is
  'Le numéro suivant d''une série, repris du plus haut numéro déjà émis quand le compteur manque ou retarde. Appelée par enregistrer_facture seule.';
comment on function public.restauration_des_factures(uuid) is
  'Vrai pour le super-administrateur dans un dossier qui n''a jamais validé de facture : la porte de la restauration d''une sauvegarde.';
comment on function public.garder_factures_validees() is
  'Une facture validée ne se modifie ni ne se supprime ; elle ne se valide que par enregistrer_facture (déclencheur factures_emises_figees).';
comment on function public.garder_lignes_facture_validee() is
  'Les lignes d''une facture validée ne changent plus (déclencheur facture_lignes_figees).';
comment on function public.verifier_avoir_sans_brouillon() is
  'Un avoir n''a pas de brouillon : vérifié à la fin de la transaction (contrainte factures_emises_avoir_sans_brouillon).';
