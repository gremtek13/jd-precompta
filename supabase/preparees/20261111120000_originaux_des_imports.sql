-- A8D2A : LES ORIGINAUX DES FACTURES REPRISES DANS LE SEAU DES VENTES (ligne 51.5) — PRÉPARÉE, PAS APPLIQUÉE.
--
-- Ce qu'elle fait. Le seau privé `ventes` ne prenait que le logo des factures (PNG ou JPEG, 500 Kio). Elle lui fait
-- porter aussi l'ORIGINAL d'une facture reprise de l'ancien logiciel (A8, point 6 de la conception), sous
-- `<dossier>/imports/<lot>/<empreinte>.<pdf|xml|csv>` :
--   1. le seau admet, en plus du PNG et du JPEG, le PDF (Factur-X), le texte brut (un XML CII ou UBL, rangé en
--      `text/plain` comme les originaux XML des plateformes dans le seau des pièces : un XML servi sous un type XML peut
--      porter du script, comme un SVG) et le CSV, jusqu'à 20 Mio (la borne des pièces, S226-Q1). Le stockage juge le type
--      et la taille d'un dépôt au niveau du SEAU, jamais d'une policy (elle ne voit pas le fichier) : ces bornes valent
--      pour tout le seau ;
--   2. un logo reste borné à 500 Kio là où il compte : `enregistrer_parametres_facturation`, au huitième rang, prenait
--      la borne du seau ; elle prend désormais la plus petite de celle-ci et de 512 000 octets. La fonction est recopiée
--      de la production à l'octet près (son empreinte vérifiée d'abord), trois lignes ajoutées, rien d'autre ; son type
--      reste celui que dit le nom du logo, PNG ou JPEG ;
--   3. LIRE un fichier sous `<dossier>/imports/` : le cabinet du dossier seul (`admin_du_dossier`) ; le reste du seau,
--      le logo compris, comme hier (`gere_les_ventes`). La policy de lecture est RESSERRÉE sur ce sous-arbre, vide
--      aujourd'hui ; ailleurs, inchangée ;
--   4. DÉPOSER un original : le cabinet du dossier seul, sous la forme EXACTE du chemin — le dossier et le lot en UUID
--      minuscules, le nom l'empreinte SHA-256 du fichier, l'extension pdf, xml ou csv. Toute autre forme est refusée, et
--      la forme se juge dans un `case` AVANT de tirer le dossier : un chemin mal formé ne fait rien lever.
-- Inchangés : le dépôt d'un logo ; aucune policy de mise à jour (un fichier ne se modifie ni ne s'écrase) ; la
-- suppression, au chef du cabinet seul, comme pour tout fichier du seau (la suppression d'un dossier) ; le client ne
-- dépose, ne lit, ne modifie ni ne retire jamais un original ; le seau des pièces et `fichier_fige` (INAL1).
--
-- Par l'OUTIL (`apply_migration`) : un bloc de garde, une mise à jour du seau, une fonction redéfinie, une policy
-- modifiée (`alter policy`), une policy ajoutée — aucun mot de retrait. Son retour, lui, se COLLE.
-- Essai : supabase/essais/originauxDesImports.sql ; puis rls.sql, logoDesFactures.sql, bornesStockage.sql.

do $garde$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null
     or to_regprocedure('storage.foldername(text)') is null or to_regprocedure('public.admin_du_dossier(uuid)') is null
     or to_regprocedure('public.gere_les_ventes(uuid)') is null then
    raise exception 'Le stockage ou les prédicats du dossier ne sont pas ceux que la migration suppose : relire la base.';
  end if;
  if not exists (select 1 from storage.buckets where id = 'ventes' and not public and file_size_limit = 512000
                   and allowed_mime_types = array['image/png', 'image/jpeg']) then
    raise exception 'Le seau des ventes n''est pas celui que la migration suppose (privé, 500 Kio, PNG et JPEG) : relire la base.';
  end if;
  if (select count(*) from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname like 'ventes\_%') <> 3
     or not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ventes_lecture'
                      and cmd = 'SELECT' and roles = array['authenticated']::name[] and md5(qual) = '5dcf013e1116f57c5d253e9e92c58dc1') then
    raise exception 'Les policies du seau des ventes ne sont pas celles que la migration suppose : relire la base.';
  end if;
  if md5(pg_get_functiondef('public.enregistrer_parametres_facturation(uuid, uuid, jsonb)'::regprocedure))
     <> '5d18ba49cb0db04a237c904d1b65d4d5' then
    raise exception 'enregistrer_parametres_facturation n''est pas la version que la migration recopie (iban_hors_des_parametres) : relire la base.';
  end if;
end
$garde$;

-- 1. Le seau.
update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array['image/png', 'image/jpeg', 'application/pdf', 'text/plain', 'text/csv']
 where id = 'ventes';

-- 2. Le logo, toujours sous 500 Kio.
CREATE OR REPLACE FUNCTION public.enregistrer_parametres_facturation(p_dossier_id uuid, p_remplace_id uuid, p_parametres jsonb)
 RETURNS parametres_facturation
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_courante public.parametres_facturation;
  v_ecrite public.parametres_facturation;
  v_inconnu text;
  v_escompte text;
  v_penalites text;
  v_mentions text;
  v_pied text;
  v_delai numeric;
  v_moyen text;
  v_iban text;
  v_bic text;
  v_titulaire text;
  v_converti text;
  v_car text;
  v_etat text;
  v_confirme_par uuid;
  v_confirme_le timestamptz;
  i int;
  v_logo_chemin text;
  v_logo_sha256 text;
  v_objet jsonb;
  v_borne bigint;
  v_types text[];
  v_type text;
  v_libelle text;
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- Deux saisies du même dossier ne se croisent pas : la seconde attend la première, puis la voit (rang 2).
  perform pg_advisory_xact_lock(hashtextextended('jd.parametres_facturation:' || p_dossier_id::text, 0));

  -- 2. La version remplacée : une version de ce dossier, et la courante — celle qu'aucune ne remplace.
  if p_remplace_id is not null
     and not exists (select 1 from public.parametres_facturation p where p.id = p_remplace_id and p.dossier_id = p_dossier_id) then
    raise exception 'La version à remplacer n''est pas une version des paramètres de facturation de ce dossier.' using errcode = '22023';
  end if;
  select * into v_courante from public.parametres_facturation p
   where p.dossier_id = p_dossier_id
     and not exists (select 1 from public.parametres_facturation s where s.remplace_id = p.id);
  if p_remplace_id is distinct from v_courante.id then
    raise exception 'D''autres paramètres de facturation ont été enregistrés entre-temps (le %) : relire avant d''enregistrer.',
      to_char(v_courante.cree_le at time zone 'Europe/Paris', 'DD/MM/YYYY "à" HH24:MI') using errcode = '22023';
  end if;

  -- 3. La saisie : un objet JSON, aux seuls champs d'une version. Une clé inconnue est REFUSÉE plutôt qu'ignorée : ignorée,
  -- la version s'écrirait en perdant en silence ce que l'écran croyait enregistrer.
  if p_parametres is null or jsonb_typeof(p_parametres) <> 'object' then
    raise exception 'Les paramètres de facturation se donnent en un objet JSON, un champ par paramètre.' using errcode = '22023';
  end if;
  select k into v_inconnu from jsonb_object_keys(p_parametres) k
   where k not in ('delai_paiement_jours', 'moyen_prefere', 'escompte', 'penalites', 'mentions_complementaires', 'pied_de_page',
                   'iban', 'bic', 'titulaire_compte', 'logo_chemin', 'logo_sha256')
   order by k collate "C" limit 1;
  if v_inconnu is not null then
    raise exception 'Le champ « % » n''est pas un paramètre de facturation.',
      case when char_length(v_inconnu) > 80 then left(v_inconnu, 79) || '…' else v_inconnu end using errcode = '22023';
  end if;

  -- 4. Les textes, chacun s'il est donné. Un champ se lit par son TYPE JSON d'abord : un nombre n'est pas un texte.
  if coalesce(jsonb_typeof(p_parametres->'escompte'), 'null') <> 'null' then
    if jsonb_typeof(p_parametres->'escompte') <> 'string' or btrim(p_parametres->>'escompte', E' \t\n\r') = ''
       or char_length(p_parametres->>'escompte') > 300 then
      raise exception 'Les conditions d''escompte sont un texte de trois cents caractères au plus, qui ne soit pas vide.' using errcode = '22023';
    end if;
    v_escompte := p_parametres->>'escompte';
  end if;
  if coalesce(jsonb_typeof(p_parametres->'penalites'), 'null') <> 'null' then
    if jsonb_typeof(p_parametres->'penalites') <> 'string' or btrim(p_parametres->>'penalites', E' \t\n\r') = ''
       or char_length(p_parametres->>'penalites') > 300 then
      raise exception 'Les pénalités de retard sont un texte de trois cents caractères au plus, qui ne soit pas vide.' using errcode = '22023';
    end if;
    v_penalites := p_parametres->>'penalites';
  end if;
  if coalesce(jsonb_typeof(p_parametres->'mentions_complementaires'), 'null') <> 'null' then
    if jsonb_typeof(p_parametres->'mentions_complementaires') <> 'string'
       or btrim(p_parametres->>'mentions_complementaires', E' \t\n\r') = ''
       or char_length(p_parametres->>'mentions_complementaires') > 1000 then
      raise exception 'Les mentions complémentaires sont un texte de mille caractères au plus, qui ne soit pas vide.' using errcode = '22023';
    end if;
    v_mentions := p_parametres->>'mentions_complementaires';
  end if;
  if coalesce(jsonb_typeof(p_parametres->'pied_de_page'), 'null') <> 'null' then
    if jsonb_typeof(p_parametres->'pied_de_page') <> 'string' or btrim(p_parametres->>'pied_de_page', E' \t\n\r') = ''
       or char_length(p_parametres->>'pied_de_page') > 500 then
      raise exception 'Le pied de page est un texte de cinq cents caractères au plus, qui ne soit pas vide.' using errcode = '22023';
    end if;
    v_pied := p_parametres->>'pied_de_page';
  end if;

  -- 5. Le délai de paiement : un nombre entier de jours, de 0 à 60. Le `case` lit le nombre seulement quand c'en est un
  -- (entre parenthèses : sans elles, plpgsql couperait la condition au premier `then`).
  if coalesce(jsonb_typeof(p_parametres->'delai_paiement_jours'), 'null') <> 'null' then
    if (case when jsonb_typeof(p_parametres->'delai_paiement_jours') <> 'number' then true
             else (p_parametres->>'delai_paiement_jours')::numeric not between 0 and 60
                  or (p_parametres->>'delai_paiement_jours')::numeric <> trunc((p_parametres->>'delai_paiement_jours')::numeric) end) then
      raise exception 'Le délai de paiement est un nombre entier de jours, de 0 à 60.' using errcode = '22023';
    end if;
    v_delai := (p_parametres->>'delai_paiement_jours')::numeric;
  end if;

  -- 6. Le moyen de paiement proposé : l'un des huit du registre des encaissements (`encaissements_factures_moyen`).
  if coalesce(jsonb_typeof(p_parametres->'moyen_prefere'), 'null') <> 'null' then
    if jsonb_typeof(p_parametres->'moyen_prefere') <> 'string'
       or p_parametres->>'moyen_prefere' not in ('virement', 'cheque', 'carte', 'prelevement', 'especes', 'effet', 'compensation', 'autre') then
      raise exception 'Le moyen de paiement proposé est l''un des huit du registre des encaissements.' using errcode = '22023';
    end if;
    v_moyen := p_parametres->>'moyen_prefere';
  end if;

  -- 7. Le RIB : l'IBAN — sa forme, puis sa clé —, puis le BIC et le titulaire, qui ne se donnent qu'avec lui.
  if coalesce(jsonb_typeof(p_parametres->'iban'), 'null') <> 'null' then
    if jsonb_typeof(p_parametres->'iban') <> 'string' or p_parametres->>'iban' !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$' then
      raise exception 'L''IBAN s''écrit sans espace, en majuscules : les deux lettres du pays, deux chiffres de contrôle, puis d''un à trente lettres ou chiffres.'
        using errcode = '22023';
    end if;
    v_iban := p_parametres->>'iban';
    -- La clé (ISO 13616, par l'ISO/IEC 7064 MOD 97-10) : les quatre premiers caractères passent à la fin, chaque lettre
    -- devient deux chiffres (A = 10 … Z = 35, son code moins 55), et le nombre, divisé par 97, laisse 1. Un chiffre a un
    -- code de 48 à 57, une lettre de 65 à 90 : la forme vérifiée plus haut n'admet rien d'autre.
    v_converti := '';
    for i in 1 .. char_length(v_iban) loop
      v_car := substr(substr(v_iban, 5) || left(v_iban, 4), i, 1);
      v_converti := v_converti || case when ascii(v_car) <= 57 then v_car else (ascii(v_car) - 55)::text end;
    end loop;
    if v_converti::numeric % 97 <> 1 then
      raise exception 'L''IBAN ne passe pas sa clé de contrôle : une erreur de saisie, sans doute.' using errcode = '22023';
    end if;
  end if;
  if coalesce(jsonb_typeof(p_parametres->'bic'), 'null') <> 'null' then
    if v_iban is null then
      raise exception 'Un BIC se donne avec l''IBAN du compte.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_parametres->'bic') <> 'string' or p_parametres->>'bic' !~ '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$' then
      raise exception 'Le BIC s''écrit en huit ou onze caractères, sans espace, en majuscules : quatre lettres ou chiffres, les deux lettres du pays, deux lettres ou chiffres, puis trois facultatifs.'
        using errcode = '22023';
    end if;
    v_bic := p_parametres->>'bic';
  end if;
  if coalesce(jsonb_typeof(p_parametres->'titulaire_compte'), 'null') <> 'null' then
    if v_iban is null then
      raise exception 'Le titulaire du compte se donne avec son IBAN.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_parametres->'titulaire_compte') <> 'string' or btrim(p_parametres->>'titulaire_compte', E' \t\n\r') = ''
       or char_length(p_parametres->>'titulaire_compte') > 70 then
      raise exception 'Le titulaire du compte est un texte de soixante-dix caractères au plus, qui ne soit pas vide.' using errcode = '22023';
    end if;
    v_titulaire := p_parametres->>'titulaire_compte';
  end if;

  -- 8. Le logo (étape A5c) : le chemin et l'empreinte, ensemble ou aucun — une clé absente ou nulle vaut « aucun logo », et
  -- une version sans logo le RETIRE ; l'empreinte, puis le chemin, à leur forme ; le chemin dans CE dossier, nommé par son
  -- empreinte. Puis, pour un logo qui n'est pas celui de la version remplacée, le fichier lui-même, tel que le stockage le
  -- range : dans le seau `ventes`, du type que dit son nom, sous la borne du seau — le type et la borne tels que le
  -- catalogue les dit (`storage.buckets`). Un logo INCHANGÉ n'est pas un changement : son fichier a été jugé quand il a
  -- été posé.
  if coalesce(jsonb_typeof(p_parametres->'logo_chemin'), 'null') <> 'null'
     or coalesce(jsonb_typeof(p_parametres->'logo_sha256'), 'null') <> 'null' then
    if coalesce(jsonb_typeof(p_parametres->'logo_chemin'), 'null') = 'null'
       or coalesce(jsonb_typeof(p_parametres->'logo_sha256'), 'null') = 'null' then
      raise exception 'Le logo se donne par son chemin et son empreinte, ensemble.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_parametres->'logo_sha256') <> 'string' or p_parametres->>'logo_sha256' !~ '^[0-9a-f]{64}$' then
      raise exception 'L''empreinte du logo est son SHA-256 : soixante-quatre chiffres hexadécimaux, en minuscules.'
        using errcode = '22023';
    end if;
    v_logo_sha256 := p_parametres->>'logo_sha256';
    if jsonb_typeof(p_parametres->'logo_chemin') <> 'string'
       or p_parametres->>'logo_chemin' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logos/[0-9a-f]{64}\.(png|jpg)$' then
      raise exception 'Le chemin du logo s''écrit « dossier/logos/empreinte.png » ou « .jpg » : l''identifiant du dossier, puis l''empreinte du fichier, en minuscules.'
        using errcode = '22023';
    end if;
    v_logo_chemin := p_parametres->>'logo_chemin';
    if split_part(v_logo_chemin, '/', 1) <> p_dossier_id::text then
      raise exception 'Le logo est un fichier d''un autre dossier.' using errcode = '22023';
    end if;
    if split_part(split_part(v_logo_chemin, '/', 3), '.', 1) <> v_logo_sha256 then
      raise exception 'Le nom du fichier du logo n''est pas son empreinte.' using errcode = '22023';
    end if;
    if (v_logo_chemin, v_logo_sha256) is distinct from (v_courante.logo_chemin, v_courante.logo_sha256) then
      select o.metadata into v_objet from storage.objects o
       where o.bucket_id = 'ventes' and o.name = v_logo_chemin
       order by o.created_at desc nulls last limit 1;
      if not found then
        raise exception 'Le logo n''est pas dans le seau des ventes du dossier : le déposer d''abord.' using errcode = '22023';
      end if;
      select b.file_size_limit, b.allowed_mime_types into v_borne, v_types from storage.buckets b where b.id = 'ventes';
      -- A8d2a (migration originaux_des_imports) : le seau des ventes porte aussi les originaux des factures reprises,
      -- jusqu'à 20 Mio ; un logo reste sous 500 Kio, la plus petite des deux bornes (celle du seau, si on l'abaisse).
      v_borne := least(v_borne, 512000);
      -- Le type que le stockage a rangé, sans ses paramètres, en minuscules : celui que dit le nom du fichier, et que le
      -- seau admet. Un fichier sans métadonnées n'a pas de type.
      v_type := lower(btrim(split_part(v_objet->>'mimetype', ';', 1)));
      if v_type is distinct from (case when right(v_logo_chemin, 4) = '.png' then 'image/png' else 'image/jpeg' end)
         or (v_types is not null and not (v_type = any (v_types))) then
        raise exception 'Le fichier du logo n''est pas une image PNG ou JPEG du type que dit son nom.' using errcode = '22023';
      end if;
      if coalesce(v_objet->>'size', '') !~ '^[0-9]{1,18}$' or (v_borne is not null and (v_objet->>'size')::bigint > v_borne) then
        raise exception 'Le fichier du logo pèse plus que les % octets que le seau des ventes admet.', v_borne using errcode = '22023';
      end if;
    end if;
  end if;

  -- 9. Un IBAN dans un texte libre (A7-Q3, migration `iban_hors_des_parametres`), quel que soit l'auteur : les conditions
  -- d'escompte, les pénalités de retard, les mentions complémentaires, le pied de page, dans l'ordre du quatrième rang —
  -- reconnu par sa clé (`porte_un_iban`). Un IBAN ne s'imprime sur une facture que par le RIB, que le cabinet confirme.
  select x.libelle into v_libelle
    from (values (1, 'les conditions d''escompte', v_escompte), (2, 'les pénalités de retard', v_penalites),
                 (3, 'les mentions complémentaires', v_mentions), (4, 'le pied de page', v_pied)) as x(rang, libelle, valeur)
   where public.porte_un_iban(x.valeur)
   order by x.rang
   limit 1;
  if v_libelle is not null then
    raise exception 'Un IBAN figure dans % : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.',
      v_libelle using errcode = '22023';
  end if;

  -- L'état du RIB (MEG1-Q12, hypothèse) : sans IBAN, aucun ; celui de la version remplacée, inchangé — l'IBAN, le BIC et le
  -- titulaire —, garde son état et sa confirmation ; changé par le cabinet du dossier, il est confirmé d'emblée ; changé
  -- par un client « Ventes », il n'est que PROPOSÉ.
  if v_iban is null then
    v_etat := null;
  elsif v_courante.id is not null
        and (v_iban, v_bic, v_titulaire) is not distinct from (v_courante.iban, v_courante.bic, v_courante.titulaire_compte) then
    v_etat := v_courante.rib_etat;
    v_confirme_par := v_courante.rib_confirme_par;
    v_confirme_le := v_courante.rib_confirme_le;
  elsif public.admin_du_dossier(p_dossier_id) then
    v_etat := 'confirme';
    v_confirme_par := auth.uid();
    v_confirme_le := now();
  else
    v_etat := 'propose';
  end if;

  -- L'écriture : les colonnes énumérées ; l'auteur et l'instant posés par la base.
  insert into public.parametres_facturation (dossier_id, delai_paiement_jours, moyen_prefere, escompte, penalites,
                                             mentions_complementaires, pied_de_page, iban, bic, titulaire_compte, rib_etat,
                                             rib_confirme_par, rib_confirme_le, remplace_id, auteur, logo_chemin, logo_sha256)
  values (p_dossier_id, v_delai, v_moyen, v_escompte, v_penalites, v_mentions, v_pied, v_iban, v_bic, v_titulaire, v_etat,
          v_confirme_par, v_confirme_le, p_remplace_id, auth.uid(), v_logo_chemin, v_logo_sha256)
  returning * into v_ecrite;
  return v_ecrite;
end
$function$;

-- 3. Lire : un original, le cabinet du dossier seul ; le reste du seau, comme hier.
alter policy ventes_lecture on storage.objects
  using (
    bucket_id = 'ventes'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/' then public.admin_du_dossier((storage.foldername(name))[1]::uuid)
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then public.gere_les_ventes((storage.foldername(name))[1]::uuid)
      else false
    end
  );

-- 4. Déposer un original : le cabinet du dossier seul, sous la forme exacte du chemin.
create policy ventes_depot_d_un_original on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ventes'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}\.(pdf|xml|csv)$' then public.admin_du_dossier((storage.foldername(name))[1]::uuid)
      else false
    end
  );
