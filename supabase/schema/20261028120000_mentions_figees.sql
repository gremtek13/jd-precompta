-- LA FACTURE FIGE SES MENTIONS (espace client, étape A7a, ligne 51.5 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT,
-- LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », § A.5.3, et « LA FACTURE VALIDÉE, SOURCE DE
-- SA VENTE : LA CONCEPTION », § 13 ; MEG1-Q2, MEG1-Q15, A5-Q9). Préparée sous une version PROVISOIRE, à COLLER : le corps
-- d'`enregistrer_facture` supprime les lignes qu'il remplace, depuis toujours, et `apply_migration` attend alors une
-- confirmation qui ne lui parvient pas (CLAUDE.md, « Quand `apply_migration` attend une confirmation »).
--
-- POURQUOI. Une facture validée figeait son émetteur, ses parties, ses mentions et ses lignes, mais pas tout ce qu'elle
-- imprime : le numéro de TVA se recalculait à chaque impression du statut du jour (`numeroTvaImprime`), et rien de
-- l'identité légale (la dénomination d'un entrepreneur individuel suivie de « EI », C. com., art. R526-27 et R123-237,
-- 9° ; la forme, le capital, la ville du greffe), des conditions de paiement (C. com., art. L441-9, I), du RIB confirmé ni
-- du logo saisis à l'étape A5 n'y entrait. Le premier dossier réel du MVP facture vers la mi-décembre 2026 : ce qu'il
-- imprimera doit être ce que la facture a figé, sa vie durant.
--
-- CE QUI NAÎT ICI :
--   1. Sur `dossiers`, `mentions_identite` : les AUTRES mentions de l'identité légale (R123-237 : la liquidation, la
--      location-gérance, le capital variable, le répertoire des métiers, un agrément ; A5-Q9, « avec l'étape A7 »), un
--      texte que le cabinet seul écrit, comme les quatre colonnes de l'étape A5 (la policy `dossiers_update`).
--   2. Sur `factures_emises`, ce que la VALIDATION fige — nul sur un brouillon (une contrainte), écrit par
--      `enregistrer_facture` seule dans la transaction qui numérote, puis figé par la garde du 07/10/2026
--      (`garder_factures_validees` compare la ligne entière d'une facture validée, hors de `v_modifiables`) :
--        - `mentions_figees`, VRAI pour une facture qui a figé ses mentions : une facture validée avant cette migration
--          garde FAUX et ses colonnes nulles, elle imprime ce qu'elle a toujours imprimé (son numéro de TVA recalculé,
--          dit comme tel) ;
--        - le statut de TVA du jour (`statut_tva`, `article_exoneration`, `numero_tva_attribue`) et le numéro de TVA
--          intracommunautaire qu'il donne (`numero_tva_imprime`), calculé ICI comme `numeroTvaImprime` le calcule, sur le
--          SIRET que la facture a figé (`numero_tva_du_vendeur`) ;
--        - l'identité légale du dossier (`denomination_imprimee`, `forme_juridique`, `capital`, `rcs_ville`,
--          `mentions_identite`) ;
--        - les paramètres de facturation en vigueur, ceux de la version COURANTE (`parametres_id` ; `moyen_prefere`,
--          `escompte`, `penalites`, `mentions_complementaires`, `pied_de_page`, `logo_chemin`, `logo_sha256`) ;
--        - le RIB CONFIRMÉ en vigueur (`iban_imprime`, `bic_imprime`, `titulaire_imprime`, et la version qui le porte,
--          `rib_parametres_id`) : celui de la courante s'il est confirmé, sinon, au-delà des versions où il n'est que
--          PROPOSÉ, celui de la première version qui en a un confirmé — jamais un RIB seulement proposé (MEG1-Q12 ;
--          `ribEnVigueur`, src/lib/parametresFacturation.ts) ;
--        - le mandataire (`mandataire_nom`) : le nom du cabinet quand c'est lui qui valide, nul pour un accès « Ventes »
--          (EC-Q2, MEG1-Q15 ; l'imprimer est l'étape P4).
--      Et, dès le brouillon, `contact_id` : le contact d'où vient le client — une PROVENANCE, sans clé (comme
--      `valide_par`) : une clé `set null` réécrirait une facture figée, et l'effacement d'un contact ne doit rien toucher.
--   3. Sur `facture_lignes`, la provenance de chaque ligne (MEG1-Q2) : `unite` (BT-130, la liste fermée des articles),
--      `reference` (BT-155), `article_id` (sans clé, comme le contact) et `nature`, biens ou services (§ 13) — une colonne,
--      exigée de personne : le refus d'une facture source mixte (EC3-Q8) reste, son ouverture viendra après le MVP.
--   4. Le numéro d'engagement (BT-13 ; C. com., art. L441-9, I : « le numéro du bon de commande lorsqu'il a été
--      préalablement établi par l'acheteur ») s'ouvre à tout acheteur : la contrainte `factures_emises_organisme_public`
--      est REMPLACÉE, le code service restant réservé à l'organisme public.
--
-- QUI COMPOSE LE TEXTE IMPRIMÉ : L'APPLICATION, depuis ces VALEURS figées. La base ne fige aucun texte qu'elle ne peut pas
-- juger : chaque valeur est LUE par la fonction à la validation dans une table qui la juge — `dossiers` (ses contraintes ;
-- le cabinet seul l'écrit), la version des paramètres (sa fonction et ses contraintes ; un RIB n'y est confirmé que par le
-- cabinet), `cabinets` —, jamais reçue de l'appelant ; le numéro de TVA est CALCULÉ ici. Le client « Ventes » qui valide
-- ne fige donc que ce que la base tient.
--
-- UN AVOIR prend de la facture qu'il corrige, quand elle les a figés, son statut de TVA, son numéro de TVA et l'identité
-- qu'elle imprime — comme il en reprend déjà l'émetteur, les parties et l'option pour les débits : il défait une opération
-- telle qu'elle a été facturée. Il fige du jour les paramètres, le RIB, le logo et son mandataire, et reprend le contact
-- de sa facture. L'avoir d'une facture d'avant cette migration fige tout du jour.
--
-- LES REFUS D'`enregistrer_facture` : ceux d'hier, dans le même ordre et sous les mêmes mots ; puis, avant toute écriture,
-- les refus neufs, dits en français et redits avant le clic par src/lib/mentionsFigees.ts : la provenance des lignes
-- (l'unité, la référence, la nature, ligne par ligne, 22023), le contact (P0002), les articles des lignes (P0002) ; et à la
-- validation, avant la numérotation et avant les refus de la source de la vente (le déclencheur de l'étape VF2) : le contact
-- que la facture garde (P0002 : il a pu être posé sur le brouillon par une écriture directe) ; puis, pour un accès
-- « Ventes », une identité sans forme juridique (22023 : le cabinet la règle, elle en est le préalable, MEG1-Q14) ; puis la
-- dénomination d'un entrepreneur individuel (la forme 1000 de l'INSEE) qui ne porte ni « EI » ni les mots « entrepreneur
-- individuel » (22023 ; C. com., art. R526-27, R123-237, 9° ; `porte_la_mention_ei`).
--
-- CE QU'ELLE DÉTRUIT, en s'appliquant : rien — aucune table, aucune colonne, aucune donnée ; une contrainte remplacée (sous
-- son nom, sans perte : elle admet tout ce que l'ancienne admettait). Appelée, `enregistrer_facture` remplace les lignes
-- d'un brouillon, comme hier. NEUTRE aujourd'hui : six factures, toutes validées avant elle, gardent leurs colonnes nulles ;
-- aucune facture n'a de numéro d'engagement ; les écrans n'envoient ni ne lisent rien de neuf avant l'étape A7b
-- (`MENTIONS_FIGEES_EXPORTEES`).
--
-- CE QUI CONTOURNE LA RLS : `enregistrer_facture`, comme hier (security definer), lit pour la validation le dossier, ses
-- paramètres, le cabinet, ses contacts et ses articles, après avoir jugé l'accès (`gere_les_ventes`). Elle ne rend que
-- l'identifiant et le numéro, comme hier.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application, une colonne déjà là, une fonction supposée qui aurait changé — à l'empreinte de son
-- corps, les retours chariot d'un collage écartés, relue en production le 28/10/2026 —, la contrainte remplacée qui ne
-- serait plus celle d'hier, et une base sans les étapes que la migration suppose (A1, A4, A5, et le logo de l'étape A5c).
do $garde$
declare
  v_colonne record;
  v_fonction record;
begin
  if to_regprocedure('public.numero_tva_du_vendeur(text, boolean, text)') is not null
     or to_regprocedure('public.porte_la_mention_ei(text)') is not null then
    raise exception 'La migration mentions_figees est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  for v_colonne in
    select t.tab, t.col from (values
      ('factures_emises', 'mentions_figees'), ('factures_emises', 'statut_tva'), ('factures_emises', 'article_exoneration'),
      ('factures_emises', 'numero_tva_attribue'), ('factures_emises', 'numero_tva_imprime'),
      ('factures_emises', 'denomination_imprimee'), ('factures_emises', 'forme_juridique'), ('factures_emises', 'capital'),
      ('factures_emises', 'rcs_ville'), ('factures_emises', 'mentions_identite'), ('factures_emises', 'moyen_prefere'),
      ('factures_emises', 'escompte'), ('factures_emises', 'penalites'), ('factures_emises', 'mentions_complementaires'),
      ('factures_emises', 'pied_de_page'), ('factures_emises', 'iban_imprime'), ('factures_emises', 'bic_imprime'),
      ('factures_emises', 'titulaire_imprime'), ('factures_emises', 'logo_chemin'), ('factures_emises', 'logo_sha256'),
      ('factures_emises', 'parametres_id'), ('factures_emises', 'rib_parametres_id'), ('factures_emises', 'mandataire_nom'),
      ('factures_emises', 'contact_id'), ('facture_lignes', 'unite'), ('facture_lignes', 'reference'),
      ('facture_lignes', 'article_id'), ('facture_lignes', 'nature'), ('dossiers', 'mentions_identite')
    ) as t(tab, col)
    where exists (select 1 from pg_attribute a
                   where a.attrelid = ('public.' || t.tab)::regclass and a.attname = t.col and not a.attisdropped)
  loop
    raise exception 'La colonne %.% existe déjà : cette migration ne s''applique que sur la base qu''elle suppose.',
      v_colonne.tab, v_colonne.col;
  end loop;
  for v_fonction in
    select t.nom, t.empreinte from (values
      ('enregistrer_facture', '984c48866b3d39d2bba6e33ecbd27515'),
      ('garder_factures_validees', 'e3dfa6dc1b3f127c66bab26d5637ef89'),
      ('garder_lignes_facture_validee', 'c0d4a6404a40c98d92f0a82fb4159661'),
      ('fixer_source_de_la_vente', 'c7a13e4979dfbf28ffd1f2df5e748d44')
    ) as t(nom, empreinte)
    where (select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname = t.nom
              and md5(replace(p.prosrc, chr(13), '')) = t.empreinte) <> 1
       or (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = t.nom) <> 1
  loop
    raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %) : la relire avant de l''appliquer.',
      v_fonction.nom, v_fonction.empreinte;
  end loop;
  if (select md5(pg_get_constraintdef(k.oid)) from pg_constraint k
       where k.conrelid = 'public.factures_emises'::regclass and k.conname = 'factures_emises_organisme_public')
     is distinct from '1c8bac3d7123ed2603a10f9d5f2b4ffc' then
    raise exception 'La contrainte factures_emises_organisme_public n''est plus celle que cette migration remplace : la relire avant de l''appliquer.';
  end if;
  if to_regclass('public.articles') is null or to_regclass('public.contacts') is null
     or to_regclass('public.parametres_facturation') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.parametres_facturation'::regclass
                     and attname = 'logo_sha256' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.dossiers'::regclass
                     and attname = 'denomination_imprimee' and not attisdropped) then
    raise exception 'Les étapes A1, A4 et A5 (les articles, les contacts, les paramètres de facturation, leur logo et l''identité légale) ne sont pas en base : cette migration les suppose.';
  end if;
end
$garde$;

-- ══ 1. Les autres mentions de l'identité légale (A5-Q9) ══════════
alter table public.dossiers add column mentions_identite text
  constraint dossiers_mentions_identite_forme
    check (btrim(mentions_identite, E' \t\n\r') <> '' and char_length(mentions_identite) <= 500);

comment on column public.dossiers.mentions_identite is
  'Les autres mentions de l''identité légale que les factures du dossier impriment (C. com., art. R123-237 : liquidation, location-gérance, capital variable, répertoire des métiers, agrément ; A5-Q9) : un texte de cinq cents caractères au plus, écrit par le cabinet seul (dossiers_update), figé par chaque facture à sa validation (factures_emises.mentions_identite).';

-- ══ 2. Ce que la facture fige ══════════
alter table public.factures_emises
  add column mentions_figees boolean not null default false,
  add column statut_tva text,
  add column article_exoneration text,
  add column numero_tva_attribue boolean,
  add column numero_tva_imprime text,
  add column denomination_imprimee text,
  add column forme_juridique text,
  add column capital numeric,
  add column rcs_ville text,
  add column mentions_identite text,
  add column moyen_prefere text,
  add column escompte text,
  add column penalites text,
  add column mentions_complementaires text,
  add column pied_de_page text,
  add column iban_imprime text,
  add column bic_imprime text,
  add column titulaire_imprime text,
  add column logo_chemin text,
  add column logo_sha256 text,
  add column parametres_id uuid,
  add column rib_parametres_id uuid,
  add column mandataire_nom text,
  add column contact_id uuid;

-- Ce que la ligne dit d'elle-même. Les valeurs sont celles des tables qui les jugent, copiées par la fonction : la
-- table ne les rejuge pas (une liste qui s'allongerait là-bas refuserait ici une validation). Elle tient ce qui fait
-- qu'une facture est d'avant ou d'après : rien de figé sur un brouillon ni sur une facture d'avant ; le statut de TVA,
-- lu, sur toute facture qui a figé ses mentions ; le RIB et le logo entiers ; une valeur des paramètres, la version qui
-- la porte.
alter table public.factures_emises
  add constraint factures_emises_mentions_figees_validee
    check (not mentions_figees or statut = 'validee'),
  add constraint factures_emises_mentions_figees_seules
    check (mentions_figees or num_nonnulls(statut_tva, article_exoneration, numero_tva_attribue, numero_tva_imprime,
      denomination_imprimee, forme_juridique, capital, rcs_ville, mentions_identite, moyen_prefere, escompte, penalites,
      mentions_complementaires, pied_de_page, iban_imprime, bic_imprime, titulaire_imprime, logo_chemin, logo_sha256,
      parametres_id, rib_parametres_id, mandataire_nom) = 0),
  add constraint factures_emises_numero_tva_attribue_fige
    check (not mentions_figees or numero_tva_attribue is not null),
  add constraint factures_emises_numero_tva_imprime_forme
    check (numero_tva_imprime ~ '^FR[0-9]{11}$'),
  add constraint factures_emises_rib_imprime_entier
    check ((iban_imprime is null) = (rib_parametres_id is null)
      and (bic_imprime is null or iban_imprime is not null) and (titulaire_imprime is null or iban_imprime is not null)),
  add constraint factures_emises_logo_imprime_entier
    check ((logo_chemin is null) = (logo_sha256 is null)),
  add constraint factures_emises_parametres_figes
    check (parametres_id is not null or num_nonnulls(moyen_prefere, escompte, penalites, mentions_complementaires,
      pied_de_page, logo_chemin, iban_imprime) = 0);

-- Le numéro d'engagement s'ouvre à tout acheteur ; le code service reste à l'organisme public. La contrainte garde son nom.
alter table public.factures_emises
  drop constraint factures_emises_organisme_public,
  add constraint factures_emises_organisme_public
    check (code_service is null or coalesce(type_client = 'organisme_public', false));
comment on column public.factures_emises.numero_engagement is
  'Le numéro du bon de commande établi par l''acheteur (BT-13 ; C. com., art. L441-9, I), pour tout acheteur depuis l''étape A7 ; pour un organisme public, le numéro d''engagement que Chorus Pro demande à certains destinataires. 50 caractères au plus.';

comment on column public.factures_emises.mentions_figees is
  'Vrai pour une facture qui a figé ses mentions à sa validation (étape A7) ; faux pour un brouillon et pour une facture validée avant : elle imprime ce qu''elle a toujours imprimé, son numéro de TVA recalculé.';
comment on column public.factures_emises.statut_tva is
  'Le statut de TVA du dossier le jour de la validation (dossiers.statut_tva ; un avoir prend celui de sa facture) ; nul : à préciser ce jour-là.';
comment on column public.factures_emises.numero_tva_imprime is
  'Le numéro de TVA intracommunautaire que la facture imprime, calculé à sa validation par numero_tva_du_vendeur sur le SIRET qu''elle a figé, son statut de TVA et numero_tva_attribue ; nul quand il n''y en a pas.';
comment on column public.factures_emises.denomination_imprimee is
  'La dénomination du dossier le jour de la validation (dossiers.denomination_imprimee) : celle d''un entrepreneur individuel porte « EI » ou les mots « entrepreneur individuel » (C. com., art. R526-27).';
comment on column public.factures_emises.mentions_identite is
  'Les autres mentions de l''identité légale du dossier le jour de la validation (dossiers.mentions_identite).';
comment on column public.factures_emises.parametres_id is
  'La version COURANTE des paramètres de facturation le jour de la validation, dont la facture a figé le moyen, l''escompte, les pénalités, les mentions complémentaires, le pied de page et le logo ; une provenance, sans clé.';
comment on column public.factures_emises.iban_imprime is
  'L''IBAN du RIB CONFIRMÉ en vigueur le jour de la validation (avec bic_imprime et titulaire_imprime) — jamais un RIB seulement proposé.';
comment on column public.factures_emises.rib_parametres_id is
  'La version des paramètres de facturation qui porte le RIB figé : la courante, ou la première avant elle dont le RIB est confirmé ; une provenance, sans clé.';
comment on column public.factures_emises.mandataire_nom is
  'Le nom du cabinet quand c''est lui qui a validé la facture, au nom et pour le compte de son client (EC-Q2, MEG1-Q15) ; nul quand un accès « Ventes » l''a validée.';
comment on column public.factures_emises.contact_id is
  'Le contact d''où vient le client de la facture (étape A7) : une provenance, sans clé — la facture garde la COPIE de son client, et l''effacement d''un contact ne la touche pas. Un avoir prend celui de sa facture.';

-- ══ 3. La provenance des lignes ══════════
alter table public.facture_lignes
  add column unite text
    constraint facture_lignes_unite_check
      check (unite in ('C62', 'H87', 'HUR', 'DAY', 'WEE', 'MON', 'ANN', 'KGM', 'MTR', 'MTK', 'LTR', 'KMT', 'LS')),
  add column reference text
    constraint facture_lignes_reference_forme
      check (char_length(reference) between 1 and 100 and btrim(reference, E' \t\n\r') = reference),
  add column article_id uuid,
  add column nature text
    constraint facture_lignes_nature_check check (nature in ('biens', 'services'));

comment on column public.facture_lignes.unite is
  'L''unité de la quantité (BT-130), de la liste fermée des articles ; nulle sur une ligne d''avant l''étape A7, que la facture électronique écrit C62.';
comment on column public.facture_lignes.reference is
  'L''identifiant que le vendeur donne à l''article de la ligne (BT-155), tel que la ligne l''a reçu.';
comment on column public.facture_lignes.article_id is
  'L''article qui a pré-rempli la ligne : une provenance, sans clé — la ligne garde sa copie.';
comment on column public.facture_lignes.nature is
  'Biens ou services : la nature de l''opération de la ligne, figée avec elle ; exigée de personne tant que la facture mixte se refuse (EC3-Q8).';

-- ══ 4. Le numéro de TVA intracommunautaire, calculé comme l'application le calcule ══════════
-- `numeroTvaImprime` (src/lib/factureCii.ts) : aucun pour un statut à préciser ; aucun pour un dossier en franchise ou
-- exonéré sans la case du numéro ; sinon celui du SIREN tiré du SIRET figé — ses blancs retirés (ceux que `\s` désigne en
-- JavaScript : `sirenDe`), neuf ou quatorze chiffres, la clé de Luhn (`sirenValide`) —, FR, la clé (12 + 3 × (SIREN
-- modulo 97)) modulo 97 sur deux chiffres, le SIREN (CGI, art. 286 ter ; `numeroTvaFrancais`).
-- src/lib/mentionsFigees.test.ts confronte l'un à l'autre sur les cas de supabase/essais/mentionsFigees.sql.
create function public.numero_tva_du_vendeur(p_statut_tva text, p_numero_tva_attribue boolean, p_siret text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_blancs constant text := chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200)
    || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
  v_chiffres text;
  v_siren text;
  v_somme integer := 0;
  v_chiffre integer;
begin
  if p_statut_tva is null then
    return null;
  end if;
  if p_statut_tva in ('franchise', 'exonere') and not coalesce(p_numero_tva_attribue, false) then
    return null;
  end if;
  v_chiffres := translate(coalesce(p_siret, ''), v_blancs, '');
  if v_chiffres !~ '^[0-9]{9}([0-9]{5})?$' then
    return null;
  end if;
  v_siren := left(v_chiffres, 9);
  for v_rang in 1 .. 9 loop
    v_chiffre := substr(v_siren, v_rang, 1)::integer;
    if v_rang % 2 = 0 then
      v_chiffre := v_chiffre * 2;
      if v_chiffre > 9 then
        v_chiffre := v_chiffre - 9;
      end if;
    end if;
    v_somme := v_somme + v_chiffre;
  end loop;
  if v_somme % 10 <> 0 then
    return null;
  end if;
  return 'FR' || lpad(((12 + 3 * (v_siren::bigint % 97)) % 97)::text, 2, '0') || v_siren;
end
$$;

revoke execute on function public.numero_tva_du_vendeur(text, boolean, text) from public, anon, authenticated;

comment on function public.numero_tva_du_vendeur(text, boolean, text) is
  'Le numéro de TVA intracommunautaire qu''imprime une facture, comme numeroTvaImprime (src/lib/factureCii.ts) : aucun pour un statut à préciser, ni pour une franchise ou une exonération sans numero_tva_attribue ; sinon FR, la clé, et le SIREN tiré du SIRET, s''il passe sa clé de Luhn. Appelée par enregistrer_facture à la validation.';

-- ══ 5. La dénomination d'un entrepreneur individuel ══════════
-- Elle incorpore son nom, « précédé ou suivi immédiatement des mots « entrepreneur individuel » ou des initiales « EI » »
-- (C. com., art. R526-27, version du 15/05/2022 ; décret n° 2022-725 du 28 avril 2022) : la base ne connaît pas le nom
-- d'état civil, elle exige la mention — les initiales, en capitales, points admis (« EI », « E.I. »), ou les mots, au
-- masculin ou au féminin, la casse indifférente —, détachée des lettres qui l'entourent. `porteLaMentionEI`
-- (src/lib/mentionsFigees.ts) la redit ; src/lib/mentionsFigees.test.ts les confronte sur les cas de l'essai.
create function public.porte_la_mention_ei(p_denomination text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_denomination ~ '(^|[^[:alpha:]])E[.]?I[.]?($|[^[:alpha:]])'
                  or p_denomination ~* '(^|[^[:alpha:]])entrepreneure?[[:space:]]+individuel(le)?($|[^[:alpha:]])', false)
$$;

revoke execute on function public.porte_la_mention_ei(text) from public, anon, authenticated;

comment on function public.porte_la_mention_ei(text) is
  'Vrai quand une dénomination porte la mention d''un entrepreneur individuel (C. com., art. R526-27) : les initiales « EI » (ou « E.I. ») ou les mots « entrepreneur individuel », détachés des lettres voisines ; faux pour une dénomination absente. Appelée par enregistrer_facture à la validation d''une facture d''un dossier de la forme 1000.';

-- ══ 6. Enregistrer une facture : la provenance, puis ce que la validation fige ══════════
-- Reprise de la migration ventes_du_client_facturation au caractère près, hors de ce que les commentaires « A7 »
-- annoncent : les vérifications d'hier passent d'abord (l'avoir, puis le brouillon modifié), les refus neufs ensuite,
-- avant toute écriture, puis les écritures d'hier, chacune avec ses colonnes neuves ; à la validation, ce qu'elle fige.
create or replace function public.enregistrer_facture(p_dossier_id uuid, p_facture_id uuid, p_facture jsonb, p_lignes jsonb, p_valider boolean default false)
 returns table(facture_id uuid, numero text)
 language plpgsql
 security definer
 set search_path to 'public'
as $$
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
            or btrim(v_ligne.valeur->>'reference', E' \t\n\r') <> v_ligne.valeur->>'reference') then
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

  if p_valider then
    -- L'option pour les débits, FIGÉE ce jour-là : celle du dossier s'il est redevable de la TVA — l'option n'existe
    -- que pour lui. Un avoir garde celle de la facture qu'il corrige, quand elle l'a figée.
    select coalesce(d.tva_sur_debits and d.statut_tva = 'redevable', false) into v_option_debits
    from dossiers d where d.id = p_dossier_id;
    if v_type = 'avoir' and v_origine.option_debits is not null then
      v_option_debits := v_origine.option_debits;
    end if;

    -- A7. CE QUE LA VALIDATION FIGE, lu ici, jamais reçu de l'appelant.
    select f.contact_id, f.emetteur_siret into v_contact, v_emetteur_siret from factures_emises f where f.id = v_id;
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
$$;

comment on function public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean) is
  'Crée ou modifie un brouillon, crée un avoir validé, et valide : pour le cabinet du dossier ou un accès « Ventes » (42501). Ses refus d''hier, puis la provenance des lignes et du client (22023, P0002) ; à la validation, le contact gardé, la forme juridique pour un accès « Ventes » et la dénomination d''un entrepreneur individuel, puis la facture fige ses mentions (étape A7) : le statut et le numéro de TVA, l''identité légale, les paramètres et le RIB confirmé en vigueur, le logo, le mandataire.';
