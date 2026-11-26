-- LE FICHIER D'UNE PIÈCE QU'UNE ÉCRITURE LIBRE CITE NE SE RETIRE PLUS DU STOCKAGE (relecture adverse du 25/11/2026 ; migration
-- `fichier_cite_par_une_ecriture_libre`, en production depuis le 26/11/2026, 254) — SUR UNE RÉPLIQUE SEULEMENT : il retire
-- des lignes de `storage.objects` et mute une fonction, qu'on ne joue pas sur la base du cabinet. Joué ENTIER, en une
-- transaction qui s'annule (`begin` … `rollback`), par psql, sans `-1`, sous le super-utilisateur de la réplique :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/fichierCiteParUneEcritureLibre.sql
-- Sans la migration (le corps de `fichier_fige` ne nomme pas `ecritures_libres`), une ligne dit qu'il attend (EN ATTENTE) : la
-- migration est en base depuis le 26/11/2026, l'attente n'est plus attendue, elle reste le garde d'une base qui l'aurait
-- perdue (son retour collé). Il se joue aussi après INV3 (`validation_de_l_inventaire`, préparée), qui garde sa condition :
-- ses mutations ne visent que la ligne des écritures libres, sans ce qui la suit. Les récits : HISTORIQUE.md, « 25/11/2026
-- — LA RELECTURE ADVERSE DES TROIS MIGRATIONS DU JOUR (251 À 253) », « RA253 : LE FICHIER D'UNE PIÈCE CITÉE EN PRODUCTION (254) ».
--
-- POURQUOI LE RÉGLAGE DE L'API (le patron de pieceFigeeDansLeStockage.sql) : le stockage refuse toute suppression SQL directe de
-- `storage.objects` (`storage.protect_delete`, 42501) ; l'API du stockage supprime sous la session de l'appelant, le réglage
-- `storage.allow_delete_query` posé, en nommant et en rendant ses lignes : le NOMBRE de lignes rendues dit ce que les policies
-- admettent. Ce qu'il ne prouve pas : que l'API pose ce réglage ainsi (RGPD.md §8.6), ni rien du fichier lui-même.
--
-- CE QUI SE PROUVE, par impersonation, dans un dossier jetable du cabinet du dossier `test`, 2024 validé :
--   FC-1 à FC-4. `fichier_fige` rend vrai au chef pour le fichier d'une pièce qu'une écriture libre FIGÉE cite (2024) et pour sa
--                version lisible, pour celui d'une pièce qu'une écriture OUVERTE cite (2025) ; faux pour une pièce que rien ne
--                cite (le contrôle positif) ;
--   FC-5, FC-6. La suppression par l'API : le super-administrateur, puis un membre assigné, ne retirent aucun de ces fichiers ;
--                le fichier libre part (le contrôle positif) ;
--   FC-7. Le remède d'une écriture ouverte : sa citation retirée (`enregistrer_ecriture_libre`), la pièce redevient libre — son
--         fichier et sa ligne se retirent ;
--   FC-8. La contre-passation de l'écriture figée (EL7) garde la citation : le fichier reste figé ;
--   FC-9. Nul pour qui n'administre pas le dossier (le client, un membre non assigné), sans rien lever ;
--   FC-10. Le catalogue : `security definer`, stable, son chemin de recherche ; authenticated l'exécute, ni l'anonyme ni PUBLIC ;
--          la policy de suppression du seau des pièces l'appelle.
-- MUTATIONS, chacune doit MORDRE : M-FC1, la condition des écritures libres retirée (le corps d'hier) ; M-FC2, la condition qui
-- ne trouve jamais rien. Chacune altère la fonction réelle (sa définition lue au catalogue, un fragment remplacé ; un fragment
-- introuvable arrête l'essai), dans une sous-transaction annulée.

begin;

create temp table fc_verdict (rang serial, controle text, observe text, ok boolean);
create temp table fc_mutation (rang serial, mutation text, observe text, mord boolean);

-- Tente une requête SOUS une identité (nulle : l'anonyme), et l'annule : « OK <résultat> » ou « <sqlstate> <message> ».
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
    v_issue := 'OK ' || coalesce(v_resultat, '∅');
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
    v_issue := 'OK ' || coalesce(v_resultat, '∅');
  exception when others then
    v_issue := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_issue;
end
$$;

-- La suppression d'un fichier telle que l'API la fait, en texte pour `tente` : le nombre de lignes retirées.
create function pg_temp.retrait(p_chemin text) returns text language sql as $$
  select format($q$select set_config('storage.allow_delete_query', 'true', true) is null; with u as (delete from storage.objects where bucket_id = 'pieces' and name = %L returning 1) select count(*)::text from u$q$, p_chemin)
$$;

-- Une mutation : le texte visé remplacé dans le corps de la fonction, qui doit y être UNE fois — sinon l'essai s'arrête.
create function pg_temp.muter(p_fonction regprocedure, p_avant text, p_apres text) returns void language plpgsql as $$
declare
  v_def text := pg_get_functiondef(p_fonction);
begin
  if (length(v_def) - length(replace(v_def, p_avant, ''))) / length(p_avant) <> 1 then
    raise exception 'MUTATION_INTROUVABLE % : %', p_fonction, p_avant;
  end if;
  execute replace(v_def, p_avant, p_apres);
end
$$;

-- L'enregistrement d'une écriture libre qui cite (ou non) une pièce, en texte pour `fait` : deux lignes, hors de la 2035.
create function pg_temp.saisie(p_dossier uuid, p_id uuid, p_date text, p_piece uuid, p_version integer) returns text language sql as $$
  select format('select public.enregistrer_ecriture_libre(%L::uuid, %L::jsonb, %L::jsonb, %s)::text', p_dossier,
    jsonb_build_object('id', p_id, 'date', p_date, 'libelle', 'Reclassement de l''essai', 'motif', 'Motif de l''essai.',
      'avec_extourne', false, 'piece_citee_id', p_piece,
      'lignes', jsonb_build_array(
        jsonb_build_object('compte', '606400', 'sens', 'debit', 'centimes', 12000, 'poste_2035', null, 'compte_lib', null),
        jsonb_build_object('compte', '606300', 'sens', 'credit', 'centimes', 12000, 'poste_2035', null, 'compte_lib', null))),
    jsonb_build_array(jsonb_build_object('date', p_date, 'journal', 'OD', 'libelle', 'Reclassement de l''essai',
      'lignes', jsonb_build_array(jsonb_build_object('compte', '606400', 'sens', 'debit', 'centimes', 12000),
                                  jsonb_build_object('compte', '606300', 'sens', 'credit', 'centimes', 12000)))),
    coalesce(p_version::text, 'null'))
$$;

create function pg_temp.verdict(p_controle text, p_observe text, p_ok boolean) returns void language sql as $$
  insert into fc_verdict (controle, observe, ok) values (p_controle, p_observe, coalesce(p_ok, false))
$$;
create function pg_temp.mutation(p_mutation text, p_observe text, p_mord boolean) returns void language sql as $$
  insert into fc_mutation (mutation, observe, mord) values (p_mutation, p_observe, coalesce(p_mord, false))
$$;

do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';     -- le super-administrateur, chef du cabinet du dossier `test`
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';   -- un membre de l'équipe, assigné au dossier jetable
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';   -- le client d'essai, un accès au dossier jetable
  da uuid := 'f1c1e000-0000-4000-8000-0000000000a1';       -- le dossier jetable, en trésorerie, 2024 validé
  db uuid := 'f1c1e000-0000-4000-8000-0000000000b2';       -- un autre dossier du cabinet, qui n'est pas assigné au membre
  p_figee uuid := 'f1c1e000-0000-4000-8000-0000000000f1';  -- citée par une écriture libre de 2024, figée
  p_ouverte uuid := 'f1c1e000-0000-4000-8000-0000000000f2';-- citée par une écriture libre de 2025, ouverte
  p_libre uuid := 'f1c1e000-0000-4000-8000-0000000000f3';  -- que rien ne cite
  p_remede uuid := 'f1c1e000-0000-4000-8000-0000000000f4'; -- citée par une écriture ouverte, dont la citation se retire
  p_autre uuid := 'f1c1e000-0000-4000-8000-0000000000f5';  -- de l'autre dossier, citée par une écriture ouverte
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  fn regprocedure;
  e_figee uuid; e_ouverte uuid; e_remede uuid; e_autre uuid;
  issue text; texte text;
  clause constant text := chr(10) || '                or exists (select 1 from public.ecritures_libres e where e.piece_citee_id = p.id)';
begin
  if to_regprocedure('public.fichier_fige(text)') is null
     or position('ecritures_libres' in (select p.prosrc from pg_proc p where p.oid = 'public.fichier_fige(text)'::regprocedure)) = 0 then
    perform pg_temp.verdict('0. EN ATTENTE de la migration fichier_cite_par_une_ecriture_libre',
      'absente : le fichier d''une pièce qu''une écriture libre cite se retire encore ; l''essai se joue dès que la migration y est', true);
    return;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') or cabinet is null
     or not exists (select 1 from super_admins where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : une réplique seulement, avec son jeu de départ (le dossier test, le chef super-administrateur)';
  end if;
  fn := 'public.fichier_fige(text)'::regprocedure;

  -- ── Le jeu : deux dossiers, cinq pièces et leurs fichiers, quatre écritures libres par leur fonction, 2024 validé ──
  insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva) values
    (da, 'ESSAI FICHIER CITÉ A', cabinet, 'tresorerie', 'franchise'), (db, 'ESSAI FICHIER CITÉ B', cabinet, 'tresorerie', 'franchise');
  insert into dossier_assignations (dossier_id, user_id) values (da, membre);
  insert into memberships (user_id, dossier_id, role, email) values (client, da, 'client', 'essai-fichier-cite@exemple.invalid');
  insert into pieces (id, dossier_id, statut, date_piece, montant_ttc, storage_path, lisible_path, uploaded_by, nom_fichier) values
    (p_figee, da, 'a_valider', '2026-02-01', 120, da || '/figee.pdf', da || '/figee-lisible.pdf', chef, 'figee.pdf'),
    (p_ouverte, da, 'a_valider', '2026-02-02', 50, da || '/ouverte.pdf', null, chef, 'ouverte.pdf'),
    (p_libre, da, 'a_valider', '2026-02-03', 30, da || '/libre.pdf', null, chef, 'libre.pdf'),
    (p_remede, da, 'a_valider', '2026-02-04', 20, da || '/remede.pdf', null, chef, 'remede.pdf'),
    (p_autre, db, 'a_valider', '2026-02-05', 10, db || '/autre.pdf', null, chef, 'autre.pdf');
  insert into storage.objects (bucket_id, name)
    select 'pieces', x from unnest(array[da || '/figee.pdf', da || '/figee-lisible.pdf', da || '/ouverte.pdf', da || '/libre.pdf',
                                         da || '/remede.pdf', db || '/autre.pdf']) x;
  e_figee := substr(pg_temp.fait(chef, pg_temp.saisie(da, null, '2024-06-30', p_figee, null)), 4)::uuid;
  e_ouverte := substr(pg_temp.fait(chef, pg_temp.saisie(da, null, '2025-03-31', p_ouverte, null)), 4)::uuid;
  e_remede := substr(pg_temp.fait(chef, pg_temp.saisie(da, null, '2025-04-30', p_remede, null)), 4)::uuid;
  e_autre := substr(pg_temp.fait(chef, pg_temp.saisie(db, null, '2025-05-31', p_autre, null)), 4)::uuid;
  -- (Une ligne d'exercices_valides posée par le propriétaire, sans la validation : seul compte ici le gel, le patron de
  -- contrePassationDesEcrituresLibres.sql.)
  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte)
    values (da, 2024, now(), chef, 'engagement', 0, 0, 0, 0, repeat('0', 64));
  perform pg_temp.verdict('FC-0. le jeu : quatre écritures libres enregistrées par leur fonction, chacune citant sa pièce ; 2024 validé',
    concat_ws(' ', e_figee, e_ouverte, e_remede, e_autre), num_nonnulls(e_figee, e_ouverte, e_remede, e_autre) = 4
      and public.frontiere_validation(da) = '2024-12-31');

  -- ══ FC-1 à FC-4. Ce que fichier_fige rend au chef ══
  issue := pg_temp.tente(chef, format('select public.fichier_fige(%L)::text', da || '/figee.pdf'));
  perform pg_temp.verdict('FC-1. figé : le fichier d''une pièce qu''une écriture libre FIGÉE cite', issue, issue = 'OK true');
  issue := pg_temp.tente(chef, format('select public.fichier_fige(%L)::text', da || '/figee-lisible.pdf'));
  perform pg_temp.verdict('FC-2. figée aussi : sa version lisible', issue, issue = 'OK true');
  issue := pg_temp.tente(chef, format('select public.fichier_fige(%L)::text', da || '/ouverte.pdf'));
  perform pg_temp.verdict('FC-3. figé : le fichier d''une pièce qu''une écriture libre OUVERTE cite (sa ligne ne part pas non plus)', issue, issue = 'OK true');
  issue := pg_temp.tente(chef, format('select public.fichier_fige(%L)::text', da || '/libre.pdf'));
  perform pg_temp.verdict('FC-4. libre : le fichier d''une pièce que rien ne cite (le contrôle positif)', issue, issue = 'OK false');

  -- ══ FC-5, FC-6. La suppression par l'API ══
  texte := concat_ws(' | ', pg_temp.tente(chef, pg_temp.retrait(da || '/figee.pdf')), pg_temp.tente(chef, pg_temp.retrait(da || '/figee-lisible.pdf')),
                     pg_temp.tente(chef, pg_temp.retrait(da || '/ouverte.pdf')), pg_temp.tente(chef, pg_temp.retrait(da || '/libre.pdf')));
  perform pg_temp.verdict('FC-5. le super-administrateur ne retire ni la figée, ni sa version lisible, ni l''ouverte ; la libre part', texte,
    texte = 'OK 0 | OK 0 | OK 0 | OK 1');
  texte := concat_ws(' | ', pg_temp.tente(membre, pg_temp.retrait(da || '/figee.pdf')), pg_temp.tente(membre, pg_temp.retrait(da || '/ouverte.pdf')),
                     pg_temp.tente(membre, pg_temp.retrait(da || '/libre.pdf')));
  perform pg_temp.verdict('FC-6. un membre assigné : ni la figée, ni l''ouverte ; la libre part', texte, texte = 'OK 0 | OK 0 | OK 1');

  -- ══ FC-7. Le remède d'une écriture ouverte : la citation retirée, la pièce redevient libre ══
  issue := pg_temp.fait(chef, pg_temp.saisie(da, e_remede, '2025-04-30', null, 1));
  texte := concat_ws(' | ', issue, pg_temp.tente(chef, format('select public.fichier_fige(%L)::text', da || '/remede.pdf')),
                     pg_temp.tente(chef, pg_temp.retrait(da || '/remede.pdf')),
                     pg_temp.tente(chef, format('with u as (delete from pieces where id = %L returning 1) select count(*)::text from u', p_remede)));
  perform pg_temp.verdict('FC-7. sa citation retirée, la pièce d''une écriture ouverte redevient libre : son fichier et sa ligne se retirent', texte,
    texte = 'OK ' || e_remede || ' | OK false | OK 1 | OK 1');

  -- ══ FC-8. La contre-passation de l'écriture figée garde la citation ══
  issue := pg_temp.fait(chef, format('select public.contre_passer_ecriture_libre(%L::uuid, 1, %L::jsonb, %L::jsonb)::text', e_figee,
    '{"date":"2025-01-01","libelle":"Contre-passation de l''essai","motif":"Contre-passée.","hors_de_la_2035":true}',
    '[{"date":"2025-01-01","journal":"OD","libelle":"Contre-passation de l''essai","lignes":[{"compte":"606400","sens":"credit","centimes":12000},{"compte":"606300","sens":"debit","centimes":12000}]}]'));
  texte := concat_ws(' | ', left(issue, 2), pg_temp.tente(chef, format('select public.fichier_fige(%L)::text', da || '/figee.pdf')),
                     pg_temp.tente(chef, pg_temp.retrait(da || '/figee.pdf')));
  perform pg_temp.verdict('FC-8. contre-passée, l''écriture figée cite encore sa pièce : le fichier reste figé', texte, texte = 'OK | OK true | OK 0');

  -- ══ FC-9. Nul pour qui n'administre pas le dossier du chemin ══
  texte := concat_ws(' | ', pg_temp.tente(client, format('select coalesce(public.fichier_fige(%L)::text, ''nul'')', da || '/figee.pdf')),
                     pg_temp.tente(membre, format('select coalesce(public.fichier_fige(%L)::text, ''nul'')', db || '/autre.pdf')),
                     pg_temp.tente(chef, format('select coalesce(public.fichier_fige(%L)::text, ''nul'')', db || '/autre.pdf')));
  perform pg_temp.verdict('FC-9. nul pour le client du dossier et pour un membre non assigné, sans rien lever ; vrai au chef pour l''autre dossier',
    texte, texte = 'OK nul | OK nul | OK true');

  -- ══ FC-10. Le catalogue ══
  select (p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public'])::text
         || ' | anon ' || has_function_privilege('anon', p.oid, 'execute')::text
         || ' | authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')::text
         || ' | public ' || exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')::text
         || ' | policy ' || exists (select 1 from pg_depend d join pg_policy y on y.oid = d.objid
                                     where d.classid = 'pg_policy'::regclass and y.polrelid = 'storage.objects'::regclass and y.polcmd = 'd'
                                       and d.refclassid = 'pg_proc'::regclass and d.refobjid = p.oid
                                       and not (y.polname = 'deux_facteurs' and not y.polpermissive))::text
    into texte from pg_proc p where p.oid = fn;
  perform pg_temp.verdict('FC-10. security definer, stable, son chemin ; authenticated l''exécute, ni l''anonyme ni PUBLIC ; la policy de suppression du seau l''appelle',
    texte, texte = 'true | anon false | authenticated true | public false | policy true');

  -- ══ MUTATIONS ══
  begin
    perform pg_temp.muter(fn, clause, '');
    texte := concat_ws(' | ', pg_temp.tente(chef, format('select public.fichier_fige(%L)::text', da || '/ouverte.pdf')),
                       pg_temp.tente(chef, pg_temp.retrait(da || '/ouverte.pdf')));
    raise exception 'ANNULATION_MUTATION';
  exception when others then
    if sqlerrm <> 'ANNULATION_MUTATION' then raise; end if;
  end;
  -- Le verdict hors de la sous-transaction annulée, qui l'emporterait avec elle.
  perform pg_temp.mutation('M-FC1 — la condition des écritures libres retirée (le corps d''hier) : FC-3 et FC-5 tombent', texte, texte <> 'OK true | OK 0');
  begin
    perform pg_temp.muter(fn, 'e.piece_citee_id = p.id)', 'e.piece_citee_id = p.id and false)');
    texte := pg_temp.tente(membre, pg_temp.retrait(da || '/ouverte.pdf'));
    raise exception 'ANNULATION_MUTATION';
  exception when others then
    if sqlerrm <> 'ANNULATION_MUTATION' then raise; end if;
  end;
  perform pg_temp.mutation('M-FC2 — la condition qui ne trouve jamais rien : FC-6 tombe', texte, texte <> 'OK 0');
end
$essai$;

select 'INVARIANTS' as bloc, controle, case when ok then 'juste' else 'EN FAUTE' end as verdict, observe from fc_verdict order by rang;
select 'MUTATIONS' as bloc, mutation, case when mord then 'le contrôle mord' else 'NE MORD PAS' end as verdict, observe from fc_mutation order by rang;
select 'BILAN' as bloc, 'invariants et mutations' as controle,
       (select count(*) filter (where not ok) from fc_verdict) || ' en faute / ' || (select count(*) from fc_verdict) || ' ; '
       || (select count(*) filter (where mord) from fc_mutation) || ' mutations sur ' || (select count(*) from fc_mutation) || ' qui mordent' as verdict,
       '' as observe;

rollback;
