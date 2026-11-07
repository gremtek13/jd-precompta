-- LES DEVIS CITENT LE CONTACT D'OÙ VIENT LEUR CLIENT (espace client ; la durée du fichier des clients, RGPD.md §2 : « la
-- relation, puis trois ans sans facture ni devis », proposé à l'effacement, jamais effacé seul). PRÉPARÉE le 06/11/2026,
-- PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « LES DEVIS CITENT LEUR CONTACT, ET LES CLIENTS SANS ACTIVITÉ DEPUIS TROIS ANS ».
--
-- POURQUOI : la liste des clients sans activité depuis trois ans juge un contact sur ses factures ET ses devis. Une facture
-- garde depuis A7 le contact d'où vient son client (`factures_emises.contact_id`, migration `mentions_figees`) ; un devis
-- n'en gardait aucun — un client à qui l'on vient d'adresser un devis aurait été proposé à l'effacement. Le lien se TIENT,
-- il ne se devine jamais d'un nom ni d'un SIRET.
--
-- CE QU'ELLE POSE :
--   1. `devis.contact_id uuid`, nullable : une PROVENANCE SANS CLÉ, comme celle d'une facture. Une clé qui le mettrait à nul
--      à la suppression d'un contact réécrirait un devis émis, que la garde fige ; un contact ne se supprime d'ailleurs pas, il s'efface (sa ligne reste,
--      anonymisée), et l'effacement ne doit rien toucher d'un devis. La garde des devis (`garder_devis`, inchangée) fige la
--      colonne d'un devis émis par construction : elle compare la ligne entière, hors des quatre colonnes de la réponse.
--   2. `enregistrer_devis` : un refus neuf, 16 bis, entre les montants et l'IBAN (« la provenance, puis un IBAN », l'ordre de
--      la facture) — un `contact_id` qui n'est pas une chaîne nommant un contact de CE dossier (P0002, les mots de la
--      facture) ; la colonne écrite dès le brouillon, et réécrite avec lui (une clé absente vaut nul : le brouillon se
--      réécrit EN ENTIER). src/lib/devis.ts le redit avant le clic (`REFUS_CONTACT_DU_DEVIS`).
--   3. `facturer_acompte_devis` et `facturer_devis` : le brouillon tiré d'un devis reprend son contact, quand il est encore
--      un contact du dossier (sinon aucun : un devis restauré sans son contact ne retient pas la facture) — sans quoi la
--      facture tirée d'un devis ne compterait pas pour son client, et le formulaire offrirait « Enregistrer ce client » sur
--      un client qui vient du fichier.
-- Aucune autre ligne n'est touchée : les trois fonctions sont copiées de l'export (supabase/schema/20261104204904 et
-- 20261105231034), leurs corps vérifiés ci-dessous à l'empreinte de la production du 06/11/2026, et seules les lignes
-- neuves s'y ajoutent ; leurs droits restent ceux d'hier (`create or replace` les garde). Aucune policy ne change : la
-- colonne se lit par les deux policies de lecture des devis (le cabinet ; le client qui porte « Ventes », qui lit déjà ses
-- contacts). La sauvegarde recopie des lignes entières (`select('*')`) : la colonne y entre avec sa ligne, sans relation au
-- graphe (aucune clé).
--
-- Pour `apply_migration` : son texte ne porte aucune instruction de retrait, ni le mot anglais qui en nomme une ; elle
-- passe par l'outil.
-- SON RETOUR : supabase/preparees/retour/20261106160100_retour_devis_citent_un_contact.sql, DESTRUCTIF (la colonne et ce
-- qu'elle porte), à coller seulement sur l'accord explicite du cabinet.
--
-- Ni barre oblique inverse, ni retour chariot.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regclass('public.devis') is null or to_regclass('public.contacts') is null
     or not exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = 'factures_emises' and c.column_name = 'contact_id') then
    raise exception 'Les devis, les contacts ou la provenance d''une facture (mentions_figees) ne sont pas en base : cette migration les suppose.';
  end if;
  if exists (select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = 'devis' and c.column_name = 'contact_id') then
    raise exception 'La colonne devis.contact_id est déjà en base : cette migration est déjà appliquée.';
  end if;
  -- Les trois fonctions qu'elle remplace, telles que l'export les porte (acomptes_des_devis, 20261105231034) : un autre
  -- texte veut dire qu'une migration plus récente les a changées, et que cette copie les ferait reculer.
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.enregistrer_devis(uuid, uuid, jsonb, jsonb, boolean)'))
       is distinct from 'edc7faddd0b360036296447331cff732'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.facturer_acompte_devis(uuid, uuid, jsonb, date)'))
       is distinct from 'c9a600b54a247d19e1dca32369680bb5'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.facturer_devis(uuid, uuid)'))
       is distinct from 'e01746a70e23cd4751db4f817525d40d' then
    raise exception 'enregistrer_devis, facturer_acompte_devis ou facturer_devis n''est plus celle de l''export : cette migration la ferait reculer.';
  end if;
end
$garde$;

-- ══ 1. La colonne ══════════
alter table public.devis add column contact_id uuid;

comment on column public.devis.contact_id is
  'Le contact d''où vient le client du devis : une provenance, SANS clé (comme factures_emises.contact_id) — une clé set null réécrirait un devis émis, que la garde fige. Écrite par enregistrer_devis dès le brouillon (un contact de ce dossier), reprise par la facture tirée du devis ; elle compte pour la durée du fichier des clients (trois ans sans facture ni devis).';

-- ══ 2. Enregistrer un devis : le contact contrôlé (16 bis), écrit dès le brouillon ══════════
create or replace function public.enregistrer_devis(p_dossier_id uuid, p_devis_id uuid, p_devis jsonb, p_lignes jsonb, p_emettre boolean)
returns table (devis_id uuid, numero text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existant public.devis;
  v_texte text;
  v_an integer;
  v_mois integer;
  v_jour integer;
  v_date date;
  v_validite date;
  v_ligne record;
  v_designation text;
  v_quantite numeric;
  v_prix numeric;
  v_taux numeric;
  v_centimes record;
  v_ht bigint := 0;
  v_tva bigint := 0;
  v_lignes jsonb := '[]'::jsonb;
  v_aujourdhui date;
  v_id uuid;
  v_prefixe text;
  v_repere integer;
  v_emis integer;
  v_sequence integer;
  v_numero text;
  -- L'émetteur, lu dans le dossier à l'émission ; ce qu'un refus nomme ; les vingt-cinq blancs d'`enregistrer_facture`, au
  -- caractère près (ceux que `numero_tva_du_vendeur` retire aussi).
  v_dossier public.dossiers;
  v_cabinet boolean;
  v_emetteur_nom text;
  v_emetteur_siret text;
  v_emetteur_adresse text;
  v_libelle text;
  v_blancs constant text := chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200)
    || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
begin
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  if p_devis_id is not null then
    select d.* into v_existant
      from public.devis d
     where d.id = p_devis_id and d.dossier_id = p_dossier_id
       for update;
    if not found then
      raise exception 'Devis introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    if v_existant.statut = 'emis' then
      raise exception 'Le devis % est émis : il ne se modifie plus — il se duplique.', v_existant.numero using errcode = '22023';
    end if;
  end if;

  if btrim(coalesce(p_devis->>'tiers_nom', '')) = '' then
    raise exception 'Le nom du client est à renseigner.' using errcode = '22023';
  end if;

  -- Une date : une chaîne AAAA-MM-JJ qui existe au calendrier grégorien (ni l'an 0, ni le 30 février), nulle sinon — jamais
  -- l'erreur brute d'une conversion, ni « today » que Postgres lirait.
  v_texte := p_devis->>'date_emission';
  if v_texte ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_an := substr(v_texte, 1, 4)::integer;
    v_mois := substr(v_texte, 6, 2)::integer;
    v_jour := substr(v_texte, 9, 2)::integer;
    if v_an >= 1 and v_mois between 1 and 12 then
      if v_jour between 1 and extract(day from make_date(v_an, v_mois, 1) + interval '1 month' - interval '1 day') then
        v_date := make_date(v_an, v_mois, v_jour);
      end if;
    end if;
  end if;
  if v_date is null then
    raise exception 'La date du devis est à renseigner.' using errcode = '22023';
  end if;
  if v_date < date '2000-01-01' then
    raise exception 'Un devis ne se date pas avant l''an 2000.' using errcode = '22023';
  end if;

  v_texte := p_devis->>'date_validite';
  if v_texte ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_an := substr(v_texte, 1, 4)::integer;
    v_mois := substr(v_texte, 6, 2)::integer;
    v_jour := substr(v_texte, 9, 2)::integer;
    if v_an >= 1 and v_mois between 1 and 12 then
      if v_jour between 1 and extract(day from make_date(v_an, v_mois, 1) + interval '1 month' - interval '1 day') then
        v_validite := make_date(v_an, v_mois, v_jour);
      end if;
    end if;
  end if;
  if v_validite is null then
    raise exception 'La date de validité du devis est à renseigner.' using errcode = '22023';
  end if;
  if v_validite < v_date then
    raise exception 'Un devis n''expire pas avant sa date : valable jusqu''au %, il est daté du %.',
      to_char(v_validite, 'DD/MM/YYYY'), to_char(v_date, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  if (case when jsonb_typeof(p_lignes) = 'array' then jsonb_array_length(p_lignes) else 0 end) not between 1 and 500 then
    raise exception 'Un devis porte au moins une ligne, et au plus 500.' using errcode = '22023';
  end if;

  for v_ligne in select l.valeur, l.ord from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord) order by l.ord loop
    if jsonb_typeof(v_ligne.valeur) is distinct from 'object'
       or jsonb_typeof(v_ligne.valeur->'designation') is distinct from 'string'
       or jsonb_typeof(v_ligne.valeur->'quantite') is distinct from 'number'
       or jsonb_typeof(v_ligne.valeur->'prix_unitaire_ht') is distinct from 'number'
       or jsonb_typeof(v_ligne.valeur->'taux_tva') is distinct from 'number' then
      raise exception 'La ligne % n''est pas une ligne de devis : une désignation, une quantité, un prix unitaire hors taxes et un taux de TVA.',
        v_ligne.ord using errcode = '22023';
    end if;
    v_designation := v_ligne.valeur->>'designation';
    v_quantite := (v_ligne.valeur->>'quantite')::numeric;
    v_prix := (v_ligne.valeur->>'prix_unitaire_ht')::numeric;
    v_taux := (v_ligne.valeur->>'taux_tva')::numeric;
    if btrim(v_designation) = '' then
      raise exception 'Ligne % : sa désignation manque.', v_ligne.ord using errcode = '22023';
    end if;
    -- Les décimales, comptées sur l'écriture décimale reçue.
    if v_quantite <= 0 or scale(v_quantite) > 4 then
      raise exception 'Ligne % : la quantité est positive, avec quatre décimales au plus.', v_ligne.ord using errcode = '22023';
    end if;
    if scale(v_prix) > 6 then
      raise exception 'Ligne % : le prix unitaire hors taxes s''écrit avec six décimales au plus.', v_ligne.ord using errcode = '22023';
    end if;
    if abs(v_quantite * v_prix) >= 10000000000 then
      raise exception 'Ligne % : son montant hors taxes atteint dix milliards d''euros.', v_ligne.ord using errcode = '22023';
    end if;
    if v_taux not in (0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6) then
      raise exception 'Ligne % : le taux de % %% n''est pas un taux de TVA admis.', v_ligne.ord,
        replace(trim_scale(v_taux)::text, '.', ',') using errcode = '22023';
    end if;
    select c.ht_centimes, c.tva_centimes into v_centimes
      from public.centimes_ligne_facture(v_quantite, v_prix, v_taux, false) c;
    v_ht := v_ht + v_centimes.ht_centimes;
    v_tva := v_tva + v_centimes.tva_centimes;
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('designation', v_designation, 'quantite', v_quantite,
      'prix_unitaire_ht', v_prix, 'taux_tva', v_taux));
  end loop;

  if (case when jsonb_typeof(p_devis->'montant_ht') = 'number' and jsonb_typeof(p_devis->'montant_tva') = 'number'
                and jsonb_typeof(p_devis->'montant_ttc') = 'number'
           then (p_devis->>'montant_ht')::numeric * 100 <> v_ht
             or (p_devis->>'montant_tva')::numeric * 100 <> v_tva
             or (p_devis->>'montant_ttc')::numeric * 100 <> v_ht + v_tva
           else true end) then
    raise exception 'Les montants du devis ne sont pas ceux de ses lignes : % € HT, % € de TVA, % € TTC.',
      replace(to_char(v_ht / 100.0, 'FM999999999990.00'), '.', ','),
      replace(to_char(v_tva / 100.0, 'FM999999999990.00'), '.', ','),
      replace(to_char((v_ht + v_tva) / 100.0, 'FM999999999990.00'), '.', ',') using errcode = '22023';
  end if;

  -- 16 bis. Le contact d'où vient le client du devis : une PROVENANCE, sans clé (comme `factures_emises.contact_id`), une
  -- chaîne qui nomme un contact de CE dossier — retiré ou effacé compris, comme `enregistrer_facture` le juge. Absente ou
  -- nulle, le devis n'en cite aucun.
  if coalesce(jsonb_typeof(p_devis->'contact_id'), 'null') <> 'null'
     and (jsonb_typeof(p_devis->'contact_id') <> 'string'
          or not exists (select 1 from public.contacts c where c.dossier_id = p_dossier_id and c.id::text = p_devis->>'contact_id')) then
    raise exception 'Le contact d''où vient le client du devis est introuvable dans ce dossier.' using errcode = 'P0002';
  end if;

  -- 17. Un IBAN dans un texte que le devis imprime (A7-Q3, comme `enregistrer_facture`), les valeurs telles qu'elles
  -- s'écrivent, dans l'ordre de l'impression ; le premier se nomme.
  select t.libelle into v_libelle
    from (select x.rang, 0 as ligne, x.libelle, x.valeur
            from (values
              (1, 'le nom du client', p_devis->>'tiers_nom'), (2, 'l''adresse du client', p_devis->>'tiers_adresse'),
              (3, 'le SIRET du client', p_devis->>'tiers_siret'), (4, 'l''objet du devis', p_devis->>'objet'),
              (5, 'l''adresse de livraison', p_devis->>'livraison_adresse'),
              (6, 'le code postal de livraison', p_devis->>'livraison_code_postal'),
              (7, 'la ville de livraison', p_devis->>'livraison_ville'), (8, 'le code service', p_devis->>'code_service'),
              (9, 'le numéro d''engagement', p_devis->>'numero_engagement'),
              (11, 'les conditions du devis', p_devis->>'conditions'),
              (12, 'les mentions légales du devis', p_devis->>'mentions_legales')
            ) as x(rang, libelle, valeur)
          union all
          select 10, l.ord::integer, 'la désignation de la ligne ' || l.ord, l.valeur->>'designation'
            from jsonb_array_elements(v_lignes) with ordinality as l(valeur, ord)) as t
   where public.porte_un_iban(t.valeur)
   order by t.rang, t.ligne
   limit 1;
  if v_libelle is not null then
    raise exception 'Un IBAN figure dans % : un devis n''imprime aucun IBAN ; celui du dossier figure sur ses factures, dans le RIB des paramètres de facturation, confirmé par le cabinet.',
      v_libelle using errcode = '22023';
  end if;

  if p_emettre then
    v_aujourdhui := (now() at time zone 'Europe/Paris')::date;
    if v_date > v_aujourdhui then
      raise exception 'Un devis ne s''émet pas daté de l''avenir : nous sommes le %.', to_char(v_aujourdhui, 'DD/MM/YYYY')
        using errcode = '22023';
    end if;
    if v_ht + v_tva <= 0 then
      raise exception 'Un devis émis porte un montant : son total TTC est positif.' using errcode = '22023';
    end if;
    -- 20 à 25. L'ÉMETTEUR, lu ici dans la transaction qui émet, jamais reçu de l'appelant — les règles de la validation
    -- d'une facture (A7a, A7-Q2, A7Q-Q1, A7-Q3), dans son ordre. Le cabinet (`admin_du_dossier`, le super-administrateur
    -- compris) n'est pas jugé sur ce qui manque : faute de dénomination, son devis prend le nom du dossier, celui que la
    -- facture figée imprime alors.
    select d.* into v_dossier from public.dossiers d where d.id = p_dossier_id;
    v_cabinet := public.admin_du_dossier(p_dossier_id);
    if v_dossier.forme_juridique is null and not v_cabinet then
      raise exception 'La forme juridique du dossier n''est pas renseignée : l''identité légale qu''un devis imprime est à régler par le cabinet avant qu''un devis s''émette depuis l''espace client.'
        using errcode = '22023';
    end if;
    -- L'entrepreneur individuel (la catégorie 1000 de l'INSEE) utilise sa dénomination, son nom précédé ou suivi des
    -- mots « entrepreneur individuel » ou des initiales « EI », sur tous ses documents professionnels (C. com., art.
    -- R526-27) : un devis comme une facture, quel qu'en soit l'auteur.
    if v_dossier.forme_juridique = '1000' and not public.porte_la_mention_ei(v_dossier.denomination_imprimee) then
      raise exception 'La forme juridique du dossier est celle d''un entrepreneur individuel : sa dénomination imprimée, son nom précédé ou suivi des initiales « EI » ou des mots « entrepreneur individuel » (C. com., art. R526-27), est à renseigner par le cabinet avant d''émettre un devis.'
        using errcode = '22023';
    end if;
    if btrim(coalesce(v_dossier.denomination_imprimee, ''), v_blancs) = '' and not v_cabinet then
      raise exception 'La dénomination du dossier n''est pas renseignée : le cabinet la renseigne avant qu''un devis s''émette depuis l''espace client.'
        using errcode = '22023';
    end if;
    if translate(coalesce(v_dossier.siret, ''), v_blancs, '') = '' and not v_cabinet then
      raise exception 'Le SIRET du dossier n''est pas renseigné : le cabinet le renseigne avant qu''un devis s''émette depuis l''espace client.'
        using errcode = '22023';
    end if;
    if btrim(coalesce(v_dossier.adresse, ''), v_blancs) = '' and not v_cabinet then
      raise exception 'L''adresse du dossier n''est pas renseignée : le cabinet la renseigne avant qu''un devis s''émette depuis l''espace client.'
        using errcode = '22023';
    end if;
    select e.nom, e.siret, e.adresse into v_emetteur_nom, v_emetteur_siret, v_emetteur_adresse
      from public.emetteur_du_dossier(v_dossier.nom, v_dossier.denomination_imprimee, v_dossier.siret, v_dossier.adresse) e;
    select x.libelle into v_libelle
      from (values (1, 'le nom de l''émetteur', v_emetteur_nom), (2, 'l''adresse de l''émetteur', v_emetteur_adresse),
                   (3, 'le SIRET de l''émetteur', v_emetteur_siret)) as x(rang, libelle, valeur)
     where public.porte_un_iban(x.valeur)
     order by x.rang
     limit 1;
    if v_libelle is not null then
      raise exception 'Un IBAN figure dans % : un devis n''imprime aucun IBAN ; celui du dossier figure sur ses factures, dans le RIB des paramètres de facturation, confirmé par le cabinet.',
        v_libelle using errcode = '22023';
    end if;
  end if;

  -- Le brouillon, écrit en entier : les contraintes des mentions du client jugent ici (23514). Sans émetteur : seule
  -- l'émission le pose, du dossier.
  if p_devis_id is null then
    insert into public.devis (
      dossier_id, date_emission, date_validite, objet,
      tiers_nom, tiers_adresse, tiers_siret, tiers_email,
      type_client, tiers_siren, tiers_adresse_electronique, code_service, numero_engagement,
      nature_operation, date_prestation, periode_debut, periode_fin,
      livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays,
      lignes, montant_ht, montant_tva, montant_ttc,
      conditions, mentions_legales, notes,
      cree_par, contact_id
    ) values (
      p_dossier_id, v_date, v_validite, p_devis->>'objet',
      p_devis->>'tiers_nom', p_devis->>'tiers_adresse', p_devis->>'tiers_siret', p_devis->>'tiers_email',
      nullif(p_devis->>'type_client', ''), nullif(p_devis->>'tiers_siren', ''),
      nullif(p_devis->>'tiers_adresse_electronique', ''), nullif(p_devis->>'code_service', ''),
      nullif(p_devis->>'numero_engagement', ''),
      nullif(p_devis->>'nature_operation', ''), nullif(p_devis->>'date_prestation', '')::date,
      nullif(p_devis->>'periode_debut', '')::date, nullif(p_devis->>'periode_fin', '')::date,
      nullif(p_devis->>'livraison_adresse', ''), nullif(p_devis->>'livraison_code_postal', ''),
      nullif(p_devis->>'livraison_ville', ''), nullif(p_devis->>'livraison_pays', ''),
      v_lignes, round(v_ht::numeric / 100, 2), round(v_tva::numeric / 100, 2), round((v_ht + v_tva)::numeric / 100, 2),
      p_devis->>'conditions', p_devis->>'mentions_legales', p_devis->>'notes',
      auth.uid(), (p_devis->>'contact_id')::uuid
    )
    returning id into v_id;
  else
    update public.devis d set
      date_emission = v_date,
      date_validite = v_validite,
      objet = p_devis->>'objet',
      tiers_nom = p_devis->>'tiers_nom',
      tiers_adresse = p_devis->>'tiers_adresse',
      tiers_siret = p_devis->>'tiers_siret',
      tiers_email = p_devis->>'tiers_email',
      type_client = nullif(p_devis->>'type_client', ''),
      tiers_siren = nullif(p_devis->>'tiers_siren', ''),
      tiers_adresse_electronique = nullif(p_devis->>'tiers_adresse_electronique', ''),
      code_service = nullif(p_devis->>'code_service', ''),
      numero_engagement = nullif(p_devis->>'numero_engagement', ''),
      nature_operation = nullif(p_devis->>'nature_operation', ''),
      date_prestation = nullif(p_devis->>'date_prestation', '')::date,
      periode_debut = nullif(p_devis->>'periode_debut', '')::date,
      periode_fin = nullif(p_devis->>'periode_fin', '')::date,
      livraison_adresse = nullif(p_devis->>'livraison_adresse', ''),
      livraison_code_postal = nullif(p_devis->>'livraison_code_postal', ''),
      livraison_ville = nullif(p_devis->>'livraison_ville', ''),
      livraison_pays = nullif(p_devis->>'livraison_pays', ''),
      lignes = v_lignes,
      montant_ht = round(v_ht::numeric / 100, 2),
      montant_tva = round(v_tva::numeric / 100, 2),
      montant_ttc = round((v_ht + v_tva)::numeric / 100, 2),
      conditions = p_devis->>'conditions',
      mentions_legales = p_devis->>'mentions_legales',
      notes = p_devis->>'notes',
      contact_id = (p_devis->>'contact_id')::uuid,
      emetteur_nom = null,
      emetteur_siret = null,
      emetteur_adresse = null
    where d.id = p_devis_id;
    v_id := p_devis_id;
  end if;

  -- L'émission : le numéro suivant de la série de l'année de la date, sous son verrou — deux émissions concurrentes se
  -- suivent, et la seconde prend le numéro suivant —, repris du plus haut numéro émis quand le repère retarde.
  if p_emettre then
    v_an := extract(year from v_date)::integer;
    insert into public.devis_numerotation (dossier_id, annee, dernier_numero)
    values (p_dossier_id, v_an, 0)
    on conflict (dossier_id, annee) do nothing;
    select n.dernier_numero into v_repere
      from public.devis_numerotation n
     where n.dossier_id = p_dossier_id and n.annee = v_an
       for update;
    v_prefixe := 'D' || v_an::text || '-';
    select coalesce(max(substr(d.numero, length(v_prefixe) + 1)::integer), 0) into v_emis
      from public.devis d
     where d.dossier_id = p_dossier_id and d.numero ~ ('^' || v_prefixe || '[0-9]+$');
    v_sequence := greatest(v_repere, v_emis) + 1;
    update public.devis_numerotation n set dernier_numero = v_sequence
     where n.dossier_id = p_dossier_id and n.annee = v_an;
    v_numero := v_prefixe || lpad(v_sequence::text, greatest(4, length(v_sequence::text)), '0');
    perform set_config('jd.emission_devis', v_id::text, true);
    update public.devis d set statut = 'emis', numero = v_numero, emis_par = auth.uid(), emis_le = now(),
           emetteur_nom = v_emetteur_nom, emetteur_siret = v_emetteur_siret, emetteur_adresse = v_emetteur_adresse
     where d.id = v_id;
    perform set_config('jd.emission_devis', '', true);
  end if;

  return query select v_id, v_numero;
end;
$$;

-- ══ 3. L'acompte tiré d'un devis : son brouillon reprend le contact du devis ══════════
create or replace function public.facturer_acompte_devis(p_dossier_id uuid, p_devis_id uuid, p_demande jsonb, p_date_versement date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_devis public.devis;
  v_dossier public.dossiers;
  v_emetteur record;
  v_mode text;
  v_pct numeric;
  v_ttc numeric;
  v_taux numeric[] := '{}';
  v_nature text[] := '{}';
  v_ht bigint[] := '{}';
  v_reste bigint[];
  v_part bigint[];
  v_n integer := 0;
  v_i integer;
  v_k integer;
  v_ht_devis bigint := 0;
  v_reste_total bigint := 0;
  v_ttc_reste bigint := 0;
  v_cible bigint;
  v_somme float8 := 0;
  v_rho float8;
  v_marge integer;
  v_essai bigint;
  v_haut bigint;
  v_ttc_essai bigint;
  v_meilleur_ht bigint;
  v_meilleur_ttc bigint;
  v_quoi text;
  v_nb integer := 0;
  v_lignes jsonb := '[]'::jsonb;
  v_total_ht bigint := 0;
  v_total_tva bigint := 0;
  v_refus text;
  v_facture uuid;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  r record;
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

  -- 1. L'état du devis et du dossier, dans l'ordre de `preparerAcompte`.
  if v_devis.statut <> 'emis' or v_devis.reponse is distinct from 'acceptee' then
    raise exception 'Le devis n’est pas accepté : un acompte ne se facture que sur un devis accepté.' using errcode = '22023';
  end if;
  if exists (select 1 from public.finale_active_du_devis(p_devis_id)) then
    raise exception 'Le devis a déjà sa facture finale : il ne s’en tire plus d’acompte.' using errcode = '22023';
  end if;
  if exists (select 1 from public.devis_factures l join public.factures_emises f on f.id = l.facture_id
              where l.devis_id = p_devis_id and l.role = 'acompte' and f.statut <> 'validee') then
    raise exception 'Un acompte de ce devis est encore en brouillon : validez-le ou supprimez-le avant d’en tirer un autre.'
      using errcode = '22023';
  end if;
  select d.* into v_dossier from public.dossiers d where d.id = p_dossier_id;
  if v_dossier.mode_comptable = 'engagement' then
    raise exception 'Le dossier tient sa comptabilité en engagement : l’acompte d’un devis ne s’y facture pas encore (son compte, le 4191, viendra avec l’engagement).'
      using errcode = '22023';
  end if;
  -- P5B3-Q1 (B) : pas d'acompte sur un devis qui porte des livraisons de biens (`devisDeBiens` : « biens » ou « mixte »),
  -- après l'état du devis et du dossier, avant la demande, comme le module (`REFUS_ACOMPTE_DE_BIENS`).
  if v_devis.nature_operation in ('biens', 'mixte') then
    raise exception 'Le devis porte des livraisons de biens : l’acompte d’un tel devis ne se facture pas encore ici, la TVA d’un acompte de biens étant due à son encaissement et sa part impayée à la livraison, ce que les écritures ne savent pas encore tenir. Le devis se facture en entier par sa facture finale.'
      using errcode = '22023';
  end if;

  -- 2. La saisie (`refusDeLaDemande`) ; une demande d'une autre forme que la `DemandeAcompte` du module, d'abord.
  v_mode := case when jsonb_typeof(p_demande) = 'object' then p_demande->>'mode' end;
  if v_mode is null or v_mode not in ('pourcentage', 'ttc') then
    raise exception 'La demande d’acompte est un pourcentage ou un montant TTC.' using errcode = '22023';
  end if;
  if v_mode = 'pourcentage' then
    if jsonb_typeof(p_demande->'pourcentage') = 'number' then
      v_pct := (p_demande->>'pourcentage')::numeric;
    end if;
    if v_pct is null or v_pct <= 0 or v_pct > 100 then
      raise exception 'Le pourcentage de l’acompte se situe au-delà de 0 %% et jusqu’à 100 %%.' using errcode = '22023';
    end if;
    if v_pct <> round(v_pct, 2) then
      raise exception 'Le pourcentage de l’acompte s’écrit au centième près.' using errcode = '22023';
    end if;
  else
    if jsonb_typeof(p_demande->'ttcCentimes') = 'number' then
      v_ttc := (p_demande->>'ttcCentimes')::numeric;
    end if;
    if v_ttc is null or v_ttc <= 0 then
      raise exception 'Le montant de l’acompte doit être positif.' using errcode = '22023';
    end if;
    if v_ttc <> trunc(v_ttc) then
      raise exception 'Le montant de l’acompte s’écrit au centime près.' using errcode = '22023';
    end if;
  end if;

  -- 3. Les restes (`restesDuDevis`) : les groupes (taux, nature) du devis dans l'ordre de première apparition, leur HT,
  -- moins ce que les acomptes en vigueur en ont facturé.
  for r in select coalesce((l.valeur->>'taux_tva')::numeric, 0) as taux, nullif(l.valeur->>'nature', '') as nature,
                  c.ht_centimes
             from jsonb_array_elements(v_devis.lignes) with ordinality as l(valeur, ord)
            cross join lateral public.centimes_ligne_facture(coalesce((l.valeur->>'quantite')::numeric, 0),
              coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0), coalesce((l.valeur->>'taux_tva')::numeric, 0), false) c
            order by l.ord loop
    v_k := null;
    for v_i in 1 .. v_n loop
      if v_taux[v_i] = r.taux and v_nature[v_i] is not distinct from r.nature then
        v_k := v_i;
        exit;
      end if;
    end loop;
    if v_k is null then
      v_n := v_n + 1;
      v_taux := v_taux || r.taux;
      v_nature := v_nature || r.nature;
      v_ht := v_ht || 0::bigint;
      v_k := v_n;
    end if;
    v_ht[v_k] := v_ht[v_k] + r.ht_centimes;
  end loop;
  v_reste := v_ht;
  for r in select a.numero, fl.taux_tva, fl.nature, c.ht_centimes
             from public.acomptes_en_vigueur(p_devis_id) a
             join public.facture_lignes fl on fl.facture_id = a.facture_id
            cross join lateral public.centimes_ligne_facture(fl.quantite, fl.prix_unitaire_ht, fl.taux_tva, false) c
            order by a.rang, fl.ordre loop
    v_k := null;
    for v_i in 1 .. v_n loop
      if v_taux[v_i] = r.taux_tva and v_nature[v_i] is not distinct from r.nature then
        v_k := v_i;
        exit;
      end if;
    end loop;
    if v_k is null then
      raise exception 'L’acompte % porte une ligne à % que le devis n’a pas.', r.numero, public.acompte_en_taux(r.taux_tva)
        using errcode = '22023';
    end if;
    v_reste[v_k] := v_reste[v_k] - r.ht_centimes;
  end loop;
  for v_i in 1 .. v_n loop
    if v_reste[v_i] < 0 then
      raise exception 'Les acomptes validés dépassent le devis à %.', public.acompte_en_taux(v_taux[v_i]) using errcode = '22023';
    end if;
    v_reste_total := v_reste_total + v_reste[v_i];
    v_ht_devis := v_ht_devis + v_ht[v_i];
  end loop;
  if v_reste_total = 0 then
    raise exception 'Les acomptes validés couvrent déjà tout le devis : il ne reste qu’à en tirer la facture finale.'
      using errcode = '22023';
  end if;

  -- 4. La cible HT. Un pourcentage : du devis ENTIER, sur son décimal exact, le demi loin de zéro (`cibleDuPourcentage`).
  if v_mode = 'pourcentage' then
    v_cible := round(v_pct * v_ht_devis * 0.01);
    if v_cible = 0 then
      raise exception 'Ce pourcentage du devis fait moins d’un centime.' using errcode = '22023';
    end if;
    if v_cible > v_reste_total then
      raise exception 'L’acompte (% HT) dépasse ce qui reste à facturer du devis (% HT).', public.acompte_en_euros(v_cible),
        public.acompte_en_euros(v_reste_total) using errcode = '22023';
    end if;
    v_quoi := public.acompte_en_taux(v_pct);
  else
    -- Un TTC (`cibleDuTtc`) : le HT dont l'acompte réparti a le TTC le plus proche, à égalité le plus petit, cherché dans la
    -- fenêtre du module, calculée comme lui en virgule flottante — ses bornes au même centime.
    for v_i in 1 .. v_n loop
      if v_reste[v_i] > 0 then
        v_ttc_reste := v_ttc_reste + v_reste[v_i] + round(v_reste[v_i] * v_taux[v_i] * 0.01)::bigint;
      end if;
    end loop;
    if v_ttc > v_ttc_reste then
      raise exception 'L’acompte (% TTC) dépasse ce qui reste à facturer du devis (% TTC).', public.acompte_en_euros(v_ttc),
        public.acompte_en_euros(v_ttc_reste) using errcode = '22023';
    end if;
    for v_i in 1 .. v_n loop
      v_somme := v_somme + (v_reste[v_i]::float8 * v_taux[v_i]::float8) / 100::float8;
    end loop;
    v_rho := 1::float8 + v_somme / v_reste_total::float8;
    v_marge := 3 * v_n + 3;
    v_essai := greatest(1, floor((v_ttc::float8 - v_marge) / v_rho)::bigint - 2);
    v_haut := least(v_reste_total, ceil((v_ttc::float8 + v_marge) / v_rho)::bigint + 2);
    while v_essai <= v_haut loop
      v_part := public.acompte_repartir_sur_les_restes(v_essai, v_reste);
      v_ttc_essai := 0;
      for v_i in 1 .. v_n loop
        if v_part[v_i] > 0 then
          v_ttc_essai := v_ttc_essai + v_part[v_i] + round(v_part[v_i] * v_taux[v_i] * 0.01)::bigint;
        end if;
      end loop;
      if v_meilleur_ht is null or abs(v_ttc_essai - v_ttc) < abs(v_meilleur_ttc - v_ttc) then
        v_meilleur_ht := v_essai;
        v_meilleur_ttc := v_ttc_essai;
      end if;
      v_essai := v_essai + 1;
    end loop;
    v_cible := v_meilleur_ht;
    v_quoi := public.acompte_en_euros(v_ttc) || ' TTC';
  end if;

  -- 5. Les lignes : une par groupe non nul, quantité 1, au prix de sa part, citant le devis et ce qui a été demandé.
  v_part := public.acompte_repartir_sur_les_restes(v_cible, v_reste);
  for v_i in 1 .. v_n loop
    if v_part[v_i] > 0 then
      v_nb := v_nb + 1;
    end if;
  end loop;
  for v_i in 1 .. v_n loop
    if v_part[v_i] > 0 then
      v_lignes := v_lignes || jsonb_build_array(jsonb_build_object(
        'designation', 'Acompte de ' || v_quoi || ' sur le devis ' || v_devis.numero
          || case when v_nb > 1 then ' — ' || coalesce(v_nature[v_i] || ', ', '') || 'TVA ' || public.acompte_en_taux(v_taux[v_i])
                  else '' end,
        'quantite', 1,
        'prix_unitaire_ht', v_part[v_i] * 0.01,
        'taux_tva', v_taux[v_i],
        'nature', v_nature[v_i]));
      v_total_ht := v_total_ht + v_part[v_i];
      v_total_tva := v_total_tva + round(v_part[v_i] * v_taux[v_i] * 0.01)::bigint;
    end if;
  end loop;

  -- 6. P5B-Q5 : la finale qu'il laisserait.
  v_refus := public.acompte_refus_de_la_finale_laissee(p_devis_id, v_lignes);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  -- 7. P5B2-Q1 : la date du versement, jamais après le jour de Paris (`refusDuVersementFutur`) ; en dernier, comme le module.
  if p_date_versement > v_aujourd_hui then
    raise exception 'Le versement ne se date pas dans l’avenir : nous sommes le %.', to_char(v_aujourd_hui, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;

  -- 8. Le brouillon, la marque, le lien.
  select e.* into v_emetteur
    from public.emetteur_du_dossier(v_dossier.nom, v_dossier.denomination_imprimee, v_dossier.siret, v_dossier.adresse) e;
  select e.facture_id into v_facture
    from public.enregistrer_facture(p_dossier_id, null, jsonb_build_object(
      'tiers_nom', v_devis.tiers_nom,
      'contact_id', (select c.id from public.contacts c where c.id = v_devis.contact_id and c.dossier_id = p_dossier_id),
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
      'montant_ht', v_total_ht * 0.01,
      'montant_tva', v_total_tva * 0.01,
      'montant_ttc', (v_total_ht + v_total_tva) * 0.01,
      'emetteur_nom', v_emetteur.nom,
      'emetteur_siret', v_emetteur.siret,
      'emetteur_adresse', v_emetteur.adresse
    ), v_lignes, false) e;
  perform set_config('jd.acompte_facture', v_facture::text, true);
  update public.factures_emises f
     set acompte = true, date_versement_acompte = nullif(p_date_versement, f.date_emission)
   where f.id = v_facture;
  perform set_config('jd.acompte_facture', '', true);
  insert into public.devis_factures (dossier_id, devis_id, facture_id, cree_par, role)
  values (p_dossier_id, p_devis_id, v_facture, auth.uid(), 'acompte');
  return v_facture;
end;
$$;

-- ══ 4. La facture tirée d'un devis : son brouillon reprend le contact du devis ══════════
create or replace function public.facturer_devis(p_dossier_id uuid, p_devis_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_devis public.devis;
  v_premiere text;
  v_facture uuid;
  v_dossier public.dossiers;
  v_emetteur record;
  v_lignes jsonb;
  v_reprises uuid[] := '{}';
  v_moins_ht bigint := 0;
  v_moins_tva bigint := 0;
  v_montant_ht numeric;
  v_montant_tva numeric;
  v_montant_ttc numeric;
  r record;
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
  select coalesce(a.numero, 'un brouillon') into v_premiere
    from public.finale_active_du_devis(p_devis_id) a
   order by a.cree_le, a.lien_id
   limit 1;
  if found then
    raise exception 'Le devis % a déjà sa facture (%) : un devis se transforme une fois.', v_devis.numero, v_premiere
      using errcode = '22023';
  end if;
  if exists (select 1 from public.devis_factures l join public.factures_emises f on f.id = l.facture_id
              where l.devis_id = p_devis_id and l.role = 'acompte' and f.statut <> 'validee') then
    raise exception 'Un acompte de ce devis est encore en brouillon : validez-le ou supprimez-le avant d’en tirer la facture finale.'
      using errcode = '22023';
  end if;

  -- Les lignes du devis, puis les reprises (`lignesDeLaFinale`).
  v_lignes := v_devis.lignes;
  for r in select a.facture_id, a.numero, a.date_emission, fl.prix_unitaire_ht, fl.taux_tva, fl.nature, c.ht_centimes,
                  c.tva_centimes
             from public.acomptes_en_vigueur(p_devis_id) a
             join public.facture_lignes fl on fl.facture_id = a.facture_id
            cross join lateral public.centimes_ligne_facture(-1, fl.prix_unitaire_ht, fl.taux_tva, false) c
            order by a.rang, fl.ordre loop
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object(
      'designation', 'Reprise de l’acompte ' || r.numero || ' du ' || to_char(r.date_emission, 'DD/MM/YYYY'),
      'quantite', -1,
      'prix_unitaire_ht', r.prix_unitaire_ht,
      'taux_tva', r.taux_tva,
      'nature', r.nature));
    v_reprises := v_reprises || r.facture_id;
    v_moins_ht := v_moins_ht + r.ht_centimes;
    v_moins_tva := v_moins_tva + r.tva_centimes;
  end loop;
  v_montant_ht := v_devis.montant_ht;
  v_montant_tva := v_devis.montant_tva;
  v_montant_ttc := v_devis.montant_ttc;
  if cardinality(v_reprises) > 0 then
    v_montant_ht := v_devis.montant_ht + v_moins_ht * 0.01;
    v_montant_tva := v_devis.montant_tva + v_moins_tva * 0.01;
    v_montant_ttc := v_montant_ht + v_montant_tva;
  end if;

  select d.* into v_dossier from public.dossiers d where d.id = p_dossier_id;
  select e.* into v_emetteur
    from public.emetteur_du_dossier(v_dossier.nom, v_dossier.denomination_imprimee, v_dossier.siret, v_dossier.adresse) e;
  select e.facture_id into v_facture
    from public.enregistrer_facture(p_dossier_id, null, jsonb_build_object(
      'tiers_nom', v_devis.tiers_nom,
      'contact_id', (select c.id from public.contacts c where c.id = v_devis.contact_id and c.dossier_id = p_dossier_id),
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
      'montant_ht', v_montant_ht,
      'montant_tva', v_montant_tva,
      'montant_ttc', v_montant_ttc,
      'emetteur_nom', v_emetteur.nom,
      'emetteur_siret', v_emetteur.siret,
      'emetteur_adresse', v_emetteur.adresse
    ), v_lignes, false) e;

  if cardinality(v_reprises) > 0 then
    perform set_config('jd.reprises_facture', v_facture::text, true);
    update public.facture_lignes fl
       set reprise_facture_id = x.reprise
      from unnest(v_reprises) with ordinality as x(reprise, k)
     where fl.facture_id = v_facture and fl.ordre = jsonb_array_length(v_devis.lignes) + x.k - 1;
    perform set_config('jd.reprises_facture', '', true);
  end if;
  insert into public.devis_factures (dossier_id, devis_id, facture_id, cree_par, role)
  values (p_dossier_id, p_devis_id, v_facture, auth.uid(), 'finale');
  return v_facture;
end;
$$;
