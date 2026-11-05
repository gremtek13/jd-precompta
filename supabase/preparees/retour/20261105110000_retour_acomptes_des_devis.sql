-- LE RETOUR ARRIÈRE DE `acomptes_des_devis` (l'acompte d'un devis, étape P5b2). Le récit : HISTORIQUE.md, « L'ACOMPTE D'UN
-- DEVIS, EN BASE (P5B2) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- CE QU'IL FAIT : il retire les deux gardes, la facture d'acompte et les six fonctions d'appoint ; il rend `facturer_devis`,
-- `enregistrer_facture` et `garder_devis_facture` telles que la production les portait le 05/11/2026, au caractère près
-- (leurs empreintes : facturer_devis bf74bb607c40e5b6efb9edcfedf16cfe, enregistrer_facture fe4b55352f03275048db1a230d93dd72, garder_devis_facture
-- 918033a41241bf16e6887fc02b9b5ccd), avec leurs commentaires ; puis il retire les quatre colonnes et leurs contraintes, la clé et l'index
-- de la reprise. Le corps d'hier d'`enregistrer_facture` porte des échappements : il se compose ici, chaque barre oblique
-- inverse écrite « ¤ » et rendue par `chr(92)` — ni barre oblique inverse, ni retour chariot dans ce texte.
--
-- CE QU'IL DÉTRUIT : des colonnes, des fonctions et des déclencheurs — un texte à COLLER dans l'éditeur SQL, sur l'accord
-- explicite du cabinet seulement. AUCUNE DONNÉE : sa garde se refuse dès qu'une facture est marquée acompte ou porte une
-- date du versement, qu'une ligne reprend un acompte, ou qu'un lien a le rôle « acompte » — la marque d'une facture validée
-- est figée avec elle, et la retirer changerait ce qu'elle est. Ce jour-là, le retour se décide autrement, avec le cabinet.
-- Les liens d'un devis gardent leur facture (le rôle « finale » de tous les liens d'hier se perd avec la colonne : c'était
-- le sens de tout lien avant elle).
--
-- SA GARDE DE TÊTE : il se refuse aussi si l'une des trois fonctions n'est plus celle que la migration a posée.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'il suppose ══════════
do $garde$
declare
  v_fonction record;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass and attname = 'acompte'
                  and not attisdropped) then
    raise exception 'La migration acomptes_des_devis n''est pas en base : rien à défaire.';
  end if;
  for v_fonction in
    select x.signature, x.empreinte from (values
      ('public.facturer_devis(uuid, uuid)', 'e01746a70e23cd4751db4f817525d40d'),
      ('public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean)', 'f775c5662e609d5ede5f48b4454a0984'),
      ('public.garder_devis_facture()', '5a56b324e6ec9f88b431bbf9ba465f13')
    ) as x(signature, empreinte)
  loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(v_fonction.signature)) is distinct from v_fonction.empreinte then
      raise exception 'La fonction % n''est plus celle que la migration acomptes_des_devis a posée : relire la base avant ce retour.', v_fonction.signature;
    end if;
  end loop;
  if exists (select 1 from public.factures_emises f where f.acompte or f.date_versement_acompte is not null)
     or exists (select 1 from public.facture_lignes l where l.reprise_facture_id is not null)
     or exists (select 1 from public.devis_factures l where l.role = 'acompte') then
    raise exception 'Des factures d''acompte, des reprises ou des liens « acompte » existent : ce retour les effacerait. Il se refuse.';
  end if;
end
$garde$;

-- ══ 1. Les gardes, la facture d'acompte, les fonctions d'appoint ══════════
drop trigger factures_emises_marque_d_acompte on public.factures_emises;
drop trigger facture_lignes_gardes_d_acompte on public.facture_lignes;
drop function public.garder_marque_d_acompte();
drop function public.garder_lignes_d_acompte();
drop function public.facturer_acompte_devis(uuid, uuid, jsonb, date);

-- ══ 2. Les trois fonctions d'hier, au caractère près ══════════
CREATE OR REPLACE FUNCTION public.facturer_devis(p_dossier_id uuid, p_devis_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_devis public.devis;
  v_premiere text;
  v_facture uuid;
  v_dossier public.dossiers;
  v_emetteur record;
begin
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select d.* into v_devis
    from public.devis d
   where d.id = p_devis_id and d.dossier_id = p_dossier_id
     for update;
  if not found then
    raise exception 'Devis introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_devis.statut <> 'emis' then
    raise exception 'Le devis est un brouillon : seul un devis accepté se transforme en facture.' using errcode = '22023';
  end if;
  if v_devis.reponse is distinct from 'acceptee' then
    raise exception 'Seul un devis accepté se transforme en facture : le devis % est %.', v_devis.numero,
      case when v_devis.reponse = 'refusee' then 'refusé' else 'en attente de réponse' end using errcode = '22023';
  end if;
  select coalesce(f.numero, 'un brouillon') into v_premiere
    from public.devis_factures l
    join public.factures_emises f on f.id = l.facture_id
   where l.devis_id = p_devis_id
   order by l.cree_le, l.id
   limit 1;
  if found then
    raise exception 'Le devis % a déjà sa facture (%) : un devis se transforme une fois.', v_devis.numero, v_premiere
      using errcode = '22023';
  end if;

  select d.* into v_dossier from public.dossiers d where d.id = p_dossier_id;
  select e.* into v_emetteur
    from public.emetteur_du_dossier(v_dossier.nom, v_dossier.denomination_imprimee, v_dossier.siret, v_dossier.adresse) e;
  select e.facture_id into v_facture
    from public.enregistrer_facture(p_dossier_id, null, jsonb_build_object(
      'tiers_nom', v_devis.tiers_nom,
      'tiers_adresse', v_devis.tiers_adresse,
      'tiers_siret', v_devis.tiers_siret,
      'tiers_email', v_devis.tiers_email,
      'date_emission', (now() at time zone 'Europe/Paris')::date,
      'type_client', v_devis.type_client,
      'tiers_siren', v_devis.tiers_siren,
      'tiers_adresse_electronique', v_devis.tiers_adresse_electronique,
      'code_service', v_devis.code_service,
      'numero_engagement', v_devis.numero_engagement,
      'nature_operation', v_devis.nature_operation,
      'livraison_adresse', v_devis.livraison_adresse,
      'livraison_code_postal', v_devis.livraison_code_postal,
      'livraison_ville', v_devis.livraison_ville,
      'livraison_pays', v_devis.livraison_pays,
      'montant_ht', v_devis.montant_ht,
      'montant_tva', v_devis.montant_tva,
      'montant_ttc', v_devis.montant_ttc,
      'emetteur_nom', v_emetteur.nom,
      'emetteur_siret', v_emetteur.siret,
      'emetteur_adresse', v_emetteur.adresse
    ), v_devis.lignes, false) e;

  insert into public.devis_factures (dossier_id, devis_id, facture_id, cree_par)
  values (p_dossier_id, p_devis_id, v_facture, auth.uid());
  return v_facture;
end;
$function$
;
comment on function public.facturer_devis(uuid, uuid) is 'Tire d''un devis accepté une facture brouillon, par enregistrer_facture sous l''identité de l''appelant, l''émetteur du jour lu sur le dossier (emetteur_du_dossier), et pose le lien (devis_factures) : une fois. Pour le cabinet du dossier ou un accès « Ventes » (42501). Rend la facture.';
do $retour$
begin
  execute replace($corps$CREATE OR REPLACE FUNCTION public.enregistrer_facture(p_dossier_id uuid, p_facture_id uuid, p_facture jsonb, p_lignes jsonb, p_valider boolean DEFAULT false)
 RETURNS TABLE(facture_id uuid, numero text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- A7 : la provenance, puis ce que la validation fige.
  v_ligne record;
  v_contact uuid;
  v_emetteur_siret text;
  v_dossier dossiers%rowtype;
  v_statut_tva text;
  v_article_exoneration text;
  v_numero_tva_attribue boolean;
  v_numero_tva text;
  v_denomination text;
  v_forme_juridique text;
  v_capital numeric;
  v_rcs_ville text;
  v_mentions_identite text;
  v_courante parametres_facturation%rowtype;
  v_rib parametres_facturation%rowtype;
  v_courante_id uuid;
  v_rib_id uuid;
  v_mandataire text;
  v_cabinet boolean;
  -- A7-Q2 et A7-Q3 : l'adresse de l'émetteur, ce qu'un refus nomme, les blancs (ceux de `numero_tva_du_vendeur`).
  v_emetteur_adresse text;
  v_libelle text;
  v_blancs constant text := chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200)
    || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
begin
  if not public.gere_les_ventes(p_dossier_id) then
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
  elsif p_facture_id is not null then
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
  end if;

  -- A7. LA PROVENANCE, avant toute écriture : ce qui ne lit que la saisie d'abord — l'unité, la référence et la nature de
  -- chaque ligne, dans l'ordre des lignes —, puis ce qui lit la base — le contact d'où vient le client (une facture ; un
  -- avoir prend celui de sa facture), les articles d'où viennent les lignes. Une clé nulle ou absente ne dit rien.
  for v_ligne in select l.valeur, l.ord from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord) order by l.ord loop
    if coalesce(jsonb_typeof(v_ligne.valeur->'unite'), 'null') <> 'null'
       and (jsonb_typeof(v_ligne.valeur->'unite') <> 'string'
            or v_ligne.valeur->>'unite' not in ('C62', 'H87', 'HUR', 'DAY', 'WEE', 'MON', 'ANN', 'KGM', 'MTR', 'MTK', 'LTR', 'KMT', 'LS')) then
      raise exception 'Ligne % : l''unité n''est pas de la liste des unités admises.', v_ligne.ord using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_ligne.valeur->'reference'), 'null') <> 'null'
       and (jsonb_typeof(v_ligne.valeur->'reference') <> 'string'
            or char_length(v_ligne.valeur->>'reference') not between 1 and 100
            or btrim(v_ligne.valeur->>'reference', E' ¤t¤n¤r') <> v_ligne.valeur->>'reference') then
      raise exception 'Ligne % : la référence tient en un à cent caractères, sans blanc au début ni à la fin.', v_ligne.ord
        using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_ligne.valeur->'nature'), 'null') <> 'null'
       and (jsonb_typeof(v_ligne.valeur->'nature') <> 'string' or v_ligne.valeur->>'nature' not in ('biens', 'services')) then
      raise exception 'Ligne % : la nature d''une ligne est « biens » ou « services ».', v_ligne.ord using errcode = '22023';
    end if;
  end loop;
  if not (p_facture_id is null and coalesce(p_facture->>'type', 'facture') = 'avoir')
     and coalesce(jsonb_typeof(p_facture->'contact_id'), 'null') <> 'null'
     and (jsonb_typeof(p_facture->'contact_id') <> 'string'
          or not exists (select 1 from contacts c where c.dossier_id = p_dossier_id and c.id::text = p_facture->>'contact_id')) then
    raise exception 'Le contact d''où vient le client de la facture est introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  for v_ligne in select l.valeur, l.ord from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord) order by l.ord loop
    if coalesce(jsonb_typeof(v_ligne.valeur->'article_id'), 'null') <> 'null'
       and (jsonb_typeof(v_ligne.valeur->'article_id') <> 'string'
            or not exists (select 1 from articles a where a.dossier_id = p_dossier_id and a.id::text = v_ligne.valeur->>'article_id')) then
      raise exception 'Ligne % : l''article d''où elle vient est introuvable dans ce dossier.', v_ligne.ord using errcode = 'P0002';
    end if;
  end loop;

  if p_facture_id is null and p_facture->>'type' = 'avoir' then
    insert into factures_emises (
      dossier_id, type, facture_origine_id,
      tiers_nom, tiers_adresse, tiers_siret, tiers_siren, type_client, tiers_adresse_electronique,
      code_service, numero_engagement, nature_operation, date_prestation, periode_debut, periode_fin,
      livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays,
      date_emission, notes, mentions_legales,
      emetteur_nom, emetteur_siret, emetteur_adresse,
      montant_ht, montant_tva, montant_ttc, created_by,
      contact_id
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
      auth.uid(),
      v_origine.contact_id
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
      livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays,
      contact_id
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
      nullif(p_facture->>'livraison_pays', ''),
      (p_facture->>'contact_id')::uuid
    )
    returning id, type, statut into v_id, v_type, v_statut;
  else
    -- Les mentions de la ligne 28.5 ne changent que si le document les PORTE (`?`) : une clé absente garde la valeur
    -- en place (voir l'en-tête). Le contact d'où vient le client (A7) de même.
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
        then nullif(p_facture->>'livraison_pays', '') else livraison_pays end,
      contact_id = case when p_facture ? 'contact_id' then (p_facture->>'contact_id')::uuid else contact_id end
    where id = p_facture_id;
    v_id := p_facture_id;
  end if;

  -- Remplacement complet des lignes. Le delete et l'insert sont maintenant dans la même transaction
  -- que tout le reste : un échec de l'un annule l'autre, plus de lignes doublées.
  delete from facture_lignes fl where fl.facture_id = v_id;

  insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, unite, reference, article_id, nature)
  select v_id,
         (l.ord - 1)::integer,
         l.valeur->>'designation',
         coalesce((l.valeur->>'quantite')::numeric, 0),
         coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0),
         coalesce((l.valeur->>'taux_tva')::numeric, 0),
         l.valeur->>'unite',
         l.valeur->>'reference',
         (l.valeur->>'article_id')::uuid,
         l.valeur->>'nature'
  from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord);

  -- A7-Q3. UN IBAN DANS UN TEXTE LIBRE QUE LA FACTURE IMPRIME, quel que soit l'auteur, à chaque enregistrement : sur la
  -- facture telle qu'elle est écrite — ce qu'elle garde d'un brouillon compris —, dans l'ordre où elle s'imprime :
  -- l'émetteur, le client, l'adresse de livraison, le code service et le numéro d'engagement, chaque ligne (sa désignation,
  -- puis sa référence), la mention légale. D'un avoir, ses lignes et sa mention légale seules : le reste est la copie de
  -- sa facture, qu'il ne rejuge pas. Les notes et l'adresse électronique du client ne s'impriment pas.
  select t.libelle into v_libelle
    from (select x.rang, 0 as ligne, x.libelle, x.valeur
            from factures_emises f
            cross join lateral (values
              (1, 'le nom de l''émetteur', f.emetteur_nom), (2, 'l''adresse de l''émetteur', f.emetteur_adresse),
              (3, 'le SIRET de l''émetteur', f.emetteur_siret), (4, 'le nom du client', f.tiers_nom),
              (5, 'l''adresse du client', f.tiers_adresse), (6, 'le SIRET du client', f.tiers_siret),
              (7, 'l''adresse de livraison', f.livraison_adresse), (8, 'le code postal de livraison', f.livraison_code_postal),
              (9, 'la ville de livraison', f.livraison_ville), (10, 'le code service', f.code_service),
              (11, 'le numéro d''engagement', f.numero_engagement), (13, 'la mention légale', f.mentions_legales)
            ) as x(rang, libelle, valeur)
           where f.id = v_id and (v_type <> 'avoir' or x.rang = 13)
          union all
          select 12, l.ordre * 2 + y.rang, y.quoi || ' de la ligne ' || (l.ordre + 1), y.valeur
            from facture_lignes l
            cross join lateral (values (1, 'la désignation', l.designation), (2, 'la référence', l.reference)) as y(rang, quoi, valeur)
           where l.facture_id = v_id) as t
   where public.porte_un_iban(t.valeur)
   order by t.rang, t.ligne
   limit 1;
  if v_libelle is not null then
    raise exception 'Un IBAN figure dans % : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.',
      v_libelle using errcode = '22023';
  end if;

  if p_valider then
    -- L'option pour les débits, FIGÉE ce jour-là : celle du dossier s'il est redevable de la TVA — l'option n'existe
    -- que pour lui. Un avoir garde celle de la facture qu'il corrige, quand elle l'a figée.
    select coalesce(d.tva_sur_debits and d.statut_tva = 'redevable', false) into v_option_debits
    from dossiers d where d.id = p_dossier_id;
    if v_type = 'avoir' and v_origine.option_debits is not null then
      v_option_debits := v_origine.option_debits;
    end if;

    -- A7. CE QUE LA VALIDATION FIGE, lu ici, jamais reçu de l'appelant.
    select f.contact_id, f.emetteur_siret, f.emetteur_adresse into v_contact, v_emetteur_siret, v_emetteur_adresse
      from factures_emises f where f.id = v_id;
    -- Le contact que la facture garde : une écriture directe a pu le poser sur le brouillon, hors de cette fonction.
    if v_contact is not null and not exists (select 1 from contacts c where c.id = v_contact and c.dossier_id = p_dossier_id) then
      raise exception 'Le contact d''où vient le client de la facture est introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    select d.* into v_dossier from dossiers d where d.id = p_dossier_id;
    -- Le statut de TVA, son numéro et l'identité légale : du jour ; pour un avoir, de sa facture quand elle les a figés.
    if v_type = 'avoir' and v_origine.mentions_figees then
      v_statut_tva := v_origine.statut_tva;
      v_article_exoneration := v_origine.article_exoneration;
      v_numero_tva_attribue := v_origine.numero_tva_attribue;
      v_numero_tva := v_origine.numero_tva_imprime;
      v_denomination := v_origine.denomination_imprimee;
      v_forme_juridique := v_origine.forme_juridique;
      v_capital := v_origine.capital;
      v_rcs_ville := v_origine.rcs_ville;
      v_mentions_identite := v_origine.mentions_identite;
    else
      v_statut_tva := v_dossier.statut_tva;
      v_article_exoneration := v_dossier.article_exoneration;
      v_numero_tva_attribue := v_dossier.numero_tva_attribue;
      v_numero_tva := public.numero_tva_du_vendeur(v_statut_tva, v_numero_tva_attribue, v_emetteur_siret);
      v_denomination := v_dossier.denomination_imprimee;
      v_forme_juridique := v_dossier.forme_juridique;
      v_capital := v_dossier.capital;
      v_rcs_ville := v_dossier.rcs_ville;
      v_mentions_identite := v_dossier.mentions_identite;
    end if;
    -- L'identité légale, le cabinet la règle et le client ne la change pas ; la forme juridique en est le préalable
    -- (MEG1-Q14) : un accès « Ventes » ne valide pas une facture dont l'identité n'a pas de forme. Le cabinet valide
    -- encore, l'écran le lui disant ; un avoir qui reprend l'identité de sa facture n'en juge rien.
    v_cabinet := public.admin_du_dossier(p_dossier_id);
    if v_forme_juridique is null and not v_cabinet and not (v_type = 'avoir' and v_origine.mentions_figees) then
      raise exception 'La forme juridique du dossier n''est pas renseignée : l''identité légale qu''une facture imprime est à régler par le cabinet avant qu''une facture se valide depuis l''espace client.'
        using errcode = '22023';
    end if;
    -- Un entrepreneur individuel (la catégorie 1000 de l'INSEE) facture sous une dénomination qui incorpore son nom,
    -- précédé ou suivi immédiatement des mots « entrepreneur individuel » ou des initiales « EI » (C. com., art. R526-27 ;
    -- R123-237, 9°).
    if v_forme_juridique = '1000' and not public.porte_la_mention_ei(v_denomination) then
      raise exception 'La forme juridique du dossier est celle d''un entrepreneur individuel : sa dénomination imprimée, son nom précédé ou suivi des initiales « EI » ou des mots « entrepreneur individuel » (C. com., art. R526-27), est à renseigner par le cabinet avant de valider une facture.'
        using errcode = '22023';
    end if;
    -- A7Q-Q1. La dénomination, le nom légal que la facture imprime (C. com., art. L441-9, I : le nom des
    -- parties), est la première mention de l'identité, et le cabinet seul la renseigne (la policy
    -- `dossiers_update`) : un accès « Ventes » ne valide pas une facture d'un dossier qui n'en a pas, quelle que
    -- soit sa forme juridique, comme sans forme. La valeur jugée est celle que la facture figera,
    -- `v_denomination` : la dénomination du dossier, lue dans cette transaction, absente ou faite des seuls
    -- blancs de `v_blancs`. Le cabinet n'est pas jugé ; un avoir qui reprend l'identité de sa facture n'en juge
    -- rien. Après l'entrepreneur individuel : sans dénomination, son refus, qui dit aussi ce qu'elle doit
    -- porter, parle le premier ; avant l'émetteur, comme l'identité avant lui.
    if btrim(coalesce(v_denomination, ''), v_blancs) = '' and not v_cabinet
       and not (v_type = 'avoir' and v_origine.mentions_figees) then
      raise exception 'La dénomination du dossier n''est pas renseignée : le cabinet la renseigne avant qu''une facture se valide depuis l''espace client.'
        using errcode = '22023';
    end if;
    -- A7-Q2. Un accès « Ventes » ne valide une facture que sous le SIRET et l'adresse du DOSSIER, que le cabinet seul
    -- renseigne (la policy `dossiers_update`), lus ici dans la transaction qui valide : un dossier qui n'en a pas ne se
    -- facture pas depuis l'espace client avant que le cabinet les pose. « Les mêmes » : le SIRET, ses caractères, les
    -- blancs retirés où qu'ils soient ; l'adresse, son texte, les blancs de ses bords retirés et ses fins de ligne
    -- ramenées à une seule (`¤r¤n` et `¤r` lus `¤n`) — ce que « Mes ventes » envoie quand elle reprend le SIRET et l'adresse
    -- du dossier sans les changer. Le cabinet n'est pas jugé ; un avoir reprend l'émetteur de sa facture et n'en juge rien.
    if not v_cabinet and v_type <> 'avoir' then
      if translate(coalesce(v_dossier.siret, ''), v_blancs, '') = '' then
        raise exception 'Le SIRET du dossier n''est pas renseigné : le cabinet le renseigne avant qu''une facture se valide depuis l''espace client.'
          using errcode = '22023';
      end if;
      if translate(coalesce(v_emetteur_siret, ''), v_blancs, '') <> translate(v_dossier.siret, v_blancs, '') then
        raise exception 'Le SIRET de l''émetteur n''est pas celui du dossier : une facture validée depuis l''espace client porte le SIRET que le cabinet a renseigné.'
          using errcode = '22023';
      end if;
      if btrim(coalesce(v_dossier.adresse, ''), v_blancs) = '' then
        raise exception 'L''adresse du dossier n''est pas renseignée : le cabinet la renseigne avant qu''une facture se valide depuis l''espace client.'
          using errcode = '22023';
      end if;
      if btrim(replace(replace(coalesce(v_emetteur_adresse, ''), E'¤r¤n', E'¤n'), E'¤r', E'¤n'), v_blancs)
         <> btrim(replace(replace(v_dossier.adresse, E'¤r¤n', E'¤n'), E'¤r', E'¤n'), v_blancs) then
        raise exception 'L''adresse de l''émetteur n''est pas celle du dossier : une facture validée depuis l''espace client porte l''adresse que le cabinet a renseignée.'
          using errcode = '22023';
      end if;
    end if;
    -- Les paramètres en vigueur : la version COURANTE — celle qu'aucune ne remplace — et le RIB CONFIRMÉ : celui de la
    -- courante, sinon, au-delà des versions où il n'est que proposé, celui de la première version qui en a un confirmé ;
    -- aucun quand cette version n'en a pas (`ribEnVigueur`, src/lib/parametresFacturation.ts). Lus d'une seule instruction.
    with recursive chaine as (
      select p.id, p.remplace_id, p.rib_etat, 1 as rang
        from parametres_facturation p
       where p.dossier_id = p_dossier_id
         and not exists (select 1 from parametres_facturation s where s.remplace_id = p.id)
      union all
      select p.id, p.remplace_id, p.rib_etat, c.rang + 1
        from parametres_facturation p
        join chaine c on p.id = c.remplace_id
    )
    select (select c.id from chaine c where c.rang = 1),
           (select c.id from chaine c where c.rib_etat is distinct from 'propose' order by c.rang limit 1)
      into v_courante_id, v_rib_id;
    if v_courante_id is not null then
      select p.* into v_courante from parametres_facturation p where p.id = v_courante_id;
    end if;
    if v_rib_id is not null then
      select p.* into v_rib from parametres_facturation p where p.id = v_rib_id and p.rib_etat = 'confirme';
    end if;
    -- A7-Q3. Ce que la validation figerait et que la facture imprime sans confirmation, pour tout auteur : l'identité du
    -- dossier — sauf celle qu'un avoir reprend de sa facture —, puis les textes de la version des paramètres en vigueur,
    -- dans l'ordre de leur saisie. Une version enregistrée avant la migration `iban_hors_des_parametres` peut en porter
    -- un : elle ne se fige pas, une autre la remplace.
    select x.libelle into v_libelle
      from (values
        (1, 'la dénomination du dossier', v_denomination),
        (2, 'la ville du greffe du dossier', v_rcs_ville),
        (3, 'les autres mentions de l''identité du dossier', v_mentions_identite),
        (4, 'les conditions d''escompte des paramètres de facturation', v_courante.escompte),
        (5, 'les pénalités de retard des paramètres de facturation', v_courante.penalites),
        (6, 'les mentions complémentaires des paramètres de facturation', v_courante.mentions_complementaires),
        (7, 'le pied de page des paramètres de facturation', v_courante.pied_de_page)
      ) as x(rang, libelle, valeur)
     where public.porte_un_iban(x.valeur)
       and (x.rang > 3 or not (v_type = 'avoir' and coalesce(v_origine.mentions_figees, false)))
     order by x.rang
     limit 1;
    if v_libelle is not null then
      raise exception 'Un IBAN figure dans % : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.',
        v_libelle using errcode = '22023';
    end if;
    -- Le mandataire : le cabinet qui valide au nom et pour le compte de son client ; personne quand c'est le client.
    if v_cabinet then
      select c.nom into v_mandataire from cabinets c where c.id = v_dossier.cabinet_id;
    end if;

    -- Le numéro est consommé ici, dans la même transaction que la validation qu'il accompagne. S'il
    -- était pris à part et que la suite échouait, il était perdu : un trou dans une suite annuelle
    -- qui, en facturation française, ne doit pas en avoir.
    v_numero := attribuer_numero_facture(p_dossier_id, extract(year from v_date_emission)::integer, v_type);
    -- Le réglage dit à la garde des factures validées (étape c, premier temps, seconde migration) que CETTE facture
    -- se valide par cette fonction ; il ne vaut que pour elle, et il est retiré aussitôt.
    perform set_config('jd.validation_facture', v_id::text, true);
    update factures_emises
    set statut = 'validee', numero = v_numero, validated_at = now(), option_debits = v_option_debits,
        valide_par = auth.uid(),
        mentions_figees = true,
        statut_tva = v_statut_tva, article_exoneration = v_article_exoneration,
        numero_tva_attribue = v_numero_tva_attribue, numero_tva_imprime = v_numero_tva,
        denomination_imprimee = v_denomination, forme_juridique = v_forme_juridique, capital = v_capital,
        rcs_ville = v_rcs_ville, mentions_identite = v_mentions_identite,
        parametres_id = v_courante.id, moyen_prefere = v_courante.moyen_prefere, escompte = v_courante.escompte,
        penalites = v_courante.penalites, mentions_complementaires = v_courante.mentions_complementaires,
        pied_de_page = v_courante.pied_de_page, logo_chemin = v_courante.logo_chemin, logo_sha256 = v_courante.logo_sha256,
        rib_parametres_id = v_rib.id, iban_imprime = v_rib.iban, bic_imprime = v_rib.bic,
        titulaire_imprime = v_rib.titulaire_compte,
        mandataire_nom = v_mandataire
    where id = v_id;
    perform set_config('jd.validation_facture', '', true);
  end if;

  return query select v_id, v_numero;
end;
$function$
$corps$, '¤', chr(92));
end
$retour$;
comment on function public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean) is 'Crée ou modifie un brouillon, crée un avoir validé, et valide : pour le cabinet du dossier ou un accès « Ventes » (42501). Ses refus d''hier, puis la provenance des lignes et du client (22023, P0002), puis un texte libre écrit qui porte un IBAN (A7-Q3) ; à la validation, le contact gardé, la forme juridique pour un accès « Ventes », la dénomination d''un entrepreneur individuel, la dénomination du dossier pour un accès « Ventes » (A7Q-Q1 : absente ou de blancs, le cabinet la renseigne ; un avoir qui reprend l''identité de sa facture n''en juge rien), le SIRET et l''adresse du dossier pour un accès « Ventes » (A7-Q2), l''identité et les paramètres en vigueur qui portent un IBAN, puis la facture fige ses mentions (étape A7) : le statut et le numéro de TVA, l''identité légale, les paramètres et le RIB confirmé en vigueur, le logo, le mandataire.';
CREATE OR REPLACE FUNCTION public.garder_devis_facture()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.devis d
                    where d.id = new.devis_id and d.dossier_id = new.dossier_id
                      and d.statut = 'emis' and d.reponse = 'acceptee') then
      raise exception 'Une facture se tire d''un devis accepté de son dossier.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.factures_emises f
                    where f.id = new.facture_id and f.dossier_id = new.dossier_id and f.type = 'facture') then
      raise exception 'Le lien d''un devis vise une facture de son dossier, jamais un avoir.' using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Le lien d''un devis à sa facture ne change pas.' using errcode = '23514';
  end if;

  if not exists (select 1 from public.factures_emises f where f.id = old.facture_id)
     or not exists (select 1 from public.devis d where d.id = old.devis_id)
     or not exists (select 1 from public.dossiers x where x.id = old.dossier_id) then
    return old;
  end if;
  raise exception 'Le lien d''un devis à sa facture ne part qu''avec la facture, le devis ou le dossier.' using errcode = '23514';
end;
$function$
;
comment on function public.garder_devis_facture() is 'Le lien d''un devis accepté de son dossier à une facture de ce dossier, jamais un avoir ; il ne change pas, et part avec la facture, le devis ou le dossier (déclencheur devis_factures_gardes).';

drop function public.acompte_refus_de_la_finale_laissee(uuid, jsonb);
drop function public.acompte_repartir_sur_les_restes(bigint, bigint[]);
drop function public.finale_active_du_devis(uuid);
drop function public.acomptes_en_vigueur(uuid);
drop function public.acompte_en_taux(numeric);
drop function public.acompte_en_euros(numeric);

-- ══ 3. Les colonnes ══════════
alter table public.devis_factures drop constraint devis_factures_role_check, drop column role;
drop index public.facture_lignes_reprise_facture_id_idx;
alter table public.facture_lignes drop column reprise_facture_id;
alter table public.factures_emises
  drop constraint factures_emises_versement_d_un_acompte,
  drop constraint factures_emises_acompte_d_une_facture,
  drop column date_versement_acompte,
  drop column acompte;
