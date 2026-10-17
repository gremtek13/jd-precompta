-- LE LOGO DES FACTURES ET SON SEAU, EN BASE (espace client, étape A5c1 ; ligne 51.5 ; conception : HISTORIQUE.md, « L'ESPACE
-- CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.5.1 et §A.5.2, « Le logo »).
-- Présentée au cabinet avant d'être appliquée : elle OUVRE au client qui porte la case « Ventes » un seau du stockage, en
-- lecture et en dépôt (CLAUDE.md, « une policy qui lui ouvre une lecture se présente au cabinet »).
--
-- CE QU'ELLE POSE :
--   - le seau `ventes`, PRIVÉ, borné en base comme les trois autres (migration `bornes_du_stockage`) : 500 Kio au plus
--     (512 000 octets, comme `cabinet-logos`), PNG ou JPEG et rien d'autre ;
--   - trois policies `to authenticated` sur `storage.objects`, qui ne valent que pour ce seau : la LECTURE et le DÉPÔT d'un
--     logo, par le cabinet du dossier et l'accès client qui porte « Ventes » (`gere_les_ventes`) ; la SUPPRESSION, par le
--     chef du cabinet du dossier seul ; aucune mise à jour ;
--   - sur `parametres_facturation`, le logo d'une version : `logo_chemin` et `logo_sha256`, et trois contraintes ;
--   - `enregistrer_parametres_facturation`, réécrite à partir de son texte d'A5a : elle admet le logo et le juge, à un
--     HUITIÈME rang ; ses sept rangs d'hier gardent leur ordre et leurs mots, au caractère près.
--
-- LE LOGO. Ce que la facture d'un dossier imprimera en tête (§A.5.1 : aucune obligation, le client « Ventes » ou le cabinet
-- le règle). Une image PNG (ISO/IEC 15948) ou JPEG (ISO/IEC 10918-1), 500 Kio au plus, JAMAIS un SVG : un SVG est un document
-- XML qui peut porter du script (W3C, SVG 1.1, chapitre 18, « Scripting »). Ni WebP, que le seau public des logos de cabinet
-- admet pour l'écran : une facture se fige en PDF, et le PDF ne sait porter une image matricielle que décodée par ses
-- propres filtres — le JPEG par `DCTDecode`, le PNG décompressé par `FlateDecode` et ses prédicteurs (ISO 32000-1, §7.4) —,
-- aucun pour le WebP ; les bibliothèques qui écrivent un PDF n'embarquent que ces deux formats.
--
-- OÙ IL VIT. Dans le seau `ventes`, sous `<dossier>/logos/<empreinte>.<png|jpg>` : le premier segment du chemin EST le
-- dossier, comme dans `pieces` et `packs` (`(storage.foldername(name))[1]`) ; l'empreinte est le SHA-256 du fichier, en
-- soixante-quatre chiffres hexadécimaux minuscules, et le nom du fichier. Une version ne s'écrase jamais : aucune policy de
-- mise à jour, et le stockage refuse un second dépôt sous un même nom ; un autre logo est un autre fichier, sous une autre
-- empreinte. Une facture gardera ainsi le fichier qu'elle a imprimé (étape A7, qui figera son empreinte). Le nom DIT
-- l'empreinte, la base ne la calcule pas : le fichier est chez le stockage, pas dans une table ; l'application la calcule
-- sur le fichier tel qu'il part (src/lib/logoDesFactures.ts), et un fichier déposé sous un nom qui n'est pas son empreinte
-- ne se voit qu'en le relisant.
--
-- QUI LIT, QUI DÉPOSE, QUI SUPPRIME. Le cabinet du dossier (`admin_du_dossier` : le chef, un membre affecté au dossier, le
-- super-administrateur) et l'accès client qui porte « Ventes » (`client_du_dossier(…, 'ventes')`), réunis par
-- `gere_les_ventes` comme pour les paramètres de facturation : ils LISENT les fichiers du dossier dans ce seau, et y
-- DÉPOSENT un logo, sous `<dossier>/logos/` et à la seule forme d'un logo — rien d'autre, ailleurs, ni sous un autre nom.
-- Un accès qui ne porte que « Banque », un accès sans case, un compte rattaché à rien n'y lisent rien ; l'anonyme non plus
-- (`to authenticated`). PERSONNE ne modifie un fichier. La SUPPRESSION est au chef du cabinet du dossier seul — celui qui
-- seul supprime un dossier (`dossiers_delete`, `est_chef_du_cabinet`) — : la suppression d'un dossier vide ses fichiers de
-- ce seau comme ceux de `pieces` et de `packs` (src/lib/suppressionDossier.ts), avant de retirer sa ligne. La base ne sait
-- pas distinguer ce geste d'une autre suppression ; l'application n'en offre aucune autre — un logo qu'on remplace reste,
-- la version d'avant le désigne (question A5C-Q3 au cabinet : la suppression d'un logo qu'aucune version ne désigne). Un
-- chemin dont le premier segment n'est pas un identifiant de dossier n'ouvre rien et ne fait rien lever : chaque policy
-- juge la forme du chemin AVANT d'en tirer le dossier (`case`), là où un cast qui lèverait casserait la lecture du seau
-- pour tout le monde.
--
-- CE QUE LA FONCTION JUGE DU LOGO, au huitième rang — après le RIB, à la fin : un enregistrement que la base refusait hier
-- est refusé aujourd'hui par le même premier message, et ce qui lit le stockage vient après ce qui ne lit que la saisie.
-- Dans cet ordre, en 22023 : le chemin et l'empreinte, ensemble ou ni l'un ni l'autre ; l'empreinte, à sa forme ; le
-- chemin, à sa forme ; le chemin, dans CE dossier ; le nom du fichier, son empreinte ; puis, pour un logo qui n'est pas
-- celui de la version remplacée, le fichier dans le seau (`storage.objects`) ; son type, celui que dit son nom et que le
-- seau admet ; son poids, sous la borne du seau — le type et la borne tels que le catalogue les dit (`storage.buckets`),
-- pas recopiés. Un logo INCHANGÉ — le chemin et l'empreinte de la version remplacée — n'est pas un changement : son fichier
-- a été jugé quand il a été posé, et une version qui ne touche qu'au délai ne se refuse pas pour un seau changé depuis.
-- Le RETIRER est une version qui ne le porte plus. src/lib/parametresFacturation.ts redit ces refus avant le clic, dans le
-- même ordre et sous les mêmes mots.
--
-- CE QU'ELLE SUPPOSE : la migration `parametres_facturation` (étape A5a) et celles de l'étape P2 (`gere_les_ventes`) ; le
-- stockage de Supabase (`storage.buckets`, `storage.objects`, `storage.foldername`) et ses trois seaux. Son premier bloc le
-- vérifie, et qu'aucun seau `ventes` n'existe déjà. Sous `postgres`, qui n'est pas propriétaire de `storage.objects`, les
-- policies se posent par l'extension supautils (`supautils.policy_grants`), comme les huit d'aujourd'hui ; le seau
-- s'insère, ses colonnes de cycle de vie nulles (`protect_bucket_control_insert` ne juge qu'elles).
--
-- CE QU'ELLE NE FAIT PAS : aucun fichier n'est déposé, aucune donnée lue ni écrite d'avance (la table des paramètres reçoit
-- deux colonnes nulles pour chaque version d'aujourd'hui) ; aucune policy, table ou fonction d'hier n'est modifiée, hors
-- `enregistrer_parametres_facturation` ; `confirmer_rib`, `dernier_changement_de_rib` et la garde des versions ne changent
-- pas — la garde compare déjà toute la ligne, le logo compris, quand un RIB se confirme. Aucun écran (étape A5c2), rien de
-- ce qu'une facture imprime ou fige (étape A7), aucune Edge Function. Le texte ne porte aucune instruction qui retire quoi
-- que ce soit : hors des commentaires, le mot n'y paraît que dans la clause `for delete` de la policy de suppression ; le
-- retour arrière, lui, est donné à part. Règlement (UE) 2016/679, art. 25 § 2 : par défaut rien n'est ouvert, la case « Ventes » est fausse tant
-- que le cabinet ne la coche pas, et le seau est privé.

-- ══ 0. Ce qu'elle suppose ══════════
do $garde$
begin
  if to_regclass('public.parametres_facturation') is null
     or to_regprocedure('public.enregistrer_parametres_facturation(uuid, uuid, jsonb)') is null
     or to_regprocedure('public.gere_les_ventes(uuid)') is null
     or to_regprocedure('public.est_chef_du_cabinet(uuid)') is null then
    raise exception 'La migration parametres_facturation (étape A5a) et celles de l''étape P2 ne sont pas en base : les appliquer d''abord, puis celle-ci.';
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null
     or to_regprocedure('storage.foldername(text)') is null
     or (select count(*) from storage.buckets where id in ('pieces', 'packs', 'cabinet-logos')) <> 3 then
    raise exception 'Le stockage et ses trois seaux ne sont pas tous là : aucun seau n''est ajouté.';
  end if;
  if exists (select 1 from storage.buckets where id = 'ventes') then
    raise exception 'Un seau ventes existe déjà : il n''est ni remplacé ni modifié.';
  end if;
end
$garde$;

-- ══ 1. Le seau ══════════
-- Privé : un fichier ne se lit que par une session que les policies admettent. Le stockage applique lui-même la taille et
-- les types à chaque dépôt (413 au-delà de la taille, 415 hors des types, `type/sous-type` comparé sans ses paramètres) ;
-- les mêmes bornes vivent dans src/lib/bornesStockage.ts, où l'application les juge AVANT l'envoi, et bornesStockage.test.ts
-- les confronte.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ventes', 'ventes', false, 512000, array['image/png', 'image/jpeg']);

-- ══ 2. Qui lit, qui dépose, qui supprime ══════════
-- Trois policies, chacune pour ce seau seul. La forme du chemin d'abord, dans un `case` dont l'ordre est garanti : le
-- dossier ne se tire que d'un chemin qui commence par un identifiant, en minuscules (`uuid::text`) ; un logo ne se dépose
-- que sous `<dossier>/logos/`, nommé par son empreinte, en `.png` ou en `.jpg`.
create policy ventes_lecture on storage.objects
  for select to authenticated
  using (bucket_id = 'ventes'
         and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                  then public.gere_les_ventes(((storage.foldername(name))[1])::uuid)
                  else false end);
create policy ventes_depot_d_un_logo on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ventes'
              and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logos/[0-9a-f]{64}\.(png|jpg)$'
                       then public.gere_les_ventes(((storage.foldername(name))[1])::uuid)
                       else false end);
create policy ventes_suppression_par_le_chef on storage.objects
  for delete to authenticated
  using (bucket_id = 'ventes'
         and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                  then exists (select 1 from public.dossiers d
                                where d.id = ((storage.foldername(name))[1])::uuid
                                  and public.est_chef_du_cabinet(d.cabinet_id))
                  else false end);

-- ══ 3. Le logo d'une version ══════════
-- Le chemin et l'empreinte, ensemble ou aucun ; l'empreinte en minuscules ; le chemin dans le dossier de la version, nommé
-- par son empreinte. Ce que la fonction dit, pour ce que la restauration réinsère sans passer par elle.
alter table public.parametres_facturation
  add column logo_chemin text,
  add column logo_sha256 text,
  add constraint parametres_facturation_logo_entier check ((logo_chemin is null) = (logo_sha256 is null)),
  add constraint parametres_facturation_logo_sha256_forme check (logo_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint parametres_facturation_logo_chemin_forme
    check (logo_chemin in (dossier_id::text || '/logos/' || logo_sha256 || '.png', dossier_id::text || '/logos/' || logo_sha256 || '.jpg'));

-- ══ 4. Enregistrer les paramètres de facturation, le logo compris ══════════
-- Le texte d'A5a, à cinq endroits près : `or replace` ; sept variables ; deux champs de plus dans la liste de ceux d'une
-- version (une clé inconnue reste REFUSÉE, nommée) ; le huitième rang, après le RIB ; les deux colonnes écrites. Les
-- refus, en huit rangs et dans cet ordre — l'accès, la version remplacée, la saisie, les textes, le délai, le moyen, le RIB,
-- le logo —, tous en 22023 sauf l'accès (42501).
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

-- ══ 5. Les droits d'exécution ══════════
-- Ceux d'A5a, redits : la fonction vérifie l'accès elle-même ; un anonyme n'a rien à y faire.
revoke execute on function public.enregistrer_parametres_facturation(uuid, uuid, jsonb) from public, anon;
grant execute on function public.enregistrer_parametres_facturation(uuid, uuid, jsonb) to authenticated;

comment on table public.parametres_facturation is
  'Les paramètres de facturation d''un dossier (espace client, étapes A5a et A5c) : délai de paiement, moyen de paiement proposé, conditions d''escompte, pénalités de retard, mentions complémentaires, pied de page, le RIB imprimé (IBAN, BIC, titulaire) et le logo (son chemin dans le seau ventes et son empreinte). Versionnée : une saisie remplace la courante (remplace_id), rien ne se modifie ni ne se supprime, sauf avec le dossier ; seul le RIB proposé de la courante se confirme. Écrite par enregistrer_parametres_facturation (le cabinet et le client qui porte la case « Ventes ») et confirmer_rib (le cabinet seul).';
comment on column public.parametres_facturation.logo_chemin is
  'Le logo des factures de la version (étape A5c) : son chemin dans le seau ventes, <dossier>/logos/<empreinte>.png ou .jpg. Le fichier n''est jamais remplacé en place ; un autre logo est un autre fichier.';
comment on column public.parametres_facturation.logo_sha256 is
  'L''empreinte SHA-256 du fichier du logo, en minuscules, et le nom de son fichier : celle qu''une facture figera (étape A7).';
comment on function public.enregistrer_parametres_facturation(uuid, uuid, jsonb) is
  'Enregistre une version des paramètres de facturation d''un dossier, ou en remplace la courante, pour le cabinet ou le client qui porte la case « Ventes » : l''accès d''abord, puis sept rangs de refus dans un ordre fixé, le logo au dernier ; un RIB changé par le client reste proposé ; un logo est un fichier du dossier dans le seau ventes. Rend la version écrite.'
