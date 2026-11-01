-- LE RETOUR ARRIÈRE DE `paiement_par_la_caisse` (la caisse, ligne 26.6, étape C8). Le récit : HISTORIQUE.md, « LA
-- CAISSE : LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE, EN BASE (C8, LIGNE 26.6) ».
--
-- CE QU'IL FAIT : les quatre corps que la migration a remplacés, rendus tels que la migration `caisse` les a posés, au
-- caractère près (`create or replace` : leur OID, leur propriétaire, leurs droits et leurs déclencheurs restent) —
-- `premier_jour_negatif_de_la_caisse` (la caisse ne se borne plus à son ouverture), `garder_la_caisse` (le raccourci
-- d'une ouverture qui ne fait qu'ajouter revient), `garder_ecriture_de_caisse` (la contrepartie d'un paiement ne s'écrit
-- plus hors d'une fonction), `enregistrer_operation_caisse` (l'ensemble du jour d'une recette ne compte plus les paiements
-- de pièces de vente) ; puis il RETIRE les deux déclencheurs neufs et les trois fonctions neuves —
-- `regler_piece_par_la_caisse`, `garder_piece_payee_par_la_caisse`, `garder_caisse_depuis_l_ouverture`.
--
-- CE QU'IL RETIRE, À ACCORDER PAR LE CABINET : trois fonctions et deux déclencheurs, des objets — aucune ligne, aucune
-- table, aucune colonne, aucun droit d'un objet qui reste. Sa garde de tête le refuse dès qu'un paiement par la caisse
-- existe (retiré ou non) : avant le premier, rien ne se perd ; après, un paiement resterait sans sa fonction ni sa garde.
-- Le texte porte le mot de la suppression d'un objet : il se colle, dans une transaction, avec sa ligne d'historique —
-- retirer celle de la migration serait une suppression de plus, à accorder aussi. Aucune barre oblique inverse.
--
-- CE QUE L'APPLICATION EN DIT : rien ne s'y rouvre — le drapeau `PAIEMENT_PAR_LA_CAISSE_EXPORTE` se rebaisse, l'écran ne
-- règle plus de pièce par la caisse ; la fiche d'un mouvement refuse encore le classement d'un mouvement d'avant
-- l'ouverture, et le module borne encore la caisse : il juge alors plus strictement que la base, du côté fermé.
--
-- LA RELECTURE DU 01/11/2026 (HISTORIQUE.md, « LA CAISSE : LA RELECTURE DE C8 ET C9, ET SES CORRECTIONS ») a changé deux des
-- sept corps de la migration — `regler_piece_par_la_caisse` (le reste au centime) et `garder_ecriture_de_caisse` (les mots de
-- la pièce supprimée sous sa contrepartie) — : la garde de tête attend leurs empreintes neuves ; ce que le retour rend, les
-- quatre corps de la migration `caisse`, ne change pas. Éprouvé le 01/11/2026 sur la réplique de C8 : l'ancien retour a défait
-- l'ancienne migration (la signature revenue à celle d'avant, famille par famille), puis celui-ci la nouvelle.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. La garde de tête ══════════
-- Les sept corps de la migration à leur empreinte (les retours chariot d'un collage écartés) : une base où l'un d'eux a
-- changé depuis ne se défait pas sans être relue ; puis aucun paiement par la caisse.
do $garde$
declare
  v_attendue record;
  v_empreinte text;
begin
  for v_attendue in select * from (values
      ('premier_jour_negatif_de_la_caisse', 'public.premier_jour_negatif_de_la_caisse(uuid)', '3e04d7e969c9614be2d9eda3415f0da2'),
      ('garder_la_caisse', 'public.garder_la_caisse()', '5c9cc864b19928249626604efcc62246'),
      ('garder_ecriture_de_caisse', 'public.garder_ecriture_de_caisse()', '9db99bb96816b57669a688a1a8dc7b71'),
      ('enregistrer_operation_caisse', 'public.enregistrer_operation_caisse(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb)', '394bed68d4f6b59d030e3792e758840e'),
      ('regler_piece_par_la_caisse', 'public.regler_piece_par_la_caisse(uuid, uuid, date, numeric)', 'c8b8e39eb6fac46f386673e2d4e775e0'),
      ('garder_piece_payee_par_la_caisse', 'public.garder_piece_payee_par_la_caisse()', 'f23d930eb520580ec9d8eb82fad4cfeb'),
      ('garder_caisse_depuis_l_ouverture', 'public.garder_caisse_depuis_l_ouverture()', '7155daf0e08ef5f570e3b207d7c833c6')
    ) as t(nom, signature, empreinte) loop
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p where p.oid = to_regprocedure(v_attendue.signature);
    if v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est pas celle que la migration paiement_par_la_caisse a posée (empreinte attendue %…) : ce retour arrière ne s''applique pas sans être relu.',
        v_attendue.nom, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  if exists (select 1 from public.operations_caisse o where o.genre = 'paiement') then
    raise exception 'Un paiement par la caisse existe : le retour arrière le laisserait sans sa fonction ni sa garde. Rien n''est retiré.';
  end if;
end
$garde$;

-- ══ 1. Les quatre corps d'hier, ceux de la migration `caisse`, au caractère près ══════════
create or replace function public.premier_jour_negatif_de_la_caisse(p_dossier_id uuid)
returns table (jour date, solde numeric)
language sql
stable
security definer
set search_path = public
as $$
  with caisse as (
    select public.compte_du_role(p_dossier_id, 'caisse') as compte
  ), flux (le_jour, le_montant) as (
    -- L'ouverture : les à-nouveaux du compte de la caisse.
    select a.date, case when a.sens = 'debit' then a.montant else -a.montant end
      from public.a_nouveaux a, caisse c
     where a.dossier_id = p_dossier_id and a.compte = c.compte
    union all
    -- Les opérations non retirées.
    select o.date, case when o.genre = 'prelevement' then -o.montant else o.montant end
      from public.operations_caisse o
     where o.dossier_id = p_dossier_id and o.retire_le is null
    union all
    -- Les mouvements du relevé classés sur le compte de la caisse.
    select l.date, -l.montant
      from public.lignes_bancaires l, caisse c
     where l.dossier_id = p_dossier_id and l.compte_bilan = c.compte
    union all
    -- Les espèces des factures sources : un encaissement en espèces sans mouvement, ou la contre-passation sans
    -- mouvement d'un tel encaissement.
    select e.date_encaissement, e.montant
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
      left join public.encaissements_factures o on o.id = e.annule_id
     where e.dossier_id = p_dossier_id and f.source_de_la_vente and e.retire_le is null and e.ligne_bancaire_id is null
       and case when e.annule_id is null then e.moyen = 'especes'
                else o.ligne_bancaire_id is null and o.moyen = 'especes' end
  ), soldes as (
    select x.le_jour, sum(sum(x.le_montant)) over (order by x.le_jour) as le_solde
      from flux x
     group by x.le_jour
  )
  select s.le_jour, s.le_solde from soldes s where s.le_solde < 0 order by s.le_jour limit 1
$$;

create or replace function public.garder_la_caisse() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dossier uuid;
  v_dossiers uuid[];
  v_avant numeric := 0;
  v_apres numeric := 0;
  v_jour_avant date;
  v_jour_apres date;
  v_cree timestamp with time zone;
  v_geste text;
  v_montant numeric;
  v_jour date;
  v_solde numeric;
begin
  v_dossier := case when tg_op = 'DELETE' then old.dossier_id else new.dossier_id end;

  if tg_table_name = 'operations_caisse' then
    if tg_op <> 'INSERT' and old.retire_le is null then
      v_avant := case when old.genre = 'prelevement' then -old.montant else old.montant end;
      v_jour_avant := old.date;
    end if;
    if tg_op <> 'DELETE' then
      if new.retire_le is null then
        v_apres := case when new.genre = 'prelevement' then -new.montant else new.montant end;
      end if;
      v_jour_apres := new.date;
      v_cree := new.cree_le;
    end if;
  elsif tg_table_name = 'lignes_bancaires' then
    if (tg_op = 'INSERT' or old.compte_bilan is null) and (tg_op = 'DELETE' or new.compte_bilan is null) then
      return null;
    end if;
    if tg_op <> 'INSERT' and old.compte_bilan = public.compte_du_role(old.dossier_id, 'caisse') then
      v_avant := -old.montant;
      v_jour_avant := old.date;
    end if;
    if tg_op <> 'DELETE' then
      if new.compte_bilan = public.compte_du_role(new.dossier_id, 'caisse') then
        v_apres := -new.montant;
      end if;
      v_jour_apres := new.date;
      v_cree := new.created_at;
    end if;
  elsif tg_table_name = 'encaissements_factures' then
    if tg_op <> 'INSERT' and old.retire_le is null and old.ligne_bancaire_id is null
       and exists (select 1 from public.factures_emises f where f.id = old.facture_id and f.source_de_la_vente)
       and (old.annule_id is null and old.moyen = 'especes'
            or old.annule_id is not null and exists (select 1 from public.encaissements_factures o
                                                      where o.id = old.annule_id and o.ligne_bancaire_id is null
                                                        and o.moyen = 'especes')) then
      v_avant := old.montant;
      v_jour_avant := old.date_encaissement;
    end if;
    if tg_op <> 'DELETE' then
      if new.retire_le is null and new.ligne_bancaire_id is null
         and exists (select 1 from public.factures_emises f where f.id = new.facture_id and f.source_de_la_vente)
         and (new.annule_id is null and new.moyen = 'especes'
              or new.annule_id is not null and exists (select 1 from public.encaissements_factures o
                                                        where o.id = new.annule_id and o.ligne_bancaire_id is null
                                                          and o.moyen = 'especes')) then
        v_apres := new.montant;
      end if;
      v_jour_apres := new.date_encaissement;
      v_cree := new.cree_le;
    end if;
  elsif tg_table_name = 'a_nouveaux' then
    if tg_op <> 'INSERT' and old.compte = public.compte_du_role(old.dossier_id, 'caisse') then
      v_avant := case when old.sens = 'debit' then old.montant else -old.montant end;
      v_jour_avant := old.date;
    end if;
    if tg_op <> 'DELETE' then
      if new.compte = public.compte_du_role(new.dossier_id, 'caisse') then
        v_apres := case when new.sens = 'debit' then new.montant else -new.montant end;
      end if;
      v_jour_apres := new.date;
      v_cree := new.created_at;
    end if;
  else
    raise exception 'garder_la_caisse ne veille pas sur la table %.', tg_table_name;
  end if;

  -- Rien de la caisse, ni avant ni après.
  if v_avant = 0 and v_apres = 0 then
    return null;
  end if;
  -- La porte de la restauration.
  if tg_op = 'INSERT' and v_cree < now() and public.is_super_admin()
     and not exists (select 1 from public.exercices_valides v where v.dossier_id = v_dossier) then
    return null;
  end if;
  -- Les caisses à juger. Une ligne qui reste dans son dossier : la sienne, sauf si le changement ne peut, à aucun jour,
  -- que garder ou grossir la caisse — au jour t, le solde d'après est celui d'avant, moins l'ancien apport s'il
  -- comptait déjà, plus le nouveau s'il compte déjà. Une ligne qui passe d'un dossier à un autre : celui qu'elle quitte
  -- s'il perd des espèces, celui qu'elle rejoint s'il en perd. Un dossier qui n'est plus (sa cascade) ne se juge pas.
  if tg_op = 'UPDATE' and old.dossier_id is distinct from new.dossier_id then
    v_dossiers := array(select x from unnest(array[case when v_avant > 0 then old.dossier_id end,
                                                   case when v_apres < 0 then new.dossier_id end]) x
                         where x is not null order by x);
  else
    if tg_op = 'INSERT' then
      v_jour_avant := v_jour_apres;
    elsif tg_op = 'DELETE' then
      v_jour_apres := v_jour_avant;
    end if;
    v_jour_avant := coalesce(v_jour_avant, v_jour_apres);
    v_jour_apres := coalesce(v_jour_apres, v_jour_avant);
    if v_apres >= v_avant
       and (v_jour_apres >= v_jour_avant or v_apres >= 0)
       and (v_jour_avant >= v_jour_apres or v_avant <= 0) then
      return null;
    end if;
    v_dossiers := array[v_dossier];
  end if;

  -- Le geste, pour ses mots.
  if tg_table_name = 'operations_caisse' then
    if tg_op = 'INSERT' then
      v_geste := case when new.genre = 'prelevement' then 'prelevement'
                      when new.genre = 'recette' then 'especes_rendues'
                      when new.genre = 'paiement' then 'paiement' end;
      v_montant := new.montant;
    elsif tg_op = 'UPDATE' and new.retire_le is not null then
      v_geste := case when old.genre = 'recette' then 'retrait_recette' when old.genre = 'apport' then 'retrait_apport'
                      when old.genre = 'paiement' then 'retrait_paiement' end;
      v_montant := old.montant;
    end if;
  elsif tg_table_name = 'lignes_bancaires' then
    if v_apres < 0 then
      v_geste := 'versement';
      v_montant := v_apres;
    elsif v_avant > 0 and v_apres = 0 then
      v_geste := 'retrait_d_especes_retire';
      v_montant := v_avant;
    else
      -- Un retrait pour la caisse qui reste sur elle : plus petit, plus tard, ou dans un autre dossier.
      v_geste := 'mouvement_change';
      v_montant := v_apres;
    end if;
  elsif tg_table_name = 'encaissements_factures' then
    if tg_op = 'INSERT' and v_apres < 0 then
      v_geste := 'contre_passation';
      v_montant := v_apres;
    elsif tg_op = 'UPDATE' and v_avant > 0 and new.retire_le is not null and old.retire_le is null then
      v_geste := 'retrait_encaissement';
      v_montant := v_avant;
    elsif tg_op = 'UPDATE' and v_avant > 0 and new.ligne_bancaire_id is not null and old.ligne_bancaire_id is null then
      v_geste := 'rattachement_encaissement';
      v_montant := v_avant;
    end if;
  elsif tg_table_name = 'a_nouveaux' then
    if v_apres < 0 then
      v_geste := 'ouverture_au_credit';
      v_montant := v_apres;
    elsif v_avant > 0 and v_apres = 0 then
      v_geste := 'retrait_ouverture';
      v_montant := v_avant;
    else
      -- Une ouverture au débit qui reste au débit : plus petite, plus tard, ou dans un autre dossier.
      v_geste := 'ouverture_change';
      v_montant := v_apres;
    end if;
  end if;

  -- Le verrou de la caisse, puis la caisse rejouée : sous lui, une autre session qui la vide a fini, et se voit. Deux
  -- caisses se verrouillent dans l'ordre de leurs identifiants.
  foreach v_dossier in array v_dossiers loop
    if exists (select 1 from public.dossiers d where d.id = v_dossier) then
      perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || v_dossier::text, 0));
      select n.jour, n.solde into v_jour, v_solde from public.premier_jour_negatif_de_la_caisse(v_dossier) n;
      if v_jour is not null then
        raise exception '%', public.texte_caisse_negative(coalesce(v_geste, 'autre'), coalesce(v_montant, 0), v_jour, v_solde)
          using errcode = '23514';
      end if;
    end if;
  end loop;
  return null;
end
$$;

create or replace function public.garder_ecriture_de_caisse() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.operation_caisse_id is null
       or not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or not exists (select 1 from public.operations_caisse o where o.id = old.operation_caisse_id)
       or coalesce(current_setting('jd.caisse', true), '') = old.operation_caisse_id::text then
      return old;
    end if;
    raise exception 'L''écriture d''une opération de caisse se retire avec cette opération.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.operation_caisse_id is not null then
    raise exception 'L''écriture d''une opération de caisse ne se modifie pas : retire l''opération, puis saisis-la de nouveau.'
      using errcode = '42501';
  end if;
  if new.operation_caisse_id is null then
    return new;
  end if;
  if coalesce(current_setting('jd.caisse', true), '') is distinct from new.operation_caisse_id::text
     and not (tg_op = 'INSERT' and public.is_super_admin()
              and not exists (select 1 from public.exercices_valides v where v.dossier_id = new.dossier_id)) then
    raise exception 'L''écriture d''une opération de caisse ne s''écrit qu''avec cette opération, par la fonction de la caisse.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.operations_caisse o
                  where o.id = new.operation_caisse_id and o.dossier_id = new.dossier_id and o.date = new.date
                    and o.retire_le is null and (new.piece_id is null or new.piece_id = o.piece_id)) then
    raise exception 'Cette écriture ne suit pas son opération de caisse : son dossier, sa date, ou sa pièce.' using errcode = '23514';
  end if;
  return new;
end
$$;

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

  -- 8. L'ensemble du jour : les espèces des factures sources que la caisse compte ce jour-là.
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
    select min(x::text)::uuid into v_ecart from unnest(v_attendus) x where x <> all (v_recus);
    if v_ecart is not null then
      select f.numero into v_numero from public.encaissements_factures e join public.factures_emises f on f.id = e.facture_id
       where e.id = v_ecart;
      raise exception 'Un encaissement en espèces de la facture % du même jour a été enregistré depuis ta lecture : relis la caisse.',
        coalesce(v_numero, '(sans numéro)') using errcode = '22023';
    end if;
    select min(x::text)::uuid into v_ecart from unnest(v_recus) x where x <> all (v_attendus);
    if v_ecart is not null then
      select f.numero into v_numero from public.encaissements_factures e join public.factures_emises f on f.id = e.facture_id
       where e.id = v_ecart and e.dossier_id = p_dossier_id;
      if found then
        raise exception 'L''encaissement de la facture % que ta lecture comptait n''est pas dans la caisse de ce jour : relis la caisse.',
          coalesce(v_numero, '(sans numéro)') using errcode = '22023';
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

-- ══ 2. Les deux déclencheurs et les trois fonctions de la migration ══════════
drop trigger lignes_bancaires_sur_la_caisse_depuis_l_ouverture on public.lignes_bancaires;
drop trigger pieces_payees_par_la_caisse on public.pieces;
drop function public.garder_caisse_depuis_l_ouverture();
drop function public.garder_piece_payee_par_la_caisse();
drop function public.regler_piece_par_la_caisse(uuid, uuid, date, numeric);
