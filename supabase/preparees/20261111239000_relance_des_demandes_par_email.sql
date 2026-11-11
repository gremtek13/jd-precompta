-- LA RELANCE D'UNE DEMANDE DU CABINET PAR E-MAIL (espace client, ligne 51.5, partie B, étape B3b) — PRÉPARÉE, PAS
-- APPLIQUÉE. Le récit : HISTORIQUE.md, « 11/11/2026 — B3B : LA RELANCE D'UNE DEMANDE PAR E-MAIL (LIGNE 51.5) (PRÉPARÉE) » ;
-- l'essai : supabase/essais/relanceDesDemandesParEmail.sql ; la fonction qui envoie : supabase/functions/send-email
-- (le modèle « relance_demande », sous `RELANCES_DE_DEMANDES_EN_BASE`).
--
-- POURQUOI. B2 (`documents_et_demandes`) a posé `relances_demandes` et son canal, mais n'y écrit que l'écran
-- (`relancer_demande`, canal « ecran ») : le canal « email » exige que la ligne cite l'e-mail envoyé (`email_id`, une ligne
-- d'`emails_envoyes` du même dossier), et la contrainte du type d'`emails_envoyes` refuse aujourd'hui toute ligne qui ne
-- serait ni une facture, ni un devis, ni une relance de pièces ou de facture. `send-email` envoie d'abord (un e-mail parti ne
-- se rattrape pas), puis inscrit ce qui est parti : le journal ET la relance, d'un seul tenant — l'un sans l'autre dirait au
-- cabinet un envoi que la demande tait, ou au client une relance que le journal ignore.
--
-- CE QU'ELLE POSE.
--   1. La contrainte du type d'`emails_envoyes` admet aussi « relance_demande » : elle REMPLACE celle d'hier dans la même
--      instruction, sous le même nom, et admet tout ce qu'elle admettait (la forme de C5, `relances_des_factures`).
--   2. `journaliser_relance_de_demande(dossier, demande, destinataire, objet, resend_id, envoyé par)` : la ligne du journal
--      (type « relance_demande ») et la relance (canal « email », qui cite cette ligne), d'un seul tenant ; rend la relance.
--      Exécutable par le rôle du service SEUL — la clé secrète de `send-email`, qui l'appelle après l'envoi —, jamais par
--      un compte connecté ni par l'anonyme : le canal « email » ne dit ainsi jamais qu'un e-mail que Resend a accepté.
--      AUX DROITS DE L'APPELANT (ni `security definer`) : le service contourne la RLS par son attribut, et la garde de
--      `relances_demandes` reconnaît le réglage `jd.relances_demandes` que la fonction pose le temps de la transaction.
--      Accordée par erreur à `authenticated`, elle échouerait sous la RLS (la seule policy d'insertion de la relance est
--      celle de la restauration, au super-administrateur).
--      L'accès, le droit (le cabinet seul), la demande ouverte et l'adresse de l'accès se jugent dans `send-email`, AVANT
--      l'envoi ; ici, après lui, rien de ce qui a pu changer entre-temps ne se refuse — une demande close, un accès retiré :
--      ce qui est parti s'inscrit. Seuls se refusent ce que la fonction ne peut pas inscrire sans mentir : une demande
--      inconnue ou d'un autre dossier, un destinataire, un objet ou un auteur vides (22023).
--
-- CE QU'ELLE NE CHANGE PAS : les policies d'`emails_envoyes` (le client « Ventes » ne lit toujours que ses factures, ses
-- devis et ses relances de factures ; la relance d'une demande, il la lit par `relances_demandes`, que TOUT accès du dossier
-- lit depuis B2 : aucune lecture neuve, aucune policy élargie) ; `relances_demandes`, sa garde et `relancer_demande` (B2) ;
-- les tables, colonnes et droits d'hier. Aucune ligne écrite d'avance ni réécrite (la contrainte neuve se vérifie sur les
-- lignes d'hier, toutes d'un type qu'elle admet).
--
-- CE QU'ELLE SUPPOSE, que sa garde de tête vérifie : B2 en base (`relances_demandes` et son canal « email »,
-- `demandes_cabinet`) ; C5 en base (le type « relance_facture ») ; aucun objet de cette migration.
--
-- CE QUE LE TEXTE RETIRE : la contrainte du type d'hier, dans l'instruction qui la remplace (le mot « drop » y paraît :
-- l'outil la retiendra, LE CABINET LA COLLE, avec sa ligne d'historique) ; aucune ligne, aucune colonne. Ni barre oblique
-- inverse, ni retour chariot. Son retour (supabase/preparees/retour/20261111239100) retire la fonction et rend la
-- contrainte d'hier ; il se refuse tant qu'une ligne « relance_demande » est au journal : il n'efface rien.
--
-- L'ORDRE DE MISE EN PRODUCTION : B1, B2, puis celle-ci ; puis `send-email`, sa constante `RELANCES_DE_DEMANDES_EN_BASE`
-- levée, redéployée ; puis `RELANCE_DES_DEMANDES_PAR_EMAIL_PREVUE` (src/lib/documentsEtDemandes.ts) levé, qui offre le
-- bouton, avec `DOCUMENTS_ET_DEMANDES_PREVUS`. VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne
-- d'historique.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regclass('public.relances_demandes') is null or to_regclass('public.demandes_cabinet') is null
     or not exists (select 1 from pg_constraint where conrelid = 'public.relances_demandes'::regclass
                     and conname = 'relances_demandes_canal' and pg_get_constraintdef(oid) like '%''email''%')
     or not exists (select 1 from pg_constraint where conrelid = 'public.relances_demandes'::regclass
                     and conname = 'relances_demandes_email') then
    raise exception 'La migration documents_et_demandes (B2) n''est pas en base : l''appliquer d''abord ; celle-ci écrit le canal « email » de ses relances.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.emails_envoyes'::regclass
                  and conname = 'emails_envoyes_type_check' and pg_get_constraintdef(oid) like '%''relance_facture''%') then
    raise exception 'La migration relances_des_factures (C5) n''est pas en base : la contrainte du type n''admet pas encore « relance_facture ».';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.emails_envoyes'::regclass
              and conname = 'emails_envoyes_type_check' and pg_get_constraintdef(oid) like '%''relance_demande''%')
     or exists (select 1 from pg_proc where proname = 'journaliser_relance_de_demande'
                 and pronamespace = 'public'::regnamespace) then
    raise exception 'La migration relance_des_demandes_par_email est déjà en base : elle ne s''applique pas deux fois.';
  end if;
end
$garde$;

-- ══ 1. Le type « relance_demande » ══════════
-- Même nom que la contrainte d'hier : un export, une restauration ou un essai qui la nomment la retrouvent.
alter table public.emails_envoyes
  drop constraint emails_envoyes_type_check,
  add constraint emails_envoyes_type_check
    check (type in ('facture', 'relance_pieces', 'devis', 'relance_facture', 'relance_demande'));

-- ══ 2. Le journal et la relance, d'un seul tenant ══════════
create function public.journaliser_relance_de_demande(
  p_dossier_id uuid, p_demande_id uuid, p_destinataire text, p_objet text, p_resend_id text, p_envoye_par uuid)
  returns public.relances_demandes
  language plpgsql
  set search_path = public
as $$
declare
  v_demande public.demandes_cabinet;
  v_email uuid;
  v_id uuid := gen_random_uuid();
  v_ligne public.relances_demandes;
begin
  select d.* into v_demande from public.demandes_cabinet d where d.id = p_demande_id;
  if v_demande.id is null or p_dossier_id is null or v_demande.dossier_id <> p_dossier_id then
    raise exception 'Cette demande n''est pas une demande de ce dossier : la relance par e-mail ne s''inscrit pas.' using errcode = '22023';
  end if;
  if p_destinataire is null or btrim(p_destinataire) = '' or p_objet is null or btrim(p_objet) = '' or p_envoye_par is null then
    raise exception 'Une relance par e-mail s''inscrit avec son destinataire, son objet et son auteur.' using errcode = '22023';
  end if;
  insert into public.emails_envoyes (dossier_id, type, destinataire, objet, resend_id, envoye_par)
  values (p_dossier_id, 'relance_demande', p_destinataire, p_objet, p_resend_id, p_envoye_par)
  returning id into v_email;
  perform set_config('jd.relances_demandes', v_id::text, true);
  insert into public.relances_demandes (id, dossier_id, demande_id, canal, email_id, relancee_par)
  values (v_id, p_dossier_id, p_demande_id, 'email', v_email, p_envoye_par)
  returning * into v_ligne;
  perform set_config('jd.relances_demandes', '', true);
  return v_ligne;
end;
$$;

comment on function public.journaliser_relance_de_demande(uuid, uuid, text, text, text, uuid) is
  'Inscrit une relance de demande partie par e-mail (étape B3b) : la ligne du journal (type relance_demande) et la relance (canal email) qui la cite, d''un seul tenant ; rend la relance. Exécutable par le rôle du service seul (send-email, après l''envoi), aux droits de l''appelant ; refuse une demande inconnue ou d''un autre dossier et un destinataire, un objet ou un auteur vides (22023).';

revoke execute on function public.journaliser_relance_de_demande(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.journaliser_relance_de_demande(uuid, uuid, text, text, text, uuid) to service_role;
