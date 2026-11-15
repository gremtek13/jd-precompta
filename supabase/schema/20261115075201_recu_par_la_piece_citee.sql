-- A8Q5Q3-Q2 — CE QUE LA PIÈCE CITÉE D'UNE FACTURE REPRISE A DÉJÀ REÇU, PLANCHER DE SON REGISTRE (ligne 51.5 ; décision du
-- cabinet : A8Q5Q3-Q2, « Le plus grand des deux montants », le 11/11/2026, à la recommandation (A)). PRÉPARÉE le
-- 13/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 13/11/2026 — PC4Q2-Q1, A8B-Q3 ET A8Q5Q3-Q2 : TROIS MIGRATIONS
-- PRÉPARÉES » ; le cas : « 11/11/2026 — A8Q5-Q3 : LA PIÈCE DÉJÀ COMPTÉE PAR UN EXERCICE VALIDÉ, PUIS L'ORIGINAL D'UNE
-- FACTURE REPRISE » ; les essais : supabase/essais/pieceDejaCompteeDUneReprise.sql (l'étape 5, qui rendait le double compte,
-- se refuse avec elle) et supabase/essais/recuParLaPieceCitee.sql (EN ATTENTE sans elle) ; le retour :
-- supabase/preparees/retour/20261113212100_retour_recu_par_la_piece_citee.sql ; les modules qui redisent les refus avant
-- le clic : src/lib/recuParLaPieceCitee.ts (`RECU_PAR_LA_PIECE_CITEE_PREVU`, baissé jusqu'à l'application), lu par la
-- fenêtre des encaissements (src/lib/encaissementsFactures.ts) et par la lecture de la reprise (src/lib/reprisesAuClient.ts).
--
-- SOURCES. CGI, art. 93, 1 (les recettes d'un titulaire de bénéfices non commerciaux se comptent une fois, à leur
-- encaissement) ; CGI, art. 269, 2-c (la TVA d'une prestation de services, exigible à l'encaissement, une fois) ; la
-- conception d'A8 (« A8 ET A9, LES FACTURES REPRISES ET LA NUMÉROTATION QUI CONTINUE : LA CONCEPTION REMISE À JOUR »,
-- 06/11/2026) et A8-Q6 (l'encaissé avant la reprise, par taux) ; A8-Q5 et A8Q5-Q1 (la pièce citée, figée ou non).
-- PostgreSQL 17, « CREATE FUNCTION » (CREATE OR REPLACE garde la fonction, son propriétaire et ses droits ; ses autres
-- propriétés sont celles que l'instruction dit) ; « Explicit Locking », 13.3.2 (FOR NO KEY UPDATE se heurte à lui-même :
-- deux transactions qui le prennent sur la même facture se suivent).
--
-- LE CAS. Une pièce de vente payée et comptée — en 2025, par ses paiements, dans la 2035 et la CA3 —, puis citée par une
-- facture reprise dont l'import dit « rien d'encaissé avant la reprise » : le registre (A8b) partait du déclaré et acceptait
-- d'encaisser de nouveau la même somme ; la vente comptait deux fois, en 2025 et en 2026 (l'essai
-- pieceDejaCompteeDUneReprise.sql, étape 5). Il faut une erreur à l'import pour en arriver là ; rien ne la retenait.
--
-- CE QU'ELLE FAIT :
--   1. `recu_par_la_piece(p_piece_id)`, neuve : ce qu'une pièce a reçu, en centimes, jamais négatif — la somme SIGNÉE de ses
--      paiements, ceux que la 2035 compte (`paiementsDesPieces`, src/lib/rattachement.ts) et que `regler_piece_par_la_caisse`
--      somme déjà (son 9 bis) : un mouvement rapproché d'elle, la part d'un virement groupé sur un mouvement rapproché et
--      réglé en groupe, ses paiements par la caisse non retirés — ceux de son dossier, comme l'un et l'autre les lisent
--      (relecture du 14/11/2026). L'encaissement d'un virement mixte n'y entre pas : il ne paie
--      que l'exemplaire d'une facture de l'application, et une pièce citée n'en est jamais un (la citation et la garde de la
--      pièce le refusent). Exécutable par aucun rôle de session : les trois fonctions ci-dessous l'appellent.
--   2. `enregistrer_encaissement` (empreinte 9f3fae7d…, A8b, en production) : d'une facture reprise dont la pièce citée (le
--      lien actif) a reçu plus que l'import n'en déclare encaissé avant la reprise, l'encaissé avant la reprise est ce reçu —
--      le plus grand des deux —, au plafond du total ; d'une facture à un taux, celui du taux est le même et n'a rien à juger
--      de plus. D'une facture à plusieurs taux, ce reçu ne se répartit pas sans deviner : l'encaissement se refuse (22023),
--      un refus neuf, juste avant le plafond d'une reprise, sans nom de fichier ni montant (le client « Ventes » l'appelle
--      aussi). Les refus d'hier gardent leur rang et leurs mots ; une facture qui n'est pas reprise, ou dont la pièce n'a pas
--      reçu plus que le déclaré, se juge comme hier.
--   3. `reprise_de_la_facture` (empreinte 41385162…, `reprises_au_client`, en production) : une septième clé,
--      `recu_par_sa_piece_centimes`, ce que la pièce citée a reçu (zéro sans lien actif) — ce que le plancher lit, pour que
--      la fenêtre des encaissements juge avant le clic comme la base. Au cabinet et à l'accès « Ventes », comme hier.
--   4. `citer_piece_de_facture_reprise` (empreinte 690e26c9…, A8-Q5, en production) : la facture se verrouille comme
--      `enregistrer_encaissement` la verrouille (`for no key update`) — une citation et un encaissement se suivent —, et,
--      quand la pièce a reçu plus que le déclaré alors que le registre a déjà des encaissements, la citation se refuse
--      (23514), après les refus d'hier : d'une facture à plusieurs taux, le registre ne saurait plus sur lesquels ce paiement
--      a porté ; à un taux, quand le registre et ce reçu dépassent ensemble ce qu'elle porte, nette de ses avoirs, la même
--      vente compterait deux fois.
--
-- CE QU'ELLE NE CHANGE PAS : aucune donnée, aucune table, aucune policy, aucun déclencheur. La règle du cumul de la TVA
-- (`calcul_vente_facturee`, `ecritures_attendues_de_la_periode`) part toujours de l'encaissé DÉCLARÉ, taux par taux : d'une
-- facture à un taux, partir du reçu ne changerait la TVA de chaque encaissement que d'un arrondi (au plus un centime au
-- total) ; à plusieurs, l'encaissement se refuse. Un paiement d'avant la reprise rapproché de la pièce APRÈS des
-- encaissements de son registre (la garde des règlements le laisse passer : il précède la reprise) n'est pas retenu ici —
-- une question au cabinet (A8Q5Q3Q2-Q2). Relevé sur la réplique du 13/11/2026 (218 migrations, égale à la production à la
-- signature) : aucune facture reprise, aucun lien.
--
-- COMMENT ELLE S'APPLIQUE : aucun mot de retrait ni de vidage, aucune barre oblique inverse — PAR L'OUTIL. Indépendante des
-- deux autres migrations préparées du même jour (`le_468_sur_le_releve`, `reprises_retiennent_la_tresorerie`) : aucune
-- fonction, aucune table en commun ; elle s'applique avant, après ou entre elles. Aucune autre migration préparée ne
-- remplace ces trois fonctions ; le retour d'A8b (20261110130100) ne s'applique qu'après le sien (sa garde attend le corps
-- d'A8b). Le jour de son application, `RECU_PAR_LA_PIECE_CITEE_PREVU` se lève — la lecture de la reprise attend alors sept
-- clés : l'application se déploie aussitôt après — et le fichier entre dans supabase/schema/ sous la version que porte sa
-- ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
-- La migration ne se rejoue pas ; les trois fonctions remplacées sont celles de la production, à l'empreinte de leur corps ;
-- ce que la fonction neuve lit est en base.
do $garde$
begin
  if to_regprocedure('public.recu_par_la_piece(uuid)') is not null then
    raise exception 'A8Q5Q3-Q2 : recu_par_la_piece est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13) || chr(10), chr(10))), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.citer_piece_de_facture_reprise(uuid, uuid, uuid)'),
                       to_regprocedure('public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb)'),
                       to_regprocedure('public.reprise_de_la_facture(uuid, uuid)')))
     is distinct from 'citer_piece_de_facture_reprise=690e26c9c56f1c976b7bcb29d8af2754,'
                   || 'enregistrer_encaissement=9f3fae7dc1c804157a706c3f5847702a,'
                   || 'reprise_de_la_facture=41385162170efbcc0f6d4f48b9732284' then
    raise exception 'A8Q5Q3-Q2 : citer_piece_de_facture_reprise, enregistrer_encaissement ou reprise_de_la_facture n''est plus celle de la production (A8-Q5, A8b, reprises_au_client) : relire la migration contre la base avant de l''appliquer.';
  end if;
  if to_regclass('public.pieces_des_factures_reprises') is null
     or to_regprocedure('public.montants_par_taux_du_document(uuid)') is null
     or to_regprocedure('public.montants_par_taux_facture(uuid)') is null
     or (select count(*) from information_schema.columns
          where table_schema = 'public'
            and (table_name, column_name) in (('lignes_bancaires', 'piece_id'), ('lignes_bancaires', 'statut'),
                                              ('lignes_bancaires', 'reglement_groupe'), ('reglements_groupes', 'piece_id'),
                                              ('reglements_groupes', 'montant'), ('operations_caisse', 'piece_id'),
                                              ('operations_caisse', 'genre'), ('operations_caisse', 'retire_le'),
                                              ('operations_caisse', 'montant'))) <> 9 then
    raise exception 'A8Q5Q3-Q2 : la pièce d''une facture reprise (A8-Q5), les montants par taux d''un document (A8b) ou une colonne des paiements d''une pièce manquent.';
  end if;
end
$garde$;

-- ══ 1. Ce qu'une pièce a reçu ══════════
-- Les paiements de SON dossier seulement (relecture du 14/11/2026) : la 2035 ne lit que les mouvements et la caisse du
-- dossier, et `regler_piece_par_la_caisse` (son 9 bis) les filtre de même — un mouvement d'un autre dossier qui citerait la
-- pièce n'en change pas le plancher.
create function public.recu_par_la_piece(p_piece_id uuid) returns bigint
language sql
stable
set search_path = public
as $$
  -- La somme signée de ses paiements, en centimes, jamais négative : un mouvement rapproché d'elle, la part d'un virement
  -- groupé (sur un mouvement rapproché et réglé en groupe), ses paiements par la caisse non retirés — de son dossier.
  select greatest((coalesce(sum(x.montant), 0) * 100)::bigint, 0)
    from public.pieces p
    cross join lateral (
          select l.montant from public.lignes_bancaires l
           where l.piece_id = p.id and l.dossier_id = p.dossier_id and l.statut = 'rapprochee'
          union all
          select g.montant from public.reglements_groupes g
            join public.lignes_bancaires l on l.id = g.ligne_bancaire_id
           where g.piece_id = p.id and l.dossier_id = p.dossier_id and l.statut = 'rapprochee' and l.reglement_groupe
          union all
          select o.montant from public.operations_caisse o
           where o.piece_id = p.id and o.dossier_id = p.dossier_id and o.genre = 'paiement' and o.retire_le is null) x
   where p.id = p_piece_id
$$;

comment on function public.recu_par_la_piece(uuid) is
  'Ce qu''une pièce a reçu, en centimes, jamais négatif (A8Q5Q3-Q2) : la somme signée de ses paiements de son dossier — un mouvement rapproché d''elle, la part d''un virement groupé, ses paiements par la caisse non retirés —, ceux que la 2035 compte. Le plancher du registre d''une facture reprise qui la cite (enregistrer_encaissement, citer_piece_de_facture_reprise, reprise_de_la_facture).';

revoke all on function public.recu_par_la_piece(uuid) from public, anon, authenticated;

-- ══ 2. Le registre d'une facture reprise part du plus grand du déclaré et de ce que sa pièce a reçu ══════════
-- Celle d'A8b (en production), où seules les lignes marquées « A8Q5Q3-Q2 » s'ajoutent.
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
  -- A8Q5Q3-Q2 : ce que la pièce citée par une facture reprise a reçu (en centimes), et si la facture n'a qu'un taux.
  v_recu bigint := 0;
  v_un_seul_taux boolean;
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
    -- A8Q5Q3-Q2 : ce que la pièce citée (le lien actif, A8-Q5) a reçu avant la reprise, la 2035 l'a déjà compté, à la date
    -- de ses paiements. L'encaissé avant la reprise est le plus grand du déclaré et de ce reçu ; d'une facture à plusieurs
    -- taux, ce reçu ne se répartit pas sans deviner : l'encaissement se refuse, sans nom ni montant. D'une facture à un
    -- seul taux, le plafond de ce taux est celui du total (mêmes montants, mêmes avoirs, mêmes encaissements) : le total
    -- jugé ici avec ce reçu, le taux n'a rien à juger de plus, et garde le déclaré.
    select coalesce(sum(public.recu_par_la_piece(r.piece_id)), 0) into v_recu
      from public.pieces_des_factures_reprises r where r.facture_id = p_facture_id and r.retire_le is null;
    v_un_seul_taux := (select count(*) from public.montants_par_taux_du_document(p_facture_id)) = 1;
    if v_recu > v_avant * 100 then
      if not v_un_seul_taux then
        raise exception 'La pièce citée par la facture reprise % a reçu, avant la reprise, plus que l''import n''en déclare encaissé, et la facture porte plusieurs taux de TVA : l''application ne devine pas sur lesquels ce paiement a porté, et la facture ne reçoit pas d''encaissement : le cabinet reprend d''abord son import, en y déclarant, taux par taux, ce que sa pièce a reçu.',
          v_facture.numero using errcode = '22023';
      end if;
      v_avant := v_recu / 100.0;
    end if;
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

-- ══ 3. La reprise d'une facture, lue avant le clic : ce que sa pièce a reçu ══════════
-- Celle de `reprises_au_client` (en production) ; seules les lignes marquées « A8Q5Q3-Q2 » s'ajoutent.
create or replace function public.reprise_de_la_facture(p_dossier_id uuid, p_facture_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reprise date;
  v_nature text;
  v_avant numeric;
  v_par_taux jsonb;
  v_avant_par_taux jsonb;
  v_credite numeric;
  v_credite_par_taux jsonb;
  v_recu bigint;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ, avant toute lecture : le cabinet du dossier, ou un accès client qui porte « Ventes »
  --    — la clé « ventes » de `droits_sur_le_dossier`, ce qu'exige `enregistrer_encaissement`.
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2. Une facture reprise de ce dossier, et elle seule : son registre la nomme (la garde d'`importer_factures` les pose
  --    ensemble ; une ligne de l'un sans l'autre n'en est pas une).
  select f.nature_operation, fi.encaisse_avant_reprise, fi.encaisse_par_taux
    into v_nature, v_avant, v_par_taux
    from public.factures_emises f
    join public.factures_importees fi on fi.facture_id = f.id and fi.dossier_id = f.dossier_id
   where f.id = p_facture_id and f.dossier_id = p_dossier_id and f.statut = 'importee' and f.type = 'facture';
  if not found then
    raise exception 'Facture reprise introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  select d.reprise_des_factures_le into v_reprise from public.dossiers d where d.id = p_dossier_id;
  -- 3. Ce qui en était encaissé avant la reprise, à chaque taux : `encaisse_par_taux`, lu comme `enregistrer_encaissement`
  --    le lit (l'encaissé d'un taux, en centimes), un taux répété sommé.
  select coalesce(jsonb_agg(jsonb_build_object('taux', t.taux, 'encaisse_centimes', t.centimes) order by t.taux desc), '[]'::jsonb)
    into v_avant_par_taux
    from (select (g.valeur ->> 'taux')::numeric as taux, sum(((g.valeur ->> 'encaisse')::numeric * 100)::bigint) as centimes
            from jsonb_array_elements(v_par_taux) g(valeur)
           group by (g.valeur ->> 'taux')::numeric) t;
  -- 4. Ce que ses avoirs REPRIS créditent (ceux qui la citent dans le registre, à l'état « importee ») : au total, leur
  --    en-tête ; à chaque taux, la règle de TVA de leurs montants — les deux sommes d'`enregistrer_encaissement`.
  select coalesce(sum(-a.montant_ttc), 0) into v_credite
    from public.factures_importees ai
    join public.factures_emises a on a.id = ai.facture_id
   where ai.origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'importee';
  select coalesce(jsonb_agg(jsonb_build_object('taux', t.taux, 'ttc_centimes', t.centimes) order by t.taux desc), '[]'::jsonb)
    into v_credite_par_taux
    from (select m.taux, sum(m.ttc_centimes)::bigint as centimes
            from public.factures_importees ai
            join public.factures_emises a on a.id = ai.facture_id
            cross join lateral public.montants_par_taux_du_document(a.id) m
           where ai.origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'importee'
           group by m.taux) t;
  -- 5. A8Q5Q3-Q2 : ce que la pièce qu'elle cite (le lien actif) a reçu avant la reprise, en centimes — zéro sans lien : le
  --    plancher de l'encaissé avant la reprise, que les plafonds d'`enregistrer_encaissement` lisent.
  select coalesce(sum(public.recu_par_la_piece(r.piece_id)), 0)::bigint into v_recu
    from public.pieces_des_factures_reprises r where r.facture_id = p_facture_id and r.retire_le is null;
  return jsonb_build_object(
    'reprise_le', to_char(v_reprise, 'YYYY-MM-DD'),
    'nature_operation', v_nature,
    'encaisse_avant_reprise_centimes', (v_avant * 100)::bigint,
    'encaisse_par_taux', v_avant_par_taux,
    'credite_par_les_repris_centimes', (v_credite * 100)::bigint,
    'credite_par_les_repris_par_taux', v_credite_par_taux,
    'recu_par_sa_piece_centimes', v_recu);
end
$$;

-- ══ 4. La citation d'une pièce : le registre et ce qu'elle a reçu ne comptent pas la même vente deux fois ══════════
-- Celle d'A8-Q5 (en production) ; seules les lignes marquées « A8Q5Q3-Q2 » s'ajoutent.
create or replace function public.citer_piece_de_facture_reprise(p_dossier_id uuid, p_facture_id uuid, p_piece_id uuid) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
  v_reprise date;
  v_piece public.pieces;
  v_autre text;
  v_date date;
  v_id uuid;
  -- A8Q5Q3-Q2 : ce que la pièce a reçu (en centimes), ce que l'import déclare encaissé avant la reprise, ce que le registre
  -- a déjà reçu, et ce que la facture porte, nette de ses avoirs (en centimes).
  v_recu bigint;
  v_avant numeric;
  v_deja numeric;
  v_net bigint;
begin
  -- 1. L'accès, avant toute lecture : le cabinet du dossier ; un dossier qui n'existe pas se refuse comme un dossier interdit.
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id)
     or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- La validation d'un exercice attend ce geste, ou il l'attend (comme la désignation d'un exemplaire).
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  -- 2. La facture reprise, de ce dossier, verrouillée : deux citations de la même facture se suivent.
  select f.numero into v_numero
    from public.factures_importees i
    join public.factures_emises f on f.id = i.facture_id
   where i.facture_id = p_facture_id and i.dossier_id = p_dossier_id
     for update of i;
  if not found then
    raise exception 'Cette facture n''est pas une facture reprise de ce dossier.' using errcode = '22023';
  end if;
  -- A8Q5Q3-Q2 : la facture, verrouillée comme `enregistrer_encaissement` la verrouille — une citation et un encaissement
  -- se suivent, et le second voit le premier.
  perform 1 from public.factures_emises f where f.id = p_facture_id for no key update;
  select p.nom_fichier into v_autre
    from public.pieces_des_factures_reprises r
    join public.pieces p on p.id = r.piece_id
   where r.facture_id = p_facture_id and r.retire_le is null;
  if found then
    raise exception 'La facture reprise % cite déjà la pièce « % » : retirer ce lien d''abord.', v_numero, v_autre
      using errcode = '23514';
  end if;
  -- 3. La pièce, de ce dossier seulement (un compte qui n'y a pas droit n'apprend pas qu'elle existe), verrouillée : un
  -- règlement qui la cite en même temps attend ce geste, ou ce geste le voit.
  select * into v_piece from public.pieces p where p.id = p_piece_id and p.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Pièce introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_piece.type_piece is distinct from 'vente' then
    raise exception 'Seule une pièce de vente est l''original d''une facture reprise.' using errcode = '22023';
  end if;
  if v_piece.facture_id is not null then
    raise exception 'La pièce « % » est l''exemplaire de la facture % de l''application : elle n''est pas l''original d''une facture reprise.',
      v_piece.nom_fichier, coalesce((select f.numero from public.factures_emises f where f.id = v_piece.facture_id), '(sans numéro)')
      using errcode = '23514';
  end if;
  select f.numero into v_autre
    from public.pieces_des_factures_reprises r
    join public.factures_emises f on f.id = r.facture_id
   where r.piece_id = p_piece_id and r.retire_le is null;
  if found then
    raise exception 'La pièce « % » est déjà l''original de la facture reprise % : une pièce n''est l''original que d''une facture reprise.',
      v_piece.nom_fichier, v_autre using errcode = '23514';
  end if;
  -- Une pièce que la validation d'un exercice a figée se cite aussi (A8Q5-Q1) : le lien ne touche ni sa ligne ni ses
  -- écritures, et ne ferme que ses rapprochements d'après la reprise, qu'aucun exercice validé ne porte.
  -- 4. Un règlement de la pièce daté de la reprise ou d'après se défait d'abord : il passera par le registre.
  select d.reprise_des_factures_le into v_reprise from public.dossiers d where d.id = p_dossier_id;
  select min(x.jour) into v_date
    from (select l.date as jour from public.lignes_bancaires l where l.piece_id = p_piece_id and l.date >= v_reprise
          union all
          select l.date from public.reglements_groupes g join public.lignes_bancaires l on l.id = g.ligne_bancaire_id
           where g.piece_id = p_piece_id and l.date >= v_reprise
          union all
          select o.date from public.operations_caisse o
           where o.piece_id = p_piece_id and o.retire_le is null and o.date >= v_reprise
          union all
          select e.date from public.ecritures_brouillon e where e.piece_id = p_piece_id and e.date >= v_reprise) x;
  if v_date is not null then
    raise exception 'La pièce « % » est réglée le %, à la date de reprise des factures (le %) ou après : ce règlement passe par le registre de la facture reprise %. Défaire d''abord ce rapprochement.',
      v_piece.nom_fichier, to_char(v_date, 'DD/MM/YYYY'), to_char(v_reprise, 'DD/MM/YYYY'), v_numero using errcode = '23514';
  end if;
  -- 4 bis. A8Q5Q3-Q2 : ce que la pièce a reçu avant la reprise est déjà compté, et le registre de la facture part du plus
  --    grand du déclaré et de ce reçu (`enregistrer_encaissement`). Quand ce reçu dépasse le déclaré alors que le registre a
  --    déjà des encaissements : d'une facture à plusieurs taux, il ne saurait plus sur lesquels ce paiement a porté ; à un
  --    taux, quand ils dépassent ensemble ce qu'elle porte, nette de ses avoirs, la même vente compterait deux fois.
  v_recu := public.recu_par_la_piece(p_piece_id);
  select coalesce(sum(fi.encaisse_avant_reprise), 0) into v_avant
    from public.factures_importees fi where fi.facture_id = p_facture_id;
  select coalesce(sum(e.montant), 0) into v_deja
    from public.encaissements_factures e where e.facture_id = p_facture_id and e.retire_le is null;
  if v_recu > v_avant * 100 and v_deja <> 0 then
    if (select count(*) from public.montants_par_taux_du_document(p_facture_id)) > 1 then
      raise exception 'La pièce « % » a reçu, avant la reprise, plus que l''import de la facture reprise % n''en déclare encaissé, et la facture porte plusieurs taux de TVA : son registre, qui a déjà reçu des encaissements, ne saurait plus sur lesquels ce paiement a porté. Retirer d''abord ces encaissements, ou reprendre l''import en y déclarant, taux par taux, ce que la pièce a reçu.',
        v_piece.nom_fichier, v_numero using errcode = '23514';
    end if;
    select (f.montant_ttc * 100)::bigint
           - coalesce((select sum(m.ttc_centimes) from public.factures_emises a
                        cross join lateral public.montants_par_taux_facture(a.id) m
                        where a.facture_origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'validee'), 0)::bigint
           - coalesce((select sum(-a.montant_ttc) * 100 from public.factures_importees ai
                        join public.factures_emises a on a.id = ai.facture_id
                        where ai.origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'importee'), 0)::bigint
      into v_net from public.factures_emises f where f.id = p_facture_id;
    if v_deja * 100 + v_recu > v_net then
      raise exception 'La pièce « % » a reçu % € avant la reprise, et le registre de la facture reprise % en a déjà reçu % € : ensemble, ils dépassent ce qu''elle porte (% €, nette de ses avoirs), et la même vente compterait deux fois. Retirer d''abord ces encaissements, ou citer une autre pièce.',
        v_piece.nom_fichier, replace(to_char(v_recu / 100.0, 'FM999999999990.00'), '.', ','), v_numero,
        replace(to_char(v_deja, 'FM999999999990.00'), '.', ','), replace(to_char(v_net / 100.0, 'FM999999999990.00'), '.', ',')
        using errcode = '23514';
    end if;
  end if;
  -- 5. Le lien.
  perform set_config('jd.piece_de_reprise', p_facture_id::text, true);
  insert into public.pieces_des_factures_reprises (dossier_id, facture_id, piece_id, cite_par)
    values (p_dossier_id, p_facture_id, p_piece_id, auth.uid())
    returning id into v_id;
  perform set_config('jd.piece_de_reprise', '', true);
  return v_id;
end
$$;

-- ══ 5. La garde de fin : les quatre corps de cette migration, la fonction neuve hors de portée des rôles de session ══════════
do $fin$
begin
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13) || chr(10), chr(10))), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.citer_piece_de_facture_reprise(uuid, uuid, uuid)'),
                       to_regprocedure('public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb)'),
                       to_regprocedure('public.reprise_de_la_facture(uuid, uuid)')))
     is distinct from 'citer_piece_de_facture_reprise=77a922ef4f1ab85dfe523f892debea98,'
                   || 'enregistrer_encaissement=4eac3326dfb077ade4ddade6c2efdbd1,'
                   || 'reprise_de_la_facture=1c42e6298ac68933a0b63aa34bb6e44f' then
    raise exception 'A8Q5Q3-Q2 : un corps remplacé n''est pas celui de cette migration : rien n''est appliqué.';
  end if;
  if (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.recu_par_la_piece(uuid)')) is distinct from 'cfde7288618da220dbc1b76ac6630efd' then
    raise exception 'A8Q5Q3-Q2 : recu_par_la_piece n''a pas le corps de cette migration (les paiements du dossier de la pièce) : rien n''est appliqué.';
  end if;
  if has_function_privilege('authenticated', 'public.recu_par_la_piece(uuid)', 'execute')
     or has_function_privilege('anon', 'public.recu_par_la_piece(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.reprise_de_la_facture(uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.citer_piece_de_facture_reprise(uuid, uuid, uuid)', 'execute') then
    raise exception 'A8Q5Q3-Q2 : les droits d''exécution ne sont pas ceux que cette migration attend : rien n''est appliqué.';
  end if;
end
$fin$;
