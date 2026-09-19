-- Contrôle de cohérence d'un relevé bancaire importé : solde d'ouverture + somme des mouvements
-- doit donner le solde de clôture. Le résultat vivait jusqu'ici dans un window.alert() à l'import,
-- donc il disparaissait au premier clic — un relevé incomplet redevenait invisible, alors que c'est
-- exactement ce qu'un cabinet doit savoir avant de bâtir une comptabilité dessus.
create table public.controles_releves_bancaires (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  -- Nom du fichier importé. Nullable parce que certains chemins d'import n'en portent pas ;
  -- l'unicité ne s'applique donc qu'aux relevés nommés (voir l'index partiel plus bas).
  source_fichier text,
  solde_initial numeric(12,2) not null,
  solde_final numeric(12,2) not null,
  somme_mouvements numeric(12,2) not null,
  -- (solde_initial + somme_mouvements) − solde_final. Positif : le relevé porte plus d'entrées que
  -- le solde ne le justifie, donc il manque des sorties (ou des entrées sont en double).
  ecart numeric(12,2) not null,
  coherent boolean not null,
  -- Dates des deux lignes de solde : c'est ce qui permet de dire QUEL relevé ne boucle pas.
  periode_debut date,
  periode_fin date,
  created_at timestamptz not null default now()
);

-- Réimporter le même fichier remplace son contrôle au lieu d'en empiler un second.
create unique index controles_releves_bancaires_fichier_unique
  on public.controles_releves_bancaires (dossier_id, source_fichier)
  where source_fichier is not null;

create index controles_releves_bancaires_dossier_idx
  on public.controles_releves_bancaires (dossier_id);

alter table public.controles_releves_bancaires enable row level security;

-- Convention du projet pour toute table métier rattachée à un dossier : une policy unique FOR ALL
-- fondée sur admin_du_dossier(). Le client n'a rien à voir ici (il ne voit ni montants ni banque).
create policy controles_releves_bancaires_all on public.controles_releves_bancaires
  for all using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));
