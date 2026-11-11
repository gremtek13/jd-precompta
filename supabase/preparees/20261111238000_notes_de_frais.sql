-- LES NOTES DE FRAIS, EN BASE (espace client, ligne 51.5, partie B, étape B7 ; MEG2-Q6, Q7 et Q8, « oui » le 18/10/2026 :
-- chaque accès « Notes de frais » saisit les siennes, l'accès « Achats » — le dirigeant — les approuve et les rembourse, un
-- salarié sans accès est saisi par le dirigeant ; la note d'un salarié au 421000 par défaut, réglable par dossier ; ses
-- kilomètres au barème fiscal, un dépassement signalé, rien de calculé en paie) — PRÉPARÉE, PAS APPLIQUÉE. La conception :
-- HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », B.2 (« Les
-- notes de frais ») et B.7 (l'étape B7) ; le récit : « 11/11/2026 — B7 : LES NOTES DE FRAIS, EN BASE (LIGNE 51.5) (PRÉPARÉE,
-- PAS APPLIQUÉE) » ; l'essai : supabase/essais/notesDeFrais.sql ; le bloc NF de supabase/essais/rls.sql.
--
-- SOURCES. Pour l'exploitant, une dépense nécessitée par l'exercice de la profession (CGI, art. 93, 1) ; pour un salarié, le
-- remboursement de frais professionnels, que les textes de la sécurité sociale bornent (l'arrêté du 20/12/2002, abrogé le
-- 07/09/2025 et remplacé par l'arrêté du 04/09/2025, NON RELU au Journal officiel : B-NV2) — la base ne calcule que le
-- barème FISCAL (MEG2-Q8), et rien en paie. Le barème est celui que la base tient déjà, par millésime
-- (`indemnite_kilometrique_centimes`, migration bareme_kilometrique : le kilométrage × le coefficient en millièmes d'euro,
-- plus le forfait de la tranche, arrondi au centime, en entiers) : cette migration L'APPELLE, ne le recopie pas, et une
-- année absente ne calcule rien. La TVA d'une dépense ne se déduit que sur une facture qui la porte (CGI, art. 271, II, 1,
-- a) : la note dit la TVA DÉCLARÉE, le cabinet en décide. Les pièces se conservent six ans (LPF, art. L102 B). Le compte du
-- personnel : PCG (règlement ANC n° 2014-03 consolidé), classe 4, 421 « Personnel – Rémunérations dues » et 4286
-- « Personnel – Autres charges à payer ». Ce que la base garde se tient au règlement (UE) 2016/679 : rien n'est ouvert par
-- défaut (art. 25, § 2 — la case « Notes de frais » est fausse tant que le cabinet ne la coche pas) ; le nom d'un salarié,
-- ses frais, leurs motifs et ses distances, sans adresse de trajet (art. 5, § 1, c). Aucune norme AFNOR.
--
-- CE QU'ELLE POSE.
--   1. `notes_de_frais` : l'auteur (le compte qui saisit), le salarié sans accès que le dirigeant saisit (nul : l'auteur
--      lui-même), la date, la nature (une liste fermée), le motif (une ligne), le TTC et la TVA déclarée ; pour des
--      kilomètres, la distance et le véhicule (type, puissance fiscale, électrique ou non), le montant étant celui du barème
--      de l'année de la dépense, VÉRIFIÉ ici ; le justificatif, une pièce déposée par le chemin d'aujourd'hui ; l'état —
--      brouillon, soumise, approuvée, refusée (motif), remboursée (date, moyen), retirée (un brouillon abandonné) —, chaque
--      passage daté et signé ; une version, qu'une écriture retient.
--   2. Une garde de la table, avant la RLS : une ligne ne s'écrit que par ses fonctions (`jd.notes_de_frais`) ou par la
--      restauration (le super-administrateur) ; l'auteur, le dossier et la création ne changent pas ; seuls les passages
--      brouillon → brouillon, soumise ou retirée, soumise → approuvée ou refusée, approuvée → remboursée ; une note soumise
--      ne se réécrit plus (une parole datée), seul son passage suivant s'y ajoute ; le justificatif cite une pièce de son
--      dossier ; une ligne ne part qu'avec son dossier.
--   3. Une garde de `pieces` : le justificatif d'une note ne se supprime pas, ni ne change de dossier, tant qu'une note le
--      cite (retirer le brouillon d'abord) ; avec son dossier, il part.
--   4. Six fonctions `security definer`, chacune contrôlant l'accès AVANT toute autre lecture : `enregistrer_note_de_frais`
--      (créer ou modifier un brouillon : l'accès « Notes de frais », et « Achats » en plus pour la note d'un salarié sans
--      accès — B7-Q1) ; `soumettre_note_de_frais` et `retirer_note_de_frais` (son auteur, aux mêmes cases) ;
--      `approuver_note_de_frais`, `refuser_note_de_frais`, `rembourser_note_de_frais` (l'accès « Achats », ou le cabinet du
--      dossier). Le remboursement est DÉCLARÉ : rien ne s'écrit dans le relevé, la caisse, les écritures ni les pièces.
--   5. Les policies, toutes à `authenticated` : le cabinet du dossier lit tout ; l'accès « Notes de frais » lit les siennes ;
--      l'accès « Achats » lit toutes celles qui ne sont ni un brouillon ni retirées, et ses propres brouillons par la case
--      « Notes de frais » ; le super-administrateur insère (la restauration). Aucune policy de mise à jour ni de suppression,
--      pour personne. CES LECTURES DU CLIENT SE PRÉSENTENT AU CABINET AVANT D'ÊTRE APPLIQUÉES (CLAUDE.md, « une policy qui
--      lui ouvre une lecture se présente au cabinet »).
--   6. Le rôle `personnel` du catalogue des rôles comptables (MEG2-Q7, ligne 43 ; B7-Q4) : le compte des salariés, 421000 par
--      défaut, sous les racines 421 et 4286 — pas le 467, que tient déjà le dirigeant non associé (aucune racine du catalogue
--      n'en commence une autre) —, au rang 330. Un dossier le règle par `regler_plan_du_dossier`, qui lit le catalogue ; un
--      dossier qui ne le règle pas le lit à son défaut (`compte_du_role`, `plan_du_dossier`). Rien ne l'écrit encore :
--      l'écriture d'une note d'un salarié par le cabinet vient avec l'étape B8 et la suite.
--
-- LES REFUS, DANS L'ORDRE (que src/lib/notesDeFrais.ts redit sous les mêmes mots) :
--   - `enregistrer_note_de_frais` : le dossier dont l'appelant n'est pas un accès « Notes de frais » (42501) ; une note
--     inconnue, d'un autre dossier ou d'un autre auteur (42501) ; une note qui n'est plus un brouillon (22023) ; une version
--     qui a changé depuis la lecture (22023) ; la note d'un salarié sans la case « Achats » (42501) ; le nom du salarié hors
--     de sa forme (22023) ; la date absente, à venir au jour de Paris, ou d'avant 2000 (22023) ; la nature hors de la liste
--     (22023) ; le motif hors de sa forme (22023) ; pour des kilomètres : la distance (22023), le véhicule (22023), une TVA
--     (22023), un justificatif (22023), le barème de l'année absent pour ce véhicule (22023), un montant qui n'est pas celui
--     du barème (22023) ; sinon : une distance ou un véhicule (22023), le TTC (22023), la TVA (22023) ; le justificatif qui
--     n'est pas une pièce que l'appelant a déposée dans ce dossier (22023), déjà validé (22023), déjà cité par une autre note
--     (22023) ;
--   - `soumettre_note_de_frais`, `retirer_note_de_frais` : la note inconnue, ou dont l'appelant n'est pas l'auteur encore
--     « Notes de frais » (42501) ; celle d'un salarié sans la case « Achats » (42501) ; plus un brouillon (22023) ; la version
--     (22023) ; puis, pour soumettre : sans justificatif hors des kilomètres (22023), un justificatif validé depuis (22023), le
--     barème absent ou changé depuis l'enregistrement (22023) ;
--   - `approuver_note_de_frais`, `refuser_note_de_frais`, `rembourser_note_de_frais` : la note inconnue, ou que l'appelant ne
--     peut décider — ni le cabinet du dossier ni un accès « Achats », ou le brouillon d'un autre (42501, les mêmes mots) ; la
--     note qui n'est pas soumise (approuver, refuser) ou approuvée (rembourser) (22023) ; la version (22023) ; puis le motif
--     du refus (22023), ou la date et le moyen du remboursement (22023) ;
--   - les gardes : une écriture hors des fonctions et de la restauration (42501) ; un changement d'auteur, de dossier ou de
--     création, un passage hors de la liste, une note soumise réécrite, un justificatif d'un autre dossier, un retrait hors de
--     celui du dossier, le justificatif d'une note supprimé ou déplacé (23514).
--
-- CE QU'ELLE NE CHANGE PAS : les policies de `pieces`, de `piece_textes_ocr` et du seau `pieces` (le justificatif se dépose
-- par le chemin d'aujourd'hui ; le RESSERREMENT est l'étape B6) ; `memberships`, ses cases et leur trace (B1) ;
-- `client_du_dossier`, qu'elle APPELLE ; le barème kilométrique et `indemnite_kilometrique_centimes`, qu'elle appelle ;
-- `regler_plan_du_dossier`, la garde du plan et `garder_comptes_des_pieces`, qui lisent le catalogue tel qu'il est ; le
-- compte du dirigeant (`dossiers.compte_notes_de_frais`) et l'écriture d'une note de frais du cabinet. Aucune ligne écrite
-- d'avance hors du catalogue.
--
-- CE QU'ELLE SUPPOSE, que sa garde de tête vérifie : B1 (`trois_cases_de_l_acces` : les cases « Notes de frais » et
-- « Achats », et leurs mots dans `client_du_dossier`) ; le barème en base ; aucun objet de cette migration ; le rang 330 et
-- les racines 421 et 4286 libres au catalogue. La double authentification exigée (`deux_facteurs_exiges`, préparée) pose sa
-- policy restrictive sur chaque table de public : appliquée avant celle-ci, la table neuve la reçoit ici, à l'identique ;
-- appliquée après, sa boucle la prend.
--
-- CE QUE LE TEXTE RETIRE : rien — ni objet, ni donnée. Hors des commentaires, le mot n'y paraît que dans les clés
-- (`on delete cascade`) et les gardes (`tg_op`, `before … delete`) ; un brouillon se RETIRE par son état, il ne s'efface
-- pas. Ni barre oblique inverse, ni retour chariot. Elle s'applique PAR L'OUTIL. Son retour
-- (`supabase/preparees/retour/20261111238100`) retire la table, ses valeurs et le rôle : destructif, à accorder et à coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `NOTES_DE_FRAIS_PREVUES` (src/lib/notesDeFrais.ts) se lève
-- alors, et la table entre au plan de sauvegarde. Les écrans (« Mes notes de frais », l'approbation, le remboursement, la
-- pièce proposée au cabinet) sont l'étape B8.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regclass('public.notes_de_frais') is not null
     or exists (select 1 from public.roles_comptables r where r.role = 'personnel') then
    raise exception 'La migration notes_de_frais est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and a.attname = 'droit_frais'
                  and not a.attisdropped)
     or strpos(coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.client_du_dossier(uuid,text)')), ''),
               'when ''frais'' then m.droit_frais') = 0
     or strpos(coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.client_du_dossier(uuid,text)')), ''),
               'when ''achats'' then m.droit_achats') = 0 then
    raise exception 'Les cases « Notes de frais » et « Achats » (migration trois_cases_de_l_acces, B1) manquent : l''appliquer d''abord ; celle-ci les lit par client_du_dossier.';
  end if;
  if to_regprocedure('public.admin_du_dossier(uuid)') is null or to_regprocedure('public.is_super_admin()') is null
     or to_regprocedure('public.indemnite_kilometrique_centimes(integer,text,integer,boolean,integer)') is null
     or to_regclass('public.pieces') is null or to_regclass('public.roles_comptables') is null then
    raise exception 'Une fonction ou une table que la migration suppose manque (admin_du_dossier, is_super_admin, indemnite_kilometrique_centimes, pieces, roles_comptables) : relire la base.';
  end if;
  if exists (select 1 from public.roles_comptables r where r.ordre = 330)
     or exists (select 1 from public.roles_comptables r cross join unnest(r.racines) as u(racine)
                 where left('421', length(u.racine)) = u.racine or left('4286', length(u.racine)) = u.racine
                    or left(u.racine, 3) = '421' or left(u.racine, 4) = '4286') then
    raise exception 'Le catalogue des rôles porte déjà le rang 330, ou une racine qui commence ou prolonge 421 ou 4286 : le relire avant d''y poser le personnel.';
  end if;
end
$garde$;

-- ══ 1. Les notes de frais ══════════
-- Sans clé vers le compte de l'auteur ni vers celui qui décide : retirer le compte d'un membre parti ne doit pas effacer qui
-- a saisi, approuvé ou remboursé (le patron de `paiements_declares.declare_par`). Le dossier en cascade. Le justificatif sans
-- action à la suppression : vérifiée à la fin de l'instruction, elle laisse partir un dossier entier, et la garde de `pieces`
-- dit le refus d'une pièce supprimée seule.
create table public.notes_de_frais (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  auteur uuid not null,
  beneficiaire_salarie text
    constraint notes_de_frais_beneficiaire check (beneficiaire_salarie = btrim(beneficiaire_salarie) and beneficiaire_salarie <> ''
      and length(beneficiaire_salarie) <= 120 and beneficiaire_salarie !~ '[[:cntrl:]]'),
  date_depense date not null
    constraint notes_de_frais_date check (date_depense >= date '2000-01-01' and date_depense <= date '2100-12-31'),
  nature text not null
    constraint notes_de_frais_nature check (nature in ('repas', 'hebergement', 'transport', 'carburant', 'peage_stationnement',
                                                        'fournitures', 'kilometres', 'autre')),
  motif text not null
    constraint notes_de_frais_motif check (btrim(motif) <> '' and length(motif) <= 200 and motif !~ '[[:cntrl:]]'),
  montant_ttc numeric(12, 2) not null
    constraint notes_de_frais_montant check (montant_ttc > 0),
  montant_tva numeric(12, 2) not null default 0
    constraint notes_de_frais_tva check (montant_tva >= 0 and montant_tva < montant_ttc),
  distance_km integer,
  vehicule_type text,
  puissance_fiscale integer,
  electrique boolean,
  piece_id uuid references public.pieces (id),
  etat text not null default 'brouillon'
    constraint notes_de_frais_etat_connu check (etat in ('brouillon', 'soumise', 'approuvee', 'refusee', 'remboursee', 'retiree')),
  version integer not null default 1
    constraint notes_de_frais_version check (version >= 1),
  cree_le timestamptz not null default now(),
  modifiee_le timestamptz not null default now(),
  soumise_le timestamptz,
  approuvee_par uuid,
  approuvee_le timestamptz,
  refusee_par uuid,
  refusee_le timestamptz,
  motif_refus text
    constraint notes_de_frais_motif_refus check (btrim(motif_refus) <> '' and length(motif_refus) <= 200 and motif_refus !~ '[[:cntrl:]]'),
  remboursee_par uuid,
  remboursee_le timestamptz,
  date_remboursement date
    constraint notes_de_frais_date_remboursement check (date_remboursement >= date_depense and date_remboursement <= date '2100-12-31'),
  moyen_remboursement text
    constraint notes_de_frais_moyen check (moyen_remboursement in ('virement', 'cheque', 'especes', 'paie', 'autre')),
  retiree_le timestamptz,
  constraint notes_de_frais_kilometres check (
    (nature = 'kilometres' and distance_km is not null and distance_km >= 1 and distance_km <= 100000
      and vehicule_type is not null and vehicule_type in ('voiture', 'moto', 'cyclomoteur')
      and puissance_fiscale is not null and puissance_fiscale >= 0 and puissance_fiscale <= 99
      and electrique is not null and montant_tva = 0 and piece_id is null)
    or (nature <> 'kilometres' and distance_km is null and vehicule_type is null and puissance_fiscale is null
      and electrique is null)),
  constraint notes_de_frais_passages check (
    (soumise_le is null) = (etat in ('brouillon', 'retiree'))
    and (approuvee_par is null) = (approuvee_le is null)
    and (approuvee_le is not null) = (etat in ('approuvee', 'remboursee'))
    and (refusee_par is null) = (refusee_le is null)
    and (refusee_le is null) = (motif_refus is null)
    and (refusee_le is not null) = (etat = 'refusee')
    and (remboursee_par is null) = (remboursee_le is null)
    and (remboursee_le is null) = (date_remboursement is null)
    and (remboursee_le is null) = (moyen_remboursement is null)
    and (remboursee_le is not null) = (etat = 'remboursee')
    and (retiree_le is not null) = (etat = 'retiree')
    and (etat <> 'retiree' or piece_id is null)),
  constraint notes_de_frais_une_par_piece unique (piece_id)
);

create index notes_de_frais_dossier on public.notes_de_frais (dossier_id, etat);
create index notes_de_frais_auteur on public.notes_de_frais (dossier_id, auteur);

comment on table public.notes_de_frais is
  'Les notes de frais de l''espace client (étape B7 ; MEG2-Q6 à Q8) : saisies par un accès « Notes de frais » (la sienne, ou, avec « Achats », celle d''un salarié sans accès), soumises, approuvées ou refusées puis remboursées par l''accès « Achats » ou le cabinet ; chaque passage daté et signé. Une note soumise ne se réécrit pas. Le remboursement est DÉCLARÉ : rien ne s''écrit dans le relevé, la caisse, les écritures ni les pièces. Écrites par leurs six fonctions seules ; lues par le cabinet du dossier, l''auteur « Notes de frais » et l''accès « Achats ».';
comment on column public.notes_de_frais.auteur is
  'Le compte qui a saisi la note (auth.uid()), sans clé étrangère : il survit au retrait du compte.';
comment on column public.notes_de_frais.beneficiaire_salarie is
  'Le nom du salarié SANS accès dont l''accès « Achats » (le dirigeant) saisit la note ; nul, la note est celle de son auteur. Une ligne, sans adresse.';
comment on column public.notes_de_frais.nature is
  'repas, hebergement, transport, carburant, peage_stationnement, fournitures, kilometres ou autre — une liste fermée.';
comment on column public.notes_de_frais.montant_ttc is
  'Le montant TTC de la dépense, au centime ; pour des kilomètres, l''indemnité du barème de l''année de la dépense pour cette distance et ce véhicule, vérifiée par indemnite_kilometrique_centimes à l''enregistrement et à la soumission.';
comment on column public.notes_de_frais.montant_tva is
  'La TVA que l''auteur déclare sur sa dépense, au centime ; nulle pour des kilomètres. Le cabinet décide de ce qui se déduit (CGI, art. 271).';
comment on column public.notes_de_frais.piece_id is
  'Le justificatif : une pièce que l''auteur a déposée dans le dossier par le chemin d''aujourd''hui, encore à valider à l''enregistrement et à la soumission, qu''une seule note cite ; aucun pour des kilomètres. Libéré au retrait du brouillon.';
comment on column public.notes_de_frais.motif_refus is
  'Le motif du refus, saisi par l''accès « Achats » ou par le cabinet, que l''auteur de la note LIT : un écran du cabinet qui le saisit le dit dans son libellé.';
comment on column public.notes_de_frais.moyen_remboursement is
  'virement, cheque, especes, paie (avec la paie) ou autre — déclaré : rien ne s''écrit dans le relevé ni la caisse.';
comment on column public.notes_de_frais.version is
  'La version de la note, d''un pas à chaque écriture de ses fonctions, qui la retiennent : une saisie remplace la version lue.';

-- ══ 2. Les gardes ══════════
-- Avant la RLS, aux droits de l'appelant. Le retrait d'une ligne n'est admis qu'avec son dossier (la cascade : il n'est déjà
-- plus là).
create function public.garder_note_de_frais() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_passage text[];
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une note de frais ne part qu''avec son dossier : un brouillon se retire, une note soumise reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if coalesce(current_setting('jd.notes_de_frais', true), '') <> new.id::text and not public.is_super_admin() then
      raise exception 'Une note de frais ne s''écrit que par ses fonctions.' using errcode = '42501';
    end if;
  else
    if coalesce(current_setting('jd.notes_de_frais', true), '') <> old.id::text then
      raise exception 'Une note de frais ne s''écrit que par ses fonctions.' using errcode = '42501';
    end if;
    if new.id <> old.id or new.dossier_id <> old.dossier_id or new.auteur <> old.auteur or new.cree_le <> old.cree_le then
      raise exception 'L''auteur, le dossier et la création d''une note de frais ne changent pas.' using errcode = '23514';
    end if;
    if not ((old.etat = 'brouillon' and new.etat in ('brouillon', 'soumise', 'retiree'))
            or (old.etat = 'soumise' and new.etat in ('approuvee', 'refusee'))
            or (old.etat = 'approuvee' and new.etat = 'remboursee')) then
      raise exception 'Une note de frais passe d''un brouillon à soumise ou retirée, de soumise à approuvée ou refusée, d''approuvée à remboursée : rien d''autre.'
        using errcode = '23514';
    end if;
    -- Une note soumise ne se réécrit pas : seul son passage suivant s'y ajoute.
    if old.etat <> 'brouillon' then
      v_passage := case new.etat
                     when 'approuvee' then array['approuvee_par', 'approuvee_le']
                     when 'refusee' then array['refusee_par', 'refusee_le', 'motif_refus']
                     else array['remboursee_par', 'remboursee_le', 'date_remboursement', 'moyen_remboursement'] end;
      if (to_jsonb(new) - array['etat', 'version', 'modifiee_le'] - v_passage)
         <> (to_jsonb(old) - array['etat', 'version', 'modifiee_le'] - v_passage) then
        raise exception 'Une note de frais soumise ne se réécrit pas : seul son passage suivant s''y ajoute.' using errcode = '23514';
      end if;
    end if;
  end if;
  if new.piece_id is not null
     and not exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id) then
    raise exception 'Une note de frais cite un justificatif de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create function public.garder_piece_d_une_note_de_frais() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.dossier_id = old.dossier_id then
    return new;
  end if;
  if exists (select 1 from public.notes_de_frais n where n.piece_id = old.id)
     and exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    raise exception 'Cette pièce est le justificatif d''une note de frais : elle ne se supprime ni ne change de dossier tant que la note la cite.'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

comment on function public.garder_note_de_frais() is
  'La garde de notes_de_frais (étape B7) : une ligne ne s''écrit que par ses fonctions (jd.notes_de_frais) ou par la restauration du super-administrateur (42501) ; l''auteur, le dossier et la création ne changent pas, les passages suivent leur liste, une note soumise ne se réécrit pas, le justificatif est de son dossier, une ligne ne part qu''avec son dossier (23514).';
comment on function public.garder_piece_d_une_note_de_frais() is
  'La garde des pièces citées par une note de frais (étape B7) : le justificatif d''une note ne se supprime ni ne change de dossier tant qu''une note le cite (23514) ; avec son dossier, il part.';

create trigger notes_de_frais_garde
  before insert or update or delete on public.notes_de_frais
  for each row execute function public.garder_note_de_frais();
create trigger pieces_justificatif_d_une_note_de_frais
  before delete or update of dossier_id on public.pieces
  for each row execute function public.garder_piece_d_une_note_de_frais();

-- ══ 3. Qui lit ══════════
alter table public.notes_de_frais enable row level security;

create policy notes_de_frais_lecture on public.notes_de_frais
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy notes_de_frais_lecture_auteur on public.notes_de_frais
  for select to authenticated using (auteur = (select auth.uid()) and client_du_dossier(dossier_id, 'frais'));
create policy notes_de_frais_lecture_achats on public.notes_de_frais
  for select to authenticated using (etat not in ('brouillon', 'retiree') and client_du_dossier(dossier_id, 'achats'));
create policy notes_de_frais_restauration on public.notes_de_frais
  for insert to authenticated with check (is_super_admin());

-- La double authentification exigée (migration `deux_facteurs_exiges`, préparée) pose sa policy restrictive sur chaque
-- table de public : appliquée avant celle-ci, la table neuve la reçoit ici, à l'identique.
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.notes_de_frais as restrictive for all to authenticated '
            'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;

-- ══ 4. Enregistrer un brouillon ══════════
-- Créer (p_note_id nul) ou modifier un brouillon, à la version lue. Le montant des kilomètres est celui que l'application a
-- calculé (src/lib/baremeKilometrique.ts) : la base le VÉRIFIE au barème qu'elle tient, de l'année de la dépense.
create function public.enregistrer_note_de_frais(
  p_dossier_id uuid, p_note_id uuid, p_version_lue integer, p_date date, p_nature text, p_motif text,
  p_montant_ttc numeric, p_montant_tva numeric, p_beneficiaire_salarie text, p_piece_id uuid,
  p_distance_km integer, p_vehicule_type text, p_puissance_fiscale integer, p_electrique boolean)
  returns public.notes_de_frais
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_note public.notes_de_frais;
  v_piece public.pieces;
  v_annee integer;
  v_centimes bigint;
  v_id uuid;
begin
  -- 1. L'accès : un accès « Notes de frais » du dossier ; le cabinet ne saisit pas à la place du client.
  if p_dossier_id is null or not public.client_du_dossier(p_dossier_id, 'frais') then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2. Un brouillon existant : le sien, de ce dossier, relu sous verrou, à la version lue.
  if p_note_id is not null then
    select n.* into v_note from public.notes_de_frais n where n.id = p_note_id;
    if v_note.id is null or v_note.dossier_id <> p_dossier_id or v_note.auteur <> auth.uid() then
      raise exception 'Accès refusé à cette note de frais.' using errcode = '42501';
    end if;
    select n.* into v_note from public.notes_de_frais n where n.id = p_note_id for update;
    if v_note.etat <> 'brouillon' then
      raise exception 'Cette note de frais n''est plus un brouillon : elle ne se modifie plus.' using errcode = '22023';
    end if;
    if v_note.version is distinct from p_version_lue then
      raise exception 'Cette note de frais a changé depuis sa lecture : la relire avant de l''écrire.' using errcode = '22023';
    end if;
  end if;
  -- 3. La note d'un salarié sans accès : saisie par l'accès « Achats » (le dirigeant) seul (MEG2-Q6, B7-Q1).
  if p_beneficiaire_salarie is not null then
    if not public.client_du_dossier(p_dossier_id, 'achats') then
      raise exception 'Seul un accès « Achats » saisit la note d''un salarié sans accès.' using errcode = '42501';
    end if;
    if p_beneficiaire_salarie <> btrim(p_beneficiaire_salarie) or p_beneficiaire_salarie = ''
       or length(p_beneficiaire_salarie) > 120 or p_beneficiaire_salarie ~ '[[:cntrl:]]' then
      raise exception 'Le nom du salarié tient sur une ligne, d''un à cent vingt caractères, sans blanc en tête ni en fin.'
        using errcode = '22023';
    end if;
  end if;
  -- 4. La date, la nature, le motif.
  if p_date is null or p_date < date '2000-01-01' or p_date > (now() at time zone 'Europe/Paris')::date then
    raise exception 'La date de la dépense est requise, entre le 1er janvier 2000 et aujourd''hui.' using errcode = '22023';
  end if;
  if p_nature is null or p_nature not in ('repas', 'hebergement', 'transport', 'carburant', 'peage_stationnement',
                                          'fournitures', 'kilometres', 'autre') then
    raise exception 'La nature de la dépense est repas, hébergement, transport, carburant, péage et stationnement, fournitures, kilomètres ou autre.'
      using errcode = '22023';
  end if;
  if p_motif is null or btrim(p_motif) = '' or length(p_motif) > 200 or p_motif ~ '[[:cntrl:]]' then
    raise exception 'Le motif tient sur une ligne, d''un à deux cents caractères.' using errcode = '22023';
  end if;
  -- 5. Des kilomètres : la distance et le véhicule, ni TVA ni justificatif, au barème de l'année de la dépense — celui que
  --    la base tient, jamais recopié ni emprunté à une autre année (MEG2-Q8 ; B7-Q3 : le barème appliqué à la distance de
  --    la note, le cumul de l'année signalé par l'écran, jamais recalculé ici).
  if p_nature = 'kilometres' then
    if p_distance_km is null or p_distance_km < 1 or p_distance_km > 100000 then
      raise exception 'La distance est un nombre entier de kilomètres, de 1 à 100 000.' using errcode = '22023';
    end if;
    if p_vehicule_type is null or p_vehicule_type not in ('voiture', 'moto', 'cyclomoteur') or p_puissance_fiscale is null
       or p_puissance_fiscale < 0 or p_puissance_fiscale > 99 or p_electrique is null then
      raise exception 'Le véhicule se décrit par son type (voiture, moto ou cyclomoteur), sa puissance fiscale et sa motorisation, électrique ou non.'
        using errcode = '22023';
    end if;
    if coalesce(p_montant_tva, 0) <> 0 then
      raise exception 'Des kilomètres ne portent pas de TVA.' using errcode = '22023';
    end if;
    if p_piece_id is not null then
      raise exception 'Des kilomètres ne citent pas de justificatif : la date, la distance et le motif les justifient.'
        using errcode = '22023';
    end if;
    v_annee := extract(year from p_date)::integer;
    v_centimes := public.indemnite_kilometrique_centimes(v_annee, p_vehicule_type, p_puissance_fiscale, p_electrique, p_distance_km);
    if v_centimes is null then
      raise exception 'Le barème kilométrique de % n''est pas en base pour ce véhicule : rien ne se calcule à sa place.', v_annee
        using errcode = '22023';
    end if;
    if p_montant_ttc is null or p_montant_ttc * 100 <> v_centimes then
      raise exception 'Le montant des kilomètres est celui du barème de % pour cette distance et ce véhicule.', v_annee
        using errcode = '22023';
    end if;
  else
    if p_distance_km is not null or p_vehicule_type is not null or p_puissance_fiscale is not null or p_electrique is not null then
      raise exception 'Seuls des kilomètres décrivent une distance et un véhicule.' using errcode = '22023';
    end if;
    if p_montant_ttc is null or p_montant_ttc <= 0 or p_montant_ttc > 9999999999.99 or p_montant_ttc <> round(p_montant_ttc, 2) then
      raise exception 'Le montant TTC est un nombre positif, au centime près.' using errcode = '22023';
    end if;
    if p_montant_tva is not null
       and (p_montant_tva < 0 or p_montant_tva >= p_montant_ttc or p_montant_tva <> round(p_montant_tva, 2)) then
      raise exception 'La TVA déclarée est positive ou nulle, au centime près, et moindre que le TTC.' using errcode = '22023';
    end if;
  end if;
  -- 6. Le justificatif : une pièce que l'appelant a déposée dans ce dossier, encore à valider, qu'aucune autre note ne cite
  --    (B7-Q2) — validée, elle compterait déjà pour le cabinet, et la note la ferait compter deux fois.
  if p_piece_id is not null then
    select p.* into v_piece from public.pieces p where p.id = p_piece_id;
    if v_piece.id is null or v_piece.dossier_id <> p_dossier_id or v_piece.uploaded_by is distinct from auth.uid() then
      raise exception 'Le justificatif est une pièce que l''auteur de la note a déposée dans ce dossier.' using errcode = '22023';
    end if;
    if v_piece.statut <> 'a_valider' then
      raise exception 'Ce justificatif est déjà validé par le cabinet : il ne justifie plus une note de frais.' using errcode = '22023';
    end if;
    if exists (select 1 from public.notes_de_frais n where n.piece_id = p_piece_id and n.id is distinct from p_note_id) then
      raise exception 'Ce justificatif est déjà celui d''une autre note de frais.' using errcode = '22023';
    end if;
  end if;
  if p_note_id is null then
    v_id := gen_random_uuid();
    perform set_config('jd.notes_de_frais', v_id::text, true);
    insert into public.notes_de_frais (id, dossier_id, auteur, beneficiaire_salarie, date_depense, nature, motif, montant_ttc,
                                       montant_tva, distance_km, vehicule_type, puissance_fiscale, electrique, piece_id)
    values (v_id, p_dossier_id, auth.uid(), p_beneficiaire_salarie, p_date, p_nature, p_motif, p_montant_ttc,
            coalesce(p_montant_tva, 0), p_distance_km, p_vehicule_type, p_puissance_fiscale, p_electrique, p_piece_id)
    returning * into v_note;
  else
    perform set_config('jd.notes_de_frais', v_note.id::text, true);
    update public.notes_de_frais
       set beneficiaire_salarie = p_beneficiaire_salarie, date_depense = p_date, nature = p_nature, motif = p_motif,
           montant_ttc = p_montant_ttc, montant_tva = coalesce(p_montant_tva, 0), distance_km = p_distance_km,
           vehicule_type = p_vehicule_type, puissance_fiscale = p_puissance_fiscale, electrique = p_electrique,
           piece_id = p_piece_id, version = version + 1, modifiee_le = now()
     where id = v_note.id
    returning * into v_note;
  end if;
  perform set_config('jd.notes_de_frais', '', true);
  return v_note;
end;
$$;

comment on function public.enregistrer_note_de_frais(uuid, uuid, integer, date, text, text, numeric, numeric, text, uuid, integer, text, integer, boolean) is
  'Crée (p_note_id nul) ou modifie, à la version lue, un brouillon de note de frais (étape B7) : l''accès « Notes de frais » du dossier, et « Achats » en plus pour la note d''un salarié sans accès ; des kilomètres au montant du barème de l''année de la dépense, vérifié par indemnite_kilometrique_centimes ; le justificatif, une pièce que l''appelant a déposée dans ce dossier, encore à valider, qu''aucune autre note ne cite. Rend la note.';

-- ══ 5. Soumettre et retirer un brouillon : son auteur ══════════
create function public.soumettre_note_de_frais(p_note_id uuid, p_version_lue integer) returns public.notes_de_frais
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_note public.notes_de_frais;
  v_statut text;
  v_annee integer;
  v_centimes bigint;
begin
  select n.* into v_note from public.notes_de_frais n where n.id = p_note_id;
  if v_note.id is null or v_note.auteur <> auth.uid() or not public.client_du_dossier(v_note.dossier_id, 'frais') then
    raise exception 'Accès refusé à cette note de frais.' using errcode = '42501';
  end if;
  if v_note.beneficiaire_salarie is not null and not public.client_du_dossier(v_note.dossier_id, 'achats') then
    raise exception 'Seul un accès « Achats » saisit la note d''un salarié sans accès.' using errcode = '42501';
  end if;
  select n.* into v_note from public.notes_de_frais n where n.id = p_note_id for update;
  if v_note.etat <> 'brouillon' then
    raise exception 'Cette note de frais n''est plus un brouillon : elle ne se modifie plus.' using errcode = '22023';
  end if;
  if v_note.version is distinct from p_version_lue then
    raise exception 'Cette note de frais a changé depuis sa lecture : la relire avant de l''écrire.' using errcode = '22023';
  end if;
  if v_note.nature = 'kilometres' then
    v_annee := extract(year from v_note.date_depense)::integer;
    v_centimes := public.indemnite_kilometrique_centimes(v_annee, v_note.vehicule_type, v_note.puissance_fiscale,
                                                         v_note.electrique, v_note.distance_km);
    if v_centimes is null then
      raise exception 'Le barème kilométrique de % n''est pas en base pour ce véhicule : rien ne se calcule à sa place.', v_annee
        using errcode = '22023';
    end if;
    if v_note.montant_ttc * 100 <> v_centimes then
      raise exception 'Le barème kilométrique de % a changé depuis l''enregistrement de la note : l''enregistrer de nouveau.', v_annee
        using errcode = '22023';
    end if;
  else
    if v_note.piece_id is null then
      raise exception 'Une note de frais se soumet avec son justificatif.' using errcode = '22023';
    end if;
    select p.statut into v_statut from public.pieces p where p.id = v_note.piece_id;
    if v_statut is distinct from 'a_valider' then
      raise exception 'Ce justificatif est déjà validé par le cabinet : il ne justifie plus une note de frais.' using errcode = '22023';
    end if;
  end if;
  perform set_config('jd.notes_de_frais', v_note.id::text, true);
  update public.notes_de_frais set etat = 'soumise', soumise_le = now(), version = version + 1, modifiee_le = now()
   where id = v_note.id
  returning * into v_note;
  perform set_config('jd.notes_de_frais', '', true);
  return v_note;
end;
$$;

comment on function public.soumettre_note_de_frais(uuid, integer) is
  'Soumet un brouillon de note de frais, à la version lue (étape B7) : son auteur, encore accès « Notes de frais » du dossier (et « Achats » pour la note d''un salarié) ; le justificatif encore à valider, ou des kilomètres au barème de leur année. Une note soumise ne se réécrit plus. Rend la note.';

create function public.retirer_note_de_frais(p_note_id uuid, p_version_lue integer) returns public.notes_de_frais
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_note public.notes_de_frais;
begin
  select n.* into v_note from public.notes_de_frais n where n.id = p_note_id;
  if v_note.id is null or v_note.auteur <> auth.uid() or not public.client_du_dossier(v_note.dossier_id, 'frais') then
    raise exception 'Accès refusé à cette note de frais.' using errcode = '42501';
  end if;
  if v_note.beneficiaire_salarie is not null and not public.client_du_dossier(v_note.dossier_id, 'achats') then
    raise exception 'Seul un accès « Achats » saisit la note d''un salarié sans accès.' using errcode = '42501';
  end if;
  select n.* into v_note from public.notes_de_frais n where n.id = p_note_id for update;
  if v_note.etat <> 'brouillon' then
    raise exception 'Seul un brouillon se retire : une note soumise reste.' using errcode = '22023';
  end if;
  if v_note.version is distinct from p_version_lue then
    raise exception 'Cette note de frais a changé depuis sa lecture : la relire avant de l''écrire.' using errcode = '22023';
  end if;
  perform set_config('jd.notes_de_frais', v_note.id::text, true);
  update public.notes_de_frais set etat = 'retiree', retiree_le = now(), piece_id = null, version = version + 1, modifiee_le = now()
   where id = v_note.id
  returning * into v_note;
  perform set_config('jd.notes_de_frais', '', true);
  return v_note;
end;
$$;

comment on function public.retirer_note_de_frais(uuid, integer) is
  'Retire un brouillon de note de frais, à la version lue (étape B7) : son auteur, aux mêmes cases que pour le soumettre ; la ligne reste, retirée, et son justificatif est libéré. Une note soumise ne se retire pas. Rend la note.';

-- ══ 6. Décider : approuver, refuser, rembourser — l'accès « Achats », ou le cabinet ══════════
-- Le brouillon d'un autre compte reste caché à l'accès « Achats », comme à sa lecture : les mêmes mots qu'une note inconnue.
create function public.approuver_note_de_frais(p_note_id uuid, p_version_lue integer) returns public.notes_de_frais
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_note public.notes_de_frais;
begin
  select n.* into v_note from public.notes_de_frais n where n.id = p_note_id;
  if v_note.id is null
     or not (public.admin_du_dossier(v_note.dossier_id)
             or (public.client_du_dossier(v_note.dossier_id, 'achats')
                 and (v_note.etat not in ('brouillon', 'retiree') or v_note.auteur = auth.uid()))) then
    raise exception 'Accès refusé à cette note de frais.' using errcode = '42501';
  end if;
  select n.* into v_note from public.notes_de_frais n where n.id = p_note_id for update;
  if v_note.etat <> 'soumise' then
    raise exception 'Seule une note soumise s''approuve ou se refuse.' using errcode = '22023';
  end if;
  if v_note.version is distinct from p_version_lue then
    raise exception 'Cette note de frais a changé depuis sa lecture : la relire avant de l''écrire.' using errcode = '22023';
  end if;
  perform set_config('jd.notes_de_frais', v_note.id::text, true);
  update public.notes_de_frais set etat = 'approuvee', approuvee_par = auth.uid(), approuvee_le = now(), version = version + 1,
         modifiee_le = now()
   where id = v_note.id
  returning * into v_note;
  perform set_config('jd.notes_de_frais', '', true);
  return v_note;
end;
$$;

comment on function public.approuver_note_de_frais(uuid, integer) is
  'Approuve une note de frais soumise, à la version lue (étape B7 ; MEG2-Q6) : l''accès « Achats » du dossier ou le cabinet du dossier ; signée et datée. Rend la note.';

create function public.refuser_note_de_frais(p_note_id uuid, p_version_lue integer, p_motif text) returns public.notes_de_frais
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_note public.notes_de_frais;
begin
  select n.* into v_note from public.notes_de_frais n where n.id = p_note_id;
  if v_note.id is null
     or not (public.admin_du_dossier(v_note.dossier_id)
             or (public.client_du_dossier(v_note.dossier_id, 'achats')
                 and (v_note.etat not in ('brouillon', 'retiree') or v_note.auteur = auth.uid()))) then
    raise exception 'Accès refusé à cette note de frais.' using errcode = '42501';
  end if;
  select n.* into v_note from public.notes_de_frais n where n.id = p_note_id for update;
  if v_note.etat <> 'soumise' then
    raise exception 'Seule une note soumise s''approuve ou se refuse.' using errcode = '22023';
  end if;
  if v_note.version is distinct from p_version_lue then
    raise exception 'Cette note de frais a changé depuis sa lecture : la relire avant de l''écrire.' using errcode = '22023';
  end if;
  if p_motif is null or btrim(p_motif) = '' or length(p_motif) > 200 or p_motif ~ '[[:cntrl:]]' then
    raise exception 'Le motif du refus tient sur une ligne, d''un à deux cents caractères.' using errcode = '22023';
  end if;
  perform set_config('jd.notes_de_frais', v_note.id::text, true);
  update public.notes_de_frais set etat = 'refusee', refusee_par = auth.uid(), refusee_le = now(), motif_refus = p_motif,
         version = version + 1, modifiee_le = now()
   where id = v_note.id
  returning * into v_note;
  perform set_config('jd.notes_de_frais', '', true);
  return v_note;
end;
$$;

comment on function public.refuser_note_de_frais(uuid, integer, text) is
  'Refuse une note de frais soumise, à la version lue, sous un motif d''une ligne que son auteur lit (étape B7) : l''accès « Achats » du dossier ou le cabinet du dossier ; signée et datée. Rend la note.';

create function public.rembourser_note_de_frais(p_note_id uuid, p_version_lue integer, p_date date, p_moyen text)
  returns public.notes_de_frais
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_note public.notes_de_frais;
begin
  select n.* into v_note from public.notes_de_frais n where n.id = p_note_id;
  if v_note.id is null
     or not (public.admin_du_dossier(v_note.dossier_id)
             or (public.client_du_dossier(v_note.dossier_id, 'achats')
                 and (v_note.etat not in ('brouillon', 'retiree') or v_note.auteur = auth.uid()))) then
    raise exception 'Accès refusé à cette note de frais.' using errcode = '42501';
  end if;
  select n.* into v_note from public.notes_de_frais n where n.id = p_note_id for update;
  if v_note.etat <> 'approuvee' then
    raise exception 'Seule une note approuvée se rembourse.' using errcode = '22023';
  end if;
  if v_note.version is distinct from p_version_lue then
    raise exception 'Cette note de frais a changé depuis sa lecture : la relire avant de l''écrire.' using errcode = '22023';
  end if;
  if p_date is null or p_date < v_note.date_depense or p_date > (now() at time zone 'Europe/Paris')::date then
    raise exception 'La date du remboursement est requise, entre la date de la dépense et aujourd''hui.' using errcode = '22023';
  end if;
  if p_moyen is null or p_moyen not in ('virement', 'cheque', 'especes', 'paie', 'autre') then
    raise exception 'Le moyen du remboursement est virement, chèque, espèces, avec la paie ou autre.' using errcode = '22023';
  end if;
  perform set_config('jd.notes_de_frais', v_note.id::text, true);
  update public.notes_de_frais set etat = 'remboursee', remboursee_par = auth.uid(), remboursee_le = now(),
         date_remboursement = p_date, moyen_remboursement = p_moyen, version = version + 1, modifiee_le = now()
   where id = v_note.id
  returning * into v_note;
  perform set_config('jd.notes_de_frais', '', true);
  return v_note;
end;
$$;

comment on function public.rembourser_note_de_frais(uuid, integer, date, text) is
  'Déclare le remboursement d''une note de frais approuvée, à la version lue (étape B7 ; MEG2-Q6) : l''accès « Achats » du dossier ou le cabinet du dossier ; la date et le moyen ; rien ne s''écrit dans le relevé, la caisse ni les écritures. Rend la note.';

-- ══ 7. Le compte du personnel, au catalogue des rôles comptables (MEG2-Q7, ligne 43 ; B7-Q4) ══════════
insert into public.roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre)
values ('personnel', array['421', '4286'], '421000', 'Personnel — rémunérations dues', null, 330);

-- ══ 8. Les droits d'exécution ══════════
revoke execute on function public.enregistrer_note_de_frais(uuid, uuid, integer, date, text, text, numeric, numeric, text, uuid, integer, text, integer, boolean) from public, anon;
grant execute on function public.enregistrer_note_de_frais(uuid, uuid, integer, date, text, text, numeric, numeric, text, uuid, integer, text, integer, boolean) to authenticated;
revoke execute on function public.soumettre_note_de_frais(uuid, integer) from public, anon;
grant execute on function public.soumettre_note_de_frais(uuid, integer) to authenticated;
revoke execute on function public.retirer_note_de_frais(uuid, integer) from public, anon;
grant execute on function public.retirer_note_de_frais(uuid, integer) to authenticated;
revoke execute on function public.approuver_note_de_frais(uuid, integer) from public, anon;
grant execute on function public.approuver_note_de_frais(uuid, integer) to authenticated;
revoke execute on function public.refuser_note_de_frais(uuid, integer, text) from public, anon;
grant execute on function public.refuser_note_de_frais(uuid, integer, text) to authenticated;
revoke execute on function public.rembourser_note_de_frais(uuid, integer, date, text) from public, anon;
grant execute on function public.rembourser_note_de_frais(uuid, integer, date, text) to authenticated;
revoke execute on function public.garder_note_de_frais() from public, anon, authenticated;
revoke execute on function public.garder_piece_d_une_note_de_frais() from public, anon, authenticated;
