-- A8Q5-Q4 — LA PIÈCE D'UN PAIEMENT, TENUE DANS SON DOSSIER (ligne 51.5 ; décision du cabinet du 16/11/2026, « (A) Une garde en
-- base », à la recommandation). PRÉPARÉE le 16/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 16/11/2026 — A8Q5-Q4,
-- A8Q5Q3Q2-Q3 ET A8Q5Q3Q2Q2-Q1 : TROIS MIGRATIONS PRÉPARÉES APRÈS LA GARDE DES RÈGLEMENTS » ; l'essai :
-- supabase/essais/pieceDUnPaiementDansSonDossier.sql (EN ATTENTE sans elle) ; le retour :
-- supabase/preparees/retour/20261116140100_retour_piece_d_un_paiement_dans_son_dossier.sql ; le module qui redit ses refus :
-- src/lib/pieceDUnPaiementDansSonDossier.ts (`PIECE_D_UN_PAIEMENT_DANS_SON_DOSSIER_PREVUE`, baissé jusqu'à l'application).
--
-- SOURCES. La règle des dossiers de l'application (CLAUDE.md, « RLS multi-cabinets » : toute ligne d'un dossier se juge par son
-- dossier) ; CFCS-Q1 (le chemin d'un fichier dans son dossier, en base, posé après un relevé de zéro ligne fautive) ; A8Q5-Q4
-- (relecture adverse du 14/11/2026). PostgreSQL 17, « CREATE TRIGGER » (des déclencheurs BEFORE d'un même évènement se
-- déclenchent dans l'ordre alphabétique de leur nom ; une contrainte de clé étrangère se vérifie APRÈS eux).
--
-- LE CAS. Rien ne tenait la pièce d'un mouvement du relevé, ni celle de la part d'un virement groupé, dans le dossier de la
-- ligne : la base vérifiait seulement qu'elle existe. Les calculs de l'application ne lisent que les paiements de son dossier
-- (`paiementsDesPieces`, `recu_par_la_piece`), mais une garde qui juge la pièce citée — celle des factures reprises, celle de
-- l'exemplaire d'une facture source — répondait alors sur la pièce d'un dossier que l'auteur du geste ne lit pas, et son refus
-- en disait le nom de fichier et la facture. Il faut connaître l'identifiant de la pièce, que la base ne montre pas hors de son
-- dossier ; rien ne le retenait.
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. `garder_piece_dans_son_dossier`, une garde `security definer` (son chemin fixé, exécutable par aucun rôle de session) :
--      - sur `lignes_bancaires` (l'insertion, ou la mise à jour de la pièce ou du dossier) : la pièce d'un mouvement est une
--        pièce de son dossier ; et un mouvement dont des parts de virement groupé citent une pièce ne change pas de dossier ;
--      - sur `reglements_groupes` (l'insertion, ou la mise à jour de la pièce, du dossier ou du mouvement) : la pièce d'une part
--        est une pièce du dossier de la part ET de celui de son mouvement ;
--      - sur `pieces` (la mise à jour du dossier) : une pièce qu'un mouvement du relevé ou une part de virement groupé cite ne
--        change pas de dossier (le côté pièce de la même relation, comme `pieces_payees_par_la_caisse` pour la caisse).
--      Un refus ne dit ni le nom de la pièce ni son dossier, et ne distingue pas une pièce d'un autre dossier d'un identifiant
--      inconnu : la garde tire AVANT la clé étrangère.
--   2. Trois déclencheurs BEFORE, nommés pour tirer juste après la porte d'accès (`_acces_avant_les_gardes`, qui juge
--      l'appelant par les policies) et AVANT toute garde qui lit la pièce citée (`…_figees_par_la_validation`,
--      `…_piece_d_une_facture_reprise`, `…_sans_exemplaire_d_une_source`…) : `lignes_bancaires_dans_son_dossier`,
--      `reglements_groupes_dans_son_dossier` ; sur `pieces`, `pieces_reglees_dans_leur_dossier`.
--   Le paiement par la caisse tient déjà sa pièce dans son dossier : la garde de la table (`garder_operation_caisse`, « La
--   pièce d'un paiement par la caisse est une pièce de son dossier. »), une opération ne se modifiant pas, et la pièce payée
--   ne changeant pas de dossier (`pieces_payees_par_la_caisse`) ; l'essai le rejoue, rien ne s'y ajoute.
--
-- LE RELEVÉ. La garde de tête refuse de s'appliquer tant qu'une ligne en base cite déjà une pièce d'un autre dossier — un
-- mouvement, une part (sa pièce hors du dossier de la part ou de son mouvement), un paiement par la caisse : un tel état se
-- relève et se corrige d'abord (relevé de zéro ligne fautive, comme CFCS-Q1).
--
-- CE QU'ELLE NE CHANGE PAS : aucune table, aucune colonne, aucune donnée, aucune policy, aucune fonction d'hier. Une ligne
-- sans pièce passe comme hier ; une pièce supprimée met encore à nul la pièce des lignes qui la citent (la clé étrangère, à
-- nul : la garde le laisse passer). La restauration réinsère les pièces avant leurs paiements, du même dossier.
--
-- COMMENT ELLE S'APPLIQUE : aucune instruction de retrait ni de vidage, aucune barre oblique inverse, aucune fonction
-- remplacée — PAR L'OUTIL. Indépendante des autres migrations préparées : aucune ne pose un déclencheur de ces noms ni cette
-- fonction ; elle s'applique avant ou après `plancher_a_l_ecart_d_alignement` et `especes_du_client_hors_des_reprises`.
-- Le jour de son application, `PIECE_D_UN_PAIEMENT_DANS_SON_DOSSIER_PREVUE` se lève et le fichier entre dans
-- supabase/schema/ sous la version que porte sa ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regprocedure('public.garder_piece_dans_son_dossier()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgname in ('lignes_bancaires_dans_son_dossier', 'reglements_groupes_dans_son_dossier',
                                    'pieces_reglees_dans_leur_dossier') and not t.tgisinternal) then
    raise exception 'A8Q5-Q4 : la garde de la pièce d''un paiement est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (('lignes_bancaires', 'piece_id'), ('lignes_bancaires', 'dossier_id'),
                                           ('reglements_groupes', 'piece_id'), ('reglements_groupes', 'dossier_id'),
                                           ('reglements_groupes', 'ligne_bancaire_id'), ('operations_caisse', 'piece_id'),
                                           ('operations_caisse', 'dossier_id'), ('pieces', 'dossier_id'))) <> 8 then
    raise exception 'A8Q5-Q4 : une colonne que la garde lit manque (lignes_bancaires, reglements_groupes, operations_caisse, pieces).';
  end if;
  -- La porte d'accès, première des déclencheurs BEFORE de ces deux tables et de `pieces` (GARDES-Q1, en production depuis le
  -- 15/11/2026) : la garde neuve tire après elle.
  if (select count(*) from pg_catalog.pg_trigger t
       where t.tgname = '_acces_avant_les_gardes' and not t.tgisinternal
         and t.tgrelid in ('public.lignes_bancaires'::regclass, 'public.reglements_groupes'::regclass, 'public.pieces'::regclass)) <> 3 then
    raise exception 'A8Q5-Q4 : la porte d''accès (_acces_avant_les_gardes) manque sur lignes_bancaires, reglements_groupes ou pieces.';
  end if;
  -- Aucune ligne ne cite déjà une pièce d'un autre dossier (le relevé de zéro ligne fautive, comme CFCS-Q1).
  if exists (select 1 from public.lignes_bancaires l join public.pieces p on p.id = l.piece_id
              where p.dossier_id is distinct from l.dossier_id)
     or exists (select 1 from public.reglements_groupes g
                  join public.pieces p on p.id = g.piece_id
                  join public.lignes_bancaires l on l.id = g.ligne_bancaire_id
                 where p.dossier_id is distinct from g.dossier_id or l.dossier_id is distinct from g.dossier_id)
     or exists (select 1 from public.operations_caisse o join public.pieces p on p.id = o.piece_id
                 where p.dossier_id is distinct from o.dossier_id) then
    raise exception 'A8Q5-Q4 : un mouvement du relevé, une part de virement groupé ou un paiement par la caisse cite déjà une pièce d''un autre dossier : le relever et le corriger avant d''appliquer cette migration.';
  end if;
end
$garde$;

-- ══ 1. La garde : la pièce d'un paiement est une pièce de son dossier ══════════
create function public.garder_piece_dans_son_dossier() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'pieces' then
    -- La mise à jour du dossier d'une pièce (la clause WHEN : il change) : citée par un mouvement du relevé ou par une part,
    -- de son dossier, elle n'en change pas.
    if exists (select 1 from public.lignes_bancaires l where l.piece_id = old.id)
       or exists (select 1 from public.reglements_groupes g where g.piece_id = old.id) then
      raise exception 'Cette pièce est citée par un mouvement du relevé, ou par la part d''un virement groupé, de son dossier : elle ne change pas de dossier.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if tg_table_name = 'reglements_groupes' then
    -- La pièce d'une part : du dossier de la part et de celui de son mouvement. Une pièce inconnue se refuse sous les mêmes
    -- mots qu'une pièce d'un autre dossier : la garde tire avant la clé étrangère, et ne dit rien de ce qui n'est pas au dossier.
    if new.piece_id is not null and not exists (
         select 1 from public.pieces p join public.lignes_bancaires l on l.id = new.ligne_bancaire_id
          where p.id = new.piece_id and p.dossier_id = new.dossier_id and l.dossier_id = new.dossier_id) then
      raise exception 'La pièce d''une part d''un virement groupé est une pièce du dossier de ce virement.' using errcode = '23514';
    end if;
    return new;
  end if;
  -- `lignes_bancaires`. La pièce d'un mouvement : de son dossier, quand elle change ou que le dossier change.
  if new.piece_id is not null
     and (tg_op = 'INSERT' or new.piece_id is distinct from old.piece_id or new.dossier_id is distinct from old.dossier_id)
     and not exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id) then
    raise exception 'La pièce d''un mouvement du relevé est une pièce de son dossier.' using errcode = '23514';
  end if;
  -- Un mouvement dont des parts de virement groupé citent une pièce reste dans le dossier de ces pièces.
  if tg_op = 'UPDATE' and new.dossier_id is distinct from old.dossier_id
     and exists (select 1 from public.reglements_groupes g where g.ligne_bancaire_id = old.id and g.piece_id is not null) then
    raise exception 'Ce mouvement règle en groupe des pièces de son dossier : il ne change pas de dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function public.garder_piece_dans_son_dossier() is
  'A8Q5-Q4 : la pièce d''un paiement est une pièce de son dossier — la pièce d''un mouvement du relevé (lignes_bancaires), celle d''une part de virement groupé (reglements_groupes : du dossier de la part et de son mouvement) ; un mouvement dont des parts citent une pièce, une pièce qu''un mouvement ou une part cite, ne changent pas de dossier (23514). Tire après la porte d''accès et avant toute garde qui lit la pièce citée ; ne distingue pas une pièce d''un autre dossier d''un identifiant inconnu.';

revoke all on function public.garder_piece_dans_son_dossier() from public, anon, authenticated, service_role;

-- ══ 2. Les trois déclencheurs : après la porte, avant toute garde qui lit la pièce ══════════
create trigger lignes_bancaires_dans_son_dossier
  before insert or update of piece_id, dossier_id on public.lignes_bancaires
  for each row execute function public.garder_piece_dans_son_dossier();
create trigger reglements_groupes_dans_son_dossier
  before insert or update of piece_id, dossier_id, ligne_bancaire_id on public.reglements_groupes
  for each row execute function public.garder_piece_dans_son_dossier();
create trigger pieces_reglees_dans_leur_dossier
  before update of dossier_id on public.pieces
  for each row when (old.dossier_id is distinct from new.dossier_id)
  execute function public.garder_piece_dans_son_dossier();

-- ══ 3. La garde de fin : le corps posé, ses droits, ses trois déclencheurs, et leur rang ══════════
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_piece_dans_son_dossier()')) is distinct from '0bcb5bae44df374dbbaf1f78128b6752'
     or (select not p.prosecdef or p.proconfig is distinct from array['search_path=public'] from pg_catalog.pg_proc p
          where p.oid = to_regprocedure('public.garder_piece_dans_son_dossier()'))
     or has_function_privilege('anon', 'public.garder_piece_dans_son_dossier()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_piece_dans_son_dossier()', 'execute')
     or has_function_privilege('service_role', 'public.garder_piece_dans_son_dossier()', 'execute') then
    raise exception 'A8Q5-Q4 : garder_piece_dans_son_dossier n''a pas le corps ou les droits de cette migration : rien n''est appliqué.';
  end if;
  if (select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname collate "C")
        from pg_catalog.pg_trigger t
       where t.tgfoid = to_regprocedure('public.garder_piece_dans_son_dossier()') and not t.tgisinternal)
     is distinct from 'CREATE TRIGGER lignes_bancaires_dans_son_dossier BEFORE INSERT OR UPDATE OF piece_id, dossier_id ON public.lignes_bancaires FOR EACH ROW EXECUTE FUNCTION garder_piece_dans_son_dossier() O ; '
                   || 'CREATE TRIGGER pieces_reglees_dans_leur_dossier BEFORE UPDATE OF dossier_id ON public.pieces FOR EACH ROW WHEN ((old.dossier_id IS DISTINCT FROM new.dossier_id)) EXECUTE FUNCTION garder_piece_dans_son_dossier() O ; '
                   || 'CREATE TRIGGER reglements_groupes_dans_son_dossier BEFORE INSERT OR UPDATE OF piece_id, dossier_id, ligne_bancaire_id ON public.reglements_groupes FOR EACH ROW EXECUTE FUNCTION garder_piece_dans_son_dossier() O' then
    raise exception 'A8Q5-Q4 : les trois déclencheurs ne sont pas ceux de cette migration : rien n''est appliqué.';
  end if;
  -- Leur rang : sur chacune des deux tables des paiements, la première garde BEFORE après la porte d'accès (les déclencheurs
  -- d'un même évènement tirent dans l'ordre de leur nom, octet par octet).
  if exists (select 1 from pg_catalog.pg_trigger t
              where t.tgrelid in ('public.lignes_bancaires'::regclass, 'public.reglements_groupes'::regclass)
                and not t.tgisinternal and (t.tgtype & 2) = 2
                and t.tgname <> '_acces_avant_les_gardes'
                and t.tgname not in ('lignes_bancaires_dans_son_dossier', 'reglements_groupes_dans_son_dossier')
                and t.tgname collate "C" < (case when t.tgrelid = 'public.lignes_bancaires'::regclass
                                                 then 'lignes_bancaires_dans_son_dossier' else 'reglements_groupes_dans_son_dossier' end) collate "C") then
    raise exception 'A8Q5-Q4 : une garde BEFORE tire avant celle de la pièce dans son dossier : rien n''est appliqué.';
  end if;
end
$fin$;
