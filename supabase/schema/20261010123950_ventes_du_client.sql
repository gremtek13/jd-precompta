-- LES VENTES DU CLIENT, EN BASE (espace client, étape P2 ; décision du cabinet du 09/10/2026 d'ouvrir l'espace client aux
-- ventes ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §3.3,
-- §3.4, §4.1 et §5 ; EC-Q2 et EC-Q4 sans réponse, leurs recommandations prises comme hypothèses ; EC-Q3 reste ouverte :
-- une facture émise ne compte toujours nulle part en comptabilité). Présentée au cabinet avant d'être appliquée : elle
-- OUVRE une lecture au client (CLAUDE.md, « une policy qui lui ouvre une lecture se présente au cabinet »).
--
-- CE QU'ELLE OUVRE, ET À QUI. À un accès client qui porte le droit « Ventes » (`memberships.droit_ventes`, posé par le
-- cabinet dans l'onglet Accès, faux par défaut) — et à lui seul —, la LECTURE des ventes de SON dossier : les factures et
-- leurs lignes, leurs transmissions et leurs événements chez Super PDP, les statuts lus sur sa plateforme, les
-- encaissements, leurs parts par taux et leurs déclarations, et les e-mails qui ont envoyé une facture (ou, à l'étape P6,
-- un devis). Neuf policies `for select to authenticated`, AJOUTÉES à côté de celles du cabinet, qui ne changent pas : une
-- policy permissive s'ajoute aux autres par un OU (documentation de PostgreSQL, « Row Security Policies ») et n'ouvre que
-- la commande qu'elle nomme. Aucune écriture directe : aucune policy d'insertion, de mise à jour ni de retrait ne s'ouvre
-- au client. Le prédicat est `client_du_dossier(…, 'ventes')` (étape P1) : sans session, `auth.uid()` est nul et aucun
-- accès ne lui correspond ; un mot mal écrit n'y vaut rien.
--
-- ET LES GESTES, par les fonctions du cabinet, qui acceptent désormais aussi le client portant le droit
-- (`gere_les_ventes` au lieu d'`admin_du_dossier`) : la numérotation qu'appelle `enregistrer_facture` (recréée par la
-- migration suivante, à coller), l'abandon d'une transmission restée sans issue connue, l'enregistrement, le retrait, la
-- déclaration hors application et la contre-passation d'un encaissement. Leurs refus, leurs gardes et leurs verrous ne
-- changent pas ; un client sans le droit, ou d'un autre dossier, reçoit le refus d'hier (« Accès refusé à ce dossier. »,
-- 42501). L'abandon dit désormais qui l'a fait : le cabinet, mot pour mot comme hier, ou le client.
--
-- UN REFUS NEUF. Désigner le mouvement bancaire qui prouve un encaissement demande AUSSI le droit « Banque »
-- (`gere_la_banque`) : un client qui n'a que « Ventes » enregistre ses encaissements sans mouvement. Il vient juste après
-- celui de l'accès, en 42501 ; lib/encaissementsFactures.ts le redit à son rang avant le clic. Le cabinet a les deux.
--
-- QUI A FAIT QUOI (conception, §2.7). `factures_emises.valide_par` : le compte qui a validé la facture, écrit par
-- `enregistrer_facture` dans la transaction qui la numérote, puis figé avec elle — la garde des factures validées ne le
-- laisse pas changer, il n'est pas de ce qui s'écrit après coup (`v_modifiables`) ; nul sur un brouillon (une contrainte),
-- et sur une facture validée avant cette migration : on ne devine pas qui l'a validée. Validée par le cabinet, c'est une
-- facture émise au nom et pour le compte du client, sur mandat (BOI-TVA-DECLA-30-20-10-30, §90 à §210) : `valide_par` le
-- dit. `transmissions_factures.cree_par` : le compte qui a réservé la transmission, que les Edge Functions écriront
-- (étape P3), immuable ensuite. Ni l'un ni l'autre n'a de clé vers `auth.users`, comme `encaissements_factures.cree_par` :
-- un `set null` réécrirait une ligne figée, et un `no action` empêcherait de retirer le compte d'un membre parti.
--
-- UNE SEULE SÉRIE DE FACTURES PAR DOSSIER, que la facture soit validée par le client ou par le cabinet (EC-Q2,
-- recommandation) : celle d'aujourd'hui, sous le verrou de sa ligne dans `prochain_numero_facture`, dans la transaction
-- qui valide — deux validations simultanées prennent deux numéros qui se suivent (CGI, ann. II, art. 242 nonies A, I,
-- 7° : « un numéro unique basé sur une séquence chronologique et continue »). Son droit d'exécution reste retiré à tous.
--
-- CE QU'ELLE NE FAIT PAS : aucune policy d'aujourd'hui n'est changée ni retirée ; aucune donnée n'est lue, écrite ni
-- retirée ; aucune Edge Function ne change (étape P3) ; aucun écran du client (étape P4). Un accès sans le droit
-- « Ventes » ne voit rien de plus qu'hier, et le cabinet garde tous ses gestes. Le texte ne porte aucune instruction de
-- suppression : `apply_migration` le prend. Règlement (UE) 2016/679, art. 25 § 2 (par défaut, rien d'ouvert : le droit
-- est faux tant que le cabinet ne le coche pas) et art. 32 § 1 b).

-- ══ 1. Qui a validé une facture, qui a réservé une transmission ══════════

alter table public.factures_emises add column valide_par uuid;
alter table public.factures_emises add constraint factures_emises_valide_par_de_la_validation
  check (valide_par is null or statut = 'validee');

comment on column public.factures_emises.valide_par is
  'Le compte qui a validé la facture (cabinet, ou client portant le droit « Ventes »), écrit par enregistrer_facture dans la transaction qui la numérote et figé avec elle ; nul sur un brouillon et sur une facture validée avant le 10/10/2026 (espace client, étape P2).';

alter table public.transmissions_factures add column cree_par uuid;

comment on column public.transmissions_factures.cree_par is
  'Le compte qui a réservé la transmission, écrit par l''Edge Function qui dépose (étape P3) ; nul pour une transmission d''avant ; il ne change plus ensuite (garder_transmission_facture).';

-- ══ 2. La garde des transmissions : l'auteur d'une transmission ne change pas ══════════
-- Reprise de la migration cycle_de_vie_des_factures_emises, au caractère près, et un refus de plus à la mise à jour.
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
  if new.cree_par is distinct from old.cree_par then
    raise exception 'L''auteur d''une transmission ne change pas : c''est le compte qui l''a réservée.' using errcode = '23514';
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

-- ══ 3. Les lectures du client qui porte le droit « Ventes » ══════════
-- Une policy par table, `for select to authenticated`, à côté de celle du cabinet. Sur SON dossier seulement : le
-- prédicat lit l'accès de l'appelant à CE dossier (`client_du_dossier`, étape P1), jamais un autre. Les lignes d'une
-- facture n'ont pas de dossier : elles se lisent par leur facture, comme la policy du cabinet les lit.

create policy factures_emises_lecture_ventes on public.factures_emises
  for select to authenticated
  using (public.client_du_dossier(dossier_id, 'ventes'));

create policy facture_lignes_lecture_ventes on public.facture_lignes
  for select to authenticated
  using (exists (select 1 from public.factures_emises f
                  where f.id = facture_lignes.facture_id and public.client_du_dossier(f.dossier_id, 'ventes')));

create policy transmissions_factures_lecture_ventes on public.transmissions_factures
  for select to authenticated
  using (public.client_du_dossier(dossier_id, 'ventes'));

create policy facture_superpdp_events_lecture_ventes on public.facture_superpdp_events
  for select to authenticated
  using (public.client_du_dossier(dossier_id, 'ventes'));

create policy statuts_factures_recus_lecture_ventes on public.statuts_factures_recus
  for select to authenticated
  using (public.client_du_dossier(dossier_id, 'ventes'));

create policy encaissements_factures_lecture_ventes on public.encaissements_factures
  for select to authenticated
  using (public.client_du_dossier(dossier_id, 'ventes'));

create policy encaissements_factures_taux_lecture_ventes on public.encaissements_factures_taux
  for select to authenticated
  using (public.client_du_dossier(dossier_id, 'ventes'));

create policy transmissions_encaissements_lecture_ventes on public.transmissions_encaissements
  for select to authenticated
  using (public.client_du_dossier(dossier_id, 'ventes'));

-- Les e-mails d'une facture, et ceux d'un devis à l'étape P6 — jamais la relance de pièces que le cabinet adresse au
-- client, qui n'est pas une vente.
create policy emails_envoyes_lecture_ventes on public.emails_envoyes
  for select to authenticated
  using (public.client_du_dossier(dossier_id, 'ventes') and type in ('facture', 'devis'));

-- ══ 4. Les fonctions de la vente acceptent le client qui porte le droit « Ventes » ══════════
-- Chacune reprise de sa dernière migration au caractère près : le contrôle d'accès devient `gere_les_ventes` (le cabinet
-- du dossier, ou un accès portant le droit « Ventes »), le reste ne change pas — sauf ce qui est dit au-dessus d'elle.
-- Leurs droits d'exécution ne changent pas (`create or replace` les garde) : la numérotation reste fermée à tous.

-- La numérotation : appelée par enregistrer_facture, sous l'identité de l'appelant (auth.uid() est le sien).
create or replace function public.prochain_numero_facture(p_dossier_id uuid, p_annee integer, p_type text default 'facture')
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_prefixe text;
  v_compteur integer;
  v_emis integer;
  v_numero integer;
begin
  if p_type not in ('facture', 'avoir') then
    raise exception 'Type de numérotation invalide : %', p_type using errcode = '22023';
  end if;
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  insert into facture_numerotation (dossier_id, annee, type, dernier_numero)
  values (p_dossier_id, p_annee, p_type, 0)
  on conflict (dossier_id, annee, type) do nothing;
  select n.dernier_numero into v_compteur
  from facture_numerotation n
  where n.dossier_id = p_dossier_id and n.annee = p_annee and n.type = p_type
  for update;

  v_prefixe := (case when p_type = 'avoir' then 'A' else 'F' end) || p_annee::text || '-';
  select coalesce(max(substr(f.numero, length(v_prefixe) + 1)::integer), 0) into v_emis
  from factures_emises f
  where f.dossier_id = p_dossier_id and f.numero ~ ('^' || v_prefixe || '[0-9]+$');

  v_numero := greatest(v_compteur, v_emis) + 1;
  update facture_numerotation set dernier_numero = v_numero
  where dossier_id = p_dossier_id and annee = p_annee and type = p_type;
  return v_numero;
end;
$$;

-- L'abandon d'une transmission restée sans issue connue : son détail dit qui l'a abandonnée.
create or replace function public.abandonner_transmission(p_transmission_id uuid)
returns public.transmissions_factures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transmission public.transmissions_factures;
begin
  select * into v_transmission from public.transmissions_factures t where t.id = p_transmission_id for update;
  if not found then
    raise exception 'Transmission introuvable.' using errcode = 'P0002';
  end if;
  if not public.gere_les_ventes(v_transmission.dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if v_transmission.etat <> 'envoi' then
    raise exception 'Seule une transmission dont l''issue est inconnue s''abandonne (celle-ci est « % »).', v_transmission.etat
      using errcode = '22023';
  end if;
  if v_transmission.cree_le > now() - interval '15 minutes' then
    raise exception 'Une transmission ne s''abandonne qu''un quart d''heure après son départ : la plateforme la reçoit peut-être encore.'
      using errcode = '22023';
  end if;
  update public.transmissions_factures
     set etat = 'echec',
         detail = case when public.admin_du_dossier(v_transmission.dossier_id)
                    then 'Abandonnée par le cabinet, qui a vérifié que la plateforme ne l''a pas reçue : la facture peut repartir.'
                    else 'Abandonnée par le client, qui a vérifié que la plateforme ne l''a pas reçue : la facture peut repartir.'
                  end
   where id = p_transmission_id
  returning * into v_transmission;
  return v_transmission;
end
$$;

-- L'enregistrement d'un encaissement : un refus neuf, juste après celui de l'accès.
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
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- Le mouvement qui prouve l'encaissement est une donnée de la banque : le désigner demande aussi le droit « Banque »
  -- (espace client, étape P2). Le cabinet a les deux ; un client qui n'a que « Ventes » encaisse sans mouvement.
  if p_ligne_bancaire_id is not null and not public.gere_la_banque(p_dossier_id) then
    raise exception 'Le mouvement bancaire d''un encaissement ne se désigne qu''avec le droit « Banque » sur ce dossier : sans lui, l''encaissement s''enregistre sans mouvement.'
      using errcode = '42501';
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

-- Le retrait, la déclaration hors application et la contre-passation d'un encaissement.
create or replace function public.retirer_encaissement(p_dossier_id uuid, p_encaissement_id uuid)
returns public.encaissements_factures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_encaissement public.encaissements_factures;
begin
  if not public.gere_les_ventes(p_dossier_id) then
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
    raise exception 'Cet encaissement est déjà retiré.' using errcode = '22023';
  end if;
  if public.encaissement_declare(p_encaissement_id) then
    raise exception 'Un encaissement déclaré ne se retire pas : il se contre-passe, et l''annulation se déclare à son tour.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.encaissements_factures c where c.annule_id = p_encaissement_id and c.retire_le is null) then
    raise exception 'Cet encaissement est annulé par une contre-passation : retirez d''abord celle-ci.' using errcode = '22023';
  end if;
  update public.encaissements_factures
     set retire_le = now(), retire_par = auth.uid()
   where id = p_encaissement_id
  returning * into v_encaissement;
  return v_encaissement;
end
$$;

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
  if not public.gere_les_ventes(p_dossier_id) then
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

create or replace function public.annuler_encaissement(
  p_dossier_id uuid,
  p_encaissement_id uuid,
  p_date date,
  p_motif text
)
returns public.encaissements_factures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_encaissement public.encaissements_factures;
  v_declaration public.transmissions_encaissements;
  v_annulation public.encaissements_factures;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
begin
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_encaissement from public.encaissements_factures e
   where e.id = p_encaissement_id and e.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Encaissement introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  perform 1 from public.factures_emises f where f.id = v_encaissement.facture_id for no key update;
  select * into v_encaissement from public.encaissements_factures e where e.id = p_encaissement_id for update;

  if v_encaissement.annule_id is not null then
    raise exception 'Une annulation ne se contre-passe pas : l''encaissement qu''elle annulait se saisit de nouveau.'
      using errcode = '22023';
  end if;
  if v_encaissement.retire_le is not null then
    raise exception 'Un encaissement retiré ne s''annule pas : il n''a jamais été déclaré.' using errcode = '22023';
  end if;
  select * into v_declaration from public.transmissions_encaissements t
   where t.encaissement_id = p_encaissement_id and t.etat in ('envoi', 'depose', 'accepte');
  if not found then
    raise exception 'Cet encaissement n''est pas déclaré : il se retire, sans contre-passation.' using errcode = '22023';
  end if;
  if v_declaration.etat = 'envoi' then
    raise exception 'La déclaration de cet encaissement a une issue inconnue : il ne s''annule pas tant qu''elle n''est pas tranchée.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.encaissements_factures c where c.annule_id = p_encaissement_id and c.retire_le is null) then
    raise exception 'Cet encaissement est déjà annulé par une contre-passation.' using errcode = '22023';
  end if;

  if p_date is null then
    raise exception 'La date de la contre-passation est à renseigner.' using errcode = '22023';
  end if;
  if p_date < v_encaissement.date_encaissement then
    raise exception 'Une contre-passation ne se date pas avant l''encaissement qu''elle annule, du %.',
      to_char(v_encaissement.date_encaissement, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_date > v_aujourd_hui then
    raise exception 'Une contre-passation ne se date pas dans l''avenir : nous sommes le %.', to_char(v_aujourd_hui, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'Le motif de la contre-passation est à renseigner.' using errcode = '22023';
  end if;
  if length(p_motif) > 2000 then
    raise exception 'Le motif de la contre-passation dépasse 2 000 caractères.' using errcode = '22023';
  end if;

  insert into public.encaissements_factures (
    dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif, cree_par
  ) values (
    p_dossier_id, v_encaissement.facture_id, p_date, -v_encaissement.montant, v_encaissement.moyen, p_encaissement_id,
    p_motif, auth.uid()
  )
  returning * into v_annulation;
  insert into public.encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
  select v_annulation.id, p_dossier_id, t.taux, -t.montant
    from public.encaissements_factures_taux t
   where t.encaissement_id = p_encaissement_id;
  return v_annulation;
end
$$;
