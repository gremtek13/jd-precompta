-- LES OPTIONS PAR CABINET : LES MODULES QUE LE SUPER-ADMINISTRATEUR OUVRE OU FERME (conception 56, lot OPT1 ; la demande du
-- cabinet du 17/11/2026, « que je puisse choisir quelle option a chaque cabinet », ses réponses OPT-Q1 à OPT-Q7 du même jour,
-- et sa recherche du 19/11/2026 : où régler « précomptabilité seule » ou « comptabilité complète ») — PRÉPARÉE le
-- 19/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 19/11/2026 — OPT1 ET OPT2 : LES OPTIONS PAR CABINET, LE MODULE ET LA
-- MIGRATION (PRÉPARÉE, PAS APPLIQUÉE) » ; la conception : docs/conceptions/56-options-par-cabinet.md ; l'essai :
-- supabase/essais/optionsDesCabinets.sql (et, sur une réplique seulement, optionsDesCabinetsEnCours.sql) ; le bloc OC de
-- supabase/essais/rls.sql ; le retour : supabase/preparees/retour/20261119130100_retour_options_des_cabinets.sql ; le module
-- qui redit ses refus et ses libellés : src/lib/modulesDuCabinet.ts (`OPTIONS_DES_CABINETS_PREVUES`).
--
-- LA RÈGLE. L'application se découpe en un SOCLE toujours ouvert (la précomptabilité : les pièces, la banque, la caisse, le
-- brouillon et son FEC, OPT-Q4 (A)) et HUIT MODULES qu'un cabinet a ou n'a pas : la tenue et les déclarations, la
-- facturation, la facture électronique, les paiements de l'assurance maladie, l'espace client de gestion, l'assistant, les
-- honoraires du cabinet, la connexion bancaire. Le super-administrateur les règle, cabinet par cabinet ; le cabinet lit les
-- siens, ne les écrit pas. UNE OPTION N'EST PAS UNE FRONTIÈRE DE CONFIDENTIALITÉ (§ 3.1) : elle ne change pas qui lit quelles
-- données, ni aucun chiffre ; les écrans (OPT3) et les Edge Functions (OPT5) la jugent, et la base ne refusera, plus tard,
-- que l'entrée dans la tenue (OPT6, OPT-Q1 (A)). Aucune lecture n'est refusée ici.
--
-- CE QU'ELLE POSE.
--   1. `options_des_cabinets` : une ligne par cabinet et par module (la liste fermée), ouverte ou fermée, qui l'a changée et
--      quand — posés par la fonction de réglage. UNE LIGNE ABSENTE EST UN MODULE FERMÉ : un cabinet créé après la migration
--      n'a que le socle, le super-administrateur coche le reste (OPT-Q3 (B)). Clé primaire (cabinet, module), totale ; la
--      ligne part avec son cabinet (la suppression d'un cabinet n'a rien à apprendre). Une table à part, pas une colonne de
--      `cabinets` : la policy `cabinets_update` ouvre au chef TOUTES les colonnes de sa ligne (§ 2.1).
--   2. Les lignes des cabinets EXISTANTS : les huit modules ouverts, sans auteur — rien ne change le jour de l'application
--      (OPT-Q3 : « les cabinets existants gardent tout ouvert »).
--   3. `regler_option_du_cabinet(cabinet, module, ouverte)`, aux droits du propriétaire, au SUPER-ADMINISTRATEUR SEUL, vérifié
--      avant toute lecture : ouvrir un module ouvre ce qu'il suppose (les honoraires du cabinet supposent la facturation) ;
--      fermer un module se refuse tant qu'un module ouvert le suppose, puis tant qu'un dossier du cabinet en dépend
--      (l'extinction gardée, OPT-Q2 (A), liste fermée : la facturation d'un dossier basculé ; la facture électronique d'un
--      envoi parti vers une plateforme sans issue connue ; les paiements de l'assurance maladie associés à un crédit, quand
--      la table de NOE5 est en base) — la phrase nomme les dossiers. Elle rend les modules ouverts du cabinet après le
--      réglage. Une ligne qui ne change pas garde son auteur et sa date.
--   4. `modules_ouverts_du_dossier(dossier)`, aux droits du propriétaire, au cabinet du dossier (`admin_du_dossier`) et à
--      chacun de ses accès client (`client_du_dossier(…, 'membre')`) : les modules ouverts du cabinet du dossier, dans
--      l'ordre de la liste fermée — ce que l'écran du client et les Edge Functions liront ; la table reste fermée au client.
--   5. La policy de lecture, à `authenticated` : l'équipe du cabinet (`admin_du_cabinet`, qui comprend le
--      super-administrateur). Aucune policy d'écriture : seule la fonction écrit.
--   6. LA GARDE DES PLAFONDS DE L'ASSISTANT (OPT-Q7 (A), § 2.6, VÉRIFIÉ SUR UNE RÉPLIQUE ÉGALE À LA PRODUCTION LE 19/11/2026 :
--      la policy `cabinets_update`, `est_chef_du_cabinet(id)` en lecture et en écriture, sans garde sur ces colonnes — le chef
--      levait son propre plafond de blocage par l'API) : `garder_plafonds_de_l_assistant`, avant l'insertion et la mise à
--      jour de `cabinets`, AUX DROITS DE L'APPELANT, refuse (42501) tout changement de `limite_ia_alerte_usd` ou de
--      `limite_ia_blocage_usd` à qui la RLS s'applique et qui n'est pas le super-administrateur. Hors de la RLS — le
--      propriétaire, le rôle des Edge Functions (`create-cabinet`), une fonction security definer — rien ne se juge ici,
--      comme la porte `_acces_avant_les_gardes`, qui couvre déjà `cabinets` et passe avant elle (l'ordre des noms).
--      Additive : aucune colonne ne bouge, l'écran du super-administrateur écrit comme hier.
--   7. La restrictive `deux_facteurs` de la double authentification, si sa migration est déjà en base (sinon, sa boucle la
--      posera) : les deux se collent dans les deux ordres.
--
-- LES REFUS, DANS L'ORDRE (que src/lib/modulesDuCabinet.ts redit, sous les mêmes mots) :
--   - au réglage : l'appelant qui n'est pas le super-administrateur (42501) ; un module hors de la liste, un sens nul, un
--     cabinet inconnu (22023) ; puis, sous un verrou du cabinet, à la fermeture : un module ouvert qui le suppose (P0001) ;
--     un dossier qui en dépend (P0001, les dossiers nommés, cinq au plus, les autres comptés) ;
--   - à la lecture : l'appelant qui n'est ni du cabinet du dossier ni l'un de ses accès client, ou un dossier inconnu
--     (42501, sous les mêmes mots : rien n'apprend qu'il existe) ;
--   - aux plafonds : le chef, ou tout autre que le super-administrateur sous la RLS (42501).
--
-- CE QU'ELLE NE CHANGE PAS : aucune fonction d'hier n'est remplacée (`is_super_admin`, `admin_du_cabinet`,
-- `admin_du_dossier`, `client_du_dossier` sont appelées, jamais réécrites) ; ni `cabinets` (une garde de plus, aucune
-- colonne), ni `memberships`, ni aucun moteur : une option ne change jamais un chiffre. Elle se colle avant ou après
-- `trois_cases_de_l_acces` (B1, qui réécrit `client_du_dossier` : la garde de tête n'en exige que la lecture de « membre »,
-- que ses deux corps font), `deux_facteurs_exiges` et l'association de NOE5. Aucun des mots qui retiennent l'outil
-- d'application, pas même en commentaire : elle passe par `apply_migration`.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `OPTIONS_DES_CABINETS_PREVUES` (src/lib/modulesDuCabinet.ts) se
-- lève alors, et la table entre au plan de sauvegarde, hors de l'export d'un dossier. Ni barre oblique inverse, ni retour
-- chariot.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une fonction appelée qui ne serait plus celle que cette migration suppose — à
-- l'empreinte de son corps, les retours chariot d'un collage écartés ; un `client_du_dossier` qui ne lirait plus « membre » ;
-- et une base où manquerait une colonne qu'elle lit.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.options_des_cabinets') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('regler_option_du_cabinet', 'modules_ouverts_du_dossier', 'garder_plafonds_de_l_assistant'))
     or exists (select 1 from pg_trigger t where t.tgrelid = 'public.cabinets'::regclass and t.tgname = 'cabinets_plafonds_de_l_assistant') then
    raise exception 'La migration options_des_cabinets est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_cabinet', 'public.admin_du_cabinet(uuid)', '9e3218c1a32719441078f0c354493507'),
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4')
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
               'when ''membre'' then true') = 0 then
    raise exception 'La fonction public.client_du_dossier(uuid,text) ne lit plus « membre » : la relire avant d''appliquer cette migration.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped
     and ((a.attrelid = 'public.cabinets'::regclass and a.attname in ('id', 'limite_ia_alerte_usd', 'limite_ia_blocage_usd'))
       or (a.attrelid = 'public.dossiers'::regclass and a.attname in ('id', 'cabinet_id', 'nom', 'ventes_par_les_factures'))
       or (a.attrelid = 'public.transmissions_factures'::regclass and a.attname in ('dossier_id', 'etat'))
       or (a.attrelid = 'public.transmissions_encaissements'::regclass and a.attname in ('dossier_id', 'etat')));
  if v_nombre <> 11 then
    raise exception 'Une colonne que cette migration lit manque (% sur 11) : appliquer d''abord les migrations des plafonds de l''assistant, de la source de la vente et des transmissions.', v_nombre;
  end if;
end
$garde$;

-- ══ 1. La table ══════════
-- L'auteur sans clé étrangère vers son compte : retirer le compte d'un super-administrateur parti ne doit pas effacer qui a
-- réglé (le patron de `previsions_publiees.auteur`). Nul pour les lignes que la migration pose.
create table public.options_des_cabinets (
  cabinet_id uuid not null references public.cabinets (id) on delete cascade,
  module text not null,
  ouverte boolean not null,
  changee_par uuid,
  changee_le timestamptz not null default now(),
  constraint options_des_cabinets_pkey primary key (cabinet_id, module),
  constraint options_des_cabinets_module check (module in ('tenue', 'facturation', 'facture_electronique', 'assurance_maladie',
                                                           'espace_client', 'assistant', 'honoraires', 'connexion_bancaire'))
);

comment on table public.options_des_cabinets is
  'Les modules d''un cabinet (conception 56, OPT1) : une ligne par cabinet et par module, ouverte ou fermée ; une ligne absente est un module fermé (un cabinet neuf n''a que le socle, OPT-Q3). Écrite par regler_option_du_cabinet seule, le super-administrateur ; lue par l''équipe du cabinet, et par ses accès client au travers de modules_ouverts_du_dossier. Une option ne change ni qui lit quoi ni aucun chiffre.';
comment on column public.options_des_cabinets.module is
  'Un module de la liste fermée : tenue, facturation, facture_electronique, assurance_maladie, espace_client, assistant, honoraires, connexion_bancaire. Le socle (la précomptabilité) n''y figure pas : il est toujours ouvert.';
comment on column public.options_des_cabinets.changee_par is
  'Le super-administrateur qui a ouvert ou fermé le module (auth.uid()), sans clé étrangère ; nul pour les lignes que la migration a posées.';

alter table public.options_des_cabinets enable row level security;

create policy options_des_cabinets_lecture on public.options_des_cabinets
  for select to authenticated using (admin_du_cabinet(cabinet_id));

-- ══ 2. Les cabinets existants gardent tout ouvert ══════════
insert into public.options_des_cabinets (cabinet_id, module, ouverte, changee_par)
select c.id, m.module, true, null
  from public.cabinets c
 cross join unnest(array['tenue', 'facturation', 'facture_electronique', 'assurance_maladie', 'espace_client', 'assistant',
                         'honoraires', 'connexion_bancaire']) as m(module);

-- ══ 3. Régler une option ══════════
-- Au super-administrateur seul, D'UN SEUL TENANT, sous un verrou du cabinet : deux réglages du même cabinet se suivent, et ce
-- qu'ils jugent (les modules ouverts, les dossiers qui dépendent) ne bouge pas entre-temps. Les modules et leurs libellés,
-- deux listes de même rang ; ce que chaque module suppose, une liste de paires (le module, celui qu'il suppose) parcourue de
-- proche en proche.
create function public.regler_option_du_cabinet(p_cabinet_id uuid, p_module text, p_ouverte boolean)
  returns text[]
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  c_modules constant text[] := array['tenue', 'facturation', 'facture_electronique', 'assurance_maladie', 'espace_client',
                                     'assistant', 'honoraires', 'connexion_bancaire'];
  c_libelles constant text[] := array['Tenue et déclarations', 'Facturation', 'Facture électronique',
                                      'Paiements de l''assurance maladie', 'Espace client de gestion', 'Assistant IA',
                                      'Honoraires du cabinet', 'Connexion bancaire'];
  c_nommes_au_plus constant integer := 5;
  v_retenants text;
  v_raison text;
  v_dossiers text[];
  v_nommes text;
begin
  -- 1. Le super-administrateur seul, avant toute lecture.
  if not public.is_super_admin() then
    raise exception 'Seul le super-administrateur règle les options d''un cabinet.' using errcode = '42501';
  end if;

  -- 2. La demande : un module de la liste, un sens, un cabinet qui existe.
  if p_module is null or not (p_module = any (c_modules)) then
    raise exception 'Ce module n''existe pas : les modules sont tenue, facturation, facture_electronique, assurance_maladie, espace_client, assistant, honoraires et connexion_bancaire.'
      using errcode = '22023';
  end if;
  if p_ouverte is null then
    raise exception 'Dire si le module s''ouvre ou se ferme.' using errcode = '22023';
  end if;
  if p_cabinet_id is null or not exists (select 1 from public.cabinets c where c.id = p_cabinet_id) then
    raise exception 'Ce cabinet n''existe pas.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('options_des_cabinets:' || p_cabinet_id::text, 0));

  if p_ouverte then
    -- 3. Ouvrir : le module et ce qu'il suppose, de proche en proche. Une ligne déjà ouverte garde son auteur et sa date.
    insert into public.options_des_cabinets as o (cabinet_id, module, ouverte, changee_par, changee_le)
    select p_cabinet_id, a.module, true, auth.uid(), now()
      from (with recursive suppose(module, suppose) as (values ('honoraires', 'facturation')),
                 a_ouvrir(module) as (select p_module union select s.suppose from a_ouvrir x join suppose s on s.module = x.module)
            select a_ouvrir.module from a_ouvrir) as a
    on conflict (cabinet_id, module) do update
      set ouverte = true, changee_par = excluded.changee_par, changee_le = excluded.changee_le
      where not o.ouverte;
  else
    -- 4. Fermer : refusé tant qu'un module ouvert le suppose, de proche en proche.
    with recursive suppose(module, suppose) as (values ('honoraires', 'facturation')),
         dependants(module) as (select s.module from suppose s where s.suppose = p_module
                                union select s.module from dependants d join suppose s on s.suppose = d.module)
    select string_agg('« ' || c_libelles[array_position(c_modules, o.module)] || ' »', ', '
                      order by array_position(c_modules, o.module))
      into v_retenants
      from public.options_des_cabinets o
     where o.cabinet_id = p_cabinet_id and o.ouverte and o.module in (select d.module from dependants d);
    if v_retenants is not null then
      raise exception 'Le module « % » ne se ferme pas tant qu''un module qui le suppose est ouvert : %.',
        c_libelles[array_position(c_modules, p_module)], v_retenants;
    end if;

    -- 5. Puis tant qu'un dossier du cabinet en dépend (l'extinction gardée, liste fermée par module). Les dossiers dans
    --    l'ordre de leur nom, puis de leur identifiant ; cinq nommés au plus, les autres comptés.
    v_raison := case p_module
      when 'facturation' then 'les ventes de ces dossiers passent par leurs factures, irréversiblement'
      when 'facture_electronique' then 'une facture ou une déclaration d''encaissement de ces dossiers est partie vers une plateforme sans issue connue'
      when 'assurance_maladie' then 'un paiement de l''assurance maladie de ces dossiers est associé à un crédit du relevé'
    end;
    if p_module = 'facturation' then
      select array_agg(d.nom order by d.nom collate "C", d.id) into v_dossiers
        from public.dossiers d
       where d.cabinet_id = p_cabinet_id and d.ventes_par_les_factures;
    elsif p_module = 'facture_electronique' then
      select array_agg(d.nom order by d.nom collate "C", d.id) into v_dossiers
        from public.dossiers d
       where d.cabinet_id = p_cabinet_id
         and (exists (select 1 from public.transmissions_factures t where t.dossier_id = d.id and t.etat = 'envoi')
              or exists (select 1 from public.transmissions_encaissements t where t.dossier_id = d.id and t.etat = 'envoi'));
    elsif p_module = 'assurance_maladie' and to_regclass('public.paiements_assurance_maladie_mouvements') is not null then
      -- La table de NOE5, préparée : lue par un texte que la base ne prépare qu'ici, une fois la table là.
      execute 'select array_agg(d.nom order by d.nom collate "C", d.id) from public.dossiers d '
           || 'where d.cabinet_id = $1 and exists (select 1 from public.paiements_assurance_maladie_mouvements a where a.dossier_id = d.id)'
        into v_dossiers using p_cabinet_id;
    end if;
    if coalesce(cardinality(v_dossiers), 0) > 0 then
      select string_agg('« ' || n.nom || ' »', ', ' order by n.rang) into v_nommes
        from unnest(v_dossiers[1:c_nommes_au_plus]) with ordinality as n(nom, rang);
      raise exception 'Le module « % » ne se ferme pas : % : %.',
        c_libelles[array_position(c_modules, p_module)], v_raison,
        v_nommes || case when cardinality(v_dossiers) > c_nommes_au_plus
                         then ' et ' || (cardinality(v_dossiers) - c_nommes_au_plus) || ' autre(s)' else '' end;
    end if;

    -- 6. La ligne fermée. Une ligne déjà fermée garde son auteur et sa date.
    insert into public.options_des_cabinets as o (cabinet_id, module, ouverte, changee_par, changee_le)
    values (p_cabinet_id, p_module, false, auth.uid(), now())
    on conflict (cabinet_id, module) do update
      set ouverte = false, changee_par = excluded.changee_par, changee_le = excluded.changee_le
      where o.ouverte;
  end if;

  return array(select o.module from public.options_des_cabinets o
                where o.cabinet_id = p_cabinet_id and o.ouverte
                order by array_position(c_modules, o.module));
end
$$;

comment on function public.regler_option_du_cabinet(uuid, text, boolean) is
  'Ouvre ou ferme un module d''un cabinet (conception 56, OPT1), au super-administrateur seul (42501), d''un seul tenant : ouvrir ouvre ce que le module suppose ; fermer se refuse tant qu''un module ouvert le suppose, puis tant qu''un dossier du cabinet en dépend (la facturation d''un dossier basculé, la facture électronique d''un envoi sans issue connue, l''assurance maladie d''un paiement associé : P0001, les dossiers nommés). Rend les modules ouverts du cabinet après le réglage.';

-- ══ 4. Lire les modules ouverts d'un dossier ══════════
create function public.modules_ouverts_du_dossier(p_dossier_id uuid)
  returns text[]
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  c_modules constant text[] := array['tenue', 'facturation', 'facture_electronique', 'assurance_maladie', 'espace_client',
                                     'assistant', 'honoraires', 'connexion_bancaire'];
begin
  if p_dossier_id is null
     or not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'membre')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  return array(select o.module from public.options_des_cabinets o
                 join public.dossiers d on d.cabinet_id = o.cabinet_id
                where d.id = p_dossier_id and o.ouverte
                order by array_position(c_modules, o.module));
end
$$;

comment on function public.modules_ouverts_du_dossier(uuid) is
  'Les modules ouverts du cabinet d''un dossier (conception 56, OPT1), dans l''ordre de la liste fermée ; vide, le socle seul. Au cabinet du dossier et à chacun de ses accès client (42501, aussi pour un dossier inconnu) : ce que l''écran du client et les Edge Functions lisent.';

-- ══ 5. La garde des plafonds de l'assistant (OPT-Q7 (A)) ══════════
-- Avant la RLS, aux droits de l'appelant ; chaque branche lit NEW, et OLD à la mise à jour seulement. Une écriture qui ne
-- change aucun des deux plafonds passe (la charte du cabinet, son nom, son logo, le dossier du cabinet) ; une insertion sans
-- plafond aussi.
create function public.garder_plafonds_de_l_assistant() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.limite_ia_alerte_usd is not distinct from old.limite_ia_alerte_usd
     and new.limite_ia_blocage_usd is not distinct from old.limite_ia_blocage_usd then
    return new;
  end if;
  if tg_op = 'INSERT' and new.limite_ia_alerte_usd is null and new.limite_ia_blocage_usd is null then
    return new;
  end if;
  -- Hors de la RLS (le propriétaire, le rôle des Edge Functions, une fonction security definer), rien ne se juge ici ;
  -- sous elle, le super-administrateur seul.
  if not pg_catalog.row_security_active('public.cabinets'::regclass) or public.is_super_admin() then
    return new;
  end if;
  raise exception 'Les plafonds de l''assistant ne se règlent que par le super-administrateur.' using errcode = '42501';
end
$$;

comment on function public.garder_plafonds_de_l_assistant() is
  'La garde des plafonds de coût de l''assistant d''un cabinet (conception 56, OPT-Q7) : sous la RLS, seul le super-administrateur change limite_ia_alerte_usd ou limite_ia_blocage_usd (42501) ; le chef règle le reste de sa ligne comme hier.';

create trigger cabinets_plafonds_de_l_assistant
  before insert or update on public.cabinets
  for each row execute function public.garder_plafonds_de_l_assistant();

-- ══ 6. Les droits d'exécution ══════════
revoke execute on function public.regler_option_du_cabinet(uuid, text, boolean) from public, anon;
grant execute on function public.regler_option_du_cabinet(uuid, text, boolean) to authenticated;
revoke execute on function public.modules_ouverts_du_dossier(uuid) from public, anon;
grant execute on function public.modules_ouverts_du_dossier(uuid) to authenticated;
revoke execute on function public.garder_plafonds_de_l_assistant() from public, anon, authenticated;

-- ══ 7. La double authentification exigée (C7, second temps), si elle est déjà en base ══════════
-- Appliquée avant `deux_facteurs_exiges`, ce bloc ne fait rien et sa boucle pose la restrictive sur la table ; après, il la
-- pose ici, à l'expression exacte (deuxFacteursDesTablesNeuves.test.ts).
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.options_des_cabinets as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;

-- ══ 8. La garde de fin ══════════
-- Ce que la migration a posé, relu au catalogue : la RLS active et une seule policy permissive, la lecture de l'équipe du
-- cabinet à authenticated ; les deux fonctions de l'API aux droits du propriétaire, le chemin fixé, ni l'anonyme ni PUBLIC ne
-- les exécutent ; la garde des plafonds avant l'insertion et la mise à jour de `cabinets`, aux droits de l'appelant, qu'aucun
-- connecté n'exécute ; et les lignes : huit par cabinet, ouvertes, sans auteur.
do $fin$
declare
  v_lignes bigint;
  v_attendues bigint;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.options_des_cabinets'::regclass) then
    raise exception 'La table options_des_cabinets n''a pas sa RLS.';
  end if;
  if (select count(*) from pg_policy p where p.polrelid = 'public.options_des_cabinets'::regclass and p.polpermissive) <> 1
     or not exists (select 1 from pg_policy p
                     where p.polrelid = 'public.options_des_cabinets'::regclass and p.polpermissive
                       and p.polname = 'options_des_cabinets_lecture' and p.polcmd = 'r'
                       and p.polroles = array[to_regrole('authenticated')::oid]
                       and pg_get_expr(p.polqual, p.polrelid) = 'admin_du_cabinet(cabinet_id)' and p.polwithcheck is null) then
    raise exception 'La table options_des_cabinets ne porte pas sa seule policy permissive : la lecture de l''équipe du cabinet, à authenticated.';
  end if;
  if (select count(*) from pg_proc p
       where p.oid in ('public.regler_option_du_cabinet(uuid, text, boolean)'::regprocedure,
                       'public.modules_ouverts_du_dossier(uuid)'::regprocedure)
         and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
         and not has_function_privilege('anon', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) <> 2 then
    raise exception 'Les droits d''exécution des fonctions des options des cabinets ne sont pas ceux que la migration pose.';
  end if;
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.cabinets'::regclass and not t.tgisinternal
         and t.tgfoid = 'public.garder_plafonds_de_l_assistant()'::regprocedure and t.tgtype = 23) <> 1
     or (select p.prosecdef from pg_proc p where p.oid = 'public.garder_plafonds_de_l_assistant()'::regprocedure)
     or has_function_privilege('authenticated', 'public.garder_plafonds_de_l_assistant()', 'execute') then
    raise exception 'La garde des plafonds de l''assistant manque, n''est pas aux droits de l''appelant, ou un connecté l''exécute.';
  end if;
  select count(*) into v_lignes from public.options_des_cabinets;
  select 8 * count(*) into v_attendues from public.cabinets;
  if v_lignes <> v_attendues
     or exists (select 1 from public.options_des_cabinets o where not o.ouverte or o.changee_par is not null)
     or exists (select 1 from public.cabinets c
                 where (select count(*) from public.options_des_cabinets o where o.cabinet_id = c.id) <> 8) then
    raise exception 'Les cabinets existants ne portent pas leurs huit modules ouverts, sans auteur (% ligne(s) pour % attendue(s)).', v_lignes, v_attendues;
  end if;
end
$fin$;
