-- LES DROITS D'UN ACCÈS CLIENT, TENUS EN BASE (espace client, étape P1 ; décision du cabinet du 09/10/2026 d'ouvrir
-- l'espace client aux ventes et à la banque ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE
-- GESTION DU CLIENT : LA CONCEPTION », §3.1, §3.2 et §7 ; EC-Q1 sans réponse, sa recommandation prise comme hypothèse).
--
-- CE QUE CETTE MIGRATION POSE. Deux cases par accès (`memberships`), « Ventes » (devis, factures, facture électronique) et
-- « Banque » (comptes, mouvements, connexion bancaire), FAUSSES par défaut : un accès d'aujourd'hui n'en reçoit aucune.
-- Et cinq fonctions : quatre qui LISENT les droits de l'appelant (`client_du_dossier`, `gere_les_ventes`,
-- `gere_la_banque`, `droits_sur_le_dossier`), le prédicat que les étapes suivantes poseront dans leurs policies et leurs
-- fonctions ; une qui les ÉCRIT (`changer_droits_acces`), la seule : `memberships` n'a aucune policy de mise à jour, pour
-- personne, et n'en aura pas — un `update` direct n'y touche aucune ligne, sans erreur.
--
-- CE QU'ELLE NE FAIT PAS. Aucune policy n'est créée ni changée : aucune table métier ne s'ouvre au client. Une case
-- cochée enregistre un droit que l'espace du client honorera quand ses écrans « Ventes » et « Banque » arriveront (P2 à
-- P9, chacune présentée au cabinet avant d'ouvrir quoi que ce soit) ; d'ici là elle ne change rien à ce que le client
-- voit ou fait. Le client continue de lire ses seules lignes de `memberships` (`memberships_select` : `admin_du_dossier`,
-- ou `user_id = auth.uid()`), droits compris — les siens, jamais ceux d'un autre accès.
--
-- POURQUOI FAUX PAR DÉFAUT : règlement (UE) 2016/679, art. 25 § 2 — par défaut, seules les données nécessaires sont
-- rendues accessibles ; ouvrir la banque d'un client à chacune des personnes qui ont un accès (une secrétaire, un
-- conjoint collaborateur) est une décision du cabinet, case par case, jamais un effet de la migration. Et art. 32 § 1 b)
-- (confidentialité des systèmes de traitement).
--
-- POURQUOI DES FONCTIONS `SECURITY DEFINER` À `search_path` FIXÉ, et noms qualifiés : elles lisent `memberships` hors de
-- la RLS de l'appelant (documentation de PostgreSQL, « Writing SECURITY DEFINER Functions Safely »). Leur exécution est
-- retirée à `anon` et à PUBLIC : les policies qui les appelleront seront `to authenticated` (CLAUDE.md), les Edge
-- Functions les appelleront avec le jeton de l'appelant, l'écran du cabinet sous sa session — aucun appelant sans
-- session n'en a l'usage.

alter table public.memberships
  add column droit_ventes boolean not null default false,
  add column droit_banque boolean not null default false;

comment on column public.memberships.droit_ventes is
  'Le droit « Ventes » de cet accès (devis, factures, facture électronique), posé par le cabinet par changer_droits_acces, faux par défaut (espace client, étape P1, 09/10/2026).';
comment on column public.memberships.droit_banque is
  'Le droit « Banque » de cet accès (comptes, mouvements, connexion bancaire), posé par le cabinet par changer_droits_acces, faux par défaut (espace client, étape P1, 09/10/2026).';

-- ══ Lire les droits de l'appelant ══════════
-- Vrai si l'appelant a un accès à ce dossier qui porte ce droit : « ventes », « banque », ou « membre » pour un accès
-- quelconque. Tout autre mot, ou aucun, rend faux : une faute de frappe dans une policy ne doit rien ouvrir. Sans session,
-- `auth.uid()` est nul et aucun accès ne lui correspond.
create function public.client_du_dossier(p_dossier_id uuid, p_droit text) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.dossier_id = p_dossier_id
      and m.user_id = auth.uid()
      and case p_droit
            when 'membre' then true
            when 'ventes' then m.droit_ventes
            when 'banque' then m.droit_banque
            else false
          end
  )
$$;

-- Le prédicat des tables et des fonctions de la vente : le cabinet du dossier, ou un accès qui porte le droit « Ventes ».
create function public.gere_les_ventes(p_dossier_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'ventes')
$$;

-- Celui de la banque : le cabinet du dossier, ou un accès qui porte le droit « Banque ».
create function public.gere_la_banque(p_dossier_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'banque')
$$;

-- Les quatre réponses d'un coup, pour une Edge Function (avec le jeton de l'appelant, avant tout secret et tout appel
-- extérieur) ou un écran : un objet plutôt que des colonnes, pour qu'un domaine de plus soit une clé de plus, sans
-- changer la signature (ce qui demanderait de supprimer la fonction).
create function public.droits_sur_le_dossier(p_dossier_id uuid) returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  select jsonb_build_object(
    'cabinet', public.admin_du_dossier(p_dossier_id),
    'membre', public.client_du_dossier(p_dossier_id, 'membre'),
    'ventes', public.gere_les_ventes(p_dossier_id),
    'banque', public.gere_la_banque(p_dossier_id)
  )
$$;

-- ══ Changer les droits d'un accès ══════════
-- La seule écriture des droits. Trois refus, dans cet ordre :
--   1. l'appelant n'est pas `admin_du_dossier` du dossier de l'accès — ou l'accès n'existe pas : il se refuse comme un
--      accès interdit, sous les mêmes mots, pour ne pas dire s'il existe (42501) ;
--   2. aucun des deux droits n'est donné (22023). Un droit NUL est un droit INCHANGÉ : l'écran n'envoie que la case
--      cliquée, et deux personnes du cabinet qui cochent chacune une case du même accès ne défont pas l'une l'autre ;
--   3. l'accès a été retiré entre la lecture et l'écriture (P0002).
-- Elle n'écrit que les deux colonnes, et rend l'accès tel que l'écriture l'a laissé.
create function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_dossier uuid;
  v_acces public.memberships;
begin
  select m.dossier_id into v_dossier from public.memberships m where m.id = p_membership_id;
  if v_dossier is null or not public.admin_du_dossier(v_dossier) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_ventes is null and p_banque is null then
    raise exception 'Aucun droit à changer : précise « Ventes », « Banque », ou les deux.' using errcode = '22023';
  end if;
  update public.memberships m
     set droit_ventes = coalesce(p_ventes, m.droit_ventes),
         droit_banque = coalesce(p_banque, m.droit_banque)
   where m.id = p_membership_id and m.dossier_id = v_dossier
  returning m.* into v_acces;
  if not found then
    raise exception 'Cet accès vient d''être retiré : il n''a plus de droits à changer.' using errcode = 'P0002';
  end if;
  return v_acces;
end;
$$;

revoke execute on function public.client_du_dossier(uuid, text) from public, anon;
revoke execute on function public.gere_les_ventes(uuid) from public, anon;
revoke execute on function public.gere_la_banque(uuid) from public, anon;
revoke execute on function public.droits_sur_le_dossier(uuid) from public, anon;
revoke execute on function public.changer_droits_acces(uuid, boolean, boolean) from public, anon;
grant execute on function public.client_du_dossier(uuid, text) to authenticated;
grant execute on function public.gere_les_ventes(uuid) to authenticated;
grant execute on function public.gere_la_banque(uuid) to authenticated;
grant execute on function public.droits_sur_le_dossier(uuid) to authenticated;
grant execute on function public.changer_droits_acces(uuid, boolean, boolean) to authenticated;

comment on function public.client_du_dossier(uuid, text) is
  'Vrai si l''appelant a un accès à ce dossier qui porte ce droit (« ventes », « banque », ou « membre » pour un accès quelconque) ; tout autre mot rend faux. Ne lit que memberships.';
comment on function public.gere_les_ventes(uuid) is
  'Le cabinet du dossier (admin_du_dossier), ou un accès client qui porte le droit « Ventes ».';
comment on function public.gere_la_banque(uuid) is
  'Le cabinet du dossier (admin_du_dossier), ou un accès client qui porte le droit « Banque ».';
comment on function public.droits_sur_le_dossier(uuid) is
  'Les droits de l''appelant sur ce dossier : {cabinet, membre, ventes, banque}. N''écrit rien.';
comment on function public.changer_droits_acces(uuid, boolean, boolean) is
  'Change les droits « Ventes » et « Banque » d''un accès client — un droit nul reste tel quel. Réservée au cabinet du dossier de l''accès (42501, aussi pour un accès qui n''existe pas) ; n''écrit que ces deux colonnes ; rend l''accès tel que l''écriture l''a laissé.';
