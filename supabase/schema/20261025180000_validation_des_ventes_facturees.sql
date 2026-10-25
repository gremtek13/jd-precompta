-- LA VALIDATION D'UN EXERCICE REFUSE LES MANQUES DE G5 (chantier EC-Q3, ligne 28.65, étapes VF7b0 et VF7b ; VF7B-Q1, à
-- la recommandation). Le récit : HISTORIQUE.md, « LA VALIDATION REFUSE LES MANQUES DES VENTES FACTURÉES » ; la
-- conception : « VF7, LA VALIDATION FIGE LA SOURCE : LA CONCEPTION », § 2, § 3 (c) et (g), § 5, § 7 et § 8.
--
-- CE QUE LA BASE FAISAIT. `valider_exercice` ne nommait aucune vente facturée : un mouvement réservé à des encaissements
-- de factures retenait la validation sous les mots génériques « des mouvements bancaires à traiter » ; rien ne vérifiait
-- qu'une source de vente facturée avait ses écritures, ni qu'elles étaient à jour (R3 de VF4b), ni qu'un virement avait
-- son mouvement. La validation d'un exercice dont les ventes facturées n'ont AUCUNE écriture passait.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE — pour un dossier BASCULÉ seulement (`ventes_par_les_factures`) :
--   1. `ecritures_attendues_de_la_periode`, NEUVE (exécutée par aucun rôle de l'API) : la recomposition D'UN BLOC (VF7b0).
--      Recomposée source par source, la vérification coûtait de 5 s (la règle du cumul une fois par facture) à 25 s (refaite
--      pour chaque source) pour un exercice de 3 000 encaissements, le plafond d'une requête de l'application étant de 8 s
--      (VF7B-Q1) ; d'un bloc, 0,3 à 0,4 s, ce que la validation ajoute (VF7B-Q2 : le seuil d'une seconde). Elle redit, pour
--      toutes les sources d'une période ensemble, la règle du cumul (`calcul_vente_facturee` : les parts, la TVA au cumul
--      arrondie le demi loin de zéro, les contre-passations, les documents, les exigibilités) et la composition
--      (`ecriture_attendue_vente_facturee`), sous la même forme, source par source : son motif, son détail, ses lignes. Ni
--      l'une ni l'autre ne change : la voie d'écriture de VF4b reste la référence, et la recomposition d'un bloc lui est
--      confrontée source par source (supabase/essais/recompositionDesVentes.sql, sur une batterie tirée au hasard, et les
--      essais de la vente facturée, sur leurs jeux) ;
--   2. `ventes_facturees_de_l_exercice`, NEUVE (exécutée par aucun rôle de l'API) : chaque source en défaut sur la période
--      qui va de la FRONTIÈRE (exclue ; le début des temps sans exercice validé) au 31 décembre — ce qui s'écrit dans la
--      période, comparé en multiensemble (date|compte|sens|centimes|mouvement) à ce que le brouillon y propose : à
--      écrire, à réécrire, à retirer ; ou qui ne s'écrit pas quand sa date y tombe —, avec son état, son motif et son
--      nom, dans l'ordre de sa date (celle de la première ligne qui diffère, ou celle de la source), puis du genre
--      (facture, avoir, encaissement, mouvement). Un premier exercice validé ne fige pas un manque d'avant lui ;
--   3. `valider_exercice` : ses refus d'hier au caractère près, et trois manques de plus, avant la numérotation, chacun
--      sous ses mots, en 23514 : un mouvement RÉSERVÉ daté jusqu'au 31 décembre (un crédit, ou un débit), AVANT les
--      mouvements à traiter ; puis, après eux, un encaissement vivant d'une facture source, par virement ou par
--      prélèvement, daté jusqu'au 31 décembre, sans mouvement ; puis la première source en défaut.
-- src/lib/prealablesValidation.ts (`REFUS_VENTES_FACTUREES_DE_LA_VALIDATION`) redit ces refus.
--
-- CE QUI NE CHANGE PAS. Un dossier qui n'a pas basculé : rien (la fonction neuve ne rend rien, et les trois manques ne
-- se cherchent pas). Les chèques, les cartes et les effets sans mouvement au 31 décembre : ils ne retiennent pas.
-- `calcul_vente_facturee`, `ecriture_attendue_vente_facturee`, `ecrire_vente_facturee`, `retirer_ecriture_vente_facturee`.
-- Les fonctions que remplacent les étapes VF5h2 (`registre_virement_mixte`) et VF7a (`frontiere_des_encaissements`) : ni
-- lues, ni touchées — cette migration s'applique avec ou sans elles. Aucune table, colonne, contrainte, policy ni aucun
-- droit d'une table ; aucune donnée écrite ni retirée.
--
-- NEUTRE EN PRODUCTION (relevé le 25/10/2026, des comptes) : aucun dossier n'a basculé, aucune facture n'est source,
-- aucun encaissement, aucun exercice validé — aucun refus neuf ne peut s'y rencontrer.
--
-- CE QUI CONTOURNE LA RLS : la validation lisait déjà tout le dossier, aux droits du propriétaire, après avoir vérifié le
-- chef du cabinet ; elle lit en plus ses factures, ses encaissements et leurs parts, ses mouvements, ses exemplaires et
-- ses écritures de vente facturée, et ne rend qu'un refus. Les deux fonctions neuves ne s'exécutent que depuis elle (et
-- par le propriétaire).
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni
-- instruction qui en retire. Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose : la validation qu'elle reprend, et la composition qu'elle redit d'un bloc ══════════

do $$
declare
  v record;
begin
  for v in select x.fonction, x.empreinte, x.migration from (values
      ('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)', '8c4c7a5a618de4a692d2494f9a197b0c', 'report_des_soldes'),
      ('public.ecriture_attendue_vente_facturee(uuid, text, uuid)', 'e956e19eea29309d239f64929b8c0688', 'virement_mixte'),
      ('public.calcul_vente_facturee(uuid)', 'd2f0312ec96293f24302d20f2d8da159', 'ecritures_de_la_vente_facturee'),
      ('public.encaissement_justifie_son_mouvement(uuid)', '5d8ac5a1d8d08ceb95a3eca3b98c499d', 'encaissements_de_la_vente_facturee')
    ) x(fonction, empreinte, migration) loop
    -- Le corps que cette migration reprend, ou redit d'un bloc, au caractère près (les retours chariot d'un collage
    -- écartés) : une fonction changée depuis — par une autre migration, ou par une première application de celle-ci — ne
    -- se reprend ni ne se redit sans être relue.
    if to_regprocedure(v.fonction) is null
       or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), '')) <> v.empreinte then
      raise exception 'La fonction % en base n''est plus celle de la migration % : cette migration ne la reprend ni ne la redit sans être relue.',
        v.fonction, v.migration;
    end if;
  end loop;
end
$$;

-- ══ 1. La recomposition d'un bloc : ce que chaque source d'une période écrit ══════════
-- La règle du cumul (`calcul_vente_facturee`) et la composition (`ecriture_attendue_vente_facturee`), redites pour toutes
-- les sources d'une période ensemble, en quelques requêtes : la règle parcourt la chaîne des parts de chaque taux d'une
-- facture, un rang à la fois, toutes les factures ensemble. Même forme que la composition — son motif, son détail, ses
-- lignes « date|compte|sens|centimes|mouvement » —, source par source : supabase/essais/recompositionDesVentes.sql les
-- confronte, sur une batterie tirée au hasard, et les essais de la vente facturée sur leurs jeux.
create function public.ecritures_attendues_de_la_periode(p_dossier_id uuid, p_frontiere date, p_fin date)
returns table (genre text, source_id uuid, date_source date, motif text, detail text, lignes text[])
language plpgsql
stable
set search_path = public
set jit = off
set enable_nestloop = off
as $$
begin
  -- Une requête planifiée à chaque appel sur les valeurs reçues ($1 le dossier, $2 la frontière, $3 la fin de la période),
  -- jointe par hachage : le planificateur estime mal ce que rendent ses étapes enchaînées, et des boucles imbriquées la
  -- rendraient quadratique (mesuré : 1,2 à 1,9 s au lieu de 0,25 à 0,4 s pour 3 000 encaissements). Et sans compilation à
  -- la volée (`jit`), que la production n'emploie pas et qui coûterait ici dix secondes de plus que la requête.
  return query execute $q$
with recursive
-- ── Le dossier : son modèle comptable et les comptes de ses rôles, lus une fois ──
dossier as (
  select d.mode_comptable as mode, public.compte_du_role(d.id, 'banque') as banque,
         public.compte_du_role(d.id, 'clients') as clients, public.compte_du_role(d.id, 'tva_collectee') as collectee,
         public.compte_du_role(d.id, 'tva_collectee_en_attente') as attente,
         public.compte_du_role(d.id, 'valeurs_a_l_encaissement') as valeurs, public.compte_du_role(d.id, 'caisse') as caisse,
         public.compte_du_role(d.id, 'services_bancaires') as frais_bancaires,
         public.compte_du_role(d.id, 'ventes_de_biens') as ventes_de_biens,
         public.compte_du_role(d.id, 'prestations_de_services') as prestations
    from public.dossiers d
   where d.id = $1
),
-- ── LES SOURCES DE LA PÉRIODE ──
-- Celles dont une date y tombe — l'émission d'une facture ou d'un avoir source, la livraison d'une facture, un
-- encaissement d'une facture source, un mouvement que l'un d'eux cite, classé par ses encaissements ou libre —, et celles
-- dont le brouillon y propose une ligne. Une source n'écrit qu'à ses dates : une autre n'a, dans la période, ni rien à
-- écrire ni rien de proposé. Sans frontière, la période part du début des temps.
candidates as (
  select case when f.type = 'avoir' then 'avoir' else 'facture' end as genre, f.id, f.date_emission as date_source,
         coalesce(f.facture_origine_id, f.id) as facture_id
    from public.factures_emises f
   where f.dossier_id = $1 and f.statut = 'validee' and f.source_de_la_vente
     and (f.date_emission <= $3 and ($2 is null or f.date_emission > $2)
          or f.type = 'facture' and f.date_prestation <= $3 and ($2 is null or f.date_prestation > $2))
  union
  select 'encaissement', e.id, e.date_encaissement, e.facture_id
    from public.encaissements_factures e
    join public.factures_emises f on f.id = e.facture_id
   where e.dossier_id = $1 and f.source_de_la_vente
     and e.date_encaissement <= $3 and ($2 is null or e.date_encaissement > $2)
  union
  select 'mouvement', l.id, l.date, null::uuid
    from public.lignes_bancaires l
   where l.dossier_id = $1 and l.date <= $3 and ($2 is null or l.date > $2)
     and (l.encaissements_de_factures or public.mouvement_libre(l))
     and exists (select 1 from public.encaissements_factures e
                   join public.factures_emises f on f.id = e.facture_id
                  where e.ligne_bancaire_id = l.id and e.dossier_id = $1 and f.source_de_la_vente)
  union
  select case when f.type = 'avoir' then 'avoir' else 'facture' end, f.id, f.date_emission,
         coalesce(f.facture_origine_id, f.id)
    from public.ecritures_brouillon b
    join public.factures_emises f on f.id = b.facture_id
   where b.dossier_id = $1 and b.statut = 'proposee'
     and b.date <= $3 and ($2 is null or b.date > $2)
  union
  select 'encaissement', e.id, e.date_encaissement, e.facture_id
    from public.ecritures_brouillon b
    join public.encaissements_factures e on e.id = b.encaissement_id
   where b.dossier_id = $1 and b.statut = 'proposee'
     and b.date <= $3 and ($2 is null or b.date > $2)
  union
  select 'mouvement', l.id, l.date, null::uuid
    from public.ecritures_brouillon b
    join public.lignes_bancaires l on l.id = b.ligne_bancaire_id
   where b.dossier_id = $1 and b.statut = 'proposee'
     and b.date <= $3 and ($2 is null or b.date > $2)
     and b.facture_id is null and b.encaissement_id is null and b.piece_id is null and b.immobilisation_id is null
     and b.vehicule_id is null and b.declaration_tva_id is null and b.cotisation_id is null
     and (l.encaissements_de_factures or public.mouvement_libre(l))
     and exists (select 1 from public.encaissements_factures e
                   join public.factures_emises f on f.id = e.facture_id
                  where e.ligne_bancaire_id = l.id and e.dossier_id = $1 and f.source_de_la_vente)
),
-- ══ LA RÈGLE DU CUMUL, POUR TOUTES CES FACTURES À LA FOIS : `calcul_vente_facturee`, redite d'un bloc ══
-- Les factures dont une source dépend, et celles dont un mouvement de la période porte un encaissement.
utiles as (
  select c.facture_id as id from candidates c where c.facture_id is not null
  union
  select e.facture_id
    from candidates c
    join public.encaissements_factures e on e.ligne_bancaire_id = c.id and e.dossier_id = $1
   where c.genre = 'mouvement'
),
-- Celles que la règle compte : des factures validées sources, chacune son régime, là où la base le fige.
fac as (
  select f.id, f.dossier_id, f.date_emission, f.date_prestation, f.nature_operation,
         case when f.nature_operation = 'biens' then 'livraison'
              when f.nature_operation is distinct from 'services' then 'nature'
              when f.option_debits is null then 'option_debits'
              when f.option_debits then 'debits'
              else 'encaissement' end as regime
    from utiles u
    join public.factures_emises f on f.id = u.id
   where f.type = 'facture' and f.statut = 'validee' and f.source_de_la_vente
),
montants as (
  select x.id as facture_id, m.taux, m.base_centimes as base, m.tva_centimes as tva, m.ttc_centimes as ttc
    from fac x
    cross join lateral public.montants_par_taux_facture(x.id) m
),
avoirs as (
  select x.id as facture_id, a.id as avoir_id, a.date_emission, m.taux, m.base_centimes as base, m.tva_centimes as tva,
         m.ttc_centimes as ttc
    from fac x
    join public.factures_emises a on a.dossier_id = x.dossier_id and a.facture_origine_id = x.id and a.type = 'avoir'
                                 and a.statut = 'validee' and a.source_de_la_vente
    cross join lateral public.montants_par_taux_facture(a.id) m
),
-- Les encaissements qui comptent (non retirés), dans leur ordre : leur date, leur création, leur identifiant.
encs as (
  select e.id, e.facture_id, e.annule_id, e.date_encaissement, e.moyen, e.ligne_bancaire_id,
         (e.montant * 100)::bigint as montant,
         row_number() over (partition by e.facture_id order by e.date_encaissement, e.cree_le, e.id) as rang
    from fac x
    join public.encaissements_factures e on e.dossier_id = x.dossier_id and e.facture_id = x.id and e.retire_le is null
),
parts as (
  select e.facture_id, e.id as encaissement_id, e.rang, e.annule_id, e.date_encaissement, t.taux,
         (t.montant * 100)::bigint as part
    from encs e
    join fac x on x.id = e.facture_id
    join public.encaissements_factures_taux t on t.encaissement_id = e.id and t.dossier_id = x.dossier_id
),
-- Un encaissement illisible : de montant nul, ou que ses parts ne font pas, au centime, sur des taux de la facture et
-- de son signe ; sans part, il est illisible.
lectures as (
  select e.facture_id,
         coalesce(e.montant = 0 or coalesce(sum(p.part), 0) <> e.montant
                  or bool_or(sign(p.part) <> sign(e.montant) or m.facture_id is null), true) as illisible
    from encs e
    left join parts p on p.encaissement_id = e.id
    left join montants m on m.facture_id = p.facture_id and m.taux = p.taux
   group by e.facture_id, e.id, e.montant
),
-- La facture écartée avant la règle : sa nature, son option, ses lignes, un encaissement illisible.
avec_lignes as (
  select distinct m.facture_id from montants m
),
illisibles as (
  select distinct l.facture_id from lectures l where l.illisible
),
avant_le_cumul as (
  select x.id,
         case when x.regime in ('nature', 'option_debits') then x.regime
              when a.facture_id is null then 'sans_lignes'
              when i.facture_id is not null then 'encaissement_illisible'
         end as motif
    from fac x
    left join avec_lignes a on a.facture_id = x.id
    left join illisibles i on i.facture_id = x.id
),
-- V et T de chaque part d'un encaissement — pas d'une contre-passation : la TVA et le TTC de son taux, nets des avoirs
-- datés au plus tard du jour de l'encaissement.
vt as (
  select p.encaissement_id, p.taux, p.facture_id, p.rang,
         coalesce(max(m.tva), 0) - coalesce(sum(a.tva), 0) as v,
         coalesce(max(m.base + m.tva), 0) - coalesce(sum(a.base + a.tva), 0) as t
    from parts p
    join avant_le_cumul c on c.id = p.facture_id and c.motif is null
    left join montants m on m.facture_id = p.facture_id and m.taux = p.taux
    left join avoirs a on a.facture_id = p.facture_id and a.taux = p.taux and a.date_emission <= p.date_encaissement
   where p.annule_id is null
   group by p.encaissement_id, p.taux, p.facture_id, p.rang
),
-- Chaque taux d'une facture : sa chaîne de parts, dans l'ordre des encaissements, que la règle parcourt un rang à la
-- fois, toutes les factures ensemble. La part d'un encaissement porte ce que V × cumul / T arrondi rend (le demi loin de
-- zéro), moins ce que portaient les parts d'avant ; celle d'une contre-passation, l'opposé exact de la TVA de son
-- encaissement.
chaine as (
  select p.facture_id, p.taux, p.encaissement_id, p.annule_id, p.part, v.v, v.t,
         row_number() over (partition by p.facture_id, p.taux order by p.rang) as k
    from parts p
    join avant_le_cumul c on c.id = p.facture_id and c.motif is null
    left join vt v on v.encaissement_id = p.encaissement_id and v.taux = p.taux
),
cumul (facture_id, taux, k, encaissement_id, encaisse, portee, tva, tvas) as (
  select c.facture_id, c.taux, c.k, c.encaissement_id, c.part, x.tva, x.tva, jsonb_build_object(c.encaissement_id::text, x.tva)
    from chaine c
    cross join lateral (
      select case when c.annule_id is not null then null::bigint
                  when c.t > 0 then (sign(c.v * c.part) * div(2 * abs(c.v * c.part) + c.t, 2 * c.t))::bigint
             end as tva) x
   where c.k = 1
  union all
  select c.facture_id, c.taux, c.k, c.encaissement_id, r.encaisse + c.part, r.portee + x.tva, x.tva,
         r.tvas || jsonb_build_object(c.encaissement_id::text, x.tva)
    from cumul r
    join chaine c on c.facture_id = r.facture_id and c.taux = r.taux and c.k = r.k + 1
    cross join lateral (
      select case when c.annule_id is not null then -((r.tvas ->> c.annule_id::text)::bigint)
                  when c.t > 0 then (sign(c.v * (r.encaisse + c.part))
                                     * div(2 * abs(c.v * (r.encaisse + c.part)) + c.t, 2 * c.t))::bigint - r.portee
             end as tva) x
),
-- La facture écartée par la règle : au premier encaissement, dans leur ordre, qui est une contre-passation qui n'est pas
-- l'exact opposé, taux par taux, d'un encaissement compté avant elle, ou dont une part a un TTC que ses avoirs annulent.
signatures as (
  select p.encaissement_id,
         string_agg(trim_scale(p.taux)::text || ':' || p.part, ',' order by p.taux) as signature,
         string_agg(trim_scale(p.taux)::text || ':' || (-p.part), ',' order by p.taux) as opposee
    from parts p
   group by p.encaissement_id
),
echecs as (
  select e.facture_id, e.rang, 'contre_passation_illisible' as motif
    from encs e
    left join encs o on o.id = e.annule_id and o.facture_id = e.facture_id
    left join signatures s on s.encaissement_id = e.id
    left join signatures so on so.encaissement_id = o.id
   where e.annule_id is not null and (o.id is null or o.rang >= e.rang or s.signature is distinct from so.opposee)
  union all
  select v.facture_id, v.rang, 'ttc_nul'
    from vt v
   where v.t <= 0
),
premiers_echecs as (
  select distinct on (z.facture_id) z.facture_id, z.motif from echecs z order by z.facture_id, z.rang
),
ecartees as (
  select c.id as facture_id, coalesce(c.motif, z.motif) as motif
    from avant_le_cumul c
    left join premiers_echecs z on z.facture_id = c.id
),
comptees as (
  select x.id, x.regime, x.nature_operation, x.date_emission,
         case when x.regime = 'livraison' then coalesce(x.date_prestation, x.date_emission) else x.date_emission end as fait
    from fac x
    join ecartees c on c.facture_id = x.id and c.motif is null
),
-- Ce qu'une facture comptée pèse : ses parts, ses documents — la facture et ses avoirs à leur date —, ses exigibilités.
part_lignes as (
  select p.facture_id, p.encaissement_id, p.date_encaissement as date_effet, p.taux, p.part as ttc, p.part - k.tva as base,
         k.tva
    from parts p
    join comptees q on q.id = p.facture_id
    join cumul k on k.facture_id = p.facture_id and k.taux = p.taux and k.encaissement_id = p.encaissement_id
),
documents as (
  select m.facture_id, null::uuid as avoir_id, q.date_emission as date_effet, m.taux, m.ttc, m.base, m.tva
    from montants m
    join comptees q on q.id = m.facture_id
  union all
  select a.facture_id, a.avoir_id, a.date_emission, a.taux, -a.ttc, -a.base, -a.tva
    from avoirs a
    join comptees q on q.id = a.facture_id
),
avoirs_au_fait as (
  select a.facture_id, a.taux, sum(a.tva) as tva, sum(a.base + a.tva) as ttc
    from avoirs a
    join comptees q on q.id = a.facture_id
   where q.regime <> 'encaissement' and a.date_emission <= q.fait
   group by a.facture_id, a.taux
),
parts_avant_le_fait as (
  select r.facture_id, r.taux, sum(r.tva) as tva, sum(r.base) as base
    from part_lignes r
    join comptees q on q.id = r.facture_id
   where q.regime <> 'encaissement' and r.date_effet < q.fait
   group by r.facture_id, r.taux
),
taux_du_fait as (
  select m.facture_id, m.taux from montants m join comptees q on q.id = m.facture_id where q.regime <> 'encaissement'
  union
  select a.facture_id, a.taux from avoirs a join comptees q on q.id = a.facture_id where q.regime <> 'encaissement'
),
au_fait as (
  select u.facture_id, case when q.regime = 'livraison' then 'livraison' else 'facture' end as origine, q.fait, u.taux,
         coalesce(m.tva, 0) - coalesce(af.tva, 0) as v, coalesce(m.base + m.tva, 0) - coalesce(af.ttc, 0) as t,
         coalesce(pa.tva, 0) as tva_avant, coalesce(pa.base, 0) as ht_avant
    from taux_du_fait u
    join comptees q on q.id = u.facture_id
    left join montants m on m.facture_id = u.facture_id and m.taux = u.taux
    left join avoirs_au_fait af on af.facture_id = u.facture_id and af.taux = u.taux
    left join parts_avant_le_fait pa on pa.facture_id = u.facture_id and pa.taux = u.taux
),
exigibilites as (
  -- Des services : chaque part, à la date de son encaissement ; un bien ou des services sur les débits : les parts d'avant
  -- le fait générateur ; à lui, ce que la facture porte nette des avoirs datés jusque-là, moins ce que ces parts ont rendu
  -- exigible ; un avoir d'après, à sa date.
  select r.facture_id, 'encaissement' as origine, r.encaissement_id, null::uuid as avoir_id, r.date_effet, r.taux, r.tva
    from part_lignes r
    join comptees q on q.id = r.facture_id
   where q.regime = 'encaissement' or r.date_effet < q.fait
  union all
  select g.facture_id, g.origine, null::uuid, null::uuid, g.fait, g.taux, g.v - g.tva_avant
    from au_fait g
   where g.t - g.v - g.ht_avant <> 0 or g.v - g.tva_avant <> 0
  union all
  select d.facture_id, 'avoir', null::uuid, d.avoir_id, d.date_effet, d.taux, d.tva
    from documents d
    join comptees q on q.id = d.facture_id
   where q.regime <> 'encaissement' and d.avoir_id is not null and d.date_effet > q.fait
),
exigibles as (
  select distinct g.encaissement_id, g.taux from exigibilites g where g.origine = 'encaissement'
),
-- ══ CE QUE CHAQUE SOURCE ÉCRIT : `ecriture_attendue_vente_facturee`, redite d'un bloc ══
-- La facture ou l'avoir : en engagement, le document à sa date ; dans les deux modèles, la TVA due avant l'encaissement.
soldes_documents as (
  select c.genre, c.id, d.date_effet as jour, x.compte, null::uuid as ligne, x.m
    from candidates c
    join documents d on d.facture_id = c.facture_id
                    and (c.genre = 'facture' and d.avoir_id is null or c.genre = 'avoir' and d.avoir_id = c.id)
    join comptees q on q.id = c.facture_id
    cross join dossier o
    cross join lateral (values (o.clients, d.ttc),
                               (case when q.nature_operation = 'biens' then o.ventes_de_biens else o.prestations end, -d.base),
                               (o.attente, -d.tva)) x(compte, m)
   where c.genre in ('facture', 'avoir') and o.mode = 'engagement'
  union all
  select c.genre, c.id, g.date_effet, x.compte, null::uuid, x.m
    from candidates c
    join exigibilites g on g.facture_id = c.facture_id and g.origine <> 'encaissement'
                       and (c.genre = 'facture' and g.origine in ('livraison', 'facture') or c.genre = 'avoir' and g.avoir_id = c.id)
    cross join dossier o
    cross join lateral (values (case when o.mode = 'tresorerie' then o.clients else o.attente end, g.tva),
                               (o.collectee, -g.tva)) x(compte, m)
   where c.genre in ('facture', 'avoir')
),
-- L'encaissement : son compte de trésorerie — la banque d'un mouvement de son jour, sinon les valeurs à l'encaissement
-- (la caisse pour des espèces), le compte de contrepartie choisi d'une compensation ou d'un autre moyen sans mouvement ;
-- une contre-passation sans mouvement défait son encaissement là où il a été écrit.
encaissements_sources as (
  select c.id, e.facture_id, e.date_encaissement,
         case when t.ligne_bancaire_id is not null
                then case when m.date = t.date_encaissement then o.banque
                          when t.moyen = 'especes' then o.caisse else o.valeurs end
              when t.moyen = 'especes' then o.caisse
              when t.moyen in ('compensation', 'autre') then t.compte_contrepartie
              else o.valeurs end as compte,
         case when t.ligne_bancaire_id is not null and m.date = t.date_encaissement then m.id end as ligne,
         case when t.ligne_bancaire_id is null and t.moyen in ('compensation', 'autre') and t.compte_contrepartie is null
                then 'compte_a_choisir'
              when t.ligne_bancaire_id is null and t.moyen in ('compensation', 'autre')
                   and public.refus_compte_de_contrepartie($1, t.compte_contrepartie) is not null
                then 'compte_refuse' end as motif,
         t.compte_contrepartie
    from candidates c
    join public.encaissements_factures e on e.id = c.id and e.dossier_id = $1
    left join public.encaissements_factures t
           on t.id = case when e.annule_id is not null and e.ligne_bancaire_id is null then e.annule_id else e.id end
    left join public.lignes_bancaires m on m.id = t.ligne_bancaire_id
    cross join dossier o
   where c.genre = 'encaissement'
),
encaissements_comptes as (
  select distinct r.encaissement_id from part_lignes r
),
soldes_encaissements as (
  select 'encaissement' as genre, s.id, s.date_encaissement as jour, x.compte, x.ligne, x.m
    from encaissements_sources s
    join part_lignes r on r.encaissement_id = s.id
    join comptees q on q.id = s.facture_id
    left join exigibles y on y.encaissement_id = s.id and y.taux = r.taux
    cross join dossier o
    cross join lateral (
      select s.compte, s.ligne, r.ttc
      union all
      select case when q.nature_operation = 'biens' then o.ventes_de_biens else o.prestations end, null::uuid, -r.base
       where o.mode = 'tresorerie'
      union all
      select case when y.encaissement_id is not null then o.collectee else o.clients end, null::uuid, -r.tva
       where o.mode = 'tresorerie'
      union all
      select o.clients, null::uuid, -r.ttc
       where o.mode = 'engagement'
      union all
      select o.attente, null::uuid, r.tva
       where o.mode = 'engagement' and y.encaissement_id is not null
      union all
      select o.collectee, null::uuid, -r.tva
       where o.mode = 'engagement' and y.encaissement_id is not null) x(compte, ligne, m)
   where s.motif is null
),
-- Le mouvement : ce qu'il porte, les encaissements non retirés qui le citent, qu'aucune contre-passation sans mouvement
-- n'annule ; la banque de ce que ceux du même jour n'ont pas porté — l'exemplaire d'une facture qui n'est pas source porte
-- la sienne, comme un encaissement du même jour —, le 511 (le 53) de ceux d'un autre jour, les frais du tout.
mouvements_sources as (
  select c.id, l.date as jour, (l.montant * 100)::bigint as montant, l.encaissements_de_factures as classe
    from candidates c
    join public.lignes_bancaires l on l.id = c.id and l.dossier_id = $1
   where c.genre = 'mouvement'
),
portes as (
  select s.id as mouvement_id, e.id, e.facture_id, e.date_encaissement, e.moyen, (e.montant * 100)::bigint as montant,
         f.statut = 'validee' and f.source_de_la_vente as compte_sa_vente, f.source_de_la_vente as source, f.numero
    from mouvements_sources s
    join public.encaissements_factures e on e.ligne_bancaire_id = s.id and e.dossier_id = $1 and e.retire_le is null
    join public.factures_emises f on f.id = e.facture_id
   where not exists (select 1 from public.encaissements_factures n
                      where n.annule_id = e.id and n.retire_le is null and n.ligne_bancaire_id is null)
),
exemplaires as (
  select x.facture_id, count(*) as n
    from public.pieces x
   where x.dossier_id = $1 and x.statut = 'validee' and x.type_piece = 'vente'
     and x.facture_id in (select p.facture_id from portes p where not p.compte_sa_vente)
   group by x.facture_id
),
sans_exemplaire as (
  select distinct on (p.mouvement_id) p.mouvement_id, p.numero
    from portes p
    left join exemplaires x on x.facture_id = p.facture_id
   where not p.compte_sa_vente and coalesce(x.n, 0) <> 1
   order by p.mouvement_id, p.numero collate "C", p.facture_id
),
mouvements_juges as (
  select s.id, s.jour, s.montant, s.classe, bool_or(p.compte_sa_vente) as justifie,
         bool_or(z.motif is not null) as vente_ecartee, coalesce(sum(p.montant), 0) as total,
         coalesce(sum(p.montant) filter (where p.date_encaissement = s.jour or not p.source), 0) as meme_jour,
         n.numero as facture_non_source, n.mouvement_id is not null as sans_son_exemplaire
    from mouvements_sources s
    left join portes p on p.mouvement_id = s.id
    left join ecartees z on z.facture_id = p.facture_id
    left join sans_exemplaire n on n.mouvement_id = s.id
   group by s.id, s.jour, s.montant, s.classe, n.mouvement_id, n.numero
),
soldes_mouvements as (
  select 'mouvement' as genre, j.id, j.jour, case when p.moyen = 'especes' then o.caisse else o.valeurs end as compte,
         j.id as ligne, -p.montant as m
    from mouvements_juges j
    join portes p on p.mouvement_id = j.id and p.date_encaissement <> j.jour and p.source
    cross join dossier o
   where j.justifie and not j.sans_son_exemplaire and not coalesce(j.vente_ecartee, false)
  union all
  select 'mouvement', j.id, j.jour, x.compte, j.id, x.m
    from mouvements_juges j
    cross join dossier o
    cross join lateral (values (o.banque, j.montant - j.meme_jour), (o.frais_bancaires, j.total - j.montant)) x(compte, m)
   where j.justifie and not j.sans_son_exemplaire and not coalesce(j.vente_ecartee, false)
),
-- Les lignes : sommées par date, compte et mouvement, les nulles ôtées, triées octet par octet.
lignes_des_sources as (
  select s.genre, s.id, array_agg(s.texte order by s.texte collate "C") as lignes
    from (select y.genre, y.id,
                 to_char(y.jour, 'YYYY-MM-DD') || '|' || y.compte || '|' || case when sum(y.m) > 0 then 'debit' else 'credit' end
                 || '|' || abs(sum(y.m)) || '|' || coalesce(y.ligne::text, '') as texte
            from (select d.genre, d.id, d.jour, d.compte, d.ligne, d.m::numeric as m from soldes_documents d
                  union all
                  select e.genre, e.id, e.jour, e.compte, e.ligne, e.m::numeric from soldes_encaissements e
                  union all
                  select v.genre, v.id, v.jour, v.compte, v.ligne, v.m::numeric from soldes_mouvements v) y
           group by y.genre, y.id, y.jour, y.compte, y.ligne
          having sum(y.m) <> 0) s
   group by s.genre, s.id
)
select c.genre, c.id, c.date_source,
       case when c.genre in ('facture', 'avoir', 'encaissement') and z.motif is not null then 'vente_ecartee'
            when c.genre = 'encaissement' and k.encaissement_id is not null then es.motif
            when c.genre = 'mouvement' and j.justifie and j.sans_son_exemplaire then 'mouvement_facture_non_source'
            when c.genre = 'mouvement' and j.justifie and j.vente_ecartee then 'mouvement_vente_ecartee'
            when c.genre = 'mouvement' and j.justifie and l.lignes is not null and not j.classe then 'mouvement_non_classe'
            when c.genre = 'mouvement' and j.justifie and l.lignes is not null
                 and (j.total - j.montant < 0 or (j.total - j.montant) * 100 > least(50000, abs(j.total) * 2))
              then 'mouvement_ecart'
       end,
       case when c.genre in ('facture', 'avoir', 'encaissement') and z.motif is not null then z.motif
            when c.genre = 'encaissement' and k.encaissement_id is not null and es.motif = 'compte_refuse' then es.compte_contrepartie
            when c.genre = 'mouvement' and j.justifie and j.sans_son_exemplaire then j.facture_non_source
       end,
       case when c.genre in ('facture', 'avoir', 'encaissement') and z.motif is not null then '{}'::text[]
            when c.genre = 'encaissement' and es.motif is not null then '{}'::text[]
            when c.genre = 'mouvement' and j.justifie and l.lignes is not null
                 and (not j.classe or j.total - j.montant < 0 or (j.total - j.montant) * 100 > least(50000, abs(j.total) * 2))
              then '{}'::text[]
            else coalesce(l.lignes, '{}'::text[]) end
  from candidates c
  left join ecartees z on z.facture_id = c.facture_id
  left join encaissements_sources es on es.id = c.id and c.genre = 'encaissement'
  left join encaissements_comptes k on k.encaissement_id = c.id and c.genre = 'encaissement'
  left join mouvements_juges j on j.id = c.id and c.genre = 'mouvement'
  left join lignes_des_sources l on l.genre = c.genre and l.id = c.id
$q$ using p_dossier_id, p_frontiere, p_fin;
end
$$;

-- ══ 2. Les sources d'une vente facturée en défaut sur un exercice ══════════
create function public.ventes_facturees_de_l_exercice(p_dossier_id uuid, p_annee integer)
returns table (source text, source_id uuid, jour date, etat text, motif text, detail text, nom text)
language plpgsql
stable
set search_path = public
set jit = off
set enable_nestloop = off
as $$
begin
  -- Pour un dossier basculé seulement. La période : de la frontière (exclue ; le début des temps sans exercice validé) au
  -- 31 décembre de l'exercice. La requête, planifiée à chaque appel sur ces valeurs ($1 le dossier, $2 la frontière, $3 la
  -- fin), comme la recomposition qu'elle lit.
  if p_annee is null
     or not coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = p_dossier_id), false) then
    return;
  end if;
  return query execute $q$
with
compositions as materialized (
  select c.genre, c.source_id as id, c.date_source, c.motif, c.detail, c.lignes, $2::date as frontiere, $3::date as fin
    from public.ecritures_attendues_de_la_periode($1, $2, $3) c
),
-- Ce qui s'écrit dans la période, et ce que le brouillon y propose, sous la forme d'`ecrire_vente_facturee`
-- (date|compte|sens|centimes|mouvement), triés octet par octet : deux multiensembles.
attendues as (
  select m.genre, m.id, array_agg(x.texte order by x.texte collate "C") as lignes
    from compositions m
    cross join lateral unnest(m.lignes) x(texte)
   where split_part(x.texte, '|', 1)::date <= m.fin
     and (m.frontiere is null or split_part(x.texte, '|', 1)::date > m.frontiere)
   group by m.genre, m.id
),
proposees as (
  select q.genre, q.id, array_agg(q.texte order by q.texte collate "C") as lignes
    from (select m.genre, m.id,
                 to_char(b.date, 'YYYY-MM-DD') || '|' || b.compte || '|' || b.sens || '|' || (b.montant * 100)::bigint || '|'
                 || coalesce(b.ligne_bancaire_id::text, '') as texte
            from compositions m
            join public.ecritures_brouillon b on b.facture_id = m.id
           where m.genre in ('facture', 'avoir') and b.dossier_id = $1 and b.statut = 'proposee'
             and b.date <= m.fin and (m.frontiere is null or b.date > m.frontiere)
          union all
          select m.genre, m.id,
                 to_char(b.date, 'YYYY-MM-DD') || '|' || b.compte || '|' || b.sens || '|' || (b.montant * 100)::bigint || '|'
                 || coalesce(b.ligne_bancaire_id::text, '')
            from compositions m
            join public.ecritures_brouillon b on b.encaissement_id = m.id
           where m.genre = 'encaissement' and b.dossier_id = $1 and b.statut = 'proposee'
             and b.date <= m.fin and (m.frontiere is null or b.date > m.frontiere)
          union all
          select m.genre, m.id,
                 to_char(b.date, 'YYYY-MM-DD') || '|' || b.compte || '|' || b.sens || '|' || (b.montant * 100)::bigint || '|'
                 || coalesce(b.ligne_bancaire_id::text, '')
            from compositions m
            join public.ecritures_brouillon b on b.ligne_bancaire_id = m.id
           where m.genre = 'mouvement' and b.dossier_id = $1 and b.statut = 'proposee'
             and b.date <= m.fin and (m.frontiere is null or b.date > m.frontiere)
             and b.facture_id is null and b.encaissement_id is null and b.piece_id is null and b.immobilisation_id is null
             and b.vehicule_id is null and b.declaration_tva_id is null and b.cotisation_id is null) q
   group by q.genre, q.id
),
jugees as (
  select m.genre, m.id, m.date_source, m.motif, m.detail, m.frontiere, m.fin, coalesce(a.lignes, '{}') as attendu,
         coalesce(p.lignes, '{}') as propose
    from compositions m
    left join attendues a on a.genre = m.genre and a.id = m.id
    left join proposees p on p.genre = m.genre and p.id = m.id
),
-- En défaut : ce qui est proposé n'est pas exactement ce qui s'écrit — à écrire, à retirer, à réécrire, daté de la
-- première ligne qui diffère —, ou la source ne s'écrit pas (un motif) et sa date tombe dans la période.
defauts as (
  select j.genre, j.id, j.motif, j.detail,
         case when j.attendu is distinct from j.propose
              then (select min(split_part(z.texte, '|', 1)::date)
                      from ((select u.texte from unnest(j.attendu) u(texte)
                             except all
                             select w.texte from unnest(j.propose) w(texte))
                            union all
                            (select w.texte from unnest(j.propose) w(texte)
                             except all
                             select u.texte from unnest(j.attendu) u(texte))) z)
              else j.date_source end as jour,
         case when j.attendu is not distinct from j.propose then 'ne_s_ecrit_pas'
              when cardinality(j.propose) = 0 then 'a_ecrire'
              when cardinality(j.attendu) = 0 then 'a_retirer'
              else 'a_reecrire' end as etat
    from jugees j
   where j.attendu is distinct from j.propose
      or j.motif is not null and j.date_source <= j.fin and (j.frontiere is null or j.date_source > j.frontiere)
)
select d.genre, d.id, d.jour, d.etat, d.motif, d.detail,
       case d.genre
         when 'facture' then 'la facture ' || f.numero
         when 'avoir' then 'l''avoir ' || f.numero
         when 'encaissement' then case when e.annule_id is null then 'l''encaissement du ' else 'la contre-passation du ' end
                                  || to_char(e.date_encaissement, 'DD/MM/YYYY') || ' de la facture ' || g.numero
         else 'le mouvement du ' || to_char(l.date, 'DD/MM/YYYY') end
  from defauts d
  left join public.factures_emises f on f.id = d.id and d.genre in ('facture', 'avoir')
  left join public.encaissements_factures e on e.id = d.id and d.genre = 'encaissement'
  left join public.factures_emises g on g.id = e.facture_id
  left join public.lignes_bancaires l on l.id = d.id and d.genre = 'mouvement'
 order by d.jour, case d.genre when 'facture' then 0 when 'avoir' then 1 when 'encaissement' then 2 else 3 end, d.id
$q$ using p_dossier_id, public.frontiere_validation(p_dossier_id), make_date(p_annee, 12, 31);
end
$$;

-- ══ 3. La validation : trois manques de G5 de plus ══════════
-- La définition de `report_des_soldes`, au caractère près hors des lignes insérées : cinq variables, le réservé avant les
-- mouvements à traiter, le virement sans mouvement et les sources après eux.
create or replace function public.valider_exercice(
  p_dossier_id uuid,
  p_annee integer,
  p_lignes jsonb,
  p_a_nouveaux jsonb,
  p_declaration jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet uuid;
  v_mode text;
  v_debut date;
  v_fin date;
  v_ouverture date;
  v_anterieur integer;
  v_attendues integer;
  v_recues integer;
  v_distinctes integer;
  v_jointes integer;
  v_an_attendus integer;
  v_an_recus integer;
  v_an_distincts integer;
  v_an_joints integer;
  v_a_traiter integer;
  v_derniere integer;
  v_defaut text;
  v_maintenant timestamptz := now();
  v_precedente text;
  v_empreinte text;
  v_debit numeric;
  v_credit numeric;
  v_ecritures integer;
  v_lignes integer;
  v_hors text;
  v_ecart numeric;
  v_reportes integer;
  v_bascule boolean;
  v_mouvement record;
  v_numero text;
  v_encaissement record;
  v_vente record;
begin
  select cabinet_id, mode_comptable into v_cabinet, v_mode from public.dossiers where id = p_dossier_id;
  if not found or not public.est_chef_du_cabinet(v_cabinet) then
    raise exception 'Seul le chef du cabinet valide un exercice.' using errcode = '42501';
  end if;
  if p_annee is null or p_annee < 2000 or p_annee > 2100 then
    raise exception 'Exercice invalide.' using errcode = '22023';
  end if;
  -- Exclusif : aucune écriture ni aucune source ne change pendant la validation (voir `cle_validation`).
  perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));
  v_debut := make_date(p_annee, 1, 1);
  v_fin := make_date(p_annee, 12, 31);
  -- L'année se lit à Paris, comme dans l'application : la nuit du 1er janvier ne doit pas les faire diverger.
  if p_annee >= extract(year from (now() at time zone 'Europe/Paris'))::integer then
    raise exception 'L''exercice % n''est pas terminé : il se valide une fois clos.', p_annee using errcode = '22023';
  end if;
  if exists (select 1 from public.exercices_valides where dossier_id = p_dossier_id and annee >= p_annee) then
    raise exception 'L''exercice % est déjà validé, ou un exercice postérieur l''est.', p_annee using errcode = '23514';
  end if;
  -- Après le premier, chaque exercice suit le précédent : un exercice sauté serait figé par la frontière sans
  -- qu'aucune validation ne l'ait regardé.
  select max(annee) into v_derniere from public.exercices_valides where dossier_id = p_dossier_id;
  if v_derniere is not null and p_annee <> v_derniere + 1 then
    raise exception 'L''exercice % n''est pas validé : les exercices se valident dans l''ordre.', v_derniere + 1
      using errcode = '23514';
  end if;
  select min(date) into v_ouverture from public.a_nouveaux where dossier_id = p_dossier_id;
  if v_ouverture is not null and v_fin < v_ouverture then
    raise exception 'L''exercice % précède l''ouverture du dossier : il est dans les comptes repris.', p_annee
      using errcode = '22023';
  end if;
  -- Les à-nouveaux ouvrent le premier exercice du dossier, qui se valide avant tout autre : sans quoi la frontière
  -- les figerait sans qu'aucun exercice validé ne les porte.
  if v_ouverture is not null and v_ouverture < v_debut and not exists (
    select 1 from public.exercices_valides
     where dossier_id = p_dossier_id and annee = extract(year from v_ouverture)::integer
  ) then
    raise exception 'L''exercice % porte les à-nouveaux du dossier : il se valide d''abord.',
      extract(year from v_ouverture)::integer using errcode = '23514';
  end if;
  select min(extract(year from date))::integer into v_anterieur
    from public.ecritures_brouillon where dossier_id = p_dossier_id and date < v_debut and statut = 'proposee';
  if v_anterieur is not null then
    -- Leur exercice ne se validera jamais : il précède l'ouverture, et les comptes repris portent cette période.
    if v_ouverture is not null and v_anterieur < extract(year from v_ouverture)::integer then
      raise exception 'Des écritures antérieures à l''ouverture du dossier ne sont pas validées : cette période est dans les comptes repris, les retirer ou les redater avant la validation.'
        using errcode = '23514';
    end if;
    raise exception 'L''exercice % porte des écritures qui ne sont pas validées : les exercices se valident dans l''ordre.',
      v_anterieur using errcode = '23514';
  end if;
  -- LES VENTES FACTURÉES D'UN DOSSIER BASCULÉ (étape VF7b ; conception de VF7, § 3 c) : trois manques de G5 retiennent la
  -- validation, sous leur nom, avant la numérotation — un mouvement réservé, un virement ou un prélèvement sans son
  -- mouvement, une vente facturée qui n'est pas écrite à jour. Un dossier qui n'a pas basculé n'en porte aucun.
  v_bascule := coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = p_dossier_id), false);
  -- Un mouvement RÉSERVÉ (G2), daté jusqu'au 31 décembre : libre, et justifié par l'encaissement vivant d'une facture
  -- source. Il est à traiter : dit avant les mouvements à traiter, il l'est sous son nom, car il ne se classe que par ses
  -- encaissements — un débit, par ses contre-passations. La facture est celle que la garde des mouvements nomme.
  if v_bascule then
    select l.id, l.date, l.montant into v_mouvement
      from public.lignes_bancaires l
     where l.dossier_id = p_dossier_id and l.date <= v_fin and public.mouvement_libre(l)
       and exists (select 1 from public.encaissements_factures e
                     join public.factures_emises f on f.id = e.facture_id
                    where e.ligne_bancaire_id = l.id and e.retire_le is null and f.source_de_la_vente
                      and public.encaissement_justifie_son_mouvement(e.id))
     order by l.date, l.id
     limit 1;
    if found then
      select f.numero into v_numero
        from public.encaissements_factures e
        join public.factures_emises f on f.id = e.facture_id
       where e.ligne_bancaire_id = v_mouvement.id and e.retire_le is null and f.source_de_la_vente
         and public.encaissement_justifie_son_mouvement(e.id)
       order by e.cree_le, e.id
       limit 1;
      if v_mouvement.montant >= 0 then
        raise exception 'L''exercice % porte un mouvement du % réservé à l''encaissement de la facture % : le classer par ses encaissements avant la validation.',
          extract(year from v_mouvement.date)::integer, to_char(v_mouvement.date, 'DD/MM/YYYY'), v_numero using errcode = '23514';
      end if;
      raise exception 'L''exercice % porte un mouvement du % réservé à la contre-passation d''un encaissement de la facture % : le classer par ses contre-passations avant la validation.',
        extract(year from v_mouvement.date)::integer, to_char(v_mouvement.date, 'DD/MM/YYYY'), v_numero using errcode = '23514';
    end if;
  end if;
  -- Un mouvement daté d'un exercice validé ne change plus (migration `sources_figees_par_la_validation`) : encore
  -- à traiter, il le resterait.
  select min(extract(year from date))::integer into v_a_traiter
    from public.lignes_bancaires where dossier_id = p_dossier_id and date <= v_fin and statut = 'non_rapprochee';
  if v_a_traiter is not null then
    if v_ouverture is not null and v_a_traiter < extract(year from v_ouverture)::integer then
      raise exception 'Des mouvements bancaires antérieurs à l''ouverture du dossier restent à traiter : les ignorer avant la validation.'
        using errcode = '23514';
    end if;
    raise exception 'L''exercice % porte des mouvements bancaires à traiter : ils se traitent avant la validation.', v_a_traiter
      using errcode = '23514';
  end if;
  if v_bascule then
    -- Un encaissement vivant d'une facture source — ni retiré, ni contre-passation, ni défait par une contre-passation
    -- sans mouvement —, par virement ou par prélèvement, daté jusqu'au 31 décembre, qui ne cite aucun mouvement : encaissé
    -- à l'inscription au crédit, son mouvement est de son exercice ; il manque au relevé, ou n'y est pas rattaché. Un
    -- chèque, une carte ou un effet sans mouvement au 31 décembre est un en-cours (le 511, EC3-Q7) : il ne retient pas.
    select e.date_encaissement, e.moyen, f.numero into v_encaissement
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
     where e.dossier_id = p_dossier_id and f.source_de_la_vente and e.retire_le is null and e.annule_id is null
       and e.ligne_bancaire_id is null and e.moyen in ('virement', 'prelevement') and e.date_encaissement <= v_fin
       and public.encaissement_justifie_son_mouvement(e.id)
     order by e.date_encaissement, e.cree_le, e.id
     limit 1;
    if found then
      raise exception 'L''exercice % porte un encaissement de la facture % par % du %, sans son mouvement : il manque au relevé, ou n''y est pas rattaché — le rattacher avant la validation.',
        extract(year from v_encaissement.date_encaissement)::integer, v_encaissement.numero,
        case v_encaissement.moyen when 'virement' then 'virement' else 'prélèvement' end,
        to_char(v_encaissement.date_encaissement, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    -- Une source dont ce qui s'écrit entre la frontière et le 31 décembre n'est pas EXACTEMENT ce que le brouillon
    -- propose, ou qui ne s'écrit pas quand sa date tombe dans cette période : la première, dans l'ordre de
    -- `ventes_facturees_de_l_exercice` — la période part de la frontière, et un premier exercice validé ne fige pas un
    -- manque d'avant lui.
    select v.* into v_vente from public.ventes_facturees_de_l_exercice(p_dossier_id, p_annee) v limit 1;
    if found then
      if v_vente.etat = 'a_ecrire' then
        raise exception 'L''exercice % porte une vente facturée qui n''est pas écrite : % — l''écrire avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      if v_vente.etat = 'a_reecrire' then
        raise exception 'L''exercice % porte une vente facturée dont l''écriture proposée n''est plus celle que sa source commande : % — la réécrire avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      if v_vente.etat = 'a_retirer' then
        raise exception 'L''exercice % porte l''écriture proposée d''une vente facturée qui n''a plus rien à écrire : % — la retirer avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      raise exception 'L''exercice % porte une vente facturée qui ne s''écrit pas : % — lever ce qui la retient avant la validation.',
        extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
    end if;
  end if;
  if (v_mode = 'tresorerie') <> (jsonb_typeof(p_declaration) is not distinct from 'object') then
    raise exception '%', case when v_mode = 'tresorerie' then 'La 2035 à valider manque.'
      else 'Un dossier tenu en engagement n''a pas de 2035.' end using errcode = '22023';
  end if;
  if jsonb_typeof(p_lignes) is distinct from 'array' then
    raise exception 'La numérotation proposée est illisible.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_a_nouveaux) is distinct from 'array' then
    raise exception 'Les libellés proposés des à-nouveaux sont illisibles.' using errcode = '22023';
  end if;

  with l as (
    select * from jsonb_to_recordset(p_lignes) as x(id uuid, journal text, numero integer, piece_ref text,
      piece_date date, compte_lib text, comp_aux_num text, comp_aux_lib text)
  ), e as (
    select id, date, compte, montant, sens from public.ecritures_brouillon
    where dossier_id = p_dossier_id and date between v_debut and v_fin
  ), j as (
    select l.*, e.date, e.compte, e.montant, e.sens from l join e on e.id = l.id
  ), groupes as (
    select journal, numero, min(date) as premiere,
      sum(case when sens = 'debit' then montant else -montant end) as solde,
      count(distinct piece_ref) as refs, count(distinct piece_date) as dates, count(distinct date) as jours
    from j group by journal, numero
  ), journaux as (
    select journal, min(numero) as premier, max(numero) as dernier, count(*) as nb from groupes group by journal
  ), an_l as (
    select * from jsonb_to_recordset(p_a_nouveaux) as x(id uuid, compte_lib text, ecriture_lib text)
  ), an_e as (
    -- L'ouverture de l'exercice : la balance reprise, ou les soldes reportés de l'exercice validé qui le précède.
    select id, compte from public.a_nouveaux where dossier_id = p_dossier_id and date between v_debut and v_fin
    union all
    select id, compte from public.soldes_reportes where dossier_id = p_dossier_id and date = v_debut
  ), an_j as (
    select an_l.*, an_e.compte from an_l join an_e on an_e.id = an_l.id
  )
  select
    (select count(*) from e), (select count(*) from l), (select count(distinct id) from l), (select count(*) from j),
    (select count(*) from an_e), (select count(*) from an_l), (select count(distinct id) from an_l),
    (select count(*) from an_j),
    case
      when exists (select 1 from l where journal is null or journal not in ('AC', 'VE', 'BQ', 'OD')
          or numero is null or numero < 1 or coalesce(btrim(piece_ref), '') = '' or piece_date is null
          or coalesce(btrim(compte_lib), '') = '' or (comp_aux_num is null) <> (comp_aux_lib is null)
          or (comp_aux_num is not null and (btrim(comp_aux_num) = '' or btrim(comp_aux_lib) = '')))
        then 'Une ligne de la numérotation proposée est incomplète.'
      when exists (select 1 from an_l where coalesce(btrim(compte_lib), '') = '' or coalesce(btrim(ecriture_lib), '') = '')
        then 'Un à-nouveau proposé est incomplet.'
      when exists (select 1 from journaux where premier <> 1 or dernier <> nb)
        then 'Les numéros d''un journal ne se suivent pas.'
      when exists (select 1 from (
          select premiere, lag(premiere) over (partition by journal order by numero) as avant from groupes) z
          where avant > premiere)
        then 'Les numéros d''un journal ne suivent pas l''ordre des dates.'
      when exists (select 1 from groupes where solde <> 0)
        then 'Une écriture n''est pas équilibrée au centime.'
      when exists (select 1 from groupes where refs <> 1 or dates <> 1)
        then 'Les lignes d''une même écriture ne portent pas la même pièce.'
      when exists (select 1 from groupes where jours <> 1)
        then 'Les lignes d''une même écriture ne portent pas la même date.'
      when exists (select 1 from (select compte, compte_lib from j union all select compte, compte_lib from an_j) c
          group by compte having count(distinct compte_lib) > 1)
        then 'Un même compte porte deux libellés.'
      when exists (select 1 from j where comp_aux_num is not null group by comp_aux_num having count(distinct comp_aux_lib) > 1)
        then 'Un même compte auxiliaire porte deux libellés.'
    end
  into v_attendues, v_recues, v_distinctes, v_jointes, v_an_attendus, v_an_recus, v_an_distincts, v_an_joints, v_defaut;

  if v_recues <> v_distinctes or v_recues <> v_attendues or v_jointes <> v_recues then
    raise exception 'La numérotation proposée ne couvre pas exactement les % écritures de l''exercice %.', v_attendues, p_annee
      using errcode = '22023';
  end if;
  if v_an_recus <> v_an_distincts or v_an_recus <> v_an_attendus or v_an_joints <> v_an_recus then
    raise exception 'Les libellés proposés ne couvrent pas exactement les % à-nouveaux de l''exercice %.', v_an_attendus, p_annee
      using errcode = '22023';
  end if;
  if v_defaut is not null then
    raise exception '%', v_defaut using errcode = '22023';
  end if;

  -- Les déclencheurs d'intangibilité ne laissent passer « validée » — et les libellés des soldes reportés — qu'à cette
  -- fonction, pour ce dossier.
  perform set_config('jd.validation_exercice', p_dossier_id::text, true);
  update public.ecritures_brouillon e
     set statut = 'validee', valide_le = v_maintenant, journal_code = l.journal, numero_ecriture = l.numero,
         piece_ref = l.piece_ref, piece_date = l.piece_date, compte_lib = l.compte_lib,
         comp_aux_num = l.comp_aux_num, comp_aux_lib = l.comp_aux_lib
    from jsonb_to_recordset(p_lignes) as l(id uuid, journal text, numero integer, piece_ref text, piece_date date,
      compte_lib text, comp_aux_num text, comp_aux_lib text)
   where e.id = l.id and e.dossier_id = p_dossier_id;
  update public.soldes_reportes s set compte_lib = l.compte_lib, ecriture_lib = l.ecriture_lib
    from jsonb_to_recordset(p_a_nouveaux) as l(id uuid, compte_lib text, ecriture_lib text)
   where s.id = l.id and s.dossier_id = p_dossier_id;
  perform set_config('jd.validation_exercice', '', true);
  update public.a_nouveaux a set compte_lib = l.compte_lib, ecriture_lib = l.ecriture_lib
    from jsonb_to_recordset(p_a_nouveaux) as l(id uuid, compte_lib text, ecriture_lib text)
   where a.id = l.id and a.dossier_id = p_dossier_id;

  if exists (select 1 from public.ecritures_brouillon where dossier_id = p_dossier_id and date <= v_fin and statut = 'proposee') then
    raise exception 'Une écriture de l''exercice % n''a pas été validée.', p_annee using errcode = '23514';
  end if;

  -- Les soldes de fin de l'exercice, qui ouvriront le suivant : aucun compte hors des classes 1 à 7 ne doit porter de
  -- solde — il ne se reporterait pas —, et ils s'équilibrent, à-nouveaux compris.
  select string_agg(compte, ', ' order by compte) filter (where compte !~ '^[1-5][0-9]{2,}$'),
         coalesce(sum(case when sens = 'debit' then montant else -montant end), 0)
    into v_hors, v_ecart
    from public.soldes_a_reporter(p_dossier_id, p_annee);
  if v_hors is not null then
    raise exception 'L''exercice % se clôt sur le solde de comptes qui ne sont ni de bilan ni de résultat (%) : il ne se reporte pas, corriger leurs écritures avant la validation.',
      p_annee, v_hors using errcode = '23514';
  end if;
  if v_ecart <> 0 then
    raise exception 'Les soldes de l''exercice % ne s''équilibrent pas, à-nouveaux compris : l''ouverture de l''exercice suivant ne peut pas s''écrire.',
      p_annee using errcode = '23514';
  end if;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0), coalesce(sum(montant) filter (where sens = 'credit'), 0),
         count(distinct (journal_code, numero_ecriture)), count(*)
    into v_debit, v_credit, v_ecritures, v_lignes
    from public.ecritures_brouillon
   where dossier_id = p_dossier_id and statut = 'validee' and date between v_debut and v_fin;
  select empreinte into v_precedente from public.exercices_valides
   where dossier_id = p_dossier_id and annee < p_annee order by annee desc limit 1;
  v_empreinte := public.empreinte_exercice(p_dossier_id, p_annee, v_precedente);

  insert into public.exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures,
    total_debit, total_credit, empreinte_precedente, empreinte, declaration)
  values (p_dossier_id, p_annee, v_maintenant, auth.uid(), v_mode, v_lignes, v_ecritures, v_debit, v_credit,
    v_precedente, v_empreinte, case when v_mode = 'tresorerie' then p_declaration end);

  -- L'ouverture de l'exercice suivant, dans le même clic : ses soldes de fin, datés du 1er janvier suivant, chacun
  -- portant l'empreinte de l'exercice dont il vient.
  perform set_config('jd.validation_exercice', p_dossier_id::text, true);
  insert into public.soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
  select p_dossier_id, make_date(p_annee + 1, 1, 1), r.compte, r.libelle, r.sens, r.montant,
         format('Exercice %s validé', p_annee), v_empreinte
    from public.soldes_a_reporter(p_dossier_id, p_annee) r;
  get diagnostics v_reportes = row_count;
  perform set_config('jd.validation_exercice', '', true);

  return jsonb_build_object('annee', p_annee, 'lignes', v_lignes, 'ecritures', v_ecritures, 'a_nouveaux', v_an_attendus,
    'reportes', v_reportes, 'empreinte', v_empreinte, 'valide_le', v_maintenant);
end;
$$;

-- ══ 4. Les droits et les commentaires ══════════
revoke execute on function public.ecritures_attendues_de_la_periode(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.ventes_facturees_de_l_exercice(uuid, integer) from public, anon, authenticated;

comment on function public.ecritures_attendues_de_la_periode(uuid, date, date) is
  'Ce que chaque source de vente facturée d''une période écrit — son motif, son détail, ses lignes —, recomposé d''un bloc comme ecriture_attendue_vente_facturee le recompose source par source (la règle du cumul de calcul_vente_facturee comprise) : les sources dont une date tombe après la frontière (exclue) et jusqu''à la fin, et celles dont le brouillon y propose une ligne. Lue par ventes_facturees_de_l_exercice.';
comment on function public.ventes_facturees_de_l_exercice(uuid, integer) is
  'Les sources de vente facturée d''un dossier basculé en défaut entre la frontière et le 31 décembre de l''exercice — à écrire, à réécrire, à retirer, ou qui ne s''écrivent pas —, dans l''ordre où valider_exercice nomme la première. Rien pour un dossier qui n''a pas basculé.';
comment on function public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb) is
  'Valide un exercice terminé : vérifie la numérotation proposée par l''application, fige ses écritures, enregistre l''exercice et écrit l''ouverture du suivant (soldes_reportes) ; pour un dossier basculé, refuse aussi un mouvement réservé à des encaissements de factures, un virement ou un prélèvement sans son mouvement, et une vente facturée qui n''est pas écrite à jour. Chef du cabinet seul.';
