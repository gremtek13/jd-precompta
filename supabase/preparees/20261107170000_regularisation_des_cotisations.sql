-- LA RÉGULARISATION DES COTISATIONS D'UN PRATICIEN BNC (ligne 27, TNS-Q2) — PRÉPARÉE le 07/11/2026, PAS APPLIQUÉE ; le
-- cabinet l'a tranchée le même jour (TNS-Q2 : « appliquez-la » ; TNS-Q2-B : (B), une colonne pour la part). Le récit : HISTORIQUE.md, « 07/11/2026 — LA RÉGULARISATION DES
-- COTISATIONS (LIGNE 27, TNS-Q2) (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai : supabase/essais/regularisationDesCotisations.sql ;
-- le retour arrière : supabase/preparees/retour/20261107170100_retour_regularisation_des_cotisations.sql.
--
-- POURQUOI. Les cotisations d'un travailleur indépendant sont dues annuellement, calculées « à titre provisionnel » sur le
-- revenu d'une année antérieure, puis régularisées quand le revenu de l'année au titre de laquelle elles sont dues est
-- définitivement connu (code de la sécurité sociale, art. L. 131-6-2). L'échéancier d'une année mêle donc les provisionnelles
-- de l'année et la régularisation de la précédente, et l'Urssaf n'est pas seule à appeler : la retraite d'un professionnel
-- libéral l'est par sa section de la CNAVPL (art. L. 641-1, L. 641-5 et R. 641-1), celle d'un avocat par la CNBF
-- (art. L. 723-1). `cotisations_declarees` ne disait ni qui appelle, ni l'année payée, ni la nature : la régularisation
-- estimée (src/lib/regularisationDesCotisations.ts) ne pouvait se calculer sans deviner.
--
-- CE QU'ELLE POSE, sur `cotisations_declarees` et son gel (§ 2, ci-dessous) : quatre colonnes NULLABLES, sans valeur par défaut — une
-- échéance d'hier reste valide et inchangée, et « non dite » se lit nul, jamais un choix par défaut :
--   - `organisme` : une liste fermée, l'Urssaf, les dix sections de la CNAVPL et la CNBF ;
--   - `annee_payee` : l'année au titre de laquelle l'échéance est due, de cinq ans avant l'année de son échéance à un an
--     après (une régularisation se prescrit par trois ans après la fin de son année, art. L. 244-3, et un échéancier de
--     paiement peut la reporter ; un appel de décembre peut ouvrir l'année suivante) ;
--   - `nature` : « provisionnelle » (calculée sur le revenu d'une année antérieure, ou estimé), « regularisation » (sur le
--     revenu réel de son année, connu après elle), « acompte » (un versement à valoir sur l'année, hors de l'échéancier des
--     provisionnelles). Une régularisation ne se paie pas avant son année : `annee_payee` n'y dépasse pas l'année de
--     l'échéance (une cessation d'activité déclarée dans les soixante jours la fait tomber la même année) ;
--   - `part_regularisation` (TNS-Q2-B, le choix (B) du cabinet le 07/11/2026) : sur une provisionnelle ou un acompte, la part
--     de son montant APPELÉ qui régularise l'année d'avant l'année payée — un même prélèvement de l'Urssaf paie souvent la
--     provisionnelle de N et la régularisation de N − 1, et le relevé ne rapproche qu'une échéance. Elle est SIGNÉE :
--     positive, un complément de N − 1 compris dans l'appel ; négative, un trop-versé de N − 1 imputé sur lui (l'appel net
--     de ce crédit). L'article L. 131-6-2 dit la régularisation, sans en dire le sens ; les articles R. 131-4 et R. 131-5
--     disent qu'un trop-versé se rembourse, et l'Urssaf l'impute d'abord sur les échéances qui restent à payer (son
--     échéancier le porte en moins sur elles). La provisionnelle de N que l'échéance paie est son appelé moins cette part.
--     L'année régularisée se DÉDUIT de `annee_payee` (moins un), sans seconde colonne : dans le cycle de l'article
--     L. 131-6-2, les provisionnelles de N se recalculent quand le revenu de N − 1 est connu, et la régularisation de
--     N − 1 se calcule alors ; une régularisation plus ancienne (une déclaration tardive, un contrôle, un échéancier) a son
--     propre avis — une échéance « régularisation » de son année. Une seconde colonne dirait un couple que ce cycle ne
--     produit pas. En numeric, comme les montants : exacte, jamais arrondie par la base.
-- Leurs contraintes de forme, six, nommées. Aucune n'exige les trois premières ensemble : une caisse de retraite se dit
-- sans dire son année, et ce qui manque, le module le DIT. La part, elle, n'a de sens que dite d'une provisionnelle ou d'un
-- acompte et de son année : sans elles, elle se refuse ; nulle, elle ne se dit pas (zéro se refuse) ; et elle ne dépasse
-- jamais, en valeur absolue, le montant appelé de l'échéance (un crédit plus fort que l'appel se dit comme hier : l'appelé
-- de la provisionnelle, et le versé de ce que le prélèvement a payé).
--
-- LE GEL D'UN EXERCICE VALIDÉ NE LES FIGE PAS (relecture adverse du 07/11/2026, confirmée par un second relecteur) :
-- `garder_cotisation_valide` comparait la ligne ENTIÈRE (`to_jsonb(new) is distinct from to_jsonb(old)`), et aurait figé
-- avec l'exercice l'organisme, l'année payée, la nature et la part. Une échéance d'un exercice validé ne se serait plus décrite,
-- alors que l'estimation de la régularisation de cet exercice — celle qui sert, sur la 2035 validée — l'exige et renvoie
-- vers l'onglet Cotisations. La fonction est REMPLACÉE (§ 2), sa seule comparaison changée : les quatre champs sortent des
-- deux côtés (`to_jsonb(new) - 'organisme' - 'annee_payee' - 'nature' - 'part_regularisation'`, le `-` n'ôtant qu'une clé
-- d'une valeur jsonb). La part est de la description : elle dit ce que le prélèvement a payé, jamais combien.
-- Ils ne nourrissent ni la 2035 (lib/declaration2035.ts et `cotisationsComptees` ne lisent que les montants et les dates),
-- ni l'instantané validé (`valider_exercice` ne lit pas `cotisations_declarees` ; l'instantané vient de la 2035), ni une
-- écriture (le rapprochement et le paiement personnel n'écrivent que des montants). Ce que la validation fige le reste :
-- les montants, la date, le marqueur, le paiement, le dossier ; une échéance ne s'y ajoute ni ne s'en retire. L'estimation
-- d'une année validée suit donc la description du jour. `garder_paiement_personnel` n'a rien à en dire : il ne garde que
-- les montants et le dossier d'une échéance payée depuis le compte personnel, dont l'écriture ne lit pas ces quatre champs.
-- La contrainte qui borne la part lit le montant appelé : sur une échéance figée, ce montant ne change plus, la part se dit
-- sous lui.
--
-- CE QU'ELLE NE FAIT PAS : aucun déclencheur, aucune policy, aucun droit ; une seule fonction remplacée, celle du gel, son
-- corps celui d'hier à sa comparaison près (`create or replace` garde son OID, son propriétaire et ses droits : ni `anon`
-- ni `authenticated` ne l'exécutent) ; aucune donnée d'hier n'est réécrite. Elle ne touche à aucune fonction des autres
-- migrations préparées. Le client « membre » lit déjà ses échéances (la policy « membres peuvent lire leurs
-- cotisations ») : il lira ces quatre valeurs, des mots d'une liste fermée, une année et un montant, jamais un texte libre
-- du cabinet ;
-- il n'écrit rien (aucune policy d'écriture ne l'admet).
-- CE QU'ELLE SUPPOSE, que son premier bloc vérifie : la table telle qu'en production le 07/11/2026 (aucune des quatre
-- colonnes), et le gel tel qu'en production — `garder_cotisation_valide` au corps de la migration
-- `paiement_personnel_des_cotisations` (20261009084127), md5 dfa6faabda81af162016e620ea6375fe, 1 744 caractères, relu dans
-- l'export et en production le 07/11/2026 : un autre corps arrête la migration plutôt que d'être écrasé.
-- L'ORDRE DE MISE EN PRODUCTION : cette migration ; puis `REGULARISATION_DES_COTISATIONS_EXPORTEE`
-- (src/lib/regularisationDesCotisations.ts) levé, qui offre la saisie et l'estimation ; puis `types.ts` basculé (les quatre
-- champs y deviennent obligatoires, nuls admis) ; puis l'export (supabase/schema/), où la fonction du gel prend ce corps.
-- La sauvegarde recopie des lignes entières (`select('*')`) : aucune relation, aucun rang, aucun chemin nouveaux.
--
-- Ni barre oblique inverse, ni retour chariot, ni retrait de quoi que ce soit ; le mot « delete » n'y paraît que dans
-- `tg_op = 'DELETE'`, que les migrations d'hier ont passé sans confirmation. VERSION PROVISOIRE : le fichier prendra la
-- version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose ══════════
do $garde$
begin
  if exists (select 1 from pg_attribute a
              where a.attrelid = 'public.cotisations_declarees'::regclass and not a.attisdropped
                and a.attname in ('organisme', 'annee_payee', 'nature', 'part_regularisation')) then
    raise exception 'La migration regularisation_des_cotisations est déjà en base : une des quatre colonnes existe.';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.cotisations_declarees'::regclass
                    and t.tgname = 'cotisations_declarees_figees_par_la_validation'
                    and t.tgfoid = 'public.garder_cotisation_valide()'::regprocedure) then
    raise exception 'Le gel des échéances n''est plus le déclencheur garder_cotisation_valide : rien à remplacer ici.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'public.garder_cotisation_valide()'::regprocedure)
     is distinct from 'dfa6faabda81af162016e620ea6375fe' then
    raise exception 'Le gel des échéances n''est plus celui de paiement_personnel_des_cotisations : son corps serait écrasé.';
  end if;
end
$garde$;

-- ══ 1. Les quatre colonnes et leurs contraintes de forme ══════════
alter table public.cotisations_declarees
  add column organisme text,
  add column annee_payee integer,
  add column nature text,
  add column part_regularisation numeric,
  add constraint cotisations_declarees_organisme_liste check (organisme in (
    'urssaf', 'carmf', 'carcdsf', 'carpimko', 'cavp', 'carpv', 'cavec', 'cavom', 'cavamac', 'cipav', 'cprn', 'cnbf')),
  add constraint cotisations_declarees_nature_liste check (nature in ('provisionnelle', 'regularisation', 'acompte')),
  add constraint cotisations_declarees_annee_payee_bornes check (
    annee_payee >= extract(year from echeance)::integer - 5 and annee_payee <= extract(year from echeance)::integer + 1),
  add constraint cotisations_declarees_regularisation_apres_son_annee check (
    nature is distinct from 'regularisation' or annee_payee is null or annee_payee <= extract(year from echeance)::integer),
  add constraint cotisations_declarees_part_regularisation_nature check (
    part_regularisation is null or (nature is not null and nature in ('provisionnelle', 'acompte') and annee_payee is not null)),
  add constraint cotisations_declarees_part_regularisation_bornee check (
    part_regularisation is null or (part_regularisation <> 0 and abs(part_regularisation) <= abs(montant_appele)));

comment on column public.cotisations_declarees.organisme is
  'Qui appelle l''échéance : l''Urssaf, une section de la CNAVPL ou la CNBF. Nul : non dit (une échéance d''avant).';
comment on column public.cotisations_declarees.annee_payee is
  'L''année au titre de laquelle l''échéance est due (art. L. 131-6-2). Nul : non dite.';
comment on column public.cotisations_declarees.nature is
  'provisionnelle, regularisation ou acompte. Nul : non dite. Rien à voir avec previsionnel, l''estimation d''un appel à venir.';
comment on column public.cotisations_declarees.part_regularisation is
  'Sur une provisionnelle ou un acompte : la part de son montant appelé qui régularise l''année d''avant l''année payée, positive (un complément) ou négative (un trop-versé imputé). Nul : aucune.';

-- ══ 2. Le gel : les quatre champs hors de sa comparaison ══════════
-- Le corps de `paiement_personnel_des_cotisations` à une comparaison près : une échéance d'un exercice validé ne change
-- plus, ni ne se supprime, mais sa description se dit encore — voir l'en-tête. Le reste, mot pour mot.
create or replace function public.garder_cotisation_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
  v_date date;
begin
  if tg_op <> 'INSERT' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return public.retour_declencheur(tg_op, old, new);
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_frontiere := public.frontiere_validation(old.dossier_id);
    v_date := coalesce((select l.date from public.lignes_bancaires l where l.cotisation_id = old.id),
                       old.paiement_personnel_le, old.echeance);
    if v_frontiere is not null and v_date <= v_frontiere then
      if tg_op = 'DELETE' then
        raise exception '% : cette échéance ne se supprime plus.',
          public.exercice_fige(old.dossier_id, extract(year from v_date)::integer) using errcode = '23514';
      end if;
      if (to_jsonb(new) - 'organisme' - 'annee_payee' - 'nature' - 'part_regularisation')
         is distinct from (to_jsonb(old) - 'organisme' - 'annee_payee' - 'nature' - 'part_regularisation') then
        raise exception '% : cette échéance ne change plus.',
          public.exercice_fige(old.dossier_id, extract(year from v_date)::integer) using errcode = '23514';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_frontiere := public.frontiere_validation(new.dossier_id);
  if v_frontiere is not null and coalesce(new.paiement_personnel_le, new.echeance) <= v_frontiere
     and not exists (select 1 from public.lignes_bancaires l where l.cotisation_id = new.id) then
    raise exception '% : une échéance ne s''y ajoute plus.',
      public.exercice_fige(new.dossier_id, extract(year from coalesce(new.paiement_personnel_le, new.echeance))::integer)
      using errcode = '23514';
  end if;
  return new;
end;
$$;
