-- LA BANQUE DU CLIENT EN BASE, PREMIER TEMPS : CE QUI S'AJOUTE (espace client, étape P7 ; décision du cabinet du
-- 09/10/2026 d'ouvrir au client « la vision bancaire » ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE
-- LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §2.5, §3.3, §3.6, §6 ; EC-Q1, EC-Q5 et EC-Q6 sans réponse, leurs
-- recommandations prises comme hypothèses : « Ma simulation » suit la case « Banque », un seul compte par dossier).
--
-- CE QUE CETTE MIGRATION POSE — rien ne s'y ouvre à un accès qui ne porte pas la case « Banque » :
--   1. `justificatifs_proposes` : la pièce qu'un accès propose comme justificatif d'un mouvement du relevé. Une parole
--      datée et signée, qui n'écrit RIEN dans le relevé — le rapprochement reste au cabinet, qui la verra en tête des
--      candidates de la fiche du mouvement (étape P9). Elle se RETIRE (`retire_le`), ne se modifie ni ne se supprime, et
--      part avec la pièce, le mouvement ou le dossier : une pièce supprimée emporte sa proposition, et le mouvement
--      redevient « sans justificatif » ;
--   2. `precisions_mouvements` : le fil d'un mouvement — la question du cabinet, la réponse du client —, à part de
--      `piece_commentaires`, qui demanderait de retirer puis remplacer sa contrainte d'une seule cible, sur une table
--      gardée, et mêlerait deux règles de lecture (tout accès pour une pièce, la case « Banque » pour un mouvement).
--      L'origine est DÉDUITE de l'appelant, jamais déclarée ; une précision ne se modifie pas ; le cabinet seul retire
--      un message hors sujet ;
--   3. leurs trois fonctions, seules à les écrire depuis le navigateur — pour le client comme pour le cabinet, un seul
--      chemin : `proposer_justificatif`, `retirer_proposition`, `ecrire_precision_mouvement` ;
--   4. la LECTURE de `controles_releves_bancaires` — le contrôle du solde d'un relevé importé — par un accès qui porte la
--      case « Banque » : le solde « au relevé du … » de « Ma banque » (P9) s'y lira, jamais calculé (conception, §6.4) ;
--   5. `couverture_du_releve` : les MOIS où le relevé du dossier porte au moins un mouvement — ni montant, ni libellé, ni
--      jour —, pour le cabinet et pour TOUT accès au dossier. L'Accueil et « Mes pièces » du client y liront les relevés
--      qui manquent, au lieu de lire les mouvements eux-mêmes.
--
-- CE QU'ELLE NE FAIT PAS : elle ne retire rien à personne. Les lectures d'aujourd'hui des mouvements, des parts d'un
-- mouvement ventilé et des règlements groupés, ouvertes à tout accès client, se resserrent au droit « Banque » dans une
-- migration à part (`lectures_bancaires_au_droit_banque`), qui ne s'applique qu'une fois l'Accueil et « Mes pièces »
-- passés à la couverture : une lecture que la RLS refuse rend ZÉRO ligne, sans erreur, et un écran qui lirait encore les
-- mouvements croirait le relevé vide et réclamerait tous les mois de l'année (conception, §6.1).
--
-- LES DROITS : la case « Banque » d'un accès (`memberships.droit_banque`, étape P1) se lit par `client_du_dossier` et
-- `gere_la_banque` — le cabinet du dossier, ou un accès qui porte la case. Chaque policy est `to authenticated` (un
-- prédicat ne doit jamais pouvoir être vrai sans session), chaque fonction `SECURITY DEFINER` à `search_path` fixé,
-- exécution retirée à `anon` et à PUBLIC. Un refus d'accès dit « Accès refusé à ce dossier. » (42501) pour tous : il ne
-- dit pas si le dossier existe. Les autres refus sont en 22023, sauf l'auteur d'une proposition (42501), et suivent
-- l'ordre écrit au-dessus de chaque fonction ; le module de l'étape P9 les redira avant le clic, sous les mêmes mots.
--
-- SOURCES : règlement (UE) 2016/679, art. 25 § 2 (par défaut, seules les données nécessaires sont accessibles : rien ne
-- s'ouvre sans la case) et art. 32 § 1 b) ; code monétaire et financier, art. L. 133-41 (seul le titulaire du compte
-- consent à l'information sur ses comptes — d'où une case par accès, posée par le cabinet) ; documentation de
-- PostgreSQL, « Writing SECURITY DEFINER Functions Safely » et « Row Security Policies » (une ligne que la policy refuse
-- en lecture n'est pas rendue, sans erreur).

-- ══ Les propositions de justificatif ══════════
-- Une ligne par pièce proposée pour un mouvement. L'auteur est un repère d'audit sans clé étrangère, comme
-- `exercices_valides.valide_par` : retirer le compte d'une personne partie ne doit pas effacer qui a proposé. `origine`
-- est déduite à l'écriture (le cabinet du dossier, ou un accès client) et ne se recalcule jamais : ce qu'était l'auteur
-- au moment où il a proposé ne change pas.
create table public.justificatifs_proposes (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  ligne_bancaire_id uuid not null references public.lignes_bancaires (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  auteur_id uuid not null,
  origine text not null
    constraint justificatifs_proposes_origine check (origine in ('client', 'cabinet')),
  created_at timestamptz not null default now(),
  retire_le timestamptz,
  retire_par uuid,
  constraint justificatifs_proposes_retrait check ((retire_le is null) = (retire_par is null)),
  constraint justificatifs_proposes_retrait_apres check (retire_le is null or retire_le >= created_at)
);

-- Une pièce n'est proposée qu'UNE fois à la fois pour un même mouvement ; retirée, elle peut l'être de nouveau. Partiel,
-- et c'est un invariant : aucun upsert ne le vise, une proposition s'insère (`proposer_justificatif`), et deux appels
-- simultanés se suivent sous le verrou du mouvement — celui-ci n'est qu'un dernier rempart.
create unique index justificatifs_proposes_une_active on public.justificatifs_proposes (ligne_bancaire_id, piece_id)
  where retire_le is null;
-- Les suppressions en cascade d'un mouvement ou d'une pièce cherchent leurs propositions, retirées comprises.
create index justificatifs_proposes_mouvement on public.justificatifs_proposes (ligne_bancaire_id);
create index justificatifs_proposes_piece on public.justificatifs_proposes (piece_id);
create index justificatifs_proposes_dossier on public.justificatifs_proposes (dossier_id);

-- ══ Les précisions sur un mouvement ══════════
-- Le fil d'un mouvement. Des blancs seuls (espaces, tabulations, retours à la ligne) ne sont pas une précision ; deux
-- mille caractères suffisent à une question et à sa réponse, et bornent ce qu'un compte écrirait en masse.
create table public.precisions_mouvements (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  ligne_bancaire_id uuid not null references public.lignes_bancaires (id) on delete cascade,
  auteur_id uuid not null,
  origine text not null
    constraint precisions_mouvements_origine check (origine in ('client', 'cabinet')),
  texte text not null
    constraint precisions_mouvements_texte check (btrim(texte, E' \t\n\r') <> '' and length(texte) <= 2000),
  created_at timestamptz not null default now()
);
create index precisions_mouvements_mouvement on public.precisions_mouvements (ligne_bancaire_id);
create index precisions_mouvements_dossier on public.precisions_mouvements (dossier_id);

-- ══ Les gardes ══════════
-- Une proposition rapproche un mouvement et une pièce de SON dossier — le `dossier_id` porté en propre est la clé des
-- policies, et sans ce contrôle il ouvrirait la proposition d'un autre dossier à qui lit celui-ci. Elle ne se modifie que
-- pour être retirée, une fois, `retire_le` et `retire_par` ensemble ; elle ne se supprime qu'avec sa pièce, son mouvement
-- ou son dossier (la ligne qui la désignait n'est alors plus là : c'est la cascade). Aux droits de l'appelant, et avant
-- la RLS : qui ne voit pas le mouvement ou la pièce est refusé sans apprendre s'ils existent.
create function public.garder_justificatif_propose() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.pieces p where p.id = old.piece_id)
       or not exists (select 1 from public.lignes_bancaires l where l.id = old.ligne_bancaire_id)
       or not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une proposition de justificatif ne se supprime pas : elle se retire, et reste datée.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.retire_le is not null or new.retire_le is null or new.retire_par is null
       or (to_jsonb(new) - array['retire_le', 'retire_par']) is distinct from (to_jsonb(old) - array['retire_le', 'retire_par']) then
      raise exception 'Une proposition de justificatif ne se modifie pas : elle se retire, une fois.' using errcode = '23514';
    end if;
    return new;
  end if;
  if not exists (select 1 from public.lignes_bancaires l where l.id = new.ligne_bancaire_id and l.dossier_id = new.dossier_id)
     or not exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id) then
    raise exception 'Une proposition rapproche un mouvement et une pièce de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger justificatifs_proposes_gardes
  before insert or update or delete on public.justificatifs_proposes
  for each row execute function public.garder_justificatif_propose();

-- Une précision porte sur un mouvement de SON dossier, et ne se réécrit pas : une parole datée qu'on corrige après coup
-- perd sa valeur ; on se corrige en ajoutant. La suppression d'un message hors sujet reste au cabinet (sa policy).
create function public.garder_precision_mouvement() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Une précision ne se modifie pas : on se corrige en ajoutant, pas en effaçant.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.lignes_bancaires l where l.id = new.ligne_bancaire_id and l.dossier_id = new.dossier_id) then
    raise exception 'Une précision porte sur un mouvement de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger precisions_mouvements_gardes
  before insert or update on public.precisions_mouvements
  for each row execute function public.garder_precision_mouvement();

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet du dossier et un accès qui porte la case « Banque » LISENT ; personne n'écrit directement, sauf le
-- super-administrateur qui restaure une sauvegarde ; le cabinet seul retire une précision hors sujet. Un accès sans la
-- case n'y voit rien, pas même sur son dossier.
alter table public.justificatifs_proposes enable row level security;
create policy justificatifs_proposes_lecture on public.justificatifs_proposes
  for select to authenticated using (gere_la_banque(dossier_id));
create policy justificatifs_proposes_restauration on public.justificatifs_proposes
  for insert to authenticated with check (is_super_admin());

alter table public.precisions_mouvements enable row level security;
create policy precisions_mouvements_lecture on public.precisions_mouvements
  for select to authenticated using (gere_la_banque(dossier_id));
create policy precisions_mouvements_restauration on public.precisions_mouvements
  for insert to authenticated with check (is_super_admin());
create policy precisions_mouvements_suppression_cabinet on public.precisions_mouvements
  for delete to authenticated using (admin_du_dossier(dossier_id));

-- Le contrôle du solde d'un relevé importé : le cabinet le lit déjà (`controles_releves_bancaires_all`) ; un accès qui
-- porte la case « Banque » le LIT désormais aussi, sans pouvoir l'écrire.
create policy controles_releves_bancaires_lecture_banque on public.controles_releves_bancaires
  for select to authenticated using (client_du_dossier(dossier_id, 'banque'));

-- ══ Proposer un justificatif ══════════
-- Un mouvement et une pièce du dossier annoncé, par le cabinet ou par un accès qui porte la case « Banque ». Rien n'est
-- écrit dans le relevé. Les refus, dans cet ordre :
--   1. un appelant qui ne gère pas la banque du dossier annoncé, ou un dossier qui n'existe pas (42501) ;
--   2. un mouvement qui n'est pas un mouvement de ce dossier ;
--   3. une pièce qui n'est pas une pièce de ce dossier ;
--   4. un mouvement d'un exercice figé par la validation : le cabinet ne pourrait plus le rapprocher ;
--   5. la même pièce déjà proposée pour ce mouvement, et pas retirée.
-- Sous le verrou partagé de la validation (une validation n'avance pas pendant une proposition), le mouvement verrouillé :
-- deux propositions simultanées du même mouvement se suivent, et la seconde voit la première. Elle rend la proposition
-- écrite, son identifiant et son instant compris.
create function public.proposer_justificatif(p_dossier_id uuid, p_ligne_bancaire_id uuid, p_piece_id uuid)
returns public.justificatifs_proposes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mouvement public.lignes_bancaires;
  v_frontiere date;
  v_proposition public.justificatifs_proposes;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : un dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.gere_la_banque(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  -- 2.
  select * into v_mouvement from public.lignes_bancaires l
   where l.id = p_ligne_bancaire_id and l.dossier_id = p_dossier_id
   for no key update;
  if not found then
    raise exception 'Ce mouvement n''est pas un mouvement de ce dossier.' using errcode = '22023';
  end if;
  -- 3.
  perform 1 from public.pieces p where p.id = p_piece_id and p.dossier_id = p_dossier_id for share;
  if not found then
    raise exception 'Cette pièce n''est pas une pièce de ce dossier.' using errcode = '22023';
  end if;
  -- 4.
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_mouvement.date <= v_frontiere then
    raise exception '% : un justificatif ne s''y propose plus.',
      public.exercice_fige(p_dossier_id, extract(year from v_mouvement.date)::integer) using errcode = '22023';
  end if;
  -- 5.
  if exists (select 1 from public.justificatifs_proposes j
              where j.ligne_bancaire_id = p_ligne_bancaire_id and j.piece_id = p_piece_id and j.retire_le is null) then
    raise exception 'Cette pièce est déjà proposée pour ce mouvement.' using errcode = '22023';
  end if;
  insert into public.justificatifs_proposes (dossier_id, ligne_bancaire_id, piece_id, auteur_id, origine)
  values (p_dossier_id, p_ligne_bancaire_id, p_piece_id, auth.uid(),
          case when public.admin_du_dossier(p_dossier_id) then 'cabinet' else 'client' end)
  returning * into v_proposition;
  return v_proposition;
end;
$$;

-- ══ Retirer une proposition ══════════
-- Elle reste, datée : `retire_le` et `retire_par` disent quand et qui. Les refus, dans cet ordre :
--   1. un appelant qui ne gère pas la banque du dossier annoncé, ou un dossier qui n'existe pas (42501) ;
--   2. une proposition qui n'est pas une proposition de ce dossier ;
--   3. un accès client qui n'en est pas l'auteur — son auteur et le cabinet la retirent (42501) ;
--   4. une proposition déjà retirée.
create function public.retirer_proposition(p_dossier_id uuid, p_proposition_id uuid)
returns public.justificatifs_proposes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposition public.justificatifs_proposes;
begin
  -- 1.
  if not public.gere_la_banque(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2.
  select * into v_proposition from public.justificatifs_proposes j
   where j.id = p_proposition_id and j.dossier_id = p_dossier_id
   for update;
  if not found then
    raise exception 'Cette proposition n''est pas une proposition de ce dossier.' using errcode = '22023';
  end if;
  -- 3.
  if v_proposition.auteur_id is distinct from auth.uid() and not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Seuls son auteur et le cabinet retirent cette proposition.' using errcode = '42501';
  end if;
  -- 4.
  if v_proposition.retire_le is not null then
    raise exception 'Cette proposition est déjà retirée, depuis le %.',
      to_char(v_proposition.retire_le at time zone 'Europe/Paris', 'DD/MM/YYYY') using errcode = '22023';
  end if;
  update public.justificatifs_proposes j
     set retire_le = now(), retire_par = auth.uid()
   where j.id = p_proposition_id
  returning j.* into v_proposition;
  return v_proposition;
end;
$$;

-- ══ Écrire une précision ══════════
-- La question du cabinet ou la réponse du client, sur un mouvement du dossier annoncé. Les refus, dans cet ordre :
--   1. un appelant qui ne gère pas la banque du dossier annoncé, ou un dossier qui n'existe pas (42501) ;
--   2. un mouvement qui n'est pas un mouvement de ce dossier ;
--   3. une précision vide, ou faite de blancs ;
--   4. une précision de plus de deux mille caractères.
-- Le texte s'écrit tel quel ; l'origine est déduite de l'appelant.
create function public.ecrire_precision_mouvement(p_dossier_id uuid, p_ligne_bancaire_id uuid, p_texte text)
returns public.precisions_mouvements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_precision public.precisions_mouvements;
begin
  -- 1.
  if not public.gere_la_banque(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2.
  perform 1 from public.lignes_bancaires l where l.id = p_ligne_bancaire_id and l.dossier_id = p_dossier_id for share;
  if not found then
    raise exception 'Ce mouvement n''est pas un mouvement de ce dossier.' using errcode = '22023';
  end if;
  -- 3.
  if p_texte is null or btrim(p_texte, E' \t\n\r') = '' then
    raise exception 'Une précision vide ne s''écrit pas.' using errcode = '22023';
  end if;
  -- 4.
  if length(p_texte) > 2000 then
    raise exception 'Une précision tient en 2 000 caractères au plus.' using errcode = '22023';
  end if;
  insert into public.precisions_mouvements (dossier_id, ligne_bancaire_id, auteur_id, origine, texte)
  values (p_dossier_id, p_ligne_bancaire_id, auth.uid(),
          case when public.admin_du_dossier(p_dossier_id) then 'cabinet' else 'client' end, p_texte)
  returning * into v_precision;
  return v_precision;
end;
$$;

-- ══ La couverture du relevé ══════════
-- Les mois (le premier jour de chacun) où le relevé du dossier porte au moins un mouvement, dans l'ordre : ce que
-- l'Accueil et « Mes pièces » demandent pour dire au client quels relevés manquent. Ni montant, ni libellé, ni jour :
-- tout accès au dossier la lit, avec ou sans la case « Banque », comme le cabinet. Un tableau en UNE valeur, et non un
-- ensemble de lignes : PostgREST plafonne les lignes qu'il rend sans le dire, pas une valeur. Le mois se tronque sur un
-- `timestamp` SANS fuseau : un `date` passé tel quel à `date_trunc` y prendrait la variante à fuseau, celui de la session
-- (une date civile n'a pas de fuseau). Refuse (42501) qui n'a pas d'accès au dossier, sans dire s'il existe.
create function public.couverture_du_releve(p_dossier_id uuid) returns date[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'membre')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  return coalesce((
    select array_agg(m.mois order by m.mois)
      from (select distinct date_trunc('month', l.date::timestamp)::date as mois
              from public.lignes_bancaires l where l.dossier_id = p_dossier_id) m
  ), '{}'::date[]);
end;
$$;

revoke execute on function public.proposer_justificatif(uuid, uuid, uuid) from public, anon;
revoke execute on function public.retirer_proposition(uuid, uuid) from public, anon;
revoke execute on function public.ecrire_precision_mouvement(uuid, uuid, text) from public, anon;
revoke execute on function public.couverture_du_releve(uuid) from public, anon;
grant execute on function public.proposer_justificatif(uuid, uuid, uuid) to authenticated;
grant execute on function public.retirer_proposition(uuid, uuid) to authenticated;
grant execute on function public.ecrire_precision_mouvement(uuid, uuid, text) to authenticated;
grant execute on function public.couverture_du_releve(uuid) to authenticated;
revoke execute on function public.garder_justificatif_propose() from public, anon, authenticated;
revoke execute on function public.garder_precision_mouvement() from public, anon, authenticated;

comment on table public.justificatifs_proposes is
  'Les pièces proposées comme justificatif d''un mouvement du relevé, par le cabinet ou par un accès qui porte la case « Banque » (espace client, étape P7). N''écrit rien dans le relevé ; se retire, ne se modifie ni ne se supprime ; part avec la pièce, le mouvement ou le dossier.';
comment on table public.precisions_mouvements is
  'Le fil d''un mouvement du relevé : la question du cabinet, la réponse d''un accès qui porte la case « Banque » (espace client, étape P7). L''origine est déduite de l''appelant ; une précision ne se modifie pas ; le cabinet seul retire un message hors sujet.';
comment on function public.proposer_justificatif(uuid, uuid, uuid) is
  'Propose une pièce du dossier comme justificatif d''un mouvement du dossier. Réservée au cabinet et aux accès qui portent la case « Banque » (42501) ; refuse un mouvement ou une pièce d''un autre dossier, un exercice figé par la validation, une proposition déjà active. N''écrit rien dans le relevé.';
comment on function public.retirer_proposition(uuid, uuid) is
  'Retire une proposition de justificatif : elle reste, datée, avec qui l''a retirée. Son auteur et le cabinet du dossier la retirent ; une fois.';
comment on function public.ecrire_precision_mouvement(uuid, uuid, text) is
  'Écrit une précision sur un mouvement du dossier, d''origine « cabinet » ou « client » selon l''appelant. Réservée au cabinet et aux accès qui portent la case « Banque » (42501) ; refuse un texte vide ou de plus de 2 000 caractères.';
comment on function public.couverture_du_releve(uuid) is
  'Les mois (premier jour) où le relevé du dossier porte au moins un mouvement, sans montant ni libellé. Lisible par le cabinet et par tout accès au dossier ; refuse (42501) qui n''y a pas accès.';
comment on function public.garder_justificatif_propose() is
  'Garde de justificatifs_proposes : un mouvement et une pièce du dossier de la proposition ; seul le retrait, une fois, la modifie ; elle ne part qu''avec sa pièce, son mouvement ou son dossier.';
comment on function public.garder_precision_mouvement() is
  'Garde de precisions_mouvements : un mouvement du dossier de la précision ; aucune modification.';
