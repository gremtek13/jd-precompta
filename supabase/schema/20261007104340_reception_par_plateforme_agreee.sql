-- Ligne 28.5 de la feuille de route, étape (b) : la réception des factures électroniques par la plateforme agréée
-- du client. Depuis le 1er septembre 2026, toute entreprise reçoit ses factures par une plateforme agréée, la sienne ;
-- le cabinet les fait entrer dans le dossier par l'API que la norme AFNOR XP Z12-013 impose à toutes (« Flow
-- Service »), au clic, sous une identité que l'entreprise lui a ouverte. L'Edge Function `plateforme-agreee` parle à
-- la plateforme ; l'écran importe chaque facture en pièce « à valider », comme un dépôt.
--
-- 1. LA CONNEXION D'UN DOSSIER À LA PLATEFORME DE SON CLIENT : une par dossier — l'adresse du service des flux et
-- celle des jetons, l'identifiant et le secret OAuth2 que l'entreprise a ouverts au cabinet, l'organisation quand ce
-- compte en sert plusieurs, et le point d'où repart la recherche suivante.
--
-- ATTEINTE PAR LA SEULE EDGE FUNCTION `plateforme-agreee`, avec la clé de service, après qu'elle a vérifié
-- `admin_du_dossier` : RLS activée SANS AUCUNE policy, donc refus total côté navigateur — le motif de
-- `superpdp_credentials` et de `connexions_bancaires`. Le secret ne quitte jamais le serveur : il ouvre toutes les
-- factures de l'entreprise, reçues comme émises.
create table public.connexions_plateformes (
  dossier_id uuid primary key references public.dossiers(id) on delete cascade,
  -- Le nom que le cabinet donne à la plateforme, affiché seulement.
  nom text not null,
  -- L'adresse du service des flux, en amont de la version de l'API (« /v1 ») : propre à chaque plateforme.
  url_flux text not null,
  -- L'adresse où la plateforme délivre ses jetons (OAuth2, « client credentials »).
  url_jeton text not null,
  client_id text not null,
  client_secret text not null,
  -- L'entreprise, quand l'identité ouverte au cabinet en sert plusieurs (en-tête « Organisation-Id » de la norme).
  organisation_id text,
  -- La portée à demander avec le jeton, quand la plateforme en exige une.
  portee text,
  -- D'où repart la recherche suivante (`updatedAfter`) : jamais au-delà de la dernière facture importée, ni de
  -- l'instant de la lecture moins une marge — un flux peut devenir visible un peu après sa date de mise à jour.
  -- Nul tant que rien n'a été importé : la première recherche part du début.
  recherche_depuis timestamptz,
  derniere_recuperation timestamptz,
  -- Qui a configuré la connexion. Pas de clé vers `auth.users` : l'Edge Function écrit avec la clé de service, et
  -- c'est elle qui pose l'appelant qu'elle a vérifié.
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connexions_plateformes_nom check (length(btrim(nom)) between 1 and 80),
  -- En https, vers un nom d'hôte dont le dernier segment commence par une lettre — ni adresse IP, ni « localhost » —,
  -- sans port, sans identifiants, sans requête ni fragment, sans barre finale : la fonction y envoie un secret, et
  -- refuse en plus les suffixes des réseaux internes.
  constraint connexions_plateformes_url_flux check (
    length(url_flux) <= 500 and right(url_flux, 1) <> '/'
    and url_flux ~ '^https://([a-z0-9-]+\.)+[a-z][a-z0-9-]*(/[^[:space:]?#]*)?$'),
  constraint connexions_plateformes_url_jeton check (
    length(url_jeton) <= 500 and right(url_jeton, 1) <> '/'
    and url_jeton ~ '^https://([a-z0-9-]+\.)+[a-z][a-z0-9-]*(/[^[:space:]?#]*)?$'),
  constraint connexions_plateformes_client_id check (length(client_id) between 1 and 500),
  constraint connexions_plateformes_client_secret check (length(client_secret) between 1 and 2000),
  -- Une valeur d'en-tête HTTP : des caractères visibles, sans espace.
  constraint connexions_plateformes_organisation_id check (organisation_id ~ '^[!-~]{1,200}$'),
  -- Des jetons de portée séparés par une espace (RFC 6749, 3.3).
  constraint connexions_plateformes_portee check (length(portee) <= 500 and portee ~ '^[!-~]+( [!-~]+)*$')
);

comment on table public.connexions_plateformes is
  'Connexion d''un dossier à la plateforme agréée de son client (API AFNOR XP Z12-013, « Flow Service ») : adresses, '
  'identifiant et secret OAuth2, organisation, et le point d''où repart la recherche des factures. RLS sans policy : '
  'seule l''Edge Function plateforme-agreee la lit et l''écrit, après avoir vérifié admin_du_dossier.';

alter table public.connexions_plateformes enable row level security;

-- 2. LE FLUX D'UNE PIÈCE REÇUE DE LA PLATEFORME : l'hôte de la plateforme et l'identifiant qu'elle donne au flux.
-- C'est lui qui dédoublonne une facture reçue deux fois — deux recherches se recouvrent, par construction —, plus
-- sûrement que l'empreinte du fichier. L'hôte en fait partie : la norme ne dit rien de la forme d'un identifiant, et
-- une autre plateforme, si le client en change, peut donner le même à une autre facture.
--
-- Et LA VERSION LISIBLE d'une facture reçue en XML (CII ou UBL), telle que la plateforme la rend : l'original reste
-- dans `storage_path`, c'est lui que l'empreinte prouve. Une pièce qui porte une écriture validée garde l'un et
-- l'autre : `garder_piece_validee` compare la ligne entière.
alter table public.pieces add column flux_hote text, add column flux_id text, add column lisible_path text;

comment on column public.pieces.flux_hote is
  'Hôte de la plateforme agréée qui a transmis la facture (source « plateforme ») ; avec flux_id, l''identité du flux.';
comment on column public.pieces.flux_id is
  'Identifiant du flux chez la plateforme agréée (flowId) : il dédoublonne une facture reçue deux fois.';
comment on column public.pieces.lisible_path is
  'Version lisible d''une facture reçue en XML, rendue par la plateforme ; l''original reste dans storage_path. Nul '
  'quand l''original se lit déjà (PDF, Factur-X).';

alter table public.pieces add constraint pieces_flux_coherent check ((flux_hote is null) = (flux_id is null));
alter table public.pieces add constraint pieces_flux_hote_format check (
  length(flux_hote) <= 253 and flux_hote ~ '^([a-z0-9-]+\.)+[a-z][a-z0-9-]*$');
alter table public.pieces add constraint pieces_flux_id_format check (length(flux_id) between 1 and 200);
-- Une pièce porte un flux si et seulement si elle vient de la plateforme : un flux sans cette provenance ferait
-- passer la facture pour déjà importée sans qu'on sache d'où elle vient, et l'inverse ne se dédoublonnerait pas.
alter table public.pieces add constraint pieces_flux_plateforme check ((source = 'plateforme') = (flux_id is not null));
alter table public.pieces add constraint pieces_lisible_distinct check (lisible_path <> storage_path);
-- Contrainte TOTALE, comme toute contrainte unique de ce schéma : deux NULL ne sont jamais égaux, donc les autres
-- pièces ne se heurtent pas, et l'import peut la viser (`on conflict`).
alter table public.pieces add constraint pieces_flux_unique unique (dossier_id, flux_hote, flux_id);

-- 3. CE QU'UN CLIENT DÉPOSE : une pièce « à valider », sans catégorie, venue de son dépôt et de personne d'autre. La
-- policy le laissait écrire n'importe quelle colonne de la pièce qu'il dépose : une pièce déjà validée et rangée dans
-- une catégorie, qui serait partie dans la 2035 sans que le cabinet l'ait vue — la validation est un geste du
-- cabinet —, ou une pièce qui se dirait reçue de la plateforme, dont le flux passerait alors pour importé, et la vraie
-- facture ne viendrait jamais. Le dépôt du client (`lib/depot.ts`) n'écrit que cela ; la branche du cabinet ne change
-- pas.
alter policy pieces_insert on public.pieces to authenticated
  with check (
    admin_du_dossier(dossier_id)
    or (exists (select 1 from public.memberships m
                 where m.dossier_id = pieces.dossier_id and m.user_id = (select auth.uid()))
        and source = 'upload' and statut = 'a_valider' and categorie_id is null
        and superpdp_invoice_id is null and lisible_path is null
        and (uploaded_by is null or uploaded_by = (select auth.uid()))));
