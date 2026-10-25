-- LA FRONTIÈRE DES ENCAISSEMENTS, EN BASE (chantier EC-Q3, ligne 28.65, étape VF7a). Le récit : HISTORIQUE.md, « LA
-- FRONTIÈRE DES ENCAISSEMENTS, EN BASE » ; la conception : « VF7, LA VALIDATION FIGE LA SOURCE : LA CONCEPTION », § 3 (a)
-- et (b), § 5 et § 7.
--
-- CE QUE LA BASE FAISAIT. La frontière d'un exercice validé — le 31 décembre du dernier, et tout ce qui le précède — n'était
-- tenue, pour l'encaissement d'une facture SOURCE de sa vente, que par les fonctions du registre et du relevé ; leur garde
-- (`garder_encaissement_facture`, aux droits de l'appelant) ne la connaissait pas : le propriétaire de la base ou le rôle
-- des Edge Functions, écrivant sans elles, pouvait poser un encaissement dans un exercice validé, retirer celui qui y est
-- daté, changer son compte de contrepartie, lui ajouter une part, ou citer un mouvement que la validation fige. Et
-- `rattacher_mouvement_encaissement` jugeait la frontière sur la date de l'ENCAISSEMENT : le chèque remis le 30 décembre
-- d'un exercice validé ne se rattachait plus au crédit de janvier qui le paie — l'en-cours que porte le 511 au 31 décembre
-- (EC3-Q7) ne se serait jamais soldé.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE — pour l'encaissement (ou la contre-passation) d'une facture source seulement :
--   1. une garde NEUVE, `garder_frontiere_des_encaissements`, sous le verrou partagé de la validation, aux droits du
--      propriétaire (`security definer`, comme `garder_mouvement_valide` : le client « Ventes » ne lit pas
--      `exercices_valides`, et une garde à ses droits ne verrait pas la frontière), exécutée par aucun rôle de l'API. Elle
--      refuse, en 23514 : un encaissement — ou une contre-passation, à sa propre date — qui naîtrait daté d'un exercice
--      que la frontière fige ; d'un encaissement qui en est daté, le retrait, le changement de compte de contrepartie, le
--      rattachement quand son écriture en changerait — par compensation ou par un autre moyen (il s'écrit sur ce compte),
--      ou, pour une contre-passation, quand l'encaissement qu'elle annule cite un mouvement de son jour (elle le défait sur
--      la banque de ce mouvement) —, et tout autre changement, suppression comprise ; un mouvement cité, à la naissance ou
--      au rattachement, qui en est daté ; une part par taux ajoutée, changée ou retirée d'un encaissement qui en est daté ;
--   2. ses deux déclencheurs, `encaissements_factures_gardes_frontiere` et `encaissements_factures_taux_gardes_frontiere`,
--      avant l'insertion, la mise à jour et la suppression ;
--   3. `rattacher_mouvement_encaissement` : la frontière jugée sur le MOUVEMENT (le rang 9, neuf, après le mouvement
--      trouvé dans le dossier), et sur l'encaissement seulement par compensation ou par un autre moyen (le rang 6, ses
--      mots d'hier) — le chèque du 30 décembre se rattache au crédit de janvier, son écriture de l'exercice validé intacte
--      (`ecrituresVentesFacturees.ts` : un encaissement qui cite un mouvement d'un autre jour s'écrit au 511, ou au 53 pour
--      des espèces, comme quand il n'en cite pas), et celle du mouvement de janvier solde le 511. Les rangs suivants
--      avancent d'un cran (10 à 17).
-- Chaque refus a ses mots, ceux de la fonction qui fait le même geste quand elle existe (enregistrer, contre-passer,
-- retirer, choisir le compte, rattacher) ; src/lib/encaissementsFactures.ts (`REFUS_GARDE_FRONTIERE`,
-- `REFUS_RATTACHEMENT`) les redit.
--
-- CE QUI NE CHANGE PAS. L'encaissement d'une facture qui n'est pas source : comme hier (sa vente se compte par sa pièce ;
-- celui qu'un virement mixte compte est tenu par son mouvement classé, que la validation fige). Les quatre fonctions que
-- l'étape VF5h2 remplace (`enregistrer_encaissement`, `retirer_encaissement`, `annuler_encaissement`,
-- `garder_encaissement_facture`) : ni lues, ni touchées — cette migration s'applique avec ou sans elle. Aucune table,
-- colonne, contrainte, policy ni aucun droit d'une table ; aucune donnée lue, écrite ni retirée.
--
-- LA RESTAURATION, SANS EXCEPTION. Le super-administrateur réinsère un dossier dans un dossier qui ne porte encore aucun
-- exercice validé, et les exercices validés en dernier (`ORDRE_RESTAURATION`, src/lib/sauvegarde.ts) : tant qu'ils n'y
-- sont pas, aucune frontière n'existe, et ses encaissements se réinsèrent comme n'importe quelles lignes. Une exception
-- à son insertion ne servirait donc qu'ailleurs — or sur ce projet le super-administrateur est aussi le chef du cabinet
-- (HISTORIQUE.md, « UN EXERCICE VALIDÉ SE FIGE EN BASE », et la migration `restauration_des_exercices_valides`). La
-- suppression d'un dossier passe : pendant sa cascade, ses lignes ne voient déjà plus le dossier.
--
-- L'ORDRE DES DÉCLENCHEURS : ceux d'une table s'exécutent dans l'ordre de leur nom, et la garde de la frontière passe
-- APRÈS celle des encaissements (`…_gardes`, puis `…_gardes_frontiere`). Une insertion se juge avant la RLS : la garde
-- d'hier lit la facture — ou l'encaissement d'une part — aux droits de l'appelant, et refuse qui ne la voit pas sans lui
-- apprendre si elle existe ; une garde aux droits du propriétaire qui passerait avant elle dirait à n'importe quel compte,
-- l'anonyme compris, qu'une facture qu'il nomme est source et datée d'un exercice validé. Une mise à jour et une
-- suppression ne voient que les lignes que la RLS laisse voir.
--
-- NEUTRE EN PRODUCTION (relevé le 25/10/2026, des comptes) : aucun dossier n'a basculé, aucune facture n'est source,
-- aucun encaissement ni aucune part, aucun exercice validé — aucun refus neuf ne peut s'y rencontrer.
--
-- CE QUI CONTOURNE LA RLS : la garde lit, aux droits du propriétaire, la facture d'un encaissement (sa source), la date
-- d'un mouvement cité, l'encaissement d'une part, et l'encaissement qu'une contre-passation annule avec la date de son
-- mouvement, APRÈS la garde d'hier, qui a jugé leur visibilité aux droits de l'appelant ; elle ne rend rien, et ne dit
-- qu'un refus. `rattacher_mouvement_encaissement` lisait déjà le mouvement.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni
-- instruction qui en retire ; la garde nomme l'opération qu'elle juge (`tg_op = 'DELETE'`). Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose : le rattachement d'hier, tel qu'elle le reprend ══════════

do $$
begin
  -- Le corps que cette migration reprend, au caractère près (les retours chariot d'un collage écartés) : une fonction
  -- changée depuis — par une autre migration, ou par une première application de celle-ci — ne se remplace pas sans être
  -- relue.
  if to_regprocedure('public.rattacher_mouvement_encaissement(uuid, uuid, uuid)') is null
     or md5(replace((select p.prosrc from pg_proc p
                      where p.oid = to_regprocedure('public.rattacher_mouvement_encaissement(uuid, uuid, uuid)')), chr(13), ''))
        <> '5abd8919c80201244bb68a53224e2a40' then
    raise exception 'La fonction public.rattacher_mouvement_encaissement(uuid, uuid, uuid) en base n''est plus celle de la migration encaissements_de_la_vente_facturee : cette migration ne la remplace pas sans être relue.';
  end if;
end
$$;

-- ══ 1. La garde de la frontière des encaissements ══════════
-- Une fonction pour les deux tables. Dans l'ordre (src/lib/encaissementsFactures.ts, `REFUS_GARDE_FRONTIERE`) :
--   1. une part par taux d'un encaissement daté d'un exercice que la frontière fige : ni ajoutée, ni changée, ni retirée ;
--   2. un encaissement, 3. une contre-passation, qui naîtrait à une date que la frontière fige ;
--   d'un encaissement qui en est daté : 4. le retrait ; 5. le compte de contrepartie ; 6. tout autre changement, et la
--   suppression — seul le rattachement, de nul à un mouvement, passe — ; 7. le rattachement, par compensation ou par un
--   autre moyen, ou d'une contre-passation dont l'encaissement cite un mouvement de son jour ;
--   8. un mouvement cité, à la naissance ou au rattachement, daté d'un exercice que la frontière fige.
create function public.garder_frontiere_des_encaissements() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source boolean;
  v_dossier uuid;
  v_frontiere date;
  v_date date;
  v_rattachement boolean := false;
  v_encaissement public.encaissements_factures;
begin
  -- La suppression d'un dossier : pendant sa cascade, ses lignes ne voient déjà plus le dossier.
  if tg_op <> 'INSERT' and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return public.retour_declencheur(tg_op, old, new);
  end if;

  -- Une part par taux : l'encaissement qu'elle quitte, et celui qu'elle rejoint, jugés chacun sur la frontière de son
  -- dossier. Un encaissement que la cascade a déjà emporté ne retient rien.
  if tg_table_name = 'encaissements_factures_taux' then
    for v_encaissement in
      select e.* from public.encaissements_factures e
        join public.factures_emises f on f.id = e.facture_id and f.source_de_la_vente
       where e.id = any (array[case when tg_op <> 'INSERT' then old.encaissement_id end,
                               case when tg_op <> 'DELETE' then new.encaissement_id end])
    loop
      perform pg_advisory_xact_lock_shared(public.cle_validation(v_encaissement.dossier_id));
      v_frontiere := public.frontiere_validation(v_encaissement.dossier_id);
      if v_frontiere is not null and v_encaissement.date_encaissement <= v_frontiere then
        raise exception '% : la répartition de cet encaissement ne change plus.',
          public.exercice_fige(v_encaissement.dossier_id, extract(year from v_encaissement.date_encaissement)::integer)
          using errcode = '23514';
      end if;
    end loop;
    return public.retour_declencheur(tg_op, old, new);
  end if;

  -- Un encaissement : celui d'une facture source seulement — celui d'une autre ne s'écrit nulle part.
  if tg_op = 'INSERT' then
    select f.source_de_la_vente, new.dossier_id into v_source, v_dossier from public.factures_emises f where f.id = new.facture_id;
  else
    select f.source_de_la_vente, old.dossier_id into v_source, v_dossier from public.factures_emises f where f.id = old.facture_id;
  end if;
  if not coalesce(v_source, false) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  -- Le verrou partagé de la validation : un encaissement écrit pendant une validation attend qu'elle finisse, puis voit la
  -- frontière.
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_dossier));
  v_frontiere := public.frontiere_validation(v_dossier);
  if v_frontiere is null then
    return public.retour_declencheur(tg_op, old, new);
  end if;

  if tg_op = 'INSERT' then
    if new.date_encaissement <= v_frontiere then
      if new.annule_id is null then
        raise exception '% : un encaissement de cette facture ne s''y date plus.',
          public.exercice_fige(v_dossier, extract(year from new.date_encaissement)::integer) using errcode = '23514';
      end if;
      raise exception '% : une contre-passation ne s''y date plus.',
        public.exercice_fige(v_dossier, extract(year from new.date_encaissement)::integer) using errcode = '23514';
    end if;
  elsif old.date_encaissement <= v_frontiere then
    if tg_op = 'UPDATE' then
      if old.retire_le is null and new.retire_le is not null then
        raise exception '% : cet encaissement ne se retire plus.',
          public.exercice_fige(v_dossier, extract(year from old.date_encaissement)::integer) using errcode = '23514';
      end if;
      if new.compte_contrepartie is distinct from old.compte_contrepartie then
        raise exception '% : le compte de contrepartie de cet encaissement ne change plus.',
          public.exercice_fige(v_dossier, extract(year from old.date_encaissement)::integer) using errcode = '23514';
      end if;
      -- Le rattachement, de nul à un mouvement, et rien d'autre : le chèque remis avant la frontière, que le crédit qui le
      -- paie, après elle, solde au 511 — l'écriture de l'encaissement ne change pas.
      v_rattachement := old.ligne_bancaire_id is null and new.ligne_bancaire_id is not null
        and (to_jsonb(new) - 'ligne_bancaire_id') = (to_jsonb(old) - 'ligne_bancaire_id');
    end if;
    if not v_rattachement and (tg_op = 'DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
      raise exception '% : cet encaissement ne change plus.',
        public.exercice_fige(v_dossier, extract(year from old.date_encaissement)::integer) using errcode = '23514';
    end if;
    -- Rattaché à un mouvement d'un autre jour — et tout mouvement que la frontière laisse citer l'est —, un encaissement
    -- s'écrit sur les valeurs à l'encaissement (le 53 pour des espèces) : son écriture de l'exercice validé ne change que
    -- s'il ne s'y écrivait pas déjà. Par compensation, ou par un autre moyen, il s'écrivait sans mouvement sur son compte de
    -- contrepartie ; une contre-passation sans mouvement défait son encaissement là où il a été écrit — sur la banque d'un
    -- mouvement de son jour, s'il en cite un (src/lib/ecrituresVentesFacturees.ts, le compte de trésorerie). La fonction du
    -- rattachement refuse ce dernier cas plus tôt (le mouvement de l'encaissement contre-passé est classé) ; une écriture
    -- directe, ici.
    if v_rattachement and (old.moyen in ('compensation', 'autre')
        or old.annule_id is not null and exists (
             select 1 from public.encaissements_factures o
               join public.lignes_bancaires l on l.id = o.ligne_bancaire_id
              where o.id = old.annule_id and l.date = o.date_encaissement)) then
      raise exception '% : cet encaissement ne se rattache plus à un mouvement.',
        public.exercice_fige(v_dossier, extract(year from old.date_encaissement)::integer) using errcode = '23514';
    end if;
  end if;

  -- Le mouvement cité, à la naissance ou au rattachement : un mouvement que la validation fige ne change plus, ni ce qu'il
  -- justifie.
  if tg_op <> 'DELETE' and new.ligne_bancaire_id is not null
     and (tg_op = 'INSERT' or new.ligne_bancaire_id is distinct from old.ligne_bancaire_id) then
    select l.date into v_date from public.lignes_bancaires l where l.id = new.ligne_bancaire_id;
    if v_date <= v_frontiere then
      raise exception '% : ce mouvement ne se cite plus.',
        public.exercice_fige(v_dossier, extract(year from v_date)::integer) using errcode = '23514';
    end if;
  end if;
  return public.retour_declencheur(tg_op, old, new);
end
$$;

-- Après la garde des encaissements (l'ordre des noms) : elle lit la facture aux droits de l'appelant, avant la RLS.
create trigger encaissements_factures_gardes_frontiere
  before insert or update or delete on public.encaissements_factures
  for each row execute function public.garder_frontiere_des_encaissements();

create trigger encaissements_factures_taux_gardes_frontiere
  before insert or update or delete on public.encaissements_factures_taux
  for each row execute function public.garder_frontiere_des_encaissements();

revoke execute on function public.garder_frontiere_des_encaissements() from public, anon, authenticated;

comment on function public.garder_frontiere_des_encaissements() is
  'La frontière d''un exercice validé, pour l''encaissement d''une facture source : rien n''y naît ; rien de ce qui y est daté ne se retire, ne change de compte, ni ne se rattache quand son écriture en changerait ; aucun mouvement figé ne se cite, aucune part ne change ; la restauration passe avant les exercices validés, la suppression d''un dossier passe.';

-- ══ 2. Rattacher : la frontière jugée sur le mouvement ══════════
-- La définition de `encaissements_de_la_vente_facturee`, au caractère près hors du rang 6 (sa condition) et du rang 9,
-- neuf, et de leurs commentaires. Dans l'ordre (src/lib/encaissementsFactures.ts, `REFUS_RATTACHEMENT`) :
--   1. l'accès ; 2. l'encaissement introuvable ; 3. retiré ; 4. qui cite déjà un mouvement ; 5. d'une facture qui n'est
--   pas source ; 6. daté d'un exercice que la frontière fige, par compensation ou par un autre moyen ; 7. aucun mouvement
--   désigné ; 8. un mouvement d'un autre dossier ; 9. NEUF — un mouvement daté d'un exercice que la frontière fige ;
--   10. un débit pour un encaissement, 11. un crédit pour une contre-passation ; 12. un mouvement déjà classé ; 13. pour
--   un encaissement, un mouvement qui justifie déjà un encaissement de cette facture ; 14. l'écart des frais, sur les
--   encaissements (15 : sur les contre-passations) que le mouvement justifierait ; pour une contre-passation, 16. le
--   mouvement de l'encaissement qu'elle annule classé, 17. ou qu'il justifierait alors au-delà des frais.
create or replace function public.rattacher_mouvement_encaissement(
  p_dossier_id uuid,
  p_encaissement_id uuid,
  p_ligne_bancaire_id uuid
)
returns public.encaissements_factures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_encaissement public.encaissements_factures;
  v_source boolean;
  v_frontiere date;
  v_mouvement public.lignes_bancaires;
  v_origine public.lignes_bancaires;
  v_total numeric;
  v_exces numeric;
begin
  if not public.admin_du_dossier(p_dossier_id) then
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
    raise exception 'Cet encaissement est retiré : il ne se rattache plus à un mouvement.' using errcode = '22023';
  end if;
  if v_encaissement.ligne_bancaire_id is not null then
    raise exception 'Cet encaissement cite déjà un mouvement : il ne se rattache qu''une fois.' using errcode = '22023';
  end if;
  if not v_source then
    raise exception 'Seul l''encaissement d''une facture source de sa vente se rattache après coup au mouvement qui le prouve.'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  v_frontiere := public.frontiere_validation(p_dossier_id);
  -- Daté d'un exercice validé, un encaissement se rattache encore au mouvement d'après qui le paie : son écriture ne change
  -- pas (le 511, ou le 53). Par compensation ou par un autre moyen, elle est sur son compte de contrepartie, et changerait.
  if v_frontiere is not null and v_encaissement.date_encaissement <= v_frontiere
     and v_encaissement.moyen in ('compensation', 'autre') then
    raise exception '% : cet encaissement ne se rattache plus à un mouvement.',
      public.exercice_fige(p_dossier_id, extract(year from v_encaissement.date_encaissement)::integer) using errcode = '22023';
  end if;
  if p_ligne_bancaire_id is null then
    raise exception 'Le mouvement à rattacher est à désigner.' using errcode = '22023';
  end if;
  select * into v_mouvement from public.lignes_bancaires l
   where l.id = p_ligne_bancaire_id and l.dossier_id = p_dossier_id
   for no key update;
  if not found then
    raise exception 'Ce mouvement n''est pas un mouvement de ce dossier.' using errcode = '22023';
  end if;
  -- Le mouvement, lui, ne se cite plus s'il est daté d'un exercice validé : ce qu'il justifie est figé avec lui.
  if v_frontiere is not null and v_mouvement.date <= v_frontiere then
    raise exception '% : ce mouvement ne se cite plus.',
      public.exercice_fige(p_dossier_id, extract(year from v_mouvement.date)::integer) using errcode = '22023';
  end if;
  if v_encaissement.annule_id is null and v_mouvement.montant <= 0 then
    raise exception 'Un encaissement se justifie par un crédit : ce mouvement n''en est pas un.' using errcode = '22023';
  end if;
  if v_encaissement.annule_id is not null and v_mouvement.montant >= 0 then
    raise exception 'Une contre-passation se justifie par un débit : ce mouvement n''en est pas un.' using errcode = '22023';
  end if;
  if not public.mouvement_libre(v_mouvement) then
    raise exception 'Ce mouvement est déjà classé : l''encaissement d''une facture source de sa vente ne cite qu''un mouvement que rien ne classe encore — retirer d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_encaissement.annule_id is null then
    if exists (select 1 from public.encaissements_factures e
                where e.ligne_bancaire_id = p_ligne_bancaire_id and e.facture_id = v_encaissement.facture_id
                  and e.retire_le is null and public.encaissement_justifie_son_mouvement(e.id)) then
      raise exception 'Ce mouvement justifie déjà un encaissement de cette facture.' using errcode = '22023';
    end if;
    -- Ce que le mouvement justifierait : ce qu'il justifie déjà, et cet encaissement s'il le justifie (une
    -- contre-passation sans mouvement dit qu'il n'a pas eu lieu, et il ne pèse alors rien).
    select coalesce(sum(e.montant), 0) into v_total
      from public.encaissements_factures e
     where (e.ligne_bancaire_id = p_ligne_bancaire_id or e.id = p_encaissement_id) and e.retire_le is null
       and public.encaissement_justifie_son_mouvement(e.id);
    v_exces := (v_total - v_mouvement.montant) * 100;
    if v_exces * 100 > least(50000, v_total * 200) then
      raise exception 'Ce mouvement de % € justifierait % € d''encaissements : l''écart dépasse ce que des frais bancaires expliquent.',
        replace(to_char(v_mouvement.montant, 'FM999999999990.00'), '.', ','), replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
        using errcode = '22023';
    end if;
  else
    select coalesce(sum(c.montant), 0) + v_encaissement.montant into v_total
      from public.encaissements_factures c
     where c.ligne_bancaire_id = p_ligne_bancaire_id and c.retire_le is null;
    v_exces := (abs(v_total) - abs(v_mouvement.montant)) * 100;
    if v_exces * 100 > least(50000, abs(v_total) * 200) then
      raise exception 'Ce mouvement de % € justifierait % € de contre-passations : l''écart dépasse ce que des frais bancaires expliquent.',
        replace(to_char(abs(v_mouvement.montant), 'FM999999999990.00'), '.', ','), replace(to_char(abs(v_total), 'FM999999999990.00'), '.', ',')
        using errcode = '22023';
    end if;
    -- Le mouvement de l'encaissement que la contre-passation annule, sous son verrou partagé : un classement concurrent
    -- attend ce rattachement, puis le voit.
    select l.* into v_origine
      from public.encaissements_factures e
      join public.lignes_bancaires l on l.id = e.ligne_bancaire_id
     where e.id = v_encaissement.annule_id
       for share of l;
    if found then
      if not public.mouvement_libre(v_origine) then
        raise exception 'Le mouvement de l''encaissement contre-passé est classé : rattachée à un débit, la contre-passation le lui ferait justifier de nouveau — le cabinet retire d''abord ce classement.'
          using errcode = '22023';
      end if;
      select coalesce(sum(e.montant), 0) into v_total
        from public.encaissements_factures e
       where e.ligne_bancaire_id = v_origine.id and e.retire_le is null
         and (public.encaissement_justifie_son_mouvement(e.id) or e.id = v_encaissement.annule_id);
      v_exces := (v_total - v_origine.montant) * 100;
      if v_exces * 100 > least(50000, v_total * 200) then
        raise exception 'Le mouvement de l''encaissement contre-passé, de % €, justifierait alors % € d''encaissements : l''écart dépasse ce que des frais bancaires expliquent.',
          replace(to_char(v_origine.montant, 'FM999999999990.00'), '.', ','), replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
          using errcode = '22023';
      end if;
    end if;
  end if;

  perform set_config('jd.rattachement_encaissement', p_encaissement_id::text, true);
  update public.encaissements_factures
     set ligne_bancaire_id = p_ligne_bancaire_id
   where id = p_encaissement_id
  returning * into v_encaissement;
  perform set_config('jd.rattachement_encaissement', '', true);
  return v_encaissement;
end
$$;

comment on function public.rattacher_mouvement_encaissement(uuid, uuid, uuid) is
  'Rattache une fois, de nul à un mouvement, l''encaissement (un crédit) ou la contre-passation (un débit) d''une facture source enregistré sans mouvement ; le cabinet seul. Un mouvement daté d''un exercice validé ne se cite plus ; l''encaissement qui en est daté se rattache au mouvement d''après, sauf par compensation ou par un autre moyen.';
