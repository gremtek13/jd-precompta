-- LE RETOUR ARRIÈRE DE `especes_sans_mouvement` (la caisse, ligne 26.6, étape C6). Le récit : HISTORIQUE.md, « LA
-- CAISSE : LE RESSERREMENT (C6, LIGNE 26.6) ».
--
-- CE QU'IL FAIT, ET RIEN D'AUTRE : la garde des encaissements (`garder_encaissement_facture`) rendue telle que
-- `contre_passation_sur_mouvement_fige` l'a laissée, au caractère près — sans la règle d'`especes_sans_mouvement`. Un
-- encaissement en espèces cite de nouveau un crédit, si on le lui donne ; l'application, elle, ne l'offre plus (elle redit
-- la règle avant la base) : rien ne s'y rouvre à l'écran.
--
-- CE QU'IL NE FAIT PAS : il ne retire ni ligne, ni objet, ni droit, ni la ligne d'historique de la migration qu'il défait —
-- appliqué par l'outil, il pose la sienne à la suite. `create or replace` garde l'OID de la garde, son propriétaire, ses
-- droits d'exécution et ses déclencheurs. Aucune barre oblique inverse.
--
-- SA GARDE DE TÊTE : il se refuse si la garde en base n'est pas celle qu'`especes_sans_mouvement` a posée (une autre
-- migration l'a reprise depuis, ou ce texte a déjà été appliqué) — elle se relit d'abord.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'il suppose : la garde telle que `especes_sans_mouvement` l'a laissée ══════════

do $$
begin
  -- Le corps que ce texte reprend, au caractère près (les retours chariot d'un collage écartés) : une garde changée
  -- depuis — par une autre migration, ou par une première application de celle-ci — ne se remplace pas sans être
  -- relue.
  if to_regprocedure('public.garder_encaissement_facture()') is null
     or md5(replace((select p.prosrc from pg_proc p
                      where p.oid = to_regprocedure('public.garder_encaissement_facture()')), chr(13), ''))
        <> '31fdfcc86b476669612b459555e94f13' then
    raise exception 'La fonction public.garder_encaissement_facture() en base n''est plus celle de la migration especes_sans_mouvement : ce texte ne la remplace pas sans être relu.';
  end if;
end
$$;

-- ══ 1. La garde des encaissements, celle de `contre_passation_sur_mouvement_fige`, au caractère près ══════════
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
