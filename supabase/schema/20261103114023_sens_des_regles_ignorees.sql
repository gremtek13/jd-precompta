-- « TOUJOURS IGNORER » RETIENT LE SENS DU MOUVEMENT QUI L'A CRÉÉE, ET UNE ÉCHÉANCE DE COTISATION NE SE RAPPROCHE PLUS D'UN
-- MOUVEMENT IGNORÉ (REGLES-Q1, tranchée par le cabinet le 02/11/2026 : « La migration (le sens retenu par la règle) », sur la
-- recommandation). La conception : HISTORIQUE.md, « 31/10/2026 — LES LOTS DU RELEVÉ : LE SENS, LA FENÊTRE DU JUSTIFICATIF,
-- « TOUJOURS IGNORER » ET LE MOUVEMENT TRAITÉ AILLEURS », défauts 9 (le sens) et 11c (le mouvement traité ailleurs) ; le récit
-- de la préparation : « 02/11/2026 — LE SENS DES RÈGLES « TOUJOURS IGNORER » ET LA COTISATION D'UN MOUVEMENT IGNORÉ, EN BASE
-- (REGLES-Q1) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- LES DEUX DÉFAUTS.
--   - Une règle « toujours ignorer » ne retient qu'un motif : la table n'a que `motif`. Née d'un prélèvement « PRLV CPAM
--     PARTICIPATION », la règle « cpam » fait ignorer, à l'import, chaque virement de recette de la CPAM ; or un mouvement
--     ignoré ne compte nulle part — ni brouillon, ni FEC, ni 2035 — : une recette sort de la comptabilité sans que rien ne
--     le montre. L'application nomme ces mouvements avant le clic et les compte à l'import ; sans la colonne, elle ne peut
--     pas les épargner.
--   - `rapprocher_cotisation` ne refuse pas un mouvement « ignoré » : un mouvement qu'un écran ignore pendant qu'un autre
--     le rapproche d'une échéance devient « rapproché » en silence, avec son écriture. Les mises à jour de l'application ne
--     visent plus qu'un mouvement encore à traiter depuis le 31/10/2026 (11c) ; cette fonction, seule, restait.
--
-- CE QU'ELLE POSE.
--   1. `regles_bancaires_ignorees.sens`, texte NUL, sans valeur par défaut : « encaissement » ou « decaissement » — les
--      mots de `regles_affectation_bancaire.sens` —, sous la contrainte `regles_bancaires_ignorees_sens`. NUL vaut LES DEUX
--      SENS, ce que vaut toute règle d'avant : aucune n'est réécrite, chacune fait ce qu'elle faisait. L'application, son
--      drapeau levé (`SENS_DES_REGLES_IGNOREES_EXPORTE`, src/lib/sensDesReglesIgnorees.ts), enregistre le sens du mouvement
--      qui crée la règle, et n'applique une règle qu'aux mouvements de son sens — à l'import comme aux mouvements déjà là.
--   2. La clé unique REMPLACÉE : `regles_bancaires_ignorees_unique`, UNIQUE NULLS NOT DISTINCT (dossier_id, motif, sens) —
--      une règle par motif ET par sens, deux règles nulles du même motif se heurtant comme deux règles d'avant —, à la
--      place de `regles_bancaires_ignorees_dossier_id_motif_key`, UNIQUE (dossier_id, motif), RETIRÉE : elle refuserait la
--      règle des encaissements d'un motif dont celle des paiements existe, et la règle d'un sens d'un motif qu'une règle
--      d'avant porte — le chemin qui remplace une règle d'avant par une règle d'un sens. Une contrainte TOTALE : un index
--      unique partiel ne pourrait pas être visé par un upsert. Toute paire que l'ancienne admettait, la nouvelle l'admet.
--   3. `rapprocher_cotisation` REMPLACÉE — sa dernière définition (`lignes_propres_au_mouvement`, `a2a5c675…`), au
--      caractère près, plus un refus : un mouvement ignoré (22023), juste après celui d'un mouvement déjà classé — qui garde
--      ses mots pour un virement personnel, « ignoré » lui aussi, et classé — et avant celui d'un mouvement de zéro euro.
--      Même signature, même sécurité (`security invoker`), même chemin, mêmes verrous, les autres refus dans le même ordre
--      sous les mêmes mots ; son OID, son propriétaire, ses droits restent (`create or replace`). Aucune fonction ne
--      l'appelle ; l'application l'appelle de l'onglet Banque (la fiche d'un mouvement, « Tout rapprocher ») et de l'onglet
--      Cotisations (« Écrire les N »).
--
-- LE REFUS NEUF, que src/lib/sensDesReglesIgnorees.ts redit avant le clic, sous les mêmes mots :
--   - `rapprocher_cotisation` — « Ce mouvement est ignoré : remets-le d'abord à traiter. » (22023).
-- Et ses deux contraintes : un sens hors des deux mots (23514, `regles_bancaires_ignorees_sens`) ; une règle qui existe déjà
-- sous ce motif et ce sens, nul compris (23505, `regles_bancaires_ignorees_unique`).
--
-- LA CONCURRENCE : inchangée. Le mouvement se lit `for update` d'abord : « Toujours ignorer » qui le met à jour pendant ce
-- temps attend, ou a fini et le refus le voit ; et une mise à jour qui l'ignorerait après son rapprochement se heurte à
-- `lignes_bancaires_cotisation_rapprochee` (une échéance sur un mouvement rapproché seulement), comme hier.
--
-- CE QU'ELLE TOUCHE D'EXISTANT : `regles_bancaires_ignorees` — une colonne nulle partout, une contrainte de plus, la clé
-- unique remplacée ; une table créée HORS migration, au socle (supabase/schema/socle/1_tables_sans_migration.sql) : son
-- `create table` se re-rend depuis la base le jour de l'application —, et `rapprocher_cotisation`, que la garde de tête
-- relit à son empreinte. Ni policy, ni droit, ni déclencheur, ni autre fonction. NEUTRE pour les règles en base (nulles :
-- les deux sens, comme hier) ; la fonction ne refuse que ce qu'elle écrivait à tort.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` retient) : la clé unique d'hier — un `drop constraint`,
-- dans la même transaction que la clé qui la remplace et qui admet tout ce qu'elle admettait — ; aucune donnée, aucune autre
-- définition. Et le corps de `rapprocher_cotisation` supprime des écritures, comme il le faisait. Le texte SE COLLE donc
-- dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique. Ni barre oblique inverse, ni retour
-- chariot. Son retour arrière (supabase/preparees/retour/) rend la clé et la fonction d'hier et retire la colonne :
-- destructif — le sens des règles créées entre-temps se perd, et les doublons qu'il ferait naître (un motif sous deux sens)
-- se fondent en une règle des deux sens —, à accorder, et à coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; le drapeau de l'application suit le fichier
-- (sensDesReglesIgnorees.test.ts).

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une base dont la clé unique d'hier, la fonction remplacée — à l'empreinte de son
-- corps, les retours chariot d'un collage écartés — ou les statuts d'un mouvement ne seraient plus ceux que cette migration
-- suppose.
do $garde$
declare
  v_nombre integer;
  v_empreinte text;
begin
  if exists (select 1 from pg_attribute a
              where a.attrelid = 'public.regles_bancaires_ignorees'::regclass and a.attname = 'sens' and not a.attisdropped)
     or exists (select 1 from pg_constraint c where c.conrelid = 'public.regles_bancaires_ignorees'::regclass
                 and c.conname in ('regles_bancaires_ignorees_sens', 'regles_bancaires_ignorees_unique')) then
    raise exception 'La migration sens_des_regles_ignorees est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.regles_bancaires_ignorees'::regclass
                  and c.conname = 'regles_bancaires_ignorees_dossier_id_motif_key' and c.contype = 'u'
                  and pg_get_constraintdef(c.oid) = 'UNIQUE (dossier_id, motif)') then
    raise exception 'La clé unique d''hier des règles « toujours ignorer » (regles_bancaires_ignorees_dossier_id_motif_key, UNIQUE (dossier_id, motif)) n''est plus en base : cette base n''est pas celle que la migration suppose.';
  end if;
  select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'rapprocher_cotisation';
  select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p
   where p.oid = to_regprocedure('public.rapprocher_cotisation(uuid, uuid, jsonb)');
  if v_nombre <> 1 or v_empreinte is distinct from 'a2a5c67562afeda12a65ffb935bd7d7c' then
    raise exception 'La fonction rapprocher_cotisation n''est plus celle que cette migration suppose (empreinte attendue a2a5c675…) : la relire avant d''appliquer cette migration.';
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.lignes_bancaires'::regclass
                  and c.conname = 'lignes_bancaires_statut_check'
                  and pg_get_constraintdef(c.oid) = 'CHECK ((statut = ANY (ARRAY[''non_rapprochee''::text, ''rapprochee''::text, ''ignoree''::text])))') then
    raise exception 'Les statuts d''un mouvement ne sont plus « non_rapprochee », « rapprochee » et « ignoree » : cette base n''est pas celle que la migration suppose.';
  end if;
end
$garde$;

-- ══ 1. Le sens d'une règle ══════════
-- Nul sans valeur par défaut : chaque règle d'avant le reste, et vaut pour les deux sens, comme hier ; une sauvegarde d'avant,
-- qui ne porte pas la colonne, se restaure nulle de même.
alter table public.regles_bancaires_ignorees
  add column sens text;

alter table public.regles_bancaires_ignorees
  add constraint regles_bancaires_ignorees_sens check (sens is null or sens in ('encaissement', 'decaissement'));

comment on column public.regles_bancaires_ignorees.sens is
  'Le sens des mouvements que la règle fait ignorer : « encaissement » ou « decaissement », celui du mouvement qui l''a créée ; nul, les deux sens — toute règle d''avant le 02/11/2026 (REGLES-Q1). Les mots de regles_affectation_bancaire.sens.';

-- ══ 2. La clé unique, par motif ET par sens ══════════
-- La nouvelle d'abord : elle admet toute paire que l'ancienne admettait. Puis l'ancienne se retire.
alter table public.regles_bancaires_ignorees
  add constraint regles_bancaires_ignorees_unique unique nulls not distinct (dossier_id, motif, sens);

alter table public.regles_bancaires_ignorees
  drop constraint regles_bancaires_ignorees_dossier_id_motif_key;

-- ══ 3. L'échéance de cotisation ne se rapproche pas d'un mouvement ignoré ══════════
-- `rapprocher_cotisation` : sa dernière définition, au caractère près, plus le refus d'un mouvement ignoré.
create or replace function public.rapprocher_cotisation(
  p_ligne_bancaire_id uuid,
  p_cotisation_id uuid,
  p_ecritures jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_cotisation public.cotisations_declarees%rowtype;
  v_mode text;
  v_echeance numeric;
  v_total numeric;
  v_csg numeric := 0;
  v_date_autre date;
  v_banque text;
  v_compte_cotisations text;
  v_compte_exploitant text;
  v_sens_banque text;
  v_sens_compte text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.reglement_groupe then
    raise exception 'Ce mouvement règle plusieurs pièces : annule d''abord ce règlement groupé.' using errcode = '22023';
  end if;
  if v_ligne.piece_id is not null or v_ligne.categorie_id is not null or v_ligne.emprunt_id is not null
     or v_ligne.ventilee or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  -- UN MOUVEMENT IGNORÉ ne compte nulle part — ni brouillon, ni FEC, ni 2035 — : il ne paie pas une échéance (REGLES-Q1,
  -- 02/11/2026). Rapproché ici pendant qu'un autre écran l'ignorait, il devenait « rapproché » en silence, avec son
  -- écriture. Après le refus d'un mouvement classé, qui garde ses mots pour un virement personnel, ignoré lui aussi.
  if v_ligne.statut = 'ignoree' then
    raise exception 'Ce mouvement est ignoré : remets-le d''abord à traiter.' using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;

  select * into v_cotisation from public.cotisations_declarees
   where id = p_cotisation_id and dossier_id = v_ligne.dossier_id for update;
  if not found then
    raise exception 'Cette échéance n''existe pas pour ce dossier.' using errcode = '22023';
  end if;
  -- Le montant de l'échéance : le versement saisi, sinon l'appel. Son SIGNE dit ce qu'elle est.
  v_echeance := coalesce(v_cotisation.montant_verse, v_cotisation.montant_appele);
  if v_echeance = 0 then
    raise exception 'Une échéance de zéro euro ne se rapproche pas.' using errcode = '22023';
  end if;
  if v_echeance > 0 and v_ligne.montant > 0 then
    raise exception 'Ce mouvement est un encaissement : il ne paie pas un appel de cotisation. Un remboursement se rapproche d''une échéance négative.'
      using errcode = '22023';
  end if;
  if v_echeance < 0 and v_ligne.montant < 0 then
    raise exception 'Cette échéance est négative — un remboursement : un prélèvement ne la paie pas.' using errcode = '22023';
  end if;
  select l.date into v_date_autre from public.lignes_bancaires l
   where l.cotisation_id = p_cotisation_id and l.id <> p_ligne_bancaire_id;
  if found then
    raise exception 'Cette échéance est déjà rapprochée du mouvement du %.', to_char(v_date_autre, 'DD/MM/YYYY')
      using errcode = '23505';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- La CSG-CRDS au compte de l'exploitant (108000 par défaut), en trésorerie seulement, et au centime : sa valeur
  -- absolue, dans le sens du mouvement. Elle ne peut pas dépasser le mouvement — la cotisation serait négative.
  v_total := abs(v_ligne.montant);
  select mode_comptable into v_mode from public.dossiers where id = v_ligne.dossier_id;
  if v_mode = 'tresorerie' and v_cotisation.montant_csg_crds is not null then
    v_csg := abs(v_cotisation.montant_csg_crds);
  end if;
  if v_csg <> round(v_csg, 2) then
    raise exception 'La CSG-CRDS de cette échéance n''est pas au centime.' using errcode = '22023';
  end if;
  if v_csg > v_total then
    raise exception 'La CSG-CRDS de cette échéance (% €) dépasse le mouvement (% €).',
      replace(to_char(v_csg, 'FM999999999990.00'), '.', ','),
      replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  -- L'écriture attendue, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues présente.
  -- Une ligne à zéro n'en est pas une (une échéance sans CSG-CRDS saisie, ou faite toute de CSG-CRDS).
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  v_sens_compte := case when v_ligne.montant > 0 then 'credit' else 'debit' end;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_compte_cotisations := public.compte_du_role(v_ligne.dossier_id, 'cotisations_exploitant');
  v_compte_exploitant := public.compte_du_role(v_ligne.dossier_id, 'exploitant');
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      (v_banque, v_sens_banque, v_total),
      (v_compte_cotisations, v_sens_compte, v_total - v_csg),
      (v_compte_exploitant, v_sens_compte, v_csg)
    ) as a(compte, sens, montant)
    where a.montant > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette échéance.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'rapprochee', cotisation_id = p_cotisation_id
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;
