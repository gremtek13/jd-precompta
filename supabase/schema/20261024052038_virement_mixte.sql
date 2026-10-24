-- LE VIREMENT MIXTE (chantier EC-Q3, ligne 28.65, étape VF5h ; VF2-Q2, selon VF5-Q2). Le récit : HISTORIQUE.md,
-- « LE VIREMENT MIXTE » ; la conception : « VF5, LA BANQUE : LA CONCEPTION », § 6.
--
-- LA DÉCISION DU CABINET. VF2-Q2 (19/10/2026) : compter aussi l'encaissement de la facture d'avant la bascule cité sur le
-- mouvement qui paie aussi une facture source. VF5-Q2 (22/10/2026, à la recommandation) : de la manière (A), « le
-- registre DATE la pièce » — la vente d'avant reste comptée par sa pièce, l'exemplaire désigné de sa facture (étape VF1),
-- et l'encaissement cité sur ce mouvement devient un PAIEMENT de cette pièce, à la date du mouvement ; une pièce compte
-- une fois, ses paiements ne font que la dater.
--
-- CE QUE LA BASE FAISAIT. Un crédit de 300 € qui justifie 200 € d'une facture source et 100 € d'une facture d'avant est
-- réservé à ses encaissements (G2) ; le classement n'en comptait que 200 € (« ce qui le dépasse reste à traiter ») ; la
-- pièce de la facture d'avant ne pouvait pas s'y rapprocher (G2) ; l'écriture se refusait (« son écriture n'est pas encore
-- conçue »). Le mouvement restait réservé pour toujours, et la pièce comptait « sans paiement », à sa date de facture.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE (quatre fonctions, chacune reprise de sa définition d'hier au caractère près hors des
-- lignes que voici) :
--   1. `classer_mouvement_par_encaissements` compte AUSSI l'encaissement vivant — non retiré, qu'aucune contre-passation
--      sans mouvement n'annule — d'une facture qui n'est pas source de sa vente, cité sur ce mouvement, quand cette
--      facture a EXACTEMENT un exemplaire désigné : une pièce de vente validée de ce dossier (VF1). Sinon, un refus neuf,
--      au rang 7, avant les sommes : « Désignez d'abord l'exemplaire de la facture F… », celle de ces factures qui a le
--      plus petit numéro (octet par octet, puis son identifiant). Les rangs 1 à 6 d'hier, puis 8 à 11 (les
--      sommes d'hier, sous leurs mots) : un mouvement qui ne justifie aucun encaissement d'une facture source ne se classe
--      toujours pas par ses encaissements — la pièce d'une facture d'avant s'y rapproche comme hier.
--   2. `ecriture_attendue_vente_facturee` : un mouvement qui porte aussi l'encaissement d'une telle facture s'écrit. La
--      pièce de la facture d'avant écrit elle-même sa banque sur ce mouvement, à sa date (src/lib/contrepartieBanque.ts) :
--      la composition du mouvement n'écrit que la part des factures sources — la banque de ce que leurs encaissements du
--      même jour n'ont pas porté, le 511 ou le 53 de ceux d'un autre jour — et les frais du tout, au 627. Une facture qui
--      n'a pas son exemplaire unique et validé retient le mouvement comme hier (`mouvement_facture_non_source`), et le
--      détail nomme cette facture.
--   3. `ecrire_vente_facturee` : son refus du rang 16 nomme cette facture, sous les mots du classement ; le reste
--      inchangé — elle recompose par la fonction précédente.
--   4. LA GARDE G5 (`garder_lignes_de_la_vente_facturee`) : une ligne passée sur un mouvement classé par ses
--      encaissements n'est du troisième genre que si elle ne porte NI pièce, ni facture, ni encaissement — ses lignes
--      propres, celles que `ecrire_vente_facturee` et `retirer_ecriture_vente_facturee` écrivent et retirent déjà seules
--      (`piece_id is null`). La banque de l'exemplaire, écrite par l'application comme la banque de toute pièce payée,
--      s'insère, se reprend (« Régénérer ») et se retire sur ce mouvement ; hier, G5 la refusait en 42501 — l'insertion
--      hors du super-administrateur, le retrait et la modification pour tous —, et la manière (A) ne pouvait pas
--      s'écrire. La conception ne l'avait pas vu : le module (src/lib/ecrituresVentesFactureesEcran.ts,
--      `ligneDUneVenteFacturee`) écarte déjà une telle ligne du troisième genre ; la garde le fait désormais comme lui. Une
--      ligne du troisième genre ne s'en échappe pas en recevant une pièce, ni une ligne de pièce n'y entre en la perdant :
--      la garde juge l'ancienne ligne ET la nouvelle. Les quatre autres colonnes de source sont nulles sur une ligne qui
--      porte un mouvement (quatre contraintes, ecrituresVentesFacturees.sql, contrôle 155).
--
-- CE QUI NE CHANGE PAS. G2 : un mouvement n'est réservé que par les encaissements de factures SOURCES ; une facture
-- d'avant que rien ne mêle à une facture source se compte par sa pièce, rapprochée comme hier. Les fonctions du registre
-- (enregistrer, retirer, contre-passer, rattacher, déclarer), `retirer_classement_par_encaissements`,
-- `retirer_ecriture_vente_facturee`, `calcul_vente_facturee`, les dix-huit fonctions du relevé : inchangées.
--
-- SES REFUS, DANS L'ORDRE (src/lib/encaissementsFactures.ts, `REFUS_CLASSEMENT`, et src/lib/ecritureVenteFacturee.ts,
-- `REFUS_ECRITURE_VENTE`, les redisent avant le clic) : le classement, onze — l'accès, le mouvement introuvable, la
-- frontière, déjà classé par ses encaissements, classé autrement, aucun encaissement d'une facture source, l'exemplaire à
-- désigner (neuf), puis les quatre des sommes ; l'écriture, les vingt-deux d'hier, le seizième sous ses mots neufs.
--
-- NEUTRE EN PRODUCTION : aucun dossier n'a basculé, aucune facture n'est source, aucun mouvement n'est classé par ses
-- encaissements, aucun exemplaire n'est désigné. Aucune table, colonne, contrainte, policy ni aucun droit ne change ;
-- aucune donnée lue de plus, écrite ni retirée. `create or replace` garde l'OID de chaque fonction et ses droits
-- d'exécution : ils ne sont pas rejoués. Les commentaires du classement et de G5 disent ce qu'ils font désormais.
--
-- CE QUI CONTOURNE LA RLS : rien de plus — le classement et la composition lisent aussi les pièces désignées du dossier,
-- après le contrôle d'accès, comme ils lisent ses factures. CONCURRENCE : les exemplaires se lisent sans verrou ; une
-- désignation changée pendant un classement, ou après lui, laisse un classement qu'une désignation ne justifie plus — la
-- composition retient alors le mouvement (`mouvement_facture_non_source`), l'application ne date plus la pièce par lui,
-- et l'onglet Écritures le dit ; la validation figera les désignations (étape VF7).
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : aucun objet, aucune donnée. Le corps
-- d'`ecrire_vente_facturee` supprime, comme hier, les écritures proposées de la source qu'il remplace : le texte se colle
-- dans l'éditeur SQL, avec sa ligne d'historique. Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Les quatre fonctions d'hier d'abord, telles que cette migration les reprend ══════════

do $$
declare
  v record;
begin
  for v in select x.fonction, x.empreinte, x.migration from (values
      ('public.classer_mouvement_par_encaissements(uuid, uuid)', '02d897a772064bfcf64313356c5a3db9', 'encaissements_de_la_vente_facturee'),
      ('public.ecriture_attendue_vente_facturee(uuid, text, uuid)', 'f050e941c3d41dc97f0734c36ced5524', 'ecritures_de_la_vente_facturee'),
      ('public.ecrire_vente_facturee(uuid, text, uuid, jsonb)', '134a517449cfbf20d22c613a2b74afba', 'ecritures_de_la_vente_facturee'),
      ('public.garder_lignes_de_la_vente_facturee()', '6538f24104e70581df4bca9038b61c7c', 'ecritures_de_la_vente_facturee')
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

-- ══ 1. Classer un mouvement par ses encaissements : ceux d'une facture qui n'est pas source comptent aussi ══════════
-- La définition de `encaissements_de_la_vente_facturee`, au caractère près hors du rang 7, neuf (et de sa variable), et du
-- total des encaissements, qui ne se borne plus aux factures sources. Dans l'ordre :
--   1. l'accès ; 2. le mouvement introuvable ; 3. daté d'un exercice que la frontière fige ; 4. déjà classé par ses
--   encaissements ; 5. classé autrement ; 6. qui ne justifie aucun encaissement d'une facture source ; 7. l'encaissement
--   d'une facture qui n'est pas source sans son exemplaire unique et validé ; 8. un crédit que ses encaissements ne font
--   pas, 9. ou qu'ils dépassent au-delà des frais ; 10. un débit que ses contre-passations dépassent, 11. ou qu'elles ne
--   font pas à l'écart des frais près.
create or replace function public.classer_mouvement_par_encaissements(p_dossier_id uuid, p_ligne_bancaire_id uuid)
returns public.lignes_bancaires
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mouvement public.lignes_bancaires;
  v_frontiere date;
  v_porte numeric;
  v_ecart numeric;
  v_numero text;
begin
  if not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_mouvement from public.lignes_bancaires l
   where l.id = p_ligne_bancaire_id and l.dossier_id = p_dossier_id
   for update;
  if not found then
    raise exception 'Mouvement introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_mouvement.date <= v_frontiere then
    raise exception '% : ce mouvement ne change plus.',
      public.exercice_fige(p_dossier_id, extract(year from v_mouvement.date)::integer) using errcode = '22023';
  end if;
  if v_mouvement.encaissements_de_factures then
    raise exception 'Ce mouvement est déjà classé par ses encaissements.' using errcode = '22023';
  end if;
  if not public.mouvement_libre(v_mouvement) then
    raise exception 'Ce mouvement est déjà classé : retirer d''abord ce classement.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.encaissements_factures e
                   join public.factures_emises f on f.id = e.facture_id
                  where e.ligne_bancaire_id = p_ligne_bancaire_id and e.retire_le is null and f.source_de_la_vente
                    and public.encaissement_justifie_son_mouvement(e.id)) then
    raise exception 'Ce mouvement ne justifie aucun encaissement d''une facture source de sa vente : il ne se classe pas par des encaissements.'
      using errcode = '22023';
  end if;
  -- Le virement mixte (VF2-Q2, selon VF5-Q2 : la manière A). L'encaissement vivant d'une facture qui n'est pas source de
  -- sa vente, cité sur ce mouvement, compte aussi : sa vente se compte par la pièce de cette facture, que ce mouvement
  -- date — un paiement de son exemplaire (src/lib/rattachement.ts). Il faut donc que la facture ait exactement un
  -- exemplaire désigné, une pièce de vente validée de ce dossier (VF1) ; sinon celle de ces factures qui a le plus
  -- petit numéro est nommée.
  select f.numero into v_numero
    from public.encaissements_factures e
    join public.factures_emises f on f.id = e.facture_id
   where e.ligne_bancaire_id = p_ligne_bancaire_id and e.retire_le is null and not f.source_de_la_vente
     and public.encaissement_justifie_son_mouvement(e.id)
     and (select count(*) from public.pieces p
           where p.facture_id = f.id and p.dossier_id = p_dossier_id and p.statut = 'validee' and p.type_piece = 'vente') <> 1
   order by f.numero collate "C", f.id
   limit 1;
  if found then
    raise exception 'Désignez d''abord l''exemplaire de la facture % : ce mouvement porte aussi son encaissement, et cette facture, qui n''est pas la source de sa vente, se compte par une seule pièce validée.',
      v_numero using errcode = '22023';
  end if;
  select coalesce(sum(e.montant), 0) into v_porte
    from public.encaissements_factures e
   where e.ligne_bancaire_id = p_ligne_bancaire_id and e.retire_le is null
     and public.encaissement_justifie_son_mouvement(e.id);
  v_ecart := v_porte - v_mouvement.montant;
  if v_mouvement.montant > 0 and v_ecart < 0 then
    raise exception 'Les encaissements que ce mouvement justifie font % € pour un crédit de % € : ce qui le dépasse reste à traiter.',
      replace(to_char(v_porte, 'FM999999999990.00'), '.', ','), replace(to_char(v_mouvement.montant, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;
  if v_mouvement.montant > 0 and v_ecart * 100 * 100 > least(50000, v_porte * 200) then
    raise exception 'Les encaissements que ce mouvement justifie font % € pour un crédit de % € : l''écart dépasse ce que des frais bancaires expliquent.',
      replace(to_char(v_porte, 'FM999999999990.00'), '.', ','), replace(to_char(v_mouvement.montant, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;
  if v_mouvement.montant < 0 and v_ecart < 0 then
    raise exception 'Les contre-passations que ce mouvement justifie font % € pour un débit de % € : elles le dépassent.',
      replace(to_char(abs(v_porte), 'FM999999999990.00'), '.', ','), replace(to_char(abs(v_mouvement.montant), 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;
  if v_mouvement.montant < 0 and v_ecart * 100 * 100 > least(50000, abs(v_porte) * 200) then
    raise exception 'Les contre-passations que ce mouvement justifie font % € pour un débit de % € : l''écart dépasse ce que des frais bancaires expliquent.',
      replace(to_char(abs(v_porte), 'FM999999999990.00'), '.', ','), replace(to_char(abs(v_mouvement.montant), 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  perform set_config('jd.classement_encaissements', p_ligne_bancaire_id::text, true);
  update public.lignes_bancaires
     set encaissements_de_factures = true, statut = 'rapprochee'
   where id = p_ligne_bancaire_id
  returning * into v_mouvement;
  perform set_config('jd.classement_encaissements', '', true);
  return v_mouvement;
end
$$;

-- ══ 2. Ce qu'un mouvement écrit : la part des factures sources, et les frais du tout ══════════
-- La définition de `ecritures_de_la_vente_facturee`, au caractère près hors de la branche du mouvement : le motif d'une
-- facture qui n'est pas source ne vaut plus que sans son exemplaire unique et validé, et nomme la facture ; la banque du
-- mouvement ne porte plus ce que la pièce de cette facture écrit elle-même ; le 511 ou le 53 ne soldent que les
-- encaissements des factures sources.
create or replace function public.ecriture_attendue_vente_facturee(p_dossier_id uuid, p_source text, p_source_id uuid,
  out motif text, out detail text, out lignes text[])
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
    if not exists (select 1 from public.encaissements_factures e
                     join public.factures_emises f on f.id = e.facture_id
                    where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
                      and f.statut = 'validee' and f.source_de_la_vente and public.encaissement_justifie_son_mouvement(e.id)) then
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
       and not (f.statut = 'validee' and f.source_de_la_vente) and public.encaissement_justifie_son_mouvement(e.id)
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

-- ══ 3. Écrire : le refus du rang 16 nomme la facture, sous les mots du classement ══════════
-- La définition de `ecritures_de_la_vente_facturee`, au caractère près hors de ce refus.
create or replace function public.ecrire_vente_facturee(p_dossier_id uuid, p_source text, p_source_id uuid, p_lignes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dossier public.dossiers;
  v_document public.factures_emises;
  v_encaissement public.encaissements_factures;
  v_mouvement public.lignes_bancaires;
  v_facture_id uuid;
  v_illisible boolean;
  v_recues text[];
  v_attendues text[];
  v_motif text;
  v_detail text;
  v_libelle text;
  v_frontiere date;
  v_jour date;
  v_nb integer;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('facture', 'avoir', 'encaissement', 'mouvement') then
    raise exception 'Une écriture de vente facturée a pour source une facture, un avoir, un encaissement ou un mouvement.'
      using errcode = '22023';
  end if;
  select d.* into v_dossier from public.dossiers d where d.id = p_dossier_id for share;
  if not v_dossier.ventes_par_les_factures then
    raise exception 'Les factures de ce dossier ne sont pas la source de leurs ventes : aucune écriture de vente facturée ne s''y écrit.'
      using errcode = '22023';
  end if;

  if p_source in ('facture', 'avoir') then
    -- La facture d'abord, puis l'avoir : l'ordre d'`enregistrer_facture`, qui verrouille la facture avant de lui créer un
    -- avoir. L'avoir se lit d'abord sans verrou, pour sa facture ; il ne change pas d'origine.
    select coalesce(f.facture_origine_id, f.id) into v_facture_id from public.factures_emises f
     where f.id = p_source_id and f.dossier_id = p_dossier_id and f.type = p_source;
    perform 1 from public.factures_emises f where f.id = v_facture_id for no key update;
    select f.* into v_document from public.factures_emises f
     where f.id = p_source_id and f.dossier_id = p_dossier_id and f.type = p_source
       for no key update;
    if not found and p_source = 'facture' then
      raise exception 'Facture introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    if not found then
      raise exception 'Avoir introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    v_facture_id := coalesce(v_document.facture_origine_id, v_document.id);
  elsif p_source = 'encaissement' then
    select e.* into v_encaissement from public.encaissements_factures e
     where e.id = p_source_id and e.dossier_id = p_dossier_id;
    if not found then
      raise exception 'Encaissement introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    v_facture_id := v_encaissement.facture_id;
    perform 1 from public.factures_emises f where f.id = v_facture_id for no key update;
  else
    select l.* into v_mouvement from public.lignes_bancaires l
     where l.id = p_source_id and l.dossier_id = p_dossier_id
       for no key update;
    if not found then
      raise exception 'Mouvement introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
  end if;

  if p_source = 'facture' and not v_document.source_de_la_vente then
    raise exception 'Cette facture n''est pas la source de sa vente : elle se compte par sa pièce, sans écriture de vente facturée.'
      using errcode = '22023';
  end if;
  if p_source = 'avoir' and not v_document.source_de_la_vente then
    raise exception 'Cet avoir n''est pas la source de sa vente : il se compte par sa pièce, sans écriture de vente facturée.'
      using errcode = '22023';
  end if;
  if p_source = 'encaissement'
     and not exists (select 1 from public.factures_emises f where f.id = v_facture_id and f.source_de_la_vente) then
    raise exception 'Cet encaissement est celui d''une facture qui n''est pas la source de sa vente : il n''a pas d''écriture de vente facturée.'
      using errcode = '22023';
  end if;
  if p_source = 'mouvement' and not exists (
       select 1 from public.encaissements_factures e
         join public.factures_emises f on f.id = e.facture_id
        where e.ligne_bancaire_id = p_source_id and e.retire_le is null and f.source_de_la_vente
          and public.encaissement_justifie_son_mouvement(e.id)) then
    raise exception 'Ce mouvement ne justifie aucun encaissement d''une facture source de sa vente : il n''a pas d''écriture de vente facturée.'
      using errcode = '22023';
  end if;

  -- Les lignes reçues : une liste d'objets, chacun sa date, son compte, son sens, son montant positif au centime, son
  -- mouvement (ou nul) et, s'il veut, son libellé. Écrites comme la base écrit les siennes.
  v_illisible := jsonb_typeof(p_lignes) is distinct from 'array' or exists (
    select 1 from jsonb_array_elements(p_lignes) x
     where jsonb_typeof(x) <> 'object'
        or jsonb_typeof(x -> 'date') is distinct from 'string'
        or jsonb_typeof(x -> 'compte') is distinct from 'string'
        or coalesce(x ->> 'sens', '') not in ('debit', 'credit')
        or jsonb_typeof(x -> 'montant') is distinct from 'number'
        or jsonb_typeof(coalesce(x -> 'ligne_bancaire_id', 'null'::jsonb)) not in ('null', 'string')
        or jsonb_typeof(coalesce(x -> 'libelle', '""'::jsonb)) <> 'string');
  if not v_illisible then
    begin
      v_recues := array(
        select t.texte
          from (select to_char((x ->> 'date')::date, 'YYYY-MM-DD') || '|' || (x ->> 'compte') || '|' || (x ->> 'sens') || '|'
                       || ((x ->> 'montant')::numeric * 100)::bigint || '|'
                       || coalesce((x ->> 'ligne_bancaire_id')::uuid::text, '') as texte
                  from jsonb_array_elements(p_lignes) x) t
         order by t.texte collate "C");
      v_illisible := exists (select 1 from jsonb_array_elements(p_lignes) x
                              where not ((x ->> 'montant')::numeric > 0)
                                 or (x ->> 'montant')::numeric <> round((x ->> 'montant')::numeric, 2)
                                 or (x ->> 'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    exception when others then
      v_illisible := true;
    end;
  end if;
  if v_illisible then
    raise exception 'L''écriture proposée est illisible : une liste de lignes, chacune avec sa date, son compte, son sens, son montant positif au centime et son mouvement.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  select a.motif, a.detail, a.lignes into v_motif, v_detail, v_attendues
    from public.ecriture_attendue_vente_facturee(p_dossier_id, p_source, p_source_id) a;
  if v_motif = 'vente_ecartee' then
    v_libelle := case v_detail
      when 'nature' then 'la facture ne dit pas si elle porte sur des biens ou sur des services : on ne sait ni quand sa TVA est due, ni où la compter'
      when 'option_debits' then 'la facture ne porte pas l''option pour les débits que sa validation fige : on ne sait pas quand sa TVA est due'
      when 'sans_lignes' then 'la facture n''a aucune ligne : son TTC par taux est inconnu'
      when 'encaissement_illisible' then 'un encaissement ne se répartit pas sur les taux de la facture, au centime, pour son montant : la règle du cumul ne s''y applique pas'
      when 'contre_passation_illisible' then 'une contre-passation n''est pas l''exact opposé d''un encaissement compté avant elle'
      when 'ttc_nul' then 'ses avoirs datés au plus tard du jour d''un encaissement annulent le taux de cet encaissement : la règle du cumul n''a plus de TTC à répartir'
    end;
    raise exception 'La facture % ne se compte pas sans deviner (%) : ses écritures ne s''écrivent pas.',
      (select f.numero from public.factures_emises f where f.id = v_facture_id), v_libelle using errcode = '22023';
  end if;
  if v_motif = 'compte_a_choisir' then
    raise exception 'Cet encaissement s''écrit sur un compte de contrepartie que le cabinet choisit, et il n''est pas encore choisi.'
      using errcode = '22023';
  end if;
  if v_motif = 'compte_refuse' then
    raise exception 'Le compte de contrepartie de cet encaissement, %, est refusé : %',
      v_detail, public.refus_compte_de_contrepartie(p_dossier_id, v_detail) using errcode = '22023';
  end if;
  if v_motif = 'mouvement_facture_non_source' then
    raise exception 'Désignez d''abord l''exemplaire de la facture % : ce mouvement porte aussi son encaissement, et cette facture, qui n''est pas la source de sa vente, se compte par une seule pièce validée.',
      v_detail using errcode = '22023';
  end if;
  if v_motif = 'mouvement_vente_ecartee' then
    raise exception 'Ce mouvement porte l''encaissement d''une facture que les ventes facturées écartent : il ne s''écrit pas.'
      using errcode = '22023';
  end if;
  if v_motif = 'mouvement_non_classe' then
    raise exception 'Ce mouvement n''est pas encore classé par ses encaissements : son écriture attend ce classement.'
      using errcode = '22023';
  end if;
  if v_motif = 'mouvement_ecart' then
    raise exception 'Les encaissements que ce mouvement porte ne font pas son montant à l''écart des frais près : il ne s''écrit pas.'
      using errcode = '22023';
  end if;

  -- Ce qu'un exercice validé fige ne se compare ni ne s'écrit plus.
  v_frontiere := public.frontiere_validation(p_dossier_id);
  select min(split_part(r, '|', 1)::date) into v_jour from unnest(v_recues) r where split_part(r, '|', 1)::date <= v_frontiere;
  if v_jour is not null then
    raise exception '% : aucune écriture ne s''y passe plus.',
      public.exercice_fige(p_dossier_id, extract(year from v_jour)::integer) using errcode = '22023';
  end if;
  v_attendues := array(select a from unnest(v_attendues) a
                        where v_frontiere is null or split_part(a, '|', 1)::date > v_frontiere order by a collate "C");
  if cardinality(v_attendues) = 0 then
    raise exception 'Cette source n''a rien à écrire : ses écritures, s''il y en a, se retirent.' using errcode = '22023';
  end if;
  if v_recues is distinct from v_attendues then
    raise exception 'L''écriture proposée n''est pas celle que la base recompose pour cette source : relire la source, puis la recomposer.'
      using errcode = '22023';
  end if;

  -- Le remplacement, d'un tenant, sous le réglage de CETTE source, retiré aussitôt.
  perform set_config('jd.ecriture_vente_facturee', p_source_id::text, true);
  if p_source in ('facture', 'avoir') then
    delete from public.ecritures_brouillon b where b.facture_id = p_source_id and b.statut = 'proposee';
  elsif p_source = 'encaissement' then
    delete from public.ecritures_brouillon b where b.encaissement_id = p_source_id and b.statut = 'proposee';
  else
    delete from public.ecritures_brouillon b
     where b.ligne_bancaire_id = p_source_id and b.statut = 'proposee' and b.facture_id is null and b.encaissement_id is null
       and b.piece_id is null and b.immobilisation_id is null and b.vehicule_id is null and b.declaration_tva_id is null
       and b.cotisation_id is null;
  end if;
  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut,
                                          facture_id, encaissement_id)
  select p_dossier_id, null, (x ->> 'ligne_bancaire_id')::uuid, (x ->> 'date')::date, x ->> 'compte',
         coalesce(x ->> 'libelle', ''), (x ->> 'montant')::numeric, x ->> 'sens', 'proposee',
         case when p_source in ('facture', 'avoir') then p_source_id end,
         case when p_source = 'encaissement' then p_source_id end
    from jsonb_array_elements(p_lignes) x;
  get diagnostics v_nb = row_count;
  perform set_config('jd.ecriture_vente_facturee', '', true);
  return v_nb;
end
$$;

-- ══ 4. G5 : une ligne qui porte une pièce n'est pas du troisième genre ══════════
-- La définition de `ecritures_de_la_vente_facturee`, au caractère près hors des deux conditions qui reconnaissent le
-- troisième genre — l'ancienne ligne et la nouvelle —, et du commentaire de la première.
create or replace function public.garder_lignes_de_la_vente_facturee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reglage text := coalesce(current_setting('jd.ecriture_vente_facturee', true), '');
  v_avant text;
  v_apres text;
begin
  if tg_op <> 'INSERT' and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_op <> 'DELETE' then
    v_apres := coalesce(new.encaissement_id, new.facture_id)::text;
    -- Une ligne qui porte une pièce n'est pas du troisième genre : c'est l'écriture de cette pièce — la banque de
    -- l'exemplaire d'une facture qui n'est pas source, que ce mouvement paie (le virement mixte, VF5h).
    if v_apres is null and new.piece_id is null and exists (select 1 from public.lignes_bancaires l
                                    where l.id = new.ligne_bancaire_id and l.encaissements_de_factures) then
      v_apres := new.ligne_bancaire_id::text;
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.encaissement_id is null and new.facture_id is null and v_apres is not null
       and not public.is_super_admin() and v_reglage is distinct from v_apres then
      raise exception 'Une écriture ne se passe sur un mouvement classé par ses encaissements que par la fonction qui écrit la vente facturée.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  v_avant := coalesce(old.encaissement_id, old.facture_id)::text;
  if v_avant is null and old.piece_id is null and exists (select 1 from public.lignes_bancaires l
                                  where l.id = old.ligne_bancaire_id and l.encaissements_de_factures) then
    v_avant := old.ligne_bancaire_id::text;
  end if;
  if tg_op = 'DELETE' then
    if v_avant is not null and v_reglage is distinct from v_avant then
      raise exception 'Une écriture de vente facturée ne se retire que par la fonction qui l''écrit.' using errcode = '42501';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - array['statut', 'valide_le', 'journal_code', 'numero_ecriture', 'piece_ref', 'piece_date', 'compte_lib',
                            'comp_aux_num', 'comp_aux_lib'])
     is not distinct from (to_jsonb(old) - array['statut', 'valide_le', 'journal_code', 'numero_ecriture', 'piece_ref',
                                                'piece_date', 'compte_lib', 'comp_aux_num', 'comp_aux_lib']) then
    return new;
  end if;
  if v_avant is not null and v_reglage is distinct from v_avant or v_apres is not null and v_reglage is distinct from v_apres then
    raise exception 'Une écriture de vente facturée ne se modifie que par la fonction qui l''écrit.' using errcode = '42501';
  end if;
  return new;
end
$$;

-- ══ 5. Leurs commentaires : ceux du classement et de G5 disent ce qu'ils font désormais ══════════
comment on function public.classer_mouvement_par_encaissements(uuid, uuid) is
  'Classe un mouvement par les encaissements de factures sources qui le citent, quand ce qu''ils portent fait son montant à l''écart des frais près ; l''encaissement d''une facture qui n''est pas source, cité sur lui, y compte aussi quand cette facture a exactement un exemplaire désigné, une pièce de vente validée, que ce mouvement paie (le virement mixte) ; le cabinet seul.';
comment on function public.garder_lignes_de_la_vente_facturee() is
  'G5 : une écriture de vente facturée — une facture, un avoir, un encaissement, ou une ligne sans pièce d''un mouvement classé par ses encaissements — ne s''insère, ne se modifie ni ne se retire que par ses fonctions, sous le réglage de sa source ; la restauration, la validation et la suppression d''un dossier passent ; la banque d''une pièce que ce mouvement paie reste l''écriture de cette pièce.';
