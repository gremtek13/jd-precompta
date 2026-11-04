-- LA CAISSE : CORRIGER UN PAIEMENT EN ESPÈCES D'UN SEUL GESTE (C12B-Q1 ; ligne 26.6 ; MVP-D2). La décision : HISTORIQUE.md,
-- « VINGT-QUATRE RÉPONSES DU CABINET (PAGE DES ARBITRAGES, RELUE LE 04/11/2026) » — C12B-Q1, contre la recommandation,
-- « Un seul geste « Corriger » (une migration) » : un paiement en espèces d'une pièce dont la date ou le montant est faux se
-- remplace en une fois, au lieu de « retirer, puis payer de nouveau ». Le récit : « LA CAISSE : CORRIGER UN PAIEMENT EN
-- ESPÈCES D'UN SEUL GESTE (C12B-Q1) (PRÉPARÉE, PAS APPLIQUÉE) ». Préparée sous une version PROVISOIRE, après les migrations
-- de la caisse en base depuis le 02/11/2026 (`paiement_par_la_caisse`, `caisse_du_client`), qu'elle suppose et ne change pas.
--
-- POURQUOI UNE FONCTION NEUVE. `remplacer_operation_caisse` (étape C1b) juge la nouvelle opération par
-- `enregistrer_operation_caisse`, qui ne connaît pas le genre `paiement` : un paiement ne se remplace pas par un paiement. Le
-- paiement d'une pièce ne s'écrit que par `regler_piece_par_la_caisse` (étape C8), dont la branche « client » s'ouvre depuis
-- `caisse_du_client` (étape C10). L'étendre aurait changé le corps et les refus d'une fonction en production, que « Ma
-- caisse » et l'onglet Caisse appellent ; une fonction à part ne touche à rien d'hier.
--
-- CE QU'ELLE POSE : `remplacer_paiement_par_la_caisse(dossier, opération, date, montant)`, d'un seul geste, tout ou rien —
-- le paiement d'une pièce par la caisse remplacé par un paiement de la MÊME pièce, à une autre date ou d'un autre montant :
--   1. l'ancien paiement jugé par les cinq premiers refus du retrait (`retirer_operation_caisse`), sous leurs mots — le client
--      ne corrige que ses propres paiements —, puis son genre : un paiement d'une pièce ;
--   2. le nouveau jugé par `regler_piece_par_la_caisse` ELLE-MÊME, l'ancien retiré, dans une sous-transaction défaite aussitôt
--      (un code d'erreur à elle, « JDC12 », qu'aucune fonction ne lève ailleurs) — le patron de `remplacer_operation_caisse`
--      (« JDC1B ») : aucun de ses refus n'est recopié ici, et ce qu'elle apprendra, la correction le suit sans changer ;
--   3. le nouveau écrit tel qu'elle l'a écrit, son lien en plus (`remplace_id` : la correction retient le paiement qu'elle
--      remplace), sous son propre réglage — aucune ligne du brouillon : sa contrepartie s'écrit avec les écritures de la
--      pièce, par l'application, comme celle de tout paiement par la caisse ;
--   4. l'ancien retiré par `retirer_operation_caisse` ELLE-MÊME, qui retire avec lui toutes les lignes du brouillon qui le
--      citent (sa contrepartie) et juge la caisse quand il apportait des espèces : le nouveau est déjà là, la caisse se juge
--      sur ce que la correction laisse.
--
-- LES REFUS, DANS L'ORDRE (que src/lib/correctionDuPaiement.ts redit avant le clic, sous les mêmes mots) :
--   1. l'accès, avant toute lecture (`qui_ecrit_la_caisse` : 42501 ; l'accès « Caisse » d'un dossier qui n'est plus exonéré
--      ni en franchise, 23514) ;
--   2. l'opération, de ce dossier (P0002) ;
--   3. pour un accès du client, ses propres paiements seulement : celui du cabinet, celui d'un autre accès (42501) ;
--   4. une opération déjà retirée ou remplacée depuis la lecture (P0002) ;
--   5. la frontière de la validation, à la date de l'ancien (23514) ;
--   6. une opération qui n'est pas le paiement d'une pièce (22023) ;
--   7. ceux de `regler_piece_par_la_caisse` sur le nouveau, la pièce de l'ancien, dans son ordre et sous ses mots : la
--      trésorerie, la pièce, son type, l'exemplaire d'une facture source, la date (l'ouverture, la frontière à la date du
--      nouveau), le montant, le sens, le plafond d'une pièce validée, le reste au centime (au client sans montant), enfin la
--      caisse jamais négative quand le nouveau fait sortir des espèces (23514, le geste `paiement`) ;
--   8. la caisse jamais négative, quand l'ancien apportait des espèces que le nouveau ne rend pas (23514, sous les mots du
--      retrait de l'ancien, `retrait_paiement`).
-- La caisse se juge sur ce que la correction laisse : une correction qui ne passerait sous zéro qu'un instant, entre le
-- retrait de l'ancien et l'écriture du nouveau, passe.
--
-- CE QU'ELLE NE CHANGE PAS : aucune table, colonne, contrainte, policy ni déclencheur ; aucune fonction d'hier — ni les
-- gardes de la caisse (`garder_operation_caisse`, `garder_ecriture_de_caisse`, `garder_la_caisse`), qui la jugent comme
-- tout geste, ni la garde de la pièce payée, ni le filet de la validation (`valider_exercice` refuse un paiement vivant de
-- l'exercice dont la contrepartie manque : le nouveau, jusqu'à ce que les écritures de la pièce soient régénérées). Les
-- moteurs ne comptent que les paiements non retirés : l'ancien sort de tout compte, le nouveau y entre, une seule fois.
-- Aucune donnée lue ni écrite d'avance : NEUTRE jusqu'au premier appel.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : ni objet, ni donnée, ni droit d'un objet qui
-- reste ; ses `revoke` ne retirent que les droits que Postgres donne d'office à la fonction qu'elle crée — le patron des
-- migrations de la caisse. Son corps ne retire aucune ligne lui-même : il appelle la fonction du retrait. Aucune barre
-- oblique inverse, aucun retour chariot. Son retour arrière, donné à part (`supabase/preparees/retour/`), retire la
-- fonction : un retrait d'objet, à accorder par le cabinet, et à coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la version
-- que porte sa ligne d'historique, texte inchangé ; le drapeau `CORRECTION_DU_PAIEMENT_EXPORTEE`
-- (src/lib/correctionDuPaiement.ts) se lève avec lui, et les deux écrans (« Mes pièces », la fiche d'une pièce) le suivent.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une base sans les migrations de la caisse qu'elle suppose (la dernière,
-- `caisse_du_client`) ; une fonction qu'elle appelle, ou dont elle suppose les refus et les gardes, qui ne serait plus celle
-- qu'elle suppose — à l'empreinte de son corps, les retours chariot d'un collage écartés, relue sur la réplique de la
-- production du 04/11/2026 (170 migrations) ; et une base où manquerait ce qu'elle lit et écrit : le genre `paiement` et sa
-- pièce, l'unicité du remplacement, les colonnes de l'opération.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'remplacer_paiement_par_la_caisse') then
    raise exception 'La migration correction_du_paiement_par_la_caisse est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regprocedure('public.caisse_du_client(uuid, integer)') is null
     or to_regprocedure('public.regler_piece_par_la_caisse(uuid, uuid, date, numeric)') is null then
    raise exception 'Les migrations paiement_par_la_caisse et caisse_du_client ne sont pas en base : les appliquer d''abord, puis celle-ci.';
  end if;
  for v_attendue in select * from (values
      -- Celles qu'elle appelle.
      ('qui_ecrit_la_caisse', 'public.qui_ecrit_la_caisse(uuid)', 'c8f8c13f116f2a382ed2ca321ba7e804'),
      ('cle_validation', 'public.cle_validation(uuid)', 'bcbb03363036aa6aa037c0b829e3382f'),
      ('frontiere_validation', 'public.frontiere_validation(uuid)', '24a04846471ec5e8cdbae6f3b9f4a2e8'),
      ('exercice_fige', 'public.exercice_fige(uuid, integer)', 'b70cbdd4a870f5e17e8e4c6851506bdc'),
      ('regler_piece_par_la_caisse', 'public.regler_piece_par_la_caisse(uuid, uuid, date, numeric)', 'c8b8e39eb6fac46f386673e2d4e775e0'),
      ('retirer_operation_caisse', 'public.retirer_operation_caisse(uuid, uuid)', '459ca42980e05044cb30d5d464223775'),
      -- Celles dont elle suppose les mots et le compte de la caisse.
      ('premier_jour_negatif_de_la_caisse', 'public.premier_jour_negatif_de_la_caisse(uuid)', '3e04d7e969c9614be2d9eda3415f0da2'),
      ('texte_caisse_negative', 'public.texte_caisse_negative(text, numeric, date, numeric)', 'aa7e7a933ac8ce8afe78209dd32607ab'),
      -- Les gardes qui la jugent comme tout geste, et le filet de la validation.
      ('garder_operation_caisse', 'public.garder_operation_caisse()', '3bc037a8e7ae542ef880870256e05dd1'),
      ('garder_ecriture_de_caisse', 'public.garder_ecriture_de_caisse()', '9db99bb96816b57669a688a1a8dc7b71'),
      ('garder_la_caisse', 'public.garder_la_caisse()', '5c9cc864b19928249626604efcc62246'),
      ('garder_piece_payee_par_la_caisse', 'public.garder_piece_payee_par_la_caisse()', 'f23d930eb520580ec9d8eb82fad4cfeb'),
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
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.operations_caisse'::regclass
                  and c.conname = 'operations_caisse_genre' and pg_get_constraintdef(c.oid) like '%''paiement''%')
     or not exists (select 1 from pg_constraint c where c.conrelid = 'public.operations_caisse'::regclass
                     and c.conname = 'operations_caisse_piece'
                     and pg_get_constraintdef(c.oid) = 'CHECK (((genre = ''paiement''::text) = (piece_id IS NOT NULL)))')
     or not exists (select 1 from pg_constraint c where c.conrelid = 'public.operations_caisse'::regclass
                     and c.conname = 'operations_caisse_un_remplacement' and c.contype = 'u') then
    raise exception 'La table de la caisse n''a pas le genre « paiement » et sa pièce, ou l''unicité de son remplacement : cette base n''est pas celle que la migration suppose.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped and (a.attrelid, a.attname) in (
     ('public.operations_caisse'::regclass, 'id'), ('public.operations_caisse'::regclass, 'dossier_id'),
     ('public.operations_caisse'::regclass, 'genre'), ('public.operations_caisse'::regclass, 'date'),
     ('public.operations_caisse'::regclass, 'piece_id'), ('public.operations_caisse'::regclass, 'origine'),
     ('public.operations_caisse'::regclass, 'cree_par'), ('public.operations_caisse'::regclass, 'remplace_id'),
     ('public.operations_caisse'::regclass, 'retire_le'), ('public.operations_caisse'::regclass, 'retire_par'),
     ('public.pieces'::regclass, 'id'));
  if v_nombre <> 11 then
    raise exception 'Une colonne que cette migration lit ou écrit manque (% sur 11) : cette base n''est pas celle que la migration suppose.', v_nombre;
  end if;
end
$garde$;

-- ══ 1. Corriger le paiement d'une pièce par la caisse ══════════
-- Le patron de `remplacer_operation_caisse` : l'accès annoncé avant toute lecture, les verrous du retrait, l'ancien jugé par
-- les cinq premiers refus du retrait — leurs mots au caractère près, que src/lib/correctionDuPaiement.test.ts confronte à
-- ceux de `retirer_operation_caisse` —, puis son genre. Le nouveau, jugé et écrit par `regler_piece_par_la_caisse` dans une
-- sous-transaction défaite aussitôt, l'ancien retiré : ses refus remontent tels quels, et sinon on garde la ligne qu'elle a
-- écrite pour l'écrire de nouveau, `remplace_id` en plus. Puis l'ancien se retire par sa fonction. La pièce reste verrouillée
-- en partage jusqu'à la fin : son type, sa désignation et son montant ne changent pas sous la correction (le verrou que
-- `regler_piece_par_la_caisse` prend dans la sous-transaction tombe avec elle).
create function public.remplacer_paiement_par_la_caisse(p_dossier_id uuid, p_operation_id uuid, p_date date, p_montant numeric)
returns public.operations_caisse
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origine text;
  v_ancien public.operations_caisse;
  v_nouveau public.operations_caisse;
  v_frontiere date;
begin
  -- 1. L'accès, avant toute lecture ; puis les verrous du retrait : celui de la validation, partagé (la frontière lue ici est
  --    celle que les gardes liront), et celui de la caisse du dossier, exclusif (deux sessions qui corrigent, retirent ou
  --    paient sur la même caisse se suivent, et la seconde voit la première).
  v_origine := public.qui_ecrit_la_caisse(p_dossier_id);
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || p_dossier_id::text, 0));

  -- 2. L'ancien, de ce dossier, verrouillé.
  select o.* into v_ancien from public.operations_caisse o
   where o.id = p_operation_id and o.dossier_id = p_dossier_id
   for update;
  if not found then
    raise exception 'Cette opération n''est pas dans la caisse de ce dossier : relis ta caisse.' using errcode = 'P0002';
  end if;

  -- 3. Le client ne corrige que ses propres paiements, sous les mots de son retrait.
  if v_origine = 'client' and v_ancien.origine = 'cabinet' then
    raise exception 'Cette opération a été saisie par ton cabinet : demande-lui de la corriger.' using errcode = '42501';
  end if;
  if v_origine = 'client' and v_ancien.cree_par is distinct from auth.uid() then
    raise exception 'Cette opération a été saisie depuis un autre accès à ce dossier : demande à ton cabinet de la corriger.'
      using errcode = '42501';
  end if;

  -- 4. Une opération déjà retirée — ou remplacée : le remplacement la retire.
  if v_ancien.retire_le is not null then
    raise exception 'Cette opération a été retirée ou remplacée depuis ta lecture : relis ta caisse.' using errcode = 'P0002';
  end if;

  -- 5. La frontière de la validation, à la date de l'ancien ; celle du nouveau, `regler_piece_par_la_caisse` la juge.
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_ancien.date <= v_frontiere then
    raise exception '% : sa caisse ne change plus.',
      public.exercice_fige(p_dossier_id, extract(year from v_ancien.date)::integer) using errcode = '23514';
  end if;

  -- 6. Un paiement d'une pièce : une autre opération de la caisse se remplace par sa saisie (`remplacer_operation_caisse`).
  if v_ancien.genre is distinct from 'paiement' or v_ancien.piece_id is null then
    raise exception 'Seul le paiement d''une pièce par la caisse se corrige ainsi : une autre opération de la caisse se remplace.'
      using errcode = '22023';
  end if;

  -- La pièce de l'ancien, verrouillée en partage jusqu'à la fin de la correction.
  perform 1 from public.pieces p where p.id = v_ancien.piece_id for share;

  -- 7. Le nouveau, jugé et écrit par `regler_piece_par_la_caisse`, l'ancien retiré — sous son réglage, que la garde de la
  --    table exige, l'opération seule : la fonction ne lit pas le brouillon. Puis la sous-transaction se défait : l'ancien
  --    revient, le nouveau part, et leurs lignes avec eux.
  begin
    perform set_config('jd.caisse', v_ancien.id::text, true);
    update public.operations_caisse set retire_le = now(), retire_par = auth.uid()
     where id = v_ancien.id;
    perform set_config('jd.caisse', '', true);
    v_nouveau := public.regler_piece_par_la_caisse(p_dossier_id, v_ancien.piece_id, p_date, p_montant);
    raise exception 'Le paiement corrigé est jugé : il s''écrit maintenant avec son lien.' using errcode = 'JDC12';
  exception when sqlstate 'JDC12' then
    null;
  end;

  -- Le nouveau, tel que `regler_piece_par_la_caisse` l'a écrit, son lien en plus, sous son réglage, retiré aussitôt.
  v_nouveau.remplace_id := v_ancien.id;
  perform set_config('jd.caisse', v_nouveau.id::text, true);
  insert into public.operations_caisse select (v_nouveau).*;
  perform set_config('jd.caisse', '', true);

  -- 8. L'ancien, retiré par la fonction du retrait — ses lignes avec lui —, qui juge la caisse quand il apportait des
  --    espèces, sous les mots de son retrait : le nouveau déjà écrit, sur ce que la correction laisse. Les cinq refus qu'elle
  --    redirait, jugés ci-dessus sous les mêmes verrous, ne se lèvent plus.
  perform public.retirer_operation_caisse(p_dossier_id, v_ancien.id);
  return v_nouveau;
end
$$;

comment on function public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric) is
  'Corrige le paiement d''une pièce par la caisse d''un seul geste (ligne 26.6 ; C12B-Q1) : le nouveau, de la même pièce, jugé et écrit par regler_piece_par_la_caisse, portant remplace_id ; l''ancien retiré avec ses lignes par retirer_operation_caisse. Ses refus, dans l''ordre : l''accès (42501), l''opération de ce dossier (P0002), pour le client ses propres paiements seulement (42501), une opération déjà retirée ou remplacée (P0002), la frontière à la date de l''ancien (23514), une opération qui n''est pas le paiement d''une pièce (22023), ceux de regler_piece_par_la_caisse sur le nouveau, la caisse jamais négative sous les mots du retrait de l''ancien (23514). Une correction qui ne passe sous zéro qu''un instant passe.';

-- ══ 2. Les droits d'exécution ══════════
-- Au compte connecté (elle contrôle l'accès elle-même, avant toute lecture), ni à l'anonyme ni à PUBLIC : le cabinet et le
-- client passent par elle.
revoke execute on function public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric) from public, anon;
grant execute on function public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric) to authenticated;
