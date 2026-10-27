-- « MA SIMULATION » REÇOIT SES VENTES FACTURÉES (chantier EC-Q3, ligne 28.65, étape VF8e ; VF8-Q2). Le récit :
-- HISTORIQUE.md, « « MA SIMULATION » REÇOIT SES VENTES FACTURÉES » ; la conception : « VF8, LA BASCULE : LA
-- CONCEPTION », § 3 (e), § 4 et § 8. Présentée au cabinet avant d'être appliquée : elle OUVRE à l'accès client qui
-- porte la case « Banque » une lecture qu'il n'a pas (CLAUDE.md, « une policy qui lui ouvre une lecture se présente au
-- cabinet »).
--
-- LA DÉCISION DU CABINET (26/10/2026, VF8-Q2, à la recommandation) : « Ma simulation » d'un client « Banque » reçoit,
-- d'un dossier BASCULÉ, le total par mois de ses ventes facturées ET la liste des factures qui comptent elles-mêmes
-- leur vente — des identifiants, rien de leur contenu. EC3-Q11 avait fixé le total mensuel seul ; la liste lui permet
-- de ne pas compter deux fois une vente dont il a aussi déposé le PDF : la pièce désignée comme l'exemplaire d'une
-- facture source porte cette facture (`pieces.facture_id`, que sa session lit déjà avec ses pièces), et ne compte plus.
--
-- CE QU'ELLE POSE : une fonction de LECTURE, `ventes_facturees_de_la_simulation(dossier, année)`, et rien d'autre —
-- aucune table, colonne, contrainte, policy ni aucun droit d'une table ; aucune donnée écrite. Une seule valeur, un
-- objet à deux clés, et non un ensemble de lignes : PostgREST plafonne les lignes qu'il rend sans le dire, pas une
-- valeur.
--   - `par_mois` : pour chaque mois de l'année qui porte un événement, « AAAA-MM » → le total hors taxe en centimes —
--     la règle de `recettesFactureesParMois` (src/lib/ventesFacturees.ts), tirée de `calcul_vente_facturee` (la règle
--     du cumul de l'étape VF4b, que ses essais confrontent au module) : dans le modèle comptable du DOSSIER, en
--     trésorerie les parts de ses encaissements comptés, à leur date (le hors-taxe de chaque part, la TVA au cumul) ;
--     en engagement la facture et ses avoirs sources validés, à leur date d'émission (EC3-Q12). Une facture que la
--     règle écarte n'y compte pas. Un mois dont les événements s'annulent a son entrée, à zéro ; un mois sans événement
--     n'en a pas ;
--   - `sources` : les identifiants des factures et avoirs VALIDÉS SOURCES du dossier, de toute année, écartés compris —
--     c'est l'ensemble `sources` du module, ce qui suffit à ignorer leur exemplaire.
-- Rien d'autre : ni numéro, ni client, ni date, ni montant par facture. Un dossier qui n'a pas basculé : rien — les
-- deux clés, vides ; aucune de ses factures n'est source (la garde du réglage refuse de le baisser après la première).
-- src/lib/simulationVentesFacturees.ts lit cette valeur, sous la forme « comptées » de `RecettesFacturees`.
--
-- QUI : le cabinet du dossier (`admin_du_dossier` : le chef du cabinet, un membre affecté au dossier, le
-- super-administrateur) et un accès client du dossier qui porte la case « Banque » — `gere_la_banque`, le prédicat de
-- la banque du client —, sur un dossier qui existe. Tout autre appelant — un accès sans la case, « Ventes » seul
-- compris, l'accès d'un autre dossier, un membre du cabinet hors de ses dossiers, un compte rattaché à rien — reçoit
-- « Accès refusé à ce dossier. » (42501), comme aux fonctions voisines, sans apprendre si le dossier existe ; l'anonyme
-- ne l'exécute pas. L'accès se juge AVANT toute lecture ; puis l'année (« Exercice invalide. », 22023, hors de 2000 à
-- 2100, comme la validation et la révision).
--
-- LE TEMPS. La règle du cumul se refait pour chaque facture source qui a un événement dans l'année — en trésorerie, un
-- encaissement compté daté de l'année ; en engagement, la facture ou l'un de ses avoirs sources émis dans l'année —, et
-- pour elle seule : écarter les autres ne change aucun total (elles n'ont aucune part ni aucun document dans l'année).
-- Mesuré sur la réplique sous le rôle `authenticated` et ses huit secondes : HISTORIQUE.md.
--
-- NEUTRE EN PRODUCTION (relevé le 26/10/2026, des comptes) : aucun dossier basculé, aucune facture source, aucun accès
-- qui porte « Banque » ; aucun écran ne l'appelle tant que `SIMULATION_VENTES_FACTUREES_EXPORTEE`
-- (src/lib/simulationVentesFacturees.ts) est faux.
--
-- CE QUI CONTOURNE LA RLS : la fonction est `security definer` — elle lit, aux droits de son propriétaire, les factures
-- du dossier, leurs lignes, leurs encaissements et leurs parts, que l'accès « Banque » sans « Ventes » ne lit pas —
-- après avoir vérifié l'accès, et ne rend que les deux clés ci-dessus. C'est la lecture neuve que VF8-Q2 ouvre.
-- `search_path` fixé ; exécution retirée à PUBLIC et à l'anonyme, accordée aux connectés, comme aux autres lectures du
-- client.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni
-- instruction qui en retire. Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose : la règle du cumul et le prédicat de la banque que ses essais ont éprouvés ══════════

do $$
declare
  v record;
begin
  for v in select x.fonction, x.empreinte, x.migration from (values
      ('public.calcul_vente_facturee(uuid)', 'd2f0312ec96293f24302d20f2d8da159', 'ecritures_de_la_vente_facturee'),
      ('public.gere_la_banque(uuid)', '003c9545ca28e812ec7485f329082d47', 'droits_des_acces_clients')
    ) x(fonction, empreinte, migration) loop
    -- Le corps sur lequel cette fonction s'appuie, au caractère près (les retours chariot d'un collage écartés) : une
    -- règle ou un prédicat changés depuis ne se lisent pas ainsi sans être relus.
    if to_regprocedure(v.fonction) is null
       or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), '')) <> v.empreinte then
      raise exception 'La fonction % en base n''est plus celle de la migration % : la simulation ne s''y appuie pas sans être relue.',
        v.fonction, v.migration;
    end if;
  end loop;
  if to_regprocedure('public.ventes_facturees_de_la_simulation(uuid, integer)') is not null then
    raise exception 'La fonction public.ventes_facturees_de_la_simulation(uuid, integer) existe déjà : la migration simulation_des_ventes_facturees ne se rejoue pas.';
  end if;
end
$$;

-- ══ 1. Les ventes facturées de la simulation ══════════
create function public.ventes_facturees_de_la_simulation(p_dossier_id uuid, p_annee integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bascule boolean;
  v_mode text;
  v_debut date;
  v_fin date;
  v_par_mois jsonb;
  v_sources jsonb;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : le cabinet du dossier, ou un accès client qui porte la case « Banque » ; un
  --    dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.gere_la_banque(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2. L'année.
  if p_annee is null or p_annee < 2000 or p_annee > 2100 then
    raise exception 'Exercice invalide.' using errcode = '22023';
  end if;
  select d.ventes_par_les_factures, d.mode_comptable into v_bascule, v_mode
    from public.dossiers d where d.id = p_dossier_id;
  -- Un dossier qui n'a pas basculé : rien.
  if not v_bascule then
    return jsonb_build_object('par_mois', '{}'::jsonb, 'sources', '[]'::jsonb);
  end if;
  v_debut := make_date(p_annee, 1, 1);
  v_fin := make_date(p_annee, 12, 31);
  with factures as materialized (
    -- Les factures sources qui ont un événement dans l'année, et elles seules : en trésorerie, un encaissement compté
    -- (non retiré) daté de l'année ; en engagement, la facture, ou l'un de ses avoirs sources validés, émis dans
    -- l'année. La règle du cumul ne se refait que pour elles.
    select f.id
      from public.factures_emises f
     where f.dossier_id = p_dossier_id and f.type = 'facture' and f.statut = 'validee' and f.source_de_la_vente
       and case when v_mode = 'engagement'
                then f.date_emission between v_debut and v_fin
                     or exists (select 1 from public.factures_emises a
                                 where a.dossier_id = p_dossier_id and a.facture_origine_id = f.id and a.type = 'avoir'
                                   and a.statut = 'validee' and a.source_de_la_vente
                                   and a.date_emission between v_debut and v_fin)
                else exists (select 1 from public.encaissements_factures e
                              where e.dossier_id = p_dossier_id and e.facture_id = f.id and e.retire_le is null
                                and e.date_encaissement between v_debut and v_fin)
           end
  ),
  evenements as (
    -- Ce que la règle du cumul en rend dans l'année : les parts (trésorerie) ou les documents (engagement), leur
    -- hors-taxe. Une facture écartée ne rend que sa ligne « ecartee » : rien n'en est compté.
    select to_char(c.date_effet, 'YYYY-MM') as mois, c.base_centimes
      from factures f
     cross join lateral public.calcul_vente_facturee(f.id) c
     where c.genre = case when v_mode = 'engagement' then 'document' else 'part' end
       and c.date_effet between v_debut and v_fin
  )
  select coalesce(jsonb_object_agg(m.mois, m.centimes), '{}'::jsonb) into v_par_mois
    from (select e.mois, sum(e.base_centimes)::bigint as centimes from evenements e group by e.mois) m;
  -- Les factures et avoirs sources, de toute année : leur exemplaire ne compte jamais.
  select coalesce(jsonb_agg(f.id order by f.id), '[]'::jsonb) into v_sources
    from public.factures_emises f
   where f.dossier_id = p_dossier_id and f.statut = 'validee' and f.source_de_la_vente;
  return jsonb_build_object('par_mois', v_par_mois, 'sources', v_sources);
end
$$;

revoke execute on function public.ventes_facturees_de_la_simulation(uuid, integer) from public, anon;
grant execute on function public.ventes_facturees_de_la_simulation(uuid, integer) to authenticated;

comment on function public.ventes_facturees_de_la_simulation(uuid, integer) is
  'Les ventes facturées que « Ma simulation » compte (chantier EC-Q3, VF8e ; VF8-Q2) : pour un dossier basculé, le total hors taxe de chaque mois de l''année — dans le modèle comptable du dossier, les parts de ses encaissements (trésorerie) ou la facture et ses avoirs (engagement), par la règle du cumul (calcul_vente_facturee) — et les identifiants de ses factures et avoirs sources ; rien d''autre. Non basculé : les deux clés, vides. Réservée au cabinet du dossier et aux accès qui portent la case « Banque » (42501).';
