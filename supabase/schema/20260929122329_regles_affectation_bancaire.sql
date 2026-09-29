-- Ligne 26.6 de la feuille de route, étape (a), suite : des RÈGLES apprises par libellé, et
-- l'affectation EN LOT des mouvements qu'elles désignent.
--
-- Une règle dit : les mouvements de CE sens dont le libellé contient CE motif vont dans CETTE
-- catégorie. Elle ne s'applique jamais seule — ni à l'import, ni au chargement de l'écran : elle
-- PROPOSE, et c'est le clic de l'opérateur, liste sous les yeux, qui écrit. Une affectation écrit une
-- écriture comptable, et rien n'est validé automatiquement dans cette application.

create table public.regles_affectation_bancaire (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  motif text not null,
  sens text not null,
  categorie_id uuid not null references public.categories(id),
  created_at timestamptz not null default now(),
  -- Normalisé par l'application (lib/reglesAffectation.ts) : minuscules sans accents, mots séparés par
  -- une espace. Toute autre forme est refusée : un motif « CPAM » ne se retrouverait jamais dans un
  -- libellé normalisé, et la règle ne proposerait rien, en silence. Un motif fait de chiffres seuls en
  -- porte au moins cinq : en dessous, une date ou un montant le contiendrait par hasard.
  constraint regles_affectation_bancaire_motif_normalise check (
    motif ~ '^[a-z0-9]+( [a-z0-9]+)*$' and length(motif) >= 3
    and (motif !~ '^[0-9 ]+$' or length(replace(motif, ' ', '')) >= 5)
  ),
  constraint regles_affectation_bancaire_sens check (sens in ('encaissement', 'decaissement')),
  -- Une règle par motif et par sens : en créer une seconde REMPLACE la catégorie de la première
  -- (upsert sur cette contrainte, qui est totale — un index partiel ne peut pas être visé par un
  -- ON CONFLICT).
  constraint regles_affectation_bancaire_unique unique (dossier_id, motif, sens)
);

comment on table public.regles_affectation_bancaire is
  'Règles apprises par libellé : les mouvements d''un sens dont le libellé contient le motif sont PROPOSÉS '
  'à l''affectation dans la catégorie. Jamais appliquées seules : affecter_mouvements_bancaires écrit sur le '
  'clic de l''opérateur.';

create index regles_affectation_bancaire_categorie_id_idx on public.regles_affectation_bancaire (categorie_id);

alter table public.regles_affectation_bancaire enable row level security;

-- La convention du projet, plus une garantie que la relecture ne donne pas : la catégorie visée doit
-- être celle du dossier ou une catégorie partagée du cabinet. Sans elle, une règle pourrait désigner
-- la catégorie d'un autre dossier, que l'affectation refuserait ensuite mouvement par mouvement.
create policy regles_affectation_bancaire_cabinet on public.regles_affectation_bancaire
  for all to authenticated
  using (admin_du_dossier(dossier_id))
  with check (
    admin_du_dossier(dossier_id)
    and exists (
      select 1 from public.categories c
       where c.id = regles_affectation_bancaire.categorie_id
         and (c.dossier_id is null or c.dossier_id = regles_affectation_bancaire.dossier_id)
    )
  );

-- affecter_mouvement_bancaire lit, remplace et relit l'écriture d'un mouvement par sa ligne bancaire :
-- trois parcours de la table par mouvement, et le lot en enchaîne des centaines.
create index ecritures_brouillon_ligne_bancaire_id_idx on public.ecritures_brouillon (ligne_bancaire_id);

create function public.affecter_mouvements_bancaires(p_affectations jsonb) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_affectation jsonb;
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer := 0;
begin
  if jsonb_typeof(p_affectations) is distinct from 'array' or jsonb_array_length(p_affectations) = 0 then
    raise exception 'Aucune affectation à enregistrer.' using errcode = '22023';
  end if;
  for v_affectation in select value from jsonb_array_elements(p_affectations) loop
    select * into v_ligne from public.lignes_bancaires
     where id = (v_affectation->>'ligne_bancaire_id')::uuid for update;
    if not found or not admin_du_dossier(v_ligne.dossier_id) then
      raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
    end if;
    -- En lot, seul ce qui est À TRAITER s'affecte. Un mouvement rapproché ou affecté depuis
    -- l'affichage — un autre onglet, un collègue — porte une décision humaine que le lot écraserait :
    -- affecter_mouvement_bancaire REMPLACE une affectation, ce qui est voulu pour « Réaffecter », pas ici.
    if v_ligne.statut <> 'non_rapprochee' then
      raise exception 'Le mouvement du % (% €) n''est plus à traiter : il a changé depuis l''affichage.',
        to_char(v_ligne.date, 'DD/MM/YYYY'), replace(v_ligne.montant::text, '.', ',')
        using errcode = '22023';
    end if;
    -- Tout ou rien : le refus d'un seul défait tout l'appel. Il est renvoyé avec le mouvement qui
    -- l'a provoqué, et son code d'origine.
    begin
      perform public.affecter_mouvement_bancaire(v_ligne.id, (v_affectation->>'categorie_id')::uuid, v_affectation->'ecritures');
    exception when others then
      raise exception 'Mouvement du % (% €) : %', to_char(v_ligne.date, 'DD/MM/YYYY'),
        replace(v_ligne.montant::text, '.', ','), sqlerrm
        using errcode = sqlstate;
    end;
    v_nb := v_nb + 1;
  end loop;
  return v_nb;
end;
$$;

comment on function public.affecter_mouvements_bancaires(jsonb) is
  'Affecte en une transaction une liste de mouvements À TRAITER, chacun par affecter_mouvement_bancaire '
  '(mêmes vérifications, même écriture). Tout ou rien : un refus défait l''appel entier.';

revoke execute on function public.affecter_mouvements_bancaires(jsonb) from public, anon;
grant execute on function public.affecter_mouvements_bancaires(jsonb) to authenticated;
