-- LES QUATRE CHAMPS DU FEC D'UN BNC EN TRÉSORERIE, FIGÉS À LA VALIDATION (ligne 26.6, étape e ; lot FEC22b ; MVP-D5).
-- Le récit : HISTORIQUE.md, « LES QUATRE CHAMPS DU FEC D'UN BNC, EN BASE (FEC22B) » ; la conception : « LE FEC D'UN BNC
-- EN TRÉSORERIE : LES VINGT-DEUX CHAMPS, LA CONCEPTION », § CE QUI CHANGE EN BASE ; les réponses du cabinet, qui
-- l'emportent : « HUIT RÉPONSES DU CABINET : C6-Q1, FEC22-Q1 À Q6 ET FEC22-E » ; le module dont elle fige les valeurs :
-- « LES QUATRE CHAMPS DU FEC D'UN BNC EN TRÉSORERIE, EN MODULE (FEC22A) ».
--
-- LA RÈGLE. LPF, art. A47 A-1, VIII, 7° : le contribuable BNC qui tient une comptabilité de trésorerie fournit les
-- vingt-deux premières informations du tableau, « dans l'ordre » — les dix-huit d'aujourd'hui, puis la date de
-- règlement (DateRglt), le mode de règlement (ModeRglt), la nature de l'opération (NatOp) et l'identification du client
-- (IdClient). Validée, une écriture ne se modifie plus (PCG, art. 1031-3) : ce que son FEC imprime se fige avec elle,
-- comme sa pièce et son numéro, ou le FEC d'un exercice validé ne se relirait pas depuis elle seule.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE :
--   1. cinq colonnes NULLES sur `ecritures_brouillon` — `date_reglement`, `mode_reglement`, `nature_operation` (une par
--      écriture), `poste_rattache` (le poste de la 2035 qu'une ligne de charge ou de produit porte : NatOp se recompose
--      « nature — poste » à la relecture, FEC22-Q3, (C)) et `identification_client` — et une contrainte,
--      `ecritures_brouillon_champs_bnc_du_fec`, qui prolonge `ecritures_brouillon_validation_complete` sans la
--      réécrire : nulles sur une écriture proposée ; sur une écriture validée, dans leurs listes fermées, ou nulles ;
--   2. `valider_exercice` reçoit ces cinq clés dans `p_lignes` et les fige. Absentes, les colonnes restent nulles et la
--      validation est celle d'hier, au refus près. Après tous ses refus d'hier, et dans cet ordre, elle refuse en
--      22023 : une date illisible, ou postérieure à aujourd'hui à Paris ; un mode, une nature ou un poste hors de leur
--      liste ; un poste sans nature, sur une ligne qui n'est ni de charge ni de produit, ou sur un compte qui ne le
--      porte pas (un poste de recettes va sur un produit ; un poste de dépenses, et les débours et les honoraires
--      rétrocédés qui se déduisent des recettes, sur une charge) ; une date, un mode, une nature ou une identification
--      du client qui diffèrent entre les lignes d'une écriture ; et un client identifié autrement que par le numéro
--      d'une facture ou d'un avoir validé du dossier, ou par le SIREN que porte son client figé — LA GARDE DU SECRET
--      (BOI-BNC-DECLA-10-20, § 280) : aucun chemin n'y fait entrer un nom ;
--   3. `empreinte_exercice` compte ces colonnes, en un champ de plus, présent seulement quand l'une d'elles est posée :
--      un exercice validé sans elles — avant cette migration, ou par une demande qui ne les porte pas — garde son
--      empreinte au caractère près, et `verifier_exercice_valide` le vérifie comme hier ;
--   4. la garde G5 (`garder_lignes_de_la_vente_facturee`) laisse à la validation ces colonnes comme les neuf d'hier :
--      sans quoi la validation d'un dossier basculé qui les porte se refuserait sur sa première écriture de vente
--      facturée (« ne se modifie que par la fonction qui l'écrit »).
-- src/lib/champsBncFiges.ts redit les refus neufs, leurs codes et leurs mots, dans cet ordre, et les listes fermées ;
-- ses tests les confrontent à ce texte, et ce texte à src/lib/champsBncDuFec.ts et src/lib/cases2035.ts.
--
-- CE QUI NE CHANGE PAS. Aucune donnée lue, écrite ni retirée ; aucune table, policy, aucun déclencheur ni droit —
-- `create or replace` garde l'OID, le propriétaire, les droits d'exécution et les déclencheurs des trois fonctions. La
-- numérotation, ses refus d'hier, leurs mots et leur ordre. La base ne choisit pas entre des champs vides et « Sans
-- règlement » pour une écriture qui n'est pas un règlement (FEC22-Q1, (C)) : elle admet les deux, l'expert-comptable
-- dira lequel (FEC22-E2). L'application n'envoie pas encore ces clés (lot FEC22c, derrière `CHAMPS_BNC_EXPORTES`) : la
-- migration est NEUTRE pour elle, et pour tout exercice validé avant elle.
--
-- CE QUI CONTOURNE LA RLS : rien de plus — la validation lisait déjà tout le dossier, aux droits du propriétaire, après
-- avoir vérifié le chef du cabinet ; elle lit en plus le numéro et le SIRET de ses factures validées, et ne rend qu'un
-- refus. Les colonnes neuves suivent la policy de la table, au cabinet seul.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` peut retenir) : rien — ni objet, ni donnée, ni droit,
-- ni instruction qui en retire ; la garde G5 nomme, comme hier, l'opération qu'elle juge (`tg_op`). Aucune barre
-- oblique inverse.
--
-- RETOUR ARRIÈRE : supabase/preparees/retour/20261031180100_retour_champs_bnc_du_fec.sql — les trois fonctions d'hier
-- au caractère près, puis la contrainte et les cinq colonnes retirées ; il se refuse dès qu'une ligne porte l'un de ces
-- champs (il détruirait ce qu'une validation a figé). Il retire des colonnes : il se présente au cabinet avant d'être
-- appliqué, et se colle.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose : les trois fonctions qu'elle reprend, telles que l'export les laisse ══════════

do $$
declare
  v record;
begin
  for v in select x.fonction, x.empreinte, x.migration from (values
      ('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)', 'd241891ff5f68e6fe4d92889b4b720ed', 'validation_des_ventes_facturees'),
      ('public.empreinte_exercice(uuid, integer, text)', '3e095e9bec4617beb85014c07f16127d', 'report_des_soldes'),
      ('public.garder_lignes_de_la_vente_facturee()', '905446ccd461606b99fa11eff68c1db1', 'virement_mixte')
    ) x(fonction, empreinte, migration) loop
    -- Le corps que cette migration reprend, au caractère près (les retours chariot d'un collage écartés) : une fonction
    -- changée depuis — par une autre migration, ou par une première application de celle-ci — ne se reprend pas sans
    -- être relue.
    if to_regprocedure(v.fonction) is null
       or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), '')) <> v.empreinte then
      raise exception 'La fonction % en base n''est plus celle de la migration % : cette migration ne la reprend pas sans être relue.',
        v.fonction, v.migration;
    end if;
  end loop;
  -- Ses colonnes et sa contrainte n'existent pas encore : une seconde application, ou un état à moitié posé, se refuse.
  if exists (select 1 from pg_attribute a
              where a.attrelid = 'public.ecritures_brouillon'::regclass and a.attnum > 0 and not a.attisdropped
                and a.attname in ('date_reglement', 'mode_reglement', 'nature_operation', 'poste_rattache',
                                  'identification_client'))
     or exists (select 1 from pg_constraint c where c.conrelid = 'public.ecritures_brouillon'::regclass
                 and c.conname = 'ecritures_brouillon_champs_bnc_du_fec') then
    raise exception 'Les champs du FEC d''un BNC sont déjà sur ecritures_brouillon : cette migration ne s''applique pas deux fois.';
  end if;
end
$$;

-- ══ 1. Les cinq colonnes, et la contrainte qui les juge ══════════
-- Nulles, sans valeur par défaut : une écriture d'hier, proposée ou validée, n'en porte aucune — ajoutées, elles ne
-- réécrivent aucune ligne.
alter table public.ecritures_brouillon
  add column date_reglement date,
  add column mode_reglement text,
  add column nature_operation text,
  add column poste_rattache text,
  add column identification_client text,
  -- Une écriture proposée n'en porte aucun ; une écriture validée les porte dans leurs listes fermées, ou nuls — la
  -- règle d'`ecritures_brouillon_validation_complete`, que cette contrainte prolonge sans la réécrire. Le poste ne va
  -- qu'avec une nature, sur une ligne de produit (classe 7) pour un poste que la 2035 range sous une recette, de charge
  -- (classe 6) pour un poste qu'elle range sous une dépense — ceux des dépenses, et les débours (AB) et les honoraires
  -- rétrocédés (AC), qui se déduisent des recettes et ne reçoivent qu'une dépense (`cadreCompatible`) ;
  -- l'identification du client, ni vide, ni bordée de blancs, ni porteuse d'un caractère de contrôle.
  add constraint ecritures_brouillon_champs_bnc_du_fec check (
    (statut = 'proposee' and date_reglement is null and mode_reglement is null and nature_operation is null
      and poste_rattache is null and identification_client is null)
    or (statut = 'validee'
      and (mode_reglement is null or mode_reglement in (
        'Banque', 'Espèces', 'Compte personnel', 'Virement', 'Chèque', 'Carte bancaire', 'Prélèvement', 'Effet',
        'Compensation', 'Autre', 'Sans règlement'))
      and (nature_operation is null or nature_operation in (
        'Recette', 'Dépense', 'Recette et dépense', 'Acquisition d''immobilisation', 'Apport de l''exploitant',
        'Prélèvement de l''exploitant', 'Échéance d''emprunt', 'Déblocage d''emprunt', 'Cotisation sociale',
        'Opération de bilan', 'Versement d''espèces', 'Retrait d''espèces pour la caisse', 'Paiement de TVA',
        'Remboursement de TVA', 'Liquidation de TVA', 'Dotation aux amortissements', 'Frais de véhicule (barème)',
        'À-nouveaux', 'TVA due sur facture', 'Annulation de recette', 'Remise en banque'))
      and (poste_rattache is null or (nature_operation is not null and (
        (compte ~ '^7[0-9]{2}' and poste_rattache in (
          'Recettes', 'Recettes encaissées y compris les remboursements de frais', 'Produits financiers',
          'Gains divers'))
        or (compte ~ '^6[0-9]{2}' and poste_rattache in (
          'Débours payés pour le compte des clients', 'Débours', 'Honoraires rétrocédés', 'Rétrocessions',
          'Achats', 'Salaires nets et avantages en nature', 'Salaires', 'Charges sociales sur salaires',
          'Taxe sur la valeur ajoutée', 'TVA', 'Contribution économique territoriale', 'CET', 'Autres impôts',
          'Impôts et taxes', 'Contribution sociale généralisée déductible', 'CSG déductible',
          'Loyer et charges locatives', 'Loyers et charges locatives', 'Location de matériel et de mobilier',
          'Entretien et réparations', 'Personnel intérimaire', 'Petit outillage', 'Chauffage, eau, gaz, électricité',
          'Honoraires ne constituant pas des rétrocessions', 'Primes d''assurance', 'Primes d''assurances', 'Assurance',
          'Frais de véhicules', 'Autres frais de déplacements', 'Frais de déplacement', 'Frais de déplacements',
          'Indemnités kilométriques', 'Cotisations sociales personnelles', 'Charges sociales personnelles',
          'Frais de réception, de représentation et de congrès', 'Frais de réception, de représentation',
          'Fournitures de bureau, frais de documentation, de correspondance et de téléphone', 'Fournitures de bureau',
          'Frais d''actes et de contentieux', 'Cotisations syndicales et professionnelles',
          'Autres frais divers de gestion', 'Frais divers de gestion', 'Divers', 'Frais financiers', 'Pertes diverses',
          'Amortissements', 'Dotation aux amortissements')))))
      and (identification_client is null
        or (identification_client <> '' and identification_client = btrim(identification_client)
          and identification_client !~ '[[:cntrl:]]')))
  );

comment on column public.ecritures_brouillon.date_reglement is
  'DateRglt du FEC d''un BNC en trésorerie (LPF, art. A47 A-1, VIII, 7°, information 19), figée par valider_exercice : la date du règlement de l''écriture, au plus le jour de la validation à Paris ; nulle sur une écriture proposée, ou quand la demande ne la porte pas.';
comment on column public.ecritures_brouillon.mode_reglement is
  'ModeRglt (information 20), figé par valider_exercice : un mode de la liste fermée de src/lib/champsBncDuFec.ts (MODES_REGLEMENT), « Sans règlement » compris ; nul sur une écriture proposée, ou quand la demande ne le porte pas.';
comment on column public.ecritures_brouillon.nature_operation is
  'La nature de l''opération (information 21, NatOp), une par écriture, figée par valider_exercice : une nature de la liste fermée de src/lib/champsBncDuFec.ts (NATURES_OPERATION), jamais un texte saisi ni la nature d''un soin ; nulle sur une écriture proposée, ou quand la demande ne la porte pas.';
comment on column public.ecritures_brouillon.poste_rattache is
  'Le poste de la 2035 d''une ligne de charge (classe 6) ou de produit (classe 7), figé par valider_exercice : un poste de POSTES_RATTACHES (src/lib/cases2035.ts), sur un produit s''il se range sous une recette, sur une charge sous une dépense — les débours et les honoraires rétrocédés compris, qui se déduisent des recettes ; NatOp se recompose « nature — poste » à la relecture (FEC22-Q3). Nul ailleurs.';
comment on column public.ecritures_brouillon.identification_client is
  'IdClient (information 22), figé par valider_exercice : le numéro d''une facture ou d''un avoir validé du dossier, ou le SIREN que porte son client figé (FEC22-Q4) — jamais un nom ; nul ailleurs.';

-- ══ 2. L'empreinte d'un exercice validé compte les quatre champs ══════════
-- La définition de `report_des_soldes`, au caractère près hors du champ ajouté à chaque écriture.
create or replace function public.empreinte_exercice(p_dossier_id uuid, p_annee integer, p_precedente text) returns text
language sql stable set search_path = public as $$
  select encode(sha256(convert_to(
    coalesce(p_precedente, '') || chr(29)
    || coalesce((
      select string_agg(concat_ws(chr(31),
          e.id::text, to_char(e.date, 'YYYY-MM-DD'), e.journal_code, e.numero_ecriture::text, e.compte, e.compte_lib,
          coalesce(e.comp_aux_num, ''), coalesce(e.comp_aux_lib, ''), e.piece_ref, to_char(e.piece_date, 'YYYY-MM-DD'),
          e.libelle, trim_scale(e.montant)::text, e.sens,
          to_char(e.valide_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
          -- Les quatre champs du FEC d'un BNC (lot FEC22b) : UN champ de plus, présent seulement quand l'un d'eux
          -- est posé. `concat_ws` saute un argument nul : une écriture validée sans eux garde sa forme d'avant, au
          -- caractère près, et un exercice validé sans eux se vérifie comme hier ; une valeur posée, retirée ou
          -- passée d'un champ à l'autre change l'empreinte.
          case when num_nonnulls(e.date_reglement, e.mode_reglement, e.nature_operation, e.poste_rattache,
                                 e.identification_client) > 0 then
            concat_ws(chr(31), coalesce(to_char(e.date_reglement, 'YYYY-MM-DD'), ''), coalesce(e.mode_reglement, ''),
                      coalesce(e.nature_operation, ''), coalesce(e.poste_rattache, ''),
                      coalesce(e.identification_client, ''))
          end),
        chr(30) order by e.journal_code, e.numero_ecriture, e.id)
      from public.ecritures_brouillon e
      where e.dossier_id = p_dossier_id and e.statut = 'validee'
        and e.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)), '')
    || chr(29)
    || coalesce((
      select string_agg(concat_ws(chr(31),
          a.id::text, to_char(a.date, 'YYYY-MM-DD'), a.compte, coalesce(a.compte_origine, ''), a.libelle, a.sens,
          trim_scale(a.montant)::text, a.source_nom, a.source_empreinte, coalesce(a.compte_lib, ''),
          coalesce(a.ecriture_lib, '')),
        chr(30) order by a.compte, a.id)
      from (
        select n.id, n.date, n.compte, n.compte_origine, n.libelle, n.sens, n.montant, n.source_nom, n.source_empreinte,
               n.compte_lib, n.ecriture_lib
          from public.a_nouveaux n
         where n.dossier_id = p_dossier_id and n.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
        union all
        select s.id, s.date, s.compte, null::text, s.libelle, s.sens, s.montant, s.source_nom, s.source_empreinte,
               s.compte_lib, s.ecriture_lib
          from public.soldes_reportes s
         where s.dossier_id = p_dossier_id and s.date = make_date(p_annee, 1, 1)
      ) a), ''),
    'UTF8')), 'hex')
$$;

-- ══ 3. G5 laisse à la validation les quatre champs, comme le reste de ce qu'elle pose ══════════
-- La définition de `virement_mixte`, au caractère près hors des deux listes des colonnes que la validation pose.
create or replace function public.garder_lignes_de_la_vente_facturee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reglage text := coalesce(current_setting('jd.ecriture_vente_facturee', true), '');
  v_avant text;
  v_apres text;
begin
  if tg_op <> 'INSERT' and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_op <> 'DELETE' then
    v_apres := coalesce(new.encaissement_id, new.facture_id)::text;
    -- Une ligne qui porte une pièce n'est pas du troisième genre : c'est l'écriture de cette pièce — la banque de
    -- l'exemplaire d'une facture qui n'est pas source, que ce mouvement paie (le virement mixte, VF5h).
    if v_apres is null and new.piece_id is null and exists (select 1 from public.lignes_bancaires l
                                    where l.id = new.ligne_bancaire_id and l.encaissements_de_factures) then
      v_apres := new.ligne_bancaire_id::text;
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.encaissement_id is null and new.facture_id is null and v_apres is not null
       and not public.is_super_admin() and v_reglage is distinct from v_apres then
      raise exception 'Une écriture ne se passe sur un mouvement classé par ses encaissements que par la fonction qui écrit la vente facturée.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  v_avant := coalesce(old.encaissement_id, old.facture_id)::text;
  if v_avant is null and old.piece_id is null and exists (select 1 from public.lignes_bancaires l
                                  where l.id = old.ligne_bancaire_id and l.encaissements_de_factures) then
    v_avant := old.ligne_bancaire_id::text;
  end if;
  if tg_op = 'DELETE' then
    if v_avant is not null and v_reglage is distinct from v_avant then
      raise exception 'Une écriture de vente facturée ne se retire que par la fonction qui l''écrit.' using errcode = '42501';
    end if;
    return old;
  end if;
  -- Ce que la validation d'un exercice pose sur la ligne — son numéro, sa pièce, ses libellés, et les quatre champs du
  -- FEC d'un BNC (lot FEC22b) — ne la change pas.
  if (to_jsonb(new) - array['statut', 'valide_le', 'journal_code', 'numero_ecriture', 'piece_ref', 'piece_date', 'compte_lib',
                            'comp_aux_num', 'comp_aux_lib', 'date_reglement', 'mode_reglement', 'nature_operation',
                            'poste_rattache', 'identification_client'])
     is not distinct from (to_jsonb(old) - array['statut', 'valide_le', 'journal_code', 'numero_ecriture', 'piece_ref',
                                                'piece_date', 'compte_lib', 'comp_aux_num', 'comp_aux_lib',
                                                'date_reglement', 'mode_reglement', 'nature_operation',
                                                'poste_rattache', 'identification_client']) then
    return new;
  end if;
  if v_avant is not null and v_reglage is distinct from v_avant or v_apres is not null and v_reglage is distinct from v_apres then
    raise exception 'Une écriture de vente facturée ne se modifie que par la fonction qui l''écrit.' using errcode = '42501';
  end if;
  return new;
end
$$;

-- ══ 4. La validation reçoit, juge et fige les quatre champs ══════════
-- La définition de `validation_des_ventes_facturees`, au caractère près hors d'une variable, du bloc des refus neufs —
-- après ceux d'hier — et de la mise à jour, qui pose les cinq colonnes.
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
  --     ses clés, comme `identificationDuClient` le lit. Aucun chemin n'y fait entrer un nom.
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
      ('Rétrocessions', '6'), ('Produits financiers', '7'), ('Gains divers', '7'), ('Achats', '6'),
      ('Salaires nets et avantages en nature', '6'), ('Salaires', '6'), ('Charges sociales sur salaires', '6'),
      ('Taxe sur la valeur ajoutée', '6'), ('TVA', '6'), ('Contribution économique territoriale', '6'), ('CET', '6'),
      ('Autres impôts', '6'), ('Impôts et taxes', '6'), ('Contribution sociale généralisée déductible', '6'),
      ('CSG déductible', '6'), ('Loyer et charges locatives', '6'), ('Loyers et charges locatives', '6'),
      ('Location de matériel et de mobilier', '6'), ('Entretien et réparations', '6'), ('Personnel intérimaire', '6'),
      ('Petit outillage', '6'), ('Chauffage, eau, gaz, électricité', '6'),
      ('Honoraires ne constituant pas des rétrocessions', '6'), ('Primes d''assurance', '6'),
      ('Primes d''assurances', '6'), ('Assurance', '6'), ('Frais de véhicules', '6'),
      ('Autres frais de déplacements', '6'), ('Frais de déplacement', '6'), ('Frais de déplacements', '6'),
      ('Indemnités kilométriques', '6'), ('Cotisations sociales personnelles', '6'),
      ('Charges sociales personnelles', '6'), ('Frais de réception, de représentation et de congrès', '6'),
      ('Frais de réception, de représentation', '6'),
      ('Fournitures de bureau, frais de documentation, de correspondance et de téléphone', '6'),
      ('Fournitures de bureau', '6'), ('Frais d''actes et de contentieux', '6'),
      ('Cotisations syndicales et professionnelles', '6'), ('Autres frais divers de gestion', '6'),
      ('Frais divers de gestion', '6'), ('Divers', '6'), ('Frais financiers', '6'), ('Pertes diverses', '6'),
      ('Amortissements', '6'), ('Dotation aux amortissements', '6')
  ), documents as (
    -- Les factures et les avoirs validés du dossier : leur numéro, et le SIRET ou le SIREN que leur client figé porte.
    select f.numero, f.tiers_siret as siret from public.factures_emises f
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
    -- Ce qui identifie un client : le numéro d'un document validé, ou le SIREN juste de son client figé.
    select numero from documents
    union
    select siren from cles where siren_juste and siret_juste
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
  v_empreinte := public.empreinte_exercice(p_dossier_id, p_annee, v_precedente);

  insert into public.exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures,
    total_debit, total_credit, empreinte_precedente, empreinte, declaration)
  values (p_dossier_id, p_annee, v_maintenant, auth.uid(), v_mode, v_lignes, v_ecritures, v_debit, v_credit,
    v_precedente, v_empreinte, case when v_mode = 'tresorerie' then p_declaration end);

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

-- ══ 5. Son commentaire ══════════
comment on function public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb) is
  'Valide un exercice terminé : vérifie la numérotation proposée par l''application, fige ses écritures — et les quatre champs du FEC d''un BNC que la numérotation porte (date, mode, nature et poste, identification du client), chacun dans sa forme, les mêmes sur les lignes d''une écriture, le client identifié par une facture validée du dossier seulement —, enregistre l''exercice et écrit l''ouverture du suivant (soldes_reportes) ; pour un dossier basculé, refuse aussi un mouvement réservé à des encaissements de factures, un virement ou un prélèvement sans son mouvement, et une vente facturée qui n''est pas écrite à jour. Chef du cabinet seul.';
