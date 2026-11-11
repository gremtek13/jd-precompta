-- LES FACTURES REPRISES, AU CLIENT (ligne 51.5 ; A8C-Q1 et A8Q5-Q2, tranchées par le cabinet le 11/11/2026). PRÉPARÉE le
-- 11/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « A8C-Q1 ET A8Q5-Q2 : LES FACTURES REPRISES, AU CLIENT (PRÉPARÉE,
-- PAS APPLIQUÉE) ». Son essai : supabase/essais/reprisesAuClient.sql ; son retour : supabase/preparees/retour/
-- 20261111151100_retour_reprises_au_client.sql. Les deux valeurs qu'elle rend, src/lib/reprisesAuClient.ts les lit derrière
-- `REPRISES_AU_CLIENT_PREVUES` (baissé), confrontées à ce texte.
--
-- Elle ouvre au client deux LECTURES qu'il n'a pas : elle se présente au cabinet avant d'être appliquée (CLAUDE.md, « une
-- policy qui lui ouvre une lecture se présente au cabinet »). Elle ne crée ni ne change aucune table, colonne, contrainte,
-- policy, aucun droit d'une table, aucune fonction existante ; elle n'écrit aucune ligne. Deux fonctions de lecture neuves,
-- `security definer`, leur chemin fixé, exécutables par les connectés seuls ; l'accès se juge AVANT toute lecture, par les
-- prédicats que `droits_sur_le_dossier` rend sous ses clés « ventes » et « banque ».
--
-- 1. A8C-Q1 (contre la recommandation) : le client qui porte la case « Ventes » enregistre lui-même l'encaissement d'une
--    facture reprise de l'ancien logiciel. `enregistrer_encaissement` l'admet déjà (`gere_les_ventes`, A8b) ; mais ses
--    plafonds se jugent sur le REGISTRE des reprises — `factures_importees`, que le cabinet du dossier lit seul — : l'écran
--    du client ne pouvait pas les dire avant le clic. `reprise_de_la_facture(dossier, facture)` lui rend, d'une facture
--    reprise de SON dossier, les seuls chiffres que ces plafonds lisent, calculés comme `enregistrer_encaissement` les
--    calcule, et rien d'autre du registre (ni le lot, ni le rang, ni la ligne du fichier, ni son fichier, ni sa
--    transmission, ni l'avoir repris lui-même) :
--      - `reprise_le` : la date de reprise des factures du dossier (AAAA-MM-JJ, ou nulle), avant laquelle un encaissement
--        ne se date pas ;
--      - `nature_operation` : celle de la facture (« mixte » ne reçoit pas encore d'encaissement, A8B-Q1) ;
--      - `encaisse_avant_reprise_centimes` et `encaisse_par_taux` (chaque taux et ce qui y était encaissé, en centimes, du
--        plus fort au plus faible) : ce qui en était encaissé avant la reprise, au total puis à chaque taux ;
--      - `credite_par_les_repris_centimes` et `credite_par_les_repris_par_taux` : ce que ses avoirs REPRIS créditent — au
--        total, leur en-tête (`-montant_ttc`), et à chaque taux, la règle de TVA de leurs montants
--        (`montants_par_taux_du_document`) —, sommés : jamais leur nombre, leur numéro ni leur date.
--    Ce que le client lit déjà (la facture, ses lignes, ses avoirs de l'application, ses encaissements), elle ne le redit
--    pas. Le cabinet du dossier l'appelle aussi : la fenêtre des encaissements est la même dans les deux espaces.
--    QUI : le cabinet du dossier, ou un accès client qui porte « Ventes » (`gere_les_ventes`, ce qu'exige
--    `enregistrer_encaissement`) ; tout autre appelant, « Banque » seul compris, reçoit « Accès refusé à ce dossier. »
--    (42501) ; puis ce qui n'est pas une facture reprise de ce dossier (une facture de l'application, un avoir repris, une
--    facture d'un autre dossier, un identifiant inconnu) : « Facture reprise introuvable dans ce dossier. » (P0002).
--
-- 2. A8Q5-Q2 (à la recommandation) : « Ma simulation » d'un client « Banque » reçoit les identifiants des pièces qui sont
--    l'original d'une facture reprise (`pieces_des_factures_reprises`, lien actif), et rien d'autre — ni la facture, ni un
--    montant, ni un nom —, pour ne pas compter deux fois la même vente : en trésorerie, une telle pièce ne compte que ses
--    paiements (A8c4), le registre de sa facture reprise compte le reste. Comme elle reçoit déjà ceux des factures sources
--    (VF8e). `pieces_citees_de_la_simulation(dossier)` rend un tableau d'identifiants, dans leur ordre. Une fonction À PART,
--    et non une troisième clé de `ventes_facturees_de_la_simulation` : l'application en ligne juge que cette valeur a deux
--    clés, et elles seules — une troisième lui ferait dire ses ventes illisibles jusqu'à son redéploiement. Les liens ne
--    dépendent pas de l'année, ni la règle du cumul des liens.
--    QUI : le cabinet du dossier, ou un accès client qui porte « Banque » (`gere_la_banque`), sur un dossier qui existe —
--    le prédicat et les mots de `ventes_facturees_de_la_simulation`.
--
-- Une seule VALEUR jsonb chacune, jamais un ensemble de lignes : PostgREST plafonne les lignes qu'il rend sans le dire, pas
-- une valeur. Toutes deux `stable` : elles n'écrivent rien.
--
-- LES SOURCES (publiques) : CGI, art. 269, 2-c (la TVA des services, exigible à l'encaissement) ; BOI-TVA-DECLA-20-30-60
-- (le statut « Encaissée ») ; CGI, art. 93, 1 (les recettes encaissées d'un titulaire de bénéfices non commerciaux).
--
-- ELLE S'APPLIQUE APRÈS A8a, A8b et A8-Q5 (en production depuis le 10/11/2026) : sa garde de tête les exige. Ni la
-- suppression d'une ligne, ni le retrait d'un objet : l'outil devrait la prendre.

-- ══ 0. GARDE DE TÊTE : la base est celle que cette migration suppose ══════════

do $garde$
begin
  if to_regprocedure('public.reprise_de_la_facture(uuid, uuid)') is not null
     or to_regprocedure('public.pieces_citees_de_la_simulation(uuid)') is not null then
    raise exception 'Les factures reprises sont déjà ouvertes au client : cette migration ne se rejoue pas.';
  end if;
  -- A8a : le registre des reprises et la date de reprise d'un dossier.
  if to_regclass('public.factures_importees') is null
     or (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'factures_importees'
            and column_name in ('facture_id', 'dossier_id', 'encaisse_avant_reprise', 'encaisse_par_taux', 'origine_id')) <> 5
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'dossiers' and column_name = 'reprise_des_factures_le') then
    raise exception 'Les factures reprises (A8a, factures_importees) ne sont pas en base : elles précèdent cette migration.';
  end if;
  -- A8-Q5 : les liens d'une facture reprise à la pièce qui en est l'original.
  if to_regclass('public.pieces_des_factures_reprises') is null
     or (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'pieces_des_factures_reprises'
            and column_name in ('dossier_id', 'piece_id', 'retire_le')) <> 3 then
    raise exception 'La pièce d''une facture reprise (A8-Q5, piece_d_une_facture_reprise) n''est pas en base : elle précède cette migration.';
  end if;
  -- A8b : la règle de TVA d'un document repris, et les plafonds qu'`enregistrer_encaissement` juge, à l'empreinte de leur
  -- corps (fins de ligne ramenées : une migration collée peut les porter en CRLF) — `reprise_de_la_facture` les redit.
  -- Puis les deux prédicats d'accès, tels que `droits_des_acces_clients` les a posés.
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13) || chr(10), chr(10))), ',' order by p.proname collate "C")
        from pg_proc p
       where p.oid in (to_regprocedure('public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb)'),
                       to_regprocedure('public.gere_la_banque(uuid)'),
                       to_regprocedure('public.gere_les_ventes(uuid)'),
                       to_regprocedure('public.montants_par_taux_du_document(uuid)')))
     is distinct from 'enregistrer_encaissement=9f3fae7dc1c804157a706c3f5847702a,'
                   || 'gere_la_banque=003c9545ca28e812ec7485f329082d47,'
                   || 'gere_les_ventes=8e4d3bf3945fee96681f1e4ace9ba64b,'
                   || 'montants_par_taux_du_document=d3600dafbf0416316cacbd363f54ffe8' then
    raise exception 'enregistrer_encaissement, montants_par_taux_du_document, gere_les_ventes ou gere_la_banque n''est plus celle que cette migration suppose (A8b, droits_des_acces_clients) : la relire contre la base avant de l''appliquer.';
  end if;
end
$garde$;

-- ══ 1. CE QUE L'ENCAISSEMENT D'UNE FACTURE REPRISE DEMANDE (A8C-Q1) ══════════

create function public.reprise_de_la_facture(p_dossier_id uuid, p_facture_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reprise date;
  v_nature text;
  v_avant numeric;
  v_par_taux jsonb;
  v_avant_par_taux jsonb;
  v_credite numeric;
  v_credite_par_taux jsonb;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ, avant toute lecture : le cabinet du dossier, ou un accès client qui porte « Ventes »
  --    — la clé « ventes » de `droits_sur_le_dossier`, ce qu'exige `enregistrer_encaissement`.
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2. Une facture reprise de ce dossier, et elle seule : son registre la nomme (la garde d'`importer_factures` les pose
  --    ensemble ; une ligne de l'un sans l'autre n'en est pas une).
  select f.nature_operation, fi.encaisse_avant_reprise, fi.encaisse_par_taux
    into v_nature, v_avant, v_par_taux
    from public.factures_emises f
    join public.factures_importees fi on fi.facture_id = f.id and fi.dossier_id = f.dossier_id
   where f.id = p_facture_id and f.dossier_id = p_dossier_id and f.statut = 'importee' and f.type = 'facture';
  if not found then
    raise exception 'Facture reprise introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  select d.reprise_des_factures_le into v_reprise from public.dossiers d where d.id = p_dossier_id;
  -- 3. Ce qui en était encaissé avant la reprise, à chaque taux : `encaisse_par_taux`, lu comme `enregistrer_encaissement`
  --    le lit (l'encaissé d'un taux, en centimes), un taux répété sommé.
  select coalesce(jsonb_agg(jsonb_build_object('taux', t.taux, 'encaisse_centimes', t.centimes) order by t.taux desc), '[]'::jsonb)
    into v_avant_par_taux
    from (select (g.valeur ->> 'taux')::numeric as taux, sum(((g.valeur ->> 'encaisse')::numeric * 100)::bigint) as centimes
            from jsonb_array_elements(v_par_taux) g(valeur)
           group by (g.valeur ->> 'taux')::numeric) t;
  -- 4. Ce que ses avoirs REPRIS créditent (ceux qui la citent dans le registre, à l'état « importee ») : au total, leur
  --    en-tête ; à chaque taux, la règle de TVA de leurs montants — les deux sommes d'`enregistrer_encaissement`.
  select coalesce(sum(-a.montant_ttc), 0) into v_credite
    from public.factures_importees ai
    join public.factures_emises a on a.id = ai.facture_id
   where ai.origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'importee';
  select coalesce(jsonb_agg(jsonb_build_object('taux', t.taux, 'ttc_centimes', t.centimes) order by t.taux desc), '[]'::jsonb)
    into v_credite_par_taux
    from (select m.taux, sum(m.ttc_centimes)::bigint as centimes
            from public.factures_importees ai
            join public.factures_emises a on a.id = ai.facture_id
            cross join lateral public.montants_par_taux_du_document(a.id) m
           where ai.origine_id = p_facture_id and a.type = 'avoir' and a.statut = 'importee'
           group by m.taux) t;
  return jsonb_build_object(
    'reprise_le', to_char(v_reprise, 'YYYY-MM-DD'),
    'nature_operation', v_nature,
    'encaisse_avant_reprise_centimes', (v_avant * 100)::bigint,
    'encaisse_par_taux', v_avant_par_taux,
    'credite_par_les_repris_centimes', (v_credite * 100)::bigint,
    'credite_par_les_repris_par_taux', v_credite_par_taux);
end
$$;

revoke execute on function public.reprise_de_la_facture(uuid, uuid) from public, anon;
grant execute on function public.reprise_de_la_facture(uuid, uuid) to authenticated;

comment on function public.reprise_de_la_facture(uuid, uuid) is
  'Ce que l''encaissement d''une facture reprise de l''ancien logiciel demande pour se juger avant le clic (A8C-Q1) : la date de reprise du dossier, la nature de la facture, ce qui en était encaissé avant la reprise (au total et par taux) et ce que ses avoirs repris créditent (au total et par taux), en centimes — les chiffres des plafonds d''enregistrer_encaissement, rien d''autre du registre. Au cabinet du dossier et à un accès client qui porte « Ventes ».';

-- ══ 2. LES PIÈCES QUI SONT L'ORIGINAL D'UNE FACTURE REPRISE, POUR « MA SIMULATION » (A8Q5-Q2) ══════════

create function public.pieces_citees_de_la_simulation(p_dossier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- L'accès, sur le dossier ANNONCÉ, avant toute lecture : le cabinet du dossier, ou un accès client qui porte « Banque »
  -- (la clé « banque » de `droits_sur_le_dossier`), sur un dossier qui existe — comme `ventes_facturees_de_la_simulation`.
  if not public.gere_la_banque(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- Les pièces citées par un lien ACTIF (`retire_le` nul), et leurs seuls identifiants.
  return coalesce((select jsonb_agg(r.piece_id order by r.piece_id)
                     from public.pieces_des_factures_reprises r
                    where r.dossier_id = p_dossier_id and r.retire_le is null), '[]'::jsonb);
end
$$;

revoke execute on function public.pieces_citees_de_la_simulation(uuid) from public, anon;
grant execute on function public.pieces_citees_de_la_simulation(uuid) to authenticated;

comment on function public.pieces_citees_de_la_simulation(uuid) is
  'Les pièces d''un dossier qui sont l''original d''une facture reprise (lien actif de pieces_des_factures_reprises), leurs seuls identifiants, pour « Ma simulation » (A8Q5-Q2) : en trésorerie, une telle pièce ne compte que ses paiements. Au cabinet du dossier et à un accès client qui porte « Banque ».';
