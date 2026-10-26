-- L'INDEX DES AVOIRS D'UNE FACTURE (chantier EC-Q3, ligne 28.65 ; VF8E-Q1, écrite sur la recommandation, le
-- 26/10/2026). Le récit : HISTORIQUE.md, « « MA SIMULATION » REÇOIT SES VENTES FACTURÉES ».
--
-- POURQUOI. La règle du cumul (`calcul_vente_facturee`, étape VF4b) cherche les avoirs d'une facture source par leur
-- facture d'origine (`facture_origine_id`), pour chaque facture et, à chaque encaissement, pour le reste qu'il laisse ;
-- la colonne n'a pas d'index, et chaque recherche parcourt toutes les factures du dossier. Le temps croît donc comme
-- les factures de l'année fois celles du dossier : sur la réplique, la simulation des ventes facturées (VF8e) d'un
-- dossier de 4 700 factures par an sur trois ans dépassait, pour l'année la plus chargée, les huit secondes du rôle
-- `authenticated`. Le même coût pèse sur l'écriture d'une vente facturée et sur la validation d'un exercice, qui
-- recomposent par la même règle, et sur la suppression d'une facture, dont la clé étrangère de ses avoirs fait chercher
-- les avoirs.
--
-- CE QU'ELLE POSE : un index, et rien d'autre — partiel, sur les seules lignes qui portent une facture d'origine (les
-- avoirs) : une recherche par `facture_origine_id = …` l'emprunte, puisqu'elle ne trouve jamais une ligne nulle. Aucune
-- table, colonne, contrainte, policy, fonction ni aucun droit ; aucune donnée écrite. `create index` sans
-- `concurrently` : la migration se joue dans une transaction, et la table n'est fermée aux écritures que le temps de
-- construire l'index.
--
-- NEUTRE : un index ne change que le chemin d'une lecture, jamais ce qu'elle rend ; les essais qui touchent
-- `factures_emises`, rejoués avec lui, rendent les mêmes lignes.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni
-- instruction qui en retire. Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : après `insertion_des_encaissements` (VF5H2-Q1), avant `simulation_des_ventes_facturees` (VF8e),
-- qui ne la suppose pas ; le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Une seule fois : aucun index de `factures_emises` ne commence déjà par `facture_origine_id` ══════════
do $$
begin
  if exists (select 1 from pg_index i
               join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
              where i.indrelid = 'public.factures_emises'::regclass and a.attname = 'facture_origine_id') then
    raise exception 'Un index de public.factures_emises commence déjà par facture_origine_id : la migration index_des_avoirs ne le double pas.';
  end if;
end
$$;

-- ══ 1. L'index ══════════
create index factures_emises_facture_origine_idx on public.factures_emises (facture_origine_id)
  where facture_origine_id is not null;

comment on index public.factures_emises_facture_origine_idx is
  'Les avoirs d''une facture, par leur facture d''origine (chantier EC-Q3, VF8E-Q1) : la règle du cumul (calcul_vente_facturee) les cherche pour chaque facture et à chaque encaissement, la clé étrangère à la suppression d''une facture.';
