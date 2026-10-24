-- LA JUMELLE INVERSÉE, EN BASE (chantier EC-Q3, ligne 28.65, étape VF6b). La conception : HISTORIQUE.md, « VF6, LA
-- JUMELLE INVERSÉE : LA CONCEPTION », § 3 (a) à (f) et § 5 ; le récit : « LA JUMELLE INVERSÉE, EN BASE ».
--
-- POURQUOI. Dans un dossier dont les factures sont la source de leurs ventes (étape VF2), la vente se compte par la
-- facture validée et ses encaissements ; la pièce de vente qui revient de la plateforme (la jumelle) ou le PDF que le
-- cabinet dépose n'en est qu'un EXEMPLAIRE, qui ne doit plus rien compter. Les moteurs l'écartent depuis VF3b, le
-- brouillon et les préalables depuis VF6a — encore faut-il que la pièce soit désignée. Rien en base ne l'exigeait : une
-- pièce de vente se validait sans rien dire d'elle, se rapprochait, entrait dans un virement groupé et portait une
-- écriture, exemplaire d'une facture source ou non. Cette migration ferme le double compte en base.
--
-- LES DÉCISIONS DU CABINET (23/10/2026, toutes à la recommandation). VF6-Q1 : l'exemplaire d'une pièce validée d'un dossier
-- basculé ne se défait pas, il se remplace d'un seul geste. VF6-Q2 : la déclaration se ferme au client par la garde
-- seule — aucune policy ne change. VF6-Q3 : qui a désigné, et quand, dans un JOURNAL, au cabinet seul. VF6-Q5 : la
-- validation d'une pièce reçue dont les preuves se contredisent est refusée tant qu'elles se contredisent. VF5H-Q1, pas
-- encore tranchée, écrite sur la recommandation (le cabinet avance sur elle) : l'exemplaire d'une facture qui n'est pas
-- source ne se désigne, ne se remplace ni ne se défait tant qu'un mouvement classé par ses encaissements compte un
-- encaissement de cette facture — un virement mixte (étape VF5h), qui date cet exemplaire.
--
-- CE QU'ELLE POSE :
--   (a) `pieces.vente_hors_des_factures` — « aucune facture validée de l'application n'est la facture de cette vente »
--       (une prestation facturée ailleurs, une recette sans facture) —, faux par défaut, vrai seulement sur une pièce de
--       vente que rien ne désigne. Une pièce de vente d'un dossier basculé peut porter une facture d'AVANT la bascule,
--       qui n'est pas source et qui est pourtant une facture de l'application : son PDF se DÉSIGNE (le virement mixte
--       l'exige), il ne se déclare pas.
--   (b) `factures_du_pont`, le jumeau en base du pont (src/lib/ventesJumelles.ts) : les factures VALIDÉES du dossier
--       d'une pièce que ses trois faits DÉDUITS désignent — le flux d'une transmission, l'identifiant de Super PDP (écrit
--       sur la facture, ou flux d'une transmission `superpdp`), l'identité G1.42 (le numéro, le SIREN figé de l'émetteur —
--       ses neuf premiers chiffres, les blancs ôtés comme `sirenDe` les ôte —, l'année de la date ; spécifications
--       externes de la DGFiP v3.2, annexe 7 v1.9, règle G1.42) ; une identité de l'autre nature rend sa facture
--       « contraire ». La désignation n'y entre pas : c'est elle que les gardes jugent. supabase/essais/
--       exemplairesDesFactures.sql porte entre deux bornes le jeu que src/lib/ventesJumellesJumeau.test.ts rejoue dans le
--       pont : le même rattachement, pièce par pièce.
--   (c) G3, `garder_vente_d_un_dossier_bascule` : une pièce de vente VALIDÉE d'un dossier basculé, jugée au PASSAGE
--       seulement — à l'insertion, ou quand elle devient validée, devient une vente, change de dossier, de désignation ou
--       de déclaration (une pièce validée avant la bascule reste ce qu'elle est : EC3-Q1, sans rétroactivité). Dans cet
--       ordre : 1. insérée validée, sauf par la restauration du super-administrateur, qui réinsère un état déjà gardé ;
--       2. le pont la rattache à une facture (source ou non) qu'elle ne désigne pas — désignée à une autre, déclarée, ou
--       rien —, la facture nommée ; 3. ses preuves se contredisent (VF6-Q5) ; 4. ni désignée ni déclarée. Le pont avant
--       l'absence de marque : la pièce que le pont reconnaît s'entend dire QUELLE facture désigner.
--   (d) G4, `garder_exemplaire_d_une_source`, sur les quatre tables qui citent une pièce comme ce qui règle ou écrit une
--       vente — le rapprochement (`lignes_bancaires`), la part d'un virement groupé (`reglements_groupes`), l'écriture
--       (`ecritures_brouillon`), le lettrage (`lettrages_manuels`) : l'exemplaire d'une facture SOURCE n'y entre pas, la
--       restauration comprise (un état gardé ne la heurte jamais). L'exemplaire d'une facture qui n'est pas source compte
--       comme hier, et la banque que VF5h lui écrit sur un virement mixte passe. L'AUTRE CÔTÉ de la relation est dans
--       `designer_exemplaire_facture` : une pièce rapprochée, réglée par une part, écrite ou lettrée ne se désigne pas à
--       une facture source, chaque lien dit, et ce qu'il faut retirer d'abord.
--   (e) LES FONCTIONS DU CABINET (`admin_du_dossier`, SECURITY DEFINER, fermées à l'anonyme ; le verrou partagé de la
--       validation, puis celui de la ligne). `designer_exemplaire_facture` REMPLACE désormais une désignation à une autre
--       facture, ou une déclaration, dans la même écriture (VF6-Q1) — son rang 5 ne refuse plus qu'une désignation à la
--       MÊME facture —, et refuse, après le rang 7 : dans un dossier basculé, le pont qui dit une autre facture (8), des
--       preuves contraires (9) ; pour une facture source, les quatre liens de G4 (10 à 13) ; un virement mixte classé qui
--       compte un encaissement de la facture qu'elle désignait (14) ou de celle qu'elle désignerait (15) (VF5H-Q1).
--       `defaire_exemplaire_facture` refuse en plus une pièce VALIDÉE d'un dossier basculé (4, VF6-Q1, sous les mots de la
--       fonction plutôt que laissé au refus de G3) et le virement mixte classé (6). Deux fonctions neuves,
--       `declarer_vente_hors_des_factures` (la désignation en cours remplacée) et `retirer_declaration_hors_des_factures`.
--   (f) LE JOURNAL, `designations_des_pieces` (VF6-Q3 ; VF1A-Q2) : une ligne par geste — désignation, retrait de la
--       désignation, déclaration, retrait de la déclaration —, la pièce, la facture d'une désignation ou de son retrait, le
--       compte qui l'a fait (`auth.uid()`, sans clé vers `auth.users`, comme `justificatifs_proposes.auteur_id` : un compte
--       effacé n'efface ni ne bloque l'histoire), l'instant. Remplacer écrit deux lignes au même instant. Écrit par les
--       quatre fonctions seules (sous le réglage de leur pièce), réinséré par la restauration du super-administrateur ;
--       aucune mise à jour, aucune suppression hors de la cascade de sa pièce ou de son dossier ; lu par le cabinet, le
--       client n'en voit rien (une parole du cabinet ne se range pas dans une table que le client lit). La piste d'audit
--       fiable relie une facture à l'opération qui la fonde (CGI, art. 289, VII, 1°) : le journal dit qui a relié une pièce
--       à une facture, et quand.
--   (g) LA GARDE DE VF1a APPREND LA DÉCLARATION : elle ne s'écrit que par les deux fonctions de la déclaration (le même
--       réglage `jd.exemplaire_facture`, pour la seule pièce qu'elles écrivent), ne naît vraie que réinsérée par le
--       super-administrateur, jamais avec une désignation, seulement sur une vente ; une pièce déclarée ne change ni de
--       dossier ni de nature — retirer d'abord la déclaration. Le client qui dépose une pièce ne la pose donc pas
--       (VF6-Q2) : la garde tient pour TOUS les écrivains, le cabinet et les Edge Functions comme lui.
--
-- AUCUNE POLICY NE CHANGE, hors des deux de la table neuve (sa lecture au cabinet, son insertion de restauration).
--
-- NEUTRE EN PRODUCTION (relevé le 23/10/2026, des comptes) : aucun dossier n'a basculé (G3 ne s'éveille pas), aucune
-- facture n'est source (G4 non plus), aucune pièce n'est désignée (le remplacement ne rencontre rien), aucun mouvement
-- n'est classé par ses encaissements. Le seul comportement qui change hors d'un dossier basculé : désigner une pièce
-- déjà désignée à une autre facture remplace au lieu de refuser — sans effet sur ce qui se compte.
--
-- CE QUI CONTOURNE LA RLS : les fonctions du cabinet, après leur contrôle d'accès ; G3 et G4 (SECURITY DEFINER, comme les
-- autres gardes des pièces et du relevé, pour juger quelle que soit la RLS de qui écrit), qui ne rendent que la ligne ou
-- leur refus ; `factures_du_pont`, aux droits de l'appelant, exécutable par personne d'autre que les fonctions et les
-- gardes. Aucune ne s'appelle en RPC hors des quatre du cabinet.
--
-- CE QUE LE TEXTE RETIRE : rien — aucune table, colonne, contrainte, fonction ni donnée. Les déclencheurs de la désignation
-- se REDÉFINISSENT (`create or replace trigger`), les trois fonctions d'hier aussi, au même nom : leurs OID et leurs droits
-- restent. Aucune barre oblique inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose, et les trois fonctions d'hier telles qu'elle les reprend ══════════

do $$
declare
  v record;
begin
  -- Le virement mixte (étape VF5h) d'abord : le rang 14 et le rang 15 de la désignation jugent le classement qu'il écrit.
  if not exists (select 1 from supabase_migrations.schema_migrations m where m.name = 'virement_mixte') then
    raise exception 'Cette migration suppose le virement mixte (migration virement_mixte, étape VF5h) en base.';
  end if;
  for v in select x.fonction, x.empreinte from (values
      ('public.designer_exemplaire_facture(uuid, uuid, uuid)', '5f2a0b0fea1e3c3780c01a8562f40df6'),
      ('public.defaire_exemplaire_facture(uuid, uuid)', 'aefe42ab8274dfd3b7a2d5b16734419d'),
      ('public.garder_exemplaire_facture()', 'dc8969b77c84852f889eb95b29a76d65')
    ) x(fonction, empreinte) loop
    -- Le corps que cette migration remplace, au caractère près (les retours chariot d'un collage écartés) : une fonction
    -- changée depuis — par une autre migration, ou par une première application de celle-ci — ne se remplace pas sans
    -- être relue.
    if to_regprocedure(v.fonction) is null
       or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), '')) <> v.empreinte then
      raise exception 'La fonction % en base n''est plus celle de la migration exemplaires_des_factures : cette migration ne la remplace pas sans être relue.',
        v.fonction;
    end if;
  end loop;
end
$$;

-- ══ (a) La déclaration ══════════

alter table public.pieces add column vente_hors_des_factures boolean not null default false;

-- Vraie seulement sur une pièce de vente que rien ne désigne : une pièce n'est pas à la fois l'exemplaire d'une facture de
-- l'application et une vente qu'aucune facture de l'application ne porte.
alter table public.pieces add constraint pieces_vente_hors_des_factures
  check (not vente_hors_des_factures or (type_piece = 'vente' and facture_id is null));

comment on column public.pieces.vente_hors_des_factures is
  'Déclarée par le cabinet : aucune facture validée de l''application n''est la facture de cette vente (une prestation facturée ailleurs, une recette sans facture). Posée et retirée par declarer_vente_hors_des_factures, retirer_declaration_hors_des_factures et designer_exemplaire_facture seules ; jamais avec une désignation.';

-- ══ (b) Le jumeau du pont ══════════
-- Une ligne par facture validée du dossier de la pièce que ses trois faits déduits désignent ; `nature_contraire` : son
-- identité la désigne sous l'autre nature (un avoir pour une facture, ou l'inverse). Rien : le pont ne la rattache à
-- rien. Une ligne, non contraire : il la rattache à cette facture. Plus d'une, ou une contraire : ses preuves se
-- contredisent. La pièce se passe en ligne entière — une garde la juge AVANT qu'elle soit écrite.
create function public.factures_du_pont(p_piece public.pieces)
returns table (facture_id uuid, nature_contraire boolean)
language sql
stable
set search_path = public
as $$
  with validees as (
    select f.id, f.type, f.numero, f.date_emission, f.superpdp_invoice_id,
           -- Le SIREN figé de l'émetteur, comme `sirenDe` : les blancs ôtés (les vingt-cinq que la classe des blancs des
           -- expressions régulières de JavaScript reconnaît), neuf chiffres ou quatorze, les neuf premiers.
           (select case when c ~ '^[0-9]{9}([0-9]{5})?$' then left(c, 9) end
              from (select translate(coalesce(f.emetteur_siret, ''),
                      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760)
                      || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199)
                      || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288)
                      || chr(65279), '') as c) s) as siren
      from public.factures_emises f
     where f.dossier_id = p_piece.dossier_id and f.statut = 'validee'
  ),
  preuves as (
    -- Le flux : une transmission de la facture qui a déposé le flux que la pièce porte.
    select v.id, false as contraire
      from validees v join public.transmissions_factures t on t.facture_id = v.id
     where t.hote = p_piece.flux_hote and t.flux_id = p_piece.flux_id
    union all
    -- Super PDP : l'identifiant écrit sur la facture…
    select v.id, false from validees v where v.superpdp_invoice_id = p_piece.superpdp_invoice_id
    union all
    -- … ou gardé par sa transmission `superpdp` quand l'écriture sur la facture a échoué.
    select v.id, false
      from validees v join public.transmissions_factures t on t.facture_id = v.id
     where t.canal = 'superpdp' and t.flux_id = p_piece.superpdp_invoice_id::text
    union all
    -- L'identité G1.42, entière : le numéro, le SIREN figé de l'émetteur, l'année de la date.
    select v.id, p_piece.identite_nature is not null and p_piece.identite_nature <> v.type
      from validees v
     where p_piece.identite_siren_vendeur is not null and p_piece.identite_date is not null
       and v.numero = p_piece.identite_numero and v.siren = p_piece.identite_siren_vendeur
       and extract(year from v.date_emission) = extract(year from p_piece.identite_date)
  )
  select p.id, bool_or(p.contraire) from preuves p group by p.id
$$;

comment on function public.factures_du_pont(public.pieces) is
  'Le jumeau en base du pont (src/lib/ventesJumelles.ts) : les factures validées du dossier de la pièce que son flux, l''identifiant de Super PDP ou son identité G1.42 désignent, celle d''une identité de l''autre nature dite contraire. Sans la désignation, que les gardes jugent.';

-- ══ (f) Le journal ══════════

create table public.designations_des_pieces (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  geste text not null
    constraint designations_des_pieces_geste
      check (geste in ('designation', 'retrait_designation', 'declaration', 'retrait_declaration')),
  facture_id uuid references public.factures_emises (id),
  auteur_id uuid not null,
  fait_le timestamptz not null default now(),
  -- Une désignation et son retrait nomment leur facture ; une déclaration et son retrait, aucune.
  constraint designations_des_pieces_facture check ((facture_id is not null) = (geste in ('designation', 'retrait_designation')))
);

create index designations_des_pieces_piece on public.designations_des_pieces (piece_id);
create index designations_des_pieces_dossier on public.designations_des_pieces (dossier_id);
create index designations_des_pieces_facture on public.designations_des_pieces (facture_id) where facture_id is not null;

comment on table public.designations_des_pieces is
  'Le journal des désignations et des déclarations d''une pièce de vente : qui a fait quel geste, et quand. Écrit par les quatre fonctions du cabinet seules, réinséré par la restauration du super-administrateur ; ne se modifie ni ne se supprime hors de la cascade de sa pièce ou de son dossier. Le client n''en voit rien.';

-- Le journal ne s'écrit que par les fonctions, sous le réglage de la pièce qu'elles écrivent, ou par la restauration du
-- super-administrateur ; une ligne cite une pièce et une facture de son dossier ; rien ne la réécrit ; elle ne part
-- qu'avec sa pièce ou son dossier. Aux droits de l'appelant : les fonctions écrivent en propriétaire, le super-
-- administrateur lit tout.
create function public.garder_designation_des_pieces() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or not exists (select 1 from public.pieces p where p.id = old.piece_id) then
      return old;
    end if;
    raise exception 'Le journal des désignations ne se réécrit pas : une ligne ne part qu''avec sa pièce ou son dossier.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Le journal des désignations ne se réécrit pas : une ligne ne part qu''avec sa pièce ou son dossier.'
      using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.exemplaire_facture', true), '') is distinct from new.piece_id::text
     and not public.is_super_admin() then
    raise exception 'Le journal des désignations ne s''écrit que par les fonctions qui désignent et déclarent une pièce.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id)
     or (new.facture_id is not null
         and not exists (select 1 from public.factures_emises f where f.id = new.facture_id and f.dossier_id = new.dossier_id)) then
    raise exception 'Une ligne du journal des désignations cite une pièce et une facture de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger designations_des_pieces_gardes before insert or update or delete on public.designations_des_pieces
  for each row execute function public.garder_designation_des_pieces();

alter table public.designations_des_pieces enable row level security;
create policy designations_des_pieces_lecture on public.designations_des_pieces
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy designations_des_pieces_restauration on public.designations_des_pieces
  for insert to authenticated with check (is_super_admin());

-- ══ (g) La garde de la désignation, qui apprend la déclaration ══════════
-- La définition de `exemplaires_des_factures`, étendue à la déclaration : son réglage, sa naissance, son dossier, sa
-- nature ; et, la désignation ou la déclaration qui se pose, jamais les deux.
create or replace function public.garder_exemplaire_facture() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_dossier uuid;
  v_statut text;
  v_numero text;
begin
  if tg_op = 'INSERT' then
    if new.facture_id is null and not new.vente_hors_des_factures then
      return new;
    end if;
    -- Une pièce ne naît désignée ou déclarée que réinsérée par la restauration d'une sauvegarde : le super-administrateur.
    if not public.is_super_admin() then
      if new.facture_id is not null then
        raise exception 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'
          using errcode = '42501';
      end if;
      raise exception 'Une pièce ne se déclare vente hors des factures de l''application, et ne cesse de l''être, que par l''application.'
        using errcode = '42501';
    end if;
  elsif new.facture_id is distinct from old.facture_id or new.vente_hors_des_factures is distinct from old.vente_hors_des_factures then
    -- Les fonctions annoncent la pièce qu'elles écrivent ; toute autre écriture de la désignation ou de la déclaration
    -- est refusée.
    if coalesce(current_setting('jd.exemplaire_facture', true), '') is distinct from old.id::text then
      if new.facture_id is distinct from old.facture_id then
        raise exception 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'
          using errcode = '42501';
      end if;
      raise exception 'Une pièce ne se déclare vente hors des factures de l''application, et ne cesse de l''être, que par l''application.'
        using errcode = '42501';
    end if;
    if new.facture_id is null and not new.vente_hors_des_factures then
      return new;
    end if;
  elsif new.facture_id is null and not new.vente_hors_des_factures then
    return new;
  else
    -- Ni la désignation ni la déclaration ne changent, la pièce si : elle reste de son dossier, et reste une vente.
    if new.dossier_id is distinct from old.dossier_id or new.type_piece is distinct from 'vente' then
      if new.facture_id is not null then
        select f.numero into v_numero from public.factures_emises f where f.id = new.facture_id;
        if new.dossier_id is distinct from old.dossier_id then
          raise exception 'Cette pièce est l''exemplaire de la facture % : elle ne change plus de dossier — défaire d''abord la désignation.',
            coalesce(v_numero, '(sans numéro)') using errcode = '23514';
        end if;
        raise exception 'Cette pièce est l''exemplaire de la facture % : elle reste une pièce de vente — défaire d''abord la désignation.',
          coalesce(v_numero, '(sans numéro)') using errcode = '23514';
      end if;
      if new.dossier_id is distinct from old.dossier_id then
        raise exception 'Cette pièce est déclarée vente hors des factures de l''application : elle ne change plus de dossier — retirer d''abord la déclaration.'
          using errcode = '23514';
      end if;
      raise exception 'Cette pièce est déclarée vente hors des factures de l''application : elle reste une pièce de vente — retirer d''abord la déclaration.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  -- Une désignation ou une déclaration qui se pose, par une fonction ou par la restauration : jamais les deux ; une
  -- facture validée du même dossier, sur une pièce de vente ; une déclaration, sur une pièce de vente.
  if new.facture_id is not null and new.vente_hors_des_factures then
    raise exception 'Une pièce n''est pas à la fois l''exemplaire d''une facture et une vente hors des factures de l''application.'
      using errcode = '23514';
  end if;
  if new.facture_id is not null then
    select f.dossier_id, f.statut into v_dossier, v_statut from public.factures_emises f where f.id = new.facture_id;
    if not found or v_dossier is distinct from new.dossier_id then
      raise exception 'Une pièce n''est l''exemplaire que d''une facture de son dossier.' using errcode = '23514';
    end if;
    if v_statut is distinct from 'validee' then
      raise exception 'Seule une facture validée a un exemplaire.' using errcode = '23514';
    end if;
    if new.type_piece is distinct from 'vente' then
      raise exception 'Seule une pièce de vente est l''exemplaire d''une facture émise.' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.type_piece is distinct from 'vente' then
    raise exception 'Seule une pièce de vente se déclare vente hors des factures de l''application.' using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace trigger pieces_exemplaire_de_facture
  before insert or update of facture_id, vente_hors_des_factures, dossier_id, type_piece on public.pieces
  for each row execute function public.garder_exemplaire_facture();

-- ══ (c) G3, la pièce de vente d'un dossier basculé ══════════
-- Elle passe après les gardes des pièces que l'ordre des noms fait passer d'abord (la désignation, le gel). Le dossier
-- est lu `for share` : une bascule ne se glisse pas entre la lecture et l'écriture de la pièce.
create function public.garder_vente_d_un_dossier_bascule() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bascule boolean;
  v_pont uuid;
  v_contraire boolean;
  v_nombre integer;
  v_numero text;
begin
  if new.type_piece <> 'vente' or new.statut <> 'validee' then
    return new;
  end if;
  -- Au passage seulement : une pièce validée avant la bascule reste ce qu'elle est (EC3-Q1).
  if tg_op = 'UPDATE' and old.statut = 'validee' and old.type_piece = 'vente' and old.dossier_id = new.dossier_id
     and old.facture_id is not distinct from new.facture_id and old.vente_hors_des_factures = new.vente_hors_des_factures then
    return new;
  end if;
  -- La restauration réinsère un état déjà gardé : ses transmissions peuvent venir après ses pièces.
  if tg_op = 'INSERT' and public.is_super_admin() then
    return new;
  end if;
  select d.ventes_par_les_factures into v_bascule from public.dossiers d where d.id = new.dossier_id for share;
  if not coalesce(v_bascule, false) then
    return new;
  end if;
  -- 1. Insérée validée.
  if tg_op = 'INSERT' then
    raise exception 'Une pièce de vente naît à valider dans un dossier dont les factures sont la source de leurs ventes.'
      using errcode = '23514';
  end if;
  select count(*), bool_or(x.nature_contraire), min(x.facture_id::text)::uuid into v_nombre, v_contraire, v_pont
    from public.factures_du_pont(new) x;
  -- 2. Le pont la rattache à une facture qu'elle ne désigne pas.
  if v_nombre = 1 and not v_contraire and new.facture_id is distinct from v_pont then
    select f.numero into v_numero from public.factures_emises f where f.id = v_pont;
    raise exception 'La pièce « % » est la facture % émise dans l''application, revenue comme pièce : désignez-la exemplaire de cette facture avant de la valider.',
      new.nom_fichier, coalesce(v_numero, '(sans numéro)') using errcode = '23514';
  end if;
  -- 3. Ses preuves se contredisent (VF6-Q5).
  if v_nombre > 1 or v_contraire then
    raise exception 'Les preuves de la pièce « % » se contredisent — elle porte plusieurs factures émises, ou une autre nature que la facture que son numéro désigne : vérifiez-la sur la plateforme avant de la valider.',
      new.nom_fichier using errcode = '23514';
  end if;
  -- 4. Ni désignée ni déclarée.
  if new.facture_id is null and not new.vente_hors_des_factures then
    raise exception 'Désignez la pièce « % » exemplaire de sa facture, ou déclarez-la vente hors des factures de l''application, avant de la valider : les factures de ce dossier sont la source de leurs ventes.',
      new.nom_fichier using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pieces_vente_d_un_dossier_bascule
  before insert or update of statut, type_piece, dossier_id, facture_id, vente_hors_des_factures on public.pieces
  for each row execute function public.garder_vente_d_un_dossier_bascule();

-- ══ (d) G4, l'exemplaire d'une facture source ne justifie rien ══════════
-- Une fonction, quatre déclencheurs, chacun après les gardes de sa table que l'ordre des noms fait passer d'abord (la
-- validation, le mouvement réservé). Elle ne juge que le lien qui se pose ou qui change.
create function public.garder_exemplaire_d_une_source() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nom text;
  v_numero text;
begin
  if new.piece_id is null or (tg_op = 'UPDATE' and new.piece_id is not distinct from old.piece_id) then
    return new;
  end if;
  select p.nom_fichier, f.numero into v_nom, v_numero
    from public.pieces p join public.factures_emises f on f.id = p.facture_id
   where p.id = new.piece_id and f.source_de_la_vente;
  if found then
    raise exception 'La pièce « % » est l''exemplaire de la facture %, source de sa vente : la vente se règle et s''écrit par sa facture et ses encaissements.',
      v_nom, coalesce(v_numero, '(sans numéro)') using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger lignes_bancaires_sans_exemplaire_d_une_source before insert or update of piece_id on public.lignes_bancaires
  for each row execute function public.garder_exemplaire_d_une_source();
create trigger reglements_groupes_sans_exemplaire_d_une_source before insert or update of piece_id on public.reglements_groupes
  for each row execute function public.garder_exemplaire_d_une_source();
create trigger ecritures_brouillon_sans_exemplaire_d_une_source before insert or update of piece_id on public.ecritures_brouillon
  for each row execute function public.garder_exemplaire_d_une_source();
create trigger lettrages_manuels_sans_exemplaire_d_une_source before insert or update of piece_id on public.lettrages_manuels
  for each row execute function public.garder_exemplaire_d_une_source();

-- ══ (e) Désigner, qui remplace ══════════
-- La définition de `exemplaires_des_factures`, son rang 5 resserré à la même facture, ses rangs neufs après le 7, le
-- remplacement et le journal. Dans l'ordre :
--   1. l'accès au dossier ANNONCÉ, ou un dossier qui n'existe pas (42501) ; 2. la pièce, dans ce dossier (P0002) ; 3. une
--   pièce de vente ; 4. une pièce que rien ne fige ; 5. une pièce qui n'est pas déjà l'exemplaire de CETTE facture ; 6. la
--   facture, dans ce dossier (P0002) ; 7. une facture validée ; dans un dossier basculé, 8. le pont qui rattache la pièce
--   à une autre facture, 9. des preuves qui se contredisent ; pour une facture source, 10. une pièce rapprochée, 11.
--   réglée par une part d'un virement groupé, 12. écrite, 13. lettrée ; 14. la facture qu'elle désignait, 15. ou celle-ci,
--   qui n'est pas source, dont un encaissement est compté par un mouvement classé par ses encaissements (VF5H-Q1). Les
--   autres en 22023.
create or replace function public.designer_exemplaire_facture(p_dossier_id uuid, p_piece_id uuid, p_facture_id uuid)
returns public.pieces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_piece public.pieces;
  v_annee integer;
  v_numero text;
  v_statut text;
  v_source boolean;
  v_bascule boolean;
  v_nombre integer;
  v_contraire boolean;
  v_pont uuid;
  v_avant uuid;
  v_declaree boolean;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : un dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  -- 2. La pièce, cherchée dans ce dossier seulement : un compte qui n'y a pas droit n'apprend pas qu'elle existe.
  select * into v_piece from public.pieces p where p.id = p_piece_id and p.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Pièce introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  -- 3. Une pièce de vente : l'exemplaire d'une facture émise est une vente.
  if v_piece.type_piece <> 'vente' then
    raise exception 'Seule une pièce de vente est l''exemplaire d''une facture émise.' using errcode = '22023';
  end if;
  -- 4. Le gel de la validation, comme sa pièce.
  v_annee := public.exercice_figeant_la_piece(p_piece_id);
  if v_annee is not null then
    raise exception 'Cette pièce porte une écriture validée de l''exercice % : sa désignation ne change plus.', v_annee
      using errcode = '22023';
  end if;
  -- 5. Déjà l'exemplaire de CETTE facture ; celui d'une autre, ou une déclaration, se remplace (VF6-Q1).
  if v_piece.facture_id is not null and v_piece.facture_id = p_facture_id then
    select coalesce(f.numero, '(sans numéro)') into v_numero from public.factures_emises f where f.id = v_piece.facture_id;
    raise exception 'Cette pièce est déjà l''exemplaire de la facture %.', v_numero using errcode = '22023';
  end if;
  -- 6. La facture, cherchée dans ce dossier seulement.
  select f.statut, f.source_de_la_vente into v_statut, v_source
    from public.factures_emises f where f.id = p_facture_id and f.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Facture introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  -- 7. Une facture validée : un brouillon n'est pas encore une facture émise.
  if v_statut <> 'validee' then
    raise exception 'Seule une facture validée a un exemplaire : un brouillon n''est pas encore une facture émise.'
      using errcode = '22023';
  end if;
  -- Dans un dossier basculé, le pont : la pièce que ses faits rattachent à une facture n'est l'exemplaire que d'elle.
  select d.ventes_par_les_factures into v_bascule from public.dossiers d where d.id = p_dossier_id for share;
  if v_bascule then
    select count(*), bool_or(x.nature_contraire), min(x.facture_id::text)::uuid into v_nombre, v_contraire, v_pont
      from public.factures_du_pont(v_piece) x;
    -- 8. Le pont la rattache à une autre facture.
    if v_nombre = 1 and not v_contraire and v_pont <> p_facture_id then
      select coalesce(f.numero, '(sans numéro)') into v_numero from public.factures_emises f where f.id = v_pont;
      raise exception 'Cette pièce est la facture % émise dans l''application, revenue comme pièce : elle n''est l''exemplaire que de celle-ci.',
        v_numero using errcode = '22023';
    end if;
    -- 9. Ses preuves se contredisent (VF6-Q5).
    if v_nombre > 1 or v_contraire then
      raise exception 'Les preuves de cette pièce se contredisent — elle porte plusieurs factures émises, ou une autre nature que la facture que son numéro désigne : vérifiez-la sur la plateforme avant de la désigner.'
        using errcode = '22023';
    end if;
  end if;
  -- L'autre côté de G4 : l'exemplaire d'une facture source ne règle ni n'écrit rien ; ce qui le lie se retire d'abord.
  if v_source then
    select coalesce(f.numero, '(sans numéro)') into v_numero from public.factures_emises f where f.id = p_facture_id;
    -- 10. Rapprochée d'un mouvement.
    if exists (select 1 from public.lignes_bancaires l where l.piece_id = p_piece_id) then
      raise exception 'Cette pièce est rapprochée d''un mouvement du relevé : l''exemplaire de la facture %, source de sa vente, ne justifie aucun mouvement — annuler d''abord ce rapprochement.',
        v_numero using errcode = '22023';
    end if;
    -- 11. Réglée par une part d'un virement groupé.
    if exists (select 1 from public.reglements_groupes r where r.piece_id = p_piece_id) then
      raise exception 'Cette pièce est réglée par une part d''un virement groupé : l''exemplaire de la facture %, source de sa vente, n''en reçoit aucune — retirer d''abord cette part.',
        v_numero using errcode = '22023';
    end if;
    -- 12. Écrite.
    if exists (select 1 from public.ecritures_brouillon e where e.piece_id = p_piece_id) then
      raise exception 'Cette pièce porte une écriture : l''exemplaire de la facture %, source de sa vente, ne s''écrit pas — retirer d''abord cette écriture.',
        v_numero using errcode = '22023';
    end if;
    -- 13. Lettrée.
    if exists (select 1 from public.lettrages_manuels m where m.piece_id = p_piece_id) then
      raise exception 'Cette pièce est lettrée : l''exemplaire de la facture %, source de sa vente, ne se lettre pas — défaire d''abord ce lettrage.',
        v_numero using errcode = '22023';
    end if;
  end if;
  -- 14. et 15. Le virement mixte classé (VF5H-Q1) : il compte l'encaissement d'une facture qui n'est pas source et date
  -- son exemplaire unique ; ni l'exemplaire qu'elle quitte, ni celui qu'elle prend ne changent sous lui.
  select f.numero into v_numero from public.factures_emises f
   where f.id = v_piece.facture_id and not f.source_de_la_vente
     and exists (select 1 from public.encaissements_factures e join public.lignes_bancaires l on l.id = e.ligne_bancaire_id
                  where e.facture_id = f.id and e.retire_le is null and l.encaissements_de_factures
                    and public.encaissement_justifie_son_mouvement(e.id));
  if found then
    raise exception 'Un encaissement de la facture % est compté par un mouvement classé par ses encaissements, qui date son exemplaire : retirer d''abord ce classement.',
      coalesce(v_numero, '(sans numéro)') using errcode = '22023';
  end if;
  select f.numero into v_numero from public.factures_emises f
   where f.id = p_facture_id and not f.source_de_la_vente
     and exists (select 1 from public.encaissements_factures e join public.lignes_bancaires l on l.id = e.ligne_bancaire_id
                  where e.facture_id = f.id and e.retire_le is null and l.encaissements_de_factures
                    and public.encaissement_justifie_son_mouvement(e.id));
  if found then
    raise exception 'Un encaissement de la facture % est compté par un mouvement classé par ses encaissements, qui date son exemplaire : retirer d''abord ce classement.',
      coalesce(v_numero, '(sans numéro)') using errcode = '22023';
  end if;
  -- Le réglage dit à la garde (et au journal) que CETTE pièce s'écrit par cette fonction ; il ne vaut que pour elle, et
  -- il est retiré aussitôt. Ce qu'elle désignait, ou sa déclaration, est remplacé dans la même écriture.
  v_avant := v_piece.facture_id;
  v_declaree := v_piece.vente_hors_des_factures;
  perform set_config('jd.exemplaire_facture', p_piece_id::text, true);
  update public.pieces set facture_id = p_facture_id, vente_hors_des_factures = false where id = p_piece_id
  returning * into v_piece;
  if v_avant is not null then
    insert into public.designations_des_pieces (dossier_id, piece_id, geste, facture_id, auteur_id)
    values (p_dossier_id, p_piece_id, 'retrait_designation', v_avant, auth.uid());
  end if;
  if v_declaree then
    insert into public.designations_des_pieces (dossier_id, piece_id, geste, facture_id, auteur_id)
    values (p_dossier_id, p_piece_id, 'retrait_declaration', null, auth.uid());
  end if;
  insert into public.designations_des_pieces (dossier_id, piece_id, geste, facture_id, auteur_id)
  values (p_dossier_id, p_piece_id, 'designation', p_facture_id, auth.uid());
  perform set_config('jd.exemplaire_facture', '', true);
  return v_piece;
end
$$;

-- ══ (e) Défaire ══════════
-- La définition de `exemplaires_des_factures`, deux rangs neufs et le journal. Dans l'ordre : 1. l'accès (42501) ; 2. la
-- pièce, dans ce dossier (P0002) ; 3. une pièce désignée ; 4. une pièce qui n'est pas validée dans un dossier basculé
-- (VF6-Q1 : elle se remplace) ; 5. une pièce que rien ne fige ; 6. la facture qu'elle désigne, qui n'est pas source, dont
-- un encaissement est compté par un mouvement classé par ses encaissements (VF5H-Q1). Les autres en 22023.
create or replace function public.defaire_exemplaire_facture(p_dossier_id uuid, p_piece_id uuid)
returns public.pieces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_piece public.pieces;
  v_annee integer;
  v_numero text;
  v_avant uuid;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  -- 2. La pièce, dans ce dossier.
  select * into v_piece from public.pieces p where p.id = p_piece_id and p.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Pièce introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  -- 3. Une pièce désignée.
  if v_piece.facture_id is null then
    raise exception 'Cette pièce n''est l''exemplaire d''aucune facture.' using errcode = '22023';
  end if;
  -- 4. Validée dans un dossier basculé, elle ne perd pas sa désignation : elle se remplace (VF6-Q1).
  if v_piece.statut = 'validee'
     and coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = p_dossier_id for share), false) then
    raise exception 'Cette pièce est validée dans un dossier dont les factures sont la source de leurs ventes : elle ne perd pas sa désignation — désignez l''autre facture, ou déclarez-la vente hors des factures de l''application.'
      using errcode = '22023';
  end if;
  -- 5. Le gel de la validation, comme sa pièce.
  v_annee := public.exercice_figeant_la_piece(p_piece_id);
  if v_annee is not null then
    raise exception 'Cette pièce porte une écriture validée de l''exercice % : sa désignation ne change plus.', v_annee
      using errcode = '22023';
  end if;
  -- 6. Le virement mixte classé (VF5H-Q1).
  select f.numero into v_numero from public.factures_emises f
   where f.id = v_piece.facture_id and not f.source_de_la_vente
     and exists (select 1 from public.encaissements_factures e join public.lignes_bancaires l on l.id = e.ligne_bancaire_id
                  where e.facture_id = f.id and e.retire_le is null and l.encaissements_de_factures
                    and public.encaissement_justifie_son_mouvement(e.id));
  if found then
    raise exception 'Un encaissement de la facture % est compté par un mouvement classé par ses encaissements, qui date son exemplaire : retirer d''abord ce classement.',
      coalesce(v_numero, '(sans numéro)') using errcode = '22023';
  end if;
  v_avant := v_piece.facture_id;
  perform set_config('jd.exemplaire_facture', p_piece_id::text, true);
  update public.pieces set facture_id = null where id = p_piece_id returning * into v_piece;
  insert into public.designations_des_pieces (dossier_id, piece_id, geste, facture_id, auteur_id)
  values (p_dossier_id, p_piece_id, 'retrait_designation', v_avant, auth.uid());
  perform set_config('jd.exemplaire_facture', '', true);
  return v_piece;
end
$$;

-- ══ (e) Déclarer une vente hors des factures de l'application ══════════
-- Dans l'ordre : 1. l'accès (42501) ; 2. la pièce, dans ce dossier (P0002) ; 3. une pièce de vente ; 4. un dossier basculé
-- (hors de lui, la déclaration ne dirait rien) ; 5. une pièce que rien ne fige ; 6. une pièce qui n'est pas déjà déclarée ;
-- 7. une pièce que le pont ne rattache à aucune facture ; 8. dont les preuves ne se contredisent pas ; 9. la facture
-- qu'elle désignait, qui n'est pas source, dont un encaissement est compté par un mouvement classé par ses encaissements
-- (VF5H-Q1). Les autres en 22023. Une désignation en cours est remplacée (VF6-Q1).
create function public.declarer_vente_hors_des_factures(p_dossier_id uuid, p_piece_id uuid)
returns public.pieces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_piece public.pieces;
  v_annee integer;
  v_numero text;
  v_nombre integer;
  v_contraire boolean;
  v_pont uuid;
  v_avant uuid;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  -- 2. La pièce, dans ce dossier.
  select * into v_piece from public.pieces p where p.id = p_piece_id and p.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Pièce introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  -- 3. Une pièce de vente.
  if v_piece.type_piece <> 'vente' then
    raise exception 'Seule une pièce de vente se déclare vente hors des factures de l''application.' using errcode = '22023';
  end if;
  -- 4. Un dossier basculé.
  if not coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = p_dossier_id for share), false) then
    raise exception 'Une vente ne se déclare hors des factures de l''application que dans un dossier dont les factures sont la source de leurs ventes.'
      using errcode = '22023';
  end if;
  -- 5. Le gel de la validation, comme sa pièce.
  v_annee := public.exercice_figeant_la_piece(p_piece_id);
  if v_annee is not null then
    raise exception 'Cette pièce porte une écriture validée de l''exercice % : sa déclaration ne change plus.', v_annee
      using errcode = '22023';
  end if;
  -- 6. Déjà déclarée.
  if v_piece.vente_hors_des_factures then
    raise exception 'Cette pièce est déjà déclarée vente hors des factures de l''application.' using errcode = '22023';
  end if;
  select count(*), bool_or(x.nature_contraire), min(x.facture_id::text)::uuid into v_nombre, v_contraire, v_pont
    from public.factures_du_pont(v_piece) x;
  -- 7. Le pont la rattache à une facture : elle s'en désigne l'exemplaire.
  if v_nombre = 1 and not v_contraire then
    select coalesce(f.numero, '(sans numéro)') into v_numero from public.factures_emises f where f.id = v_pont;
    raise exception 'Cette pièce est la facture % émise dans l''application, revenue comme pièce : elle se désigne exemplaire de cette facture, et ne se déclare pas hors des factures de l''application.',
      v_numero using errcode = '22023';
  end if;
  -- 8. Ses preuves se contredisent (VF6-Q5).
  if v_nombre > 1 or v_contraire then
    raise exception 'Les preuves de cette pièce se contredisent — elle porte plusieurs factures émises, ou une autre nature que la facture que son numéro désigne : vérifiez-la sur la plateforme avant de la déclarer.'
      using errcode = '22023';
  end if;
  -- 9. Le virement mixte classé (VF5H-Q1).
  select f.numero into v_numero from public.factures_emises f
   where f.id = v_piece.facture_id and not f.source_de_la_vente
     and exists (select 1 from public.encaissements_factures e join public.lignes_bancaires l on l.id = e.ligne_bancaire_id
                  where e.facture_id = f.id and e.retire_le is null and l.encaissements_de_factures
                    and public.encaissement_justifie_son_mouvement(e.id));
  if found then
    raise exception 'Un encaissement de la facture % est compté par un mouvement classé par ses encaissements, qui date son exemplaire : retirer d''abord ce classement.',
      coalesce(v_numero, '(sans numéro)') using errcode = '22023';
  end if;
  v_avant := v_piece.facture_id;
  perform set_config('jd.exemplaire_facture', p_piece_id::text, true);
  update public.pieces set vente_hors_des_factures = true, facture_id = null where id = p_piece_id returning * into v_piece;
  if v_avant is not null then
    insert into public.designations_des_pieces (dossier_id, piece_id, geste, facture_id, auteur_id)
    values (p_dossier_id, p_piece_id, 'retrait_designation', v_avant, auth.uid());
  end if;
  insert into public.designations_des_pieces (dossier_id, piece_id, geste, facture_id, auteur_id)
  values (p_dossier_id, p_piece_id, 'declaration', null, auth.uid());
  perform set_config('jd.exemplaire_facture', '', true);
  return v_piece;
end
$$;

-- ══ (e) Retirer la déclaration ══════════
-- Dans l'ordre : 1. l'accès (42501) ; 2. la pièce, dans ce dossier (P0002) ; 3. une pièce déclarée ; 4. une pièce qui
-- n'est pas validée dans un dossier basculé (elle se désigne, ou se remet d'abord à valider) ; 5. une pièce que rien ne
-- fige. Les autres en 22023.
create function public.retirer_declaration_hors_des_factures(p_dossier_id uuid, p_piece_id uuid)
returns public.pieces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_piece public.pieces;
  v_annee integer;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  -- 2. La pièce, dans ce dossier.
  select * into v_piece from public.pieces p where p.id = p_piece_id and p.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Pièce introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  -- 3. Une pièce déclarée.
  if not v_piece.vente_hors_des_factures then
    raise exception 'Cette pièce n''est pas déclarée vente hors des factures de l''application.' using errcode = '22023';
  end if;
  -- 4. Validée dans un dossier basculé, elle ne perd pas sa déclaration.
  if v_piece.statut = 'validee'
     and coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = p_dossier_id for share), false) then
    raise exception 'Cette pièce est validée dans un dossier dont les factures sont la source de leurs ventes : elle ne perd pas sa déclaration — désignez-la exemplaire de sa facture, ou remettez-la d''abord à valider.'
      using errcode = '22023';
  end if;
  -- 5. Le gel de la validation, comme sa pièce.
  v_annee := public.exercice_figeant_la_piece(p_piece_id);
  if v_annee is not null then
    raise exception 'Cette pièce porte une écriture validée de l''exercice % : sa déclaration ne change plus.', v_annee
      using errcode = '22023';
  end if;
  perform set_config('jd.exemplaire_facture', p_piece_id::text, true);
  update public.pieces set vente_hors_des_factures = false where id = p_piece_id returning * into v_piece;
  insert into public.designations_des_pieces (dossier_id, piece_id, geste, facture_id, auteur_id)
  values (p_dossier_id, p_piece_id, 'retrait_declaration', null, auth.uid());
  perform set_config('jd.exemplaire_facture', '', true);
  return v_piece;
end
$$;

-- ══ Les droits d'exécution ══════════
-- Les deux fonctions neuves vérifient l'accès elles-mêmes, et un anonyme n'a rien à y faire ; les deux d'hier gardent les
-- leurs (`create or replace`). Le jumeau du pont et les gardes ne s'appellent pas : seules les fonctions et les gardes,
-- en propriétaire, les atteignent.
revoke execute on function public.declarer_vente_hors_des_factures(uuid, uuid) from public, anon;
grant execute on function public.declarer_vente_hors_des_factures(uuid, uuid) to authenticated;
revoke execute on function public.retirer_declaration_hors_des_factures(uuid, uuid) from public, anon;
grant execute on function public.retirer_declaration_hors_des_factures(uuid, uuid) to authenticated;
revoke execute on function public.factures_du_pont(public.pieces) from public, anon, authenticated;
revoke execute on function public.garder_vente_d_un_dossier_bascule() from public, anon, authenticated;
revoke execute on function public.garder_exemplaire_d_une_source() from public, anon, authenticated;
revoke execute on function public.garder_designation_des_pieces() from public, anon, authenticated;

comment on function public.garder_exemplaire_facture() is
  'Garde de la désignation et de la déclaration d''une pièce : posées et retirées par les fonctions du cabinet seules, ou réinsérées par la restauration du super-administrateur ; jamais les deux ; une facture validée du même dossier, sur une pièce de vente ; une pièce désignée ou déclarée ne change ni de dossier ni de nature.';
comment on function public.designer_exemplaire_facture(uuid, uuid, uuid) is
  'Désigne une pièce de vente exemplaire d''une facture émise validée du même dossier (le cabinet seul), en remplaçant ce qu''elle désignait ou sa déclaration, après les refus dits dans la migration jumelle_inversee ; le journal le garde.';
comment on function public.defaire_exemplaire_facture(uuid, uuid) is
  'Défait la désignation d''une pièce exemplaire d''une facture (le cabinet seul), tant que rien ne la fige et qu''elle n''est pas validée dans un dossier dont les factures sont la source de leurs ventes ; le journal le garde.';
comment on function public.declarer_vente_hors_des_factures(uuid, uuid) is
  'Déclare une pièce de vente d''un dossier basculé vente hors des factures de l''application (le cabinet seul), quand le pont ne la rattache à aucune facture, en remplaçant sa désignation ; le journal le garde.';
comment on function public.retirer_declaration_hors_des_factures(uuid, uuid) is
  'Retire la déclaration d''une pièce (le cabinet seul), tant que rien ne la fige et qu''elle n''est pas validée dans un dossier basculé ; le journal le garde.';
comment on function public.garder_vente_d_un_dossier_bascule() is
  'G3 : une pièce de vente validée d''un dossier basculé est l''exemplaire désigné de la facture que le pont prouve, ou désignée, ou déclarée vente hors des factures ; jugée à son passage seulement, jamais à la restauration.';
comment on function public.garder_exemplaire_d_une_source() is
  'G4 : l''exemplaire d''une facture source n''est ni rapproché, ni réglé par une part d''un virement groupé, ni écrit, ni lettré.';
comment on function public.garder_designation_des_pieces() is
  'Garde du journal des désignations : écrit par les fonctions du cabinet sous le réglage de leur pièce, ou par la restauration du super-administrateur ; une pièce et une facture de son dossier ; ne se réécrit pas.';
