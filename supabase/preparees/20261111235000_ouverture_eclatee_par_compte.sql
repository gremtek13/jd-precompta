-- L'OUVERTURE DE LA BANQUE ÉCLATÉE ENTRE LES COMPTES BANCAIRES (ligne 26.6, lot MCB5, sixième partie ; MCB-Q7, tranchée par
-- le cabinet le 11/11/2026). PRÉPARÉE le 11/11/2026, pas appliquée ; elle suit `comptes_bancaires` (MCB1). Le récit :
-- HISTORIQUE.md, « 11/11/2026 — LA JAMBE DE BANQUE PAR COMPTE BANCAIRE : LES À-NOUVEAUX DE 2026 ÉCLATÉS (MCB5, SIXIÈME
-- PARTIE) ». Son essai : supabase/essais/ouvertureEclatee.sql ; son retour :
-- supabase/preparees/retour/20261111235100_retour_ouverture_eclatee_par_compte.sql ; son module : src/lib/ouvertureEclatee.ts.
--
-- MCB-Q7 : 2025 se valide à UN seul 512 — celui du rôle `banque`, où s'écrivent alors les mouvements de tous les comptes —,
-- et 2026 s'ouvre avec un solde par compte, chaque compte autre que le principal tenant son propre 512 depuis le 1er janvier
-- qu'il porte (`compte_propre_depuis`, MCB1). L'ouverture de 2026 (les soldes reportés par la validation de 2025, ou la
-- balance reprise au 01/01/2026, dont la reprise range tout 512… au rôle) porte donc au 512 du rôle l'argent de TOUS les
-- comptes : sans rien de plus, le 512 du principal partirait trop haut et celui du second compte de zéro.
--
-- OÙ L'ÉCLATEMENT SE FAIT : PAR UNE ÉCRITURE DATÉE DU 1er JANVIER, et non dans les soldes reportés eux-mêmes.
--   - Les soldes reportés restent les soldes de clôture de l'exercice validé, compte par compte (L123-19 du code de
--     commerce : le bilan d'ouverture correspond au bilan de clôture), et rien de ce qui les écrit, les recalcule ou les
--     confronte ne change : `valider_exercice`, `soldes_a_reporter` et son jumeau, `enregistrer_a_nouveaux`, la confrontation
--     de l'ouverture au bilan qui la précède (O33).
--   - Une même écriture sert les deux ouvertures : les soldes reportés, et la balance reprise au 1er janvier.
--   - Elle s'écrit quand les relevés du 31 décembre sont là — après la validation de 2025, ou après la reprise —, et se
--     recompose tant que 2026 n'est pas validé ; la validation de 2026 la fige avec le reste.
--   Écartés : l'éclatement dans les soldes reportés à la validation de 2025 (figé d'un coup, sans retour si un relevé
--   manque ou se corrige ; la validation de 2025 dépendrait des relevés de 2026 ; la reprise demanderait un second chemin) ;
--   le journal AN (la numérotation de `valider_exercice` n'en accepte pas pour le brouillon : la question MCB5G-Q1).
--
-- CE QUE LA MIGRATION POSE :
--   1. `ecritures_brouillon.ouverture_compte_bancaire_id` : la SOURCE d'une écriture qui éclate l'ouverture — le compte
--      bancaire dont elle ouvre le 512 —, sans autre source, datée d'un 1er janvier ;
--   2. `soldes_des_comptes_au_trente_et_un` : le solde de chaque compte bancaire au 31 décembre, LU sur ses relevés
--      contrôlés par la règle de src/lib/releveAuTrenteEtUn.ts (le relevé qui finit ce jour et boucle : son solde final ;
--      sinon celui qui couvre la fin de ce jour : son solde initial s'il part du 1er janvier, sinon son solde initial et
--      ses mouvements jusqu'au 31, s'ils font encore la somme contrôlée) ; un compte clos dans l'exercice vaut zéro (MCB4-Q1),
--      un compte qui n'y est pas tenu (ouvert après) n'est pas rendu ;
--   3. `ouverture_eclatee_attendue` : l'éclatement que l'ouverture d'un exercice commande, en centimes entiers — pour chaque
--      compte dont le 512 propre commence ce 1er janvier (et, sous une reprise, avant), une paire : son solde au relevé de la
--      veille au 512 du compte, la contrepartie au 512 du rôle ; la somme des soldes de tous les comptes que l'ouverture
--      porte au rôle doit faire, au centime, l'ouverture de ce 512, sinon il se refuse et le dit ; rien à éclater (aucun
--      compte qui en sorte, un dossier à un seul compte, aucune ouverture), aucune ligne ;
--   4. `ecrire_ouverture_eclatee` (le clic) : l'accès, le verrou partagé de la validation, l'exercice encore ouvert, puis
--      l'écriture que l'application a composée VÉRIFIÉE en multiensemble contre celle que la base recompose, et écrite d'un
--      tenant à la place de la précédente (une composition vide retire) ;
--   5. `garder_ecriture_ouverture_eclatee` : une ligne qui porte cette source ne s'écrit, ne se modifie ni ne se retire que
--      par cette fonction, la restauration d'une sauvegarde exceptée (le super-administrateur, avant tout exercice validé).
--   6. L'exclusion envers les deux autres sources neuves du brouillon, préparées le 12/11/2026 — l'opération d'inventaire
--      (INV2, `operation_inventaire_id`) et le stock de clôture (LIA2, `stock_de_cloture_id`) : une contrainte PAR PAIRE, au
--      même nom et au même texte dans les trois migrations, posée par la seconde de la paire à se coller. Les trois se
--      collent ainsi dans n'importe quel ordre et laissent la même base (l'ordre des colonnes excepté). La garde de tête
--      accepte ces deux colonnes, présentes ou non, et refuse toute autre clé étrangère du brouillon qu'elle ne nomme pas.
-- Ni table, ni policy : la colonne vit sous la policy du brouillon (le cabinet) ; aucune lecture n'est ouverte au client.
-- La fonction du clic nomme la suppression des lignes qu'elle remplace : la migration se COLLE (l'outil la retient).

-- ══ 0. La garde de tête ══
do $garde$
declare
  v_sources text;
begin
  if to_regclass('public.comptes_bancaires') is null
     or to_regprocedure('public.compte_de_banque_du_mouvement(uuid)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'controles_releves_bancaires' and column_name = 'compte_bancaire_id') then
    raise exception 'La migration ouverture_eclatee_par_compte suit comptes_bancaires (MCB1) : appliquer celle-ci d''abord.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name = 'ecritures_brouillon' and column_name = 'ouverture_compte_bancaire_id') then
    raise exception 'La migration ouverture_eclatee_par_compte est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  -- Les sources du brouillon : sa contrainte « sans autre source » nomme les neuf d'hier, et les deux sources neuves des
  -- migrations sœurs (INV2, LIA2), présentes ou non, reçoivent leur exclusion au § 1. Toute autre clé étrangère du
  -- brouillon, que cette migration ne nomme pas, la refuse : la relire.
  select string_agg(a.attname, ',' order by a.attname collate "C") into v_sources
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.ecritures_brouillon'::regclass and c.contype = 'f'
     and a.attname not in ('affectation_id', 'operation_inventaire_id', 'stock_de_cloture_id');
  if v_sources is distinct from
     'cotisation_id,declaration_tva_id,dossier_id,encaissement_id,facture_id,immobilisation_id,ligne_bancaire_id,operation_caisse_id,piece_id,vehicule_id' then
    raise exception 'Les sources du brouillon ne sont plus celles que cette migration nomme (%) : sa contrainte « sans autre source » doit recevoir la nouvelle — relire la migration avant de l''appliquer.', v_sources;
  end if;
end
$garde$;

-- ══ 1. La source d'une écriture qui éclate l'ouverture ══
alter table public.ecritures_brouillon add column ouverture_compte_bancaire_id uuid
  constraint ecritures_brouillon_ouverture_compte_bancaire references public.comptes_bancaires (id);
alter table public.ecritures_brouillon add constraint ecritures_brouillon_ouverture_eclatee check (
  ouverture_compte_bancaire_id is null
  or (num_nonnulls(piece_id, ligne_bancaire_id, immobilisation_id, vehicule_id, declaration_tva_id, cotisation_id,
                   encaissement_id, facture_id, operation_caisse_id) = 0
      and extract(month from date) = 1 and extract(day from date) = 1));
create index ecritures_brouillon_ouverture_compte_bancaire_id_idx on public.ecritures_brouillon (ouverture_compte_bancaire_id);
-- L'exclusion envers une source neuve sœur déjà en base : la contrainte de la paire, au nom et au texte que l'autre
-- migration poserait si elle venait après (INV2 et LIA2 portent ce même bloc, pour leurs paires). Une ligne d'inventaire
-- peut tomber un 1er janvier (une extourne), comme celle-ci : leur paire n'a que cette contrainte pour la refuser ; celle
-- d'un stock, un 31 décembre, que les dates refusent déjà, a la sienne aussi, pour ne pas dépendre d'elles.
do $autres_sources$
begin
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'operation_inventaire_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_inventaire_hors_de_l_ouverture '
      || 'check (operation_inventaire_id is null or ouverture_compte_bancaire_id is null)';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'stock_de_cloture_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_stock_hors_de_l_ouverture '
      || 'check (stock_de_cloture_id is null or ouverture_compte_bancaire_id is null)';
  end if;
  -- AFF2 (lignes 33 et 45, `affectation_id`), préparée le 12/11/2026 : la quatrième source neuve, sa paire.
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'affectation_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_affectation_hors_de_l_ouverture '
      || 'check (affectation_id is null or ouverture_compte_bancaire_id is null)';
  end if;
end
$autres_sources$;
comment on column public.ecritures_brouillon.ouverture_compte_bancaire_id is
  'Le compte bancaire dont cette écriture ouvre le 512 propre, au 1er janvier, d''après son relevé de la veille (MCB5, MCB-Q7) ; écrite par ecrire_ouverture_eclatee seule.';

-- ══ 2. Le solde de chaque compte bancaire au 31 décembre ══
-- Les comptes tenus dans l'exercice (`tenuDansLExercice`, src/lib/releveParCompte.ts) : le principal et tout compte qui
-- s'ouvre au plus tard le 31 décembre — sans date d'ouverture, s'il y bouge ou qu'un relevé y commence —, sauf clos avant
-- l'exercice. Clos au plus tard le 31 décembre : zéro, sans relevé. Sinon, ses SEULS relevés contrôlés qui bouclent : ceux
-- qui finissent le 31 décembre ; à défaut, ceux qui couvrent la fin de ce jour. Un seul solde lu : `connu` ; plusieurs
-- différents : `plusieurs` ; aucun : `inconnu`. Montants en centimes entiers. L'ordre : le principal, puis le 512 de chaque
-- compte (un compte autre que le principal a le sien, unique dans le dossier).
create function public.soldes_des_comptes_au_trente_et_un(p_dossier_id uuid, p_annee integer)
returns table (compte_bancaire_id uuid, libelle text, principal boolean, compte text, compte_propre_depuis date,
               etat text, centimes bigint)
language sql
stable
set search_path = public
as $$
  with bornes as (
    select make_date(p_annee, 1, 1) as debut, make_date(p_annee, 12, 31) as fin, make_date(p_annee + 1, 1, 1) as lendemain
  ), comptes as (
    select c.id, c.libelle, c.principal, c.compte, c.compte_propre_depuis, c.clos_le, c.dossier_id
      from public.comptes_bancaires c cross join bornes b
     where c.dossier_id = p_dossier_id
       and (c.clos_le is null or c.clos_le >= b.debut)
       and case when c.ouvert_le is not null then c.ouvert_le <= b.fin
                else c.principal
                     or exists (select 1 from public.lignes_bancaires l where l.compte_bancaire_id = c.id and l.date <= b.fin)
                     or exists (select 1 from public.controles_releves_bancaires r
                                 where r.compte_bancaire_id = c.id and r.periode_debut <= b.fin)
           end
  ), candidats as (
    select k.id as compte_id, r.source_fichier, r.solde_initial, r.solde_final, r.somme_mouvements, r.periode_debut,
           r.periode_fin
      from comptes k cross join bornes b
      join public.controles_releves_bancaires r on r.compte_bancaire_id = k.id and r.coherent
     where (k.clos_le is null or k.clos_le > b.fin)
       and (r.periode_fin = b.fin
            or (not exists (select 1 from public.controles_releves_bancaires f
                             where f.compte_bancaire_id = k.id and f.coherent and f.periode_fin = b.fin)
                and r.periode_debut is not null and r.periode_fin is not null
                and r.periode_debut <= b.lendemain and r.periode_fin > b.fin))
  ), lus as (
    select x.compte_id,
      case
        when x.periode_fin = b.fin then round(x.solde_final * 100)::bigint
        when x.periode_debut > b.fin then round(x.solde_initial * 100)::bigint
        when x.source_fichier is null then null
        when (select coalesce(sum(round(l.montant * 100)), 0) from public.lignes_bancaires l
               where l.dossier_id = p_dossier_id and l.source_fichier = x.source_fichier) <> round(x.somme_mouvements * 100)
          then null
        else round(x.solde_initial * 100)::bigint
             + (select coalesce(sum(round(l.montant * 100)), 0) from public.lignes_bancaires l
                 where l.dossier_id = p_dossier_id and l.source_fichier = x.source_fichier and l.date <= b.fin)::bigint
      end as centimes
      from candidats x cross join bornes b
  )
  select k.id, k.libelle, k.principal, k.compte, k.compte_propre_depuis,
    case when k.clos_le is not null and k.clos_le <= b.fin then 'clos'
         when (select count(distinct u.centimes) from lus u where u.compte_id = k.id) = 1 then 'connu'
         when (select count(distinct u.centimes) from lus u where u.compte_id = k.id) > 1 then 'plusieurs'
         else 'inconnu' end,
    case when k.clos_le is not null and k.clos_le <= b.fin then 0::bigint
         when (select count(distinct u.centimes) from lus u where u.compte_id = k.id) = 1
           then (select max(u.centimes) from lus u where u.compte_id = k.id) end
    from comptes k cross join bornes b
   order by k.principal desc, k.compte collate "C", k.id
$$;
revoke all on function public.soldes_des_comptes_au_trente_et_un(uuid, integer) from public, anon, authenticated;

-- ══ 3. L'éclatement que l'ouverture d'un exercice commande ══
-- L'ouverture de la banque du rôle au 1er janvier de `p_annee` : la balance reprise ce jour-là, sinon les soldes reportés de
-- l'exercice précédent validé. Les comptes qu'elle porte au rôle (le GROUPE) : sous une reprise, tous les comptes tenus la
-- veille (la reprise range tout 512… au rôle) ; sous un report, ceux qui s'écrivaient au rôle le 31 décembre — le principal,
-- et un compte dont le 512 propre ne commence qu'à ce 1er janvier ou après. Ceux qui en SORTENT : les comptes du groupe autres
-- que le principal dont le 512 propre vaut ce 1er janvier. Sans compte qui en sorte, rien. Sinon, dans l'ordre : l'ouverture
-- attendue (l'exercice précédent n'est pas validé alors que le dossier a une activité d'avant), le solde de chaque compte du
-- groupe lu sur ses relevés, puis leur somme, qui fait au centime l'ouverture du 512 du rôle. Chaque compte qui sort, à un
-- solde non nul, donne une paire : son solde à son 512 (au débit s'il est créditeur à la banque, comme un 512), la
-- contrepartie au 512 du rôle. src/lib/ouvertureEclatee.ts redit ces refus, dans cet ordre, et compose les mêmes lignes.
create function public.ouverture_eclatee_attendue(p_dossier_id uuid, p_annee integer)
returns table (compte_bancaire_id uuid, compte text, sens text, centimes bigint, libelle text)
language plpgsql
stable
set search_path = public
as $$
declare
  v_debut date := make_date(p_annee, 1, 1);
  v_veille date := make_date(p_annee - 1, 12, 31);
  v_role text := public.compte_du_role(p_dossier_id, 'banque');
  v_reprise boolean;
  v_ouverture bigint;
  v_somme bigint := 0;
  v_non_nul boolean := false;
  v_reste boolean := false;
  v_compte record;
  v_libelle text;
begin
  -- Un exercice antérieur à la reprise est dans les comptes repris : rien ne s'y ouvre.
  if exists (select 1 from public.a_nouveaux a where a.dossier_id = p_dossier_id and a.date > v_debut) then
    return;
  end if;
  v_reprise := exists (select 1 from public.a_nouveaux a where a.dossier_id = p_dossier_id and a.date = v_debut);
  if not exists (
    select 1 from public.soldes_des_comptes_au_trente_et_un(p_dossier_id, p_annee - 1) s
     where not s.principal and s.compte_propre_depuis = v_debut
        or (v_reprise and not s.principal and s.compte_propre_depuis < v_debut)) then
    return;
  end if;
  if not v_reprise and not exists (select 1 from public.exercices_valides v
                                    where v.dossier_id = p_dossier_id and v.annee = p_annee - 1) then
    if exists (select 1 from public.a_nouveaux a where a.dossier_id = p_dossier_id and a.date < v_debut)
       or exists (select 1 from public.exercices_valides v where v.dossier_id = p_dossier_id and v.annee < p_annee)
       or exists (select 1 from public.ecritures_brouillon e where e.dossier_id = p_dossier_id and e.date < v_debut)
       or exists (select 1 from public.lignes_bancaires l where l.dossier_id = p_dossier_id and l.date < v_debut) then
      raise exception 'L''exercice % n''a pas encore d''ouverture : elle s''écrira à la validation de l''exercice %, et l''ouverture de la banque s''éclatera ensuite entre ses comptes.',
        p_annee, p_annee - 1 using errcode = '23514';
    end if;
    -- Le premier exercice du dossier, sans reprise : aucune ouverture, chaque 512 part de zéro, comme un compte seul.
    return;
  end if;
  -- Les comptes qui sortent d'abord, puis le reste du groupe : un compte qui sort à zéro (clos, ou vide la veille)
  -- n'écrit rien, et ne demande alors rien de plus.
  for v_compte in
    select s.* from public.soldes_des_comptes_au_trente_et_un(p_dossier_id, p_annee - 1) s
     where (v_reprise or s.principal or s.compte_propre_depuis >= v_debut)
     order by (not s.principal and s.compte_propre_depuis <= v_debut) desc, s.principal desc, s.compte collate "C",
              s.compte_bancaire_id
  loop
    if not v_reste and (v_compte.principal or v_compte.compte_propre_depuis > v_debut) then
      v_reste := true;
      if not v_non_nul then
        return;
      end if;
    end if;
    if v_compte.etat = 'inconnu' then
      raise exception 'Le solde au % du compte bancaire « % » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d''éclater l''ouverture de la banque.',
        to_char(v_veille, 'DD/MM/YYYY'), v_compte.libelle using errcode = '23514';
    end if;
    if v_compte.etat = 'plusieurs' then
      raise exception 'Les relevés du compte bancaire « % » disent des soldes différents au % : l''un d''eux ne dit pas le bon, et l''ouverture de la banque ne s''éclate pas.',
        v_compte.libelle, to_char(v_veille, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    v_somme := v_somme + v_compte.centimes;
    v_non_nul := v_non_nul or v_compte.centimes <> 0;
  end loop;
  if not v_non_nul then
    return;
  end if;
  select coalesce(sum(case when x.sens = 'debit' then 1 else -1 end * round(x.montant * 100)::bigint), 0) into v_ouverture
    from (select a.sens, a.montant from public.a_nouveaux a
           where a.dossier_id = p_dossier_id and a.date = v_debut and a.compte = v_role
          union all
          select s.sens, s.montant from public.soldes_reportes s
           where s.dossier_id = p_dossier_id and s.date = v_debut and s.compte = v_role) x;
  if v_somme <> v_ouverture then
    raise exception 'Les soldes des relevés au % (% €) ne font pas l''ouverture du compte % (% €) : l''ouverture de la banque ne s''éclate pas entre ses comptes.',
      to_char(v_veille, 'DD/MM/YYYY'), replace(to_char(v_somme / 100.0, 'FM999999999990.00'), '.', ','), v_role,
      replace(to_char(v_ouverture / 100.0, 'FM999999999990.00'), '.', ',') using errcode = '23514';
  end if;
  for v_compte in
    select s.* from public.soldes_des_comptes_au_trente_et_un(p_dossier_id, p_annee - 1) s
     where (v_reprise or s.compte_propre_depuis >= v_debut) and not s.principal and s.compte_propre_depuis <= v_debut
       and s.centimes <> 0
  loop
    v_libelle := format('Ouverture du %s au relevé du %s', v_compte.compte, to_char(v_veille, 'DD/MM/YYYY'));
    compte_bancaire_id := v_compte.compte_bancaire_id;
    compte := v_compte.compte;
    sens := case when v_compte.centimes > 0 then 'debit' else 'credit' end;
    centimes := abs(v_compte.centimes);
    libelle := v_libelle;
    return next;
    compte := v_role;
    sens := case when v_compte.centimes > 0 then 'credit' else 'debit' end;
    return next;
  end loop;
end
$$;
revoke all on function public.ouverture_eclatee_attendue(uuid, integer) from public, anon, authenticated;

-- ══ 4. Le clic : l'écriture qui éclate l'ouverture, vérifiée ══
create function public.ecrire_ouverture_eclatee(p_dossier_id uuid, p_annee integer, p_ecritures jsonb) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
  v_attendues jsonb;
  v_conforme boolean;
  v_nb integer;
begin
  if not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_annee is null or p_annee < 2001 or p_annee > 2100 then
    raise exception 'Exercice invalide.' using errcode = '22023';
  end if;
  -- Le verrou partagé du dossier, celui des déclencheurs : une validation en cours finit d'abord, et la frontière lue ici
  -- est celle qu'ils liront.
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and make_date(p_annee, 1, 1) <= v_frontiere then
    raise exception '% : son ouverture ne change plus.', public.exercice_fige(p_dossier_id, p_annee) using errcode = '23514';
  end if;
  if jsonb_typeof(p_ecritures) is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_ecritures) e(valeur)
                 where jsonb_typeof(e.valeur) is distinct from 'object'
                    or jsonb_typeof(e.valeur -> 'compte_bancaire_id') is distinct from 'string'
                    or jsonb_typeof(e.valeur -> 'compte') is distinct from 'string'
                    or jsonb_typeof(e.valeur -> 'sens') is distinct from 'string'
                    or jsonb_typeof(e.valeur -> 'montant') is distinct from 'number'
                    or jsonb_typeof(e.valeur -> 'libelle') is distinct from 'string') then
    raise exception 'L''éclatement proposé est incomplet.' using errcode = '22023';
  end if;
  -- L'écriture attendue, recomposée ici une fois (ses refus partent d'ici), puis comparée en MULTIENSEMBLE à la proposée :
  -- autant de lignes, chacune présente à l'égalité exacte des centimes — un montant qui n'est pas au centime n'égale aucun
  -- nombre entier de centimes.
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_attendues
    from public.ouverture_eclatee_attendue(p_dossier_id, p_annee) a;
  with attendues as (
    select a ->> 'compte_bancaire_id' as cb, a ->> 'compte' as compte, a ->> 'sens' as sens,
           (a ->> 'centimes')::numeric as centimes, a ->> 'libelle' as libelle
      from jsonb_array_elements(v_attendues) a
  ), recues as (
    select e.valeur ->> 'compte_bancaire_id' as cb, e.valeur ->> 'compte' as compte, e.valeur ->> 'sens' as sens,
           (e.valeur ->> 'montant')::numeric * 100 as centimes, e.valeur ->> 'libelle' as libelle
      from jsonb_array_elements(p_ecritures) e(valeur)
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select cb, compte, sens, centimes, libelle from attendues
                     except all select cb, compte, sens, centimes, libelle from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''éclatement proposé n''est pas celui que les relevés du % commandent : le recomposer.',
      to_char(make_date(p_annee - 1, 12, 31), 'DD/MM/YYYY') using errcode = '22023';
  end if;

  -- Le déclencheur ne laisse écrire et retirer ces lignes qu'à cette fonction, pour ce dossier.
  perform set_config('jd.ouverture_eclatee', p_dossier_id::text, true);
  delete from public.ecritures_brouillon
   where dossier_id = p_dossier_id and date = make_date(p_annee, 1, 1) and ouverture_compte_bancaire_id is not null;
  insert into public.ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, ouverture_compte_bancaire_id)
  select p_dossier_id, make_date(p_annee, 1, 1), a ->> 'compte', a ->> 'libelle', round((a ->> 'centimes')::numeric / 100, 2),
         a ->> 'sens', 'proposee', (a ->> 'compte_bancaire_id')::uuid
    from jsonb_array_elements(v_attendues) a;
  get diagnostics v_nb = row_count;
  perform set_config('jd.ouverture_eclatee', '', true);
  return v_nb;
end
$$;
revoke all on function public.ecrire_ouverture_eclatee(uuid, integer, jsonb) from public, anon;
grant execute on function public.ecrire_ouverture_eclatee(uuid, integer, jsonb) to authenticated;
comment on function public.ecrire_ouverture_eclatee(uuid, integer, jsonb) is
  'Écrit, à la place de la précédente, l''écriture qui éclate l''ouverture de la banque entre les 512 des comptes bancaires au 1er janvier d''un exercice, d''après leurs relevés de la veille (MCB5, MCB-Q7), vérifiée contre ouverture_eclatee_attendue. Une composition vide retire. Cabinet du dossier.';

-- ══ 5. La garde ══
create function public.garder_ecriture_ouverture_eclatee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.ouverture_compte_bancaire_id is null
       or not exists (select 1 from public.dossiers where id = old.dossier_id)
       or coalesce(current_setting('jd.ouverture_eclatee', true), '') = old.dossier_id::text then
      return old;
    end if;
    raise exception 'L''écriture qui éclate l''ouverture de la banque ne se retire que par sa recomposition.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (old.ouverture_compte_bancaire_id is not null or new.ouverture_compte_bancaire_id is not null) then
    raise exception 'L''écriture qui éclate l''ouverture de la banque ne se modifie pas : elle se recompose.' using errcode = '42501';
  end if;
  if new.ouverture_compte_bancaire_id is null then
    return new;
  end if;
  if coalesce(current_setting('jd.ouverture_eclatee', true), '') is distinct from new.dossier_id::text
     and not (public.is_super_admin()
              and not exists (select 1 from public.exercices_valides v where v.dossier_id = new.dossier_id)) then
    raise exception 'L''écriture qui éclate l''ouverture de la banque ne s''écrit que par sa fonction.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.comptes_bancaires c
                  where c.id = new.ouverture_compte_bancaire_id and c.dossier_id = new.dossier_id) then
    raise exception 'Le compte bancaire d''une écriture qui éclate l''ouverture est un compte de son dossier.' using errcode = '23503';
  end if;
  return new;
end
$$;
revoke all on function public.garder_ecriture_ouverture_eclatee() from public, anon, authenticated;
create trigger ecritures_brouillon_ouverture_eclatee
  before insert or delete or update of ouverture_compte_bancaire_id, dossier_id, date, compte, sens, montant, libelle
  on public.ecritures_brouillon
  for each row execute function public.garder_ecriture_ouverture_eclatee();

-- ══ 6. La garde de fin ══
do $fin$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ecritures_brouillon'::regclass
                  and conname = 'ecritures_brouillon_ouverture_eclatee' and convalidated)
     or not exists (select 1 from pg_proc where oid = 'public.ecrire_ouverture_eclatee(uuid, integer, jsonb)'::regprocedure
                     and prosecdef and proconfig @> array['search_path=public'])
     or has_function_privilege('anon', 'public.ecrire_ouverture_eclatee(uuid, integer, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.ouverture_eclatee_attendue(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.soldes_des_comptes_au_trente_et_un(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.garder_ecriture_ouverture_eclatee()', 'execute') then
    raise exception 'Garde de fin : la colonne, la contrainte ou les droits des fonctions ne sont pas ceux que la migration pose.';
  end if;
end
$fin$;
