-- A8Q5Q3Q2Q2-Q1 — LE CLIENT NE RÈGLE JAMAIS EN ESPÈCES L'ORIGINAL D'UNE FACTURE REPRISE (ligne 51.5 ; décision du cabinet du
-- 16/11/2026, « (C) Refuser au client tout paiement en espèces de l'original d'une facture reprise, par un refus neutre : le
-- cabinet l'enregistre », à la recommandation). PRÉPARÉE le 16/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 16/11/2026
-- — A8Q5-Q4, A8Q5Q3Q2-Q3 ET A8Q5Q3Q2Q2-Q1 : TROIS MIGRATIONS PRÉPARÉES APRÈS LA GARDE DES RÈGLEMENTS » ; l'essai :
-- supabase/essais/especesDuClientHorsDesReprises.sql (EN ATTENTE sans elle) ; le retour :
-- supabase/preparees/retour/20261116142100_retour_especes_du_client_hors_des_reprises.sql ; le module qui redit le refus et lit
-- la liste : src/lib/especesDuClientHorsDesReprises.ts (`ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES`, baissé jusqu'à
-- l'application), et « Mes pièces » (src/pages/ClientUpload.tsx, src/pages/PaiementParMaCaisse.tsx), qui le dit avant le clic.
--
-- ELLE OUVRE AU CLIENT UNE LECTURE QU'IL N'A PAS (la liste ci-dessous, 2) : elle se présente au cabinet avant d'être appliquée
-- (CLAUDE.md, « une policy qui lui ouvre une lecture se présente au cabinet »).
--
-- SOURCES. A8Q5Q3Q2-Q2 (la garde des règlements, différée, et la relecture adverse du 15/11/2026 : le client « Caisse », sans
-- « Ventes », qui paie en espèces l'original d'une facture reprise apprenait, en essayant des montants, ce qui reste à
-- encaisser au registre qu'il ne lit pas) ; A8-Q5 (la pièce citée ; sa garde des règlements nomme la pièce et la facture) ;
-- A8Q5-Q2 (`pieces_citees_de_la_simulation` : les seuls identifiants des pièces citées, déjà ouverts au client « Banque »).
-- PostgreSQL 17, « CREATE TRIGGER » (des déclencheurs BEFORE d'un même évènement tirent dans l'ordre alphabétique de leur nom).
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. `garder_especes_du_client_hors_des_reprises` et son déclencheur `operations_caisse_hors_des_reprises` (BEFORE INSERT) :
--      le paiement d'une pièce que les fonctions de la caisse écrivent pour un ACCÈS CLIENT (`origine` « client », sous le
--      réglage de cette opération : `regler_piece_par_la_caisse`, et `remplacer_paiement_par_la_caisse` qui la rappelle) se
--      refuse quand la pièce est l'original d'une facture reprise (le lien actif), par un refus NEUTRE : « Le paiement en
--      espèces de cette pièce ne se saisit pas depuis ton espace : ton cabinet l'enregistre. » (42501) — ni montant, ni nom
--      de fichier, ni numéro de facture, ni l'existence d'encaissements ; tout montant, toute date, sa correction comprise.
--      Il tire après la garde de la table (`operations_caisse_gardes`) et AVANT celle des règlements d'une pièce reprise
--      (`operations_caisse_piece_d_une_facture_reprise`, qui nomme la pièce et la facture) ; la garde différée des
--      règlements (A8Q5Q3Q2-Q2) ne voit plus jamais un paiement du client sur cette pièce. Le cabinet garde le geste : son
--      paiement se juge comme hier. Une insertion directe — la restauration, que la garde de la table réserve au
--      super-administrateur — n'est pas un geste du client : elle passe comme hier.
--   2. `pieces_hors_de_la_caisse_du_client(dossier)`, une lecture `security definer`, `stable` : les identifiants des pièces
--      du dossier qui sont l'original d'une facture reprise (lien actif), et rien d'autre — ni la facture, ni un montant, ni
--      un nom —, ce que le refus dirait de chacune après le clic. « Mes pièces » la lit pour le dire AVANT le clic : sur ces
--      pièces, ni le paiement ni sa correction ne s'offrent. QUI : le cabinet du dossier, ou un accès client qui porte
--      « Caisse », sur un dossier qui existe ; tout autre appelant reçoit « Accès refusé à ce dossier. » (42501), avant toute
--      lecture. Une seule VALEUR jsonb, jamais un ensemble de lignes : PostgREST plafonne les lignes, pas une valeur.
--
-- CE QU'ELLE NE CHANGE PAS : aucune table, aucune colonne, aucune donnée, aucune policy, aucune fonction d'hier. Le retrait
-- par le client d'un paiement qu'il a saisi avant la citation passe comme hier : il ne fait que baisser ce que la pièce a
-- reçu. Un paiement du client saisi avant la citation reste ce qu'il est.
--
-- COMMENT ELLE S'APPLIQUE : aucune instruction de retrait ni de vidage, aucune barre oblique inverse, aucune fonction
-- remplacée — PAR L'OUTIL. Après A8-Q5 (en production), que sa garde de tête exige ; indépendante de
-- `piece_d_un_paiement_dans_son_dossier` et de `plancher_a_l_ecart_d_alignement`. Le jour de son application,
-- `ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES` se lève et le fichier entre dans supabase/schema/ sous la version que porte
-- sa ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regprocedure('public.garder_especes_du_client_hors_des_reprises()') is not null
     or to_regprocedure('public.pieces_hors_de_la_caisse_du_client(uuid)') is not null
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgname = 'operations_caisse_hors_des_reprises' and not t.tgisinternal) then
    raise exception 'A8Q5Q3Q2Q2-Q1 : les espèces du client hors des factures reprises sont déjà en base : cette migration ne se rejoue pas.';
  end if;
  if to_regclass('public.pieces_des_factures_reprises') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null
     or to_regprocedure('public.client_du_dossier(uuid, text)') is null
     or (select count(*) from information_schema.columns
          where table_schema = 'public'
            and (table_name, column_name) in (('operations_caisse', 'origine'), ('operations_caisse', 'genre'),
                                              ('operations_caisse', 'piece_id'), ('pieces_des_factures_reprises', 'piece_id'),
                                              ('pieces_des_factures_reprises', 'dossier_id'),
                                              ('pieces_des_factures_reprises', 'retire_le'))) <> 6 then
    raise exception 'A8Q5Q3Q2Q2-Q1 : la pièce d''une facture reprise (A8-Q5), un prédicat d''accès ou une colonne que la garde lit manquent.';
  end if;
  -- Les deux gardes entre lesquelles la neuve tire : celle de la table, celle des règlements d'une pièce reprise ; et la porte.
  if (select count(*) from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.operations_caisse'::regclass and not t.tgisinternal
         and t.tgname in ('_acces_avant_les_gardes', 'operations_caisse_gardes', 'operations_caisse_piece_d_une_facture_reprise')) <> 3 then
    raise exception 'A8Q5Q3Q2Q2-Q1 : la porte d''accès, la garde de la caisse ou celle des règlements d''une pièce reprise manque sur operations_caisse.';
  end if;
end
$garde$;

-- ══ 1. La garde : le client ne règle pas en espèces l'original d'une facture reprise ══════════
create function public.garder_especes_du_client_hors_des_reprises() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Le paiement d'une pièce pour un accès client (la clause WHEN), écrit par les fonctions de la caisse — sous le réglage de
  -- CETTE opération, que la garde de la table exige d'elles. Une insertion directe (la restauration) n'est pas un geste du
  -- client : la garde de la table la juge.
  if coalesce(current_setting('jd.caisse', true), '') is distinct from new.id::text then
    return new;
  end if;
  -- La pièce, verrouillée en partage par la fonction qui paie (`regler_piece_par_la_caisse`, `remplacer_paiement_par_la_caisse`)
  -- : une citation qui se pose en même temps attend ce paiement, ou ce paiement la voit.
  if exists (select 1 from public.pieces_des_factures_reprises r where r.piece_id = new.piece_id and r.retire_le is null) then
    raise exception 'Le paiement en espèces de cette pièce ne se saisit pas depuis ton espace : ton cabinet l''enregistre.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

comment on function public.garder_especes_du_client_hors_des_reprises() is
  'A8Q5Q3Q2Q2-Q1 : le paiement d''une pièce par la caisse que les fonctions de la caisse écrivent pour un accès client (origine « client ») se refuse quand la pièce est l''original d''une facture reprise (lien actif), par un refus neutre — ni montant, ni nom, ni facture, ni registre (42501). Tire après la garde de la table et avant celle des règlements d''une pièce reprise ; le paiement du cabinet et la restauration passent comme hier.';

revoke all on function public.garder_especes_du_client_hors_des_reprises() from public, anon, authenticated, service_role;

create trigger operations_caisse_hors_des_reprises
  before insert on public.operations_caisse
  for each row when (new.origine = 'client' and new.genre = 'paiement' and new.piece_id is not null)
  execute function public.garder_especes_du_client_hors_des_reprises();

-- ══ 2. La liste : les pièces que la caisse du client ne règle pas ══════════
create function public.pieces_hors_de_la_caisse_du_client(p_dossier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- L'accès, sur le dossier ANNONCÉ, avant toute lecture : le cabinet du dossier, ou un accès client qui porte « Caisse », sur
  -- un dossier qui existe.
  if p_dossier_id is null
     or not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'caisse'))
     or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- Les pièces citées par un lien ACTIF, et leurs seuls identifiants, dans leur ordre.
  return coalesce((select jsonb_agg(r.piece_id order by r.piece_id)
                     from public.pieces_des_factures_reprises r
                    where r.dossier_id = p_dossier_id and r.retire_le is null), '[]'::jsonb);
end
$$;

revoke execute on function public.pieces_hors_de_la_caisse_du_client(uuid) from public, anon;
grant execute on function public.pieces_hors_de_la_caisse_du_client(uuid) to authenticated;

comment on function public.pieces_hors_de_la_caisse_du_client(uuid) is
  'Les pièces d''un dossier que la caisse du client ne règle pas — l''original d''une facture reprise (lien actif de pieces_des_factures_reprises) —, leurs seuls identifiants, pour que « Mes pièces » le dise avant le clic (A8Q5Q3Q2Q2-Q1). Au cabinet du dossier et à un accès client qui porte « Caisse » ; tout autre appelant : 42501.';

-- ══ 3. La garde de fin : les deux corps, leurs droits, le déclencheur et son rang ══════════
do $fin$
begin
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.garder_especes_du_client_hors_des_reprises()'),
                       to_regprocedure('public.pieces_hors_de_la_caisse_du_client(uuid)')))
     is distinct from 'garder_especes_du_client_hors_des_reprises=28b47ef3dc1ab29a5f6dd69068a2e670,'
                   || 'pieces_hors_de_la_caisse_du_client=7ab7b405c40dfca1b5a5c7c7d4bd7e11' then
    raise exception 'A8Q5Q3Q2Q2-Q1 : un corps n''est pas celui de cette migration : rien n''est appliqué.';
  end if;
  if (select not p.prosecdef or p.proconfig is distinct from array['search_path=public'] from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_especes_du_client_hors_des_reprises()'))
     or (select not p.prosecdef or p.provolatile <> 's' or p.proconfig is distinct from array['search_path=public']
           from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.pieces_hors_de_la_caisse_du_client(uuid)'))
     or has_function_privilege('anon', 'public.garder_especes_du_client_hors_des_reprises()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_especes_du_client_hors_des_reprises()', 'execute')
     or has_function_privilege('service_role', 'public.garder_especes_du_client_hors_des_reprises()', 'execute')
     or has_function_privilege('anon', 'public.pieces_hors_de_la_caisse_du_client(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.pieces_hors_de_la_caisse_du_client(uuid)', 'execute') then
    raise exception 'A8Q5Q3Q2Q2-Q1 : les propriétés ou les droits d''exécution ne sont pas ceux que cette migration attend : rien n''est appliqué.';
  end if;
  if (select pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text from pg_catalog.pg_trigger t
       where t.tgname = 'operations_caisse_hors_des_reprises' and not t.tgisinternal)
     is distinct from 'CREATE TRIGGER operations_caisse_hors_des_reprises BEFORE INSERT ON public.operations_caisse FOR EACH ROW WHEN (((new.origine = ''client''::text) AND (new.genre = ''paiement''::text) AND (new.piece_id IS NOT NULL))) EXECUTE FUNCTION garder_especes_du_client_hors_des_reprises() O' then
    raise exception 'A8Q5Q3Q2Q2-Q1 : le déclencheur n''est pas celui de cette migration : rien n''est appliqué.';
  end if;
  -- Son rang : après la garde de la table, avant celle des règlements d'une pièce reprise (octet par octet).
  if not ('operations_caisse_gardes' collate "C" < 'operations_caisse_hors_des_reprises' collate "C"
          and 'operations_caisse_hors_des_reprises' collate "C" < 'operations_caisse_piece_d_une_facture_reprise' collate "C")
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.operations_caisse'::regclass and not t.tgisinternal and (t.tgtype & 2) = 2
                   and t.tgname collate "C" > 'operations_caisse_gardes' collate "C"
                   and t.tgname collate "C" < 'operations_caisse_hors_des_reprises' collate "C") then
    raise exception 'A8Q5Q3Q2Q2-Q1 : une garde BEFORE tire entre celle de la table et celle-ci : rien n''est appliqué.';
  end if;
end
$fin$;
