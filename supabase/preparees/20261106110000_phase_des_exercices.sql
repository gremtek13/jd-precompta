-- L'ÉTAT DU DOSSIER CHEZ LE CABINET, MONTRÉ AU CLIENT (ligne 51.5, partie C, étape C2 ; MEG3-Q6, « oui ») — PRÉPARÉE le
-- 06/11/2026, PAS APPLIQUÉE : une lecture neuve ouverte au client se présente au cabinet avant d'être appliquée. Le
-- récit : HISTORIQUE.md, « 06/11/2026 — L'ÉTAT DU DOSSIER CHEZ LE CABINET, MONTRÉ AU CLIENT (C2) (PRÉPARÉE, PAS
-- APPLIQUÉE) » ; l'essai : supabase/essais/phaseDesExercices.sql ; le retour arrière :
-- supabase/preparees/retour/20261106110100_retour_phase_des_exercices.sql.
--
-- UNE FONCTION DE LECTURE, RIEN D'AUTRE : ni table, ni colonne, ni policy, ni déclencheur ; aucune table n'est ouverte au
-- client. `phase_des_exercices(dossier)` rend, par exercice, une PHASE, et pour un exercice validé le JOUR de sa validation
-- (à Paris) et si sa 2035 y est enregistrée — jamais un montant, un compte, un nombre, un libellé ni un nom, ni qui a
-- validé, ni à quelle heure, ni quel cycle est revu. Une seule valeur `jsonb` : ni tranches, ni plafond silencieux de
-- PostgREST.
--
-- LES PHASES, ce que la base PROUVE de chacune — et rien de plus :
--   « validee »          : une ligne de `exercices_valides` (l'exercice est figé en base) ; `valide_le`, son jour à Paris ;
--                          `declaration_2035` vrai quand l'instantané de la 2035 y est gardé (`declaration`, non nul en
--                          trésorerie, la contrainte `exercices_valides_declaration`). « Enregistrée », jamais « déposée » :
--                          la base ne sait rien du dépôt de la déclaration ;
--   « pieces_attendues » : l'exercice en cours ou le précédent, tant que le cabinet ne l'a pas clôturé
--                          (`exercices_clotures`) — la règle de « Ce qu'il reste à envoyer » sur le même accueil
--                          (src/lib/resteAEnvoyer.ts, choix du cabinet du 22/09/2026). Elle ne dit pas QUOI : l'accueil
--                          le dit à côté, mois par mois. Elle l'emporte sur la révision commencée : la carte ne dit pas
--                          « en révision » quand la liste voisine réclame encore un document ;
--   « en_revision »      : une ligne de la révision de l'exercice (une conclusion, une note, une décision sur un solde,
--                          une explication, un seuil, une revue) — le cabinet a commencé à la consigner ;
--   « en_cours »         : tout le reste, ce qui ne se prouve pas (un exercice clôturé que la révision n'a pas encore
--                          touché).
-- Les exercices rendus : l'exercice en cours et le précédent, et ceux que la validation, la clôture ou la révision
-- nomment ; du plus récent au plus ancien.
--
-- L'ACCÈS, avant toute lecture : le cabinet du dossier (le super-administrateur compris), ou un accès client de CE dossier,
-- avec ou sans case — aucun montant ne sort, c'est la règle de MEG3-Q6 ; un dossier qui n'existe pas se refuse sous les
-- mêmes mots. Exécutable par les connectés ; ni `public`, ni `anon`.
--
-- Ni barre oblique inverse, ni retour chariot, ni suppression.
create function public.phase_des_exercices(p_dossier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_annee integer;
begin
  -- 1. L'accès, avant toute lecture.
  if p_dossier_id is null
     or not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'membre'))
     or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2. L'exercice en cours, à Paris : celui que l'accueil du client réclame, avec le précédent.
  v_annee := extract(year from (now() at time zone 'Europe/Paris'))::integer;
  return coalesce((
    with revues (annee) as (
      select r.annee from public.revision_conclusions r where r.dossier_id = p_dossier_id
      union select r.annee from public.revision_notes r where r.dossier_id = p_dossier_id
      union select r.annee from public.revision_justifications r where r.dossier_id = p_dossier_id
      union select r.annee from public.revision_explications r where r.dossier_id = p_dossier_id
      union select r.annee from public.revision_seuils r where r.dossier_id = p_dossier_id
      union select r.annee from public.revision_revues r where r.dossier_id = p_dossier_id
    ), annees (annee) as (
      select v_annee
      union select v_annee - 1
      union select e.annee from public.exercices_valides e where e.dossier_id = p_dossier_id
      union select c.annee from public.exercices_clotures c where c.dossier_id = p_dossier_id
      union select annee from revues
    )
    select jsonb_agg(jsonb_build_object(
             'annee', a.annee,
             'phase', case
                        when v.annee is not null then 'validee'
                        when a.annee >= v_annee - 1 and c.annee is null then 'pieces_attendues'
                        when exists (select 1 from revues r where r.annee = a.annee) then 'en_revision'
                        else 'en_cours'
                      end,
             'valide_le', (v.valide_le at time zone 'Europe/Paris')::date,
             'declaration_2035', v.declaration is not null)
           order by a.annee desc)
      from annees a
      left join public.exercices_valides v on v.dossier_id = p_dossier_id and v.annee = a.annee
      left join public.exercices_clotures c on c.dossier_id = p_dossier_id and c.annee = a.annee
  ), '[]'::jsonb);
end
$$;

revoke execute on function public.phase_des_exercices(uuid) from public, anon;
grant execute on function public.phase_des_exercices(uuid) to authenticated;

comment on function public.phase_des_exercices(uuid) is
  'L''état du dossier chez le cabinet, montré au client (ligne 51.5, étape C2 ; MEG3-Q6) : par exercice, du plus récent au plus ancien, sa phase (validee, pieces_attendues, en_revision, en_cours), le jour de sa validation à Paris et si sa 2035 y est enregistrée — jamais un montant, un compte, un nombre, un libellé ni un nom. Réservée au cabinet du dossier et à ses accès clients, avec ou sans case (42501).';
