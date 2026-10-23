-- L'IMPAYÉ D'UN ENCAISSEMENT JAMAIS DÉCLARÉ (chantier EC-Q3, ligne 28.65, étape VF5d2 ; après la migration
-- `contre_passation_banque`, 20261022185455, qu'elle exige). Le récit : HISTORIQUE.md, « L'IMPAYÉ D'UN ENCAISSEMENT
-- JAMAIS DÉCLARÉ ».
--
-- LA DÉCISION DU CABINET (22/10/2026, VF5-Q1, à la recommandation) : « Contre-passer en citant le débit, même sans
-- déclaration ». Jusqu'ici, `annuler_encaissement` ne contre-passait qu'un encaissement DÉCLARÉ (son rang 6 : « Cet
-- encaissement n'est pas déclaré : il se retire, sans contre-passation. ») : le chèque revenu impayé d'un encaissement
-- jamais déclaré — celui de toute facture à un particulier, qu'aucune plateforme ne reçoit — ne pouvait que se retirer,
-- ce qui efface un fait (l'argent est venu, puis reparti), laisse le crédit et le débit à classer à la main, et devient
-- impossible dès l'exercice validé (le retrait d'un encaissement d'une facture source s'y refuse).
--
-- CE QUI CHANGE, ET RIEN D'AUTRE. Le rang 6 ne s'oppose plus à UN cas : l'encaissement d'une facture SOURCE de sa
-- vente, dont la contre-passation cite le DÉBIT qui le défait (le cinquième paramètre). Sans débit, ou pour une facture
-- qui n'est pas source, le refus d'hier, sous les mêmes mots. La fonction est reprise de sa définition de
-- `contre_passation_banque`, au caractère près hors de cette condition et de son commentaire : même signature (le débit
-- nul par défaut), `security definer`, même chemin, mêmes verrous, mêmes refus dans le même ordre, sous les mêmes mots
-- et les mêmes codes. La source de la facture est lue avant le rang 6, sous le verrou de la facture, comme hier ; le
-- rang 7 (une déclaration d'issue inconnue) ne se rencontre pas sans déclaration. Une source illisible tombe du côté
-- fermé : le refus d'hier.
--
-- CE QUE LA CONTRE-PASSATION QUI EN NAÎT DEVIENT. Elle ne se déclare pas : `declarer_encaissement_hors_application`
-- refuse déjà, à son rang 5, une contre-passation dont l'encaissement n'est pas déclaré. La paire ne fait rien
-- déclarer : l'application ne dit « à déclarer » ni l'encaissement ni sa contre-passation
-- (src/lib/encaissementsFactures.ts, `paireNonDeclaree`). Elle se compte comme toute contre-passation — la recette et
-- sa TVA en moins à sa date, ses écritures, les paiements de l'e-reporting — : rien de cela ne lit les déclarations.
-- Elle cite le débit, que la garde G2 réserve ensuite à ses contre-passations, et que le cabinet classe par elles.
--
-- SES REFUS, DANS L'ORDRE (src/lib/encaissementsFactures.ts, `REFUS_CONTRE_PASSATION`, les redit avant le clic) : les
-- vingt d'hier, aux mêmes rangs, sous les mêmes mots ; seule la condition du rang 6 change.
--
-- NEUTRE EN PRODUCTION : aucun dossier n'a basculé (aucune facture source). Pour l'appel d'hier, à quatre paramètres,
-- qui ne cite aucun débit, et pour une facture qui n'est pas source, rien ne change. Seul change l'appel qui cite un
-- débit pour l'encaissement jamais déclaré d'une facture source — le cabinet, ou le client qui porte « Ventes » et
-- « Banque » (un débit cité demande « Banque », rang 2) — : accepté, au lieu du refus du rang 6. Aucune table, colonne,
-- contrainte, policy ni aucun droit ne change ; aucune donnée lue de plus, écrite ni retirée.
--
-- LE COMMENTAIRE DE LA FONCTION dit désormais ce cas (« Contre-passe un encaissement déclaré », « la contre-passation
-- se déclare à son tour » le taisaient). `create or replace` garde l'OID de la fonction et ses droits d'exécution (le
-- compte connecté et le rôle des Edge Functions ; ni l'anonyme ni PUBLIC) : ils ne sont pas rejoués.
--
-- CE QUI CONTOURNE LA RLS : rien de plus qu'avant. CONCURRENCE : inchangée — la condition neuve ne lit rien de plus, et
-- les verrous de la facture, de l'encaissement puis du mouvement suivent dans le même ordre.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni
-- instruction qui en retire, dans le texte comme dans le corps de la fonction.
--
-- VERSION PROVISOIRE : le fichier prendra la version que `apply_migration` donnera à sa ligne d'historique.

-- ══ 0. La contre-passation de `contre_passation_banque` d'abord, telle que cette migration la reprend ══════════

do $$
begin
  if to_regprocedure('public.annuler_encaissement(uuid, uuid, date, text, uuid)') is null then
    raise exception 'La migration encaissements_de_la_vente_facturee (étape VF2) précède celle-ci : la contre-passation n''a pas son cinquième paramètre.';
  end if;
  -- Le corps que cette migration reprend, au caractère près (les retours chariot d'un collage écartés) : une
  -- contre-passation changée depuis — par une autre migration, ou par une première application de celle-ci — ne se
  -- remplace pas sans être relue.
  if md5(replace((select p.prosrc from pg_proc p
                   where p.oid = 'public.annuler_encaissement(uuid, uuid, date, text, uuid)'::regprocedure),
                 chr(13), '')) <> '280da760fa49f59627d483b4a4741f6b' then
    raise exception 'La contre-passation en base n''est plus celle de la migration contre_passation_banque : cette migration ne la remplace pas sans être relue.';
  end if;
end
$$;

-- ══ 1. Contre-passer l'encaissement jamais déclaré d'une facture source, en citant le débit qui le défait ══════════
-- La définition de `contre_passation_banque`, au caractère près hors de la condition du rang 6 et de son commentaire.
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

-- ══ 2. Son commentaire : il dit désormais ce cas ══════════
comment on function public.annuler_encaissement(uuid, uuid, date, text, uuid) is
  'Contre-passe un encaissement déclaré : montant et répartition opposés, même moyen, motif, datée du décaissement ; pour une facture source, elle peut citer le débit qui défait l''encaissement, et, avec lui, contre-passer aussi un encaissement jamais déclaré. La contre-passation se déclare à son tour, sauf celle d''un encaissement jamais déclaré, qui ne se déclare pas plus que lui.';
