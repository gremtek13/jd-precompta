-- LES NOTES INTERNES DU CABINET, ÉPROUVÉES EN BASE (espace client, étape P0) — à rejouer par `execute_sql` après toute
-- migration qui touche `notes_internes`, sa policy, `admin_du_dossier`, `pieces`, `documents_divers` ou `memberships`.
--
-- Ce qui se prouve ici, par impersonation des six profils — anonyme, compte rattaché à rien, client du dossier, chef du
-- cabinet, membre du cabinet affecté au dossier, membre affecté à un AUTRE dossier :
--   - le client ne LIT aucune note interne, pas même celle d'une pièce de SON dossier, et ne peut ni en écrire une ni
--     modifier celle qui existe ; l'anonyme et le compte rattaché à rien ne voient rien ;
--   - le chef et le membre affecté au dossier la lisent et l'écrivent (les contrôles POSITIFS : sans eux, les refus
--     seraient satisfaits par une table que plus personne n'atteint), le membre d'un autre dossier non ;
--   - une note ne vise qu'une pièce ou un document DU dossier qu'elle annonce, une seule fois ; effacée, elle reste une
--     ligne au texte vide ; sa date de modification vient de la base ;
--   - aucune note des anciennes colonnes n'est perdue de vue : chacune a sa ligne, identique tant que personne ne l'a
--     reprise (comparées par égalité, jamais lues) — la condition qu'exigera la suppression des anciennes colonnes ;
--     rejouée, la recopie n'ajoute rien ; aucune fonction SQL n'écrit plus les anciennes colonnes ;
--   - et que RIEN ne reste en base.
--
-- LE CHEF D'ESSAI ET LES MEMBRES D'ESSAI sont le compte client du jeu, rattaché au cabinet le temps d'un bloc qui
-- s'annule — la base n'a qu'un chef, qui est aussi super-administrateur, et aucun membre affecté. Rien n'élargit un
-- droit hors de ces blocs. Chaque contrôle s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), le verdict
-- étant posé dans une VARIABLE avant le `raise` — le mécanisme de rls.sql. Les verdicts voyagent dans un réglage LOCAL à
-- la transaction (`essai.notes_internes`), que la requête finale lit : le fichier se joue d'un seul appel et ne crée
-- aucune table. Il ne porte AUCUNE instruction de suppression : la policy est la même pour toutes les commandes
-- (`for all`, contrôle 5), et ce qu'une suppression rencontre se joue sur une réplique.
--
-- Postgres juge la policy AVANT les contraintes : une note sans cible est refusée par la policy (42501) à un compte
-- connecté, et par sa contrainte (23514) au propriétaire de la base seulement — le contrôle 17 dit les deux.
--
-- LES MUTATIONS (contrôles 31 à 35) rejouent un contrôle avec un profil ou une cible délibérément faux : chacune doit
-- MORDRE, sans quoi le contrôle qu'elle vise ne regarde rien.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';

  dossier_client uuid; dossier_notes uuid; cabinet uuid; piece_client uuid; piece_notes uuid; piece_notes_2 uuid;
  document_notes uuid; note_notes uuid;
  notes_avant int; admins_avant int; assignations_avant int; total_notes int; total_dossier_notes int;
  annotees int; sans_ligne int; differentes int; reprises int; doublons int; n int; m int; rendue uuid; maj timestamptz;
  texte_relu text; code_recu text; message text; obs text; verdicts jsonb := '[]'::jsonb;
begin
  select mb.dossier_id into dossier_client from memberships mb where mb.user_id = client order by mb.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_client;
  select ni.dossier_id into dossier_notes from notes_internes ni where ni.piece_id is not null
    group by ni.dossier_id order by count(*) desc, ni.dossier_id limit 1;
  select id into piece_client from pieces where dossier_id = dossier_client order by id limit 1;
  select ni.piece_id, ni.id into piece_notes, note_notes from notes_internes ni where ni.dossier_id = dossier_notes and ni.piece_id is not null
    order by ni.piece_id limit 1;
  select p.id into piece_notes_2 from pieces p where p.dossier_id = dossier_notes
    and not exists (select 1 from notes_internes ni where ni.piece_id = p.id) order by p.id limit 1;
  select d.id into document_notes from documents_divers d where d.dossier_id = dossier_notes
    and not exists (select 1 from notes_internes ni where ni.document_id = d.id) order by d.id limit 1;
  if dossier_client is null or cabinet is null or dossier_notes is null or dossier_notes = dossier_client
     or piece_client is null or piece_notes is null or piece_notes_2 is null or document_notes is null
     or (select cabinet_id from dossiers where id = dossier_notes) <> cabinet
     or exists (select 1 from notes_internes where piece_id = piece_client)
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client)
     or exists (select 1 from memberships where user_id = client and dossier_id = dossier_notes) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou compte client déjà rattaché au cabinet';
  end if;
  select count(*) into notes_avant from notes_internes;
  select count(*) into admins_avant from cabinet_admins;
  select count(*) into assignations_avant from dossier_assignations;
  select count(*) into total_dossier_notes from notes_internes where dossier_id = dossier_notes;

  -- ══ 1 à 4. Les anciennes colonnes : rien n'est perdu de vue ═══════════════════════════════════════════════
  -- « Reprise » : modifiée depuis sa création (la base pose `updated_at`). Une note jamais reprise doit être celle de
  -- l'ancienne colonne ; une différence dirait une écriture dans l'ancienne colonne APRÈS la recopie.
  select count(*) filter (where p.notes is not null and btrim(p.notes, E' \t\n\r') <> ''),
         count(*) filter (where p.notes is not null and btrim(p.notes, E' \t\n\r') <> '' and ni.id is null),
         count(*) filter (where ni.id is not null and ni.updated_at = ni.created_at and ni.texte is distinct from p.notes),
         count(*) filter (where ni.id is not null and ni.updated_at <> ni.created_at)
    into annotees, sans_ligne, differentes, reprises
    from pieces p left join notes_internes ni on ni.piece_id = p.id and ni.dossier_id = p.dossier_id;
  verdicts := verdicts || jsonb_build_object('controle', '1. chaque note ancienne d''une pièce a sa ligne, identique tant que personne ne l''a reprise',
    'observe', annotees || ' annotée(s), ' || sans_ligne || ' sans ligne, ' || differentes || ' jamais reprise(s) mais différente(s), '
      || reprises || ' reprise(s) depuis',
    'ok', coalesce(annotees > 0 and sans_ligne = 0 and differentes = 0, false));

  select count(*) filter (where d.notes is not null and btrim(d.notes, E' \t\n\r') <> ''),
         count(*) filter (where d.notes is not null and btrim(d.notes, E' \t\n\r') <> '' and ni.id is null),
         count(*) filter (where ni.id is not null and ni.updated_at = ni.created_at and ni.texte is distinct from d.notes),
         count(*) filter (where ni.id is not null and ni.updated_at <> ni.created_at)
    into annotees, sans_ligne, differentes, reprises
    from documents_divers d left join notes_internes ni on ni.document_id = d.id and ni.dossier_id = d.dossier_id;
  verdicts := verdicts || jsonb_build_object('controle', '2. chaque note ancienne d''un document a sa ligne, identique tant que personne ne l''a reprise',
    'observe', annotees || ' annotée(s), ' || sans_ligne || ' sans ligne, ' || differentes || ' jamais reprise(s) mais différente(s), '
      || reprises || ' reprise(s) depuis',
    'ok', coalesce(sans_ligne = 0 and differentes = 0, false));

  code_recu := null; n := null; m := null;
  begin
    insert into notes_internes (dossier_id, piece_id, texte)
    select p.dossier_id, p.id, p.notes from pieces p
    where p.notes is not null and btrim(p.notes, E' \t\n\r') <> ''
      and not exists (select 1 from notes_internes x where x.piece_id = p.id);
    get diagnostics n = row_count;
    insert into notes_internes (dossier_id, document_id, texte)
    select d.dossier_id, d.id, d.notes from documents_divers d
    where d.notes is not null and btrim(d.notes, E' \t\n\r') <> ''
      and not exists (select 1 from notes_internes x where x.document_id = d.id);
    get diagnostics m = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  select count(*) into doublons from (select piece_id from notes_internes where piece_id is not null group by piece_id having count(*) > 1
    union all select document_id from notes_internes where document_id is not null group by document_id having count(*) > 1) x;
  verdicts := verdicts || jsonb_build_object('controle', '3. rejouée, la recopie n''ajoute rien, et aucune cible n''a deux notes',
    'observe', coalesce(n || ' + ' || m || ' ligne(s) ajoutée(s), ', '') || doublons || ' cible(s) en double, ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 0 and m = 0 and doublons = 0 and code_recu = 'P0001', false));

  select count(*) into n from dossiers where notes is not null;
  verdicts := verdicts || jsonb_build_object('controle', '4. la fiche d''un dossier ne porte aucune note : rien n''est à recopier',
    'observe', n || ' dossier(s) annoté(s)', 'ok', n = 0);

  -- ══ 5 et 6. Le catalogue ═══════════════════════════════════════════════════════════════════════════════════
  select count(*) into n from pg_policy po
   where po.polrelid = 'public.notes_internes'::regclass and po.polcmd = '*' and po.polroles = array['authenticated'::regrole]::oid[]
     and pg_get_expr(po.polqual, po.polrelid) = 'admin_du_dossier(dossier_id)'
     and pg_get_expr(po.polwithcheck, po.polrelid) like '(admin_du_dossier(dossier_id) AND %'
     and pg_get_expr(po.polwithcheck, po.polrelid) like '%p.dossier_id = notes_internes.dossier_id%'
     and pg_get_expr(po.polwithcheck, po.polrelid) like '%d.dossier_id = notes_internes.dossier_id%';
  select count(*) into m from pg_policy po where po.polrelid = 'public.notes_internes'::regclass;
  verdicts := verdicts || jsonb_build_object('controle', '5. une seule policy, pour toutes les commandes, aux connectés, sur admin_du_dossier et la cible du dossier ; RLS active',
    'observe', m || ' policy(s), ' || n || ' conforme(s), RLS ' || (select relrowsecurity from pg_class where oid = 'public.notes_internes'::regclass)
      || ', branche client ' || (select count(*) from pg_policy po where po.polrelid = 'public.notes_internes'::regclass
                                   and (coalesce(pg_get_expr(po.polqual, po.polrelid), '') || coalesce(pg_get_expr(po.polwithcheck, po.polrelid), '')) like '%memberships%'),
    'ok', coalesce(m = 1 and n = 1 and (select relrowsecurity from pg_class where oid = 'public.notes_internes'::regclass), false));

  select string_agg(p.proname, ', ' order by p.proname) into obs from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosrc ~ '\mnotes\M';
  verdicts := verdicts || jsonb_build_object('controle', '6. aucune fonction SQL n''écrit les anciennes colonnes : seules les nomment enregistrer_facture (la note d''une facture) et garder_piece_validee (qui la laisse libre)',
    'observe', coalesce(obs, 'aucune'), 'ok', coalesce(obs = 'enregistrer_facture, garder_piece_validee', false));

  -- ══ 7 et 8. L'anonyme et le compte rattaché à rien ════════════════════════════════════════════════════════
  select count(*) into total_notes from notes_internes;
  n := null;
  begin
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    select count(*) into n from notes_internes;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '7. l''anonyme ne voit aucune note',
    'observe', coalesce(n::text, '?') || ' vue(s) sur ' || total_notes, 'ok', coalesce(n = 0 and total_notes > 0, false));

  n := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    select count(*) into n from notes_internes;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '8. un compte rattaché à rien ne voit aucune note',
    'observe', coalesce(n::text, '?') || ' vue(s) sur ' || total_notes, 'ok', coalesce(n = 0 and total_notes > 0, false));

  -- ══ 9 à 11. Le client, sur SON dossier, où une note d'essai est posée ═════════════════════════════════════
  n := null; m := null; code_recu := null;
  begin
    insert into notes_internes (dossier_id, piece_id, texte) values (dossier_client, piece_client, 'Note d''essai du cabinet');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from notes_internes where dossier_id = dossier_client;
    select count(*) into m from notes_internes;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '9. le client ne lit aucune note, pas même celle d''une pièce de son dossier',
    'observe', coalesce(n::text, '?') || ' vue(s) dans son dossier, ' || coalesce(m::text, '?') || ' en tout, ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 0 and m = 0 and code_recu = 'P0001', false));

  code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    insert into notes_internes (dossier_id, piece_id, texte) values (dossier_client, piece_client, 'Écrite par le client');
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '10. le client n''écrit pas une note, même sur une pièce de son dossier',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''), 'ok', coalesce(code_recu = '42501', false));

  n := null; code_recu := null;
  begin
    insert into notes_internes (dossier_id, piece_id, texte) values (dossier_client, piece_client, 'Note d''essai du cabinet');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    update notes_internes set texte = 'Réécrite par le client' where piece_id = piece_client;
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '11. le client ne modifie pas la note de sa pièce : aucune ligne touchée',
    'observe', coalesce(n::text, '?') || ' ligne(s), ' || coalesce(code_recu, '?'), 'ok', coalesce(n = 0 and code_recu = 'P0001', false));

  -- ══ 12 à 14. Le chef du cabinet ═════════════════════════════════════════════════════════════════════════════
  n := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into n from notes_internes;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '12. le chef lit toutes les notes de ses dossiers',
    'observe', coalesce(n::text, '?') || ' vue(s) sur ' || total_notes, 'ok', coalesce(n = total_notes and n > 0, false));

  -- La date d'une note reprise vient de la base : l'écran envoie ici une date de l'an 2000, et c'est `now()` qui reste.
  -- Effacée, la note reste une ligne au texte vide.
  rendue := null; n := null; m := null; maj := null; texte_relu := null; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into notes_internes (dossier_id, piece_id, texte) values (dossier_client, piece_client, 'Note d''essai du chef')
      returning id into rendue;
    update notes_internes set texte = 'Note d''essai du chef, reprise', updated_at = '2000-01-01T00:00:00Z' where id = rendue;
    get diagnostics n = row_count;
    select updated_at into maj from notes_internes where id = rendue;
    update notes_internes set texte = '' where id = rendue;
    get diagnostics m = row_count;
    select texte into texte_relu from notes_internes where id = rendue;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '13. le chef écrit, reprend et efface une note ; la date vient de la base, la ligne reste',
    'observe', coalesce(rendue::text, 'aucune ligne') || ', ' || coalesce(n::text, '?') || ' reprise(s), date de l''an '
      || coalesce(to_char(maj, 'YYYY'), '?') || ', ' || coalesce(m::text, '?') || ' effacée(s), texte relu de '
      || coalesce(length(texte_relu)::text, '?') || ' caractère(s), ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(rendue is not null and n = 1 and maj = now() and m = 1 and texte_relu = '' and code_recu = 'P0001', false));

  rendue := null; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into notes_internes (dossier_id, document_id, texte) values (dossier_notes, document_notes, 'Note d''essai d''un document')
      returning id into rendue;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '14. le chef écrit la note d''un document',
    'observe', coalesce(rendue::text, 'aucune ligne') || ', ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(rendue is not null and code_recu = 'P0001', false));

  -- ══ 15 à 19. Ce qu'une note est : une cible du dossier annoncé, une seule, un texte ═══════════════════════════
  for obs in select unnest(array[
      '15. une pièce d''un autre dossier que celui annoncé|42501',
      '16. un document d''un autre dossier que celui annoncé|42501',
      '17. une pièce et un document à la fois|23514',
      '18. un texte absent|23502',
      '19. une seconde note pour la même pièce|23505']) loop
    code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      case substring(obs from '^(\d+)')
        when '15' then insert into notes_internes (dossier_id, piece_id, texte) values (dossier_client, piece_notes_2, 'Cible d''ailleurs');
        when '16' then insert into notes_internes (dossier_id, document_id, texte) values (dossier_client, document_notes, 'Cible d''ailleurs');
        when '17' then insert into notes_internes (dossier_id, piece_id, document_id, texte) values (dossier_notes, piece_notes_2, document_notes, 'Deux cibles');
        when '18' then insert into notes_internes (dossier_id, piece_id, texte) values (dossier_notes, piece_notes_2, null);
        else insert into notes_internes (dossier_id, piece_id, texte) values (dossier_notes, piece_notes, 'Une seconde note');
      end case;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', split_part(obs, '|', 1) || ' : refusée (' || split_part(obs, '|', 2) || ')',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''), 'ok', coalesce(code_recu = split_part(obs, '|', 2), false));
  end loop;

  -- Sans cible : la policy la refuse à un compte connecté ; au propriétaire de la base, qui passe la RLS, sa contrainte.
  code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into notes_internes (dossier_id, texte) values (dossier_notes, 'Aucune cible');
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  message := null;
  begin
    insert into notes_internes (dossier_id, texte) values (dossier_notes, 'Aucune cible');
    raise exception 'ANNULATION_ESSAI';
  exception when others then message := sqlstate;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '17b. une note sans cible : refusée par la policy (42501), et par sa contrainte au propriétaire (23514)',
    'observe', 'chef ' || coalesce(code_recu, '?') || ', propriétaire ' || coalesce(message, '?'),
    'ok', coalesce(code_recu = '42501' and message = '23514', false));

  -- ══ 20. Un chef qui n'est pas super-administrateur ═════════════════════════════════════════════════════════
  n := null; rendue := null; code_recu := null; message := null; obs := null;
  begin
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from notes_internes where dossier_id = dossier_notes;
    insert into notes_internes (dossier_id, piece_id, texte) values (dossier_notes, piece_notes_2, 'Note d''essai d''un chef')
      returning id into rendue;
    obs := 'super-administrateur ' || is_super_admin();
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '20. un chef du cabinet qui n''est pas super-administrateur lit et écrit les notes d''un dossier du cabinet',
    'observe', coalesce(n::text, '?') || ' vue(s) sur ' || total_dossier_notes || ', ' || coalesce(rendue::text, 'aucune ligne') || ', '
      || coalesce(obs, '?') || ', ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(n = total_dossier_notes and rendue is not null and obs = 'super-administrateur false' and code_recu = 'P0001', false));

  -- ══ 21 et 22. Le membre affecté au dossier, et celui d'un autre dossier ══════════════════════════════════════
  n := null; m := null; rendue := null; code_recu := null; message := null;
  begin
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
    insert into dossier_assignations (dossier_id, user_id) values (dossier_notes, client);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from notes_internes where dossier_id = dossier_notes;
    select count(*) into m from notes_internes where dossier_id <> dossier_notes;
    insert into notes_internes (dossier_id, piece_id, texte) values (dossier_notes, piece_notes_2, 'Note d''essai d''un membre')
      returning id into rendue;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '21. le membre affecté au dossier en lit et en écrit les notes, et celles-là seules',
    'observe', coalesce(n::text, '?') || ' vue(s) sur ' || total_dossier_notes || ', ' || coalesce(m::text, '?') || ' d''ailleurs, '
      || coalesce(rendue::text, 'aucune ligne') || ', ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(n = total_dossier_notes and n > 0 and m = 0 and rendue is not null and code_recu = 'P0001', false));

  n := null; m := null; code_recu := null; message := null; obs := null;
  begin
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
    insert into dossier_assignations (dossier_id, user_id) values (dossier_client, client);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from notes_internes where dossier_id = dossier_notes;
    update notes_internes set texte = 'Réécrite par un autre membre' where id = note_notes;
    get diagnostics m = row_count;
    obs := 'affecté ailleurs ' || admin_du_dossier(dossier_client);
    begin
      insert into notes_internes (dossier_id, piece_id, texte) values (dossier_notes, piece_notes_2, 'Note d''un autre membre');
    exception when others then message := sqlstate;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '22. le membre affecté à un autre dossier n''en lit, n''en modifie ni n''en écrit aucune',
    'observe', coalesce(n::text, '?') || ' vue(s), ' || coalesce(m::text, '?') || ' modifiée(s), écriture ' || coalesce(message, 'ACCEPTÉE')
      || ', ' || coalesce(obs, '?') || ', ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 0 and m = 0 and message = '42501' and obs = 'affecté ailleurs true' and code_recu = 'P0001', false));

  -- ══ 31 à 35. Les mutations : chacune doit MORDRE ═══════════════════════════════════════════════════════════
  -- 31. Le contrôle 9 sans le passage au rôle `authenticated` (le propriétaire passe la RLS) : le client « verrait ».
  n := null;
  begin
    insert into notes_internes (dossier_id, piece_id, texte) values (dossier_client, piece_client, 'Note d''essai du cabinet');
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from notes_internes where dossier_id = dossier_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '31. MUTATION — le contrôle 9 sans le changement de rôle : il doit voir la note',
    'observe', coalesce(n::text, '?') || ' vue(s)', 'ok', coalesce(n >= 1, false));

  -- 32. Le contrôle 9 joué sous le chef : il voit la note.
  n := null;
  begin
    insert into notes_internes (dossier_id, piece_id, texte) values (dossier_client, piece_client, 'Note d''essai du cabinet');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into n from notes_internes where dossier_id = dossier_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '32. MUTATION — le contrôle 9 joué sous le chef : il doit voir la note',
    'observe', coalesce(n::text, '?') || ' vue(s)', 'ok', coalesce(n = 1, false));

  -- 33. Le contrôle 10 joué sous le chef : l'écriture passe.
  rendue := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into notes_internes (dossier_id, piece_id, texte) values (dossier_client, piece_client, 'Écrite par le chef') returning id into rendue;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '33. MUTATION — le contrôle 10 joué sous le chef : l''écriture doit passer',
    'observe', coalesce(rendue::text, 'refusée'), 'ok', rendue is not null);

  -- 34. Le contrôle 15 avec une cible DU dossier annoncé : l'écriture passe.
  rendue := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into notes_internes (dossier_id, piece_id, texte) values (dossier_notes, piece_notes_2, 'Cible du dossier') returning id into rendue;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '34. MUTATION — le contrôle 15 avec la cible du dossier annoncé : l''écriture doit passer',
    'observe', coalesce(rendue::text, 'refusée'), 'ok', rendue is not null);

  -- 35. Le contrôle 22 avec l'affectation au BON dossier : le membre voit les notes.
  n := null;
  begin
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
    insert into dossier_assignations (dossier_id, user_id) values (dossier_notes, client);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from notes_internes where dossier_id = dossier_notes;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '35. MUTATION — le contrôle 22 affecté au bon dossier : il doit voir les notes',
    'observe', coalesce(n::text, '?') || ' vue(s)', 'ok', coalesce(n > 0, false));

  -- ══ 40. Rien n'est resté ════════════════════════════════════════════════════════════════════════════════════
  verdicts := verdicts || jsonb_build_object('controle', '40. rien n''est resté en base',
    'observe', 'notes ' || notes_avant || ' -> ' || (select count(*) from notes_internes)
      || ', chefs et membres ' || admins_avant || ' -> ' || (select count(*) from cabinet_admins)
      || ', affectations ' || assignations_avant || ' -> ' || (select count(*) from dossier_assignations),
    'ok', coalesce(notes_avant = (select count(*) from notes_internes)
      and admins_avant = (select count(*) from cabinet_admins)
      and assignations_avant = (select count(*) from dossier_assignations)
      and not exists (select 1 from cabinet_admins where user_id = client)
      and not exists (select 1 from notes_internes where piece_id = piece_client), false));

  perform set_config('essai.notes_internes', verdicts::text, true);
end $$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier sans ses lignes de commentaire
-- (`grep -v '^\s*--'`) par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.notes_internes')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
