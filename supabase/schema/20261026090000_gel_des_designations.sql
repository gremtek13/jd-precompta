-- LE GEL DES DÉSIGNATIONS (chantier EC-Q3, ligne 28.65, étape VF7e). La conception : HISTORIQUE.md, « VF7, LA VALIDATION
-- FIGE LA SOURCE : LA CONCEPTION », § 3 (f), § 5 (la puce VF7e) et § 6 (VF7-Q1) ; le récit : « LE GEL DES DÉSIGNATIONS ».
--
-- POURQUOI. L'exemplaire d'une facture SOURCE de sa vente ne porte jamais d'écriture (G4) : `exercice_figeant_la_piece`,
-- qui ne lit que des écritures validées, ne le fige jamais, et sa désignation restait modifiable après la validation de
-- l'exercice de sa facture. Or changer ou retirer cette désignation change la preuve que la piste d'audit cite pour un
-- exercice arrêté — la piste d'audit fiable relie la facture à l'opération qui la fonde (CGI, art. 289, VII, 1°), et une
-- comptabilité informatisée n'est régulière qu'après une validation qui « interdit toute modification ou suppression de
-- l'enregistrement » (PCG, art. 1031-3). Désigner ne change aucun chiffre : l'exemplaire d'une facture source ne compte
-- nulle part (VF3b, VF6a).
--
-- LA DÉCISION SUIVIE. VF7-Q1, pas encore tranchée par le cabinet, écrite sur sa recommandation, l'option (B) : l'exemplaire
-- d'une facture d'un exercice validé se désigne encore une PREMIÈRE fois — l'original d'une facture de décembre qui revient
-- de la plateforme du client après la validation, qui ne se validerait pas sans elle (G3) —, mais aucune désignation ne s'y
-- change ni ne s'y retire.
--
-- CE QU'ELLE POSE :
--   (a) `exercice_figeant_la_facture_source(facture)`, NEUVE : le premier exercice validé du dossier qui couvre la date
--       d'émission d'une facture ou d'un avoir SOURCE de sa vente — tout ce qui précède le premier exercice validé est figé
--       avec lui (`exercice_fige`) ; nulle pour une facture qui n'est pas source, ou que rien ne fige. Le critère que
--       `fixer_source_de_la_vente` lit déjà : une facture source ne se valide plus à une date figée.
--   (b) `exercice_figeant_la_designation(pièce)`, NEUVE : le plus ancien exercice validé parmi celui qui fige la pièce
--       (`exercice_figeant_la_piece` : ses écritures validées, et celles du bien qu'elle justifie) et celui qui fige la
--       facture source qu'elle désigne.
--   (c) LES QUATRE FONCTIONS DU CABINET, REMPLACÉES (la définition de `jumelle_inversee` au caractère près, hors de la ligne
--       du gel et des lignes ajoutées) : `designer_exemplaire_facture` (rang 4), `defaire_exemplaire_facture`,
--       `declarer_vente_hors_des_factures` et `retirer_declaration_hors_des_factures` (rang 5) lisent à leur rang du gel la
--       fonction (b) au lieu de `exercice_figeant_la_piece`. Quand la facture source désignée fige la désignation avant tout
--       ce que la pièce porte, le refus la nomme — « Cette pièce est l'exemplaire de la facture F2025-0042, figée par la
--       validation de l'exercice 2025 : sa désignation ne change plus. » — ; sinon, les mots d'hier. Une pièce déclarée ne
--       désigne aucune facture (jamais les deux) : `retirer_declaration_hors_des_factures` ne change que la fonction qu'elle
--       lit.
--   (d) LE CÔTÉ DE LA FACTURE (« un contrôle qui part d'un côté d'une relation ne voit pas l'autre ») : après son rang 7,
--       `designer_exemplaire_facture` refuse de désigner à une facture source figée une pièce qui porte déjà une marque —
--       l'exemplaire d'une autre facture, ou une déclaration — ; une pièce que rien ne marque s'y désigne, et sa désignation
--       est aussitôt figée par (b). LA CONDITION QUI PORTE VF7-Q1 est `v_deja_marquee` : l'option (A), tout se fige, la
--       remplace par `true` ; l'option (C), rien ne se fige du côté de la facture, par `false`. Dans l'ordre de la
--       désignation : 1. l'accès (42501) ; 2. la pièce, dans ce dossier (P0002) ; 3. une vente ; 4. le gel — la facture
--       source nommée, puis les mots d'hier ; 5. déjà l'exemplaire de CETTE facture ; 6. la facture, dans ce dossier (P0002) ;
--       7. validée ; 7 bis. la facture source figée, à une pièce déjà marquée ; puis, comme hier, le pont (8, 9), les liens de
--       G4 (10 à 13) et le virement mixte (14, 15). Les autres en 22023.
--
-- CE QUI NE CHANGE PAS : `exercice_figeant_la_piece` (elle sert aussi la fiche d'un achat hors de France, que la désignation
-- d'une vente ne regarde pas) ; `garder_piece_validee` (une pièce qui porte une écriture validée reste figée en entier) ; les
-- montants de l'exemplaire (ils ne comptent nulle part : seul ce que la pièce EST se fige) ; la pièce DÉCLARÉE (ses
-- écritures validées la figent déjà) ; le statut d'un exemplaire (remis à valider, G3 le rejuge à sa validation suivante, et
-- il passe, désigné) ; l'exemplaire d'une facture d'AVANT payé par un virement mixte (l'écriture validée que VF5h lui écrit
-- le fige). Aucune table, colonne, contrainte, policy ni déclencheur ; aucune donnée.
--
-- NEUTRE EN PRODUCTION (relevé le 25/10/2026, des comptes) : aucun dossier basculé, aucune facture source, aucun exercice
-- validé, aucune pièce désignée ni déclarée — `exercice_figeant_la_facture_source` n'y rend rien, et les quatre fonctions
-- y jugent comme hier.
--
-- CE QUI CONTOURNE LA RLS : rien de neuf. Les deux fonctions neuves s'exécutent aux droits de l'appelant, et aucun rôle de
-- l'API ne les exécute : seules les quatre fonctions du cabinet les lisent, en propriétaire, après leur contrôle d'accès et
-- sous le verrou partagé de la validation.
--
-- CE QUE LE TEXTE RETIRE : rien. `create or replace` garde l'OID et les droits des quatre fonctions. Aucune barre oblique
-- inverse.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose : les quatre fonctions de la jumelle inversée, telles qu'elle les reprend ══════════

do $$
declare
  v record;
begin
  for v in select x.fonction, x.empreinte from (values
      ('public.designer_exemplaire_facture(uuid, uuid, uuid)', 'd12b3a5e1c3bb09d5daeab28dcb69528'),
      ('public.defaire_exemplaire_facture(uuid, uuid)', 'cb92d15c09bf5d76bddd34a2f01d125e'),
      ('public.declarer_vente_hors_des_factures(uuid, uuid)', '5d63a232c96e97950379a1d1f7019066'),
      ('public.retirer_declaration_hors_des_factures(uuid, uuid)', 'e08232d6fb2ef154865dcb8a19cf8535')
    ) x(fonction, empreinte) loop
    -- Le corps que cette migration remplace, au caractère près (les retours chariot d'un collage écartés) : une fonction
    -- changée depuis — par une autre migration, ou par une première application de celle-ci — ne se remplace pas sans
    -- être relue.
    if to_regprocedure(v.fonction) is null
       or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), '')) <> v.empreinte then
      raise exception 'La fonction % en base n''est plus celle de la migration jumelle_inversee : cette migration ne la remplace pas sans être relue.',
        v.fonction;
    end if;
  end loop;
  -- Le gel de la pièce, que la fonction neuve lit (migration pieces_hors_de_france).
  if to_regprocedure('public.exercice_figeant_la_piece(uuid)') is null then
    raise exception 'Cette migration suppose le gel de la pièce (exercice_figeant_la_piece, migration pieces_hors_de_france) en base.';
  end if;
end
$$;

-- ══ (a) L'exercice qui fige une facture source ══════════
-- Le premier exercice validé du dossier de la facture dont l'année couvre sa date d'émission, ou la suit : la frontière de
-- la validation est le 31 décembre du dernier exercice validé, et tout ce qui la précède est figé, y compris ce qui précède
-- le premier (la facture d'une année reprise, figée par la validation de l'exercice suivant). Une facture qui n'est pas
-- source de sa vente compte par sa pièce, que ses écritures validées figent déjà : rien ici. Aux droits de l'appelant.
create function public.exercice_figeant_la_facture_source(p_facture_id uuid) returns integer
language sql stable set search_path = public as $$
  select min(v.annee)
    from public.factures_emises f
    join public.exercices_valides v on v.dossier_id = f.dossier_id and v.annee >= extract(year from f.date_emission)::integer
   where f.id = p_facture_id and f.source_de_la_vente
$$;

-- ══ (b) L'exercice qui fige la désignation d'une pièce ══════════
-- Le plus ancien de celui qui fige la pièce et de celui qui fige la facture source qu'elle désigne (`least` écarte un
-- nul) ; nul si rien ne fige ni l'une ni l'autre. Aux droits de l'appelant.
create function public.exercice_figeant_la_designation(p_piece_id uuid) returns integer
language sql stable set search_path = public as $$
  select least(public.exercice_figeant_la_piece(p_piece_id),
               (select public.exercice_figeant_la_facture_source(p.facture_id) from public.pieces p where p.id = p_piece_id))
$$;

-- ══ (c) et (d) Désigner, qui remplace — le gel de la désignation, et le côté de la facture ══════════
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
  v_deja_marquee boolean;
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
  -- Depuis l'étape VF7e, le plus ancien de celui de la pièce et de celui de la facture source qu'elle désigne
  -- (`exercice_figeant_la_designation`).
  v_annee := public.exercice_figeant_la_designation(p_piece_id);
  if v_annee is not null then
    -- La facture source qu'elle désigne fige la désignation avant tout ce que la pièce porte : elle se nomme.
    if v_annee is distinct from public.exercice_figeant_la_piece(p_piece_id) then
      select coalesce(f.numero, '(sans numéro)') into v_numero from public.factures_emises f where f.id = v_piece.facture_id;
      raise exception 'Cette pièce est l''exemplaire de la facture %, figée par la validation de l''exercice % : sa désignation ne change plus.',
        v_numero, v_annee using errcode = '22023';
    end if;
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
  -- 7 bis (étape VF7e). Le côté de la facture : une facture source figée par la validation d'un exercice ne reçoit plus
  -- qu'une PREMIÈRE désignation, celle d'une pièce qui n'est encore ni l'exemplaire d'une facture ni déclarée (VF7-Q1,
  -- option B, suivie sur la recommandation). LA CONDITION QUI PORTE VF7-Q1 est `v_deja_marquee` : l'option (A), tout se
  -- fige, la remplace par `true` ; l'option (C), rien ne se fige du côté de la facture, par `false`.
  v_deja_marquee := v_piece.facture_id is not null or v_piece.vente_hors_des_factures;
  v_annee := public.exercice_figeant_la_facture_source(p_facture_id);
  if v_annee is not null and v_deja_marquee then
    select coalesce(f.numero, '(sans numéro)') into v_numero from public.factures_emises f where f.id = p_facture_id;
    raise exception 'La facture % est figée par la validation de l''exercice % : elle ne reçoit plus qu''une première désignation, d''une pièce qui n''est encore ni l''exemplaire d''une facture ni déclarée — retirer d''abord sa désignation ou sa déclaration (validée, la pièce se remet d''abord à valider).',
      v_numero, v_annee using errcode = '22023';
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

-- ══ (c) Défaire ══════════
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
  -- Depuis l'étape VF7e, le plus ancien de celui de la pièce et de celui de la facture source qu'elle désigne
  -- (`exercice_figeant_la_designation`).
  v_annee := public.exercice_figeant_la_designation(p_piece_id);
  if v_annee is not null then
    -- La facture source qu'elle désigne fige la désignation avant tout ce que la pièce porte : elle se nomme.
    if v_annee is distinct from public.exercice_figeant_la_piece(p_piece_id) then
      select coalesce(f.numero, '(sans numéro)') into v_numero from public.factures_emises f where f.id = v_piece.facture_id;
      raise exception 'Cette pièce est l''exemplaire de la facture %, figée par la validation de l''exercice % : sa désignation ne change plus.',
        v_numero, v_annee using errcode = '22023';
    end if;
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

-- ══ (c) Déclarer une vente hors des factures de l'application ══════════
create or replace function public.declarer_vente_hors_des_factures(p_dossier_id uuid, p_piece_id uuid)
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
  -- Depuis l'étape VF7e, le plus ancien de celui de la pièce et de celui de la facture source qu'elle désigne
  -- (`exercice_figeant_la_designation`).
  v_annee := public.exercice_figeant_la_designation(p_piece_id);
  if v_annee is not null then
    -- La facture source qu'elle désigne fige la désignation avant tout ce que la pièce porte : elle se nomme.
    if v_annee is distinct from public.exercice_figeant_la_piece(p_piece_id) then
      select coalesce(f.numero, '(sans numéro)') into v_numero from public.factures_emises f where f.id = v_piece.facture_id;
      raise exception 'Cette pièce est l''exemplaire de la facture %, figée par la validation de l''exercice % : sa désignation ne change plus.',
        v_numero, v_annee using errcode = '22023';
    end if;
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

-- ══ (c) Retirer la déclaration ══════════
create or replace function public.retirer_declaration_hors_des_factures(p_dossier_id uuid, p_piece_id uuid)
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
  -- Depuis l'étape VF7e, le plus ancien de celui de la pièce et de celui de la facture source qu'elle désigne
  -- (`exercice_figeant_la_designation`). Une pièce déclarée ne désigne aucune facture (jamais les deux) : son gel reste
  -- celui de la pièce, sous les mots d'hier.
  v_annee := public.exercice_figeant_la_designation(p_piece_id);
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
-- Les deux fonctions neuves ne s'appellent pas : seules les fonctions du cabinet, en propriétaire, les lisent. Les quatre
-- d'hier gardent les leurs (`create or replace`).
revoke execute on function public.exercice_figeant_la_facture_source(uuid) from public, anon, authenticated;
revoke execute on function public.exercice_figeant_la_designation(uuid) from public, anon, authenticated;

comment on function public.exercice_figeant_la_facture_source(uuid) is
  'L''exercice validé qui fige une facture ou un avoir source de sa vente : le premier exercice validé de son dossier qui couvre sa date d''émission (migration gel_des_designations) ; nul pour une facture qui n''est pas source, ou que rien ne fige.';
comment on function public.exercice_figeant_la_designation(uuid) is
  'L''exercice qui fige la désignation d''une pièce : le plus ancien de celui de exercice_figeant_la_piece et de celui de la facture source qu''elle désigne (migration gel_des_designations).';
comment on function public.designer_exemplaire_facture(uuid, uuid, uuid) is
  'Désigne une pièce de vente exemplaire d''une facture émise validée du même dossier (le cabinet seul), en remplaçant ce qu''elle désignait ou sa déclaration, après les refus dits dans les migrations jumelle_inversee et gel_des_designations — une désignation figée par la validation d''un exercice ne change plus, et une facture source figée ne reçoit plus que la première désignation d''une pièce que rien ne marque ; le journal le garde.';
comment on function public.defaire_exemplaire_facture(uuid, uuid) is
  'Défait la désignation d''une pièce exemplaire d''une facture (le cabinet seul), tant que rien ne la fige — ni une écriture validée de la pièce, ni la validation de l''exercice de la facture source qu''elle désigne — et qu''elle n''est pas validée dans un dossier dont les factures sont la source de leurs ventes ; le journal le garde.';
comment on function public.declarer_vente_hors_des_factures(uuid, uuid) is
  'Déclare une pièce de vente d''un dossier basculé vente hors des factures de l''application (le cabinet seul), quand le pont ne la rattache à aucune facture, en remplaçant sa désignation tant que rien ne la fige ; le journal le garde.';
