-- LM5-Q2 : LES MISSIONS D'UN CLIENT, SANS SES HONORAIRES (ligne 47, le cabinet et ses clients). PRÉPARÉE le
-- 11/11/2026, PAS APPLIQUÉE. Elle s'applique APRÈS `dossier_du_cabinet` (LM1) et `lettres_de_mission` (LM4) : sa garde de
-- tête les exige. Le récit : HISTORIQUE.md, « LM5-Q2 : LES MISSIONS D'UN CLIENT SANS SES HONORAIRES, EN BASE (LIGNE 47)
-- (PRÉPARÉE, PAS APPLIQUÉE) ». Son essai : supabase/essais/missionsDuClient.sql (réplique) ; puis rls.sql (le bloc MV).
-- Son retour : supabase/preparees/retour/20261111236100_retour_missions_du_client.sql. La valeur qu'elle rend,
-- src/lib/missionsDuClient.ts la lit derrière `MISSIONS_DU_CLIENT_PREVUES` (baissé), confrontée à ce texte.
--
-- CE QUI MANQUAIT. Les lettres de mission vivent dans le dossier du CABINET (LM4, LM-Q4), et leur policy de lecture est
-- `admin_du_dossier(dossier_id)` sur ce dossier : son chef et les membres qui lui sont assignés voient les honoraires
-- (LM-Q2). Un collaborateur qui suit un client — assigné au dossier de ce client, pas au dossier du cabinet — n'en lit
-- AUCUNE ligne, sans erreur : la carte « Missions confiées au cabinet » de l'onglet Informations du client le lui dit
-- (« pas ouvert »), sans pouvoir lui dire ce que la lettre confie au cabinet.
--
-- CE QU'ELLE FAIT (LM5-Q2, recommandation (A) ; LM5Q2-Q1, réponse (B)). Une fonction de lecture,
-- `missions_du_client(dossier)`, `security definer`, son chemin fixé, `stable` (elle n'écrit rien), exécutable par les
-- connectés seuls. Elle rend, pour le dossier d'un client, TOUTES ses lettres de mission, brouillons compris, chacune par
-- les douze valeurs que la carte lisait déjà
-- (`COLONNES_SANS_MONTANT`, src/lib/lettresDeMissionVue.ts) et elles seules :
--   - la lettre : son identifiant (sa référence), la lettre qu'elle remplace (sa version, dans la chaîne des versions),
--     le dossier du client ;
--   - ce qu'elle confie au cabinet : ses missions (le catalogue fermé de LM4) ;
--   - ses dates : d'effet, de fin de la première période, la reconduction tacite, la proposition, l'acceptation, le
--     refus, le retrait et la fin d'une lettre résiliée — d'où l'écran DÉDUIT son état et les lettres en vigueur
--     (src/lib/lettresDeMission.ts) ; l'état n'est pas stocké, il ne se rend donc pas.
-- JAMAIS : les honoraires (un montant, une périodicité, un livrable, un taux horaire), la répartition des tâches, les
-- copies d'identité, les clauses, le modèle, le signataire, le papier signé et son empreinte, les auteurs, ni l'empreinte
-- de la lettre (calculée sur tout son contenu, honoraires compris). Une seule VALEUR jsonb, jamais un ensemble de lignes
-- (PostgREST plafonne les lignes qu'il rend sans le dire, pas une valeur) :
--   { "dossier_du_cabinet_designe": vrai ou faux, "lettres": [ { les douze clés }, … ] }
-- `dossier_du_cabinet_designe` dit si le cabinet a désigné son dossier (sans lui, aucune lettre ne se rédige) : l'écran
-- ne confond pas « pas de dossier du cabinet » et « aucune lettre en vigueur ».
--
-- QUI : qui lit le dossier du CLIENT au titre du cabinet, `admin_du_dossier(dossier)` — son chef, un membre de l'équipe
-- qui lui est assigné, le super-administrateur. Jugé AVANT toute lecture, sur le dossier ANNONCÉ ; tout autre appelant —
-- un accès client, même « Ventes » ou « Banque », un membre que ce dossier n'a pas, un compte rattaché à rien — reçoit
-- « Accès refusé à ce dossier. » (42501), comme pour un dossier qui n'existe pas. L'anonyme ne l'exécute pas.
--
-- QUELLES LETTRES : celles du dossier que le cabinet du client a désigné (LM4 n'en écrit nulle part ailleurs, et ce
-- dossier ne change plus de désignation dès qu'il en porte une, `garder_designation_des_lettres`), qui nomment ce client,
-- BROUILLONS COMPRIS (LM5Q2-Q1, réponse (B) du cabinet du 11/11/2026, contre la recommandation (A), qui les taisait) : un
-- brouillon, que le cabinet réécrit tant qu'il ne l'a pas proposé, se rend par les mêmes douze valeurs — ses missions et
-- ses dates telles qu'elles sont à cette heure, jamais ses honoraires —, et l'écran le dit « brouillon » (sa proposition
-- est nulle). Les lettres proposées d'abord, dans l'ordre de leur proposition, puis les brouillons, dans l'ordre de leur
-- création.
--
-- POURQUOI UNE FONCTION. La RLS ne masque pas une colonne : une seconde policy de lecture sur `lettres_de_mission`, ouverte
-- aux membres du dossier du client, leur ouvrirait aussi les honoraires. Écartés : (B) une vue aux droits de son
-- propriétaire — une relation de plus dans l'API, que PostgREST pagine et plafonne sans le dire, et que l'advisor
-- `security_definer_view` signalerait ; (C) des droits par colonne retirés à `authenticated` — l'écran du dossier du
-- cabinet lit la lettre entière (`select('*')`), et ses honoraires lui sont dus (LM-Q2).
--
-- SOURCES (publiques). Décret n° 2012-432 du 30 mars 2012, art. 151 (la lettre de mission définit la mission confiée,
-- les droits et obligations de chaque partie) et art. 158 (les honoraires, fixés librement entre le client et l'expert-
-- comptable), relus sur Légifrance le 11/11/2026 pour LM4 ; RGPD, art. 5, 1, c (la minimisation : ne rendre que ce
-- qu'exige la finalité — ici, dire ce que la lettre confie au cabinet) et art. 25, 2 (par défaut, seules les données
-- nécessaires) ; le choix de qui voit les honoraires est celui du cabinet (LM-Q2).
--
-- Elle ne crée ni ne change aucune table, colonne, contrainte, policy, aucun droit d'une table ; elle n'écrit aucune
-- ligne, et ne remplace aucune fonction. Rien ne s'y retire : l'outil devrait la prendre.

-- ══ 0. GARDE DE TÊTE : la base est celle que cette migration suppose ══════════

do $garde$
begin
  if to_regprocedure('public.missions_du_client(uuid)') is not null then
    raise exception 'Les missions d''un client sont déjà en base : cette migration ne se rejoue pas.';
  end if;
  if to_regclass('public.lettres_de_mission') is null or to_regprocedure('public.est_dossier_du_cabinet(uuid)') is null then
    raise exception 'Les lettres de mission (LM4, lettres_de_mission) et le dossier du cabinet (LM1, dossier_du_cabinet) précèdent cette migration : les coller d''abord.';
  end if;
  if to_regprocedure('public.admin_du_dossier(uuid)') is null
     or (select count(*) from pg_attribute a
          where a.attrelid = to_regclass('public.lettres_de_mission') and a.attnum > 0
            and a.attname in ('id', 'dossier_id', 'remplace_id', 'dossier_client_id', 'missions', 'date_effet', 'fin_initiale',
                              'reconduction_tacite', 'proposee_le', 'acceptee_le', 'refusee_le', 'retiree_le', 'fin_au',
                              'cree_le')) <> 14
     or (select count(*) from pg_attribute a
          where a.attrelid = to_regclass('public.cabinets') and a.attname = 'dossier_du_cabinet') <> 1 then
    raise exception 'Les colonnes des lettres de mission ou la désignation du dossier du cabinet ne sont plus celles que cette migration suppose : la relire contre la base avant de l''appliquer.';
  end if;
end
$garde$;

-- ══ 1. LES MISSIONS D'UN CLIENT, SANS SES HONORAIRES ══════════

create function public.missions_du_client(p_dossier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dossier_du_cabinet uuid;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ, avant toute lecture : qui lit le dossier du client au titre du cabinet (son chef,
  --    un membre qui lui est assigné, le super-administrateur). Un accès client n'y passe jamais.
  if not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2. Le dossier existe (le super-administrateur passe le prédicat sur tout identifiant), et le dossier que son cabinet
  --    a désigné, où LM4 range les lettres.
  select c.dossier_du_cabinet into v_dossier_du_cabinet
    from public.dossiers d
    left join public.cabinets c on c.id = d.cabinet_id
   where d.id = p_dossier_id;
  if not found then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 3. Les lettres de ce client, brouillons compris (LM5Q2-Q1 (B)), chacune par ses douze valeurs et elles seules : ni
  --    honoraires, ni répartition, ni identités, ni clauses, ni modèle, ni signataire, ni papier signé, ni empreinte, ni
  --    auteurs. Les proposées d'abord, par leur proposition ; puis les brouillons, par leur création.
  return jsonb_build_object(
    'dossier_du_cabinet_designe', v_dossier_du_cabinet is not null,
    'lettres', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id,
               'remplace_id', l.remplace_id,
               'dossier_client_id', l.dossier_client_id,
               'missions', to_jsonb(l.missions),
               'date_effet', l.date_effet,
               'fin_initiale', l.fin_initiale,
               'reconduction_tacite', l.reconduction_tacite,
               'proposee_le', l.proposee_le,
               'acceptee_le', l.acceptee_le,
               'refusee_le', l.refusee_le,
               'retiree_le', l.retiree_le,
               'fin_au', l.fin_au)
             order by l.proposee_le nulls last, l.cree_le, l.id)
        from public.lettres_de_mission l
       where l.dossier_id = v_dossier_du_cabinet
         and l.dossier_client_id = p_dossier_id), '[]'::jsonb));
end
$$;

revoke execute on function public.missions_du_client(uuid) from public, anon;
grant execute on function public.missions_du_client(uuid) to authenticated;

comment on function public.missions_du_client(uuid) is
  'Les lettres de mission d''un client, brouillons compris (LM5-Q2, LM5Q2-Q1, ligne 47) : leur référence, leur version, leurs missions et leurs dates, jamais leurs honoraires ni aucun autre contenu ; avec la désignation du dossier du cabinet. À qui lit le dossier du client au titre du cabinet (admin_du_dossier) ; un accès client est refusé.';
