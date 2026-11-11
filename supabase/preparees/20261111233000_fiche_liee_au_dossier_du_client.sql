-- LM3 : LA FICHE DE FACTURATION D'UN CLIENT DU CABINET, LIÉE À SON DOSSIER (ligne 47, le cabinet et ses clients) —
-- PRÉPARÉE, PAS APPLIQUÉE. À COLLER, APRÈS `dossier_du_cabinet` (LM1, dont elle lit la désignation) ; elle ne lit rien de
-- `lettres_de_mission` (LM4) ni de `honoraires_factures` (LM7), et s'applique avant ou après elles.
--
-- La conception : HISTORIQUE.md, « 10/11/2026 — LA LETTRE DE MISSION ET LES HONORAIRES DU CABINET : LA CONCEPTION
-- (LIGNE 47) », point 2 ; la réponse du cabinet LM-Q3 : « son dossier est la source » — l'identité d'un client du cabinet
-- (dénomination, SIREN, adresse) se LIT de son dossier, jamais recopiée à la main. Le récit : HISTORIQUE.md,
-- « 11/11/2026 — LM3 ».
--
-- SOURCES. CGI, art. 242 nonies A de l'annexe II, 1° à 3° : la facture porte le nom complet et l'adresse du client et,
-- pour un assujetti, son numéro d'identification (le SIREN, 2°) — la facture d'honoraires les prend du dossier du client,
-- et sa validation les fige (A7a : « LA FACTURE FIGE SES MENTIONS, EN BASE »). Règlement (UE) 2016/679, art. 5, 1, c et
-- d : une seule identité, tenue où elle se corrige (l'identité légale du dossier, A5b2), plutôt qu'une copie qui
-- divergerait. Aucune norme AFNOR.
--
-- CE QU'ELLE FAIT.
--   1. `contacts.dossier_client_id` : une fiche de `contacts` du dossier du cabinet se LIE au dossier de son client. Liée,
--      elle ne garde que ce qui est propre à la facturation — l'adresse de facturation électronique (l'adresse de
--      réception), l'e-mail de facturation, le délai de paiement, les observations — et AUCUNE identité : ni nom, ni
--      adresse, ni type, ni SIREN, ni SIRET, ni code service (`contacts_fiche_liee_sans_identite`). Un dossier n'a qu'une
--      fiche dans le dossier du cabinet, retirées comprises (`contacts_une_fiche_par_dossier_client`, une contrainte
--      TOTALE : les fiches qui ne sont pas liées portent un lien nul, que l'unicité ne compare pas). Effacée, une fiche
--      perd aussi son lien (`contacts_efface_delie`).
--   2. `enregistrer_contact` (redéfinie, le corps de production à l'octet près plus ce qui suit) reçoit la clé
--      `dossier_client_id` : un rang 4 bis, après le contact et avant le nom — un identifiant, dans le dossier du cabinet
--      seul, posé à la création et jamais changé ni reporté sur un autre dossier (il ne se retire que par
--      `delier_fiche_liee`, point 7), un autre dossier du même cabinet, une seule fiche par dossier (23505) — ; une fiche liée refuse les clés d'identité (22023) ; le rang 8 juge son adresse de facturation
--      électronique sur le type et le SIREN que le DOSSIER donne (la composition de `facturer_honoraires`, LM7 : une
--      entreprise établie en France quand il a un SIRET) ; la règle des soins (rang 12) n'a rien à juger d'une fiche qui
--      ne garde aucune identité. Sans la clé, la fonction est celle d'hier, refus et mots compris. `importer_contacts`
--      ne change pas : sa liste fermée de clés refuse `dossier_client_id` (un import ne lie jamais).
--   3. `effacer_contact` (redéfinie) vide aussi le lien.
--   4. `identites_des_fiches_liees(dossier)`, `security definer`, au cabinet du dossier du cabinet (`admin_du_dossier`,
--      puis `est_dossier_du_cabinet`) : pour chaque fiche liée, l'identité que son dossier donne AUJOURD'HUI, composée
--      comme `facturer_honoraires` la compose (le nom imprimé ou le nom du dossier, son adresse, son SIRET quand il a
--      quatorze chiffres et le SIREN qui le commence, le type qui s'en déduit) ; un dossier disparu ou passé à un autre
--      cabinet se dit (`dossier_present` faux, l'identité nulle). Elle ne rend rien d'autre du dossier du client. Le
--      formulaire de la facture la lit au choix du client ; la facture en garde la COPIE, figée à sa validation (A7a).
--   5. Une garde pour tout auteur (`garder_fiche_liee`, la restauration comprise) : le lien ne change pas, sauf vidé par
--      l'effacement ou par le déliement (qui pose sa trace, `delie_le` et `delie_par`, une fois : elle ne se réécrit pas) ; à l'insertion, il vise un autre dossier du même cabinet quand ce dossier existe (une restauration
--      du dossier du cabinet dont un client est parti passe, comme une lettre de mission, LM4), et la fiche vit dans le
--      dossier du cabinet — le super-administrateur excepté, qui restaure un dossier avant de le désigner (23514).
--   6. Le dossier du cabinet qui porte une fiche liée ne change plus de désignation (`garder_designation_des_fiches_liees`,
--      23514) : ses fiches y resteraient sans rien qui les lise.
--   7. `delier_fiche_liee(dossier, fiche, version lue)` — réponse du cabinet LM3-Q1 (B) du 11/11/2026, contre la
--      recommandation (A, le lien fixé) : au cabinet du dossier du cabinet seul (`admin_du_dossier` ; le dossier du cabinet
--      n'a aucun accès client, LM1), une fiche liée se DÉLIE et redevient une fiche saisie à la main ; dans la même
--      transaction, l'identité que son dossier donne À CE MOMENT (le nom, l'adresse, le type, le SIREN et le SIRET,
--      composés comme `identites_des_fiches_liees`) se RECOPIE dans la fiche, pour que rien ne se perde ; ce qui est propre
--      à la facturation reste ; la trace (`delie_le`, `delie_par`) et `modifie_le` se posent. La fiche retient la version
--      lue (`modifie_le`, comme `enregistrer_brouillon_de_lettre` de LM4). Refus, dans cet ordre : l'accès (42501) ; la
--      fiche introuvable dans le dossier (P0002) ; retirée ; pas liée ; lue à une autre version ; son dossier parti du
--      cabinet ; un nom vide ou de plus de deux cents caractères ; une adresse absente ou de plus de mille ; l'adresse de
--      facturation électronique qui ne va plus avec l'identité (une entreprise, son SIREN en tête) (22023) ; le SIRET déjà
--      rangé dans le dossier (23505) — chacun ferait sinon une fiche que la table ou `enregistrer_contact` refuse. Les
--      factures déjà faites gardent leur provenance (`factures_emises.contact_id` désigne la même ligne) et leur copie
--      figée ; la fiche déliée ne se relie à aucun dossier (le rang 4 bis le refuse : son lien est nul), et le dossier
--      qu'elle quitte peut recevoir une nouvelle fiche liée.
--
-- CE QUI A ÉTÉ CHOISI, ET POURQUOI :
--   - la fiche liée SANS identité (la conception, point 2 : « liée, la fiche ne garde que ce qui est propre à la
--     facturation »), d'où `nom` facultatif — pour une fiche liée seulement (`contacts_nom_present`). Écartés : une COPIE
--     de l'identité dans la fiche, écrite par la base à la liaison (deux identités qui divergent dès que le dossier change,
--     ce que LM-Q3 refuse) ; une copie synchronisée par déclencheur (une écriture silencieuse dans une autre table,
--     écartée par la conception) ;
--   - le dossier du client, une RÉFÉRENCE sans clé étrangère, comme `lettres_de_mission.dossier_client_id` (LM4) : une clé
--     vers un autre dossier que celui de la sauvegarde serait sacrifiée à chaque restauration du dossier du cabinet
--     (`liensPerdus`, src/lib/sauvegarde.ts) ; la garde vérifie le cabinet à l'écriture, la lecture dit le dossier parti ;
--   - le lien posé à la création, jamais reporté sur un autre dossier : la provenance des factures déjà faites
--     (`factures_emises.contact_id`) désignerait sinon un autre client ; mais il se DÉLIE (LM3-Q1 (B)), la fiche gardant
--     alors l'identité recopiée du dossier, que ses factures nomment déjà. Écartés : relier la fiche déliée à un autre
--     dossier (LM3-Q1 (C)) ; délier en vidant l'identité (une fiche sans nom, que la table refuse) ; délier par
--     `enregistrer_contact` (l'identité y viendrait de l'appelant, pas du dossier) ;
--   - lier sans l'accès au dossier du client, comme une lettre de mission (LM4) : le chef et les membres assignés au
--     dossier du cabinet voient les honoraires et l'identité des clients qu'ils facturent (LM-Q2) ; LM3-Q2.
--
-- CE QU'ELLE NE FAIT PAS (lots suivants) : `facturer_honoraires` (LM7) ne lit pas encore la fiche — l'e-mail, l'échéance
-- et l'adresse de facturation électronique y restent donnés par l'appelant (LM3-Q3) ; l'écran (la vue « Clients » du
-- dossier du cabinet, le choix d'un client dans la facture), derrière `FICHES_LIEES_PREVUES` (src/lib/fichesLiees.ts) ;
-- aucune donnée n'est lue, écrite ni retirée (0 contact en production le 11/11/2026).
--
-- À COLLER : `nom` perd son `not null` et deux contraintes (`contacts_vivant_complet`, `contacts_adresse_electronique_
-- routee`) sont remplacées par leur forme élargie à la seule fiche liée — l'outil retient le mot. RIEN NE SE DÉTRUIT :
-- aucune donnée, aucune colonne, aucune policy ; une contrainte remplacée accepte exactement ce que l'ancienne acceptait,
-- et en plus une fiche liée. Son retour : supabase/preparees/retour/20261111233100_retour_fiche_liee_au_dossier_du_client.sql
-- (refusé tant qu'une fiche est liée). Son essai : supabase/essais/fichesLieesAuxDossiers.sql (sur une réplique : il
-- désigne le dossier du cabinet et retire un dossier) ; puis rls.sql (le bloc FL).

-- ══ 0. La garde de tête ══════════
-- LM1 en base ; pas déjà appliquée ; les deux fonctions redéfinies sont celles de la production (un corps changé depuis
-- se perdrait : refaire cette migration sur la définition alors en production).
do $garde$
begin
  if to_regprocedure('public.est_dossier_du_cabinet(uuid)') is null or to_regclass('public.contacts') is null
     or not exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = 'cabinets' and c.column_name = 'dossier_du_cabinet') then
    raise exception 'Le dossier du cabinet (LM1, dossier_du_cabinet) ou les contacts ne sont pas en base : cette migration les suppose.';
  end if;
  if exists (select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = 'contacts' and c.column_name = 'dossier_client_id') then
    raise exception 'La colonne contacts.dossier_client_id est déjà en base : cette migration est déjà appliquée.';
  end if;
  if (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
       where p.oid = to_regprocedure('public.enregistrer_contact(uuid, uuid, jsonb)')) is distinct from '8a16d9e16ef17d368d3d3e4846abce5d'
     or (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
          where p.oid = to_regprocedure('public.effacer_contact(uuid, uuid)')) is distinct from '6e67c4614cb715df285f739c3cf31a87' then
    raise exception 'enregistrer_contact ou effacer_contact a changé depuis la migration contacts : refaire celle-ci sur la définition en production.';
  end if;
end
$garde$;

-- ══ 1. La colonne et ses contraintes ══════════
alter table public.contacts add column dossier_client_id uuid;
-- La trace du déliement (LM3-Q1 (B)) : qui a délié la fiche, et quand ; posée une fois, par `delier_fiche_liee`.
alter table public.contacts add column delie_le timestamptz, add column delie_par uuid;
alter table public.contacts alter column nom drop not null;
alter table public.contacts drop constraint contacts_vivant_complet;
alter table public.contacts drop constraint contacts_adresse_electronique_routee;
alter table public.contacts
  add constraint contacts_vivant_complet
    check (efface_le is not null or dossier_client_id is not null or (type_client is not null and adresse is not null)),
  add constraint contacts_adresse_electronique_routee
    check (adresse_electronique is null or dossier_client_id is not null
           or coalesce(type_client in ('assujetti', 'organisme_public'), false)),
  add constraint contacts_nom_present check (nom is not null or dossier_client_id is not null),
  add constraint contacts_fiche_liee_sans_identite
    check (dossier_client_id is null
           or (nom is null and type_client is null and adresse is null and siren is null and siret is null and code_service is null)),
  add constraint contacts_efface_delie check (efface_le is null or dossier_client_id is null),
  add constraint contacts_deliement_entier check ((delie_le is null) = (delie_par is null)),
  add constraint contacts_delie_sans_lien check (delie_le is null or dossier_client_id is null),
  add constraint contacts_une_fiche_par_dossier_client unique (dossier_id, dossier_client_id);

-- ══ 2. Enregistrer un contact : le lien (rang 4 bis) ══════════
create or replace function public.enregistrer_contact(p_dossier_id uuid, p_contact_id uuid, p_contact jsonb)
returns public.contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existant public.contacts;
  v_lien uuid;
  v_client public.dossiers;
  v_autre public.contacts;
  v_ecrit public.contacts;
  v_nom text;
  v_adresse text;
  v_type text;
  v_siren text;
  v_siret text;
  v_adresse_electronique text;
  v_code_service text;
  v_email text;
  v_delai numeric;
  v_observations text;
  v_soins boolean;
  v_somme int;
  v_chiffre int;
  v_cle boolean;
  i int;
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- Deux écritures du même dossier ne se croisent pas : la seconde attend la première, puis voit son SIRET (rang 7).
  perform pg_advisory_xact_lock(hashtextextended('jd.contacts:' || p_dossier_id::text, 0));

  -- 2, 3 et 4. Le contact, dans ce dossier ; retiré, il se reprend avant de se modifier ; effacé, il ne se modifie plus.
  if p_contact_id is not null then
    select * into v_existant from public.contacts c where c.id = p_contact_id and c.dossier_id = p_dossier_id for update;
    if not found then
      raise exception 'Contact introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    if v_existant.retire_le is not null then
      raise exception 'Ce contact est retiré : le reprendre avant de le modifier.' using errcode = '22023';
    end if;
    if v_existant.efface_le is not null then
      raise exception 'Ce contact est effacé : il ne se modifie plus.' using errcode = '22023';
    end if;
  end if;

  -- 4 bis. Le lien au dossier d'un client (LM3, LM-Q3 : son dossier est la source de son identité). Une clé
  -- `dossier_client_id` non nulle LIE la fiche : dans le dossier du cabinet seul (LM1) ; à un autre dossier du même
  -- cabinet ; posé à la création, il ne change plus ici — ni lier une fiche qui ne l'est pas, ni délier (`delier_fiche_liee`
  -- seule, qui recopie l'identité du dossier : LM3-Q1 (B)), ni changer de dossier ; un dossier n'a qu'une fiche, retirées comprises (23505, comme un SIRET). Une fiche liée dont le dossier a
  -- disparu ne se modifie plus : elle se retire et s'efface.
  if coalesce(jsonb_typeof(p_contact->'dossier_client_id'), 'null') <> 'null' then
    if jsonb_typeof(p_contact->'dossier_client_id') <> 'string' or not pg_input_is_valid(p_contact->>'dossier_client_id', 'uuid') then
      raise exception 'Le dossier du client se désigne par son identifiant.' using errcode = '22023';
    end if;
    v_lien := (p_contact->>'dossier_client_id')::uuid;
  end if;
  if v_lien is not null and not public.est_dossier_du_cabinet(p_dossier_id) then
    raise exception 'Une fiche ne se lie au dossier d''un client que dans le dossier du cabinet.' using errcode = '22023';
  end if;
  if p_contact_id is not null and v_lien is distinct from v_existant.dossier_client_id then
    raise exception 'Le lien d''une fiche au dossier de son client se pose à sa création et ne change plus : une autre fiche se crée.'
      using errcode = '22023';
  end if;
  if v_lien is not null then
    select c.* into v_client from public.dossiers c join public.dossiers k on k.id = p_dossier_id
     where c.id = v_lien and c.cabinet_id = k.cabinet_id and c.id <> k.id;
    if not found then
      raise exception 'Le client est un dossier de ce cabinet, autre que le dossier du cabinet.' using errcode = '22023';
    end if;
    select * into v_autre from public.contacts c
     where c.dossier_id = p_dossier_id and c.dossier_client_id = v_lien and c.id is distinct from p_contact_id;
    if found then
      raise exception 'Ce dossier a déjà sa fiche de facturation%.',
        case when v_autre.retire_le is not null then ' (retirée : la reprendre)' else '' end
        using errcode = '23505';
    end if;
  end if;

  if v_lien is null then
    -- 5. Le nom, puis l'adresse. Un champ se lit par son TYPE JSON d'abord : un nombre n'est pas un texte.
    if jsonb_typeof(p_contact->'nom') is distinct from 'string' or btrim(p_contact->>'nom', E' \t\n\r') = '' then
      raise exception 'Le nom du contact est à renseigner.' using errcode = '22023';
    end if;
    v_nom := p_contact->>'nom';
    if char_length(v_nom) > 200 then
      raise exception 'Le nom du contact tient en deux cents caractères au plus.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_contact->'adresse') is distinct from 'string' or btrim(p_contact->>'adresse', E' \t\n\r') = '' then
      raise exception 'L''adresse du contact est à renseigner.' using errcode = '22023';
    end if;
    v_adresse := p_contact->>'adresse';
    if char_length(v_adresse) > 1000 then
      raise exception 'L''adresse du contact tient en mille caractères au plus.' using errcode = '22023';
    end if;

    -- 6. Le type : l'un des quatre de la facture.
    if jsonb_typeof(p_contact->'type_client') is distinct from 'string'
       or p_contact->>'type_client' not in ('assujetti', 'organisme_public', 'non_assujetti', 'etranger') then
      raise exception 'Le type du contact est l''un des quatre de la facture : une entreprise établie en France, un organisme public, un particulier ou un autre non-assujetti, un client établi hors de France.'
        using errcode = '22023';
    end if;
    v_type := p_contact->>'type_client';

    -- 7. Les identifiants, dans l'ordre de la facture : le SIREN, puis le SIRET — aucun pour un client établi hors de France.
    if v_type = 'etranger'
       and (coalesce(jsonb_typeof(p_contact->'siren'), 'null') <> 'null' or coalesce(jsonb_typeof(p_contact->'siret'), 'null') <> 'null') then
      raise exception 'Un client établi hors de France n''a ni SIREN ni SIRET.' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(p_contact->'siren'), 'null') <> 'null' then
      if jsonb_typeof(p_contact->'siren') <> 'string' or p_contact->>'siren' !~ '^[0-9]{9}$' then
        raise exception 'Le SIREN du contact s''écrit en neuf chiffres.' using errcode = '22023';
      end if;
      v_siren := p_contact->>'siren';
      -- La clé de Luhn : en partant de la droite, un chiffre sur deux doublé (moins neuf au-delà de neuf) ; la somme est un
      -- multiple de dix.
      v_somme := 0;
      for i in 1 .. 9 loop
        v_chiffre := substr(v_siren, 10 - i, 1)::int;
        if i % 2 = 0 then
          v_chiffre := v_chiffre * 2;
          if v_chiffre > 9 then
            v_chiffre := v_chiffre - 9;
          end if;
        end if;
        v_somme := v_somme + v_chiffre;
      end loop;
      if v_somme % 10 <> 0 then
        raise exception 'Le SIREN du contact ne passe pas sa clé de contrôle.' using errcode = '22023';
      end if;
    end if;
    if coalesce(jsonb_typeof(p_contact->'siret'), 'null') <> 'null' then
      if jsonb_typeof(p_contact->'siret') <> 'string' or p_contact->>'siret' !~ '^[0-9]{14}$' then
        raise exception 'Le SIRET du contact s''écrit en quatorze chiffres.' using errcode = '22023';
      end if;
      v_siret := p_contact->>'siret';
      -- Les établissements de La Poste (SIREN 356000000), trop nombreux pour la clé de Luhn, ont un SIRET dont la somme des
      -- chiffres est un multiple de cinq ; son siège (35600000000048) garde la clé de Luhn (INSEE ; src/lib/factureCii.ts).
      v_somme := 0;
      if left(v_siret, 9) = '356000000' and v_siret <> '35600000000048' then
        for i in 1 .. 14 loop
          v_somme := v_somme + substr(v_siret, i, 1)::int;
        end loop;
        v_cle := v_somme % 5 = 0;
      else
        for i in 1 .. 14 loop
          v_chiffre := substr(v_siret, 15 - i, 1)::int;
          if i % 2 = 0 then
            v_chiffre := v_chiffre * 2;
            if v_chiffre > 9 then
              v_chiffre := v_chiffre - 9;
            end if;
          end if;
          v_somme := v_somme + v_chiffre;
        end loop;
        v_cle := v_somme % 10 = 0;
      end if;
      if not v_cle then
        raise exception 'Le SIRET du contact ne passe pas sa clé de contrôle.' using errcode = '22023';
      end if;
      if v_siren is null then
        raise exception 'Un SIRET se donne avec le SIREN qu''il commence : renseigner aussi le SIREN du contact.' using errcode = '22023';
      end if;
      if left(v_siret, 9) <> v_siren then
        raise exception 'Le SIRET du contact ne commence pas par son SIREN.' using errcode = '22023';
      end if;
      select * into v_autre from public.contacts c
       where c.dossier_id = p_dossier_id and c.siret = v_siret and c.id is distinct from p_contact_id;
      if found then
        raise exception 'Le SIRET « % » est déjà celui du contact « % »% : un établissement ne se range qu''une fois par dossier.',
          v_siret,
          case when char_length(v_autre.nom) > 80 then left(v_autre.nom, 79) || '…' else v_autre.nom end,
          case when v_autre.retire_le is not null then ' (retiré)' else '' end
          using errcode = '23505';
      end if;
    end if;
  else
    -- 5 à 7, pour une fiche liée : ni nom, ni adresse, ni type, ni identifiants, ni code service — ils se lisent du
    -- dossier (`identites_des_fiches_liees`). Le type et le SIREN que le dossier donne (ceux que `facturer_honoraires`,
    -- LM7, compose : une entreprise établie en France quand il a un SIRET, sinon un non-assujetti) jugent l'adresse de
    -- facturation électronique au rang 8 ; ils ne s'écrivent pas.
    if exists (select 1 from unnest(array['nom', 'adresse', 'type_client', 'siren', 'siret', 'code_service']) k
                where coalesce(jsonb_typeof(p_contact->k), 'null') <> 'null') then
      raise exception 'Une fiche liée au dossier d''un client ne porte ni nom, ni adresse, ni type, ni SIREN, ni SIRET, ni code service : ils se lisent de son dossier.'
        using errcode = '22023';
    end if;
    v_siren := left(case when v_client.siret ~ '^[0-9]{14}$' then v_client.siret end, 9);
    v_type := case when v_client.siret ~ '^[0-9]{14}$' then 'assujetti' else 'non_assujetti' end;
  end if;

  -- 8. L'adresse de facturation électronique : à une entreprise ou à un organisme public, à la forme de l'annuaire, le
  -- SIREN du contact en tête quand il est donné ; puis le code service, à un organisme public.
  if coalesce(jsonb_typeof(p_contact->'adresse_electronique'), 'null') <> 'null' then
    if v_type not in ('assujetti', 'organisme_public') then
      raise exception 'Une adresse de facturation électronique ne se donne qu''à une entreprise établie en France ou à un organisme public.'
        using errcode = '22023';
    end if;
    if jsonb_typeof(p_contact->'adresse_electronique') <> 'string'
       or p_contact->>'adresse_electronique' !~ '^[0-9]{9}(_[0-9]{14}(_[-_/@a-zA-Z0-9]{1,100})?|_[-_.@a-zA-Z0-9]{1,100})?$' then
      raise exception 'L''adresse de facturation électronique s''écrit SIREN, SIREN_SIRET, SIREN_SIRET_code de routage ou SIREN_suffixe, sans espace ni accent.'
        using errcode = '22023';
    end if;
    v_adresse_electronique := p_contact->>'adresse_electronique';
    if v_siren is not null and left(v_adresse_electronique, 9) <> v_siren then
      raise exception 'L''adresse de facturation électronique du contact ne commence pas par son SIREN.' using errcode = '22023';
    end if;
  end if;
  if coalesce(jsonb_typeof(p_contact->'code_service'), 'null') <> 'null' then
    if v_type <> 'organisme_public' then
      raise exception 'Un code service ne se donne qu''à un organisme public.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_contact->'code_service') <> 'string' or btrim(p_contact->>'code_service', E' \t\n\r') = ''
       or char_length(p_contact->>'code_service') > 100 then
      raise exception 'Le code service est à renseigner en cent caractères au plus.' using errcode = '22023';
    end if;
    v_code_service := p_contact->>'code_service';
  end if;

  -- 9. L'e-mail : une adresse valable au sens du WHATWG, de 254 caractères au plus.
  if coalesce(jsonb_typeof(p_contact->'email'), 'null') <> 'null' then
    if jsonb_typeof(p_contact->'email') <> 'string' or char_length(p_contact->>'email') > 254
       or p_contact->>'email' !~ '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$' then
      raise exception 'L''e-mail du contact n''est pas une adresse valable (par exemple nom@exemple.fr) de 254 caractères au plus.'
        using errcode = '22023';
    end if;
    v_email := p_contact->>'email';
  end if;

  -- 10. Le délai de paiement : un nombre entier de jours, de 0 à 60. Le `case` lit le nombre seulement quand c'en est un
  -- (entre parenthèses : sans elles, plpgsql couperait la condition au premier `then`).
  if coalesce(jsonb_typeof(p_contact->'delai_paiement_jours'), 'null') <> 'null' then
    if (case when jsonb_typeof(p_contact->'delai_paiement_jours') <> 'number' then true
             else (p_contact->>'delai_paiement_jours')::numeric not between 0 and 60
                  or (p_contact->>'delai_paiement_jours')::numeric <> trunc((p_contact->>'delai_paiement_jours')::numeric) end) then
      raise exception 'Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.' using errcode = '22023';
    end if;
    v_delai := (p_contact->>'delai_paiement_jours')::numeric;
  end if;

  -- 11. Les observations : un texte de mille caractères au plus.
  if coalesce(jsonb_typeof(p_contact->'observations'), 'null') <> 'null' then
    if jsonb_typeof(p_contact->'observations') <> 'string' or char_length(p_contact->>'observations') > 1000 then
      raise exception 'Les observations du contact sont un texte de mille caractères au plus.' using errcode = '22023';
    end if;
    v_observations := p_contact->>'observations';
  end if;

  -- 12. La règle des soins (MEG1-Q10, hypothèse ; A4-Q1 à A4-Q3) : un dossier qui dispense des soins exonérés ne range ni
  -- particulier — un non-assujetti sans SIREN —, ni client établi hors de France.
  -- Une fiche liée ne garde aucune identité (LM3) : la règle des soins, qui écarte des patients, n'a rien à y juger.
  select coalesce(d.article_exoneration = 'cgi_261_4_1', false) and v_lien is null into v_soins
    from public.dossiers d where d.id = p_dossier_id;
  if v_soins and v_type = 'non_assujetti' and v_siren is null then
    raise exception 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de particulier dans ses contacts : ce seraient ses patients. Un autre non-assujetti, une association par exemple, s''y range avec son SIREN.'
      using errcode = '22023';
  end if;
  if v_soins and v_type = 'etranger' then
    raise exception 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de client établi hors de France dans ses contacts : il pourrait être un particulier, donc un patient.'
      using errcode = '22023';
  end if;

  -- L'écriture : les colonnes énumérées ; le genre, l'auteur et l'instant posés par la base.
  if p_contact_id is null then
    insert into public.contacts (dossier_id, genre, type_client, nom, adresse, siren, siret, adresse_electronique,
                                 code_service, email, delai_paiement_jours, observations, cree_par, dossier_client_id)
    values (p_dossier_id, 'client', case when v_lien is null then v_type end, v_nom, v_adresse,
            case when v_lien is null then v_siren end, v_siret, v_adresse_electronique,
            v_code_service, v_email, v_delai, v_observations, auth.uid(), v_lien)
    returning * into v_ecrit;
  else
    update public.contacts c
       set type_client = case when v_lien is null then v_type end, nom = v_nom, adresse = v_adresse,
           siren = case when v_lien is null then v_siren end, siret = v_siret,
           adresse_electronique = v_adresse_electronique, code_service = v_code_service, email = v_email,
           delai_paiement_jours = v_delai, observations = v_observations, modifie_par = auth.uid(), modifie_le = now()
     where c.id = p_contact_id
    returning * into v_ecrit;
  end if;
  return v_ecrit;
end
$$;

create or replace function public.effacer_contact(p_dossier_id uuid, p_contact_id uuid)
returns public.contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.contacts;
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_contact from public.contacts c where c.id = p_contact_id and c.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Contact introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_contact.efface_le is not null then
    raise exception 'Ce contact est déjà effacé.' using errcode = '22023';
  end if;
  update public.contacts c
     set nom = 'Contact effacé le ' || to_char((now() at time zone 'Europe/Paris')::date, 'DD/MM/YYYY'),
         type_client = null, adresse = null, siren = null, siret = null, adresse_electronique = null, code_service = null,
         email = null, delai_paiement_jours = null, observations = null, retire_le = null, retire_par = null,
         dossier_client_id = null,
         efface_le = now(), efface_par = auth.uid()
   where c.id = p_contact_id
  returning * into v_contact;
  return v_contact;
end
$$;

-- ══ 2 bis. Délier une fiche (LM3-Q1 (B)) ══════════
-- Au cabinet seul. La fiche redevient saisie à la main : l'identité que son dossier donne à ce moment s'y recopie, dans
-- la même transaction, sous le verrou des contacts du dossier (celui d'`enregistrer_contact` : le SIRET recopié se juge
-- sur ce qui est écrit). Les refus et leur ordre : l'en-tête, point 7.
create function public.delier_fiche_liee(p_dossier_id uuid, p_contact_id uuid, p_modifie_le timestamptz)
returns public.contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fiche public.contacts;
  v_client public.dossiers;
  v_autre public.contacts;
  v_nom text;
  v_siret text;
  v_siren text;
  v_type text;
  v_ecrit public.contacts;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.contacts:' || p_dossier_id::text, 0));
  select * into v_fiche from public.contacts c where c.id = p_contact_id and c.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Contact introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_fiche.retire_le is not null then
    raise exception 'Ce contact est retiré : le reprendre avant de le modifier.' using errcode = '22023';
  end if;
  if v_fiche.dossier_client_id is null then
    raise exception 'Cette fiche n''est pas liée au dossier d''un client : rien ne se délie.' using errcode = '22023';
  end if;
  if p_modifie_le is distinct from v_fiche.modifie_le then
    raise exception 'La fiche a changé depuis sa lecture : relire avant de la délier.' using errcode = '22023';
  end if;
  select c.* into v_client from public.dossiers c join public.dossiers k on k.id = p_dossier_id
   where c.id = v_fiche.dossier_client_id and c.cabinet_id = k.cabinet_id and c.id <> k.id;
  if not found then
    raise exception 'Le dossier de ce client n''est plus dans ce cabinet : rien ne se recopie. La fiche se retire ou s''efface.'
      using errcode = '22023';
  end if;
  -- L'identité, composée comme `identites_des_fiches_liees` (et `facturer_honoraires`, LM7).
  v_nom := coalesce(nullif(btrim(v_client.denomination_imprimee), ''), v_client.nom);
  v_siret := case when v_client.siret ~ '^[0-9]{14}$' then v_client.siret end;
  v_siren := left(v_siret, 9);
  v_type := case when v_siret is not null then 'assujetti' else 'non_assujetti' end;
  if v_nom is null or btrim(v_nom, E' \t\n\r') = '' or char_length(v_nom) > 200 then
    raise exception 'Le nom que donne le dossier de ce client est vide ou dépasse deux cents caractères : le corriger dans son identité avant de délier la fiche.'
      using errcode = '22023';
  end if;
  if v_client.adresse is null or btrim(v_client.adresse, E' \t\n\r') = '' or char_length(v_client.adresse) > 1000 then
    raise exception 'Le dossier de ce client n''a pas d''adresse (ou une de plus de mille caractères) : la renseigner dans son identité avant de délier la fiche.'
      using errcode = '22023';
  end if;
  if v_fiche.adresse_electronique is not null
     and (v_siren is null or left(v_fiche.adresse_electronique, 9) <> v_siren) then
    raise exception 'L''adresse de facturation électronique de la fiche ne va plus avec l''identité du dossier (une entreprise, son SIREN en tête) : la corriger ou la retirer avant de délier la fiche.'
      using errcode = '22023';
  end if;
  if v_siret is not null then
    select * into v_autre from public.contacts c
     where c.dossier_id = p_dossier_id and c.siret = v_siret and c.id <> p_contact_id;
    if found then
      raise exception 'Le SIRET « % » est déjà celui du contact « % »% : un établissement ne se range qu''une fois par dossier.',
        v_siret,
        case when char_length(v_autre.nom) > 80 then left(v_autre.nom, 79) || '…' else v_autre.nom end,
        case when v_autre.retire_le is not null then ' (retiré)' else '' end
        using errcode = '23505';
    end if;
  end if;
  update public.contacts c
     set dossier_client_id = null, nom = v_nom, adresse = v_client.adresse, type_client = v_type, siren = v_siren,
         siret = v_siret, delie_le = now(), delie_par = auth.uid(), modifie_le = now(), modifie_par = auth.uid()
   where c.id = p_contact_id
  returning * into v_ecrit;
  return v_ecrit;
end
$$;

-- ══ 3. La garde des fiches liées, pour tout auteur ══════════
-- `security definer` : elle lit le cabinet des deux dossiers, que la RLS cacherait à un membre qui n'a pas le dossier du
-- client ; aucun rôle de session ne l'exécute. La restauration (le super-administrateur, sous `authenticated`) la traverse
-- comme toute écriture : un dossier client parti n'arrête pas la restauration du dossier du cabinet (LM4).
create function public.garder_fiche_liee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.dossier_client_id is distinct from old.dossier_client_id
     and not (new.dossier_client_id is null and new.efface_le is not null)
     and not (new.dossier_client_id is null and old.delie_le is null and new.delie_le is not null) then
    raise exception 'Le lien d''une fiche au dossier de son client se pose à sa création et ne change plus : une autre fiche se crée.'
      using errcode = '23514';
  end if;
  -- La trace du déliement se pose en déliant, une fois, et ne se réécrit plus.
  if tg_op = 'UPDATE' and (new.delie_le, new.delie_par) is distinct from (old.delie_le, old.delie_par)
     and not (old.delie_le is null and old.dossier_client_id is not null and new.dossier_client_id is null) then
    raise exception 'La trace du déliement d''une fiche ne se réécrit pas.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.dossier_client_id is not null then
    if exists (select 1 from public.dossiers c where c.id = new.dossier_client_id)
       and not exists (select 1 from public.dossiers c join public.dossiers k on k.id = new.dossier_id
                        where c.id = new.dossier_client_id and c.cabinet_id = k.cabinet_id and c.id <> k.id) then
      raise exception 'Le client est un dossier de ce cabinet, autre que le dossier du cabinet.' using errcode = '23514';
    end if;
    if not public.est_dossier_du_cabinet(new.dossier_id) and not public.is_super_admin() then
      raise exception 'Une fiche ne se lie au dossier d''un client que dans le dossier du cabinet.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
create trigger contacts_fiche_liee
  before insert or update on public.contacts
  for each row execute function public.garder_fiche_liee();

-- ══ 4. Le dossier du cabinet qui porte une fiche liée garde sa désignation ══════════
-- Comme une lettre de mission (LM4) : changée ou retirée, la désignation laisserait les fiches dans un dossier que rien
-- ne lit plus comme celui du cabinet. Un dossier désigné disparu (la désignation remise à nul par sa clé) ne retient rien.
create function public.garder_designation_des_fiches_liees() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dossier_du_cabinet is not distinct from old.dossier_du_cabinet or old.dossier_du_cabinet is null
     or not exists (select 1 from public.dossiers d where d.id = old.dossier_du_cabinet) then
    return new;
  end if;
  if exists (select 1 from public.contacts f where f.dossier_id = old.dossier_du_cabinet and f.dossier_client_id is not null) then
    raise exception 'Le dossier du cabinet porte des fiches liées aux dossiers de ses clients : sa désignation ne change plus.'
      using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger cabinets_designation_des_fiches_liees
  before update of dossier_du_cabinet on public.cabinets
  for each row execute function public.garder_designation_des_fiches_liees();

-- ══ 5. L'identité que le dossier de chaque client donne ══════════
-- Pour le cabinet du dossier du cabinet : chaque fiche liée (retirées comprises ; une fiche effacée n'a plus de lien) et
-- l'identité que son dossier donne aujourd'hui, composée comme `facturer_honoraires` (LM7) la compose — le nom imprimé ou,
-- sans lui, le nom du dossier ; son adresse ; son SIRET quand il a quatorze chiffres, et le SIREN qui le commence ; une
-- entreprise établie en France quand il a un SIRET, sinon un non-assujetti. Un dossier parti, ou passé à un autre
-- cabinet : `dossier_present` faux, l'identité nulle. Refus : l'accès (42501), puis le dossier du cabinet (22023).
create function public.identites_des_fiches_liees(p_dossier_id uuid)
returns table (contact_id uuid, dossier_client_id uuid, dossier_present boolean, tiers_nom text, tiers_adresse text,
               tiers_siret text, tiers_siren text, type_client text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if not public.est_dossier_du_cabinet(p_dossier_id) then
    raise exception 'Les fiches liées au dossier d''un client vivent dans le dossier du cabinet.' using errcode = '22023';
  end if;
  return query
  select f.id, f.dossier_client_id, c.id is not null,
         coalesce(nullif(btrim(c.denomination_imprimee), ''), c.nom),
         c.adresse,
         case when c.siret ~ '^[0-9]{14}$' then c.siret end,
         left(case when c.siret ~ '^[0-9]{14}$' then c.siret end, 9),
         case when c.id is null then null when c.siret ~ '^[0-9]{14}$' then 'assujetti' else 'non_assujetti' end
    from public.contacts f
    join public.dossiers k on k.id = f.dossier_id
    left join public.dossiers c on c.id = f.dossier_client_id and c.cabinet_id = k.cabinet_id and c.id <> k.id
   where f.dossier_id = p_dossier_id and f.dossier_client_id is not null
   order by f.id;
end
$$;

-- ══ 6. Les droits d'exécution ══════════
-- La lecture vérifie l'accès elle-même ; les gardes ne servent qu'à la base.
revoke execute on function public.identites_des_fiches_liees(uuid) from public, anon;
grant execute on function public.identites_des_fiches_liees(uuid) to authenticated;
revoke execute on function public.delier_fiche_liee(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.delier_fiche_liee(uuid, uuid, timestamptz) to authenticated;
revoke execute on function public.garder_fiche_liee() from public, anon, authenticated;
revoke execute on function public.garder_designation_des_fiches_liees() from public, anon, authenticated;

comment on column public.contacts.dossier_client_id is
  'LM3 (LM-Q3) : le dossier du client qu''une fiche du dossier du cabinet désigne — une référence sans clé, comme lettres_de_mission.dossier_client_id. Liée, la fiche ne garde aucune identité : elle se lit du dossier (identites_des_fiches_liees). Posé à la création, il ne change plus ; l''effacement le vide, et delier_fiche_liee, qui recopie l''identité du dossier (LM3-Q1 (B)).';
comment on column public.contacts.delie_le is
  'LM3-Q1 (B) : quand la fiche, liée au dossier de son client, en a été déliée (delier_fiche_liee) : elle est depuis saisie à la main, l''identité du dossier recopiée ce jour-là. Posé une fois.';
comment on function public.delier_fiche_liee(uuid, uuid, timestamptz) is
  'LM3-Q1 (B) : au cabinet seul, délie une fiche du dossier du cabinet de son client ; dans la même transaction, l''identité que le dossier donne à ce moment s''y recopie, la trace se pose ; retient la version lue (modifie_le).';
comment on function public.enregistrer_contact(uuid, uuid, jsonb) is
  'Crée ou réécrit un contact du dossier, pour le cabinet ou le client qui porte la case « Ventes » : l''accès d''abord, puis onze rangs de refus dans un ordre fixé, la règle des soins comprise, et le lien au dossier d''un client (rang 4 bis, dans le dossier du cabinet seul, LM3) ; rend le contact écrit.';
comment on function public.identites_des_fiches_liees(uuid) is
  'LM3 : pour le cabinet du dossier du cabinet, l''identité que le dossier de chaque client lié donne aujourd''hui, composée comme facturer_honoraires (LM7) ; un dossier parti se dit (dossier_present faux).';
