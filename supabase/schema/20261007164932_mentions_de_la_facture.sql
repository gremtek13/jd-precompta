-- Ligne 28.5 de la feuille de route, étape (c), premier temps : les MENTIONS que la facture électronique ajoute, et
-- l'avoir enregistré d'un seul tenant. Décisions du cabinet du 07/10/2026.
--
-- Le décret n° 2022-1299 a ajouté au I de l'article 242 nonies A de l'annexe II du CGI quatre mentions, dues avec
-- l'émission électronique (le 1er septembre 2027 pour une PME ou une micro-entreprise) : le SIREN du client (1°),
-- l'adresse de livraison des biens quand elle diffère de celle du client (7° bis), la catégorie de l'opération —
-- livraisons de biens, prestations de services, ou les deux (8° bis) — et, quand le prestataire a opté pour le
-- paiement de la taxe d'après les débits, la mention de cette option (11° bis). Une cinquième est due depuis
-- toujours et manquait à l'application : la date de la livraison ou de la fin de la prestation, ou la période
-- qu'elle couvre, quand elle diffère de la date d'émission (10°).
--
-- Une facture se ROUTE vers son acheteur par son adresse électronique, celle que publie l'annuaire de la
-- facturation électronique : le SIREN, ou le SIREN suivi d'un SIRET, d'un SIRET et d'un identifiant de routage,
-- ou d'un suffixe, joints par « _ », 125 caractères au plus (spécifications externes de la DGFiP, annexe 3 ; API
-- publique de l'annuaire). Une facture à un ORGANISME PUBLIC passe par Chorus Pro, qui demande pour certains
-- destinataires le code du service (100 caractères au plus) et le numéro d'engagement (50 au plus) —
-- spécifications externes de Chorus Pro, annexe EDI, règles G2.17 à G2.19, G3.01 et G3.04.
--
-- Ces colonnes sont NULLES sur les factures d'avant : on ne devine pas ce qui n'a pas été saisi. Ce qu'une
-- facture doit porter pour être validée selon son client se dira avant le clic, avec l'écran qui les saisit
-- (étape c, quatrième temps) : refuser ici une validation que l'écran en ligne ne sait pas encore compléter
-- bloquerait la facturation jusqu'à sa mise en ligne.
--
-- `enregistrer_facture` garde sa signature, donc l'écran en ligne continue de l'appeler tel quel, et gagne trois
-- choses :
--   - elle enregistre les mentions, et une clé ABSENTE du document reçu garde la valeur en place : une fenêtre
--     ouverte avant la mise en ligne du nouvel écran, qui ne connaît pas ces champs, ne les efface pas en
--     enregistrant un brouillon (la famille « lecture → formulaire → écriture de tous les champs ») ;
--   - elle FIGE l'option pour les débits à la validation, telle que le dossier la porte ce jour-là : une facture
--     validée dit ce qui était vrai à son émission, même si le dossier change d'option ensuite ;
--   - elle enregistre un AVOIR d'un seul tenant. L'écran le faisait en trois allers-retours — un numéro de la
--     série « A » consommé, l'avoir inséré validé, puis ses lignes —, si bien qu'un échec au milieu laissait un
--     numéro perdu ou un avoir sans lignes : le défaut que cette fonction a corrigé pour les factures le
--     16/09/2026. L'avoir reprend de sa facture d'origine les parties et ce que la facture dit de l'opération —
--     il corrige CETTE facture, entre les mêmes parties —, et n'en reçoit de l'appelant que sa date, son motif,
--     ses mentions, ses montants et ses lignes, qui créditent. Il ne peut pas créditer plus que ce que la facture
--     porte encore, ni précéder la facture qu'il corrige.

alter table public.factures_emises
  add column type_client text,
  add column tiers_siren text,
  add column tiers_adresse_electronique text,
  add column code_service text,
  add column numero_engagement text,
  add column nature_operation text,
  add column date_prestation date,
  add column periode_debut date,
  add column periode_fin date,
  add column livraison_adresse text,
  add column livraison_code_postal text,
  add column livraison_ville text,
  add column livraison_pays text,
  add column option_debits boolean;

comment on column public.factures_emises.type_client is
  'Le client de la facture (ligne 28.5) : assujetti (entreprise ou professionnel établi en France, e-invoicing), '
  'organisme_public (Chorus Pro), non_assujetti (particulier ou autre non-assujetti, e-reporting), etranger (établi '
  'hors de France, e-reporting). Nul sur une facture d''avant cette colonne.';
comment on column public.factures_emises.tiers_siren is
  'Le SIREN du client (CGI, ann. II, art. 242 nonies A, I, 1°), neuf chiffres ; le SIRET, quand il est donné, '
  'commence par lui.';
comment on column public.factures_emises.tiers_adresse_electronique is
  'L''adresse électronique de facturation du client, telle que l''annuaire la publie : SIREN, SIREN_SIRET, '
  'SIREN_SIRET_identifiant de routage ou SIREN_suffixe, 125 caractères au plus.';
comment on column public.factures_emises.code_service is
  'Organisme public : le code du service destinataire dans Chorus Pro, 100 caractères au plus.';
comment on column public.factures_emises.numero_engagement is
  'Organisme public : le numéro d''engagement (bon de commande) que Chorus Pro demande à certains destinataires, '
  '50 caractères au plus.';
comment on column public.factures_emises.nature_operation is
  'La catégorie de l''opération (art. 242 nonies A, I, 8° bis) : biens, services ou mixte.';
comment on column public.factures_emises.date_prestation is
  'La date de la livraison ou de la fin de la prestation, quand elle diffère de la date d''émission (art. 242 '
  'nonies A, I, 10°). Exclusive d''une période.';
comment on column public.factures_emises.periode_debut is
  'Début de la période couverte par la facture (art. 242 nonies A, I, 10°), avec periode_fin.';
comment on column public.factures_emises.periode_fin is
  'Fin de la période couverte par la facture, jamais avant son début.';
comment on column public.factures_emises.livraison_adresse is
  'Adresse de livraison des biens quand elle diffère de celle du client (art. 242 nonies A, I, 7° bis) : la '
  'voie, avec livraison_code_postal, livraison_ville et livraison_pays, tous quatre ou aucun.';
comment on column public.factures_emises.livraison_pays is
  'Pays de l''adresse de livraison, code ISO 3166 à deux lettres.';
comment on column public.factures_emises.option_debits is
  'L''option du prestataire pour le paiement de la taxe d''après les débits (art. 242 nonies A, I, 11° bis), '
  'FIGÉE à la validation par enregistrer_facture. Nulle sur un brouillon et sur une facture validée avant elle.';

alter table public.factures_emises
  add constraint factures_emises_type_client_check
    check (type_client in ('assujetti', 'organisme_public', 'non_assujetti', 'etranger')),
  add constraint factures_emises_tiers_siren_check
    check (tiers_siren ~ '^[0-9]{9}$'),
  add constraint factures_emises_siret_du_siren
    check (tiers_siren is null or tiers_siret is null
      or (tiers_siret ~ '^[0-9]{14}$' and left(tiers_siret, 9) = tiers_siren)),
  -- Les quatre formes de l'annuaire, bornées par elles-mêmes à 125 caractères (9 + 1 + 14 + 1 + 100 au plus).
  add constraint factures_emises_adresse_electronique_check
    check (tiers_adresse_electronique ~ '^[0-9]{9}(_[0-9]{14}(_[-_/@a-zA-Z0-9]{1,100})?|_[-_.@a-zA-Z0-9]{1,100})?$'),
  add constraint factures_emises_adresse_electronique_routee
    check (tiers_adresse_electronique is null or coalesce(type_client in ('assujetti', 'organisme_public'), false)),
  add constraint factures_emises_code_service_check
    check (length(code_service) <= 100 and btrim(code_service) <> ''),
  add constraint factures_emises_numero_engagement_check
    check (length(numero_engagement) <= 50 and btrim(numero_engagement) <> ''),
  add constraint factures_emises_organisme_public
    check ((code_service is null and numero_engagement is null) or coalesce(type_client = 'organisme_public', false)),
  add constraint factures_emises_nature_operation_check
    check (nature_operation in ('biens', 'services', 'mixte')),
  add constraint factures_emises_periode_complete
    check ((periode_debut is null) = (periode_fin is null)),
  add constraint factures_emises_periode_ordonnee
    check (periode_fin >= periode_debut),
  add constraint factures_emises_date_ou_periode
    check (date_prestation is null or periode_debut is null),
  add constraint factures_emises_livraison_complete
    check (num_nonnulls(livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays) in (0, 4)),
  add constraint factures_emises_livraison_non_vide
    check (btrim(livraison_adresse) <> '' and btrim(livraison_code_postal) <> '' and btrim(livraison_ville) <> ''),
  add constraint factures_emises_livraison_pays_check
    check (livraison_pays ~ '^[A-Z]{2}$'),
  add constraint factures_emises_livraison_de_biens
    check (livraison_adresse is null or nature_operation is distinct from 'services'),
  add constraint factures_emises_option_debits_validee
    check (option_debits is null or statut = 'validee');

create or replace function public.enregistrer_facture(p_dossier_id uuid, p_facture_id uuid, p_facture jsonb, p_lignes jsonb, p_valider boolean default false)
 returns table(facture_id uuid, numero text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_numero text;
  v_type text;
  v_statut text;
  v_date_emission date;
  v_origine factures_emises%rowtype;
  v_option_debits boolean;
  v_deja_credite numeric;
  v_credite numeric;
begin
  if not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_lignes) is distinct from 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Une facture doit porter au moins une ligne.' using errcode = '22023';
  end if;

  if coalesce(p_facture->>'type', 'facture') not in ('facture', 'avoir') then
    raise exception 'Type de document inconnu : %.', p_facture->>'type' using errcode = '22023';
  end if;

  v_date_emission := coalesce(nullif(p_facture->>'date_emission', '')::date, current_date);

  if p_facture_id is null and p_facture->>'type' = 'avoir' then
    -- L'AVOIR. Il se crée validé : un avoir en attente n'a pas de sens, la correction est décidée quand on la fait.
    if not p_valider then
      raise exception 'Un avoir se crée validé : il n''a pas de brouillon.' using errcode = '22023';
    end if;
    -- La facture d'origine est VERROUILLÉE : deux avoirs concurrents sur la même facture se suivent, et le second
    -- voit ce que le premier a déjà crédité.
    select f.* into v_origine
    from factures_emises f
    where f.id = nullif(p_facture->>'facture_origine_id', '')::uuid and f.dossier_id = p_dossier_id
    for update;
    if not found then
      raise exception 'Facture d''origine introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    if v_origine.type <> 'facture' or v_origine.statut <> 'validee' then
      raise exception 'Un avoir corrige une facture validée, jamais un brouillon ni un autre avoir.' using errcode = '22023';
    end if;
    if v_date_emission < v_origine.date_emission then
      raise exception 'Un avoir ne précède pas la facture qu''il corrige (émise le %).',
        to_char(v_origine.date_emission, 'DD/MM/YYYY') using errcode = '22023';
    end if;
    -- Ses lignes CRÉDITENT : quantités négatives, comme l'écran les enregistre (voir FactureAvoirModal).
    if exists (select 1 from jsonb_array_elements(p_lignes) as l(valeur)
               where coalesce((l.valeur->>'quantite')::numeric, 0) >= 0) then
      raise exception 'Les lignes d''un avoir créditent : leurs quantités sont négatives.' using errcode = '22023';
    end if;
    v_credite := -coalesce((p_facture->>'montant_ttc')::numeric, 0);
    if v_credite <= 0 then
      raise exception 'Un avoir crédite un montant : son total est négatif.' using errcode = '22023';
    end if;
    select coalesce(sum(-a.montant_ttc), 0) into v_deja_credite
    from factures_emises a
    where a.facture_origine_id = v_origine.id and a.type = 'avoir';
    if v_deja_credite + v_credite > v_origine.montant_ttc then
      raise exception 'Cet avoir créditerait % € : la facture % n''a plus que % € à créditer.',
        replace(to_char(v_credite, 'FM999999999990.00'), '.', ','), v_origine.numero,
        replace(to_char(greatest(v_origine.montant_ttc - v_deja_credite, 0), 'FM999999999990.00'), '.', ',')
        using errcode = '22023';
    end if;

    insert into factures_emises (
      dossier_id, type, facture_origine_id,
      tiers_nom, tiers_adresse, tiers_siret, tiers_siren, type_client, tiers_adresse_electronique,
      code_service, numero_engagement, nature_operation, date_prestation, periode_debut, periode_fin,
      livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays,
      date_emission, notes, mentions_legales,
      emetteur_nom, emetteur_siret, emetteur_adresse,
      montant_ht, montant_tva, montant_ttc, created_by
    ) values (
      p_dossier_id, 'avoir', v_origine.id,
      v_origine.tiers_nom, v_origine.tiers_adresse, v_origine.tiers_siret, v_origine.tiers_siren,
      v_origine.type_client, v_origine.tiers_adresse_electronique,
      v_origine.code_service, v_origine.numero_engagement, v_origine.nature_operation,
      v_origine.date_prestation, v_origine.periode_debut, v_origine.periode_fin,
      v_origine.livraison_adresse, v_origine.livraison_code_postal, v_origine.livraison_ville, v_origine.livraison_pays,
      v_date_emission, p_facture->>'notes', p_facture->>'mentions_legales',
      v_origine.emetteur_nom, v_origine.emetteur_siret, v_origine.emetteur_adresse,
      coalesce((p_facture->>'montant_ht')::numeric, 0),
      coalesce((p_facture->>'montant_tva')::numeric, 0),
      coalesce((p_facture->>'montant_ttc')::numeric, 0),
      auth.uid()
    )
    returning id, type, statut into v_id, v_type, v_statut;
  elsif p_facture_id is null then
    insert into factures_emises (
      dossier_id, tiers_nom, tiers_adresse, tiers_siret, tiers_email,
      date_emission, date_echeance, notes, mentions_legales,
      emetteur_nom, emetteur_siret, emetteur_adresse,
      montant_ht, montant_tva, montant_ttc, created_by,
      type_client, tiers_siren, tiers_adresse_electronique, code_service, numero_engagement,
      nature_operation, date_prestation, periode_debut, periode_fin,
      livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays
    ) values (
      p_dossier_id,
      p_facture->>'tiers_nom',
      p_facture->>'tiers_adresse',
      p_facture->>'tiers_siret',
      p_facture->>'tiers_email',
      v_date_emission,
      nullif(p_facture->>'date_echeance', '')::date,
      p_facture->>'notes',
      p_facture->>'mentions_legales',
      p_facture->>'emetteur_nom',
      p_facture->>'emetteur_siret',
      p_facture->>'emetteur_adresse',
      coalesce((p_facture->>'montant_ht')::numeric, 0),
      coalesce((p_facture->>'montant_tva')::numeric, 0),
      coalesce((p_facture->>'montant_ttc')::numeric, 0),
      -- Jamais fourni par l'appelant : c'est l'utilisateur authentifié qui crée, par définition.
      auth.uid(),
      nullif(p_facture->>'type_client', ''),
      nullif(p_facture->>'tiers_siren', ''),
      nullif(p_facture->>'tiers_adresse_electronique', ''),
      nullif(p_facture->>'code_service', ''),
      nullif(p_facture->>'numero_engagement', ''),
      nullif(p_facture->>'nature_operation', ''),
      nullif(p_facture->>'date_prestation', '')::date,
      nullif(p_facture->>'periode_debut', '')::date,
      nullif(p_facture->>'periode_fin', '')::date,
      nullif(p_facture->>'livraison_adresse', ''),
      nullif(p_facture->>'livraison_code_postal', ''),
      nullif(p_facture->>'livraison_ville', ''),
      nullif(p_facture->>'livraison_pays', '')
    )
    returning id, type, statut into v_id, v_type, v_statut;
  else
    -- La facture doit exister *dans ce dossier* : sans ce contrôle, un dossier dont on est admin
    -- suffirait à modifier la facture d'un autre en passant son id.
    select f.type, f.statut into v_type, v_statut
    from factures_emises f
    where f.id = p_facture_id and f.dossier_id = p_dossier_id
    for update;
    if not found then
      raise exception 'Facture introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    -- Une facture validée est figée (voir CLAUDE.md) : la corriger passe par un avoir. L'écran ne
    -- propose déjà que l'aperçu, ce contrôle est la même règle dite là où elle ne peut pas être
    -- contournée.
    if v_statut = 'validee' then
      raise exception 'Une facture validée ne peut plus être modifiée — passer par un avoir.' using errcode = '22023';
    end if;

    -- Les mentions de la ligne 28.5 ne changent que si le document les PORTE (`?`) : une clé absente garde la valeur
    -- en place (voir l'en-tête).
    update factures_emises set
      tiers_nom = p_facture->>'tiers_nom',
      tiers_adresse = p_facture->>'tiers_adresse',
      tiers_siret = p_facture->>'tiers_siret',
      tiers_email = p_facture->>'tiers_email',
      date_emission = v_date_emission,
      date_echeance = nullif(p_facture->>'date_echeance', '')::date,
      notes = p_facture->>'notes',
      mentions_legales = p_facture->>'mentions_legales',
      emetteur_nom = p_facture->>'emetteur_nom',
      emetteur_siret = p_facture->>'emetteur_siret',
      emetteur_adresse = p_facture->>'emetteur_adresse',
      montant_ht = coalesce((p_facture->>'montant_ht')::numeric, 0),
      montant_tva = coalesce((p_facture->>'montant_tva')::numeric, 0),
      montant_ttc = coalesce((p_facture->>'montant_ttc')::numeric, 0),
      type_client = case when p_facture ? 'type_client' then nullif(p_facture->>'type_client', '') else type_client end,
      tiers_siren = case when p_facture ? 'tiers_siren' then nullif(p_facture->>'tiers_siren', '') else tiers_siren end,
      tiers_adresse_electronique = case when p_facture ? 'tiers_adresse_electronique'
        then nullif(p_facture->>'tiers_adresse_electronique', '') else tiers_adresse_electronique end,
      code_service = case when p_facture ? 'code_service' then nullif(p_facture->>'code_service', '') else code_service end,
      numero_engagement = case when p_facture ? 'numero_engagement'
        then nullif(p_facture->>'numero_engagement', '') else numero_engagement end,
      nature_operation = case when p_facture ? 'nature_operation'
        then nullif(p_facture->>'nature_operation', '') else nature_operation end,
      date_prestation = case when p_facture ? 'date_prestation'
        then nullif(p_facture->>'date_prestation', '')::date else date_prestation end,
      periode_debut = case when p_facture ? 'periode_debut'
        then nullif(p_facture->>'periode_debut', '')::date else periode_debut end,
      periode_fin = case when p_facture ? 'periode_fin'
        then nullif(p_facture->>'periode_fin', '')::date else periode_fin end,
      livraison_adresse = case when p_facture ? 'livraison_adresse'
        then nullif(p_facture->>'livraison_adresse', '') else livraison_adresse end,
      livraison_code_postal = case when p_facture ? 'livraison_code_postal'
        then nullif(p_facture->>'livraison_code_postal', '') else livraison_code_postal end,
      livraison_ville = case when p_facture ? 'livraison_ville'
        then nullif(p_facture->>'livraison_ville', '') else livraison_ville end,
      livraison_pays = case when p_facture ? 'livraison_pays'
        then nullif(p_facture->>'livraison_pays', '') else livraison_pays end
    where id = p_facture_id;
    v_id := p_facture_id;
  end if;

  -- Remplacement complet des lignes. Le delete et l'insert sont maintenant dans la même transaction
  -- que tout le reste : un échec de l'un annule l'autre, plus de lignes doublées.
  delete from facture_lignes fl where fl.facture_id = v_id;

  insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva)
  select v_id,
         (l.ord - 1)::integer,
         l.valeur->>'designation',
         coalesce((l.valeur->>'quantite')::numeric, 0),
         coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0),
         coalesce((l.valeur->>'taux_tva')::numeric, 0)
  from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord);

  if p_valider then
    -- L'option pour les débits, FIGÉE ce jour-là : celle du dossier s'il est redevable de la TVA — l'option n'existe
    -- que pour lui. Un avoir garde celle de la facture qu'il corrige, quand elle l'a figée.
    select coalesce(d.tva_sur_debits and d.statut_tva = 'redevable', false) into v_option_debits
    from dossiers d where d.id = p_dossier_id;
    if v_type = 'avoir' and v_origine.option_debits is not null then
      v_option_debits := v_origine.option_debits;
    end if;
    -- Le numéro est consommé ici, dans la même transaction que la validation qu'il accompagne. S'il
    -- était pris à part et que la suite échouait, il était perdu : un trou dans une suite annuelle
    -- qui, en facturation française, ne doit pas en avoir.
    v_numero := attribuer_numero_facture(p_dossier_id, extract(year from v_date_emission)::integer, v_type);
    -- Le réglage dit à la garde des factures validées (étape c, premier temps, seconde migration) que CETTE facture
    -- se valide par cette fonction ; il ne vaut que pour elle, et il est retiré aussitôt.
    perform set_config('jd.validation_facture', v_id::text, true);
    update factures_emises
    set statut = 'validee', numero = v_numero, validated_at = now(), option_debits = v_option_debits
    where id = v_id;
    perform set_config('jd.validation_facture', '', true);
  end if;

  return query select v_id, v_numero;
end;
$function$;
