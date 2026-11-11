-- LM7 : « À FACTURER » ET LES FACTURES D'HONORAIRES, EN BASE (ligne 47, le cabinet et ses clients) — PRÉPARÉE, PAS
-- APPLIQUÉE. Après `dossier_du_cabinet` (LM1) et `lettres_de_mission` (LM4), dont elle lit la désignation et les lettres.
--
-- La conception : HISTORIQUE.md, « 10/11/2026 — LA LETTRE DE MISSION ET LES HONORAIRES DU CABINET : LA CONCEPTION
-- (LIGNE 47) », point 4 ; les réponses du cabinet : les honoraires vivent dans le dossier du cabinet et réutilisent sa
-- facturation — numérotation, facture figée, facture électronique, relances (LM-Q1) ; l'identité du client vient de son
-- dossier (LM-Q3) ; le forfait et la tâche d'abord, le temps passé plus tard, chaque facture PROPOSÉE en brouillon et
-- validée une par une, une période déjà facturée ne l'est pas deux fois (LM-Q7) ; la facture validée se déposera sur un
-- clic chez le client (LM-Q8, lot LM8 : la table le permet, rien ne s'y fait ici). Le récit : HISTORIQUE.md,
-- « 11/11/2026 — LM7 ».
--
-- SOURCES. Décret n° 2012-432 du 30 mars 2012, art. 158 (Légifrance, relu le 11/11/2026 pour LM4) : les honoraires sont
-- fixés librement entre le client et l'expert-comptable — la lettre les fige, cette migration ne fait que les facturer.
-- CGI, art. 289 (la facture, son numéro unique et sa date) et art. 242 nonies A de l'annexe II (ses mentions, dont la
-- période de la prestation) : la facture d'honoraires est une facture du dossier du cabinet comme une autre, que
-- `enregistrer_facture` crée en brouillon et que la validation fige (A7). Aucune norme AFNOR.
--
-- CE QU'ELLE FAIT.
--   1. `honoraires_factures` : le LIEN d'une facture du dossier du cabinet à ce qu'elle facture — une ligne d'honoraires
--      d'une lettre ACCEPTÉE (la lettre et son rang, 1 pour la première, figés avec la lettre) et sa PÉRIODE : pour un
--      forfait, le mois, le trimestre ou l'année civils de sa périodicité ; pour une tâche, la période qu'elle concerne
--      (l'exercice d'une 2035, le mois d'une CA3), un an au plus. Plusieurs liens par facture, d'un seul client.
--   2. UNE PÉRIODE NE SE FACTURE QU'UNE FOIS, en base, pour tout auteur et sous deux sessions : la garde, sous un verrou
--      par client, refuse un lien ACTIF (sa facture n'est pas créditée en entier) quand un autre lien actif couvre déjà la
--      même période de la même ligne — ou, d'une autre version de la même lettre (un avenant), d'une ligne de même forme,
--      de même périodicité (forfait) ou de même livrable (tâche, sauf « autre ») ; et une contrainte TOTALE
--      (`honoraires_factures_une_fois`) numérote les facturations successives d'une même période (`facturation`).
--   3. CE QU'UN AVOIR REND À FACTURER : rien ne s'écrit à sa création. Un lien dont la facture est CRÉDITÉE EN ENTIER
--      (ses avoirs, ceux de l'application et ceux qu'une reprise cite, atteignent son TTC : `facture_creditee_en_entier`)
--      ne couvre plus sa période, qui se facture de nouveau (la facturation suivante) ; un avoir partiel la laisse
--      facturée. Un brouillon supprimé emporte ses liens (la clé, en cascade) : sa période redevient à facturer.
--   4. `facturer_honoraires(dossier, éléments, taux, facture)` : le clic de « À facturer ». Sous le même verrou, elle
--      juge chaque élément — la lettre du dossier, acceptée, EN VIGUEUR pour la période (un forfait : au dernier jour de sa
--      période ; une tâche : au dernier jour de sa période ou au jour de sa facturation, et pas avant son premier
--      exercice), la ligne, la forme de la période, une période commencée, pas déjà facturée —, compose le BROUILLON
--      (une ligne par élément, au montant hors taxes que la lettre a figé, au taux donné ; le client lu de SON dossier,
--      LM-Q3 ; l'émetteur, du dossier du cabinet) et le crée par `enregistrer_facture`, sans la redéfinir (LM1 et e7a la
--      redéfinissent déjà), puis pose les liens. Tout ou rien. La validation reste celle de toute facture, une par une.
-- Les refus de la fonction, dans leur ordre et à leurs mots, sont redits par src/lib/honorairesAFacturer.ts, qui calcule
-- aussi ce qui est « à facturer » (rien de cela ne se stocke) ; derrière `HONORAIRES_FACTURES_PREVUS`, baissé.
--
-- CE QUI A ÉTÉ CHOISI, ET POURQUOI :
--   - une fonction qui APPELLE `enregistrer_facture` plutôt que de la redéfinir : deux migrations préparées (LM1, e7a) la
--     redéfinissent déjà, une troisième se refairait à chaque collage ; les gardes des factures, intactes, jugent le
--     brouillon puis sa validation comme toute facture ;
--   - la libération par un avoir DÉDUITE, jamais écrite : un avoir se crée validé et ne se supprime pas, une facture
--     créditée en entier le reste ; écrire la libération dans le lien serait une écriture silencieuse dans une autre table
--     (écartée par la conception, point 2), et la contrainte totale numérote les facturations sans index partiel ;
--   - la tâche « faite » est dite par le clic qui la facture (son brouillon est la proposition) : marquer une tâche faite
--     sans la facturer demanderait une table de plus (LM7-Q1) ;
--   - le taux de TVA, un paramètre de l'appelant parmi trois (20 %, 8,5 % dans les trois départements où il s'applique,
--     nul en franchise) : la lettre fige des montants hors taxes, et le régime de TVA du cabinet se juge à la validation
--     de la facture, comme aujourd'hui ;
--   - la lettre, une clé SANS ACTION (une lettre ne se supprime qu'avec son dossier, le même) ; la facture, une clé EN
--     CASCADE (seul un brouillon se supprime ; une facture validée ne part qu'avec son dossier).
--
-- CE QU'ELLE NE FAIT PAS : l'écran « À facturer » (le module le calcule) ; le dépôt de la facture validée chez le client
-- et « Mes honoraires » (LM8) ; le temps passé (LM9) ; la fiche liée au dossier client (LM3), qui donnera l'adresse de
-- réception et l'e-mail de facturation — ici, l'appelant peut donner l'e-mail et l'échéance.
--
-- À COLLER : les clés étrangères (en cascade) et la garde nomment l'action de suppression. Rien ne se détruit : une table,
-- six fonctions, un déclencheur et deux policies s'ajoutent, rien ne se remplace. Son retour :
-- supabase/preparees/retour/20261111190100_retour_honoraires_factures.sql (à coller AVANT celui de LM4, dont la table est
-- citée par la clé de la lettre). Son essai : supabase/essais/honorairesFactures.sql (sur une réplique : il désigne le
-- dossier du cabinet et supprime un brouillon) ; puis rls.sql (le bloc HF).

do $garde$
begin
  if to_regclass('public.dossiers') is null or to_regclass('public.factures_emises') is null
     or to_regclass('public.factures_importees') is null or to_regclass('public.cabinets') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null or to_regprocedure('public.is_super_admin()') is null
     or to_regprocedure('public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean)') is null
     or to_regprocedure('public.centimes_ligne_facture(numeric, numeric, numeric, boolean)') is null then
    raise exception 'Les tables ou les fonctions que la migration suppose manquent : relire la base.';
  end if;
  if to_regprocedure('public.est_dossier_du_cabinet(uuid)') is null or to_regclass('public.lettres_de_mission') is null then
    raise exception 'Le dossier du cabinet (LM1) et les lettres de mission (LM4) ne sont pas en base : les coller d''abord.';
  end if;
  if to_regclass('public.honoraires_factures') is not null then
    raise exception 'Les factures d''honoraires sont déjà en base : la migration a déjà été appliquée.';
  end if;
end
$garde$;

-- ══ 1. Les contrôles : la période d'un forfait, la lettre en vigueur, la facture créditée, la chaîne des versions ══════════
-- Aux droits de l'appelant (la garde les appelle ; la restauration du super-administrateur insère sous `authenticated`),
-- jamais par l'anonyme.

-- Un mois, un trimestre ou une année CIVILS, selon la périodicité du forfait : du premier au dernier jour. En arithmétique
-- de dates seulement (une date plus un intervalle est un horodatage sans fuseau) : immuable, indépendante du fuseau.
create function public.periode_de_forfait_valide(p_periodicite text, p_debut date, p_fin date) returns boolean
language sql immutable set search_path = public
as $$ select coalesce(p_debut is not null and p_fin is not null and extract(day from p_debut) = 1 and case p_periodicite
         when 'mois' then p_fin = (p_debut + interval '1 month')::date - 1
         when 'trimestre' then extract(month from p_debut) in (1, 4, 7, 10) and p_fin = (p_debut + interval '3 months')::date - 1
         when 'annee' then extract(month from p_debut) = 1 and p_fin = (p_debut + interval '1 year')::date - 1
         else false end, false) $$;

-- La lettre EN VIGUEUR un jour donné (src/lib/lettresDeMission.ts, `lettresEnVigueur`, le redit) : acceptée, d'effet
-- atteint, ni résiliée avant ce jour, ni échue (sans reconduction, passé la fin de sa première période), ni remplacée par
-- une version ACCEPTÉE d'effet atteint (un avenant).
create function public.lettre_en_vigueur_le(p_lettre uuid, p_jour date) returns boolean
language sql stable set search_path = public
as $$ select exists (select 1 from public.lettres_de_mission l
                      where l.id = p_lettre and l.acceptee_le is not null and l.date_effet <= p_jour
                        and not coalesce(l.fin_au < p_jour, false)
                        and not (not l.reconduction_tacite and coalesce(l.fin_initiale < p_jour, false))
                        and not exists (select 1 from public.lettres_de_mission s
                                         where s.remplace_id = l.id and s.refusee_le is null and s.acceptee_le is not null
                                           and s.date_effet <= p_jour)) $$;

-- Une facture CRÉDITÉE EN ENTIER : validée ou reprise, d'un TTC positif, que ses avoirs atteignent — ceux qu'elle origine
-- dans l'application et ceux qu'une reprise de l'ancien logiciel cite (la somme que fait `enregistrer_facture` pour
-- plafonner un avoir). Un brouillon ne l'est jamais : un avoir ne crédite qu'une facture validée ou reprise.
create function public.facture_creditee_en_entier(p_facture uuid) returns boolean
language sql stable set search_path = public
as $$ select coalesce((
    select f.montant_ttc > 0 and f.statut in ('validee', 'importee')
           and coalesce((select sum(-a.montant_ttc) from public.factures_emises a
                          where a.facture_origine_id = f.id and a.type = 'avoir'), 0)
             + coalesce((select sum(-a.montant_ttc) from public.factures_importees ai
                          join public.factures_emises a on a.id = ai.facture_id
                         where ai.origine_id = f.id and a.type = 'avoir'), 0) >= f.montant_ttc
      from public.factures_emises f where f.id = p_facture), false) $$;

-- La première version d'une lettre : sa chaîne (`remplace_id`, acyclique — une version remplace une lettre déjà écrite,
-- et la garde de LM4 ne la change jamais) remonte jusqu'à elle.
create function public.racine_de_la_lettre(p_lettre uuid) returns uuid
language sql stable set search_path = public
as $$ with recursive haut(id, remplace_id, n) as (
         select l.id, l.remplace_id, 0 from public.lettres_de_mission l where l.id = p_lettre
         union all
         select l.id, l.remplace_id, h.n + 1 from public.lettres_de_mission l join haut h on l.id = h.remplace_id where h.n < 1000)
       select h.id from haut h where h.remplace_id is null $$;

-- ══ 2. Le lien d'une facture à ce qu'elle facture ══════════
create table public.honoraires_factures (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  facture_id uuid not null references public.factures_emises (id) on delete cascade,
  lettre_id uuid not null references public.lettres_de_mission (id),
  -- Le rang de la ligne d'honoraires dans la lettre, 1 pour la première : figé avec la lettre, il ne bouge plus.
  ligne smallint not null
    constraint honoraires_factures_ligne check (ligne between 1 and 50),
  periode_debut date not null,
  periode_fin date not null,
  -- La facturation de cette période : 1, puis 2 si la facture de la première a été créditée en entier, et ainsi de suite.
  facturation smallint not null default 1
    constraint honoraires_factures_facturation check (facturation between 1 and 1000),
  auteur uuid not null,
  cree_le timestamptz not null default now(),
  constraint honoraires_factures_periode check (periode_debut between date '2000-01-01' and date '2100-12-31'
    and periode_fin between periode_debut and date '2100-12-31' and periode_fin < (periode_debut + interval '1 year')::date),
  constraint honoraires_factures_une_fois unique (lettre_id, ligne, periode_debut, periode_fin, facturation)
);
create index honoraires_factures_dossier on public.honoraires_factures (dossier_id);
create index honoraires_factures_facture on public.honoraires_factures (facture_id);
comment on table public.honoraires_factures is
  'Le lien d''une facture du dossier du cabinet à la période d''une ligne d''honoraires d''une lettre acceptée (LM7, ligne 47) : une période ne se facture qu''une fois, sauf après un avoir qui crédite sa facture en entier.';

-- LA GARDE, aux droits de l'appelant, pour tout auteur — la fonction, la restauration du super-administrateur, le
-- propriétaire. Un lien ne se modifie pas ; il ne se supprime qu'avec son brouillon ou son dossier. À l'insertion, sous un
-- verrou par client du dossier du cabinet : le dossier du cabinet ; une lettre de ce dossier, acceptée ; sa ligne, un
-- forfait ou une tâche, et la forme de la période ; une facture du dossier, ni avoir ni acompte ; un seul client par
-- facture ; aucun autre lien ACTIF sur la même période (la même ligne, ou la ligne de même nature d'une autre version de
-- la lettre) quand celui-ci l'est. Ce que la fonction juge de plus — la lettre en vigueur, une période commencée, le
-- premier exercice — dépend du jour : une restauration réinsère l'histoire telle qu'elle a été écrite.
create function public.garder_honoraires_factures() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_lettre public.lettres_de_mission;
  v_ligne jsonb;
  v_facture public.factures_emises;
  v_racine uuid;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or not exists (select 1 from public.factures_emises f where f.id = old.facture_id) then
      return old;
    end if;
    raise exception 'Le lien d''une facture d''honoraires ne se retire pas : il part avec son brouillon, et un avoir qui crédite la facture en entier rend sa période à facturer.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Le lien d''une facture d''honoraires ne se modifie pas.' using errcode = '23514';
  end if;

  select l.* into v_lettre from public.lettres_de_mission l where l.id = new.lettre_id;
  if not found or v_lettre.dossier_id <> new.dossier_id
     or not exists (select 1 from public.cabinets c where c.dossier_du_cabinet = new.dossier_id) then
    raise exception 'Une facture d''honoraires se lie, dans le dossier du cabinet, à une lettre de mission de ce dossier.'
      using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.honoraires_factures:' || new.dossier_id::text || ':'
                                                 || coalesce(v_lettre.dossier_client_id::text, '-'), 0));
  if v_lettre.acceptee_le is null then
    raise exception 'Une lettre de mission se facture une fois acceptée.' using errcode = '23514';
  end if;
  v_ligne := v_lettre.honoraires -> (new.ligne - 1);
  if v_ligne is null or coalesce(v_ligne ->> 'forme', '') not in ('forfait', 'tache') then
    raise exception 'La ligne d''honoraires est introuvable dans la lettre, ou se facture au temps passé (LM9).' using errcode = '23514';
  end if;
  if v_ligne ->> 'forme' = 'forfait'
     and not public.periode_de_forfait_valide(v_ligne ->> 'periodicite', new.periode_debut, new.periode_fin) then
    raise exception 'Une période de forfait est un mois, un trimestre ou une année civils, selon sa périodicité.' using errcode = '23514';
  end if;
  select f.* into v_facture from public.factures_emises f where f.id = new.facture_id for share;
  if not found or v_facture.dossier_id <> new.dossier_id or v_facture.type <> 'facture' or v_facture.acompte
     or v_facture.statut not in ('brouillon', 'validee', 'importee') then
    raise exception 'Une facture d''honoraires est une facture du dossier du cabinet, ni un avoir ni un acompte.' using errcode = '23514';
  end if;
  if exists (select 1 from public.honoraires_factures h join public.lettres_de_mission l on l.id = h.lettre_id
              where h.facture_id = new.facture_id and l.dossier_client_id is distinct from v_lettre.dossier_client_id) then
    raise exception 'Une facture d''honoraires s''adresse à un seul client.' using errcode = '23514';
  end if;
  if not public.facture_creditee_en_entier(new.facture_id) then
    v_racine := public.racine_de_la_lettre(new.lettre_id);
    if exists (select 1 from public.honoraires_factures h
                 join public.lettres_de_mission l on l.id = h.lettre_id
                where h.dossier_id = new.dossier_id and h.id is distinct from new.id
                  and h.periode_debut = new.periode_debut and h.periode_fin = new.periode_fin
                  and l.dossier_client_id is not distinct from v_lettre.dossier_client_id
                  and ((h.lettre_id = new.lettre_id and h.ligne = new.ligne)
                       or (h.lettre_id <> new.lettre_id and public.racine_de_la_lettre(h.lettre_id) = v_racine
                           and (l.honoraires -> (h.ligne - 1)) ->> 'forme' = v_ligne ->> 'forme'
                           and case v_ligne ->> 'forme'
                                 when 'forfait' then (l.honoraires -> (h.ligne - 1)) ->> 'periodicite' = v_ligne ->> 'periodicite'
                                 else (l.honoraires -> (h.ligne - 1)) ->> 'livrable' = v_ligne ->> 'livrable'
                                      and v_ligne ->> 'livrable' <> 'autre'
                               end))
                  and not public.facture_creditee_en_entier(h.facture_id)) then
      raise exception 'Cette période est déjà facturée : une facture qui n''est pas créditée en entier la couvre.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
create trigger honoraires_factures_gardes
  before insert or update or delete on public.honoraires_factures
  for each row execute function public.garder_honoraires_factures();

-- ══ 3. Qui lit ══════════
-- Le chef et les membres assignés au dossier du cabinet (LM-Q2) LISENT ; le super-administrateur insère pour restaurer.
-- Aucune policy d'écriture ordinaire : la fonction écrit. Le client n'y voit rien (le dossier du cabinet n'a aucun accès
-- client, LM1).
alter table public.honoraires_factures enable row level security;
create policy honoraires_factures_lecture on public.honoraires_factures
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy honoraires_factures_restauration on public.honoraires_factures
  for insert to authenticated with check (public.is_super_admin());

-- ══ 4. Le clic de « À facturer » ══════════
-- `p_elements` : un tableau de une à cinquante périodes ou tâches, chacune { lettre_id, ligne, periode_debut,
-- periode_fin }, d'un seul client ; `p_taux_tva` : 20, 8,5 ou 0 ; `p_facture` : nul, ou un objet aux seules clés
-- date_echeance, tiers_email, mentions_legales et notes (le reste vient de la lettre et des deux dossiers). Rend la
-- facture créée, en brouillon. Les refus, dans cet ordre (src/lib/honorairesAFacturer.ts les redit, à leurs mots) :
-- l'accès (42501) ; le dossier du cabinet (23514) ; le nombre d'éléments ; leur forme ; le taux ; les clés de la facture ;
-- un élément en double (22023) ; puis, élément par élément, dans l'ordre de la demande : la lettre introuvable (P0002) ;
-- pas acceptée ; d'un autre client ; la ligne introuvable ; le temps passé ; la forme de la période ; une période pas
-- commencée ; la lettre hors de vigueur (22023) ; puis le dossier du client disparu (22023) ; enfin, quand les liens se
-- posent, la garde : une période déjà facturée (23514), et tout se défait, le brouillon compris.
create function public.facturer_honoraires(p_dossier_id uuid, p_elements jsonb, p_taux_tva numeric, p_facture jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c_mois constant text[] := array['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre',
                                  'octobre', 'novembre', 'décembre'];
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_element jsonb;
  v_lettre public.lettres_de_mission;
  v_ligne jsonb;
  v_rang integer;
  v_debut date;
  v_fin date;
  v_client uuid;
  v_premier boolean := true;
  v_libelle_periode text;
  v_lignes jsonb := '[]'::jsonb;
  v_ht bigint := 0;
  v_tva bigint := 0;
  v_min date;
  v_max date;
  v_dossier_client public.dossiers;
  v_cabinet public.dossiers;
  v_siret text;
  v_facture jsonb;
  v_facture_id uuid;
  v_c record;
begin
  if not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if not public.est_dossier_du_cabinet(p_dossier_id) then
    raise exception 'Les honoraires se facturent dans le dossier du cabinet.' using errcode = '23514';
  end if;
  if jsonb_typeof(p_elements) is distinct from 'array' or jsonb_array_length(p_elements) not between 1 and 50 then
    raise exception 'Une facture d''honoraires porte de une à cinquante périodes ou tâches.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_elements) x
              where jsonb_typeof(x) is distinct from 'object'
                 or (select array_agg(k collate "C" order by k collate "C") from jsonb_object_keys(x) k)
                    is distinct from array['lettre_id', 'ligne', 'periode_debut', 'periode_fin']
                 or jsonb_typeof(x -> 'lettre_id') <> 'string' or not pg_input_is_valid(x ->> 'lettre_id', 'uuid')
                 or jsonb_typeof(x -> 'ligne') <> 'number' or (x ->> 'ligne') !~ '^[0-9]{1,2}$'
                 or jsonb_typeof(x -> 'periode_debut') <> 'string' or (x ->> 'periode_debut') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                 or not pg_input_is_valid(x ->> 'periode_debut', 'date')
                 or jsonb_typeof(x -> 'periode_fin') <> 'string' or (x ->> 'periode_fin') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                 or not pg_input_is_valid(x ->> 'periode_fin', 'date')) then
    raise exception 'Un élément à facturer se lit : la lettre, le rang de sa ligne d''honoraires, le début et la fin de sa période.'
      using errcode = '22023';
  end if;
  if p_taux_tva is null or p_taux_tva not in (0, 8.5, 20) then
    raise exception 'Le taux de TVA des honoraires est de 20 %%, de 8,5 %% (Guadeloupe, Martinique, La Réunion) ou nul (franchise).'
      using errcode = '22023';
  end if;
  if p_facture is not null and (jsonb_typeof(p_facture) <> 'object'
       or exists (select 1 from jsonb_each(p_facture) e
                   where e.key not in ('date_echeance', 'tiers_email', 'mentions_legales', 'notes')
                      or jsonb_typeof(e.value) not in ('string', 'null')
                      or (e.key = 'date_echeance' and jsonb_typeof(e.value) = 'string'
                          and ((e.value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or not pg_input_is_valid(e.value #>> '{}', 'date'))))) then
    raise exception 'La facture ne reçoit ici que son échéance, l''e-mail du client, ses mentions et ses notes : le reste vient de la lettre et des dossiers.'
      using errcode = '22023';
  end if;
  if (select count(*) from (select distinct x ->> 'lettre_id', (x ->> 'ligne')::integer, x ->> 'periode_debut', x ->> 'periode_fin'
                              from jsonb_array_elements(p_elements) x) d) <> jsonb_array_length(p_elements) then
    raise exception 'Un élément à facturer figure deux fois dans la demande.' using errcode = '22023';
  end if;

  for v_element in select x from jsonb_array_elements(p_elements) x loop
    select l.* into v_lettre from public.lettres_de_mission l
     where l.id = (v_element ->> 'lettre_id')::uuid and l.dossier_id = p_dossier_id;
    if not found then
      raise exception 'Lettre de mission introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    if v_lettre.acceptee_le is null then
      raise exception 'Une lettre de mission se facture une fois acceptée.' using errcode = '22023';
    end if;
    if v_premier then
      v_client := v_lettre.dossier_client_id;
      v_premier := false;
      -- Le verrou de la garde, pris d'abord : deux sessions qui facturent le même client se suivent, et la seconde voit
      -- ce que la première a posé (la garde le reprend, et juge la période déjà facturée).
      perform pg_advisory_xact_lock(hashtextextended('jd.honoraires_factures:' || p_dossier_id::text || ':'
                                                     || coalesce(v_client::text, '-'), 0));
    elsif v_lettre.dossier_client_id is distinct from v_client then
      raise exception 'Une facture d''honoraires s''adresse à un seul client.' using errcode = '22023';
    end if;
    v_rang := (v_element ->> 'ligne')::integer;
    v_ligne := case when v_rang >= 1 then v_lettre.honoraires -> (v_rang - 1) end;
    if v_ligne is null then
      raise exception 'Ligne d''honoraires introuvable dans la lettre.' using errcode = '22023';
    end if;
    if v_ligne ->> 'forme' not in ('forfait', 'tache') then
      raise exception 'Le temps passé ne se facture pas encore (LM9).' using errcode = '22023';
    end if;
    v_debut := (v_element ->> 'periode_debut')::date;
    v_fin := (v_element ->> 'periode_fin')::date;
    if v_ligne ->> 'forme' = 'forfait' and not public.periode_de_forfait_valide(v_ligne ->> 'periodicite', v_debut, v_fin) then
      raise exception 'Une période de forfait est un mois, un trimestre ou une année civils, selon sa périodicité.' using errcode = '22023';
    end if;
    if v_ligne ->> 'forme' = 'tache' and (v_fin < v_debut or v_fin >= (v_debut + interval '1 year')::date
                                         or v_debut < date '2000-01-01' or v_fin > date '2100-12-31') then
      raise exception 'La période d''une tâche tient en un an au plus, de son début à sa fin.' using errcode = '22023';
    end if;
    if v_debut > v_aujourd_hui then
      raise exception 'Une période ne se facture pas avant d''avoir commencé.' using errcode = '22023';
    end if;
    if (v_ligne ->> 'forme' = 'forfait' and not public.lettre_en_vigueur_le(v_lettre.id, v_fin))
       or (v_ligne ->> 'forme' = 'tache'
           and (not (public.lettre_en_vigueur_le(v_lettre.id, v_fin) or public.lettre_en_vigueur_le(v_lettre.id, v_aujourd_hui))
                or extract(year from v_debut) < coalesce(v_lettre.premier_exercice, 0))) then
      raise exception 'La lettre n''est pas en vigueur pour cette période.' using errcode = '22023';
    end if;
    -- La ligne de la facture : le libellé figé par la lettre et sa période, au montant hors taxes figé, une unité.
    v_libelle_periode := case
      when v_ligne ->> 'forme' = 'forfait' and v_ligne ->> 'periodicite' = 'mois'
        then c_mois[extract(month from v_debut)::integer] || ' ' || extract(year from v_debut)::integer
      when v_ligne ->> 'forme' = 'forfait' and v_ligne ->> 'periodicite' = 'trimestre'
        then case when extract(month from v_debut) = 1 then '1er' else ((extract(month from v_debut)::integer + 2) / 3)::text || 'e' end
             || ' trimestre ' || extract(year from v_debut)::integer
      when v_ligne ->> 'forme' = 'forfait' then 'année ' || extract(year from v_debut)::integer
      when extract(month from v_debut) = 1 and extract(day from v_debut) = 1 and v_fin = (v_debut + interval '1 year')::date - 1
        then 'exercice ' || extract(year from v_debut)::integer
      when public.periode_de_forfait_valide('mois', v_debut, v_fin)
        then c_mois[extract(month from v_debut)::integer] || ' ' || extract(year from v_debut)::integer
      when public.periode_de_forfait_valide('trimestre', v_debut, v_fin)
        then case when extract(month from v_debut) = 1 then '1er' else ((extract(month from v_debut)::integer + 2) / 3)::text || 'e' end
             || ' trimestre ' || extract(year from v_debut)::integer
      when v_debut = v_fin then 'le ' || to_char(v_debut, 'DD/MM/YYYY')
      else 'du ' || to_char(v_debut, 'DD/MM/YYYY') || ' au ' || to_char(v_fin, 'DD/MM/YYYY')
    end;
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object(
      'designation', (v_ligne ->> 'libelle') || ' — ' || v_libelle_periode,
      'quantite', 1, 'prix_unitaire_ht', (v_ligne ->> 'montant_ht')::numeric, 'taux_tva', p_taux_tva,
      'unite', 'C62', 'nature', 'services'));
    select * into v_c from public.centimes_ligne_facture(1, (v_ligne ->> 'montant_ht')::numeric, p_taux_tva, false);
    v_ht := v_ht + v_c.ht_centimes;
    v_tva := v_tva + v_c.tva_centimes;
    v_min := least(v_min, v_debut);
    v_max := greatest(v_max, v_fin);
  end loop;

  -- Le client, lu de SON dossier (LM-Q3) ; l'émetteur, du dossier du cabinet. La facture en fige la copie à sa validation.
  select d.* into v_dossier_client from public.dossiers d where d.id = v_client;
  if not found then
    raise exception 'Le dossier du client n''existe plus : sa facture se fait à la main.' using errcode = '22023';
  end if;
  select d.* into v_cabinet from public.dossiers d where d.id = p_dossier_id;
  v_siret := case when v_dossier_client.siret ~ '^[0-9]{14}$' then v_dossier_client.siret end;
  v_facture := jsonb_build_object(
    'tiers_nom', coalesce(nullif(btrim(v_dossier_client.denomination_imprimee), ''), v_dossier_client.nom),
    'tiers_adresse', v_dossier_client.adresse, 'tiers_siret', v_siret, 'tiers_siren', left(v_siret, 9),
    'type_client', case when v_siret is not null then 'assujetti' else 'non_assujetti' end,
    'nature_operation', 'services', 'date_emission', v_aujourd_hui, 'periode_debut', v_min, 'periode_fin', v_max,
    'emetteur_nom', coalesce(nullif(btrim(v_cabinet.denomination_imprimee), ''), v_cabinet.nom),
    'emetteur_siret', v_cabinet.siret, 'emetteur_adresse', v_cabinet.adresse,
    'montant_ht', round(v_ht / 100.0, 2), 'montant_tva', round(v_tva / 100.0, 2), 'montant_ttc', round((v_ht + v_tva) / 100.0, 2))
    || coalesce(p_facture, '{}'::jsonb);
  select r.facture_id into v_facture_id from public.enregistrer_facture(p_dossier_id, null, v_facture, v_lignes, false) r;

  for v_element in select x from jsonb_array_elements(p_elements) x loop
    insert into public.honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut, periode_fin, facturation, auteur)
    select p_dossier_id, v_facture_id, (v_element ->> 'lettre_id')::uuid, (v_element ->> 'ligne')::smallint,
           (v_element ->> 'periode_debut')::date, (v_element ->> 'periode_fin')::date,
           1 + (select count(*) from public.honoraires_factures h
                 where h.lettre_id = (v_element ->> 'lettre_id')::uuid and h.ligne = (v_element ->> 'ligne')::smallint
                   and h.periode_debut = (v_element ->> 'periode_debut')::date and h.periode_fin = (v_element ->> 'periode_fin')::date),
           auth.uid();
  end loop;
  return v_facture_id;
end
$$;

-- La fonction vérifie l'accès elle-même ; les contrôles, purs ou aux droits de l'appelant, servent la garde (que la
-- restauration du super-administrateur traverse sous `authenticated`) ; la garde ne sert qu'à la base.
revoke execute on function public.facturer_honoraires(uuid, jsonb, numeric, jsonb) from public, anon;
grant execute on function public.facturer_honoraires(uuid, jsonb, numeric, jsonb) to authenticated;
revoke execute on function public.periode_de_forfait_valide(text, date, date) from public, anon;
grant execute on function public.periode_de_forfait_valide(text, date, date) to authenticated;
revoke execute on function public.lettre_en_vigueur_le(uuid, date) from public, anon;
grant execute on function public.lettre_en_vigueur_le(uuid, date) to authenticated;
revoke execute on function public.facture_creditee_en_entier(uuid) from public, anon;
grant execute on function public.facture_creditee_en_entier(uuid) to authenticated;
revoke execute on function public.racine_de_la_lettre(uuid) from public, anon;
grant execute on function public.racine_de_la_lettre(uuid) to authenticated;
revoke execute on function public.garder_honoraires_factures() from public, anon, authenticated;
