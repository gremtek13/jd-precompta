-- LA RÉGULARISATION DES COTISATIONS D'UN PRATICIEN BNC (ligne 27, TNS-Q2) — PRÉPARÉE le 07/11/2026, PAS APPLIQUÉE : la
-- recommandation que le cabinet n'a pas encore tranchée. Le récit : HISTORIQUE.md, « 07/11/2026 — LA RÉGULARISATION DES
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
-- CE QU'ELLE POSE, sur `cotisations_declarees` seule : trois colonnes NULLABLES, sans valeur par défaut — une échéance
-- d'hier reste valide et inchangée, et « non dite » se lit nul, jamais un choix par défaut :
--   - `organisme` : une liste fermée, l'Urssaf, les dix sections de la CNAVPL et la CNBF ;
--   - `annee_payee` : l'année au titre de laquelle l'échéance est due, de cinq ans avant l'année de son échéance à un an
--     après (une régularisation se prescrit par trois ans après la fin de son année, art. L. 244-3, et un échéancier de
--     paiement peut la reporter ; un appel de décembre peut ouvrir l'année suivante) ;
--   - `nature` : « provisionnelle » (calculée sur le revenu d'une année antérieure, ou estimé), « regularisation » (sur le
--     revenu réel de son année, connu après elle), « acompte » (un versement à valoir sur l'année, hors de l'échéancier des
--     provisionnelles). Une régularisation ne se paie pas avant son année : `annee_payee` n'y dépasse pas l'année de
--     l'échéance (une cessation d'activité déclarée dans les soixante jours la fait tomber la même année).
-- Leurs contraintes de forme, quatre, nommées. Aucune n'exige les trois ensemble : une caisse de retraite se dit sans dire
-- son année, et ce qui manque, le module le DIT.
--
-- LE GEL D'UN EXERCICE VALIDÉ les couvre sans un mot de plus : `garder_cotisation_valide` compare la ligne ENTIÈRE
-- (`to_jsonb(new) is distinct from to_jsonb(old)`) — la garde de tête l'exige, et l'essai le rejoue. `garder_paiement_personnel`
-- n'a rien à en dire : l'écriture d'un paiement personnel ne lit ni l'organisme, ni l'année, ni la nature.
--
-- CE QU'ELLE NE FAIT PAS : aucune fonction, aucun déclencheur, aucune policy, aucun droit ; aucune donnée d'hier n'est
-- réécrite. Elle ne touche à aucune fonction des autres migrations préparées. Le client « membre » lit déjà ses échéances
-- (la policy « membres peuvent lire leurs cotisations ») : il lira ces trois valeurs, des mots d'une liste fermée et une
-- année, jamais un texte libre du cabinet ; il n'écrit rien (aucune policy d'écriture ne l'admet).
-- CE QU'ELLE SUPPOSE, que son premier bloc vérifie : la table telle qu'en production le 07/11/2026 (aucune des trois
-- colonnes), et le gel par la ligne entière.
-- L'ORDRE DE MISE EN PRODUCTION : cette migration ; puis `REGULARISATION_DES_COTISATIONS_EXPORTEE`
-- (src/lib/regularisationDesCotisations.ts) levé, qui offre la saisie et l'estimation ; puis `types.ts` basculé (les trois
-- champs y deviennent obligatoires, nuls admis). La sauvegarde recopie des lignes entières (`select('*')`) : aucune
-- relation, aucun rang, aucun chemin nouveaux.
--
-- Ni barre oblique inverse, ni retour chariot, ni retrait de quoi que ce soit. VERSION PROVISOIRE : le fichier prendra la
-- version que portera sa ligne d'historique.

-- ══ 0. Ce qu'elle suppose ══════════
do $garde$
begin
  if exists (select 1 from pg_attribute a
              where a.attrelid = 'public.cotisations_declarees'::regclass and not a.attisdropped
                and a.attname in ('organisme', 'annee_payee', 'nature')) then
    raise exception 'La migration regularisation_des_cotisations est déjà en base : une des trois colonnes existe.';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.cotisations_declarees'::regclass
                    and t.tgname = 'cotisations_declarees_figees_par_la_validation'
                    and t.tgfoid = 'public.garder_cotisation_valide()'::regprocedure)
     or position('to_jsonb(new) is distinct from to_jsonb(old)' in
                 (select p.prosrc from pg_proc p where p.oid = 'public.garder_cotisation_valide()'::regprocedure)) = 0 then
    raise exception 'Le gel des échéances ne compare plus la ligne entière : les trois colonnes n''y seraient pas figées.';
  end if;
end
$garde$;

-- ══ 1. Les trois colonnes et leurs contraintes de forme ══════════
alter table public.cotisations_declarees
  add column organisme text,
  add column annee_payee integer,
  add column nature text,
  add constraint cotisations_declarees_organisme_liste check (organisme in (
    'urssaf', 'carmf', 'carcdsf', 'carpimko', 'cavp', 'carpv', 'cavec', 'cavom', 'cavamac', 'cipav', 'cprn', 'cnbf')),
  add constraint cotisations_declarees_nature_liste check (nature in ('provisionnelle', 'regularisation', 'acompte')),
  add constraint cotisations_declarees_annee_payee_bornes check (
    annee_payee >= extract(year from echeance)::integer - 5 and annee_payee <= extract(year from echeance)::integer + 1),
  add constraint cotisations_declarees_regularisation_apres_son_annee check (
    nature is distinct from 'regularisation' or annee_payee is null or annee_payee <= extract(year from echeance)::integer);

comment on column public.cotisations_declarees.organisme is
  'Qui appelle l''échéance : l''Urssaf, une section de la CNAVPL ou la CNBF. Nul : non dit (une échéance d''avant).';
comment on column public.cotisations_declarees.annee_payee is
  'L''année au titre de laquelle l''échéance est due (art. L. 131-6-2). Nul : non dite.';
comment on column public.cotisations_declarees.nature is
  'provisionnelle, regularisation ou acompte. Nul : non dite. Rien à voir avec previsionnel, l''estimation d''un appel à venir.';
