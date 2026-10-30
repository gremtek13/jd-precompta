-- LA CAISSE D'UN DOSSIER BNC, EN BASE (ligne 26.6, étape C1 ; MVP-D2). La conception : HISTORIQUE.md, « LA CAISSE D'UN
-- DOSSIER BNC : LA CONCEPTION — MVP-D2 (LIGNE 26.6) », § 3 à 5 et § 8, n° 1, revue par « LA CAISSE : LA SAISIE DU
-- PRATICIEN ET LA PIÈCE RÉGLÉE PAR LA CAISSE — LA CONCEPTION REPRISE (CAISSE-Q1 ET Q4) », § 5 et § 9, n° 1 ; les
-- réponses du cabinet CAISSE-Q1 à Q4 (28/10/2026, midi) et CAISSE2-Q1 à Q4 (28/10/2026, soir). Préparée sous une
-- version PROVISOIRE, postérieure à celles des deux migrations préparées d'A7 (`mentions_figees`,
-- `iban_hors_des_parametres`) : elle ne touche à rien de ce qu'elles touchent, et s'applique avant elles, entre elles
-- ou après elles.
--
-- CE QU'ELLE POSE.
--   - `operations_caisse`, une table du dossier : la recette en espèces sans facture de l'application (le TOTAL d'un
--     jour, pour une nature et un taux, tel que le brouillard du praticien le porte), l'apport et le prélèvement de
--     l'exploitant, et, dès maintenant pour qu'aucune contrainte ne se remplace ensuite, le paiement d'une pièce par la
--     caisse (CAISSE-Q4, une migration à venir), sa pièce (`piece_id`, une clé qui garde la pièce), l'origine de la
--     saisie (« cabinet » ou « client », posée par la base, CAISSE-Q1) et l'opération qu'elle remplace (`remplace_id`).
--     AUCUNE colonne de texte : le détail, recette par recette, reste au registre du praticien, sous le secret
--     (BOI-BNC-DECLA-10-20, § 280 ; la décision du cabinet du 24/09/2026), et le libellé de l'écriture se compose ici.
--     Lue par le cabinet seul ; insérée par les fonctions et, en direct, par la restauration (le
--     super-administrateur) ; rien ne se supprime : une opération se retire, avec son écriture (une migration à coller,
--     C1b).
--   - `ecritures_brouillon.operation_caisse_id`, la source d'une écriture de la caisse, en cascade, et sa contrainte :
--     aucune autre source, la pièce admise (la contrepartie d'un paiement par la caisse, CAISSE-Q4).
--   - `enregistrer_operation_caisse` et `enregistrer_operations_de_caisse` (la saisie d'un mois, tout ou rien) :
--     l'accès annoncé avant toute lecture (`qui_ecrit_la_caisse`, au cabinet seul ici), les refus dans l'ordre que le
--     module redira sous les mêmes mots, l'écriture composée par l'application RECOMPOSÉE en centimes entiers et
--     comparée en multiensemble, puis écrite d'un tenant avec l'opération.
--   - LA CAISSE JAMAIS NÉGATIVE (PCG, art. 1215-53 : « Son solde est soit débiteur soit nul. ») :
--     `premier_jour_negatif_de_la_caisse` rejoue la caisse jour par jour, et des déclencheurs de CONTRAINTE, différés à
--     la fin de la transaction, l'appellent, sous le verrou de la caisse du dossier, quand l'un de ses flux change —
--     une opération, un mouvement du relevé classé sur le compte de la caisse, un encaissement en espèces d'une facture
--     source, l'ouverture du compte de la caisse.
--
-- LA CAISSE LUE, jour par jour, le solde à la fin de chaque jour : l'ouverture (les à-nouveaux sur le compte de la
-- caisse du plan) ; les opérations non retirées (une recette, un apport, un paiement : leur montant signé ; un
-- prélèvement : son opposé) ; les mouvements du relevé classés sur le compte de la caisse (un crédit, le versement
-- d'espèces en banque, la vide ; un débit, des espèces retirées pour elle, la remplit) ; les encaissements en espèces
-- des factures SOURCES sans mouvement, et leurs contre-passations sans mouvement — ce que la composition des ventes
-- facturées écrit au compte de la caisse (EC3-Q7) pour des espèces qui n'ont pas rejoint la banque par leur propre
-- mouvement.
--
-- CE QU'ELLE TOUCHE D'EXISTANT : une colonne nulle sur `ecritures_brouillon`, sa clé, sa contrainte et son index ; des
-- déclencheurs de contrainte sur `lignes_bancaires`, `encaissements_factures` et `a_nouveaux`, trois par table, un par
-- événement, que leur condition ne met en file que pour une ligne qui peut être de la caisse — un mouvement ou un
-- à-nouveau sous la racine 53, un encaissement en espèces ou une contre-passation : une autre ligne ne laisse rien en
-- attente, et une transaction qui l'écrit puis modifie sa table (`alter table`) passe comme hier. Ils ne jugent que les
-- lignes de la caisse — une ligne qui n'y entre ni avant ni après sort aussitôt, et ce qui ne fait qu'ajouter à la
-- caisse ne se juge pas. Aucune fonction d'hier n'est remplacée ; aucune donnée n'est lue ni écrite d'avance. NEUTRE
-- AUJOURD'HUI (relevé en production le 29/10/2026, des comptes) : aucun encaissement, aucun mouvement classé sur un
-- compte de bilan, aucun à-nouveau ni aucune écriture sur un compte 53, aucun exercice validé.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni
-- instruction qui en retire. Le mot n'y paraît que dans les clés (`on delete cascade`, `on delete restrict`), les
-- événements des déclencheurs et `tg_op = 'DELETE'`, que les migrations d'hier ont passés sans confirmation. Aucune
-- barre oblique inverse. Elle s'applique par l'outil ; son retour arrière, qui retire la table, la colonne et les
-- fonctions, est donné à part, et ne s'applique que sur l'accord du cabinet.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT. Le fichier vit dans `supabase/preparees/`, et non dans `supabase/schema/` : il
-- crée une TABLE, que les tests qui confrontent le plan de sauvegarde à l'export (sauvegardeTables,
-- sauvegardeRelations) exigeraient au plan du jour — or la lire avant la migration ferait échouer toute sauvegarde (la
-- règle des drapeaux `*_PREVU(E)S`, comme pour les devis, préparés hors de l'export). Le jour de son application, il
-- entre dans l'export sous la version que porte sa ligne d'historique, texte inchangé, avec le socle régénéré (sa
-- colonne d'`ecritures_brouillon`, sa clé, sa contrainte, son index) et la sauvegarde de l'étape C2, son drapeau levé.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application, une table, une colonne ou une fonction déjà là, et une fonction supposée qui ne
-- serait plus celle que la migration appelle — à l'empreinte de son corps, les retours chariot d'un collage écartés,
-- relue en production le 29/10/2026 — ; et une base où manquerait ce que la caisse lit : le rôle `caisse` du plan, de
-- racine 53 (la condition des déclencheurs de la caisse la suppose), et les colonnes des quatre tables dont elle suit
-- les flux.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.operations_caisse') is not null then
    raise exception 'La migration caisse est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
              and a.attname = 'operation_caisse_id' and not a.attisdropped) then
    raise exception 'La colonne ecritures_brouillon.operation_caisse_id existe déjà : cette base n''est pas celle que la migration suppose.';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('qui_ecrit_la_caisse', 'premier_jour_negatif_de_la_caisse', 'texte_caisse_negative',
                                'garder_operation_caisse', 'garder_ecriture_de_caisse', 'garder_la_caisse',
                                'enregistrer_operation_caisse', 'enregistrer_operations_de_caisse')) then
    raise exception 'Une fonction de la caisse existe déjà : cette base n''est pas celle que la migration suppose.';
  end if;
  for v_attendue in select * from (values
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('cle_validation', 'public.cle_validation(uuid)', 'bcbb03363036aa6aa037c0b829e3382f'),
      ('frontiere_validation', 'public.frontiere_validation(uuid)', '24a04846471ec5e8cdbae6f3b9f4a2e8'),
      ('exercice_fige', 'public.exercice_fige(uuid, integer)', 'b70cbdd4a870f5e17e8e4c6851506bdc'),
      ('compte_du_role', 'public.compte_du_role(uuid, text)', '6108ab75d148aa2800484b89bb112c70'),
      ('compte_du_dirigeant', 'public.compte_du_dirigeant(uuid)', 'c02c751713f2d759745267145e9e6b40'),
      ('tva_incluse', 'public.tva_incluse(numeric, numeric)', '04a27c1247f135cd9fd2903e501b5cbe')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p
     where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que la caisse appelle (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.nom, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  if not exists (select 1 from public.roles_comptables r where r.role = 'caisse' and r.racines = array['53'])
     or not exists (select 1 from public.roles_comptables r where r.role = 'exploitant')
     or not exists (select 1 from public.roles_comptables r where r.role = 'tva_collectee') then
    raise exception 'Le plan comptable des rôles n''a pas le rôle « caisse » de racine 53, ou celui de l''exploitant, ou celui de la TVA collectée : la caisse n''a pas de compte.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped and (a.attrelid, a.attname) in (
     ('public.lignes_bancaires'::regclass, 'compte_bilan'), ('public.lignes_bancaires'::regclass, 'created_at'),
     ('public.encaissements_factures'::regclass, 'moyen'), ('public.encaissements_factures'::regclass, 'annule_id'),
     ('public.encaissements_factures'::regclass, 'ligne_bancaire_id'), ('public.encaissements_factures'::regclass, 'retire_le'),
     ('public.encaissements_factures'::regclass, 'cree_le'), ('public.factures_emises'::regclass, 'source_de_la_vente'),
     ('public.a_nouveaux'::regclass, 'compte'), ('public.a_nouveaux'::regclass, 'created_at'),
     ('public.dossiers'::regclass, 'mode_comptable'), ('public.dossiers'::regclass, 'assujetti_tva'));
  if v_nombre <> 12 then
    raise exception 'Une colonne que la caisse lit manque (% sur 12) : cette base n''est pas celle que la migration suppose.', v_nombre;
  end if;
end
$garde$;

-- ══ 1. La table des opérations de la caisse ══════════
-- Le montant, au centime : SIGNÉ pour une recette (négatif : des espèces rendues) et pour un paiement (comme le
-- relevé : négatif pour une sortie) ; positif pour un apport ou un prélèvement. La nature d'une recette est une
-- catégorie de produit du dossier ou commune ; son taux, pour un dossier assujetti seulement, l'un de ceux du relevé.
-- L'ensemble des encaissements en espèces de factures sources que la saisie d'une recette a reconnus pour son jour
-- (CAISSE-Q2, (A)) : une liste d'identifiants, vide quand il n'y en avait aucun. Les auteurs, sans clé vers
-- `auth.users`, comme les encaissements. Les clés vers la pièce et vers l'opération remplacée bloquent la suppression
-- de ce qu'elles citent : une pièce qu'un paiement cite ne se supprime plus (la piste d'audit) ; la cascade du dossier
-- emporte tout.
create table public.operations_caisse (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  genre text not null,
  date date not null,
  montant numeric not null,
  categorie_id uuid references public.categories(id),
  taux_tva numeric(4,2),
  encaissements_du_jour uuid[],
  piece_id uuid references public.pieces(id) on delete restrict,
  origine text not null,
  remplace_id uuid references public.operations_caisse(id),
  cree_le timestamp with time zone not null default now(),
  cree_par uuid,
  retire_le timestamp with time zone,
  retire_par uuid,
  constraint operations_caisse_genre check (genre in ('recette', 'apport', 'prelevement', 'paiement')),
  constraint operations_caisse_date check (date >= date '2000-01-01'),
  constraint operations_caisse_montant check (montant <> 0 and montant = round(montant, 2) and abs(montant) < 10000000000000),
  constraint operations_caisse_montant_positif check (genre not in ('apport', 'prelevement') or montant > 0),
  constraint operations_caisse_categorie check ((genre = 'recette') = (categorie_id is not null)),
  constraint operations_caisse_taux check (taux_tva is null or (genre = 'recette' and taux_tva in (0, 5.5, 8.5, 10, 20))),
  constraint operations_caisse_encaissements_du_jour check ((genre = 'recette') = (encaissements_du_jour is not null)
    and (encaissements_du_jour is null or array_position(encaissements_du_jour, null) is null)),
  constraint operations_caisse_piece check ((genre = 'paiement') = (piece_id is not null)),
  constraint operations_caisse_origine check (origine in ('cabinet', 'client')),
  constraint operations_caisse_remplace check (remplace_id <> id),
  constraint operations_caisse_un_remplacement unique (remplace_id),
  constraint operations_caisse_retrait check (retire_par is null or retire_le is not null)
);

create index operations_caisse_dossier_date on public.operations_caisse (dossier_id, date);
create index operations_caisse_piece on public.operations_caisse (piece_id) where piece_id is not null;
create index operations_caisse_categorie on public.operations_caisse (categorie_id) where categorie_id is not null;

alter table public.operations_caisse enable row level security;

-- Le cabinet du dossier lit ; personne n'écrit en direct, la restauration exceptée (le super-administrateur, sous la
-- garde de la table). Le client n'en lit rien (CAISSE-Q1, (B) : sa lecture et ses gestes viendront avec son droit, une
-- migration présentée au cabinet avant d'être appliquée).
create policy operations_caisse_lecture on public.operations_caisse
  for select to authenticated
  using (public.admin_du_dossier(dossier_id));

create policy operations_caisse_restauration on public.operations_caisse
  for insert to authenticated
  with check (public.is_super_admin());

comment on table public.operations_caisse is
  'La caisse d''un dossier (ligne 26.6, MVP-D2) : la recette en espèces sans facture de l''application (le total d''un jour, pour une nature et un taux), l''apport et le prélèvement de l''exploitant, le paiement d''une pièce par la caisse. Aucune identité, aucun texte libre : le détail reste au registre du praticien. Écrite avec son écriture par enregistrer_operation_caisse et enregistrer_operations_de_caisse, retirée (jamais supprimée) par sa fonction, réinsérée par la restauration ; jamais négative (premier_jour_negatif_de_la_caisse).';

-- ══ 2. La source d'une écriture de la caisse ══════════
-- En cascade, comme l'échéance d'un paiement personnel : l'écriture n'existe que par son opération. Aucune autre source
-- — ni mouvement, ni bien, ni véhicule, ni déclaration, ni cotisation, ni encaissement, ni facture —, la pièce admise :
-- la contrepartie de son paiement par la caisse (CAISSE-Q4), que la garde de l'écriture jugera alors.
alter table public.ecritures_brouillon
  add column operation_caisse_id uuid references public.operations_caisse(id) on delete cascade;

alter table public.ecritures_brouillon
  add constraint ecritures_brouillon_caisse_sans_autre_source check (
    operation_caisse_id is null
    or (ligne_bancaire_id is null and immobilisation_id is null and vehicule_id is null and declaration_tva_id is null
        and cotisation_id is null and encaissement_id is null and facture_id is null));

create index ecritures_brouillon_operation_caisse_id_idx on public.ecritures_brouillon (operation_caisse_id)
  where operation_caisse_id is not null;

-- ══ 3. Qui écrit la caisse ══════════
-- « cabinet » pour le cabinet du dossier (`admin_du_dossier`, le super-administrateur compris) ; sinon le refus, un
-- dossier qui n'existe pas sous les mêmes mots. La migration du droit du client (CAISSE-Q1, (B) ; CAISSE2-Q3, (B))
-- remplacera ce corps seul pour rendre « client » à un accès « Caisse » d'un dossier exonéré ou en franchise : les
-- fonctions d'écriture n'auront pas à changer une seconde fois. Aucun rôle de l'API ne l'exécute.
create function public.qui_ecrit_la_caisse(p_dossier_id uuid) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_dossier_id is not null and exists (select 1 from public.dossiers d where d.id = p_dossier_id)
     and public.admin_du_dossier(p_dossier_id) then
    return 'cabinet';
  end if;
  raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
end
$$;

-- ══ 4. La caisse lue, et son premier jour négatif ══════════
-- Le solde à la fin de chaque jour qui porte un flux, l'ouverture comprise ; rend le premier jour où il est négatif, et
-- ce solde, ou rien. Les comptes viennent du plan, jamais en dur. Aux droits du propriétaire : elle lit toute la caisse
-- du dossier, quel que soit l'appelant de ce qui la juge ; aucun rôle de l'API ne l'exécute.
create function public.premier_jour_negatif_de_la_caisse(p_dossier_id uuid)
returns table (jour date, solde numeric)
language sql
stable
security definer
set search_path = public
as $$
  with caisse as (
    select public.compte_du_role(p_dossier_id, 'caisse') as compte
  ), flux (le_jour, le_montant) as (
    -- L'ouverture : les à-nouveaux du compte de la caisse.
    select a.date, case when a.sens = 'debit' then a.montant else -a.montant end
      from public.a_nouveaux a, caisse c
     where a.dossier_id = p_dossier_id and a.compte = c.compte
    union all
    -- Les opérations non retirées.
    select o.date, case when o.genre = 'prelevement' then -o.montant else o.montant end
      from public.operations_caisse o
     where o.dossier_id = p_dossier_id and o.retire_le is null
    union all
    -- Les mouvements du relevé classés sur le compte de la caisse.
    select l.date, -l.montant
      from public.lignes_bancaires l, caisse c
     where l.dossier_id = p_dossier_id and l.compte_bilan = c.compte
    union all
    -- Les espèces des factures sources : un encaissement en espèces sans mouvement, ou la contre-passation sans
    -- mouvement d'un tel encaissement.
    select e.date_encaissement, e.montant
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
      left join public.encaissements_factures o on o.id = e.annule_id
     where e.dossier_id = p_dossier_id and f.source_de_la_vente and e.retire_le is null and e.ligne_bancaire_id is null
       and case when e.annule_id is null then e.moyen = 'especes'
                else o.ligne_bancaire_id is null and o.moyen = 'especes' end
  ), soldes as (
    select x.le_jour, sum(sum(x.le_montant)) over (order by x.le_jour) as le_solde
      from flux x
     group by x.le_jour
  )
  select s.le_jour, s.le_solde from soldes s where s.le_solde < 0 order by s.le_jour limit 1
$$;

-- ══ 5. Les mots d'un refus ══════════
-- Un seul texte par geste, que la fonction d'écriture, la saisie d'un mois et les déclencheurs disent de même, et que
-- le module redira avant le clic : le geste, son montant, le jour où la caisse passerait sous zéro et ce solde. Aucun
-- rôle de l'API ne l'exécute.
create function public.texte_caisse_negative(p_geste text, p_montant numeric, p_jour date, p_solde numeric) returns text
language sql
stable
set search_path = public
as $$
  select case p_geste
      when 'prelevement' then format('Ce prélèvement de %s € rendrait la caisse négative le %s (%s €) : saisis d''abord les recettes en espèces qui le précèdent.', x.montant, x.jour, x.solde)
      when 'especes_rendues' then format('Ces espèces rendues, %s €, rendraient la caisse négative le %s (%s €) : saisis d''abord les recettes en espèces qui les précèdent.', x.montant, x.jour, x.solde)
      when 'paiement' then format('Ce paiement de %s € rendrait la caisse négative le %s (%s €) : saisis d''abord les recettes en espèces qui le précèdent ; si tu as payé de ta poche, ce n''est pas la caisse : c''est une note de frais.', x.montant, x.jour, x.solde)
      when 'retrait_recette' then format('Retirer cette recette de %s € rendrait la caisse négative le %s (%s €) : retire d''abord les sorties d''espèces qui la suivent.', x.montant, x.jour, x.solde)
      when 'retrait_apport' then format('Retirer cet apport de %s € rendrait la caisse négative le %s (%s €) : retire d''abord les sorties d''espèces qui le suivent.', x.montant, x.jour, x.solde)
      when 'retrait_paiement' then format('Retirer ce paiement de %s € rendrait la caisse négative le %s (%s €) : retire d''abord les sorties d''espèces qui le suivent.', x.montant, x.jour, x.solde)
      when 'versement' then format('Ce versement de %s € rendrait la caisse négative le %s (%s €) : saisis d''abord les recettes en espèces qui le précèdent.', x.montant, x.jour, x.solde)
      when 'retrait_d_especes_retire' then format('Retirer ce retrait d''espèces de %s € pour la caisse rendrait la caisse négative le %s (%s €) : retire d''abord les sorties d''espèces qui le suivent.', x.montant, x.jour, x.solde)
      when 'mouvement_change' then format('Ce changement d''un mouvement classé sur la caisse la rendrait négative le %s (%s €).', x.jour, x.solde)
      when 'contre_passation' then format('Cette contre-passation de %s € en espèces rendrait la caisse négative le %s (%s €) : la caisse n''a plus ces espèces ce jour-là.', x.montant, x.jour, x.solde)
      when 'retrait_encaissement' then format('Retirer cet encaissement de %s € en espèces rendrait la caisse négative le %s (%s €) : ses espèces ont déjà servi.', x.montant, x.jour, x.solde)
      when 'rattachement_encaissement' then format('Rattacher à un mouvement cet encaissement de %s € en espèces rendrait la caisse négative le %s (%s €) : ses espèces ont déjà servi.', x.montant, x.jour, x.solde)
      when 'ouverture_au_credit' then format('Une ouverture de la caisse au crédit, %s €, la rendrait négative le %s (%s €) : le solde d''une caisse est débiteur ou nul.', x.montant, x.jour, x.solde)
      when 'retrait_ouverture' then format('Retirer l''ouverture de la caisse, %s €, la rendrait négative le %s (%s €) : retire d''abord les sorties d''espèces qui la suivent.', x.montant, x.jour, x.solde)
      when 'ouverture_change' then format('Ce changement de l''ouverture de la caisse la rendrait négative le %s (%s €).', x.jour, x.solde)
      when 'lot' then format('La caisse serait négative le %s (%s €) : saisis d''abord les recettes en espèces qui précèdent ce jour.', x.jour, x.solde)
      else format('Cette écriture rendrait la caisse négative le %s (%s €).', x.jour, x.solde)
    end
    from (select replace(to_char(abs(p_montant), 'FM999999999990.00'), '.', ',') as montant,
                 to_char(p_jour, 'DD/MM/YYYY') as jour,
                 case when p_solde < 0 then '−' else '' end || replace(to_char(abs(p_solde), 'FM999999999990.00'), '.', ',') as solde) x
$$;

-- ══ 6. La garde de la table ══════════
-- Insérée par une fonction de la caisse (le réglage `jd.caisse` porte l'identifiant de CETTE opération) ou par la
-- restauration (le super-administrateur, dans un dossier sans exercice validé) ; ne change que par son retrait, une
-- fois, par la fonction du retrait (une migration à coller, C1b : le même réglage) ; au-delà de la frontière de la
-- validation, ni insérée ni retirée ; jamais supprimée, la cascade du dossier exceptée. À l'insertion, ce qu'aucune
-- contrainte de ligne ne dit : la catégorie, la pièce et l'opération remplacée sont du dossier.
create function public.garder_operation_caisse() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reglage text := coalesce(current_setting('jd.caisse', true), '');
  v_frontiere date;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une opération de caisse ne se supprime pas : elle se retire, avec son écriture.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['retire_le', 'retire_par']) is distinct from (to_jsonb(old) - array['retire_le', 'retire_par'])
       or old.retire_le is not null or new.retire_le is null or v_reglage is distinct from old.id::text then
      raise exception 'Une opération de caisse ne se modifie pas : elle se retire, puis se saisit de nouveau.' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_frontiere := public.frontiere_validation(old.dossier_id);
    if v_frontiere is not null and old.date <= v_frontiere then
      raise exception '% : sa caisse ne change plus.',
        public.exercice_fige(old.dossier_id, extract(year from old.date)::integer) using errcode = '23514';
    end if;
    return new;
  end if;

  if v_reglage is distinct from new.id::text
     and not (public.is_super_admin()
              and not exists (select 1 from public.exercices_valides v where v.dossier_id = new.dossier_id)) then
    raise exception 'Une opération de caisse ne s''écrit que par les fonctions de la caisse, avec son écriture.' using errcode = '42501';
  end if;
  if new.categorie_id is not null and not exists (
       select 1 from public.categories c
        where c.id = new.categorie_id and (c.dossier_id is null or c.dossier_id = new.dossier_id)) then
    raise exception 'La catégorie d''une opération de caisse est une catégorie de son dossier, ou commune.' using errcode = '23514';
  end if;
  if new.piece_id is not null and not exists (
       select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id) then
    raise exception 'La pièce d''un paiement par la caisse est une pièce de son dossier.' using errcode = '23514';
  end if;
  if new.remplace_id is not null and not exists (
       select 1 from public.operations_caisse o where o.id = new.remplace_id and o.dossier_id = new.dossier_id) then
    raise exception 'Une opération de caisse ne remplace qu''une opération de son dossier.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_frontiere := public.frontiere_validation(new.dossier_id);
  if v_frontiere is not null and new.date <= v_frontiere then
    raise exception '% : sa caisse ne change plus.',
      public.exercice_fige(new.dossier_id, extract(year from new.date)::integer) using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger operations_caisse_gardes
  before insert or update or delete on public.operations_caisse
  for each row execute function public.garder_operation_caisse();

-- ══ 7. La garde de l'écriture d'une opération ══════════
-- Le patron de `garder_ecriture_paiement_personnel` : une ligne qui désigne une opération ne s'écrit, ne change et ne
-- part qu'avec elle — sous le réglage de CETTE opération, ou par la restauration (le super-administrateur, dans un
-- dossier sans exercice validé) ; elle suit son opération (son dossier, sa date, une opération non retirée ; la pièce,
-- seulement celle d'un paiement). La validation numérote ses lignes sans passer par ici : ses colonnes ne sont pas
-- celles que le déclencheur regarde.
create function public.garder_ecriture_de_caisse() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.operation_caisse_id is null
       or not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or not exists (select 1 from public.operations_caisse o where o.id = old.operation_caisse_id)
       or coalesce(current_setting('jd.caisse', true), '') = old.operation_caisse_id::text then
      return old;
    end if;
    raise exception 'L''écriture d''une opération de caisse se retire avec cette opération.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.operation_caisse_id is not null then
    raise exception 'L''écriture d''une opération de caisse ne se modifie pas : retire l''opération, puis saisis-la de nouveau.'
      using errcode = '42501';
  end if;
  if new.operation_caisse_id is null then
    return new;
  end if;
  if coalesce(current_setting('jd.caisse', true), '') is distinct from new.operation_caisse_id::text
     and not (tg_op = 'INSERT' and public.is_super_admin()
              and not exists (select 1 from public.exercices_valides v where v.dossier_id = new.dossier_id)) then
    raise exception 'L''écriture d''une opération de caisse ne s''écrit qu''avec cette opération, par la fonction de la caisse.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.operations_caisse o
                  where o.id = new.operation_caisse_id and o.dossier_id = new.dossier_id and o.date = new.date
                    and o.retire_le is null and (new.piece_id is null or new.piece_id = o.piece_id)) then
    raise exception 'Cette écriture ne suit pas son opération de caisse : son dossier, sa date, ou sa pièce.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger ecritures_brouillon_caisse
  before insert or delete or update of operation_caisse_id, dossier_id, date, compte, sens, montant, libelle, piece_id
  on public.ecritures_brouillon
  for each row execute function public.garder_ecriture_de_caisse();

-- ══ 8. La caisse jamais négative, à la fin de la transaction ══════════
-- Des déclencheurs de CONTRAINTE, différés à la validation de la transaction, sur chacune des quatre tables dont la
-- caisse suit les flux : remplacer une recette, ou saisir un mois dont un jour retire avant qu'un autre ajoute, passe
-- un instant sous zéro sans que la caisse le soit à la fin. Pour la ligne, ce qu'elle apportait à la caisse avant, à
-- son jour, et ce qu'elle y apporte après ; une ligne qui n'y entre ni avant ni après sort aussitôt, et un changement
-- qui ne peut, à aucun jour, que garder ou grossir la caisse ne se juge pas. Sinon, sous le verrou EXCLUSIF de la
-- caisse du dossier — deux sessions qui la vident se suivent, et la seconde voit la première —, la caisse se rejoue, et
-- un jour négatif se refuse en 23514, sous les mots du geste.
--
-- LEUR CONDITION, le patron de `factures_emises_avoir_sans_brouillon` : sur les trois tables d'hier, une ligne qui ne
-- peut pas être de la caisse ne se met même pas en file. Un événement différé reste en attente jusqu'à la fin de la
-- transaction, et une table qui en porte ne change plus de structure avant elle (55006) : sans condition, toute
-- écriture d'un mouvement, d'un encaissement ou d'un à-nouveau en laisserait un — l'essai de la frontière des
-- encaissements, qui écrit des chèques puis désactive une garde, l'a montré. La condition est large, la fonction
-- tranche : un mouvement ou un à-nouveau sous la racine 53, que le plan impose au compte du rôle `caisse` (la garde de
-- tête la vérifie), un encaissement en espèces ou une contre-passation. Une condition qui lit la ligne d'avant ne vaut
-- pas pour une insertion, ni une qui lit celle d'après pour une suppression : un déclencheur par événement. Une
-- transaction qui écrit une ligne de la caisse puis modifie la structure de sa table pose d'abord, sur eux,
-- `set constraints … immediate`.
--
-- LA PORTE DE LA RESTAURATION : une ligne RÉINSÉRÉE — insérée par le super-administrateur dans un dossier sans exercice
-- validé, et portant l'instant de création qu'elle avait avant (antérieur à la transaction) — ne se juge pas : la
-- restauration remet, table après table, un état que la garde a déjà jugé, et passe par des états partiels. Une ligne
-- créée dans la transaction porte l'instant de la transaction (`now()`), et se juge toujours, quel qu'en soit
-- l'auteur : le chef du cabinet, super-administrateur en production, qui saisit par les fonctions, n'y échappe pas.
create function public.garder_la_caisse() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dossier uuid;
  v_dossiers uuid[];
  v_avant numeric := 0;
  v_apres numeric := 0;
  v_jour_avant date;
  v_jour_apres date;
  v_cree timestamp with time zone;
  v_geste text;
  v_montant numeric;
  v_jour date;
  v_solde numeric;
begin
  v_dossier := case when tg_op = 'DELETE' then old.dossier_id else new.dossier_id end;

  if tg_table_name = 'operations_caisse' then
    if tg_op <> 'INSERT' and old.retire_le is null then
      v_avant := case when old.genre = 'prelevement' then -old.montant else old.montant end;
      v_jour_avant := old.date;
    end if;
    if tg_op <> 'DELETE' then
      if new.retire_le is null then
        v_apres := case when new.genre = 'prelevement' then -new.montant else new.montant end;
      end if;
      v_jour_apres := new.date;
      v_cree := new.cree_le;
    end if;
  elsif tg_table_name = 'lignes_bancaires' then
    if (tg_op = 'INSERT' or old.compte_bilan is null) and (tg_op = 'DELETE' or new.compte_bilan is null) then
      return null;
    end if;
    if tg_op <> 'INSERT' and old.compte_bilan = public.compte_du_role(old.dossier_id, 'caisse') then
      v_avant := -old.montant;
      v_jour_avant := old.date;
    end if;
    if tg_op <> 'DELETE' then
      if new.compte_bilan = public.compte_du_role(new.dossier_id, 'caisse') then
        v_apres := -new.montant;
      end if;
      v_jour_apres := new.date;
      v_cree := new.created_at;
    end if;
  elsif tg_table_name = 'encaissements_factures' then
    if tg_op <> 'INSERT' and old.retire_le is null and old.ligne_bancaire_id is null
       and exists (select 1 from public.factures_emises f where f.id = old.facture_id and f.source_de_la_vente)
       and (old.annule_id is null and old.moyen = 'especes'
            or old.annule_id is not null and exists (select 1 from public.encaissements_factures o
                                                      where o.id = old.annule_id and o.ligne_bancaire_id is null
                                                        and o.moyen = 'especes')) then
      v_avant := old.montant;
      v_jour_avant := old.date_encaissement;
    end if;
    if tg_op <> 'DELETE' then
      if new.retire_le is null and new.ligne_bancaire_id is null
         and exists (select 1 from public.factures_emises f where f.id = new.facture_id and f.source_de_la_vente)
         and (new.annule_id is null and new.moyen = 'especes'
              or new.annule_id is not null and exists (select 1 from public.encaissements_factures o
                                                        where o.id = new.annule_id and o.ligne_bancaire_id is null
                                                          and o.moyen = 'especes')) then
        v_apres := new.montant;
      end if;
      v_jour_apres := new.date_encaissement;
      v_cree := new.cree_le;
    end if;
  elsif tg_table_name = 'a_nouveaux' then
    if tg_op <> 'INSERT' and old.compte = public.compte_du_role(old.dossier_id, 'caisse') then
      v_avant := case when old.sens = 'debit' then old.montant else -old.montant end;
      v_jour_avant := old.date;
    end if;
    if tg_op <> 'DELETE' then
      if new.compte = public.compte_du_role(new.dossier_id, 'caisse') then
        v_apres := case when new.sens = 'debit' then new.montant else -new.montant end;
      end if;
      v_jour_apres := new.date;
      v_cree := new.created_at;
    end if;
  else
    raise exception 'garder_la_caisse ne veille pas sur la table %.', tg_table_name;
  end if;

  -- Rien de la caisse, ni avant ni après.
  if v_avant = 0 and v_apres = 0 then
    return null;
  end if;
  -- La porte de la restauration.
  if tg_op = 'INSERT' and v_cree < now() and public.is_super_admin()
     and not exists (select 1 from public.exercices_valides v where v.dossier_id = v_dossier) then
    return null;
  end if;
  -- Les caisses à juger. Une ligne qui reste dans son dossier : la sienne, sauf si le changement ne peut, à aucun jour,
  -- que garder ou grossir la caisse — au jour t, le solde d'après est celui d'avant, moins l'ancien apport s'il
  -- comptait déjà, plus le nouveau s'il compte déjà. Une ligne qui passe d'un dossier à un autre : celui qu'elle quitte
  -- s'il perd des espèces, celui qu'elle rejoint s'il en perd. Un dossier qui n'est plus (sa cascade) ne se juge pas.
  if tg_op = 'UPDATE' and old.dossier_id is distinct from new.dossier_id then
    v_dossiers := array(select x from unnest(array[case when v_avant > 0 then old.dossier_id end,
                                                   case when v_apres < 0 then new.dossier_id end]) x
                         where x is not null order by x);
  else
    if tg_op = 'INSERT' then
      v_jour_avant := v_jour_apres;
    elsif tg_op = 'DELETE' then
      v_jour_apres := v_jour_avant;
    end if;
    v_jour_avant := coalesce(v_jour_avant, v_jour_apres);
    v_jour_apres := coalesce(v_jour_apres, v_jour_avant);
    if v_apres >= v_avant
       and (v_jour_apres >= v_jour_avant or v_apres >= 0)
       and (v_jour_avant >= v_jour_apres or v_avant <= 0) then
      return null;
    end if;
    v_dossiers := array[v_dossier];
  end if;

  -- Le geste, pour ses mots.
  if tg_table_name = 'operations_caisse' then
    if tg_op = 'INSERT' then
      v_geste := case when new.genre = 'prelevement' then 'prelevement'
                      when new.genre = 'recette' then 'especes_rendues'
                      when new.genre = 'paiement' then 'paiement' end;
      v_montant := new.montant;
    elsif tg_op = 'UPDATE' and new.retire_le is not null then
      v_geste := case when old.genre = 'recette' then 'retrait_recette' when old.genre = 'apport' then 'retrait_apport'
                      when old.genre = 'paiement' then 'retrait_paiement' end;
      v_montant := old.montant;
    end if;
  elsif tg_table_name = 'lignes_bancaires' then
    if v_apres < 0 then
      v_geste := 'versement';
      v_montant := v_apres;
    elsif v_avant > 0 and v_apres = 0 then
      v_geste := 'retrait_d_especes_retire';
      v_montant := v_avant;
    else
      -- Un retrait pour la caisse qui reste sur elle : plus petit, plus tard, ou dans un autre dossier.
      v_geste := 'mouvement_change';
      v_montant := v_apres;
    end if;
  elsif tg_table_name = 'encaissements_factures' then
    if tg_op = 'INSERT' and v_apres < 0 then
      v_geste := 'contre_passation';
      v_montant := v_apres;
    elsif tg_op = 'UPDATE' and v_avant > 0 and new.retire_le is not null and old.retire_le is null then
      v_geste := 'retrait_encaissement';
      v_montant := v_avant;
    elsif tg_op = 'UPDATE' and v_avant > 0 and new.ligne_bancaire_id is not null and old.ligne_bancaire_id is null then
      v_geste := 'rattachement_encaissement';
      v_montant := v_avant;
    end if;
  elsif tg_table_name = 'a_nouveaux' then
    if v_apres < 0 then
      v_geste := 'ouverture_au_credit';
      v_montant := v_apres;
    elsif v_avant > 0 and v_apres = 0 then
      v_geste := 'retrait_ouverture';
      v_montant := v_avant;
    else
      -- Une ouverture au débit qui reste au débit : plus petite, plus tard, ou dans un autre dossier.
      v_geste := 'ouverture_change';
      v_montant := v_apres;
    end if;
  end if;

  -- Le verrou de la caisse, puis la caisse rejouée : sous lui, une autre session qui la vide a fini, et se voit. Deux
  -- caisses se verrouillent dans l'ordre de leurs identifiants.
  foreach v_dossier in array v_dossiers loop
    if exists (select 1 from public.dossiers d where d.id = v_dossier) then
      perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || v_dossier::text, 0));
      select n.jour, n.solde into v_jour, v_solde from public.premier_jour_negatif_de_la_caisse(v_dossier) n;
      if v_jour is not null then
        raise exception '%', public.texte_caisse_negative(coalesce(v_geste, 'autre'), coalesce(v_montant, 0), v_jour, v_solde)
          using errcode = '23514';
      end if;
    end if;
  end loop;
  return null;
end
$$;

create constraint trigger operations_caisse_jamais_negative
  after insert or update or delete on public.operations_caisse
  deferrable initially deferred
  for each row execute function public.garder_la_caisse();

-- Un mouvement du relevé classé sur un compte 53.
create constraint trigger lignes_bancaires_caisse_jamais_negative_insertion
  after insert on public.lignes_bancaires
  deferrable initially deferred
  for each row when (left(new.compte_bilan, 2) = '53')
  execute function public.garder_la_caisse();

create constraint trigger lignes_bancaires_caisse_jamais_negative_modification
  after update on public.lignes_bancaires
  deferrable initially deferred
  for each row when (left(old.compte_bilan, 2) = '53' or left(new.compte_bilan, 2) = '53')
  execute function public.garder_la_caisse();

create constraint trigger lignes_bancaires_caisse_jamais_negative_suppression
  after delete on public.lignes_bancaires
  deferrable initially deferred
  for each row when (left(old.compte_bilan, 2) = '53')
  execute function public.garder_la_caisse();

-- Un encaissement en espèces, ou une contre-passation (ses espèces sont celles de l'encaissement qu'elle annule).
create constraint trigger encaissements_factures_caisse_jamais_negative_insertion
  after insert on public.encaissements_factures
  deferrable initially deferred
  for each row when (new.moyen = 'especes' or new.annule_id is not null)
  execute function public.garder_la_caisse();

create constraint trigger encaissements_factures_caisse_jamais_negative_modification
  after update on public.encaissements_factures
  deferrable initially deferred
  for each row when (old.moyen = 'especes' or new.moyen = 'especes' or old.annule_id is not null or new.annule_id is not null)
  execute function public.garder_la_caisse();

create constraint trigger encaissements_factures_caisse_jamais_negative_suppression
  after delete on public.encaissements_factures
  deferrable initially deferred
  for each row when (old.moyen = 'especes' or old.annule_id is not null)
  execute function public.garder_la_caisse();

-- Un à-nouveau sur un compte 53.
create constraint trigger a_nouveaux_caisse_jamais_negative_insertion
  after insert on public.a_nouveaux
  deferrable initially deferred
  for each row when (left(new.compte, 2) = '53')
  execute function public.garder_la_caisse();

create constraint trigger a_nouveaux_caisse_jamais_negative_modification
  after update on public.a_nouveaux
  deferrable initially deferred
  for each row when (left(old.compte, 2) = '53' or left(new.compte, 2) = '53')
  execute function public.garder_la_caisse();

create constraint trigger a_nouveaux_caisse_jamais_negative_suppression
  after delete on public.a_nouveaux
  deferrable initially deferred
  for each row when (left(old.compte, 2) = '53')
  execute function public.garder_la_caisse();

-- ══ 9. Enregistrer une opération de caisse ══════════
-- Le patron d'`enregistrer_paiement_personnel_cotisation`. Les refus, dans cet ordre — le module les redira avant le
-- clic, dans le même ordre et sous les mêmes mots :
--   1. l'accès, avant toute lecture (`qui_ecrit_la_caisse` : 42501) ;
--   2. le dossier en comptabilité de trésorerie (22023) — l'engagement attend sa conception ;
--   3. le genre : une recette, un apport ou un prélèvement (22023) — le paiement d'une pièce a sa fonction, à venir ;
--   4. la date : renseignée, pas avant 2000, pas dans l'avenir à Paris, pas avant l'ouverture d'un dossier repris
--      (22023), pas dans un exercice figé (23514) ;
--   5. le montant : renseigné, au centime, non nul, positif pour un apport ou un prélèvement, borné (22023) ;
--   6. la catégorie d'une recette : renseignée, du dossier ou commune, au compte de produit ; aucune pour un apport ou
--      un prélèvement (22023) ;
--   7. le taux : exigé pour une recette d'un dossier assujetti, l'un de ceux du relevé ; refusé partout ailleurs
--      (22023) ;
--   8. l'ensemble du jour (CAISSE-Q2, (A)) : une recette reconnaît exactement les espèces des factures sources de son
--      jour que la caisse compte — ni une de moins (un encaissement enregistré depuis la lecture), ni une de plus
--      (22023) ;
--   9. l'écriture : composée par l'application, RECOMPOSÉE ici en centimes entiers, comparée en multiensemble (22023) ;
--  10. la caisse jamais négative (23514), jugée après l'écriture — sauf dans une saisie d'un mois, qui la juge à sa
--      fin.
-- Les comptes viennent du plan, jamais en dur : le rôle `caisse`, le compte de l'exploitant (`compte_du_dirigeant`), le
-- rôle `tva_collectee`, le compte de la catégorie. Une recette : la caisse au débit, le produit hors taxe et sa TVA au
-- crédit (l'inverse pour des espèces rendues) ; un apport : la caisse face à l'exploitant ; un prélèvement : l'inverse.
-- Le libellé se compose ici, sans nom : celui que l'application envoie, s'il en envoie un, doit être celui-là.
create function public.enregistrer_operation_caisse(p_dossier_id uuid, p_genre text, p_date date, p_montant numeric,
  p_categorie_id uuid, p_taux_tva numeric, p_encaissements_du_jour uuid[], p_ecritures jsonb)
returns public.operations_caisse
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origine text;
  v_mode text;
  v_assujetti boolean;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_ouverture date;
  v_frontiere date;
  v_categorie public.categories%rowtype;
  v_attendus uuid[];
  v_recus uuid[];
  v_ecart uuid;
  v_numero text;
  v_caisse text;
  v_dirigeant text;
  v_collectee text;
  v_centimes bigint;
  v_tva bigint := 0;
  v_libelle text;
  v_conforme boolean;
  v_id uuid := gen_random_uuid();
  v_operation public.operations_caisse;
  v_debit numeric;
  v_credit numeric;
  v_jour date;
  v_solde numeric;
begin
  -- 1. L'accès, avant toute lecture ; puis les verrous : celui de la validation, partagé (la frontière lue ici est
  --    celle que les gardes liront), et celui de la caisse du dossier, exclusif (l'ensemble du jour et le solde lus ici
  --    ne changent pas sous la saisie).
  v_origine := public.qui_ecrit_la_caisse(p_dossier_id);
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || p_dossier_id::text, 0));
  select d.mode_comptable, d.assujetti_tva into v_mode, v_assujetti from public.dossiers d where d.id = p_dossier_id;

  -- 2. Le dossier en trésorerie.
  if v_mode is distinct from 'tresorerie' then
    raise exception 'La caisse ne se tient que dans un dossier en comptabilité de trésorerie.' using errcode = '22023';
  end if;

  -- 3. Le genre.
  if p_genre is null or p_genre not in ('recette', 'apport', 'prelevement') then
    raise exception 'Une opération de caisse est une recette en espèces, un apport ou un prélèvement de l''exploitant.'
      using errcode = '22023';
  end if;

  -- 4. La date.
  if p_date is null then
    raise exception 'La date de l''opération de caisse est à renseigner.' using errcode = '22023';
  end if;
  if p_date < date '2000-01-01' then
    raise exception 'Une opération de caisse ne se date pas avant l''an 2000.' using errcode = '22023';
  end if;
  if p_date > v_aujourd_hui then
    raise exception 'Une opération de caisse ne se date pas dans l''avenir : nous sommes le %.',
      to_char(v_aujourd_hui, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select min(a.date) into v_ouverture from public.a_nouveaux a where a.dossier_id = p_dossier_id;
  if v_ouverture is not null and p_date < v_ouverture then
    raise exception 'Cette opération précède l''ouverture du dossier, le % : elle est dans les comptes repris.',
      to_char(v_ouverture, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and p_date <= v_frontiere then
    raise exception '% : sa caisse ne change plus.',
      public.exercice_fige(p_dossier_id, extract(year from p_date)::integer) using errcode = '23514';
  end if;

  -- 5. Le montant.
  if p_montant is null then
    raise exception 'Le montant de l''opération de caisse est à renseigner.' using errcode = '22023';
  end if;
  if p_montant <> round(p_montant, 2) then
    raise exception 'Le montant d''une opération de caisse est au centime.' using errcode = '22023';
  end if;
  if p_montant = 0 then
    raise exception 'Une opération de caisse de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if p_genre <> 'recette' and p_montant < 0 then
    raise exception 'Le montant d''un apport ou d''un prélèvement est positif : un apport fait entrer des espèces, un prélèvement les fait sortir.'
      using errcode = '22023';
  end if;
  if abs(p_montant) >= 10000000000000 then
    raise exception 'Le montant d''une opération de caisse dépasse ce que l''application compte.' using errcode = '22023';
  end if;

  -- 6. La catégorie d'une recette, et son compte de produit.
  if p_genre = 'recette' then
    if p_categorie_id is null then
      raise exception 'La nature d''une recette en espèces est une catégorie de produit du dossier : à choisir.'
        using errcode = '22023';
    end if;
    select c.* into v_categorie from public.categories c
     where c.id = p_categorie_id and (c.dossier_id is null or c.dossier_id = p_dossier_id);
    if not found then
      raise exception 'Cette catégorie n''existe pas pour ce dossier.' using errcode = '22023';
    end if;
    if v_categorie.compte_comptable is null or v_categorie.compte_comptable !~ '^7[0-9]{2}' then
      raise exception 'La catégorie « % » n''a pas de compte de produit (classe 7) : une recette en espèces ne s''y range pas.',
        v_categorie.libelle using errcode = '22023';
    end if;
  elsif p_categorie_id is not null then
    raise exception 'Un apport ou un prélèvement n''a pas de catégorie : il s''écrit face au compte de l''exploitant.'
      using errcode = '22023';
  end if;

  -- 7. Le taux.
  if p_genre = 'recette' and v_assujetti then
    if p_taux_tva is null then
      raise exception 'Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».'
        using errcode = '22023';
    end if;
    if p_taux_tva not in (0, 5.5, 8.5, 10, 20) then
      raise exception 'Ce taux de TVA n''est pas pris en charge.' using errcode = '22023';
    end if;
  elsif p_taux_tva is not null then
    raise exception 'Un taux de TVA ne s''applique qu''à une recette d''un dossier assujetti.' using errcode = '22023';
  end if;

  -- 8. L'ensemble du jour : les espèces des factures sources que la caisse compte ce jour-là.
  if p_genre = 'recette' then
    if p_encaissements_du_jour is null or array_position(p_encaissements_du_jour, null) is not null then
      raise exception 'La saisie d''une recette dit les encaissements en espèces de factures de son jour qu''elle a lus : une liste d''identifiants, vide s''il n''y en a aucun.'
        using errcode = '22023';
    end if;
    v_recus := array(select distinct x from unnest(p_encaissements_du_jour) x order by x);
    if cardinality(v_recus) <> cardinality(p_encaissements_du_jour) then
      raise exception 'La saisie d''une recette nomme chaque encaissement de son jour une seule fois.' using errcode = '22023';
    end if;
    v_attendus := array(
      select e.id
        from public.encaissements_factures e
        join public.factures_emises f on f.id = e.facture_id
        left join public.encaissements_factures o on o.id = e.annule_id
       where e.dossier_id = p_dossier_id and e.date_encaissement = p_date and f.source_de_la_vente
         and e.retire_le is null and e.ligne_bancaire_id is null
         and case when e.annule_id is null then e.moyen = 'especes'
                  else o.ligne_bancaire_id is null and o.moyen = 'especes' end
       order by e.id);
    select min(x::text)::uuid into v_ecart from unnest(v_attendus) x where x <> all (v_recus);
    if v_ecart is not null then
      select f.numero into v_numero from public.encaissements_factures e join public.factures_emises f on f.id = e.facture_id
       where e.id = v_ecart;
      raise exception 'Un encaissement en espèces de la facture % du même jour a été enregistré depuis ta lecture : relis la caisse.',
        coalesce(v_numero, '(sans numéro)') using errcode = '22023';
    end if;
    select min(x::text)::uuid into v_ecart from unnest(v_recus) x where x <> all (v_attendus);
    if v_ecart is not null then
      select f.numero into v_numero from public.encaissements_factures e join public.factures_emises f on f.id = e.facture_id
       where e.id = v_ecart and e.dossier_id = p_dossier_id;
      if found then
        raise exception 'L''encaissement de la facture % que ta lecture comptait n''est pas dans la caisse de ce jour : relis la caisse.',
          coalesce(v_numero, '(sans numéro)') using errcode = '22023';
      end if;
      raise exception 'Un encaissement que ta lecture comptait n''est pas un encaissement de ce dossier : relis la caisse.'
        using errcode = '22023';
    end if;
  elsif p_encaissements_du_jour is not null and cardinality(p_encaissements_du_jour) > 0 then
    raise exception 'Seule une recette reconnaît les encaissements en espèces de son jour.' using errcode = '22023';
  end if;

  -- 9. L'écriture attendue, EN CENTIMES ENTIERS, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues
  -- présente, à l'égalité exacte — un montant reçu qui n'est pas au centime n'égale aucun nombre entier de centimes.
  -- Une ligne à zéro n'en est pas une (une recette exonérée n'a pas de ligne de TVA).
  v_caisse := public.compte_du_role(p_dossier_id, 'caisse');
  v_centimes := (abs(p_montant) * 100)::bigint;
  if p_genre = 'recette' then
    if p_taux_tva is not null and p_taux_tva > 0 then
      v_tva := (public.tva_incluse(abs(p_montant), p_taux_tva) * 100)::bigint;
      v_collectee := public.compte_du_role(p_dossier_id, 'tva_collectee');
    end if;
    v_libelle := case when p_montant > 0 then 'Recettes en espèces du ' else 'Espèces rendues le ' end
      || to_char(p_date, 'DD/MM/YYYY') || ' — ' || v_categorie.libelle;
  else
    v_dirigeant := public.compte_du_dirigeant(p_dossier_id);
    v_libelle := case when p_genre = 'apport' then 'Apport en caisse de l''exploitant'
                      else 'Prélèvement en espèces de l''exploitant' end;
  end if;
  if jsonb_typeof(p_ecritures) is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_ecritures) e(valeur)
                 where jsonb_typeof(e.valeur) is distinct from 'object'
                    or jsonb_typeof(e.valeur -> 'compte') is distinct from 'string'
                    or jsonb_typeof(e.valeur -> 'sens') is distinct from 'string'
                    or jsonb_typeof(e.valeur -> 'montant') is distinct from 'number'
                    or jsonb_typeof(coalesce(e.valeur -> 'libelle', 'null'::jsonb)) not in ('null', 'string')) then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select a.compte, a.sens, a.centimes from (values
      (v_caisse, case when p_genre = 'prelevement' or p_montant < 0 then 'credit' else 'debit' end, v_centimes),
      (case when p_genre = 'recette' then v_categorie.compte_comptable else v_dirigeant end,
       case when p_genre = 'prelevement' or p_montant < 0 then 'debit' else 'credit' end,
       v_centimes - v_tva),
      (v_collectee, case when p_montant < 0 then 'debit' else 'credit' end, v_tva)
    ) as a(compte, sens, centimes)
    where a.centimes > 0
  ), recues as (
    select e.valeur ->> 'compte' as compte, e.valeur ->> 'sens' as sens, (e.valeur ->> 'montant')::numeric * 100 as centimes
      from jsonb_array_elements(p_ecritures) e(valeur)
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, centimes::numeric from attendues
                     except all select compte, sens, centimes from recues)
     and not exists (select 1 from jsonb_array_elements(p_ecritures) e(valeur)
                      where jsonb_typeof(e.valeur -> 'libelle') = 'string' and e.valeur ->> 'libelle' <> v_libelle)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : %).',
      v_caisse using errcode = '22023';
  end if;

  -- L'opération et son écriture, d'un tenant, sous le réglage de CETTE opération, retiré aussitôt.
  perform set_config('jd.caisse', v_id::text, true);
  insert into public.operations_caisse (id, dossier_id, genre, date, montant, categorie_id, taux_tva, encaissements_du_jour,
                                        piece_id, origine, remplace_id, cree_par)
  values (v_id, p_dossier_id, p_genre, p_date, p_montant, p_categorie_id, p_taux_tva,
          case when p_genre = 'recette' then v_recus end, null, v_origine, null, auth.uid())
  returning * into v_operation;
  insert into public.ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, operation_caisse_id)
  select p_dossier_id, p_date, e.valeur ->> 'compte', v_libelle, (e.valeur ->> 'montant')::numeric, e.valeur ->> 'sens',
         'proposee', v_id
    from jsonb_array_elements(p_ecritures) e(valeur);
  perform set_config('jd.caisse', '', true);

  select coalesce(sum(b.montant) filter (where b.sens = 'debit'), 0), coalesce(sum(b.montant) filter (where b.sens = 'credit'), 0)
    into v_debit, v_credit
    from public.ecritures_brouillon b where b.operation_caisse_id = v_id;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  -- 10. La caisse jamais négative, dite ici sous les mots du geste ; une saisie d'un mois la juge à sa fin.
  if coalesce(current_setting('jd.caisse_d_un_lot', true), '') is distinct from p_dossier_id::text
     and (p_genre = 'prelevement' or p_montant < 0) then
    select n.jour, n.solde into v_jour, v_solde from public.premier_jour_negatif_de_la_caisse(p_dossier_id) n;
    if v_jour is not null then
      raise exception '%', public.texte_caisse_negative(case when p_genre = 'prelevement' then 'prelevement' else 'especes_rendues' end,
        p_montant, v_jour, v_solde) using errcode = '23514';
    end if;
  end if;
  return v_operation;
end
$$;

-- ══ 10. Enregistrer les opérations de caisse d'un mois ══════════
-- Le patron d'`importer_contacts` : la même fonction pour chaque opération, dans l'ordre reçu et dans la même
-- transaction, tout ou rien ; le premier refus repart sous son code, nommé par le rang et le jour de son opération
-- (« Opération n° 3, du 12/03/2026 : … »). La caisse jamais négative se juge à la fin, sur toutes les opérations : un
-- jour qui retire avant qu'un autre ajoute passe. Un praticien, c'est environ 250 recettes par an : mille opérations au
-- plus par saisie.
create function public.enregistrer_operations_de_caisse(p_dossier_id uuid, p_operations jsonb) returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rang integer := 0;
  v_operation jsonb;
  v_cle text;
  v_date date;
  v_jour_lu text;
  v_categorie uuid;
  v_encaissements uuid[];
  v_ids uuid[] := '{}';
  v_message text;
  v_code text;
  v_jour date;
  v_solde numeric;
begin
  -- 1. L'accès, avant toute lecture.
  perform public.qui_ecrit_la_caisse(p_dossier_id);
  -- 2. La saisie : un tableau JSON, d'au moins une opération, de mille au plus.
  if jsonb_typeof(p_operations) is distinct from 'array' then
    raise exception 'Une saisie de caisse est un tableau JSON d''opérations.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_operations) = 0 then
    raise exception 'La saisie ne porte aucune opération.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_operations) > 1000 then
    raise exception 'Une saisie range mille opérations au plus ; celle-ci en porte % : la partager.',
      jsonb_array_length(p_operations) using errcode = '22023';
  end if;
  -- 3. Opération par opération, dans l'ordre reçu ; un seul bloc d'exception, une seule sous-transaction.
  perform set_config('jd.caisse_d_un_lot', p_dossier_id::text, true);
  begin
    for i in 1 .. jsonb_array_length(p_operations) loop
      v_rang := i;
      v_jour_lu := null;
      v_operation := p_operations -> (i - 1);
      if jsonb_typeof(v_operation) is distinct from 'object' then
        raise exception 'Une opération de la saisie est un objet JSON aux champs d''une opération de caisse.' using errcode = '22023';
      end if;
      select min(k collate "C") into v_cle from jsonb_object_keys(v_operation) as k
       where k not in ('genre', 'date', 'montant', 'categorie_id', 'taux_tva', 'encaissements_du_jour', 'ecritures');
      if v_cle is not null then
        raise exception '« % » n''est pas un champ d''une opération de caisse.',
          case when char_length(v_cle) > 80 then left(v_cle, 79) || '…' else v_cle end using errcode = '22023';
      end if;
      if jsonb_typeof(coalesce(v_operation -> 'genre', 'null'::jsonb)) not in ('null', 'string')
         or jsonb_typeof(coalesce(v_operation -> 'date', 'null'::jsonb)) not in ('null', 'string')
         or jsonb_typeof(coalesce(v_operation -> 'montant', 'null'::jsonb)) not in ('null', 'number')
         or jsonb_typeof(coalesce(v_operation -> 'categorie_id', 'null'::jsonb)) not in ('null', 'string')
         or jsonb_typeof(coalesce(v_operation -> 'taux_tva', 'null'::jsonb)) not in ('null', 'number')
         or jsonb_typeof(coalesce(v_operation -> 'encaissements_du_jour', 'null'::jsonb)) not in ('null', 'array')
         or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_operation -> 'encaissements_du_jour') = 'array'
                                                             then v_operation -> 'encaissements_du_jour' else '[]'::jsonb end) x
                     where jsonb_typeof(x) <> 'string') then
        raise exception 'Une opération de la saisie porte un champ illisible : le genre, la date, la catégorie et les encaissements du jour sont des textes, le montant et le taux des nombres.'
          using errcode = '22023';
      end if;
      -- Une date s'écrit AAAA-MM-JJ, et rien d'autre : une conversion d'un texte libre suivrait le style de dates de la
      -- session (le 03/12 d'un JJ/MM se lirait le 12 mars en MM/JJ).
      if (v_operation ->> 'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'La date de l''opération est illisible : elle s''écrit AAAA-MM-JJ.' using errcode = '22023';
      end if;
      begin
        v_date := (v_operation ->> 'date')::date;
      exception when others then
        raise exception 'La date de l''opération est illisible : elle s''écrit AAAA-MM-JJ.' using errcode = '22023';
      end;
      v_jour_lu := to_char(v_date, 'DD/MM/YYYY');
      begin
        v_categorie := (v_operation ->> 'categorie_id')::uuid;
        v_encaissements := case when jsonb_typeof(v_operation -> 'encaissements_du_jour') = 'array'
          then array(select (x #>> '{}')::uuid from jsonb_array_elements(v_operation -> 'encaissements_du_jour') x) end;
      exception when others then
        raise exception 'Une opération de la saisie porte un identifiant illisible (sa catégorie ou un encaissement du jour).'
          using errcode = '22023';
      end;
      v_ids := v_ids || (public.enregistrer_operation_caisse(p_dossier_id, v_operation ->> 'genre', v_date,
        (v_operation ->> 'montant')::numeric, v_categorie, (v_operation ->> 'taux_tva')::numeric, v_encaissements,
        v_operation -> 'ecritures')).id;
    end loop;
  exception when others then
    get stacked diagnostics v_message = message_text, v_code = returned_sqlstate;
    raise exception '%', format('Opération n° %s%s : %s', v_rang,
      case when v_jour_lu is not null then ', du ' || v_jour_lu else '' end, v_message) using errcode = v_code;
  end;
  perform set_config('jd.caisse_d_un_lot', '', true);
  -- 4. La caisse jamais négative, sur toute la saisie.
  select n.jour, n.solde into v_jour, v_solde from public.premier_jour_negatif_de_la_caisse(p_dossier_id) n;
  if v_jour is not null then
    raise exception '%', public.texte_caisse_negative('lot', 0, v_jour, v_solde) using errcode = '23514';
  end if;
  return v_ids;
end
$$;

-- ══ 11. Les droits d'exécution ══════════
-- Les deux fonctions d'écriture, au compte connecté (elles contrôlent l'accès elles-mêmes) ; les autres, à personne.
revoke execute on function public.qui_ecrit_la_caisse(uuid) from public, anon, authenticated;
revoke execute on function public.premier_jour_negatif_de_la_caisse(uuid) from public, anon, authenticated;
revoke execute on function public.texte_caisse_negative(text, numeric, date, numeric) from public, anon, authenticated;
revoke execute on function public.garder_operation_caisse() from public, anon, authenticated;
revoke execute on function public.garder_ecriture_de_caisse() from public, anon, authenticated;
revoke execute on function public.garder_la_caisse() from public, anon, authenticated;
revoke execute on function public.enregistrer_operation_caisse(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb) from public, anon;
grant execute on function public.enregistrer_operation_caisse(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb) to authenticated;
revoke execute on function public.enregistrer_operations_de_caisse(uuid, jsonb) from public, anon;
grant execute on function public.enregistrer_operations_de_caisse(uuid, jsonb) to authenticated;
