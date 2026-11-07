-- L'E-REPORTING DANS L'ÉTAT DE LA FACTURE ÉLECTRONIQUE (espace client, partie C, étape C3 — « la facture électronique et
-- l'e-reporting en un coup d'œil », ligne 51.5). Le récit : HISTORIQUE.md, « 06/11/2026 — C3, LA FACTURE ÉLECTRONIQUE ET
-- L'E-REPORTING EN UN COUP D'ŒIL (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai : supabase/essais/apercuFactureElectronique.sql ;
-- le module : src/lib/apercuEreporting.ts ; le drapeau : `APERCU_EREPORTING_EXPORTE` (src/lib/apercuEreporting.ts).
--
-- POURQUOI. L'encart « Facture électronique » (A6b2) dit l'état des connexions et de l'adresse ; C3 y ajoute la prochaine
-- période d'e-reporting — « prête », « en attente de ton cabinet », « déclarée le … ». Le client « Ventes » ne lit ni
-- `regimes_ereporting` ni `declarations_ereporting` (leurs policies ne regardent que le cabinet) : la fonction d'A6 les
-- lit pour lui et n'en rend que des PHASES — des dates, des fréquences et des états —, comme elle ne rend des connexions
-- que des booléens, un nom et des dates. Le calcul des périodes et de leurs échéances reste celui de l'application
-- (lib/periodesEreporting.ts, lib/regimesEreporting.ts) : il n'est pas recopié ici.
--
-- CE QU'ELLE CHANGE : `etat_facture_electronique` reçoit une quatrième clé, `ereporting` :
--   { "statut_du_dossier": { "statut_tva", "article_exoneration", "tva_periodicite", "tva_sur_debits" },
--     "regimes": [ { "depuis", "statut_tva", "article_exoneration", "tva_periodicite", "tva_sur_debits",
--                    "frequence_transactions", "frequence_paiements" } … ],       -- les régimes ACTIFS, par `depuis`
--     "declarations": [ { "objet", "debut", "fin", "declaree_le" } … ] }         -- les déclarations ACTIVES récentes
-- `regimes` et `declarations` sont des listes, vides quand rien n'est confirmé ni déclaré. Une déclaration ne se rend que
-- si sa période a fini il y a 92 jours au plus (au jour de Paris) : la prochaine échéance tombe au plus 25 jours après la
-- fin de sa période (le 25 du mois qui suit un bimestre civil, lib/periodesEreporting.ts), et l'écran ne cherche que la
-- période de la prochaine échéance ; la borne n'est qu'un plafond de volume, large.
-- Les trois clés d'hier sont rendues À L'IDENTIQUE (le corps d'hier, au caractère près, sauf la clé ajoutée).
--
-- CE QU'ELLE NE REND JAMAIS : ni l'identifiant d'un régime ou d'une déclaration, ni qui les a écrits, ni leurs notes, ni le
-- nom de la plateforme où la période a été déclarée, ni le contenu, son empreinte, le nombre d'opérations ou
-- l'identifiant du fichier, ni un régime retiré ni une déclaration remplacée — rien du cabinet au-delà des phases
-- (conception, C.1). L'accès est celui d'hier, AVANT toute lecture : le cabinet ou le client « Ventes » (`gere_les_ventes`),
-- sur un dossier qui existe, sinon 42501 pour tous.
--
-- CE QU'ELLE NE CHANGE PAS : la signature, le type rendu, `stable`, `security definer`, le chemin, les droits d'exécution
-- (`create or replace` les garde), aucune table, aucune policy. Elle ne retire rien : elle passe par `apply_migration`.
-- La lecture élargie (deux tables du cabinet lues pour le client « Ventes ») se présente au cabinet AVANT d'être appliquée.
-- Ni barre oblique inverse, ni échappement, ni retour chariot. Son retour arrière, donné à part
-- (`supabase/preparees/retour/20261106170100_retour_apercu_facture_electronique.sql`), remet le corps d'hier.

-- ══ 0. Ce qu'elle suppose ══════════
do $garde$
begin
  if to_regclass('public.regimes_ereporting') is null or to_regclass('public.declarations_ereporting') is null
     or to_regprocedure('public.gere_les_ventes(uuid)') is null
     or (select count(*) from pg_attribute where attrelid = 'public.dossiers'::regclass and not attisdropped
          and attname in ('statut_tva', 'article_exoneration', 'tva_periodicite', 'tva_sur_debits')) <> 4 then
    raise exception 'Une table, une fonction ou une colonne que la migration suppose manque (regimes_ereporting, declarations_ereporting, gere_les_ventes, le statut de TVA du dossier) : relire la base.';
  end if;
  if (select position('regimes_ereporting' in p.prosrc) > 0 from pg_proc p
       where p.oid = to_regprocedure('public.etat_facture_electronique(uuid)')) then
    raise exception 'La migration apercu_facture_electronique est déjà en base.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.etat_facture_electronique(uuid)'))
       is distinct from '465307bcdf36e179469859535fe1af2c' then
    raise exception 'etat_facture_electronique n''est plus celle que cette migration remplace (empreinte de la production du 06/11/2026) : la relire contre la base avant de l''appliquer.';
  end if;
end
$garde$;

-- ══ 1. L'état de la facture électronique, et la prochaine période d'e-reporting ══════════
create or replace function public.etat_facture_electronique(p_dossier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'plateforme', coalesce(
      (select jsonb_build_object('reliee', true, 'nom', c.nom, 'creee_le', c.created_at,
                                 'derniere_recuperation', c.derniere_recuperation, 'statuts_lus_le', c.cycle_vie_lu_le)
         from public.connexions_plateformes c where c.dossier_id = p_dossier_id),
      jsonb_build_object('reliee', false, 'nom', null, 'creee_le', null, 'derniere_recuperation', null, 'statuts_lus_le', null)),
    'superpdp', coalesce(
      (select jsonb_build_object('relie', true, 'depuis', s.created_at)
         from public.superpdp_credentials s where s.dossier_id = p_dossier_id),
      jsonb_build_object('relie', false, 'depuis', null)),
    'adresse',
      (select jsonb_build_object('id', a.id, 'forme', a.forme, 'identifiant', a.identifiant, 'plateforme', a.plateforme,
                                 'prise_effet', a.prise_effet, 'verification', a.verification, 'verifiee_le', a.verifiee_le,
                                 'auteur', a.auteur, 'cree_le', a.cree_le)
         from public.adresses_reception a
        where a.dossier_id = p_dossier_id
          and not exists (select 1 from public.adresses_reception s where s.remplace_id = a.id)),
    'ereporting', jsonb_build_object(
      'statut_du_dossier',
        (select jsonb_build_object('statut_tva', d.statut_tva, 'article_exoneration', d.article_exoneration,
                                   'tva_periodicite', d.tva_periodicite, 'tva_sur_debits', d.tva_sur_debits)
           from public.dossiers d where d.id = p_dossier_id),
      'regimes', coalesce(
        (select jsonb_agg(jsonb_build_object('depuis', r.depuis, 'statut_tva', r.statut_tva,
                                             'article_exoneration', r.article_exoneration, 'tva_periodicite', r.tva_periodicite,
                                             'tva_sur_debits', r.tva_sur_debits, 'frequence_transactions', r.frequence_transactions,
                                             'frequence_paiements', r.frequence_paiements)
                          order by r.depuis)
           from public.regimes_ereporting r
          where r.dossier_id = p_dossier_id and r.retire_le is null),
        '[]'::jsonb),
      'declarations', coalesce(
        (select jsonb_agg(jsonb_build_object('objet', x.objet, 'debut', x.periode_debut, 'fin', x.periode_fin,
                                             'declaree_le', x.cree_le)
                          order by x.periode_debut, x.objet collate "C")
           from public.declarations_ereporting x
          where x.dossier_id = p_dossier_id and x.etat = 'declaree'
            and x.periode_fin >= (now() at time zone 'Europe/Paris')::date - 92),
        '[]'::jsonb)));
end
$$;

comment on function public.etat_facture_electronique(uuid) is
  'L''état de la facture électronique d''un dossier, pour le cabinet ou le client qui porte la case « Ventes » : la plateforme agréée et Super PDP, reliés ou non, leur nom et leurs dates — jamais une adresse de connexion, un identifiant, un secret, une organisation ni une portée —, l''adresse de réception courante, et l''e-reporting en phases (étape C3) : le statut de TVA du dossier, ses régimes confirmés actifs et leurs fréquences, ses déclarations actives récentes (objet, période, jour) — jamais un identifiant, un auteur, une note, une plateforme, un contenu ni une empreinte.';
