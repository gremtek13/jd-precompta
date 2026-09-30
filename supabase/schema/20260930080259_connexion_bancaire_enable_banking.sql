-- Ligne 24 de la feuille de route : la connexion bancaire (agrégation DSP2), en preuve de concept sur le
-- bac à sable d'Enable Banking. Le cabinet connecte le compte d'un dossier ; ses mouvements sont
-- récupérés au clic et importés par le même chemin qu'un relevé, « à traiter » comme lui.
--
-- 1. L'IDENTIFIANT EXTERNE D'UN MOUVEMENT. C'est lui qui dédoublonne un mouvement récupéré deux fois,
-- plus sûrement que la date, le montant et le libellé, que deux paiements identiques du même jour
-- partagent. L'application le compose depuis la référence que la banque donne au mouvement
-- (`entry_reference`, stable d'une session à l'autre pour un même compte, mais pas unique d'un compte à
-- l'autre), préfixée de l'empreinte du compte. Nul pour un mouvement importé d'un relevé (CSV, PDF).
alter table public.lignes_bancaires add column id_externe text;

comment on column public.lignes_bancaires.id_externe is
  'Identifiant du mouvement chez le prestataire d''agrégation bancaire, préfixé de l''empreinte du '
  'compte : il dédoublonne un mouvement récupéré deux fois. Nul pour un mouvement importé d''un relevé.';

-- Contrainte TOTALE, comme toute contrainte unique de ce schéma : deux NULL ne sont jamais égaux, donc
-- les mouvements d'un relevé s'empilent comme avant, et un upsert peut la viser (`on conflict`), ce
-- qu'un index partiel interdirait.
alter table public.lignes_bancaires add constraint lignes_bancaires_id_externe_unique unique (dossier_id, id_externe);

-- 2. LA CONNEXION BANCAIRE D'UN DOSSIER : la banque, la session ouverte chez le prestataire, le
-- consentement et son échéance, les comptes qu'il ouvre et celui qu'on importe.
--
-- ATTEINTE PAR LA SEULE EDGE FUNCTION `banque-connexion`, avec la clé de service, après qu'elle a vérifié
-- `admin_du_dossier` : RLS activée SANS AUCUNE policy, donc refus total côté navigateur — le motif de
-- `superpdp_credentials`. L'identifiant de session ne quitte jamais le serveur : avec la clé privée de
-- l'application, il ouvre les mouvements du compte.
create table public.connexions_bancaires (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  fournisseur text not null default 'enable_banking',
  banque_nom text not null,
  banque_pays text not null,
  -- L'environnement de l'application chez le prestataire, relu au démarrage : un bac à sable rend des
  -- mouvements FICTIFS, et l'écran doit le dire avant qu'on les importe dans un dossier.
  environnement text not null,
  etat text not null default 'en_attente',
  -- Le `state` du retour de la banque : aléatoire, il relie le retour à CETTE demande.
  jeton_etat uuid not null default gen_random_uuid(),
  session_id text,
  valide_jusqu_au timestamptz,
  -- Les comptes que le consentement ouvre, sans rien de plus que ce qui sert à choisir : l'identifiant de
  -- session du compte, son empreinte stable, son nom, sa devise et la fin de son IBAN.
  comptes jsonb not null default '[]'::jsonb,
  compte_uid text,
  compte_empreinte text,
  derniere_recuperation timestamptz,
  -- Qui a connecté la banque. Pas de clé vers `auth.users` : l'Edge Function écrit avec la clé de
  -- service, et c'est elle qui pose l'appelant qu'elle a vérifié.
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint connexions_bancaires_fournisseur check (fournisseur = 'enable_banking'),
  constraint connexions_bancaires_banque_nom check (length(banque_nom) between 1 and 200),
  constraint connexions_bancaires_banque_pays check (banque_pays ~ '^[A-Z]{2}$'),
  constraint connexions_bancaires_environnement check (environnement in ('SANDBOX', 'PRODUCTION')),
  constraint connexions_bancaires_etat check (etat in ('en_attente', 'active')),
  constraint connexions_bancaires_comptes check (jsonb_typeof(comptes) = 'array'),
  -- En attente : ni session ni échéance ; active : les deux. Une connexion retirée est SUPPRIMÉE.
  constraint connexions_bancaires_etat_coherent check (
    (etat = 'en_attente' and session_id is null and valide_jusqu_au is null)
    or (etat = 'active' and session_id is not null and valide_jusqu_au is not null)),
  -- Un compte choisi porte son empreinte, l'espace de noms de ses identifiants externes.
  constraint connexions_bancaires_compte_choisi check ((compte_uid is null) = (compte_empreinte is null)),
  constraint connexions_bancaires_jeton_etat_unique unique (jeton_etat),
  constraint connexions_bancaires_session_unique unique (session_id)
);

comment on table public.connexions_bancaires is
  'Connexion bancaire d''un dossier chez le prestataire d''agrégation (Enable Banking) : session, '
  'consentement, comptes ouverts et compte importé. RLS sans policy : seule l''Edge Function '
  'banque-connexion la lit et l''écrit, après avoir vérifié admin_du_dossier.';

create index connexions_bancaires_dossier_id_idx on public.connexions_bancaires (dossier_id);

alter table public.connexions_bancaires enable row level security;
