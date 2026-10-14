-- L'ENCART « FACTURE ÉLECTRONIQUE », EN BASE (espace client, étape A6a ; ligne 51.5 ; conception : HISTORIQUE.md,
-- « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.6 et §A.7 ; MEG1-Q16
-- tranchée par le cabinet le 14/10/2026, « comme recommandé »). Présentée au cabinet avant d'être appliquée : elle OUVRE
-- au client qui porte la case « Ventes » la lecture d'une table, et une fonction qui lit pour lui deux tables qu'il ne lit
-- pas (CLAUDE.md, « une policy qui lui ouvre une lecture se présente au cabinet »).
--
-- CE QU'ELLE POSE :
--   - `adresses_reception` : l'adresse à laquelle le dossier REÇOIT ses factures électroniques, telle que l'annuaire de la
--     facturation électronique la publie — l'identifiant d'adressage et sa maille, le nom de la plateforme de réception,
--     la date de prise d'effet —, DÉCLARÉE par le cabinet ou par le client « Ventes », avec ce qui l'a vérifiée et quand ;
--   - `declarer_adresse_reception`, la seule écriture ;
--   - `etat_facture_electronique`, l'état de la facture électronique d'un dossier, qui ne rend RIEN de secret.
--
-- POURQUOI DÉCLARÉE, ET NON LUE. L'annuaire range, pour chaque entreprise, des lignes dont l'identifiant d'adressage est
-- « Ouvert », mais dont la date de prise d'effet et le matricule de la plateforme de réception sont « Restreint aux PA »
-- (DGFiP, spécifications externes de la facturation électronique v3.2 du 30/04/2026, annexe 3 v1.8, flux F14 : DT-7-5-1,
-- DT-7-3-1, DT-7-6) ; son API n'est ouverte qu'aux partenaires habilités et raccordés, son PORTAIL se consulte sans
-- authentification (dossier général v3.2, §3.5.3 et §3.5.4). L'adresse et sa date de prise d'effet sont donc DÉCLARÉES,
-- vérifiées sur ce portail ou sur la plateforme du client (MEG1-Q16) ; rien ici n'appelle l'annuaire ni une plateforme.
--
-- L'IDENTIFIANT D'ADRESSAGE (annexe 3 v1.8, DT-7-5-1, 125 caractères) « est obtenu en concaténant » le SIREN, le SIRET,
-- l'identifiant de routage et le suffixe, « séparés par un '_' » : SIREN, SIREN_SIRET, SIREN_SIRET_routage ou
-- SIREN_suffixe — les quatre MAILLES. Leurs formes : le SIREN, neuf chiffres (annexe 7 v1.9, G1.89) ; le SIRET, quatorze
-- (G2.07), qui commence par le SIREN (G1.80) ; le routage, avec un SIRET seulement (G1.91), cent caractères au plus
-- (DT-7-5-1-3) ; le suffixe, jamais avec un SIRET (G1.93), cent au plus (DT-7-5-1-4). Les caractères d'un routage et d'un
-- suffixe sont ceux de l'API publique de l'annuaire (même archive, OpenAPI 1.11.0 : `identifiantRoutage`
-- `[-_/@a-zA-Z0-9]{1,100}`, `suffixeAdressage` `[-_.@a-zA-Z0-9]{1,100}`), que la base admet déjà pour l'adresse
-- électronique d'un acheteur (`factures_emises_adresse_electronique_check`, 07/10/2026). L'annexe 7 en dit MOINS (G1.95 :
-- ni « / » ni « @ » dans un routage ; G1.115 : ni « @ » dans un suffixe) : laquelle des deux l'annuaire applique n'est PAS
-- VÉRIFIÉ, et la plus large ne refuse pas une adresse que le portail montrerait. Un identifiant seul ne dit pas toujours sa
-- maille — « neuf chiffres _ quatorze chiffres » peut être un SIRET ou un suffixe, un suffixe peut porter des « _ » — : la
-- MAILLE se déclare avec lui, et la fonction juge l'un par l'autre.
--
-- LE SIREN DU DOSSIER n'a pas de colonne : il se tire de `dossiers.siret`, comme le fait l'application (src/lib/
-- factureElectronique.ts, `sirenDuDossier`) — les blancs retirés (ceux que `\s` désigne en JavaScript, écrits un à un pour
-- ne dépendre d'aucune locale), quatorze chiffres donnent les neuf premiers, neuf chiffres le SIREN lui-même, toute autre
-- valeur aucun. Un dossier sans SIREN ne déclare pas d'adresse : rien ne prouverait qu'elle est la sienne.
--
-- VERSIONNÉE, comme les paramètres de facturation le seront (§A.5) et sur le patron des décisions de la révision : une
-- déclaration nouvelle REMPLACE la courante (`remplace_id`, UNE chaîne par dossier, une seule première), aucune ne se
-- modifie ni ne se supprime, sauf avec son dossier ; l'histoire reste (qui a déclaré quoi, quand, vérifié où). La version
-- COURANTE est celle qu'aucune ne remplace ; « en vigueur » se juge au jour de Paris, par l'application qui lit (src/lib/
-- etatFactureElectronique.ts), sur la courante seule.
--
-- QUI LIT, QUI ÉCRIT. Le cabinet du dossier (`admin_du_dossier`) et un accès client qui porte « Ventes »
-- (`client_du_dossier(…, 'ventes')`, la policy à part `adresses_reception_lecture_ventes`, comme les dix tables des ventes)
-- LISENT les adresses de ce dossier, histoire comprise ; personne d'autre. PERSONNE n'écrit directement :
-- `declarer_adresse_reception` vérifie l'accès d'abord — le cabinet ou le client « Ventes », `gere_les_ventes` (MEG1-Q16) —,
-- énumère les colonnes qu'elle écrit, ne supprime rien, refuse dans un ordre fixé que src/lib/adressesReception.ts redit
-- avant le clic ; le super-administrateur seul insère, pour restaurer une sauvegarde. Aucune policy de mise à jour ni de
-- suppression, pour personne, et une garde refuse même au propriétaire de modifier ou de supprimer une ligne.
--
-- L'ÉTAT, SANS RIEN DE SECRET. `connexions_plateformes` et `superpdp_credentials` n'ont aucune policy, et n'en auront pas :
-- elles portent les identifiants et les secrets des connexions. `etat_facture_electronique` les lit pour le cabinet et le
-- client « Ventes » (le patron de `couverture_du_releve`, étape P7, qui lit pour un accès une table qu'il ne lit pas) et
-- n'en rend que des booléens, un nom et des dates : reliée ou non, le nom de la plateforme, créée le, dernière
-- récupération, statuts lus le ; Super PDP relié ou non, depuis le ; et l'adresse de réception courante. JAMAIS `url_flux`,
-- `url_jeton`, `client_id`, `client_secret`, `organisation_id` ni `portee`, sous aucune forme (ni longueur, ni empreinte,
-- ni préfixe) — ni le point de reprise de la réception, ni qui a relié la plateforme. UNE valeur `jsonb` : PostgREST
-- plafonne les lignes, pas une valeur.
--
-- CE QU'ELLE SUPPOSE : les migrations de l'étape P2 (`gere_les_ventes`, la case « Ventes ») ; son premier bloc le vérifie.
-- CE QU'ELLE NE FAIT PAS : aucune table, policy ni fonction d'hier n'est modifiée ; aucune donnée n'est lue, écrite ni
-- retirée ; aucun écran (étape A6b), aucune Edge Function. Le texte ne porte aucune instruction qui retire quoi que ce soit
-- (le mot n'y paraît que dans `on delete cascade` et dans la garde, `before … or delete` et `tg_op = 'DELETE'`, formes
-- qu'`apply_migration` a prises sans confirmation le 10/10/2026) : le retour arrière est donné à part. Règlement (UE)
-- 2016/679, art. 25 § 2 : par défaut rien n'est ouvert, la case « Ventes » est fausse tant que le cabinet ne la coche pas.

-- ══ 0. Les migrations de l'étape P2 d'abord ══════════
do $garde$
begin
  if to_regprocedure('public.gere_les_ventes(uuid)') is null
     or to_regprocedure('public.client_du_dossier(uuid, text)') is null then
    raise exception 'Les migrations de l''étape P2 (ventes_du_client) ne sont pas en base : les appliquer d''abord, puis celle-ci.';
  end if;
end
$garde$;

-- ══ 1. La table ══════════
-- La maille et l'identifiant se jugent l'un par l'autre (les formes de l'en-tête). Le nom de la plateforme tient en 99
-- caractères, ceux que l'annuaire donne à sa raison sociale et à son appellation commerciale (annexe 3 v1.8, DT-6-6 et
-- DT-6-7). Une date de l'annuaire est entre 2000 et 2099 (annexe 7 v1.9, G1.36) : la prise d'effet, et le jour de la
-- vérification. La vérification se dit : sur le portail de l'annuaire, sur la plateforme, ou aucune — la seule
-- déclaration, sans jour de vérification. L'auteur est un repère d'audit sans clé vers les comptes, comme
-- `dossier_permanent.auteur` : retirer le compte d'un membre parti n'efface pas qui a déclaré.
create table public.adresses_reception (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  forme text not null
    constraint adresses_reception_forme
      check (forme in ('siren', 'siren_siret', 'siren_siret_routage', 'siren_suffixe')),
  identifiant text not null,
  plateforme text not null
    constraint adresses_reception_plateforme
      check (btrim(plateforme, E' \t\n\r') <> '' and char_length(plateforme) <= 99),
  prise_effet date not null
    constraint adresses_reception_prise_effet check (prise_effet between date '2000-01-01' and date '2099-12-31'),
  verification text not null
    constraint adresses_reception_verification check (verification in ('portail_annuaire', 'plateforme', 'declaration')),
  verifiee_le date
    constraint adresses_reception_verifiee_le check (verifiee_le between date '2000-01-01' and date '2099-12-31'),
  remplace_id uuid references public.adresses_reception (id),
  auteur uuid not null,
  cree_le timestamptz not null default now(),
  constraint adresses_reception_identifiant check (
    case forme
      when 'siren' then identifiant ~ '^[0-9]{9}$'
      when 'siren_siret' then identifiant ~ '^[0-9]{9}_[0-9]{14}$' and substr(identifiant, 11, 9) = left(identifiant, 9)
      when 'siren_siret_routage' then identifiant ~ '^[0-9]{9}_[0-9]{14}_[-_/@a-zA-Z0-9]{1,100}$'
                                      and substr(identifiant, 11, 9) = left(identifiant, 9)
      when 'siren_suffixe' then identifiant ~ '^[0-9]{9}_[-_.@a-zA-Z0-9]{1,100}$'
    end),
  constraint adresses_reception_verification_datee check ((verification = 'declaration') = (verifiee_le is null)),
  constraint adresses_reception_une_suite unique (remplace_id)
);
-- Une seule PREMIÈRE déclaration par dossier. Avec l'unicité de `remplace_id` et la garde (une version en remplace une de
-- son dossier), chaque dossier porte une CHAÎNE linéaire, et la courante est celle qu'aucune ne remplace. Partiel, et
-- c'est un invariant : aucun upsert ne le vise (le patron de `revision_seuils_un_premier`).
create unique index adresses_reception_une_premiere on public.adresses_reception (dossier_id) where remplace_id is null;
create index adresses_reception_dossier on public.adresses_reception (dossier_id);

-- ══ 2. La garde ══════════
-- Une adresse déclarée ne se modifie pas et ne se supprime pas — sauf avec son dossier entier, que la ligne ne voit déjà
-- plus pendant la cascade (le critère des gardes de la révision) ; elle en remplace une de SON dossier. Aux droits de
-- l'appelant : la fonction (propriétaire) et la restauration (super-administrateur) voient la version qu'une ligne
-- remplace. Ce que la fonction vérifie de plus — la version COURANTE, le SIREN du dossier — ne se rejoue pas ici : une
-- restauration réinsère l'histoire telle qu'elle a été écrite, même quand le SIRET du dossier a changé depuis.
create function public.garder_adresse_reception() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une adresse de réception déclarée ne se supprime pas : une nouvelle déclaration la remplace, et l''historique reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une adresse de réception déclarée ne se modifie pas : une nouvelle déclaration la remplace.'
      using errcode = '23514';
  end if;
  if new.remplace_id is not null
     and not exists (select 1 from public.adresses_reception a where a.id = new.remplace_id and a.dossier_id = new.dossier_id) then
    raise exception 'Une adresse de réception en remplace une de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger adresses_reception_gardes
  before insert or update or delete on public.adresses_reception
  for each row execute function public.garder_adresse_reception();

-- ══ 3. Qui lit, qui écrit ══════════
alter table public.adresses_reception enable row level security;
create policy adresses_reception_lecture on public.adresses_reception
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy adresses_reception_lecture_ventes on public.adresses_reception
  for select to authenticated using (public.client_du_dossier(dossier_id, 'ventes'));
create policy adresses_reception_restauration on public.adresses_reception
  for insert to authenticated with check (public.is_super_admin());

-- ══ 4. Déclarer l'adresse de réception ══════════
-- Une première déclaration (`p_remplace_id` nul), ou une nouvelle version qui remplace la COURANTE. Sous un verrou du
-- dossier : deux déclarations concurrentes se suivent, et la seconde voit la première (rang 7). Rend la ligne écrite.
--
-- Les refus, en sept rangs et dans cet ordre — l'ordre de la conception, et ce que l'état réel y ajoute (un dossier sans
-- SIREN, la plateforme, la vérification) à leur place ; le module (src/lib/adressesReception.ts) les dit avant le clic,
-- dans le même ordre et sous les mêmes mots :
--   1. l'accès au dossier annoncé — le cabinet ou le client « Ventes » —, et qu'il existe, avant de rien lire (42501) ;
--   2. la forme : une maille de l'annuaire, puis l'identifiant à la forme de sa maille, puis un SIRET qui commence par le
--      SIREN (G1.80) ;
--   3. le SIREN du dossier : qu'il en ait un, puis que l'identifiant commence par lui ;
--   4. la date de prise d'effet : présente, entre 2000 et 2099 ;
--   5. la plateforme : nommée, en 99 caractères au plus ;
--   6. la vérification : sa source, puis son jour — aucun pour la seule déclaration, un pour les deux autres, entre le
--      1er janvier 2000 et aujourd'hui à Paris ;
--   7. la version remplacée : une adresse de ce dossier, et la COURANTE — sinon une autre déclaration est passée
--      entre-temps, et le refus nomme celle qui est courante (son identifiant, le jour à Paris où elle a été déclarée).
-- Tous en 22023, sauf l'accès.
create function public.declarer_adresse_reception(
  p_dossier_id uuid,
  p_forme text,
  p_identifiant text,
  p_plateforme text,
  p_prise_effet date,
  p_verification text,
  p_verifiee_le date,
  p_remplace_id uuid
)
returns public.adresses_reception
language plpgsql
security definer
set search_path = public
as $$
declare
  v_siren text;
  v_courante public.adresses_reception;
  v_ecrite public.adresses_reception;
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- Deux déclarations du même dossier ne se croisent pas : la seconde attend la première, puis la voit (rang 7).
  perform pg_advisory_xact_lock(hashtextextended('jd.adresses_reception:' || p_dossier_id::text, 0));

  -- 2. La maille, puis l'identifiant à sa forme, puis le SIRET de l'identifiant, qui commence par son SIREN.
  if p_forme is null or p_forme not in ('siren', 'siren_siret', 'siren_siret_routage', 'siren_suffixe') then
    raise exception 'La maille de l''adresse est l''une des quatre de l''annuaire : SIREN, SIREN_SIRET, SIREN_SIRET_routage ou SIREN_suffixe.'
      using errcode = '22023';
  end if;
  if p_forme = 'siren' and (p_identifiant is null or p_identifiant !~ '^[0-9]{9}$') then
    raise exception 'Une adresse à la maille SIREN est le SIREN, neuf chiffres.' using errcode = '22023';
  end if;
  if p_forme = 'siren_siret' and (p_identifiant is null or p_identifiant !~ '^[0-9]{9}_[0-9]{14}$') then
    raise exception 'Une adresse à la maille SIREN_SIRET s''écrit : les neuf chiffres du SIREN, « _ », les quatorze du SIRET.'
      using errcode = '22023';
  end if;
  if p_forme = 'siren_siret_routage' and (p_identifiant is null or p_identifiant !~ '^[0-9]{9}_[0-9]{14}_[-_/@a-zA-Z0-9]{1,100}$') then
    raise exception 'Une adresse à la maille SIREN_SIRET_routage s''écrit : les neuf chiffres du SIREN, « _ », les quatorze du SIRET, « _ », puis un code de routage d''un à cent caractères — lettres sans accent, chiffres, « - », « _ », « / » ou « @ ».'
      using errcode = '22023';
  end if;
  if p_forme = 'siren_suffixe' and (p_identifiant is null or p_identifiant !~ '^[0-9]{9}_[-_.@a-zA-Z0-9]{1,100}$') then
    raise exception 'Une adresse à la maille SIREN_suffixe s''écrit : les neuf chiffres du SIREN, « _ », puis un suffixe d''un à cent caractères — lettres sans accent, chiffres, « - », « _ », « . » ou « @ ».'
      using errcode = '22023';
  end if;
  if p_forme in ('siren_siret', 'siren_siret_routage') and substr(p_identifiant, 11, 9) <> left(p_identifiant, 9) then
    raise exception 'Dans l''adresse, le SIRET ne commence pas par le SIREN : l''établissement doit être de cette entreprise.'
      using errcode = '22023';
  end if;

  -- 3. Le SIREN du dossier, tiré de son SIRET comme l'application le tire ; puis l'identifiant, qui commence par lui.
  select case when s.chiffres ~ '^[0-9]{14}$' then left(s.chiffres, 9)
              when s.chiffres ~ '^[0-9]{9}$' then s.chiffres end
    into v_siren
    from (select regexp_replace(coalesce(d.siret, ''),
                   '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g') as chiffres
            from public.dossiers d where d.id = p_dossier_id) s;
  if v_siren is null then
    raise exception 'Le dossier n''a pas de SIREN : renseigner son SIRET avant de déclarer son adresse de réception.'
      using errcode = '22023';
  end if;
  if left(p_identifiant, 9) <> v_siren then
    raise exception 'L''adresse doit commencer par le SIREN du dossier, %.', v_siren using errcode = '22023';
  end if;

  -- 4. La date de prise d'effet.
  if p_prise_effet is null then
    raise exception 'La date de prise d''effet de l''adresse est à renseigner.' using errcode = '22023';
  end if;
  if p_prise_effet not between date '2000-01-01' and date '2099-12-31' then
    raise exception 'La date de prise d''effet de l''adresse est comprise entre 2000 et 2099.' using errcode = '22023';
  end if;

  -- 5. La plateforme de réception.
  if p_plateforme is null or btrim(p_plateforme, E' \t\n\r') = '' then
    raise exception 'Le nom de la plateforme de réception est à renseigner.' using errcode = '22023';
  end if;
  if char_length(p_plateforme) > 99 then
    raise exception 'Le nom de la plateforme de réception tient en 99 caractères au plus.' using errcode = '22023';
  end if;

  -- 6. La vérification : sa source, puis son jour, qui n'est pas dans l'avenir à Paris.
  if p_verification is null or p_verification not in ('portail_annuaire', 'plateforme', 'declaration') then
    raise exception 'La vérification se fait sur le portail de l''annuaire ou sur la plateforme, ou l''adresse est déclarée sans vérification.'
      using errcode = '22023';
  end if;
  if p_verification = 'declaration' and p_verifiee_le is not null then
    raise exception 'Une adresse déclarée sans vérification n''a pas de jour de vérification.' using errcode = '22023';
  end if;
  if p_verification <> 'declaration' and p_verifiee_le is null then
    raise exception 'Le jour de la vérification est à renseigner.' using errcode = '22023';
  end if;
  if p_verifiee_le < date '2000-01-01' or p_verifiee_le > (now() at time zone 'Europe/Paris')::date then
    raise exception 'Le jour de la vérification est compris entre le 01/01/2000 et aujourd''hui.' using errcode = '22023';
  end if;

  -- 7. La version remplacée : une adresse de ce dossier, et la courante — celle qu'aucune ne remplace.
  if p_remplace_id is not null
     and not exists (select 1 from public.adresses_reception a where a.id = p_remplace_id and a.dossier_id = p_dossier_id) then
    raise exception 'L''adresse à remplacer n''est pas une adresse de réception de ce dossier.' using errcode = '22023';
  end if;
  select * into v_courante from public.adresses_reception a
   where a.dossier_id = p_dossier_id
     and not exists (select 1 from public.adresses_reception s where s.remplace_id = a.id);
  if p_remplace_id is distinct from v_courante.id then
    raise exception 'Une autre adresse a été déclarée entre-temps (« % », le %) : relire avant de déclarer.',
      v_courante.identifiant, to_char((v_courante.cree_le at time zone 'Europe/Paris')::date, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;

  -- L'écriture : les colonnes énumérées ; l'auteur et l'instant posés par la base.
  insert into public.adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, verifiee_le,
                                         remplace_id, auteur)
  values (p_dossier_id, p_forme, p_identifiant, p_plateforme, p_prise_effet, p_verification, p_verifiee_le, p_remplace_id,
          auth.uid())
  returning * into v_ecrite;
  return v_ecrite;
end
$$;

-- ══ 5. L'état de la facture électronique d'un dossier ══════════
-- L'accès d'abord — le cabinet ou le client « Ventes », sur un dossier qui existe (42501) —, puis UNE valeur :
--   { "plateforme": { "reliee", "nom", "creee_le", "derniere_recuperation", "statuts_lus_le" },
--     "superpdp": { "relie", "depuis" },
--     "adresse": null | { "id", "forme", "identifiant", "plateforme", "prise_effet", "verification", "verifiee_le",
--                         "auteur", "cree_le" } }
-- Chaque clé est toujours là : non reliée, une connexion rend `false` et des valeurs nulles ; sans déclaration, l'adresse
-- est nulle. Rien d'autre des deux tables des connexions n'est lu.
create function public.etat_facture_electronique(p_dossier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'plateforme', coalesce(
      (select jsonb_build_object('reliee', true, 'nom', c.nom, 'creee_le', c.created_at,
                                 'derniere_recuperation', c.derniere_recuperation, 'statuts_lus_le', c.cycle_vie_lu_le)
         from public.connexions_plateformes c where c.dossier_id = p_dossier_id),
      jsonb_build_object('reliee', false, 'nom', null, 'creee_le', null, 'derniere_recuperation', null, 'statuts_lus_le', null)),
    'superpdp', coalesce(
      (select jsonb_build_object('relie', true, 'depuis', s.created_at)
         from public.superpdp_credentials s where s.dossier_id = p_dossier_id),
      jsonb_build_object('relie', false, 'depuis', null)),
    'adresse',
      (select jsonb_build_object('id', a.id, 'forme', a.forme, 'identifiant', a.identifiant, 'plateforme', a.plateforme,
                                 'prise_effet', a.prise_effet, 'verification', a.verification, 'verifiee_le', a.verifiee_le,
                                 'auteur', a.auteur, 'cree_le', a.cree_le)
         from public.adresses_reception a
        where a.dossier_id = p_dossier_id
          and not exists (select 1 from public.adresses_reception s where s.remplace_id = a.id)));
end
$$;

-- ══ 6. Les droits d'exécution ══════════
-- Chaque fonction vérifie l'accès elle-même ; un anonyme n'a rien à y faire, et la garde n'est appelée que par son
-- déclencheur.
revoke execute on function public.declarer_adresse_reception(uuid, text, text, text, date, text, date, uuid) from public, anon;
grant execute on function public.declarer_adresse_reception(uuid, text, text, text, date, text, date, uuid) to authenticated;
revoke execute on function public.etat_facture_electronique(uuid) from public, anon;
grant execute on function public.etat_facture_electronique(uuid) to authenticated;
revoke execute on function public.garder_adresse_reception() from public, anon, authenticated;

comment on table public.adresses_reception is
  'L''adresse de réception des factures électroniques d''un dossier (espace client, étape A6a) : l''identifiant d''adressage de l''annuaire et sa maille, la plateforme de réception, la date de prise d''effet, DÉCLARÉS par le cabinet ou le client qui porte la case « Ventes » (MEG1-Q16), avec ce qui les a vérifiés. Versionnée : une déclaration remplace la courante (remplace_id), rien ne se modifie ni ne se supprime, sauf avec le dossier. Écrite par declarer_adresse_reception seule.';
comment on column public.adresses_reception.forme is
  'La maille de l''annuaire : siren, siren_siret, siren_siret_routage ou siren_suffixe (annexe 3 v1.8, DG-7-5).';
comment on column public.adresses_reception.identifiant is
  'L''identifiant d''adressage (DT-7-5-1) : SIREN, SIREN_SIRET, SIREN_SIRET_routage ou SIREN_suffixe ; il commence par le SIREN du dossier, vérifié à la déclaration.';
comment on column public.adresses_reception.plateforme is
  'Le nom de la plateforme de réception, tel que la déclaration le donne (l''annuaire réserve son matricule aux plateformes).';
comment on column public.adresses_reception.verification is
  'Où l''adresse a été vérifiée : portail_annuaire, plateforme, ou declaration (sans vérification, et sans jour).';
comment on function public.declarer_adresse_reception(uuid, text, text, text, date, text, date, uuid) is
  'Déclare l''adresse de réception d''un dossier, ou en remplace la version courante, pour le cabinet ou le client qui porte la case « Ventes » : l''accès d''abord, puis sept rangs de refus dans un ordre fixé ; rend la ligne écrite.';
comment on function public.etat_facture_electronique(uuid) is
  'L''état de la facture électronique d''un dossier, pour le cabinet ou le client qui porte la case « Ventes » : la plateforme agréée et Super PDP, reliés ou non, leur nom et leurs dates — jamais une adresse de connexion, un identifiant, un secret, une organisation ni une portée —, et l''adresse de réception courante.';
