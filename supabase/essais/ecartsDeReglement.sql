-- ESSAI DE LA MIGRATION `ecarts_de_reglement` (ligne 31, 31-changeFrais ; 12/11/2026). À rejouer après toute migration
-- qui touche `roles_comptables`, `plan_comptable_dossier` ou les gardes d'`ecritures_brouillon`. Une transaction annulée
-- en entier : rien n'est écrit. Sans la ligne d'historique de la migration, chaque contrôle se dit EN ATTENTE.
-- Rend une ligne par contrôle (« contrôle | observé | verdict »), et une ligne TOTAL. Sur la réplique seulement : il
-- écrit puis retire, sous un point de sauvegarde, une écriture d'essai dans le premier dossier fictif.

begin;
create temporary table verdicts (n int, controle text, observe text, ok boolean) on commit drop;

do $$
declare
  appliquee constant boolean := exists (select 1 from supabase_migrations.schema_migrations m where m.name = 'ecarts_de_reglement');
  v_texte text;
  v_dossier uuid;
  v_piece uuid;
  v_n int;
  v_erreur text;
begin
  if not appliquee then
    insert into verdicts values (0, 'la migration ecarts_de_reglement', 'absente de l''historique', null);
    return;
  end if;

  -- 1. Les deux rôles, tels que l'application les lit (src/lib/rolesDuChange.ts, confronté au texte de la migration).
  select string_agg(role || '|' || array_to_string(racines, ',') || '|' || compte_defaut || '|' || coalesce(libelle_defaut, '')
                    || '|' || coalesce(prefixe_auxiliaire_defaut, '') || '|' || ordre, E'\n' order by ordre)
    into v_texte from public.roles_comptables where role in ('pertes_de_change', 'gains_de_change');
  insert into verdicts values (1, 'le catalogue porte les deux rôles du change, à leurs racines, défauts, libellés et rangs', v_texte,
    v_texte = E'pertes_de_change|656,666|656000|Pertes de change sur créances et dettes commerciales||340\n'
           || 'gains_de_change|756,766|756000|Gains de change sur créances et dettes commerciales||350');

  -- 2. Aucune autre racine ne recouvre les leurs (art. 1131-2).
  select count(*) into v_n from public.roles_comptables r cross join unnest(r.racines) u(racine)
    cross join unnest(array['656', '666', '756', '766']) n(neuve)
   where r.role not in ('pertes_de_change', 'gains_de_change')
     and (left(u.racine, length(n.neuve)) = n.neuve or left(n.neuve, length(u.racine)) = u.racine);
  insert into verdicts values (2, 'aucune autre racine du catalogue ne recouvre 656, 666, 756, 766', v_n || ' recouvrement(s)', v_n = 0);

  -- 3. Un dossier qui ne les règle pas les lit à leur défaut ; plan_du_dossier les rend avec les autres.
  select d.id into v_dossier from public.dossiers d order by d.id limit 1;
  insert into verdicts values (3, 'compte_du_role : le défaut pour un dossier qui ne règle rien',
    public.compte_du_role(v_dossier, 'pertes_de_change') || ', ' || public.compte_du_role(v_dossier, 'gains_de_change'),
    public.compte_du_role(v_dossier, 'pertes_de_change') = '656000' and public.compte_du_role(v_dossier, 'gains_de_change') = '756000');

  -- 4. La garde du plan juge le compte d'un rôle sous les racines que le CATALOGUE porte, sans nommer de rôle : le 666 ou le
  --    766 qu'un dossier choisirait s'y juge comme tout autre compte (le plan ne s'écrit que par regler_plan_du_dossier ;
  --    planComptable.sql éprouve cette lecture rôle par rôle).
  select count(*) into v_n from pg_proc p where p.proname = 'garder_plan_comptable_dossier'
     and p.prosrc ~ 'roles_comptables' and p.prosrc !~ '(pertes|gains)_de_change';
  insert into verdicts values (4, 'la garde du plan lit les racines au catalogue, sans nommer les rôles du change', v_n || ' garde(s)', v_n = 1);

  -- 6. Le règlement d'une pièce, son écart à part : les gardes du brouillon laissent passer une ligne au 656 et une au 627
  --    (`garder_comptes_des_pieces` ne nomme ni l'un ni l'autre).
  select p.id, p.dossier_id into v_piece, v_dossier from public.pieces p order by p.id limit 1;
  v_erreur := 'acceptées';
  begin
    insert into public.ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens, statut) values
      (v_dossier, v_piece, current_date, '656000', 'Essai : perte de change', 10, 'debit', 'proposee'),
      (v_dossier, v_piece, current_date, '627000', 'Essai : frais bancaire', 0.5, 'debit', 'proposee');
    raise exception using errcode = 'P0002';
  exception when sqlstate 'P0002' then null;
            when others then v_erreur := sqlerrm;
  end;
  -- Le verdict APRÈS le bloc : posé dedans, l'annulation du point de sauvegarde l'emporterait avec l'écriture d'essai.
  insert into verdicts values (6, 'une ligne de pièce au 656000 et au 627000 passe les gardes du brouillon', v_erreur, v_erreur = 'acceptées');
end
$$;

select n || ' | ' || controle || ' | ' || coalesce(observe, '') || ' | '
       || case when ok is null then 'EN ATTENTE' when ok then 'juste' else 'EN FAUTE' end from verdicts order by n;
select 'TOTAL | ' || count(*) filter (where ok) || ' juste(s), ' || count(*) filter (where ok = false) || ' en faute, '
       || count(*) filter (where ok is null) || ' en attente' from verdicts;
rollback;
