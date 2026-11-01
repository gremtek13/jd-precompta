-- LE RETOUR ARRIÈRE DE `caisse_du_client` (la caisse, ligne 26.6, étape C10 : le droit « Caisse » d'un accès client et la
-- saisie des espèces par le praticien). Le récit : HISTORIQUE.md, « LA CAISSE : LE DROIT « CAISSE », EN BASE (C10, LIGNE
-- 26.6) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- CE QU'IL FAIT : les cinq corps que la migration a remplacés, rendus tels que leurs migrations les ont posés, au caractère
-- près (`create or replace` : leur OID, leur propriétaire, leurs droits restent) — `enregistrer_operation_caisse` telle que
-- `paiement_par_la_caisse` la pose (le client n'y a plus de chemin), `qui_ecrit_la_caisse` telle que `caisse` la pose (au
-- cabinet seul), `changer_droits_acces` à trois paramètres, `droits_sur_le_dossier` et `client_du_dossier` tels que
-- `droits_des_acces_clients` les pose, avec leurs commentaires d'hier ; puis il RETIRE la policy de lecture du client, les
-- trois déclencheurs et les six fonctions neuves (`caisse_du_client`, `gere_la_caisse`, `changer_droits_acces` à quatre
-- paramètres, les trois gardes), et les deux colonnes (`memberships.droit_caisse`, `dossiers.categorie_recettes_client`).
--
-- DESTRUCTIF DÈS QU'UNE CASE EST COCHÉE : il retire la colonne qui porte le droit « Caisse » de chaque accès, et celle qui
-- porte la nature des recettes du client — ce qu'elles portent se perd avec elles. Sa garde de tête le REFUSE tant qu'un
-- accès porte la case ou qu'un dossier porte une nature : le cabinet les retire d'abord, sur sa décision, par l'écran,
-- et le retour ne retire plus que des colonnes vides (toutes fausses, toutes nulles). Les opérations que le client a
-- saisies restent, leur origine et leurs écritures comprises : le cabinet les retire ou les remplace comme les siennes.
-- Il retire des objets : à accorder par le cabinet, et à coller, dans une transaction, avec sa ligne d'historique —
-- retirer celle de la migration serait une suppression de plus, à accorder aussi. Aucune barre oblique inverse.
--
-- CE QUE L'APPLICATION EN DIT : rien ne s'y rouvre — le drapeau de la migration se rebaisse (C11, C12) ; un écran qui lirait
-- encore la colonne `droit_caisse` échouerait : la baisse du drapeau vient AVANT ce retour.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. La garde de tête ══════════
-- Les onze corps que la migration pose, à leur empreinte (les retours chariot d'un collage écartés) : une base où l'un d'eux
-- a changé depuis ne se défait pas sans être relue ; puis aucune case cochée, aucune nature fixée.
do $garde$
declare
  v_attendue record;
  v_empreinte text;
  v_n bigint;
begin
  for v_attendue in select * from (values
      ('client_du_dossier', 'public.client_du_dossier(uuid, text)', '68de0e0fd2dcfa303e7b838f9c76e351'),
      ('gere_la_caisse', 'public.gere_la_caisse(uuid)', '2d2312dcba76a1a45a1796d3298cccc4'),
      ('droits_sur_le_dossier', 'public.droits_sur_le_dossier(uuid)', 'c18fd6fb7124010694841a9965d42d08'),
      ('changer_droits_acces', 'public.changer_droits_acces(uuid, boolean, boolean, boolean)', 'a0d9fbb9c865f2a33f6aefc61e37a792'),
      ('changer_droits_acces', 'public.changer_droits_acces(uuid, boolean, boolean)', '2cf20eedb2d699416b5710b471acd18d'),
      ('garder_droit_caisse', 'public.garder_droit_caisse()', '6ee5837298aded8a674c50769e118940'),
      ('garder_statut_tva_de_la_caisse', 'public.garder_statut_tva_de_la_caisse()', '2a10bc522156b14eb687d86fbd69201d'),
      ('garder_categorie_recettes_client', 'public.garder_categorie_recettes_client()', 'a64ee280ff8600248c4541cc3c0b85eb'),
      ('qui_ecrit_la_caisse', 'public.qui_ecrit_la_caisse(uuid)', 'c8f8c13f116f2a382ed2ca321ba7e804'),
      ('enregistrer_operation_caisse', 'public.enregistrer_operation_caisse(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb)', 'a1ffcba154b7837750e340560c6f6b56'),
      ('caisse_du_client', 'public.caisse_du_client(uuid, integer)', '434195748409530170a6d79e638e0cc2')
    ) as t(nom, signature, empreinte) loop
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p where p.oid = to_regprocedure(v_attendue.signature);
    if v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est pas celle que la migration caisse_du_client a posée (empreinte attendue %…) : ce retour arrière ne s''applique pas sans être relu.',
        v_attendue.signature, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  select count(*) into v_n from public.memberships m where m.droit_caisse;
  if v_n > 0 then
    raise exception '% accès porte(nt) la case « Caisse » : la décocher d''abord, sur la décision du cabinet — ce retour arrière la perdrait. Rien n''est retiré.', v_n;
  end if;
  select count(*) into v_n from public.dossiers d where d.categorie_recettes_client is not null;
  if v_n > 0 then
    raise exception '% dossier(s) porte(nt) la nature des recettes de leur client : la retirer d''abord, sur la décision du cabinet — ce retour arrière la perdrait. Rien n''est retiré.', v_n;
  end if;
end
$garde$;

-- ══ 1. Les cinq corps d'hier, au caractère près ══════════
-- `enregistrer_operation_caisse`, celle de `paiement_par_la_caisse`.
create or replace function public.enregistrer_operation_caisse(p_dossier_id uuid, p_genre text, p_date date, p_montant numeric,
  p_categorie_id uuid, p_taux_tva numeric, p_encaissements_du_jour uuid[], p_ecritures jsonb)
returns public.operations_caisse
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origine text;
  v_mode text;
  v_assujetti boolean;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_ouverture date;
  v_frontiere date;
  v_categorie public.categories%rowtype;
  v_attendus uuid[];
  v_paiements uuid[];
  v_recus uuid[];
  v_ecart uuid;
  v_numero text;
  v_caisse text;
  v_dirigeant text;
  v_collectee text;
  v_centimes bigint;
  v_tva bigint := 0;
  v_libelle text;
  v_conforme boolean;
  v_id uuid := gen_random_uuid();
  v_operation public.operations_caisse;
  v_debit numeric;
  v_credit numeric;
  v_jour date;
  v_solde numeric;
begin
  -- 1. L'accès, avant toute lecture ; puis les verrous : celui de la validation, partagé (la frontière lue ici est
  --    celle que les gardes liront), et celui de la caisse du dossier, exclusif (l'ensemble du jour et le solde lus ici
  --    ne changent pas sous la saisie).
  v_origine := public.qui_ecrit_la_caisse(p_dossier_id);
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || p_dossier_id::text, 0));
  select d.mode_comptable, d.assujetti_tva into v_mode, v_assujetti from public.dossiers d where d.id = p_dossier_id;

  -- 2. Le dossier en trésorerie.
  if v_mode is distinct from 'tresorerie' then
    raise exception 'La caisse ne se tient que dans un dossier en comptabilité de trésorerie.' using errcode = '22023';
  end if;

  -- 3. Le genre.
  if p_genre is null or p_genre not in ('recette', 'apport', 'prelevement') then
    raise exception 'Une opération de caisse est une recette en espèces, un apport ou un prélèvement de l''exploitant.'
      using errcode = '22023';
  end if;

  -- 4. La date.
  if p_date is null then
    raise exception 'La date de l''opération de caisse est à renseigner.' using errcode = '22023';
  end if;
  if p_date < date '2000-01-01' then
    raise exception 'Une opération de caisse ne se date pas avant l''an 2000.' using errcode = '22023';
  end if;
  if p_date > v_aujourd_hui then
    raise exception 'Une opération de caisse ne se date pas dans l''avenir : nous sommes le %.',
      to_char(v_aujourd_hui, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select min(a.date) into v_ouverture from public.a_nouveaux a where a.dossier_id = p_dossier_id;
  if v_ouverture is not null and p_date < v_ouverture then
    raise exception 'Cette opération précède l''ouverture du dossier, le % : elle est dans les comptes repris.',
      to_char(v_ouverture, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and p_date <= v_frontiere then
    raise exception '% : sa caisse ne change plus.',
      public.exercice_fige(p_dossier_id, extract(year from p_date)::integer) using errcode = '23514';
  end if;

  -- 5. Le montant.
  if p_montant is null then
    raise exception 'Le montant de l''opération de caisse est à renseigner.' using errcode = '22023';
  end if;
  if p_montant <> round(p_montant, 2) then
    raise exception 'Le montant d''une opération de caisse est au centime.' using errcode = '22023';
  end if;
  if p_montant = 0 then
    raise exception 'Une opération de caisse de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if p_genre <> 'recette' and p_montant < 0 then
    raise exception 'Le montant d''un apport ou d''un prélèvement est positif : un apport fait entrer des espèces, un prélèvement les fait sortir.'
      using errcode = '22023';
  end if;
  if abs(p_montant) >= 10000000000000 then
    raise exception 'Le montant d''une opération de caisse dépasse ce que l''application compte.' using errcode = '22023';
  end if;

  -- 6. La catégorie d'une recette, et son compte de produit.
  if p_genre = 'recette' then
    if p_categorie_id is null then
      raise exception 'La nature d''une recette en espèces est une catégorie de produit du dossier : à choisir.'
        using errcode = '22023';
    end if;
    select c.* into v_categorie from public.categories c
     where c.id = p_categorie_id and (c.dossier_id is null or c.dossier_id = p_dossier_id);
    if not found then
      raise exception 'Cette catégorie n''existe pas pour ce dossier.' using errcode = '22023';
    end if;
    if v_categorie.compte_comptable is null or v_categorie.compte_comptable !~ '^7[0-9]{2}' then
      raise exception 'La catégorie « % » n''a pas de compte de produit (classe 7) : une recette en espèces ne s''y range pas.',
        v_categorie.libelle using errcode = '22023';
    end if;
  elsif p_categorie_id is not null then
    raise exception 'Un apport ou un prélèvement n''a pas de catégorie : il s''écrit face au compte de l''exploitant.'
      using errcode = '22023';
  end if;

  -- 7. Le taux.
  if p_genre = 'recette' and v_assujetti then
    if p_taux_tva is null then
      raise exception 'Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».'
        using errcode = '22023';
    end if;
    if p_taux_tva not in (0, 5.5, 8.5, 10, 20) then
      raise exception 'Ce taux de TVA n''est pas pris en charge.' using errcode = '22023';
    end if;
  elsif p_taux_tva is not null then
    raise exception 'Un taux de TVA ne s''applique qu''à une recette d''un dossier assujetti.' using errcode = '22023';
  end if;

  -- 8. L'ensemble du jour : les espèces des factures sources que la caisse compte ce jour-là, et les paiements par la
  --    caisse de pièces de vente de ce jour (la migration `paiement_par_la_caisse`) — un paiement compte sa vente, le
  --    total du jour ne la compte pas une seconde fois.
  if p_genre = 'recette' then
    if p_encaissements_du_jour is null or array_position(p_encaissements_du_jour, null) is not null then
      raise exception 'La saisie d''une recette dit les encaissements en espèces de factures de son jour qu''elle a lus : une liste d''identifiants, vide s''il n''y en a aucun.'
        using errcode = '22023';
    end if;
    v_recus := array(select distinct x from unnest(p_encaissements_du_jour) x order by x);
    if cardinality(v_recus) <> cardinality(p_encaissements_du_jour) then
      raise exception 'La saisie d''une recette nomme chaque encaissement de son jour une seule fois.' using errcode = '22023';
    end if;
    v_attendus := array(
      select e.id
        from public.encaissements_factures e
        join public.factures_emises f on f.id = e.facture_id
        left join public.encaissements_factures o on o.id = e.annule_id
       where e.dossier_id = p_dossier_id and e.date_encaissement = p_date and f.source_de_la_vente
         and e.retire_le is null and e.ligne_bancaire_id is null
         and case when e.annule_id is null then e.moyen = 'especes'
                  else o.ligne_bancaire_id is null and o.moyen = 'especes' end
       order by e.id);
    v_paiements := array(
      select o.id
        from public.operations_caisse o
        join public.pieces p on p.id = o.piece_id
       where o.dossier_id = p_dossier_id and o.date = p_date and o.genre = 'paiement' and o.retire_le is null
         and p.type_piece = 'vente'
       order by o.id);
    select min(x::text)::uuid into v_ecart from unnest(v_attendus) x where x <> all (v_recus);
    if v_ecart is not null then
      select f.numero into v_numero from public.encaissements_factures e join public.factures_emises f on f.id = e.facture_id
       where e.id = v_ecart;
      raise exception 'Un encaissement en espèces de la facture % du même jour a été enregistré depuis ta lecture : relis la caisse.',
        coalesce(v_numero, '(sans numéro)') using errcode = '22023';
    end if;
    select min(x::text)::uuid into v_ecart from unnest(v_paiements) x where x <> all (v_recus);
    if v_ecart is not null then
      raise exception 'Un paiement en espèces d''une pièce de vente du même jour a été enregistré depuis ta lecture : relis la caisse.'
        using errcode = '22023';
    end if;
    select min(x::text)::uuid into v_ecart from unnest(v_recus) x where x <> all (v_attendus || v_paiements);
    if v_ecart is not null then
      select f.numero into v_numero from public.encaissements_factures e join public.factures_emises f on f.id = e.facture_id
       where e.id = v_ecart and e.dossier_id = p_dossier_id;
      if found then
        raise exception 'L''encaissement de la facture % que ta lecture comptait n''est pas dans la caisse de ce jour : relis la caisse.',
          coalesce(v_numero, '(sans numéro)') using errcode = '22023';
      end if;
      if exists (select 1 from public.operations_caisse o
                  where o.id = v_ecart and o.dossier_id = p_dossier_id and o.genre = 'paiement') then
        raise exception 'Le paiement d''une pièce que ta lecture comptait n''est pas un paiement en espèces d''une pièce de vente de ce jour : relis la caisse.'
          using errcode = '22023';
      end if;
      raise exception 'Un encaissement que ta lecture comptait n''est pas un encaissement de ce dossier : relis la caisse.'
        using errcode = '22023';
    end if;
  elsif p_encaissements_du_jour is not null and cardinality(p_encaissements_du_jour) > 0 then
    raise exception 'Seule une recette reconnaît les encaissements en espèces de son jour.' using errcode = '22023';
  end if;

  -- 9. L'écriture attendue, EN CENTIMES ENTIERS, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues
  -- présente, à l'égalité exacte — un montant reçu qui n'est pas au centime n'égale aucun nombre entier de centimes.
  -- Une ligne à zéro n'en est pas une (une recette exonérée n'a pas de ligne de TVA).
  v_caisse := public.compte_du_role(p_dossier_id, 'caisse');
  v_centimes := (abs(p_montant) * 100)::bigint;
  if p_genre = 'recette' then
    if p_taux_tva is not null and p_taux_tva > 0 then
      v_tva := (public.tva_incluse(abs(p_montant), p_taux_tva) * 100)::bigint;
      v_collectee := public.compte_du_role(p_dossier_id, 'tva_collectee');
    end if;
    v_libelle := case when p_montant > 0 then 'Recettes en espèces du ' else 'Espèces rendues le ' end
      || to_char(p_date, 'DD/MM/YYYY') || ' — ' || v_categorie.libelle;
  else
    v_dirigeant := public.compte_du_dirigeant(p_dossier_id);
    v_libelle := case when p_genre = 'apport' then 'Apport en caisse de l''exploitant'
                      else 'Prélèvement en espèces de l''exploitant' end;
  end if;
  if jsonb_typeof(p_ecritures) is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_ecritures) e(valeur)
                 where jsonb_typeof(e.valeur) is distinct from 'object'
                    or jsonb_typeof(e.valeur -> 'compte') is distinct from 'string'
                    or jsonb_typeof(e.valeur -> 'sens') is distinct from 'string'
                    or jsonb_typeof(e.valeur -> 'montant') is distinct from 'number'
                    or jsonb_typeof(coalesce(e.valeur -> 'libelle', 'null'::jsonb)) not in ('null', 'string')) then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select a.compte, a.sens, a.centimes from (values
      (v_caisse, case when p_genre = 'prelevement' or p_montant < 0 then 'credit' else 'debit' end, v_centimes),
      (case when p_genre = 'recette' then v_categorie.compte_comptable else v_dirigeant end,
       case when p_genre = 'prelevement' or p_montant < 0 then 'debit' else 'credit' end,
       v_centimes - v_tva),
      (v_collectee, case when p_montant < 0 then 'debit' else 'credit' end, v_tva)
    ) as a(compte, sens, centimes)
    where a.centimes > 0
  ), recues as (
    select e.valeur ->> 'compte' as compte, e.valeur ->> 'sens' as sens, (e.valeur ->> 'montant')::numeric * 100 as centimes
      from jsonb_array_elements(p_ecritures) e(valeur)
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, centimes::numeric from attendues
                     except all select compte, sens, centimes from recues)
     and not exists (select 1 from jsonb_array_elements(p_ecritures) e(valeur)
                      where jsonb_typeof(e.valeur -> 'libelle') = 'string' and e.valeur ->> 'libelle' <> v_libelle)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : %).',
      v_caisse using errcode = '22023';
  end if;

  -- L'opération et son écriture, d'un tenant, sous le réglage de CETTE opération, retiré aussitôt.
  perform set_config('jd.caisse', v_id::text, true);
  insert into public.operations_caisse (id, dossier_id, genre, date, montant, categorie_id, taux_tva, encaissements_du_jour,
                                        piece_id, origine, remplace_id, cree_par)
  values (v_id, p_dossier_id, p_genre, p_date, p_montant, p_categorie_id, p_taux_tva,
          case when p_genre = 'recette' then v_recus end, null, v_origine, null, auth.uid())
  returning * into v_operation;
  insert into public.ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, operation_caisse_id)
  select p_dossier_id, p_date, e.valeur ->> 'compte', v_libelle, (e.valeur ->> 'montant')::numeric, e.valeur ->> 'sens',
         'proposee', v_id
    from jsonb_array_elements(p_ecritures) e(valeur);
  perform set_config('jd.caisse', '', true);

  select coalesce(sum(b.montant) filter (where b.sens = 'debit'), 0), coalesce(sum(b.montant) filter (where b.sens = 'credit'), 0)
    into v_debit, v_credit
    from public.ecritures_brouillon b where b.operation_caisse_id = v_id;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  -- 10. La caisse jamais négative, dite ici sous les mots du geste ; une saisie d'un mois la juge à sa fin.
  if coalesce(current_setting('jd.caisse_d_un_lot', true), '') is distinct from p_dossier_id::text
     and (p_genre = 'prelevement' or p_montant < 0) then
    select n.jour, n.solde into v_jour, v_solde from public.premier_jour_negatif_de_la_caisse(p_dossier_id) n;
    if v_jour is not null then
      raise exception '%', public.texte_caisse_negative(case when p_genre = 'prelevement' then 'prelevement' else 'especes_rendues' end,
        p_montant, v_jour, v_solde) using errcode = '23514';
    end if;
  end if;
  return v_operation;
end
$$;

comment on function public.enregistrer_operation_caisse(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb) is null;

-- `qui_ecrit_la_caisse`, celle de `caisse` : au cabinet seul.
create or replace function public.qui_ecrit_la_caisse(p_dossier_id uuid) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_dossier_id is not null and exists (select 1 from public.dossiers d where d.id = p_dossier_id)
     and public.admin_du_dossier(p_dossier_id) then
    return 'cabinet';
  end if;
  raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
end
$$;

comment on function public.qui_ecrit_la_caisse(uuid) is null;

-- `changer_droits_acces` à trois paramètres, `droits_sur_le_dossier` et `client_du_dossier`, ceux de
-- `droits_des_acces_clients`, avec leurs commentaires.
create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_dossier uuid;
  v_acces public.memberships;
begin
  select m.dossier_id into v_dossier from public.memberships m where m.id = p_membership_id;
  if v_dossier is null or not public.admin_du_dossier(v_dossier) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_ventes is null and p_banque is null then
    raise exception 'Aucun droit à changer : précise « Ventes », « Banque », ou les deux.' using errcode = '22023';
  end if;
  update public.memberships m
     set droit_ventes = coalesce(p_ventes, m.droit_ventes),
         droit_banque = coalesce(p_banque, m.droit_banque)
   where m.id = p_membership_id and m.dossier_id = v_dossier
  returning m.* into v_acces;
  if not found then
    raise exception 'Cet accès vient d''être retiré : il n''a plus de droits à changer.' using errcode = 'P0002';
  end if;
  return v_acces;
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean) is
  'Change les droits « Ventes » et « Banque » d''un accès client — un droit nul reste tel quel. Réservée au cabinet du dossier de l''accès (42501, aussi pour un accès qui n''existe pas) ; n''écrit que ces deux colonnes ; rend l''accès tel que l''écriture l''a laissé.';


create or replace function public.droits_sur_le_dossier(p_dossier_id uuid) returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  select jsonb_build_object(
    'cabinet', public.admin_du_dossier(p_dossier_id),
    'membre', public.client_du_dossier(p_dossier_id, 'membre'),
    'ventes', public.gere_les_ventes(p_dossier_id),
    'banque', public.gere_la_banque(p_dossier_id)
  )
$$;

comment on function public.droits_sur_le_dossier(uuid) is
  'Les droits de l''appelant sur ce dossier : {cabinet, membre, ventes, banque}. N''écrit rien.';


create or replace function public.client_du_dossier(p_dossier_id uuid, p_droit text) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.dossier_id = p_dossier_id
      and m.user_id = auth.uid()
      and case p_droit
            when 'membre' then true
            when 'ventes' then m.droit_ventes
            when 'banque' then m.droit_banque
            else false
          end
  )
$$;

comment on function public.client_du_dossier(uuid, text) is
  'Vrai si l''appelant a un accès à ce dossier qui porte ce droit (« ventes », « banque », ou « membre » pour un accès quelconque) ; tout autre mot rend faux. Ne lit que memberships.';


-- ══ 2. Ce que la migration a créé ══════════
drop policy operations_caisse_lecture_caisse on public.operations_caisse;
drop trigger memberships_droit_caisse on public.memberships;
drop trigger dossiers_statut_tva_de_la_caisse on public.dossiers;
drop trigger dossiers_categorie_recettes_client on public.dossiers;
drop function public.caisse_du_client(uuid, integer);
drop function public.garder_droit_caisse();
drop function public.garder_statut_tva_de_la_caisse();
drop function public.garder_categorie_recettes_client();
drop function public.changer_droits_acces(uuid, boolean, boolean, boolean);
drop function public.gere_la_caisse(uuid);
alter table public.dossiers drop column categorie_recettes_client;
alter table public.memberships drop column droit_caisse;
