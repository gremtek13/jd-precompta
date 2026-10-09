-- LE CYCLE DE VIE DES FACTURES ÉMISES, LU SUR LA PLATEFORME DU CLIENT (ligne 28.5, étape d, septième temps : d7).
--
-- Une facture émise reçoit, sur la plateforme qui l'a acceptée, les statuts de son cycle de vie : 200 Déposée, 210
-- Refusée, 212 Encaissée et 213 Rejetée sont obligatoires, 201 à 209 et 211 facultatifs (spécifications externes de la
-- DGFiP v3.2, dossier général, § 3.6.4, tableau 8). « Dans les cas des statuts Refusée ou Rejetée, le fournisseur doit
-- procéder à une annulation comptable (avoir interne). Cette opération ne doit pas générer de flux de données
-- réglementaires » (même paragraphe). L'application lisait ces refus chez Super PDP (`facture_superpdp_events`), pas
-- sur la plateforme du client : un statut « Encaissée » pouvait y suivre une facture refusée. Décision du cabinet du
-- 08/10/2026 (Q7) : les lire avant d'ouvrir l'envoi du statut par API. La fonction plateforme-agreee les lit sur un
-- clic (`flowType` CustomerInvoiceLC, sens In, description OpenAPI publique du connecteur « afnor » de banqup v1.15.0),
-- les rattache à une facture du dossier par l'identité que l'administration donne à une facture — son numéro, l'année
-- de sa date d'émission, le SIREN de son fournisseur (annexe 7 v1.9, règle G1.42) — et les écrit ici, une fois par flux.
-- Ce qui ne se rattache à rien ne s'écrit pas : la fonction le dit à l'écran.
--
-- UN REFUS LU A LES CONSÉQUENCES D'UN REFUS LU CHEZ SUPER PDP, aux quatre endroits où la règle vit déjà, chacun dans
-- son ordre et sous ses mots : l'enregistrement d'un encaissement (refus 5), la déclaration hors application (refus 6)
-- et sa garde, la transmission d'une facture et celle de l'avoir qui l'annule. Pour une écriture d'hier — une
-- restauration rejoue l'historique avec ses dates —, seul ce qui était LU avant elle compte.
--
-- Données mesurées le 09/10/2026 (comptes seulement) : 6 factures validées, aucune transmission, aucune connexion à une
-- plateforme, aucun encaissement. Tout ce qui suit est latent.

-- ══ Le point de reprise des statuts ══════════
-- À part de celui des factures (`recherche_depuis`) : les deux recherches ne portent pas sur les mêmes flux, et l'une
-- ferait sauter à l'autre ce qu'elle n'a pas encore lu. Mêmes règles : il n'avance que sur ce que la lecture a traité
-- pour de bon, jamais à moins d'une heure de maintenant, et ne recule jamais ; une connexion modifiée le remet à zéro.
alter table public.connexions_plateformes
  add column cycle_vie_depuis timestamptz,
  add column cycle_vie_lu_le timestamptz;

comment on column public.connexions_plateformes.cycle_vie_depuis is
  'Le point d''où repart la lecture des statuts du cycle de vie des factures émises (flux CustomerInvoiceLC entrants).';
comment on column public.connexions_plateformes.cycle_vie_lu_le is
  'L''instant de la dernière lecture des statuts allée au bout : tout ce que la plateforme rendait alors a été traité.';

-- ══ La table ══════════
-- Un statut lu sur la plateforme du client, rattaché à une facture validée du dossier : le code (tableau 8), et ce que
-- le message dit — son identifiant (MDT-4), son horodatage tel qu'écrit (MDT-78, AAAAMMJJHHMMSS : son fuseau n'est pas
-- dit), le rôle de qui l'a créé (MDT-40), la date du statut (MDT-110), les motifs (MDT-113 et MDT-114), le commentaire
-- (MDT-125 à MDT-127), les montants par taux (MDG-43, tels qu'écrits) —, l'hôte et le flux qui l'ont porté, qui l'a lu et
-- quand. Un flux n'entre qu'une fois par dossier (contrainte TOTALE, comme `pieces_flux_unique`). Rien ne s'y modifie
-- ni ne s'y supprime, sauf avec le dossier : ce que la plateforme a dit reste dit. La facture est sans action à la
-- suppression : une facture validée ne se supprime qu'avec son dossier.
create table public.statuts_factures_recus (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  facture_id uuid not null references public.factures_emises (id),
  hote text not null
    constraint statuts_factures_recus_hote
      check (hote ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  flux_id text not null constraint statuts_factures_recus_flux_id check (flux_id ~ '^[!-~]{1,200}$'),
  code text not null constraint statuts_factures_recus_code check (code in ('200', '201', '202', '203', '204', '205', '206', '207', '208', '209', '210', '211', '212', '213')),
  message_id text constraint statuts_factures_recus_message_id check (message_id <> '' and length(message_id) <= 200),
  emis_le text constraint statuts_factures_recus_emis_le check (emis_le ~ '^[0-9]{14}$'),
  createur_role text constraint statuts_factures_recus_createur_role check (createur_role ~ '^[A-Z0-9]{1,3}$'),
  date_statut date,
  motifs text constraint statuts_factures_recus_motifs check (btrim(motifs) <> '' and length(motifs) <= 2000),
  commentaire text constraint statuts_factures_recus_commentaire check (btrim(commentaire) <> '' and length(commentaire) <= 2000),
  montants jsonb not null default '[]'::jsonb constraint statuts_factures_recus_montants check (jsonb_typeof(montants) = 'array'),
  lu_par uuid,
  lu_le timestamptz not null default now(),
  constraint statuts_factures_recus_un_flux unique (dossier_id, hote, flux_id)
);

create index statuts_factures_recus_facture on public.statuts_factures_recus (facture_id);

-- ══ La garde ══════════
-- Un statut désigne une facture VALIDÉE de son dossier ; il ne se modifie pas ; il ne se supprime qu'avec son dossier.
-- Elle lit avec les droits de l'appelant et passe avant la RLS : qui ne voit pas la facture est refusé sans apprendre si
-- elle existe.
create function public.garder_statut_facture_recu() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Un statut lu ne se supprime pas : ce que la plateforme a dit reste dit.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Un statut lu ne se modifie pas.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.factures_emises f
                  where f.id = new.facture_id and f.dossier_id = new.dossier_id and f.statut = 'validee') then
    raise exception 'Un statut lu désigne une facture validée de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger statuts_factures_recus_gardes
  before insert or update or delete on public.statuts_factures_recus
  for each row execute function public.garder_statut_facture_recu();

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet LIT les statuts de ses dossiers ; plateforme-agreee les écrit à la clé secrète ; le super-administrateur en
-- insère pour restaurer une sauvegarde — sans eux, une facture refusée recevrait de nouveau un statut « Encaissée ». Le
-- client n'en voit rien.
alter table public.statuts_factures_recus enable row level security;
create policy statuts_factures_recus_lecture on public.statuts_factures_recus
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy statuts_factures_recus_restauration on public.statuts_factures_recus
  for insert to authenticated with check (is_super_admin());

-- ══ Un refus lu fait refuser ce qu'un refus de Super PDP fait refuser ══════════
-- Chaque fonction est celle d'hier, élargie d'UNE clause : un statut 210 ou 213 lu sur la plateforme du client. Les
-- refus ne changent ni de place ni de message — sauf la transmission d'une facture, qui reçoit le sien : une facture que
-- l'application n'a jamais transmise (déposée par le client lui-même) peut avoir été refusée.

-- Le refus 5 de l'enregistrement d'un encaissement (migration encaissements_des_factures).
create or replace function public.enregistrer_encaissement(
  p_dossier_id uuid,
  p_facture_id uuid,
  p_date date,
  p_montant numeric,
  p_moyen text,
  p_ligne_bancaire_id uuid,
  p_repartition jsonb
)
returns public.encaissements_factures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_facture public.factures_emises;
  v_mouvement public.lignes_bancaires;
  v_encaissement public.encaissements_factures;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_taux numeric;
  v_base bigint;
  v_tva bigint;
  v_ttc bigint;
  v_deja numeric;
  v_total numeric;
  v_exces numeric;
  v_part record;
begin
  if not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_facture from public.factures_emises f
   where f.id = p_facture_id and f.dossier_id = p_dossier_id
   for no key update;
  if not found then
    raise exception 'Facture introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_facture.statut <> 'validee' then
    raise exception 'Seule une facture validée reçoit un encaissement : celle-ci est un brouillon.' using errcode = '22023';
  end if;
  if v_facture.type <> 'facture' then
    raise exception 'Un avoir ne reçoit pas d''encaissement : seule une facture en reçoit.' using errcode = '22023';
  end if;
  if exists (select 1 from public.transmissions_factures r where r.facture_id = p_facture_id and r.etat = 'rejete')
     or exists (select 1 from public.facture_superpdp_events e
                 where e.facture_id = p_facture_id and e.status_code in ('fr:210', 'fr:213'))
     or exists (select 1 from public.statuts_factures_recus s
                 where s.facture_id = p_facture_id and s.code in ('210', '213')) then
    raise exception 'Cette facture a été rejetée ou refusée : elle s''annule par un avoir interne, et aucun encaissement ne la suit.'
      using errcode = '22023';
  end if;
  select coalesce(sum(m.base_centimes), 0), coalesce(sum(m.tva_centimes), 0) into v_base, v_tva
    from public.montants_par_taux_facture(p_facture_id) m;
  if v_base <> v_facture.montant_ht * 100 or v_tva <> v_facture.montant_tva * 100
     or v_base + v_tva <> v_facture.montant_ttc * 100 then
    raise exception 'Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes : ses encaissements ne se répartissent pas par taux.'
      using errcode = '22023';
  end if;

  if p_date is null then
    raise exception 'La date de l''encaissement est à renseigner.' using errcode = '22023';
  end if;
  if p_date < date '2000-01-01' then
    raise exception 'Un encaissement ne se date pas avant l''an 2000.' using errcode = '22023';
  end if;
  if p_date > v_aujourd_hui then
    raise exception 'Un encaissement ne se date pas dans l''avenir : nous sommes le %.', to_char(v_aujourd_hui, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  if p_montant is null or not (p_montant > 0 and p_montant < 10000000000000) then
    raise exception 'Un encaissement est un montant positif.' using errcode = '22023';
  end if;
  if p_montant <> round(p_montant, 2) then
    raise exception 'Un encaissement se compte au centime.' using errcode = '22023';
  end if;
  if p_moyen is null
     or p_moyen not in ('virement', 'cheque', 'carte', 'prelevement', 'especes', 'effet', 'compensation', 'autre') then
    raise exception 'Le moyen de paiement est inconnu.' using errcode = '22023';
  end if;

  if p_ligne_bancaire_id is not null then
    select * into v_mouvement from public.lignes_bancaires l
     where l.id = p_ligne_bancaire_id and l.dossier_id = p_dossier_id
     for no key update;
    if not found then
      raise exception 'Ce mouvement n''est pas un mouvement de ce dossier.' using errcode = '22023';
    end if;
    if v_mouvement.montant <= 0 then
      raise exception 'Un encaissement se justifie par un crédit : ce mouvement n''en est pas un.' using errcode = '22023';
    end if;
    if exists (select 1 from public.encaissements_factures e
                where e.ligne_bancaire_id = p_ligne_bancaire_id and e.facture_id = p_facture_id and e.retire_le is null
                  and not exists (select 1 from public.encaissements_factures c
                                   where c.annule_id = e.id and c.retire_le is null)) then
      raise exception 'Ce mouvement justifie déjà un encaissement de cette facture.' using errcode = '22023';
    end if;
    select coalesce(sum(e.montant), 0) + p_montant into v_total
      from public.encaissements_factures e
     where e.ligne_bancaire_id = p_ligne_bancaire_id and e.retire_le is null
       and not exists (select 1 from public.encaissements_factures c where c.annule_id = e.id and c.retire_le is null);
    -- L'écart toléré, en centimes : (encaissements − mouvement) ≤ min(500, 2 % des encaissements), multiplié par 100
    -- pour rester en nombres entiers.
    v_exces := (v_total - v_mouvement.montant) * 100;
    if v_exces * 100 > least(50000, v_total * 200) then
      raise exception 'Ce mouvement de % € justifierait % € d''encaissements : l''écart dépasse ce que des frais bancaires expliquent.',
        replace(to_char(v_mouvement.montant, 'FM999999999990.00'), '.', ','), replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
        using errcode = '22023';
    end if;
  end if;

  if jsonb_typeof(p_repartition) is distinct from 'array' or jsonb_array_length(p_repartition) = 0
     or exists (select 1 from jsonb_array_elements(p_repartition) e(valeur)
                 where jsonb_typeof(e.valeur) <> 'object' or jsonb_typeof(e.valeur -> 'taux') is distinct from 'number'
                    or jsonb_typeof(e.valeur -> 'montant') is distinct from 'number') then
    raise exception 'La répartition par taux est illisible : une liste de taux et de montants.' using errcode = '22023';
  end if;
  select (e.valeur ->> 'taux')::numeric into v_taux
    from jsonb_array_elements(p_repartition) with ordinality e(valeur, rang)
   where exists (select 1 from jsonb_array_elements(p_repartition) with ordinality d(valeur, rang)
                  where (d.valeur ->> 'taux')::numeric = (e.valeur ->> 'taux')::numeric and d.rang < e.rang)
   order by e.rang limit 1;
  if found then
    raise exception 'Le taux de % %% figure deux fois dans la répartition.', replace(trim_scale(v_taux)::text, '.', ',')
      using errcode = '22023';
  end if;
  select (e.valeur ->> 'taux')::numeric into v_taux
    from jsonb_array_elements(p_repartition) with ordinality e(valeur, rang)
   where not exists (select 1 from public.facture_lignes l
                      where l.facture_id = p_facture_id and l.taux_tva = (e.valeur ->> 'taux')::numeric)
   order by e.rang limit 1;
  if found then
    raise exception 'Le taux de % %% n''est pas un taux de cette facture.', replace(trim_scale(v_taux)::text, '.', ',')
      using errcode = '22023';
  end if;
  select (e.valeur ->> 'taux')::numeric into v_taux
    from jsonb_array_elements(p_repartition) with ordinality e(valeur, rang)
   where (e.valeur ->> 'taux')::numeric not in (0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6)
   order by e.rang limit 1;
  if found then
    raise exception 'Le taux de % %% n''est pas un taux de TVA que la facturation électronique admet.',
      replace(trim_scale(v_taux)::text, '.', ',') using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_repartition) e(valeur)
              where not ((e.valeur ->> 'montant')::numeric > 0)
                 or (e.valeur ->> 'montant')::numeric <> round((e.valeur ->> 'montant')::numeric, 2)) then
    raise exception 'Chaque part de la répartition est un montant positif, au centime.' using errcode = '22023';
  end if;
  select sum((e.valeur ->> 'montant')::numeric) into v_total from jsonb_array_elements(p_repartition) e(valeur);
  if v_total <> p_montant then
    raise exception 'La répartition (% €) ne fait pas le montant encaissé (% €).',
      replace(to_char(v_total, 'FM999999999990.00'), '.', ','), replace(to_char(p_montant, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  select coalesce(sum(e.montant), 0) into v_deja from public.encaissements_factures e
   where e.facture_id = p_facture_id and e.retire_le is null;
  if v_deja + p_montant > v_facture.montant_ttc then
    raise exception 'L''encaissement dépasserait le total de la facture : il reste % € à encaisser.',
      replace(to_char(greatest(v_facture.montant_ttc - v_deja, 0), 'FM999999999990.00'), '.', ',') using errcode = '22023';
  end if;
  for v_part in
    select (e.valeur ->> 'taux')::numeric as taux, (e.valeur ->> 'montant')::numeric as montant, e.rang
      from jsonb_array_elements(p_repartition) with ordinality e(valeur, rang)
     order by e.rang
  loop
    select m.ttc_centimes into v_ttc from public.montants_par_taux_facture(p_facture_id) m where m.taux = v_part.taux;
    select coalesce(sum(t.montant), 0) into v_deja
      from public.encaissements_factures_taux t
      join public.encaissements_factures e on e.id = t.encaissement_id
     where e.facture_id = p_facture_id and e.retire_le is null and t.taux = v_part.taux;
    if (v_deja + v_part.montant) * 100 > v_ttc then
      raise exception 'À % %%, l''encaissement dépasserait ce que la facture porte : il reste % € à encaisser à ce taux.',
        replace(trim_scale(v_part.taux)::text, '.', ','),
        replace(to_char(greatest(v_ttc / 100.0 - v_deja, 0), 'FM999999999990.00'), '.', ',') using errcode = '22023';
    end if;
  end loop;

  insert into public.encaissements_factures (
    dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, cree_par
  ) values (
    p_dossier_id, p_facture_id, p_date, p_montant, p_moyen, p_ligne_bancaire_id, auth.uid()
  )
  returning * into v_encaissement;
  insert into public.encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
  select v_encaissement.id, p_dossier_id, (e.valeur ->> 'taux')::numeric, (e.valeur ->> 'montant')::numeric
    from jsonb_array_elements(p_repartition) e(valeur);
  return v_encaissement;
end
$$;

-- Le refus 6 de la déclaration hors application (migration transmissions_des_encaissements).
create or replace function public.declarer_encaissement_hors_application(
  p_dossier_id uuid,
  p_encaissement_id uuid,
  p_note text
)
returns public.transmissions_encaissements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_encaissement public.encaissements_factures;
  v_hote text;
  v_note text := case when btrim(p_note) = '' then null else p_note end;
  v_declaration public.transmissions_encaissements;
begin
  if not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_encaissement from public.encaissements_factures e
   where e.id = p_encaissement_id and e.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Encaissement introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  perform 1 from public.factures_emises f where f.id = v_encaissement.facture_id for no key update;
  select * into v_encaissement from public.encaissements_factures e where e.id = p_encaissement_id for update;

  if v_encaissement.retire_le is not null then
    raise exception 'Cet encaissement est retiré : il n''a jamais été déclaré, et ne se déclare plus.' using errcode = '22023';
  end if;
  if public.encaissement_declare(p_encaissement_id) then
    raise exception 'Cet encaissement est déjà déclaré : une déclaration ne se fait qu''une fois.' using errcode = '22023';
  end if;
  if v_encaissement.annule_id is not null then
    select t.hote into v_hote from public.transmissions_encaissements t
     where t.encaissement_id = v_encaissement.annule_id and t.etat in ('envoi', 'depose', 'accepte');
    if not found then
      raise exception 'L''encaissement que cette contre-passation annule n''est pas déclaré : elle ne se déclare pas.'
        using errcode = '22023';
    end if;
  else
    if exists (select 1 from public.transmissions_factures r where r.facture_id = v_encaissement.facture_id and r.etat = 'rejete')
       or exists (select 1 from public.facture_superpdp_events e
                   where e.facture_id = v_encaissement.facture_id and e.status_code in ('fr:210', 'fr:213'))
       or exists (select 1 from public.statuts_factures_recus s
                   where s.facture_id = v_encaissement.facture_id and s.code in ('210', '213')) then
      raise exception 'Cette facture a été rejetée ou refusée : elle s''annule par un avoir interne, et aucun statut « Encaissée » ne la suit.'
        using errcode = '22023';
    end if;
    select t.hote into v_hote from public.transmissions_factures t
     where t.facture_id = v_encaissement.facture_id
       and (t.etat = 'accepte'
            or t.canal = 'superpdp' and t.etat = 'depose'
               and exists (select 1 from public.facture_superpdp_events e
                            where e.facture_id = t.facture_id and e.status_code = 'fr:200'))
     order by t.cree_le desc, t.id
     limit 1;
    if not found then
      raise exception 'Aucune transmission de cette facture par l''application n''a été acceptée par une plateforme : son statut « Encaissée » ne se déclare d''ici qu''après.'
        using errcode = '22023';
    end if;
  end if;
  if length(v_note) > 2000 then
    raise exception 'La note de la déclaration dépasse 2 000 caractères.' using errcode = '22023';
  end if;

  insert into public.transmissions_encaissements (
    dossier_id, encaissement_id, facture_id, canal, hote, etat, note, cree_par
  ) values (
    p_dossier_id, p_encaissement_id, v_encaissement.facture_id, 'manuel', v_hote, 'depose', v_note, auth.uid()
  )
  returning * into v_declaration;
  return v_declaration;
end
$$;

-- Sa garde : pour une déclaration d'hier, seul le statut lu avant elle compte (`lu_le`).
create or replace function public.garder_transmission_encaissement() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_encaissement public.encaissements_factures;
  v_connu_le timestamptz;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une déclaration ne se supprime pas : ce qui a été dit à l''administration le reste, et une erreur se corrige par une contre-passation.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    perform 1 from public.encaissements_factures e where e.id = new.encaissement_id for share;
    select * into v_encaissement from public.encaissements_factures e where e.id = new.encaissement_id;
    if not found or v_encaissement.dossier_id <> new.dossier_id or v_encaissement.facture_id <> new.facture_id then
      raise exception 'Une déclaration désigne un encaissement de sa facture et de son dossier.' using errcode = '23514';
    end if;
    if new.etat in ('envoi', 'depose', 'accepte') then
      if v_encaissement.retire_le is not null then
        raise exception 'Un encaissement retiré ne se déclare pas.' using errcode = '23514';
      end if;
      if not exists (select 1 from public.transmissions_factures t
                      where t.facture_id = new.facture_id and t.hote = new.hote
                        and t.etat in ('depose', 'accepte', 'rejete')
                        and (new.canal = 'manuel' or t.canal = new.canal)) then
        raise exception 'Une déclaration se fait sur la plateforme qui a reçu la facture — par une API, par le canal qui la lui a transmise.'
          using errcode = '23514';
      end if;
      if v_encaissement.annule_id is null then
        v_connu_le := case when new.cree_le = now() then 'infinity'::timestamptz else new.cree_le end;
        if exists (select 1 from public.transmissions_factures r
                    where r.facture_id = new.facture_id and r.etat = 'rejete' and r.maj_le <= v_connu_le)
           or exists (select 1 from public.facture_superpdp_events e
                       where e.facture_id = new.facture_id and e.status_code in ('fr:210', 'fr:213')
                         and e.created_at <= v_connu_le)
           or exists (select 1 from public.statuts_factures_recus s
                       where s.facture_id = new.facture_id and s.code in ('210', '213')
                         and s.lu_le <= v_connu_le) then
          raise exception 'Une facture rejetée ou refusée ne reçoit pas de statut « Encaissée » : elle s''annule par un avoir interne.'
            using errcode = '23514';
        end if;
        if not exists (select 1 from public.transmissions_factures t
                        where t.facture_id = new.facture_id and t.hote = new.hote
                          and (new.canal = 'manuel' or t.canal = new.canal)
                          and (t.etat = 'accepte'
                               or t.canal = 'superpdp' and t.etat in ('depose', 'rejete')
                                  and exists (select 1 from public.facture_superpdp_events e
                                               where e.facture_id = new.facture_id and e.status_code = 'fr:200'
                                                 and e.created_at <= v_connu_le))) then
          raise exception 'Le statut « Encaissée » d''une facture ne se déclare qu''une fois la facture acceptée par sa plateforme.'
            using errcode = '23514';
        end if;
      end if;
    end if;
    return new;
  end if;

  if new.dossier_id is distinct from old.dossier_id or new.encaissement_id is distinct from old.encaissement_id
     or new.facture_id is distinct from old.facture_id or new.canal is distinct from old.canal
     or new.hote is distinct from old.hote or new.sha256 is distinct from old.sha256
     or new.note is distinct from old.note or new.cree_par is distinct from old.cree_par
     or new.cree_le is distinct from old.cree_le then
    raise exception 'Une déclaration ne change ni d''encaissement, ni de canal, ni d''hôte, ni de fichier, ni de note.'
      using errcode = '23514';
  end if;
  if old.flux_id is not null and new.flux_id is distinct from old.flux_id then
    raise exception 'Le flux d''une déclaration ne se renomme pas.' using errcode = '23514';
  end if;
  if old.etat in ('echec', 'accepte', 'rejete') and new.etat <> old.etat
     or old.etat = 'depose' and new.etat in ('envoi', 'echec') then
    raise exception 'Une déclaration ne revient pas en arrière : % ne devient pas %.', old.etat, new.etat
      using errcode = '23514';
  end if;
  new.maj_le := now();
  return new;
end
$$;

-- La transmission d'une facture refusée ou rejetée sur sa plateforme, et celle de l'avoir qui l'annule (migration
-- avoir_interne_d_une_facture_rejetee) : seul le statut lu AVANT la transmission compte — un avoir transmis avant le
-- refus n'était pas un avoir interne, et une restauration rejoue l'historique avec ses dates.
create or replace function public.garder_transmission_facture() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.factures_emises f
                    where f.id = new.facture_id and f.dossier_id = new.dossier_id and f.statut = 'validee') then
      raise exception 'Seule une facture validée de son dossier se transmet.' using errcode = '23514';
    end if;
    if exists (select 1 from public.transmissions_factures r
                where r.facture_id = new.facture_id and r.etat = 'rejete' and r.cree_le <= new.cree_le) then
      raise exception 'Une facture rejetée ne repart pas : elle s''annule par un avoir interne, qui ne se transmet pas, puis une nouvelle facture.'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.statuts_factures_recus s
                where s.facture_id = new.facture_id and s.code in ('210', '213') and s.lu_le <= new.cree_le) then
      raise exception 'Une facture refusée ou rejetée sur sa plateforme ne part pas : elle s''annule par un avoir interne, qui ne se transmet pas, puis une nouvelle facture.'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.factures_emises a
                where a.id = new.facture_id and a.type = 'avoir' and a.facture_origine_id is not null
                  and (exists (select 1 from public.transmissions_factures r
                                where r.facture_id = a.facture_origine_id and r.etat = 'rejete')
                       or exists (select 1 from public.facture_superpdp_events e
                                   where e.facture_id = a.facture_origine_id and e.status_code in ('fr:210', 'fr:213'))
                       or exists (select 1 from public.statuts_factures_recus s
                                   where s.facture_id = a.facture_origine_id and s.code in ('210', '213')
                                     and s.lu_le <= new.cree_le))) then
      raise exception 'Cet avoir annule une facture rejetée ou refusée : c''est un avoir interne, qui ne se transmet pas.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if new.dossier_id is distinct from old.dossier_id or new.facture_id is distinct from old.facture_id
     or new.canal is distinct from old.canal or new.hote is distinct from old.hote
     or new.sha256 is distinct from old.sha256 or new.cree_le is distinct from old.cree_le then
    raise exception 'Une transmission ne change ni de facture, ni de canal, ni d''hôte, ni de fichier.' using errcode = '23514';
  end if;
  if old.flux_id is not null and new.flux_id is distinct from old.flux_id then
    raise exception 'Le flux d''une transmission ne se renomme pas.' using errcode = '23514';
  end if;
  if old.etat in ('echec', 'accepte', 'rejete') and new.etat <> old.etat
     or old.etat = 'depose' and new.etat in ('envoi', 'echec') then
    raise exception 'Une transmission ne revient pas en arrière : % ne devient pas %.', old.etat, new.etat
      using errcode = '23514';
  end if;
  new.maj_le := now();
  return new;
end
$$;

-- ══ Les droits d'exécution ══════════
-- La garde ne sert qu'au déclencheur. Les quatre fonctions redéfinies gardent leurs droits.
revoke execute on function public.garder_statut_facture_recu() from public, anon, authenticated;

comment on table public.statuts_factures_recus is
  'Les statuts du cycle de vie d''une facture émise lus sur la plateforme du client (flux CustomerInvoiceLC entrants), rattachés à une facture validée du dossier : code (tableau 8 des spécifications externes de la DGFiP), message, horodatage, motifs, commentaire, montants, hôte et flux. Un flux n''entre qu''une fois par dossier ; un 210 ou un 213 fait refuser encaissement, déclaration et transmission.';
comment on function public.garder_statut_facture_recu() is
  'Garde des statuts lus : une facture validée de son dossier, rien ne se modifie, rien ne se supprime hors du dossier entier.';
