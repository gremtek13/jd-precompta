-- L'ACOMPTE D'UN DEVIS, EN BASE (espace client, étape P5b2 ; EC-D3) — PRÉPARÉE, PAS APPLIQUÉE. La conception : HISTORIQUE.md,
-- « L'ACOMPTE D'UN DEVIS : LA CONCEPTION (P5B) » (LA FACTURE D'ACOMPTE, LA FINALE, LA BASE), « L'ACOMPTE D'UN DEVIS : LE
-- MODULE PUR (P5B1) » et « L'ACOMPTE D'UN DEVIS NE COUVRE JAMAIS TOUT LE DEVIS (P5B-Q5, SUR LA RECOMMANDATION) » ; le récit :
-- « L'ACOMPTE D'UN DEVIS, EN BASE (P5B2) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- POURQUOI. Un devis accepté peut appeler un acompte (CGI, art. 289, I-1-c : l'acompte versé avant l'opération se facture ;
-- BOI-TVA-DECLA-30-20-20-10, § 60 : numérotée comme toute facture, « la facture définitive doit faire référence aux
-- différentes factures d'acomptes » ; § 160 : la date du versement, si elle diffère). La facture FINALE reprend chaque
-- acompte en ligne, au signe opposé (annexe 1 v1.2 des spécifications externes de la DGFiP, EXT-FR-FE-BG-06) : la TVA
-- facturée est due (art. 283, 3), la reprise en est l'opposé EXACT, et aucune TVA ne se facture deux fois. Le module
-- src/lib/acompteDevis.ts calcule l'acompte et la finale ; la base REFAIT ces calculs en entiers et refuse, dans le même
-- ordre et sous les mêmes mots (`REFUS_ACOMPTE`, le dépassement du reste, `refusDeTvaNegative`, `refusDeLaFinale`).
--
-- CE QU'ELLE POSE :
--   1. `factures_emises.acompte` (faux par défaut ; une facture, jamais un avoir) et `date_versement_acompte` (BT-9 : connue
--      et autre que la date de la facture, sinon nulle), FIGÉES avec la facture validée par la garde d'hier ;
--      `facture_lignes.reprise_facture_id`, la facture d'acompte VALIDÉE que la ligne reprend — sans action à la suppression :
--      une facture validée ne se supprime qu'avec son dossier, qui emporte aussi la ligne qui la reprend (ni cascade, qui
--      tairait une reprise, ni mise à nul, qui laisserait une ligne négative sans ce qu'elle reprend) ; son index ;
--      `devis_factures.role` (« acompte », « finale » ; les liens d'hier, et ceux d'une sauvegarde d'avant, sont des
--      finales), jugé par la garde des liens : « acompte » si et seulement si la facture est marquée ;
--   2. deux gardes neuves : la marque et la date du versement ne se posent que par les fonctions (l'annonce
--      `jd.acompte_facture`), à l'insertion par la seule restauration ; les lignes d'un acompte en brouillon ne se
--      retouchent pas, et une reprise ne s'écrit que sous l'annonce `jd.reprises_facture` de sa facture, ou par la
--      restauration — le super-administrateur dans un dossier sans série (`restauration_des_factures`), comme les autres ;
--   3. `facturer_acompte_devis` (le droit : `gere_les_ventes`, comme `facturer_devis` ; le devis verrouillé) : un brouillon
--      de facture d'acompte, série F, ses lignes calculées comme le module — la cible d'un pourcentage sur son décimal
--      exact, le demi loin de zéro ; celle d'un TTC, le HT dont le TTC réparti est le plus proche, à égalité le plus petit,
--      cherché dans la fenêtre du module ; la répartition au prorata du RESTE par les plus forts restes, à égalité dans
--      l'ordre du devis ; une ligne par groupe (taux, nature), quantité 1 ;
--   4. `facturer_devis` remplacée : la FINALE — les lignes du devis, puis chaque ligne de chaque acompte en vigueur
--      (validé, non crédité) au signe opposé, « Reprise de l’acompte F… du JJ/MM/AAAA » ; une finale créditée en entier par
--      un avoir laisse tirer une nouvelle finale (P5B-Q4) ; un acompte en brouillon la retient ;
--   5. `enregistrer_facture` remplacée : un acompte en brouillon garde ses lignes et ses montants, sa date du versement se
--      retouche ; une reprise se pose sur la finale de son devis ou se défait sur l'avoir de celle-ci, chacune une fois ; à
--      la validation, sous le verrou du devis, le cumul des acomptes ne dépasse aucun groupe, un acompte satisfait P5B-Q5,
--      une finale reprend chaque acompte en vigueur exactement et une seule fois et n'est négative à aucun taux (HT, puis
--      TVA) ; l'avoir d'un acompte le crédite en entier tant qu'aucune finale validée et non créditée ne le reprend ; celui
--      d'une finale peut défaire ses reprises ; `garder_devis_facture` remplacée (le rôle du lien) ;
--   6. six fonctions d'appoint, exécutées par aucun rôle de l'API : `acompte_en_euros`, `acompte_en_taux` (les écritures
--      du module), `acomptes_en_vigueur`, `finale_active_du_devis`, `acompte_repartir_sur_les_restes`,
--      `acompte_refus_de_la_finale_laissee`.
--
-- CE QU'ELLE NE FAIT PAS : aucune policy ne change ; aucune donnée d'hier n'est réécrite (les colonnes neuves naissent à
-- leur défaut, sans déclencheur) ; ni écran, ni Edge Function, ni moteur (CA3, « Encaissée », CDAR : étape P5b3) ; le CII
-- et l'aperçu (P5b4). Les refus d'hier gardent leur ordre et leurs mots : les jugements neufs viennent après eux.
-- CE QUE LE TEXTE RETIRE : rien. Mais le corps d'`enregistrer_facture`, recopié, remplace les lignes d'un brouillon par une
-- instruction de retrait de lignes, et l'événement des déclencheurs nomme ce retrait : le détecteur d'`apply_migration` la
-- retiendrait — elle se COLLE dans l'éditeur SQL, avec sa ligne d'historique (CLAUDE.md, « Quand `apply_migration` attend
-- une confirmation »).
-- CE QU'ELLE SUPPOSE, que son premier bloc vérifie : les trois migrations des devis (`devis_du_client`,
-- `devis_du_client_suppression`, `envoi_des_devis`), le modèle comptable du dossier, et `facturer_devis`,
-- `enregistrer_facture` et `garder_devis_facture` telles que la production les porte le 05/11/2026 (leurs empreintes) ;
-- et qu'elle ne soit pas déjà en base.
-- SON RETOUR : supabase/preparees/retour/20261105110000_retour_acomptes_des_devis.sql, qui se refuse dès qu'un acompte, une
-- reprise ou un lien « acompte » existe. SON ESSAI : supabase/essais/acomptesDesDevis.sql. LE PLAN DE SAUVEGARDE : la
-- relation de la reprise derrière `ACOMPTES_PREVUS` (src/lib/devis.ts), à lever le jour où l'export porte ce fichier.
--
-- Ni barre oblique inverse, ni retour chariot. VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne
-- d'historique.

-- ══ 0. Ce qu'elle suppose ══════════
do $garde$
begin
  if to_regclass('public.devis') is null or to_regclass('public.devis_factures') is null
     or to_regprocedure('public.supprimer_brouillon_devis(uuid, uuid)') is null then
    raise exception 'Les migrations des devis (devis_du_client, devis_du_client_suppression) ne sont pas en base : cette migration les suppose.';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.emails_envoyes'::regclass and attname = 'devis_id'
                  and not attisdropped) then
    raise exception 'La migration envoi_des_devis n''est pas en base : cette migration la suppose.';
  end if;
  if to_regprocedure('public.centimes_ligne_facture(numeric, numeric, numeric, boolean)') is null
     or to_regprocedure('public.emetteur_du_dossier(text, text, text, text)') is null
     or to_regprocedure('public.restauration_des_factures(uuid)') is null
     or to_regprocedure('public.gere_les_ventes(uuid)') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.dossiers'::regclass and attname = 'mode_comptable'
                     and not attisdropped) then
    raise exception 'Une fonction ou une colonne que l''acompte suppose manque (centimes_ligne_facture, emetteur_du_dossier, restauration_des_factures, gere_les_ventes, dossiers.mode_comptable) : relire la base.';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass and attname = 'acompte'
              and not attisdropped)
     or to_regprocedure('public.facturer_acompte_devis(uuid, uuid, jsonb, date)') is not null then
    raise exception 'La migration acomptes_des_devis est déjà en base.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.facturer_devis(uuid, uuid)'))
       is distinct from 'bf74bb607c40e5b6efb9edcfedf16cfe'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean)'))
       is distinct from 'fe4b55352f03275048db1a230d93dd72'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.garder_devis_facture()'))
       is distinct from '918033a41241bf16e6887fc02b9b5ccd' then
    raise exception 'facturer_devis, enregistrer_facture ou garder_devis_facture n''est plus celle que cette migration remplace (empreintes de la production du 05/11/2026) : la relire contre la base avant de l''appliquer.';
  end if;
end
$garde$;

-- ══ 1. La marque, la date du versement, la reprise, le rôle du lien ══════════
alter table public.factures_emises
  add column acompte boolean not null default false,
  add column date_versement_acompte date,
  add constraint factures_emises_acompte_d_une_facture check (not acompte or type = 'facture'),
  add constraint factures_emises_versement_d_un_acompte check (date_versement_acompte is null
    or (acompte and date_versement_acompte <> date_emission));

-- Sans action à la suppression : la facture reprise est validée, et ne part qu'avec son dossier, qui emporte la reprise.
alter table public.facture_lignes
  add column reprise_facture_id uuid references public.factures_emises (id);

create index facture_lignes_reprise_facture_id_idx on public.facture_lignes (reprise_facture_id);

alter table public.devis_factures
  add column role text not null default 'finale',
  add constraint devis_factures_role_check check (role in ('acompte', 'finale'));

comment on column public.factures_emises.acompte is
  'Facture d''acompte d''un devis accepté (CII 386) : posée par facturer_acompte_devis seule, figée avec la facture.';
comment on column public.factures_emises.date_versement_acompte is
  'La date du versement de l''acompte (BT-9), connue et autre que la date de la facture ; sinon nulle.';
comment on column public.facture_lignes.reprise_facture_id is
  'La facture d''acompte validée que cette ligne reprend (la facture finale, quantité -1) ou dont elle défait la reprise (l''avoir de la finale, quantité 1).';
comment on column public.devis_factures.role is
  'acompte : une facture d''acompte du devis ; finale : la facture qui le solde en reprenant ses acomptes (les liens d''avant les acomptes).';

-- ══ 2. Les fonctions d'appoint ══════════
-- Les montants et les taux tels que le module les écrit (`enEuros`, `enTaux`) : des textes figés dans une désignation ou
-- un refus, écrits à la main plutôt que selon une locale.
create function public.acompte_en_euros(p_centimes numeric) returns text
language sql
immutable
set search_path = public
as $$
  select case when p_centimes < 0 then '-' else '' end
    || replace(to_char(div(abs(p_centimes), 100), 'FM999,999,999,999,999,999,990'), ',', ' ')
    || ',' || lpad(mod(abs(p_centimes), 100)::text, 2, '0') || ' €'
$$;

create function public.acompte_en_taux(p_taux numeric) returns text
language sql
immutable
set search_path = public
as $$
  select replace(trim_scale(p_taux)::text, '.', ',') || ' %'
$$;

-- Les acomptes EN VIGUEUR d'un devis : ses factures d'acompte validées qu'aucun avoir ne crédite (l'avoir d'un acompte le
-- crédite en entier), dans l'ordre de leurs dates puis de leurs numéros.
create function public.acomptes_en_vigueur(p_devis_id uuid)
returns table (facture_id uuid, numero text, date_emission date, rang bigint)
language sql
stable
set search_path = public
as $$
  select f.id, f.numero, f.date_emission,
         row_number() over (order by f.date_emission, f.numero collate "C", f.id)
    from public.devis_factures l
    join public.factures_emises f on f.id = l.facture_id
   where l.devis_id = p_devis_id and l.role = 'acompte' and f.acompte and f.statut = 'validee'
     and not exists (select 1 from public.factures_emises a where a.facture_origine_id = f.id and a.type = 'avoir')
$$;

-- La facture finale ACTIVE d'un devis : en brouillon, ou validée et pas créditée en entier (P5B-Q4).
create function public.finale_active_du_devis(p_devis_id uuid)
returns table (facture_id uuid, numero text, cree_le timestamptz, lien_id uuid)
language sql
stable
set search_path = public
as $$
  select f.id, f.numero, l.cree_le, l.id
    from public.devis_factures l
    join public.factures_emises f on f.id = l.facture_id
   where l.devis_id = p_devis_id and l.role = 'finale'
     and (f.statut <> 'validee'
          or coalesce((select sum(-a.montant_ttc) from public.factures_emises a
                        where a.facture_origine_id = f.id and a.type = 'avoir'), 0) < f.montant_ttc)
$$;

-- `repartirSurLesRestes` : chaque groupe reçoit la partie entière de cible × reste / reste total, puis les centimes qui
-- manquent vont aux plus forts restes de la division, à égalité dans l'ordre du devis ; aucune part ne dépasse son reste.
create function public.acompte_repartir_sur_les_restes(p_cible bigint, p_restes bigint[])
returns bigint[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_n integer := coalesce(array_length(p_restes, 1), 0);
  v_total numeric := 0;
  v_parts bigint[] := '{}';
  v_manque bigint;
  v_i integer;
  r record;
begin
  for v_i in 1 .. v_n loop
    v_total := v_total + p_restes[v_i];
  end loop;
  if p_cible is null or p_cible < 0 or p_cible > v_total then
    raise exception 'La cible de % centimes ne se répartit pas sur un reste de % centimes.', p_cible, v_total
      using errcode = '22023';
  end if;
  for v_i in 1 .. v_n loop
    v_parts := v_parts || case when p_cible = 0 then 0::bigint else div(p_cible::numeric * p_restes[v_i], v_total)::bigint end;
  end loop;
  if p_cible = 0 then
    return v_parts;
  end if;
  v_manque := p_cible;
  for v_i in 1 .. v_n loop
    v_manque := v_manque - v_parts[v_i];
  end loop;
  for r in select s.i from generate_series(1, v_n) as s(i)
            order by mod(p_cible::numeric * p_restes[s.i], v_total) desc, s.i loop
    exit when v_manque = 0;
    v_parts[r.i] := v_parts[r.i] + 1;
    v_manque := v_manque - 1;
  end loop;
  for v_i in 1 .. v_n loop
    if v_parts[v_i] > p_restes[v_i] then
      raise exception 'La part de % centimes dépasse le reste de % centimes.', v_parts[v_i], p_restes[v_i] using errcode = '22023';
    end if;
  end loop;
  return v_parts;
end
$$;

-- P5B-Q5 : la finale que laisserait un acompte (ses lignes, `p_lignes`, prix et taux), s'il était validé — les lignes du
-- devis, les reprises des acomptes en vigueur, puis les siennes — ne couvre pas zéro à tous les taux, ni ne porte une TVA
-- négative à un taux (le premier dans l'ordre du devis). Rend le refus du module, ou nul.
create function public.acompte_refus_de_la_finale_laissee(p_devis_id uuid, p_lignes jsonb)
returns text
language sql
stable
set search_path = public
as $$
  with lignes as (
    select 1 as source, l.ord as rang, coalesce((l.valeur->>'taux_tva')::numeric, 0) as taux, c.ht_centimes as ht,
           c.tva_centimes as tva
      from public.devis d
     cross join lateral jsonb_array_elements(d.lignes) with ordinality as l(valeur, ord)
     cross join lateral public.centimes_ligne_facture(coalesce((l.valeur->>'quantite')::numeric, 0),
       coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0), coalesce((l.valeur->>'taux_tva')::numeric, 0), false) c
     where d.id = p_devis_id
    union all
    select 2, a.rang * 1000000 + fl.ordre, fl.taux_tva, c.ht_centimes, c.tva_centimes
      from public.acomptes_en_vigueur(p_devis_id) a
      join public.facture_lignes fl on fl.facture_id = a.facture_id
     cross join lateral public.centimes_ligne_facture(-1, fl.prix_unitaire_ht, fl.taux_tva, false) c
    union all
    select 3, l.ord, coalesce((l.valeur->>'taux_tva')::numeric, 0), c.ht_centimes, c.tva_centimes
      from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord)
     cross join lateral public.centimes_ligne_facture(-1, coalesce((l.valeur->>'prix_unitaire_ht')::numeric, 0),
       coalesce((l.valeur->>'taux_tva')::numeric, 0), false) c
  ), par_taux as (
    select x.taux, min(x.source * 1000000000000 + x.rang) as premier, sum(x.ht) as ht, sum(x.tva) as tva
      from lignes x
     group by x.taux
  )
  select case
    when not exists (select 1 from par_taux t where t.ht <> 0) then
      'L’acompte couvrirait tout ce qui reste du devis : le solde se facture par la facture finale, jamais par un acompte.'
    else (select 'L’acompte laisserait une TVA négative à la facture finale (' || public.acompte_en_euros(t.tva) || ' à '
                 || public.acompte_en_taux(t.taux) || ') : la TVA du devis s’arrondit ligne par ligne, celle de l’acompte sur '
                 || 'sa part. Demandez un peu moins, ou tirez la facture finale.'
            from par_taux t where t.tva < 0 order by t.premier limit 1)
  end
$$;

-- ══ 3. Les gardes ══════════
-- DEFINER pour juger la restauration (`restauration_des_factures`) quelle que soit la RLS de qui écrit. Après la garde des
-- factures validées (l'ordre des noms) : sur une facture validée, son refus parle le premier.
create function public.garder_marque_d_acompte() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (new.acompte or new.date_versement_acompte is not null)
       and not public.restauration_des_factures(new.dossier_id) then
      raise exception 'Une facture ne naît pas facture d’acompte : elle se tire d’un devis accepté par facturer_acompte_devis.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.acompte is distinct from old.acompte or new.date_versement_acompte is distinct from old.date_versement_acompte)
     and coalesce(current_setting('jd.acompte_facture', true), '') is distinct from new.id::text then
    raise exception 'La marque d’acompte d’une facture et la date du versement ne se posent que par facturer_acompte_devis et enregistrer_facture.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger factures_emises_marque_d_acompte before insert or update on public.factures_emises
  for each row execute function public.garder_marque_d_acompte();

-- Les lignes d'un acompte en brouillon se calculent du devis : aucune ne s'écrit, ne change ni ne part, sauf avec la
-- facture (son brouillon supprimé, son dossier) — sa ligne ne la voit alors plus. Une reprise ne s'écrit que sous
-- l'annonce de sa facture (`jd.reprises_facture`, posée par facturer_devis et enregistrer_facture), ou par la
-- restauration. Après la garde des lignes figées (l'ordre des noms).
create function public.garder_lignes_d_acompte() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_facture public.factures_emises;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select f.* into v_facture from public.factures_emises f where f.id = old.facture_id;
    if found and v_facture.acompte and v_facture.statut <> 'validee' then
      raise exception 'Les lignes d’une facture d’acompte se calculent du devis : elles ne se retouchent pas.'
        using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  select f.* into v_facture from public.factures_emises f where f.id = new.facture_id;
  if found and v_facture.acompte and v_facture.statut <> 'validee'
     and not (tg_op = 'INSERT' and public.restauration_des_factures(v_facture.dossier_id)) then
    raise exception 'Les lignes d’une facture d’acompte se calculent du devis : elles ne se retouchent pas.'
      using errcode = '42501';
  end if;
  if ((tg_op = 'INSERT' and new.reprise_facture_id is not null)
      or (tg_op = 'UPDATE' and new.reprise_facture_id is distinct from old.reprise_facture_id))
     and coalesce(current_setting('jd.reprises_facture', true), '') is distinct from new.facture_id::text
     and not (tg_op = 'INSERT' and public.restauration_des_factures(v_facture.dossier_id)) then
    raise exception 'Une ligne ne reprend un acompte que par facturer_devis ou enregistrer_facture.' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger facture_lignes_gardes_d_acompte before insert or update or delete on public.facture_lignes
  for each row execute function public.garder_lignes_d_acompte();

-- La garde des liens, son rôle en plus : « acompte » si et seulement si la facture est marquée.
create or replace function public.garder_devis_facture() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.devis d
                    where d.id = new.devis_id and d.dossier_id = new.dossier_id
                      and d.statut = 'emis' and d.reponse = 'acceptee') then
      raise exception 'Une facture se tire d''un devis accepté de son dossier.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.factures_emises f
                    where f.id = new.facture_id and f.dossier_id = new.dossier_id and f.type = 'facture') then
      raise exception 'Le lien d''un devis vise une facture de son dossier, jamais un avoir.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.factures_emises f
                    where f.id = new.facture_id and f.acompte = (new.role = 'acompte')) then
      raise exception 'Le lien d’un devis à une facture d’acompte porte le rôle « acompte », celui d’une autre facture le rôle « finale ».'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Le lien d''un devis à sa facture ne change pas.' using errcode = '23514';
  end if;

  if not exists (select 1 from public.factures_emises f where f.id = old.facture_id)
     or not exists (select 1 from public.devis d where d.id = old.devis_id)
     or not exists (select 1 from public.dossiers x where x.id = old.dossier_id) then
    return old;
  end if;
  raise exception 'Le lien d''un devis à sa facture ne part qu''avec la facture, le devis ou le dossier.' using errcode = '23514';
end;
$$;

-- ══ 4. La facture d'acompte ══════════
-- Un BROUILLON, par `enregistrer_facture` sous l'identité de l'appelant (ses refus d'aujourd'hui s'appliquent), daté du
-- jour à Paris, le client et l'émetteur du jour comme la facture tirée d'un devis ; puis la marque, la date du versement
-- (nulle si c'est celle de la facture) et le lien « acompte ». `p_demande` est la `DemandeAcompte` du module :
-- {"mode": "pourcentage", "pourcentage": …} ou {"mode": "ttc", "ttcCentimes": …}. Rend la facture.
create function public.facturer_acompte_devis(p_dossier_id uuid, p_devis_id uuid, p_demande jsonb, p_date_versement date)
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

  -- 7. Le brouillon, la marque, le lien.
  select e.* into v_emetteur
    from public.emetteur_du_dossier(v_dossier.nom, v_dossier.denomination_imprimee, v_dossier.siret, v_dossier.adresse) e;
  select e.facture_id into v_facture
    from public.enregistrer_facture(p_dossier_id, null, jsonb_build_object(
      'tiers_nom', v_devis.tiers_nom,
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

-- ══ 5. La facture finale ══════════
-- Celle d'hier (`devis_du_client`), qui reprend désormais les acomptes en vigueur : leurs lignes au signe opposé, après
-- celles du devis, les montants du devis diminués d'autant (inchangés sans acompte) ; la reprise posée sous l'annonce de
-- la facture, ligne par ligne (`ordre`). « A déjà sa facture » ne vise plus qu'une finale ACTIVE : une finale créditée en
-- entier laisse tirer une nouvelle finale (P5B-Q4). Un acompte en brouillon la retient.
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

-- ══ 6. L'enregistrement d'une facture ══════════
-- Celle de la production du 05/11/2026 (correction de la facture, FACTURE-Q1), recopiée au caractère près hors de ses
-- ajouts, que signale « P5b2 » ; ses deux fins de ligne et ses blancs écrits par `chr` plutôt que par des échappements.
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
    if v_origine.type <> 'facture' or v_origine.statut <> 'validee' then
      raise exception 'Un avoir corrige une facture validée, jamais un brouillon ni un autre avoir.' using errcode = '22023';
    end if;
    if v_date_emission < v_origine.date_emission then
      raise exception 'Un avoir ne précède pas la facture qu''il corrige (émise le %).',
        to_char(v_origine.date_emission, 'DD/MM/YYYY') using errcode = '22023';
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
$function$;

-- ══ 7. Les droits ══════════
-- La facture d'acompte : le cabinet et le client « Ventes », qu'elle juge elle-même ; jamais l'anonyme ni PUBLIC. Les
-- fonctions d'appoint et les deux gardes : aucun rôle de l'API (un déclencheur n'a pas besoin du droit d'exécuter).
revoke execute on function public.facturer_acompte_devis(uuid, uuid, jsonb, date) from public, anon;
grant execute on function public.facturer_acompte_devis(uuid, uuid, jsonb, date) to authenticated;
revoke execute on function public.acompte_en_euros(numeric) from public, anon, authenticated;
revoke execute on function public.acompte_en_taux(numeric) from public, anon, authenticated;
revoke execute on function public.acomptes_en_vigueur(uuid) from public, anon, authenticated;
revoke execute on function public.finale_active_du_devis(uuid) from public, anon, authenticated;
revoke execute on function public.acompte_repartir_sur_les_restes(bigint, bigint[]) from public, anon, authenticated;
revoke execute on function public.acompte_refus_de_la_finale_laissee(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.garder_marque_d_acompte() from public, anon, authenticated;
revoke execute on function public.garder_lignes_d_acompte() from public, anon, authenticated;

comment on function public.facturer_acompte_devis(uuid, uuid, jsonb, date) is
  'Tire d''un devis accepté un brouillon de facture d''acompte (un pourcentage ou un TTC, réparti au prorata du reste par les plus forts restes ; src/lib/acompteDevis.ts), par enregistrer_facture sous l''identité de l''appelant, marqué et lié (rôle acompte). Pour le cabinet du dossier ou un accès « Ventes » (42501). Rend la facture.';
comment on function public.facturer_devis(uuid, uuid) is
  'Tire d''un devis accepté sa facture finale, brouillon : les lignes du devis, puis chaque ligne de chaque acompte en vigueur au signe opposé (reprise_facture_id), par enregistrer_facture sous l''identité de l''appelant, l''émetteur du jour (emetteur_du_dossier) ; pose le lien (rôle finale). Une finale active à la fois ; un acompte en brouillon la retient. Pour le cabinet du dossier ou un accès « Ventes » (42501). Rend la facture.';
comment on function public.garder_devis_facture() is
  'Le lien d''un devis accepté de son dossier à une facture de ce dossier, jamais un avoir, au rôle « acompte » si et seulement si la facture est marquée ; il ne change pas, et part avec la facture, le devis ou le dossier (déclencheur devis_factures_gardes).';
comment on function public.garder_marque_d_acompte() is
  'La marque d''acompte et la date du versement ne se posent que par facturer_acompte_devis et enregistrer_facture (réglage jd.acompte_facture) ; à l''insertion, par la restauration seule (déclencheur factures_emises_marque_d_acompte).';
comment on function public.garder_lignes_d_acompte() is
  'Les lignes d''un acompte en brouillon ne se retouchent pas ; une reprise ne s''écrit que sous le réglage jd.reprises_facture de sa facture, ou par la restauration (déclencheur facture_lignes_gardes_d_acompte).';
