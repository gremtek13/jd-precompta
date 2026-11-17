-- L'ASSOCIATION DES PAIEMENTS DE L'ASSURANCE MALADIE AUX MOUVEMENTS DU RELEVÉ (conception 53, lot NOE5) — PRÉPARÉE le
-- 17/11/2026, PAS APPLIQUÉE, À COLLER APRÈS `paiements_assurance_maladie` (NOE3, dont elle exige les tables et les fonctions à
-- l'empreinte). Le récit : HISTORIQUE.md, « 17/11/2026 — NOE5 : L'ASSOCIATION DES PAIEMENTS DE L'ASSURANCE MALADIE AUX CRÉDITS
-- DU RELEVÉ (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai : supabase/essais/associationPaiementsAssuranceMaladie.sql (et, sur une
-- réplique seulement, associationPaiementsAssuranceMaladieSuppression.sql) ; le retour :
-- supabase/preparees/retour/20261117160100_retour_association_paiements_assurance_maladie.sql ; le module qui propose, et qui
-- redit ses refus avant le clic : src/lib/rapprochementAssuranceMaladie.ts (`ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES`).
--
-- LA RÈGLE. Un paiement de l'assurance maladie JUSTIFIE et CONTRÔLE le crédit du relevé qui le verse ; il ne compte dans
-- aucun moteur. La recette reste le crédit, classé, à sa date (l'expert-comptable, le 17/11/2026 : « date de valeur si on l'a,
-- ou date d'encaissement ») : l'association ne touche ni le classement du mouvement, ni son écriture, ni la 2035, ni la CA3,
-- ni le FEC. ELLE VIT DONC DANS SA PROPRE TABLE, hors de `lignes_bancaires_un_seul_rapprochement` : un crédit associé se
-- classe en recette comme hier, et son classement ne défait pas l'association.
--
-- CE QU'ELLE POSE.
--   1. `paiements_assurance_maladie_mouvements` : un paiement associé à un mouvement — chaque paiement au plus une fois ; un
--      mouvement porte un groupe de paiements (une part seule, ou les deux parts d'une journée, conception 53, § 5) dont la
--      somme fait son montant au centime. Le groupe s'écrit et se défait D'UN SEUL TENANT : aucun ajout à un mouvement déjà
--      associé, aucun retrait d'un seul paiement. Aucune colonne de texte. La clé vers le paiement RETIENT le retrait de son
--      import (sans action à la suppression : vérifiée en fin d'instruction, la suppression d'un dossier passe, ses
--      associations parties avec lui) ; celle vers le mouvement le suit (un mouvement retiré emporte son association).
--   2. `associer_paiements_assurance_maladie(dossier, paiements, mouvements)`, aux droits du propriétaire, TOUT OU RIEN : deux
--      listes de même longueur, le i-ème paiement associé au i-ème mouvement (un mouvement répété porte un groupe) ; le lot
--      « Associer les concordances » est le même appel. Au cabinet du dossier seul (conception 53, § 4). Elle rend les
--      associations écrites.
--   3. `defaire_association_assurance_maladie(dossier, mouvement)`, aux mêmes droits : le groupe du mouvement part entier ; elle
--      rend les associations défaites.
--   4. Les policies, toutes à `authenticated` : le cabinet du dossier lit ; un accès « Banque » lit les associations de son
--      dossier (il lit déjà les mouvements et les paiements qu'elles relient — CETTE LECTURE SE PRÉSENTE AU CABINET AVANT
--      D'ÊTRE APPLIQUÉE, la fiche NOE5-Q1) ; le super-administrateur insère (la restauration). Aucune policy de mise à jour ni
--      de suppression.
--   5. La restrictive `deux_facteurs`, si sa migration est déjà en base.
--   6. `garder_paiements_assurance_maladie_mouvements`, avant la RLS, AUX DROITS DE L'APPELANT (comme la garde de NOE3 ; elle
--      n'appelle donc pas la porte `_acces_avant_les_gardes`) : une association ne s'écrit que par sa fonction (le réglage
--      `jd.associations_assurance_maladie` porte le dossier) ou par la restauration ; elle tient son paiement et son mouvement
--      dans son dossier ; ne se modifie jamais ; ne part que par sa fonction, avec son mouvement ou avec son dossier — aussi
--      pour le rôle des Edge Functions, qui passe la RLS.
--   7. `retenir_import_associe`, avant le retrait d'un import, aux droits de l'appelant : un import dont un paiement est
--      associé ne se retire pas (les mots du refus, avant la clé étrangère qui le retiendrait sans eux), sauf avec son dossier.
--
-- LES REFUS DE L'ASSOCIATION, DANS L'ORDRE (que src/lib/rapprochementAssuranceMaladie.ts redit avant le clic, sous les mêmes
-- mots) : l'appelant qui n'est pas le cabinet du dossier (42501) ; puis, sous le verrou des paiements du dossier (celui de
-- l'import et du retrait) : la forme (22023) ; un mouvement hors du dossier (22023) ; un paiement hors du dossier (22023) ; un
-- mouvement d'un exercice validé (22023 : l'association justifie le crédit, elle se fige avec SON année — celle de la recette,
-- pas celle de la journée comptable) ; un mouvement écarté ou personnel (23514 : un remboursement du praticien comme assuré
-- n'est pas une recette) ; un mouvement que la règle G2 retient, classé ou réservé par des encaissements de factures sources
-- (23514, le prédicat de `garder_mouvement_reserve`) ; un paiement déjà associé (22023) ; un mouvement déjà associé (22023) ;
-- une somme qui ne fait pas le montant d'un mouvement, nommé par sa date (22023). Au retrait : l'appelant (42501) ; rien à
-- défaire (22023) ; un exercice validé (22023).
--
-- CE QU'ELLE NE TIENT PAS (dit au récit) : l'autre sens de la règle G2 — un encaissement qui citerait un crédit déjà associé —
-- reste à l'écran (`candidatsDuMouvement`), sa garde en base étant celle des encaissements, en production, à reprendre à part.
--
-- CE QU'ELLE NE CHANGE PAS : aucune fonction d'hier n'est remplacée ; `lignes_bancaires`, ses contraintes et ses fonctions sont
-- intactes ; `paiements_assurance_maladie` et `imports_assurance_maladie` reçoivent une clé entrante et un déclencheur de plus,
-- rien d'autre. Le retrait d'une association est une suppression DANS LE CORPS d'une fonction : l'outil d'application la
-- retient — le cabinet la colle dans l'éditeur SQL, avec sa ligne d'historique (CLAUDE.md).
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la version
-- que porte sa ligne d'historique, texte inchangé. Ni barre oblique inverse, ni retour chariot.

-- ══ 0. La garde de tête ══════════
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.paiements_assurance_maladie_mouvements') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('associer_paiements_assurance_maladie', 'defaire_association_assurance_maladie',
                                   'garder_paiements_assurance_maladie_mouvements', 'retenir_import_associe')) then
    raise exception 'La migration association_paiements_assurance_maladie est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.paiements_assurance_maladie') is null or to_regclass('public.imports_assurance_maladie') is null then
    raise exception 'Les tables des paiements de l''assurance maladie manquent : appliquer d''abord paiements_assurance_maladie (NOE3).';
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('encaissement_justifie_son_mouvement', 'public.encaissement_justifie_son_mouvement(uuid)', '5d8ac5a1d8d08ceb95a3eca3b98c499d'),
      ('garder_paiements_assurance_maladie', 'public.garder_paiements_assurance_maladie()', '97548e624b2380eab867a53f3f850189'),
      ('retirer_import_assurance_maladie', 'public.retirer_import_assurance_maladie(uuid)', '758c59154be4c08f680119c7cd0c1e4c')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.signature, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'client_du_dossier';
  if v_nombre <> 1
     or strpos(replace(coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.client_du_dossier(uuid,text)')), ''), chr(13), ''),
               'when ''banque'' then m.droit_banque') = 0 then
    raise exception 'La fonction public.client_du_dossier(uuid,text) ne lit plus « banque » sur droit_banque : la relire avant d''appliquer cette migration.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped
     and ((a.attrelid = 'public.lignes_bancaires'::regclass
           and a.attname in ('id', 'dossier_id', 'date', 'montant', 'statut', 'prelevement_personnel', 'encaissements_de_factures'))
       or (a.attrelid = 'public.encaissements_factures'::regclass and a.attname in ('id', 'facture_id', 'ligne_bancaire_id', 'retire_le'))
       or (a.attrelid = 'public.factures_emises'::regclass and a.attname in ('id', 'source_de_la_vente'))
       or (a.attrelid = 'public.exercices_valides'::regclass and a.attname in ('dossier_id', 'annee'))
       or (a.attrelid = 'public.paiements_assurance_maladie'::regclass and a.attname in ('id', 'dossier_id', 'import_id', 'montant_centimes'))
       or (a.attrelid = 'public.imports_assurance_maladie'::regclass and a.attname in ('id', 'dossier_id')));
  if v_nombre <> 21 then
    raise exception 'Une colonne que cette migration lit manque (% sur 21) : relire le relevé, les encaissements et les paiements avant d''appliquer cette migration.', v_nombre;
  end if;
  if (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
       where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'montant') is distinct from 'numeric(12,2)' then
    raise exception 'Le montant d''un mouvement n''est plus en centimes exacts (numeric(12,2)) : la somme au centime ne se juge plus ainsi.';
  end if;
end
$garde$;

-- ══ 1. La table ══════════
-- L'auteur sans clé étrangère vers son compte (le patron de NOE3) : retirer le compte d'un membre parti ne doit pas effacer qui
-- a associé.
create table public.paiements_assurance_maladie_mouvements (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  paiement_id uuid not null references public.paiements_assurance_maladie (id),
  ligne_bancaire_id uuid not null references public.lignes_bancaires (id) on delete cascade,
  associe_par uuid not null,
  associe_le timestamptz not null default now(),
  constraint paiements_assurance_maladie_mouvements_un_paiement unique (paiement_id)
);

create index paiements_assurance_maladie_mouvements_ligne on public.paiements_assurance_maladie_mouvements (ligne_bancaire_id);
create index paiements_assurance_maladie_mouvements_dossier on public.paiements_assurance_maladie_mouvements (dossier_id);

comment on table public.paiements_assurance_maladie_mouvements is
  'L''association d''un paiement de l''assurance maladie au mouvement du relevé qui le verse (conception 53, NOE5) : chaque paiement au plus une fois ; les paiements d''un mouvement font son montant au centime. Elle justifie et contrôle le crédit ; elle ne le classe pas et ne compte dans aucun moteur. Écrite par associer_paiements_assurance_maladie, défaite par defaire_association_assurance_maladie (le cabinet seul).';
comment on column public.paiements_assurance_maladie_mouvements.associe_par is
  'Le compte du cabinet qui a associé (auth.uid()), sans clé étrangère : il survit au retrait du compte.';

alter table public.paiements_assurance_maladie_mouvements enable row level security;

create policy paiements_assurance_maladie_mouvements_lecture on public.paiements_assurance_maladie_mouvements
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy paiements_assurance_maladie_mouvements_lecture_banque on public.paiements_assurance_maladie_mouvements
  for select to authenticated using (client_du_dossier(dossier_id, 'banque'));
create policy paiements_assurance_maladie_mouvements_restauration on public.paiements_assurance_maladie_mouvements
  for insert to authenticated with check (is_super_admin());

-- ══ 1 bis. La garde de la table ══════════
-- Avant la RLS, aux droits de l'appelant. Chaque branche lit NEW ou OLD selon l'opération, jamais l'autre. Une association
-- part par la fonction du retrait (le réglage porte son dossier), après son mouvement ou son dossier (la cascade : le parent
-- n'est déjà plus là).
create function public.garder_paiements_assurance_maladie_mouvements() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Une association d''un paiement de l''assurance maladie ne se modifie pas : elle se défait et se refait.'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('jd.associations_assurance_maladie', true), '') = old.dossier_id::text
       or not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or not exists (select 1 from public.lignes_bancaires l where l.id = old.ligne_bancaire_id) then
      return old;
    end if;
    raise exception 'Une association d''un paiement de l''assurance maladie ne se défait que par sa fonction, ou avec son mouvement ou son dossier.'
      using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.associations_assurance_maladie', true), '') <> new.dossier_id::text and not public.is_super_admin() then
    raise exception 'Les associations des paiements de l''assurance maladie ne s''écrivent que par leur fonction.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.paiements_assurance_maladie p where p.id = new.paiement_id and p.dossier_id = new.dossier_id)
     or not exists (select 1 from public.lignes_bancaires l where l.id = new.ligne_bancaire_id and l.dossier_id = new.dossier_id) then
    raise exception 'Une association tient un paiement et un mouvement de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function public.garder_paiements_assurance_maladie_mouvements() is
  'La garde de l''association des paiements de l''assurance maladie (NOE5) : elle ne s''écrit que par associer_paiements_assurance_maladie (jd.associations_assurance_maladie) ou par la restauration du super-administrateur (42501), tient son paiement et son mouvement dans son dossier (23514), jamais ne se modifie (23514), ne part que par sa fonction, avec son mouvement ou avec son dossier (23514).';

create trigger paiements_assurance_maladie_mouvements_garde
  before insert or update or delete on public.paiements_assurance_maladie_mouvements
  for each row execute function public.garder_paiements_assurance_maladie_mouvements();

-- ══ 1 ter. Le retrait d'un import associé ══════════
-- Avant la suppression d'un import, aux droits de l'appelant (la fonction du retrait : son propriétaire, qui lit tout). La
-- suppression d'un dossier passe : le dossier n'est déjà plus là quand sa cascade atteint l'import.
create function public.retenir_import_associe() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.dossiers d where d.id = old.dossier_id)
     and exists (select 1 from public.paiements_assurance_maladie_mouvements a
                   join public.paiements_assurance_maladie p on p.id = a.paiement_id
                  where p.import_id = old.id) then
    raise exception 'Un paiement de cet import est associé à un crédit du relevé : le cabinet défait d''abord cette association.'
      using errcode = '22023';
  end if;
  return old;
end
$$;

comment on function public.retenir_import_associe() is
  'Retient le retrait d''un import des paiements de l''assurance maladie dont un paiement est associé à un mouvement du relevé (NOE5, 22023), sauf avec son dossier.';

create trigger imports_assurance_maladie_associes
  before delete on public.imports_assurance_maladie
  for each row execute function public.retenir_import_associe();

-- ══ 2. Associer ══════════
-- D'UN SEUL TENANT, sous le verrou des paiements du dossier (l'import et le retrait le prennent aussi : un import ne se
-- retire pas pendant qu'on associe ses paiements). Chaque test lit ce qu'un test d'avant a établi : un IF par étape. Les
-- mouvements se lisent sous un verrou partagé (une fonction du relevé ne les reclasse pas entre le jugement et l'écriture).
create function public.associer_paiements_assurance_maladie(p_dossier_id uuid, p_paiements uuid[], p_lignes uuid[])
  returns setof public.paiements_assurance_maladie_mouvements
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  c_forme constant text := 'L''association est mal formée : autant de paiements que de mouvements, chaque paiement une fois, de 1 à 1 000.';
  v_date date;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('paiements_assurance_maladie:' || p_dossier_id::text, 0));

  -- 1. La forme : deux listes à une dimension, de même longueur, de 1 à 1 000 paires, sans vide, chaque paiement une fois.
  if p_paiements is null or p_lignes is null or array_ndims(p_paiements) is distinct from 1 or array_ndims(p_lignes) is distinct from 1 then
    raise exception '%', c_forme using errcode = '22023';
  end if;
  if cardinality(p_paiements) not between 1 and 1000 or cardinality(p_lignes) <> cardinality(p_paiements) then
    raise exception '%', c_forme using errcode = '22023';
  end if;
  if array_position(p_paiements, null) is not null or array_position(p_lignes, null) is not null then
    raise exception '%', c_forme using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_paiements) x) <> cardinality(p_paiements) then
    raise exception '%', c_forme using errcode = '22023';
  end if;

  -- 2. Les mouvements, puis les paiements, du dossier ; les mouvements sous un verrou partagé.
  if exists (select 1 from unnest(p_lignes) x
              where not exists (select 1 from public.lignes_bancaires l where l.id = x and l.dossier_id = p_dossier_id)) then
    raise exception 'Un mouvement de l''association n''est pas un mouvement de ce dossier.' using errcode = '22023';
  end if;
  perform 1 from public.lignes_bancaires l where l.id = any (p_lignes) order by l.id for share;
  if exists (select 1 from unnest(p_paiements) x
              where not exists (select 1 from public.paiements_assurance_maladie p where p.id = x and p.dossier_id = p_dossier_id)) then
    raise exception 'Un paiement de l''association n''est pas un paiement de l''assurance maladie de ce dossier.' using errcode = '22023';
  end if;

  -- 3. Un mouvement d'un exercice validé ; écarté ou personnel ; retenu par la règle G2.
  if exists (select 1 from public.lignes_bancaires l
               join public.exercices_valides x on x.dossier_id = l.dossier_id and x.annee = extract(year from l.date)::integer
              where l.id = any (p_lignes)) then
    raise exception 'Un mouvement de l''association tombe dans un exercice que le cabinet a validé : il ne s''associe plus.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.lignes_bancaires l where l.id = any (p_lignes) and (l.statut = 'ignoree' or l.prelevement_personnel)) then
    raise exception 'Un mouvement écarté ou classé en virement personnel ne justifie pas un paiement de l''assurance maladie.'
      using errcode = '23514';
  end if;
  if exists (select 1 from public.lignes_bancaires l
              where l.id = any (p_lignes)
                and (l.encaissements_de_factures
                     or exists (select 1 from public.encaissements_factures e
                                  join public.factures_emises f on f.id = e.facture_id
                                 where e.ligne_bancaire_id = l.id and e.retire_le is null and f.source_de_la_vente
                                   and public.encaissement_justifie_son_mouvement(e.id)))) then
    raise exception 'Un mouvement classé ou réservé par des encaissements de factures ne s''associe pas à un paiement de l''assurance maladie.'
      using errcode = '23514';
  end if;

  -- 4. Déjà associés : un paiement, puis un mouvement.
  if exists (select 1 from public.paiements_assurance_maladie_mouvements a where a.paiement_id = any (p_paiements)) then
    raise exception 'Un paiement de l''association est déjà associé à un mouvement : défaire d''abord cette association.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.paiements_assurance_maladie_mouvements a where a.ligne_bancaire_id = any (p_lignes)) then
    raise exception 'Un mouvement de l''association est déjà associé à des paiements de l''assurance maladie : défaire d''abord son association.'
      using errcode = '22023';
  end if;

  -- 5. La somme : les paiements de chaque mouvement font son montant au centime (en entiers exacts) ; le premier mouvement
  -- fautif, dans l'ordre des dates, nommé par sa date.
  select l.date into v_date
    from (select x.ligne, sum(p.montant_centimes) as somme
            from unnest(p_paiements, p_lignes) as x(paiement, ligne)
            join public.paiements_assurance_maladie p on p.id = x.paiement
           group by x.ligne) g
    join public.lignes_bancaires l on l.id = g.ligne
   where g.somme <> l.montant * 100
   order by l.date, l.id
   limit 1;
  if found then
    raise exception 'Les paiements associés au mouvement du % ne font pas son montant au centime.', to_char(v_date, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;

  perform set_config('jd.associations_assurance_maladie', p_dossier_id::text, true);
  return query
    insert into public.paiements_assurance_maladie_mouvements (dossier_id, paiement_id, ligne_bancaire_id, associe_par)
    select p_dossier_id, x.paiement, x.ligne, auth.uid()
      from unnest(p_paiements, p_lignes) as x(paiement, ligne)
    returning *;
  perform set_config('jd.associations_assurance_maladie', '', true);
end;
$$;

comment on function public.associer_paiements_assurance_maladie(uuid, uuid[], uuid[]) is
  'Associe des paiements de l''assurance maladie aux mouvements du relevé qui les versent (NOE5), tout ou rien : le i-ème paiement au i-ème mouvement ; chaque mouvement reçoit un groupe dont la somme fait son montant au centime ; ni un exercice validé, ni un mouvement écarté, personnel ou retenu par la règle G2, ni un paiement ou un mouvement déjà associé. Au cabinet du dossier seul (42501) ; rend les associations écrites.';

-- ══ 3. Défaire ══════════
create function public.defaire_association_assurance_maladie(p_dossier_id uuid, p_ligne_bancaire_id uuid)
  returns setof public.paiements_assurance_maladie_mouvements
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('paiements_assurance_maladie:' || p_dossier_id::text, 0));
  if not exists (select 1 from public.paiements_assurance_maladie_mouvements a
                  where a.dossier_id = p_dossier_id and a.ligne_bancaire_id = p_ligne_bancaire_id) then
    raise exception 'Ce mouvement n''est associé à aucun paiement de l''assurance maladie.' using errcode = '22023';
  end if;
  if exists (select 1 from public.lignes_bancaires l
               join public.exercices_valides x on x.dossier_id = l.dossier_id and x.annee = extract(year from l.date)::integer
              where l.id = p_ligne_bancaire_id) then
    raise exception 'Ce mouvement tombe dans un exercice que le cabinet a validé : son association ne se défait plus.'
      using errcode = '22023';
  end if;
  perform set_config('jd.associations_assurance_maladie', p_dossier_id::text, true);
  return query
    delete from public.paiements_assurance_maladie_mouvements a
     where a.dossier_id = p_dossier_id and a.ligne_bancaire_id = p_ligne_bancaire_id
    returning a.*;
  perform set_config('jd.associations_assurance_maladie', '', true);
end;
$$;

comment on function public.defaire_association_assurance_maladie(uuid, uuid) is
  'Défait l''association d''un mouvement du relevé à ses paiements de l''assurance maladie (NOE5), le groupe entier, hors des exercices validés. Au cabinet du dossier seul (42501) ; rend les associations défaites.';

-- ══ 4. Les droits d'exécution ══════════
revoke execute on function public.associer_paiements_assurance_maladie(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.associer_paiements_assurance_maladie(uuid, uuid[], uuid[]) to authenticated;
revoke execute on function public.defaire_association_assurance_maladie(uuid, uuid) from public, anon;
grant execute on function public.defaire_association_assurance_maladie(uuid, uuid) to authenticated;
revoke execute on function public.garder_paiements_assurance_maladie_mouvements() from public, anon, authenticated;
revoke execute on function public.retenir_import_associe() from public, anon, authenticated;

-- ══ 5. La double authentification exigée (C7, second temps), si elle est déjà en base ══════════
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.paiements_assurance_maladie_mouvements as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;

-- ══ 6. La garde de fin ══════════
do $fin$
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.paiements_assurance_maladie_mouvements'::regclass) then
    raise exception 'La table des associations n''a pas sa RLS.';
  end if;
  if (select count(*) from pg_policy p where p.polrelid = 'public.paiements_assurance_maladie_mouvements'::regclass and p.polpermissive
        and p.polroles = array[to_regrole('authenticated')::oid]) <> 3
     or (select count(*) from pg_policy p where p.polrelid = 'public.paiements_assurance_maladie_mouvements'::regclass and p.polpermissive) <> 3
     or exists (select 1 from pg_policy p where p.polrelid = 'public.paiements_assurance_maladie_mouvements'::regclass and p.polpermissive
                 and p.polcmd not in ('r', 'a')) then
    raise exception 'La table des associations ne porte pas ses trois policies permissives (deux lectures, l''insertion de restauration) à authenticated seul.';
  end if;
  if exists (select 1 from pg_attribute a
              where a.attrelid = 'public.paiements_assurance_maladie_mouvements'::regclass and a.attnum > 0 and not a.attisdropped
                and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'json'::regtype, 'jsonb'::regtype)) then
    raise exception 'La table des associations porte une colonne de texte.';
  end if;
  if (select count(*) from pg_proc p
       where p.oid in ('public.associer_paiements_assurance_maladie(uuid, uuid[], uuid[])'::regprocedure,
                       'public.defaire_association_assurance_maladie(uuid, uuid)'::regprocedure)
         and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
         and not has_function_privilege('anon', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) <> 2 then
    raise exception 'Les droits d''exécution des fonctions de l''association ne sont pas ceux que la migration pose.';
  end if;
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.paiements_assurance_maladie_mouvements'::regclass and not t.tgisinternal
         and t.tgfoid = 'public.garder_paiements_assurance_maladie_mouvements()'::regprocedure and t.tgtype = 31) <> 1
     or (select count(*) from pg_trigger t
          where t.tgrelid = 'public.imports_assurance_maladie'::regclass and not t.tgisinternal
            and t.tgfoid = 'public.retenir_import_associe()'::regprocedure and t.tgtype = 11) <> 1
     or has_function_privilege('authenticated', 'public.garder_paiements_assurance_maladie_mouvements()', 'execute')
     or has_function_privilege('authenticated', 'public.retenir_import_associe()', 'execute') then
    raise exception 'Une garde de l''association manque, ou un connecté l''exécute.';
  end if;
  if (select c.confdeltype from pg_constraint c
       where c.conrelid = 'public.paiements_assurance_maladie_mouvements'::regclass and c.contype = 'f'
         and c.confrelid = 'public.paiements_assurance_maladie'::regclass) is distinct from 'a' then
    raise exception 'La clé vers le paiement ne retient plus le retrait de son import.';
  end if;
  if exists (select 1 from public.paiements_assurance_maladie_mouvements) then
    raise exception 'La table des associations porte une ligne : rien ne s''écrit d''avance.';
  end if;
end
$fin$;
