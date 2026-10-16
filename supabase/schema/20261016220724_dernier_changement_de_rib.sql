-- LE DERNIER CHANGEMENT DU RIB DES FACTURES D'UN DOSSIER, EN BASE (espace client, étape A5b3a ; ligne 51.5 ; conception :
-- HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.5.2,
-- « LA FRAUDE AU FAUX RIB »). Présentée au cabinet avant d'être appliquée : elle OUVRE à l'accès client qui porte la case
-- « Banque » une lecture qu'il n'a pas (CLAUDE.md, « une policy qui lui ouvre une lecture se présente au cabinet »).
--
-- POURQUOI. Un accès « Ventes » peut être une secrétaire, un compte volé, un prestataire : changer le RIB que portent les
-- factures détourne les paiements de tous les clients du client. Depuis l'étape A5a, un RIB qu'un accès client pose ou
-- change n'est que PROPOSÉ, et seul le cabinet le confirme (MEG1-Q12) ; reste à DIRE chaque changement, sur l'accueil du
-- cabinet et à tous les accès « Ventes » et « Banque » du dossier (« Le RIB de tes factures a changé le … »). Le cabinet et
-- l'accès « Ventes » lisent la table des paramètres ; l'accès qui ne porte que « Banque » ne la lit pas, et ne doit pas la
-- lire : elle porte l'IBAN, les conditions de paiement et les auteurs. Décision du cabinet du 16/10/2026 (A5-Q2, « comme
-- recommandé ») : il n'apprend d'un changement de RIB que le JOUR, son AUTEUR — le cabinet ou un accès client, jamais la
-- personne — et son ÉTAT, jamais l'IBAN, le BIC ni le titulaire, par une FONCTION de la base.
--
-- CE QU'ELLE POSE : une fonction de LECTURE, `dernier_changement_de_rib(dossier)`, et rien d'autre — aucune table, aucune
-- policy, aucune donnée lue ni écrite d'avance ; la table des paramètres, sa garde et les deux fonctions qui l'écrivent
-- (étape A5a) ne changent pas.
--
-- QUI : le cabinet du dossier (`admin_du_dossier` : le chef du cabinet, un membre affecté au dossier, le
-- super-administrateur) et un accès client du dossier qui porte la case « Ventes » ou la case « Banque »
-- (`client_du_dossier(…, 'ventes')`, `client_du_dossier(…, 'banque')`), sur un dossier qui existe. Tout autre appelant —
-- un accès sans aucune case, l'accès d'un autre dossier, un membre du cabinet hors de ses dossiers, un compte rattaché à
-- rien — reçoit « Accès refusé à ce dossier. » (42501), comme aux fonctions voisines, sans apprendre si le dossier
-- existe ; l'anonyme ne l'exécute pas. L'accès se juge AVANT toute lecture des paramètres.
--
-- CE QU'EST UN CHANGEMENT. Le RIB des factures est celui que porte une version des paramètres : l'IBAN, le BIC et le
-- titulaire du compte, ENSEMBLE — comme `enregistrer_parametres_facturation` juge un RIB « inchangé ». Deux sortes de
-- changement, et elles seules :
--   - une VERSION qui pose un RIB (la version qu'elle remplace n'en avait pas, ou elle est la première), le CHANGE (l'IBAN,
--     le BIC ou le titulaire diffère) ou le RETIRE (elle n'a plus d'IBAN) — à l'instant de la version ;
--   - la CONFIRMATION d'un RIB qui était PROPOSÉ (`confirmer_rib`, le cabinet seul) — à l'instant de la confirmation.
-- N'en sont pas : une version qui ne touche pas au RIB (le délai, le moyen, un texte, ou la même saisie réenregistrée) — le
-- RIB qu'elle reprend tel quel garde son état et sa confirmation (A5-Q4 : un RIB proposé ne se confirme jamais en passant)
-- — ; une première version sans RIB.
-- Le DERNIER changement est le dernier dans l'ordre de la CHAÎNE des versions (`remplace_id`, depuis la première) — une
-- version, puis la confirmation de son RIB s'il en a une —, jamais dans l'ordre des instants : une même transaction donne
-- le même instant à tout ce qu'elle écrit, et un RIB ne se confirme que sur la version COURANTE (la garde de la table),
-- donc avant la version qui la remplace.
--
-- SON AUTEUR — `cabinet`, `client` ou `inconnu` —, tiré de ce que la base a ÉCRIT, jamais deviné :
--   - un RIB posé ou changé et confirmé D'EMBLÉE (par l'auteur de la version, à l'instant même de la version) :
--     `enregistrer_parametres_facturation` ne confirme ainsi que pour le cabinet du dossier → `cabinet` ;
--   - un RIB posé ou changé et PROPOSÉ — encore proposé, ou confirmé ENSUITE (après la version, ou à son instant par un
--     autre compte) : la fonction ne propose que pour un accès client « Ventes » → `client` ;
--   - une confirmation : `confirmer_rib` n'est ouverte qu'au cabinet du dossier → `cabinet` ;
--   - un RETRAIT : la version n'écrit aucun état du RIB, et rien n'y dit si son auteur était du cabinet ou un accès client
--     → `inconnu` (A5B3-Q3) ; ses accès d'aujourd'hui ne disent pas ceux d'hier ;
--   - une confirmation datée d'AVANT sa version, que les deux fonctions n'écrivent jamais (une ligne restaurée qu'on aurait
--     changée) → `inconnu` ; la version qu'elle confirme la précède dans la chaîne, et n'est donc jamais la dernière.
--
-- SON ÉTAT, après lui — celui d'aujourd'hui, puisque rien n'a changé le RIB depuis : `propose` (il attend la confirmation
-- du cabinet), `confirme`, `retire`.
--
-- CE QU'IL A FAIT AU RIB EN VIGUEUR, celui qu'une facture verrait : le RIB de la version courante s'il est confirmé ;
-- sinon, en remontant la chaîne au-delà des versions où il n'est que proposé, celui de la première qui en a un confirmé, ou
-- aucun (src/lib/parametresFacturation.ts, `ribEnVigueur`, que l'étape A7 lira de même). `aucun` : aucun RIB en vigueur,
-- avant comme après (un RIB proposé, ou retiré, quand rien n'était confirmé) ; `inchange` : le même avant et après (un RIB
-- proposé, ou que le cabinet confirme ou pose tel qu'il était déjà en vigueur) ; `pose` : aucun avant, un après ;
-- `change` : un autre après ; `retire` : un avant, aucun après. Sans lui, un écran ne saurait pas dire juste si les
-- factures gardent leur RIB ou en changent.
--
-- SON JOUR, à Paris — le jour seul, ni l'heure ni l'instant (A5B3-Q7) : l'avis dit « le … », et le jour suffit à
-- reconnaître un changement qu'on attendait ou à s'alarmer d'un autre.
--
-- CE QU'ELLE NE REND JAMAIS : l'IBAN, le BIC, le titulaire du compte — ni leur longueur, ni leur empreinte, ni leur pays —,
-- l'identifiant d'un compte (auteur, confirmateur), l'identifiant d'une version, les conditions de paiement, l'heure.
--
-- SOUS QUELLE FORME : UNE valeur, toujours un objet — `{"changement": null}` quand le RIB des factures du dossier n'a
-- jamais changé (aucune version, ou aucune qui porte un RIB), sinon
-- `{"changement": {"jour": "AAAA-MM-JJ", "geste": "pose" | "change" | "retire" | "confirme",
-- "auteur": "cabinet" | "client" | "inconnu", "etat": "propose" | "confirme" | "retire",
-- "rib_en_vigueur": "aucun" | "inchange" | "pose" | "change" | "retire"}}`.
-- Un objet plutôt qu'un nul nu : « aucun changement » est une AFFIRMATION de la base, qu'une lecture ratée ne doit jamais
-- pouvoir imiter (src/lib/changementDeRib.ts lit toute autre forme comme illisible).
--
-- POURQUOI UNE FONCTION, ET NON UNE POLICY. Une policy de lecture ouvrirait à l'accès « Banque » TOUTES les colonnes de
-- toutes les versions — l'IBAN, le titulaire, les auteurs : le droit de lire une colonne se donne à un rôle, et le cabinet
-- et le client sont le même rôle (`authenticated`). La fonction, `SECURITY DEFINER` à `search_path` fixé, vérifie l'accès
-- avant toute lecture et ne rend que cinq mots (documentation de PostgreSQL, « Writing SECURITY DEFINER Functions
-- Safely » ; règlement (UE) 2016/679, art. 25 § 2 : par défaut, seules les données nécessaires sont rendues accessibles) —
-- le patron de `pieces_jointes_ecartees_du_client` (ligne 22.9) et d'`etat_facture_electronique` (étape A6a).
--
-- CE QU'ELLE SUPPOSE : la migration de l'étape A5a (`parametres_facturation`) ; son premier bloc le vérifie.
-- CE QU'ELLE NE FAIT PAS : aucun écran (l'avis sur les accueils : étape A5b3b), aucune marque « vu » (A5B3-Q4), aucune
-- Edge Function. Le texte ne porte aucune instruction qui retire quoi que ce soit : le retour arrière est donné à part, et
-- ne vient qu'après le drapeau `CHANGEMENT_DE_RIB_EXPORTE` (src/lib/changementDeRib.ts) rebaissé en ligne.

-- ══ 0. La migration de l'étape A5a d'abord ══════════
do $garde$
begin
  if to_regclass('public.parametres_facturation') is null
     or to_regprocedure('public.client_du_dossier(uuid, text)') is null then
    raise exception 'La migration de l''étape A5a (parametres_facturation) n''est pas en base : l''appliquer d''abord, puis celle-ci.';
  end if;
end
$garde$;

-- ══ 1. Le dernier changement du RIB des factures d'un dossier ══════════
create function public.dernier_changement_de_rib(p_dossier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v record;
  -- Le RIB de la version précédente de la chaîne, et son état (aucun avant la première).
  v_prec_iban text;
  v_prec_bic text;
  v_prec_titulaire text;
  v_prec_etat text;
  -- Le RIB en vigueur — celui qu'une facture verrait — après ce qui a été parcouru (aucun d'abord), et juste avant
  -- l'événement en cours.
  v_vigueur_iban text;
  v_vigueur_bic text;
  v_vigueur_titulaire text;
  v_avant_iban text;
  v_avant_bic text;
  v_avant_titulaire text;
  -- La version change-t-elle le RIB ; son RIB était-il PROPOSÉ à sa création ?
  v_change boolean;
  v_propose boolean;
  v_dernier jsonb;
begin
  if not (public.admin_du_dossier(p_dossier_id)
          or public.client_du_dossier(p_dossier_id, 'ventes')
          or public.client_du_dossier(p_dossier_id, 'banque'))
     or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  -- La chaîne du dossier, de la première version à la courante : une seule première par dossier, une seule suite par
  -- version, une suite toujours de son dossier (la migration de l'étape A5a) — toutes les versions y sont, une fois.
  for v in
    with recursive chaine as (
      select p.id, p.iban, p.bic, p.titulaire_compte, p.rib_etat, p.rib_confirme_par, p.rib_confirme_le, p.auteur, p.cree_le,
             1 as rang
        from public.parametres_facturation p
       where p.dossier_id = p_dossier_id and p.remplace_id is null
      union all
      select s.id, s.iban, s.bic, s.titulaire_compte, s.rib_etat, s.rib_confirme_par, s.rib_confirme_le, s.auteur, s.cree_le,
             c.rang + 1
        from public.parametres_facturation s
        join chaine c on s.remplace_id = c.id
    )
    select * from chaine order by rang
  loop
    v_change := (v.iban, v.bic, v.titulaire_compte) is distinct from (v_prec_iban, v_prec_bic, v_prec_titulaire);
    -- Proposé à sa création : un RIB posé ou changé l'est, sauf confirmé d'emblée par l'auteur de la version, à son instant
    -- (le cabinet) ; un RIB repris tel quel a l'état de la version qu'il reprend.
    v_propose := v.iban is not null and case
      when v_change then not (v.rib_etat = 'confirme' and v.rib_confirme_par = v.auteur and v.rib_confirme_le = v.cree_le)
      else v_prec_etat = 'propose'
    end;
    v_avant_iban := v_vigueur_iban;
    v_avant_bic := v_vigueur_bic;
    v_avant_titulaire := v_vigueur_titulaire;
    if v.iban is null then
      v_vigueur_iban := null;
      v_vigueur_bic := null;
      v_vigueur_titulaire := null;
    elsif not v_propose then
      v_vigueur_iban := v.iban;
      v_vigueur_bic := v.bic;
      v_vigueur_titulaire := v.titulaire_compte;
    end if;
    -- La version pose, change ou retire le RIB.
    if v_change then
      v_dernier := jsonb_build_object(
        'jour', (v.cree_le at time zone 'Europe/Paris')::date,
        'geste', case when v.iban is null then 'retire' when v_prec_iban is null then 'pose' else 'change' end,
        'auteur', case when v.iban is null then 'inconnu' when v_propose then 'client' else 'cabinet' end,
        'etat', case when v.iban is null then 'retire' when v_propose then 'propose' else 'confirme' end,
        'rib_en_vigueur', case
          when v_avant_iban is null and v_vigueur_iban is null then 'aucun'
          when (v_avant_iban, v_avant_bic, v_avant_titulaire) is not distinct from (v_vigueur_iban, v_vigueur_bic, v_vigueur_titulaire)
            then 'inchange'
          when v_avant_iban is null then 'pose'
          when v_vigueur_iban is null then 'retire'
          else 'change' end);
    end if;
    -- Le RIB proposé de la version, confirmé ensuite par le cabinet (`confirmer_rib`). Proposé, il n'a pas changé le RIB en
    -- vigueur à la création de la version : `v_avant_*` le porte encore.
    if v.rib_etat = 'confirme' and v_propose then
      v_vigueur_iban := v.iban;
      v_vigueur_bic := v.bic;
      v_vigueur_titulaire := v.titulaire_compte;
      v_dernier := jsonb_build_object(
        'jour', (v.rib_confirme_le at time zone 'Europe/Paris')::date,
        'geste', 'confirme',
        'auteur', case when v.rib_confirme_le >= v.cree_le then 'cabinet' else 'inconnu' end,
        'etat', 'confirme',
        -- Après une confirmation, un RIB est en vigueur : ni « aucun » ni « retiré ».
        'rib_en_vigueur', case
          when (v_avant_iban, v_avant_bic, v_avant_titulaire) is not distinct from (v_vigueur_iban, v_vigueur_bic, v_vigueur_titulaire)
            then 'inchange'
          when v_avant_iban is null then 'pose'
          else 'change' end);
    end if;
    v_prec_iban := v.iban;
    v_prec_bic := v.bic;
    v_prec_titulaire := v.titulaire_compte;
    v_prec_etat := v.rib_etat;
  end loop;
  return jsonb_build_object('changement', v_dernier);
end
$$;

-- ══ 2. Les droits d'exécution ══════════
-- Une lecture qui vérifie l'accès elle-même ; un anonyme n'a rien à y faire.
revoke execute on function public.dernier_changement_de_rib(uuid) from public, anon;
grant execute on function public.dernier_changement_de_rib(uuid) to authenticated;

comment on function public.dernier_changement_de_rib(uuid) is
  'Le dernier changement du RIB des factures d''un dossier (espace client, étape A5b3a ; A5-Q2) : une version qui pose, change ou retire le RIB (IBAN, BIC et titulaire ensemble), ou la confirmation d''un RIB proposé — son jour à Paris, son geste, son auteur (cabinet, client ou inconnu, tiré de ce que la version a écrit), son état et ce qu''il a fait au RIB en vigueur ; {"changement": null} quand le RIB n''a jamais changé. Jamais l''IBAN, le BIC, le titulaire, un identifiant de compte ni de version. Réservée au cabinet du dossier et à l''accès client qui porte « Ventes » ou « Banque » (42501 sinon) ; n''écrit rien.';
