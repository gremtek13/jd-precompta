-- LE CLIENT VOIT DANS « MES PIÈCES » UNE PIÈCE JOINTE QUE LA RÉCEPTION PAR E-MAIL A ÉCARTÉE (ligne 22.9 de la feuille de
-- route, préparée le 13/10/2026 ; décision du cabinet du 13/10/2026, S227-Q6 : le dire au client dans « Mes pièces », la
-- lecture qui lui serait ouverte présentée au cabinet avant d'être appliquée).
--
-- LE DÉFAUT. Depuis les lignes 22.7, 22.8 et 22.91, receive-email consigne dans `pieces_jointes_ecartees` la pièce jointe
-- qu'elle n'a pas déposée — un format qui n'est pas celui d'une pièce, plus de 20 Mo, un dépôt qui a échoué, une pièce
-- jointe arrivée vide —, et le cabinet la voit dans l'onglet Justificatifs. Le client, lui, croit l'avoir envoyée : rien
-- ne le lui dit, sauf le cabinet, s'il y pense.
--
-- CE QUE CETTE MIGRATION POSE : une fonction de LECTURE, `pieces_jointes_ecartees_du_client(dossier)`, et rien d'autre.
--   - QUI : le cabinet du dossier (`admin_du_dossier`) et TOUT accès client du dossier (`client_du_dossier(…, 'membre')`),
--     qu'il porte ou non les cases « Ventes » et « Banque » — « Mes pièces » est ouvert à tout accès, et ce que la
--     fonction rend ne touche ni les ventes ni la banque. Tout autre appelant : « Accès refusé à ce dossier. » (42501),
--     sans dire si le dossier existe ; l'anonyme n'a pas le droit de l'exécuter.
--   - QUELLES LIGNES : celles du dossier demandé, reçues depuis 90 jours (hypothèse S228B-Q2), que le cabinet les ait
--     marquées vues ou non — sa marque ne change rien pour le client (hypothèse S228B-Q3).
--   - QUELS CHAMPS, et pourquoi chacun : le JOUR de la réception, à Paris — pour retrouver l'e-mail dans sa boîte ; ni
--     l'heure ni l'instant — ; la RAISON — ce qu'il doit faire : renvoyer autrement, telle quelle, ou vérifier son
--     fichier — ; le POIDS — la seule trace qui distingue deux pièces jointes d'un même jour, et ce qu'une taille refusée
--     demande de réduire —, inconnu d'un dépôt échoué avant toute lecture. JAMAIS l'identifiant de la ligne, l'empreinte
--     des identifiants Resend, la marque « vue » ni son auteur — un membre du cabinet —, ni le dossier, qu'il a demandé.
--   - SOUS QUELLE FORME : UNE valeur, un tableau `jsonb`, du plus récent au plus ancien — PostgREST plafonne sans le dire
--     les lignes qu'il rend, pas une valeur (le patron de `couverture_du_releve`) ; vide, `[]`.
--
-- POURQUOI UNE FONCTION, ET NON UNE POLICY DE LECTURE. Une policy `to authenticated` sur `client_du_dossier(dossier_id,
-- 'membre')` ouvrirait au client les HUIT colonnes de la table, la marque « vue » et son auteur compris, et toutes les
-- lignes depuis la création du dossier : le droit de lire une colonne se donne à un rôle, et le cabinet et le client sont
-- le même rôle (`authenticated`). La table reste donc fermée au client — sa policy de lecture inchangée,
-- `admin_du_dossier` seul —, et la fonction, `SECURITY DEFINER` à `search_path` fixé, vérifie l'accès AVANT toute lecture
-- et ne rend que trois champs (documentation de PostgreSQL, « Writing SECURITY DEFINER Functions Safely » ; règlement
-- (UE) 2016/679, art. 25 § 2 : par défaut, seules les données nécessaires sont rendues accessibles).
--
-- CE QU'ELLE NE CHANGE PAS : la table, ses contraintes, sa garde, ses deux policies, `marquer_pieces_jointes_vues`. Le
-- client n'écrit rien et ne marque rien : son geste est de renvoyer la pièce jointe (hypothèse S228B-Q4).
--
-- Données mesurées le 13/10/2026 : la table est vide. Aucune instruction de suppression. Le retour arrière est donné à
-- part : il retire la fonction et rend le commentaire de la table d'avant, après le retour de l'application qui la lit.

create function public.pieces_jointes_ecartees_du_client(p_dossier_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'membre')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'jour', (e.recue_le at time zone 'Europe/Paris')::date,
             'raison', e.raison,
             'octets', e.octets)
           order by e.recue_le desc, e.id)
      from public.pieces_jointes_ecartees e
     where e.dossier_id = p_dossier_id
       and e.recue_le >= now() - interval '90 days'
  ), '[]'::jsonb);
end;
$$;

-- Une lecture qui vérifie l'accès elle-même ; un anonyme n'a rien à y faire.
revoke execute on function public.pieces_jointes_ecartees_du_client(uuid) from public, anon;
grant execute on function public.pieces_jointes_ecartees_du_client(uuid) to authenticated;

comment on function public.pieces_jointes_ecartees_du_client(uuid) is
  'Les pièces jointes écartées d''un dossier reçues depuis 90 jours, telles que le client les lit dans « Mes pièces » (ligne 22.9) : un tableau, du plus récent au plus ancien, de {jour (à Paris), raison, octets} — jamais l''identifiant, l''empreinte, la marque « vue » ni son auteur. Réservée au cabinet du dossier et à tout accès client du dossier (42501 sinon) ; n''écrit rien.';
comment on table public.pieces_jointes_ecartees is
  'Les pièces jointes que la réception par e-mail (receive-email) a écartées, par format ou par taille (ligne 22.7), dont le dépôt a échoué (ligne 22.8), ou arrivées vides (ligne 22.91) : le dossier, l''instant, la raison, le poids, l''empreinte des identifiants Resend qui rend l''écriture idempotente, et la marque « vue » du cabinet — jamais le nom du fichier, son extension, l''expéditeur ni l''objet. Le cabinet la lit ; le client ne la lit pas : il en reçoit, par pieces_jointes_ecartees_du_client seule, le jour, la raison et le poids de celles des 90 derniers jours (ligne 22.9).';
