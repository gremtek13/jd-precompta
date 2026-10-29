-- UN IBAN HORS DES TEXTES DES PARAMÈTRES DE FACTURATION (espace client, étape A7, ligne 51.5 ; la réponse (B) du cabinet à
-- A7-Q3, le 28/10/2026 ; HISTORIQUE.md, « LA FACTURE FIGE SES MENTIONS : L'ÉMETTEUR DU DOSSIER ET L'IBAN HORS DES TEXTES
-- LIBRES »). Préparée sous une version PROVISOIRE, postérieure à celle de `mentions_figees`, qu'elle suppose : elle appelle
-- `porte_un_iban`, que celle-ci pose.
--
-- POURQUOI. Un IBAN ne s'imprime sur une facture que par le RIB des paramètres, que le cabinet confirme quand un accès
-- « Ventes » le pose (MEG1-Q12). Les textes libres des paramètres — les conditions d'escompte, les pénalités de retard,
-- les mentions complémentaires, le pied de page — s'impriment sans confirmation (la facture les fige à sa validation,
-- étape A7) : un IBAN glissé là contournerait la confirmation, et un pied de page garderait l'ancien après un changement
-- de RIB. La réponse du cabinet : un tel texte se refuse, en base et avant le clic, quel que soit son auteur.
--
-- CE QU'ELLE CHANGE : `enregistrer_parametres_facturation`, reprise du texte de l'étape A5c1 (migration
-- `logo_des_factures`) au caractère près, à deux endroits près — une variable, et un NEUVIÈME rang, après le logo : un
-- texte libre qui porte un IBAN valide (`porte_un_iban`, reconnu par sa clé, jamais par sa seule forme), les quatre dans
-- l'ordre du quatrième rang, pour tout auteur (22023). Au dernier rang : un enregistrement que la base refusait hier l'est
-- encore par le même premier message. src/lib/parametresFacturation.ts le redit avant le clic, dans le même ordre et sous
-- les mêmes mots.
--
-- LES CHEMINS QUI ÉCRIVENT CES TEXTES : cette fonction seule, pour le cabinet et le client « Ventes » ; `confirmer_rib` ne
-- change que l'état du RIB, et la garde des versions refuse toute autre modification ; la restauration (l'insertion du
-- super-administrateur, la policy `parametres_facturation_restauration`) RÉINSÈRE une version telle qu'elle a été
-- enregistrée, sans la juger : une sauvegarde d'avant se restaure. Une version qui porte un IBAN, enregistrée avant cette
-- migration ou restaurée, reste ; la validation d'une facture la refuse (`enregistrer_facture`, migration
-- `mentions_figees`), et une autre version la remplace.
--
-- CE QU'ELLE NE FAIT PAS : ni table, ni colonne, ni contrainte, ni policy, ni droit d'une table ; aucune donnée lue ni
-- écrite d'avance. Le texte ne supprime rien, ni ligne ni objet — sa révocation redit des droits que la fonction n'a
-- déjà plus, comme celle de `ventes_sur_dossier_bascule`, que l'outil a appliquée sans demander de confirmation — : elle
-- s'applique par l'outil (`apply_migration`), APRÈS `mentions_figees`. Son retour arrière, qui rend la fonction de l'étape
-- A5c1, est donné à part : il se colle (il retire sa ligne de l'historique) et ÉLARGIT, sur l'accord du cabinet
-- seulement. NEUTRE AUJOURD'HUI : la production n'a aucune version des paramètres de facturation (relu le 29/10/2026).

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application, une base sans la migration `mentions_figees` ou dont `porte_un_iban` a changé
-- depuis, et une fonction remplacée qui ne serait plus celle de l'étape A5c1 — à l'empreinte de son corps, les retours
-- chariot d'un collage écartés, relue en production le 29/10/2026.
do $garde$
declare
  v_corps text := (select p.prosrc from pg_proc p
                    where p.oid = to_regprocedure('public.enregistrer_parametres_facturation(uuid, uuid, jsonb)'));
begin
  if strpos(coalesce(v_corps, ''), 'porte_un_iban(') > 0 then
    raise exception 'La migration iban_hors_des_parametres est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regprocedure('public.porte_un_iban(text)') is null then
    raise exception 'La migration mentions_figees n''est pas en base : elle pose porte_un_iban, que celle-ci appelle — l''appliquer d''abord, puis celle-ci.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = 'public.porte_un_iban(text)'::regprocedure)
     <> '50e5381c471954bb1f48bb7b7d2408d9' then
    raise exception 'La fonction porte_un_iban n''est plus celle de la migration mentions_figees (empreinte attendue 50e5381c…) : la relire avant d''appliquer celle-ci.';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname = 'enregistrer_parametres_facturation') <> 1
     or md5(replace(coalesce(v_corps, ''), chr(13), '')) <> '2fb248dbc7374552843096feb00c4f74' then
    raise exception 'La fonction enregistrer_parametres_facturation n''est plus celle que cette migration remplace (empreinte attendue 2fb248db…) : la relire avant de l''appliquer.';
  end if;
end
$garde$;

-- ══ 1. Enregistrer les paramètres de facturation : le neuvième rang ══════════
-- Le texte de l'étape A5c1, à deux endroits près : la variable `v_libelle` ; le neuvième rang, avant l'état du RIB et
-- l'écriture.
create or replace function public.enregistrer_parametres_facturation(p_dossier_id uuid, p_remplace_id uuid, p_parametres jsonb)
returns public.parametres_facturation
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- ══ 2. Les droits d'exécution ══════════
-- Ceux d'A5a, redits : la fonction vérifie l'accès elle-même ; un anonyme n'a rien à y faire.
revoke execute on function public.enregistrer_parametres_facturation(uuid, uuid, jsonb) from public, anon;
grant execute on function public.enregistrer_parametres_facturation(uuid, uuid, jsonb) to authenticated;

comment on function public.enregistrer_parametres_facturation(uuid, uuid, jsonb) is
  'Enregistre une version des paramètres de facturation d''un dossier, ou en remplace la courante, pour le cabinet ou le client qui porte la case « Ventes » : l''accès d''abord, puis huit rangs de refus dans un ordre fixé, le logo puis un texte libre qui porte un IBAN aux deux derniers (A7-Q3, pour tout auteur) ; un RIB changé par le client reste proposé ; un logo est un fichier du dossier dans le seau ventes. Rend la version écrite.';
