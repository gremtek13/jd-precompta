-- LES FONCTIONS DU RELEVÉ NE TOUCHENT QUE LES LIGNES PROPRES AU MOUVEMENT (chantier EC-Q3, ligne 28.6, le lot de R1 ; après
-- la migration de VF4b, `ecritures_de_la_vente_facturee`, qu'elle exige). Le défaut : HISTORIQUE.md, « LES ÉCRITURES D'UNE
-- VENTE FACTURÉE, EN BASE », « À REVOIR », R1 ; l'en-tête de la migration de VF4b, point 4.
--
-- LE DÉFAUT. Un mouvement classé par ses encaissements, déclassé (`retirer_classement_par_encaissements`), puis dont
-- l'encaissement du même jour est contre-passé sans mouvement — ou retiré —, redevient libre, mais porte encore des lignes
-- d'une vente facturée : la banque de l'encaissement et celle de sa contre-passation, qui portent son identifiant ([T]) —
-- justes, la base les recompose encore —, ou celles, périmées, de l'encaissement retiré, jusqu'à
-- `retirer_ecriture_vente_facturee`. Les dix-huit fonctions du relevé qui classent ou déclassent un mouvement supprimaient
-- ses lignes sans pièce (quinze), toutes ses lignes (le règlement groupé et son retrait) ou celles des mouvements d'une
-- déclaration (son retrait) : elles touchaient ces lignes, G5 levait 42501, et le mouvement ne se classait plus.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE. Dans chacune des dix-huit, ce qu'elle supprime des lignes du mouvement, et ce qu'elle en
-- lit pour juger (une écriture validée retient le mouvement) ou pour vérifier (l'équilibre de l'écriture qu'elle vient
-- d'écrire) : ces lignes, moins celles qui portent une facture ou un encaissement — « and facture_id is null and
-- encaissement_id is null », ajouté aux quarante-trois clauses qui désignent les lignes d'un mouvement, et nulle part
-- ailleurs. Chaque fonction est reprise de sa dernière définition, au caractère près hors de ces clauses : même signature,
-- même sécurité (`security invoker`, les dix-huit), même chemin, mêmes verrous, mêmes refus dans le même ordre, sous les
-- mêmes mots ; ses droits et son commentaire restent (`create or replace`).
--   - Les huit qui classent, trois clauses chacune — juger, supprimer, vérifier —, sauf le règlement groupé, qui n'écrit
--     rien et n'a que les deux premières : `affecter_mouvement_bancaire`, `classer_virement_personnel`,
--     `ecrire_mouvement_compte_bilan`, `ventiler_mouvement_bancaire`, `regler_pieces_par_mouvement`,
--     `rapprocher_echeance_emprunt`, `rapprocher_cotisation`, `rapprocher_declaration_tva`.
--   - Les dix qui déclassent, deux clauses chacune — juger, supprimer — : `retirer_affectation_mouvement_bancaire`,
--     `retirer_virement_personnel`, `retirer_mouvement_compte_bilan`, `retirer_ventilation_mouvement_bancaire`,
--     `retirer_reglement_groupe`, `retirer_echeance_emprunt`, `retirer_rapprochement_cotisation`,
--     `supprimer_echeance_cotisation`, `retirer_rapprochement_declaration_tva`, `retirer_declaration_tva` (ses mouvements ;
--     sa liquidation, sans mouvement, se retire comme avant).
--
-- POURQUOI CES DEUX COLONNES, ET PAS « TOUTES COLONNES DE SOURCE NULLES » (le retrait d'un mouvement de VF4b). Sur une ligne
-- qui porte un mouvement, les quatre autres colonnes de source sont nulles par contrainte — `cotisation_id`
-- (`ecritures_brouillon_cotisation_sans_autre_source`), `immobilisation_id` (`ecritures_brouillon_dotation_sans_piece_ni_mouvement`),
-- `vehicule_id` (`ecritures_brouillon_forfait_sans_piece_ni_mouvement`), `declaration_tva_id`
-- (`ecritures_brouillon_liquidation_sans_autre_source`) —, et `piece_id` garde dans chaque fonction le sens qu'elle lui
-- donnait : quinze ne touchent que les lignes sans pièce ; le règlement groupé et son retrait touchent aussi celles des
-- pièces qu'il règle, que l'application réécrit ensuite. Pour les quinze, « toutes colonnes de source nulles » est donc
-- exactement ce qui s'écrit ici ; l'écrire en entier ajouterait quatre filtres qu'aucune ligne ne peut contredire, et
-- ôterait aux deux autres les lignes de leurs pièces. Les quatre contraintes, l'essai les vérifie au catalogue
-- (supabase/essais/ecrituresVentesFacturees.sql, contrôle 155) : l'une relâchée, ce choix se revoit.
--
-- CE QUI EN DÉCOULE. Sur le mouvement libéré, chaque fonction classe ou déclasse comme ailleurs : ses lignes propres
-- remplacées ou retirées, celles d'une vente facturée laissées telles quelles — elles ne s'écrivent et ne se retirent que
-- par leurs deux fonctions, sous G5. Une ligne d'une vente facturée validée ne retient plus le mouvement, dont elle n'est
-- pas l'écriture ; ce qui le fige reste la frontière de la validation (`garder_mouvement_valide`). Ce qu'une fonction de
-- retrait rend compte ses lignes propres. Les lignes périmées d'un encaissement retiré restent sur le mouvement jusqu'à
-- `retirer_ecriture_vente_facturee` (R3 : l'onglet Écritures les dit « à retirer »). Le dix-neuvième chemin, le retrait
-- d'une pièce rapprochée en engagement (`retirerContrepartieBanque`, src/lib/contrepartieBanque.ts), s'aligne de même
-- dans le navigateur. Éprouvé : ecrituresVentesFacturees.sql, contrôles 95 et 96, et la batterie des dix-huit (130 à 139).
--
-- NEUTRE : aucun dossier n'a basculé, aucune ligne ne porte `facture_id` ni `encaissement_id` ; sur toute autre ligne, les
-- dix-huit font exactement ce qu'elles faisaient. Aucune table, colonne, contrainte, policy ni aucun droit ne change ;
-- aucune donnée écrite, lue de plus ni retirée.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : aucune donnée, aucun objet. Les corps des
-- dix-huit suppriment des écritures, comme ils le faisaient : le texte se colle dans l'éditeur SQL, avec sa ligne
-- d'historique.
--
-- CE QUI CONTOURNE LA RLS : rien de plus qu'avant — les dix-huit restent `security invoker`, et jugent l'accès
-- (`admin_du_dossier`) avant toute écriture, comme avant.
--
-- CONCURRENCE : inchangée — le mouvement (ou l'échéance, ou la déclaration) verrouillé d'abord, puis, pour celles qui lisent
-- le plan, le verrou partagé de la validation.
--
-- VERSION PROVISOIRE : le fichier prendra la version que la ligne d'historique recevra au collage.

-- ══ 0. La migration de VF4b d'abord ══════════

do $$
begin
  if to_regprocedure('public.garder_lignes_de_la_vente_facturee()') is null
     or (select count(*) from pg_attribute
          where attrelid = 'public.ecritures_brouillon'::regclass and attname in ('facture_id', 'encaissement_id')
            and not attisdropped) <> 2 then
    raise exception 'La migration de l''étape VF4b (ecritures_de_la_vente_facturee) précède celle-ci : elle n''est pas en base.';
  end if;
end
$$;

-- ══ 1. L'affectation à une catégorie ══════════

-- `affecter_mouvement_bancaire` : l'écriture validée, la suppression, l'équilibre.
create or replace function public.affecter_mouvement_bancaire(
  p_ligne_bancaire_id uuid,
  p_categorie_id uuid,
  p_ecritures jsonb,
  p_taux_tva numeric default null
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_categorie public.categories%rowtype;
  v_assujetti boolean;
  v_avec_taux boolean;
  v_tva numeric := 0;
  v_sens_banque text;
  v_sens_compte text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
  v_banque text;
  v_tva_collectee text;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce ou d''une échéance, ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  select * into v_categorie from public.categories where id = p_categorie_id;
  if not found or (v_categorie.dossier_id is not null and v_categorie.dossier_id <> v_ligne.dossier_id) then
    raise exception 'Cette catégorie n''existe pas pour ce dossier.' using errcode = '22023';
  end if;
  if v_categorie.compte_comptable is null or v_categorie.compte_comptable !~ '^[67][0-9]{2}' then
    raise exception 'La catégorie « % » n''a pas de compte de charge ou de produit (classe 6 ou 7).', v_categorie.libelle
      using errcode = '22023';
  end if;

  -- Le taux : exigé pour une recette d'un dossier assujetti, refusé partout ailleurs.
  select assujetti_tva into v_assujetti from public.dossiers where id = v_ligne.dossier_id;
  v_avec_taux := v_assujetti and v_categorie.compte_comptable ~ '^7';
  if v_avec_taux and p_taux_tva is null then
    raise exception 'Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».'
      using errcode = '22023';
  end if;
  if not v_avec_taux and p_taux_tva is not null then
    raise exception 'Un taux de TVA ne s''applique qu''à une recette d''un dossier assujetti.' using errcode = '22023';
  end if;
  if p_taux_tva is not null and p_taux_tva not in (0, 5.5, 8.5, 10, 20) then
    raise exception 'Ce taux de TVA n''est pas pris en charge.' using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;

  -- L'écriture attendue : la banque au montant et dans le sens du mouvement, la catégorie au hors taxe
  -- dans le sens inverse, et la TVA collectée à côté d'elle quand le taux en porte. Comparée en
  -- MULTIENSEMBLE, comme celle d'une ventilation : autant de lignes, et chacune des attendues présente.
  if p_taux_tva is not null then
    v_tva := public.tva_incluse(v_ligne.montant, p_taux_tva);
  end if;
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  v_sens_compte := case when v_ligne.montant > 0 then 'credit' else 'debit' end;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_tva_collectee := public.compte_du_role(v_ligne.dossier_id, 'tva_collectee');
  with attendues as (
    select v_banque as compte, v_sens_banque as sens, abs(v_ligne.montant) as montant
    union all
    select v_categorie.compte_comptable, v_sens_compte, abs(v_ligne.montant) - v_tva
    union all
    select v_tva_collectee, v_sens_compte, v_tva where v_tva > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set categorie_id = p_categorie_id, taux_tva = p_taux_tva, statut = 'rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

-- `retirer_affectation_mouvement_bancaire` : l'écriture validée, la suppression.
create or replace function public.retirer_affectation_mouvement_bancaire(p_ligne_bancaire_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.categorie_id is null then
    raise exception 'Ce mouvement n''est affecté à aucune catégorie.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set categorie_id = null, taux_tva = null, statut = 'non_rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

-- ══ 2. Le virement personnel ══════════

-- `classer_virement_personnel` : l'écriture validée, la suppression, l'équilibre.
create or replace function public.classer_virement_personnel(p_ligne_bancaire_id uuid, p_ecritures jsonb) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_compte text;
  v_banque text;
  v_sens_banque text;
  v_nb_banque integer;
  v_nb_banque_juste integer;
  v_nb_autres integer;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null then
    raise exception 'Ce mouvement est rapproché d''une pièce ou d''une échéance, ou affecté à une catégorie : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_compte := public.compte_du_dirigeant(v_ligne.dossier_id);

  if jsonb_typeof(p_ecritures) is distinct from 'array' or jsonb_array_length(p_ecritures) < 2 then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  select count(*) filter (where e->>'compte' = v_banque),
         count(*) filter (where e->>'compte' = v_banque and e->>'sens' = v_sens_banque
                            and (e->>'montant')::numeric = abs(v_ligne.montant)),
         count(*) filter (where (e->>'compte') is distinct from v_banque and (e->>'compte') is distinct from v_compte)
    into v_nb_banque, v_nb_banque_juste, v_nb_autres
  from jsonb_array_elements(p_ecritures) as e;
  if v_nb_banque <> 1 or v_nb_banque_juste <> 1 or v_nb_autres > 0 then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et au compte du dirigeant (%).', v_compte
      using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'ignoree', prelevement_personnel = true
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

-- `retirer_virement_personnel` : l'écriture validée, la suppression.
create or replace function public.retirer_virement_personnel(p_ligne_bancaire_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if not v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement n''est pas classé en virement personnel.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set statut = 'non_rapprochee', prelevement_personnel = false
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

-- ══ 3. Le compte de bilan ══════════

-- `ecrire_mouvement_compte_bilan` : l'écriture validée, la suppression, l'équilibre.
create or replace function public.ecrire_mouvement_compte_bilan(p_ligne_bancaire_id uuid, p_compte text, p_ecritures jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_mode text;
  v_dirigeant text;
  v_banque text;
  v_refus text;
  v_sens_banque text;
  v_sens_compte text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.reglement_groupe then
    raise exception 'Ce mouvement règle plusieurs pièces : annule d''abord ce règlement groupé.' using errcode = '22023';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.emprunt_id is not null or v_ligne.ventilee or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  -- Le compte du dirigeant se lit dans le dossier, comme pour un virement personnel : celui du rôle `exploitant`
  -- en trésorerie (108000 par défaut), le compte choisi pour lui en engagement.
  select mode_comptable, public.compte_du_dirigeant(id)
    into v_mode, v_dirigeant from public.dossiers where id = v_ligne.dossier_id;
  v_refus := public.refus_compte_de_bilan(p_compte, v_mode, v_dirigeant);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  -- L'écriture attendue : la banque au montant et dans le sens du mouvement, le compte choisi en face. Comparée en
  -- MULTIENSEMBLE, comme celle d'une affectation : autant de lignes, et chacune des attendues présente.
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  v_sens_compte := case when v_ligne.montant > 0 then 'credit' else 'debit' end;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select v_banque as compte, v_sens_banque as sens, abs(v_ligne.montant) as montant
    union all
    select p_compte, v_sens_compte, abs(v_ligne.montant)
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à ce compte.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set compte_bilan = p_compte, statut = 'rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

-- `retirer_mouvement_compte_bilan` : l'écriture validée, la suppression.
create or replace function public.retirer_mouvement_compte_bilan(p_ligne_bancaire_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.compte_bilan is null then
    raise exception 'Ce mouvement n''est écrit sur aucun compte de bilan.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set compte_bilan = null, statut = 'non_rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

-- ══ 4. La ventilation ══════════

-- `ventiler_mouvement_bancaire` : l'écriture validée, la suppression, l'équilibre.
create or replace function public.ventiler_mouvement_bancaire(
  p_ligne_bancaire_id uuid,
  p_parts jsonb,
  p_ecritures jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_part record;
  v_somme numeric := 0;
  v_nb_parts integer;
  v_nb_cibles integer;
  v_assujetti boolean;
  v_compte_dirigeant text;
  v_banque text;
  v_tva_collectee text;
  v_libelle text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.emprunt_id is not null or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- Les parts : au moins deux — une seule serait une affectation, qui a sa forme à elle —, chacune une
  -- cible et un montant non nul au centime (la colonne arrondirait en silence), une part par cible, et
  -- leur somme est le mouvement, au centime.
  if jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts) < 2 then
    raise exception 'Une ventilation porte au moins deux parts.' using errcode = '22023';
  end if;
  for v_part in
    select (e->>'categorie_id')::uuid as categorie_id,
           coalesce((e->>'part_personnelle')::boolean, false) as part_personnelle,
           (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_parts) as e
  loop
    if num_nonnulls(v_part.categorie_id, nullif(v_part.part_personnelle, false)) <> 1 then
      raise exception 'Chaque part va à une catégorie ou au compte du dirigeant, jamais aux deux ni à aucun.'
        using errcode = '22023';
    end if;
    if v_part.montant is null or v_part.montant = 0 or v_part.montant <> round(v_part.montant, 2) then
      raise exception 'Chaque part porte un montant non nul, au centime.' using errcode = '22023';
    end if;
    v_somme := v_somme + v_part.montant;
  end loop;
  select count(*), count(distinct coalesce((e->>'categorie_id')::uuid::text, 'dirigeant'))
    into v_nb_parts, v_nb_cibles
  from jsonb_array_elements(p_parts) as e;
  if v_nb_cibles <> v_nb_parts then
    raise exception 'Deux parts vont à la même catégorie, ou au compte du dirigeant : réunis-les en une.'
      using errcode = '22023';
  end if;
  if v_somme <> v_ligne.montant then
    raise exception 'Les parts font % € au lieu des % € du mouvement.',
      replace(to_char(v_somme, 'FM999999999990.00'), '.', ','),
      replace(to_char(v_ligne.montant, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_parts) as e
     where e->>'categorie_id' is not null
       and not exists (
         select 1 from public.categories c
          where c.id = (e->>'categorie_id')::uuid
            and (c.dossier_id is null or c.dossier_id = v_ligne.dossier_id)
       )
  ) then
    raise exception 'Cette catégorie n''existe pas pour ce dossier.' using errcode = '22023';
  end if;
  select c.libelle into v_libelle
    from public.categories c
   where c.id in (select (e->>'categorie_id')::uuid from jsonb_array_elements(p_parts) as e)
     and (c.compte_comptable is null or c.compte_comptable !~ '^[67][0-9]{2}')
   order by c.libelle
   limit 1;
  if found then
    raise exception 'La catégorie « % » n''a pas de compte de charge ou de produit (classe 6 ou 7).', v_libelle
      using errcode = '22023';
  end if;
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_tva_collectee := public.compte_du_role(v_ligne.dossier_id, 'tva_collectee');
  select assujetti_tva, public.compte_du_dirigeant(id)
    into v_assujetti, v_compte_dirigeant
  from public.dossiers where id = v_ligne.dossier_id;

  -- Le taux de chaque part : exigé pour une part de recette d'un dossier assujetti, refusé ailleurs. La
  -- première part fautive dans l'ordre des libellés, comme ci-dessus : deux parts fautives ne font pas
  -- deux messages différents selon leur ordre.
  select c.libelle into v_libelle
    from jsonb_array_elements(p_parts) as e
    join public.categories c on c.id = (e->>'categorie_id')::uuid
   where v_assujetti and c.compte_comptable ~ '^7' and e->>'taux_tva' is null
   order by c.libelle
   limit 1;
  if found then
    raise exception 'Sur un dossier assujetti à la TVA, la part « % » est une recette : choisis son taux, ou « exonérée ».', v_libelle
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_parts) as e
    left join public.categories c on c.id = (e->>'categorie_id')::uuid
    where e->>'taux_tva' is not null
      and not (v_assujetti and coalesce(c.compte_comptable ~ '^7', false))
  ) then
    raise exception 'Un taux de TVA ne s''applique qu''à une part de recette d''un dossier assujetti.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_parts) as e
    where (e->>'taux_tva')::numeric not in (0, 5.5, 8.5, 10, 20)
  ) then
    raise exception 'Ce taux de TVA n''est pas pris en charge.' using errcode = '22023';
  end if;

  -- L'écriture attendue : la banque au montant et dans le sens du mouvement, puis une ligne par part, sur
  -- le compte de sa catégorie ou celui du dirigeant, dans le sens de son signe — au hors taxe pour une
  -- part de recette taxée, dont la TVA collectée prend une ligne à côté. Comparée en MULTIENSEMBLE, comme
  -- celle d'une échéance d'emprunt : autant de lignes, et chacune des attendues présente.
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with parts as (
    select (e->>'categorie_id')::uuid as categorie_id, (e->>'montant')::numeric as montant,
           (e->>'taux_tva')::numeric as taux
    from jsonb_array_elements(p_parts) as e
  ), lignes_parts as (
    select coalesce(c.compte_comptable, v_compte_dirigeant) as compte,
           case when p.montant > 0 then 'credit' else 'debit' end as sens,
           abs(p.montant) as montant,
           coalesce(public.tva_incluse(p.montant, p.taux), 0) as tva
    from parts p left join public.categories c on c.id = p.categorie_id
  ), attendues as (
    select v_banque as compte,
           case when v_ligne.montant > 0 then 'debit' else 'credit' end as sens,
           abs(v_ligne.montant) as montant
    union all
    select compte, sens, montant - tva from lignes_parts
    union all
    select v_tva_collectee, sens, tva from lignes_parts where tva > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'rapprochee', ventilee = true
   where id = p_ligne_bancaire_id;

  delete from public.ventilations_bancaires where ligne_bancaire_id = p_ligne_bancaire_id;
  insert into public.ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant, taux_tva)
  select v_ligne.dossier_id, p_ligne_bancaire_id, (e->>'categorie_id')::uuid,
         coalesce((e->>'part_personnelle')::boolean, false), (e->>'montant')::numeric, (e->>'taux_tva')::numeric
  from jsonb_array_elements(p_parts) as e;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

-- `retirer_ventilation_mouvement_bancaire` : l'écriture validée, la suppression.
create or replace function public.retirer_ventilation_mouvement_bancaire(p_ligne_bancaire_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if not v_ligne.ventilee then
    raise exception 'Ce mouvement n''est pas ventilé.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set statut = 'non_rapprochee', ventilee = false
   where id = p_ligne_bancaire_id;

  delete from public.ventilations_bancaires where ligne_bancaire_id = p_ligne_bancaire_id;
  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

-- ══ 5. Le règlement groupé (toutes les lignes du mouvement, celles de ses pièces comprises) ══════════

-- `regler_pieces_par_mouvement` : l'écriture validée, la suppression.
create or replace function public.regler_pieces_par_mouvement(
  p_ligne_bancaire_id uuid,
  p_parts jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_part record;
  v_somme numeric := 0;
  v_nb_parts integer;
  v_nb_pieces integer;
  v_nom text;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.emprunt_id is not null or v_ligne.ventilee or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie, ventilé ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro ne règle rien.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'Une écriture de ce mouvement est validée : son règlement ne se remplace plus.' using errcode = '23514';
  end if;

  -- Les parts : au moins deux — une seule serait un rapprochement simple, qui a sa forme à lui —, chacune
  -- une pièce et un montant non nul au centime (la colonne arrondirait en silence), une part par pièce.
  if jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts) < 2 then
    raise exception 'Un règlement groupé porte au moins deux pièces.' using errcode = '22023';
  end if;
  for v_part in
    select (e->>'piece_id')::uuid as piece_id, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_parts) as e
  loop
    if v_part.piece_id is null then
      raise exception 'Chaque part désigne une pièce.' using errcode = '22023';
    end if;
    if v_part.montant is null or v_part.montant = 0 or v_part.montant <> round(v_part.montant, 2) then
      raise exception 'Chaque part porte un montant non nul, au centime.' using errcode = '22023';
    end if;
    v_somme := v_somme + v_part.montant;
  end loop;
  select count(*), count(distinct (e->>'piece_id')::uuid)
    into v_nb_parts, v_nb_pieces
  from jsonb_array_elements(p_parts) as e;
  if v_nb_pieces <> v_nb_parts then
    raise exception 'La même pièce figure deux fois : réunis ses parts en une.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_parts) as e
     where not exists (
       select 1 from public.pieces p
        where p.id = (e->>'piece_id')::uuid and p.dossier_id = v_ligne.dossier_id
     )
  ) then
    raise exception 'Cette pièce n''existe pas pour ce dossier.' using errcode = '22023';
  end if;

  -- Une pièce sans montant lu ne se règle pas en partie : rien ne dirait ce qu'il en reste. Et chaque part
  -- va dans le sens qui RÈGLE sa pièce. La première pièce fautive dans l'ordre des parts, comme l'écran.
  select coalesce(nullif(regexp_replace(trim(p.tiers), '\s+', ' ', 'g'), ''), p.nom_fichier) into v_nom
    from jsonb_array_elements(p_parts) with ordinality as e(part, rang)
    join public.pieces p on p.id = (e.part->>'piece_id')::uuid
   where p.montant_ttc is null or p.montant_ttc = 0
   order by e.rang
   limit 1;
  if found then
    raise exception 'La pièce « % » n''a pas de montant lu : saisis-le avant de la régler avec d''autres.', v_nom
      using errcode = '22023';
  end if;
  select coalesce(nullif(regexp_replace(trim(p.tiers), '\s+', ' ', 'g'), ''), p.nom_fichier) into v_nom
    from jsonb_array_elements(p_parts) with ordinality as e(part, rang)
    join public.pieces p on p.id = (e.part->>'piece_id')::uuid
   where sign((e.part->>'montant')::numeric)
         <> case when p.type_piece = 'vente' then sign(p.montant_ttc) else -sign(p.montant_ttc) end
   order by e.rang
   limit 1;
  if found then
    raise exception 'La part de la pièce « % » va dans le mauvais sens : une dépense se règle par une sortie, une recette par une entrée, un avoir à l''inverse.', v_nom
      using errcode = '22023';
  end if;

  -- Les montants dits DANS LE SENS DU MOUVEMENT, comme l'écran les fait saisir : « 800,00 € au lieu des
  -- 900,00 € » d'un paiement, pas « -800,00 € au lieu des -900,00 € ».
  if v_somme <> v_ligne.montant then
    raise exception 'Les parts font % € au lieu des % € du mouvement.',
      replace(to_char(v_somme * sign(v_ligne.montant), 'FM999999999990.00'), '.', ','),
      replace(to_char(abs(v_ligne.montant), 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'rapprochee', reglement_groupe = true
   where id = p_ligne_bancaire_id;

  delete from public.reglements_groupes where ligne_bancaire_id = p_ligne_bancaire_id;
  insert into public.reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant)
  select v_ligne.dossier_id, p_ligne_bancaire_id, (e->>'piece_id')::uuid, (e->>'montant')::numeric
  from jsonb_array_elements(p_parts) as e;
  get diagnostics v_nb = row_count;

  -- Les écritures d'un règlement précédent de ce mouvement : l'application écrit celles des nouvelles parts.
  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and facture_id is null and encaissement_id is null;

  return v_nb;
end;
$$;

-- `retirer_reglement_groupe` : l'écriture validée, la suppression.
create or replace function public.retirer_reglement_groupe(p_ligne_bancaire_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if not v_ligne.reglement_groupe then
    raise exception 'Ce mouvement ne règle pas plusieurs pièces.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'Une écriture de ce mouvement est validée : son règlement ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set statut = 'non_rapprochee', reglement_groupe = false
   where id = p_ligne_bancaire_id;

  delete from public.reglements_groupes where ligne_bancaire_id = p_ligne_bancaire_id;
  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and facture_id is null and encaissement_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

-- ══ 6. L'échéance d'emprunt ══════════

-- `rapprocher_echeance_emprunt` : l'écriture validée, la suppression, l'équilibre.
create or replace function public.rapprocher_echeance_emprunt(
  p_ligne_bancaire_id uuid,
  p_emprunt_id uuid,
  p_echeance integer,
  p_interets numeric,
  p_assurance numeric,
  p_ecritures jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_emprunt public.emprunts%rowtype;
  v_total numeric;
  v_capital numeric;
  v_interets numeric := coalesce(p_interets, 0);
  v_assurance numeric := coalesce(p_assurance, 0);
  v_date_autre date;
  v_banque text;
  v_compte_emprunt text;
  v_compte_interets text;
  v_compte_assurance text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce ou d''une cotisation, affecté à une catégorie ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  select * into v_emprunt from public.emprunts where id = p_emprunt_id and dossier_id = v_ligne.dossier_id;
  if not found then
    raise exception 'Cet emprunt n''existe pas pour ce dossier.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  v_total := abs(v_ligne.montant);
  if v_ligne.montant < 0 then
    if p_echeance is null or p_echeance < 1 or p_echeance > v_emprunt.duree_mois then
      raise exception 'L''échéance doit être comprise entre 1 et % pour cet emprunt.', v_emprunt.duree_mois
        using errcode = '22023';
    end if;
    if v_interets < 0 or v_assurance < 0 or v_interets + v_assurance > v_total
       or v_interets <> round(v_interets, 2) or v_assurance <> round(v_assurance, 2) then
      raise exception 'Découpage impossible : les intérêts et l''assurance sont positifs, au centime, et ne dépassent pas le prélèvement.'
        using errcode = '22023';
    end if;
    select l.date into v_date_autre from public.lignes_bancaires l
     where l.emprunt_id = p_emprunt_id and l.emprunt_echeance = p_echeance and l.id <> p_ligne_bancaire_id;
    if found then
      raise exception 'L''échéance n° % de cet emprunt est déjà rapprochée du mouvement du %.',
        p_echeance, to_char(v_date_autre, 'DD/MM/YYYY') using errcode = '23505';
    end if;
    v_capital := v_total - v_interets - v_assurance;
  else
    if p_echeance is not null or v_interets <> 0 or v_assurance <> 0 then
      raise exception 'Un encaissement rattaché à un emprunt en est le déblocage : ni échéance, ni intérêts, ni assurance.'
        using errcode = '22023';
    end if;
    v_capital := v_total;
  end if;

  -- L'écriture attendue, ligne à ligne ; une ligne à zéro n'en est pas une (une échéance sans assurance,
  -- un différé qui ne rembourse aucun capital). Comparée en MULTIENSEMBLE : autant de lignes, et chacune
  -- des attendues présente — une ligne de trop, un montant faux ou un compte inattendu font refuser.
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_compte_emprunt := public.compte_du_role(v_ligne.dossier_id, 'emprunt');
  v_compte_interets := public.compte_du_role(v_ligne.dossier_id, 'interets_emprunt');
  v_compte_assurance := public.compte_du_role(v_ligne.dossier_id, 'assurance_emprunt');
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      (v_banque, case when v_ligne.montant > 0 then 'debit' else 'credit' end, v_total),
      (v_compte_emprunt, case when v_ligne.montant > 0 then 'credit' else 'debit' end, v_capital),
      (v_compte_interets, 'debit', v_interets),
      (v_compte_assurance, 'debit', v_assurance)
    ) as a(compte, sens, montant)
    where a.montant > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à ce découpage.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'rapprochee',
         emprunt_id = p_emprunt_id,
         emprunt_echeance = case when v_ligne.montant < 0 then p_echeance end,
         emprunt_interets = case when v_ligne.montant < 0 then v_interets else 0 end,
         emprunt_assurance = case when v_ligne.montant < 0 then v_assurance else 0 end
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

-- `retirer_echeance_emprunt` : l'écriture validée, la suppression.
create or replace function public.retirer_echeance_emprunt(p_ligne_bancaire_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.emprunt_id is null then
    raise exception 'Ce mouvement n''est rapproché d''aucun emprunt.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set statut = 'non_rapprochee', emprunt_id = null, emprunt_echeance = null,
         emprunt_interets = null, emprunt_assurance = null
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

-- ══ 7. L'échéance de cotisation ══════════

-- `rapprocher_cotisation` : l'écriture validée, la suppression, l'équilibre.
create or replace function public.rapprocher_cotisation(
  p_ligne_bancaire_id uuid,
  p_cotisation_id uuid,
  p_ecritures jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_cotisation public.cotisations_declarees%rowtype;
  v_mode text;
  v_echeance numeric;
  v_total numeric;
  v_csg numeric := 0;
  v_date_autre date;
  v_banque text;
  v_compte_cotisations text;
  v_compte_exploitant text;
  v_sens_banque text;
  v_sens_compte text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.reglement_groupe then
    raise exception 'Ce mouvement règle plusieurs pièces : annule d''abord ce règlement groupé.' using errcode = '22023';
  end if;
  if v_ligne.piece_id is not null or v_ligne.categorie_id is not null or v_ligne.emprunt_id is not null
     or v_ligne.ventilee or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;

  select * into v_cotisation from public.cotisations_declarees
   where id = p_cotisation_id and dossier_id = v_ligne.dossier_id for update;
  if not found then
    raise exception 'Cette échéance n''existe pas pour ce dossier.' using errcode = '22023';
  end if;
  -- Le montant de l'échéance : le versement saisi, sinon l'appel. Son SIGNE dit ce qu'elle est.
  v_echeance := coalesce(v_cotisation.montant_verse, v_cotisation.montant_appele);
  if v_echeance = 0 then
    raise exception 'Une échéance de zéro euro ne se rapproche pas.' using errcode = '22023';
  end if;
  if v_echeance > 0 and v_ligne.montant > 0 then
    raise exception 'Ce mouvement est un encaissement : il ne paie pas un appel de cotisation. Un remboursement se rapproche d''une échéance négative.'
      using errcode = '22023';
  end if;
  if v_echeance < 0 and v_ligne.montant < 0 then
    raise exception 'Cette échéance est négative — un remboursement : un prélèvement ne la paie pas.' using errcode = '22023';
  end if;
  select l.date into v_date_autre from public.lignes_bancaires l
   where l.cotisation_id = p_cotisation_id and l.id <> p_ligne_bancaire_id;
  if found then
    raise exception 'Cette échéance est déjà rapprochée du mouvement du %.', to_char(v_date_autre, 'DD/MM/YYYY')
      using errcode = '23505';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- La CSG-CRDS au compte de l'exploitant (108000 par défaut), en trésorerie seulement, et au centime : sa valeur
  -- absolue, dans le sens du mouvement. Elle ne peut pas dépasser le mouvement — la cotisation serait négative.
  v_total := abs(v_ligne.montant);
  select mode_comptable into v_mode from public.dossiers where id = v_ligne.dossier_id;
  if v_mode = 'tresorerie' and v_cotisation.montant_csg_crds is not null then
    v_csg := abs(v_cotisation.montant_csg_crds);
  end if;
  if v_csg <> round(v_csg, 2) then
    raise exception 'La CSG-CRDS de cette échéance n''est pas au centime.' using errcode = '22023';
  end if;
  if v_csg > v_total then
    raise exception 'La CSG-CRDS de cette échéance (% €) dépasse le mouvement (% €).',
      replace(to_char(v_csg, 'FM999999999990.00'), '.', ','),
      replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  -- L'écriture attendue, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues présente.
  -- Une ligne à zéro n'en est pas une (une échéance sans CSG-CRDS saisie, ou faite toute de CSG-CRDS).
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  v_sens_compte := case when v_ligne.montant > 0 then 'credit' else 'debit' end;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_compte_cotisations := public.compte_du_role(v_ligne.dossier_id, 'cotisations_exploitant');
  v_compte_exploitant := public.compte_du_role(v_ligne.dossier_id, 'exploitant');
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      (v_banque, v_sens_banque, v_total),
      (v_compte_cotisations, v_sens_compte, v_total - v_csg),
      (v_compte_exploitant, v_sens_compte, v_csg)
    ) as a(compte, sens, montant)
    where a.montant > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette échéance.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'rapprochee', cotisation_id = p_cotisation_id
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

-- `retirer_rapprochement_cotisation` : l'écriture validée, la suppression.
create or replace function public.retirer_rapprochement_cotisation(p_ligne_bancaire_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.cotisation_id is null then
    raise exception 'Ce mouvement n''est rapproché d''aucune échéance de cotisation.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires set statut = 'non_rapprochee', cotisation_id = null where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

-- `supprimer_echeance_cotisation` : l'écriture validée, la suppression.
create or replace function public.supprimer_echeance_cotisation(p_cotisation_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cotisation public.cotisations_declarees%rowtype;
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_cotisation from public.cotisations_declarees where id = p_cotisation_id for update;
  if not found or not admin_du_dossier(v_cotisation.dossier_id) then
    raise exception 'Accès refusé à cette échéance.' using errcode = '42501';
  end if;

  select * into v_ligne from public.lignes_bancaires where cotisation_id = p_cotisation_id for update;
  if found then
    if exists (
      select 1 from public.ecritures_brouillon
      where ligne_bancaire_id = v_ligne.id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
    ) then
      raise exception 'L''écriture du mouvement qui paie cette échéance est validée : l''échéance ne se supprime plus.'
        using errcode = '23514';
    end if;
    update public.lignes_bancaires set statut = 'non_rapprochee', cotisation_id = null where id = v_ligne.id;
    delete from public.ecritures_brouillon where ligne_bancaire_id = v_ligne.id and piece_id is null and facture_id is null and encaissement_id is null;
  end if;

  delete from public.cotisations_declarees where id = p_cotisation_id;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

-- ══ 8. La déclaration de TVA (son paiement ; ses mouvements, sa liquidation sans mouvement inchangée) ══════════

-- `rapprocher_declaration_tva` : l'écriture validée, la suppression, l'équilibre.
create or replace function public.rapprocher_declaration_tva(p_ligne_bancaire_id uuid, p_declaration_id uuid, p_ecriture jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_declaration public.declarations_tva%rowtype;
  v_a_payer numeric;
  v_compte text;
  v_banque text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  select * into v_declaration from public.declarations_tva where id = p_declaration_id;
  if not found or v_declaration.dossier_id <> v_ligne.dossier_id then
    raise exception 'Cette déclaration de TVA n''est pas celle de ce dossier.' using errcode = '22023';
  end if;
  if v_ligne.reglement_groupe then
    raise exception 'Ce mouvement règle plusieurs pièces : annule d''abord ce règlement groupé.' using errcode = '22023';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.emprunt_id is not null or v_ligne.ventilee or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.compte_bilan is not null then
    raise exception 'Ce mouvement est écrit sur le compte %, un compte de bilan : annule d''abord ce classement.',
      v_ligne.compte_bilan using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if v_ligne.date <= v_declaration.periode_fin then
    raise exception 'Un paiement de TVA suit la période qu''il règle : ce mouvement est du %, la période se termine le %.',
      to_char(v_ligne.date, 'DD/MM/YYYY'), to_char(v_declaration.periode_fin, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  v_a_payer := case when v_declaration.cases is null
    then greatest(v_declaration.tva_declaree - v_declaration.credit_anterieur, 0)
    else (v_declaration.cases->>'l32')::numeric end;
  if v_ligne.montant < 0 and coalesce(v_a_payer, 0) <= 0 then
    raise exception 'Cette déclaration n''a pas de TVA à payer.' using errcode = '22023';
  end if;
  if v_ligne.montant > 0 and v_declaration.remboursement_demande <= 0 then
    raise exception 'Aucun remboursement de crédit n''a été demandé sur cette déclaration (ligne 26).' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
     where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_compte := public.compte_du_role(v_ligne.dossier_id,
    case when v_ligne.montant < 0 then 'tva_a_decaisser' else 'remboursement_tva_demande' end);
  if jsonb_typeof(p_ecriture) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select v_banque as compte, case when v_ligne.montant > 0 then 'debit' else 'credit' end as sens,
           abs(v_ligne.montant) as montant
    union all
    select v_compte, case when v_ligne.montant > 0 then 'credit' else 'debit' end, abs(v_ligne.montant)
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
      from jsonb_array_elements(p_ecriture) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette déclaration.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set declaration_tva_id = p_declaration_id, statut = 'rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
    from jsonb_array_elements(p_ecriture) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
    from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;
  return v_nb;
end;
$$;

-- `retirer_rapprochement_declaration_tva` : l'écriture validée, la suppression.
create or replace function public.retirer_rapprochement_declaration_tva(p_ligne_bancaire_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.declaration_tva_id is null then
    raise exception 'Ce mouvement ne paie aucune déclaration de TVA.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
     where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set declaration_tva_id = null, statut = 'non_rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

-- `retirer_declaration_tva` : l'écriture validée, la suppression des lignes de ses mouvements.
create or replace function public.retirer_declaration_tva(p_declaration_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_declaration public.declarations_tva%rowtype;
  v_nb integer;
begin
  select * into v_declaration from public.declarations_tva where id = p_declaration_id for update;
  if not found or not admin_du_dossier(v_declaration.dossier_id) then
    raise exception 'Accès refusé à cette déclaration.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon e
     where e.statut <> 'proposee'
       and (e.declaration_tva_id = p_declaration_id
            or (e.piece_id is null and e.facture_id is null and e.encaissement_id is null and e.ligne_bancaire_id in (
                  select l.id from public.lignes_bancaires l where l.declaration_tva_id = p_declaration_id)))
  ) then
    raise exception 'Une écriture de cette déclaration — sa liquidation ou un paiement — est validée : elle ne se retire plus.'
      using errcode = '23514';
  end if;

  delete from public.ecritures_brouillon
   where piece_id is null and facture_id is null and encaissement_id is null
     and ligne_bancaire_id in (select l.id from public.lignes_bancaires l where l.declaration_tva_id = p_declaration_id);
  update public.lignes_bancaires
     set declaration_tva_id = null, statut = 'non_rapprochee'
   where declaration_tva_id = p_declaration_id;
  get diagnostics v_nb = row_count;
  delete from public.ecritures_brouillon where declaration_tva_id = p_declaration_id;
  delete from public.declarations_tva where id = p_declaration_id;
  return v_nb;
end;
$$;
