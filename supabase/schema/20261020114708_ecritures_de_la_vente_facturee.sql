-- LES ÉCRITURES D'UNE VENTE FACTURÉE, EN BASE (chantier EC-Q3, ligne 28.6, étape VF4b ; après les deux migrations de VF2,
-- `source_de_la_vente` et `encaissements_de_la_vente_facturee`, qu'elle exige). Conception : HISTORIQUE.md, « LA FACTURE
-- VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », § 5, 6, 7, 11 et 14 ; la composition que la base refait ici est celle du
-- module pur de VF4a, src/lib/ecrituresVentesFacturees.ts (« LES ÉCRITURES D'UNE VENTE FACTURÉE, EN MODULE »), sur la règle
-- du cumul de src/lib/ventesFacturees.ts (VF3a). Questions bâties sur leur recommandation : VF3-Q1 (la règle du cumul) et
-- VF4A-Q2 (le compte de contrepartie, une colonne de l'encaissement, choisie par le cabinet).
--
-- CE QUI NAÎT ICI, ET RIEN D'AUTRE :
--   1. `ecrire_vente_facturee(dossier, source, identifiant, lignes)` — le cabinet seul : écrit les écritures d'UNE source
--      (une facture, un avoir, un encaissement — ou sa contre-passation —, un mouvement que des encaissements citent) telles
--      que l'application les a composées, après les avoir RECOMPOSÉES en entiers depuis les lignes de la base (la facture et
--      ses lignes, ses avoirs, le registre des encaissements et ses parts, le mouvement, le compte de contrepartie, le plan
--      du dossier par `compte_du_role`) et comparées en multiensemble — date, compte, sens, centimes, mouvement ; le libellé
--      n'en décide pas. Elle REMPLACE d'un tenant les écritures proposées de la même source, et refuse d'écrire ce qu'elle
--      ne retrouve pas. LA SOURCE ET SES DATES : une source se désigne par son genre et son identifiant, et ses lignes
--      portent chacune leur date — une facture peut porter deux écritures (son émission en engagement, la TVA de la
--      livraison d'un bien à une autre date), qui se remplacent ENSEMBLE : un avoir validé ensuite peut faire disparaître
--      l'une d'elles, et une source écrite date par date garderait une écriture que plus rien ne porte. Ce qu'un exercice
--      validé fige (au plus tard le 31 décembre de son dernier exercice validé) ne se compare ni ne s'écrit plus : une
--      ligne proposée à cette date se refuse, et la recomposition n'en garde que ce qui suit la frontière — une facture dont
--      l'émission est dans un exercice validé et la livraison dans le suivant se réécrit encore pour sa livraison.
--   2. `retirer_ecriture_vente_facturee(dossier, source, identifiant)` — le cabinet seul : retire les écritures proposées
--      d'une source qui n'a plus rien à écrire (un encaissement retiré, un mouvement déclassé, une vente écartée…) ;
--      refusée tant que la base recompose quelque chose pour elle, pour des écritures validées, pour un mouvement classé
--      autrement que par ses encaissements, dont les lignes sans pièce sont celles de cet autre classement, et pour un
--      mouvement qu'aucun encaissement d'une facture source n'a jamais cité.
--   3. LA RÈGLE DU CUMUL, EN ENTIERS (`prorata_arrondi`, `calcul_vente_facturee`) : pour un taux, V et T la TVA et le TTC de
--      la facture nets de ses avoirs datés au plus tard du jour de l'encaissement, P le cumul net de ses encaissements à ce
--      jour ; la TVA cumulée vaut V × P / T arrondie au centime, le demi loin de zéro, et chaque encaissement prend la
--      différence ; une contre-passation porte l'exact opposé de son encaissement. Le calcul de `ventesFacturees`, ligne à
--      ligne, confronté à une table que le module relève (supabase/essais/ecrituresVentesFacturees.sql).
--   4. G5, LA GARDE DES ÉCRITURES D'UNE VENTE FACTURÉE (`garder_lignes_de_la_vente_facturee`) : les trois genres — une
--      écriture qui porte une facture ou un avoir (`facture_id`), un encaissement (`encaissement_id`), ou les lignes d'un
--      mouvement classé par ses encaissements, qui ne portent ni l'une ni l'autre — ne s'insèrent, ne se modifient ni ne se
--      retirent que par ces deux fonctions, sous le réglage `jd.ecriture_vente_facturee` qu'elles posent POUR LA SOURCE
--      qu'elles écrivent ; la restauration du super-administrateur les réinsère ; la validation d'un exercice les numérote ;
--      la suppression d'un dossier les emporte. La garde de VF2 (`garder_ecriture_vente_facturee`) garde toujours les deux
--      colonnes ; celle-ci garde les lignes. Les autres chemins qui écrivent sur un mouvement (le rapprochement d'une pièce,
--      l'affectation, la ventilation, le compte de bilan, le virement personnel, l'emprunt, la cotisation, le règlement
--      groupé, la déclaration de TVA) ne changent pas sur un mouvement classé par ses encaissements : G1 et G2 les refusent
--      déjà avant toute écriture. Sur un mouvement que rien ne classe, ils passent comme hier, SAUF quand il porte encore
--      les lignes d'une vente facturée dont il n'est pas la source : la banque d'un encaissement du même jour (512 au débit,
--      ce mouvement, cet encaissement), et celle de sa contre-passation sans mouvement, qui le défait là où il a été écrit
--      ([T]). Le mouvement déclassé (`retirer_classement_par_encaissements`), puis l'encaissement contre-passé sans
--      mouvement, celui-ci ne justifie plus son mouvement, que G2 libère pour un autre classement ; ses lignes et celles de
--      sa contre-passation y restent, légitimement, puisque la base les recompose encore. Le mouvement déclassé, puis
--      l'encaissement retiré, ses lignes y restent, périmées, jusqu'à `retirer_ecriture_vente_facturee`. Les dix-huit
--      fonctions du relevé qui classent ou déclassent un mouvement suppriment d'abord ses lignes sans pièce (quinze, `where
--      ligne_bancaire_id = M and piece_id is null`), ou toutes ses lignes (le règlement groupé et son retrait), ou celles
--      des mouvements d'une déclaration (son retrait) : elles touchent ces lignes, et G5 lève 42501. Le geste échoue
--      FERMÉ — entier, rien d'écrit ni de retiré —, mais le mouvement ne se classe plus tant que ces lignes y sont (jusqu'à
--      leur retrait pour un encaissement retiré ; jamais, pour un encaissement contre-passé, tant qu'il compte). Le
--      rapprochement d'une pièce, que le navigateur écrit, ne supprime rien en se posant : il passe, ses lignes à côté de
--      celles-là ; son retrait EN ENGAGEMENT (`retirerContrepartieBanque`, qui supprime toutes les lignes du mouvement)
--      bute sur G5 APRÈS que le mouvement a été délié — deux requêtes — : le règlement de la pièce reste au brouillon, et
--      l'écran le dit. Ce qui lèvera l'un et l'autre, dans un lot à part, avant toute bascule : aligner ces dix-neuf
--      suppressions sur les lignes propres au mouvement, toutes colonnes de source nulles, comme le retrait d'un mouvement
--      ici (section 5) — jamais une ligne qui porte une facture ou un encaissement. Éprouvé : ecrituresVentesFacturees.sql,
--      contrôles 95 et 96 ; la suppression directe, sur la réplique seulement.
--   5. LE COMPTE DE CONTREPARTIE D'UN ENCAISSEMENT (VF4A-Q2) : `encaissements_factures.compte_contrepartie`, le compte de
--      bilan sur lequel s'écrit un encaissement par compensation, ou par un autre moyen, qui ne cite aucun mouvement ; posé
--      par le cabinet seul, par `choisir_compte_contrepartie`, sous les règles de `refusCompteDeContrepartie`
--      (`refus_compte_de_contrepartie`) ; la garde des encaissements ne le laisse changer que sous le réglage
--      `jd.contrepartie_encaissement` que la fonction pose pour CET encaissement, et naître posé qu'à la restauration.
--      ÉLARGIT CE QUE LE CLIENT « VENTES » LIT : sa policy de lecture des encaissements ouvre la ligne entière, compte compris
--      (présenté au cabinet avec la migration).
--
-- Les refus de chaque fonction, dans leur ordre, sont dans l'en-tête de chacune, sous le code de leur famille (42501
-- l'accès, P0002 l'introuvable, 22023 le reste ; 42501 dans les gardes). src/lib/ecritureVenteFacturee.ts les redit avant le
-- clic, dans le même ordre et sous les mêmes mots.
--
-- NEUTRE : aucun dossier n'a basculé ; les fonctions n'ont rien à écrire et le disent ; la garde ne refuse rien d'une
-- écriture qui ne porte ni facture, ni encaissement, ni un mouvement classé par ses encaissements — et aucun mouvement ne
-- l'est. Aucune policy nouvelle ni changée ; aucune donnée écrite, lue de plus ni retirée.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : aucune donnée, aucun objet. Deux corps de
-- fonction suppriment les écritures proposées de la source qu'ils remplacent ou retirent, et le déclencheur de la garde
-- veille aussi sur la suppression d'une écriture : le texte se colle dans l'éditeur SQL, avec sa ligne d'historique.
--
-- CE QUI CONTOURNE LA RLS, ET POURQUOI : les trois fonctions du cabinet lisent la facture, le registre, le mouvement et le
-- plan quoi qu'en voie l'appelant (`security definer`, chemin fixé), APRÈS avoir jugé l'accès (`admin_du_dossier`) et
-- avant toute autre lecture ; les quatre aides et les deux gardes ne s'appellent pas en RPC.
--
-- CONCURRENCE : sous le verrou PARTAGÉ de la validation des exercices (`cle_validation`), comme toute écriture au brouillon,
-- et sous celui de la facture (ou du mouvement) dont la source dépend — celui que prennent l'enregistrement, le retrait, la
-- contre-passation et le rattachement d'un encaissement : une écriture ne se compose pas pendant que son registre change.
-- Pour un avoir, la facture d'abord, puis l'avoir : l'ordre d'`enregistrer_facture`, qui verrouille la facture avant de lui
-- créer un avoir ; aucune fonction ne prend un avoir avant sa facture.

-- ══ 0. Les migrations de VF2 d'abord ══════════

do $$
begin
  if to_regprocedure('public.classer_mouvement_par_encaissements(uuid, uuid)') is null
     or not exists (select 1 from pg_attribute
                     where attrelid = 'public.ecritures_brouillon'::regclass and attname = 'encaissement_id' and not attisdropped) then
    raise exception 'Les migrations de l''étape VF2 (source_de_la_vente, encaissements_de_la_vente_facturee) précèdent celle-ci : elles ne sont pas en base.';
  end if;
end
$$;

-- ══ 1. Le compte de contrepartie d'un encaissement ══════════

alter table public.encaissements_factures add column compte_contrepartie text
  constraint encaissements_factures_compte_contrepartie check (compte_contrepartie ~ '^[1-5][0-9]{5,9}$');

comment on column public.encaissements_factures.compte_contrepartie is
  'Le compte de bilan sur lequel s''écrit un encaissement par compensation, ou par un autre moyen, qui ne cite aucun mouvement (VF4A-Q2) : choisi par le cabinet seul (choisir_compte_contrepartie), sous les règles de refus_compte_de_contrepartie ; nul tant qu''il ne l''a pas choisi, et l''encaissement ne s''écrit pas.';

-- Ce qu'un compte de contrepartie ne peut pas être, nul quand il le peut : les règles de `refusCompteDeContrepartie`
-- (src/lib/ecrituresVentesFacturees.ts), dans son ordre et sous ses mots — un compte de bilan de classe 1 à 5, à la forme
-- des comptes de l'application ; ni le compte des clients, que l'encaissement solde ; ni un compte de trésorerie du plan,
-- qu'un moyen de paiement choisit déjà ; ni un compte de TVA. Chaque compte est celui du plan du dossier.
create function public.refus_compte_de_contrepartie(p_dossier_id uuid, p_compte text) returns text
language plpgsql
stable
set search_path = public
as $$
begin
  if coalesce(p_compte, '') !~ '^[1-5][0-9]{5,9}$' then
    return 'Un compte de contrepartie est un compte de bilan, de classe 1 à 5, de six à dix chiffres.';
  end if;
  if p_compte = public.compte_du_role(p_dossier_id, 'clients') then
    return 'Le compte des clients est celui que l’encaissement solde : il n’en est pas la contrepartie.';
  end if;
  if p_compte in (public.compte_du_role(p_dossier_id, 'banque'), public.compte_du_role(p_dossier_id, 'valeurs_a_l_encaissement'),
                  public.compte_du_role(p_dossier_id, 'caisse')) then
    return 'Un encaissement par la banque, par chèque ou en espèces se dit par son moyen de paiement, qui choisit son compte.';
  end if;
  if p_compte like '445%' then
    return 'Un compte de TVA ne reçoit pas un encaissement : la TVA d’une vente s’écrit avec elle.';
  end if;
  return null;
end
$$;

-- La garde des encaissements, reprise de la migration encaissements_de_la_vente_facturee au caractère près, et deux
-- choses de plus pour le compte de contrepartie : il ne naît posé qu'à la restauration du super-administrateur, et ne
-- change que sous le réglage `jd.contrepartie_encaissement` que `choisir_compte_contrepartie` pose pour CET encaissement —
-- les deux refus viennent après ceux d'hier, qui gardent leurs mots.
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

-- Choisir le compte de contrepartie d'un encaissement — le cabinet seul (`admin_du_dossier`) : le client « Ventes »
-- enregistre ses encaissements, il ne choisit pas de compte. Sous le verrou de la facture, puis de l'encaissement. Dans
-- l'ordre :
--   1. l'accès ; 2. l'encaissement introuvable dans ce dossier ; 3. retiré ; 4. une contre-passation (elle s'écrit sur le
--   compte de l'encaissement qu'elle annule) ; 5. d'une facture qui n'est pas source ; 6. daté d'un exercice que la
--   frontière fige ; 7. qui cite un mouvement ; 8. d'un autre moyen que la compensation ou « autre » ; 9. aucun compte ;
--   10. un compte que `refus_compte_de_contrepartie` refuse, sous ses mots. Choisi de nouveau, il se remplace : l'écriture
--   de l'encaissement, si elle est écrite, est alors à réécrire.
create function public.choisir_compte_contrepartie(p_dossier_id uuid, p_encaissement_id uuid, p_compte text)
returns public.encaissements_factures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_encaissement public.encaissements_factures;
  v_source boolean;
  v_frontiere date;
  v_refus text;
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
    raise exception 'Cet encaissement est retiré : il ne s''écrit pas, et ne reçoit pas de compte de contrepartie.'
      using errcode = '22023';
  end if;
  if v_encaissement.annule_id is not null then
    raise exception 'Une contre-passation s''écrit sur le compte de l''encaissement qu''elle annule : elle ne reçoit pas de compte de contrepartie.'
      using errcode = '22023';
  end if;
  if not v_source then
    raise exception 'Seul l''encaissement d''une facture source de sa vente s''écrit dans l''application : celui-ci ne reçoit pas de compte de contrepartie.'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_encaissement.date_encaissement <= v_frontiere then
    raise exception '% : le compte de contrepartie de cet encaissement ne change plus.',
      public.exercice_fige(p_dossier_id, extract(year from v_encaissement.date_encaissement)::integer) using errcode = '22023';
  end if;
  if v_encaissement.ligne_bancaire_id is not null then
    raise exception 'Cet encaissement cite un mouvement : il s''écrit par lui, sur la banque ou sur les valeurs à l''encaissement, jamais sur un compte de contrepartie.'
      using errcode = '22023';
  end if;
  if v_encaissement.moyen not in ('compensation', 'autre') then
    raise exception 'Seul un encaissement par compensation, ou par un autre moyen, s''écrit sur un compte de contrepartie : celui-ci se dit par son moyen de paiement.'
      using errcode = '22023';
  end if;
  if p_compte is null then
    raise exception 'Le compte de contrepartie est à choisir.' using errcode = '22023';
  end if;
  v_refus := public.refus_compte_de_contrepartie(p_dossier_id, p_compte);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  perform set_config('jd.contrepartie_encaissement', p_encaissement_id::text, true);
  update public.encaissements_factures
     set compte_contrepartie = p_compte
   where id = p_encaissement_id
  returning * into v_encaissement;
  perform set_config('jd.contrepartie_encaissement', '', true);
  return v_encaissement;
end
$$;

-- ══ 2. La règle du cumul, en entiers ══════════

-- V × P / T arrondi au centime, le demi loin de zéro (`prorataArrondi` de src/lib/ventesFacturees.ts) : en `numeric`, le
-- produit de deux montants de dix mille milliards d'euros en centimes ne déborde pas, et `div` rend le quotient entier
-- EXACT — une division `numeric` arrondit au-delà de seize chiffres significatifs, et un quotient de 3,99999999999999995
-- y deviendrait 4. T est positif (l'appelant écarte la facture sinon).
create function public.prorata_arrondi(p_v bigint, p_p bigint, p_t bigint) returns bigint
language sql
immutable
set search_path = public
as $$
  select (sign(p_v::numeric * p_p) * div(2 * abs(p_v::numeric * p_p) + p_t, 2 * p_t::numeric))::bigint
$$;

-- CE QU'UNE FACTURE SOURCE PÈSE, ligne à ligne (`ventesFacturees`, src/lib/ventesFacturees.ts) : ses PARTS — chaque
-- encaissement compté, par taux, son TTC (le registre), sa TVA par la règle du cumul et son hors-taxe, à sa date — ; ses
-- EXIGIBILITÉS — ce que la CA3 compte, et le compte 44571 avec elle : les parts pour des services ; pour un bien (à sa
-- livraison) ou des services sur l'option pour les débits (à la date de la facture), les parts d'avant ce fait générateur,
-- ce qui reste de la facture nette de ses avoirs à ce jour, puis les avoirs d'après à leur date — ; ses DOCUMENTS — la
-- facture et ses avoirs à leur date d'émission, pour l'engagement. Ou UNE ligne `ecartee` et son motif, quand on ne sait
-- pas la compter sans deviner : la nature ou l'option manquent, elle n'a pas de ligne, un encaissement ne se répartit pas
-- sur ses taux au centime, une contre-passation n'est pas l'opposé d'un encaissement compté avant elle, ou ses avoirs
-- annulent le taux d'un encaissement. Rien pour une facture qui n'est pas une facture validée source.
create function public.calcul_vente_facturee(p_facture_id uuid)
returns table (genre text, motif text, encaissement_id uuid, annule_id uuid, avoir_id uuid, origine text, date_effet date,
               moyen text, ligne_bancaire_id uuid, taux numeric, ttc_centimes bigint, base_centimes bigint, tva_centimes bigint)
language plpgsql
stable
set search_path = public
as $$
declare
  v_facture public.factures_emises;
  v_regime text;
  v_motif text;
  v_fait date;
  v_e public.encaissements_factures;
  v_part record;
  v_cle text;
  v_p bigint;
  v_montant bigint;
  v_somme bigint;
  v_cumul bigint;
  v_deja bigint;
  v_v bigint;
  v_t bigint;
  v_tva bigint;
  v_tva_avant bigint;
  v_ht_avant bigint;
  v_siennes jsonb;
  v_original jsonb;
  v_tva_originale jsonb;
  v_tva_e jsonb;
  v_parts_de jsonb := '{}';
  v_tva_de jsonb := '{}';
  v_encaisse jsonb := '{}';
  v_portee jsonb := '{}';
  v_lignes jsonb := '[]';
begin
  select f.* into v_facture from public.factures_emises f
   where f.id = p_facture_id and f.type = 'facture' and f.statut = 'validee' and f.source_de_la_vente;
  if not found then
    return;
  end if;
  -- Le régime, là où la base le fige : la nature des opérations, et l'option pour les débits des seuls services.
  v_regime := case when v_facture.nature_operation = 'biens' then 'livraison'
                   when v_facture.nature_operation is distinct from 'services' then 'nature'
                   when v_facture.option_debits is null then 'option_debits'
                   when v_facture.option_debits then 'debits'
                   else 'encaissement' end;
  if v_regime in ('nature', 'option_debits') then
    v_motif := v_regime;
  elsif not exists (select 1 from public.montants_par_taux_facture(p_facture_id)) then
    v_motif := 'sans_lignes';
  end if;

  -- Les encaissements qui comptent, dans leur ordre — leur date, leur création, leur identifiant —, chacun réparti sur
  -- les taux de la facture, au centime, pour son montant.
  if v_motif is null then
    <<lecture>>
    for v_e in select e.* from public.encaissements_factures e
                where e.dossier_id = v_facture.dossier_id and e.facture_id = p_facture_id and e.retire_le is null
                order by e.date_encaissement, e.cree_le, e.id loop
      v_montant := (v_e.montant * 100)::bigint;
      v_somme := 0;
      v_siennes := '{}';
      for v_part in select t.taux as part_taux, (t.montant * 100)::bigint as part_centimes
                      from public.encaissements_factures_taux t
                     where t.encaissement_id = v_e.id and t.dossier_id = v_facture.dossier_id loop
        if sign(v_part.part_centimes) <> sign(v_montant)
           or not exists (select 1 from public.montants_par_taux_facture(p_facture_id) m where m.taux = v_part.part_taux) then
          v_motif := 'encaissement_illisible';
          exit lecture;
        end if;
        v_siennes := v_siennes || jsonb_build_object(trim_scale(v_part.part_taux)::text, v_part.part_centimes);
        v_somme := v_somme + v_part.part_centimes;
      end loop;
      if v_montant = 0 or v_somme <> v_montant then
        v_motif := 'encaissement_illisible';
        exit lecture;
      end if;
      v_parts_de := v_parts_de || jsonb_build_object(v_e.id::text, v_siennes);
    end loop;
  end if;

  -- La règle du cumul, taux par taux, dans l'ordre des encaissements.
  if v_motif is null then
    <<cumul>>
    for v_e in select e.* from public.encaissements_factures e
                where e.dossier_id = v_facture.dossier_id and e.facture_id = p_facture_id and e.retire_le is null
                order by e.date_encaissement, e.cree_le, e.id loop
      v_siennes := v_parts_de -> (v_e.id::text);
      v_tva_originale := null;
      if v_e.annule_id is not null then
        -- Une contre-passation : l'exact opposé d'un encaissement compté AVANT elle, taux par taux.
        v_original := v_parts_de -> (v_e.annule_id::text);
        v_tva_originale := v_tva_de -> (v_e.annule_id::text);
        if v_original is null or v_tva_originale is null
           or (select count(*) from jsonb_object_keys(v_original)) <> (select count(*) from jsonb_object_keys(v_siennes))
           or exists (select 1 from jsonb_each_text(v_siennes) s
                       where (v_original ->> s.key) is null or (v_original ->> s.key)::bigint <> -(s.value::bigint)) then
          v_motif := 'contre_passation_illisible';
          exit cumul;
        end if;
      end if;
      v_tva_e := '{}';
      for v_cle, v_p in select s.key, s.value::bigint from jsonb_each_text(v_siennes) s loop
        v_cumul := coalesce((v_encaisse ->> v_cle)::bigint, 0) + v_p;
        v_deja := coalesce((v_portee ->> v_cle)::bigint, 0);
        if v_tva_originale is not null then
          v_tva := -((v_tva_originale ->> v_cle)::bigint);
        else
          -- V et T du taux, nets des avoirs datés au plus tard du jour de l'encaissement.
          select coalesce(sum(x.tva), 0), coalesce(sum(x.base + x.tva), 0) into v_v, v_t
            from (select m.base_centimes as base, m.tva_centimes as tva from public.montants_par_taux_facture(p_facture_id) m
                   where m.taux = v_cle::numeric
                  union all
                  select -m.base_centimes, -m.tva_centimes
                    from public.factures_emises a cross join lateral public.montants_par_taux_facture(a.id) m
                   where a.dossier_id = v_facture.dossier_id and a.facture_origine_id = p_facture_id and a.type = 'avoir'
                     and a.statut = 'validee' and a.source_de_la_vente and a.date_emission <= v_e.date_encaissement
                     and m.taux = v_cle::numeric) x;
          if v_t <= 0 then
            v_motif := 'ttc_nul';
            exit cumul;
          end if;
          v_tva := public.prorata_arrondi(v_v, v_cumul, v_t) - v_deja;
        end if;
        v_encaisse := v_encaisse || jsonb_build_object(v_cle, v_cumul);
        v_portee := v_portee || jsonb_build_object(v_cle, v_deja + v_tva);
        v_tva_e := v_tva_e || jsonb_build_object(v_cle, v_tva);
        v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('genre', 'part', 'encaissement_id', v_e.id,
          'annule_id', v_e.annule_id, 'date_effet', v_e.date_encaissement, 'moyen', v_e.moyen,
          'ligne_bancaire_id', v_e.ligne_bancaire_id, 'taux', v_cle::numeric, 'ttc_centimes', v_p,
          'base_centimes', v_p - v_tva, 'tva_centimes', v_tva));
      end loop;
      v_tva_de := v_tva_de || jsonb_build_object(v_e.id::text, v_tva_e);
    end loop;
  end if;

  if v_motif is not null then
    return query select 'ecartee'::text, v_motif, null::uuid, null::uuid, null::uuid, null::text, null::date, null::text,
                        null::uuid, null::numeric, null::bigint, null::bigint, null::bigint;
    return;
  end if;

  -- Les documents, à leur date d'émission : la facture, puis ses avoirs, en négatif.
  v_lignes := v_lignes || coalesce((
    select jsonb_agg(jsonb_build_object('genre', 'document', 'date_effet', v_facture.date_emission, 'taux', m.taux,
                                        'ttc_centimes', m.ttc_centimes, 'base_centimes', m.base_centimes,
                                        'tva_centimes', m.tva_centimes))
      from public.montants_par_taux_facture(p_facture_id) m), '[]');
  v_lignes := v_lignes || coalesce((
    select jsonb_agg(jsonb_build_object('genre', 'document', 'avoir_id', a.id, 'date_effet', a.date_emission, 'taux', m.taux,
                                        'ttc_centimes', -m.ttc_centimes, 'base_centimes', -m.base_centimes,
                                        'tva_centimes', -m.tva_centimes))
      from public.factures_emises a cross join lateral public.montants_par_taux_facture(a.id) m
     where a.dossier_id = v_facture.dossier_id and a.facture_origine_id = p_facture_id and a.type = 'avoir'
       and a.statut = 'validee' and a.source_de_la_vente), '[]');

  -- Les exigibilités. Des services : chaque part, à la date de son encaissement.
  if v_regime = 'encaissement' then
    v_lignes := v_lignes || coalesce((
      select jsonb_agg(x || '{"genre": "exigibilite", "origine": "encaissement"}'::jsonb)
        from jsonb_array_elements(v_lignes) x where x ->> 'genre' = 'part'), '[]');
  else
    -- Un bien, ou des services sur les débits : un fait générateur, la livraison ou la date de la facture. Les parts
    -- d'avant à leur date ; à lui, ce que la facture porte nette des avoirs datés jusque-là, moins ce que ces parts ont
    -- rendu exigible ; un avoir d'après, à sa date.
    v_fait := case when v_regime = 'livraison' then coalesce(v_facture.date_prestation, v_facture.date_emission)
                   else v_facture.date_emission end;
    v_lignes := v_lignes || coalesce((
      select jsonb_agg(x || '{"genre": "exigibilite", "origine": "encaissement"}'::jsonb)
        from jsonb_array_elements(v_lignes) x where x ->> 'genre' = 'part' and (x ->> 'date_effet')::date < v_fait), '[]');
    for v_cle in select distinct trim_scale(u.taux)::text
                   from (select m.taux from public.montants_par_taux_facture(p_facture_id) m
                         union all
                         select m.taux from public.factures_emises a cross join lateral public.montants_par_taux_facture(a.id) m
                          where a.dossier_id = v_facture.dossier_id and a.facture_origine_id = p_facture_id
                            and a.type = 'avoir' and a.statut = 'validee' and a.source_de_la_vente) u loop
      select coalesce(sum(x.tva), 0), coalesce(sum(x.base + x.tva), 0) into v_v, v_t
        from (select m.base_centimes as base, m.tva_centimes as tva from public.montants_par_taux_facture(p_facture_id) m
               where m.taux = v_cle::numeric
              union all
              select -m.base_centimes, -m.tva_centimes
                from public.factures_emises a cross join lateral public.montants_par_taux_facture(a.id) m
               where a.dossier_id = v_facture.dossier_id and a.facture_origine_id = p_facture_id and a.type = 'avoir'
                 and a.statut = 'validee' and a.source_de_la_vente and a.date_emission <= v_fait
                 and m.taux = v_cle::numeric) x;
      select coalesce(sum((x ->> 'tva_centimes')::bigint), 0), coalesce(sum((x ->> 'base_centimes')::bigint), 0)
        into v_tva_avant, v_ht_avant
        from jsonb_array_elements(v_lignes) x
       where x ->> 'genre' = 'part' and (x ->> 'date_effet')::date < v_fait and (x ->> 'taux')::numeric = v_cle::numeric;
      if v_t - v_v - v_ht_avant <> 0 or v_v - v_tva_avant <> 0 then
        v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('genre', 'exigibilite',
          'origine', case when v_regime = 'livraison' then 'livraison' else 'facture' end, 'date_effet', v_fait,
          'taux', v_cle::numeric, 'base_centimes', v_t - v_v - v_ht_avant, 'tva_centimes', v_v - v_tva_avant));
      end if;
    end loop;
    v_lignes := v_lignes || coalesce((
      select jsonb_agg(x || '{"genre": "exigibilite", "origine": "avoir"}'::jsonb)
        from jsonb_array_elements(v_lignes) x
       where x ->> 'genre' = 'document' and x ->> 'avoir_id' is not null and (x ->> 'date_effet')::date > v_fait), '[]');
  end if;

  return query
    select r.genre, null::text, r.encaissement_id, r.annule_id, r.avoir_id, r.origine, r.date_effet, r.moyen,
           r.ligne_bancaire_id, r.taux, r.ttc_centimes, r.base_centimes, r.tva_centimes
      from jsonb_to_recordset(v_lignes) as r(genre text, encaissement_id uuid, annule_id uuid, avoir_id uuid, origine text,
                                             date_effet date, moyen text, ligne_bancaire_id uuid, taux numeric,
                                             ttc_centimes bigint, base_centimes bigint, tva_centimes bigint);
end
$$;

-- ══ 3. Les écritures d'une source, recomposées ══════════

-- CE QU'UNE SOURCE ÉCRIT, recomposé comme le compose `ecrituresDesVentesFacturees` (src/lib/ecrituresVentesFacturees.ts) :
-- ses lignes, chacune « date|compte|sens|centimes|mouvement », sommées par date, compte et mouvement, les nulles ôtées,
-- triées octet par octet ; ou le MOTIF pour lequel elle ne s'écrit pas (et son détail : le motif de la facture écartée, le
-- compte refusé). Rien, sans motif : la source n'a rien à écrire. Le compte de trésorerie d'un encaissement (EC3-Q7) : la
-- banque quand il cite un mouvement du même jour, la ligne portant ce mouvement ; les valeurs à l'encaissement (la caisse
-- pour des espèces) pour un mouvement d'un autre jour ou aucun ; le compte de contrepartie choisi pour une compensation ou
-- « autre » sans mouvement ; une contre-passation sans mouvement prend celui de l'encaissement qu'elle annule. En
-- trésorerie, l'encaissement porte sa trésorerie, le produit (706 ou 707 selon la nature) et le 44571 — ou le 411 quand la
-- TVA était déjà due ; en engagement, la trésorerie face au 411, et la TVA qui devient exigible avec lui passe de
-- l'attente au 44571. La facture et l'avoir : en engagement, le document (411, produit, TVA en attente) ; dans les deux
-- modèles, la TVA due avant l'encaissement à sa date (411 en trésorerie, l'attente en engagement, face au 44571). Le
-- mouvement classé par ses encaissements : la banque de ce que ceux du même jour n'ont pas porté, le 511 (ou le 53) de
-- ceux d'un autre jour, le 627 de l'écart des frais sous le seuil min(2 %, 5 €). Chaque compte est celui du plan du dossier.
create function public.ecriture_attendue_vente_facturee(p_dossier_id uuid, p_source text, p_source_id uuid,
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
    if exists (select 1 from public.encaissements_factures e
                 join public.factures_emises f on f.id = e.facture_id
                where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
                  and not (f.statut = 'validee' and f.source_de_la_vente) and public.encaissement_justifie_son_mouvement(e.id)) then
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
           coalesce(sum((e.montant * 100)::bigint) filter (where e.date_encaissement = v_m.date), 0)
      into v_total, v_meme_jour
      from public.encaissements_factures e
     where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
       and public.encaissement_justifie_son_mouvement(e.id);
    -- Ceux du même jour ont porté la banque eux-mêmes ; ceux d'un autre jour sont passés au 511 (au 53 pour des
    -- espèces), que le mouvement solde.
    v_soldes := coalesce((
      select jsonb_agg(jsonb_build_object('d', v_m.date, 'c', case when e.moyen = 'especes' then v_caisse else v_valeurs end,
                                          'l', v_m.id, 'm', -((e.montant * 100)::bigint)))
        from public.encaissements_factures e
       where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
         and public.encaissement_justifie_son_mouvement(e.id) and e.date_encaissement <> v_m.date), '[]');
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

-- ══ 4. Écrire les écritures d'une source ══════════
-- Le cabinet seul (`admin_du_dossier`). Sous le verrou de la facture dont la source dépend (pour un avoir, sa facture
-- d'abord, puis l'avoir), ou du mouvement, puis le verrou PARTAGÉ de la validation. Dans l'ordre :
--   1. l'accès au dossier annoncé, un dossier qui n'existe pas comme un dossier interdit ; 2. un genre de source inconnu ;
--   3. un dossier dont les factures ne sont pas la source de leurs ventes ; 4 à 7. la source introuvable dans ce dossier —
--   la facture, l'avoir, l'encaissement, le mouvement ; 8 à 11. une source qui n'est pas celle d'une vente facturée — une
--   facture ou un avoir qui n'est pas source, l'encaissement d'une facture qui ne l'est pas, un mouvement qui ne justifie
--   aucun encaissement d'une facture source ; 12. des lignes illisibles ; 13 à 19. une source que la base ne sait pas
--   écrire, et pourquoi — la facture écartée, le compte de contrepartie à choisir ou refusé, un mouvement qui porte une
--   facture qui n'est pas source ou une vente écartée, un mouvement pas encore classé ou hors de l'écart des frais ;
--   20. une ligne datée d'un exercice que la frontière fige ; 21. une source qui n'a rien à écrire après la frontière ;
--   22. des lignes qui ne sont pas celles que la base recompose. Rend le nombre de lignes écrites.
create function public.ecrire_vente_facturee(p_dossier_id uuid, p_source text, p_source_id uuid, p_lignes jsonb)
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
    raise exception 'Ce mouvement porte aussi l''encaissement d''une facture qui n''est pas la source de sa vente : son écriture n''est pas encore conçue.'
      using errcode = '22023';
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

-- ══ 5. Retirer les écritures d'une source qui n'a plus rien à écrire ══════════
-- Le cabinet seul. Sous les mêmes verrous. Dans l'ordre : 1. l'accès ; 2. un genre de source inconnu ; 3. un dossier dont
-- les factures ne sont pas la source de leurs ventes ; 4 à 7. la source introuvable dans ce dossier ; 8. un mouvement classé
-- autrement que par ses encaissements — ses lignes sans pièce sont alors celles de ce classement (une affectation, une
-- ventilation, un compte de bilan…), que sa propre fonction retire, et jamais celles d'une vente facturée ; 9. un mouvement
-- libre qu'aucun encaissement d'une facture source n'a jamais cité ; 10. une source pour laquelle la base recompose encore
-- des lignes après la frontière (elle se réécrit) ; 11. des écritures toutes validées ; 12. aucune écriture proposée. Un
-- mouvement déclassé reste à traiter, réservé à ses encaissements : ses lignes s'y retirent, et encore une fois ses
-- encaissements retirés. Rend le nombre de lignes retirées.
create function public.retirer_ecriture_vente_facturee(p_dossier_id uuid, p_source text, p_source_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.factures_emises;
  v_encaissement public.encaissements_factures;
  v_mouvement public.lignes_bancaires;
  v_facture_id uuid;
  v_attendues text[];
  v_frontiere date;
  v_proposees integer;
  v_validees integer;
  v_nb integer;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('facture', 'avoir', 'encaissement', 'mouvement') then
    raise exception 'Une écriture de vente facturée a pour source une facture, un avoir, un encaissement ou un mouvement.'
      using errcode = '22023';
  end if;
  if not (select d.ventes_par_les_factures from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Les factures de ce dossier ne sont pas la source de leurs ventes : aucune écriture de vente facturée ne s''y écrit.'
      using errcode = '22023';
  end if;
  if p_source in ('facture', 'avoir') then
    -- La facture d'abord, puis l'avoir, comme pour écrire.
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
  elsif p_source = 'encaissement' then
    select e.* into v_encaissement from public.encaissements_factures e
     where e.id = p_source_id and e.dossier_id = p_dossier_id;
    if not found then
      raise exception 'Encaissement introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    perform 1 from public.factures_emises f where f.id = v_encaissement.facture_id for no key update;
  else
    select l.* into v_mouvement from public.lignes_bancaires l
     where l.id = p_source_id and l.dossier_id = p_dossier_id
       for no key update;
    if not found then
      raise exception 'Mouvement introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    if not v_mouvement.encaissements_de_factures and not public.mouvement_libre(v_mouvement) then
      raise exception 'Ce mouvement est classé autrement que par ses encaissements : ses écritures sont celles de ce classement, et se retirent avec lui.'
        using errcode = '22023';
    end if;
    if not exists (select 1 from public.encaissements_factures e
                     join public.factures_emises f on f.id = e.facture_id
                    where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and f.source_de_la_vente) then
      raise exception 'Aucun encaissement d''une facture source de sa vente ne cite ce mouvement : il n''a pas d''écriture de vente facturée.'
        using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  v_frontiere := public.frontiere_validation(p_dossier_id);
  select a.lignes into v_attendues from public.ecriture_attendue_vente_facturee(p_dossier_id, p_source, p_source_id) a;
  if exists (select 1 from unnest(v_attendues) a where v_frontiere is null or split_part(a, '|', 1)::date > v_frontiere) then
    raise exception 'Cette source a encore à écrire : ses écritures se réécrivent, elles ne se retirent pas.' using errcode = '22023';
  end if;

  select count(*) filter (where b.statut = 'proposee'), count(*) filter (where b.statut = 'validee')
    into v_proposees, v_validees
    from public.ecritures_brouillon b
   where b.dossier_id = p_dossier_id
     and case when p_source in ('facture', 'avoir') then b.facture_id = p_source_id
              when p_source = 'encaissement' then b.encaissement_id = p_source_id
              else b.ligne_bancaire_id = p_source_id and b.facture_id is null and b.encaissement_id is null
                   and b.piece_id is null and b.immobilisation_id is null and b.vehicule_id is null
                   and b.declaration_tva_id is null and b.cotisation_id is null end;
  if v_proposees = 0 and v_validees > 0 then
    raise exception 'Les écritures de cette source sont validées : elles ne se retirent plus.' using errcode = '22023';
  end if;
  if v_proposees = 0 then
    raise exception 'Cette source n''a aucune écriture proposée à retirer.' using errcode = '22023';
  end if;

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
  get diagnostics v_nb = row_count;
  perform set_config('jd.ecriture_vente_facturee', '', true);
  return v_nb;
end
$$;

-- ══ 6. G5 : les lignes d'une vente facturée ne s'écrivent que par ses fonctions ══════════
-- Une ligne de vente facturée : elle porte une facture ou un avoir, un encaissement — sa source est cet identifiant —, ou
-- elle est passée sur un mouvement classé par ses encaissements sans porter ni l'un ni l'autre — sa source est ce
-- mouvement. À l'insertion, la garde des colonnes juge les deux premiers genres ; celle-ci, le troisième, que la
-- restauration du super-administrateur réinsère seule. À la modification et à la suppression, les trois genres : sous le
-- réglage `jd.ecriture_vente_facturee` de leur source, que posent les deux fonctions, et rien d'autre — sauf la
-- validation d'un exercice, qui ne change que ce qu'elle numérote, et la suppression d'un dossier, qui emporte tout.
-- Elle passe après la garde des écritures validées et celle des colonnes, que l'ordre des noms fait passer d'abord.
create function public.garder_lignes_de_la_vente_facturee() returns trigger
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
    if v_apres is null and exists (select 1 from public.lignes_bancaires l
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
  if v_avant is null and exists (select 1 from public.lignes_bancaires l
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

create trigger ecritures_brouillon_vente_facturee_lignes
  before insert or update or delete on public.ecritures_brouillon
  for each row execute function public.garder_lignes_de_la_vente_facturee();

-- ══ 7. Les droits d'exécution ══════════
-- Les trois fonctions du cabinet jugent l'accès elles-mêmes, et un anonyme n'a rien à y faire. Les aides et la garde ne
-- s'appellent pas en RPC.
revoke execute on function public.ecrire_vente_facturee(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.ecrire_vente_facturee(uuid, text, uuid, jsonb) to authenticated;
revoke execute on function public.retirer_ecriture_vente_facturee(uuid, text, uuid) from public, anon;
grant execute on function public.retirer_ecriture_vente_facturee(uuid, text, uuid) to authenticated;
revoke execute on function public.choisir_compte_contrepartie(uuid, uuid, text) from public, anon;
grant execute on function public.choisir_compte_contrepartie(uuid, uuid, text) to authenticated;
revoke execute on function public.refus_compte_de_contrepartie(uuid, text) from public, anon, authenticated;
revoke execute on function public.prorata_arrondi(bigint, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.calcul_vente_facturee(uuid) from public, anon, authenticated;
revoke execute on function public.ecriture_attendue_vente_facturee(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.garder_lignes_de_la_vente_facturee() from public, anon, authenticated;

comment on function public.ecrire_vente_facturee(uuid, text, uuid, jsonb) is
  'Écrit les écritures d''une source de vente facturée (une facture, un avoir, un encaissement, un mouvement classé par ses encaissements) telles que l''application les a composées, après les avoir recomposées en entiers depuis la base et comparées en multiensemble ; remplace d''un tenant ses écritures proposées ; le cabinet seul.';
comment on function public.retirer_ecriture_vente_facturee(uuid, text, uuid) is
  'Retire les écritures proposées d''une source de vente facturée pour laquelle la base ne recompose plus rien ; le cabinet seul.';
comment on function public.choisir_compte_contrepartie(uuid, uuid, text) is
  'Choisit le compte de bilan sur lequel s''écrit un encaissement par compensation, ou par un autre moyen, sans mouvement (VF4A-Q2) ; le cabinet seul.';
comment on function public.refus_compte_de_contrepartie(uuid, text) is
  'Pourquoi un compte ne peut pas être la contrepartie d''un encaissement, sous les mots de refusCompteDeContrepartie ; nul quand il le peut.';
comment on function public.prorata_arrondi(bigint, bigint, bigint) is
  'V × P / T arrondi au centime, le demi loin de zéro : la règle du cumul de la TVA d''une vente facturée (prorataArrondi).';
comment on function public.calcul_vente_facturee(uuid) is
  'Les parts, exigibilités et documents d''une facture source (ventesFacturees), en centimes, ou la raison pour laquelle elle est écartée.';
comment on function public.ecriture_attendue_vente_facturee(uuid, text, uuid) is
  'Les lignes qu''une source de vente facturée écrit, recomposées comme ecrituresDesVentesFacturees, ou le motif pour lequel elle ne s''écrit pas.';
comment on function public.garder_lignes_de_la_vente_facturee() is
  'G5 : une écriture de vente facturée — une facture, un avoir, un encaissement, un mouvement classé par ses encaissements — ne s''insère, ne se modifie ni ne se retire que par ses fonctions, sous le réglage de sa source ; la restauration, la validation et la suppression d''un dossier passent.';
