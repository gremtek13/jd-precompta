-- LA CONTRE-PASSATION NE CITE UN MOUVEMENT QU'AVEC « BANQUE » (chantier EC-Q3, ligne 28.65 ; après la migration
-- `encaissements_de_la_vente_facturee`, 20261019070229, qu'elle exige). Le récit : HISTORIQUE.md, « LA CONTRE-PASSATION
-- NE CITE UN MOUVEMENT QU'AVEC « BANQUE » ».
--
-- LE DÉFAUT, trouvé par le lot VF5b. `annuler_encaissement` juge l'accès par `gere_les_ventes` seul. Depuis l'étape
-- VF2, une contre-passation peut citer le DÉBIT qui défait l'encaissement (son cinquième paramètre) — une donnée de la
-- banque —, et la fonction ne demandait pas le droit « Banque » (`gere_la_banque`) pour le citer, quand
-- `enregistrer_encaissement` le demande pour le mouvement d'un encaissement (son rang 2, espace client, étape P2). La
-- règle du cabinet — « Ventes » ouvre ses ventes et leurs gestes, « un mouvement désigné demande aussi « Banque » » —
-- n'était tenue que d'un côté. Un client qui porte « Ventes » sans « Banque » lit
-- `encaissements_factures.ligne_bancaire_id` (la lecture de ses ventes) : il pouvait apprendre l'identifiant d'un débit
-- qu'une contre-passation du cabinet cite, le citer en appelant la fonction lui-même, et les refus suivants lui
-- disaient ce que la RLS lui cache — que ce mouvement est de son dossier, un débit, déjà classé ou non, et son MONTANT
-- (« Ce mouvement de % € justifierait % € de contre-passations ») ; accepté, il écrivait une contre-passation qui cite
-- un débit, que la garde G2 réserve ensuite aux encaissements. L'écran ne le lui a jamais offert (VF5b : le débit ne se
-- choisit qu'avec « Banque »).
--
-- L'EXPOSITION, MESURÉE LE 22/10/2026 EN PRODUCTION (des comptes, aucune valeur) : trois accès, aucun ne porte
-- « Ventes » ni « Banque » ; aucun encaissement, aucune facture source, aucune contre-passation qui cite un débit.
-- Nulle — à fermer avant le premier accès « Ventes ».
--
-- CE QUI CHANGE, ET RIEN D'AUTRE. Un refus au rang 2 : un débit cité sans le droit « Banque » sur le dossier — LE MÊME
-- que le rang 2 d'`enregistrer_encaissement`, sous les mêmes mots et le même code (42501), placé de même : juste après
-- le contrôle d'accès, AVANT toute lecture de l'encaissement ou du mouvement. Rien ne se dit de l'un ni de l'autre
-- avant lui. La fonction est reprise de sa définition de `encaissements_de_la_vente_facturee` (son § 6), au caractère
-- près hors de ce refus et de son commentaire : même signature (le débit nul par défaut), `security definer`, même
-- chemin, mêmes verrous, mêmes refus dans le même ordre, sous les mêmes mots et les mêmes codes. `create or replace`
-- lui garde ses droits d'exécution (le compte connecté, ni l'anonyme ni PUBLIC) et son commentaire : rien n'est à
-- rejouer.
--
-- SES REFUS, DANS L'ORDRE (src/lib/encaissementsFactures.ts, `REFUS_CONTRE_PASSATION`, les redit avant le clic) :
--   1. l'accès ; 2. NEUF : un débit cité sans le droit « Banque » ; 3. l'encaissement introuvable ; 4. une
--   contre-passation ; 5. retiré ; 6. non déclaré ; 7. une déclaration d'issue inconnue ; 8. déjà contre-passé ; 9 à
--   11. la date (renseignée, pas avant l'encaissement, pas dans l'avenir) ; 12. SOURCE : une date que la frontière d'un
--   exercice validé fige ; 13 et 14. le motif (renseigné, 2 000 caractères au plus) ; puis, s'il cite un mouvement :
--   15. une facture qui n'est pas source ; 16. un mouvement d'un autre dossier ; 17. un crédit ; 18. un mouvement déjà
--   classé ; 19. des contre-passations qui le dépasseraient au-delà des frais ; et sans mouvement : 20. SOURCE : le
--   mouvement de l'encaissement contre-passé, classé par ses encaissements.
--
-- NEUTRE pour le cabinet, qui porte les deux droits (`gere_la_banque` : `admin_du_dossier`, ou un accès qui porte
-- « Banque ») ; pour l'appel d'hier, à quatre paramètres, qui ne cite aucun débit ; et pour le client qui porte les
-- deux droits. Seul change l'appel d'un client « Ventes » sans « Banque » qui cite un débit : refusé au rang 2, au lieu
-- d'un refus plus loin ou d'une acceptation. Aucune table, colonne, contrainte, policy ni aucun droit ne change ;
-- aucune donnée lue de plus, écrite ni retirée.
--
-- CE QUI CONTOURNE LA RLS : rien de plus qu'avant — la fonction reste `security definer`, et juge l'accès puis,
-- désormais, le droit « Banque » d'un débit cité, avant toute lecture. CONCURRENCE : inchangée — le refus neuf ne lit
-- que les droits de l'appelant, sans verrou ; les verrous de la facture, de l'encaissement puis du mouvement suivent,
-- dans le même ordre.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni
-- instruction qui en retire, dans le texte comme dans le corps de la fonction.
--
-- VERSION PROVISOIRE : le fichier prendra la version que `apply_migration` donnera à sa ligne d'historique.

-- ══ 0. La contre-passation de VF2 d'abord, telle que cette migration la reprend ══════════

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
                 chr(13), '')) <> '071db874518d3519a400c405724db794' then
    raise exception 'La contre-passation en base n''est plus celle de la migration encaissements_de_la_vente_facturee : cette migration ne la remplace pas sans être relue.';
  end if;
end
$$;

-- ══ 1. Contre-passer un encaissement déclaré : le débit cité demande aussi « Banque » ══════════
-- La définition de `encaissements_de_la_vente_facturee`, au caractère près hors du refus du rang 2 et de son
-- commentaire.
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
  if not found then
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
