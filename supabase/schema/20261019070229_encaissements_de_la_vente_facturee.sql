-- LES ENCAISSEMENTS D'UNE FACTURE SOURCE DE SA VENTE, EN BASE (chantier EC-Q3, ligne 28.6, étape VF2 ; la seconde des
-- deux migrations de l'étape, après `source_de_la_vente`, qu'elle exige). Conception : HISTORIQUE.md, « LA FACTURE
-- VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », § 5, 7, 10, 11, 14 et 15. Elle touche le classement de TOUS les
-- mouvements du relevé (une contrainte remplacée) : présentée au cabinet avant d'être appliquée.
--
-- UNE VENTE FACTURÉE NE COMPTE QU'UNE FOIS : quand les moteurs liront les encaissements d'une facture source (étape VF3),
-- le mouvement qui les prouve ne doit rien porter d'autre — ni pièce, ni catégorie, ni ventilation, ni règlement groupé,
-- ni compte de bilan, ni cotisation, ni emprunt, ni déclaration de TVA, ni virement personnel —, sans quoi la recette
-- compterait par l'encaissement ET par le relevé. Deux gardes de la conception (§ 7) naissent ici :
--   - G1 : `lignes_bancaires.encaissements_de_factures` entre dans `lignes_bancaires_un_seul_rapprochement` — un
--     mouvement que le cabinet classe par ses encaissements ne porte rien d'autre (la contrainte REMPLACÉE, un
--     `drop constraint` suivi de sa nouvelle forme : aucune donnée perdue ; la colonne vaut faux partout, et tout
--     mouvement qui la respectait la respecte). Un mouvement ainsi classé est rapproché, jamais personnel
--     (`lignes_bancaires_encaissements_rapproches`, le patron des sept autres classements) ;
--   - G2 : un mouvement qui JUSTIFIE un encaissement non retiré d'une facture source est RÉSERVÉ, même avant que le
--     cabinet le classe — la garde `garder_mouvement_reserve` refuse alors tout autre classement, par la policy du
--     cabinet comme par les fonctions des classements du relevé (23514) ; et un mouvement déjà classé ne se cite pas (la
--     garde des encaissements, 23514, sauf à la restauration ; les fonctions le disent avant, 22023). Le drapeau ne
--     change que par les deux fonctions du cabinet, sous le réglage `jd.classement_encaissements` qu'elles posent POUR
--     CE MOUVEMENT, ou à la restauration ;
--   - ET CE QU'UN MOUVEMENT CLASSÉ JUSTIFIE NE CHANGE PLUS : chaque fonction qui le changerait se refuse tant qu'il est
--     classé, et la garde des encaissements refuse le retrait qui le ferait (23514).
--
-- CE QU'UN MOUVEMENT JUSTIFIE (`encaissement_justifie_son_mouvement`) : un encaissement qu'il prouve, tant qu'aucune
-- contre-passation vivante SANS mouvement ne l'annule — celle-là dit que l'encaissement n'a pas eu lieu sur lui ; une
-- contre-passation qui cite un DÉBIT dit que l'argent est venu puis reparti, et le laisse justifié par son crédit (§ 5).
-- Les fonctions d'hier disaient « annulé par une contre-passation vivante » : aucune contre-passation ne citant de
-- mouvement hors d'une facture source, c'est la même chose pour toute autre facture, au résultat près.
--
-- CE QUI S'AJOUTE, POUR UNE FACTURE SOURCE SEULEMENT (une facture qui ne l'est pas suit les règles d'hier, au mot près) :
--   - `enregistrer_encaissement` refuse une date que la frontière d'un exercice validé fige (rang 11, après les dates) et
--     un mouvement déjà classé (rang 17, après le débit) ; son plafond est NET DES AVOIRS validés de la facture
--     (EC3-Q10), en tout et par taux, sous des mots à lui (rangs 27 et 29, à la place des plafonds bruts) ;
--   - `retirer_encaissement` refuse un encaissement daté d'un exercice figé (rang 6) et celui dont le mouvement — ou, pour
--     une contre-passation sans mouvement, celui de l'encaissement qu'elle annule — est classé (rang 7 : le cabinet
--     retire d'abord ce classement) ;
--   - `annuler_encaissement` reçoit un CINQUIÈME paramètre, `p_ligne_bancaire_id`, nul par défaut — l'appel d'hier, à
--     quatre paramètres, fait ce qu'il faisait : quand la contre-passation défait de l'argent (le chèque revenu impayé, la
--     somme rendue), elle cite le DÉBIT qui le prouve (§ 5). La signature change : l'ancienne fonction est RETIRÉE
--     (`drop function`, aucune donnée) et la nouvelle prend ses droits et son commentaire. Ses refus neufs : la frontière
--     (rang 11, après les dates), puis, s'il cite un mouvement, une facture qui n'est pas source, un mouvement d'un autre
--     dossier, un crédit, un mouvement déjà classé, des contre-passations qui le dépasseraient au-delà des frais (rangs
--     14 à 18) ; sinon, le mouvement de l'encaissement contre-passé classé par ses encaissements (rang 19) ;
--   - `rattacher_mouvement_encaissement` (NOUVELLE, le cabinet seul) : un encaissement — ou une contre-passation —
--     enregistré sans mouvement se rattache UNE FOIS, de nul à un mouvement : le chèque remis avant son crédit, les
--     encaissements d'un client sans « Banque » (§ 15), l'impayé constaté au relevé — la contre-passation rattachée à
--     son débit rend à l'encaissement qu'elle annule le mouvement qui le justifiait, qui ne doit être ni classé ni
--     dépassé au-delà des frais ;
--   - `classer_mouvement_par_encaissements` et `retirer_classement_par_encaissements` (NOUVELLES, le cabinet seul) : le
--     mouvement que le client a désigné est RÉSERVÉ et PROPOSÉ, jamais classé par lui (EC3-Q4, MEG3-Q7) ; le cabinet le
--     classe, si ce que ses encaissements portent fait son montant à l'écart des frais près — la règle min(2 %, 5 €)
--     d'`alignementBanque.ts` que le registre tient depuis d1 —, et peut retirer ce classement.
--
-- LA CONTRAINTE `encaissements_factures_annulation_sans_mouvement` EST RETIRÉE (`drop constraint`, aucune donnée : aucune
-- contre-passation ne cite de mouvement) : la garde des encaissements tient désormais sa règle — une contre-passation ne
-- cite un mouvement que pour une facture source, et c'est un DÉBIT de son dossier ; pour toute autre facture, elle n'en
-- cite aucun, comme hier (le refus a ses mots, toujours en 23514).
--
-- NEUTRE : aucun dossier n'a basculé, aucune facture n'est source ; tant que le réglage n'est pas posé, toute écriture
-- qui passait passe encore, au même résultat, et ce qui se refusait se refuse — un seul refus change de MOTS : la
-- contre-passation qui citerait un mouvement, que la contrainte retirée refusait sous son nom. Rien de ce qui se compte
-- ne change. Aucune policy nouvelle ni changée ; aucune donnée lue, écrite ni retirée.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : deux contraintes — remplacées, ou
-- reprises par la garde — et une signature de fonction, recréée aussitôt. Aucune ligne.
--
-- Les refus de chaque fonction, dans leur ordre, sont dans l'en-tête de chacune ; sous le code de leur famille (42501
-- l'accès, P0002 l'introuvable, 22023 le reste, 23514 dans les déclencheurs). src/lib/encaissementsFactures.ts les redit
-- avant le clic, dans le même ordre et sous les mêmes mots.

-- ══ 0. La première migration de l'étape d'abord ══════════

do $$
begin
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.factures_emises'::regclass and attname = 'source_de_la_vente' and not attisdropped) then
    raise exception 'La migration source_de_la_vente (étape VF2) précède celle-ci : la source de la vente n''est pas en base.';
  end if;
end
$$;

-- ══ 1. Le mouvement classé par ses encaissements : G1 ══════════

alter table public.lignes_bancaires add column encaissements_de_factures boolean not null default false;

comment on column public.lignes_bancaires.encaissements_de_factures is
  'Mouvement que le cabinet a classé par les encaissements de factures sources qui le citent (chantier EC-Q3) : ce qu''ils portent fait son montant, à l''écart des frais près. Exclusif de tout autre lien (lignes_bancaires_un_seul_rapprochement), sur un mouvement rapproché et jamais personnel (lignes_bancaires_encaissements_rapproches). Posé par classer_mouvement_par_encaissements, retiré par retirer_classement_par_encaissements.';

alter table public.lignes_bancaires drop constraint lignes_bancaires_un_seul_rapprochement;
alter table public.lignes_bancaires add constraint lignes_bancaires_un_seul_rapprochement
  check (num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id,
                      nullif(ventilee, false), nullif(reglement_groupe, false), nullif(encaissements_de_factures, false)) <= 1);

alter table public.lignes_bancaires add constraint lignes_bancaires_encaissements_rapproches
  check (not encaissements_de_factures or (statut = 'rapprochee' and not prelevement_personnel));

-- Un mouvement LIBRE : ni classé, ni écarté, ni personnel — le seul qu'un encaissement d'une facture source cite.
create function public.mouvement_libre(p_ligne public.lignes_bancaires) returns boolean
language sql
immutable
set search_path = public
as $$
  select p_ligne.statut = 'non_rapprochee'
     and num_nonnulls(p_ligne.piece_id, p_ligne.cotisation_id, p_ligne.categorie_id, p_ligne.emprunt_id,
                      p_ligne.compte_bilan, p_ligne.declaration_tva_id, nullif(p_ligne.ventilee, false),
                      nullif(p_ligne.reglement_groupe, false), nullif(p_ligne.prelevement_personnel, false),
                      nullif(p_ligne.encaissements_de_factures, false)) = 0
$$;

-- CE QU'UN MOUVEMENT JUSTIFIE. Un encaissement justifie le mouvement qu'il cite tant qu'aucune contre-passation vivante
-- SANS MOUVEMENT ne l'annule : celle-là dit que l'encaissement n'a pas eu lieu sur ce mouvement — une erreur, une somme
-- jamais reçue. Une contre-passation qui cite un DÉBIT dit au contraire que l'argent est venu, puis reparti (le chèque
-- revenu impayé) : l'encaissement reste justifié par son crédit, et la contre-passation par son débit. Une
-- contre-passation justifie toujours le débit qu'elle cite. Pour une facture qui n'est pas source, aucune
-- contre-passation ne cite de mouvement : le prédicat dit exactement ce que disaient hier les fonctions des encaissements
-- (« annulé par une contre-passation vivante »).
create function public.encaissement_justifie_son_mouvement(p_encaissement_id uuid) returns boolean
language sql
stable
set search_path = public
as $$
  select not exists (select 1 from public.encaissements_factures c
                      where c.annule_id = p_encaissement_id and c.retire_le is null and c.ligne_bancaire_id is null)
$$;

-- ══ 2. Le mouvement réservé : G2, la garde des mouvements ══════════
-- Un mouvement ne naît pas classé par des encaissements (sauf restauré par le super-administrateur, après quoi ses
-- encaissements suivent) ; son drapeau ne change que sous le réglage que posent les deux fonctions du cabinet pour lui.
-- Un mouvement qu'un encaissement non retiré d'une facture source cite ne reçoit aucun autre classement : la garde ne
-- juge que le changement de classement, jamais une mise à jour qui n'en change rien. Elle passe après celle de la
-- validation (`lignes_bancaires_figees_par_la_validation`, que l'ordre des noms fait passer d'abord).
create function public.garder_mouvement_reserve() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
begin
  if tg_op = 'INSERT' then
    if new.encaissements_de_factures and not public.is_super_admin() then
      raise exception 'Un mouvement ne naît pas classé par des encaissements : le cabinet l''y classe ensuite, par sa fonction.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.encaissements_de_factures is distinct from old.encaissements_de_factures
     and coalesce(current_setting('jd.classement_encaissements', true), '') is distinct from old.id::text then
    raise exception 'Un mouvement ne se classe par ses encaissements, et ne cesse de l''être, que par la fonction du cabinet.'
      using errcode = '42501';
  end if;
  if (old.statut, old.piece_id, old.cotisation_id, old.categorie_id, old.emprunt_id, old.compte_bilan,
      old.declaration_tva_id, old.ventilee, old.reglement_groupe, old.prelevement_personnel)
     is not distinct from
     (new.statut, new.piece_id, new.cotisation_id, new.categorie_id, new.emprunt_id, new.compte_bilan,
      new.declaration_tva_id, new.ventilee, new.reglement_groupe, new.prelevement_personnel) then
    return new;
  end if;
  -- Classé par ses encaissements, il ne reçoit rien d'autre (la contrainte du seul rapprochement le tient aussi : ce
  -- refus le dit avec ses mots, avant elle, à qui classerait le mouvement par une autre fonction du relevé).
  if old.encaissements_de_factures and new.encaissements_de_factures then
    raise exception 'Ce mouvement est classé par ses encaissements : il ne reçoit aucun autre classement — le cabinet retire d''abord celui-ci.'
      using errcode = '23514';
  end if;
  if new.encaissements_de_factures or public.mouvement_libre(new) then
    return new;
  end if;
  select f.numero into v_numero
    from public.encaissements_factures e
    join public.factures_emises f on f.id = e.facture_id
   where e.ligne_bancaire_id = new.id and e.retire_le is null and f.source_de_la_vente
     and public.encaissement_justifie_son_mouvement(e.id)
   order by e.cree_le, e.id
   limit 1;
  if found then
    raise exception 'Ce mouvement justifie un encaissement de la facture %, source de sa vente : il se classe par ses encaissements, et par rien d''autre.',
      v_numero using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger lignes_bancaires_reservees_aux_encaissements
  before insert or update on public.lignes_bancaires
  for each row execute function public.garder_mouvement_reserve();

-- ══ 3. La garde des encaissements ══════════
-- Reprise de la migration encaissements_des_factures au caractère près pour ce qui ne change pas. S'ajoutent :
--   - la règle de la contrainte retirée, élargie : une contre-passation ne cite un mouvement que pour une facture source,
--     et c'est un DÉBIT de son dossier ; un encaissement, un CRÉDIT, comme hier ;
--   - pour une facture source, un mouvement déjà classé autrement que par ses encaissements ne se cite pas (G2) ;
--   - le RATTACHEMENT : `ligne_bancaire_id` passe une fois de nul à un mouvement, sous le réglage
--     `jd.rattachement_encaissement` que `rattacher_mouvement_encaissement` pose pour CET encaissement, avec les mêmes
--     règles qu'à l'insertion ; tout autre changement se refuse, sous les mots d'hier.
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
    v_ligne := new;
  else
    v_rattachement := old.ligne_bancaire_id is null and new.ligne_bancaire_id is not null
      and coalesce(current_setting('jd.rattachement_encaissement', true), '') = old.id::text;
    if (to_jsonb(new) - array['retire_le', 'retire_par', 'ligne_bancaire_id'])
         is distinct from (to_jsonb(old) - array['retire_le', 'retire_par', 'ligne_bancaire_id'])
       or new.ligne_bancaire_id is distinct from old.ligne_bancaire_id and not v_rattachement
       or v_rattachement and (old.retire_le is not null
                              or (new.retire_le, new.retire_par) is distinct from (old.retire_le, old.retire_par))
       or old.retire_le is not null and (new.retire_le, new.retire_par) is distinct from (old.retire_le, old.retire_par)
       or new.retire_le is null and new.retire_par is distinct from old.retire_par then
      raise exception 'Un encaissement ne se modifie pas : jamais déclaré, il se retire, une fois ; déclaré, il se contre-passe.'
        using errcode = '23514';
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
  end if;
  return new;
end
$$;

alter table public.encaissements_factures drop constraint encaissements_factures_annulation_sans_mouvement;

-- ══ 4. Enregistrer un encaissement ══════════
-- Reprise de la migration ventes_du_client au caractère près, et, POUR UNE FACTURE SOURCE, deux refus de plus et deux
-- plafonds nets. Les refus, dans l'ordre (le module d2 les redit dans celui-ci, la liste REFUS_ENREGISTREMENT) :
--   1. l'accès ; 2. le mouvement sans le droit « Banque » ; 3. la facture introuvable ; 4. un brouillon ; 5. un avoir ;
--   6. rejetée ou refusée ; 7. des lignes qui ne redonnent pas l'en-tête ; 8 à 10. la date (renseignée, pas avant 2000,
--   pas dans l'avenir) ; 11. SOURCE : une date que la frontière d'un exercice validé fige ; 12 et 13. le montant
--   (positif, au centime) ; 14. le moyen ; 15. le mouvement d'un autre dossier ; 16. un débit ; 17. SOURCE : un
--   mouvement déjà classé — par ses encaissements compris : le cabinet retire d'abord ce classement ; 18. le mouvement
--   qui justifie déjà un encaissement de cette facture ; 19. l'écart des frais ; 20 à 25. la répartition (lisible, taux
--   unique, de la facture, admis, parts positives, leur somme) ; 26. le plafond de la facture, ou 27. SOURCE : le même,
--   NET de ses avoirs validés ; 28. le plafond d'un taux, ou 29. SOURCE : le même, net des avoirs.
-- Pour une facture qui n'est pas source, aucun refus neuf ne s'interpose, et les plafonds sont ceux d'hier.
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

-- ══ 5. Retirer un encaissement que rien n'a déclaré ══════════
-- Reprise de la migration ventes_du_client, et, POUR UNE FACTURE SOURCE, deux refus de plus. Dans l'ordre : 1. l'accès ;
-- 2. l'encaissement introuvable ; 3. déjà retiré ; 4. déclaré ; 5. annulé par une contre-passation vivante ;
-- 6. SOURCE : daté d'un exercice que la frontière fige ; 7. SOURCE : le mouvement dont il dépend — le sien, ou, pour une
-- contre-passation sans mouvement, celui de l'encaissement qu'elle annule — classé : par ses encaissements, le retrait
-- changerait ce qu'il justifie ; autrement (après une contre-passation sans mouvement, qui l'a libéré), le retrait de
-- celle-ci le ferait justifier de nouveau l'encaissement, en plus de son classement. La garde des encaissements tient
-- la même règle, en 23514, pour qui écrirait sans la fonction.
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
  end if;
  update public.encaissements_factures
     set retire_le = now(), retire_par = auth.uid()
   where id = p_encaissement_id
  returning * into v_encaissement;
  return v_encaissement;
end
$$;

-- ══ 6. Contre-passer un encaissement déclaré ══════════
-- La signature change : un cinquième paramètre, le DÉBIT que cite une contre-passation qui défait de l'argent, nul par
-- défaut — l'appel à quatre paramètres d'hier fait exactement ce qu'il faisait. L'ancienne fonction est retirée, la
-- nouvelle reprend ses droits et son commentaire. Reprise de la migration ventes_du_client pour le reste. Dans l'ordre :
--   1. l'accès ; 2. l'encaissement introuvable ; 3. une contre-passation ; 4. retiré ; 5. non déclaré ; 6. une
--   déclaration d'issue inconnue ; 7. déjà contre-passé ; 8 à 10. la date (renseignée, pas avant l'encaissement, pas
--   dans l'avenir) ; 11. SOURCE : une date que la frontière d'un exercice validé fige ; 12 et 13. le motif (renseigné,
--   2 000 caractères au plus) ; puis, s'il cite un mouvement : 14. une facture qui n'est pas source ; 15. un mouvement
--   d'un autre dossier ; 16. un crédit ; 17. un mouvement déjà classé ; 18. des contre-passations qui le dépasseraient au
--   delà des frais ; et sans mouvement : 19. SOURCE : le mouvement de l'encaissement contre-passé, classé par ses
--   encaissements — la contre-passation changerait ce qu'ils portent.
drop function public.annuler_encaissement(uuid, uuid, date, text);

create function public.annuler_encaissement(
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

-- ══ 7. Rattacher un encaissement à son mouvement, une fois ══════════
-- Le cabinet seul (`admin_du_dossier`) : le mouvement qu'un client désigne est réservé et proposé, jamais classé par lui
-- (EC3-Q4) ; celui qu'il n'a pas désigné, le cabinet le rattache. Pour un encaissement d'une facture source enregistré
-- sans mouvement — le chèque remis avant son crédit, l'espèce versée ensuite, l'encaissement d'un client sans « Banque »
-- —, ou une contre-passation sans débit. Une fois, de nul à un mouvement : la garde n'admet que ce changement, sous le
-- réglage posé pour CET encaissement et retiré aussitôt. Sous le verrou de la facture, de l'encaissement puis du
-- mouvement. Dans l'ordre :
--   1. l'accès ; 2. l'encaissement introuvable ; 3. retiré ; 4. qui cite déjà un mouvement ; 5. d'une facture qui n'est
--   pas source ; 6. daté d'un exercice que la frontière fige ; 7. aucun mouvement désigné ; 8. un mouvement d'un autre
--   dossier ; 9. un débit pour un encaissement, 10. un crédit pour une contre-passation ; 11. un mouvement déjà classé ;
--   12. pour un encaissement, un mouvement qui justifie déjà un encaissement de cette facture ; 13. l'écart des frais,
--   sur les encaissements (14 : sur les contre-passations) que le mouvement justifierait ; pour une contre-passation,
--   15. le mouvement de l'encaissement qu'elle annule classé, 16. ou qu'il justifierait alors au-delà des frais —
--   rattachée à son débit, elle cesse de dire que l'encaissement n'a pas eu lieu sur ce mouvement, qui le justifie de
--   nouveau (`encaissement_justifie_son_mouvement`).
create function public.rattacher_mouvement_encaissement(
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
  if v_frontiere is not null and v_encaissement.date_encaissement <= v_frontiere then
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

-- ══ 8. Classer un mouvement par ses encaissements, et retirer ce classement ══════════
-- Le cabinet seul. Ce que le mouvement justifie des encaissements de factures sources qui le citent, non retirés — un
-- encaissement pour son montant, sauf si une contre-passation sans mouvement l'annule (`encaissement_justifie_son_
-- mouvement`) ; une contre-passation, pour le sien — fait son montant à l'écart des frais près : la banque crédite un
-- peu moins que les encaissements, ou débite un peu plus que les contre-passations (le 627 de l'étape VF4), jamais
-- l'inverse — l'excédent d'un mouvement, un trop-perçu, reste à traiter (§ 5, hors du chantier). Les encaissements des
-- factures qui ne sont pas sources n'y comptent pas : leurs ventes se comptent par leurs pièces. Dans l'ordre :
--   1. l'accès ; 2. le mouvement introuvable ; 3. daté d'un exercice que la frontière fige ; 4. déjà classé par ses
--   encaissements ; 5. classé autrement ; 6. qui ne justifie aucun encaissement d'une facture source ; 7. un crédit que ses
--   encaissements ne font pas, 8. ou qu'ils dépassent au-delà des frais ; 9. un débit que ses contre-passations
--   dépassent, 10. ou qu'elles ne font pas à l'écart des frais près.
create function public.classer_mouvement_par_encaissements(p_dossier_id uuid, p_ligne_bancaire_id uuid)
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
  select coalesce(sum(e.montant), 0) into v_porte
    from public.encaissements_factures e
    join public.factures_emises f on f.id = e.facture_id
   where e.ligne_bancaire_id = p_ligne_bancaire_id and e.retire_le is null and f.source_de_la_vente
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

-- Dans l'ordre : 1. l'accès ; 2. le mouvement introuvable ; 3. daté d'un exercice que la frontière fige ; 4. qui n'est
-- pas classé par ses encaissements. Le mouvement redevient à traiter ; ses encaissements le citent toujours : il reste
-- réservé (G2).
create function public.retirer_classement_par_encaissements(p_dossier_id uuid, p_ligne_bancaire_id uuid)
returns public.lignes_bancaires
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mouvement public.lignes_bancaires;
  v_frontiere date;
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
  if not v_mouvement.encaissements_de_factures then
    raise exception 'Ce mouvement n''est pas classé par ses encaissements.' using errcode = '22023';
  end if;

  perform set_config('jd.classement_encaissements', p_ligne_bancaire_id::text, true);
  update public.lignes_bancaires
     set encaissements_de_factures = false, statut = 'non_rapprochee'
   where id = p_ligne_bancaire_id
  returning * into v_mouvement;
  perform set_config('jd.classement_encaissements', '', true);
  return v_mouvement;
end
$$;

-- ══ 9. Les droits d'exécution ══════════
-- Les quatre fonctions qui écrivent vérifient l'accès elles-mêmes, et un anonyme n'a rien à y faire. La garde des
-- mouvements et le prédicat de ce qu'un mouvement justifie ne servent qu'aux déclencheurs et aux fonctions : personne ne
-- les appelle en RPC.
revoke execute on function public.annuler_encaissement(uuid, uuid, date, text, uuid) from public, anon;
grant execute on function public.annuler_encaissement(uuid, uuid, date, text, uuid) to authenticated;
revoke execute on function public.rattacher_mouvement_encaissement(uuid, uuid, uuid) from public, anon;
grant execute on function public.rattacher_mouvement_encaissement(uuid, uuid, uuid) to authenticated;
revoke execute on function public.classer_mouvement_par_encaissements(uuid, uuid) from public, anon;
grant execute on function public.classer_mouvement_par_encaissements(uuid, uuid) to authenticated;
revoke execute on function public.retirer_classement_par_encaissements(uuid, uuid) from public, anon;
grant execute on function public.retirer_classement_par_encaissements(uuid, uuid) to authenticated;
revoke execute on function public.garder_mouvement_reserve() from public, anon, authenticated;
-- Le prédicat du mouvement libre ne lit rien : il juge la ligne qu'on lui passe. La garde des encaissements, qui s'exécute
-- aux droits de l'appelant (la restauration du super-administrateur), l'appelle : le compte connecté l'exécute.
revoke execute on function public.mouvement_libre(public.lignes_bancaires) from public, anon;
grant execute on function public.mouvement_libre(public.lignes_bancaires) to authenticated;
revoke execute on function public.encaissement_justifie_son_mouvement(uuid) from public, anon, authenticated;

comment on function public.annuler_encaissement(uuid, uuid, date, text, uuid) is
  'Contre-passe un encaissement déclaré : montant et répartition opposés, même moyen, motif, datée du décaissement ; pour une facture source, elle peut citer le débit qui défait l''encaissement. La contre-passation se déclare à son tour.';
comment on function public.rattacher_mouvement_encaissement(uuid, uuid, uuid) is
  'Rattache une fois, de nul à un mouvement, l''encaissement (un crédit) ou la contre-passation (un débit) d''une facture source enregistré sans mouvement ; le cabinet seul.';
comment on function public.classer_mouvement_par_encaissements(uuid, uuid) is
  'Classe un mouvement par les encaissements de factures sources qui le citent, quand ce qu''ils portent fait son montant à l''écart des frais près ; le cabinet seul.';
comment on function public.retirer_classement_par_encaissements(uuid, uuid) is
  'Retire le classement d''un mouvement par ses encaissements : il redevient à traiter, toujours réservé à eux ; le cabinet seul.';
comment on function public.garder_mouvement_reserve() is
  'G2 : un mouvement qu''un encaissement non retiré d''une facture source cite ne reçoit aucun autre classement ; le drapeau encaissements_de_factures ne change que par les deux fonctions du cabinet, ou à la restauration.';
comment on function public.mouvement_libre(public.lignes_bancaires) is
  'Un mouvement ni classé, ni écarté, ni personnel : le seul qu''un encaissement d''une facture source cite.';
comment on function public.encaissement_justifie_son_mouvement(uuid) is
  'Un encaissement justifie le mouvement qu''il cite tant qu''aucune contre-passation vivante sans mouvement ne l''annule ; une contre-passation qui cite un débit le laisse justifié par son crédit.';
