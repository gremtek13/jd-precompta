-- LES CONTACTS, EN BASE (espace client, étape A4a ; ligne 51.5 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL
-- DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.4, §A.7 et §A.8). Présentée au cabinet avant
-- d'être appliquée : elle OUVRE au client qui porte la case « Ventes » la lecture d'une table et quatre fonctions, dont
-- l'effacement (CLAUDE.md, « une policy qui lui ouvre une lecture se présente au cabinet »).
--
-- CE QU'UN CONTACT EST. Un client du client — une entreprise, un organisme public, un particulier, un client établi hors
-- de France — tel qu'une facture le désigne : son nom, son adresse, ses identifiants, son adresse de facturation
-- électronique, son e-mail, son délai de paiement. Un contact PRÉ-REMPLIRA le client d'une facture (étape A4b) ; la
-- facture garde sa COPIE, jamais un renvoi : la base ne lit jamais un contact pour imprimer, transmettre ou compter une
-- facture, et l'identifiant d'un contact n'entre pas sur la facture (MEG1-Q2 : à l'étape A7, en provenance, sans clé).
-- D'où : un contact se MODIFIE, et rien de ce qu'il a pré-rempli ne bouge ; il se RETIRE — il sort des choix — et se
-- REPREND ; il s'EFFACE.
--
-- LE MODÈLE, LA MINIMISATION (règlement (UE) 2016/679, art. 5, 1, c) : ce qui sert à facturer, rien d'autre — aucun
-- téléphone, aucune date de naissance. Le type et les identifiants prennent les contraintes de `factures_emises`,
-- recopiées telles quelles (`type_client_check`, `tiers_siren_check`, `siret_du_siren`, `adresse_electronique_check`,
-- `adresse_electronique_routee`, `code_service_check`, et `organisme_public` pour le code service, qui ne se donne qu'à un
-- organisme public) : ce qu'un contact range, une facture l'accepte, et « Choisir un client » la remplira sans
-- traduction. La FONCTION juge davantage, ce que la facture ne juge qu'avant sa transmission (src/lib/factureCii.ts,
-- `refusEmission`) : les clés de contrôle du SIREN et du SIRET (la clé de Luhn ; pour un établissement de La Poste, la
-- somme de ses chiffres — INSEE), le SIRET qui commence par le SIREN, l'adresse de facturation électronique qui commence
-- par lui. Un SIRET est UNIQUE dans son dossier — une contrainte TOTALE, retirés compris (jamais d'index unique
-- partiel) : l'établissement déjà rangé se nomme. Le délai de paiement, un nombre entier de jours de 0 à 60 : pour une
-- entreprise, le plafond du délai convenu (C. com., art. L441-10, I : soixante jours après l'émission de la facture) ;
-- pour un organisme public, le plus long des délais de la commande publique (code de la commande publique, art. R2192-10
-- et R2192-11 : trente, cinquante ou soixante jours) ; pour un particulier ou un client établi hors de France, aucun texte
-- ne borne le délai, et la même borne vaut : un contact ne fait que PROPOSER l'échéance d'une facture, qui se saisit
-- librement. Les longueurs du nom (deux cents caractères), de l'adresse et des observations (mille) sont des bornes
-- TECHNIQUES ; l'e-mail est une adresse valable au sens du WHATWG (« valid e-mail address », celle qu'un champ
-- `type="email"` admet), de 254 caractères au plus (RFC 5321, §4.5.3.1.3). Le client « Ventes » lit les observations comme
-- le cabinet ; le nom `notes` est réservé dans le dépôt.
--
-- LES CLIENTS SEULEMENT — MEG1-Q9, PRISE COMME HYPOTHÈSE (la recommandation de la conception, à confirmer par le
-- cabinet) : `genre` ne prend que `client`. Les fournisseurs viendront avec les achats (partie B), par une migration qui
-- remplacera la contrainte `contacts_genre_check` ; si le cabinet les voulait dès maintenant, elle seule changerait ici.
--
-- LA RÈGLE DES SOINS — MEG1-Q10, PRISE COMME HYPOTHÈSE, LUE CONTRE LA BASE (A4-Q1 à A4-Q3) : un dossier qui dispense des
-- soins exonérés (CGI, art. 261, 4, 1° : `dossiers.article_exoneration = 'cgi_261_4_1'`, que la base admet pour un
-- dossier exonéré, ou redevable d'une activité en partie exonérée) ne range PAS de particulier dans ses contacts : ce
-- seraient ses patients, et le registre (RGPD.md, §8.7) tient qu'aucune donnée de santé n'a vocation à entrer dans
-- l'application. Un particulier est un non-assujetti SANS SIREN : un autre non-assujetti — une association — s'y range
-- avec le sien ; un client établi hors de France ne s'y range pas, rien ne dit qu'il n'est pas un particulier. La
-- fonction le refuse nommément, à l'écriture comme à la reprise. Elle ne réécrit rien d'elle-même quand le statut du
-- dossier change : un tel contact, rangé avant, ne se modifie ni ne se reprend plus ; il se retire et s'efface (A4-Q4).
-- Si le cabinet répondait autrement — « le dossier exonéré seulement » (A4-Q1), « tout non-assujetti » (A4-Q2),
-- « l'étranger admis » (A4-Q3) —, les fonctions changeraient par une migration, et rien d'autre.
--
-- L'EFFACEMENT — MEG1-Q11, PRISE COMME HYPOTHÈSE : le client du cabinet est responsable des données de SES clients, le
-- cabinet agit pour lui (RGPD, art. 28 ; une clause de la lettre de mission). Un contact s'EFFACE (art. 17) : une MISE À
-- JOUR vide ses données — son nom devient « Contact effacé le JJ/MM/AAAA », au jour de Paris — et garde la ligne, son
-- dossier, son genre, et qui l'a créé, changé et effacé ; il ne se modifie, ne se retire ni ne se reprend plus. Rien
-- d'autre ne bouge : chaque facture garde la COPIE du client qu'elle a prise, et ses dix ans (C. com., art. L123-22). Un
-- contact sans facture ni devis depuis trois ans sera PROPOSÉ à l'effacement par un écran (étape A4b), jamais effacé
-- seul : aucune fonction ici n'efface d'elle-même.
--
-- QUI LIT, QUI ÉCRIT. Le cabinet du dossier (`admin_du_dossier`) et un accès client qui porte « Ventes »
-- (`client_du_dossier(…, 'ventes')`, la policy à part `contacts_lecture_ventes`, comme les tables des ventes) LISENT les
-- contacts de ce dossier, toutes leurs colonnes, retirés et effacés compris ; personne d'autre — sans session,
-- `auth.uid()` est nul et aucun accès ne lui correspond. PERSONNE n'écrit directement : quatre fonctions SECURITY DEFINER
-- vérifient l'accès d'abord — le cabinet ou le client « Ventes », `gere_les_ventes`, le patron des articles (MEG1-Q1) —,
-- énumèrent les colonnes qu'elles écrivent et refusent dans un ordre fixé, que src/lib/contacts.ts redit avant le clic ;
-- le super-administrateur seul insère, pour restaurer une sauvegarde. Aucune policy de mise à jour ni de suppression,
-- pour personne. Un refus d'accès dit « Accès refusé à ce dossier. » (42501) pour tous : il ne dit pas si le dossier
-- existe.
--
-- CE QU'ELLE SUPPOSE : les migrations de l'étape P2 (`gere_les_ventes`, la case « Ventes ») ; son premier bloc le vérifie.
-- CE QU'ELLE NE FAIT PAS : aucune table, policy ni fonction d'hier n'est modifiée ; aucune donnée n'est lue, écrite ni
-- retirée ; aucun écran (étape A4b), aucune Edge Function. Le texte ne porte aucune instruction qui retire quoi que ce
-- soit (le mot n'y paraît que dans `on delete cascade`) : `apply_migration` le prend ; le retour arrière est donné à part.
-- Règlement (UE) 2016/679, art. 25 § 2 : par défaut rien n'est ouvert, la case « Ventes » est fausse tant que le cabinet
-- ne la coche pas.

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
-- Un contact vivant a son type et son adresse ; un contact effacé n'a plus que son nom d'effacé, son genre, et ce qui
-- dit qui l'a créé, changé et effacé. Retiré et effacé s'excluent : l'effacement sort aussi le contact des choix, et son
-- retrait n'a plus d'objet. Les auteurs sont des identifiants de compte sans clé vers les comptes, comme
-- `factures_emises.valide_par` : retirer le compte d'un membre parti ne réécrit rien.
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  genre text not null default 'client'
    constraint contacts_genre_check check (genre in ('client')),
  type_client text
    constraint contacts_type_client_check
      check (type_client in ('assujetti', 'organisme_public', 'non_assujetti', 'etranger')),
  nom text not null
    constraint contacts_nom_forme check (btrim(nom, E' \t\n\r') <> '' and char_length(nom) <= 200),
  adresse text
    constraint contacts_adresse_forme check (btrim(adresse, E' \t\n\r') <> '' and char_length(adresse) <= 1000),
  siren text
    constraint contacts_siren_check check (siren ~ '^[0-9]{9}$'),
  siret text,
  adresse_electronique text
    constraint contacts_adresse_electronique_check
      check (adresse_electronique ~ '^[0-9]{9}(_[0-9]{14}(_[-_/@a-zA-Z0-9]{1,100})?|_[-_.@a-zA-Z0-9]{1,100})?$'),
  code_service text
    constraint contacts_code_service_check check (length(code_service) <= 100 and btrim(code_service) <> ''),
  email text
    constraint contacts_email_forme
      check (char_length(email) <= 254
             and email ~ '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'),
  delai_paiement_jours integer
    constraint contacts_delai_check check (delai_paiement_jours between 0 and 60),
  observations text
    constraint contacts_observations_forme check (char_length(observations) <= 1000),
  retire_le timestamptz,
  retire_par uuid,
  efface_le timestamptz,
  efface_par uuid,
  cree_par uuid,
  cree_le timestamptz not null default now(),
  modifie_par uuid,
  modifie_le timestamptz,
  constraint contacts_siret_du_siren
    check (siren is null or siret is null or (siret ~ '^[0-9]{14}$' and left(siret, 9) = siren)),
  constraint contacts_adresse_electronique_routee
    check (adresse_electronique is null or coalesce(type_client in ('assujetti', 'organisme_public'), false)),
  constraint contacts_organisme_public check (code_service is null or coalesce(type_client = 'organisme_public', false)),
  constraint contacts_retrait_entier check ((retire_le is null) = (retire_par is null)),
  constraint contacts_effacement_entier check ((efface_le is null) = (efface_par is null)),
  constraint contacts_modification_entiere check ((modifie_le is null) = (modifie_par is null)),
  constraint contacts_retire_ou_efface check (retire_le is null or efface_le is null),
  constraint contacts_vivant_complet check (efface_le is not null or (type_client is not null and adresse is not null)),
  constraint contacts_efface_vide check (
    efface_le is null
    or (nom like 'Contact effacé le %' and type_client is null and adresse is null and siren is null and siret is null
        and adresse_electronique is null and code_service is null and email is null and delai_paiement_jours is null
        and observations is null)),
  constraint contacts_siret_unique unique (dossier_id, siret)
);

-- ══ 2. Qui lit, qui écrit ══════════
-- Le cabinet du dossier et le client qui porte le droit « Ventes » LISENT ; personne n'écrit directement — les fonctions
-- ci-dessous, et le super-administrateur qui restaure une sauvegarde.
alter table public.contacts enable row level security;
create policy contacts_lecture on public.contacts
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy contacts_lecture_ventes on public.contacts
  for select to authenticated using (public.client_du_dossier(dossier_id, 'ventes'));
create policy contacts_restauration on public.contacts
  for insert to authenticated with check (public.is_super_admin());

-- ══ 3. Enregistrer un contact ══════════
-- Le créer (`p_contact_id` nul) ou le réécrire EN ENTIER (chaque champ de la saisie ; une clé absente vaut nul). Rend le
-- contact tel qu'il est écrit. Sous un verrou du dossier : deux écritures qui prendraient le même SIRET se suivent, et la
-- seconde voit la première (rang 7).
--
-- Les refus, en douze rangs et dans cet ordre — celui de la conception, et ce que l'état réel y ajoute (l'adresse avec le
-- nom, le code service avec l'adresse électronique, les observations avant la règle des soins) ; le module
-- (src/lib/contacts.ts) les dit avant le clic, dans le même ordre et sous les mêmes mots :
--   1. l'accès au dossier annoncé — le cabinet ou le client « Ventes » —, et qu'il existe, avant de rien lire (42501) ;
--   2. le contact, dans ce dossier (P0002) ; 3. un contact retiré ne se modifie pas, il se reprend d'abord ; 4. un contact
--      effacé ne se modifie plus ;
--   5. le nom (présent, puis deux cents caractères au plus), puis l'adresse (présente, puis mille) ;
--   6. le type, l'un des quatre de la facture ;
--   7. les identifiants, dans l'ordre de la facture : ni SIREN ni SIRET pour un client établi hors de France ; le SIREN
--      (sa forme, puis sa clé) ; le SIRET (sa forme, puis sa clé), avec son SIREN, qu'il commence, et libre dans le
--      dossier — le contact qui le porte nommé (23505) ;
--   8. l'adresse de facturation électronique (à une entreprise ou à un organisme public, à sa forme, le SIREN en tête),
--      puis le code service (à un organisme public, en cent caractères au plus) ;
--   9. l'e-mail ; 10. le délai de paiement ; 11. les observations ;
--   12. la règle des soins : ni particulier, ni client établi hors de France dans un dossier qui dispense des soins
--      exonérés.
-- Tous en 22023, sauf l'accès, « introuvable » et le SIRET pris.
create function public.enregistrer_contact(p_dossier_id uuid, p_contact_id uuid, p_contact jsonb)
returns public.contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existant public.contacts;
  v_autre public.contacts;
  v_ecrit public.contacts;
  v_nom text;
  v_adresse text;
  v_type text;
  v_siren text;
  v_siret text;
  v_adresse_electronique text;
  v_code_service text;
  v_email text;
  v_delai numeric;
  v_observations text;
  v_soins boolean;
  v_somme int;
  v_chiffre int;
  v_cle boolean;
  i int;
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- Deux écritures du même dossier ne se croisent pas : la seconde attend la première, puis voit son SIRET (rang 7).
  perform pg_advisory_xact_lock(hashtextextended('jd.contacts:' || p_dossier_id::text, 0));

  -- 2, 3 et 4. Le contact, dans ce dossier ; retiré, il se reprend avant de se modifier ; effacé, il ne se modifie plus.
  if p_contact_id is not null then
    select * into v_existant from public.contacts c where c.id = p_contact_id and c.dossier_id = p_dossier_id for update;
    if not found then
      raise exception 'Contact introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    if v_existant.retire_le is not null then
      raise exception 'Ce contact est retiré : le reprendre avant de le modifier.' using errcode = '22023';
    end if;
    if v_existant.efface_le is not null then
      raise exception 'Ce contact est effacé : il ne se modifie plus.' using errcode = '22023';
    end if;
  end if;

  -- 5. Le nom, puis l'adresse. Un champ se lit par son TYPE JSON d'abord : un nombre n'est pas un texte.
  if jsonb_typeof(p_contact->'nom') is distinct from 'string' or btrim(p_contact->>'nom', E' \t\n\r') = '' then
    raise exception 'Le nom du contact est à renseigner.' using errcode = '22023';
  end if;
  v_nom := p_contact->>'nom';
  if char_length(v_nom) > 200 then
    raise exception 'Le nom du contact tient en deux cents caractères au plus.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_contact->'adresse') is distinct from 'string' or btrim(p_contact->>'adresse', E' \t\n\r') = '' then
    raise exception 'L''adresse du contact est à renseigner.' using errcode = '22023';
  end if;
  v_adresse := p_contact->>'adresse';
  if char_length(v_adresse) > 1000 then
    raise exception 'L''adresse du contact tient en mille caractères au plus.' using errcode = '22023';
  end if;

  -- 6. Le type : l'un des quatre de la facture.
  if jsonb_typeof(p_contact->'type_client') is distinct from 'string'
     or p_contact->>'type_client' not in ('assujetti', 'organisme_public', 'non_assujetti', 'etranger') then
    raise exception 'Le type du contact est l''un des quatre de la facture : une entreprise établie en France, un organisme public, un particulier ou un autre non-assujetti, un client établi hors de France.'
      using errcode = '22023';
  end if;
  v_type := p_contact->>'type_client';

  -- 7. Les identifiants, dans l'ordre de la facture : le SIREN, puis le SIRET — aucun pour un client établi hors de France.
  if v_type = 'etranger'
     and (coalesce(jsonb_typeof(p_contact->'siren'), 'null') <> 'null' or coalesce(jsonb_typeof(p_contact->'siret'), 'null') <> 'null') then
    raise exception 'Un client établi hors de France n''a ni SIREN ni SIRET.' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_contact->'siren'), 'null') <> 'null' then
    if jsonb_typeof(p_contact->'siren') <> 'string' or p_contact->>'siren' !~ '^[0-9]{9}$' then
      raise exception 'Le SIREN du contact s''écrit en neuf chiffres.' using errcode = '22023';
    end if;
    v_siren := p_contact->>'siren';
    -- La clé de Luhn : en partant de la droite, un chiffre sur deux doublé (moins neuf au-delà de neuf) ; la somme est un
    -- multiple de dix.
    v_somme := 0;
    for i in 1 .. 9 loop
      v_chiffre := substr(v_siren, 10 - i, 1)::int;
      if i % 2 = 0 then
        v_chiffre := v_chiffre * 2;
        if v_chiffre > 9 then
          v_chiffre := v_chiffre - 9;
        end if;
      end if;
      v_somme := v_somme + v_chiffre;
    end loop;
    if v_somme % 10 <> 0 then
      raise exception 'Le SIREN du contact ne passe pas sa clé de contrôle.' using errcode = '22023';
    end if;
  end if;
  if coalesce(jsonb_typeof(p_contact->'siret'), 'null') <> 'null' then
    if jsonb_typeof(p_contact->'siret') <> 'string' or p_contact->>'siret' !~ '^[0-9]{14}$' then
      raise exception 'Le SIRET du contact s''écrit en quatorze chiffres.' using errcode = '22023';
    end if;
    v_siret := p_contact->>'siret';
    -- Les établissements de La Poste (SIREN 356000000), trop nombreux pour la clé de Luhn, ont un SIRET dont la somme des
    -- chiffres est un multiple de cinq ; son siège (35600000000048) garde la clé de Luhn (INSEE ; src/lib/factureCii.ts).
    v_somme := 0;
    if left(v_siret, 9) = '356000000' and v_siret <> '35600000000048' then
      for i in 1 .. 14 loop
        v_somme := v_somme + substr(v_siret, i, 1)::int;
      end loop;
      v_cle := v_somme % 5 = 0;
    else
      for i in 1 .. 14 loop
        v_chiffre := substr(v_siret, 15 - i, 1)::int;
        if i % 2 = 0 then
          v_chiffre := v_chiffre * 2;
          if v_chiffre > 9 then
            v_chiffre := v_chiffre - 9;
          end if;
        end if;
        v_somme := v_somme + v_chiffre;
      end loop;
      v_cle := v_somme % 10 = 0;
    end if;
    if not v_cle then
      raise exception 'Le SIRET du contact ne passe pas sa clé de contrôle.' using errcode = '22023';
    end if;
    if v_siren is null then
      raise exception 'Un SIRET se donne avec le SIREN qu''il commence : renseigner aussi le SIREN du contact.' using errcode = '22023';
    end if;
    if left(v_siret, 9) <> v_siren then
      raise exception 'Le SIRET du contact ne commence pas par son SIREN.' using errcode = '22023';
    end if;
    select * into v_autre from public.contacts c
     where c.dossier_id = p_dossier_id and c.siret = v_siret and c.id is distinct from p_contact_id;
    if found then
      raise exception 'Le SIRET « % » est déjà celui du contact « % »% : un établissement ne se range qu''une fois par dossier.',
        v_siret,
        case when char_length(v_autre.nom) > 80 then left(v_autre.nom, 79) || '…' else v_autre.nom end,
        case when v_autre.retire_le is not null then ' (retiré)' else '' end
        using errcode = '23505';
    end if;
  end if;

  -- 8. L'adresse de facturation électronique : à une entreprise ou à un organisme public, à la forme de l'annuaire, le
  -- SIREN du contact en tête quand il est donné ; puis le code service, à un organisme public.
  if coalesce(jsonb_typeof(p_contact->'adresse_electronique'), 'null') <> 'null' then
    if v_type not in ('assujetti', 'organisme_public') then
      raise exception 'Une adresse de facturation électronique ne se donne qu''à une entreprise établie en France ou à un organisme public.'
        using errcode = '22023';
    end if;
    if jsonb_typeof(p_contact->'adresse_electronique') <> 'string'
       or p_contact->>'adresse_electronique' !~ '^[0-9]{9}(_[0-9]{14}(_[-_/@a-zA-Z0-9]{1,100})?|_[-_.@a-zA-Z0-9]{1,100})?$' then
      raise exception 'L''adresse de facturation électronique s''écrit SIREN, SIREN_SIRET, SIREN_SIRET_code de routage ou SIREN_suffixe, sans espace ni accent.'
        using errcode = '22023';
    end if;
    v_adresse_electronique := p_contact->>'adresse_electronique';
    if v_siren is not null and left(v_adresse_electronique, 9) <> v_siren then
      raise exception 'L''adresse de facturation électronique du contact ne commence pas par son SIREN.' using errcode = '22023';
    end if;
  end if;
  if coalesce(jsonb_typeof(p_contact->'code_service'), 'null') <> 'null' then
    if v_type <> 'organisme_public' then
      raise exception 'Un code service ne se donne qu''à un organisme public.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_contact->'code_service') <> 'string' or btrim(p_contact->>'code_service', E' \t\n\r') = ''
       or char_length(p_contact->>'code_service') > 100 then
      raise exception 'Le code service est à renseigner en cent caractères au plus.' using errcode = '22023';
    end if;
    v_code_service := p_contact->>'code_service';
  end if;

  -- 9. L'e-mail : une adresse valable au sens du WHATWG, de 254 caractères au plus.
  if coalesce(jsonb_typeof(p_contact->'email'), 'null') <> 'null' then
    if jsonb_typeof(p_contact->'email') <> 'string' or char_length(p_contact->>'email') > 254
       or p_contact->>'email' !~ '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$' then
      raise exception 'L''e-mail du contact n''est pas une adresse valable (par exemple nom@exemple.fr) de 254 caractères au plus.'
        using errcode = '22023';
    end if;
    v_email := p_contact->>'email';
  end if;

  -- 10. Le délai de paiement : un nombre entier de jours, de 0 à 60. Le `case` lit le nombre seulement quand c'en est un
  -- (entre parenthèses : sans elles, plpgsql couperait la condition au premier `then`).
  if coalesce(jsonb_typeof(p_contact->'delai_paiement_jours'), 'null') <> 'null' then
    if (case when jsonb_typeof(p_contact->'delai_paiement_jours') <> 'number' then true
             else (p_contact->>'delai_paiement_jours')::numeric not between 0 and 60
                  or (p_contact->>'delai_paiement_jours')::numeric <> trunc((p_contact->>'delai_paiement_jours')::numeric) end) then
      raise exception 'Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.' using errcode = '22023';
    end if;
    v_delai := (p_contact->>'delai_paiement_jours')::numeric;
  end if;

  -- 11. Les observations : un texte de mille caractères au plus.
  if coalesce(jsonb_typeof(p_contact->'observations'), 'null') <> 'null' then
    if jsonb_typeof(p_contact->'observations') <> 'string' or char_length(p_contact->>'observations') > 1000 then
      raise exception 'Les observations du contact sont un texte de mille caractères au plus.' using errcode = '22023';
    end if;
    v_observations := p_contact->>'observations';
  end if;

  -- 12. La règle des soins (MEG1-Q10, hypothèse ; A4-Q1 à A4-Q3) : un dossier qui dispense des soins exonérés ne range ni
  -- particulier — un non-assujetti sans SIREN —, ni client établi hors de France.
  select coalesce(d.article_exoneration = 'cgi_261_4_1', false) into v_soins from public.dossiers d where d.id = p_dossier_id;
  if v_soins and v_type = 'non_assujetti' and v_siren is null then
    raise exception 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de particulier dans ses contacts : ce seraient ses patients. Un autre non-assujetti, une association par exemple, s''y range avec son SIREN.'
      using errcode = '22023';
  end if;
  if v_soins and v_type = 'etranger' then
    raise exception 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de client établi hors de France dans ses contacts : il pourrait être un particulier, donc un patient.'
      using errcode = '22023';
  end if;

  -- L'écriture : les colonnes énumérées ; le genre, l'auteur et l'instant posés par la base.
  if p_contact_id is null then
    insert into public.contacts (dossier_id, genre, type_client, nom, adresse, siren, siret, adresse_electronique,
                                 code_service, email, delai_paiement_jours, observations, cree_par)
    values (p_dossier_id, 'client', v_type, v_nom, v_adresse, v_siren, v_siret, v_adresse_electronique,
            v_code_service, v_email, v_delai, v_observations, auth.uid())
    returning * into v_ecrit;
  else
    update public.contacts c
       set type_client = v_type, nom = v_nom, adresse = v_adresse, siren = v_siren, siret = v_siret,
           adresse_electronique = v_adresse_electronique, code_service = v_code_service, email = v_email,
           delai_paiement_jours = v_delai, observations = v_observations, modifie_par = auth.uid(), modifie_le = now()
     where c.id = p_contact_id
    returning * into v_ecrit;
  end if;
  return v_ecrit;
end
$$;

-- ══ 4. Retirer un contact, le reprendre ══════════
-- Retiré, un contact sort des choix ; il garde tout ce qu'il dit, son SIRET compris. Repris, il y revient, et la reprise
-- est sa dernière modification. Un contact effacé ne se retire ni ne se reprend plus : effacé et retiré s'excluent, et
-- l'effacé se dit d'abord. La reprise suit la règle des soins, comme une écriture : un dossier qui dispense des soins
-- exonérés ne reprend ni particulier ni client établi hors de France, rangé avant que son statut change.
-- Refus de `retirer_contact`, dans cet ordre : l'accès (42501), le contact dans ce dossier (P0002), effacé, déjà retiré
-- (22023). Refus de `reprendre_contact` : l'accès, le contact, effacé, pas retiré, puis la règle des soins (22023).
create function public.retirer_contact(p_dossier_id uuid, p_contact_id uuid)
returns public.contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.contacts;
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_contact from public.contacts c where c.id = p_contact_id and c.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Contact introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_contact.efface_le is not null then
    raise exception 'Ce contact est effacé : il ne se retire plus.' using errcode = '22023';
  end if;
  if v_contact.retire_le is not null then
    raise exception 'Ce contact est déjà retiré.' using errcode = '22023';
  end if;
  update public.contacts c set retire_le = now(), retire_par = auth.uid() where c.id = p_contact_id
  returning * into v_contact;
  return v_contact;
end
$$;

create function public.reprendre_contact(p_dossier_id uuid, p_contact_id uuid)
returns public.contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.contacts;
  v_soins boolean;
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_contact from public.contacts c where c.id = p_contact_id and c.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Contact introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_contact.efface_le is not null then
    raise exception 'Ce contact est effacé : il ne se reprend plus.' using errcode = '22023';
  end if;
  if v_contact.retire_le is null then
    raise exception 'Ce contact n''est pas retiré.' using errcode = '22023';
  end if;
  select coalesce(d.article_exoneration = 'cgi_261_4_1', false) into v_soins from public.dossiers d where d.id = p_dossier_id;
  if v_soins and v_contact.type_client = 'non_assujetti' and v_contact.siren is null then
    raise exception 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de particulier dans ses contacts : ce seraient ses patients. Un autre non-assujetti, une association par exemple, s''y range avec son SIREN.'
      using errcode = '22023';
  end if;
  if v_soins and v_contact.type_client = 'etranger' then
    raise exception 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de client établi hors de France dans ses contacts : il pourrait être un particulier, donc un patient.'
      using errcode = '22023';
  end if;
  update public.contacts c
     set retire_le = null, retire_par = null, modifie_par = auth.uid(), modifie_le = now()
   where c.id = p_contact_id
  returning * into v_contact;
  return v_contact;
end
$$;

-- ══ 5. Effacer un contact ══════════
-- Le droit à l'effacement (RGPD, art. 17 ; MEG1-Q11, hypothèse) : une MISE À JOUR vide toutes les données du contact —
-- son nom devient « Contact effacé le JJ/MM/AAAA », au jour de Paris — et garde la ligne, son dossier, son genre, et qui
-- l'a créé, changé et effacé ; elle efface aussi son retrait. Rien d'autre ne bouge : une facture garde la copie du client
-- qu'elle a prise. Trois refus, dans cet ordre : l'accès (42501), le contact dans ce dossier (P0002), déjà effacé
-- (22023).
create function public.effacer_contact(p_dossier_id uuid, p_contact_id uuid)
returns public.contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.contacts;
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_contact from public.contacts c where c.id = p_contact_id and c.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Contact introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_contact.efface_le is not null then
    raise exception 'Ce contact est déjà effacé.' using errcode = '22023';
  end if;
  update public.contacts c
     set nom = 'Contact effacé le ' || to_char((now() at time zone 'Europe/Paris')::date, 'DD/MM/YYYY'),
         type_client = null, adresse = null, siren = null, siret = null, adresse_electronique = null, code_service = null,
         email = null, delai_paiement_jours = null, observations = null, retire_le = null, retire_par = null,
         efface_le = now(), efface_par = auth.uid()
   where c.id = p_contact_id
  returning * into v_contact;
  return v_contact;
end
$$;

-- ══ 6. Les droits d'exécution ══════════
-- Chaque fonction vérifie l'accès elle-même ; un anonyme n'a rien à y faire.
revoke execute on function public.enregistrer_contact(uuid, uuid, jsonb) from public, anon;
grant execute on function public.enregistrer_contact(uuid, uuid, jsonb) to authenticated;
revoke execute on function public.retirer_contact(uuid, uuid) from public, anon;
grant execute on function public.retirer_contact(uuid, uuid) to authenticated;
revoke execute on function public.reprendre_contact(uuid, uuid) from public, anon;
grant execute on function public.reprendre_contact(uuid, uuid) to authenticated;
revoke execute on function public.effacer_contact(uuid, uuid) from public, anon;
grant execute on function public.effacer_contact(uuid, uuid) to authenticated;

comment on table public.contacts is
  'Les contacts d''un dossier, les clients de son client (espace client, étape A4a) : chacun pré-remplira le client d''une facture, qui en garde sa copie. Le cabinet et le client qui porte la case « Ventes » les lisent et les tiennent par enregistrer_contact, retirer_contact, reprendre_contact et effacer_contact ; un contact ne se supprime pas, il se retire, ou s''efface — ses données vidées, la ligne gardée.';
comment on column public.contacts.genre is
  'Client seulement (MEG1-Q9, hypothèse) : les fournisseurs viendront avec les achats, par une migration qui remplacera contacts_genre_check.';
comment on column public.contacts.type_client is
  'Le type du client tel que la facture le dit (assujetti, organisme_public, non_assujetti, etranger) ; nul pour un contact effacé.';
comment on column public.contacts.siret is
  'Le SIRET de l''établissement, qui commence par le SIREN : unique dans le dossier, retirés compris.';
comment on column public.contacts.delai_paiement_jours is
  'Le délai de paiement, de 0 à 60 jours (C. com., art. L441-10, I) : il proposera l''échéance d''une facture, sans la fixer.';
comment on column public.contacts.observations is
  'Un texte libre de mille caractères au plus, que le cabinet et le client qui porte la case « Ventes » lisent.';
comment on column public.contacts.efface_le is
  'L''instant de l''effacement (RGPD, art. 17 ; MEG1-Q11, hypothèse) : les données du contact sont vidées, son nom dit le jour, la ligne reste.';
comment on function public.enregistrer_contact(uuid, uuid, jsonb) is
  'Crée ou réécrit un contact du dossier, pour le cabinet ou le client qui porte la case « Ventes » : l''accès d''abord, puis onze rangs de refus dans un ordre fixé, la règle des soins comprise ; rend le contact écrit.';
comment on function public.retirer_contact(uuid, uuid) is
  'Retire un contact du dossier : il sort des choix, garde ce qu''il dit, et se reprend.';
comment on function public.reprendre_contact(uuid, uuid) is
  'Reprend un contact retiré du dossier, sous la règle des soins : il revient dans les choix ; la reprise est sa dernière modification.';
comment on function public.effacer_contact(uuid, uuid) is
  'Efface un contact du dossier (RGPD, art. 17) : ses données vidées, son nom devient « Contact effacé le JJ/MM/AAAA », la ligne reste ; les factures gardent leur copie.';
