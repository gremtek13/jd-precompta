-- EXP58-Q2 : UN CODE OPAQUE PAR FICHE CLIENT, POSÉ PAR LA BASE, ET L'IDENTIFICATION DU CLIENT DU FEC QUI LE PORTE — PRÉPARÉE
-- le 24/11/2026, PAS APPLIQUÉE. La réponse du cabinet du 18/11/2026, (A) « un code opaque par fiche client (migration) » ; la
-- conception : docs/conceptions/58-reponses-de-l-expert-comptable.md, § 1.4 et le lot L3 (avant la validation de 2026). Le
-- module que la base redit : src/lib/codesDesClients.ts (la forme du code, le drapeau `CODES_DES_CLIENTS_PREVUS`, baissé) ;
-- src/lib/codesDesClients.test.ts confronte ce texte à lui. Le récit : HISTORIQUE.md, « 24/11/2026 — EXP58-Q2 : UN CODE
-- OPAQUE PAR FICHE CLIENT (PRÉPARÉE, PAS APPLIQUÉE) ». Son retour : supabase/preparees/retour/20261124120100_retour_codes_des_clients.sql.
-- Ses essais : supabase/essais/codesDesClients.sql (une transaction qui s'annule), et les étapes 167 de
-- supabase/essais/validationExercice.sql.
--
-- SOURCES. LPF, art. A47 A-1, VIII, 7° : le FEC d'un BNC en trésorerie porte, en vingt-deuxième information, « l'identification
-- du client (à blanc si non utilisé) » ; BOI-CF-IOR-60-40-20, § 310 : l'identité déclarée par le client, codifiable sous le
-- secret professionnel ; BOI-BNC-DECLA-10-20, § 280 et CGI, art. 99 : le registre d'un professionnel tenu au secret porte le
-- nom du client « ou une référence » qui permet de le retrouver. Règlement (UE) 2016/679, art. 4, 5° (un code qui ne dit rien
-- de la personne sans la table qui l'y rattache : une pseudonymisation) et art. 5, 1, c. PostgreSQL 17 : CREATE TRIGGER (les
-- déclencheurs BEFORE d'une table tirent dans l'ordre de leurs noms), INSERT … ON CONFLICT DO UPDATE (l'écriture d'une ligne
-- de compteur, atomique, sous le verrou de sa ligne). Aucune norme AFNOR.
--
-- CE QU'ELLE POSE :
--   1. `contacts.code_client` : le code d'une fiche, la lettre C et cinq chiffres (C00001 à C99999), de longueur fixe — lisible
--      par un logiciel comptable, sans espace, sans accent, sans zéro qu'un tableur retirerait en tête ; NOT NULL, unique dans le
--      dossier, retirées et effacées comprises. Jamais dérivé du nom, du SIREN ni d'aucune donnée de la fiche : le rang de sa
--      création dans le dossier. Les fiches déjà en base reçoivent le leur dans l'ordre de leur création (`cree_le`, puis
--      l'identifiant).
--   2. `contacts_numerotation` : le compteur de chaque dossier (le dernier numéro donné), sous RLS, SANS policy — aucun rôle de
--      l'API ne le lit ni ne l'écrit, comme `facture_numerotation` et `devis_numerotation` ; la sauvegarde le lit vide et le
--      dit (RESTAU-Q3).
--   3. `poser_code_client`, une garde `security definer` sous le déclencheur `contacts_code_client` (avant l'insertion et la
--      mise à jour, après la porte `_acces_avant_les_gardes`, qui précède toute lettre) :
--        - à l'insertion SANS code — `enregistrer_contact`, donc l'import aussi (`importer_contacts`, ligne par ligne), et une
--          restauration d'une sauvegarde d'avant cette migration —, le code suivant du compteur du dossier ; au-delà de C99999,
--          un refus (23514), rien n'est rangé ;
--        - à l'insertion AVEC un code — la restauration, par la porte du super-administrateur (`contacts_restauration`), seule
--          écriture directe que la RLS admet : le code restauré est gardé (sa forme jugée par la table), et le compteur repris
--          au plus haut des codes du dossier ;
--        - à la mise à jour, le code ne change plus, pour personne (23514) : ni `enregistrer_contact`, ni l'effacement (qui le
--          garde : la fiche effacée reste celle que ses factures désignent), ni le déliement, ni le propriétaire.
--   4. `valider_exercice` (le corps de production au caractère près, `empreinte_des_exercices_forme_2`, md5 923cfa1b…, et trois
--      retouches) : la garde du secret admet aussi, en identification du client, le code de la fiche d'où vient le client
--      d'une facture ou d'un avoir VALIDÉ du dossier (`factures_emises.contact_id`, figé à la validation, une fiche de ce
--      dossier). Le numéro d'un document validé et le SIREN de son client figé restent admis : une facture sans fiche garde la
--      règle d'hier (FEC22-Q4, (D)), et une demande d'avant la bascule de l'application valide comme hier.
--
-- CE QUI A ÉTÉ CHOISI, ET POURQUOI :
--   - un compteur par dossier, dans sa table : la conception l'écrit, et un code n'est jamais redonné, même si une fiche
--     venait un jour à disparaître seule (aujourd'hui, une fiche ne part qu'avec son dossier). Écartés : le plus haut code du
--     dossier plus un, sans compteur (un code se redonnerait après la disparition de la fiche qui le portait) ; une colonne
--     de `dossiers` (que tout client du dossier lit, et dont les gardes tireraient à chaque fiche créée) ;
--   - le code posé par un déclencheur, non par `enregistrer_contact` : tout chemin d'insertion le reçoit — la fonction,
--     l'import, la restauration — sans réécrire le corps d'aucune fonction des contacts ;
--   - le code lu sur la fiche, non recopié sur la facture : la validation fige `contact_id` (A7a, `garder_factures_validees`)
--     et la fiche ne change plus de code — une copie demanderait de réécrire `enregistrer_facture`, que la facture
--     internationale (e7a) remplace déjà ;
--   - le message du refus `client_inconnu` gardé au caractère près : il reste vrai (il dit ce qui n'est pas admis) et les dix
--     cas de validationExercice.sql, comme la confrontation de src/lib/champsBncFiges.ts à `champs_bnc_du_fec`, se rejouent
--     dans les deux états.
--
-- CE QU'ELLE NE FAIT PAS : l'application ne lit rien de neuf tant que `CODES_DES_CLIENTS_PREVUS` est baissé — l'identification
-- du client du FEC reste celle d'hier, et le FEC d'aujourd'hui (à dix-huit colonnes, `CHAMPS_BNC_EXPORTES` baissé) n'en porte
-- aucune. Aucune donnée n'est retirée ; aucune fonction des contacts, des factures ni des Edge Functions ne change. Le client
-- « Ventes », qui lit toute la fiche (`contacts_lecture_ventes`), y lit aussi son code.
--
-- À APPLIQUER PAR L'OUTIL : aucune instruction n'y retire quoi que ce soit (ni table, ni colonne, ni ligne). APRÈS elle, la
-- migration de l'inventaire (`validation_de_l_inventaire`, INV3), qui remplace aussi `valider_exercice` sur le corps 923cfa1b…,
-- se refuse : elle se reprend sur le corps que celle-ci pose (et réciproquement, si INV3 passe la première).

-- ══ 0. La garde de tête ══════════
do $garde$
declare
  v_f text;
begin
  if to_regclass('public.contacts_numerotation') is not null
     or exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name = 'contacts' and c.column_name = 'code_client') then
    raise exception 'La migration codes_des_clients est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.contacts') is null or to_regclass('public.dossiers') is null
     or not exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = 'factures_emises' and c.column_name = 'contact_id')
     or not exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = 'ecritures_brouillon' and c.column_name = 'identification_client') then
    raise exception 'codes_des_clients : les contacts, la provenance d''une facture (contact_id) ou l''identification du client du FEC manquent : relire la base.';
  end if;
  -- La porte d'accès devant les gardes (GARDES-Q1, en production depuis le 15/11/2026) : la garde de cette migration tire
  -- derrière celle que `contacts` porte déjà.
  if to_regprocedure('public.acces_avant_les_gardes()') is null
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.contacts'::regclass and t.tgname = '_acces_avant_les_gardes') then
    raise exception 'codes_des_clients : la porte d''accès devant les gardes (_acces_avant_les_gardes) manque sur contacts : relire la base.';
  end if;
  -- La fonction qu'elle remplace et celle qu'elle sait admise, à l'empreinte de leur corps (les retours chariot écartés),
  -- relevées le 24/11/2026 sur une copie de la réplique portée à la production du jour (250).
  for v_f in select x.f from (values
      ('valider_exercice(uuid, integer, jsonb, jsonb, jsonb)', '923cfa1b57037146070ca1430f163495'),
      ('acces_avant_les_gardes()', 'a9296ffcbe160a66a6c377a1e97cdde8')) as x(f, empreinte)
    where (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p where p.oid = to_regprocedure('public.' || x.f))
          is distinct from x.empreinte
  loop
    raise exception 'La fonction % n''est plus celle que cette migration remplace ou suppose : relire la migration contre la base avant de l''appliquer.', v_f;
  end loop;
end
$garde$;

-- ══ 1. Le code d'une fiche ══════════
alter table public.contacts add column code_client text;

-- Les fiches déjà en base, dans l'ordre de leur création, dossier par dossier (avant la garde, qui refuserait de changer un
-- code ; aucune n'en a encore).
update public.contacts c
   set code_client = 'C' || lpad(r.rang::text, 5, '0')
  from (select x.id, row_number() over (partition by x.dossier_id order by x.cree_le, x.id) as rang from public.contacts x) r
 where c.id = r.id;

alter table public.contacts
  alter column code_client set not null,
  add constraint contacts_code_client_forme check (code_client ~ '^C[0-9]{5}$' and code_client <> 'C00000'),
  add constraint contacts_code_client_unique unique (dossier_id, code_client);

comment on column public.contacts.code_client is
  'Le code de la fiche (EXP58-Q2) : C et cinq chiffres, posé par la base à la création — le rang de la fiche dans le dossier, jamais dérivé de son nom ni de son SIREN —, puis gardé, l''effacement compris ; l''identification du client des écritures de ses factures dans le FEC.';

-- ══ 2. Le compteur de chaque dossier ══════════
create table public.contacts_numerotation (
  dossier_id uuid primary key references public.dossiers (id) on delete cascade,
  dernier_numero integer not null check (dernier_numero between 1 and 99999)
);
alter table public.contacts_numerotation enable row level security;
-- Aucune policy : seule la garde des contacts, aux droits du propriétaire, le lit et l'écrit.

insert into public.contacts_numerotation (dossier_id, dernier_numero)
select c.dossier_id, max(substr(c.code_client, 2)::integer) from public.contacts c group by c.dossier_id;

comment on table public.contacts_numerotation is
  'Le dernier numéro de code donné à une fiche de contacts du dossier (EXP58-Q2) ; sans policy, écrit par la garde poser_code_client seule ; hors de la sauvegarde, que la restauration reprend au plus haut des codes restaurés.';

-- La double authentification exigée (`deux_facteurs_exiges`, préparée) : sa restrictive, si elle est déjà en base.
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.contacts_numerotation as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;

-- ══ 3. La garde qui pose le code et le garde ══════════
create function public.poser_code_client() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero integer;
begin
  if tg_op = 'UPDATE' then
    if new.code_client is distinct from old.code_client then
      raise exception 'Le code d''une fiche client est posé par la base à sa création et ne change plus : il désigne ce client dans le FEC.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  -- Un code donné : celui qu'une restauration réinsère — la seule écriture directe que la RLS admet, au super-administrateur.
  -- Gardé, sa forme jugée par la table ; le compteur repris au plus haut.
  if new.code_client is not null then
    if new.code_client ~ '^C[0-9]{5}$' then
      insert into public.contacts_numerotation as n (dossier_id, dernier_numero)
      values (new.dossier_id, greatest(substr(new.code_client, 2)::integer, 1))
      on conflict (dossier_id) do update set dernier_numero = greatest(n.dernier_numero, excluded.dernier_numero);
    end if;
    return new;
  end if;
  -- Sans code : le suivant du compteur du dossier, sous le verrou de sa ligne.
  insert into public.contacts_numerotation as n (dossier_id, dernier_numero) values (new.dossier_id, 1)
  on conflict (dossier_id) do update set dernier_numero = n.dernier_numero + 1 where n.dernier_numero < 99999
  returning n.dernier_numero into v_numero;
  if v_numero is null then
    raise exception 'Ce dossier a reçu ses 99 999 codes de fiche client (C00001 à C99999) : une fiche de plus n''a plus de code.'
      using errcode = '23514';
  end if;
  new.code_client := 'C' || lpad(v_numero::text, 5, '0');
  return new;
end
$$;

create trigger contacts_code_client before insert or update on public.contacts
  for each row execute function public.poser_code_client();

revoke execute on function public.poser_code_client() from public, anon, authenticated;

comment on function public.poser_code_client() is
  'Garde des contacts (EXP58-Q2) : pose le code d''une fiche créée sans code (le suivant du compteur du dossier), garde celui qu''une restauration réinsère (le compteur repris au plus haut), refuse tout changement de code.';

-- ══ 4. La validation admet le code de la fiche d'un document validé ══════════
create or replace function public.valider_exercice(
  p_dossier_id uuid,
  p_annee integer,
  p_lignes jsonb,
  p_a_nouveaux jsonb,
  p_declaration jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet uuid;
  v_mode text;
  v_debut date;
  v_fin date;
  v_ouverture date;
  v_anterieur integer;
  v_attendues integer;
  v_recues integer;
  v_distinctes integer;
  v_jointes integer;
  v_an_attendus integer;
  v_an_recus integer;
  v_an_distincts integer;
  v_an_joints integer;
  v_a_traiter integer;
  v_derniere integer;
  v_defaut text;
  v_maintenant timestamptz := now();
  v_precedente text;
  v_empreinte text;
  v_debit numeric;
  v_credit numeric;
  v_ecritures integer;
  v_lignes integer;
  v_hors text;
  v_ecart numeric;
  v_reportes integer;
  v_bascule boolean;
  v_mouvement record;
  v_numero text;
  v_encaissement record;
  v_vente record;
  v_champs text;
  v_paiement record;
  v_auteur uuid;
begin
  select cabinet_id, mode_comptable into v_cabinet, v_mode from public.dossiers where id = p_dossier_id;
  if not found or not public.est_chef_du_cabinet(v_cabinet) then
    raise exception 'Seul le chef du cabinet valide un exercice.' using errcode = '42501';
  end if;
  if p_annee is null or p_annee < 2000 or p_annee > 2100 then
    raise exception 'Exercice invalide.' using errcode = '22023';
  end if;
  -- Exclusif : aucune écriture ni aucune source ne change pendant la validation (voir `cle_validation`).
  perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));
  v_debut := make_date(p_annee, 1, 1);
  v_fin := make_date(p_annee, 12, 31);
  -- L'année se lit à Paris, comme dans l'application : la nuit du 1er janvier ne doit pas les faire diverger.
  if p_annee >= extract(year from (now() at time zone 'Europe/Paris'))::integer then
    raise exception 'L''exercice % n''est pas terminé : il se valide une fois clos.', p_annee using errcode = '22023';
  end if;
  if exists (select 1 from public.exercices_valides where dossier_id = p_dossier_id and annee >= p_annee) then
    raise exception 'L''exercice % est déjà validé, ou un exercice postérieur l''est.', p_annee using errcode = '23514';
  end if;
  -- Après le premier, chaque exercice suit le précédent : un exercice sauté serait figé par la frontière sans
  -- qu'aucune validation ne l'ait regardé.
  select max(annee) into v_derniere from public.exercices_valides where dossier_id = p_dossier_id;
  if v_derniere is not null and p_annee <> v_derniere + 1 then
    raise exception 'L''exercice % n''est pas validé : les exercices se valident dans l''ordre.', v_derniere + 1
      using errcode = '23514';
  end if;
  select min(date) into v_ouverture from public.a_nouveaux where dossier_id = p_dossier_id;
  if v_ouverture is not null and v_fin < v_ouverture then
    raise exception 'L''exercice % précède l''ouverture du dossier : il est dans les comptes repris.', p_annee
      using errcode = '22023';
  end if;
  -- Les à-nouveaux ouvrent le premier exercice du dossier, qui se valide avant tout autre : sans quoi la frontière
  -- les figerait sans qu'aucun exercice validé ne les porte.
  if v_ouverture is not null and v_ouverture < v_debut and not exists (
    select 1 from public.exercices_valides
     where dossier_id = p_dossier_id and annee = extract(year from v_ouverture)::integer
  ) then
    raise exception 'L''exercice % porte les à-nouveaux du dossier : il se valide d''abord.',
      extract(year from v_ouverture)::integer using errcode = '23514';
  end if;
  select min(extract(year from date))::integer into v_anterieur
    from public.ecritures_brouillon where dossier_id = p_dossier_id and date < v_debut and statut = 'proposee';
  if v_anterieur is not null then
    -- Leur exercice ne se validera jamais : il précède l'ouverture, et les comptes repris portent cette période.
    if v_ouverture is not null and v_anterieur < extract(year from v_ouverture)::integer then
      raise exception 'Des écritures antérieures à l''ouverture du dossier ne sont pas validées : cette période est dans les comptes repris, les retirer ou les redater avant la validation.'
        using errcode = '23514';
    end if;
    raise exception 'L''exercice % porte des écritures qui ne sont pas validées : les exercices se valident dans l''ordre.',
      v_anterieur using errcode = '23514';
  end if;
  -- LES VENTES FACTURÉES D'UN DOSSIER BASCULÉ (étape VF7b ; conception de VF7, § 3 c) : trois manques de G5 retiennent la
  -- validation, sous leur nom, avant la numérotation — un mouvement réservé, un virement ou un prélèvement sans son
  -- mouvement, une vente facturée qui n'est pas écrite à jour. Un dossier qui n'a pas basculé n'en porte aucun.
  v_bascule := coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = p_dossier_id), false);
  -- Un mouvement RÉSERVÉ (G2), daté jusqu'au 31 décembre : libre, et justifié par l'encaissement vivant d'une facture
  -- source. Il est à traiter : dit avant les mouvements à traiter, il l'est sous son nom, car il ne se classe que par ses
  -- encaissements — un débit, par ses contre-passations. La facture est celle que la garde des mouvements nomme.
  if v_bascule then
    select l.id, l.date, l.montant into v_mouvement
      from public.lignes_bancaires l
     where l.dossier_id = p_dossier_id and l.date <= v_fin and public.mouvement_libre(l)
       and exists (select 1 from public.encaissements_factures e
                     join public.factures_emises f on f.id = e.facture_id
                    where e.ligne_bancaire_id = l.id and e.retire_le is null and f.source_de_la_vente
                      and public.encaissement_justifie_son_mouvement(e.id))
     order by l.date, l.id
     limit 1;
    if found then
      select f.numero into v_numero
        from public.encaissements_factures e
        join public.factures_emises f on f.id = e.facture_id
       where e.ligne_bancaire_id = v_mouvement.id and e.retire_le is null and f.source_de_la_vente
         and public.encaissement_justifie_son_mouvement(e.id)
       order by e.cree_le, e.id
       limit 1;
      if v_mouvement.montant >= 0 then
        raise exception 'L''exercice % porte un mouvement du % réservé à l''encaissement de la facture % : le classer par ses encaissements avant la validation.',
          extract(year from v_mouvement.date)::integer, to_char(v_mouvement.date, 'DD/MM/YYYY'), v_numero using errcode = '23514';
      end if;
      raise exception 'L''exercice % porte un mouvement du % réservé à la contre-passation d''un encaissement de la facture % : le classer par ses contre-passations avant la validation.',
        extract(year from v_mouvement.date)::integer, to_char(v_mouvement.date, 'DD/MM/YYYY'), v_numero using errcode = '23514';
    end if;
  end if;
  -- Un mouvement daté d'un exercice validé ne change plus (migration `sources_figees_par_la_validation`) : encore
  -- à traiter, il le resterait.
  select min(extract(year from date))::integer into v_a_traiter
    from public.lignes_bancaires where dossier_id = p_dossier_id and date <= v_fin and statut = 'non_rapprochee';
  if v_a_traiter is not null then
    if v_ouverture is not null and v_a_traiter < extract(year from v_ouverture)::integer then
      raise exception 'Des mouvements bancaires antérieurs à l''ouverture du dossier restent à traiter : les ignorer avant la validation.'
        using errcode = '23514';
    end if;
    raise exception 'L''exercice % porte des mouvements bancaires à traiter : ils se traitent avant la validation.', v_a_traiter
      using errcode = '23514';
  end if;
  if v_bascule then
    -- Un encaissement vivant d'une facture source — ni retiré, ni contre-passation, ni défait par une contre-passation
    -- sans mouvement —, par virement ou par prélèvement, daté jusqu'au 31 décembre, qui ne cite aucun mouvement : encaissé
    -- à l'inscription au crédit, son mouvement est de son exercice ; il manque au relevé, ou n'y est pas rattaché. Un
    -- chèque, une carte ou un effet sans mouvement au 31 décembre est un en-cours (le 511, EC3-Q7) : il ne retient pas.
    select e.date_encaissement, e.moyen, f.numero into v_encaissement
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
     where e.dossier_id = p_dossier_id and f.source_de_la_vente and e.retire_le is null and e.annule_id is null
       and e.ligne_bancaire_id is null and e.moyen in ('virement', 'prelevement') and e.date_encaissement <= v_fin
       and public.encaissement_justifie_son_mouvement(e.id)
     order by e.date_encaissement, e.cree_le, e.id
     limit 1;
    if found then
      raise exception 'L''exercice % porte un encaissement de la facture % par % du %, sans son mouvement : il manque au relevé, ou n''y est pas rattaché — le rattacher avant la validation.',
        extract(year from v_encaissement.date_encaissement)::integer, v_encaissement.numero,
        case v_encaissement.moyen when 'virement' then 'virement' else 'prélèvement' end,
        to_char(v_encaissement.date_encaissement, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    -- Une source dont ce qui s'écrit entre la frontière et le 31 décembre n'est pas EXACTEMENT ce que le brouillon
    -- propose, ou qui ne s'écrit pas quand sa date tombe dans cette période : la première, dans l'ordre de
    -- `ventes_facturees_de_l_exercice` — la période part de la frontière, et un premier exercice validé ne fige pas un
    -- manque d'avant lui.
    select v.* into v_vente from public.ventes_facturees_de_l_exercice(p_dossier_id, p_annee) v limit 1;
    if found then
      if v_vente.etat = 'a_ecrire' then
        raise exception 'L''exercice % porte une vente facturée qui n''est pas écrite : % — l''écrire avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      if v_vente.etat = 'a_reecrire' then
        raise exception 'L''exercice % porte une vente facturée dont l''écriture proposée n''est plus celle que sa source commande : % — la réécrire avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      if v_vente.etat = 'a_retirer' then
        raise exception 'L''exercice % porte l''écriture proposée d''une vente facturée qui n''a plus rien à écrire : % — la retirer avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      raise exception 'L''exercice % porte une vente facturée qui ne s''écrit pas : % — lever ce qui la retient avant la validation.',
        extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
    end if;
  end if;
  if (v_mode = 'tresorerie') <> (jsonb_typeof(p_declaration) is not distinct from 'object') then
    raise exception '%', case when v_mode = 'tresorerie' then 'La 2035 à valider manque.'
      else 'Un dossier tenu en engagement n''a pas de 2035.' end using errcode = '22023';
  end if;
  if jsonb_typeof(p_lignes) is distinct from 'array' then
    raise exception 'La numérotation proposée est illisible.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_a_nouveaux) is distinct from 'array' then
    raise exception 'Les libellés proposés des à-nouveaux sont illisibles.' using errcode = '22023';
  end if;

  with l as (
    select * from jsonb_to_recordset(p_lignes) as x(id uuid, journal text, numero integer, piece_ref text,
      piece_date date, compte_lib text, comp_aux_num text, comp_aux_lib text)
  ), e as (
    select id, date, compte, montant, sens from public.ecritures_brouillon
    where dossier_id = p_dossier_id and date between v_debut and v_fin
  ), j as (
    select l.*, e.date, e.compte, e.montant, e.sens from l join e on e.id = l.id
  ), groupes as (
    select journal, numero, min(date) as premiere,
      sum(case when sens = 'debit' then montant else -montant end) as solde,
      count(distinct piece_ref) as refs, count(distinct piece_date) as dates, count(distinct date) as jours
    from j group by journal, numero
  ), journaux as (
    select journal, min(numero) as premier, max(numero) as dernier, count(*) as nb from groupes group by journal
  ), an_l as (
    select * from jsonb_to_recordset(p_a_nouveaux) as x(id uuid, compte_lib text, ecriture_lib text)
  ), an_e as (
    -- L'ouverture de l'exercice : la balance reprise, ou les soldes reportés de l'exercice validé qui le précède.
    select id, compte from public.a_nouveaux where dossier_id = p_dossier_id and date between v_debut and v_fin
    union all
    select id, compte from public.soldes_reportes where dossier_id = p_dossier_id and date = v_debut
  ), an_j as (
    select an_l.*, an_e.compte from an_l join an_e on an_e.id = an_l.id
  )
  select
    (select count(*) from e), (select count(*) from l), (select count(distinct id) from l), (select count(*) from j),
    (select count(*) from an_e), (select count(*) from an_l), (select count(distinct id) from an_l),
    (select count(*) from an_j),
    case
      when exists (select 1 from l where journal is null or journal not in ('AC', 'VE', 'BQ', 'OD')
          or numero is null or numero < 1 or coalesce(btrim(piece_ref), '') = '' or piece_date is null
          or coalesce(btrim(compte_lib), '') = '' or (comp_aux_num is null) <> (comp_aux_lib is null)
          or (comp_aux_num is not null and (btrim(comp_aux_num) = '' or btrim(comp_aux_lib) = '')))
        then 'Une ligne de la numérotation proposée est incomplète.'
      when exists (select 1 from an_l where coalesce(btrim(compte_lib), '') = '' or coalesce(btrim(ecriture_lib), '') = '')
        then 'Un à-nouveau proposé est incomplet.'
      when exists (select 1 from journaux where premier <> 1 or dernier <> nb)
        then 'Les numéros d''un journal ne se suivent pas.'
      when exists (select 1 from (
          select premiere, lag(premiere) over (partition by journal order by numero) as avant from groupes) z
          where avant > premiere)
        then 'Les numéros d''un journal ne suivent pas l''ordre des dates.'
      when exists (select 1 from groupes where solde <> 0)
        then 'Une écriture n''est pas équilibrée au centime.'
      when exists (select 1 from groupes where refs <> 1 or dates <> 1)
        then 'Les lignes d''une même écriture ne portent pas la même pièce.'
      when exists (select 1 from groupes where jours <> 1)
        then 'Les lignes d''une même écriture ne portent pas la même date.'
      when exists (select 1 from (select compte, compte_lib from j union all select compte, compte_lib from an_j) c
          group by compte having count(distinct compte_lib) > 1)
        then 'Un même compte porte deux libellés.'
      when exists (select 1 from j where comp_aux_num is not null group by comp_aux_num having count(distinct comp_aux_lib) > 1)
        then 'Un même compte auxiliaire porte deux libellés.'
    end
  into v_attendues, v_recues, v_distinctes, v_jointes, v_an_attendus, v_an_recus, v_an_distincts, v_an_joints, v_defaut;

  if v_recues <> v_distinctes or v_recues <> v_attendues or v_jointes <> v_recues then
    raise exception 'La numérotation proposée ne couvre pas exactement les % écritures de l''exercice %.', v_attendues, p_annee
      using errcode = '22023';
  end if;
  if v_an_recus <> v_an_distincts or v_an_recus <> v_an_attendus or v_an_joints <> v_an_recus then
    raise exception 'Les libellés proposés ne couvrent pas exactement les % à-nouveaux de l''exercice %.', v_an_attendus, p_annee
      using errcode = '22023';
  end if;
  if v_defaut is not null then
    raise exception '%', v_defaut using errcode = '22023';
  end if;

  -- LES QUATRE CHAMPS DU FEC D'UN BNC EN TRÉSORERIE (ligne 26.6, étape e ; lot FEC22b ; MVP-D5 ; LPF, art. A47 A-1,
  -- VIII, 7°) : la date de règlement, le mode de règlement, la nature de l'opération et l'identification du client,
  -- figés avec chaque ligne comme sa pièce et son numéro, et le poste de la 2035 d'une ligne de charge ou de produit,
  -- avec lequel NatOp se recompose (FEC22-Q3, (C)). L'application les tire de la source de chaque écriture
  -- (src/lib/champsBncDuFec.ts) ; la base vérifie ce qu'elle peut vérifier sans les refaire. Une demande qui ne les
  -- porte pas valide comme hier : ils restent nuls. Dans l'ordre, après les refus d'hier :
  --   - chaque valeur dans sa forme : une date du calendrier, au plus aujourd'hui à Paris ; un mode et une nature de
  --     leur liste fermée ; un poste de la sienne (`POSTES_RATTACHES`, src/lib/cases2035.ts), avec une nature, sur une
  --     ligne de produit (classe 7) pour un poste que la 2035 range sous une recette, de charge (classe 6) pour un
  --     poste qu'elle range sous une dépense, les débours et les honoraires rétrocédés compris — ce que `posteRattache`
  --     rend (`cadreCompatible`) ;
  --   - la date, le mode, la nature et le client les mêmes sur toutes les lignes d'une écriture ; le poste suit la
  --     ligne ;
  --   - LA GARDE DU SECRET (BOI-BNC-DECLA-10-20, § 280 ; CGI, art. 99 ; FEC22-Q4, (D)) : un client ne s'identifie que
  --     par le numéro d'une facture ou d'un avoir VALIDÉ du dossier, ou par le SIREN que porte son client figé — les
  --     neuf premiers chiffres de son `tiers_siret` quand il n'est fait que de neuf ou de quatorze chiffres et passe
  --     ses clés, comme `identificationDuClient` le lit. Aucun chemin n'y fait entrer un nom. Depuis EXP58-Q2
  --     (`codes_des_clients`), aussi par le code de la fiche d'où vient le client d'un tel document
  --     (`factures_emises.contact_id`, figé avec lui), cette fiche du dossier : un code que la base a posé à sa
  --     création, qui ne change plus et ne dit rien du client.
  -- « Sans règlement » est un mode de la liste : la base ne choisit pas entre lui et des champs vides (FEC22-Q1, (C) ;
  -- FEC22-E2). src/lib/champsBncFiges.ts redit ces refus, dans cet ordre.
  with l as (
    select x.*, e.compte,
           -- La date d'un texte AAAA-MM-JJ, sans lever : un jour hors de son mois en rend une autre, que la relecture
           -- voit.
           case when x.date_reglement !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then null
                else make_date(substr(x.date_reglement, 1, 4)::integer, substr(x.date_reglement, 6, 2)::integer, 1)
                     + (substr(x.date_reglement, 9, 2)::integer - 1) end as jour
      from jsonb_to_recordset(p_lignes) as x(id uuid, journal text, numero integer, date_reglement text,
             mode_reglement text, nature_operation text, poste_rattache text, identification_client text)
      join public.ecritures_brouillon e on e.id = x.id and e.dossier_id = p_dossier_id
  ), ecritures as (
    -- Une valeur est la même sur toutes les lignes d'une écriture quand elle y est partout, une seule, ou nulle
    -- partout.
    select count(distinct date_reglement) > 1 or count(date_reglement) not in (0, count(*)) as dates,
           count(distinct mode_reglement) > 1 or count(mode_reglement) not in (0, count(*)) as modes,
           count(distinct nature_operation) > 1 or count(nature_operation) not in (0, count(*)) as natures,
           count(distinct identification_client) > 1 or count(identification_client) not in (0, count(*)) as clients
      from l group by journal, numero
  ), modes(mode) as (
    -- Les modes de règlement (`MODES_REGLEMENT`, src/lib/champsBncDuFec.ts).
    values
      ('Banque'), ('Espèces'), ('Compte personnel'), ('Virement'), ('Chèque'), ('Carte bancaire'), ('Prélèvement'),
      ('Effet'), ('Compensation'), ('Autre'), ('Sans règlement')
  ), natures(nature) as (
    -- Les natures de l'opération (`NATURES_OPERATION`, src/lib/champsBncDuFec.ts).
    values
      ('Recette'), ('Dépense'), ('Recette et dépense'), ('Acquisition d''immobilisation'), ('Apport de l''exploitant'),
      ('Prélèvement de l''exploitant'), ('Échéance d''emprunt'), ('Déblocage d''emprunt'), ('Cotisation sociale'),
      ('Opération de bilan'), ('Versement d''espèces'), ('Retrait d''espèces pour la caisse'), ('Paiement de TVA'),
      ('Remboursement de TVA'), ('Liquidation de TVA'), ('Dotation aux amortissements'), ('Frais de véhicule (barème)'),
      ('À-nouveaux'), ('TVA due sur facture'), ('Annulation de recette'), ('Remise en banque')
  ), postes(poste, classe) as (
    -- Les postes que la 2035 range (`POSTES_RATTACHES`, src/lib/cases2035.ts), chacun avec la classe des comptes qui le
    -- portent : 7, un produit, pour un poste qu'elle range sous une recette ; 6, une charge, pour un poste qu'elle
    -- range sous une dépense — ceux des dépenses, et ceux des deux cases qui se retranchent des recettes, les débours
    -- (AB) et les honoraires rétrocédés (AC) : la rétrocession payée à un remplaçant est une charge
    -- (`cadreCompatible`).
    values
      ('Recettes', '7'), ('Recettes encaissées y compris les remboursements de frais', '7'),
      ('Débours payés pour le compte des clients', '6'), ('Débours', '6'), ('Honoraires rétrocédés', '6'),
      ('Rétrocessions', '6'), ('Produits financiers', '7'), ('Gains divers', '7'),
      ('Indemnités journalières', '7'), ('Achats', '6'),
      ('Salaires nets et avantages en nature', '6'), ('Salaires', '6'), ('Charges sociales sur salaires', '6'),
      ('Taxe sur la valeur ajoutée', '6'), ('TVA', '6'), ('Contribution économique territoriale', '6'), ('CET', '6'),
      ('Autres impôts', '6'), ('Impôts et taxes', '6'), ('Contribution sociale généralisée déductible', '6'),
      ('CSG déductible', '6'), ('Loyer et charges locatives', '6'), ('Loyers et charges locatives', '6'),
      ('Location de matériel et de mobilier', '6'), ('Redevances de collaboration', '6'),
      ('Entretien et réparations', '6'), ('Personnel intérimaire', '6'),
      ('Petit outillage', '6'), ('Chauffage, eau, gaz, électricité', '6'),
      ('Honoraires ne constituant pas des rétrocessions', '6'), ('Primes d''assurance', '6'),
      ('Primes d''assurances', '6'), ('Assurance', '6'), ('Frais de véhicules', '6'),
      ('Autres frais de déplacements', '6'), ('Frais de déplacement', '6'), ('Frais de déplacements', '6'),
      ('Indemnités kilométriques', '6'), ('Cotisations sociales personnelles', '6'),
      ('Charges sociales personnelles', '6'), ('Cotisations facultatives Madelin', '6'),
      ('Plan d''épargne retraite', '6'), ('Frais de réception, de représentation et de congrès', '6'),
      ('Frais de réception, de représentation', '6'),
      ('Fournitures de bureau, frais de documentation, de correspondance et de téléphone', '6'),
      ('Fournitures de bureau', '6'), ('Frais d''actes et de contentieux', '6'),
      ('Cotisations syndicales et professionnelles', '6'), ('Autres frais divers de gestion', '6'),
      ('Frais divers de gestion', '6'), ('Divers', '6'), ('Frais financiers', '6'), ('Pertes diverses', '6'),
      ('Amortissements', '6'), ('Dotation aux amortissements', '6')
  ), documents as (
    -- Les factures et les avoirs validés du dossier : leur numéro, le SIRET ou le SIREN que leur client figé porte, et la
    -- fiche d'où vient ce client (EXP58-Q2).
    select f.numero, f.tiers_siret as siret, f.contact_id from public.factures_emises f
     where f.dossier_id = p_dossier_id and f.statut = 'validee' and coalesce(f.numero, '') <> ''
  ), cles as (
    -- La clé de Luhn de l'INSEE, en entiers : en partant de la droite, un chiffre sur deux doublé (moins neuf au-delà
    -- de neuf) ; la somme d'un numéro juste est un multiple de dix. Les établissements de La Poste (SIREN 356000000),
    -- trop nombreux pour elle, ont un SIRET dont la somme des chiffres est un multiple de cinq ; son siège
    -- (35600000000048) garde la clé de Luhn (INSEE ; `sirenValide`, `siretValide`, src/lib/factureCii.ts).
    select left(d.siret, 9) as siren,
           (select sum(case when (9 - k) % 2 = 1 then case when z.c * 2 > 9 then z.c * 2 - 9 else z.c * 2 end else z.c end)
              from generate_series(1, 9) k cross join lateral (select substr(d.siret, k, 1)::integer as c) z) % 10 = 0
             as siren_juste,
           case when length(d.siret) = 9 then true
                when left(d.siret, 9) = '356000000' and d.siret <> '35600000000048'
                  then (select sum(substr(d.siret, k, 1)::integer) from generate_series(1, 14) k) % 5 = 0
                else (select sum(case when (14 - k) % 2 = 1 then case when z.c * 2 > 9 then z.c * 2 - 9 else z.c * 2 end
                                      else z.c end)
                        from generate_series(1, 14) k cross join lateral (select substr(d.siret, k, 1)::integer as c) z)
                     % 10 = 0
           end as siret_juste
      from documents d
     where d.siret ~ '^[0-9]{9}$' or d.siret ~ '^[0-9]{14}$'
  ), admis(valeur) as (
    -- Ce qui identifie un client : le numéro d'un document validé, le SIREN juste de son client figé, ou le code de la
    -- fiche d'où vient ce client, une fiche du dossier (EXP58-Q2).
    select numero from documents
    union
    select siren from cles where siren_juste and siret_juste
    union
    select c.code_client from documents d join public.contacts c on c.id = d.contact_id and c.dossier_id = p_dossier_id
  )
  select case
      when exists (select 1 from l where date_reglement is not null
                    and (jour is null or to_char(jour, 'YYYY-MM-DD') <> date_reglement)) then 'date_illisible'
      when exists (select 1 from l where jour > (v_maintenant at time zone 'Europe/Paris')::date) then 'date_future'
      when exists (select 1 from l where mode_reglement is not null
                    and not exists (select 1 from modes m where m.mode = l.mode_reglement)) then 'mode_hors_liste'
      when exists (select 1 from l where nature_operation is not null
                    and not exists (select 1 from natures n where n.nature = l.nature_operation)) then 'nature_hors_liste'
      when exists (select 1 from l where poste_rattache is not null
                    and not exists (select 1 from postes p where p.poste = l.poste_rattache)) then 'poste_hors_liste'
      when exists (select 1 from l where poste_rattache is not null and nature_operation is null) then 'poste_sans_nature'
      when exists (select 1 from l where poste_rattache is not null and compte !~ '^[67][0-9]{2}') then 'poste_hors_resultat'
      when exists (select 1 from l where poste_rattache is not null
                    and not exists (select 1 from postes p
                                     where p.poste = l.poste_rattache and p.classe = left(l.compte, 1))) then 'poste_hors_cadre'
      when exists (select 1 from ecritures where dates) then 'date_differe'
      when exists (select 1 from ecritures where modes) then 'mode_differe'
      when exists (select 1 from ecritures where natures) then 'nature_differe'
      when exists (select 1 from ecritures where clients) then 'client_differe'
      when exists (select 1 from l where identification_client is not null
                    and not exists (select 1 from admis a where a.valeur = l.identification_client)) then 'client_inconnu'
    end
  into v_champs;
  if v_champs = 'date_illisible' then
    raise exception 'Une ligne de la numérotation proposée porte une date de règlement illisible.'
      using errcode = '22023';
  end if;
  if v_champs = 'date_future' then
    raise exception 'Une ligne de la numérotation proposée porte une date de règlement postérieure à aujourd''hui.'
      using errcode = '22023';
  end if;
  if v_champs = 'mode_hors_liste' then
    raise exception 'Une ligne de la numérotation proposée porte un mode de règlement hors de sa liste.'
      using errcode = '22023';
  end if;
  if v_champs = 'nature_hors_liste' then
    raise exception 'Une ligne de la numérotation proposée porte une nature d''opération hors de sa liste.'
      using errcode = '22023';
  end if;
  if v_champs = 'poste_hors_liste' then
    raise exception 'Une ligne de la numérotation proposée porte un poste de la 2035 hors de sa liste.'
      using errcode = '22023';
  end if;
  if v_champs = 'poste_sans_nature' then
    raise exception 'Une ligne de la numérotation proposée porte un poste de la 2035 sans nature d''opération.'
      using errcode = '22023';
  end if;
  if v_champs = 'poste_hors_resultat' then
    raise exception 'Une ligne de la numérotation proposée porte un poste de la 2035 sur un compte qui n''est ni de charge ni de produit.'
      using errcode = '22023';
  end if;
  if v_champs = 'poste_hors_cadre' then
    raise exception 'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.'
      using errcode = '22023';
  end if;
  if v_champs = 'date_differe' then
    raise exception 'Les lignes d''une même écriture ne portent pas la même date de règlement.'
      using errcode = '22023';
  end if;
  if v_champs = 'mode_differe' then
    raise exception 'Les lignes d''une même écriture ne portent pas le même mode de règlement.'
      using errcode = '22023';
  end if;
  if v_champs = 'nature_differe' then
    raise exception 'Les lignes d''une même écriture ne portent pas la même nature d''opération.'
      using errcode = '22023';
  end if;
  if v_champs = 'client_differe' then
    raise exception 'Les lignes d''une même écriture ne portent pas la même identification du client.'
      using errcode = '22023';
  end if;
  if v_champs = 'client_inconnu' then
    raise exception 'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'
      using errcode = '22023';
  end if;

  -- LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE SANS SA CONTREPARTIE (relecture de C8 et C9, le 01/11/2026 ; le défaut 1 ; un filet,
  -- que l'application dit avant le clic) : un paiement vivant de l'exercice — de genre `paiement`, non retiré, qui cite sa
  -- pièce — dont les lignes du brouillon qui le citent avec sa pièce, à sa date, au compte de la caisse du plan, dans le sens
  -- de ses espèces, ne font pas son montant. Validé, l'exercice reporterait une caisse fausse, et plus rien ne la rattraperait :
  -- la pièce s'écrirait à la date de son paiement, figée, et le paiement ne se retire plus. Le premier, par sa date.
  select o.date, o.montant into v_paiement
    from public.operations_caisse o
   where o.dossier_id = p_dossier_id and o.genre = 'paiement' and o.retire_le is null and o.piece_id is not null
     and o.date between v_debut and v_fin
     and abs(o.montant) <> coalesce((
       select sum(b.montant) from public.ecritures_brouillon b
        where b.operation_caisse_id = o.id and b.dossier_id = p_dossier_id and b.piece_id = o.piece_id and b.date = o.date
          and b.compte = public.compte_du_role(p_dossier_id, 'caisse')
          and b.sens = case when o.montant > 0 then 'debit' else 'credit' end), 0)
   order by o.date, o.id
   limit 1;
  if found then
    raise exception 'L''exercice % porte le paiement en espèces du % d''une pièce (% €) sans sa contrepartie entière au compte de la caisse : valider sa pièce et générer ses écritures, ou les régénérer, avant la validation — ou retirer ce paiement.',
      p_annee, to_char(v_paiement.date, 'DD/MM/YYYY'), replace(to_char(abs(v_paiement.montant), 'FM999999999990.00'), '.', ',')
      using errcode = '23514';
  end if;

  -- Les déclencheurs d'intangibilité ne laissent passer « validée » — et les libellés des soldes reportés — qu'à cette
  -- fonction, pour ce dossier.
  perform set_config('jd.validation_exercice', p_dossier_id::text, true);
  -- Les quatre champs du FEC d'un BNC partent avec la numérotation (lot FEC22b) : nuls quand la demande ne les porte
  -- pas.
  update public.ecritures_brouillon e
     set statut = 'validee', valide_le = v_maintenant, journal_code = l.journal, numero_ecriture = l.numero,
         piece_ref = l.piece_ref, piece_date = l.piece_date, compte_lib = l.compte_lib,
         comp_aux_num = l.comp_aux_num, comp_aux_lib = l.comp_aux_lib,
         date_reglement = l.date_reglement::date, mode_reglement = l.mode_reglement,
         nature_operation = l.nature_operation, poste_rattache = l.poste_rattache,
         identification_client = l.identification_client
    from jsonb_to_recordset(p_lignes) as l(id uuid, journal text, numero integer, piece_ref text, piece_date date,
      compte_lib text, comp_aux_num text, comp_aux_lib text, date_reglement text, mode_reglement text,
      nature_operation text, poste_rattache text, identification_client text)
   where e.id = l.id and e.dossier_id = p_dossier_id;
  update public.soldes_reportes s set compte_lib = l.compte_lib, ecriture_lib = l.ecriture_lib
    from jsonb_to_recordset(p_a_nouveaux) as l(id uuid, compte_lib text, ecriture_lib text)
   where s.id = l.id and s.dossier_id = p_dossier_id;
  perform set_config('jd.validation_exercice', '', true);
  update public.a_nouveaux a set compte_lib = l.compte_lib, ecriture_lib = l.ecriture_lib
    from jsonb_to_recordset(p_a_nouveaux) as l(id uuid, compte_lib text, ecriture_lib text)
   where a.id = l.id and a.dossier_id = p_dossier_id;

  if exists (select 1 from public.ecritures_brouillon where dossier_id = p_dossier_id and date <= v_fin and statut = 'proposee') then
    raise exception 'Une écriture de l''exercice % n''a pas été validée.', p_annee using errcode = '23514';
  end if;

  -- Les soldes de fin de l'exercice, qui ouvriront le suivant : aucun compte hors des classes 1 à 7 ne doit porter de
  -- solde — il ne se reporterait pas —, et ils s'équilibrent, à-nouveaux compris.
  select string_agg(compte, ', ' order by compte) filter (where compte !~ '^[1-5][0-9]{2,}$'),
         coalesce(sum(case when sens = 'debit' then montant else -montant end), 0)
    into v_hors, v_ecart
    from public.soldes_a_reporter(p_dossier_id, p_annee);
  if v_hors is not null then
    raise exception 'L''exercice % se clôt sur le solde de comptes qui ne sont ni de bilan ni de résultat (%) : il ne se reporte pas, corriger leurs écritures avant la validation.',
      p_annee, v_hors using errcode = '23514';
  end if;
  if v_ecart <> 0 then
    raise exception 'Les soldes de l''exercice % ne s''équilibrent pas, à-nouveaux compris : l''ouverture de l''exercice suivant ne peut pas s''écrire.',
      p_annee using errcode = '23514';
  end if;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0), coalesce(sum(montant) filter (where sens = 'credit'), 0),
         count(distinct (journal_code, numero_ecriture)), count(*)
    into v_debit, v_credit, v_ecritures, v_lignes
    from public.ecritures_brouillon
   where dossier_id = p_dossier_id and statut = 'validee' and date between v_debut and v_fin;
  select empreinte into v_precedente from public.exercices_valides
   where dossier_id = p_dossier_id and annee < p_annee order by annee desc limit 1;
  -- L'empreinte en forme 2 (INAL2, ligne 44) : celle d'hier — les écritures validées, les à-nouveaux et les soldes
  -- reportés, chaînés à l'exercice précédent — enveloppée de l'en-tête que la ligne de l'exercice garde, des fichiers des
  -- pièces que ses écritures citent et de la 2035 validée, chacun tel que la ligne l'enregistre.
  v_auteur := auth.uid();
  v_empreinte := public.empreinte_exercice_forme_2(p_dossier_id, p_annee, v_precedente, v_maintenant, v_auteur, v_mode,
    v_lignes, v_ecritures, v_debit, v_credit, case when v_mode = 'tresorerie' then p_declaration end);

  insert into public.exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures,
    total_debit, total_credit, empreinte_precedente, empreinte, declaration, forme_empreinte)
  values (p_dossier_id, p_annee, v_maintenant, v_auteur, v_mode, v_lignes, v_ecritures, v_debit, v_credit,
    v_precedente, v_empreinte, case when v_mode = 'tresorerie' then p_declaration end, 2);

  -- L'ouverture de l'exercice suivant, dans le même clic : ses soldes de fin, datés du 1er janvier suivant, chacun
  -- portant l'empreinte de l'exercice dont il vient.
  perform set_config('jd.validation_exercice', p_dossier_id::text, true);
  insert into public.soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
  select p_dossier_id, make_date(p_annee + 1, 1, 1), r.compte, r.libelle, r.sens, r.montant,
         format('Exercice %s validé', p_annee), v_empreinte
    from public.soldes_a_reporter(p_dossier_id, p_annee) r;
  get diagnostics v_reportes = row_count;
  perform set_config('jd.validation_exercice', '', true);

  return jsonb_build_object('annee', p_annee, 'lignes', v_lignes, 'ecritures', v_ecritures, 'a_nouveaux', v_an_attendus,
    'reportes', v_reportes, 'empreinte', v_empreinte, 'valide_le', v_maintenant);
end;
$$;
