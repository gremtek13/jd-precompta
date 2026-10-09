-- LES DÉCLARATIONS D'UN ENCAISSEMENT (ligne 28.5, étape d, quatrième temps : d4).
--
-- Le statut « Encaissée » (212) d'une facture dit à l'administration qu'un paiement a été perçu, à sa date et par taux
-- de TVA (CGI, art. 290 A, et ann. II, art. 242 nonies P, I ; CIBS, art. L. 216-56 à compter du 01/01/2027). Il se
-- déclare « au moyen de la mise à jour du statut « Encaissée » de la facture par l'intermédiaire de la plateforme agréée
-- choisie pour son émission » (BOI-TVA-DECLA-20-30-60, §120) : celle qui a reçu la facture, jamais une autre. Le
-- registre des encaissements vit en base depuis l'étape d1 (migration encaissements_des_factures) ; cette migration
-- pose ce qui y manquait : la DÉCLARATION de chaque encaissement, et la contre-passation d'un encaissement déclaré.
--
-- LA DÉCLARATION HORS APPLICATION D'ABORD (décision du cabinet du 08/10/2026, Q2) : le cabinet ou le client saisit le
-- statut sur la plateforme, et l'application garde ce qui a été déclaré — canal `manuel`. Les envois par l'API de la
-- plateforme du client (étape d6) et par Super PDP (étape d8) viendront ensuite : la table, ses contraintes et sa garde
-- leur sont déjà écrites, pour qu'ils s'y ajoutent sans les réécrire ; seule la fonction de cette migration écrit
-- aujourd'hui, et seulement le canal `manuel`.
--
-- POURQUOI LA DÉCLARATION SE GARDE : la plateforme de l'administration ne dédoublonne pas les statuts (spécifications
-- externes de la DGFiP v3.2, § 3.6.7, note 109) — un encaissement déclaré deux fois est compté deux fois, et la TVA avec
-- lui. Une seule déclaration ACTIVE par encaissement, tous canaux confondus ; un encaissement déclaré ne se retire plus
-- (`encaissement_declare` reçoit ici son vrai corps, que le déclencheur et `retirer_encaissement` lisaient déjà) ; une
-- erreur se corrige par une CONTRE-PASSATION — « un décaissement signifié par une valeur négative », qui porte « un
-- motif d'annulation » (annexe 7 des spécifications externes, règles P1.15 et P1.17) —, qui se déclare à son tour.
--
-- Données mesurées le 08/10/2026 (comptes seulement) : aucune transmission de facture, aucun événement de Super PDP,
-- aucune facture partie par l'ancien chemin de Super PDP, aucun encaissement. Tout ce qui suit est latent.

-- ══ La table ══════════
-- Chaque déclaration d'un encaissement — ou de sa contre-passation, qui est un encaissement négatif du registre —,
-- calquée sur les transmissions d'une facture : son canal, l'hôte de la plateforme où elle a été faite, le flux et
-- l'empreinte de ce qu'une API a déposé, son état. Le canal `manuel` est une déclaration faite à la main sur la
-- plateforme : elle n'a ni flux ni fichier, naît déposée, et ne connaît ni l'envoi sans issue ni l'échec, qui sont ceux
-- d'une API ; le cabinet peut y joindre une note (qui l'a saisie, quand, sous quelle référence). L'encaissement et la
-- facture sont sans action à la suppression : une déclaration ne disparaît qu'avec son dossier — ce qui a été dit à
-- l'administration ne s'efface pas sous elle.
create table public.transmissions_encaissements (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  encaissement_id uuid not null references public.encaissements_factures (id),
  facture_id uuid not null references public.factures_emises (id),
  canal text not null
    constraint transmissions_encaissements_canal check (canal in ('manuel', 'plateforme', 'superpdp')),
  hote text not null
    constraint transmissions_encaissements_hote
      check (hote ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  flux_id text constraint transmissions_encaissements_flux_id check (flux_id <> '' and length(flux_id) <= 200),
  sha256 text constraint transmissions_encaissements_sha256 check (sha256 ~ '^[0-9a-f]{64}$'),
  etat text not null default 'envoi'
    constraint transmissions_encaissements_etat check (etat in ('envoi', 'echec', 'depose', 'accepte', 'rejete')),
  detail text constraint transmissions_encaissements_detail check (length(detail) <= 2000),
  note text constraint transmissions_encaissements_note check (btrim(note) <> '' and length(note) <= 2000),
  cree_par uuid,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  -- À la main : ni flux ni fichier, jamais un envoi sans issue ni un échec. Par une API : l'empreinte de ce qui est
  -- parti, et le flux que la plateforme a rendu dès qu'elle l'a reçu.
  constraint transmissions_encaissements_manuel
    check (canal <> 'manuel' or flux_id is null and sha256 is null and etat in ('depose', 'accepte', 'rejete')),
  constraint transmissions_encaissements_fichier check (canal = 'manuel' or sha256 is not null),
  constraint transmissions_encaissements_flux_connu check (canal = 'manuel' or etat in ('envoi', 'echec') or flux_id is not null)
);

-- Une seule déclaration ACTIVE par encaissement, tous canaux confondus : partie sans issue connue, déposée ou acceptée,
-- elle compte. Partiel, et c'est voulu : les échecs et les rejets s'accumulent. Aucun upsert ne le vise.
create unique index transmissions_encaissements_une_active on public.transmissions_encaissements (encaissement_id)
  where etat in ('envoi', 'depose', 'accepte');
create index transmissions_encaissements_encaissement on public.transmissions_encaissements (encaissement_id);
create index transmissions_encaissements_facture on public.transmissions_encaissements (facture_id);
create index transmissions_encaissements_dossier on public.transmissions_encaissements (dossier_id);

-- ══ Ce qui fait d'un encaissement un encaissement déclaré ══════════
-- Une déclaration active : partie sans issue connue (elle a peut-être atteint la plateforme), déposée ou acceptée.
-- Échouée ou rejetée, elle n'a rien fait compter. Le corps posé par l'étape d1 répondait toujours non.
create or replace function public.encaissement_declare(p_encaissement_id uuid) returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.transmissions_encaissements t
                  where t.encaissement_id = p_encaissement_id and t.etat in ('envoi', 'depose', 'accepte'))
$$;

-- ══ La garde ══════════
-- Une déclaration désigne un encaissement de sa facture et de son dossier. Active, elle ne vise pas un encaissement
-- retiré, et elle est faite là où la facture a été reçue : sur la plateforme d'une transmission de la facture que cette
-- plateforme a reçue (déposée, acceptée ou rejetée — il n'y en a qu'une par facture : une facture active ne repart pas,
-- une facture rejetée non plus) ; par une API, par le canal de cette transmission, le seul qui connaisse la facture. Le
-- statut d'un encaissement — pas celui d'une contre-passation, qui suit l'encaissement qu'elle annule — exige en outre
-- une facture ACCEPTÉE — chez Super PDP, déposée suffit quand l'historique porte le statut 200 « Déposée », le premier
-- de ceux que l'administration reçoit (200, 210, 212, 213) : la réception par la plateforme de l'acheteur (202) est
-- facultative et peut ne jamais venir (§ 3.6.4, tableau 8) — et une facture ni rejetée ni refusée, qui s'annule sinon
-- par un avoir interne (§ 3.6.4). Pour une déclaration du jour, tout ce que la base sait compte ; pour une déclaration
-- plus ancienne — une restauration rejoue l'historique avec ses dates —, ce qu'elle savait alors : une facture refusée
-- après coup n'efface pas ce qui avait été déclaré.
--
-- La garde verrouille l'encaissement en partage avant de le lire : un retrait en cours (qui le verrouille en écriture)
-- et une déclaration se suivent, quel que soit celui qui écrit — la fonction de cette migration, ou une Edge Function à
-- venir. Ensuite rien ne change, sauf l'état, vers l'avant (partie sans issue connue, une déclaration devient déposée,
-- acceptée, rejetée ou échouée ; déposée, acceptée ou rejetée), le flux, nommé une fois, et le détail ; rien ne se
-- supprime, sauf avec le dossier entier. Le déclencheur lit avec les droits de l'appelant et passe avant la RLS : qui
-- ne voit pas l'encaissement est refusé sans apprendre s'il existe.
create function public.garder_transmission_encaissement() returns trigger
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
                         and e.created_at <= v_connu_le) then
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

create trigger transmissions_encaissements_gardees
  before insert or update or delete on public.transmissions_encaissements
  for each row execute function public.garder_transmission_encaissement();

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet LIT les déclarations de ses dossiers et les écrit par la fonction ci-dessous — les Edge Functions des
-- étapes d6 et d8, avec la clé secrète. Le super-administrateur en insère pour restaurer une sauvegarde : sans elles, un
-- encaissement déjà déclaré se déclarerait une seconde fois, ou se retirerait. Rien ne s'y modifie ni ne s'y supprime
-- depuis le navigateur, et le client n'y voit rien.
alter table public.transmissions_encaissements enable row level security;
create policy transmissions_encaissements_lecture on public.transmissions_encaissements
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy transmissions_encaissements_restauration on public.transmissions_encaissements
  for insert to authenticated with check (is_super_admin());

-- ══ Déclarer hors application ══════════
-- Le cabinet inscrit que le statut « Encaissée » d'un encaissement — ou d'une contre-passation — a été saisi sur la
-- plateforme : canal `manuel`, déposée, sur l'hôte que la règle impose. Pour un encaissement, la plateforme qui a
-- accepté la facture : celle de sa transmission acceptée, ou, chez Super PDP, déposée avec le statut 200 dans son
-- historique ; elle peut ne plus être la plateforme du dossier, et c'est bien là que le statut se déclare. Pour une
-- contre-passation, la plateforme où l'encaissement qu'elle annule a été déclaré. Une facture que l'application n'a pas
-- transmise ne se déclare pas d'ici : l'application ne sait pas quelle plateforme l'a reçue. L'obligation de déclarer
-- (prestations de services, TVA à l'encaissement, client établi en France…) se juge avant le clic, dans l'application
-- (lib/encaissementsFactures.ts) : une déclaration faite à la main est un fait, que la base garde.
--
-- Sous le VERROU de la ligne de la facture, comme l'enregistrement, le retrait et la contre-passation : deux
-- déclarations du même encaissement se suivent, et la seconde voit la première. Les refus, dans cet ordre — l'écran les
-- dira avant le clic, dans le même ordre :
--   1. l'accès au dossier ; 2. l'encaissement, dans ce dossier ; 3. un encaissement retiré ; 4. déjà déclaré ; 5. une
--   contre-passation dont l'encaissement n'est pas déclaré ; 6. pour un encaissement, une facture rejetée ou refusée
--   (une transmission rejetée, les statuts 210 et 213 de Super PDP) ; 7. pour un encaissement, aucune transmission de la
--   facture acceptée par une plateforme ; 8. une note de plus de 2 000 caractères (une note vide n'est pas une note).
create function public.declarer_encaissement_hors_application(
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
                   where e.facture_id = v_encaissement.facture_id and e.status_code in ('fr:210', 'fr:213')) then
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

-- ══ Contre-passer un encaissement déclaré ══════════
-- Un encaissement déclaré ne se retire ni ne se modifie : il s'annule par un encaissement de montant opposé, réparti
-- comme lui par taux, de même moyen, qui porte son motif (annexe 7, P1.17 : « un motif d'annulation ») et se déclare à
-- son tour, sur la même plateforme. Puis le bon encaissement s'enregistre : l'annulation libère le reste de la facture
-- et le mouvement.
--
-- SA DATE est celle du décaissement : le jour où l'encaissement est défait — le chèque revenu impayé, la somme rendue —
-- ou, pour une déclaration faite par erreur, le jour où elle est corrigée ; jamais avant l'encaissement qu'elle annule,
-- jamais dans l'avenir (le jour à Paris). Le statut porte « la date d'encaissement effectif » (ann. II, art. 242 nonies
-- P, I, 3°) et un montant négatif y est « un décaissement » (P1.15, P1.17) : la date est celle du décaissement effectif.
-- Et la TVA d'un encaissement qui ne s'est pas réalisé — un chèque sans provision — se régularise « sur sa plus prochaine
-- déclaration de chiffre d'affaires » (BOI-TVA-BASE-20-20, §40) : la correction vit dans la période où elle survient,
-- pas dans celle, déjà déclarée, de l'encaissement. Aucune source publique ne dit expressément la date qu'attend la
-- plateforme de l'administration sur un 212 négatif : c'est une décision, à confirmer par le cabinet.
--
-- Sous le VERROU de la ligne de la facture. Les refus, dans cet ordre — l'écran les dira avant le clic :
--   1. l'accès au dossier ; 2. l'encaissement, dans ce dossier ; 3. une contre-passation (elle ne s'annule pas : on
--   ressaisit l'encaissement) ; 4. un encaissement retiré ; 5. un encaissement que rien n'a déclaré (il se retire) ;
--   6. une déclaration dont l'issue est inconnue (elle se tranche d'abord) ; 7. déjà annulé par une contre-passation
--   vivante ; 8. la date : renseignée, pas avant l'encaissement, pas dans l'avenir ; 9. le motif : renseigné, 2 000
--   caractères au plus.
create function public.annuler_encaissement(
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

-- ══ Les droits d'exécution ══════════
-- Les deux fonctions qui écrivent vérifient l'accès elles-mêmes, et un anonyme n'a rien à y faire. La garde ne sert
-- qu'au déclencheur ; `encaissement_declare` garde les droits que l'étape d1 lui a donnés (personne en RPC).
revoke execute on function public.declarer_encaissement_hors_application(uuid, uuid, text) from public, anon;
grant execute on function public.declarer_encaissement_hors_application(uuid, uuid, text) to authenticated;
revoke execute on function public.annuler_encaissement(uuid, uuid, date, text) from public, anon;
grant execute on function public.annuler_encaissement(uuid, uuid, date, text) to authenticated;
revoke execute on function public.garder_transmission_encaissement() from public, anon, authenticated;

comment on table public.transmissions_encaissements is
  'Chaque déclaration du statut « Encaissée » (212) d''un encaissement ou d''une contre-passation : canal (manuel : saisie sur la plateforme par le cabinet ou le client ; plateforme et superpdp : par une API), hôte de la plateforme qui a reçu la facture, flux, empreinte, état. Une seule déclaration active par encaissement (transmissions_encaissements_une_active).';
comment on function public.encaissement_declare(uuid) is
  'Vrai quand une déclaration de l''encaissement est active : partie sans issue connue, déposée ou acceptée.';
comment on function public.declarer_encaissement_hors_application(uuid, uuid, text) is
  'Inscrit qu''un encaissement, ou une contre-passation, a été déclaré à la main sur la plateforme qui a reçu la facture (canal manuel), sous verrou, après les refus dits dans la migration transmissions_des_encaissements.';
comment on function public.annuler_encaissement(uuid, uuid, date, text) is
  'Contre-passe un encaissement déclaré : montant et répartition opposés, même moyen, motif, datée du décaissement ; la contre-passation se déclare à son tour.';
