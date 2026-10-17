-- LES DOSSIERS DONT UN RIB PROPOSÉ ATTEND LA CONFIRMATION DU CABINET, EN BASE (espace client, étape A5b3c ; ligne 51.5 ;
-- conception : HISTORIQUE.md, « LE DERNIER CHANGEMENT DU RIB, EN BASE » et « L'AVIS D'UN CHANGEMENT DE RIB, À
-- L'ÉCRAN » ; décision du cabinet du 17/10/2026, A5B3-Q5, « comme recommandé » : la Vue d'ensemble d'abord, puis le
-- tableau de bord par une fonction qui dit EN UNE FOIS quels dossiers ont un RIB qui l'attend). Présentée au cabinet avant
-- d'être appliquée.
--
-- POURQUOI. Un RIB qu'un accès client pose ou change n'est que PROPOSÉ, et seul le cabinet le confirme (étape A5a,
-- MEG1-Q12). Depuis l'étape A5b3b, la Vue d'ensemble de CHAQUE dossier le dit — mais il faut ouvrir le dossier pour le
-- voir. Le tableau de bord du cabinet doit dire, sans ouvrir aucun dossier, lesquels ont un RIB qui attend sa
-- confirmation.
--
-- CE QU'ELLE POSE : une fonction de LECTURE, `dossiers_au_rib_a_confirmer()`, et rien d'autre — aucune table, aucune
-- policy, aucune donnée lue ni écrite d'avance ; `dernier_changement_de_rib` (étape A5b3a), la table des paramètres de
-- facturation et ses fonctions (étape A5a) ne changent pas.
--
-- UNE SEULE RÈGLE. Un dossier figure dans la liste si et seulement si son dernier changement du RIB, tel que
-- `dernier_changement_de_rib` le rend, est un RIB PROPOSÉ qui attend (`etat` = `propose`) : la fonction l'APPELLE pour
-- chaque dossier retenu et rend son objet `changement` TEL QUEL. Elle ne lit pas la table des paramètres et ne recopie
-- pas la règle de la chaîne : le tableau de bord et la Vue d'ensemble ne peuvent ni dire deux choses du même dossier, ni
-- dériver l'un de l'autre.
--
-- QUI : le cabinet seul. Un appelant qui n'est rattaché à aucun cabinet — un accès client, quelles que soient ses cases,
-- un compte rattaché à rien — reçoit « Seul le cabinet lit les RIB à confirmer. » (42501), plutôt qu'une liste vide qu'il
-- prendrait pour une réponse ; l'anonyme ne l'exécute pas. Rattaché : le super-administrateur (`is_super_admin`), ou un
-- compte de `cabinet_admins` — le chef d'un cabinet, ou un membre de son équipe (`create-team-member`). Un dossier n'y
-- entre que si `admin_du_dossier` le dit de l'appelant : le chef, les dossiers de son cabinet ; un membre, ceux qui lui
-- sont affectés (`dossier_assignations`) ; le super-administrateur, tous. Un accès client que le même compte aurait sur un
-- dossier ne l'y fait pas entrer. Un membre affecté à aucun dossier reçoit la liste vide : pour lui, c'est une réponse.
-- L'accès se juge AVANT toute lecture, et `admin_du_dossier` avant toute lecture du dernier changement d'un dossier —
-- `dernier_changement_de_rib` refuserait un dossier que l'appelant n'administre pas.
--
-- LES DOSSIERS ARCHIVÉS sont rendus comme les autres, marqués (`archive`, la colonne du dossier) : un RIB proposé sur un
-- dossier archivé attend tout autant, et c'est un signe à voir (un accès client encore actif sur un dossier qu'on ne
-- suit plus). Le tableau de bord, qui les écarte de ses tuiles, décidera de les montrer ou non (question au cabinet,
-- A5B3C-Q2) sans nouvelle migration.
--
-- SOUS QUELLE FORME : UNE valeur, toujours un objet — `{"dossiers": [...]}`, la liste vide quand aucun dossier n'attend :
-- une AFFIRMATION de la base, qu'une lecture ratée ne doit jamais pouvoir imiter (src/lib/dossiersAuRibAConfirmer.ts lit
-- toute autre forme comme illisible). Chaque élément : `{"dossier_id": "<uuid>", "nom": "<nom du dossier>",
-- "archive": true | false, "changement": {…}}`, où `changement` est l'objet que rend `dernier_changement_de_rib`, au
-- caractère près — son jour à Paris, le geste, l'auteur, l'état (toujours `propose`), ce qu'il a fait au RIB en vigueur.
-- Le nom : le tableau de bord ne lit que les dossiers qui ne sont pas archivés, et une ligne doit pouvoir nommer son
-- dossier.
--
-- L'ORDRE, TOTAL : le jour du changement, le plus ancien d'abord — celui qui attend depuis le plus longtemps —, puis
-- l'identifiant du dossier. Un jour, puis un uuid : aucun ordre de texte, donc aucune collation, n'y entre.
--
-- CE QU'ELLE NE REND JAMAIS : l'IBAN, le BIC, le titulaire du compte — ni leur longueur, ni leur empreinte —,
-- l'identifiant d'un compte ou d'une version, l'heure ; rien d'un dossier que l'appelant n'administre pas.
--
-- POURQUOI UNE FONCTION. Le tableau de bord pourrait lire la table des paramètres (le cabinet la lit) et en tirer les RIB
-- proposés : ce serait recopier la règle de la chaîne, une seconde règle qui dériverait de la première ; ou appeler
-- `dernier_changement_de_rib` dossier par dossier : autant d'appels que de dossiers, autant de lectures à moitié revenues.
-- La fonction, `SECURITY DEFINER` à `search_path` fixé et `stable`, vérifie l'accès avant toute lecture (documentation
-- de PostgreSQL, « Writing SECURITY DEFINER Functions Safely ») et ne rend que ce qu'une ligne du tableau de bord dira
-- (règlement (UE) 2016/679, art. 25 § 2) — le patron de `dernier_changement_de_rib`.
--
-- CE QU'ELLE SUPPOSE : la migration de l'étape A5b3a (`dernier_changement_de_rib`) ; son premier bloc le vérifie.
-- CE QU'ELLE NE FAIT PAS : aucun écran (le tableau de bord : étape A5b3d), aucune Edge Function. Le texte ne porte aucune
-- instruction qui retire quoi que ce soit : le retour arrière est donné à part, et ne vient qu'après le drapeau
-- `DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE` (src/lib/dossiersAuRibAConfirmer.ts) rebaissé en ligne.

-- ══ 0. La migration de l'étape A5b3a d'abord ══════════
do $garde$
begin
  if to_regprocedure('public.dernier_changement_de_rib(uuid)') is null then
    raise exception 'La migration de l''étape A5b3a (dernier_changement_de_rib) n''est pas en base : l''appliquer d''abord, puis celle-ci.';
  end if;
end
$garde$;

-- ══ 1. Les dossiers dont un RIB proposé attend la confirmation du cabinet ══════════
create function public.dossiers_au_rib_a_confirmer()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d record;
  v_changement jsonb;
  v_dossiers jsonb := '[]'::jsonb;
begin
  if not (public.is_super_admin()
          or exists (select 1 from public.cabinet_admins ca where ca.user_id = auth.uid())) then
    raise exception 'Seul le cabinet lit les RIB à confirmer.' using errcode = '42501';
  end if;

  -- Les dossiers que l'appelant administre, et eux seuls : le filtre de la boucle est jugé avant que son corps ne lise
  -- quoi que ce soit d'un dossier.
  for d in
    select x.id, x.nom, x.archive from public.dossiers x where public.admin_du_dossier(x.id)
  loop
    -- La règle de l'étape A5b3a, et elle seule : son objet `changement`, tel quel.
    v_changement := public.dernier_changement_de_rib(d.id) -> 'changement';
    if v_changement ->> 'etat' = 'propose' then
      v_dossiers := v_dossiers || jsonb_build_array(jsonb_build_object(
        'dossier_id', d.id, 'nom', d.nom, 'archive', d.archive, 'changement', v_changement));
    end if;
  end loop;

  -- Le plus ancien d'abord, puis l'identifiant : un ordre total.
  return jsonb_build_object('dossiers', coalesce(
    (select jsonb_agg(e order by (e -> 'changement' ->> 'jour')::date, (e ->> 'dossier_id')::uuid)
       from jsonb_array_elements(v_dossiers) e),
    '[]'::jsonb));
end
$$;

-- ══ 2. Les droits d'exécution ══════════
-- Une lecture qui vérifie l'accès elle-même ; un anonyme n'a rien à y faire.
revoke execute on function public.dossiers_au_rib_a_confirmer() from public, anon;
grant execute on function public.dossiers_au_rib_a_confirmer() to authenticated;

comment on function public.dossiers_au_rib_a_confirmer() is
  'Les dossiers dont un RIB proposé attend la confirmation du cabinet (espace client, étape A5b3c ; A5B3-Q5) : chaque dossier que l''appelant administre (admin_du_dossier) et dont le dernier changement du RIB, tel que dernier_changement_de_rib le rend, est un RIB proposé — son identifiant, son nom, s''il est archivé, et l''objet changement tel quel ; {"dossiers": []} quand aucun n''attend. Le plus ancien d''abord, puis l''identifiant. Jamais l''IBAN, le BIC, le titulaire, un identifiant de compte ni de version. Réservée au cabinet — le super-administrateur, un chef de cabinet ou un membre de son équipe (42501 sinon) ; n''écrit rien.';
