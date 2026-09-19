-- Historique de conversation de l'agent comptable, par dossier — persiste ce qui jusqu'ici ne
-- vivait qu'en mémoire côté navigateur (perdu au changement d'onglet ou au rechargement).
-- Le cabinet est traité comme un seul acteur de confiance, comme partout ailleurs dans l'appli
-- (declarations_tva, tiers_categories_cabinet...) : pas de séparation par utilisateur cabinet,
-- tous les admins partagent la même conversation pour un dossier donné. created_by est un simple
-- repère d'audit (qui a écrit quoi), jamais utilisé pour restreindre l'accès.
create table public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  texte text not null,
  outils_utilises text[],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index agent_conversations_dossier_id_created_at_idx
  on public.agent_conversations (dossier_id, created_at);

alter table public.agent_conversations enable row level security;

create policy "cabinet admins full access" on public.agent_conversations
  for all
  using (exists (select 1 from public.cabinet_admins ca where ca.user_id = auth.uid()));
