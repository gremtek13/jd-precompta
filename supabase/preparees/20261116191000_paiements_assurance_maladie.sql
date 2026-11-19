-- LES PAIEMENTS DE L'ASSURANCE MALADIE, TIRÉS D'UN RETOUR NOEMIE OU DE L'EXPORT DU LOGICIEL DU PRATICIEN (conception 53,
-- lot NOE3 ; la demande et la décision du cabinet du 16/11/2026 : « on récupère que les chiffres et on stocke pas de
-- données patients ») — PRÉPARÉE le 16/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 16/11/2026 — NOE1 ET NOE3 : LA
-- LECTURE DES PAIEMENTS DE L'ASSURANCE MALADIE ET LEUR TABLE (PRÉPARÉE, PAS APPLIQUÉE) » ; la conception :
-- docs/conceptions/53-import-noemie-et-remboursements.md ; l'essai : supabase/essais/paiementsAssuranceMaladie.sql ; le
-- retour : supabase/preparees/retour/20261116191100_retour_paiements_assurance_maladie.sql ; le module qui redit ses refus
-- avant le clic : src/lib/paiementsAssuranceMaladie.ts. Le patron : la prévision publiée (C8-Q2,
-- supabase/preparees/20261115100000_previsions_publiees.sql).
--
-- AMENDÉE le 19/11/2026, AVANT tout collage (BOR3, conception 59, § 14 ; HISTORIQUE.md, « 19/11/2026 — BOR3 ») : la colonne
-- `organisme_complementaire` (BOR-Q5 (B) : les complémentaires suivies une à une, sous leur numéro, pour le payé comme pour
-- le facturé ; BORQ5-Q1 (A) : nulle, « non dite », tant que le fichier lu ne la nomme pas), dans la forme d'un paiement et
-- dans sa clé TOTALE ; et relue contre l'état des paiements de Télévitale (« Paiement Noemie par journée comptable », la
-- recherche du 19/11/2026) : il porte des lignes SANS facture — les aides, les régularisations — et des montants NÉGATIFS —
-- les indus, les trop-perçus. La table les admettait déjà, sans élargir à un texte : une somme positive qui ne paie aucune
-- facture (une aide, un forfait) est un `forfait` ; une somme négative (un indu, une régularisation qui retire) est une
-- RÉGULARISATION de sa part (`regularisations_centimes`, négatif), seule (montant = régularisations, aucune facture) ou
-- déduite des factures qu'elle accompagne ; un net négatif s'admet, le brut (net moins régularisations) jamais. L'essai le
-- prouve ligne à ligne. Version 1 redéfinie (huit clés par paiement) : rien n'a jamais été importé.
--
-- LA RÈGLE. Le fichier se lit dans le navigateur de celui qui importe — le praticien depuis son espace client, ou le cabinet
-- (NOE-Q1, « Le praticien et le cabinet ») — et n'en sortent que des AGRÉGATS : un paiement par journée comptable, organisme
-- (le code du régime et celui de la caisse, deux entiers ; pour la part complémentaire, l'organisme complémentaire, un
-- entier, ou rien) et part (obligatoire, complémentaire, forfait), son montant net, ce que les régularisations en ont retiré,
-- et le nombre de factures qu'il paie ; par import, la période lue et, si le fichier les dit, le nombre des rejets (une part
-- rejetée d'une facture en est un) et leur montant total (NOE-Q4).
-- Rien d'autre : ni nom, ni NIR, ni date de
-- naissance, ni acte, ni date de soins, ni numéro de facture ou de lot (des pseudonymes d'un patient par le logiciel du
-- praticien, RGPD, considérant 26), ni la référence du virement (NOE-Q3 : la journée comptable seule), ni l'empreinte du
-- fichier. LA PREUVE EST TENUE PAR LA BASE : AUCUNE COLONNE DE TEXTE LIBRE — des dates, des entiers, une liste fermée — et
-- la fonction d'import refuse toute clé hors de la liste fermée.
--
-- LE PAIEMENT NE COMPTE NULLE PART : ni 2035, ni CA3, ni estimation, ni alerte du chiffre d'affaires, ni FEC. La recette est
-- le crédit du relevé, classé ; le paiement le justifie et le contrôle (NOE5, NOE6, plus tard), sinon la même recette
-- entrerait deux fois (la leçon de la « vente entrée deux fois », ligne 28.6).
--
-- CE QU'ELLE POSE.
--   1. `imports_assurance_maladie` : un import — son dossier, la période lue (la plus ancienne et la plus récente journée
--      comptable du fichier), les rejets (nuls quand le fichier ne les dit pas, jamais 0 sur un non-dit), qui et quand
--      (posés par la base). `paiements_assurance_maladie` : les paiements que l'import a APPORTÉS, chacun sous une clé
--      TOTALE (dossier, journée comptable, régime, caisse, part, organisme complémentaire ; deux organismes non dits se
--      heurtent : `nulls not distinct`) — réimporter une période qui recouvre ne double rien ; la garde tient chaque
--      paiement dans le dossier de son import. Aucune mise à jour, pour personne : un import se retire et se refait.
--   2. `refus_de_l_import_assurance_maladie(import, jour)` : le refus, en mots, d'un import, ou nul ; ne lit rien en base ;
--      aucun rôle de l'API ne l'exécute.
--   3. `importer_paiements_assurance_maladie(dossier, import)`, aux droits du propriétaire, TOUT OU RIEN, pour le cabinet du
--      dossier (`admin_du_dossier`) ou un accès « Banque » de ce dossier (`client_du_dossier(…, 'banque')`) ; il rend
--      l'import écrit.
--   4. `retirer_import_assurance_maladie(import)`, aux mêmes droits : l'import et ses paiements partent ensemble ; il rend
--      l'import retiré. Plus tard, une association à un crédit du relevé (NOE5) le retiendra par sa propre clé étrangère.
--   5. Les policies, toutes à `authenticated` : le cabinet du dossier lit tout ; un accès « Banque » lit les imports et les
--      paiements de son dossier ; le super-administrateur insère (la restauration). Aucune policy de mise à jour ni de
--      suppression. CETTE LECTURE ET CES DEUX GESTES DU CLIENT SE PRÉSENTENT AU CABINET AVANT D'ÊTRE APPLIQUÉS (CLAUDE.md,
--      « Trois domaines font exception » : la vue de la banque) — la fiche « NOE-migration » des arbitrages.
--   6. La restrictive `deux_facteurs` de la double authentification, si sa migration est déjà en base (sinon, sa boucle la
--      posera) : les deux se collent dans les deux ordres.
--   7. `garder_paiements_assurance_maladie`, avant la RLS, AUX DROITS DE L'APPELANT (security invoker, comme celle de la
--      prévision publiée) : une ligne ne s'écrit que par l'import (le réglage `jd.paiements_assurance_maladie` porte
--      l'identifiant de l'import en cours) ou par la restauration (le super-administrateur) ; ne se modifie jamais ; ne part
--      que par le retrait de son import, avec son import, ou avec son dossier — aussi pour le rôle des Edge Functions, qui
--      passe la RLS ; un paiement est du dossier de son import. Elle ne lit la base que sous la RLS de l'appelant : elle n'appelle donc pas la porte
--      `_acces_avant_les_gardes`, dont la règle vise une garde security definer (porteDevantLesGardes.test.ts). Les
--      contraintes de table tiennent la forme de toute ligne, celle de la restauration comprise.
--
-- POURQUOI « BANQUE ». Les fiches de NOE-Q1 l'offraient au praticien, et le cabinet a répondu « Le praticien et le
-- cabinet » : le praticien, sous la case qui ouvre déjà ses crédits du relevé, et le cabinet du dossier. Un paiement n'apprend
-- au client rien de plus que le relevé qu'il lit déjà sous cette case (la date et le montant d'un virement de l'assurance
-- maladie), sinon la part et deux comptes.
--
-- LES REFUS, DANS L'ORDRE (que src/lib/paiementsAssuranceMaladie.ts redit avant le clic, sous les mêmes mots) :
--   - l'appelant qui n'est ni le cabinet du dossier ni un accès « Banque » de ce dossier (42501 ; au retrait, l'import
--     inconnu aussi, sous les mêmes mots : rien n'apprend qu'il existe) ;
--   - puis, sous le verrou des paiements du dossier, à l'import : sa forme ; le nombre de ses paiements ; chaque paiement
--     (mal formé, à venir, qui ne se tient pas) ; deux paiements de même clé ; les rejets (22023) ; un paiement dans un
--     exercice validé (22023) ; un paiement déjà en base sous la même clé avec d'autres chiffres (22023, la journée nommée) ;
--     rien de neuf (22023) ;
--   - au retrait : un paiement de l'import dans un exercice validé (22023).
--
-- CE QU'ELLE NE CHANGE PAS : aucune fonction d'hier n'est remplacée (`client_du_dossier`, `admin_du_dossier` et
-- `is_super_admin` sont appelées, jamais réécrites) ; ni `memberships`, ni ses cases, ni aucun moteur. Elle se colle donc
-- avant ou après `trois_cases_de_l_acces` (B1, qui réécrit `client_du_dossier` : la garde de tête n'exige de lui que de lire
-- « banque » sur `droit_banque`, ce que ses deux corps font) et `deux_facteurs_exiges`. Aucune ligne écrite d'avance. Le
-- retrait d'un import est une suppression DANS LE CORPS d'une fonction : l'outil d'application peut la retenir — le cabinet
-- la colle alors dans l'éditeur SQL, avec sa ligne d'historique (CLAUDE.md).
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `PAIEMENTS_ASSURANCE_MALADIE_PREVUS`
-- (src/lib/paiementsAssuranceMaladie.ts) se lève alors, et les deux tables entrent au plan de sauvegarde. Ni barre oblique
-- inverse, ni retour chariot.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une fonction appelée qui ne serait plus celle que cette migration suppose — à
-- l'empreinte de son corps, les retours chariot d'un collage écartés ; un `client_du_dossier` qui ne lirait plus « banque »
-- sur `droit_banque` ; et une base où manquerait une colonne qu'elle lit.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.imports_assurance_maladie') is not null or to_regclass('public.paiements_assurance_maladie') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('importer_paiements_assurance_maladie', 'retirer_import_assurance_maladie',
                                   'refus_de_l_import_assurance_maladie')) then
    raise exception 'La migration paiements_assurance_maladie est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.signature, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'client_du_dossier';
  if v_nombre <> 1
     or strpos(replace(coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.client_du_dossier(uuid,text)')), ''), chr(13), ''),
               'when ''banque'' then m.droit_banque') = 0 then
    raise exception 'La fonction public.client_du_dossier(uuid,text) ne lit plus « banque » sur droit_banque : la relire avant d''appliquer cette migration.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped
     and ((a.attrelid = 'public.memberships'::regclass and a.attname in ('user_id', 'dossier_id', 'droit_banque'))
       or (a.attrelid = 'public.exercices_valides'::regclass and a.attname in ('dossier_id', 'annee'))
       or (a.attrelid = 'public.dossiers'::regclass and a.attname = 'id'));
  if v_nombre <> 6 then
    raise exception 'Une colonne que cette migration lit manque (% sur 6) : appliquer d''abord droits_des_acces_clients et validation_des_exercices.', v_nombre;
  end if;
end
$garde$;

-- ══ 1. Les tables ══════════
-- L'auteur sans clé étrangère vers son compte : retirer le compte d'un membre parti ne doit pas effacer qui a importé (le
-- patron de `previsions_publiees.auteur`).
create table public.imports_assurance_maladie (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  periode_du date not null,
  periode_au date not null,
  nombre_de_rejets integer,
  montant_rejete_centimes bigint,
  importe_par uuid not null,
  importe_le timestamptz not null default now(),
  constraint imports_assurance_maladie_periode check (periode_du >= date '2000-01-01' and periode_du <= periode_au),
  constraint imports_assurance_maladie_rejets check (
    (nombre_de_rejets is null and montant_rejete_centimes is null)
    or (nombre_de_rejets between 0 and 100000 and montant_rejete_centimes between 0 and 99999999999999
        and (nombre_de_rejets > 0 or montant_rejete_centimes = 0)))
);

create index imports_assurance_maladie_dossier on public.imports_assurance_maladie (dossier_id, importe_le);

create table public.paiements_assurance_maladie (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  import_id uuid not null references public.imports_assurance_maladie (id) on delete cascade,
  date_journee_comptable date not null,
  regime smallint,
  caisse smallint,
  organisme_complementaire bigint,
  part text not null,
  montant_centimes bigint not null,
  regularisations_centimes bigint not null,
  nombre_de_factures integer not null,
  constraint paiements_assurance_maladie_part check (part in ('obligatoire', 'complementaire', 'forfait')),
  -- L'organisme complémentaire ne se dit que de la part complémentaire, en chiffres ; nul, il n'est pas dit (BORQ5-Q1 (A)).
  constraint paiements_assurance_maladie_organisme check (
    (regime is null or regime between 0 and 99) and (caisse is null or caisse between 0 and 999)
    and (organisme_complementaire is null or (part = 'complementaire' and organisme_complementaire between 1 and 9999999999))),
  constraint paiements_assurance_maladie_date check (date_journee_comptable >= date '2000-01-01'),
  -- Le brut (le net moins les régularisations, qui sont négatives ou nulles) est positif ou nul ; un paiement porte quelque
  -- chose. Un indu, un trop-perçu, une régularisation qui retire : une régularisation, seule (net = régularisations, brut
  -- nul) ou déduite des factures payées le même jour ; le net peut être négatif.
  constraint paiements_assurance_maladie_montants check (
    regularisations_centimes <= 0 and regularisations_centimes > -100000000000000
    and montant_centimes - regularisations_centimes between 0 and 99999999999999
    and (montant_centimes <> 0 or regularisations_centimes <> 0)),
  -- Un forfait ne paie aucune facture — une aide, toute somme positive versée sans facture, est un forfait ; une autre part
  -- paie au moins une facture dès que son brut n'est pas nul, et aucune quand il l'est (une régularisation seule).
  constraint paiements_assurance_maladie_factures check (
    nombre_de_factures between 0 and 100000
    and (part <> 'forfait' or nombre_de_factures = 0)
    and (part = 'forfait' or (nombre_de_factures = 0) = (montant_centimes = regularisations_centimes))),
  constraint paiements_assurance_maladie_une_cle unique nulls not distinct
    (dossier_id, date_journee_comptable, regime, caisse, part, organisme_complementaire)
);

create index paiements_assurance_maladie_import on public.paiements_assurance_maladie (import_id);

comment on table public.imports_assurance_maladie is
  'Les imports des paiements de l''assurance maladie d''un dossier (conception 53, NOE3) : la période lue, les rejets que le fichier dit (nuls sinon), qui et quand. Écrits par importer_paiements_assurance_maladie, retirés par retirer_import_assurance_maladie ; aucune colonne de texte, aucune donnée de patient.';
comment on table public.paiements_assurance_maladie is
  'Les paiements de l''assurance maladie qu''un import a apportés : un agrégat par journée comptable, organisme (régime, caisse) et part, en centimes. Aucune colonne de texte, aucune donnée de patient ; ne compte dans aucun moteur (ni 2035, ni CA3, ni FEC) : il justifie et contrôle le crédit du relevé.';
comment on column public.imports_assurance_maladie.periode_du is
  'La plus ancienne journée comptable que le fichier portait (paiements déjà importés compris).';
comment on column public.imports_assurance_maladie.nombre_de_rejets is
  'Le nombre de rejets que le fichier dit, par import (NOE-Q4) : une part rejetée d''une facture (obligatoire ou complémentaire) compte un rejet ; nul quand le fichier ne dit pas les rejets.';
comment on column public.imports_assurance_maladie.importe_par is
  'Le compte qui a importé (auth.uid()), sans clé étrangère : il survit au retrait du compte.';
comment on column public.paiements_assurance_maladie.organisme_complementaire is
  'L''organisme complémentaire de la part complémentaire, en chiffres ; nul : non dit (BORQ5-Q1 (A)), et toujours pour les autres parts.';
comment on column public.paiements_assurance_maladie.montant_centimes is
  'Le net payé sous cette clé, régularisations déduites, en centimes ; négatif quand un indu ou une régularisation l''emporte.';
comment on column public.paiements_assurance_maladie.regularisations_centimes is
  'Ce que les régularisations ont retiré du paiement (négatif ou nul), en centimes.';
comment on column public.paiements_assurance_maladie.nombre_de_factures is
  'Le nombre de factures que ce paiement règle (zéro pour un forfait ou une régularisation seule) : un ordre de grandeur, jamais un détail.';

alter table public.imports_assurance_maladie enable row level security;
alter table public.paiements_assurance_maladie enable row level security;

create policy imports_assurance_maladie_lecture on public.imports_assurance_maladie
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy imports_assurance_maladie_lecture_banque on public.imports_assurance_maladie
  for select to authenticated using (client_du_dossier(dossier_id, 'banque'));
create policy imports_assurance_maladie_restauration on public.imports_assurance_maladie
  for insert to authenticated with check (is_super_admin());
create policy paiements_assurance_maladie_lecture on public.paiements_assurance_maladie
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy paiements_assurance_maladie_lecture_banque on public.paiements_assurance_maladie
  for select to authenticated using (client_du_dossier(dossier_id, 'banque'));
create policy paiements_assurance_maladie_restauration on public.paiements_assurance_maladie
  for insert to authenticated with check (is_super_admin());

-- ══ 1 bis. La garde ══════════
-- Avant la RLS, aux droits de l'appelant. Le retrait d'un paiement n'est admis que par le retrait de son import (le réglage),
-- après son import (la cascade : l'import n'est déjà plus là) ou après son dossier (la cascade : le dossier n'est déjà plus
-- là). Un paiement s'écrit dans le dossier de son import : l'import se lit sous la RLS de l'appelant, que seuls la fonction
-- d'import (le propriétaire) et le super-administrateur (qui lit tout) atteignent ici. Chaque branche lit NEW ou OLD selon
-- l'opération, jamais l'autre.
create function public.garder_paiements_assurance_maladie() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_import uuid;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Un import des paiements de l''assurance maladie ne se modifie pas : il se retire et se refait.'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    if tg_table_name = 'imports_assurance_maladie' then
      v_import := old.id;
    else
      v_import := old.import_id;
    end if;
    if coalesce(current_setting('jd.paiements_assurance_maladie', true), '') = v_import::text
       or not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or (tg_table_name = 'paiements_assurance_maladie'
           and not exists (select 1 from public.imports_assurance_maladie i where i.id = v_import)) then
      return old;
    end if;
    raise exception 'Un paiement de l''assurance maladie ne part qu''avec son import, par son retrait, ou avec son dossier.'
      using errcode = '23514';
  end if;
  if tg_table_name = 'imports_assurance_maladie' then
    v_import := new.id;
  else
    v_import := new.import_id;
  end if;
  if coalesce(current_setting('jd.paiements_assurance_maladie', true), '') <> v_import::text and not public.is_super_admin() then
    raise exception 'Les paiements de l''assurance maladie ne s''écrivent que par leur import.' using errcode = '42501';
  end if;
  if tg_table_name = 'paiements_assurance_maladie' then
    if not exists (select 1 from public.imports_assurance_maladie i where i.id = v_import and i.dossier_id = new.dossier_id) then
      raise exception 'Un paiement de l''assurance maladie s''écrit dans le dossier de son import.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

comment on function public.garder_paiements_assurance_maladie() is
  'La garde des deux tables des paiements de l''assurance maladie (NOE3) : une ligne ne s''écrit que par importer_paiements_assurance_maladie (jd.paiements_assurance_maladie) ou par la restauration du super-administrateur (42501), dans le dossier de son import (23514), jamais ne se modifie (23514), ne part que par le retrait de son import, avec son import ou avec son dossier (23514).';

create trigger imports_assurance_maladie_garde
  before insert or update or delete on public.imports_assurance_maladie
  for each row execute function public.garder_paiements_assurance_maladie();
create trigger paiements_assurance_maladie_garde
  before insert or update or delete on public.paiements_assurance_maladie
  for each row execute function public.garder_paiements_assurance_maladie();

-- ══ 2. L'import : sa forme ══════════
-- Le refus, en mots, d'un import, ou nul s'il est bien formé pour ce jour. Chaque test lit ce qu'un test d'avant a établi :
-- un IF par étape, jamais un OR qui supposerait un ordre d'évaluation pour une conversion. Un entier se juge sur sa valeur
-- numérique (une fraction, un exposant qui en ferait une, se refusent) et ses bornes AVANT toute conversion.
create function public.refus_de_l_import_assurance_maladie(p_import jsonb, p_jour date) returns text
  language plpgsql
  immutable
  set search_path = public
as $$
declare
  c_forme constant text := 'L''import n''est pas dans la forme que la base connaît (version 1).';
  c_nombre constant text := 'Un import porte de 1 à 5 000 paiements.';
  c_paiement constant text := 'Un paiement de l''import est mal formé : une journée comptable, un organisme en chiffres ou rien (l''organisme complémentaire, pour la seule part complémentaire), une part de la liste, des montants en centimes entiers et un nombre de factures.';
  c_a_venir constant text := 'Un paiement de l''import porte une journée comptable à venir.';
  c_coherence constant text := 'Un paiement de l''import ne se tient pas : ses factures, son montant et ses régularisations ne s''accordent pas.';
  c_doublon constant text := 'L''import porte deux fois le même paiement : une même journée comptable, un même organisme et une même part.';
  c_rejets constant text := 'Les rejets de l''import sont mal formés : un nombre de factures et un montant en centimes entiers, positifs, ou rien.';
  c_plafond constant numeric := 100000000000000;
  v_paiements jsonb;
  v_paiement jsonb;
  v_rejets jsonb;
  v_texte text;
  v_date date;
  v_regime numeric;
  v_caisse numeric;
  v_organisme numeric;
  v_montant numeric;
  v_regularisations numeric;
  v_factures numeric;
  v_nombre numeric;
  i integer;
begin
  if p_jour is null then
    return c_a_venir;
  end if;
  -- 1. La forme : un objet, ses trois clés, la version 1, une liste de paiements, des rejets nuls ou un objet.
  if jsonb_typeof(p_import) is distinct from 'object' then
    return c_forme;
  end if;
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(p_import) k)
       is distinct from array['paiements', 'rejets', 'version'] then
    return c_forme;
  end if;
  if (p_import -> 'version') is distinct from '1'::jsonb or jsonb_typeof(p_import -> 'paiements') is distinct from 'array'
     or jsonb_typeof(p_import -> 'rejets') not in ('null', 'object') then
    return c_forme;
  end if;

  -- 2. Le nombre des paiements.
  v_paiements := p_import -> 'paiements';
  if jsonb_array_length(v_paiements) < 1 or jsonb_array_length(v_paiements) > 5000 then
    return c_nombre;
  end if;

  -- 3. Chaque paiement : sa forme, sa journée, sa cohérence.
  for i in 0 .. jsonb_array_length(v_paiements) - 1 loop
    v_paiement := v_paiements -> i;
    if jsonb_typeof(v_paiement) is distinct from 'object' then
      return c_paiement;
    end if;
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_paiement) k)
         is distinct from array['caisse', 'date_journee_comptable', 'montant_centimes', 'nombre_de_factures',
                                'organisme_complementaire', 'part', 'regime', 'regularisations_centimes'] then
      return c_paiement;
    end if;
    if jsonb_typeof(v_paiement -> 'date_journee_comptable') is distinct from 'string'
       or jsonb_typeof(v_paiement -> 'regime') not in ('null', 'number')
       or jsonb_typeof(v_paiement -> 'caisse') not in ('null', 'number')
       or jsonb_typeof(v_paiement -> 'organisme_complementaire') not in ('null', 'number')
       or jsonb_typeof(v_paiement -> 'part') is distinct from 'string'
       or jsonb_typeof(v_paiement -> 'montant_centimes') is distinct from 'number'
       or jsonb_typeof(v_paiement -> 'regularisations_centimes') is distinct from 'number'
       or jsonb_typeof(v_paiement -> 'nombre_de_factures') is distinct from 'number' then
      return c_paiement;
    end if;
    v_texte := v_paiement ->> 'date_journee_comptable';
    if v_texte !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      return c_paiement;
    end if;
    begin
      v_date := v_texte::date;
    exception when others then
      return c_paiement;
    end;
    if v_date < date '2000-01-01' then
      return c_paiement;
    end if;
    if (v_paiement ->> 'part') not in ('obligatoire', 'complementaire', 'forfait') then
      return c_paiement;
    end if;
    v_regime := (v_paiement ->> 'regime')::numeric;
    v_caisse := (v_paiement ->> 'caisse')::numeric;
    v_organisme := (v_paiement ->> 'organisme_complementaire')::numeric;
    v_montant := (v_paiement ->> 'montant_centimes')::numeric;
    v_regularisations := (v_paiement ->> 'regularisations_centimes')::numeric;
    v_factures := (v_paiement ->> 'nombre_de_factures')::numeric;
    if (v_regime is not null and (v_regime <> trunc(v_regime) or v_regime < 0 or v_regime > 99))
       or (v_caisse is not null and (v_caisse <> trunc(v_caisse) or v_caisse < 0 or v_caisse > 999))
       or (v_organisme is not null and ((v_paiement ->> 'part') <> 'complementaire' or v_organisme <> trunc(v_organisme)
                                        or v_organisme < 1 or v_organisme > 9999999999))
       or v_montant <> trunc(v_montant) or abs(v_montant) >= c_plafond
       or v_regularisations <> trunc(v_regularisations) or v_regularisations > 0 or v_regularisations <= -c_plafond
       or v_factures <> trunc(v_factures) or v_factures < 0 or v_factures > 100000 then
      return c_paiement;
    end if;
    if v_date > p_jour then
      return c_a_venir;
    end if;
    if v_montant - v_regularisations < 0 or v_montant - v_regularisations >= c_plafond
       or (v_montant = 0 and v_regularisations = 0)
       or ((v_paiement ->> 'part') = 'forfait' and v_factures <> 0)
       or ((v_paiement ->> 'part') <> 'forfait' and (v_factures = 0) <> (v_montant = v_regularisations)) then
      return c_coherence;
    end if;
  end loop;

  -- 4. Deux paiements de même clé (la journée, l'organisme, la part ; deux organismes non dits se heurtent).
  if exists (
      select 1 from jsonb_array_elements(v_paiements) e
       group by e ->> 'date_journee_comptable', (e ->> 'regime')::numeric, (e ->> 'caisse')::numeric, e ->> 'part',
                (e ->> 'organisme_complementaire')::numeric
      having count(*) > 1) then
    return c_doublon;
  end if;

  -- 5. Les rejets : rien, ou un nombre de factures et un montant, entiers, positifs ; aucun rejet, aucun montant.
  v_rejets := p_import -> 'rejets';
  if jsonb_typeof(v_rejets) = 'object' then
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_rejets) k)
         is distinct from array['montant_centimes', 'nombre'] then
      return c_rejets;
    end if;
    if jsonb_typeof(v_rejets -> 'nombre') is distinct from 'number'
       or jsonb_typeof(v_rejets -> 'montant_centimes') is distinct from 'number' then
      return c_rejets;
    end if;
    v_nombre := (v_rejets ->> 'nombre')::numeric;
    v_montant := (v_rejets ->> 'montant_centimes')::numeric;
    if v_nombre <> trunc(v_nombre) or v_nombre < 0 or v_nombre > 100000
       or v_montant <> trunc(v_montant) or v_montant < 0 or v_montant >= c_plafond
       or (v_nombre = 0 and v_montant <> 0) then
      return c_rejets;
    end if;
  end if;
  return null;
end
$$;

comment on function public.refus_de_l_import_assurance_maladie(jsonb, date) is
  'Le refus, en mots, d''un import des paiements de l''assurance maladie (NOE3) pour le jour donné, ou nul s''il est bien formé : sa forme (version 1, trois clés), le nombre de ses paiements, chaque paiement (huit clés, une journée qui n''est pas à venir, un organisme en chiffres ou nul — l''organisme complémentaire pour la seule part complémentaire —, une part de la liste, des centimes entiers qui se tiennent), deux paiements de même clé, les rejets. N''écrit rien ; aucun rôle de l''API ne l''exécute.';

-- ══ 3. Importer ══════════
-- D'UN SEUL TENANT, sous un verrou des paiements du dossier (deux imports ne se croisent pas). Le jour est celui de Paris,
-- lu par la base. Un paiement déjà en base sous la même clé, AUX MÊMES CHIFFRES, ne se double pas : il est passé ; aux
-- chiffres différents, l'import se refuse (deux fichiers qui divergent ne se tranchent pas en silence).
create function public.importer_paiements_assurance_maladie(p_dossier_id uuid, p_import jsonb)
  returns public.imports_assurance_maladie
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_refus text;
  v_conflit date;
  v_nouveaux integer;
  v_import public.imports_assurance_maladie;
begin
  if p_dossier_id is null
     or not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'banque')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('paiements_assurance_maladie:' || p_dossier_id::text, 0));
  v_refus := public.refus_de_l_import_assurance_maladie(p_import, v_jour);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  if exists (select 1 from jsonb_array_elements(p_import -> 'paiements') e
              join public.exercices_valides x
                on x.dossier_id = p_dossier_id
               and x.annee = extract(year from (e ->> 'date_journee_comptable')::date)::integer) then
    raise exception 'Un paiement de l''import tombe dans un exercice que le cabinet a validé : il ne s''importe plus.'
      using errcode = '22023';
  end if;

  select min((e ->> 'date_journee_comptable')::date) into v_conflit
    from jsonb_array_elements(p_import -> 'paiements') e
    join public.paiements_assurance_maladie p
      on p.dossier_id = p_dossier_id
     and p.date_journee_comptable = (e ->> 'date_journee_comptable')::date
     and p.regime is not distinct from (e ->> 'regime')::numeric::smallint
     and p.caisse is not distinct from (e ->> 'caisse')::numeric::smallint
     and p.part = e ->> 'part'
     and p.organisme_complementaire is not distinct from (e ->> 'organisme_complementaire')::numeric::bigint
   where p.montant_centimes <> (e ->> 'montant_centimes')::numeric::bigint
      or p.regularisations_centimes <> (e ->> 'regularisations_centimes')::numeric::bigint
      or p.nombre_de_factures <> (e ->> 'nombre_de_factures')::numeric::integer;
  if v_conflit is not null then
    raise exception 'Un paiement de l''import est déjà en base avec d''autres chiffres (la journée comptable du %) : retirer d''abord l''import qui le porte.',
      to_char(v_conflit, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  select count(*) into v_nouveaux
    from jsonb_array_elements(p_import -> 'paiements') e
   where not exists (
      select 1 from public.paiements_assurance_maladie p
       where p.dossier_id = p_dossier_id
         and p.date_journee_comptable = (e ->> 'date_journee_comptable')::date
         and p.regime is not distinct from (e ->> 'regime')::numeric::smallint
         and p.caisse is not distinct from (e ->> 'caisse')::numeric::smallint
         and p.part = e ->> 'part'
         and p.organisme_complementaire is not distinct from (e ->> 'organisme_complementaire')::numeric::bigint);
  if v_nouveaux = 0 then
    raise exception 'Ces paiements sont déjà tous importés : rien de neuf.' using errcode = '22023';
  end if;

  v_import.id := gen_random_uuid();
  perform set_config('jd.paiements_assurance_maladie', v_import.id::text, true);
  insert into public.imports_assurance_maladie (id, dossier_id, periode_du, periode_au, nombre_de_rejets, montant_rejete_centimes, importe_par)
  select v_import.id, p_dossier_id, min((e ->> 'date_journee_comptable')::date), max((e ->> 'date_journee_comptable')::date),
         (p_import #>> '{rejets,nombre}')::numeric::integer, (p_import #>> '{rejets,montant_centimes}')::numeric::bigint, auth.uid()
    from jsonb_array_elements(p_import -> 'paiements') e
  returning * into v_import;

  insert into public.paiements_assurance_maladie (dossier_id, import_id, date_journee_comptable, regime, caisse,
                                                  organisme_complementaire, part, montant_centimes, regularisations_centimes,
                                                  nombre_de_factures)
  select p_dossier_id, v_import.id, (e ->> 'date_journee_comptable')::date, (e ->> 'regime')::numeric::smallint, (e ->> 'caisse')::numeric::smallint,
         (e ->> 'organisme_complementaire')::numeric::bigint, e ->> 'part', (e ->> 'montant_centimes')::numeric::bigint,
         (e ->> 'regularisations_centimes')::numeric::bigint, (e ->> 'nombre_de_factures')::numeric::integer
    from jsonb_array_elements(p_import -> 'paiements') e
   where not exists (
      select 1 from public.paiements_assurance_maladie p
       where p.dossier_id = p_dossier_id
         and p.date_journee_comptable = (e ->> 'date_journee_comptable')::date
         and p.regime is not distinct from (e ->> 'regime')::numeric::smallint
         and p.caisse is not distinct from (e ->> 'caisse')::numeric::smallint
         and p.part = e ->> 'part'
         and p.organisme_complementaire is not distinct from (e ->> 'organisme_complementaire')::numeric::bigint);
  perform set_config('jd.paiements_assurance_maladie', '', true);
  return v_import;
end;
$$;

comment on function public.importer_paiements_assurance_maladie(uuid, jsonb) is
  'Importe les paiements de l''assurance maladie d''un dossier (NOE3), tout ou rien : des agrégats sans patient (version 1), le jour de Paris, hors des exercices validés ; un paiement déjà en base aux mêmes chiffres est passé, à d''autres chiffres l''import se refuse. Au cabinet du dossier ou à un accès « Banque » de ce dossier (42501) ; rend l''import écrit.';

-- ══ 4. Retirer un import ══════════
-- L'import et les paiements qu'il a apportés partent ensemble (la clé étrangère en cascade) ; un import dont un paiement
-- tombe dans un exercice validé reste.
create function public.retirer_import_assurance_maladie(p_import_id uuid) returns public.imports_assurance_maladie
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_import public.imports_assurance_maladie;
begin
  select i.* into v_import from public.imports_assurance_maladie i where i.id = p_import_id;
  if v_import.id is null
     or not (public.admin_du_dossier(v_import.dossier_id) or public.client_du_dossier(v_import.dossier_id, 'banque')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('paiements_assurance_maladie:' || v_import.dossier_id::text, 0));
  if exists (select 1 from public.paiements_assurance_maladie p
              join public.exercices_valides x
                on x.dossier_id = p.dossier_id and x.annee = extract(year from p.date_journee_comptable)::integer
             where p.import_id = p_import_id) then
    raise exception 'Un paiement de cet import tombe dans un exercice que le cabinet a validé : l''import ne se retire plus.'
      using errcode = '22023';
  end if;
  perform set_config('jd.paiements_assurance_maladie', p_import_id::text, true);
  delete from public.imports_assurance_maladie i where i.id = p_import_id returning i.* into v_import;
  perform set_config('jd.paiements_assurance_maladie', '', true);
  return v_import;
end;
$$;

comment on function public.retirer_import_assurance_maladie(uuid) is
  'Retire un import des paiements de l''assurance maladie (NOE3) et les paiements qu''il a apportés, hors des exercices validés. Au cabinet du dossier ou à un accès « Banque » de ce dossier (42501, aussi pour un import inconnu) ; rend l''import retiré.';

-- ══ 5. Les droits d'exécution ══════════
revoke execute on function public.importer_paiements_assurance_maladie(uuid, jsonb) from public, anon;
grant execute on function public.importer_paiements_assurance_maladie(uuid, jsonb) to authenticated;
revoke execute on function public.retirer_import_assurance_maladie(uuid) from public, anon;
grant execute on function public.retirer_import_assurance_maladie(uuid) to authenticated;
revoke execute on function public.refus_de_l_import_assurance_maladie(jsonb, date) from public, anon, authenticated;
revoke execute on function public.garder_paiements_assurance_maladie() from public, anon, authenticated;

-- ══ 6. La double authentification exigée (C7, second temps), si elle est déjà en base ══════════
-- Appliquée avant `deux_facteurs_exiges`, ce bloc ne fait rien et sa boucle pose la restrictive sur les tables ; après, il
-- la pose ici, à l'expression exacte (deuxFacteursDesTablesNeuves.test.ts).
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.imports_assurance_maladie as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
    execute 'create policy deux_facteurs on public.paiements_assurance_maladie as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;

-- ══ 7. La garde de fin ══════════
-- Ce que la migration a posé, relu au catalogue : la RLS active, trois policies permissives à authenticated seul par table,
-- aucune colonne de texte hors de la part, la garde avant chaque écriture, les deux fonctions de l'API aux droits du propriétaire et le chemin fixé, ni
-- l'anonyme ni PUBLIC ne les exécutent, la fonction du refus à aucun connecté ; et aucune ligne.
do $fin$
declare
  v_table text;
begin
  foreach v_table in array array['imports_assurance_maladie', 'paiements_assurance_maladie'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_table)::regclass) then
      raise exception 'La table % n''a pas sa RLS.', v_table;
    end if;
    if (select count(*) from pg_policy p where p.polrelid = ('public.' || v_table)::regclass and p.polpermissive
          and p.polroles = array[to_regrole('authenticated')::oid]) <> 3
       or (select count(*) from pg_policy p where p.polrelid = ('public.' || v_table)::regclass and p.polpermissive) <> 3
       or exists (select 1 from pg_policy p where p.polrelid = ('public.' || v_table)::regclass and p.polpermissive
                   and p.polcmd not in ('r', 'a')) then
      raise exception 'La table % ne porte pas ses trois policies permissives (deux lectures, l''insertion de restauration) à authenticated seul.', v_table;
    end if;
  end loop;
  if exists (select 1 from pg_attribute a
              where a.attrelid in ('public.imports_assurance_maladie'::regclass, 'public.paiements_assurance_maladie'::regclass)
                and a.attnum > 0 and not a.attisdropped
                and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'json'::regtype, 'jsonb'::regtype)
                and not (a.attrelid = 'public.paiements_assurance_maladie'::regclass and a.attname = 'part')) then
    raise exception 'Une table des paiements de l''assurance maladie porte une colonne de texte libre.';
  end if;
  if (select count(*) from pg_proc p
       where p.oid in ('public.importer_paiements_assurance_maladie(uuid, jsonb)'::regprocedure,
                       'public.retirer_import_assurance_maladie(uuid)'::regprocedure)
         and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
         and not has_function_privilege('anon', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) <> 2
     or has_function_privilege('authenticated', 'public.refus_de_l_import_assurance_maladie(jsonb, date)', 'execute')
     or has_function_privilege('anon', 'public.refus_de_l_import_assurance_maladie(jsonb, date)', 'execute') then
    raise exception 'Les droits d''exécution des fonctions des paiements de l''assurance maladie ne sont pas ceux que la migration pose.';
  end if;
  if (select count(*) from pg_trigger t
       where t.tgrelid in ('public.imports_assurance_maladie'::regclass, 'public.paiements_assurance_maladie'::regclass)
         and not t.tgisinternal and t.tgfoid = 'public.garder_paiements_assurance_maladie()'::regprocedure and t.tgtype = 31) <> 2
     or has_function_privilege('authenticated', 'public.garder_paiements_assurance_maladie()', 'execute') then
    raise exception 'La garde des paiements de l''assurance maladie manque, ou un connecté l''exécute.';
  end if;
  if exists (select 1 from public.imports_assurance_maladie) or exists (select 1 from public.paiements_assurance_maladie) then
    raise exception 'Les tables des paiements de l''assurance maladie portent une ligne : rien ne s''écrit d''avance.';
  end if;
end
$fin$;
