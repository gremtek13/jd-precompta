-- LA CAISSE : LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE, EN BASE — ET LA CAISSE BORNÉE PAR SON OUVERTURE (ligne 26.6, étape
-- C8 ; MVP-D2 ; CAISSE-Q4, (B)). La conception : HISTORIQUE.md, « LA CAISSE : LA SAISIE DU PRATICIEN ET LA PIÈCE RÉGLÉE
-- PAR LA CAISSE — LA CONCEPTION REPRISE (CAISSE-Q1 ET Q4) », § 8 (la pièce réglée par la caisse), § 9, n° 4 (cette
-- migration) et § 10 (le lot C8) ; la correction de l'ouverture, « LA CAISSE : LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE, EN
-- BASE (C8, LIGNE 26.6) » — la relecture du 31/10/2026 : un retrait au distributeur d'avant l'ouverture, classé sur la
-- caisse, s'y comptait une seconde fois après le 53 des à-nouveaux qui le porte déjà. Préparée sous une version
-- PROVISOIRE, après les trois migrations de la caisse (`caisse`, `caisse_retrait_et_versement`, `especes_sans_mouvement`,
-- en base depuis le 30/10/2026), qu'elle suppose et dont elle remplace quatre corps.
--
-- CE QU'ELLE POSE.
--   1. `regler_piece_par_la_caisse(dossier, pièce, date, montant)` : le paiement d'une pièce par la caisse, une opération
--      de genre `paiement` qui cite sa pièce, à SA date (le jour où les espèces sont sorties, ou entrées pour une pièce de
--      vente), d'un montant signé comme le relevé — négatif pour une sortie. Elle n'écrit AUCUNE ligne du brouillon : la
--      contrepartie s'écrit avec les écritures de la pièce, par l'application, comme celle d'un paiement par la banque
--      (la conception, § 8 : un client n'écrit pas au brouillon, la pièce peut n'être ni validée ni écrite, et deux
--      chemins vers la contrepartie d'une pièce divergeraient). L'accès par `qui_ecrit_la_caisse`, avant toute lecture :
--      la migration du droit du client n'en remplacera que le corps (CAISSE2-Q4, (A)).
--   2. `garder_ecriture_de_caisse` REMPLACÉE : la contrepartie d'un paiement par la caisse — une ligne qui cite le
--      paiement ET sa pièce — s'écrit sous la RLS du brouillon, hors de toute fonction, si elle suit son paiement (son
--      dossier, sa date, sa pièce, un paiement non retiré), porte le compte de la caisse du PLAN et le sens des espèces
--      (au débit quand elles entrent, au crédit quand elles sortent), et ne dépasse pas, avec les autres lignes du même
--      paiement, son montant ; elle se retire avec les écritures de sa pièce (« Régénérer » les reprend toutes). Le
--      reste, au caractère près.
--   3. `garder_piece_payee_par_la_caisse`, sur `pieces` : une pièce qu'un paiement de la caisse cite ne change pas de
--      dossier, que le paiement soit retiré ou non (la piste d'audit) ; tant qu'il ne l'est pas, elle reste une pièce
--      d'achat ou de vente, et ne devient pas l'exemplaire d'une facture SOURCE (sa vente vient de la facture). Sa
--      suppression, la clé de la migration `caisse` la refuse déjà (`on delete restrict`).
--   4. `enregistrer_operation_caisse` REMPLACÉE : l'ensemble qu'une recette reconnaît pour son jour (CAISSE-Q2, (A))
--      s'étend aux paiements par la caisse de pièces de vente de ce jour — le paiement compte sa vente, le total du jour
--      ne la compte pas une seconde fois. Le reste, au caractère près.
--   5. LA CAISSE BORNÉE PAR SON OUVERTURE. `premier_jour_negatif_de_la_caisse` REMPLACÉE : ce qui précède l'ouverture du
--      compte de la caisse (la date de ses à-nouveaux) est dans les comptes repris — le 53 repris le porte déjà — et ne se
--      compte plus. `garder_caisse_depuis_l_ouverture`, sur `lignes_bancaires` : un mouvement daté d'avant l'ouverture du
--      dossier ne se classe plus sur la caisse ; déjà classé, il se retire comme hier. `garder_la_caisse` REMPLACÉE : une
--      ouverture du compte de la caisse se juge toujours — elle borne aussi ce que la caisse compte, et la poser en
--      retire. Le reste, au caractère près.
--
-- LES REFUS, DANS L'ORDRE (que src/lib/paiementParLaCaisse.ts redit avant le clic, sous les mêmes mots ; l'ensemble du
-- jour et la caisse bornée, src/lib/caisse.ts) :
--   - le paiement — 1. l'accès, avant toute lecture (`qui_ecrit_la_caisse` : 42501) ; 2. le dossier en trésorerie
--     (22023) ; 3. la pièce, de ce dossier (P0002) ; 4. son type : une note de frais, puis une pièce qui n'est ni d'achat
--     ni de vente (22023) ; 5. l'exemplaire d'une facture source (22023) ; 6. la date, comme celle d'une opération :
--     renseignée, pas avant 2000, pas dans l'avenir à Paris, pas avant l'ouverture d'un dossier repris (22023), pas dans
--     un exercice figé (23514) ; 7. le montant, comme celui d'une opération : renseigné, au centime, non nul, borné
--     (22023) ; 8. le sens : une sortie pour une pièce d'achat, une entrée pour une pièce de vente, l'inverse pour un
--     avoir (22023) ; 9. pour une pièce validée, ses paiements par la caisse non retirés ne dépassent pas son montant
--     (22023 — sans le dire : un client ne lit pas le montant d'une pièce) ; 10. la caisse jamais négative, quand le
--     paiement fait sortir des espèces (23514, `texte_caisse_negative`, le geste `paiement`) ;
--   - la contrepartie — elle suit son paiement ; le compte de la caisse du plan ; le sens des espèces ; pas plus que le
--     paiement (23514 chacun) ;
--   - la pièce payée — le dossier ; le type ; l'exemplaire d'une facture source (23514 chacun) ;
--   - la recette — parmi ceux d'hier sur l'ensemble du jour : un paiement en espèces d'une pièce de vente de ce jour qui
--     manque, juste après l'encaissement qui manque ; un paiement que la lecture comptait et qui n'est pas un paiement de
--     pièce de vente de ce jour, juste après l'encaissement en trop (22023 chacun) ;
--   - le mouvement classé sur la caisse — daté d'avant l'ouverture du dossier (23514), après tous les refus
--     d'`ecrire_mouvement_compte_bilan`, inchangée : la garde juge la ligne qu'elle écrit.
--
-- POURQUOI BORNER LA CAISSE, ET POURQUOI À L'OUVERTURE DE SON COMPTE. Refuser le classement d'un mouvement d'avant
-- l'ouverture ferme la porte d'aujourd'hui ; il reste ce qui est déjà là (un mouvement classé avant cette migration, une
-- restauration) et ce qui le deviendra (une reprise posée après coup, quand des opérations existent déjà) : borner le
-- compte les couvre. La borne est la date des à-nouveaux du COMPTE DE LA CAISSE, non celle du dossier : seule une
-- ouverture sous la racine 53 met en file les déclencheurs de la caisse (leur condition, migration `caisse`) — une
-- reprise posée ou retirée sans ligne de caisse changerait la caisse sans que rien ne la juge. Ce qui reste : un dossier
-- repris sans ligne de caisse (une caisse nulle au jour de la reprise) compte encore un flux d'avant elle ; le
-- classement d'un mouvement en est refusé, et l'onglet Caisse le dira (lot C9).
--
-- CE QU'ELLE TOUCHE D'EXISTANT : les corps de quatre fonctions de la caisse, relus en production le 31/10/2026 à leur
-- empreinte, que la garde de tête vérifie — leur signature, leur sécurité, leurs droits et leurs déclencheurs restent
-- (`create or replace`) ; deux déclencheurs neufs, l'un sur `pieces`, qui ne juge qu'une pièce dont le dossier, le type
-- ou la désignation change, l'autre sur `lignes_bancaires`, qui ne juge qu'un mouvement qui arrive sur un compte 53.
-- Aucune table, colonne, contrainte ni policy ; aucune donnée lue ni écrite d'avance. NEUTRE EN PRODUCTION si les
-- comptes du jour de l'application le redisent : aucune caisse ne change, aucun geste d'hier ne se refuse. Relevés le
-- 31/10/2026 : aucune opération de caisse, aucune ligne du brouillon qui en cite une, aucun exercice validé, aucun
-- dossier basculé ; le 29/10/2026, avant que la caisse n'ouvre à l'écran : aucun mouvement classé sur un compte de
-- bilan, aucun à-nouveau sur un compte 53. Un mouvement d'avant l'ouverture classé depuis sur la caisse en sortirait,
-- et ne s'y reclasserait plus.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : ni objet ni donnée. Ses `revoke` ne
-- retirent que les droits que Postgres donne d'office aux trois fonctions qu'elle crée — le patron de la migration
-- `caisse`, que l'outil a passée le 30/10/2026 sans demander de confirmation. Le mot de la suppression n'y paraît que
-- dans `tg_op = 'DELETE'` et les événements d'un déclencheur, comme dans les gardes d'hier. Aucune barre oblique
-- inverse. Elle s'applique PAR L'OUTIL. Son retour arrière, donné à part (`supabase/preparees/retour/`), rend les quatre
-- corps d'hier et retire la fonction, les deux gardes et leurs déclencheurs : un retrait d'objets, à accorder par le
-- cabinet ; il se refuse dès qu'un paiement par la caisse existe — avant le premier, rien ne se perd.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; le drapeau `PAIEMENT_PAR_LA_CAISSE_EXPORTE`
-- (src/lib/paiementParLaCaisse.ts) se lève avec lui, et l'écran du cabinet (C9) le suit.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une base sans les trois migrations de la caisse — sa table, ses fonctions à
-- l'empreinte de leur corps, les retours chariot d'un collage écartés, relues en production le 31/10/2026 — ; une
-- fonction que celle-ci appelle, ou dont elle suppose les refus, qui ne serait plus celle qu'elle suppose ; et une base où
-- manquerait ce qu'elle lit : le rôle `caisse` du plan, de racine 53 ; les onze déclencheurs qui appellent les deux gardes
-- remplacées ; le genre `paiement` et la pièce de la table, que la migration `caisse` a posés ; les colonnes qu'elle lit.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('regler_piece_par_la_caisse', 'garder_piece_payee_par_la_caisse', 'garder_caisse_depuis_l_ouverture'))
     or exists (select 1 from pg_trigger t where not t.tgisinternal
                 and t.tgname in ('pieces_payees_par_la_caisse', 'lignes_bancaires_sur_la_caisse_depuis_l_ouverture')) then
    raise exception 'La migration paiement_par_la_caisse est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.operations_caisse') is null then
    raise exception 'La migration caisse n''est pas en base : appliquer d''abord les trois migrations de la caisse, puis celle-ci.';
  end if;
  for v_attendue in select * from (values
      ('premier_jour_negatif_de_la_caisse', 'public.premier_jour_negatif_de_la_caisse(uuid)', 'fab45f7271d8f7c9104d0082039221cb'),
      ('garder_la_caisse', 'public.garder_la_caisse()', '270ae2ea2787a016e9ecc532a264ecbc'),
      ('garder_ecriture_de_caisse', 'public.garder_ecriture_de_caisse()', 'f936e2bde429a4700d6cfd71d9c6e4d3'),
      ('enregistrer_operation_caisse', 'public.enregistrer_operation_caisse(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb)', '6d474ccc8f4aefa3bac04c71ef1914fd'),
      ('qui_ecrit_la_caisse', 'public.qui_ecrit_la_caisse(uuid)', 'd4faab33c7c0cdb268621bd0e881d62c'),
      ('texte_caisse_negative', 'public.texte_caisse_negative(text, numeric, date, numeric)', 'aa7e7a933ac8ce8afe78209dd32607ab'),
      ('garder_operation_caisse', 'public.garder_operation_caisse()', '3bc037a8e7ae542ef880870256e05dd1'),
      ('retirer_operation_caisse', 'public.retirer_operation_caisse(uuid, uuid)', '459ca42980e05044cb30d5d464223775'),
      ('remplacer_operation_caisse', 'public.remplacer_operation_caisse(uuid, uuid, text, date, numeric, uuid, numeric, uuid[], jsonb)', 'b511e1b25aa19b92ba29722d5124da73'),
      ('enregistrer_operations_de_caisse', 'public.enregistrer_operations_de_caisse(uuid, jsonb)', 'f79a5b97da8df6b75af9d59201b76d25'),
      ('ecrire_mouvement_compte_bilan', 'public.ecrire_mouvement_compte_bilan(uuid, text, jsonb)', '0308294f8da1fa4ef48373992dcb628d'),
      ('retirer_mouvement_compte_bilan', 'public.retirer_mouvement_compte_bilan(uuid)', 'd384ac3f8245dc20eda2921a41f1b353'),
      ('cle_validation', 'public.cle_validation(uuid)', 'bcbb03363036aa6aa037c0b829e3382f'),
      ('frontiere_validation', 'public.frontiere_validation(uuid)', '24a04846471ec5e8cdbae6f3b9f4a2e8'),
      ('exercice_fige', 'public.exercice_fige(uuid, integer)', 'b70cbdd4a870f5e17e8e4c6851506bdc'),
      ('compte_du_role', 'public.compte_du_role(uuid, text)', '6108ab75d148aa2800484b89bb112c70'),
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p
     where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.nom, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  if not exists (select 1 from public.roles_comptables r where r.role = 'caisse' and r.racines = array['53']) then
    raise exception 'Le plan comptable des rôles n''a pas le rôle « caisse » de racine 53 : la caisse n''a pas de compte.';
  end if;
  select count(*) into v_nombre from pg_trigger t
   where not t.tgisinternal
     and t.tgfoid in (to_regprocedure('public.garder_ecriture_de_caisse()'), to_regprocedure('public.garder_la_caisse()'));
  if v_nombre <> 11 then
    raise exception 'Les déclencheurs de la caisse ne sont pas ceux que cette migration suppose (% sur 11).', v_nombre;
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.operations_caisse'::regclass
                  and c.conname = 'operations_caisse_genre' and pg_get_constraintdef(c.oid) like '%''paiement''%')
     or not exists (select 1 from pg_constraint c where c.conrelid = 'public.operations_caisse'::regclass
                     and c.conname = 'operations_caisse_piece')
     or not exists (select 1 from pg_constraint c where c.conrelid = 'public.ecritures_brouillon'::regclass
                     and c.conname = 'ecritures_brouillon_caisse_sans_autre_source'
                     and pg_get_constraintdef(c.oid) not like '%piece_id%') then
    raise exception 'La table de la caisse n''a pas le genre « paiement », sa pièce, ou la contrainte du brouillon qui admet la pièce d''une contrepartie : cette base n''est pas celle que la migration suppose.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped and (a.attrelid, a.attname) in (
     ('public.operations_caisse'::regclass, 'genre'), ('public.operations_caisse'::regclass, 'piece_id'),
     ('public.operations_caisse'::regclass, 'retire_le'), ('public.operations_caisse'::regclass, 'montant'),
     ('public.operations_caisse'::regclass, 'date'), ('public.operations_caisse'::regclass, 'origine'),
     ('public.pieces'::regclass, 'type_piece'), ('public.pieces'::regclass, 'statut'),
     ('public.pieces'::regclass, 'montant_ttc'), ('public.pieces'::regclass, 'facture_id'),
     ('public.factures_emises'::regclass, 'source_de_la_vente'), ('public.factures_emises'::regclass, 'numero'),
     ('public.ecritures_brouillon'::regclass, 'operation_caisse_id'), ('public.ecritures_brouillon'::regclass, 'created_at'),
     ('public.lignes_bancaires'::regclass, 'compte_bilan'), ('public.lignes_bancaires'::regclass, 'created_at'),
     ('public.a_nouveaux'::regclass, 'compte'), ('public.dossiers'::regclass, 'mode_comptable'));
  if v_nombre <> 18 then
    raise exception 'Une colonne que cette migration lit manque (% sur 18) : cette base n''est pas celle que la migration suppose.', v_nombre;
  end if;
end
$garde$;

-- ══ 1. La caisse lue, bornée par son ouverture ══════════
-- Le corps de la migration `caisse`, au caractère près, plus la borne : le premier jour que la caisse compte est celui
-- des à-nouveaux de son compte, s'il en a. Ce qui le précède — une opération saisie avant que la reprise ne soit posée,
-- un mouvement classé sur la caisse, les espèces d'une facture — est dans les comptes repris : le 53 de la balance le
-- porte déjà. Sans à-nouveau sur ce compte, rien ne la borne (ce qui reste, l'en-tête le dit).
create or replace function public.premier_jour_negatif_de_la_caisse(p_dossier_id uuid)
returns table (jour date, solde numeric)
language sql
stable
security definer
set search_path = public
as $$
  with caisse as (
    select public.compte_du_role(p_dossier_id, 'caisse') as compte
  ), ouverture as (
    -- L'ouverture du compte de la caisse : le premier jour que la caisse compte (la migration `paiement_par_la_caisse`).
    -- Ce qui la précède est dans les comptes repris ; sans à-nouveau sur ce compte, rien ne la borne.
    select min(a.date) as premier_jour
      from public.a_nouveaux a, caisse c
     where a.dossier_id = p_dossier_id and a.compte = c.compte
  ), flux (le_jour, le_montant) as (
    -- L'ouverture : les à-nouveaux du compte de la caisse.
    select a.date, case when a.sens = 'debit' then a.montant else -a.montant end
      from public.a_nouveaux a, caisse c
     where a.dossier_id = p_dossier_id and a.compte = c.compte
    union all
    -- Les opérations non retirées.
    select o.date, case when o.genre = 'prelevement' then -o.montant else o.montant end
      from public.operations_caisse o
     where o.dossier_id = p_dossier_id and o.retire_le is null
    union all
    -- Les mouvements du relevé classés sur le compte de la caisse.
    select l.date, -l.montant
      from public.lignes_bancaires l, caisse c
     where l.dossier_id = p_dossier_id and l.compte_bilan = c.compte
    union all
    -- Les espèces des factures sources : un encaissement en espèces sans mouvement, ou la contre-passation sans
    -- mouvement d'un tel encaissement.
    select e.date_encaissement, e.montant
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
      left join public.encaissements_factures o on o.id = e.annule_id
     where e.dossier_id = p_dossier_id and f.source_de_la_vente and e.retire_le is null and e.ligne_bancaire_id is null
       and case when e.annule_id is null then e.moyen = 'especes'
                else o.ligne_bancaire_id is null and o.moyen = 'especes' end
  ), soldes as (
    select x.le_jour, sum(sum(x.le_montant)) over (order by x.le_jour) as le_solde
      from flux x, ouverture o
     where o.premier_jour is null or x.le_jour >= o.premier_jour
     group by x.le_jour
  )
  select s.le_jour, s.le_solde from soldes s where s.le_solde < 0 order by s.le_jour limit 1
$$;

-- ══ 2. La caisse jamais négative : une ouverture se juge toujours ══════════
-- Le corps de la migration `caisse`, au caractère près, plus ceci : un à-nouveau du compte de la caisse ne passe plus par
-- le raccourci de « ce qui ne fait qu'ajouter », et une ouverture qui change de dossier juge les deux dès qu'elle y
-- comptait — la poser, l'avancer ou la retirer déplace la borne de ce que la caisse compte.
create or replace function public.garder_la_caisse() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dossier uuid;
  v_dossiers uuid[];
  v_avant numeric := 0;
  v_apres numeric := 0;
  v_jour_avant date;
  v_jour_apres date;
  v_cree timestamp with time zone;
  v_geste text;
  v_montant numeric;
  v_jour date;
  v_solde numeric;
begin
  v_dossier := case when tg_op = 'DELETE' then old.dossier_id else new.dossier_id end;

  if tg_table_name = 'operations_caisse' then
    if tg_op <> 'INSERT' and old.retire_le is null then
      v_avant := case when old.genre = 'prelevement' then -old.montant else old.montant end;
      v_jour_avant := old.date;
    end if;
    if tg_op <> 'DELETE' then
      if new.retire_le is null then
        v_apres := case when new.genre = 'prelevement' then -new.montant else new.montant end;
      end if;
      v_jour_apres := new.date;
      v_cree := new.cree_le;
    end if;
  elsif tg_table_name = 'lignes_bancaires' then
    if (tg_op = 'INSERT' or old.compte_bilan is null) and (tg_op = 'DELETE' or new.compte_bilan is null) then
      return null;
    end if;
    if tg_op <> 'INSERT' and old.compte_bilan = public.compte_du_role(old.dossier_id, 'caisse') then
      v_avant := -old.montant;
      v_jour_avant := old.date;
    end if;
    if tg_op <> 'DELETE' then
      if new.compte_bilan = public.compte_du_role(new.dossier_id, 'caisse') then
        v_apres := -new.montant;
      end if;
      v_jour_apres := new.date;
      v_cree := new.created_at;
    end if;
  elsif tg_table_name = 'encaissements_factures' then
    if tg_op <> 'INSERT' and old.retire_le is null and old.ligne_bancaire_id is null
       and exists (select 1 from public.factures_emises f where f.id = old.facture_id and f.source_de_la_vente)
       and (old.annule_id is null and old.moyen = 'especes'
            or old.annule_id is not null and exists (select 1 from public.encaissements_factures o
                                                      where o.id = old.annule_id and o.ligne_bancaire_id is null
                                                        and o.moyen = 'especes')) then
      v_avant := old.montant;
      v_jour_avant := old.date_encaissement;
    end if;
    if tg_op <> 'DELETE' then
      if new.retire_le is null and new.ligne_bancaire_id is null
         and exists (select 1 from public.factures_emises f where f.id = new.facture_id and f.source_de_la_vente)
         and (new.annule_id is null and new.moyen = 'especes'
              or new.annule_id is not null and exists (select 1 from public.encaissements_factures o
                                                        where o.id = new.annule_id and o.ligne_bancaire_id is null
                                                          and o.moyen = 'especes')) then
        v_apres := new.montant;
      end if;
      v_jour_apres := new.date_encaissement;
      v_cree := new.cree_le;
    end if;
  elsif tg_table_name = 'a_nouveaux' then
    if tg_op <> 'INSERT' and old.compte = public.compte_du_role(old.dossier_id, 'caisse') then
      v_avant := case when old.sens = 'debit' then old.montant else -old.montant end;
      v_jour_avant := old.date;
    end if;
    if tg_op <> 'DELETE' then
      if new.compte = public.compte_du_role(new.dossier_id, 'caisse') then
        v_apres := case when new.sens = 'debit' then new.montant else -new.montant end;
      end if;
      v_jour_apres := new.date;
      v_cree := new.created_at;
    end if;
  else
    raise exception 'garder_la_caisse ne veille pas sur la table %.', tg_table_name;
  end if;

  -- Rien de la caisse, ni avant ni après.
  if v_avant = 0 and v_apres = 0 then
    return null;
  end if;
  -- La porte de la restauration.
  if tg_op = 'INSERT' and v_cree < now() and public.is_super_admin()
     and not exists (select 1 from public.exercices_valides v where v.dossier_id = v_dossier) then
    return null;
  end if;
  -- Les caisses à juger. Une ligne qui reste dans son dossier : la sienne, sauf si le changement ne peut, à aucun jour,
  -- que garder ou grossir la caisse — au jour t, le solde d'après est celui d'avant, moins l'ancien apport s'il
  -- comptait déjà, plus le nouveau s'il compte déjà. Une ligne qui passe d'un dossier à un autre : celui qu'elle quitte
  -- s'il perd des espèces, celui qu'elle rejoint s'il en perd. Un dossier qui n'est plus (sa cascade) ne se juge pas.
  if tg_op = 'UPDATE' and old.dossier_id is distinct from new.dossier_id then
    -- Une ouverture de la caisse borne aussi ce que son dossier compte (la migration `paiement_par_la_caisse`) : celui
    -- qu'elle quitte et celui qu'elle rejoint se jugent dès qu'elle y comptait.
    v_dossiers := array(select x from unnest(array[case when v_avant > 0 or tg_table_name = 'a_nouveaux' and v_avant <> 0
                                                        then old.dossier_id end,
                                                   case when v_apres < 0 or tg_table_name = 'a_nouveaux' and v_apres <> 0
                                                        then new.dossier_id end]) x
                         where x is not null order by x);
  else
    if tg_op = 'INSERT' then
      v_jour_avant := v_jour_apres;
    elsif tg_op = 'DELETE' then
      v_jour_apres := v_jour_avant;
    end if;
    v_jour_avant := coalesce(v_jour_avant, v_jour_apres);
    v_jour_apres := coalesce(v_jour_apres, v_jour_avant);
    -- Une ouverture de la caisse se juge toujours (la migration `paiement_par_la_caisse`) : la poser, l'avancer ou la
    -- retirer déplace la borne de ce que la caisse compte, et ce qui la précède en sort.
    if tg_table_name <> 'a_nouveaux'
       and v_apres >= v_avant
       and (v_jour_apres >= v_jour_avant or v_apres >= 0)
       and (v_jour_avant >= v_jour_apres or v_avant <= 0) then
      return null;
    end if;
    v_dossiers := array[v_dossier];
  end if;

  -- Le geste, pour ses mots.
  if tg_table_name = 'operations_caisse' then
    if tg_op = 'INSERT' then
      v_geste := case when new.genre = 'prelevement' then 'prelevement'
                      when new.genre = 'recette' then 'especes_rendues'
                      when new.genre = 'paiement' then 'paiement' end;
      v_montant := new.montant;
    elsif tg_op = 'UPDATE' and new.retire_le is not null then
      v_geste := case when old.genre = 'recette' then 'retrait_recette' when old.genre = 'apport' then 'retrait_apport'
                      when old.genre = 'paiement' then 'retrait_paiement' end;
      v_montant := old.montant;
    end if;
  elsif tg_table_name = 'lignes_bancaires' then
    if v_apres < 0 then
      v_geste := 'versement';
      v_montant := v_apres;
    elsif v_avant > 0 and v_apres = 0 then
      v_geste := 'retrait_d_especes_retire';
      v_montant := v_avant;
    else
      -- Un retrait pour la caisse qui reste sur elle : plus petit, plus tard, ou dans un autre dossier.
      v_geste := 'mouvement_change';
      v_montant := v_apres;
    end if;
  elsif tg_table_name = 'encaissements_factures' then
    if tg_op = 'INSERT' and v_apres < 0 then
      v_geste := 'contre_passation';
      v_montant := v_apres;
    elsif tg_op = 'UPDATE' and v_avant > 0 and new.retire_le is not null and old.retire_le is null then
      v_geste := 'retrait_encaissement';
      v_montant := v_avant;
    elsif tg_op = 'UPDATE' and v_avant > 0 and new.ligne_bancaire_id is not null and old.ligne_bancaire_id is null then
      v_geste := 'rattachement_encaissement';
      v_montant := v_avant;
    end if;
  elsif tg_table_name = 'a_nouveaux' then
    if v_apres < 0 then
      v_geste := 'ouverture_au_credit';
      v_montant := v_apres;
    elsif v_avant > 0 and v_apres = 0 then
      v_geste := 'retrait_ouverture';
      v_montant := v_avant;
    else
      -- Une ouverture au débit qui reste au débit : plus petite, plus tard, ou dans un autre dossier.
      v_geste := 'ouverture_change';
      v_montant := v_apres;
    end if;
  end if;

  -- Le verrou de la caisse, puis la caisse rejouée : sous lui, une autre session qui la vide a fini, et se voit. Deux
  -- caisses se verrouillent dans l'ordre de leurs identifiants.
  foreach v_dossier in array v_dossiers loop
    if exists (select 1 from public.dossiers d where d.id = v_dossier) then
      perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || v_dossier::text, 0));
      select n.jour, n.solde into v_jour, v_solde from public.premier_jour_negatif_de_la_caisse(v_dossier) n;
      if v_jour is not null then
        raise exception '%', public.texte_caisse_negative(coalesce(v_geste, 'autre'), coalesce(v_montant, 0), v_jour, v_solde)
          using errcode = '23514';
      end if;
    end if;
  end loop;
  return null;
end
$$;

-- ══ 3. Un mouvement d'avant l'ouverture ne se classe pas sur la caisse ══════════
-- Une garde de la LIGNE, non de la fonction qui l'écrit : `ecrire_mouvement_compte_bilan` reste celle d'hier (la changer
-- demanderait un collage), et ses refus passent tous avant celui-ci, qui juge ce qu'elle écrit — comme toute autre
-- écriture du compte de bilan d'un mouvement, la restauration exceptée (une ligne RÉINSÉRÉE par le
-- super-administrateur dans un dossier sans exercice validé, son instant de création d'avant la transaction : la porte
-- de `garder_la_caisse`). Ne se juge qu'un mouvement qui ARRIVE sur le compte de la caisse du plan — classé, déplacé à
-- une autre date ou dans un autre dossier — : celui qui y est déjà se retire, change de statut ou de libellé comme hier.
-- La borne est l'ouverture du DOSSIER, celle qui refuse déjà une opération (`enregistrer_operation_caisse`), que la
-- reprise porte une ligne de caisse ou non : un mouvement d'avant elle est dans les comptes repris, la banque comme la
-- caisse.
create function public.garder_caisse_depuis_l_ouverture() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ouverture date;
begin
  -- Seul le compte de la caisse du plan compte : un autre compte 53, `refus_compte_de_bilan` le refuse déjà.
  if new.compte_bilan is distinct from public.compte_du_role(new.dossier_id, 'caisse') then
    return new;
  end if;
  -- Un mouvement qui RESTE sur la caisse, à son jour et dans son dossier : rien n'y arrive.
  if tg_op = 'UPDATE' and old.compte_bilan is not distinct from new.compte_bilan and old.date = new.date
     and old.dossier_id = new.dossier_id then
    return new;
  end if;
  -- La porte de la restauration, celle de `garder_la_caisse`.
  if tg_op = 'INSERT' and new.created_at < now() and public.is_super_admin()
     and not exists (select 1 from public.exercices_valides v where v.dossier_id = new.dossier_id) then
    return new;
  end if;
  select min(a.date) into v_ouverture from public.a_nouveaux a where a.dossier_id = new.dossier_id;
  if v_ouverture is not null and new.date < v_ouverture then
    raise exception 'Ce mouvement précède l''ouverture du dossier, le % : il est déjà dans les comptes repris, et ne se classe pas sur la caisse.',
      to_char(v_ouverture, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  return new;
end
$$;

-- Le dernier des déclencheurs de la ligne, par son nom : le gel de la validation et la réserve des encaissements disent
-- d'abord ce qu'ils refusent. Sa condition ne met en route la garde que pour une ligne qui arrive sous la racine 53.
create trigger lignes_bancaires_sur_la_caisse_depuis_l_ouverture
  before insert or update of compte_bilan, date, dossier_id on public.lignes_bancaires
  for each row when (left(new.compte_bilan, 2) = '53')
  execute function public.garder_caisse_depuis_l_ouverture();

-- ══ 4. Régler une pièce par la caisse ══════════
-- Le patron d'`enregistrer_operation_caisse` : l'accès annoncé avant toute lecture, puis les refus dans l'ordre que le
-- module redira sous les mêmes mots (l'en-tête). La pièce se lit dans CE dossier, verrouillée : son type, sa désignation
-- et son montant ne changent pas sous le paiement (la garde de la pièce, § 6, juge ce qui viendrait ensuite). Le sens se
-- juge comme celui d'un mouvement du relevé rapproché d'une pièce (src/lib/appariementBanque.ts, `sensCoherent`) : une
-- entrée d'espèces pour une vente, une sortie pour un achat, l'inverse pour un avoir — une pièce de montant négatif. Le
-- plafond ne se juge que sur une pièce validée, dont le montant est relu : celui d'une pièce à valider est encore une
-- lecture de l'OCR ; il ne compte que les paiements par la caisse — ceux de la banque, le pointage des pièces payées en
-- trop les voit (lot C9). Ni ses mots ni son code ne disent le montant de la pièce.
--
-- L'EXEMPLAIRE D'UNE FACTURE SOURCE, ET LUI SEUL, SE REFUSE (le § 8 de la conception disait « l'exemplaire d'une
-- facture, et toute pièce de vente d'un dossier basculé ») : sa vente vient de la facture, et ses espèces, de
-- l'encaissement en espèces de celle-ci, que la caisse compte déjà. Une autre pièce de vente compte sa vente elle-même —
-- l'exemplaire d'une facture qui n'est pas source, une vente déclarée hors des factures d'un dossier basculé, une pièce
-- à valider — : la refuser pousserait ses espèces vers le total du jour, qui la compterait une seconde fois.
create function public.regler_piece_par_la_caisse(p_dossier_id uuid, p_piece_id uuid, p_date date, p_montant numeric)
returns public.operations_caisse
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origine text;
  v_mode text;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_ouverture date;
  v_frontiere date;
  v_type text;
  v_statut text;
  v_ttc numeric;
  v_facture uuid;
  v_numero text;
  v_entree boolean;
  v_deja numeric;
  v_id uuid := gen_random_uuid();
  v_operation public.operations_caisse;
  v_jour date;
  v_solde numeric;
begin
  -- 1. L'accès, avant toute lecture ; puis les verrous : celui de la validation, partagé (la frontière lue ici est
  --    celle que les gardes liront), et celui de la caisse du dossier, exclusif (le solde et les paiements de la pièce
  --    lus ici ne changent pas sous le paiement).
  v_origine := public.qui_ecrit_la_caisse(p_dossier_id);
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || p_dossier_id::text, 0));
  select d.mode_comptable into v_mode from public.dossiers d where d.id = p_dossier_id;

  -- 2. Le dossier en trésorerie.
  if v_mode is distinct from 'tresorerie' then
    raise exception 'La caisse ne se tient que dans un dossier en comptabilité de trésorerie.' using errcode = '22023';
  end if;

  -- 3. La pièce, de ce dossier, verrouillée.
  select p.type_piece, p.statut, p.montant_ttc, p.facture_id into v_type, v_statut, v_ttc, v_facture
    from public.pieces p
   where p.id = p_piece_id and p.dossier_id = p_dossier_id
   for share;
  if not found then
    raise exception 'Cette pièce n''est pas une pièce de ce dossier : relis ses pièces.' using errcode = 'P0002';
  end if;

  -- 4. Le type : une pièce d'achat ou de vente ; une note de frais est payée de la poche de l'exploitant.
  if v_type = 'note_frais' then
    raise exception 'Une note de frais est payée de ta poche ; payée par la caisse, c''est un achat : change d''abord son type.'
      using errcode = '22023';
  end if;
  if v_type is distinct from 'achat' and v_type is distinct from 'vente' then
    raise exception 'Seule une pièce d''achat ou de vente se paie par la caisse.' using errcode = '22023';
  end if;

  -- 5. L'exemplaire d'une facture source : sa vente, et ses espèces, viennent de la facture.
  if v_facture is not null then
    select f.numero into v_numero from public.factures_emises f where f.id = v_facture and f.source_de_la_vente;
    if found then
      raise exception 'Cette pièce est l''exemplaire de la facture %, qui compte sa vente : enregistre l''encaissement en espèces de la facture.',
        coalesce(v_numero, '(sans numéro)') using errcode = '22023';
    end if;
  end if;

  -- 6. La date, comme celle d'une opération.
  if p_date is null then
    raise exception 'La date de l''opération de caisse est à renseigner.' using errcode = '22023';
  end if;
  if p_date < date '2000-01-01' then
    raise exception 'Une opération de caisse ne se date pas avant l''an 2000.' using errcode = '22023';
  end if;
  if p_date > v_aujourd_hui then
    raise exception 'Une opération de caisse ne se date pas dans l''avenir : nous sommes le %.',
      to_char(v_aujourd_hui, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select min(a.date) into v_ouverture from public.a_nouveaux a where a.dossier_id = p_dossier_id;
  if v_ouverture is not null and p_date < v_ouverture then
    raise exception 'Cette opération précède l''ouverture du dossier, le % : elle est dans les comptes repris.',
      to_char(v_ouverture, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and p_date <= v_frontiere then
    raise exception '% : sa caisse ne change plus.',
      public.exercice_fige(p_dossier_id, extract(year from p_date)::integer) using errcode = '23514';
  end if;

  -- 7. Le montant, comme celui d'une opération.
  if p_montant is null then
    raise exception 'Le montant de l''opération de caisse est à renseigner.' using errcode = '22023';
  end if;
  if p_montant <> round(p_montant, 2) then
    raise exception 'Le montant d''une opération de caisse est au centime.' using errcode = '22023';
  end if;
  if p_montant = 0 then
    raise exception 'Une opération de caisse de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if abs(p_montant) >= 10000000000000 then
    raise exception 'Le montant d''une opération de caisse dépasse ce que l''application compte.' using errcode = '22023';
  end if;

  -- 8. Le sens : des espèces qui entrent pour une vente, qui sortent pour un achat — l'inverse pour un avoir.
  v_entree := (v_type = 'vente') <> coalesce(v_ttc < 0, false);
  if (p_montant > 0) <> v_entree then
    raise exception 'Ce paiement ne va pas dans le sens de sa pièce : une pièce d''achat fait sortir des espèces (un montant négatif), une pièce de vente en fait entrer (positif) — l''inverse pour un avoir.'
      using errcode = '22023';
  end if;

  -- 9. Une pièce validée : ses paiements par la caisse non retirés ne dépassent pas son montant.
  if v_statut = 'validee' and v_ttc is not null then
    select coalesce(sum(abs(o.montant)), 0) into v_deja from public.operations_caisse o
     where o.dossier_id = p_dossier_id and o.piece_id = p_piece_id and o.genre = 'paiement' and o.retire_le is null;
    if v_deja + abs(p_montant) > abs(v_ttc) then
      raise exception 'Les paiements de cette pièce par la caisse dépasseraient son montant : relis ses paiements.' using errcode = '22023';
    end if;
  end if;

  -- Le paiement, sous le réglage de CETTE opération (la garde de la table l'exige), retiré aussitôt. Aucune ligne du
  -- brouillon : la contrepartie s'écrit avec les écritures de la pièce (§ 5).
  perform set_config('jd.caisse', v_id::text, true);
  insert into public.operations_caisse (id, dossier_id, genre, date, montant, categorie_id, taux_tva, encaissements_du_jour,
                                        piece_id, origine, remplace_id, cree_par)
  values (v_id, p_dossier_id, 'paiement', p_date, p_montant, null, null, null, p_piece_id, v_origine, null, auth.uid())
  returning * into v_operation;
  perform set_config('jd.caisse', '', true);

  -- 10. La caisse jamais négative, quand le paiement fait sortir des espèces ; les déclencheurs de la migration `caisse`
  --     la jugent encore à la fin de la transaction.
  if p_montant < 0 then
    select n.jour, n.solde into v_jour, v_solde from public.premier_jour_negatif_de_la_caisse(p_dossier_id) n;
    if v_jour is not null then
      raise exception '%', public.texte_caisse_negative('paiement', p_montant, v_jour, v_solde) using errcode = '23514';
    end if;
  end if;
  return v_operation;
end
$$;

comment on function public.regler_piece_par_la_caisse(uuid, uuid, date, numeric) is
  'Le paiement d''une pièce par la caisse (ligne 26.6, étape C8 ; CAISSE-Q4) : une opération de genre paiement qui cite sa pièce, à sa date, d''un montant signé comme le relevé, sans écriture — la contrepartie s''écrit avec celles de la pièce. Ses refus, dans l''ordre : l''accès (42501), la trésorerie, la pièce du dossier (P0002), le type, l''exemplaire d''une facture source, la date, le montant, le sens, le plafond d''une pièce validée (22023 ; la frontière, 23514), la caisse jamais négative (23514).';

-- ══ 5. La garde de l'écriture d'une opération : la contrepartie d'un paiement ══════════
-- Le corps de la migration `caisse`, au caractère près, plus la contrepartie d'un paiement par la caisse : une ligne qui
-- cite le paiement ET sa pièce, que l'application écrit sous la RLS du brouillon avec les écritures de la pièce (la
-- conception, § 8) — aucune fonction ne l'écrit, aucun réglage ne la couvre. Elle se juge sous le verrou de la caisse du
-- dossier : deux contreparties écrites ensemble ne dépassent pas leur paiement, et un paiement retiré pendant l'écriture
-- n'en garde aucune. Elle se retire avec les écritures de sa pièce : « Régénérer » les reprend toutes, contreparties
-- comprises ; le retrait du paiement l'emporte avec lui, sous son réglage (`retirer_operation_caisse`). Elle ne se
-- modifie pas, comme toute ligne d'une opération de caisse. Une ligne RÉINSÉRÉE par la restauration (le
-- super-administrateur, un dossier sans exercice validé, son instant de création d'avant la transaction) suit la porte
-- d'hier : la contrepartie qu'elle remet a déjà été jugée.
create or replace function public.garder_ecriture_de_caisse() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.operations_caisse;
  v_caisse text;
  v_deja numeric;
begin
  if tg_op = 'DELETE' then
    if old.operation_caisse_id is null
       or not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or not exists (select 1 from public.operations_caisse o where o.id = old.operation_caisse_id)
       or coalesce(current_setting('jd.caisse', true), '') = old.operation_caisse_id::text then
      return old;
    end if;
    -- La contrepartie d'un paiement par la caisse — la ligne qui porte aussi sa pièce — se retire encore avec les
    -- écritures de sa pièce (la migration `paiement_par_la_caisse`).
    if old.piece_id is not null
       and exists (select 1 from public.operations_caisse o where o.id = old.operation_caisse_id and o.genre = 'paiement') then
      return old;
    end if;
    raise exception 'L''écriture d''une opération de caisse se retire avec cette opération.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.operation_caisse_id is not null then
    raise exception 'L''écriture d''une opération de caisse ne se modifie pas : retire l''opération, puis saisis-la de nouveau.'
      using errcode = '42501';
  end if;
  if new.operation_caisse_id is null then
    return new;
  end if;
  -- La contrepartie d'un paiement par la caisse (la migration `paiement_par_la_caisse`) : écrite hors de toute fonction,
  -- sous la RLS du brouillon, une ligne réinsérée par la restauration exceptée ; jugée sous le verrou de la caisse.
  if tg_op = 'INSERT' and new.piece_id is not null
     and coalesce(current_setting('jd.caisse', true), '') is distinct from new.operation_caisse_id::text
     and not (new.created_at < now() and public.is_super_admin()
              and not exists (select 1 from public.exercices_valides v where v.dossier_id = new.dossier_id))
     and exists (select 1 from public.operations_caisse o where o.id = new.operation_caisse_id and o.genre = 'paiement') then
    perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || new.dossier_id::text, 0));
    select o.* into v_operation from public.operations_caisse o where o.id = new.operation_caisse_id;
    if v_operation.dossier_id is distinct from new.dossier_id or v_operation.date is distinct from new.date
       or v_operation.retire_le is not null or v_operation.piece_id is distinct from new.piece_id then
      raise exception 'Cette écriture ne suit pas son opération de caisse : son dossier, sa date, ou sa pièce.' using errcode = '23514';
    end if;
    v_caisse := public.compte_du_role(new.dossier_id, 'caisse');
    if new.compte is distinct from v_caisse then
      raise exception 'La contrepartie d''un paiement par la caisse s''écrit au compte de la caisse du dossier (%).', v_caisse
        using errcode = '23514';
    end if;
    if new.sens is distinct from (case when v_operation.montant > 0 then 'debit' else 'credit' end) then
      raise exception 'La contrepartie d''un paiement par la caisse suit ses espèces : au débit quand elles entrent, au crédit quand elles sortent.'
        using errcode = '23514';
    end if;
    select coalesce(sum(b.montant), 0) into v_deja from public.ecritures_brouillon b where b.operation_caisse_id = v_operation.id;
    if v_deja + new.montant > abs(v_operation.montant) then
      raise exception 'La contrepartie d''un paiement par la caisse ne dépasse pas ce paiement.' using errcode = '23514';
    end if;
    return new;
  end if;
  if coalesce(current_setting('jd.caisse', true), '') is distinct from new.operation_caisse_id::text
     and not (tg_op = 'INSERT' and public.is_super_admin()
              and not exists (select 1 from public.exercices_valides v where v.dossier_id = new.dossier_id)) then
    raise exception 'L''écriture d''une opération de caisse ne s''écrit qu''avec cette opération, par la fonction de la caisse.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.operations_caisse o
                  where o.id = new.operation_caisse_id and o.dossier_id = new.dossier_id and o.date = new.date
                    and o.retire_le is null and (new.piece_id is null or new.piece_id = o.piece_id)) then
    raise exception 'Cette écriture ne suit pas son opération de caisse : son dossier, sa date, ou sa pièce.' using errcode = '23514';
  end if;
  return new;
end
$$;

-- ══ 6. La pièce qu'un paiement de la caisse cite ══════════
-- Le dossier d'abord, pour tout paiement, retiré ou non : l'opération reste dans le sien, et cite sa pièce pour la piste
-- d'audit. Puis, tant qu'un paiement n'est pas retiré, ce que `regler_piece_par_la_caisse` a jugé : une pièce d'achat ou
-- de vente (ni une note de frais, payée de la poche de l'exploitant, ni une pièce « autre »), qui n'est pas l'exemplaire
-- d'une facture source. Le sens d'un paiement dont la pièce passe de l'achat à la vente, ou son plafond quand son montant
-- change, ne se refusent pas ici : le pointage les dira (lot C9). Sa suppression, la clé la refuse (`on delete restrict`).
-- Aux droits du propriétaire : elle lit les paiements de la pièce quel que soit l'auteur du changement.
create function public.garder_piece_payee_par_la_caisse() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
begin
  -- 1. Le dossier.
  if new.dossier_id is distinct from old.dossier_id
     and exists (select 1 from public.operations_caisse o where o.piece_id = old.id) then
    raise exception 'Cette pièce est citée par un paiement de la caisse de son dossier : elle ne change pas de dossier.'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.operations_caisse o
                  where o.piece_id = old.id and o.genre = 'paiement' and o.retire_le is null) then
    return new;
  end if;
  -- 2. Le type.
  if new.type_piece is distinct from 'achat' and new.type_piece is distinct from 'vente' then
    raise exception 'Cette pièce est payée par la caisse : elle reste une pièce d''achat ou de vente tant que ce paiement n''est pas retiré.'
      using errcode = '23514';
  end if;
  -- 3. L'exemplaire d'une facture source.
  if new.facture_id is not null and new.facture_id is distinct from old.facture_id then
    select f.numero into v_numero from public.factures_emises f where f.id = new.facture_id and f.source_de_la_vente;
    if found then
      raise exception 'Cette pièce est payée par la caisse : elle ne devient l''exemplaire de la facture %, qui compte sa vente, qu''une fois ce paiement retiré — l''encaissement en espèces de la facture le remplace.',
        coalesce(v_numero, '(sans numéro)') using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

-- Sa condition ne met en route la garde que pour un changement du dossier, du type ou de la désignation.
create trigger pieces_payees_par_la_caisse
  before update of dossier_id, type_piece, facture_id on public.pieces
  for each row
  when (old.dossier_id is distinct from new.dossier_id or old.type_piece is distinct from new.type_piece
        or old.facture_id is distinct from new.facture_id)
  execute function public.garder_piece_payee_par_la_caisse();

-- ══ 7. Enregistrer une opération de caisse : l'ensemble du jour d'une recette ══════════
-- Le corps de la migration `caisse`, au caractère près, plus les paiements par la caisse de pièces de vente du jour
-- dans l'ensemble qu'une recette reconnaît : la recette nomme, avec les encaissements en espèces des factures sources de
-- son jour, ces paiements-là (leurs identifiants, dans la même liste) ; un paiement enregistré depuis la lecture se
-- refuse juste après l'encaissement qui manque, un paiement lu qui n'est pas de ce jour, d'une pièce de vente, ou plus
-- dans la caisse, juste après l'encaissement en trop. Rien n'y nomme une pièce ni un client.
create or replace function public.enregistrer_operation_caisse(p_dossier_id uuid, p_genre text, p_date date, p_montant numeric,
  p_categorie_id uuid, p_taux_tva numeric, p_encaissements_du_jour uuid[], p_ecritures jsonb)
returns public.operations_caisse
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origine text;
  v_mode text;
  v_assujetti boolean;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_ouverture date;
  v_frontiere date;
  v_categorie public.categories%rowtype;
  v_attendus uuid[];
  v_paiements uuid[];
  v_recus uuid[];
  v_ecart uuid;
  v_numero text;
  v_caisse text;
  v_dirigeant text;
  v_collectee text;
  v_centimes bigint;
  v_tva bigint := 0;
  v_libelle text;
  v_conforme boolean;
  v_id uuid := gen_random_uuid();
  v_operation public.operations_caisse;
  v_debit numeric;
  v_credit numeric;
  v_jour date;
  v_solde numeric;
begin
  -- 1. L'accès, avant toute lecture ; puis les verrous : celui de la validation, partagé (la frontière lue ici est
  --    celle que les gardes liront), et celui de la caisse du dossier, exclusif (l'ensemble du jour et le solde lus ici
  --    ne changent pas sous la saisie).
  v_origine := public.qui_ecrit_la_caisse(p_dossier_id);
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || p_dossier_id::text, 0));
  select d.mode_comptable, d.assujetti_tva into v_mode, v_assujetti from public.dossiers d where d.id = p_dossier_id;

  -- 2. Le dossier en trésorerie.
  if v_mode is distinct from 'tresorerie' then
    raise exception 'La caisse ne se tient que dans un dossier en comptabilité de trésorerie.' using errcode = '22023';
  end if;

  -- 3. Le genre.
  if p_genre is null or p_genre not in ('recette', 'apport', 'prelevement') then
    raise exception 'Une opération de caisse est une recette en espèces, un apport ou un prélèvement de l''exploitant.'
      using errcode = '22023';
  end if;

  -- 4. La date.
  if p_date is null then
    raise exception 'La date de l''opération de caisse est à renseigner.' using errcode = '22023';
  end if;
  if p_date < date '2000-01-01' then
    raise exception 'Une opération de caisse ne se date pas avant l''an 2000.' using errcode = '22023';
  end if;
  if p_date > v_aujourd_hui then
    raise exception 'Une opération de caisse ne se date pas dans l''avenir : nous sommes le %.',
      to_char(v_aujourd_hui, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select min(a.date) into v_ouverture from public.a_nouveaux a where a.dossier_id = p_dossier_id;
  if v_ouverture is not null and p_date < v_ouverture then
    raise exception 'Cette opération précède l''ouverture du dossier, le % : elle est dans les comptes repris.',
      to_char(v_ouverture, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and p_date <= v_frontiere then
    raise exception '% : sa caisse ne change plus.',
      public.exercice_fige(p_dossier_id, extract(year from p_date)::integer) using errcode = '23514';
  end if;

  -- 5. Le montant.
  if p_montant is null then
    raise exception 'Le montant de l''opération de caisse est à renseigner.' using errcode = '22023';
  end if;
  if p_montant <> round(p_montant, 2) then
    raise exception 'Le montant d''une opération de caisse est au centime.' using errcode = '22023';
  end if;
  if p_montant = 0 then
    raise exception 'Une opération de caisse de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if p_genre <> 'recette' and p_montant < 0 then
    raise exception 'Le montant d''un apport ou d''un prélèvement est positif : un apport fait entrer des espèces, un prélèvement les fait sortir.'
      using errcode = '22023';
  end if;
  if abs(p_montant) >= 10000000000000 then
    raise exception 'Le montant d''une opération de caisse dépasse ce que l''application compte.' using errcode = '22023';
  end if;

  -- 6. La catégorie d'une recette, et son compte de produit.
  if p_genre = 'recette' then
    if p_categorie_id is null then
      raise exception 'La nature d''une recette en espèces est une catégorie de produit du dossier : à choisir.'
        using errcode = '22023';
    end if;
    select c.* into v_categorie from public.categories c
     where c.id = p_categorie_id and (c.dossier_id is null or c.dossier_id = p_dossier_id);
    if not found then
      raise exception 'Cette catégorie n''existe pas pour ce dossier.' using errcode = '22023';
    end if;
    if v_categorie.compte_comptable is null or v_categorie.compte_comptable !~ '^7[0-9]{2}' then
      raise exception 'La catégorie « % » n''a pas de compte de produit (classe 7) : une recette en espèces ne s''y range pas.',
        v_categorie.libelle using errcode = '22023';
    end if;
  elsif p_categorie_id is not null then
    raise exception 'Un apport ou un prélèvement n''a pas de catégorie : il s''écrit face au compte de l''exploitant.'
      using errcode = '22023';
  end if;

  -- 7. Le taux.
  if p_genre = 'recette' and v_assujetti then
    if p_taux_tva is null then
      raise exception 'Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».'
        using errcode = '22023';
    end if;
    if p_taux_tva not in (0, 5.5, 8.5, 10, 20) then
      raise exception 'Ce taux de TVA n''est pas pris en charge.' using errcode = '22023';
    end if;
  elsif p_taux_tva is not null then
    raise exception 'Un taux de TVA ne s''applique qu''à une recette d''un dossier assujetti.' using errcode = '22023';
  end if;

  -- 8. L'ensemble du jour : les espèces des factures sources que la caisse compte ce jour-là, et les paiements par la
  --    caisse de pièces de vente de ce jour (la migration `paiement_par_la_caisse`) — un paiement compte sa vente, le
  --    total du jour ne la compte pas une seconde fois.
  if p_genre = 'recette' then
    if p_encaissements_du_jour is null or array_position(p_encaissements_du_jour, null) is not null then
      raise exception 'La saisie d''une recette dit les encaissements en espèces de factures de son jour qu''elle a lus : une liste d''identifiants, vide s''il n''y en a aucun.'
        using errcode = '22023';
    end if;
    v_recus := array(select distinct x from unnest(p_encaissements_du_jour) x order by x);
    if cardinality(v_recus) <> cardinality(p_encaissements_du_jour) then
      raise exception 'La saisie d''une recette nomme chaque encaissement de son jour une seule fois.' using errcode = '22023';
    end if;
    v_attendus := array(
      select e.id
        from public.encaissements_factures e
        join public.factures_emises f on f.id = e.facture_id
        left join public.encaissements_factures o on o.id = e.annule_id
       where e.dossier_id = p_dossier_id and e.date_encaissement = p_date and f.source_de_la_vente
         and e.retire_le is null and e.ligne_bancaire_id is null
         and case when e.annule_id is null then e.moyen = 'especes'
                  else o.ligne_bancaire_id is null and o.moyen = 'especes' end
       order by e.id);
    v_paiements := array(
      select o.id
        from public.operations_caisse o
        join public.pieces p on p.id = o.piece_id
       where o.dossier_id = p_dossier_id and o.date = p_date and o.genre = 'paiement' and o.retire_le is null
         and p.type_piece = 'vente'
       order by o.id);
    select min(x::text)::uuid into v_ecart from unnest(v_attendus) x where x <> all (v_recus);
    if v_ecart is not null then
      select f.numero into v_numero from public.encaissements_factures e join public.factures_emises f on f.id = e.facture_id
       where e.id = v_ecart;
      raise exception 'Un encaissement en espèces de la facture % du même jour a été enregistré depuis ta lecture : relis la caisse.',
        coalesce(v_numero, '(sans numéro)') using errcode = '22023';
    end if;
    select min(x::text)::uuid into v_ecart from unnest(v_paiements) x where x <> all (v_recus);
    if v_ecart is not null then
      raise exception 'Un paiement en espèces d''une pièce de vente du même jour a été enregistré depuis ta lecture : relis la caisse.'
        using errcode = '22023';
    end if;
    select min(x::text)::uuid into v_ecart from unnest(v_recus) x where x <> all (v_attendus || v_paiements);
    if v_ecart is not null then
      select f.numero into v_numero from public.encaissements_factures e join public.factures_emises f on f.id = e.facture_id
       where e.id = v_ecart and e.dossier_id = p_dossier_id;
      if found then
        raise exception 'L''encaissement de la facture % que ta lecture comptait n''est pas dans la caisse de ce jour : relis la caisse.',
          coalesce(v_numero, '(sans numéro)') using errcode = '22023';
      end if;
      if exists (select 1 from public.operations_caisse o
                  where o.id = v_ecart and o.dossier_id = p_dossier_id and o.genre = 'paiement') then
        raise exception 'Le paiement d''une pièce que ta lecture comptait n''est pas un paiement en espèces d''une pièce de vente de ce jour : relis la caisse.'
          using errcode = '22023';
      end if;
      raise exception 'Un encaissement que ta lecture comptait n''est pas un encaissement de ce dossier : relis la caisse.'
        using errcode = '22023';
    end if;
  elsif p_encaissements_du_jour is not null and cardinality(p_encaissements_du_jour) > 0 then
    raise exception 'Seule une recette reconnaît les encaissements en espèces de son jour.' using errcode = '22023';
  end if;

  -- 9. L'écriture attendue, EN CENTIMES ENTIERS, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues
  -- présente, à l'égalité exacte — un montant reçu qui n'est pas au centime n'égale aucun nombre entier de centimes.
  -- Une ligne à zéro n'en est pas une (une recette exonérée n'a pas de ligne de TVA).
  v_caisse := public.compte_du_role(p_dossier_id, 'caisse');
  v_centimes := (abs(p_montant) * 100)::bigint;
  if p_genre = 'recette' then
    if p_taux_tva is not null and p_taux_tva > 0 then
      v_tva := (public.tva_incluse(abs(p_montant), p_taux_tva) * 100)::bigint;
      v_collectee := public.compte_du_role(p_dossier_id, 'tva_collectee');
    end if;
    v_libelle := case when p_montant > 0 then 'Recettes en espèces du ' else 'Espèces rendues le ' end
      || to_char(p_date, 'DD/MM/YYYY') || ' — ' || v_categorie.libelle;
  else
    v_dirigeant := public.compte_du_dirigeant(p_dossier_id);
    v_libelle := case when p_genre = 'apport' then 'Apport en caisse de l''exploitant'
                      else 'Prélèvement en espèces de l''exploitant' end;
  end if;
  if jsonb_typeof(p_ecritures) is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_ecritures) e(valeur)
                 where jsonb_typeof(e.valeur) is distinct from 'object'
                    or jsonb_typeof(e.valeur -> 'compte') is distinct from 'string'
                    or jsonb_typeof(e.valeur -> 'sens') is distinct from 'string'
                    or jsonb_typeof(e.valeur -> 'montant') is distinct from 'number'
                    or jsonb_typeof(coalesce(e.valeur -> 'libelle', 'null'::jsonb)) not in ('null', 'string')) then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select a.compte, a.sens, a.centimes from (values
      (v_caisse, case when p_genre = 'prelevement' or p_montant < 0 then 'credit' else 'debit' end, v_centimes),
      (case when p_genre = 'recette' then v_categorie.compte_comptable else v_dirigeant end,
       case when p_genre = 'prelevement' or p_montant < 0 then 'debit' else 'credit' end,
       v_centimes - v_tva),
      (v_collectee, case when p_montant < 0 then 'debit' else 'credit' end, v_tva)
    ) as a(compte, sens, centimes)
    where a.centimes > 0
  ), recues as (
    select e.valeur ->> 'compte' as compte, e.valeur ->> 'sens' as sens, (e.valeur ->> 'montant')::numeric * 100 as centimes
      from jsonb_array_elements(p_ecritures) e(valeur)
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, centimes::numeric from attendues
                     except all select compte, sens, centimes from recues)
     and not exists (select 1 from jsonb_array_elements(p_ecritures) e(valeur)
                      where jsonb_typeof(e.valeur -> 'libelle') = 'string' and e.valeur ->> 'libelle' <> v_libelle)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : %).',
      v_caisse using errcode = '22023';
  end if;

  -- L'opération et son écriture, d'un tenant, sous le réglage de CETTE opération, retiré aussitôt.
  perform set_config('jd.caisse', v_id::text, true);
  insert into public.operations_caisse (id, dossier_id, genre, date, montant, categorie_id, taux_tva, encaissements_du_jour,
                                        piece_id, origine, remplace_id, cree_par)
  values (v_id, p_dossier_id, p_genre, p_date, p_montant, p_categorie_id, p_taux_tva,
          case when p_genre = 'recette' then v_recus end, null, v_origine, null, auth.uid())
  returning * into v_operation;
  insert into public.ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, operation_caisse_id)
  select p_dossier_id, p_date, e.valeur ->> 'compte', v_libelle, (e.valeur ->> 'montant')::numeric, e.valeur ->> 'sens',
         'proposee', v_id
    from jsonb_array_elements(p_ecritures) e(valeur);
  perform set_config('jd.caisse', '', true);

  select coalesce(sum(b.montant) filter (where b.sens = 'debit'), 0), coalesce(sum(b.montant) filter (where b.sens = 'credit'), 0)
    into v_debit, v_credit
    from public.ecritures_brouillon b where b.operation_caisse_id = v_id;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  -- 10. La caisse jamais négative, dite ici sous les mots du geste ; une saisie d'un mois la juge à sa fin.
  if coalesce(current_setting('jd.caisse_d_un_lot', true), '') is distinct from p_dossier_id::text
     and (p_genre = 'prelevement' or p_montant < 0) then
    select n.jour, n.solde into v_jour, v_solde from public.premier_jour_negatif_de_la_caisse(p_dossier_id) n;
    if v_jour is not null then
      raise exception '%', public.texte_caisse_negative(case when p_genre = 'prelevement' then 'prelevement' else 'especes_rendues' end,
        p_montant, v_jour, v_solde) using errcode = '23514';
    end if;
  end if;
  return v_operation;
end
$$;

-- ══ 8. Les droits d'exécution ══════════
-- La fonction du paiement, au compte connecté (elle contrôle l'accès elle-même, avant toute lecture), ni à l'anonyme ni à
-- PUBLIC ; les deux gardes, à personne ; les quatre fonctions remplacées gardent les leurs.
revoke execute on function public.regler_piece_par_la_caisse(uuid, uuid, date, numeric) from public, anon;
grant execute on function public.regler_piece_par_la_caisse(uuid, uuid, date, numeric) to authenticated;
revoke execute on function public.garder_piece_payee_par_la_caisse() from public, anon, authenticated;
revoke execute on function public.garder_caisse_depuis_l_ouverture() from public, anon, authenticated;
