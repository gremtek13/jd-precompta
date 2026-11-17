-- EL2 : L'ÉCRITURE LIBRE DE L'EXPERT-COMPTABLE, EN BASE — PRÉPARÉE le 17/11/2026, PAS APPLIQUÉE. À COLLER : ses deux fonctions
-- retirent les lignes qu'elles remplacent (le mot de la suppression retient `apply_migration`). Rien de ce qui existe ne se
-- détruit : une table, une colonne, des contraintes, deux déclencheurs et quatre fonctions s'ajoutent ; aucune ligne, aucune
-- colonne ni aucun objet ne se retire ni ne change.
--
-- La conception : docs/conceptions/54-ecriture-libre-de-l-expert-comptable.md, § 3 et § 4, et les réponses du cabinet du
-- 17/11/2026 (§ 10). Le module que la base redit : src/lib/ecritureLibre.ts (EL1), ses refus sous les mêmes mots, aux mêmes
-- codes, dans le même ordre ; src/lib/ecritureLibreEnBase.test.ts les confronte au texte de cette migration. Le récit :
-- HISTORIQUE.md, « 17/11/2026 — EL1 ET EL2 : L'ÉCRITURE LIBRE, LE MODULE ET LA MIGRATION (PRÉPARÉE, PAS APPLIQUÉE) ». Son
-- retour : supabase/preparees/retour/20261117120100_retour_ecritures_libres.sql. Son essai : supabase/essais/ecrituresLibres.sql
-- (une réplique seulement, une transaction qui s'annule).
--
-- SOURCES. PCG (règlement ANC n° 2014-03, numérotation du 1er janvier 2026) : art. 1031-3 (la validation interdit toute
-- modification ou suppression), 1032-1 et 1032-2 (une pièce justificative datée), 1121-1 (la liste des comptes), 1214-40,
-- 1214-46 et 1214-48 (la charge rattachée et sa contre-passation à l'ouverture suivante). CGI, art. 93, 1 et 93 A ;
-- BOI-BNC-BASE-40-10 § 260 (en trésorerie, une dépense compte l'année où elle est effectivement acquittée). LPF, art. A47 A-1
-- (une écriture équilibrée, une date). Lus par la conception (§ 2).
--
-- CE QU'ELLE POSE :
--   1. `ecritures_libres` : une écriture en partie double saisie par le cabinet, que rien dans l'application ne produit — une
--      date, un libellé (qui part au FEC), un motif (qui n'y part jamais), ses lignes en jsonb (compte, sens, centimes, poste
--      de la 2035 ou nul pour « hors de la 2035 », libellé d'un compte que l'application ne nomme pas), son extourne au 1er
--      janvier qui suit une écriture du 31 décembre, une pièce du dossier citée si le cabinet le veut, un numéro par dossier
--      et par année (« EL2026-0003 »), sa version, son auteur et son instant. Lue par le cabinet du dossier (`admin_du_dossier`),
--      jamais par un client ; aucune policy d'écriture : `enregistrer_ecriture_libre` et `retirer_ecriture_libre` seules, la
--      porte de la restauration au super-administrateur, en insertion.
--   2. LE DROIT (EL-Q1, 17/11/2026 : « les comptables peuvent faire les ecritures libre ») : tout compte du cabinet qui suit le
--      dossier — son chef, un membre assigné, le super-administrateur —, vérifié par `admin_du_dossier` avant toute autre
--      lecture ; l'auteur de chaque version (`cree_par`, `modifie_par`) posé par la fonction, jamais par l'appelant.
--   3. `ecritures_brouillon.ecriture_libre_id` : ses lignes au brouillon, à sa date, et celles de son extourne au 1er janvier
--      suivant (la paire naît, change et se retire ensemble) ; une contrainte les tient hors de toute autre source.
--   4. La recomposition EN ENTIERS des écritures que propose l'application (src/lib/ecritureLibre.ts,
--      `composerEcrituresLibres`) et leur comparaison en MULTIENSEMBLE (date, compte, sens, centimes), le journal OD, les
--      libellés au caractère près.
--   5. Les refus du module (EL-Q4 (A) : la banque, la caisse et le résultat ; EL-Q2 (A) : le poste d'une ligne de résultat en
--      trésorerie, dans la liste fermée de la base ; EL-Q3 (A) : une charge ou un produit rattaché compté dans la 2035 exige
--      la désignation explicite et l'extourne). Les avertissements (EL-Q5, EL-Q6) ne sont qu'à l'écran : la base ne redit que
--      les refus.
--   6. Le gel : une écriture d'un exercice validé ne s'écrit, ne change ni ne se retire plus (23514) ; ses lignes, figées par
--      la garde des écritures validées. Le verrou PARTAGÉ de la validation (`cle_validation`) se prend avant toute lecture du
--      gel.
--   7. Si la double authentification exigée (`deux_facteurs_exiges`) est déjà en base, la policy restrictive `deux_facteurs` ;
--      si la porte d'accès (`acces_avant_les_gardes`) l'est, elle devant la garde de la table.
--   8. L'exclusion envers les quatre autres sources neuves du brouillon, préparées : l'ouverture éclatée par compte (MCB5g),
--      l'inventaire (INV2), le stock de clôture (LIA2), l'affectation (AFF2) — une contrainte PAR PAIRE, au même nom et au même
--      texte dans les deux migrations de la paire, posée par la seconde à se coller. Les cinq se collent ainsi dans n'importe
--      quel ordre. La garde de tête accepte ces quatre colonnes, présentes ou non, et refuse toute autre clé étrangère du
--      brouillon qu'elle ne connaît pas.
--
-- CE QU'ELLE NE FAIT PAS : `valider_exercice` n'est pas remplacée (sa numérotation couvre toute ligne du brouillon que le FEC
-- porte, conception § 5.2) ; le FEC, la piste d'audit et l'état des écritures libres (EL3), la 2035 et la concordance (EL4),
-- l'écran (EL5), la garde des lignes sans source (EL2b, EL-Q11 (A), après la mesure en base), le dégel d'un exercice validé
-- (EL-Q10 (B), conçu, pas codé : ses questions EL10-Q1 à Q6). Rien ne s'écrit avant EL5.

do $garde$
declare
  v_f text;
  v_sources text;
begin
  if to_regclass('public.ecritures_libres') is not null
     or exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
                  and a.attname = 'ecriture_libre_id' and not a.attisdropped) then
    raise exception 'La migration ecritures_libres est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.dossiers') is null or to_regclass('public.pieces') is null or to_regclass('public.a_nouveaux') is null
     or to_regclass('public.exercices_valides') is null
     or exists (select 1 from (values ('piece_id'), ('ligne_bancaire_id'), ('immobilisation_id'), ('vehicule_id'),
                  ('declaration_tva_id'), ('cotisation_id'), ('encaissement_id'), ('facture_id'), ('operation_caisse_id')) c(n)
                where not exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
                                    and a.attname = c.n and not a.attisdropped)) then
    raise exception 'ecritures_libres : une table ou une colonne dont elle dépend manque : relire la base.';
  end if;
  -- Les sources du brouillon : sa contrainte « sans autre source » nomme les neuf d'hier, et les quatre sources neuves des
  -- migrations sœurs (MCB5g, INV2, LIA2, AFF2), présentes ou non, reçoivent leur exclusion au § 3. Toute autre clé étrangère du
  -- brouillon, que cette migration ne nomme pas, la refuse : la relire.
  select string_agg(a.attname, ',' order by a.attname collate "C") into v_sources
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.ecritures_brouillon'::regclass and c.contype = 'f'
     and a.attname not in ('affectation_id', 'operation_inventaire_id', 'ouverture_compte_bancaire_id', 'stock_de_cloture_id');
  if v_sources is distinct from
     'cotisation_id,declaration_tva_id,dossier_id,encaissement_id,facture_id,immobilisation_id,ligne_bancaire_id,operation_caisse_id,piece_id,vehicule_id' then
    raise exception 'Les sources du brouillon ne sont plus celles que cette migration nomme (%) : sa contrainte « sans autre source » doit recevoir la nouvelle — relire la migration avant de l''appliquer.', v_sources;
  end if;
  -- Les fonctions qu'elle appelle, à l'empreinte de leur corps (les retours chariot écartés), relevées le 17/11/2026 sur une
  -- copie de la réplique portée à la production du jour (236).
  for v_f in select x.f from (values
      ('admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('cle_validation(uuid)', 'bcbb03363036aa6aa037c0b829e3382f'),
      ('frontiere_validation(uuid)', '24a04846471ec5e8cdbae6f3b9f4a2e8'),
      ('retour_declencheur(text, anyelement, anyelement)', 'bc80cac6efe46d15f86d1820eb56c47e')) as x(f, empreinte)
    where (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p where p.oid = to_regprocedure('public.' || x.f))
          is distinct from x.empreinte
  loop
    raise exception 'La fonction % n''est plus celle que cette migration appelle : relire la migration contre la base avant de l''appliquer.', v_f;
  end loop;
end
$garde$;

-- ══ 1. Les écritures libres ══
create table public.ecritures_libres (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  exercice integer not null,
  numero integer not null,
  date date not null,
  libelle text not null,
  motif text not null,
  lignes jsonb not null,
  avec_extourne boolean not null default false,
  piece_citee_id uuid references public.pieces(id),
  version integer not null default 1,
  cree_par uuid not null,
  cree_le timestamptz not null default now(),
  modifie_par uuid,
  modifie_le timestamptz,
  -- Un numéro par dossier et par année, jamais réutilisé (un retrait laisse un trou, qui n'est pas un trou du FEC : la
  -- validation numérote ses écritures à elle) ; une contrainte TOTALE.
  constraint ecritures_libres_numero unique (dossier_id, exercice, numero),
  constraint ecritures_libres_exercice check (exercice = extract(year from date) and exercice >= 2000 and exercice <= 2100),
  constraint ecritures_libres_numero_positif check (numero >= 1),
  constraint ecritures_libres_libelle check (char_length(libelle) >= 1 and char_length(libelle) <= 200 and libelle !~ '[\r\n]'),
  constraint ecritures_libres_motif check (char_length(motif) >= 1 and char_length(motif) <= 2000),
  constraint ecritures_libres_lignes check (jsonb_typeof(lignes) = 'array' and jsonb_array_length(lignes) between 2 and 200),
  -- L'extourne : au 1er janvier qui suit une écriture du 31 décembre seulement.
  constraint ecritures_libres_extourne check (not avec_extourne or (extract(month from date) = 12 and extract(day from date) = 31)),
  constraint ecritures_libres_version check (version >= 1)
);
create index ecritures_libres_piece_citee on public.ecritures_libres (piece_citee_id) where piece_citee_id is not null;
alter table public.ecritures_libres enable row level security;
comment on table public.ecritures_libres is
  'EL2 (conception 54) : une écriture en partie double saisie par le cabinet, que rien dans l''application ne produit. Écrite par enregistrer_ecriture_libre et retirer_ecriture_libre seules (tout compte du cabinet qui suit le dossier, EL-Q1) ; ses lignes au brouillon (sa date, et le 1er janvier suivant pour son extourne) citent ecriture_libre_id.';
comment on column public.ecritures_libres.lignes is
  'Les lignes saisies, dans leur ordre : { compte, sens, centimes, poste_2035 (en trésorerie, sur une ligne de classe 6 ou 7 : le poste de la 2035 sous lequel elle compte, ou nul — hors de la 2035, EL-Q2 (A)), compte_lib (le libellé d''un compte que l''application ne nomme pas, ou nul) }. Le brouillon ne peut pas porter le poste avant la validation (ecritures_brouillon_champs_bnc_du_fec).';
comment on column public.ecritures_libres.motif is
  'La justification du cabinet, imprimée sur l''état des écritures libres, jamais au FEC ni à l''assistant (EL-Q7 (A), EL-Q8 (A)).';
comment on column public.ecritures_libres.piece_citee_id is
  'La pièce du dossier qui fonde l''écriture, quand elle existe (EL-Q8 (A)) : citée ici, jamais par ecritures_brouillon.piece_id, qui la rangerait au journal AC et la ferait régénérer avec la pièce.';

-- Le cabinet du dossier lit ; aucun client, aucun droit d'accès. Aucune policy d'écriture : les deux fonctions seules. La
-- restauration réinsère par la porte du super-administrateur, que la garde ouvre.
create policy ecritures_libres_lecture on public.ecritures_libres
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy ecritures_libres_restauration on public.ecritures_libres
  for insert to authenticated with check (public.is_super_admin());

-- ══ 2. Ses lignes au brouillon ══
alter table public.ecritures_brouillon add column ecriture_libre_id uuid
  constraint ecritures_brouillon_ecriture_libre_id_fkey references public.ecritures_libres(id);
-- Une ligne d'une écriture libre ne cite aucune autre source. L'exclusion est symétrique : les contraintes des sources d'hier
-- n'ont pas à nommer la colonne neuve ; celles des sources neuves sœurs, le bloc qui suit.
alter table public.ecritures_brouillon add constraint ecritures_brouillon_libre_sans_autre_source check (
  ecriture_libre_id is null
  or num_nonnulls(piece_id, ligne_bancaire_id, immobilisation_id, vehicule_id, declaration_tva_id, cotisation_id,
                  encaissement_id, facture_id, operation_caisse_id) = 0);
create index ecritures_brouillon_ecriture_libre on public.ecritures_brouillon (ecriture_libre_id)
  where ecriture_libre_id is not null;
comment on column public.ecritures_brouillon.ecriture_libre_id is
  'EL2 (conception 54) : l''écriture libre dont cette ligne est la constatation (à sa date) ou l''extourne (au 1er janvier suivant) ; écrite par enregistrer_ecriture_libre seule.';

-- L'exclusion envers une source neuve sœur déjà en base : la contrainte de la paire, au nom et au texte que l'autre migration
-- poserait si elle venait après (MCB5g, INV2, LIA2 et AFF2 portent ce même bloc, pour leur paire avec celle-ci).
do $autres_sources$
begin
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'ouverture_compte_bancaire_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_libre_hors_de_l_ouverture '
      || 'check (ecriture_libre_id is null or ouverture_compte_bancaire_id is null)';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'operation_inventaire_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_libre_hors_de_l_inventaire '
      || 'check (ecriture_libre_id is null or operation_inventaire_id is null)';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'stock_de_cloture_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_libre_hors_des_stocks '
      || 'check (ecriture_libre_id is null or stock_de_cloture_id is null)';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'affectation_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_libre_hors_de_l_affectation '
      || 'check (ecriture_libre_id is null or affectation_id is null)';
  end if;
end
$autres_sources$;

-- ══ 3. Deux aides, privées ══
-- Un nombre de centimes que l'application relit sans perte : un nombre JSON entier, de valeur absolue au plus 2^53 - 1
-- (`Number.isSafeInteger`) ; nul sinon. Les CASE imbriqués : un texte n'est jamais converti en nombre.
create function public.ecriture_libre_entier(p jsonb) returns bigint
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) = 'number' then
    case when (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric) and abs((p #>> '{}')::numeric) <= 9007199254740991
         then (p #>> '{}')::numeric::bigint end end
$$;
-- Un texte rogné comme `String.prototype.trim` le rogne (les blancs et les fins de ligne d'ECMAScript, art. 12.2 et 12.3) :
-- le libellé et le motif se jugent et s'écrivent comme le module les compose.
create function public.ecriture_libre_rogne(p text) returns text
language sql immutable set search_path = public as $$
  select btrim(p, chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192)
    || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201)
    || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))
$$;
revoke execute on function public.ecriture_libre_entier(jsonb) from public, anon, authenticated;
revoke execute on function public.ecriture_libre_rogne(text) from public, anon, authenticated;

-- ══ 4. Les gardes ══
-- L'écriture : écrite par ses deux fonctions seules (le réglage local `jd.ecriture_libre`, qu'elles posent sur leur dossier) ou
-- réinsérée par le super-administrateur (la restauration, qui réinsère les exercices validés en dernier) ; celle d'un exercice
-- figé ne change, ne se retire ni ne s'insère plus. Le départ du dossier l'emporte.
create function public.garder_ecritures_libres() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return old;
  end if;
  if coalesce(current_setting('jd.ecriture_libre', true), '')
       is distinct from (case when tg_op = 'DELETE' then old.dossier_id else new.dossier_id end)::text
     and not (tg_op = 'INSERT' and public.is_super_admin()) then
    raise exception 'Une écriture libre ne s’écrit que par enregistrer_ecriture_libre et retirer_ecriture_libre.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.dossier_id is distinct from old.dossier_id then
    raise exception 'Une écriture libre ne change pas de dossier.' using errcode = '42501';
  end if;
  if tg_op <> 'INSERT' then
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    if old.date <= public.frontiere_validation(old.dossier_id) then
      raise exception 'Cette date est dans un exercice validé : une écriture libre ne s’y passe plus.' using errcode = '23514';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
    if new.date <= public.frontiere_validation(new.dossier_id) then
      raise exception 'Cette date est dans un exercice validé : une écriture libre ne s’y passe plus.' using errcode = '23514';
    end if;
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;
create trigger ecritures_libres_garde before insert or update or delete on public.ecritures_libres
  for each row execute function public.garder_ecritures_libres();

-- Ses lignes : une ligne qui cite une écriture libre (avant ou après) ne s'écrit, ne change ni ne part que par sa fonction, la
-- réinsertion du super-administrateur et le départ du dossier exceptés ; elle appartient à une écriture libre de son dossier,
-- à sa date, ou au 1er janvier suivant pour son extourne. La validation ne touche à aucune des colonnes que le déclencheur
-- garde.
create function public.garder_ecriture_libre_du_brouillon() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return old;
  end if;
  if tg_op <> 'INSERT' and old.ecriture_libre_id is not null
     and coalesce(current_setting('jd.ecriture_libre', true), '') is distinct from old.dossier_id::text then
    raise exception 'Une ligne d’une écriture libre ne change que par son écriture.' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and new.ecriture_libre_id is not null then
    if coalesce(current_setting('jd.ecriture_libre', true), '') is distinct from new.dossier_id::text
       and not (tg_op = 'INSERT' and public.is_super_admin()) then
      raise exception 'Une ligne d’une écriture libre ne change que par son écriture.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.ecritures_libres e
                    where e.id = new.ecriture_libre_id and e.dossier_id = new.dossier_id
                      and (new.date = e.date or (e.avec_extourne and new.date = e.date + 1))) then
      raise exception 'Une ligne d’une écriture libre appartient à une écriture libre de son dossier, à sa date, ou au 1er janvier suivant pour son extourne.'
        using errcode = '23514';
    end if;
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;
create trigger ecritures_brouillon_libre
  before insert or delete or update of ecriture_libre_id, dossier_id, date, compte, sens, montant, libelle
  on public.ecritures_brouillon for each row execute function public.garder_ecriture_libre_du_brouillon();
revoke execute on function public.garder_ecritures_libres() from public, anon, authenticated;
revoke execute on function public.garder_ecriture_libre_du_brouillon() from public, anon, authenticated;

-- ══ 5. Enregistrer une écriture libre, et son extourne ══
-- p_ecriture : { id (nul : une nouvelle), date, libelle, motif, lignes: [{ compte, sens, centimes, poste_2035, compte_lib }],
-- avec_extourne, contre_la_regle, piece_citee_id } (`ecritureLibrePourLaBase`) ; p_ecritures : les écritures que compose
-- `composerEcrituresLibres` ({ date, journal, libelle, lignes: [{ compte, sens, centimes }] }) ; p_version_lue : la version que
-- la saisie remplace (nulle pour une nouvelle). Les refus, dans l'ordre du module : la date, l'extourne, le libellé, le motif,
-- les lignes (leur nombre, puis chacune : le compte, le sens, le montant, le poste, le libellé du compte), un compte sous deux
-- libellés, l'équilibre, la règle de la trésorerie ; puis ceux que la base seule dit : la pièce citée, la version lue, les
-- écritures proposées. Rend l'identifiant de l'écriture.
create function public.enregistrer_ecriture_libre(p_dossier_id uuid, p_ecriture jsonb, p_ecritures jsonb, p_version_lue integer)
 returns uuid
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_mode text;
  v_id uuid;
  v_texte_date text;
  v_date date;
  v_frontiere date;
  v_ouverture date;
  v_extourne boolean;
  v_contre boolean;
  v_libelle text;
  v_motif text;
  v_l jsonb;
  v_rang integer;
  v_compte text;
  v_sens text;
  v_centimes bigint;
  v_poste text;
  v_lib text;
  v_lignes jsonb := '[]'::jsonb;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_resultat boolean := false;
  v_rattachement boolean := false;
  v_poste_compte boolean := false;
  v_controle constant text := '[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']';
  v_piece uuid;
  v_ancienne public.ecritures_libres%rowtype;
  v_numero integer;
  v_lendemain date;
  v_attendues jsonb;
  v_conforme boolean;
  v_desequilibre integer;
begin
  -- 0. L'accès, avant toute lecture : tout compte du cabinet qui suit le dossier (EL-Q1) ; puis le verrou PARTAGÉ de la
  --    validation, avant toute lecture du gel.
  if p_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  select d.mode_comptable into v_mode from public.dossiers d where d.id = p_dossier_id;
  if not found then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  -- 1. La date : lisible, hors d'un exercice validé, pas avant l'ouverture, au plus tard le 31 décembre de l'année en cours
  --    (lue à Paris).
  v_texte_date := case when jsonb_typeof(p_ecriture -> 'date') = 'string' then p_ecriture ->> 'date' end;
  begin
    if coalesce(v_texte_date, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode = '22007';
    end if;
    v_date := v_texte_date::date;
  exception when others then
    v_date := null;
  end;
  if v_date is null or to_char(v_date, 'YYYY-MM-DD') <> v_texte_date or extract(year from v_date) < 2000
     or extract(year from v_date) > 2100 then
    raise exception '%', 'La date de l’écriture se lit en une date civile, entre 2000 et 2100.' using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_date <= v_frontiere then
    raise exception '%', 'Cette date est dans un exercice validé : une écriture libre ne s’y passe plus.' using errcode = '23514';
  end if;
  select min(a.date) into v_ouverture from public.a_nouveaux a where a.dossier_id = p_dossier_id;
  if v_ouverture is not null and v_date < v_ouverture then
    raise exception '%', 'Cette date précède l’ouverture du dossier dans l’application : l’écriture n’y a pas de place.'
      using errcode = '22023';
  end if;
  if extract(year from v_date) > extract(year from (now() at time zone 'Europe/Paris')) then
    raise exception '%', 'Une écriture libre se date au plus tard du 31 décembre de l’année en cours.' using errcode = '22023';
  end if;

  -- 2. L'extourne : au 1er janvier qui suit une écriture du 31 décembre seulement.
  v_extourne := case when jsonb_typeof(p_ecriture -> 'avec_extourne') = 'boolean' then (p_ecriture ->> 'avec_extourne')::boolean end;
  if v_extourne is null then
    raise exception '%', 'L’extourne se demande ou ne se demande pas : vrai ou faux.' using errcode = '22023';
  end if;
  if v_extourne and to_char(v_date, 'MM-DD') <> '12-31' then
    raise exception '%', 'Seule une écriture du 31 décembre reçoit son extourne au 1er janvier suivant.' using errcode = '22023';
  end if;

  -- 3. Le libellé (une ligne, sans caractère de contrôle : il part au FEC), puis le motif.
  v_libelle := case when jsonb_typeof(p_ecriture -> 'libelle') = 'string' then public.ecriture_libre_rogne(p_ecriture ->> 'libelle') end;
  if v_libelle is null or char_length(v_libelle) < 1 or char_length(v_libelle) > 200 or v_libelle ~ v_controle then
    raise exception '%', 'Le libellé de l’écriture tient en 1 à 200 caractères, sur une ligne : il part au FEC.' using errcode = '22023';
  end if;
  v_motif := case when jsonb_typeof(p_ecriture -> 'motif') = 'string' then public.ecriture_libre_rogne(p_ecriture ->> 'motif') end;
  if v_motif is null or char_length(v_motif) < 1 or char_length(v_motif) > 2000 then
    raise exception '%', 'Le motif de l’écriture tient en 1 à 2 000 caractères : il dit pourquoi l’écriture est passée.'
      using errcode = '22023';
  end if;

  -- 4. Les lignes : leur nombre, puis chacune dans l'ordre — le compte (la forme ; la banque, la caisse et le résultat
  --    refusés, EL-Q4 (A)), le sens, le montant, le poste de la 2035 (EL-Q2 (A) : en trésorerie, sur une ligne de classe 6 ou
  --    7, dans la liste fermée de `ecritures_brouillon_champs_bnc_du_fec`), le libellé du compte.
  if jsonb_typeof(p_ecriture -> 'lignes') is distinct from 'array' or jsonb_array_length(p_ecriture -> 'lignes') < 2
     or jsonb_array_length(p_ecriture -> 'lignes') > 200 then
    raise exception '%', 'Une écriture libre porte de 2 à 200 lignes.' using errcode = '22023';
  end if;
  for v_l, v_rang in select l.v, l.r::integer from jsonb_array_elements(p_ecriture -> 'lignes') with ordinality as l(v, r) order by l.r loop
    v_compte := case when jsonb_typeof(v_l -> 'compte') = 'string' then v_l ->> 'compte' end;
    if v_compte is null or v_compte !~ '^[1-7][0-9]{5,9}$' then
      raise exception '%', 'Ce numéro de compte n’a pas la forme d’un compte de l’application : six à dix chiffres, d’une classe 1 à 7.'
        using errcode = '22023';
    end if;
    if starts_with(v_compte, '512') then
      raise exception '%', 'Le 512 est le compte du relevé : un mouvement manquant s’importe avec son relevé, il ne s’écrit pas à la main.'
        using errcode = '22023';
    end if;
    if starts_with(v_compte, '53') then
      raise exception '%', 'La caisse se rejoue depuis ses opérations : une recette ou une dépense en espèces se saisit dans Caisse.'
        using errcode = '22023';
    end if;
    if starts_with(v_compte, '120') or starts_with(v_compte, '129') then
      raise exception '%', 'Le résultat (120, 129) se calcule : une écriture libre ne le passe pas.' using errcode = '22023';
    end if;
    v_sens := case when jsonb_typeof(v_l -> 'sens') = 'string' then v_l ->> 'sens' end;
    if v_sens is null or v_sens not in ('debit', 'credit') then
      raise exception '%', 'Une ligne est au débit ou au crédit.' using errcode = '22023';
    end if;
    v_centimes := public.ecriture_libre_entier(v_l -> 'centimes');
    if v_centimes is null or v_centimes <= 0 then
      raise exception '%', 'Le montant d’une ligne est un nombre de centimes entier et positif.' using errcode = '22023';
    end if;
    v_poste := null;
    if v_l -> 'poste_2035' is not null and jsonb_typeof(v_l -> 'poste_2035') <> 'null' then
      v_poste := case when jsonb_typeof(v_l -> 'poste_2035') = 'string' then v_l ->> 'poste_2035' end;
      if v_mode is distinct from 'tresorerie' then
        raise exception '%', 'En comptabilité d’engagement, une écriture libre ne porte aucun poste de la 2035.' using errcode = '22023';
      end if;
      if left(v_compte, 1) not in ('6', '7') then
        raise exception '%', 'Seule une ligne de charge ou de produit (classe 6 ou 7) porte un poste de la 2035.' using errcode = '22023';
      end if;
      if v_poste is null or not (case when left(v_compte, 1) = '7' then v_poste = any (array[
          'Recettes', 'Recettes encaissées y compris les remboursements de frais', 'Produits financiers',
          'Gains divers', 'Indemnités journalières'])
        else v_poste = any (array[
          'Débours payés pour le compte des clients', 'Débours', 'Honoraires rétrocédés', 'Rétrocessions',
          'Achats', 'Salaires nets et avantages en nature', 'Salaires', 'Charges sociales sur salaires',
          'Taxe sur la valeur ajoutée', 'TVA', 'Contribution économique territoriale', 'CET', 'Autres impôts',
          'Impôts et taxes', 'Contribution sociale généralisée déductible', 'CSG déductible',
          'Loyer et charges locatives', 'Loyers et charges locatives', 'Location de matériel et de mobilier',
          'Redevances de collaboration',
          'Entretien et réparations', 'Personnel intérimaire', 'Petit outillage', 'Chauffage, eau, gaz, électricité',
          'Honoraires ne constituant pas des rétrocessions', 'Primes d''assurance', 'Primes d''assurances', 'Assurance',
          'Frais de véhicules', 'Autres frais de déplacements', 'Frais de déplacement', 'Frais de déplacements',
          'Indemnités kilométriques', 'Cotisations sociales personnelles', 'Charges sociales personnelles',
          'Cotisations facultatives Madelin', 'Plan d''épargne retraite',
          'Frais de réception, de représentation et de congrès', 'Frais de réception, de représentation',
          'Fournitures de bureau, frais de documentation, de correspondance et de téléphone', 'Fournitures de bureau',
          'Frais d''actes et de contentieux', 'Cotisations syndicales et professionnelles',
          'Autres frais divers de gestion', 'Frais divers de gestion', 'Divers', 'Frais financiers', 'Pertes diverses',
          'Amortissements', 'Dotation aux amortissements']) end) then
        raise exception '%', 'Ce poste n’est pas un poste de la 2035 pour une ligne de cette classe.' using errcode = '22023';
      end if;
      v_poste_compte := true;
    end if;
    v_lib := null;
    if v_l -> 'compte_lib' is not null and jsonb_typeof(v_l -> 'compte_lib') <> 'null' then
      v_lib := case when jsonb_typeof(v_l -> 'compte_lib') = 'string' then public.ecriture_libre_rogne(v_l ->> 'compte_lib') end;
      if v_lib is null or char_length(v_lib) < 1 or char_length(v_lib) > 200 or v_lib ~ v_controle then
        raise exception '%', 'Le libellé d’un compte tient en 1 à 200 caractères, sur une ligne.' using errcode = '22023';
      end if;
    end if;
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('compte', v_compte, 'sens', v_sens, 'centimes', v_centimes,
      'poste_2035', v_poste, 'compte_lib', v_lib));
    if v_sens = 'debit' then v_debit := v_debit + v_centimes; else v_credit := v_credit + v_centimes; end if;
    v_resultat := v_resultat or left(v_compte, 1) in ('6', '7');
    v_rattachement := v_rattachement or exists (select 1 from unnest(array['408', '418', '4282', '4286', '4382', '4386', '439', '44812',
      '4482', '1688', '518', '467', '468', '486', '487']) r(racine) where starts_with(v_compte, r.racine));
  end loop;

  -- 5. Un compte, un libellé.
  if exists (select 1 from jsonb_array_elements(v_lignes) x(v) group by x.v ->> 'compte'
              having count(distinct coalesce(x.v ->> 'compte_lib', '')) > 1) then
    raise exception '%', 'Un même compte porte deux libellés dans cette écriture.' using errcode = '22023';
  end if;

  -- 6. L'équilibre, au centime : au moins un débit et un crédit, des sommes égales que l'application relit sans perte.
  if v_debit = 0 or v_credit = 0 or v_debit <> v_credit or v_debit > 9007199254740991 then
    raise exception '%', 'L’écriture n’est pas équilibrée : au moins un débit et un crédit, la somme des débits égale à celle des crédits, au centime.'
      using errcode = '22023';
  end if;

  -- 7. La règle de la trésorerie (EL-Q3 (A)) : une charge ou un produit rattaché (une ligne de classe 6 ou 7 en face d'un compte
  --    de rattachement) compté dans la 2035 exige la désignation explicite et l'extourne ; sans objet, la désignation se refuse.
  v_contre := case when jsonb_typeof(p_ecriture -> 'contre_la_regle') = 'boolean' then (p_ecriture ->> 'contre_la_regle')::boolean end;
  if v_contre is null then
    raise exception '%', 'La désignation « contre la règle de la trésorerie » se donne ou ne se donne pas : vrai ou faux.'
      using errcode = '22023';
  end if;
  if v_mode = 'tresorerie' and v_resultat and v_rattachement and v_poste_compte then
    if not v_contre or not v_extourne then
      raise exception '%', 'Une charge ou un produit rattaché compté dans la 2035 demande la désignation explicite « contre la règle de la '
        || 'trésorerie » et son extourne au 1er janvier.' using errcode = '22023';
    end if;
  elsif v_contre then
    raise exception '%', 'La désignation « contre la règle de la trésorerie » ne vaut que pour une charge ou un produit rattaché compté '
      || 'dans la 2035.' using errcode = '22023';
  end if;

  -- 8. La pièce citée, facultative : une pièce de ce dossier.
  if p_ecriture -> 'piece_citee_id' is not null and jsonb_typeof(p_ecriture -> 'piece_citee_id') <> 'null' then
    if coalesce(p_ecriture ->> 'piece_citee_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.pieces p where p.id = (p_ecriture ->> 'piece_citee_id')::uuid and p.dossier_id = p_dossier_id) then
      raise exception '%', 'La pièce citée n’est pas une pièce de ce dossier.' using errcode = '22023';
    end if;
    v_piece := (p_ecriture ->> 'piece_citee_id')::uuid;
  end if;

  -- 9. La version lue : celle de l'écriture que la saisie remplace, sous son verrou ; aucune pour une nouvelle. Une écriture
  --    dont l'exercice est validé, ou dont une ligne l'est, ne change plus.
  if p_ecriture -> 'id' is not null and jsonb_typeof(p_ecriture -> 'id') <> 'null' then
    if coalesce(p_ecriture ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception '%', 'Cette écriture libre a changé depuis sa lecture : relire les écritures avant de l’écrire.' using errcode = '40001';
    end if;
    v_id := (p_ecriture ->> 'id')::uuid;
    select * into v_ancienne from public.ecritures_libres e where e.id = v_id and e.dossier_id = p_dossier_id for update;
    if not found or p_version_lue is null or p_version_lue <> v_ancienne.version then
      raise exception '%', 'Cette écriture libre a changé depuis sa lecture : relire les écritures avant de l’écrire.' using errcode = '40001';
    end if;
    if (v_frontiere is not null and v_ancienne.date <= v_frontiere)
       or exists (select 1 from public.ecritures_brouillon b where b.ecriture_libre_id = v_id and b.statut <> 'proposee') then
      raise exception '%', 'Cette date est dans un exercice validé : une écriture libre ne s’y passe plus.' using errcode = '23514';
    end if;
  elsif p_version_lue is not null then
    raise exception '%', 'Une écriture libre nouvelle ne porte pas de version lue.' using errcode = '22023';
  end if;

  -- 10. Les écritures : la constatation à sa date et, si elle est demandée, l'extourne au 1er janvier suivant, chaque ligne au
  --     sens inverse ; recomposées en entiers et comparées en MULTIENSEMBLE à ce que l'application propose (date, compte, sens,
  --     centimes) ; le journal OD ; le libellé de l'écriture, et « Extourne — » devant celui de l'extourne.
  v_lendemain := v_date + 1;
  select coalesce(jsonb_agg(x.ligne order by x.rang), '[]'::jsonb) into v_attendues from (
    select l.r as rang, jsonb_build_object('date', to_char(v_date, 'YYYY-MM-DD'), 'compte', l.v ->> 'compte', 'sens', l.v ->> 'sens',
                                           'centimes', (l.v ->> 'centimes')::bigint) as ligne
      from jsonb_array_elements(v_lignes) with ordinality as l(v, r)
    union all
    select 1000 + l.r, jsonb_build_object('date', to_char(v_lendemain, 'YYYY-MM-DD'), 'compte', l.v ->> 'compte',
                                          'sens', case l.v ->> 'sens' when 'debit' then 'credit' else 'debit' end,
                                          'centimes', (l.v ->> 'centimes')::bigint)
      from jsonb_array_elements(v_lignes) with ordinality as l(v, r) where v_extourne) x;
  v_conforme := jsonb_typeof(p_ecritures) = 'array' and jsonb_array_length(p_ecritures) = case when v_extourne then 2 else 1 end
    and not exists (select 1 from jsonb_array_elements(p_ecritures) e(v)
                     where jsonb_typeof(e.v) is distinct from 'object' or e.v ->> 'journal' is distinct from 'OD'
                        or not ((e.v ->> 'date' = to_char(v_date, 'YYYY-MM-DD') and e.v ->> 'libelle' = v_libelle)
                                or (v_extourne and e.v ->> 'date' = to_char(v_lendemain, 'YYYY-MM-DD')
                                    and e.v ->> 'libelle' = 'Extourne — ' || v_libelle)))
    and (select count(distinct e.v ->> 'date') from jsonb_array_elements(p_ecritures) e(v)) = case when v_extourne then 2 else 1 end;
  if v_conforme then
    with recues as (
      select e.v ->> 'date' as d, l.v ->> 'compte' as compte, l.v ->> 'sens' as sens, public.ecriture_libre_entier(l.v -> 'centimes') as centimes
        from jsonb_array_elements(p_ecritures) e(v)
        cross join lateral jsonb_array_elements(case when jsonb_typeof(e.v -> 'lignes') = 'array' then e.v -> 'lignes' else '[]'::jsonb end) l(v)
    ), attendues as (
      select a.v ->> 'date' as d, a.v ->> 'compte' as compte, a.v ->> 'sens' as sens, (a.v ->> 'centimes')::bigint as centimes
        from jsonb_array_elements(v_attendues) a(v)
    )
    select (select count(*) from recues) = (select count(*) from attendues)
       and not exists (select d, compte, sens, centimes from attendues except all select d, compte, sens, centimes from recues)
      into v_conforme;
  end if;
  if not coalesce(v_conforme, false) then
    raise exception '%', 'Les écritures proposées ne sont pas celles de l’écriture libre : les recomposer.' using errcode = '22023';
  end if;

  -- 11. Le numéro : le suivant de son dossier et de son année, sous un verrou propre au dossier (deux enregistrements
  --     simultanés ne prennent pas le même) ; gardé quand l'écriture remplacée reste dans son année.
  perform pg_advisory_xact_lock(hashtextextended('ecritures_libres:' || p_dossier_id::text, 0));
  if v_id is not null and v_ancienne.exercice = extract(year from v_date)::integer then
    v_numero := v_ancienne.numero;
  else
    select coalesce(max(e.numero), 0) + 1 into v_numero from public.ecritures_libres e
     where e.dossier_id = p_dossier_id and e.exercice = extract(year from v_date)::integer;
  end if;

  -- 12. L'écriture, puis ses lignes au brouillon, par la porte que la garde ouvre à ce dossier seul.
  perform set_config('jd.ecriture_libre', p_dossier_id::text, true);
  if v_id is null then
    insert into public.ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, avec_extourne, piece_citee_id,
                                         version, cree_par)
    values (p_dossier_id, extract(year from v_date)::integer, v_numero, v_date, v_libelle, v_motif, v_lignes, v_extourne, v_piece,
            1, auth.uid())
    returning id into v_id;
  else
    delete from public.ecritures_brouillon b where b.ecriture_libre_id = v_id;
    update public.ecritures_libres e
       set exercice = extract(year from v_date)::integer, numero = v_numero, date = v_date, libelle = v_libelle, motif = v_motif,
           lignes = v_lignes, avec_extourne = v_extourne, piece_citee_id = v_piece, version = e.version + 1,
           modifie_par = auth.uid(), modifie_le = now()
     where e.id = v_id;
  end if;
  insert into public.ecritures_brouillon (dossier_id, ecriture_libre_id, date, compte, libelle, montant, sens, statut)
  select p_dossier_id, v_id, (a.v ->> 'date')::date, a.v ->> 'compte',
         case when (a.v ->> 'date')::date = v_date then v_libelle else 'Extourne — ' || v_libelle end,
         round(((a.v ->> 'centimes')::numeric) / 100, 2), a.v ->> 'sens', 'proposee'
    from jsonb_array_elements(v_attendues) with ordinality as a(v, rang) order by a.rang;
  select count(*) into v_desequilibre from (
    select b.date from public.ecritures_brouillon b where b.ecriture_libre_id = v_id
     group by b.date having sum(case when b.sens = 'debit' then b.montant else -b.montant end) <> 0) x;
  if v_desequilibre > 0 then
    raise exception 'Écriture libre déséquilibrée.' using errcode = '23514';
  end if;
  perform set_config('jd.ecriture_libre', '', true);
  return v_id;
end
$fonction$;
revoke execute on function public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer) from public, anon;
grant execute on function public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer) to authenticated;
comment on function public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer) is
  'EL2 (conception 54) : enregistre ou remplace une écriture libre et ses lignes au brouillon (et son extourne au 1er janvier suivant), recomposées en entiers et comparées à celles que l''application propose. Tout compte du cabinet qui suit le dossier (EL-Q1).';

-- ══ 6. Retirer une écriture libre, et son extourne ══
-- Les refus : l'accès, le gel (une ligne validée compris), la version lue. Rend le nombre de lignes retirées.
create function public.retirer_ecriture_libre(p_id uuid, p_version_lue integer)
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_dossier_id uuid;
  v_ecriture public.ecritures_libres%rowtype;
  v_frontiere date;
  v_lignes integer;
begin
  select e.dossier_id into v_dossier_id from public.ecritures_libres e where e.id = p_id;
  if p_id is null or v_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(v_dossier_id), false) then
    raise exception 'Accès refusé à cette écriture libre.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_dossier_id));
  select * into v_ecriture from public.ecritures_libres e where e.id = p_id for update;
  if not found then
    raise exception '%', 'Cette écriture libre a changé depuis sa lecture : relire les écritures avant de l’écrire.' using errcode = '40001';
  end if;
  v_frontiere := public.frontiere_validation(v_dossier_id);
  if (v_frontiere is not null and v_ecriture.date <= v_frontiere)
     or exists (select 1 from public.ecritures_brouillon b where b.ecriture_libre_id = p_id and b.statut <> 'proposee') then
    raise exception '%', 'Cette date est dans un exercice validé : une écriture libre ne s’y passe plus.' using errcode = '23514';
  end if;
  if p_version_lue is null or p_version_lue <> v_ecriture.version then
    raise exception '%', 'Cette écriture libre a changé depuis sa lecture : relire les écritures avant de l’écrire.' using errcode = '40001';
  end if;
  perform set_config('jd.ecriture_libre', v_dossier_id::text, true);
  delete from public.ecritures_brouillon b where b.ecriture_libre_id = p_id;
  get diagnostics v_lignes = row_count;
  delete from public.ecritures_libres e where e.id = p_id;
  perform set_config('jd.ecriture_libre', '', true);
  return v_lignes;
end
$fonction$;
revoke execute on function public.retirer_ecriture_libre(uuid, integer) from public, anon;
grant execute on function public.retirer_ecriture_libre(uuid, integer) to authenticated;
comment on function public.retirer_ecriture_libre(uuid, integer) is
  'EL2 (conception 54) : retire une écriture libre et ses lignes au brouillon (son extourne comprise), tant que son exercice n''est pas figé, contre la version lue. Tout compte du cabinet qui suit le dossier (EL-Q1).';

-- ══ 7. La double authentification exigée, si elle est déjà en base ══
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.ecritures_libres as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;

-- ══ 8. La porte d'accès devant les gardes (acces_avant_les_gardes, ligne 43), si elle est déjà en base ══
-- La garde `security definer` de cette migration sur sa table neuve : `garder_ecritures_libres` (celle du brouillon,
-- `garder_ecriture_libre_du_brouillon`, est derrière la porte d'`ecritures_brouillon`). Une garde `security definer` tire
-- avant l'expression WITH CHECK de la policy : sans la porte, elle répondrait à un appelant que la policy refuse. La porte est
-- en base depuis le 15/11/2026 (GARDES-Q1) : elle se pose ici, la première des déclencheurs BEFORE de la table. L'essai :
-- supabase/essais/accesAvantLesGardes.sql (étape 32), et supabase/essais/ecrituresLibres.sql.
do $porte$
declare
  v_table text;
begin
  if to_regprocedure('public.acces_avant_les_gardes()') is not null then
    foreach v_table in array array['ecritures_libres'] loop
      if exists (select 1 from pg_catalog.pg_class c where c.oid = ('public.' || v_table)::regclass and not (c.relrowsecurity and not c.relforcerowsecurity))
         or exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = ('public.' || v_table)::regclass and not t.tgisinternal
                     and (t.tgname collate "C") < ('_acces_avant_les_gardes' collate "C")) then
        raise exception 'La porte d''accès ne se pose pas sur public.% : sa RLS n''est pas active (ou forcée), ou un déclencheur tirerait avant elle.', v_table;
      end if;
      if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = ('public.' || v_table)::regclass and t.tgname = '_acces_avant_les_gardes') then
        execute format('create trigger _acces_avant_les_gardes before insert or update on public.%I for each row execute function public.acces_avant_les_gardes()', v_table);
      end if;
    end loop;
  end if;
end
$porte$;
