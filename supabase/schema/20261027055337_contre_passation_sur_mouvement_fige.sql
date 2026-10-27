-- LA CONTRE-PASSATION SANS MOUVEMENT SUR UN MOUVEMENT FIGÉ (chantier EC-Q3, ligne 28.65 ; VF5H2Q1-Q2 et VF5H2Q1Q2-Q1).
-- Le récit : HISTORIQUE.md, « LA CONTRE-PASSATION SANS MOUVEMENT SUR UN MOUVEMENT FIGÉ » ; la question d'origine :
-- « L'INSERTION DIRECTE D'UN ENCAISSEMENT SUR UN MOUVEMENT CLASSÉ PAR SES ENCAISSEMENTS ».
--
-- LES DÉCISIONS DU CABINET. VF5H2Q1-Q2 (page des arbitrages, 26/10/2026, 13 h 01 UTC ; « La refuser (petite migration à
-- part) ») : l'exception de la restauration ne laisse plus le super-administrateur poser en direct la contre-passation
-- sans mouvement d'un encaissement qu'un mouvement figé compte — avant la première validation d'un exercice d'un
-- dossier basculé. VF5H2Q1Q2-Q1, que la préparation de celle-ci a posée, écrite sur la recommandation, le 26/10/2026,
-- (A) : dans cette migration, avant son application, le super-administrateur ne pose plus non plus en direct
-- l'encaissement d'une facture d'avant sur un virement mixte figé.
--
-- CE QUE LA BASE FAISAIT. Les deux règles de VF5H2-Q1 refusent à tous, hors le super-administrateur à l'insertion (la
-- restauration), de citer un mouvement classé par ses encaissements, et la contre-passation sans mouvement d'un
-- encaissement qui en cite un. La garde de la frontière (`garder_frontiere_des_encaissements`, étape VF7a) ne juge que
-- l'encaissement d'une facture source — un mouvement figé cité, une date figée —, et une contre-passation à sa propre
-- date. Le super-administrateur — sur ce projet, aussi le chef du cabinet — posait donc encore en direct, datée après
-- la frontière, la contre-passation sans mouvement d'un encaissement qu'un mouvement figé compte, et l'encaissement
-- d'une facture d'avant sur un virement mixte figé : chaque fois, il changeait ce que justifie un mouvement d'un
-- exercice validé.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE — la garde des encaissements (`garder_encaissement_facture`), reprise de sa définition
-- d'`insertion_des_encaissements` au caractère près hors des deux règles qu'elle INSÈRE, chacune après la règle de
-- VF5H2-Q1 de son bloc, en 23514, sur un mouvement classé par ses encaissements et FIGÉ — daté au plus tard du 31
-- décembre du dernier exercice validé de son dossier. (1) Le mouvement cité par l'encaissement d'une facture qui n'est
-- pas source : « Un mouvement figé par la validation d'un exercice ne se cite plus : ce qu'il justifie ne change
-- plus. » (2) La contre-passation SANS MOUVEMENT, de toute facture, d'un encaissement qui cite un tel mouvement : « Le
-- mouvement de l'encaissement contre-passé est figé par la validation d'un exercice : ce qu'il justifie ne change
-- plus. » Les règles de VF5H2-Q1 refusent les autres d'abord : seul le super-administrateur y vient.
--
-- POURQUOI LA RESTAURATION PASSE. `restaurerSauvegarde` (src/lib/sauvegardeDonnees.ts) n'écrit que dans un dossier qui
-- n'existe pas (« La restauration n'écrase jamais. »), et réinsère ses exercices validés en DERNIER
-- (`ORDRE_RESTAURATION`, src/lib/sauvegarde.ts, recopié dans l'essai `restauration.sql` : les mouvements au rang 48,
-- les encaissements au rang 51, les exercices validés au rang 76, le dernier) : tant qu'ils n'y sont pas, aucun
-- mouvement n'est figé, et les encaissements et leurs contre-passations se réinsèrent ; après eux, rien du registre ne
-- s'insère plus. Le principe de la migration `restauration_des_exercices_valides` et de la garde de la frontière
-- (VF7a), qui n'excusent pas non plus le super-administrateur.
--
-- CE QUI NE CHANGE PAS. Les fonctions : `enregistrer_encaissement` refuse un mouvement classé par ses encaissements
-- avant d'insérer (rangs 17 et 18), `annuler_encaissement` la contre-passation sans débit d'un encaissement qu'un tel
-- mouvement compte (rangs 20 et 21) ; elles ne viennent pas jusqu'ici. L'encaissement d'une facture source : la garde
-- de la frontière, comme hier. Une contre-passation qui cite un débit ; un mouvement libre, ou classé autrement : comme
-- hier. Le rattachement, la modification, le retrait, la suppression : comme hier. La garde de la frontière, ni lue ni
-- touchée.
--
-- LE VERROU ET LA FRONTIÈRE. Chaque règle prend le verrou partagé de la validation — la clé de `cle_validation`, que
-- l'appelant n'exécute pas, écrite en ligne, comme les fonctions de la migration `la_base_lit_le_plan_1` — avant de
-- lire la frontière : une validation en cours finit d'abord. Elle lit les exercices validés aux droits de l'appelant,
-- non par `frontiere_validation`, qu'il n'exécute pas : le super-administrateur les lit tous
-- (`exercices_valides_lecture`), le propriétaire et le rôle des Edge Functions passent la RLS.
--
-- NEUTRE EN PRODUCTION (relevé le 26/10/2026, des comptes) : aucun exercice validé, aucun encaissement, aucun mouvement
-- classé par ses encaissements, aucun dossier basculé — aucun refus neuf ne peut s'y rencontrer. Aucune table, colonne,
-- contrainte, policy ni aucun droit ne change ; aucune donnée écrite ni retirée. `create or replace` garde l'OID de la
-- garde, son propriétaire, ses droits d'exécution et son déclencheur : rien n'est rejoué.
--
-- CE QUI CONTOURNE LA RLS : rien de plus — la garde lit aux droits de l'appelant (elle n'est pas `security definer`),
-- et ne lit les exercices validés qu'après les règles de VF5H2-Q1, pour qui y a passé.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni
-- instruction qui en retire ; la garde nomme, comme hier, l'opération qu'elle refuse. Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose : la garde telle que `insertion_des_encaissements` l'a laissée ══════════

do $$
begin
  -- Le corps que cette migration reprend, au caractère près (les retours chariot d'un collage écartés) : une garde
  -- changée depuis — par une autre migration, ou par une première application de celle-ci — ne se remplace pas sans
  -- être relue.
  if to_regprocedure('public.garder_encaissement_facture()') is null
     or md5(replace((select p.prosrc from pg_proc p
                      where p.oid = to_regprocedure('public.garder_encaissement_facture()')), chr(13), ''))
        <> '922c8559fd54ddfc8f8a82ab0402c18e' then
    raise exception 'La fonction public.garder_encaissement_facture() en base n''est plus celle de la migration insertion_des_encaissements : cette migration ne la remplace pas sans être relue.';
  end if;
end
$$;

-- ══ 1. La garde des encaissements : les règles de VF5H2Q1Q2-Q1 et de VF5H2Q1-Q2 ══════════
-- La définition d'`insertion_des_encaissements`, au caractère près hors des deux règles neuves et de leurs
-- commentaires.
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
