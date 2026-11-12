-- LM6 : LES LETTRES DE MISSION DANS L'ESPACE CLIENT (ligne 47) — PRÉPARÉE, PAS APPLIQUÉE. À appliquer APRÈS
-- `dossier_du_cabinet` (LM1), `trois_cases_de_l_acces` (B1) et `lettres_de_mission` (LM4), que sa garde de tête exige,
-- colonne par colonne. Elle ne porte aucun mot de suppression : l'outil devrait la prendre. Son retour, en 20261112100100,
-- retire la fonction (À COLLER).
--
-- La conception : HISTORIQUE.md, « 10/11/2026 — LA LETTRE DE MISSION ET LES HONORAIRES DU CABINET : LA CONCEPTION
-- (LIGNE 47) », point 3 et lot LM6 (« l'espace client (lire, accepter) ») ; l'acceptation en ligne RESTE FERMÉE (LM-Q10,
-- « le demander à l'expert » : `acceptation_en_ligne_ouverte()` rend faux, et rien ici ne l'écrit) ; le récit :
-- HISTORIQUE.md, « 12/11/2026 — LM6 : LES LETTRES DE MISSION DANS L'ESPACE CLIENT (LIGNE 47) ».
--
-- CE QU'ELLE OUVRE : une lecture `lettres_de_mission_du_client(dossier)`, `security definer`, chemin fixé, `stable`, aux
-- connectés seuls. L'accès d'abord, sur le dossier ANNONCÉ, avant toute lecture : un accès CLIENT de ce dossier qui porte
-- la case « Documents » (B1, `client_du_dossier(dossier, 'documents')`) — la case des documents que le cabinet partage, où
-- la conception range les honoraires (« Mes honoraires » sous « Documents ») ; sinon « Accès refusé à ce dossier. »
-- (42501), un dossier inconnu compris. Le cabinet n'y passe pas : il lit ses lettres dans son propre dossier (LM4).
--
-- CE QU'ELLE REND : UNE valeur jsonb (PostgREST plafonne les lignes, pas une valeur) — `dossier_du_cabinet_designe`, et les
-- lettres PROPOSÉES de ce client (jamais un brouillon : le client ne lit que ce qui lui a été proposé, figé), prises dans le
-- dossier que SON cabinet a désigné, dans l'ordre de leur proposition. De chacune, ce que la lettre FIGE et que le client
-- signe — ses missions, la répartition des tâches, SES honoraires (le contrat est le sien ; LM-Q2 ne règle que ce que
-- l'équipe du cabinet en voit), sa durée, son signataire, les copies d'identité, les clauses et le texte du modèle —, son
-- histoire (proposée, acceptée et comment, signée sur papier le, refusée, retirée ou résiliée à sa date), l'empreinte que
-- la base a calculée à la proposition, et deux booléens : `empreinte_verifiee` (la base RECALCULE l'empreinte du contenu
-- tel qu'il est aujourd'hui, `empreinte_de_la_lettre`, et la compare à celle de la proposition : l'écran ne tire le PDF
-- que d'une lettre qui y répond, comme il ne montre un logo que vérifié à son empreinte) et `signataire_designe` (le compte
-- qui lit est-il celui que la lettre désigne pour signer). RIEN d'autre : ni le dossier du cabinet, ni le compte du
-- signataire, ni les auteurs (qui a écrit, proposé, enregistré la réponse ou retiré), ni le document du papier signé ni son
-- empreinte (un fichier du dossier du cabinet), ni une autre lettre, ni un autre client.
--
-- ÉCARTÉS : une policy sur `lettres_de_mission` (la RLS ne masque pas une colonne : elle ouvrirait les auteurs, le dossier du
-- cabinet, le document signé, et les brouillons sauf à les filtrer) ; une vue aux droits de son propriétaire (une relation
-- de plus, paginée sans le dire) ; le contenu haché rendu tel quel pour que l'écran recalcule l'empreinte (il porte le
-- dossier du cabinet, l'auteur de la proposition et le compte du signataire, et sa forme textuelle est celle de jsonb, que
-- le navigateur ne reproduit pas à l'octet) ; la case « membre » (un accès qui dépose des pièces lirait les honoraires que
-- la société paie à son cabinet).
--
-- SOURCES : décret n° 2012-432 du 30 mars 2012, art. 151 (le contrat écrit, les droits et obligations de chaque partie), relu
-- sur Légifrance le 11/11/2026 (LM4) ; C. civ., art. 1366 et 1367 (l'écrit et la signature électroniques), pour ce que
-- l'acceptation en ligne demandera quand LM-Q10 sera tranchée.

do $garde$
begin
  if to_regprocedure('public.lettres_de_mission_du_client(uuid)') is not null then
    raise exception 'Les lettres de mission du client sont déjà en base : cette migration ne se rejoue pas.';
  end if;
  if to_regclass('public.lettres_de_mission') is null or to_regclass('public.modeles_lettre_de_mission') is null
     or to_regprocedure('public.empreinte_de_la_lettre(public.lettres_de_mission)') is null
     or (select count(*) from pg_attribute a
          where a.attrelid = to_regclass('public.cabinets') and a.attname = 'dossier_du_cabinet' and not a.attisdropped) <> 1 then
    raise exception 'Les lettres de mission (LM4, lettres_de_mission) et le dossier du cabinet (LM1, dossier_du_cabinet) précèdent cette migration : les coller d''abord.';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = 'public.memberships'::regclass and a.attname = 'droit_documents' and not a.attisdropped) <> 1
     or to_regprocedure('public.client_du_dossier(uuid, text)') is null
     or position('when ''documents'' then m.droit_documents'
                 in (select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.client_du_dossier(uuid, text)'))) = 0 then
    raise exception 'La case « Documents » (B1, trois_cases_de_l_acces) précède cette migration : la coller d''abord.';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.lettres_de_mission') and a.attnum > 0 and not a.attisdropped
         and a.attname in ('id', 'dossier_id', 'dossier_client_id', 'modele_id', 'remplace_id', 'missions', 'repartition',
                           'honoraires', 'date_effet', 'premier_exercice', 'fin_initiale', 'reconduction_tacite',
                           'preavis_mois', 'signataire_nom', 'signataire_qualite', 'signataire_compte', 'identite_client',
                           'identite_cabinet', 'clauses', 'empreinte', 'proposee_le', 'acceptee_le', 'mode_acceptation',
                           'signee_le', 'refusee_le', 'retiree_le', 'fin_au')) <> 27
     or (select count(*) from pg_attribute a
          where a.attrelid = to_regclass('public.modeles_lettre_de_mission') and a.attnum > 0 and not a.attisdropped
            and a.attname in ('id', 'titre', 'conditions_generales', 'missions', 'clauses')) <> 5 then
    raise exception 'Les colonnes des lettres de mission ne sont plus celles que cette migration suppose : la relire contre la base avant de l''appliquer.';
  end if;
end
$garde$;

create function public.lettres_de_mission_du_client(p_dossier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dossier_du_cabinet uuid;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ, avant toute lecture : un accès client de ce dossier qui porte la case
  --    « Documents ». Un dossier inconnu n'a aucun accès : il se refuse de même, sans rien dire de son existence.
  if not public.client_du_dossier(p_dossier_id, 'documents') then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2. Le dossier que son cabinet a désigné, où LM4 range les lettres ; aucun, aucune lettre.
  select c.dossier_du_cabinet into v_dossier_du_cabinet
    from public.dossiers d
    left join public.cabinets c on c.id = d.cabinet_id
   where d.id = p_dossier_id;
  -- 3. Les lettres PROPOSÉES de ce client, par leurs valeurs figées et leur histoire, et elles seules.
  return jsonb_build_object(
    'dossier_du_cabinet_designe', v_dossier_du_cabinet is not null,
    'lettres', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id,
               'remplace_id', l.remplace_id,
               'missions', to_jsonb(l.missions),
               'repartition', l.repartition,
               'honoraires', l.honoraires,
               'date_effet', l.date_effet,
               'premier_exercice', l.premier_exercice,
               'fin_initiale', l.fin_initiale,
               'reconduction_tacite', l.reconduction_tacite,
               'preavis_mois', l.preavis_mois,
               'signataire_nom', l.signataire_nom,
               'signataire_qualite', l.signataire_qualite,
               'signataire_designe', coalesce(l.signataire_compte = auth.uid(), false),
               'identite_client', l.identite_client,
               'identite_cabinet', l.identite_cabinet,
               'clauses', to_jsonb(l.clauses),
               'modele', (select jsonb_build_object('id', m.id, 'titre', m.titre, 'conditions_generales', m.conditions_generales,
                                                    'missions', m.missions, 'clauses', m.clauses)
                            from public.modeles_lettre_de_mission m where m.id = l.modele_id),
               'proposee_le', l.proposee_le,
               'empreinte', l.empreinte,
               'empreinte_verifiee', coalesce(public.empreinte_de_la_lettre(l) = l.empreinte, false),
               'acceptee_le', l.acceptee_le,
               'mode_acceptation', l.mode_acceptation,
               'signee_le', l.signee_le,
               'refusee_le', l.refusee_le,
               'retiree_le', l.retiree_le,
               'fin_au', l.fin_au)
             order by l.proposee_le, l.id)
        from public.lettres_de_mission l
       where l.dossier_id = v_dossier_du_cabinet
         and l.dossier_client_id = p_dossier_id
         and l.proposee_le is not null), '[]'::jsonb));
end
$$;

revoke execute on function public.lettres_de_mission_du_client(uuid) from public, anon;
grant execute on function public.lettres_de_mission_du_client(uuid) to authenticated;

comment on function public.lettres_de_mission_du_client(uuid) is
  'Les lettres de mission PROPOSÉES d''un client, telles qu''elles se sont figées (LM6, ligne 47) : missions, répartition, honoraires, durée, signataire, identités, clauses, modèle, histoire, empreinte vérifiée ; jamais un brouillon, un auteur, le dossier du cabinet ni le papier signé. À un accès client de ce dossier qui porte la case « Documents » (B1) ; tout autre est refusé (42501).';
