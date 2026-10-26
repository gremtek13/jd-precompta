-- LES REFUS DU REGISTRE POUR LA FACTURE D'AVANT D'UN VIREMENT MIXTE (chantier EC-Q3, ligne 28.65, étape VF5h2 ;
-- VF5H-Q2). Le récit : HISTORIQUE.md, « LES REFUS DU REGISTRE POUR LA FACTURE D'AVANT D'UN VIREMENT MIXTE » ; le
-- virement mixte : « LE VIREMENT MIXTE » (étape VF5h).
--
-- LA DÉCISION DU CABINET (24/10/2026, VF5H-Q2, « Oui, les refuser aussi ») : étendre à l'encaissement d'une facture qui
-- n'est pas source de sa vente les refus que les fonctions du registre et leur garde opposent déjà à celui d'une facture
-- source, quand le mouvement dont il dépend est CLASSÉ PAR SES ENCAISSEMENTS — avant la première bascule réelle.
--
-- CE QUE LA BASE FAISAIT. Depuis la migration `virement_mixte` (étape VF5h), un crédit qui paie une facture source et une
-- facture d'avant la bascule, qui n'est pas source, se classe par ses encaissements, celui de la facture d'avant compris :
-- il date l'exemplaire de cette facture. Mais pour une facture qui n'est pas source, `enregistrer_encaissement` laissait
-- citer un mouvement classé par ses encaissements, `retirer_encaissement` laissait retirer, et `annuler_encaissement`
-- contre-passer sans mouvement, un encaissement dont le mouvement est classé : chacun changeait ce que ce mouvement
-- justifie — sa composition le retenait alors (`mouvement_ecart`, ou `mouvement_facture_non_source`), ses écritures
-- devenaient à réécrire ou à retirer, et l'exemplaire n'était plus daté comme le classement l'avait dit.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE — pour une facture qui n'est pas source, sur un mouvement classé par ses encaissements
-- seulement ; quatre fonctions, chacune reprise de sa définition d'hier au caractère près hors des lignes que voici :
--   1. `enregistrer_encaissement` : un rang 18, neuf, juste après le rang 17 de la facture source — le mouvement cité est
--      classé par ses encaissements ; les rangs qui suivent avancent d'un cran (19 à 30) ;
--   2. `retirer_encaissement` : un rang 8, neuf, après les sept d'hier — le mouvement dont l'encaissement dépend (le sien,
--      ou, pour une contre-passation sans mouvement, celui de l'encaissement qu'elle annule) est classé par ses
--      encaissements ; sous le verrou partagé du mouvement, comme pour une facture source ;
--   3. `annuler_encaissement` : un rang 21, neuf, après les vingt d'hier — sans débit cité (une contre-passation qui en
--      cite un se refuse avant, au rang 15), le mouvement de l'encaissement contre-passé est classé par ses
--      encaissements ; sous le même verrou partagé ;
--   4. la garde des encaissements (`garder_encaissement_facture`) : au retrait, pour qui écrirait sans la fonction, la
--      règle du rang 8, sous ses mots, en 23514 — après celle d'une facture source.
-- Chaque refus dit sa raison sous les mots de la facture source : « le cabinet retire d'abord ce classement » — « retirer
-- d'abord ce classement » à l'enregistrement, comme au rang 17.
--
-- CE QUI NE CHANGE PAS. Une facture source : ses refus, à leurs rangs, sous leurs mots. Une facture qui n'est pas source
-- sur un mouvement libre ou classé AUTREMENT — rapproché de la pièce de la facture, le plus souvent — : comme hier. La
-- garde à l'insertion — un encaissement que le propriétaire de la base insère en direct, ou que la restauration du
-- super-administrateur réinsère, sur un mouvement classé par ses encaissements, pour une facture source comme pour une
-- autre — : comme hier. Rattacher, classer, retirer un classement, déclarer, G2, la composition et l'écriture d'un
-- mouvement : inchangés.
--
-- SES REFUS, DANS L'ORDRE, dans l'en-tête de chaque fonction ci-dessous. src/lib/encaissementsFactures.ts
-- (`REFUS_ENREGISTREMENT`, `REFUS_RETRAIT`, `REFUS_CONTRE_PASSATION`) les redit avant le clic, et le client les lit
-- réécrits par `REECRITURES_CLIENT` (« ton cabinet retire d'abord ce classement »).
--
-- NEUTRE EN PRODUCTION (relevé le 24/10/2026, des comptes) : aucun dossier n'a basculé, aucune facture n'est source, aucun
-- encaissement, aucun mouvement classé par ses encaissements — aucun refus neuf ne peut s'y rencontrer. Aucune table,
-- colonne, contrainte, policy ni aucun droit ne change ; aucune donnée écrite ni retirée ; une seule lecture de plus, celle
-- du mouvement dont dépend l'encaissement d'une facture qui n'est pas source, au retrait et à la contre-passation.
-- `create or replace` garde l'OID de chaque fonction, ses droits d'exécution et son commentaire : rien n'est rejoué.
--
-- CE QUI CONTOURNE LA RLS : rien de plus — les deux fonctions lisent, après leur contrôle d'accès, le mouvement de
-- l'encaissement dont elles jugent le retrait ou la contre-passation, comme elles le font pour une facture source.
-- CONCURRENCE : ce retrait et cette contre-passation prennent désormais le verrou partagé du mouvement dont l'encaissement
-- dépend, comme pour une facture source — un classement concurrent attend, puis voit le geste ; l'enregistrement
-- verrouillait déjà le mouvement cité.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni
-- instruction qui en retire ; la garde nomme, comme hier, l'opération qu'elle refuse. Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose : le virement mixte, et les quatre fonctions d'hier telles qu'elle les reprend ══════════

do $$
declare
  v record;
begin
  -- Le virement mixte (étape VF5h) d'abord : ces refus gardent ce que son classement compte.
  if not exists (select 1 from supabase_migrations.schema_migrations m where m.name = 'virement_mixte') then
    raise exception 'Cette migration suppose le virement mixte (migration virement_mixte, étape VF5h) en base.';
  end if;
  for v in select x.fonction, x.empreinte, x.migration from (values
      ('public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb)', 'fff9e766b64e97cc7379bf85096842d4', 'encaissements_de_la_vente_facturee'),
      ('public.retirer_encaissement(uuid, uuid)', '48a3669825dda032dd62147b3cbdc9cd', 'encaissements_de_la_vente_facturee'),
      ('public.annuler_encaissement(uuid, uuid, date, text, uuid)', '93cd70fcf69ee8d76f38f33b64fc951e', 'impaye_non_declare'),
      ('public.garder_encaissement_facture()', '533f69429909033ed7edb2ead5f7681a', 'ecritures_de_la_vente_facturee')
    ) x(fonction, empreinte, migration) loop
    -- Le corps que cette migration reprend, au caractère près (les retours chariot d'un collage écartés) : une fonction
    -- changée depuis — par une autre migration, ou par une première application de celle-ci — ne se remplace pas sans
    -- être relue.
    if to_regprocedure(v.fonction) is null
       or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), '')) <> v.empreinte then
      raise exception 'La fonction % en base n''est plus celle de la migration % : cette migration ne la remplace pas sans être relue.',
        v.fonction, v.migration;
    end if;
  end loop;
end
$$;

-- ══ 1. Enregistrer : l'encaissement d'une facture qui n'est pas source ne cite pas un mouvement classé ══════════
-- La définition de `encaissements_de_la_vente_facturee`, au caractère près hors du rang 18, neuf, et de son commentaire.
-- Dans l'ordre (src/lib/encaissementsFactures.ts, `REFUS_ENREGISTREMENT`) :
--   1. l'accès ; 2. le mouvement sans le droit « Banque » ; 3. la facture introuvable ; 4. un brouillon ; 5. un avoir ;
--   6. rejetée ou refusée ; 7. des lignes qui ne redonnent pas l'en-tête ; 8 à 10. la date (renseignée, pas avant 2000, pas
--   dans l'avenir) ; 11. SOURCE : une date que la frontière d'un exercice validé fige ; 12 et 13. le montant (positif, au
--   centime) ; 14. le moyen ; 15. le mouvement d'un autre dossier ; 16. un débit ; 17. SOURCE : un mouvement déjà classé ;
--   18. NEUF — une facture qui n'est pas source : un mouvement classé par ses encaissements ; 19. le mouvement qui justifie
--   déjà un encaissement de cette facture ; 20. l'écart des frais ; 21 à 26. la répartition ; 27. le plafond de la facture,
--   ou 28. SOURCE : le même, net de ses avoirs validés ; 29. le plafond d'un taux, ou 30. SOURCE : le même, net des avoirs.
create or replace function public.enregistrer_encaissement(
  p_dossier_id uuid,
  p_facture_id uuid,
  p_date date,
  p_montant numeric,
  p_moyen text,
  p_ligne_bancaire_id uuid,
  p_repartition jsonb
)
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
  if v_facture.statut <> 'validee' then
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
  select coalesce(sum(m.base_centimes), 0), coalesce(sum(m.tva_centimes), 0) into v_base, v_tva
    from public.montants_par_taux_facture(p_facture_id) m;
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
  if not v_facture.source_de_la_vente then
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
    select m.ttc_centimes into v_ttc from public.montants_par_taux_facture(p_facture_id) m where m.taux = v_part.taux;
    select coalesce(sum(t.montant), 0) into v_deja
      from public.encaissements_factures_taux t
      join public.encaissements_factures e on e.id = t.encaissement_id
     where e.facture_id = p_facture_id and e.retire_le is null and t.taux = v_part.taux;
    if not v_facture.source_de_la_vente then
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

-- ══ 2. Retirer : l'encaissement d'une facture qui n'est pas source, sur un mouvement classé, ne se retire pas ══════════
-- La définition de `encaissements_de_la_vente_facturee`, au caractère près hors du rang 8, neuf, et de son commentaire.
-- Dans l'ordre (`REFUS_RETRAIT`) : 1. l'accès ; 2. l'encaissement introuvable ; 3. déjà retiré ; 4. déclaré ; 5. annulé par
-- une contre-passation vivante ; 6. SOURCE : daté d'un exercice que la frontière fige ; 7. SOURCE : le mouvement dont il
-- dépend, classé ; 8. NEUF — une facture qui n'est pas source : le mouvement dont il dépend, classé par ses encaissements.
create or replace function public.retirer_encaissement(p_dossier_id uuid, p_encaissement_id uuid)
returns public.encaissements_factures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_encaissement public.encaissements_factures;
  v_source boolean;
  v_frontiere date;
  v_ligne uuid;
  v_mouvement public.lignes_bancaires;
begin
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_encaissement from public.encaissements_factures e
   where e.id = p_encaissement_id and e.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Encaissement introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  select f.source_de_la_vente into v_source from public.factures_emises f where f.id = v_encaissement.facture_id
   for no key update;
  select * into v_encaissement from public.encaissements_factures e where e.id = p_encaissement_id for update;
  if v_encaissement.retire_le is not null then
    raise exception 'Cet encaissement est déjà retiré.' using errcode = '22023';
  end if;
  if public.encaissement_declare(p_encaissement_id) then
    raise exception 'Un encaissement déclaré ne se retire pas : il se contre-passe, et l''annulation se déclare à son tour.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.encaissements_factures c where c.annule_id = p_encaissement_id and c.retire_le is null) then
    raise exception 'Cet encaissement est annulé par une contre-passation : retirez d''abord celle-ci.' using errcode = '22023';
  end if;
  if v_source then
    perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
    v_frontiere := public.frontiere_validation(p_dossier_id);
    if v_frontiere is not null and v_encaissement.date_encaissement <= v_frontiere then
      raise exception '% : cet encaissement ne se retire plus.',
        public.exercice_fige(p_dossier_id, extract(year from v_encaissement.date_encaissement)::integer) using errcode = '22023';
    end if;
    -- Le verrou partagé du mouvement : un classement concurrent attend ce retrait, puis le voit.
    v_ligne := coalesce(v_encaissement.ligne_bancaire_id,
      (select c.ligne_bancaire_id from public.encaissements_factures c where c.id = v_encaissement.annule_id));
    if v_ligne is not null then
      select * into v_mouvement from public.lignes_bancaires l where l.id = v_ligne for share;
      if not public.mouvement_libre(v_mouvement) then
        raise exception 'Le mouvement dont dépend cet encaissement est classé : le cabinet retire d''abord ce classement.'
          using errcode = '22023';
      end if;
    end if;
  else
    -- Pour une facture qui n'est pas source (étape VF5h2, VF5H-Q2) : le mouvement dont il dépend — le sien, ou, pour une
    -- contre-passation sans mouvement, celui de l'encaissement qu'elle annule — CLASSÉ PAR SES ENCAISSEMENTS. Le virement
    -- mixte compte cet encaissement, ou l'écarte tant que la contre-passation vit : le retrait changerait ce qu'il
    -- justifie. Classé autrement — rapproché de la pièce de la facture, le plus souvent —, il se retire comme hier. Le
    -- verrou partagé du mouvement, comme pour une facture source : un classement concurrent attend ce retrait, puis le
    -- voit.
    v_ligne := coalesce(v_encaissement.ligne_bancaire_id,
      (select c.ligne_bancaire_id from public.encaissements_factures c where c.id = v_encaissement.annule_id));
    if v_ligne is not null then
      select * into v_mouvement from public.lignes_bancaires l where l.id = v_ligne for share;
      if v_mouvement.encaissements_de_factures then
        raise exception 'Le mouvement dont dépend cet encaissement est classé par ses encaissements : le cabinet retire d''abord ce classement.'
          using errcode = '22023';
      end if;
    end if;
  end if;
  update public.encaissements_factures
     set retire_le = now(), retire_par = auth.uid()
   where id = p_encaissement_id
  returning * into v_encaissement;
  return v_encaissement;
end
$$;

-- ══ 3. Contre-passer : sans débit, celui d'une facture qui n'est pas source, sur un mouvement classé, non plus ══════════
-- La définition de `impaye_non_declare`, au caractère près hors du rang 21, neuf, et de son commentaire. Dans l'ordre
-- (`REFUS_CONTRE_PASSATION`) : les vingt d'hier, à leurs rangs, sous leurs mots — dont, sans débit, le rang 20 d'une
-- facture source ; 21. NEUF — sans débit, pour une facture qui n'est pas source : le mouvement de l'encaissement
-- contre-passé, classé par ses encaissements.
create or replace function public.annuler_encaissement(
  p_dossier_id uuid,
  p_encaissement_id uuid,
  p_date date,
  p_motif text,
  p_ligne_bancaire_id uuid default null
)
returns public.encaissements_factures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_encaissement public.encaissements_factures;
  v_declaration public.transmissions_encaissements;
  v_annulation public.encaissements_factures;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_source boolean;
  v_frontiere date;
  v_mouvement public.lignes_bancaires;
  v_total numeric;
  v_exces numeric;
  v_classe boolean;
begin
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- Le débit qui défait l'encaissement est une donnée de la banque, comme le mouvement qui le prouve : le citer demande
  -- aussi le droit « Banque », sous le refus du rang 2 d'`enregistrer_encaissement`, et avant toute lecture — sans lui,
  -- rien ne se dit du mouvement ni de l'encaissement. Le cabinet a les deux ; un client qui n'a que « Ventes »
  -- contre-passe sans débit.
  if p_ligne_bancaire_id is not null and not public.gere_la_banque(p_dossier_id) then
    raise exception 'Le mouvement bancaire d''un encaissement ne se désigne qu''avec le droit « Banque » sur ce dossier : sans lui, l''encaissement s''enregistre sans mouvement.'
      using errcode = '42501';
  end if;
  select * into v_encaissement from public.encaissements_factures e
   where e.id = p_encaissement_id and e.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Encaissement introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  select f.source_de_la_vente into v_source from public.factures_emises f where f.id = v_encaissement.facture_id
   for no key update;
  select * into v_encaissement from public.encaissements_factures e where e.id = p_encaissement_id for update;

  if v_encaissement.annule_id is not null then
    raise exception 'Une annulation ne se contre-passe pas : l''encaissement qu''elle annulait se saisit de nouveau.'
      using errcode = '22023';
  end if;
  if v_encaissement.retire_le is not null then
    raise exception 'Un encaissement retiré ne s''annule pas : il n''a jamais été déclaré.' using errcode = '22023';
  end if;
  select * into v_declaration from public.transmissions_encaissements t
   where t.encaissement_id = p_encaissement_id and t.etat in ('envoi', 'depose', 'accepte');
  -- Jamais déclaré, un encaissement se retire ; mais celui d'une facture source que la banque a défait — le chèque
  -- revenu impayé, la somme rendue — se contre-passe aussi, en citant ce débit (étape VF5d2) : la contre-passation
  -- garde le fait, et ne se déclare pas plus que lui (`declarer_encaissement_hors_application`, son rang 5). Sans
  -- débit, ou pour une facture qui n'est pas source — ou une source illisible —, le refus d'hier.
  if not found and (p_ligne_bancaire_id is null or v_source is not true) then
    raise exception 'Cet encaissement n''est pas déclaré : il se retire, sans contre-passation.' using errcode = '22023';
  end if;
  if v_declaration.etat = 'envoi' then
    raise exception 'La déclaration de cet encaissement a une issue inconnue : il ne s''annule pas tant qu''elle n''est pas tranchée.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.encaissements_factures c where c.annule_id = p_encaissement_id and c.retire_le is null) then
    raise exception 'Cet encaissement est déjà annulé par une contre-passation.' using errcode = '22023';
  end if;

  if p_date is null then
    raise exception 'La date de la contre-passation est à renseigner.' using errcode = '22023';
  end if;
  if p_date < v_encaissement.date_encaissement then
    raise exception 'Une contre-passation ne se date pas avant l''encaissement qu''elle annule, du %.',
      to_char(v_encaissement.date_encaissement, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_date > v_aujourd_hui then
    raise exception 'Une contre-passation ne se date pas dans l''avenir : nous sommes le %.', to_char(v_aujourd_hui, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  if v_source then
    perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
    v_frontiere := public.frontiere_validation(p_dossier_id);
    if v_frontiere is not null and p_date <= v_frontiere then
      raise exception '% : une contre-passation ne s''y date plus.',
        public.exercice_fige(p_dossier_id, extract(year from p_date)::integer) using errcode = '22023';
    end if;
  end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'Le motif de la contre-passation est à renseigner.' using errcode = '22023';
  end if;
  if length(p_motif) > 2000 then
    raise exception 'Le motif de la contre-passation dépasse 2 000 caractères.' using errcode = '22023';
  end if;

  if p_ligne_bancaire_id is not null then
    if not v_source then
      raise exception 'Seule la contre-passation d''une facture source de sa vente cite le mouvement qui défait l''encaissement.'
        using errcode = '22023';
    end if;
    select * into v_mouvement from public.lignes_bancaires l
     where l.id = p_ligne_bancaire_id and l.dossier_id = p_dossier_id
     for no key update;
    if not found then
      raise exception 'Ce mouvement n''est pas un mouvement de ce dossier.' using errcode = '22023';
    end if;
    if v_mouvement.montant >= 0 then
      raise exception 'Une contre-passation se justifie par un débit : ce mouvement n''en est pas un.' using errcode = '22023';
    end if;
    if not public.mouvement_libre(v_mouvement) then
      raise exception 'Ce mouvement est déjà classé : l''encaissement d''une facture source de sa vente ne cite qu''un mouvement que rien ne classe encore — retirer d''abord ce classement.'
        using errcode = '22023';
    end if;
    select coalesce(sum(c.montant), 0) - v_encaissement.montant into v_total
      from public.encaissements_factures c
     where c.ligne_bancaire_id = p_ligne_bancaire_id and c.retire_le is null;
    -- Comme pour un crédit, en valeur absolue : les contre-passations ne dépassent le débit que de ce que des frais
    -- expliquent.
    v_exces := (abs(v_total) - abs(v_mouvement.montant)) * 100;
    if v_exces * 100 > least(50000, abs(v_total) * 200) then
      raise exception 'Ce mouvement de % € justifierait % € de contre-passations : l''écart dépasse ce que des frais bancaires expliquent.',
        replace(to_char(abs(v_mouvement.montant), 'FM999999999990.00'), '.', ','), replace(to_char(abs(v_total), 'FM999999999990.00'), '.', ',')
        using errcode = '22023';
    end if;
  elsif v_source and v_encaissement.ligne_bancaire_id is not null then
    -- Le verrou partagé du mouvement : un classement concurrent attend cette contre-passation, puis la voit.
    select l.encaissements_de_factures into v_classe from public.lignes_bancaires l
     where l.id = v_encaissement.ligne_bancaire_id for share;
    if v_classe then
      raise exception 'Le mouvement de l''encaissement contre-passé est classé par ses encaissements : la contre-passation cite le débit qui défait l''encaissement, ou le cabinet retire d''abord ce classement.'
        using errcode = '22023';
    end if;
  elsif v_encaissement.ligne_bancaire_id is not null then
    -- Pour une facture qui n'est pas source (étape VF5h2, VF5H-Q2) : le mouvement de l'encaissement contre-passé, classé
    -- par ses encaissements — le virement mixte compte cet encaissement, et la contre-passation sans mouvement l'en
    -- écarterait ; elle ne cite pas de débit (le rang 15). Le même verrou partagé : un classement concurrent attend, puis
    -- la voit.
    select l.encaissements_de_factures into v_classe from public.lignes_bancaires l
     where l.id = v_encaissement.ligne_bancaire_id for share;
    if v_classe then
      raise exception 'Le mouvement de l''encaissement contre-passé est classé par ses encaissements : le cabinet retire d''abord ce classement.'
        using errcode = '22023';
    end if;
  end if;

  insert into public.encaissements_factures (
    dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif, ligne_bancaire_id, cree_par
  ) values (
    p_dossier_id, v_encaissement.facture_id, p_date, -v_encaissement.montant, v_encaissement.moyen, p_encaissement_id,
    p_motif, p_ligne_bancaire_id, auth.uid()
  )
  returning * into v_annulation;
  insert into public.encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
  select v_annulation.id, p_dossier_id, t.taux, -t.montant
    from public.encaissements_factures_taux t
   where t.encaissement_id = p_encaissement_id;
  return v_annulation;
end
$$;

-- ══ 4. La garde des encaissements : au retrait, la règle du rang 8 ══════════
-- La définition de `ecritures_de_la_vente_facturee`, au caractère près hors de la règle neuve et de son commentaire : au
-- retrait, après la règle d'une facture source, celle d'une facture qui ne l'est pas, sous les mots du rang 8, en 23514.
create or replace function public.garder_encaissement_facture() returns trigger
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
    select f.source_de_la_vente into v_source from public.factures_emises f
     where f.id = new.facture_id and f.dossier_id = new.dossier_id
       and f.statut = 'validee' and f.type = 'facture';
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
    -- La restauration (le super-administrateur insère) réinsère ce qui a été : un encaissement contre-passé sans
    -- mouvement ne justifie plus le sien, que le cabinet a pu classer ensuite autrement.
    if coalesce(v_source, false) and not (tg_op = 'INSERT' and public.is_super_admin()) and exists (
         select 1 from public.lignes_bancaires l
          where l.id = v_ligne.ligne_bancaire_id and not l.encaissements_de_factures and not public.mouvement_libre(l)) then
      raise exception 'Un mouvement déjà classé ne se cite pas : l''encaissement d''une facture source de sa vente ne cite qu''un mouvement que rien d''autre ne classe.'
        using errcode = '23514';
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
