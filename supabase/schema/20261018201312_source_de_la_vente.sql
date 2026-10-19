-- LA SOURCE DE LA VENTE, EN BASE : LE RÉGLAGE, LA SOURCE ET LA VALIDATION (chantier EC-Q3, ligne 28.6, étape VF2 ; la
-- première des deux migrations de l'étape, la seconde étant `encaissements_de_la_vente_facturee`). Conception :
-- HISTORIQUE.md, « LA FACTURE VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », § 5, 9, 11, 12, 13 et 14. Décision du
-- cabinet du 18/10/2026 (EC-Q3) : une facture validée dans l'application devient la source de sa vente ; les questions
-- EC3-Q1 à Q12 sont bâties sur leurs recommandations, non tranchées.
--
-- CE QUI NAÎT ICI, ET RIEN D'AUTRE :
--   1. LE RÉGLAGE DU DOSSIER, `dossiers.ventes_par_les_factures`, faux partout : ses factures sont-elles la source de
--      leurs ventes ? Le cabinet le pose (la mise à jour d'un dossier lui est réservée par sa policy, MEG1-Q14) ; aucun
--      écran ne le fait avant l'étape VF8. Il est IRRÉVERSIBLE dès qu'une facture source existe (EC3-Q1) : la garde
--      `garder_ventes_par_les_factures` refuse alors de le baisser. Avant la première, il se baisse encore.
--   2. LA SOURCE DE LA VENTE, `factures_emises.source_de_la_vente`, FIXÉE À LA VALIDATION par le déclencheur
--      `fixer_source_de_la_vente`, puis figée avec la facture par la garde du 07/10/2026 (`garder_factures_validees`
--      compare la ligne entière d'une facture validée). Une facture prend le réglage de son dossier au moment où elle se
--      valide ; un avoir prend la source de la facture qu'il corrige. Aucune rétroactivité : les factures validées avant
--      restent comptées par leurs pièces (§ 9). Personne ne la pose : un brouillon ne la porte jamais (une contrainte),
--      et la poser à la main se refuse.
--   3. LES REFUS DE LA VALIDATION d'une facture source, dans cet ordre, sous le code des déclencheurs (23514) — ils
--      remontent d'`enregistrer_facture`, qui valide :
--        1. la nature de ses opérations, biens ou services, qu'elle ne dit pas (§ 5 : l'exigibilité de la TVA et le
--           compte, 706 ou 707, en dépendent) ;
--        2. une facture MIXTE, biens et services (EC3-Q8 : tant que l'étape A7 ne fige pas la nature de chaque ligne,
--           elle se scinde en deux factures) ;
--        3. une date d'émission que la frontière d'un exercice validé fige (§ 11) — le message de `exercice_fige`.
--      Un avoir source a la nature de sa facture, recopiée par `enregistrer_facture` : seule la frontière peut le
--      refuser.
--   4. LES DEUX COLONNES DES ÉCRITURES D'UNE VENTE FACTURÉE, `ecritures_brouillon.encaissement_id` et `facture_id`
--      (étape VF4), sans action à la suppression : un encaissement ne disparaît qu'avec son dossier, une facture validée
--      aussi. Elles naissent FERMÉES : la garde `garder_ecriture_vente_facturee` ne les laisse poser que sous le réglage
--      `jd.ecriture_vente_facturee`, que posera la fonction de l'étape VF4 POUR LA SOURCE qu'elle écrit (l'encaissement,
--      sinon la facture), ou par la restauration du super-administrateur. Rien ne les écrit avant VF4.
--   5. SIX RÔLES DE PLUS AU CATALOGUE DU PLAN COMPTABLE (§ 12) : `prestations_de_services` (706), `ventes_de_biens`
--      (701, 707), `tva_collectee_en_attente` (44580, 44574 : EC3-Q6 recommande le 445800), `valeurs_a_l_encaissement`
--      (511), `caisse` (53), `services_bancaires` (627) — les intitulés de la nomenclature du plan comptable général
--      consolidé au 1er janvier 2026 (règlement ANC n° 2014-03 : classes 4, 5, 6 et 7). Les racines 4457 et 4458
--      qu'évoquait la conception commenceraient celles de deux rôles du catalogue, 44571 (la TVA collectée) et 44583 (le
--      remboursement demandé) : aucune racine du catalogue n'en commence une autre, sans quoi deux rôles d'un plan
--      partageraient un compte (src/lib/planComptable.test.ts). 44580 tient le 445800 recommandé — un compte
--      divisionnaire du 4458 que la nomenclature ne numérote pas (art. 1131-1) — ; 44574, qu'elle ne porte pas non plus,
--      le 445740 des cabinets qui le tiennent (EC3-Q6, seconde réponse). Aucun plan de dossier n'est réglé, et la lecture
--      du plan ignore un rôle que l'application ne connaît pas : sans effet.
--
-- NEUTRE : aucun dossier ne bascule — le réglage est faux partout, et sans lui aucune facture n'est source ; tant
-- qu'il n'est pas posé, toute écriture qui passait passe encore, au même résultat : la validation d'une facture
-- d'un dossier qui n'a pas basculé ne lit rien de plus que son réglage, et ne refuse rien de plus. Rien de ce qui se
-- compte ne change : aucun moteur ne lit la source avant l'étape VF3. Aucune policy nouvelle ni changée. Aucune donnée
-- lue, écrite ni retirée, hors des six lignes du catalogue. Le texte ne porte aucune instruction de suppression.
--
-- CE QUI CONTOURNE LA RLS, ET POURQUOI : la garde du réglage et le déclencheur de la validation lisent les factures, le
-- réglage et les exercices validés du dossier quoi qu'en voie l'appelant (`security definer`, chemin fixé), comme la
-- garde des factures validées ; personne ne les appelle en RPC. La garde des écritures s'exécute aux droits de
-- l'appelant : elle ne lit rien.
--
-- CONCURRENCE : la validation d'une facture lit le réglage de son dossier `for share` — un réglage baissé pendant
-- qu'une facture se valide attend la fin de la validation, puis voit la facture source et se refuse ; une validation
-- qui suit le réglage baissé le lit baissé. La frontière se lit sous le verrou PARTAGÉ de la validation des exercices
-- (`cle_validation`), comme toute source qu'un exercice validé fige.

-- ══ 1. Le réglage du dossier ══════════

alter table public.dossiers add column ventes_par_les_factures boolean not null default false;

comment on column public.dossiers.ventes_par_les_factures is
  'Les factures validées de ce dossier sont-elles la source de leurs ventes (chantier EC-Q3) ? Faux par défaut ; posé par le cabinet ; irréversible dès qu''une facture source existe (garder_ventes_par_les_factures). Chaque facture fige à sa validation ce qu''il valait (factures_emises.source_de_la_vente).';

create function public.garder_ventes_par_les_factures() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
begin
  if old.ventes_par_les_factures and not new.ventes_par_les_factures then
    -- La première facture source validée : une facture avant son avoir, qu'une même transaction validerait au même
    -- instant.
    select f.numero into v_numero from public.factures_emises f
     where f.dossier_id = old.id and f.source_de_la_vente
     order by f.validated_at, f.type = 'avoir', f.numero collate "C", f.id
     limit 1;
    if found then
      raise exception 'Les factures de ce dossier sont la source de leurs ventes depuis la facture % : ce réglage ne se défait pas.', v_numero
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger dossiers_ventes_par_les_factures
  before update of ventes_par_les_factures on public.dossiers
  for each row execute function public.garder_ventes_par_les_factures();

-- ══ 2. La source de la vente, fixée à la validation ══════════

alter table public.factures_emises add column source_de_la_vente boolean not null default false;
alter table public.factures_emises add constraint factures_emises_source_d_une_facture_validee
  check (not source_de_la_vente or statut = 'validee');

comment on column public.factures_emises.source_de_la_vente is
  'La facture validée est la source de sa vente (chantier EC-Q3) : fixée à sa validation par fixer_source_de_la_vente — le réglage de son dossier, ou pour un avoir la source de sa facture —, puis figée avec elle (garder_factures_validees). Faux pour un brouillon, et pour toute facture validée avant que son dossier ne bascule.';

-- Le déclencheur de la validation. Il passe APRÈS la garde des factures validées (`factures_emises_figees`, que l'ordre
-- des noms fait passer d'abord) : elle a déjà vérifié qu'une validation vient d'`enregistrer_facture`, et elle seule ; une
-- facture validée qu'on modifie ensuite, elle la refuse, source comprise. La restauration — la seule porte qui insère
-- une facture validée — réinsère la source telle qu'elle a été figée, dans un dossier qui a basculé seulement.
create function public.fixer_source_de_la_vente() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source boolean;
  v_frontiere date;
begin
  if tg_op = 'INSERT' and new.statut = 'validee' then
    if new.source_de_la_vente
       and not coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = new.dossier_id), false) then
      raise exception 'Une facture n''est la source de sa vente que dans un dossier dont les factures sont la source de leurs ventes.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.statut = 'validee' then
    return new;
  end if;
  if new.statut <> 'validee' then
    if new.source_de_la_vente then
      raise exception 'La source de la vente se fixe à la validation de la facture : elle ne se pose pas.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- La validation : le réglage du dossier pour une facture, la source de sa facture pour un avoir.
  if new.type = 'avoir' then
    select f.source_de_la_vente into v_source from public.factures_emises f where f.id = new.facture_origine_id;
  else
    select d.ventes_par_les_factures into v_source from public.dossiers d where d.id = new.dossier_id for share;
  end if;
  new.source_de_la_vente := coalesce(v_source, false);
  if not new.source_de_la_vente then
    return new;
  end if;
  if new.nature_operation is null then
    raise exception 'Dans un dossier dont les factures sont la source de leurs ventes, une facture dit si elle porte sur des biens ou sur des services : la nature de ses opérations est à renseigner avant sa validation.'
      using errcode = '23514';
  end if;
  if new.nature_operation = 'mixte' then
    raise exception 'Dans un dossier dont les factures sont la source de leurs ventes, une facture qui mêle biens et services ne se valide pas encore : elle se scinde en deux factures, l''une de biens, l''autre de services, tant que ses lignes ne disent pas leur nature.'
      using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_frontiere := public.frontiere_validation(new.dossier_id);
  if v_frontiere is not null and new.date_emission <= v_frontiere then
    raise exception '% : une facture source de sa vente, ou son avoir, ne s''y valide plus.',
      public.exercice_fige(new.dossier_id, extract(year from new.date_emission)::integer) using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger factures_emises_source_de_la_vente
  before insert or update on public.factures_emises
  for each row execute function public.fixer_source_de_la_vente();

-- ══ 3. Les colonnes des écritures d'une vente facturée (étape VF4), fermées d'ici là ══════════

alter table public.ecritures_brouillon
  add column encaissement_id uuid references public.encaissements_factures (id),
  add column facture_id uuid references public.factures_emises (id);

create index ecritures_brouillon_encaissement_id_idx on public.ecritures_brouillon (encaissement_id)
  where encaissement_id is not null;
create index ecritures_brouillon_facture_id_idx on public.ecritures_brouillon (facture_id)
  where facture_id is not null;

comment on column public.ecritures_brouillon.encaissement_id is
  'L''encaissement d''une facture source de sa vente que l''écriture porte (étape VF4) : écrite par la seule fonction de la vente facturée, sous le réglage jd.ecriture_vente_facturee, ou par la restauration (garder_ecriture_vente_facturee). Sans action à la suppression : un encaissement ne disparaît qu''avec son dossier.';
comment on column public.ecritures_brouillon.facture_id is
  'La facture source de sa vente (ou son avoir) que l''écriture porte (étape VF4) : écrite comme encaissement_id. Sans action à la suppression : une facture validée ne disparaît qu''avec son dossier.';

create function public.garder_ecriture_vente_facturee() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (new.encaissement_id is not null or new.facture_id is not null) and not public.is_super_admin()
       and coalesce(current_setting('jd.ecriture_vente_facturee', true), '')
           is distinct from coalesce(new.encaissement_id, new.facture_id)::text then
      raise exception 'Une écriture ne porte une facture ou un encaissement que par la fonction qui écrit la vente facturée.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.encaissement_id, new.facture_id) is distinct from (old.encaissement_id, old.facture_id)
     and coalesce(current_setting('jd.ecriture_vente_facturee', true), '')
         is distinct from coalesce(new.encaissement_id, new.facture_id, old.encaissement_id, old.facture_id)::text then
    raise exception 'Une écriture ne porte une facture ou un encaissement que par la fonction qui écrit la vente facturée.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger ecritures_brouillon_vente_facturee
  before insert or update of encaissement_id, facture_id on public.ecritures_brouillon
  for each row execute function public.garder_ecriture_vente_facturee();

-- ══ 4. Six rôles de plus au catalogue du plan comptable ══════════

insert into public.roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre) values
  ('prestations_de_services', '{706}', '706000', 'Prestations de services', null, 270),
  ('ventes_de_biens', '{701,707}', '707000', 'Ventes de marchandises', null, 280),
  ('tva_collectee_en_attente', '{44580,44574}', '445800', 'Taxes sur le chiffre d''affaires à régulariser ou en attente', null, 290),
  ('valeurs_a_l_encaissement', '{511}', '511000', 'Valeurs à l''encaissement', null, 300),
  ('caisse', '{53}', '530000', 'Caisse', null, 310),
  ('services_bancaires', '{627}', '627000', 'Services bancaires et assimilés', null, 320);

-- ══ 5. Les droits d'exécution ══════════
-- Trois déclencheurs : personne ne les appelle en RPC.
revoke execute on function public.garder_ventes_par_les_factures() from public, anon, authenticated;
revoke execute on function public.fixer_source_de_la_vente() from public, anon, authenticated;
revoke execute on function public.garder_ecriture_vente_facturee() from public, anon, authenticated;

comment on function public.garder_ventes_par_les_factures() is
  'Le réglage ventes_par_les_factures ne se baisse plus dès qu''une facture source de sa vente existe dans le dossier (EC3-Q1).';
comment on function public.fixer_source_de_la_vente() is
  'Fixe à la validation la source de la vente d''une facture (le réglage de son dossier ; pour un avoir, la source de sa facture) et refuse, pour une facture source, la nature absente, la facture mixte et la date que la frontière d''un exercice validé fige.';
comment on function public.garder_ecriture_vente_facturee() is
  'Une écriture ne porte encaissement_id ou facture_id que sous le réglage jd.ecriture_vente_facturee posé pour sa source (étape VF4), ou par la restauration du super-administrateur.';
