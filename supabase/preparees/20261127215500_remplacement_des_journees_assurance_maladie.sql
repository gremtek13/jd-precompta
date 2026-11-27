-- LE REMPLACEMENT D'UNE JOURNÉE COMPTABLE NON ASSOCIÉE PAR UN NOUVEL EXPORT DES PAIEMENTS DE L'ASSURANCE MALADIE (conception
-- 53, § 14.2 ; NOE4R-Q2 (B), réponse du cabinet du 27/11/2026, contre la recommandation) — PRÉPARÉE le 27/11/2026, PAS
-- APPLIQUÉE, À COLLER APRÈS `periode_des_imports_assurance_maladie` (NOE4R-Q1, dont elle exige le corps de la fonction
-- d'import, à l'empreinte). Le récit : HISTORIQUE.md, « 27/11/2026 — NOE4R-Q1 ET NOE4R-Q2 : LA PÉRIODE D'UN IMPORT ET LE
-- REMPLACEMENT D'UNE JOURNÉE (PRÉPARÉES, PAS APPLIQUÉES) » ; l'essai : supabase/essais/remplacementDesJourneesAssuranceMaladie.sql
-- (et, sur une réplique seulement, remplacementDesJourneesAssuranceMaladieSuppression.sql) ; le retour :
-- supabase/preparees/retour/20261127215600_retour_remplacement_des_journees_assurance_maladie.sql ; le module qui redit ses
-- refus et calcule ce que l'écran nomme avant le clic : src/lib/remplacementDesJourneesAssuranceMaladie.ts
-- (`REMPLACEMENT_DES_JOURNEES_PREVU`, baissé).
--
-- LA RÈGLE (le cabinet : « jamais en silence, jamais une journée associée, la trace, tout ou rien »). Hier, un paiement déjà en
-- base sous la même clé avec d'autres chiffres refusait l'import entier (« retirer d'abord l'import qui le porte ») : une
-- journée exportée incomplète — un export fait dans la journée, un paiement arrivé tard — ne se complétait qu'en retirant tout
-- l'import qui la portait. Désormais, un nouvel export qui porte une journée avec d'autres chiffres REMPLACE, pour cette
-- journée, les paiements qui diffèrent : la journée TELLE QUE L'EXPORT LA PORTE —
--   - un paiement du fichier sous la même clé qu'un paiement en base (la journée, le régime, la caisse, la part, l'organisme
--     complémentaire), avec d'autres chiffres (le net, les régularisations, le nombre de factures) : il le REMPLACE ;
--   - un paiement du fichier sous une clé que la base n'a pas : il ENTRE, comme hier ; aux mêmes chiffres : il est PASSÉ ;
--   - un paiement en base de cette journée que le fichier ne porte pas : il RESTE (un fichier lu sur une seule part, ou sans les
--     forfaits d'un état des paiements, ne dit pas que les autres sont partis ; NOE4RQ2-Q2).
-- LA JOURNÉE EST L'UNITÉ de la version et du refus : l'écran envoie les identifiants de TOUS les paiements en base des journées
-- qu'il a nommées, tels qu'il les a lus — un import, un retrait ou un autre remplacement entre la lecture et le clic change
-- cette liste, et le remplacement se refuse ; une journée dont UN paiement est associé à un crédit du relevé (NOE5) ne se
-- remplace pas — le cabinet défait d'abord l'association, et le crédit se rejuge sur les nouveaux chiffres.
--
-- CE QU'ELLE POSE.
--   1. `remplacements_assurance_maladie` : LA TRACE, une ligne par paiement remplacé — son dossier, sa clé, ses chiffres
--      d'avant et ceux qui les remplacent, l'import qui l'avait apporté (`ancien_import_id`) et celui qui le remplace
--      (`import_id`), qui et quand (posés par la base). Des dates, des entiers, la part (la liste fermée de NOE3) : AUCUNE
--      colonne de texte, aucune donnée de patient. Les deux imports sont nommés SANS clé étrangère : la trace survit au retrait
--      de l'un comme de l'autre (le retrait du nouvel import ne rend pas les paiements remplacés ; leurs chiffres restent ici).
--      Elle ne se modifie jamais et ne part qu'avec son dossier.
--   2. `remplacer_journees_assurance_maladie(dossier, import, paiements_lus)`, aux droits du propriétaire, TOUT OU RIEN, pour
--      qui importe — le cabinet du dossier ou un accès « Banque » de ce dossier (NOE-Q1 ; NOE4RQ2-Q3) : les paiements qui
--      diffèrent quittent l'import qui les avait apportés (chacun sous le réglage de la garde de NOE3, import par import), puis
--      l'import se fait PAR `importer_paiements_assurance_maladie` elle-même (sa période sur ses seuls paiements insérés,
--      NOE4R-Q1 ; ses rejets ceux du fichier ; ses refus), puis la trace s'écrit. Elle rend l'import écrit.
--   3. Les policies, toutes à `authenticated` : le cabinet du dossier lit la trace ; un accès « Banque » lit celle de son
--      dossier (il lit déjà les imports et les paiements qu'elle relie — CETTE LECTURE SE PRÉSENTE AU CABINET AVANT D'ÊTRE
--      APPLIQUÉE, la fiche NOE4RQ2-Q1) ; le super-administrateur insère (la restauration). Aucune policy de mise à jour ni de
--      suppression.
--   4. La restrictive `deux_facteurs`, si sa migration est déjà en base (sinon, sa boucle la posera).
--   5. `garder_remplacements_assurance_maladie`, avant la RLS, AUX DROITS DE L'APPELANT (comme les gardes de NOE3 et de NOE5 :
--      elle n'appelle donc pas la porte `_acces_avant_les_gardes`, dont la règle vise une garde security definer) : une trace ne
--      s'écrit que par la fonction (le réglage `jd.remplacements_assurance_maladie` porte son dossier) ou par la restauration ;
--      ne se modifie jamais ; ne part qu'avec son dossier — aussi pour le rôle des Edge Functions, qui passe la RLS.
--
-- LES REFUS DU REMPLACEMENT, DANS L'ORDRE (que src/lib/remplacementDesJourneesAssuranceMaladie.ts redit avant le clic, sous les
-- mêmes mots) : l'appelant (42501) ; puis, sous le verrou des paiements du dossier (celui de l'import, du retrait et de
-- l'association) : la forme de l'import (les mots de `refus_de_l_import_assurance_maladie`, 22023) ; la forme des paiements lus
-- (22023) ; un paiement dans un exercice validé (les mots de l'import, 22023) ; aucune journée à remplacer (22023) ; les
-- journées changées depuis leur lecture (22023) ; une journée associée, nommée (22023) ; puis ceux de l'import lui-même.
--
-- CE QU'ELLE NE CHANGE PAS : aucune fonction d'hier n'est remplacée — `importer_paiements_assurance_maladie`,
-- `refus_de_l_import_assurance_maladie`, `garder_paiements_assurance_maladie`, `client_du_dossier`, `admin_du_dossier`,
-- `is_super_admin` sont appelées à leur empreinte, jamais réécrites ; l'import seul se refuse toujours sur un conflit (son mot
-- reste « retirer d'abord l'import qui le porte ») : le remplacement est un AUTRE geste, nommé, confirmé. Ni les paiements, ni
-- leurs imports, ni l'association ne reçoivent de colonne. Le retrait des paiements remplacés est une suppression DANS LE CORPS
-- de la fonction : l'outil d'application la retient — le cabinet colle ce texte dans l'éditeur SQL, avec sa ligne d'historique
-- (CLAUDE.md). Aucune ligne écrite d'avance.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la version
-- que porte sa ligne d'historique, texte inchangé ; `REMPLACEMENT_DES_JOURNEES_PREVU` se lève alors, et la trace entre au plan
-- de sauvegarde. Ni barre oblique inverse, ni retour chariot.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une fonction appelée qui ne serait plus celle que cette migration suppose — à
-- l'empreinte de son corps, les retours chariot d'un collage écartés : la fonction d'import doit être celle de NOE4R-Q1 ; un
-- `client_du_dossier` qui ne lirait plus « banque » sur `droit_banque` ; et une base où manquerait une colonne qu'elle lit.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.remplacements_assurance_maladie') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('remplacer_journees_assurance_maladie', 'garder_remplacements_assurance_maladie')) then
    raise exception 'La migration remplacement_des_journees_assurance_maladie est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.paiements_assurance_maladie') is null or to_regclass('public.imports_assurance_maladie') is null
     or to_regclass('public.paiements_assurance_maladie_mouvements') is null then
    raise exception 'Les tables des paiements de l''assurance maladie ou de leur association manquent : appliquer d''abord paiements_assurance_maladie (NOE3) et association_paiements_assurance_maladie (NOE5).';
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('importer_paiements_assurance_maladie', 'public.importer_paiements_assurance_maladie(uuid,jsonb)', 'a7ebd230d249095bf4d247e0a6468f2f'),
      ('refus_de_l_import_assurance_maladie', 'public.refus_de_l_import_assurance_maladie(jsonb,date)', '690d81f6c0e1c08c5149466068f21370'),
      ('garder_paiements_assurance_maladie', 'public.garder_paiements_assurance_maladie()', '97548e624b2380eab867a53f3f850189')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire, ou appliquer d''abord periode_des_imports_assurance_maladie (NOE4R-Q1), avant cette migration.',
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
     and ((a.attrelid = 'public.paiements_assurance_maladie'::regclass
           and a.attname in ('id', 'dossier_id', 'import_id', 'date_journee_comptable', 'regime', 'caisse', 'organisme_complementaire',
                             'part', 'montant_centimes', 'regularisations_centimes', 'nombre_de_factures'))
       or (a.attrelid = 'public.paiements_assurance_maladie_mouvements'::regclass and a.attname = 'paiement_id')
       or (a.attrelid = 'public.exercices_valides'::regclass and a.attname in ('dossier_id', 'annee'))
       or (a.attrelid = 'public.dossiers'::regclass and a.attname = 'id'));
  if v_nombre <> 15 then
    raise exception 'Une colonne que cette migration lit manque (% sur 15) : relire les paiements, l''association et les exercices validés avant d''appliquer cette migration.', v_nombre;
  end if;
end
$garde$;

-- ══ 1. La trace ══════════
-- L'auteur sans clé étrangère vers son compte (le patron de NOE3) ; les deux imports nommés sans clé étrangère : la trace
-- survit au retrait de l'un comme de l'autre. Les chiffres, d'avant comme d'après, tiennent la forme d'un paiement de NOE3.
create table public.remplacements_assurance_maladie (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  import_id uuid not null,
  ancien_import_id uuid not null,
  date_journee_comptable date not null,
  regime smallint,
  caisse smallint,
  organisme_complementaire bigint,
  part text not null,
  ancien_montant_centimes bigint not null,
  ancien_regularisations_centimes bigint not null,
  ancien_nombre_de_factures integer not null,
  nouveau_montant_centimes bigint not null,
  nouveau_regularisations_centimes bigint not null,
  nouveau_nombre_de_factures integer not null,
  remplace_par uuid not null,
  remplace_le timestamptz not null default now(),
  constraint remplacements_assurance_maladie_part check (part in ('obligatoire', 'complementaire', 'forfait')),
  constraint remplacements_assurance_maladie_organisme check (
    (regime is null or regime between 0 and 99) and (caisse is null or caisse between 0 and 999)
    and (organisme_complementaire is null or (part = 'complementaire' and organisme_complementaire between 1 and 9999999999))),
  constraint remplacements_assurance_maladie_date check (date_journee_comptable >= date '2000-01-01'),
  constraint remplacements_assurance_maladie_anciens check (
    ancien_regularisations_centimes <= 0 and ancien_regularisations_centimes > -100000000000000
    and ancien_montant_centimes - ancien_regularisations_centimes between 0 and 99999999999999
    and (ancien_montant_centimes <> 0 or ancien_regularisations_centimes <> 0)
    and ancien_nombre_de_factures between 0 and 100000
    and (part <> 'forfait' or ancien_nombre_de_factures = 0)
    and (part = 'forfait' or (ancien_nombre_de_factures = 0) = (ancien_montant_centimes = ancien_regularisations_centimes))),
  constraint remplacements_assurance_maladie_nouveaux check (
    nouveau_regularisations_centimes <= 0 and nouveau_regularisations_centimes > -100000000000000
    and nouveau_montant_centimes - nouveau_regularisations_centimes between 0 and 99999999999999
    and (nouveau_montant_centimes <> 0 or nouveau_regularisations_centimes <> 0)
    and nouveau_nombre_de_factures between 0 and 100000
    and (part <> 'forfait' or nouveau_nombre_de_factures = 0)
    and (part = 'forfait' or (nouveau_nombre_de_factures = 0) = (nouveau_montant_centimes = nouveau_regularisations_centimes))),
  -- Un remplacement change quelque chose : sinon le paiement aurait été passé.
  constraint remplacements_assurance_maladie_autres_chiffres check (
    ancien_montant_centimes <> nouveau_montant_centimes or ancien_regularisations_centimes <> nouveau_regularisations_centimes
    or ancien_nombre_de_factures <> nouveau_nombre_de_factures),
  -- Un import ne remplace qu'une fois un paiement d'une clé (deux organismes non dits se heurtent : `nulls not distinct`).
  constraint remplacements_assurance_maladie_une_cle unique nulls not distinct
    (import_id, date_journee_comptable, regime, caisse, part, organisme_complementaire)
);

create index remplacements_assurance_maladie_dossier on public.remplacements_assurance_maladie (dossier_id, remplace_le);

comment on table public.remplacements_assurance_maladie is
  'La trace des paiements de l''assurance maladie remplacés par un nouvel export d''une journée comptable (conception 53, § 14.2, NOE4R-Q2) : un paiement remplacé par ligne, sa clé, ses chiffres d''avant et d''après, l''import qui l''avait apporté et celui qui le remplace, qui et quand. Aucune colonne de texte, aucune donnée de patient ; ne compte dans aucun moteur. Écrite par remplacer_journees_assurance_maladie seule ; ne se modifie jamais, ne part qu''avec son dossier.';
comment on column public.remplacements_assurance_maladie.import_id is
  'L''import qui a remplacé le paiement, sans clé étrangère : la trace survit à son retrait (qui ne rend pas le paiement remplacé).';
comment on column public.remplacements_assurance_maladie.ancien_import_id is
  'L''import qui avait apporté le paiement remplacé, sans clé étrangère : la trace survit à son retrait.';
comment on column public.remplacements_assurance_maladie.remplace_par is
  'Le compte qui a remplacé (auth.uid()), sans clé étrangère : il survit au retrait du compte.';

alter table public.remplacements_assurance_maladie enable row level security;

create policy remplacements_assurance_maladie_lecture on public.remplacements_assurance_maladie
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy remplacements_assurance_maladie_lecture_banque on public.remplacements_assurance_maladie
  for select to authenticated using (client_du_dossier(dossier_id, 'banque'));
create policy remplacements_assurance_maladie_restauration on public.remplacements_assurance_maladie
  for insert to authenticated with check (is_super_admin());

-- ══ 1 bis. La garde de la trace ══════════
-- Avant la RLS, aux droits de l'appelant. Chaque branche lit NEW ou OLD selon l'opération, jamais l'autre. Une trace ne part
-- qu'après son dossier (la cascade : le dossier n'est déjà plus là).
create function public.garder_remplacements_assurance_maladie() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'La trace d''un paiement de l''assurance maladie remplacé ne se modifie pas.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'La trace d''un paiement de l''assurance maladie remplacé ne part qu''avec son dossier.' using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.remplacements_assurance_maladie', true), '') <> new.dossier_id::text and not public.is_super_admin() then
    raise exception 'Les remplacements des paiements de l''assurance maladie ne s''écrivent que par leur fonction.' using errcode = '42501';
  end if;
  return new;
end
$$;

comment on function public.garder_remplacements_assurance_maladie() is
  'La garde de la trace des paiements de l''assurance maladie remplacés (NOE4R-Q2) : une ligne ne s''écrit que par remplacer_journees_assurance_maladie (jd.remplacements_assurance_maladie) ou par la restauration du super-administrateur (42501), jamais ne se modifie (23514), ne part qu''avec son dossier (23514).';

create trigger remplacements_assurance_maladie_garde
  before insert or update or delete on public.remplacements_assurance_maladie
  for each row execute function public.garder_remplacements_assurance_maladie();

-- ══ 2. Remplacer ══════════
-- D'UN SEUL TENANT, sous le verrou des paiements du dossier (l'import, le retrait et l'association le prennent aussi ; la
-- fonction d'import le reprend, dans la même transaction). Chaque test lit ce qu'un test d'avant a établi : un IF par étape.
-- Le jour est celui de Paris, lu par la base. Les paiements qui diffèrent sont relus AVANT leur retrait, pour la trace.
create function public.remplacer_journees_assurance_maladie(p_dossier_id uuid, p_import jsonb, p_paiements_lus uuid[])
  returns public.imports_assurance_maladie
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  c_forme constant text := 'Le remplacement est mal formé : les paiements en base des journées à remplacer, chacun une fois, de 1 à 5 000.';
  c_rien constant text := 'Aucune journée de l''import ne porte d''autres chiffres que la base : rien à remplacer.';
  c_change constant text := 'Les journées à remplacer ont changé depuis leur lecture : rien n''est remplacé.';
  c_trace constant text := 'Un paiement remplacé ne se retrouve pas dans l''import qui le remplace : rien n''est remplacé.';
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_refus text;
  v_differents uuid[];
  v_journees date[];
  v_lus uuid[];
  v_associee date;
  v_anciens jsonb;
  v_imports uuid[];
  v_ancien uuid;
  v_traces integer;
  v_import public.imports_assurance_maladie;
begin
  if p_dossier_id is null
     or not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'banque')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('paiements_assurance_maladie:' || p_dossier_id::text, 0));

  -- 1. La forme de l'import, sous les mots de la base.
  v_refus := public.refus_de_l_import_assurance_maladie(p_import, v_jour);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  -- 2. La forme des paiements lus : une liste à une dimension, de 1 à 5 000 identifiants, sans vide, chacun une fois.
  if p_paiements_lus is null or array_ndims(p_paiements_lus) is distinct from 1 then
    raise exception '%', c_forme using errcode = '22023';
  end if;
  if cardinality(p_paiements_lus) not between 1 and 5000 or array_position(p_paiements_lus, null) is not null then
    raise exception '%', c_forme using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_paiements_lus) x) <> cardinality(p_paiements_lus) then
    raise exception '%', c_forme using errcode = '22023';
  end if;

  -- 3. Un exercice validé : les mots de l'import.
  if exists (select 1 from jsonb_array_elements(p_import -> 'paiements') e
              join public.exercices_valides x
                on x.dossier_id = p_dossier_id
               and x.annee = extract(year from (e ->> 'date_journee_comptable')::date)::integer) then
    raise exception 'Un paiement de l''import tombe dans un exercice que le cabinet a validé : il ne s''importe plus.'
      using errcode = '22023';
  end if;

  -- 4. Les paiements en base qu'un paiement du fichier porte sous la même clé avec d'autres chiffres, et leurs journées.
  select array_agg(p.id order by p.id), array_agg(distinct p.date_journee_comptable order by p.date_journee_comptable)
    into v_differents, v_journees
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
  if v_differents is null then
    raise exception '%', c_rien using errcode = '22023';
  end if;

  -- 5. La version : TOUS les paiements en base de ces journées, tels que l'écran les a lus, ni plus ni moins.
  select array_agg(p.id order by p.id) into v_lus
    from public.paiements_assurance_maladie p
   where p.dossier_id = p_dossier_id and p.date_journee_comptable = any (v_journees);
  if v_lus is distinct from (select array_agg(x order by x) from unnest(p_paiements_lus) x) then
    raise exception '%', c_change using errcode = '22023';
  end if;

  -- 6. Une journée dont un paiement est associé à un crédit du relevé ne se remplace pas : la plus ancienne, nommée.
  select min(p.date_journee_comptable) into v_associee
    from public.paiements_assurance_maladie p
    join public.paiements_assurance_maladie_mouvements a on a.paiement_id = p.id
   where p.dossier_id = p_dossier_id and p.date_journee_comptable = any (v_journees);
  if v_associee is not null then
    raise exception 'La journée comptable du % porte un paiement associé à un crédit du relevé : elle ne se remplace pas tant que cette association n''est pas défaite.',
      to_char(v_associee, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  -- 7. Les paiements qui diffèrent : relus pour la trace, puis retirés de l'import qui les avait apportés, import par import
  -- (la garde de NOE3 n'en laisse partir un que sous le réglage de son import).
  select jsonb_agg(jsonb_build_object('import_id', p.import_id, 'date_journee_comptable', p.date_journee_comptable,
           'regime', p.regime, 'caisse', p.caisse, 'organisme_complementaire', p.organisme_complementaire, 'part', p.part,
           'montant_centimes', p.montant_centimes, 'regularisations_centimes', p.regularisations_centimes,
           'nombre_de_factures', p.nombre_de_factures) order by p.id)
    into v_anciens
    from public.paiements_assurance_maladie p
   where p.id = any (v_differents);
  select array_agg(distinct p.import_id) into v_imports from public.paiements_assurance_maladie p where p.id = any (v_differents);
  foreach v_ancien in array v_imports loop
    perform set_config('jd.paiements_assurance_maladie', v_ancien::text, true);
    delete from public.paiements_assurance_maladie p where p.import_id = v_ancien and p.id = any (v_differents);
  end loop;
  perform set_config('jd.paiements_assurance_maladie', '', true);

  -- 8. L'import, par sa fonction : plus aucun paiement du fichier ne diffère de la base ; ceux qui remplacent, ceux qui entrent,
  -- sous la période de ses seuls paiements insérés (NOE4R-Q1) et les rejets du fichier ; ses refus, sous ses mots.
  select i.* into v_import from public.importer_paiements_assurance_maladie(p_dossier_id, p_import) i;

  -- 9. La trace : chaque paiement remplacé, ses chiffres d'avant, ceux du paiement de même clé que l'import vient d'écrire.
  perform set_config('jd.remplacements_assurance_maladie', p_dossier_id::text, true);
  insert into public.remplacements_assurance_maladie (dossier_id, import_id, ancien_import_id, date_journee_comptable, regime, caisse,
                                                      organisme_complementaire, part, ancien_montant_centimes,
                                                      ancien_regularisations_centimes, ancien_nombre_de_factures,
                                                      nouveau_montant_centimes, nouveau_regularisations_centimes,
                                                      nouveau_nombre_de_factures, remplace_par)
  select p_dossier_id, v_import.id, a.import_id, a.date_journee_comptable, a.regime, a.caisse, a.organisme_complementaire, a.part,
         a.montant_centimes, a.regularisations_centimes, a.nombre_de_factures,
         n.montant_centimes, n.regularisations_centimes, n.nombre_de_factures, auth.uid()
    from jsonb_to_recordset(v_anciens) as a(import_id uuid, date_journee_comptable date, regime smallint, caisse smallint,
                                            organisme_complementaire bigint, part text, montant_centimes bigint,
                                            regularisations_centimes bigint, nombre_de_factures integer)
    join public.paiements_assurance_maladie n
      on n.import_id = v_import.id
     and n.date_journee_comptable = a.date_journee_comptable
     and n.regime is not distinct from a.regime
     and n.caisse is not distinct from a.caisse
     and n.part = a.part
     and n.organisme_complementaire is not distinct from a.organisme_complementaire;
  get diagnostics v_traces = row_count;
  perform set_config('jd.remplacements_assurance_maladie', '', true);
  if v_traces <> cardinality(v_differents) then
    raise exception '%', c_trace;
  end if;
  return v_import;
end;
$$;

comment on function public.remplacer_journees_assurance_maladie(uuid, jsonb, uuid[]) is
  'Remplace, d''un nouvel export, les paiements de l''assurance maladie qui en diffèrent dans les journées comptables qu''il porte (NOE4R-Q2), tout ou rien : la journée telle que l''export la porte (ce qui diffère est remplacé, ce qui est neuf entre, ce qui est égal est passé, ce qu''il ne porte pas reste), sur la version que l''écran a lue (tous les paiements en base de ces journées), jamais une journée dont un paiement est associé à un crédit du relevé, hors des exercices validés ; l''import se fait par importer_paiements_assurance_maladie, la trace par remplacements_assurance_maladie. Au cabinet du dossier ou à un accès « Banque » de ce dossier (42501) ; rend l''import écrit.';

-- ══ 3. Les droits d'exécution ══════════
revoke execute on function public.remplacer_journees_assurance_maladie(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.remplacer_journees_assurance_maladie(uuid, jsonb, uuid[]) to authenticated;
revoke execute on function public.garder_remplacements_assurance_maladie() from public, anon, authenticated;

-- ══ 4. La double authentification exigée (C7, second temps), si elle est déjà en base ══════════
-- Appliquée avant `deux_facteurs_exiges`, ce bloc ne fait rien et sa boucle pose la restrictive sur la table ; après, il la
-- pose ici, à l'expression exacte (deuxFacteursDesTablesNeuves.test.ts).
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.remplacements_assurance_maladie as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;

-- ══ 5. La garde de fin ══════════
-- Ce que la migration a posé, relu au catalogue : la RLS active, trois policies permissives à authenticated seul, aucune
-- colonne de texte hors de la part, la garde avant chaque écriture, la fonction de l'API aux droits du propriétaire et le
-- chemin fixé, ni l'anonyme ni PUBLIC ne l'exécutent, la garde à aucun connecté ; la fonction d'import inchangée ; et aucune
-- ligne.
do $fin$
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.remplacements_assurance_maladie'::regclass) then
    raise exception 'La trace des remplacements n''a pas sa RLS.';
  end if;
  if (select count(*) from pg_policy p where p.polrelid = 'public.remplacements_assurance_maladie'::regclass and p.polpermissive
        and p.polroles = array[to_regrole('authenticated')::oid]) <> 3
     or (select count(*) from pg_policy p where p.polrelid = 'public.remplacements_assurance_maladie'::regclass and p.polpermissive) <> 3
     or exists (select 1 from pg_policy p where p.polrelid = 'public.remplacements_assurance_maladie'::regclass and p.polpermissive
                 and p.polcmd not in ('r', 'a')) then
    raise exception 'La trace des remplacements ne porte pas ses trois policies permissives (deux lectures, l''insertion de restauration) à authenticated seul.';
  end if;
  if exists (select 1 from pg_attribute a
              where a.attrelid = 'public.remplacements_assurance_maladie'::regclass and a.attnum > 0 and not a.attisdropped
                and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'json'::regtype, 'jsonb'::regtype)
                and a.attname <> 'part') then
    raise exception 'La trace des remplacements porte une colonne de texte libre.';
  end if;
  if (select count(*) from pg_proc p
       where p.oid = 'public.remplacer_journees_assurance_maladie(uuid, jsonb, uuid[])'::regprocedure
         and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
         and not has_function_privilege('anon', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) <> 1 then
    raise exception 'Les droits d''exécution de la fonction du remplacement ne sont pas ceux que la migration pose.';
  end if;
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.remplacements_assurance_maladie'::regclass and not t.tgisinternal
         and t.tgfoid = 'public.garder_remplacements_assurance_maladie()'::regprocedure and t.tgtype = 31) <> 1
     or has_function_privilege('authenticated', 'public.garder_remplacements_assurance_maladie()', 'execute') then
    raise exception 'La garde de la trace des remplacements manque, ou un connecté l''exécute.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = to_regprocedure('public.importer_paiements_assurance_maladie(uuid,jsonb)'))
       is distinct from 'a7ebd230d249095bf4d247e0a6468f2f' then
    raise exception 'La fonction d''import n''est plus celle de NOE4R-Q1 : la migration ne l''a pas laissée intacte.';
  end if;
  if exists (select 1 from public.remplacements_assurance_maladie) then
    raise exception 'La trace des remplacements porte une ligne : rien ne s''écrit d''avance.';
  end if;
end
$fin$;
