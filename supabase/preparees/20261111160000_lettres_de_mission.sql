-- LM4 : LES LETTRES DE MISSION ET LEURS VERSIONS FIGÉES, EN BASE (ligne 47, le cabinet et ses clients) — PRÉPARÉE, PAS
-- APPLIQUÉE. À COLLER, APRÈS `dossier_du_cabinet` (LM1), dont elle lit la désignation.
--
-- La conception : HISTORIQUE.md, « 10/11/2026 — LA LETTRE DE MISSION ET LES HONORAIRES DU CABINET : LA CONCEPTION
-- (LIGNE 47) », points 3 et 4 ; les réponses du cabinet du 11/11/2026 : la lettre se range dans le dossier du cabinet
-- (LM-Q4 : elle survit au départ du client) ; le client l'accepte par un clic de son signataire désigné, ou par un papier
-- signé déposé (LM-Q5) — l'acceptation EN LIGNE attend la réponse de l'expert-comptable sur le droit de rétractation
-- (LM-Q10), le papier non ; le chef et les membres assignés au dossier du cabinet voient les honoraires (LM-Q2 :
-- `admin_du_dossier`) ; l'identité du client vient de son dossier (LM-Q3). Le récit : HISTORIQUE.md, « 11/11/2026 — LM4 ».
--
-- SOURCES, relues sur Légifrance le 11/11/2026. Décret n° 2012-432 du 30 mars 2012, art. 151 (version en vigueur depuis
-- le 01/01/2023, décret n° 2022-1732, art. 2) : les professionnels « passent avec leur client ou adhérent un contrat écrit
-- définissant leur mission », qui précise « les droits et obligations de chacune des parties », fait référence aux
-- « règles professionnelles définies par le conseil national de l'ordre » (3° de l'art. 29), peut prendre la forme d'une
-- lettre de mission et mentionne, le cas échéant, le mandat confié ; sa durée peut y être dite, et à défaut « elle est
-- réputée correspondre à la durée pour laquelle la lettre de mission est signée ». Art. 152 (version du 22/08/2014,
-- décret n° 2014-912) : la promotion et le démarchage — RIEN sur la lettre de mission ni les honoraires (la conception
-- l'y cherchait). Art. 158 (version du 21/11/2019, décret n° 2019-1193) : « Les honoraires sont fixés librement entre le
-- client et les experts-comptables ». CGI, art. 289, I-2 : la facture établie par un tiers au nom et pour le compte de
-- l'assujetti suppose un mandat préalable (BOI-TVA-DECLA-30-20-10-30). RGPD, art. 28 : le traitement confié à un
-- sous-traitant est régi par un contrat. C. civ., art. 1366 et 1367 : l'écrit et la signature électroniques. Aucune
-- norme AFNOR.
--
-- CE QU'ELLE FAIT. Dans le dossier du cabinet (LM1), deux tables et leurs fonctions d'écriture :
--   1. `modeles_lettre_de_mission` : le modèle du cabinet — un titre, ses conditions générales (le texte qui renvoie aux
--      règles professionnelles, art. 151, al. 2), le catalogue des missions qu'il décrit (un texte par mission, où se dit
--      le mandat confié, art. 151, al. 3) et le texte de ses clauses (le mandat de facturation, la sous-traitance). Il ne
--      se modifie pas : une nouvelle version le REMPLACE (chaîne `remplace_id`, une suite au plus), et la version courante
--      se RETIRE, une fois. Rien ne se supprime, sauf avec le dossier ;
--   2. `lettres_de_mission` : la lettre d'un client. BROUILLON, elle se réécrit en entier, à la version lue
--      (`modifiee_le`) ; PROPOSÉE, elle FIGE : ses missions (une liste fermée, que son modèle décrit), la répartition des
--      tâches entre le cabinet et le client, ses honoraires (forfait périodique, prix par tâche ; le temps passé attend
--      LM9), sa durée (date d'effet, premier exercice, fin de la première période, reconduction tacite, préavis), son
--      modèle, son signataire, les clauses que ses missions exigent, et deux COPIES lues par la base, jamais données par
--      l'appelant : l'identité du client, de son dossier (LM-Q3), et celle du cabinet, de son dossier ; puis son
--      EMPREINTE, le SHA-256 que la BASE calcule de tout ce contenu (`empreinte_de_la_lettre`), le texte du modèle
--      compris. Elle reçoit ensuite UNE réponse — acceptée, sur un papier signé déposé au dossier du cabinet et cité par
--      son empreinte, ou refusée —, puis se retire : un brouillon ou une proposition sans date, une lettre acceptée à la
--      date où elle prend fin (sa résiliation). Une lettre proposée ne se réécrit JAMAIS : une nouvelle version la
--      remplace (`remplace_id`, le même client) — un avenant, quand elle est acceptée —, et une lettre n'a qu'une nouvelle
--      version VIVANTE à la fois (ni refusée ni retirée) ; seule la version courante reçoit sa réponse ou se retire ;
--   3. ce qui n'est pas stocké, et se DÉDUIT (src/lib/lettresDeMission.ts) : l'état (brouillon, proposée, acceptée,
--      refusée, retirée, résiliée, échue), la lettre EN VIGUEUR d'un client à une date (acceptée, d'effet atteint, ni
--      résiliée, ni échue — sans reconduction, passé la fin de sa première période —, ni remplacée par une version
--      acceptée d'effet atteint) ;
--   4. le dossier du cabinet qui porte un modèle ou une lettre ne change plus de désignation
--      (`garder_designation_des_lettres`, 23514) : elles y resteraient sans gardien.
-- Les écritures passent par six fonctions `security definer`, l'accès vérifié avant toute lecture (`admin_du_dossier`,
-- puis `est_dossier_du_cabinet`) : `enregistrer_modele_de_lettre`, `retirer_modele_de_lettre`,
-- `enregistrer_brouillon_de_lettre`, `proposer_lettre_de_mission`, `enregistrer_reponse_a_la_lettre`,
-- `retirer_lettre_de_mission`. Les tables n'ont qu'une policy de lecture (`admin_du_dossier`, `to authenticated`) et la
-- porte de la restauration (`is_super_admin()`). Le client n'y lit rien : aucune policy ne le nomme.
--
-- L'ACCEPTATION EN LIGNE, PRÉVUE SANS ÊTRE OUVERTE (le choix, et pourquoi). Le schéma la porte — `mode_acceptation`
-- 'en_ligne', le compte qui accepte (`acceptee_par`, le signataire désigné), l'empreinte acceptée, qui doit être celle
-- de la lettre —, mais AUCUNE fonction ne l'écrit, et la garde la refuse à tout auteur, la restauration comprise, tant
-- que le drapeau de la base `acceptation_en_ligne_ouverte()` rend faux (23514, qui cite LM-Q10). L'ouvrir sera une
-- migration de LM6 : ce drapeau remplacé (`create or replace`, rien ne se retire) et la fonction du client, qui
-- vérifiera son accès au dossier du client (la case « Documents » de B1, préparée) et l'empreinte qu'il a vue. Écartés :
-- (A) la fonction du client écrite dès maintenant derrière le drapeau — un code qui ne peut pas tourner, qui lirait des
-- colonnes de B1 absentes de la production, et que rien n'éprouverait ; (B) rien dans le schéma — l'ouverture
-- changerait alors les contraintes d'une table où des lettres vivent déjà.
--
-- CE QU'ELLE NE FAIT PAS (lots suivants) : l'écran du cabinet (LM5 : modèle, rédaction, PDF — l'empreinte du PDF, s'il
-- se garde, sera une colonne de plus) ; l'espace du client, son acceptation en ligne et la déduction du dossier
-- permanent (LM6, LM-Q6) ; la lecture des missions en vigueur par les membres assignés au dossier du client, jamais les
-- montants (LM5) ; « À facturer » et `honoraires_factures` (LM7), qui citeront une ligne d'honoraires par la lettre et
-- son rang (1 pour la première) — figé avec la lettre, il ne bouge plus ; le temps passé (LM9).
--
-- CE QUI A ÉTÉ CHOISI, ET POURQUOI :
--   - le dossier du client est une RÉFÉRENCE sans clé étrangère (`dossier_client_id`), comme l'auteur d'une écriture :
--     la lettre lui survit (LM-Q4) avec la copie de son identité, et une clé vers un autre dossier que celui de la
--     sauvegarde serait sacrifiée à chaque restauration du dossier du cabinet (`liensPerdus`, src/lib/sauvegarde.ts) ;
--     la garde vérifie, à l'écriture, un autre dossier du même cabinet ;
--   - les honoraires et la répartition, des tableaux jsonb que des contrôles de la base valident forme par forme, plutôt
--     qu'une table enfant : un brouillon se réécrit d'un bloc, sans suppression de lignes, et le rang d'une ligne,
--     figé avec la lettre, suffit à LM7 ;
--   - le papier signé est un `documents_divers` du dossier du cabinet, cité par une clé sans action (il ne se supprime
--     plus, sauf avec le dossier) et par son empreinte, recopiée ;
--   - la clause de sous-traitance est exigée de TOUTE lettre (le cabinet traite, pour son client, des données
--     personnelles de tiers) et celle du mandat de facturation de la mission « facturation au nom du client » : une
--     HYPOTHÈSE (LM4-Q1), rangée dans `clauses_requises`, qui se reprendra par `create or replace function`.
--
-- À COLLER : les clés étrangères et la garde nomment l'action de suppression. Rien ne se détruit : deux tables,
-- dix-neuf fonctions et trois déclencheurs s'ajoutent, aucune ne se remplace. Son retour :
-- supabase/preparees/retour/20261111160100_retour_lettres_de_mission.sql. Son essai : supabase/essais/lettresDeMission.sql
-- (sur une réplique : il désigne le dossier du cabinet et supprime un dossier jetable) ; puis rls.sql (le bloc LM).

do $garde$
begin
  if to_regclass('public.dossiers') is null or to_regclass('public.documents_divers') is null
     or to_regclass('public.memberships') is null or to_regclass('public.cabinets') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null or to_regprocedure('public.is_super_admin()') is null then
    raise exception 'Les tables ou les prédicats que la migration suppose manquent : relire la base.';
  end if;
  if to_regprocedure('public.est_dossier_du_cabinet(uuid)') is null then
    raise exception 'Le dossier du cabinet (LM1, migration dossier_du_cabinet) n''est pas en base : la coller d''abord.';
  end if;
  if to_regclass('public.lettres_de_mission') is not null or to_regclass('public.modeles_lettre_de_mission') is not null then
    raise exception 'Les lettres de mission sont déjà en base : la migration a déjà été appliquée.';
  end if;
end
$garde$;

-- ══ 1. Le catalogue, les contrôles de forme et le drapeau ══════════
-- Des fonctions immuables, que les contrôles des tables appellent : exécutables par `authenticated` (la restauration du
-- super-administrateur insère sous ce rôle, et un contrôle s'exécute aux droits de qui écrit), jamais par l'anonyme.
create function public.missions_de_lettre() returns text[]
language sql immutable set search_path = public
as $$ select array['tenue_comptable', 'presentation_des_comptes', 'declaration_2035', 'declarations_tva', 'volet_social',
                    'facturation_au_nom_du_client', 'relances_des_clients'] $$;

create function public.clauses_de_lettre() returns text[]
language sql immutable set search_path = public
as $$ select array['mandat_de_facturation', 'sous_traitance'] $$;

-- HYPOTHÈSE LM4-Q1 : la sous-traitance (RGPD, art. 28) de toute lettre ; le mandat de facturation (CGI, art. 289, I-2) de
-- la mission qui facture au nom du client.
create function public.clauses_requises(p_missions text[]) returns text[]
language sql immutable set search_path = public
as $$ select array_remove(array[case when 'facturation_au_nom_du_client' = any (coalesce(p_missions, '{}'))
                                     then 'mandat_de_facturation' end, 'sous_traitance'], null) $$;

create function public.lettre_missions_valides(p text[]) returns boolean
language sql immutable set search_path = public
as $$ select p is not null and array_position(p, null) is null and p <@ public.missions_de_lettre()
             and cardinality(p) = (select count(distinct m) from unnest(p) m) $$;

-- Un objet { mission du catalogue : sa description }, une mission au moins, 4 000 caractères chacune.
create function public.modele_missions_valides(p jsonb) returns boolean
language sql immutable set search_path = public
as $$ select case when jsonb_typeof(p) is distinct from 'object' then false
                  else exists (select 1 from jsonb_each(p))
                       and not exists (select 1 from jsonb_each(p) e
                                        where e.key <> all (public.missions_de_lettre())
                                           or jsonb_typeof(e.value) <> 'string'
                                           or btrim(e.value #>> '{}', E' \t\n\r') = ''
                                           or length(e.value #>> '{}') > 4000)
             end $$;

-- Un objet { clause : son texte }, peut-être vide, 8 000 caractères chacune.
create function public.modele_clauses_valides(p jsonb) returns boolean
language sql immutable set search_path = public
as $$ select case when jsonb_typeof(p) is distinct from 'object' then false
                  else not exists (select 1 from jsonb_each(p) e
                                    where e.key <> all (public.clauses_de_lettre())
                                       or jsonb_typeof(e.value) <> 'string'
                                       or btrim(e.value #>> '{}', E' \t\n\r') = ''
                                       or length(e.value #>> '{}') > 8000)
             end $$;

-- Un tableau d'au plus 60 tâches { tache, par } : un texte de 500 caractères au plus, au cabinet ou au client.
create function public.repartition_valide(p jsonb) returns boolean
language sql immutable set search_path = public
as $$ select case when jsonb_typeof(p) is distinct from 'array' then false
                  else jsonb_array_length(p) <= 60
                       and not exists (select 1 from jsonb_array_elements(p) e
                                        where case when jsonb_typeof(e) <> 'object' then true
                                                   else (select count(*) from jsonb_object_keys(e)) <> 2
                                                        or jsonb_typeof(e -> 'tache') is distinct from 'string'
                                                        or btrim(e ->> 'tache', E' \t\n\r') = '' or length(e ->> 'tache') > 500
                                                        or jsonb_typeof(e -> 'par') is distinct from 'string'
                                                        or (e ->> 'par') not in ('cabinet', 'client')
                                              end)
             end $$;

-- Un tableau d'au plus 50 lignes : un forfait (une périodicité), un prix par tâche (un livrable) ou un taux horaire (le
-- temps passé, que la proposition refuse jusqu'à LM9) ; un libellé de 300 caractères au plus ; un montant hors taxes en
-- euros, positif, au centime, sous le milliard.
create function public.honoraires_valides(p jsonb) returns boolean
language sql immutable set search_path = public
as $$ select case when jsonb_typeof(p) is distinct from 'array' then false
                  else jsonb_array_length(p) <= 50
                       and not exists (select 1 from jsonb_array_elements(p) e
                                        where case when jsonb_typeof(e) <> 'object' then true
                                                   when exists (select 1 from jsonb_object_keys(e) k
                                                                 where k not in ('forme', 'libelle', 'montant_ht', 'periodicite', 'livrable')) then true
                                                   when jsonb_typeof(e -> 'libelle') is distinct from 'string'
                                                        or btrim(e ->> 'libelle', E' \t\n\r') = '' or length(e ->> 'libelle') > 300 then true
                                                   when jsonb_typeof(e -> 'montant_ht') is distinct from 'number' then true
                                                   when (e ->> 'montant_ht')::numeric <= 0 or (e ->> 'montant_ht')::numeric > 999999999.99
                                                        or (e ->> 'montant_ht')::numeric <> round((e ->> 'montant_ht')::numeric, 2) then true
                                                   when jsonb_typeof(e -> 'forme') is distinct from 'string' then true
                                                   when e ->> 'forme' = 'forfait' then
                                                        jsonb_typeof(e -> 'periodicite') is distinct from 'string'
                                                        or (e ->> 'periodicite') not in ('mois', 'trimestre', 'annee') or e ? 'livrable'
                                                   when e ->> 'forme' = 'tache' then
                                                        jsonb_typeof(e -> 'livrable') is distinct from 'string'
                                                        or (e ->> 'livrable') not in ('declaration_2035', 'declaration_tva', 'bilan', 'autre')
                                                        or e ? 'periodicite'
                                                   when e ->> 'forme' = 'temps' then e ? 'periodicite' or e ? 'livrable'
                                                   else true
                                              end)
             end $$;

-- LE DROIT DE L'ACCEPTATION EN LIGNE : faux tant que l'expert-comptable n'a pas répondu sur le droit de rétractation
-- (LM-Q10, C. consom., art. L221-3). L'ouvrir se fera par une migration qui le remplace ; `stable`, pour qu'aucun plan
-- ne garde sa valeur d'hier.
create function public.acceptation_en_ligne_ouverte() returns boolean
language sql stable set search_path = public
as $$ select false $$;

-- ══ 2. Les modèles ══════════
create table public.modeles_lettre_de_mission (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  titre text not null
    constraint modeles_lettre_titre check (btrim(titre, E' \t\n\r') <> '' and length(titre) <= 200),
  conditions_generales text not null
    constraint modeles_lettre_conditions check (btrim(conditions_generales, E' \t\n\r') <> '' and length(conditions_generales) <= 100000),
  missions jsonb not null
    constraint modeles_lettre_missions check (public.modele_missions_valides(missions)),
  clauses jsonb not null default '{}'::jsonb
    constraint modeles_lettre_clauses check (public.modele_clauses_valides(clauses)),
  remplace_id uuid references public.modeles_lettre_de_mission (id),
  auteur uuid not null,
  cree_le timestamptz not null default now(),
  retire_le timestamptz,
  retire_par uuid,
  constraint modeles_lettre_retrait check ((retire_le is null) = (retire_par is null)),
  constraint modeles_lettre_une_suite unique (remplace_id)
);
create index modeles_lettre_dossier on public.modeles_lettre_de_mission (dossier_id);
comment on table public.modeles_lettre_de_mission is
  'Le modèle de lettre de mission du cabinet (LM4, ligne 47), dans le dossier du cabinet : immuable, remplacé ou retiré.';

-- La garde, aux droits de l'appelant (la forme du dossier permanent, R7) : un modèle ne se modifie pas — sauf son
-- retrait, une fois, sur la version courante — et ne se supprime qu'avec son dossier ; il en remplace un de son dossier,
-- qui n'est pas retiré. Sous le verrou des lettres du dossier.
create function public.garder_modele_de_lettre() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Un modèle de lettre de mission ne se supprime pas : il se remplace, ou se retire.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['retire_le', 'retire_par']) is distinct from (to_jsonb(old) - array['retire_le', 'retire_par'])
       or old.retire_le is not null or new.retire_le is null then
      raise exception 'Un modèle de lettre de mission ne se modifie pas : il se remplace par une nouvelle version, ou se retire, une fois.'
        using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('jd.lettres_de_mission:' || old.dossier_id::text, 0));
    if exists (select 1 from public.modeles_lettre_de_mission s where s.remplace_id = old.id) then
      raise exception 'Seule la version courante d''un modèle de lettre de mission se retire.' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.remplace_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('jd.lettres_de_mission:' || new.dossier_id::text, 0));
    if not exists (select 1 from public.modeles_lettre_de_mission m
                    where m.id = new.remplace_id and m.dossier_id = new.dossier_id and m.retire_le is null) then
      raise exception 'Un modèle de lettre de mission en remplace un de son dossier, qui n''est pas retiré.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
create trigger modeles_lettre_gardes
  before insert or update or delete on public.modeles_lettre_de_mission
  for each row execute function public.garder_modele_de_lettre();

-- ══ 3. Les lettres ══════════
create table public.lettres_de_mission (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  -- Le dossier du client : une référence sans clé (la lettre lui survit, LM-Q4), vérifiée par la garde à l'écriture.
  dossier_client_id uuid,
  modele_id uuid references public.modeles_lettre_de_mission (id),
  remplace_id uuid references public.lettres_de_mission (id),
  -- Le contenu, réécrit tant que la lettre est un brouillon, figé à la proposition.
  missions text[] not null default '{}'
    constraint lettres_de_mission_missions check (public.lettre_missions_valides(missions)),
  repartition jsonb not null default '[]'::jsonb
    constraint lettres_de_mission_repartition check (public.repartition_valide(repartition)),
  honoraires jsonb not null default '[]'::jsonb
    constraint lettres_de_mission_honoraires check (public.honoraires_valides(honoraires)),
  date_effet date
    constraint lettres_de_mission_date_effet check (date_effet between date '2000-01-01' and date '2100-12-31'),
  premier_exercice smallint
    constraint lettres_de_mission_premier_exercice check (premier_exercice between 2000 and 2100),
  fin_initiale date
    constraint lettres_de_mission_fin_initiale check (fin_initiale between date '2000-01-01' and date '2100-12-31'),
  reconduction_tacite boolean not null default true,
  preavis_mois smallint not null default 3
    constraint lettres_de_mission_preavis check (preavis_mois between 0 and 12),
  signataire_nom text
    constraint lettres_de_mission_signataire_nom check (btrim(signataire_nom, E' \t\n\r') <> '' and length(signataire_nom) <= 200),
  signataire_qualite text
    constraint lettres_de_mission_signataire_qualite check (btrim(signataire_qualite, E' \t\n\r') <> '' and length(signataire_qualite) <= 200),
  signataire_compte uuid,
  modifiee_le timestamptz not null default now(),
  -- La proposition : des copies lues par la base, et l'empreinte qu'elle calcule.
  identite_client jsonb,
  identite_cabinet jsonb,
  clauses text[],
  empreinte text
    constraint lettres_de_mission_empreinte check (empreinte ~ '^[0-9a-f]{64}$'),
  proposee_le timestamptz,
  proposee_par uuid,
  -- La réponse : acceptée (sur papier signé ; en ligne, prévue et fermée) ou refusée.
  acceptee_le timestamptz,
  acceptee_par uuid,
  mode_acceptation text
    constraint lettres_de_mission_mode check (mode_acceptation in ('en_ligne', 'papier')),
  empreinte_acceptee text,
  document_signe_id uuid references public.documents_divers (id),
  empreinte_papier text
    constraint lettres_de_mission_empreinte_papier check (empreinte_papier ~ '^[0-9a-f]{64}$'),
  signee_le date
    constraint lettres_de_mission_signee_le check (signee_le between date '2000-01-01' and date '2100-12-31'),
  refusee_le timestamptz,
  refusee_par uuid,
  -- La fin : le retrait d'un brouillon ou d'une proposition, ou la résiliation d'une lettre acceptée, à sa date.
  retiree_le timestamptz,
  retiree_par uuid,
  fin_au date
    constraint lettres_de_mission_fin_au check (fin_au between date '2000-01-01' and date '2100-12-31'),
  auteur uuid not null,
  cree_le timestamptz not null default now(),
  constraint lettres_de_mission_periode check (fin_initiale >= date_effet),
  constraint lettres_de_mission_proposition check (
    (proposee_le is null) = (proposee_par is null) and (proposee_le is null) = (empreinte is null)
    and (proposee_le is null) = (identite_client is null) and (proposee_le is null) = (identite_cabinet is null)
    and (proposee_le is null) = (clauses is null)),
  constraint lettres_de_mission_acceptation check (
    (acceptee_le is null) = (acceptee_par is null) and (acceptee_le is null) = (mode_acceptation is null)
    and (acceptee_le is null) = (empreinte_acceptee is null) and (acceptee_le is null or proposee_le is not null)
    and (empreinte_acceptee is null or empreinte_acceptee = empreinte)),
  constraint lettres_de_mission_papier check (
    coalesce(mode_acceptation = 'papier', false) = (document_signe_id is not null)
    and (document_signe_id is null) = (empreinte_papier is null) and (document_signe_id is null) = (signee_le is null)),
  constraint lettres_de_mission_refus check (
    (refusee_le is null) = (refusee_par is null) and (refusee_le is null or (proposee_le is not null and acceptee_le is null))),
  constraint lettres_de_mission_retrait check (
    (retiree_le is null) = (retiree_par is null) and (retiree_le is null or refusee_le is null)
    and (fin_au is not null) = (retiree_le is not null and acceptee_le is not null)
    and (fin_au is null or fin_au >= date_effet))
);
create index lettres_de_mission_dossier on public.lettres_de_mission (dossier_id);
create index lettres_de_mission_remplace on public.lettres_de_mission (remplace_id);
create index lettres_de_mission_document on public.lettres_de_mission (document_signe_id);
-- Une seule nouvelle version VIVANTE (ni refusée ni retirée) par lettre : une version refusée ou retirée libère la place.
create unique index lettres_de_mission_une_suite_vivante on public.lettres_de_mission (remplace_id)
  where refusee_le is null and retiree_le is null;
comment on table public.lettres_de_mission is
  'La lettre de mission d''un client (LM4, ligne 47), dans le dossier du cabinet : figée à la proposition, puis acceptée, refusée ou retirée ; remplacée, jamais réécrite.';

-- L'EMPREINTE : le SHA-256 du contenu figé, que la base calcule — le texte du modèle compris —, en jsonb (dont la forme
-- textuelle est canonique), l'instant en UTC écrit en toutes lettres (le fuseau de la session n'y entre pas).
create function public.empreinte_de_la_lettre(l public.lettres_de_mission) returns text
language sql stable security definer set search_path = public
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'forme', 1, 'lettre', l.id, 'dossier', l.dossier_id, 'dossier_client', l.dossier_client_id, 'remplace', l.remplace_id,
    'modele', (select jsonb_build_object('id', m.id, 'titre', m.titre, 'conditions_generales', m.conditions_generales,
                                         'missions', m.missions, 'clauses', m.clauses)
                 from public.modeles_lettre_de_mission m where m.id = l.modele_id),
    'missions', to_jsonb(l.missions), 'repartition', l.repartition, 'honoraires', l.honoraires,
    'date_effet', l.date_effet, 'premier_exercice', l.premier_exercice, 'fin_initiale', l.fin_initiale,
    'reconduction_tacite', l.reconduction_tacite, 'preavis_mois', l.preavis_mois,
    'signataire', jsonb_build_object('nom', l.signataire_nom, 'qualite', l.signataire_qualite, 'compte', l.signataire_compte),
    'identite_client', l.identite_client, 'identite_cabinet', l.identite_cabinet, 'clauses', to_jsonb(l.clauses),
    'proposee_le', to_char(l.proposee_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposee_par', l.proposee_par)::text, 'UTF8')), 'hex')
$$;

-- LA GARDE des lettres, aux droits de l'appelant. Elle tient, pour tout auteur — les fonctions, la restauration du
-- super-administrateur, le propriétaire — : le modèle est de son dossier, le client un autre dossier de son cabinet ; une
-- nouvelle version remplace une lettre PROPOSÉE de son dossier, pour le même client, et n'est la seule suite vivante ;
-- une lettre ne se supprime qu'avec son dossier ; une lettre PROPOSÉE ne change plus que par une transition : sa réponse
-- (acceptée ou refusée), ou son retrait, sur la version courante ; un brouillon, par sa réécriture, sa proposition (dont
-- l'empreinte est celle que la base recalcule) ou son retrait. L'acceptation en ligne se refuse tant que le drapeau est
-- baissé. Ce que les fonctions vérifient de plus — la version lue, le contenu complet — ne se rejoue pas ici : une
-- restauration réinsère l'histoire telle qu'elle a été écrite.
create function public.garder_lettre_de_mission() returns trigger
language plpgsql
set search_path = public
as $$
declare
  c_contenu constant text[] := array['dossier_client_id', 'modele_id', 'missions', 'repartition', 'honoraires', 'date_effet',
    'premier_exercice', 'fin_initiale', 'reconduction_tacite', 'preavis_mois', 'signataire_nom', 'signataire_qualite',
    'signataire_compte', 'modifiee_le'];
  c_proposition constant text[] := array['identite_client', 'identite_cabinet', 'clauses', 'empreinte', 'proposee_le', 'proposee_par'];
  c_acceptation constant text[] := array['acceptee_le', 'acceptee_par', 'mode_acceptation', 'empreinte_acceptee',
    'document_signe_id', 'empreinte_papier', 'signee_le'];
  c_refus constant text[] := array['refusee_le', 'refusee_par'];
  c_retrait constant text[] := array['retiree_le', 'retiree_par', 'fin_au'];
  v_vieux jsonb;
  v_neuf jsonb;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une lettre de mission ne se supprime pas : elle se retire, et l''historique reste.' using errcode = '23514';
  end if;
  if new.mode_acceptation = 'en_ligne' and not public.acceptation_en_ligne_ouverte() then
    raise exception 'L''acceptation en ligne d''une lettre de mission n''est pas ouverte : elle attend la réponse sur le droit de rétractation (LM-Q10).'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.modele_id is distinct from old.modele_id then
    if new.modele_id is not null
       and not exists (select 1 from public.modeles_lettre_de_mission m where m.id = new.modele_id and m.dossier_id = new.dossier_id) then
      raise exception 'Une lettre de mission suit un modèle de son dossier.' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' or new.dossier_client_id is distinct from old.dossier_client_id then
    if new.dossier_client_id is not null
       and exists (select 1 from public.dossiers c where c.id = new.dossier_client_id)
       and not exists (select 1 from public.dossiers c join public.dossiers k on k.id = new.dossier_id
                        where c.id = new.dossier_client_id and c.cabinet_id = k.cabinet_id and c.id <> k.id) then
      raise exception 'Le client d''une lettre de mission est un autre dossier de son cabinet.' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.remplace_id is not null then
      perform pg_advisory_xact_lock(hashtextextended('jd.lettres_de_mission:' || new.dossier_id::text, 0));
      if not exists (select 1 from public.lettres_de_mission l
                      where l.id = new.remplace_id and l.dossier_id = new.dossier_id and l.proposee_le is not null
                        and l.dossier_client_id is not null and l.dossier_client_id = new.dossier_client_id) then
        raise exception 'Une nouvelle version de lettre de mission remplace une lettre proposée de son dossier, pour le même client.'
          using errcode = '23514';
      end if;
      if new.refusee_le is null and new.retiree_le is null
         and exists (select 1 from public.lettres_de_mission s
                      where s.remplace_id = new.remplace_id and s.refusee_le is null and s.retiree_le is null) then
        raise exception 'Une lettre de mission n''a qu''une nouvelle version en cours.' using errcode = '23514';
      end if;
    end if;
    if new.document_signe_id is not null then
      perform 1 from public.documents_divers d where d.id = new.document_signe_id and d.dossier_id = new.dossier_id for share;
      if not found then
        raise exception 'Le papier signé d''une lettre de mission est un document de son dossier.' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE : une transition, et une seule.
  v_vieux := to_jsonb(old);
  v_neuf := to_jsonb(new);
  if old.proposee_le is null and old.retiree_le is null then
    if new.proposee_le is null and new.retiree_le is null and (v_neuf - c_contenu) = (v_vieux - c_contenu) then
      return new;
    end if;
    if new.proposee_le is not null and (v_neuf - c_proposition) = (v_vieux - c_proposition) then
      if new.empreinte is distinct from public.empreinte_de_la_lettre(new) then
        raise exception 'L''empreinte d''une lettre de mission est celle que la base calcule de son contenu.' using errcode = '23514';
      end if;
      return new;
    end if;
    if new.retiree_le is not null and (v_neuf - c_retrait) = (v_vieux - c_retrait) then
      return new;
    end if;
  elsif old.proposee_le is not null and old.retiree_le is null and old.refusee_le is null then
    perform pg_advisory_xact_lock(hashtextextended('jd.lettres_de_mission:' || old.dossier_id::text, 0));
    if exists (select 1 from public.lettres_de_mission s
                where s.remplace_id = old.id and s.refusee_le is null and s.retiree_le is null) then
      raise exception 'Seule la version courante d''une lettre de mission reçoit une réponse ou se retire.' using errcode = '23514';
    end if;
    if old.acceptee_le is null and new.acceptee_le is not null and (v_neuf - c_acceptation) = (v_vieux - c_acceptation) then
      if new.document_signe_id is not null then
        perform 1 from public.documents_divers d where d.id = new.document_signe_id and d.dossier_id = new.dossier_id for share;
        if not found then
          raise exception 'Le papier signé d''une lettre de mission est un document de son dossier.' using errcode = '23514';
        end if;
      end if;
      return new;
    end if;
    if old.acceptee_le is null and new.refusee_le is not null and (v_neuf - c_refus) = (v_vieux - c_refus) then
      return new;
    end if;
    if new.retiree_le is not null and (v_neuf - c_retrait) = (v_vieux - c_retrait) then
      return new;
    end if;
  end if;
  raise exception 'Une lettre de mission proposée ne se modifie plus : elle se remplace par une nouvelle version, ou se retire.'
    using errcode = '23514';
end
$$;
create trigger lettres_de_mission_gardes
  before insert or update or delete on public.lettres_de_mission
  for each row execute function public.garder_lettre_de_mission();

-- ══ 4. Le dossier du cabinet qui porte des lettres ne change plus de désignation ══════════
-- `designer_dossier_du_cabinet` (LM1) prend la ligne du cabinet en mise à jour ; ce déclencheur la suit. La sortie de la
-- clé étrangère reste ouverte : le dossier désigné n'est plus (le super-administrateur l'a retiré avec le cabinet).
create function public.garder_designation_des_lettres() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dossier_du_cabinet is not distinct from old.dossier_du_cabinet or old.dossier_du_cabinet is null
     or not exists (select 1 from public.dossiers d where d.id = old.dossier_du_cabinet) then
    return new;
  end if;
  if exists (select 1 from public.modeles_lettre_de_mission m where m.dossier_id = old.dossier_du_cabinet)
     or exists (select 1 from public.lettres_de_mission l where l.dossier_id = old.dossier_du_cabinet) then
    raise exception 'Le dossier du cabinet porte des lettres de mission : sa désignation ne change plus.' using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger cabinets_designation_des_lettres
  before update of dossier_du_cabinet on public.cabinets
  for each row execute function public.garder_designation_des_lettres();

-- ══ 5. Qui lit ══════════
-- Le chef et les membres assignés au dossier du cabinet (LM-Q2) LISENT ; le super-administrateur insère pour restaurer.
-- Aucune policy d'écriture ordinaire : les six fonctions écrivent. Le client n'y voit rien.
alter table public.modeles_lettre_de_mission enable row level security;
create policy modeles_lettre_lecture on public.modeles_lettre_de_mission
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy modeles_lettre_restauration on public.modeles_lettre_de_mission
  for insert to authenticated with check (is_super_admin());
alter table public.lettres_de_mission enable row level security;
create policy lettres_de_mission_lecture on public.lettres_de_mission
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy lettres_de_mission_restauration on public.lettres_de_mission
  for insert to authenticated with check (is_super_admin());

-- ══ 6. Les modèles : enregistrer une version, la retirer ══════════
-- Les refus, dans cet ordre (src/lib/lettresDeMission.ts les redit, à leurs mots) : l'accès (42501) ; un dossier qui
-- n'est pas le dossier du cabinet (23514) ; le titre ; les conditions générales ; les missions ; les clauses ; le modèle
-- remplacé, qui est de ce dossier, courant et non retiré (22023).
create function public.enregistrer_modele_de_lettre(
  p_dossier_id uuid, p_titre text, p_conditions_generales text, p_missions jsonb, p_clauses jsonb, p_remplace_id uuid
)
returns public.modeles_lettre_de_mission
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cible public.modeles_lettre_de_mission;
  v_modele public.modeles_lettre_de_mission;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if not public.est_dossier_du_cabinet(p_dossier_id) then
    raise exception 'Les lettres de mission se rédigent dans le dossier du cabinet.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.lettres_de_mission:' || p_dossier_id::text, 0));
  if p_titre is null or btrim(p_titre, E' \t\n\r') = '' or length(p_titre) > 200 then
    raise exception 'Un modèle porte un titre de 200 caractères au plus.' using errcode = '22023';
  end if;
  if p_conditions_generales is null or btrim(p_conditions_generales, E' \t\n\r') = '' or length(p_conditions_generales) > 100000 then
    raise exception 'Un modèle porte ses conditions générales, en 100 000 caractères au plus.' using errcode = '22023';
  end if;
  if not coalesce(public.modele_missions_valides(p_missions), false) then
    raise exception 'Un modèle décrit au moins une mission du catalogue, chacune en 4 000 caractères au plus.' using errcode = '22023';
  end if;
  if not coalesce(public.modele_clauses_valides(coalesce(p_clauses, '{}'::jsonb)), false) then
    raise exception 'Une clause d''un modèle est le mandat de facturation ou la sous-traitance, en 8 000 caractères au plus.'
      using errcode = '22023';
  end if;
  if p_remplace_id is not null then
    select * into v_cible from public.modeles_lettre_de_mission m where m.id = p_remplace_id and m.dossier_id = p_dossier_id;
    if not found then
      raise exception 'Le modèle à remplacer n''est pas un modèle de ce dossier.' using errcode = '22023';
    end if;
    if exists (select 1 from public.modeles_lettre_de_mission s where s.remplace_id = p_remplace_id) then
      raise exception 'Ce modèle a été remplacé depuis : relire avant de le remplacer.' using errcode = '22023';
    end if;
    if v_cible.retire_le is not null then
      raise exception 'Ce modèle est retiré : il ne se remplace plus.' using errcode = '22023';
    end if;
  end if;
  insert into public.modeles_lettre_de_mission (dossier_id, titre, conditions_generales, missions, clauses, remplace_id, auteur)
  values (p_dossier_id, p_titre, p_conditions_generales, p_missions, coalesce(p_clauses, '{}'::jsonb), p_remplace_id, auth.uid())
  returning * into v_modele;
  return v_modele;
end
$$;

create function public.retirer_modele_de_lettre(p_dossier_id uuid, p_modele_id uuid)
returns public.modeles_lettre_de_mission
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modele public.modeles_lettre_de_mission;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if not public.est_dossier_du_cabinet(p_dossier_id) then
    raise exception 'Les lettres de mission se rédigent dans le dossier du cabinet.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.lettres_de_mission:' || p_dossier_id::text, 0));
  select * into v_modele from public.modeles_lettre_de_mission m where m.id = p_modele_id and m.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Modèle introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.modeles_lettre_de_mission s where s.remplace_id = p_modele_id) then
    raise exception 'Ce modèle a été remplacé depuis : relire avant de le retirer.' using errcode = '22023';
  end if;
  if v_modele.retire_le is not null then
    raise exception 'Ce modèle est déjà retiré.' using errcode = '22023';
  end if;
  update public.modeles_lettre_de_mission set retire_le = now(), retire_par = auth.uid()
   where id = p_modele_id
  returning * into v_modele;
  return v_modele;
end
$$;

-- ══ 7. Le brouillon : créer, réécrire ══════════
-- Le contenu est un objet aux seules clés de la lettre ; il REMPLACE le contenu entier (une clé absente vaut nul, ou la
-- valeur par défaut). Une lettre nouvelle peut en remplacer une autre (`remplace_id`), qui ne change plus ensuite. Une
-- réécriture retient la version lue (`p_modifiee_le`). Les refus, dans cet ordre : l'accès (42501) ; le dossier du
-- cabinet (23514) ; le contenu illisible ; les missions ; la répartition ; les honoraires ; les dates ; le préavis ; le
-- signataire ; le client ; le modèle (22023) ; puis, pour une lettre nouvelle, la lettre remplacée (sa nature, son
-- client, sa suite vivante), et pour une lettre existante, la lettre introuvable (P0002), proposée, retirée, lue à une
-- autre version, son remplacement changé, son client changé (22023).
create function public.enregistrer_brouillon_de_lettre(
  p_dossier_id uuid, p_lettre_id uuid, p_contenu jsonb, p_modifiee_le timestamptz
)
returns public.lettres_de_mission
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.lettres_de_mission;
  v_actuelle public.lettres_de_mission;
  v_cible public.lettres_de_mission;
  v_remplace uuid;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if not public.est_dossier_du_cabinet(p_dossier_id) then
    raise exception 'Les lettres de mission se rédigent dans le dossier du cabinet.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.lettres_de_mission:' || p_dossier_id::text, 0));
  if p_contenu is null
     or (case when jsonb_typeof(p_contenu) <> 'object' then true
              else exists (select 1 from jsonb_object_keys(p_contenu) k
                            where k not in ('dossier_client_id', 'modele_id', 'remplace_id', 'missions', 'repartition', 'honoraires',
                                            'date_effet', 'premier_exercice', 'fin_initiale', 'reconduction_tacite', 'preavis_mois',
                                            'signataire_nom', 'signataire_qualite', 'signataire_compte'))
         end) then
    raise exception 'Le contenu de la lettre est illisible : un objet aux seules clés de la lettre.' using errcode = '22023';
  end if;
  v := jsonb_populate_record(null::public.lettres_de_mission, p_contenu);
  v.missions := coalesce(v.missions, '{}');
  v.repartition := coalesce(v.repartition, '[]'::jsonb);
  v.honoraires := coalesce(v.honoraires, '[]'::jsonb);
  v.reconduction_tacite := coalesce(v.reconduction_tacite, true);
  v.preavis_mois := coalesce(v.preavis_mois, 3);
  if not public.lettre_missions_valides(v.missions) then
    raise exception 'Une mission de la lettre n''est pas du catalogue, ou y figure deux fois.' using errcode = '22023';
  end if;
  if not public.repartition_valide(v.repartition) then
    raise exception 'La répartition des tâches est illisible : des tâches de 500 caractères au plus, au cabinet ou au client.'
      using errcode = '22023';
  end if;
  if not public.honoraires_valides(v.honoraires) then
    raise exception 'Les honoraires sont illisibles : un forfait périodique, un prix par tâche ou un taux horaire, hors taxes, au centime.'
      using errcode = '22023';
  end if;
  if v.date_effet not between date '2000-01-01' and date '2100-12-31' or v.fin_initiale not between date '2000-01-01' and date '2100-12-31'
     or v.premier_exercice not between 2000 and 2100 or v.fin_initiale < v.date_effet then
    raise exception 'Les dates de la lettre sont entre 2000 et 2100, et sa première période ne finit pas avant sa date d''effet.'
      using errcode = '22023';
  end if;
  if v.preavis_mois not between 0 and 12 then
    raise exception 'Le préavis tient en douze mois au plus.' using errcode = '22023';
  end if;
  if btrim(v.signataire_nom, E' \t\n\r') = '' or length(v.signataire_nom) > 200
     or btrim(v.signataire_qualite, E' \t\n\r') = '' or length(v.signataire_qualite) > 200 then
    raise exception 'Le nom et la qualité du signataire tiennent en 200 caractères chacun.' using errcode = '22023';
  end if;
  if v.dossier_client_id is not null
     and not exists (select 1 from public.dossiers c join public.dossiers k on k.id = p_dossier_id
                      where c.id = v.dossier_client_id and c.cabinet_id = k.cabinet_id and c.id <> k.id) then
    raise exception 'Le client est un dossier de ce cabinet, autre que le dossier du cabinet.' using errcode = '22023';
  end if;
  if v.modele_id is not null
     and not exists (select 1 from public.modeles_lettre_de_mission m where m.id = v.modele_id and m.dossier_id = p_dossier_id) then
    raise exception 'Ce modèle n''est pas un modèle de ce dossier.' using errcode = '22023';
  end if;

  if p_lettre_id is null then
    if v.remplace_id is not null then
      select * into v_cible from public.lettres_de_mission l
       where l.id = v.remplace_id and l.dossier_id = p_dossier_id and l.proposee_le is not null;
      if not found then
        raise exception 'La lettre à remplacer n''est pas une lettre proposée de ce dossier.' using errcode = '22023';
      end if;
      if v_cible.dossier_client_id is null or v.dossier_client_id is distinct from v_cible.dossier_client_id then
        raise exception 'Une nouvelle version garde le client de la lettre qu''elle remplace.' using errcode = '22023';
      end if;
      if exists (select 1 from public.lettres_de_mission s
                  where s.remplace_id = v.remplace_id and s.refusee_le is null and s.retiree_le is null) then
        raise exception 'Cette lettre a déjà une nouvelle version en cours : la reprendre, ou la retirer d''abord.' using errcode = '22023';
      end if;
    end if;
    insert into public.lettres_de_mission (
      dossier_id, dossier_client_id, modele_id, remplace_id, missions, repartition, honoraires, date_effet, premier_exercice,
      fin_initiale, reconduction_tacite, preavis_mois, signataire_nom, signataire_qualite, signataire_compte, modifiee_le, auteur
    ) values (
      p_dossier_id, v.dossier_client_id, v.modele_id, v.remplace_id, v.missions, v.repartition, v.honoraires, v.date_effet,
      v.premier_exercice, v.fin_initiale, v.reconduction_tacite, v.preavis_mois, v.signataire_nom, v.signataire_qualite,
      v.signataire_compte, clock_timestamp(), auth.uid()
    )
    returning * into v_actuelle;
    return v_actuelle;
  end if;

  select * into v_actuelle from public.lettres_de_mission l where l.id = p_lettre_id and l.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Lettre introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_actuelle.proposee_le is not null then
    raise exception 'Cette lettre est proposée : elle ne se modifie plus, une nouvelle version la remplace.' using errcode = '22023';
  end if;
  if v_actuelle.retiree_le is not null then
    raise exception 'Cette lettre est retirée.' using errcode = '22023';
  end if;
  if p_modifiee_le is distinct from v_actuelle.modifiee_le then
    raise exception 'La lettre a changé depuis sa lecture : relire avant de l''enregistrer.' using errcode = '22023';
  end if;
  v_remplace := case when p_contenu ? 'remplace_id' then v.remplace_id else v_actuelle.remplace_id end;
  if v_remplace is distinct from v_actuelle.remplace_id then
    raise exception 'Une lettre garde la lettre qu''elle remplace : en remplacer une autre est une nouvelle lettre.' using errcode = '22023';
  end if;
  if v_actuelle.remplace_id is not null
     and v.dossier_client_id is distinct from (select l.dossier_client_id from public.lettres_de_mission l where l.id = v_actuelle.remplace_id) then
    raise exception 'Une nouvelle version garde le client de la lettre qu''elle remplace.' using errcode = '22023';
  end if;
  update public.lettres_de_mission
     set dossier_client_id = v.dossier_client_id, modele_id = v.modele_id, missions = v.missions, repartition = v.repartition,
         honoraires = v.honoraires, date_effet = v.date_effet, premier_exercice = v.premier_exercice,
         fin_initiale = v.fin_initiale, reconduction_tacite = v.reconduction_tacite, preavis_mois = v.preavis_mois,
         signataire_nom = v.signataire_nom, signataire_qualite = v.signataire_qualite, signataire_compte = v.signataire_compte,
         modifiee_le = clock_timestamp()
   where id = p_lettre_id
  returning * into v_actuelle;
  return v_actuelle;
end
$$;

-- ══ 8. La proposition : la lettre fige, la base calcule son empreinte ══════════
-- Les refus, dans cet ordre : l'accès (42501) ; le dossier du cabinet (23514) ; la lettre introuvable (P0002) ; déjà
-- proposée ; retirée ; lue à une autre version ; sans client ; un client hors du cabinet ; sans adresse ; sans modèle ;
-- un modèle remplacé ou retiré ; sans mission ; une mission que le modèle ne décrit pas ; une clause exigée dont le
-- modèle n'a pas le texte ; sans répartition ; sans honoraires ; le temps passé ; la durée incomplète ; sans signataire ;
-- un compte signataire qui n'est pas un accès du dossier du client ; l'identité du cabinet incomplète (22023).
create function public.proposer_lettre_de_mission(p_dossier_id uuid, p_lettre_id uuid, p_modifiee_le timestamptz)
returns public.lettres_de_mission
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.lettres_de_mission;
  v_client public.dossiers;
  v_cabinet public.dossiers;
  v_modele public.modeles_lettre_de_mission;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if not public.est_dossier_du_cabinet(p_dossier_id) then
    raise exception 'Les lettres de mission se rédigent dans le dossier du cabinet.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.lettres_de_mission:' || p_dossier_id::text, 0));
  select * into v from public.lettres_de_mission l where l.id = p_lettre_id and l.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Lettre introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v.proposee_le is not null then
    raise exception 'Cette lettre est déjà proposée.' using errcode = '22023';
  end if;
  if v.retiree_le is not null then
    raise exception 'Cette lettre est retirée.' using errcode = '22023';
  end if;
  if p_modifiee_le is distinct from v.modifiee_le then
    raise exception 'La lettre a changé depuis sa lecture : relire avant de la proposer.' using errcode = '22023';
  end if;
  if v.dossier_client_id is null then
    raise exception 'La lettre désigne le dossier de son client.' using errcode = '22023';
  end if;
  select k.* into v_cabinet from public.dossiers k where k.id = p_dossier_id;
  select c.* into v_client from public.dossiers c
   where c.id = v.dossier_client_id and c.cabinet_id = v_cabinet.cabinet_id and c.id <> v_cabinet.id;
  if not found then
    raise exception 'Le client est un dossier de ce cabinet, autre que le dossier du cabinet.' using errcode = '22023';
  end if;
  if v_client.adresse is null or btrim(v_client.adresse, E' \t\n\r') = '' then
    raise exception 'L''adresse du client manque à son dossier : la renseigner avant de proposer la lettre.' using errcode = '22023';
  end if;
  if v.modele_id is null then
    raise exception 'La lettre suit un modèle du cabinet.' using errcode = '22023';
  end if;
  select * into v_modele from public.modeles_lettre_de_mission m where m.id = v.modele_id;
  if v_modele.retire_le is not null
     or exists (select 1 from public.modeles_lettre_de_mission s where s.remplace_id = v.modele_id) then
    raise exception 'Le modèle de la lettre a été remplacé ou retiré : choisir sa version courante.' using errcode = '22023';
  end if;
  if cardinality(v.missions) = 0 then
    raise exception 'La lettre définit au moins une mission.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v.missions) m where not v_modele.missions ? m) then
    raise exception 'Une mission de la lettre n''est pas décrite par son modèle.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(public.clauses_requises(v.missions)) c where not v_modele.clauses ? c) then
    raise exception 'Le modèle ne porte pas le texte d''une clause que les missions de la lettre exigent.' using errcode = '22023';
  end if;
  if jsonb_array_length(v.repartition) = 0 then
    raise exception 'La lettre répartit les tâches entre le cabinet et le client.' using errcode = '22023';
  end if;
  if jsonb_array_length(v.honoraires) = 0 then
    raise exception 'La lettre fixe ses honoraires.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v.honoraires) e where e ->> 'forme' = 'temps') then
    raise exception 'Le temps passé ne se facture pas encore : un forfait périodique ou un prix par tâche.' using errcode = '22023';
  end if;
  if v.date_effet is null or v.premier_exercice is null or v.fin_initiale is null then
    raise exception 'La lettre dit sa date d''effet, son premier exercice et la fin de sa première période.' using errcode = '22023';
  end if;
  if v.signataire_nom is null then
    raise exception 'La lettre désigne son signataire.' using errcode = '22023';
  end if;
  if v.signataire_compte is not null
     and not exists (select 1 from public.memberships m where m.dossier_id = v.dossier_client_id and m.user_id = v.signataire_compte) then
    raise exception 'Le compte du signataire n''est pas un accès du dossier du client.' using errcode = '22023';
  end if;
  if v_cabinet.siret is null or btrim(v_cabinet.siret, E' \t\n\r') = ''
     or v_cabinet.adresse is null or btrim(v_cabinet.adresse, E' \t\n\r') = '' then
    raise exception 'L''identité du dossier du cabinet manque : son SIRET et son adresse, avant de proposer la lettre.' using errcode = '22023';
  end if;

  v.identite_client := jsonb_build_object('nom', v_client.nom, 'denomination', v_client.denomination_imprimee,
    'forme_juridique', v_client.forme_juridique, 'siret', v_client.siret, 'adresse', v_client.adresse);
  v.identite_cabinet := jsonb_build_object('cabinet', (select c.nom from public.cabinets c where c.id = v_cabinet.cabinet_id),
    'denomination', v_cabinet.denomination_imprimee, 'forme_juridique', v_cabinet.forme_juridique,
    'siret', v_cabinet.siret, 'adresse', v_cabinet.adresse);
  v.clauses := public.clauses_requises(v.missions);
  v.proposee_le := now();
  v.proposee_par := auth.uid();
  v.empreinte := public.empreinte_de_la_lettre(v);
  update public.lettres_de_mission
     set identite_client = v.identite_client, identite_cabinet = v.identite_cabinet, clauses = v.clauses,
         proposee_le = v.proposee_le, proposee_par = v.proposee_par, empreinte = v.empreinte
   where id = p_lettre_id
  returning * into v;
  return v;
end
$$;

-- ══ 9. La réponse, enregistrée par le cabinet : le papier signé, ou le refus ══════════
-- Les refus, dans cet ordre : l'accès (42501) ; le dossier du cabinet (23514) ; une réponse ni « acceptee_sur_papier » ni
-- « refusee » ; la lettre introuvable (P0002) ; pas proposée ; retirée ; déjà répondue ; une nouvelle version en cours ;
-- puis, pour le papier : un document qui n'est pas du dossier du cabinet, sans empreinte, une date de signature avant
-- la proposition ou après aujourd'hui (à Paris) ; pour le refus : un papier ou une date cités (22023).
create function public.enregistrer_reponse_a_la_lettre(
  p_dossier_id uuid, p_lettre_id uuid, p_reponse text, p_document_id uuid, p_signee_le date
)
returns public.lettres_de_mission
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.lettres_de_mission;
  v_empreinte text;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if not public.est_dossier_du_cabinet(p_dossier_id) then
    raise exception 'Les lettres de mission se rédigent dans le dossier du cabinet.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.lettres_de_mission:' || p_dossier_id::text, 0));
  if p_reponse is null or p_reponse not in ('acceptee_sur_papier', 'refusee') then
    raise exception 'La réponse est une acceptation sur papier signé, ou un refus.' using errcode = '22023';
  end if;
  select * into v from public.lettres_de_mission l where l.id = p_lettre_id and l.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Lettre introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v.proposee_le is null then
    raise exception 'Cette lettre n''est pas proposée : un brouillon ne s''accepte ni ne se refuse.' using errcode = '22023';
  end if;
  if v.retiree_le is not null then
    raise exception 'Cette lettre est retirée.' using errcode = '22023';
  end if;
  if v.acceptee_le is not null or v.refusee_le is not null then
    raise exception 'Cette lettre a déjà sa réponse.' using errcode = '22023';
  end if;
  if exists (select 1 from public.lettres_de_mission s
              where s.remplace_id = p_lettre_id and s.refusee_le is null and s.retiree_le is null) then
    raise exception 'Cette lettre a une nouvelle version en cours : c''est elle qui reçoit la réponse.' using errcode = '22023';
  end if;
  if p_reponse = 'acceptee_sur_papier' then
    select d.storage_hash into v_empreinte from public.documents_divers d
     where d.id = p_document_id and d.dossier_id = p_dossier_id for share;
    if not found then
      raise exception 'Le papier signé est un document du dossier du cabinet.' using errcode = '22023';
    end if;
    if v_empreinte is null or v_empreinte !~ '^[0-9a-f]{64}$' then
      raise exception 'Le papier signé se cite par son empreinte : le déposer de nouveau.' using errcode = '22023';
    end if;
    if p_signee_le is null or p_signee_le < (v.proposee_le at time zone 'Europe/Paris')::date
       or p_signee_le > (now() at time zone 'Europe/Paris')::date then
      raise exception 'La date de signature suit la proposition et ne dépasse pas aujourd''hui.' using errcode = '22023';
    end if;
    update public.lettres_de_mission
       set acceptee_le = now(), acceptee_par = auth.uid(), mode_acceptation = 'papier', empreinte_acceptee = v.empreinte,
           document_signe_id = p_document_id, empreinte_papier = v_empreinte, signee_le = p_signee_le
     where id = p_lettre_id
    returning * into v;
    return v;
  end if;
  if p_document_id is not null or p_signee_le is not null then
    raise exception 'Un refus ne cite ni papier signé ni date de signature.' using errcode = '22023';
  end if;
  update public.lettres_de_mission set refusee_le = now(), refusee_par = auth.uid()
   where id = p_lettre_id
  returning * into v;
  return v;
end
$$;

-- ══ 10. Le retrait : un brouillon ou une proposition, sans date ; une lettre acceptée, à la date où elle prend fin ══════
-- Les refus, dans cet ordre : l'accès (42501) ; le dossier du cabinet (23514) ; la lettre introuvable (P0002) ; déjà
-- retirée ; refusée ; une nouvelle version en cours ; une lettre acceptée sans fin ou finie avant sa date d'effet ; une
-- fin donnée à une lettre qui n'est pas acceptée (22023).
create function public.retirer_lettre_de_mission(p_dossier_id uuid, p_lettre_id uuid, p_fin_au date)
returns public.lettres_de_mission
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.lettres_de_mission;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if not public.est_dossier_du_cabinet(p_dossier_id) then
    raise exception 'Les lettres de mission se rédigent dans le dossier du cabinet.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.lettres_de_mission:' || p_dossier_id::text, 0));
  select * into v from public.lettres_de_mission l where l.id = p_lettre_id and l.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Lettre introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v.retiree_le is not null then
    raise exception 'Cette lettre est déjà retirée.' using errcode = '22023';
  end if;
  if v.refusee_le is not null then
    raise exception 'Cette lettre est refusée : elle a pris fin, rien ne se retire.' using errcode = '22023';
  end if;
  if exists (select 1 from public.lettres_de_mission s
              where s.remplace_id = p_lettre_id and s.refusee_le is null and s.retiree_le is null) then
    raise exception 'Cette lettre a une nouvelle version en cours : la retirer d''abord.' using errcode = '22023';
  end if;
  if v.acceptee_le is not null and (p_fin_au is null or p_fin_au < v.date_effet or p_fin_au > date '2100-12-31') then
    raise exception 'Une lettre acceptée se résilie à une date, au plus tôt sa date d''effet.' using errcode = '22023';
  end if;
  if v.acceptee_le is null and p_fin_au is not null then
    raise exception 'Seule une lettre acceptée se résilie à une date : un brouillon ou une proposition se retire sans date.'
      using errcode = '22023';
  end if;
  update public.lettres_de_mission set retiree_le = now(), retiree_par = auth.uid(), fin_au = p_fin_au
   where id = p_lettre_id
  returning * into v;
  return v;
end
$$;

-- ══ 11. Les droits d'exécution ══════════
-- Les six fonctions qui écrivent vérifient l'accès elles-mêmes ; le catalogue, les contrôles et le drapeau sont purs,
-- exécutables par `authenticated` (un contrôle de table s'exécute aux droits de qui écrit) ; l'empreinte et les gardes ne
-- servent qu'à la base : aucun rôle de session ne les exécute.
revoke execute on function public.enregistrer_modele_de_lettre(uuid, text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.enregistrer_modele_de_lettre(uuid, text, text, jsonb, jsonb, uuid) to authenticated;
revoke execute on function public.retirer_modele_de_lettre(uuid, uuid) from public, anon;
grant execute on function public.retirer_modele_de_lettre(uuid, uuid) to authenticated;
revoke execute on function public.enregistrer_brouillon_de_lettre(uuid, uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.enregistrer_brouillon_de_lettre(uuid, uuid, jsonb, timestamptz) to authenticated;
revoke execute on function public.proposer_lettre_de_mission(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.proposer_lettre_de_mission(uuid, uuid, timestamptz) to authenticated;
revoke execute on function public.enregistrer_reponse_a_la_lettre(uuid, uuid, text, uuid, date) from public, anon;
grant execute on function public.enregistrer_reponse_a_la_lettre(uuid, uuid, text, uuid, date) to authenticated;
revoke execute on function public.retirer_lettre_de_mission(uuid, uuid, date) from public, anon;
grant execute on function public.retirer_lettre_de_mission(uuid, uuid, date) to authenticated;
revoke execute on function public.missions_de_lettre() from public, anon;
grant execute on function public.missions_de_lettre() to authenticated;
revoke execute on function public.clauses_de_lettre() from public, anon;
grant execute on function public.clauses_de_lettre() to authenticated;
revoke execute on function public.clauses_requises(text[]) from public, anon;
grant execute on function public.clauses_requises(text[]) to authenticated;
revoke execute on function public.lettre_missions_valides(text[]) from public, anon;
grant execute on function public.lettre_missions_valides(text[]) to authenticated;
revoke execute on function public.modele_missions_valides(jsonb) from public, anon;
grant execute on function public.modele_missions_valides(jsonb) to authenticated;
revoke execute on function public.modele_clauses_valides(jsonb) from public, anon;
grant execute on function public.modele_clauses_valides(jsonb) to authenticated;
revoke execute on function public.repartition_valide(jsonb) from public, anon;
grant execute on function public.repartition_valide(jsonb) to authenticated;
revoke execute on function public.honoraires_valides(jsonb) from public, anon;
grant execute on function public.honoraires_valides(jsonb) to authenticated;
revoke execute on function public.acceptation_en_ligne_ouverte() from public, anon;
grant execute on function public.acceptation_en_ligne_ouverte() to authenticated;
revoke execute on function public.empreinte_de_la_lettre(public.lettres_de_mission) from public, anon, authenticated;
revoke execute on function public.garder_modele_de_lettre() from public, anon, authenticated;
revoke execute on function public.garder_lettre_de_mission() from public, anon, authenticated;
revoke execute on function public.garder_designation_des_lettres() from public, anon, authenticated;
