-- RETOUR DE LM1 (20261111150000_dossier_du_cabinet) : LE DOSSIER DU CABINET RETIRÉ DE LA BASE. À COLLER.
--
-- Il DÉTRUIT la désignation (la colonne `cabinets.dossier_du_cabinet`) : le nom du dossier désigné, s'il y en a un, se dit
-- d'abord (NOTICE) pour qu'on le note. Les factures validées sur ce dossier restent telles quelles — sans mandataire,
-- dans la série du dossier — et la garde de la numérotation les juge comme hier, sur `mandataire_nom`. Mais une facture
-- validée APRÈS le retour sur ce dossier par le cabinet le serait de nouveau « au nom et pour le compte » de lui-même,
-- dans la série du mandataire : ne pas revenir en arrière une fois des honoraires facturés.
-- Rend `enregistrer_facture` et `numerotation_suivante` à leurs définitions d'avant, à l'octet près (vérifié par
-- signature.sql), puis retire les déclencheurs, les fonctions, les deux contraintes de `cabinets` et la colonne.

do $garde$
declare
  v_nom text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'cabinets' and column_name = 'dossier_du_cabinet') then
    raise exception 'La migration dossier_du_cabinet n''est pas en base : rien à défaire.';
  end if;
  for v_nom in select c.nom || ' : ' || d.nom from public.cabinets c join public.dossiers d on d.id = c.dossier_du_cabinet
  loop
    raise notice 'Désignation perdue — %', v_nom;
  end loop;
end
$garde$;

CREATE OR REPLACE FUNCTION public.numerotation_suivante(p_dossier_id uuid, p_annee integer, p_type text, OUT numero_attribue text, OUT compteur_attribue integer)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emetteur text;
  v_m record;
  v_j record;
  v_cle text;
  v_annee_cle integer;
  v_compteur integer;
  v_suivant numeric;
  v_texte text;
begin
  if p_type not in ('facture', 'avoir') then
    raise exception 'Type de numérotation invalide : %', p_type using errcode = '22023';
  end if;
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- QUI valide : le cabinet émet au nom et pour le compte de son client (BOI-TVA-DECLA-30-20-10-30), le prédicat même
  -- qui pose `mandataire_nom` dans `enregistrer_facture` ; un accès « Ventes », le client lui-même.
  v_emetteur := case when public.admin_du_dossier(p_dossier_id) then 'mandataire' else 'client' end;
  select * into v_m from public.modele_en_vigueur(p_dossier_id, p_type, v_emetteur, p_annee);
  v_cle := public.cle_de_serie(v_m.vigueur_modele, v_m.vigueur_annuel);
  v_annee_cle := case when v_m.vigueur_annuel then p_annee else 0 end;
  -- Le verrou de la série, tenu jusqu'à la fin de la transaction : deux validations, ou une validation et une reprise
  -- dans la même série, se suivent. La ligne du compteur ferme aussi la porte de la restauration du dossier.
  insert into public.facture_numerotation (dossier_id, annee, type, dernier_numero)
  values (p_dossier_id, v_annee_cle, v_cle, 0)
  on conflict (dossier_id, annee, type) do nothing;
  select n.dernier_numero into v_compteur
    from public.facture_numerotation n
   where n.dossier_id = p_dossier_id and n.annee = v_annee_cle and n.type = v_cle
     for update;
  select * into v_j
    from public.jugement_de_la_serie(p_dossier_id, v_m.vigueur_modele, v_m.vigueur_annuel, v_m.vigueur_premier,
                                     v_m.vigueur_depuis, p_annee);
  if v_j.serie_refus is not null then
    raise exception '%', v_j.serie_refus using errcode = '22023';
  end if;
  v_suivant := greatest(v_compteur::numeric + 1, v_j.serie_prochain);
  if v_suivant > 999999999 then
    raise exception 'La série % a épuisé son compteur : un numéro y porte 999 999 999 au plus.',
      public.libelle_de_serie(v_m.vigueur_modele, v_m.vigueur_annuel, p_annee) using errcode = '22023';
  end if;
  compteur_attribue := v_suivant::integer;
  update public.facture_numerotation set dernier_numero = compteur_attribue
   where dossier_id = p_dossier_id and annee = v_annee_cle and type = v_cle;
  numero_attribue := public.numero_du_modele(v_m.vigueur_modele, p_annee, compteur_attribue);
  -- La garde d'hier ordonne les validées de même début (`split_part(numero, '-', 1)`) par le nombre qui suit leur premier
  -- tiret : un numéro d'un autre modèle, sans ce nombre, l'y ferait échouer. Le modèle de chaque série l'interdit en
  -- lui-même ; deux séries le pourraient encore ensemble (l'une sans tiret, l'autre qui commence comme ses numéros) :
  -- la validation le dit ici, avant que la garde ne lève.
  select f.numero into v_texte
    from public.factures_emises f
   where f.dossier_id = p_dossier_id and f.statut = 'validee'
     and split_part(f.numero, '-', 1) = split_part(numero_attribue, '-', 1)
     and split_part(f.numero, '-', 2) !~ '^[0-9]{1,9}$'
   order by f.numero collate "C"
   limit 1;
  if v_texte is not null then
    raise exception 'Le numéro % commencerait comme la facture % sans qu''un nombre suive son premier tiret : la garde des factures ne saurait les ordonner. Le modèle de l''une des deux séries est à changer.',
      numero_attribue, v_texte using errcode = '22023';
  end if;
end
$function$
;

CREATE OR REPLACE FUNCTION public.enregistrer_facture(p_dossier_id uuid, p_facture_id uuid, p_facture jsonb, p_lignes jsonb, p_valider boolean DEFAULT false)
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
  -- P5b2 : l'acompte d'un devis et la facture finale qui le reprend.
  v_acompte boolean := false;
  v_garder_lignes boolean := false;
  v_devis_finale uuid;
  v_devis_origine uuid;
  v_role_origine text;
  v_devis_lien uuid;
  v_role_lien text;
  v_texte text;
  v_taux_absent numeric;
  v_taux_depasse numeric;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  -- A8b : la date de reprise des factures du dossier, que l'avoir d'une facture reprise suit.
  v_reprise date;
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
    -- A8b : une facture reprise de l'ancien logiciel (`importee`, A8a) se corrige aussi par un avoir, document NEUF de
    -- l'application (A.3.4 de la conception) ; jamais un brouillon ni un avoir, repris ou non.
    if v_origine.type <> 'facture' or v_origine.statut not in ('validee', 'importee') then
      raise exception 'Un avoir corrige une facture validée, jamais un brouillon ni un autre avoir.' using errcode = '22023';
    end if;
    if v_date_emission < v_origine.date_emission then
      raise exception 'Un avoir ne précède pas la facture qu''il corrige (émise le %).',
        to_char(v_origine.date_emission, 'DD/MM/YYYY') using errcode = '22023';
    end if;
    if v_origine.statut = 'importee' then
      -- A8b (A8B-Q1) : une facture reprise qui mêle biens et services — l'avoir prend sa nature, et une facture source
      -- qui mêle les deux ne se valide pas encore (`fixer_source_de_la_vente`) ; ses mots seraient ceux d'une facture à
      -- scinder, ce qu'une facture reprise ne peut pas être.
      if v_origine.nature_operation = 'mixte' then
        raise exception 'La facture % est reprise de l''ancien logiciel et mêle biens et services : son avoir ne se fait pas encore dans l''application, qui ne sait pas répartir entre les deux ce qu''il crédite.',
          v_origine.numero using errcode = '22023';
      end if;
      -- A8b (A8-Q2) : l'application émet les documents d'après la reprise des factures — l'avoir d'une facture reprise
      -- aussi, comme ses encaissements ; ce qui précède, l'ancien logiciel l'a émis et déclaré.
      select d.reprise_des_factures_le into v_reprise from dossiers d where d.id = p_dossier_id;
      if v_reprise is null or v_date_emission < v_reprise then
        raise exception 'La facture % est reprise de l''ancien logiciel : son avoir se date du jour de la reprise des factures, le %, ou d''après — ce qui précède, l''ancien logiciel l''a émis.',
          v_origine.numero, to_char(v_reprise, 'DD/MM/YYYY') using errcode = '22023';
      end if;
      -- L'émetteur : celui que le dossier pose (son nom, son SIRET, son adresse), comme une facture de l'espace client le
      -- reprend du dossier (A7-Q2) — une facture reprise n'en porte aucun, son original vit dans l'ancien logiciel.
      select d.nom, d.siret, d.adresse into v_origine.emetteur_nom, v_origine.emetteur_siret, v_origine.emetteur_adresse
        from dossiers d where d.id = p_dossier_id;
    end if;
    -- P5b2. L'avoir d'un acompte ou d'une facture finale se juge sous le verrou de leur devis : deux avoirs, ou un avoir et
    -- la validation d'une facture finale, se suivent.
    select l.devis_id, l.role into v_devis_origine, v_role_origine
      from devis_factures l where l.facture_id = v_origine.id;
    if v_devis_origine is not null then
      perform 1 from devis d where d.id = v_devis_origine for update;
    end if;
    -- Ses lignes CRÉDITENT : quantités négatives, comme l'écran les enregistre (voir FactureAvoirModal).
    -- P5b2 : sauf, sur l'avoir d'une facture finale, une ligne qui défait l'une de ses reprises (elle la cite).
    if exists (select 1 from jsonb_array_elements(p_lignes) as l(valeur)
               where coalesce((l.valeur->>'quantite')::numeric, 0) >= 0
                 and not (coalesce(v_role_origine = 'finale', false)
                          and coalesce(jsonb_typeof(l.valeur->'reprise_facture_id'), 'null') <> 'null')) then
      raise exception 'Les lignes d''un avoir créditent : leurs quantités sont négatives.' using errcode = '22023';
    end if;
    v_credite := -coalesce((p_facture->>'montant_ttc')::numeric, 0);
    if v_credite <= 0 then
      raise exception 'Un avoir crédite un montant : son total est négatif.' using errcode = '22023';
    end if;
    select coalesce(sum(-a.montant_ttc), 0) into v_deja_credite
    from factures_emises a
    where a.facture_origine_id = v_origine.id and a.type = 'avoir';
    -- A8b : les avoirs repris d'une facture reprise l'ont déjà créditée — ils la citent dans `factures_importees`.
    v_deja_credite := v_deja_credite + coalesce((
      select sum(-a.montant_ttc)
        from factures_importees ai
        join factures_emises a on a.id = ai.facture_id
       where ai.origine_id = v_origine.id and a.type = 'avoir'), 0);
    if v_deja_credite + v_credite > v_origine.montant_ttc then
      raise exception 'Cet avoir créditerait % € : la facture % n''a plus que % € à créditer.',
        replace(to_char(v_credite, 'FM999999999990.00'), '.', ','), v_origine.numero,
        replace(to_char(greatest(v_origine.montant_ttc - v_deja_credite, 0), 'FM999999999990.00'), '.', ',')
        using errcode = '22023';
    end if;
    -- P5b2. L'AVOIR D'UN ACOMPTE (CII 503) : tant qu'aucune facture finale validée et non créditée ne le reprend — elle
    -- déduit ce qu'il a facturé —, et en entier, à chaque taux et en une fois : un acompte crédité n'est plus en vigueur.
    if v_origine.acompte then
      select f.numero into v_texte
        from devis_factures l
        join factures_emises f on f.id = l.facture_id
       where l.devis_id = v_devis_origine and l.role = 'finale' and f.statut = 'validee'
         and exists (select 1 from finale_active_du_devis(v_devis_origine) a where a.facture_id = f.id)
         and exists (select 1 from facture_lignes fl where fl.facture_id = f.id and fl.reprise_facture_id = v_origine.id)
       order by f.date_emission, f.numero collate "C"
       limit 1;
      if v_texte is not null then
        raise exception 'L’acompte % est repris par la facture finale % : il ne se crédite pas tant qu’elle le reprend — un avoir de la facture finale d’abord.',
          v_origine.numero, v_texte using errcode = '22023';
      end if;
      if v_deja_credite <> 0 or v_credite <> v_origine.montant_ttc or exists (
           select 1
             from (select coalesce((l.valeur->>'taux_tva')::numeric, 0) as taux, c.ht_centimes as ht, c.tva_centimes as tva
                     from jsonb_array_elements(p_lignes) as l(valeur)
                    cross join lateral centimes_ligne_facture(coalesce((l.valeur->>'quantite')::numeric, 0),
                      coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0), coalesce((l.valeur->>'taux_tva')::numeric, 0), false) c
                   union all
                   select fl.taux_tva, c.ht_centimes, c.tva_centimes
                     from facture_lignes fl
                    cross join lateral centimes_ligne_facture(fl.quantite, fl.prix_unitaire_ht, fl.taux_tva, false) c
                    where fl.facture_id = v_origine.id) as x
            group by x.taux
           having sum(x.ht) <> 0 or sum(x.tva) <> 0) then
        raise exception 'L’avoir d’un acompte le crédite en entier, à chaque taux et en une fois : l’acompte %, de % € TTC, ne se crédite pas en partie.',
          v_origine.numero, replace(to_char(v_origine.montant_ttc, 'FM999999999990.00'), '.', ',') using errcode = '22023';
      end if;
    end if;
  elsif p_facture_id is not null then
    -- La facture doit exister *dans ce dossier* : sans ce contrôle, un dossier dont on est admin
    -- suffirait à modifier la facture d'un autre en passant son id.
    select f.type, f.statut, f.acompte into v_type, v_statut, v_acompte
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
    -- P5b2 : le devis dont ce brouillon est la facture finale.
    select l.devis_id into v_devis_finale from devis_factures l where l.facture_id = p_facture_id and l.role = 'finale';
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
            or btrim(v_ligne.valeur->>'reference', ' ' || chr(9) || chr(10) || chr(13)) <> v_ligne.valeur->>'reference') then
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

  -- P5b2. LA DATE DU VERSEMENT ET LES REPRISES, avant toute écriture. La date du versement (BT-9) : sur une facture
  -- d'acompte seulement.
  if coalesce(jsonb_typeof(p_facture->'date_versement_acompte'), 'null') <> 'null' and not v_acompte then
    raise exception 'La date du versement ne se porte que sur une facture d’acompte.' using errcode = '22023';
  end if;
  -- P5b2 (P5B2-Q1) : posée ou changée sur un acompte, jamais après le jour de Paris, comme facturer_acompte_devis.
  if v_acompte then
    if nullif(p_facture->>'date_versement_acompte', '')::date > v_aujourd_hui then
      raise exception 'Le versement ne se date pas dans l’avenir : nous sommes le %.', to_char(v_aujourd_hui, 'DD/MM/YYYY')
        using errcode = '22023';
    end if;
  end if;
  -- Une ligne qui reprend un acompte cite un acompte validé de ce dossier : sur la facture finale de son devis, ou sur
  -- l'avoir de cette facture, qui en défait la reprise.
  for v_ligne in select l.valeur, l.ord from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord) order by l.ord loop
    if coalesce(jsonb_typeof(v_ligne.valeur->'reprise_facture_id'), 'null') <> 'null' then
      if jsonb_typeof(v_ligne.valeur->'reprise_facture_id') <> 'string'
         or not exists (select 1 from factures_emises a
                         where a.dossier_id = p_dossier_id and a.acompte and a.statut = 'validee'
                           and a.id::text = v_ligne.valeur->>'reprise_facture_id') then
        raise exception 'Ligne % : l’acompte qu’elle reprend est introuvable dans ce dossier.', v_ligne.ord using errcode = 'P0002';
      end if;
      if not (coalesce(p_facture_id is not null and v_devis_finale is not null
                and exists (select 1 from devis_factures l
                             where l.devis_id = v_devis_finale and l.role = 'acompte'
                               and l.facture_id::text = v_ligne.valeur->>'reprise_facture_id'), false)
              or coalesce(p_facture_id is null and v_role_origine = 'finale'
                and exists (select 1 from facture_lignes fl
                             where fl.facture_id = v_origine.id
                               and fl.reprise_facture_id::text = v_ligne.valeur->>'reprise_facture_id'), false)) then
        raise exception 'Ligne % : seule la facture finale d’un devis reprend ses acomptes, et seul l’avoir de cette facture défait ses reprises.',
          v_ligne.ord using errcode = '22023';
      end if;
    end if;
  end loop;
  -- L'avoir d'une facture finale ne défait que ses reprises, chacune une fois au plus, à la quantité opposée.
  if p_facture_id is null and v_role_origine = 'finale' and (
       exists (select 1 from jsonb_array_elements(p_lignes) as l(valeur)
                where coalesce(jsonb_typeof(l.valeur->'reprise_facture_id'), 'null') <> 'null'
                  and coalesce((l.valeur->>'quantite')::numeric, 0) <> 1)
       or exists (
         select 1
           from (select x.r, x.p, x.t, x.n, count(*) as c
                   from (select l.valeur->>'reprise_facture_id' as r, coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0) as p,
                                coalesce((l.valeur->>'taux_tva')::numeric, 0) as t, l.valeur->>'nature' as n
                           from jsonb_array_elements(p_lignes) as l(valeur)
                          where coalesce(jsonb_typeof(l.valeur->'reprise_facture_id'), 'null') <> 'null'
                         union all
                         select fl.reprise_facture_id::text, fl.prix_unitaire_ht, fl.taux_tva, fl.nature
                           from factures_emises a
                           join facture_lignes fl on fl.facture_id = a.id
                          where a.facture_origine_id = v_origine.id and a.type = 'avoir' and fl.reprise_facture_id is not null) as x
                  group by x.r, x.p, x.t, x.n) as d
           left join (select fl.reprise_facture_id::text as r, fl.prix_unitaire_ht as p, fl.taux_tva as t, fl.nature as n,
                             count(*) as c
                        from facture_lignes fl
                       where fl.facture_id = v_origine.id and fl.reprise_facture_id is not null
                       group by 1, 2, 3, 4) as o
             on o.r = d.r and o.p = d.p and o.t = d.t and o.n is not distinct from d.n
          where o.c is null or d.c > o.c)) then
    raise exception 'L’avoir défait une reprise que la facture finale % ne porte pas, ou que d’autres avoirs ont déjà défaite.',
      v_origine.numero using errcode = '22023';
  end if;
  -- Un acompte en brouillon garde ses lignes et ses montants : ils se calculent du devis (facturer_acompte_devis).
  if v_acompte then
    if (select count(*) from facture_lignes fl where fl.facture_id = p_facture_id) <> jsonb_array_length(p_lignes)
       or exists (select 1
                    from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord)
                    left join facture_lignes fl on fl.facture_id = p_facture_id and fl.ordre = l.ord - 1
                   where fl.id is null
                      or fl.designation is distinct from l.valeur->>'designation'
                      or fl.quantite is distinct from coalesce((l.valeur->>'quantite')::numeric, 0)
                      or fl.prix_unitaire_ht is distinct from coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0)
                      or fl.taux_tva is distinct from coalesce((l.valeur->>'taux_tva')::numeric, 0)
                      or fl.unite is distinct from l.valeur->>'unite'
                      or fl.reference is distinct from l.valeur->>'reference'
                      or fl.article_id is distinct from (l.valeur->>'article_id')::uuid
                      or fl.nature is distinct from l.valeur->>'nature')
       or exists (select 1 from factures_emises f
                   where f.id = p_facture_id
                     and (f.montant_ht, f.montant_tva, f.montant_ttc) is distinct from
                         (coalesce((p_facture->>'montant_ht')::numeric, 0), coalesce((p_facture->>'montant_tva')::numeric, 0),
                          coalesce((p_facture->>'montant_ttc')::numeric, 0))) then
      raise exception 'Les lignes et les montants d’une facture d’acompte se calculent du devis : ils ne se retouchent pas. Supprimez le brouillon pour en tirer un autre.'
        using errcode = '22023';
    end if;
    v_garder_lignes := true;
  end if;

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
    -- P5b2 : la date du versement d'un acompte se retouche avec son brouillon ; égale à sa date, elle ne se dit pas (BT-9).
    if v_acompte then
      perform set_config('jd.acompte_facture', p_facture_id::text, true);
    end if;
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
      contact_id = case when p_facture ? 'contact_id' then (p_facture->>'contact_id')::uuid else contact_id end,
      date_versement_acompte = case when v_acompte then nullif(case when p_facture ? 'date_versement_acompte'
        then nullif(p_facture->>'date_versement_acompte', '')::date else date_versement_acompte end, v_date_emission)
        else date_versement_acompte end
    where id = p_facture_id;
    perform set_config('jd.acompte_facture', '', true);
    v_id := p_facture_id;
  end if;

  -- Remplacement complet des lignes. Le delete et l'insert sont maintenant dans la même transaction
  -- que tout le reste : un échec de l'un annule l'autre, plus de lignes doublées.
  -- P5b2 : sauf celles d'un acompte en brouillon, gardées telles quelles ; une reprise s'écrit sous l'annonce de la facture.
  if not v_garder_lignes then
    delete from facture_lignes fl where fl.facture_id = v_id;

    perform set_config('jd.reprises_facture', v_id::text, true);
    insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, unite, reference, article_id, nature,
      reprise_facture_id)
    select v_id,
           (l.ord - 1)::integer,
           l.valeur->>'designation',
           coalesce((l.valeur->>'quantite')::numeric, 0),
           coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0),
           coalesce((l.valeur->>'taux_tva')::numeric, 0),
           l.valeur->>'unite',
           l.valeur->>'reference',
           (l.valeur->>'article_id')::uuid,
           l.valeur->>'nature',
           (l.valeur->>'reprise_facture_id')::uuid
    from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord);
    perform set_config('jd.reprises_facture', '', true);
  end if;

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
    -- ramenées à une seule (CR LF et CR lus LF) — ce que « Mes ventes » envoie quand elle reprend le SIRET et l'adresse
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
      if btrim(replace(replace(coalesce(v_emetteur_adresse, ''), chr(13) || chr(10), chr(10)), chr(13), chr(10)), v_blancs)
         <> btrim(replace(replace(v_dossier.adresse, chr(13) || chr(10), chr(10)), chr(13), chr(10)), v_blancs) then
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

    -- P5b2. L'ACOMPTE ET LA FACTURE FINALE D'UN DEVIS, sous le verrou du devis : deux validations, ou une validation et
    -- l'avoir d'un acompte, se suivent. Après les refus d'hier ; dans l'ordre et sous les mots du module.
    select l.devis_id, l.role into v_devis_lien, v_role_lien from devis_factures l where l.facture_id = v_id;
    if v_devis_lien is not null then
      perform 1 from devis d where d.id = v_devis_lien for update;
    end if;
    if v_role_lien = 'acompte' then
      -- Le cumul des acomptes en vigueur et de celui-ci : aucune ligne hors des groupes (taux, nature) du devis, aucun
      -- groupe dépassé.
      with groupes as (
        select coalesce((l.valeur->>'taux_tva')::numeric, 0) as taux, nullif(l.valeur->>'nature', '') as nature,
               sum(c.ht_centimes) as ht, min(l.ord) as rang
          from devis d
         cross join lateral jsonb_array_elements(d.lignes) with ordinality as l(valeur, ord)
         cross join lateral centimes_ligne_facture(coalesce((l.valeur->>'quantite')::numeric, 0),
           coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0), coalesce((l.valeur->>'taux_tva')::numeric, 0), false) c
         where d.id = v_devis_lien
         group by 1, 2
      ), pris as (
        select fl.taux_tva as taux, fl.nature, c.ht_centimes as ht, a.rang, fl.ordre
          from (select e.facture_id as id, e.rang from acomptes_en_vigueur(v_devis_lien) e
                union all
                select v_id, 0) as a
          join facture_lignes fl on fl.facture_id = a.id
         cross join lateral centimes_ligne_facture(fl.quantite, fl.prix_unitaire_ht, fl.taux_tva, false) c
      )
      select (select p.taux from pris p
               where not exists (select 1 from groupes g where g.taux = p.taux and g.nature is not distinct from p.nature)
               order by p.rang, p.ordre limit 1),
             (select g.taux from groupes g
               where g.ht < (select coalesce(sum(p.ht), 0) from pris p where p.taux = g.taux and p.nature is not distinct from g.nature)
               order by g.rang limit 1)
        into v_taux_absent, v_taux_depasse;
      select d.numero into v_texte from devis d where d.id = v_devis_lien;
      if v_taux_absent is not null then
        raise exception 'L’acompte porte une ligne à % que le devis % n’a pas : il ne se valide pas.',
          acompte_en_taux(v_taux_absent), v_texte using errcode = '22023';
      end if;
      if v_taux_depasse is not null then
        raise exception 'Le cumul des acomptes du devis % dépasse le devis à % : cet acompte ne se valide pas.',
          v_texte, acompte_en_taux(v_taux_depasse) using errcode = '22023';
      end if;
      -- P5B-Q5 : la finale qu'il laisserait.
      v_texte := acompte_refus_de_la_finale_laissee(v_devis_lien,
        (select coalesce(jsonb_agg(jsonb_build_object('prix_unitaire_ht', fl.prix_unitaire_ht, 'taux_tva', fl.taux_tva)
                                   order by fl.ordre), '[]'::jsonb)
           from facture_lignes fl where fl.facture_id = v_id));
      if v_texte is not null then
        raise exception '%', v_texte using errcode = '22023';
      end if;
    elsif v_role_lien = 'finale' then
      if exists (select 1 from devis_factures l join factures_emises f on f.id = l.facture_id
                  where l.devis_id = v_devis_lien and l.role = 'acompte' and f.statut <> 'validee') then
        raise exception 'Un acompte du devis est encore en brouillon : la facture finale ne se valide qu’une fois ses acomptes validés ou supprimés.'
          using errcode = '22023';
      end if;
      -- Chaque acompte en vigueur, repris exactement : chacune de ses lignes une fois, à la quantité -1, au même prix, taux
      -- et nature.
      select e.numero into v_texte
        from acomptes_en_vigueur(v_devis_lien) e
       where (select string_agg(k.cle, ';' order by k.cle collate "C")
                from (select trim_scale(fl.prix_unitaire_ht)::text || '|' || trim_scale(fl.taux_tva)::text || '|'
                             || coalesce(fl.nature, '') as cle
                        from facture_lignes fl where fl.facture_id = e.facture_id) as k)
             is distinct from
             (select string_agg(k.cle, ';' order by k.cle collate "C")
                from (select trim_scale(fl.prix_unitaire_ht)::text || '|' || trim_scale(fl.taux_tva)::text || '|'
                             || coalesce(fl.nature, '') as cle
                        from facture_lignes fl
                       where fl.facture_id = v_id and fl.reprise_facture_id = e.facture_id and fl.quantite = -1) as k)
          or exists (select 1 from facture_lignes fl
                      where fl.facture_id = v_id and fl.reprise_facture_id = e.facture_id and fl.quantite <> -1)
       order by e.rang
       limit 1;
      if v_texte is not null then
        raise exception 'La facture finale ne reprend pas exactement l’acompte % : chacune de ses lignes s’y reprend une fois, au signe opposé.',
          v_texte using errcode = '22023';
      end if;
      select coalesce(a.numero, fl.reprise_facture_id::text) into v_texte
        from facture_lignes fl
        left join factures_emises a on a.id = fl.reprise_facture_id
       where fl.facture_id = v_id and fl.reprise_facture_id is not null
         and not exists (select 1 from acomptes_en_vigueur(v_devis_lien) e where e.facture_id = fl.reprise_facture_id)
       order by fl.ordre
       limit 1;
      if v_texte is not null then
        raise exception 'La facture finale reprend l’acompte %, qui n’est plus un acompte en vigueur de son devis (validé et non crédité).',
          v_texte using errcode = '22023';
      end if;
      -- `refusDeLaFinale` : aucun taux négatif, en HT puis en TVA, dans l'ordre de première apparition.
      with t as (
        select fl.taux_tva as taux, min(fl.ordre) as rang, sum(c.ht_centimes) as ht, sum(c.tva_centimes) as tva
          from facture_lignes fl
         cross join lateral centimes_ligne_facture(fl.quantite, fl.prix_unitaire_ht, fl.taux_tva, false) c
         where fl.facture_id = v_id
         group by fl.taux_tva
      )
      select (select t.taux from t where t.ht < 0 order by t.rang limit 1),
             (select t.taux from t where t.tva < 0 order by t.rang limit 1)
        into v_taux_absent, v_taux_depasse;
      if v_taux_absent is not null then
        raise exception 'La facture finale serait négative à % : les acomptes repris dépassent le devis.',
          acompte_en_taux(v_taux_absent) using errcode = '22023';
      end if;
      if v_taux_depasse is not null then
        raise exception 'La facture finale porterait une TVA négative à % : les acomptes repris en ont pris plus que le devis n’en porte.',
          acompte_en_taux(v_taux_depasse) using errcode = '22023';
      end if;
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
;

drop trigger dossiers_cabinet_du_dossier_du_cabinet on public.dossiers;
drop function public.garder_cabinet_du_dossier_du_cabinet();
drop trigger dossiers_dossier_du_cabinet on public.dossiers;
drop function public.garder_suppression_du_dossier_du_cabinet();
drop trigger memberships_dossier_du_cabinet on public.memberships;
drop function public.garder_acces_au_dossier_du_cabinet();
drop function public.designer_dossier_du_cabinet(uuid, uuid);
drop trigger cabinets_dossier_du_cabinet on public.cabinets;
drop function public.garder_dossier_du_cabinet();
drop function public.est_dossier_du_cabinet(uuid);
alter table public.cabinets drop constraint cabinets_dossier_du_cabinet_fkey;
alter table public.cabinets drop constraint cabinets_dossier_du_cabinet_key;
alter table public.cabinets drop column dossier_du_cabinet;
