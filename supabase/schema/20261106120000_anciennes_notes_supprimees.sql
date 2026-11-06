-- LES ANCIENNES COLONNES DES NOTES INTERNES SUPPRIMÉES (espace client, étape P0 ; décision du cabinet EC-Q7 du 17/10/2026 :
-- « oui, déplacer puis supprimer l'ancien champ »). Le récit : HISTORIQUE.md, « 06/11/2026 — LES ANCIENNES COLONNES DES
-- NOTES SUPPRIMÉES (P0, EC-Q7) (PRÉPARÉE, PAS APPLIQUÉE) » ; la recopie qu'elle termine : « LES NOTES INTERNES DU CABINET,
-- HORS DE PORTÉE DU CLIENT » et supabase/schema/20261009185236_notes_internes_du_cabinet.sql ; l'essai :
-- supabase/essais/notesInternes.sql (ses contrôles 1 à 4 d'hier, puis, avec elle, le contrôle 1 qui la constate).
--
-- CE QU'ELLE DÉTRUIT : trois colonnes, `pieces.notes`, `documents_divers.notes` et `dossiers.notes`, et ce qu'elles portent
-- — la copie figée au 09/10/2026 des notes internes du cabinet, que le client du dossier lit encore. Relevé en production
-- le 06/11/2026, des comptes seulement : 11 pièces et 7 documents annotés, chacun retrouvé dans `notes_internes` au
-- caractère près, aucune note reprise depuis, aucun dossier annoté. Rien d'autre : aucun objet ne dépend de ces colonnes
-- (ni vue, ni policy, ni déclencheur, ni index, ni contrainte : `pg_depend`, le même jour), et le `drop` sans `cascade` se
-- refuserait si un objet était venu en dépendre depuis. Aucune fonction ne les lit ni ne les écrit : `garder_piece_validee`
-- nomme encore la clé `notes` parmi ce qui reste libre sur une pièce figée (`to_jsonb(new) - array['notes', …]`) — retirer
-- une clé absente est sans effet, et la réécrire toucherait la garde du gel pour rien ; `enregistrer_facture` et
-- `enregistrer_devis` nomment la note d'une facture et celle d'un devis, d'autres colonnes.
--
-- L'ORDRE : les quatre tables verrouillées d'abord — les trois en accès exclusif, que le `drop` prendrait de toute façon,
-- `notes_internes` en mode exclusif (elle se lit encore, ne s'écrit plus jusqu'à la fin) : rien ne s'écrit entre la garde
-- et la suppression. Un `lock table` hors d'une transaction se refuse : ce texte ne se joue que d'un seul tenant.
--
-- SA GARDE, avant toute suppression :
--   0. les trois colonnes existent, en `text` — sinon elle refuse : déjà appliquée, ou une base qu'elle ne connaît pas.
--      Elle NE SE REJOUE PAS ;
--   1. chaque note non blanche d'une pièce ou d'un document (blanche : faite d'espaces, de tabulations, de sauts de ligne
--      et de retours chariot, la règle de la recopie) a sa ligne dans `notes_internes` — même cible, même dossier — au même
--      texte tant que personne ne l'a reprise (`updated_at = created_at`) : la condition de `notesInternes.sql`
--      (contrôles 1 et 2), « la condition qu'exigera la suppression des anciennes colonnes ». Une ligne reprise depuis
--      fait foi, comme à l'écran ;
--   2. aucun dossier ne porte de note non blanche : `notes_internes` n'a pas de place pour elle.
-- Un manque la fait refuser (23514) en ne disant que des comptes, jamais un texte ni un identifiant : rien n'est supprimé.
--
-- ELLE SE COLLE : le texte retire des colonnes (`drop column`), et `apply_migration` attendrait une confirmation. Le cabinet
-- la colle dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique : version 20261106120000, nom
-- `anciennes_notes_supprimees`, le texte de ce fichier. Ni barre oblique inverse, ni retour chariot. Son retour arrière :
-- supabase/preparees/retour/20261106120100_retour_anciennes_notes_supprimees.sql (trois colonnes vides, pas les notes).

lock table public.pieces, public.documents_divers, public.dossiers in access exclusive mode;
lock table public.notes_internes in exclusive mode;

do $garde$
declare
  v_blancs constant text := ' ' || chr(9) || chr(10) || chr(13);
  v_colonnes integer;
  v_pieces_annotees bigint;
  v_pieces_sans_ligne bigint;
  v_pieces_differentes bigint;
  v_pieces_reprises bigint;
  v_documents_annotes bigint;
  v_documents_sans_ligne bigint;
  v_documents_differents bigint;
  v_documents_repris bigint;
  v_dossiers_annotes bigint;
begin
  select count(*) into v_colonnes
    from pg_attribute a
   where a.attrelid in ('public.pieces'::regclass, 'public.documents_divers'::regclass, 'public.dossiers'::regclass)
     and a.attname = 'notes' and a.attnum > 0 and not a.attisdropped and a.atttypid = 'text'::regtype;
  if v_colonnes <> 3 then
    raise exception 'Les trois anciennes colonnes des notes ne sont pas toutes en base (% sur 3) : cette migration est déjà appliquée, ou la base n''est pas celle qu''elle connaît. Rien n''est supprimé.',
      v_colonnes using errcode = '23514';
  end if;

  -- Les instructions qui suivent nomment les anciennes colonnes : elles ne s'analysent qu'à leur exécution, donc après
  -- la vérification ci-dessus.
  select count(*),
         count(*) filter (where n.id is null),
         count(*) filter (where n.id is not null and n.updated_at = n.created_at and n.texte is distinct from p.notes),
         count(*) filter (where n.id is not null and n.updated_at <> n.created_at)
    into v_pieces_annotees, v_pieces_sans_ligne, v_pieces_differentes, v_pieces_reprises
    from public.pieces p
    left join public.notes_internes n on n.piece_id = p.id and n.dossier_id = p.dossier_id
   where p.notes is not null and btrim(p.notes, v_blancs) <> '';

  select count(*),
         count(*) filter (where n.id is null),
         count(*) filter (where n.id is not null and n.updated_at = n.created_at and n.texte is distinct from d.notes),
         count(*) filter (where n.id is not null and n.updated_at <> n.created_at)
    into v_documents_annotes, v_documents_sans_ligne, v_documents_differents, v_documents_repris
    from public.documents_divers d
    left join public.notes_internes n on n.document_id = d.id and n.dossier_id = d.dossier_id
   where d.notes is not null and btrim(d.notes, v_blancs) <> '';

  select count(*) into v_dossiers_annotes
    from public.dossiers o
   where o.notes is not null and btrim(o.notes, v_blancs) <> '';

  if v_pieces_sans_ligne + v_pieces_differentes + v_documents_sans_ligne + v_documents_differents + v_dossiers_annotes > 0 then
    raise exception 'Les anciennes notes ne sont pas toutes dans notes_internes : % pièce(s) et % document(s) annotés sans leur ligne, % pièce(s) et % document(s) dont la ligne, jamais reprise, porte un autre texte, % dossier(s) annoté(s). Rien n''est supprimé.',
      v_pieces_sans_ligne, v_documents_sans_ligne, v_pieces_differentes, v_documents_differents, v_dossiers_annotes
      using errcode = '23514';
  end if;

  raise notice 'Anciennes notes retrouvées dans notes_internes : % de pièces (dont % reprises depuis) et % de documents (dont % reprises depuis) ; aucun dossier annoté.',
    v_pieces_annotees, v_pieces_reprises, v_documents_annotes, v_documents_repris;
end;
$garde$;

alter table public.pieces drop column notes;
alter table public.documents_divers drop column notes;
alter table public.dossiers drop column notes;
