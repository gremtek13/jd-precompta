-- LES DOUZE TABLES QUE LES MIGRATIONS NE CRÉENT PAS.
--
-- ── CE QUE CE FICHIER RÉPARE ──
--
-- `supabase/schema/` porte un export de l'historique de migrations, « une migration par fichier,
-- vérifié par empreinte », et PLAN_DE_REPRISE.md en tire la promesse qu'un schéma reste
-- reconstructible si le projet Supabase disparaît. Mesuré le 22/09/2026 : **l'historique ne porte
-- que 30 `create table` pour 41 tables**. Douze tables ont été créées hors `apply_migration` (éditeur
-- SQL, `execute_sql`), donc n'existent dans AUCUN fichier — parmi elles `lignes_bancaires`, la plus
-- grosse table du projet, et `ecritures_brouillon`, le cœur comptable dont sortent le FEC et la
-- balance.
--
-- ET LE CONTRÔLE DE DÉRIVE NE POUVAIT PAS LE VOIR, c'est tout l'intérêt de l'avoir écrit ici :
-- l'empreinte agrégée compare les FICHIERS aux MIGRATIONS et les trouve identiques — elle l'était
-- encore le 22/09/2026, 58 = 58, zéro divergence. Elle ne dit rien de ce que les migrations
-- RECONSTRUISENT. Une vérification qui prouve une chose plus faible que celle qu'on lui prête est la
-- panne que ce dépôt connaît sous plusieurs noms, et celle-ci portait sur le plan de reprise.
--
-- ── CE QUE CE FICHIER EST, ET CE QU'IL N'EST PAS ──
--
-- C'est un INSTANTANÉ du schéma vivant au 22/09/2026, généré depuis `pg_catalog` (et non écrit à la
-- main), puis ÉPROUVÉ par rejeu dans un schéma jetable et comparaison colonne à colonne avec
-- `public` — voir `supabase/essais/socle.sql`. Ce n'est PAS une migration : il ne s'applique pas
-- tout seul, il ne figure pas dans l'historique, et il vit dans un sous-dossier pour rester hors de
-- l'empreinte du contrôle de dérive, qui ne balaie que `supabase/schema/*.sql`.
--
-- IL DÉRIVERA, et c'est sa faiblesse à connaître : une migration future qui ajoute une colonne à
-- l'une de ces douze tables ne le met pas à jour. `sauvegardeTables.test.ts` garde la seule chose
-- qu'un test local puisse garder — qu'aucune table du plan de sauvegarde ne soit absente de
-- `supabase/schema/` — et le reste se remesure par le rejeu ci-dessus.
--
-- ── ORDRE ──
--
-- À appliquer APRÈS les migrations numérotées (il référence `dossiers`, `pieces`, `categories`) et
-- dans l'ordre de ce fichier, qui suit les dépendances entre les douze.

-- ─────────────────────────────── 1. tables ne dépendant que de `dossiers`

create table public.cotisations_declarees (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  echeance date not null,
  montant_appele numeric not null,
  montant_verse numeric,
  montant_csg_crds numeric,
  created_at timestamp with time zone default now() not null,
  previsionnel boolean default false not null,
  constraint cotisations_declarees_pkey PRIMARY KEY (id),
  constraint cotisations_declarees_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE
);

create table public.natures_immobilisation (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid,
  libelle text not null,
  duree_annees_defaut integer not null,
  ordre integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint natures_immobilisation_pkey PRIMARY KEY (id),
  constraint natures_immobilisation_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE
);

create table public.sous_dossiers (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  nom text not null,
  ordre integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint sous_dossiers_dossier_id_nom_key UNIQUE (dossier_id, nom),
  constraint sous_dossiers_pkey PRIMARY KEY (id),
  constraint sous_dossiers_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE
);

create table public.regles_bancaires_ignorees (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  motif text not null,
  created_at timestamp with time zone default now() not null,
  constraint regles_bancaires_ignorees_dossier_id_motif_key UNIQUE (dossier_id, motif),
  constraint regles_bancaires_ignorees_pkey PRIMARY KEY (id),
  constraint regles_bancaires_ignorees_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE
);

create table public.references_annuelles (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  annee integer not null,
  chiffre_affaires numeric,
  total_cotisations_sociales numeric,
  source text not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  resultat_net numeric,
  constraint references_annuelles_dossier_id_annee_key UNIQUE (dossier_id, annee),
  constraint references_annuelles_pkey PRIMARY KEY (id),
  constraint references_annuelles_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE,
  constraint references_annuelles_source_check CHECK ((source = ANY (ARRAY['calculee'::text, 'saisie_manuelle'::text])))
);

create table public.references_postes_annuels (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  annee integer not null,
  poste text not null,
  montant numeric not null,
  created_at timestamp with time zone default now() not null,
  constraint references_postes_annuels_dossier_id_annee_poste_key UNIQUE (dossier_id, annee, poste),
  constraint references_postes_annuels_pkey PRIMARY KEY (id),
  constraint references_postes_annuels_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE
);

create table public.informations_dossier (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  vehicule_type text default 'aucun'::text not null,
  vehicule_libelle text,
  jours_travailles_an integer,
  tickets_restaurant boolean default false not null,
  justificatif_tickets_restaurant_recu boolean default false not null,
  cheques_vacances boolean default false not null,
  justificatif_cheques_vacances_recu boolean default false not null,
  notes text,
  updated_at timestamp with time zone default now() not null,
  constraint informations_dossier_dossier_id_key UNIQUE (dossier_id),
  constraint informations_dossier_pkey PRIMARY KEY (id),
  constraint informations_dossier_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE,
  constraint informations_dossier_vehicule_type_check CHECK ((vehicule_type = ANY (ARRAY['aucun'::text, 'personnel_ik'::text, 'societe'::text])))
);

-- ─────────────────────────────── 2. tables dépendant de `categories` / `pieces`

create table public.tiers_categories (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  tiers_normalise text not null,
  categorie_id uuid not null,
  updated_at timestamp with time zone default now() not null,
  constraint tiers_categories_dossier_id_tiers_normalise_key UNIQUE (dossier_id, tiers_normalise),
  constraint tiers_categories_pkey PRIMARY KEY (id),
  constraint tiers_categories_categorie_id_fkey FOREIGN KEY (categorie_id) REFERENCES categories(id),
  constraint tiers_categories_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE
);

-- `lignes_bancaires_un_seul_rapprochement` porte une règle métier qu'aucun code ne peut remplacer :
-- une ligne se rapproche d'UNE pièce ou d'UNE cotisation, jamais des deux.
create table public.lignes_bancaires (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  date date not null,
  libelle text not null,
  montant numeric(12,2) not null,
  statut text default 'non_rapprochee'::text not null,
  piece_id uuid,
  created_at timestamp with time zone default now() not null,
  cotisation_id uuid,
  prelevement_personnel boolean default false not null,
  source_fichier text,
  libelle_brut text,
  constraint lignes_bancaires_pkey PRIMARY KEY (id),
  constraint lignes_bancaires_cotisation_id_fkey FOREIGN KEY (cotisation_id) REFERENCES cotisations_declarees(id) ON DELETE SET NULL,
  constraint lignes_bancaires_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE,
  constraint lignes_bancaires_piece_id_fkey FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE SET NULL,
  constraint lignes_bancaires_statut_check CHECK ((statut = ANY (ARRAY['non_rapprochee'::text, 'rapprochee'::text, 'ignoree'::text]))),
  constraint lignes_bancaires_un_seul_rapprochement CHECK (((piece_id IS NULL) OR (cotisation_id IS NULL)))
);

create table public.documents_divers (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  sous_dossier_id uuid,
  storage_path text not null,
  nom_fichier text not null,
  categorie text not null,
  attached_to_cotisation_id uuid,
  notes text,
  created_at timestamp with time zone default now() not null,
  storage_hash text,
  constraint documents_divers_pkey PRIMARY KEY (id),
  constraint documents_divers_attached_to_cotisation_id_fkey FOREIGN KEY (attached_to_cotisation_id) REFERENCES cotisations_declarees(id) ON DELETE SET NULL,
  constraint documents_divers_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE,
  constraint documents_divers_sous_dossier_id_fkey FOREIGN KEY (sous_dossier_id) REFERENCES sous_dossiers(id),
  constraint documents_divers_categorie_check CHECK ((categorie = ANY (ARRAY['releve_bancaire'::text, 'cotisation'::text, 'attestation'::text, 'autre'::text])))
);

create table public.immobilisations (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  piece_id uuid,
  libelle text not null,
  valeur numeric not null,
  date_acquisition date not null,
  duree_annees integer default 5 not null,
  created_at timestamp with time zone default now() not null,
  nature_id uuid,
  constraint immobilisations_piece_id_unique UNIQUE (piece_id),
  constraint immobilisations_pkey PRIMARY KEY (id),
  constraint immobilisations_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE,
  constraint immobilisations_nature_id_fkey FOREIGN KEY (nature_id) REFERENCES natures_immobilisation(id),
  constraint immobilisations_piece_id_fkey FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE SET NULL,
  constraint immobilisations_duree_positive CHECK ((duree_annees > 0)),
  constraint immobilisations_valeur_positive CHECK ((valeur > (0)::numeric))
);

-- Les deux clés étrangères en ON DELETE SET NULL sont exactement celles qui produisent les ruptures
-- de piste d'audit décrites dans CLAUDE.md : Postgres efface le lien sans un mot.
create table public.ecritures_brouillon (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  piece_id uuid,
  ligne_bancaire_id uuid,
  date date not null,
  compte text not null,
  libelle text not null,
  montant numeric not null,
  sens text not null,
  statut text default 'proposee'::text not null,
  created_at timestamp with time zone default now() not null,
  constraint ecritures_brouillon_pkey PRIMARY KEY (id),
  constraint ecritures_brouillon_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE,
  constraint ecritures_brouillon_ligne_bancaire_id_fkey FOREIGN KEY (ligne_bancaire_id) REFERENCES lignes_bancaires(id) ON DELETE SET NULL,
  constraint ecritures_brouillon_piece_id_fkey FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE SET NULL,
  constraint ecritures_brouillon_montant_positif CHECK ((montant > (0)::numeric)),
  constraint ecritures_brouillon_sens_check CHECK ((sens = ANY (ARRAY['debit'::text, 'credit'::text]))),
  constraint ecritures_brouillon_statut_check CHECK ((statut = ANY (ARRAY['proposee'::text, 'validee'::text])))
);

-- ─────────────────────────────── 3. index hors contraintes

CREATE INDEX documents_divers_dossier_hash_idx ON public.documents_divers USING btree (dossier_id, storage_hash);
CREATE UNIQUE INDEX immobilisations_piece_unique ON public.immobilisations USING btree (piece_id) WHERE (piece_id IS NOT NULL);
CREATE INDEX lignes_bancaires_dossier_id_idx ON public.lignes_bancaires USING btree (dossier_id);
CREATE INDEX lignes_bancaires_statut_idx ON public.lignes_bancaires USING btree (statut);

-- ─────────────────────────────── 4. RLS
--
-- SANS CE BLOC, LES DOUZE TABLES SERAIENT GRANDES OUVERTES. Une table restaurée sans RLS n'est pas
-- une table « à sécuriser plus tard » : elle est lisible par tout Internet muni de la clé publique,
-- et rien ne le signale. C'est la moitié la plus coûteuse à oublier d'une reconstruction.

alter table public.cotisations_declarees enable row level security;
alter table public.documents_divers enable row level security;
alter table public.ecritures_brouillon enable row level security;
alter table public.immobilisations enable row level security;
alter table public.informations_dossier enable row level security;
alter table public.lignes_bancaires enable row level security;
alter table public.natures_immobilisation enable row level security;
alter table public.references_annuelles enable row level security;
alter table public.references_postes_annuels enable row level security;
alter table public.regles_bancaires_ignorees enable row level security;
alter table public.sous_dossiers enable row level security;
alter table public.tiers_categories enable row level security;

-- ─────────────────────────────── 5. policies
--
-- REPRODUITES TELLES QUE LE CATALOGUE LES REND, sans reformatage — clause `to` comprise, y compris
-- `to public`, que 70 des 73 policies du schéma portent (voir CLAUDE.md). Ce qui ferme l'accès est
-- le PRÉDICAT : `admin_du_dossier(...)` rend `false` sans session.
--
-- LE NON-REFORMATAGE EST CE QUI REND CE FICHIER VÉRIFIABLE : tout est copié du rendu de
-- `pg_policies`, donc `supabase/essais/socle.py` peut régénérer depuis la base et comparer AU
-- CARACTÈRE PRÈS. Une version « propre » écrite à la main serait sémantiquement équivalente et
-- invérifiable — c'est-à-dire exactement le genre de plan de reprise qu'on croit avoir.

create policy "cotisations_declarees_all" on public.cotisations_declarees
  for all to public
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create policy "membres peuvent lire leurs cotisations" on public.cotisations_declarees
  for select to public
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = cotisations_declarees.dossier_id) AND (m.user_id = auth.uid())))));

create policy "documents_divers_admins_all" on public.documents_divers
  for all to public
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create policy "membres peuvent deposer des documents" on public.documents_divers
  for insert to public
  with check ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = documents_divers.dossier_id) AND (m.user_id = auth.uid())))));

create policy "membres peuvent lire leurs documents" on public.documents_divers
  for select to public
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = documents_divers.dossier_id) AND (m.user_id = auth.uid())))));

create policy "ecritures_brouillon_all" on public.ecritures_brouillon
  for all to public
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create policy "immobilisations_all" on public.immobilisations
  for all to public
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create policy "informations_dossier_admins_all" on public.informations_dossier
  for all to public
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create policy "membres peuvent deposer leurs informations" on public.informations_dossier
  for insert to public
  with check ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = informations_dossier.dossier_id) AND (m.user_id = auth.uid())))));

create policy "membres peuvent lire leurs informations" on public.informations_dossier
  for select to public
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = informations_dossier.dossier_id) AND (m.user_id = auth.uid())))));

create policy "membres peuvent modifier leurs informations" on public.informations_dossier
  for update to public
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = informations_dossier.dossier_id) AND (m.user_id = auth.uid())))))
  with check ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = informations_dossier.dossier_id) AND (m.user_id = auth.uid())))));

create policy "lignes_bancaires_all" on public.lignes_bancaires
  for all to public
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create policy "membres peuvent lire leurs lignes bancaires" on public.lignes_bancaires
  for select to public
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = lignes_bancaires.dossier_id) AND (m.user_id = auth.uid())))));

create policy "natures_immobilisation_delete" on public.natures_immobilisation
  for delete to public
  using ((((dossier_id IS NULL) AND is_super_admin()) OR ((dossier_id IS NOT NULL) AND admin_du_dossier(dossier_id))));

create policy "natures_immobilisation_select" on public.natures_immobilisation
  for select to authenticated
  using (((dossier_id IS NULL) OR admin_du_dossier(dossier_id)));

create policy "natures_immobilisation_update" on public.natures_immobilisation
  for update to public
  using ((((dossier_id IS NULL) AND is_super_admin()) OR ((dossier_id IS NOT NULL) AND admin_du_dossier(dossier_id))))
  with check ((((dossier_id IS NULL) AND is_super_admin()) OR ((dossier_id IS NOT NULL) AND admin_du_dossier(dossier_id))));

create policy "natures_immobilisation_write" on public.natures_immobilisation
  for insert to public
  with check ((((dossier_id IS NULL) AND is_super_admin()) OR ((dossier_id IS NOT NULL) AND admin_du_dossier(dossier_id))));

create policy "membres peuvent lire leurs references annuelles" on public.references_annuelles
  for select to public
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = references_annuelles.dossier_id) AND (m.user_id = auth.uid())))));

create policy "references_annuelles_all" on public.references_annuelles
  for all to public
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create policy "membres peuvent lire leurs references postes" on public.references_postes_annuels
  for select to public
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = references_postes_annuels.dossier_id) AND (m.user_id = auth.uid())))));

create policy "references_postes_annuels_all" on public.references_postes_annuels
  for all to public
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create policy "regles_bancaires_ignorees_all" on public.regles_bancaires_ignorees
  for all to public
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create policy "sous_dossiers_delete" on public.sous_dossiers
  for delete to public
  using (admin_du_dossier(dossier_id));

create policy "sous_dossiers_insert" on public.sous_dossiers
  for insert to public
  with check (admin_du_dossier(dossier_id));

create policy "sous_dossiers_select" on public.sous_dossiers
  for select to public
  using ((admin_du_dossier(dossier_id) OR (EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = sous_dossiers.dossier_id) AND (m.user_id = auth.uid()))))));

create policy "sous_dossiers_update" on public.sous_dossiers
  for update to public
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create policy "tiers_categories_select" on public.tiers_categories
  for select to public
  using ((admin_du_dossier(dossier_id) OR (EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.dossier_id = tiers_categories.dossier_id) AND (m.user_id = auth.uid()))))));

create policy "tiers_categories_update" on public.tiers_categories
  for update to public
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));

create policy "tiers_categories_write" on public.tiers_categories
  for insert to public
  with check (admin_du_dossier(dossier_id));
