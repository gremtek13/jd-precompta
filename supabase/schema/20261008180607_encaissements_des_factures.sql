-- LES ENCAISSEMENTS D'UNE FACTURE ÉMISE (ligne 28.5, étape d, premier temps : d1).
--
-- Le statut « Encaissée » (212) est le quatrième statut obligatoire d'une facture : son émetteur y dit avoir perçu un
-- paiement, partiel ou total, avec la date de l'encaissement effectif et le montant encaissé en euros PAR TAUX de TVA
-- (CGI, art. 290 A, et ann. II, art. 242 nonies P, I ; CIBS, art. L. 216-56 à compter du 01/01/2027 ;
-- BOI-TVA-DECLA-20-30-60, §50 et §120 ; spécifications externes de la DGFiP v3.2, § 3.6.4, tableau 8). L'application
-- ne connaissait aucun paiement d'une facture émise : les paiements n'existaient que pour les pièces. Cette migration
-- pose le REGISTRE de ces paiements, sans rien déclarer : la déclaration du statut (hors application d'abord, étape
-- d4) le lira, comme l'e-reporting des paiements (étape e).
--
-- UN ENCAISSEMENT EST UNE AFFIRMATION, JAMAIS UNE DÉDUCTION : il se saisit, ou se propose depuis le relevé et la pièce
-- jumelle (étape d2), et ne découle pas en silence d'un rapprochement qu'on pourrait défaire demain. Il ne se modifie
-- pas : jamais déclaré, il se RETIRE (retire_le) ; déclaré, il se CONTRE-PASSE par une annulation de montant opposé,
-- motivée, qui se déclare à son tour — « un décaissement signifié par une valeur négative », qui porte « un motif
-- d'annulation » (annexe 7 des spécifications externes, règles P1.15 et P1.17). La plateforme de l'administration ne
-- dédoublonne pas les statuts (§ 3.6.7, note 109) : un encaissement compté deux fois l'est pour de bon, et la TVA que
-- l'administration en déduit avec lui. D'où un registre immuable, plafonné par la facture et tenu sous verrou.
--
-- CE QUI NAÎT ICI, ET CE QUI ATTEND LES DÉCLARATIONS (étape d4) : la contre-passation n'a de sens que pour un
-- encaissement DÉCLARÉ, et aucune déclaration n'existe encore. La table en porte pourtant dès maintenant les colonnes
-- (annule_id, motif), la règle du signe, l'unicité de l'annulation vivante et les règles de son déclencheur, pour que
-- d4 n'ait rien à y réécrire ; la fonction qui contre-passe naîtra avec la déclaration qu'elle suppose, et
-- `encaissement_declare` — qui ne peut que répondre non tant que rien ne se déclare — recevra alors son vrai corps.
--
-- Données mesurées le 08/10/2026 (comptes seulement) : six factures, toutes validées, toutes d'un seul taux ; aucune
-- transmission, aucun événement de Super PDP. Rien n'est encaissé : tout ce qui suit est latent.

-- ══ Le TTC par taux d'une facture, exactement comme l'application le calcule ══════════
-- Le 212 répartit le montant encaissé par taux (règle G7.45 : sinon le statut est rejeté, motif REJ_ENCAISSEMENT), et
-- la plateforme comme l'administration le jugent contre la ventilation que la facture a TRANSMISE (BG-23) : celle de
-- `montantsDuDocument` (src/lib/factureCii.ts), ligne par ligne par `calculerLigne` (src/lib/montantsFacture.ts), en
-- nombres à virgule flottante, au centime, sommée par taux en centimes entiers. Ce calcul n'est stocké nulle part ; la
-- base le refait ici à l'identique, opération par opération, en double précision — un calcul en `numeric` donnerait
-- 1,01 € de HT à une ligne à 1,005 € que l'application compte 1,00 € (1,005 ne s'écrit pas exactement en binaire), et
-- la base plafonnerait l'encaissement sur un centime que la facture transmise ne porte pas. Le passage de `numeric` à
-- `double precision` est celui du navigateur — le nombre binaire le plus proche du décimal, comme JSON.parse le lit — ;
-- l'arrondi est celui de Math.round (au plus proche, le demi vers +∞), écrit à partir de floor() plutôt que de
-- round(double precision), dont la règle d'égalité dépend de la plateforme. Un test de l'application confronte les deux
-- calculs à une table relevée en base (étape d1, second temps).
create function public.centimes_ligne_facture(
  p_quantite numeric, p_prix_unitaire_ht numeric, p_taux_tva numeric, p_avoir boolean)
returns table (ht_centimes bigint, tva_centimes bigint)
language plpgsql
immutable
set search_path = public
as $$
declare
  q double precision := p_quantite::double precision;
  p double precision := p_prix_unitaire_ht::double precision;
  x double precision;
  v double precision;
  n double precision;
  ht double precision;
  tva double precision;
begin
  -- La ligne dans le sens du document : un avoir se lit en montants positifs (type 381), une remise saisie à prix
  -- négatif se transmet en quantité négative au même produit.
  if p_avoir then
    q := q * (-1)::double precision;
  end if;
  if p < 0::double precision then
    q := -q;
    p := -p;
  end if;
  -- auCentime(quantité × prix) : Math.round(|x| × 100) / 100, de signe x.
  x := q * p;
  v := abs(x) * 100::double precision;
  n := floor(v);
  if v - n >= 0.5::double precision then n := n + 1::double precision; end if;
  ht := n / 100::double precision;
  if ht = 0::double precision then ht := 0::double precision; elsif x < 0::double precision then ht := -ht; end if;
  -- auCentime(HT × (taux / 100)).
  x := ht * (p_taux_tva::double precision / 100::double precision);
  v := abs(x) * 100::double precision;
  n := floor(v);
  if v - n >= 0.5::double precision then n := n + 1::double precision; end if;
  tva := n / 100::double precision;
  if tva = 0::double precision then tva := 0::double precision; elsif x < 0::double precision then tva := -tva; end if;
  -- centimes(montant) = Math.round(montant × 100).
  v := ht * 100::double precision;
  n := floor(v);
  if v - n >= 0.5::double precision then n := n + 1::double precision; end if;
  ht_centimes := n::bigint;
  v := tva * 100::double precision;
  n := floor(v);
  if v - n >= 0.5::double precision then n := n + 1::double precision; end if;
  tva_centimes := n::bigint;
  return next;
end
$$;

-- Les montants d'une facture par taux, en centimes : base, TVA, et leur somme (le TTC du taux). Une ligne par taux de
-- ses lignes, comme les groupes de `montantsDuDocument` (dont la catégorie, S ou E, suit le taux).
create function public.montants_par_taux_facture(p_facture_id uuid)
returns table (taux numeric, base_centimes bigint, tva_centimes bigint, ttc_centimes bigint)
language sql
stable
set search_path = public
as $$
  select l.taux_tva, sum(c.ht_centimes)::bigint, sum(c.tva_centimes)::bigint,
         (sum(c.ht_centimes) + sum(c.tva_centimes))::bigint
  from public.factures_emises f
  join public.facture_lignes l on l.facture_id = f.id
  cross join lateral public.centimes_ligne_facture(l.quantite, l.prix_unitaire_ht, l.taux_tva, f.type = 'avoir') c
  where f.id = p_facture_id
  group by l.taux_tva
$$;

-- ══ Les tables ══════════
-- Un encaissement d'une facture validée, ou l'annulation d'un encaissement déclaré. Les montants sont au centime, en
-- euros (art. 242 nonies P, I, 4°), et bornés : moins de dix mille milliards d'euros, ce que le navigateur compte
-- encore exactement au centime — la borne écarte aussi les valeurs spéciales d'un `numeric` (NaN, l'infini), que les
-- autres conditions laisseraient passer. Le moyen de paiement décide de la date à retenir (la remise d'un chèque, pas
-- son crédit : BOI-TVA-BASE-20-20, §40) ; le mouvement bancaire qui le prouve est facultatif — un paiement en espèces
-- ou par compensation n'en a pas — et sa clé est sans action à la suppression : un mouvement ne disparaît qu'avec son
-- dossier, et une preuve qui s'effacerait en silence ferait mentir l'encaissement.
create table public.encaissements_factures (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  facture_id uuid not null references public.factures_emises (id) on delete cascade,
  date_encaissement date not null
    constraint encaissements_factures_date check (date_encaissement >= date '2000-01-01'),
  montant numeric not null
    constraint encaissements_factures_montant
      check (montant <> 0 and montant = round(montant, 2) and abs(montant) < 10000000000000),
  moyen text not null
    constraint encaissements_factures_moyen
      check (moyen in ('virement', 'cheque', 'carte', 'prelevement', 'especes', 'effet', 'compensation', 'autre')),
  ligne_bancaire_id uuid references public.lignes_bancaires (id),
  annule_id uuid references public.encaissements_factures (id),
  motif text constraint encaissements_factures_motif check (btrim(motif) <> '' and length(motif) <= 2000),
  cree_par uuid,
  cree_le timestamptz not null default now(),
  retire_le timestamptz,
  retire_par uuid,
  -- LA RÈGLE DU SIGNE : un montant négatif est une annulation, et une annulation est négative (P1.15) ; elle porte
  -- son motif (P1.17), et seule elle en porte un. Elle ne se justifie par aucun mouvement : elle défait une
  -- déclaration, pas un paiement.
  constraint encaissements_factures_signe check ((montant < 0) = (annule_id is not null)),
  constraint encaissements_factures_motif_d_une_annulation check ((annule_id is null) = (motif is null)),
  constraint encaissements_factures_annulation_sans_mouvement check (annule_id is null or ligne_bancaire_id is null)
);

-- Une seule annulation VIVANTE par encaissement : contre-passé deux fois, il serait déduit deux fois. Partiel, et
-- c'est voulu — une annulation jamais déclarée se retire, et l'encaissement peut alors être annulé de nouveau. Aucun
-- upsert ne le vise : une annulation s'insère.
create unique index encaissements_factures_une_annulation on public.encaissements_factures (annule_id)
  where retire_le is null;
create index encaissements_factures_facture on public.encaissements_factures (facture_id);
create index encaissements_factures_dossier on public.encaissements_factures (dossier_id);
create index encaissements_factures_ligne_bancaire on public.encaissements_factures (ligne_bancaire_id);

-- La répartition d'un encaissement par taux de TVA (G7.45), du signe de son encaissement. Les taux sont ceux que la
-- DGFiP admet (règle G1.24), la liste même de TAUX_ADMIS (src/lib/factureCii.ts), qu'un test confronte à celle-ci.
create table public.encaissements_factures_taux (
  encaissement_id uuid not null references public.encaissements_factures (id) on delete cascade,
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  taux numeric not null
    constraint encaissements_factures_taux_taux
      check (taux in (0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6)),
  montant numeric not null
    constraint encaissements_factures_taux_montant
      check (montant <> 0 and montant = round(montant, 2) and abs(montant) < 10000000000000),
  primary key (encaissement_id, taux)
);
create index encaissements_factures_taux_dossier on public.encaissements_factures_taux (dossier_id);

-- ══ Ce qui fait d'un encaissement un encaissement déclaré ══════════
-- Aucune déclaration n'existe avant l'étape d4 : rien n'est déclaré, et un encaissement se retire tant qu'il ne l'est
-- pas. La migration de d4, qui crée les déclarations, remplace ce corps ; le déclencheur et la fonction de retrait,
-- qui l'appellent déjà, n'ont pas à changer.
create function public.encaissement_declare(p_encaissement_id uuid) returns boolean
language sql
stable
set search_path = public
as $$
  select false
$$;

-- ══ La garde ══════════
-- Un encaissement désigne une facture VALIDÉE de son dossier — jamais un brouillon, jamais un avoir (son remboursement
-- n'entre pas dans ce registre) — et, s'il en cite un, un CRÉDIT de son dossier. Une annulation contre-passe, montant
-- pour montant, un encaissement de la même facture qui n'est pas lui-même une annulation ; vivante, elle ne vise pas un
-- encaissement retiré (jamais déclaré, il n'y a rien à annuler) — une restauration rejoue en revanche l'historique
-- d'une annulation retirée. Après l'insertion rien ne change, sauf le retrait, une fois, d'un encaissement que rien
-- n'a déclaré et qu'aucune annulation vivante ne vise. Rien ne se supprime, sauf avec le dossier entier, que sa ligne
-- ne voit déjà plus. Le déclencheur lit avec les droits de l'appelant et passe avant la RLS : qui ne voit pas la
-- facture est refusé sans apprendre si elle existe.
create function public.garder_encaissement_facture() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cible public.encaissements_factures;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Un encaissement ne se supprime pas : jamais déclaré, il se retire ; déclaré, il se contre-passe.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if not exists (select 1 from public.factures_emises f
                    where f.id = new.facture_id and f.dossier_id = new.dossier_id
                      and f.statut = 'validee' and f.type = 'facture') then
      raise exception 'Seule une facture validée de son dossier reçoit un encaissement : jamais un brouillon, jamais un avoir.'
        using errcode = '23514';
    end if;
    if new.ligne_bancaire_id is not null
       and not exists (select 1 from public.lignes_bancaires l
                        where l.id = new.ligne_bancaire_id and l.dossier_id = new.dossier_id and l.montant > 0) then
      raise exception 'Un encaissement se justifie par un crédit de son dossier.' using errcode = '23514';
    end if;
    if new.annule_id is not null then
      select * into v_cible from public.encaissements_factures c where c.id = new.annule_id;
      if not found or v_cible.facture_id <> new.facture_id then
        raise exception 'Une annulation contre-passe un encaissement de la même facture.' using errcode = '23514';
      end if;
      if v_cible.annule_id is not null then
        raise exception 'Une annulation ne se contre-passe pas : l''encaissement qu''elle annulait se saisit de nouveau.'
          using errcode = '23514';
      end if;
      if new.montant <> -v_cible.montant then
        raise exception 'Une annulation contre-passe l''encaissement montant pour montant.' using errcode = '23514';
      end if;
      if new.retire_le is null and v_cible.retire_le is not null then
        raise exception 'Un encaissement retiré ne s''annule pas : il n''a jamais été déclaré.' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if (to_jsonb(new) - array['retire_le', 'retire_par']) is distinct from (to_jsonb(old) - array['retire_le', 'retire_par'])
     or old.retire_le is not null and (new.retire_le, new.retire_par) is distinct from (old.retire_le, old.retire_par)
     or new.retire_le is null and new.retire_par is distinct from old.retire_par then
    raise exception 'Un encaissement ne se modifie pas : jamais déclaré, il se retire, une fois ; déclaré, il se contre-passe.'
      using errcode = '23514';
  end if;
  if old.retire_le is null and new.retire_le is not null then
    if public.encaissement_declare(old.id) then
      raise exception 'Un encaissement déclaré ne se retire pas : il se contre-passe, et l''annulation se déclare à son tour.'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.encaissements_factures c where c.annule_id = old.id and c.retire_le is null) then
      raise exception 'Cet encaissement est annulé par une contre-passation : retirez d''abord celle-ci.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger encaissements_factures_gardes before insert or update or delete on public.encaissements_factures
  for each row execute function public.garder_encaissement_facture();

-- Une part par taux appartient à un encaissement de son dossier, en porte le signe, vise un taux des lignes de sa
-- facture, et les parts d'un encaissement ne dépassent jamais son montant — elles le font exactement quand la fonction
-- les écrit, d'un seul tenant ; une restauration les réinsère par lots. Elle ne se modifie pas, et ne part qu'avec son
-- encaissement ou son dossier.
create function public.garder_encaissement_facture_taux() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_encaissement public.encaissements_factures;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.encaissements_factures e where e.id = old.encaissement_id)
       or not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'La répartition d''un encaissement ne se supprime pas : elle part avec lui.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'La répartition d''un encaissement ne se modifie pas.' using errcode = '23514';
  end if;

  select * into v_encaissement from public.encaissements_factures e where e.id = new.encaissement_id;
  if not found or v_encaissement.dossier_id <> new.dossier_id then
    raise exception 'Une part par taux appartient à un encaissement de son dossier.' using errcode = '23514';
  end if;
  if sign(new.montant) <> sign(v_encaissement.montant) then
    raise exception 'Une part par taux est du signe de son encaissement.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.facture_lignes l
                  where l.facture_id = v_encaissement.facture_id and l.taux_tva = new.taux) then
    raise exception 'Une part par taux vise un taux des lignes de sa facture.' using errcode = '23514';
  end if;
  if (select coalesce(sum(abs(t.montant)), 0) from public.encaissements_factures_taux t
       where t.encaissement_id = new.encaissement_id) + abs(new.montant) > abs(v_encaissement.montant) then
    raise exception 'Les parts par taux dépasseraient le montant de leur encaissement.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger encaissements_factures_taux_gardes
  before insert or update or delete on public.encaissements_factures_taux
  for each row execute function public.garder_encaissement_facture_taux();

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet LIT les encaissements de ses dossiers et les écrit par les deux fonctions ci-dessous, seules à le faire
-- depuis le navigateur — les tables n'ont aucune policy d'écriture ordinaire. Le super-administrateur en insère pour
-- restaurer une sauvegarde : sans eux, un encaissement déjà déclaré pourrait se saisir et se déclarer une seconde fois.
-- Le client n'y voit rien.
alter table public.encaissements_factures enable row level security;
create policy encaissements_factures_lecture on public.encaissements_factures
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy encaissements_factures_restauration on public.encaissements_factures
  for insert to authenticated with check (is_super_admin());

alter table public.encaissements_factures_taux enable row level security;
create policy encaissements_factures_taux_lecture on public.encaissements_factures_taux
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy encaissements_factures_taux_restauration on public.encaissements_factures_taux
  for insert to authenticated with check (is_super_admin());

-- ══ Enregistrer un encaissement ══════════
-- D'UN SEUL TENANT : l'encaissement et sa répartition, sous le VERROU de la ligne de la facture — deux encaissements
-- concurrents de la même facture se suivent, et le second voit le premier — et, s'il cite un mouvement, sous celui du
-- mouvement, qu'un même virement peut partager entre plusieurs factures. FOR NO KEY UPDATE : il exclut un autre
-- encaissement ou un retrait de la même facture sans bloquer l'insertion d'une ligne qui la désigne (une transmission).
--
-- Les refus, dans cet ordre — l'écran (étape d3) les dit avant le clic, dans le même ordre (module d2) :
--   1. l'accès au dossier ; 2. la facture, dans ce dossier ; 3. une facture validée ; 4. pas un avoir ; 5. ni rejetée
--   par une plateforme, ni rejetée ou refusée chez Super PDP (la règle même de `garder_transmission_facture` : elle
--   s'annule par un avoir interne, § 3.6.4) ; 6. des lignes qui redonnent les montants enregistrés ; 7. la date :
--   renseignée, pas avant l'an 2000, pas dans l'avenir (le jour à Paris) ; 8. un montant positif, au centime ; 9. un
--   moyen de paiement connu ; 10. le mouvement, s'il en cite un : de ce dossier, un crédit, qui ne justifie pas déjà un
--   encaissement de cette facture, et dont les encaissements ne dépasseraient pas le montant au-delà de l'écart que
--   des frais expliquent (le seuil min(2 %, 5 €) de lib/alignementBanque.ts, décision du cabinet du 23/09/2026) ;
--   11. la répartition : lisible, sans taux répété, des taux de la facture et admis, des parts positives au centime,
--   dont la somme fait le montant ; 12. les plafonds : le reste de la facture, puis le reste de chaque taux.
-- Les montants déjà encaissés sont NETS : les encaissements non retirés, annulations comprises.
create function public.enregistrer_encaissement(
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
                 where e.facture_id = p_facture_id and e.status_code in ('fr:210', 'fr:213')) then
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

-- ══ Retirer un encaissement que rien n'a déclaré ══════════
-- Il reste au registre, marqué retiré (par qui, quand), et cesse de compter : rien ne se supprime. Refus dans cet
-- ordre : l'accès au dossier, l'encaissement dans ce dossier, déjà retiré, déclaré (il se contre-passe), annulé par une
-- contre-passation vivante (elle se retire d'abord). Sous le verrou de la facture, comme l'enregistrement.
create function public.retirer_encaissement(p_dossier_id uuid, p_encaissement_id uuid)
returns public.encaissements_factures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_encaissement public.encaissements_factures;
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

-- ══ Les droits d'exécution ══════════
-- Les deux fonctions qui écrivent vérifient l'accès elles-mêmes, et un anonyme n'a rien à y faire. Les autres ne
-- servent qu'au déclencheur et aux fonctions : personne ne les appelle en RPC.
revoke execute on function public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb) from public, anon;
grant execute on function public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb) to authenticated;
revoke execute on function public.retirer_encaissement(uuid, uuid) from public, anon;
grant execute on function public.retirer_encaissement(uuid, uuid) to authenticated;
revoke execute on function public.centimes_ligne_facture(numeric, numeric, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.montants_par_taux_facture(uuid) from public, anon, authenticated;
revoke execute on function public.encaissement_declare(uuid) from public, anon, authenticated;
revoke execute on function public.garder_encaissement_facture() from public, anon, authenticated;
revoke execute on function public.garder_encaissement_facture_taux() from public, anon, authenticated;

comment on table public.encaissements_factures is
  'Les encaissements d''une facture émise validée (statut « Encaissée », 212) et les annulations d''encaissements déclarés (montant négatif, motif). Immuable : un encaissement se retire tant que rien ne l''a déclaré, se contre-passe ensuite.';
comment on table public.encaissements_factures_taux is
  'La répartition d''un encaissement par taux de TVA (règle G7.45), du signe de son encaissement.';
comment on function public.centimes_ligne_facture(numeric, numeric, numeric, boolean) is
  'HT et TVA d''une ligne de facture en centimes, calculés exactement comme calculerLigne et montantsDuDocument (double précision, Math.round).';
comment on function public.montants_par_taux_facture(uuid) is
  'Base, TVA et TTC d''une facture par taux, en centimes, tels que la facture électronique les transmet (BG-23).';
comment on function public.encaissement_declare(uuid) is
  'Vrai quand une déclaration de l''encaissement est active ou faite. Aucune déclaration avant l''étape d4 : faux.';
comment on function public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb) is
  'Enregistre un encaissement d''une facture validée et sa répartition par taux, d''un seul tenant et sous verrou, après les refus dits dans la migration encaissements_des_factures.';
comment on function public.retirer_encaissement(uuid, uuid) is
  'Retire un encaissement que rien n''a déclaré et qu''aucune annulation vivante ne vise : il reste au registre, marqué retiré.';
