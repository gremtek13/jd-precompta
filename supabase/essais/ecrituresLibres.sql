-- ESSAI DES ÉCRITURES LIBRES (EL2, conception 54 ; migration `ecritures_libres`, PRÉPARÉE le 17/11/2026).
-- SUR UNE RÉPLIQUE SEULEMENT : il crée des dossiers, une pièce, des à-nouveaux et un exercice validé fictifs, et retire ce qu'il
-- a écrit. Joué ENTIER, en une transaction qui s'annule (`begin` … `rollback`), par psql, sans `-1` :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/ecrituresLibres.sql
-- Ce qu'il juge, par impersonation (le chef, qui est aussi super-administrateur dans le semis ; un membre de l'équipe assigné ;
-- le même membre sur un dossier qui ne lui est pas assigné ; un client qui a un accès au dossier ; l'anonyme) :
--   EL-A. l'accès (EL-Q1) : le chef et le membre assigné écrivent et lisent, l'auteur posé par la base ; le membre non assigné,
--         le client et l'anonyme n'écrivent ni ne lisent rien ;
--   EL-B. chaque refus de `enregistrer_ecriture_libre`, sous son code et ses MOTS (ceux de src/lib/ecritureLibre.ts ; la charge
--         ou le produit rattaché compté dans la 2035 refusé sans désignation possible, EXP58-Q3 (A), 17/11/2026), puis ceux
--         que la base seule dit ;
--   EL-C. la recomposition : les lignes écrites au centime, à leurs dates et sous leurs libellés, l'extourne comprise ; un
--         centime de moins, une extourne absente, un libellé recopié, un autre journal refusés ; le remplacement contre la
--         version lue, le numéro gardé dans l'année, un autre pris dans une autre ;
--   EL-D. le retrait, et le gel : un exercice validé ne reçoit, ne change ni ne perd rien ;
--   EL-E. les gardes : aucune écriture directe, ni de l'écriture ni de ses lignes, sauf la réinsertion du
--         super-administrateur, et à sa date ; une ligne d'une écriture libre ne cite aucune autre source ;
--   EL-F. le catalogue : la RLS, les deux policies, la porte devant la garde, les droits d'exécution, les droits de la table.
-- Puis des MUTATIONS de la migration, chacune dans une sous-transaction annulée, qui doivent faire virer un contrôle au rouge.
-- Se lit : toute ligne « en faute » est une faute de la migration ; toute mutation qui « NE MORD PAS » est un contrôle qui ne
-- prouve plus rien. Sans la migration, une ligne dit qu'il attend (EN ATTENTE).

begin;

create temp table el_verdict (rang serial, controle text, observe text, ok boolean);
create temp table el_mutation (rang serial, mutation text, observe text, mord boolean);

-- Tente une requête SOUS une identité (nulle : l'anonyme), et l'annule : rend « OK <résultat> » ou « <sqlstate> <message> ».
create function pg_temp.tente(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare
  v_resultat text;
  v_issue text;
begin
  begin
    if p_uid is null then
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    end if;
    execute p_sql into v_resultat;
    v_issue := 'OK ' || coalesce(v_resultat, '');
    raise exception 'ANNULATION_TENTATIVE';
  exception when others then
    if sqlerrm <> 'ANNULATION_TENTATIVE' then
      v_issue := sqlstate || ' ' || sqlerrm;
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_issue;
end
$$;

-- La même, qui GARDE ce qu'elle a écrit.
create function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare
  v_resultat text;
  v_issue text;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    execute p_sql into v_resultat;
    v_issue := 'OK ' || coalesce(v_resultat, '');
  exception when others then
    v_issue := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_issue;
end
$$;

-- L'écriture telle que `ecritureLibrePourLaBase` la donne : `lignes` = [[compte, sens, centimes, poste, libellé du compte]…].
create function pg_temp.ecriture(p_id uuid, p_date text, p_libelle text, p_lignes jsonb, p_extourne boolean)
returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'date', p_date, 'libelle', p_libelle, 'motif', 'Motif de l''essai.',
    'avec_extourne', p_extourne, 'piece_citee_id', null,
    'lignes', (select jsonb_agg(jsonb_build_object('compte', l ->> 0, 'sens', l ->> 1, 'centimes', (l -> 2),
                                                   'poste_2035', l -> 3, 'compte_lib', l -> 4) order by r)
                 from jsonb_array_elements(p_lignes) with ordinality x(l, r)))
$$;

-- Les écritures que `composerEcrituresLibres` propose : la constatation, et l'extourne au 1er janvier suivant.
create function pg_temp.ecritures(p_date text, p_libelle text, p_lignes jsonb, p_extourne boolean) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('date', p_date, 'journal', 'OD', 'libelle', p_libelle,
      'lignes', (select jsonb_agg(jsonb_build_object('compte', l ->> 0, 'sens', l ->> 1, 'centimes', (l -> 2)) order by r)
                   from jsonb_array_elements(p_lignes) with ordinality x(l, r))))
  || case when p_extourne then jsonb_build_array(jsonb_build_object('date', (left(p_date, 4)::integer + 1) || '-01-01', 'journal', 'OD',
      'libelle', 'Extourne — ' || p_libelle,
      'lignes', (select jsonb_agg(jsonb_build_object('compte', l ->> 0, 'sens', case l ->> 1 when 'debit' then 'credit' else 'debit' end,
                                                     'centimes', (l -> 2)) order by r)
                   from jsonb_array_elements(p_lignes) with ordinality x(l, r)))) else '[]'::jsonb end
$$;

-- L'appel, en texte, pour `tente` et `fait`.
create function pg_temp.appel(p_dossier uuid, p_ecriture jsonb, p_ecritures jsonb, p_version integer) returns text language sql as $$
  select format('select public.enregistrer_ecriture_libre(%L::uuid, %L::jsonb, %L::jsonb, %s)::text',
                p_dossier, p_ecriture, p_ecritures, coalesce(p_version::text, 'null'))
$$;

-- L'appel complet d'une saisie : l'écriture et les écritures que l'application en compose.
create function pg_temp.saisie(p_dossier uuid, p_id uuid, p_date text, p_libelle text, p_lignes jsonb, p_extourne boolean,
  p_version integer) returns text language sql as $$
  select pg_temp.appel(p_dossier, pg_temp.ecriture(p_id, p_date, p_libelle, p_lignes, p_extourne),
                       pg_temp.ecritures(p_date, p_libelle, p_lignes, p_extourne), p_version)
$$;

create function pg_temp.verdict(p_controle text, p_observe text, p_ok boolean) returns void language sql as $$
  insert into el_verdict (controle, observe, ok) values (p_controle, p_observe, coalesce(p_ok, false))
$$;

do $essai$
declare
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  dt uuid := 'e1540000-0000-4000-8000-0000000000a1';   -- trésorerie, assigné au membre, ouvert au client
  de uuid := 'e1540000-0000-4000-8000-0000000000a2';   -- engagement, assigné
  dn uuid := 'e1540000-0000-4000-8000-0000000000a3';   -- trésorerie, NON assigné au membre
  dv uuid := 'e1540000-0000-4000-8000-0000000000a4';   -- trésorerie, 2024 validé ensuite
  dov uuid := 'e1540000-0000-4000-8000-0000000000a5';  -- trésorerie, ouvert le 1er janvier 2025 (ses à-nouveaux)
  pa uuid := 'e1540000-0000-4000-8000-0000000000b1';
  pb uuid := 'e1540000-0000-4000-8000-0000000000b2';
  -- Les mots du module (src/lib/ecritureLibre.ts, MOTS_DES_REFUS et MOTS_DE_LA_BASE), au caractère près.
  m_date text := 'La date de l’écriture se lit en une date civile, entre 2000 et 2100.';
  m_fige text := 'Cette date est dans un exercice validé : une écriture libre ne s’y passe plus.';
  m_ouverture text := 'Cette date précède l’ouverture du dossier dans l’application : l’écriture n’y a pas de place.';
  m_a_venir text := 'Une écriture libre se date au plus tard du 31 décembre de l’année en cours.';
  m_ext_illisible text := 'L’extourne se demande ou ne se demande pas : vrai ou faux.';
  m_ext_hors text := 'Seule une écriture du 31 décembre reçoit son extourne au 1er janvier suivant.';
  m_libelle text := 'Le libellé de l’écriture tient en 1 à 200 caractères, sur une ligne : il part au FEC.';
  m_motif text := 'Le motif de l’écriture tient en 1 à 2 000 caractères : il dit pourquoi l’écriture est passée.';
  m_nombre text := 'Une écriture libre porte de 2 à 200 lignes.';
  m_compte text := 'Ce numéro de compte n’a pas la forme d’un compte de l’application : six à dix chiffres, d’une classe 1 à 7.';
  m_banque text := 'Le 512 est le compte du relevé : un mouvement manquant s’importe avec son relevé, il ne s’écrit pas à la main.';
  m_caisse text := 'La caisse se rejoue depuis ses opérations : une recette ou une dépense en espèces se saisit dans Caisse.';
  m_resultat text := 'Le résultat (120, 129) se calcule : une écriture libre ne le passe pas.';
  m_sens text := 'Une ligne est au débit ou au crédit.';
  m_montant text := 'Le montant d’une ligne est un nombre de centimes entier et positif.';
  m_poste_eng text := 'En comptabilité d’engagement, une écriture libre ne porte aucun poste de la 2035.';
  m_poste_bilan text := 'Seule une ligne de charge ou de produit (classe 6 ou 7) porte un poste de la 2035.';
  m_poste_inconnu text := 'Ce poste n’est pas un poste de la 2035 pour une ligne de cette classe.';
  m_lib_compte text := 'Le libellé d’un compte tient en 1 à 200 caractères, sur une ligne.';
  m_deux_libelles text := 'Un même compte porte deux libellés dans cette écriture.';
  m_desequilibre text := 'L’écriture n’est pas équilibrée : au moins un débit et un crédit, la somme des débits égale à celle des crédits, au centime.';
  m_rattachee_comptee text := 'En trésorerie, une charge ou un produit rattaché ne compte pas dans la 2035 de l’année de l’écriture : ses lignes de charge ou de produit se passent hors de la 2035.';
  m_acces text := 'Accès refusé à ce dossier.';
  m_acces_ecriture text := 'Accès refusé à cette écriture libre.';
  m_piece text := 'La pièce citée n’est pas une pièce de ce dossier.';
  m_version text := 'Cette écriture libre a changé depuis sa lecture : relire les écritures avant de l’écrire.';
  m_nouvelle text := 'Une écriture libre nouvelle ne porte pas de version lue.';
  m_ecritures text := 'Les écritures proposées ne sont pas celles de l’écriture libre : les recomposer.';
  m_garde text := 'Une écriture libre ne s’écrit que par enregistrer_ecriture_libre et retirer_ecriture_libre.';
  m_garde_lignes text := 'Une ligne d’une écriture libre ne change que par son écriture.';
  m_date_ligne text := 'Une ligne d’une écriture libre appartient à une écriture libre de son dossier, à sa date, ou au 1er janvier suivant pour son extourne.';
  -- Les saisies de l'essai.
  reclassement jsonb := '[["606400","debit",12000,"Fournitures de bureau"],["606300","credit",12000,"Petit outillage"]]';
  -- L'exemple du cabinet : une charge payée en janvier 2026, rattachée à 2025 (408 au crédit).
  rattachee jsonb := '[["622600","debit",50000,null],["408100","credit",50000,null]]';
  rattachee_comptee jsonb := '[["622600","debit",50000,"Honoraires ne constituant pas des rétrocessions"],["408100","credit",50000,null]]';
  -- Un produit à recevoir (418 au débit) compté dans les recettes.
  produit_compte jsonb := '[["706000","credit",30000,"Recettes"],["418000","debit",30000,null]]';
  a_venir text := (extract(year from (now() at time zone 'Europe/Paris'))::integer + 1) || '-01-15';
  issue text;
  id_a uuid;
  id_b uuid;
  id_r uuid;
  id_v uuid;
  n bigint;
  texte text;
begin
  if to_regclass('public.ecritures_libres') is null then
    perform pg_temp.verdict('0. EN ATTENTE de la migration ecritures_libres', 'absente : l''essai se joue dès que la migration y est', true);
    return;
  end if;

  -- ── Le jeu, écrit par le propriétaire ──
  insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva) values
    (dt, 'EL2 essai T', cabinet, 'tresorerie', 'franchise'), (de, 'EL2 essai E', cabinet, 'engagement', 'redevable'),
    (dn, 'EL2 essai N', cabinet, 'tresorerie', 'franchise'), (dv, 'EL2 essai V', cabinet, 'tresorerie', 'franchise'),
    (dov, 'EL2 essai O', cabinet, 'tresorerie', 'franchise');
  insert into dossier_assignations (dossier_id, user_id) values (dt, membre), (de, membre), (dv, membre), (dov, membre);
  insert into memberships (user_id, dossier_id, role, email) values (client, dt, 'client', 'essai-el2@example.test');
  insert into pieces (id, dossier_id, storage_path, nom_fichier) values
    (pa, dt, dt || '/el2.pdf', 'el2.pdf'), (pb, dn, dn || '/el2.pdf', 'el2.pdf');
  insert into a_nouveaux (dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values
    (dov, '2025-01-01', '512000', 'debit', 100, 'essai', repeat('a', 64)),
    (dov, '2025-01-01', '101000', 'credit', 100, 'essai', repeat('a', 64));

  -- ══ EL-A. L'accès (EL-Q1) ══
  issue := pg_temp.fait(chef, pg_temp.saisie(dt, null, '2025-06-30', 'Reclassement des fournitures', reclassement, false, null));
  id_a := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('EL-A1. le chef enregistre un reclassement (le contrôle positif)', issue, id_a is not null);
  issue := pg_temp.fait(membre, pg_temp.saisie(dt, null, '2025-12-31', 'Charge à payer — honoraires de décembre', rattachee, true, null));
  id_b := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('EL-A2. un membre assigné enregistre une charge rattachée, hors de la 2035, avec son extourne (EL-Q1)', issue, id_b is not null);
  select count(*) into n from ecritures_libres where (id = id_a and cree_par = chef and numero = 1 and exercice = 2025 and version = 1)
    or (id = id_b and cree_par = membre and numero = 2 and exercice = 2025 and avec_extourne);
  perform pg_temp.verdict('EL-A3. l''auteur et le numéro posés par la base, jamais par l''appelant', n::text, n = 2);
  issue := pg_temp.tente(membre, pg_temp.saisie(dn, null, '2025-06-30', 'Reclassement', reclassement, false, null));
  perform pg_temp.verdict('EL-A4. le membre sur un dossier qui ne lui est pas assigné (42501)', issue, issue = '42501 ' || m_acces);
  issue := pg_temp.tente(client, pg_temp.saisie(dt, null, '2025-06-30', 'Reclassement', reclassement, false, null));
  perform pg_temp.verdict('EL-A5. le client du dossier (42501)', issue, issue = '42501 ' || m_acces);
  issue := pg_temp.tente(null, pg_temp.saisie(dt, null, '2025-06-30', 'Reclassement', reclassement, false, null));
  perform pg_temp.verdict('EL-A6. l''anonyme (42501, l''exécution retirée)', issue, issue like '42501 %');
  issue := pg_temp.tente(membre, format('select count(*)::text from ecritures_libres where dossier_id = %L', dt));
  perform pg_temp.verdict('EL-A7. le membre assigné lit les écritures de son dossier', issue, issue = 'OK 2');
  issue := pg_temp.tente(client, format('select count(*)::text from ecritures_libres where dossier_id = %L', dt));
  perform pg_temp.verdict('EL-A8. le client n''en lit rien', issue, issue = 'OK 0');
  issue := pg_temp.tente(null, 'select count(*)::text from ecritures_libres');
  perform pg_temp.verdict('EL-A9. l''anonyme n''en lit rien', issue, issue = 'OK 0' or issue like '42501 %');

  -- ══ EL-B. Les refus, sous leurs mots et leurs codes ══
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-02-30', 'X', reclassement, false, null));
  perform pg_temp.verdict('EL-B1. une date qui n''existe pas', issue, issue = '22023 ' || m_date);
  issue := pg_temp.tente(membre, pg_temp.saisie(dov, null, '2024-06-30', 'X', reclassement, false, null));
  perform pg_temp.verdict('EL-B2. une date avant l''ouverture du dossier', issue, issue = '22023 ' || m_ouverture);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, a_venir, 'X', reclassement, false, null));
  perform pg_temp.verdict('EL-B3. une date après le 31 décembre de l''année en cours', issue, issue = '22023 ' || m_a_venir);
  issue := pg_temp.tente(membre, pg_temp.appel(dt, jsonb_set(pg_temp.ecriture(null, '2025-12-31', 'X', reclassement, false), '{avec_extourne}', '"oui"'),
    pg_temp.ecritures('2025-12-31', 'X', reclassement, false), null));
  perform pg_temp.verdict('EL-B4. une extourne illisible', issue, issue = '22023 ' || m_ext_illisible);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', reclassement, true, null));
  perform pg_temp.verdict('EL-B5. une extourne hors du 31 décembre', issue, issue = '22023 ' || m_ext_hors);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', '   ', reclassement, false, null));
  perform pg_temp.verdict('EL-B6. un libellé vide', issue, issue = '22023 ' || m_libelle);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'Deux' || chr(10) || 'lignes', reclassement, false, null));
  perform pg_temp.verdict('EL-B7. un libellé sur deux lignes', issue, issue = '22023 ' || m_libelle);
  issue := pg_temp.tente(membre, pg_temp.appel(dt, jsonb_set(pg_temp.ecriture(null, '2025-06-30', 'X', reclassement, false), '{motif}', '" "'),
    pg_temp.ecritures('2025-06-30', 'X', reclassement, false), null));
  perform pg_temp.verdict('EL-B8. un motif vide', issue, issue = '22023 ' || m_motif);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["606400","debit",100,null]]', false, null));
  perform pg_temp.verdict('EL-B9. une seule ligne', issue, issue = '22023 ' || m_nombre);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["801000","debit",100,null],["606300","credit",100,null]]', false, null));
  perform pg_temp.verdict('EL-B10. un compte de la classe 8', issue, issue = '22023 ' || m_compte);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["512100","debit",100,null],["108000","credit",100,null]]', false, null));
  perform pg_temp.verdict('EL-B11. la banque refusée (EL-Q4 (A))', issue, issue = '22023 ' || m_banque);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["108000","debit",100,null],["530000","credit",100,null]]', false, null));
  perform pg_temp.verdict('EL-B12. la caisse refusée (EL-Q4 (A))', issue, issue = '22023 ' || m_caisse);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["129000","debit",100,null],["108000","credit",100,null]]', false, null));
  perform pg_temp.verdict('EL-B13. le résultat refusé', issue, issue = '22023 ' || m_resultat);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["606400","debut",100,null],["606300","credit",100,null]]', false, null));
  perform pg_temp.verdict('EL-B14. un sens illisible', issue, issue = '22023 ' || m_sens);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["606400","debit",1.5,null],["606300","credit",1.5,null]]', false, null));
  perform pg_temp.verdict('EL-B15. des centimes qui ne sont pas un entier', issue, issue = '22023 ' || m_montant);
  issue := pg_temp.tente(membre, pg_temp.saisie(de, null, '2025-06-30', 'X', reclassement, false, null));
  perform pg_temp.verdict('EL-B16. un poste en engagement', issue, issue = '22023 ' || m_poste_eng);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["606400","debit",100,"Achats"],["108000","credit",100,"Achats"]]', false, null));
  perform pg_temp.verdict('EL-B17. un poste sur une ligne de bilan', issue, issue = '22023 ' || m_poste_bilan);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["706000","credit",100,"Achats"],["108000","debit",100,null]]', false, null));
  perform pg_temp.verdict('EL-B18. un poste de dépense sur une recette', issue, issue = '22023 ' || m_poste_inconnu);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["471100","debit",100,null,"Att\nente"],["108000","credit",100,null]]', false, null));
  perform pg_temp.verdict('EL-B19. le libellé d''un compte sur deux lignes', issue, issue = '22023 ' || m_lib_compte);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["471100","debit",100,null,"Attente A"],["471100","credit",50,null,"Attente B"],["108000","credit",50,null]]', false, null));
  perform pg_temp.verdict('EL-B20. un compte sous deux libellés', issue, issue = '22023 ' || m_deux_libelles);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["606400","debit",100,null],["606300","credit",99,null]]', false, null));
  perform pg_temp.verdict('EL-B21. un centime d''écart', issue, issue = '22023 ' || m_desequilibre);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-12-31', 'X', rattachee_comptee, false, null));
  perform pg_temp.verdict('EL-B22. une charge rattachée comptée dans la 2035, sans extourne (EXP58-Q3 (A))', issue, issue = '22023 ' || m_rattachee_comptee);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-12-31', 'X', rattachee_comptee, true, null));
  perform pg_temp.verdict('EL-B23. la même avec son extourne : refusée de même (EXP58-Q3 (A))', issue, issue = '22023 ' || m_rattachee_comptee);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-12-31', 'X', produit_compte, true, null));
  perform pg_temp.verdict('EL-B24. un produit rattaché compté dans les recettes', issue, issue = '22023 ' || m_rattachee_comptee);
  issue := pg_temp.tente(membre, pg_temp.appel(dt, jsonb_set(pg_temp.ecriture(null, '2025-12-31', 'X', rattachee_comptee, true), '{contre_la_regle}', 'true'),
    pg_temp.ecritures('2025-12-31', 'X', rattachee_comptee, true), null));
  perform pg_temp.verdict('EL-B25. l''ancienne désignation « contre la règle » envoyée : la base ne la lit plus, le refus reste', issue,
    issue = '22023 ' || m_rattachee_comptee);
  issue := pg_temp.tente(membre, pg_temp.appel(dt, jsonb_set(pg_temp.ecriture(null, '2025-06-30', 'X', reclassement, false), '{piece_citee_id}', to_jsonb(pb::text)),
    pg_temp.ecritures('2025-06-30', 'X', reclassement, false), null));
  perform pg_temp.verdict('EL-B26. la pièce d''un autre dossier', issue, issue = '22023 ' || m_piece);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, id_a, '2025-06-30', 'Reclassement des fournitures', reclassement, false, 7));
  perform pg_temp.verdict('EL-B27. une version dépassée (40001)', issue, issue = '40001 ' || m_version);
  issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', reclassement, false, 1));
  perform pg_temp.verdict('EL-B28. une écriture nouvelle avec une version lue', issue, issue = '22023 ' || m_nouvelle);
  issue := pg_temp.tente(membre, pg_temp.appel(dt, jsonb_set(pg_temp.ecriture(null, '2025-06-30', 'X', reclassement, false), '{piece_citee_id}', to_jsonb(pa::text)),
    pg_temp.ecritures('2025-06-30', 'X', reclassement, false), null));
  perform pg_temp.verdict('EL-B29. la pièce du dossier citée (le contrôle positif)', issue, issue like 'OK %');

  -- ══ EL-C. La recomposition ══
  select count(*) || ' ' || sum(montant) || ' ' || string_agg(distinct libelle, '|') || ' ' || string_agg(distinct date::text, '|')
    into texte from ecritures_brouillon where ecriture_libre_id = id_a and statut = 'proposee';
  perform pg_temp.verdict('EL-C1. le reclassement au brouillon : deux lignes, au centime, à sa date, sous son libellé', texte,
    texte = '2 240.00 Reclassement des fournitures 2025-06-30');
  select string_agg(date || ' ' || compte || ' ' || sens || ' ' || montant || ' ' || libelle, ' / ' order by date, compte) into texte
    from ecritures_brouillon where ecriture_libre_id = id_b;
  perform pg_temp.verdict('EL-C2. la charge rattachée et son extourne au 1er janvier, au sens inverse', texte,
    texte = '2025-12-31 408100 credit 500.00 Charge à payer — honoraires de décembre / 2025-12-31 622600 debit 500.00 Charge à payer — honoraires de décembre / '
         || '2026-01-01 408100 debit 500.00 Extourne — Charge à payer — honoraires de décembre / 2026-01-01 622600 credit 500.00 Extourne — Charge à payer — honoraires de décembre');
  issue := pg_temp.fait(membre, pg_temp.saisie(dt, null, '2025-11-30', 'Charge rattachée sans extourne', rattachee, false, null));
  id_r := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  select coalesce(lignes -> 0 ->> 'poste_2035', 'nul') || ' ' || coalesce(lignes -> 1 ->> 'poste_2035', 'nul') || ' ' || avec_extourne::text
    || ' ' || (select count(*) from ecritures_brouillon b where b.ecriture_libre_id = id_r)
    into texte from ecritures_libres where id = id_r;
  perform pg_temp.verdict('EL-C3. une charge rattachée hors de la 2035, sans extourne : permise (l''extourne proposée, jamais exigée), ses lignes sans poste',
    issue || ' ' || coalesce(texte, ''), texte = 'nul nul false 2');
  issue := pg_temp.tente(membre, pg_temp.appel(dt, pg_temp.ecriture(null, '2025-06-30', 'X', reclassement, false),
    pg_temp.ecritures('2025-06-30', 'X', '[["606400","debit",12000],["606300","credit",11999]]', false), null));
  perform pg_temp.verdict('EL-C4. un centime de moins dans ce que l''application propose', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.appel(dt, pg_temp.ecriture(null, '2025-12-31', 'X', rattachee, true),
    pg_temp.ecritures('2025-12-31', 'X', rattachee, false), null));
  perform pg_temp.verdict('EL-C5. une extourne absente de ce que l''application propose', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.appel(dt, pg_temp.ecriture(null, '2025-06-30', 'X', reclassement, false),
    pg_temp.ecritures('2025-06-30', 'Y', reclassement, false), null));
  perform pg_temp.verdict('EL-C6. un autre libellé', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.appel(dt, pg_temp.ecriture(null, '2025-06-30', 'X', reclassement, false),
    jsonb_set(pg_temp.ecritures('2025-06-30', 'X', reclassement, false), '{0,journal}', '"AC"'), null));
  perform pg_temp.verdict('EL-C7. un autre journal', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.fait(membre, pg_temp.saisie(dt, id_a, '2025-07-31', 'Reclassement des fournitures, corrigé',
    '[["606400","debit",15000,"Fournitures de bureau"],["606300","credit",15000,"Petit outillage"]]', false, 1));
  select count(*) into n from ecritures_libres e where e.id = id_a and e.version = 2 and e.modifie_par = membre and e.numero = 1
    and e.date = '2025-07-31' and (select count(*) from ecritures_brouillon b where b.ecriture_libre_id = id_a and b.montant = 150 and b.date = '2025-07-31') = 2;
  perform pg_temp.verdict('EL-C8. le remplacement contre la version lue : version 2, son auteur, le numéro gardé, les lignes remplacées', issue || ' ' || n, n = 1);
  issue := pg_temp.fait(membre, pg_temp.saisie(dt, id_a, '2024-12-15', 'Reclassement des fournitures, corrigé', reclassement, false, 2));
  select count(*) into n from ecritures_libres e where e.id = id_a and e.exercice = 2024 and e.numero = 1 and e.version = 3;
  perform pg_temp.verdict('EL-C9. passée dans une autre année : le numéro suivant de cette année-là', issue || ' ' || n, n = 1);

  -- ══ EL-D. Le retrait, et le gel ══
  issue := pg_temp.tente(membre, format('select public.retirer_ecriture_libre(%L::uuid, 9)::text', id_b));
  perform pg_temp.verdict('EL-D1. retirer contre une version dépassée (40001)', issue, issue = '40001 ' || m_version);
  issue := pg_temp.tente(membre, format('select public.retirer_ecriture_libre(%L::uuid, 1)::text', 'e1540000-0000-4000-8000-0000000000ff'));
  perform pg_temp.verdict('EL-D2. retirer une écriture inconnue (42501 : rien n''apprend qu''elle existe)', issue, issue = '42501 ' || m_acces_ecriture);
  issue := pg_temp.fait(membre, format('select public.retirer_ecriture_libre(%L::uuid, 1)::text', id_b));
  select count(*) into n from ecritures_brouillon where ecriture_libre_id = id_b;
  perform pg_temp.verdict('EL-D3. le membre retire la charge rattachée : ses quatre lignes, extourne comprise', issue || ' ' || n,
    issue = 'OK 4' and n = 0 and not exists (select 1 from ecritures_libres where id = id_b));
  -- (Une ligne d'exercices_valides posée par le propriétaire, sans la validation : seul compte ici le gel ; « engagement », qui
  -- n'exige pas de déclaration 2035.)
  issue := pg_temp.fait(membre, pg_temp.saisie(dv, null, '2024-06-30', 'Écriture de 2024', reclassement, false, null));
  id_v := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte)
    values (dv, 2024, now(), chef, 'engagement', 0, 0, 0, 0, repeat('0', 64));
  issue := pg_temp.tente(membre, pg_temp.saisie(dv, null, '2024-09-30', 'Encore 2024', reclassement, false, null));
  perform pg_temp.verdict('EL-D4. un exercice validé ne reçoit plus d''écriture libre (23514)', issue, id_v is not null and issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, pg_temp.saisie(dv, id_v, '2024-06-30', 'Écriture de 2024, changée', reclassement, false, 1));
  perform pg_temp.verdict('EL-D5. son écriture ne change plus (23514)', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, pg_temp.saisie(dv, id_v, '2025-06-30', 'Écriture déplacée en 2025', reclassement, false, 1));
  perform pg_temp.verdict('EL-D6. ni ne quitte son exercice (23514)', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, format('select public.retirer_ecriture_libre(%L::uuid, 1)::text', id_v));
  perform pg_temp.verdict('EL-D7. ni ne se retire (23514)', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, pg_temp.saisie(dv, null, '2025-01-15', 'Écriture de 2025', reclassement, false, null));
  perform pg_temp.verdict('EL-D8. l''exercice suivant reste ouvert', issue, issue like 'OK %');

  -- ══ EL-E. Les gardes ══
  issue := pg_temp.tente(membre, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par)
    values (%L, 2025, 99, '2025-06-30', 'Direct', 'Direct', '[{},{}]', %L) returning 1$q$, dt, membre));
  perform pg_temp.verdict('EL-E1. le membre n''insère pas une écriture libre en direct (42501)', issue, issue like '42501 %');
  issue := pg_temp.tente(membre, format($q$update ecritures_libres set libelle = 'Changé' where id = %L returning 1$q$, id_a));
  perform pg_temp.verdict('EL-E2. ni ne la change en direct (aucune policy de mise à jour : rien ne change)', issue,
    issue = 'OK ' and (select libelle from ecritures_libres where id = id_a) = 'Reclassement des fournitures, corrigé');
  issue := pg_temp.tente(membre, format($q$insert into ecritures_brouillon (dossier_id, ecriture_libre_id, date, compte, libelle, montant, sens, statut)
    values (%L, %L, '2024-12-15', '606400', 'Direct', 1, 'debit', 'proposee') returning 1$q$, dt, id_a));
  perform pg_temp.verdict('EL-E3. ni n''ajoute une ligne qui la cite (42501)', issue, issue = '42501 ' || m_garde_lignes);
  issue := pg_temp.tente(membre, format($q$update ecritures_brouillon set montant = montant + 1 where ecriture_libre_id = %L returning 1$q$, id_a));
  perform pg_temp.verdict('EL-E4. ni ne change une de ses lignes (42501)', issue, issue = '42501 ' || m_garde_lignes);
  issue := pg_temp.tente(chef, format($q$insert into ecritures_brouillon (dossier_id, ecriture_libre_id, date, compte, libelle, montant, sens, statut)
    values (%L, %L, '2024-11-15', '606400', 'Restaurée', 1, 'debit', 'proposee') returning 1$q$, dt, id_a));
  perform pg_temp.verdict('EL-E5. la réinsertion du super-administrateur, à une autre date que la sienne (23514)', issue, issue = '23514 ' || m_date_ligne);
  issue := pg_temp.tente(chef, format($q$insert into ecritures_brouillon (dossier_id, ecriture_libre_id, piece_id, date, compte, libelle, montant, sens, statut)
    values (%L, %L, %L, '2024-12-15', '606400', 'Restaurée', 1, 'debit', 'proposee') returning 1$q$, dt, id_a, pa));
  perform pg_temp.verdict('EL-E6. une ligne qui la cite ne cite aucune autre source (23514)', issue,
    issue like '23514 %ecritures_brouillon_libre_sans_autre_source%');
  issue := pg_temp.tente(chef, format($q$insert into ecritures_brouillon (dossier_id, ecriture_libre_id, date, compte, libelle, montant, sens, statut)
    values (%L, %L, '2024-12-15', '606400', 'Restaurée', 1, 'debit', 'proposee') returning 1$q$, dt, id_a));
  perform pg_temp.verdict('EL-E7. la réinsertion du super-administrateur à sa date (la restauration)', issue, issue = 'OK 1');
  issue := pg_temp.tente(chef, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par)
    values (%L, 2025, 99, '2025-06-30', 'Restaurée', 'Restaurée', '[{},{}]', %L) returning 1$q$, dt, membre));
  perform pg_temp.verdict('EL-E8. la réinsertion d''une écriture par le super-administrateur (la restauration)', issue, issue = 'OK 1');
  issue := pg_temp.tente(chef, format($q$update ecritures_libres set libelle = 'Changé' where id = %L returning 1$q$, id_a));
  perform pg_temp.verdict('EL-E9. le super-administrateur ne la change pas en direct non plus', issue,
    issue = 'OK ' or issue = '42501 ' || m_garde);

  -- ══ EL-F. Le catalogue ══
  select (select relrowsecurity from pg_class where oid = 'public.ecritures_libres'::regclass)::text
    || ' ' || (select string_agg(polname || ':' || polcmd::text, ',' order by polname) from pg_policy
               where polrelid = 'public.ecritures_libres'::regclass and not (polname = 'deux_facteurs' and not polpermissive))
    || ' ' || (select string_agg(tgname::text, ',' order by tgname collate "C") from pg_trigger
               where tgrelid = 'public.ecritures_libres'::regclass and not tgisinternal)
    into texte;
  perform pg_temp.verdict('EL-F1. la RLS, la lecture et la restauration, la porte devant la garde', texte,
    texte = 'true ecritures_libres_lecture:r,ecritures_libres_restauration:a _acces_avant_les_gardes,ecritures_libres_garde');
  select has_function_privilege('anon', 'public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer)', 'execute')::text
    || has_function_privilege('anon', 'public.retirer_ecriture_libre(uuid, integer)', 'execute')::text
    || has_function_privilege('authenticated', 'public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer)', 'execute')::text
    || has_function_privilege('authenticated', 'public.ecriture_libre_entier(jsonb)', 'execute')::text
    || has_function_privilege('authenticated', 'public.garder_ecritures_libres()', 'execute')::text
    into texte;
  perform pg_temp.verdict('EL-F2. l''exécution : ni l''anonyme ni les aides, le compte connecté pour les deux fonctions', texte,
    texte = 'falsefalsetruefalsefalse');
  select string_agg(distinct a.privilege_type, ',' order by a.privilege_type) into texte
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.oid = 'public.ecritures_libres'::regclass and a.grantee in ('anon'::regrole, 'authenticated'::regrole);
  perform pg_temp.verdict('EL-F3. les droits de la table : SELECT, INSERT, UPDATE et DELETE seuls (droits_hors_rls)', texte,
    texte = 'DELETE,INSERT,SELECT,UPDATE');

  -- ══ Les mutations ══
  -- M-EL1 : la banque permise.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer)'::regprocedure),
      'if starts_with(v_compte, ''512'') then', 'if false then');
    issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-06-30', 'X', '[["512100","debit",100,null],["108000","credit",100,null]]', false, null));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into el_mutation (mutation, observe, mord) values ('M-EL1 — la banque permise (EL-B11)', issue, issue like 'OK %');
  -- M-EL2 : l'accès ouvert à tout compte connecté.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer)'::regprocedure),
      'or not coalesce(public.admin_du_dossier(p_dossier_id), false)', '');
    issue := pg_temp.tente(membre, pg_temp.saisie(dn, null, '2025-06-30', 'X', reclassement, false, null));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into el_mutation (mutation, observe, mord) values ('M-EL2 — l''accès sans admin_du_dossier (EL-A4)', issue, issue like 'OK %');
  -- M-EL3 : la recomposition écartée.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer)'::regprocedure),
      'if not coalesce(v_conforme, false) then', 'if false then');
    issue := pg_temp.tente(membre, pg_temp.appel(dt, pg_temp.ecriture(null, '2025-06-30', 'X', reclassement, false),
      pg_temp.ecritures('2025-06-30', 'X', '[["606400","debit",12000],["606300","credit",11999]]', false), null));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into el_mutation (mutation, observe, mord) values ('M-EL3 — la recomposition écartée (EL-C4)', issue, issue like 'OK %');
  -- M-EL4 : la règle de la trésorerie oubliée.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer)'::regprocedure),
      'if v_mode = ''tresorerie'' and v_resultat and v_rattachement and v_poste_compte then', 'if false then');
    issue := pg_temp.tente(membre, pg_temp.saisie(dt, null, '2025-12-31', 'X', rattachee_comptee, true, null));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into el_mutation (mutation, observe, mord) values ('M-EL4 — la charge rattachée comptée dans la 2035 (EL-B23)', issue, issue like 'OK %');
  -- M-EL5 : la garde des lignes ouverte au membre.
  begin
    execute replace(replace(pg_get_functiondef('public.garder_ecriture_libre_du_brouillon()'::regprocedure),
      'and not (tg_op = ''INSERT'' and public.is_super_admin())', 'and false'),
      'is distinct from old.dossier_id::text then', 'is distinct from old.dossier_id::text and false then');
    issue := pg_temp.tente(membre, format($q$insert into ecritures_brouillon (dossier_id, ecriture_libre_id, date, compte, libelle, montant, sens, statut)
      values (%L, %L, '2024-12-15', '606400', 'Direct', 1, 'debit', 'proposee') returning 1$q$, dt, id_a));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into el_mutation (mutation, observe, mord) values ('M-EL5 — la garde des lignes ouverte (EL-E3)', issue, issue like 'OK %');
  -- M-EL6 : la date de la ligne restaurée non jugée.
  begin
    execute replace(pg_get_functiondef('public.garder_ecriture_libre_du_brouillon()'::regprocedure),
      'and (new.date = e.date or (e.avec_extourne and new.date = e.date + 1))', '');
    issue := pg_temp.tente(chef, format($q$insert into ecritures_brouillon (dossier_id, ecriture_libre_id, date, compte, libelle, montant, sens, statut)
      values (%L, %L, '2024-11-15', '606400', 'Restaurée', 1, 'debit', 'proposee') returning 1$q$, dt, id_a));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into el_mutation (mutation, observe, mord) values ('M-EL6 — la date d''une ligne réinsérée non jugée (EL-E5)', issue, issue like 'OK %');
end
$essai$;

select 'INVARIANTS' as tableau, controle as ligne, case when ok then 'juste' else '*** EN FAUTE ***' end as resultat, observe as detail
  from el_verdict
union all
select 'MUTATIONS', mutation, case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end, observe
  from el_mutation
union all
select 'BILAN', 'invariants et mutations',
  (select count(*) filter (where not ok) from el_verdict) || ' en faute / ' || (select count(*) from el_verdict) || ' ; '
  || (select count(*) filter (where mord) from el_mutation) || ' mutations sur ' || (select count(*) from el_mutation) || ' qui mordent', ''
order by 1 desc, 2;

rollback;
