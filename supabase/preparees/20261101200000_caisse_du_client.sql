-- LA CAISSE : LE DROIT « CAISSE » D'UN ACCÈS CLIENT, ET LA SAISIE DES ESPÈCES PAR LE PRATICIEN, EN BASE (ligne 26.6, étape
-- C10 ; MVP-D2 ; CAISSE-Q1, (B)). La conception : HISTORIQUE.md, « LA CAISSE : LA SAISIE DU PRATICIEN ET LA PIÈCE RÉGLÉE
-- PAR LA CAISSE — LA CONCEPTION REPRISE (CAISSE-Q1 ET Q4) », § 3 (le droit), § 4 (ce que la base ouvre en lecture), § 5
-- (les fonctions qui acceptent le client), § 6 (le statut de TVA), § 9, n° 5 (cette migration) et § 10 (le lot C10) ;
-- amendée par « HUIT RÉPONSES DU CABINET : A7-Q1 À Q3, VF9CQ1B-Q1, CAISSE2-Q1 À Q4 » — CAISSE2-Q2, (B) : la nature des
-- recettes du praticien, une catégorie que le cabinet fixe pour le dossier ; CAISSE2-Q3, (B), contre la recommandation :
-- la franchise en base, comme l'exonération (CGI, art. 286, II, 2, cité par BOI-TVA-DECLA-30-10-30, § 25). Préparée sous
-- une version PROVISOIRE, APRÈS les trois migrations préparées du jour de C8 — `paiement_par_la_caisse`,
-- `champs_bnc_du_fec`, `validation_des_paiements_par_la_caisse`, dans cet ordre —, qu'elle suppose : elle reprend le corps
-- qu'`enregistrer_operation_caisse` reçoit de la première, au caractère près hors de ce qu'elle ajoute.
--
-- CE QU'ELLE POSE.
--   1. Le droit : `memberships.droit_caisse`, booléen non nul, FAUX par défaut (règlement (UE) 2016/679, art. 25, § 2 : un
--      droit d'écrire n'arrive à aucun accès sans un geste du cabinet) ; `client_du_dossier` connaît le mot « caisse » ;
--      `gere_la_caisse(dossier)` (le cabinet du dossier, ou un accès « Caisse ») ; `droits_sur_le_dossier` rend la clé
--      `caisse` — une clé de plus, sans changer la signature : les quatre Edge Functions de la vente lisent leurs quatre
--      cases et ne ferment rien sur une de plus.
--   2. `changer_droits_acces` à QUATRE paramètres (`p_caisse`, sans valeur par défaut), la seule écriture des droits ;
--      celle à TROIS, que l'onglet Accès appelle aujourd'hui, devient un appel de la forme à quatre, « Caisse » nul donc
--      inchangé — un seul corps écrit `memberships`, et PostgREST distingue les deux par leurs noms de paramètres.
--   3. Trois gardes, aux droits du propriétaire, qu'aucun rôle de l'API n'exécute :
--      - `garder_droit_caisse`, APRÈS l'insertion et la mise à jour de `droit_caisse` ou de `dossier_id` d'un accès (le
--        patron de `garder_droit_ventes`) : « Caisse » qui ARRIVE sur un accès se refuse (23514) sur un dossier dont le
--        statut de TVA n'est ni « exonéré » ni « franchise » — à préciser compris —, pour tout auteur, l'insertion du
--        super-administrateur exceptée (la restauration) ; le statut se lit `for share` ;
--      - `garder_statut_tva_de_la_caisse`, APRÈS toute mise à jour d'un dossier dont le statut de TVA CHANGE (la clause
--        `when` : le statut déduit d'`assujetti_tva` par `deduire_assujetti_tva` compris) : quitter l'ensemble des deux
--        statuts exclus se refuse (23514) tant qu'un accès du dossier porte « Caisse » ; passer de l'un à l'autre passe ;
--      - `garder_categorie_recettes_client`, APRÈS l'insertion et la mise à jour de la colonne neuve d'un dossier : une
--        catégorie de produit (classe 7) du dossier, ou commune, ou rien.
--   4. La nature des recettes du client (CAISSE2-Q2, (B)) : `dossiers.categorie_recettes_client`, nulle, que le cabinet
--      pose ; sans clé étrangère (la restauration écrit les dossiers avant leurs catégories : une clé la ferait échouer,
--      et une seconde passe de la sauvegarde serait un chantier de plus) — la garde ci-dessus la juge à l'écriture, la
--      saisie du client à son usage.
--   5. `qui_ecrit_la_caisse` REMPLACÉE, son corps seul : « client » pour un accès « Caisse » d'un dossier exonéré ou en
--      franchise, le statut relu `for share` ; un accès « Caisse » d'un dossier qui ne l'est plus (une restauration, un
--      état d'avant cette migration) se refuse en 23514. Les quatre fonctions qui l'appellent — le retrait, le
--      remplacement, la saisie d'un mois, le paiement d'une pièce — ne changent pas : leurs branches « client », écrites
--      dès les migrations `caisse_retrait_et_versement` et `paiement_par_la_caisse`, s'ouvrent.
--   6. `enregistrer_operation_caisse` REMPLACÉE — celle de `paiement_par_la_caisse`, au caractère près, plus ceci, pour le
--      client seul : la nature d'une recette est celle du dossier (il n'en envoie aucune) ; il n'envoie pas d'écriture, la
--      base compose la sienne — celle qu'elle attend du cabinet — et la juge comme celle du cabinet ; l'ensemble du jour
--      se refuse sans le numéro d'une facture. Le cabinet, rien de changé, au caractère près de ses refus.
--   7. La lecture du client (le § 4 de la conception, présentée au cabinet avant d'être appliquée) : une policy
--      PERMISSIVE de plus sur `operations_caisse`, `for select to authenticated using (client_du_dossier(dossier_id,
--      'caisse'))` — toutes les opérations de la caisse de son dossier, celles du cabinet et les retirées comprises,
--      chaque colonne ; et `caisse_du_client(dossier, année)`, aux droits du propriétaire, qui lui rend la caisse jour
--      par jour : le report de l'année d'avant, l'ouverture, ses opérations, les versements et retraits du relevé, les
--      espèces des factures sources et leurs identifiants (ceux qu'une recette du jour reconnaît), le solde, et le jour
--      figé — des totaux, jamais un libellé, un numéro, un nom ni une pièce.
--
-- LES REFUS NEUFS, DANS L'ORDRE (que src/lib/caisse.ts redit avant le clic, sous les mêmes mots) :
--   - `qui_ecrit_la_caisse` — l'accès « Caisse » d'un dossier ni exonéré ni en franchise (23514), avant le refus d'hier
--     (42501) ;
--   - `enregistrer_operation_caisse`, pour le client — sa recette porte une catégorie (22023) ; le dossier n'en a pas
--     fixé (22023) ; celle qu'il a fixée n'est plus une catégorie de produit du dossier (22023) — puis ceux d'hier ;
--     dans l'ensemble du jour, l'encaissement qui manque et celui en trop, sans numéro (22023), juste avant les mots
--     d'hier ; son écriture envoyée (22023), avant celle d'hier qui serait incomplète ;
--   - `changer_droits_acces` à quatre paramètres — ceux d'hier, aux trois mots (42501, 22023, P0002) ;
--   - les gardes — « Caisse » sur un dossier ni exonéré ni en franchise ; le statut qui quitte l'ensemble sous une case ;
--     une nature qui n'est pas une catégorie de produit du dossier (23514 chacun) ;
--   - `caisse_du_client` — l'accès (42501), l'année (22023).
--
-- LA CONCURRENCE : la case et le statut se retiennent l'un l'autre. « Caisse » qui arrive lit le statut `for share` : un
-- changement de statut engagé se termine d'abord, et la case se refuse sur le statut neuf ; un changement de statut qui
-- suit attend la fin de l'écriture de l'accès, puis sa garde — qui juge après le verrou de la ligne du dossier, que sa
-- mise à jour a pris, sur un instantané neuf — voit la case et refuse. La garde du statut ne VERROUILLE PAS les accès
-- qu'elle lit : `for share` sur eux, que la conception demandait, ouvrirait un interblocage avec « Ventes » coché sur un
-- accès qui porte « Caisse » (l'accès tenu par sa mise à jour, qui attend le dossier ; le dossier tenu par la sienne, qui
-- attendrait l'accès), et n'ajouterait rien : un accès qui reçoit la case pendant ce temps attend le dossier. La saisie du
-- client lit le statut `for share` : un statut ne change pas sous elle.
--
-- CE QU'ELLE TOUCHE D'EXISTANT : `memberships` et `dossiers` (une colonne chacune, fausse ou nulle partout) ; trois
-- fonctions des droits et deux de la caisse, relues en production le 01/11/2026 à leur empreinte — celle
-- d'`enregistrer_operation_caisse`, sur une réplique munie des trois migrations préparées —, que la garde de tête
-- vérifie : leur OID, leur propriétaire, leurs droits restent (`create or replace`) ; une policy de lecture de plus ; trois
-- déclencheurs neufs, dont un sur `dossiers` qui ne juge qu'un dossier dont le statut de TVA change, et un sur
-- `memberships` qui ne juge que « Caisse » qui arrive. NEUTRE EN PRODUCTION si les comptes du jour de l'application le
-- redisent : aucun accès ne porte la case (la colonne naît fausse), aucune nature n'est fixée, aucune opération de caisse
-- (relevé le 01/11/2026 : trois accès, quatre dossiers, aucune opération de caisse, aucun exercice validé).
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : ni objet, ni donnée, ni droit d'un objet
-- qui reste ; ses `revoke` ne retirent que les droits que Postgres donne d'office aux six fonctions qu'elle crée — le
-- patron des migrations de la caisse. Aucune barre oblique inverse, aucun retour chariot. Elle s'applique PAR L'OUTIL. Son
-- retour arrière, donné à part (`supabase/preparees/retour/`), retire la colonne, la policy, les fonctions et les
-- déclencheurs neufs : destructif dès qu'une case est cochée — il se refuse tant qu'un accès la porte —, à accorder, et à
-- coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé. L'écran du cabinet (C11) et « Ma caisse » (C12) suivent,
-- derrière le drapeau de la migration.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une base sans les trois migrations préparées du jour de C8, dans leur ordre ; une
-- fonction remplacée, appelée, ou dont les branches « client » s'ouvrent ici, qui ne serait plus celle que cette migration
-- suppose — à l'empreinte de son corps, les retours chariot d'un collage écartés ; et une base où manquerait ce qu'elle
-- lit : les statuts de TVA d'hier, les droits et la policy de lecture d'hier, les colonnes qu'elle lit.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if exists (select 1 from pg_attribute a
              where a.attrelid = 'public.memberships'::regclass and a.attname = 'droit_caisse' and not a.attisdropped)
     or exists (select 1 from pg_attribute a
                 where a.attrelid = 'public.dossiers'::regclass and a.attname = 'categorie_recettes_client' and not a.attisdropped)
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('gere_la_caisse', 'caisse_du_client', 'garder_droit_caisse', 'garder_statut_tva_de_la_caisse',
                                   'garder_categorie_recettes_client'))
     or to_regprocedure('public.changer_droits_acces(uuid, boolean, boolean, boolean)') is not null
     or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.policyname = 'operations_caisse_lecture_caisse')
     or exists (select 1 from pg_trigger t where not t.tgisinternal
                 and t.tgname in ('memberships_droit_caisse', 'dossiers_statut_tva_de_la_caisse', 'dossiers_categorie_recettes_client')) then
    raise exception 'La migration caisse_du_client est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regprocedure('public.regler_piece_par_la_caisse(uuid, uuid, date, numeric)') is null then
    raise exception 'La migration paiement_par_la_caisse n''est pas en base : appliquer d''abord paiement_par_la_caisse, champs_bnc_du_fec et validation_des_paiements_par_la_caisse, dans cet ordre, puis celle-ci.';
  end if;
  for v_attendue in select * from (values
      -- Les cinq qu'elle remplace : quatre de l'export, `enregistrer_operation_caisse` telle que `paiement_par_la_caisse` la pose.
      ('client_du_dossier', 'public.client_du_dossier(uuid, text)', '93b6b46f335ae8e06b137fe6ab50a95a'),
      ('droits_sur_le_dossier', 'public.droits_sur_le_dossier(uuid)', '2d63ee335e20d8ac6354fca550908732'),
      ('changer_droits_acces', 'public.changer_droits_acces(uuid, boolean, boolean)', '7ce3d5f0e99a7531cd19940d8fc14831'),
      ('qui_ecrit_la_caisse', 'public.qui_ecrit_la_caisse(uuid)', 'd4faab33c7c0cdb268621bd0e881d62c'),
      ('enregistrer_operation_caisse', 'public.enregistrer_operation_caisse(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb)', '394bed68d4f6b59d030e3792e758840e'),
      -- Celles qu'elle appelle, ou dont `caisse_du_client` redit le compte (`premier_jour_negatif_de_la_caisse`, bornée par
      -- son ouverture depuis `paiement_par_la_caisse`).
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('gere_les_ventes', 'public.gere_les_ventes(uuid)', '8e4d3bf3945fee96681f1e4ace9ba64b'),
      ('gere_la_banque', 'public.gere_la_banque(uuid)', '003c9545ca28e812ec7485f329082d47'),
      ('compte_du_role', 'public.compte_du_role(uuid, text)', '6108ab75d148aa2800484b89bb112c70'),
      ('compte_du_dirigeant', 'public.compte_du_dirigeant(uuid)', 'c02c751713f2d759745267145e9e6b40'),
      ('tva_incluse', 'public.tva_incluse(numeric, numeric)', '04a27c1247f135cd9fd2903e501b5cbe'),
      ('cle_validation', 'public.cle_validation(uuid)', 'bcbb03363036aa6aa037c0b829e3382f'),
      ('frontiere_validation', 'public.frontiere_validation(uuid)', '24a04846471ec5e8cdbae6f3b9f4a2e8'),
      ('exercice_fige', 'public.exercice_fige(uuid, integer)', 'b70cbdd4a870f5e17e8e4c6851506bdc'),
      ('texte_caisse_negative', 'public.texte_caisse_negative(text, numeric, date, numeric)', 'aa7e7a933ac8ce8afe78209dd32607ab'),
      ('premier_jour_negatif_de_la_caisse', 'public.premier_jour_negatif_de_la_caisse(uuid)', '3e04d7e969c9614be2d9eda3415f0da2'),
      -- Les quatre dont les branches « client » s'ouvrent, telles que les migrations de la caisse les ont posées.
      ('retirer_operation_caisse', 'public.retirer_operation_caisse(uuid, uuid)', '459ca42980e05044cb30d5d464223775'),
      ('remplacer_operation_caisse', 'public.remplacer_operation_caisse(uuid, uuid, text, date, numeric, uuid, numeric, uuid[], jsonb)', 'b511e1b25aa19b92ba29722d5124da73'),
      ('enregistrer_operations_de_caisse', 'public.enregistrer_operations_de_caisse(uuid, jsonb)', 'f79a5b97da8df6b75af9d59201b76d25'),
      ('regler_piece_par_la_caisse', 'public.regler_piece_par_la_caisse(uuid, uuid, date, numeric)', 'c8b8e39eb6fac46f386673e2d4e775e0'),
      -- L'ordre du jour de l'application : la validation telle que le filet la laisse, après `champs_bnc_du_fec`.
      ('valider_exercice', 'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)', '02750f937482e3f11404f69975eb9220')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p
     where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.nom, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  -- Les statuts de TVA d'hier, que les gardes et la saisie du client jugent : exactement ces trois, ou nul (à préciser).
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.dossiers'::regclass and c.conname = 'dossiers_statut_tva_check'
                  and pg_get_constraintdef(c.oid) = 'CHECK ((statut_tva = ANY (ARRAY[''redevable''::text, ''franchise''::text, ''exonere''::text])))') then
    raise exception 'Les statuts de TVA d''un dossier ne sont plus « redevable », « franchise » et « exonere » : cette base n''est pas celle que la migration suppose.';
  end if;
  -- La lecture de la caisse par le cabinet (la policy d'hier), à côté de laquelle la sienne se pose ; et la garde du droit
  -- « Ventes », son patron, à son déclencheur.
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'operations_caisse'
                  and p.policyname = 'operations_caisse_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)')
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.memberships'::regclass and t.tgname = 'memberships_droit_ventes'
                     and t.tgfoid = to_regprocedure('public.garder_droit_ventes()')) then
    raise exception 'La lecture de la caisse par le cabinet, ou la garde du droit « Ventes », n''est plus celle que cette migration suppose.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped and (a.attrelid, a.attname) in (
     ('public.memberships'::regclass, 'droit_ventes'), ('public.memberships'::regclass, 'droit_banque'),
     ('public.memberships'::regclass, 'dossier_id'), ('public.memberships'::regclass, 'user_id'),
     ('public.dossiers'::regclass, 'statut_tva'), ('public.dossiers'::regclass, 'mode_comptable'),
     ('public.categories'::regclass, 'compte_comptable'), ('public.categories'::regclass, 'dossier_id'),
     ('public.operations_caisse'::regclass, 'origine'), ('public.operations_caisse'::regclass, 'cree_par'),
     ('public.operations_caisse'::regclass, 'genre'), ('public.operations_caisse'::regclass, 'piece_id'),
     ('public.operations_caisse'::regclass, 'retire_le'), ('public.operations_caisse'::regclass, 'date'),
     ('public.operations_caisse'::regclass, 'montant'), ('public.operations_caisse'::regclass, 'dossier_id'),
     ('public.a_nouveaux'::regclass, 'compte'), ('public.a_nouveaux'::regclass, 'date'),
     ('public.lignes_bancaires'::regclass, 'compte_bilan'), ('public.lignes_bancaires'::regclass, 'date'),
     ('public.encaissements_factures'::regclass, 'moyen'), ('public.encaissements_factures'::regclass, 'annule_id'),
     ('public.encaissements_factures'::regclass, 'ligne_bancaire_id'), ('public.encaissements_factures'::regclass, 'retire_le'),
     ('public.encaissements_factures'::regclass, 'date_encaissement'), ('public.factures_emises'::regclass, 'source_de_la_vente'),
     ('public.pieces'::regclass, 'type_piece'));
  if v_nombre <> 27 then
    raise exception 'Une colonne que cette migration lit manque (% sur 27) : cette base n''est pas celle que la migration suppose.', v_nombre;
  end if;
end
$garde$;

-- ══ 1. Le droit « Caisse » d'un accès ══════════
-- Faux par défaut : un accès d'aujourd'hui n'en reçoit aucun, et la case ne s'ouvre que d'un geste du cabinet
-- (`changer_droits_acces`), sur un dossier exclu du système de caisse (la garde du § 7). Le client lit sa ligne
-- (`memberships_select`), sa case comprise ; aucune policy de mise à jour, pour personne.
alter table public.memberships
  add column droit_caisse boolean not null default false;

comment on column public.memberships.droit_caisse is
  'Le droit « Caisse » de cet accès (recettes en espèces, apports, prélèvements, pièces payées en espèces), posé par le cabinet par changer_droits_acces, faux par défaut (ligne 26.6, étape C10) ; il ne se porte que sur un accès d''un dossier exonéré de TVA ou en franchise en base (garder_droit_caisse ; CGI, art. 286, II, 2), hors de la restauration du super-administrateur.';

-- ══ 2. La nature des recettes du client ══════════
-- CAISSE2-Q2, (B) : le praticien ne choisit pas la nature de ses recettes en espèces ; le cabinet la fixe pour le dossier,
-- et remplace une recette qui n'en est pas une. Nulle tant qu'il ne l'a pas fixée : la recette du client se refuse alors,
-- et le lui dit. Sans clé étrangère : la restauration réinsère les dossiers avant leurs catégories.
alter table public.dossiers
  add column categorie_recettes_client uuid;

comment on column public.dossiers.categorie_recettes_client is
  'La nature des recettes en espèces que le client saisit dans sa caisse (ligne 26.6, étape C10 ; CAISSE2-Q2) : une catégorie de produit (classe 7) de ce dossier, ou commune, que le cabinet fixe (garder_categorie_recettes_client) ; nulle tant qu''il ne l''a pas fixée — la recette du client se refuse alors. Sans clé étrangère (la restauration écrit les dossiers avant leurs catégories) : la saisie du client la juge à son usage.';

-- ══ 3. Lire les droits de l'appelant : le mot « caisse » ══════════
-- Le corps de la migration `droits_des_acces_clients`, au caractère près, plus le mot « caisse ». Tout autre mot, ou
-- aucun, rend toujours faux.
create or replace function public.client_du_dossier(p_dossier_id uuid, p_droit text) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.dossier_id = p_dossier_id
      and m.user_id = auth.uid()
      and case p_droit
            when 'membre' then true
            when 'ventes' then m.droit_ventes
            when 'banque' then m.droit_banque
            when 'caisse' then m.droit_caisse
            else false
          end
  )
$$;

comment on function public.client_du_dossier(uuid, text) is
  'Vrai si l''appelant a un accès à ce dossier qui porte ce droit (« ventes », « banque », « caisse », ou « membre » pour un accès quelconque) ; tout autre mot rend faux. Ne lit que memberships.';

-- Le prédicat de la caisse : le cabinet du dossier, ou un accès qui porte le droit « Caisse ».
create function public.gere_la_caisse(p_dossier_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'caisse')
$$;

comment on function public.gere_la_caisse(uuid) is
  'Le cabinet du dossier (admin_du_dossier), ou un accès client qui porte le droit « Caisse » (ligne 26.6, étape C10).';

-- Le corps de la migration `droits_des_acces_clients`, au caractère près, plus la clé `caisse`.
create or replace function public.droits_sur_le_dossier(p_dossier_id uuid) returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  select jsonb_build_object(
    'cabinet', public.admin_du_dossier(p_dossier_id),
    'membre', public.client_du_dossier(p_dossier_id, 'membre'),
    'ventes', public.gere_les_ventes(p_dossier_id),
    'banque', public.gere_la_banque(p_dossier_id),
    'caisse', public.gere_la_caisse(p_dossier_id)
  )
$$;

comment on function public.droits_sur_le_dossier(uuid) is
  'Les droits de l''appelant sur ce dossier : {cabinet, membre, ventes, banque, caisse}. N''écrit rien.';

-- ══ 4. Changer les droits d'un accès : la forme à quatre ══════════
-- La forme à trois paramètres, celle que l'onglet Accès appelle aujourd'hui : un appel de la forme à quatre, « Caisse »
-- nul donc inchangé — un seul corps écrit `memberships`, et ses refus sont ceux de la forme à quatre. Écrite AVANT elle :
-- plpgsql résout l'appel à l'exécution, et la forme à quatre reste la dernière définition du nom dans le texte (celle que
-- les gardes de l'export relisent, `update public.memberships` compris).
create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  return public.changer_droits_acces(p_membership_id, p_ventes, p_banque, null::boolean);
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean) is
  'La forme à trois paramètres de changer_droits_acces : « Ventes » et « Banque », « Caisse » inchangé — un appel de la forme à quatre, qui seule écrit memberships (ligne 26.6, étape C10).';

-- Le corps de la forme à trois (la migration `droits_des_acces_clients`), plus « Caisse » : les mêmes refus dans le même
-- ordre — l'appelant qui n'est pas le cabinet du dossier de l'accès, ou un accès qui n'existe pas (42501, les mêmes mots) ;
-- aucun droit donné (22023, les trois mots) ; l'accès retiré entre la lecture et l'écriture (P0002). UN DROIT NUL EST UN
-- DROIT INCHANGÉ. Elle n'écrit que les trois colonnes, et rend l'accès tel que l'écriture l'a laissé ; les gardes parlent
-- après elle (« Ventes » sur un dossier basculé, « Caisse » sur un dossier exclu).
create function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean, p_caisse boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_dossier uuid;
  v_acces public.memberships;
begin
  select m.dossier_id into v_dossier from public.memberships m where m.id = p_membership_id;
  if v_dossier is null or not public.admin_du_dossier(v_dossier) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_ventes is null and p_banque is null and p_caisse is null then
    raise exception 'Aucun droit à changer : précise « Ventes », « Banque » ou « Caisse ».' using errcode = '22023';
  end if;
  update public.memberships m
     set droit_ventes = coalesce(p_ventes, m.droit_ventes),
         droit_banque = coalesce(p_banque, m.droit_banque),
         droit_caisse = coalesce(p_caisse, m.droit_caisse)
   where m.id = p_membership_id and m.dossier_id = v_dossier
  returning m.* into v_acces;
  if not found then
    raise exception 'Cet accès vient d''être retiré : il n''a plus de droits à changer.' using errcode = 'P0002';
  end if;
  return v_acces;
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean, boolean) is
  'Change les droits « Ventes », « Banque » et « Caisse » d''un accès client — un droit nul reste tel quel. Réservée au cabinet du dossier de l''accès (42501, aussi pour un accès qui n''existe pas) ; n''écrit que ces trois colonnes ; rend l''accès tel que l''écriture l''a laissé (ligne 26.6, étape C10).';

-- ══ 5. « Caisse » ne se porte que sur un dossier exonéré de TVA ou en franchise en base ══════════
-- Le patron de `garder_droit_ventes`. APRÈS la RLS : la policy d'insertion a déjà jugé l'auteur (le cabinet du dossier),
-- et la garde ne dit rien du dossier à qui la policy refuse ; aux droits du propriétaire, elle lit le statut quel que
-- soit l'appelant. La clé étrangère du dossier passe avant elle (l'ordre des noms) : un dossier qui n'existe pas se dit
-- 23503, comme hier.
create function public.garder_droit_caisse() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_statut text;
begin
  -- Seule « Caisse » qui ARRIVE sur un accès se juge : portée à son insertion, cochée sur un accès qui ne la portait pas,
  -- ou emportée vers un autre dossier. Décocher, ou changer « Ventes » ou « Banque » d'un accès qui la porte déjà sur son
  -- dossier, passe.
  if not new.droit_caisse then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.droit_caisse and new.dossier_id = old.dossier_id then
    return null;
  end if;
  -- La restauration : le super-administrateur réinsère un accès tel qu'il a été, sa case comprise. Sa mise à jour, non.
  if tg_op = 'INSERT' and public.is_super_admin() then
    return null;
  end if;
  -- Le statut de TVA du dossier, verrouillé en partage jusqu'à la fin de cette écriture : un changement de statut déjà
  -- engagé se lit ici, sur sa valeur neuve ; un changement qui suit attend, puis voit cet accès
  -- (garder_statut_tva_de_la_caisse). Un dossier introuvable ne vaut pas un dossier exclu.
  select d.statut_tva into v_statut from public.dossiers d where d.id = new.dossier_id for share;
  if v_statut is distinct from 'exonere' and v_statut is distinct from 'franchise' then
    raise exception 'Le droit « Caisse » suppose un dossier exonéré de TVA ou en franchise en base, ce que le statut de ce dossier ne dit pas : sa caisse reste tenue par le cabinet.'
      using errcode = '23514';
  end if;
  return null;
end
$$;

comment on function public.garder_droit_caisse() is
  'Le droit « Caisse » ne se porte que sur un accès d''un dossier exonéré de TVA ou en franchise en base (ligne 26.6, étape C10 ; CAISSE2-Q3 ; CGI, art. 286, II, 2) : porté à l''insertion, coché ou emporté vers un autre dossier, il se refuse ailleurs (23514), pour tout auteur ; seule l''insertion du super-administrateur passe (la restauration). Le statut se lit for share. Après la RLS, aux droits du propriétaire ; aucun rôle de l''API ne l''exécute.';

create trigger memberships_droit_caisse
  after insert or update of droit_caisse, dossier_id on public.memberships
  for each row execute function public.garder_droit_caisse();

-- ══ 6. Le statut de TVA d'un dossier dont un accès porte « Caisse » ══════════
-- APRÈS la mise à jour, sur le statut tel qu'il est écrit : `deduire_assujetti_tva` le déduit d'`assujetti_tva` quand seul
-- le booléen change (une fenêtre d'avant le statut), et un déclencheur restreint à la colonne `statut_tva` ne verrait pas
-- ce chemin — la clause `when` juge le statut, quel que soit le chemin qui l'a changé. Les accès se lisent après le
-- verrou de la ligne du dossier, que cette mise à jour a pris, chaque instruction sur un instantané neuf : une case
-- cochée par une écriture validée se voit ; une case qui arrive ensuite attend ce verrou (garder_droit_caisse).
create function public.garder_statut_tva_de_la_caisse() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Seul ce qui QUITTE les deux statuts exclus se juge (CAISSE2-Q3, (B)) : passer de l'exonération à la franchise, ou
  -- l'inverse, passe ; un dossier qui n'était ni l'un ni l'autre n'a rien à garder.
  if old.statut_tva is distinct from 'exonere' and old.statut_tva is distinct from 'franchise' then
    return null;
  end if;
  if new.statut_tva is not distinct from 'exonere' or new.statut_tva is not distinct from 'franchise' then
    return null;
  end if;
  if exists (select 1 from public.memberships m where m.dossier_id = old.id and m.droit_caisse) then
    raise exception 'Un accès de ce dossier porte la case « Caisse », qui suppose un dossier exonéré de TVA ou en franchise en base : décoche-la d''abord.'
      using errcode = '23514';
  end if;
  return null;
end
$$;

comment on function public.garder_statut_tva_de_la_caisse() is
  'Un dossier dont un accès porte « Caisse » ne quitte pas l''ensemble des statuts exclus du système de caisse — exonéré, franchise en base — (ligne 26.6, étape C10 ; CAISSE2-Q3) : passer de l''un à l''autre passe ; décocher la case d''abord. Après la mise à jour, sur le statut écrit, quel que soit le chemin ; aux droits du propriétaire ; aucun rôle de l''API ne l''exécute.';

create trigger dossiers_statut_tva_de_la_caisse
  after update on public.dossiers
  for each row when (old.statut_tva is distinct from new.statut_tva)
  execute function public.garder_statut_tva_de_la_caisse();

-- ══ 7. La nature des recettes du client, jugée à l'écriture ══════════
-- Une catégorie de produit (classe 7) du dossier, ou commune — ce qu'`enregistrer_operation_caisse` exige de la catégorie
-- d'une recette. APRÈS la RLS, comme les gardes des accès. L'insertion du super-administrateur passe : la restauration
-- écrit le dossier avant ses catégories ; la saisie du client la juge alors à son usage.
create function public.garder_categorie_recettes_client() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.categorie_recettes_client is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.categorie_recettes_client is not distinct from old.categorie_recettes_client then
    return null;
  end if;
  if tg_op = 'INSERT' and public.is_super_admin() then
    return null;
  end if;
  if not exists (select 1 from public.categories c
                  where c.id = new.categorie_recettes_client and (c.dossier_id is null or c.dossier_id = new.id)
                    and c.compte_comptable ~ '^7[0-9]{2}') then
    raise exception 'La nature des recettes en espèces du client est une catégorie de produit (classe 7) de ce dossier, ou commune : celle-ci ne l''est pas.'
      using errcode = '23514';
  end if;
  return null;
end
$$;

comment on function public.garder_categorie_recettes_client() is
  'La nature des recettes en espèces du client (dossiers.categorie_recettes_client ; ligne 26.6, étape C10 ; CAISSE2-Q2) est une catégorie de produit (classe 7) du dossier, ou commune, ou rien (23514). L''insertion du super-administrateur passe (la restauration). Après la RLS, aux droits du propriétaire ; aucun rôle de l''API ne l''exécute.';

create trigger dossiers_categorie_recettes_client
  after insert or update of categorie_recettes_client on public.dossiers
  for each row execute function public.garder_categorie_recettes_client();

-- ══ 8. Qui écrit la caisse : le client ══════════
-- Le corps de la migration `caisse`, au caractère près, plus le client (CAISSE-Q1, (B) ; CAISSE2-Q3, (B)) : « client » pour
-- un accès « Caisse » d'un dossier exonéré de TVA ou en franchise en base, le statut relu `for share` — il ne change pas
-- sous la saisie ; un accès « Caisse » d'un dossier qui ne l'est plus — une restauration, puisque les gardes le
-- refusent ailleurs — se refuse, défensif. Le cabinet d'abord : un super-administrateur reste le cabinet. Aucun rôle de
-- l'API ne l'exécute.
create or replace function public.qui_ecrit_la_caisse(p_dossier_id uuid) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_statut text;
begin
  if p_dossier_id is not null and exists (select 1 from public.dossiers d where d.id = p_dossier_id)
     and public.admin_du_dossier(p_dossier_id) then
    return 'cabinet';
  end if;
  if p_dossier_id is not null and public.client_du_dossier(p_dossier_id, 'caisse') then
    select d.statut_tva into v_statut from public.dossiers d where d.id = p_dossier_id for share;
    if v_statut in ('exonere', 'franchise') then
      return 'client';
    end if;
    raise exception 'La saisie des espèces depuis ton espace suppose un dossier exonéré de TVA ou en franchise en base : ton cabinet tient ta caisse.'
      using errcode = '23514';
  end if;
  raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
end
$$;

comment on function public.qui_ecrit_la_caisse(uuid) is
  'Qui écrit la caisse de ce dossier (ligne 26.6, étapes C1 et C10) : « cabinet » (admin_du_dossier) ; « client » pour un accès « Caisse » d''un dossier exonéré de TVA ou en franchise en base, le statut relu for share ; sinon 42501 « Accès refusé à ce dossier. », un dossier qui n''existe pas sous les mêmes mots — et 23514 pour un accès « Caisse » d''un dossier qui ne l''est plus. Aucun rôle de l''API ne l''exécute.';

-- ══ 9. Enregistrer une opération de caisse : la saisie du client ══════════
-- Le corps de la migration `paiement_par_la_caisse`, au caractère près, plus la saisie du client, dans l'ordre de ses
-- refus (l'en-tête) : la nature d'une recette, celle que le cabinet a fixée ; l'ensemble du jour, sans numéro de
-- facture — `caisse_du_client` ne le lui rend pas ; l'écriture, que la base compose — le client ne lit pas le plan du
-- dossier — puis juge comme celle du cabinet. Le cabinet : rien de changé. `remplacer_operation_caisse` et
-- `enregistrer_operations_de_caisse`, qui l'appellent, suivent d'elles-mêmes ; le client y passe une catégorie et une
-- écriture nulles.
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
  v_categorie_du_client uuid;
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
  v_ecritures jsonb;
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
  -- (C10) Pour le client, celle que le cabinet a fixée pour le dossier (CAISSE2-Q2, (B)) : il n'en choisit aucune, et
  -- une nature qui n'est plus une catégorie de produit du dossier le renvoie à son cabinet.
  if p_genre = 'recette' and v_origine = 'client' then
    if p_categorie_id is not null then
      raise exception 'La nature de tes recettes en espèces est celle que ton cabinet a fixée pour ton dossier : ta saisie n''en choisit pas.'
        using errcode = '22023';
    end if;
    select d.categorie_recettes_client into v_categorie_du_client from public.dossiers d where d.id = p_dossier_id;
    if v_categorie_du_client is null then
      raise exception 'Ton cabinet n''a pas fixé la nature de tes recettes en espèces : demande-lui de la poser.' using errcode = '22023';
    end if;
    select c.* into v_categorie from public.categories c
     where c.id = v_categorie_du_client and (c.dossier_id is null or c.dossier_id = p_dossier_id);
    if not found or v_categorie.compte_comptable is null or v_categorie.compte_comptable !~ '^7[0-9]{2}' then
      raise exception 'La nature que ton cabinet a fixée pour tes recettes en espèces n''est plus une catégorie de produit de ton dossier : demande-lui de la corriger.'
        using errcode = '22023';
    end if;
  elsif p_genre = 'recette' then
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
      -- (C10) Au client, sans le numéro de la facture : caisse_du_client ne le lui rend pas.
      if v_origine = 'client' then
        raise exception 'Des espèces d''une facture de ce jour ont été enregistrées depuis ta lecture : relis ta caisse.'
          using errcode = '22023';
      end if;
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
        -- (C10) Au client, sans le numéro de la facture.
        if v_origine = 'client' then
          raise exception 'Des espèces d''une facture que ta lecture comptait ne sont pas dans la caisse de ce jour : relis ta caisse.'
            using errcode = '22023';
        end if;
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
  -- (C10) Le client ne lit pas le plan du dossier : sa saisie n'envoie aucune écriture, et la base pose celle qu'elle
  -- compose — celle qu'elle attend du cabinet, ci-dessous — avant de la juger comme celle du cabinet.
  if v_origine = 'client' then
    if coalesce(jsonb_typeof(p_ecritures), 'null') <> 'null' then
      raise exception 'Une saisie depuis ton espace n''envoie pas d''écriture : la base compose la sienne.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('compte', a.compte, 'sens', a.sens, 'montant', round(a.centimes::numeric / 100, 2))),
                    '[]'::jsonb)
      into v_ecritures
      from (values
        (v_caisse, case when p_genre = 'prelevement' or p_montant < 0 then 'credit' else 'debit' end, v_centimes),
        (case when p_genre = 'recette' then v_categorie.compte_comptable else v_dirigeant end,
         case when p_genre = 'prelevement' or p_montant < 0 then 'debit' else 'credit' end,
         v_centimes - v_tva),
        (v_collectee, case when p_montant < 0 then 'debit' else 'credit' end, v_tva)
      ) as a(compte, sens, centimes)
     where a.centimes > 0;
  else
    v_ecritures := p_ecritures;
  end if;
  if jsonb_typeof(v_ecritures) is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(v_ecritures) e(valeur)
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
      from jsonb_array_elements(v_ecritures) e(valeur)
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, centimes::numeric from attendues
                     except all select compte, sens, centimes from recues)
     and not exists (select 1 from jsonb_array_elements(v_ecritures) e(valeur)
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
  values (v_id, p_dossier_id, p_genre, p_date, p_montant, v_categorie.id, p_taux_tva,
          case when p_genre = 'recette' then v_recus end, null, v_origine, null, auth.uid())
  returning * into v_operation;
  insert into public.ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, operation_caisse_id)
  select p_dossier_id, p_date, e.valeur ->> 'compte', v_libelle, (e.valeur ->> 'montant')::numeric, e.valeur ->> 'sens',
         'proposee', v_id
    from jsonb_array_elements(v_ecritures) e(valeur);
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

comment on function public.enregistrer_operation_caisse(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb) is
  'Enregistre une opération de caisse — une recette (le total d''un jour), un apport, un prélèvement — avec son écriture, d''un tenant (ligne 26.6, étapes C1, C8 et C10) : l''accès par qui_ecrit_la_caisse avant toute lecture, puis les refus dans l''ordre que src/lib/caisse.ts redit. Le cabinet envoie l''écriture, recomposée et comparée en multiensemble ; le client n''envoie ni catégorie ni écriture : la nature de ses recettes est celle que le cabinet a fixée (dossiers.categorie_recettes_client), et la base compose son écriture.';

-- ══ 10. Ce que le client lit de sa caisse ══════════
-- Le § 4 de la conception, présenté au cabinet : à un accès « Caisse », toutes les opérations de la caisse de son
-- dossier, celles du cabinet et les retirées comprises, chaque colonne — rien d'autre : ni le brouillon, ni le relevé, ni
-- les encaissements, ni les exercices validés. Une seconde policy PERMISSIVE, à côté de celle du cabinet : aucune
-- écriture directe ne s'ouvre, la table n'ayant d'insertion que pour la restauration.
create policy operations_caisse_lecture_caisse on public.operations_caisse
  for select to authenticated
  using (public.client_du_dossier(dossier_id, 'caisse'));

-- La caisse jour par jour, pour l'écran du client (« Ma caisse », étape C12) : ce que la policy ne lui ouvre pas, en
-- totaux. Une ligne par jour de l'année qui porte un flux — et le 1er janvier quand l'année reçoit un report non nul :
-- `report`, le solde des années d'avant ; `ouverture`, les à-nouveaux du compte de la caisse ; `operations`, les
-- opérations non retirées (un prélèvement en moins) ; `releve`, les mouvements du relevé classés sur le compte de la
-- caisse (un versement en banque en moins, un retrait pour elle en plus), jamais leur libellé ; `especes_des_factures`,
-- les espèces sans mouvement des factures sources et leurs contre-passations ; `encaissements_du_jour`, les
-- identifiants qu'une recette de ce jour reconnaît — ces espèces et les paiements par la caisse de pièces de vente,
-- l'ensemble qu'`enregistrer_operation_caisse` exige, triés —, jamais un numéro ni un client ; `solde`, la caisse à la fin
-- du jour ; `fige`, vrai pour un jour que la validation d'un exercice fige, la frontière jugée par la base. Les flux, et
-- leur borne à l'ouverture du compte de la caisse, sont ceux de `premier_jour_negatif_de_la_caisse`. Le prix d'un solde
-- juste, que l'onglet Accès dira : à un accès « Caisse » sans « Banque », le total du jour de ce que le relevé a versé
-- depuis la caisse ou retiré pour elle ; sans « Ventes », le total des espèces de ses factures.
create function public.caisse_du_client(p_dossier_id uuid, p_annee integer)
returns table (jour date, report numeric, ouverture numeric, operations numeric, releve numeric,
               especes_des_factures numeric, encaissements_du_jour uuid[], solde numeric, fige boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caisse text;
  v_premier date;
  v_frontiere date;
begin
  -- 1. L'accès, avant toute lecture : le cabinet du dossier, ou un accès qui porte « Caisse ». Un dossier qui n'existe pas,
  --    sous les mêmes mots, même pour le super-administrateur (qu'`admin_du_dossier` dit cabinet de tout dossier) — le
  --    patron de `qui_ecrit_la_caisse`.
  if p_dossier_id is null or not exists (select 1 from public.dossiers d where d.id = p_dossier_id)
     or not public.gere_la_caisse(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2. L'année, celle d'une opération de caisse.
  if p_annee is null or p_annee < 2000 or p_annee > 9999 then
    raise exception 'L''année d''une caisse se lit de 2000 à 9999.' using errcode = '22023';
  end if;
  v_caisse := public.compte_du_role(p_dossier_id, 'caisse');
  -- La borne : l'ouverture du compte de la caisse, s'il en a une ; ce qui la précède est dans les comptes repris.
  select min(a.date) into v_premier from public.a_nouveaux a where a.dossier_id = p_dossier_id and a.compte = v_caisse;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  return query
  with flux (le_jour, la_source, le_montant) as (
    -- L'ouverture : les à-nouveaux du compte de la caisse.
    select a.date, 'ouverture'::text, case when a.sens = 'debit' then a.montant else -a.montant end
      from public.a_nouveaux a
     where a.dossier_id = p_dossier_id and a.compte = v_caisse
    union all
    -- Les opérations non retirées.
    select o.date, 'operation'::text, case when o.genre = 'prelevement' then -o.montant else o.montant end
      from public.operations_caisse o
     where o.dossier_id = p_dossier_id and o.retire_le is null
    union all
    -- Les mouvements du relevé classés sur le compte de la caisse.
    select l.date, 'releve'::text, -l.montant
      from public.lignes_bancaires l
     where l.dossier_id = p_dossier_id and l.compte_bilan = v_caisse
    union all
    -- Les espèces des factures sources : un encaissement en espèces sans mouvement, ou la contre-passation sans
    -- mouvement d'un tel encaissement.
    select e.date_encaissement, 'facture'::text, e.montant
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
      left join public.encaissements_factures o on o.id = e.annule_id
     where e.dossier_id = p_dossier_id and f.source_de_la_vente and e.retire_le is null and e.ligne_bancaire_id is null
       and case when e.annule_id is null then e.moyen = 'especes'
                else o.ligne_bancaire_id is null and o.moyen = 'especes' end
  ), comptes as (
    select x.le_jour, x.la_source, x.le_montant from flux x where v_premier is null or x.le_jour >= v_premier
  ), avant as (
    select coalesce(sum(c.le_montant), 0) as le_report from comptes c where c.le_jour < make_date(p_annee, 1, 1)
  ), jours as (
    select c.le_jour from comptes c where c.le_jour between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
    union
    select make_date(p_annee, 1, 1) from avant v where v.le_report <> 0
  ), par_jour as (
    select j.le_jour,
           case when j.le_jour = make_date(p_annee, 1, 1) then v.le_report else 0 end as le_report,
           coalesce(sum(c.le_montant) filter (where c.la_source = 'ouverture'), 0) as l_ouverture,
           coalesce(sum(c.le_montant) filter (where c.la_source = 'operation'), 0) as les_operations,
           coalesce(sum(c.le_montant) filter (where c.la_source = 'releve'), 0) as le_releve,
           coalesce(sum(c.le_montant) filter (where c.la_source = 'facture'), 0) as les_especes
      from jours j
      cross join avant v
      left join comptes c on c.le_jour = j.le_jour
     group by j.le_jour, v.le_report
  )
  select p.le_jour, p.le_report, p.l_ouverture, p.les_operations, p.le_releve, p.les_especes,
         -- L'ensemble du jour, celui qu'`enregistrer_operation_caisse` lit.
         array(
           select r.id from (
             select e.id
               from public.encaissements_factures e
               join public.factures_emises f on f.id = e.facture_id
               left join public.encaissements_factures o on o.id = e.annule_id
              where e.dossier_id = p_dossier_id and e.date_encaissement = p.le_jour and f.source_de_la_vente
                and e.retire_le is null and e.ligne_bancaire_id is null
                and case when e.annule_id is null then e.moyen = 'especes'
                         else o.ligne_bancaire_id is null and o.moyen = 'especes' end
             union all
             select o.id
               from public.operations_caisse o
               join public.pieces q on q.id = o.piece_id
              where o.dossier_id = p_dossier_id and o.date = p.le_jour and o.genre = 'paiement' and o.retire_le is null
                and q.type_piece = 'vente'
           ) r order by r.id),
         sum(p.le_report + p.l_ouverture + p.les_operations + p.le_releve + p.les_especes) over (order by p.le_jour),
         v_frontiere is not null and p.le_jour <= v_frontiere
    from par_jour p
   order by p.le_jour;
end
$$;

comment on function public.caisse_du_client(uuid, integer) is
  'La caisse d''un dossier jour par jour, pour son client (ligne 26.6, étape C10) : l''accès gere_la_caisse avant toute lecture (42501), l''année de 2000 à 9999 (22023) ; puis le report, l''ouverture, les opérations, le relevé, les espèces des factures sources et les identifiants qu''une recette du jour reconnaît, le solde et le jour figé — des totaux, jamais un libellé, un numéro, un nom ni une pièce. N''écrit rien.';

-- ══ 11. Les droits d'exécution ══════════
-- Les trois fonctions neuves qu'un compte connecté appelle (chacune contrôle l'accès elle-même, ou ne lit que l'appelant),
-- ni l'anonyme ni PUBLIC ; les trois gardes, par personne. Les cinq fonctions remplacées gardent les leurs.
revoke execute on function public.gere_la_caisse(uuid) from public, anon;
grant execute on function public.gere_la_caisse(uuid) to authenticated;
revoke execute on function public.changer_droits_acces(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.changer_droits_acces(uuid, boolean, boolean, boolean) to authenticated;
revoke execute on function public.caisse_du_client(uuid, integer) from public, anon;
grant execute on function public.caisse_du_client(uuid, integer) to authenticated;
revoke execute on function public.garder_droit_caisse() from public, anon, authenticated;
revoke execute on function public.garder_statut_tva_de_la_caisse() from public, anon, authenticated;
revoke execute on function public.garder_categorie_recettes_client() from public, anon, authenticated;
