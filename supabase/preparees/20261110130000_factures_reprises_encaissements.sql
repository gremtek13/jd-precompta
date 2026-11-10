-- LES ENCAISSEMENTS ET L'AVOIR D'UNE FACTURE REPRISE, EN BASE (ligne 51.5, étape A8b ; EC3-Q9, A8-Q1, A8-Q2 et A8-Q6,
-- tranchées par le cabinet à la recommandation). PRÉPARÉE le 10/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « A8B :
-- LES ENCAISSEMENTS ET L'AVOIR D'UNE FACTURE REPRISE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; la conception : « A8 ET A9,
-- LES FACTURES REPRISES ET LA NUMÉROTATION QUI CONTINUE : LA CONCEPTION REMISE À JOUR » (06/11/2026), points 2 et 5 et le
-- découpage. Son essai : supabase/essais/encaissementsDesReprises.sql ; son retour : supabase/preparees/retour/
-- 20261110130100_retour_factures_reprises_encaissements.sql. Les refus neufs d'`enregistrer_encaissement`, que
-- src/lib/encaissementsFactures.ts redit derrière `FACTURES_IMPORTEES_PREVUES` (baissé ; le drapeau des trois migrations des factures reprises), confrontés à ce texte.
--
-- ELLE S'ÉCRIT PAR-DESSUS A8a (20261107210000_factures_importees) ET A9a (20261110100000_numerotation_continue), toutes deux
-- préparées, à coller AVANT elle : sa garde de tête les exige. À COLLER (l'outil retient ce texte : le corps
-- d'`enregistrer_facture` remplace les lignes d'un brouillon par une suppression, comme hier) : dans l'éditeur SQL de
-- Supabase, en UNE transaction, avec sa ligne d'historique. Elle ne retire ni table, ni colonne, ni ligne, ni contrainte.
--
-- POURQUOI. A8a pose les factures reprises de l'ancien logiciel d'un client, et rien ne s'en lit encore : les fonctions de la
-- vente testent l'état par égalité à « validee ». Or une facture reprise compte par son REGISTRE, ses encaissements d'après
-- la date de reprise (EC3-Q9), sous les règles d'une facture source — la marque que son import pose (A8-Q1). A8b ouvre la
-- base à ce registre et à l'avoir que l'application émet sur elle ; les modules TypeScript s'ouvrent nommément avec A8c,
-- l'écran avec A8d.
--
-- CE QU'ELLE POSE :
--   1. `montants_par_taux_du_document(p_facture_id)`, neuve : les montants par taux d'un document, dans son sens (un avoir en
--      positif) — ceux de `montants_par_taux_facture`, ligne à ligne, ce que la facture électronique transmet ; d'une facture
--      ou d'un avoir REPRIS, ceux de la règle de TVA que ses montants déclarés suivaient, celle qu'`importer_factures` a
--      reconnue : par taux (la base du taux × le taux, arrondie : EN 16931, BR-CO-17) quand la somme des TVA de ses taux fait
--      sa TVA déclarée, sinon ligne à ligne. Sans elle, une facture reprise arrondie par taux ne se retrouverait pas dans
--      ses lignes, à un centime près, et ne recevrait aucun encaissement.
--   2. `enregistrer_encaissement` : le refus 4 admet une facture reprise ; deux refus neufs — une facture reprise qui mêle
--      biens et services (A8B-Q1), un encaissement daté d'avant la reprise (A8-Q2 : ce qui était encaissé avant est déjà
--      dans la reprise) — ; les plafonds d'une facture reprise, au total et par taux, nets de ses avoirs, de l'application
--      et repris, et de ce qui en était encaissé avant la reprise (A8-Q6), sous deux messages neufs. Pour toute autre
--      facture, rien ne change.
--   3. `garder_encaissement_facture` : la garde des encaissements admet l'encaissement d'une facture reprise, sa
--      contre-passation (`annuler_encaissement`) et leur restauration.
--   4. `calcul_vente_facturee` (la règle du cumul d'une facture) et `ecritures_attendues_de_la_periode` (la même, recomposée
--      d'un bloc) : une facture reprise compte par ses encaissements ; la règle du cumul part, taux par taux, de ce qui en
--      était encaissé avant la reprise et de la TVA qu'elle lui rend, V et T nets de ses avoirs repris ; ni document (sa
--      créance est dans la reprise), ni exigibilité de sa livraison ou de sa facture sur les débits (l'ancien logiciel les a
--      déclarées) : seul l'encaissement de services sans l'option pour les débits rend sa TVA exigible, et l'avoir que
--      l'application émet sur elle régularise à sa date. `ecriture_attendue_vente_facturee`, la composition source par
--      source, et `ventes_facturees_de_la_simulation` (« Ma simulation » d'un client « Banque »), qui lisent la même règle,
--      la suivent : le mouvement d'un encaissement d'une facture reprise s'écrit comme celui d'une facture source.
--   5. `enregistrer_facture` : l'avoir d'une facture reprise, document neuf de l'application (A.3.4 de la conception) — qui
--      ne crédite pas plus que ce qui lui reste, ses avoirs repris déduits ; daté de la reprise ou d'après (A8-Q2) ; refusé
--      sur une facture reprise qui mêle biens et services (A8B-Q1) ; son émetteur, celui que le dossier pose (A8B-Q2). Le
--      cabinet le valide dans la série de son mandataire (MA<année>-, A9a), le client « Ventes » dans la sienne. Les trois
--      chaînes que la garde de tête d'A9a lit d'elle restent telles quelles.
--
-- CE QU'ELLE NE FAIT PAS : les modules TypeScript qui lisent les ventes (A8c), l'écran (A8d), la pièce déjà au dossier d'une
-- facture reprise (A8-Q5, un lot à part), l'engagement (A8e, A8-Q3). Un dossier qui porte des factures reprises peut encore
-- changer de modèle comptable tant que son brouillon est vide (A8B-Q3).
--
-- L'ORDRE D'APPLICATION : après A8a et A9a. La migration préparée e7a (20261107120000_facture_internationale) remplace aussi
-- `enregistrer_facture` depuis l'empreinte de l'export (6dc9348c…) : la seconde des deux à coller se reprend sur la
-- première, et sa garde de tête la refuse d'ici là. Les autres migrations préparées ne touchent aucune de ces fonctions.
--
-- LES SOURCES (publiques ; les normes AFNOR XP Z12-012 et XP Z12-013 ne s'utilisent pas) : CGI, art. 269, 1-a, 2-a et 2-c
-- (l'exigibilité : la livraison, l'encaissement, les débits) ; art. 272, 1 (la taxe d'une opération annulée ou réduite) ;
-- CGI, ann. II, art. 242 nonies A, I, 7° (l'avoir, numéroté dans sa série) ; BOI-TVA-DECLA-30-20-20-30, § 350 (la TVA d'un
-- paiement partiel) ; norme EN 16931-1, règle BR-CO-17 (la TVA d'une catégorie) ; CGI, art. 93, 1 (les recettes encaissées
-- d'un titulaire de bénéfices non commerciaux).

-- ══ 0. GARDE DE TÊTE : la base est celle que cette migration remplace ══════════

do $garde$
begin
  if to_regprocedure('public.montants_par_taux_du_document(uuid)') is not null then
    raise exception 'Les encaissements des factures reprises sont déjà en base : cette migration ne se rejoue pas.';
  end if;
  -- A8a d'abord : l'état « importee », la date de reprise du dossier, l'encaissé avant la reprise par taux et l'avoir repris
  -- qui cite sa facture.
  if to_regclass('public.factures_importees') is null or to_regclass('public.imports_factures') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'dossiers' and column_name = 'reprise_des_factures_le')
     or (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'factures_importees'
            and column_name in ('encaisse_avant_reprise', 'encaisse_par_taux', 'origine_id')) <> 3
     or to_regprocedure('public.importer_factures(uuid, jsonb, jsonb)') is null then
    raise exception 'Les factures reprises (A8a, 20261107210000_factures_importees) ne sont pas en base : elles précèdent cette migration.';
  end if;
  -- A9a ensuite : la numérotation qui continue (la série du mandataire où le cabinet valide l'avoir d'une facture reprise),
  -- et la garde des factures reprises qu'elle a laissée, à l'empreinte de son corps (A8a la posait à b9b7127e…).
  if to_regclass('public.modeles_numerotation') is null
     or to_regprocedure('public.numerotation_suivante(uuid, integer, text)') is null
     or (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure('public.garder_factures_reprises()'))
        is distinct from '0279817aa28a725d82f2661a5d0150ab' then
    raise exception 'La numérotation qui continue (A9a, 20261110100000_numerotation_continue) n''est pas en base, ou la garde des factures reprises n''est plus celle qu''elle a laissée : elle précède cette migration.';
  end if;
  -- Les sept fonctions remplacées, à l'empreinte de leur corps (fins de ligne ramenées à \n : une migration collée peut les
  -- porter en \r\n) : celles de l'export, que ni A8a ni A9a ne touchent.
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, E'\r\n', E'\n')), ',' order by p.proname collate "C")
        from pg_proc p
       where p.oid in (to_regprocedure('public.calcul_vente_facturee(uuid)'),
                       to_regprocedure('public.ecriture_attendue_vente_facturee(uuid, text, uuid)'),
                       to_regprocedure('public.ecritures_attendues_de_la_periode(uuid, date, date)'),
                       to_regprocedure('public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb)'),
                       to_regprocedure('public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean)'),
                       to_regprocedure('public.garder_encaissement_facture()'),
                       to_regprocedure('public.ventes_facturees_de_la_simulation(uuid, integer)')))
     is distinct from 'calcul_vente_facturee=d2f0312ec96293f24302d20f2d8da159,'
                   || 'ecriture_attendue_vente_facturee=e956e19eea29309d239f64929b8c0688,'
                   || 'ecritures_attendues_de_la_periode=5ae2203a5971826838080dc3fca2237c,'
                   || 'enregistrer_encaissement=79d615e6d9cc48ef38af45dd064abbb5,'
                   || 'enregistrer_facture=6dc9348ceef8ae5fd72568748e60fa6b,'
                   || 'garder_encaissement_facture=31fdfcc86b476669612b459555e94f13,'
                   || 'ventes_facturees_de_la_simulation=8e78262f2599046db78a19d2c3fcaf57' then
    raise exception 'Une des fonctions que cette migration remplace (calcul_vente_facturee, ecriture_attendue_vente_facturee, ecritures_attendues_de_la_periode, enregistrer_encaissement, enregistrer_facture, garder_encaissement_facture, ventes_facturees_de_la_simulation) n''est plus celle de l''export — e7a, peut-être, qui remplace aussi enregistrer_facture : la relire contre la base avant de l''appliquer.';
  end if;
  -- Ce que les fonctions neuves et remplacées appellent : la règle d'un document de l'application, la ligne au centime, le
  -- prorata arrondi de la règle du cumul.
  if (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure('public.montants_par_taux_facture(uuid)'))
       is distinct from '848fa22536d0ca4b22a29dc417d4002a'
     or (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
          where p.oid = to_regprocedure('public.centimes_ligne_facture(numeric, numeric, numeric, boolean)'))
       is distinct from 'c693e49939a5732b0fef1b2ba4e6abd1'
     or to_regprocedure('public.prorata_arrondi(bigint, bigint, bigint)') is null then
    raise exception 'montants_par_taux_facture, centimes_ligne_facture ou prorata_arrondi n''est plus celle que cette migration suppose.';
  end if;
end
$garde$;

-- ══ 1. LES MONTANTS PAR TAUX D'UN DOCUMENT, REPRIS OU NON ══════════

create function public.montants_par_taux_du_document(p_facture_id uuid)
returns table (taux numeric, base_centimes bigint, tva_centimes bigint, ttc_centimes bigint)
language sql
stable
set search_path = public
as $$
  with reprise as (
    -- Une facture ou un avoir repris de l'ancien logiciel : sa TVA déclarée, dans le sens du document.
    select f.id, f.type = 'avoir' as avoir,
           case when f.type = 'avoir' then -f.montant_tva else f.montant_tva end * 100 as tva_declaree
      from public.factures_emises f
     where f.id = p_facture_id and f.statut = 'importee'
  ), par_taux as (
    select l.taux_tva as taux, sum(c.ht_centimes) as base, sum(c.tva_centimes) as tva_des_lignes,
           round(sum(c.ht_centimes) * l.taux_tva * 0.01) as tva_du_taux
      from reprise r
      join public.facture_lignes l on l.facture_id = r.id
      cross join lateral public.centimes_ligne_facture(l.quantite, l.prix_unitaire_ht, l.taux_tva, r.avoir) c
     group by l.taux_tva
  ), regle as (
    -- La règle qu'`importer_factures` a reconnue : par taux quand la somme des TVA de ses taux fait sa TVA déclarée (il
    -- l'essaie d'abord), sinon ligne à ligne. Arrondir l'opposé rend l'opposé : le sens du document ne change pas le choix.
    select coalesce(sum(p.tva_du_taux), 0) = (select r.tva_declaree from reprise r) as par_taux from par_taux p
  )
  -- Un document de l'application : ses montants tels que la facture électronique les transmet, ligne à ligne.
  select m.taux, m.base_centimes, m.tva_centimes, m.ttc_centimes
    from public.montants_par_taux_facture(p_facture_id) m
   where not exists (select 1 from reprise)
  union all
  select p.taux, p.base::bigint, (case when g.par_taux then p.tva_du_taux else p.tva_des_lignes end)::bigint,
         (p.base + case when g.par_taux then p.tva_du_taux else p.tva_des_lignes end)::bigint
    from par_taux p
    cross join regle g
$$;

comment on function public.montants_par_taux_du_document(uuid) is
  'Les montants par taux d''un document, dans son sens (un avoir en positif), en centimes (A8b) : ceux de montants_par_taux_facture (ligne à ligne, ce que la facture électronique transmet) ; d''une facture ou d''un avoir repris de l''ancien logiciel (statut importee), ceux de la règle de TVA que ses montants déclarés suivaient, celle qu''importer_factures a reconnue — par taux (EN 16931, BR-CO-17) quand la somme des TVA de ses taux fait sa TVA déclarée, sinon ligne à ligne.';

revoke all on function public.montants_par_taux_du_document(uuid) from public, anon, authenticated;

-- ══ 2. L'ENCAISSEMENT D'UNE FACTURE REPRISE (refus 4, deux refus neufs, les plafonds nets de la reprise) ══════════

-- Celle de l'export (20261026000145_registre_virement_mixte) ; seules les lignes marquées « A8b » s'y ajoutent, et
-- l'appel des montants du document (`montants_par_taux_du_document`, qui rend ce que `montants_par_taux_facture`
-- rendait pour une facture qui n'est pas reprise).
create or replace function public.enregistrer_encaissement(p_dossier_id uuid, p_facture_id uuid, p_date date,
  p_montant numeric, p_moyen text, p_ligne_bancaire_id uuid, p_repartition jsonb)
returns public.encaissements_factures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_facture public.factures_emises;
  v_mouvement public.lignes_bancaires;
  v_encaissement public.encaissements_factures;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_taux numeric;
  v_base bigint;
  v_tva bigint;
  v_ttc bigint;
  v_deja numeric;
  v_total numeric;
  v_exces numeric;
  v_part record;
  v_frontiere date;
  v_credite bigint;
  v_plafond numeric;
  -- A8b : une facture reprise de l'ancien logiciel — sa date de reprise, ses avoirs repris, ce qui en était encaissé
  -- avant la reprise (au total en euros, à un taux en centimes).
  v_reprise date;
  v_credite_repris numeric;
  v_credite_repris_taux bigint;
  v_avant numeric;
  v_avant_taux bigint;
begin
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- Le mouvement qui prouve l'encaissement est une donnée de la banque : le désigner demande aussi le droit « Banque »
  -- (espace client, étape P2). Le cabinet a les deux ; un client qui n'a que « Ventes » encaisse sans mouvement.
  if p_ligne_bancaire_id is not null and not public.gere_la_banque(p_dossier_id) then
    raise exception 'Le mouvement bancaire d''un encaissement ne se désigne qu''avec le droit « Banque » sur ce dossier : sans lui, l''encaissement s''enregistre sans mouvement.'
      using errcode = '42501';
  end if;
  select * into v_facture from public.factures_emises f
   where f.id = p_facture_id and f.dossier_id = p_dossier_id
   for no key update;
  if not found then
    raise exception 'Facture introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  -- A8b : une facture reprise de l'ancien logiciel (`importee`, A8a) reçoit ses encaissements d'après la reprise, comme une
  -- facture validée (EC3-Q9) ; seul un brouillon n'en reçoit pas.
  if v_facture.statut not in ('validee', 'importee') then
    raise exception 'Seule une facture validée reçoit un encaissement : celle-ci est un brouillon.' using errcode = '22023';
  end if;
  if v_facture.type <> 'facture' then
    raise exception 'Un avoir ne reçoit pas d''encaissement : seule une facture en reçoit.' using errcode = '22023';
  end if;
  if exists (select 1 from public.transmissions_factures r where r.facture_id = p_facture_id and r.etat = 'rejete')
     or exists (select 1 from public.facture_superpdp_events e
                 where e.facture_id = p_facture_id and e.status_code in ('fr:210', 'fr:213'))
     or exists (select 1 from public.statuts_factures_recus s
                 where s.facture_id = p_facture_id and s.code in ('210', '213')) then
    raise exception 'Cette facture a été rejetée ou refusée : elle s''annule par un avoir interne, et aucun encaissement ne la suit.'
      using errcode = '22023';
  end if;
  -- A8b (A8B-Q1) : une facture reprise qui mêle biens et services. Ses encaissements se répartissent par taux, jamais par
  -- nature : la TVA d'une part ne se dit ni exigible à l'encaissement (des services) ni déjà déclarée à la livraison
  -- (des biens) sans deviner, et la règle du cumul l'écarterait (`calcul_vente_facturee`, « nature »). Comme une facture
  -- de l'application qui mêle les deux ne se valide pas encore, celle-ci ne reçoit pas encore d'encaissement.
  if v_facture.statut = 'importee' and v_facture.nature_operation = 'mixte' then
    raise exception 'La facture % est reprise de l''ancien logiciel et mêle biens et services : ses encaissements ne se répartissent pas encore entre les deux, et elle n''en reçoit pas — un paiement d''après la reprise se classe dans le relevé, comme une recette.',
      v_facture.numero using errcode = '22023';
  end if;
  -- Les montants du document par taux : ceux qu'il transmet, ligne à ligne ; pour une facture reprise (A8b), ceux de la
  -- règle de TVA que ses montants déclarés suivaient, par taux ou ligne à ligne (`montants_par_taux_du_document`).
  select coalesce(sum(m.base_centimes), 0), coalesce(sum(m.tva_centimes), 0) into v_base, v_tva
    from public.montants_par_taux_du_document(p_facture_id) m;
  if v_base <> v_facture.montant_ht * 100 or v_tva <> v_facture.montant_tva * 100
     or v_base + v_tva <> v_facture.montant_ttc * 100 then
    raise exception 'Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes : ses encaissements ne se répartissent pas par taux.'
      using errcode = '22023';
  end if;

  if p_date is null then
    raise exception 'La date de l''encaissement est à renseigner.' using errcode = '22023';
  end if;
  if p_date < date '2000-01-01' then
    raise exception 'Un encaissement ne se date pas avant l''an 2000.' using errcode = '22023';
  end if;
  if p_date > v_aujourd_hui then
    raise exception 'Un encaissement ne se date pas dans l''avenir : nous sommes le %.', to_char(v_aujourd_hui, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  -- A8b (A8-Q2) : l'encaissement d'une facture reprise se date de la reprise des factures du dossier, ou d'après ; ce qui
  -- en était encaissé avant est déjà dans sa reprise (A8-Q6), et le déclarer deux fois serait l'erreur.
  if v_facture.statut = 'importee' then
    select d.reprise_des_factures_le into v_reprise from public.dossiers d where d.id = p_dossier_id;
    if v_reprise is null or p_date < v_reprise then
      raise exception 'La facture % est reprise de l''ancien logiciel : un encaissement s''y date du jour de la reprise des factures, le %, ou d''après — ce qui en était encaissé avant est déjà dans sa reprise.',
        v_facture.numero, to_char(v_reprise, 'DD/MM/YYYY') using errcode = '22023';
    end if;
  end if;
  -- Une facture source : son encaissement compte dans l'exercice de sa date, que la validation fige (§ 11).
  if v_facture.source_de_la_vente then
    perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
    v_frontiere := public.frontiere_validation(p_dossier_id);
    if v_frontiere is not null and p_date <= v_frontiere then
      raise exception '% : un encaissement de cette facture ne s''y date plus.',
        public.exercice_fige(p_dossier_id, extract(year from p_date)::integer) using errcode = '22023';
    end if;
  end if;
  if p_montant is null or not (p_montant > 0 and p_montant < 10000000000000) then
    raise exception 'Un encaissement est un montant positif.' using errcode = '22023';
  end if;
  if p_montant <> round(p_montant, 2) then
    raise exception 'Un encaissement se compte au centime.' using errcode = '22023';
  end if;
  if p_moyen is null
     or p_moyen not in ('virement', 'cheque', 'carte', 'prelevement', 'especes', 'effet', 'compensation', 'autre') then
    raise exception 'Le moyen de paiement est inconnu.' using errcode = '22023';
  end if;

  if p_ligne_bancaire_id is not null then
    select * into v_mouvement from public.lignes_bancaires l
     where l.id = p_ligne_bancaire_id and l.dossier_id = p_dossier_id
     for no key update;
    if not found then
      raise exception 'Ce mouvement n''est pas un mouvement de ce dossier.' using errcode = '22023';
    end if;
    if v_mouvement.montant <= 0 then
      raise exception 'Un encaissement se justifie par un crédit : ce mouvement n''en est pas un.' using errcode = '22023';
    end if;
    -- G2 : le mouvement d'un encaissement d'une facture source ne porte rien d'autre, et n'est pas encore classé.
    if v_facture.source_de_la_vente and not public.mouvement_libre(v_mouvement) then
      raise exception 'Ce mouvement est déjà classé : l''encaissement d''une facture source de sa vente ne cite qu''un mouvement que rien ne classe encore — retirer d''abord ce classement.'
        using errcode = '22023';
    end if;
    -- Pour une facture qui n'est pas source (étape VF5h2, VF5H-Q2) : un mouvement classé par ses encaissements — ce qu'il
    -- justifie ne change plus. Le virement mixte (étape VF5h) y compte l'encaissement d'une facture d'avant la bascule ;
    -- un encaissement de plus en retiendrait la composition (`mouvement_ecart`, `mouvement_facture_non_source`) et
    -- rendrait ses écritures fausses. Classé autrement — rapproché de la pièce de la facture, le plus souvent —, il se
    -- cite comme hier.
    if v_facture.source_de_la_vente is not true and v_mouvement.encaissements_de_factures then
      raise exception 'Ce mouvement est déjà classé par ses encaissements : l''encaissement d''une facture qui n''est pas la source de sa vente ne s''y ajoute plus — retirer d''abord ce classement.'
        using errcode = '22023';
    end if;
    -- Ce que le mouvement justifie (`encaissement_justifie_son_mouvement`) : tant qu'aucune contre-passation ne cite de
    -- mouvement — aucune ne le fait hors d'une facture source —, ce que la fonction jugeait hier, au mot près.
    if exists (select 1 from public.encaissements_factures e
                where e.ligne_bancaire_id = p_ligne_bancaire_id and e.facture_id = p_facture_id and e.retire_le is null
                  and public.encaissement_justifie_son_mouvement(e.id)) then
      raise exception 'Ce mouvement justifie déjà un encaissement de cette facture.' using errcode = '22023';
    end if;
    select coalesce(sum(e.montant), 0) + p_montant into v_total
      from public.encaissements_factures e
     where e.ligne_bancaire_id = p_ligne_bancaire_id and e.retire_le is null
       and public.encaissement_justifie_son_mouvement(e.id);
    -- L'écart toléré, en centimes : (encaissements − mouvement) ≤ min(500, 2 % des encaissements), multiplié par 100
    -- pour rester en nombres entiers.
    v_exces := (v_total - v_mouvement.montant) * 100;
    if v_exces * 100 > least(50000, v_total * 200) then
      raise exception 'Ce mouvement de % € justifierait % € d''encaissements : l''écart dépasse ce que des frais bancaires expliquent.',
        replace(to_char(v_mouvement.montant, 'FM999999999990.00'), '.', ','), replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
        using errcode = '22023';
    end if;
  end if;

  if jsonb_typeof(p_repartition) is distinct from 'array' or jsonb_array_length(p_repartition) = 0
     or exists (select 1 from jsonb_array_elements(p_repartition) e(valeur)
                 where jsonb_typeof(e.valeur) <> 'object' or jsonb_typeof(e.valeur -> 'taux') is distinct from 'number'
                    or jsonb_typeof(e.valeur -> 'montant') is distinct from 'number') then
    raise exception 'La répartition par taux est illisible : une liste de taux et de montants.' using errcode = '22023';
  end if;
  select (e.valeur ->> 'taux')::numeric into v_taux
    from jsonb_array_elements(p_repartition) with ordinality e(valeur, rang)
   where exists (select 1 from jsonb_array_elements(p_repartition) with ordinality d(valeur, rang)
                  where (d.valeur ->> 'taux')::numeric = (e.valeur ->> 'taux')::numeric and d.rang < e.rang)
   order by e.rang limit 1;
  if found then
    raise exception 'Le taux de % %% figure deux fois dans la répartition.', replace(trim_scale(v_taux)::text, '.', ',')
      using errcode = '22023';
  end if;
  select (e.valeur ->> 'taux')::numeric into v_taux
    from jsonb_array_elements(p_repartition) with ordinality e(valeur, rang)
   where not exists (select 1 from public.facture_lignes l
                      where l.facture_id = p_facture_id and l.taux_tva = (e.valeur ->> 'taux')::numeric)
   order by e.rang limit 1;
  if found then
    raise exception 'Le taux de % %% n''est pas un taux de cette facture.', replace(trim_scale(v_taux)::text, '.', ',')
      using errcode = '22023';
  end if;
  select (e.valeur ->> 'taux')::numeric into v_taux
    from jsonb_array_elements(p_repartition) with ordinality e(valeur, rang)
   where (e.valeur ->> 'taux')::numeric not in (0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6)
   order by e.rang limit 1;
  if found then
    raise exception 'Le taux de % %% n''est pas un taux de TVA que la facturation électronique admet.',
      replace(trim_scale(v_taux)::text, '.', ',') using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_repartition) e(valeur)
              where not ((e.valeur ->> 'montant')::numeric > 0)
                 or (e.valeur ->> 'montant')::numeric <> round((e.valeur ->> 'montant')::numeric, 2)) then
    raise exception 'Chaque part de la répartition est un montant positif, au centime.' using errcode = '22023';
  end if;
  select sum((e.valeur ->> 'montant')::numeric) into v_total from jsonb_array_elements(p_repartition) e(valeur);
  if v_total <> p_montant then
    raise exception 'La répartition (% €) ne fait pas le montant encaissé (% €).',
      replace(to_char(v_total, 'FM999999999990.00'), '.', ','), replace(to_char(p_montant, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  select coalesce(sum(e.montant), 0) into v_deja from public.encaissements_factures e
   where e.facture_id = p_facture_id and e.retire_le is null;
  if v_facture.statut = 'importee' then
    -- A8b (A8-Q6) : ce qui reste à encaisser d'une facture reprise — son TTC, net de ses avoirs, ceux que l'application a
    -- validés (tels que leurs lignes les transmettent) et ses avoirs repris (qui la citent dans `factures_importees`), et
    -- de ce qui en était encaissé avant la reprise.
    select coalesce(sum(m.ttc_centimes), 0) into v_credite
      from public.factures_emises a
      cross join lateral public.montants_par_taux_facture(a.id) m
     where a.facture_origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'validee';
    select coalesce(sum(-a.montant_ttc), 0) into v_credite_repris
      from public.factures_importees ai
      join public.factures_emises a on a.id = ai.facture_id
     where ai.origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'importee';
    select coalesce(sum(fi.encaisse_avant_reprise), 0) into v_avant
      from public.factures_importees fi where fi.facture_id = p_facture_id;
    v_plafond := v_facture.montant_ttc - v_credite / 100.0 - v_credite_repris - v_avant;
    if v_deja + p_montant > v_plafond then
      raise exception 'L''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste % € à encaisser.',
        replace(to_char(greatest(v_plafond - v_deja, 0), 'FM999999999990.00'), '.', ',') using errcode = '22023';
    end if;
  elsif not v_facture.source_de_la_vente then
    if v_deja + p_montant > v_facture.montant_ttc then
      raise exception 'L''encaissement dépasserait le total de la facture : il reste % € à encaisser.',
        replace(to_char(greatest(v_facture.montant_ttc - v_deja, 0), 'FM999999999990.00'), '.', ',') using errcode = '22023';
    end if;
  else
    -- EC3-Q10 : les avoirs validés de la facture réduisent ce qui reste à encaisser — leur TTC tel que leurs lignes le
    -- transmettent (montants_par_taux_facture, dans le sens du document : un avoir s'y lit en montants positifs).
    select coalesce(sum(m.ttc_centimes), 0) into v_credite
      from public.factures_emises a
      cross join lateral public.montants_par_taux_facture(a.id) m
     where a.facture_origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'validee';
    v_plafond := v_facture.montant_ttc - v_credite / 100.0;
    if v_deja + p_montant > v_plafond then
      raise exception 'L''encaissement dépasserait le total de la facture, net de ses avoirs : il reste % € à encaisser.',
        replace(to_char(greatest(v_plafond - v_deja, 0), 'FM999999999990.00'), '.', ',') using errcode = '22023';
    end if;
  end if;
  for v_part in
    select (e.valeur ->> 'taux')::numeric as taux, (e.valeur ->> 'montant')::numeric as montant, e.rang
      from jsonb_array_elements(p_repartition) with ordinality e(valeur, rang)
     order by e.rang
  loop
    select m.ttc_centimes into v_ttc from public.montants_par_taux_du_document(p_facture_id) m where m.taux = v_part.taux;
    select coalesce(sum(t.montant), 0) into v_deja
      from public.encaissements_factures_taux t
      join public.encaissements_factures e on e.id = t.encaissement_id
     where e.facture_id = p_facture_id and e.retire_le is null and t.taux = v_part.taux;
    if v_facture.statut = 'importee' then
      -- A8b (A8-Q6) : à ce taux, son TTC net de ses avoirs — de l'application, et repris, selon la règle de TVA de leurs
      -- montants — et de ce qui en était encaissé avant la reprise à ce taux (`encaisse_par_taux`).
      select coalesce(sum(m.ttc_centimes), 0) into v_credite
        from public.factures_emises a
        cross join lateral public.montants_par_taux_facture(a.id) m
       where a.facture_origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'validee' and m.taux = v_part.taux;
      select coalesce(sum(m.ttc_centimes), 0) into v_credite_repris_taux
        from public.factures_importees ai
        join public.factures_emises a on a.id = ai.facture_id
        cross join lateral public.montants_par_taux_du_document(a.id) m
       where ai.origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'importee' and m.taux = v_part.taux;
      select coalesce(sum(((g.valeur ->> 'encaisse')::numeric * 100)::bigint), 0) into v_avant_taux
        from public.factures_importees fi
        cross join lateral jsonb_array_elements(fi.encaisse_par_taux) g(valeur)
       where fi.facture_id = p_facture_id and (g.valeur ->> 'taux')::numeric = v_part.taux;
      if (v_deja + v_part.montant) * 100 > v_ttc - v_credite - v_credite_repris_taux - v_avant_taux then
        raise exception 'À % %%, l''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste % € à encaisser à ce taux.',
          replace(trim_scale(v_part.taux)::text, '.', ','),
          replace(to_char(greatest((v_ttc - v_credite - v_credite_repris_taux - v_avant_taux) / 100.0 - v_deja, 0), 'FM999999999990.00'), '.', ',')
          using errcode = '22023';
      end if;
    elsif not v_facture.source_de_la_vente then
      if (v_deja + v_part.montant) * 100 > v_ttc then
        raise exception 'À % %%, l''encaissement dépasserait ce que la facture porte : il reste % € à encaisser à ce taux.',
          replace(trim_scale(v_part.taux)::text, '.', ','),
          replace(to_char(greatest(v_ttc / 100.0 - v_deja, 0), 'FM999999999990.00'), '.', ',') using errcode = '22023';
      end if;
    else
      select coalesce(sum(m.ttc_centimes), 0) into v_credite
        from public.factures_emises a
        cross join lateral public.montants_par_taux_facture(a.id) m
       where a.facture_origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'validee' and m.taux = v_part.taux;
      if (v_deja + v_part.montant) * 100 > v_ttc - v_credite then
        raise exception 'À % %%, l''encaissement dépasserait ce que la facture porte, net de ses avoirs : il reste % € à encaisser à ce taux.',
          replace(trim_scale(v_part.taux)::text, '.', ','),
          replace(to_char(greatest((v_ttc - v_credite) / 100.0 - v_deja, 0), 'FM999999999990.00'), '.', ',') using errcode = '22023';
      end if;
    end if;
  end loop;

  insert into public.encaissements_factures (
    dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, cree_par
  ) values (
    p_dossier_id, p_facture_id, p_date, p_montant, p_moyen, p_ligne_bancaire_id, auth.uid()
  )
  returning * into v_encaissement;
  insert into public.encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
  select v_encaissement.id, p_dossier_id, (e.valeur ->> 'taux')::numeric, (e.valeur ->> 'montant')::numeric
    from jsonb_array_elements(p_repartition) e(valeur);
  return v_encaissement;
end
$$;

-- ══ 3. LA GARDE DES ENCAISSEMENTS ADMET UNE FACTURE REPRISE ══════════

-- Celle de l'export (20261030224203_especes_sans_mouvement) ; seule la ligne marquée « A8b » change : l'état admis à
-- l'insertion.
create or replace function public.garder_encaissement_facture()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cible public.encaissements_factures;
  v_source boolean;
  v_rattachement boolean;
  v_ligne public.encaissements_factures;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Un encaissement ne se supprime pas : jamais déclaré, il se retire ; déclaré, il se contre-passe.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    -- A8b : une facture reprise de l'ancien logiciel (`importee`) reçoit les encaissements d'après sa reprise, que
    -- `enregistrer_encaissement` juge, et leurs contre-passations ; la restauration les réinsère.
    select f.source_de_la_vente into v_source from public.factures_emises f
     where f.id = new.facture_id and f.dossier_id = new.dossier_id
       and f.statut in ('validee', 'importee') and f.type = 'facture';
    if not found then
      raise exception 'Seule une facture validée de son dossier reçoit un encaissement : jamais un brouillon, jamais un avoir.'
        using errcode = '23514';
    end if;
    if new.compte_contrepartie is not null and not public.is_super_admin() then
      raise exception 'Un encaissement ne naît pas avec un compte de contrepartie : le cabinet le choisit ensuite, par sa fonction.'
        using errcode = '42501';
    end if;
    v_ligne := new;
  else
    v_rattachement := old.ligne_bancaire_id is null and new.ligne_bancaire_id is not null
      and coalesce(current_setting('jd.rattachement_encaissement', true), '') = old.id::text;
    if (to_jsonb(new) - array['retire_le', 'retire_par', 'ligne_bancaire_id', 'compte_contrepartie'])
         is distinct from (to_jsonb(old) - array['retire_le', 'retire_par', 'ligne_bancaire_id', 'compte_contrepartie'])
       or new.ligne_bancaire_id is distinct from old.ligne_bancaire_id and not v_rattachement
       or v_rattachement and (old.retire_le is not null
                              or (new.retire_le, new.retire_par) is distinct from (old.retire_le, old.retire_par))
       or old.retire_le is not null and (new.retire_le, new.retire_par) is distinct from (old.retire_le, old.retire_par)
       or new.retire_le is null and new.retire_par is distinct from old.retire_par then
      raise exception 'Un encaissement ne se modifie pas : jamais déclaré, il se retire, une fois ; déclaré, il se contre-passe.'
        using errcode = '23514';
    end if;
    if new.compte_contrepartie is distinct from old.compte_contrepartie
       and coalesce(current_setting('jd.contrepartie_encaissement', true), '') is distinct from old.id::text then
      raise exception 'Le compte de contrepartie d''un encaissement ne se choisit que par la fonction du cabinet.'
        using errcode = '42501';
    end if;
    if v_rattachement then
      select f.source_de_la_vente into v_source from public.factures_emises f where f.id = new.facture_id;
      if not coalesce(v_source, false) then
        raise exception 'Seul l''encaissement d''une facture source de sa vente se rattache après coup au mouvement qui le prouve.'
          using errcode = '23514';
      end if;
      v_ligne := new;
    end if;
  end if;

  -- Le mouvement cité, à l'insertion comme au rattachement : un crédit pour un encaissement ; pour une contre-passation,
  -- un débit, et d'une facture source seulement ; pour une facture source, un mouvement que rien d'autre ne classe.
  if v_ligne.ligne_bancaire_id is not null then
    if v_ligne.annule_id is null then
      if not exists (select 1 from public.lignes_bancaires l
                      where l.id = v_ligne.ligne_bancaire_id and l.dossier_id = v_ligne.dossier_id and l.montant > 0) then
        raise exception 'Un encaissement se justifie par un crédit de son dossier.' using errcode = '23514';
      end if;
    else
      if not coalesce(v_source, false) then
        raise exception 'Seule la contre-passation d''une facture source de sa vente cite un mouvement : celui qui défait l''encaissement.'
          using errcode = '23514';
      end if;
      if not exists (select 1 from public.lignes_bancaires l
                      where l.id = v_ligne.ligne_bancaire_id and l.dossier_id = v_ligne.dossier_id and l.montant < 0) then
        raise exception 'Une contre-passation se justifie par un débit de son dossier.' using errcode = '23514';
      end if;
    end if;
    -- Un encaissement EN ESPÈCES ne cite aucun crédit, de toute facture, à l'insertion comme au rattachement (la caisse,
    -- étape C6, ligne 26.6) : ses espèces se reçoivent hors de la banque — pour une facture source, elles entrent dans
    -- la caisse du dossier à leur date — et n'y arrivent que par leur dépôt, le versement que la caisse classe sur elle.
    -- Un crédit qui les citerait les y porterait une seconde fois. Sa contre-passation, de même moyen, qui cite le débit
    -- qui a rendu l'argent, passe : la règle ne juge qu'un crédit. Aucune fonction ne le juge : la garde le refuse
    -- après elles — d'où sa porte de la restauration, celle de la caisse (`garder_la_caisse`) : une ligne RÉINSÉRÉE par
    -- le super-administrateur, son instant de création d'avant la transaction, passe ; la même créée dans la transaction,
    -- par une fonction ou en direct, non — sur ce projet, le super-administrateur est aussi le chef du cabinet, et ses
    -- gestes se jugent. La restauration ne rattache pas.
    if v_ligne.moyen = 'especes'
       and not (tg_op = 'INSERT' and v_ligne.cree_le < now() and public.is_super_admin()) and exists (
         select 1 from public.lignes_bancaires l
          where l.id = v_ligne.ligne_bancaire_id and l.montant > 0) then
      raise exception 'Un encaissement en espèces ne cite aucun crédit du relevé : il s''enregistre sans mouvement, et le dépôt des espèces en banque se classe à part.'
        using errcode = '23514';
    end if;
    -- La restauration (le super-administrateur insère) réinsère ce qui a été : un encaissement contre-passé sans
    -- mouvement ne justifie plus le sien, que le cabinet a pu classer ensuite autrement.
    if coalesce(v_source, false) and not (tg_op = 'INSERT' and public.is_super_admin()) and exists (
         select 1 from public.lignes_bancaires l
          where l.id = v_ligne.ligne_bancaire_id and not l.encaissements_de_factures and not public.mouvement_libre(l)) then
      raise exception 'Un mouvement déjà classé ne se cite pas : l''encaissement d''une facture source de sa vente ne cite qu''un mouvement que rien d''autre ne classe.'
        using errcode = '23514';
    end if;
    -- Toute facture, à l'insertion comme au rattachement (VF5H2-Q1, « Oui, la fermer » ; VF5H2Q1-Q1) : un mouvement
    -- CLASSÉ PAR SES ENCAISSEMENTS ne se cite plus — ni par l'encaissement d'une facture, source ou non, ni par la
    -- contre-passation d'une facture source qui citerait un débit ainsi classé, ni par l'encaissement d'une facture
    -- source qu'on y rattache. Ce qu'il justifie ne change plus sous son classement. Les fonctions le refusent avant
    -- d'écrire (`enregistrer_encaissement`, rangs 17 et 18 ; `annuler_encaissement`, rang 18, le débit cité qui n'est
    -- pas libre ; `rattacher_mouvement_encaissement`, rang 11) ; la garde, à qui écrit sans elles. La restauration (le
    -- super-administrateur insère) réinsère ce qui a été ; elle ne rattache pas.
    if not (tg_op = 'INSERT' and public.is_super_admin()) and exists (
         select 1 from public.lignes_bancaires l
          where l.id = v_ligne.ligne_bancaire_id and l.encaissements_de_factures) then
      raise exception 'Un mouvement classé par ses encaissements ne se cite pas : ce qu''il justifie ne change plus — le cabinet retire d''abord ce classement.'
        using errcode = '23514';
    end if;
    -- Ni le super-administrateur, que la règle d'au-dessus excuse à l'insertion pour la restauration — seul à venir
    -- jusqu'ici —, pour une facture qui n'est pas source, quand ce mouvement est FIGÉ (VF5H2Q1Q2-Q1, écrite sur la
    -- recommandation, le 26/10/2026) : l'encaissement d'une facture d'avant la bascule changerait ce que justifie le
    -- virement mixte d'un exercice validé. Pour une facture source, la garde de la frontière refuse déjà, à tous, un
    -- mouvement figé cité. La restauration passe : elle réinsère ses encaissements avant ses exercices validés
    -- (`ORDRE_RESTAURATION`, src/lib/sauvegarde.ts). Le verrou et la frontière : comme pour la contre-passation, plus
    -- bas.
    if v_source is not true and exists (
         select 1 from public.lignes_bancaires l
          where l.id = v_ligne.ligne_bancaire_id and l.encaissements_de_factures) then
      perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || new.dossier_id::text, 0));
      if exists (select 1 from public.lignes_bancaires l
                   join public.exercices_valides v on v.dossier_id = l.dossier_id and l.date <= make_date(v.annee, 12, 31)
                  where l.id = v_ligne.ligne_bancaire_id) then
        raise exception 'Un mouvement figé par la validation d''un exercice ne se cite plus : ce qu''il justifie ne change plus.'
          using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.annule_id is not null then
      select * into v_cible from public.encaissements_factures c where c.id = new.annule_id;
      if not found or v_cible.facture_id <> new.facture_id then
        raise exception 'Une annulation contre-passe un encaissement de la même facture.' using errcode = '23514';
      end if;
      if v_cible.annule_id is not null then
        raise exception 'Une annulation ne se contre-passe pas : l''encaissement qu''elle annulait se saisit de nouveau.'
          using errcode = '23514';
      end if;
      if new.montant <> -v_cible.montant then
        raise exception 'Une annulation contre-passe l''encaissement montant pour montant.' using errcode = '23514';
      end if;
      if new.retire_le is null and v_cible.retire_le is not null then
        raise exception 'Un encaissement retiré ne s''annule pas : il n''a jamais été déclaré.' using errcode = '23514';
      end if;
      -- Toute facture (VF5H2-Q1) : une contre-passation SANS MOUVEMENT n'écarte plus l'encaissement qui cite un
      -- mouvement classé par ses encaissements — elle changerait ce qu'il justifie. `annuler_encaissement` le refuse
      -- avant d'insérer (rangs 20 et 21) ; la garde, à qui écrit sans elle. Celle qui cite un débit laisse
      -- l'encaissement justifier son mouvement : la règle du mouvement cité, plus haut, juge ce débit. La restauration
      -- réinsère ce qui a été.
      if new.ligne_bancaire_id is null and not public.is_super_admin() and exists (
           select 1 from public.lignes_bancaires l
            where l.id = v_cible.ligne_bancaire_id and l.encaissements_de_factures) then
        raise exception 'Le mouvement de l''encaissement contre-passé est classé par ses encaissements : le cabinet retire d''abord ce classement.'
          using errcode = '23514';
      end if;
      -- Ni le super-administrateur, que la règle d'au-dessus excuse pour la restauration — seul à venir jusqu'ici —,
      -- quand ce mouvement est FIGÉ (VF5H2Q1-Q2, « La refuser ») : daté au plus tard du 31 décembre du dernier exercice
      -- validé de son dossier, ce qu'il justifie ne change plus. Toute facture : la garde de la frontière ne juge que
      -- l'encaissement d'une facture source, et une contre-passation à sa propre date. La restauration passe : elle
      -- n'écrit que dans un dossier qui n'existe pas, et réinsère ses exercices validés en DERNIER
      -- (`ORDRE_RESTAURATION`, src/lib/sauvegarde.ts) — tant qu'ils n'y sont pas, aucun mouvement n'est figé. Sous le
      -- verrou partagé de la validation (la clé de `cle_validation`, que l'appelant n'exécute pas, écrite en ligne) :
      -- une validation en cours finit d'abord, puis la frontière se lit, les exercices validés aux droits de
      -- l'appelant.
      if new.ligne_bancaire_id is null and exists (
           select 1 from public.lignes_bancaires l
            where l.id = v_cible.ligne_bancaire_id and l.encaissements_de_factures) then
        perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || new.dossier_id::text, 0));
        if exists (select 1 from public.lignes_bancaires l
                     join public.exercices_valides v on v.dossier_id = l.dossier_id and l.date <= make_date(v.annee, 12, 31)
                    where l.id = v_cible.ligne_bancaire_id) then
          raise exception 'Le mouvement de l''encaissement contre-passé est figé par la validation d''un exercice : ce qu''il justifie ne change plus.'
            using errcode = '23514';
        end if;
      end if;
    end if;
    return new;
  end if;

  if old.retire_le is null and new.retire_le is not null then
    if public.encaissement_declare(old.id) then
      raise exception 'Un encaissement déclaré ne se retire pas : il se contre-passe, et l''annulation se déclare à son tour.'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.encaissements_factures c where c.annule_id = old.id and c.retire_le is null) then
      raise exception 'Cet encaissement est annulé par une contre-passation : retirez d''abord celle-ci.' using errcode = '23514';
    end if;
    -- Pour une facture source : ce qu'un mouvement classé justifie ne change pas — ni le sien, ni, pour une
    -- contre-passation sans mouvement, celui de l'encaissement qu'elle annule (le retrait le lui rendrait).
    select f.source_de_la_vente into v_source from public.factures_emises f where f.id = old.facture_id;
    if coalesce(v_source, false) and exists (
         select 1 from public.lignes_bancaires l
          where l.id = coalesce(old.ligne_bancaire_id,
                                (select c.ligne_bancaire_id from public.encaissements_factures c where c.id = old.annule_id))
            and not public.mouvement_libre(l)) then
      raise exception 'Le mouvement dont dépend cet encaissement est classé : le cabinet retire d''abord ce classement.'
        using errcode = '23514';
    end if;
    -- Pour une facture qui n'est pas source (étape VF5h2, VF5H-Q2) : ce qu'un mouvement CLASSÉ PAR SES ENCAISSEMENTS
    -- justifie ne change pas non plus — le virement mixte compte cet encaissement, ou l'écarte tant que la contre-passation
    -- vit. Classé autrement, il se retire comme hier.
    if v_source is not true and exists (
         select 1 from public.lignes_bancaires l
          where l.id = coalesce(old.ligne_bancaire_id,
                                (select c.ligne_bancaire_id from public.encaissements_factures c where c.id = old.annule_id))
            and l.encaissements_de_factures) then
      raise exception 'Le mouvement dont dépend cet encaissement est classé par ses encaissements : le cabinet retire d''abord ce classement.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

-- ══ 4. LA RÈGLE DU CUMUL D'UNE FACTURE REPRISE ══════════

-- Celle de l'export (20261020114708_ecritures_de_la_vente_facturee) ; seules les lignes marquées « A8b » s'y ajoutent,
-- et les montants par taux de la facture se lisent une fois (`v_montants`) au lieu d'un appel par part : ceux de
-- `montants_par_taux_facture` pour une facture qui n'est pas reprise, son résultat inchangé.
create or replace function public.calcul_vente_facturee(p_facture_id uuid)
returns table (genre text, motif text, encaissement_id uuid, annule_id uuid, avoir_id uuid, origine text, date_effet date,
               moyen text, ligne_bancaire_id uuid, taux numeric, ttc_centimes bigint, base_centimes bigint,
               tva_centimes bigint)
language plpgsql
stable
set search_path = public
as $$
declare
  v_facture public.factures_emises;
  v_regime text;
  v_motif text;
  v_fait date;
  v_e public.encaissements_factures;
  v_part record;
  v_cle text;
  v_p bigint;
  v_montant bigint;
  v_somme bigint;
  v_cumul bigint;
  v_deja bigint;
  v_v bigint;
  v_t bigint;
  v_tva bigint;
  v_tva_avant bigint;
  v_ht_avant bigint;
  v_siennes jsonb;
  v_original jsonb;
  v_tva_originale jsonb;
  v_tva_e jsonb;
  v_parts_de jsonb := '{}';
  v_tva_de jsonb := '{}';
  v_encaisse jsonb := '{}';
  v_portee jsonb := '{}';
  v_lignes jsonb := '[]';
  -- A8b : une facture reprise de l'ancien logiciel (`importee`, A8a), et les montants par taux de la facture, lus une fois.
  v_reprise boolean;
  v_montants jsonb;
begin
  select f.* into v_facture from public.factures_emises f
   where f.id = p_facture_id and f.type = 'facture' and f.statut in ('validee', 'importee') and f.source_de_la_vente;
  if not found then
    return;
  end if;
  -- A8b (EC3-Q9, A8-Q1) : une facture reprise compte par son registre, les encaissements d'après sa reprise. La règle du
  -- cumul part de ce qui en était encaissé avant (A8-Q6), net de ses avoirs repris ; elle n'a pas de document — émise
  -- par l'ancien logiciel, sa créance est dans la reprise — ; et sa TVA n'est exigible ici qu'à l'encaissement de
  -- services sans l'option pour les débits : la livraison d'un bien et la facture sur les débits, d'avant la reprise,
  -- l'ancien logiciel les a déclarées. Un avoir que l'application émet sur elle régularise, à sa date.
  v_reprise := v_facture.statut = 'importee';
  -- Les montants par taux de la facture, lus une fois pour toute la règle : ceux qu'elle transmet ; d'une facture reprise,
  -- ceux de la règle de TVA que ses montants déclarés suivaient (`montants_par_taux_du_document`).
  if v_reprise then
    v_montants := coalesce((select jsonb_agg(to_jsonb(m)) from public.montants_par_taux_du_document(p_facture_id) m), '[]');
  else
    v_montants := coalesce((select jsonb_agg(to_jsonb(m)) from public.montants_par_taux_facture(p_facture_id) m), '[]');
  end if;
  -- Le régime, là où la base le fige : la nature des opérations, et l'option pour les débits des seuls services.
  v_regime := case when v_facture.nature_operation = 'biens' then 'livraison'
                   when v_facture.nature_operation is distinct from 'services' then 'nature'
                   when v_facture.option_debits is null then 'option_debits'
                   when v_facture.option_debits then 'debits'
                   else 'encaissement' end;
  if v_regime in ('nature', 'option_debits') then
    v_motif := v_regime;
  elsif jsonb_array_length(v_montants) = 0 then
    v_motif := 'sans_lignes';
  end if;

  -- Les encaissements qui comptent, dans leur ordre — leur date, leur création, leur identifiant —, chacun réparti sur
  -- les taux de la facture, au centime, pour son montant.
  if v_motif is null then
    <<lecture>>
    for v_e in select e.* from public.encaissements_factures e
                where e.dossier_id = v_facture.dossier_id and e.facture_id = p_facture_id and e.retire_le is null
                order by e.date_encaissement, e.cree_le, e.id loop
      v_montant := (v_e.montant * 100)::bigint;
      v_somme := 0;
      v_siennes := '{}';
      for v_part in select t.taux as part_taux, (t.montant * 100)::bigint as part_centimes
                      from public.encaissements_factures_taux t
                     where t.encaissement_id = v_e.id and t.dossier_id = v_facture.dossier_id loop
        if sign(v_part.part_centimes) <> sign(v_montant)
           or not exists (select 1 from jsonb_array_elements(v_montants) m where (m ->> 'taux')::numeric = v_part.part_taux) then
          v_motif := 'encaissement_illisible';
          exit lecture;
        end if;
        v_siennes := v_siennes || jsonb_build_object(trim_scale(v_part.part_taux)::text, v_part.part_centimes);
        v_somme := v_somme + v_part.part_centimes;
      end loop;
      if v_montant = 0 or v_somme <> v_montant then
        v_motif := 'encaissement_illisible';
        exit lecture;
      end if;
      v_parts_de := v_parts_de || jsonb_build_object(v_e.id::text, v_siennes);
    end loop;
  end if;

  -- A8b (A8-Q6) : le départ du cumul d'une facture reprise, taux par taux — ce qui en était encaissé avant la reprise, et
  -- la TVA que la règle lui rend sur V et T nets de ses avoirs repris, tous datés d'avant la reprise : celle que
  -- l'ancien logiciel a portée. Un taux que ses avoirs repris annulent n'a plus de TTC à répartir.
  if v_motif is null and v_reprise then
    for v_cle, v_p in select trim_scale((g.valeur ->> 'taux')::numeric)::text, ((g.valeur ->> 'encaisse')::numeric * 100)::bigint
                        from public.factures_importees fi
                        cross join lateral jsonb_array_elements(fi.encaisse_par_taux) with ordinality g(valeur, rang)
                       where fi.facture_id = p_facture_id and (g.valeur ->> 'encaisse')::numeric <> 0
                       order by g.rang loop
      select coalesce(sum(x.tva), 0), coalesce(sum(x.base + x.tva), 0) into v_v, v_t
        from (select (m ->> 'base_centimes')::bigint as base, (m ->> 'tva_centimes')::bigint as tva
                from jsonb_array_elements(v_montants) m
               where (m ->> 'taux')::numeric = v_cle::numeric
              union all
              select -m.base_centimes, -m.tva_centimes
                from public.factures_importees ai
                join public.factures_emises a on a.id = ai.facture_id
                cross join lateral public.montants_par_taux_du_document(a.id) m
               where ai.origine_id = p_facture_id and a.dossier_id = v_facture.dossier_id and a.type = 'avoir'
                 and a.statut = 'importee' and m.taux = v_cle::numeric) x;
      if v_t <= 0 then
        v_motif := 'ttc_nul';
        exit;
      end if;
      v_encaisse := v_encaisse || jsonb_build_object(v_cle, v_p);
      v_portee := v_portee || jsonb_build_object(v_cle, public.prorata_arrondi(v_v, v_p, v_t));
    end loop;
  end if;

  -- La règle du cumul, taux par taux, dans l'ordre des encaissements.
  if v_motif is null then
    <<cumul>>
    for v_e in select e.* from public.encaissements_factures e
                where e.dossier_id = v_facture.dossier_id and e.facture_id = p_facture_id and e.retire_le is null
                order by e.date_encaissement, e.cree_le, e.id loop
      v_siennes := v_parts_de -> (v_e.id::text);
      v_tva_originale := null;
      if v_e.annule_id is not null then
        -- Une contre-passation : l'exact opposé d'un encaissement compté AVANT elle, taux par taux.
        v_original := v_parts_de -> (v_e.annule_id::text);
        v_tva_originale := v_tva_de -> (v_e.annule_id::text);
        if v_original is null or v_tva_originale is null
           or (select count(*) from jsonb_object_keys(v_original)) <> (select count(*) from jsonb_object_keys(v_siennes))
           or exists (select 1 from jsonb_each_text(v_siennes) s
                       where (v_original ->> s.key) is null or (v_original ->> s.key)::bigint <> -(s.value::bigint)) then
          v_motif := 'contre_passation_illisible';
          exit cumul;
        end if;
      end if;
      v_tva_e := '{}';
      for v_cle, v_p in select s.key, s.value::bigint from jsonb_each_text(v_siennes) s loop
        v_cumul := coalesce((v_encaisse ->> v_cle)::bigint, 0) + v_p;
        v_deja := coalesce((v_portee ->> v_cle)::bigint, 0);
        if v_tva_originale is not null then
          v_tva := -((v_tva_originale ->> v_cle)::bigint);
        else
          -- V et T du taux, nets des avoirs datés au plus tard du jour de l'encaissement ; d'une facture reprise (A8b),
          -- aussi de ses avoirs repris, datés d'avant la reprise.
          select coalesce(sum(x.tva), 0), coalesce(sum(x.base + x.tva), 0) into v_v, v_t
            from (select (m ->> 'base_centimes')::bigint as base, (m ->> 'tva_centimes')::bigint as tva
                    from jsonb_array_elements(v_montants) m
                   where (m ->> 'taux')::numeric = v_cle::numeric
                  union all
                  select -m.base_centimes, -m.tva_centimes
                    from public.factures_emises a cross join lateral public.montants_par_taux_facture(a.id) m
                   where a.dossier_id = v_facture.dossier_id and a.facture_origine_id = p_facture_id and a.type = 'avoir'
                     and a.statut = 'validee' and a.source_de_la_vente and a.date_emission <= v_e.date_encaissement
                     and m.taux = v_cle::numeric
                  union all
                  select -m.base_centimes, -m.tva_centimes
                    from public.factures_importees ai
                    join public.factures_emises a on a.id = ai.facture_id
                    cross join lateral public.montants_par_taux_du_document(a.id) m
                   where ai.origine_id = p_facture_id and a.dossier_id = v_facture.dossier_id and a.type = 'avoir'
                     and a.statut = 'importee' and a.date_emission <= v_e.date_encaissement and m.taux = v_cle::numeric) x;
          if v_t <= 0 then
            v_motif := 'ttc_nul';
            exit cumul;
          end if;
          v_tva := public.prorata_arrondi(v_v, v_cumul, v_t) - v_deja;
        end if;
        v_encaisse := v_encaisse || jsonb_build_object(v_cle, v_cumul);
        v_portee := v_portee || jsonb_build_object(v_cle, v_deja + v_tva);
        v_tva_e := v_tva_e || jsonb_build_object(v_cle, v_tva);
        v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('genre', 'part', 'encaissement_id', v_e.id,
          'annule_id', v_e.annule_id, 'date_effet', v_e.date_encaissement, 'moyen', v_e.moyen,
          'ligne_bancaire_id', v_e.ligne_bancaire_id, 'taux', v_cle::numeric, 'ttc_centimes', v_p,
          'base_centimes', v_p - v_tva, 'tva_centimes', v_tva));
      end loop;
      v_tva_de := v_tva_de || jsonb_build_object(v_e.id::text, v_tva_e);
    end loop;
  end if;

  if v_motif is not null then
    return query select 'ecartee'::text, v_motif, null::uuid, null::uuid, null::uuid, null::text, null::date, null::text,
                        null::uuid, null::numeric, null::bigint, null::bigint, null::bigint;
    return;
  end if;

  -- Les documents, à leur date d'émission : la facture, puis ses avoirs, en négatif. Une facture reprise (A8b) n'en a
  -- pas, ni ses avoirs repris : seuls les avoirs que l'application émet sur elle.
  if not v_reprise then
    v_lignes := v_lignes || coalesce((
      select jsonb_agg(jsonb_build_object('genre', 'document', 'date_effet', v_facture.date_emission, 'taux', m.taux,
                                          'ttc_centimes', m.ttc_centimes, 'base_centimes', m.base_centimes,
                                          'tva_centimes', m.tva_centimes))
        from public.montants_par_taux_facture(p_facture_id) m), '[]');
  end if;
  v_lignes := v_lignes || coalesce((
    select jsonb_agg(jsonb_build_object('genre', 'document', 'avoir_id', a.id, 'date_effet', a.date_emission, 'taux', m.taux,
                                        'ttc_centimes', -m.ttc_centimes, 'base_centimes', -m.base_centimes,
                                        'tva_centimes', -m.tva_centimes))
      from public.factures_emises a cross join lateral public.montants_par_taux_facture(a.id) m
     where a.dossier_id = v_facture.dossier_id and a.facture_origine_id = p_facture_id and a.type = 'avoir'
       and a.statut = 'validee' and a.source_de_la_vente), '[]');

  -- Les exigibilités. Des services : chaque part, à la date de son encaissement.
  if v_regime = 'encaissement' then
    v_lignes := v_lignes || coalesce((
      select jsonb_agg(x || '{"genre": "exigibilite", "origine": "encaissement"}'::jsonb)
        from jsonb_array_elements(v_lignes) x where x ->> 'genre' = 'part'), '[]');
  else
    -- Un bien, ou des services sur les débits : un fait générateur, la livraison ou la date de la facture. Les parts
    -- d'avant à leur date ; à lui, ce que la facture porte nette des avoirs datés jusque-là, moins ce que ces parts ont
    -- rendu exigible ; un avoir d'après, à sa date.
    v_fait := case when v_regime = 'livraison' then coalesce(v_facture.date_prestation, v_facture.date_emission)
                   else v_facture.date_emission end;
    -- A8b : d'une facture reprise, ni les parts ni le fait générateur : l'ancien logiciel a déclaré sa TVA ; ses avoirs
    -- de l'application seuls, plus bas.
    if not v_reprise then
      v_lignes := v_lignes || coalesce((
        select jsonb_agg(x || '{"genre": "exigibilite", "origine": "encaissement"}'::jsonb)
          from jsonb_array_elements(v_lignes) x where x ->> 'genre' = 'part' and (x ->> 'date_effet')::date < v_fait), '[]');
      for v_cle in select distinct trim_scale(u.taux)::text
                     from (select m.taux from public.montants_par_taux_facture(p_facture_id) m
                           union all
                           select m.taux from public.factures_emises a cross join lateral public.montants_par_taux_facture(a.id) m
                            where a.dossier_id = v_facture.dossier_id and a.facture_origine_id = p_facture_id
                              and a.type = 'avoir' and a.statut = 'validee' and a.source_de_la_vente) u loop
        select coalesce(sum(x.tva), 0), coalesce(sum(x.base + x.tva), 0) into v_v, v_t
          from (select m.base_centimes as base, m.tva_centimes as tva from public.montants_par_taux_facture(p_facture_id) m
                 where m.taux = v_cle::numeric
                union all
                select -m.base_centimes, -m.tva_centimes
                  from public.factures_emises a cross join lateral public.montants_par_taux_facture(a.id) m
                 where a.dossier_id = v_facture.dossier_id and a.facture_origine_id = p_facture_id and a.type = 'avoir'
                   and a.statut = 'validee' and a.source_de_la_vente and a.date_emission <= v_fait
                   and m.taux = v_cle::numeric) x;
        select coalesce(sum((x ->> 'tva_centimes')::bigint), 0), coalesce(sum((x ->> 'base_centimes')::bigint), 0)
          into v_tva_avant, v_ht_avant
          from jsonb_array_elements(v_lignes) x
         where x ->> 'genre' = 'part' and (x ->> 'date_effet')::date < v_fait and (x ->> 'taux')::numeric = v_cle::numeric;
        if v_t - v_v - v_ht_avant <> 0 or v_v - v_tva_avant <> 0 then
          v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('genre', 'exigibilite',
            'origine', case when v_regime = 'livraison' then 'livraison' else 'facture' end, 'date_effet', v_fait,
            'taux', v_cle::numeric, 'base_centimes', v_t - v_v - v_ht_avant, 'tva_centimes', v_v - v_tva_avant));
        end if;
      end loop;
    end if;
    v_lignes := v_lignes || coalesce((
      select jsonb_agg(x || '{"genre": "exigibilite", "origine": "avoir"}'::jsonb)
        from jsonb_array_elements(v_lignes) x
       where x ->> 'genre' = 'document' and x ->> 'avoir_id' is not null and (x ->> 'date_effet')::date > v_fait), '[]');
  end if;

  return query
    select r.genre, null::text, r.encaissement_id, r.annule_id, r.avoir_id, r.origine, r.date_effet, r.moyen,
           r.ligne_bancaire_id, r.taux, r.ttc_centimes, r.base_centimes, r.tva_centimes
      from jsonb_to_recordset(v_lignes) as r(genre text, encaissement_id uuid, annule_id uuid, avoir_id uuid, origine text,
                                             date_effet date, moyen text, ligne_bancaire_id uuid, taux numeric,
                                             ttc_centimes bigint, base_centimes bigint, tva_centimes bigint);
end
$$;

-- ══ 5. LA MÊME RÈGLE, RECOMPOSÉE D'UN BLOC ══════════

-- Celle de l'export (20261026000623_validation_des_ventes_facturees) ; seules les lignes marquées « A8b » s'y
-- ajoutent — le départ du cumul, les montants et les avoirs repris, les documents et le fait générateur fermés
-- à une facture reprise. Pour une autre facture, les mêmes montants (`montants_par_taux_facture`), le même cumul
-- (son départ nul) : le même résultat, au même coût.
create or replace function public.ecritures_attendues_de_la_periode(p_dossier_id uuid, p_frontiere date, p_fin date)
returns table (genre text, source_id uuid, date_source date, motif text, detail text, lignes text[])
language plpgsql
stable
set search_path = public
set jit = off
set enable_nestloop = off
as $$
begin
  -- Une requête planifiée à chaque appel sur les valeurs reçues ($1 le dossier, $2 la frontière, $3 la fin de la période),
  -- jointe par hachage : le planificateur estime mal ce que rendent ses étapes enchaînées, et des boucles imbriquées la
  -- rendraient quadratique (mesuré : 1,2 à 1,9 s au lieu de 0,25 à 0,4 s pour 3 000 encaissements). Et sans compilation à
  -- la volée (`jit`), que la production n'emploie pas et qui coûterait ici dix secondes de plus que la requête.
  return query execute $q$
with recursive
-- ── Le dossier : son modèle comptable et les comptes de ses rôles, lus une fois ──
dossier as (
  select d.mode_comptable as mode, public.compte_du_role(d.id, 'banque') as banque,
         public.compte_du_role(d.id, 'clients') as clients, public.compte_du_role(d.id, 'tva_collectee') as collectee,
         public.compte_du_role(d.id, 'tva_collectee_en_attente') as attente,
         public.compte_du_role(d.id, 'valeurs_a_l_encaissement') as valeurs, public.compte_du_role(d.id, 'caisse') as caisse,
         public.compte_du_role(d.id, 'services_bancaires') as frais_bancaires,
         public.compte_du_role(d.id, 'ventes_de_biens') as ventes_de_biens,
         public.compte_du_role(d.id, 'prestations_de_services') as prestations
    from public.dossiers d
   where d.id = $1
),
-- ── LES SOURCES DE LA PÉRIODE ──
-- Celles dont une date y tombe — l'émission d'une facture ou d'un avoir source, la livraison d'une facture, un
-- encaissement d'une facture source, un mouvement que l'un d'eux cite, classé par ses encaissements ou libre —, et celles
-- dont le brouillon y propose une ligne. Une source n'écrit qu'à ses dates : une autre n'a, dans la période, ni rien à
-- écrire ni rien de proposé. Sans frontière, la période part du début des temps.
candidates as (
  select case when f.type = 'avoir' then 'avoir' else 'facture' end as genre, f.id, f.date_emission as date_source,
         coalesce(f.facture_origine_id, f.id) as facture_id
    from public.factures_emises f
   where f.dossier_id = $1 and f.statut = 'validee' and f.source_de_la_vente
     and (f.date_emission <= $3 and ($2 is null or f.date_emission > $2)
          or f.type = 'facture' and f.date_prestation <= $3 and ($2 is null or f.date_prestation > $2))
  union
  select 'encaissement', e.id, e.date_encaissement, e.facture_id
    from public.encaissements_factures e
    join public.factures_emises f on f.id = e.facture_id
   where e.dossier_id = $1 and f.source_de_la_vente
     and e.date_encaissement <= $3 and ($2 is null or e.date_encaissement > $2)
  union
  select 'mouvement', l.id, l.date, null::uuid
    from public.lignes_bancaires l
   where l.dossier_id = $1 and l.date <= $3 and ($2 is null or l.date > $2)
     and (l.encaissements_de_factures or public.mouvement_libre(l))
     and exists (select 1 from public.encaissements_factures e
                   join public.factures_emises f on f.id = e.facture_id
                  where e.ligne_bancaire_id = l.id and e.dossier_id = $1 and f.source_de_la_vente)
  union
  select case when f.type = 'avoir' then 'avoir' else 'facture' end, f.id, f.date_emission,
         coalesce(f.facture_origine_id, f.id)
    from public.ecritures_brouillon b
    join public.factures_emises f on f.id = b.facture_id
   where b.dossier_id = $1 and b.statut = 'proposee'
     and b.date <= $3 and ($2 is null or b.date > $2)
  union
  select 'encaissement', e.id, e.date_encaissement, e.facture_id
    from public.ecritures_brouillon b
    join public.encaissements_factures e on e.id = b.encaissement_id
   where b.dossier_id = $1 and b.statut = 'proposee'
     and b.date <= $3 and ($2 is null or b.date > $2)
  union
  select 'mouvement', l.id, l.date, null::uuid
    from public.ecritures_brouillon b
    join public.lignes_bancaires l on l.id = b.ligne_bancaire_id
   where b.dossier_id = $1 and b.statut = 'proposee'
     and b.date <= $3 and ($2 is null or b.date > $2)
     and b.facture_id is null and b.encaissement_id is null and b.piece_id is null and b.immobilisation_id is null
     and b.vehicule_id is null and b.declaration_tva_id is null and b.cotisation_id is null
     and (l.encaissements_de_factures or public.mouvement_libre(l))
     and exists (select 1 from public.encaissements_factures e
                   join public.factures_emises f on f.id = e.facture_id
                  where e.ligne_bancaire_id = l.id and e.dossier_id = $1 and f.source_de_la_vente)
),
-- ══ LA RÈGLE DU CUMUL, POUR TOUTES CES FACTURES À LA FOIS : `calcul_vente_facturee`, redite d'un bloc ══
-- Les factures dont une source dépend, et celles dont un mouvement de la période porte un encaissement.
utiles as (
  select c.facture_id as id from candidates c where c.facture_id is not null
  union
  select e.facture_id
    from candidates c
    join public.encaissements_factures e on e.ligne_bancaire_id = c.id and e.dossier_id = $1
   where c.genre = 'mouvement'
),
-- Celles que la règle compte : des factures validées sources, chacune son régime, là où la base le fige ; et, depuis A8b,
-- des factures reprises de l'ancien logiciel (`reprise`), sources de leur vente par leur import.
fac as (
  select f.id, f.dossier_id, f.date_emission, f.date_prestation, f.nature_operation, f.statut = 'importee' as reprise,
         case when f.nature_operation = 'biens' then 'livraison'
              when f.nature_operation is distinct from 'services' then 'nature'
              when f.option_debits is null then 'option_debits'
              when f.option_debits then 'debits'
              else 'encaissement' end as regime
    from utiles u
    join public.factures_emises f on f.id = u.id
   where f.type = 'facture' and f.statut in ('validee', 'importee') and f.source_de_la_vente
),
-- Les montants par taux : ceux que le document transmet ; d'une facture reprise, ceux de la règle de TVA que ses montants
-- déclarés suivaient (`montants_par_taux_du_document`).
montants as (
  select x.id as facture_id, m.taux, m.base_centimes as base, m.tva_centimes as tva, m.ttc_centimes as ttc
    from fac x
    cross join lateral public.montants_par_taux_facture(x.id) m
   where not x.reprise
  union all
  select x.id, m.taux, m.base_centimes, m.tva_centimes, m.ttc_centimes
    from fac x
    cross join lateral public.montants_par_taux_du_document(x.id) m
   where x.reprise
),
-- Les avoirs validés sources ; et ceux d'une facture reprise que l'ancien logiciel a émis (`repris`), qui la citent dans
-- `factures_importees`, datés d'avant la reprise : ils diminuent V et T, sans document.
avoirs as (
  select x.id as facture_id, a.id as avoir_id, a.date_emission, false as repris, m.taux, m.base_centimes as base,
         m.tva_centimes as tva, m.ttc_centimes as ttc
    from fac x
    join public.factures_emises a on a.dossier_id = x.dossier_id and a.facture_origine_id = x.id and a.type = 'avoir'
                                 and a.statut = 'validee' and a.source_de_la_vente
    cross join lateral public.montants_par_taux_facture(a.id) m
  union all
  select x.id, a.id, a.date_emission, true, m.taux, m.base_centimes, m.tva_centimes, m.ttc_centimes
    from fac x
    join public.factures_importees ai on ai.origine_id = x.id
    join public.factures_emises a on a.id = ai.facture_id and a.dossier_id = x.dossier_id and a.type = 'avoir'
                                 and a.statut = 'importee'
    cross join lateral public.montants_par_taux_du_document(a.id) m
   where x.reprise
),
-- Les encaissements qui comptent (non retirés), dans leur ordre : leur date, leur création, leur identifiant.
encs as (
  select e.id, e.facture_id, e.annule_id, e.date_encaissement, e.moyen, e.ligne_bancaire_id,
         (e.montant * 100)::bigint as montant,
         row_number() over (partition by e.facture_id order by e.date_encaissement, e.cree_le, e.id) as rang
    from fac x
    join public.encaissements_factures e on e.dossier_id = x.dossier_id and e.facture_id = x.id and e.retire_le is null
),
parts as (
  select e.facture_id, e.id as encaissement_id, e.rang, e.annule_id, e.date_encaissement, t.taux,
         (t.montant * 100)::bigint as part
    from encs e
    join fac x on x.id = e.facture_id
    join public.encaissements_factures_taux t on t.encaissement_id = e.id and t.dossier_id = x.dossier_id
),
-- Un encaissement illisible : de montant nul, ou que ses parts ne font pas, au centime, sur des taux de la facture et
-- de son signe ; sans part, il est illisible.
lectures as (
  select e.facture_id,
         coalesce(e.montant = 0 or coalesce(sum(p.part), 0) <> e.montant
                  or bool_or(sign(p.part) <> sign(e.montant) or m.facture_id is null), true) as illisible
    from encs e
    left join parts p on p.encaissement_id = e.id
    left join montants m on m.facture_id = p.facture_id and m.taux = p.taux
   group by e.facture_id, e.id, e.montant
),
-- La facture écartée avant la règle : sa nature, son option, ses lignes, un encaissement illisible.
avec_lignes as (
  select distinct m.facture_id from montants m
),
illisibles as (
  select distinct l.facture_id from lectures l where l.illisible
),
avant_le_cumul as (
  select x.id,
         case when x.regime in ('nature', 'option_debits') then x.regime
              when a.facture_id is null then 'sans_lignes'
              when i.facture_id is not null then 'encaissement_illisible'
         end as motif
    from fac x
    left join avec_lignes a on a.facture_id = x.id
    left join illisibles i on i.facture_id = x.id
),
-- V et T de chaque part d'un encaissement — pas d'une contre-passation : la TVA et le TTC de son taux, nets des avoirs
-- datés au plus tard du jour de l'encaissement.
vt as (
  select p.encaissement_id, p.taux, p.facture_id, p.rang,
         coalesce(max(m.tva), 0) - coalesce(sum(a.tva), 0) as v,
         coalesce(max(m.base + m.tva), 0) - coalesce(sum(a.base + a.tva), 0) as t
    from parts p
    join avant_le_cumul c on c.id = p.facture_id and c.motif is null
    left join montants m on m.facture_id = p.facture_id and m.taux = p.taux
    left join avoirs a on a.facture_id = p.facture_id and a.taux = p.taux and a.date_emission <= p.date_encaissement
   where p.annule_id is null
   group by p.encaissement_id, p.taux, p.facture_id, p.rang
),
-- A8b (A8-Q6) : le départ du cumul d'une facture reprise, taux par taux — ce qui en était encaissé avant la reprise, et la
-- TVA que la règle lui rend sur V et T nets de ses avoirs repris, tous datés d'avant la reprise : celle que l'ancien
-- logiciel a portée. Un taux que ses avoirs repris annulent n'a plus de TTC à répartir.
departs as (
  select d.facture_id, d.taux, d.encaisse,
         coalesce(max(m.tva), 0) - coalesce(sum(a.tva), 0) as v,
         coalesce(max(m.base + m.tva), 0) - coalesce(sum(a.base + a.tva), 0) as t
    from (select x.id as facture_id, (g.valeur ->> 'taux')::numeric as taux,
                 ((g.valeur ->> 'encaisse')::numeric * 100)::bigint as encaisse
            from fac x
            join avant_le_cumul c on c.id = x.id and c.motif is null
            join public.factures_importees fi on fi.facture_id = x.id
            cross join lateral jsonb_array_elements(fi.encaisse_par_taux) g(valeur)
           where x.reprise and (g.valeur ->> 'encaisse')::numeric <> 0) d
    left join montants m on m.facture_id = d.facture_id and m.taux = d.taux
    left join avoirs a on a.facture_id = d.facture_id and a.taux = d.taux and a.repris
   group by d.facture_id, d.taux, d.encaisse
),
departs_portes as (
  select d.facture_id, d.taux, d.encaisse,
         (sign(d.v * d.encaisse) * div(2 * abs(d.v * d.encaisse) + d.t, 2 * d.t))::bigint as portee
    from departs d
   where d.t > 0
),
-- Chaque taux d'une facture : sa chaîne de parts, dans l'ordre des encaissements, que la règle parcourt un rang à la
-- fois, toutes les factures ensemble. La part d'un encaissement porte ce que V × cumul / T arrondi rend (le demi loin de
-- zéro), moins ce que portaient les parts d'avant ; celle d'une contre-passation, l'opposé exact de la TVA de son
-- encaissement.
chaine as (
  select p.facture_id, p.taux, p.encaissement_id, p.annule_id, p.part, v.v, v.t,
         row_number() over (partition by p.facture_id, p.taux order by p.rang) as k
    from parts p
    join avant_le_cumul c on c.id = p.facture_id and c.motif is null
    left join vt v on v.encaissement_id = p.encaissement_id and v.taux = p.taux
),
cumul (facture_id, taux, k, encaissement_id, encaisse, portee, tva, tvas) as (
  -- Le premier rang part de rien ; d'une facture reprise (A8b), de son départ.
  select c.facture_id, c.taux, c.k, c.encaissement_id, coalesce(d.encaisse, 0) + c.part, coalesce(d.portee, 0) + x.tva,
         x.tva, jsonb_build_object(c.encaissement_id::text, x.tva)
    from chaine c
    left join departs_portes d on d.facture_id = c.facture_id and d.taux = c.taux
    cross join lateral (
      select case when c.annule_id is not null then null::bigint
                  when c.t > 0 then (sign(c.v * (coalesce(d.encaisse, 0) + c.part))
                                     * div(2 * abs(c.v * (coalesce(d.encaisse, 0) + c.part)) + c.t, 2 * c.t))::bigint
                                    - coalesce(d.portee, 0)
             end as tva) x
   where c.k = 1
  union all
  select c.facture_id, c.taux, c.k, c.encaissement_id, r.encaisse + c.part, r.portee + x.tva, x.tva,
         r.tvas || jsonb_build_object(c.encaissement_id::text, x.tva)
    from cumul r
    join chaine c on c.facture_id = r.facture_id and c.taux = r.taux and c.k = r.k + 1
    cross join lateral (
      select case when c.annule_id is not null then -((r.tvas ->> c.annule_id::text)::bigint)
                  when c.t > 0 then (sign(c.v * (r.encaisse + c.part))
                                     * div(2 * abs(c.v * (r.encaisse + c.part)) + c.t, 2 * c.t))::bigint - r.portee
             end as tva) x
),
-- La facture écartée par la règle : au premier encaissement, dans leur ordre, qui est une contre-passation qui n'est pas
-- l'exact opposé, taux par taux, d'un encaissement compté avant elle, ou dont une part a un TTC que ses avoirs annulent.
signatures as (
  select p.encaissement_id,
         string_agg(trim_scale(p.taux)::text || ':' || p.part, ',' order by p.taux) as signature,
         string_agg(trim_scale(p.taux)::text || ':' || (-p.part), ',' order by p.taux) as opposee
    from parts p
   group by p.encaissement_id
),
echecs as (
  select e.facture_id, e.rang, 'contre_passation_illisible' as motif
    from encs e
    left join encs o on o.id = e.annule_id and o.facture_id = e.facture_id
    left join signatures s on s.encaissement_id = e.id
    left join signatures so on so.encaissement_id = o.id
   where e.annule_id is not null and (o.id is null or o.rang >= e.rang or s.signature is distinct from so.opposee)
  union all
  select v.facture_id, v.rang, 'ttc_nul'
    from vt v
   where v.t <= 0
  union all
  -- A8b : le départ d'une facture reprise, avant tout encaissement.
  select d.facture_id, 0, 'ttc_nul'
    from departs d
   where d.t <= 0
),
premiers_echecs as (
  select distinct on (z.facture_id) z.facture_id, z.motif from echecs z order by z.facture_id, z.rang
),
ecartees as (
  select c.id as facture_id, coalesce(c.motif, z.motif) as motif
    from avant_le_cumul c
    left join premiers_echecs z on z.facture_id = c.id
),
comptees as (
  select x.id, x.regime, x.nature_operation, x.date_emission, x.reprise,
         case when x.regime = 'livraison' then coalesce(x.date_prestation, x.date_emission) else x.date_emission end as fait
    from fac x
    join ecartees c on c.facture_id = x.id and c.motif is null
),
-- Ce qu'une facture comptée pèse : ses parts, ses documents — la facture et ses avoirs à leur date —, ses exigibilités.
part_lignes as (
  select p.facture_id, p.encaissement_id, p.date_encaissement as date_effet, p.taux, p.part as ttc, p.part - k.tva as base,
         k.tva
    from parts p
    join comptees q on q.id = p.facture_id
    join cumul k on k.facture_id = p.facture_id and k.taux = p.taux and k.encaissement_id = p.encaissement_id
),
-- Une facture reprise (A8b) n'a pas de document, ni ses avoirs repris : seuls les avoirs que l'application émet sur elle.
documents as (
  select m.facture_id, null::uuid as avoir_id, q.date_emission as date_effet, m.taux, m.ttc, m.base, m.tva
    from montants m
    join comptees q on q.id = m.facture_id
   where not q.reprise
  union all
  select a.facture_id, a.avoir_id, a.date_emission, a.taux, -a.ttc, -a.base, -a.tva
    from avoirs a
    join comptees q on q.id = a.facture_id
   where not a.repris
),
avoirs_au_fait as (
  select a.facture_id, a.taux, sum(a.tva) as tva, sum(a.base + a.tva) as ttc
    from avoirs a
    join comptees q on q.id = a.facture_id
   where q.regime <> 'encaissement' and a.date_emission <= q.fait
   group by a.facture_id, a.taux
),
parts_avant_le_fait as (
  select r.facture_id, r.taux, sum(r.tva) as tva, sum(r.base) as base
    from part_lignes r
    join comptees q on q.id = r.facture_id
   where q.regime <> 'encaissement' and r.date_effet < q.fait
   group by r.facture_id, r.taux
),
-- D'une facture reprise (A8b), pas de fait générateur : l'ancien logiciel a déclaré la TVA de sa livraison ou de sa
-- facture sur les débits.
taux_du_fait as (
  select m.facture_id, m.taux from montants m join comptees q on q.id = m.facture_id
   where q.regime <> 'encaissement' and not q.reprise
  union
  select a.facture_id, a.taux from avoirs a join comptees q on q.id = a.facture_id
   where q.regime <> 'encaissement' and not q.reprise
),
au_fait as (
  select u.facture_id, case when q.regime = 'livraison' then 'livraison' else 'facture' end as origine, q.fait, u.taux,
         coalesce(m.tva, 0) - coalesce(af.tva, 0) as v, coalesce(m.base + m.tva, 0) - coalesce(af.ttc, 0) as t,
         coalesce(pa.tva, 0) as tva_avant, coalesce(pa.base, 0) as ht_avant
    from taux_du_fait u
    join comptees q on q.id = u.facture_id
    left join montants m on m.facture_id = u.facture_id and m.taux = u.taux
    left join avoirs_au_fait af on af.facture_id = u.facture_id and af.taux = u.taux
    left join parts_avant_le_fait pa on pa.facture_id = u.facture_id and pa.taux = u.taux
),
exigibilites as (
  -- Des services : chaque part, à la date de son encaissement ; un bien ou des services sur les débits : les parts d'avant
  -- le fait générateur ; à lui, ce que la facture porte nette des avoirs datés jusque-là, moins ce que ces parts ont rendu
  -- exigible ; un avoir d'après, à sa date.
  select r.facture_id, 'encaissement' as origine, r.encaissement_id, null::uuid as avoir_id, r.date_effet, r.taux, r.tva
    from part_lignes r
    join comptees q on q.id = r.facture_id
   where q.regime = 'encaissement' or (r.date_effet < q.fait and not q.reprise)
  union all
  select g.facture_id, g.origine, null::uuid, null::uuid, g.fait, g.taux, g.v - g.tva_avant
    from au_fait g
   where g.t - g.v - g.ht_avant <> 0 or g.v - g.tva_avant <> 0
  union all
  select d.facture_id, 'avoir', null::uuid, d.avoir_id, d.date_effet, d.taux, d.tva
    from documents d
    join comptees q on q.id = d.facture_id
   where q.regime <> 'encaissement' and d.avoir_id is not null and d.date_effet > q.fait
),
exigibles as (
  select distinct g.encaissement_id, g.taux from exigibilites g where g.origine = 'encaissement'
),
-- ══ CE QUE CHAQUE SOURCE ÉCRIT : `ecriture_attendue_vente_facturee`, redite d'un bloc ══
-- La facture ou l'avoir : en engagement, le document à sa date ; dans les deux modèles, la TVA due avant l'encaissement.
soldes_documents as (
  select c.genre, c.id, d.date_effet as jour, x.compte, null::uuid as ligne, x.m
    from candidates c
    join documents d on d.facture_id = c.facture_id
                    and (c.genre = 'facture' and d.avoir_id is null or c.genre = 'avoir' and d.avoir_id = c.id)
    join comptees q on q.id = c.facture_id
    cross join dossier o
    cross join lateral (values (o.clients, d.ttc),
                               (case when q.nature_operation = 'biens' then o.ventes_de_biens else o.prestations end, -d.base),
                               (o.attente, -d.tva)) x(compte, m)
   where c.genre in ('facture', 'avoir') and o.mode = 'engagement'
  union all
  select c.genre, c.id, g.date_effet, x.compte, null::uuid, x.m
    from candidates c
    join exigibilites g on g.facture_id = c.facture_id and g.origine <> 'encaissement'
                       and (c.genre = 'facture' and g.origine in ('livraison', 'facture') or c.genre = 'avoir' and g.avoir_id = c.id)
    cross join dossier o
    cross join lateral (values (case when o.mode = 'tresorerie' then o.clients else o.attente end, g.tva),
                               (o.collectee, -g.tva)) x(compte, m)
   where c.genre in ('facture', 'avoir')
),
-- L'encaissement : son compte de trésorerie — la banque d'un mouvement de son jour, sinon les valeurs à l'encaissement
-- (la caisse pour des espèces), le compte de contrepartie choisi d'une compensation ou d'un autre moyen sans mouvement ;
-- une contre-passation sans mouvement défait son encaissement là où il a été écrit.
encaissements_sources as (
  select c.id, e.facture_id, e.date_encaissement,
         case when t.ligne_bancaire_id is not null
                then case when m.date = t.date_encaissement then o.banque
                          when t.moyen = 'especes' then o.caisse else o.valeurs end
              when t.moyen = 'especes' then o.caisse
              when t.moyen in ('compensation', 'autre') then t.compte_contrepartie
              else o.valeurs end as compte,
         case when t.ligne_bancaire_id is not null and m.date = t.date_encaissement then m.id end as ligne,
         case when t.ligne_bancaire_id is null and t.moyen in ('compensation', 'autre') and t.compte_contrepartie is null
                then 'compte_a_choisir'
              when t.ligne_bancaire_id is null and t.moyen in ('compensation', 'autre')
                   and public.refus_compte_de_contrepartie($1, t.compte_contrepartie) is not null
                then 'compte_refuse' end as motif,
         t.compte_contrepartie
    from candidates c
    join public.encaissements_factures e on e.id = c.id and e.dossier_id = $1
    left join public.encaissements_factures t
           on t.id = case when e.annule_id is not null and e.ligne_bancaire_id is null then e.annule_id else e.id end
    left join public.lignes_bancaires m on m.id = t.ligne_bancaire_id
    cross join dossier o
   where c.genre = 'encaissement'
),
encaissements_comptes as (
  select distinct r.encaissement_id from part_lignes r
),
soldes_encaissements as (
  select 'encaissement' as genre, s.id, s.date_encaissement as jour, x.compte, x.ligne, x.m
    from encaissements_sources s
    join part_lignes r on r.encaissement_id = s.id
    join comptees q on q.id = s.facture_id
    left join exigibles y on y.encaissement_id = s.id and y.taux = r.taux
    cross join dossier o
    cross join lateral (
      select s.compte, s.ligne, r.ttc
      union all
      select case when q.nature_operation = 'biens' then o.ventes_de_biens else o.prestations end, null::uuid, -r.base
       where o.mode = 'tresorerie'
      union all
      select case when y.encaissement_id is not null then o.collectee else o.clients end, null::uuid, -r.tva
       where o.mode = 'tresorerie'
      union all
      select o.clients, null::uuid, -r.ttc
       where o.mode = 'engagement'
      union all
      select o.attente, null::uuid, r.tva
       where o.mode = 'engagement' and y.encaissement_id is not null
      union all
      select o.collectee, null::uuid, -r.tva
       where o.mode = 'engagement' and y.encaissement_id is not null) x(compte, ligne, m)
   where s.motif is null
),
-- Le mouvement : ce qu'il porte, les encaissements non retirés qui le citent, qu'aucune contre-passation sans mouvement
-- n'annule ; la banque de ce que ceux du même jour n'ont pas porté — l'exemplaire d'une facture qui n'est pas source porte
-- la sienne, comme un encaissement du même jour —, le 511 (le 53) de ceux d'un autre jour, les frais du tout.
mouvements_sources as (
  select c.id, l.date as jour, (l.montant * 100)::bigint as montant, l.encaissements_de_factures as classe
    from candidates c
    join public.lignes_bancaires l on l.id = c.id and l.dossier_id = $1
   where c.genre = 'mouvement'
),
portes as (
  select s.id as mouvement_id, e.id, e.facture_id, e.date_encaissement, e.moyen, (e.montant * 100)::bigint as montant,
         f.statut in ('validee', 'importee') and f.source_de_la_vente as compte_sa_vente, f.source_de_la_vente as source,
         f.numero
    from mouvements_sources s
    join public.encaissements_factures e on e.ligne_bancaire_id = s.id and e.dossier_id = $1 and e.retire_le is null
    join public.factures_emises f on f.id = e.facture_id
   where not exists (select 1 from public.encaissements_factures n
                      where n.annule_id = e.id and n.retire_le is null and n.ligne_bancaire_id is null)
),
exemplaires as (
  select x.facture_id, count(*) as n
    from public.pieces x
   where x.dossier_id = $1 and x.statut = 'validee' and x.type_piece = 'vente'
     and x.facture_id in (select p.facture_id from portes p where not p.compte_sa_vente)
   group by x.facture_id
),
sans_exemplaire as (
  select distinct on (p.mouvement_id) p.mouvement_id, p.numero
    from portes p
    left join exemplaires x on x.facture_id = p.facture_id
   where not p.compte_sa_vente and coalesce(x.n, 0) <> 1
   order by p.mouvement_id, p.numero collate "C", p.facture_id
),
mouvements_juges as (
  select s.id, s.jour, s.montant, s.classe, bool_or(p.compte_sa_vente) as justifie,
         bool_or(z.motif is not null) as vente_ecartee, coalesce(sum(p.montant), 0) as total,
         coalesce(sum(p.montant) filter (where p.date_encaissement = s.jour or not p.source), 0) as meme_jour,
         n.numero as facture_non_source, n.mouvement_id is not null as sans_son_exemplaire
    from mouvements_sources s
    left join portes p on p.mouvement_id = s.id
    left join ecartees z on z.facture_id = p.facture_id
    left join sans_exemplaire n on n.mouvement_id = s.id
   group by s.id, s.jour, s.montant, s.classe, n.mouvement_id, n.numero
),
soldes_mouvements as (
  select 'mouvement' as genre, j.id, j.jour, case when p.moyen = 'especes' then o.caisse else o.valeurs end as compte,
         j.id as ligne, -p.montant as m
    from mouvements_juges j
    join portes p on p.mouvement_id = j.id and p.date_encaissement <> j.jour and p.source
    cross join dossier o
   where j.justifie and not j.sans_son_exemplaire and not coalesce(j.vente_ecartee, false)
  union all
  select 'mouvement', j.id, j.jour, x.compte, j.id, x.m
    from mouvements_juges j
    cross join dossier o
    cross join lateral (values (o.banque, j.montant - j.meme_jour), (o.frais_bancaires, j.total - j.montant)) x(compte, m)
   where j.justifie and not j.sans_son_exemplaire and not coalesce(j.vente_ecartee, false)
),
-- Les lignes : sommées par date, compte et mouvement, les nulles ôtées, triées octet par octet.
lignes_des_sources as (
  select s.genre, s.id, array_agg(s.texte order by s.texte collate "C") as lignes
    from (select y.genre, y.id,
                 to_char(y.jour, 'YYYY-MM-DD') || '|' || y.compte || '|' || case when sum(y.m) > 0 then 'debit' else 'credit' end
                 || '|' || abs(sum(y.m)) || '|' || coalesce(y.ligne::text, '') as texte
            from (select d.genre, d.id, d.jour, d.compte, d.ligne, d.m::numeric as m from soldes_documents d
                  union all
                  select e.genre, e.id, e.jour, e.compte, e.ligne, e.m::numeric from soldes_encaissements e
                  union all
                  select v.genre, v.id, v.jour, v.compte, v.ligne, v.m::numeric from soldes_mouvements v) y
           group by y.genre, y.id, y.jour, y.compte, y.ligne
          having sum(y.m) <> 0) s
   group by s.genre, s.id
)
select c.genre, c.id, c.date_source,
       case when c.genre in ('facture', 'avoir', 'encaissement') and z.motif is not null then 'vente_ecartee'
            when c.genre = 'encaissement' and k.encaissement_id is not null then es.motif
            when c.genre = 'mouvement' and j.justifie and j.sans_son_exemplaire then 'mouvement_facture_non_source'
            when c.genre = 'mouvement' and j.justifie and j.vente_ecartee then 'mouvement_vente_ecartee'
            when c.genre = 'mouvement' and j.justifie and l.lignes is not null and not j.classe then 'mouvement_non_classe'
            when c.genre = 'mouvement' and j.justifie and l.lignes is not null
                 and (j.total - j.montant < 0 or (j.total - j.montant) * 100 > least(50000, abs(j.total) * 2))
              then 'mouvement_ecart'
       end,
       case when c.genre in ('facture', 'avoir', 'encaissement') and z.motif is not null then z.motif
            when c.genre = 'encaissement' and k.encaissement_id is not null and es.motif = 'compte_refuse' then es.compte_contrepartie
            when c.genre = 'mouvement' and j.justifie and j.sans_son_exemplaire then j.facture_non_source
       end,
       case when c.genre in ('facture', 'avoir', 'encaissement') and z.motif is not null then '{}'::text[]
            when c.genre = 'encaissement' and es.motif is not null then '{}'::text[]
            when c.genre = 'mouvement' and j.justifie and l.lignes is not null
                 and (not j.classe or j.total - j.montant < 0 or (j.total - j.montant) * 100 > least(50000, abs(j.total) * 2))
              then '{}'::text[]
            else coalesce(l.lignes, '{}'::text[]) end
  from candidates c
  left join ecartees z on z.facture_id = c.facture_id
  left join encaissements_sources es on es.id = c.id and c.genre = 'encaissement'
  left join encaissements_comptes k on k.encaissement_id = c.id and c.genre = 'encaissement'
  left join mouvements_juges j on j.id = c.id and c.genre = 'mouvement'
  left join lignes_des_sources l on l.genre = c.genre and l.id = c.id
$q$ using p_dossier_id, p_frontiere, p_fin;
end
$$;

-- ══ 6. LA COMPOSITION SOURCE PAR SOURCE : LE MOUVEMENT D'UNE FACTURE REPRISE ══════════

-- Celle de l'export (20261024052038_virement_mixte) ; seules les deux conditions du mouvement changent : une facture
-- reprise, source de sa vente, la compte comme une facture validée.
create or replace function public.ecriture_attendue_vente_facturee(p_dossier_id uuid, p_source text, p_source_id uuid,
  out motif text, out detail text, out lignes text[])
returns record
language plpgsql
stable
set search_path = public
as $$
declare
  v_mode text;
  v_banque text;
  v_clients text;
  v_collectee text;
  v_attente text;
  v_valeurs text;
  v_caisse text;
  v_frais_bancaires text;
  v_produit text;
  v_facture_id uuid;
  v_document public.factures_emises;
  v_e public.encaissements_factures;
  v_t public.encaissements_factures;
  v_m public.lignes_bancaires;
  v_calcul jsonb;
  v_x record;
  v_compte text;
  v_ligne uuid;
  v_montant bigint;
  v_total bigint;
  v_meme_jour bigint;
  v_frais bigint;
  v_soldes jsonb := '[]';
begin
  lignes := '{}';
  select d.mode_comptable into v_mode from public.dossiers d where d.id = p_dossier_id;
  v_banque := public.compte_du_role(p_dossier_id, 'banque');
  v_clients := public.compte_du_role(p_dossier_id, 'clients');
  v_collectee := public.compte_du_role(p_dossier_id, 'tva_collectee');
  v_attente := public.compte_du_role(p_dossier_id, 'tva_collectee_en_attente');
  v_valeurs := public.compte_du_role(p_dossier_id, 'valeurs_a_l_encaissement');
  v_caisse := public.compte_du_role(p_dossier_id, 'caisse');
  v_frais_bancaires := public.compte_du_role(p_dossier_id, 'services_bancaires');

  if p_source = 'mouvement' then
    select l.* into v_m from public.lignes_bancaires l where l.id = p_source_id and l.dossier_id = p_dossier_id;
    -- Ce qu'il justifie : les encaissements non retirés qui le citent, qu'aucune contre-passation sans mouvement n'annule.
    -- Une facture reprise de l'ancien logiciel (A8b) compte sa vente comme une facture validée source.
    if not exists (select 1 from public.encaissements_factures e
                     join public.factures_emises f on f.id = e.facture_id
                    where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
                      and f.statut in ('validee', 'importee') and f.source_de_la_vente
                      and public.encaissement_justifie_son_mouvement(e.id)) then
      return;
    end if;
    -- Le virement mixte (VF2-Q2, selon VF5-Q2 : la manière A) : l'encaissement d'une facture qui n'est pas source de sa
    -- vente ne retient plus le mouvement quand cette facture a exactement un exemplaire désigné, une pièce de vente
    -- validée de ce dossier (VF1) — c'est cette pièce qui compte la vente, et qui écrit elle-même sa banque sur ce
    -- mouvement, à sa date (src/lib/contrepartieBanque.ts). Sans lui, ou avec plusieurs, le refus d'hier, la facture
    -- nommée : celle qui a le plus petit numéro, comme le classement la nomme.
    select f.numero into detail
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
     where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
       and not (f.statut in ('validee', 'importee') and f.source_de_la_vente) and public.encaissement_justifie_son_mouvement(e.id)
       and (select count(*) from public.pieces p
             where p.facture_id = f.id and p.dossier_id = p_dossier_id and p.statut = 'validee' and p.type_piece = 'vente') <> 1
     order by f.numero collate "C", f.id
     limit 1;
    if found then
      motif := 'mouvement_facture_non_source';
      return;
    end if;
    if exists (select 1 from public.encaissements_factures e
                where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
                  and public.encaissement_justifie_son_mouvement(e.id)
                  and exists (select 1 from public.calcul_vente_facturee(e.facture_id) c where c.genre = 'ecartee')) then
      motif := 'mouvement_vente_ecartee';
      return;
    end if;
    v_montant := (v_m.montant * 100)::bigint;
    select coalesce(sum((e.montant * 100)::bigint), 0),
           coalesce(sum((e.montant * 100)::bigint) filter (where e.date_encaissement = v_m.date or not f.source_de_la_vente), 0)
      into v_total, v_meme_jour
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
     where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
       and public.encaissement_justifie_son_mouvement(e.id);
    -- Ceux du même jour ont porté la banque eux-mêmes ; ceux d'un autre jour sont passés au 511 (au 53 pour des
    -- espèces), que le mouvement solde. La pièce d'une facture qui n'est pas source porte elle-même sa banque sur ce
    -- mouvement, quel que soit le jour de son encaissement : comme un encaissement du même jour. Les frais sont ceux
    -- du tout.
    v_soldes := coalesce((
      select jsonb_agg(jsonb_build_object('d', v_m.date, 'c', case when e.moyen = 'especes' then v_caisse else v_valeurs end,
                                          'l', v_m.id, 'm', -((e.montant * 100)::bigint)))
        from public.encaissements_factures e
        join public.factures_emises f on f.id = e.facture_id
       where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
         and public.encaissement_justifie_son_mouvement(e.id) and e.date_encaissement <> v_m.date
         and f.source_de_la_vente), '[]');
    v_frais := v_total - v_montant;
    v_soldes := v_soldes || jsonb_build_array(
      jsonb_build_object('d', v_m.date, 'c', v_banque, 'l', v_m.id, 'm', v_montant - v_meme_jour),
      jsonb_build_object('d', v_m.date, 'c', v_frais_bancaires, 'l', v_m.id, 'm', v_frais));
  else
    -- Une facture, un avoir ou un encaissement : la facture dont il dépend.
    if p_source = 'encaissement' then
      select e.* into v_e from public.encaissements_factures e where e.id = p_source_id and e.dossier_id = p_dossier_id;
      v_facture_id := v_e.facture_id;
    else
      select f.* into v_document from public.factures_emises f where f.id = p_source_id and f.dossier_id = p_dossier_id;
      v_facture_id := case when v_document.type = 'avoir' then v_document.facture_origine_id else v_document.id end;
    end if;
    v_calcul := coalesce((select jsonb_agg(to_jsonb(c)) from public.calcul_vente_facturee(v_facture_id) c), '[]');
    if exists (select 1 from jsonb_array_elements(v_calcul) x where x ->> 'genre' = 'ecartee') then
      motif := 'vente_ecartee';
      detail := (select x ->> 'motif' from jsonb_array_elements(v_calcul) x where x ->> 'genre' = 'ecartee');
      return;
    end if;
    select case when f.nature_operation = 'biens' then public.compte_du_role(p_dossier_id, 'ventes_de_biens')
                else public.compte_du_role(p_dossier_id, 'prestations_de_services') end
      into v_produit from public.factures_emises f where f.id = v_facture_id;

    if p_source = 'encaissement' then
      if not exists (select 1 from jsonb_array_elements(v_calcul) x
                      where x ->> 'genre' = 'part' and x ->> 'encaissement_id' = p_source_id::text) then
        return;
      end if;
      -- [T] : une contre-passation sans mouvement défait son encaissement là où il a été écrit.
      v_t := v_e;
      if v_e.annule_id is not null and v_e.ligne_bancaire_id is null then
        select o.* into v_t from public.encaissements_factures o where o.id = v_e.annule_id;
      end if;
      if v_t.ligne_bancaire_id is not null then
        select l.* into v_m from public.lignes_bancaires l where l.id = v_t.ligne_bancaire_id;
        if v_m.date = v_t.date_encaissement then
          v_compte := v_banque;
          v_ligne := v_m.id;
        else
          v_compte := case when v_t.moyen = 'especes' then v_caisse else v_valeurs end;
        end if;
      elsif v_t.moyen = 'especes' then
        v_compte := v_caisse;
      elsif v_t.moyen in ('compensation', 'autre') then
        if v_t.compte_contrepartie is null then
          motif := 'compte_a_choisir';
          return;
        end if;
        if public.refus_compte_de_contrepartie(p_dossier_id, v_t.compte_contrepartie) is not null then
          motif := 'compte_refuse';
          detail := v_t.compte_contrepartie;
          return;
        end if;
        v_compte := v_t.compte_contrepartie;
      else
        v_compte := v_valeurs;
      end if;
      for v_x in select (x ->> 'taux')::numeric as part_taux, (x ->> 'ttc_centimes')::bigint as ttc,
                        (x ->> 'base_centimes')::bigint as ht, (x ->> 'tva_centimes')::bigint as tva,
                        exists (select 1 from jsonb_array_elements(v_calcul) y
                                 where y ->> 'genre' = 'exigibilite' and y ->> 'origine' = 'encaissement'
                                   and y ->> 'encaissement_id' = p_source_id::text
                                   and (y ->> 'taux')::numeric = (x ->> 'taux')::numeric) as exigible
                   from jsonb_array_elements(v_calcul) x
                  where x ->> 'genre' = 'part' and x ->> 'encaissement_id' = p_source_id::text loop
        v_soldes := v_soldes || jsonb_build_array(
          jsonb_build_object('d', v_e.date_encaissement, 'c', v_compte, 'l', v_ligne, 'm', v_x.ttc));
        if v_mode = 'tresorerie' then
          v_soldes := v_soldes || jsonb_build_array(
            jsonb_build_object('d', v_e.date_encaissement, 'c', v_produit, 'l', null, 'm', -v_x.ht),
            jsonb_build_object('d', v_e.date_encaissement, 'c', case when v_x.exigible then v_collectee else v_clients end,
                               'l', null, 'm', -v_x.tva));
        else
          v_soldes := v_soldes || jsonb_build_array(
            jsonb_build_object('d', v_e.date_encaissement, 'c', v_clients, 'l', null, 'm', -v_x.ttc));
          if v_x.exigible then
            v_soldes := v_soldes || jsonb_build_array(
              jsonb_build_object('d', v_e.date_encaissement, 'c', v_attente, 'l', null, 'm', v_x.tva),
              jsonb_build_object('d', v_e.date_encaissement, 'c', v_collectee, 'l', null, 'm', -v_x.tva));
          end if;
        end if;
      end loop;
    else
      -- La facture, ou l'avoir : en engagement, le document à sa date ; dans les deux modèles, la TVA due avant
      -- l'encaissement — la livraison d'un bien, la facture sur les débits, l'avoir d'après — à sa date.
      if v_mode = 'engagement' then
        for v_x in select (x ->> 'date_effet')::date as jour, (x ->> 'ttc_centimes')::bigint as ttc,
                          (x ->> 'base_centimes')::bigint as base, (x ->> 'tva_centimes')::bigint as tva
                     from jsonb_array_elements(v_calcul) x
                    where x ->> 'genre' = 'document'
                      and coalesce(x ->> 'avoir_id', '') = case when p_source = 'avoir' then p_source_id::text else '' end loop
          v_soldes := v_soldes || jsonb_build_array(
            jsonb_build_object('d', v_x.jour, 'c', v_clients, 'l', null, 'm', v_x.ttc),
            jsonb_build_object('d', v_x.jour, 'c', v_produit, 'l', null, 'm', -v_x.base),
            jsonb_build_object('d', v_x.jour, 'c', v_attente, 'l', null, 'm', -v_x.tva));
        end loop;
      end if;
      for v_x in select (x ->> 'date_effet')::date as jour, (x ->> 'tva_centimes')::bigint as tva
                   from jsonb_array_elements(v_calcul) x
                  where x ->> 'genre' = 'exigibilite' and x ->> 'origine' <> 'encaissement'
                    and (p_source = 'facture' and x ->> 'origine' in ('livraison', 'facture')
                         or p_source = 'avoir' and x ->> 'avoir_id' = p_source_id::text) loop
        v_soldes := v_soldes || jsonb_build_array(
          jsonb_build_object('d', v_x.jour, 'c', case when v_mode = 'tresorerie' then v_clients else v_attente end,
                             'l', null, 'm', v_x.tva),
          jsonb_build_object('d', v_x.jour, 'c', v_collectee, 'l', null, 'm', -v_x.tva));
      end loop;
    end if;
  end if;

  -- Les lignes : sommées par date, compte et mouvement, les nulles ôtées.
  lignes := array(
    select t.texte
      from (select to_char(s.jour, 'YYYY-MM-DD') || '|' || s.compte || '|' || case when s.solde > 0 then 'debit' else 'credit' end
                   || '|' || abs(s.solde) || '|' || coalesce(s.ligne::text, '') as texte
              from (select (x ->> 'd')::date as jour, x ->> 'c' as compte, (x ->> 'l')::uuid as ligne,
                           sum((x ->> 'm')::bigint) as solde
                      from jsonb_array_elements(v_soldes) x
                     group by 1, 2, 3) s
             where s.solde <> 0) t
     order by t.texte collate "C");

  -- Le mouvement : rien à écrire quand tout est du même jour et sans écart ; sinon, classé, et à l'écart des frais près.
  if p_source = 'mouvement' and cardinality(lignes) > 0 then
    if not v_m.encaissements_de_factures then
      motif := 'mouvement_non_classe';
      lignes := '{}';
    elsif v_frais < 0 or v_frais * 100 > least(50000, abs(v_total) * 2) then
      motif := 'mouvement_ecart';
      lignes := '{}';
    end if;
  end if;
end
$$;

-- ══ 7. « MA SIMULATION » COMPTE LES ENCAISSEMENTS D'UNE FACTURE REPRISE ══════════

-- Celle de l'export (20261027055129_simulation_des_ventes_facturees) ; seule la ligne marquée « A8b » change.
create or replace function public.ventes_facturees_de_la_simulation(p_dossier_id uuid, p_annee integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bascule boolean;
  v_mode text;
  v_debut date;
  v_fin date;
  v_par_mois jsonb;
  v_sources jsonb;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : le cabinet du dossier, ou un accès client qui porte la case « Banque » ; un
  --    dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.gere_la_banque(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2. L'année.
  if p_annee is null or p_annee < 2000 or p_annee > 2100 then
    raise exception 'Exercice invalide.' using errcode = '22023';
  end if;
  select d.ventes_par_les_factures, d.mode_comptable into v_bascule, v_mode
    from public.dossiers d where d.id = p_dossier_id;
  -- Un dossier qui n'a pas basculé : rien.
  if not v_bascule then
    return jsonb_build_object('par_mois', '{}'::jsonb, 'sources', '[]'::jsonb);
  end if;
  v_debut := make_date(p_annee, 1, 1);
  v_fin := make_date(p_annee, 12, 31);
  with factures as materialized (
    -- Les factures sources qui ont un événement dans l'année, et elles seules : en trésorerie, un encaissement compté
    -- (non retiré) daté de l'année ; en engagement, la facture, ou l'un de ses avoirs sources validés, émis dans
    -- l'année. La règle du cumul ne se refait que pour elles.
    -- A8b : une facture reprise de l'ancien logiciel compte par les encaissements d'après sa reprise (EC3-Q9).
    select f.id
      from public.factures_emises f
     where f.dossier_id = p_dossier_id and f.type = 'facture' and f.statut in ('validee', 'importee') and f.source_de_la_vente
       and case when v_mode = 'engagement'
                then f.date_emission between v_debut and v_fin
                     or exists (select 1 from public.factures_emises a
                                 where a.dossier_id = p_dossier_id and a.facture_origine_id = f.id and a.type = 'avoir'
                                   and a.statut = 'validee' and a.source_de_la_vente
                                   and a.date_emission between v_debut and v_fin)
                else exists (select 1 from public.encaissements_factures e
                              where e.dossier_id = p_dossier_id and e.facture_id = f.id and e.retire_le is null
                                and e.date_encaissement between v_debut and v_fin)
           end
  ),
  evenements as (
    -- Ce que la règle du cumul en rend dans l'année : les parts (trésorerie) ou les documents (engagement), leur
    -- hors-taxe. Une facture écartée ne rend que sa ligne « ecartee » : rien n'en est compté.
    select to_char(c.date_effet, 'YYYY-MM') as mois, c.base_centimes
      from factures f
     cross join lateral public.calcul_vente_facturee(f.id) c
     where c.genre = case when v_mode = 'engagement' then 'document' else 'part' end
       and c.date_effet between v_debut and v_fin
  )
  select coalesce(jsonb_object_agg(m.mois, m.centimes), '{}'::jsonb) into v_par_mois
    from (select e.mois, sum(e.base_centimes)::bigint as centimes from evenements e group by e.mois) m;
  -- Les factures et avoirs sources, de toute année : leur exemplaire ne compte jamais.
  select coalesce(jsonb_agg(f.id order by f.id), '[]'::jsonb) into v_sources
    from public.factures_emises f
   where f.dossier_id = p_dossier_id and f.statut = 'validee' and f.source_de_la_vente;
  return jsonb_build_object('par_mois', v_par_mois, 'sources', v_sources);
end
$$;

-- ══ 8. L'AVOIR D'UNE FACTURE REPRISE ══════════

-- Celle de l'export (20261105231034_acomptes_des_devis) ; seules les lignes marquées « A8b » s'y ajoutent, dans la
-- branche de l'avoir. Les trois chaînes que lit la garde de tête d'A9a sont intactes.
create or replace function public.enregistrer_facture(p_dossier_id uuid, p_facture_id uuid, p_facture jsonb,
  p_lignes jsonb, p_valider boolean default false)
returns table (facture_id uuid, numero text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_numero text;
  v_type text;
  v_statut text;
  v_date_emission date;
  v_origine factures_emises%rowtype;
  v_option_debits boolean;
  v_deja_credite numeric;
  v_credite numeric;
  -- A7 : la provenance, puis ce que la validation fige.
  v_ligne record;
  v_contact uuid;
  v_emetteur_siret text;
  v_dossier dossiers%rowtype;
  v_statut_tva text;
  v_article_exoneration text;
  v_numero_tva_attribue boolean;
  v_numero_tva text;
  v_denomination text;
  v_forme_juridique text;
  v_capital numeric;
  v_rcs_ville text;
  v_mentions_identite text;
  v_courante parametres_facturation%rowtype;
  v_rib parametres_facturation%rowtype;
  v_courante_id uuid;
  v_rib_id uuid;
  v_mandataire text;
  v_cabinet boolean;
  -- A7-Q2 et A7-Q3 : l'adresse de l'émetteur, ce qu'un refus nomme, les blancs (ceux de `numero_tva_du_vendeur`).
  v_emetteur_adresse text;
  v_libelle text;
  -- P5b2 : l'acompte d'un devis et la facture finale qui le reprend.
  v_acompte boolean := false;
  v_garder_lignes boolean := false;
  v_devis_finale uuid;
  v_devis_origine uuid;
  v_role_origine text;
  v_devis_lien uuid;
  v_role_lien text;
  v_texte text;
  v_taux_absent numeric;
  v_taux_depasse numeric;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  -- A8b : la date de reprise des factures du dossier, que l'avoir d'une facture reprise suit.
  v_reprise date;
  v_blancs constant text := chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200)
    || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
begin
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_lignes) is distinct from 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Une facture doit porter au moins une ligne.' using errcode = '22023';
  end if;

  if coalesce(p_facture->>'type', 'facture') not in ('facture', 'avoir') then
    raise exception 'Type de document inconnu : %.', p_facture->>'type' using errcode = '22023';
  end if;

  v_date_emission := coalesce(nullif(p_facture->>'date_emission', '')::date, current_date);

  if p_facture_id is null and p_facture->>'type' = 'avoir' then
    -- L'AVOIR. Il se crée validé : un avoir en attente n'a pas de sens, la correction est décidée quand on la fait.
    if not p_valider then
      raise exception 'Un avoir se crée validé : il n''a pas de brouillon.' using errcode = '22023';
    end if;
    -- La facture d'origine est VERROUILLÉE : deux avoirs concurrents sur la même facture se suivent, et le second
    -- voit ce que le premier a déjà crédité.
    select f.* into v_origine
    from factures_emises f
    where f.id = nullif(p_facture->>'facture_origine_id', '')::uuid and f.dossier_id = p_dossier_id
    for update;
    if not found then
      raise exception 'Facture d''origine introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    -- A8b : une facture reprise de l'ancien logiciel (`importee`, A8a) se corrige aussi par un avoir, document NEUF de
    -- l'application (A.3.4 de la conception) ; jamais un brouillon ni un avoir, repris ou non.
    if v_origine.type <> 'facture' or v_origine.statut not in ('validee', 'importee') then
      raise exception 'Un avoir corrige une facture validée, jamais un brouillon ni un autre avoir.' using errcode = '22023';
    end if;
    if v_date_emission < v_origine.date_emission then
      raise exception 'Un avoir ne précède pas la facture qu''il corrige (émise le %).',
        to_char(v_origine.date_emission, 'DD/MM/YYYY') using errcode = '22023';
    end if;
    if v_origine.statut = 'importee' then
      -- A8b (A8B-Q1) : une facture reprise qui mêle biens et services — l'avoir prend sa nature, et une facture source
      -- qui mêle les deux ne se valide pas encore (`fixer_source_de_la_vente`) ; ses mots seraient ceux d'une facture à
      -- scinder, ce qu'une facture reprise ne peut pas être.
      if v_origine.nature_operation = 'mixte' then
        raise exception 'La facture % est reprise de l''ancien logiciel et mêle biens et services : son avoir ne se fait pas encore dans l''application, qui ne sait pas répartir entre les deux ce qu''il crédite.',
          v_origine.numero using errcode = '22023';
      end if;
      -- A8b (A8-Q2) : l'application émet les documents d'après la reprise des factures — l'avoir d'une facture reprise
      -- aussi, comme ses encaissements ; ce qui précède, l'ancien logiciel l'a émis et déclaré.
      select d.reprise_des_factures_le into v_reprise from dossiers d where d.id = p_dossier_id;
      if v_reprise is null or v_date_emission < v_reprise then
        raise exception 'La facture % est reprise de l''ancien logiciel : son avoir se date du jour de la reprise des factures, le %, ou d''après — ce qui précède, l''ancien logiciel l''a émis.',
          v_origine.numero, to_char(v_reprise, 'DD/MM/YYYY') using errcode = '22023';
      end if;
      -- L'émetteur : celui que le dossier pose (son nom, son SIRET, son adresse), comme une facture de l'espace client le
      -- reprend du dossier (A7-Q2) — une facture reprise n'en porte aucun, son original vit dans l'ancien logiciel.
      select d.nom, d.siret, d.adresse into v_origine.emetteur_nom, v_origine.emetteur_siret, v_origine.emetteur_adresse
        from dossiers d where d.id = p_dossier_id;
    end if;
    -- P5b2. L'avoir d'un acompte ou d'une facture finale se juge sous le verrou de leur devis : deux avoirs, ou un avoir et
    -- la validation d'une facture finale, se suivent.
    select l.devis_id, l.role into v_devis_origine, v_role_origine
      from devis_factures l where l.facture_id = v_origine.id;
    if v_devis_origine is not null then
      perform 1 from devis d where d.id = v_devis_origine for update;
    end if;
    -- Ses lignes CRÉDITENT : quantités négatives, comme l'écran les enregistre (voir FactureAvoirModal).
    -- P5b2 : sauf, sur l'avoir d'une facture finale, une ligne qui défait l'une de ses reprises (elle la cite).
    if exists (select 1 from jsonb_array_elements(p_lignes) as l(valeur)
               where coalesce((l.valeur->>'quantite')::numeric, 0) >= 0
                 and not (coalesce(v_role_origine = 'finale', false)
                          and coalesce(jsonb_typeof(l.valeur->'reprise_facture_id'), 'null') <> 'null')) then
      raise exception 'Les lignes d''un avoir créditent : leurs quantités sont négatives.' using errcode = '22023';
    end if;
    v_credite := -coalesce((p_facture->>'montant_ttc')::numeric, 0);
    if v_credite <= 0 then
      raise exception 'Un avoir crédite un montant : son total est négatif.' using errcode = '22023';
    end if;
    select coalesce(sum(-a.montant_ttc), 0) into v_deja_credite
    from factures_emises a
    where a.facture_origine_id = v_origine.id and a.type = 'avoir';
    -- A8b : les avoirs repris d'une facture reprise l'ont déjà créditée — ils la citent dans `factures_importees`.
    v_deja_credite := v_deja_credite + coalesce((
      select sum(-a.montant_ttc)
        from factures_importees ai
        join factures_emises a on a.id = ai.facture_id
       where ai.origine_id = v_origine.id and a.type = 'avoir'), 0);
    if v_deja_credite + v_credite > v_origine.montant_ttc then
      raise exception 'Cet avoir créditerait % € : la facture % n''a plus que % € à créditer.',
        replace(to_char(v_credite, 'FM999999999990.00'), '.', ','), v_origine.numero,
        replace(to_char(greatest(v_origine.montant_ttc - v_deja_credite, 0), 'FM999999999990.00'), '.', ',')
        using errcode = '22023';
    end if;
    -- P5b2. L'AVOIR D'UN ACOMPTE (CII 503) : tant qu'aucune facture finale validée et non créditée ne le reprend — elle
    -- déduit ce qu'il a facturé —, et en entier, à chaque taux et en une fois : un acompte crédité n'est plus en vigueur.
    if v_origine.acompte then
      select f.numero into v_texte
        from devis_factures l
        join factures_emises f on f.id = l.facture_id
       where l.devis_id = v_devis_origine and l.role = 'finale' and f.statut = 'validee'
         and exists (select 1 from finale_active_du_devis(v_devis_origine) a where a.facture_id = f.id)
         and exists (select 1 from facture_lignes fl where fl.facture_id = f.id and fl.reprise_facture_id = v_origine.id)
       order by f.date_emission, f.numero collate "C"
       limit 1;
      if v_texte is not null then
        raise exception 'L’acompte % est repris par la facture finale % : il ne se crédite pas tant qu’elle le reprend — un avoir de la facture finale d’abord.',
          v_origine.numero, v_texte using errcode = '22023';
      end if;
      if v_deja_credite <> 0 or v_credite <> v_origine.montant_ttc or exists (
           select 1
             from (select coalesce((l.valeur->>'taux_tva')::numeric, 0) as taux, c.ht_centimes as ht, c.tva_centimes as tva
                     from jsonb_array_elements(p_lignes) as l(valeur)
                    cross join lateral centimes_ligne_facture(coalesce((l.valeur->>'quantite')::numeric, 0),
                      coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0), coalesce((l.valeur->>'taux_tva')::numeric, 0), false) c
                   union all
                   select fl.taux_tva, c.ht_centimes, c.tva_centimes
                     from facture_lignes fl
                    cross join lateral centimes_ligne_facture(fl.quantite, fl.prix_unitaire_ht, fl.taux_tva, false) c
                    where fl.facture_id = v_origine.id) as x
            group by x.taux
           having sum(x.ht) <> 0 or sum(x.tva) <> 0) then
        raise exception 'L’avoir d’un acompte le crédite en entier, à chaque taux et en une fois : l’acompte %, de % € TTC, ne se crédite pas en partie.',
          v_origine.numero, replace(to_char(v_origine.montant_ttc, 'FM999999999990.00'), '.', ',') using errcode = '22023';
      end if;
    end if;
  elsif p_facture_id is not null then
    -- La facture doit exister *dans ce dossier* : sans ce contrôle, un dossier dont on est admin
    -- suffirait à modifier la facture d'un autre en passant son id.
    select f.type, f.statut, f.acompte into v_type, v_statut, v_acompte
    from factures_emises f
    where f.id = p_facture_id and f.dossier_id = p_dossier_id
    for update;
    if not found then
      raise exception 'Facture introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    -- Une facture validée est figée (voir CLAUDE.md) : la corriger passe par un avoir. L'écran ne
    -- propose déjà que l'aperçu, ce contrôle est la même règle dite là où elle ne peut pas être
    -- contournée.
    if v_statut = 'validee' then
      raise exception 'Une facture validée ne peut plus être modifiée — passer par un avoir.' using errcode = '22023';
    end if;
    -- P5b2 : le devis dont ce brouillon est la facture finale.
    select l.devis_id into v_devis_finale from devis_factures l where l.facture_id = p_facture_id and l.role = 'finale';
  end if;

  -- A7. LA PROVENANCE, avant toute écriture : ce qui ne lit que la saisie d'abord — l'unité, la référence et la nature de
  -- chaque ligne, dans l'ordre des lignes —, puis ce qui lit la base — le contact d'où vient le client (une facture ; un
  -- avoir prend celui de sa facture), les articles d'où viennent les lignes. Une clé nulle ou absente ne dit rien.
  for v_ligne in select l.valeur, l.ord from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord) order by l.ord loop
    if coalesce(jsonb_typeof(v_ligne.valeur->'unite'), 'null') <> 'null'
       and (jsonb_typeof(v_ligne.valeur->'unite') <> 'string'
            or v_ligne.valeur->>'unite' not in ('C62', 'H87', 'HUR', 'DAY', 'WEE', 'MON', 'ANN', 'KGM', 'MTR', 'MTK', 'LTR', 'KMT', 'LS')) then
      raise exception 'Ligne % : l''unité n''est pas de la liste des unités admises.', v_ligne.ord using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_ligne.valeur->'reference'), 'null') <> 'null'
       and (jsonb_typeof(v_ligne.valeur->'reference') <> 'string'
            or char_length(v_ligne.valeur->>'reference') not between 1 and 100
            or btrim(v_ligne.valeur->>'reference', ' ' || chr(9) || chr(10) || chr(13)) <> v_ligne.valeur->>'reference') then
      raise exception 'Ligne % : la référence tient en un à cent caractères, sans blanc au début ni à la fin.', v_ligne.ord
        using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_ligne.valeur->'nature'), 'null') <> 'null'
       and (jsonb_typeof(v_ligne.valeur->'nature') <> 'string' or v_ligne.valeur->>'nature' not in ('biens', 'services')) then
      raise exception 'Ligne % : la nature d''une ligne est « biens » ou « services ».', v_ligne.ord using errcode = '22023';
    end if;
  end loop;
  if not (p_facture_id is null and coalesce(p_facture->>'type', 'facture') = 'avoir')
     and coalesce(jsonb_typeof(p_facture->'contact_id'), 'null') <> 'null'
     and (jsonb_typeof(p_facture->'contact_id') <> 'string'
          or not exists (select 1 from contacts c where c.dossier_id = p_dossier_id and c.id::text = p_facture->>'contact_id')) then
    raise exception 'Le contact d''où vient le client de la facture est introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  for v_ligne in select l.valeur, l.ord from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord) order by l.ord loop
    if coalesce(jsonb_typeof(v_ligne.valeur->'article_id'), 'null') <> 'null'
       and (jsonb_typeof(v_ligne.valeur->'article_id') <> 'string'
            or not exists (select 1 from articles a where a.dossier_id = p_dossier_id and a.id::text = v_ligne.valeur->>'article_id')) then
      raise exception 'Ligne % : l''article d''où elle vient est introuvable dans ce dossier.', v_ligne.ord using errcode = 'P0002';
    end if;
  end loop;

  -- P5b2. LA DATE DU VERSEMENT ET LES REPRISES, avant toute écriture. La date du versement (BT-9) : sur une facture
  -- d'acompte seulement.
  if coalesce(jsonb_typeof(p_facture->'date_versement_acompte'), 'null') <> 'null' and not v_acompte then
    raise exception 'La date du versement ne se porte que sur une facture d’acompte.' using errcode = '22023';
  end if;
  -- P5b2 (P5B2-Q1) : posée ou changée sur un acompte, jamais après le jour de Paris, comme facturer_acompte_devis.
  if v_acompte then
    if nullif(p_facture->>'date_versement_acompte', '')::date > v_aujourd_hui then
      raise exception 'Le versement ne se date pas dans l’avenir : nous sommes le %.', to_char(v_aujourd_hui, 'DD/MM/YYYY')
        using errcode = '22023';
    end if;
  end if;
  -- Une ligne qui reprend un acompte cite un acompte validé de ce dossier : sur la facture finale de son devis, ou sur
  -- l'avoir de cette facture, qui en défait la reprise.
  for v_ligne in select l.valeur, l.ord from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord) order by l.ord loop
    if coalesce(jsonb_typeof(v_ligne.valeur->'reprise_facture_id'), 'null') <> 'null' then
      if jsonb_typeof(v_ligne.valeur->'reprise_facture_id') <> 'string'
         or not exists (select 1 from factures_emises a
                         where a.dossier_id = p_dossier_id and a.acompte and a.statut = 'validee'
                           and a.id::text = v_ligne.valeur->>'reprise_facture_id') then
        raise exception 'Ligne % : l’acompte qu’elle reprend est introuvable dans ce dossier.', v_ligne.ord using errcode = 'P0002';
      end if;
      if not (coalesce(p_facture_id is not null and v_devis_finale is not null
                and exists (select 1 from devis_factures l
                             where l.devis_id = v_devis_finale and l.role = 'acompte'
                               and l.facture_id::text = v_ligne.valeur->>'reprise_facture_id'), false)
              or coalesce(p_facture_id is null and v_role_origine = 'finale'
                and exists (select 1 from facture_lignes fl
                             where fl.facture_id = v_origine.id
                               and fl.reprise_facture_id::text = v_ligne.valeur->>'reprise_facture_id'), false)) then
        raise exception 'Ligne % : seule la facture finale d’un devis reprend ses acomptes, et seul l’avoir de cette facture défait ses reprises.',
          v_ligne.ord using errcode = '22023';
      end if;
    end if;
  end loop;
  -- L'avoir d'une facture finale ne défait que ses reprises, chacune une fois au plus, à la quantité opposée.
  if p_facture_id is null and v_role_origine = 'finale' and (
       exists (select 1 from jsonb_array_elements(p_lignes) as l(valeur)
                where coalesce(jsonb_typeof(l.valeur->'reprise_facture_id'), 'null') <> 'null'
                  and coalesce((l.valeur->>'quantite')::numeric, 0) <> 1)
       or exists (
         select 1
           from (select x.r, x.p, x.t, x.n, count(*) as c
                   from (select l.valeur->>'reprise_facture_id' as r, coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0) as p,
                                coalesce((l.valeur->>'taux_tva')::numeric, 0) as t, l.valeur->>'nature' as n
                           from jsonb_array_elements(p_lignes) as l(valeur)
                          where coalesce(jsonb_typeof(l.valeur->'reprise_facture_id'), 'null') <> 'null'
                         union all
                         select fl.reprise_facture_id::text, fl.prix_unitaire_ht, fl.taux_tva, fl.nature
                           from factures_emises a
                           join facture_lignes fl on fl.facture_id = a.id
                          where a.facture_origine_id = v_origine.id and a.type = 'avoir' and fl.reprise_facture_id is not null) as x
                  group by x.r, x.p, x.t, x.n) as d
           left join (select fl.reprise_facture_id::text as r, fl.prix_unitaire_ht as p, fl.taux_tva as t, fl.nature as n,
                             count(*) as c
                        from facture_lignes fl
                       where fl.facture_id = v_origine.id and fl.reprise_facture_id is not null
                       group by 1, 2, 3, 4) as o
             on o.r = d.r and o.p = d.p and o.t = d.t and o.n is not distinct from d.n
          where o.c is null or d.c > o.c)) then
    raise exception 'L’avoir défait une reprise que la facture finale % ne porte pas, ou que d’autres avoirs ont déjà défaite.',
      v_origine.numero using errcode = '22023';
  end if;
  -- Un acompte en brouillon garde ses lignes et ses montants : ils se calculent du devis (facturer_acompte_devis).
  if v_acompte then
    if (select count(*) from facture_lignes fl where fl.facture_id = p_facture_id) <> jsonb_array_length(p_lignes)
       or exists (select 1
                    from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord)
                    left join facture_lignes fl on fl.facture_id = p_facture_id and fl.ordre = l.ord - 1
                   where fl.id is null
                      or fl.designation is distinct from l.valeur->>'designation'
                      or fl.quantite is distinct from coalesce((l.valeur->>'quantite')::numeric, 0)
                      or fl.prix_unitaire_ht is distinct from coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0)
                      or fl.taux_tva is distinct from coalesce((l.valeur->>'taux_tva')::numeric, 0)
                      or fl.unite is distinct from l.valeur->>'unite'
                      or fl.reference is distinct from l.valeur->>'reference'
                      or fl.article_id is distinct from (l.valeur->>'article_id')::uuid
                      or fl.nature is distinct from l.valeur->>'nature')
       or exists (select 1 from factures_emises f
                   where f.id = p_facture_id
                     and (f.montant_ht, f.montant_tva, f.montant_ttc) is distinct from
                         (coalesce((p_facture->>'montant_ht')::numeric, 0), coalesce((p_facture->>'montant_tva')::numeric, 0),
                          coalesce((p_facture->>'montant_ttc')::numeric, 0))) then
      raise exception 'Les lignes et les montants d’une facture d’acompte se calculent du devis : ils ne se retouchent pas. Supprimez le brouillon pour en tirer un autre.'
        using errcode = '22023';
    end if;
    v_garder_lignes := true;
  end if;

  if p_facture_id is null and p_facture->>'type' = 'avoir' then
    insert into factures_emises (
      dossier_id, type, facture_origine_id,
      tiers_nom, tiers_adresse, tiers_siret, tiers_siren, type_client, tiers_adresse_electronique,
      code_service, numero_engagement, nature_operation, date_prestation, periode_debut, periode_fin,
      livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays,
      date_emission, notes, mentions_legales,
      emetteur_nom, emetteur_siret, emetteur_adresse,
      montant_ht, montant_tva, montant_ttc, created_by,
      contact_id
    ) values (
      p_dossier_id, 'avoir', v_origine.id,
      v_origine.tiers_nom, v_origine.tiers_adresse, v_origine.tiers_siret, v_origine.tiers_siren,
      v_origine.type_client, v_origine.tiers_adresse_electronique,
      v_origine.code_service, v_origine.numero_engagement, v_origine.nature_operation,
      v_origine.date_prestation, v_origine.periode_debut, v_origine.periode_fin,
      v_origine.livraison_adresse, v_origine.livraison_code_postal, v_origine.livraison_ville, v_origine.livraison_pays,
      v_date_emission, p_facture->>'notes', p_facture->>'mentions_legales',
      v_origine.emetteur_nom, v_origine.emetteur_siret, v_origine.emetteur_adresse,
      coalesce((p_facture->>'montant_ht')::numeric, 0),
      coalesce((p_facture->>'montant_tva')::numeric, 0),
      coalesce((p_facture->>'montant_ttc')::numeric, 0),
      auth.uid(),
      v_origine.contact_id
    )
    returning id, type, statut into v_id, v_type, v_statut;
  elsif p_facture_id is null then
    insert into factures_emises (
      dossier_id, tiers_nom, tiers_adresse, tiers_siret, tiers_email,
      date_emission, date_echeance, notes, mentions_legales,
      emetteur_nom, emetteur_siret, emetteur_adresse,
      montant_ht, montant_tva, montant_ttc, created_by,
      type_client, tiers_siren, tiers_adresse_electronique, code_service, numero_engagement,
      nature_operation, date_prestation, periode_debut, periode_fin,
      livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays,
      contact_id
    ) values (
      p_dossier_id,
      p_facture->>'tiers_nom',
      p_facture->>'tiers_adresse',
      p_facture->>'tiers_siret',
      p_facture->>'tiers_email',
      v_date_emission,
      nullif(p_facture->>'date_echeance', '')::date,
      p_facture->>'notes',
      p_facture->>'mentions_legales',
      p_facture->>'emetteur_nom',
      p_facture->>'emetteur_siret',
      p_facture->>'emetteur_adresse',
      coalesce((p_facture->>'montant_ht')::numeric, 0),
      coalesce((p_facture->>'montant_tva')::numeric, 0),
      coalesce((p_facture->>'montant_ttc')::numeric, 0),
      -- Jamais fourni par l'appelant : c'est l'utilisateur authentifié qui crée, par définition.
      auth.uid(),
      nullif(p_facture->>'type_client', ''),
      nullif(p_facture->>'tiers_siren', ''),
      nullif(p_facture->>'tiers_adresse_electronique', ''),
      nullif(p_facture->>'code_service', ''),
      nullif(p_facture->>'numero_engagement', ''),
      nullif(p_facture->>'nature_operation', ''),
      nullif(p_facture->>'date_prestation', '')::date,
      nullif(p_facture->>'periode_debut', '')::date,
      nullif(p_facture->>'periode_fin', '')::date,
      nullif(p_facture->>'livraison_adresse', ''),
      nullif(p_facture->>'livraison_code_postal', ''),
      nullif(p_facture->>'livraison_ville', ''),
      nullif(p_facture->>'livraison_pays', ''),
      (p_facture->>'contact_id')::uuid
    )
    returning id, type, statut into v_id, v_type, v_statut;
  else
    -- Les mentions de la ligne 28.5 ne changent que si le document les PORTE (`?`) : une clé absente garde la valeur
    -- en place (voir l'en-tête). Le contact d'où vient le client (A7) de même.
    -- P5b2 : la date du versement d'un acompte se retouche avec son brouillon ; égale à sa date, elle ne se dit pas (BT-9).
    if v_acompte then
      perform set_config('jd.acompte_facture', p_facture_id::text, true);
    end if;
    update factures_emises set
      tiers_nom = p_facture->>'tiers_nom',
      tiers_adresse = p_facture->>'tiers_adresse',
      tiers_siret = p_facture->>'tiers_siret',
      tiers_email = p_facture->>'tiers_email',
      date_emission = v_date_emission,
      date_echeance = nullif(p_facture->>'date_echeance', '')::date,
      notes = p_facture->>'notes',
      mentions_legales = p_facture->>'mentions_legales',
      emetteur_nom = p_facture->>'emetteur_nom',
      emetteur_siret = p_facture->>'emetteur_siret',
      emetteur_adresse = p_facture->>'emetteur_adresse',
      montant_ht = coalesce((p_facture->>'montant_ht')::numeric, 0),
      montant_tva = coalesce((p_facture->>'montant_tva')::numeric, 0),
      montant_ttc = coalesce((p_facture->>'montant_ttc')::numeric, 0),
      type_client = case when p_facture ? 'type_client' then nullif(p_facture->>'type_client', '') else type_client end,
      tiers_siren = case when p_facture ? 'tiers_siren' then nullif(p_facture->>'tiers_siren', '') else tiers_siren end,
      tiers_adresse_electronique = case when p_facture ? 'tiers_adresse_electronique'
        then nullif(p_facture->>'tiers_adresse_electronique', '') else tiers_adresse_electronique end,
      code_service = case when p_facture ? 'code_service' then nullif(p_facture->>'code_service', '') else code_service end,
      numero_engagement = case when p_facture ? 'numero_engagement'
        then nullif(p_facture->>'numero_engagement', '') else numero_engagement end,
      nature_operation = case when p_facture ? 'nature_operation'
        then nullif(p_facture->>'nature_operation', '') else nature_operation end,
      date_prestation = case when p_facture ? 'date_prestation'
        then nullif(p_facture->>'date_prestation', '')::date else date_prestation end,
      periode_debut = case when p_facture ? 'periode_debut'
        then nullif(p_facture->>'periode_debut', '')::date else periode_debut end,
      periode_fin = case when p_facture ? 'periode_fin'
        then nullif(p_facture->>'periode_fin', '')::date else periode_fin end,
      livraison_adresse = case when p_facture ? 'livraison_adresse'
        then nullif(p_facture->>'livraison_adresse', '') else livraison_adresse end,
      livraison_code_postal = case when p_facture ? 'livraison_code_postal'
        then nullif(p_facture->>'livraison_code_postal', '') else livraison_code_postal end,
      livraison_ville = case when p_facture ? 'livraison_ville'
        then nullif(p_facture->>'livraison_ville', '') else livraison_ville end,
      livraison_pays = case when p_facture ? 'livraison_pays'
        then nullif(p_facture->>'livraison_pays', '') else livraison_pays end,
      contact_id = case when p_facture ? 'contact_id' then (p_facture->>'contact_id')::uuid else contact_id end,
      date_versement_acompte = case when v_acompte then nullif(case when p_facture ? 'date_versement_acompte'
        then nullif(p_facture->>'date_versement_acompte', '')::date else date_versement_acompte end, v_date_emission)
        else date_versement_acompte end
    where id = p_facture_id;
    perform set_config('jd.acompte_facture', '', true);
    v_id := p_facture_id;
  end if;

  -- Remplacement complet des lignes. Le delete et l'insert sont maintenant dans la même transaction
  -- que tout le reste : un échec de l'un annule l'autre, plus de lignes doublées.
  -- P5b2 : sauf celles d'un acompte en brouillon, gardées telles quelles ; une reprise s'écrit sous l'annonce de la facture.
  if not v_garder_lignes then
    delete from facture_lignes fl where fl.facture_id = v_id;

    perform set_config('jd.reprises_facture', v_id::text, true);
    insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, unite, reference, article_id, nature,
      reprise_facture_id)
    select v_id,
           (l.ord - 1)::integer,
           l.valeur->>'designation',
           coalesce((l.valeur->>'quantite')::numeric, 0),
           coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0),
           coalesce((l.valeur->>'taux_tva')::numeric, 0),
           l.valeur->>'unite',
           l.valeur->>'reference',
           (l.valeur->>'article_id')::uuid,
           l.valeur->>'nature',
           (l.valeur->>'reprise_facture_id')::uuid
    from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord);
    perform set_config('jd.reprises_facture', '', true);
  end if;

  -- A7-Q3. UN IBAN DANS UN TEXTE LIBRE QUE LA FACTURE IMPRIME, quel que soit l'auteur, à chaque enregistrement : sur la
  -- facture telle qu'elle est écrite — ce qu'elle garde d'un brouillon compris —, dans l'ordre où elle s'imprime :
  -- l'émetteur, le client, l'adresse de livraison, le code service et le numéro d'engagement, chaque ligne (sa désignation,
  -- puis sa référence), la mention légale. D'un avoir, ses lignes et sa mention légale seules : le reste est la copie de
  -- sa facture, qu'il ne rejuge pas. Les notes et l'adresse électronique du client ne s'impriment pas.
  select t.libelle into v_libelle
    from (select x.rang, 0 as ligne, x.libelle, x.valeur
            from factures_emises f
            cross join lateral (values
              (1, 'le nom de l''émetteur', f.emetteur_nom), (2, 'l''adresse de l''émetteur', f.emetteur_adresse),
              (3, 'le SIRET de l''émetteur', f.emetteur_siret), (4, 'le nom du client', f.tiers_nom),
              (5, 'l''adresse du client', f.tiers_adresse), (6, 'le SIRET du client', f.tiers_siret),
              (7, 'l''adresse de livraison', f.livraison_adresse), (8, 'le code postal de livraison', f.livraison_code_postal),
              (9, 'la ville de livraison', f.livraison_ville), (10, 'le code service', f.code_service),
              (11, 'le numéro d''engagement', f.numero_engagement), (13, 'la mention légale', f.mentions_legales)
            ) as x(rang, libelle, valeur)
           where f.id = v_id and (v_type <> 'avoir' or x.rang = 13)
          union all
          select 12, l.ordre * 2 + y.rang, y.quoi || ' de la ligne ' || (l.ordre + 1), y.valeur
            from facture_lignes l
            cross join lateral (values (1, 'la désignation', l.designation), (2, 'la référence', l.reference)) as y(rang, quoi, valeur)
           where l.facture_id = v_id) as t
   where public.porte_un_iban(t.valeur)
   order by t.rang, t.ligne
   limit 1;
  if v_libelle is not null then
    raise exception 'Un IBAN figure dans % : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.',
      v_libelle using errcode = '22023';
  end if;

  if p_valider then
    -- L'option pour les débits, FIGÉE ce jour-là : celle du dossier s'il est redevable de la TVA — l'option n'existe
    -- que pour lui. Un avoir garde celle de la facture qu'il corrige, quand elle l'a figée.
    select coalesce(d.tva_sur_debits and d.statut_tva = 'redevable', false) into v_option_debits
    from dossiers d where d.id = p_dossier_id;
    if v_type = 'avoir' and v_origine.option_debits is not null then
      v_option_debits := v_origine.option_debits;
    end if;

    -- A7. CE QUE LA VALIDATION FIGE, lu ici, jamais reçu de l'appelant.
    select f.contact_id, f.emetteur_siret, f.emetteur_adresse into v_contact, v_emetteur_siret, v_emetteur_adresse
      from factures_emises f where f.id = v_id;
    -- Le contact que la facture garde : une écriture directe a pu le poser sur le brouillon, hors de cette fonction.
    if v_contact is not null and not exists (select 1 from contacts c where c.id = v_contact and c.dossier_id = p_dossier_id) then
      raise exception 'Le contact d''où vient le client de la facture est introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    select d.* into v_dossier from dossiers d where d.id = p_dossier_id;
    -- Le statut de TVA, son numéro et l'identité légale : du jour ; pour un avoir, de sa facture quand elle les a figés.
    if v_type = 'avoir' and v_origine.mentions_figees then
      v_statut_tva := v_origine.statut_tva;
      v_article_exoneration := v_origine.article_exoneration;
      v_numero_tva_attribue := v_origine.numero_tva_attribue;
      v_numero_tva := v_origine.numero_tva_imprime;
      v_denomination := v_origine.denomination_imprimee;
      v_forme_juridique := v_origine.forme_juridique;
      v_capital := v_origine.capital;
      v_rcs_ville := v_origine.rcs_ville;
      v_mentions_identite := v_origine.mentions_identite;
    else
      v_statut_tva := v_dossier.statut_tva;
      v_article_exoneration := v_dossier.article_exoneration;
      v_numero_tva_attribue := v_dossier.numero_tva_attribue;
      v_numero_tva := public.numero_tva_du_vendeur(v_statut_tva, v_numero_tva_attribue, v_emetteur_siret);
      v_denomination := v_dossier.denomination_imprimee;
      v_forme_juridique := v_dossier.forme_juridique;
      v_capital := v_dossier.capital;
      v_rcs_ville := v_dossier.rcs_ville;
      v_mentions_identite := v_dossier.mentions_identite;
    end if;
    -- L'identité légale, le cabinet la règle et le client ne la change pas ; la forme juridique en est le préalable
    -- (MEG1-Q14) : un accès « Ventes » ne valide pas une facture dont l'identité n'a pas de forme. Le cabinet valide
    -- encore, l'écran le lui disant ; un avoir qui reprend l'identité de sa facture n'en juge rien.
    v_cabinet := public.admin_du_dossier(p_dossier_id);
    if v_forme_juridique is null and not v_cabinet and not (v_type = 'avoir' and v_origine.mentions_figees) then
      raise exception 'La forme juridique du dossier n''est pas renseignée : l''identité légale qu''une facture imprime est à régler par le cabinet avant qu''une facture se valide depuis l''espace client.'
        using errcode = '22023';
    end if;
    -- Un entrepreneur individuel (la catégorie 1000 de l'INSEE) facture sous une dénomination qui incorpore son nom,
    -- précédé ou suivi immédiatement des mots « entrepreneur individuel » ou des initiales « EI » (C. com., art. R526-27 ;
    -- R123-237, 9°).
    if v_forme_juridique = '1000' and not public.porte_la_mention_ei(v_denomination) then
      raise exception 'La forme juridique du dossier est celle d''un entrepreneur individuel : sa dénomination imprimée, son nom précédé ou suivi des initiales « EI » ou des mots « entrepreneur individuel » (C. com., art. R526-27), est à renseigner par le cabinet avant de valider une facture.'
        using errcode = '22023';
    end if;
    -- A7Q-Q1. La dénomination, le nom légal que la facture imprime (C. com., art. L441-9, I : le nom des
    -- parties), est la première mention de l'identité, et le cabinet seul la renseigne (la policy
    -- `dossiers_update`) : un accès « Ventes » ne valide pas une facture d'un dossier qui n'en a pas, quelle que
    -- soit sa forme juridique, comme sans forme. La valeur jugée est celle que la facture figera,
    -- `v_denomination` : la dénomination du dossier, lue dans cette transaction, absente ou faite des seuls
    -- blancs de `v_blancs`. Le cabinet n'est pas jugé ; un avoir qui reprend l'identité de sa facture n'en juge
    -- rien. Après l'entrepreneur individuel : sans dénomination, son refus, qui dit aussi ce qu'elle doit
    -- porter, parle le premier ; avant l'émetteur, comme l'identité avant lui.
    if btrim(coalesce(v_denomination, ''), v_blancs) = '' and not v_cabinet
       and not (v_type = 'avoir' and v_origine.mentions_figees) then
      raise exception 'La dénomination du dossier n''est pas renseignée : le cabinet la renseigne avant qu''une facture se valide depuis l''espace client.'
        using errcode = '22023';
    end if;
    -- A7-Q2. Un accès « Ventes » ne valide une facture que sous le SIRET et l'adresse du DOSSIER, que le cabinet seul
    -- renseigne (la policy `dossiers_update`), lus ici dans la transaction qui valide : un dossier qui n'en a pas ne se
    -- facture pas depuis l'espace client avant que le cabinet les pose. « Les mêmes » : le SIRET, ses caractères, les
    -- blancs retirés où qu'ils soient ; l'adresse, son texte, les blancs de ses bords retirés et ses fins de ligne
    -- ramenées à une seule (CR LF et CR lus LF) — ce que « Mes ventes » envoie quand elle reprend le SIRET et l'adresse
    -- du dossier sans les changer. Le cabinet n'est pas jugé ; un avoir reprend l'émetteur de sa facture et n'en juge rien.
    if not v_cabinet and v_type <> 'avoir' then
      if translate(coalesce(v_dossier.siret, ''), v_blancs, '') = '' then
        raise exception 'Le SIRET du dossier n''est pas renseigné : le cabinet le renseigne avant qu''une facture se valide depuis l''espace client.'
          using errcode = '22023';
      end if;
      if translate(coalesce(v_emetteur_siret, ''), v_blancs, '') <> translate(v_dossier.siret, v_blancs, '') then
        raise exception 'Le SIRET de l''émetteur n''est pas celui du dossier : une facture validée depuis l''espace client porte le SIRET que le cabinet a renseigné.'
          using errcode = '22023';
      end if;
      if btrim(coalesce(v_dossier.adresse, ''), v_blancs) = '' then
        raise exception 'L''adresse du dossier n''est pas renseignée : le cabinet la renseigne avant qu''une facture se valide depuis l''espace client.'
          using errcode = '22023';
      end if;
      if btrim(replace(replace(coalesce(v_emetteur_adresse, ''), chr(13) || chr(10), chr(10)), chr(13), chr(10)), v_blancs)
         <> btrim(replace(replace(v_dossier.adresse, chr(13) || chr(10), chr(10)), chr(13), chr(10)), v_blancs) then
        raise exception 'L''adresse de l''émetteur n''est pas celle du dossier : une facture validée depuis l''espace client porte l''adresse que le cabinet a renseignée.'
          using errcode = '22023';
      end if;
    end if;
    -- Les paramètres en vigueur : la version COURANTE — celle qu'aucune ne remplace — et le RIB CONFIRMÉ : celui de la
    -- courante, sinon, au-delà des versions où il n'est que proposé, celui de la première version qui en a un confirmé ;
    -- aucun quand cette version n'en a pas (`ribEnVigueur`, src/lib/parametresFacturation.ts). Lus d'une seule instruction.
    with recursive chaine as (
      select p.id, p.remplace_id, p.rib_etat, 1 as rang
        from parametres_facturation p
       where p.dossier_id = p_dossier_id
         and not exists (select 1 from parametres_facturation s where s.remplace_id = p.id)
      union all
      select p.id, p.remplace_id, p.rib_etat, c.rang + 1
        from parametres_facturation p
        join chaine c on p.id = c.remplace_id
    )
    select (select c.id from chaine c where c.rang = 1),
           (select c.id from chaine c where c.rib_etat is distinct from 'propose' order by c.rang limit 1)
      into v_courante_id, v_rib_id;
    if v_courante_id is not null then
      select p.* into v_courante from parametres_facturation p where p.id = v_courante_id;
    end if;
    if v_rib_id is not null then
      select p.* into v_rib from parametres_facturation p where p.id = v_rib_id and p.rib_etat = 'confirme';
    end if;
    -- A7-Q3. Ce que la validation figerait et que la facture imprime sans confirmation, pour tout auteur : l'identité du
    -- dossier — sauf celle qu'un avoir reprend de sa facture —, puis les textes de la version des paramètres en vigueur,
    -- dans l'ordre de leur saisie. Une version enregistrée avant la migration `iban_hors_des_parametres` peut en porter
    -- un : elle ne se fige pas, une autre la remplace.
    select x.libelle into v_libelle
      from (values
        (1, 'la dénomination du dossier', v_denomination),
        (2, 'la ville du greffe du dossier', v_rcs_ville),
        (3, 'les autres mentions de l''identité du dossier', v_mentions_identite),
        (4, 'les conditions d''escompte des paramètres de facturation', v_courante.escompte),
        (5, 'les pénalités de retard des paramètres de facturation', v_courante.penalites),
        (6, 'les mentions complémentaires des paramètres de facturation', v_courante.mentions_complementaires),
        (7, 'le pied de page des paramètres de facturation', v_courante.pied_de_page)
      ) as x(rang, libelle, valeur)
     where public.porte_un_iban(x.valeur)
       and (x.rang > 3 or not (v_type = 'avoir' and coalesce(v_origine.mentions_figees, false)))
     order by x.rang
     limit 1;
    if v_libelle is not null then
      raise exception 'Un IBAN figure dans % : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.',
        v_libelle using errcode = '22023';
    end if;
    -- Le mandataire : le cabinet qui valide au nom et pour le compte de son client ; personne quand c'est le client.
    if v_cabinet then
      select c.nom into v_mandataire from cabinets c where c.id = v_dossier.cabinet_id;
    end if;

    -- P5b2. L'ACOMPTE ET LA FACTURE FINALE D'UN DEVIS, sous le verrou du devis : deux validations, ou une validation et
    -- l'avoir d'un acompte, se suivent. Après les refus d'hier ; dans l'ordre et sous les mots du module.
    select l.devis_id, l.role into v_devis_lien, v_role_lien from devis_factures l where l.facture_id = v_id;
    if v_devis_lien is not null then
      perform 1 from devis d where d.id = v_devis_lien for update;
    end if;
    if v_role_lien = 'acompte' then
      -- Le cumul des acomptes en vigueur et de celui-ci : aucune ligne hors des groupes (taux, nature) du devis, aucun
      -- groupe dépassé.
      with groupes as (
        select coalesce((l.valeur->>'taux_tva')::numeric, 0) as taux, nullif(l.valeur->>'nature', '') as nature,
               sum(c.ht_centimes) as ht, min(l.ord) as rang
          from devis d
         cross join lateral jsonb_array_elements(d.lignes) with ordinality as l(valeur, ord)
         cross join lateral centimes_ligne_facture(coalesce((l.valeur->>'quantite')::numeric, 0),
           coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0), coalesce((l.valeur->>'taux_tva')::numeric, 0), false) c
         where d.id = v_devis_lien
         group by 1, 2
      ), pris as (
        select fl.taux_tva as taux, fl.nature, c.ht_centimes as ht, a.rang, fl.ordre
          from (select e.facture_id as id, e.rang from acomptes_en_vigueur(v_devis_lien) e
                union all
                select v_id, 0) as a
          join facture_lignes fl on fl.facture_id = a.id
         cross join lateral centimes_ligne_facture(fl.quantite, fl.prix_unitaire_ht, fl.taux_tva, false) c
      )
      select (select p.taux from pris p
               where not exists (select 1 from groupes g where g.taux = p.taux and g.nature is not distinct from p.nature)
               order by p.rang, p.ordre limit 1),
             (select g.taux from groupes g
               where g.ht < (select coalesce(sum(p.ht), 0) from pris p where p.taux = g.taux and p.nature is not distinct from g.nature)
               order by g.rang limit 1)
        into v_taux_absent, v_taux_depasse;
      select d.numero into v_texte from devis d where d.id = v_devis_lien;
      if v_taux_absent is not null then
        raise exception 'L’acompte porte une ligne à % que le devis % n’a pas : il ne se valide pas.',
          acompte_en_taux(v_taux_absent), v_texte using errcode = '22023';
      end if;
      if v_taux_depasse is not null then
        raise exception 'Le cumul des acomptes du devis % dépasse le devis à % : cet acompte ne se valide pas.',
          v_texte, acompte_en_taux(v_taux_depasse) using errcode = '22023';
      end if;
      -- P5B-Q5 : la finale qu'il laisserait.
      v_texte := acompte_refus_de_la_finale_laissee(v_devis_lien,
        (select coalesce(jsonb_agg(jsonb_build_object('prix_unitaire_ht', fl.prix_unitaire_ht, 'taux_tva', fl.taux_tva)
                                   order by fl.ordre), '[]'::jsonb)
           from facture_lignes fl where fl.facture_id = v_id));
      if v_texte is not null then
        raise exception '%', v_texte using errcode = '22023';
      end if;
    elsif v_role_lien = 'finale' then
      if exists (select 1 from devis_factures l join factures_emises f on f.id = l.facture_id
                  where l.devis_id = v_devis_lien and l.role = 'acompte' and f.statut <> 'validee') then
        raise exception 'Un acompte du devis est encore en brouillon : la facture finale ne se valide qu’une fois ses acomptes validés ou supprimés.'
          using errcode = '22023';
      end if;
      -- Chaque acompte en vigueur, repris exactement : chacune de ses lignes une fois, à la quantité -1, au même prix, taux
      -- et nature.
      select e.numero into v_texte
        from acomptes_en_vigueur(v_devis_lien) e
       where (select string_agg(k.cle, ';' order by k.cle collate "C")
                from (select trim_scale(fl.prix_unitaire_ht)::text || '|' || trim_scale(fl.taux_tva)::text || '|'
                             || coalesce(fl.nature, '') as cle
                        from facture_lignes fl where fl.facture_id = e.facture_id) as k)
             is distinct from
             (select string_agg(k.cle, ';' order by k.cle collate "C")
                from (select trim_scale(fl.prix_unitaire_ht)::text || '|' || trim_scale(fl.taux_tva)::text || '|'
                             || coalesce(fl.nature, '') as cle
                        from facture_lignes fl
                       where fl.facture_id = v_id and fl.reprise_facture_id = e.facture_id and fl.quantite = -1) as k)
          or exists (select 1 from facture_lignes fl
                      where fl.facture_id = v_id and fl.reprise_facture_id = e.facture_id and fl.quantite <> -1)
       order by e.rang
       limit 1;
      if v_texte is not null then
        raise exception 'La facture finale ne reprend pas exactement l’acompte % : chacune de ses lignes s’y reprend une fois, au signe opposé.',
          v_texte using errcode = '22023';
      end if;
      select coalesce(a.numero, fl.reprise_facture_id::text) into v_texte
        from facture_lignes fl
        left join factures_emises a on a.id = fl.reprise_facture_id
       where fl.facture_id = v_id and fl.reprise_facture_id is not null
         and not exists (select 1 from acomptes_en_vigueur(v_devis_lien) e where e.facture_id = fl.reprise_facture_id)
       order by fl.ordre
       limit 1;
      if v_texte is not null then
        raise exception 'La facture finale reprend l’acompte %, qui n’est plus un acompte en vigueur de son devis (validé et non crédité).',
          v_texte using errcode = '22023';
      end if;
      -- `refusDeLaFinale` : aucun taux négatif, en HT puis en TVA, dans l'ordre de première apparition.
      with t as (
        select fl.taux_tva as taux, min(fl.ordre) as rang, sum(c.ht_centimes) as ht, sum(c.tva_centimes) as tva
          from facture_lignes fl
         cross join lateral centimes_ligne_facture(fl.quantite, fl.prix_unitaire_ht, fl.taux_tva, false) c
         where fl.facture_id = v_id
         group by fl.taux_tva
      )
      select (select t.taux from t where t.ht < 0 order by t.rang limit 1),
             (select t.taux from t where t.tva < 0 order by t.rang limit 1)
        into v_taux_absent, v_taux_depasse;
      if v_taux_absent is not null then
        raise exception 'La facture finale serait négative à % : les acomptes repris dépassent le devis.',
          acompte_en_taux(v_taux_absent) using errcode = '22023';
      end if;
      if v_taux_depasse is not null then
        raise exception 'La facture finale porterait une TVA négative à % : les acomptes repris en ont pris plus que le devis n’en porte.',
          acompte_en_taux(v_taux_depasse) using errcode = '22023';
      end if;
    end if;

    -- Le numéro est consommé ici, dans la même transaction que la validation qu'il accompagne. S'il
    -- était pris à part et que la suite échouait, il était perdu : un trou dans une suite annuelle
    -- qui, en facturation française, ne doit pas en avoir.
    v_numero := attribuer_numero_facture(p_dossier_id, extract(year from v_date_emission)::integer, v_type);
    -- Le réglage dit à la garde des factures validées (étape c, premier temps, seconde migration) que CETTE facture
    -- se valide par cette fonction ; il ne vaut que pour elle, et il est retiré aussitôt.
    perform set_config('jd.validation_facture', v_id::text, true);
    update factures_emises
    set statut = 'validee', numero = v_numero, validated_at = now(), option_debits = v_option_debits,
        valide_par = auth.uid(),
        mentions_figees = true,
        statut_tva = v_statut_tva, article_exoneration = v_article_exoneration,
        numero_tva_attribue = v_numero_tva_attribue, numero_tva_imprime = v_numero_tva,
        denomination_imprimee = v_denomination, forme_juridique = v_forme_juridique, capital = v_capital,
        rcs_ville = v_rcs_ville, mentions_identite = v_mentions_identite,
        parametres_id = v_courante.id, moyen_prefere = v_courante.moyen_prefere, escompte = v_courante.escompte,
        penalites = v_courante.penalites, mentions_complementaires = v_courante.mentions_complementaires,
        pied_de_page = v_courante.pied_de_page, logo_chemin = v_courante.logo_chemin, logo_sha256 = v_courante.logo_sha256,
        rib_parametres_id = v_rib.id, iban_imprime = v_rib.iban, bic_imprime = v_rib.bic,
        titulaire_imprime = v_rib.titulaire_compte,
        mandataire_nom = v_mandataire
    where id = v_id;
    perform set_config('jd.validation_facture', '', true);
  end if;

  return query select v_id, v_numero;
end;
$$;

-- ══ GARDE DE FIN ══════════

do $fin$
begin
  -- La neuve : aux droits de l'appelant, stable, son chemin fixé, exécutée par personne d'autre que le rôle des Edge
  -- Functions et les fonctions qui l'appellent (comme montants_par_taux_facture).
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.montants_par_taux_du_document(uuid)')
                    and not p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public']
                    and not has_function_privilege('anon', p.oid, 'execute')
                    and not has_function_privilege('authenticated', p.oid, 'execute')) then
    raise exception 'montants_par_taux_du_document n''a pas la forme attendue.';
  end if;
  -- Les remplacées gardent leur forme : définisseuses ou non, leur volatilité, leur chemin et leurs réglages, leurs droits.
  if (select string_agg(p.proname || ':' || p.prosecdef::int || p.provolatile::text || array_to_string(p.proconfig, ';')
                        || ':' || has_function_privilege('anon', p.oid, 'execute')::int
                        || has_function_privilege('authenticated', p.oid, 'execute')::int,
                        ',' order by p.proname collate "C")
        from pg_proc p
       where p.oid in (to_regprocedure('public.calcul_vente_facturee(uuid)'),
                       to_regprocedure('public.ecriture_attendue_vente_facturee(uuid, text, uuid)'),
                       to_regprocedure('public.ecritures_attendues_de_la_periode(uuid, date, date)'),
                       to_regprocedure('public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb)'),
                       to_regprocedure('public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean)'),
                       to_regprocedure('public.garder_encaissement_facture()'),
                       to_regprocedure('public.ventes_facturees_de_la_simulation(uuid, integer)')))
     is distinct from 'calcul_vente_facturee:0ssearch_path=public:00,'
                   || 'ecriture_attendue_vente_facturee:0ssearch_path=public:00,'
                   || 'ecritures_attendues_de_la_periode:0ssearch_path=public;jit=off;enable_nestloop=off:00,'
                   || 'enregistrer_encaissement:1vsearch_path=public:01,'
                   || 'enregistrer_facture:1vsearch_path=public:01,'
                   || 'garder_encaissement_facture:0vsearch_path=public:00,'
                   || 'ventes_facturees_de_la_simulation:1ssearch_path=public:01' then
    raise exception 'Une fonction remplacée n''a plus la forme ou les droits d''hier.';
  end if;
  -- Ce que la numérotation qui continue (A9a) lit d'`enregistrer_facture` : le numéro pris par attribuer_numero_facture pour
  -- l'année de la date d'émission, le mandataire posé selon admin_du_dossier.
  if (select position('v_numero := attribuer_numero_facture(p_dossier_id, extract(year from v_date_emission)::integer, v_type);'
                      in replace(p.prosrc, E'\r\n', E'\n')) = 0
             or position('v_cabinet := public.admin_du_dossier(p_dossier_id);' in p.prosrc) = 0
             or position('mandataire_nom = v_mandataire' in p.prosrc) = 0
        from pg_proc p where p.oid = to_regprocedure('public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean)')) then
    raise exception 'enregistrer_facture ne prend plus son numéro, ou ne pose plus son mandataire, comme la numérotation qui continue le suppose.';
  end if;
  -- La garde des encaissements est toujours celle de leurs déclencheurs.
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.encaissements_factures'::regclass and not t.tgisinternal
         and t.tgname = 'encaissements_factures_gardes'
         and t.tgfoid = 'public.garder_encaissement_facture()'::regprocedure) <> 1 then
    raise exception 'La garde des encaissements n''est plus celle de leur déclencheur.';
  end if;
end
$fin$;

-- Fin de la migration factures_reprises_encaissements.
