-- L'INSERTION DIRECTE D'UN ENCAISSEMENT SUR UN MOUVEMENT CLASSÉ PAR SES ENCAISSEMENTS (chantier EC-Q3, ligne 28.65 ;
-- VF5H2-Q1). Le récit : HISTORIQUE.md, « L'INSERTION DIRECTE D'UN ENCAISSEMENT SUR UN MOUVEMENT CLASSÉ PAR SES
-- ENCAISSEMENTS » ; la question : « LES REFUS DU REGISTRE POUR LA FACTURE D'AVANT D'UN VIREMENT MIXTE » (étape VF5h2).
--
-- LA DÉCISION DU CABINET (26/10/2026, VF5H2-Q1, « Oui, la fermer ») : l'insertion directe d'un encaissement sur un
-- mouvement classé par ses encaissements se refuse pour toute facture, la restauration exceptée — une petite migration
-- à part, avant la première bascule réelle. Puis VF5H2Q1-Q1, écrite sur la recommandation le 26/10/2026 : la même règle
-- au rattachement — un mouvement classé par ses encaissements ne se cite pas non plus quand on rattache, que le réglage
-- du rattachement soit posé par la fonction ou par qui écrit sans elle.
--
-- CE QUE LA BASE FAISAIT. Les fonctions du registre refusent, avant d'écrire, d'ajouter un encaissement à un mouvement
-- classé par ses encaissements (`enregistrer_encaissement`, rangs 17 et 18 ; `annuler_encaissement`, rang 18, le débit
-- cité qui n'est pas libre ; `rattacher_mouvement_encaissement`, rang 11, le mouvement qui n'est pas libre) et d'en
-- écarter un par une contre-passation sans mouvement (`annuler_encaissement`, rangs 20 et 21). Leur garde, à
-- l'insertion comme au rattachement, ne refusait d'un mouvement classé que celui qu'une facture source citerait, classé
-- AUTREMENT : le propriétaire de la base ou le rôle des Edge Functions, écrivant sans les fonctions, posaient encore
-- l'encaissement d'une facture, source ou non, sur un mouvement classé par ses encaissements, et la contre-passation
-- sans mouvement d'un encaissement qui cite un tel mouvement ; sous le réglage du rattachement
-- (`jd.rattachement_encaissement`), que seule la fonction pose mais qu'ils posent aussi eux-mêmes, ils y rattachaient
-- encore l'encaissement d'une facture source. Chaque fois, ce que le mouvement justifie changeait sous son classement :
-- sa composition le retenait ensuite, ses écritures devenaient à réécrire ou à retirer.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE — la garde des encaissements (`garder_encaissement_facture`), reprise de sa définition
-- de `registre_virement_mixte` au caractère près hors des deux règles qu'elle INSÈRE, chacune après les règles d'hier
-- de son bloc :
--   1. à l'insertion, pour qui n'est pas le super-administrateur, et au rattachement, pour tous : le mouvement cité,
--      classé par ses encaissements — par l'encaissement de toute facture, par la contre-passation d'une facture source
--      qui citerait un débit ainsi classé, ou par l'encaissement d'une facture source qu'on y rattache : « Un mouvement
--      classé par ses encaissements ne se cite pas : ce qu'il justifie ne change plus — le cabinet retire d'abord ce
--      classement. » ;
--   2. à l'insertion, pour qui n'est pas le super-administrateur : la contre-passation SANS MOUVEMENT, de toute
--      facture, d'un encaissement qui cite un mouvement classé par ses encaissements : « Le mouvement de l'encaissement
--      contre-passé est classé par ses encaissements : le cabinet retire d'abord ce classement. » — les mots du rang 21
--      d'`annuler_encaissement`.
-- L'une et l'autre en 23514, comme les autres règles de la garde. La première prend la condition de la règle de la
-- facture source qui la précède : la restauration insère, elle ne rattache pas.
--
-- CE QUI NE CHANGE PAS. Les fonctions : elles refusent ces cas avant d'écrire, sous leurs mots —
-- `rattacher_mouvement_encaissement` lit le mouvement sous son verrou et refuse celui qui n'est pas libre avant de
-- poser le réglage : la garde ne refuse rien de ce qu'elles font, et aucune autre fonction n'insère ni ne rattache un
-- encaissement. La restauration du super-administrateur : elle réinsère les mouvements avant les encaissements, déjà
-- classés, et ce qui a été. La modification, le retrait et la suppression : comme hier. Un mouvement libre, ou classé
-- autrement : comme hier. La garde de la frontière (`garder_frontiere_des_encaissements`, étape VF7a), ni lue ni
-- touchée : elle passe après celle-ci, qui refuse donc la première, sous ses mots, un mouvement figé classé par ses
-- encaissements cité ou rattaché en direct.
--
-- NEUTRE EN PRODUCTION (relevé le 26/10/2026, des comptes) : aucun encaissement, aucun mouvement classé par ses
-- encaissements, aucun dossier basculé — aucun refus neuf ne peut s'y rencontrer. Aucune table, colonne, contrainte,
-- policy ni aucun droit ne change ; aucune donnée écrite ni retirée. `create or replace` garde l'OID de la garde, son
-- propriétaire, ses droits d'exécution et son déclencheur : rien n'est rejoué.
--
-- CE QUI CONTOURNE LA RLS : rien de plus — la garde lit aux droits de l'appelant (elle n'est pas `security definer`),
-- et ne dit d'un mouvement que ce que l'appelant en lit déjà. Elle passe avant la RLS (les déclencheurs `before`
-- d'abord) : un compte qui ne voit pas la facture bute, comme hier, sur sa première règle.
-- CONCURRENCE : la garde lit le mouvement sans verrou, comme ses règles d'hier ; les fonctions, elles, le verrouillent.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni
-- instruction qui en retire ; la garde nomme, comme hier, l'opération qu'elle refuse. Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose : la garde telle que `registre_virement_mixte` l'a laissée ══════════

do $$
begin
  -- Le corps que cette migration reprend, au caractère près (les retours chariot d'un collage écartés) : une garde
  -- changée depuis — par une autre migration, ou par une première application de celle-ci — ne se remplace pas sans
  -- être relue.
  if to_regprocedure('public.garder_encaissement_facture()') is null
     or md5(replace((select p.prosrc from pg_proc p
                      where p.oid = to_regprocedure('public.garder_encaissement_facture()')), chr(13), ''))
        <> '21c11ef2275292a9c70570eed2aebd9e' then
    raise exception 'La fonction public.garder_encaissement_facture() en base n''est plus celle de la migration registre_virement_mixte : cette migration ne la remplace pas sans être relue.';
  end if;
end
$$;

-- ══ 1. La garde des encaissements : les deux règles de VF5H2-Q1 ══════════
-- La définition de `registre_virement_mixte`, au caractère près hors des deux règles neuves et de leurs commentaires.
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
