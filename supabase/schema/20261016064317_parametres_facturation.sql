-- LES PARAMÈTRES DE FACTURATION, EN BASE (espace client, étape A5a ; ligne 51.5 ; conception : HISTORIQUE.md, « L'ESPACE
-- CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.5.1, §A.5.2, §A.7 et §A.9).
-- Présentée au cabinet avant d'être appliquée : elle OUVRE au client qui porte la case « Ventes » la lecture d'une table
-- et une fonction (CLAUDE.md, « une policy qui lui ouvre une lecture se présente au cabinet »).
--
-- CE QU'ELLE POSE :
--   - `parametres_facturation` : ce que les factures d'un dossier proposeront ou imprimeront de ses conditions — le
--     délai de paiement, le moyen de paiement proposé, les conditions d'escompte, les pénalités de retard, des mentions
--     complémentaires, un pied de page — et le RIB imprimé (IBAN, BIC, titulaire du compte) ; VERSIONNÉE ;
--   - `enregistrer_parametres_facturation`, qui écrit une version (le cabinet, ou le client « Ventes ») ;
--   - `confirmer_rib`, qui confirme le RIB qu'un client a proposé (le cabinet seul) ;
--   - sur `dossiers`, l'identité légale que la facture imprimera : la dénomination, la ville du greffe, la forme juridique
--     et le capital, écrits par le cabinet seul.
--
-- CE QUE LES TEXTES DEMANDENT. Entre professionnels, la facture mentionne la date de règlement, les conditions d'escompte,
-- le taux des pénalités de retard et le montant de l'indemnité forfaitaire pour frais de recouvrement (C. com., art.
-- L441-9, I) ; sauf stipulation contraire, les pénalités valent le taux de la Banque centrale européenne à son opération de
-- refinancement la plus récente majoré de dix points, jamais moins de trois fois le taux d'intérêt légal (art. L441-10,
-- II) ; l'indemnité est de 40 € (art. D441-5) — un montant que la loi fixe, et donc aucun paramètre ici. Toute personne
-- immatriculée y porte la mention « RCS » suivie du nom de la ville où se trouve son greffe (art. R123-237, 2°) ;
-- l'entrepreneur individuel, une dénomination faite de son nom, précédée ou suivie des mots « entrepreneur individuel » ou
-- des initiales « EI » (art. R526-27) ; une société, sa forme et son capital (art. R123-238, cité par la doctrine, texte
-- NON RELU : A-NV9). Les coordonnées bancaires ne sont pas obligatoires ; données, la norme sémantique de la facture
-- électronique les range au groupe BG-16 (EN 16931 : BT-84 l'identifiant du compte, BT-85 son nom, BT-86 le prestataire).
-- Légifrance refuse l'outil de lecture : les articles sont lus par le résumé de recherche du site (version de L441-10 en
-- vigueur au 01/01/2027 NON VÉRIFIÉE).
--
-- LA FRAUDE AU FAUX RIB — MEG1-Q12, PRISE COMME HYPOTHÈSE (la recommandation de la conception, à confirmer par le
-- cabinet). Un accès « Ventes » peut être une secrétaire, un compte volé, un prestataire : changer l'IBAN imprimé détourne
-- les paiements de tous les clients du client. D'où : un RIB posé ou changé par un client « Ventes » reste PROPOSÉ — les
-- factures gardent le RIB confirmé d'avant, ou aucun —, et seul le cabinet du dossier le confirme (`confirmer_rib`) ; un
-- RIB posé ou changé par le cabinet est confirmé d'emblée, et la version dit qui l'a confirmé et quand ; une version qui ne
-- change pas le RIB (l'IBAN, le BIC et le titulaire) garde son état et sa confirmation — un RIB proposé ne se confirme
-- jamais en passant, seulement par le geste qui le dit. Le RIB que la facture verra est celui de la version courante s'il
-- est confirmé, sinon, en remontant la chaîne au-delà des versions où il n'est que proposé, celui de la première version
-- qui en a un confirmé ou qui n'en a aucun : src/lib/parametresFacturation.ts le dit (`ribEnVigueur`), et l'étape A7, qui
-- le figera sur chaque facture validée, le lira de même. Que tout changement soit dit au cabinet et aux accès « Ventes » et
-- « Banque » du dossier est l'affaire des écrans (étape A5b) : cette table le permet — chaque version dit son auteur et son
-- instant —, et un accès qui ne porte que « Banque » ne la lit pas.
--
-- LES MENTIONS PROPOSÉES — MEG1-Q13, PRISE COMME HYPOTHÈSE : les pénalités au taux de la loi (la BCE majorée de dix points),
-- « Pas d'escompte pour paiement anticipé. », une échéance à trente jours. Ce sont des PROPOSITIONS de l'écran : elles
-- vivent dans le module, pas ici — une version ne porte que ce que le cabinet ou le client a enregistré. La base ne borne
-- que le délai, de 0 à 60 jours (C. com., art. L441-10, I : soixante jours après l'émission de la facture), comme celui
-- d'un contact.
--
-- L'IDENTITÉ LÉGALE — MEG1-Q14, PRISE COMME HYPOTHÈSE : le cabinet la règle, le client ne la change pas. Elle vit sur
-- `dossiers`, dont la seule écriture est la policy `dossiers_update` (`admin_du_dossier`, en lecture comme en vérification) :
-- aucune fonction du schéma n'écrit `dossiers`, aucune Edge Function non plus, et un accès client n'y est jamais admis.
-- Rien n'est imposé tant que la forme juridique du dossier n'est pas connue : les quatre colonnes sont facultatives, et
-- seule leur forme est vérifiée ; la dénomination « <nom> EI » d'un entrepreneur individuel est une proposition de
-- l'écran (R526-27), pas une contrainte.
--
-- LA FORME JURIDIQUE : une liste FERMÉE, la nomenclature des catégories juridiques de l'INSEE au niveau III — les quatre
-- chiffres que le répertoire SIRENE donne à chaque unité légale (`categorieJuridiqueUniteLegale`), 260 positions, mise à
-- jour du 01/09/2022 (insee.fr, « Catégories juridiques », fichier `cj_septembre_2022.xls`, md5
-- e3ccbc85ec19f9d9f155691d0a47b125). La même colonne sert le bilan d'une société (ligne 33 : la question 33-Q6, une case
-- « forme juridique » au dossier) : le premier chiffre dit la famille (1 l'entrepreneur individuel, 5 une société
-- commerciale, 6 une autre personne morale immatriculée au RCS — les sociétés civiles, dont les SCP et les SCM —, 9 un
-- groupement de droit privé…), le code la forme exacte (5485 la société d'exercice libéral à responsabilité limitée, 5710
-- la société par actions simplifiée, 6589 la société civile de moyens…). Le régime d'imposition (l'IR ou l'IS, une option
-- possible pour plusieurs formes) n'est pas une forme : il ne se lit pas ici. La forme IMPRIMÉE (« SARL », « SELARL »…) se
-- tire du code par l'écran. Une révision de la nomenclature par l'INSEE demanderait une migration qui remplace la
-- contrainte. Un entrepreneur individuel (1000) n'a pas de capital social.
--
-- LE RIB. L'IBAN se range dans sa forme électronique, sans espace et en majuscules, celle du type `IBAN2007Identifier` de
-- l'ISO 20022 (`[A-Z]{2}[0-9]{2}`, puis un à trente caractères ; ISO 13616), les lettres en majuscules — la saisie telle
-- qu'elle part les y met, et un même RIB s'écrit ainsi d'une seule façon, ce que la comparaison d'une version à la
-- précédente exige. Sa clé se vérifie dans la fonction : les quatre premiers caractères passent à la fin, chaque lettre
-- devient deux chiffres (A = 10 … Z = 35), et le nombre, divisé par 97, laisse 1 (ISO 13616, par l'ISO/IEC 7064
-- MOD 97-10 ; le registre IBAN de SWIFT, autorité d'enregistrement de l'ISO 13616, y renvoie). Le BIC, à la forme du type
-- `BICFIDec2014Identifier` de l'ISO 20022 (ISO 9362:2014) : quatre lettres ou chiffres, les deux lettres du pays, deux
-- lettres ou chiffres, puis trois facultatifs. Le titulaire du compte, soixante-dix caractères au plus : le nom du
-- bénéficiaire d'un virement SEPA (EPC069-12 v3.0, AT-21). Les longueurs des textes des conditions sont des bornes
-- TECHNIQUES — trois cents caractères pour l'escompte et les pénalités (la conception), mille pour les mentions
-- complémentaires, cinq cents pour le pied de page : aucun texte n'en borne un.
--
-- VERSIONNÉE, sur le patron des décisions de la révision et des adresses de réception : une saisie nouvelle REMPLACE la
-- courante (`remplace_id`, UNE chaîne par dossier, une seule première), aucune ne se supprime, sauf avec son dossier ; une
-- version ne se modifie pas, à une exception près, que la garde est seule à admettre : le RIB PROPOSÉ de la version
-- COURANTE se confirme, une fois. L'histoire du RIB survit à son changement — qui l'a posé, quand, qui l'a confirmé : c'est
-- elle qu'on relit après une fraude. Le logo (étape A5c) n'est pas ici.
--
-- QUI LIT, QUI ÉCRIT. Le cabinet du dossier (`admin_du_dossier`) et un accès client qui porte « Ventes »
-- (`client_du_dossier(…, 'ventes')`, la policy à part `parametres_facturation_lecture_ventes`, comme les tables des ventes)
-- LISENT les versions de ce dossier, toutes leurs colonnes ; personne d'autre. PERSONNE n'écrit directement :
-- `enregistrer_parametres_facturation` vérifie l'accès d'abord — le cabinet ou le client « Ventes », `gere_les_ventes` —,
-- `confirmer_rib` le cabinet seul (`admin_du_dossier`) ; chacune énumère les colonnes qu'elle écrit, prend un verrou du
-- dossier et refuse dans un ordre fixé que src/lib/parametresFacturation.ts redit avant le clic ; le super-administrateur
-- seul insère, pour restaurer une sauvegarde. Aucune policy de mise à jour ni de suppression, pour personne, et une garde
-- refuse même au propriétaire de modifier ou de supprimer une version. Un refus d'accès dit « Accès refusé à ce dossier. »
-- (42501) pour tous : il ne dit pas si le dossier existe.
--
-- CE QU'ELLE SUPPOSE : les migrations de l'étape P2 (`gere_les_ventes`, la case « Ventes ») ; son premier bloc le vérifie.
-- CE QU'ELLE NE FAIT PAS : aucune table, policy ni fonction d'hier n'est modifiée — `dossiers` reçoit quatre colonnes
-- facultatives et leurs contraintes, nulles pour chaque ligne d'aujourd'hui ; aucune donnée n'est lue ni écrite ; aucun
-- écran (étape A5b), ni logo ni seau de stockage (étape A5c), ni ce qu'une facture figera (étape A7), ni numérotation,
-- aucune Edge Function. Le texte ne porte aucune instruction qui retire quoi que ce soit (le mot n'y paraît que dans
-- `on delete cascade` et dans la garde, `before … or delete` et `tg_op = 'DELETE'`, formes qu'`apply_migration` a prises
-- sans confirmation le 14/10/2026) : le retour arrière est donné à part. Règlement (UE) 2016/679, art. 25 § 2 : par défaut
-- rien n'est ouvert, la case « Ventes » est fausse tant que le cabinet ne la coche pas.

-- ══ 0. Les migrations de l'étape P2 d'abord ══════════
do $garde$
begin
  if to_regprocedure('public.gere_les_ventes(uuid)') is null
     or to_regprocedure('public.client_du_dossier(uuid, text)') is null then
    raise exception 'Les migrations de l''étape P2 (ventes_du_client) ne sont pas en base : les appliquer d''abord, puis celle-ci.';
  end if;
end
$garde$;

-- ══ 1. L'identité légale du dossier ══════════
-- Quatre colonnes facultatives, que le cabinet écrit comme les autres colonnes du dossier (la policy `dossiers_update`) :
-- la dénomination imprimée (deux cents caractères au plus, une borne technique), la ville du greffe (cent), la catégorie
-- juridique de l'INSEE au niveau III, et le capital d'une société — un montant en euros, au centime, jamais arrondi en
-- silence (deux décimales au plus, refusées au-delà), strictement positif, sous une borne technique.
alter table public.dossiers
  add column denomination_imprimee text
    constraint dossiers_denomination_imprimee_forme
      check (btrim(denomination_imprimee, E' \t\n\r') <> '' and char_length(denomination_imprimee) <= 200),
  add column rcs_ville text
    constraint dossiers_rcs_ville_forme
      check (btrim(rcs_ville, E' \t\n\r') <> '' and char_length(rcs_ville) <= 100),
  add column forme_juridique text
    constraint dossiers_forme_juridique_insee
      check (forme_juridique in (
        '0000', '1000', '2110', '2120', '2210', '2220', '2310', '2320', '2385', '2400', '2700', '2800', '2900',
        '3110', '3120', '3205', '3210', '3220', '3290', '4110', '4120', '4130', '4140', '4150', '4160', '5191',
        '5192', '5193', '5194', '5195', '5196', '5202', '5203', '5306', '5307', '5308', '5309', '5310', '5370',
        '5385', '5410', '5415', '5422', '5426', '5430', '5431', '5432', '5442', '5443', '5451', '5453', '5454',
        '5455', '5458', '5459', '5460', '5470', '5485', '5499', '5505', '5510', '5515', '5520', '5522', '5525',
        '5530', '5531', '5532', '5542', '5543', '5546', '5547', '5548', '5551', '5552', '5553', '5554', '5555',
        '5558', '5559', '5560', '5570', '5585', '5599', '5605', '5610', '5615', '5620', '5622', '5625', '5630',
        '5631', '5632', '5642', '5643', '5646', '5647', '5648', '5651', '5652', '5653', '5654', '5655', '5658',
        '5659', '5660', '5670', '5685', '5699', '5710', '5770', '5785', '5800', '6100', '6210', '6220', '6316',
        '6317', '6318', '6411', '6511', '6521', '6532', '6533', '6534', '6535', '6536', '6537', '6538', '6539',
        '6540', '6541', '6542', '6543', '6544', '6551', '6554', '6558', '6560', '6561', '6562', '6563', '6564',
        '6565', '6566', '6567', '6568', '6569', '6571', '6572', '6573', '6574', '6575', '6576', '6577', '6578',
        '6585', '6589', '6595', '6596', '6597', '6598', '6599', '6901', '7111', '7112', '7113', '7120', '7150',
        '7160', '7171', '7172', '7179', '7190', '7210', '7220', '7225', '7229', '7230', '7312', '7313', '7314',
        '7321', '7322', '7323', '7331', '7340', '7341', '7342', '7343', '7344', '7345', '7346', '7347', '7348',
        '7349', '7351', '7352', '7353', '7354', '7355', '7356', '7357', '7361', '7362', '7363', '7364', '7365',
        '7366', '7367', '7371', '7372', '7373', '7378', '7379', '7381', '7382', '7383', '7384', '7385', '7389',
        '7410', '7430', '7450', '7470', '7490', '8110', '8120', '8130', '8140', '8150', '8160', '8170', '8190',
        '8210', '8250', '8290', '8310', '8311', '8410', '8420', '8450', '8470', '8490', '8510', '8520', '9110',
        '9150', '9210', '9220', '9221', '9222', '9223', '9224', '9230', '9240', '9260', '9300', '9900', '9970')),
  add column capital numeric
    constraint dossiers_capital_forme
      check (capital > 0 and capital = round(capital, 2) and capital < 10000000000000),
  add constraint dossiers_capital_d_une_societe check (capital is null or forme_juridique is distinct from '1000');

-- ══ 2. La table des paramètres de facturation ══════════
-- Une version porte ce qui a été enregistré, champ par champ, chacun facultatif ; un texte n'est jamais fait que de blancs.
-- Le RIB : sans IBAN, ni BIC, ni titulaire, ni état ; avec lui, un état — proposé, ou confirmé, et alors par qui et quand.
-- L'auteur et le confirmateur sont des repères d'audit sans clé vers les comptes, comme `adresses_reception.auteur` :
-- retirer le compte d'un membre parti n'efface pas qui a posé un RIB.
create table public.parametres_facturation (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  delai_paiement_jours integer
    constraint parametres_facturation_delai check (delai_paiement_jours between 0 and 60),
  moyen_prefere text
    constraint parametres_facturation_moyen
      check (moyen_prefere in ('virement', 'cheque', 'carte', 'prelevement', 'especes', 'effet', 'compensation', 'autre')),
  escompte text
    constraint parametres_facturation_escompte_forme
      check (btrim(escompte, E' \t\n\r') <> '' and char_length(escompte) <= 300),
  penalites text
    constraint parametres_facturation_penalites_forme
      check (btrim(penalites, E' \t\n\r') <> '' and char_length(penalites) <= 300),
  mentions_complementaires text
    constraint parametres_facturation_mentions_forme
      check (btrim(mentions_complementaires, E' \t\n\r') <> '' and char_length(mentions_complementaires) <= 1000),
  pied_de_page text
    constraint parametres_facturation_pied_de_page_forme
      check (btrim(pied_de_page, E' \t\n\r') <> '' and char_length(pied_de_page) <= 500),
  iban text
    constraint parametres_facturation_iban_forme check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$'),
  bic text
    constraint parametres_facturation_bic_forme check (bic ~ '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  titulaire_compte text
    constraint parametres_facturation_titulaire_forme
      check (btrim(titulaire_compte, E' \t\n\r') <> '' and char_length(titulaire_compte) <= 70),
  rib_etat text
    constraint parametres_facturation_rib_etat check (rib_etat in ('propose', 'confirme')),
  rib_confirme_par uuid,
  rib_confirme_le timestamptz,
  remplace_id uuid references public.parametres_facturation (id),
  auteur uuid not null,
  cree_le timestamptz not null default now(),
  constraint parametres_facturation_rib_avec_iban check ((iban is null) = (rib_etat is null)),
  constraint parametres_facturation_bic_avec_iban check (bic is null or iban is not null),
  constraint parametres_facturation_titulaire_avec_iban check (titulaire_compte is null or iban is not null),
  constraint parametres_facturation_confirmation check (coalesce(rib_etat = 'confirme', false) = (rib_confirme_le is not null)),
  constraint parametres_facturation_confirmation_entiere check ((rib_confirme_le is null) = (rib_confirme_par is null)),
  constraint parametres_facturation_une_suite unique (remplace_id)
);
-- Une seule PREMIÈRE version par dossier. Avec l'unicité de `remplace_id` et la garde (une version en remplace une de son
-- dossier), chaque dossier porte une CHAÎNE linéaire, et la courante est celle qu'aucune ne remplace. Partiel, et c'est un
-- invariant : aucun upsert ne le vise (le patron de `adresses_reception_une_premiere`).
create unique index parametres_facturation_une_premiere on public.parametres_facturation (dossier_id) where remplace_id is null;
create index parametres_facturation_dossier on public.parametres_facturation (dossier_id);

-- ══ 3. La garde ══════════
-- Une version ne se supprime pas — sauf avec son dossier entier, que la ligne ne voit déjà plus pendant la cascade (le
-- critère des gardes de la révision) — et ne se modifie pas, sauf pour confirmer le RIB PROPOSÉ de la version COURANTE :
-- l'état passe de proposé à confirmé, avec qui et quand, et RIEN d'autre ne change. Elle en remplace une de SON dossier.
-- Aux droits de l'appelant : la fonction (propriétaire) et la restauration (super-administrateur) voient la version
-- qu'une ligne remplace, ou celle qui la remplace.
create function public.garder_parametres_facturation() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une version des paramètres de facturation ne se supprime pas : une nouvelle version la remplace, et l''historique reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.rib_etat = 'propose' and new.rib_etat = 'confirme'
       and new.rib_confirme_par is not null and new.rib_confirme_le is not null
       and to_jsonb(new) - array['rib_etat', 'rib_confirme_par', 'rib_confirme_le']
           = to_jsonb(old) - array['rib_etat', 'rib_confirme_par', 'rib_confirme_le']
       and not exists (select 1 from public.parametres_facturation s where s.remplace_id = old.id) then
      return new;
    end if;
    raise exception 'Une version des paramètres de facturation ne se modifie pas : une nouvelle version la remplace ; seul le RIB proposé de la version courante se confirme, une fois.'
      using errcode = '23514';
  end if;
  if new.remplace_id is not null
     and not exists (select 1 from public.parametres_facturation p where p.id = new.remplace_id and p.dossier_id = new.dossier_id) then
    raise exception 'Une version des paramètres de facturation en remplace une de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger parametres_facturation_gardes
  before insert or update or delete on public.parametres_facturation
  for each row execute function public.garder_parametres_facturation();

-- ══ 4. Qui lit, qui écrit ══════════
alter table public.parametres_facturation enable row level security;
create policy parametres_facturation_lecture on public.parametres_facturation
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy parametres_facturation_lecture_ventes on public.parametres_facturation
  for select to authenticated using (public.client_du_dossier(dossier_id, 'ventes'));
create policy parametres_facturation_restauration on public.parametres_facturation
  for insert to authenticated with check (public.is_super_admin());

-- ══ 5. Enregistrer les paramètres de facturation ══════════
-- Une première version (`p_remplace_id` nul), ou une nouvelle qui remplace la COURANTE ; la saisie EN ENTIER, chaque champ
-- facultatif — une clé absente vaut nul. Sous un verrou du dossier : deux saisies concurrentes se suivent, et la seconde
-- voit la première (rang 2). Rend la version écrite.
--
-- Les refus, en sept rangs et dans cet ordre — celui de la conception (l'accès, la version remplacée encore courante, les
-- longueurs, le délai, l'IBAN et le BIC), et ce que l'état réel y ajoute à sa place (la saisie, un objet aux champs d'une
-- version ; le moyen de paiement ; le titulaire) ; le module (src/lib/parametresFacturation.ts) les dit avant le clic,
-- dans le même ordre et sous les mêmes mots :
--   1. l'accès au dossier annoncé — le cabinet ou le client « Ventes » —, et qu'il existe, avant de rien lire (42501) ;
--   2. la version remplacée : une version de ce dossier, et la COURANTE — sinon une autre saisie est passée entre-temps,
--      et le refus nomme la courante par son jour et son heure à Paris ;
--   3. la saisie : un objet JSON, aux seuls champs d'une version — une clé inconnue NOMMÉE, la première dans l'ordre des
--      octets, coupée à quatre-vingts caractères comme dans `importer_contacts` ;
--   4. les textes : les conditions d'escompte, les pénalités, les mentions complémentaires, le pied de page — chacun un
--      texte qui n'est pas fait que de blancs, sous sa borne ;
--   5. le délai de paiement ; 6. le moyen de paiement proposé ;
--   7. le RIB : l'IBAN (sa forme, puis sa clé), puis le BIC et le titulaire, qui ne se donnent qu'avec lui (chacun : avec
--      l'IBAN, puis sa forme).
-- Tous en 22023, sauf l'accès.
create function public.enregistrer_parametres_facturation(p_dossier_id uuid, p_remplace_id uuid, p_parametres jsonb)
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
                   'iban', 'bic', 'titulaire_compte')
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
                                             rib_confirme_par, rib_confirme_le, remplace_id, auteur)
  values (p_dossier_id, v_delai, v_moyen, v_escompte, v_penalites, v_mentions, v_pied, v_iban, v_bic, v_titulaire, v_etat,
          v_confirme_par, v_confirme_le, p_remplace_id, auth.uid())
  returning * into v_ecrite;
  return v_ecrite;
end
$$;

-- ══ 6. Confirmer le RIB proposé ══════════
-- Le cabinet du dossier seul (`admin_du_dossier` : le chef du cabinet, un membre affecté au dossier, le
-- super-administrateur) confirme le RIB PROPOSÉ de la version COURANTE : la version le dit, avec qui et quand. Sous le
-- même verrou que l'enregistrement. Refus, dans cet ordre : l'accès (42501) ; la version, dans ce dossier (P0002) ; la
-- courante — sinon une autre saisie est passée entre-temps, nommée ; un RIB à confirmer ; pas déjà confirmé (22023).
create function public.confirmer_rib(p_dossier_id uuid, p_version_id uuid)
returns public.parametres_facturation
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.parametres_facturation;
  v_courante public.parametres_facturation;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.parametres_facturation:' || p_dossier_id::text, 0));
  select * into v_version from public.parametres_facturation p where p.id = p_version_id and p.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Version des paramètres de facturation introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  select * into v_courante from public.parametres_facturation p
   where p.dossier_id = p_dossier_id
     and not exists (select 1 from public.parametres_facturation s where s.remplace_id = p.id);
  if v_courante.id is distinct from v_version.id then
    raise exception 'D''autres paramètres de facturation ont été enregistrés entre-temps (le %) : relire avant de confirmer le RIB.',
      to_char(v_courante.cree_le at time zone 'Europe/Paris', 'DD/MM/YYYY "à" HH24:MI') using errcode = '22023';
  end if;
  if v_version.iban is null then
    raise exception 'Cette version n''a pas de RIB à confirmer.' using errcode = '22023';
  end if;
  if v_version.rib_etat = 'confirme' then
    raise exception 'Le RIB de cette version est déjà confirmé.' using errcode = '22023';
  end if;
  update public.parametres_facturation p
     set rib_etat = 'confirme', rib_confirme_par = auth.uid(), rib_confirme_le = now()
   where p.id = p_version_id
  returning * into v_version;
  return v_version;
end
$$;

-- ══ 7. Les droits d'exécution ══════════
-- Chaque fonction vérifie l'accès elle-même ; un anonyme n'a rien à y faire, et la garde n'est appelée que par son
-- déclencheur.
revoke execute on function public.enregistrer_parametres_facturation(uuid, uuid, jsonb) from public, anon;
grant execute on function public.enregistrer_parametres_facturation(uuid, uuid, jsonb) to authenticated;
revoke execute on function public.confirmer_rib(uuid, uuid) from public, anon;
grant execute on function public.confirmer_rib(uuid, uuid) to authenticated;
revoke execute on function public.garder_parametres_facturation() from public, anon, authenticated;

comment on table public.parametres_facturation is
  'Les paramètres de facturation d''un dossier (espace client, étape A5a) : délai de paiement, moyen de paiement proposé, conditions d''escompte, pénalités de retard, mentions complémentaires, pied de page, et le RIB imprimé (IBAN, BIC, titulaire). Versionnée : une saisie remplace la courante (remplace_id), rien ne se modifie ni ne se supprime, sauf avec le dossier ; seul le RIB proposé de la courante se confirme. Écrite par enregistrer_parametres_facturation (le cabinet et le client qui porte la case « Ventes ») et confirmer_rib (le cabinet seul).';
comment on column public.parametres_facturation.rib_etat is
  'L''état du RIB de la version (MEG1-Q12, hypothèse) : propose quand un client « Ventes » l''a posé ou changé, confirme quand le cabinet l''a posé ou confirmé ; nul sans IBAN. Une facture n''imprime qu''un RIB confirmé.';
comment on column public.parametres_facturation.iban is
  'L''IBAN, sous sa forme électronique (sans espace, en majuscules), sa clé ISO 13616 vérifiée par enregistrer_parametres_facturation.';
comment on column public.parametres_facturation.delai_paiement_jours is
  'Le délai de paiement, de 0 à 60 jours (C. com., art. L441-10, I) : il proposera l''échéance d''une facture, sans la fixer.';
comment on column public.dossiers.denomination_imprimee is
  'La dénomination que la facture imprime (étape A5a ; MEG1-Q14, hypothèse) : pour un entrepreneur individuel, son nom suivi de « EI » (C. com., art. R526-27). Écrite par le cabinet seul.';
comment on column public.dossiers.rcs_ville is
  'La ville du greffe où le dossier est immatriculé au RCS, que la facture imprime après « RCS » (C. com., art. R123-237, 2°). Écrite par le cabinet seul.';
comment on column public.dossiers.forme_juridique is
  'La catégorie juridique de l''INSEE, niveau III (quatre chiffres ; nomenclature du 01/09/2022) : la forme que la facture imprime, et que le bilan d''une société lira. Écrite par le cabinet seul.';
comment on column public.dossiers.capital is
  'Le capital social d''une société, en euros, au centime, que la facture imprime avec sa forme. Écrit par le cabinet seul.';
comment on function public.enregistrer_parametres_facturation(uuid, uuid, jsonb) is
  'Enregistre une version des paramètres de facturation d''un dossier, ou en remplace la courante, pour le cabinet ou le client qui porte la case « Ventes » : l''accès d''abord, puis six rangs de refus dans un ordre fixé ; un RIB changé par le client reste proposé. Rend la version écrite.';
comment on function public.confirmer_rib(uuid, uuid) is
  'Confirme le RIB proposé de la version courante des paramètres de facturation d''un dossier, pour le cabinet seul : l''accès d''abord, puis quatre refus dans un ordre fixé. Rend la version confirmée.';
